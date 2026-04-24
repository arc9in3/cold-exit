// Item thumbnail renderer — turns an item def into a 3/4-view 3D
// preview rendered once into an offscreen canvas and cached as a
// data URL. Used by the inventory, loot, shop, and detail UIs
// instead of the Military icon-pack PNGs, which were too small
// and too samey to tell apart at a glance.
//
// Each item category builds a small primitive-shaped proxy
// (weapon, helmet, vest, boot, etc.) tinted by `item.tint` so
// two helmets in the same slot look visually distinct even with
// the same base silhouette. Cache is keyed by a stable descriptor
// so the same item id / weapon class only renders once per run.
import * as THREE from 'three';
import { loadModelClone } from './gltf_cache.js';
import { modelForItem } from './model_manifest.js';

const SIZE = 96;                    // thumbnail resolution (px)
const BG = 0x1a1e24;                // matches inventory card bg

let _renderer = null;
let _scene = null;
let _camera = null;
let _stage = null;                  // group we clear between renders
let _rim = null;                    // rim light — recoloured per item
const _cache = new Map();           // key → data URL

// Neutral base palette — items render in realistic materials, and the
// item's `tint` is applied only to a single accent piece per
// category (a strap, plate, cap, buckle, etc.). This reads better
// than painting the whole helmet bright pink: you can still tell two
// chest plates apart by their accent colour, without cartoonifying
// the whole silhouette.
const NEUTRAL = {
  metal:     0x7a8290,   // steel — weapon bodies, plates, buckles
  metalDark: 0x3a4048,
  fabric:    0x3a3f46,   // chest/pants/backpack canvas
  leather:   0x3a2818,   // belts/boots
  rubber:    0x151a1f,   // sole, grip wrap
  glass:     0xbfe4ff,   // vials
  synthetic: 0x4a5058,   // helmet shell, pouch
  skin:      0x9a7050,   // unused but available for gloves-without-color
};

function _ensureRenderer() {
  if (_renderer) return;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  _renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, preserveDrawingBuffer: true,
  });
  _renderer.setClearColor(BG, 0);   // transparent so UI bg shows through
  _renderer.setSize(SIZE, SIZE, false);
  _renderer.outputColorSpace = THREE.SRGBColorSpace;

  _scene = new THREE.Scene();
  // Key + fill rig — warm key, cool fill. Rim light is *coloured by
  // the item tint each render* so each thumbnail picks up a subtle
  // edge glow matching its accent, reinforcing the identity without
  // flooding the mesh.
  const key = new THREE.DirectionalLight(0xfff2cc, 1.1);
  key.position.set(2, 3, 2);
  _scene.add(key);
  const fill = new THREE.DirectionalLight(0x7090b0, 0.55);
  fill.position.set(-2, 1, 1);
  _scene.add(fill);
  _rim = new THREE.DirectionalLight(0xffffff, 0.55);
  _rim.position.set(0, 2, -2);
  _scene.add(_rim);
  _scene.add(new THREE.AmbientLight(0x303640, 0.85));

  _camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  _camera.position.set(1.8, 1.6, 2.2);
  _camera.lookAt(0, 0, 0);

  _stage = new THREE.Group();
  _scene.add(_stage);
}

function _disposeStage() {
  while (_stage.children.length) {
    const c = _stage.children.pop();
    c.traverse?.((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) {
        if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
        else n.material.dispose();
      }
    });
  }
}

function _capture() {
  _renderer.render(_scene, _camera);
  return _renderer.domElement.toDataURL('image/png');
}

// ---------- material helpers ----------------------------------------

function _mat(hex, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: hex, roughness: opts.roughness ?? 0.6,
    metalness: opts.metalness ?? 0.15, ...opts,
  });
}

function _box(w, h, d, color, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), _mat(color, opts));
  return m;
}
function _cyl(r, h, color, seg = 14) {
  return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), _mat(color));
}

// ---------- builders per item category ------------------------------

