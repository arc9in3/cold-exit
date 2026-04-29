// Hideout — between-runs panel UI.
//
// Five tabs: Stash, Quartermaster, Contractor, Doctor, Mailbox.
//   Stash:        persistent gear grid (4-8 slots, expandable via chips).
//   Quartermaster: chip-bought guaranteed gear; tier raises rarity floor.
//   Contractor:   active contract pickup + status. Daily / weekly rolls.
//   Doctor:       v1 stub. Opens for hardcore wounded-extract heals later.
//   Mailbox:      v1 stub. Unlocks once the player has played a co-op session.
//
// The hideout is shown after a "cash out" extract (or after death from
// inside the run, before the run-reset wipes the screen). The player
// chooses to start a fresh run from here. State persists via prefs.js
// accessors — no in-memory caching.

import {
  getStash, setStash, stashAddItem, stashRemoveAt, STASH_SLOT_MIN, STASH_SLOT_MAX, stashNextSlotCost,
  getHideoutUpgrades, setHideoutUpgrades, quartermasterNextTierCost, QUARTERMASTER_TIER_MAX,
  getActiveContract, setActiveContract,
  getPersistentChips, setPersistentChips,
} from './prefs.js';
import {
  CONTRACT_DEFS, defForId, contractExpired,
  pickDailyContract, pickWeeklyContract, utcDayIndex, utcWeekIndex,
  liveProgressFor,
} from './contracts.js';
import { iconForItem, inferRarity, rarityColor } from './inventory.js';

const TAB_DEFS = [
  { id: 'stash',        label: 'STASH'         },
  { id: 'quartermaster',label: 'QUARTERMASTER' },
  { id: 'contractor',   label: 'CONTRACTOR'    },
  { id: 'doctor',       label: 'DOCTOR'        },
  { id: 'mailbox',      label: 'MAILBOX'       },
];

export class HideoutUI {
  // ctx fields:
  //   onClose() — invoked when the player clicks "Start New Run".
  //   awardChips(n) — chip-credit hook (mirrors main's awardPersistentChips).
  //   spendChips(n) — returns true on success, false on insufficient chips.
  //   getRunSurvivors() — returns the items the player extracted with
  //     this run (called when the hideout is opened post-extract). Items
  //     are auto-converted to chips here, except the ones the player
  //     drags into the stash.
  //   buildLoadout() — pulls items from stash into the run inventory at
  //     fresh-run start. Returns the items dragged out of stash.
  //   getRunEventsSnapshot() — passed-in helper that builds a snapshot
  //     of contract-relevant flags from the just-finished run.
  constructor(ctx) {
    this.ctx = ctx;
    this.visible = false;
    this.tab = 'stash';
    // Items that just came back from a run, awaiting bank-or-convert
    // decision. Set by openWithExtract(items).
    this._extractedQueue = [];
    // The most recent run-events snapshot, used for contract claim
    // evaluation when the hideout opens.
    this._lastRunSnapshot = null;

    this.root = document.createElement('div');
    this.root.id = 'hideout-root';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);
    this.root.addEventListener('mousedown', (e) => {
      // Don't dismiss on backdrop click — hideout is a destination,
      // not a modal popover. Only the explicit Start Run button exits.
      if (e.target === this.root) e.stopPropagation();
    });

