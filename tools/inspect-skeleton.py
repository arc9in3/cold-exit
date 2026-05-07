"""
One-shot diagnostic — print the bone hierarchy of a GLB so we can
build a rename map. Usage:

    blender --background --python tools/inspect-skeleton.py -- \
        --in "Assets/models/animations/gasp_glb/SKM_UEFN_Mannequin.glb"

Prints:
  - Each bone name + parent + world position (for orientation hints)
  - Any actions stored on the file (by name)
"""
import bpy
import sys
import argparse


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="input_glb", required=True)
    return p.parse_args(argv)


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.input_glb)
    armatures = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    if not armatures:
        print("[inspect] no armature found")
        return
    arm = armatures[0]
    print(f"[inspect] armature: {arm.name} bones={len(arm.data.bones)}")
    # Stable order — root first, then children depth-first
    roots = [b for b in arm.data.bones if b.parent is None]

    def walk(bone, depth):
        head = bone.head_local
        tail = bone.tail_local
        print(f"  {'  ' * depth}{bone.name}  head=({head.x:+.3f},{head.y:+.3f},{head.z:+.3f})")
        for c in bone.children:
            walk(c, depth + 1)

    for r in roots:
        walk(r, 0)
    print(f"[inspect] actions: {len(bpy.data.actions)}")
    for a in bpy.data.actions:
        try:
            curves = list(a.fcurves) if a.fcurves else []
            print(f"  {a.name}  fcurves={len(curves)}")
            for fc in curves[:30]:
                kp = list(fc.keyframe_points)
                rng = ''
                if kp:
                    vals = [k.co[1] for k in kp]
                    rng = f" range=[{min(vals):+.3f}..{max(vals):+.3f}]"
                print(f"    {fc.data_path}[{fc.array_index}]  keys={len(kp)}{rng}")
        except Exception as e:
            print(f"  {a.name}  (could not read fcurves: {e})")


if __name__ == '__main__':
    main()
