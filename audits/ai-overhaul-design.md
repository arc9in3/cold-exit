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

## Pass 2 — implementation contract (2026-05-05, locked)

### Coop-first ground rules (apply to every step)

- **Host-authoritative.** All Pass 2 decision logic gates on
  `!ctx.coopJoiner`. The joiner mirrors host state via the existing
  `coop/snapshot.js` 20Hz packet — Pass 2 should NOT introduce a new
  snapshot kind unless absolutely necessary. Squad role + retreat
  state can ride on existing per-enemy fields (already encoded:
  position, hp, state-string).
- If a new field is required (e.g. a new `state` value like `RETREAT`
  or `SUPPRESS`), extend the STATE enum and let the snapshot's
  existing `state` string carry it. Joiner reads it and picks the
  right animation cue without running its own decision logic.
- **No new world-state mutations** (the windows/destructibles/ledges
  patterns) — Pass 2 is enemy-internal behavior, not environment.
  Coop sync gap is therefore minimal.

### D — Squad coordination (`src/ai_squad.js`)

- New module. Exports `assignRoles(level, gunmen, player)` called once
  per AI tick (host-only).
- Walk gunmen filtered by "alive AND aware AND in same room as
  player". Group by room. Per group:
  - Pick the gunman closest to player → `role: 'rusher'` (closes
    distance)
  - Pick the gunman in best-scoring cover via `ai_cover.findCoverFor`
    on player's known position → `role: 'anchor'` (suppresses)
  - 1-2 of the rest → `role: 'flanker'` (move to a cover position
    on the opposite hemisphere of player relative to anchor's
    position; uses `ai_cover` with a `directionHint` arg)
  - Remaining → `role: 'support'` (existing behavior)
- Roles stamped on `gunman.role` (overrides existing `'rusher'`/
  `'flanker'` runtime tags). Re-assignment runs on a 1Hz cron AND on
  any role-bearing gunman taking damage > 20% maxHp in one hit.
- Anchor-vs-flanker rotation: if the anchor takes hp damage,
  swap with the closest flanker on the next tick.

### E — Ledge / skybridge awareness

- Patrol behavior: 30% chance per patrol leg, gunman tries
  `ledges.mantleableAt(level, g.position, g.facing)`. If a ledge is
  available AND no other gunman occupies it, mantle. Stay 4-8s,
  scan, drop off via `ledges.dropOff`.
- Combat: when scoring cover via `ai_cover.findCoverFor`, weight
  ledge positions in the same room or adjacent room +0.3 (elevated
  fire angles are valuable). Cap at 1 gunman per ledge per room.
- Skybridge connectors: count as a high-value cover/scan position.
  `ai_squad` can route an anchor onto a skybridge if one exists in
  the same building chain as the engagement room.
- The position offset for elevated AI must reach the ghost-rendering
  path so the joiner sees the gunman lifted by the same amount.
  Existing player-on-ledge sync is the template; mirror for AI by
  adding a `g.onLedge` flag to the existing `state` string in the
  snapshot (or a separate `oL` bit on the gunman entry).

### F — Retreat / regroup

- New STATE: `RETREAT`. Triggered when gunman's hp drops below 25%
  AND a cover position with score ≥ 0.6 exists within 8m.
- During RETREAT: the gunman moves to that cover via flow-field, does
  NOT fire, ticks a 5s self-heal timer. After 5s heals 30% hp,
  returns to ALERTED state.
- Triggered re-entry to combat: if hp drops below 10% during retreat
  OR an enemy (player) is within 4m, abandon retreat and fight.
- Healer NPCs deferred (no medic kind exists yet); pure self-heal
  per cover.
- Joiner-side: the `state` snapshot field carries RETREAT; the
  ghost rig plays the existing wounded-jog animation cue.

### G — Suppressing fire (anchor only)

- New STATE: `SUPPRESS`. The anchor enters this when its squad has
  ≥ 1 flanker AND the flanker is currently moving toward a flank
  cover position.
- During SUPPRESS: gunman fires at a 2x spread multiplier toward the
  player's LAST KNOWN cell (not aim-at-player), pins the player
  into cover. Fire rate is normal; accuracy is intentionally bad.
  The point isn't to hit, it's to make the player keep their head
  down while the flanker repositions.
- Exits SUPPRESS when the flanker reaches their flank cover (within
  1m of the target position) OR after 6s elapsed.

### H — Drone AI overhaul

- Existing `src/drones.js` is 303 LOC and barely paths.
- Replace the chase loop with: pick a strafing path = circle around
  the player at 5m radius, sampling the flow field per step to
  avoid walls. Fire on cooldown while traversing; no straight-line
  approach.
- Drones do NOT use the squad system (different scale, different
  movement). They use spatial hash + flow field for navigation only.
- Coop sync: drones already serialize position + hp via existing
  drone snapshot. No changes needed.

### I — Probe + invariant

- Extend `tools/probe-ai.html` to record squad-role distribution +
  retreat-trigger rate + suppress-fire-active-time per 10-second
  capture.
- Add invariant: in any room with ≥ 3 alive gunmen aware of player,
  the squad role distribution must include at least 1 of each of
  {anchor, rusher, flanker} (no all-rushers, no all-anchors).

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
