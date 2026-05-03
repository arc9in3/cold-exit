// Jointed actor rig — replaces the old two-box torso/head built inline in
// gunman.js / melee_enemy.js / player.js. Every actor gets the same
// skeleton so procedural animation (walk cycle, aim IK, recoil, death
// fall, hit flinch) can drive any of them uniformly.
//
// Hierarchy (everything is a THREE.Group unless noted — groups are
// rotation pivots; the visible block is a child Mesh whose centre sits
// *inside* the parent group). Pivot positions are chosen so rotating a
// joint produces a natural motion: thighs rotate around the hip, calves
// around the knee, forearms around the elbow, etc.
//
//   root (group at feet level)
//   └─ hips                       y=0.92  · pivot for whole-body lean
//      ├─ leftThigh   (pivot)     x=-0.22, y=0.02
//      │  └─ thighMesh             (centre y=-0.28, h=0.56, zone='leg')
//      │  └─ leftKnee   (pivot)   y=-0.58
//      │     └─ calfMesh           (centre y=-0.26, h=0.52, zone='leg')
//      │     └─ leftAnkle (pivot) y=-0.54
//      │        └─ footMesh        (box 0.28×0.12×0.36, zone='leg')
//      ├─ rightThigh (mirror)
//      ├─ stomach                  y=0.22  · pivot for torso sway
//      │  └─ stomachMesh           (zone='torso')
//      │  └─ chest                 y=0.22  · pivot for aim/recoil twist
//      │     └─ chestMesh          (zone='torso')
//      │     ├─ leftShoulder       x=-0.38, y=0.18 · pivot for arm swing/aim
//      │     │  └─ upperArmMesh    (zone='arm')
//      │     │  └─ leftElbow       y=-0.36
//      │     │     └─ forearmMesh  (zone='arm')
//      │     │     └─ leftWrist    y=-0.32
//      │     │        └─ handMesh  (zone='arm')
//      │     ├─ rightShoulder (mirror, weapon parented here via opts)
//      │     └─ neck               y=0.32 · pivot for head turn
//      │        └─ neckMesh
//      │        └─ head            y=0.14 · pivot for head yaw/pitch
//      │           └─ headMesh     (zone='head')
//
// `buildRig(opts)` returns a descriptor bag with every named joint and
// every mesh so callers can look up `rig.rightShoulder`, `rig.head`,
// `rig.torso` (alias of chest), `rig.group`, etc.
//
// All magic numbers that control the rig's proportions live in
// DEFAULT_DIMS below. Callers can override any subset via `opts.dims`
// (deep-merged). The tuner in tools/rig_tuner.html drives these live.

import * as THREE from 'three';

// Shared 3-step toon gradient — the same tone ramp as the imported
// cel-shaded models in gltf_cache so the primitive actors match the
// FBX props visually. Created once, reused by every material.
let _toonGradient = null;
function toonGradient() {
  if (_toonGradient) return _toonGradient;
  const data = new Uint8Array([90, 180, 255]);  // 3 steps
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _toonGradient = tex;
  return tex;
}

// Helper: MeshToonMaterial gives us cel-shading that matches the rest
// of the game. Passing `opts.toon = false` falls back to standard PBR
// for debug views or when toon shading is explicitly disabled.
function makeMat(color, toon) {
  if (toon) {
    return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
  }
  return new THREE.MeshStandardMaterial({ color, roughness: 0.78 });
}

// =====================================================================
// Geometry cache — every gunman / dummy / NPC built through buildRig
// previously allocated ~36 fresh BufferGeometries. With 20+ enemies on
// late-game floors that's hundreds of buffers + uploads + bounding-box
// computes per spawn. Since every rig built with the same dims is
// pixel-identical, we hash the constructor arguments and reuse the
// underlying buffer across actors.
//
// `geometry.dispose()` would now be unsafe (other rigs share the
// buffer); the rig disposes its meshes via group removal in
// gunmen.removeAll without calling geometry.dispose, so we don't break
// existing teardown.
//
// Keys are stable string concatenations of the constructor args. No
// floating-point matching is needed because dims are derived from the
// same DEFAULT_DIMS scaled by the same `opts.scale` for every gunman.
// =====================================================================
const _geomCache = new Map();
function _stamp(g) {
  // Mark every cached buffer so traversal-based disposal loops
  // (gunmen.removeAll, melees.removeAll, encounter teardown) can skip
  // them. Disposing a shared buffer would break every other actor
  // holding a reference + the cache itself.
  g.userData = g.userData || {};
  g.userData.sharedRigGeom = true;
  return g;
}
function _cyl(topR, botR, h, segs = 12, openEnded = false, ts = 0, tl = Math.PI * 2) {
  const k = `cyl|${topR}|${botR}|${h}|${segs}|${openEnded?1:0}|${ts}|${tl}`;
  let g = _geomCache.get(k);
  if (!g) {
    g = _stamp(new THREE.CylinderGeometry(topR, botR, h, segs, 1, openEnded, ts, tl));
    _geomCache.set(k, g);
  }
  return g;
}
function _sph(r, ws = 10, hs = 8) {
  const k = `sph|${r}|${ws}|${hs}`;
  let g = _geomCache.get(k);
  if (!g) {
    g = _stamp(new THREE.SphereGeometry(r, ws, hs));
    _geomCache.set(k, g);
  }
  return g;
}
function _box(w, h, d) {
  const k = `box|${w}|${h}|${d}`;
  let g = _geomCache.get(k);
  if (!g) {
    g = _stamp(new THREE.BoxGeometry(w, h, d));
    _geomCache.set(k, g);
  }
  return g;
}

// Darken a hex colour by `k` (0..1). Used to derive a default gear
// accent colour from the body colour when the caller doesn't supply
// one — so we always get *some* contrast between the body and its
// gear sections without every caller needing to set both.
function _darken(hex, k) {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const m = 1 - k;
  return ((r * m) << 16) | ((g * m) << 8) | (b * m | 0);
}

// Build a single body-part "segment": a pivot group plus an offset
// child mesh. The pivot sits at the joint (shoulder/hip/knee), the
// mesh extends outward so rotating the pivot swings the segment.
// Per-end Z taper helper — when topDepth and botDepth differ from
// the cylinder's uniform mesh.scale.z, deform the geometry so each
// vertex's Z gets a per-Y depth multiplier. Top and bottom of the
// cylinder end up at different oval depths. Skipped (no-op) when
// topDepth and botDepth are both undefined or equal to each other,
// since uniform mesh.scale.z handles that case cheaply.
//
// IMPORTANT: this mutates the mesh's geometry, so the geometry must
// be a fresh instance (not a shared cached _cyl call). _cyl passes
// through to THREE.CylinderGeometry which is allocated per-call, so
// this is safe in practice.
function applyPerEndDepthIfDifferent(mesh, topDepth, botDepth, h) {
  if (topDepth == null && botDepth == null) return;
  if (topDepth == null) topDepth = botDepth;
  if (botDepth == null) botDepth = topDepth;
  if (Math.abs(topDepth - botDepth) < 1e-4) {
    // Equal — uniform; let mesh.scale.z handle it instead.
    mesh.scale.z = topDepth;
    return;
  }
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = Math.max(0, Math.min(1, (y + h / 2) / h));   // 0 at bot, 1 at top
    const d = botDepth + (topDepth - botDepth) * t;
    pos.setZ(i, pos.getZ(i) * d);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  mesh.scale.z = 1.0;
}

