Audit-only (read+report, no code edits). Review the GASP rig integration in src/player.js for code-quality issues, lurking bugs, and per-frame inefficiencies.

Reference files:
- src/player.js (main file, ~2900 lines; the GASP path is the `if (rig._fbx.useGaspLocomotion) { ... }` block in player.update around line ~1750)
- src/anim/locomotion.js (selectGaspLocomotion + helpers)
- src/anim/state_machine.js (clip selection)
- src/main.js (window.__useGaspMannequin loader, ~line 905)
- Assets/anim_data/states/gasp_lower_body.json
- Assets/anim_data/rigs/gasp_uefn.json

Look for:

1. **Per-frame allocations**: any `new THREE.Quaternion()` / `new Vector3()` inside the per-frame GASP block that should be module-scope scratches.
2. **Math soundness**: chestTwist clamping, body-yaw lerp, gun-anchor positioning, foot-grounded clamp asymmetric lerp. Any bugs?
3. **State leakage**: does the GASP path clean up properly when the rig is swapped (e.g. via `__useFbx(null)`)? Check rig._fbx.* fields.
4. **Bone resolution caching**: are spine_chain / clavicle / foot bones cached correctly after first call? Any rebuild on every frame?
5. **Procgen path interaction**: any code in player.update that assumes rig.materials / rig.chestMesh exists and would crash on FBX rigs?
6. **Defensive coding**: the GASP path conditionally engages — does it gracefully degrade if any required JSON / GLB is missing?

Output as audits/audit-gasp-integration-review.md. Read-only audit, NO code edits. Focus on findings + suggested fixes; let me/Claude apply them.
