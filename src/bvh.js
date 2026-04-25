// BVH acceleration for Three.js raycasts. The game's hot CPU paths —
// LoS mask (96 rays/frame), wall-occlusion fan (~30 rays/frame),
// per-enemy LoS (~30 rays/frame), and bullet hit resolution — all
// raycast against the same wall list. Vanilla Raycaster.intersectObjects
// is a linear O(N×triangles) scan; three-mesh-bvh swaps each mesh's
// raycast for a BVH-walk that's effectively O(log N×triangles), so
// 30k+ ray-AABB tests per frame become a fraction of that.
//
// Patch is applied once at module load. Per-mesh BVH trees are built
// lazily via `accelerateMesh` after a level rebuild — geometries
// don't mutate after that, so the tree stays valid until disposal.

import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

// Three-mesh-bvh extends Mesh.raycast and BufferGeometry. Calling these
// extensions on every Mesh in the scene is opt-in: by default the
// patched raycast checks for `geometry.boundsTree` and falls back to
// the vanilla raycast if absent, so safe to install globally.
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

// Build a bounds tree on a single mesh's geometry. Idempotent — calling
// twice on the same geometry is a no-op (computeBoundsTree exits early
// if a tree already exists).
export function accelerateMesh(mesh) {
  if (!mesh || !mesh.geometry) return;
  if (mesh.geometry.boundsTree) return;
  // Skip un-indexed point/sprite geometries — BVH expects triangles.
  // BoxGeometry / wall geometries always have indices, so the common
  // case isn't affected.
  if (!mesh.geometry.attributes?.position) return;
  try {
    mesh.geometry.computeBoundsTree();
  } catch (_) {
    // BVH construction can throw on degenerate geometry. Fall back
    // silently — Three's vanilla raycast still works.
  }
}

// Walk an array of meshes and accelerate each. Used after level
// generation to seed the wall + obstacle list.
export function accelerateAll(meshes) {
  if (!meshes) return;
  for (let i = 0; i < meshes.length; i++) accelerateMesh(meshes[i]);
}

// Free a mesh's bounds tree before disposing the geometry. Optional —
// regular geometry.dispose() also releases tree memory through three's
// dispose chain, but explicit teardown is cheaper if levels regenerate
// often.
export function disposeMesh(mesh) {
  if (!mesh || !mesh.geometry || !mesh.geometry.boundsTree) return;
  try { mesh.geometry.disposeBoundsTree(); } catch (_) {}
}
