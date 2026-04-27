import { SLOT_IDS, SLOT_POSITIONS, SLOT_ICONS, TYPE_ICONS, inferRarity,
         SET_DEFS, countEquippedSetPieces, weaponImageMirrorStyle } from './inventory.js';
import { SKILLS } from './skills.js';
import { renderItemCell } from './ui_item_cell.js';
import { thumbnailFor } from './item_thumbnails.js';
import { SPECIAL_PERKS } from './perks.js';
import { SKILL_NODES } from './skill_tree.js';

// Simple cell-based inventory.
//   • Every item occupies exactly 1 cell.
//   • Drag = move between any container (pockets / rig / backpack) or
//     onto an equipment slot.
//   • Left-click = inspect (opens the details modal).
//   • Right-click = equip / unequip (action).
//   • Shift-click = drop to ground.
//
// The grid rendering is kept so pockets / rig / backpack still read as
// distinct containers, but no more Tarkov-style footprints or rotation.
const CELL_PX = 96;
const CELL_GAP = 3;

export class InventoryUI {
  constructor({ inventory, skills, onDrop, getActiveWeapon, onOpenCustomize,
                getDragState, setDragState,
                getSpecialPerks, getSkillTreeLevels, getArtifacts }) {
    this.inventory = inventory;
    this.skills = skills;
    this.onDrop = onDrop;
    this.getActiveWeapon = getActiveWeapon || (() => null);
    this.onOpenCustomize = onOpenCustomize || (() => {});
    this.getDragState = getDragState;
    this.setDragState = setDragState;
    // Live readers for character-level progression. Default to empty
    // so the UI degrades gracefully if main.js doesn't pass them.
    this.getSpecialPerks    = getSpecialPerks    || (() => []);
    this.getSkillTreeLevels = getSkillTreeLevels || (() => ({}));
    this.getArtifacts       = getArtifacts       || (() => []);
    this.visible = false;
    this._lastVersion = -1;
    this._gridDrag = null;

    this.root = document.createElement('div');
    this.root.id = 'inv-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="inv-card">
        <div id="inv-title">Inventory</div>
        <div id="inv-body">
          <div id="inv-equipment">
            <div class="inv-heading">Equipment</div>
            <div id="inv-grid"></div>
          </div>
          <div id="inv-backpack">
            <div id="inv-grids-stack"></div>
          </div>
        </div>
        <div id="inv-footer">Drag to move · Left-click to inspect · Right-click to equip/unequip · Shift-click to drop · Tab to close</div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.gridEl = this.root.querySelector('#inv-grid');
    this.gridsStackEl = this.root.querySelector('#inv-grids-stack');

    // Build silhouette + slots FIRST (this clears gridEl), then mount
    // the overlay panels as children. Without this ordering, the
    // overlays were getting wiped by _buildSilhouette's innerHTML = ''
    // and `progListEl` / `skillListEl` ended up referencing orphan
    // nodes that were never visible.
    this._buildSilhouette();
    this._mountOverlays();
    this._wireQuickslotKeys();
    this.render();
  }

