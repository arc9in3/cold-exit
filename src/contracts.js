// Contracts — daily/weekly modifier challenges the player picks up at
// the hideout's Contractor panel. Each contract is a one-line goal
// with a chip reward. The active contract is evaluated on extract /
// death; if passed, awardPersistentChips(reward) fires.
//
// A contract def is { id, label, blurb, kind, period, reward, evaluate(snapshot) }.
//   - id: stable key. Stored on the player's active contract row.
//   - label: short human-readable title.
//   - blurb: one-line goal description shown in the hideout.
//   - kind: 'daily' | 'weekly'. Determines the chip-reward tier and
//     refresh cadence.
//   - period: 'daily' = 24h, 'weekly' = 7 * 24h. Used by pickContractFor*
//     helpers below to compute expiresAt.
//   - reward: chips paid on completion.
//   - evaluate(snapshot): returns true on success, false otherwise.
//     `snapshot` is the RunStats payload at run-end (extract or death)
//     plus a `runEvents` object with contract-relevant flags (see
//     CONTRACT_EVENT_FIELDS for the schema).
//
// Snapshot shape (extension of leaderboard.js RunStats — those fields
// are real today, plus the new event-flag fields below):
// {
//   credits, levels, damage, kills, kills_head,    // from RunStats
//   tainted, restartCount, deathLevel,
//   // run-events extension (NEW; tracked through the run):
//   extracted: bool,             // true if run ended via extract, false if death
//   peakLevel: number,           // same as `levels`, exposed under a stable name
//   pistolOnly: bool,            // true if no non-pistol fire was registered
//   noConsumables: bool,         // true if no consumable item used during run
//   noMelee: bool,               // true if no melee swing landed
//   critHeadshots: number,       // headshot kills tagged crit
//   throwableKills: number,      // kills credited to throwables
// }

// --- Contract event-tracking schema -----------------------------------
// New fields the run loop sets / increments. RunStats.reset() clears
// these; main.js mutates them at the same sites that already update
// runStats. We add this object to the snapshot returned by
// runStats.snapshot() at end-of-run.
export const CONTRACT_EVENT_FIELDS = {
  extracted: false,
  pistolOnly: true,           // starts true, flips false when a non-pistol fires
  noConsumables: true,
  noMelee: true,
  critHeadshots: 0,
  throwableKills: 0,
};

// --- Defs --------------------------------------------------------------
// Contracts are bounty-style missions: "kill N of <archetype>". Plain
// language, plain reward, plain progression. As the player ranks up,
// harder rarities surface — modifiers + restrictions appear ONLY on
// rare/epic/legendary tiers so an early player isn't faced with
// pistol-only missions on day one.
//
// Schema:
//   id          stable string key
//   label       human-readable mission title
//   rarity      'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
//   portrait    string id — visual icon for the contract card. Maps
//               to a glyph in the UI: 'dasher' | 'tank' | 'gunman' |
//               'melee' | 'sniper' | 'boss' | 'megaboss' | 'any'
//   targetType  'any' | 'dasher' | 'tank' | 'gunman' | 'melee' |
//               'sniper' | 'boss' | 'megaboss' — what to kill
//   targetCount number of kills required. Tracked via
//               runStats.archetypeKills[targetType].
//   perKillReward chips paid per qualifying kill (capped at
//               targetCount). Surfaces in the UI so the player
//               sees "+15c per kill" alongside the total.
//   reward      total chips paid on contract completion (separate
//               from per-kill — this is the bonus on top of the
//               per-kill chips, paid only when targetCount is hit)
//   marksReward marks floor on completion (rare/epic/legendary)
//   unlockedAt  predicates: { contractsCompleted, megabossKills, marks }
//   modifiers   only on rare+ — { weaponClass, enemyHpMult, etc. }
//   evaluate    optional override; defaults to targetType+targetCount
//
// Common contracts pay only via perKillReward + a small completion
// bonus. Higher rarities ramp both the per-kill rate AND the bonus,
// AND pay marks floors AND unlock sigils once that economy lands.
// Helper — auto-evaluator built from targetType + targetCount. Reads
// runStats.archetypeKills (a per-archetype counter populated by main.js
// at every kill site). Returns true once the kill count for the
// requested archetype passes the target. 'any' just sums total kills.
function _autoEval(def) {
  return (s) => {
    const need = def.targetCount | 0;
    if (!need) return false;
    if (def.targetType === 'any' || !def.targetType) {
      return (s.kills | 0) >= need;
    }
    if (def.targetType === 'megaboss') {
      return (s.megabossKillsThisRun | 0) >= need;
    }
    const ak = s.archetypeKills || {};
    return (ak[def.targetType] | 0) >= need;
  };
}
function _kill(def) {
  // Wraps a contract def with auto-evaluator + safe defaults.
  return {
    rarity: 'common',
    perKillReward: 10,
    reward: 0,
    marksReward: 0,
    unlockedAt: {},
    modifiers: {},
    targetType: 'any',
    targetCount: 5,
    portrait: 'any',
    kind: 'daily', period: 'daily',
    ...def,
    evaluate: def.evaluate || _autoEval(def),
    // Backwards-compat alias — older code reads `tier`. Map rarity to
    // the prior risky/lethal/standard scheme so render code that
    // hasn't been updated yet still works.
    tier: def.tier || (
      def.rarity === 'legendary' ? 'lethal'
        : def.rarity === 'epic' ? 'lethal'
        : def.rarity === 'rare' ? 'risky'
        : 'standard'
    ),
  };
}

