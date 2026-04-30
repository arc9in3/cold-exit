# End-of-day perf + refactor audit — 2026-04-30

Scope: post-41-commit hideout/encounters/rank/durability burst.
Method: read the tick loop and the busiest call sites; flag a finding only after looking at the actual code, not the filename. Aimed for high-signal items the user can land tomorrow.

---

## 1. Hot-path perf scan

### F1 — `tickEncounters` rebuilds the per-encounter `ctx` object every frame  (HIGH)
**File:** `src/main.js` ~3463 (call site), factory at ~2787-3077
**Issue.** `tickEncounters` calls `ent.ctxFactory()` for every active encounter every frame. The factory is a 290-line object literal with ~80 closure-bound lambdas (`spawnSpeech`, `rollRandomToy`, `rollRareGear`, `spendPlayerCredits`, `grantBuff`, `relicFor`, `filterUnownedArtifactIds`, etc.). On a typical floor with 5-10 active rooms this is 5-10× a fresh object + ~80 fresh closures × 60 fps = very visible GC churn, and almost none of those helpers are actually consumed inside a per-frame `tick()` (most are only used by `spawn()` or `onItemDropped()`).
**Fix.** Cache the ctx on `ent` at spawn time (`ent._ctx = _ctxFactory()`) and reuse it. The few mutable fields the tick path needs — `playerPos`, `playerSpeed`, `state`, `dropPos` — can be assigned onto the cached object before each call. The reward-roll helpers don't need to be rebuilt; they close over the same module state every time.

### F2 — Burn-flame spawner allocates fresh geometry + material per particle  (HIGH)
**File:** `src/main.js` 10559-10590 (`_spawnActorBurnFlames`); same pattern at `_spawnEmber` 7428, `_spawnSmoke` 7449, `_spawnFlungFireOrb` 7495.
**Issue.** Every burn-flame, ember, smoke, and flung-orb is built with `new THREE.Mesh(new THREE.SphereGeometry(...), new THREE.MeshBasicMaterial({...}))`. The cap is 240-260 orbs but they cycle continuously (life ~0.3-1.4s) — at the cap, that's ~600-900 fresh `SphereGeometry`+`MeshBasicMaterial` constructions per second when a multi-zone fire is active, plus an equal number of `dispose()`s on retire (line 7654-55). The tongue path already shares geometry — extend the same approach to ember/smoke/burn-flame variants.
**Fix.** Cache one shared `SphereGeometry` per kind at module scope (the kinds use just a handful of size buckets — pick a representative size and let `mesh.scale.setScalar()` handle variation, like the tongue path already does). For the materials, either create a small pool of shared materials (color/opacity are mutated per-frame anyway) or allocate the material from a free-list. The cleanup path then only disposes the geometry on `kind === 'tongue'`-style exclusions. Saves the lion's share of the alloc churn during fire encounters / molotov use.

### F3 — `tickCorpseDespawn` traverses every dead body every frame  (MEDIUM)
**File:** `src/main.js` 11301-11345
**Issue.** The despawn sweep iterates every dead body in both `gunmen.gunmen` and `melees.enemies` every frame and calls `c.group.traverse(...)` for each one inside the fade window. Even outside the fade window the per-corpse iteration walks every dead entry to test eligibility. With many sustained late-game corpses this loop scales with cumulative dead-count per floor.
**Fix.** Maintain a `_pendingDespawn` list — push entries when an enemy becomes eligible (looted / summoned / empty), then only this short list is ticked. The main `gunmen`/`melees` arrays don't need to be walked. Bonus: cache the post-traverse material list on the corpse (`c._fadeMaterials`) on first visit, so the every-frame fade no longer calls `traverse()` (it's a deep tree walk per actor).

