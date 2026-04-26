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
import { snapshotToDataURL } from './snapshot_renderer.js';

const SIZE = 96;                    // thumbnail resolution (px)
const BG = 0x1a1e24;                // matches inventory card bg

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
  if (_scene) return;
  // Renderer is now shared via snapshot_renderer.js — we just keep
  // the scene + camera + stage state here. The shared renderer
  // resizes per call, so SIZE drives all thumbnails uniformly.
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

// 1×1 transparent PNG — cheap fallback when the offscreen context is
// lost. Inventory cells render their text + border around the image so
// a transparent thumbnail keeps the cell legible instead of breaking
// the layout.
const _BLANK_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

function _capture() {
  // Routes through the shared offscreen renderer. Returns the blank
  // PNG fallback if the snapshot renderer's context is currently lost
  // (the inventory cell still renders its border + label so the
  // layout stays legible).
  return snapshotToDataURL(_scene, _camera, SIZE, SIZE, { clearColor: BG, clearAlpha: 0 })
       || _BLANK_DATA_URL;
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
// Tapered cylinder (rTop != rBot). Useful for pants legs, vases,
// boot shafts — anything that should narrow along its length.
function _cylT(rTop, rBot, h, color, seg = 14, opts) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), _mat(color, opts));
}
// Capsule — hemisphere-capped cylinder. Reads as fabric / soft padding
// instead of hard-edged box. Three.js's CapsuleGeometry takes radius
// + length (cylindrical body length, caps add 2*radius to total).
function _cap(r, len, color, segCap = 6, segCyl = 12, opts) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, segCap, segCyl), _mat(color, opts));
}
// Sphere helper.
function _sph(r, color, opts, seg = 12) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, Math.floor(seg * 0.6))), _mat(color, opts));
}
// Torus helper.
function _torus(r, tube, color, opts, segR = 16, segT = 8) {
  return new THREE.Mesh(new THREE.TorusGeometry(r, tube, segT, segR), _mat(color, opts));
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
  // Per-id silhouette: ghillie suit reads as a draped cloak; plate
  // armor reads as a hard rigid carrier; light vest is a soft shirt.
  // Default chest is a tactical rig with visible pouches + straps.
  const id = item.id || '';
  const isGhillie = /ghillie/.test(id);
  const isPlate = /heavy|plate|spetsnaz|jugger|thorn/.test(id);
  const isLight = /light|holster/.test(id);

  if (isGhillie) {
    // Ghillie suit — irregular layered cloak shape suggested with
    // a stack of stretched, slightly-rotated capsules and a hood
    // bump. Tint colors the foliage strips.
    for (let i = 0; i < 5; i++) {
      const w = 1.0 + Math.random() * 0.2;
      const layer = _cap(0.18, w * 0.6, tint, 4, 8,
        { roughness: 0.95, metalness: 0.0 });
      layer.rotation.z = Math.PI / 2;
      layer.position.set((Math.random() - 0.5) * 0.1, 0.3 - i * 0.18, (Math.random() - 0.5) * 0.05);
      g.add(layer);
    }
    const hood = _sph(0.32, NEUTRAL.fabric, { roughness: 0.9 });
    hood.scale.set(1, 0.7, 1);
    hood.position.set(0, 0.55, -0.1);
    g.add(hood);
    g.rotation.y = -0.35;
    return g;
  }

  // Standard tactical rig / plate carrier:
  // - Torso panel (rounded capsule reads as fabric, not a box)
  // - Front plate (tinted, harder material on plate variants)
  // - Two shoulder straps (visible webbing crossing over the top)
  // - 3-4 MOLLE pouches stitched to the front
  // - Side cummerbund panels suggesting fit
  const torso = _cap(0.42, 0.55, NEUTRAL.fabric, 6, 14, { roughness: 0.85 });
  torso.scale.set(1.0, 1.0, 0.55);   // squash the depth so it's a torso not a sausage
  torso.position.y = 0.1;
  g.add(torso);

  // Front armor plate — flat for plate variants, just a fabric panel
  // for light vest (suggests stitched canvas).
  const plateMetal = isPlate ? 0.5 : 0.05;
  const plateRough = isPlate ? 0.35 : 0.7;
  const plate = _box(0.62, 0.68, isPlate ? 0.08 : 0.04, tint,
    { metalness: plateMetal, roughness: plateRough });
  plate.position.set(0, 0.22, 0.27);
  g.add(plate);

  if (!isLight) {
    // MOLLE pouches — three small cuboids stitched onto the front
    // panel. Read as separate compartments rather than one flat slab.
    const pouchMat = NEUTRAL.fabric;
    for (let i = 0; i < 3; i++) {
      const x = -0.2 + i * 0.20;
      const pouch = _box(0.16, 0.18, 0.10, pouchMat, { roughness: 0.85 });
      pouch.position.set(x, -0.05, 0.32);
      g.add(pouch);
      // Tiny buckle dot on each pouch flap.
      const buckle = _box(0.04, 0.04, 0.02, NEUTRAL.metalDark,
        { metalness: 0.7, roughness: 0.3 });
      buckle.position.set(x, -0.10, 0.38);
      g.add(buckle);
    }
    // Top-row admin pouch.
    const admin = _box(0.36, 0.10, 0.08, pouchMat, { roughness: 0.85 });
    admin.position.set(0, 0.45, 0.32);
    g.add(admin);
  }

  // Shoulder straps — two angled webbing bands going over each shoulder.
  for (const sx of [-0.18, 0.18]) {
    const strap = _box(0.10, 0.62, 0.05, 0x18181c, { roughness: 0.75 });
    strap.position.set(sx, 0.32, 0.24);
    strap.rotation.x = -0.18;
    g.add(strap);
    // Buckle on the strap front.
    const sb = _box(0.10, 0.06, 0.03, NEUTRAL.metalDark,
      { metalness: 0.7, roughness: 0.3 });
    sb.position.set(sx, 0.05, 0.30);
    g.add(sb);
  }

  // Cummerbund — short side panels suggesting fit at the waist.
  for (const sx of [-0.40, 0.40]) {
    const side = _box(0.08, 0.36, 0.42, NEUTRAL.fabric, { roughness: 0.85 });
    side.position.set(sx, 0.0, 0);
    g.add(side);
  }

  g.rotation.y = -0.35;
  return g;
}

