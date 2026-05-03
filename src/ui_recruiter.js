// ============================================================
// ui_recruiter.js — daily roster modal at the recruiter NPC
// ============================================================
//
// Shown when the player interacts with the recruiter in the hideout.
// Three cards: low / mid / RNG (with 2% chance of a special merc).
// Player can hire one (chips spent → agent joins roster), refresh the
// whole bunch for a fee, or walk away.
//
// Consumer wiring (caller provides):
//   opts.getCredits()         — current chip balance
//   opts.spendCredits(amount) — debit chips, return success
//   opts.addAgentToRoster(a)  — push agent into the agency state
//   opts.unlockedSpecials     — Set<mercId> of already-permanent mercs
//   opts.mercProgress         — { mercId: { weaponKills, contracts, ... } }
//   opts.onClose()            — fired when modal dismissed
//
// Returns the chosen agent (or null on dismiss) via .show().

import { rollRoster, SPECIAL_MERCS, checkMercUnlock, checkWeaponUnlock } from './recruiter.js';

const REFRESH_COST = 50;

const STYLE = `
#recruiter-root {
  position: fixed; inset: 0;
  display: none;
  background: rgba(8, 8, 12, 0.82);
  backdrop-filter: blur(4px);
  z-index: 6000;
  align-items: center; justify-content: center;
  font-family: 'Inter', system-ui, sans-serif;
  color: #d8d4cc;
}
#recruiter-root.show { display: flex; }
#recruiter-card {
  background: linear-gradient(180deg, #1a1814 0%, #100e0a 100%);
  border: 1px solid #3a3530;
  border-radius: 4px;
  width: min(1100px, 95vw);
  max-height: 90vh;
  overflow-y: auto;
  padding: 32px 36px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.6);
}
#recruiter-header {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 8px;
}
#recruiter-title {
  font-size: 22px; font-weight: 600;
  color: #d8a060; letter-spacing: 0.04em;
  text-transform: uppercase;
}
#recruiter-credits {
  font-size: 14px; color: #8a8478;
  font-variant-numeric: tabular-nums;
}
#recruiter-flavor {
  font-size: 13px; color: #8a8478;
  font-style: italic;
  margin-bottom: 24px;
}
#recruiter-options {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.recruiter-card {
  background: #181612;
  border: 1px solid #2c2620;
  border-radius: 4px;
  padding: 16px;
  cursor: pointer;
  transition: border-color 0.12s, transform 0.12s;
  display: flex; flex-direction: column;
  gap: 10px;
  text-align: left;
  font: inherit; color: inherit;
}
.recruiter-card:hover {
  border-color: #d8a060;
  transform: translateY(-2px);
}
.recruiter-card.disabled {
  opacity: 0.45; cursor: not-allowed;
}
.recruiter-card.disabled:hover {
  border-color: #2c2620; transform: none;
}
.recruiter-card.special {
  border-color: #c08020;
  background: linear-gradient(180deg, #221810 0%, #181612 100%);
}
.recruiter-card.special::before {
  content: 'RARE'; display: block;
  font-size: 10px; color: #d8a060; letter-spacing: 0.18em;
  font-weight: 700;
}
.rcard-portrait {
  width: 100%; aspect-ratio: 1;
  background: #0c0a08;
  border-radius: 2px;
  display: flex; align-items: center; justify-content: center;
  color: #4a443c; font-size: 11px;
}
.rcard-codename {
  font-size: 18px; font-weight: 600; color: #e8e2d8;
  letter-spacing: 0.02em;
}
.rcard-class-line {
  font-size: 11px; color: #8a8478;
  text-transform: uppercase; letter-spacing: 0.14em;
  display: flex; gap: 8px; align-items: center;
}
.rcard-class-line .tier {
  padding: 1px 6px; border: 1px solid #3a3530; border-radius: 2px;
  font-size: 10px;
}
.rcard-class-line .tier.special { color: #d8a060; border-color: #c08020; }
.rcard-stats {
  display: grid; grid-template-columns: 60px 1fr 30px;
  gap: 4px 8px;
  font-size: 11px;
  align-items: center;
}
.rcard-stat-label {
  color: #6a645c;
  text-transform: uppercase; letter-spacing: 0.10em;
}
.rcard-stat-bar {
  height: 4px; background: #2a2620; border-radius: 1px;
  overflow: hidden;
}
.rcard-stat-fill {
  height: 100%; background: linear-gradient(90deg, #8a7a50, #d8a060);
}
.rcard-stat-val {
  text-align: right; color: #a8a298;
  font-variant-numeric: tabular-nums;
}
.rcard-quirk {
  font-size: 12px; color: #8a8478;
  font-style: italic;
  line-height: 1.4;
  border-left: 2px solid #3a3530;
  padding-left: 8px;
  margin-top: 2px;
}
.rcard-weapon {
  font-size: 11px; color: #d8a060;
  background: #1c160c;
  border: 1px solid #4a3820;
  border-radius: 2px;
  padding: 6px 8px;
  margin-top: 4px;
}
.rcard-weapon-label {
  font-weight: 600; letter-spacing: 0.04em;
}
.rcard-weapon-flavor {
  color: #a8987a; font-style: italic;
  margin-top: 2px;
}
.rcard-footer {
  margin-top: auto; padding-top: 8px;
  border-top: 1px solid #2a2620;
  display: flex; justify-content: space-between;
  font-size: 12px;
}
.rcard-price {
  color: #d8a060; font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.rcard-price.unaffordable { color: #c04040; }
.rcard-contract {
  color: #6a645c;
  text-transform: uppercase; letter-spacing: 0.10em; font-size: 10px;
}
#recruiter-actions {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 24px; padding-top: 16px;
  border-top: 1px solid #2a2620;
}
.rec-btn {
  background: #2a2620; color: #d8d4cc;
  border: 1px solid #3a3530; border-radius: 2px;
  padding: 8px 18px; font-size: 13px;
  cursor: pointer; font: inherit;
  letter-spacing: 0.06em; text-transform: uppercase;
  transition: background 0.12s, border-color 0.12s;
}
.rec-btn:hover { background: #3a3530; border-color: #d8a060; }
.rec-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.rec-btn.primary { background: #4a3820; border-color: #c08020; color: #f0d8a0; }
.rec-btn.primary:hover { background: #5a4830; }
`;

