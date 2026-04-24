# tacticalrogue

Browser-based isometric extraction shooter. Three.js, plain ES modules, no
build step. Target platform is itch.io.

**Start here:**
- [`DESIGN.md`](./DESIGN.md) — vision, core loop, combat, inventory,
  progression, art direction
- [`BACKLOG.md`](./BACKLOG.md) — what's landed, what's next, known
  rough edges (check this first — it's the freshest state)
- [`tools/README.md`](./tools/README.md) — asset extraction + model viewer

## Current state (prototype-ship push)

The game boots into a main menu → starting-store picker → run loop.
Runs are endless (extraction regenerates the next level) and end on
death, which submits a leaderboard entry and offers Restart Level or
Back to Main Menu. Save/load and restart taint the run so they don't
pollute leaderboard scores. Audio has synth SFX plus an ambient room
tone + footsteps + reverb; the rendering pipeline runs bloom +
vignette + subtle chromatic aberration through an EffectComposer
stack (gated on `qualityFlags.postFx`). The character rig is fully
procedural (cylinders + joint spheres) — no skinned art yet.

See `BACKLOG.md` for the full delta.

## Running locally

There is no build pipeline. Serve the repo root over any static HTTP
server and open `index.html`:

```
python -m http.server 8000
# then: http://localhost:8000/
```

Chrome/Edge require HTTP (they block `fetch`/module imports over
`file://`); Firefox will also work with `file://` if you insist.

No `npm install` is necessary — Three.js and lil-gui are loaded at runtime
from unpkg via an import map (see `index.html`'s `<script type="importmap">`).

## Repo layout

```
tacticalrogue/
├── index.html              # Single-page entry. CSS + importmap + <script src=src/main.js>
├── src/                    # All game code (ES modules)
│   ├── main.js             # Game loop, orchestration, death + restart
│   ├── scene.js            # Three.js scene + lighting + camera (ADS zoom)
│   ├── postfx.js           # EffectComposer pipeline (bloom + vignette + chroma)
│   ├── level.js            # Procedural level generation + door-corridor repair
│   ├── player.js           # Player state + movement (no roll; disabled)
│   ├── gunman.js           # Ranged enemy AI + profiles (standard/dasher/
│   │                       #   runner/coverSeeker/tank/shielded)
│   ├── melee_enemy.js      # Melee enemy AI + shield-bearer variant
│   ├── actor_rig.js        # Shared procedural rig (cylinders + joint spheres)
│   ├── combat.js           # Damage, blood, tracers, flash, flame particles,
│   │                       #   explosions, flame blockers
│   ├── projectiles.js      # Ballistic / rocket / grenade / frag projectiles
│   ├── input.js            # Keyboard/mouse bindings (window-level contextmenu
│   │                       #   + mouseup to prevent stuck state)
│   ├── inventory.js        # Slot inventory, item defs, throwable scaffolding
│   ├── attachments.js      # Weapon attachments (optics, grips, mags, lights)
│   ├── weapon_layouts.js   # SVG silhouettes for the customize UI
│   ├── artifacts.js        # Run-long permanent-buff items
│   ├── classes.js          # Per-weapon-class mastery
│   ├── perks.js            # Gear perk pool + rolling
│   ├── skills.js           # Active abilities
│   ├── skill_tree.js       # Meta-progression tree (requires enforced)
│   ├── tunables.js         # All weapon stats, difficulty, loot tables
│   ├── loot.js             # Ground-loot spawn + pickup
│   ├── hud.js              # On-screen HUD
│   ├── debug.js            # lil-gui overlay (off by default; toggle in
│   │                       #   Settings → Dev Tools Panel)
│   ├── audio.js            # Web Audio SFX + ambient bed + reverb bus
│   ├── leaderboard.js      # RunStats + localStorage top-N leaderboard
│   ├── prefs.js            # Persistent user prefs (dev tools, name,
│   │                       #   starting-store state)
│   ├── ui_main_menu.js     # Landing screen (Play / Store / Leaderboard / Settings)
│   ├── ui_starting_store.js# Chip-funded slot + rarity upgrades + roll picker
│   ├── ui_start.js         # Legacy class picker (fallback path)
│   ├── ui_menu.js          # In-run Esc menu (Resume/Settings/Save/Load/Leaderboard/Quit)
│   ├── ui_*.js             # DOM-driven inventory / details / shop / perks /
│   │                       #   customize / loot / mastery / skills
│   ├── model_manifest.js   # itemId / weaponName → .fbx + grip/rotation overrides
│   └── gltf_cache.js       # Shared FBX/glTF loader + atlas material + fit helper
├── tools/                  # Developer utilities (not shipped with the game)
│   ├── unity_to_gltf.py    # Extracts .fbx + atlas textures from POLY .zip packs
│   ├── model_viewer.html   # Standalone grid of every extracted model
│   └── README.md
└── Assets/                 # Art source. Not all of this ships — see "Shipping" below
    ├── *.zip               # Raw animpic POLY packs (kept local; never bundled)
    ├── UI/                 # Pre-extracted PNG icons (Underlay + Clean + Stroke)
    └── models/             # Extracted .fbx + per-pack _atlas.png (ships)
        ├── _index.js       # window.MODEL_INDEX for the model viewer
        ├── melee/
        ├── weapons/
        ├── medical/
        └── tools/
```

## Runtime dependencies

Loaded from unpkg at page load, pinned in `index.html`'s import map:

| dep | version | use |
|-----|---------|-----|
| three | 0.161.0 | rendering, loaders (GLTFLoader, FBXLoader) |
| lil-gui | 0.19.2 | debug/tuning overlay |

No bundler, no transpilation. Source is ES2022 + native modules.

## Asset pipeline

Art comes from animpic studio's POLY packs
(https://www.animpic.studio/) — each pack is a `.zip` wrapping a
`.unitypackage` (source FBX + shared texture atlas) and an Unreal
`.zip`. See `tools/README.md` for the extractor and workflow.

Shipping boundary:
- `Assets/*.zip` — never ship (licensed source packs, large)
- `Assets/UI/` — ship only the icons actually referenced by
  `src/inventory.js`
- `Assets/models/<cat>/*.fbx` + `_atlas.png` — ships

## Shipping to itch.io

Target is a zipped static site. Minimal shipping set:

```
index.html
src/**/*.js
Assets/UI/Military/*.png   # icons referenced by inventory.js
Assets/UI/Icons/*.png      # fallback icons
Assets/models/**/*.fbx     # only models referenced by model_manifest.js
Assets/models/**/_atlas.png
```

A production pass should prune unused FBX / icons before bundling — the
extracted `Assets/models/` currently holds 800+ models, of which the
manifest uses ~30.

## Development conventions

- **No build step.** Edit a `.js` under `src/` and reload the page.
- **ES modules everywhere.** Imports use the bare specifier `three`
  resolved through the import map. No relative node-style `..`
  traversal across `src/` boundaries.
- **Tuning vs. logic.** Numbers go in `src/tunables.js` or
  per-item-def tables; logic files read from there. If you're
  adjusting a stat, you almost certainly should not be editing a
  system file.
- **Primitive first, art later.** New items can ship with a tint
  and no model — `loot.js` falls back to a tinted box. Wire the
  `.fbx` through `model_manifest.js` when ready.
- **No tests.** Iteration is visual and playtest-driven. The only
  automated check is `node --check src/*.js` for syntax.

## Credits

- 3D art + icons: animpic studio (POLY series) — https://www.animpic.studio/
- Runtime: Three.js (MIT), lil-gui (MIT)
