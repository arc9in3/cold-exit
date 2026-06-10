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
import { sharedMaterial } from './material_pool.js';

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
  // Routed through the shared pool — every prop primitive of the same
  // colour now reuses one MeshToonMaterial instance instead of one
  // per-mesh. The toon gradient texture is itself a module-level
  // singleton (toonGradient), so the cache key reduces to the colour.
  return sharedMaterial({ type: 'toon', color, gradientMap: toonGradient() });
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
  // A 55cm free-standing floor vase reads as solid — it now blocks so the
  // player/AI can't walk through it (the walk-through-prop complaint). The
  // other collision:null props stay walkable on purpose: rugs are flat
  // floor decals, windows/sconces are wall-mounted above the floor, the
  // door frame wraps the doorway (blocking it would block the door), and
  // pallets/grates sit below step height by design.
  return { group, collision: { w: r * 2.4, d: r * 2.4 } };
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
  // Shade — emissive linen. Replaces the per-lamp PointLight that
  // used to live here. With ~3-6 lamps per level, a real PointLight
  // each meant the renderer paid the per-light shader cost on every
  // affected mesh; emissive material is free at the lighting stage
  // and bloom in postfx gives the warm halo back. Light reduction
  // policy: only the player flashlight, muzzle-flash pool, ceiling
  // lamp budget, and a small VFX pool may use real dynamic lights.
  const shadeMat = sharedMaterial({
    color: COL.linen,
    emissive: COL.lampGlow,
    emissiveIntensity: 1.4,
    roughness: 0.6,
  });
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.28, 12),
    shadeMat,
  );
  shade.position.y = h - 0.14;
  shade.castShadow = true;
  group.add(shade);
  // Floor lamp has a stem + base — the player shouldn't walk through
  // it. Footprint matches the visible base radius (~0.16m). Tagged as
  // low cover so AI fire skips it for cover-seek but movement is
  // blocked. Without this, lamps sit invisible to placement overlap
  // and other props stack on top of them.
  return { group, collision: { w: 0.32, d: 0.32 }, kind: 'lamp' };
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
  // Pallet is ~17cm tall — well below the player's step height.
  // collision: null lets the player + AI walk straight over it; the
  // separate `footprint` is used by placement-bounds + footprint-free
  // checks so we still avoid spawning the visible mesh past a wall or
  // overlapping another prop. Lootable continues to work because
  // _markPropLootable keys off prop position, not the collision proxy.
  return { group, collision: null, footprint: { w, d } };
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
  screen.material = sharedMaterial({ type: 'basic', color: 0x224466 });
  group.add(screen);
  return { group, collision: { w: standW, d: 0.3 } };
}

export function buildRug(opts = {}) {
  const w = opts.w ?? 2.2;
  const d = opts.d ?? 1.4;
  // Default tint shifted away from the old 0x6a2018 brick-red — that
  // hue read as a blood pool against the dark floors and made every
  // rug look like a kill scene. Deep navy-teal reads as a fancy
  // hotel-lobby rug instead.
  const color = opts.color ?? 0x243a4a;
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
    sharedMaterial({
      type: 'basic', color, transparent: true, opacity: 0.25, depthWrite: false,
    }),
  );
  halo.position.y = h / 2 + 0.05;
  group.add(halo);
  // Inner emissive core.
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    sharedMaterial({ type: 'basic', color }),
  );
  core.position.y = h / 2 + 0.05;
  group.add(core);
  // Tiny mount bracket at the bottom.
  const mount = box(w * 1.5, 0.04, d * 1.5, COL.metalDark);
  mount.position.y = 0.02;
  group.add(mount);
  // TV is a real piece of furniture — block movement. Footprint matches
  // the mount-bracket extent, slightly inset from the visible screen so
  // the cabinet feels passable around its edges.
  return { group, collision: { w: w * 1.2, d: d * 1.2 }, kind: 'tv' };
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
  // NOTE: this prop's window glass is decorative-only (it's a wall
  // ornament, not the breakable windows.js variant). No shatter path,
  // no mutation — safe to pool.
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.02),
    sharedMaterial({
      type: 'basic', color: glassColor, transparent: true, opacity: 0.35,
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

// --- Extraction props ------------------------------------------------
// Centerpieces for the post-boss extraction room (see
// src/extraction_room.js). Each one is the "way out" — a van you walk
// into, a helo on a pad, an elevator panel, a sewer grate, an LZ.
// Built from the same composition primitives as everything above so
// they read as one cohesive prop kit.

// Wall sconce — small wall-mounted lamp for library reading nooks +
// hotel hallways. Pure decoration; collision: null. Doesn't register a
// dynamic light by default — emissive material gives the lit feel
// without the per-frame fragment cost. Caller may opt-in via
// opts.withLight to attach a tiny PointLight (e.g. for the boss exit
// reveal).
export function buildWallSconce(opts = {}) {
  const color = opts.color ?? 0xffcf60;
  const group = new THREE.Group();
  // Backplate.
  const back = box(0.18, 0.32, 0.04, COL.metalDark);
  back.position.set(0, 1.6, 0);
  group.add(back);
  // Shade — small upward-flared cone.
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.10, 0.20, 12, 1, true),
    sharedMaterial({
      type: 'basic', color, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide,
    }),
  );
  shade.position.set(0, 1.78, 0.05);
  group.add(shade);
  // Tiny emissive bulb inside the shade.
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    sharedMaterial({ type: 'basic', color }),
  );
  bulb.position.set(0, 1.74, 0.06);
  group.add(bulb);
  return { group, collision: null };
}

