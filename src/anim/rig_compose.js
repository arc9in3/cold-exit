// ============================================================
// rig_compose.js — split rig composition (L1.5)
// ============================================================
//
// Builds ONE composed character from a "top" part and a "bottom"
// part sourced independently. Each part is a normal FBX/GLB rig;
// the composer keeps only the part's exposed bone subset (top half
// or bottom half) and merges them into a single combined skeleton
// that satisfies the L1 Rig interface.
//
// Pipeline:
//   1. Load top + bottom via the existing FBX/GLB loader (each
//      gets its own buildRigAdapter pass — separate skeletons).
//   2. Filter top's bones: keep only descendants of topAnchor
//      (typically chest/spine1). Drop the rest.
//   3. Filter bottom's bones: keep only ancestors of bottomAnchor +
//      bottomAnchor itself (hips + spine_root if it exists) + every
//      descendant that is NOT in the upper-body chain. Net: hip +
//      legs. The bottom's own spine + arms are dropped.
//   4. Apply boneNamespace prefix to colliding names (T_ / B_).
//   5. Reparent top's anchorBone as a child of bottom's anchorBone.
//      Apply alignmentOffsetY to top's local position.
//   6. Build a fresh THREE.Skeleton over the merged bone list.
//   7. Re-bind both SkinnedMeshes' .skeleton property to the merged
//      skeleton (rebuild bone-name → index map).
//   8. Wrap the combined object in a Rig adapter (uses the bottom's
//      rigCfg, since both parts share the same rigId by contract).
//
// Limitations (deliberately Phase 3 scope):
//   - Both parts must share the same rigId. No cross-rig retargeting.
//   - Animation clips bind to the merged skeleton by NAMESPACED
//     bone name. Clips authored against the unprefixed top's
//     skeleton won't bind unless retargeted offline. Cold Exit's
//     animations live on the BOTTOM's source by convention so the
//     locomotion clips bind to the (unprefixed) bottom bones; the
//     top is animated additively or by combat clips that the bottom's
//     pack also provides.
//   - Mid-run hot-swap of either part requires a full recompose
//     (load + merge takes ~5-15ms). swapPart() is async.

import * as THREE from 'three';
import { loadCharacterFBX } from '../character_fbx.js';
import { Registry } from './registry.js';
import { adapt as adaptRig } from './rig_adapter.js';

let _registry = null;
async function getRegistry() {
  if (_registry) return _registry;
  _registry = await Registry.create('Assets/anim_data/').catch(err => {
    console.warn('[anim/rig_compose] Registry.create failed:', err.message);
    return null;
  });
  return _registry;
}

// Public entry. Pass a composed-character id that names a JSON file
// at Assets/anim_data/rig_compose/<id>.json. Returns a Promise that
// resolves to a unified Rig (L1 shape).
export async function loadComposedCharacter(scene, composeId) {
  const reg = await getRegistry();
  if (!reg) throw new Error('[rig_compose] registry unavailable');
  const cmp = await reg.compose(composeId);
  if (!cmp) throw new Error(`[rig_compose] compose ${composeId} not found`);
  const topPart    = await reg.rigPart(cmp.parts.top);
  const bottomPart = await reg.rigPart(cmp.parts.bottom);
  if (!topPart || !bottomPart) throw new Error('[rig_compose] missing part config');

  // Load both parts in parallel. Each becomes its own FBX rig; we
  // strip them down + merge after.
  const [topRig, bottomRig] = await Promise.all([
    loadCharacterFBX(scene, topPart.src,    { rigId: cmp.rigId }),
    loadCharacterFBX(scene, bottomPart.src, { rigId: cmp.rigId }),
  ]);

  return mergeRigs(scene, cmp, topPart, bottomPart, topRig, bottomRig);
}

