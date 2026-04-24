// Starting-store meta-progression: players spend persistent contract
// chips to expand how many starter-gear options they see on run start,
// and to bias those options toward higher rarities. Two axes, priced
// separately so players can choose their own upgrade path.
//
// Two views live here:
//  * StoreUpgradeUI  — spend chips on slots / rarity tier.
//  * StoreRollUI     — show `slots` rolled weapons at the current tier;
//                      player picks one, which seeds the new run.
//
// Rolls happen off `tunables.weapons` to stay in sync with live data.

// Chip cost schedules. Slot N costs SLOT_COSTS[N - 4] to unlock (index
// 0 = buying slot #4 from the base 3). Rarity tier T costs TIER_COSTS[T - 1]
// to reach from T - 1. All numbers tunable as we watch playtest data.
const SLOT_COSTS = [10, 18, 28, 42, 60, 85];   // 4, 5, 6, 7, 8, 9
const TIER_COSTS = [12, 24, 48, 96];            // 1, 2, 3, 4
const MAX_SLOTS = 9;
const MIN_SLOTS = 3;
const MAX_TIER  = 4;

// Rarity bias table — each tier is a discrete distribution over rarities.
// Rolls use the matching row at roll time. Keep the rows short so a tier
// bump always offers a visibly different mix (not just a 1% shift).
const RARITY_WEIGHTS = [
  { common: 1.00 },                                                       // 0
  { common: 0.80, uncommon: 0.20 },                                       // 1
  { common: 0.50, uncommon: 0.40, rare: 0.10 },                           // 2
  { uncommon: 0.45, rare: 0.40, epic: 0.15 },                             // 3
  { rare: 0.40, epic: 0.45, legendary: 0.15 },                            // 4
];

export function slotUpgradeCost(currentSlots) {
  if (currentSlots >= MAX_SLOTS) return null;
  return SLOT_COSTS[currentSlots - MIN_SLOTS];
}
export function tierUpgradeCost(currentTier) {
  if (currentTier >= MAX_TIER) return null;
  return TIER_COSTS[currentTier];
}
export function rollRarityForTier(tier) {
  const row = RARITY_WEIGHTS[Math.max(0, Math.min(MAX_TIER, tier | 0))];
  const entries = Object.entries(row);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [name, w] of entries) {
    r -= w;
    if (r <= 0) return name;
  }
  return entries[entries.length - 1][0];
}

export class StoreUpgradeUI {
  constructor({ getChips, spendChips, getState, setState, onClose,
                getPouchSlots, buyPouchSlot, pouchNextCost, pouchMax }) {
    this.getChips = getChips;
    this.spendChips = spendChips;
    this.getState = getState;
    this.setState = setState;
    this.onClose = onClose || (() => {});
    this.getPouchSlots = getPouchSlots || (() => 1);
    this.buyPouchSlot = buyPouchSlot || (() => false);
    this.pouchNextCost = pouchNextCost || (() => null);
    this.pouchMax = pouchMax || 9;
    this.root = document.createElement('div');
    this.root.id = 'store-upgrade-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="store-upgrade-card">
        <div id="store-upgrade-title">Starting Store</div>
        <div id="store-upgrade-sub">Spend contract chips to improve your run-start gear.</div>
        <div id="store-upgrade-chips"></div>
        <div id="store-upgrade-body"></div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.chipsEl = this.root.querySelector('#store-upgrade-chips');
    this.bodyEl = this.root.querySelector('#store-upgrade-body');
    this.visible = false;
  }

  show() { this.visible = true; this.root.style.display = 'flex'; this.render(); }
  hide() { this.visible = false; this.root.style.display = 'none'; }
  isOpen() { return this.visible; }

