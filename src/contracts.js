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
//   objective   (optional) basic-mechanic goal. When set, takes
//               precedence over targetType. One of:
//                 'kills_total'         — any-archetype kill count
//                 'containers_searched' — boxes / chests / props emptied
//                 'bodies_looted'       — corpses fully looted
//                 'credits_banked'      — chips earned this run
//                 'levels_extracted'    — floors completed via extract
//   targetType  'any' | 'dasher' | 'tank' | 'gunman' | 'melee' |
//               'sniper' | 'boss' | 'megaboss' — what to kill
//   targetCount number required (kills, searches, credits, etc.)
//               Tracked via the matching RunStats counter.
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
    // Basic-mechanic contracts read `objective` instead of
    // `targetType` — they're not bound to an enemy archetype.
    // Early-rank contracts use these so first-time players see
    // simple "do the thing the game already teaches" goals
    // (open boxes, pick up bodies, hit a chip threshold, finish
    // floors) before being asked to discriminate enemy types.
    switch (def.objective) {
      case 'containers_searched':  return (s.containersSearched | 0) >= need;
      case 'bodies_looted':        return (s.bodiesLooted | 0) >= need;
      case 'credits_banked':       return (s.credits | 0) >= need;
      case 'levels_extracted':     return (s.levelsExtracted | 0) >= need;
      case 'kills_total':          return (s.kills | 0) >= need;

      // Phase-1 stubs. Each new objective reads a runStats counter
      // that main.js will populate when the corresponding tracker
      // lands in Phase 2/3. Until then they evaluate to false (0 < N)
      // so no live contract relies on these without engine support.
      //
      // Per-floor flag counters (incremented on a successful extract
      // where the condition held that floor):
      case 'no_damage_floor':      return (s.noDamageFloors | 0) >= need;
      case 'no_reload_floor':      return (s.noReloadFloors | 0) >= need;
      case 'single_class_floor':   return (s.singleClassFloors | 0) >= need;
      case 'no_consumables_floor': return (s.noConsumableFloors | 0) >= need;
      case 'stealth_floor':        return (s.stealthFloors | 0) >= need;
      case 'pacifist_boss_floor':  return (s.pacifistBossFloors | 0) >= need;
      case 'sweeper_floor':        return (s.sweeperFloors | 0) >= need;
      // Running-total counters (cumulative across the run / contract):
      case 'headshots_total':      return (s.critHeadshots | 0) >= need;
      case 'headshot_streak':      return (s.maxHeadshotStreak | 0) >= need;
      case 'disarms':              return (s.disarms | 0) >= need;
      case 'multi_kills':          return (s.multiKills | 0) >= need;
      case 'distance_kills':       return (s.distanceKills | 0) >= need;
      case 'close_kills':          return (s.closeKills | 0) >= need;
    }
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

// Build a contract-relevant baseline from a runStats snapshot. Used at
// mid-run contract pickup (main.js) so progress-since-pickup is what
// counts, not progress-since-run-start. Hideout pickup happens between
// runs when runStats is at zero, so the baseline there is all zeros
// and a no-op.
//
// REGRESSION: contract-pre-pickup-progress — previous behavior counted
// kills/loot/credits/extracts the player had ALREADY done before
// picking up a mid-run contract, instantly satisfying contracts whose
// targetCount was below current run progress.
export function buildContractBaseline(runStatsSnapshot) {
  const s = runStatsSnapshot || {};
  return {
    kills: s.kills | 0,
    credits: s.credits | 0,
    containersSearched: s.containersSearched | 0,
    bodiesLooted: s.bodiesLooted | 0,
    levelsExtracted: s.levelsExtracted | 0,
    megabossKillsThisRun: s.megabossKillsThisRun | 0,
    archetypeKills: { ...(s.archetypeKills || {}) },
    critHeadshots: s.critHeadshots | 0,
    throwableKills: s.throwableKills | 0,
    // Phase-1 baseline fields for the new objective counters. main.js
    // doesn't populate these yet; baselines default to 0 so when the
    // counters DO land in Phase 2/3 the subtraction math is clean
    // (progress-since-pickup, not progress-since-run-start).
    noDamageFloors: s.noDamageFloors | 0,
    noReloadFloors: s.noReloadFloors | 0,
    singleClassFloors: s.singleClassFloors | 0,
    noConsumableFloors: s.noConsumableFloors | 0,
    stealthFloors: s.stealthFloors | 0,
    pacifistBossFloors: s.pacifistBossFloors | 0,
    sweeperFloors: s.sweeperFloors | 0,
    maxHeadshotStreak: s.maxHeadshotStreak | 0,
    disarms: s.disarms | 0,
    multiKills: s.multiKills | 0,
    distanceKills: s.distanceKills | 0,
    closeKills: s.closeKills | 0,
  };
}