// Crate row — three small crates lined up. Quick "supply staging" prop
// for the extraction room without needing 3 separate placements. Reads
// as a row, not a stack.
export function buildCrateRow(opts = {}) {
  const s = opts.s ?? 0.7;
  const group = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const body = box(s, s, s, COL.woodMid);
    body.position.set((i - 1) * (s + 0.05), s / 2, 0);
    group.add(body);
    // Slats.
    const band = box(s + 0.01, 0.05, s + 0.01, COL.woodDark);
    band.position.set((i - 1) * (s + 0.05), s * 0.55, 0);
    group.add(band);
  }
  const w = 3 * s + 2 * 0.05;
  return { group, collision: { w, d: s } };
}

// Evac van — a stylized van blocking ~60% of one wall, side door open.
// Player walks INTO the open side to extract. Built side-on (long axis
// along X), faces +Z by default; caller rotates to face the door wall.
export function buildEvacVan(opts = {}) {
  const w = opts.w ?? 4.4;
  const d = opts.d ?? 1.8;
  const h = opts.h ?? 2.0;
  const bodyColor = opts.color ?? 0x3a4a36;     // olive
  const group = new THREE.Group();
  // Main body.
  const body = roundedBox(w, h * 0.85, d, bodyColor, { radius: 0.10 });
  body.position.y = h * 0.45 + 0.25;
  group.add(body);
  // Cab roof — slight ridge.
  const cab = roundedBox(w * 0.35, 0.12, d, bodyColor, { radius: 0.05 });
  cab.position.set(-w * 0.30, h * 0.85 + 0.22, 0);
  group.add(cab);
  // Side door opening — a darker rectangular inset on +Z face. Reads
  // as "door slid open, walk in here."
  const opening = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.30, h * 0.55),
    sharedMaterial({ type: 'basic', color: 0x080808, side: THREE.DoubleSide }),
  );
  opening.position.set(w * 0.10, h * 0.45 + 0.05, d / 2 + 0.01);
  group.add(opening);
  // Wheels.
  const wheelR = 0.30;
  for (const sx of [-w * 0.32, w * 0.30]) {
    for (const sz of [-d / 2 - 0.04, d / 2 + 0.04]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(wheelR, wheelR, 0.18, 14),
        mat(0x151515),
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx, wheelR, sz);
      group.add(wheel);
    }
  }
  // Headlight panels.
  for (const sz of [-d * 0.32, d * 0.32]) {
    const hl = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.18, 0.20),
      sharedMaterial({ type: 'basic', color: 0xffe6a0 }),
    );
    hl.position.set(-w / 2 - 0.01, h * 0.45, sz);
    group.add(hl);
  }
  return { group, collision: { w, d } };
}

// Helo pad — circular landing zone with painted "H" + a low
// silhouetted helicopter shape on top. Player steps onto the pad to
// extract. Centerpiece for rooftop floors.
export function buildHeloPad(opts = {}) {
  const r = opts.r ?? 3.2;
  const group = new THREE.Group();
  // Pad disc.
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, 0.05, 28),
    mat(0x1f221c),
  );
  pad.position.y = 0.025;
  group.add(pad);
  // Painted ring.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r * 0.85, r * 0.95, 32),
    sharedMaterial({ type: 'basic', color: 0xfff2a0, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  group.add(ring);
  // Painted "H" — three boxes forming the letter.
  const hBar = box(r * 0.5, 0.02, 0.18, 0xfff2a0, false);
  hBar.position.set(0, 0.07, 0);
  group.add(hBar);
  for (const sx of [-r * 0.22, r * 0.22]) {
    const post = box(0.18, 0.02, r * 0.7, 0xfff2a0, false);
    post.position.set(sx, 0.07, 0);
    group.add(post);
  }
  // Helo silhouette — a dark fuselage bar suggesting "the chopper is
  // here." Shorter than a real helo so it doesn't block the camera.
  const fuselage = roundedBox(r * 1.2, 0.4, 0.5, 0x1a1d20, { radius: 0.12 });
  fuselage.position.set(0, 0.5, 0);
  group.add(fuselage);
  // Tail boom.
  const tail = box(r * 0.7, 0.12, 0.10, 0x1a1d20);
  tail.position.set(r * 0.7, 0.55, 0);
  group.add(tail);
  // Rotor — a thin disc cue.
  const rotor = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 1.0, r * 1.0, 0.03, 28),
    sharedMaterial({ type: 'basic', color: 0x2a2a30, transparent: true, opacity: 0.4 }),
  );
  rotor.position.set(0, 0.92, 0);
  group.add(rotor);
  return { group, collision: { w: r * 2, d: r * 2 } };
}

// Service elevator — recessed double-door + control panel. Player
// walks up to it to extract. Square footprint, narrow depth.
export function buildServiceElevator(opts = {}) {
  const w = opts.w ?? 2.4;
  const d = opts.d ?? 0.6;
  const h = opts.h ?? 2.6;
  const group = new THREE.Group();
  // Recessed back panel.
  const back = box(w, h, 0.08, COL.metalDark);
  back.position.set(0, h / 2, -d / 2 + 0.04);
  group.add(back);
  // Two doors that meet in the middle.
  for (const sx of [-w / 4, w / 4]) {
    const door = roundedBox(w / 2 - 0.04, h - 0.10, 0.08, COL.metal, { radius: 0.02 });
    door.position.set(sx, h / 2, -d / 2 + 0.12);
    group.add(door);
  }
  // Frame — thicker outline.
  const frameT = 0.10;
  const fTop = box(w + frameT, frameT, d, COL.metalDark);
  fTop.position.set(0, h + frameT / 2 - 0.05, 0);
  group.add(fTop);
  for (const sx of [-w / 2 - frameT / 2, w / 2 + frameT / 2]) {
    const fSide = box(frameT, h, d, COL.metalDark);
    fSide.position.set(sx, h / 2, 0);
    group.add(fSide);
  }
  // Control panel beside the door (right side).
  const panel = box(0.18, 0.30, 0.06, COL.metalDark);
  panel.position.set(w / 2 + 0.20, 1.30, d / 2 - 0.04);
  group.add(panel);
  // Tiny call button — emissive green.
  const btn = new THREE.Mesh(
    new THREE.CircleGeometry(0.04, 12),
    sharedMaterial({ type: 'basic', color: 0x80ff80 }),
  );
  btn.position.set(w / 2 + 0.20, 1.30, d / 2 + 0.001);
  group.add(btn);
  return { group, collision: { w, d } };
}