function buildHands(item) {
  const tint = item.tint ?? NEUTRAL.leather;
  const g = new THREE.Group();
  // Build one rounded glove at +x and mirror it. A glove silhouette =
  // capsule palm + four cylindrical fingers + offset thumb + tinted
  // cuff. Reads unmistakably as a hand instead of a pair of bricks.
  const gloveMat = { roughness: 0.8, metalness: 0.05 };
  for (const side of [-1, 1]) {
    const sx = 0.32 * side;
    // Palm — capsule lying flat (length goes "up", caps round the
    // wrist + fingertip side). Slightly squashed in depth to read
    // as a flat hand.
    const palm = _cap(0.18, 0.20, NEUTRAL.rubber, 6, 12, gloveMat);
    palm.scale.set(1.0, 1.0, 0.55);
    palm.position.set(sx, 0.05, 0);
    g.add(palm);
    // Fingers — four short capsules splayed across the top of the
    // palm. Subtle outward fan so they don't look like a rake.
    for (let i = 0; i < 4; i++) {
      const fOff = -0.12 + i * 0.08;        // across-palm spacing
      const fan  = (i - 1.5) * 0.05 * side; // gentle outward fan
      const finger = _cap(0.045, 0.16, NEUTRAL.rubber, 4, 8, gloveMat);
      finger.scale.set(1.0, 1.0, 0.7);
      finger.position.set(sx + fOff, 0.32, fan);
      g.add(finger);
      // Knuckle joint pip — adds organic shape to each finger.
      const knuckle = _sph(0.05, NEUTRAL.rubber, gloveMat, 8);
      knuckle.scale.set(1.0, 0.6, 0.6);
      knuckle.position.set(sx + fOff, 0.20, 0);
      g.add(knuckle);
    }
    // Thumb — splayed to the side, tilted inward.
    const thumb = _cap(0.05, 0.13, NEUTRAL.rubber, 4, 8, gloveMat);
    thumb.scale.set(1.0, 1.0, 0.7);
    thumb.position.set(sx + 0.18 * side, 0.10, 0.06);
    thumb.rotation.z = -0.5 * side;
    g.add(thumb);
    // Cuff — tinted wrist band, slightly flared. Tapered cylinder
    // (wider at the wrist opening) reads as a turn-back.
    const cuff = _cylT(0.21, 0.18, 0.16, tint, 14, { roughness: 0.7 });
    cuff.scale.set(1.0, 1.0, 0.62);
    cuff.position.set(sx, -0.18, 0);
    g.add(cuff);
    // Knuckle reinforcement plate — small rectangle on the back of
    // the hand. Tinted so it shows the glove's identity color.
    const reinforce = _box(0.18, 0.10, 0.02, tint, { roughness: 0.6 });
    reinforce.position.set(sx, 0.12, -0.10);
    g.add(reinforce);
  }
  g.rotation.y = -0.3;
  g.rotation.x = 0.1;
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
  // Pants silhouette = tapered legs (wider hip → narrower ankle),
  // a waistband, and a soft seat hint between the legs. Tapered
  // cylinders give the cloth-falling-on-a-leg read instead of two
  // upright bricks. Tint hits the cargo pockets stitched on each
  // thigh so two pant variants stay visually distinct.
  const fabricMat = { roughness: 0.85, metalness: 0.02 };

  for (const sx of [-0.18, 0.18]) {
    // Leg — wider at the hip (top) than the ankle (bottom). Slight
    // bow forward at the knee suggested via two stacked segments.
    const upper = _cylT(0.22, 0.18, 0.55, NEUTRAL.fabric, 12, fabricMat);
    upper.position.set(sx, 0.18, 0);
    g.add(upper);
    const lower = _cylT(0.18, 0.15, 0.48, NEUTRAL.fabric, 12, fabricMat);
    lower.position.set(sx, -0.30, 0.02);
    g.add(lower);
    // Cargo pocket — tinted patch on each outer thigh. Box at the
    // tilt, rather than flush with the leg, so it reads as stitched
    // on rather than baked in.
    const pkt = _box(0.18, 0.22, 0.04, tint, { roughness: 0.85 });
    pkt.position.set(sx + 0.12 * Math.sign(sx), 0.10, 0.04);
    pkt.rotation.y = 0.18 * -Math.sign(sx);
    g.add(pkt);
    // Knee patch — slightly darker reinforcement panel.
    const knee = _box(0.18, 0.08, 0.04, NEUTRAL.metalDark,
      { roughness: 0.9, metalness: 0.05 });
    knee.position.set(sx, -0.10, 0.16);
    g.add(knee);
  }
  // Waistband — capsule reads as a soft belt of cloth, not a slab.
  const band = _cap(0.18, 0.42, NEUTRAL.fabric, 4, 12, fabricMat);
  band.scale.set(1.0, 1.0, 0.55);
  band.rotation.z = Math.PI / 2;
  band.position.set(0, 0.50, 0);
  g.add(band);
  // Belt loops — thin strips suggesting webbing under the band.
  for (const sx of [-0.20, 0.0, 0.20]) {
    const loop = _box(0.04, 0.08, 0.20, NEUTRAL.leather);
    loop.position.set(sx, 0.50, 0.16);
    g.add(loop);
  }
  // Seat / crotch hint — small wedge between the upper leg tops so
  // the silhouette reads as one garment, not two sausages.
  const seat = _box(0.30, 0.20, 0.32, NEUTRAL.fabric, fabricMat);
  seat.position.set(0, 0.32, -0.02);
  g.add(seat);

  g.rotation.y = -0.35;
  return g;
}