// Subtract the pickup baseline from a current snapshot so contract
// evaluators / progress readouts see deltas instead of run totals.
// Returns a NEW object — does not mutate the input. Counters that
// aren't tracked in baseline pass through untouched.
function _subtractBaseline(snapshot, baseline) {
  if (!snapshot) return snapshot;
  if (!baseline) return snapshot;
  const out = { ...snapshot };
  out.kills = Math.max(0, (snapshot.kills | 0) - (baseline.kills | 0));
  out.credits = Math.max(0, (snapshot.credits | 0) - (baseline.credits | 0));
  out.containersSearched = Math.max(0, (snapshot.containersSearched | 0) - (baseline.containersSearched | 0));
  out.bodiesLooted = Math.max(0, (snapshot.bodiesLooted | 0) - (baseline.bodiesLooted | 0));
  out.levelsExtracted = Math.max(0, (snapshot.levelsExtracted | 0) - (baseline.levelsExtracted | 0));
  out.megabossKillsThisRun = Math.max(0, (snapshot.megabossKillsThisRun | 0) - (baseline.megabossKillsThisRun | 0));
  out.critHeadshots = Math.max(0, (snapshot.critHeadshots | 0) - (baseline.critHeadshots | 0));
  out.throwableKills = Math.max(0, (snapshot.throwableKills | 0) - (baseline.throwableKills | 0));
  // Phase-1 new counters — same delta-from-baseline pattern.
  out.noDamageFloors = Math.max(0, (snapshot.noDamageFloors | 0) - (baseline.noDamageFloors | 0));
  out.noReloadFloors = Math.max(0, (snapshot.noReloadFloors | 0) - (baseline.noReloadFloors | 0));
  out.singleClassFloors = Math.max(0, (snapshot.singleClassFloors | 0) - (baseline.singleClassFloors | 0));
  out.noConsumableFloors = Math.max(0, (snapshot.noConsumableFloors | 0) - (baseline.noConsumableFloors | 0));
  out.stealthFloors = Math.max(0, (snapshot.stealthFloors | 0) - (baseline.stealthFloors | 0));
  out.pacifistBossFloors = Math.max(0, (snapshot.pacifistBossFloors | 0) - (baseline.pacifistBossFloors | 0));
  out.sweeperFloors = Math.max(0, (snapshot.sweeperFloors | 0) - (baseline.sweeperFloors | 0));
  out.maxHeadshotStreak = Math.max(0, (snapshot.maxHeadshotStreak | 0) - (baseline.maxHeadshotStreak | 0));
  out.disarms = Math.max(0, (snapshot.disarms | 0) - (baseline.disarms | 0));
  out.multiKills = Math.max(0, (snapshot.multiKills | 0) - (baseline.multiKills | 0));
  out.distanceKills = Math.max(0, (snapshot.distanceKills | 0) - (baseline.distanceKills | 0));
  out.closeKills = Math.max(0, (snapshot.closeKills | 0) - (baseline.closeKills | 0));
  const ak = snapshot.archetypeKills || {};
  const bk = baseline.archetypeKills || {};
  const akOut = {};
  for (const k of Object.keys(ak)) akOut[k] = Math.max(0, (ak[k] | 0) - (bk[k] | 0));
  out.archetypeKills = akOut;
  return out;
}
// Per-rarity rank-point defaults — used when a contract def doesn't
// override `rankReward` / `rankPerKill` explicitly. Rarer contracts
// pay more both for completion and per qualifying kill, so taking
// harder contracts is the fastest path to rank-up.
const RANK_REWARD_BY_RARITY = {
  common:    5,
  uncommon:  12,
  rare:      25,
  epic:      60,
  legendary: 120,
};
const RANK_PER_KILL_BY_RARITY = {
  common:    0,
  uncommon:  0,
  rare:      1,
  epic:      2,
  legendary: 3,
};
export function rankRewardFor(def) {
  if (typeof def?.rankReward === 'number') return def.rankReward | 0;
  return RANK_REWARD_BY_RARITY[def?.rarity || 'common'] | 0;
}
export function rankPerKillFor(def) {
  if (typeof def?.rankPerKill === 'number') return def.rankPerKill | 0;
  return RANK_PER_KILL_BY_RARITY[def?.rarity || 'common'] | 0;
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
  // ============= COMMON — always unlocked. Basic-mechanic objectives only. =============
  // Day-one players get goals that exercise what the game already
  // teaches in the first 5 minutes: kill stuff, search boxes, loot
  // bodies, earn chips, finish floors. No archetype discrimination
  // (a new player can't tell a dasher from a gunman yet) and no
  // weapon-class restrictions. (2026-05-06: dropped common_melee_8
  // — melee-only contracts pushed brand-new players into a loadout
  // they hadn't unlocked options for.)
  common_clear_5: _kill({
    id: 'common_clear_5',
    image: 'firefight',
    label: 'Sweep the Block',
    rarity: 'common',
    portrait: 'any',
    objective: 'kills_total', targetCount: 5,
    perKillReward: 8, reward: 30,
  }),
  common_search_5: _kill({
    id: 'common_search_5',
    image: 'search_crates',
    label: 'Inventory Check',
    rarity: 'common',
    portrait: 'any',
    objective: 'containers_searched', targetCount: 5,
    perKillReward: 0, reward: 50,
  }),
  common_loot_5: _kill({
    id: 'common_loot_5',
    image: 'loot_bodies',
    label: 'Pat Them Down',
    rarity: 'common',
    portrait: 'any',
    objective: 'bodies_looted', targetCount: 5,
    perKillReward: 0, reward: 50,
  }),
  common_credits_300: _kill({
    id: 'common_credits_300',
    image: 'bank_credits',
    label: 'Make Bank',
    rarity: 'common',
    portrait: 'any',
    objective: 'credits_banked', targetCount: 300,
    perKillReward: 0, reward: 60,
  }),
  common_levels_2: _kill({
    id: 'common_levels_2',
    image: 'extract',
    label: 'Two and Out',
    rarity: 'common',
    portrait: 'any',
    objective: 'levels_extracted', targetCount: 2,
    perKillReward: 0, reward: 70,
  }),
  common_clear_15: _kill({
    id: 'common_clear_15',
    image: 'firefight',
    label: 'Make Some Noise',
    rarity: 'common',
    portrait: 'any',
    objective: 'kills_total', targetCount: 15,
    perKillReward: 8, reward: 70,
  }),

  // ============= UNCOMMON — unlock at rank 3, basic mechanics scaled up + first =======
  // archetype-specific kill goals. Still no modifiers.
  // Targets retuned 2026-05-06 v2 — every contract must be
  // completable in a single 3-5 floor run, no multi-run carry-over.
  // User: "the bigger score contract seems a little difficult
  // without another accompanying contract running?" Original counts
  // (15 / 15 / 900 / 4) assumed companion kill drips that the
  // single-active-contract model doesn't support.
  //
  // Reasoning per row, from the post-retune loot/empty rates:
  //   • containers ~25% non-empty, ~5/floor → ~5 searchable across
  //     a 4-floor run; pull from 15 → 8 (achievable with effort)
  //   • normal grunts 88% empty + sub-bosses always drop → ~8-12
  //     lootable bodies in a deep run; pull from 15 → 8
  //   • per-kill credit ramp 1.5×→2.0× × +12%/floor → ~600-1000c
  //     in a 4-floor extract; pull from 900 → 500
  //   • 4 successive extracts is a hard run; pull to 3 (the floor
  //     where the boss-flank starts pressuring) and gate behind
  //     a few contracts so it isn't the player's first uncommon
  uncommon_search_8: _kill({
    id: 'uncommon_search_8',
    image: 'search_crates',
    label: 'Toss the Block',
    rarity: 'uncommon',
    portrait: 'any',
    objective: 'containers_searched', targetCount: 8,
    perKillReward: 0, reward: 100,
    unlockedAt: { contractsCompleted: 3 },
  }),
  uncommon_loot_8: _kill({
    id: 'uncommon_loot_8',
    image: 'loot_bodies',
    label: 'Body Bagger',
    rarity: 'uncommon',
    portrait: 'any',
    objective: 'bodies_looted', targetCount: 8,
    perKillReward: 0, reward: 100,
    unlockedAt: { contractsCompleted: 3 },
  }),
  uncommon_credits_500: _kill({
    id: 'uncommon_credits_500',
    image: 'bank_credits',
    label: 'Bigger Score',
    rarity: 'uncommon',
    portrait: 'any',
    objective: 'credits_banked', targetCount: 500,
    perKillReward: 0, reward: 130,
    unlockedAt: { contractsCompleted: 3 },
  }),
  uncommon_levels_3: _kill({
    id: 'uncommon_levels_3',
    image: 'extract',
    label: 'Deep Dive',
    rarity: 'uncommon',
    portrait: 'any',
    objective: 'levels_extracted', targetCount: 3,
    perKillReward: 0, reward: 150,
    unlockedAt: { contractsCompleted: 5 },
  }),
  uncommon_dashers_8: _kill({
    id: 'uncommon_dashers_8',
    image: 'dasher_hunt',
    label: 'Faster Than They Look',
    rarity: 'uncommon',
    portrait: 'dasher',
    targetType: 'dasher', targetCount: 8,
    perKillReward: 22, reward: 110,
    unlockedAt: { contractsCompleted: 3 },
  }),
  uncommon_tanks_4: _kill({
    id: 'uncommon_tanks_4',
    image: 'tank_hunt',
    label: 'Bring Down the Heavies',
    rarity: 'uncommon',
    portrait: 'tank',
    targetType: 'tank', targetCount: 4,
    perKillReward: 35, reward: 120,
    unlockedAt: { contractsCompleted: 3 },
  }),
  uncommon_clear_30: _kill({
    id: 'uncommon_clear_30',
    image: 'firefight',
    label: 'Body Count',
    rarity: 'uncommon',
    portrait: 'any',
    objective: 'kills_total', targetCount: 30,
    perKillReward: 10, reward: 150,
    unlockedAt: { contractsCompleted: 3 },
  }),
  uncommon_gunmen_15: _kill({
    id: 'uncommon_gunmen_15',
    image: 'gunman_hunt',
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
    image: 'dasher_hunt',
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
    image: 'tank_hunt',
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
    image: 'boss_hunt',
    label: 'Bag the Captain',
    rarity: 'rare',
    portrait: 'boss',
    targetType: 'boss', targetCount: 1,
    perKillReward: 200, reward: 200, marksReward: 10,
    unlockedAt: { contractsCompleted: 10 },
    modifiers: {},
  }),
  // 2026-05-04: new RARE contracts that exercise the freshly-wired
  // enemyDamageMult + eliteChanceMult fields (previously dead schema).
  rare_bloodthirsty: _kill({
    id: 'rare_bloodthirsty',
    image: 'firefight',
    label: 'Bloodthirsty',
    rarity: 'rare',
    portrait: 'any',
    targetType: 'any', targetCount: 20,
    perKillReward: 22, reward: 240, marksReward: 7,
    unlockedAt: { contractsCompleted: 9 },
    modifiers: { enemyDamageMult: 1.4 },
  }),
  rare_elite_squad: _kill({
    id: 'rare_elite_squad',
    image: 'gunman_hunt',
    label: 'Elite Squad',
    rarity: 'rare',
    portrait: 'gunman',
    targetType: 'gunman', targetCount: 10,
    perKillReward: 38, reward: 260, marksReward: 8,
    unlockedAt: { contractsCompleted: 9 },
    modifiers: { eliteChanceMult: 2.0 },
  }),

  // ============= EPIC — unlock at rank 15, stacked modifiers ========================
  epic_press_wave: _kill({
    id: 'epic_press_wave',
    image: 'firefight',
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
    image: 'firefight',
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
    image: 'tank_hunt',
    label: 'Iron Will',
    rarity: 'epic',
    portrait: 'tank',
    targetType: 'tank', targetCount: 8,
    perKillReward: 80, reward: 600, marksReward: 28,
    unlockedAt: { contractsCompleted: 18, megabossKills: 1 },
    modifiers: { enemyHpMult: 1.75, noConsumables: true },
  }),
  // 2026-05-04: stacked-modifier EPIC. Hardened + bloodthirsty +
  // elite chance bumped — the highest threat-density contract that
  // doesn't lock the loadout (no weaponClass restriction).
  epic_warband: _kill({
    id: 'epic_warband',
    image: 'firefight',
    label: 'Warband',
    rarity: 'epic',
    portrait: 'any',
    targetType: 'any', targetCount: 35,
    perKillReward: 22, reward: 550, marksReward: 24,
    unlockedAt: { contractsCompleted: 17, megabossKills: 1 },
    modifiers: { enemyHpMult: 1.4, enemyDamageMult: 1.3, eliteChanceMult: 1.5 },
  }),

  // ============= LEGENDARY — unlock at rank 25 + 2 megabosses; the gauntlets =======
  legendary_pistolero: _kill({
    id: 'legendary_pistolero',
    image: 'pistol_only',
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
    image: 'melee_only',
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
    image: 'megaboss_hunt',
    label: 'Megaboss Hunt',
    rarity: 'legendary',
    portrait: 'megaboss',
    targetType: 'megaboss', targetCount: 1,
    perKillReward: 1500, reward: 0, marksReward: 60, sigilsReward: 3,
    unlockedAt: { contractsCompleted: 30, megabossKills: 2 },
    modifiers: { enemyDamageMult: 1.5 },
  }),

  // ============= PHASE-2/3 CONTRACTS — uses the new modifier + objective ============
  // surface added in 2026-05-12. Variety push: more objective shapes
  // beyond "kill N of X", more modifier flavors beyond stat tweaks.

  // ---- Common ---------------------------------------------------------
  common_close_kills_5: _kill({
    id: 'common_close_kills_5',
    image: 'firefight',
    label: 'Up Close',
    rarity: 'common',
    portrait: 'any',
    objective: 'close_kills', targetCount: 5,
    perKillReward: 12, reward: 50,
  }),
  common_headshots_5: _kill({
    id: 'common_headshots_5',
    image: 'firefight',
    label: 'Take Aim',
    rarity: 'common',
    portrait: 'any',
    objective: 'headshots_total', targetCount: 5,
    perKillReward: 14, reward: 60,
  }),
  common_distance_kills_3: _kill({
    id: 'common_distance_kills_3',
    image: 'firefight',
    label: 'Long Lens',
    rarity: 'common',
    portrait: 'any',
    objective: 'distance_kills', targetCount: 3,
    perKillReward: 18, reward: 60,
  }),
  common_clean_sheet_1: _kill({
    id: 'common_clean_sheet_1',
    image: 'firefight',
    label: 'Clean Sheet',
    rarity: 'common',
    portrait: 'any',
    objective: 'no_damage_floor', targetCount: 1,
    perKillReward: 0, reward: 80,
  }),

  // ---- Uncommon -------------------------------------------------------
  uncommon_hat_trick: _kill({
    id: 'uncommon_hat_trick',
    image: 'firefight',
    label: 'Hat Trick',
    rarity: 'uncommon',
    portrait: 'any',
    objective: 'headshot_streak', targetCount: 3,
    perKillReward: 0, reward: 150,
    unlockedAt: { contractsCompleted: 3 },
  }),
  uncommon_reach_out: _kill({
    id: 'uncommon_reach_out',
    image: 'firefight',
    label: 'Reach Out',
    rarity: 'uncommon',
    portrait: 'any',
    objective: 'distance_kills', targetCount: 10,
    perKillReward: 22, reward: 120,
    unlockedAt: { contractsCompleted: 3 },
  }),
  uncommon_unarmed: _kill({
    id: 'uncommon_unarmed',
    image: 'firefight',
    label: 'Disarmed',
    rarity: 'uncommon',
    portrait: 'any',
    objective: 'disarms', targetCount: 3,
    perKillReward: 0, reward: 140,
    unlockedAt: { contractsCompleted: 4 },
  }),
  uncommon_tight_schedule: _kill({
    id: 'uncommon_tight_schedule',
    image: 'firefight',
    label: 'Tight Schedule',
    rarity: 'uncommon',
    portrait: 'any',
    objective: 'kills_total', targetCount: 25,
    perKillReward: 8, reward: 150,
    unlockedAt: { contractsCompleted: 5 },
    modifiers: { runTimerSec: 480 },                                // 8min run timer
  }),
  uncommon_no_reload_2: _kill({
    id: 'uncommon_no_reload_2',
    image: 'firefight',
    label: 'Trigger Discipline',
    rarity: 'uncommon',
    portrait: 'any',
    objective: 'no_reload_floor', targetCount: 2,
    perKillReward: 0, reward: 160,
    unlockedAt: { contractsCompleted: 4 },
  }),

  // ---- Rare -----------------------------------------------------------
  rare_one_class: _kill({
    id: 'rare_one_class',
    image: 'firefight',
    label: 'Specialist',
    rarity: 'rare',
    portrait: 'any',
    objective: 'single_class_floor', targetCount: 2,
    perKillReward: 0, reward: 240, marksReward: 7,
    unlockedAt: { contractsCompleted: 8 },
  }),
  rare_one_mag: _kill({
    id: 'rare_one_mag',
    image: 'firefight',
    label: 'One Mag',
    rarity: 'rare',
    portrait: 'any',
    objective: 'kills_total', targetCount: 20,
    perKillReward: 18, reward: 240, marksReward: 8,
    unlockedAt: { contractsCompleted: 10 },
    modifiers: { scarcity: true },
  }),
  rare_sharpshooter: _kill({
    id: 'rare_sharpshooter',
    image: 'firefight',
    label: 'Sharpshooter',
    rarity: 'rare',
    portrait: 'any',
    objective: 'kills_total', targetCount: 15,
    perKillReward: 28, reward: 260, marksReward: 8,
    unlockedAt: { contractsCompleted: 10 },
    modifiers: { headshotsOnly: true },
  }),
  rare_half_heart: _kill({
    id: 'rare_half_heart',
    image: 'firefight',
    label: 'Half Heart',
    rarity: 'rare',
    portrait: 'any',
    objective: 'kills_total', targetCount: 25,
    perKillReward: 14, reward: 220, marksReward: 7,
    unlockedAt: { contractsCompleted: 9 },
    modifiers: { hpCapMult: 0.5 },
  }),
  rare_pressure_test: _kill({
    id: 'rare_pressure_test',
    image: 'extract',
    label: 'Pressure Test',
    rarity: 'rare',
    portrait: 'any',
    objective: 'levels_extracted', targetCount: 2,
    perKillReward: 0, reward: 280, marksReward: 9,
    unlockedAt: { contractsCompleted: 10 },
    modifiers: { pressurePerSec: 0.001667 },                        // ~+10%/min
  }),
  rare_tweakers: _kill({
    id: 'rare_tweakers',
    image: 'dasher_hunt',
    label: 'Tweaker Den',
    rarity: 'rare',
    portrait: 'any',
    objective: 'kills_total', targetCount: 25,
    perKillReward: 16, reward: 240, marksReward: 7,
    unlockedAt: { contractsCompleted: 9 },
    modifiers: { moveSpeedMult: 1.4 },
  }),
  rare_bloodbath: _kill({
    id: 'rare_bloodbath',
    image: 'firefight',
    label: 'Bloodbath',
    rarity: 'rare',
    portrait: 'any',
    objective: 'kills_total', targetCount: 30,
    perKillReward: 14, reward: 240, marksReward: 8,
    unlockedAt: { contractsCompleted: 9 },
    modifiers: { bleed: true },
  }),
  rare_lifesteal: _kill({
    id: 'rare_lifesteal',
    image: 'firefight',
    label: 'They Drink',
    rarity: 'rare',
    portrait: 'any',
    objective: 'kills_total', targetCount: 22,
    perKillReward: 18, reward: 260, marksReward: 8,
    unlockedAt: { contractsCompleted: 11 },
    modifiers: { lifesteal: 0.15 },
  }),
  rare_no_dash: _kill({
    id: 'rare_no_dash',
    image: 'firefight',
    label: 'Stand Your Ground',
    rarity: 'rare',
    portrait: 'any',
    objective: 'kills_total', targetCount: 25,
    perKillReward: 14, reward: 220, marksReward: 7,
    unlockedAt: { contractsCompleted: 9 },
    modifiers: { noDash: true },
  }),

  // ---- Epic -----------------------------------------------------------
  epic_sniper: _kill({
    id: 'epic_sniper',
    image: 'firefight',
    label: 'The Sniper',
    rarity: 'epic',
    portrait: 'any',
    objective: 'distance_kills', targetCount: 25,
    perKillReward: 32, reward: 500, marksReward: 22,
    unlockedAt: { contractsCompleted: 15, megabossKills: 1 },
    modifiers: { hpCapMult: 0.5 },
  }),
  epic_spray_pray: _kill({
    id: 'epic_spray_pray',
    image: 'firefight',
    label: 'Spray and Pray',
    rarity: 'epic',
    portrait: 'any',
    objective: 'kills_total', targetCount: 40,
    perKillReward: 14, reward: 500, marksReward: 22,
    unlockedAt: { contractsCompleted: 16, megabossKills: 1 },
    modifiers: { noDash: true, scarcity: true },
  }),
  epic_detonator: _kill({
    id: 'epic_detonator',
    image: 'firefight',
    label: 'Detonator',
    rarity: 'epic',
    portrait: 'any',
    objective: 'multi_kills', targetCount: 5,
    perKillReward: 0, reward: 550, marksReward: 24,
    unlockedAt: { contractsCompleted: 17, megabossKills: 1 },
    modifiers: { detonators: true },
  }),
  epic_timed_warband: _kill({
    id: 'epic_timed_warband',
    image: 'firefight',
    label: 'Hot Zone',
    rarity: 'epic',
    portrait: 'any',
    objective: 'kills_total', targetCount: 35,
    perKillReward: 18, reward: 550, marksReward: 24,
    unlockedAt: { contractsCompleted: 17, megabossKills: 1 },
    modifiers: { runTimerSec: 480, spawnDensityMult: 1.4 },
  }),

  // ---- Legendary ------------------------------------------------------
  legendary_gauntlet: _kill({
    id: 'legendary_gauntlet',
    image: 'firefight',
    label: 'The Gauntlet',
    rarity: 'legendary',
    portrait: 'any',
    objective: 'kills_total', targetCount: 40,
    perKillReward: 30, reward: 1200, marksReward: 50, sigilsReward: 2,
    unlockedAt: { contractsCompleted: 26, megabossKills: 2 },
    modifiers: { runTimerSec: 360, bleed: true, hpCapMult: 0.75 },
  }),
  legendary_pure_shot: _kill({
    id: 'legendary_pure_shot',
    image: 'firefight',
    label: 'Pure Shot',
    rarity: 'legendary',
    portrait: 'any',
    objective: 'headshot_streak', targetCount: 10,
    perKillReward: 0, reward: 1500, marksReward: 60, sigilsReward: 3,
    unlockedAt: { contractsCompleted: 28, megabossKills: 2 },
    modifiers: { headshotsOnly: true },
  }),
};

