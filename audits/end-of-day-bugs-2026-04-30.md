# End-of-day bug audit — 2026-04-30

Walk of the 41 commits the user shipped today. Findings split into
confirmed bugs, suspected/needs-eyes, and clean-pass.

---

## (a) Confirmed bugs

### 1. Djinn's Blessing orb fires through shielded targets, fakes damage numbers
`src/main.js` `_fireDjinnShot` (~line 5560-5593)

The Djinn orb shot calls `hit.owner.manager.applyHit(...)` without
passing `shieldBreaker: true`. When the orb shot lands on a shielded
gunman / melee enemy, the manager returns
`{ shieldHit: true, shieldDamage: 0 }` — the body takes no damage.
But `_fireDjinnShot` ignores the return value entirely and calls:

```js
runStats.addDamage(dmg);                             // inflates run stats
spawnDamageNumber(endPoint, camera, dmg, hit.zone, ...); // shows fake damage
```

So the player sees e.g. "12" pop off a shielded enemy that took 0
damage, and run-stat damage totals get padded. The main bullet path
in fireOneShot (line 5993-6004) DOES short-circuit on `shieldHit`;
the orb path never got the same treatment.

Repro: take Djinn's Blessing → fire any non-magnum-class weapon at a
heavy/full-block shield → orb shot pops a damage number while the
shield panel ate it.

### 2. Shield emissive permanently destroyed after first hit
`src/gunman.js` ~lines 1113-1122 and `src/melee_enemy.js` ~lines 523-530
(commit d2ca421 — shield-block flash)

The shield mesh is built with a baseline emissive color (`0x0a1420`
for full / `0x14100a` for partial — see gunman.js line 297). The new
flash code does:

```js
mat.emissive.setRGB(k * 0.9, k * 0.85, k * 0.6);
```

with NO baseline cache and NO restore step. When `flashT` decays to
0, this writes `(0, 0, 0)` into emissive every tick — permanently
clobbering the baked-in tint. After the first absorbed shot, the
shield reads slightly darker than at spawn for the rest of the run.

Same mistake in both files. Fix: cache the original emissive at
shield construction (`g.shield._baseEmissive = mat.emissive.clone()`)
and lerp from baseline → spark instead of overwriting.

### 3. `window.__derivedStats` published before modifiers are applied
`src/main.js` `recomputeStats` (line 4313-4328)

```js
function recomputeStats() {
  derivedStats = BASE_STATS();
  if (typeof window !== 'undefined') window.__derivedStats = derivedStats;  // ← published EMPTY
  // ... then skills, inventory, perks, skillTree, artifacts, buffs, trainer all apply
}
```

The reference is the same object so the bag will eventually be fully
populated, but for the duration of the call any external read sees
partial data. The repair-kit path in `Inventory.applyRepairKit` reads
`window.__derivedStats.repairKitPotency` — if a repair-kit drag-drop
fires synchronously inside a render that ran during recompute (e.g.
recompute → bump → reactive UI render path), it could read the
half-populated bag. Fix: assign at the end of recompute, not at the
start.

Severity: low (repair-kit applies synchronously from user input
which is unlikely to land mid-recompute), but the failure mode is
silent and intermittent.

### 4. Brian's Hat sells normally — `_encounter` flag does NOT block sale
Commit ad088d8 title says "flag Brian's Hat as encounter-only so it
can't drop or sell" but the diff only adds the flag to ARMOR_DEFS and
relies on the `ALL_ARMOR.filter(d => !d._encounter)` gate
(`src/inventory.js` line 1828) — that gate keeps it out of random
drop pools. There is **no** sell-side filter for `_encounter`. Grep
confirms: `sellPriceFor` in `src/ui_shop.js` (line 163-177) doesn't
look at `_encounter` at all.

So the player can pick up Brian's Hat from the encounter, walk to a
shop, and sell it for the gear-rarity price. The commit message
oversold the fix.

Repro: trigger Brian → "how much was the hat" → pick up the hat →
visit a shop → sell at full price.

### 5. CnC walk-away path doesn't set `s.needsTick = false`
`src/encounters.js` line 2049-2073 (the walk-away branch)

