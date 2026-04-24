// Skinned-character bridge. Loads a rigged model (FBX or glTF),
// clones it per instance with SkeletonUtils (plain `.clone(true)`
// does NOT properly clone skinned binding), and exposes the same rig
// shape as actor_rig so the existing updateAnim / pokeHit /
// pokeRecoil / pokeDeath all work unchanged.
//
// Prefer .glb: three.js's GLTFLoader handles multi-mesh skeletons
// properly, FBXLoader does not. The canonical character pipeline is
// tools/retarget_character.md — import FBX into Blender, pose arms
// to hanging, apply-pose-as-rest, export as .glb. Once a character
// is in "hanging-arms rest" bind, this loader is a thin bone-name
// map with no rest-offset math: the proc rig's `rotation = identity`
// already matches the bind.
//
// Key idea: piggyback on actor_rig.buildRig for the *proxy* joint
// tree. Its primitive meshes are hidden (skinned mesh renders
// instead). Each frame after updateAnim writes rotations to those
// proxy joints, `syncSkinnedRig(rig)` copies them onto the matching
// skeleton bones.
//
// Performance note: one skinned mesh per actor replaces ~40 primitive
// meshes, so draw calls drop ~40× for a squad. Skinned-mesh vertex
// transforms are cheap until hundreds of characters.

import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { loadModel } from './gltf_cache.js';
import { buildRig } from './actor_rig.js';

// Bone-name alias table. First alias that resolves via
// `getObjectByName` wins. Falls back to fuzzy substring match after
// exhausting exact names. Add to this table as new skeletons arrive.
const BONE_ALIASES = {
  // hips = pelvis in UE / Reallusion-CC naming; Hips in Mixamo.
  hips:          ['Hips', 'hips', 'Pelvis', 'pelvis', 'Root', 'root',
                  'mixamorig:Hips', 'Bip001 Pelvis', 'Bip01 Pelvis',
                  'CC_Base_Pelvis'],
  // Our rig has two torso joints (stomach + chest) on top of hips. UE
  // splits the back into three (spine_01/02/03). Map stomach to the
  // LOWEST spine and chest to the TOP spine (where clavicles branch
  // off) so our chest rotations actually move the shoulders.
  spine:         ['Spine', 'spine', 'spine_01', 'Spine1', 'mixamorig:Spine',
                  'Bip001 Spine', 'CC_Base_Spine01'],
  chest:         ['spine_03', 'Spine2', 'Chest', 'chest', 'mixamorig:Spine2',
                  'Bip001 Spine2', 'CC_Base_Spine02', 'spine_02'],
  neck:          ['neck_01', 'Neck', 'neck', 'mixamorig:Neck',
                  'Bip001 Neck', 'CC_Base_NeckTwist01'],
  head:          ['head', 'Head', 'mixamorig:Head', 'Bip001 Head',
                  'CC_Base_Head'],
  leftShoulder:  ['LeftShoulder', 'L_Shoulder', 'mixamorig:LeftShoulder',
                  'clavicle_l', 'LeftClavicle', 'Bip001 L Clavicle',
                  'CC_Base_L_Clavicle'],
  leftArm:       ['LeftArm', 'L_UpperArm', 'L_Arm', 'mixamorig:LeftArm',
                  'upperarm_l', 'Bip001 L UpperArm', 'CC_Base_L_Upperarm'],
  leftForeArm:   ['LeftForeArm', 'L_LowerArm', 'L_Forearm',
                  'mixamorig:LeftForeArm', 'lowerarm_l',
                  'Bip001 L Forearm', 'CC_Base_L_Forearm'],
  leftHand:      ['LeftHand', 'L_Hand', 'mixamorig:LeftHand',
                  'hand_l', 'Bip001 L Hand', 'CC_Base_L_Hand'],
  rightShoulder: ['RightShoulder', 'R_Shoulder', 'mixamorig:RightShoulder',
                  'clavicle_r', 'RightClavicle', 'Bip001 R Clavicle',
                  'CC_Base_R_Clavicle'],
  rightArm:      ['RightArm', 'R_UpperArm', 'R_Arm', 'mixamorig:RightArm',
                  'upperarm_r', 'Bip001 R UpperArm', 'CC_Base_R_Upperarm'],
  rightForeArm:  ['RightForeArm', 'R_LowerArm', 'R_Forearm',
                  'mixamorig:RightForeArm', 'lowerarm_r',
                  'Bip001 R Forearm', 'CC_Base_R_Forearm'],
  rightHand:     ['RightHand', 'R_Hand', 'mixamorig:RightHand',
                  'hand_r', 'Bip001 R Hand', 'CC_Base_R_Hand'],
  leftUpLeg:     ['LeftUpLeg', 'L_UpperLeg', 'L_Leg', 'mixamorig:LeftUpLeg',
                  'thigh_l', 'LeftThigh', 'Bip001 L Thigh', 'CC_Base_L_Thigh'],
  leftLeg:       ['LeftLeg', 'L_LowerLeg', 'L_Shin', 'mixamorig:LeftLeg',
                  'calf_l', 'LeftCalf', 'Bip001 L Calf', 'CC_Base_L_Calf'],
  leftFoot:      ['LeftFoot', 'L_Foot', 'mixamorig:LeftFoot',
                  'foot_l', 'Bip001 L Foot', 'CC_Base_L_Foot'],
  rightUpLeg:    ['RightUpLeg', 'R_UpperLeg', 'R_Leg', 'mixamorig:RightUpLeg',
                  'thigh_r', 'RightThigh', 'Bip001 R Thigh', 'CC_Base_R_Thigh'],
  rightLeg:      ['RightLeg', 'R_LowerLeg', 'R_Shin', 'mixamorig:RightLeg',
                  'calf_r', 'RightCalf', 'Bip001 R Calf', 'CC_Base_R_Calf'],
  rightFoot:     ['RightFoot', 'R_Foot', 'mixamorig:RightFoot',
                  'foot_r', 'Bip001 R Foot', 'CC_Base_R_Foot'],
};

