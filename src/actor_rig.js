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
function segment(opts) {
  const pivot = new THREE.Group();
  pivot.position.set(opts.px || 0, opts.py || 0, opts.pz || 0);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(opts.w, opts.h, opts.d),
    opts.material,
  );
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
    new THREE.CylinderGeometry(opts.topR, opts.botR, opts.h, opts.segs || 12),
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
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 10, 8),
    material,
  );
  mesh.castShadow = true;
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
  torso: {
    segs: 16,
    depthRatio: 0.72,
    pelvisH: 0.17, pelvisTopR: 0.19, pelvisBotR: 0.22, pelvisY: 0.12,
    stomachH: 0.235, stomachTopR: 0.24, stomachBotR: 0.20, stomachY: 0.22,
    chestH: 0.345, chestTopR: 0.28, chestBotR: 0.24,
    collarH: 0.055, collarTopR: 0.11, collarBotR: 0.28, collarDY: 0.057,
    chestPlateTopR: 0.31, chestPlateBotR: 0.26,
    chestPlateH: 0.34, chestPlateYK: 0.55, // * chestH
    beltR: 0.25, beltH: 0.09, beltY: 0.015,
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
  },
  arms: {
    shoulderInset: 0.29, shoulderYK: 0.78, // * chestH
    upperArmH: 0.35, upperArmTopR: 0.10, upperArmBotR: 0.075,
    forearmH: 0.30, forearmTopR: 0.09, forearmBotR: 0.065,
    shoulderBulgeR: 0.12,
    elbowBulgeR: 0.08,
    shoulderPadR: 0.14,
    wristCuffR: 0.075, wristCuffH: 0.07, wristCuffYK: -0.9, // * forearmH
    handW: 0.12, handH: 0.12, handD: 0.16, handY: -0.06,
  },
  rifleAnchor: {
    x: 0.23, yK: 0.82, z: 0.04, // yK * chestH
  },
  head: {
    neckTopR: 0.08, neckBotR: 0.09, neckH: 0.185, neckMeshY: 0.09,
    headY: 0.125,
    craniumR: 0.15, craniumStretchY: 1.15, craniumStretchZ: 1.05, craniumY: 0.18,
    jawW: 0.075, jawH: 0.10, jawD: 0.22, jawY: 0.06,
  },
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
  const dims = mergeDims(DEFAULT_DIMS, opts.dims);

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
      material: legMat, zone: 'leg',
    });
    // Hip-joint sphere caps the tapered cylinder cleanly against
    // the torso.
    const hipBulge = jointSphere(L.hipBulgeR * scale, legMat, 'leg');
    thigh.pivot.add(hipBulge);
    // Thigh rig — small gear-coloured strap on the outer thigh.
    const thighRig = new THREE.Mesh(
      new THREE.BoxGeometry(L.thighRigW * scale, L.thighRigH * scale, L.thighRigD * scale),
      gearMat,
    );
    thighRig.position.set(sign * L.thighRigX * scale, L.thighRigYK * thighH, 0);
    thighRig.castShadow = true;
    thighRig.userData.zone = 'leg';
    thigh.pivot.add(thighRig);

    const knee = new THREE.Group();
    knee.position.y = -thighH;
    thigh.pivot.add(knee);
    // Knee sphere — smooth bend between thigh and calf.
    const kneeBulge = jointSphere(L.kneeBulgeR * scale, legMat, 'leg');
    knee.add(kneeBulge);
    // Knee pad — gear-coloured cap over the joint on the front.
    const kneePad = new THREE.Mesh(
      new THREE.BoxGeometry(L.kneePadW * scale, L.kneePadH * scale, L.kneePadD * scale),
      gearMat,
    );
    kneePad.position.set(0, 0, L.kneePadZ * scale);
    kneePad.castShadow = true;
    kneePad.userData.zone = 'leg';
    knee.add(kneePad);

    // Calf — tapered cylinder, narrower at ankle.
    const calf = taperedSegment({
      px: 0, py: 0, pz: 0,
      topR: L.calfTopR * scale, botR: L.calfBotR * scale, h: calfH,
      material: legMat, zone: 'leg',
    });
    knee.add(calf.pivot);

    const ankle = new THREE.Group();
    ankle.position.y = -calfH;
    calf.pivot.add(ankle);
    // Boot — keep a box for the foot since boots actually read boxy.
    const foot = segment({
      px: 0, py: 0, pz: L.footZ * scale,
      w: L.footW * scale, h: footH, d: L.footD * scale,
      my: -footH / 2,
      material: bootMat, zone: 'leg',
    });
    ankle.add(foot.pivot);
    // Boot top — gear-coloured cuff above the foot, on the calf.
    const bootTop = new THREE.Mesh(
      new THREE.CylinderGeometry(L.bootTopR * scale, L.bootTopR * scale, L.bootTopH * scale, 12),
      bootMat,
    );
    bootTop.position.set(0, L.bootTopYK * calfH, 0);
    bootTop.castShadow = true;
    bootTop.userData.zone = 'leg';
    calf.pivot.add(bootTop);

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
  const pelvis = new THREE.Mesh(
    new THREE.CylinderGeometry(
      T.pelvisTopR * scale, T.pelvisBotR * scale, T.pelvisH * scale, T.segs,
    ),
    legMat,
  );
  pelvis.position.set(0, T.pelvisY * scale, 0);
  pelvis.scale.z = T.depthRatio;
  pelvis.castShadow = true;
  pelvis.receiveShadow = true;
  pelvis.userData.zone = 'torso';
  hips.add(pelvis);

  // Stomach — tapered cylinder narrowing to the waist.
  const stomach = (() => {
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ';
    pivot.position.set(0, T.stomachY * scale, 0);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(
        T.stomachTopR * scale, T.stomachBotR * scale, stomachH, T.segs,
      ),
      bodyMat,
    );
    mesh.position.y = stomachH / 2;
    mesh.scale.z = T.depthRatio;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.zone = 'torso';
    pivot.add(mesh);
    return { pivot, mesh };
  })();
  hips.add(stomach.pivot);

  // Chest — tapered cylinder flaring up to the ribcage / shoulder line.
  const chest = (() => {
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ';
    pivot.position.set(0, stomachH, 0);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(
        T.chestTopR * scale, T.chestBotR * scale, chestH, T.segs,
      ),
      bodyMat,
    );
    mesh.position.y = chestH / 2;
    mesh.scale.z = T.depthRatio;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.zone = 'torso';
    pivot.add(mesh);
    return { pivot, mesh };
  })();
  stomach.pivot.add(chest.pivot);

  // Collar / shoulder yoke — flattened truncated cone that caps the
  // chest top, leaving only a neck-sized hole. Without this, the
  // chest's flat top disc catches direct warm key light and reads as
  // a bright tan ring around the neck.
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(
      T.collarTopR * scale, T.collarBotR * scale, T.collarH * scale, T.segs,
    ),
    bodyMat,
  );
  collar.position.set(0, chestH + T.collarDY * scale, 0);
  collar.scale.z = T.depthRatio;
  collar.castShadow = true;
  collar.receiveShadow = true;
  collar.userData.zone = 'torso';
  chest.pivot.add(collar);

  // Chest plate — curved front panel. Open-ended cylindrical arc
  // wrapping the front + sides of the ribcage, radius a hair larger
  // than the chest so it stands proud. thetaStart is centred on +Z
  // (character front); Three.js's CylinderGeometry places theta=0 at
  // +Z then sweeps through +X, so the arc spans -75°..+75° around
  // the front axis.
  const chestPlate = new THREE.Mesh(
    new THREE.CylinderGeometry(
      T.chestPlateTopR * scale, T.chestPlateBotR * scale,
      T.chestPlateH * scale,
      14, 1, true,
      -Math.PI / 2.4, Math.PI / 1.2,
    ),
    gearMat,
  );
  chestPlate.position.set(0, T.chestPlateYK * chestH, 0);
  chestPlate.scale.z = T.depthRatio;
  chestPlate.castShadow = true;
  chestPlate.userData.zone = 'torso';
  chest.pivot.add(chestPlate);

  // Belt — full cylinder ring at the stomach/chest seam, slightly
  // oversized relative to the waist so it reads as worn over.
  const belt = new THREE.Mesh(
    new THREE.CylinderGeometry(
      T.beltR * scale, T.beltR * scale, T.beltH * scale, T.segs,
    ),
    gearMat,
  );
  belt.position.set(0, T.beltY * scale, 0);
  belt.scale.z = T.depthRatio;
  belt.castShadow = true;
  belt.userData.zone = 'torso';
  chest.pivot.add(belt);

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
      segs: 10,
      material: armMat, zone: 'arm',
    });
    // Shoulder joint sphere — smooths the shoulder-to-torso bulge.
    const shoulderBulge = jointSphere(A.shoulderBulgeR * scale, armMat, 'arm');
    shoulder.pivot.add(shoulderBulge);
    // Shoulder pad — hemispherical pauldron over the deltoid.
    const shoulderPad = new THREE.Mesh(
      new THREE.SphereGeometry(A.shoulderPadR * scale, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      gearMat,
    );
    shoulderPad.position.set(0, 0, 0);
    shoulderPad.castShadow = true;
    shoulderPad.userData.zone = 'arm';
    shoulder.pivot.add(shoulderPad);

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
      segs: 10,
      material: armMat, zone: 'arm',
    });
    elbow.add(forearm.pivot);
    // Wrist cuff — gear cylinder band just above the hand.
    const wristCuff = new THREE.Mesh(
      new THREE.CylinderGeometry(A.wristCuffR * scale, A.wristCuffR * scale, A.wristCuffH * scale, 12),
      gearMat,
    );
    wristCuff.position.set(0, A.wristCuffYK * forearmH, 0);
    wristCuff.castShadow = true;
    wristCuff.userData.zone = 'arm';
    forearm.pivot.add(wristCuff);

    const wrist = new THREE.Group();
    wrist.position.y = -forearmH;
    forearm.pivot.add(wrist);
    // Hand — keep as a small rounded box; it reads as a fist with
    // the grip curl applied.
    const hand = segment({
      px: 0, py: 0, pz: 0,
      w: A.handW * scale, h: A.handH * scale, d: A.handD * scale,
      my: A.handY * scale,
      material: handMat, zone: 'arm',
    });
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
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(H.neckTopR * scale, H.neckBotR * scale, H.neckH * scale, 12),
      bodyMat,
    );
    mesh.position.y = H.neckMeshY * scale;
    mesh.castShadow = true;
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
  const headMesh = new THREE.Mesh(
    new THREE.SphereGeometry(H.craniumR * scale, 14, 10),
    headMat,
  );
  headMesh.scale.set(1.0, H.craniumStretchY, H.craniumStretchZ);
  headMesh.position.y = H.craniumY * scale;
  headMesh.castShadow = true;
  headMesh.receiveShadow = true;
  headMesh.userData.zone = 'head';
  head.add(headMesh);
  // Jaw — narrower box just above the neck so the head→neck
  // transition has some geometry where the jaw would be.
  const jawMesh = new THREE.Mesh(
    new THREE.BoxGeometry(H.jawW * scale, H.jawH * scale, H.jawD * scale),
    headMat,
  );
  jawMesh.position.y = H.jawY * scale;
  jawMesh.castShadow = true;
  jawMesh.userData.zone = 'head';
  head.add(jawMesh);

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
    leftLeg, rightLeg,
    leftArm, rightArm,
    leftShoulderAnchor, rightShoulderAnchor,
    // Flat mesh list (useful for hit-flash color lerp across every part).
    // Includes gear accents so they flash with the body on hit.
    meshes: [
      pelvis, stomach.mesh, chest.mesh, chestPlate, belt, collar,
      neck.mesh, headMesh, jawMesh,
      leftLeg.thigh.mesh, leftLeg.hipBulge, leftLeg.thighRig,
      leftLeg.kneeBulge, leftLeg.kneePad,
      leftLeg.calf.mesh, leftLeg.bootTop, leftLeg.foot.mesh,
      rightLeg.thigh.mesh, rightLeg.hipBulge, rightLeg.thighRig,
      rightLeg.kneeBulge, rightLeg.kneePad,
      rightLeg.calf.mesh, rightLeg.bootTop, rightLeg.foot.mesh,
      leftArm.shoulder.mesh, leftArm.shoulderBulge, leftArm.shoulderPad,
      leftArm.forearm.mesh, leftArm.elbowBulge, leftArm.wristCuff,
      leftArm.hand.mesh,
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
  weapon:      { rx:  0.38, ry:  0.32, rz:  0.31, px:  0.01, py:  0.65, pz:  0.05 },
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
  weapon:      { rx:  1.11, ry:  0.26, rz:  0.11, px:  0.03, py:  0.70, pz:  0.00 },
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
  freq *= 1 - (a.crouchBlend || 0) * 0.20;
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
  const wantsKneel = state.crouched && speed < 0.25;
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
  // Crouch-walk pose — deeper than before per user feedback.
  const crouchThigh = -crouch * 0.55;
  const crouchKnee  =  crouch * 1.10;
  const crouchAnkle = -(crouchThigh + crouchKnee);
  // Crouch stride bumped from 70% → 90% of standing so the legs
  // visibly cycle while sneaking instead of mincing in place. The
  // old 0.30 stride-shrink combined with the asymmetric-front-leg
  // bias to lock the gait into a stiff limp; both are relaxed here.
  const strideScale = 1 - crouch * 0.10;
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
  const gaitT = a.blendWalk + a.blendRun * 1.15;
  const strideAmp = (a.blendWalk * 0.45 + a.blendRun * 0.25) * strideScale;
  // Swing-forward lift: extra negative (forward) thigh angle at
  // mid-swing. Run uses a big value to produce the high-knee look
  // where the knee leads forward of the body.
  const swingLift = (a.blendWalk * 0.25 + a.blendRun * 0.50) * strideScale;
  // Knee flex during swing — run flexes harder to clear ground.
  // Crouching adds extra knee flex on top so the swinging leg actually
  // CLEARS the ground when the hip is already low. Without this, the
  // knee bend stayed walk-level while the hip dropped 16cm and the
  // foot dragged through the floor.
  const kneeFlex  = (a.blendWalk * 0.85 + a.blendRun * 1.30) * strideScale + crouch * 0.45 * gaitT;
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
  const rightCrouchThigh = crouchThigh * (1 + 0.45 * crouchMoveDamp);
  const rightCrouchKnee  = crouchKnee  * (1 + 0.25 * crouchMoveDamp);
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
  let leftAnkleRot  = -leftKneeGait  * 0.35 + leftFootRoll  * sneakRollBoost + crouchAnkle;
  let rightAnkleRot = -rightKneeGait * 0.35 + rightFootRoll * sneakRollBoost + rightCrouchAnkle;

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
    const kL_thigh =  0.30;
    const kL_knee  =  0.70;
    const kR_thigh = -1.57;
    const kR_knee  =  1.57;
    leftThighRot  = leftThighRot  * (1 - kneel) + kL_thigh * kneel;
    leftKneeRot   = leftKneeRot   * (1 - kneel) + kL_knee  * kneel;
    leftAnkleRot  = leftAnkleRot  * (1 - kneel) + -(kL_thigh + kL_knee) * kneel;
    rightThighRot = rightThighRot * (1 - kneel) + kR_thigh * kneel;
    rightKneeRot  = rightKneeRot  * (1 - kneel) + kR_knee  * kneel;
    rightAnkleRot = rightAnkleRot * (1 - kneel) + -(kR_thigh + kR_knee) * kneel;
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
  const bob = 0.03 * s2 * (a.blendWalk + a.blendRun * 1.4) * (1 - crouch * 0.6) * rs;
  // Hip drop scales with crouch depth and then drops further during
  // the kneel — the front leg's near-horizontal thigh means the hip
  // has to be ~0.43m lower than standing for the front foot to plant.
  // Re-tuned for hipY=1.1 / thighH=0.42 / calfH=0.59 (long-leg proportions).
  const crouchHipDrop = (crouch * 0.16 + kneel * 0.27) * rs;
  // Foot-plant impact dip — at heel-strike (cos(cycle) ≈ ±1) the hip
  // drops a couple cm to sell weight transfer onto the planted leg.
  // cos² peaks at both heel strikes per cycle (left foot at 0, right
  // foot at π). Scales with gait intensity.
  const plantDip = -0.015 * Math.cos(a.cycle) * Math.cos(a.cycle)
                 * (a.blendWalk + a.blendRun) * (1 - crouch * 0.8) * rs;
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
  const crouchLean = crouch * 0.18 + kneel * 0.12;
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
  const rawRunLean = (a.blendWalk * 0.04 + a.blendRun * 0.16) * (1 - crouch * 0.85);
  const runLean = meleeActive ? rawRunLean * 0.5 : rawRunLean;
  const meleeWaistBend = meleeActive ? 0.08 : 0;
  rig.chest.rotation.y = chestAimYaw;
  rig.chest.rotation.x = chestFlinch - recK * 0.06 + crouchLean + dashLean + runLean + breathPitch + meleeWaistBend;
  rig.hips.rotation.x = crouch * 0.18 + kneel * 0.10 + a.dashBlend * 0.22;

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
                      - crouch * 0.22 - kneel * 0.14
                      - chestPitch * 0.6;
  // Hip roll — combines slow idle weight-shift with a small gait-
  // driven sway. Standing walk gets a subtle roll; crouching adds a
  // light bump (was ×2.4, now ×1.2) so sneaking still reads as
  // weight-shifting onto the planted foot but doesn't waddle.
  const gaitHipRoll = Math.cos(a.cycle) * 0.035 * gaitT * (1 + crouch * 0.20);
  rig.hips.rotation.z = idleHipRoll + gaitHipRoll;

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
  const chestShoulderPitch = -0.60 - aimPitchV * 0.55 + crouchBias;
  const chestElbow         = -0.97 - tuckBias;
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
  // (crouch * 0.18 + kneel * 0.10 + dashBlend * 0.22). Arms are
  // children of chest which is a child of hips, so both rotations
  // accumulate down the chain and push the gun barrel downward. Prior
  // version only compensated for chest, leaving the hips' 0.18 rad of
  // crouch pitch to droop the muzzle when the player crouches.
  const hipsLean = crouch * 0.18 + kneel * 0.10 + a.dashBlend * 0.22;
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
  const supportShoulderYaw = 0.55 * supportYawSign;
  supportArm.shoulder.pivot.rotation.x = rightShoulder - armLeanComp + supportSideSway - idleShoulderDrop + idleWeaponDrift;
  supportArm.shoulder.pivot.rotation.z = supportShoulderYaw;
  // Support elbow a touch more bent so the hand meets the weapon a
  // bit further inboard without over-extending.
  const supportElbowPump = Math.abs(supportSideSway) * 0.4;
  supportArm.elbow.rotation.x = rightElbow - 0.18 - supportElbowPump + idleWeaponDrift * 0.4;

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
    const idleShoulder        = -0.35;   // weapon arm forward at ~20°
    const idleShoulderYaw     =  0.20 * supportYawSign;  // elbow tucked slightly inward
    const idleElbow           = -1.15;   // tight bend — weapon tip up near chest
    const idleSupportShoulder = -0.30;
    const idleSupportYaw      = -0.25 * supportYawSign;  // off-hand up in guard
    const idleSupportElbow    = -0.90;
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
    apply(supportArm.shoulder.pivot, H.supShoulder, A.supShoulder, -armLeanComp);
    apply(supportArm.elbow,          H.supElbow,    A.supElbow);
    apply(supportArm.wrist,          H.supWrist,    A.supWrist);
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
