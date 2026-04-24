"""Rebind a rigged character into a hanging-arms rest pose + export GLB.

Used to normalize animpic / Reallusion-CC character FBXs so that
`rotation = identity` in the resulting skeleton actually means "arms
hanging at the sides" — which is the rest pose our procedural rig
(`src/actor_rig.js`) assumes. Without this, direct retargeting produces
arms in A-pose / T-pose and the proc rig writes compose with the bind
in weird ways.

Usage (headless):
    blender -b -P tools/rebind_hanging.py -- in.fbx out.glb

The script:
  1. Opens a fresh Blender session, imports the FBX.
  2. Finds the armature.
  3. Rotates each arm bone in Pose Mode so its length direction points
     world-down in Blender (+Z-up space). Order: upperarms first,
     then forearms (children inherit parent rotations so measuring
     the forearm's direction after the upperarm moves gives the
     correct delta).
  4. Applies the pose as the new rest pose (freezes the rotations
     into the bind matrices — the key step).
  5. Selects armature + meshes and exports as GLB. glTF handles
     multi-mesh skeletons which three.js's FBXLoader cannot.
"""
import sys
import math
import bpy
from mathutils import Vector, Matrix

# ---------- CLI args ---------------------------------------------------------

argv = sys.argv
if '--' in argv:
    argv = argv[argv.index('--') + 1:]
else:
    argv = []

if len(argv) < 2:
    print('Usage: blender -b -P rebind_hanging.py -- input.fbx output.glb')
    sys.exit(1)

input_fbx  = argv[0]
output_glb = argv[1]

# ---------- bone aliases -----------------------------------------------------

BONE_ALIASES = {
    'leftArm':      ['upperarm_l', 'LeftArm',   'mixamorig:LeftArm',
                     'CC_Base_L_Upperarm', 'L_UpperArm', 'L_Arm'],
    'rightArm':     ['upperarm_r', 'RightArm',  'mixamorig:RightArm',
                     'CC_Base_R_Upperarm', 'R_UpperArm', 'R_Arm'],
    'leftForeArm':  ['lowerarm_l', 'LeftForeArm', 'mixamorig:LeftForeArm',
                     'CC_Base_L_Forearm', 'L_LowerArm', 'L_Forearm'],
    'rightForeArm': ['lowerarm_r', 'RightForeArm', 'mixamorig:RightForeArm',
                     'CC_Base_R_Forearm', 'R_LowerArm', 'R_Forearm'],
}

def find_pose_bone(armature, slot):
    for name in BONE_ALIASES[slot]:
        pb = armature.pose.bones.get(name)
        if pb:
            return pb
    slot_lc = slot.lower()
    # Fuzzy: match by substring, skip twist bones.
    for pb in armature.pose.bones:
        nlc = pb.name.lower()
        if 'twist' in nlc:
            continue
        if slot_lc in nlc:
            return pb
    return None

# ---------- rotation helper --------------------------------------------------

DOWN = Vector((0, 0, -1))   # Blender is Z-up: world-down is -Z

def orient_bone_length_to(pb, armature, world_target):
    """Rotate pose bone so its length axis (local +Y in Blender
    convention) points along `world_target` in world space. Leaves
    the head at its current world position.
    """
    M = armature.matrix_world
    cur_world_mat = M @ pb.matrix
    head_w = cur_world_mat.to_translation()
    # Bone's world +Y axis (length direction in Blender's bone convention)
    y_axis_world = (cur_world_mat.col[1].xyz).normalized()

    delta = world_target - y_axis_world
    if delta.length < 1e-5:
        return  # already aligned

    q_world = y_axis_world.rotation_difference(world_target)

    # Reconstruct target world matrix: keep head, apply rotation on top
    # of the current world orientation.
    cur_world_rot = cur_world_mat.to_quaternion()
    new_world_rot = q_world @ cur_world_rot
    new_world_mat = (
        Matrix.Translation(head_w)
        @ new_world_rot.to_matrix().to_4x4()
    )

    # pb.matrix is expressed in armature-local space.
    pb.matrix = M.inverted() @ new_world_mat
    bpy.context.view_layer.update()

# ---------- pipeline ---------------------------------------------------------

print(f'[rebind] wiping scene')
bpy.ops.wm.read_factory_settings(use_empty=True)