// Sewer grate — floor-set metal grate. Player walks onto it to drop
// through (the falling itself is handled by gameplay code, not here;
// the grate's job is to read as "this is the way down").
export function buildSewerGrate(opts = {}) {
  const w = opts.w ?? 1.8;
  const d = opts.d ?? 1.8;
  const group = new THREE.Group();
  // Frame.
  const frame = box(w + 0.10, 0.06, d + 0.10, COL.metalDark);
  frame.position.y = 0.03;
  group.add(frame);
  // Grate bars — 5 horizontal rods.
  for (let i = 0; i < 5; i++) {
    const t = (i / 4 - 0.5);
    const bar = box(w, 0.04, 0.08, COL.metal);
    bar.position.set(0, 0.06, t * d * 0.85);
    group.add(bar);
  }
  // Light beam from below — a faint emissive disc under the grate
  // gives the "something glowing in the sewer" cue.
  const beam = new THREE.Mesh(
    new THREE.CircleGeometry(Math.min(w, d) * 0.4, 16),
    sharedMaterial({ type: 'basic', color: 0x80c0ff, transparent: true, opacity: 0.4 }),
  );
  beam.rotation.x = -Math.PI / 2;
  beam.position.y = 0.005;
  group.add(beam);
  // Footprint blocks AI but is low cover (player can step over).
  return { group, collision: null, footprint: { w, d } };
}

// Chopper LZ — variant of helo-pad with railings on three sides + a
// painted hazard chevron strip on the fourth (the open approach).
// Faster pickup vibe than the calm helo-pad.
export function buildChopperLz(opts = {}) {
  const r = opts.r ?? 3.0;
  const group = new THREE.Group();
  // Pad — slightly raised so the railings have something to mount to.
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, 0.10, 28),
    mat(0x202020),
  );
  pad.position.y = 0.05;
  group.add(pad);
  // Hazard stripe on +Z side (the open approach).
  const stripeCount = 6;
  for (let i = 0; i < stripeCount; i++) {
    const t = (i / (stripeCount - 1) - 0.5) * (r * 1.6);
    const color = (i % 2) ? 0xffd040 : 0x202020;
    const stripe = box(r * 1.6 / stripeCount, 0.02, 0.4, color, false);
    stripe.position.set(t, 0.11, r - 0.3);
    group.add(stripe);
  }
  // Three short railings on the other three sides.
  for (const ang of [Math.PI, -Math.PI / 2, Math.PI / 2]) {
    for (let post = 0; post < 3; post++) {
      const t = (post - 1) * 0.8;
      const px = Math.cos(ang) * r + Math.sin(ang) * t;
      const pz = Math.sin(ang) * r - Math.cos(ang) * t;
      const p = box(0.06, 1.0, 0.06, COL.metal);
      p.position.set(px, 0.55, pz);
      group.add(p);
    }
    // Top rail bar (axis-aligned per side).
    const ax = Math.cos(ang) * r;
    const az = Math.sin(ang) * r;
    const bar = box(Math.abs(Math.sin(ang)) > 0.5 ? 1.6 : 0.06, 0.06,
      Math.abs(Math.sin(ang)) > 0.5 ? 0.06 : 1.6, COL.metal);
    bar.position.set(ax, 1.05, az);
    group.add(bar);
  }
  // Helo silhouette like buildHeloPad (lighter version).
  const fuselage = roundedBox(r * 1.0, 0.3, 0.4, 0x1a1d20, { radius: 0.10 });
  fuselage.position.set(0, 0.45, 0);
  group.add(fuselage);
  return { group, collision: { w: r * 2, d: r * 2 } };
}

// =====================================================================
// Theme-specialised props — added to support the lab / server / factory
// / infirmary / lobby / shop themes with silhouettes that read as the
// thing instead of repurposing pillars or nightstands.
// =====================================================================

// Server rack — tall thin cabinet with LED dots. Reads as IT gear at
// iso distance because of the row of bright pinpoints on the front.
export function buildServerRack(opts = {}) {
  const w = opts.w ?? 0.7;
  const d = opts.d ?? 0.85;
  const h = opts.h ?? 1.95;
  const group = new THREE.Group();
  // Body — matte black with a thin metal frame.
  const body = roundedBox(w, h, d, 0x16181c, { radius: 0.04 });
  body.position.y = h / 2;
  group.add(body);
  // Vertical seam down the front.
  const seam = box(0.02, h - 0.18, 0.02, 0x2a2f36);
  seam.position.set(0, h / 2, d / 2 + 0.005);
  group.add(seam);
  // Three rows of LED panels — emissive so they pop in the iso view.
  const ledColors = [0x4ad6ff, 0x70ff9a, 0xffa040];
  for (let row = 0; row < 5; row++) {
    const cy = 0.32 + row * 0.32;
    for (let col = 0; col < 4; col++) {
      const led = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 0.02),
        sharedMaterial({ type: 'basic', color: ledColors[(row + col) % 3] }),
      );
      led.position.set(-w * 0.32 + col * 0.18, cy, d / 2 + 0.012);
      group.add(led);
    }
  }
  // Cooling vent slats at the top.
  for (let i = 0; i < 3; i++) {
    const vent = box(w * 0.65, 0.025, 0.02, 0x2a2f36);
    vent.position.set(0, h - 0.10 - i * 0.05, d / 2 + 0.012);
    group.add(vent);
  }
  return { group, collision: { w, d }, kind: 'serverRack' };
}

