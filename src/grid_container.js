// Rectangular grid container for inventory placement à la Tarkov /
// Grey Zone. Every item has a width×height footprint and occupies
// that many cells once placed. Cells are indexed (x, y) with
// x = column, y = row, (0,0) in the top-left.
//
// The grid stores ENTRIES ({ item, x, y, w, h, rotated }) and a
// back-map of cell → entry so both directions are O(1) at the
// cost of a flat 2D array. Item width/height come from `item.w`
// and `item.h`; unrotated a 2×3 item spans 2 cells in X and 3 in Y.
// When rotated, w/h swap.

export class GridContainer {
  constructor(width, height) {
    this.w = width;
    this.h = height;
    this._cells = new Array(width * height).fill(null); // cell idx → entry
    this._entries = [];                                   // list of {item,x,y,w,h,rotated}
  }

  // Dimensions as the item occupies them (respecting rotation).
  _dims(item, rotated = false) {
    const iw = Math.max(1, (item.w | 0) || 1);
    const ih = Math.max(1, (item.h | 0) || 1);
    return rotated ? [ih, iw] : [iw, ih];
  }

  // Does a footprint at (x,y) with (w,h) fit inside the grid + leave
  // all required cells empty? Optionally ignore an existing entry
  // (used when moving an item so it doesn't collide with itself).
  canPlace(item, x, y, rotated = false, ignoreEntry = null) {
    const [w, h] = this._dims(item, rotated);
    if (x < 0 || y < 0) return false;
    if (x + w > this.w || y + h > this.h) return false;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const idx = (y + dy) * this.w + (x + dx);
        const occ = this._cells[idx];
        if (occ && occ !== ignoreEntry) return false;
      }
    }
    return true;
  }

  // Place an item at (x,y). Returns the created entry or null on
  // failure (no room or out of bounds).
  place(item, x, y, rotated = false) {
    if (!this.canPlace(item, x, y, rotated)) return null;
    const [w, h] = this._dims(item, rotated);
    const entry = { item, x, y, w, h, rotated };
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this._cells[(y + dy) * this.w + (x + dx)] = entry;
      }
    }
    this._entries.push(entry);
    return entry;
  }

  // Scan the grid for the first free rectangle that fits `item`.
  // Row-major: top-left-first. If `alsoTryRotated` is true, falls
  // back to the rotated footprint when the native orientation
  // doesn't fit.
  findEmpty(item, alsoTryRotated = true) {
    for (const rot of alsoTryRotated ? [false, true] : [false]) {
      const [w, h] = this._dims(item, rot);
      for (let y = 0; y <= this.h - h; y++) {
        for (let x = 0; x <= this.w - w; x++) {
          if (this.canPlace(item, x, y, rot)) return { x, y, rotated: rot };
        }
      }
    }
    return null;
  }

  // Place into the first free slot (rotates if that helps). Returns
  // the entry, or null if the item can't fit anywhere.
  autoPlace(item) {
    const pos = this.findEmpty(item, true);
    if (!pos) return null;
    return this.place(item, pos.x, pos.y, pos.rotated);
  }

  // Remove an entry (takes the item out). Accepts either the entry
  // object itself OR an item reference — second form searches the
  // entry list by identity. Returns the removed item or null.
  remove(entryOrItem) {
    let entry = entryOrItem;
    if (!entry || !('x' in entry && 'y' in entry && 'item' in entry)) {
      entry = this._entries.find((e) => e.item === entryOrItem);
      if (!entry) return null;
    }
    const idx = this._entries.indexOf(entry);
    if (idx < 0) return null;
    this._entries.splice(idx, 1);
    // Clear the cells the entry occupied.
    for (let dy = 0; dy < entry.h; dy++) {
      for (let dx = 0; dx < entry.w; dx++) {
        const cellIdx = (entry.y + dy) * this.w + (entry.x + dx);
        if (this._cells[cellIdx] === entry) this._cells[cellIdx] = null;
      }
    }
    return entry.item;
  }

  // Move an existing entry to a new position (and optional new
  // rotation). Fails without state mutation if the target is
  // blocked (ignoring THIS entry's own cells).
  move(entry, newX, newY, newRotated = null) {
    const rot = newRotated === null ? entry.rotated : newRotated;
    if (!this.canPlace(entry.item, newX, newY, rot, entry)) return false;
    // Clear old cells.
    for (let dy = 0; dy < entry.h; dy++) {
      for (let dx = 0; dx < entry.w; dx++) {
        const idx = (entry.y + dy) * this.w + (entry.x + dx);
        if (this._cells[idx] === entry) this._cells[idx] = null;
      }
    }
    // Re-occupy at new pos.
    const [w, h] = this._dims(entry.item, rot);
    entry.x = newX; entry.y = newY;
    entry.w = w; entry.h = h;
    entry.rotated = rot;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this._cells[(newY + dy) * this.w + (newX + dx)] = entry;
      }
    }
    return true;
  }

  rotate(entry) {
    return this.move(entry, entry.x, entry.y, !entry.rotated);
  }

  // Grow the grid in-place. Existing entries keep their (x, y) — the
  // backing cell array is rebuilt at the new dimensions and entries
  // are re-stamped onto it. Used by the workspace overflow path so a
  // displaced item that doesn't fit in the player's containers can
  // still land somewhere safe.
  resize(newW, newH) {
    if (newW < this.w || newH < this.h) return false;
    const cells = new Array(newW * newH).fill(null);
    for (const entry of this._entries) {
      for (let dy = 0; dy < entry.h; dy++) {
        for (let dx = 0; dx < entry.w; dx++) {
          cells[(entry.y + dy) * newW + (entry.x + dx)] = entry;
        }
      }
    }
    this.w = newW;
    this.h = newH;
    this._cells = cells;
    return true;
  }

  // Lookup helpers.
  at(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    return this._cells[y * this.w + x] || null;
  }
  cellOccupied(x, y) { return !!this.at(x, y); }
  entries() { return this._entries.slice(); }
  items() { return this._entries.map((e) => e.item); }
  entryForItem(item) { return this._entries.find((e) => e.item === item) || null; }
  contains(item) { return !!this.entryForItem(item); }
  isEmpty() { return this._entries.length === 0; }
  freeCells() {
    let n = 0;
    for (const c of this._cells) if (!c) n += 1;
    return n;
  }
  capacity() { return this.w * this.h; }

  // Remove every entry.
  clear() {
    this._cells.fill(null);
    this._entries.length = 0;
  }

  // Resize the grid. Expanding keeps every entry in place. Shrinking
  // evicts entries whose footprint would go out of bounds — they
  // come back in the returned array so the caller can relocate or
  // drop them.
  resize(newW, newH) {
    const evicted = [];
    const keep = [];
    for (const e of this._entries) {
      if (e.x + e.w <= newW && e.y + e.h <= newH) keep.push(e);
      else evicted.push(e.item);
    }
    this.w = newW;
    this.h = newH;
    this._cells = new Array(newW * newH).fill(null);
    this._entries = keep;
    for (const e of keep) {
      for (let dy = 0; dy < e.h; dy++) {
        for (let dx = 0; dx < e.w; dx++) {
          this._cells[(e.y + dy) * newW + (e.x + dx)] = e;
        }
      }
    }
    return evicted;
  }
}