function segment(opts) {
  const pivot = new THREE.Group();
  pivot.position.set(opts.px || 0, opts.py || 0, opts.pz || 0);
  const mesh = new THREE.Mesh(_box(opts.w, opts.h, opts.d), opts.material);
  mesh.position.set(opts.mx || 0, opts.my, opts.mz || 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (opts.zone) mesh.userData.zone = opts.zone;
  pivot.add(mesh);
  return { pivot, mesh };
}

// Tapered cylindrical segment — like `segment` but uses a cylinder
// that narrows from `topR` at the joint to `botR` at the far end.
// Reads way less boxy than a rectangular block while still matching
// the game's low-poly primitive aesthetic (10-14 radial segments).
// Pivot is at the joint; mesh extends DOWN so rotating the pivot
// swings the limb out (matches the existing limb hierarchy which
// writes negative rotations to pitch forward).
function taperedSegment(opts) {
  const pivot = new THREE.Group();
  pivot.position.set(opts.px || 0, opts.py || 0, opts.pz || 0);
  const mesh = new THREE.Mesh(
    _cyl(opts.topR, opts.botR, opts.h, opts.segs || 12),
    opts.material,
  );
  // Cylinder geometry is Y-centered by default; shift down so the
  // TOP of the cylinder sits at y=0 (joint) and the bottom at y=-h.
  mesh.position.set(opts.mx || 0, -(opts.h / 2), opts.mz || 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (opts.zone) mesh.userData.zone = opts.zone;
  pivot.add(mesh);
  return { pivot, mesh };
}

// Joint sphere helper — small sphere placed at a joint pivot so the
// limb connects smoothly to the torso / next segment instead of
// showing a hard cylinder step.
function jointSphere(radius, material, zone) {
  // Sphere segs bumped for the anatomical-curves pass — joint bulges
  // are visible at the limb-torso transition and the previous 10×8
  // tessellation read as faceted at iso. 24×16 reads as a smooth
  // organic blend.
  const mesh = new THREE.Mesh(_sph(radius, 24, 16), material);
  // Joint bulges are always tiny accessory blobs that fill the gap
  // between two limb segments — disable shadow casting since they
  // don't change the silhouette and Three.js's shadow pass renders
  // every cast-shadow mesh twice (shadow map + main scene). With 20
  // actors × 4 joint bulges that's ~80 redundant shadow draws/frame.
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  if (zone) mesh.userData.zone = zone;
  return mesh;
}

// === Rig dimensions =====================================================
// All values are pre-scale (multiply by opts.scale for world units).
// Keys flagged `* chestH` / `* thighH` etc. are RELATIVE MULTIPLIERS —
// their final value depends on the segment height. That way tweaking a
// height slider automatically reflows children (chest plate, shoulder
// anchor, wrist cuff, etc.) instead of requiring two coordinated edits.
export const DEFAULT_DIMS = {
  hipY: 1.1,
  // segs values are tuned for "intentionally low-poly, not amateur":
  // each visible cylinder has just enough sides to read as a smooth
  // curve without revealing tessellation at the silhouette. Torso 24 +
  // limbs 16 + neck 16 hits that sweet spot. Bumping further has no
  // visible payoff at game render scale.
  torso: {
    // Pushed up so the silhouette polygon edges disappear at iso /
    // mid-distance render scales. 48 is essentially free perf-wise on
    // a single torso cylinder per actor; bumping further has no
    // visible payoff. Joint spheres + limbs follow suit elsewhere.
    segs: 48,
    depthRatio: 0.72,
    // V-taper silhouette — wider top, narrower waist. Bumped chestTopR
    // and slimmed chestBotR so the cylinder reads with shoulders-out
    // and a defined waistline. Hip cylinder slightly slimmed to match.
    pelvisH: 0.17, pelvisTopR: 0.18, pelvisBotR: 0.21, pelvisY: 0.12,
    // Crotch wedge — small downward-tapering cylinder filling the
    // inverted-V gap between pelvis bottom and the inner-thigh tops.
    // Top (crotchTopR) should roughly match the inner-edge of the
    // pelvis bottom; bottom (crotchBotR) tapers to just enough to
    // sit between the inner thigh surfaces. Set crotchH to 0 to
    // disable. crotchX / crotchY / crotchZ position the wedge
    // within the hips group (m, scaled by rig.scale).
    crotchTopR: 0.13, crotchBotR: 0.07, crotchH: 0.06,
    crotchX: 0, crotchY: 0.005, crotchZ: 0,
    stomachH: 0.235, stomachTopR: 0.24, stomachBotR: 0.18, stomachY: 0.22,
    // Single chest cylinder. The ribs split was an experiment that
    // added complexity without payoff — torso reads as one taper
    // anyway and the seam was just one more thing to align. Reverted
    // to the original chestH so this DIM block matches all the legacy
    // call sites.
    chestH: 0.345, chestTopR: 0.32, chestBotR: 0.22,
    collarH: 0.055, collarTopR: 0.11, collarBotR: 0.32, collarDY: 0.057,
    // Bottom radius lifted from 0.22 → 0.28 so the cone tapers less
    // aggressively — the previous value created a visible polygon ring
    // at the bottom edge that read as a row of triangle teeth at iso
    // angles. With less taper + more segments (see chestPlate build)
    // the rim reads as a smooth curve.
    chestPlateTopR: 0.34, chestPlateBotR: 0.28,
    chestPlateH: 0.34, chestPlateYK: 0.55, // * chestH
    beltR: 0.24, beltH: 0.09, beltY: 0.015,
    // Trapezius wedge — flattened sphere mounted at the top of the
    // chest cylinder, parented to chest.pivot so it follows torso
    // pitch/twist. Bridges the visual gap between the shoulder line
    // and the neck base; without it the shoulders look like two
    // pegged-on spheres at the corners of a flat chest top.
    trapezius: { r: 0.20, y: 0.34, z: 0, scaleY: 0.40, scaleX: 1.50, scaleZ: 1.00 },
  },
  legs: {
    hipX: 0.18, hipJointY: 0.002,
    thighH: 0.42, thighTopR: 0.135, thighBotR: 0.095,
    calfH: 0.59, calfTopR: 0.10, calfBotR: 0.075,
    footH: 0.08, footW: 0.16, footD: 0.30, footZ: 0.06,
    hipBulgeR: 0.14,
    kneeBulgeR: 0.11,
    kneePadW: 0.20, kneePadH: 0.11, kneePadD: 0.11, kneePadZ: 0.065,
    thighRigW: 0.06, thighRigH: 0.18, thighRigD: 0.22,
    thighRigX: 0.11, thighRigYK: 0, // * thighH
    bootTopR: 0.10, bootTopH: 0.08, bootTopYK: -0.9, // * calfH
    // Ankle blend — small sphere at the ankle pivot bridging the calf
    // bottom into the boot top. Parented to the ankle Group so it
    // moves with the foot during walks. Fills the visible gap that
    // showed up after the foot box → rounded boot swap.
    ankleBlend: { r: 0.08, scaleY: 0.7 },
    // Glute-thigh bridge — small body-color sphere on the upper-back
    // of the thigh top, parented to thigh.pivot so it tracks leg
    // motion. Visible when the leg is planted (fills the seam between
    // glute and thigh) and naturally swings out of view when the leg
    // lifts. Important for keeping the back-of-rig coherent during
    // walk + dash.
    gluteThighBlend: { r: 0.10, yK: 0.05, z: -0.06, scaleZ: 0.85, scaleY: 0.70 },
  },
  arms: {
    // Shoulders pushed outboard for the V-silhouette. Bigger
    // shoulderBulge + shoulderPad reads as muscled / armored.
    shoulderInset: 0.34, shoulderYK: 0.80, // * chestH
    upperArmH: 0.35, upperArmTopR: 0.105, upperArmBotR: 0.08,
    forearmH: 0.30, forearmTopR: 0.09, forearmBotR: 0.065,
    shoulderBulgeR: 0.15,
    elbowBulgeR: 0.08,
    // Pauldron — sized to sit *on* the deltoid, not swallow it. Was 0.18
    // (read bigger than the head from front-3/4); 0.11 keeps the
    // armoured-shoulder read without the visor-helmet-pauldron silhouette.
    shoulderPadR: 0.11,
    wristCuffR: 0.075, wristCuffH: 0.07, wristCuffYK: -0.9, // * forearmH
    handW: 0.12, handH: 0.12, handD: 0.16, handY: -0.06,
    // Bicep bulge — flattened sphere mid-upper-arm, parented to
    // shoulder.pivot so it follows the arm. Subtle by default;
    // archetype overrides push it bigger for male / smaller for
    // female. Sells "this arm has muscle" instead of reading as
    // a tube of pixels.
    bicep: { r: 0.10, yK: 0.45, z: 0.04, scaleY: 0.85, scaleX: 1.05, scaleZ: 1.10 },
  },
  rifleAnchor: {
    x: 0.23, yK: 0.82, z: 0.04, // yK * chestH
  },
  head: {
    // Neck lengthened (0.185 → 0.22) + head raised (0.125 → 0.14) so
    // there's a visible neck segment between the chest cap and the
    // cranium. Previously the head sat directly on the chest plate /
    // collar and read Lego-figure-ish.
    neckTopR: 0.08, neckBotR: 0.09, neckH: 0.22, neckMeshY: 0.09,
    headY: 0.14,
    craniumR: 0.15, craniumStretchY: 1.15, craniumStretchZ: 1.05, craniumY: 0.18,
    jawW: 0.075, jawH: 0.10, jawD: 0.22, jawY: 0.06,
  },
};

// Female (Eve-coded) overrides — anime-stylized hourglass: dramatic
// waist pinch, hips wider than shoulders, longer legs proportionally,
// slimmer arms + smaller hands + smaller head, longer neck, plus new
// bust / glute / hair-volume blocks the build pipeline keys off when
// they exist. Apply with mergeDims(DEFAULT_DIMS, DEFAULT_DIMS_FEMALE).
export const DEFAULT_DIMS_FEMALE = {
  hipY: 1.24,   // taller stance to match longer legs (thigh+calf+foot)
  torso: {
    pelvisH: 0.22,
    pelvisTopR: 0.30,    // wide iliac crest
    pelvisBotR: 0.18,    // narrow pubic bone
    // Single tapered chest cylinder. Seam-matched at the bottom to
    // stomachTopR so chest + stomach read as one continuous taper
    // from shoulder to waist.
    stomachH: 0.26,
    stomachTopR: 0.18,
    stomachBotR: 0.11,   // wasp waist
    chestH: 0.34,
    chestTopR: 0.27,
    chestBotR: 0.18,
    chestPlateTopR: 0.29,
    chestPlateBotR: 0.20,
    // Collar + belt SKIPPED on female: the bodyshapes ref shows a
    // clean torso with no visible accent bands. Build code guards on
    // collarH > 0 / beltH > 0 — setting these to 0 hides the meshes.
    collarH: 0,
    beltH: 0,
    // Per-segment depth ratios — torso isn't uniformly thick front-to-
    // back. Ribcage at chest level has flatter front (eve refs show
    // chest plane is relatively flat, the bust does the forward
    // projection). Waist pinches on Z too. Pelvis projects forward
    // and back per the wedge shape refs show.
    // Matched depths so chest + stomach read as one continuous torso.
    chestDepth:   0.70,
    stomachDepth: 0.70,
    pelvisDepth:  0.82,
    // Crotch wedge — bridges the pelvis bottom to the inward-attached
    // legs. Sized for the wider female pelvis.
    crotchTopR: 0.20, crotchBotR: 0.11, crotchH: 0.08,
    crotchY: 0.005, crotchZ: 0,
    // Hip bowl — primary pelvis volume per anatomy refs. Wedge shape:
    // wider at iliac (top), narrower at pubic (bottom), 6° forward
    // pitch (sacrum higher than pubis). This single primitive replaces
    // the messy stack of pelvis cylinder + iliac shelves + hipFront +
    // small glute spheres that the prior iteration was using.
    hipBowl: {
      r: 0.30, y: -0.05, z: 0,
      scaleX: 1.00, scaleY: 0.58, scaleZ: 0.90,
      pitchX: 0.10,
      // Bottom factor widened (was 0.62) so the bowl bottom matches
      // the leg attach width — without this the thighs popped out
      // INSIDE the bowl footprint at full width and a visible step
      // formed at the hipBowl/thigh seam. 0.85 closes that step
      // while keeping the iliac-to-pubic narrowing the refs show.
      wedgeTopFactor: 1.00,
      wedgeBotFactor: 0.85,
    },
    // PRUNED for the simplification pass: hipFront, pec, lumbar,
    // upperAbdomen, lowerAbdomen, trapezius. The hipBowl + bust +
    // chest cylinder + bob now do the silhouette work these were
    // patching. Each was a small subtle primitive that wasn't
    // reading clearly and was adding visual noise / clipping.
    hipFront: null,
    pec: null,
    lumbar: null,
    upperAbdomen: null,
    lowerAbdomen: null,
    trapezius: null,
    // Abdomen lobe stripped — chest + stomach cylinder taper does the
    // torso curve work; the small front lobe was just adding a seam.
    abdomen: null,
    // Abdomen split into upper + lower lobes so the boundary between
    // them reads as the implicit navel / abs definition line. Without
    // shader tricks we can't draw a recessed line; stacking two lobes
    // with a soft seam between them creates the visual cue.
    upperAbdomen: { r: 0.085, y: 0.04, z: 0.12, scaleY: 1.0, scaleX: 1.0, scaleZ: 0.6 },
    lowerAbdomen: { r: 0.080, y: -0.10, z: 0.11, scaleY: 0.9, scaleX: 1.0, scaleZ: 0.55 },
    // Pec lobe — wider + slightly taller so it bridges UNDER the bust
    // spheres like an underwire shelf. Bust will sit ON this lobe
    // and merge at the bottom curve, reading as a continuous chest
    // contour instead of two stuck-on lumps over a flat plate.
    pec: { r: 0.11, y: 0.16, z: 0.19, scaleY: 0.65, scaleX: 1.50, scaleZ: 1.00 },
    // Trapezius — narrower wedge for female (smaller shoulder line).
    trapezius: { r: 0.15, y: 0.30, z: 0, scaleY: 0.40, scaleX: 1.30, scaleZ: 1.00 },
    // Lower-back / lumbar curve — soft body-color lobe at the back of
    // the chest-bottom that arcs INTO the glute curves below. Without
    // this the spine area reads as a vertical line; with it the back
    // has an S-curve from shoulder blades down through lumbar to glutes.
    lumbar: { r: 0.10, y: -0.16, z: -0.12, scaleY: 0.7, scaleX: 1.4, scaleZ: 0.7 },
  },
  legs: {
    // Legs pulled inward so they descend from directly under the glute
    // mass instead of attaching at the wider iliac crest. Anatomically
    // the femur head is inside the hip bone.
    hipX: 0.13,
    thighH: 0.54,        // longer legs (push for the eve-ratio look)
    thighTopR: 0.13,     // top retains volume so iliac shelf seamless
    thighBotR: 0.075,    // tapers tighter at the knee
    calfH: 0.70,         // longer + tapered
    calfTopR: 0.082,
    calfBotR: 0.045,     // very narrow at ankle (athletic calf taper)
    footH: 0.05,         // smaller heeled foot
    footW: 0.11,
    footD: 0.24,
    footZ: 0.07,         // toe pushed forward (heeled stance)
    hipBulgeR: 0.20,     // big iliac-to-thigh bridge sphere
    kneeBulgeR: 0.08,
    kneePadW: 0.15, kneePadH: 0.08, kneePadD: 0.08,
    // Glute volume — repositioned as the BACK PROJECTION of the
    // pelvis wedge (per anatomy refs which show glutes as part of the
    // pelvis silhouette, not separate spheres). Higher Y so they
    // attach to the upper-back of the wedge; bigger Z so the back
    // curve projects out where the wedge bottom would otherwise just
    // taper to nothing.
    glute: { r: 0.13, separationX: 0.11, y: -0.04, z: -0.14, scaleY: 0.80, scaleZ: 1.00 },
    // PRUNED for the simplification pass — the hipBowl wedge handles
    // the hip-to-thigh transition without needing these tiny bridge
    // spheres, which weren't reading at viewing scale and were just
    // adding clipping noise.
    iliacShelf: null,
    gluteThighBlend: null,
    kneeBridge: null,
    calfFlex: null,
    ankleBlend: null,
    // Gear overlays stripped from the female default — bodyshapes ref
    // shows clean wedge segments + circle joints, no armor accents.
    // Setting these to 0 makes the build skip the meshes (build code
    // guards on > 0 thresholds). Gear can be re-added per-actor via
    // opts.dims overrides if a particular female actor wears armor.
    kneePadW: 0, kneePadH: 0, kneePadD: 0,
    thighRigW: 0, thighRigH: 0, thighRigD: 0,
    bootTopR: 0, bootTopH: 0,
    // Glute-thigh bridge — fills the deeper curve between the
    // pronounced glute and the longer thigh.
    gluteThighBlend: { r: 0.14, yK: 0.06, z: -0.09, scaleZ: 0.85, scaleY: 0.78 },
    // Knee bridge — body-color sphere at the knee joint that bridges
    // the thigh-bottom narrowing into the calf-top widening. Without
    // it the seam is visible from the side at every knee bend; with
    // it the leg reads as one continuous curve through the joint.
    kneeBridge: { r: 0.08, scaleY: 0.7, scaleZ: 1.0 },
    // Calf flex lobe — soft body-color sphere on the back of the calf
    // mid-segment, parented to the calf so it follows leg motion.
    // Sells the natural calf bulge that a uniform tapered cylinder
    // can't.
    calfFlex: { r: 0.08, yK: 0.45, z: -0.04, scaleY: 1.4, scaleZ: 0.9 },
    // Heel block — small body-color box at the back of the boot that
    // raises the heel to read as a heeled boot rather than a flat
    // tactical boot. Parented to the foot pivot so it stays glued to
    // the boot in motion.
    heel: { w: 0.06, h: 0.06, d: 0.05, y: -0.03, z: -0.08 },
  },
  arms: {
    shoulderInset: 0.32,    // shoulder width pulled outboard a notch
    // Arms substantially longer per user feedback ("arms collapsed
    // onto shoulders, not arms spread out"). Female arms inherit
    // male-default 0.35/0.30 length unless overridden, and the
    // narrower female frame made them read truncated. Pushing well
    // past anatomical for visual readability — armspan now ~30%
    // greater than height which is comic-style but reads correctly
    // at game scale.
    upperArmH: 0.52,
    forearmH: 0.45,
    upperArmTopR: 0.085,
    upperArmBotR: 0.065,
    forearmTopR: 0.07,
    forearmBotR: 0.05,
    shoulderBulgeR: 0.10,
    shoulderPadR: 0.085,
    elbowBulgeR: 0.06,
    wristCuffR: 0.055, wristCuffH: 0.06,
    handW: 0.09, handH: 0.10, handD: 0.13,
    // Bicep pruned for female — slim arms read clean as tapered
    // cylinders + visible elbow joint, no extra muscle lobe needed.
    bicep: null,
    // Gear overlays stripped from female default per bodyshapes ref.
    shoulderPadR: 0,
    wristCuffR: 0, wristCuffH: 0,
  },
  head: {
    neckH: 0.26,            // longer neck
    neckTopR: 0.06,
    neckBotR: 0.07,
    craniumR: 0.13,         // smaller head — anime proportions
    craniumStretchY: 1.10,
    jawW: 0.06, jawH: 0.08, jawD: 0.18,
    // Bust geometry — two flattened spheres on the chest plate. Pushed
    // up + forward and given more volume to match the prominent eve
    // silhouette. scaleZ > 1 projects the bust further forward; scaleY
    // < 1 keeps the lobes from looking spherical (they should read
    // hemispherical against the chest plate).
    bust: { r: 0.115, separationX: 0.085, y: 0.18, z: 0.21, scaleY: 0.85, scaleZ: 1.15 },
    // Bob hair — 5-primitive structured cut. Spheres for the rounded
    // top, cylinders for the flat-bottomed body so the chin-length
    // cut reads as a clean horizontal line (not a tapered curve).
    // Plus a fringe slab across the brow.
    //   crown    — sphere top-half only (dome) on cranium top
    //   back     — vertical cylinder behind head, flat top + bottom
    //   sideL/R  — vertical cylinders flanking face, flat bottoms
    //              along the chin/jaw line (the "cut edge")
    //   fringe   — thin horizontal slab across the brow for bangs
    // Cylinders are open-ended at the top so the crown dome blends in
    // without revealing a hard ring at the crown seam.
    bob: {
      crown:  { r: 0.17, scaleX: 1.05, scaleY: 0.55, scaleZ: 1.05, y: 0.18, z: -0.01 },
      back:   { topR: 0.135, botR: 0.155, h: 0.30, y: 0.03, z: -0.07 },
      side:   { topR: 0.06, botR: 0.075, h: 0.30, x: 0.135, y: 0.03, z: 0.02 },
      fringe: { w: 0.27, h: 0.06, d: 0.06, y: 0.18, z: 0.13 },
    },
  },
};

// Male (operator-coded) — currently a no-op overlay; the default DIMS
// already encode male proportions. Kept as an explicit slot so callers
// can pass `archetype: 'male'` symmetrically with `'female'` and so
// future tuning has a clean home (operator bicep / pec adjustments).
export const DEFAULT_DIMS_MALE = {
  // intentionally minimal — defaults already represent the male/operator
  // grounded build per the maleref design.
};

// Deep-merge `override` into `base`. Objects recurse; scalars and
// arrays are replaced wholesale.
function mergeDims(base, override) {
  if (!override) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(override)) {
    const ov = override[k];
    const bv = base?.[k];
    if (bv !== null && typeof bv === 'object' && !Array.isArray(bv) &&
        ov !== null && typeof ov === 'object' && !Array.isArray(ov)) {
      out[k] = mergeDims(bv, ov);
    } else {
      out[k] = ov;
    }
  }
  return out;
}

export function buildRig(opts = {}) {
  const scale = opts.scale ?? 1.0;
  const toon = opts.toon !== false;
  // Sex / archetype variant — picks a DIM overlay before opts.dims is
  // applied. opts.sex='female' merges DEFAULT_DIMS_FEMALE first, opts.sex
  // === 'male' is a no-op overlay (defaults already represent the male
  // build). Caller's opts.dims still wins on top so per-actor tuning is
  // unaffected. Default sex === 'male'.
  const sex = opts.sex === 'female' ? 'female' : 'male';
  const archetypeDims = sex === 'female' ? DEFAULT_DIMS_FEMALE : DEFAULT_DIMS_MALE;
  const dims = mergeDims(mergeDims(DEFAULT_DIMS, archetypeDims), opts.dims);

  const bodyColor = opts.bodyColor ?? 0x3a4048;
  const headColor = opts.headColor ?? 0xc39066;
  const legColor  = opts.legColor  ?? 0x1f2328;
  const armColor  = opts.armColor  ?? bodyColor;
  const handColor = opts.handColor ?? 0xcba07a;
  // Gear accent colour — used for chest plate, shoulder pads, wrist
  // cuffs, thigh rig, and boot tops so actors read as "body + kit"
  // rather than a single uniform silhouette. Defaults to a darker
  // version of bodyColor so there's always some contrast even when
  // the caller doesn't set it explicitly.
  const gearColor = opts.gearColor ?? _darken(bodyColor, 0.55);
  const bootColor = opts.bootColor ?? 0x1a1510;
  // Accent — used by signature primitives (visor, eye-line, glow strip).
  // Defaults to the project's accent-gold so any caller that opts into a
  // visor without specifying a colour still gets a coherent look.
  const accentColor = opts.accentColor ?? 0xf2c060;
  // Signature accent — used for the asymmetric strap/bandolier so the
  // protagonist's signature prop can wear a character color (red on
  // the femme fatale, gold on the operator, etc.). Defaults to gear
  // color so existing rigs that don't set it stay un-tinted.
  const signatureColor = opts.signatureColor ?? null;
  // Hair gets its own colour so a female-with-bob can have black hair
  // riding on a dark-grey body without the bob disappearing into the
  // body silhouette. Defaults to bodyColor so existing rigs that don't
  // set a hairColor continue to render the same.
  const hairColor = opts.hairColor ?? bodyColor;
  // Per-actor bust + glute scaling so the rig_tuner / character
  // creator can sweep size variants without touching DIMS. 1.0 leaves
  // the dim-driven defaults; 0.6 → smaller; 1.4 → fuller. Applied
  // multiplicatively to the radius and projection scales.
  const bustScale = opts.bustScale ?? 1.0;
  const gluteScale = opts.gluteScale ?? 1.0;

  const accentMat = (() => {
    // Accent uses unlit-ish basic so glow elements (visor, strip) read
    // emissive without needing post-processing. Toon fallback when unlit
    // doesn't fit a project — for now, basic.
    const m = new THREE.MeshBasicMaterial({ color: accentColor });
    return m;
  })();
  const hairMat = makeMat(hairColor, toon);
  const signatureMat = signatureColor != null ? makeMat(signatureColor, toon) : null;
  const bodyMat = makeMat(bodyColor, toon);
  const headMat = makeMat(headColor, toon);
  const legMat  = makeMat(legColor,  toon);
  const armMat  = makeMat(armColor,  toon);
  const handMat = makeMat(handColor, toon);
  const gearMat = makeMat(gearColor, toon);
  const bootMat = makeMat(bootColor, toon);

  const group = new THREE.Group();

  // --- hips (whole-body lean pivot) ---
  const hips = new THREE.Group();
  hips.position.y = dims.hipY * scale;
  // YXZ so pitch (rotation.x) is applied in the bone's LOCAL frame
  // after yaw — otherwise crouching leans the body along WORLD X,
  // which only drops the muzzle downward when the character is
  // facing along +Z. Facing off-axis preserved the horizontal
  // because world-X pitch doesn't affect vectors aligned with world X.
  hips.rotation.order = 'YXZ';
  group.add(hips);

  // --- legs ---
  const L = dims.legs;
  const thighH = L.thighH * scale;
  const calfH  = L.calfH * scale;
  const footH  = L.footH * scale;

  const mkLeg = (side) => {
    const sign = side === 'left' ? -1 : 1;
    // Thigh — tapered cylinder, wider at hip, narrower at knee.
    const thigh = taperedSegment({
      px: sign * L.hipX * scale, py: L.hipJointY * scale, pz: 0,
      topR: L.thighTopR * scale, botR: L.thighBotR * scale, h: thighH,
      segs: 24,
      material: legMat, zone: 'leg',
    });
    // Hip-joint sphere caps the tapered cylinder cleanly against
    // the torso.
    const hipBulge = jointSphere(L.hipBulgeR * scale, legMat, 'leg');
    thigh.pivot.add(hipBulge);

    // Glute-thigh blend — body-color sphere on the upper-back of the
    // thigh. Parented to thigh.pivot so it tracks leg motion: visible
    // when the leg is planted (fills the seam between glute and
    // thigh) and naturally swings out of view when the leg lifts.
    if (L.gluteThighBlend) {
      const GTB = L.gluteThighBlend;
      const blendMesh = new THREE.Mesh(_sph(GTB.r * scale, 24, 16), bodyMat);
      blendMesh.scale.set(GTB.scaleX ?? 1.0, GTB.scaleY ?? 1.0, GTB.scaleZ ?? 1.0);
      blendMesh.position.set(0, -GTB.yK * thighH, GTB.z * scale);
      blendMesh.castShadow = false;
      blendMesh.userData.zone = 'leg';
      thigh.pivot.add(blendMesh);
    }
    // Thigh rig — small gear-coloured pouch on the outer thigh.
    // Rounded silhouette reads softer than the previous flat box;
    // sphere scaled to a wedge sits flush against the thigh cylinder.
    // Gear overlay — skipped when dim is zero (female bodyshapes-style
    // clean default). Re-enabled for actors wearing leg gear.
    let thighRig = null;
    if (L.thighRigW > 0 && L.thighRigH > 0) {
      thighRig = new THREE.Mesh(_sph(0.5, 24, 16), gearMat);
      thighRig.scale.set(L.thighRigW * scale * 1.2, L.thighRigH * scale, L.thighRigD * scale);
      thighRig.position.set(sign * L.thighRigX * scale, L.thighRigYK * thighH, 0);
      thighRig.castShadow = false;
      thighRig.userData.zone = 'leg';
      thigh.pivot.add(thighRig);
    }

    const knee = new THREE.Group();
    knee.position.y = -thighH;
    thigh.pivot.add(knee);
    // Knee sphere — smooth bend between thigh and calf.
    const kneeBulge = jointSphere(L.kneeBulgeR * scale, legMat, 'leg');
    knee.add(kneeBulge);

    // Knee bridge — body-color sphere at the knee joint that bridges
    // the thigh-bottom narrowing into the calf-top widening. Without
    // it the seam reads as a hard polygon ring at every knee bend.
    if (L.kneeBridge) {
      const KB = L.kneeBridge;
      const bridgeMesh = new THREE.Mesh(_sph(KB.r * scale, 24, 16), legMat);
      bridgeMesh.scale.set(KB.scaleX ?? 1.0, KB.scaleY ?? 1.0, KB.scaleZ ?? 1.0);
      bridgeMesh.position.set(0, 0, 0);
      bridgeMesh.castShadow = false;
      bridgeMesh.userData.zone = 'leg';
      knee.add(bridgeMesh);
    }
    // Knee pad — round dome over the front of the joint. Sphere
    // geometry scaled into a flat oval cap reads softer than the
    // previous boxy plate; the cel-shading band wraps around the
    // curve instead of breaking on a hard edge.
    let kneePad = null;
    if (L.kneePadW > 0 && L.kneePadH > 0) {
      kneePad = new THREE.Mesh(_sph(0.5, 24, 16), gearMat);
      kneePad.scale.set(L.kneePadW * scale, L.kneePadH * scale, L.kneePadD * scale * 1.5);
      kneePad.position.set(0, 0, L.kneePadZ * scale);
      kneePad.castShadow = false;
      kneePad.userData.zone = 'leg';
      knee.add(kneePad);
    }

    // Calf — tapered cylinder, narrower at ankle.
    const calf = taperedSegment({
      px: 0, py: 0, pz: 0,
      topR: L.calfTopR * scale, botR: L.calfBotR * scale, h: calfH,
      segs: 24,
      material: legMat, zone: 'leg',
    });
    knee.add(calf.pivot);

    // Calf flex lobe — soft body-color sphere on the back of the calf
    // mid-segment, parented to the calf so it follows leg motion.
    // Sells the natural calf bulge that a uniform tapered cylinder
    // can't.
    if (L.calfFlex) {
      const CF = L.calfFlex;
      const flexMesh = new THREE.Mesh(_sph(CF.r * scale, 24, 16), legMat);
      flexMesh.scale.set(CF.scaleX ?? 1.0, CF.scaleY ?? 1.0, CF.scaleZ ?? 1.0);
      flexMesh.position.set(0, -CF.yK * calfH, CF.z * scale);
      flexMesh.castShadow = false;
      flexMesh.userData.zone = 'leg';
      calf.pivot.add(flexMesh);
    }

    const ankle = new THREE.Group();
    ankle.position.y = -calfH;
    calf.pivot.add(ankle);

    // Ankle joint — visible body-color sphere bridging calf into foot,
    // sized off the calf's distal radius. Reads as a circle joint per
    // the bodyshapes ref. Replaces the previous invisible Group +
    // small body-color blend.
    const ankleJoint = new THREE.Mesh(_sph(L.calfBotR * scale * 1.10, 16, 12), legMat);
    ankleJoint.castShadow = false;
    ankleJoint.userData.zone = 'leg';
    ankle.add(ankleJoint);
    // Boot — single horizontal wedge per bodyshapes ref: a tapered
    // cylinder running heel→toe, wider at the heel and narrowing at
    // the toe. Rotated 90° around X so the cylinder lies flat on the
    // ground.
    const foot = (() => {
      const pivot = new THREE.Group();
      pivot.position.set(0, 0, L.footZ * scale);
      const heelR = L.footW * scale * 0.45;     // wider at heel
      const toeR  = L.footW * scale * 0.30;     // narrower at toe
      const len   = L.footD * scale;            // length from heel to toe
      const wedge = new THREE.Mesh(_cyl(heelR, toeR, len, 16), bootMat);
      // Cylinder native axis is Y — rotate so it lies along Z (horizontal,
      // pointing forward). After rotation +Y becomes -Z (toe direction).
      wedge.rotation.x = Math.PI / 2;
      wedge.position.set(0, -footH * 0.5, len * 0.5);
      // Slight Z-axis flatten so the wedge reads as a sole (flatter
      // than tall) rather than a column.
      wedge.scale.set(1.0, 1.0, footH / heelR * 1.4);
      wedge.castShadow = true;
      wedge.userData.zone = 'leg';
      pivot.add(wedge);
      return { pivot, mesh: wedge };
    })();
    ankle.add(foot.pivot);
    // Boot top — gear-coloured cuff above the foot, on the calf.
    let bootTop = null;
    if (L.bootTopR > 0 && L.bootTopH > 0) {
      bootTop = new THREE.Mesh(
        _cyl(L.bootTopR * scale, L.bootTopR * scale, L.bootTopH * scale, 24),
        bootMat,
      );
      bootTop.position.set(0, L.bootTopYK * calfH, 0);
      bootTop.castShadow = false;
      bootTop.userData.zone = 'leg';
      calf.pivot.add(bootTop);
    }

    return { thigh, knee, calf, ankle, foot,
             thighRig, kneePad, bootTop, kneeBulge, hipBulge };
  };

  const leftLeg  = mkLeg('left');
  const rightLeg = mkLeg('right');
  hips.add(leftLeg.thigh.pivot);
  hips.add(rightLeg.thigh.pivot);

  // --- torso ---
  // Torso built from oval-profile tapered cylinders instead of stacked
  // boxes, so the silhouette reads as a ribcage-to-waist taper rather
  // than a pair of lunchboxes. `depthRatio` flattens the cylinder
  // along Z so the cross-section is elliptical (a real torso is wider
  // side-to-side than it is deep front-to-back).
  const T = dims.torso;
  const stomachH = T.stomachH * scale;
  const chestH   = T.chestH * scale;

  // Pelvis — fills the gap between thigh pivots and stomach bottom.
  // Uses legMat so it reads as pants/hip region, not extra torso.
  // SKIPPED when a hipBowl is present: the bowl envelops this region
  // already, and rendering both produces visible primitive seams +
  // wasted draw calls. The bowl's wedge taper does what the cylinder
  // was trying to do, only better.
  let pelvis = null;
  if (!T.hipBowl) {
    pelvis = new THREE.Mesh(
      _cyl(T.pelvisTopR * scale, T.pelvisBotR * scale, T.pelvisH * scale, T.segs),
      legMat,
    );
    pelvis.position.set(0, T.pelvisY * scale, 0);
    pelvis.scale.z = T.pelvisDepth ?? T.depthRatio;
    pelvis.castShadow = true;
    pelvis.receiveShadow = true;
    pelvis.userData.zone = 'torso';
    hips.add(pelvis);
  }

  // Crotch wedge — closes the inverted-V gap below the pelvis between
  // the two inner-thigh surfaces. Top meets pelvis bottom, tapers
  // down to just below the hip joint. Skipped when crotchH is 0.
  if ((T.crotchH || 0) > 0.0001) {
    const crotch = new THREE.Mesh(
      _cyl(T.crotchTopR * scale, T.crotchBotR * scale, T.crotchH * scale, T.segs),
      legMat,
    );
    crotch.position.set(
      (T.crotchX || 0) * scale,
      (T.crotchY || 0) * scale,
      (T.crotchZ || 0) * scale,
    );
    crotch.scale.z = T.depthRatio;
    crotch.castShadow = true;
    crotch.receiveShadow = true;
    crotch.userData.zone = 'torso';
    hips.add(crotch);
  }

  // Stomach — tapered cylinder narrowing to the waist.
  const stomach = (() => {
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ';
    pivot.position.set(0, T.stomachY * scale, 0);
    const mesh = new THREE.Mesh(
      _cyl(T.stomachTopR * scale, T.stomachBotR * scale, stomachH, T.segs),
      bodyMat,
    );
    mesh.position.y = stomachH / 2;
    mesh.scale.z = T.stomachDepth ?? T.depthRatio;
    applyPerEndDepthIfDifferent(mesh, T.stomachTopDepth, T.stomachBotDepth, stomachH);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.zone = 'torso';
    pivot.add(mesh);
    return { pivot, mesh };
  })();
  hips.add(stomach.pivot);

  // Chest — single tapered cylinder flaring from waist to shoulder
  // line. Bust attaches here.
  const chest = (() => {
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ';
    pivot.position.set(0, stomachH, 0);
    const mesh = new THREE.Mesh(
      _cyl(T.chestTopR * scale, T.chestBotR * scale, chestH, T.segs),
      bodyMat,
    );
    mesh.position.y = chestH / 2;
    mesh.scale.z = T.chestDepth ?? T.depthRatio;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.zone = 'torso';
    pivot.add(mesh);
    return { pivot, mesh };
  })();
  stomach.pivot.add(chest.pivot);

  // Collar / shoulder yoke — caps the chest top so it doesn't read as
  // a flat-top cylinder. Skipped when collarH is 0 (female default
  // strips this for the clean bodyshapes-style silhouette).
  let collar = null;
  if ((T.collarH || 0) > 0.0001) {
    collar = new THREE.Mesh(
      _cyl(T.collarTopR * scale, T.collarBotR * scale, T.collarH * scale, T.segs),
      bodyMat,
    );
    collar.position.set(0, chestH + T.collarDY * scale, 0);
    collar.scale.z = T.depthRatio;
    collar.castShadow = false;
    collar.receiveShadow = true;
    collar.userData.zone = 'torso';
    chest.pivot.add(collar);
  }

  // Chest plate — curved front panel. Open-ended cylindrical arc
  // wrapping the front + sides of the ribcage, radius a hair larger
  // than the chest so it stands proud. thetaStart is centred on +Z
  // (character front); Three.js's CylinderGeometry places theta=0 at
  // +Z then sweeps through +X, so the arc spans -75°..+75° around
  // the front axis.
  // Chest plate is the "tactical chest rig" gear element — reads
  // wrong on the eve / female silhouette where the body should be
  // smooth bodysuit. Skip it when the rig has bust geometry (i.e.,
  // the female overlay) so the chest reads as continuous skin/cloth
  // rather than armor plate over breasts. Male path retains the
  // plate as before. NB: H = dims.head is declared further down with
  // the head-block; reference dims.head directly here.
  const chestPlate = dims.head.bust ? null : new THREE.Mesh(
    _cyl(
      T.chestPlateTopR * scale, T.chestPlateBotR * scale,
      T.chestPlateH * scale, 48, true,
      -Math.PI / 2.4, Math.PI / 1.2,
    ),
    gearMat,
  );
  if (chestPlate) {
    chestPlate.position.set(0, T.chestPlateYK * chestH, 0);
    chestPlate.scale.z = T.depthRatio;
    chestPlate.castShadow = false;
    chestPlate.userData.zone = 'torso';
    chest.pivot.add(chestPlate);
  }

  // Belt — gear ring at the waist seam. Skipped when beltH is 0
  // (female default — clean silhouette has no belt accent).
  let belt = null;
  if ((T.beltH || 0) > 0.0001) {
    belt = new THREE.Mesh(
      _cyl(T.beltR * scale, T.beltR * scale, T.beltH * scale, T.segs),
      gearMat,
    );
    belt.position.set(0, T.beltY * scale, 0);
    belt.scale.z = T.depthRatio;
    belt.castShadow = false;
    belt.userData.zone = 'torso';
    chest.pivot.add(belt);
  }

  // --- arms ---
  const A = dims.arms;
  const upperArmH = A.upperArmH * scale;
  const forearmH  = A.forearmH * scale;

  const mkArm = (side) => {
    const sign = side === 'left' ? -1 : 1;
    // Upper arm — tapered cylinder, wider at shoulder.
    const shoulder = taperedSegment({
      px: sign * A.shoulderInset * scale, py: A.shoulderYK * chestH, pz: 0,
      topR: A.upperArmTopR * scale, botR: A.upperArmBotR * scale, h: upperArmH,
      segs: 24,
      material: armMat, zone: 'arm',
    });
    // Shoulder joint sphere — smooths the shoulder-to-torso bulge.
    const shoulderBulge = jointSphere(A.shoulderBulgeR * scale, armMat, 'arm');
    shoulder.pivot.add(shoulderBulge);
    // Shoulder pad — hemispherical pauldron over the deltoid.
    // Hemispherical pauldron — partial-sphere geometry (φ = 0..π/2)
    // distinct from the full jointSpheres, so it gets its own cache key.
    const shoulderPadKey = `sphP|${A.shoulderPadR * scale}|12|6|0|${Math.PI * 2}|0|${Math.PI / 2}`;
    let shoulderPadGeom = _geomCache.get(shoulderPadKey);
    if (!shoulderPadGeom) {
      shoulderPadGeom = _stamp(new THREE.SphereGeometry(
        A.shoulderPadR * scale, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2,
      ));
      _geomCache.set(shoulderPadKey, shoulderPadGeom);
    }
    let shoulderPad = null;
    if (A.shoulderPadR > 0) {
      shoulderPad = new THREE.Mesh(shoulderPadGeom, gearMat);
      shoulderPad.position.set(0, 0, 0);
      shoulderPad.castShadow = false;
      shoulderPad.userData.zone = 'arm';
      shoulder.pivot.add(shoulderPad);
    }

    // Bicep bulge — flattened sphere mid-upper-arm. Parented to
    // shoulder.pivot so it follows the arm. Sells "this arm has
    // muscle" instead of reading as a tube. Female overlay slims it;
    // male keeps the default mid-bulk read.
    if (A.bicep) {
      const BI = A.bicep;
      const bicepMesh = new THREE.Mesh(_sph(BI.r * scale, 24, 16), armMat);
      bicepMesh.scale.set(BI.scaleX ?? 1.0, BI.scaleY ?? 1.0, BI.scaleZ ?? 1.0);
      bicepMesh.position.set(0, -BI.yK * upperArmH, BI.z * scale);
      bicepMesh.castShadow = false;
      bicepMesh.userData.zone = 'arm';
      shoulder.pivot.add(bicepMesh);
    }

    const elbow = new THREE.Group();
    elbow.position.y = -upperArmH;
    shoulder.pivot.add(elbow);
    // Elbow joint sphere.
    const elbowBulge = jointSphere(A.elbowBulgeR * scale, armMat, 'arm');
    elbow.add(elbowBulge);

    // Forearm — tapered cylinder, narrower at wrist.
    const forearm = taperedSegment({
      px: 0, py: 0, pz: 0,
      topR: A.forearmTopR * scale, botR: A.forearmBotR * scale, h: forearmH,
      segs: 24,
      material: armMat, zone: 'arm',
    });
    elbow.add(forearm.pivot);
    let wristCuff = null;
    if (A.wristCuffR > 0 && A.wristCuffH > 0) {
      wristCuff = new THREE.Mesh(
        _cyl(A.wristCuffR * scale, A.wristCuffR * scale, A.wristCuffH * scale, 24),
        gearMat,
      );
      wristCuff.position.set(0, A.wristCuffYK * forearmH, 0);
      wristCuff.castShadow = false;
      wristCuff.userData.zone = 'arm';
      forearm.pivot.add(wristCuff);
    }

    const wrist = new THREE.Group();
    wrist.position.y = -forearmH;
    forearm.pivot.add(wrist);
    // Wrist joint — visible body-color sphere bridging the forearm
    // taper into the hand. Sized off the forearm's distal radius so
    // it scales with the limb and reads as a circle joint per the
    // bodyshapes ref.
    const wristJoint = new THREE.Mesh(_sph(A.forearmBotR * scale * 1.05, 16, 12), armMat);
    wristJoint.castShadow = false;
    wristJoint.userData.zone = 'arm';
    wrist.add(wristJoint);
    // Hand — tapered cylinder wedge. Wider at the wrist (palm),
    // narrower toward the fingertips. Length = handH * 0.8 so it
    // reads as a compact fist, not a sausage extension. Previous
    // value (handH * 1.4) made the hand ~half the forearm length
    // visually, which read as a claw.
    const hand = (() => {
      const pivot = new THREE.Group();
      pivot.position.set(0, A.handY * scale, 0);
      const handLen = A.handH * 0.8 * scale;
      const wedgeMesh = new THREE.Mesh(
        _cyl(
          (A.handW * 0.55) * scale,    // wider at palm
          (A.handW * 0.40) * scale,    // narrower at fingertips
          handLen,
          16,
        ),
        handMat,
      );
      // Cylinder is Y-centered; offset so the TOP sits at wrist (y=0).
      wedgeMesh.position.y = -handLen * 0.5;
      // Flatten on Z so the hand reads as a palm/fist, not a column.
      wedgeMesh.scale.set(1.0, 1.0, 0.65);
      wedgeMesh.castShadow = true;
      wedgeMesh.userData.zone = 'arm';
      pivot.add(wedgeMesh);
      return { pivot, mesh: wedgeMesh };
    })();
    wrist.add(hand.pivot);
    return { shoulder, elbow, forearm, wrist, hand,
             shoulderPad, wristCuff, elbowBulge, shoulderBulge };
  };

  const leftArm  = mkArm('left');
  const rightArm = mkArm('right');
  chest.pivot.add(leftArm.shoulder.pivot);
  chest.pivot.add(rightArm.shoulder.pivot);

  // Shoulder anchors — mount points for shouldered long-gun holds
  // (rifles, shotguns, LMGs). Parent a rifle here and the stock sits
  // naturally against the dominant shoulder, with the barrel
  // extending forward past both hands. Pistols/SMGs keep the hand-
  // parent mount (see player.js setWeapon).
  const RA = dims.rifleAnchor;
  const mkShoulderAnchor = (side) => {
    const sign = side === 'left' ? -1 : 1;
    const g = new THREE.Group();
    g.position.set(sign * RA.x * scale, RA.yK * chestH, RA.z * scale);
    chest.pivot.add(g);
    return g;
  };
  const leftShoulderAnchor  = mkShoulderAnchor('left');
  const rightShoulderAnchor = mkShoulderAnchor('right');

  // --- neck + head ---
  const H = dims.head;
  const neck = (() => {
    const pivot = new THREE.Group();
    pivot.position.set(0, chestH, 0);
    if (opts.neckCable) {
      // Cyborg articulated neck — 3 stacked gear-color rings instead of
      // a smooth body-color cylinder. Reads as segmented mechanical
      // articulation (Raiden / cyborg ninja silhouette element). The
      // top + bottom rings are slightly larger to form a barrel shape;
      // the middle ring is the narrowest visible joint.
      const cableGroup = new THREE.Group();
      cableGroup.position.y = H.neckMeshY * scale;
      const segH = (H.neckH * scale) / 3.2;
      const segR = H.neckBotR * scale * 0.95;
      const segR2 = H.neckTopR * scale * 0.85;
      const ringDefs = [
        { y: -segH * 1.05, r: segR, h: segH * 0.82 },
        { y:  0,           r: segR2, h: segH * 0.65 },
        { y:  segH * 1.05, r: segR, h: segH * 0.82 },
      ];
      for (const r of ringDefs) {
        const ring = new THREE.Mesh(
          _cyl(r.r, r.r, r.h, 24),
          gearMat,
        );
        ring.position.y = r.y;
        ring.castShadow = false;
        ring.userData.zone = 'torso';
        cableGroup.add(ring);
      }
      pivot.add(cableGroup);
      // Return the group as the "mesh" reference so external systems
      // (hit-flash lerp etc.) can still target it; the toon hit-flash
      // walks meshes via the rig.meshes flat list which we'll patch
      // below to include the cable rings.
      return { pivot, mesh: cableGroup, cableRings: cableGroup.children.slice() };
    }
    const mesh = new THREE.Mesh(
      _cyl(H.neckTopR * scale, H.neckBotR * scale, H.neckH * scale, 24),
      bodyMat,
    );
    mesh.position.y = H.neckMeshY * scale;
    // Neck sits between the chest cylinder + cranium shadows from
    // any iso angle — its own shadow contributes nothing visible.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.zone = 'torso';
    pivot.add(mesh);
    return { pivot, mesh };
  })();
  chest.pivot.add(neck.pivot);
  const head = new THREE.Group();
  head.position.y = H.headY * scale;
  neck.pivot.add(head);
  // Cranium — faceted low-poly sphere with vertical stretch.
  const headMesh = new THREE.Mesh(_sph(H.craniumR * scale, 32, 24), headMat);
  headMesh.scale.set(1.0, H.craniumStretchY, H.craniumStretchZ);
  headMesh.position.y = H.craniumY * scale;
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  headMesh.userData.zone = 'head';
  head.add(headMesh);
  // Jaw — narrower box just above the neck so the head→neck
  // transition has some geometry where the jaw would be.
  const jawMesh = new THREE.Mesh(
    _box(H.jawW * scale, H.jawH * scale, H.jawD * scale),
    headMat,
  );
  jawMesh.position.y = H.jawY * scale;
  // Accessory — sits inside the cranium shadow.
  jawMesh.castShadow = false;
  jawMesh.userData.zone = 'head';
  head.add(jawMesh);

  // --- visor (cyborg ninja eye-line) -------------------------------
  // Single horizontal accent-color bar wrapping the front of the
  // cranium where a face would be. Strongest single-element silhouette
  // change for the Raiden-coded male player. Gated on opts.visor so
  // unhelmeted civilian / female / boss rigs can opt out.
  let visorMesh = null;
  if (opts.visor) {
    const cR = H.craniumR * scale;
    // Curved arc cylinder (open-ended) wrapping the front 180° of the
    // head, very thin vertically. Slightly larger radius than the
    // cranium so the band stands proud of the head surface.
    const visorGeom = _cyl(
      cR * 1.02, cR * 1.02, cR * 0.32, 24, true,
      -Math.PI * 0.5, Math.PI,
    );
    visorMesh = new THREE.Mesh(visorGeom, accentMat);
    visorMesh.position.y = (H.craniumY + H.craniumR * 0.05) * scale;
    visorMesh.castShadow = false;
    visorMesh.userData.zone = 'head';
    head.add(visorMesh);
  }

  // --- hair volume (femme silhouette mass on the cranium) -----------
  // Domed cap on the upper-back of the cranium feeding into the
  // ponytail. Without this, the ponytail looks like a baton glued to
  // a bald head — refs show real hair-mass volume on the head feeding
  // INTO the ponytail tail. Read from dims.head.hairVolume so it scales
  // with the female DIM overlay. Body-color (same as the operator
  // palette ponytail).
  // Hair: legacy single-sphere hairVolume (retained so non-bob actors
  // that opt into long hair still have a hair-mass primitive feeding
  // the ponytail) OR a multi-piece bob (4 primitives forming a styled
  // chin-length cut with visible structural pieces).
  let hairVolume = null;
  if (H.hairVolume) {
    const HV = H.hairVolume;
    const hairR = HV.r * scale;
    const hairH = HV.h * scale;
    hairVolume = new THREE.Mesh(_sph(hairR, 32, 24), hairMat);
    hairVolume.scale.set(HV.scaleX ?? 1.0, hairH / hairR, HV.scaleZ ?? 1.05);
    hairVolume.position.set(0, (H.craniumY + HV.y) * scale, HV.z * scale);
    hairVolume.castShadow = false;
    hairVolume.userData.zone = 'head';
    head.add(hairVolume);
  }
  if (H.bob) {
    const B = H.bob;
    // Crown — sphere top-half only (dome). Phi-clipped so only the
    // upper hemisphere renders, matching the rounded top of a styled
    // bob without a visible bottom seam.
    if (B.crown) {
      const c = B.crown;
      const crownGeom = _stamp(new THREE.SphereGeometry(
        c.r * scale, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2,
      ));
      const crown = new THREE.Mesh(crownGeom, hairMat);
      crown.scale.set(c.scaleX ?? 1.0, c.scaleY ?? 1.0, c.scaleZ ?? 1.0);
      crown.position.set(0, (H.craniumY + c.y) * scale, c.z * scale);
      crown.castShadow = false;
      crown.userData.zone = 'head';
      head.add(crown);
    }
    // Back panel — vertical cylinder behind head with FLAT top edge
    // (open-ended cylinder caps off so the crown dome hides the top
    // seam) and FLAT bottom edge so the chin-length cut reads as a
    // straight horizontal line instead of tapering to a point.
    if (B.back) {
      const b = B.back;
      const backMesh = new THREE.Mesh(
        _cyl(b.topR * scale, b.botR * scale, b.h * scale, 24),
        hairMat,
      );
      backMesh.position.set(0, (H.craniumY + b.y) * scale, b.z * scale);
      backMesh.castShadow = false;
      backMesh.userData.zone = 'head';
      head.add(backMesh);
    }
    // Side panels — vertical cylinders flanking face. Flat bottoms
    // form the horizontal cut edge along the jaw line. Slight outward
    // taper (botR > topR) gives the bob its characteristic flare at
    // the chin.
    if (B.side) {
      const s = B.side;
      for (const sign of [-1, +1]) {
        const sideMesh = new THREE.Mesh(
          _cyl(s.topR * scale, s.botR * scale, s.h * scale, 16),
          hairMat,
        );
        sideMesh.position.set(sign * s.x * scale, (H.craniumY + s.y) * scale, s.z * scale);
        sideMesh.castShadow = false;
        sideMesh.userData.zone = 'head';
        head.add(sideMesh);
      }
    }
    // Fringe / bangs — horizontal slab across the brow line, flat
    // bottom so it reads as a clean cut at brow level. Sits forward
    // of the cranium so it covers the forehead without clipping
    // through the face.
    if (B.fringe) {
      const f = B.fringe;
      const fringeMesh = new THREE.Mesh(
        _box(f.w * scale, f.h * scale, f.d * scale),
        hairMat,
      );
      fringeMesh.position.set(0, (H.craniumY + f.y) * scale, f.z * scale);
      fringeMesh.castShadow = false;
      fringeMesh.userData.zone = 'head';
      head.add(fringeMesh);
    }
  }

  // --- ponytail (femme-fatale silhouette) ---------------------------
  // Sweep box hanging from the back of the cranium. Per refs, extends
  // to lower back / butt level — much longer than the previous
  // craniumR * 4 default. When dims.head.ponytail is provided (female
  // DIMS overlay does this), use those values; otherwise fall back to
  // the legacy craniumR-relative defaults so existing male presets
  // that opt into ponytail still work. Body-color so it matches the
  // operator palette.
  let ponytail = null;
  if (opts.ponytail) {
    const PT = H.ponytail;
    const ptW = PT ? PT.w * scale : H.craniumR * scale * 0.55;
    const ptH = PT ? PT.h * scale : H.craniumR * scale * 4.0;
    const ptD = PT ? PT.d * scale : H.craniumR * scale * 0.55;
    const ptY = PT ? PT.y * scale : (H.craniumY + H.craniumR * 0.6) * scale;
    const ptZ = PT ? PT.z * scale : -H.craniumR * scale * 0.85;
    ponytail = new THREE.Mesh(_box(ptW, ptH, ptD), hairMat);
    // Pivot at the tie-point on top-back of the cranium. The mesh's
    // origin is the box centre, so push it down by half-height. Back-
    // of-head is -Z (visor uses theta -π/2 / +π wrapping the front;
    // jaw extends +Z).
    ponytail.position.set(0, ptY - ptH * 0.5, ptZ);
    ponytail.castShadow = false;
    ponytail.userData.zone = 'head';
    head.add(ponytail);
  }

  // Head-zone halo — invisible cap sitting just above the cranium so
  // shots that clip slightly over the top still register as head
  // hits. Diameter is intentionally narrower than the cranium so the
  // extension only forgives VERTICAL aim error; widening would let
  // body shots cheese into headshots from iso angles. ~0.05m tall at
  // player scale = a small generosity band, not a free pass.
  const _haloR = H.craniumR * 0.85;
  const _haloH = H.craniumR * 0.40;
  const headHalo = new THREE.Mesh(
    new THREE.CylinderGeometry(_haloR * scale, _haloR * scale, _haloH * scale, 10),
    new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false,
    }),
  );
  headHalo.position.y = (H.craniumY + H.craniumR * H.craniumStretchY + _haloH * 0.5) * scale;
  headHalo.castShadow = false;
  headHalo.userData.zone = 'head';
  head.add(headHalo);

  // --- player signature: bandolier strap ---------------------------
  // ONE asymmetric detail that distinguishes the protagonist from any
  // bilateral enemy. Diagonal strap from left shoulder to right hip,
  // realised as a thin tilted box parented to the chest so it follows
  // torso pitch + twist naturally. Gated on opts.signature so spawn
  // code can opt actors in/out (player ✓, enemies ✗).
  // --- trapezius wedge (neck-shoulder blend) -----------------------
  // Flattened sphere on top of the chest cylinder, parented to
  // chest.pivot so it follows torso pitch + twist + aim yaw. Bridges
  // the gap between the shoulder line and the neck base. Without it
  // the shoulders look like two pegged-on spheres at the corners of
  // a flat chest top.
  if (T.trapezius) {
    const TR = T.trapezius;
    const trapMesh = new THREE.Mesh(_sph(TR.r * scale, 24, 16), bodyMat);
    trapMesh.scale.set(TR.scaleX ?? 1.0, TR.scaleY ?? 1.0, TR.scaleZ ?? 1.0);
    trapMesh.position.set(0, TR.y * scale, TR.z * scale);
    trapMesh.castShadow = false;
    trapMesh.userData.zone = 'torso';
    chest.pivot.add(trapMesh);
  }

  // --- pec lobe (bust-to-chest bridge) -----------------------------
  // Female-specific. Soft body-color mass between the bust spheres
  // and the chest centerline, parented to chest.pivot. Without it
  // the bust reads as two stuck-on lumps; with it the upper chest
  // reads as one continuous curve.
  if (T.pec) {
    const PC = T.pec;
    const pecMesh = new THREE.Mesh(_sph(PC.r * scale, 24, 16), bodyMat);
    pecMesh.scale.set(PC.scaleX ?? 1.0, PC.scaleY ?? 1.0, PC.scaleZ ?? 1.0);
    pecMesh.position.set(0, PC.y * scale, PC.z * scale);
    pecMesh.castShadow = false;
    pecMesh.userData.zone = 'torso';
    chest.pivot.add(pecMesh);
  }

  // --- bust (femme silhouette) -------------------------------------
  // Two flattened spheres positioned on the chest plate. Read from
  // dims.head.bust so the female DIM overlay drives placement. Body-
  // color so it sits inside the bodysuit silhouette.
  if (H.bust) {
    const B = H.bust;
    const bR = B.r * scale * bustScale;
    for (const sign of [-1, +1]) {
      const lobe = new THREE.Mesh(_sph(bR, 24, 16), bodyMat);
      lobe.scale.set(1.0, B.scaleY ?? 1.0, (B.scaleZ ?? 1.0) * bustScale);
      lobe.position.set(sign * B.separationX * scale, B.y * scale, B.z * scale);
      lobe.castShadow = false;
      lobe.userData.zone = 'torso';
      chest.pivot.add(lobe);
    }
  }

  // --- glute (femme silhouette) ------------------------------------
  // Two flattened spheres on the back of the pelvis. Read from
  // dims.legs.glute. Leg-color so it matches the trousers / bodysuit.
  if (dims.legs.glute) {
    const G = dims.legs.glute;
    const gR = G.r * scale * gluteScale;
    for (const sign of [-1, +1]) {
      const lobe = new THREE.Mesh(_sph(gR, 24, 16), legMat);
      lobe.scale.set(1.0, G.scaleY ?? 1.0, (G.scaleZ ?? 1.0) * gluteScale);
      lobe.position.set(sign * G.separationX * scale, G.y * scale, G.z * scale);
      lobe.castShadow = false;
      lobe.userData.zone = 'leg';
      hips.add(lobe);
    }
  }

  // hipBowl mesh handle exposed on the rig return below so external
  // tools (rig_tuner part scaler) can mirror / offset it. Declared
  // here so the build block + return both reach it.
  let hipBowlMesh = null;
  // --- hip bowl (primary hip volume, wedge-shaped) ------------------
  // Female-coded. Reads as the pelvis WEDGE per anatomy refs: wider
  // at the iliac crest (top), narrower at the pubic bone (bottom),
  // with a slight forward pitch (sacrum higher than pubis). Built
  // from a tapered cylinder with high segs (smooth surface, planar
  // structure visible only conceptually) when wedgeTopFactor /
  // wedgeBotFactor are set; falls back to a simple scaled sphere
  // otherwise.
  if (T.hipBowl) {
    const HB = T.hipBowl;
    if (HB.wedgeTopFactor != null && HB.wedgeBotFactor != null) {
      const topR = HB.r * HB.wedgeTopFactor * scale;
      const botR = HB.r * HB.wedgeBotFactor * scale;
      const h = HB.r * 2 * (HB.scaleY ?? 0.6) * scale;
      hipBowlMesh = new THREE.Mesh(_cyl(topR, botR, h, 32), bodyMat);
      hipBowlMesh.scale.set(HB.scaleX ?? 1.0, 1.0, HB.scaleZ ?? 1.0);
    } else {
      hipBowlMesh = new THREE.Mesh(_sph(HB.r * scale, 32, 24), bodyMat);
      hipBowlMesh.scale.set(HB.scaleX ?? 1.0, HB.scaleY ?? 1.0, HB.scaleZ ?? 1.0);
    }
    hipBowlMesh.position.set(0, HB.y * scale, HB.z * scale);
    if (HB.pitchX) hipBowlMesh.rotation.x = HB.pitchX;
    hipBowlMesh.castShadow = false;
    hipBowlMesh.userData.zone = 'torso';
    hips.add(hipBowlMesh);
  }

  // --- hip-front lobe (smooth pelvis-front curve) ------------------
  // Female-coded. Fills the visible scoop between the wider iliac
  // flare and where the legs descend, so the front of the pelvis
  // reads as one continuous curve instead of a flat cylinder bottom
  // with two leg cylinders sticking out the corners. Parented to the
  // pelvis mesh's parent (hips) so it follows hip motion.
  if (T.hipFront) {
    const HF = T.hipFront;
    const hipFrontMesh = new THREE.Mesh(_sph(HF.r * scale, 24, 16), bodyMat);
    hipFrontMesh.scale.set(HF.scaleX ?? 1.0, HF.scaleY ?? 1.0, HF.scaleZ ?? 1.0);
    hipFrontMesh.position.set(0, HF.y * scale, HF.z * scale);
    hipFrontMesh.castShadow = false;
    hipFrontMesh.userData.zone = 'torso';
    hips.add(hipFrontMesh);
  }

  // --- iliac shelf (hip-to-thigh connective shape) -----------------
  // Flattened spheres on each side of the hips that bridge the seam
  // between the pelvis cylinder (wide) and the thigh top (narrow).
  // Without this, the leg looks like it stabs straight up into a
  // wider hip ring; with it the silhouette flows from waist → hip
  // flare → thigh as a continuous curve. Body-color so it reads as
  // skin/cloth, not gear.
  if (dims.legs.iliacShelf) {
    const IS = dims.legs.iliacShelf;
    const isR = IS.r * scale;
    for (const sign of [-1, +1]) {
      const shelf = new THREE.Mesh(_sph(isR, 24, 16), bodyMat);
      shelf.scale.set(IS.scaleX ?? 1.0, IS.scaleY ?? 1.0, IS.scaleZ ?? 1.0);
      shelf.position.set(sign * IS.x * scale, IS.y * scale, IS.z * scale);
      shelf.castShadow = false;
      shelf.userData.zone = 'leg';
      hips.add(shelf);
    }
  }

  // --- abdomen lobes (front torso curve + implicit abs definition) ---
  // Single-lobe `abdomen` (legacy male path) OR split upper/lower
  // lobes (female). The split creates an implicit horizontal seam at
  // navel level — without surface shading it's how we get an abs
  // definition cue from primitives alone.
  const placeAbdomenLobe = (cfg) => {
    if (!cfg) return;
    const lobe = new THREE.Mesh(_sph(cfg.r * scale, 24, 16), bodyMat);
    lobe.scale.set(cfg.scaleX ?? 1.0, cfg.scaleY ?? 1.0, cfg.scaleZ ?? 1.0);
    lobe.position.set(0, cfg.y * scale, cfg.z * scale);
    lobe.castShadow = false;
    lobe.userData.zone = 'torso';
    stomach.pivot.add(lobe);
  };
  placeAbdomenLobe(T.abdomen);
  placeAbdomenLobe(T.upperAbdomen);
  placeAbdomenLobe(T.lowerAbdomen);

  // --- lumbar curve (back-of-torso S-curve) ------------------------
  // Female-coded. Soft body-color lobe at the back of the chest-
  // bottom that arcs INTO the glute curves below. Without this the
  // spine area reads as a vertical line; with it the back has an
  // S-curve from shoulder blades through lumbar to glutes.
  if (T.lumbar) {
    const LB = T.lumbar;
    const lumbarMesh = new THREE.Mesh(_sph(LB.r * scale, 24, 16), bodyMat);
    lumbarMesh.scale.set(LB.scaleX ?? 1.0, LB.scaleY ?? 1.0, LB.scaleZ ?? 1.0);
    lumbarMesh.position.set(0, LB.y * scale, LB.z * scale);
    lumbarMesh.castShadow = false;
    lumbarMesh.userData.zone = 'torso';
    chest.pivot.add(lumbarMesh);
  }

  let bandolier = null;
  if (opts.signature) {
    const stratW = 0.04 * scale;
    const stratH = 0.55 * scale;
    const stratD = 0.06 * scale;
    bandolier = new THREE.Mesh(_box(stratW, stratH, stratD), signatureMat || gearMat);
    // Place at chest center, then rotate ~30° around Z so it runs
    // shoulder-to-opposite-hip diagonally. Z rotation in this rig's
    // chest-local frame tilts the long axis toward the side.
    bandolier.position.set(0, T.chestPlateYK * chestH * 0.4, T.chestPlateTopR * scale * 0.95);
    bandolier.rotation.z = 0.55;   // ~32° tilt
    bandolier.castShadow = false;
    bandolier.userData.zone = 'torso';
    chest.pivot.add(bandolier);
  }

  // --- back sheath (permanent blade silhouette) --------------------
  // Thin gear-color box mounted across the back, slightly diagonal so
  // it reads as a sheathed sword strap. Always present when opted in,
  // independent of equipped weapon — gives the protagonist a permanent
  // "carries a blade" silhouette element. Gated on opts.sheath.
  let sheath = null;
  if (opts.sheath) {
    const shW = 0.05 * scale;
    const shH = 0.85 * scale;
    const shD = 0.05 * scale;
    sheath = new THREE.Mesh(_box(shW, shH, shD), gearMat);
    // Mount at chest back, slightly above center, tilted across the
    // back. -Z is back of body in this rig's chest-local frame.
    sheath.position.set(0, T.chestPlateYK * chestH * 0.3, -T.chestPlateTopR * scale * 0.95);
    sheath.rotation.z = -0.45;   // tilt left-down to right-up across back
    sheath.castShadow = false;
    sheath.userData.zone = 'torso';
    chest.pivot.add(sheath);
  }

  // Expose every pivot + mesh by name so callers can grab what they
  // need. `torso` is an alias of the chest group (most callers care
  // about where to parent the weapon / health bar / tag cones).
  return {
    group,
    hips,
    pelvis,
    stomach: stomach.pivot, stomachMesh: stomach.mesh,
    chest: chest.pivot,     chestMesh: chest.mesh,
    torso: chest.pivot,           // alias used by existing callers
    torsoMesh: chest.mesh,        // alias for hit-flash lerp
    neck: neck.pivot,       neckMesh: neck.mesh,
    head,                   headMesh,
    jawMesh,
    chestPlate, belt, collar,
    hipBowl: hipBowlMesh,
    leftLeg, rightLeg,
    leftArm, rightArm,
    leftShoulderAnchor, rightShoulderAnchor,
    // Flat mesh list (useful for hit-flash color lerp across every part).
    // Includes gear accents so they flash with the body on hit.
    meshes: [
      ...(pelvis ? [pelvis] : []), stomach.mesh, chest.mesh,
      ...(chestPlate ? [chestPlate] : []),
      ...(belt ? [belt] : []),
      ...(collar ? [collar] : []),
      neck.mesh, headMesh, jawMesh, headHalo,
      leftLeg.thigh.mesh, leftLeg.hipBulge,
      ...(leftLeg.thighRig ? [leftLeg.thighRig] : []),
      leftLeg.kneeBulge,
      ...(leftLeg.kneePad ? [leftLeg.kneePad] : []),
      leftLeg.calf.mesh,
      ...(leftLeg.bootTop ? [leftLeg.bootTop] : []),
      leftLeg.foot.mesh,
      rightLeg.thigh.mesh, rightLeg.hipBulge,
      ...(rightLeg.thighRig ? [rightLeg.thighRig] : []),
      rightLeg.kneeBulge,
      ...(rightLeg.kneePad ? [rightLeg.kneePad] : []),
      rightLeg.calf.mesh,
      ...(rightLeg.bootTop ? [rightLeg.bootTop] : []),
      rightLeg.foot.mesh,
      leftArm.shoulder.mesh, leftArm.shoulderBulge,
      ...(leftArm.shoulderPad ? [leftArm.shoulderPad] : []),
      leftArm.forearm.mesh, leftArm.elbowBulge,
      ...(leftArm.wristCuff ? [leftArm.wristCuff] : []),
      leftArm.hand.mesh,
      rightArm.shoulder.mesh, rightArm.shoulderBulge,
      ...(rightArm.shoulderPad ? [rightArm.shoulderPad] : []),
      rightArm.forearm.mesh, rightArm.elbowBulge,
      ...(rightArm.wristCuff ? [rightArm.wristCuff] : []),
      rightArm.hand.mesh,
    ],
    // Subset of `meshes` that lives in the right-arm subtree. The
    // disarm path hides the whole subtree via group.visible = false;
    // with the rig instancer, gunman.js additionally calls
    // rigInstancer.hideMeshes(rig.rightArmMeshes, true) so the
    // corresponding instance slots write zero-scale matrices and
    // stop drawing. Without this list the disarm-hide silently
    // no-ops because the gunman.js calls use optional chaining.
    rightArmMeshes: [
      rightArm.shoulder.mesh, rightArm.shoulderBulge, rightArm.shoulderPad,
      rightArm.forearm.mesh, rightArm.elbowBulge, rightArm.wristCuff,
      rightArm.hand.mesh,
    ],
    // Materials kept for color lerp / re-tint.
    materials: { bodyMat, headMat, legMat, armMat, handMat, gearMat, bootMat },
    scale,
    dims,
  };
}

