import { CLASS_DEFS } from './classes.js';

// Shown when a class XP threshold grants a mastery point. Presents the
// offer object { classId, options:[nodeRef,...] } built by
// skill_tree.makeMasteryOffers(). Picking one bumps that node's level.
export class MasteryPickUI {
  constructor(skillTree) {
    this.tree = skillTree;
    this.root = document.createElement('div');
    this.root.id = 'mastery-pick-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="mastery-pick-card">
        <div id="mastery-pick-title">Class Mastery</div>
        <div id="mastery-pick-sub"></div>
        <div id="mastery-pick-options"></div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.titleEl = this.root.querySelector('#mastery-pick-title');
    this.subEl = this.root.querySelector('#mastery-pick-sub');
    this.optionsEl = this.root.querySelector('#mastery-pick-options');
  }

  async show(offer) {
    if (!offer || !offer.options || offer.options.length === 0) return null;
    const def = CLASS_DEFS[offer.classId];
    this.titleEl.textContent = `${def?.label || offer.classId} Mastery +1`;
    this.subEl.textContent = 'Pick an ability — two from this class, one from another.';
    this.optionsEl.innerHTML = '';
    this.root.style.display = 'flex';
    // Filter out options that became maxed since the offer was generated
    // (queued offers can stack: picking node X in offer #1 leaves it stale
    // in offer #2's options list, allowing a "Lv 2/1" double-pick).
    const liveOptions = offer.options.filter((n) => !this.tree.isAtMax(n.id));
    if (liveOptions.length === 0) {
      this.root.style.display = 'none';
      return null;
    }
    return new Promise((resolve) => {
      for (const node of liveOptions) {
        const curLv = this.tree.level(node.id);
        const nextLv = curLv + 1;
        const tier = node.levels[curLv];
        const fromThisClass = node.kind === offer.classId;
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `mastery-card${fromThisClass ? ' own' : ' cross'}`;
        card.innerHTML = `
          <div class="mastery-card-tag">${fromThisClass ? (def?.label || '') : (CLASS_DEFS[node.kind]?.label || node.kind)}</div>
          <div class="mastery-card-name">${node.name}</div>
          <div class="mastery-card-level">Lv ${curLv} → ${nextLv} / ${node.levels.length}</div>
          <div class="mastery-card-desc">${tier?.desc || ''}</div>
        `;
        card.addEventListener('click', () => {
          this.tree.bump(node.id);
          this.root.style.display = 'none';
          resolve(node.id);
        });
        this.optionsEl.appendChild(card);
      }
    });
  }
}
