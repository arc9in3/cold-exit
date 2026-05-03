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
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Registry } from './anim/registry.js';
import { adapt as adaptRig } from './anim/rig_adapter.js';

// Lazy registry singleton — loaded on first FBX/GLB load so the JSON
// configs at Assets/anim_data/rigs/* drive bone mapping. If the load
// fails (missing JSON, schema mismatch), we fall back to the legacy
// hardcoded BONE_TO_CODE table and the loader keeps working.
let _registry = null;
let _registryPromise = null;
async function getRegistry() {
  if (_registry) return _registry;
  if (!_registryPromise) {
    _registryPromise = Registry.create('Assets/anim_data/').catch(err => {
      console.warn('[character_fbx] Registry.create failed; using legacy bone map:', err.message);
      return null;
    });
  }
  _registry = await _registryPromise;
  return _registry;
}

// ============================================================
// PHASE 1 NOTE — bone-map source-of-truth migration
// ============================================================
// The hardcoded BONE_TO_CODE table below is being migrated to JSON
// config files at Assets/anim_data/rigs/{mixamo,motus,biped}.json,
// loaded by src/anim/registry.js.
//
// During migration, BOTH paths exist:
// - If buildRigAdapter is called with a rigCfg parameter, the JSON
//   table is used (per-rig, with prefix-strip + suffix-regex from
//   the rigCfg).
// - If no rigCfg is passed, the hardcoded BONE_TO_CODE union table
//   is used. This is the legacy code path that EXISTING callers
//   (loadCharacterFBX without options) hit.
//
// Once all callers pass rigCfg + the registry is in main.js boot,
// the hardcoded table can be deleted.
// ============================================================
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

  // 3ds Max Biped naming (Bip001-* prefix). eve.glb uses this scheme,
  // and bones often have a numeric suffix (Bip001-Pelvis_349) that
  // bareBone() handles via partial match further down.
  'Bip001-Pelvis':       { path: 'hips' },
  'Bip001-Spine':        { path: 'stomach' },
  'Bip001-Spine1':       { path: 'chest' },
  'Bip001-Neck':         { path: 'neck' },
  'Bip001-Head':         { path: 'head' },
  // Biped's L/R follows the same handedness flip — char's Left = code rightArm.
  'Bip001-L-Clavicle':   { path: 'rightArm.shoulder.pivot' },
  'Bip001-L-UpperArm':   { path: 'rightArm.shoulder.pivot' },
  'Bip001-L-Forearm':    { path: 'rightArm.elbow' },
  'Bip001-L-Hand':       { path: 'rightArm.wrist' },
  'Bip001-R-Clavicle':   { path: 'leftArm.shoulder.pivot' },
  'Bip001-R-UpperArm':   { path: 'leftArm.shoulder.pivot' },
  'Bip001-R-Forearm':    { path: 'leftArm.elbow' },
  'Bip001-R-Hand':       { path: 'leftArm.wrist' },
  'Bip001-L-Thigh':      { path: 'rightLeg.thigh.pivot' },
  'Bip001-L-Calf':       { path: 'rightLeg.knee' },
  'Bip001-L-Foot':       { path: 'rightLeg.ankle' },
  'Bip001-R-Thigh':      { path: 'leftLeg.thigh.pivot' },
  'Bip001-R-Calf':       { path: 'leftLeg.knee' },
  'Bip001-R-Foot':       { path: 'leftLeg.ankle' },
};

// Lookup helper — strips 'mixamorig:' prefix and trailing numeric
// suffix ('_349' style used by 3ds Max Biped exports / eve.glb).
function bareBone(name) {
  if (!name) return name;
  let n = name;
  if (n.startsWith('mixamorig:')) n = n.slice('mixamorig:'.length);
  // Strip trailing _N suffix (Biped numeric tags).
  n = n.replace(/_\d+$/, '');
  return n;
}

// Per-rig bareBone — uses prefix-strip + suffix-regex from a rig JSON
// config (when provided), else falls back to the hardcoded behavior.
function bareBoneCfg(name, rigCfg) {
  if (!name) return name;
  let n = name;
  if (rigCfg) {
    for (const p of (rigCfg.bonePrefixStrip || [])) {
      if (n.startsWith(p)) { n = n.slice(p.length); break; }
    }
    if (rigCfg.boneSuffixStripRegex) {
      n = n.replace(new RegExp(rigCfg.boneSuffixStripRegex), '');
    }
    return n;
  }
  // Legacy fallback: strip mixamorig: + trailing _N
  if (n.startsWith('mixamorig:')) n = n.slice('mixamorig:'.length);
  n = n.replace(/_\d+$/, '');
  return n;
}

