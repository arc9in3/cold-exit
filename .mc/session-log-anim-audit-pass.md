**Audit + polish pass on the animation system.**

## Decisions captured
- **Enemy rigs stay procgen.** Documented in `project_anim_system_state.md` memory. Reasons: perf (24+ active enemies, rig_instancer batches via geometry sharing), enemies aim at player not cursor (less benefit from upper-body IK), procgen works. Future direction: hybrid (boss/named NPCs adopt GASP, generic stays procgen).
- **Unused anim modules left in place.** `bone_mask`, `additive`, `net_sync`, `overrides`, `api` (0 importers each), `ik_two_bone`/`graph`/`cutscene` (1-2 importers but disabled). Removing isn't worth the churn; Phase 4 work could revive cleanly.

## Polish landed (commits since last log)
- `103fe11` recoil pulse on chest pitch (180ms quadratic ease-out) + aim-pitch IK on gun anchor when target is significantly above/below chest (5.7° deadband, ±0.6 rad clamp).
- `0044f57` GASP gun anchor weapon positioning — clean `+Z forward` axis-aligned path, no more wrist-frame Math.PI/2 leftover from procgen.
- `79d9a12` full 8-way Rifle locomotion coverage. Run B/BL/BR + Crouch B/BL/BR + Sprint F now have shouldered ADS variants. 42 GLB clips total (up from 35).
- `b29657c` weapon-GLB validator (`.mc/probe-weapon-glbs.mjs`). All 447 converted weapon GLBs pass: ≥1 mesh, ≥1 vertex.

## Verified
- 447/447 weapon GLBs load cleanly through GLTFLoader
- 42 anim clips load, hipY stable at 0.94m
- Procgen path (set `localStorage.coldExitDefaultRig='procgen'`) still works: 40 meshes, no FBX-artifact leakage

## Open / on the back burner
- Chest twist + spine yaw "lean instead of rotate" issue — only manifests sometimes; unresolved
- L/R strafe direction debug under ADS (debug log + slowed body lerp shipped, awaits user verification)
- Swap-shoulders L-key on GASP (likely working via hand-bone tracking, untested)
- Recoil tuning per-weapon-class (currently scalar 0.10 rad chest pitch regardless of weapon)