// --- Procedural animation ----------------------------------------------
// All state lives on a small `rig.anim` bag attached by `initAnim`; per
// frame `updateAnim(rig, state, dt)` reads `state.speed` (horizontal
// velocity magnitude), `state.aimYaw`/`aimPitch`, `state.recoilT`,
// `state.hitFlinchT`, `state.deadFallT` and re-poses the joints.
//
// Design goal: animation pose is purely a *display* layer — it never
// feeds back into game-simulation position / rotation / collision, so
// input latency stays exactly what it was. Movement still sets
// `group.position`; the rig just bobs the hips, swings the limbs, etc.,
// on top of the already-resolved transform.

export function initAnim(rig) {
  rig.anim = {
    cycle: Math.random() * Math.PI * 2,   // per-actor phase offset so a
                                          // squad doesn't walk in lockstep
    // Separate timeline for idle life — breath + weight-shift should
    // NOT accelerate when the character starts running. Independent
    // phase so two standing enemies don't breathe in sync.
    breathT: Math.random() * Math.PI * 2,
    blendWalk: 0,
    blendRun: 0,
    aimBlend: 0,
    crouchBlend: 0,
    kneelBlend: 0,
    // Arm yaw tracker — smoothly follows the commanded aim yaw with
    // a little lag so arms trail body rotation instead of snapping
    // to it. Gives the turn-to-aim motion visible follow-through.
    armYawLag: 0,
    recoilT: 0,
    recoilDir: 1,
    hitFlinchT: 0,
    hitFlinchDir: { x: 0, z: 1 },
    deadFallT: 0,
    deadFallDir: { x: 0, z: 1 },
    deadFallMag: 1,
  };
  // Cache rest position by Object3D identity so per-frame pose offsets
  // (RIFLE_POSE.*.px / py / pz) apply as deltas on top of the rig's
  // authored position, regardless of which arm is the dominant side.
  // Captured here, immediately after buildRig sets the at-rest pose.
  const baseMap = new WeakMap();
  for (const arm of [rig.leftArm, rig.rightArm]) {
    baseMap.set(arm.shoulder.pivot, arm.shoulder.pivot.position.clone());
    baseMap.set(arm.elbow,          arm.elbow.position.clone());
    baseMap.set(arm.wrist,          arm.wrist.position.clone());
  }
  for (const k of ['hips', 'stomach', 'chest', 'neck', 'head']) {
    if (rig[k]) baseMap.set(rig[k], rig[k].position.clone());
  }
  rig.anim._basePosByObj = baseMap;
}

