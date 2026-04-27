// Primitive-built interior props for themed rooms (library, lobby,
// bedroom, living room, warehouse). Everything here composes simple
// Box/Cylinder geometries into a `THREE.Group`. Each factory returns
// `{ group, collision }` — `collision` is an AABB half-extent pair
// `{ w, d }` (width on X, depth on Z) if the prop should block
// movement / sight, or `null` if it's purely decorative (e.g. a vase
// small enough to step over).
//
// Props are positioned at y=0 via the group origin; callers translate
// them into world space. Rotation is applied on the group (yaw only
// — props always sit on the floor).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Global prop scale. With the rig now at ~1.85m (realistic human
// scale), props authored at real-world sizes land at the right
// proportion without the 2x fudge factor the oversized rig needed.
const PROP_SCALE = 1.0;

// Shared toon palette. Uses a small 3-step gradient so primitives
// match the cel-shaded actor rig. Cached across every prop so we
// don't allocate fresh textures per call.
let _toon = null;
function toonGradient() {
  if (_toon) return _toon;
  const data = new Uint8Array([90, 180, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _toon = tex;
  return tex;
}

function mat(color) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
}

function box(w, h, d, color, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

function cyl(radius, h, color, segments = 14) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, h, segments),
    mat(color),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// =====================================================================
// Polish primitives — softer silhouettes per the Assets/levels1.png
// reference. Three helpers + a shared geometry cache so the visual
// upgrade doesn't cost extra GPU buffers when the same prop dims
// repeat across rooms.
//
// Buffers are cached by hash of constructor args. With one shared
// buffer per (w, h, d, radius) tuple, a level full of similar
// couches / tables / lockers reuses the same RoundedBoxGeometry
// across every instance.
//
// Same dispose-guard pattern as actor_rig: mesh.userData.shared = true
// so any traversal-based dispose loop can skip these buffers.
// =====================================================================
const _propGeomCache = new Map();
function _stamp(g) {
  g.userData = g.userData || {};
  g.userData.sharedRigGeom = true;
  return g;
}

function _roundedBoxGeom(w, h, d, radius, segments = 2) {
  const key = `rbox|${w}|${h}|${d}|${radius}|${segments}`;
  let g = _propGeomCache.get(key);
  if (!g) {
    // RoundedBoxGeometry's segments param controls bevel quality.
    // 2 is the sweet spot — soft enough to read as "designed," cheap
    // enough not to bloat vertex counts (~96 verts vs 8 for a Box).
    g = _stamp(new RoundedBoxGeometry(w, h, d, segments, radius));
    _propGeomCache.set(key, g);
  }
  return g;
}

function _taperedCylGeom(topR, botR, h, segs = 12) {
  const key = `tcyl|${topR}|${botR}|${h}|${segs}`;
  let g = _propGeomCache.get(key);
  if (!g) {
    g = _stamp(new THREE.CylinderGeometry(topR, botR, h, segs));
    _propGeomCache.set(key, g);
  }
  return g;
}

// Soft chamfered box — looks like a real piece of furniture, not a
// programmer-art cube. Default radius is 5% of the smallest
// dimension so small props (vase, planter) get a subtle bevel and
// big props (couch, locker) get a more visible one.
function roundedBox(w, h, d, color, opts = {}) {
  const minDim = Math.min(w, h, d);
  const radius = opts.radius ?? Math.min(0.06, minDim * 0.18);
  const m = new THREE.Mesh(_roundedBoxGeom(w, h, d, radius, opts.segments || 2), mat(color));
  m.castShadow = opts.cast !== false;
  m.receiveShadow = true;
  return m;
}

// Tapered cylinder — for chair legs, lamp stems, classical pillars.
// `topR` and `botR` differ; reads as "designed" rather than "pipe."
function tapered(topR, botR, h, color, segs = 12) {
  const m = new THREE.Mesh(_taperedCylGeom(topR, botR, h, segs), mat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Wood color palette — kept consistent across furniture.
const COL = {
  woodDark:  0x3a2416,
  woodMid:   0x6a4828,
  woodLight: 0x9c7444,
  fabric:    0x2e3a48,
  fabricWarm:0x5a3a2a,
  metal:     0x4a5056,
  metalDark: 0x2a2f36,
  paper:     0xd8cfa8,
  bookRed:   0x7a2020,
  bookBlue:  0x1f3a6a,
  bookGreen: 0x2e5a2a,
  bookTan:   0x8a6630,
  marble:    0xc8c2b8,
  lampGlow:  0xffcf60,
  concrete:  0x6c6c6c,
  plaster:   0xe2d8c0,
  linen:     0xe6dcc0,
  tv:        0x1a1d22,
};

// --- Individual prop factories --------------------------------------

export function buildVase(opts = {}) {
  const h = opts.h ?? 0.55;
  const r = opts.r ?? 0.12;
  const color = opts.color ?? 0x8a2a2a;
  const group = new THREE.Group();
  // Body + neck. Two cylinders stacked for a silhouette.
  const body = cyl(r, h * 0.75, color);
  body.position.y = h * 0.375;
  group.add(body);
  const neck = cyl(r * 0.55, h * 0.25, color);
  neck.position.y = h * 0.87;
  group.add(neck);
  return { group, collision: null };
}

export function buildTable(opts = {}) {
  const w = opts.w ?? 1.6;
  const d = opts.d ?? 0.9;
  const h = opts.h ?? 0.75;
  const wood = opts.color ?? COL.woodMid;
  const group = new THREE.Group();
  // Top slab — chamfered so the corners read as a real edge profile.
  const top = roundedBox(w, 0.08, d, wood, { radius: 0.025 });
  top.position.y = h - 0.04;
  group.add(top);
  // Apron — the rim under the top connecting the legs. Reads as a
  // proper piece of furniture rather than a slab on stilts.
  const apronH = 0.06;
  const apron = roundedBox(w * 0.92, apronH, d * 0.92, COL.woodDark, { radius: 0.02 });
  apron.position.y = h - 0.08 - apronH / 2;
  group.add(apron);
  // Four legs — slightly tapered (top wider than bottom = sturdy
  // craftsman feel). Square section, gentle taper.
  const legTopR = 0.04;
  const legBotR = 0.034;
  const legH = h - 0.14;
  const legY = legH / 2;
  const dx = (w * 0.92 - legTopR * 2) * 0.5;
  const dz = (d * 0.92 - legTopR * 2) * 0.5;
  for (const sx of [-dx, dx]) {
    for (const sz of [-dz, dz]) {
      const leg = tapered(legTopR, legBotR, legH, COL.woodDark, 6);
      leg.position.set(sx, legY, sz);
      group.add(leg);
    }
  }
  return { group, collision: { w, d } };
}

export function buildCoffeeTable(opts = {}) {
  return buildTable({ w: opts.w ?? 1.1, d: opts.d ?? 0.55, h: opts.h ?? 0.45,
                      color: opts.color ?? COL.woodMid });
}

export function buildDesk(opts = {}) {
  const w = opts.w ?? 1.4;
  const d = opts.d ?? 0.7;
  const h = opts.h ?? 0.78;
  const wood = opts.color ?? COL.woodMid;
  const { group } = buildTable({ w, d, h, color: wood });
  // Cabinet on one side under the desktop — a small drawer stack.
  const cabW = 0.4, cabH = h - 0.12, cabD = d - 0.05;
  const cab = box(cabW, cabH, cabD, COL.woodDark);
  cab.position.set(w * 0.28, cabH / 2, 0);
  group.add(cab);
  // Two drawer faces on the cabinet.
  for (let i = 0; i < 2; i++) {
    const face = box(cabW - 0.06, cabH / 2 - 0.08, 0.02, COL.woodLight);
    face.position.set(w * 0.28, (i + 0.5) * (cabH / 2), cabD / 2 + 0.01);
    group.add(face);
  }
  return { group, collision: { w, d } };
}

export function buildChair(opts = {}) {
  const w = opts.w ?? 0.48;
  const d = opts.d ?? 0.48;
  const seatH = opts.seatH ?? 0.46;
  const backH = opts.backH ?? 0.55;
  const wood = opts.color ?? COL.woodMid;
  const group = new THREE.Group();
  // Seat — soft chamfer.
  const seat = roundedBox(w, 0.06, d, wood, { radius: 0.02 });
  seat.position.y = seatH - 0.03;
  group.add(seat);
  // Back rest — softer with a rounded top.
  const back = roundedBox(w * 0.9, backH, 0.05, wood, { radius: 0.03 });
  back.position.set(0, seatH + backH / 2, -d / 2 + 0.025);
  group.add(back);
  // Four tapered legs — top wider than bottom for stability silhouette.
  const legTopR = 0.027;
  const legBotR = 0.022;
  const legH = seatH - 0.06;
  const legY = legH / 2;
  const dx = (w - 0.06) * 0.46;
  const dz = (d - 0.06) * 0.46;
  for (const sx of [-dx, dx]) {
    for (const sz of [-dz, dz]) {
      const leg = tapered(legTopR, legBotR, legH, COL.woodDark, 6);
      leg.position.set(sx, legY, sz);
      group.add(leg);
    }
  }
  return { group, collision: { w: w * 0.95, d: d * 0.95 } };
}

export function buildBookshelf(opts = {}) {
  const w = opts.w ?? 1.3;
  const d = opts.d ?? 0.35;
  const h = opts.h ?? 2.1;
  const wood = opts.color ?? COL.woodDark;
  const group = new THREE.Group();
  // Back panel.
  const back = box(w, h, 0.04, wood);
  back.position.set(0, h / 2, -d / 2 + 0.02);
  group.add(back);
  // Side panels.
  for (const sx of [-w / 2 + 0.02, w / 2 - 0.02]) {
    const side = box(0.04, h, d, wood);
    side.position.set(sx, h / 2, 0);
    group.add(side);
  }
  // Top + bottom caps.
  const cap = box(w, 0.05, d, wood);
  cap.position.set(0, h - 0.025, 0);
  group.add(cap);
  const base = box(w, 0.05, d, wood);
  base.position.set(0, 0.025, 0);
  group.add(base);
  // 4 internal shelves + book rows.
  const shelfCount = 4;
  const usable = h - 0.12;
  const shelfGap = usable / shelfCount;
  const bookColors = [COL.bookRed, COL.bookBlue, COL.bookGreen, COL.bookTan];
  for (let i = 0; i < shelfCount; i++) {
    const y = 0.05 + i * shelfGap;
    const shelf = box(w - 0.06, 0.04, d - 0.04, wood);
    shelf.position.set(0, y + shelfGap - 0.04, 0);
    group.add(shelf);
    // Row of books on this shelf.
    let x = -w / 2 + 0.1;
    while (x < w / 2 - 0.08) {
      const bw = 0.04 + Math.random() * 0.05;
      const bh = shelfGap * (0.55 + Math.random() * 0.35);
      const col = bookColors[Math.floor(Math.random() * bookColors.length)];
      const book = box(bw, bh, d * 0.7, col);
      book.position.set(x + bw / 2, y + bh / 2, 0);
      group.add(book);
      x += bw + 0.005;
    }
  }
  return { group, collision: { w, d } };
}

export function buildBed(opts = {}) {
  const w = opts.w ?? 1.4;
  const d = opts.d ?? 2.0;
  const frameH = opts.frameH ?? 0.3;
  const wood = opts.color ?? COL.woodDark;
  const group = new THREE.Group();
  // Frame — chamfered for a softer wooden feel.
  const frame = roundedBox(w, frameH, d, wood, { radius: 0.04 });
  frame.position.y = frameH / 2;
  group.add(frame);
  // Mattress — round the corners so it reads as foam, not a slab.
  const matH = 0.18;
  const mat_ = roundedBox(w - 0.06, matH, d - 0.06, COL.linen, { radius: 0.05 });
  mat_.position.y = frameH + matH / 2;
  group.add(mat_);
  // Pillow — soft pad with rounded edges.
  const pillow = roundedBox(w * 0.5, 0.1, 0.3, COL.paper, { radius: 0.04 });
  pillow.position.set(0, frameH + matH + 0.06, -d / 2 + 0.22);
  group.add(pillow);
  // Headboard — taller, with a softer top edge.
  const head = roundedBox(w + 0.06, 0.6, 0.08, wood, { radius: 0.06 });
  head.position.set(0, frameH + 0.30, -d / 2 + 0.04);
  group.add(head);
  return { group, collision: { w, d } };
}

export function buildCouch(opts = {}) {
  const w = opts.w ?? 1.9;
  const d = opts.d ?? 0.85;
  const fabric = opts.color ?? COL.fabric;
  const group = new THREE.Group();
  // Base — chamfered slab so the couch reads as upholstered, not boxy.
  const baseH = 0.38;
  const base = roundedBox(w, baseH, d, fabric, { radius: 0.06 });
  base.position.y = baseH / 2;
  group.add(base);
  // Back — slightly thicker than before so the silhouette has weight.
  const backH = 0.58;
  const back = roundedBox(w, backH, 0.22, fabric, { radius: 0.05 });
  back.position.set(0, baseH + backH / 2, -d / 2 + 0.11);
  group.add(back);
  // Arms — taller than the back rest by a hair (real couches do this),
  // with a soft rounded top.
  const armH = backH + 0.06;
  for (const sx of [-w / 2 + 0.12, w / 2 - 0.12]) {
    const arm = roundedBox(0.22, armH, d, fabric, { radius: 0.08 });
    arm.position.set(sx, baseH + armH / 2, 0);
    group.add(arm);
  }
  // Seat cushions — soft rounded pads, slightly proud of the base.
  for (const sx of [-w / 4, w / 4]) {
    const cush = roundedBox(w / 2 - 0.22, 0.14, d - 0.32, COL.linen, { radius: 0.05 });
    cush.position.set(sx, baseH + 0.07, 0.05);
    group.add(cush);
  }
  return { group, collision: { w, d } };
}

export function buildLamp(opts = {}) {
  const h = opts.h ?? 1.5;
  const group = new THREE.Group();
  // Base.
  const base = cyl(0.18, 0.04, COL.metalDark);
  base.position.y = 0.02;
  group.add(base);
  // Stem.
  const stem = cyl(0.03, h * 0.8, COL.metalDark);
  stem.position.y = 0.04 + h * 0.4;
  group.add(stem);
  // Shade (cone).
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.28, 12),
    mat(COL.linen),
  );
  shade.position.y = h - 0.14;
  shade.castShadow = true;
  group.add(shade);
  // Warm point light under the shade so the lamp actually lights.
  const light = new THREE.PointLight(COL.lampGlow, 1.4, 4.0);
  light.position.y = h - 0.2;
  group.add(light);
  return { group, collision: null };
}

export function buildCrate(opts = {}) {
  const s = opts.s ?? 0.8;
  const group = new THREE.Group();
  const body = box(s, s, s, COL.woodMid);
  body.position.y = s / 2;
  group.add(body);
  // Slat details across two faces.
  const slat = 0.05;
  for (let i = 1; i < 4; i++) {
    const y = i * (s / 4);
    const band = box(s + 0.01, slat, s + 0.01, COL.woodDark);
    band.position.y = y;
    group.add(band);
  }
  return { group, collision: { w: s, d: s } };
}

export function buildBarrel(opts = {}) {
  const r = opts.r ?? 0.32;
  const h = opts.h ?? 0.9;
  const group = new THREE.Group();
  const body = cyl(r, h, COL.woodMid, 16);
  body.position.y = h / 2;
  group.add(body);
  // Metal bands.
  for (const y of [h * 0.2, h * 0.8]) {
    const band = cyl(r * 1.05, 0.05, COL.metalDark, 16);
    band.position.y = y;
    group.add(band);
  }
  // Top lid.
  const lid = cyl(r * 0.92, 0.04, COL.woodDark, 16);
  lid.position.y = h - 0.02;
  group.add(lid);
  return { group, collision: { w: r * 2, d: r * 2 } };
}

export function buildFilingCabinet(opts = {}) {
  const w = opts.w ?? 0.5;
  const d = opts.d ?? 0.6;
  const h = opts.h ?? 1.3;
  const group = new THREE.Group();
  const body = box(w, h, d, COL.metal);
  body.position.y = h / 2;
  group.add(body);
  // Drawer faces — 3 stacked.
  for (let i = 0; i < 3; i++) {
    const dH = (h - 0.12) / 3;
    const face = box(w - 0.06, dH - 0.04, 0.02, COL.metalDark);
    face.position.set(0, 0.06 + (i + 0.5) * dH, d / 2 + 0.01);
    group.add(face);
    // Tiny handle.
    const handle = box(0.1, 0.025, 0.04, COL.metalDark);
    handle.position.set(0, 0.06 + (i + 0.5) * dH, d / 2 + 0.03);
    group.add(handle);
  }
  return { group, collision: { w, d } };
}

export function buildPallet(opts = {}) {
  const w = opts.w ?? 1.2;
  const d = opts.d ?? 0.8;
  const group = new THREE.Group();
  // Base slats across Z.
  for (let i = 0; i < 4; i++) {
    const slat = box(w, 0.05, 0.12, COL.woodMid);
    slat.position.set(0, 0.12, -d / 2 + 0.06 + i * ((d - 0.12) / 3));
    group.add(slat);
  }
  // Support blocks underneath.
  for (const sx of [-w / 2 + 0.1, 0, w / 2 - 0.1]) {
    const blk = box(0.1, 0.08, d, COL.woodDark);
    blk.position.set(sx, 0.04, 0);
    group.add(blk);
  }
  return { group, collision: { w, d } };
}

export function buildNightstand(opts = {}) {
  const w = opts.w ?? 0.5;
  const d = opts.d ?? 0.42;
  const h = opts.h ?? 0.55;
  const wood = opts.color ?? COL.woodDark;
  const group = new THREE.Group();
  const body = roundedBox(w, h, d, wood, { radius: 0.03 });
  body.position.y = h / 2;
  group.add(body);
  // Drawer face — rounded so it pops as a recessed panel.
  const face = roundedBox(w - 0.06, 0.2, 0.02, COL.woodLight, { radius: 0.015 });
  face.position.set(0, h * 0.7, d / 2 + 0.01);
  group.add(face);
  // Handle — small rounded pill.
  const handle = roundedBox(0.08, 0.025, 0.04, COL.metalDark, { radius: 0.012 });
  handle.position.set(0, h * 0.7, d / 2 + 0.03);
  group.add(handle);
  return { group, collision: { w, d } };
}

export function buildTV(opts = {}) {
  const w = opts.w ?? 1.2;
  const h = opts.h ?? 0.7;
  const group = new THREE.Group();
  // Stand.
  const standW = 0.4;
  const stand = box(standW, 0.6, 0.3, COL.metalDark);
  stand.position.y = 0.3;
  group.add(stand);
  // Screen.
  const frame = box(w, h, 0.08, COL.metalDark);
  frame.position.y = 0.6 + h / 2;
  group.add(frame);
  const screen = box(w - 0.06, h - 0.06, 0.01, COL.tv);
  screen.position.set(0, 0.6 + h / 2, 0.05);
  screen.material = new THREE.MeshBasicMaterial({ color: 0x224466 });
  group.add(screen);
  return { group, collision: { w: standW, d: 0.3 } };
}

export function buildRug(opts = {}) {
  const w = opts.w ?? 2.2;
  const d = opts.d ?? 1.4;
  const color = opts.color ?? 0x6a2018;
  const group = new THREE.Group();
  const rug = box(w, 0.02, d, color, false);
  rug.position.y = 0.01;
  group.add(rug);
  return { group, collision: null };
}

// --- Phase-1 additions: themed environment props ---------------------
// Per the Assets/levels1.png reference. Built from the same primitive
// composition pattern as the props above. Important: the new
// emissive props (neon stick, window) use MeshBasicMaterial only —
// NO real PointLight. The light reduction pass (Phase 4) is
// retroactively converting old per-prop lights to the same pattern;
// new code shouldn't introduce more dynamic lights.

// Concrete pillar — fat round column with a small base + capital.
// Common in garage / penthouse / lobby. Subtle entasis (gentle
// barrel-shape) reads as a real architectural column instead of a
// pipe.
export function buildPillar(opts = {}) {
  const r = opts.r ?? 0.32;
  const h = opts.h ?? 3.0;
  const color = opts.color ?? COL.concrete;
  const group = new THREE.Group();
  // Base flange — wider plinth.
  const baseH = 0.10;
  const base = tapered(r * 1.30, r * 1.30, baseH, COL.metalDark, 16);
  base.position.y = baseH / 2;
  group.add(base);
  // Lower shaft — slightly wider at the base than mid-shaft (entasis).
  const shaftH = h - baseH - 0.10;
  const shaft = tapered(r * 0.94, r * 1.04, shaftH, color, 16);
  shaft.position.y = baseH + shaftH / 2;
  group.add(shaft);
  // Capital — wider abacus at the top.
  const capH = 0.10;
  const cap = tapered(r * 1.22, r * 1.10, capH, COL.metalDark, 16);
  cap.position.y = h - capH / 2;
  group.add(cap);
  // Collision matches the WIDEST visible silhouette (base flange at
  // 1.30r). Prior collision used the shaft radius, which let the base
  // poke ~0.1m past walls when placed on a tight EDGE_CLEAR.
  return { group, collision: { w: r * 2.6, d: r * 2.6 } };
}

// Long bench — flat seat without a back. Standard for nightclub VIP,
// hotel lobby, rooftop. Half-height cover.
export function buildBench(opts = {}) {
  const w = opts.w ?? 1.8;
  const d = opts.d ?? 0.45;
  const h = opts.h ?? 0.45;
  const seatColor = opts.color ?? COL.fabric;
  const legColor = opts.legColor ?? COL.metalDark;
  const group = new THREE.Group();
  // Seat slab — soft rounded edges, reads as upholstered.
  const seat = roundedBox(w, 0.10, d, seatColor, { radius: 0.04 });
  seat.position.y = h - 0.05;
  group.add(seat);
  // Two leg blocks — rounded so they look like turned wood / cast
  // metal, not raw 2x4s.
  for (const sx of [-w / 2 + 0.08, w / 2 - 0.08]) {
    const leg = roundedBox(0.10, h - 0.10, d - 0.04, legColor, { radius: 0.025 });
    leg.position.set(sx, (h - 0.10) / 2, 0);
    group.add(leg);
  }
  return { group, collision: { w, d } };
}

// Tall narrow locker — single-door employee locker, vent slats on the
// face. Cleaner silhouette than the filing-cabinet variant for
// nightclub back-of-house, garage, and locker rooms.
export function buildLocker(opts = {}) {
  const w = opts.w ?? 0.55;
  const d = opts.d ?? 0.45;
  const h = opts.h ?? 1.85;
  const color = opts.color ?? COL.metal;
  const group = new THREE.Group();
  // Body — rounded so the silhouette has manufactured-product feel.
  const body = roundedBox(w, h, d, color, { radius: 0.035 });
  body.position.y = h / 2;
  group.add(body);
  // Door seam.
  const seam = box(0.02, h - 0.10, 0.02, COL.metalDark);
  seam.position.set(0, h / 2, d / 2 + 0.005);
  group.add(seam);
  // Vent slats.
  for (let i = 0; i < 3; i++) {
    const vent = box(w * 0.35, 0.025, 0.02, COL.metalDark);
    vent.position.set(0, h - 0.18 - i * 0.05, d / 2 + 0.012);
    group.add(vent);
  }
  // Handle — rounded grip pill.
  const handle = roundedBox(0.04, 0.10, 0.03, COL.metalDark, { radius: 0.012 });
  handle.position.set(w * 0.30, h * 0.5, d / 2 + 0.015);
  group.add(handle);
  return { group, collision: { w, d } };
}

// Vertical neon stick — wall-mounted bar of light for nightclub
// signage / accent strips. Pure emissive, NO real PointLight (light
// reduction policy). The colour is read by Phase 2's theme system
// so a magenta club gets pink sticks, a rooftop gets blue.
export function buildNeonStick(opts = {}) {
  const h = opts.h ?? 1.6;
  const w = opts.w ?? 0.06;
  const d = opts.d ?? 0.04;
  const color = opts.color ?? 0xff40a0;
  const group = new THREE.Group();
  // Outer "tube" — slightly larger box with low opacity so the inner
  // core reads as a glow halo around the bar.
  const halo = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.04, h + 0.04, d + 0.04),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.25, depthWrite: false,
    }),
  );
  halo.position.y = h / 2 + 0.05;
  group.add(halo);
  // Inner emissive core.
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color }),
  );
  core.position.y = h / 2 + 0.05;
  group.add(core);
  // Tiny mount bracket at the bottom.
  const mount = box(w * 1.5, 0.04, d * 1.5, COL.metalDark);
  mount.position.y = 0.02;
  group.add(mount);
  return { group, collision: null };
}