// Med cart — small rolling cart with a tray, drawer, and red cross
// accent. Distinct from the nightstand silhouette because of the
// taller wheeled-cabinet shape + accent cross.
export function buildMedCart(opts = {}) {
  const w = opts.w ?? 0.6;
  const d = opts.d ?? 0.45;
  const h = opts.h ?? 0.95;
  const group = new THREE.Group();
  // Body — clinical white.
  const body = roundedBox(w, h * 0.85, d, 0xe6ece8, { radius: 0.045 });
  body.position.y = h * 0.50;
  group.add(body);
  // Drawer line.
  const drawer = box(w * 0.85, 0.02, 0.02, 0x9aa3a6);
  drawer.position.set(0, h * 0.55, d / 2 + 0.005);
  group.add(drawer);
  // Tray on top — slightly recessed lip.
  const tray = roundedBox(w + 0.04, 0.04, d + 0.04, 0xc8d6cf, { radius: 0.02 });
  tray.position.y = h * 0.92;
  group.add(tray);
  // Red cross — emissive so it reads at distance.
  const crossH = box(0.18, 0.04, 0.02,  0xc02828);
  crossH.position.set(0, h * 0.50, d / 2 + 0.012);
  group.add(crossH);
  const crossV = box(0.04, 0.18, 0.02, 0xc02828);
  crossV.position.set(0, h * 0.50, d / 2 + 0.012);
  group.add(crossV);
  // Four little wheels.
  const wheelColor = 0x1a1d22;
  const wOff = 0.02;
  const wheels = [
    [w / 2 - 0.06,  d / 2 - 0.06],
    [-(w / 2 - 0.06),  d / 2 - 0.06],
    [w / 2 - 0.06, -(d / 2 - 0.06)],
    [-(w / 2 - 0.06), -(d / 2 - 0.06)],
  ];
  for (const [wx, wz] of wheels) {
    const wheel = cyl(0.04, 0.04, wheelColor, 8);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.04 + wOff, wz);
    group.add(wheel);
  }
  return { group, collision: { w, d }, kind: 'medCart' };
}

// Vending machine — tall colored cabinet with a black glass front
// showing rows of items. Lobby / break-room ambience.
export function buildVendingMachine(opts = {}) {
  const w = opts.w ?? 0.95;
  const d = opts.d ?? 0.7;
  const h = opts.h ?? 1.95;
  const accent = opts.accent ?? 0xc92840;       // candy-machine red
  const group = new THREE.Group();
  // Body.
  const body = roundedBox(w, h, d, accent, { radius: 0.05 });
  body.position.y = h / 2;
  group.add(body);
  // Glass front — dark, slight emissive sheen to read as illuminated.
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.78, h * 0.62, 0.02),
    sharedMaterial({ type: 'basic', color: 0x14181c }),
  );
  glass.position.set(0, h * 0.62, d / 2 + 0.012);
  group.add(glass);
  // Four product slots — small bright squares on the glass.
  const productColors = [0xff8030, 0x40c060, 0x4080ff, 0xffc040, 0xffffff, 0xff4090];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      const item = new THREE.Mesh(
        new THREE.BoxGeometry(0.10, 0.14, 0.01),
        sharedMaterial({ type: 'basic',
          color: productColors[(r * 2 + c) % productColors.length] }),
      );
      item.position.set(-w * 0.18 + c * w * 0.36, h * 0.42 + r * 0.20, d / 2 + 0.022);
      group.add(item);
    }
  }
  // Dispense slot at bottom + brand stripe at top.
  const slot = box(w * 0.4, 0.05, 0.02, 0x1a1d22);
  slot.position.set(0, h * 0.20, d / 2 + 0.012);
  group.add(slot);
  const brand = box(w * 0.86, 0.10, 0.01, 0xffffff);
  brand.position.set(0, h * 0.94, d / 2 + 0.012);
  group.add(brand);
  return { group, collision: { w, d }, kind: 'vendingMachine' };
}

