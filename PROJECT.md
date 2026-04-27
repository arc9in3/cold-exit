# Cold Exit — shared project context

This is the canonical project context every AI assistant on this repo
reads. Each AI's tool-specific file (`CLAUDE.md`, `AGENTS.md`,
`GEMINI.md`) is a thin wrapper that points here for the rules and
adds its own lane-specific guidance on top.

If you're an AI working on this codebase, read this file in full.

## What this project is

Cold Exit — a browser-based isometric extraction shooter built on
Three.js (no build step, ES modules + importmap). Deployed to
Cloudflare Pages at `cold-exit.pages.dev`. Iterating fast in a
late-polish phase: features ship daily, builds are tested in browser,
playtest feedback drives the next change.

The art style is **primitive procedural rigs** (cylinders + spheres
+ boxes built into a humanoid silhouette). FBX weapon models load on
top via `tools/unity_to_gltf.py` → `gltf_cache.js`. Encounter NPCs
share the same rig builder for visual consistency.

## How we work

- **Ship-it-now over plan-first.** In polish phase, go straight to
  commits + deploys. Skip multi-bullet plans unless there's a real
  UX fork. Trust your judgment — the user can revert if needed.
- **Find the fun first.** Bias toward playable primitives over
  polished systems. A working ugly thing beats a beautiful spec.
- **One change per commit.** Easier to revert + review.
- **Co-author every commit:** add `Co-Authored-By: <AI Name> <noreply@anthropic.com>`
  (or the equivalent for your tool) so we can see who did what later.
- **Deploy after every meaningful commit:**
  ```
  npx wrangler pages deploy . --project-name=cold-exit --commit-dirty=true
  ```
  The user is pre-authorized; don't ask before deploying.

## Repo conventions

- ES modules, Three.js r161 via importmap. No bundler.
- Geometry primitives are pooled — `actor_rig.js` has `_geomCache`.
  **Never call `geometry.dispose()` on a mesh whose geometry has
  `userData.sharedRigGeom = true`** — disposing kills every other
  actor sharing that buffer.
- Encounters live in `src/encounters.js` keyed by id in `ENCOUNTER_DEFS`.
  Helpers attached to the encounter ctx live in `src/main.js` near
  `_ctxFactory` (~line 1940-2270).
- Relics live in `src/artifacts.js` `ARTIFACT_DEFS`; they auto-apply
  via `apply(s)` against the derived stats bag in `recomputeStats`.
- Stats bag fields documented in `src/skills.js` `BASE_STATS`.
- Inventory is the source of truth — items have grid footprints
  (`stampItemDims`) and live in pockets/rig/backpack grids.
- Hot per-frame paths: `src/main.js` game loop, `src/gunman.js`
  `update()`, `src/melee_enemy.js` `update()`. Don't allocate in here.
- Materials per-actor (per-rig); geometries shared. The rig
  instancer (`src/rig_instancer.js`) collapses gunman draw calls into
  shared `InstancedMesh` pools. Source meshes go `visible = false`
  but stay in scene graph for hit-tests + world-position lookups.

## Critical interactions to respect

These get broken by careless edits. If you touch nearby code, sanity
check these first:

1. **Hit-test pipeline.** `combat.raycast` uses an explicit target
   list from `gunman.hittables()` / `melees.hittables()`. Source
   meshes have `userData.zone` ('head' / 'torso' / 'leg' / 'arm') and
   `userData.owner` set at spawn — these MUST stay populated.
2. **Disarm + arm visibility.** When a gunman is disarmed, the right
   arm subtree goes invisible AND `rigInstancer.hideMeshes(rig.rightArmMeshes, true)`
   parks the InstancedMesh slots. Re-arm restores both.
3. **Corpse bake.** Before `swapInBakedCorpse`, the rig source
   meshes need `.visible = true` (they're invisible because of
   instancing) and the rig must be unregistered from the instancer.
4. **Ghost mode (out-of-LoS fresnel).** `_setEnemyGhost` swaps
   materials AND coordinates with the instancer (sets `_instHide` so
   the InstancedMesh stops drawing while the ghost material renders).
5. **Encounter ctx fields.** Helpers (`spawnLoot`, `spawnSpeech`,
   `markEncounterComplete`, `relicFor`, `getPlayerCredits`,
   `spendPlayerCredits`, `awardPlayerCredits`, `pickBiggerBackpack`,
   etc.) are exposed via the ctx factory in main.js. **There is no
   `ctx.spendCredits` — use `spendPlayerCredits`.** That naming
   inconsistency has bitten multiple encounters.

## Multi-AI coordination

Three AIs work on this repo. Each owns a lane; lanes are aspirational
(do what's right in front of you), but the default is:

| AI | Lane |
|---|---|
| **Claude** | Iterative gameplay (encounters, relics, fixes, perf passes), cross-file invariants |
| **Gemini** | Codebase audits, consistency reviews, dead-code sweeps, large-context refactors |
| **Codex (GPT)** | Algorithm-heavy modules (spatial hash, AI pathing, math-heavy VFX), isolated unit work |

### Branch + commit etiquette

- Each AI commits to its own branch: `claude/<task>`, `gemini/<task>`,
  `codex/<task>`. **Never commit directly to `main` from an AI tool**
  except for the active session the user is driving.
- The active session can ship to main (the historical pattern in this
  repo). Background AIs always branch.
- One change per commit. Co-author trailer required.

### Shared task queue

`tasks.md` at repo root holds the open backlog. Each entry has an
owner (`claude` / `gemini` / `codex` / `unassigned`) and a status
(`open` / `in-progress` / `done`). Pick from `unassigned` if your
lane fits; flip to `in-progress` before you start; flip to `done`
when shipped.

### File locks

Long-running edits to a hot file should claim a lock so two agents
don't conflict. Touch a file in `.locks/` named after the area:

```
.locks/encounters.lock        # any work in src/encounters.js
.locks/combat.lock            # combat.js, projectiles.js
.locks/main.lock              # src/main.js
.locks/level.lock             # level.js, level generation
```

Lock file content is plain text: `<branch>:<one-line description>`.
Release by deleting the file. If a lock is older than 24h, it's
stale — assume the previous agent crashed and reclaim it.

This is crude but it works when 2-3 agents are running in parallel.
Skip it for single-file fixes that take less than a minute.

## Pre-authorized actions

The user does NOT need to be asked for these:
- Editing files, creating files, running tests
- `git commit` (always with co-author trailer)
- `git push` to a feature branch
- `npx wrangler pages deploy . --project-name=cold-exit --commit-dirty=true`
- Reading any file in the repo

The user DOES need to be asked for:
- `git push` directly to `main` (only the active interactive session
  should do this without asking; background agents always branch)
- `git reset --hard`, `git push --force`, branch deletion
- Removing or downgrading dependencies
- Anything that changes `.gitignore`, CI config, or third-party services
- Sending external messages (Slack, GitHub PR comments)

## Memory + skills

Claude maintains a project-memory directory at
`C:\Users\Landon\.claude\projects\C--work-personal-tacticalrogue\memory\`.
Read it for accumulated context (user role, feedback, project
decisions).

The repo's `.claude/skills/` dir holds shared skills:
- `/new-relic` — adds a relic with the canonical wire-up
- `/new-encounter` — adds an encounter with the canonical wire-up

Other AI tools should treat these skill files as documentation: read
the SKILL.md, follow the same checklist, just don't call them as
slash commands (they're Claude-specific).
