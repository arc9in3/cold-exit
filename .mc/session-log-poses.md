## Shipped today (2026-05-02 session)

**Pose-as-data architecture** replaces the procedural rotation tables in `actor_rig.js`.

### Infra commits
- `c0e8b28` — `serve.mjs` POST `/api/save-pose/<name>` endpoint, `Assets/poses/` directory, rig_tuner save/load/export GUI buttons
- `2e5c038` — `src/poses.js` runtime loader (`loadPose`, `applyPose`, `lerpToPose`, `attachBoneNames`); diagnostic plumbing in `.mc/pose-load.mjs`
- `3991561` — **scale-correct IK** — was solving in chest-local frame after dividing by parent's non-uniform world scale (1.5/1.5/1.368 from pelvis chain), which sheared everything; rewrote to work in WORLD coords, then convert final shoulder rotation to parent's rotation-only frame. Old elbow code only bent around local X axis (broke for any non-trivial shoulder rotation); new code points forearm directly at target via `setFromUnitVectors`. Result: hands land within 2-4cm of targets vs 80cm before.
- `b419473` — pose stubs: rifle-hip, rifle-aim
- (latest) — pose stubs: smg-hip, smg-aim, melee, idle

### How it works now
1. Author pose in rig_tuner: drag IK gizmos to grip points, click "save name → save pose to Assets/poses/"
2. Pose JSON has rotations + IK targets + hips.y
3. Game runtime: `import { loadPose, applyPose } from './poses.js'; applyPose(rig, await loadPose('rifle-hip'))`
4. Rig proportion changes don't break poses (IK adapts)

### Outstanding
- Wire `src/poses.js` into `player.js` (currently still uses legacy procedural anim)
- Author quality pass on pose target positions (current values are stubs)
- Decide: keep legacy procedural rifle/SMG/melee poses or strip them once authored poses ship in-game
