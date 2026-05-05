# Level-gen overhaul — design doc (2026-05-05)

Locked design for the prop+layout+exit overhaul of cold-exit's level
generator. Wall-gen is preserved as-is — verified working in user
playtests (no orphaned rooms, no unreachable enemies). Branch:
`level-gen-overhaul`. Baseline tag: `baseline-wall-gen-2026-05-05`.

## Probe findings (Phase A)

Captured top-down schematics at level 1 and level 6 via playwright +
synthetic canvas (`__level` exposed in `Level` constructor as a
dev-time hook).

| Pathology | Evidence | Severity |
|---|---|---|
| Theme assignment is sparse — most rooms render as `open` with only 4 corner lamps | Level 6: 5 of 11 rooms have `layout: 'open'` and no theme branch fired | high |
| Prop density per themed room is low (1–3 props) | `library` places 1–2 bookshelves; `bedroom` places bed + maybe 1 nightstand | high |
| Exit is a green ring on the floor of the boss room — not a "room" | `revealExit()` adds `RingGeometry + CylinderGeometry` at boss center; no perimeter, no door, no extraction prop | high |
| Decoration-only props (lamps, etc.) have no `userData.kind` set | Probe found `decoKinds: []` — every decoration is anonymous | medium |
| Obstacle proxies have no `userData.kind` either | Probe found `obsKinds: []` | medium |
| Single-doorway-per-neighbor — no variety in approach | `_buildDoor` runs once per neighbor pair; no wide-opening or double-door variant | medium |
| No destructible walls / secret doors | not in the codebase | feature gap |
| Mid-room "arch" rooms feel empty even when themed | `kitchen` theme places table + 2–4 chairs, but no rug, no overhead lamp pendant, no plates/glasses on table | low-medium |

## Goals (Pass 1 — this overhaul)

1. **Theme coverage ≥ 80% of combat rooms.** Empty `open` rooms become rare.
2. **Prop density ≥ 4 substantive props per themed room.** Plus chairs/adjacency.
3. **Proper extraction room** — replaces the ring-in-boss-room with a final exfil chamber: evac van OR helo LZ OR teleporter pad, with door.
4. **Layout variety** — at least 6 layouts on a typical 8–12 room level.
5. **Semantic placement guarantees** — bookshelves AGAINST walls; chests in CORNERS or center-of-room (gamified); tables with chairs around them; couches facing TVs / fireplaces; beds with nightstands.
6. **`userData.kind` stamped** on every prop proxy AND decoration so the probe / AI / stealth code can read them.
7. **Pathway invariant** — flood-fill from spawn must reach every door + every encounter spawn + the exit room. Smoke harness asserts this on N=20 generated levels per tier.

## Goals (Pass 1B — added 2026-05-05 after probe + user feedback "stop fighting in boxes")

The shape system. Rooms stop being uniform 18×18 rectangles. Cell-graph
topology and doorway invariants stay; what changes is the per-room
geometry within its cell.

8. **Non-rectangular shapes** — pick from a shape table at room build time:
   - `rect` — current 18×18 (default for backward compat)
   - `lShape` — two 12×18 rectangles joined at an inside corner; native blind angles
   - `tJunction` — three corridor stubs meeting at a hub
   - `cross` — 4 corridor stubs around a central plaza
   - `gallery` — 36×8 long hall (occupies 2 cells along one axis)
   - `rotunda` — octagonal ~16m diameter, walls run between 8 chamfered corners
   - `multiTier` — split-level: lower 12×18 area + upper 6×18 platform with railing + ramp at one end (a 1m height jump)
   - `courtyard` — one wall removed in favor of an exterior fence/parapet line; props feel "outside" (planters, forklifts, dumpsters)
   - `catwalk` — main floor with a 1m-high catwalk along 2 sides reachable by stairs; AI sees the catwalk as a separate cell
   - `plaza` — fully open with internal "prop island" clusters instead of perimeter cover

9. **Connector micro-rooms** — small interstitials between adjacent normal rooms:
   - `bridge` — 6×3 walkway with railings over a void
   - `alley` — narrow 4×8 industrial passage (chain-link / corrugated)
   - `tunnel` — low-ceiling 3×6 pipe segment
   - Inserted with low probability (15-25%) on a chain edge, replacing the doorway with a connector room