function buildWeapon(item) {
  const tint = item.tint ?? NEUTRAL.metal;
  const g = new THREE.Group();
  const cls = item.class || 'pistol';
  const spec = {
    pistol:   { bodyW: 0.9, bodyH: 0.22, bodyD: 0.12, barL: 0.4, barR: 0.045, gripH: 0.32 },
    smg:      { bodyW: 1.2, bodyH: 0.22, bodyD: 0.14, barL: 0.35, barR: 0.05,  gripH: 0.32, stock: true  },
    shotgun:  { bodyW: 1.7, bodyH: 0.22, bodyD: 0.15, barL: 0.85, barR: 0.08,  gripH: 0.32, stock: true  },
    rifle:    { bodyW: 1.6, bodyH: 0.22, bodyD: 0.14, barL: 0.75, barR: 0.05,  gripH: 0.32, stock: true  },
    sniper:   { bodyW: 2.0, bodyH: 0.22, bodyD: 0.14, barL: 1.05, barR: 0.055, gripH: 0.32, stock: true, scope: true },
    lmg:      { bodyW: 1.8, bodyH: 0.30, bodyD: 0.18, barL: 0.8,  barR: 0.075, gripH: 0.32, stock: true, mag: true },
    flame:    { bodyW: 1.2, bodyH: 0.26, bodyD: 0.16, barL: 0.4,  barR: 0.08,  gripH: 0.32, tank: true  },
  }[cls] || { bodyW: 1.2, bodyH: 0.22, bodyD: 0.14, barL: 0.5, barR: 0.05, gripH: 0.32 };

  // Body — dark metal, neutral so the player sees the weapon shape.
  const body = _box(spec.bodyW, spec.bodyH, spec.bodyD, NEUTRAL.metalDark,
    { metalness: 0.7, roughness: 0.35 });
  body.position.set(0, 0.05, 0);
  g.add(body);
  // Barrel — lighter steel.
  const bar = _cyl(spec.barR, spec.barL, NEUTRAL.metal, 16);
  bar.material.metalness = 0.85;
  bar.material.roughness = 0.3;
  bar.rotation.z = Math.PI / 2;
  bar.position.set(spec.bodyW * 0.5 + spec.barL * 0.4, 0.07, 0);
  g.add(bar);
  // Grip — rubber wrap, neutral dark.
  const grip2 = _box(0.16, spec.gripH, 0.12, NEUTRAL.rubber);
  grip2.position.set(-spec.bodyW * 0.35, -spec.gripH * 0.5 + 0.05, 0);
  g.add(grip2);
  // ACCENT — a tinted side-plate riveted onto the receiver so the
  // weapon gets a colour signature without looking like a nerf gun.
  const accent = _box(spec.bodyW * 0.55, spec.bodyH * 0.6, 0.02, tint,
    { metalness: 0.3, roughness: 0.5 });
  accent.position.set(-0.05, 0.05, spec.bodyD * 0.5 + 0.01);
  g.add(accent);
  if (spec.stock) {
    const stock = _box(0.5, 0.18, 0.12, NEUTRAL.leather);
    stock.position.set(-spec.bodyW * 0.55 - 0.25, 0.02, 0);
    g.add(stock);
  }
  if (spec.scope) {
    const scope = _cyl(0.06, 0.5, 0x1a1a1a);
    scope.rotation.z = Math.PI / 2;
    scope.position.set(-0.05, 0.25, 0);
    g.add(scope);
  }
  if (spec.mag) {
    const mag = _box(0.18, 0.4, 0.14, NEUTRAL.metalDark);
    mag.position.set(0, -0.18, 0);
    g.add(mag);
  }
  if (spec.tank) {
    // Flame tank — keep tinted since the canister itself IS the colour.
    const tank = _cyl(0.14, 0.5, tint);
    tank.position.set(-spec.bodyW * 0.5 - 0.1, 0.08, -0.2);
    g.add(tank);
  }
  g.rotation.y = -0.35;
  g.rotation.x = 0.1;
  return g;
}

function buildMelee(item) {
  const tint = item.tint ?? 0xa0a0a0;
  const g = new THREE.Group();
  const cls = (item.name || '').toLowerCase();
  const bladed = /knife|kukri|sword|katana|machete|tomahawk|axe/.test(cls);
  if (bladed) {
    // Blade — polished steel.
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.02, 1.1),
      _mat(0xcfd6de, { metalness: 0.9, roughness: 0.2 }),
    );
    blade.position.y = 0.2;
    g.add(blade);
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.2, 10),
      _mat(0xcfd6de, { metalness: 0.9, roughness: 0.2 }),
    );
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(0, 0.2, 0.65);
    g.add(tip);
  } else {
    // Blunt — bat/sledge/crowbar: dark metal body.
    const body = _cyl(0.08, 1.2, NEUTRAL.metalDark);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.2;
    g.add(body);
    const head = _box(0.18, 0.22, 0.18, NEUTRAL.metalDark);
    head.position.set(0, 0.2, 0.55);
    g.add(head);
  }
  // Handle wrap — ACCENT, tinted. Reads as the grip-tape colour.
  const wrap = _cyl(0.055, 0.5, tint);
  wrap.rotation.x = Math.PI / 2;
  wrap.position.set(0, 0.2, -0.55);
  g.add(wrap);
  // Pommel cap — leather, neutral.
  const cap = _cyl(0.07, 0.08, NEUTRAL.leather);
  cap.rotation.x = Math.PI / 2;
  cap.position.set(0, 0.2, -0.84);
  g.add(cap);
  g.rotation.y = -0.4;
  g.rotation.x = 0.15;
  return g;
}