    this._injectStyles();
  }

  // Run-end → hideout. Pass the player's extract inventory; those
  // items show up in the "extracted this run" panel where the player
  // can drag valuables into the stash. Anything left after they hit
  // Start Run is auto-converted to chips.
  openWithExtract(items, runSnapshot) {
    this._extractedQueue = Array.isArray(items) ? items.slice() : [];
    this._lastRunSnapshot = runSnapshot || null;
    this._evaluateContractClaim();
    this.tab = 'stash';
    this.visible = true;
    this.root.style.display = 'flex';
    this.render();
  }

  // No-extract entry — used from main menu / death so the player can
  // still spend chips between runs.
  open() {
    this._extractedQueue = [];
    this._lastRunSnapshot = null;
    this.tab = 'stash';
    this.visible = true;
    this.root.style.display = 'flex';
    this.render();
  }

  close() {
    // Auto-convert anything still in the extracted queue to chips at
    // a flat rate per item rarity.
    if (this._extractedQueue.length) {
      const total = this._extractedQueue.reduce((sum, it) => sum + this._chipValueOf(it), 0);
      this._extractedQueue.length = 0;
      if (total > 0 && this.ctx.awardChips) this.ctx.awardChips(total);
    }
    this.visible = false;
    this.root.style.display = 'none';
    if (this.ctx.onClose) this.ctx.onClose();
  }

  isOpen() { return this.visible; }

  _chipValueOf(item) {
    // Conversion rate: rarity-keyed chip payout. Mirrors the spirit of
    // tunables.currency.basePrice but at chip scale (much smaller).
    const r = inferRarity(item) || item.rarity || 'common';
    return ({
      common: 4, uncommon: 12, rare: 35, epic: 90, legendary: 220, mythic: 600,
    })[r] || 4;
  }

  _evaluateContractClaim() {
    const ac = getActiveContract();
    if (!ac || (ac.claimedAt | 0) > 0) return;
    if (!this._lastRunSnapshot) return;
    // Lazy import shape — defForId already loaded; avoid re-imports.
    const def = defForId(ac.activeContractId);
    if (!def) return;
    if (def.evaluate(this._lastRunSnapshot)) {
      const updated = { ...ac, claimedAt: Date.now() };
      setActiveContract(updated);
      if (this.ctx.awardChips) this.ctx.awardChips(def.reward);
    }
  }

  // ----- Render ------------------------------------------------------
  render() {
    if (!this.visible) return;
    this.root.innerHTML = '';
    const card = document.createElement('div');
    card.id = 'hideout-card';

    // Header: title, chip wallet, close.
    const header = document.createElement('div');
    header.id = 'hideout-header';
    const chips = getPersistentChips();
    header.innerHTML = `
      <div id="hideout-title">HIDEOUT</div>
      <div id="hideout-chips"><span class="lbl">CHIPS</span> <b>${chips}</b></div>
      <button id="hideout-startrun" type="button">Start New Run ▶</button>
    `;
    header.querySelector('#hideout-startrun').addEventListener('click', () => this.close());
    card.appendChild(header);

    // Tabs.
    const tabs = document.createElement('div');
    tabs.id = 'hideout-tabs';
    for (const t of TAB_DEFS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `hideout-tab${this.tab === t.id ? ' active' : ''}`;
      btn.textContent = t.label;
      btn.addEventListener('click', () => { this.tab = t.id; this.render(); });
      tabs.appendChild(btn);
    }
    card.appendChild(tabs);

    // Body — one method per tab.
    const body = document.createElement('div');
    body.id = 'hideout-body';
    if (this.tab === 'stash')         body.appendChild(this._renderStashTab());
    else if (this.tab === 'quartermaster') body.appendChild(this._renderQuartermasterTab());
    else if (this.tab === 'contractor')    body.appendChild(this._renderContractorTab());
    else if (this.tab === 'doctor')        body.appendChild(this._renderDoctorTab());
    else if (this.tab === 'mailbox')       body.appendChild(this._renderMailboxTab());
    card.appendChild(body);

    this.root.appendChild(card);
  }

  // ----- Stash -------------------------------------------------------
  _renderStashTab() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-tab-body';
    const upg = getHideoutUpgrades();
    const stash = getStash();
    const used = new Set(stash.map(e => e.slot | 0));

    // Two columns:
    //   left: extracted-this-run items (if any)
    //   right: stash grid
    const cols = document.createElement('div');
    cols.className = 'hideout-stash-cols';

    const leftCol = document.createElement('div');
    leftCol.className = 'hideout-stash-col';
    const leftTitle = document.createElement('div');
    leftTitle.className = 'hideout-col-title';
    leftTitle.textContent = this._extractedQueue.length
      ? `EXTRACTED — ${this._extractedQueue.length} items (auto-convert to chips on exit)`
      : 'EXTRACTED — (no run finished)';
    leftCol.appendChild(leftTitle);
    const leftList = document.createElement('div');
    leftList.className = 'hideout-extract-list';
    if (!this._extractedQueue.length) {
      const p = document.createElement('div');
      p.className = 'hideout-placeholder';
      p.textContent = 'Items you extract from a run will appear here.';
      leftList.appendChild(p);
    }
    for (let i = 0; i < this._extractedQueue.length; i++) {
      const it = this._extractedQueue[i];
      leftList.appendChild(this._buildExtractedTile(it, i, upg.stashSlots, used));
    }
    leftCol.appendChild(leftList);
    cols.appendChild(leftCol);

    // Right: stash grid.
    const rightCol = document.createElement('div');
    rightCol.className = 'hideout-stash-col';
    const rightTitle = document.createElement('div');
    rightTitle.className = 'hideout-col-title';
    rightTitle.textContent = `STASH — ${stash.length} / ${upg.stashSlots} slots`;
    rightCol.appendChild(rightTitle);
    const grid = document.createElement('div');
    grid.className = 'hideout-stash-grid';
    for (let s = 0; s < upg.stashSlots; s++) {
      const slot = document.createElement('div');
      slot.className = 'hideout-stash-slot';
      const entry = stash.find(e => (e.slot | 0) === s);
      if (entry) {
        slot.appendChild(this._buildStashTile(entry.item, entry.slot));
      } else {
        slot.classList.add('empty');
        slot.textContent = '—';
      }
      grid.appendChild(slot);
    }
    rightCol.appendChild(grid);

    // Slot upgrade button.
    const upgRow = document.createElement('div');
    upgRow.className = 'hideout-upgrade-row';
    const nextCost = stashNextSlotCost(upg.stashSlots);
    if (nextCost == null) {
      upgRow.innerHTML = `<span class="muted">Stash at maximum (${STASH_SLOT_MAX} slots).</span>`;
    } else {
      upgRow.innerHTML = `
        <span>Buy slot #${upg.stashSlots + 1}: <b>${nextCost}</b> chips</span>
        <button type="button" class="hideout-buy">Buy</button>
      `;
      const btn = upgRow.querySelector('.hideout-buy');
      btn.disabled = getPersistentChips() < nextCost;
      btn.addEventListener('click', () => {
        if (!this.ctx.spendChips || !this.ctx.spendChips(nextCost)) return;
        const u = getHideoutUpgrades();
        setHideoutUpgrades({ ...u, stashSlots: Math.min(STASH_SLOT_MAX, u.stashSlots + 1) });
        this.render();
      });
    }
    rightCol.appendChild(upgRow);
    cols.appendChild(rightCol);

    wrap.appendChild(cols);
    return wrap;
  }

  _buildExtractedTile(item, idx, slotCap, usedSlots) {
    const tile = document.createElement('div');
    tile.className = 'hideout-extract-tile';
    const r = inferRarity(item) || item.rarity || 'common';
    tile.style.borderColor = rarityColor(item);
    const value = this._chipValueOf(item);
    tile.innerHTML = `
      <div class="hideout-extract-name">${(item.name || 'item').replace(/<[^>]+>/g, '')}</div>
      <div class="hideout-extract-meta">${r.toUpperCase()} · ${value}c on convert</div>
      <div class="hideout-extract-actions">
        <button type="button" class="bank">Bank to Stash</button>
      </div>
    `;
    const btn = tile.querySelector('.bank');
    // Bank disabled if stash is full.
    const stashFull = usedSlots.size >= slotCap;
    btn.disabled = stashFull;
    if (stashFull) btn.title = 'Stash is full. Sell an item or buy more slots.';
    btn.addEventListener('click', () => {
      const slot = stashAddItem(item, slotCap);
      if (slot < 0) return;
      this._extractedQueue.splice(idx, 1);
      this.render();
    });
    return tile;
  }

  _buildStashTile(item, slot) {
    const tile = document.createElement('div');
    tile.className = 'hideout-stash-tile';
    tile.style.borderColor = rarityColor(item);
    const icon = iconForItem(item);
    tile.innerHTML = `
      ${icon ? `<img class="hideout-stash-icon" src="${icon}" alt="">` : ''}
      <div class="hideout-stash-name">${(item.name || 'item').replace(/<[^>]+>/g, '')}</div>
      <div class="hideout-stash-actions">
        <button type="button" class="sell">Sell (${this._chipValueOf(item)}c)</button>
      </div>
    `;
    const sellBtn = tile.querySelector('.sell');
    sellBtn.addEventListener('click', () => {
      const removed = stashRemoveAt(slot);
      if (!removed) return;
      if (this.ctx.awardChips) this.ctx.awardChips(this._chipValueOf(removed));
      this.render();
    });
    return tile;
  }

  // ----- Quartermaster ----------------------------------------------
  _renderQuartermasterTab() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-tab-body';
    const upg = getHideoutUpgrades();
    const tier = upg.quartermasterTier;
    const tierLabels = ['Common floor', 'Uncommon floor', 'Rare floor', 'Epic floor', 'Legendary floor'];
    const tierName = tierLabels[tier] || 'Common floor';

    const head = document.createElement('div');
    head.className = 'hideout-section-head';
    head.innerHTML = `
      <div class="hideout-section-title">QUARTERMASTER</div>
      <div class="hideout-section-sub">Tier ${tier} / ${QUARTERMASTER_TIER_MAX} — ${tierName}</div>
    `;
    wrap.appendChild(head);

    const blurb = document.createElement('div');
    blurb.className = 'hideout-blurb';
    blurb.textContent =
      'Spend chips on a guaranteed weapon at the current rarity floor. Higher tiers raise the floor. Items go straight to the stash.';
    wrap.appendChild(blurb);

    // Buy buttons row — generates a single guaranteed item per click.
    const buyRow = document.createElement('div');
    buyRow.className = 'hideout-quart-buy-row';
    const cost = 80 + tier * 60;
    buyRow.innerHTML = `
      <span>Buy a guaranteed weapon roll: <b>${cost}</b> chips</span>
      <button type="button" class="hideout-buy">Buy</button>
    `;
    const buyBtn = buyRow.querySelector('.hideout-buy');
    buyBtn.disabled = getPersistentChips() < cost;
    buyBtn.title = (this.ctx.rollQuartermasterItem ? '' : 'Quartermaster roll not wired yet — placeholder.');
    buyBtn.addEventListener('click', () => {
      if (!this.ctx.spendChips || !this.ctx.spendChips(cost)) return;
      // Roll an item via the host hook; if missing, just refund.
      const item = this.ctx.rollQuartermasterItem ? this.ctx.rollQuartermasterItem(tier) : null;
      if (!item) {
        // Refund silently — host hasn't wired the roller yet.
        if (this.ctx.awardChips) this.ctx.awardChips(cost);
        return;
      }
      const slot = stashAddItem(item, upg.stashSlots);
      if (slot < 0) {
        // No room — auto-convert + refund the difference.
        if (this.ctx.awardChips) this.ctx.awardChips(this._chipValueOf(item));
      }
      this.render();
    });
    wrap.appendChild(buyRow);

    // Tier upgrade button.
    const upgRow = document.createElement('div');
    upgRow.className = 'hideout-upgrade-row';
    const nextCost = quartermasterNextTierCost(tier);
    if (nextCost == null) {
      upgRow.innerHTML = `<span class="muted">Quartermaster at max tier.</span>`;
    } else {
      upgRow.innerHTML = `
        <span>Upgrade to Tier ${tier + 1} (${tierLabels[tier + 1] || 'higher floor'}): <b>${nextCost}</b> chips</span>
        <button type="button" class="hideout-buy">Buy</button>
      `;
      const btn = upgRow.querySelector('.hideout-buy');
      btn.disabled = getPersistentChips() < nextCost;
      btn.addEventListener('click', () => {
        if (!this.ctx.spendChips || !this.ctx.spendChips(nextCost)) return;
        const u = getHideoutUpgrades();
        setHideoutUpgrades({ ...u, quartermasterTier: Math.min(QUARTERMASTER_TIER_MAX, u.quartermasterTier + 1) });
        this.render();
      });
    }
    wrap.appendChild(upgRow);
    return wrap;
  }

  // ----- Contractor --------------------------------------------------
  _renderContractorTab() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-tab-body';
    let active = getActiveContract();
    // Roll a fresh contract if none / expired.
    if (!active || contractExpired(active)) {
      active = pickDailyContract(utcDayIndex());
      if (active) setActiveContract(active);
    }

    const head = document.createElement('div');
    head.className = 'hideout-section-head';
    head.innerHTML = `
      <div class="hideout-section-title">CONTRACTOR</div>
      <div class="hideout-section-sub">Daily contract — refreshes every 24h</div>
    `;
    wrap.appendChild(head);

    const def = defForId(active?.activeContractId);
    if (!def) {
      const p = document.createElement('div');
      p.className = 'hideout-placeholder';
      p.textContent = 'No contract available. Check back later.';
      wrap.appendChild(p);
      return wrap;
    }

    const card = document.createElement('div');
    card.className = 'hideout-contract-card';
    const claimed = (active.claimedAt | 0) > 0;
    const hoursLeft = Math.max(0, Math.ceil((active.expiresAt - Date.now()) / 3600000));
    card.innerHTML = `
      <div class="hideout-contract-label">${def.label}</div>
      <div class="hideout-contract-blurb">${def.blurb}</div>
      <div class="hideout-contract-meta">
        Reward: <b>${def.reward}</b> chips · Expires in ${hoursLeft}h ${claimed ? '· <span class="claimed">CLAIMED</span>' : ''}
      </div>
    `;
    wrap.appendChild(card);

    // Weekly contract slot — same shape, shown beneath.
    let weekly = null;
    try { weekly = pickWeeklyContract(utcWeekIndex()); } catch (_) {}
    if (weekly) {
      const wdef = defForId(weekly.activeContractId);
      if (wdef) {
        const sub = document.createElement('div');
        sub.className = 'hideout-section-head';
        sub.style.marginTop = '14px';
        sub.innerHTML = `
          <div class="hideout-section-title">WEEKLY</div>
          <div class="hideout-section-sub">Refreshes every 7 days</div>
        `;
        wrap.appendChild(sub);

        const wcard = document.createElement('div');
        wcard.className = 'hideout-contract-card';
        wcard.innerHTML = `
          <div class="hideout-contract-label">${wdef.label}</div>
          <div class="hideout-contract-blurb">${wdef.blurb}</div>
          <div class="hideout-contract-meta">Reward: <b>${wdef.reward}</b> chips</div>
        `;
        wrap.appendChild(wcard);
      }
    }
    return wrap;
  }

  // ----- Doctor (v1 stub) -------------------------------------------
  _renderDoctorTab() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-tab-body';
    const head = document.createElement('div');
    head.className = 'hideout-section-head';
    head.innerHTML = `<div class="hideout-section-title">DOCTOR</div>`;
    wrap.appendChild(head);
    const p = document.createElement('div');
    p.className = 'hideout-placeholder';
    p.innerHTML = `
      The doctor sips coffee. <em>"You don't need me. Yet."</em><br>
      <span class="muted">Doctor services activate in hardcore mode (v2).</span>
    `;
    wrap.appendChild(p);
    return wrap;
  }

  // ----- Mailbox (v1 stub, locked until co-op) ----------------------
  _renderMailboxTab() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-tab-body';
    const head = document.createElement('div');
    head.className = 'hideout-section-head';
    head.innerHTML = `<div class="hideout-section-title">MAILBOX</div>`;
    wrap.appendChild(head);
    const upg = getHideoutUpgrades();
    const p = document.createElement('div');
    p.className = 'hideout-placeholder';
    p.innerHTML = upg.mailboxUnlocked
      ? `Mailbox UI is incoming with co-op v2.`
      : `<span class="muted">Mailbox unlocks once you've played a co-op session.</span>`;
    wrap.appendChild(p);
    return wrap;
  }

  // ----- Styles ------------------------------------------------------
  _injectStyles() {
    if (document.getElementById('hideout-styles')) return;
    const style = document.createElement('style');
    style.id = 'hideout-styles';
    style.textContent = `
      #hideout-root {
        position: fixed; inset: 0;
        background: radial-gradient(ellipse at center, rgba(0,0,0,0.78), rgba(0,0,0,0.95));
        display: flex; align-items: center; justify-content: center;
        z-index: 22;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      #hideout-card {
        width: 1100px; max-width: 97vw; height: 80vh; max-height: 760px;
        display: flex; flex-direction: column;
        background: linear-gradient(180deg, #181b22 0%, #0e1018 100%);
        border: 1px solid #5a8acf; border-radius: 8px;
        color: #e8dfc8;
        box-shadow: 0 16px 60px rgba(0,0,0,0.8);
        overflow: hidden;
      }
      #hideout-header {
        display: flex; align-items: center; gap: 16px;
        padding: 14px 22px; border-bottom: 1px solid #1f2530;
      }
      #hideout-title {
        font-size: 16px; font-weight: 700; color: #5a8acf;
        letter-spacing: 3px; text-transform: uppercase;
      }
      #hideout-chips { flex: 1; text-align: right; color: #c9a87a; font-size: 13px; }
      #hideout-chips .lbl { color: #9b8b6a; font-size: 10px; letter-spacing: 1.5px; margin-right: 6px; }
      #hideout-chips b { font-size: 17px; color: #f2c060; }
      #hideout-startrun {
        background: linear-gradient(180deg, #2a4a6e, #1e3450);
        border: 1px solid #5a8acf; color: #e8dfc8;
        padding: 8px 16px; border-radius: 4px;
        font: inherit; font-size: 12px; letter-spacing: 1.5px;
        text-transform: uppercase; cursor: pointer;
      }
      #hideout-startrun:hover { background: linear-gradient(180deg, #3a5a7e, #2e4460); }

      #hideout-tabs {
        display: flex; gap: 2px; padding: 8px 18px 0;
        border-bottom: 1px solid #1f2530;
      }
      .hideout-tab {
        background: transparent; border: 1px solid transparent; border-bottom: none;
        border-radius: 4px 4px 0 0; color: #6f6754;
        font: inherit; font-size: 11px; letter-spacing: 1.5px;
        text-transform: uppercase; padding: 7px 16px; cursor: pointer;
      }
      .hideout-tab:hover { color: #c9a87a; border-color: #2a3040; }
      .hideout-tab.active {
        color: #e8dfc8; border-color: #5a8acf;
        background: linear-gradient(180deg, #1a2230, #131820);
      }

      #hideout-body { flex: 1; overflow-y: auto; padding: 22px; }
      .hideout-tab-body { max-width: 100%; }
      .hideout-section-head { margin-bottom: 12px; }
      .hideout-section-title {
        font-size: 13px; color: #5a8acf; letter-spacing: 2px;
        text-transform: uppercase; font-weight: 700;
      }
      .hideout-section-sub { font-size: 10px; color: #6f6754; letter-spacing: 1px; }
      .hideout-blurb {
        color: #9b8b6a; font-size: 12px; line-height: 1.45;
        margin-bottom: 14px; max-width: 540px;
      }
      .hideout-placeholder {
        padding: 20px 24px;
        background: rgba(20, 24, 32, 0.4);
        border: 1px dashed #2a3040; border-radius: 4px;
        color: #9b8b6a; font-size: 12px; line-height: 1.55; max-width: 540px;
      }
      .hideout-placeholder em { color: #c9a87a; font-style: italic; }
      .muted { color: #5a5448; }

      .hideout-stash-cols {
        display: grid; grid-template-columns: 1fr 1fr; gap: 18px;
      }
      .hideout-stash-col { display: flex; flex-direction: column; gap: 8px; }
      .hideout-col-title {
        font-size: 11px; color: #c9a87a;
        letter-spacing: 1.5px; text-transform: uppercase;
        margin-bottom: 4px;
      }
      .hideout-extract-list {
        display: flex; flex-direction: column; gap: 6px;
        max-height: 460px; overflow-y: auto;
      }
      .hideout-extract-tile {
        padding: 8px 10px; background: linear-gradient(180deg, #1a1d24, #131720);
        border: 1px solid #2a3040; border-left-width: 3px; border-radius: 4px;
      }
      .hideout-extract-name { font-weight: 700; color: #e8dfc8; font-size: 12px; }
      .hideout-extract-meta { font-size: 10px; color: #9b8b6a; margin: 2px 0 6px; }
      .hideout-extract-actions { display: flex; gap: 6px; }
      .hideout-extract-actions button {
        flex: 1; background: linear-gradient(180deg, #1f3a5c, #16283f);
        border: 1px solid #2a4a70; color: #cbd2dc;
        padding: 4px 8px; font: inherit; font-size: 10px; letter-spacing: 1px;
        text-transform: uppercase; cursor: pointer; border-radius: 3px;
      }
      .hideout-extract-actions button:hover:not(:disabled) {
        background: linear-gradient(180deg, #2f4a6c, #26384f);
      }
      .hideout-extract-actions button:disabled {
        opacity: 0.4; cursor: not-allowed;
      }

      .hideout-stash-grid {
        display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
      }
      .hideout-stash-slot {
        aspect-ratio: 1 / 1; border: 1px dashed #2a3040; border-radius: 4px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(20, 24, 32, 0.3);
        color: #5a5448; font-size: 14px;
      }
      .hideout-stash-slot.empty { border-style: dashed; }
      .hideout-stash-tile {
        width: 100%; height: 100%;
        display: flex; flex-direction: column; align-items: center; justify-content: space-between;
        padding: 4px; box-sizing: border-box;
        background: linear-gradient(180deg, #1a1d24, #131720);
        border: 2px solid; border-radius: 4px;
      }
      .hideout-stash-icon { width: 60%; height: auto; image-rendering: pixelated; }
      .hideout-stash-name {
        font-size: 9px; color: #e8dfc8; text-align: center;
        max-height: 24px; overflow: hidden; line-height: 1.2;
      }
      .hideout-stash-actions { width: 100%; }
      .hideout-stash-actions button {
        width: 100%; background: rgba(40, 30, 50, 0.6);
        border: 1px solid #4a3060; color: #c9a87a;
        padding: 2px 4px; font: inherit; font-size: 9px;
        cursor: pointer; border-radius: 2px;
      }

      .hideout-upgrade-row, .hideout-quart-buy-row {
        display: flex; align-items: center; justify-content: space-between;
        margin-top: 12px; padding: 10px 14px;
        background: rgba(40, 32, 20, 0.3);
        border: 1px solid #3a3020; border-radius: 4px;
        color: #c9a87a; font-size: 12px;
      }
      .hideout-upgrade-row b, .hideout-quart-buy-row b { color: #f2c060; }
      .hideout-upgrade-row .muted { font-size: 11px; }
      .hideout-buy {
        background: linear-gradient(180deg, #4a6a3a, #2e4626);
        border: 1px solid #6a8a4a; color: #e8efd8;
        padding: 5px 14px; font: inherit; font-size: 11px;
        letter-spacing: 1px; text-transform: uppercase;
        cursor: pointer; border-radius: 3px;
      }
      .hideout-buy:hover:not(:disabled) {
        background: linear-gradient(180deg, #5a7a4a, #3e5636);
      }
      .hideout-buy:disabled { opacity: 0.4; cursor: not-allowed; }

      .hideout-contract-card {
        padding: 14px 18px;
        background: linear-gradient(180deg, #1a1d24, #131720);
        border-left: 3px solid #5a8acf;
        border-radius: 4px;
      }
      .hideout-contract-label {
        font-size: 14px; font-weight: 700; color: #e8dfc8;
        letter-spacing: 1px;
      }
      .hideout-contract-blurb {
        font-size: 12px; color: #c9a87a; margin: 4px 0 8px;
      }
      .hideout-contract-meta {
        font-size: 10px; color: #6f6754; letter-spacing: 0.5px;
      }
      .hideout-contract-meta b { color: #f2c060; }
      .hideout-contract-meta .claimed {
        color: #6abf78; font-weight: 700; letter-spacing: 1px;
      }
    `;
    document.head.appendChild(style);
  }
}

// Bridge: make sure setStash/stashRemoveAt round-trip cleanly. The
// stash UI mutates via the prefs.js helpers — this re-export gives
// any consumer a single import to bind to.
export { getStash, setStash, stashAddItem, stashRemoveAt };