export const CONTRACT_DEFS = {
  // ============= COMMON — always unlocked, no modifiers, plain kill goals =============
  common_clear_5: _kill({
    id: 'common_clear_5',
    label: 'Sweep the Block',
    rarity: 'common',
    portrait: 'any',
    targetType: 'any', targetCount: 5,
    perKillReward: 8, reward: 30,
  }),
  common_dashers_3: _kill({
    id: 'common_dashers_3',
    label: 'Outrun the Runners',
    rarity: 'common',
    portrait: 'dasher',
    targetType: 'dasher', targetCount: 3,
    perKillReward: 18, reward: 50,
  }),
  common_gunmen_5: _kill({
    id: 'common_gunmen_5',
    label: 'Suppress the Riflemen',
    rarity: 'common',
    portrait: 'gunman',
    targetType: 'gunman', targetCount: 5,
    perKillReward: 14, reward: 40,
  }),
  common_melee_8: _kill({
    id: 'common_melee_8',
    label: 'Hand to Hand',
    rarity: 'common',
    portrait: 'melee',
    targetType: 'melee', targetCount: 8,
    perKillReward: 10, reward: 40,
  }),
  common_clear_15: _kill({
    id: 'common_clear_15',
    label: 'Make Some Noise',
    rarity: 'common',
    portrait: 'any',
    targetType: 'any', targetCount: 15,
    perKillReward: 8, reward: 70,
  }),

  // ============= UNCOMMON — unlock at rank 3, bigger numbers, still no modifiers =====
  uncommon_dashers_8: _kill({
    id: 'uncommon_dashers_8',
    label: 'Faster Than They Look',
    rarity: 'uncommon',
    portrait: 'dasher',
    targetType: 'dasher', targetCount: 8,
    perKillReward: 22, reward: 110,
    unlockedAt: { contractsCompleted: 3 },
  }),
  uncommon_tanks_4: _kill({
    id: 'uncommon_tanks_4',
    label: 'Bring Down the Heavies',
    rarity: 'uncommon',
    portrait: 'tank',
    targetType: 'tank', targetCount: 4,
    perKillReward: 35, reward: 120,
    unlockedAt: { contractsCompleted: 3 },
  }),
  uncommon_clear_30: _kill({
    id: 'uncommon_clear_30',
    label: 'Body Count',
    rarity: 'uncommon',
    portrait: 'any',
    targetType: 'any', targetCount: 30,
    perKillReward: 10, reward: 150,
    unlockedAt: { contractsCompleted: 3 },
  }),
  uncommon_gunmen_15: _kill({
    id: 'uncommon_gunmen_15',
    label: 'Quiet the Watchers',
    rarity: 'uncommon',
    portrait: 'gunman',
    targetType: 'gunman', targetCount: 15,
    perKillReward: 18, reward: 130,
    unlockedAt: { contractsCompleted: 5 },
  }),

  // ============= RARE — unlock at rank 8, ONE mild modifier, marks floor ============
  rare_density_dashers: _kill({
    id: 'rare_density_dashers',
    label: 'They Sent More',
    rarity: 'rare',
    portrait: 'dasher',
    targetType: 'dasher', targetCount: 12,
    perKillReward: 32, reward: 220, marksReward: 6,
    unlockedAt: { contractsCompleted: 8 },
    modifiers: { spawnDensityMult: 1.3 },
  }),
  rare_tough_tanks: _kill({
    id: 'rare_tough_tanks',
    label: 'Reinforced Plating',
    rarity: 'rare',
    portrait: 'tank',
    targetType: 'tank', targetCount: 6,
    perKillReward: 50, reward: 250, marksReward: 8,
    unlockedAt: { contractsCompleted: 8 },
    modifiers: { enemyHpMult: 1.4 },
  }),
  rare_boss_hunt: _kill({
    id: 'rare_boss_hunt',
    label: 'Bag the Captain',
    rarity: 'rare',
    portrait: 'boss',
    targetType: 'boss', targetCount: 1,
    perKillReward: 200, reward: 200, marksReward: 10,
    unlockedAt: { contractsCompleted: 10 },
    modifiers: {},
  }),

  // ============= EPIC — unlock at rank 15, stacked modifiers ========================
  epic_press_wave: _kill({
    id: 'epic_press_wave',
    label: 'Press Wave',
    rarity: 'epic',
    portrait: 'any',
    targetType: 'any', targetCount: 50,
    perKillReward: 14, reward: 400, marksReward: 18,
    unlockedAt: { contractsCompleted: 15, megabossKills: 1 },
    modifiers: { spawnDensityMult: 1.5, enemyHpMult: 1.25 },
  }),
  epic_glass_cannon: _kill({
    id: 'epic_glass_cannon',
    label: 'Glass Cannon',
    rarity: 'epic',
    portrait: 'any',
    targetType: 'any', targetCount: 40,
    perKillReward: 18, reward: 500, marksReward: 22,
    unlockedAt: { contractsCompleted: 15, megabossKills: 1 },
    modifiers: { playerDamageTakenMult: 1.5, playerDamageDealtMult: 1.5 },
  }),
  epic_iron_will: _kill({
    id: 'epic_iron_will',
    label: 'Iron Will',
    rarity: 'epic',
    portrait: 'tank',
    targetType: 'tank', targetCount: 8,
    perKillReward: 80, reward: 600, marksReward: 28,
    unlockedAt: { contractsCompleted: 18, megabossKills: 1 },
    modifiers: { enemyHpMult: 1.75, noConsumables: true },
  }),

  // ============= LEGENDARY — unlock at rank 25 + 2 megabosses; the gauntlets =======
  legendary_pistolero: _kill({
    id: 'legendary_pistolero',
    label: 'Lone Pistol',
    rarity: 'legendary',
    portrait: 'gunman',
    targetType: 'gunman', targetCount: 25,
    perKillReward: 40, reward: 1000, marksReward: 40, sigilsReward: 2,
    unlockedAt: { contractsCompleted: 25, megabossKills: 2 },
    modifiers: { weaponClass: 'pistol' },
  }),
  legendary_knife_work: _kill({
    id: 'legendary_knife_work',
    label: 'Knife Work',
    rarity: 'legendary',
    portrait: 'melee',
    targetType: 'melee', targetCount: 30,
    perKillReward: 35, reward: 1000, marksReward: 40, sigilsReward: 2,
    unlockedAt: { contractsCompleted: 25, megabossKills: 2 },
    modifiers: { weaponClass: 'melee' },
  }),
  legendary_megaboss_hunt: _kill({
    id: 'legendary_megaboss_hunt',
    label: 'Megaboss Hunt',
    rarity: 'legendary',
    portrait: 'megaboss',
    targetType: 'megaboss', targetCount: 1,
    perKillReward: 1500, reward: 0, marksReward: 60, sigilsReward: 3,
    unlockedAt: { contractsCompleted: 30, megabossKills: 2 },
    modifiers: { enemyDamageMult: 1.5 },
  }),
};

