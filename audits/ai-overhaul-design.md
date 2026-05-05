# AI overhaul — design doc (2026-05-05)

The level-gen overhaul (Pass 1A+1B+1C) and perf pass shipped earlier today.
Now: AI. Branch: `ai-overhaul`. Tagged baseline:
`baseline-wall-gen-2026-05-05` (also covers AI baseline since we haven't
touched AI yet).

## Known pathologies (from AGENTS.md + code reading)

1. **AI walks straight at the player** (AGENTS.md notes this explicitly:
   "current AI walks straight at the player; a real flow field or A*
   on a grid would be a meaningful upgrade for late-game floors").
2. **O(N²) AI proximity / LoS queries** (AGENTS.md notes:
   "gunman.update() does O(enemies × shieldBearers × walls) checks per
   frame. A 5×5m grid hash recomputed once per frame makes most of
   these O(1)").
3. **Cover-seeker variant exists** (`TUCK_VARIANTS = ['dasher', 'runner',
   'coverSeeker', 'sniper']`) **but cover use is rare** — the cover
   discovery heuristic only fires for those four variants and looks at
   nearby low-cover obstacles only.
4. **No squad coordination** — each enemy decides flanking angles
   independently, often producing two flankers on the same side.
5. **No awareness of windows / ledges / skybridges** — AI doesn't shoot
   through windows, doesn't use the new traversal surfaces.
6. **No retreat/regroup** — wounded enemies fight to death even at 5% HP.
7. **No suppressing fire** — every shot is "aim-and-fire," no concept
   of pinning the player while a teammate flanks.
8. **Drone AI is barely a thing** (303 LOC).

## Goals — Pass 1 (this pass, ship now)

The two biggest wins per AGENTS.md + the user's stated "AI walks
straight at player" complaint:

### A. Spatial hash + flow field

- `src/ai_spatial.js` — 5m-grid spatial hash. Indexes `level.obstacles`
  + `gunmen` + `melees` + `player` once per frame. Provides:
  - `query(x, z, r)` → list of entries within radius
  - `losClear(ax, az, bx, bz)` → boolean LoS test using bvh
  - `flowFieldTo(targetX, targetZ)` → cached flow field giving
    "next direction toward target" per cell. Built once when the
    target is a new cell; reused until the target moves >2 cells.
- `gunman.update()` replaces its inline `O(enemies × walls)` loops
  with `_spatial.query()` calls. The flow field replaces straight-line
  approach with "next direction" sampling per gunman per frame.
- **Invariant**: existing AI behavior preserved when flow field can't
  find a path (e.g., enemy is on a ledge that's not in the grid). Falls
  back to old straight-line approach.

### B. Cover scoring + use across all variants (not just coverSeeker)

- `src/ai_cover.js` — cover scoring system. For a shooter at point S
  vs target T:
  - Walk obstacles within 8m of S
  - For each obstacle's 4 "behind-edges" (the two edges facing away
    from T): check if standing 0.5m behind that edge gives LoS-block
    on T but LoS to T from a "peek" position next to the edge
  - Score: `1.0` if LoS blocked + peek possible; `0.6` if blocked but
    no peek; `0.0` otherwise
  - Return ranked list of cover positions
- `findCoverFor(gunman, player)` — used by every variant in the
  `STATE.FIRING` branch when health < 50% OR when player is firing.
- Replaces the existing per-variant cover-find with a single shared
  helper that all variants use.

### C. Window awareness

- `src/ai_windows.js` — when computing LoS from gunman to player:
  - If a window is between them (broken or intact), AI gets a "window
    LoS" tag — it CAN shoot through (broken) or it CAN shoot AT the
    window to break it and advance (intact, HP=2).
  - When approaching: if a window is between AI and player, AI shoots
    the window first to clear the path before advancing.
- Plumbing: `level.obstacles` already has windows tagged with
  `userData.kind === 'window'`. The AI raycaster needs a window-aware
  branch like the bullet path got in Pass 1C.

## Goals — Pass 2 (deferred, scoped here)

### D. Squad coordination

- `src/ai_squad.js` — when 2+ enemies engage the player, assign roles:
  - 1 anchor (fires from current cover, suppressing)
  - 1-2 flankers (move to opposite-side cover, attack from new angle)
  - 1+ rushers (close distance under suppressing cover)
- Roles re-assigned on damage (a hit anchor swaps with a flanker).

### E. Ledge / skybridge awareness

- AI on patrol sometimes climbs onto a ledge to scan; AI in combat
  uses elevated cover positions on catwalks; skybridge connectors
  become elevated firing lines.

### F. Retreat / regroup

- Wounded AI (HP < 25%) breaks engagement and retreats to nearest
  cover OR to a healer/medic NPC if one exists. Returns to fight
  after 5s if not pursued.

### G. Suppressing fire concept

- Pinning fire: low-accuracy continuous shots toward player's last
  known position, NOT aimed at player directly. Pins player into
  cover. Triggered by squad anchor while flanker repositions.

### H. Drone AI overhaul

- Currently drones barely path. Rebuild with same spatial+flow field
  primitives. Drones do strafing runs, not direct approach.

## Implementation order — Pass 1

1. `src/ai_spatial.js` — grid hash + flow field. NO behavior changes
   yet, just the new module.
2. `src/ai_cover.js` — cover scorer. Standalone, no integration.
3. `src/ai_windows.js` — window-LoS helper. Standalone.
4. `src/gunman.js` patch — replace inline O(N²) loops with spatial
   queries. Replace per-variant cover-find with `findCoverFor`. Add
   window-LoS branch in fire-decision logic.
5. `src/melee_enemy.js` patch — same spatial hash; melees use flow
   field for chase pathing.
6. `src/ai_separation.js` patch — use spatial hash neighbors instead
   of full pair iteration.
7. `tools/probe-ai.html` — AI behavior probe: spawn N enemies, sample
   their state every 250ms for 10s, print decision histogram + cover
   use rate + flank-angle distribution.
8. Smoke check additions to `level.checkPathwayInvariants()` /
   `runOutdoorInvariants()` — assert flow field reaches every room
   from spawn.

## Hard constraints

- **DO NOT change physics, projectiles, or weapon code.** AI changes
  feed into the existing combat layer; the layer itself is stable.
- **DO NOT touch coop sync or rig instancing.** AI changes must be
  network-stateless (server is authoritative; clients render from
  snapshots).
- **DO NOT regress single-frame perf.** New AI modules must measure
  faster (or at parity) than the current `O(N²)` after spatial hash
  lands. If the spatial hash is somehow slower, ship none of it.
- **PRESERVE the dev-time exposers** — `window.__level`, `window.__gunmen`,
  `window.__melees`, `window.__drones`. Add `window.__aiSpatial` for
  the new hash so probes can inspect.
- **One commit per numbered step**, push to `origin/ai-overhaul` after
  each.

## Pass 1 acceptance

- Probe captures ≥5s of AI behavior for 8 spawned gunmen
- Cover-use rate ≥ 30% of frames (currently estimated ~5%)
- Avg movement / sec drops to ~70-80% of baseline (AI moves more
  deliberately, not just "walks at player")
- Flank-angle distribution shows actual variety (not all 0)
- Frame time at 8 enemies + 4 melees stays ≤ baseline + 1ms
- All checkPathwayInvariants + runOutdoorInvariants still pass
- Live game playable through level 5 without crash