// Rest offsets exist only for characters whose bind pose doesn't
// match our proc rig's "arms hanging" convention. The preferred
// pipeline rebinds in Blender (tools/retarget_character.md) so this
// stays empty — kept as an escape hatch for legacy FBXs that can't
// be reauthored.
const _IDENTITY_Q = new THREE.Quaternion();

// Maps each procedural-joint path on the rig to the bone slot it
// drives. Writing rig.chest.rotation.y (for example) lands on the
// bone resolved for the 'chest' slot.
const JOINT_TO_BONE = [
  [['hips'],                        'hips'],
  [['stomach'],                     'spine'],
  [['chest'],                       'chest'],
  [['neck'],                        'neck'],
  [['head'],                        'head'],
  [['leftArm', 'shoulder', 'pivot'], 'leftArm'],
  [['leftArm', 'elbow'],             'leftForeArm'],
  [['leftArm', 'wrist'],             'leftHand'],
  [['rightArm', 'shoulder', 'pivot'], 'rightArm'],
  [['rightArm', 'elbow'],             'rightForeArm'],
  [['rightArm', 'wrist'],             'rightHand'],
  [['leftLeg', 'thigh', 'pivot'],    'leftUpLeg'],
  [['leftLeg', 'knee'],              'leftLeg'],
  [['leftLeg', 'ankle'],             'leftFoot'],
  [['rightLeg', 'thigh', 'pivot'],   'rightUpLeg'],
  [['rightLeg', 'knee'],             'rightLeg'],
  [['rightLeg', 'ankle'],            'rightFoot'],
];

// Set to true the first time a skeleton is mapped so we only dump
// the full bone list once per session even if many characters spawn.
let _skeletonLoggedOnce = false;

/** Load (and cache) a character-template FBX from a URL. */
export function loadCharacter(url) {
  return loadModel(url);
}

