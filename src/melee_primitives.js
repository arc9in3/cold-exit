// Procedural primitive meshes for melee weapons. Authored along +Z,
// length matches `weapon.muzzleLength`, girth matches `weapon.muzzleGirth`,
// and the dominant accent color comes from `weapon.tracerColor` so a single
// table line in tunables drives both the swing FX and the in-hand silhouette.
//
// The grip end sits at z = -len/2 and the working end at z = +len/2, which
// matches how player.js / gunman.js position the inHandModel container so
// the hand lands on the grip and the tip points forward along the arm.

import * as THREE from 'three';

const HANDLE_DARK   = 0x1a1a1c;
const HANDLE_WOOD   = 0x6a4a2a;
const HANDLE_BLACK  = 0x111114;
const STEEL         = 0xb8b8c0;
const BRASS         = 0xc99030;
const RED_AXE       = 0xb04030;

const SHARED = {};

function _box(w, h, d, color, x = 0, y = 0, z = 0, opts = {}) {
  const key = `box:${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}`;
  if (!SHARED[key]) SHARED[key] = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? 0.55, metalness: opts.metalness ?? 0.4,
  });
  const m = new THREE.Mesh(SHARED[key], mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function _cyl(rTop, rBot, h, color, x = 0, y = 0, z = 0, opts = {}) {
  const key = `cyl:${rTop.toFixed(3)}:${rBot.toFixed(3)}:${h.toFixed(3)}`;
  if (!SHARED[key]) SHARED[key] = new THREE.CylinderGeometry(rTop, rBot, h, 10);
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? 0.6, metalness: opts.metalness ?? 0.3,
  });
  const m = new THREE.Mesh(SHARED[key], mat);
  // Cylinders default along +Y in three.js. Rotate so the height runs
  // along +Z — that matches the convention every weapon here uses.
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// Bladed weapon: leather-wrapped grip + steel blade. Optional crossguard
// (katana-style tsuba) and curve (kukri / katana belly).
function _buildBlade(group, len, girth, bladeColor, opts = {}) {
  const handleLen = (opts.handleRatio ?? 0.30) * len;
  const bladeLen  = len - handleLen;
  const handleZ   = -len / 2 + handleLen / 2;
  const bladeZ    = -len / 2 + handleLen + bladeLen / 2;

  group.add(_cyl(girth * 0.95, girth * 1.05, handleLen, opts.handleColor ?? HANDLE_DARK,
                 0, 0, handleZ, { roughness: 0.85, metalness: 0.1 }));
  if (opts.guard) {
    group.add(_box(girth * 2.4, girth * 1.1, girth * 0.45, 0x2a2a30,
                   0, 0, handleZ + handleLen / 2 + girth * 0.25,
                   { roughness: 0.5, metalness: 0.7 }));
  }
  // Blade — wider than the handle, thin in the cutting axis. Material
  // gets high metalness so the tracer color reads as polished steel.
  const bladeWidth     = girth * (opts.bladeWidthRatio ?? 1.6);
  const bladeThickness = girth * (opts.bladeThicknessRatio ?? 0.35);
  group.add(_box(bladeWidth, bladeThickness, bladeLen, bladeColor,
                 0, 0, bladeZ, { roughness: 0.25, metalness: 0.85 }));
  // Curve hint — a second smaller wedge offset along +X to suggest a
  // belly. Cheap visual cue so kukri / katana don't look like a knife.
  if (opts.curve) {
    group.add(_box(bladeWidth * 0.55, bladeThickness * 0.95, bladeLen * 0.55, bladeColor,
                   girth * 0.5, 0, bladeZ + bladeLen * 0.15,
                   { roughness: 0.3, metalness: 0.85 }));
  }
}