// Display case — glass cabinet with three pedestal items inside.
// Reads as a vendor showcase — distinct from a filing cabinet.
export function buildDisplayCase(opts = {}) {
  const w = opts.w ?? 1.3;
  const d = opts.d ?? 0.6;
  const h = opts.h ?? 1.35;
  const accent = opts.accent ?? 0xc9a464;       // brass
  const group = new THREE.Group();
  // Base — solid wood / metal pedestal.
  const base = roundedBox(w, h * 0.30, d, COL.woodDark, { radius: 0.04 });
  base.position.y = h * 0.15;
  group.add(base);
  // Brass band along the base top.
  const band = box(w + 0.02, 0.04, d + 0.02, accent);
  band.position.y = h * 0.30;
  group.add(band);
  // Glass case — translucent.
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.95, h * 0.65, d * 0.92),
    sharedMaterial({
      type: 'basic', color: 0xa0c8d8,
      transparent: true, opacity: 0.18, depthWrite: false,
    }),
  );
  glass.position.y = h * 0.30 + h * 0.65 / 2;
  group.add(glass);
  // Frame edges — thin brass strips on each vertical edge.
  const frameH = h * 0.65;
  const corners = [[w * 0.475, d * 0.46], [-w * 0.475, d * 0.46],
                   [w * 0.475, -d * 0.46], [-w * 0.475, -d * 0.46]];
  for (const [cx, cz] of corners) {
    const post = box(0.025, frameH, 0.025, accent);
    post.position.set(cx, h * 0.30 + frameH / 2, cz);
    group.add(post);
  }
  // Three displayed items on a low shelf inside.
  const displayColors = opts.displayColors ?? [0x6aaedc, 0xffd27a, 0x70d0a0];
  const shelfY = h * 0.30 + 0.04;
  for (let i = 0; i < 3; i++) {
    const item = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.16),
      sharedMaterial({ type: 'basic', color: displayColors[i % 3] }),
    );
    item.position.set(-w * 0.30 + i * w * 0.30, shelfY + 0.10, 0);
    group.add(item);
  }
  return { group, collision: { w, d }, kind: 'displayCase' };
}

// Conveyor belt — long flat unit with rollers + side rails. Reads as
// a factory line; non-walkable since it's chest-height with drives.
export function buildConveyorBelt(opts = {}) {
  const w = opts.w ?? 3.2;        // long axis
  const d = opts.d ?? 0.85;       // belt width
  const h = opts.h ?? 0.65;       // top of belt
  const group = new THREE.Group();
  // Belt deck — dark grey rubber.
  const deck = box(w, 0.06, d, 0x202428);
  deck.position.y = h;
  group.add(deck);
  // Side rails — orange safety strip.
  const railColor = 0xc06028;
  const railL = box(w + 0.05, 0.05, 0.06, railColor);
  railL.position.set(0, h + 0.04, d / 2 + 0.04);
  group.add(railL);
  const railR = box(w + 0.05, 0.05, 0.06, railColor);
  railR.position.set(0, h + 0.04, -(d / 2 + 0.04));
  group.add(railR);
  // Frame — boxy underside.
  const frame = roundedBox(w, h - 0.1, d * 0.85, 0x4a4a4e, { radius: 0.04 });
  frame.position.y = (h - 0.1) / 2;
  group.add(frame);
  // Rollers — visible cylinders peeking out the ends.
  for (const xSign of [-1, 1]) {
    const roller = cyl(0.10, d * 0.92, 0xa0a0a4, 10);
    roller.rotation.x = Math.PI / 2;
    roller.position.set(xSign * (w / 2 - 0.04), h - 0.08, 0);
    group.add(roller);
  }
  // A couple of crates riding the belt for ambience.
  for (const xSign of [-1, 1]) {
    const crate = roundedBox(0.45, 0.40, 0.45, COL.woodMid, { radius: 0.03 });
    crate.position.set(xSign * w * 0.22, h + 0.20, 0);
    group.add(crate);
  }
  return { group, collision: { w, d }, kind: 'conveyorBelt' };
}

// =====================================================================
// Cosmetic clutter + dressing pass — variety props that READ as
// lived-in detail without affecting movement. EVERY builder here
// returns `collision: null` on purpose: they're either floor decals
// (a hair above the ground), wall-hugging fixtures (mounted above
// foot height), or ground litter below the player's step height. They
// follow the same decoration contract as buildRug / buildWindow /
// buildWallSconce / buildPallet — the placement path adds them via
// the scene + decorations list and never registers a collision proxy.
//
// IMPORTANT: do NOT add any of these to DESTRUCTIBLE_HP and do NOT
// give them a footprint — they should be fully walkable so the
// ambient sprinkle can drop them anywhere (including near doorways)
// without ever pinching the nav space.
// =====================================================================

// Floor hazard-stripe decal — a flat painted band (alternating accent
// + dark chevron-ish slabs). Sits 1.5cm above the floor to avoid
// z-fighting. Pure decal; collision: null. Color driven by caller
// (theme.accent) so each biome gets its own stripe hue.
export function buildFloorStripe(opts = {}) {
  const w = opts.w ?? 2.6;
  const d = opts.d ?? 0.7;
  const color = opts.color ?? 0xffd040;
  const dark = opts.darkColor ?? 0x1b1b1b;
  const group = new THREE.Group();
  // Dark backing slab so the stripe reads even on a light floor.
  const back = box(w + 0.06, 0.012, d + 0.06, dark, false);
  back.position.y = 0.012;
  group.add(back);
  // Alternating diagonal-ish bars across the long axis.
  const bars = Math.max(4, Math.round(w / 0.42));
  const barW = w / bars;
  for (let i = 0; i < bars; i++) {
    if (i % 2) continue;
    const bar = box(barW * 0.92, 0.016, d, color, false);
    bar.position.set(-w / 2 + (i + 0.5) * barW, 0.016, 0);
    group.add(bar);
  }
  return { group, collision: null };
}

// Floor markings — a thin painted rectangle outline (think parking
// bay / clean-room zone marker / equipment footprint). Just four
// flat border strips so the center stays empty and readable. Decal.
export function buildFloorMarking(opts = {}) {
  const w = opts.w ?? 2.4;
  const d = opts.d ?? 2.0;
  const color = opts.color ?? 0xc9a020;
  const t = opts.t ?? 0.1;
  const group = new THREE.Group();
  // Two strips along X, two along Z, forming an open rectangle.
  for (const sz of [-d / 2 + t / 2, d / 2 - t / 2]) {
    const s = box(w, 0.014, t, color, false);
    s.position.set(0, 0.014, sz);
    group.add(s);
  }
  for (const sx of [-w / 2 + t / 2, w / 2 - t / 2]) {
    const s = box(t, 0.014, d - t * 2, color, false);
    s.position.set(sx, 0.014, 0);
    group.add(s);
  }
  return { group, collision: null };
}

