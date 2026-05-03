// ============================================================
// character_fbx.js — load a Mixamo-format FBX as a player/NPC rig
// ============================================================
//
// Loads an FBX file (skinned mesh + skeleton + embedded animation
// clips), wires up an AnimationMixer, and exposes a rig-shaped
// adapter so the rest of the game (player.js, gunman.js, weapon
// attach, hit flinch, etc.) can poke `rig.leftArm.shoulder.pivot`
// the same way it does on the procgen rig.
//
// Usage:
//   const rig = await loadCharacterFBX(scene, 'Assets/models/Idle.fbx');
//   rig.play('idle');                          // play a named clip
//   rig.update(dt);                            // tick mixer each frame
//   rig.leftArm.shoulder.pivot.getWorldPosition(v);  // works
//   ... existing state-driven anim path skipped while FBX is active ...
//
// Bone-name mapping (mixamorig:* → code-side rig handles):
//
//   mixamorig:Hips        → hips
//   mixamorig:Spine       → stomach
//   mixamorig:Spine1      → chest
//   mixamorig:Neck        → neck
//   mixamorig:Head        → head
//
//   mixamorig:LeftShoulder→ rightArm.shoulder.pivot  (handedness flip — see note)
//   mixamorig:LeftArm     → rightArm.shoulder.pivot  (same; mixamo has Shoulder+Arm; we collapse)
//   mixamorig:LeftForeArm → rightArm.elbow + forearm.pivot
//   mixamorig:LeftHand    → rightArm.wrist + hand.pivot
//
//   mixamorig:RightShoulder, RightArm → leftArm.shoulder.pivot
//   mixamorig:RightForeArm            → leftArm.elbow + forearm.pivot
//   mixamorig:RightHand               → leftArm.wrist + hand.pivot
//
//   mixamorig:LeftUpLeg   → rightLeg.thigh.pivot
//   mixamorig:LeftLeg     → rightLeg.knee + calf.pivot
//   mixamorig:LeftFoot    → rightLeg.ankle + foot.pivot
//
//   mixamorig:RightUpLeg  → leftLeg.thigh.pivot
//   mixamorig:RightLeg    → leftLeg.knee + calf.pivot
//   mixamorig:RightFoot   → leftLeg.ankle + foot.pivot
//
// Handedness note: code's `leftArm` is on world -X = character's
// physical RIGHT side (per right-hand rule with forward=+Z, up=+Y;
// see audits/audit-pose-runtime-integration.md). Mixamo's "Left*"
// bones are on the character's physical LEFT. So mixamo Left maps
// to code rightArm, mixamo Right maps to code leftArm. This keeps
// the rest of the game (which reads main-hand from rig.leftArm)
// pointing at the correct physical side.

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Bare bone names (without the optional 'mixamorig:' prefix).
// Both Mixamo (mixamorig:Hips) and Motus Digital (Hips) export packs
// use the same naming scheme; the lookup in buildRigAdapter strips
// the prefix before checking this table.
const BONE_TO_CODE = {
  // torso chain
  'Hips':         { path: 'hips' },
  'Spine':        { path: 'stomach' },
  'Spine1':       { path: 'chest' },
  'Spine2':       { path: 'chest' }, // some rigs split — alias to chest
  'Neck':         { path: 'neck' },
  'Head':         { path: 'head' },

  // ARMS — pack's "Left*" → code rightArm (handedness flip).
  // Mixamo/Motus include a separate Shoulder + Arm bone; we map both
  // to shoulder.pivot since the procgen rig collapses them.
  'LeftShoulder': { path: 'rightArm.shoulder.pivot' },
  'LeftArm':      { path: 'rightArm.shoulder.pivot' },
  'LeftForeArm':  { path: 'rightArm.elbow' },
  'LeftHand':     { path: 'rightArm.wrist' },

  'RightShoulder':{ path: 'leftArm.shoulder.pivot' },
  'RightArm':     { path: 'leftArm.shoulder.pivot' },
  'RightForeArm': { path: 'leftArm.elbow' },
  'RightHand':    { path: 'leftArm.wrist' },

  // LEGS — same handedness flip.
  'LeftUpLeg':    { path: 'rightLeg.thigh.pivot' },
  'LeftLeg':      { path: 'rightLeg.knee' },
  'LeftFoot':     { path: 'rightLeg.ankle' },

  'RightUpLeg':   { path: 'leftLeg.thigh.pivot' },
  'RightLeg':     { path: 'leftLeg.knee' },
  'RightFoot':    { path: 'leftLeg.ankle' },
};

// Lookup helper — strips 'mixamorig:' prefix if present.
function bareBone(name) {
  if (!name) return name;
  return name.startsWith('mixamorig:') ? name.slice('mixamorig:'.length) : name;
}

