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

import { rollRoster, SPECIAL_MERCS, NAMED_RECRUITS_BY_ID, checkMercUnlock, checkWeaponUnlock } from './recruiter.js';
import { refreshCost, getChips, spendChips, REHIRE_DISCOUNT } from './agency_economy.js';

const STYLE = `
#recruiter-root {
  position: fixed; inset: 0;
  display: none;
  background: rgba(8, 8, 12, 0.82);
  backdrop-filter: blur(4px);
  /* Normalized to the 20-25 tier used by every other modal overlay
     (menu=20, perks=14, relics=15, cust=19, skill-pick=20). Was 6000
     which made it un-layerable — opening perks/inventory while the
     recruiter was up would render them BEHIND the recruiter. */
  z-index: 25;
  align-items: center; justify-content: center;
  font-family: 'Inter', system-ui, sans-serif;
  color: var(--ce-soft);
}
#recruiter-root.show { display: flex; }
#recruiter-card {
  background:
    linear-gradient(180deg, rgba(26,24,20,0.82) 0%, rgba(16,14,10,0.92) 100%),
    url("Assets/generated/artpass-recruiter-room.png") center / cover no-repeat,
    linear-gradient(180deg, var(--ce-black) 0%, var(--ce-black) 100%);
  border: 1px solid var(--ce-navy);
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
  color: var(--cy-amber); letter-spacing: 0.04em;
  text-transform: uppercase;
}
#recruiter-credits {
  font-size: 14px; color: var(--ce-soft-50);
  font-variant-numeric: tabular-nums;
}
#recruiter-flavor {
  font-size: 13px; color: var(--ce-soft-50);
  font-style: italic;
  margin-bottom: 24px;
}
#recruiter-options {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.recruiter-card {
  background: var(--ce-black);
  border: 1px solid var(--ce-navy);
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
  border-color: var(--cy-amber);
  transform: translateY(-2px);
}
.recruiter-card.disabled {
  opacity: 0.45; cursor: not-allowed;
}
.recruiter-card.disabled:hover {
  border-color: var(--ce-navy); transform: none;
}
.recruiter-card.special {
  border-color: var(--cy-amber);
  background: linear-gradient(180deg, var(--ce-black) 0%, var(--ce-black) 100%);
}
.recruiter-card.special::before {
  content: 'RARE'; display: block;
  font-size: 10px; color: var(--cy-amber); letter-spacing: 0.18em;
  font-weight: 700;
}
.rcard-portrait {
  width: 100%; aspect-ratio: 1;
  background: var(--ce-black);
  border-radius: 2px;
  display: flex; align-items: center; justify-content: center;
  color: var(--ce-navy); font-size: 11px;
}
.rcard-codename {
  font-size: 18px; font-weight: 600; color: var(--ce-white);
  letter-spacing: 0.02em;
}
.rcard-class-line {
  font-size: 11px; color: var(--ce-soft-50);
  text-transform: uppercase; letter-spacing: 0.14em;
  display: flex; gap: 8px; align-items: center;
}
.rcard-class-line .tier {
  padding: 1px 6px; border: 1px solid var(--ce-navy); border-radius: 2px;
  font-size: 10px;
}
.rcard-class-line .tier.special { color: var(--cy-amber); border-color: var(--cy-amber); }
.rcard-stats {
  display: grid; grid-template-columns: 60px 1fr 30px;
  gap: 4px 8px;
  font-size: 11px;
  align-items: center;
}
.rcard-stat-label {
  color: var(--ce-steel);
  text-transform: uppercase; letter-spacing: 0.10em;
}
.rcard-stat-bar {
  height: 4px; background: var(--ce-navy); border-radius: 1px;
  overflow: hidden;
}
.rcard-stat-fill {
  height: 100%; background: linear-gradient(90deg, var(--cy-amber), var(--cy-amber));
}
.rcard-stat-val {
  text-align: right; color: var(--ce-soft-50);
  font-variant-numeric: tabular-nums;
}
.rcard-quirk {
  font-size: 12px; color: var(--ce-soft-50);
  font-style: italic;
  line-height: 1.4;
  border-left: 2px solid var(--ce-navy);
  padding-left: 8px;
  margin-top: 2px;
}
.rcard-weapon {
  font-size: 11px; color: var(--cy-amber);
  background: var(--ce-black);
  border: 1px solid var(--ce-navy);
  border-radius: 2px;
  padding: 6px 8px;
  margin-top: 4px;
}
.rcard-weapon-label {
  font-weight: 600; letter-spacing: 0.04em;
}
.rcard-weapon-flavor {
  color: var(--cy-amber); font-style: italic;
  margin-top: 2px;
}
.rcard-ability {
  font-size: 11px; color: var(--ce-soft);
  background: var(--ce-black);
  border: 1px solid var(--ce-navy);
  border-radius: 2px;
  padding: 6px 8px;
  margin-top: 4px;
}
.rcard-ability-label {
  font-weight: 600; letter-spacing: 0.04em;
}
.rcard-ability-desc { color: var(--ce-soft-50); margin-top: 2px; }
.rcard-relic {
  font-size: 11px; color: var(--cy-violet);
  background: var(--ce-black);
  border: 1px solid var(--ce-navy);
  border-radius: 2px;
  padding: 6px 8px;
  margin-top: 4px;
}
.rcard-relic-label {
  font-weight: 600; letter-spacing: 0.04em;
}
.rcard-relic-desc { color: var(--cy-violet); margin-top: 2px; }
.rcard-perk {
  font-size: 11px; color: var(--cy-mint);
  background: var(--ce-black);
  border: 1px solid var(--ce-navy);
  border-radius: 2px;
  padding: 6px 8px;
  margin-top: 4px;
}
.rcard-loadout {
  font-size: 10px; color: var(--ce-soft-50);
  margin-top: 4px;
  text-transform: uppercase; letter-spacing: 0.08em;
}
.rcard-footer {
  margin-top: auto; padding-top: 8px;
  border-top: 1px solid var(--ce-navy);
  display: flex; justify-content: space-between;
  font-size: 12px;
}
.rcard-price {
  color: var(--cy-amber); font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.rcard-price.unaffordable { color: var(--ce-red); }
.rcard-contract {
  color: var(--ce-steel);
  text-transform: uppercase; letter-spacing: 0.10em; font-size: 10px;
}
#recruiter-actions {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 24px; padding-top: 16px;
  border-top: 1px solid var(--ce-navy);
}
.rec-btn {
  background: var(--ce-navy); color: var(--ce-soft);
  border: 1px solid var(--ce-navy); border-radius: 2px;
  padding: 8px 18px; font-size: 13px;
  cursor: pointer; font: inherit;
  letter-spacing: 0.06em; text-transform: uppercase;
  transition: background 0.12s, border-color 0.12s;
}
.rec-btn:hover { background: var(--ce-navy); border-color: var(--cy-amber); }
.rec-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.rec-btn.primary { background: var(--ce-navy); border-color: var(--cy-amber); color: var(--cy-amber); }
.rec-btn.primary:hover { background: var(--ce-navy); }
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
          <button class="rec-btn" id="recruiter-refresh">Refresh roster — <span id="recruiter-refresh-cost">${refreshCost(0)}</span>c</button>
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
    // Escape closes the recruiter (same as "Walk away"). Capture
    // phase + visibility gate so we don't trigger when the panel
    // isn't showing, and so the game's pause menu doesn't fire on
    // top of us.
    window.addEventListener('keydown', (e) => {
      if (this.root.classList.contains('show') && e.key === 'Escape') {
        e.stopPropagation();
        this._dismiss(null);
      }
    }, true);
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
    const cost = refreshCost(this._refreshCount || 0);
    if (credits < cost) return;
    if (!this.opts.spendCredits(cost)) return;
    this._refreshCount = (this._refreshCount || 0) + 1;
    this.roster = rollRoster(this.opts.unlockedSpecials || new Set());
    this._render();
  }

  _currentCredits() {
    return this.opts.getCredits ? this.opts.getCredits() : 0;
  }

  _render() {
    const credits = this._currentCredits();
    this.creditsEl.textContent = `${credits}c on hand`;
    const cost = refreshCost(this._refreshCount || 0);
    this.refreshBtn.disabled = credits < cost;
    const costEl = this.root.querySelector('#recruiter-refresh-cost');
    if (costEl) costEl.textContent = String(cost);
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
      <div class="rcard-stat-bar"><div class="rcard-stat-fill" style="width:${Math.min(100, a.stats[key])}%"></div></div>
      <div class="rcard-stat-val">${a.stats[key]}</div>`;
    // Special-merc blocks: weapon, ability, relic, starting items.
    let extraBlocks = '';
    if (a.kind === 'special') {
      const merc = SPECIAL_MERCS[a.mercId];
      extraBlocks += `<div class="rcard-weapon">
        <div class="rcard-weapon-label">${a.weapon.label}</div>
        <div class="rcard-weapon-flavor">${a.weapon.flavor}</div>
      </div>`;
      if (merc?.ability) {
        extraBlocks += `<div class="rcard-ability">
          <div class="rcard-ability-label">★ ${merc.ability.name}</div>
          <div class="rcard-ability-desc">${merc.ability.desc}</div>
        </div>`;
      }
      if (merc?.relic) {
        extraBlocks += `<div class="rcard-relic">
          <div class="rcard-relic-label">◆ ${merc.relic.name}</div>
          <div class="rcard-relic-desc">${merc.relic.desc}</div>
        </div>`;
      }
      if (merc?.startingItems?.length) {
        extraBlocks += `<div class="rcard-loadout">Loadout: ${merc.startingItems.join(' · ')}</div>`;
      }
    } else if (a.kind === 'named' && a.perk) {
      // Named recruit perk — green-tinted block.
      extraBlocks += `<div class="rcard-perk">★ ${a.perk}</div>`;
    }
    const tierBadge = a.kind === 'special' ? '<span class="tier special">special</span>' :
      a.kind === 'named' ? `<span class="tier">${a.tier} · named</span>` :
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
      ${extraBlocks}
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