function buildBoots(item) {
  const tint = item.tint ?? 0x3a2a18;
  const g = new THREE.Group();
  // Boots = tapered shaft (calf) + curved foot (ball + heel + sole)
  // + tinted lace band. Sphere caps round the ankle joint and the
  // toe so the silhouette is unmistakably a boot.
  const leatherMat = { roughness: 0.7, metalness: 0.10 };

  for (const sx of [-0.25, 0.25]) {
    // Shaft — tapered cylinder, wider at the top opening.
    const shaft = _cylT(0.21, 0.18, 0.50, NEUTRAL.leather, 14, leatherMat);
    shaft.position.set(sx, 0.18, 0);
    g.add(shaft);
    // Ankle joint — sphere where the shaft meets the foot.
    const ankle = _sph(0.18, NEUTRAL.leather, leatherMat, 12);
    ankle.position.set(sx, -0.07, 0.05);
    g.add(ankle);
    // Foot body — capsule lying on its side reads as the ball of the
    // foot rounded up to a toe, with a heel bump trailing.
    const foot = _cap(0.13, 0.32, NEUTRAL.leather, 6, 12, leatherMat);
    foot.scale.set(1.0, 1.0, 1.0);
    foot.rotation.x = Math.PI / 2;
    foot.position.set(sx, -0.20, 0.18);
    g.add(foot);
    // Heel — small cube at the back to suggest a stacked sole.
    const heel = _box(0.20, 0.08, 0.16, NEUTRAL.rubber, { roughness: 0.6 });
    heel.position.set(sx, -0.30, -0.02);
    g.add(heel);
    // Sole — flat slab under the foot.
    const sole = _box(0.28, 0.05, 0.55, NEUTRAL.rubber, { roughness: 0.6 });
    sole.position.set(sx, -0.33, 0.14);
    g.add(sole);
    // Tinted lace cuff — ring around the top opening of the shaft.
    const cuff = _torus(0.21, 0.035, tint, { roughness: 0.7 }, 12, 6);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(sx, 0.44, 0);
    g.add(cuff);
    // Lace strip down the front of the shaft, suggesting eyelets.
    const lace = _box(0.06, 0.42, 0.04, NEUTRAL.metalDark);
    lace.position.set(sx, 0.18, 0.18);
    g.add(lace);
  }
  g.rotation.y = -0.3;
  return g;
}