function findBone(root, slot) {
  const aliases = BONE_ALIASES[slot] || [];
  for (const name of aliases) {
    const b = root.getObjectByName(name);
    if (b && b.isBone) return b;
  }
  // Fuzzy fallback — substring match against the slot name. Helps when
  // a pack uses a prefix like "Armature|LeftArm" or "mdl:LeftArm".
  const slotLc = slot.toLowerCase();
  let match = null;
  root.traverse((o) => {
    if (match || !o.isBone) return;
    if (o.name.toLowerCase().includes(slotLc)) match = o;
  });
  return match;
}

/**
 * Build a rig wrapper compatible with actor_rig's API. Expects a
 * template previously loaded via `loadCharacter`. Returns the same
 * shape as `buildRig` from actor_rig, but with primitive meshes
 * hidden and a skinned clone added underneath.
 *
 * `opts`:
 *   - scale: desired total height in meters (matches proc rig scale)
 *   - tint:  optional hex for emissive overlay (rarity glow, etc.)
 */
export function instantiateCharacterRig(template, opts = {}) {
  // 1) Build the full procedural rig as the joint proxy — we'll drive
  // everything through it and then mirror the rotations onto bones.
  const rig = buildRig(opts);
  // Hide every primitive mesh the proc rig spawned. The skinned mesh
  // renders the character visually from here on.
  for (const m of rig.meshes) m.visible = false;
  rig.headMesh.visible = false;

  // 2) Skinned clone. SkeletonUtils.clone handles the skeleton +
  // skinnedmesh binding that plain .clone(true) mis-handles.
  const skinned = skeletonClone(template);

  // 2a) Replace all mesh materials with a bright unlit tint while
  // we're debugging visibility. MeshBasicMaterial doesn't depend on
  // scene lighting, so if the mesh is renderable at all it shows up
  // as solid magenta. Once we see the mesh we can swap back to
  // MeshStandardMaterial with the real body colour.
  //
  // Per-instance clone so a hit-flash or tint later doesn't bleed
  // across multiple gunmen sharing the same template.
  let visMeshCount = 0;
  skinned.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      visMeshCount += 1;
      o.material = new THREE.MeshBasicMaterial({
        color: opts.bodyColor ?? 0xff00ff,
        side: THREE.DoubleSide,
      });
      o.castShadow = true;
      o.receiveShadow = false;
      // Three.js computes a skinned mesh's frustum-cull bound ONCE
      // from the bind pose; later bone deformation can put the actual
      // rendered geometry outside that bound and the mesh gets culled.
      // Disable culling — cheap for a handful of actors.
      o.frustumCulled = false;
      // Defensive: ensure the mesh itself is marked visible and not
      // hidden by any layer/visibility state from the loader.
      o.visible = true;
    }
  });
  if (!_skeletonLoggedOnce) {
    console.log(`[character] rebound ${visMeshCount} mesh(es) to MeshBasicMaterial`);
  }

  // 3) Fit the skinned mesh into our unit space. Using geometry
  // bounding boxes is unreliable for SkinnedMesh — three.js computes
  // them from bind-pose vertex positions in the skin's *local* space,
  // which for Blender-exported glTF often collapses to near-zero
  // because the vertices get spread out by bone transforms at runtime,
  // not at bind.
  //
  // Instead, measure the skeleton's spatial extent via its bone
  // world-positions. Bones span the full body (head to feet) and
  // correctly reflect scale regardless of what space the vertices
  // were authored in.
  skinned.updateMatrixWorld(true);
  let skelBox = new THREE.Box3();
  const _bonePos = new THREE.Vector3();
  let sawBone = false;
  skinned.traverse((o) => {
    if (o.isBone) {
      o.getWorldPosition(_bonePos);
      if (!sawBone) { skelBox.min.copy(_bonePos); skelBox.max.copy(_bonePos); sawBone = true; }
      else { skelBox.expandByPoint(_bonePos); }
    }
  });
  // Orientation fix — if the LONGEST skeleton axis isn't Y, the
  // exported glTF has the character lying on its side.
  {
    const sz = skelBox.getSize(new THREE.Vector3());
    if (sz.x > sz.y && sz.x > sz.z) {
      skinned.rotation.z = Math.PI / 2;
    } else if (sz.z > sz.y && sz.z > sz.x) {
      skinned.rotation.x = -Math.PI / 2;
    }
    skinned.updateMatrixWorld(true);
  }

  // Find head + foot bones (via aliases) and use their world Y
  // distance for the fit. The skeleton bbox includes facial / finger
  // bones that extend above the head or sit at odd positions, which
  // gives the wrong height. Head-to-foot is the visually honest span.
  function resolveBone(aliases) {
    for (const n of aliases) {
      const b = skinned.getObjectByName(n);
      if (b && b.isBone) return b;
    }
    return null;
  }
  const headBone = resolveBone(BONE_ALIASES.head);
  const footBone = resolveBone(BONE_ALIASES.leftFoot) || resolveBone(BONE_ALIASES.rightFoot);
  let measuredHeight = 0;
  if (headBone && footBone) {
    const headW = new THREE.Vector3();
    const footW = new THREE.Vector3();
    headBone.getWorldPosition(headW);
    footBone.getWorldPosition(footW);
    measuredHeight = Math.abs(headW.y - footW.y);
  }
  if (measuredHeight < 0.01) {
    // Fallback to skeleton bbox if head/foot lookup failed.
    const sz = skelBox.getSize(new THREE.Vector3());
    measuredHeight = sz.y;
  }
  if (!sawBone) {
    console.warn('[character] no bones found — falling back to geometry bounds');
  }
  if (!_skeletonLoggedOnce) {
    const sz = skelBox.getSize(new THREE.Vector3());
    console.log(`[character] skeleton bbox: ${sz.x.toFixed(2)}×${sz.y.toFixed(2)}×${sz.z.toFixed(2)}, head-foot: ${measuredHeight.toFixed(3)}m`);
    skinned.traverse((o) => {
      if (o.isSkinnedMesh) {
        console.log(`[character] ${o.name}: skeleton=${o.skeleton ? o.skeleton.bones.length + ' bones' : 'MISSING'}, bindMatrix=${o.bindMatrix ? 'ok' : 'MISSING'}`);
      }
    });
  }
  // Target a 1.75m head-to-foot height (matches the primitive rig).
  const desiredHeight = 1.75 * (opts.scale ?? 1.0);
  const fitScale = measuredHeight > 0 ? desiredHeight / measuredHeight : 1.0;
  skinned.scale.setScalar(fitScale);
  skinned.updateMatrixWorld(true);
  // Centre XZ via the re-measured skeleton, and plant the lowest
  // bone (toes) near y=0 with a tiny downward nudge so the full
  // foot mesh lands on the ground instead of clipping.
  const skelBox2 = new THREE.Box3();
  let sawBone2 = false;
  skinned.traverse((o) => {
    if (o.isBone) {
      o.getWorldPosition(_bonePos);
      if (!sawBone2) { skelBox2.min.copy(_bonePos); skelBox2.max.copy(_bonePos); sawBone2 = true; }
      else { skelBox2.expandByPoint(_bonePos); }
    }
  });
  skinned.position.x = -((skelBox2.min.x + skelBox2.max.x) / 2);
  skinned.position.z = -((skelBox2.min.z + skelBox2.max.z) / 2);
  // Offset upward so the lowest bone is at y≈0.05 (a little above
  // floor; mesh extent below the bone gets the feet to the floor).
  skinned.position.y = -skelBox2.min.y;

  if (!_skeletonLoggedOnce) {
    const sz = new THREE.Vector3();
    skelBox2.getSize(sz);
    console.log(`[character] fitted skeleton: ${sz.x.toFixed(2)}×${sz.y.toFixed(2)}×${sz.z.toFixed(2)} m, scale=${fitScale.toFixed(4)}, offset=(${skinned.position.x.toFixed(2)},${skinned.position.y.toFixed(2)},${skinned.position.z.toFixed(2)})`);
  }

  rig.group.add(skinned);

  // 4) Bone-name mapping + bind-quaternion snapshot.
  const bones = {};
  for (const slot of Object.keys(BONE_ALIASES)) {
    bones[slot] = findBone(skinned, slot);
  }
  if (!_skeletonLoggedOnce) {
    const all = [];
    skinned.traverse((o) => { if (o.isBone) all.push(o.name); });
    const resolved = {};
    for (const [slot, bone] of Object.entries(bones)) {
      resolved[slot] = bone ? bone.name : '(UNMAPPED)';
    }
    const missing = Object.entries(bones)
      .filter(([, b]) => !b).map(([s]) => s);
    console.log('[character] all bones:', all);
    console.log('[character] slot → bone:', resolved);
    if (missing.length) {
      console.warn('[character] unmapped bone slots:', missing);
    }
    _skeletonLoggedOnce = true;
  }

  const bindQuats = new Map();
  for (const [slot, bone] of Object.entries(bones)) {
    if (bone) bindQuats.set(slot, bone.quaternion.clone());
  }

  // Per-slot rest offsets. Empty by default — the canonical pipeline
  // (tools/retarget_character.md) rebinds the character in Blender
  // into a hanging-arms pose, so no runtime offsets are required.
  // Keep the field on the rig so future per-model calibrations can
  // populate it (e.g. via a content-side JSON loaded per model URL).
  const restOffsets = {};

  rig.isSkinned    = true;
  rig.skinnedMesh  = skinned;
  rig._bones       = bones;
  rig._bindQuats   = bindQuats;
  rig._restOffsets = restOffsets;

  skinned.updateMatrixWorld(true);

  // Apply optional tint overlay (rarity/team color) onto the skinned
  // materials. Each material is cloned per instance so tint doesn't
  // bleed back into the shared template.
  if (opts.tint !== undefined) {
    const emissive = new THREE.Color(opts.tint).multiplyScalar(0.18);
    skinned.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const cloned = list.map((m) => {
        const c = m.clone();
        if ('emissive' in c) {
          c.emissive = emissive.clone();
          c.emissiveIntensity = 0.5;
        }
        return c;
      });
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
    });
  }
  return rig;
}

