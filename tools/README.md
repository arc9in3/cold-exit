# tools/

Developer utilities that are **not** part of the runtime. These don't ship
with the game — they exist to extract assets, inspect them, and keep the
manifest accurate.

**Index**
- [`unity_to_gltf.py`](#unity_to_gltfpy) — extract .fbx + atlas from POLY packs
- [`weapon_assigner.html`](#weapon_assignerhtml) — tag every weapon FBX,
  render side-view PNGs, drag-place hand pose markers and attachment slots
- [`model_viewer.html`](#model_viewerhtml) — generic per-model annotation grid
- [`_apply_weapon_assignments.py`](#one-shot-scripts) — one-shot: applies a
  tag-export JSON (deletions + renames + new entries) to `tunables.js`
- [`_restat_weapons.py`](#one-shot-scripts) — one-shot: real-world stat
  overrides (caliber → damage, RPM → fireRate, etc.)
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

| pack | output dir | meshes | atlas? |
|------|-----------|-------:|:------:|
| `poly_survivalmeleeweapons.zip`      | `Assets/models/melee/`   | 57  | yes |
| `poly_megaweaponskit.zip`            | `Assets/models/weapons/` | 335 | yes |
| `poly_megasurvivalmedicalkit_V2.zip` | `Assets/models/medical/` | 190 | yes |
| `poly_megasurvivaltools.zip`         | `Assets/models/tools/`   | 219 | yes |
| `style_charactercustomizationkit_V2.zip` | `Assets/models/characters/` | partial | yes |
| `lowpolyguns.zip` (FBX subtree)      | `Assets/models/lowpolyguns/`             | 40 | no — embedded mtl colors |
| `lowpolyguns.zip` (FBX/Accessories)  | `Assets/models/lowpolyguns_accessories/` | 15 | no |

Pack distinction: animpic POLY meshes UV into a shared `_atlas.png`
(palette-style colors). The lowpoly pack instead embeds per-material
diffuse colors in the FBX itself — runtime renderers (and the
`weapon_assigner` tool) detect the missing atlas and preserve those
colors instead of replacing materials.

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

---

## weapon_assigner.html

Purpose-built tool for the weapon polish loop. Two-panel layout:

**Top panel** — every in-game weapon (`tunables.weapons[*]`) with its
inventory icon, class / rarity / damage / RoF / mag, currently
assigned model preview as a side-view orthographic render (16:9, no
spin), and a tag input ("redo as real-world weapon"). Filling a tag
flags the weapon for revisit; the export JSON includes a
`weapons_to_revisit` array.

**Bottom panel** — every weapon FBX in the project. Tag input for
real-world weapon name. Badges for NEW (lowpoly imports) / USED
(manifest-assigned). Filter dropdowns (category / status / regex
search).

**Sentinels:**
- `remove` (or `#remove`) — clears the tag only.
- `delete` (or `#delete`) — clears the tag AND marks the entity for
  removal in the export JSON. Tile turns red with a strike-through
  + `DELETE` badge.

**Newest-wins dedupe** — saving a tag value that another entry
already holds drops the older entries and clears their UI.

**Click a model preview** — opens a fullscreen pose-tuning modal:
- Three drag-to-place markers gated by weapon class:
  - red **M** main hand (trigger wrist),
  - blue **S** support hand (foregrip wrist),
  - yellow **B** shoulder mount (buttstock — the firing-arm shoulder).
  Pistols get M+S only (two-handed grip, no shoulder); knives get M
  only; rifles/SMGs/shotguns/snipers/lmgs get all three.
- Attachment-slot squares overlay for in-game weapons, drawn at
  their `layoutForWeapon` positions. Drag-to-reposition for per-
  weapon overrides; right-click resets.
- Green outline shows the manifest grip-offset for the FBX.
- Right-click any marker / slot resets it. Esc closes.

**Export buttons:**
- **Export tags** — JSON of all FBX + in-game weapon tags, plus
  deletions and revisit list.
- **Export side-view PNGs** — bulk-renders 512×288 PNG of every
  in-game weapon's model into a zip, named by sanitized weapon name.
  Drop into `Assets/UI/weapon_renders/` and add a matching entry to
  `WEAPON_RENDER_BY_NAME` in `src/model_manifest.js`.
- **Export pose JSON** (inside the modal) — dumps per-weapon hand
  + slot positions for one weapon or all weapons.

Persistence is per-localStorage-key:
- `tacticalrogue.weapon_tags` (FBX tags)
- `tacticalrogue.ingame_weapon_tags` (in-game weapon revisit tags)
- `tacticalrogue.fbx_deletions` (delete-flagged FBXes)
- `tacticalrogue.weapon_deletions` (delete-flagged in-game weapons)
- `tacticalrogue.weapon_poses` (per-FBX pose data)

Run via HTTP just like the model viewer:
```
python -m http.server 8000
# open: http://localhost:8000/tools/weapon_assigner.html
```

---

## One-shot scripts

`_apply_weapon_assignments.py` and `_restat_weapons.py` are
imperative, idempotent-ish, single-shot transforms run against
`src/tunables.js` from a `weapon_assignments.json` (the export JSON
the user produces from `weapon_assigner.html`). Re-runnable; finds
already-renamed entries as no-ops.

```
python tools/_apply_weapon_assignments.py   # delete + rename + insert
python tools/_restat_weapons.py             # real-world stat overrides
```

Adjust the `DELETIONS` / `RENAMES` / `NEW_WEAPONS` / `OVERRIDES`
dicts in the script before re-running for a different batch. Both
scripts edit the file in-place; commit the diff before running for
sanity.

---

## Shipping note

Neither `unity_to_gltf.py`, the HTML viewers, nor the one-shot
scripts ship in the itch.io build. Only the extraction *outputs*
(`Assets/models/**/*.fbx` + `_atlas.png` + `Assets/UI/**/*.png`,
including the `weapon_renders/` PNGs) need to be bundled.
