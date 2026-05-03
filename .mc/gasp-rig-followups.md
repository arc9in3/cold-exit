# GASP rig follow-ups

Status as of 2026-05-03 evening, after the audit + polish pass.

## Closed

- **~~Weapons way off / scale broken~~** — fixed. setWeapon got a
  clean GASP-anchor path (`af20f70`); gun anchor now counter-scales
  rig.group.scale (`af20f70`) so weapons render at authored size.

- **~~Switching to rifle weapon class still looks pistol~~** — fixed.
  selectGaspLocomotion now picks _Rifle clips when weapon.class is
  rifle/shotgun/sniper/lmg regardless of adsAmount (`5bdcb12`).
  Idle path also covered (`37b4e1e`).

- **~~Swap-shoulders L key broken~~** — likely fixed. The gun anchor
  now follows the dominant hand bone via per-frame world-position
  lerp; swapping `state.handedness` reselects hand_l vs hand_r and
  the anchor visibly tracks the new hand. Untested in real
  gameplay; flag if it still doesn't work.

- **~~Aim-pitch IK at heads/limbs/legs~~** — fixed. Gun anchor pitches
  toward target Y when |angle to target| exceeds 5.7° deadband
  (`103fe11`). Clamped ±0.6 rad so extreme angles don't break the
  pose.

- **~~No recoil animation~~** — fixed. kickRecoil now scales by
  weapon class (sniper 0.18 → flame 0.04 rad chest pitch) on the
  FBX path; decays quadratic over 180ms (`103fe11`, `3d8847a`).

- **~~Memory leak: FBX swap stacks hidden rigs in scene~~** — fixed.
  swapPlayerToFbxRig + revertPlayerToProcgen now dispose the prior
  FBX rig (geometry, materials, mixer) before loading the next
  (`706c56e`).

## Open

- **Locomotion clips' arms aim downward** in hipfire — by design
  (GASP _Pistol clips are authored low-ready). ADS swap to _Rifle
  clips fixes the aim-up case. Acceptable per user feedback.

- **L/R strafe mirror under ADS** — debug log + slowed body lerp
  (`4ee5934`) shipped, awaiting user verification with
  `__animDebug = true`. Body-relative input synthesis (`2671f2b`)
  should make D-key always read as right strafe regardless of body
  facing.

- **Recoil pulse on additive layer instead of scalar offset** —
  `src/anim/additive.js` has `triggerRecoil()` that goes through
  the additive blend layer system (cleaner architecturally). Current
  scalar-offset implementation works visually; switch is cosmetic
  refactor, not a bug fix.

- **`rig.kind` not set on procgen** — adapter labels procgen rigs
  as 'unknown' because adapt() only runs on FBX load. Cosmetic;
  no behavior impact.
