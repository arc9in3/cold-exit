import { SKILL_NODES, generalNodes, classNodes } from './skill_tree.js';
import { CLASS_DEFS, CLASS_IDS, CLASS_THRESHOLDS } from './classes.js';

const DISCIPLINES = [
  { id: 'stealth',   label: 'Stealth',   icon: '◐' },
  { id: 'precision', label: 'Precision', icon: '◎' },
  { id: 'toughness', label: 'Toughness', icon: '♥' },
  { id: 'combat',    label: 'Combat',    icon: '⚔' },
  { id: 'utility',   label: 'Utility',   icon: '⛀' },
  { id: 'classes',   label: 'Classes',   icon: '◇' },
];

export class PerkUI {
  constructor({ tree, getPoints, spendPoints, classMastery, onClose }) {
    this.tree = tree;
    this.getPoints = getPoints;
    this.spendPoints = spendPoints;
    this.classMastery = classMastery;
    this.onClose = onClose;
    this.visible = false;
    this._tab = 'stealth';
    this._rafId = null;

    this.root = document.createElement('div');
    this.root.id = 'perk-root';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
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

  _discNodes(discId) {
    return generalNodes().filter(n => n.disc === discId);
  }

  // Compute row → [nodes] layout using prerequisite depth within the discipline.
  _computeLayout(nodes) {
    const ids = new Set(nodes.map(n => n.id));
    const depth = {};
    const getDepth = (id) => {
      if (id in depth) return depth[id];
      const node = SKILL_NODES[id];
      if (!node) return (depth[id] = 0);
      const discReqs = (node.requires || []).filter(r => ids.has(r.id));
      if (!discReqs.length) return (depth[id] = 0);
      return (depth[id] = 1 + Math.max(...discReqs.map(r => getDepth(r.id))));
    };
    for (const n of nodes) getDepth(n.id);
    const rows = {};
    const maxRow = 0;
    for (const n of nodes) {
      const d = depth[n.id];
      if (!rows[d]) rows[d] = [];
      rows[d].push(n);
    }
    void maxRow;
    return { depth, rows };
  }

  _renderNodeCard(node) {
    const lv = this.tree.level(node.id);
    const maxLv = node.levels.length;
    const atMax = lv >= maxLv;
    const tier = atMax ? node.levels[maxLv - 1] : node.levels[lv];
    const cost = atMax ? 0 : tier.cost;
    const sp = this.getPoints();
    const reqMet = this.tree.requirementsMet(node);
    const canBuy = !atMax && reqMet && sp >= cost;

    // Build requirement label
    const reqParts = (node.requires || []).map(r => {
      const met = this.tree.level(r.id) >= r.level;
      const name = SKILL_NODES[r.id]?.name ?? r.id;
      return `<span class="pt-req ${met ? 'met' : 'miss'}">${name} L${r.level}</span>`;
    });

    const card = document.createElement('div');
    card.className = [
      'pt-node',
      atMax ? 'owned' : '',
      !reqMet && !atMax ? 'locked' : '',
      !canBuy && !atMax && reqMet ? 'cant-buy' : '',
    ].filter(Boolean).join(' ');
    card.dataset.nodeId = node.id;
    card.innerHTML = `
      <div class="pt-node-top">
        <span class="pt-node-icon">${node.icon || '◇'}</span>
        <span class="pt-node-name">${node.name}</span>
        <span class="pt-node-lv">Lv ${lv}/${maxLv}</span>
      </div>
      <div class="pt-node-desc">${tier.desc}</div>
      ${reqParts.length ? `<div class="pt-node-reqs">${reqParts.join(' · ')}</div>` : ''}
      <div class="pt-node-cost">${atMax ? '<span class="pt-max">MAX</span>' : `${cost} SP`}</div>
    `;
    if (canBuy) card.addEventListener('click', () => this._buy(node.id));
    return card;
  }

  _renderDiscTab(discId) {
    const nodes = this._discNodes(discId);
    if (!nodes.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#6f6754;padding:40px;text-align:center;font-size:12px';
      empty.textContent = 'No nodes in this discipline.';
      return empty;
    }
    const { rows } = this._computeLayout(nodes);
    const container = document.createElement('div');
    container.className = 'pt-disc-tree';

    const maxDepth = Math.max(...Object.keys(rows).map(Number));
    for (let d = 0; d <= maxDepth; d++) {
      if (!rows[d]) continue;
      const row = document.createElement('div');
      row.className = 'pt-disc-row';
      for (const node of rows[d]) {
        const cell = document.createElement('div');
        cell.className = 'pt-disc-cell';
        cell.appendChild(this._renderNodeCard(node));
        row.appendChild(cell);
      }
      container.appendChild(row);
    }

    // Draw bezier connectors after paint
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame(() => this._drawConnectors(container, nodes));
    return container;
  }

  _drawConnectors(container, nodes) {
    container.querySelectorAll('.pt-svg').forEach(e => e.remove());
    const ids = new Set(nodes.map(n => n.id));
    const containerRect = container.getBoundingClientRect();
    if (!containerRect.width) return;

    const lines = [];
    for (const node of nodes) {
      for (const req of node.requires || []) {
        if (!ids.has(req.id)) continue;
        const fromEl = container.querySelector(`[data-node-id="${req.id}"]`);
        const toEl   = container.querySelector(`[data-node-id="${node.id}"]`);
        if (!fromEl || !toEl) continue;
        const fR = fromEl.getBoundingClientRect();
        const tR = toEl.getBoundingClientRect();
        lines.push({
          fx: fR.left + fR.width / 2 - containerRect.left,
          fy: fR.bottom - containerRect.top,
          tx: tR.left + tR.width / 2 - containerRect.left,
          ty: tR.top  - containerRect.top,
        });
      }
    }
    if (!lines.length) return;

    const W = container.offsetWidth;
    const H = container.offsetHeight;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'pt-svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px;pointer-events:none;overflow:visible`;
    for (const { fx, fy, tx, ty } of lines) {
      const my = (fy + ty) / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${fx},${fy} C${fx},${my} ${tx},${my} ${tx},${ty}`);
      path.setAttribute('stroke', '#4a3a6a');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-dasharray', '5 3');
      path.setAttribute('fill', 'none');
      svg.appendChild(path);
    }
    container.style.position = 'relative';
    container.appendChild(svg);
  }

  _renderClassesTab() {
    const container = document.createElement('div');
    container.className = 'pt-classes';
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
      const tiersWrap = document.createElement('div');
      tiersWrap.className = 'class-tiers';
      for (const t of def.levels) {
        const owned = lv >= t.level;
        const row = document.createElement('div');
        row.className = `class-tier-row${owned ? ' owned' : ''}${t.level === 5 ? ' capstone' : ''}`;
        row.innerHTML = `
          <span class="class-tier-tag">L${t.level}${t.level === 5 ? ' ★' : ''}</span>
          <span class="class-tier-name">${t.name}</span>
          <span class="class-tier-desc">${t.desc}</span>
        `;
        tiersWrap.appendChild(row);
      }
      section.appendChild(tiersWrap);
      for (const node of classNodes(cid)) {
        const nlv = this.tree.level(node.id);
        const maxLv = node.levels.length;
        const atMax = nlv >= maxLv;
        const tier = atMax ? node.levels[maxLv - 1] : node.levels[nlv];
        const reqMet = this.tree.requirementsMet(node);
        const row = document.createElement('div');
        row.className = `perk-row class${atMax ? ' owned' : ''}${!reqMet && !atMax ? ' locked' : ''}`;
        const reqText = (node.requires || []).map(r =>
          `<span class="req ${this.tree.level(r.id) >= r.level ? 'met' : 'missing'}">${SKILL_NODES[r.id]?.name ?? r.id} L${r.level}</span>`
        ).join(' · ');
        row.innerHTML = `
          <div class="perk-icon">◇</div>
          <div class="perk-main">
            <div class="perk-name">${node.name} <span class="perk-lv">Lv ${nlv}/${maxLv}</span></div>
            <div class="perk-desc">${tier.desc}</div>
            ${reqText ? `<div class="perk-req">requires ${reqText}</div>` : ''}
          </div>
          <div class="perk-cost">${atMax ? 'MAX' : 'mastery'}</div>
        `;
        section.appendChild(row);
      }
      container.appendChild(section);
    }
    return container;
  }

  render() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    this.root.innerHTML = '';

    const card = document.createElement('div');
    card.id = 'perk-card';

    // Header
    const header = document.createElement('div');
    header.id = 'perk-header';
    header.innerHTML = `
      <div id="perk-title">Skills</div>
      <div id="perk-points"><span>SP</span> <b>${this.getPoints()}</b></div>
      <button id="perk-close" type="button">✕</button>
    `;
    header.querySelector('#perk-close').addEventListener('click', () => this.hide());
    card.appendChild(header);

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'pt-tabs';
    for (const disc of DISCIPLINES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `pt-tab${this._tab === disc.id ? ' active' : ''}`;
      btn.textContent = `${disc.icon} ${disc.label}`;
      btn.addEventListener('click', () => { this._tab = disc.id; this.render(); });
      tabs.appendChild(btn);
    }
    card.appendChild(tabs);

    // Content
    const content = document.createElement('div');
    content.id = 'perk-content';
    content.appendChild(
      this._tab === 'classes' ? this._renderClassesTab() : this._renderDiscTab(this._tab)
    );
    card.appendChild(content);

    this.root.appendChild(card);
  }
}
