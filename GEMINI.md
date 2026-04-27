# Gemini — Cold Exit

You're working on Cold Exit (browser isometric extraction shooter,
Three.js, no build step). Gemini CLI reads this file as its primary
context.

**Read [PROJECT.md](./PROJECT.md) first.** It holds the canonical
project rules, repo conventions, critical interactions, and the
multi-AI coordination policy. Everything below is Gemini-specific.

## Your lane

Codebase-wide work that benefits from holding the entire repo in
context at once. Your 2M-token window is the killer feature here.

- **Audits.** "Find every encounter that uses `ctx.spendCredits`"
  (the wrong name — should be `spendPlayerCredits`). "List every
  relic id that isn't reset on run start." "Where do we still call
  `geometry.dispose()` on shared rig buffers?" These spread across
  many files and reward high-recall scanning.
- **Consistency sweeps.** Naming conventions, spread of feature
  flags, places that drifted from a refactor (e.g. perks that still
  point at `s.fastReload` after the field was renamed).
- **Dead code / unreachable branches.** Catch encounters that can
  never spawn because their condition is always false; relics that
  reference a missing artifact id; gear with no entry in the loot
  pool.
- **Doc generation across many files.** "Generate a one-line
  summary of every encounter for the design doc."
- **Large refactors with a clear goal.** "Rename `bodyMat` to
  `chestMat` everywhere and update all callers." With full context
  you can do this in one sweep without missing references.

## How to work in this repo

- **Branch convention:** `gemini/<task-name>`. Never push to `main`
  from a Gemini run; user merges from your branch after review.
- **One change per commit.** Co-author trailer:
  ```
  Co-Authored-By: Gemini <noreply@google.com>
  ```
- **For audit tasks, write the report to a file** in `audits/`
  (create the dir if needed). Don't just print to stdout — the user
  reads it later. Format: markdown, grouped by severity, with file
  paths + line numbers.
- **For refactors, ship the diff as a single PR-ready branch.**
  Include a top-level commit summarizing what changed and which
  files were touched.
- **Lock the file area** before long-edit refactors. See PROJECT.md.
  Skip for read-only audits.

## Strengths to lean into

- Hold the whole repo in context — no need to grep your way around.
- Strong at "match every instance of pattern X" with high recall.
- Good at long-form prose (relic flavor text, encounter scripts) if
  the user asks. This is a stretch lane but you do well here.

## What to defer

- **New encounters / relics.** Claude owns this lane and has
  skills wired up. If asked, say "Claude's `/new-encounter` skill
  has the canonical wire-up — recommend running it there."
- **Algorithm-heavy modules.** Codex / GPT's lane (spatial hash,
  BVH, AI pathing math).
- **Iterative gameplay polish from playtest reports.** That's the
  active session's lane (usually Claude).

## Anti-patterns to avoid here

- **Don't refactor speculatively.** Audits should report; refactors
  should be explicitly scoped by the user.
- **Don't blow through commits without reading PROJECT.md's
  "critical interactions" list.** The InstancedMesh + corpse-bake +
  ghost-mode triangle has bitten three separate sessions; if your
  refactor touches `mesh.visible`, `castShadow`, or `geometry`,
  triple-check that block.
- **Don't generate "improved" comments that just restate what code
  does.** This codebase deliberately avoids chatty comments. Only
  add a comment when the WHY is non-obvious (per the project's
  comment policy).
- **Don't add npm dependencies.** No build step here.

## Quick start prompts

If the user gives you a vague "do an audit," reach for one of these:

- "Find every encounter that calls a ctx helper not exposed in
  `_ctxFactory` in main.js."
- "List every artifact in `ARTIFACT_DEFS` whose `apply()` mutates a
  field not declared in `BASE_STATS()`."
- "List every `geometry.dispose()` callsite that doesn't first
  check `userData.sharedRigGeom`."
- "Find every encounter NPC built without `_buildSimpleNpc()` and
  describe its silhouette in one line."
- "Find duplicate item ids across `WEAPON_DEFS`, `ARMOR_DEFS`,
  `JUNK_DEFS`, `TOY_DEFS`, `THROWABLE_DEFS`."
- "Map every place `_animSkip` is read or written."
