import { SKILL_TREE, SKILL_NODES, generalNodes, classNodes } from './skill_tree.js';
import { CLASS_DEFS, CLASS_IDS, CLASS_THRESHOLDS } from './classes.js';

// Unified skill-tree panel. Left column = general perks (SP-purchasable).
// Right column = class perks, one section per class, unlocked via mastery
// offers (not SP-spent). Class mastery XP bars live at the top of each
// class section.
export class PerkUI {
  constructor({ tree, getPoints, spendPoints, classMastery, onClose }) {
    this.tree = tree;
    this.getPoints = getPoints;
    this.spendPoints = spendPoints;
    this.classMastery = classMastery;
    this.onClose = onClose;
    this.visible = false;

    this.root = document.createElement('div');
    this.root.id = 'perk-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="perk-card">
        <div id="perk-header">
          <div id="perk-title">Skill Tree</div>
          <div id="perk-points"></div>
          <button id="perk-close" type="button">✕</button>
        </div>
        <div id="perk-body">
          <div class="perk-col">
            <div class="perk-col-title">General — spend SP</div>
            <div id="perk-general-list"></div>
          </div>
          <div class="perk-col">
            <div class="perk-col-title">Class Mastery — earned from kills</div>
            <div id="perk-class-list"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.generalEl = this.root.querySelector('#perk-general-list');
    this.classEl = this.root.querySelector('#perk-class-list');
    this.pointsEl = this.root.querySelector('#perk-points');
    this.root.querySelector('#perk-close').addEventListener('click', () => this.hide());
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.hide(); });
  }

  toggle() {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'flex' : 'none';
    if (this.visible) this.render();
  }
  hide() {
    this.visible = false;
    this.root.style.display = 'none';
    if (this.onClose) this.onClose();
  }
  isOpen() { return this.visible; }

  _buy(id) {
    const sp = this.getPoints();
    if (!this.tree.canPurchaseGeneral(id, sp)) return;
    const cost = this.tree.nextCost(id);
    if (!this.spendPoints(cost)) return;
    this.tree.bump(id);
    this.render();
  }

  _renderGeneralRow(node) {
    const lv = this.tree.level(node.id);
    const maxLv = node.levels.length;
    const atMax = lv >= maxLv;
    const tier = atMax ? node.levels[maxLv - 1] : node.levels[lv];
    const cost = atMax ? 0 : tier.cost;
    const sp = this.getPoints();
    const reqMet = this.tree.requirementsMet(node);
    const canBuy = !atMax && reqMet && sp >= cost;

    const row = document.createElement('div');
    row.className = `perk-row${atMax ? ' owned' : ''}${!reqMet && !atMax ? ' locked' : ''}${!canBuy && !atMax && reqMet ? ' unaffordable' : ''}`;
    const reqText = (node.requires || []).map(r =>
      `<span class="req ${this.tree.level(r.id) >= r.level ? 'met' : 'missing'}">${SKILL_NODES[r.id]?.name ?? r.id} L${r.level}</span>`
    ).join(' · ');
    row.innerHTML = `
      <div class="perk-icon">${node.icon || '◇'}</div>
      <div class="perk-main">
        <div class="perk-name">${node.name} <span class="perk-lv">Lv ${lv}/${maxLv}</span></div>
        <div class="perk-desc">${tier.desc}</div>
        ${reqText ? `<div class="perk-req">requires ${reqText}</div>` : ''}
      </div>
      <div class="perk-cost">${atMax ? 'MAX' : `${cost} SP`}</div>
    `;
    if (canBuy) row.addEventListener('click', () => this._buy(node.id));
    return row;
  }

  _renderClassRow(node, classLevel) {
    const lv = this.tree.level(node.id);
    const maxLv = node.levels.length;
    const atMax = lv >= maxLv;
    const tier = atMax ? node.levels[maxLv - 1] : node.levels[lv];
    const reqMet = this.tree.requirementsMet(node);
    const row = document.createElement('div');
    row.className = `perk-row class${atMax ? ' owned' : ''}${!reqMet && !atMax ? ' locked' : ''}`;
    const reqText = (node.requires || []).map(r =>
      `<span class="req ${this.tree.level(r.id) >= r.level ? 'met' : 'missing'}">${SKILL_NODES[r.id]?.name ?? r.id} L${r.level}</span>`
    ).join(' · ');
    row.innerHTML = `
      <div class="perk-icon">${node.icon || '◇'}</div>
      <div class="perk-main">
        <div class="perk-name">${node.name} <span class="perk-lv">Lv ${lv}/${maxLv}</span></div>
        <div class="perk-desc">${tier.desc}</div>
        ${reqText ? `<div class="perk-req">requires ${reqText}</div>` : ''}
      </div>
      <div class="perk-cost">${atMax ? 'MAX' : 'mastery'}</div>
    `;
    return row;
  }

  render() {
    this.pointsEl.innerHTML = `<span>SP</span> <b>${this.getPoints()}</b>`;

    this.generalEl.innerHTML = '';
    for (const node of generalNodes()) {
      this.generalEl.appendChild(this._renderGeneralRow(node));
    }

    this.classEl.innerHTML = '';
    for (const cid of CLASS_IDS) {
      const def = CLASS_DEFS[cid];
      const lv = this.classMastery ? this.classMastery.level(cid) : 0;
      const xp = this.classMastery ? this.classMastery.xpFor(cid) : 0;
      const next = this.classMastery ? this.classMastery.nextThreshold(cid) : null;
      const prevTh = lv === 0 ? 0 : CLASS_THRESHOLDS[lv - 1];
      const pct = next === null ? 100 : Math.max(0, ((xp - prevTh) / (next - prevTh)) * 100);
      const section = document.createElement('div');
      section.className = 'class-section';
      section.innerHTML = `
        <div class="class-head">
          <div class="class-name">${def.label} <span class="class-lv">Lv ${lv}/5</span></div>
          <div class="class-xp">${xp}${next ? ` / ${next}` : ' · max'} XP</div>
        </div>
        <div class="class-bar"><div class="class-bar-fill" style="width:${pct}%"></div></div>
      `;
      for (const node of classNodes(cid)) {
        section.appendChild(this._renderClassRow(node, lv));
      }
      this.classEl.appendChild(section);
    }
  }
}
