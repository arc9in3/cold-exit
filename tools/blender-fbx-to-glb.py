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
    return p.parse_args(argv)


def wipe_scene():
    """Remove every object + collection from the default scene."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # read_factory_settings(use_empty=True) gives us a clean slate.


def import_fbx(path, scale, no_leaf_bones):
    """Import an FBX and return refs to (armature, meshes, actions)."""
    bpy.ops.import_scene.fbx(
        filepath=path,
        use_anim=True,
        ignore_leaf_bones=no_leaf_bones,
        global_scale=scale,
        # automatic_bone_orientation=False keeps the source pack's
        # local axes — important so existing rigCfg's logicalGroups
        # apply to the exported skeleton without re-mapping.
        automatic_bone_orientation=False,
    )
    armature = next((o for o in bpy.context.scene.objects if o.type == 'ARMATURE'), None)
    meshes   = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    actions  = list(bpy.data.actions)
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


def export_glb(path):
    """Export the current scene as GLB."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_animations=True,
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

    if args.strip_root_motion:
        n = strip_root_motion(actions, armature)
        print(f"[blender] stripped {n} root-motion fcurves")

    export_glb(out_glb)
    print(f"[blender] WROTE {out_glb}")


if __name__ == "__main__":
    main()