function buildBackpack(item) {
  const tint = item.tint ?? 0x6a5a3a;
  const g = new THREE.Group();
  // Backpack silhouette — capsule body for soft fabric read, side
  // pocket as its own capsule, top flap with a buckle, two visible
  // shoulder straps with grab handle. Tint colours the flap so two
  // packs (combat / large) stay visually distinct.
  const fabricMat = { roughness: 0.85, metalness: 0.05 };
  const body = _cap(0.42, 0.7, NEUTRAL.fabric, 6, 14, fabricMat);
  body.scale.set(1.0, 1.0, 0.55);
  body.position.y = 0.0;
  g.add(body);
  // Side pocket — a smaller capsule attached to one side, suggests
  // a water-bottle compartment.
  const pkt = _cap(0.18, 0.30, NEUTRAL.fabric, 4, 10, fabricMat);
  pkt.scale.set(0.8, 1.0, 0.55);
  pkt.position.set(0.50, -0.05, 0.10);
  g.add(pkt);
  // Top flap — tinted, slightly larger than the body so it overhangs.
  const flap = _box(0.78, 0.18, 0.50, tint, { roughness: 0.7 });
  flap.position.set(0, 0.50, 0);
  g.add(flap);
  // Buckle on the flap.
  const buckle = _box(0.12, 0.06, 0.04, NEUTRAL.metalDark,
    { metalness: 0.7, roughness: 0.3 });
  buckle.position.set(0, 0.42, 0.27);
  g.add(buckle);
  // Two shoulder straps + a grab handle.
  for (const sx of [-0.22, 0.22]) {
    const strap = _box(0.10, 0.95, 0.05, 0x18181c, { roughness: 0.75 });
    strap.position.set(sx, 0.05, 0.28);
    g.add(strap);
  }
  // Top grab handle — small loop at the top.
  const handle = _torus(0.10, 0.025, NEUTRAL.fabric, fabricMat, 12, 6);
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, 0.65, 0);
  g.add(handle);
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

// === Junk ===
// Generic junk (silver coin, copper scrap, lighter, watch, drive,
// monocle, cig case, doc, dog tags) all share the SAME silhouette: a
// canvas pouch tied with a drawstring, tinted by item.tint so they
// stay distinguishable in a stack. Special junk (rings, skulls,
// vases, walkies, peas, tickets, etc.) gets its own builder.

