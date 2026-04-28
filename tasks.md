# Cold Exit — task queue

Shared backlog across all AIs. Pick from `unassigned` if your lane
fits; flip to `in-progress` before you start; flip to `done` when
shipped. Every task line is one row in the table — keep it short.

Status legend: `open` (unassigned, ready) · `in-progress` ·
`blocked` · `done`.

## Active

| Task | Owner | Status | Notes |
|---|---|---|---|
| Web Worker AI tick (perf plan #4) | unassigned | open | Wait for BVH first. |
| Melee enemy InstancedMesh integration | claude | open | Mirror the gunman hooks. Lower priority — most floors are gunman-heavy. |
| Encounter audit: ambience props for remaining encounters | unassigned | open | royal_emissary, duck, sleeping_boss, fortune_teller, confession, sus, hoop_dreams, etc. Hook is `_placeAmbience(scene, ctx, disc, kind, ox, oz, yaw)` in encounters.js. |
| Shop NPC collision audit | unassigned | open | Verify merchant/healer/gunsmith/armorer/relicSeller/blackMarket NPCs register colliders. Pattern: `level.addEncounterCollider(x, z, w, d)` after spawn. |

## Done (last 7 days)

| Task | Owner | Shipped |
|---|---|---|
| Audit: `geometry.dispose()` sharedRigGeom guard (drones flagged ungoverned, safe today) | local-r1 | 2026-04-27 |
| Audit: artifact `apply()` mutations vs `BASE_STATS()` (7 undeclared fields surfaced) | local-r1 | 2026-04-27 |
| Refactor: rename `_baseBody` / `_baseHead` → `_normalBodyColor` / `_normalHeadColor` in gunman.js | local-qwen + claude | 2026-04-27 |
| Local AI integration — Ollama provider in dashboard + `tools/local-ai.mjs` runner | claude | 2026-04-27 |
| Phase 3 — Smart placement rules (keepouts, corner avoidance, perimeter bias, inward yaw, chair pairing, prop-loot, kiosk colliders, encounter colliders) | claude | 2026-04-27 |
| Loot-area pile prompt + grunt drop nerf, elite drop buff | claude | 2026-04-27 |
| Auto-reload on emptying the magazine | claude | 2026-04-27 |
| BVH/grid for `_hitsObstacle` (5.9x at current scale, 25x stress-scale) | codex | 2026-04-27 |
| Weapon FBX audit script (`tools/audit_weapon_fbx.py`) | codex | 2026-04-27 |
| Plain-English summary + tasks view + AI summary on review dashboard | claude | 2026-04-27 |
| Review dashboard tool (`tools/review-dashboard.mjs`) | claude | 2026-04-27 |
| Multi-AI scaffolding tightening (PROJECT.md required pre-edit) | claude | 2026-04-27 |
| Spatial hash perf experiment (closed — benchmark showed regression) | codex | 2026-04-27 |
| Audit: encounter ctx helpers (found showPrompt/closePrompt fix) | gemini | 2026-04-27 |
| Fix: actor_rig.js exposes rightArmMeshes (disarm hide) | claude | 2026-04-27 |
| Fix: showPrompt/closePrompt in `_ctxFactory` | claude | 2026-04-27 |
| Rig instancer for gunmen (perf #1d) | claude | 2026-04-27 |
| Geometry pool + shadow cuts + LOD revert | claude | 2026-04-27 |
| Encounter polish + molotov rework | claude | 2026-04-27 |
| Curse Breaker + Brass Prisoner + The Lamp | claude | 2026-04-27 |
| The Crow + Sus + Tailor encounters | claude | 2026-04-27 |

## Conventions

- Add new tasks at the bottom of the Active table. Don't gut the
  Done table — keep ~7 days of history so the team can see trends.
- One task = one branch. Branch naming: `<owner>/<short-slug>`.
- Lock the file area in `.locks/` before starting if your task
  touches a hot file (encounters / combat / main / level).
- If a task gets blocked, flip status + add a one-line "why" so
  whoever picks it up knows what changed.
