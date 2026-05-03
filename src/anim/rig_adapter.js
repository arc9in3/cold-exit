// ============================================================
// rig_adapter.js — Unified Rig interface (L1)
// ============================================================
//
// Cold Exit has three rig sources today:
//   - procgen   (src/actor_rig.js buildRig — primitive meshes)
//   - fbx       (src/character_fbx.js loadCharacterFBX — Mixamo / Motus)
//   - glb       (same loader, GLTFLoader path — eve.glb / Biped)
//
// Each returns a slightly different object shape. This module provides
// a thin shim so engine code can rely on ONE shape regardless of source.
//
// Phase 1 deliberately stays SHIMMY: existing callers continue to read
// rig.leftArm, rig.dims.arms.upperArmH, etc. exactly as today. The
// shim guarantees those properties exist (with no-op defaults for
// procgen rigs that don't have a mixer / clips).
//
// Phase 2 (graph.js) will consume this shape directly.

// Detect rig kind from object shape. FBX/GLB rigs carry a `_fbx`
// attachment populated by character_fbx.js; procgen rigs carry a
// `meshes` array populated by actor_rig.js. If neither, treat as
// procgen-shaped (safe default — methods become no-ops).
export function detectKind(rig) {
  if (!rig) return 'unknown';
  if (rig._fbx) return 'fbx';
  if (Array.isArray(rig.meshes)) return 'procgen';
  return 'unknown';
}

// Wrap a rig in-place so it satisfies the unified interface. Returns
// the same rig object (mutates) so existing references stay valid.
//
// Guarantees on return:
//   rig.kind             'procgen' | 'fbx' | 'glb' | 'unknown'
//   rig.group            THREE.Object3D root (existing on all rigs)
//   rig.scale            number
//   rig.dims             { arms: {...}, legs: {...} }
//   rig.update(dt)       step animations (no-op on procgen)
//   rig.play(name, opts) play a named clip (no-op on procgen)
//   rig.setPlaybackSpeed(v)
//   rig.clipNames()      array of available clip names ([] on procgen)
//   rig.hasClips         boolean
//
// All other rig fields (leftArm, hips, etc.) pass through untouched.
export function adapt(rig) {
  if (!rig || rig.__adapted) return rig;
  const kind = detectKind(rig);
  rig.kind = rig.kind || kind;
  if (typeof rig.scale !== 'number') rig.scale = 1.0;
  if (!rig.dims) rig.dims = { arms: {}, legs: {} };
  if (!rig.dims.arms) rig.dims.arms = {};
  if (!rig.dims.legs) rig.dims.legs = {};

  if (kind === 'fbx') {
    rig.hasClips = !!(rig._fbx && rig._fbx.actions && rig._fbx.actions.size > 0);
    // play/update/setPlaybackSpeed/clipNames already attached by the
    // FBX loader. Don't override.
  } else {
    // Procgen + unknown: add no-op stubs so callers can call uniformly.
    rig.hasClips = false;
    if (typeof rig.update !== 'function') rig.update = () => {};
    if (typeof rig.play !== 'function') rig.play = () => null;
    if (typeof rig.setPlaybackSpeed !== 'function') rig.setPlaybackSpeed = () => {};
    if (typeof rig.clipNames !== 'function') rig.clipNames = () => [];
  }

  Object.defineProperty(rig, '__adapted', { value: true, enumerable: false });
  return rig;
}

// Convenience — wrap and return. Used by future call sites that want
// a one-liner: const r = adaptRig(loadCharacterFBX(...)).
export function adaptRig(rig) {
  return adapt(rig);
}
