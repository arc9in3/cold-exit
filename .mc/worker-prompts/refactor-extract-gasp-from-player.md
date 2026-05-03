Extract the GASP rig integration from src/player.js into a dedicated module to reduce player.js's size + improve testability.

Reference files:
- src/player.js (~2900 lines; player.update is itself ~1500 lines)
- The GASP block in player.update is roughly:
  - `if (rig._fbx) { ... }` block, lines ~1730-2110
  - Within that, `if (rig._fbx.useGaspLocomotion)` block at ~1750
- _runUpperBodyIK helper at ~line 46
- Module-level scratches: _aimDeltaQ, _aimDeltaE, _aimParentWorldQ, _aimComposeQ, _handTrackV, _aimIkTarget, _aimIkPole

Goal: create `src/anim/gasp_player_driver.js` exporting:

```js
export function updateGaspPlayer(player, rig, state, input, aimPoint, aimPitch, planarSpeed, velocity, dt) {
  // The whole GASP-path body — body yaw, gun anchor, locomotion clip
  // selection, mixer tick, upper-body IK, foot-grounded clamp.
}

export function _runUpperBodyIK(rig, state, aimPoint, aimPitch, dt) {
  // Spine + neck + head additive aim, multi-bone distribution.
}
```

Then player.update becomes a 1-liner call into updateGaspPlayer. The GASP-specific scratches move into the new module.

Constraints:
- Don't change behavior. Just relocate code.
- Preserve every comment that documents WHY a value was chosen (e.g. crouch sink rate asymmetry, ADS body lerp 20/s, chest twist deadzone 90°).
- The new module imports from src/anim/{locomotion, state_machine}.
- Run `node --check src/player.js` and `node --check src/anim/gasp_player_driver.js` after — must pass.

Verify behavior preservation by running .mc/probe-y-glitch-v2.mjs after — should still see "loaded — 42 clips", hipY ~ 0.94m.

Output: a complete patch (the new module + the modified player.js) at audits/refactor-extract-gasp-from-player.md. Include before/after line counts so reviewer can spot any unintentional drift.
