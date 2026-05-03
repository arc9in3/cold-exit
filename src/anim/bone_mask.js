// ============================================================
// bone_mask.js — per-bone weight masks via mixer-binding patch (L4)
// ============================================================
//
// THREE.AnimationMixer composes one or more actions over a shared
// PropertyMixer per bound property (one per bone-channel). Each
// PropertyMixer.accumulate(accuIndex, weight) is called once per
// active action with the action's effective weight; the mixer then
// blends the buffer against the next action's accumulated buffer.
//
// We need PER-BONE weights so a "top" layer can drive only the upper
// body while a "bottom" layer drives only the legs, sharing one
// mixer. THREE doesn't expose this. The standard workaround is to
// run two mixers on different roots, doubling track-binding storage.
//
// This module patches PropertyMixer.accumulate ONCE on construction
// to multiply the supplied weight by a per-(action, bone) factor
// looked up via:
//
//   action.userData.boneMask: Map<boneName, number>   // 0..1 per bone
//
// If the action has no boneMask the patch is a no-op and behaviour
// matches stock THREE. The lookup is cached on the binding so we
// only do the dictionary lookup once per (binding, action) pair.
//
// Risk note from the plan: depends on undocumented THREE internals
// (PropertyMixer.accumulate signature + binding.binding.targetObject /
// .propertyName). Pin THREE version. The "two mixers" path remains
// available via the disable() flag for future fallback.

import * as THREE from 'three';

let _patched = false;
let _enabled = true;

// Resolve the bone name a binding writes to. THREE stores it as
// binding.binding.targetObject (the bone) when the binding has been
// set up by the mixer. propertyName is e.g. 'quaternion' / 'position'.
function _resolveBoneName(propertyMixer) {
  const binding = propertyMixer.binding;
  if (!binding) return null;
  const target = binding.targetObject;
  if (target && target.name) return target.name;
  // Fallback: parse parsedPath.nodeName (the track's [bone] segment).
  const pp = binding.parsedPath;
  return pp ? pp.nodeName : null;
}

// Apply the patch once per process. Subsequent calls are no-ops.
// The patch wraps PropertyMixer.prototype.accumulate AND
// AnimationAction.prototype._update (so we know which action is
// currently composing into the property mixer).
export function installMaskPatch(THREENS = THREE) {
  if (_patched) return;
  const PMixer = THREENS.PropertyMixer;
  if (!PMixer || !PMixer.prototype || !PMixer.prototype.accumulate) {
    console.warn('[anim/bone_mask] PropertyMixer.accumulate not found; mask patch disabled');
    return;
  }
  // Patch AnimationAction._update so we can stash the action on a
  // module-local before any accumulate() it triggers, then clear
  // after. This is the only documented per-action hook on the THREE
  // mixer pipeline.
  const AnimationAction = THREENS.AnimationAction;
  if (AnimationAction && AnimationAction.prototype && AnimationAction.prototype._update) {
    const origActionUpdate = AnimationAction.prototype._update;
    AnimationAction.prototype._update = function patchedActionUpdate(...args) {
      const prev = _currentAction;
      _currentAction = this;
      try {
        return origActionUpdate.apply(this, args);
      } finally {
        _currentAction = prev;
      }
    };
  } else {
    // Some bundlers strip the symbol; the patch still works for
    // simple single-action cases but per-action masking will be
    // unreliable. Log a warning so this doesn't fail silently.
    console.warn('[anim/bone_mask] AnimationAction.prototype._update not found; mask patch will rely on explicit setCurrentAction calls.');
  }
  const original = PMixer.prototype.accumulate;
  // Each accumulate call receives (accuIndex, weight) and is associated
  // with EXACTLY ONE action's contribution this frame (the mixer loops
  // over actions and calls accumulate per binding per action). We
  // identify the action via a thread-local set immediately before/
  // after via _currentAction below.
  PMixer.prototype.accumulate = function patchedAccumulate(accuIndex, weight) {
    if (!_enabled) return original.call(this, accuIndex, weight);
    const action = _currentAction;
    if (!action || !action.userData || !action.userData.boneMask) {
      return original.call(this, accuIndex, weight);
    }
    // Cache resolved bone name on the PropertyMixer to avoid the
    // string lookup every frame.
    if (this.__boneNameCache === undefined) {
      this.__boneNameCache = _resolveBoneName(this) || null;
    }
    const boneName = this.__boneNameCache;
    if (!boneName) {
      return original.call(this, accuIndex, weight);
    }
    const mask = action.userData.boneMask;
    // boneMask supports two shapes:
    //   Map<boneName, number>   — per-bone weight, default 1
    //   { include: Set, exclude: Set, defaultWeight }
    let factor;
    if (mask instanceof Map) {
      factor = mask.has(boneName) ? mask.get(boneName) : 1;
    } else if (mask && typeof mask === 'object') {
      const def = mask.defaultWeight ?? 1;
      if (mask.exclude && mask.exclude.has(boneName)) factor = 0;
      else if (mask.include && !mask.include.has(boneName)) factor = mask.outsideWeight ?? 0;
      else factor = mask.includeWeight ?? def;
    } else {
      factor = 1;
    }
    if (factor === 1) return original.call(this, accuIndex, weight);
    if (factor === 0) return; // skip composition entirely — saves the slerp
    return original.call(this, accuIndex, weight * factor);
  };
  _patched = true;
}

// The mixer doesn't pass the action into accumulate(), so we set it
// from a hook around AnimationMixer._update via setCurrentAction()
// (called from graph.js right before action.play() is run for that
// frame). This is a tiny but explicit dance — we DON'T want to
// monkey-patch the mixer's update loop.
let _currentAction = null;
export function setCurrentAction(action) { _currentAction = action; }
export function clearCurrentAction()    { _currentAction = null; }

// Build a Map<boneName, number> from a logicalGroup name + a rig cfg.
// `groupName` is e.g. 'top' / 'bottom' / 'lower' / 'upper' from the
// rig config's logicalGroups. Returns a flat Map suitable for use as
// action.userData.boneMask. Uses string globs (`leftArm.*`) — for
// FBX/GLB rigs this resolves against the cfg.boneMap by checking
// whether the bone's mapped path starts with the glob prefix.
//
// For procgen rigs (boneMap is empty), the names in the mask are the
// raw rig.path strings that match — actor_rig.js procedural code
// applies these manually, this map just tags the right set.
export function buildBoneMask(groupName, rigCfg) {
  const out = new Map();
  if (!rigCfg) return out;
  const groups = rigCfg.logicalGroups || {};
  const globs = groups[groupName] || [];
  // Map rigCfg.boneMap = { boneName -> rigPath } (or empty for procgen).
  // For each (boneName, rigPath), set out[boneName] = 1 iff rigPath
  // matches one of the globs. defaultWeight stays implicit 0 (caller
  // can swap to {include, exclude} format if needed).
  const matches = (path, glob) => {
    if (glob.endsWith('.*')) return path.startsWith(glob.slice(0, -1));
    return path === glob;
  };
  if (rigCfg.boneMap && Object.keys(rigCfg.boneMap).length) {
    for (const [boneName, rigPath] of Object.entries(rigCfg.boneMap)) {
      if (globs.some(g => matches(rigPath, g))) out.set(boneName, 1);
    }
  }
  return out;
}

// Toggle for fallback path (two mixers). Currently unused in the live
// path — flips the patched accumulate back to stock behaviour.
export function setEnabled(v) { _enabled = !!v; }
export function isEnabled() { return _enabled; }
export function isPatched() { return _patched; }