// Wall window — frame + translucent glass + faint emissive glow on
// the glass so the window reads as "lit from outside" without
// adding a real light source. Caller provides position; rotates so
// the glass plane faces +Z.
export function buildWindow(opts = {}) {
  const w = opts.w ?? 1.2;
  const h = opts.h ?? 1.4;
  const frameColor = opts.frameColor ?? COL.metalDark;
  const glassColor = opts.glassColor ?? 0x6890c0;
  const group = new THREE.Group();
  // Frame — thin border around the glass.
  const t = 0.05;
  const top = box(w + t * 2, t, 0.06, frameColor);
  top.position.set(0, h, 0);
  group.add(top);
  const bot = box(w + t * 2, t, 0.06, frameColor);
  bot.position.set(0, 0, 0);
  group.add(bot);
  for (const sx of [-(w / 2 + t / 2), (w / 2 + t / 2)]) {
    const side = box(t, h, 0.06, frameColor);
    side.position.set(sx, h / 2, 0);
    group.add(side);
  }
  // Glass — slightly smaller than the frame, low-opacity emissive.
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.02),
    new THREE.MeshBasicMaterial({
      color: glassColor, transparent: true, opacity: 0.35,
      depthWrite: false,
    }),
  );
  glass.position.set(0, h / 2, 0);
  group.add(glass);
  // Cross-mullion for the "real window" silhouette.
  const mullion = box(w, t * 0.6, 0.04, frameColor);
  mullion.position.set(0, h / 2, 0.01);
  group.add(mullion);
  return { group, collision: null };
}

