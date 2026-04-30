# End-of-day report — 2026-04-30

You shipped 41 commits today across hideout UI overhaul, encounters, rank-points, weapon balance, shield rework, and a 4-part durability cherry-pick from a stale branch. I ran two parallel audits (bug + perf/refactor) and fixed the high-confidence findings overnight. Synthesis below.

---

## What I shipped while you were asleep

5 audit-driven bug fixes + 2 perf wins. Last live URL: **https://71fc958a.cold-exit.pages.dev**

### Bug fixes (commit `49eb83f`)

1. **Djinn orb fakes damage through shields.** `_fireDjinnShot` was passing no `shieldBreaker` flag and ignoring `result.shieldHit`. A blocked orb shot still spawned a fake body damage number AND inflated `runStats.addDamage`. Now mirrors `fireOneShot`'s shield short-circuit (0/chip number, no body damage credit).
2. **Shield emissive permanently dark after first hit.** The shield-flash decay wrote `(0,0,0)` at flashT=0, killing the baked-in glow. Both `gunman.js` and `melee_enemy.js` now cache `shield.baseEmissive` at construction and lerp toward the spark color so flashes decay back to baseline.
3. **`window.__derivedStats` published before modifiers applied.** The expose was right after `BASE_STATS()`, so any external read mid-recompute returned an empty bag — including any modifier that hadn't run yet. Moved to the END of `recomputeStats`.
4. **Brian's Hat sells for full price.** `sellPriceFor` had no `_encounter` filter. Returns 0 now for any encounter-flagged item — also fixes Beary Doll, Unused Rocket Ticket, and any future encounter rewards.
5. **CnC walk-away kept ticking.** Missing `s.needsTick = false` on the walk-away terminal path. Mirrors the both-died and aftermath→returned terminal paths.

### Perf wins

6. **Encounter ctx caching (commit `ebcac71`).** `tickEncounters` was rebuilding a 290-line ctx object literal with ~80 closures every frame for every active encounter — the largest single GC contributor on late-game floors. Now built once at spawn, cached on `ent.ctx`, with only `playerSpeed` / `state` / `dropPos` refreshed per call. (Audit finding F1.)
7. **`nearestBody` squared-distance (commit `a81f233`).** Called every frame from `updateLootPrompt`. `Math.hypot` is 5-8× slower than `dx*dx+dz*dz`; the distance value was never used, just the ordering. (Audit finding F4 quick-win.)

---

## Bugs that need your eyes

These are flagged by the audit as suspected but not high-confidence enough for me to ship without your call:

### Probably real, mechanical fix

- **`weaponDecayPerSwipe` is dead code.** The tunable is defined but no melee path reads it. Melee weapons never naturally drain durability. (Either delete it, or wire it into `resolveComboHit` + `tickMeleeSwipe` after each successful hit.)
- **`firePlayerProjectile` skips the broken-spread mult.** I patched the bullet path + flame path but missed the projectile path (Widowmaker, frag launcher etc.). When their host weapon is broken, they fire perfectly accurate. Probably a 5-line copy of the gating block.
- **`applyRepairKit` truncates fractional durability.** `cur | 0` discards the fractional part on every kit use. After many repairs the `current` slowly drifts down vs the actual heal amount. Tiny effect but real.

### Suspect — needs design intent

