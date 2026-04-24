# tacticalrogue — design document

## Vision

Browser-based isometric roguelike extraction shooter for itch.io. John
Wick-inspired secret-society world; the player is an assassin / hired
gun taking escalating contracts against rival bosses or fetching
mission objects. Dark and gritty.

No backend, no multiplayer. All persistence is local-browser. Fast load,
deployable to itch.io as a zipped static site.

## Core loop

```
hideout → loadout → run → loot/fight → extract or die → meta progression
```

- **Hideout** is the between-runs hub: stash, shop, skill tree, artifact slots.
- **Loadout** = what you bring into a run. If you die, you lose it.
- **Run** = one level / contract. Proc-gen layout with enemies, loot, and a
  fixed extraction point.
- **Extraction** preserves the loadout + everything you picked up.
- **Death** strips the run's inventory but hands you a currency that funds
  permanent meta upgrades.

## Two-track progression

1. **Extracted gear** persists across runs as real items. Gets better as
   the player beats harder contracts.
2. **Meta currency** (earned on death or extraction) feeds the skill tree
   → permanent character upgrades that apply at run start.

The split keeps death meaningful without making runs feel disposable.

## Combat

**Ranged.** Isometric top-down aim; mouse picks direction. Weapons have
fire modes (semi/auto/burst), pellet count (shotguns), recoil
approximated as hip vs ADS spread. Tracers render live; hits deal damage
with optional status effects (bleed, burn, shock).

**Melee.** F-swipe toward the cursor. Dedicated melee enemies close
distance; melee weapons have combo chains with close/far variants
(close = wider arc, short lunge; far = tighter arc, long lunge). Combo
chain escalates damage, the 3rd step is a committed heavy.

> *The original slow-mo quadrant mini-game for melee (read the defensive
> stance, pick a quadrant to attack or dodge) was prototyped and shelved
> — "doesn't add enough and disrupts flow." Kept in memory for reference
> only.*

**Status effects.** bleed / broken / burn / shock / hidden / spotted —
tracked per entity, applied by specific attacks or gear.

**Slow-mo.** Reserved for dramatic beats (execution, certain perks),
not per-engagement.

## Items and inventory

**Slot-based anatomical inventory.** Equipment slots line a body
silhouette on a 4-column grid:

```
Left rail              Body              Right rail
head                                     (nothing)
face                                     backpack
ears                                     weapon1
shoulders                                weapon2
chest              [silhouette]          melee
arms                                     belt
hands                                    pants
                                         knees
                                         boots
```

**Backpack** is a flat list, capped by the equipped backpack's `pockets`
plus bonuses from gear.

**Action bar** (4 slots, bound to 5/6/7/8) holds direct references to
consumables still living in the backpack. Slot 4 unlocks when any
equipped gear has `actionSlotBonus: 1` (rolls on belts/chests by rarity).

**Item types:**
- `ranged` — goes in weapon1/weapon2
- `melee`  — goes in the melee slot
- `armor`  — contributes `reduction` in its slot
- `gear`   — contributes an `apply(stats)` function in its slot
- `consumable` — backpack-only, usable from action bar
- `attachment`  — backpack-only, socketed onto a weapon via its attachmentSlots
- `backpack` — sets `maxBackpack` capacity
- `junk`   — no effect, sells to merchants

## Rarity

`common < uncommon < rare < epic < legendary`

Weapons roll a rarity on pickup independently of the base tunable's
rarity floor; rarity scales damage, fire rate, mag size, head-shot
multiplier, and range. Higher rarity = more affix and perk slots rolled
on gear.

## Affixes

Random stat rolls on gear, similar to Diablo. Pool lives in
`src/inventory.js` — each affix has a `kind`, `roll()`, and `apply(value,
stats)`. Higher rarities roll more affixes (common = 0, legendary = 4).

## Set bonuses

A subset of affix rolls marks a gear piece as belonging to a named set
(Reaper / Gunslinger / Shadow / Warden). Set tiers activate at 2 and 4
equipped pieces — stacking powerful perks that encourage specialized
builds. Odds scale with rarity (common = 0% chance, legendary = 60%).

## Perks

Gear perks are discrete named effects (e.g. "Hydra Harness — dodges heal
10% HP"). Legendary gear rolls up to 3. Some are triggered (`onKill`,
`onRoomClear`) rather than passive.

## Artifacts