// --- rifle pose data (authored in tools/pose_editor.html) ----------------
// Two key poses; the runtime lerps between them by aimBlend (0=hip, 1=aim).
// Joint values are RAW canonical right-handed; apply path multiplies ry,
// rz, and px by the supportYawSign (which is the editor's `mirror` value:
// +1 right-handed, -1 left-handed). Position deltas add on top of the
// rig's authored rest pose, never absolute.
const RIFLE_POSE_HIP = {
  stomach:     { rx:  0,    ry: -0.51, rz:  0,    px:  0,    py:  0,    pz: -0.04 },
  chest:       { rx:  0,    ry:  0.16, rz:  0,    px:  0,    py:  0,    pz:  0    },
  head:        { rx:  0,    ry:  0,    rz:  0,    px:  0,    py:  0,    pz:  0    },
  domShoulder: { rx: -0.39, ry: -0.66, rz:  0.63, px: -0.03, py:  0,    pz: -0.09 },
  domElbow:    { rx: -1.96, ry: -0.06, rz:  0.12, px:  0,    py:  0,    pz:  0    },
  domWrist:    { rx:  0.30, ry: -0.21, rz:  0.20, px:  0,    py:  0,    pz:  0    },
  supShoulder: { rx: -1.65, ry:  0.27, rz:  0.56, px:  0.04, py:  0,    pz:  0.14 },
  supElbow:    { rx: -0.43, ry:  0.78, rz:  0.19, px:  0,    py:  0,    pz:  0    },
  supWrist:    { rx:  0,    ry:  0,    rz:  0,    px:  0,    py:  0,    pz:  0    },
  // Weapon offset is consumed by player.js (it owns the gunMesh +
  // muzzle Object3Ds). Same mirror rules apply.
  weapon:      { rx:  0.06, ry:  0.40, rz:  0.90, px:  0,    py:  0,    pz:  0    },
};
const RIFLE_POSE_AIM = {
  stomach:     { rx:  0,    ry:  0,    rz:  0,    px:  0,    py:  0,    pz:  0    },
  chest:       { rx:  0,    ry: -0.30, rz:  0,    px:  0,    py:  0,    pz:  0    },
  head:        { rx:  0,    ry:  0,    rz:  0,    px:  0.02, py: -0.02, pz:  0.05 },
  domShoulder: { rx: -0.89, ry:  0.20, rz:  0.30, px: -0.02, py:  0,    pz: -0.06 },
  domElbow:    { rx: -2.35, ry: -0.30, rz: -0.54, px:  0,    py:  0,    pz:  0    },
  domWrist:    { rx:  0,    ry:  0,    rz:  0,    px:  0,    py:  0,    pz:  0    },
  supShoulder: { rx: -1.86, ry:  0.50, rz:  0.84, px:  0.10, py:  0,    pz:  0.16 },
  supElbow:    { rx: -0.66, ry: -0.21, rz: -0.36, px:  0,    py:  0,    pz:  0    },
  supWrist:    { rx:  0.36, ry: -0.09, rz: -0.18, px:  0,    py:  0,    pz:  0    },
  weapon:      { rx:  0.08, ry:  0.26, rz:  0.14, px:  0,    py:  0.08, pz:  0    },
};
// Exposed for player.js — the weapon offset half of the pose lives
// outside this module since gunMesh + muzzle aren't part of the rig.
export const RIFLE_WEAPON_HIP = RIFLE_POSE_HIP.weapon;
export const RIFLE_WEAPON_AIM = RIFLE_POSE_AIM.weapon;