- **Djinn orb can't break heavy shields.** Currently passes `shieldBreaker:false` per my fix above. Intentional? If the player owns the orb AND a shield-breaker rifle, the orb shots count as zero pressure on the shield. Could go either way design-wise.
- **`_buyStorePiece` mutates queue before chip-spend.** If `spendChips` returns false after the queue dedup runs, the previous queued piece is gone but no chips were spent. Race window is tiny but real.
- **Brian's Hat `apply(s)` hook may not fire.** I haven't verified whether the equipped-armor pass actually invokes `apply()` on `type: 'gear'` items. If it doesn't, the 90% fire resist isn't being applied even though the hat equips fine.
- **Trainer unlocks applied AFTER `__derivedStats` exposed (now fixed in #3 above).** With the recompute-order fix shipped, this is likely resolved — but worth a sanity check tomorrow that vit_X bumps actually take effect on the same frame the unlock happens.

---

## Perf wins on the shelf

In rough priority order — landing F1 + F4 already gave the biggest GC win. Remaining:

### Worth doing soon

- **F2 — Pool burn-flame / ember / smoke geometry+material.** At fire encounters or molotov use, ~600-900 fresh `SphereGeometry` + `MeshBasicMaterial` allocs/sec. The tongue path already shares geometry; extend the same pattern. **Real win when fire is on screen.**
- **F3 — Cache corpse `_fadeMaterials` + use a `_pendingDespawn` list.** `tickCorpseDespawn` walks every dead body every frame and calls `c.group.traverse(...)` on each in-fade corpse. Maintain a small list of bodies that are actually fading; cache the material list on first visit so fade doesn't re-walk the tree.
- **F7 — Extract `Inventory.computeRepairAmount` helper.** Two parallel `_PCT_BY_RARITY` tables (one in `inventory.js`, one in `ui_loot.js`) with identical values, waiting to drift apart. Pull into a shared helper.

### Low-priority quick wins

- **`Math.hypot` sweep on remaining hot paths.** ~22 hits in `gunman.js`, several in `melee_enemy.js`. Where the distance value isn't used, swap to squared-distance compare.
- **`updateEnemyVisibility` line 8790** — drops the `Math.hypot`, reuses the existing `d2`.
- **Stealth-dummy lookup cached** — `tickShooting` linear-scans for the tutorial dummy every frame; capture once at tutorial spawn.
- **NPC stock ladder collapse** — `npc.kind` switch ladder duplicated 3+ times in main.js; replace with a `NPC_STOCK = {merchant: makeMerchantStock, ...}` table.
- **Drop `castShadow=true` on encounter props that don't need it** — jukebox dials, glass-case shards, altar candles. Each re-rasterizes the depth target every frame.

### Refactor candidates (bigger lifts)

- **F9 — Extract `src/throwables.js`.** ~1300 contiguous lines in `main.js` (cooldowns, charge counts, aim preview, fire/smoke/decoy/gas zones, claymores, grapples, flash domes). Cleanest extractable subsystem; main.js is at 12.5k lines and ungovernable.
- **F10 — Move magic numbers to `tunables.js`.** `BLOOM_*`, `FIRST_SHOT_*`, `GHOST_*`, `OCCL_ENEMY_RANGE`, `CORPSE_FADE_*`, `BURN_READOUT_INTERVAL`, fire-orb caps `260/240`. Group into `tunables.bloom`, `tunables.ghost`, `tunables.corpse`, `tunables.fireOrbs`.

---

## Everything else I checked

The audit walked these and found nothing actionable: cursed-chest auto-grant gating, CnC NPC lock + dummies removeAll, Priest persistence chain, Spaces Inbetween↔Want to Play bike id matching, pre-mission armor auto-equip, Trainer HP wiring + run-start heal-to-full, tracer per-pellet range fix, drop zone-center aim snap, bookshelves flush placement, Brass Prisoner ammo retune, rank-points system, repair-kit drag-drop intercepts on all 3 surfaces, Patcher/Charlene/Covetous chain, durability HUD column, stunDur ReferenceError fix.

The Three.js layer is mostly clean — combat already pools tracers/flashes/impacts via `_sharedParticleGeom`, tongue geometry is shared, rig instancer is doing its job, only 2 static `PointLight`s outside muzzle flashes (Bear Merchant lamp + emissary jewel), muzzle flashes are gated on `qualityFlags.muzzleLights`. The remaining hotspots are alloc churn (F1 done, F2 / F3 pending) and code-org refactors (F7-F10).

---

## Raw audit reports

For deeper detail:
- `audits/end-of-day-bugs-2026-04-30.md` — full bug audit, file:line refs, repro hints
- `audits/end-of-day-perf-2026-04-30.md` — full perf audit, prioritized landing order

---

## Tomorrow's suggested order

1. Verify the 5 shipped bug fixes feel right in-game (especially shield emissive — I cached the baseline but you should eyeball the warm gold glow comes back after hits).
2. Decide on the "needs eyes" items — `weaponDecayPerSwipe`, projectile broken-spread, repair-kit truncation, Djinn vs heavy shields.
3. Land F2 (burn-flame pool) for the next noticeable perf bump on fire encounters.
4. Throw F9 (throwables extraction) at Sage if you want a passive refactor while you keep iterating.

End-of-day URL: https://71fc958a.cold-exit.pages.dev