Run-long permanent buffs. Don't live in the inventory — acquiring one
just adds its ID to a `Set` the stat recomputer reads each frame. Sold
as scrolls by merchants. Examples: Iron Faith (+dmg reduction at high
HP), Bloodied Rosary (room-clear heal), Silver Tongue (−shop prices),
Obsidian Watch (+move speed).

## Class mastery

Each ranged weapon has a `class` (`pistol`, `smg`, `shotgun`, `rifle`,
`lmg`, `flame`) and melee has its own class. Kills with a class award
XP. Hitting thresholds (`[80, 200, 420, 800, 1500]`) unlocks a perk
that only fires while wielding a weapon of that class. Five tiers per
class; tier 5 is the capstone.

## Attachments

Per-weapon attachment points declared in the weapon tunable
(`attachmentSlots: [...]`). Slot → attachment type:

- `muzzle`     — compensator, suppressor
- `barrel`     — long / short barrel
- `sideRail`   — laser, flashlight, tactical light, strobe
- `underRail`  — vertical foregrip, bipod
- `topRail`    — red dot, reflex, holographic, scope
- `stock`      — heavy stock
- `grip`       — match grip
- `trigger`    — match trigger
- `magazine`   — extended mag, drum mag

Attachments carry a `modifier` dict merged into the weapon's effective
stats every fire (`effectiveWeapon(w)` in `src/attachments.js`). Light
attachments (`lightTier: 'basic' | 'tactical' | 'strobe'`) also project a
cone that blinds/dazzles enemies caught inside it.

## Skills (active abilities)

`src/skills.js` + `src/ui_skills.js`. On-cooldown active abilities the
player can hotkey. Distinct from gear perks (passive) and class mastery
(passive while wielding).

## Skill tree (meta)

`src/skill_tree.js` + `src/ui_skills.js`. Permanent character upgrades
purchased with death currency. Persists across runs. Feeds into the
same stat bag as perks / artifacts / gear.

## Loot and merchants

`LootManager` handles ground loot: items bob + rotate, glow by tint, are
pickuped via proximity + E. Merchants (`ui_shop.js`) convert junk to
credits and sell weapons / consumables / artifact scrolls. Prices scale
via the player's `shopPriceMult` stat (artifacts like Silver Tongue
reduce it).

## Customize UI

`ui_customize.js` + `weapon_layouts.js` — the per-weapon attachment
customization modal. Weapon class picks an SVG silhouette with
viewBox-coord slot anchors where the attachment cells overlay. A
future pass replaces the SVG silhouette with the pack's `_Side.png`
weapon art (see BACKLOG).

## Art direction — "The Continental"

Target mood: John Wick / Continental hotel world. Dark, sophisticated,
neon-punctuated. Shadows and spotlights; every location leans hotel,
nightclub, safehouse, parking garage, rainy alley, or rooftop. Glass,
polished marble, brushed metal, concrete, exposed brick, leather, tile,
black steel are the key materials. Color accents pull tan / burgundy /
blue-grey out of an otherwise deep-value palette.

### Rendering style: cel-shaded

All extracted meshes render through `src/gltf_cache.js` with a toon
material (3-step gradient map, hard bands) and an inverted-hull black
outline sibling mesh. The outline is a 1.025x back-face-culled clone
sharing the geometry; cheap enough to ship everywhere. Toggle at
runtime with `setCelShading(false)` to fall back to Standard material
for debugging.

Scene lighting (`src/scene.js`) is warm-tungsten key + cool-midnight
fill + cool rim from behind, with a very low hemisphere ambient so cel
bands read with deep shadows. Ground plane is deliberately dark
(`0x12141a`) to preserve the noir mood. Per-room **spotlights** cast a
defined warm pool at room centre with dark corners — crouch-in-shadow
vs stand-under-light is a real stealth gradient, not a 1.0→0.9 wash.

Post-processing (`src/postfx.js`) runs an EffectComposer pipeline:
`RenderPass → UnrealBloomPass (threshold 0.85 so only emissives bloom)
→ custom finisher (vignette + edge-biased chromatic aberration) →
OutputPass`. Gated on `qualityFlags.postFx`; low-quality mode skips
the composer.

### Assassin avatar system

Current state: **procedural primitive rig** (`src/actor_rig.js`).
Character is built from cylinders + joint spheres with sectional
gear colouring — hips / stomach / chest / neck / head / arms / legs
all driven by parametric `DEFAULT_DIMS`. The rig is shared between
player and enemies; faction variants just recolour segments. No
skinned-FBX character model in the shipping path.