Compare to the both-killed branch (line 2144) and aftermath-returned
branch (line 2178), which both set `s.needsTick = false` to let the
encounter framework early-out from this frame onward. The walk-away
branch sets `s.complete = true` but leaves `needsTick` unset, so the
encounter keeps ticking forever even though the standoff is resolved.

Inside the standoff phase, the next tick will re-enter the walk-away
check (`gunman.alive && kneeler.alive` → both `false` now, so the
condition fails) AND the both-dead branch (also fails because
`!gAlive && !kAlive` is true but those are dummies, not corpses being
re-killed... actually wait, they get marked alive=false in the
walk-away path so this branch DOES fire and tries to mark complete
again). Adding `s.needsTick = false` to the walk-away branch matches
the other terminal paths and avoids the redundant tick.

### 6. `weaponDecayPerSwipe` is dead — melee weapons never break
`src/tunables.js` defines `durability.weaponDecayPerSwipe: 0.02` but
`grep weaponDecayPerSwipe` across the entire `src/` tree returns no
hits. Melee weapons have a durability bar but no decay site reads
this tunable, so a melee weapon's durability never decreases. The
broken-melee softening in commit 92947a3 still works for any melee
weapon that gets to 0 by some other path (e.g. spawned at 0), but
nothing drives them there.

This isn't a regression from today's commits — it's a pre-existing
hole the durability cherry-pick didn't address.

### 7. Damage-number lies on Djinn shot crit through shield
Same root cause as bug #1, but worth calling out separately: when
the orb crits a shielded target, the rendered damage number is the
crit-multiplied number (and the crit pop animation triggers), even
though the shield ate the entire shot.

---

## (b) Suspected — needs your eyes

### s1. `Inventory.applyRepairKit` truncates fractional durability on every use
`src/inventory.js` line 2206-2218

```js
const cur = target.durability.current | 0;       // truncates
...
target.durability.current = Math.min(max, cur + amount);
```

`current` is replaced with the truncated cur + amount, throwing away
up to ~0.99 of accumulated fractional durability. Each repair-kit
application leaks slightly. For a weapon at current=49.7,
applying a 15% kit on max=200 gives current = 49 + 30 = 79, not
49.7 + 30 = 79.7. Probably imperceptible in play, but the commit
message in acc4e65 didn't call this out and it's a small
accumulating bug.

Easy fix: drop the `| 0` and use the raw `current`.

### s2. `firePlayerProjectile` skips broken-spread and doesn't respect Brass Prisoner extra cost when `freeShot`
- Broken weapon with massively inflated spread (commit 92947a3) is
  applied in `fireOneShot` only. `firePlayerProjectile` (rocket /
  grenade launcher path) and `tickFlame` (flamethrower) get no
  spread penalty when broken. The flamethrower has no spread so
  this is a no-op there, but launchers fire perfectly straight even
  at 0 durability. Whether this is intentional is a design call —
  flagging because the commit message reads "broken ranged weapon
  fires with massively inflated spread" without qualifying that
  it's only the bullet path.
- Brass Prisoner ammo penalty: `fireOneShot` skips the extra round
  drain on `freeShot` (Scavenger's Eye). The launcher path doesn't
  thread `freeShot` (line 5300-5303), so a Scavenger's Eye proc on
  a launcher under the curse still loses 1 ammo. Probably fine
  because launchers are rarely the active weapon when Scavenger's
  Eye is relevant, but the asymmetry is real.

### s3. Repair kits land in the body-loot pile but `_bodyApplyRepairKit` never reads `repairKitPotency` mult from skills
`src/ui_loot.js` `_bodyApplyRepairKit` (line 39-65)

The body-side path reads `window.__derivedStats.repairKitPotency`,
but if `__derivedStats` hasn't been published yet (very early in
boot, before the first `recomputeStats` fires), the body path
silently uses mult=1 — same skip the inventory-side path does. Not
a hot-path bug but if a player drags a repair kit out of body loot
on the very first frame after a death, they'd lose the potency
bonus. Low severity.

### s4. Heavy shield + Djinn shot: Djinn orb cannot break a heavy shield
Per commit 5a40189, heavy/full-block shields are bullet-immune
unless `shieldBreaker: true`. The orb does NOT pass shieldBreaker
even when the player's main weapon is one of the breaker SR-50s.
Probably intentional (the orb is at 25% damage, not a magnum
caliber), but worth confirming. Pairs with bug #1's damage-number
lie.

