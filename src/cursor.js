// Per-sight cursor swap. The body's CSS cursor is replaced by an SVG
// data URL that mirrors whatever optic the active weapon has on its
// top-rail slot. Default crosshair for no-sight or no-weapon, plus
// distinct reticles for red-dot, reflex, holographic, mid-scope, and
// sniper-class sights.
//
// Rarity bumps the brightness / saturation of the reticle stroke so a
// rare red dot is more vivid than a common one without changing the
// overall silhouette.

// --- SVG helpers ---------------------------------------------------
// Each function returns a complete SVG string designed to be embedded
// in the CSS `cursor: url("data:image/svg+xml;utf8,…") H Y, crosshair;`
// idiom. Hotspot coordinates are passed as a separate (x, y) pair.

const RARITY_BOOST = {
  common:    { stroke: 1.0, brightness: 1.0 },
  uncommon:  { stroke: 1.1, brightness: 1.10 },
  rare:      { stroke: 1.2, brightness: 1.20 },
  epic:      { stroke: 1.4, brightness: 1.35 },
  legendary: { stroke: 1.6, brightness: 1.55 },
  mythic:    { stroke: 1.8, brightness: 1.85 },
};

function _hex(c) { return '%23' + c.toString(16).padStart(6, '0'); }
function _wrap(svgInner, w = 32, h = 32) {
  return `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${svgInner}</svg>")`;
}

// Default tactical crosshair (matches the legacy CSS cursor).
function svgDefault() {
  return `<g fill='none' stroke-linecap='round'>
    <g stroke='${_hex(0x050607)}' stroke-width='3' opacity='0.85'>
      <circle cx='16' cy='16' r='7'/>
      <line x1='16' y1='3' x2='16' y2='9'/>
      <line x1='16' y1='23' x2='16' y2='29'/>
      <line x1='3' y1='16' x2='9' y2='16'/>
      <line x1='23' y1='16' x2='29' y2='16'/>
    </g>
    <g stroke='${_hex(0x00e6ff)}' stroke-width='1.4'>
      <circle cx='16' cy='16' r='7'/>
      <line x1='16' y1='3' x2='16' y2='9'/>
      <line x1='16' y1='23' x2='16' y2='29'/>
      <line x1='3' y1='16' x2='9' y2='16'/>
      <line x1='23' y1='16' x2='29' y2='16'/>
    </g>
    <circle cx='16' cy='16' r='1.6' fill='${_hex(0x00e6ff)}' stroke='${_hex(0x050607)}' stroke-width='0.8'/>
  </g>`;
}

// Red-dot — a single glowing red dot with a faint surrounding halo
// for visibility on bright backgrounds.
function svgRedDot(rarity) {
  const r = RARITY_BOOST[rarity] || RARITY_BOOST.common;
  const dotR = 2.0 + 0.4 * r.stroke;
  const haloR = 6.5;
  return `<g>
    <circle cx='16' cy='16' r='${haloR}' fill='${_hex(0xff3030)}' opacity='0.18'/>
    <circle cx='16' cy='16' r='${haloR * 0.55}' fill='${_hex(0xff3030)}' opacity='0.30'/>
    <circle cx='16' cy='16' r='${dotR + 0.7}' fill='${_hex(0x050607)}' opacity='0.6'/>
    <circle cx='16' cy='16' r='${dotR}' fill='${_hex(0xff5050)}'/>
    <circle cx='16' cy='16' r='${Math.max(0.6, dotR - 0.9)}' fill='${_hex(0xffd0d0)}'/>
  </g>`;
}

// Reflex sight — small center dot inside a horseshoe-style open ring,
// styled after a Russian PK-A reflex. Bright red on a thin dark
// outline.
function svgReflex(rarity) {
  const r = RARITY_BOOST[rarity] || RARITY_BOOST.common;
  const sw = 1.3 * r.stroke;
  return `<g fill='none' stroke-linecap='round'>
    <g stroke='${_hex(0x050607)}' stroke-width='${sw + 1.4}' opacity='0.7'>
      <path d='M 8 16 A 8 8 0 0 1 24 16'/>
      <line x1='16' y1='8' x2='16' y2='13'/>
    </g>
    <g stroke='${_hex(0xff3838)}' stroke-width='${sw}'>
      <path d='M 8 16 A 8 8 0 0 1 24 16'/>
      <line x1='16' y1='8' x2='16' y2='13'/>
    </g>
    <circle cx='16' cy='16' r='1.6' fill='${_hex(0xff5050)}' stroke='${_hex(0x050607)}' stroke-width='0.8'/>
  </g>`;
}

