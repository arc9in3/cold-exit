# Handoff — gun-pack-swap branch

Author: Claude (handoff written 2026-05-17)
Context: User is moving Cold Exit development off Claude Code and onto Codex. This document captures repo state, lessons learned this session, and the next concrete steps so the new operator has a clean starting point.

## Repo state

- **Active branch:** `gun-pack-swap` (off `main`, originally cut 2026-05-13)
- **Last clean commit:** `af8fcba` — *feat(weapons): swap to lowpoly_v2 gun pack (WIP — rifle+pistol tuned)*
- **Subsequent commit `59d6809`** (per-mesh tuning data + pose-editor upgrades) **has been reverted** in working tree. See "Why we reverted" below. The commit itself is still in git history; the next commit on this branch should be the revert + this handoff doc.
- **`main` branch:** untouched by this session.

## What's done on `gun-pack-swap`

The branch swaps every ranged weapon visual to the recolored `low_poly_guns_fbx` pack (29 GLBs under `Assets/models/lowpoly_v2/`). Conversion artifacts (Blender batch scripts, palette recolor, source extract) live under `.mc/lpg-*` so the pack is reproducible.

**Wiring (committed, working):**
- `src/model_manifest.js` — `MODEL_BY_WEAPON_NAME` rewrite (~55 ranged weapons → `lowpoly_v2/*`)
- `PACK_ROTATION_DEFAULTS` applies `π` yaw to all `lowpoly_v2/` meshes (pack authors muzzle on Z; needed after Y-up flip)
- Dead pre-swap `MODEL_SCALE_OVERRIDE` entries purged
- `MODEL_SCALE_OVERRIDE` has the Glock-17 outlier (`lowpoly_v2/pistol_3.glb: 0.50`) — Glock mesh is bulkier than `pistol_2`

**Tuning (committed, working):**
- `src/player.js` `ANIM_TUNE` — class-level dial for rifle (`sizeMul 0.4`, `gripOffset {-0.17, 0.07}`, AK47 anchor) and pistol (`sizeMul 0.5`, `gripZScale -0.30`, `gripOffset {-0.26, 0.02}`, M1911 anchor)
- All other classes (smg, shotgun, sniper, lmg, flame) still at pre-swap class-level defaults

## What's pending

Per-mesh tuning for the remaining ~27 lowpoly_v2 meshes — each class still has 1-N weapons that need eyeball passes to land grip/scale/muzzle right against the in-game rig. Glock is the only per-mesh outlier baked so far.

Revolvers and LMGs have **known shape stand-in gaps** (no wheel-gun in the pack — shared `pistol_4.glb`; LMGs use heaviest-rifle silhouettes). Either source new meshes or accept the stand-ins.

## How to tune (the workflow that actually works)

**Use in-game console tuning. Do NOT use the pose editor (see "What NOT to do" below).**

1. `node tools/serve.mjs` → open `http://localhost:8080/` in Chrome
2. Equip the weapon you want to tune (loot pool, contracts, or main-menu starting picker)
3. Open devtools console. The active weapon clone is on `window.__activeWeaponClone`.
4. Adjust **per-mesh** values:
   ```js
   __debug.tuneWeapon({ x: 0.05, y: 0.02, z: -0.1, rotX: 0, rotY: Math.PI, rotZ: 0 })
   __activeWeaponClone.scale.multiplyScalar(1.1)   // bumps scale up 10%
   __debug.inspectWeapon()                          // dumps current transform + bbox
   ```
5. Adjust **class-wide** values via the tweakpane: type `__openTuner()` in console. Sliders mutate `ANIM_TUNE` live and auto-save to `localStorage`. Bake into source with the "Print ANIM_TUNE → console" button.
6. When the weapon looks right, **read the values from the console** (`__debug.inspectWeapon()` prints them formatted) and **paste manually** into the appropriate table in `src/model_manifest.js`:
   - Position → `MODEL_GRIP_OFFSET[path]`
   - Rotation → `MODEL_ROTATION_OVERRIDE[path]` (omit if it matches the lowpoly_v2 pack default of `{x:0, y:π, z:0}`)
   - Scale → `MODEL_SCALE_OVERRIDE[path]` (compute from `__activeWeaponClone.scale` — see existing entries for format)
7. Reload the game to verify the baked value matches what you saw before the reload. If yes, commit.

This is the workflow that produced the working AK + M1911 anchors. The copy/paste is the cost of getting accurate values — accept it.

## What NOT to do

