// First-run / contextual tutorial hints. Each hint fires exactly once
// per player (persisted to localStorage), triggered when the player
// first encounters the condition. Designed to be unobtrusive: shows a
// single line of text near top-center, fades in then out, and only
// surfaces ONE hint at a time — queued if multiple trigger together.
//
// Callers fire hints by id via `fireHint('pickup')`. Conditions live
// in main.js; this module is just the registry + display.

const STORAGE_KEY = 'cold-exit:hints:v2';

// Hint registry. Each entry: text shown, display duration in seconds,
// and an optional priority — lower numbers jump the queue (so a
// "you're near a merchant" hint can preempt a slow ambient hint).
const HINTS = {
  move:           { text: 'WASD to move · Mouse aims · LMB fires', duration: 6.0, priority: 1 },
  inventory:      { text: 'Tab opens your inventory · Drag items between slots', duration: 5.0, priority: 2 },
  pickup:         { text: '[E] picks up nearby loot', duration: 4.0, priority: 3 },
  searchBody:     { text: '[E] searches a downed enemy for gear', duration: 4.0, priority: 3 },
  openContainer:  { text: '[E] opens a container · Boxes hold most of the run\'s loot', duration: 5.0, priority: 3 },
  shop:           { text: '[E] talks to merchants · Right-click their stock to buy', duration: 5.0, priority: 3 },
  reload:         { text: 'Press R to reload', duration: 3.0, priority: 4 },
  ads:            { text: 'Hold RMB to aim down sights · tighter spread', duration: 4.0, priority: 4 },
  hotbar:         { text: 'Drag any usable item onto the 1-8 hotbar to bind', duration: 5.0, priority: 4 },
  heal:           { text: 'Press H for the highest-tier heal in your bag', duration: 4.0, priority: 3 },
  perks:          { text: 'K opens the perk tree · spend skill points on builds', duration: 4.0, priority: 4 },
  crouch:         { text: 'C crouches · sneak past or under enemy cover', duration: 4.0, priority: 5 },
  dash:           { text: 'Space dashes · double-tap rolls', duration: 4.0, priority: 5 },
  exit:           { text: 'Defeat the boss to reveal the floor extract', duration: 5.0, priority: 2 },
  brokenItem:     { text: 'Broken gear gives no bonuses · repair at any shop', duration: 5.0, priority: 3 },
  keycard:        { text: 'Locked doors need matching keycards · drop from sub-bosses', duration: 5.0, priority: 3 },
  throwable:      { text: 'Throwables bounce + settle before going off · aim wide', duration: 5.0, priority: 4 },
};

function loadFired() {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); }
  catch (_) { return new Set(); }
}
function saveFired(set) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])); } catch (_) {}
}

const _fired = loadFired();
const _queue = [];
let _hintEl = null;
let _activeStartedAt = 0;

function _ensureHintEl() {
  if (_hintEl) return _hintEl;
  _hintEl = document.createElement('div');
  _hintEl.id = 'tutorial-hint';
  Object.assign(_hintEl.style, {
    position: 'fixed',
    top: '110px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '10px 22px',
    background: 'rgba(20, 24, 32, 0.88)',
    border: '1px solid #c9a87a',
    borderRadius: '3px',
    color: '#f2e7c9',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '13px',
    fontWeight: '700',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    boxShadow: '0 0 18px rgba(201,168,122,0.30), 0 6px 24px rgba(0,0,0,0.7)',
    pointerEvents: 'none',
    zIndex: '50',
    opacity: '0',
    transition: 'opacity 0.25s ease',
    maxWidth: '70vw',
    textAlign: 'center',
    whiteSpace: 'nowrap',
  });
  document.body.appendChild(_hintEl);
  return _hintEl;
}

// Public API ------------------------------------------------------------

// Fire a hint by id. No-op if it's already been shown to this player
// (persisted) OR if the id isn't in the HINTS registry.
export function fireHint(id) {
  if (_fired.has(id)) return;
  const def = HINTS[id];
  if (!def) return;
  _fired.add(id);
  saveFired(_fired);
  _queue.push({ id, def, t: 0 });
  // Sort by priority so higher-priority hints jump ahead of any
  // ambient hints already queued.
  _queue.sort((a, b) => (a.def.priority || 99) - (b.def.priority || 99));
}

// Same as fireHint but doesn't persist — used for hints we want to
// re-show every run (e.g., "boss reveals exit" feels like discovery
// each time). Currently unused but left for future tuning.
export function fireHintTransient(id) {
  const def = HINTS[id];
  if (!def) return;
  _queue.push({ id, def, t: 0 });
  _queue.sort((a, b) => (a.def.priority || 99) - (b.def.priority || 99));
}

export function hasFired(id) { return _fired.has(id); }

// Reset the persisted state — surfaced via window.__resetHints in
// main.js so debug menus / reset buttons can replay the tutorial.
export function resetHints() {
  _fired.clear();
  saveFired(_fired);
}

// Tick the active hint (if any). Fade in over the first 0.25s, hold
// for most of the duration, fade out the last 0.4s. Auto-progresses
// to the next queued hint when complete.
export function tickHints(dt) {
  const el = _ensureHintEl();
  const cur = _queue[0];
  if (!cur) {
    el.style.opacity = '0';
    return;
  }
  if (cur.t === 0) {
    el.textContent = cur.def.text;
    _activeStartedAt = performance.now();
  }
  cur.t += dt;
  const total = cur.def.duration;
  // Fade envelope: 0..0.25s in, hold, last 0.4s out.
  let alpha = 1;
  if (cur.t < 0.25) alpha = cur.t / 0.25;
  else if (cur.t > total - 0.4) alpha = Math.max(0, (total - cur.t) / 0.4);
  el.style.opacity = String(alpha.toFixed(3));
  if (cur.t >= total) _queue.shift();
}