// Holographic sight — chevron pointing UP with a circle around it,
// echoing the EOTech / OKP-7 style.
function svgHolo(rarity) {
  const r = RARITY_BOOST[rarity] || RARITY_BOOST.common;
  const sw = 1.3 * r.stroke;
  return `<g fill='none' stroke-linecap='round' stroke-linejoin='round'>
    <g stroke='${_hex(0x050607)}' stroke-width='${sw + 1.4}' opacity='0.7'>
      <circle cx='16' cy='16' r='9'/>
      <polyline points='12,18 16,14 20,18'/>
      <circle cx='16' cy='16' r='1.0' fill='${_hex(0x050607)}'/>
    </g>
    <g stroke='${_hex(0xff3030)}' stroke-width='${sw}'>
      <circle cx='16' cy='16' r='9'/>
      <polyline points='12,18 16,14 20,18'/>
    </g>
    <circle cx='16' cy='16' r='1.0' fill='${_hex(0xff5050)}'/>
  </g>`;
}

// Mid scope — military "Christmas tree" mil-dot reticle. Vertical
// drop dots below the center for holdover, horizontal mil ticks for
// windage. Pure black outline + white inner stroke for contrast.
function svgScope(rarity) {
  const r = RARITY_BOOST[rarity] || RARITY_BOOST.common;
  const sw = 1.0 * r.stroke;
  return `<g fill='none' stroke-linecap='round'>
    <g stroke='${_hex(0x050607)}' stroke-width='${sw + 2}' opacity='0.85'>
      <circle cx='16' cy='16' r='12'/>
      <line x1='16' y1='2' x2='16' y2='10'/>
      <line x1='16' y1='22' x2='16' y2='30'/>
      <line x1='2' y1='16' x2='10' y2='16'/>
      <line x1='22' y1='16' x2='30' y2='16'/>
      <line x1='14' y1='20' x2='18' y2='20'/>
      <line x1='14' y1='23' x2='18' y2='23'/>
      <line x1='15' y1='26' x2='17' y2='26'/>
      <line x1='12' y1='17' x2='12' y2='15'/>
      <line x1='9'  y1='17' x2='9'  y2='15'/>
      <line x1='6'  y1='17' x2='6'  y2='15'/>
      <line x1='20' y1='17' x2='20' y2='15'/>
      <line x1='23' y1='17' x2='23' y2='15'/>
      <line x1='26' y1='17' x2='26' y2='15'/>
    </g>
    <g stroke='${_hex(0xf2e7c9)}' stroke-width='${sw}'>
      <circle cx='16' cy='16' r='12'/>
      <line x1='16' y1='2' x2='16' y2='10'/>
      <line x1='16' y1='22' x2='16' y2='30'/>
      <line x1='2' y1='16' x2='10' y2='16'/>
      <line x1='22' y1='16' x2='30' y2='16'/>
      <line x1='14' y1='20' x2='18' y2='20'/>
      <line x1='14' y1='23' x2='18' y2='23'/>
      <line x1='15' y1='26' x2='17' y2='26'/>
      <line x1='12' y1='17' x2='12' y2='15'/>
      <line x1='9'  y1='17' x2='9'  y2='15'/>
      <line x1='6'  y1='17' x2='6'  y2='15'/>
      <line x1='20' y1='17' x2='20' y2='15'/>
      <line x1='23' y1='17' x2='23' y2='15'/>
      <line x1='26' y1='17' x2='26' y2='15'/>
    </g>
    <circle cx='16' cy='16' r='1.0' fill='${_hex(0xff3030)}'/>
  </g>`;
}

// Public lookup. Resolves an SVG cursor URL string given a sight id
// and rarity. Falls back to the default tactical crosshair.
function _cursorFor(sightId, rarity) {
  const inner = (() => {
    switch (sightId) {
      case 'sight_reddot': return svgRedDot(rarity);
      case 'sight_reflex': return svgReflex(rarity);
      case 'sight_holo':   return svgHolo(rarity);
      case 'sight_scope':  return svgScope(rarity);
      default: return svgDefault();
    }
  })();
  return `${_wrap(inner)} 16 16, crosshair`;
}

// Apply the right cursor to the body for the given weapon. Reads
// weapon.attachments.topRail (the equipped sight) and the attachment's
// rarity. Safe to call every weapon swap; no-op if the same cursor
// would result.
let _appliedKey = '';
export function setCursorForWeapon(weapon) {
  const sight = weapon?.attachments?.topRail;
  const sightId = sight?.id || sight?.kind || '';
  // Look up rarity — attachments may carry their own `rarity` field
  // when rolled with rarity, otherwise default to 'common'.
  const rarity = (sight?.rarity || 'common').toLowerCase();
  const key = `${sightId}|${rarity}`;
  if (key === _appliedKey) return;
  _appliedKey = key;
  document.body.style.cursor = _cursorFor(sightId, rarity);
}