// --- SMG pose data (authored in tools/pose_editor.html) ---------------
// Authored against the SMG hand-mount baseline (gun parented to the
// dominant wrist with rotation (π/2, 0, 0); gun extends in wrist-
// local -Y). Same lerp + mirror rules as the rifle pose.
const SMG_POSE_HIP = {
  stomach:     { rx:  0,    ry:  0,    rz:  0,    px:  0,    py:  0,    pz:  0    },
  chest:       { rx:  0,    ry: -0.30, rz:  0,    px:  0,    py:  0,    pz:  0    },
  head:        { rx:  0,    ry:  0,    rz:  0,    px:  0,    py:  0,    pz:  0    },
  domShoulder: { rx: -0.38, ry:  0.13, rz: -0.27, px:  0,    py:  0,    pz:  0    },
  domElbow:    { rx: -1.84, ry: -0.01, rz: -0.06, px:  0,    py:  0,    pz:  0    },
  domWrist:    { rx:  0.21, ry:  0.03, rz:  0.09, px:  0,    py:  0,    pz:  0    },
  supShoulder: { rx: -1.16, ry: -0.03, rz:  0.64, px:  0.06, py:  0,    pz:  0.18 },
  supElbow:    { rx: -0.33, ry:  0.72, rz:  0.38, px:  0,    py:  0,    pz:  0    },
  supWrist:    { rx:  0.01, ry: -0.13, rz:  0.15, px:  0,    py:  0,    pz:  0    },
  weapon:      { rx:  0.38, ry:  0.32, rz:  0.31, px:  0.01, py: -0.11, pz: -0.25 },
};
const SMG_POSE_AIM = {
  stomach:     { rx:  0,    ry:  0,    rz:  0,    px:  0,    py:  0,    pz:  0    },
  chest:       { rx:  0,    ry: -0.30, rz:  0,    px:  0,    py:  0,    pz:  0    },
  head:        { rx:  0,    ry:  0,    rz:  0,    px:  0,    py:  0,    pz:  0    },
  domShoulder: { rx: -1.05, ry:  0,    rz: -0.12, px:  0,    py:  0,    pz:  0    },
  domElbow:    { rx: -1.70, ry:  0,    rz:  0,    px:  0,    py:  0,    pz:  0    },
  domWrist:    { rx:  0,    ry:  0,    rz:  0,    px:  0,    py:  0,    pz:  0    },
  supShoulder: { rx: -1.88, ry:  0.27, rz:  0.59, px:  0.16, py:  0,    pz:  0.17 },
  supElbow:    { rx: -0.05, ry: -0.04, rz: -0.09, px:  0,    py:  0,    pz:  0    },
  supWrist:    { rx:  0,    ry:  0,    rz:  0,    px:  0,    py:  0,    pz:  0    },
  weapon:      { rx:  1.11, ry:  0.26, rz:  0.11, px:  0.03, py:  0.12, pz: -0.38 },
};
export const SMG_WEAPON_HIP = SMG_POSE_HIP.weapon;
export const SMG_WEAPON_AIM = SMG_POSE_AIM.weapon;

// rifleHold dispatch table — pick the authored pose pair per class.
// Shotgun / sniper / lmg currently inherit the rifle pose until they
// get their own authored data; pistol falls outside rifleHold.
const POSE_BY_CLASS = {
  rifle:   { hip: RIFLE_POSE_HIP, aim: RIFLE_POSE_AIM },
  smg:     { hip: SMG_POSE_HIP,   aim: SMG_POSE_AIM   },
  shotgun: { hip: RIFLE_POSE_HIP, aim: RIFLE_POSE_AIM },
  sniper:  { hip: RIFLE_POSE_HIP, aim: RIFLE_POSE_AIM },
  lmg:     { hip: RIFLE_POSE_HIP, aim: RIFLE_POSE_AIM },
};

// Smoothly drive `current` toward `target` at `rate` per second.
function lerpT(current, target, rate, dt) {
  const k = 1 - Math.exp(-rate * dt);
  return current + (target - current) * k;
}

// Live-tunable procedural pose constants. The rig tuner mutates this
// object directly so changes are visible the very next frame. All
// crouch-related magic numbers in updateAnim() are read from here so
// you can iterate the silhouette without recompiling.
export const POSE_TUNABLES = {
  crouch: {
    // legs — primary pose
    thighFwd: 1.27,
    kneeBend: 1.35,
    kneeGaitStraighten: 0.524,
    strideScale: 0.49,
    swingLift: 0.47,
    kneeFlex: 0.61,
    swingDamp: 0.71,
    // legs — asymmetry (right leg leads in static crouch idle)
    rightThighIdleLead: 0.70,
    rightThighStaticBoost: 0.45,
    rightKneeStaticBoost: 0.25,
    // ankles — additive offset on top of auto-flat compensation.
    ankleAdjust: 0,
    // torso
    hipDrop: 0.26,
    chestLean: 0.26,
    chestMoveLean: 0.0,
    hipPitch: 0.45,
    headCounterPitch: 0.22,
    // gait
    hipRoll: -0.70,
    bobReduction: 1.0,
    plantDipReduction: 0.80,
    stepRate: 0.42,
  },
  // Upright walk / run gait — every value below ALSO matters when not
  // crouched (unlike the crouch.* fields which are crouch-only
  // modifiers that zero out when not crouched). Touching these is the
  // only way to dial back the upright run bob / plant dip / hip roll.
  gait: {
    bobAmplitude: 0.03,           // vertical bob amplitude (m, scaled by rs)
    runBobMult: 1.4,              // run-vs-walk multiplier on the bob
    plantDipAmplitude: 0.015,     // heel-strike hip dip (m, scaled by rs)
    hipRollAmplitude: 0.035,      // gait-driven hip roll (rad)
    // Spinal counter-rotation: hips yaw +sin(cycle), chest counter-yaws
    // -sin(cycle) (in world space), so the upper and lower body twist
    // against each other across the stride. Aim direction is preserved
    // via a 2x subtract on chest.rotation.y. Damped while aiming so ADS
    // doesn't make the hips wiggle under a locked-on shoulder.
    gaitYawAmplitude: 0.08,       // peak hip-yaw amplitude during gait (rad)
    // Forward lean during run was 0.16 (~9°). Bumped to 0.22 (~12.6°)
    // for a more aggressive run silhouette. The arm-lean compensation
    // (`armLeanComp` in updateAnim) subtracts this from shoulder pitch
    // so the gun stays level — verified the chain references runLean
    // directly, not a stale hardcoded constant.
    runLeanWalk: 0.04,            // forward lean per blendWalk
    runLeanRun: 0.22,             // forward lean per blendRun
  },
  // Kneel pose — fires when state.crouched && speed < kneel.threshold.
  // At full blend, overrides the crouch-pose leg rotations (one knee
  // down, the other forward). Set enabled=0 to let the crouch sliders
  // drive static idle.
  kneel: {
    enabled: 1,
    threshold: 0.25,
    leftThigh:  -0.70,
    leftKnee:    1.89,
    rightThigh: -2.24,
    rightKnee:   1.57,
    leftAnkle:   1.0,
    rightAnkle: -0.35,
    hipDrop:     0.32,
    chestLean:   0.18,
    hipPitch:    0.16,
    headCounterPitch: 0.14,
  },
};