### F4 — `Math.hypot` in inner loops where `dx*dx+dz*dz` would suffice  (LOW-MEDIUM, broad)
**Files:** `src/main.js` lines 541, 8281, 8790, 11512, 11999, 12018; `encounters.js` 1558, 1776; `gunman.js` 22 hits; `melee_enemy.js` 676.
**Issue.** `Math.hypot` is ~5-8× slower than `dx*dx+dz*dz` because of overflow-safe scaling. Most call sites compare against a constant — line 8790 `if (d >= range)` could be `if (dxSq + dzSq >= rangeSq)` with no sqrt. Line 8281 `nearestBody` is the canonical example: it's called every frame from `updateLootPrompt`, walks every corpse in both lists, and computes `Math.hypot` for each. Convert to `d2 < bestDist2` and only sqrt at the end if you need the actual distance for display.
**Fix.** Sweep the per-frame call sites. Easy mechanical change. Largest single win is `updateEnemyVisibility` line 8790 — runs over every enemy in range, every frame, and the result is only used in a `>= range` comparison.

### F5 — `tutorialMode` linear-scan per-frame for stealth dummy  (LOW)
**File:** `src/main.js` 11505-11520
**Issue.** Inside `tickFootsteps`/`tick()`, when tutorialMode is on, the code does `for (const g of gunmen.gunmen) if (g.alive && g.stealthTarget) ...`. Linear scan every frame for the lifetime of the tutorial. Fine in the normal path (cheap branch), but the per-frame scan looks wasteful.
**Fix.** Cache the stealth dummy reference on tutorial spawn. Drop the loop. Trivial.

### F6 — `[...allHittables(), ...level.solidObstacles()]` rebuilt per shot  (LOW)
**File:** `src/main.js` 5382, 5791, 7292, 8138 (and a couple others — see Grep results)
**Issue.** `allHittables()` is per-frame cached, so the spread-merge happens once per shot, not per pellet. But on full-auto with class-extra pellets active, that's still 10-20 fresh merged arrays/sec. Each merge copies all enemy meshes + every wall in the level (potentially 200+ entries late-game).
**Fix.** Add a `combinedHittables(includeLowCover)` accessor that mirrors the `_hittablesFrame` cache pattern with a sibling `_combinedHittablesFrame` keyed on `(frameCounter, includeLowCover)`. Returns the same merged array across the frame. Saves a measurable slice on shotgun + LMG sustained fire.

---

## 2. Refactor wins

### F7 — Duplicated repair-kit math in `Inventory.applyRepairKit` and `_bodyApplyRepairKit`  (HIGH for correctness, low for perf)
**Files:** `src/inventory.js` 2199-2231 vs `src/ui_loot.js` 39-66
**Issue.** The two functions share ~20 lines of identical validation + repair-percent + potencyMult math; the body version omits stack decrement + `_bump()`. The duplication means any future change (e.g. mastercraft kits, repair-cost penalty, broken-item gating) has to land in two places, and the `_BODY_REPAIR_PCT_BY_RARITY` table in `ui_loot.js` will silently drift from `REPAIRKIT_PCT_BY_RARITY` in `inventory.js` if either is touched. The recent durability cherry-pick was specifically called out by the user as having this fork.
**Fix.** Extract `Inventory.computeRepairAmount(kit, target, potencyMult)` returning either a number or `null` (if invalid). `applyRepairKit` calls it then handles stack decrement + bump. `_bodyApplyRepairKit` calls the same helper and writes `target.durability.current` directly. Both paths share validation, both paths share rarity table.

### F8 — `npc.kind` switch ladder duplicated in 3+ places  (MEDIUM)
**File:** `src/main.js` 1892-1899 (re-stock), 2710-2716 (re-stock duplicate), 9144-9159 (loot prompt), 1395-style scattered
**Issue.** Same ladder appears at least three times. The two re-stock blocks are *byte-for-byte identical*. Adding a new merchant type means hunting through main.js for ladders.
**Fix.** Single module-level table:
```
const NPC_STOCK = { merchant: makeMerchantStock, healer: makeHealerStock, ... };
const NPC_PROMPT = { merchant: 'trade with merchant', ... };
```
Replace each ladder with one lookup. ~30 lines deleted + a future-proofed extension point.

