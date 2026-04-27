---
name: new-relic
description: Add a new relic (artifact) to Cold Exit — wire the def, hook the effect into recomputeStats or a trigger site, and (optionally) plug it into the shop / synth chain.
model: inherit
---

# Adding a new relic

Relics are permanent run modifiers. Acquiring one adds its id to `artifacts.owned`; `recomputeStats()` walks the set every dirty-tick and lets each def's `apply(s)` mutate `derivedStats`. Trigger-based relics (kill / hit / room-clear / etc.) are listed here too but their effect lives in the trigger callsite, not `apply`.

## What I need from the user

- **Name** (display + flavour) — e.g. "Bloody Mag"
- **Lore** — one-sentence flavour, John Wick assassin tone
- **Tagline / short** — what the player reads in the shop card (one short clause)
- **Effect** — what it actually does mechanically
- **Price** (optional) — shop cost in credits; default 4400-5400 for normal relics, omit for synths

If any of these are missing, ask for them before writing code.

## Step-by-step

### 1. Add the def — `src/artifacts.js`

`ARTIFACT_DEFS` starts at line 6. Insert the new entry near related ones (movement-themed near `obsidian_watch`, damage-themed near `cracked_lens`, etc.) — order is purely organisational.

Required fields: `id`, `name`, `lore`, `short`, `tint`, `price`, `apply(s)`. Optional: `trigger` (string tag the effect site reads), `synthetic` (bool — hidden from shops, only acquired via chain).

Example — passive stat relic:

```js
swift_shadows: {
  id: 'swift_shadows', name: 'Swift Shadows',
  lore: 'A black silk veil. Whoever wears it leaves no footprint worth following.',
  short: '+15% move speed while crouched, −20% sound radius',
  tint: 0x1a1018,
  price: 4600,
  apply(s) {
    s.crouchMoveMult = (s.crouchMoveMult || 1) * 1.15;
    s.soundRadiusMult = (s.soundRadiusMult || 1) * 0.80;
  },
},
```

Example — trigger-based relic (no `apply`):

```js
red_string: {
  id: 'red_string', name: 'Red String',
  lore: '...',
  short: 'Kills grant +50% dmg for 4s',
  tint: 0xff4040,
  price: 4200,
  apply(_s) { /* trigger-based — see onEnemyKilled */ },
  trigger: 'kill',
},
```

### 2. Wire the effect

**Passive stat-bag effect** — already done by `apply(s)`. Make sure the field you're mutating on `s` exists in `BASE_STATS()` (or initialize it with `(s.foo || 0)` / `(s.foo || 1)` like the example). `recomputeStats` is called automatically on artifact acquire and every meaningful state change. No extra wiring needed.

**Trigger effect** — the `apply` body stays empty/_-prefixed; the actual effect lives at the relevant call site. Examples to model:

- `'kill'` — `onEnemyKilled` in `src/main.js` (grep `artifacts.has('red_string')`)
- `'roomClear'` — `roomClearHealFrac` consumer (grep `roomClearHealFrac`)
- on-hit ranged — `applyHit` callsite that checks `artifacts.has('vampires_mark')`
- on melee hit — quick-melee + combo paths (grep `bloody_mag` or `oneInChamberActive`)

When adding a new trigger pattern, branch on `artifacts.has('<id>')` at the relevant moment. Keep the effect colocated with whatever event already fires there — don't introduce a second event bus.

### 3. (Optional) Synth chain

If the relic is the synthesis of two others, mark it `synthetic: true` and add an auto-grant in `ArtifactCollection.acquire` (line 293 of `artifacts.js`). Pattern:

```js
if ((id === 'opening_act' || id === 'closing_act')
    && this.owned.has('opening_act')
    && this.owned.has('closing_act')
    && !this.owned.has('magnum_opus')) {
  this.owned.add('magnum_opus');
}
```

Synthetics also need to be excluded from shop pools (already handled by the `synthetic` flag downstream — verify by grepping the field).

### 4. Verify

- Pickup the relic via dev save or in-game → confirm the effect activates.
- Grep `'<id>'` in `src/main.js` to confirm the trigger site is wired (if applicable).
- For shop relics, confirm the price reads correctly and the card shows the `short` text.

### 5. Ship

Per `feedback_ship_iterate.md`: in polish phase, commit + deploy directly, no multi-bullet plan. Use the standard deploy:

```
npx wrangler pages deploy . --project-name=cold-exit --commit-dirty=true
```

## Stats bag fields cheat-sheet

Common fields on `derivedStats` you can mutate in `apply(s)` — grep `BASE_STATS` in `src/main.js` for the canonical list. Multipliers default to `1`; bonuses default to `0`.

- `s.maxHealthBonus`, `s.maxHealthMult`, `s.healthRegenMult`
- `s.moveSpeedMult`, `s.crouchMoveMult`, `s.staminaMult`, `s.staminaRegenMult`
- `s.critChance`, `s.critDamageMult`
- `s.meleeDmgMult`, `s.executeRangeBonus`
- `s.creditDropMult`, `s.shopPriceMult`, `s.mythicDropChanceFloor`
- `s.hearingRange`, `s.hearingAlpha`
- `s.lifestealMeleePercent`, `s.lifestealRangedPercent`
- `s.incomingDmgMult`, `s.highHpReduction`
- `s.appliesBurnOnHit`, `s.burnDurationBonus`
- `s.goldenBulletChance`, `s.berserkBonus`

If a relic introduces a brand-new field, add it to `BASE_STATS()` with a sane default so other consumers don't have to null-check.
