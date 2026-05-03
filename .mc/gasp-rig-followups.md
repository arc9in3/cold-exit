# GASP rig follow-ups (captured from in-flight playtest feedback)

User flagged these during the GASP locomotion / ADS work, requesting we
do a focused pass on them once locomotion + ADS swap settles.

## Open

- **Weapons way off / scale broken** after the gun-anchor refactor.
  The setWeapon path that positions gunMesh / muzzle / inHandModel
  was tuned for a wrist bone anchor (hand-local forward = -Y).
  Switching to a chest-anchor Object3D under rig.group changes the
  reference frame — positions / rotations / WEAPON_SCALE need a
  re-pass for the new anchor.

- **Switching to rifle weapon class still looks like player is
  holding a pistol.** The locomotion clip set is locked to the
  player.adsAmount toggle, not to the weapon class. Need to drive
  clip-set selection from BOTH (or have rifle weapons force ADS
  into "shouldered rifle" pose).

- **Swap-shoulders (L key) isn't working anymore.** _handAnchor()
  always returns rig._gunAnchor, ignoring state.handedness. Need
  to either move the anchor laterally on swap, OR have two anchors
  (one per shoulder) and toggle.

- **Aim-pitch IK at heads/limbs/legs.** When cursor target Y is
  significantly above or below chest, the gun should pitch toward
  the target instead of staying parallel to ground. Currently the
  anchor.rotation is forced to identity each frame.

- **Locomotion clips' arms aim downward** — partially the GASP
  pistol clips' authored low-ready pose. ADS swap to rifle clips
  fixes the aiming-up case but the hipfire path will still read as
  "low ready" while running. Acceptable per user feedback, just
  visible.

- **No recoil animation when shooting.** Each shot should pulse
  a quick additive on chest + dominant upper arm (arm kicks back
  ~0.06 rad, chest pitches back ~0.03 rad, decays over ~180ms).
  `src/anim/additive.js` has triggerRecoil() that does exactly
  this; needs to be wired to the player.update fire path on the
  GASP rig.