// Walk the loaded FBX scene graph, find every bone matching the
// mixamorig:* names, and stamp them onto the rig adapter. Returns
// the rig structure that the rest of the game expects.
function buildRigAdapter(group, mixer) {
  // Find each bone by name. Mixamo FBX has a single SkinnedMesh whose
  // skeleton.bones array contains all bones; we can also walk the
  // group tree and look for Bone objects.
  const bonesByName = new Map();
  group.traverse((o) => {
    if (!o.isBone && !(o.name && (o.name.startsWith('mixamorig:') || BONE_TO_CODE[bareBone(o.name)]))) return;
    // Register under exact name AND bare name so callers can look up
    // either 'mixamorig:Hips' or just 'Hips' interchangeably. Many
    // packs also duplicate bones (deformer + skeleton copies); the
    // first registration wins which is the visible animation root.
    if (!bonesByName.has(o.name)) bonesByName.set(o.name, o);
    const bare = bareBone(o.name);
    if (bare !== o.name && !bonesByName.has(bare)) bonesByName.set(bare, o);
  });

  // Build an empty rig skeleton. Each "joint" is `{ pivot: bone }`
  // for arms/legs (matching the existing rig shape), or a direct
  // bone reference for hips/chest/etc.
  const rig = {
    group,
    scale: 1.0,
    leftArm:  { shoulder: { pivot: null, mesh: null }, elbow: null, forearm: { pivot: null, mesh: null }, wrist: null, hand: { pivot: null, mesh: null } },
    rightArm: { shoulder: { pivot: null, mesh: null }, elbow: null, forearm: { pivot: null, mesh: null }, wrist: null, hand: { pivot: null, mesh: null } },
    leftLeg:  { thigh: { pivot: null, mesh: null }, knee: null, calf: { pivot: null, mesh: null }, ankle: null, foot: { pivot: null, mesh: null } },
    rightLeg: { thigh: { pivot: null, mesh: null }, knee: null, calf: { pivot: null, mesh: null }, ankle: null, foot: { pivot: null, mesh: null } },
    hips: null, stomach: null, chest: null, neck: null, head: null,
    // dims.arms / dims.legs filled in below from world-distance compute
    // (matches buildRigFromPrimitives — keeps IK + lens code working).
    dims: { arms: {}, legs: {} },
    // FBX-specific extras.
    _fbx: {
      mixer,
      actions: new Map(),    // clipName → AnimationAction
      currentAction: null,
      bonesByName,
    },
  };

  // Set value at a dotted path on the rig adapter. Uses the same
  // path strings as MIXAMO_TO_CODE — `rightArm.shoulder.pivot` etc.
  const setAt = (path, val) => {
    const parts = path.split('.');
    let obj = rig;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = val;
  };

  // Try each table key with both the bare name and the 'mixamorig:'
  // prefix — Mixamo packs prefix, Motus Digital packs don't.
  for (const [bareName, target] of Object.entries(BONE_TO_CODE)) {
    const bone = bonesByName.get(bareName) || bonesByName.get(`mixamorig:${bareName}`);
    if (!bone) continue;
    setAt(target.path, bone);
  }

  // Compute bone lengths so IK (or any consumer that reads
  // dims.arms.upperArmH) doesn't see undefined. Same approach as
  // buildRigFromPrimitives — world distance / parent world scale.
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const segLen = (a, b) => {
    if (!a || !b || !a.parent) return 0;
    a.getWorldPosition(v1);
    b.getWorldPosition(v2);
    const w = v1.distanceTo(v2);
    a.parent.getWorldScale(sc);
    const avg = (sc.x + sc.y + sc.z) / 3;
    return avg > 1e-6 ? w / avg : w;
  };
  rig.dims.arms.upperArmH = segLen(rig.leftArm.shoulder.pivot,  rig.leftArm.elbow);
  rig.dims.arms.forearmH  = segLen(rig.leftArm.elbow,           rig.leftArm.wrist);
  rig.dims.legs.thighH    = segLen(rig.leftLeg.thigh.pivot,     rig.leftLeg.knee);
  rig.dims.legs.calfH     = segLen(rig.leftLeg.knee,            rig.leftLeg.ankle);

  // Diagnostic — dump every action's bind state, weight, time so we
  // can tell if a clip is actually animating bones or silently failing
  // to bind. Run from console: window.__player.rig.diag()
  rig.diag = () => {
    const out = { clipCount: rig._fbx.actions.size, clips: [], boneCount: bonesByName.size };
    for (const [name, action] of rig._fbx.actions) {
      const clip = action.getClip();
      // PropertyBindings are internal; peek to see how many tracks
      // actually resolved to bones in the mixer's root.
      const bindings = action._propertyBindings || [];
      const bound = bindings.filter(b => b && b.binding && b.binding.node).length;
      out.clips.push({
        name,
        duration: +clip.duration.toFixed(2),
        running: action.isRunning(),
        weight: +action.getEffectiveWeight().toFixed(2),
        time: +action.time.toFixed(2),
        trackCount: clip.tracks.length,
        boundTracks: bound,
      });
    }
    return out;
  };

  // Animation playback API.
  rig.play = (clipNameOrIndex, opts = {}) => {
    const { fadeMs = 200, loop = true, timeScale = 1.0 } = opts;
    let action = null;
    if (typeof clipNameOrIndex === 'string') {
      action = rig._fbx.actions.get(clipNameOrIndex);
      if (!action) {
        // Loose match — Mixamo names them 'mixamo.com', many users
        // think of them as 'idle'. Try the first non-empty clip.
        for (const [name, act] of rig._fbx.actions) {
          if (act.getClip().duration > 0.01) { action = act; break; }
        }
      }
    } else if (typeof clipNameOrIndex === 'number') {
      const arr = Array.from(rig._fbx.actions.values());
      action = arr[clipNameOrIndex];
    }
    if (!action) return null;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.timeScale = timeScale;
    if (rig._fbx.currentAction && rig._fbx.currentAction !== action) {
      rig._fbx.currentAction.fadeOut(fadeMs / 1000);
    }
    action.reset().fadeIn(fadeMs / 1000).play();
    rig._fbx.currentAction = action;
    return action;
  };
  rig.update = (dt) => {
    if (rig._fbx.mixer) rig._fbx.mixer.update(dt);
  };
  rig.setPlaybackSpeed = (v) => {
    if (rig._fbx.mixer) rig._fbx.mixer.timeScale = v;
  };
  rig.clipNames = () => Array.from(rig._fbx.actions.keys());

  return rig;
}

