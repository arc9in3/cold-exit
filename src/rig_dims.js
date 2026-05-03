// ============================================================
// rig_dims.js — single tunable file for character rig proportions
// ============================================================
//
// Everything that controls SHAPE / SIZE / PROPORTION of the procedural
// primitive rig lives here. actor_rig.js does the GEOMETRY BUILD; this
// file is data only. Tuning a rig means editing values in this file
// and reloading.
//
// Three exports:
//   DEFAULT_DIMS         — base proportions (used by male, applied
//                          first. Female DIMS overlay applies on top.)
//   DEFAULT_DIMS_FEMALE  — female overrides (hourglass, bust, etc.)
//   DEFAULT_DIMS_MALE    — male overrides (currently no-op; defaults
//                          already encode the male/operator build)
//   POSE_TUNABLES        — procedural pose constants (crouch, gait,
//                          kneel) consumed by updateAnim()
//
// Apply order in buildRig: DEFAULT_DIMS → archetype overlay → opts.dims
// (the final caller override). mergeDims deep-merges; missing keys
// fall through to the base.
//
// Naming convention:
//   foo.r          — sphere radius
//   foo.h          — cylinder height (Y axis length)
//   foo.topR/botR  — tapered cylinder radii at top/bottom
//   foo.scaleX/Y/Z — non-uniform mesh scale on each axis
//   foo.x/y/z      — local position offset from parent pivot
//   fooYK          — fraction (0..1) used as multiplier of another
//                    dim (e.g. shoulderYK * chestH = shoulder height)
// ============================================================

export const DEFAULT_DIMS = {
  hipY: 1.1,
  // segs values are tuned for "intentionally low-poly, not amateur":
  // each visible cylinder has just enough sides to read as a smooth
  // curve without revealing tessellation at the silhouette.
  torso: {
    segs: 48,
    depthRatio: 0.72,
    pelvisH: 0.17, pelvisTopR: 0.18, pelvisBotR: 0.21, pelvisY: 0.12,
    crotchTopR: 0.13, crotchBotR: 0.07, crotchH: 0.06,
    crotchX: 0, crotchY: 0.005, crotchZ: 0,
    stomachH: 0.235, stomachTopR: 0.24, stomachBotR: 0.18, stomachY: 0.22,
    chestH: 0.345, chestTopR: 0.32, chestBotR: 0.22,
    collarH: 0.055, collarTopR: 0.11, collarBotR: 0.32, collarDY: 0.057,
    chestPlateTopR: 0.34, chestPlateBotR: 0.28,
    chestPlateH: 0.34, chestPlateYK: 0.55,
    beltR: 0.24, beltH: 0.09, beltY: 0.015,
    // Trapezius wedge — bridges shoulder line to neck base.
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
    thighRigX: 0.11, thighRigYK: 0,
    bootTopR: 0.10, bootTopH: 0.08, bootTopYK: -0.9,
    ankleBlend: { r: 0.08, scaleY: 0.7 },
    gluteThighBlend: { r: 0.10, yK: 0.05, z: -0.06, scaleZ: 0.85, scaleY: 0.70 },
  },
  arms: {
    shoulderInset: 0.34, shoulderYK: 0.80,
    upperArmH: 0.35, upperArmTopR: 0.105, upperArmBotR: 0.08,
    forearmH: 0.30, forearmTopR: 0.09, forearmBotR: 0.065,
    shoulderBulgeR: 0.15,
    elbowBulgeR: 0.08,
    shoulderPadR: 0.11,
    wristCuffR: 0.075, wristCuffH: 0.07, wristCuffYK: -0.9,
    handW: 0.12, handH: 0.12, handD: 0.16, handY: -0.06,
    bicep: { r: 0.10, yK: 0.45, z: 0.04, scaleY: 0.85, scaleX: 1.05, scaleZ: 1.10 },
  },
  rifleAnchor: {
    x: 0.23, yK: 0.82, z: 0.04,
  },
  head: {
    neckTopR: 0.08, neckBotR: 0.09, neckH: 0.22, neckMeshY: 0.09,
    headY: 0.14,
    craniumR: 0.15, craniumStretchY: 1.15, craniumStretchZ: 1.05, craniumY: 0.18,
    jawW: 0.075, jawH: 0.10, jawD: 0.22, jawY: 0.06,
  },
};