function _buildGenericPouch(tint) {
  const g = new THREE.Group();
  const fabricMat = { roughness: 0.85, metalness: 0.02 };
  // Pouch body — capsule slightly squashed so it reads as a sack
  // sitting on a surface, not a sausage.
  const body = _cap(0.38, 0.18, NEUTRAL.leather, 6, 14, fabricMat);
  body.scale.set(1.0, 0.85, 1.0);
  body.position.y = 0.05;
  g.add(body);
  // Drawstring neck — narrow tinted band where the bag is cinched.
  const neck = _cylT(0.08, 0.16, 0.10, tint, 12, fabricMat);
  neck.position.y = 0.40;
  g.add(neck);
  // Two strands of cord trailing off the cinch.
  for (const sx of [-0.10, 0.10]) {
    const strand = _cylT(0.02, 0.02, 0.18, NEUTRAL.metalDark, 6, fabricMat);
    strand.position.set(sx, 0.50, 0.05);
    strand.rotation.z = -0.3 * Math.sign(sx);
    g.add(strand);
  }
  // Tinted seal tag dangling on the front — gives the bag its
  // identifying colour without painting the whole sack.
  const tag = _box(0.10, 0.10, 0.02, tint, { roughness: 0.6 });
  tag.position.set(0.05, 0.20, 0.30);
  g.add(tag);
  g.rotation.y = -0.35;
  return g;
}

function _buildRing(tint, gemColor = tint) {
  const g = new THREE.Group();
  // Band — gold/silver torus.
  const band = _torus(0.25, 0.06, tint, { metalness: 0.85, roughness: 0.25 }, 24, 10);
  band.rotation.x = Math.PI / 2.2;
  g.add(band);
  // Gem on top — small octahedron-ish sphere with high spec.
  const gem = _sph(0.10, gemColor, { metalness: 0.2, roughness: 0.1 }, 12);
  gem.scale.set(1.0, 1.2, 1.0);
  gem.position.set(0, 0.22, 0);
  g.add(gem);
  // Prongs holding the gem.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const prong = _box(0.025, 0.10, 0.025, tint, { metalness: 0.85, roughness: 0.3 });
    prong.position.set(Math.cos(a) * 0.07, 0.18, Math.sin(a) * 0.07);
    g.add(prong);
  }
  g.rotation.y = -0.3;
  g.rotation.x = 0.2;
  return g;
}

function _buildSkull(tint) {
  const g = new THREE.Group();
  // Cranium — sphere slightly tall.
  const cranium = _sph(0.40, tint, { roughness: 0.55, metalness: 0.15 }, 14);
  cranium.scale.set(1.0, 1.05, 0.95);
  cranium.position.y = 0.10;
  g.add(cranium);
  // Jaw — short cylinder under the cranium.
  const jaw = _box(0.55, 0.18, 0.50, tint, { roughness: 0.55 });
  jaw.position.y = -0.20;
  g.add(jaw);
  // Eye sockets — two dark recessed spheres.
  for (const sx of [-0.14, 0.14]) {
    const eye = _sph(0.10, 0x0a0a0a, { roughness: 0.9 }, 10);
    eye.scale.set(1.0, 0.85, 0.6);
    eye.position.set(sx, 0.12, 0.32);
    g.add(eye);
  }
  // Nasal cavity — small triangle hint.
  const nose = _box(0.06, 0.10, 0.04, 0x0a0a0a);
  nose.position.set(0, -0.05, 0.36);
  g.add(nose);
  g.rotation.y = -0.3;
  return g;
}

function _buildVase(tint) {
  const g = new THREE.Group();
  // Vase profile — tall, narrow neck, wider body, narrow base.
  // Use stacked tapered cylinders.
  const base   = _cylT(0.18, 0.10, 0.10, tint, 16, { roughness: 0.55 });
  const belly  = _cylT(0.30, 0.18, 0.30, tint, 16, { roughness: 0.55 });
  const neck   = _cylT(0.13, 0.30, 0.30, tint, 16, { roughness: 0.55 });
  const lip    = _cylT(0.18, 0.13, 0.06, tint, 16, { roughness: 0.55 });
  base.position.y  = -0.55;
  belly.position.y = -0.30;
  neck.position.y  =  0.00;
  lip.position.y   =  0.18;
  g.add(base, belly, neck, lip);
  // Decorative band around the belly — slightly darker.
  const band = _torus(0.30, 0.025, NEUTRAL.metalDark, { metalness: 0.4 }, 18, 6);
  band.rotation.x = Math.PI / 2;
  band.position.y = -0.30;
  g.add(band);
  g.rotation.y = -0.3;
  return g;
}