### s5. Shop tile may show a stale paperdoll when `setStarterInventory` order matters
`src/ui_hideout.js` `_buyStorePiece` (line 866-881)

The replacement-warning flow:
```js
const next = queue.filter(q => !(q && q.__storeArmor && q.slot === slot.armorSlot));
setStarterInventory(next);
```
Then later:
```js
if (this.ctx.spendChips && this.ctx.spendChips(slot.price))
// materialize + queue (via existing path)
```

If `spendChips` fails (insufficient funds), the queue is already
mutated to drop the previous entry but no rollback fires. Net
effect: the player declined the confirm dialog or had their chips
deducted then refunded, but the previously-queued armor is gone.

Need to verify what `spendChips` does on failure — if it short-
circuits before materializing the new piece, the player effectively
lost their queued armor. Likely fine in practice (the chip-check
runs after the confirm dialog, and rejecting the dialog returns
before the filter), but the `existing` filter happens BEFORE the
spendChips call, so a mid-flow chip failure leaves a hole.

Trivial repro test: queue a chest, drop chips below the price of a
second chest, click buy, accept the confirm — does the original
chest survive? Probably needs to be tried to know.

### s6. Brian's Hat's `apply(s)` hook isn't on the gear-apply path
`src/inventory.js` line 1037-1041:
```js
brians_hat: { ... apply(s) { s.fireResist = (s.fireResist || 0) + 0.9; } },
```

Most armor entries don't have an `apply` hook — they expose effects
through `reduction` or other declarative fields the equip system
reads. Brian's Hat has only an `apply` hook + a `fireResist` push.
Verify the equipped-gear pass in `inventory.applyTo` actually calls
`item.apply(s)` for armor/gear items. If it only calls `apply` for
relics, the hat's 90% fire resistance is dead.

(Quick spot-check would be running a fire encounter with the hat
equipped and seeing if the fire DPS reduction lands.)

### s7. Recompute order: `recomputeStats` exposed before `_applyTrainerUnlocks` runs
Same root as bug #3, but worth noting: anyone reading the bag
between `BASE_STATS()` (line 4314) and `_applyTrainerUnlocks` (line
4328) sees Trainer HP, stamina-regen, and stagger-duration unset.
For Trainer specifically, the player's max HP after a recompute
without `applyDerivedStats` running afterward (e.g. mid-frame
recompute fired by some callback) would briefly show an unbumped
value. The 5 run-start paths the user just fixed correctly call
`applyDerivedStats` immediately after `recomputeStats`, so this is
mostly closed — just keep an eye on any new caller that runs
recompute without applying.

---

## (c) Clean — checked and looks good

- **Cursed-chest auto-grant** (commit 4130b47 + 574a64c): the
  `autoCurseRelic` check at `src/main.js` line 9290-9301 fires
  before the lootUI.open path. Player can't browse and bail —
  opening the wrong chest applies the curse immediately. The
  RELIC ACQUIRED toast falls back to def.name → artifactId so the
  "undefined" bug is gone.
- **Choices and Consequences NPC lock** (commit 30dd56c + 2662f02):
  all four resolution paths (kill gunman, kill kneeler, kill both,
  walk away) set `keepDead = true` on the corpse(s). The dummies
  manager's hittables() filter on `unhittable` (enemy.js line 67)
  keeps survivors visible-but-bullet-immune. `markEncounterComplete`
  fires on each terminal path. `dummies.removeAll()` in regen
  cleans up the actors so they don't leak across floors.