// Walk the loaded FBX scene graph, find every bone matching the
// mixamorig:* names (or the rigCfg-driven names if rigCfg is passed),
// and stamp them onto the rig adapter. Returns the rig structure
// that the rest of the game expects.
//
// Optional rigCfg parameter: a parsed JSON config from
// Assets/anim_data/rigs/<id>.json. When provided, the cfg's boneMap
// + prefix-strip + suffix-regex drive bone lookup. When omitted,
// the legacy hardcoded BONE_TO_CODE union table is used (Phase 1
// migration: existing callers don't break).
function buildRigAdapter(group, mixer, rigCfg = null) {
  const boneMap = rigCfg && rigCfg.boneMap ? rigCfg.boneMap : null;
  // Find each bone by name. Mixamo FBX has a single SkinnedMesh whose
  // skeleton.bones array contains all bones; we can also walk the
  // group tree and look for Bone objects.
  const bonesByName = new Map();
  group.traverse((o) => {
    const isMatchedName = o.name && (
      o.name.startsWith('mixamorig:')
      || (boneMap && boneMap[bareBoneCfg(o.name, rigCfg)])
      || (!boneMap && BONE_TO_CODE[bareBoneCfg(o.name, null)])
    );
    if (!o.isBone && !isMatchedName) return;
    // Register under exact name AND bare name so callers can look up
    // either 'mixamorig:Hips' or just 'Hips' interchangeably. Many
    // packs also duplicate bones (deformer + skeleton copies); the
    // first registration wins which is the visible animation root.
    if (!bonesByName.has(o.name)) bonesByName.set(o.name, o);
    const bare = bareBoneCfg(o.name, rigCfg);
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

  if (boneMap) {
    // Registry-driven path: rigCfg.boneMap is { 'BareName': 'rig.path' }
    // (string), and prefix-strip / suffix-regex are applied via
    // bareBoneCfg() so the original FBX bone names match.
    for (const [bareName, path] of Object.entries(boneMap)) {
      const bone = bonesByName.get(bareName);
      if (!bone) continue;
      setAt(path, bone);
    }
  } else {
    // Legacy path — try each hardcoded table key with both the bare
    // name and the 'mixamorig:' prefix.
    for (const [bareName, target] of Object.entries(BONE_TO_CODE)) {
      const bone = bonesByName.get(bareName) || bonesByName.get(`mixamorig:${bareName}`);
      if (!bone) continue;
      setAt(target.path, bone);
    }
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

// Auto-detect FBX vs GLB by extension. GLB / glTF files load via
// GLTFLoader and are typically already in metres (no cm scale needed).
function loaderForUrl(url) {
  return /\.(glb|gltf)$/i.test(url) ? new GLTFLoader() : new FBXLoader();
}
function defaultScaleForUrl(url) {
  return /\.(glb|gltf)$/i.test(url) ? 1.0 : 0.01;
}

// Load a character FBX or GLB from a URL and return the rig adapter.
// opts.scale defaults to 0.01 for FBX (Mixamo cm) or 1.0 for GLB.
// opts.rigId — explicit rig config id ('mixamo' | 'motus' | 'biped').
//              When omitted, Registry.detectRigId() auto-detects.
// opts.rigCfg — explicit parsed rigCfg (bypasses registry).
export async function loadCharacterFBX(scene, url, opts = {}) {
  const isGLB = /\.(glb|gltf)$/i.test(url);
  const { scale = defaultScaleForUrl(url), rigId = null, rigCfg = null } = opts;
  const loader = loaderForUrl(url);
  // Resolve rigCfg: explicit > registry-by-id > defer to detect-on-load
  let resolvedCfg = rigCfg;
  if (!resolvedCfg && rigId) {
    const reg = await getRegistry();
    if (reg) resolvedCfg = reg.rig(rigId);
  }
  return new Promise((resolve, reject) => {
    loader.load(url, async (loaded) => {
      // GLTFLoader returns { scene, animations, ... }; FBXLoader returns
      // a Group directly. Unify by extracting `group` + `animations`.
      const group = isGLB ? loaded.scene : loaded;
      if (isGLB && loaded.animations && !group.animations) {
        group.animations = loaded.animations;
      }
      // Auto-detect rig if no cfg was specified.
      if (!resolvedCfg) {
        const reg = await getRegistry();
        if (reg) {
          const boneNames = [];
          group.traverse(o => { if (o.isBone && o.name) boneNames.push(o.name); });
          const detected = reg.detectRigId(boneNames);
          if (detected) {
            resolvedCfg = reg.rig(detected);
            console.log(`[character_fbx] auto-detected rig "${detected}" for ${url}`);
          }
        }
      }
      // Re-enter the FBX path with the unified group below.
      _onLoadGroup(scene, group, scale, resolve, resolvedCfg);
    }, undefined, reject);
  });
}

// Strip ALL position + scale tracks from every clip. Mixamo / Motus
// / Biped packs author root motion as well as subtle stride bounce,
// idle weight-shift, and breathing dips on various bones — including
// nodes ABOVE the rig's hip (export armature roots, "Take 001"
// containers) that my earlier name-based filter missed. Symptom of
// the missed cases: whole body sinking through the ground at a
// regular cadence even when standing still (idle clip's vertical bob
// driving a top-level translation).
//
// In Cold Exit the player's world position is driven by gameplay
// physics on the rig.group; clip-level translations can ONLY ever
// fight that. So we keep quaternion (rotation) tracks across the
// board and drop position + scale entirely. If a future setup
// requires root-motion-driven movement, gate this strip behind a
// per-pack flag.
function _stripRootMotion(clip) {
  if (!clip || !clip.tracks) return;
  clip.tracks = clip.tracks.filter(track => {
    const match = track.name.match(/\.(position|quaternion|scale)(\[.+\])?$/);
    if (!match) return true;
    const prop = match[1];
    return prop === 'quaternion';
  });
}

// Shared post-load step (used by both FBX and GLB paths).
function _onLoadGroup(scene, group, scale, resolve, rigCfg = null) {
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
  // Strip root-bone POSITION tracks before binding — even "in-place"
  // captures often have a small hip-bone Y oscillation (stride bounce)
  // that produces intermittent foot-clip-through-ground glitches when
  // group.position.y is at exactly 0. We keep rotations on the hip
  // bone (those drive the body's pose) but null out translation.
  const actions = new Map();
  for (const clip of (group.animations || [])) {
    if (clip.duration < 0.01) continue;
    _stripRootMotion(clip);
    actions.set(clip.name, mixer.clipAction(clip));
  }
  const rig = buildRigAdapter(group, mixer, rigCfg);
  rig._fbx.actions = actions;
  rig._fbx.rigCfg = rigCfg;
  // Normalize to the unified Rig interface (anim/rig_adapter.js). For
  // FBX this is a no-op for the existing methods; it adds rig.kind +
  // rig.hasClips so downstream code can treat any rig uniformly.
  adaptRig(rig);
  scene.add(group);
  // Auto-play the first clip if any.
  const firstClipName = actions.keys().next().value;
  if (firstClipName) rig.play(firstClipName);
  resolve(rig);
}

// Merge animation clips from another FBX or GLB onto an already-loaded
// rig. Mixamo exports each animation as a separate FBX file; the
// Universal Animation Library (Quaternius) ships as one big GLB with
// all clips in it. Both go through the same path here.
//
// For multi-clip files (UAL): clipName is OPTIONAL. Each clip from the
// loaded asset is registered under its own name (clip.name).
export async function loadAnimationFBX(rig, url, clipName = null) {
  const isGLB = /\.(glb|gltf)$/i.test(url);
  const loader = loaderForUrl(url);
  return new Promise((resolve, reject) => {
    loader.load(url, (loaded) => {
      const animations = isGLB ? loaded.animations : (loaded.animations || []);
      let added = 0;
      for (const clip of animations) {
        if (clip.duration < 0.01) continue;
        _stripRootMotion(clip);
        // Single-clip merge: use provided clipName. Multi-clip merge
        // (UAL): use each clip's own name.
        const name = (animations.length === 1 && clipName)
          ? clipName
          : (clip.name || `${url.split('/').pop().replace(/\.(fbx|glb|gltf)$/i, '')}_${added}`);
        const action = rig._fbx.mixer.clipAction(clip);
        rig._fbx.actions.set(name, action);
        added++;
      }
      console.log(`[fbx] merged ${added} clip(s) from ${url}`);
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