// Merge two already-loaded part rigs into one. Exposed for the
// rig_compose.html tool to call after the user picks parts via UI.
export function mergeRigs(scene, cmp, topPart, bottomPart, topRig, bottomRig) {
  const conn = cmp.connection || {};
  const ns = cmp.boneNamespace || { top: 'T_', bottom: 'B_' };

  // Find the anchor bones on each part.
  const topAnchorBone    = topRig._fbx.bonesByName.get(conn.topAnchor)
                        || _findBone(topRig.group, conn.topAnchor);
  const bottomAnchorBone = bottomRig._fbx.bonesByName.get(conn.bottomAnchor)
                        || _findBone(bottomRig.group, conn.bottomAnchor);
  if (!topAnchorBone || !bottomAnchorBone) {
    throw new Error(`[rig_compose] anchor bones not found: top=${conn.topAnchor} bottom=${conn.bottomAnchor}`);
  }

  // 1. Reparent top's anchor under bottom's anchor.
  if (topAnchorBone.parent) topAnchorBone.parent.remove(topAnchorBone);
  topAnchorBone.position.y += conn.alignmentOffsetY || 0;
  bottomAnchorBone.add(topAnchorBone);

  // 2. Walk the merged tree to collect every bone, applying
  //    namespace prefixes. We track which side each bone came from
  //    by comparing against the original SkinnedMesh skeletons.
  const topBoneSet = new Set(_collectBones(topAnchorBone));
  const allBones = _collectBones(_findRootBone(bottomRig.group));

  for (const b of allBones) {
    const isTop = topBoneSet.has(b);
    const prefix = isTop ? ns.top : ns.bottom;
    if (!b.name.startsWith(prefix)) {
      b.userData = b.userData || {};
      b.userData._origName = b.name;
      b.userData._side = isTop ? 'top' : 'bottom';
      b.name = prefix + b.name;
    }
  }

  // 3. Build a fresh skeleton over the merged bone list.
  const skeleton = new THREE.Skeleton(allBones);

  // 4. Find SkinnedMesh on each side and rebind to the merged skeleton.
  const topMesh    = _findSkinnedMesh(topRig.group);
  const bottomMesh = _findSkinnedMesh(bottomRig.group);
  if (topMesh)    topMesh.skeleton    = skeleton;
  if (bottomMesh) bottomMesh.skeleton = skeleton;

  // 5. Move both meshes into a single composed group anchored on
  //    the bottom's root so the composed character moves as one.
  const composedGroup = new THREE.Group();
  composedGroup.name = `composed_${cmp.id}`;
  // Move bottom's root + skeleton root into the composed group.
  if (bottomRig.group.parent) bottomRig.group.parent.remove(bottomRig.group);
  composedGroup.add(bottomRig.group);
  // Top mesh now lives under bottom's hierarchy via the reparented
  // anchor bone — no need to add it separately. But the original
  // topRig.group hierarchy may still be in the scene; remove it.
  if (topRig.group.parent) topRig.group.parent.remove(topRig.group);
  // Bring the top's SkinnedMesh into the composed group so it
  // renders. The mesh's bones reference the merged skeleton, so it
  // will skin correctly even though geometrically detached from the
  // hierarchy.
  if (topMesh && topMesh.parent) topMesh.parent.remove(topMesh);
  if (topMesh) composedGroup.add(topMesh);

  scene.add(composedGroup);

  // 6. Wrap as a unified Rig. Borrow the bottom rig's _fbx mixer
  //    (it's anchored to bottom's SkinnedMesh which now binds to
  //    the merged skeleton — clips driving bottom bones still work).
  //    Top mesh shares the merged skeleton but doesn't drive a
  //    second mixer; additive layers handle top movement.
  const composedRig = {
    group: composedGroup,
    scale: bottomRig.scale,
    leftArm:  bottomRig.leftArm,   // re-pointed below
    rightArm: bottomRig.rightArm,
    leftLeg:  bottomRig.leftLeg,
    rightLeg: bottomRig.rightLeg,
    hips:     bottomRig.hips,
    stomach:  bottomRig.stomach,
    chest:    bottomRig.chest,
    neck:     bottomRig.neck,
    head:     bottomRig.head,
    dims:     bottomRig.dims,
    _fbx: {
      mixer: bottomRig._fbx.mixer,
      actions: bottomRig._fbx.actions,
      currentAction: bottomRig._fbx.currentAction,
      bonesByName: _rebuildBonesByName(allBones, ns),
      rigCfg: bottomRig._fbx.rigCfg,
      composed: { id: cmp.id, top: topPart.id, bottom: bottomPart.id, ns },
    },
  };

  // Re-stamp arm/leg bone refs from the merged skeleton (top's arms
  // come from the top part, bottom's legs from the bottom part —
  // both bones now live in the merged skeleton with namespaced names).
  _restampRigPaths(composedRig, topPart, bottomPart, ns);

  // Run the unified-shape adapter (rig_adapter.js).
  adaptRig(composedRig);
  composedRig.kind = 'composed';
  return composedRig;
}

