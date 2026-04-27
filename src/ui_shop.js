import * as THREE from 'three';
import { inferRarity, TYPE_ICONS } from './inventory.js';
import { renderItemCell } from './ui_item_cell.js';
import { tunables } from './tunables.js';
import { GridContainer, stampItemDims } from './grid_container.js';
import { thumbnailFor } from './item_thumbnails.js';
import { buildRig, initAnim, updateAnim } from './actor_rig.js';
import { KEEPER_PALETTE } from './level.js';
import { snapshotToDataURL } from './snapshot_renderer.js';

// Offscreen portrait renderer — one per shopkeeper kind, cached as a
// data URL so opening the same shop twice doesn't re-render. Uses
// the exact same rig builder the world NPC uses so portrait and
// in-world avatar stay visually in lock-step. If the palette for a
// kind changes, the cache can be busted by clearing this Map.
const _portraitCache = new Map();
function keeperPortrait(kind) {
  if (_portraitCache.has(kind)) return _portraitCache.get(kind);
  const palette = KEEPER_PALETTE[kind] || KEEPER_PALETTE.merchant;
  const W = 180, H = 220;
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(2, 4, 3); scene.add(key);
  const fill = new THREE.DirectionalLight(0x8fbaff, 0.35); fill.position.set(-2, 2, -1); scene.add(fill);
  const rig = buildRig({
    scale: 0.78,
    bodyColor: palette.body,
    headColor: palette.skin,
    legColor:  palette.pants,
    armColor:  palette.body,
    handColor: palette.skin,
    gearColor: palette.gear,
    bootColor: palette.boots,
  });
  initAnim(rig);
  // Tick once at dt=0 so the rig resolves to its idle pose before we
  // snapshot (otherwise some joint rotations are still at construction
  // defaults and the silhouette looks off).
  updateAnim(rig, { speed: 0, aiming: 0, aimYaw: 0, aimPitch: 0 }, 0.016);
  scene.add(rig.group);
  // Camera framed on the character's upper torso + head — classic
  // portrait composition. Slightly-elevated to avoid a neck-up look.
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 20);
  camera.position.set(0.0, 1.55, 2.6);
  camera.lookAt(0.0, 1.35, 0.0);
  // Single shared offscreen renderer (snapshot_renderer.js) handles
  // every kind. Previously this function spawned a fresh WebGLRenderer
  // per keeper kind — eight kinds × dozens of shop visits accumulated
  // dead contexts toward the browser's ~16-context cap.
  const url = snapshotToDataURL(scene, camera, W, H);
  if (url) _portraitCache.set(kind, url);
  return url || '';
}

// Shop-side grid sizing. Tiles share the Tarkov-style footprint look
// with the inventory / loot modals; price badges overlay each tile.
const SHOP_STOCK_W = 5;
const SHOP_STOCK_H = 4;
const SHOP_BUYBACK_W = 5;
const SHOP_BUYBACK_H = 3;
const SHOP_BAG_W = 4;
const SHOP_BAG_H = 6;
const SHOP_CELL_PX = 44;
const SHOP_CELL_GAP = 2;

// Per-affix price weight. Damage / move speed / fire rate / crit sit at
// the top because they directly raise kill efficiency. Defense and
// stamina affixes are cheaper because they extend survival without
// changing DPS. Set-piece marks are priced high because they anchor a
// build around a specific gear combination.
//
// Each affix contributes `weight * (rollValue / 10)` as a multiplicative
// premium on base price, so a big moveSpeed roll is worth more than a
// small one in the same way sellable stat sticks scale in aRPGs.
const AFFIX_PRICE_WEIGHT = {
  rangedDmg:    0.09,
  meleeDmg:     0.09,
  moveSpeed:    0.08,
  knockback:    0.04,
  maxHealth:    0.04,
  dmgReduction: 0.04,
  maxStamina:   0.025,
  staminaRegen: 0.025,
  setMark:      0.12,  // set pieces anchor builds — coveted
};

// Rolled perks tier up rarity effectively; each one adds a flat premium.
// Higher count (legendary-only 3-perk rolls) multiplies the premium.
const PERK_PRICE_PER = 0.18;

function _affixPerkPremium(item) {
  let premium = 0;
  if (item.affixes && item.affixes.length) {
    for (const a of item.affixes) {
      const w = AFFIX_PRICE_WEIGHT[a.kind] ?? 0.02;
      const v = typeof a.value === 'number' ? Math.max(1, a.value) : 10;
      premium += w * (v / 10);
    }
  }
  if (item.perks && item.perks.length) {
    premium += item.perks.length * PERK_PRICE_PER;
  }
  return premium;
}