// Per-rarity roll weight as a function of the player's completed-
// contracts count. Lower rarities dominate early; higher rarities
// take over as the player builds a track record. Used by the
// hideout contract board AND the mid-run "pick another" picker so
// both surfaces grow harder together.
//
// Curve goals:
//   • At 0 completions: only common (and a sliver of uncommon).
//   • At ~10: rare starts showing up regularly.
//   • At ~20: epic enters the rotation.
//   • At ~30+: legendary surfaces; commons fade to background floor.
//
// Each rarity returns a non-negative weight. The pickWeightedDef
// roll below normalises across all candidate defs.
export function rarityWeightForCompletions(rarity, completions) {
  const c = Math.max(0, completions | 0);
  switch (rarity) {
    case 'common':
      // Stays meaningful early but trails to a 0.25 floor so the
      // pool always has SOMETHING easy in case the player just
      // wants a quick warm-up contract.
      return Math.max(0.25, 1.0 - c * 0.025);
    case 'uncommon':
      // Rises from 0.4 base, peaks around c=30 at ~1.0.
      return 0.4 + Math.min(0.6, c * 0.02);
    case 'rare':
      // Available from completion 1, ramps to 1.5 by c=37.
      return Math.min(1.5, c * 0.04);
    case 'epic':
      // Off-pool until ~10 completions; reaches 2.0 by c=50.
      return Math.max(0, Math.min(2.0, (c - 10) * 0.05));
    case 'legendary':
      // Reserved for late-game pulls. Off until c=25, max 2.5 by c=67.
      return Math.max(0, Math.min(2.5, (c - 25) * 0.06));
    default:
      return 0.5;
  }
}