// ============================================================
// FEMALE — anime-stylized hourglass + bust + bob hair + heeled boots
// ============================================================
// Tuning notes:
//   - Arms intentionally pushed past anatomical (~30% > height
//     armspan) for visual readability at game scale. comic-style.
//   - Pelvis taper is FLIPPED vs male (wide top / narrow bottom) for
//     the iliac-crest / pubic-bone wedge anatomy refs show.
//   - Connective spheres (hipFront / lumbar / pec / abdomen lobes)
//     pruned. The hipBowl wedge + bust + chest cylinder + bob do
//     the silhouette work without those patch primitives.
//   - Gear overlays (kneePad / thighRig / bootTop / shoulderPad /
//     wristCuff) zeroed: build code skips when dim is 0. Re-enable
//     per-actor via opts.dims if a given female actor wears armor.
// ============================================================
export const DEFAULT_DIMS_FEMALE = {
  hipY: 1.24,
  torso: {
    pelvisH: 0.22,
    pelvisTopR: 0.30,    // wide iliac crest
    pelvisBotR: 0.18,    // narrow pubic bone
    stomachH: 0.26,
    stomachTopR: 0.18,
    stomachBotR: 0.11,   // wasp waist
    chestH: 0.34,
    chestTopR: 0.27,
    chestBotR: 0.18,
    chestPlateTopR: 0.29,
    chestPlateBotR: 0.20,
    collarH: 0,           // skipped — clean shoulder line
    beltH: 0,             // skipped — clean waist
    chestDepth:   0.70,   // flatter chest plane; bust does forward projection
    stomachDepth: 0.70,
    pelvisDepth:  0.82,
    crotchTopR: 0.20, crotchBotR: 0.11, crotchH: 0.08,
    crotchY: 0.005, crotchZ: 0,
    // hipBowl — primary pelvis volume (wedge shape, replaces pelvis
    // cylinder visually). wedgeTopFactor at top, wedgeBotFactor at
    // bottom of the bowl. pitchX tilts sacrum higher than pubis.
    hipBowl: {
      r: 0.30, y: -0.05, z: 0,
      scaleX: 1.00, scaleY: 0.58, scaleZ: 0.90,
      pitchX: 0.10,
      wedgeTopFactor: 1.00,
      wedgeBotFactor: 0.85,
    },
    // Pruned connective spheres — hipBowl + bust + bob do the work.
    hipFront: null,
    pec: null,
    lumbar: null,
    upperAbdomen: null,
    lowerAbdomen: null,
    trapezius: null,
    abdomen: null,
  },
  legs: {
    hipX: 0.13,           // legs descend from under glute mass
    thighH: 0.54,
    thighTopR: 0.13,
    thighBotR: 0.075,
    calfH: 0.70,
    calfTopR: 0.082,
    calfBotR: 0.045,      // very narrow ankle (athletic taper)
    footH: 0.05,
    footW: 0.11,
    footD: 0.24,
    footZ: 0.07,          // toe forward (heeled stance)
    hipBulgeR: 0.20,      // big iliac-to-thigh bridge
    kneeBulgeR: 0.08,
    // Glute volume — back projection of the pelvis wedge.
    glute: { r: 0.13, separationX: 0.11, y: -0.04, z: -0.14, scaleY: 0.80, scaleZ: 1.00 },
    // Pruned connective spheres.
    iliacShelf: null,
    gluteThighBlend: null,
    kneeBridge: null,
    calfFlex: null,
    ankleBlend: null,
    // Gear overlays stripped — clean bodyshapes silhouette.
    kneePadW: 0, kneePadH: 0, kneePadD: 0,
    thighRigW: 0, thighRigH: 0, thighRigD: 0,
    bootTopR: 0, bootTopH: 0,
    // Heel block — raised back of the boot for the heeled-stance read.
    heel: { w: 0.06, h: 0.06, d: 0.05, y: -0.03, z: -0.08 },
  },
  arms: {
    shoulderInset: 0.36,  // wider shoulder line
    // Heroic / anatomical arm proportions. Forearm slightly longer
    // than upper arm pushes the elbow above midpoint so the joint
    // reads as the cleavage between two distinct lobes (per
    // bodyshapes ref) instead of "ball stuck mid-cylinder".
    upperArmH: 0.62,
    forearmH: 0.62,
    // Cylinder taper at the elbow seam: upperArmBotR > forearmTopR
    // so the cylinders form a clear step. Combined with the
    // larger-than-both elbow ball, the joint pops as a circle.
    upperArmTopR: 0.070,
    upperArmBotR: 0.060,
    forearmTopR: 0.048,
    forearmBotR: 0.038,
    // No shoulder ball — was being mistaken for "elbow near shoulder".
    shoulderBulgeR: 0,
    elbowBulgeR: 0.11,     // the only ball on the arm; sits at mid-arm
    handW: 0.09, handH: 0.10, handD: 0.13,
    bicep: null,           // slim arms read clean as tapered cylinders
    shoulderPadR: 0,       // no pauldron on female
    wristCuffR: 0, wristCuffH: 0,  // no wrist cuff
  },
  head: {
    neckH: 0.26,
    neckTopR: 0.06,
    neckBotR: 0.07,
    craniumR: 0.13,        // smaller head — anime proportions
    craniumStretchY: 1.10,
    jawW: 0.06, jawH: 0.08, jawD: 0.18,
    // Bust geometry — two flattened spheres on the chest.
    bust: { r: 0.115, separationX: 0.085, y: 0.18, z: 0.21, scaleY: 0.85, scaleZ: 1.15 },
    // Bob hair — 5-primitive structured cut: crown dome, back panel,
    // L+R side panels, fringe slab. Cylinders give flat-bottom cut.
    bob: {
      crown:  { r: 0.17, scaleX: 1.05, scaleY: 0.55, scaleZ: 1.05, y: 0.18, z: -0.01 },
      back:   { topR: 0.135, botR: 0.155, h: 0.30, y: 0.03, z: -0.07 },
      side:   { topR: 0.06, botR: 0.075, h: 0.30, x: 0.135, y: 0.03, z: 0.02 },
      fringe: { w: 0.27, h: 0.06, d: 0.06, y: 0.18, z: 0.13 },
    },
  },
};

