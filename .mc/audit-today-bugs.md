Bug pass on today's commits (2026-05-03).

## Today's commits (range)

```
4cb3b3f agency: special-merc abilities/relics/loadouts + 20 named recruits + economy
4c5d427 character_fbx: GLB support + 3ds Max Biped naming + UAL helper
4046538 fix: crouch run no longer tilts head back at sky
eee3f00 fix: foot heel-behind-ankle + idle hand at chest level
fb7b0f7 fix: toes-up walking, arms not meeting, pistol too close to forearm
3642638 fix: pistol mounts at hand (was 38cm below wrist)
f605a97 rig + run cycle pass — pointier feet, less bouncy, athletic stride, gun forward
01957e2 fix: feet smaller + pistol class scale halved
858a535 rig: idle is now a low-ready stance
bb937df fbx: aim IK
fbfc339 fbx: match walk/jog clip timeScale
dae24c9 fbx: anchor mixer to SkinnedMesh
846fbc4 fbx: diagnostics
d51c9b5 fbx: __usePistolPack()
b5a8223 fbx: applyArmorTint guards
9199c41 fbx: fix swap not taking effect
f64ff8e fbx: __useFbx debug hook
2b6b5f6 character_fbx: MotusMan support
468b330 character_fbx: load Mixamo FBX
2668475 rig_tuner: FBX preview
6737b28 rig: subtler idle
38f30e3 fix: unarmed idle off-hand clip
00b8adf new rig: arms ~30% shorter
2b9eb7f fix: shinigami chain
63b498e fix: rig idle clockwise rotation
d738148 agency: scaffold recruiter
```

## What to check

For each commit, look for:

1. **Missed edge cases** — does the change handle null/undefined inputs, missing fields, race conditions?
2. **Regressions on adjacent code paths** — e.g., the FBX swap added a `_setRig` setter; does anything OUTSIDE player.update still hold a stale rig reference?
3. **Stale comments / docs** — values changed but comments still describe old values
4. **Magic numbers** that should be in tunables.js / POSE_TUNABLES per the project standards
5. **Hardcoded strings** that should be class-checked (e.g., `cls === 'pistol'` — what if class is undefined?)

## Specific risk areas

- `src/character_fbx.js` — bareBone() strips numeric suffix; could it accidentally strip from a non-Biped name like `Spine_1` if Mixamo ever uses such a suffix?
- `src/recruiter.js` — `_agentSeq` is a module-level counter; will it conflict across save/load? Should it persist?
- `src/agency_economy.js` — getChips() parses localStorage every call. Multiple UI paths read it per render. Hot path?
- `src/main.js` — many `window.__*` debug hooks added. Any one of them holding refs that prevent GC of swapped rigs?
- `src/player.js` — `let rig = ...` (was const); is there any code OUTSIDE update() that captures `rig` in a closure and would now have stale values after _setRig?
- `src/actor_rig.js` — Tc.headCounterPitch zeroed; does any other code path STILL apply the old logic and expect the value to be 0.22?

## Output

`audits/audit-today-bugs.md` — list each commit, mark it OK or flag specific issues with file:line. Severity: CRITICAL / MEDIUM / NIT. Don't fix; just report. Bias toward conservatism — false positives are fine, missed issues are not.
