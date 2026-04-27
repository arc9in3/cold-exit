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

### Who arbitrates merges

The user makes every merge decision. No AI auto-merges to `main`.

For pre-merge review on branches you did NOT author:
- **Codex / Gemini branches** → reviewed by Claude when the user asks.
  Claude reads the diff, sanity-checks against the "critical
  interactions" list above, gives a thumbs-up/down with risk notes.
- **Claude branches** → reviewed by the user (or `/ultrareview`).
  Claude does NOT review its own work.

In all cases the user is the final gate.

### REQUIRED pre-edit sequence

Before you write a single line, ALWAYS run this sequence. Failures
here have caused multi-branch contamination in past sessions.

```bash
# 1. Verify clean tree on a known branch.
git status                   # MUST be clean. If not, STOP and ask.
git branch --show-current    # MUST be `main`. If not, STOP and ask.

# 2. Pull the latest main.
git fetch origin
git pull --ff-only origin main

# 3. Create + check out YOUR branch. Both steps in one command:
git checkout -b <your-prefix>/<task-slug>
# Example:  git checkout -b codex/spatial-hash
#           git checkout -b gemini/audit-encounter-ctx
#           git checkout -b claude/molotov-rework

# 4. CONFIRM the checkout actually happened.
git branch --show-current    # MUST print your new branch name.

# 5. (Optional) claim a lock for hot-file work — see locks below.

# 6. Edit. Commit early — every meaningful step gets a commit.

# 7. PUSH IMMEDIATELY after the first commit so work isn't local-only.
git push -u origin <your-prefix>/<task-slug>

# 8. Continue committing + pushing as you work.
```

**`git checkout -b` is non-negotiable.** Past failure mode: an AI ran
`git branch <name>` (creates a pointer but doesn't switch) and then
edited files. The edits landed on whatever branch was previously
checked out — usually somebody else's work in progress. The `-b` flag
to `checkout` does both steps atomically; use it.

**Push immediately after first commit** so your work is on the remote
even if your shell crashes or another AI nukes the working tree.

### Branch + commit etiquette

- Branch names are owner-prefixed: `claude/<task>`, `gemini/<task>`,
  `codex/<task>`. **Never commit directly to `main` from an AI tool**
  except for the active session the user is driving.
- The active session can ship to main (the historical pattern in this
  repo). Background AIs always branch.
- One change per commit. Co-author trailer required.
- One task = one branch. Don't pile multiple unrelated changes onto
  the same branch.

### Verification before declaring success

Before you tell the user "I shipped the X task," run these and verify:

```bash
# Your branch exists locally AND on remote.
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name @{upstream}

# Your commits are present.
git log origin/main..HEAD --oneline

# Working tree is clean (no untracked or modified files).
git status
```

Tell the user the actual state in your handoff message:
- Branch name
- Commit shas + one-line summaries
- That you verified the branch is pushed
- Any deferred work or open questions

Don't say "I created the branch and wrote the report" if you only ran
`git branch <name>` and dropped a file in the working tree. That's
how the encounter-ctx audit got lost on Apr 27 — fixed by hand.

### Shared task queue

`tasks.md` at repo root holds the open backlog. Each entry has an
owner (`claude` / `gemini` / `codex` / `unassigned`) and a status
(`open` / `in-progress` / `done`).

**Read `tasks.md` BEFORE you start work.** Specifically:
- Confirm no other AI has already claimed this task (status
  `in-progress` with a different owner).
- Flip your task to `in-progress` and assign yourself in the SAME
  commit you start work on, so the queue stays accurate.
- Flip to `done` when the branch is pushed AND the user has merged.
  Don't mark it `done` while still on your branch — it isn't done
  until it's in main.

### File locks

Long-running edits to a hot file should claim a lock so two agents
don't conflict. Touch a file in `.locks/` named after the area:

```
.locks/encounters.lock        # any work in src/encounters.js
.locks/combat.lock            # combat.js, projectiles.js
.locks/main.lock              # src/main.js
.locks/level.lock             # level.js, level generation
.locks/rig.lock               # actor_rig.js, rig_instancer.js, gunman.js, melee_enemy.js
.locks/inventory.lock         # inventory.js, attachments.js, gear / loot
.locks/ui.lock                # ui_*.js
```

Lock file content is plain text: `<branch>:<one-line description>`.
Release by deleting the file when you commit. If a lock is older
than 24h, it's stale — assume the previous agent crashed and reclaim
it.

Check for an existing lock BEFORE editing:

```bash
ls .locks/<area>.lock 2>/dev/null && echo "LOCKED — read it before continuing"
cat .locks/<area>.lock 2>/dev/null
```

If a lock exists and isn't yours, STOP and tell the user. Don't try
to coordinate around it silently.

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