// Wall vent — a flat louvred grille that hugs a wall (mounted ~1.4m
// up). Caller positions/rotates it against a wall face. Decoration
// only; collision: null because it's flush to the wall above the
// floor and never intrudes on the walk space.
export function buildWallVent(opts = {}) {
  const w = opts.w ?? 0.8;
  const h = opts.h ?? 0.55;
  const frameColor = opts.frameColor ?? COL.metalDark;
  const slatColor = opts.slatColor ?? COL.metal;
  const group = new THREE.Group();
  const mountY = opts.mountY ?? 1.4;
  // Recessed frame plate.
  const frame = box(w, h, 0.04, frameColor);
  frame.position.set(0, mountY, 0);
  group.add(frame);
  // Horizontal louvre slats.
  const slats = Math.max(3, Math.round(h / 0.1));
  for (let i = 0; i < slats; i++) {
    const t = (i / (slats - 1) - 0.5) * (h - 0.1);
    const slat = box(w - 0.08, 0.04, 0.03, slatColor);
    slat.position.set(0, mountY + t, 0.025);
    group.add(slat);
  }
  return { group, collision: null };
}

// Wall sign / signage panel — a flat backplate with a bright emissive
// face (arrow / placard). Wall-hugging, mounted high. Decoration only.
// Emissive face uses MeshBasicMaterial (no real light — light-budget
// policy). Color driven by caller so a nightclub gets magenta signage
// and a factory gets amber safety placards.
export function buildWallSign(opts = {}) {
  const w = opts.w ?? 0.9;
  const h = opts.h ?? 0.45;
  const color = opts.color ?? 0x4ad6ff;
  const group = new THREE.Group();
  const mountY = opts.mountY ?? 2.0;
  // Dark backplate / housing.
  const back = box(w + 0.08, h + 0.08, 0.06, COL.metalDark);
  back.position.set(0, mountY, 0);
  group.add(back);
  // Emissive face.
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.02),
    sharedMaterial({ type: 'basic', color }),
  );
  face.position.set(0, mountY, 0.04);
  group.add(face);
  // A darker inset bar across the face to suggest text / an icon.
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.6, h * 0.22, 0.01),
    sharedMaterial({ type: 'basic', color: 0x101216 }),
  );
  bar.position.set(0, mountY, 0.055);
  group.add(bar);
  return { group, collision: null };
}

// Cable spool — a loose coil of cabling on the floor. Low (under step
// height), so collision: null keeps it walkable like a pallet. Reads
// as industrial clutter for garage / factory / rooftop / server.
export function buildCableSpool(opts = {}) {
  const r = opts.r ?? 0.45;
  const color = opts.color ?? COL.metalDark;
  const group = new THREE.Group();
  // Flat reel laid on its side.
  const reel = cyl(r, 0.1, COL.woodDark, 14);
  reel.position.y = 0.05;
  group.add(reel);
  // Coiled cable as two flattened torus-ish rings.
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r * (0.7 - i * 0.18), 0.05, 6, 16),
      mat(color),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.12 + i * 0.06;
    ring.castShadow = true;
    group.add(ring);
  }
  return { group, collision: null };
}

// Debris pile — a small scatter of low rubble chunks. Below step
// height, walkable (collision: null). Adds a "weathered / abandoned"
// read to industrial + rooftop biomes without blocking nav.
export function buildDebris(opts = {}) {
  const color = opts.color ?? COL.concrete;
  const group = new THREE.Group();
  const chunks = opts.chunks ?? 5;
  for (let i = 0; i < chunks; i++) {
    const s = 0.12 + Math.random() * 0.18;
    const chunk = box(s, s * (0.5 + Math.random() * 0.4), s, color);
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.random() * 0.45;
    chunk.position.set(Math.cos(ang) * rad, s * 0.3, Math.sin(ang) * rad);
    chunk.rotation.y = Math.random() * Math.PI;
    group.add(chunk);
  }
  return { group, collision: null };
}

// Floor pad / accent rug variant tuned for clinical + lobby use — a
// thin tinted mat with a contrasting border. Distinct from buildRug
// (which is a single navy slab) by the inset border. Flat decal,
// collision: null. Used as a deliberate "zone" pad under furnishing.
export function buildFloorPad(opts = {}) {
  const w = opts.w ?? 2.0;
  const d = opts.d ?? 1.4;
  const color = opts.color ?? 0x243a4a;
  const borderColor = opts.borderColor ?? 0xc9a464;
  const group = new THREE.Group();
  // Border (slightly larger, sits lower).
  const border = box(w, 0.014, d, borderColor, false);
  border.position.y = 0.012;
  group.add(border);
  // Inner field.
  const field = box(w - 0.18, 0.016, d - 0.18, color, false);
  field.position.y = 0.016;
  group.add(field);
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
  // Level-gen overhaul additions — extraction-room set + ambient
  // wall fixtures + grouped-prop helpers.
  evacVan: buildEvacVan,
  heloPad: buildHeloPad,
  serviceElevator: buildServiceElevator,
  sewerGrate: buildSewerGrate,
  chopperLz: buildChopperLz,
  wallSconce: buildWallSconce,
  crateRow: buildCrateRow,
  // Theme-specialised props (lab / server / factory / infirmary /
  // lobby / shop). Wired into ROOM_TEMPLATES per theme, not into the
  // ambient sprinkle (their silhouettes are distinctive enough that
  // scattering them randomly across rooms would feel arbitrary).
  serverRack: buildServerRack,
  medCart: buildMedCart,
  vendingMachine: buildVendingMachine,
  displayCase: buildDisplayCase,
  conveyorBelt: buildConveyorBelt,
  // Cosmetic clutter + dressing (all collision: null — see the
  // "Cosmetic clutter" block above). Safe for the ambient sprinkle:
  // floor decals, wall-hugging fixtures, and below-step-height litter
  // that never pinch the nav space.
  floorStripe: buildFloorStripe,
  floorMarking: buildFloorMarking,
  wallVent: buildWallVent,
  wallSign: buildWallSign,
  cableSpool: buildCableSpool,
  debris: buildDebris,
  floorPad: buildFloorPad,
};

