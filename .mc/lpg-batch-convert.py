"""Batch-convert the low_poly_guns_fbx pack to GLBs with the recolored
palette baked in. Run via Blender 5.1:

    blender --background --python .mc/lpg-batch-convert.py -- \
        <src_dir> <out_dir> <palette_png>

For each FBX in <src_dir> (recursive, skipping the all_guns / desert_map
extras):
  1. Wipe scene
  2. Import the FBX (no animations)
  3. For every material: wire an Image Texture node pointing at the
     recolored uv_palette.png into the Principled BSDF's Base Color
  4. Export as GLB to <out_dir>/<basename>.glb (texture embedded)
"""
import bpy
import sys
import os


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    if len(argv) < 3:
        print("usage: lpg-batch-convert.py -- <src> <out> <palette>", file=sys.stderr)
        sys.exit(2)
    return argv[0], argv[1], argv[2]


SKIP_FILES = {'all_guns.fbx', 'desert_map.fbx'}


def find_fbxes(src):
    out = []
    for root, _, files in os.walk(src):
        for f in files:
            if f.lower().endswith('.fbx') and f not in SKIP_FILES:
                out.append(os.path.join(root, f))
    return sorted(out)


def wire_palette_into_materials(palette_image):
    for mat in bpy.data.materials:
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        for n in list(nodes):
            nodes.remove(n)
        out = nodes.new('ShaderNodeOutputMaterial')
        out.location = (300, 0)
        bsdf = nodes.new('ShaderNodeBsdfPrincipled')
        bsdf.location = (0, 0)
        bsdf.inputs['Roughness'].default_value = 0.75
        bsdf.inputs['Metallic'].default_value = 0.05
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = palette_image
        tex.interpolation = 'Closest'  # palette swatches — no bleeding
        tex.location = (-300, 0)
        links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])


def convert_one(fbx_path, out_dir, palette_image):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # Re-link the palette image (read_factory_settings wipes it).
    palette_image = bpy.data.images.load(palette_image_path, check_existing=True)
    bpy.ops.import_scene.fbx(
        filepath=fbx_path,
        use_anim=False,
        ignore_leaf_bones=True,
        automatic_bone_orientation=False,
    )
    wire_palette_into_materials(palette_image)
    base = os.path.splitext(os.path.basename(fbx_path))[0]
    out_path = os.path.join(out_dir, base + '.glb')
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        export_animations=False,
        export_apply=True,
        export_yup=True,
        export_skins=False,
        export_morph=False,
    )
    print(f'  -> {out_path}')


# globals accessed by convert_one; set in main
palette_image_path = None


def main():
    global palette_image_path
    src, out, palette = parse_args()
    palette_image_path = os.path.abspath(palette)
    fbxes = find_fbxes(os.path.abspath(src))
    print(f'[lpg] {len(fbxes)} FBXes; palette={palette_image_path}')
    for i, fbx in enumerate(fbxes, 1):
        print(f'[lpg] ({i}/{len(fbxes)}) {fbx}')
        convert_one(fbx, os.path.abspath(out), None)
    print(f'[lpg] done')


if __name__ == '__main__':
    main()