**Don't use `tools/pose_editor.html` for tuning.** It renders weapons in a standalone Three.js scene whose pipeline (cs values, anchor parent, position math, no `ANIM_TUNE` class offset, no `sizeMul`) does not match `src/player.js` `setWeapon`. Values that look right in the pose editor land wildly wrong in-game. The pose editor's "Save to model_manifest.js" green button writes those wrong values directly to disk.

This burned ~1 hour of user time on 2026-05-17 — 27 weapons tuned in the pose editor, all of which needed to be wiped because the in-game render didn't match the preview. Migration math (translating saved values to the player.js frame) is **approximate at best** because the parent transforms differ (pose editor's `gunAnchor` is a fixed Object3D; in-game it's a rig hand-bone with its own rotation/scale and per-frame animation state). Some axes are recoverable, others aren't.

**If you must improve the pose editor**, write a parity test FIRST: load the same weapon in both the pose editor and the live game, dump the world transform chain of `clone` in each, assert they're identical. Only build features after parity is green. Otherwise just delete `tools/pose_editor.html` and skip this trap entirely.

The same warning applies to **any future preview/abstraction tool** that renders gameplay values in a separate harness — anim previewers, balance dashboards, FX testers. Verify parity or tune in-runtime.

## Other state in working tree (uncommitted, unrelated)

The session-start git status showed a lot of noise that's unrelated to this branch's work and shouldn't be committed without inspection:

- **Asset reshuffle** under `Assets/models/melee/`, `Assets/models/tools/`, `Assets/models/weapons/` — many FBX deletions and modifications. Looks like a separate melee-asset cleanup mid-flight. Don't blindly commit.
- **`audits/*.md` mass-deleted** — looks like a cleanup of stale worker output. Probably safe to commit if you want; ask the user first.
- **`src/ui_hideout.js`** — 4 lines changed. Unrelated to weapons; inspect before committing.
- **Untracked `.mc/arm-fix-*.png`** screenshots + scripts — looked like a pistol arm-alignment debugging session. Not committed; ask the user.

Run `git status` and triage with the user before bundling any of these into commits.

## Memory files (Claude-specific, won't auto-load for Codex)

The previous Claude operator maintained a per-project memory store at:

```
C:\Users\Landon\.claude\projects\C--work-personal-cold-exit\memory\
```

These markdown files capture user preferences, project decisions, and lessons-learned that the user has accumulated over many sessions. Codex won't auto-load them, but the high-value entries for this branch are:

- `project_gun_pack_swap_wip.md` — branch context and tuning strategy notes (memory may be slightly stale on the post-2026-05-17 revert; trust this HANDOFF.md for current state)
- `feedback_no_runtime_abstraction_tools.md` — **the key lesson from this session**. Don't build preview/abstraction tools without verified parity to the consumer runtime.
- `feedback_glb_only_no_fbx_runtime.md` — runtime loads GLB only; convert FBX via `tools/blender-fbx-to-glb.py` at asset-import time
- `project_anim_system_state.md` — player on GASP rig, enemies on procgen; don't churn the unused Phase 1-4 anim modules
- `project_upper_body_ik_disabled.md` — IK is OFF by default; clips drive arms/spine. Re-enabling IK has historically caused arm-vs-gun problems
- `project_kill_run_arm_swing_failed.md` — multi-day attempt 2026-05-08 that burned 10+ commits. **DO NOT** re-attempt run-cycle arm-swing strip via mixer track stripping.

Open these in a text editor or convert the relevant guidance into `PROJECT.md` if Codex needs it inline.

## Project conventions to keep

Per `CLAUDE.md` and `PROJECT.md`:
- Coding standards: no hardcoded gameplay values (config in `src/balance.js`), `dt` everywhere (no per-frame counts), events between systems (no direct cross-imports between UI/combat/inventory), state machines with explicit transition tables, bug fixes get a regression note (`// REGRESSION: bug-NN — ...`)
- Pre-commit hook at `.git/hooks/pre-commit` flags violations as warnings (non-blocking)
- Discord channel `#cold-exit-ideas` is the canonical home for backlog items + design ideas (via `node ../../mission-control/scripts/post-backlog.mjs`); `BACKLOG.md` is for permanent / shipping-blocker scope only

## Suggested next session

1. Pick the easiest pending class to tune (probably `smg` — many meshes, similar shape) and do per-mesh passes via the in-game console workflow above.
2. Bake values one weapon at a time, reload to verify, commit per weapon or per class.
3. After smg, move to shotgun → sniper → lmg → flame.
4. Once all classes are tuned, merge `gun-pack-swap` into `main` (PR or direct push per project convention) and tag the release.

Good luck. The pack is solid; the wiring is solid; only the per-mesh tuning is left.