  render() {
    const chips = this.getChips();
    const { slots, rarityTier } = this.getState();
    this.chipsEl.textContent = `Chips: ${chips} ◆`;
    this.bodyEl.innerHTML = '';

    // Slot row.
    const slotRow = document.createElement('div');
    slotRow.className = 'store-row';
    const nextSlotCost = slotUpgradeCost(slots);
    slotRow.innerHTML = `
      <div class="store-row-label">Slots: <b>${slots}</b> / ${MAX_SLOTS}</div>
      <div class="store-row-desc">How many starter-gear options you see on a new run.</div>
    `;
    const slotBtn = document.createElement('button');
    slotBtn.type = 'button';
    slotBtn.className = 'menu-btn';
    if (nextSlotCost == null) {
      slotBtn.textContent = 'Max slots';
      slotBtn.disabled = true;
    } else {
      slotBtn.textContent = `Buy slot #${slots + 1} (${nextSlotCost} ◆)`;
      slotBtn.disabled = chips < nextSlotCost;
      slotBtn.addEventListener('click', () => {
        if (!this.spendChips(nextSlotCost)) return;
        const s = this.getState();
        this.setState({ ...s, slots: s.slots + 1 });
        this.render();
      });
    }
    slotRow.appendChild(slotBtn);
    this.bodyEl.appendChild(slotRow);

    // Rarity row.
    const rarRow = document.createElement('div');
    rarRow.className = 'store-row';
    const nextTierCost = tierUpgradeCost(rarityTier);
    rarRow.innerHTML = `
      <div class="store-row-label">Rarity Tier: <b>${rarityTier}</b> / ${MAX_TIER}</div>
      <div class="store-row-desc">${_describeRarityTier(rarityTier)}</div>
    `;
    const rarBtn = document.createElement('button');
    rarBtn.type = 'button';
    rarBtn.className = 'menu-btn';
    if (nextTierCost == null) {
      rarBtn.textContent = 'Max tier';
      rarBtn.disabled = true;
    } else {
      rarBtn.textContent = `Upgrade to tier ${rarityTier + 1} (${nextTierCost} ◆)`;
      rarBtn.disabled = chips < nextTierCost;
      rarBtn.addEventListener('click', () => {
        if (!this.spendChips(nextTierCost)) return;
        const s = this.getState();
        this.setState({ ...s, rarityTier: s.rarityTier + 1 });
        this.render();
      });
    }
    rarRow.appendChild(rarBtn);
    this.bodyEl.appendChild(rarRow);

    // Persistent pouch — chip-funded slot expansion. Starts at 1 and
    // caps at `pouchMax` (9). Costs ramp expensively to keep the
    // safebox feeling earned.
    const pouchSlots = this.getPouchSlots();
    const pouchCost = this.pouchNextCost(pouchSlots);
    const pouchRow = document.createElement('div');
    pouchRow.className = 'store-row';
    pouchRow.innerHTML = `
      <div class="store-row-label">Pouch Slots: <b>${pouchSlots}</b> / ${this.pouchMax}</div>
      <div class="store-row-desc">Persistent slot that keeps items through death. Expensive, but permanent — items here survive a wipe.</div>
    `;
    const pouchBtn = document.createElement('button');
    pouchBtn.type = 'button';
    pouchBtn.className = 'menu-btn';
    if (pouchCost == null) {
      pouchBtn.textContent = 'Max pouch';
      pouchBtn.disabled = true;
    } else {
      pouchBtn.textContent = `Buy slot #${pouchSlots + 1} (${pouchCost} ◆)`;
      pouchBtn.disabled = chips < pouchCost;
      pouchBtn.addEventListener('click', () => {
        if (!this.spendChips(pouchCost)) return;
        this.buyPouchSlot();
        this.render();
      });
    }
    pouchRow.appendChild(pouchBtn);
    this.bodyEl.appendChild(pouchRow);

    // Close.
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'menu-btn';
    closeBtn.textContent = 'Back';
    closeBtn.addEventListener('click', () => { this.hide(); this.onClose(); });
    this.bodyEl.appendChild(closeBtn);
  }
}

function _describeRarityTier(tier) {
  switch (tier) {
    case 0: return 'Common only.';
    case 1: return '80% common, 20% uncommon.';
    case 2: return '50% common, 40% uncommon, 10% rare.';
    case 3: return '45% uncommon, 40% rare, 15% epic.';
    case 4: return '40% rare, 45% epic, 15% legendary.';
    default: return '';
  }
}

export class StoreRollUI {
  constructor({ onPick, onCancel }) {
    this.onPick = onPick;
    this.onCancel = onCancel || (() => {});
    this.root = document.createElement('div');
    this.root.id = 'store-roll-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="store-roll-card">
        <div id="store-roll-title">Pick your starting weapon</div>
        <div id="store-roll-sub"></div>
        <div id="store-roll-grid"></div>
        <div id="store-roll-footer"></div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.gridEl = this.root.querySelector('#store-roll-grid');
    this.subEl = this.root.querySelector('#store-roll-sub');
    this.footerEl = this.root.querySelector('#store-roll-footer');
  }

  // offers: array of { name, class, rarity } weapon defs
  show(offers, meta = {}) {
    this.subEl.textContent = `Choose one — slots ${meta.slots || offers.length}, tier ${meta.tier ?? 0}.`;
    this.gridEl.innerHTML = '';
    this.footerEl.innerHTML = '';
    for (const off of offers) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `store-roll-card rarity-${off.rarity || 'common'}`;
      b.innerHTML = `
        <div class="store-roll-name">${off.name}</div>
        <div class="store-roll-class">${off.class}</div>
        <div class="store-roll-rarity">${off.rarity}</div>
      `;
      b.addEventListener('click', () => {
        this.root.style.display = 'none';
        this.onPick?.(off);
      });
      this.gridEl.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'menu-btn';
    cancel.textContent = 'Back';
    cancel.addEventListener('click', () => {
      this.root.style.display = 'none';
      this.onCancel?.();
    });
    this.footerEl.appendChild(cancel);
    this.root.style.display = 'flex';
  }

  hide() { this.root.style.display = 'none'; }
  isOpen() { return this.root.style.display !== 'none'; }
}
