# Cold Exit

> Extract. Survive. Disappear.

Browser-based isometric extraction shooter. Three.js, plain ES modules, no
build step. Deployed to Cloudflare Pages; ships to itch.io.

**Start here:**
- [`DESIGN.md`](./DESIGN.md) — vision, core loop, combat, inventory,
  progression, art direction
- [`BACKLOG.md`](./BACKLOG.md) — what's landed, what's next, known
  rough edges (check this first — it's the freshest state)
- [`tools/README.md`](./tools/README.md) — asset extraction + model viewer

## Current state

Boots into a Cold-Exit splash-art main menu → starting-store picker →
run loop. Runs are endless (extraction regenerates the next level) and
end on death, which submits a leaderboard entry and offers Restart
Level or Back to Main Menu. Save/load and restart taint the run so
they don't pollute leaderboard scores.

**Weapons — 53 total, real-world identities.** Pistols (Makarov,
Glock 17, M1911, Desert Eagle .50, Colt Anaconda .44, Colt Python /
357 / Six Shooter, .38 Special, Jessica's Rage), SMGs (PDW, P90,
UMP45, Spectre / Spectre CQB, SPC9), rifles (M16, AK47, AKS-74, AK104,
AS VAL, VSS, AUG A3-CQC, CAR-15, JARD J67), snipers (Remington 700,
SVD Dragunov, Cheytac Intervention, AWP, .338 Lapua, Hunting Rifle),
shotguns (AA-12, Benelli M4, Mossberg 500, Remington 870, Sawed-Off,
KSG-12, Dragonbreath), LMGs (Type 80 LMG, M249), the Widowmaker
Rocket Launcher, and 12 melee weapons. Each has a side-view PNG
render in `Assets/UI/weapon_renders/` driving both the inventory icon
AND the attachment-screen art — same silhouette in both places. Stats
derive from real-world specs: caliber → damage, cyclic RPM →
fireRate, barrel length → range/spread, factory mag/reload values.

**Attachments — 50 across 8 slots, type-rooted.** Suppressors carry
`noiseRangeMult` (legendary Osprey drops noise to 20% of baseline);
muzzle brakes / compensators / flash hiders own spread + recoil
control; lasers cut hipfire bloom; lights blind/dazzle enemies with
rarity scaling BOTH duration AND magnitude (`blindSpreadMul` /
`dazzleSpreadMul`); barrels trade range vs RoF vs accuracy; sights
drive ADS frustum push-in (1.05× iron → 1.30× long scope) and drag
distance (`adsPeekBonus`). Rarity rolls amplify benefits and *soften*
tradeoffs — a legendary suppressor has LESS damage penalty than a
common one.

Visual layer: Cold-Exit palette tokens (`--ce-ice`, `--ce-navy`, etc.)
applied across menus / settings / form rows; splash-art main menu
backed by `Assets/coldexitmain.png`; HUD-frame corner brackets on modal
cards; tech-mono + display-sans font stacks. In-game lighting is
driven by live tunables (hemisphere, directional key / fill / rim, fog
exp2, player aura) with an F3 console export so dialed values can be
pasted straight into `tunables.js`. Equipment thumbnails (pants /
chest rigs / gloves / boots / backpack) and junk thumbnails are
procedural three.js scenes built from capsules + tapered cylinders +
spheres + tori — no boxy stand-ins.

Performance: bullet tracers, muzzle flashes, ground-loot cubes,
particles, and explosion lights are all pool-backed — zero per-spawn
allocations during combat. Wall occlusion uses a 7-ray camera-to-player
fan plus a 4-ray fan per active enemy. Two profile traces processed in
this session: `gunman.hittables()` mesh arrays cached per-spawn (was
allocating Set objects every frame); LOS raycasts throttled to 20Hz;
shader-error checking disabled after warmup; static obstacles freeze
their world matrices. AI LOD scheduler tunes update cadence in late-
game waves. Worker leaderboard is live.

Audio: synth SFX plus an ambient room tone + footsteps + reverb bus.
Rendering: Kawase bloom + vignette + subtle chromatic through an
EffectComposer stack, gated on `qualityFlags.postFx`. Character rig
is fully procedural (cylinders + joint spheres) — skinned-FBX path
remains parked behind `window.__skinnedRig`; profile evidence
confirms the primitive rig wins for swarm AI counts.

See `BACKLOG.md` for the full delta.

## Deploying

Cloudflare Pages, git-connected to `github.com/arc9in3/cold-exit`.
A push to `main` triggers an auto-build + deploy — watch progress
in **Workers & Pages → cold-exit → Deployments**. The Assets folder
has some huge source-archive zips that are **ignored from git AND
from Pages uploads** (see `.gitignore` and `.assetsignore`); the
extracted runtime files ship fine.

```sh
git add .
git commit -m "..."
git push                           # auto-deploys to cold-exit.pages.dev
```

Manual deploy still works as an override (e.g. for a dirty tree):

```sh
npx wrangler pages deploy . --project-name=cold-exit --commit-dirty=true
```

Lives at `cold-exit.pages.dev`. Custom domain planned.

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
│   ├── model_manifest.js   # weaponName/itemId → .fbx, side-view PNG renders,
│   │                       #   per-class hand-pose defaults, grip/rotation overrides
│   ├── item_thumbnails.js  # Procedural item thumbnail builders (capsules + tapered
│   │                       #   cylinders + spheres for pants/chest/gloves/junk)
│   └── gltf_cache.js       # Shared FBX/glTF loader + atlas material + fit helper
├── tools/                       # Developer utilities (not shipped with the game)
│   ├── unity_to_gltf.py         # Extracts .fbx + atlas textures from POLY .zip packs
│   ├── model_viewer.html        # Standalone grid of every extracted model
│   ├── weapon_assigner.html     # Per-weapon: tag FBXes, render side-view PNGs,
│   │                            #   open fullscreen pose modal w/ hand markers
│   ├── _apply_weapon_assignments.py  # One-shot: applies a tag-export JSON
│   │                                 #   (deletions / renames / additions)
│   ├── _restat_weapons.py       # One-shot: real-world stat overrides
│   └── README.md
├── Assets/
│   ├── *.zip                    # Raw animpic POLY packs (gitignored; never bundled)
│   ├── UI/
│   │   ├── Military/            # Pre-extracted PNG icons (curated stock fallback)
│   │   ├── Icons/               # Generic UI icons
│   │   └── weapon_renders/      # Per-weapon side-view PNG (53 entries) — ships
│   └── models/                  # Extracted .fbx + per-pack _atlas.png (ships)
│       ├── _index.js            # window.MODEL_INDEX for the viewers
│       ├── weapons/             # animpic POLY weapons pack
│       ├── melee/               # animpic POLY melee pack
│       ├── medical/             # animpic POLY medical kit
│       ├── tools/               # animpic POLY tools
│       ├── characters/          # animpic POLY characters
│       ├── lowpolyguns/         # 40 weapon FBXes (no atlas; uses authored colors)
│       └── lowpolyguns_accessories/  # 15 accessory FBXes (scopes, silencers, etc.)
└── profiling/                   # Chrome DevTools traces (gitignored; *.json / *.json.gz)
```

## Runtime dependencies

Loaded from unpkg at page load, pinned in `index.html`'s import map:

| dep | version | use |
|-----|---------|-----|
| three | 0.161.0 | rendering, loaders (GLTFLoader, FBXLoader) |
| lil-gui | 0.19.2 | debug/tuning overlay |

No bundler, no transpilation. Source is ES2022 + native modules.

## Asset pipeline

Two source families:
1. **animpic studio POLY packs** (https://www.animpic.studio/) — each
   pack is a `.zip` wrapping a `.unitypackage` (source FBX + shared
   texture atlas) and an Unreal `.zip`. See `tools/README.md` for the
   extractor.
2. **lowpolyguns pack** — drop-in `.zip` of FBX weapons + accessories
   with embedded per-material diffuse colors (no shared atlas). The
   weapon_assigner tool's renderer detects the absence of an
   `_atlas.png` and preserves the authored material colors.

**Side-view PNG renders.** `tools/weapon_assigner.html` exports a zip
of 512×288 side-view renders for every in-game weapon's model.
Filenames are sanitized weapon names (`Mossberg 500` →
`Mossberg_500.png`); drop into `Assets/UI/weapon_renders/` and add a
matching entry to `WEAPON_RENDER_BY_NAME` in `model_manifest.js`. The
runtime resolver hits this lookup first, so the same silhouette renders
in the inventory cell AND the attachment customize screen.

Shipping boundary:
- `Assets/*.zip` — never ship (licensed source packs, large)
- `Assets/UI/Military/`, `Assets/UI/Icons/` — ship only the icons
  referenced by `src/inventory.js`
- `Assets/UI/weapon_renders/*.png` — ships (drives weapon icons)
- `Assets/models/<cat>/*.fbx` + `_atlas.png` — ships

## Shipping to itch.io

Target is a zipped static site. Minimal shipping set:

```
index.html
src/**/*.js
Assets/UI/Military/*.png       # curated stock icons (fallback)
Assets/UI/Icons/*.png          # generic UI icons
Assets/UI/weapon_renders/*.png # 53 per-weapon side-view renders
Assets/models/**/*.fbx         # only models referenced by model_manifest.js
Assets/models/**/_atlas.png    # animpic POLY shared atlases
```

A production pass should prune unused FBX / icons before bundling — the
extracted `Assets/models/` currently holds 800+ models, of which the
manifest uses ~120 (53 weapons + 50 attachments + ~15
consumables/throwables).

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
