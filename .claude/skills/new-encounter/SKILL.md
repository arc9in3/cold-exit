---
name: new-encounter
description: Add a new encounter to Cold Exit — wire the def into ENCOUNTER_DEFS, add any helpers to the ctx factory, and confirm it spawns + completes correctly.
model: inherit
---

# Adding a new encounter

Encounters are special rooms (NPCs, traders, riddles, hazards). Each level has one shot at rolling an encounter; the picked def is invoked via `def.spawn(scene, room, ctx)` once, then `def.tick(dt, ctx)` every frame, with `def.interact(ctx)` on E-press and optional `def.onItemDropped(item, ctx)` for trade-style encounters.

## What I need from the user

- **id** (snake_case, unique) — e.g. `the_crow`
- **name** (display) — e.g. "The Crow"
- **What does it look like?** — primitive shape (NPC / animal / object / floor disc)
- **Trigger / interaction** — E-press dialog? Drop-an-item trade? Passive (just exists)?
- **Reward / outcome** — what does the player get?
- **Once-per-save?** — most special trades are; recurring ones (Priest) are not

If any of these are missing, ask before writing code.

## Step-by-step

### 1. Add the def — `src/encounters.js`

`ENCOUNTER_DEFS` starts at line 408. Insert the new entry near related ones (trade-style near `the_crow`, NPC dialog near `priest`, riddle/quiz near `royal_emissary`).

Skeleton:

```js
my_encounter: {
  id: 'my_encounter',
  name: 'My Encounter',
  floorColor: 0xa080d0,            // accent disc colour
  oncePerSave: true,                // false for recurring
  condition: (state) => state.levelIndex >= 2,   // optional gating
  spawn(scene, room, ctx) {
    const disc = _spawnFloorDisc(scene, room, this.floorColor);
    // build primitives (Three.js Group/Mesh)…
    scene.add(myGroup);
    const label = _makeLabelSprite('NAME', '#color');
    label.position.set(disc.cx, 1.6, disc.cz);
    scene.add(label);
    return { myGroup, label, disc, complete: false };   // becomes ctx.state
  },
  tick(dt, ctx) {
    const s = ctx.state;
    if (!s.myGroup || s.complete) return;
    // idle bob, particles, etc.
  },
  interact(ctx) {
    // E-press path: speech bubble, prompt, branching choice.
    // For prompt-based encounters use ctx.showPrompt + ctx.closePrompt.
  },
  onItemDropped(item, ctx) {
    // Trade-style: return { consume: true, complete: true } to consume
    // the dropped item and mark the encounter done. Return
    // { consume: false } to reject.
    return { consume: false };
  },
},
```

For drop-trade encounters, mirror The Crow (`the_crow:` ~line 2842):

```js
onItemDropped(item, ctx) {
  const s = ctx.state;
  if (s.complete || !item) return { consume: false };
  if (item.type !== 'backpack') return { consume: false };
  if (item._encounter) {
    ctx.spawnSpeech(s.bird.position.clone().setY(1.6),
      'Caw! Too fancy for me.', 4.0);
    return { consume: false };
  }
  const reward = ctx.pickBiggerBackpack && ctx.pickBiggerBackpack(item.pockets | 0);
  if (!reward) {
    ctx.spawnSpeech(s.bird.position.clone().setY(1.6),
      'Caw! Bring me something smaller.', 4.0);
    return { consume: false };
  }
  s.complete = true;
  ctx.spawnSpeech(s.bird.position.clone().setY(1.6),
    'Caw! A fair trade.', 4.5);
  ctx.spawnLoot(s.disc.cx + 0.8, s.disc.cz, reward);
  if (ctx.markEncounterComplete) ctx.markEncounterComplete('the_crow');
  return { consume: true, complete: true };
},
```

### 2. Wire any helpers — ctx factory in `src/main.js`

The ctx factory starts at `_ctxFactory` (~line 1938) and exposes the API encounters call into. Most encounters reuse existing helpers — check this list first before adding a new one:

- `ctx.spawnSpeech(worldPos, text, life)` — speech bubble (~line 1948)
- `ctx.spawnLoot(x, z, item)` — drop loot at XZ (~line 1954)
- `ctx.markEncounterComplete(id)` — adds to `_runCompletedEncounters` (~line 2164)
- `ctx.showPrompt(text, choices)` / `ctx.closePrompt()` — modal dialog
- `ctx.runStats` — read/write run-state counters (priestRefusals, hasDemonBear, etc.)
- `ctx.playerHeal(amount)` — direct HP heal
- `ctx.awardPlayerCredits(n)` — gold to wallet
- `ctx.awardChips(n)` — meta currency
- `ctx.sellPriceFor(item)` — gold value lookup
- `ctx.spawnDemonBear(x, z)` — Demon Bear toy on floor
- `ctx.makeMagicalPack()` — Travel Buddy reward
- `ctx.pickBiggerBackpack(currentPockets)` — Crow reward
- `ctx.rollRandomWeapon()` — non-mythic weapon for trades

If you need something new (e.g. "spawn a fresh consumable from this id"), add it to the ctx factory near the related helpers (~line 2090-2200) with a one-line comment explaining what consumes it.

### 3. (Optional) Encounter-only items

If the reward is an item that should NEVER appear in random loot pools, mark it `_encounter: true` in its def. Existing consumers in `src/inventory.js` filter on this flag (`_RANDOM_TOY_POOL`, `ALL_ARMOR/ALL_GEAR`, `_RANDOM_CONSUMABLE_POOL`).

### 4. (Optional) Run-state flags

For cross-encounter logic (e.g. "the third refusal unlocks a new merchant"), add the counter to `runStats` (`src/leaderboard.js` reset block + initial declaration in main.js). Read/write through `ctx.runStats`.

### 5. Verify

- Encounter chance is currently pinned at 100% (`level._encounterChance = 1.0` in `regenerateLevel`) for fast iteration — every level should roll an encounter.
- Walk into the disc → confirm spawn primitives appear.
- Run interact / drop path → confirm reward triggers and `markEncounterComplete` runs.
- Re-enter the level (or restart) → confirm `oncePerSave` keeps it from re-rolling.

### 6. Ship

Per `feedback_ship_iterate.md`: commit + deploy directly.

```
npx wrangler pages deploy . --project-name=cold-exit --commit-dirty=true
```

## Reference encounters by pattern

- **Trade (drop item → reward):** `the_crow` (2842), `travel_buddy` (2751), `brethren` (3022)
- **Recurring NPC dialog:** `priest` (2942)
- **Reflex/skill challenge:** `hoop_dreams` (2600)
- **Door/seal puzzle:** grep `royal_emissary`
- **Active hazard:** grep `glass_case` or `the_button`

When in doubt, copy the closest match and edit — the def shape is consistent across all of them.