function _buildWalkie(tint) {
  const g = new THREE.Group();
  // Body — vertical rectangular block, dark plastic.
  const body = _box(0.45, 0.95, 0.20, tint, { roughness: 0.7 });
  g.add(body);
  // Speaker grille — perforated panel near the top.
  const grille = _box(0.34, 0.20, 0.04, NEUTRAL.metalDark, { roughness: 0.85 });
  grille.position.set(0, 0.30, 0.12);
  g.add(grille);
  // PTT button — round button on the side.
  const ptt = _cyl(0.05, 0.04, NEUTRAL.metalDark, 12);
  ptt.rotation.z = Math.PI / 2;
  ptt.position.set(-0.24, 0.05, 0);
  g.add(ptt);
  // Antenna — thin cylinder out the top.
  const ant = _cylT(0.04, 0.025, 0.50, NEUTRAL.metalDark, 8);
  ant.position.set(-0.13, 0.72, 0);
  g.add(ant);
  // Display square.
  const screen = _box(0.30, 0.18, 0.02, 0x6a8a6a, { metalness: 0.4, roughness: 0.2 });
  screen.position.set(0, -0.05, 0.12);
  g.add(screen);
  g.rotation.y = -0.3;
  return g;
}

function _buildRadio(tint) {
  const g = new THREE.Group();
  // Larger field-radio body — landscape orientation.
  const body = _box(1.0, 0.65, 0.40, tint, { roughness: 0.7 });
  g.add(body);
  // Tuning dial — round knob on top right.
  const dial = _cyl(0.16, 0.10, NEUTRAL.metalDark, 14);
  dial.position.set(0.30, 0.40, 0);
  g.add(dial);
  // Smaller volume dial.
  const vol = _cyl(0.10, 0.06, NEUTRAL.metalDark, 12);
  vol.position.set(-0.25, 0.36, 0);
  g.add(vol);
  // Frequency display — green LCD strip.
  const lcd = _box(0.55, 0.14, 0.02, 0x80c060, { metalness: 0.4, roughness: 0.2 });
  lcd.position.set(0.05, 0.05, 0.21);
  g.add(lcd);
  // Speaker grille — bottom front.
  const grille = _box(0.85, 0.16, 0.02, NEUTRAL.metalDark);
  grille.position.set(0, -0.20, 0.21);
  g.add(grille);
  // Telescoping antenna.
  const ant = _cylT(0.025, 0.015, 0.60, NEUTRAL.metalDark, 8);
  ant.position.set(0.45, 0.65, -0.10);
  ant.rotation.z = -0.2;
  g.add(ant);
  // Carry handle.
  const handle = _torus(0.20, 0.03, NEUTRAL.leather, { roughness: 0.85 }, 12, 6);
  handle.rotation.x = Math.PI / 2;
  handle.position.set(-0.05, 0.45, 0);
  g.add(handle);
  g.rotation.y = -0.3;
  return g;
}

function _buildBattery(tint) {
  const g = new THREE.Group();
  // Body — rectangular block, scuffed casing.
  const body = _box(0.95, 0.65, 0.55, tint, { roughness: 0.65 });
  g.add(body);
  // Two terminals on top — short metal posts.
  for (const sx of [-0.25, 0.25]) {
    const post = _cyl(0.07, 0.10, NEUTRAL.metal, 10);
    post.position.set(sx, 0.38, 0);
    g.add(post);
    const cap = _cyl(0.09, 0.04, sx < 0 ? 0xc02020 : 0x202020, 10);
    cap.position.set(sx, 0.45, 0);
    g.add(cap);
  }
  // Embossed brand panel.
  const panel = _box(0.55, 0.30, 0.02, NEUTRAL.metalDark, { roughness: 0.5 });
  panel.position.set(0, 0.05, 0.28);
  g.add(panel);
  g.rotation.y = -0.3;
  return g;
}

function _buildScrapMetal() {
  const g = new THREE.Group();
  // Three irregular chunks of metal — overlapping and rotated to
  // suggest a pile, not a single block.
  const mat = { roughness: 0.6, metalness: 0.7 };
  const c1 = _box(0.55, 0.30, 0.45, NEUTRAL.metalDark, mat);
  c1.position.set(-0.15, -0.15, 0);
  c1.rotation.set(0.3, 0.4, 0.1);
  g.add(c1);
  const c2 = _box(0.35, 0.25, 0.35, NEUTRAL.metal, mat);
  c2.position.set(0.20, -0.05, 0.15);
  c2.rotation.set(-0.2, -0.3, 0.5);
  g.add(c2);
  const c3 = _box(0.30, 0.18, 0.28, NEUTRAL.metalDark, mat);
  c3.position.set(0.05, 0.18, -0.15);
  c3.rotation.set(0.5, 0.6, -0.2);
  g.add(c3);
  // Bent rebar/wire poking out — a thin twisted cylinder.
  const wire = _cyl(0.025, 0.6, NEUTRAL.metal, 8);
  wire.position.set(0.18, 0.10, 0.10);
  wire.rotation.set(0.6, 0, 0.4);
  g.add(wire);
  g.rotation.y = -0.4;
  return g;
}