// --- Theme palettes --------------------------------------------------
// Per the Assets/levels1.png reference. Each theme defines the floor
// + wall + accent colours and a propWeights object the room-furnish
// pass uses to bias which props show up. Phase 2 wires
// `getLevelTheme(level.index)` to pick a theme per floor.
//
// `propWeights` is the LEVEL-WIDE ambience sprinkle. STRICT POLICY:
// only architectural / ambience kinds belong here — pillars, planters,
// neonSticks, vases, rugs, doorFrames, railings, windows, locker /
// crate / barrel / pallet. NEVER include furniture (bed, couch,
// bookshelf, desk, table, chair, tv, nightstand, cabinet, coffeeTable)
// in this list. Furniture is locked to the per-room theme pass
// (_themeRoom in level.js) so a "bedroom" room is the ONLY place a
// bed can spawn — putting `bed: 0.5` here scattered beds into
// hallways and combat rooms across the entire level. Same for
// couches and bookshelves.
//
// Higher weight = more frequent in the sprinkle.
// `roomThemePool` is the biome's bias for per-room themes. _themeRoom
// in level.js prefers this pool over its size-based default when set,
// so a 'factory' level rolls garage / warehouse / server rooms across
// the whole floor instead of bedroom / library / lobby. Weights are
// relative — higher = more frequent. Themes named here MUST also be
// named in ROOM_TEMPLATES; unknown themes silently fall through to
// the rect / fallback prop scatter.
export const LEVEL_THEMES = {
  continental: {
    name: 'The Continental',
    floor: 0x4a3a28,
    wall: 0x6a5840,
    accent: 0xc9a464,
    ambientHex: 0xe8d8b0,
    propWeights: {
      // Hotel / classical lobby ambience. No `lamp` (symmetric pass),
      // no `vase` (read as bottles on floor), no `rug` (random rugs
      // looked silly — only deliberate placement now).
      pillar: 0.6, planter: 1.0, doorFrame: 0.4,
      // Cosmetic dressing — brass-toned floor pads + tasteful wall
      // signage read as a refined hotel without industrial clutter.
      floorPad: 0.5, wallSign: 0.3,
    },
    // A hotel — bedrooms, lobbies, lounges, the occasional library or
    // back-of-house security desk.
    roomThemePool: {
      bedroom: 1.5, lobby: 1.5, livingRoom: 1.2, library: 0.9,
      office: 0.6, kitchen: 0.5, security: 0.4, infirmary: 0.3,
    },
  },
  nightclub: {
    name: 'Nightclub',
    floor: 0x180814,
    wall: 0x2a1422,
    accent: 0xd040a0,
    ambientHex: 0xb840d8,
    propWeights: {
      neonStick: 1.4, locker: 0.5, barrel: 0.5,
      doorFrame: 0.4, planter: 0.3,
      // Cosmetic dressing — glowing wall signage + a few cable spools
      // (back-of-house clutter) for the club's neon-noir vibe.
      wallSign: 0.8, cableSpool: 0.4,
    },
    // Nightclub — public lobby + back-of-house mailroom (manager's
    // office) + security + the occasional storage warehouse / kitchen.
    roomThemePool: {
      lobby: 1.6, livingRoom: 1.0, security: 0.9, warehouse: 0.8,
      kitchen: 0.6, office: 0.4, mailroom: 0.3,
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
      pallet: 0.6, neonStick: 0.4, doorFrame: 0.2,
      // Cosmetic dressing — painted parking bays / hazard stripes +
      // floor markings + cable spools + the odd debris pile sell the
      // working-garage read.
      floorStripe: 0.9, floorMarking: 0.8, cableSpool: 0.6,
      wallVent: 0.5, debris: 0.4,
    },
    // Industrial parking — heavy on garage / warehouse / mailroom
    // with a security booth + a server room for the building.
    roomThemePool: {
      garage: 1.8, warehouse: 1.4, mailroom: 0.9, security: 0.8,
      server: 0.6, office: 0.5,
    },
  },
  penthouse: {
    name: 'Penthouse',
    floor: 0x3a2818,
    wall: 0xb8a874,
    accent: 0xc9a464,
    ambientHex: 0xeae0c0,
    propWeights: {
      // Refined skyrise — planters + windows. No random couches /
      // vases / lamps / rugs.
      planter: 1.2, window: 0.8, doorFrame: 0.4, pillar: 0.3,
      // Cosmetic dressing — tasteful accent floor pads only; no
      // industrial clutter in a luxury skyrise.
      floorPad: 0.6,
    },
    // Top-floor luxury residence + executive offices + library.
    roomThemePool: {
      livingRoom: 1.5, bedroom: 1.2, library: 1.2, lobby: 0.9,
      office: 0.7, kitchen: 0.5,
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
      neonStick: 0.6, pillar: 0.7, doorFrame: 0.3,
      // Cosmetic dressing — helipad-style hazard stripes + service
      // clutter (cable spools, debris, vents) for a rooftop service
      // zone.
      floorStripe: 0.8, cableSpool: 0.5, wallVent: 0.5, debris: 0.4,
    },
    // Rooftop service zone — utility / storage / surveillance.
    roomThemePool: {
      warehouse: 1.4, server: 1.0, security: 0.9, garage: 0.7,
      mailroom: 0.5, office: 0.4,
    },
  },
  factory: {
    name: 'Factory',
    floor: 0x2a2820,
    wall: 0x4a4438,
    accent: 0xd07a30,
    ambientHex: 0xc8b890,
    propWeights: {
      // Heavy industrial dressing — pallets / barrels / crates /
      // pillars (load-bearing columns). NeonStick reads as floor-
      // strip safety lighting on a factory line.
      pillar: 1.4, pallet: 1.2, crate: 1.0, barrel: 0.9,
      locker: 0.6, neonStick: 0.7, railing: 0.5, doorFrame: 0.2,
      // Cosmetic dressing — heavy floor markings / hazard stripes +
      // cable runs + vents + debris sell the working factory floor.
      floorStripe: 1.0, floorMarking: 0.9, cableSpool: 0.7,
      wallVent: 0.6, wallSign: 0.5, debris: 0.5,
    },
    roomThemePool: {
      garage: 1.8, warehouse: 1.8, server: 0.8, security: 0.7,
      mailroom: 0.6, office: 0.5,
    },
  },
  lab: {
    name: 'Research Lab',
    floor: 0xc4cad0,
    wall: 0x9aa3ad,
    accent: 0x4ac8d0,
    ambientHex: 0xe8f0f4,
    propWeights: {
      // Clinical clean — neonStick (overhead strip), lockers (med
      // cabinets), pillars (clean-room columns). Low pallet/barrel
      // because heavy industrial doesn't fit lab aesthetic.
      neonStick: 1.4, locker: 1.0, pillar: 0.8, doorFrame: 0.5,
      planter: 0.3, crate: 0.4, barrel: 0.3,
      // Cosmetic dressing — clean-room zone floor markings + tidy
      // wall vents + clinical floor pads + the occasional cyan
      // wayfinding sign. No debris (a lab stays spotless).
      floorMarking: 0.9, wallVent: 0.6, floorPad: 0.5, wallSign: 0.4,
    },
    roomThemePool: {
      lab: 2.0, infirmary: 1.5, server: 1.0, archive: 0.9,
      security: 0.6, office: 0.5, mailroom: 0.3,
    },
  },
};

