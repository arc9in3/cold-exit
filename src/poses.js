// ============================================================
// poses.js — runtime pose loader for character rigs
// ============================================================
//
// A "pose" is a JSON snapshot authored in the rig_tuner (see
// Assets/poses/*.json). At runtime, applyPose() takes a rig + pose
// and writes joint rotations / hip Y / IK target positions onto
// the rig's transforms.
//
// Schema:
//   {
//     rotations: { boneName: { x, y, z }, ... },  // Euler radians
//     ikTargets: { name: { enabled, x, y, z }, ... },
//     hips:      { y: number }
//   }
//
// This module is rig-agnostic: any rig that exposes a `bonesByName`
// map can be posed. The rig builder (procedural or JSON-primitive)
// is responsible for populating that map. See attachBoneNames().
//
// Apply order:
//   1. Optionally zero all rotations (so a partial pose doesn't mix
//      with whatever was on the rig before)
//   2. Set hips.position.y if specified
//   3. Set joint rotations from `rotations`
//   4. Set IK target world positions + enabled flags (consumer code
//      runs IK in its own update loop using these targets)
//
// This module does NOT solve IK — that lives in the consumer
// (rig_tuner has its own solver; the game can copy or extract that
// when needed).

const POSE_CACHE = new Map();

// Fetch + cache a pose JSON. Returns the parsed object.
// Path is relative to the document root, e.g. 'rifle-hip' fetches
// /Assets/poses/rifle-hip.json.
export async function loadPose(name) {
  const cached = POSE_CACHE.get(name);
  if (cached) return cached;
  const res = await fetch(`./Assets/poses/${encodeURIComponent(name)}.json`);
  if (!res.ok) throw new Error(`pose '${name}' not found (HTTP ${res.status})`);
  const data = await res.json();
  POSE_CACHE.set(name, data);
  return data;
}

// Walk a rig's bone hierarchy and build a name → pivot map. The
// rig structure follows the convention used by buildRig() and
// buildRigFromPrimitives() — leftArm.shoulder.pivot, leftLeg.thigh.pivot,
// etc. Names match what the rig_tuner pose editor uses.
//
// Side-effects: stamps the result onto rig.bonesByName so subsequent
// applyPose calls don't have to re-walk.
export function attachBoneNames(rig) {
  if (rig.bonesByName) return rig.bonesByName;
  const map = new Map();
  const reg = (pivot, name) => { if (pivot) map.set(name, pivot); };
  reg(rig.hips, 'hips');
  reg(rig.stomach, 'stomach');
  reg(rig.chest, 'chest');
  reg(rig.neck, 'neck');
  reg(rig.head, 'head');
  for (const [armKey, side] of [['leftArm', 'left'], ['rightArm', 'right']]) {
    const arm = rig[armKey];
    if (!arm) continue;
    reg(arm.shoulder?.pivot, `${side}Shoulder`);
    reg(arm.elbow,           `${side}Elbow`);
    reg(arm.forearm?.pivot,  `${side}Forearm`);
    reg(arm.wrist,           `${side}Wrist`);
    reg(arm.hand?.pivot,     `${side}Hand`);
  }
  for (const [legKey, side] of [['leftLeg', 'left'], ['rightLeg', 'right']]) {
    const leg = rig[legKey];
    if (!leg) continue;
    reg(leg.thigh?.pivot, `${side}Thigh`);
    reg(leg.knee,         `${side}Knee`);
    reg(leg.calf?.pivot,  `${side}Calf`);
    reg(leg.ankle,        `${side}Ankle`);
    reg(leg.foot?.pivot,  `${side}Foot`);
  }
  rig.bonesByName = map;
  return map;
}

// Apply a pose to a rig. opts.zero (default true) zeros all joint
// rotations before applying — set false if you want the pose to
// LAYER on top of existing rotations (e.g. additive aim correction
// over a base walk cycle). opts.applyIK (default false) hands off
// IK targets to a caller-provided ikTargets map (see ikTargetMeshes
// in rig_tuner) and toggles their enabled state.
export function applyPose(rig, pose, opts = {}) {
  const { zero = true, ikTargets = null } = opts;
  const bones = attachBoneNames(rig);
  if (zero) {
    for (const pivot of bones.values()) pivot.rotation.set(0, 0, 0);
  }
  if (pose.rotations) {
    for (const [name, r] of Object.entries(pose.rotations)) {
      const pivot = bones.get(name);
      if (pivot) pivot.rotation.set(r.x || 0, r.y || 0, r.z || 0);
    }
  }
  if (pose.hips && typeof pose.hips.y === 'number' && rig.hips) {
    rig.hips.position.y = pose.hips.y;
  }
  if (ikTargets && pose.ikTargets) {
    for (const [name, t] of Object.entries(pose.ikTargets)) {
      const tgt = ikTargets[name];
      if (!tgt) continue;
      if (tgt.position) tgt.position.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
      tgt.enabled = !!t.enabled;
    }
  }
}

// Lerp current rig rotations toward a pose's rotations, t = [0,1].
// Useful for blending between poses (e.g. smoothly transitioning
// from idle to rifle-hip when weapon is equipped).
export function lerpToPose(rig, pose, t) {
  const bones = attachBoneNames(rig);
  const k = Math.max(0, Math.min(1, t));
  if (pose.rotations) {
    for (const [name, target] of Object.entries(pose.rotations)) {
      const pivot = bones.get(name);
      if (!pivot) continue;
      pivot.rotation.x += ((target.x || 0) - pivot.rotation.x) * k;
      pivot.rotation.y += ((target.y || 0) - pivot.rotation.y) * k;
      pivot.rotation.z += ((target.z || 0) - pivot.rotation.z) * k;
    }
  }
  if (pose.hips && typeof pose.hips.y === 'number' && rig.hips) {
    rig.hips.position.y += (pose.hips.y - rig.hips.position.y) * k;
  }
}