print(f'[rebind] importing {input_fbx}')
bpy.ops.import_scene.fbx(filepath=input_fbx)

armature = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
if not armature:
    print('[rebind] ERROR: no armature in FBX')
    sys.exit(2)
print(f'[rebind] armature: {armature.name} scale={tuple(armature.scale)}')

# Bake the armature's 0.01 scale into the skeleton AND the bound
# meshes so the exported GLB has a 1× armature with real-meter bones
# and a mesh that still skins correctly.
#
# Blender's `transform_apply` normally skips a mesh's vertex data if
# the mesh has an Armature modifier bound to an armature-with-scale
# — to avoid de-binding the skin. We work around this by temporarily
# unbinding each armature modifier (setting its object = None),
# applying the scale (vertices update, inverse-bind matrices get
# rebuilt on re-bind), then re-binding the modifier.
print(f'[rebind] armature pre-scale={tuple(armature.scale)}')

bound_meshes = [o for o in bpy.data.objects
                if o.type == 'MESH' and o.parent == armature]

# Unbind armature modifiers so transform_apply doesn't skip verts.
saved_bindings = []
for m in bound_meshes:
    for mod in m.modifiers:
        if mod.type == 'ARMATURE' and mod.object is not None:
            saved_bindings.append((m, mod, mod.object))
            mod.object = None

# Select armature + all children, apply transforms.
bpy.ops.object.select_all(action='DESELECT')
armature.select_set(True)
for m in bound_meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = armature
if bpy.context.active_object.mode != 'OBJECT':
    bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Re-bind the armature modifiers.
for (m, mod, arm_obj) in saved_bindings:
    mod.object = arm_obj

print(f'[rebind] after apply-transform: armature scale={tuple(armature.scale)}')

# Enumerate meshes for diagnostic context.
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print(f'[rebind] found {len(meshes)} meshes: {[m.name for m in meshes]}')

# The animpic customization kit bundles every clothing / beard / hair
# variant as a separate mesh bound to the same skeleton. We want the
# base body only — the rest stack on top and visually overlap. Filter
# to the mesh whose name matches "man" / "body" / "character" (case-
# insensitive) and the eyes mesh. Anything else gets deleted before
# the pose-as-rest + export so the GLB ships a clean character.
KEEP_KEYWORDS = ('man', 'body', 'character', 'eyes', 'eye')
keep = []
drop = []
for m in meshes:
    nlc = m.name.lower()
    if any(k in nlc for k in KEEP_KEYWORDS):
        keep.append(m)
    else:
        drop.append(m)
print(f'[rebind] keeping: {[m.name for m in keep]}')
print(f'[rebind] dropping: {[m.name for m in drop]}')
for m in drop:
    bpy.data.objects.remove(m, do_unlink=True)
meshes = keep

bpy.context.view_layer.objects.active = armature
bpy.ops.object.mode_set(mode='POSE')

# Order matters: upperarms before forearms so forearm world-direction
# measurement after the upperarm rotation gives the correct delta.
for slot in ('leftArm', 'rightArm', 'leftForeArm', 'rightForeArm'):
    pb = find_pose_bone(armature, slot)
    if not pb:
        print(f'[rebind] WARN: {slot} bone not found')
        continue
    before = (armature.matrix_world @ pb.matrix).col[1].xyz.normalized()
    orient_bone_length_to(pb, armature, DOWN)
    after = (armature.matrix_world @ pb.matrix).col[1].xyz.normalized()
    print(f'[rebind] {slot:12s} ({pb.name:30s})  dir: '
          f'({before.x:+.2f},{before.y:+.2f},{before.z:+.2f}) → '
          f'({after.x:+.2f},{after.y:+.2f},{after.z:+.2f})')

# Apply pose as rest pose — freezes current rotations into the bind.
print('[rebind] applying pose as rest')
bpy.ops.pose.armature_apply(selected=False)

bpy.ops.object.mode_set(mode='OBJECT')

# Select armature + meshes for export.
bpy.ops.object.select_all(action='DESELECT')
armature.select_set(True)
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = armature

print(f'[rebind] exporting {output_glb}')
bpy.ops.export_scene.gltf(
    filepath=output_glb,
    export_format='GLB',
    use_selection=True,
    export_skins=True,
    export_animations=False,
    export_apply=True,              # bake modifiers
)

print('[rebind] done')
