"""
Cold Exit one-handed pistol clip generator.

Reads a GASP-style _FixedPistol FBX (or GLB) clip and rewrites the
off-hand arm bone tracks (the LEFT side, since char's right hand
holds the gun under the project's default handedness) so the off
arm swings naturally at the player's side instead of gripping the
gun.

For each clip:
  1. Load the source FBX/GLB.
  2. Strip the existing keyframe tracks for clavicle_l + upperarm_l +
     lowerarm_l + hand_l (and finger bones under hand_l).
  3. Author a procedural natural-swing pose:
     - clavicle_l   : bind pose (no rotation)
     - upperarm_l   : rotate ~−85° around local Z so arm hangs down
                       + a small sinusoidal forward/back sway synced
                       to clip duration (opposite phase of leg stride)
     - lowerarm_l   : small periodic bend (~10° amplitude)
     - hand_l       : bind pose
     - finger bones : bind pose (relaxed, slightly curled)
  4. Export as <name>_OneHand_Pistol.glb.

Usage:
  blender --background --python tools/blender-onehand-pistol.py -- \
      --in  "Assets/models/animations/gaspfix_extracted/GaspFix/_FixedPistol/Walk/M_Neutral_Walk_Loop_F_Pistol.FBX" \
      --out "Assets/models/animations/gasp_glb/M_Neutral_Walk_Loop_F_OneHand_Pistol.glb"

Strips root motion + applies scale 0.01 (matches the existing
convert-gaspfix-essentials pipeline).
"""

import bpy
import sys
import os
import math
import argparse


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    p = argparse.ArgumentParser()
    p.add_argument("--in",  dest="input",  required=True)
    p.add_argument("--out", dest="output", required=True)
    p.add_argument("--scale", type=float, default=0.01)
    p.add_argument("--off-side", default="l", choices=["l", "r"],
                   help="which side is the off-hand (default 'l' = char's left)")
    p.add_argument("--swing-amplitude", type=float, default=0.20,
                   help="forward/back swing radius in radians (default 0.20 ≈ 11°)")
    return p.parse_args(argv)


def wipe_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_source(path, scale):
    """Import FBX or GLB."""
    if path.lower().endswith(".fbx"):
        bpy.ops.import_scene.fbx(
            filepath=path,
            use_anim=True,
            ignore_leaf_bones=True,
            automatic_bone_orientation=False,
        )
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    armature = next((o for o in bpy.context.scene.objects if o.type == 'ARMATURE'), None)
    meshes   = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    actions  = list(bpy.data.actions)
    if scale != 1.0 and armature:
        bpy.context.view_layer.objects.active = armature
        bpy.ops.object.select_all(action='DESELECT')
        armature.select_set(True)
        for m in meshes: m.select_set(True)
        armature.scale = (scale, scale, scale)
        for m in meshes: m.scale = (scale, scale, scale)
        try:
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        except RuntimeError as e:
            print(f"[blender] transform_apply warning: {e}", file=sys.stderr)
    return armature, meshes, actions


# Reuse the strip helpers from blender-fbx-to-glb.py — mirrored here
# so this script is self-contained.
def _iter_curve_collections(action):
    if hasattr(action, "fcurves"):
        try:
            yield action.fcurves
            return
        except (AttributeError, RuntimeError):
            pass
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
                cb = None
                if hasattr(strip, "channelbag"):
                    try: cb = strip.channelbag(slot)
                    except Exception: cb = None
                if cb is None and hasattr(strip, "channelbags"):
                    cb = next((c for c in strip.channelbags if c.slot_handle == slot.handle), None)
                if cb is not None and hasattr(cb, "fcurves"):
                    yield cb.fcurves


def strip_root_motion(actions):
    """Drop ALL position + scale tracks (rotation only)."""
    for action in actions:
        for coll in _iter_curve_collections(action):
            to_remove = [fc for fc in coll
                         if any(fc.data_path.endswith(suffix)
                                for suffix in ('.position', '.scale'))
                         or fc.data_path in ('location', 'scale')]
            for fc in to_remove:
                coll.remove(fc)


def _bone_name_match(data_path, bone_name):
    return f'pose.bones["{bone_name}"]' in data_path


