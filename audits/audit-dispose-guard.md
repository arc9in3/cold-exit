# audit-dispose-guard

Model: `deepseek-r1:32b`
Generated: 2026-04-28T00:14:49.400Z
Files in scope (8): `src/actor_rig.js`, `src/corpse_bake.js`, `src/drones.js`, `src/gunman.js`, `src/loot.js`, `src/melee_enemy.js`, `src/projectiles.js`, `src/rig_instancer.js`

## Prompt

Each shared geometry in this project has userData.sharedRigGeom = true so cleanup loops can skip them — disposing a shared geometry from one corpse would corrupt every actor / prop sharing it. List EVERY callsite of geometry.dispose() in the provided files. For each one, mark whether the surrounding code GUARDS against shared geometry (checks userData.sharedRigGeom OR walks a list known to contain only owned geometry). Output a numbered list with file:line and a one-sentence verdict per callsite. End with 'Risk: <none|low|medium|high>' and 'Suggested fix: <...>'.

## Report
1. **src/corpse_bake.js:107**  
   `if (!obj.geometry.userData?.sharedRigGeom) { obj.geometry.dispose(); }`  
   Verdict: **SAFE** - Properly checks for shared geometry before disposal.

2. **src/drones.js:103**  
   `drone.body.geometry.dispose();`  
   Verdict: **DANGEROUS** - Disposes without checking if the geometry is shared.

3. **src/drones.js:145**  
   `d.body?.geometry.dispose();`  
   Verdict: **DANGEROUS** - Disposes without checking if the geometry is shared.

4. **src/gunman.js:289-290**  
   `_stripDeadEnemyWeapon(g)` removes meshes but doesn't dispose geometries, so no risk here.

---

Risk: **medium**  
Suggested fix: Add `if (!geometry.userData?.sharedRigGeom)` checks before disposal in `drones.js` lines 103 and 145.