// Weighted random pick over a candidate pool. Each def's weight is
// rarityWeightForCompletions(def.rarity, completions). When every
// candidate weights to zero (shouldn't happen because common has a
// 0.25 floor) we fall back to a flat random pick so the surface
// never silently fails.
export function pickWeightedContractDef(candidates, completions) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const weights = candidates.map(d =>
    rarityWeightForCompletions(d?.rarity || 'common', completions));
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

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
  // Phase-1 modifier weights. Each one earns counter-pressure on the
  // auto-derived rewards in buildModifiers (lootQualityMult / chipsMult
  // / marksMult) so harder modifiers pay better automatically.
  if ((m.moveSpeedMult || 1) > 1) score += ((m.moveSpeedMult || 1) - 1) * 0.4;  // Tweakers
  if (m.resurrect) score += 0.6;                                                 // Resurrection
  if (m.detonators) score += 0.35;                                               // Detonators
  if ((m.lifesteal || 0) > 0) score += (m.lifesteal || 0) * 1.5;                 // Lifesteal
  if (m.scarcity) score += 0.5;                                                  // Scarcity
  if (m.noDash) score += 0.35;                                                   // No Dash
  if (m.bleed) score += 0.3;                                                     // Bleed
  if ((m.hpCapMult || 1) < 1) score += (1 - (m.hpCapMult || 1)) * 0.8;           // Half Heart
  if (m.lowLight) score += 0.25;                                                 // Low Light
  if (m.fog) score += 0.3;                                                       // Fog
  if ((m.runTimerSec || 0) > 0) score += 0.5;                                    // Timed Extract
  if ((m.pressurePerSec || 0) > 0) score += (m.pressurePerSec || 0) * 24;        // Pressure (~+10%/min → +0.4)
  if (m.headshotsOnly) score += 0.7;                                             // Headshots Only
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
    // Phase-1 modifier surface. Defaults are no-ops so existing
    // contracts that don't set these stay unchanged. Engine consumers
    // (gunman.js, melee_enemy.js, player.js, level.js, main.js) read
    // these via getActiveContractModifiers() in Phase 2/3.
    moveSpeedMult: m.moveSpeedMult || 1,                // Tweakers: 1.5 = +50% enemy move speed
    resurrect: !!m.resurrect,                            // Resurrection: revive once after 5s unless headshot-killed
    detonators: !!m.detonators,                          // Detonators: every enemy explodes on death (AOE)
    lifesteal: m.lifesteal || 0,                         // Lifesteal: 0..1 fraction of damage dealt to player healed
    scarcity: !!m.scarcity,                              // Scarcity: no reload, mags don't refill mid-run
    noDash: !!m.noDash,                                  // No Dash: dash button disabled
    bleed: !!m.bleed,                                    // Bleed: taking damage applies HP DOT (bandages cancel)
    hpCapMult: m.hpCapMult || 1,                         // Half Heart: 0.5 = 50% max HP cap
    lowLight: !!m.lowLight,                              // Low Light: lights dimmed, visual range halved
    fog: !!m.fog,                                        // Fog: visual range capped ~10m
    runTimerSec: m.runTimerSec || 0,                     // Timed Extract: run-fail at N seconds (0 = off)
    pressurePerSec: m.pressurePerSec || 0,               // Pressure: per-floor stat ramp, resets on extract (0 = off)
    headshotsOnly: !!m.headshotsOnly,                    // Headshots Only: non-head shots deal 0 damage
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