- **Priest persistence** (commit ae09a2b): `getPriestRefusals()`
  reads from localStorage so refusals survive death/extract. The
  third-no condition flips both `setDemonBearGranted(true)` AND
  `runStats.hasDemonBear = true` in the same transaction, so
  subsequent encounter spawn checks (which OR both flags) fire
  correctly mid-run. The `runStats.reset` mirror on run start
  copies the persistent flag back into the per-run field, so
  in-run code paths (Great Bear's Pain trade) read it without a
  reload.
- **Spaces Inbetween → Want to Play chain** (commit f0d6edb): the
  bike id matches between drop site
  (`JUNK_DEFS.shittyBike` → `id: 'junk_shitty_bike'`) and check
  site (`item.id === 'junk_shitty_bike' || item.name === 'Shitty Bike'`).
  Both encounters live as separate one-shots and either order
  works.
- **Pre-mission armor auto-equip** (commit 506d437): displaces
  baseline gear correctly. recomputeStats + applyDerivedStats fire
  after the loop, so armor-bonus stats reach the player state
  before frame 1 of the run.
- **Trainer HP + run-start heal** (commit 2a3038e): all 5 run-start
  paths now call `applyDerivedStats` between `recomputeStats` and
  `restoreFullHealth`, fixing the stale-max bug. Trainer's
  vit_1/vit_2/vit_3 stack additive (+10 each), which matches the
  commit's intent.
- **Tracer per-pellet range** (commit 96c2c52): straightforward —
  endpoint reads `_pelletRange` instead of `effRange`, no other
  state touched.
- **Drop zone-center aim snap** (commit 5ac60ce): pure removal of
  the snap-to-zone-center block. Bullet trajectory now follows the
  cursor's surface intersection. Shield interception fixed as a
  side effect (the snap was sailing bullets past the shield to the
  head world-center). Magnetism-on-impact still snaps the visual
  endpoint to mesh center for clean blood/numbers.
- **Bookshelves flush against wall** (commit 8952c8d): new
  `placeBackToWall` placer uses `col.d/2 + 0.05`. Symmetric box
  collision proxies render correctly; asymmetric props would offset
  oddly but bookshelves are symmetric so it's fine.
- **Brass Prisoner ammo retune** (commit 4130b47): all three sites
  (`tickFlame` ammo, `firePlayerProjectile`, `fireOneShot`) now
  decrement by 1 (not 2) so the curse total is 2 rounds per pull,
  matching the new "every shot drains 2 bullets" tooltip.
- **Rank-points system** (commit 920ae05): `awardRankPoints` rolls
  overflow into rank-ups via a while loop, so a single fat reward
  can bump multiple ranks. Both claim sites (in-mission +
  hideout-claim) thread through `awardRankPoints(rankRewardFor(def))`
  and re-read `getContractRank()` before/after to detect rank
  bumps for the toast. tryClaimContract's `bumpRankFn` now calls
  `awardRankPoints` instead of the old hard +1 — the contract
  rank only changes when the cost was actually paid.
- **Repair-kit drag-drop intercepts** (commit acc4e65): inventory
  grid + paperdoll slot + body-loot grid + body-loot paperdoll all
  intercept `item.type === 'repairkit'` and call applyRepairKit
  before the move-to-grid path. Stack-merge guard prevents
  rarities mixing in one stack.
- **Patcher / Charlene → Covetous chain** (commit acc4e65): the
  `acquire` synth-grant in artifacts.js mirrors the
  Opening/Closing → Magnum Opus shape. All 3 weapon-decay sites
  + the armor-decay loop check `indestructible*` and apply the
  per-mult.
- **Durability HUD** (commit 240b793): tick fires on both the
  paused (modal-open) and active branches, so a repaired item's
  glyph flips immediately. 5Hz throttle, opacity diff, no
  per-frame DOM thrash.
- **stunDur ReferenceError** (commit 70789a1): straightforward
  — `stunDur` declaration added to match the parallel `flashDur`
  branch.

---

## Notes

- The user's brief said "verify the 4 weapon-decay sites" but I
  only found 3 (`tickFlame`, `firePlayerProjectile`,
  `fireOneShot`). The shotgun pellet path is inside `fireOneShot`
  and decays once per trigger pull, not per pellet — so 3 sites
  is correct, the commit message just miscounted.
- The Djinn orb is currently treated as a "free shot" (no ammo
  cost, no recoil contribution, no Brass Prisoner toll). Whether
  it should pay the curse toll is a design call worth surfacing
  to the user.
- "Brian's Hat" sellability bug (#4) is the only one that's
  obviously player-facing — players can farm chips by triggering
  Brian and selling the hat. Recommend a sell-path filter on
  `_encounter` flag to fix all encounter-flagged items
  (Beary Doll, Demon Bear, Shitty Bike, Unused Rocket Ticket,
  etc.) at once. Some of those have low sellValue but a few
  (Beary Doll = 1900c) are non-trivial.
