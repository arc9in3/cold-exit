**Commit:** 7d61e83 — `rig: silhouette + animation pass — pads/neck/lean/gait twist/melee guard`

## Visual audit → tactical pass

Drove the rig viewer (`tools/rig_tuner.html`) via Playwright, captured all 9 presets + walk/run/dash cycles, audited against the contractor-terminal aesthetic. Seven fixes landed:

| # | Fix | Where | Before → After |
|---|---|---|---|
| 1 | Shoulder pads shrunk | `actor_rig.js` `arms.shoulderPadR` | `0.18 → 0.11` (~40%) |
| 2 | Chest-plate teeth removed | `actor_rig.js` chestPlate build | `segs 14 → 32`, `chestPlateBotR 0.22 → 0.28` |
| 3 | Visible neck | `actor_rig.js` `head.neckH` / `headY` | `0.185 → 0.22` / `0.125 → 0.14` |
| 4 | Gait yaw counter-rotation | `actor_rig.js` `Tg.gaitYawAmplitude` + `updateAnim()` | new tunable `0.08`; hips/chest counter-yaw with aim-preserving 2x subtract |
| 5 | Run lean | `actor_rig.js` `Tg.runLeanRun` | `0.16 → 0.22` (~12.6°) |
| 6 | Melee guard pose | `actor_rig.js` melee idle block | shoulder `-0.35 → -0.55`, elbow `-1.15 → -1.55` |
| 7 | Rig-tuner color defaults | `tools/rig_tuner.html` | swapped to in-game defaults (body brighter than gear) |

## Aim-preservation note

User flagged earlier that "every time I pitch the torso forward the muzzle ends up pointing at the ground and we chase the comp values." Verified before bumping `runLeanRun`: the existing `armLeanComp` chain (lines 1480–1490 in `actor_rig.js`) subtracts `runLean + dashLean + crouchLean + hipsLean` from the shoulder pitch directly — references the live tunable, not stale hardcoded constants. So the 0.16 → 0.22 bump propagates through the comp without restating any shoulder math.

## Open items observed but NOT touched

- **Idle pose** — right hand still floats up at chest level (mannequin-flinch read). Was out of scope for this pass; user didn't ask. Deferrable.
- **Cranium stretch** (`craniumStretchY: 1.15`) makes the head slightly egg-shaped from the side. Notable in run/dash side views.
- **In-game weapon attach** verification — rig_tuner doesn't load weapon meshes, so I can't verify the rifle position relative to the new shoulder pad scale + the new spinal twist.
- **Character creator lite** — user mentioned this is on the roadmap. The fact that gear color overrides body color is the foundation for it. Worth designing the per-piece color override surface (helmet → headColor, gloves → handColor, etc.) intentionally before adding the UI.

## Followups queued

- Sage + Wrenchy auto-review on the rig pass (per memory: post-commit audits run automatically).