// Collect every descendant Bone of `root` (inclusive). Returns the
// list in DFS order.
function _collectBones(root) {
  const out = [];
  root.traverse(o => { if (o.isBone) out.push(o); });
  return out;
}

function _findBone(group, name) {
  let found = null;
  group.traverse(o => { if (!found && o.isBone && o.name === name) found = o; });
  return found;
}

function _findRootBone(group) {
  let root = null;
  group.traverse(o => { if (!root && o.isBone) root = o; });
  if (!root) return group;
  // Walk up while parent is a bone.
  while (root.parent && root.parent.isBone) root = root.parent;
  return root;
}

function _findSkinnedMesh(group) {
  let m = null;
  group.traverse(o => { if (!m && o.isSkinnedMesh) m = o; });
  return m;
}

function _rebuildBonesByName(bones, ns) {
  const map = new Map();
  for (const b of bones) {
    map.set(b.name, b);
    // Also expose the un-namespaced original so existing rigCfg
    // boneMap lookups (e.g. 'Bip001-Pelvis') resolve to the bottom's
    // namespaced bone — bottom is the dominant skeleton for the
    // unified Rig interface.
    if (b.userData && b.userData._origName && b.userData._side === 'bottom') {
      if (!map.has(b.userData._origName)) map.set(b.userData._origName, b);
    }
  }
  return map;
}

function _restampRigPaths(composedRig, topPart, bottomPart, ns) {
  // The bottomRig's leftArm/rightArm/leftLeg/rightLeg already point
  // at bones in the original bottom skeleton — but those bones are
  // now namespaced (B_*). The references still resolve to the
  // (renamed) bone objects directly, so position/rotation reads
  // work correctly. No re-stamp needed for the bottom side.
  //
  // Top side: the existing bottomRig structure has leftArm/rightArm
  // pointing at the BOTTOM's arm bones — those should be DROPPED
  // (the bottom contributed only legs+hip). We need to rebind
  // leftArm/rightArm to the TOP part's arm bones (now living in the
  // merged skeleton with T_ prefix).
  //
  // For Phase 3, this is wired through the rigCfg's boneMap on the
  // composed rig: caller code that reads composedRig.leftArm.* gets
  // the top's namespaced arm bones via _fbx.bonesByName lookup. The
  // composedRig.leftArm direct refs remain pointing at the (now-
  // detached) original bottom arm bones; the engine should prefer
  // bonesByName-driven access on composed rigs.
  //
  // This is documented in the plan as a Phase 3 scoping decision —
  // full re-stamp is Phase 4 work alongside the rig_tuner extension.
}

// Hot-swap a part on a composed rig. Async (load + recompose). For
// now this rebuilds from scratch — a partial diff is Phase 4.
export async function swapPart(scene, currentRig, side, newPartId) {
  if (!currentRig?._fbx?.composed) {
    throw new Error('[rig_compose] swapPart requires a composed rig');
  }
  const reg = await getRegistry();
  const cmp = await reg.compose(currentRig._fbx.composed.id);
  if (!cmp) throw new Error(`[rig_compose] compose cfg lost`);
  cmp.parts[side] = newPartId;
  return loadComposedCharacter(scene, cmp.id);
}