// Pick a theme based on level index. 7 biomes cycle every 3 levels;
// players see all of them in a 21-floor run.
export function getLevelTheme(levelIndex) {
  const slots = ['continental', 'nightclub', 'garage', 'penthouse',
    'rooftop', 'factory', 'lab'];
  const idx = Math.max(0, ((levelIndex - 1) | 0));
  const slot = slots[Math.floor(idx / 3) % slots.length];
  return LEVEL_THEMES[slot];
}

// Props whose local +Z axis is the "front" the player should be
// looking at (chair seat front, couch cushions, desk drawer face, TV
// screen, bed pillow side). Used by placeInterior in level.js to
// orient them toward the room centre instead of leaving them with a
// random yaw that often left the chair facing a wall.
export const INWARD_FACING_KINDS = new Set([
  'chair', 'couch', 'bed', 'desk', 'tv', 'nightstand', 'cabinet',
  'bookshelf', 'locker',
  // Theme-specialised props with a clear front face.
  'serverRack', 'medCart', 'vendingMachine', 'displayCase',
]);

// Destructible-prop HP table (Phase J). Kinds in this table take
// bullet damage like enemies do — once their hp drains they hide,
// drop their collision, and spill any unsearched loot as a single
// ground pile. Kinds NOT in the table (desk, cabinet, bookshelf,
// couch, bed, pillar, nightstand, locker, wallSconce, planter,
// extraction-* props, window — has its own break system, shape
// primitives like railing/ramp/platform) are immune to bullet
// damage on purpose: they read as heavy / structural / story-set
// pieces that shouldn't pop on a stray round.
//
// Numbers are tuned to feel snappy with starter weapons:
//   bottle / vase   — single rifle shot
//   lamp / tv       — short burst
//   pallet / chair  — sustained burst
//   crate / barrel  — small magazine dump
//   coffeeTable     — heavier; wood slab takes a beat
//
// Frozen so a typo (mutating instead of reading) crashes loud.
export const DESTRUCTIBLE_HP = Object.freeze({
  crate:       30,
  barrel:      40,
  vase:         8,
  bottle:       4,
  lamp:        12,
  tv:          18,
  coffeeTable: 35,
  chair:       25,
  pallet:      20,
});

export function buildProp(kind, opts) {
  const f = PROP_BUILDERS[kind];
  if (!f) return null;
  const result = f(opts);
  if (!result) return null;
  // Tag the kind so placement helpers can introspect (inward-facing
  // bias, per-kind footprint padding, etc.) without re-checking every
  // builder against a pile of `instanceof`-style branches.
  result.kind = kind;
  // Upscale the whole prop uniformly and the collision footprint so
  // movement/raycast obstacles match what the player sees.
  result.group.scale.setScalar(PROP_SCALE);
  if (result.collision) {
    result.collision = {
      w: result.collision.w * PROP_SCALE,
      d: result.collision.d * PROP_SCALE,
    };
  }
  if (result.footprint) {
    result.footprint = {
      w: result.footprint.w * PROP_SCALE,
      d: result.footprint.d * PROP_SCALE,
    };
  }
  return result;
}
