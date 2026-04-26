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
(`attachmentSlots: [...]`). 50 attachments across 8 slots, type-rooted
by category — each slot exists for one design reason.

| slot | role | variants |
|------|------|----------|
| `muzzle` (brakes) | spread + recoil control | Compensator, A2 Birdcage, AK Brake, Sniper Brake, Linear Comp, Flash Hider (short / long) |
| `muzzle` (suppressors) | noise reduction (`noiseRangeMult`) trading damage / spread | Short, Standard, Long, QD, Fluted, Osprey, Tactical |
| `barrel` | range / RoF / accuracy | Long, Short, Match |
| `sideRail` (lasers) | hipfire spread reduction | Red (10m), Green (18m), Blue (28m), Pistol Laser |
| `sideRail` (lights) | blind/dazzle enemies (rarity scales BOTH duration AND magnitude) | Flashlight (utility), Tactical Light, Strobe |
| `underRail` | spread + bracing | Vertical / Angled / Stubby foregrip, Canted grip, Bipod |
| `topRail` (sights) | ADS frustum push-in (`sightZoom`) + drag distance (`adsPeekBonus`) | Iron (1.05× default), Red Dot / Reflex (1.10×), Holo (1.15×), Mid Scope (1.20×, +3m drag), Long Scope (1.30×, +6m drag) |
| `stock` | ADS spread vs mobility | Heavy, Skeleton, CQB, Folding, Crane |
| `grip` (pistol grip) | spread / reload / recovery | Match, Stippled, Skeleton, Rubberized |
| `trigger` | fire rate | Match, Adjustable |
| `magazine` | capacity vs reload | Extended, Drum, Banana, Fast |

Attachments carry a `modifier` dict merged into the weapon's effective
stats by `effectiveWeapon(w)` in `src/attachments.js`. New modifier
fields beyond the original spread/damage/rate set:

- `noiseRangeMult` — multiplies AI hearing radius. Suppressed shots
  use 0.20–0.50 of the baseline 22m alert.
- `blindSpreadMul` / `dazzleSpreadMul` — when a light cone hits an
  enemy, these stash on the enemy and the shoot path inflates spread
  by that factor. Strobe (dazzle) reads worse than tac light (blind).

**Rarity rolls** (`_scaleModifierByRarity`) use a per-field
`GOOD_WHEN` policy: benefits amplify away from 1.0 (e.g. legendary
suppressor noise drops further); tradeoffs *soften toward* 1.0 (e.g.
a legendary suppressor's damage penalty is smaller than a common
one's). Reductions floor at 0.1. Light durations + magnitudes scale
proportionally so a legendary tac light blinds longer AND wrecks
enemy aim harder.

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
customization modal. When a weapon has a side-view PNG render
registered in `WEAPON_RENDER_BY_NAME` (every weapon today does), the
layout's procedural class SVG is replaced with an `<image>` tag
pointing at the same PNG used by the inventory icon. Slot positions
remain class-based (canonical positions on the 600×260 viewBox) so
muscle memory stays stable while the silhouette changes per weapon.

Per-weapon slot overrides are exportable from
`tools/weapon_assigner.html` (drag the dashed slot squares in the
fullscreen pose modal); a future pass wires
`WEAPON_SLOT_OVERRIDES_BY_NAME` into `layoutForWeapon`.

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

**3D art:**
- animpic studio POLY packs (https://www.animpic.studio/) — low-poly
  flat-shaded atlas-textured meshes for medical / consumables /
  characters / props / many weapons + accessories.
- lowpolyguns pack — 40 weapon FBXes + 15 accessory FBXes with
  embedded per-material diffuse colors (no shared atlas). Used for
  the AK-pattern rifles, bullpups, revolvers, shotguns, snipers,
  Spectre SMGs, and many silencers / scopes / grips.

Cel shading in-engine (`src/gltf_cache.js`, toon material + inverted-
hull outline) brings both families into the same Continental style.

**Weapon icons + attachment-screen art:** every in-game weapon has a
side-view 512×288 PNG render in `Assets/UI/weapon_renders/` (generated
by `tools/weapon_assigner.html`). `iconForItem` returns the render
path for ranged + melee weapons; `layoutForWeapon` embeds the same
PNG as an `<image>` in the customize modal. Same silhouette
everywhere = consistent identity for the player.

**Equipment / consumable / junk thumbnails:** procedural Three.js
scenes in `src/item_thumbnails.js`, snapshotted to data URLs and
cached. Pants / chest rigs / gloves / boots / backpack use capsules
+ tapered cylinders + spheres + tori (no boxy stand-ins). Generic
junk shares a tinted canvas-pouch silhouette; distinctive items get
per-id custom builders (rings, skulls, vases, walkie-talkies, field
radios, batteries, scrap piles, bag of peas, rocket tickets, fancy
alcohol bottles, biscuit stacks).

**Stock icons:** animpic POLY UI pack tri-layer `_Clean` / `_Stroke`
/ `_Underlay` PNGs. The cell renderer prefers `_Clean` with
`onerror` fallback to `_Underlay`. Used as a fallback when no render
PNG is registered. See `src/ui_item_cell.js`.

**Future custom art:** the concept art is the target the prototype
drives toward. Replacing animpic / lowpolyguns bodies with bespoke
suit-assassin characters is a M3 polish item.

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
most of M2 already landed: 53-weapon roster with real-world
identities and side-view PNG renders driving icon + attachment
screen, 50-attachment system with type-rooted bonuses + rarity-scaled
magnitude, armor tiers, class mastery, artifacts, meta skill tree,
main menu + starting store + leaderboard (Worker live), post-FX +
ambient audio + reverb, procedural rig, ragdoll-lite death bodies,
variant enemies (dasher / runner / coverSeeker / tank / shieldedPistol
/ shield-bearer melee) with boss-scaled attack frequency, hidden
ambush rooms, doorway-choke AI awareness with 50-line bark pool. See
`BACKLOG.md` for the full current-state delta and what's in flight.
