"""
Cold Exit asset conversion pipeline — FBX → GLB (Blender 5.1).

Usage (from a shell):

    blender --background --python tools/blender-fbx-to-glb.py -- \
        --in  "Assets/models/animations/FBX_Pistol_Starter_27A/Animation/In-Place/W1_Stand_Relaxed_Idle_IPC.fbx" \
        --out "Assets/models/animations/FBX_Pistol_Starter_27A_glb/W1_Stand_Relaxed_Idle_IPC.glb" \
        --strip-root-motion \
        --no-leaf-bones

The wrapper script `tools/blender-fbx-to-glb.bat` (Windows) and
`tools/blender-fbx-to-glb.sh` (Unix) handle finding the Blender
binary and forwarding args.

What this script does (in order):
1. Wipe the default scene Blender boots with.
2. Import the FBX (bpy.ops.import_scene.fbx). Use leaf-bone control,
   automatic-bone-orientation off (we want the source orientation),
   and import animations.
3. If --strip-root-motion: remove location/translation F-curves on
   the armature root + any hip/pelvis bones from EVERY action.
   Cold Exit drives world position from gameplay; clip-level
   translations cause foot-clip-through-ground bugs.
4. If --rename-bones <map.json>: rename bones per a name map. Lets
   us normalize wildly-named exports to the Cold Exit biped/mixamo
   conventions before they enter the runtime.
5. Export the active scene as GLB with:
   - export_animations=True (NLA strips merged)
   - export_apply=True (apply armature transforms on meshes)
   - export_format='GLB'
   - export_yup=True (Three.js convention)
   - no embedded sampler animations (single skinned-mesh path)
6. Print a one-line summary (skeleton, mesh, anim count) to stdout.

The script is self-contained — runs under Blender 5.1's bundled Python.
"""

import bpy
import sys
import os
import json
import argparse


def parse_args():
    # Blender passes its own args before --, ours after. Split it out.
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    p = argparse.ArgumentParser(description="FBX → GLB for Cold Exit")
    p.add_argument("--in",  dest="input_fbx",  required=True, help="source .fbx path")
    p.add_argument("--out", dest="output_glb", required=True, help="destination .glb path")
    p.add_argument("--strip-root-motion", action="store_true",
                   help="remove location curves on armature root + hip/pelvis bones from every action")
    p.add_argument("--rename-bones", default=None,
                   help="path to JSON file mapping {old_name: new_name} for bone renaming")
    p.add_argument("--no-leaf-bones", action="store_true", default=True,
                   help="disable Blender's automatic leaf-bone insertion (default true)")
    p.add_argument("--scale", type=float, default=1.0,
                   help="apply scale on import (Mixamo FBX is cm; pass 0.01 for meters)")
    p.add_argument("--no-actions", action="store_true",
                   help="strip all actions before export (mesh + skeleton only). Use for source FBXs whose embedded action is a static rest-pose snapshot that would override the runtime clip pack on bind.")
    p.add_argument("--rest-align", default=None,
                   help="path to a reference GLB whose skeleton's rest WORLD ORIENTATIONS should be copied onto the target. Used after --rename-bones so renamed Mixamo bones inherit UE5/Epic mannequin rest matrices, letting GASP clips bind correctly. Position is preserved from target (proportions stay), only rotation is taken from reference.")
    return p.parse_args(argv)