10. **Vertical primitives** — small new geometry helpers:
    - `addRamp(x1, z1, x2, z2, height)` — sloped collision ramp
    - `addRailing(x1, z1, x2, z2, side)` — chest-height rail (cover-shootable but not walkable through)
    - `addPlatform(bbox, height)` — raised flat surface
    - Shape templates use these primitives; AI walking & projectile collision treat raised areas as walkable above their height threshold

11. **Shape selection** — bias by room.type:
    - `start`: always `rect` (predictable spawn)
    - `combat`: weighted across rect(0.30), lShape(0.15), tJunction(0.10), cross(0.05), gallery(0.10), rotunda(0.05), multiTier(0.10), courtyard(0.10), plaza(0.05)
    - `subBoss`: weighted toward rotunda(0.30), multiTier(0.20), gallery(0.15), plaza(0.20), lShape(0.15)
    - `boss`: rotunda(0.40), plaza(0.30), multiTier(0.20), courtyard(0.10)
    - `shop`: rect(0.50), rotunda(0.30), lShape(0.20)
    - `extraction` (new): always its own template (helo-pad / evac-van / etc.)

12. **Catwalks unlock stealth approach options** — partial Pass 2 stealth-scoring foreshadowed: a catwalk entry has stealth bonus vs a ground entry to the same room.

## Goals (Pass 1C — outdoor + traversal, added 2026-05-05 after user feedback)

User reaction to the outdoor courtyard shape: "Being outside a building
and shooting through windows is a cool concept. Window ledges to get
around obstacles or enemies, walking from one building to another on
a crane or sky bridge etc."

This pass treats levels not as continuous rooms but as a building (or
buildings) with **interior + exterior** sides, where:

13. **Buildings are masses with windows.** A "room" is no longer always
    a closed cell — some cells are *outside* a building's exterior wall.
    Players can engage targets through windows; defenders inside can
    shoot out. The wall has window cutouts that bullets pass through but
    bodies don't.

14. **Window glass as breakable cover.** A window is full-height visual
    cover that:
    - Stops bullets initially (1-2 hits HP)
    - Shatters on damage, becomes a permanent open passage
    - Spawns glass-shard sound + small light VFX
    - Once broken, a player can vault through it (if low) or shoot
      cleanly (if high) — same hole.

15. **Window ledges as traversal.** Wide window sills along an exterior
    wall function as a narrow walkway:
    - Player can mantle up to the ledge
    - Walk along the ledge to bypass a corner / go around an enemy
    - Drop off either side (back inside / down to next building roof)
    - LOS while on the ledge is "exposed" — stealth penalty + AI
      easy detection

16. **Skybridges between buildings.** Some levels generate as 2-3
    discrete buildings connected by skybridges:
    - A skybridge is a 4×12 (or larger) walkway connecting two
      buildings at upper levels
    - Optionally enclosed (glass tunnel) or open (catwalk with
      railings) — the open variant exposes the player to outside
      sniper fire from a 3rd building
    - Crossing a skybridge is a deliberate decision: risk vs detour

17. **Cranes / industrial walkways.** Same concept as skybridges but
    themed: a crane arm becomes a narrow plank walkway over an
    industrial yard; collapsed scaffolding bridges two warehouse
    rooftops; a fallen pipe spans an alley.

18. **Multi-building level topology.** The cell graph still drives
    chain layout, but cells are now optionally tagged as belonging
    to "building A", "building B" etc. Adjacent cells in different
    buildings get a connector — skybridge, sewer tunnel, alley, fire
    escape. Cells in the same building get the existing wall-and-door
    treatment.

### Pass 1C deliverables (deferred — separate agent run)

- `src/buildings.js` — building-mass system: groups cells into buildings,
  determines which exterior cells are "outside," generates windows
  along exterior walls.
- `src/windows.js` — window prop kind: full-height glass with break
  health, shatter VFX, walkable-when-broken sill.
- `src/skybridges.js` — connector-room shape variants for inter-building
  links (open catwalk, enclosed glass, crane arm, fire escape).