The `Man_FullRig.fbx` / character-customisation-kit approach was
parked behind `window.__skinnedRig` — it's dormant code, blocked on
a bone-local-axis retargeter. Primitive rig is the art style we ship.

Aspirational customisation targets (per concept art) if art pipeline
catches up:
- **Gender:** male / female
- **Body types (M):** lean, athletic, heavy
- **Body types (F):** skinny, regular, athletic
- **Outfits:** bodysuits/tactical, yoga/athleisure, casual/street,
  motorcycle/leather, assassin formal (the suit), tactical/ops
- **Haircuts, face presets, beards, brows, accessories** (gloves,
  sunglasses, scarf, watch, jewelry, tactical gear)
- **Color accents:** dark brown / tan / burgundy / blue-grey — the
  Continental palette

### Enemy archetypes

From concept art (`enemy roster`):

| # | archetype | role | signature look |
|---|-----------|------|---------------|
| 1 | House Security | patrols, basic threats | plain suit, pistol/shotgun |
| 2 | Club Muscle | guards, close quarters | bouncer build, melee leanings |
| 3 | Tactical Operator | mid-difficulty ranged | plate carrier, rifle |
| 4 | Elite Assassin | mirror-match threat | suit + silenced pistol, your gear |
| 5 | Heavy Enforcer | armored tank | plate + LMG / shotgun |
| 6 | Recon Spotter | distant, info-heavy | ghillie / pant-coat, sniper |
| 7 | Blade Specialist | short-range melee | knife / machete / katana |
| 8 | Tech Specialist | utility / gadgets | drones, smoke, hacking tools |

**Behavior tiers:** Standard → Veteran → Elite (escalating HP, damage,
AI awareness, gear tier).

**Faction variants** (reskins + behavior tweaks): Continental Security,
Nightlife Syndicate, Tactical Cleanup Unit, Rival Assassin Agency.

Currently all enemies use the same character placeholder; archetype
differentiation is gameplay-only (HP, weapon, AI profile). Art pass
pending.

### Environments

From concept art (`environment concepts`): ten target location types —
luxury hotel lobby, penthouse suite, nightclub VIP area, backroom
safehouse, underground lounge, kitchen / BOH, service hallway, parking
garage, rooftop / helipad, rainy alley. Each has its own mood palette
(warm spotlit / cool toxic / neon chaotic / low intimate / harsh
industrial).

Level generation uses primitives today; replacing them with extracted
environment-pack FBX pieces is the next major art pass (see
`BACKLOG.md`).

### Art sourcing

**3D art:** animpic studio POLY packs (https://www.animpic.studio/).
Low-poly flat-shaded atlas-textured meshes. Cel shading in-engine moves
them toward the Continental style without requiring custom art.

**Icons:** animpic POLY UI pack tri-layer `_Clean` / `_Stroke` /
`_Underlay` PNGs. The cell renderer prefers `_Clean` (color) with
`onerror` fallback to `_Underlay` (silhouette). See `src/ui_item_cell.js`.

**Future custom art:** the concept art is the target the prototype
drives toward. Replacing animpic bodies with bespoke suit-assassin
characters is a M3 polish item.

## Tone checkpoints

- Assassin gear: tactical, military, minimalist
- No bright hero colors on the player
- Environment leans dim + moody
- Flavor copy in `ITEM_LORE` should feel noir / understated, not
  fantasy-cute. "Bandage" → "Field dressing. Won't stop a femoral."

## Milestones (high level)

| milestone | acceptance |
|-----------|-----------|
| M1 | Playable slice: 1 map, 1 melee + 2 guns, basic AI, extract/die, simple stash, both currencies |
| M2 | Systems expansion: multiple maps, armor tiers, attachments, crafting, deeper skill tree |
| M3 | Beta on itch.io: polish, tutorial, audio, balance, itch.io page assets |

Current state is "prototype ready to hand to friends" — heavy M1 with
most of M2 already landed: attachments, armor tiers, class mastery,
artifacts, meta skill tree, main menu + starting store + leaderboard,
post-FX + ambient audio + reverb, procedural rig, ragdoll-lite death
bodies, variant enemies (dasher / runner / coverSeeker / tank /
shieldedPistol) with boss-scaled attack frequency. See `BACKLOG.md`
for the full current-state delta and what's in flight.