// `priceFor` returns the merchant-facing BUY price and honours per-item
// `priceMult` fluctuations rolled at stock time, plus a premium for
// affixes + perks that reflects how strong the roll is.
export function priceFor(item, shopMult = 1) {
  if (item.type === 'relic') {
    // Artifact prices are fixed premium amounts on the ARTIFACT_DEFS entry.
    const def = item.artifactPrice ?? item.basePrice;
    const base = def ?? 4000;
    return Math.max(1, Math.round(base * (item.priceMult ?? 1) * shopMult));
  }
  if (item.type === 'junk' && typeof item.sellValue === 'number') {
    const mult = item.priceMult ?? 1;
    return Math.max(1, Math.round(item.sellValue * mult * shopMult));
  }
  const base = tunables.currency.basePrice[inferRarity(item)] ?? 25;
  let price = base;
  if (item.type === 'consumable') price = Math.round(base * 0.5);
  else if (item.type === 'attachment') price = Math.round(base * 1.2);
  const mult = (item.priceMult ?? 1) * (1 + _affixPerkPremium(item));
  return Math.max(1, Math.round(price * mult * shopMult));
}
// Cost to repair a broken item. Scales with the item's full buy price
// (including the floor's shop multiplier) so a rare epic costs serious
// credits to bring back to working condition. ~30% of buy is the
// pricing target — cheaper than re-buying, but a real economic dent.
export function repairPriceFor(item, shopMult = 1) {
  if (!item) return 0;
  const base = priceFor(item, shopMult);
  return Math.max(1, Math.round(base * 0.30));
}

// Sell price uses the unfluxed base so selling is predictable. Junk
// sells at full unfluxed `sellValue`. Stack-aware — selling a stack
// of N junk pays N × sellValue, and a stack of N consumables pays
// N × per-unit price (so the player isn't penalised for having
// merged stacks). Broken gear takes a steep discount because no
// merchant pays full coin for a busted weapon or shredded vest —
// player should usually repair-then-sell or just dump the item.
const BROKEN_SELL_MULT = 0.15;
export function sellPriceFor(item) {
  const count = (item?.count | 0) || 1;
  if (item.type === 'junk' && typeof item.sellValue === 'number') {
    return Math.max(1, item.sellValue * count);
  }
  const base = tunables.currency.basePrice[inferRarity(item)] ?? 25;
  let rawBuy = base;
  if (item.type === 'consumable') rawBuy = Math.round(base * 0.5);
  else if (item.type === 'attachment') rawBuy = Math.round(base * 1.2);
  let price = Math.round(rawBuy * tunables.currency.sellMult * count);
  if (item.durability && item.durability.current <= 0) {
    price = Math.round(price * BROKEN_SELL_MULT);
  }
  return Math.max(1, price);
}