  // Quickslot binding via keyboard — while the inventory is open,
  // hovering an item and pressing 1-8 binds it to that quickslot.
  // Keys 1-4 → action-bar slots 0-3 (#weapon-bar). Keys 5-8 → slots
  // 4-7 (#action-bar). Skips bind when the active element is a text
  // input (player-name field, etc.) so the user can still type.
  _wireQuickslotKeys() {
    this._hoveredItem = null;
    this._hoverSource = null;
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.repeat) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      // E while hovering a consumable / throwable → use it in place.
      // Saves the player from dragging a bandage to the action bar
      // just to eat it. Throwables spend a charge per press.
      if (e.code === 'KeyE' && this._hoveredItem) {
        const it = this._hoveredItem;
        if (it.type === 'consumable' || it.type === 'throwable') {
          if (window.__useInventoryItem?.(it)) {
            e.preventDefault();
            e.stopPropagation();
            this.render();
          }
        }
        return;
      }
      let slotIdx = -1;
      switch (e.code) {
        case 'Digit1': slotIdx = 0; break;
        case 'Digit2': slotIdx = 1; break;
        case 'Digit3': slotIdx = 2; break;
        case 'Digit4': slotIdx = 3; break;
        case 'Digit5': slotIdx = 4; break;
        case 'Digit6': slotIdx = 5; break;
        case 'Digit7': slotIdx = 6; break;
        case 'Digit8': slotIdx = 7; break;
        default: return;
      }
      if (!this._hoveredItem) return;
      const ok = this.inventory.assignActionSlot(slotIdx, this._hoveredItem);
      if (ok) {
        e.preventDefault();
        e.stopPropagation();
        // Bump action-bar UI on the bottom of the screen so the new
        // binding paints immediately (the inventory rerender below
        // doesn't touch that element cluster).
        window.__renderActionBar?.();
        if (typeof window.__renderWeaponBar === 'function') window.__renderWeaponBar();
        this.render();
      } else {
        window.__hudMsg?.(`Cannot bind ${this._hoveredItem.name} to that slot`, 1.8);
      }
    }, /* capture so we win against the gameplay handler */ true);
  }

  _mountOverlays() {
    const prog = document.createElement('div');
    prog.id = 'inv-progression-overlay';
    prog.innerHTML = `
      <div class="inv-prog-heading">Gear Bonuses</div>
      <div id="inv-prog-list"></div>
    `;
    this.gridEl.appendChild(prog);
    this.progListEl = prog.querySelector('#inv-prog-list');

    // Relics now live in their own overlay panel so the player can
    // see active artifact effects + lore without scrolling past the
    // gear-bonus stack.
    const relics = document.createElement('div');
    relics.id = 'inv-relics-overlay';
    relics.innerHTML = `
      <div class="inv-relics-heading">Relics</div>
      <div id="inv-relics-list"></div>
    `;
    this.gridEl.appendChild(relics);
    this.relicsListEl = relics.querySelector('#inv-relics-list');

    const skills = document.createElement('div');
    skills.id = 'inv-skills-overlay';
    skills.innerHTML = `
      <div class="inv-skills-heading">Skills</div>
      <div id="inv-skill-list"></div>
    `;
    this.gridEl.appendChild(skills);
    this.skillListEl = skills.querySelector('#inv-skill-list');
  }

  toggle() {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'flex' : 'none';
    if (this.visible) this.render();
  }
  hide() {
    this.visible = false;
    this.root.style.display = 'none';
  }

  // ——— equipment paper doll ——————————————————————————————————

  _buildSilhouette() {
    this.gridEl.innerHTML = '';
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('id', 'inv-silhouette');
    svg.setAttribute('viewBox', '0 0 240 470');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.innerHTML = `
      <defs>
        <linearGradient id="body-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2d333e"/>
          <stop offset="1" stop-color="#1c2128"/>
        </linearGradient>
        <radialGradient id="body-glow" cx="0.5" cy="0.3" r="0.7">
          <stop offset="0" stop-color="rgba(201,168,122,0.12)"/>
          <stop offset="1" stop-color="rgba(0,0,0,0)"/>
        </radialGradient>
      </defs>
      <rect width="240" height="470" fill="url(#body-glow)"/>
      <ellipse cx="120" cy="40" rx="22" ry="26" fill="url(#body-grad)" stroke="#3a414c" stroke-width="1.2"/>
      <path d="M104,58 Q120,68 136,58 L132,74 L108,74 Z"
            fill="url(#body-grad)" stroke="#3a414c" stroke-width="1"/>
      <rect x="112" y="72" width="16" height="14" rx="2" fill="url(#body-grad)" stroke="#3a414c"/>
      <circle cx="78" cy="96" r="14" fill="url(#body-grad)" stroke="#3a414c" stroke-width="1.2"/>
      <circle cx="162" cy="96" r="14" fill="url(#body-grad)" stroke="#3a414c" stroke-width="1.2"/>
      <path d="M82,90 Q120,82 158,90 L168,160 Q170,180 156,190 L84,190 Q70,180 72,160 Z"
            fill="url(#body-grad)" stroke="#3a414c" stroke-width="1.2"/>
      <rect x="78" y="188" width="84" height="8" rx="2" fill="#1a1d24" stroke="#3a414c" stroke-width="0.8"/>
      <path d="M78,196 L82,240 Q120,248 158,240 L162,196 Z"
            fill="url(#body-grad)" stroke="#3a414c" stroke-width="1.2"/>
      <path d="M64,96 Q58,104 60,160 L76,162 Q78,104 76,96 Z"
            fill="url(#body-grad)" stroke="#3a414c" stroke-width="1"/>
      <path d="M164,96 Q162,104 164,162 L180,160 Q182,104 176,96 Z"
            fill="url(#body-grad)" stroke="#3a414c" stroke-width="1"/>
      <circle cx="68" cy="162" r="8" fill="url(#body-grad)" stroke="#3a414c" stroke-width="0.9"/>
      <circle cx="172" cy="162" r="8" fill="url(#body-grad)" stroke="#3a414c" stroke-width="0.9"/>
      <path d="M62,168 Q60,200 64,228 L74,228 Q76,200 74,168 Z"
            fill="url(#body-grad)" stroke="#3a414c" stroke-width="1"/>
      <path d="M166,168 Q164,200 166,228 L176,228 Q178,200 178,168 Z"
            fill="url(#body-grad)" stroke="#3a414c" stroke-width="1"/>
      <path d="M84,242 Q82,320 92,382 L114,382 Q116,320 114,242 Z"
            fill="url(#body-grad)" stroke="#3a414c" stroke-width="1"/>
      <path d="M126,242 Q124,320 126,382 L148,382 Q158,320 156,242 Z"
            fill="url(#body-grad)" stroke="#3a414c" stroke-width="1"/>
      <circle cx="103" cy="382" r="7" fill="url(#body-grad)" stroke="#3a414c" stroke-width="0.9"/>
      <circle cx="137" cy="382" r="7" fill="url(#body-grad)" stroke="#3a414c" stroke-width="0.9"/>
      <path d="M92,388 Q92,420 96,446 L110,446 Q112,420 112,388 Z"
            fill="url(#body-grad)" stroke="#3a414c" stroke-width="1"/>
      <path d="M128,388 Q128,420 130,446 L144,446 Q148,420 148,388 Z"
            fill="url(#body-grad)" stroke="#3a414c" stroke-width="1"/>
    `;
    this.gridEl.appendChild(svg);

    for (const slot of SLOT_IDS) {
      const cell = document.createElement('div');
      cell.className = `inv-slot slot-${slot}`;
      cell.dataset.slot = slot;
      const pos = SLOT_POSITIONS[slot];
      if (pos) {
        cell.style.gridRow = String(pos.row);
        cell.style.gridColumn = String(pos.col);
      }
      this._wireSlotHandlers(cell, slot);
      this.gridEl.appendChild(cell);
    }
  }

  _wireSlotHandlers(cell, slot) {
    // Hover tracking on paperdoll slots — same `_hoveredItem` channel
    // the grid wraps populate, so 1-8 quickslot binding works on
    // equipped weapons / consumables too.
    cell.addEventListener('pointerenter', () => {
      if (!this.visible) return;
      const item = this.inventory.equipment[slot];
      this._hoveredItem = item || null;
      this._hoverSource = cell;
    });
    cell.addEventListener('pointerleave', () => {
      if (this._hoverSource === cell) {
        this._hoveredItem = null;
        this._hoverSource = null;
      }
    });
    cell.addEventListener('click', (e) => {
      if (e.target.classList?.contains('cust-btn')) return;
      if (e.shiftKey) {
        // Shift-click on equipped item → drop to ground.
        const item = this.inventory.equipment[slot];
        if (!item) return;
        if (item.markedKeep) {
          window.__hudMsg?.(`${item.name} is marked KEEP — drop blocked.`, 2.0);
          return;
        }
        this.inventory.equipment[slot] = null;
        this.inventory._recomputeCapacity?.();
        this.inventory._bump();
        if (this.onDrop) this.onDrop(item);
        this.render();
        return;
      }
      // Plain click = inspect.
      const it = this.inventory.equipment[slot];
      if (it && window.__showDetails) window.__showDetails(it);
    });
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Right-click = unequip (back into a grid).
      if (this.inventory.unequip(slot)) this.render();
    });
    cell.addEventListener('dragstart', (e) => {
      const item = this.inventory.equipment[slot];
      if (!item) { e.preventDefault(); return; }
      this.setDragState({ from: 'equipment', slot, item });
      this._highlightCompatibleSlots(item);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', 'item'); } catch (_) {}
      }
    });
    cell.addEventListener('dragend', () => {
      this.setDragState(null);
      this._clearSlotHighlights();
    });
    cell.addEventListener('dragover', (e) => {
      const d = this.getDragState();
      if (!d || !d.item) return;
      if (!this.inventory.canSlotHold(slot, d.item)) return;
      e.preventDefault();
      cell.classList.add('drop-ok');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-ok'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('drop-ok');
      const d = this.getDragState();
      if (!d || !d.item) return;
      if (!this.inventory.canSlotHold(slot, d.item)) return;
      if (d.from === 'pockets') {
        // Route container-slot drops through equipBackpack so the
        // bag/rig migration pre-flight runs and the user gets a
        // proper "too small" toast instead of silent overflow loss.
        if (slot === 'backpack' || slot === 'belt') {
          const ok = this.inventory.equipBackpack(d.item);
          if (!ok) {
            const err = this.inventory.lastEquipError;
            if (err === 'tooSmallForBag') {
              window.__hudMsg?.('Too many items to swap bags — use the workspace to make room.', 3.0);
            } else if (err === 'tooSmallForRig') {
              window.__hudMsg?.('Too many items to swap rigs — use the workspace to make room.', 3.0);
            }
            this.setDragState(null);
            this.render();
            return;
          }
        } else {
          const item = d.item;
          const srcGrid = this.inventory.gridOf(item);
          if (!srcGrid) return;
          const prev = this.inventory.equipment[slot];
          srcGrid.remove(item);
          this.inventory.equipment[slot] = item;
          this.inventory._recomputeCapacity?.();
          if (prev) {
            if (!this.inventory.autoPlaceAnywhere(prev)) {
              this.inventory.equipment[slot] = prev;
              this.inventory._recomputeCapacity?.();
              this.inventory.autoPlaceAnywhere(item);
            }
          }
          this.inventory._bump();
        }
      } else if (d.from === 'equipment' && d.slot !== slot) {
        const src = this.inventory.equipment[d.slot];
        const dst = this.inventory.equipment[slot];
        if (dst && !this.inventory.canSlotHold(d.slot, dst)) return;
        this.inventory.equipment[slot] = src;
        this.inventory.equipment[d.slot] = dst;
        this.inventory._bump();
      }
      this.setDragState(null);
      this.render();
    });
  }

  // ——— grids (pockets / rig / backpack) ——————————————————————

  _buildGrids() {
    this.gridsStackEl.innerHTML = '';
    this._pocketTiles = new Map();
    this._gridBlocks = [];
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
    // Persistent pouch — always shown last so scrolling to the bottom
    // of the stack reveals the safe. Contents survive death + restart
    // via `inventory.savePouch`/`loadPouch`.
    if (inv.pouchGrid) {
      blocks.push({ grid: inv.pouchGrid, label: 'Pouch · persistent', owner: null });
    }
    for (const b of blocks) this._buildGridBlock(b);
  }

  _buildGridBlock({ grid, label, owner }) {
    const block = document.createElement('div');
    block.className = 'inv-grid-block';
    const heading = document.createElement('div');
    heading.className = 'inv-heading';
    heading.textContent = label;
    block.appendChild(heading);

    const wrap = document.createElement('div');
    wrap.className = 'pockets-grid';
    wrap.style.width  = `${grid.w * CELL_PX + (grid.w - 1) * CELL_GAP}px`;
    wrap.style.height = `${grid.h * CELL_PX + (grid.h - 1) * CELL_GAP}px`;
    // Empty visual cells. Every child of the wrap — cells AND tiles —
    // gets `pointer-events: none` so the wrap itself is the sole hit
    // target for pointerdown / dragover. Tiles still render on top
    // visually; they just don't steal events. Drag is driven by a
    // single pointerdown handler on the wrap that hit-tests the
    // clicked cell against `grid.at(x, y)` to find the entry (see
    // `_wireGridDrag`).
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const c = document.createElement('div');
        c.className = 'pocket-cell';
        c.style.left = `${x * (CELL_PX + CELL_GAP)}px`;
        c.style.top  = `${y * (CELL_PX + CELL_GAP)}px`;
        c.style.width  = `${CELL_PX}px`;
        c.style.height = `${CELL_PX}px`;
        c.style.pointerEvents = 'none';
        wrap.appendChild(c);
      }
    }
    this._wireGridWrap(wrap, grid);
    for (const entry of grid.entries()) {
      const tile = this._buildPocketTile(entry, grid, wrap);
      wrap.appendChild(tile);
      this._pocketTiles.set(entry, tile);
    }
    this._wireGridDrag(wrap, grid);
    block.appendChild(wrap);
    this.gridsStackEl.appendChild(block);
    this._gridBlocks.push({ grid, wrap, block, owner });
  }

  _buildPocketTile(entry, grid, wrap) {
    const tile = document.createElement('div');
    tile.className = 'pocket-item';
    // Tile is purely visual — it has `pointer-events: none` (via the
    // `.pocket-item *` CSS rule on its children, plus one explicitly
    // set below on the tile itself). All pointer events go straight
    // to the `.pockets-grid` wrap and are dispatched from there by
    // hit-testing grid coordinates. This sidesteps the "native drag
    // on img children hijacks the drag and parent's dragstart never
    // fires" class of bug entirely.
    tile.style.pointerEvents = 'none';
    tile.style.left   = `${entry.x * (CELL_PX + CELL_GAP)}px`;
    tile.style.top    = `${entry.y * (CELL_PX + CELL_GAP)}px`;
    tile.style.width  = `${CELL_PX}px`;
    tile.style.height = `${CELL_PX}px`;
    const rarity = inferRarity(entry.item);
    tile.classList.add(`rarity-${rarity}`);
    if (entry.item.mastercraft) tile.classList.add('mastercraft');
    const thumb = thumbnailFor(entry.item);
    const label = (entry.item.name || '').toString();
    const dur = entry.item.durability;
    const durPct = dur ? Math.max(0, Math.min(100, (dur.current / dur.max) * 100)) : -1;
    const ammoLine = (entry.item.type === 'ranged' && typeof entry.item.ammo === 'number')
      ? `<span class="pkt-ammo">${entry.item.ammo}/${entry.item.magSize ?? '—'}</span>`
      : '';
    const isBroken = dur && dur.current <= 0;
    if (isBroken) tile.classList.add('item-broken');
    const brokenTag = isBroken ? `<div class="pkt-broken-tag">BROKEN</div>` : '';
    // Stack count badge for consumables — shows in the top-right of
    // the cell so a 5-stack of bandages reads instantly.
    const count = (entry.item.count | 0) || 1;
    const stackBadge = ((entry.item.type === 'consumable' || entry.item.type === 'junk') && count > 1)
      ? `<span class="pkt-stack">×${count}</span>` : '';
    tile.innerHTML = `
      ${thumb ? `<img class="pkt-thumb" src="${thumb}" alt="" draggable="false" style="${weaponImageMirrorStyle(entry.item)}">` : `<span class="pkt-glyph">${TYPE_ICONS[entry.item.type] || '◇'}</span>`}
      ${brokenTag}
      ${stackBadge}
      <div class="pkt-name">${label}</div>
      ${durPct >= 0 ? `<div class="pkt-dur"><div class="pkt-dur-fill" style="width:${durPct.toFixed(0)}%;background:${durPct > 60 ? '#6abe8a' : durPct > 30 ? '#e0c040' : '#d24040'}"></div></div>` : ''}
      ${ammoLine}
    `;
    return tile;
  }

  // Single pointerdown / pointermove / pointerup lifecycle on the
  // grid wrap. On pointerdown we figure out which cell the pointer is
  // over, look up the entry there, and start a drag if one exists.
  // All hit-testing from that point on is done by elementFromPoint so
  // we can drop anywhere on the page (other grids, paperdoll slots,
  // action bar) without needing a separate handler per target type.
  _wireGridDrag(wrap, grid) {
    const DRAG_THRESHOLD = 4;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = wrap.getBoundingClientRect();
      const gx = Math.floor((e.clientX - rect.left) / (CELL_PX + CELL_GAP));
      const gy = Math.floor((e.clientY - rect.top)  / (CELL_PX + CELL_GAP));
      if (gx < 0 || gy < 0 || gx >= grid.w || gy >= grid.h) return;
      const entry = grid.at(gx, gy);
      if (!entry) return;  // clicked empty cell
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
        this._gridDrag = null;
        this.setDragState(null);
        this._clearCellPreview();
        this._clearSlotHighlights();
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
        ghost.style.width  = `${CELL_PX}px`;
        ghost.style.height = `${CELL_PX}px`;
        ghost.style.left = `${ev.clientX - CELL_PX / 2}px`;
        ghost.style.top  = `${ev.clientY - CELL_PX / 2}px`;
        ghost.innerHTML = `
          ${thumb ? `<img class="pkt-thumb" src="${thumb}" alt="" draggable="false" style="${weaponImageMirrorStyle(item)}">` : `<span class="pkt-glyph">${TYPE_ICONS[item.type] || '◇'}</span>`}
          <div class="pkt-name">${(item.name || '').toString()}</div>
        `;
        document.body.appendChild(ghost);
        this._gridDrag = { item, entry, fromGrid: grid };
        this.setDragState({ from: 'pockets', item });
        this._highlightCompatibleSlots(item);
      };
      const onMove = (ev) => {
        if (!dragging) {
          const dx = ev.clientX - startX, dy = ev.clientY - startY;
          if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
          startDrag(ev);
        }
        if (ghost) {
          ghost.style.left = `${ev.clientX - CELL_PX / 2}px`;
          ghost.style.top  = `${ev.clientY - CELL_PX / 2}px`;
        }
        this._updateCustomDropPreview(ev.clientX, ev.clientY);
      };
      const onUp = (ev) => {
        if (!dragging) {
          cleanup();
          // Plain click — preventDefault on pointerdown suppresses the
          // synthesised click event, so route inspect / shift-drop
          // manually here.
          if (ev.shiftKey) {
            if (item && item.markedKeep) {
              window.__hudMsg?.(`${item.name} is marked KEEP — drop blocked.`, 2.0);
              this.render();
              return;
            }
            if (this.onDrop) {
              const g = this.inventory.gridOf(item);
              if (g) g.remove(item);
              this.inventory._bump();
              this.onDrop(item);
            }
            this.render();
          } else if (item && window.__showDetails) {
            window.__showDetails(item);
          }
          return;
        }
        this._performCustomDrop(ev.clientX, ev.clientY, item, grid, entry);
        cleanup();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
    // Hover tracking — set/clear `_hoveredItem` so the global keydown
    // handler can bind a backpack item to a quickslot when the player
    // presses 1-8 while hovering it.
    wrap.addEventListener('pointermove', (e) => {
      if (!this.visible) return;
      const rect = wrap.getBoundingClientRect();
      const gx = Math.floor((e.clientX - rect.left) / (CELL_PX + CELL_GAP));
      const gy = Math.floor((e.clientY - rect.top)  / (CELL_PX + CELL_GAP));
      if (gx < 0 || gy < 0 || gx >= grid.w || gy >= grid.h) {
        if (this._hoveredItem && this._hoverSource === wrap) this._hoveredItem = null;
        return;
      }
      const entry = grid.at(gx, gy);
      this._hoveredItem = entry ? entry.item : null;
      this._hoverSource = wrap;
    });
    wrap.addEventListener('pointerleave', () => {
      if (this._hoverSource === wrap) {
        this._hoveredItem = null;
        this._hoverSource = null;
      }
    });
    // Right-click on a tile → equip (handled at wrap level now since
    // tiles are pointer-events: none).
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const gx = Math.floor((e.clientX - rect.left) / (CELL_PX + CELL_GAP));
      const gy = Math.floor((e.clientY - rect.top)  / (CELL_PX + CELL_GAP));
      if (gx < 0 || gy < 0 || gx >= grid.w || gy >= grid.h) return;
      const entry = grid.at(gx, gy);
      if (!entry) return;
      // Shift + right-click on a stack → peel a portion off into the
      // next available slot. Default split = ceil(count / 2). Prompt
      // the player so they can dial it in. Falls through to the
      // standard equip-backpack handler when the modifier isn't held.
      if (e.shiftKey) {
        const count = (entry.item.count | 0) || 1;
        if (count > 1) {
          const def = Math.ceil(count / 2);
          const raw = window.prompt(
            `Split "${entry.item.name}" (${count}). How many to peel off?`,
            String(def),
          );
          if (raw == null) return;
          const n = Math.max(1, Math.min(count - 1, parseInt(raw, 10) || 0));
          if (n <= 0 || n >= count) return;
          entry.item.count = count - n;
          // Spread to clone so the new stack is a fresh inventory
          // instance — original entry keeps its grid slot, the peeled
          // portion lands in the next free slot (pockets first via
          // allGrids ordering).
          const peeled = { ...entry.item, count: n };
          const placed = this.inventory.autoPlaceAnywhere(peeled);
          if (placed) {
            this.inventory._bump();
            this.render();
          } else {
            // Backout — restore the original count so nothing is lost.
            entry.item.count = count;
            window.__hudMsg?.('No room to split — clear an inventory slot first', 2.5);
          }
          return;
        }
        // count == 1: nothing to split, fall through to equip behaviour
        // so the gesture still does something useful (e.g. shift +
        // right-click a single-item backpack still equips it).
      }
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

  // Walk up from an element to the nearest matching ancestor (inclusive).
  _closest(el, selector) {
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.matches && cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  // Show the drop preview appropriate for whatever the pointer is
  // currently over — a grid cell gets the green/red placement preview,
  // an equipment slot gets the existing `.drop-ok` highlight from the
  // HTML5 path.
  _updateCustomDropPreview(clientX, clientY) {
    this._clearCellPreview();
    this.gridEl.querySelectorAll('.inv-slot.drop-ok').forEach(el => el.classList.remove('drop-ok'));
    document.querySelectorAll('.action-slot.drop-ok, .weapon-slot.drop-ok')
      .forEach(el => el.classList.remove('drop-ok'));
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) return;
    const wrap = this._closest(target, '.pockets-grid');
    if (wrap) {
      const blk = this._gridBlocks.find(b => b.wrap === wrap);
      if (!blk) return;
      const rect = wrap.getBoundingClientRect();
      const x = Math.floor((clientX - rect.left) / (CELL_PX + CELL_GAP));
      const y = Math.floor((clientY - rect.top)  / (CELL_PX + CELL_GAP));
      if (x >= 0 && y >= 0 && x < blk.grid.w && y < blk.grid.h) {
        this._showCellPreview(blk.grid, wrap, x, y);
      }
      return;
    }
    const slot = this._closest(target, '.inv-slot');
    if (slot) {
      const slotId = slot.dataset.slot;
      const d = this.getDragState();
      if (d && d.item && this.inventory.canSlotHold(slotId, d.item)) {
        slot.classList.add('drop-ok');
      }
      return;
    }
    // Hotbar slots — both clusters (.weapon-slot keys 1-4 and
    // .action-slot keys 5-8) accept any quickslot-eligible item.
    // Without including .weapon-slot here, drags from the inventory
    // panel showed no drop affordance on slots 1-4 and silently
    // failed.
    const hotSlot = this._closest(target, '.weapon-slot') || this._closest(target, '.action-slot');
    if (hotSlot) {
      const d = this.getDragState();
      const ok = d && d.item && (window.__isQuickslotEligible
        ? window.__isQuickslotEligible(d.item)
        : (d.item.type === 'consumable' || d.item.type === 'throwable'));
      if (ok) hotSlot.classList.add('drop-ok');
    }
  }

  _performCustomDrop(clientX, clientY, item, fromGrid, entry) {
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) return;
    // Re-resolve the source grid every drop — the item may have moved
    // since the tile was built (right-click equip, autoPlace reshuffle).
    const srcGrid = this.inventory.gridOf(item) || fromGrid;
    // Drop onto a grid (pockets / rig / backpack / pouch).
    const wrap = this._closest(target, '.pockets-grid');
    if (wrap) {
      const blk = this._gridBlocks.find(b => b.wrap === wrap);
      if (!blk) return;
      const rect = wrap.getBoundingClientRect();
      const x = Math.floor((clientX - rect.left) / (CELL_PX + CELL_GAP));
      const y = Math.floor((clientY - rect.top)  / (CELL_PX + CELL_GAP));
      if (x < 0 || y < 0 || x >= blk.grid.w || y >= blk.grid.h) return;
      // === ATTACHMENT auto-attach intercept ===
      // Drop an attachment onto a weapon cell → equip into the
      // matching slot. attachToWeapon swaps the existing slot's
      // attachment back to inventory if there's one, falling back to
      // the standard placement on incompatible drops or if the swap
      // can't fit.
      if (item.type === 'attachment') {
        const targetEntry = blk.grid.at(x, y);
        const targetItem = targetEntry?.item;
        if (targetItem && (targetItem.type === 'ranged' || targetItem.type === 'melee')
            && targetItem.attachments && (item.slot in targetItem.attachments)) {
          srcGrid.remove(item);
          const ok = this.inventory.attachToWeapon(targetItem, item.slot, item);
          if (!ok) {
            // Couldn't fit the displaced attachment — restore source
            // placement so nothing is lost.
            this.inventory.add(item);
          }
          this.render();
          return;
        }
      }
      const ok = this.inventory.moveInGrid(item, blk.grid, x, y, false);
      if (!ok && srcGrid !== blk.grid) {
        // Target cell occupied — remove from source then autoPlace
        // into the destination so the drag still lands somewhere
        // useful rather than no-op.
        srcGrid.remove(item);
        if (!blk.grid.autoPlace(item)) this.inventory.autoPlaceAnywhere(item);
        this.inventory._bump();
      }
      this.render();
      return;
    }
    // Drop onto an equipment slot.
    const slot = this._closest(target, '.inv-slot');
    if (slot) {
      const slotId = slot.dataset.slot;
      if (!this.inventory.canSlotHold(slotId, item)) return;
      const prev = this.inventory.equipment[slotId];
      srcGrid.remove(item);
      this.inventory.equipment[slotId] = item;
      this.inventory._recomputeCapacity?.();
      if (prev && !this.inventory.autoPlaceAnywhere(prev)) {
        // Rollback — target had an item that can't fit anywhere.
        this.inventory.equipment[slotId] = prev;
        this.inventory._recomputeCapacity?.();
        this.inventory.autoPlaceAnywhere(item);
      }
      this.inventory._bump();
      this.render();
      return;
    }
    // Drop onto a hotbar slot. Both clusters accept any quickslot-
    // eligible item (consumables, throwables, weapons). Cluster-aware
    // index resolution: .weapon-slot maps to actionBar 0-3 (keys 1-4),
    // .action-slot maps to actionBar 4-7 (keys 5-8). Without checking
    // .weapon-slot, drags from the inventory panel onto slots 1-4
    // silently failed.
    const weaponSlot = this._closest(target, '.weapon-slot');
    const actionSlot = !weaponSlot && this._closest(target, '.action-slot');
    const hotSlot = weaponSlot || actionSlot;
    const ok = hotSlot && (window.__isQuickslotEligible
      ? window.__isQuickslotEligible(item)
      : (item.type === 'consumable' || item.type === 'throwable'));
    if (ok) {
      const sameClusterSelector = weaponSlot ? '.weapon-slot' : '.action-slot';
      const slotOffset = weaponSlot ? 0 : 4;
      const slotsEl = document.querySelectorAll(sameClusterSelector);
      const idx = Array.from(slotsEl).indexOf(hotSlot);
      if (idx >= 0) {
        this.inventory.assignActionSlot(slotOffset + idx, item);
        // Keep the item in its grid — action slot just references it.
        this.render();
        window.__renderActionBar?.();
        window.__renderWeaponBar?.();
      }
    }
  }

  _wrapCellFromPointer(wrap, e, grid) {
    const rect = wrap.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / (CELL_PX + CELL_GAP));
    const y = Math.floor((e.clientY - rect.top)  / (CELL_PX + CELL_GAP));
    if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) return null;
    return { x, y };
  }

  _wireGridWrap(wrap, grid) {
    wrap.addEventListener('dragover', (e) => {
      const d = this._gridDrag || this.getDragState();
      if (!d) return;
      e.preventDefault();
      const cell = this._wrapCellFromPointer(wrap, e, grid);
      if (!cell) { this._clearCellPreview(); return; }
      this._showCellPreview(grid, wrap, cell.x, cell.y);
    });
    wrap.addEventListener('dragleave', (e) => {
      if (!wrap.contains(e.relatedTarget)) this._clearCellPreview();
    });
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      this._onGridDrop(wrap, grid, e);
    });
  }

  _onGridDrop(wrap, grid, e) {
    this._clearCellPreview();
    const cell = this._wrapCellFromPointer(wrap, e, grid);
    if (!cell) { this._gridDrag = null; return; }
    const { x, y } = cell;
    const d = this._gridDrag;
    if (d && d.entry) {
      // Intra / inter-grid move of a tile we dragged.
      const ok = this.inventory.moveInGrid(d.item, grid, x, y, false);
      if (!ok) {
        // Target occupied — try autoPlace so the item doesn't vanish.
        if (d.fromGrid !== grid) {
          // Cross-grid: remove from source then auto-place in target grid first.
          d.fromGrid.remove(d.item);
          if (!grid.autoPlace(d.item)) this.inventory.autoPlaceAnywhere(d.item);
          this.inventory._bump();
        }
      }
    } else {
      const ds = this.getDragState();
      if (ds && ds.item && ds.from === 'equipment') {
        const item = ds.item;
        if (grid.canPlace(item, x, y, false)) grid.place(item, x, y, false);
        else grid.autoPlace(item) || this.inventory.autoPlaceAnywhere(item);
        this.inventory.equipment[ds.slot] = null;
        this.inventory._recomputeCapacity?.();
        this.inventory._bump();
        this.setDragState(null);
      }
    }
    this._gridDrag = null;
    this.render();
  }

  // During a drag, glow the equipment slots that can accept the dragged
  // item so the player doesn't have to hover each candidate to discover
  // it. Clears on dragend.
  _highlightCompatibleSlots(item) {
    if (!item) return;
    for (const slot of SLOT_IDS) {
      const el = this.gridEl.querySelector(`[data-slot="${slot}"]`);
      if (!el) continue;
      if (this.inventory.canSlotHold(slot, item)) {
        el.classList.add('slot-compatible');
      }
    }
  }
  _clearSlotHighlights() {
    if (!this.gridEl) return;
    const lit = this.gridEl.querySelectorAll('.slot-compatible');
    for (const el of lit) el.classList.remove('slot-compatible');
  }

  _wireCustBtn(cellEl, item) {
    const btn = cellEl.querySelector('.cust-btn');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onOpenCustomize(item);
    });
  }

  _showCellPreview(grid, wrap, x, y) {
    this._clearCellPreview();
    const d = this._gridDrag || this.getDragState();
    if (!d || !d.item) return;
    // Attachment-on-weapon glow — when dragging an attachment over
    // a weapon cell whose attachments object exposes the matching
    // slot, paint a gold preview spanning the weapon's full footprint
    // instead of the standard 1×1 ok/bad cell. Drop will auto-equip.
    if (d.item.type === 'attachment') {
      const e = grid.at(x, y);
      const w = e?.item;
      if (w && (w.type === 'ranged' || w.type === 'melee')
          && w.attachments && (d.item.slot in w.attachments)) {
        const preview = document.createElement('div');
        preview.className = 'pocket-preview attach-glow';
        const itemW = Math.max(1, (w.w | 0) || 1);
        const itemH = Math.max(1, (w.h | 0) || 1);
        preview.style.left   = `${e.x * (CELL_PX + CELL_GAP)}px`;
        preview.style.top    = `${e.y * (CELL_PX + CELL_GAP)}px`;
        preview.style.width  = `${itemW * CELL_PX + (itemW - 1) * CELL_GAP}px`;
        preview.style.height = `${itemH * CELL_PX + (itemH - 1) * CELL_GAP}px`;
        wrap.appendChild(preview);
        this._previewEl = preview;
        return;
      }
    }
    const ignore = (this._gridDrag && this.inventory.gridOf(d.item) === grid)
      ? this._gridDrag.entry : null;
    const ok = grid.canPlace(d.item, x, y, false, ignore);
    const preview = document.createElement('div');
    preview.className = `pocket-preview ${ok ? 'ok' : 'bad'}`;
    preview.style.left   = `${x * (CELL_PX + CELL_GAP)}px`;
    preview.style.top    = `${y * (CELL_PX + CELL_GAP)}px`;
    preview.style.width  = `${CELL_PX}px`;
    preview.style.height = `${CELL_PX}px`;
    wrap.appendChild(preview);
    this._previewEl = preview;
  }
  _clearCellPreview() {
    if (this._previewEl) {
      this._previewEl.remove();
      this._previewEl = null;
    }
  }

  // ——— progression overlay ————————————————————————————————————
  // Aggregates set bonuses, perks, and affixes from the currently
  // equipped loadout into a single readable panel pinned over the
  // top half of the avatar silhouette. Players asked for an at-a-
  // glance view of "everything my power comes from right now" so
  // they can plan upgrades without inspecting each slot.
  _renderProgression() {
    if (!this.progListEl) return;
    const inv = this.inventory;
    const eq = inv.equipment;

    // — Set bonuses: collapse all setMark affixes across equipped
    //   gear, count pieces per set, and show every tier with met /
    //   missing state so the player can see how close they are to
    //   the next break.
    const setCounts = countEquippedSetPieces(eq);
    const setEntries = Object.entries(setCounts).filter(([, n]) => n > 0);
    setEntries.sort((a, b) => b[1] - a[1]);

    let setHtml = '';
    if (setEntries.length) {
      setHtml = setEntries.map(([setId, count]) => {
        const def = SET_DEFS[setId]; if (!def) return '';
        const tiers = def.tiers.map(t => {
          const met = count >= t.pieces;
          const text = t.desc.replace(/^\d+pc:\s*/, '');
          return `<div class="inv-prog-tier ${met ? 'met' : 'missing'}">
            <span class="inv-prog-tier-mark">${met ? '✓' : '○'}</span>
            <span class="inv-prog-tier-pcs">${t.pieces}pc</span>
            <span class="inv-prog-tier-desc">${text}</span>
          </div>`;
        }).join('');
        const cap = def.tiers[def.tiers.length - 1].pieces;
        return `<div class="inv-prog-set">
          <div class="inv-prog-set-name">${def.name} <span class="inv-prog-set-count">${count} / ${cap}</span></div>
          ${tiers}
        </div>`;
      }).join('');
    }

    // — Perks: union of three sources, deduped by id —
    //   (1) gear-attached perks rolled onto equipped items
    //   (2) special perks the player picked at level-up
    //   (3) skill-tree nodes the player has invested points into
    //   Each row tags its source so the player can trace where a
    //   given perk came from when planning swaps.
    const perkRows = [];
    // Two-pass build: first count occurrences of each perk by key,
    // then emit a single row per key tagged with "× N" when stacked.
    // Skill-tree + special-perk entries can't stack with themselves
    // (they're identity-keyed), but a perk like Twin Fang rolling
    // onto two pieces of gear should clearly show × 2.
    const perkCounts = new Map();   // key → { name, desc, source, count }
    const recordPerk = (key, name, desc, sourceTag) => {
      if (!key) return;
      const existing = perkCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        perkCounts.set(key, { name, desc, source: sourceTag, count: 1 });
      }
    };
    for (const slot of SLOT_IDS) {
      const it = eq[slot]; if (!it || !it.perks) continue;
      for (const p of it.perks) {
        recordPerk(p.id || p.name, p.name, p.description, 'GEAR');
      }
    }
    for (const id of (this.getSpecialPerks() || [])) {
      const def = SPECIAL_PERKS[id]; if (!def) continue;
      recordPerk('sp:' + id, def.name, def.description, 'PERK');
    }
    const stLevels = this.getSkillTreeLevels() || {};
    for (const [id, lv] of Object.entries(stLevels)) {
      if (!lv || lv <= 0) continue;
      const def = SKILL_NODES[id]; if (!def) continue;
      const tierIdx = Math.max(0, Math.min((def.levels?.length || 1) - 1, lv - 1));
      const tier = def.levels?.[tierIdx];
      const desc = tier?.desc || def.desc || '';
      recordPerk('st:' + id, `${def.name} L${lv}`, desc, 'SKILL');
    }
    for (const { name, desc, source, count } of perkCounts.values()) {
      const stackTag = count > 1 ? ` <span class="inv-prog-perk-stack">× ${count}</span>` : '';
      perkRows.push(`<div class="inv-prog-perk">
        <span class="inv-prog-perk-name">◆ ${name}${stackTag}</span>
        ${desc ? `<span class="inv-prog-perk-desc"> — ${desc}</span>` : ''}
        ${source ? `<span class="inv-prog-perk-src">${source}</span>` : ''}
      </div>`);
    }

    // — Affixes: roll up every non-set affix on every equipped piece.
    //   Affix.label already carries the human-readable "+ X to Y"
    //   so we just list them. Skip the setMark entries (those are
    //   the set membership flags, surfaced in the Set Bonuses block
    //   above).
    const affixRows = [];
    for (const slot of SLOT_IDS) {
      const it = eq[slot]; if (!it || !it.affixes) continue;
      for (const a of it.affixes) {
        if (a.kind === 'setMark') continue;
        affixRows.push(`<div class="inv-prog-affix">• ${a.label}</div>`);
      }
    }

    // — Relics now live in a separate overlay panel (see
    //   `_renderRelics` below). Kept the data-collection step out of
    //   this method so the Gear Bonuses panel reads as gear-only.

    const sections = [];
    if (setHtml) {
      sections.push(`<div class="inv-prog-section">
        <div class="inv-prog-section-title">Set Bonuses</div>
        ${setHtml}
      </div>`);
    }
    if (perkRows.length) {
      sections.push(`<div class="inv-prog-section">
        <div class="inv-prog-section-title">Perks (${perkRows.length})</div>
        ${perkRows.join('')}
      </div>`);
    }
    if (affixRows.length) {
      sections.push(`<div class="inv-prog-section">
        <div class="inv-prog-section-title">Affixes (${affixRows.length})</div>
        ${affixRows.join('')}
      </div>`);
    }
    if (sections.length === 0) {
      this.progListEl.innerHTML = `<div class="inv-prog-empty">No set bonuses, perks, or affixes yet — equip gear to grow your power.</div>`;
    } else {
      this.progListEl.innerHTML = sections.join('');
    }
    this._renderRelics();
  }

  // Render the dedicated relics overlay. Each row shows the relic
  // name, its short effect summary, the RELIC tag, and the lore line
  // underneath so players can see what every artifact actually does
  // (and read the world-building flavour) at a glance.
  _renderRelics() {
    if (!this.relicsListEl) return;
    const list = this.getArtifacts() || [];
    if (!list.length) {
      this.relicsListEl.innerHTML = `<div class="inv-relics-empty">No relics yet — finish encounters or buy from the relic-seller.</div>`;
      return;
    }
    const rows = [];
    for (const a of list) {
      const desc = a.short || a.description || '';
      const lore = a.lore || '';
      rows.push(`<div class="inv-relic-row">
        <div class="inv-relic-line">
          <span class="inv-relic-name">⬢ ${a.name}</span>
          ${desc ? `<span class="inv-relic-desc"> — ${desc}</span>` : ''}
        </div>
        ${lore ? `<div class="inv-relic-lore">"${lore}"</div>` : ''}
      </div>`);
    }
    this.relicsListEl.innerHTML = rows.join('');
  }

  // ——— render ———————————————————————————————————————————————

  // Coalesced render — multiple back-to-back drops / mutations now
  // collapse to a single rebuild on the next animation frame instead
  // of running a full UI rewrite per call. Was a hitch source when
  // shift-dropping a stack or auto-distributing pickups: each step
  // was triggering a full equipment/grid/skill/progression rebuild
  // synchronously. Existing call sites stay synchronous-looking;
  // they just fan into one rAF-scheduled render.
  render() {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    const fn = () => {
      this._renderScheduled = false;
      this._renderNow();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
    else fn();
  }
  _renderNow() {
    if (!this.visible && this.inventory.version === this._lastVersion) return;
    this._lastVersion = this.inventory.version;

    const applyRarity = (el, item) => {
      el.classList.remove('rarity-common', 'rarity-uncommon', 'rarity-rare',
                          'rarity-epic', 'rarity-legendary', 'rarity-mythic',
                          'mastercraft');
      if (item) {
        el.classList.add(`rarity-${inferRarity(item)}`);
        if (item.mastercraft) el.classList.add('mastercraft');
      }
    };

    for (const slot of SLOT_IDS) {
      const el = this.gridEl.querySelector(`[data-slot="${slot}"]`);
      if (!el) continue;
      const item = this.inventory.equipment[slot];
      el.innerHTML = renderItemCell(item, slot, { owned: true });
      el.classList.toggle('filled', !!item);
      el.setAttribute('draggable', item ? 'true' : 'false');
      applyRarity(el, item);
      this._wireCustBtn(el, item);
    }

    this._buildGrids();
    this._renderProgression();

    this.skillListEl.innerHTML = '';
    const entries = this.skills.entries();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'skill-empty';
      empty.textContent = 'No skills yet — kill enemies to level up.';
      this.skillListEl.appendChild(empty);
    } else {
      for (const [id, lv] of entries) {
        const s = SKILLS[id]; if (!s) continue;
        const row = document.createElement('div');
        row.className = 'skill-row';
        row.innerHTML = `
          <span class="skill-ico">${s.icon}</span>
          <span class="skill-name">${s.name} <span class="skill-lv">Lv ${lv}/${s.maxLevel}</span></span>
          <span class="skill-desc">${s.descriptionAt(lv)}</span>
        `;
        this.skillListEl.appendChild(row);
      }
    }
  }
}