// Decorative planter — pot + simple foliage. Soft cover (low and
// passable in some places), used to break up open lobby/penthouse
// floor without blocking nav.
export function buildPlanter(opts = {}) {
  const r = opts.r ?? 0.20;
  const h = opts.h ?? 0.85;
  const potColor = opts.potColor ?? 0x3a2418;
  const leafColor = opts.leafColor ?? 0x2c5a2c;
  const group = new THREE.Group();
  // Pot — slightly tapered cylinder.
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 0.85, h * 0.4, 14),
    mat(potColor),
  );
  pot.position.y = h * 0.2;
  pot.castShadow = true;
  group.add(pot);
  // Two stacked spheres for foliage — bigger lower, smaller upper.
  const lower = new THREE.Mesh(new THREE.SphereGeometry(r * 1.4, 12, 8), mat(leafColor));
  lower.position.y = h * 0.55;
  lower.castShadow = true;
  group.add(lower);
  const upper = new THREE.Mesh(new THREE.SphereGeometry(r * 1.05, 12, 8), mat(leafColor));
  upper.position.y = h * 0.85;
  upper.castShadow = true;
  group.add(upper);
  return { group, collision: { w: r * 2, d: r * 2 } };
}

// Knee-high railing — two posts + a horizontal bar. Blocks walking
// but not sightlines (collision lives in the bar's footprint).
// Ideal for rooftop balconies, mezzanines, parking-garage edges.
export function buildRailing(opts = {}) {
  const w = opts.w ?? 2.0;
  const h = opts.h ?? 1.0;
  const color = opts.color ?? COL.metal;
  const group = new THREE.Group();
  // Top rail.
  const rail = box(w, 0.06, 0.06, color);
  rail.position.set(0, h - 0.03, 0);
  group.add(rail);
  // Mid rail.
  const mid = box(w, 0.04, 0.04, color);
  mid.position.set(0, h * 0.55, 0);
  group.add(mid);
  // Posts — every 0.7m.
  const postCount = Math.max(2, Math.ceil(w / 0.7) + 1);
  for (let i = 0; i < postCount; i++) {
    const t = (i / (postCount - 1) - 0.5);
    const post = box(0.06, h, 0.06, color);
    post.position.set(t * w, h / 2, 0);
    group.add(post);
  }
  // Collision is shallow (the railing is thin) but full width.
  return { group, collision: { w, d: 0.12 } };
}