// `state` fields expected:
//   speed       — horizontal units/sec (0=idle, <2 walk, >4 run)
//   aimYaw      — radians, 0=neutral (shoulder faces forward)
//   aimPitch    — radians, 0=horizontal
//   aiming      — bool, true enables aim pose blend
//   crouched    — bool, true drops hips + pre-bends legs into a squat.
//                 The walk cycle still layers on top with a smaller
//                 stride so crouch-walk reads as a bent-knee shuffle.
//   recoilImpulse — >0 to trigger a recoil spring (call once per shot)
//   hitImpulse  — { x, z, mag } to trigger a flinch (call once per hit)
//   dying       — bool, true enters a death fall
//   deathImpulse — { x, z, mag } to seed the fall direction (call once)
export function updateAnim(rig, state, dt) {
  if (!rig.anim) initAnim(rig);
  const a = rig.anim;
  const Tc = POSE_TUNABLES.crouch;
  const Tk = POSE_TUNABLES.kneel;
  const Tg = POSE_TUNABLES.gait;

  // --- phase advance driven by ground speed --------------------------
  const speed = state.speed || 0;
  const walkT = Math.min(1, speed / 2.4);
  const runT  = Math.min(1, Math.max(0, (speed - 2.4) / 3.0));
  // Slower blends (was 8 → now 5.5) so starting/stopping doesn't snap
  // the legs into pose — half a beat of ease in and out reads as
  // momentum/inertia. Critical for walk→idle transitions which used
  // to look like the character hit the brakes.
  a.blendWalk = lerpT(a.blendWalk, walkT, 5.5, dt);
  a.blendRun  = lerpT(a.blendRun,  runT,  5.5, dt);
  // Cycle speed: idle sway ~0.9 Hz, walk ~1.6 Hz, run ~2.5 Hz. Halved
  // from the previous values — was running too fast for actual ground
  // speed, feet sliding. Each cycle covers ONE left+right step pair.
  let freq = 0.9 + a.blendWalk * 0.7 + a.blendRun * 0.9;
  // Crouch SPEEDS UP the gait cadence — sneaking reads as fast little
  // shuffle steps, not slow long bike-pedal swings. Reversed from the
  // earlier 0.40 reduction per playtest: 'looks like he's pedaling a
  // bike. legs should be more forward and be more like fast little
  // steps.' Now +35% step rate at full crouch. Combined with the
  // smaller stride amp + reduced swing-lift below, the legs barely
  // leave the centerline and just chitter forward.
  freq *= 1 + (a.crouchBlend || 0) * Tc.stepRate;
  a.cycle += dt * freq * Math.PI * 2;
  const s = Math.sin(a.cycle);
  const s2 = Math.sin(a.cycle * 2);
  // Breath timer — independent from walk cycle so a running enemy
  // doesn't hyperventilate. Slow ~0.3 Hz; slightly faster when
  // crouched (holding a low position is tiring).
  const breathFreq = 0.3 + (a.crouchBlend || 0) * 0.12;
  a.breathT += dt * breathFreq * Math.PI * 2;
  const breath = Math.sin(a.breathT);          // -1..1
  const weightShift = Math.sin(a.breathT * 0.45 + 0.7); // slower, offset

  // --- death fall overrides everything else ---------------------------
  if (state.dying) {
    if (state.deathImpulse && a.deadFallT === 0) {
      const mag = Math.max(0.4, Math.min(3.0, state.deathImpulse.mag || 1));
      a.deadFallMag = mag;
      const len = Math.hypot(state.deathImpulse.x, state.deathImpulse.z) || 1;
      a.deadFallDir.x = state.deathImpulse.x / len;
      a.deadFallDir.z = state.deathImpulse.z / len;
    }
    a.deadFallT = Math.min(1, a.deadFallT + dt * 1.8);
    // Fall as a single axis-angle rotation around the horizontal axis
    // perpendicular to the fall direction. The Euler-decomposed pair
    // (rotation.x AND rotation.z at once) composed into a twisted
    // ~45° pose for diagonal hits — this lays the body flat regardless
    // of the hit direction. Cap at just under 90° so the head mesh
    // doesn't mathematically land at exactly Y=0 (z-fights the ground)
    // but still reads as "flat".
    const fallAmt = Math.min(Math.PI * 0.48, a.deadFallT * (Math.PI * 0.48));
    const dzAxis = a.deadFallDir.z, dxAxis = a.deadFallDir.x;
    const axLen = Math.hypot(dzAxis, dxAxis) || 1;
    if (!a._yawQ)  a._yawQ  = new THREE.Quaternion();
    if (!a._fallQ) a._fallQ = new THREE.Quaternion();
    if (!a._axis)  a._axis  = new THREE.Vector3();
    // Capture the pre-death yaw on the first dying frame BEFORE the
    // quaternion write mangles rotation.y. Subsequent frames reuse
    // the captured value so the body stays facing the direction it
    // died in rather than rotating each frame.
    if (a.bodyYawAtDeath === undefined) a.bodyYawAtDeath = rig.group.rotation.y;
    a._yawQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.bodyYawAtDeath);
    a._axis.set(dzAxis / axLen, 0, -dxAxis / axLen);
    a._fallQ.setFromAxisAngle(a._axis, fallAmt);
    rig.group.quaternion.multiplyQuaternions(a._yawQ, a._fallQ);
    // Whole-body droop — a mid-fall crumple that eases back to zero
    // by the time the body is horizontal, so the final pose lies flat
    // instead of curling limbs through the floor. `droopEnv` peaks
    // near t≈0.5 and lands at 0 when t=1.
    const droopEnv = Math.sin(Math.PI * a.deadFallT);
    const droopK = droopEnv * Math.min(1.3, a.deadFallMag);
    rig.hips.rotation.x  = 0.35 * droopK;
    rig.chest.rotation.x = 0.55 * droopK;
    rig.head.rotation.x  = 0.4  * droopK;
    return;
  }

  // --- hit flinch spring (non-lethal) --------------------------------
  if (state.hitImpulse && a.hitFlinchT <= 0) {
    const mag = Math.max(0.3, Math.min(1.5, state.hitImpulse.mag || 0.6));
    a.hitFlinchT = 0.35 * mag;
    const len = Math.hypot(state.hitImpulse.x, state.hitImpulse.z) || 1;
    a.hitFlinchDir.x = state.hitImpulse.x / len;
    a.hitFlinchDir.z = state.hitImpulse.z / len;
  }
  a.hitFlinchT = Math.max(0, a.hitFlinchT - dt);
  const flinchK = a.hitFlinchT > 0 ? a.hitFlinchT / 0.35 : 0;

  // --- aim blend (enemies + player when firing/aiming) ---------------
  // Accepts either a boolean (enemies: 0 or 1) or a float 0..1
  // (player: continuous ADS ease from adsAmount).
  const aimTarget = typeof state.aiming === 'number'
    ? Math.max(0, Math.min(1, state.aiming))
    : (state.aiming ? 1 : 0);
  // Aim blend rate softened (was 10 → 6.5) so ADS up/down has visible
  // ramp instead of teleporting the arms between chest-hold and head
  // aim. Still fast enough that combat reads as responsive — eyeballs
  // can track the arms moving through the transition rather than
  // seeing them snap.
  a.aimBlend = lerpT(a.aimBlend, aimTarget, 6.5, dt);
  // --- dash lean ----------------------------------------------------
  // Dashing pitches the whole body forward like a lunge; blends back
  // smoothly on exit so the character doesn't snap upright. Was 12 →
  // 8 for a softer ease back to upright; the dash itself still kicks
  // in fast because the impulse on `dashing=true` is one frame of full
  // blend toward 1.
  if (a.dashBlend === undefined) a.dashBlend = 0;
  a.dashBlend = lerpT(a.dashBlend, state.dashing ? 1 : 0, 8, dt);
  // --- crouch + kneel blends ----------------------------------------
  // Crouch is the "low-ready shuffle" pose. Kneel kicks in on top of
  // crouch when the player is nearly stationary — one knee touches
  // the ground so the character reads as a deliberate "holding this
  // position" stance instead of a tiptoe squat. Speed threshold is
  // generous so the pose doesn't flicker on micro-adjustment taps.
  a.crouchBlend = lerpT(a.crouchBlend, state.crouched ? 1 : 0, 9, dt);
  const wantsKneel = state.crouched && speed < Tk.threshold && Tk.enabled > 0.5;
  a.kneelBlend = lerpT(a.kneelBlend, wantsKneel ? 1 : 0, 5, dt);

  // --- recoil spring (call once per shot) ----------------------------
  // Longer decay window (0.22s, was 0.18s) so the arm doesn't snap
  // back instantly — reads as weight.
  if (state.recoilImpulse) {
    a.recoilT = Math.max(a.recoilT, 0.22);
  }
  a.recoilT = Math.max(0, a.recoilT - dt);
  // Three-phase curve: overshoot spike (0-25%), ease-out settle
  // (25-85%), micro-rebound (85-100%). The rebound is a tiny
  // damped oscillation pulling past zero and back, giving the
  // weapon a visible "return to ready" nudge rather than a flat
  // fade to rest.
  const recRaw = a.recoilT > 0 ? (a.recoilT / 0.22) : 0;
  let recK;
  if (recRaw > 0.75) {
    recK = 1.0 + (recRaw - 0.75) * 0.6;             // initial overshoot spike
  } else if (recRaw > 0.15) {
    recK = Math.pow((recRaw - 0.15) / 0.60, 0.7);   // ease-out settle
  } else {
    // Last 15% — dipped micro-rebound (-0.12 at recRaw≈0.075, back to 0 at 0).
    const t = recRaw / 0.15;                        // 0..1 over the rebound
    recK = -0.12 * Math.sin(t * Math.PI);
  }

  // --- pose: legs -----------------------------------------------------
  // Three pose modes compose here:
  //
  //   1. Walk cycle: thighs sin-swing ±, knees flex on the forward
  //      phase (positive rot.x on the knee tucks the calf backward —
  //      how a real knee bends).
  //   2. Crouch (moving): both legs pitch forward, knees flex deeper,
  //      ankles compensate so feet stay flat, stride shrinks. Deeper
  //      than the first pass now — user feedback said the old squat
  //      wasn't low enough.
  //   3. Kneel (crouched + stationary): asymmetric — left leg folds
  //      so the knee lands on the ground, right (front) leg bends
  //      with foot flat. Overwrites the walk / crouch pose; blends
  //      out when the player starts moving.
  //
  // Walk and crouch compose additively; kneel replaces both via the
  // kneelBlend factor.
  const crouch = a.crouchBlend;
  const kneel = a.kneelBlend;
  // Gait blend (declared early — crouch-knee straightening reads it).
  const gaitT = a.blendWalk + a.blendRun * 1.15;
  // Crouch-walk pose — deeper squat for the slick sneak silhouette.
  // +30° forward thigh tilt at the hip for both idle and walk/run.
  // During walk/run the knee is straightened 30° to compensate so
  // the foot doesn't clip the ground with the extra forward lean.
  const crouchThigh = -crouch * Tc.thighFwd;
  const crouchKneeBase =  crouch * Tc.kneeBend;
  const crouchKnee  = crouchKneeBase - crouch * gaitT * Tc.kneeGaitStraighten;
  const crouchAnkle = -(crouchThigh + crouchKneeBase);
  // Sneak stride — much shorter than upright walk. The back-leg in
  // stance was extending too far rearward at the previous 0.32
  // attenuation; user described as 'pedaling a bike.' Now 0.65 cut
  // (full crouch = 35% of upright stride length) so the swinging
  // leg never reaches far behind the hip.
  const strideScale = 1 - crouch * Tc.strideScale;
  // How much the static "leading leg" offset survives when actively
  // moving. At full crouch-stand (crouchMoveDamp ≈ 1) the front-leg
  // bias dominates so the character reads as poised on one knee.
  // Once gait kicks in (crouchMoveDamp eases toward 0 with gaitT),
  // both legs alternate symmetrically again so neither stays glued
  // forward — that asymmetry was the "limp" reading.
  const crouchMoveDamp = Math.max(0, 1 - (a.blendWalk + a.blendRun) * 1.5);

  // Gait curve (per leg). Each leg has a 2π cycle; the left leg runs
  // on `a.cycle` and the right leg is offset by π so they alternate.
  //
  // Phase convention:
  //   0, 2π — neutral (thigh passing vertical, transitioning)
  //   π/2   — thigh max BACKWARD (toe-off, in stance)
  //   π     — neutral (mid-swing — thigh passing vertical again)
  //   3π/2  — thigh max FORWARD (heel-strike)
  //
  //   SIGN convention (from actor_rig's rotation math): positive
  //   rotation on the thigh pivot swings the leg BACKWARD. Negative =
  //   forward.
  //
  // For each leg we compute:
  //   `sway`  = base sine swing (positive = backward during stance)
  //   `win`   = a mid-swing window (0..1, peaks at mid-swing) used to
  //             drive BOTH the extra forward thigh push (high-knee
  //             lead) and the knee flex (clear the ground).
  //
  // This replaces the old "knee only bends when sin>0" symmetry —
  // that made the knee bend during stance/toe-off instead of during
  // swing, producing the stiff compass-walk look. Now the knee flex
  // peaks at mid-swing (phase=π), which is when a real leg's knee is
  // highest.
  const strideAmp = (a.blendWalk * 0.45 + a.blendRun * 0.25) * strideScale;
  // Swing-forward lift: extra negative (forward) thigh angle at
  // mid-swing. Run uses a big value to produce the high-knee look.
  // Crouch suppresses this hard — fast small steps don't need the
  // dramatic mid-swing forward push that produces the bike-pedal arc.
  const crouchSwingDamp = 1 - crouch * Tc.swingDamp;
  const swingLift = (a.blendWalk * 0.25 + a.blendRun * 0.50) * strideScale * crouchSwingDamp * (1 - crouch * Tc.swingLift);
  // Knee flex during swing — run flexes harder to clear ground.
  // The +crouch * 0.45 bonus was added earlier so the swinging foot
  // could clear the floor given the dropped hip. Now that the stride
  // amp is cut to 35% and swingLift is damped, the foot's traversal
  // distance is small enough that the bonus over-bends the knee.
  // Trimmed 0.45 → 0.18.
  const kneeFlex  = (a.blendWalk * 0.85 + a.blendRun * 1.30) * strideScale + crouch * Tc.kneeFlex * gaitT;
  // Ankle heel-toe roll: toe-UP at heel-strike (phase=3π/2), toe-DOWN
  // at toe-off (phase=π/2). Using `sin(phase)` with the convention
  // that positive ankle rotation = plantarflex (toe-down) gives the
  // right phasing.
  const ankleRoll = 0.35 * gaitT * strideScale * (1 - crouch * 0.75);

  const leftWin  = (1 - Math.cos(a.cycle)) / 2;     // peaks at mid-swing (phase=π)
  const rightWin = (1 + Math.cos(a.cycle)) / 2;     // offset by π, opposite phase

  const leftThighGait  =  strideAmp * s - swingLift * leftWin;
  const rightThighGait = -strideAmp * s - swingLift * rightWin;
  const leftKneeGait   = kneeFlex * leftWin;
  const rightKneeGait  = kneeFlex * rightWin;
  const leftFootRoll   =  Math.sin(a.cycle) * ankleRoll;
  const rightFootRoll  = -Math.sin(a.cycle) * ankleRoll;

  // Base (walk + crouch) leg rotations — kneel pose will overwrite
  // them below when kneelBlend > 0.
  //
  // Right leg gets EXTRA forward thigh + knee bend during STATIC
  // crouch so the right knee sits noticeably in front of the left
  // (athletic poised stance). Once the character starts walking, this
  // asymmetric bias dampens via crouchMoveDamp so the gait reads as
  // alternating legs instead of a permanent limp.
  // Right leg pushed an extra 0.3 rad forward during the static crouch
  // idle. Damped by crouchMoveDamp so the bias fades once gait kicks in.
  const rightCrouchThigh = crouchThigh * (1 + Tc.rightThighStaticBoost * crouchMoveDamp) - Tc.rightThighIdleLead * crouch * crouchMoveDamp;
  const rightCrouchKnee  = crouchKnee  * (1 + Tc.rightKneeStaticBoost * crouchMoveDamp);
  let leftThighRot  = leftThighGait  + crouchThigh;
  let rightThighRot = rightThighGait + rightCrouchThigh;
  let leftKneeRot   = leftKneeGait   + crouchKnee;
  let rightKneeRot  = rightKneeGait  + rightCrouchKnee;
  // Ankle: partial compensation for knee bend + heel-toe roll +
  // crouch offset. Heel-toe roll is amplified during a crouch-walk
  // so sneaking reads as deliberate toe-down/heel-up footing instead
  // of flat slabs of foot.
  const sneakRollBoost = 1 + crouch * 0.6 * gaitT;
  const rightCrouchAnkle = -(rightCrouchThigh + rightCrouchKnee);
  // ankleAdjust is added to both ankles on top of the auto-flat
  // compensation. Scaled by `crouch` so the offset only applies
  // while crouched (standing pose isn't dragged off-axis).
  let leftAnkleRot  = -leftKneeGait  * 0.35 + leftFootRoll  * sneakRollBoost + crouchAnkle  + crouch * Tc.ankleAdjust;
  let rightAnkleRot = -rightKneeGait * 0.35 + rightFootRoll * sneakRollBoost + rightCrouchAnkle + crouch * Tc.ankleAdjust;

  if (kneel > 0.01) {
    // Kneel pose targets — calibrated for the current leg proportions
    // (thighH=0.42, calfH=0.59, hipY=1.1). The cumulative thigh+knee
    // rotation MUST stay under π/2 for the rear leg, otherwise the
    // calf flips into the up-and-back quadrant (scorpion tail) instead
    // of down-and-back (proper folded kneel).
    //
    //   Left (rear) leg:
    //     thigh +0.30 rad → knee drops slightly back and down
    //     knee  +0.70 rad → moderate bend; cumulative 1.00 rad (57°)
    //                       keeps the calf down-and-back from the knee.
    //   Right (front) leg:
    //     thigh -1.57 rad (90°) → thigh horizontal forward, knee out front
    //     knee  +1.57 rad → calf counter-rotates to vertical so the
    //                       front foot plants directly below the knee.
    const kL_thigh = Tk.leftThigh;
    const kL_knee  = Tk.leftKnee;
    const kR_thigh = Tk.rightThigh;
    const kR_knee  = Tk.rightKnee;
    leftThighRot  = leftThighRot  * (1 - kneel) + kL_thigh * kneel;
    leftKneeRot   = leftKneeRot   * (1 - kneel) + kL_knee  * kneel;
    // Ankle = auto-flat compensation (-(thigh + knee)) + additive
    // offset from POSE_TUNABLES.kneel.{left,right}Ankle. Default
    // offset is 0 so foot stays flat.
    leftAnkleRot  = leftAnkleRot  * (1 - kneel) + (-(kL_thigh + kL_knee) + Tk.leftAnkle) * kneel;
    rightThighRot = rightThighRot * (1 - kneel) + kR_thigh * kneel;
    rightKneeRot  = rightKneeRot  * (1 - kneel) + kR_knee  * kneel;
    rightAnkleRot = rightAnkleRot * (1 - kneel) + (-(kR_thigh + kR_knee) + Tk.rightAnkle) * kneel;
  }

  // Melee ready stance — subtle thigh + knee bend so the character
  // stands slightly loaded instead of ramrod straight. Kept small
  // (~4° thigh, ~11° knee) so the silhouette doesn't read as a
  // forward tip. Chest adds a matching gentle waist bend below so
  // the posture is balanced through the spine, not just the legs.
  if (state.meleeStance && !state.sleeping) {
    const readyThigh = 0.06;
    const readyKnee  = 0.18;
    leftThighRot  += readyThigh;
    rightThighRot += readyThigh;
    leftKneeRot   += readyKnee;
    rightKneeRot  += readyKnee;
    leftAnkleRot  -= (readyThigh + readyKnee) * 0.5;
    rightAnkleRot -= (readyThigh + readyKnee) * 0.5;
  }
  rig.leftLeg.thigh.pivot.rotation.x  = leftThighRot;
  rig.rightLeg.thigh.pivot.rotation.x = rightThighRot;
  rig.leftLeg.knee.rotation.x  = leftKneeRot;
  rig.rightLeg.knee.rotation.x = rightKneeRot;
  rig.leftLeg.ankle.rotation.x  = leftAnkleRot;
  rig.rightLeg.ankle.rotation.x = rightAnkleRot;

  // --- pose: torso + head --------------------------------------------
  // Idle strength + breath outputs need to resolve BEFORE we write
  // hip Y and chest pitch, since both read breathRise/breathPitch.
  const moveBlend = Math.min(1, a.blendWalk + a.blendRun);
  const idleStrength = (1 - moveBlend) * (1 - a.aimBlend * 0.6);
  const idleStandStrength = idleStrength * (1 - crouch * 0.5);
  // Weight-shift: hips roll side-to-side on a slow cycle, and one
  // shoulder drops in sympathy so the character "rests on one leg".
  // weightShift cycles -1..+1 over ~4.5s. Bumped hip roll ~50% so
  // standing characters visibly settle their weight back and forth
  // rather than reading as a mannequin.
  const idleHeadYaw = Math.sin(a.breathT * 0.35 + 1.2) * 0.22 * idleStandStrength;
  const idleHipRoll = weightShift * 0.085 * idleStandStrength;
  const idleShoulderDrop = -weightShift * 0.08 * idleStandStrength;
  // Idle weapon micro-drift — a tiny breath-driven offset on the
  // weapon-side shoulder so a stationary aiming pose has the gun
  // gently rising / falling with the actor's chest. Real shooters
  // can never hold a weapon perfectly still; this sells "alive" at
  // ranged-hold time. Suppressed during walk/run so it doesn't fight
  // the gait sway.
  const idleWeaponDrift = breath * 0.022 * (1 - moveBlend) * (0.4 + a.aimBlend * 0.6);
  // Breath — chest pitches very slightly and the upper body rises a
  // hair (hips stay planted). Amplitude is subtle because even a
  // little motion reads as alive.
  const breathPitch = breath * 0.018 * (1 - moveBlend * 0.7);
  const breathRise  = breath * 0.006 * (1 - moveBlend * 0.7);
  // Vertical bob from walk/run — tiny because we don't want the camera
  // anchor jittering. Bob shrinks in crouch because the squat absorbs
  // most of the vertical delta through the knees.
  // All Y offsets below are raw metres that must scale with the actor's
  // overall size — a 0.77 scale rig should bob half as much as a
  // full-size rig. Multiplying through by rig.scale keeps proportions
  // stable across every caller's scale value.
  const rs = rig.scale;
  const bob = Tg.bobAmplitude * s2 * (a.blendWalk + a.blendRun * Tg.runBobMult) * (1 - crouch * Tc.bobReduction) * rs;
  // Hip drop scales with crouch depth and then drops further during
  // the kneel — the front leg's near-horizontal thigh means the hip
  // has to be ~0.43m lower than standing for the front foot to plant.
  // Re-tuned for hipY=1.1 / thighH=0.42 / calfH=0.59 (long-leg proportions).
  // Deeper hip drop so the crouched silhouette reads as a real squat,
  // not a half-bend. 0.16 → 0.26 (~16cm extra drop at full scale).
  const crouchHipDrop = (crouch * Tc.hipDrop + kneel * Tk.hipDrop) * rs;
  // Foot-plant impact dip — at heel-strike (cos(cycle) ≈ ±1) the hip
  // drops a couple cm to sell weight transfer onto the planted leg.
  // cos² peaks at both heel strikes per cycle (left foot at 0, right
  // foot at π). Scales with gait intensity.
  const plantDip = -Tg.plantDipAmplitude * Math.cos(a.cycle) * Math.cos(a.cycle)
                 * (a.blendWalk + a.blendRun) * (1 - crouch * Tc.plantDipReduction) * rs;
  const hipYBase = (rig.dims?.hipY ?? 0.92) * rs;
  rig.hips.position.y = hipYBase + bob - crouchHipDrop + breathRise * rs + plantDip;
  // Stomach counter-rotates slightly so the character doesn't feel
  // stiff on the cycle.
  rig.stomach.rotation.y = 0.10 * s * (a.blendWalk + a.blendRun * 0.6);

  // Chest twist / lean from aim + flinch + recoil, plus a forward
  // fold during crouch and an extra tip during kneel so the upper
  // body reads as "settled over the front knee". Dashing adds a
  // straight-line forward lunge on top. Running adds a smaller
  // forward lean (body leans into the run).
  // Chest twist — full aim-relative delta from the caller. Player
  // passes the computed chest-twist (already constrained to ±90°);
  // enemies pass 0 since their body already faces the player.
  const chestAimYaw = state.aimYaw || 0;
  const chestFlinch = flinchK * -0.22;
  // Crouch chest hunch — deeper forward fold so the actor reads as
  // settling weight low + forward, the classic stalker silhouette.
  // Extra fold during a crouch-walk (not just static crouch) so
  // sneaking has a deliberate "creeping in" shape vs standing crouch.
  const crouchMoveLean = crouch * gaitT * Tc.chestMoveLean;
  const crouchLean = crouch * Tc.chestLean + kneel * Tk.chestLean + crouchMoveLean;
  const dashLean = a.dashBlend * 0.28;
  // Run lean is suppressed while crouched — the crouch pose is
  // already hunched forward, so stacking the full run lean on top
  // "crunches" the character into a forward dash. Hold the low-run
  // at roughly the crouch lean angle instead of piling another 9° on.
  // Melee ready stance damps the running forward lean — sprinting
  // with the existing runLean on top of the bent-knee ready posture
  // stacks into an unnatural forward tip. Halving it keeps the sense
  // of forward momentum without the character looking like they're
  // about to fall over. The waist bend below then adds a deliberate
  // small spine flex so the upper body still reads as "coiled".
  const meleeActive = !!state.meleeStance && !state.sleeping;
  const rawRunLean = (a.blendWalk * Tg.runLeanWalk + a.blendRun * Tg.runLeanRun) * (1 - crouch * 0.85);
  const runLean = meleeActive ? rawRunLean * 0.5 : rawRunLean;
  const meleeWaistBend = meleeActive ? 0.08 : 0;
  // Spinal counter-rotation during gait — hips swing one way, chest
  // counter-swings the other so the torso twists across the stride.
  // Subtracting 2x the gait yaw from chest.rotation.y means the chest's
  // WORLD yaw equals chestAimYaw - gaitHipYaw (chest's local + parent's
  // yaw): aim stays correct, but the hips rotate UNDER a stable chest.
  // Damped during aim so ADS doesn't spin the hips. Suppressed while
  // crouching since the crouch pose already locks the hips. Disabled
  // entirely during melee (hips zeroed by the swing block at line ~1873).
  const gaitYawAmp = Tg.gaitYawAmplitude * gaitT * (1 - a.aimBlend * 0.6) * (1 - crouch * 0.7);
  const gaitHipYaw = s * gaitYawAmp;
  rig.hips.rotation.y = gaitHipYaw;
  rig.chest.rotation.y = chestAimYaw - 2 * gaitHipYaw;
  rig.chest.rotation.x = chestFlinch - recK * 0.06 + crouchLean + dashLean + runLean + breathPitch + meleeWaistBend;
  // Hip pitch matches the chest hunch so the spine doesn't break — a
  // deeper crouch chest fold without matching hip pitch reads as a
  // bent torso rather than a settled squat.
  rig.hips.rotation.x = crouch * Tc.hipPitch + kneel * Tk.hipPitch + a.dashBlend * 0.22;

  // Head follows aim pitch/yaw with a bit of extra snap. A small
  // counter-pitch during crouch/kneel keeps the head level-ish
  // rather than dropping with the torso lean. Idle enemies (no aim
  // signal, no walk) get a slow head-scan + subtle hip sway so
  // they don't look frozen while patrolling — each actor's cycle
  // was randomized at initAnim so squads de-sync.
  //
  // aimPitch sign: positive = target above shoulder (looking up).
  // For head.rotation.x around X, NEGATIVE rotation tilts the face
  // upward (the default forward is +Z, and -X rotation takes +Z
  // toward +Y). So we subtract aimPitch, not add it.
  const aimPitchV = state.aimPitch || 0;
  // Head stabilization — the head should ride roughly level when
  // walking/running instead of bobbling up and down with the hips.
  //
  // 1. Translate head DOWN by ~70% of the hip bob so the head's
  //    world Y only changes by ~30% of what the torso does. Not
  //    100% because some vertical motion still reads as "gait",
  //    just less than the hips.
  // 2. Counter-pitch the neck against the chest pitch (breath,
  //    crouch lean, recoil) so the face stays facing forward even
  //    as the torso tilts. Strong enough to feel alive, not so
  //    strong that it looks like a gimbal.
  const chestPitch = rig.chest.rotation.x;
  const headYBase = (rig.dims?.head?.headY ?? 0.14) * rig.scale;
  rig.head.position.y = headYBase - bob * 0.7;
  rig.head.rotation.y = a.aimBlend * (state.aimYaw || 0) * 0.6 + idleHeadYaw;
  rig.head.rotation.x = -aimPitchV * (0.35 + a.aimBlend * 0.45)
                      - crouch * Tc.headCounterPitch - kneel * Tk.headCounterPitch
                      - chestPitch * 0.6;
  // Hip roll — combines slow idle weight-shift with a small gait-
  // driven sway. Standing walk gets a subtle roll; crouching adds a
  // light bump (was ×2.4, now ×1.2) so sneaking still reads as
  // weight-shifting onto the planted foot but doesn't waddle.
  const gaitHipRoll = Math.cos(a.cycle) * Tg.hipRollAmplitude * gaitT * (1 + crouch * Tc.hipRoll);
  rig.hips.rotation.z = idleHipRoll + gaitHipRoll;

  // Femme contrapposto idle — hip cocked, opposite shoulder dropped,
  // slight head tilt. Detected via the bust-dim presence (female DIMS
  // are the only overlay that defines head.bust). Gated on idle: gait
  // blend zero, no aim, no swing/melee/block. Damped by breath so it
  // breathes naturally instead of locking into a rigid pose.
  const isFemme = !!rig.dims?.head?.bust;
  const contrappostoGate = isFemme
    ? Math.max(0, 1 - gaitT) * (1 - a.aimBlend) * (1 - (a.dashBlend || 0)) * (1 - crouch * 0.7)
        * (state.attacking || state.blockPose || state.meleeStance ? 0 : 1)
    : 0;
  if (contrappostoGate > 0.02) {
    const cf = contrappostoGate * (0.85 + breath * 0.15);
    // Hip cock: right hip down → weight on right leg. +Z rotation
    // raises the LEFT side of the hips, so the apparent stance is
    // weight-on-right.
    rig.hips.rotation.z += cf * 0.07;
    // Chest counter-tilt: shoulders compensate the hip cock.
    rig.chest.rotation.z = (rig.chest.rotation.z || 0) - cf * 0.04;
    // Head tilt: a touch in the same direction as the chest.
    rig.head.rotation.z = (rig.head.rotation.z || 0) + cf * 0.05;
  }

  // --- pose: arms -----------------------------------------------------
  // Both hands are always on the weapon: the baseline pose is a
  // chest-level two-handed hold (ready-aim), and the ADS pose
  // (aim-blend = 1) raises the weapon to head level for precision
  // fire. The support arm mirrors the weapon-hand pitch but rotates
  // inward so the support hand meets the gun at the centerline.
  //
  // Handedness selects which arm holds the gun and which provides
  // support. The caller re-parents the weapon mesh to the matching
  // hand; the rig just needs to apply the right pose to each arm.
  const handed = state.handedness === 'left' ? 'left' : 'right';
  const weaponArm  = handed === 'right' ? rig.rightArm : rig.leftArm;
  const supportArm = handed === 'right' ? rig.leftArm  : rig.rightArm;
  // Support-yaw sign mirrors by side — +z on the LEFT shoulder swings
  // its arm rightward (across body), -z on the RIGHT shoulder does
  // the same for a left-handed hold.
  const supportYawSign = handed === 'right' ? 1 : -1;
  //
  // Angles: cumulative forearm rotation equals −π/2 in both poses so
  // the forearm stays horizontal (gun level). Pitch split between
  // shoulder and elbow controls how raised the weapon ends up.
  //
  //   Chest hold: shoulder −0.60 + elbow −0.97 → hand y ≈ 1.34m
  //   Head aim:   shoulder −1.75 + elbow +0.18 → hand y ≈ 1.72m
  //
  // The old rest/low-ready pose with the gun angled down is gone —
  // now every shot reads as "aimed". The ADS pose pushes the upper
  // arm past horizontal so the hand rises to cheek/eye height.
  //
  // When crouched/kneeled, the chest + hips pitch forward (see the
  // torso block above), so without compensation the arm chain
  // inherits that pitch and dumps the muzzle at the floor. The
  // `crouchPoseBias` below tucks the upper arm back toward vertical
  // and deepens the elbow bend so the gun rides close to the chest
  // pointing slightly up — matches the "tight tuck, muzzle raised"
  // stance the user wanted.
  //
  // Aim pitch: positive pitch = target above firing origin, so the
  // upper arm needs MORE negative rotation.x (more forward-up).
  // Subtract aimPitch — both chest and ADS poses track vertical aim.
  // Crouch pose used to add a +0.50 rad `crouchBias` to shoulder
  // pitch (lifting the arm toward vertical) and a +1.16 rad
  // `tuckBias` to elbow bend (folding the forearm up), producing a
  // "muzzle raised, tight tuck" silhouette. That broke the
  // always-parallel-to-ground rule for guns — the combined rotations
  // ended up with the forearm pointing at the ceiling. Both biases
  // are now zero so crouching keeps the arm in its standing
  // forward-low pose; the chest/hips pitch still compresses the
  // character down, but `armLeanComp` below cancels that out on the
  // arm itself so the weapon stays level.
  const crouchBias = 0;
  const tuckBias   = 0;
  // No-weapon idle: arms hang at the sides instead of holding an
  // invisible rifle at chest level. Triggers when the actor isn't in
  // a weapon stance (rifleHold / meleeStance / akimbo / blockPose) and
  // isn't actively swinging or aiming. Default chest-hold pose stays
  // for any actor carrying a weapon — they always set rifleHold or
  // meleeStance, so this only flips for unarmed idles (player without
  // an equip, NPCs in dialogue, etc.).
  const noWeaponPose = !state.rifleHold && !state.meleeStance
                     && !state.akimbo && !state.attacking
                     && !state.blockPose && !state.aiming;
  const chestShoulderPitch = noWeaponPose
    ? -0.08 - aimPitchV * 0.10
    : (-0.60 - aimPitchV * 0.55 + crouchBias);
  const chestElbow = noWeaponPose
    ? -0.18
    : (-0.97 - tuckBias);
  const headShoulderPitch  = -1.75 - aimPitchV * 0.80 + crouchBias * 0.40;
  const headElbow          =  0.18 - tuckBias * 0.40;
  // Chest-lean compensation — when the chest tilts forward for a run
  // lean / dash / crouch, the arms (which are children of the chest)
  // inherit that tilt and the gun tips DOWN relative to the world.
  // Subtracting the steady lean contribution from the shoulder pitch
  // keeps the gun level with the ground. Breath/flinch/recoil are
  // intentionally NOT compensated — those should carry through to
  // the arms for natural coupling.
  // Arm-lean compensation must subtract BOTH the chest forward pitch
  // (crouchLean + dashLean + runLean) AND the hips forward pitch
  // (Tc.hipPitch + Tk.hipPitch + dashBlend * 0.22). Arms are
  // children of chest which is a child of hips, so both rotations
  // accumulate down the chain and push the gun barrel downward.
  // Use the actual tunable hip-pitch values so compensation stays
  // exact when POSE_TUNABLES.crouch.hipPitch or .kneel.hipPitch is
  // adjusted — the old hardcoded 0.18 / 0.10 were stale (Tc.hipPitch
  // is 0.45, Tk.hipPitch is 0.16) and left ~0.27 rad uncompensated,
  // drooping the gun barrel ~15° below horizontal while crouching.
  const hipsLean = crouch * Tc.hipPitch + kneel * Tk.hipPitch + a.dashBlend * 0.22;
  const armLeanComp = runLean + dashLean + crouchLean + hipsLean;
  const rightShoulder = chestShoulderPitch * (1 - a.aimBlend)
                       + headShoulderPitch * a.aimBlend;
  const rightElbow    = chestElbow * (1 - a.aimBlend)
                       + headElbow * a.aimBlend;
  // Chest now carries the full aim-twist delta (see chestAimYaw
  // above). Arms are children of the chest so they inherit that
  // rotation automatically — no additional shoulder-yaw needed.
  // Previously this block added a small extra arm rotation.z to
  // compensate for the chest only taking 35% of the aim yaw; with
  // the new decoupled-body setup that compensation would push the
  // arms past the aim target.
  const aimShoulderYaw = 0;
  const recoilKick = recK * 0.5;    // arm yanks up on fire
  // Walk-phase arm sway — layered on top of the weapon hold so walking
  // enemies read as "carrying a weapon, in motion" instead of
  // "statue holding a rifle". Left/right arms counter-swing against
  // each other and against the legs (left leg forward → left arm
  // back). Scales down as aim tightens (ADS freezes the arms).
  // Rifle-hold + melee-stance blocks further below stomp this, so
  // long-gun carriers don't get a layered sway on top of a locked
  // shouldered pose — which would look like weapon drift.
  // Arms counter-swing legs (opposite-side sync: left leg forward →
  // right arm forward). Previously same-side, which looks like a
  // "robotic" match rather than natural gait.
  const armSwayAmp = 0.22 * gaitT * strideScale * (1 - a.aimBlend * 0.65);
  const leftArmSway  = -s * armSwayAmp;
  const rightArmSway = +s * armSwayAmp;
  // Melee swing — `swingProgress` is -1..+1 across the full
  // startup→active→recovery arc. -1 = cocked back, 0 = impact frame,
  // +1 = followed through. The STYLE chooses which axes are driven
  // and by how much so each swing reads as a distinct motion:
  //
  //   horizontal — classic side sweep, chest twists through the arc
  //   overhead   — weapon raises vertically, drops with a chest crunch
  //   thrust     — straight forward stab, elbow extends sharply
  //   critical   — big wind-up + whole-body rotation on the follow
  //
  // Whole-arm impact: in addition to shoulder.x/z and elbow, every
  // style also drives an extra `bodyTwist` on the chest (yaw) and
  // `bodyPitch` on the hips so the upper body rotates INTO the
  // strike. That body rotation is what sells weight — without it
  // only the wrist moves, which reads as a slap.
  const swingP = state.swingProgress || 0;          // -1..+1
  const swingMag = Math.abs(swingP);                 // 0..1 wind-up / follow strength
  const activePhase = swingP >= -0.5 ? 1 : 0;        // rough: 1 while striking, 0 during cock
  const handSign = handed === 'right' ? -1 : 1;      // right arm sweeps -X
  const swingStyle = state.swingStyle || 'horizontal';
  const isCritSwing = !!state.swingIsCrit;

  // Per-style contribution table. Each style maps swingP to the
  // rig's shoulder pitch, shoulder yaw, elbow extension, and chest
  // twist. All styles normalise so swingP=0 is the moment of impact.
  // Hips are deliberately NOT driven — the legs stay planted and the
  // whole motion is upper-body only. That keeps footing readable
  // during a swing and stops the body from over-rotating off-facing.
  let swingX = 0, swingZ = 0, swingElbowExt = 0;
  let bodyTwist = 0;       // added to chest.rotation.y
  let bodyPitch = 0;       // added to chest.rotation.x (crunch)
  // Helper — amplify wind-up and follow-through ends so the strike
  // has a pronounced cock-back and overshoot past centerline,
  // instead of linear interpolation that reads as a soft arc.
  // Input swingP ∈ [-1, +1]; output biases both endpoints further.
  const punchy = (p) => p * (0.85 + 0.35 * Math.abs(p));   // ~1.0 at ends, ~0.85 near middle → stretched extremes
  if (swingStyle === 'overhead') {
    // Arm rises high during cock (negative shoulder.x = weapon
    // goes UP in this rig), then drives down through the active
    // phase with a forward chest crunch. Wind-up goes past
    // vertical; follow-through drops the arm well below shoulder.
    swingX = swingP < 0 ? punchy(swingP) * 1.75 : punchy(swingP) * -0.80;
    swingZ = handSign * swingP * 0.40;                  // minor sideways sweep
    swingElbowExt = swingP > 0 ? -swingP * 0.70 : swingP * 0.55;
    bodyPitch = (swingP > 0 ? swingP : 0) * 0.52;       // big forward crunch on downswing
    bodyTwist = handSign * swingP * 0.20;
  } else if (swingStyle === 'thrust') {
    // Cock pulls elbow way back + arm tucks in, active LAUNCHES
    // the arm forward with the shoulder leading. Extra shoulder
    // rotation on the follow-through gives a pronounced lunge feel.
    swingX = -swingMag * 0.30;
    swingZ = handSign * -0.55 * swingMag;               // tucked in during cock
    swingElbowExt = swingP < 0 ? punchy(swingP) * 1.25 : -punchy(swingP) * 1.25;
    bodyTwist = handSign * punchy(swingP) * -1.00;      // shoulder drives hard forward
  } else if (swingStyle === 'critical') {
    // Biggest commit: baseball-bat-style wind-up past the
    // shoulder, huge chest rotation, weapon arm crosses all the
    // way to the opposite hip on follow-through.
    swingX = -swingMag * 0.55;
    swingZ = handSign * punchy(swingP) * 2.80;          // very wide arc, crosses far past centerline
    swingElbowExt = swingP > 0 ? -swingP * 0.65 : swingP * 0.55;
    bodyTwist = handSign * punchy(swingP) * -1.45;      // full upper-body unwind
    bodyPitch = swingMag * 0.18;
  } else {
    // horizontal (default) — big side-to-side arc that reads as
    // clearly horizontal. Arm pulls ALL the way behind during
    // cock, whips through impact, continues past centerline on
    // follow-through to the opposite shoulder. Shoulder pitch is
    // kept small (no diagonal chop) and the chest twists deep
    // both directions so the upper body drives the strike.
    swingX = -swingMag * 0.10;                          // near-flat — keeps silhouette horizontal
    swingZ = handSign * punchy(swingP) * 2.50;          // ~143° arc with stretched ends (wind-up + follow-through)
    swingElbowExt = swingP > 0 ? -swingP * 0.55 : swingP * 0.40;
    bodyTwist = handSign * punchy(swingP) * -1.30;      // chest loads opposite on cock, unwinds hard through impact
  }

  // Per-arm sway lookup — which side is the weapon vs support swaps
  // with handedness. The weapon arm must stay close to centerline
  // (it holds the gun), so its sway amplitude is halved; the
  // support arm gets the full sway. Idle-weight-shift drop applies
  // to the weapon shoulder as a small pitch-down on the "resting
  // side" so the character reads as leaning on one leg.
  const weaponSideSway  = (handed === 'right' ? rightArmSway : leftArmSway) * 0.5;
  const supportSideSway = (handed === 'right' ? leftArmSway  : rightArmSway);
  weaponArm.shoulder.pivot.rotation.x = rightShoulder - armLeanComp - recoilKick + swingX + weaponSideSway + idleShoulderDrop + idleWeaponDrift;
  weaponArm.shoulder.pivot.rotation.z = -aimShoulderYaw + swingZ;
  const elbowPump = Math.abs(weaponSideSway) * 0.5;
  // Tiny breath-driven elbow pulse on top of the recoil-kick recovery
  // so the weapon arm settles with a hint of life when stationary,
  // not just when firing. Couples the support arm's elbow below.
  weaponArm.elbow.rotation.x = rightElbow + recK * 0.25 + swingElbowExt - elbowPump + idleWeaponDrift * 0.4;
  // Stash upper-body swing contributions on scratch fields — the
  // chest assignment below (after this block) picks them up so
  // twist applies AFTER chestAimYaw has been set. Avoids the
  // `chest.rotation.y = chestAimYaw` assignment stomping our add.
  state._swingBodyTwist = bodyTwist;
  state._swingBodyPitch = bodyPitch;
  state._swingIsCrit    = isCritSwing;

  // Support arm — always active now (both hands on gun). Pitch mirrors
  // the weapon arm so both hands rise together; rotation.z rotates the
  // arm inward across the torso so the support hand meets the weapon
  // at centerline. Sign is flipped for left-handed hold.
  //
  // Akimbo override (state.akimbo=true): the support arm holds its
  // OWN weapon. Both arms must aim the cursor in parallel — yaw=0
  // (straight forward in chest's local frame) so the support gun
  // tracks the cursor exactly the way the weapon arm does. The
  // chest's aim-twist already swings BOTH arms toward target via
  // parent-of-arm rotation; ANY non-zero shoulder yaw here would
  // offset the off-hand gun off-cursor.
  const supportShoulderYaw = state.akimbo
    ? 0                          // parallel forward — track cursor
    : 0.55 * supportYawSign;     // inward — two-hand-grip default
  // Pitch — match the weapon arm so both hands rise together. Same
  // formula in both modes; akimbo only differs in yaw + elbow bend.
  supportArm.shoulder.pivot.rotation.x = rightShoulder - armLeanComp + supportSideSway - idleShoulderDrop + idleWeaponDrift;
  supportArm.shoulder.pivot.rotation.z = supportShoulderYaw;
  // Support elbow — match the weapon arm's elbow bend for parallel
  // arm shape in akimbo. Normal mode keeps the existing tighter
  // tuck-toward-centerline bend (-0.18 + pump).
  const supportElbowPump = Math.abs(supportSideSway) * 0.4;
  supportArm.elbow.rotation.x = state.akimbo
    ? rightElbow + idleWeaponDrift * 0.4
    : rightElbow - 0.18 - supportElbowPump + idleWeaponDrift * 0.4;

  // Grip curl — rotate each hand pivot forward so the hand reads as
  // a closed fist on the weapon grip, not a flat palm hanging off
  // the wrist. Also roll the palm slightly inward toward centerline
  // (sign mirrors per side) so the knuckles face the gun frame.
  // Sleeping / dead overrides reset these at the bottom.
  const gripCurl = 0.95;
  const gripRollIn = 0.25;
  rig.leftArm.hand.pivot.rotation.x  = gripCurl;
  rig.rightArm.hand.pivot.rotation.x = gripCurl;
  rig.leftArm.hand.pivot.rotation.z  = +gripRollIn;
  rig.rightArm.hand.pivot.rotation.z = -gripRollIn;

  // --- sleeping pose override ---------------------------------------
  // Standing-sleep: head dropped, arms folded across the chest, legs
  // relaxed. Emitted Zzz particles are handled by the AI layer
  // (gunman.js spawnSpeechBubble) since they live in screen space.
  // Runs BEFORE the melee / rifle overrides so neither stomps the
  // folded-arm silhouette while the enemy is out cold.
  if (state.sleeping) {
    // Head dropped forward (chin-to-chest).
    rig.head.rotation.x = 0.65;
    rig.head.rotation.y = 0;
    // Arms crossed — each shoulder pitches forward, yaws inward
    // across the body, elbow heavily bent.
    rig.leftArm.shoulder.pivot.rotation.x = -1.35;
    rig.leftArm.shoulder.pivot.rotation.z =  0.70;   // cross body right
    rig.leftArm.elbow.rotation.x = -1.95;
    rig.rightArm.shoulder.pivot.rotation.x = -1.35;
    rig.rightArm.shoulder.pivot.rotation.z = -0.70;  // cross body left
    rig.rightArm.elbow.rotation.x = -1.95;
    // Relax the grip — hands rest flat tucked under the opposite arm
    // instead of still fisted around a missing weapon.
    rig.leftArm.hand.pivot.rotation.x  = 0.2;
    rig.rightArm.hand.pivot.rotation.x = 0.2;
    rig.leftArm.hand.pivot.rotation.z  = 0;
    rig.rightArm.hand.pivot.rotation.z = 0;
    // Slight chest slump forward; hips square.
    rig.chest.rotation.x = 0.14;
    rig.chest.rotation.y = 0;
    return;
  }

  // --- melee-stance override ----------------------------------------
  // Melee actors (rushers holding a blade) look wrong in the two-
  // handed rifle hold — their empty hand chases an invisible gun.
  // Swap in a one-handed weapon pose: the weapon arm angles forward-
  // down holding the blade, the off-arm hangs at the side and
  // counter-swings during the combo. Overrides the poses set above.
  if (state.meleeStance) {
    // Idle melee READY stance — both arms bent and active, weapon
    // held up in front at hip/chest height with a tight elbow bend
    // (like a fighter's guard). Off-arm mirrors with a lighter bend
    // so the character reads as coiled and ready to react, not
    // strolling with arms hanging.
    // Tightened guard: weapon shoulder pulled further forward and
    // elbow folded harder so the blade rides at chest/shoulder height
    // instead of dangling at the hip. Off-arm mirrors with a slightly
    // softer fold so the silhouette reads as a coiled fighter's stance,
    // not "arms hanging at the sides."
    const idleShoulder        = -0.55;   // weapon arm forward at ~31°
    const idleShoulderYaw     =  0.20 * supportYawSign;  // elbow tucked slightly inward
    const idleElbow           = -1.55;   // ~89° fold — weapon tip up near chin
    const idleSupportShoulder = -0.45;
    const idleSupportYaw      = -0.25 * supportYawSign;  // off-hand up in guard
    const idleSupportElbow    = -1.20;
    // Swing-time lift — during an active strike the weapon arm
    // rises to ~shoulder height for the strike. Gated on the
    // `attacking` flag from player.js so the one-frame `swingP=0`
    // dip at the impact apex doesn't collapse the arm back down.
    const swingLift = state.attacking ? -0.45 : 0;
    // While swinging, drop the tight elbow bend so the weapon
    // extends rather than staying tucked — additive with swingElbowExt.
    const swingElbowRelax = state.attacking ? 0.55 : 0;
    weaponArm.shoulder.pivot.rotation.x = idleShoulder + swingLift - recoilKick + swingX;
    weaponArm.shoulder.pivot.rotation.z = idleShoulderYaw + swingZ;
    weaponArm.elbow.rotation.x = idleElbow + swingElbowRelax + swingElbowExt;
    // Off-arm counter-swings a touch during the strike (adds a
    // natural body-torque look), otherwise stays up in the guard.
    supportArm.shoulder.pivot.rotation.x = idleSupportShoulder + (state.attacking ? swingP * 0.20 : 0);
    supportArm.shoulder.pivot.rotation.z = idleSupportYaw;
    supportArm.elbow.rotation.x = idleSupportElbow;
  }

  // --- rifle-shoulder override --------------------------------------
  // For shouldered long guns, the weapon is parented to the dominant
  // shoulder anchor (see player.js setWeapon) — the stock sits at
  // the collar, barrel extends forward. The dominant ARM is folded
  // back so the hand meets the grip (near the shoulder anchor), and
  // the support arm extends forward to cup the handguard further
  // along the barrel. More bladed body yaw too, because proper
  // rifle stance turns the body into the weapon.
  if (state.rifleHold && !state.meleeStance) {
    // Authored two-pose system (HIP ↔ AIM) lerped by aimBlend.
    // Apr-26: extended to ALL rifleHold classes (rifle/smg/shotgun/
    // sniper/lmg). Pistol falls outside rifleHold and keeps its own
    // pose. Per-class authored variants will replace this shared
    // pose later — for now they all share the rifle-authored set.
    const ab = a.aimBlend, hb = 1 - ab;
    const m = supportYawSign;
    const lerp = (h, x) => h * hb + x * ab;
    const _poseSet = POSE_BY_CLASS[state.weaponClass] || POSE_BY_CLASS.rifle;
    const H = _poseSet.hip, A = _poseSet.aim;
    const baseMap = a._basePosByObj;
    const apply = (target, hipJoint, aimJoint, extraRX = 0) => {
      if (!target) return;
      target.rotation.x = lerp(hipJoint.rx, aimJoint.rx) + extraRX;
      target.rotation.y = lerp(hipJoint.ry, aimJoint.ry) * m;
      target.rotation.z = lerp(hipJoint.rz, aimJoint.rz) * m;
      const bp = baseMap?.get(target);
      if (bp) {
        target.position.set(
          bp.x + lerp(hipJoint.px, aimJoint.px) * m,
          bp.y + lerp(hipJoint.py, aimJoint.py),
          bp.z + lerp(hipJoint.pz, aimJoint.pz),
        );
      }
    };
    // Dominant arm carries recoil + body-pitch compensation.
    const recoilExtra = recoilKick * 0.25 - armLeanComp;
    const elbowExtra  = -recK * 0.45;
    apply(weaponArm.shoulder.pivot,  H.domShoulder, A.domShoulder, recoilExtra);
    apply(weaponArm.elbow,           H.domElbow,    A.domElbow,    elbowExtra);
    apply(weaponArm.wrist,           H.domWrist,    A.domWrist);
    // Support arm in akimbo — manually MIRROR the dominant pose
    // across the YZ plane (negate y + z, keep x). The pose data is
    // authored canonically for the dominant side; applying the raw
    // values to the support arm via apply() (which uses m=+1 for
    // right-handed) produced a wrong-direction rotation because
    // y/z weren't being mirrored to the other side. By manually
    // negating y/z here, the support arm gets the mirror image of
    // the dominant pose — same forward pitch (x), opposite yaw +
    // roll. Both wrists end up oriented for the gun-mount's
    // forward-pointing direction.
    if (state.akimbo) {
      const ab = a.aimBlend, hb = 1 - ab;
      const lerp = (h, x) => h * hb + x * ab;
      const setMirror = (target, hipJ, aimJ, extraRX = 0) => {
        if (!target) return;
        target.rotation.x = lerp(hipJ.rx, aimJ.rx) + extraRX;
        target.rotation.y = -lerp(hipJ.ry, aimJ.ry);
        target.rotation.z = -lerp(hipJ.rz, aimJ.rz);
      };
      setMirror(supportArm.shoulder.pivot, H.domShoulder, A.domShoulder, recoilExtra);
      setMirror(supportArm.elbow,          H.domElbow,    A.domElbow,    elbowExtra);
      setMirror(supportArm.wrist,          H.domWrist,    A.domWrist);
    } else {
      apply(supportArm.shoulder.pivot, H.supShoulder, A.supShoulder, -armLeanComp);
      apply(supportArm.elbow,          H.supElbow,    A.supElbow);
      apply(supportArm.wrist,          H.supWrist,    A.supWrist);
    }
    // Spine — additive on top of locomotion / aim writes earlier
    // in updateAnim (so chestAimYaw / breath / etc. still layer).
    rig.stomach.rotation.y += lerp(H.stomach.ry, A.stomach.ry) * m;
    rig.chest.rotation.y   += lerp(H.chest.ry,   A.chest.ry)   * m;
    rig.head.rotation.y    += lerp(H.head.ry,    A.head.ry)    * m;
    const stomBase = baseMap?.get(rig.stomach);
    if (stomBase) {
      rig.stomach.position.set(
        stomBase.x, stomBase.y,
        stomBase.z + lerp(H.stomach.pz, A.stomach.pz),
      );
    }
    const headBase = baseMap?.get(rig.head);
    if (headBase) {
      rig.head.position.set(
        headBase.x + lerp(H.head.px, A.head.px) * m,
        headBase.y + lerp(H.head.py, A.head.py),
        headBase.z + lerp(H.head.pz, A.head.pz),
      );
    }
    rig.rightShoulderAnchor.rotation.x = -armLeanComp;
    rig.leftShoulderAnchor.rotation.x  = -armLeanComp;
  } else if (rig.rightShoulderAnchor && rig.leftShoulderAnchor) {
    // Non-rifle holds don't use the shoulder anchor for weapon
    // parenting. Zero the compensation rotation, AND restore any
    // joint positions the rifle pose may have shifted, so a swap
    // from rifle → pistol mid-frame doesn't leave the off-arm or
    // spine displaced.
    rig.rightShoulderAnchor.rotation.set(0, 0, 0);
    rig.leftShoulderAnchor.rotation.x = 0;
    const baseMap = a._basePosByObj;
    if (baseMap) {
      const restorePos = (t) => {
        const bp = baseMap.get(t);
        if (bp) t.position.set(bp.x, bp.y, bp.z);
      };
      restorePos(rig.leftArm.shoulder.pivot);
      restorePos(rig.rightArm.shoulder.pivot);
      restorePos(rig.stomach);
      restorePos(rig.head);
    }
  }

  // --- melee block-stance override ---------------------------------
  // Both hands raise the weapon across the upper chest at a defensive
  // angle, forearms angled inward so the blade/club visibly covers
  // the torso. Squared stance (no blade), slight forward lean. Runs
  // after rifleHold / meleeStance so it wins while blocking is on.
  if (state.blockPose) {
    // Dominant arm: shoulder pitched up so forearm rises toward the
    // face, elbow bent tight. Light inward yaw tucks the elbow.
    const blockDomShoulder = -1.55;
    const blockDomYaw      = 0.35 * supportYawSign;    // elbow inward across body
    const blockDomElbow    = -2.00;
    weaponArm.shoulder.pivot.rotation.x = blockDomShoulder;
    weaponArm.shoulder.pivot.rotation.z = blockDomYaw;
    weaponArm.elbow.rotation.x = blockDomElbow;
    // Support arm: mirrors dominant but reaches further across the
    // centerline so both hands meet on the weapon shaft. Hand at the
    // midpoint of the weapon, palm toward the dominant hand.
    const blockSupShoulder = -1.55;
    const blockSupYaw      = 0.85 * supportYawSign;
    const blockSupElbow    = -1.70;
    supportArm.shoulder.pivot.rotation.x = blockSupShoulder;
    supportArm.shoulder.pivot.rotation.z = blockSupYaw;
    supportArm.elbow.rotation.x = blockSupElbow;
  }

  // Upper-body blade — right-handed stance turns the body so the LEFT
  // shoulder leads toward the aim (rotation.y negative rotates +X
  // backward). Blends with aim so the twist only shows when aiming.
  // Melee rushers don't blade — they square up. Blocking also squares.
  const bladeSign = handed === 'right' ? -1 : 1;
  const bladeYaw = (state.meleeStance || state.blockPose) ? 0
    : bladeSign * (0.18 + a.aimBlend * 0.12);
  // Melee swing drives the upper body only — chest twists into the
  // strike (yaw) plus a small crunch (pitch) for overhead/critical.
  // Hips stay planted so the feet don't slide and the character
  // never rotates off its movement facing. Values are 0 when no
  // swing is active.
  const swingBodyTwist = state._swingBodyTwist || 0;
  const swingBodyPitch = state._swingBodyPitch || 0;
  rig.chest.rotation.y = chestAimYaw + bladeYaw + swingBodyTwist;
  rig.chest.rotation.x = (rig.chest.rotation.x || 0) + swingBodyPitch;
  rig.hips.rotation.y  = 0;
  // Slight forward chest crunch during a block — "tucking in" behind
  // the weapon reads as defensive posture.
  if (state.blockPose) {
    rig.chest.rotation.x = (rig.chest.rotation.x || 0) + 0.18;
  }
}

// Called from manager `applyHit` / `applyKnockback` / death path so the
// animation layer gets the impulse vector. Magnitude is roughly
// "damage / maxHp" so big bullets rotate the body more than small ones.
// Clamp raised to 2.5 so melee hits (which pass a larger mag) extend
// the flinch duration noticeably — gives a visible "stagger" versus
// the brief flinch of a bullet hit.
export function pokeHit(rig, dirX, dirZ, mag) {
  if (!rig?.anim) return;
  rig.anim.hitFlinchDir.x = dirX;
  rig.anim.hitFlinchDir.z = dirZ;
  const m = Math.max(0.3, Math.min(2.5, mag));
  rig.anim.hitFlinchT = 0.35 * m;
}

export function pokeRecoil(rig) {
  if (!rig?.anim) return;
  rig.anim.recoilT = 0.18;
}

export function pokeDeath(rig, dirX, dirZ, mag) {
  if (!rig?.anim) return;
  const len = Math.hypot(dirX, dirZ) || 1;
  rig.anim.deadFallDir.x = dirX / len;
  rig.anim.deadFallDir.z = dirZ / len;
  rig.anim.deadFallMag = Math.max(0.4, Math.min(3.0, mag || 1));
}