// Returns true if `def` is unlocked given current persistent state.
// `state` shape: { contractsCompleted, megabossKills, marks }. Missing
// fields default to 0 (i.e. unmet).
export function isContractUnlocked(def, state) {
  const u = def?.unlockedAt;
  if (!u) return true;
  if ((u.contractsCompleted | 0) > 0 && ((state?.contractsCompleted | 0) < u.contractsCompleted)) return false;
  if ((u.megabossKills | 0) > 0 && ((state?.megabossKills | 0) < u.megabossKills)) return false;
  if ((u.marks | 0) > 0 && ((state?.marks | 0) < u.marks)) return false;
  return true;
}

// Computes a difficulty score from the contract's hard rules. Each
// rule contributes a weight; the score feeds the auto-derived reward
// multipliers below. This keeps content authoring cheap: defs only
// state the rules, the engine offsets the math.
//
//   weaponClass restriction (pistol / melee)   +0.40
//   noConsumables                              +0.20
//   enemyHpMult > 1                            +(mult - 1) * 0.80
//   enemyDamageMult > 1                        +(mult - 1) * 0.70
//   spawnDensityMult > 1                       +(mult - 1) * 0.50
//   eliteChanceMult > 1                        +(mult - 1) * 0.40
//   playerDamageTakenMult > 1                  +(mult - 1) * 0.60
//   playerDamageDealtMult < 1                  +(1 - mult) * 0.60
//
// (playerDamageDealtMult > 1 is a *buff*, not a punishment, so it
// doesn't add to the score. Glass-cannon "+50% taken / +50% dealt"
// nets out at +0.30 from the taken-damage side only.)
export function difficultyScore(def) {
  const m = def?.modifiers || {};
  let score = 0;
  if (m.weaponClass) score += 0.4;
  if (m.noConsumables) score += 0.2;
  if ((m.enemyHpMult || 1) > 1) score += ((m.enemyHpMult || 1) - 1) * 0.8;
  if ((m.enemyDamageMult || 1) > 1) score += ((m.enemyDamageMult || 1) - 1) * 0.7;
  if ((m.spawnDensityMult || 1) > 1) score += ((m.spawnDensityMult || 1) - 1) * 0.5;
  if ((m.eliteChanceMult || 1) > 1) score += ((m.eliteChanceMult || 1) - 1) * 0.4;
  if ((m.playerDamageTakenMult || 1) > 1) score += ((m.playerDamageTakenMult || 1) - 1) * 0.6;
  if ((m.playerDamageDealtMult || 1) < 1) score += (1 - (m.playerDamageDealtMult || 1)) * 0.6;
  return score;
}