// Pulled out of syncSkinnedRig so a path-resolve helper doesn't
// allocate an array literal every frame for every joint.
function resolveJoint(rig, path) {
  let node = rig;
  for (let i = 0; i < path.length; i++) {
    node = node?.[path[i]];
    if (!node) return null;
  }
  return node;
}

/**
 * Copy rotations from the procedural proxy joints onto the skinned
 * skeleton bones. Must be called ONCE per frame AFTER `updateAnim`.
 * Keyed by the JOINT_TO_BONE map — joints without a matching bone
 * (e.g. if the FBX skeleton is missing a shoulder clavicle) are
 * skipped silently.
 */
export function syncSkinnedRig(rig) {
  if (!rig || !rig.isSkinned) return;
  for (let i = 0; i < JOINT_TO_BONE.length; i++) {
    const [path, slot] = JOINT_TO_BONE[i];
    const bone = rig._bones[slot];
    if (!bone) continue;
    const src = resolveJoint(rig, path);
    if (!src) continue;
    const bind = rig._bindQuats.get(slot);
    const rest = rig._restOffsets[slot] || _IDENTITY_Q;
    // final = bind * rest * proxy_delta
    //
    //   bind: FBX's authored bind pose (A-pose / T-pose).
    //   rest: per-slot rotation that moves the bind into our proc rig's
    //         assumed rest (arms hanging). Auto-computed from the bone's
    //         bind-time world direction for arms; identity for slots
    //         that already align (legs, spine).
    //   proxy_delta: the rotation the proc rig wrote to its joint
    //         proxy this frame (walk swing, aim pose, flinch, etc.).
    bone.quaternion.copy(bind).multiply(rest).multiply(src.quaternion);
  }
}