def strip_off_hand_tracks(actions, off_side):
    """Remove rotation + position tracks for the off-hand chain so we
    can rewrite them procedurally below."""
    chain = [
        f'clavicle_{off_side}',
        f'upperarm_{off_side}',
        f'upperarm_twist_01_{off_side}',
        f'upperarm_twist_02_{off_side}',
        f'lowerarm_{off_side}',
        f'lowerarm_twist_01_{off_side}',
        f'lowerarm_twist_02_{off_side}',
        f'hand_{off_side}',
        f'index_metacarpal_{off_side}', f'index_01_{off_side}', f'index_02_{off_side}',
        f'middle_metacarpal_{off_side}', f'middle_01_{off_side}', f'middle_02_{off_side}',
        f'pinky_metacarpal_{off_side}', f'pinky_01_{off_side}', f'pinky_02_{off_side}',
        f'ring_metacarpal_{off_side}', f'ring_01_{off_side}', f'ring_02_{off_side}',
        f'thumb_01_{off_side}', f'thumb_02_{off_side}',
    ]
    removed = 0
    for action in actions:
        for coll in _iter_curve_collections(action):
            to_remove = [fc for fc in coll
                         if any(_bone_name_match(fc.data_path, b) for b in chain)]
            for fc in to_remove:
                coll.remove(fc)
                removed += 1
    return removed


def author_swing_pose(armature, action, off_side, amplitude):
    """Add procedural natural-swing keyframes to the off-hand chain.

    upperarm_<side>: rotate down (-Z by ~85°) at bind, plus sinusoidal
        sway around local X (forward/back), period = clip duration.
    lowerarm_<side>: small periodic bend around local X.
    hand + fingers: bind (no keyframes).

    Keyframe count: 2 keyframes (start + end of clip) for the static
    parts, 5 keyframes across the clip for the sinusoidal parts.
    """
    if not armature or not action:
        return
    duration = action.frame_range[1] - action.frame_range[0]
    if duration < 1: return
    start = action.frame_range[0]
    end = action.frame_range[1]
    # 5 keyframes spanning the clip for the sinusoidal sway.
    sample_count = 5
    samples = [start + (duration * i / (sample_count - 1)) for i in range(sample_count)]

    upperarm = f'upperarm_{off_side}'
    lowerarm = f'lowerarm_{off_side}'

    # Set armature to pose mode + iterate through samples.
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')

    pb_upper = armature.pose.bones.get(upperarm)
    pb_lower = armature.pose.bones.get(lowerarm)
    if not pb_upper or not pb_lower:
        bpy.ops.object.mode_set(mode='OBJECT')
        print(f"[onehand] WARNING: bones not found ({upperarm} / {lowerarm})", file=sys.stderr)
        return

    # Static down-rotation on upperarm: rotate around local Z so arm
    # hangs down. UEFN biped convention has local +X along the bone
    # toward the elbow, so rotating around local Z swings the arm in
    # the body's plane. For the LEFT arm (the off-hand here), -85°
    # around Z hangs the arm at the side.
    sign = -1.0 if off_side == 'l' else 1.0
    base_z_rot = sign * math.radians(85)

    for i, frame in enumerate(samples):
        phase = (i / (sample_count - 1)) * 2 * math.pi
        sway = math.sin(phase) * amplitude
        # Upper arm: down (Z) + sinusoidal forward/back (X)
        pb_upper.rotation_mode = 'XYZ'
        pb_upper.rotation_euler = (sway, 0, base_z_rot)
        pb_upper.keyframe_insert(data_path='rotation_euler', frame=frame)
        # Lower arm: 10° baseline bend + half-amplitude sway
        pb_lower.rotation_mode = 'XYZ'
        pb_lower.rotation_euler = (sway * 0.5 + math.radians(10), 0, 0)
        pb_lower.keyframe_insert(data_path='rotation_euler', frame=frame)

    bpy.ops.object.mode_set(mode='OBJECT')


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_animations=True,
        export_apply=True,
        export_yup=True,
        export_skins=True,
        export_morph=True,
        export_nla_strips=True,
    )


def main():
    args = parse_args()
    in_path = os.path.abspath(args.input)
    out_path = os.path.abspath(args.output)
    if not os.path.isfile(in_path):
        print(f"[onehand] ERROR: input not found: {in_path}", file=sys.stderr)
        sys.exit(2)
    print(f"[onehand] {in_path} → {out_path}  off_side={args.off_side}")
    wipe_scene()
    armature, meshes, actions = import_source(in_path, args.scale)
    print(f"[onehand] imported armature={bool(armature)} meshes={len(meshes)} actions={len(actions)}")
    strip_root_motion(actions)
    print(f"[onehand] root motion stripped")
    n = strip_off_hand_tracks(actions, args.off_side)
    print(f"[onehand] removed {n} off-hand fcurves")
    for action in actions:
        author_swing_pose(armature, action, args.off_side, args.swing_amplitude)
    print(f"[onehand] authored swing pose on {len(actions)} action(s)")
    export_glb(out_path)
    print(f"[onehand] WROTE {out_path}")


if __name__ == "__main__":
    main()