### F9 — `main.js` is 12.5k lines; throwables subsystem is the cleanest extraction  (MEDIUM)
**File:** `src/main.js` ~9358-10721 (throwables) — 1300 lines of contiguous, low-coupling code.
**Issue.** main.js is borderline ungovernable. The throwables block is self-contained (cooldowns, charge counts, aim preview, fire zones, flash domes, stun stars, gas/smoke/decoy zones, claymores, grapples). Most of the cross-coupling is via well-defined module-level lists (`_fireZones`, `_smokeZones`, etc.) and helpers like `spawnAiThrowable` / `_alertThrowableBlast`.
**Fix.** Extract `src/throwables.js` exposing a `Throwables` manager with `tickAll(dt)`, `spawnFireZone`, `spawnFlashDome`, `tickThrowAimPreview(item)`, etc. Pass `(scene, combat, level, player, gunmen, melees, damagePlayer)` in the constructor. Net: main.js drops ~10% in size with no behavioural change. Worth doing before the file hits 13k.

Other extractable subsystems on the same axis (in priority order): contracts/dev panel UI (~700 lines), dummy spawn + playgound mode, encounter `_ctxFactory` definition.

### F10 — Magic numbers in main.js hot paths belong in tunables  (LOW-MEDIUM)
**File:** `src/main.js` (various — `BLOOM_MAX_MULT`, `BLOOM_DECAY_PER_SEC`, `FIRST_SHOT_THRESHOLD`, `GHOST_BASE_RANGE`, `GHOST_NEAR_ALPHA`, `OCCL_ENEMY_RANGE`, `CORPSE_FADE_DELAY`, `BURN_READOUT_INTERVAL`, `MELEE_COMBO_WINDOW`, fire-orb caps `260`/`240`)
**Issue.** Tuning knobs are split across `tunables.js` and a wall of `const` at the top of main.js. A balancing pass has to remember which file each lives in.
**Fix.** Move them to logical sections of `tunables.js` (`tunables.bloom`, `tunables.ghost`, `tunables.corpse`, `tunables.fireOrbs`). Cheap and pays off every balance pass.

---

## 3. Three.js specific

### F11 — Spread-allocation patterns and one-shot mesh disposals look mostly clean  (NOTE)
**Status check.** Combat already pools tracers/flashes/impacts via `_sharedParticleGeom` and per-pool material caches (`combat.js` 39+). The fire-orb tongue geometry is shared. The rig instancer is doing its job. PointLights are tightly bounded — only two static `PointLight`s in the entire repo outside of muzzle flashes (Bear Merchant lamp + emissary jewel), and muzzle-flash lights are gated on `qualityFlags.muzzleLights`.
**Implication.** The biggest InstancedMesh / dispose wins were already taken in the recent perf passes. The two remaining hotspots are F2 (burn flames) and F3 (corpse fade traverse).

### F12 — Encounter `castShadow=true` proliferation  (LOW)
**File:** `src/encounters.js` 33+ separate `castShadow=true` assignments on encounter props (skull pile cranium, glass case panes, altar, candles, jukebox, etc.).
**Issue.** Every encounter prop casts shadows. Three.js shadow-map rendering re-rasterizes the scene from each shadow-casting light's POV; more shadow casters = more triangles re-drawn into the depth target every frame. Most of these props are static decoration with diffuse-shadow-irrelevant shapes (a candle on a table doesn't need to cast a shadow blob).
**Fix.** Pass: only set `castShadow=true` on encounter centerpieces (statues, big silhouettes — Sleeping Boss, Bear Merchant, Royal Emissary). Drop it on flat / small / table-mounted props (candles, jukebox dials, altar bowls, glass case shards). Easy mechanical sweep — no behaviour change, lighter shadow render. Pairs well with a Sage audit if you want a recall sweep.

### F13 — `spawnMeleeSegment` creates a fresh BufferGeometry per swing-frame  (LOW)
**File:** `src/combat.js` 341-380
**Issue.** Per-frame during a swing (player + every meleeing enemy with `tipMarker`), this allocates a `Float32Array(12)`, a `BufferGeometry`, and a `MeshBasicMaterial`. `arcs[]` holds them and disposes on life-end. For the player it's ~10-20 segments per swing; for boss melees on a swarm room with 5+ swinging enemies it can run 40-80 fresh geometries/sec.
**Fix.** Lower priority than F2 because lifetimes are short and the visuals are a player-feedback feature. Could pool a ring of N pre-allocated `Mesh + BufferGeometry + MeshBasicMaterial` and just rewrite their position attribute + opacity. Tag with priority "do this if you have time".