let _styleInjected = false;
function ensureStyle() {
  if (_styleInjected) return;
  const el = document.createElement('style');
  el.textContent = STYLE;
  document.head.appendChild(el);
  _styleInjected = true;
}

export class RecruiterUI {
  constructor(opts) {
    this.opts = opts;
    ensureStyle();
    this.root = document.createElement('div');
    this.root.id = 'recruiter-root';
    this.root.innerHTML = `
      <div id="recruiter-card">
        <div id="recruiter-header">
          <div id="recruiter-title">Recruiter</div>
          <div id="recruiter-credits"></div>
        </div>
        <div id="recruiter-flavor">"I've got three live ones today. Take a look."</div>
        <div id="recruiter-options"></div>
        <div id="recruiter-actions">
          <button class="rec-btn" id="recruiter-refresh">Refresh roster — ${REFRESH_COST}c</button>
          <button class="rec-btn" id="recruiter-close">Walk away</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.optionsEl = this.root.querySelector('#recruiter-options');
    this.creditsEl = this.root.querySelector('#recruiter-credits');
    this.refreshBtn = this.root.querySelector('#recruiter-refresh');
    this.closeBtn   = this.root.querySelector('#recruiter-close');
    this.refreshBtn.addEventListener('click', () => this._refreshPaid());
    this.closeBtn.addEventListener('click', () => this._dismiss(null));
    this.roster = [];
    this._resolve = null;
  }

  show() {
    this.roster = rollRoster(this.opts.unlockedSpecials || new Set());
    this._render();
    this.root.classList.add('show');
    return new Promise((resolve) => { this._resolve = resolve; });
  }

  _refreshPaid() {
    const credits = this._currentCredits();
    if (credits < REFRESH_COST) return;
    if (!this.opts.spendCredits(REFRESH_COST)) return;
    this.roster = rollRoster(this.opts.unlockedSpecials || new Set());
    this._render();
  }

  _currentCredits() {
    return this.opts.getCredits ? this.opts.getCredits() : 0;
  }

  _render() {
    const credits = this._currentCredits();
    this.creditsEl.textContent = `${credits}c on hand`;
    this.refreshBtn.disabled = credits < REFRESH_COST;
    this.optionsEl.innerHTML = '';
    for (const a of this.roster) {
      this.optionsEl.appendChild(this._cardEl(a, credits));
    }
  }

  _cardEl(a, credits) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'recruiter-card' + (a.kind === 'special' ? ' special' : '')
      + (credits < a.hirePrice ? ' disabled' : '');
    const stat = (label, key) => `
      <div class="rcard-stat-label">${label}</div>
      <div class="rcard-stat-bar"><div class="rcard-stat-fill" style="width:${a.stats[key]}%"></div></div>
      <div class="rcard-stat-val">${a.stats[key]}</div>`;
    const weaponBlock = a.kind === 'special' ? `
      <div class="rcard-weapon">
        <div class="rcard-weapon-label">${a.weapon.label}</div>
        <div class="rcard-weapon-flavor">${a.weapon.flavor}</div>
      </div>
    ` : '';
    const tierBadge = a.kind === 'special' ? '<span class="tier special">special</span>' :
      `<span class="tier">${a.tier}</span>`;
    card.innerHTML = `
      <div class="rcard-portrait">portrait ${a.portraitSeed.toString().slice(-4)}</div>
      <div class="rcard-codename">${a.codename}</div>
      <div class="rcard-class-line">
        <span>${a.class}</span>${tierBadge}
      </div>
      <div class="rcard-stats">
        ${stat('AIM', 'aim')}
        ${stat('MOB', 'mob')}
        ${stat('NRV', 'nrv')}
      </div>
      <div class="rcard-quirk">${a.quirk}</div>
      ${weaponBlock}
      <div class="rcard-footer">
        <span class="rcard-price${credits < a.hirePrice ? ' unaffordable' : ''}">${a.hirePrice}c</span>
        <span class="rcard-contract">${a.contract.type}</span>
      </div>
    `;
    if (credits >= a.hirePrice) {
      card.addEventListener('click', () => this._hire(a));
    }
    return card;
  }

  _hire(agent) {
    const credits = this._currentCredits();
    if (credits < agent.hirePrice) return;
    if (!this.opts.spendCredits(agent.hirePrice)) return;
    if (this.opts.addAgentToRoster) this.opts.addAgentToRoster(agent);
    this._dismiss(agent);
  }

  _dismiss(result) {
    this.root.classList.remove('show');
    if (this.opts.onClose) this.opts.onClose();
    const r = this._resolve;
    this._resolve = null;
    if (r) r(result);
  }
}