function buildHelmet(item) {
  const tint = item.tint ?? NEUTRAL.synthetic;
  const g = new THREE.Group();
  // Dome — neutral helmet shell.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    _mat(NEUTRAL.synthetic, { metalness: 0.25, roughness: 0.6 }),
  );
  dome.position.y = 0.05;
  g.add(dome);
  const rim = _cyl(0.52, 0.08, NEUTRAL.metalDark);
  rim.position.y = 0.0;
  g.add(rim);
  // ACCENT — tinted stripe running front-to-back over the crown.
  const stripe = _box(0.14, 0.09, 1.02, tint, { roughness: 0.5 });
  stripe.position.set(0, 0.45, 0);
  g.add(stripe);
  // Visor — black.
  const visor = _box(0.8, 0.08, 0.04, 0x1a1a1a);
  visor.position.set(0, 0.08, 0.5);
  g.add(visor);
  g.rotation.y = -0.4;
  return g;
}

function buildMask(item) {
  const tint = item.tint ?? NEUTRAL.synthetic;
  const g = new THREE.Group();
  // Plate — neutral mask body.
  const plate = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    _mat(NEUTRAL.synthetic, { roughness: 0.55 }),
  );
  plate.rotation.x = Math.PI;
  plate.position.y = 0.1;
  g.add(plate);
  // ACCENT — tinted eye-ring rims around the lenses.
  for (const sx of [-0.12, 0.12]) {
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.08, 0.018, 8, 16),
      _mat(tint, { metalness: 0.4, roughness: 0.4 }),
    );
    rim.position.set(sx, 0.1, 0.3);
    g.add(rim);
    const eye = _cyl(0.06, 0.04, 0x1a1a1a);
    eye.rotation.x = Math.PI / 2;
    eye.position.set(sx, 0.1, 0.3);
    g.add(eye);
  }
  g.rotation.y = -0.3;
  return g;
}

function buildEars(item) {
  const tint = item.tint ?? 0x808080;
  const g = new THREE.Group();
  // Band — neutral metal.
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.35, 0.035, 8, 20, Math.PI),
    _mat(NEUTRAL.metalDark, { metalness: 0.5 }),
  );
  band.rotation.z = Math.PI / 2;
  band.rotation.y = Math.PI / 2;
  band.position.y = 0.1;
  g.add(band);
  // Ear cups — neutral shell.
  for (const sx of [-0.35, 0.35]) {
    const cup = _cyl(0.14, 0.12, NEUTRAL.synthetic);
    cup.rotation.z = Math.PI / 2;
    cup.position.set(sx, -0.05, 0);
    g.add(cup);
    // ACCENT — tinted indicator disc on each cup.
    const led = _cyl(0.07, 0.025, tint);
    led.rotation.z = Math.PI / 2;
    led.position.set(sx > 0 ? sx + 0.07 : sx - 0.07, -0.05, 0);
    g.add(led);
  }
  g.rotation.y = -0.3;
  g.rotation.x = 0.1;
  return g;
}

function buildChest(item) {
  const tint = item.tint ?? 0x4a5a6a;
  const g = new THREE.Group();
  // Torso — neutral canvas/fabric.
  const torso = _box(0.9, 1.0, 0.4, NEUTRAL.fabric);
  torso.position.y = 0.1;
  g.add(torso);
  // ACCENT — front chest plate carries the tint (the paint job).
  const plate = _box(0.7, 0.7, 0.06, tint, { metalness: 0.3, roughness: 0.45 });
  plate.position.set(0, 0.2, 0.22);
  g.add(plate);
  // Strap diagonal — neutral black webbing.
  const strap = _box(0.9, 0.08, 0.06, 0x1a1a1a);
  strap.position.set(0, 0.15, 0.26);
  strap.rotation.z = Math.PI / 8;
  g.add(strap);
  // Shoulder bumps — neutral.
  for (const sx of [-0.45, 0.45]) {
    const sh = _box(0.22, 0.18, 0.32, NEUTRAL.fabric);
    sh.position.set(sx, 0.55, 0);
    g.add(sh);
  }
  g.rotation.y = -0.35;
  return g;
}

