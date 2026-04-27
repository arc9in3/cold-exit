import { effectiveWeapon } from './attachments.js';
import { layoutForWeapon } from './weapon_layouts.js';
import { renderItemCell } from './ui_item_cell.js';
import { thumbnailFor } from './item_thumbnails.js';
import { rarityColor } from './inventory.js';

// Canonical slot presentation order so the legend + schematic labels
// always read the same way across weapon classes — muzzle first, then
// barrel, sights, rails, magazine. Weapons only show the slots they
// actually expose via `attachmentSlots`.
// Canonical presentation order — matches the radial layout in
// CANONICAL_POS so the cells appear left-to-right, top-to-bottom in
// roughly clockwise order around the gun silhouette.
const CUST_SLOT_ORDER = ['muzzle', 'barrel', 'sideRail', 'topRail', 'stock', 'underRail', 'magazine', 'trigger', 'grip'];
const CUST_SLOT_LABEL = {
  muzzle:    'Muzzle',
  barrel:    'Barrel',
  topRail:   'Top rail',
  sideRail:  'Side rail',
  underRail: 'Under rail',
  magazine:  'Magazine',
};

// Dedicated weapon-customization modal. Opens against a specific weapon
// instance — works for equipped or backpack weapons. Slots are drag+drop:
// drag an attachment from backpack onto a slot, or drag a slotted attachment
// off to the backpack.
export class CustomizeUI {
  constructor({ inventory, getDragState, setDragState, onClose, onDrop }) {
    this.inventory = inventory;
    this.getDragState = getDragState;
    this.setDragState = setDragState;
    this.onClose = onClose;
    // Ground-drop fallback for detach — used when the player's pack
    // is full. Without this the detach click silently failed.
    this.onDrop = onDrop || null;
    this.weapon = null;

    this.root = document.createElement('div');
    this.root.id = 'cust-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="cust-card">
        <div id="cust-header">
          <div id="cust-title">Weapon Customization</div>
          <button id="cust-close" type="button">✕</button>
        </div>
        <div id="cust-body">
          <div id="cust-weapon"></div>
          <div id="cust-slots"></div>
        </div>
        <div id="cust-stats"></div>
        <div id="cust-bag">
          <div class="inv-heading">Attachments in Backpack</div>
          <div id="cust-bag-grid"></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.weaponEl = this.root.querySelector('#cust-weapon');
    this.slotsEl = this.root.querySelector('#cust-slots');
    this.statsEl = this.root.querySelector('#cust-stats');
    this.bagEl = this.root.querySelector('#cust-bag-grid');

    this.root.querySelector('#cust-close').addEventListener('click', () => this.hide());
    // Click outside the card closes.
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  open(weapon) {
    this.weapon = weapon;
    this.root.style.display = 'flex';
    this.render();
  }

  hide() {
    this.root.style.display = 'none';
    this.weapon = null;
    if (this.onClose) this.onClose();
  }

  isOpen() { return this.weapon !== null; }

  // Visual affordance: when an attachment is being dragged, glow every
  // slot it can legally drop into so the player sees targets at a glance.
  _highlightSlots(slotName) {
    if (!slotName) return;
    const cells = this.slotsEl.querySelectorAll('.cust-slot');
    cells.forEach((c) => {
      if (c.dataset.slot === slotName) c.classList.add('match');
    });
  }
  _clearSlotHighlights() {
    const cells = this.slotsEl.querySelectorAll('.cust-slot.match');
    cells.forEach((c) => c.classList.remove('match'));
  }

  render() {
    if (!this.weapon) return;
    const w = this.weapon;
    // Cell background uses RARITY color (not item.tint) so the
    // weapon image sits cleanly on a tier-coded backdrop.
    const tintStr = rarityColor(w);
    // Real rendered weapon thumbnail instead of a plain colour swatch
    // so players see the actual gun silhouette. Falls back to a
    // colour swatch for weapons without a registered thumbnail.
    const thumb = thumbnailFor(w);
    const subtitle = w.type === 'melee'
      ? `Melee · ${w.class || 'weapon'}`
      : `${w.class || 'ranged'} · ${w.fireMode || 'semi'} · ${(w.fireRate || 0).toFixed(1)}/s`;
    this.weaponEl.innerHTML = `
      <div class="cust-wart" style="background:${tintStr}">
        ${thumb ? `<img class="cust-wart-img" src="${thumb}" alt="" draggable="false">` : ''}
      </div>
      <div class="cust-winfo">
        <div class="cust-wname">${w.name}</div>
        <div class="cust-wsub">${subtitle}</div>
      </div>
    `;

    this.slotsEl.innerHTML = '';
    // Weapon-specific attachmentSlots can be in any order; sort by
    // the canonical presentation order so every gun's cells read
    // muzzle → barrel → top rail → side rail → under rail →
    // magazine regardless of how the weapon data was authored.
    const rawSlots = w.attachmentSlots || [];
    const slots = CUST_SLOT_ORDER.filter(s => rawSlots.includes(s));
    if (slots.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cust-empty';
      empty.textContent = 'This weapon has no attachment slots.';
      this.slotsEl.appendChild(empty);
    } else {
      // Draw the weapon schematic behind the slots.
      const layout = layoutForWeapon(w);
      const diagram = document.createElement('div');
      diagram.className = 'cust-diagram';
      diagram.innerHTML = `
        <svg viewBox="0 0 600 260" preserveAspectRatio="xMidYMid meet">
          <rect x="0" y="0" width="600" height="260" fill="transparent"/>
          ${layout.svg}
        </svg>
      `;
      this.slotsEl.appendChild(diagram);
    }
    // Fixed canonical slot positions on the 600×260 viewport — every
    // weapon places each slot type at the same screen location so
    // users build muscle memory for where to drop which attachment.
    // The schematic behind varies per weapon class but the slot
    // cells themselves are stable.
    // Canonical slot layout — muzzle-LEFT orientation. Gun silhouette
    // image (the side-view PNG) sits centered in the window; slots
    // ring the edges with breathing room between them.
    //   muzzle      ─ left center                    (front of barrel)
    //   barrel      ─ inboard of muzzle              (mid-front, low)
    //   sideRail    ─ above the receiver, mid-front  (laser / light)
    //   topRail     ─ top center                     (sight)
    //   underRail   ─ below the receiver, mid-front  (foregrip / bipod)
    //   magazine    ─ bottom center                  (mag well)
    //   trigger    ─ bottom right of magazine       (trigger group)
    //   grip       ─ further right, bottom          (pistol grip)
    //   stock      ─ center right                   (buttstock)
    const CANONICAL_POS = {
      muzzle:    { x:  55, y: 130 },
      barrel:    { x: 130, y: 165 },
      sideRail:  { x: 205, y:  65 },
      topRail:   { x: 305, y:  35 },
      underRail: { x: 215, y: 215 },
      magazine:  { x: 305, y: 230 },
      trigger:   { x: 395, y: 230 },
      grip:      { x: 480, y: 230 },
      stock:     { x: 555, y: 130 },
    };
    for (const slot of slots) {
      const cell = document.createElement('div');
      cell.className = 'cust-slot aligned';
      cell.dataset.slot = slot;
      const pos = CANONICAL_POS[slot];
      if (pos) {
        cell.style.left = `${(pos.x / 600) * 100}%`;
        cell.style.top = `${(pos.y / 260) * 100}%`;
      }
      const current = w.attachments?.[slot] || null;
      if (current) {
        const t = current.tint ?? 0x888888;
        const tStr = `#${t.toString(16).padStart(6, '0')}`;
        cell.classList.add('filled');
        cell.setAttribute('draggable', 'true');
        cell.innerHTML = `
          <div class="cust-slot-label">${slot}</div>
          <div class="cust-slot-row">
            <span class="attach-swatch" style="background:${tStr}"></span>
            <span class="attach-name">${current.name}</span>
          </div>
          <div class="attach-desc">${current.description || ''}</div>
        `;
        cell.addEventListener('dragstart', (e) => {
          this.setDragState({ from: 'attachment', slot, weapon: w, item: current });
          e.dataTransfer.effectAllowed = 'move';
          this._highlightSlots(current.slot || slot);
        });
        cell.addEventListener('dragend', () => {
          this.setDragState(null);
          this._clearSlotHighlights();
        });
        // Match the rest of the UI: click = inspect, right-click =
        // action. Previously these were swapped here, which felt
        // inconsistent — right-click opened details everywhere else
        // in the game so detaching required a left-click here but
        // equipping required a right-click in the inventory.
        cell.addEventListener('click', () => {
          if (current && window.__showDetails) window.__showDetails(current);
        });
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (this.inventory.detachFromWeapon(w, slot)) {
            this.render();
            return;
          }
          // Backpack full — drop to the ground so the detach still
          // completes instead of failing silently.
          const cur = w.attachments?.[slot];
          if (cur && this.onDrop) {
            w.attachments[slot] = null;
            this.inventory._bump();
            this.onDrop(cur);
            this.render();
          }
        });
      } else {
        cell.innerHTML = `
          <div class="cust-slot-label">${slot}</div>
          <div class="cust-slot-empty">drop attachment here</div>
        `;
      }
      // Drop target — any attachment of matching slot lands here.
      cell.addEventListener('dragover', (e) => {
        const d = this.getDragState();
        if (d && d.item && d.item.type === 'attachment' && d.item.slot === slot) {
          e.preventDefault();
          cell.classList.add('drop-ok');
        }
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop-ok'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drop-ok');
        const d = this.getDragState();
        if (!d || !d.item || d.item.type !== 'attachment' || d.item.slot !== slot) return;
        if (d.from === 'backpack') {
          const moved = this.inventory.takeFromBackpack(d.idx);
          if (moved) {
            const ok = this.inventory.attachToWeapon(w, slot, moved);
            if (!ok) this.inventory.add(moved);
          }
        } else if (d.from === 'attachment' && d.weapon === w && d.slot !== slot) {
          // Swap between two slots on the same weapon.
          const current = w.attachments[slot];
          w.attachments[slot] = d.item;
          w.attachments[d.slot] = current;
          this.inventory._bump();
        }
        this.setDragState(null);
        this.render();
      });
      this.slotsEl.appendChild(cell);
    }

    // Effective-stats readout so the player can see what attachments do.
    const eff = effectiveWeapon(w);
    const lines = [];
    if (w.type === 'melee') {
      lines.push(`Melee weapon — ${w.combo?.length || 0} combo steps`);
    } else {
      lines.push(`<b>Damage</b> ${eff.damage?.toFixed(1)}  <b>Range</b> ${eff.range?.toFixed(1)}m`);
      lines.push(`<b>Fire rate</b> ${eff.fireRate?.toFixed(2)}/s  <b>Magazine</b> ${eff.magSize}`);
      lines.push(`<b>Reload</b> ${eff.reloadTime?.toFixed(2)}s`);
      lines.push(`<b>Spread</b> hip ${eff.hipSpread?.toFixed(3)} / ADS ${eff.adsSpread?.toFixed(3)}`);
      if (eff.lightAttachment) lines.push(`<b>Light</b> ${eff.lightAttachment.lightTier}`);
    }
    this.statsEl.innerHTML = lines.join('<br>');

    // Backpack side-list: only attachments, draggable into slots.
    this.bagEl.innerHTML = '';
    for (let i = 0; i < this.inventory.backpack.length; i++) {
      const it = this.inventory.backpack[i];
      if (!it || it.type !== 'attachment') continue;
      const cell = document.createElement('div');
      cell.className = 'inv-cell filled attach-bag-cell';
      cell.setAttribute('draggable', 'true');
      cell.innerHTML = renderItemCell(it, it.slot, { owned: true });
      // Click = inspect, right-click = attach to the first compatible
      // slot on the current weapon. Matches the inventory convention.
      cell.addEventListener('click', () => {
        if (window.__showDetails) window.__showDetails(it);
      });
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const moved = this.inventory.takeFromBackpack(i);
        if (moved) {
          const ok = this.inventory.attachToWeapon(w, moved.slot, moved);
          if (!ok) this.inventory.add(moved);
          this.render();
        }
      });
      cell.addEventListener('dragstart', (e) => {
        this.setDragState({ from: 'backpack', idx: i, item: it });
        e.dataTransfer.effectAllowed = 'move';
        this._highlightSlots(it.slot);
      });
      cell.addEventListener('dragend', () => {
        this.setDragState(null);
        this._clearSlotHighlights();
      });
      // Allow dropping an attached item back onto the backpack (from a slot).
      cell.addEventListener('dragover', (e) => {
        const d = this.getDragState();
        if (d && d.from === 'attachment') { e.preventDefault(); cell.classList.add('drop-ok'); }
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop-ok'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drop-ok');
        const d = this.getDragState();
        if (!d || d.from !== 'attachment') return;
        this.inventory.detachFromWeapon(d.weapon, d.slot);
        this.setDragState(null);
        this.render();
      });
      this.bagEl.appendChild(cell);
    }
    if (!this.bagEl.children.length) {
      const empty = document.createElement('div');
      empty.className = 'cust-empty';
      empty.textContent = 'No attachments in backpack.';
      this.bagEl.appendChild(empty);
    }
  }
}
