// ============================================================
// overrides.js — L5: per-character props, materials, bone offsets
// ============================================================
//
// Each composed (or single) character can declare an overrides JSON
// at Assets/anim_data/overrides/<id>.json. The schema:
//
//   {
//     "props": {
//       "primaryWeapon": { "bone":"...", "offset":[x,y,z], "rotation":[x,y,z] },
//       ...
//     },
//     "materials": {
//       "body":   { "tintHex":"#c8a37a" },
//       "top":    { "tintHex":"#1a1a2e" },
//       "bottom": { "tintHex":"#3a2a1a" }
//     },
//     "boneOffsets": {
//       "chest": { "rotation":[x,y,z], "position":[x,y,z] }
//     }
//   }
//
// The runtime applies overrides at attach time:
//   applyOverrides(rig, overridesCfg)              — materials + boneOffsets
//   resolvePropAttachment(overridesCfg, propId)    — returns { boneName, offset, rotation }
//
// This module DOES NOT replace src/model_manifest.js's MODEL_GRIP_OFFSET
// / MODEL_ROTATION_OVERRIDE tables — those are keyed by weapon path
// (per-asset axis), while overrides.json is keyed by character id
// (per-actor axis). They co-exist and the engine merges both at the
// weapon-attach call site (model_manifest table is the authoring
// fallback when a character override doesn't override a slot).

import * as THREE from 'three';
import { Registry } from './registry.js';

let _registry = null;
async function getRegistry() {
  if (_registry) return _registry;
  _registry = await Registry.create('Assets/anim_data/').catch(err => {
    console.warn('[anim/overrides] Registry.create failed:', err.message);
    return null;
  });
  return _registry;
}

export async function loadOverrides(characterId) {
  const reg = await getRegistry();
  if (!reg) return null;
  return await reg.overrides(characterId).catch(() => null);
}

// Apply material tints + bone offsets to a rig at attach time.
// Idempotent — calling twice with the same config produces the same
// state. Pass the rig (L1 shape) and the parsed overrides cfg.
export function applyOverrides(rig, cfg) {
  if (!rig || !cfg) return;
  // Material tints — apply to any THREE.MeshStandardMaterial we can
  // resolve by side. For composed rigs, top/bottom materials are
  // located on the SkinnedMesh per side; for single rigs, "body"
  // tints every material in the mesh.
  if (cfg.materials) {
    rig.group?.traverse?.(o => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      const side = o.userData?._side || 'body';
      const tintCfg = cfg.materials[side] || cfg.materials.body;
      if (!tintCfg || !tintCfg.tintHex) return;
      const tint = new THREE.Color(tintCfg.tintHex);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && m.color && m.color.copy) m.color.copy(tint);
      }
    });
  }
  // Bone offsets — applied as local position/rotation deltas. Stored
  // in rig._fbx.bonesByName under the rigCfg-mapped bare name OR the
  // original namespaced name (composed rigs).
  if (cfg.boneOffsets) {
    const bones = rig._fbx?.bonesByName;
    if (!bones) return;
    for (const [boneKey, off] of Object.entries(cfg.boneOffsets)) {
      // Try several lookups: exact key, prefixed (T_/B_), bare via
      // rigCfg boneMap reverse-lookup.
      let bone = bones.get(boneKey);
      if (!bone && rig._fbx.composed) {
        bone = bones.get('T_' + boneKey) || bones.get('B_' + boneKey);
      }
      if (!bone && rig._fbx.rigCfg?.boneMap) {
        // Reverse-lookup: find a boneName whose mapped path === boneKey.
        for (const [bn, path] of Object.entries(rig._fbx.rigCfg.boneMap)) {
          if (path === boneKey || path.startsWith(boneKey + '.')) {
            bone = bones.get(bn);
            if (bone) break;
          }
        }
      }
      if (!bone) continue;
      if (off.position) bone.position.fromArray(off.position).add(_zeroV.copy(bone.position));
      if (off.rotation) {
        bone.rotation.set(off.rotation[0], off.rotation[1], off.rotation[2]);
      }
    }
  }
}
const _zeroV = new THREE.Vector3();

// Resolve a prop's attachment for a given character. Returns
// { boneName, offset, rotation } or null if the prop isn't declared.
// Engine code that already has a fallback (model_manifest grip
// offsets) should fall through to that when this returns null.
export function resolvePropAttachment(cfg, propId) {
  if (!cfg || !cfg.props) return null;
  const p = cfg.props[propId];
  if (!p) return null;
  return {
    boneName: p.bone,
    offset: p.offset ? new THREE.Vector3(p.offset[0], p.offset[1], p.offset[2]) : new THREE.Vector3(),
    rotation: p.rotation ? new THREE.Euler(p.rotation[0], p.rotation[1], p.rotation[2]) : new THREE.Euler(),
  };
}