---

## 4. Quick wins (ship in 5-min increments)

- **`nearestBody` square-distance:** `src/main.js` 8275-8287. Replace `Math.hypot` with `dx*dx + dz*dz` against a `bestDist2`. Two-line edit, removes a sqrt per dead corpse per frame.
- **`updateEnemyVisibility` square-distance at line 8790:** the LoS-fail branch computes `Math.hypot(...)` and then only uses it as `d / range` (eased) and `d >= range`. Compute `d2` once, derive `d` only when needed for the eased opacity ratio.
- **Stealth-dummy lookup cache (F5):** capture once in tutorial spawn, drop per-frame `for (const g of gunmen.gunmen)`.
- **NPC-stock ladder collapse (F8):** convert lines 1892-1899 + 2710-2716 to a single map lookup. ~10 lines removed.
- **Tutorial run-time fireHints:** `src/main.js` 11477-11483 reads `Date.now()` every frame and computes seconds — fine in absolute terms, but the computation only matters until *each* hint fires. Once `runSec > 50`, none of the comparisons matter (`fireHint` itself is idempotent). Add a single boolean `_allTutorialHintsFired` that flips on the last hint and short-circuits the block.
- **`tickAmbushDrops` bail-on-empty:** `main.js` 11350-11362 walks both enemy lists every frame even after every ambush has landed. Maintain a small set of "dropping" actors instead.
- **Move `_BODY_REPAIR_PCT_BY_RARITY` constant out of `ui_loot.js`:** see F7 — once the helper is shared, the table moves with it. One-file diff.
- **`cursorOff` style for `spRow` (`main.js` 12196-12202):** the `display: 'flex' / 'none'` toggle is cached, but the cache compares strings every frame. Change to a numeric flag or a single bool to avoid the string comparison. Microscopic, but trivially applied.
- **`durabilityHud.tick` is wrapped in try/catch every frame** (`main.js` 11588 + 12323). Once, fine; keep one. Cheap.
- **Drop `castShadow` on jukebox + altar candles + glass-case shards** (F12) — fast mechanical sweep in `encounters.js`.

---

## Prioritized landing order

### Do this first
1. **F1 — Cache encounter `ctx`.** Single biggest GC win for late-game floors. ~30-line change in `main.js`. Direct frame-time impact during fire-zone / multi-encounter floors.
2. **F2 — Pool burn-flame / ember / smoke geometry+material.** Saves 600-900 alloc/sec at fire cap. Same pattern the tongue path already uses.
3. **F7 — Extract `Inventory.computeRepairAmount` helper.** Correctness risk eliminated, drift between two tables eliminated. Cheap to land.
4. **F4 / quick-wins — `Math.hypot` → squared-distance sweep.** One PR covering `nearestBody`, `updateEnemyVisibility` line 8790, the tutorial-block, and any other per-frame hits.

### Do this if you have time
5. **F3 — Maintain `_pendingDespawn` list + cache `_fadeMaterials`.** Modest win on long sessions; bigger wins when 30+ corpses are around.
6. **F8 — Collapse `npc.kind` ladder into table.** One-pass refactor; pays back the next time a vendor type is added.
7. **F9 — Extract throwables to `src/throwables.js`.** Material reduction in main.js; no behavioural risk if the existing `_fireZones` / `_smokeZones` are imported.
8. **F12 — `castShadow=true` audit on encounter props.** Sage-shaped sweep, easy delegation candidate.
9. **F10 — Migrate magic numbers to `tunables.js`.** Touch as you naturally hit them; not worth a dedicated commit.

### Defer
10. **F6 — `combinedHittables` cache.** Real but small win; only matters on sustained full-auto fire. Land if you happen to be in fire-path code anyway.
11. **F13 — Pool melee-segment geometry.** Limited cap (life ~0.22s); pool would need bookkeeping. Not worth it until F2 + F1 are in.