// Plain shaft / cylinder: club, baseball bat, crowbar. Optional taper
// (bat) and a small claw at the working end (crowbar).
function _buildShaft(group, len, girth, color, opts = {}) {
  const taper = opts.taperRatio ?? 1.0;     // tip / grip girth ratio
  const gripR = girth;
  const tipR  = girth * taper;
  group.add(_cyl(tipR, gripR, len, color, 0, 0, 0,
                 { roughness: opts.roughness ?? 0.7, metalness: opts.metalness ?? 0.2 }));
  if (opts.cap) {
    group.add(_cyl(tipR * 1.05, tipR * 1.05, girth * 0.6, opts.cap,
                   0, 0, len / 2 + girth * 0.3, { roughness: 0.6, metalness: 0.3 }));
  }
  if (opts.hook) {
    // Crowbar claw — small bent slab perpendicular to the shaft.
    const tipZ = len / 2;
    group.add(_box(girth * 1.6, girth * 0.6, girth * 1.4, color,
                   0, girth * 0.7, tipZ - girth * 0.5,
                   { roughness: 0.55, metalness: 0.7 }));
  }
}

// Brass knuckles — short loop that sits across the front of the fist.
function _buildKnuckles(group, len, girth, color) {
  const w = len * 0.9;
  const h = girth * 1.6;
  const d = girth * 1.4;
  group.add(_box(w, h, d, color, 0, 0, 0, { roughness: 0.4, metalness: 0.85 }));
  // Four bumps on the striking face for the finger holes silhouette.
  for (let i = -1.5; i <= 1.5; i += 1) {
    group.add(_box(w * 0.16, h * 1.2, d * 0.6, color,
                   i * (w / 5), 0, d * 0.55,
                   { roughness: 0.4, metalness: 0.85 }));
  }
}

// Headed weapons — shaft + perpendicular head block at the working end.
function _buildHeaded(group, len, girth, headColor, opts = {}) {
  const shaftRatio = opts.shaftRatio ?? 0.84;
  const shaftLen   = len * shaftRatio;
  const shaftR     = girth * (opts.shaftGirthRatio ?? 0.55);
  const shaftZ     = -len / 2 + shaftLen / 2;
  group.add(_cyl(shaftR, shaftR, shaftLen, opts.shaftColor ?? HANDLE_WOOD,
                 0, 0, shaftZ, { roughness: 0.85, metalness: 0.1 }));
  // Head sits past the shaft tip. `shape` controls aspect ratio.
  const headShape = opts.headShape ?? 'wedge';
  const headZ = -len / 2 + shaftLen + (len - shaftLen) / 2;
  if (headShape === 'wedge') {
    // Axe head — tall blade-edge perpendicular to shaft.
    const hw = girth * 1.0;
    const hh = girth * 3.2;
    const hd = (len - shaftLen) * 0.95;
    group.add(_box(hw, hh, hd, headColor, 0, 0, headZ,
                   { roughness: 0.35, metalness: 0.75 }));
  } else if (headShape === 'block') {
    // Sledgehammer / hammer head — short fat block.
    const hw = girth * 1.6;
    const hh = girth * 1.6;
    const hd = (len - shaftLen) * 1.6;
    group.add(_box(hw, hh, hd, headColor, 0, 0, headZ,
                   { roughness: 0.45, metalness: 0.65 }));
  }
}

// Chainsaw — body block at the grip + thin guide bar extending past it.
function _buildPowered(group, len, girth, accentColor) {
  const bodyLen = len * 0.45;
  const bodyZ   = -len / 2 + bodyLen / 2;
  const barLen  = len - bodyLen;
  const barZ    = -len / 2 + bodyLen + barLen / 2;
  group.add(_box(girth * 2.5, girth * 2.2, bodyLen, accentColor,
                 0, 0, bodyZ, { roughness: 0.5, metalness: 0.4 }));
  // Bar — flat, long, light grey. Chain teeth are implied.
  group.add(_box(girth * 1.0, girth * 0.5, barLen, STEEL,
                 0, 0, barZ, { roughness: 0.4, metalness: 0.6 }));
  // Top-rail hint — small dark strip along the bar.
  group.add(_box(girth * 0.4, girth * 0.6, barLen * 0.95, 0x111114,
                 0, girth * 0.45, barZ, { roughness: 0.7, metalness: 0.2 }));
}

