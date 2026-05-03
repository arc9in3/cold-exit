**Commit:** b1c3a5c — `rig: archetype silhouette props — visor, ponytail, neck cable, sheath`

## Refs locked

User: *Raiden (Metal Gear) for the male, Eve (Stellar Blade) for the female. Stealth-operator palette stays.*

So instead of "anatomically correct heroic + femme fatale", the design language is **iconic silhouette elements** that translate the references into primitive vocabulary while keeping the all-dark operator palette.

## What landed (b1c3a5c)

Four new primitives, each gated on an opt, additive only:

| Prop | Opt | Geometry | Material | Read |
|---|---|---|---|---|
| Visor | `opts.visor` | Open-ended cyl arc, front 180° of cranium | `accentMat` (MeshBasicMaterial, default `#f2c060`) | Raiden eye-line |
| Ponytail | `opts.ponytail` | Box, hanging from back of cranium | `bodyMat` | Eve sweep |
| Neck cable | `opts.neckCable` | 3 stacked rings instead of single cyl | `gearMat` | Mechanical articulation |
| Sheath | `opts.sheath` | Tilted box across chest back | `gearMat` | Permanent blade silhouette |

Plus `opts.accentColor` (defaults to project accent-gold). Uses `MeshBasicMaterial` so the band reads emissive without post-processing.

## Player.js opt-ins

Player rig now sets `signature: true, visor: true, neckCable: true, sheath: true`. Bandolier was already on from the previous commit.

Player palette **unchanged** — stays all-dark stealth-operator per the user's call. The visor's accent-gold band does the signature-color work without flipping the body palette.

## rig_tuner additions

- `signature props` GUI folder with toggles for all four props
- One-click `preset → Raiden` and `preset → Eve` buttons for live silhouette comparison
- New `accent (visor)` color picker

## What deferred

- **Phase B-next** — `DEFAULT_DIMS_MALE` / `DEFAULT_DIMS_FEMALE` body-shape variants (V-taper + hourglass + bust). This commit changed the silhouette via *props*, not via body proportions. Eve still has Raiden's body shape, just with a ponytail.
- **Phase C** — sculpted idle poses (loaded-spring ninja, contrapposto femme fatale).
- **Phase D** — per-weapon-class pose tables.

## Followups queued

- Sage + Wrenchy reviews (auto per memory).
