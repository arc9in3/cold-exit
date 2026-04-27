# Cold Exit — task queue

Shared backlog across all AIs. Pick from `unassigned` if your lane
fits; flip to `in-progress` before you start; flip to `done` when
shipped. Every task line is one row in the table — keep it short.

Status legend: `open` (unassigned, ready) · `in-progress` ·
`blocked` · `done`.

## Active

| Task | Owner | Status | Notes |
|---|---|---|---|
| Spatial hash for AI proximity queries (gunman.update LoS / shield-bearer scan) | codex | blocked | Benchmark shows Map-backed hash slower than naive iteration at current and stress-scale counts. Revisit with flatter index or different approach. |
| BVH for `_hitsObstacle` projectile path | codex | open | Currently O(walls) per projectile step. |
| Audit: every encounter that calls a ctx helper not exposed in `_ctxFactory` | gemini | open | High-recall pass. Report to `audits/encounter-ctx.md`. |
| Audit: every `geometry.dispose()` callsite for `sharedRigGeom` guard | gemini | open | Past regression; verify no new gaps. Report to `audits/dispose-guard.md`. |
| Audit: artifact `apply()` mutations vs `BASE_STATS()` field declarations | gemini | open | Catches relics that mutate undefined fields. |
| Web Worker AI tick (perf plan #4) | unassigned | open | Wait for spatial hash + BVH first. |
| Melee enemy InstancedMesh integration | claude | open | Mirror the gunman hooks. Lower priority — most floors are gunman-heavy. |

## Done (last 7 days)

| Task | Owner | Shipped |
|---|---|---|
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
