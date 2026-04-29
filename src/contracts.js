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
// Six daily contracts and three weekly. The active contract slot rolls
// from these; daily refreshes every 24h, weekly every 7 days.
export const CONTRACT_DEFS = {
  daily_extract_floor_5: {
    id: 'daily_extract_floor_5',
    label: 'Survey Mission',
    blurb: 'Extract from floor 5 or higher.',
    kind: 'daily', period: 'daily', reward: 80,
    evaluate: (s) => !!s.extracted && (s.peakLevel | 0) >= 5,
  },
  daily_kills_50: {
    id: 'daily_kills_50',
    label: 'Sweeper',
    blurb: 'Kill 50 enemies in one run.',
    kind: 'daily', period: 'daily', reward: 90,
    evaluate: (s) => (s.kills | 0) >= 50,
  },
  daily_no_consumables: {
    id: 'daily_no_consumables',
    label: 'Iron Lung',
    blurb: 'Reach floor 4 without using a consumable.',
    kind: 'daily', period: 'daily', reward: 110,
    evaluate: (s) => !!s.noConsumables && (s.peakLevel | 0) >= 4,
  },
  daily_pistol_only: {
    id: 'daily_pistol_only',
    label: 'Sidearm Drill',
    blurb: 'Extract using only pistols.',
    kind: 'daily', period: 'daily', reward: 130,
    evaluate: (s) => !!s.extracted && !!s.pistolOnly,
  },
  daily_throwable_kills_10: {
    id: 'daily_throwable_kills_10',
    label: 'Demolitionist',
    blurb: 'Get 10 throwable kills in one run.',
    kind: 'daily', period: 'daily', reward: 100,
    evaluate: (s) => (s.throwableKills | 0) >= 10,
  },
  daily_crit_heads_15: {
    id: 'daily_crit_heads_15',
    label: 'Marksman',
    blurb: 'Land 15 crit headshots in one run.',
    kind: 'daily', period: 'daily', reward: 110,
    evaluate: (s) => (s.critHeadshots | 0) >= 15,
  },

  weekly_extract_floor_10: {
    id: 'weekly_extract_floor_10',
    label: 'Deep Run',
    blurb: 'Extract from floor 10 or higher.',
    kind: 'weekly', period: 'weekly', reward: 350,
    evaluate: (s) => !!s.extracted && (s.peakLevel | 0) >= 10,
  },
  weekly_no_melee_floor_8: {
    id: 'weekly_no_melee_floor_8',
    label: 'Cold Hands',
    blurb: 'Reach floor 8 without landing a melee hit.',
    kind: 'weekly', period: 'weekly', reward: 400,
    evaluate: (s) => !!s.noMelee && (s.peakLevel | 0) >= 8,
  },
  weekly_pistol_floor_8: {
    id: 'weekly_pistol_floor_8',
    label: 'Pistolero',
    blurb: 'Reach floor 8 using only pistols.',
    kind: 'weekly', period: 'weekly', reward: 450,
    evaluate: (s) => !!s.pistolOnly && (s.peakLevel | 0) >= 8,
  },
};

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
// the chips paid out, or 0 on no-op.
//   setActiveContractFn(updated) — persists the claimedAt stamp
//   awardChipsFn(amount) — pays out the reward (main.js's
//     awardPersistentChips, which honors restart-penalty etc.)
export function tryClaimContract(activeContract, snapshot, setActiveContractFn, awardChipsFn) {
  const { def, passed, alreadyClaimed, reward } = evaluateContract(activeContract, snapshot);
  if (!def || alreadyClaimed || !passed) return 0;
  // Stamp claim BEFORE awarding so a double-call can't double-pay.
  const updated = { ...activeContract, claimedAt: Date.now() };
  if (typeof setActiveContractFn === 'function') setActiveContractFn(updated);
  if (typeof awardChipsFn === 'function') awardChipsFn(reward);
  return reward;
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