- `src/ledges.js` — climbable surface system: narrow walkways above
  ground level, mantle-up trigger, drop-off on either side.
- `src/level.js` patches — building grouping in the chain builder;
  exterior wall replacement with window walls; connector substitution
  on inter-building edges.
- `src/main.js` patches — mantle/ledge input handling (existing input
  system likely needs a mantle key bind); shoot-through-window
  raycaster pass-through for projectiles vs windows.

### Pass 1C invariants (must hold)

- Every doorway and every window is reachable from spawn via the
  existing pathway flood-fill (windows count as walls until broken;
  but every room must still be reachable WITHOUT breaking glass).
- Mantling up a ledge OR crossing a skybridge is OPTIONAL — never
  the only path.
- Falling off a ledge in an isometric game can softlock if the camera
  doesn't follow — fall handler teleports player back to safe cell
  with -10 HP if they end up out of bounds.
- Buildings stay convex (no inset L-shapes at the building level —
  L-shape stays at the per-room shape level).

## Goals (Pass 2 — deferred but scoped here)

8. **Multi-doorway rooms** — wide-arch openings (2× door width, no door panel), double-doors (two separate gaps), arched colonnade entries.
9. **Destructible walls** — interior walls that break on damage, opening shortcuts. Marked with a hairline crack texture so players can identify them.
10. **Secret doors** — wall segments that look solid but reveal a hidden room when interacted with. Indicated by subtle wall-pattern break or scuff mark on floor.
11. **Bridges + narrow walkways** — interior cells with the floor cut out and a thin walkway across; falling triggers fall-damage + corridor warp.
12. **Stealth-aware approach scoring** — entrances tagged as `front`/`side`/`rear`; AI awareness ramp gradient based on which entrance the player uses.

## Non-goals

- We do NOT change the underlying grid pitch / room size grammar. ROOM_W/ROOM_H stay 18m.
- We do NOT touch wall mesh creation, doorway clearance math, encounter placement, or any AI pathfinding code beyond stamping `userData.kind`.
- We do NOT touch the lighting / stealth system — only register prop lights as already done.

## Architecture

Three new modules, plus targeted patches to existing files:

### NEW — `src/room_templates.js`

Exports an array of `RoomTemplate` objects. Each template:

```js
{
  id: 'library-reading-nook',
  themes: ['library'],          // which level themes this fits
  weight: 1.0,                  // selection weight when multiple match
  minSize: { w: 14, d: 14 },    // skip if room is smaller
  layoutHint: 'open',           // suggest a layout (passes through to wall builder)
  props: [
    { kind: 'bookshelf', placer: 'wall', count: { min: 2, max: 4 }, contiguous: true },
    { kind: 'desk',      placer: 'interior' },
    { kind: 'chair',     placer: 'adjacent', anchor: 'desk', side: 'back' },
    { kind: 'rug',       placer: 'underAnchor', anchor: 'desk' },
    { kind: 'cabinet',   placer: 'wall', chance: 0.5 },
  ],
  decor: { rugCenter: false, ceilingLamp: true, wallSconces: 2 },
}
```

Templates exist for:
- `library`: reading nook, stacks (rows of bookshelves), study (desk + cabinet + chair)
- `lobby`: reception (couch + coffee table + chair triangle), waiting area (couches lining 2 walls + plants)
- `bedroom`: master (bed + 2 nightstands + dresser), bunk (2 beds + lockers), guest (bed + chair + small desk)
- `livingRoom`: tv-lounge (couch + coffee + tv), parlor (2 chairs facing each other + lamp between), dining-living (table + 4 chairs + couch)
- `warehouse`: crate-stack-corner (3-crate stack + barrel), pallet-staging (3 pallets in row + 1 forklift-shaped crate), shelving-rows (cabinet rows like an aisle)
- `office`: workstation (desk + chair + cabinet + shelves above), open-plan (2-3 desks side by side), executive (large desk facing door + bookshelves behind)
- `kitchen`: dining (central table + 4 chairs + sideboard cabinet + rug), galley (2 cabinets along walls + central island), pantry (cabinets lining 3 walls)

Each theme has 2–4 templates. Selection: filter by theme, then weighted random.

### NEW — `src/extraction_room.js`

