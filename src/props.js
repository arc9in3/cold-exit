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
  // Top slab.
  const top = box(w, 0.08, d, wood);
  top.position.y = h - 0.04;
  group.add(top);
  // Four legs near the corners.
  const legW = 0.08;
  const legH = h - 0.08;
  const legY = legH / 2;
  const dx = (w - legW) * 0.46;
  const dz = (d - legW) * 0.46;
  for (const sx of [-dx, dx]) {
    for (const sz of [-dz, dz]) {
      const leg = box(legW, legH, legW, COL.woodDark);
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
  // Seat.
  const seat = box(w, 0.06, d, wood);
  seat.position.y = seatH - 0.03;
  group.add(seat);
  // Back rest — vertical slab behind the seat.
  const back = box(w * 0.9, backH, 0.05, wood);
  back.position.set(0, seatH + backH / 2, -d / 2 + 0.025);
  group.add(back);
  // Four legs.
  const legW = 0.05;
  const legH = seatH - 0.06;
  const legY = legH / 2;
  const dx = (w - legW) * 0.46;
  const dz = (d - legW) * 0.46;
  for (const sx of [-dx, dx]) {
    for (const sz of [-dz, dz]) {
      const leg = box(legW, legH, legW, COL.woodDark);
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
  // Frame.
  const frame = box(w, frameH, d, wood);
  frame.position.y = frameH / 2;
  group.add(frame);
  // Mattress.
  const matH = 0.18;
  const mat_ = box(w - 0.06, matH, d - 0.06, COL.linen);
  mat_.position.y = frameH + matH / 2;
  group.add(mat_);
  // Pillow at head of bed.
  const pillow = box(w * 0.5, 0.1, 0.3, COL.paper);
  pillow.position.set(0, frameH + matH + 0.06, -d / 2 + 0.22);
  group.add(pillow);
  // Headboard.
  const head = box(w + 0.06, 0.5, 0.08, wood);
  head.position.set(0, frameH + 0.25, -d / 2 + 0.04);
  group.add(head);
  return { group, collision: { w, d } };
}

export function buildCouch(opts = {}) {
  const w = opts.w ?? 1.9;
  const d = opts.d ?? 0.85;
  const fabric = opts.color ?? COL.fabric;
  const group = new THREE.Group();
  // Base.
  const baseH = 0.38;
  const base = box(w, baseH, d, fabric);
  base.position.y = baseH / 2;
  group.add(base);
  // Back.
  const backH = 0.55;
  const back = box(w, backH, 0.22, fabric);
  back.position.set(0, baseH + backH / 2, -d / 2 + 0.11);
  group.add(back);
  // Arms (left + right).
  for (const sx of [-w / 2 + 0.12, w / 2 - 0.12]) {
    const arm = box(0.22, backH, d, fabric);
    arm.position.set(sx, baseH + backH / 2, 0);
    group.add(arm);
  }
  // Seat cushions (stylized, two pads).
  const cushionGap = 0.02;
  for (const sx of [-w / 4, w / 4]) {
    const cush = box(w / 2 - 0.2, 0.14, d - 0.3, COL.linen);
    cush.position.set(sx, baseH + 0.07, 0.05);
    group.add(cush);
  }
  void cushionGap;
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
  const body = box(w, h, d, wood);
  body.position.y = h / 2;
  group.add(body);
  // Drawer face.
  const face = box(w - 0.06, 0.2, 0.02, COL.woodLight);
  face.position.set(0, h * 0.7, d / 2 + 0.01);
  group.add(face);
  // Handle.
  const handle = box(0.08, 0.025, 0.04, COL.metalDark);
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
};

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
