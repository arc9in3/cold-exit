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
  if (item.type === 'artifact-scroll') {
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
// merged stacks).
export function sellPriceFor(item) {
  const count = (item?.count | 0) || 1;
  if (item.type === 'junk' && typeof item.sellValue === 'number') {
    return Math.max(1, item.sellValue * count);
  }
  const base = tunables.currency.basePrice[inferRarity(item)] ?? 25;
  let rawBuy = base;
  if (item.type === 'consumable') rawBuy = Math.round(base * 0.5);
  else if (item.type === 'attachment') rawBuy = Math.round(base * 1.2);
  return Math.max(1, Math.round(rawBuy * tunables.currency.sellMult * count));
}

export class ShopUI {
  constructor({ inventory, getCredits, spendCredits, earnCredits, onClose, onBearTrade, onAcquireArtifact, getShopMult }) {
    this.inventory = inventory;
    this.getCredits = getCredits;
    this.spendCredits = spendCredits;
    this.earnCredits = earnCredits;
    this.onClose = onClose;
    this.onBearTrade = onBearTrade;
    this.onAcquireArtifact = onAcquireArtifact;
    this.getShopMult = getShopMult || (() => 1);
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
            <div class="inv-heading">For Sale</div>
            <div id="shop-stock"></div>
            <div class="inv-heading" id="shop-buyback-heading" style="display:none">Buyback</div>
            <div id="shop-buyback"></div>
          </div>
          <div class="shop-col">
            <div class="inv-heading">Your Backpack</div>
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
    if (item.type === 'artifact-scroll' && this.onAcquireArtifact) {
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
    const price = sellPriceFor(item);
    this.inventory.takeFromBackpack(idx);
    this.earnCredits(price);
    // Keep it available for buyback at the same price the player sold for.
    this.buyback.unshift({ item, price });
    if (this.buyback.length > 12) this.buyback.pop();
    this.render();
  }

  // Repair a broken item — restore durability to max in exchange for
  // a fraction of the item's buy price. No-op if the item isn't
  // actually broken or the player can't afford it. After repair we
  // call back through `onClose`'s recompute path via `__recomputeStats`
  // (exposed on window by main.js) so the freshly-restored stats land
  // immediately rather than waiting for the next equipment change.
  _repair(item) {
    if (!item || !item.durability || item.durability.current > 0) return;
    const cost = repairPriceFor(item, this.getShopMult());
    if (this.getCredits() < cost) return;
    if (!this.spendCredits(cost)) return;
    item.durability.current = item.durability.max;
    if (typeof window.__recomputeStats === 'function') window.__recomputeStats();
    this.render();
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
    // Broken items show a repair price + "REPAIR" badge instead of sell;
    // right-click on a broken item repairs it instead of selling.
    this.bagEl.innerHTML = '';
    let hasAny = false;
    for (let i = 0; i < this.inventory.backpack.length; i++) {
      const it = this.inventory.backpack[i];
      if (!it) continue;
      hasAny = true;
      const isBroken = it.durability && it.durability.current <= 0;
      const action = isBroken ? 'repair' : 'sell';
      const price = isBroken ? repairPriceFor(it, this.getShopMult()) : sellPriceFor(it);
      const cell = this._buildCell(it, price, action);
      if (isBroken) cell.classList.add('shop-cell-broken');
      cell.addEventListener('click', () => {
        if (window.__showDetails) window.__showDetails(it);
      });
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (isBroken) this._repair(it);
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
    cell.innerHTML = `
      ${renderItemCell(item, null, { owned: mode === 'sell' || mode === 'repair' })}
      <div class="shop-price ${mode}">${priceLabel}</div>
    `;
    return cell;
  }
}