function buildHands(item) {
  const tint = item.tint ?? NEUTRAL.leather;
  const g = new THREE.Group();
  for (const sx of [-0.3, 0.3]) {
    // Palm — neutral dark leather.
    const palm = _box(0.3, 0.45, 0.15, NEUTRAL.rubber);
    palm.position.set(sx, 0, 0);
    g.add(palm);
    const thumb = _box(0.1, 0.2, 0.1, NEUTRAL.rubber);
    thumb.position.set(sx + (sx > 0 ? -0.18 : 0.18), 0.08, 0.05);
    g.add(thumb);
    // ACCENT — tinted cuff band at the wrist.
    const cuff = _box(0.34, 0.12, 0.19, tint);
    cuff.position.set(sx, -0.2, 0);
    g.add(cuff);
  }
  g.rotation.y = -0.3;
  return g;
}

function buildBelt(item) {
  const tint = item.tint ?? 0xc0a070;
  const g = new THREE.Group();
  // Strap — neutral leather.
  const strap = _box(1.4, 0.2, 0.12, NEUTRAL.leather);
  g.add(strap);
  // ACCENT — tinted buckle plate.
  const buckle = _box(0.22, 0.28, 0.06, tint, { metalness: 0.6, roughness: 0.3 });
  buckle.position.set(0, 0, 0.08);
  g.add(buckle);
  // Pouches — neutral.
  for (const sx of [-0.5, 0.5]) {
    const pouch = _box(0.22, 0.22, 0.14, NEUTRAL.leather);
    pouch.position.set(sx, -0.15, 0.04);
    g.add(pouch);
  }
  g.rotation.y = -0.3;
  return g;
}

function buildPants(item) {
  const tint = item.tint ?? 0x6a5a4a;
  const g = new THREE.Group();
  for (const sx of [-0.22, 0.22]) {
    // Leg — neutral fabric.
    const leg = _box(0.3, 1.0, 0.3, NEUTRAL.fabric);
    leg.position.set(sx, 0, 0);
    g.add(leg);
    // ACCENT — tinted pocket patch on each thigh.
    const pkt = _box(0.18, 0.22, 0.04, tint);
    pkt.position.set(sx, 0.15, 0.17);
    g.add(pkt);
  }
  // Waistband — neutral.
  const band = _box(0.8, 0.18, 0.35, NEUTRAL.fabric);
  band.position.y = 0.55;
  g.add(band);
  g.rotation.y = -0.35;
  return g;
}

function buildBoots(item) {
  const tint = item.tint ?? 0x3a2a18;
  const g = new THREE.Group();
  for (const sx of [-0.25, 0.25]) {
    // Shaft + foot — neutral leather.
    const shaft = _box(0.3, 0.5, 0.3, NEUTRAL.leather);
    shaft.position.set(sx, 0.15, 0);
    g.add(shaft);
    const foot = _box(0.32, 0.18, 0.55, NEUTRAL.leather);
    foot.position.set(sx, -0.2, 0.1);
    g.add(foot);
    // Sole — black rubber.
    const sole = _box(0.34, 0.06, 0.57, NEUTRAL.rubber);
    sole.position.set(sx, -0.32, 0.1);
    g.add(sole);
    // ACCENT — tinted lace band across the top of the shaft.
    const band = _box(0.32, 0.08, 0.32, tint);
    band.position.set(sx, 0.38, 0);
    g.add(band);
  }
  g.rotation.y = -0.3;
  return g;
}

