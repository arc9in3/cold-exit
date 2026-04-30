// Hidden encounter-tier formula. The player NEVER sees this number.
// Encounters in encounters.js carry a `tier: 0..3`; the level-gen
// roller filters the eligible pool to `tier <= computeCurrentTier()`.
//
// Inputs read from prefs.js (single source of truth so the formula
// adapts as the player meta-progresses):
//   runCount         — lifetime runs ended (death OR extract)
//   contractRank     — contracts successfully claimed
//   megabossKills    — lifetime mega-boss kills
//   sigilsLifetime   — total sigils ever earned (NOT current balance —
//                      spending sigils must not relock content)
//
// Why the soft blend: any single input alone is gameable. runCount
// rewards repetition; contractRank rewards risk-taking; megabossKills
// rewards skill; sigilsLifetime rewards committing to lethal contracts.
// A new player needs SOME progression to taste tier 1 quickly (~5-8
// runs), but tier 3 demands all four contributors.
//
// Threshold targets (rough):
//   tier 0  always (covers all default encounters)
//   tier 1  ~5-10 runs in (or earlier with good contract play)
//   tier 2  ~25 runs in OR a few mega-boss kills + contracts
//   tier 3  late-game; multi-vector commitment

import {
  getRunCount, getContractRank, getMegabossKills, getSigilsLifetime,
} from './prefs.js';

// Each input contributes a weight; sum is bucketed into 0..3.
//
//   runCount        / 4    — early progression
//   contractRank    / 3    — slightly faster than raw runs
//   megabossKills   * 2    — one kill = significant
//   sigilsLifetime  / 2    — sigils are rare; each one matters
//
// Caps are deliberate so a single dimension can't push past tier 2 by
// itself — the design wants players to engage multiple meta loops.
function _score(state) {
  const runs   = Math.min(15, (state.runCount        | 0) / 4);
  const rank   = Math.min(15, (state.contractRank    | 0) / 3);
  const bosses = Math.min(20, (state.megabossKills   | 0) * 2);
  const sigils = Math.min(15, (state.sigilsLifetime  | 0) / 2);
  return runs + rank + bosses + sigils;
}

// Tier bucket boundaries on the score above. Tuned so:
//   <  4   → tier 0 (everyone)
//   4-10  → tier 1 (a handful of runs in)
//   10-25 → tier 2 (committed player)
//   25+   → tier 3 (late-game, multi-vector progression)
export function computeCurrentTier(state) {
  const s = _score(state || {});
  if (s >= 25) return 3;
  if (s >= 10) return 2;
  if (s >= 4)  return 1;
  return 0;
}

// Read the live state from prefs and resolve the player's current
// tier. This is the function level.js calls.
export function currentEncounterTier() {
  return computeCurrentTier({
    runCount:       getRunCount(),
    contractRank:   getContractRank(),
    megabossKills:  getMegabossKills(),
    sigilsLifetime: getSigilsLifetime(),
  });
}

// Eligibility predicate for the level-gen roller. Returns true if
// the encounter def is allowed in the current pool, factoring tier
// gate, completion set, and run-cooldown table. Followup-queue
// placement is handled separately (it bypasses this filter).
//   def              — encounter def, possibly with `tier`, `cooldownRuns`
//   completedSet     — Set<string> of done-once encounter ids
//   cooldownMap      — { id: unsuppressAtRun } map
//   currentRun       — current run index (for cooldown comparison)
//   currentTier      — result of currentEncounterTier()
export function isEncounterEligible(def, completedSet, cooldownMap, currentRun, currentTier) {
  if (!def || !def.id) return false;
  // Tier gate intentionally disabled — every non-chained encounter
  // is in the pool from the start. Chained encounters (e.g. Curse
  // Breaker → Brass Prisoner) still gate themselves via their
  // per-def `condition()` function, so they remain dependency-locked
  // even with the tier system off.
  // if ((def.tier | 0) > (currentTier | 0)) return false;
  // Already-finished one-shot encounters.
  if (def.oncePerSave && completedSet && completedSet.has(def.id)) return false;
  // Run-cooldown.
  const unsuppressAt = cooldownMap?.[def.id];
  if (typeof unsuppressAt === 'number' && currentRun < unsuppressAt) return false;
  return true;
}