// Decorative door frame — two jambs + a lintel. NOT a real door (no
// blocking, no opening logic). Visual cue for room-within-room
// dividers, hallway transitions, encounter staging.
export function buildDoorFrame(opts = {}) {
  const w = opts.w ?? 1.6;
  const h = opts.h ?? 2.4;
  const color = opts.color ?? COL.woodDark;
  const group = new THREE.Group();
  const t = 0.10;
  // Two side jambs.
  for (const sx of [-w / 2, w / 2]) {
    const jamb = box(t, h, t, color);
    jamb.position.set(sx, h / 2, 0);
    group.add(jamb);
  }
  // Lintel.
  const lintel = box(w + t, t, t, color);
  lintel.position.set(0, h - t / 2, 0);
  group.add(lintel);
  return { group, collision: null };
}

// --- Catalog ---------------------------------------------------------
// Convenience: look up a builder by key. Themed-room code will pick
// from a curated list per theme instead of hardcoding factory names.
export const PROP_BUILDERS = {
  vase: buildVase,
  table: buildTable,
  coffeeTable: buildCoffeeTable,
  desk: buildDesk,
  chair: buildChair,
  bookshelf: buildBookshelf,
  bed: buildBed,
  couch: buildCouch,
  lamp: buildLamp,
  crate: buildCrate,
  barrel: buildBarrel,
  cabinet: buildFilingCabinet,
  pallet: buildPallet,
  nightstand: buildNightstand,
  tv: buildTV,
  rug: buildRug,
  // Phase-1 additions.
  pillar: buildPillar,
  bench: buildBench,
  locker: buildLocker,
  neonStick: buildNeonStick,
  window: buildWindow,
  planter: buildPlanter,
  railing: buildRailing,
  doorFrame: buildDoorFrame,
};

