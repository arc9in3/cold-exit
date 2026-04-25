// Corpse mesh merge — once a dead enemy's ragdoll-lite physics settles,
// the rig's pose is frozen. Keeping the full ~12-mesh hierarchy (one
// per body part) costs draw calls + per-frame frustum-cull walks for
// no visual benefit since nothing on the corpse moves anymore.
//
// `bakeCorpseRig` walks the live rig, captures each visible mesh's
// world-space geometry into a single merged BufferGeometry per
// material, swaps that into the scene as flat Meshes, and removes the
// original hierarchy. Each settled corpse drops from ~12 meshes to
// ~3 (one per unique material), with no per-bone matrix updates ever
// running again.
//
// The merge is destructive on the source rig — call only when the
// rig is no longer animated. Caller is responsible for keeping a
// reference to the returned mesh group if it needs to find the
// corpse later (e.g., for cleanup on level regen).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Walks the rig, gathers meshes grouped by material, and bakes each
// group into one merged BufferGeometry. Returns a Group containing
// one Mesh per material — caller adds to the scene + removes the
// source rig.
export function bakeCorpseRig(rigGroup) {
  if (!rigGroup) return null;
  // Make sure every world matrix in the chain is current. The rig has
  // been animated up until now, so a final updateMatrixWorld captures
  // the settled pose accurately.
  rigGroup.updateMatrixWorld(true);

  // Group meshes by their material reference. Same material → one
  // merged geometry; this also dedupes: even if two body parts hold
  // a reference to the SAME bodyMat object, they go in the same
  // bucket and emerge as one draw call.
  const byMaterial = new Map();
  const _tmpInverse = new THREE.Matrix4();

  rigGroup.traverse((obj) => {
    if (!obj.isMesh || !obj.visible) return;
    if (!obj.geometry || !obj.material) return;
    // Skip already-baked corpse meshes (defensive — caller should
    // never call this twice on the same rig, but be safe).
    if (obj.userData.__corpseBaked) return;
    // We bake into a single root Mesh per material — make the source
    // geometry world-space-relative-to-the-root by transforming with
    // (mesh.matrixWorld) * (root.matrixWorld^-1). Since we'll add the
    // baked Group to the same parent the rig is in, root-local space
    // is the right output frame.
    const cloned = obj.geometry.clone();
    _tmpInverse.copy(rigGroup.matrixWorld).invert();
    const localMatrix = new THREE.Matrix4().multiplyMatrices(_tmpInverse, obj.matrixWorld);
    cloned.applyMatrix4(localMatrix);
    // Skinned / instanced geometry don't merge cleanly with normal
    // BufferGeometry — the rig is plain so this is just defensive.
    if (cloned.isInstancedBufferGeometry || cloned.isSkinnedBufferGeometry) {
      cloned.dispose();
      return;
    }
    // Normalise attributes — mergeGeometries refuses heterogeneous
    // attribute sets. If a mesh has e.g. a uv2 the others don't, drop
    // it so the merge succeeds. Position + normal are always present
    // on rig primitives.
    const allowed = new Set(['position', 'normal']);
    for (const k of Object.keys(cloned.attributes)) {
      if (!allowed.has(k)) cloned.deleteAttribute(k);
    }
    if (cloned.index === null) {
      // mergeGeometries needs all geometries indexed OR all non-indexed.
      // Synthesise a trivial index for non-indexed primitives so the
      // mix is uniform.
      const count = cloned.attributes.position.count;
      const idx = new Uint32Array(count);
      for (let i = 0; i < count; i++) idx[i] = i;
      cloned.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    let bucket = byMaterial.get(obj.material);
    if (!bucket) { bucket = []; byMaterial.set(obj.material, bucket); }
    bucket.push(cloned);
  });

  if (byMaterial.size === 0) return null;

  // Build the result group at rig-local origin, parented to whatever
  // the rig was parented to. Each material becomes one Mesh.
  const out = new THREE.Group();
  out.position.copy(rigGroup.position);
  out.rotation.copy(rigGroup.rotation);
  out.quaternion.copy(rigGroup.quaternion);
  out.scale.copy(rigGroup.scale);
  out.userData.__corpseBaked = true;

  for (const [mat, geoms] of byMaterial) {
    if (geoms.length === 0) continue;
    const merged = geoms.length === 1
      ? geoms[0]
      : mergeGeometries(geoms, false);
    if (!merged) {
      // mergeGeometries returns null on attribute mismatch — clean up
      // and skip this material rather than crash.
      for (const g of geoms) g.dispose();
      continue;
    }
    // Free the source clones now that they're folded into `merged`.
    if (geoms.length > 1) for (const g of geoms) g.dispose();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.__corpseBaked = true;
    out.add(mesh);
  }

  return out;
}

// Replace `rigGroup` with its baked equivalent in the scene. Returns
// the new group so callers can stash a reference for later cleanup.
// Safe no-op if baking yields nothing usable.
export function swapInBakedCorpse(rigGroup) {
  const baked = bakeCorpseRig(rigGroup);
  if (!baked) return null;
  const parent = rigGroup.parent;
  if (parent) {
    parent.add(baked);
    parent.remove(rigGroup);
  }
  // Dispose the original rig's geometries — the merge cloned + folded
  // them into `merged`, so the originals are no longer referenced and
  // would otherwise leak GPU memory until the level regen.
  rigGroup.traverse((obj) => {
    if (obj.isMesh && obj.geometry) obj.geometry.dispose();
  });
  return baked;
}
