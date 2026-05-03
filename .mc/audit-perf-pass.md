Cold Exit performance pass — coop, animations, UI, metagame.

## Scope

Read-only audit. Look for actual perf hotspots + risk areas in four domains. Write findings to `audits/audit-perf-pass.md`.

## What to look for, by domain

### Coop
- Per-frame work in `src/coop/snapshot.js` and `src/coop/relay.js`. Anything allocating per tick? Anything that walks the whole entity list per peer?
- `_coopBroadcast*` calls in `src/main.js` — count uses, look for tight loops calling broadcast inside another loop
- Network message size — are we sending full state per frame or deltas?
- Any synchronous network calls inside the render loop?

### Animations
- `updateAnim` in `src/actor_rig.js` — how many `Math.sin` / `Math.cos` per frame? Per-actor? Could any be hoisted?
- Rig instancing in `src/main.js` — confirm InstancedMesh is being used for repeat props
- Any `new THREE.Vector3()` / `new THREE.Quaternion()` allocations inside hot loops?
- FBX `AnimationMixer.update(dt)` — confirm it's only called for visible/active rigs, not every spawned one

### UI
- `src/ui_*.js` — look for `.innerHTML = ...` rebuilds inside per-frame ticks (vs. just `textContent` on cached elements)
- `document.querySelector` in render loops (should be cached)
- Any UI rebuild on every `recomputeStats` call? Confirm dirty-flag pattern
- New: `src/ui_recruiter.js` — render() rebuilds the whole option list each refresh; OK since it's modal-only, but confirm it's NOT in any per-frame path

### Metagame
- `src/recruiter.js` — rollRoster() called once per modal open, fine. NAMED_RECRUITS array of 20 — confirm no per-frame iteration
- `src/agency_economy.js` — getChips/getMarks parse localStorage every call. Could cache; called from UI render and refresh paths
- `src/prefs.js` — localStorage I/O. Confirm batched / debounced where possible
- Save / load paths — any large object cloning?

## Output

`audits/audit-perf-pass.md` — top 10 hotspots ranked by risk × frequency, with file:line refs and suggested fixes. Don't apply changes; just report.

If you find a clear catastrophic issue (e.g., per-frame O(N²) loop, allocation storm, sync localStorage write per frame), call it out at the top with **CRITICAL**.