// Build the run-time modifier object the gameplay code actually
// reads. Empty modifiers object on the def collapses to a clean
// no-op default. `lootQualityMult`, `chipsMult`, `marksMult` are
// auto-derived counter-pressure offsets that scale with the
// difficulty score so harder rules pay better without needing
// per-contract hand-tuning.
export function buildModifiers(def) {
  const m = def?.modifiers || {};
  const score = difficultyScore(def);
  return {
    weaponClass: m.weaponClass || null,        // 'pistol' | 'melee' | null
    enemyHpMult: m.enemyHpMult || 1,
    enemyDamageMult: m.enemyDamageMult || 1,
    spawnDensityMult: m.spawnDensityMult || 1,
    eliteChanceMult: m.eliteChanceMult || 1,
    playerDamageTakenMult: m.playerDamageTakenMult || 1,
    playerDamageDealtMult: m.playerDamageDealtMult || 1,
    noConsumables: !!m.noConsumables,
    // Auto-derived counter-pressure. Override by setting the field
    // explicitly on a def's `modifiers` block — explicit values win.
    lootQualityMult: m.lootQualityMult || (1 + score * 0.5),
    chipsMult: m.chipsMult || (1 + score * 0.6),
    marksMult: m.marksMult || (1 + score * 0.6),
    _score: score,
  };
}

const DAILY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_MS = 7 * DAILY_MS;

// --- Roll helpers ------------------------------------------------------
// Pick a random daily contract. Caller passes a deterministic seed
// (e.g. the UTC day index) so two clients on the same date roll the
// same contract — useful for any future server-side parity check.
export function pickDailyContract(seed) {
  const dailies = Object.values(CONTRACT_DEFS).filter(c => c.kind === 'daily');
  if (!dailies.length) return null;
  const idx = Math.abs((seed | 0) % dailies.length);
  const def = dailies[idx];
  return {
    activeContractId: def.id,
    expiresAt: Date.now() + DAILY_MS,
    progress: {},
    claimedAt: 0,
  };
}

export function pickWeeklyContract(seed) {
  const weeklies = Object.values(CONTRACT_DEFS).filter(c => c.kind === 'weekly');
  if (!weeklies.length) return null;
  const idx = Math.abs((seed | 0) % weeklies.length);
  const def = weeklies[idx];
  return {
    activeContractId: def.id,
    expiresAt: Date.now() + WEEKLY_MS,
    progress: {},
    claimedAt: 0,
  };
}