function buildBackpack(item) {
  const tint = item.tint ?? 0x6a5a3a;
  const g = new THREE.Group();
  // Body — neutral canvas.
  const body = _box(0.8, 1.0, 0.45, NEUTRAL.fabric);
  g.add(body);
  // Side pocket.
  const pkt = _box(0.2, 0.6, 0.2, NEUTRAL.fabric);
  pkt.position.set(0.5, -0.1, 0.15);
  g.add(pkt);
  // ACCENT — tinted top flap (the outward-facing panel).
  const flap = _box(0.82, 0.3, 0.44, tint, { roughness: 0.55 });
  flap.position.y = 0.55;
  g.add(flap);
  // Strap lines — black webbing.
  for (const sx of [-0.25, 0.25]) {
    const strap = _box(0.08, 0.9, 0.06, 0x1a1a1a);
    strap.position.set(sx, 0.1, 0.25);
    g.add(strap);
  }
  g.rotation.y = -0.35;
  return g;
}

function buildConsumable(item) {
  const tint = item.tint ?? 0xc06060;
  const g = new THREE.Group();
  // Vial — translucent glass (the liquid carries the tint).
  const body = _cyl(0.2, 0.7, NEUTRAL.glass, 14);
  body.material.metalness = 0.0;
  body.material.roughness = 0.1;
  body.material.transparent = true;
  body.material.opacity = 0.55;
  g.add(body);
  // ACCENT — tinted "liquid" inside the vial.
  const liquid = _cyl(0.17, 0.5, tint, 14);
  liquid.position.y = -0.1;
  g.add(liquid);
  // Cap — neutral.
  const cap = _cyl(0.21, 0.08, NEUTRAL.metalDark);
  cap.position.y = 0.4;
  g.add(cap);
  // Label.
  const label = _box(0.3, 0.3, 0.01, 0xe0e0d0);
  label.position.set(0, 0, 0.2);
  g.add(label);
  g.rotation.y = -0.3;
  return g;
}

function buildJunk(item) {
  const tint = item.tint ?? 0x808080;
  const g = new THREE.Group();
  // Chunk body — neutral scrap metal.
  const chunk = _box(0.8, 0.5, 0.6, NEUTRAL.metalDark);
  chunk.rotation.y = 0.3;
  g.add(chunk);
  // ACCENT — tinted stamp/marking box.
  const accent = _box(0.22, 0.38, 0.22, tint, { metalness: 0.4 });
  accent.position.set(0.3, 0.25, 0.2);
  g.add(accent);
  g.rotation.y = -0.4;
  return g;
}

function buildAttachment(item) {
  const tint = item.tint ?? 0x505050;
  const g = new THREE.Group();
  const cls = (item.slot || 'muzzle').toLowerCase();
  if (cls === 'muzzle') {
    // Neutral suppressor body + tinted end cap.
    const can = _cyl(0.14, 0.5, NEUTRAL.metalDark);
    can.rotation.z = Math.PI / 2;
    g.add(can);
    const cap = _cyl(0.145, 0.08, tint);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = 0.26;
    g.add(cap);
  } else if (cls === 'toprail' || cls === 'siderail' || cls === 'sideRail') {
    const tube = _cyl(0.12, 0.6, 0x1a1a1a);
    tube.rotation.z = Math.PI / 2;
    g.add(tube);
    // ACCENT — tinted scope ring.
    const ring = _cyl(0.16, 0.12, tint);
    ring.rotation.z = Math.PI / 2;
    ring.position.x = -0.18;
    g.add(ring);
  } else if (cls === 'stock') {
    const stock = _box(0.7, 0.28, 0.16, NEUTRAL.leather);
    g.add(stock);
    // ACCENT — tinted side plate.
    const plate = _box(0.5, 0.18, 0.02, tint);
    plate.position.z = 0.09;
    g.add(plate);
  } else {
    const box = _box(0.5, 0.24, 0.2, NEUTRAL.metalDark);
    g.add(box);
    const accent = _box(0.5, 0.06, 0.22, tint);
    accent.position.y = 0.12;
    g.add(accent);
  }
  g.rotation.y = -0.3;
  return g;
}

function buildGeneric(item) {
  const tint = item.tint ?? 0x606060;
  const g = new THREE.Group();
  const box = _box(0.7, 0.7, 0.7, NEUTRAL.metalDark);
  g.add(box);
  const accent = _box(0.45, 0.12, 0.72, tint);
  accent.position.y = 0.2;
  g.add(accent);
  return g;
}

// ---------- dispatch ------------------------------------------------