// Per-weapon-name dispatch. Falls back to a generic shaft for any melee
// weapon without a specific entry — keeps the system additive.
const PROFILES = {
  'Combat Knife':  (g, l, gth, c) => _buildBlade(g, l, gth, c,
                     { handleRatio: 0.30, handleColor: HANDLE_DARK }),
  // Survival Knife — same blade pattern as Combat Knife but a slightly
  // longer blade with a tan-rope handle wrap to differentiate it.
  // Without this entry it fell through to _buildShaft, which painted
  // the whole weapon the tracerColor (light gray) and read as "all
  // white" with no handle silhouette.
  'Survival Knife':(g, l, gth, c) => _buildBlade(g, l, gth, c,
                     { handleRatio: 0.28, handleColor: 0x6a4a2a }),
  'Scimitar':      (g, l, gth, c) => _buildBlade(g, l, gth, c,
                     { handleRatio: 0.22, handleColor: 0x2a1a14, curve: true,
                       bladeWidthRatio: 1.5, bladeThicknessRatio: 0.20 }),
  'Kukri':         (g, l, gth, c) => _buildBlade(g, l, gth, c,
                     { handleRatio: 0.28, handleColor: 0x2a1a14, curve: true,
                       bladeWidthRatio: 1.9, bladeThicknessRatio: 0.3 }),
  'katana':        (g, l, gth, c) => _buildBlade(g, l, gth, c,
                     { handleRatio: 0.22, handleColor: HANDLE_BLACK,
                       guard: true, curve: true,
                       bladeWidthRatio: 1.3, bladeThicknessRatio: 0.22 }),
  'Hammer':        (g, l, gth, c) => _buildShaft(g, l, gth, c,
                     { taperRatio: 1.0, roughness: 0.9, metalness: 0.05 }),
  'Baseball Bat':  (g, l, gth, c) => _buildShaft(g, l, gth, c,
                     { taperRatio: 1.7, cap: 0x222018,
                       roughness: 0.85, metalness: 0.1 }),
  'Crowbar':       (g, l, gth, c) => _buildShaft(g, l, gth, c,
                     { taperRatio: 1.0, hook: true,
                       roughness: 0.5, metalness: 0.7 }),
  'Brass Knuckles':(g, l, gth, c) => _buildKnuckles(g, l, gth, c),
  'Tomahawk':      (g, l, gth, c) => _buildHeaded(g, l, gth, c,
                     { shaftRatio: 0.86, headShape: 'wedge',
                       shaftColor: HANDLE_WOOD }),
  'Fire Axe':      (g, l, gth, c) => _buildHeaded(g, l, gth, RED_AXE,
                     { shaftRatio: 0.84, headShape: 'wedge',
                       shaftColor: HANDLE_WOOD }),
  'Sledgehammer':  (g, l, gth, c) => _buildHeaded(g, l, gth, c,
                     { shaftRatio: 0.78, headShape: 'block',
                       shaftColor: 0x4a3424 }),
  'Chainsaw':      (g, l, gth, c) => _buildPowered(g, l, gth, c),
};

// Build a primitive in-hand mesh for a melee weapon. Returns a Group whose
// origin sits at the weapon's centre, designed to drop into an inHandModel
// container that is already positioned + rotated for hand-held use.
export function buildMeleePrimitive(weapon) {
  const group = new THREE.Group();
  if (!weapon) return group;
  const len   = weapon.muzzleLength ?? 0.7;
  const girth = weapon.muzzleGirth ?? 0.05;
  const color = weapon.tracerColor ?? STEEL;
  const fn = PROFILES[weapon.name] || ((g, l, gth, c) => _buildShaft(g, l, gth, c));
  fn(group, len, girth, color);
  return group;
}