// ============================================================
// MALE — operator-coded grounded build
// ============================================================
// Currently a no-op overlay; DEFAULT_DIMS already encodes the male
// operator proportions per the maleref design. Slot kept as an
// explicit symmetric form so callers can pass `archetype: 'male'`,
// and so future operator-specific bicep / pec / chest tuning has a
// clean home.
// ============================================================
export const DEFAULT_DIMS_MALE = {};

// ============================================================
// POSE TUNABLES — procedural-anim constants consumed by updateAnim()
// ============================================================
// crouch.* fires only when state.crouched > 0 (crouch-only modifiers).
// gait.*   fires every frame; ALSO matters at idle (it controls the
//          base bob amplitude even when standing).
// kneel.*  fires when crouched && speed < threshold (one knee down).
// ============================================================
export const POSE_TUNABLES = {
  crouch: {
    thighFwd: 1.27,
    kneeBend: 1.35,
    kneeGaitStraighten: 0.524,
    strideScale: 0.49,
    swingLift: 0.47,
    kneeFlex: 0.61,
    swingDamp: 0.71,
    rightThighIdleLead: 0.70,
    rightThighStaticBoost: 0.45,
    rightKneeStaticBoost: 0.25,
    ankleAdjust: 0,
    hipDrop: 0.26,
    chestLean: 0.26,
    chestMoveLean: 0.0,
    hipPitch: 0.45,
    headCounterPitch: 0.22,
    hipRoll: -0.70,
    bobReduction: 1.0,
    plantDipReduction: 0.80,
    stepRate: 0.42,
  },
  gait: {
    bobAmplitude: 0.03,
    runBobMult: 1.4,
    plantDipAmplitude: 0.015,
    hipRollAmplitude: 0.035,
    gaitYawAmplitude: 0.08,
    runLeanWalk: 0.04,
    runLeanRun: 0.22,
  },
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
