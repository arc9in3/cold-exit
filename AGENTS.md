# Codex / GPT — Cold Exit

You're working on Cold Exit (browser isometric extraction shooter,
Three.js, no build step). Codex CLI / OpenAI agent tooling reads this
file as its primary context.

**Read [PROJECT.md](./PROJECT.md) first.** It holds the canonical
project rules, repo conventions, critical interactions, and the
multi-AI coordination policy. Everything below is Codex-specific.

## Your lane

Algorithm-heavy modules and isolated unit work where pure-CS
reasoning earns its keep. Specifically:

- **Spatial hash for AI proximity / LoS queries.** Currently
  `gunman.update()` does `O(enemies × shieldBearers × walls)` checks
  per frame. A `5×5m` grid hash recomputed once per frame makes most
  of these `O(1)`. This is the next big perf swing after the
  InstancedMesh + LOD work Claude already shipped.
- **BVH / projectile-vs-obstacle accelerator.** `_hitsObstacle` in
  `projectiles.js` walks every solid obstacle on every projectile
  step. With grenades + flames + sniper shots in flight, this gets
  fat. A precomputed BVH over `level.solidObstacles()` would close it.
- **Math-heavy VFX modules.** Bezier-pathed throwables, particle
  pool optimization, post-fx tweaks. Pure float math, easy to test.
- **AI pathing improvements.** The current AI walks straight at the
  player; a real flow field or A* on a grid would be a meaningful
  upgrade for late-game floors.
- **Tools / scripts.** `tools/unity_to_gltf.py` and similar offline
  asset pipeline work — concrete inputs/outputs, easy to verify.

## How to work in this repo

- **Branch convention:** `codex/<task-name>`. Never push to `main`
  from a Codex run; the user merges from your branch after review.
- **One change per commit.** Co-author trailer:
  ```
  Co-Authored-By: GPT (Codex) <noreply@openai.com>
  ```
- **Deploy when shipping a measurable change** (the user wants to
  test it): `npx wrangler pages deploy . --project-name=cold-exit --commit-dirty=true`.
  Skip the deploy on pure-refactor commits with no behavioural change.
- **Lock the file area** before long edits. See `PROJECT.md`'s lock
  convention. Skip for sub-minute single-file fixes.

## Strengths to lean into

- Strong at "implement this algorithm given a precise spec." Ask the
  user for the spec if it's vague rather than guessing.
- Good at image-aware UI feedback when given a screenshot.
- Good at iterating with `aider`-style commit-per-change discipline.
- Good at writing tests for math-heavy code.

## What to defer

- **Encounters / relics / weapons.** Claude owns this lane and has
  the `/new-relic` + `/new-encounter` skills wired up. The wire-up
  has lots of small touchpoints (ctx factory, recomputeStats,
  filterUnownedArtifactIds, etc.) that get easy to miss without
  context. If the user asks Codex for a relic, say "Claude has a
  skill for this — recommend running it there."
- **Cross-file gameplay invariants** (rig instancer + corpse bake +
  ghost mode). These are Claude's bread and butter and have recent
  commits worth reading.
- **Audits / consistency sweeps.** That's Gemini's lane.

## Anti-patterns to avoid here

- Don't add new abstractions for "future flexibility." This codebase
  ships fast; adding generic interfaces now means refactoring twice.
- Don't restructure modules without explicit user approval. The file
  layout is intentional and there are circular-import landmines.
- Don't introduce npm dependencies. There's no build step; we serve
  directly from a CDN-imported Three.js plus local ES modules.
- Don't write tests speculatively for code the user hasn't asked you
  to test. Math-heavy modules YOU write are the exception.
