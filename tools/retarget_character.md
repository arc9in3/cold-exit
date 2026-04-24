# Character retargeting recipe

> **Status: parked (2026-04).** The pipeline successfully produces a
> valid single-mesh GLB with a clean bone map and correctly-scaled
> skeleton. The remaining blocker is bone **local-axis** mismatch:
> our procedural rig writes `shoulder.rotation.x = -0.60` expecting
> local +X to be "across the shoulder", but after `pose-as-rest` in
> Blender the bone's local +X lands on a different physical direction,
> so the rotation twists the arm instead of pitching it. Result:
> skin deforms into a long thin ribbon (see `bug.png` archived in
> Assets/). Fixing this requires a proper per-bone basis-alignment
> (what Mixamo / Rokoko / Unreal IK Retargeter do automatically).
>
> The primitive rig in `src/actor_rig.js` is the shipping path.
> Enable the skinned path (`window.__skinnedRig = true`) only for
> experimentation. To revive this line of work, start by adding a
> Blender step that aligns each bone's local axes to a canonical
> convention (e.g. `Armature → Recalculate Roll → Global Y Axis`)
> before `pose-as-rest`, and verify the local +X axis on upperarm
> bones actually points across-shoulder in the final GLB.

---


Our procedural rig (`src/actor_rig.js`) writes joint rotations assuming
each limb is in a **hanging / relaxed rest pose** (arms down, legs
straight, `rotation = identity` = natural stance). The animpic /
Reallusion-CC character FBXs in `Assets/models/characters/` are
**A-pose bound** and their bone local axes don't match our proc rig's
convention, so direct retargeting in JS was producing broken arm poses.

The fix is to re-author each character's bind pose in Blender so that
`rotation = identity` actually means hanging-arms, then export as
glTF 2.0 (which — unlike FBXLoader — handles multi-mesh skeletons
properly). Once the bind is "correct", `src/character_model.js`
becomes a thin bone-name map with no rest-offset math.

## Requirements

- Blender 3.6+ (glTF 2.0 exporter ships in-box)
- Source FBX from `Assets/models/characters/`

## One-time workflow per character

Source FBX: `Assets/models/characters/Man_Rig_Correct.fbx`
Target:    `Assets/models/characters/Man_Rig_Correct.glb`

### 1. Import the FBX

1. Open Blender, File → Import → FBX (.fbx).
2. Pick the source file. Keep "Automatic Bone Orientation" UNCHECKED
   (preserves the original axes).
3. After import, scale the armature down if the character is huge
   (animpic packs often import at 100× scale). Select the armature,
   N-panel → Item → set Scale to `0.01` if needed, then
   Object → Apply → All Transforms.

### 2. Pose arms to hanging

1. Click the armature, enter **Pose Mode** (Ctrl+Tab).
2. Select the left upperarm bone (e.g. `upperarm_l`, `LeftArm`,
   `CC_Base_L_Upperarm` — naming varies by pack).
3. Rotate it so the arm hangs straight down alongside the body.
   Fastest: R, X/Y/Z to pick axis, type the angle (e.g. `R Y -60`).
   Iterate until the arm visually hangs.
4. Repeat for the right upperarm, then optionally the forearms
   (usually fine at bind if the upperarms land correctly).
5. **Legs**: usually already straight. Skip unless visibly angled.

### 3. Apply pose as rest

This is the key step — it transfers the current pose into the bind
matrices so `rotation = identity` now means "arms down" instead of
"arms out".

1. Pose Mode → Pose menu → Apply → Apply Pose as Rest Pose.
2. Blender warns about skin deformation getting baked in — confirm.
3. Back to Object Mode, verify the character still looks correct.

### 4. Export as glTF

1. File → Export → glTF 2.0 (.glb/.gltf).
2. Format: **glTF Binary (.glb)** (single-file, easier to ship).
3. Include section:
   - Limit to: Selected Objects (with the armature + its meshes selected)
   - Data: Armature ✓, Skinning ✓, Deform Bones Only ✓ (drops helper bones)
4. Save next to the source FBX, e.g. `Man_Rig_Correct.glb`.

### 5. Wire it up

In the dev console on page load:

```js
window.__skinnedRig = true;
window.__skinnedRigURL = 'Assets/models/characters/Man_Rig_Correct.glb';
location.reload();
```

Or edit `CHAR_TEMPLATE_URL_DEFAULT` in `src/gunman.js` to point at the
`.glb` once it's the canonical version.

## What to expect if the bind is right

- `[gunman] template loaded — 1 skinned mesh(es)` in the console
  (glTF supports multi-mesh skeletons but the single-mesh case is
  simplest to start with — export with only the body mesh selected).
- `[character] slot → bone:` showing every slot mapped to a real bone
  (no `(UNMAPPED)` entries).
- Arms hanging at rest; walk cycle counter-swings them; chest-ready
  pose swings them forward — all without per-bone rest offsets.

## What to do if it's still off

- Arms too far forward/back at rest: your pose-as-rest step wasn't
  quite vertical. Re-enter Pose mode, re-rotate, re-apply.
- Arms symmetric but still angled: the upperarm twist bone got
  rotated along with the upperarm — select ONLY `upperarm_l` /
  `upperarm_r` (not the `_twist_` variants) and redo.
- Bone names unmapped: extend `BONE_ALIASES` in `src/character_model.js`
  with whatever Blender exported them as.

## Future: batch the pose-as-rest step

Eventually this should be a Blender CLI python script so we can
re-export from source on demand:

```
blender -b -P tools/rebind_hanging.py -- in.fbx out.glb
```

The script would need to (a) find arm bones by alias, (b) measure
their world-direction, (c) compute a pose-space rotation that brings
each to vertical, (d) apply pose as rest, (e) export. TBD.