function buildFor(item) {
  if (!item) return buildGeneric({});
  if (item.type === 'ranged') return buildWeapon(item);
  if (item.type === 'melee')  return buildMelee(item);
  if (item.type === 'armor' || item.type === 'gear' || item.type === 'backpack') {
    // Pick silhouette by slot — each slot reads distinct so armour
    // variants don't all collapse into the same cube.
    switch (item.slot) {
      case 'head':     return buildHelmet(item);
      case 'face':     return buildMask(item);
      case 'ears':     return buildEars(item);
      case 'chest':    return buildChest(item);
      case 'hands':    return buildHands(item);
      case 'belt':     return buildBelt(item);
      case 'pants':    return buildPants(item);
      case 'boots':    return buildBoots(item);
      case 'backpack': return buildBackpack(item);
      default:         return buildGeneric(item);
    }
  }
  if (item.type === 'consumable') return buildConsumable(item);
  if (item.type === 'junk')       return buildJunk(item);
  if (item.type === 'attachment') return buildAttachment(item);
  return buildGeneric(item);
}

// Stable cache key — identical defs share a thumbnail, rolled items
// with affixes / durability still share the same base appearance.
function cacheKey(item) {
  if (!item) return '__empty';
  const tint = (item.tint ?? 0).toString(16);
  if (item.type === 'ranged')  return `ranged:${item.class || 'p'}:${item.name || item.id || ''}:${tint}`;
  if (item.type === 'melee')   return `melee:${item.name || item.id || ''}:${tint}`;
  if (item.type === 'attachment') return `att:${item.slot || ''}:${item.id || item.name}:${tint}`;
  if (item.type === 'consumable') return `con:${item.id || item.name}:${tint}`;
  if (item.type === 'junk')       return `junk:${item.id || item.name}:${tint}`;
  return `${item.slot || item.type || 'x'}:${item.id || item.name}:${tint}`;
}

// Fit the built model into the camera's view by scaling so its
// bounding box fits in a 1.4-unit cube, then translating so the box
// centre sits at world origin (which is where the camera looks).
// Resetting scale + position to identity BEFORE measuring is critical
// — the stage is reused across renders and carries the previous
// item's transform; skipping the reset made every subsequent
// thumbnail measure its bbox through the prior scale and drift
// off-centre.
function _fitAndRender(tintHex) {
  _stage.position.set(0, 0, 0);
  _stage.scale.set(1, 1, 1);
  _stage.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(_stage);
  if (bbox.isEmpty()) return _capture();
  const center = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 1.4 / maxDim;
  _stage.scale.setScalar(scale);
  _stage.position.copy(center).multiplyScalar(-scale);
  if (_rim) _rim.color.setHex(tintHex || 0xffffff);
  return _capture();
}

// Track which items have already kicked off an FBX upgrade so we
// don't reissue the load on every frame of an inventory re-render.
const _modelPending = new Set();

/**
 * Returns a PNG data URL for the given item. First call for a given
 * cache key renders a primitive placeholder and returns that
 * synchronously. If the item has a registered FBX model
 * (`modelForItem`), it's ALSO queued for async render — once the
 * model loads, the cache entry is replaced with the real-model
 * thumbnail and any UI that re-renders will pick it up. This keeps
 * the inventory grid consistent with the rotating preview shown in
 * the details modal (both end up driven by the same FBX).
 */
export function thumbnailFor(item) {
  if (!item) return null;
  const key = cacheKey(item);
  if (_cache.has(key)) return _cache.get(key);

  let url = null;
  try {
    _ensureRenderer();
    _disposeStage();
    _stage.add(buildFor(item));
    url = _fitAndRender(item.tint);
    _cache.set(key, url);
  } catch (err) {
    console.warn('[thumbnails] primitive render failed', err);
  }

  // Kick off an FBX-based upgrade in the background. When it lands,
  // the next read from the cache returns the higher-fidelity render.
  const modelUrl = modelForItem(item);
  if (modelUrl && !_modelPending.has(key)) {
    _modelPending.add(key);
    loadModelClone(modelUrl).then((obj) => {
      if (!obj) return;
      try {
        _ensureRenderer();
        _disposeStage();
        _stage.add(obj);
        const hiUrl = _fitAndRender(item.tint);
        _cache.set(key, hiUrl);
      } catch (err) {
        console.warn('[thumbnails] model render failed', err);
      }
    }).finally(() => _modelPending.delete(key));
  }

  return url;
}

// For UIs that want to prime the cache on panel-open to avoid a
// visual pop as each cell renders its first frame.
export function preloadThumbnails(items) {
  for (const it of items) thumbnailFor(it);
}