// UTC day index — the integer number of days since the Unix epoch.
// Stable across timezones so the daily roll is the same for everyone.
export function utcDayIndex() {
  return Math.floor(Date.now() / DAILY_MS);
}
export function utcWeekIndex() {
  return Math.floor(Date.now() / WEEKLY_MS);
}

// True when the active contract row has expired and a new one should
// be rolled. Returns false on null/undefined contracts (those should
// be re-rolled freshly via pickDailyContract / pickWeeklyContract).
export function contractExpired(contract) {
  if (!contract) return true;
  return (contract.expiresAt | 0) > 0 && Date.now() >= contract.expiresAt;
}

// Resolve a contract id to its def. Returns null on unknown id.
export function defForId(id) {
  return id ? (CONTRACT_DEFS[id] || null) : null;
}

// Evaluate a contract against an end-of-run snapshot. Returns
// { def, passed, alreadyClaimed, reward }. Caller decides whether
// to award the chips and stamp claimedAt.
export function evaluateContract(activeContract, snapshot) {
  const def = defForId(activeContract?.activeContractId);
  if (!def) return { def: null, passed: false, alreadyClaimed: false, reward: 0 };
  if ((activeContract.claimedAt | 0) > 0) {
    return { def, passed: false, alreadyClaimed: true, reward: def.reward };
  }
  const passed = !!def.evaluate(snapshot);
  return { def, passed, alreadyClaimed: false, reward: def.reward };
}

// Convenience: award the contract reward + stamp the claim. main.js
// calls this on extract / death after building the snapshot. Returns
// { chips, marks } paid out, or zeros on no-op.
//   setActiveContractFn(updated) — persists the claimedAt stamp
//   awardChipsFn(amount) — pays out chips reward
//   awardMarksFn(amount) — pays out marks reward (optional; harder
//     tiers carry a marks floor in addition to chips)
//   bumpRankFn() — bumps the player's contract rank counter
export function tryClaimContract(activeContract, snapshot, setActiveContractFn, awardChipsFn, awardMarksFn, bumpRankFn, awardSigilsFn) {
  const { def, passed, alreadyClaimed, reward } = evaluateContract(activeContract, snapshot);
  if (!def || alreadyClaimed || !passed) return { chips: 0, marks: 0, sigils: 0 };
  const updated = { ...activeContract, claimedAt: Date.now() };
  if (typeof setActiveContractFn === 'function') setActiveContractFn(updated);
  const mods = buildModifiers(def);
  const chips = Math.round(reward * mods.chipsMult);
  const marks = Math.round((def.marksReward | 0) * mods.marksMult);
  const sigils = (def.sigilsReward | 0);   // sigils don't auto-scale; gated explicitly per-def
  if (typeof awardChipsFn === 'function' && chips > 0) awardChipsFn(chips);
  if (typeof awardMarksFn === 'function' && marks > 0) awardMarksFn(marks);
  if (typeof awardSigilsFn === 'function' && sigils > 0) awardSigilsFn(sigils);
  if (typeof bumpRankFn === 'function') bumpRankFn();
  return { chips, marks, sigils };
}

// runStats hook — hideout panel reads this to show live progress on
// contracts that have a "kill counter" or similar incremental shape.
// Currently most contracts evaluate at end-of-run only, so the live
// readout just shows a friendly "in progress" bar based on best-effort
// counters from the run-events snapshot.
export function liveProgressFor(contract, eventsSnapshot) {
  const def = defForId(contract?.activeContractId);
  if (!def || !eventsSnapshot) return { label: '', pct: 0 };
  switch (def.id) {
    case 'daily_kills_50':
      return { label: `${eventsSnapshot.kills | 0} / 50 kills`, pct: Math.min(1, (eventsSnapshot.kills | 0) / 50) };
    case 'daily_throwable_kills_10':
      return { label: `${eventsSnapshot.throwableKills | 0} / 10 thrown kills`, pct: Math.min(1, (eventsSnapshot.throwableKills | 0) / 10) };
    case 'daily_crit_heads_15':
      return { label: `${eventsSnapshot.critHeadshots | 0} / 15 crit headshots`, pct: Math.min(1, (eventsSnapshot.critHeadshots | 0) / 15) };
    default:
      return { label: 'In progress', pct: 0 };
  }
}