// Load an FBX from a URL and return the rig adapter. opts.scale
// defaults to 0.01 since Mixamo exports in centimetres.
export async function loadCharacterFBX(scene, url, opts = {}) {
  const { scale = 0.01 } = opts;
  const loader = new FBXLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, (group) => {
      group.scale.setScalar(scale);
      let skinnedMesh = null;
      group.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
        if (o.isSkinnedMesh && !skinnedMesh) skinnedMesh = o;
      });
      // Anchor the mixer to the SkinnedMesh, NOT the loaded group.
      // Mixamo/MotusMan FBX files contain a duplicate bone hierarchy
      // (a deformer copy + the rig skeleton); binding clip tracks by
      // name from the group root resolves to the wrong copy and the
      // mesh stays in bind pose even though tracks report bound=N.
      // Rooting the mixer at the SkinnedMesh constrains track lookup
      // to its skeleton.bones, which is the set the mesh actually
      // skins against.
      const mixerRoot = skinnedMesh || group;
      const mixer = new THREE.AnimationMixer(mixerRoot);
      // Pre-build one Action per clip so play(name) can fade in fast.
      // Skip empty clips (Mixamo always exports a 'Take 001' placeholder).
      const actions = new Map();
      for (const clip of (group.animations || [])) {
        if (clip.duration < 0.01) continue;
        actions.set(clip.name, mixer.clipAction(clip));
      }
      const rig = buildRigAdapter(group, mixer);
      rig._fbx.actions = actions;
      scene.add(group);
      // Auto-play the first clip if any, so the rig isn't a T-pose
      // statue on load. Caller can override via rig.play(...).
      const firstClipName = actions.keys().next().value;
      if (firstClipName) rig.play(firstClipName);
      resolve(rig);
    }, undefined, reject);
  });
}

// Merge animation clips from another FBX onto an already-loaded rig.
// Mixamo exports each animation as a separate FBX file; this lets you
// load the base rig once (e.g. Idle.fbx) and add Walk.fbx / Run.fbx /
// etc. on top so they all share the same skeleton + mixer.
export async function loadAnimationFBX(rig, url, clipName = null) {
  const loader = new FBXLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, (group) => {
      for (const clip of (group.animations || [])) {
        if (clip.duration < 0.01) continue;
        const name = clipName || clip.name || url.split('/').pop().replace(/\.fbx$/i, '');
        const action = rig._fbx.mixer.clipAction(clip);
        rig._fbx.actions.set(name, action);
      }
      resolve(rig);
    }, undefined, reject);
  });
}

// Unload — removes the FBX group from scene and disposes geometry/
// materials. The mixer is dropped along with it.
export function unloadCharacterFBX(scene, rig) {
  if (!rig || !rig.group) return;
  scene.remove(rig.group);
  rig.group.traverse(o => {
    if (o.geometry) o.geometry.dispose?.();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m?.dispose?.());
      else o.material.dispose?.();
    }
  });
  if (rig._fbx?.mixer) rig._fbx.mixer.stopAllAction();
}
