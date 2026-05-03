// ============================================================
// agency_economy.js — chip + mark balance, payouts, hiring costs
// ============================================================
//
// Two currencies for the agency:
//   chips — soft currency. Earned every contract. Spent on recruits,
//           refresh, armor, trainer head-starts.
//   marks — hard currency. Earned RARELY (signature kills, bonus
//           contracts). Spent on permanent unlocks, special-merc
//           re-hires after death, named-cast slot expansion.
//
// Per-contract payout formula (chips):
//   base    = 200 + 100 * floorIndex
//   bonus   = +50% if extracted with >=80% HP (clean)
//           = +30% if extracted with all roster alive (full team)
//           = +25% per artifact found this contract (capped at 3)
//           = -50% if any agent died
//
// Special-merc re-hire after death:
//   first death — half normal price (bereavement discount)
//   second+     — full normal price (the well runs dry)
//
// Refresh costs:
//   first refresh per session — free (set REFRESH_FREE_PER_SESSION = 1)
//   subsequent refreshes scale: 50, 100, 200, 400 chips
//
// Hideout upgrades — chip sinks, gameplay-relevant:
//   ARMORY_LEVEL    1→5  improves starting gear quality
//   RECRUITER_TIER  1→3  unlocks higher-tier slots in roster
//   TRAINER_RANK    1→3  permanent stat baseline boost for all hires
//   COMMS           1→3  unlocks contract-type filters at recruiter
//
// ============================================================

export const CURRENCY = {
  CHIPS_STARTING: 500,
  MARKS_STARTING: 0,
};

export const PAYOUTS = {
  // Contract base per floor index (0-based).
  contractBase(floorIndex) {
    return 200 + 100 * Math.max(0, floorIndex);
  },
  // Apply HP / team / artifact bonuses + death penalties.
  // ctx: { hpPctOnExtract, allAgentsAlive, artifactsFound, anyAgentDied }
  contractTotal(floorIndex, ctx = {}) {
    let base = PAYOUTS.contractBase(floorIndex);
    let mult = 1.0;
    if (ctx.hpPctOnExtract >= 0.80) mult += 0.50;
    if (ctx.allAgentsAlive)         mult += 0.30;
    if (ctx.artifactsFound)         mult += 0.25 * Math.min(3, ctx.artifactsFound);
    if (ctx.anyAgentDied)           mult -= 0.50;
    return Math.max(50, Math.round(base * mult));
  },
  // Marks — rare, only from signature events
  markEvents: {
    BOSS_KILL_SOLO:        { marks: 1, label: 'Solo boss kill' },
    EXTRACTION_NO_DAMAGE:  { marks: 2, label: 'Flawless extraction' },
    SPECIAL_MERC_UNLOCK:   { marks: 3, label: 'Special merc permanently unlocked' },
    WEAPON_UNLOCK:         { marks: 1, label: 'Signature weapon unlocked' },
  },
};

export const REFRESH_COST_LADDER = [0, 50, 100, 200, 400, 800];

export function refreshCost(refreshCount) {
  const idx = Math.min(refreshCount, REFRESH_COST_LADDER.length - 1);
  return REFRESH_COST_LADDER[idx];
}

export const REHIRE_DISCOUNT = {
  // Special merc died — bereavement discount on first re-hire.
  // Returns multiplier on the merc's base hire price.
  forSpecial(deathCount) {
    if (deathCount === 0) return 1.0;
    if (deathCount === 1) return 0.5;   // first death: half price
    return 1.0;                          // second+ death: full price
  },
  // Named recruit died — small discount only on first death.
  forNamed(deathCount) {
    if (deathCount === 0) return 1.0;
    if (deathCount === 1) return 0.75;
    return 1.0;
  },
};

export const HIDEOUT_UPGRADES = {
  armory: [
    { level: 1, cost: 0,    name: 'Footlocker',    desc: 'Standard starting gear.' },
    { level: 2, cost: 800,  name: 'Locker Bay',    desc: '+1 starting medkit per agent.' },
    { level: 3, cost: 2400, name: 'Storage Floor', desc: '+1 throwable per agent. Unlock attachment slots.' },
    { level: 4, cost: 5600, name: 'Armory Wing',   desc: 'All hires start with one rare item.' },
    { level: 5, cost: 12000,name: 'Vault Network', desc: 'All hires start with epic-tier loadout.' },
  ],
  recruiter: [
    { level: 1, cost: 0,    name: 'Open Door',     desc: 'Daily roster: low/mid/RNG.' },
    { level: 2, cost: 1500, name: 'Word of Mouth', desc: 'Daily roster always has 1 mid+ slot.' },
    { level: 3, cost: 4500, name: 'Black Book',    desc: 'Special merc rate doubled (2% → 4%). 4 slots instead of 3.' },
  ],
  trainer: [
    { level: 1, cost: 0,    name: 'Sparring Mat',  desc: 'No baseline stat boost.' },
    { level: 2, cost: 2000, name: 'Range',         desc: '+5 baseline aim for all hires.' },
    { level: 3, cost: 6000, name: 'Pit',           desc: '+10 aim, +10 mob, +5 nrv baseline.' },
  ],
  comms: [
    { level: 1, cost: 0,    name: 'Burner Phones', desc: 'Random contract pick at extract.' },
    { level: 2, cost: 1800, name: 'Encrypted Net', desc: 'Choose 1 of 3 contracts at extract.' },
    { level: 3, cost: 5500, name: 'Insider Net',   desc: 'Reveal contract modifiers + payouts before pick.' },
  ],
};

// Hide marker — minimal helper that wraps localStorage so consumers
// don't have to manage the key. Not the source of truth for save —
// the save system can override these keys at load time.
const KEY_CHIPS = 'coldexit:agency:chips:v1';
const KEY_MARKS = 'coldexit:agency:marks:v1';

export function getChips() {
  try { return parseInt(localStorage.getItem(KEY_CHIPS) || String(CURRENCY.CHIPS_STARTING), 10) || 0; }
  catch (_) { return CURRENCY.CHIPS_STARTING; }
}
export function setChips(n) {
  try { localStorage.setItem(KEY_CHIPS, String(Math.max(0, n | 0))); } catch (_) {}
}
export function spendChips(n) {
  const c = getChips();
  if (c < n) return false;
  setChips(c - n);
  return true;
}
export function awardChips(n) {
  setChips(getChips() + (n | 0));
}

export function getMarks() {
  try { return parseInt(localStorage.getItem(KEY_MARKS) || String(CURRENCY.MARKS_STARTING), 10) || 0; }
  catch (_) { return CURRENCY.MARKS_STARTING; }
}
export function setMarks(n) {
  try { localStorage.setItem(KEY_MARKS, String(Math.max(0, n | 0))); } catch (_) {}
}
export function spendMarks(n) {
  const m = getMarks();
  if (m < n) return false;
  setMarks(m - n);
  return true;
}
export function awardMarks(n) {
  setMarks(getMarks() + (n | 0));
}