export class ShopUI {
  constructor({ inventory, getCredits, spendCredits, earnCredits, onClose, onBearTrade, onAcquireArtifact, getShopMult, getRerollUnlocked, onReroll, onSpecialBearTrade }) {
    this.inventory = inventory;
    this.getCredits = getCredits;
    this.spendCredits = spendCredits;
    this.earnCredits = earnCredits;
    this.onClose = onClose;
    this.onBearTrade = onBearTrade;
    this.onAcquireArtifact = onAcquireArtifact;
    this.getShopMult = getShopMult || (() => 1);
    this.getRerollUnlocked = getRerollUnlocked || (() => false);
    this.onReroll = onReroll || (() => false);
    this.onSpecialBearTrade = onSpecialBearTrade || (() => false);
    this.merchant = null;      // current NPC being traded with

    this.root = document.createElement('div');
    this.root.id = 'shop-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="shop-card">
        <div id="shop-header">
          <div id="shop-title">MERCHANT</div>
          <div id="shop-credits"></div>
          <button id="shop-close" type="button">✕</button>
        </div>
        <div id="shop-body">
          <div id="shop-keeper" class="shop-col">
            <div id="shop-keeper-portrait"></div>
            <div id="shop-keeper-name"></div>
            <div id="shop-keeper-flavor"></div>
            <div id="shop-trade" style="display:none"></div>
          </div>
          <div class="shop-col">
            <div class="inv-heading" style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <span>For Sale</span>
              <button id="shop-reroll" type="button" style="display:none;padding:4px 10px;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;background:rgba(120,160,210,0.18);color:#bcd4ee;border:1px solid rgba(120,160,210,0.55);border-radius:2px;cursor:pointer;font-family:inherit;font-weight:700;">Reroll Stock</button>
            </div>
            <div id="shop-stock"></div>
            <div class="inv-heading" id="shop-buyback-heading" style="display:none">Buyback</div>
            <div id="shop-buyback"></div>
          </div>
          <div class="shop-col">
            <div class="inv-heading">Your Backpack</div>
            <div id="shop-bag-actions" style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
              <button id="shop-sell-junk" type="button" class="shop-bulk-btn" style="flex:1;min-width:130px;padding:6px 10px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;background:rgba(143,191,112,0.18);color:#cfe5ad;border:1px solid rgba(143,191,112,0.55);border-radius:2px;cursor:pointer;font-family:inherit;font-weight:700;">Sell All Junk</button>
              <button id="shop-repair-item" type="button" class="shop-bulk-btn" style="flex:1;min-width:130px;padding:6px 10px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;background:rgba(255,160,80,0.18);color:#ffd8a0;border:1px solid rgba(255,160,80,0.55);border-radius:2px;cursor:pointer;font-family:inherit;font-weight:700;">Repair Item</button>
              <button id="shop-repair-all" type="button" class="shop-bulk-btn" style="flex:1;min-width:130px;padding:6px 10px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;background:rgba(255,80,80,0.18);color:#ffd0d0;border:1px solid rgba(255,80,80,0.55);border-radius:2px;cursor:pointer;font-family:inherit;font-weight:700;">Repair All</button>
            </div>
            <div id="shop-bag"></div>
          </div>
        </div>
        <div id="shop-footer">Left-click to inspect · right-click or drag to trade · <b>${Math.round(tunables.currency.sellMult * 100)}%</b> sell value · buyback refunds the sale</div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.stockEl = this.root.querySelector('#shop-stock');
    this.bagEl = this.root.querySelector('#shop-bag');
    this.buybackEl = this.root.querySelector('#shop-buyback');
    this.buybackHeadEl = this.root.querySelector('#shop-buyback-heading');
    this.creditsEl = this.root.querySelector('#shop-credits');
    this.tradeEl = this.root.querySelector('#shop-trade');
    this.titleEl = this.root.querySelector('#shop-title');
    this.keeperPortraitEl = this.root.querySelector('#shop-keeper-portrait');
    this.keeperNameEl = this.root.querySelector('#shop-keeper-name');
    this.keeperFlavorEl = this.root.querySelector('#shop-keeper-flavor');
    this.root.querySelector('#shop-close').addEventListener('click', () => this.hide());
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.hide(); });
    // Bulk-action buttons — wired once at construct, gated per-merchant
    // inside their handlers.
    this.sellJunkBtn = this.root.querySelector('#shop-sell-junk');
    this.repairAllBtn = this.root.querySelector('#shop-repair-all');
    this.sellJunkBtn.addEventListener('click', () => this._sellAllJunk());
    this.repairAllBtn.addEventListener('click', () => this._repairAll());
    this.repairItemBtn = this.root.querySelector('#shop-repair-item');
    this.repairItemBtn.addEventListener('click', () => this._openRepairItemModal());
    this.rerollBtn = this.root.querySelector('#shop-reroll');
    this.rerollBtn.addEventListener('click', () => {
      if (!this.merchant) return;
      const ok = this.onReroll(this.merchant);
      if (ok) this.render();
    });
    // In-session sold items — cleared when the merchant is closed so each
    // visit is an independent buyback window.
    this.buyback = [];
    this._drag = null;
  }

  open(merchant) {
    this.merchant = merchant;
    this.buyback = [];  // fresh session — no previous accidents to undo
    this.root.style.display = 'flex';
    this.render();
  }
  hide() {
    this.root.style.display = 'none';
    this.merchant = null;
    this.buyback = [];
    if (this._repairModal) this._repairModal.root.style.display = 'none';
    if (this.onClose) this.onClose();
  }
  isOpen() { return this.merchant !== null; }

  _renderTrade() {
    if (!this.tradeEl) return;
    if (this.merchant?.kind !== 'bearMerchant') {
      this.tradeEl.style.display = 'none';
      this.tradeEl.innerHTML = '';
      return;
    }
    const toyIds = ['toy_joke_bear', 'toy_beary_doll', 'toy_sleep_duck', 'toy_duck_statue'];
    const labels = { toy_joke_bear: 'Joke Bear', toy_beary_doll: 'Beary Doll',
                     toy_sleep_duck: 'Sleep Duck', toy_duck_statue: 'Duck Statue' };
    const have = new Set();
    for (const it of this.inventory.backpack) {
      if (it && toyIds.includes(it.id)) have.add(it.id);
    }
    const tokens = toyIds.map(id => {
      const got = have.has(id);
      return `<span class="bear-token ${got ? 'got' : 'missing'}">${got ? '✓' : '·'} ${labels[id]}</span>`;
    }).join('');
    const complete = have.size === 4;
    this.tradeEl.style.display = 'block';
    this.tradeEl.innerHTML = `
      <div class="bear-prompt">"Bring all four of my little friends. I have something for a hunter who gathers them."</div>
      <div class="bear-tokens">${tokens}</div>
      ${complete
        ? '<button type="button" class="bear-trade-btn">Trade All 4 Toys for Jessica\'s Rage</button>'
        : `<div class="bear-progress">${have.size} / 4 collected</div>`}
    `;
    const btn = this.tradeEl.querySelector('.bear-trade-btn');
    if (btn) btn.addEventListener('click', () => {
      if (!this.onBearTrade) return;
      if (this.onBearTrade(toyIds)) this.render();
    });
  }

  _buy(idx) {
    const m = this.merchant;
    if (!m || !m.stock) return;
    const item = m.stock[idx];
    if (!item) return;
    const price = priceFor(item, this.getShopMult());
    if (this.getCredits() < price) return;
    if (!this.spendCredits(price)) return;
    // Artifact scrolls aren't inventory items — they grant a permanent
    // run-long buff via the passed-in hook instead of sitting in a bag.
    if (item.type === 'relic' && this.onAcquireArtifact) {
      const ok = this.onAcquireArtifact(item.artifactId);
      if (!ok) { this.earnCredits(price); return; }
      m.stock[idx] = null;
      this.render();
      return;
    }
    const result = this.inventory.add(item);
    if (!result.placed) {
      // Inventory full — refund.
      this.earnCredits(price);
      return;
    }
    m.stock[idx] = null;
    this.render();
  }

  _sell(idx) {
    const item = this.inventory.backpack[idx];
    if (!item) return;
    // Mark to Keep — refuse the sale outright. Player toggles in the
    // details panel (J/K hotkeys or the action-bar buttons) to clear.
    if (item.markedKeep) {
      this._flash(`${item.name} is marked KEEP — sale blocked.`);
      return;
    }
    // Special bear-merchant trades. Each id is a one-off contract:
    //   thr_the_gift       → mythic-run unlock (1c).
    //   junk_rocket_ticket → grants the Rocket Shoes relic (no payout).
    // Item consumed on success, no buyback. onSpecialBearTrade returns
    // false if the trade can't fire (e.g. relic already owned), in
    // which case we fall through to the normal sell path.
    const isBearSpecial = this.merchant?.kind === 'bearMerchant'
      && (item.id === 'thr_the_gift'
          || item.id === 'junk_rocket_ticket'
          || item.id === 'toy_demon_bear');
    if (isBearSpecial) {
      if (this.onSpecialBearTrade(item)) {
        this.inventory.takeFromBackpack(idx);
        if (item.id === 'thr_the_gift') this.earnCredits(1);
        this.render();
        return;
      }
    }
    const price = sellPriceFor(item);
    this.inventory.takeFromBackpack(idx);
    this.earnCredits(price);
    // Keep it available for buyback at the same price the player sold for.
    this.buyback.unshift({ item, price });
    if (this.buyback.length > 12) this.buyback.pop();
    this.render();
  }

  // Per-merchant repair specialty. Gunsmiths repair weapons (ranged
  // + melee); armorers handle armor + body gear (chest, head, hands,
  // belt, pants, boots, ears, face, backpack). The general merchant
  // and other shops can't repair anything — players have to seek out
  // the right specialist.
  _canRepair(item) {
    if (!this.merchant || !item || !item.durability) return false;
    const kind = this.merchant.kind;
    const t = item.type;
    if (kind === 'gunsmith') return t === 'ranged' || t === 'melee';
    if (kind === 'armorer')  return t === 'armor'  || t === 'gear' || t === 'backpack' || item.slot === 'backpack';
    return false;
  }

  // Repair a broken item — restore durability to max in exchange for
  // a fraction of the item's buy price. Refuses if the current
  // merchant doesn't repair this item type, the item isn't actually
  // broken, or the player can't afford it.
  _repair(item) {
    if (!this._canRepair(item)) return;
    // Repair-any damaged item (not just fully broken). Skip full-
    // durability ones so a misclick can't waste credits.
    if (!item.durability || item.durability.current >= item.durability.max) return;
    const cost = repairPriceFor(item, this.getShopMult());
    if (this.getCredits() < cost) return;
    if (!this.spendCredits(cost)) return;
    item.durability.current = item.durability.max;
    if (typeof window.__recomputeStats === 'function') window.__recomputeStats();
    this.render();
  }

  // Per-item repair modal — lists every damaged item the current
  // merchant can repair with individual prices + Repair buttons.
  _openRepairItemModal() {
    const list = this._damagedRepairables();
    if (list.length === 0) return;
    if (!this._repairModal) {
      const root = document.createElement('div');
      root.id = 'shop-repair-modal';
      Object.assign(root.style, {
        position: 'fixed', inset: '0',
        display: 'none', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)', zIndex: '70',
      });
      const card = document.createElement('div');
      Object.assign(card.style, {
        background: 'linear-gradient(180deg, #181b21 0%, #0e1018 100%)',
        border: '1px solid #c9a87a', borderRadius: '4px',
        padding: '20px 22px', minWidth: '420px', maxWidth: '560px',
        maxHeight: '78vh', overflowY: 'auto',
        color: '#e8dfc8',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      });
      card.innerHTML = `
        <div style="font-size:16px;font-weight:700;letter-spacing:3px;color:#c9a87a;text-transform:uppercase;margin-bottom:14px;text-align:center;">Repair Item</div>
        <div id="shop-repair-list" style="display:flex;flex-direction:column;gap:6px;"></div>
        <button id="shop-repair-close" type="button" style="margin-top:14px;width:100%;padding:8px;background:rgba(125,167,200,0.15);color:#cbd6e2;border:1px solid rgba(125,167,200,0.55);border-radius:3px;cursor:pointer;font-family:inherit;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Back</button>
      `;
      root.appendChild(card);
      document.body.appendChild(root);
      this._repairModal = { root, card, listEl: card.querySelector('#shop-repair-list') };
      card.querySelector('#shop-repair-close').addEventListener('click', () => this._closeRepairItemModal());
      root.addEventListener('mousedown', (e) => { if (e.target === root) this._closeRepairItemModal(); });
    }
    this._repairModal.root.style.display = 'flex';
    this._renderRepairItemModal();
  }
  _renderRepairItemModal() {
    if (!this._repairModal) return;
    const list = this._damagedRepairables();
    const credits = this.getCredits();
    const listEl = this._repairModal.listEl;
    listEl.innerHTML = '';
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:#7a8290;padding:18px 0;font-size:12px;';
      empty.textContent = 'No damaged items to repair.';
      listEl.appendChild(empty);
      return;
    }
    for (const entry of list) {
      const { item, source, cost } = entry;
      const dur = item.durability;
      const pct = Math.max(0, Math.min(1, dur.current / dur.max));
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #2c323c;border-radius:3px;background:#15181f;';
      const left = document.createElement('div');
      left.style.cssText = 'flex:1;min-width:0;';
      const name = document.createElement('div');
      name.style.cssText = 'font-size:12px;color:#e8dfc8;letter-spacing:1px;margin-bottom:4px;';
      const cleanName = String(item.name || 'item').replace(/<[^>]+>/g, '');
      const sourceLabel = source === 'backpack' ? '' : ` · equipped (${source})`;
      name.textContent = cleanName + sourceLabel;
      const bar = document.createElement('div');
      bar.style.cssText = 'height:6px;background:#1a1d24;border-radius:1px;overflow:hidden;';
      const fill = document.createElement('div');
      const color = pct > 0.6 ? '#6abe8a' : pct > 0.3 ? '#e0c040' : '#d24040';
      fill.style.cssText = `width:${Math.round(pct * 100)}%;height:100%;background:${color};`;
      bar.appendChild(fill);
      left.appendChild(name);
      left.appendChild(bar);
      row.appendChild(left);
      const btn = document.createElement('button');
      btn.type = 'button';
      const canAfford = credits >= cost;
      btn.textContent = `${cost}c`;
      btn.disabled = !canAfford;
      btn.style.cssText = `padding:8px 14px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;background:${canAfford ? 'rgba(255,160,80,0.18)' : 'rgba(80,80,80,0.18)'};color:${canAfford ? '#ffd8a0' : '#6a7280'};border:1px solid ${canAfford ? 'rgba(255,160,80,0.55)' : 'rgba(80,80,80,0.3)'};border-radius:3px;cursor:${canAfford ? 'pointer' : 'default'};font-family:inherit;font-weight:700;min-width:64px;`;
      if (canAfford) {
        btn.addEventListener('click', () => {
          this._repair(item);
          this._renderRepairItemModal();
        });
      }
      row.appendChild(btn);
      listEl.appendChild(row);
    }
  }
  _closeRepairItemModal() {
    if (this._repairModal) this._repairModal.root.style.display = 'none';
    this.render();
  }

  // Build the full list of damaged items (backpack + equipped) the
  // current merchant can repair. Used by the per-item modal AND the
  // dynamic Repair All cost preview.
  _damagedRepairables() {
    if (!this.merchant || !this.inventory) return [];
    const out = [];
    const consider = (item, source) => {
      if (!this._canRepair(item)) return;
      if (!item.durability || item.durability.current >= item.durability.max) return;
      out.push({
        item, source,
        cost: repairPriceFor(item, this.getShopMult()),
      });
    };
    for (const it of (this.inventory.backpack || [])) consider(it, 'backpack');
    if (this.inventory.equipment) {
      for (const slot of Object.keys(this.inventory.equipment)) {
        consider(this.inventory.equipment[slot], slot);
      }
    }
    return out;
  }

  // Sell every junk item in the backpack in one click. Adds each
  // sale to the buyback list so the player can undo if they regret
  // it. Caps the buyback at its existing 12-entry window — older
  // sales fall off as new ones are pushed.
  _sellAllJunk() {
    let sold = 0;
    let totalCredits = 0;
    // Snapshot the indexes first because takeFromBackpack shifts the
    // flat-view array between calls. Walk top-down so removal doesn't
    // invalidate the next index. Includes both type==='junk' AND any
    // item the player explicitly marked as junk (markedJunk: true).
    // markedKeep wins over both — those are skipped no matter what.
    const sellIdxs = [];
    for (let i = 0; i < this.inventory.backpack.length; i++) {
      const it = this.inventory.backpack[i];
      if (!it || it.markedKeep) continue;
      if (it.type === 'junk' || it.markedJunk) sellIdxs.push(i);
    }
    for (let k = sellIdxs.length - 1; k >= 0; k--) {
      const idx = sellIdxs[k];
      const item = this.inventory.backpack[idx];
      if (!item) continue;
      if (item.markedKeep) continue;
      if (!(item.type === 'junk' || item.markedJunk)) continue;
      const price = sellPriceFor(item);
      this.inventory.takeFromBackpack(idx);
      this.earnCredits(price);
      this.buyback.unshift({ item, price });
      if (this.buyback.length > 12) this.buyback.pop();
      sold += 1; totalCredits += price;
    }
    if (sold > 0) this._flash(`Sold ${sold} item${sold === 1 ? '' : 's'} · +${totalCredits}c`);
    this.render();
  }

  // Repair every broken item in the backpack + every equipped slot
  // that this merchant is authorised to repair, paying per-item from
  // the player's credits. Stops cleanly when credits run out (skipped
  // items remain broken). Reports a summary.
  _repairAll() {
    let repaired = 0;
    let totalCost = 0;
    const tryFix = (item) => {
      if (!item || !this._canRepair(item)) return;
      // Damage-any: was current > 0 (broken-only); now repairs every
      // damaged item the merchant can touch.
      if (!item.durability || item.durability.current >= item.durability.max) return;
      const cost = repairPriceFor(item, this.getShopMult());
      if (this.getCredits() < cost) return;
      if (!this.spendCredits(cost)) return;
      item.durability.current = item.durability.max;
      repaired += 1; totalCost += cost;
    };
    for (const it of this.inventory.backpack) tryFix(it);
    // Equipped slots — equipped armor/weapons can also be repaired
    // in place without unequipping, so the player doesn't have to
    // shuffle gear around just to get back to fighting shape.
    for (const slot in this.inventory.equipment) tryFix(this.inventory.equipment[slot]);
    if (repaired > 0) {
      if (typeof window.__recomputeStats === 'function') window.__recomputeStats();
      this._flash(`Repaired ${repaired} · −${totalCost}c`);
    } else {
      this._flash(this.merchant?.kind === 'gunsmith' ? 'No broken weapons to repair'
                : this.merchant?.kind === 'armorer'  ? 'No broken armor to repair'
                : 'This merchant doesn\'t repair gear');
    }
    this.render();
  }

  // Brief on-screen toast — surfaces bulk-action results without
  // requiring the player to look at their credit total.
  _flash(text) {
    const el = document.createElement('div');
    el.className = 'shop-flash';
    el.textContent = text;
    el.style.cssText = 'position:absolute;left:50%;top:36px;transform:translateX(-50%);background:rgba(20,24,32,0.92);color:#ffd27a;border:1px solid #c9a87a;padding:6px 14px;border-radius:3px;font-size:11px;letter-spacing:1.5px;z-index:5;text-transform:uppercase;font-weight:700;pointer-events:none;';
    this.root.querySelector('#shop-card').appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  _buybackAt(i) {
    const entry = this.buyback[i];
    if (!entry) return;
    if (this.getCredits() < entry.price) return;
    if (!this.spendCredits(entry.price)) return;
    const result = this.inventory.add(entry.item);
    if (!result.placed) { this.earnCredits(entry.price); return; }
    this.buyback.splice(i, 1);
    this.render();
  }

  render() {
    if (!this.merchant) return;
    this.creditsEl.textContent = `${this.getCredits()}c`;
    // Bulk-action button visibility — Sell-All-Junk is universal,
    // Repair-All only at the gunsmith / armorer who can actually do
    // the work. Hidden buttons keep their layout slot via display:none
    // so the row doesn't reflow when switching between merchants.
    const kind = this.merchant.kind;
    if (this.repairAllBtn) {
      const canShow = (kind === 'gunsmith' || kind === 'armorer');
      this.repairAllBtn.style.display = canShow ? '' : 'none';
      const baseLabel = kind === 'gunsmith' ? 'Repair All Weapons'
                      : kind === 'armorer'  ? 'Repair All Armor'
                      : 'Repair All';
      // Live cost preview — sum of every damaged repairable item.
      const damaged = canShow ? this._damagedRepairables() : [];
      const total = damaged.reduce((s, e) => s + e.cost, 0);
      this.repairAllBtn.textContent = damaged.length === 0
        ? baseLabel
        : `${baseLabel} · ${total}c`;
      // Disabled-greyed when there's nothing to do or the player
      // can't afford the full sweep.
      const credits = this.getCredits();
      const cantAfford = total > 0 && credits < total;
      this.repairAllBtn.disabled = damaged.length === 0;
      this.repairAllBtn.style.opacity = (damaged.length === 0 || cantAfford) ? '0.55' : '1';
      this.repairAllBtn.style.cursor = damaged.length === 0 ? 'default' : 'pointer';
      this.repairAllBtn.title = cantAfford
        ? `Need ${total}c (you have ${credits}c). Items will be repaired in order until credits run out.`
        : '';
    }
    if (this.repairItemBtn) {
      const canShow = (kind === 'gunsmith' || kind === 'armorer');
      this.repairItemBtn.style.display = canShow ? '' : 'none';
      const damaged = canShow ? this._damagedRepairables() : [];
      this.repairItemBtn.disabled = damaged.length === 0;
      this.repairItemBtn.style.opacity = damaged.length === 0 ? '0.55' : '1';
      this.repairItemBtn.style.cursor = damaged.length === 0 ? 'default' : 'pointer';
      this.repairItemBtn.textContent = damaged.length === 0
        ? 'Repair Item'
        : `Repair Item (${damaged.length})`;
    }
    // Reroll: only when the unlock has been purchased AND this visit
    // hasn't burned its single use. Disabled-greyed if used so the
    // player still sees the affordance.
    if (this.rerollBtn) {
      const unlocked = this.getRerollUnlocked();
      this.rerollBtn.style.display = unlocked ? '' : 'none';
      this.rerollBtn.disabled = !!this.merchant._rerollUsed;
      this.rerollBtn.style.opacity = this.merchant._rerollUsed ? '0.45' : '1';
      this.rerollBtn.style.cursor = this.merchant._rerollUsed ? 'default' : 'pointer';
      this.rerollBtn.textContent = this.merchant._rerollUsed
        ? 'Rerolled'
        : 'Reroll Stock';
    }
    const TITLES = {
      merchant: 'MERCHANT',
      healer: 'HEALER',
      bearMerchant: 'THE GREAT BEAR',
      gunsmith: 'GUNSMITH',
      armorer: 'ARMORER',
      tailor: 'TAILOR',
      relicSeller: 'RELIC SELLER',
      blackMarket: 'BLACK MARKET',
    };
    this.titleEl.textContent = TITLES[this.merchant.kind] || 'MERCHANT';
    this._renderKeeper();
    this._renderTrade();
    // Stock — flat cell list. Shop is intentionally simpler than the
    // inventory/loot grids: left-click to inspect, right-click to buy.
    // No drag-to-rearrange, no footprint layout. Convention matches
    // inventory/loot so muscle memory carries between screens.
    this.stockEl.innerHTML = '';
    this.stockEl.classList.remove('shop-footprint-grid');
    this.stockEl.style.width = '';
    this.stockEl.style.minHeight = '';
    const stock = this.merchant.stock || [];
    if (stock.every(s => !s)) {
      const empty = document.createElement('div');
      empty.className = 'shop-empty';
      empty.textContent = 'Sold out.';
      this.stockEl.appendChild(empty);
    } else {
      stock.forEach((it, idx) => {
        if (!it) return;
        const cell = this._buildCell(it, priceFor(it, this.getShopMult()), 'buy');
        cell.addEventListener('click', () => {
          if (window.__showDetails) window.__showDetails(it);
        });
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this._buy(idx);
        });
        // Drag from shop stock onto the backpack = buy (kept for power
        // users who want the drag target behaviour).
        cell.setAttribute('draggable', 'true');
        cell.addEventListener('dragstart', (e) => {
          this._drag = { from: 'stock', idx, item: it };
          e.dataTransfer.effectAllowed = 'move';
        });
        cell.addEventListener('dragend', () => { this._drag = null; });
        const canAfford = this.getCredits() >= priceFor(it, this.getShopMult());
        if (!canAfford) cell.classList.add('unaffordable');
        this.stockEl.appendChild(cell);
      });
    }

    // Buyback — same flat list style.
    if (this.buybackHeadEl) this.buybackHeadEl.style.display = this.buyback.length ? '' : 'none';
    this.buybackEl.innerHTML = '';
    this.buybackEl.classList.remove('shop-footprint-grid');
    this.buybackEl.style.width = '';
    this.buybackEl.style.minHeight = '';
    this.buyback.forEach((entry, i) => {
      const cell = this._buildCell(entry.item, entry.price, 'buy');
      cell.classList.add('buyback-cell');
      cell.addEventListener('click', () => {
        if (window.__showDetails) window.__showDetails(entry.item);
      });
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._buybackAt(i);
      });
      const canAfford = this.getCredits() >= entry.price;
      if (!canAfford) cell.classList.add('unaffordable');
      this.buybackEl.appendChild(cell);
    });

    // Backpack — drag to shop (or click) to sell; accepts drops from shop stock to buy.
    // Broken items show a repair price ONLY when this merchant can
    // service the item type (gunsmith for weapons, armorer for
    // armor + gear). Otherwise broken items just sell as-is.
    this.bagEl.innerHTML = '';
    let hasAny = false;
    let anyJunk = false;
    let anyRepairable = false;
    for (let i = 0; i < this.inventory.backpack.length; i++) {
      const it = this.inventory.backpack[i];
      if (!it) continue;
      hasAny = true;
      if (it.type === 'junk') anyJunk = true;
      const isBroken = it.durability && it.durability.current <= 0;
      const canRepair = isBroken && this._canRepair(it);
      if (canRepair) anyRepairable = true;
      const action = canRepair ? 'repair' : 'sell';
      const price = canRepair ? repairPriceFor(it, this.getShopMult()) : sellPriceFor(it);
      const cell = this._buildCell(it, price, action);
      if (isBroken) cell.classList.add('shop-cell-broken');
      cell.addEventListener('click', () => {
        if (window.__showDetails) window.__showDetails(it);
      });
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (canRepair) this._repair(it);
        else this._sell(i);
      });
      cell.setAttribute('draggable', 'true');
      cell.addEventListener('dragstart', (e) => {
        this._drag = { from: 'bag', idx: i, item: it };
        document.body.classList.add('ui-grid-dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      cell.addEventListener('dragend', () => {
        this._drag = null;
        document.body.classList.remove('ui-grid-dragging');
      });
      this.bagEl.appendChild(cell);
    }
    if (!hasAny) {
      const empty = document.createElement('div');
      empty.className = 'shop-empty';
      empty.textContent = 'Nothing to sell.';
      this.bagEl.appendChild(empty);
    }

    // Drop targets: drag from bag onto stock column = sell; from stock
    // onto bag column = buy.
    this._wireColumnDrop(this.stockEl.parentElement, 'sell');
    this._wireColumnDrop(this.bagEl.parentElement, 'buy');
  }

  _wireColumnDrop(colEl, kind) {
    if (!colEl || colEl._dropWired) return;
    colEl._dropWired = true;
    colEl.addEventListener('dragover', (e) => {
      if (!this._drag) return;
      if (kind === 'sell' && this._drag.from === 'bag') { e.preventDefault(); colEl.classList.add('drop-ok'); }
      if (kind === 'buy' && this._drag.from === 'stock') { e.preventDefault(); colEl.classList.add('drop-ok'); }
    });
    colEl.addEventListener('dragleave', () => colEl.classList.remove('drop-ok'));
    colEl.addEventListener('drop', (e) => {
      e.preventDefault();
      colEl.classList.remove('drop-ok');
      const d = this._drag;
      if (!d) return;
      if (kind === 'sell' && d.from === 'bag') this._sell(d.idx);
      else if (kind === 'buy' && d.from === 'stock') this._buy(d.idx);
      this._drag = null;
    });
  }

  // Flavor text per merchant kind. The animpic ProfileImages pack only
  // ships zombie portraits, so each keeper uses a CSS-only silhouette
  // glyph for now — swap `glyph` out for a real portrait path once
  // suitable human/robot art lands.
  _renderKeeper() {
    const KEEPERS = {
      merchant:     { glyph: '◆', tone: '#c9a87a', name: 'The Fixer',
        flavor: '"Everything has a price. Some higher than others. Don\'t haggle unless you mean it."' },
      healer:       { glyph: '✚', tone: '#d88080', name: 'The Surgeon',
        flavor: '"You look like you\'ve seen better days. Sit. I\'ll patch what I can — the rest is on you."' },
      bearMerchant: { glyph: '◈', tone: '#ffd27a', name: 'The Great Bear',
        flavor: '"Bring me my little friends. All four. Then — and only then — we talk about what\'s mine to give."' },
      gunsmith:     { glyph: '⌖', tone: '#a0b8d0', name: 'The Gunsmith',
        flavor: '"Tools of the trade. Keep them oiled, keep them fed, and they\'ll keep you upright."' },
      armorer:      { glyph: '⛨', tone: '#8a9db0', name: 'The Armorer',
        flavor: '"Dead men need no armor. Buy now, while the blood is still yours to keep."' },
      tailor:       { glyph: '✂', tone: '#b89a70', name: 'The Tailor',
        flavor: '"Style wins fights too. Let me see what fits — bullet-proof, of course."' },
      relicSeller:  { glyph: '✦', tone: '#b090d0', name: 'The Curator',
        flavor: '"Each piece carries a story. Most stories end badly. Choose wisely."' },
      blackMarket:  { glyph: '☠', tone: '#70b090', name: 'The Broker',
        flavor: '"Questions cost extra. Pay, take your merchandise, and forget my face on the way out."' },
    };
    const k = KEEPERS[this.merchant?.kind] || KEEPERS.merchant;
    // Rendered avatar takes priority over the glyph — falls back to
    // the glyph if portrait generation fails (WebGL error / headless
    // test). `bearMerchant` is a giant bear, not a humanoid; skip the
    // portrait path for it so the glyph stays.
    const kind = this.merchant?.kind;
    let portrait = null;
    if (kind && kind !== 'bearMerchant') {
      try { portrait = keeperPortrait(kind); } catch (_) { portrait = null; }
    }
    this.keeperPortraitEl.innerHTML = portrait
      ? `<img class="shop-keeper-avatar" src="${portrait}" alt="">`
      : `<span class="shop-keeper-glyph" style="color:${k.tone}">${k.glyph}</span>`;
    this.keeperNameEl.textContent = k.name;
    this.keeperNameEl.style.color = k.tone;
    this.keeperFlavorEl.textContent = k.flavor;
  }

  _buildCell(item, price, mode) {
    const cell = document.createElement('div');
    const rarity = inferRarity(item);
    cell.className = `shop-item rarity-${rarity}`;
    // Reuse the shared inventory/loot cell renderer so art, stats, desc,
    // perks, affixes, and durability all look identical to the backpack.
    // Price chip is layered on top via a dedicated column in .shop-item.
    // Repair mode swaps the price chip label so the player understands
    // they're paying TO restore the item, not selling it.
    const priceLabel = mode === 'repair' ? `REPAIR ${price}c` : `${price}c`;
    // Shop cells never show the ⚙ customize button — even on sell /
    // repair tabs where the item is technically owned. Tinkering with
    // attachments inside the merchant flow was confusing (the player
    // can't equip an item that's mid-sale), so kill it across all modes.
    cell.innerHTML = `
      ${renderItemCell(item, null, { owned: false })}
      <div class="shop-price ${mode}">${priceLabel}</div>
    `;
    return cell;
  }
}