Replaces `revealExit()` ring-in-boss with a proper extraction room.

Contract:
- After the boss is defeated, instead of dropping a ring marker in the boss room, OPEN a previously-locked door on the boss room's "back" wall (opposite the entrance from the chain).
- The locked door reveals a 12×12 small extraction room.
- Extraction room contents: ONE of the following themed sets, picked from level theme:
  - **evac-van**: a van prop blocking 60% of the back wall, side door open; player walks into it
  - **helo-pad**: an open-roof room with circular landing pad + crates around it
  - **service-elevator**: a recessed double-door at the back wall with control panel beside it
  - **sewer-grate**: a floor grate (drop-through) with light beam from below
  - **chopper-lz**: variant of helo-pad with railings and warning stripes
- The "exit bounds" check (`isPlayerInExit`) becomes "player is inside this room"; trigger zone is the room's interior.
- Theme-locked: industrial themes get evac-van/service-elevator; sewer themes get sewer-grate; rooftop themes get helo-pad/chopper-lz.

### NEW — `src/level_invariants.js`

Smoke harness for level-gen invariants. Run from `scripts/smoke/` via the
top-level `_check_invariants.mjs` runner.

For each tier (1, 5, 10, 20):
1. Generate level 5 times with different seeds
2. Flood-fill walkable cells from `playerSpawn`
3. Assert every room is reachable
4. Assert every encounter spawn is reachable
5. Assert the extraction room is reachable AFTER the boss is virtually cleared
6. Assert no prop placement straddles a doorway clearance band
7. Assert every prop's `userData.kind` is set (no anonymous obstacles/decorations)
8. Assert minimum prop density per themed room ≥ 3 substantive props

Failure → smoke fails → cannot commit.

### PATCHES — `src/level.js`

1. **Bias theme assignment to 80%+** of combat rooms. Currently the
   `_themeRoom` branch only runs when the theme matches and randomness
   triggers — change to "always pick a template, fall back to generic
   ambient if none match."
2. **Replace inline theme branches** (`if (theme === 'library') { ... }`)
   with `applyTemplate(room, pickTemplateForRoom(room))`. Single dispatch.
3. **Stamp `userData.kind`** on every `_registerProp` call (proxy + group)
   AND on every decoration push.
4. **Layout assignment** — bias toward varied layouts. Currently:
   ```js
   if (Math.random() < 0.5) room.layout = 'corridor';
   ```
   Becomes a weighted picker covering 8 layouts (existing) for
   non-corridor rooms.
5. **Architectural sprinkle** — replace symmetric corner-lamp default
   with template-driven decor (e.g., library has wall sconces between
   bookshelves; warehouse has industrial overhead lamps).
6. **Boss room** — flag `room._exitDoorWall` on a wall during boss
   room construction. Locked door panel is added to that wall;
   extraction room is generated beyond it but kept hidden until
   `revealExit()` is called.

### PATCHES — `src/props.js`

1. Add 4 new prop kinds: `evacVan`, `heloPad`, `serviceElevator`, `sewerGrate` (plus simpler primitives — `railing`, `crateRow` for the extraction-room scenes).
2. Add `wallSconce` (decorative wall-mounted lamp, attaches to wall).
3. Tag every prop's return shape with `kind: 'desk'` (the existing
   props already do this implicitly via the buildProp dispatch — make
   it explicit on the returned object so `_registerProp` can stamp it).

### PATCHES — `src/main.js`

Update `revealExit()` callers — instead of drawing a ring, open the
exit door + transition camera to show the extraction room briefly
(0.5s pan), then return to gameplay. Player walks into the room to
trigger extraction.

### Pass 2 surfaces (deferred)

- `src/destructibles.js` — wall-segment health, break sequence, debris cleanup
- `src/secret_doors.js` — interaction-triggered reveal, hint VFX
- `src/bridges.js` — floor cutout + walkway prop, fall trigger
- These hook into existing wall mesh + door builders via new optional flags on the room/wall config — no surgery on the working primitives.

## Implementation order