// Plain-English target-archetype label for legacy archetype-kill
// contracts. Pluralizes against `count`.
function _archetypeLabel(type, count) {
  const n = count | 0;
  const plural = n === 1 ? '' : 's';
  switch (type) {
    case 'dasher':   return `dasher${plural}`;
    case 'tank':     return `tank${plural}`;
    case 'gunman':   return n === 1 ? 'gunman' : 'gunmen';
    case 'melee':    return n === 1 ? 'melee enemy' : 'melee enemies';
    case 'sniper':   return `sniper${plural}`;
    case 'boss':     return `boss${n === 1 ? '' : 'es'}`;
    case 'megaboss': return `megaboss${n === 1 ? '' : 'es'}`;
    default:         return `enem${n === 1 ? 'y' : 'ies'}`;
  }
}

// One-line subtitle describing what a contract requires. Handles
// both the basic-mechanic objectives ('credits_banked', etc.) and
// the legacy archetype-kill format. Used by hideout cards AND the
// mid-run contract picker so both surfaces read consistently.
export function objectiveSubtitle(def) {
  if (!def) return '';
  const n = def.targetCount | 0;
  switch (def.objective) {
    case 'kills_total':         return `${n} × ${n === 1 ? 'kill' : 'kills'}`;
    case 'containers_searched': return `${n} × containers searched`;
    case 'bodies_looted':       return `${n} × bodies looted`;
    case 'credits_banked':      return `Bank ${n} chips`;
    case 'levels_extracted':    return `Extract from ${n} ${n === 1 ? 'floor' : 'floors'}`;
  }
  return `${n} × ${_archetypeLabel(def.targetType, n)}`;
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
  const evalSnapshot = _subtractBaseline(snapshot, activeContract.pickupBaseline);
  const passed = !!def.evaluate(evalSnapshot);
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
  // Apply pickup baseline so the displayed counter reflects progress
  // since the contract was taken, not since the start of the run.
  const s = _subtractBaseline(eventsSnapshot, contract?.pickupBaseline);
  // Objective-driven progress takes precedence — the basic-mechanic
  // contracts read uniform fields off the snapshot. Falls through to
  // legacy id-keyed cases for the few hand-tuned dailies.
  const need = def.targetCount | 0;
  const pct = (have) => need > 0 ? Math.min(1, (have | 0) / need) : 0;
  switch (def.objective) {
    case 'kills_total':
      return { label: `${s.kills | 0} / ${need} kills`, pct: pct(s.kills) };
    case 'containers_searched':
      return { label: `${s.containersSearched | 0} / ${need} searched`, pct: pct(s.containersSearched) };
    case 'bodies_looted':
      return { label: `${s.bodiesLooted | 0} / ${need} looted`, pct: pct(s.bodiesLooted) };
    case 'credits_banked':
      return { label: `${s.credits | 0} / ${need} chips`, pct: pct(s.credits) };
    case 'levels_extracted':
      return { label: `${s.levelsExtracted | 0} / ${need} extracts`, pct: pct(s.levelsExtracted) };
  }
  switch (def.id) {
    case 'daily_kills_50':
      return { label: `${s.kills | 0} / 50 kills`, pct: Math.min(1, (s.kills | 0) / 50) };
    case 'daily_throwable_kills_10':
      return { label: `${s.throwableKills | 0} / 10 thrown kills`, pct: Math.min(1, (s.throwableKills | 0) / 10) };
    case 'daily_crit_heads_15':
      return { label: `${s.critHeadshots | 0} / 15 crit headshots`, pct: Math.min(1, (s.critHeadshots | 0) / 15) };
    default:
      return { label: 'In progress', pct: 0 };
  }
}