function _buildBagOfPeas(tint) {
  const g = new THREE.Group();
  // Bulgy canvas sack with peas inside, pinched at the top.
  const sack = _sph(0.45, NEUTRAL.fabric, { roughness: 0.95 }, 14);
  sack.scale.set(1.0, 1.1, 0.9);
  sack.position.y = -0.05;
  g.add(sack);
  // Pinched neck where the bag is tied.
  const neck = _cylT(0.10, 0.20, 0.12, NEUTRAL.fabric, 12, { roughness: 0.95 });
  neck.position.y = 0.36;
  g.add(neck);
  // Tie cord.
  const tie = _torus(0.08, 0.02, 0x6a4a2a, { roughness: 0.85 }, 12, 6);
  tie.position.y = 0.42;
  tie.rotation.x = Math.PI / 2;
  g.add(tie);
  // Visible pea poking out of the cinch — gives it identity.
  for (let i = 0; i < 3; i++) {
    const pea = _sph(0.07, tint, { roughness: 0.55 }, 10);
    pea.position.set((i - 1) * 0.10, 0.46 + i * 0.02, 0.05);
    g.add(pea);
  }
  // Faded label patch sewn onto the front.
  const patch = _box(0.20, 0.18, 0.02, 0xb89860, { roughness: 0.9 });
  patch.position.set(0, -0.08, 0.40);
  g.add(patch);
  g.rotation.y = -0.3;
  return g;
}

function _buildTicket(tint) {
  const g = new THREE.Group();
  // Ticket — flat rectangular paper with a tear-stub at one end.
  const body = _box(1.10, 0.45, 0.02, tint, { roughness: 0.85, metalness: 0 });
  g.add(body);
  // Tear-stub band — perforated divider line, slightly recessed.
  const tear = _box(0.04, 0.45, 0.025, NEUTRAL.metalDark);
  tear.position.set(-0.30, 0, 0);
  g.add(tear);
  // Stub side.
  const stub = _box(0.40, 0.42, 0.025, 0xe6e0d8, { roughness: 0.85 });
  stub.position.set(-0.55, 0, 0.005);
  g.add(stub);
  // Big number printed on the main body.
  const number = _box(0.18, 0.22, 0.005, NEUTRAL.metalDark);
  number.position.set(0.20, 0.05, 0.015);
  g.add(number);
  // "BARCODE" strip on the right.
  for (let i = 0; i < 7; i++) {
    const bar = _box(0.015, 0.18, 0.004, 0x101010);
    bar.position.set(0.40 + i * 0.025, -0.1, 0.015);
    g.add(bar);
  }
  g.rotation.x = -0.4;
  g.rotation.y = -0.3;
  return g;
}

function _buildBottle(tint) {
  const g = new THREE.Group();
  // Bottle profile — wide base, neck, cap. Tinted "liquid" inside.
  const glass = _cyl(0.18, 0.55, NEUTRAL.glass, 16);
  glass.material.transparent = true;
  glass.material.opacity = 0.55;
  glass.material.roughness = 0.1;
  glass.material.metalness = 0.0;
  glass.position.y = -0.08;
  g.add(glass);
  // Liquid inside — slightly smaller cylinder, tinted.
  const liquid = _cyl(0.16, 0.42, tint, 14);
  liquid.position.y = -0.12;
  g.add(liquid);
  // Neck.
  const neck = _cylT(0.07, 0.12, 0.15, NEUTRAL.glass, 12);
  neck.material.transparent = true;
  neck.material.opacity = 0.55;
  neck.position.y = 0.30;
  g.add(neck);
  // Cap.
  const cap = _cyl(0.08, 0.06, 0xb88820, 12);
  cap.material.metalness = 0.7;
  cap.material.roughness = 0.3;
  cap.position.y = 0.42;
  g.add(cap);
  // Hand-painted label — small rectangle on the front.
  const label = _box(0.30, 0.22, 0.005, 0xece2c0, { roughness: 0.9 });
  label.position.set(0, -0.08, 0.19);
  g.add(label);
  g.rotation.y = -0.25;
  return g;
}

