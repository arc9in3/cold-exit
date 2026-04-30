import { inferRarity, iconForItem, rarityColor, weaponImageMirrorStyle, TYPE_ICONS, SLOT_IDS, SLOT_POSITIONS, SLOT_ICONS, SLOT_LABEL } from './inventory.js';
import { renderItemCell } from './ui_item_cell.js';
import { GridContainer, stampItemDims } from './grid_container.js';
import { thumbnailFor } from './item_thumbnails.js';

// Workspace staging grid — shared across all loot sessions; cleared
// every time the UI opens so it doesn't carry state between bodies.
// Items left here when the UI closes drop to the ground at the
// player's feet.
const WORKSPACE_W = 10;
const WORKSPACE_H = 1;
const WS_CELL_PX = 88;
const WS_CELL_GAP = 3;

// Body-loot pile grid — the "misc" category (non-slot items) on the
// enemy / ground pile. Rebuilt from target.loot each render so the
// layout reflects current ownership. Size is generous so big weapons
// and a handful of smaller items all fit.
const BODY_GRID_W = 4;
const BODY_GRID_H = 6;
const BG_CELL_PX = 88;
const BG_CELL_GAP = 3;

// Player-side grid constants — match ui_inventory.js so the two UIs
// render the pockets / rig / backpack grids identically.
const PL_CELL_PX = 96;
const PL_CELL_GAP = 3;

// Loot modal — side-by-side inventory view. Left: the player's full
// avatar + equipment + pockets + backpack (same layout as the main
// inventory panel). Right: the enemy's avatar with a compact slot layout
// and a small pockets grid. Transfer by clicking or dragging either way.
const TYPE_TO_SLOT = {
  ranged: 'weapon1',
  melee: 'melee',
};

// Body-side repair-kit application. The kit lives in body.loot (not
// in any inventory grid), so Inventory.applyRepairKit can't decrement
// the stack itself. Mirrors the validation + durability bump portion
// of that method, returning true when the caller should consume one
// charge from the body-side stack. Pulls repairKitPotency from
// window.__derivedStats when present.
const _BODY_REPAIR_PCT_BY_RARITY = {
  common: 0.15, uncommon: 0.25, rare: 0.40,
  epic: 0.55, legendary: 0.65, mythic: 0.75,
};
function _bodyApplyRepairKit(kit, target) {
  if (!kit || kit.type !== 'repairkit' || !target) return false;
  const isWeaponTarget = target.type === 'ranged' || target.type === 'melee';
  const isArmorTarget = target.type === 'armor' || target.type === 'gear';
  if (kit.target === 'weapon' && !isWeaponTarget) return false;
  if (kit.target === 'armor' && !isArmorTarget) return false;
  if (!target.durability) return false;
  const cur = target.durability.current | 0;
  const max = target.durability.max | 0;
  if (max <= 0 || cur >= max) return false;
  const pct = (typeof kit.repairPct === 'number')
    ? kit.repairPct
    : (_BODY_REPAIR_PCT_BY_RARITY[kit.rarity || 'common'] || 0.15);
  const ds = (typeof window !== 'undefined' && window.__derivedStats) || null;
  const mult = ds && typeof ds.repairKitPotency === 'number' ? ds.repairKitPotency : 1;
  const amount = pct * max * (mult || 1);
  target.durability.current = Math.min(max, cur + amount);
  return true;
}

function classifyItem(item) {
  if (!item) return 'misc';
  // Items explicitly dumped into the "pockets" of the body via a
  // plain right-click from the player's inventory stay in the misc
  // pile even if their slot/type would normally promote them to a
  // body equipment slot.
  if (item._lootForcedPile) return 'misc';
  if (item.slot && SLOT_IDS.includes(item.slot)) return item.slot;
  if (TYPE_TO_SLOT[item.type]) return TYPE_TO_SLOT[item.type];
  return 'misc';
}

function playerSilhouetteSvg() {
  return `
    <svg viewBox="0 0 240 470" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="loot-player-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2d333e"/>
          <stop offset="1" stop-color="#1c2128"/>
        </linearGradient>
      </defs>
      <ellipse cx="120" cy="44" rx="26" ry="28" fill="url(#loot-player-grad)" stroke="#3a414c" stroke-width="1.2"/>
      <rect x="108" y="68" width="24" height="14" fill="url(#loot-player-grad)" stroke="#3a414c"/>
      <path d="M78,82 Q120,74 162,82 L162,228 Q162,244 148,244 L92,244 Q78,244 78,228 Z" fill="url(#loot-player-grad)" stroke="#3a414c" stroke-width="1.2"/>
      <rect x="60" y="88" width="18" height="72" rx="9" fill="url(#loot-player-grad)" stroke="#3a414c"/>
      <rect x="60" y="160" width="18" height="68" rx="9" fill="url(#loot-player-grad)" stroke="#3a414c"/>
      <rect x="162" y="88" width="18" height="72" rx="9" fill="url(#loot-player-grad)" stroke="#3a414c"/>
      <rect x="162" y="160" width="18" height="68" rx="9" fill="url(#loot-player-grad)" stroke="#3a414c"/>
      <path d="M84,244 L88,398 L112,398 L114,244 Z" fill="url(#loot-player-grad)" stroke="#3a414c"/>
      <path d="M126,244 L128,398 L152,398 L156,244 Z" fill="url(#loot-player-grad)" stroke="#3a414c"/>
      <rect x="84" y="398" width="30" height="54" rx="5" fill="url(#loot-player-grad)" stroke="#3a414c"/>
      <rect x="126" y="398" width="30" height="54" rx="5" fill="url(#loot-player-grad)" stroke="#3a414c"/>
    </svg>
  `;
}
function bodySilhouetteSvg() {
  return `
    <svg id="loot-body-svg" viewBox="0 0 240 470" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="loot-body-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3a2828"/>
          <stop offset="1" stop-color="#1c1214"/>
        </linearGradient>
      </defs>
      <ellipse cx="120" cy="44" rx="26" ry="28" fill="url(#loot-body-grad)" stroke="#5a3030" stroke-width="1.2"/>
      <rect x="108" y="68" width="24" height="14" fill="url(#loot-body-grad)" stroke="#5a3030"/>
      <path d="M78,82 Q120,74 162,82 L162,228 Q162,244 148,244 L92,244 Q78,244 78,228 Z" fill="url(#loot-body-grad)" stroke="#5a3030" stroke-width="1.2"/>
      <rect x="60" y="88" width="18" height="72" rx="9" fill="url(#loot-body-grad)" stroke="#5a3030"/>
      <rect x="60" y="160" width="18" height="68" rx="9" fill="url(#loot-body-grad)" stroke="#5a3030"/>
      <rect x="162" y="88" width="18" height="72" rx="9" fill="url(#loot-body-grad)" stroke="#5a3030"/>
      <rect x="162" y="160" width="18" height="68" rx="9" fill="url(#loot-body-grad)" stroke="#5a3030"/>
      <path d="M84,244 L88,398 L112,398 L114,244 Z" fill="url(#loot-body-grad)" stroke="#5a3030"/>
      <path d="M126,244 L128,398 L152,398 L156,244 Z" fill="url(#loot-body-grad)" stroke="#5a3030"/>
      <rect x="84" y="398" width="30" height="54" rx="5" fill="url(#loot-body-grad)" stroke="#5a3030"/>
      <rect x="126" y="398" width="30" height="54" rx="5" fill="url(#loot-body-grad)" stroke="#5a3030"/>
    </svg>
  `;
}

export class LootUI {
  constructor({ inventory, onClose, onDrop, onOpenCustomize, onAcquireArtifact }) {
    this.inventory = inventory;
    this.onClose = onClose;
    this.onDrop = onDrop;
    this.onOpenCustomize = onOpenCustomize || (() => {});
    // Optional pre-add hook for artifact-scroll items. When present
    // and it returns true, the item is treated as "placed" (acquired)
    // and never enters the inventory grids.
    this.onAcquireArtifact = onAcquireArtifact || (() => false);
    this.target = null;
    this.bodyHidden = false;

    this.root = document.createElement('div');
    this.root.id = 'loot-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="loot-card">
        <div id="loot-header">
          <div id="loot-title">Searching Body</div>
          <button id="loot-close" type="button">✕</button>
        </div>
        <div id="loot-body">
          <div class="loot-col loot-col-player">
            <div class="loot-col-header">
              <div class="loot-col-title-row">
                <div class="loot-col-title">You</div>
              </div>
            </div>
            <div class="loot-col-inner">
              <div class="loot-col-left">
                <div id="loot-player-avatar">
                  <div id="loot-player-slots"></div>
                </div>
                <div class="loot-col-subtitle">Quick Bar</div>
                <div id="loot-player-quickbar" class="loot-grid loot-quickbar"></div>
              </div>
              <div class="loot-col-right">
                <div id="loot-player-grids-stack"></div>
              </div>
            </div>
          </div>
          <div class="loot-col loot-col-body">
            <div class="loot-col-header">
              <div class="loot-col-title-row">
                <div class="loot-col-title">Body</div>
                <div id="loot-body-type" class="loot-body-type"></div>
              </div>
              <button id="loot-body-dismiss" type="button" title="Close body">✕</button>
            </div>
            <div class="loot-col-inner">
              <div class="loot-col-left">
                <div id="loot-avatar">
                  <div id="loot-slots"></div>
                </div>
                <div class="loot-col-subtitle">Pockets</div>
                <div id="loot-misc-grid" class="loot-grid"></div>
              </div>
            </div>
            <div id="loot-body-footer">
              <button id="loot-take-all" type="button" class="loot-btn">Take All (Y)</button>
            </div>
          </div>
        </div>
        <div id="loot-workspace">
          <div class="loot-workspace-head">
            <div class="loot-workspace-title">Work Space</div>
            <div class="loot-workspace-hint">Drag items here to stage. Anything left drops to the ground on close. R while dragging = rotate.</div>
          </div>
          <div id="loot-workspace-grid"></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);

    // Build player side
    this.playerSlotsEl = this.root.querySelector('#loot-player-slots');
    this.playerGridsStackEl = this.root.querySelector('#loot-player-grids-stack');
    this.playerQuickbarEl = this.root.querySelector('#loot-player-quickbar');
    // Per-entry DOM tile map + preview state for the player grid blocks.
    // Mirrors the pattern in ui_inventory.js so the two UIs share look
    // + interaction feel. Rotated-preview while a pocket tile is being
    // dragged is stored on `this._plGridDrag`.
    this._plGridDrag = null;
    this._plPreviewEl = null;
    this._buildPlayerSilhouette();

    // Build body side
    this.bodyEl = this.root.querySelector('#loot-body');
    this.bodyColEl = this.root.querySelector('.loot-col-body');
    this.slotsEl = this.root.querySelector('#loot-slots');
    this.miscEl = this.root.querySelector('#loot-misc-grid');
    this.bodyTypeEl = this.root.querySelector('#loot-body-type');
    this._buildBodySilhouette();

    // Workspace staging grid.
    this.workspaceGrid = new GridContainer(WORKSPACE_W, WORKSPACE_H);
    this.workspaceEl = this.root.querySelector('#loot-workspace-grid');
    this._wsTiles = new Map();
    this._wsDrag = null;
    this._wsPreviewEl = null;

    // Body-loot pile grid (the "misc" column on the enemy side).
    this.bodyGrid = new GridContainer(BODY_GRID_W, BODY_GRID_H);
    this._bodyLootIdx = new Map();