// Canonical per-type / per-class default item footprint. Items can
// override with explicit `w` / `h` in their def. This runs once when
// an item enters any grid — prefer reading from the item's own
// w/h when they exist.
const DEFAULT_WH_BY_CLASS = {
  pistol:   [2, 1],
  smg:      [3, 1],
  shotgun:  [4, 1],
  rifle:    [4, 1],
  sniper:   [5, 1],
  lmg:      [4, 2],
  flame:    [3, 2],
  melee:    [2, 1],
};
const DEFAULT_WH_BY_TYPE = {
  ranged:     [3, 1],
  melee:      [2, 1],
  consumable: [1, 1],
  junk:       [1, 1],
  attachment: [1, 1],
  toy:        [1, 1],
  armor:      [2, 1],
  gear:       [2, 1],
  backpack:   [2, 3],
};
// Armor/gear slot footprints — trimmed so a full kit doesn't swallow
// an entire backpack. Rough target: helmets 2, chest 4, pants 3,
// boots 2, gloves 1, belt 2, backpack 6.
const DEFAULT_WH_BY_SLOT = {
  head:     [2, 1],
  face:     [1, 1],
  ears:     [1, 1],
  chest:    [2, 2],
  hands:    [1, 1],
  belt:     [2, 1],
  pants:    [1, 3],
  boots:    [2, 1],
  backpack: [2, 3],
  melee:    [2, 1],
};

// Simplified single-cell model — every item occupies exactly 1×1
// regardless of type. The per-class / per-slot footprint defaults are
// retained above as historical reference but no longer consulted.
export function itemFootprint(_item) {
  return [1, 1];
}

// Stamp 1×1 onto every item unconditionally. Overwrites legacy
// w/h values from saves so migrations don't leave oversized
// footprints lying around.
export function stampItemDims(item) {
  if (!item) return item;
  item.w = 1;
  item.h = 1;
  return item;
}

// Resolve a container-style item's sub-grid layout. Items can
// specify `gridLayout: { w, h }` directly, or we derive one from
// their legacy `pockets` count (each point ≈ 1 cell). Items with
// neither return null (no container role).
export function deriveGridLayout(item) {
  if (!item) return null;
  if (item.gridLayout && item.gridLayout.w && item.gridLayout.h) {
    return { w: item.gridLayout.w | 0, h: item.gridLayout.h | 0 };
  }
  const pockets = item.pockets | 0;
  if (pockets <= 0) return null;
  // Backpacks get a wider grid (5-6 cols), vests/belts stay narrower
  // (3-4 cols) so they visually read as "worn pouches" vs "bulk pack".
  const isBackpack = item.slot === 'backpack';
  const cols = isBackpack
    ? Math.min(6, Math.max(4, Math.ceil(Math.sqrt(pockets * 1.6))))
    : Math.min(4, Math.max(2, Math.ceil(Math.sqrt(pockets))));
  const rows = Math.max(1, Math.ceil(pockets / cols));
  return { w: cols, h: rows };
}
