// Durability HUD — left-edge vertical column of slot glyphs that turn
// orange / red as equipped items wear down. Hidden when an item's
// durability is healthy (current/max ≥ 0.20) so the column only ever
// surfaces things the player needs to act on.
//
// Reads the live inventory each tick, so equipping / unequipping /
// repairing flows through with no extra plumbing. Scans:
//   - inventory.equipment[slot] for every SLOT_ID
// Render is throttled to ~5Hz; the inner loop is cheap (a dozen
// item lookups + a small DOM diff) but the column is always-on, so
// per-frame DOM writes would still be wasted work.

import { SLOT_IDS, SLOT_ICONS } from './inventory.js';

// Tunables. WARN_THRESHOLD: ratio under which we flip from hidden to
// orange. BROKEN: durability hits zero → red. UPDATE_INTERVAL_MS: how
// often we re-scan + re-paint.
const WARN_THRESHOLD = 0.20;
const UPDATE_INTERVAL_MS = 200;       // 5Hz refresh

export class DurabilityHud {
  constructor(inventory) {
    this.inventory = inventory;
    this._timer = 0;
    // Cached state: { slot → 'broken' | 'warn' | 'ok' } so the DOM
    // diff in _paint can skip work when nothing changed.
    this._lastState = Object.create(null);
    // Map of slot → DOM element (live) so we don't rebuild the column
    // every paint.
    this._cells = Object.create(null);
    this._buildRoot();
  }

  _buildRoot() {
    // Avoid double-mount on hot-reload: reuse an existing root if the
    // page already has one.
    let el = document.getElementById('durability-hud');
    if (!el) {
      el = document.createElement('div');
      el.id = 'durability-hud';
      // Inline the position styling so we don't have to ship a
      // dedicated CSS file for one column. The visual treatment
      // (color, glow) lives in per-cell inline style via _paint.
      el.style.position = 'fixed';
      el.style.left = '12px';
      el.style.top = '50%';
      el.style.transform = 'translateY(-50%)';
      el.style.display = 'flex';
      el.style.flexDirection = 'column';
      el.style.gap = '6px';
      el.style.pointerEvents = 'none';   // never eats clicks
      el.style.zIndex = '40';
      // Light text shadow so the glyphs read on light + dark levels.
      el.style.textShadow = '0 0 6px rgba(0,0,0,0.85), 0 1px 2px rgba(0,0,0,0.9)';
      el.style.fontFamily = 'inherit';
      el.style.fontSize = '22px';
      el.style.lineHeight = '1';
      document.body.appendChild(el);
    }
    this.root = el;
  }

  _ensureCell(slot) {
    let cell = this._cells[slot];
    if (cell) return cell;
    cell = document.createElement('div');
    cell.className = 'durability-hud-cell';
    cell.dataset.slot = slot;
    cell.textContent = SLOT_ICONS[slot] || '◇';
    cell.style.opacity = '0';            // hidden by default
    cell.style.transition = 'opacity 120ms';
    this.root.appendChild(cell);
    this._cells[slot] = cell;
    return cell;
  }

  // Resolve an item's slot back to a SLOT_ICONS key. weapon1/weapon2
  // are unified under 'weapon1' for the icon since they share a glyph.
  _stateFor(item) {
    if (!item || !item.durability) return 'hidden';
    const max = item.durability.max | 0;
    if (max <= 0) return 'hidden';
    const cur = item.durability.current;
    if (cur <= 0) return 'broken';
    if ((cur / max) < WARN_THRESHOLD) return 'warn';
    return 'hidden';
  }

  // Public per-frame entry point. Parent passes raw dt in seconds so
  // the throttle is frame-rate independent.
  tick(dtSec) {
    this._timer += (dtSec || 0) * 1000;
    if (this._timer < UPDATE_INTERVAL_MS) return;
    this._timer = 0;
    this._paint();
  }

  _paint() {
    const inv = this.inventory;
    if (!inv || !inv.equipment) return;
    for (const slot of SLOT_IDS) {
      const item = inv.equipment[slot];
      const state = this._stateFor(item);
      if (this._lastState[slot] === state) continue;
      this._lastState[slot] = state;
      const cell = this._ensureCell(slot);
      if (state === 'hidden') {
        cell.style.opacity = '0';
        // Fully clear color so the next visible state starts fresh.
        cell.style.color = '';
        continue;
      }
      cell.style.opacity = '1';
      if (state === 'broken') {
        // Saturated red + a stronger shadow so the broken state
        // reads at a glance against a busy scene.
        cell.style.color = '#ff4040';
      } else {
        // Warning amber — bright enough to spot peripherally but
        // not the same red as broken.
        cell.style.color = '#ffb030';
      }
    }
  }

  // Optional teardown — used if the HUD is re-initialised (eg after
  // a hot-reload). Mostly future-proofing; the live game never calls
  // this since the column persists for the run lifetime.
  destroy() {
    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
    this.root = null;
    this._cells = Object.create(null);
    this._lastState = Object.create(null);
  }
}
