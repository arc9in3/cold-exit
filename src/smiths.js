// Gunsmith / armorer affix-transfer logic. Both vendors let the player
// sacrifice a second weapon/armor piece to graft one of its affixes
// onto a target item that has a free affix slot.
//
// Rules:
// - Target must have an open affix slot (cap by rarity, see
//   AFFIX_COUNT_BY_RARITY in inventory.js). setMark affixes don't count
//   against the cap (they're flavor) and aren't transferable.
// - Source is destroyed on a successful transfer.
// - Mastercraft scaling: source MC → target normal halves the value;
//   source normal → target MC doubles it. Both MC or both normal is
//   1×. The "doesn't go backwards" rule is folded into the table.
// - Cost is gold paid up-front, scales with affix magnitude + target
//   rarity. 10× the original proposal so transferring is a real
//   economic decision (it circumvents the random-roll loop).

import { AFFIX_COUNT_BY_RARITY, affixDef, inferRarity } from './inventory.js';
import { tunables } from './tunables.js';

const RARITY_RANK = {
  common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5,
};

export function affixCap(item) {
  return AFFIX_COUNT_BY_RARITY[inferRarity(item)] ?? 0;
}

export function affixesUsed(item) {
  if (!item || !item.affixes) return 0;
  return item.affixes.filter(a => a.kind !== 'setMark').length;
}

export function affixSlotsFree(item) {
  return Math.max(0, affixCap(item) - affixesUsed(item));
}

// Returns the value multiplier applied to an affix when transferred
// from `source` onto `target`. Mastercraft target gains 2× (the rare
// upgrade tier), mastercraft source gives only 0.5× (you're harvesting
// from a great item — keeps mastercraft → mastercraft duping in
// check). Both-MC cancels to 1×, both-normal is straight 1×.
export function transferScalar(source, target) {
  const srcMC = !!source.mastercraft;
  const tgtMC = !!target.mastercraft;
  if (srcMC && !tgtMC) return 0.5;
  if (!srcMC && tgtMC) return 2.0;
  return 1.0;
}

// Per-transfer credit cost. Tunable via tunables.smith.transfer:
//   base       — flat charge regardless of value
//   perValue   — gold per |affix.value| point
//   rarityMult — gold per target-rarity tier
//   mcMult     — extra multiplier when target is mastercraft (since
//                the resulting affix doubles in value)
export function transferCost(target, affix) {
  const cfg = (tunables.smith && tunables.smith.transfer) || {};
  const base = cfg.base ?? 2500;
  const perValue = cfg.perValue ?? 200;
  const rarityMult = cfg.rarityMult ?? 1500;
  const mcMult = cfg.mcMult ?? 1.5;
  const v = Math.abs(typeof affix.value === 'number' ? affix.value : 10);
  const rank = RARITY_RANK[inferRarity(target)] ?? 2;
  const raw = base + perValue * v + rarityMult * rank;
  return Math.round(raw * (target.mastercraft ? mcMult : 1.0));
}

// Build the new affix object that lands on the target. Reuses the
// pool's label formatter so the new value reads the same as a rolled
// affix ("+15% reload" etc.). Rounds to 1 decimal.
export function makeScaledAffix(source, target, affix) {
  const def = affixDef(affix.kind);
  const scalar = transferScalar(source, target);
  const value = Math.round((affix.value || 0) * scalar * 10) / 10;
  const label = def ? def.label(value) : (affix.label || '?');
  return { kind: affix.kind, value, label };
}

// Affixes the smith can transfer off of `source` — strips setMark and
// any kind without a pool def (defensive).
export function transferableAffixes(source) {
  if (!source || !source.affixes) return [];
  return source.affixes.filter(a => a.kind !== 'setMark' && affixDef(a.kind));
}

// Item-type filters. Match the existing `_canRepair` rules so the same
// item categories that USED to be repairable are now smith-eligible.
export function smithAccepts(kind, item) {
  if (!item) return false;
  const t = item.type;
  if (kind === 'gunsmith') return t === 'ranged' || t === 'melee';
  if (kind === 'armorer') {
    return t === 'armor' || t === 'gear' || t === 'backpack' || item.slot === 'backpack';
  }
  return false;
}

// Validation gate for the Confirm button — returns null on success or
// a short reason string the UI can show inline.
export function validateTransfer(target, source, affix, credits) {
  if (!target) return 'Pick a target';
  if (!source) return 'Pick a source';
  if (target === source) return 'Target and source must differ';
  if (!affix) return 'Pick an affix';
  if (affixSlotsFree(target) <= 0) return 'Target has no free affix slot';
  // Source must actually own this affix (defensive — UI passes the
  // affix object directly, but a stale render could desync).
  if (!source.affixes || !source.affixes.includes(affix)) return 'Affix missing from source';
  const cost = transferCost(target, affix);
  if (credits < cost) return `Need ${cost}c (you have ${credits}c)`;
  return null;
}
