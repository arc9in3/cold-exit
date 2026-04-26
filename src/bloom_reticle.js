// Cursor-tracking bloom reticle. A subtle dashed ring drawn around
// the OS cursor that scales up with sustained-fire bloom and shrinks
// back as the bloom decays. Sits above the canvas as a fixed-position
// SVG element with `pointer-events: none` so it doesn't intercept
// clicks. The OS cursor (the CSS `cursor: url(...)` reticle) stays
// underneath; this is purely an additive cue.
//
// API:
//   initBloomReticle()      — once, after DOM ready.
//   setBloomLevel(0..1)     — scales the ring. 0 = at min radius (or
//                              hidden if hideAtZero), 1 = at max radius.
//   setBloomVisible(bool)   — gate visibility (e.g. hide on death,
//                              menus, ADS-with-scope-cursor).

const MIN_RADIUS = 14;     // matches the inner stroke of the OS cursor
const MAX_RADIUS = 56;     // roughly a third of an in-game room at 1080p
const RING_STROKE = 1.2;   // px

let _el = null;        // outer fixed-position container
let _circle = null;    // SVG <circle> we resize
let _x = 0;            // last cursor screen X (px)
let _y = 0;            // last cursor screen Y (px)
let _bloom = 0;        // 0..1, set externally
let _visible = true;   // gated externally
let _disabled = false; // permanent off if init failed

export function initBloomReticle() {
  if (_el || _disabled) return;
  if (typeof document === 'undefined') { _disabled = true; return; }
  const SIZE = MAX_RADIUS * 2 + 8;
  // Wrapper div is small and follows the cursor via transform — cheap
  // to update each frame. SVG inside renders the circle.
  _el = document.createElement('div');
  _el.style.cssText = [
    'position: fixed',
    'top: 0', 'left: 0',
    `width: ${SIZE}px`, `height: ${SIZE}px`,
    'pointer-events: none',
    'z-index: 999',
    'opacity: 0.55',
    'will-change: transform, width, height',
    'mix-blend-mode: screen',         // brighter against dark scenes
  ].join(';');
  _el.innerHTML = `
    <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"
         xmlns="http://www.w3.org/2000/svg">
      <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="${MIN_RADIUS}"
              fill="none"
              stroke="rgba(190, 220, 245, 0.9)"
              stroke-width="${RING_STROKE}"
              stroke-dasharray="3 4"
              stroke-linecap="round"/>
    </svg>`;
  document.body.appendChild(_el);
  _circle = _el.querySelector('circle');
  // Track the cursor wherever it goes. Uses clientX/Y so it's relative
  // to the viewport — the wrapper is fixed-positioned so this lines up
  // without any scroll math.
  window.addEventListener('mousemove', (e) => {
    _x = e.clientX;
    _y = e.clientY;
    _apply();
  }, { passive: true });
  _apply();
}

export function setBloomLevel(level) {
  _bloom = Math.max(0, Math.min(1, level || 0));
  _apply();
}

export function setBloomVisible(v) {
  _visible = !!v;
  if (_el) _el.style.display = _visible ? '' : 'none';
}

function _apply() {
  if (!_el || !_circle) return;
  const r = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * _bloom;
  _circle.setAttribute('r', r.toFixed(1));
  // Opacity ramps with bloom — at rest the ring is barely visible,
  // grows more present as the spread does. Keeps the rest state
  // unobtrusive; the cue is "something changed" not "something here".
  _el.style.opacity = (0.18 + 0.50 * _bloom).toFixed(2);
  // Dashed gap widens with bloom too — looks more agitated under
  // sustained fire, calm during disciplined bursts.
  const gap = 4 + 6 * _bloom;
  _circle.setAttribute('stroke-dasharray', `3 ${gap.toFixed(1)}`);
  // Position the wrapper so its center sits at the cursor.
  const SIZE = MAX_RADIUS * 2 + 8;
  _el.style.transform = `translate(${(_x - SIZE / 2).toFixed(1)}px,
                                    ${(_y - SIZE / 2).toFixed(1)}px)`;
}
