# tools/

Developer utilities that are **not** part of the runtime. These don't ship
with the game — they exist to extract assets, inspect them, and keep the
manifest accurate.

**Index**
- [`unity_to_gltf.py`](#unity_to_gltfpy) — extract .fbx + atlas from POLY packs
- [`retarget_character.md`](retarget_character.md) — Blender recipe to
  rebind character rigs into the hanging-arms pose the proc rig expects,
  then export as `.glb` for `src/character_model.js`

---

## unity_to_gltf.py

Extracts `.fbx` meshes and texture atlases from animpic studio's POLY
packs (https://www.animpic.studio/), which are distributed as
`.zip` → `.unitypackage` (source FBX inside) plus an Unreal `.zip`.
Three.js loads FBX natively via `FBXLoader`; no external conversion step.

Despite the filename, the script emits **`.fbx`** today (the pack's source
assets already are FBX). The name is kept for continuity; a future version
may emit `.glb`.

### Install

Python standard library only. No external deps.

> UnityPy + trimesh is a valid alternative path and would be required for
> packs that ship *compiled* Unity binary assets. These particular packs
> ship raw source FBX inside the unitypackage tar, so direct extraction
> is simpler.

### Commands

List every asset pathname in a pack (no extraction):

```
python tools/unity_to_gltf.py --src Assets/poly_megaweaponskit.zip --list
```

Extract every mesh into a category subfolder:

```
python tools/unity_to_gltf.py --src Assets/poly_megaweaponskit.zip --out Assets/models/weapons
```

Filter by regex (matched against the in-pack pathname):

```
python tools/unity_to_gltf.py --src Assets/poly_survivalmeleeweapons.zip --filter "Knife|Bat|Machete" --out Assets/models/melee
```

Include texture `.png` files (needed once per pack to grab the atlas):

```
python tools/unity_to_gltf.py --src Assets/poly_megasurvivalmedicalkit_V2.zip --out Assets/models/medical --include-textures --filter "MainTexture|Polygon_Texture"
```

After extracting an atlas, rename it to `_atlas.png` in the category
folder — the runtime loader (`src/gltf_cache.js`) resolves atlases by
that fixed name.

### What it does under the hood

1. Opens the outer `.zip` → finds the nested `.unitypackage`.
2. Treats the `.unitypackage` as a gzipped tarball. Each asset lives at
   `<guid>/{asset, pathname, asset.meta, preview.png}`.
3. For every entry whose `pathname` ends in an allowed extension (`.fbx`
   by default, plus `.png` with `--include-textures`) and matches the
   filter regex, writes the `asset` payload to `--out/<safe_name>.<ext>`.

### Hooking a model into the game

1. Run the extractor; drop the `.fbx` under `Assets/models/<category>/`.
2. If this is a new pack, also extract its atlas (`--include-textures`
   --filter "MainTexture|Polygon_Texture"`) and rename to `_atlas.png`.
3. Add one line in `src/model_manifest.js`:
   - `MODEL_BY_WEAPON_NAME[name]` — `name` is the weapon's display name
     in `src/tunables.js` (`weapons[*].name`)
   - `MODEL_BY_ITEM_ID[id]` — for consumables / armor / gear / junk
4. Regenerate the viewer's index (see `model_viewer.html` below) so the
   new files show up in the grid.

No code changes per item. `src/loot.js` shows a primitive placeholder
while the FBX loads, then swaps in the real mesh.

### Current extraction state

Packs extracted into the repo today:

| pack | output dir | meshes |
|------|-----------|-------:|
| `poly_survivalmeleeweapons.zip` | `Assets/models/melee/`   | 57 |
| `poly_megaweaponskit.zip`       | `Assets/models/weapons/` | 335 |
| `poly_megasurvivalmedicalkit_V2.zip` | `Assets/models/medical/` | 190 |
| `poly_megasurvivaltools.zip`    | `Assets/models/tools/`   | 219 |

Each category folder also contains an `_atlas.png` — the shared color
atlas every mesh in that pack samples.

---

## model_viewer.html

Standalone debug grid that renders every extracted `.fbx` in its own
rotating tile, with category filter + regex search. Useful for scouting
models to wire into the manifest.

### Running

Must be served over HTTP (Chrome/Edge block `file://` fetches used by
FBXLoader):

```
python -m http.server 8000
# open: http://localhost:8000/tools/model_viewer.html
```

### How it reads the file list

A classic script tag loads `Assets/models/_index.js`, which assigns
`window.MODEL_INDEX = { category: [filenames…] }`. Classic scripts
(not ES modules) are used specifically so the page also works over
`file://` if you need it.

### Regenerating the index

After extracting new models, regenerate the index file:

```
python -c "
import json, os
from pathlib import Path
root = Path('Assets/models')
out = {c: sorted(f for f in os.listdir(root/c) if f.lower().endswith('.fbx'))
       for c in sorted(os.listdir(root)) if (root/c).is_dir()}
(root / '_index.js').write_text('window.MODEL_INDEX = ' + json.dumps(out, indent=2) + ';\n')
"
```

---

## Shipping note

Neither `unity_to_gltf.py` nor `model_viewer.html` should be included in
the itch.io build. Only the extraction *outputs* (`Assets/models/**/*.fbx`
+ `_atlas.png` + the `.js` / icons under `Assets/UI/`) need to be
bundled.
