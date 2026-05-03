**Commit:** bbf0b02 — `rig: phase A — polished primitives pass (segs, fist hand, bandolier, idle)`

## Direction confirmed

User: *"i love the primitives as an art style now and i want to push it to look/feel like a higher quality polished, intentional art style."*

So the design pillars I'm now working against:
1. Shape vocabulary: cylinder / sphere / box only
2. 3-color rule per character (body / gear / detail accent)
3. 0.02m grid for all dims
4. Silhouette readable at 24px
5. Asymmetric signature on the player only
6. Sculpted idles, not "T-pose minus arms"

## Phase A — what landed

| Change | File | Detail |
|---|---|---|
| Segs bump on visible cyls | actor_rig.js | torso 16→24, neck 12→16, upper-arm+forearm 10→16, wristCuff 12→16 |
| Hand fist read | actor_rig.js | scale.x 1.05 + hemispherical knuckle dome on forward face |
| Bandolier signature | actor_rig.js | Diagonal gear-color box across chest, gated on `opts.signature` |
| Player opts in | player.js | `signature: true` so only the protagonist gets the strap |
| No-weapon idle | actor_rig.js | Detects `!rifleHold && !meleeStance && !akimbo && !attacking && !blockPose && !aiming` → relaxed arms at sides |
| Tuner shows player | rig_tuner.html | `signature: true` so the strap is part of what's being tuned |

## Tension flagged for the user

The player rig currently uses an all-dark operator palette (body `#1c1e22`, gear `#2a2c30` lighter than body) — exactly the inverted contrast we fixed elsewhere. This works as "stealth contractor in shadow" but **conflicts with the user's stated direction of "feel heroic"**. Heroic-male reading needs the body to be the focal point, not a void.

Two paths:
- **A)** Keep all-dark for now. Heroic comes from pose, prop (bandolier already), and weapon. Aesthetic stays "operator in the dark", reads cinematic but not literally heroic.
- **B)** Lift the player palette to mid-tone-with-accents — body `#3a4048` mid-steel, gear darker as accents, ONE bright color as detail (e.g. red bandolier for the player only). Reads more "the protagonist".

Worth deciding before Phase B (sex variants) since the male/female palette work piggybacks on the same call.

## Phases deferred

- **Phase B** — `DEFAULT_DIMS_MALE` (heroic V-taper, square jaw) + `DEFAULT_DIMS_FEMALE` (hourglass + bust + longer neck + smaller hands). `buildRig({ sex })` parameter.
- **Phase C** — Idle pose presets: heroic stance (chest out, shoulders rolled back, weight even) + femme-fatale contrapposto (S-curve, weight on one leg, hip cocked, head tilt).
- **Phase D** — Per-weapon-class pose tables. Replace the shared rifleHold mess with `WEAPON_POSES.{ pistol1h | pistol2h | smg | rifle | shotgun | sniper | lmg | melee_blade | melee_club | melee_polearm }`. Each authors shoulder.x/y/z, elbow, support arm, body yaw, ADS midpoint, hipfire variant.

## Followups queued

- Sage + Wrenchy reviews on bbf0b02 (auto per memory).
