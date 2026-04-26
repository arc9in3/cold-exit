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

// Per-merchant display labels for the upgrades panel. The bear is
// kept intentionally vague — the player can spend on it without
// knowing exactly what the upgrade buys.
const MERCHANT_LABELS = {
  merchant:     { name: 'General Store',   desc: 'Mixed stock — weapons, gear, attachments, consumables.' },
  healer:       { name: 'Healer',          desc: 'Bandages, medkits, stims, adrenaline.' },
  gunsmith:     { name: 'Gunsmith',        desc: 'Weapons + attachments. Repairs broken guns.' },
  armorer:      { name: 'Armorer',         desc: 'Armor + gear. Repairs broken armor.' },
  tailor:       { name: 'Tailor',          desc: 'Cloth + gear pieces, slightly cheaper than retail.' },
  relicSeller:  { name: 'Relic Seller',    desc: 'Permanent run-altering artifact scrolls.' },
  blackMarket:  { name: 'Black Market',    desc: 'Premium high-rarity weapons + gear at a steep markup.' },
  bearMerchant: { name: 'Mysterious World ???', desc: 'Whispers say the offerings here are not what they seem.' },
};

export class StoreUpgradeUI {
  constructor({ getChips, spendChips, getState, setState, onClose,
                getPouchSlots, buyPouchSlot, pouchNextCost, pouchMax,
                getMerchantUpgrades, setMerchantUpgrade, merchantUpgradeNextCost,
                merchantKinds, merchantUpgradeMax,
                getRerollUnlocked, setRerollUnlocked, rerollUnlockCost }) {
    this.getChips = getChips;
    this.spendChips = spendChips;
    this.getState = getState;
    this.setState = setState;
    this.onClose = onClose || (() => {});
    this.getPouchSlots = getPouchSlots || (() => 1);
    this.buyPouchSlot = buyPouchSlot || (() => false);
    this.pouchNextCost = pouchNextCost || (() => null);
    this.pouchMax = pouchMax || 9;
    this.getMerchantUpgrades = getMerchantUpgrades || (() => ({}));
    this.setMerchantUpgrade = setMerchantUpgrade || (() => {});
    this.merchantUpgradeNextCost = merchantUpgradeNextCost || (() => null);
    this.merchantKinds = merchantKinds || [];
    this.merchantUpgradeMax = merchantUpgradeMax || 4;
    this.getRerollUnlocked = getRerollUnlocked || (() => false);
    this.setRerollUnlocked = setRerollUnlocked || (() => {});
    this.rerollUnlockCost = rerollUnlockCost || 220;
    this.root = document.createElement('div');
    this.root.id = 'store-upgrade-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="store-upgrade-card">
        <div id="store-upgrade-header">
          <div>
            <div id="store-upgrade-title">Upgrades</div>
            <div id="store-upgrade-sub">Spend contract chips on persistent run upgrades.</div>
          </div>
          <div id="store-upgrade-chips"></div>
        </div>
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

  // Build a section header element ("RUN START", "MERCHANTS", etc.).
  _section(label) {
    const h = document.createElement('div');
    h.className = 'store-section-title';
    h.textContent = label;
    return h;
  }

  // Build a single upgrade row: name + descriptor on the left, action
  // button on the right. Used by every section so the panel reads as
  // a uniform stack of cards.
  _row({ label, value, desc, btnText, btnDisabled, onBuy }) {
    const row = document.createElement('div');
    row.className = 'store-row';
    const left = document.createElement('div');
    left.className = 'store-row-left';
    left.innerHTML = `
      <div class="store-row-label">${label}${value !== undefined && value !== null && value !== '' ? `: <b>${value}</b>` : ''}</div>
      <div class="store-row-desc">${desc || ''}</div>
    `;
    row.appendChild(left);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-btn store-row-btn';
    btn.textContent = btnText;
    btn.disabled = !!btnDisabled;
    if (onBuy) btn.addEventListener('click', onBuy);
    row.appendChild(btn);
    return row;
  }

  render() {
    const chips = this.getChips();
    const { slots, rarityTier } = this.getState();
    this.chipsEl.innerHTML = `<span class="store-chips-num">${chips}</span> <span class="store-chips-glyph">◆</span>`;
    this.bodyEl.innerHTML = '';

    // ------------ Run start ------------
    this.bodyEl.appendChild(this._section('Run Start'));

    const nextSlotCost = slotUpgradeCost(slots);
    this.bodyEl.appendChild(this._row({
      label: 'Starter Slots',
      value: `${slots} / ${MAX_SLOTS}`,
      desc: 'How many starter-weapon offers you see on a new run.',
      btnText: nextSlotCost == null ? 'Max' : `Buy #${slots + 1} · ${nextSlotCost} ◆`,
      btnDisabled: nextSlotCost == null || chips < nextSlotCost,
      onBuy: () => {
        if (!this.spendChips(nextSlotCost)) return;
        const s = this.getState();
        this.setState({ ...s, slots: s.slots + 1 });
        this.render();
      },
    }));

    const nextTierCost = tierUpgradeCost(rarityTier);
    this.bodyEl.appendChild(this._row({
      label: 'Rarity Tier',
      value: `${rarityTier} / ${MAX_TIER}`,
      desc: _describeRarityTier(rarityTier),
      btnText: nextTierCost == null ? 'Max' : `Tier ${rarityTier + 1} · ${nextTierCost} ◆`,
      btnDisabled: nextTierCost == null || chips < nextTierCost,
      onBuy: () => {
        if (!this.spendChips(nextTierCost)) return;
        const s = this.getState();
        this.setState({ ...s, rarityTier: s.rarityTier + 1 });
        this.render();
      },
    }));

    const pouchSlots = this.getPouchSlots();
    const pouchCost = this.pouchNextCost(pouchSlots);
    this.bodyEl.appendChild(this._row({
      label: 'Pouch Slots',
      value: `${pouchSlots} / ${this.pouchMax}`,
      desc: 'Persistent slot that keeps items through death.',
      btnText: pouchCost == null ? 'Max' : `Buy #${pouchSlots + 1} · ${pouchCost} ◆`,
      btnDisabled: pouchCost == null || chips < pouchCost,
      onBuy: () => {
        if (!this.spendChips(pouchCost)) return;
        this.buyPouchSlot();
        this.render();
      },
    }));

    // ------------ Merchants ------------
    this.bodyEl.appendChild(this._section('Merchants'));
    const upgrades = this.getMerchantUpgrades();
    for (const kind of this.merchantKinds) {
      const lvl = upgrades[kind] | 0;
      const cost = this.merchantUpgradeNextCost(lvl);
      const labelData = MERCHANT_LABELS[kind] || { name: kind, desc: '' };
      this.bodyEl.appendChild(this._row({
        label: labelData.name,
        value: `${lvl} / ${this.merchantUpgradeMax}`,
        desc: labelData.desc + ' Each level adds one item to their stock.',
        btnText: cost == null ? 'Max' : `+1 stock · ${cost} ◆`,
        btnDisabled: cost == null || chips < cost,
        onBuy: () => {
          if (!this.spendChips(cost)) return;
          this.setMerchantUpgrade(kind, lvl + 1);
          this.render();
        },
      }));
    }

    // ------------ Reroll unlock ------------
    this.bodyEl.appendChild(this._section('Perks'));
    const rerollOwned = this.getRerollUnlocked();
    this.bodyEl.appendChild(this._row({
      label: 'Reroll Stock',
      value: rerollOwned ? 'OWNED' : 'LOCKED',
      desc: 'Once unlocked, every shop visit gains a one-time free reroll button. Future updates may add a per-use cost.',
      btnText: rerollOwned ? 'Owned' : `Unlock · ${this.rerollUnlockCost} ◆`,
      btnDisabled: rerollOwned || chips < this.rerollUnlockCost,
      onBuy: () => {
        if (rerollOwned) return;
        if (!this.spendChips(this.rerollUnlockCost)) return;
        this.setRerollUnlocked(true);
        this.render();
      },
    }));

    // Close — wrapped in a sticky bottom shelf so it's always reachable
    // even when the merchant + perk sections push the body past the
    // card's max-height and the inner area scrolls.
    const closeWrap = document.createElement('div');
    closeWrap.style.cssText = 'position:sticky;bottom:0;background:linear-gradient(180deg,rgba(14,16,24,0) 0%,rgba(14,16,24,0.95) 35%,rgba(14,16,24,1) 100%);padding:14px 0 4px;margin-top:14px;';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'menu-btn';
    closeBtn.textContent = 'Back';
    closeBtn.style.width = '100%';
    closeBtn.addEventListener('click', () => { this.hide(); this.onClose(); });
    closeWrap.appendChild(closeBtn);
    this.bodyEl.appendChild(closeWrap);
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