// --- Theme palettes --------------------------------------------------
// Per the Assets/levels1.png reference. Each theme defines the floor
// + wall + accent colours and a propWeights object the room-furnish
// pass uses to bias which props show up. Phase 2 wires
// `getLevelTheme(level.index)` to pick a theme per floor.
//
// `propWeights` is sparse — only entries present apply. A theme that
// omits e.g. `bed` simply won't spawn beds. Higher numbers = more
// frequent.
export const LEVEL_THEMES = {
  continental: {
    name: 'The Continental',
    floor: 0x4a3a28,
    wall: 0x6a5840,
    accent: 0xc9a464,
    ambientHex: 0xe8d8b0,
    propWeights: {
      table: 1.0, chair: 1.2, couch: 0.8, coffeeTable: 0.8,
      bed: 0.5, nightstand: 0.5, bookshelf: 0.7,
      lamp: 1.0, planter: 0.7, doorFrame: 0.3,
      rug: 0.6, vase: 0.5,
    },
  },
  nightclub: {
    name: 'Nightclub',
    floor: 0x180814,
    wall: 0x2a1422,
    accent: 0xd040a0,
    ambientHex: 0xb840d8,
    propWeights: {
      bench: 1.2, table: 0.4, chair: 0.6, couch: 0.7,
      neonStick: 1.4, lamp: 0.2,
      doorFrame: 0.4, locker: 0.4, barrel: 0.4,
    },
  },
  garage: {
    name: 'Parking Garage',
    floor: 0x2a2a2e,
    wall: 0x4a4a4e,
    accent: 0xc9a020,
    ambientHex: 0xa8a8a4,
    propWeights: {
      pillar: 1.6, locker: 0.9, crate: 0.8, barrel: 0.7,
      pallet: 0.6, lamp: 0.5, neonStick: 0.4, doorFrame: 0.2,
    },
  },
  penthouse: {
    name: 'Penthouse',
    floor: 0x3a2818,
    wall: 0xb8a874,
    accent: 0xc9a464,
    ambientHex: 0xeae0c0,
    propWeights: {
      couch: 1.0, table: 1.0, coffeeTable: 0.8, chair: 1.0,
      bed: 0.4, nightstand: 0.4, lamp: 1.0, tv: 0.5,
      planter: 0.8, rug: 0.6, window: 0.7, doorFrame: 0.3,
    },
  },
  rooftop: {
    name: 'Rooftop',
    floor: 0x1a1a20,
    wall: 0x2a2a30,
    accent: 0x4a8aff,
    ambientHex: 0x8090a8,
    propWeights: {
      railing: 1.5, crate: 0.8, barrel: 0.5, pallet: 0.5,
      neonStick: 0.6, pillar: 0.7, doorFrame: 0.3, lamp: 0.3,
    },
  },
};

// Pick a theme based on level index. 1-3 hotel, 4-6 nightclub, 7-9
// garage, 10-12 penthouse, 13+ rooftop. Wraps around so a 30-floor
// run keeps cycling through the five themes.
export function getLevelTheme(levelIndex) {
  const slots = ['continental', 'nightclub', 'garage', 'penthouse', 'rooftop'];
  const idx = Math.max(0, ((levelIndex - 1) | 0));
  const slot = slots[Math.floor(idx / 3) % slots.length];
  return LEVEL_THEMES[slot];
}

export function buildProp(kind, opts) {
  const f = PROP_BUILDERS[kind];
  if (!f) return null;
  const result = f(opts);
  if (!result) return null;
  // Upscale the whole prop uniformly and the collision footprint so
  // movement/raycast obstacles match what the player sees.
  result.group.scale.setScalar(PROP_SCALE);
  if (result.collision) {
    result.collision = {
      w: result.collision.w * PROP_SCALE,
      d: result.collision.d * PROP_SCALE,
    };
  }
  return result;
}