function _buildBiscuits(tint) {
  const g = new THREE.Group();
  // A small stack of round biscuits, each a short cylinder.
  for (let i = 0; i < 4; i++) {
    const b = _cyl(0.32, 0.10, tint, 16);
    b.position.y = -0.18 + i * 0.10;
    b.material.roughness = 0.85;
    g.add(b);
    // Glaze cross-cuts on the top biscuit only.
    if (i === 3) {
      for (let j = 0; j < 2; j++) {
        const slash = _box(0.50, 0.01, 0.04, 0xb88860);
        slash.rotation.y = j * Math.PI / 2;
        slash.position.y = b.position.y + 0.06;
        g.add(slash);
      }
    }
  }
  // Crinkly wax paper underneath, suggested by an offset disk.
  const paper = _cyl(0.42, 0.02, 0xe8d8b0, 18);
  paper.position.y = -0.30;
  paper.material.roughness = 0.95;
  g.add(paper);
  g.rotation.y = -0.3;
  return g;
}

// Per-id dispatch table — items not listed here fall through to the
// shared pouch silhouette tinted by item.tint. Keep this list short:
// only items whose name evokes a shape that's worth the pixels.
const _JUNK_BUILDERS = {
  junk_ring:           (it) => _buildRing(0xe8d4a8, it.tint),
  junk_kingring:       (it) => _buildRing(0xd4a040, 0xff5040),
  junk_skull:          (it) => _buildSkull(it.tint),
  junk_vase:           (it) => _buildVase(it.tint),
  junk_walkie:         (it) => _buildWalkie(it.tint),
  junk_radio:          (it) => _buildRadio(it.tint),
  junk_carbatt:        (it) => _buildBattery(it.tint),
  junk_scrap:          ()    => _buildScrapMetal(),
  junk_peas:           (it) => _buildBagOfPeas(it.tint),
  junk_rocket_ticket:  (it) => _buildTicket(it.tint),
  junk_fancy_alcohol:  (it) => _buildBottle(it.tint),
  junk_yummy_biscuits: (it) => _buildBiscuits(it.tint),
};

function buildJunk(item) {
  const builder = _JUNK_BUILDERS[item.id];
  if (builder) return builder(item);
  // Default: tinted canvas pouch. Generic, signals "loot to fence".
  return _buildGenericPouch(item.tint ?? 0x808080);
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

// Throwable thumbnail — short metal cylinder (grenade body) with a
// flat colored square decal on the front face that reads as the
// throwable's tint at thumbnail size. Distinct from junk + consumable
// silhouettes so the inventory grid clearly tells throwables apart.
function buildThrowable(item) {
  const tint = item.tint ?? 0x60a040;
  const g = new THREE.Group();
  // Body — short upright cylinder, neutral metal so the colored face
  // pops against it.
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.78, 18),
    new THREE.MeshStandardMaterial({
      color: NEUTRAL.metalDark, roughness: 0.55, metalness: 0.55,
    }),
  );
  body.position.y = 0;
  g.add(body);
  // Top cap (slight ridge so it reads as a grenade not a can).
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.20, 0.20, 0.10, 14),
    new THREE.MeshStandardMaterial({
      color: NEUTRAL.metal, roughness: 0.4, metalness: 0.65,
    }),
  );
  cap.position.y = 0.44;
  g.add(cap);
  // Camera-facing colored decal — flat box hugging the cylinder's
  // front surface (camera looks roughly along +Z so we push toward +Z).
  const decal = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.46, 0.04),
    new THREE.MeshStandardMaterial({
      color: tint, roughness: 0.45, metalness: 0.10,
      emissive: tint, emissiveIntensity: 0.30,
    }),
  );
  decal.position.set(0, 0, 0.36);
  g.add(decal);
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
  if (item.type === 'throwable')  return buildThrowable(item);
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
  if (item.type === 'throwable')  return `thr:${item.id || item.name}:${tint}`;
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