1. Migration data structures (room_templates module + extraction_room module — files only, no wiring yet)
2. props.js additions (new prop kinds + kind-tagging on existing returns)
3. level.js patches A: stamp `userData.kind`, expand theme coverage, dispatch to templates
4. level.js patches B: extraction-room generation alongside boss room
5. main.js patches: `revealExit` rewrite
6. Smoke harness: `level_invariants.js` + wire to `_check_invariants.mjs`
7. Manual + probe validation

## Reverting

- Branch is `level-gen-overhaul`. If anything regresses, `git reset --hard origin/main` on the branch (NOT main).
- Baseline tag `baseline-wall-gen-2026-05-05` is the absolute fallback if even main breaks.
- Each implementation step gets its own commit so we can bisect.

## Acceptance — Pass 1

- 20 generated levels (4 tiers × 5 seeds): every level passes the
  invariant smoke harness.
- Probe screenshots show: themed rooms with ≥ 4 props in semantic
  arrangement, varied layouts (≥ 4 distinct layout types per level),
  the exit replaced by a proper room.
- Manual playthrough of level 1 confirms: feels like rooms, not noise.
- No regressions in the existing wall-gen invariants from the
  `baseline-wall-gen-2026-05-05` tag.

---

## Pass 2 — perf pass (2026-05-05, branch `level-perf-pass`)

After Pass 1A/1B/1C shipped, mesh count + draw call count had grown
significantly. Probe (`tools/probe-perf.html` + baseline JSON at
`audits/perf-baseline-2026-05-05.json`) was run on seed=1 across
levels 1, 5, 10, 15, 25, before and after the perf changes.

### Mesh count + draw calls per level (seed=1, no actors)

| Level | Meshes (before → after) | Draw calls | Δ % | Lights |
|---|---|---|---|---|
| 1  | 811  → 549 | 549  | -32% | 8 |
| 5  | 772  → 476 | 476  | -38% | 9 |
| 10 | 970  → 719 | 719  | -26% | 13 |
| 15 | 1097 → 700 | 700  | -36% | 13 |
| 25 | 970  → 698 | 698  | -28% | 13 |

`runOutdoorInvariants()` (which includes `checkPathwayInvariants`)
passes for every probed tier post-perf-pass.

### What changed

1. **Wall InstancedMesh** (`src/wall_instancer.js`) — every static wall
   (outer / inner / low cover / columns / platforms / elevator solid
   panels) routes through one InstancedMesh per color. Doors stay on
   the legacy mesh path because they animate.
2. **Window frame merge** (`src/windows.js`) — sill + lintel + 2
   mullions merged into one BufferGeometry per (w, h, sillH) tuple,
   cached. Glass remains separate (independent shatter lifecycle).
3. **GLB/FBX light strip** (`src/gltf_cache.js`) — every imported
   model has its embedded lights pruned in `loadModel()` before the
   template is cached. Catches editor preview lights that Blender /
   FBX exporters sometimes ship with prop assets.
4. **Decoration LOD** (`src/level.js _registerDecorationsAsCullable`) —
   end-of-generate sweep pushes window groups, ceiling-lamp fixtures,
   encounter visuals, etc. into `_cullableProps` so the per-frame
   proximity sweep can hide them when the player is far. Lights are
   skipped (they have their own narrower-radius cull).

### Skipped / partial

- **Generic prop instancing** (planter / lamp / chair / desk) — bigger
  refactor than time allowed; each prop is a `THREE.Group` of 3-8
  primitive sub-meshes with per-instance geometry caches that are
  ALREADY shared. The remaining win comes from re-keying those by
  (geom + material) and instancing each sub-mesh role. Deferred.
- **Light audit at runtime** — the pre-perf live-game numbers (28
  lights vs 9 registered) included AI rig lights + pooled effects;
  this branch did not touch AI files. The gltf_cache strip catches
  the asset-import path, which is the next-most-common source.

### Hard rules verified

- No regressions in `runOutdoorInvariants` or `checkPathwayInvariants`.
- Wall collision still uses `userData.collisionXZ`. Bullet raycasts
  in projectiles.js iterate `level.obstacles` which still receives
  proxy entries for instanced walls.
- Door animation paths (open/close, color flip, scale.y) untouched —
  doors route around the wall instancer by color check.
- `window.__level` still set; probe HTML reads it.
