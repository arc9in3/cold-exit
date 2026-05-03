## Cold Exit — agency / director / recruiter / special mercs concept

### Premise

You run an extraction agency. Hire agents, send them on contracts, they earn you **chips** and **marks**. Spend the income on:

- Hideout upgrades
- Better recruits from the **recruiter**
- Armor + outfitting from the armory
- Trainer head-starts (skills, perks)

Permadeath in the field is fine — agents are employees, not avatars. You always have more.

### The director (faceless persona)

The "main character" the player relates to is **the director** — them, in the chair, running the agency.

- **Voice only.** Radio-comms briefings, after-action lines, agent-died acknowledgments. ~100 lines covers a year of play.
- **A chair, not a portrait.** The director's office shows a high-backed swivel chair facing away from camera. Smoke. A tumbler. The PLAYER projects themselves into the chair.
- **Player-named.** First-time setup picks a director codename (default: "Director").
- **Backstory: disgraced operator.** Was on the boards. Got blacklisted. Now they run agents because they can't run themselves. Explains why the director knows contracts intimately and can call in old favors.

### Recruiter — "Hire a Recruit"

NPC in the hideout. Booth + screens + files. Daily rotating roster of 3 cards:

```
┌──────────────────────────────────────┐
│  RECRUITER                           │
│  "I've got three live ones today."   │
│                                      │
│  ┌─────────┐  ┌─────────┐  ┌──────┐ │
│  │ AGENT A │  │ AGENT B │  │ MERC │ │
│  │ portrait│  │ portrait│  │  !   │ │
│  │ (random)│  │ (random)│  │ rare │ │
│  └─────────┘  └─────────┘  └──────┘ │
│                                      │
│  [Refresh roster — 50 chips]         │
└──────────────────────────────────────┘
```

Each card:
- Codename (procgen: "Cobalt", "Reefer", "Static")
- Portrait (procgen primitive-rig face → 256px sprite)
- Class (assault / recon / breacher / medic / heavy)
- 3 visible stat bars (aim / mobility / nerve)
- Quirk (1-2 line flavor)
- Hire price in chips
- Contract type (5 missions / 10 / lifetime — temp work)

**Slot rules:**
- Slot 1 — always low tier (first-floor fodder)
- Slot 2 — always mid tier (balanced)
- Slot 3 — RNG (10% mid, 70% mid+, 18% high, **2% special merc**)
- Refresh rerolls all 3 for a fee (meta-gambling)

Agent dies → slot frees up, recruiter goes cold ("Guess we're hiring.").

### Special mercs (the 2% slot)

Showcase characters with **distinct gameplay twists** AND a **signature weapon**. Each merc carries ONE unique weapon that doesn't exist anywhere else in the game until you've unlocked it through them.

**The mercs + their weapons:**

| Codename | Style | Signature weapon | Permanent merc unlock | Weapon unlock |
|---|---|---|---|---|
| **The Pyre** | flamethrower zealot | Flamethrower | 5 successful contracts | 200 burn kills |
| **Long Sleep** | recon sniper | Intervention | 30 confirmed kills past 50m | 10 one-shot kills |
| **Cardinal** | two-pistol gunslinger | Special pistol pair | survive Floor 10+ solo | 100 hip-fire kills |
| **Black Box** | hacker / saboteur | Special SMG (silenced burst) | hack-only contract complete | 50 stealth kills |
| **Slag** | demo expert | Rocket launcher | 3 explosive-only contracts | 100 explosion kills |
| **Howitzer** | grenadier | Grenade launcher | level a room (Floor 8+) | 200 grenade kills |
| **Mule** | walking armory | Minigun | survive 60s of Heat 5 alarm | 500 minigun kills |
| **Mortician** | knife specialist | Special melee (signature blade) | finish 20 enemies with execute | 100 melee kills |
| **Bunker** | static gun emplacer | HMG | hold a room for 90s | 300 HMG kills |
| **Carrion** | shotgunner | Dragon's Breath shotgun | 50 close-range kills | 100 fire-shotgun kills |
| **Static** | assault all-rounder | Special rifle (burst-3) | 10 contracts complete | 250 rifle kills |

**Discovery loop:**
1. Special merc rotates into recruiter (rare appearance).
2. Player hires them for one contract — the weapon comes WITH the merc.
3. Sees the weapon perform. Likes it. Wants more.
4. Hits the merc-unlock condition → merc becomes a **named cast** member, cheaper to re-hire after death, gets backstory dialogue.
5. Hits the weapon-unlock condition → **the weapon enters the agency armory**. Available for any agent. The merc's weapon becomes a permanent part of the loadout pool.

This is the meta-progression. Players play to unlock the cast AND the arsenal.

### Why the weapon tie-in matters

- Weapons feel rewarded, not handed out. You earned the flamethrower by surviving with The Pyre.
- Each merc has a job (showcase a weapon). Their gameplay style and the weapon co-evolve in design — Pyre's playstyle IS the flamethrower.
- Marketing handle: "Hire the Pyre. Unlock the flame." Each merc is a self-contained reveal.
- Loss aversion: if Pyre dies in your run, the flamethrower goes with her until you re-hire.

### Open questions

- Permanent merc unlock — do they show up FREE in the recruiter, or just cheaper?
- If a merc dies before their unlock condition is met, does progress reset or persist?
- Does the weapon unlock require completion with that SPECIFIC merc, or any merc?
- Named-cast permadeath: do unlocked mercs still permadeath, or are they "essential"?

My instinct: progress persists across deaths (player can keep grinding the unlock condition across multiple hires), weapon unlock requires that specific merc, named-cast still permadeaths but their unlock progress survives.