def wipe_scene():
    """Remove every object + collection from the default scene."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # read_factory_settings(use_empty=True) gives us a clean slate.


def import_fbx(path, scale, no_leaf_bones):
    """Import an FBX and return refs to (armature, meshes, actions).

    Scale handling — Blender's `global_scale` param produces a scaled
    OBJECT but leaves the bone head/tail values + mesh verts at the
    source magnitude (so a 1.8m Mixamo character imports as a 180-unit
    skeleton with object.scale=0.01). On GLB export, the exporter
    bakes whatever-it-can-bake but the result is still a 0.01-scaled
    armature → 1cm character in Three.js.

    To avoid that, we use FBX_SCALE_ALL so the importer applies the
    scale globally INSIDE the operator — vertex positions, bone
    head/tail, animation curves all multiplied uniformly. The
    resulting Blender data is in scene units (meters) and exports
    cleanly to GLB at proper character size.
    """
    # Step 1: import at native FBX scale (no global_scale).
    bpy.ops.import_scene.fbx(
        filepath=path,
        use_anim=True,
        ignore_leaf_bones=no_leaf_bones,
        # automatic_bone_orientation=False keeps the source pack's
        # local axes — important so existing rigCfg's logicalGroups
        # apply to the exported skeleton without re-mapping.
        automatic_bone_orientation=False,
    )
    armature = next((o for o in bpy.context.scene.objects if o.type == 'ARMATURE'), None)
    meshes   = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    actions  = list(bpy.data.actions)
    if not armature:
        return armature, meshes, actions

    # Step 2: if the user requested a non-1.0 scale (e.g. 0.01 for
    # cm→m), apply it to the armature object then bake the transform.
    # transform_apply with the armature as active scales bone
    # head/tail values (armature data) AND propagates to child mesh
    # vertex positions. This is the reliable way to convert cm to m
    # in Blender 5.1 (global_scale at import keeps the data in cm
    # and only scales the object transform).
    if scale != 1.0:
        bpy.context.view_layer.objects.active = armature
        bpy.ops.object.select_all(action='DESELECT')
        armature.select_set(True)
        for m in meshes:
            m.select_set(True)
        armature.scale = (scale, scale, scale)
        for m in meshes:
            m.scale = (scale, scale, scale)
        try:
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        except RuntimeError as e:
            print(f"[blender] transform_apply warning: {e}", file=sys.stderr)

    return armature, meshes, actions


_ROOT_BONE_NAMES = {
    "Hips", "Bip001-Pelvis", "Pelvis", "Bip001", "Root", "mixamorig:Hips",
    "Armature", "RootSocket",
}

def _bare(name):
    if name.startswith("mixamorig:"):
        name = name[len("mixamorig:"):]
    # strip trailing _<digits>
    i = len(name)
    while i > 0 and name[i-1].isdigit():
        i -= 1
    if i < len(name) and i > 0 and name[i-1] == '_':
        name = name[:i-1]
    return name

def _is_root_loc_curve(data_path):
    """Match `location` (object-level) or `pose.bones["BoneName"].location`
    where BoneName is in our root-bone set. Returns True if this curve
    is root translation we want to strip."""
    if data_path == "location":
        return True
    if "].location" not in data_path:
        return False
    try:
        start = data_path.index('"') + 1
        end = data_path.index('"', start)
        bone_name = data_path[start:end]
    except ValueError:
        return False
    return _bare(bone_name) in _ROOT_BONE_NAMES or bone_name in _ROOT_BONE_NAMES

def _iter_curve_collections(action):
    """Yield every fcurve-bearing collection on an action, supporting
    both legacy (action.fcurves) and Blender 5+ slotted actions
    (action.layers[].strips[].channelbag(slot).fcurves)."""
    # Legacy / classic API: action.fcurves directly.
    if hasattr(action, "fcurves"):
        try:
            yield action.fcurves
            return
        except (AttributeError, RuntimeError):
            pass
    # Blender 5.x slotted: drill into layers → strips → channelbag.
    layers = getattr(action, "layers", None)
    slots = getattr(action, "slots", None)
    if not layers or not slots:
        return
    for layer in layers:
        strips = getattr(layer, "strips", None)
        if not strips:
            continue
        for strip in strips:
            for slot in slots:
                # `channelbag(slot)` returns the per-slot bag; check
                # both the function and direct attribute access.
                cb = None
                if hasattr(strip, "channelbag"):
                    try: cb = strip.channelbag(slot)
                    except Exception: cb = None
                if cb is None and hasattr(strip, "channelbags"):
                    cb = next((c for c in strip.channelbags if c.slot_handle == slot.handle), None)
                if cb is not None and hasattr(cb, "fcurves"):
                    yield cb.fcurves

def strip_root_motion(actions, armature):
    """Remove location F-curves on the armature root + hip/pelvis bones
    in every action. Bare-name match (strip 'mixamorig:' + trailing _N).
    Handles both legacy action.fcurves and Blender 5+ slotted actions."""
    removed = 0
    for action in actions:
        for coll in _iter_curve_collections(action):
            to_remove = [fc for fc in coll if _is_root_loc_curve(fc.data_path)]
            for fc in to_remove:
                coll.remove(fc)
                removed += 1
    return removed


def rename_bones(armature, mapping):
    """Apply {old_name: new_name} in-place. Touches the armature's
    edit_bones (must be in EDIT mode) — also patches every action's
    data_path strings so existing curves keep binding after rename."""
    if not armature or not mapping:
        return 0
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='EDIT')
    bones = armature.data.edit_bones
    renamed = 0
    for old, new in mapping.items():
        b = bones.get(old)
        if b and b.name != new:
            b.name = new
            renamed += 1
    bpy.ops.object.mode_set(mode='OBJECT')
    # Patch every action's data_path so curves still bind.
    for action in bpy.data.actions:
        for coll in _iter_curve_collections(action):
            for fcurve in coll:
                for old, new in mapping.items():
                    old_path = f'pose.bones["{old}"]'
                    new_path = f'pose.bones["{new}"]'
                    if old_path in fcurve.data_path:
                        fcurve.data_path = fcurve.data_path.replace(old_path, new_path)
                        break
    return renamed


def rest_align_to_reference(target_armature, ref_glb_path):
    """Re-bind target armature so its rest pose matches a reference
    skeleton's rest WORLD ORIENTATIONS. Used after --rename-bones so
    a Mixamo skeleton (renamed to UE5/GASP names) ends up with each
    bone's local axes pointing the same direction as the UE5 mannequin
    they were renamed to mimic. Without this, GASP clip rotations
    (authored against UE5 rest matrices) produce wildly wrong world
    orientations on the Mixamo skeleton — e.g., a "leg straight" clip
    rotation lands the leg in the air because its rest axis differed.

    Position is preserved from target (proportions stay), only rotation
    is copied from reference. Bones with no name match in reference
    are left alone (acceptable for unmapped finger leaves etc.).

    Process:
      1. Import reference GLB (added to current scene)
      2. Capture {bone_name: rest_world_quaternion} from ref
      3. Switch target to pose mode
      4. For each target pose bone with a ref-name match, set its
         pose-world matrix to (ref orientation, target position)
         in depth order so parent rotations bake before children
      5. Apply pose as rest pose — Blender rebinds skin weights so
         the mesh deformation stays put while the rest matrices change
      6. Delete the imported reference armature + meshes
    Returns the count of aligned bones.
    """
    import mathutils
    if not target_armature:
        print("[rest-align] no target armature; skipping")
        return 0

    pre_objects = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=ref_glb_path)
    new_objects = [o for o in bpy.context.scene.objects if o not in pre_objects]
    ref_armature_obj = next((o for o in new_objects if o.type == 'ARMATURE'), None)
    if not ref_armature_obj:
        print("[rest-align] WARN: no armature in reference; skipping")
        for o in new_objects:
            try: bpy.data.objects.remove(o, do_unlink=True)
            except Exception: pass
        return 0

    # Capture reference bone rest WORLD quaternions. matrix_local is
    # in armature space, so multiply through armature.matrix_world.
    ref_rest = {}
    for b in ref_armature_obj.data.bones:
        m = ref_armature_obj.matrix_world @ b.matrix_local
        ref_rest[b.name] = m.to_quaternion()

    # Capture target's bone rest WORLD quaternions for the local-frame
    # math below.
    target_rest_q = {}
    for b in target_armature.data.bones:
        m = target_armature.matrix_world @ b.matrix_local
        target_rest_q[b.name] = m.to_quaternion()

    # Switch focus to target armature for pose-mode operations.
    bpy.context.view_layer.objects.active = target_armature
    target_armature.select_set(True)
    bpy.ops.object.mode_set(mode='POSE')

    # Order pose bones by hierarchy depth so a parent's pose-world
    # rotation is finalized before children compute their own deltas.
    def depth(bone):
        d = 0
        b = bone.parent
        while b is not None:
            d += 1
            b = b.parent
        return d
    pose_bones_ordered = sorted(target_armature.pose.bones, key=lambda pb: depth(pb.bone))

    # Track each bone's effective POSE-WORLD rotation so children can
    # compute their basis relative to the parent's NEW orientation.
    # An unmapped bone keeps its REST world rotation (no pose change).
    parent_pose_world_q = {}
    aligned = 0
    for pb in pose_bones_ordered:
        ref_q = ref_rest.get(pb.name)
        target_q = target_rest_q[pb.name]
        # Desired world orientation for this bone after my pose. If we
        # have a ref match, take ref's rotation; otherwise leave the
        # bone at its rest orientation.
        desired_world_q = ref_q if ref_q else target_q
        parent = pb.parent
        if parent is None:
            parent_pose_q = mathutils.Quaternion()  # identity
            parent_rest_q = mathutils.Quaternion()
        else:
            parent_pose_q = parent_pose_world_q.get(parent.name, target_rest_q[parent.name])
            parent_rest_q = target_rest_q[parent.name]
        # Bone's REST rotation in its parent's REST frame.
        bone_local_rest = parent_rest_q.inverted() @ target_q
        # Local pose basis = inverse(parent_pose × local_rest) × desired_world.
        # Solving (parent_pose × local_rest × basis) = desired_world.
        bone_local_basis = (parent_pose_q @ bone_local_rest).inverted() @ desired_world_q
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = bone_local_basis
        parent_pose_world_q[pb.name] = desired_world_q
        bpy.context.view_layer.update()
        if ref_q:
            aligned += 1

    # Bake the current pose into the rest pose. Blender re-skins the
    # mesh so it stays in roughly the same world position despite the
    # bone-axis changes.
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Cleanup imported reference geometry.
    for o in new_objects:
        try:
            bpy.data.objects.remove(o, do_unlink=True)
        except Exception:
            pass

    print(f"[rest-align] aligned {aligned} bones to reference")
    return aligned


def export_glb(path, export_animations=True):
    """Export the current scene as GLB. Pass export_animations=False
    to ship a mesh-only / skeleton-only GLB (no actions baked in) —
    used when the source FBX carries a single static "pose" action
    that would override the runtime's clip pack on bind."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_animations=export_animations,
        export_apply=True,
        export_yup=True,
        export_skins=True,
        export_morph=True,
        # NLA tracks: each NLA strip becomes a separate animation in
        # the GLB. With NLA off, all actions on the armature get
        # exported — which is what we want for the pistol pack since
        # each clip is its own action.
        export_nla_strips=True,
    )