    this.root.querySelector('#loot-close').addEventListener('click', () => this.hide());
    this.root.querySelector('#loot-body-dismiss').addEventListener('click', () => this._hideBody());
    this.root.querySelector('#loot-take-all').addEventListener('click', () => this._takeAll());
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.hide(); });
    this._drag = null;

  }

  open(target) {
    this.target = target;
    this.bodyHidden = false;
    // Register the workspace as the inventory's overflow sink. Any
    // swap that displaces an item that doesn't fit in pockets/rig/
    // backpack now falls into the workspace (which grows as needed)
    // instead of silently rolling back the swap.
    this.inventory._overflowSink = (item) => this._pushToWorkspace(item);
    this.bodyColEl.style.display = '';
    if (this.bodyEl) this.bodyEl.classList.remove('body-hidden');
    // Containers AND ground piles both use the no-body layout — no
    // paperdoll silhouette, no equipment slot grid, just a contents
    // grid + the column title. Toggling a single class hides
    // everything body-specific via CSS.
    const isContainerLike = target?.kind === 'container' || !!target?._groundRefs;
    this.bodyColEl.classList.toggle('is-container', isContainerLike);
    const titleEl = this.bodyColEl.querySelector('.loot-col-title');
    if (titleEl) {
      titleEl.textContent = target?.kind === 'container' ? 'Container'
        : target?._bodyPile ? 'Loot Area'
        : target?._groundRefs ? 'Ground Pile'
        : 'Body';
    }
    const subtitleEl = this.bodyColEl.querySelector('.loot-col-subtitle');
    if (subtitleEl) {
      subtitleEl.textContent = target?._bodyPile
        ? `${target._bodyCount || 2} bodies`
        : (isContainerLike ? 'Contents' : 'Pockets');
    }
    this.root.style.display = 'flex';
    this._updateBodyType();
    this.render();
  }

  // Show the enemy's archetype at the top of the body column so the
  // player can tell a Guard apart from a Shield Bearer or a Boss at a
  // glance.
  _updateBodyType() {
    if (!this.bodyTypeEl) return;
    const t = this.target;
    // Containers carry their own label + colour-coded type tag.
    if (t && t.kind === 'container') {
      this.bodyTypeEl.textContent = t.name || 'Container';
      this.bodyTypeEl.className = `loot-body-type container-${t.containerType || 'general'}`;
      return;
    }
    if (!t || !t._groundRefs && !t.tier && !t.variant) {
      // Ground pile — no type.
      this.bodyTypeEl.textContent = '';
      this.bodyTypeEl.className = 'loot-body-type';
      return;
    }
    if (t._bodyPile) {
      this.bodyTypeEl.textContent = `${t._bodyCount || 2} Bodies`;
      this.bodyTypeEl.className = 'loot-body-type tier-ground';
      return;
    }
    if (t._groundRefs) {
      this.bodyTypeEl.textContent = 'Ground Pile';
      this.bodyTypeEl.className = 'loot-body-type tier-ground';
      return;
    }
    const tier = t.tier || 'normal';
    const variant = t.variant || 'standard';
    const variantLabels = {
      standard: 'Guard',
      dasher: 'Dasher',
      tank: 'Heavy',
      coverSeeker: 'Scout',
      shieldedPistol: 'Riot Shield',
      shieldBearer: 'Shield Bearer',
    };
    let label = variantLabels[variant] || 'Guard';
    if (tier === 'boss') label = `Boss · ${label}`;
    else if (tier === 'subBoss') label = `Sub-Boss · ${label}`;
    this.bodyTypeEl.textContent = label;
    this.bodyTypeEl.className = `loot-body-type tier-${tier}`;
  }
  hide() {
    // Drop anything staged in the workspace to the ground at the
    // player's feet — session-local staging doesn't persist.
    if (this.workspaceGrid && !this.workspaceGrid.isEmpty()) {
      const leftovers = this.workspaceGrid.items();
      this.workspaceGrid.clear();
      for (const it of leftovers) if (this.onDrop) this.onDrop(it);
    }
    // Restore workspace to its base size so the next loot session
    // doesn't keep growing rows from a previous overflow burst.
    if (this.workspaceGrid && this.workspaceGrid.w > WORKSPACE_W) {
      this.workspaceGrid.resize(WORKSPACE_W, WORKSPACE_H);
    }
    // Drop the overflow sink — standalone inventory should rollback
    // again when the loot UI isn't open.
    if (this.inventory) this.inventory._overflowSink = null;
    this.root.style.display = 'none';
    if (this.target) this.target.looted = (this.target.loot?.length || 0) === 0;
    this.target = null;
    if (this.onClose) this.onClose();
  }
  isOpen() { return this.target !== null; }

  _hideBody() {
    this.bodyHidden = true;
    this.bodyColEl.style.display = 'none';
    if (this.bodyEl) this.bodyEl.classList.add('body-hidden');
    if (this.target) this.target.looted = (this.target.loot?.length || 0) === 0;
  }

  _buildPlayerSilhouette() {
    // Silhouette SVG spans col 2 of the 3-col slot grid.
    const svgWrap = document.createElement('div');
    svgWrap.id = 'loot-player-sil';
    svgWrap.innerHTML = playerSilhouetteSvg();
    this.playerSlotsEl.appendChild(svgWrap);

    this._playerSlotCells = {};
    for (const slot of SLOT_IDS) {
      const cell = document.createElement('div');
      cell.className = `inv-slot loot-slot loot-slot-player slot-${slot}`;
      cell.dataset.slot = slot;
      const pos = SLOT_POSITIONS[slot];
      if (pos) {
        cell.style.gridRow = String(pos.row);
        cell.style.gridColumn = String(pos.col);
      }
      this._playerSlotCells[slot] = cell;
      this.playerSlotsEl.appendChild(cell);

      // Loot-modal equipment slot:
      //   click       = inspect (verbose item view)
      //   shift+click = move item to opponent's pockets (body must be open)
      //   right-click = unequip into player inventory grids
      cell.addEventListener('click', (e) => {
        const it = this.inventory.equipment[slot];
        if (!it) return;
        if (e.shiftKey && this.target && !this.bodyHidden) {
          this.inventory.equipment[slot] = null;
          this.inventory._recomputeCapacity?.();
          it._lootForcedPile = true;
          this.target.loot = this.target.loot || [];
          this.target.loot.push(it);
          this.inventory._bump();
          this.render();
          return;
        }
        if (window.__showDetails) window.__showDetails(it);
      });
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.inventory.unequip(slot)) this.render();
      });
      cell.addEventListener('dragstart', (e) => {
        const item = this.inventory.equipment[slot];
        if (!item) { e.preventDefault(); return; }
        this._drag = { from: 'player-slot', slot };
        this._highlightCompatibleSlots(item);
        document.body.classList.add('ui-grid-dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      cell.addEventListener('dragend', () => {
        this._drag = null; this._clearDragUI();
        document.body.classList.remove('ui-grid-dragging');
      });
      cell.addEventListener('dragover', (e) => {
        if (!this._drag) return;
        e.preventDefault();
        cell.classList.add('drop-ok');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop-ok'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drop-ok');
        const d = this._drag;
        if (!d) return;
        if (d.from === 'body-slot' || d.from === 'body-misc') {
          // Drag-to-equip: honour the specific slot the player dropped
          // on (falls through to smart placement if the slot isn't
          // compatible with the item).
          this._takeOneIntoSlot(d.lootIdx, slot);
        } else if (d.from === 'pockets' && d.entry) {
          // Equip from player grid. Container slots (bag / rig) route
          // through equipBackpack so the contents-migration pre-flight
          // applies; weapons / armor / ammo go through the direct
          // swap as before.
          const item = d.item;
          if (this.inventory.canSlotHold(slot, item)) {
            if (slot === 'backpack' || slot === 'belt') {
              const ok = this.inventory.equipBackpack(item);
              if (!ok) {
                const err = this.inventory.lastEquipError;
                if (err === 'tooSmallForBag') {
                  window.__hudMsg?.('Too many items to swap bags — use the workspace to make room.', 3.0);
                } else if (err === 'tooSmallForRig') {
                  window.__hudMsg?.('Too many items to swap rigs — use the workspace to make room.', 3.0);
                }
              }
              this.render();
            } else {
              const prev = this.inventory.equipment[slot];
              const srcGrid = this.inventory.gridOf(item);
              if (srcGrid) srcGrid.remove(item);
              this.inventory.equipment[slot] = item;
              this.inventory._recomputeCapacity();
              if (prev && !this.inventory.placeOrOverflow(prev)) {
                // True last-resort rollback — placeOrOverflow already
                // tries the workspace, so this branch only fires if
                // even the workspace refused (shouldn't happen).
                this.inventory.equipment[slot] = prev;
                this.inventory._recomputeCapacity();
                this.inventory.autoPlaceAnywhere(item);
              }
              this.inventory._bump();
              this.render();
            }
          }
        } else if (d.from === 'workspace' && d.entry) {
          // Equip from the workspace. If the slot is incompatible or
          // already has something we can't displace, abort.
          const item = d.item;
          if (this.inventory.canSlotHold(slot, item)) {
            const prev = this.inventory.equipment[slot];
            this.workspaceGrid.remove(d.entry);
            this.inventory.equipment[slot] = item;
            // placeOrOverflow tries containers, then falls back to the
            // workspace (which grows). The displaced item should
            // always land somewhere.
            if (prev && !this.inventory.placeOrOverflow(prev)) {
              this.inventory.equipment[slot] = prev;
              this.workspaceGrid.autoPlace(item);
            }
            this.inventory._bump();
            this.render();
          }
        }
        this._drag = null;
      });
    }
  }

  _buildBodySilhouette() {
    const svgWrap = document.createElement('div');
    svgWrap.id = 'loot-body-sil';
    svgWrap.innerHTML = bodySilhouetteSvg();
    this.slotsEl.appendChild(svgWrap);

    this._slotCells = {};
    for (const slot of SLOT_IDS) {
      const cell = document.createElement('div');
      cell.className = `inv-slot loot-slot slot-${slot}`;
      cell.dataset.slot = slot;
      const pos = SLOT_POSITIONS[slot];
      if (pos) {
        cell.style.gridRow = String(pos.row);
        cell.style.gridColumn = String(pos.col);
      }
      this._slotCells[slot] = cell;
      this.slotsEl.appendChild(cell);

      // Body equipment slot (right-side paper doll):
      //   click             = inspect (verbose item view)
      //   right-click       = take into player inventory
      //   shift+right-click = take and force-equip on the player
      cell.addEventListener('click', () => {
        const p = this._bySlot?.[slot];
        if (p?.item && window.__showDetails) window.__showDetails(p.item);
      });
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const p = this._bySlot?.[slot];
        if (!p) return;
        if (e.shiftKey) this._takeAndEquip(p.lootIdx);
        else            this._takeBySlot(slot);
      });
      cell.addEventListener('dragstart', (e) => {
        const pl = this._bySlot[slot];
        if (!pl || !pl.item) { e.preventDefault(); return; }
        this._drag = { from: 'body-slot', slot, lootIdx: pl.lootIdx };
        this._highlightCompatibleSlots(pl.item);
        document.body.classList.add('ui-grid-dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      cell.addEventListener('dragend', () => {
        this._drag = null; this._clearDragUI();
        document.body.classList.remove('ui-grid-dragging');
      });
      cell.addEventListener('dragover', (e) => {
        if (!this._drag) return;
        e.preventDefault();
        cell.classList.add('drop-ok');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop-ok'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drop-ok');
        const d = this._drag;
        if (!d) return;
        if (d.from === 'player-bag' || d.from === 'player-slot') this._giveFromPlayer(d);
        else if (d.from === 'pockets' && d.entry) {
          const g = this.inventory.gridOf(d.item);
          if (g) g.remove(d.item);
          this.target.loot = this.target.loot || [];
          this.target.loot.push(d.item);
          this.inventory._bump();
          this.render();
        }
        else if (d.from === 'workspace' && d.entry) {
          // Drop from workspace back onto the body (adds to loot pile).
          this.workspaceGrid.remove(d.entry);
          this.target.loot = this.target.loot || [];
          this.target.loot.push(d.item);
          this.render();
        }
        this._drag = null;
      });
    }
  }

  // --- smart-pickup helpers -------------------------------------------
  // Rarity rank (common=0 … legendary=4) used to decide whether a
  // looted item auto-equips or stays in the pack.
  _rarityRank(item) {
    if (!item) return -1;
    const r = inferRarity(item);
    const order = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
    return order[r] ?? 0;
  }

  // Pick the equipment slot this item should target. For dual-weapon
  // slots we aim at the worse of the two so the upgrade always
  // displaces the weakest weapon first.
  _bestTargetSlot(item) {
    if (item.type === 'ranged') {
      if (!this.inventory.equipment.weapon1) return 'weapon1';
      if (!this.inventory.equipment.weapon2) return 'weapon2';
      const r1 = this._rarityRank(this.inventory.equipment.weapon1);
      const r2 = this._rarityRank(this.inventory.equipment.weapon2);
      return r2 < r1 ? 'weapon2' : 'weapon1';
    }
    if (item.type === 'melee') return 'melee';
    if (item.slot) return item.slot;
    return null;
  }

  // Autoloot: auto-equip on the compatible slot only if it's EMPTY.
  // Anything with an occupied slot — regardless of rarity — drops
  // into the pack so the player keeps control over what's equipped.
  // Use shift+right-click (or drag to the paperdoll) to force-equip
  // an upgrade through the `_takeAndEquip` path instead.
  _smartPlace(item, _allowEqualEquip) {
    if (!item) return { placed: false };
    // Artifact scrolls auto-consume — never enter the bag.
    if (item.type === 'relic' && this.onAcquireArtifact(item)) {
      return { placed: true, slot: 'artifact' };
    }
    // Consumables / attachments have no equip target.
    if (item.type === 'consumable' || item.type === 'attachment') {
      return this.inventory.add(item);
    }
    const slot = this._bestTargetSlot(item);
    if (!slot) return this.inventory.add(item);
    const current = this.inventory.equipment[slot];
    if (!current) {
      this.inventory.equipment[slot] = item;
      this.inventory._bump();
      return { placed: true, slot };
    }
    // Slot is occupied — don't displace. Push into the pack instead.
    return this.inventory.add(item);
  }

  _takeAll() {
    if (!this.target) return;
    const items = (this.target.loot || []).slice();
    const remaining = [];
    const remainingRefs = [];
    const refs = this.target._groundRefs || null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Loot-all auto-equips only on STRICTLY better rarity; equal
      // rarity goes to the pack so the player keeps what they chose.
      const r = this._smartPlace(item, /*allowEqualEquip=*/false);
      if (!r.placed) {
        remaining.push(item);
        if (refs) remainingRefs.push(refs[i]);
      } else if (refs) {
        // Ground source: removing a ground handle on successful pickup.
        this.target._removeGround?.(refs[i]);
      }
    }
    this.target.loot = remaining;
    if (refs) this.target._groundRefs = remainingRefs;
    this.render();
  }

  _takeOne(idx) {
    if (!this.target) return;
    const item = this.target.loot[idx];
    if (!item) return;
    // Pure take: add to player inventory grids (pockets / rig /
    // backpack) without auto-equipping. Use shift+right-click if you
    // want to equip from the body pile.
    delete item._lootForcedPile;   // reset cross-session flag
    // Artifact scrolls auto-consume — never enter the bag.
    let r;
    if (item.type === 'relic' && this.onAcquireArtifact(item)) {
      r = { placed: true, slot: 'artifact' };
    } else if (item.type === 'consumable' || (item.type === 'junk' && item.stackMax)) {
      // Stackable types still route through inventory.add so they
      // merge into existing stacks. Empty-slot auto-equip doesn't
      // apply to consumables / junk anyway.
      r = this.inventory.add(item);
    } else {
      // Weapons / armor / gear / throwables / attachments: force the
      // pickup into the bag, never auto-equip into an empty slot.
      // Player chooses what to equip via shift+right-click or drag.
      const placed = this.inventory.autoPlaceAnywhere(item);
      if (placed) {
        this.inventory._bump();
        r = { placed: true, pocketEntry: placed.entry };
      } else {
        r = { placed: false };
      }
    }
    if (r.placed) {
      const refs = this.target._groundRefs;
      if (refs && this.target._removeGround) this.target._removeGround(refs[idx]);
      this.target.loot.splice(idx, 1);
      if (refs) refs.splice(idx, 1);
    }
    this.render();
  }

  // Shift + right-click on a body item — force-equip to the first
  // compatible equipment slot. Displaces the current equipped item
  // back into the player's grids. Falls back to regular take() if
  // the item has no compatible slot (consumable / junk / attachment).
  _takeAndEquip(idx) {
    if (!this.target) return;
    const item = this.target.loot[idx];
    if (!item) return;
    delete item._lootForcedPile;
    const slot = this.inventory.firstCompatibleSlot?.(item);
    if (!slot) { this._takeOne(idx); return; }
    const current = this.inventory.equipment[slot];
    if (current && !this.inventory.canAcceptInPockets(current)) {
      // No room to displace — skip silently.
      return;
    }
    if (current) this.inventory.autoPlaceAnywhere(current);
    this.inventory.equipment[slot] = item;
    this.inventory._recomputeCapacity?.();
    this.inventory._bump();
    const refs = this.target._groundRefs;
    if (refs && this.target._removeGround) this.target._removeGround(refs[idx]);
    this.target.loot.splice(idx, 1);
    if (refs) refs.splice(idx, 1);
    this.render();
  }

  // Drag-to-slot: honour the exact slot the player dropped on. Rejects
  // incompatible types (e.g. dragging a rifle onto a head armor slot)
  // and falls back to smart placement so the item isn't lost.
  _takeOneIntoSlot(idx, slot) {
    if (!this.target) return;
    const item = this.target.loot[idx];
    if (!item) return;
    if (!this.inventory.canSlotHold(slot, item)) {
      this._takeOne(idx);
      return;
    }
    // Swap: player's previously equipped item goes to the BODY's
    // loot pile (so it visually lands in the same-category body slot
    // via the render classifier). The body-loot item fills the
    // player's slot. Matches "swap what I have in that slot with the
    // slot on the enemy's body".
    const current = this.inventory.equipment[slot];
    delete item._lootForcedPile;
    this.inventory.equipment[slot] = item;
    this.inventory._recomputeCapacity?.();
    this.inventory._bump();
    const refs = this.target._groundRefs;
    if (refs && this.target._removeGround) this.target._removeGround(refs[idx]);
    this.target.loot.splice(idx, 1);
    if (refs) refs.splice(idx, 1);
    if (current) {
      // Clear any stale pile-flag and push onto body. The classifier
      // will show it under the body's matching slot category.
      delete current._lootForcedPile;
      this.target.loot.push(current);
    }
    this.render();
  }

  _takeBySlot(slot) {
    const pl = this._bySlot[slot];
    if (!pl || pl.lootIdx < 0) return;
    this._takeOne(pl.lootIdx);
  }

  _giveFromPlayer(drag) {
    if (!this.target) return;
    if (drag.from === 'player-bag') {
      const item = this.inventory.backpack[drag.idx];
      if (!item) return;
      this.inventory.takeFromBackpack(drag.idx);
      this.target.loot = this.target.loot || [];
      this.target.loot.push(item);
    } else if (drag.from === 'player-slot') {
      const item = this.inventory.equipment[drag.slot];
      if (!item) return;
      this.inventory.equipment[drag.slot] = null;
      this.inventory._bump();
      this.target.loot = this.target.loot || [];
      this.target.loot.push(item);
    }
    this.render();
  }

  // `opts.owned` — the item is the player's (so the ⚙ customize button
  // is interactive). Body-side cells pass `owned: false` and the button
  // is hidden.
  _cellContent(item, slotId, opts = {}) {
    const slotLabel = slotId ? (SLOT_LABEL[slotId] || slotId) : '';
    if (!item) {
      const icon = slotId ? (SLOT_ICONS[slotId] || '·') : '·';
      const lbl = slotLabel ? `<div class="cell-label">${slotLabel}</div>` : '';
      return `${lbl}<div class="cell-empty-ico">${icon}</div>`;
    }
    // Cell background = RARITY color, not item.tint. The previous
    // tint-driven swatch was confusing because item.tint also drove
    // the weapon-render PNG accent (orange AK on orange swatch). Now
    // the swatch communicates loot tier — common gray, uncommon
    // green, rare blue, epic orange, legendary gold, mythic purple
    // — and the item image sits cleanly on top.
    const tintStr = rarityColor(item);
    // Resolution rule: weapons (ranged + melee) use the curated
    // side-view PNG returned by iconForItem (driven by
    // WEAPON_RENDER_BY_NAME). Everything else — armor, gear,
    // consumables, junk, throwables, attachments — uses the new
    // procedural thumbnail (capsules + tapered cylinders + spheres
    // for pants / chest rigs / gloves / boots, custom builders for
    // distinctive junk like rings / skulls / walkies / bag-of-peas).
    // Falls through to iconForItem if the procedural path returns
    // null (cache miss, render fail).
    const isWeapon = item.type === 'ranged' || item.type === 'melee';
    const iconPath = isWeapon
      ? iconForItem(item)
      : (thumbnailFor(item) || iconForItem(item));
    const cellMirror = weaponImageMirrorStyle(item);
    const swatchInner = iconPath
      ? `<img class="cell-icon" src="${iconPath}" alt="" style="${cellMirror}">`
      : `<span class="cell-type-ico">${TYPE_ICONS[item.type] || '◇'}</span>`;
    const slotTag = slotLabel ? `<div class="cell-slot-tag">${slotLabel}</div>` : '';
    const dur = item.durability;
    const custBtn = opts.owned && (item.type === 'ranged' || item.type === 'melee')
      ? `<button class="cust-btn" type="button" title="Customize">⚙</button>` : '';
    const ammo = (item.type === 'ranged' && typeof item.ammo === 'number')
      ? `<div class="cell-ammo">${item.ammo}/${item.magSize}${item.reloadingT > 0 ? ' (reload)' : ''}</div>`
      : '';
    const durBar = dur
      ? `<div class="cell-dur"><div class="cell-dur-fill" style="width:${Math.max(0, (dur.current / dur.max) * 100).toFixed(0)}%"></div></div>`
      : '';
    const affixLines = (item.affixes && item.affixes.length)
      ? `<div class="cell-affixes">${item.affixes.map(a => `• ${a.label}`).join('<br>')}</div>`
      : '';
    const perkLines = (item.perks && item.perks.length)
      ? `<div class="cell-perks">${item.perks.map(p =>
          `<span class="perk"><span class="perk-name">◆ ${p.name}</span>${
            p.description ? `<span class="perk-desc"> — ${p.description}</span>` : ''
          }</span>`).join('')}</div>`
      : '';
    return `
      ${slotTag}
      ${custBtn}
      <div class="cell-swatch" style="background:${tintStr}">${swatchInner}</div>
      <div class="cell-name">${item.name}</div>
      <div class="cell-desc">${item.description || ''}</div>
      ${perkLines}
      ${affixLines}
      ${ammo}
      ${durBar}
    `;
  }

  _wireCustBtn(cellEl, item) {
    const btn = cellEl.querySelector('.cust-btn');
    if (!btn || !item) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onOpenCustomize(item);
    });
  }

  _applyRarity(el, item) {
    el.classList.remove('rarity-common', 'rarity-uncommon', 'rarity-rare', 'rarity-epic', 'rarity-legendary', 'rarity-mythic', 'mastercraft');
    if (item) {
      el.classList.add(`rarity-${inferRarity(item)}`);
      if (item.mastercraft) el.classList.add('mastercraft');
    }
    el.classList.toggle('filled', !!item);
  }

  _wireMiscCell(cell, lootIdx) {
    cell.addEventListener('click', () => {
      const it = this.target?.loot?.[lootIdx];
      if (it && window.__showDetails) window.__showDetails(it);
    });
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._takeOne(lootIdx);
    });
    cell.addEventListener('dragstart', (e) => {
      const item = this.target?.loot?.[lootIdx];
      if (!item) { e.preventDefault(); return; }
      this._drag = { from: 'body-misc', lootIdx };
      this._highlightCompatibleSlots(item);
      e.dataTransfer.effectAllowed = 'move';
    });
    cell.addEventListener('dragend', () => { this._drag = null; this._clearDragUI(); });
    cell.addEventListener('dragover', (e) => {
      if (!this._drag) return;
      e.preventDefault();
      cell.classList.add('drop-ok');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-ok'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('drop-ok');
      const d = this._drag;
      if (!d) return;
      if (d.from === 'player-bag' || d.from === 'player-slot') this._giveFromPlayer(d);
      else if (d.from === 'pockets' && d.entry) {
        // Drop from a player grid onto the body — remove from the
        // source grid + push onto body loot.
        const g = this.inventory.gridOf(d.item);
        if (g) g.remove(d.item);
        this.target.loot = this.target.loot || [];
        this.target.loot.push(d.item);
        this.inventory._bump();
        this.render();
      } else if (d.from === 'workspace' && d.entry) {
        // Drop from workspace back onto the body (adds to loot pile).
        this.workspaceGrid.remove(d.entry);
        this.target.loot = this.target.loot || [];
        this.target.loot.push(d.item);
        this.render();
      }
      this._drag = null;
    });
  }

  _wireQuickbarCell(cell, slotIdx) {
    cell.addEventListener('click', () => {
      // Click a filled slot to clear its binding; click empty = no-op.
      if (this.inventory.actionSlotItem(slotIdx)) {
        this.inventory.assignActionSlot(slotIdx, null);
        this.render();
      }
    });
    cell.addEventListener('dragstart', (e) => {
      const item = this.inventory.actionSlotItem(slotIdx);
      if (!item) { e.preventDefault(); return; }
      this._drag = { from: 'quickbar', slot: slotIdx };
      e.dataTransfer.effectAllowed = 'move';
    });
    cell.addEventListener('dragend', () => { this._drag = null; });
    cell.addEventListener('dragover', (e) => {
      const d = this._drag;
      if (!d) return;
      if (d.from === 'quickbar') { e.preventDefault(); cell.classList.add('drop-ok'); return; }
      if (d.from === 'player-bag') {
        const item = this.inventory.backpack[d.idx];
        if (item && (window.__isQuickslotEligible
            ? window.__isQuickslotEligible(item)
            : item.type === 'consumable')) {
          e.preventDefault(); cell.classList.add('drop-ok');
        }
      }
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-ok'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('drop-ok');
      const d = this._drag;
      if (!d) return;
      if (d.from === 'quickbar') {
        this.inventory.swapActionSlots(d.slot, slotIdx);
      } else if (d.from === 'player-bag') {
        const item = this.inventory.backpack[d.idx];
        const ok = item && (window.__isQuickslotEligible
          ? window.__isQuickslotEligible(item)
          : item.type === 'consumable');
        if (ok) this.inventory.assignActionSlot(slotIdx, item);
      }
      this._drag = null;
      this.render();
    });
  }

  _wirePlayerBagCell(cell, bagIdx) {
    cell.addEventListener('click', (e) => {
      if (e.shiftKey) {
        // Shift-click: drop into body if body visible, else onto ground.
        if (!this.bodyHidden && this.target) {
          const item = this.inventory.backpack[bagIdx];
          if (item) {
            this.inventory.takeFromBackpack(bagIdx);
            this.target.loot = this.target.loot || [];
            this.target.loot.push(item);
          }
        } else if (this.onDrop) {
          const item = this.inventory.takeFromBackpack(bagIdx);
          if (item) this.onDrop(item);
        }
        this.render();
        return;
      }
      // Plain left-click = inspect.
      const it = this.inventory.backpack[bagIdx];
      if (it && window.__showDetails) window.__showDetails(it);
    });
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Right-click = equip.
      const item = this.inventory.backpack[bagIdx];
      if (item && this.inventory.equipBackpack) {
        const ok = this.inventory.equipBackpack(bagIdx);
        if (!ok) {
          const err = this.inventory.lastEquipError;
          if (err === 'tooSmallForBag') {
            window.__hudMsg?.('Too many items to swap bags — use the workspace to make room.', 3.0);
          } else if (err === 'tooSmallForRig') {
            window.__hudMsg?.('Too many items to swap rigs — use the workspace to make room.', 3.0);
          }
        }
      }
      this.render();
    });
    cell.addEventListener('dragstart', (e) => {
      const item = this.inventory.backpack[bagIdx];
      if (!item) { e.preventDefault(); return; }
      this._drag = { from: 'player-bag', idx: bagIdx };
      this._highlightCompatibleSlots(item);
      document.body.classList.add('ui-grid-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    cell.addEventListener('dragend', () => {
      this._drag = null; this._clearDragUI();
      document.body.classList.remove('ui-grid-dragging');
    });
    cell.addEventListener('dragover', (e) => {
      if (!this._drag) return;
      e.preventDefault();
      cell.classList.add('drop-ok');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-ok'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('drop-ok');
      const d = this._drag;
      if (!d) return;
      if (d.from === 'body-slot' || d.from === 'body-misc') this._takeOne(d.lootIdx);
      else if (d.from === 'workspace' && d.entry) {
        // Move from workspace into the player's inventory (pockets /
        // rig / backpack — autoPlace tries each in order).
        if (this.inventory.autoPlaceAnywhere(d.item)) {
          this.workspaceGrid.remove(d.entry);
          this.inventory._bump();
          this.render();
        }
      }
      this._drag = null;
    });
  }

  render() {
    // Player side — equipment slots + pockets + backpack. `owned: true`
    // enables the ⚙ customize button on weapons.
    for (const slot of SLOT_IDS) {
      const cell = this._playerSlotCells[slot];
      if (!cell) continue;
      const item = this.inventory.equipment[slot];
      cell.innerHTML = renderItemCell(item, slot, { owned: true });
      this._applyRarity(cell, item);
      cell.setAttribute('draggable', item ? 'true' : 'false');
      this._wireCustBtn(cell, item);
    }
    // Player grids: pockets, rig (if belt), backpack (if backpack).
    // Renders the SAME footprint grids as the main inventory panel so
    // the player can see their actual capacity + item positions while
    // looting. Items are draggable to body / workspace / equip slots.
    this._buildPlayerGrids();

    // Quick Bar — drag consumables from pockets/backpack onto a slot to
    // bind, drag between slots to swap, click to clear a binding.
    if (this.playerQuickbarEl) {
      this.playerQuickbarEl.innerHTML = '';
      const maxSlots = this.inventory.maxActionSlots();
      for (let i = 0; i < maxSlots; i++) {
        const cell = document.createElement('div');
        cell.className = 'inv-cell loot-cell quickbar-slot';
        const item = this.inventory.actionSlotItem(i);
        cell.innerHTML = renderItemCell(item);
        if (item) cell.classList.add('filled');
        cell.setAttribute('draggable', item ? 'true' : 'false');
        const key = document.createElement('span');
        key.className = 'quickbar-key';
        key.textContent = String(i + 5);
        cell.appendChild(key);
        this._wireQuickbarCell(cell, i);
        this.playerQuickbarEl.appendChild(cell);
      }
    }

    // Body side
    if (!this.target) return;
    const items = this.target.loot || [];
    this._bySlot = {};
    const miscIdxs = [];
    // Containers don't have an avatar — every item goes straight to
    // the contents grid so the player sees a flat list, not a fake
    // "what the chest is wearing" layout.
    if (this.target.kind === 'container') {
      items.forEach((_it, idx) => miscIdxs.push(idx));
    } else {
      const usedSlots = new Set();
      items.forEach((it, idx) => {
        const t = classifyItem(it);
        if (t === 'misc') { miscIdxs.push(idx); return; }
        let slot = t;
        if (usedSlots.has(slot)) {
          if (slot === 'weapon1' && !usedSlots.has('weapon2')) slot = 'weapon2';
          else { miscIdxs.push(idx); return; }
        }
        usedSlots.add(slot);
        this._bySlot[slot] = { item: it, lootIdx: idx };
      });
    }
    for (const slot of SLOT_IDS) {
      const cell = this._slotCells[slot];
      if (!cell) continue;
      const payload = this._bySlot[slot];
      const item = payload ? payload.item : null;
      cell.innerHTML = renderItemCell(item, slot);
      this._applyRarity(cell, item);
      cell.setAttribute('draggable', item ? 'true' : 'false');
    }
    // Body loot pile — footprint grid. Rebuild grid from target.loot
    // each render so the layout reflects current ownership. Items
    // auto-place in row-major order; anything that doesn't fit (rare
    // with 4×6) is silently dropped for now (caller-visible via the
    // loot-all button).
    this.bodyGrid.clear();
    this._bodyLootIdx = new Map();
    for (const idx of miscIdxs) {
      const item = items[idx];
      if (!item) continue;
      stampItemDims(item);
      if (this.bodyGrid.autoPlace(item)) {
        this._bodyLootIdx.set(item, idx);
      }
    }
    this._buildBodyGrid();

    this._buildWorkspace();
  }

  // Pulse every player-equipment slot that could accept the dragged
  // item. Called from each dragstart site; cleared in `_clearDragUI()`.
  _highlightCompatibleSlots(item) {
    if (!item || !this._playerSlotCells) return;
    for (const slot of SLOT_IDS) {
      const el = this._playerSlotCells[slot];
      if (!el) continue;
      if (this.inventory.canSlotHold(slot, item)) {
        el.classList.add('slot-compatible');
      }
    }
  }
  _clearDragUI() {
    if (!this._playerSlotCells) return;
    for (const slot of SLOT_IDS) {
      const el = this._playerSlotCells[slot];
      if (el) el.classList.remove('slot-compatible');
    }
  }

  // ——— player grid stack (pockets / rig / backpack) ————————————————

  _buildPlayerGrids() {
    if (!this.playerGridsStackEl) return;
    this.playerGridsStackEl.innerHTML = '';
    this._plTiles = new Map();
    this._plGridBlocks = [];
    const inv = this.inventory;
    const blocks = [
      { grid: inv.pocketsGrid, label: 'Pockets', owner: null },
    ];
    if (inv.rigGrid) {
      const rig = inv.equipment.belt;
      blocks.push({ grid: inv.rigGrid, label: `Rig · ${rig?.name || 'Tactical Rig'}`, owner: rig });
    }
    if (inv.backpackGrid) {
      const pack = inv.equipment.backpack;
      blocks.push({ grid: inv.backpackGrid, label: `Backpack · ${pack?.name || 'Pack'}`, owner: pack });
    }
    if (inv.pouchGrid) {
      blocks.push({ grid: inv.pouchGrid, label: 'Pouch · persistent', owner: null });
    }
    for (const b of blocks) this._buildPlayerGridBlock(b);
  }

  _buildPlayerGridBlock({ grid, label, owner }) {
    const block = document.createElement('div');
    block.className = 'loot-player-grid-block';
    const heading = document.createElement('div');
    heading.className = 'loot-player-grid-heading';
    heading.textContent = label;
    block.appendChild(heading);
    const wrap = document.createElement('div');
    wrap.className = 'pockets-grid loot-pockets-grid';
    wrap.style.width  = `${grid.w * PL_CELL_PX + (grid.w - 1) * PL_CELL_GAP}px`;
    wrap.style.height = `${grid.h * PL_CELL_PX + (grid.h - 1) * PL_CELL_GAP}px`;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const c = document.createElement('div');
        c.className = 'pocket-cell';
        c.style.left = `${x * (PL_CELL_PX + PL_CELL_GAP)}px`;
        c.style.top  = `${y * (PL_CELL_PX + PL_CELL_GAP)}px`;
        c.style.width  = `${PL_CELL_PX}px`;
        c.style.height = `${PL_CELL_PX}px`;
        c.style.pointerEvents = 'none';
        wrap.appendChild(c);
      }
    }
    for (const entry of grid.entries()) {
      const tile = this._buildPlayerPocketTile(entry, grid);
      wrap.appendChild(tile);
      this._plTiles.set(entry, tile);
    }
    this._wirePlayerGridWrap(wrap, grid);
    this._wirePlayerGridCustomDrag(wrap, grid);
    block.appendChild(wrap);
    this.playerGridsStackEl.appendChild(block);
    this._plGridBlocks.push({ grid, wrap, block, owner });
  }

  _wirePlayerTileAsDropTarget(tile, wrap, grid) {
    tile.addEventListener('dragover', (e) => {
      const d = this._plGridDrag || this._drag;
      if (!d) return;
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / (PL_CELL_PX + PL_CELL_GAP));
      const y = Math.floor((e.clientY - rect.top)  / (PL_CELL_PX + PL_CELL_GAP));
      if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) {
        this._clearPlayerCellPreview(); return;
      }
      this._showPlayerCellPreview(grid, wrap, x, y);
    });
    tile.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._clearPlayerCellPreview();
      const rect = wrap.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / (PL_CELL_PX + PL_CELL_GAP));
      const y = Math.floor((e.clientY - rect.top)  / (PL_CELL_PX + PL_CELL_GAP));
      if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) {
        this._plGridDrag = null; this._drag = null; return;
      }
      const d = this._plGridDrag;
      if (d && d.entry) {
        const rotated = d.rotatedPreview !== undefined ? d.rotatedPreview : d.entry.rotated;
        const tx = x - (d.pointerOffsetX | 0);
        const ty = y - (d.pointerOffsetY | 0);
        const ok = this.inventory.moveInGrid(d.item, grid, tx, ty, rotated);
        if (!ok) this.inventory.moveInGrid(d.item, grid, x, y, rotated);
      } else {
        const ds = this._drag;
        if (ds && (ds.from === 'body-slot' || ds.from === 'body-misc')) {
          const item = this.target?.loot?.[ds.lootIdx];
          if (item) {
            stampItemDims(item);
            let placed = grid.canPlace(item, x, y, false);
            if (placed) grid.place(item, x, y, false);
            else if (!this.inventory.autoPlaceAnywhere(item)) { this._drag = null; return; }
            this.target.loot.splice(ds.lootIdx, 1);
            const refs = this.target._groundRefs;
            if (refs && this.target._removeGround) {
              this.target._removeGround(refs[ds.lootIdx]);
              refs.splice(ds.lootIdx, 1);
            }
            this.inventory._bump();
          }
        } else if (ds && ds.from === 'workspace' && ds.entry) {
          stampItemDims(ds.item);
          let placed = grid.canPlace(ds.item, x, y, false);
          if (placed) grid.place(ds.item, x, y, false);
          else if (!this.inventory.autoPlaceAnywhere(ds.item)) { this._drag = null; return; }
          this.workspaceGrid.remove(ds.entry);
          this.inventory._bump();
        } else if (ds && (ds.from === 'equipment' || ds.from === 'player-slot')) {
          const item = this.inventory.equipment[ds.slot];
          if (item) {
            stampItemDims(item);
            let placed = grid.canPlace(item, x, y, false);
            if (placed) grid.place(item, x, y, false);
            else if (!this.inventory.autoPlaceAnywhere(item)) { this._drag = null; return; }
            this.inventory.equipment[ds.slot] = null;
            this.inventory._recomputeCapacity();
            this.inventory._bump();
          }
        }
      }
      this._plGridDrag = null;
      this._drag = null;
      this.render();
    });
  }

  _wirePlayerGridWrap(wrap, grid) {
    const cellFromEvent = (e) => {
      const rect = wrap.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / (PL_CELL_PX + PL_CELL_GAP));
      const y = Math.floor((e.clientY - rect.top)  / (PL_CELL_PX + PL_CELL_GAP));
      if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) return null;
      return { x, y };
    };
    wrap.addEventListener('dragover', (e) => {
      const d = this._plGridDrag || this._drag;
      if (!d) return;
      e.preventDefault();
      const cell = cellFromEvent(e);
      if (!cell) { this._clearPlayerCellPreview(); return; }
      this._showPlayerCellPreview(grid, wrap, cell.x, cell.y);
    });
    wrap.addEventListener('dragleave', (e) => {
      if (!wrap.contains(e.relatedTarget)) this._clearPlayerCellPreview();
    });
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      this._clearPlayerCellPreview();
      const cell = cellFromEvent(e);
      if (!cell) { this._plGridDrag = null; return; }
      const { x, y } = cell;
      const d = this._plGridDrag;
      if (d && d.entry) {
        const rotated = d.rotatedPreview !== undefined ? d.rotatedPreview : d.entry.rotated;
        const tx = x - (d.pointerOffsetX | 0);
        const ty = y - (d.pointerOffsetY | 0);
        const ok = this.inventory.moveInGrid(d.item, grid, tx, ty, rotated);
        if (!ok) this.inventory.moveInGrid(d.item, grid, x, y, rotated);
      } else {
        const ds = this._drag;
        if (!ds) return;
        if (ds.from === 'body-slot' || ds.from === 'body-misc') {
          const item = this.target?.loot?.[ds.lootIdx];
          if (!item) return;
          stampItemDims(item);
          let placed = grid.canPlace(item, x, y, false);
          if (placed) grid.place(item, x, y, false);
          else if (!this.inventory.autoPlaceAnywhere(item)) return;
          this.target.loot.splice(ds.lootIdx, 1);
          const refs = this.target._groundRefs;
          if (refs && this.target._removeGround) {
            this.target._removeGround(refs[ds.lootIdx]);
            refs.splice(ds.lootIdx, 1);
          }
          this.inventory._bump();
        } else if (ds.from === 'workspace' && ds.entry) {
          const item = ds.item;
          stampItemDims(item);
          let placed = grid.canPlace(item, x, y, false);
          if (placed) grid.place(item, x, y, false);
          else if (!this.inventory.autoPlaceAnywhere(item)) return;
          this.workspaceGrid.remove(ds.entry);
          this.inventory._bump();
        } else if (ds.from === 'equipment' || ds.from === 'player-slot') {
          const item = this.inventory.equipment[ds.slot];
          if (!item) return;
          stampItemDims(item);
          let placed = grid.canPlace(item, x, y, false);
          if (placed) grid.place(item, x, y, false);
          else if (!this.inventory.autoPlaceAnywhere(item)) return;
          this.inventory.equipment[ds.slot] = null;
          this.inventory._recomputeCapacity();
          this.inventory._bump();
        }
      }
      this._plGridDrag = null;
      this._drag = null;
      this.render();
    });
  }

  _buildPlayerPocketTile(entry, grid) {
    const tile = document.createElement('div');
    tile.className = 'pocket-item';
    // Purely visual — wrap owns pointerdown / contextmenu via
    // `_wirePlayerGridCustomDrag`. Keeps child <img> from hijacking
    // the drag.
    tile.style.pointerEvents = 'none';
    tile.style.left   = `${entry.x * (PL_CELL_PX + PL_CELL_GAP)}px`;
    tile.style.top    = `${entry.y * (PL_CELL_PX + PL_CELL_GAP)}px`;
    tile.style.width  = `${entry.w * PL_CELL_PX + (entry.w - 1) * PL_CELL_GAP}px`;
    tile.style.height = `${entry.h * PL_CELL_PX + (entry.h - 1) * PL_CELL_GAP}px`;
    const rarity = inferRarity(entry.item);
    tile.classList.add(`rarity-${rarity}`); if (entry.item?.mastercraft || entry.mastercraft) tile.classList.add("mastercraft");
    if (entry.rotated) tile.classList.add('rotated');
    const thumb = thumbnailFor(entry.item);
    const label = (entry.item.name || '').toString();
    const dur = entry.item.durability;
    const durPct = dur ? Math.max(0, Math.min(100, (dur.current / dur.max) * 100)) : -1;
    const ammoLine = (entry.item.type === 'ranged' && typeof entry.item.ammo === 'number')
      ? `<span class="pkt-ammo">${entry.item.ammo}/${entry.item.magSize ?? '—'}</span>`
      : '';
    tile.innerHTML = `
      ${thumb ? `<img class="pkt-thumb" src="${thumb}" alt="" draggable="false" style="${weaponImageMirrorStyle(entry.item)}">` : `<span class="pkt-glyph">${TYPE_ICONS[entry.item.type] || '◇'}</span>`}
      <div class="pkt-name">${label}</div>
      ${durPct >= 0 ? `<div class="pkt-dur"><div class="pkt-dur-fill" style="width:${durPct.toFixed(0)}%;background:${durPct > 60 ? '#6abe8a' : durPct > 30 ? '#e0c040' : '#d24040'}"></div></div>` : ''}
      ${ammoLine}
    `;
    return tile;
  }

  // Custom pointer-driven drag for player pockets/rig/backpack/pouch
  // inside the loot modal. Matches the pattern in ui_inventory.js —
  // wrap owns all input, tiles are pointer-events: none, and drop
  // targets are resolved via `elementFromPoint`. Supported drop
  // targets: other player grids, player paperdoll slots, workspace
  // grid, body misc grid, body paperdoll slots.
  _wirePlayerGridCustomDrag(wrap, grid) {
    const DRAG_THRESHOLD = 4;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = wrap.getBoundingClientRect();
      const gx = Math.floor((e.clientX - rect.left) / (PL_CELL_PX + PL_CELL_GAP));
      const gy = Math.floor((e.clientY - rect.top)  / (PL_CELL_PX + PL_CELL_GAP));
      if (gx < 0 || gy < 0 || gx >= grid.w || gy >= grid.h) return;
      const entry = grid.at(gx, gy);
      if (!entry) return;
      e.preventDefault();
      const item = entry.item;
      const startX = e.clientX, startY = e.clientY;
      let dragging = false;
      let ghost = null;
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (ghost) { ghost.remove(); ghost = null; }
        this._plGridDrag = null;
        this._drag = null;
        this._clearPlayerCellPreview();
        this._clearDragUI();
      };
      const startDrag = (ev) => {
        dragging = true;
        const thumb = thumbnailFor(item);
        ghost = document.createElement('div');
        ghost.className = `pocket-item custom-drag-ghost rarity-${inferRarity(item)}`;
        ghost.style.position = 'fixed';
        ghost.style.pointerEvents = 'none';
        ghost.style.opacity = '0.9';
        ghost.style.zIndex = '9999';
        ghost.style.width  = `${PL_CELL_PX}px`;
        ghost.style.height = `${PL_CELL_PX}px`;
        ghost.style.left = `${ev.clientX - PL_CELL_PX / 2}px`;
        ghost.style.top  = `${ev.clientY - PL_CELL_PX / 2}px`;
        ghost.innerHTML = `
          ${thumb ? `<img class="pkt-thumb" src="${thumb}" alt="" draggable="false" style="${weaponImageMirrorStyle(item)}">` : `<span class="pkt-glyph">${TYPE_ICONS[item.type] || '◇'}</span>`}
          <div class="pkt-name">${(item.name || '').toString()}</div>
        `;
        document.body.appendChild(ghost);
        this._plGridDrag = { item, entry, fromGrid: grid };
        this._drag = { from: 'pockets', item, entry, fromGrid: grid };
        this._highlightCompatibleSlots(item);
      };
      const onMove = (ev) => {
        if (!dragging) {
          const dx = ev.clientX - startX, dy = ev.clientY - startY;
          if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
          startDrag(ev);
        }
        if (ghost) {
          ghost.style.left = `${ev.clientX - PL_CELL_PX / 2}px`;
          ghost.style.top  = `${ev.clientY - PL_CELL_PX / 2}px`;
        }
        this._updateCustomLootPreview(ev.clientX, ev.clientY);
      };
      const onUp = (ev) => {
        if (!dragging) {
          cleanup();
          // Plain click — route to inspect / shift-take manually.
          if (ev.shiftKey) {
            const g = this.inventory.gridOf(item);
            if (g) g.remove(item);
            if (this.target && !this.bodyHidden) {
              item._lootForcedPile = true;
              this.target.loot = this.target.loot || [];
              this.target.loot.push(item);
            } else if (this.onDrop) {
              this.onDrop(item);
            }
            this.inventory._bump();
            this.render();
          } else if (item && window.__showDetails) {
            window.__showDetails(item);
          }
          return;
        }
        this._performCustomLootDrop(ev.clientX, ev.clientY, item, grid, entry);
        cleanup();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const gx = Math.floor((e.clientX - rect.left) / (PL_CELL_PX + PL_CELL_GAP));
      const gy = Math.floor((e.clientY - rect.top)  / (PL_CELL_PX + PL_CELL_GAP));
      if (gx < 0 || gy < 0 || gx >= grid.w || gy >= grid.h) return;
      const entry = grid.at(gx, gy);
      if (!entry) return;
      // Right-click = equip to first compatible slot.
      const ok = this.inventory.equipBackpack(entry.item);
      if (ok) {
        this.render();
      } else {
        const err = this.inventory.lastEquipError;
        if (err === 'tooSmallForBag') {
          window.__hudMsg?.('Too many items to swap bags — use the workspace to make room.', 3.0);
        } else if (err === 'tooSmallForRig') {
          window.__hudMsg?.('Too many items to swap rigs — use the workspace to make room.', 3.0);
        }
      }
    });
  }

  // Walk up from an element to the nearest ancestor matching the
  // selector (inclusive). Used by the custom drag hit-tester.
  _closestLoot(el, selector) {
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.matches && cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  _updateCustomLootPreview(clientX, clientY) {
    this._clearPlayerCellPreview();
    this._clearWsPreview?.();
    this._clearBgPreview?.();
    // Clear lingering drop-ok highlights from all slot lists.
    document.querySelectorAll('#loot-player-slots .drop-ok, #loot-slots .drop-ok')
      .forEach(el => el.classList.remove('drop-ok'));
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) return;
    const item = (this._plGridDrag && this._plGridDrag.item)
              || (this._drag && this._drag.item);
    const wrap = this._closestLoot(target, '.pockets-grid');
    if (wrap) {
      const blk = this._plGridBlocks.find(b => b.wrap === wrap);
      if (!blk) return;
      const rect = wrap.getBoundingClientRect();
      const x = Math.floor((clientX - rect.left) / (PL_CELL_PX + PL_CELL_GAP));
      const y = Math.floor((clientY - rect.top)  / (PL_CELL_PX + PL_CELL_GAP));
      if (x >= 0 && y >= 0 && x < blk.grid.w && y < blk.grid.h) {
        this._showPlayerCellPreview(blk.grid, wrap, x, y);
      }
      return;
    }
    const slot = this._closestLoot(target, '.inv-slot.loot-slot');
    if (slot) {
      const slotId = slot.dataset.slot;
      if (item && this.inventory.canSlotHold?.(slotId, item)) {
        slot.classList.add('drop-ok');
      }
      return;
    }
    const ws = this._closestLoot(target, '#loot-workspace-grid');
    if (ws && item) {
      const rect = this.workspaceEl.getBoundingClientRect();
      const x = Math.floor((clientX - rect.left) / (WS_CELL_PX + WS_CELL_GAP));
      const y = Math.floor((clientY - rect.top)  / (WS_CELL_PX + WS_CELL_GAP));
      if (x >= 0 && y >= 0 && x < this.workspaceGrid.w && y < this.workspaceGrid.h) {
        stampItemDims(item);
        this._showWsPreview(item, x, y, false, null);
      }
      return;
    }
    const bg = this._closestLoot(target, '#loot-misc-grid');
    if (bg && item) {
      const rect = this.miscEl.getBoundingClientRect();
      const x = Math.floor((clientX - rect.left) / (BG_CELL_PX + BG_CELL_GAP));
      const y = Math.floor((clientY - rect.top)  / (BG_CELL_PX + BG_CELL_GAP));
      if (x >= 0 && y >= 0 && x < this.bodyGrid.w && y < this.bodyGrid.h) {
        stampItemDims(item);
        this._showBgPreview(item, x, y);
      }
    }
  }

  _performCustomLootDrop(clientX, clientY, item, fromGrid, entry) {
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) return;
    const srcGrid = this.inventory.gridOf(item) || fromGrid;
    // Drop onto a player pockets / rig / backpack / pouch grid.
    const wrap = this._closestLoot(target, '.pockets-grid');
    if (wrap) {
      const blk = this._plGridBlocks.find(b => b.wrap === wrap);
      if (!blk) return;
      const rect = wrap.getBoundingClientRect();
      const x = Math.floor((clientX - rect.left) / (PL_CELL_PX + PL_CELL_GAP));
      const y = Math.floor((clientY - rect.top)  / (PL_CELL_PX + PL_CELL_GAP));
      if (x < 0 || y < 0 || x >= blk.grid.w || y >= blk.grid.h) return;
      const ok = this.inventory.moveInGrid(item, blk.grid, x, y, false);
      if (!ok && srcGrid !== blk.grid) {
        srcGrid.remove(item);
        if (!blk.grid.autoPlace(item)) this.inventory.autoPlaceAnywhere(item);
        this.inventory._bump();
      }
      this.render();
      return;
    }
    // Drop onto a player paperdoll slot — equip.
    const playerSlot = this._closestLoot(target, '.inv-slot.loot-slot-player');
    if (playerSlot) {
      const slotId = playerSlot.dataset.slot;
      if (!this.inventory.canSlotHold(slotId, item)) return;
      const prev = this.inventory.equipment[slotId];
      srcGrid.remove(item);
      this.inventory.equipment[slotId] = item;
      this.inventory._recomputeCapacity?.();
      if (prev && !this.inventory.autoPlaceAnywhere(prev)) {
        this.inventory.equipment[slotId] = prev;
        this.inventory._recomputeCapacity?.();
        this.inventory.autoPlaceAnywhere(item);
      }
      this.inventory._bump();
      this.render();
      return;
    }
    // Drop onto workspace — stage.
    const wsWrap = this._closestLoot(target, '#loot-workspace-grid');
    if (wsWrap) {
      stampItemDims(item);
      if (this.workspaceGrid.autoPlace(item)) {
        srcGrid.remove(item);
        this.inventory._bump();
      }
      this.render();
      return;
    }
    // Drop onto body misc grid — transfer to body's loot pile.
    const bodyMisc = this._closestLoot(target, '#loot-misc-grid');
    if (bodyMisc && this.target && !this.bodyHidden) {
      srcGrid.remove(item);
      item._lootForcedPile = true;
      this.target.loot = this.target.loot || [];
      this.target.loot.push(item);
      this.inventory._bump();
      this.render();
      return;
    }
    // Drop onto a body paperdoll slot (a "give" action — rare but
    // supported for symmetry).
    const bodySlot = this._closestLoot(target, '.inv-slot.loot-slot:not(.loot-slot-player)');
    if (bodySlot && this.target && !this.bodyHidden) {
      srcGrid.remove(item);
      this.target.loot = this.target.loot || [];
      this.target.loot.push(item);
      this.inventory._bump();
      this.render();
      return;
    }
  }

  _showPlayerCellPreview(grid, wrap, x, y) {
    this._clearPlayerCellPreview();
    const d = this._plGridDrag || this._drag;
    if (!d) return;
    const item = d.item || this._resolveDragItem(d);
    if (!item) return;
    stampItemDims(item);
    const rotated = this._plGridDrag ? this._plGridDrag.rotatedPreview : false;
    const w = rotated ? (item.h || 1) : (item.w || 1);
    const h = rotated ? (item.w || 1) : (item.h || 1);
    const offX = this._plGridDrag ? (this._plGridDrag.pointerOffsetX | 0) : 0;
    const offY = this._plGridDrag ? (this._plGridDrag.pointerOffsetY | 0) : 0;
    const tx = x - offX;
    const ty = y - offY;
    const ignore = (this._plGridDrag && this.inventory.gridOf(item) === grid) ? this._plGridDrag.entry : null;
    const ok = grid.canPlace(item, tx, ty, rotated, ignore);
    const preview = document.createElement('div');
    preview.className = `pocket-preview ${ok ? 'ok' : 'bad'}`;
    preview.style.left   = `${Math.max(0, tx) * (PL_CELL_PX + PL_CELL_GAP)}px`;
    preview.style.top    = `${Math.max(0, ty) * (PL_CELL_PX + PL_CELL_GAP)}px`;
    preview.style.width  = `${w * PL_CELL_PX + (w - 1) * PL_CELL_GAP}px`;
    preview.style.height = `${h * PL_CELL_PX + (h - 1) * PL_CELL_GAP}px`;
    wrap.appendChild(preview);
    this._plPreviewEl = preview;
  }
  _clearPlayerCellPreview() {
    if (this._plPreviewEl) {
      this._plPreviewEl.remove();
      this._plPreviewEl = null;
    }
  }

  // ——— body loot pile (footprint grid) ——————————————————————————————

  _buildBodyGrid() {
    if (!this.miscEl) return;
    this.miscEl.innerHTML = '';
    this.miscEl.classList.add('as-footprint-grid');
    const grid = this.bodyGrid;
    // If the body has no equipment-slot items either AND the grid is
    // empty, surface a clear "Nothing on the body" message instead
    // of a silent empty grid. Equipment-slot drops still render
    // through their own _slotCells, so we only show the empty-state
    // when the entire body is bare.
    const hasSlotItems = Object.keys(this._bySlot || {}).length > 0;
    if (grid.entries().length === 0 && !hasSlotItems) {
      this.miscEl.style.width  = '';
      this.miscEl.style.height = '';
      this.miscEl.classList.add('body-empty');
      const empty = document.createElement('div');
      empty.className = 'body-empty-msg';
      empty.textContent = this.target?.kind === 'container'
        ? 'Nothing here'
        : 'Nothing on the body';
      this.miscEl.appendChild(empty);
      this._wireBodyGridWrap();
      return;
    }
    this.miscEl.classList.remove('body-empty');
    this.miscEl.style.width  = `${grid.w * BG_CELL_PX + (grid.w - 1) * BG_CELL_GAP}px`;
    this.miscEl.style.height = `${grid.h * BG_CELL_PX + (grid.h - 1) * BG_CELL_GAP}px`;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const c = document.createElement('div');
        c.className = 'bg-cell';
        c.style.left = `${x * (BG_CELL_PX + BG_CELL_GAP)}px`;
        c.style.top  = `${y * (BG_CELL_PX + BG_CELL_GAP)}px`;
        c.style.width  = `${BG_CELL_PX}px`;
        c.style.height = `${BG_CELL_PX}px`;
        c.style.pointerEvents = 'none';
        this.miscEl.appendChild(c);
      }
    }
    for (const entry of grid.entries()) {
      const tile = this._buildBodyGridTile(entry);
      this.miscEl.appendChild(tile);
    }
    this._wireBodyGridWrap();
    this._wireBodyGridCustomDrag();
  }

  // Pointer-driven drag for body-loot tiles. Mirrors the player
  // pocket custom drag — tiles are pointer-events:none, the wrap
  // owns pointerdown, and `grid.at(gx, gy)` resolves which loot
  // entry was clicked. Drop targets include player grids, player
  // paperdoll slots, workspace, and other cells on the body grid
  // itself (reorder within the body).
  _wireBodyGridCustomDrag() {
    const wrap = this.miscEl;
    if (!wrap || wrap._bodyCustomWired) return;
    wrap._bodyCustomWired = true;
    const DRAG_THRESHOLD = 4;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = wrap.getBoundingClientRect();
      const gx = Math.floor((e.clientX - rect.left) / (BG_CELL_PX + BG_CELL_GAP));
      const gy = Math.floor((e.clientY - rect.top)  / (BG_CELL_PX + BG_CELL_GAP));
      if (gx < 0 || gy < 0 || gx >= this.bodyGrid.w || gy >= this.bodyGrid.h) return;
      const entry = this.bodyGrid.at(gx, gy);
      if (!entry) return;
      e.preventDefault();
      const item = entry.item;
      const lootIdx = this._bodyLootIdx.get(item);
      const startX = e.clientX, startY = e.clientY;
      let dragging = false;
      let ghost = null;
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (ghost) { ghost.remove(); ghost = null; }
        this._drag = null;
        this._clearPlayerCellPreview();
        this._clearBgPreview();
        this._clearDragUI();
      };
      const startDrag = (ev) => {
        dragging = true;
        const thumb = thumbnailFor(item);
        ghost = document.createElement('div');
        ghost.className = `bg-tile custom-drag-ghost rarity-${inferRarity(item)}`;
        ghost.style.position = 'fixed';
        ghost.style.pointerEvents = 'none';
        ghost.style.opacity = '0.9';
        ghost.style.zIndex = '9999';
        ghost.style.width  = `${BG_CELL_PX}px`;
        ghost.style.height = `${BG_CELL_PX}px`;
        ghost.style.left = `${ev.clientX - BG_CELL_PX / 2}px`;
        ghost.style.top  = `${ev.clientY - BG_CELL_PX / 2}px`;
        ghost.innerHTML = `
          ${thumb ? `<img class="ws-thumb" src="${thumb}" alt="" draggable="false">` : `<span class="ws-glyph">${TYPE_ICONS[item.type] || '◇'}</span>`}
          <div class="ws-name">${(item.name || '').toString()}</div>
        `;
        document.body.appendChild(ghost);
        this._drag = { from: 'body-misc', lootIdx, item, entry };
        this._highlightCompatibleSlots(item);
      };
      const onMove = (ev) => {
        if (!dragging) {
          const dx = ev.clientX - startX, dy = ev.clientY - startY;
          if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
          startDrag(ev);
        }
        if (ghost) {
          ghost.style.left = `${ev.clientX - BG_CELL_PX / 2}px`;
          ghost.style.top  = `${ev.clientY - BG_CELL_PX / 2}px`;
        }
        this._updateCustomLootPreview(ev.clientX, ev.clientY);
      };
      const onUp = (ev) => {
        if (!dragging) {
          // Plain click / shift-click fallbacks. Shift+left-click on a
          // loot-pile item moves the item into the player's bag without
          // equipping (use shift+right-click to force-equip — see the
          // contextmenu handler below).
          cleanup();
          if (ev.shiftKey) {
            this._takeOne(lootIdx);
            this.render();
          } else if (item && window.__showDetails) {
            window.__showDetails(item);
          }
          return;
        }
        this._performCustomBodyDrop(ev.clientX, ev.clientY, item, lootIdx);
        cleanup();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const gx = Math.floor((e.clientX - rect.left) / (BG_CELL_PX + BG_CELL_GAP));
      const gy = Math.floor((e.clientY - rect.top)  / (BG_CELL_PX + BG_CELL_GAP));
      if (gx < 0 || gy < 0 || gx >= this.bodyGrid.w || gy >= this.bodyGrid.h) return;
      const entry = this.bodyGrid.at(gx, gy);
      if (!entry) return;
      const lootIdx = this._bodyLootIdx.get(entry.item);
      if (e.shiftKey) this._takeAndEquip(lootIdx);
      else this._takeOne(lootIdx);
    });
  }

  // Drop handler for items dragged out of the body misc grid.
  // Routes via elementFromPoint to the same destinations as the
  // player-side drop router (player grids, slots, workspace) plus
  // the body grid itself (reorder within the body pile).
  _performCustomBodyDrop(clientX, clientY, item, lootIdx) {
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) return;
    const removeFromBody = () => {
      if (lootIdx == null || !this.target) return;
      const idx = this.target.loot.indexOf(item);
      const actualIdx = idx >= 0 ? idx : lootIdx;
      this.target.loot.splice(actualIdx, 1);
      const refs = this.target._groundRefs;
      if (refs && this.target._removeGround) {
        this.target._removeGround(refs[actualIdx]);
        refs.splice(actualIdx, 1);
      }
    };
    // Drop onto a player pockets / rig / backpack / pouch grid.
    const wrap = this._closestLoot(target, '.pockets-grid');
    if (wrap) {
      const blk = this._plGridBlocks.find(b => b.wrap === wrap);
      if (!blk) return;
      const rect = wrap.getBoundingClientRect();
      const x = Math.floor((clientX - rect.left) / (PL_CELL_PX + PL_CELL_GAP));
      const y = Math.floor((clientY - rect.top)  / (PL_CELL_PX + PL_CELL_GAP));
      if (x < 0 || y < 0 || x >= blk.grid.w || y >= blk.grid.h) return;
      // Attachment dropped onto a grid cell containing a compatible weapon.
      if (item.type === 'attachment') {
        const cellEntry = blk.grid.at(x, y);
        const cellItem = cellEntry?.item;
        if (cellItem && (cellItem.type === 'ranged' || cellItem.type === 'melee')
            && cellItem.attachments && (item.slot in cellItem.attachments)) {
          if (this.inventory.attachToWeapon(cellItem, item.slot, item)) {
            removeFromBody();
            this.render();
          }
          return;
        }
      }
      // Repair kit dragged out of the body onto an inventory cell
      // holding an armor / gear / weapon → repair the target. Body-
      // side path is special-cased: kit lives in target.loot, not in
      // any inventory grid, so we manually mirror the durability bump
      // applyRepairKit performs and remove the kit (or decrement count).
      if (item.type === 'repairkit') {
        const cellEntry = blk.grid.at(x, y);
        const cellItem = cellEntry?.item;
        if (cellItem) {
          const consumed = _bodyApplyRepairKit(item, cellItem);
          if (consumed) {
            const count = (item.count | 0) || 1;
            if (count > 1) item.count = count - 1;
            else removeFromBody();
            this.inventory._bump?.();
            this.render();
            return;
          }
        }
      }
      stampItemDims(item);
      let placed = blk.grid.canPlace(item, x, y, false);
      if (placed) blk.grid.place(item, x, y, false);
      else if (!this.inventory.autoPlaceAnywhere(item)) return;
      removeFromBody();
      this.inventory._bump();
      this.render();
      return;
    }
    // Drop onto a player paperdoll slot — equip.
    const playerSlot = this._closestLoot(target, '.inv-slot.loot-slot-player');
    if (playerSlot) {
      const slotId = playerSlot.dataset.slot;
      // Attachment dropped onto a paperdoll slot holding a compatible weapon.
      if (item.type === 'attachment') {
        const equipped = this.inventory.equipment[slotId];
        if (equipped && (equipped.type === 'ranged' || equipped.type === 'melee')
            && equipped.attachments && (item.slot in equipped.attachments)) {
          if (this.inventory.attachToWeapon(equipped, item.slot, item)) {
            removeFromBody();
            this.render();
          }
          return;
        }
      }
      // Repair kit dragged out of the body onto an equipped paperdoll
      // slot → repair the equipped item. Same body-side consumption
      // path as the grid-cell branch above.
      if (item.type === 'repairkit') {
        const equipped = this.inventory.equipment[slotId];
        if (equipped) {
          const consumed = _bodyApplyRepairKit(item, equipped);
          if (consumed) {
            const count = (item.count | 0) || 1;
            if (count > 1) item.count = count - 1;
            else removeFromBody();
            this.inventory._bump?.();
            this.render();
            return;
          }
        }
      }
      if (!this.inventory.canSlotHold(slotId, item)) return;
      const prev = this.inventory.equipment[slotId];
      this.inventory.equipment[slotId] = item;
      this.inventory._recomputeCapacity?.();
      if (prev && !this.inventory.autoPlaceAnywhere(prev)) {
        this.inventory.equipment[slotId] = prev;
        this.inventory._recomputeCapacity?.();
        return;
      }
      removeFromBody();
      this.inventory._bump();
      this.render();
      return;
    }
    // Drop onto workspace.
    const wsWrap = this._closestLoot(target, '#loot-workspace-grid');
    if (wsWrap) {
      stampItemDims(item);
      if (this.workspaceGrid.autoPlace(item)) {
        removeFromBody();
        this.render();
      }
      return;
    }
    // Drop onto the body grid itself — reorder within the pile.
    // Everything already lives in `this.target.loot`; the render pass
    // re-packs the grid so a visual move is effectively a no-op, but
    // return cleanly to avoid the drag vanishing the item.
    const bodyWrap = this._closestLoot(target, '#loot-misc-grid');
    if (bodyWrap) {
      this.render();
      return;
    }
  }

  _wireBgTileAsDropTarget(tile) {
    tile.addEventListener('dragover', (e) => {
      const d = this._drag;
      if (!d) return;
      if (d.from !== 'player-bag' && d.from !== 'player-slot'
       && d.from !== 'workspace' && d.from !== 'pockets') return;
      e.preventDefault();
      const rect = this.miscEl.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / (BG_CELL_PX + BG_CELL_GAP));
      const y = Math.floor((e.clientY - rect.top)  / (BG_CELL_PX + BG_CELL_GAP));
      if (x < 0 || y < 0 || x >= this.bodyGrid.w || y >= this.bodyGrid.h) {
        this._clearBgPreview(); return;
      }
      const item = this._resolveDragItem(d) || d.item;
      if (item) {
        stampItemDims(item);
        this._showBgPreview(item, x, y);
      }
    });
    tile.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._clearBgPreview();
      const d = this._drag;
      if (!d) return;
      if (d.from === 'player-bag' || d.from === 'player-slot') {
        this._giveFromPlayer(d);
      } else if (d.from === 'pockets' && d.entry) {
        const g = this.inventory.gridOf(d.item);
        if (g) g.remove(d.item);
        this.target.loot = this.target.loot || [];
        this.target.loot.push(d.item);
        this.inventory._bump();
        this.render();
      } else if (d.from === 'workspace' && d.entry) {
        this.workspaceGrid.remove(d.entry);
        this.target.loot = this.target.loot || [];
        this.target.loot.push(d.item);
        this.render();
      }
      this._drag = null;
    });
  }

  _wireBodyGridWrap() {
    const wrap = this.miscEl;
    if (wrap._wrapWired) return;
    wrap._wrapWired = true;
    const cellFromEvent = (e) => {
      const rect = wrap.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / (BG_CELL_PX + BG_CELL_GAP));
      const y = Math.floor((e.clientY - rect.top)  / (BG_CELL_PX + BG_CELL_GAP));
      if (x < 0 || y < 0 || x >= this.bodyGrid.w || y >= this.bodyGrid.h) return null;
      return { x, y };
    };
    wrap.addEventListener('dragover', (e) => {
      const d = this._drag;
      if (!d) return;
      if (d.from !== 'player-bag' && d.from !== 'player-slot'
       && d.from !== 'workspace' && d.from !== 'pockets') return;
      e.preventDefault();
      const cell = cellFromEvent(e);
      if (!cell) { this._clearBgPreview(); return; }
      const item = this._resolveDragItem(d) || d.item;
      if (item) {
        stampItemDims(item);
        this._showBgPreview(item, cell.x, cell.y);
      }
    });
    wrap.addEventListener('dragleave', (e) => {
      if (!wrap.contains(e.relatedTarget)) this._clearBgPreview();
    });
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      this._clearBgPreview();
      const d = this._drag;
      if (!d) return;
      if (d.from === 'player-bag' || d.from === 'player-slot') {
        this._giveFromPlayer(d);
      } else if (d.from === 'pockets' && d.entry) {
        const g = this.inventory.gridOf(d.item);
        if (g) g.remove(d.item);
        this.target.loot = this.target.loot || [];
        this.target.loot.push(d.item);
        this.inventory._bump();
        this.render();
      } else if (d.from === 'workspace' && d.entry) {
        this.workspaceGrid.remove(d.entry);
        this.target.loot = this.target.loot || [];
        this.target.loot.push(d.item);
        this.render();
      }
      this._drag = null;
    });
  }

  _buildBodyGridTile(entry) {
    const tile = document.createElement('div');
    tile.className = 'bg-tile';
    // Visual only — wrap owns pointerdown via `_wireBodyGridCustomDrag`.
    tile.style.pointerEvents = 'none';
    const rarity = inferRarity(entry.item);
    tile.classList.add(`rarity-${rarity}`); if (entry.item?.mastercraft || entry.mastercraft) tile.classList.add("mastercraft");
    tile.style.left   = `${entry.x * (BG_CELL_PX + BG_CELL_GAP)}px`;
    tile.style.top    = `${entry.y * (BG_CELL_PX + BG_CELL_GAP)}px`;
    tile.style.width  = `${BG_CELL_PX}px`;
    tile.style.height = `${BG_CELL_PX}px`;
    const thumb = thumbnailFor(entry.item);
    const ammo = (entry.item.type === 'ranged' && typeof entry.item.ammo === 'number')
      ? `<span class="ws-ammo">${entry.item.ammo}/${entry.item.magSize ?? '—'}</span>`
      : '';
    // Bonuses summary — surface affixes / perks / set membership so
    // the player can read what's worth taking without right-clicking
    // every loot pile. Capped at 3 lines so a heavily-rolled item
    // doesn't blow out the tile height; an overflow indicator shows
    // when more bonuses exist than fit.
    const bonusLines = [];
    const affixes = (entry.item.affixes || []).filter(a => a.kind !== 'setMark');
    for (const a of affixes) bonusLines.push({ kind: 'affix', text: a.label });
    const perks = entry.item.perks || [];
    for (const p of perks) bonusLines.push({ kind: 'perk', text: `◆ ${p.name}` });
    const setMark = (entry.item.affixes || []).find(a => a.kind === 'setMark');
    if (setMark) bonusLines.push({ kind: 'set', text: setMark.label });
    let bonusHtml = '';
    if (bonusLines.length) {
      const shown = bonusLines.slice(0, 3);
      const more = bonusLines.length - shown.length;
      bonusHtml = `<div class="ws-bonuses">
        ${shown.map(b => `<div class="ws-bonus ws-bonus-${b.kind}">${b.text}</div>`).join('')}
        ${more > 0 ? `<div class="ws-bonus-more">+${more} more</div>` : ''}
      </div>`;
    }
    const dur = entry.item.durability;
    const isBroken = dur && dur.current <= 0;
    if (isBroken) tile.classList.add('item-broken');
    const brokenTag = isBroken ? `<div class="pkt-broken-tag">BROKEN</div>` : '';
    const count = (entry.item.count | 0) || 1;
    const stackBadge = ((entry.item.type === 'consumable' || entry.item.type === 'junk') && count > 1)
      ? `<span class="pkt-stack">×${count}</span>` : '';
    // Keep / junk tag — same .cell-mark-tag the equipment cells +
    // shop cells render via renderItemCell. Body-loot tile builds
    // its own HTML so the tag has to be threaded in here too.
    const markBadge = entry.item.markedJunk
      ? `<div class="cell-mark-tag mark-junk pkt-mark-tag" title="Marked as Junk">JUNK</div>`
      : entry.item.markedKeep
      ? `<div class="cell-mark-tag mark-keep pkt-mark-tag" title="Marked to Keep">KEEP</div>`
      : '';
    tile.innerHTML = `
      ${thumb ? `<img class="ws-thumb" src="${thumb}" alt="" draggable="false">` : `<span class="ws-glyph">${TYPE_ICONS[entry.item.type] || '◇'}</span>`}
      ${brokenTag}
      ${stackBadge}
      ${markBadge}
      <div class="ws-name">${entry.item.name || ''}</div>
      ${ammo}
      ${bonusHtml}
    `;
    return tile;
  }

  _showBgPreview(item, x, y) {
    this._clearBgPreview();
    const iw = Math.max(1, (item.w | 0) || 1);
    const ih = Math.max(1, (item.h | 0) || 1);
    const w = iw, h = ih;
    const ok = this.bodyGrid.canPlace(item, x, y, false);
    const preview = document.createElement('div');
    preview.className = `ws-preview ${ok ? 'ok' : 'bad'}`;
    preview.style.left   = `${Math.max(0, x) * (BG_CELL_PX + BG_CELL_GAP)}px`;
    preview.style.top    = `${Math.max(0, y) * (BG_CELL_PX + BG_CELL_GAP)}px`;
    preview.style.width  = `${w * BG_CELL_PX + (w - 1) * BG_CELL_GAP}px`;
    preview.style.height = `${h * BG_CELL_PX + (h - 1) * BG_CELL_GAP}px`;
    this.miscEl.appendChild(preview);
    this._bgPreviewEl = preview;
  }
  _clearBgPreview() {
    if (this._bgPreviewEl) {
      this._bgPreviewEl.remove();
      this._bgPreviewEl = null;
    }
  }

  // ——— workspace (staging grid) ————————————————————————————————————

  // Overflow path used by inventory.placeOrOverflow when no container
  // grid has room. Tries autoPlace; if that fails because the
  // workspace is full, grows it wide enough to fit the item and
  // tries again. Always returns true (the workspace is unbounded).
  _pushToWorkspace(item) {
    stampItemDims(item);
    if (this.workspaceGrid.autoPlace(item)) {
      this.render();
      return true;
    }
    // Need more room. Grow width by max(item.w, 4) so we don't have
    // to resize on every overflow. Item dims are 1×1..3×3 typically.
    const need = Math.max(2, (item.w | 0) || 1, (item.h | 0) || 1);
    const newW = this.workspaceGrid.w + Math.max(4, need * 2);
    const newH = Math.max(this.workspaceGrid.h, need);
    this.workspaceGrid.resize(newW, newH);
    if (this.workspaceGrid.autoPlace(item)) {
      this.render();
      return true;
    }
    // Pathological — item bigger than the grid even after growth.
    // Grow once more big enough to cover it.
    this.workspaceGrid.resize(newW + need, Math.max(newH, need));
    this.workspaceGrid.autoPlace(item);
    this.render();
    return true;
  }

  _buildWorkspace() {
    if (!this.workspaceEl) return;
    this.workspaceEl.innerHTML = '';
    this._wsTiles = new Map();
    const grid = this.workspaceGrid;
    this.workspaceEl.style.width  = `${grid.w * WS_CELL_PX + (grid.w - 1) * WS_CELL_GAP}px`;
    this.workspaceEl.style.height = `${grid.h * WS_CELL_PX + (grid.h - 1) * WS_CELL_GAP}px`;
    // Cells are purely visual backing; events handled at wrap level.
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const c = document.createElement('div');
        c.className = 'ws-cell';
        c.style.left = `${x * (WS_CELL_PX + WS_CELL_GAP)}px`;
        c.style.top  = `${y * (WS_CELL_PX + WS_CELL_GAP)}px`;
        c.style.width  = `${WS_CELL_PX}px`;
        c.style.height = `${WS_CELL_PX}px`;
        c.style.pointerEvents = 'none';
        this.workspaceEl.appendChild(c);
      }
    }
    for (const entry of grid.entries()) {
      const tile = this._buildWsTile(entry);
      this._wireWsTileAsDropTarget(tile);
      this.workspaceEl.appendChild(tile);
      this._wsTiles.set(entry, tile);
    }
    this._wireWorkspaceWrap();
  }

  _wireWsTileAsDropTarget(tile) {
    tile.addEventListener('dragover', (e) => {
      const d = this._drag;
      if (!d) return;
      e.preventDefault();
      const rect = this.workspaceEl.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / (WS_CELL_PX + WS_CELL_GAP));
      const y = Math.floor((e.clientY - rect.top)  / (WS_CELL_PX + WS_CELL_GAP));
      if (x < 0 || y < 0 || x >= this.workspaceGrid.w || y >= this.workspaceGrid.h) {
        this._clearWsPreview(); return;
      }
      const item = d.item || this._resolveDragItem(d);
      if (!item) return;
      stampItemDims(item);
      const rotated = this._wsDrag ? this._wsDrag.rotatedPreview : false;
      const offX = this._wsDrag ? (this._wsDrag.pointerOffsetX | 0) : 0;
      const offY = this._wsDrag ? (this._wsDrag.pointerOffsetY | 0) : 0;
      const ignore = this._wsDrag ? this._wsDrag.entry : null;
      this._showWsPreview(item, x - offX, y - offY, rotated, ignore);
    });
    tile.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._clearWsPreview();
      const d = this._drag;
      if (!d) return;
      const rect = this.workspaceEl.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / (WS_CELL_PX + WS_CELL_GAP));
      const y = Math.floor((e.clientY - rect.top)  / (WS_CELL_PX + WS_CELL_GAP));
      if (x < 0 || y < 0 || x >= this.workspaceGrid.w || y >= this.workspaceGrid.h) return;
      const rotated = this._wsDrag ? this._wsDrag.rotatedPreview : false;
      const offX = this._wsDrag ? (this._wsDrag.pointerOffsetX | 0) : 0;
      const offY = this._wsDrag ? (this._wsDrag.pointerOffsetY | 0) : 0;
      const tx = x - offX;
      const ty = y - offY;
      if (d.from === 'workspace' && d.entry) {
        if (!this.workspaceGrid.move(d.entry, tx, ty, rotated)) {
          this.workspaceGrid.move(d.entry, x, y, rotated);
        }
      } else {
        const item = this._resolveDragItem(d);
        if (!item) return;
        stampItemDims(item);
        if (this.workspaceGrid.canPlace(item, tx, ty, rotated)) {
          this.workspaceGrid.place(item, tx, ty, rotated);
        } else if (!this.workspaceGrid.autoPlace(item)) {
          return;
        }
        this._consumeDragSource(d, item);
      }
      this._wsDrag = null;
      this._drag = null;
      this.render();
    });
  }

  _wireWorkspaceWrap() {
    const wrap = this.workspaceEl;
    if (wrap._wrapWired) return;
    wrap._wrapWired = true;
    const cellFromEvent = (e) => {
      const rect = wrap.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / (WS_CELL_PX + WS_CELL_GAP));
      const y = Math.floor((e.clientY - rect.top)  / (WS_CELL_PX + WS_CELL_GAP));
      if (x < 0 || y < 0 || x >= this.workspaceGrid.w || y >= this.workspaceGrid.h) return null;
      return { x, y };
    };
    wrap.addEventListener('dragover', (e) => {
      const d = this._drag;
      if (!d) return;
      e.preventDefault();
      const item = (d.from === 'workspace') ? d.item : this._resolveDragItem(d);
      if (!item) return;
      stampItemDims(item);
      const cell = cellFromEvent(e);
      if (!cell) { this._clearWsPreview(); return; }
      const rotated = this._wsDrag ? this._wsDrag.rotatedPreview : false;
      const offX = this._wsDrag ? (this._wsDrag.pointerOffsetX | 0) : 0;
      const offY = this._wsDrag ? (this._wsDrag.pointerOffsetY | 0) : 0;
      const ignore = this._wsDrag ? this._wsDrag.entry : null;
      this._showWsPreview(item, cell.x - offX, cell.y - offY, rotated, ignore);
    });
    wrap.addEventListener('dragleave', (e) => {
      if (!wrap.contains(e.relatedTarget)) this._clearWsPreview();
    });
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      this._clearWsPreview();
      const d = this._drag;
      if (!d) return;
      const cell = cellFromEvent(e);
      if (!cell) return;
      const { x, y } = cell;
      const rotated = this._wsDrag ? this._wsDrag.rotatedPreview : false;
      const offX = this._wsDrag ? (this._wsDrag.pointerOffsetX | 0) : 0;
      const offY = this._wsDrag ? (this._wsDrag.pointerOffsetY | 0) : 0;
      const tx = x - offX;
      const ty = y - offY;
      if (d.from === 'workspace' && d.entry) {
        if (!this.workspaceGrid.move(d.entry, tx, ty, rotated)) {
          this.workspaceGrid.move(d.entry, x, y, rotated);
        }
      } else {
        const item = this._resolveDragItem(d);
        if (!item) return;
        stampItemDims(item);
        if (this.workspaceGrid.canPlace(item, tx, ty, rotated)) {
          this.workspaceGrid.place(item, tx, ty, rotated);
        } else if (!this.workspaceGrid.autoPlace(item)) {
          return;
        }
        this._consumeDragSource(d, item);
      }
      this._wsDrag = null;
      this._drag = null;
      this.render();
    });
  }

  _buildWsTile(entry) {
    const tile = document.createElement('div');
    tile.className = 'ws-tile';
    tile.setAttribute('draggable', 'true');
    const rarity = inferRarity(entry.item);
    tile.classList.add(`rarity-${rarity}`); if (entry.item?.mastercraft || entry.mastercraft) tile.classList.add("mastercraft");
    tile.style.left   = `${entry.x * (WS_CELL_PX + WS_CELL_GAP)}px`;
    tile.style.top    = `${entry.y * (WS_CELL_PX + WS_CELL_GAP)}px`;
    tile.style.width  = `${WS_CELL_PX}px`;
    tile.style.height = `${WS_CELL_PX}px`;
    const thumb = thumbnailFor(entry.item);
    const ammo = (entry.item.type === 'ranged' && typeof entry.item.ammo === 'number')
      ? `<span class="ws-ammo">${entry.item.ammo}/${entry.item.magSize ?? '—'}</span>`
      : '';
    tile.innerHTML = `
      ${thumb ? `<img class="ws-thumb" src="${thumb}" alt="" draggable="false">` : `<span class="ws-glyph">${TYPE_ICONS[entry.item.type] || '◇'}</span>`}
      <div class="ws-name">${entry.item.name || ''}</div>
      ${ammo}
    `;
    // Click = inspect. Right-click = transfer to inventory.
    // Shift-click = drop to ground.
    tile.addEventListener('click', (e) => {
      if (e.shiftKey) {
        this.workspaceGrid.remove(entry);
        if (this.onDrop) this.onDrop(entry.item);
        this.render();
        return;
      }
      if (entry.item && window.__showDetails) window.__showDetails(entry.item);
    });
    tile.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.inventory.autoPlaceAnywhere(entry.item)) {
        this.workspaceGrid.remove(entry);
        this.inventory._bump();
        this.render();
      }
    });
    tile.addEventListener('dragstart', (e) => {
      this._wsDrag = { item: entry.item, entry };
      this._drag = { from: 'workspace', item: entry.item, entry };
      this._highlightCompatibleSlots(entry.item);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', 'item'); } catch (_) {}
      }
      tile.classList.add('dragging');
    });
    tile.addEventListener('dragend', () => {
      tile.classList.remove('dragging');
      this._wsDrag = null;
      this._drag = null;
      this._clearWsPreview();
      this._clearDragUI();
    });
    return tile;
  }

  // Resolve the actual item reference for the current _drag state.
  _resolveDragItem(d) {
    if (!d) return null;
    if (d.from === 'workspace')   return d.item;
    if (d.from === 'pockets')     return d.item;
    if (d.from === 'player-slot') return this.inventory.equipment[d.slot];
    if (d.from === 'player-bag')  return this.inventory.backpack[d.idx];
    if (d.from === 'body-misc' && this.target) return this.target.loot?.[d.lootIdx];
    if (d.from === 'body-slot' && this.target) return this.target.loot?.[d.lootIdx];
    return null;
  }

  // Pull the item OUT of its original container so it can land in the
  // workspace. Accepts the resolved item reference to avoid a double
  // lookup after the source mutates.
  _consumeDragSource(d, item) {
    if (d.from === 'player-slot') {
      this.inventory.equipment[d.slot] = null;
      this.inventory._bump();
    } else if (d.from === 'player-bag') {
      this.inventory.takeFromBackpack(item);
    } else if (d.from === 'pockets') {
      // Item lives in one of the player's grids — remove from whichever
      // grid currently owns it.
      const g = this.inventory.gridOf(item);
      if (g) g.remove(item);
      this.inventory._bump();
    } else if ((d.from === 'body-misc' || d.from === 'body-slot') && this.target) {
      const idx = this.target.loot.indexOf(item);
      if (idx >= 0) {
        this.target.loot.splice(idx, 1);
        const refs = this.target._groundRefs;
        if (refs && this.target._removeGround) {
          this.target._removeGround(refs[idx]);
          refs.splice(idx, 1);
        }
      }
    }
  }

  _showWsPreview(item, x, y, rotated, ignoreEntry) {
    this._clearWsPreview();
    const iw = Math.max(1, (item.w | 0) || 1);
    const ih = Math.max(1, (item.h | 0) || 1);
    const w = rotated ? ih : iw;
    const h = rotated ? iw : ih;
    const ok = this.workspaceGrid.canPlace(item, x, y, rotated, ignoreEntry);
    const preview = document.createElement('div');
    preview.className = `ws-preview ${ok ? 'ok' : 'bad'}`;
    preview.style.left   = `${Math.max(0, x) * (WS_CELL_PX + WS_CELL_GAP)}px`;
    preview.style.top    = `${Math.max(0, y) * (WS_CELL_PX + WS_CELL_GAP)}px`;
    preview.style.width  = `${w * WS_CELL_PX + (w - 1) * WS_CELL_GAP}px`;
    preview.style.height = `${h * WS_CELL_PX + (h - 1) * WS_CELL_GAP}px`;
    this.workspaceEl.appendChild(preview);
    this._wsPreviewEl = preview;
  }
  _clearWsPreview() {
    if (this._wsPreviewEl) {
      this._wsPreviewEl.remove();
      this._wsPreviewEl = null;
    }
  }
}