def main():
    args = parse_args()
    in_fbx = os.path.abspath(args.input_fbx)
    out_glb = os.path.abspath(args.output_glb)
    if not os.path.isfile(in_fbx):
        print(f"[blender] ERROR: input not found: {in_fbx}", file=sys.stderr)
        sys.exit(2)

    rename_map = None
    if args.rename_bones:
        with open(args.rename_bones, "r", encoding="utf-8") as f:
            rename_map = json.load(f)

    print(f"[blender] FBX → GLB: {in_fbx}")
    wipe_scene()
    armature, meshes, actions = import_fbx(in_fbx, args.scale, args.no_leaf_bones)
    print(f"[blender] imported armature={bool(armature)} meshes={len(meshes)} actions={len(actions)}")

    if rename_map:
        n = rename_bones(armature, rename_map)
        print(f"[blender] renamed {n} bones")

    if args.rest_align:
        rest_align_to_reference(armature, os.path.abspath(args.rest_align))

    if args.strip_root_motion:
        n = strip_root_motion(actions, armature)
        print(f"[blender] stripped {n} root-motion fcurves")

    if args.no_actions:
        # Wipe every action AND every NLA strip on the armature so the
        # exported GLB carries only the rig + bind pose. Used when the
        # source FBX ships a pose-snapshot action that would otherwise
        # bind on load and override the runtime's clip pack — leg-in-
        # air symptom 2026-05-07.
        if armature and armature.animation_data:
            armature.animation_data_clear()
        for a in list(bpy.data.actions):
            try: bpy.data.actions.remove(a, do_unlink=True)
            except Exception: pass
        print(f"[blender] stripped all actions ({len(bpy.data.actions)} remaining)")

    # Diagnostic — print a representative bone's world Y so we can
    # confirm scale baking worked. A 1.8m character should have its
    # head bone at world Y ≈ 1.6.
    if armature:
        try:
            import mathutils
            for bone_name in ['Head', 'mixamorig:Head', 'Bip001-Head', 'head']:
                pb = armature.pose.bones.get(bone_name) or next(
                    (b for b in armature.pose.bones if bone_name in b.name), None)
                if pb:
                    head_world = armature.matrix_world @ pb.head
                    print(f"[blender] {pb.name} world Y = {head_world.y:.3f}")
                    break
        except Exception as e:
            print(f"[blender] bone-Y print skipped: {e}")

    export_glb(out_glb)
    print(f"[blender] WROTE {out_glb}")


if __name__ == "__main__":
    main()
