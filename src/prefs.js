// Lightweight localStorage-backed user preferences. One module per flag
// type — we keep key names stable so the format matches across sessions
// without a schema migration hop.

const DEV_TOOLS_KEY = 'tacticalrogue_dev_tools_v1';
const PLAYER_NAME_KEY = 'tacticalrogue_player_name_v1';
const STORE_STATE_KEY = 'tacticalrogue_starting_store_v1';
const CHARACTER_STYLE_KEY = 'tacticalrogue_character_style_v1';

function _read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (_) { return fallback; }
}
function _write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

export function getDevToolsEnabled() { return !!_read(DEV_TOOLS_KEY, false); }
export function setDevToolsEnabled(v) { _write(DEV_TOOLS_KEY, !!v); }

export function getPlayerName() { return _read(PLAYER_NAME_KEY, '') || ''; }
export function setPlayerName(v) {
  const trimmed = String(v ?? '').trim().slice(0, 16);
  _write(PLAYER_NAME_KEY, trimmed);
}

// Starting-store state: { slots: 3..9, rarityTier: 0..4 }.
// Slots = number of gear offers shown on new-run start.
// rarityTier biases the rarity roll for each offer:
//   0 = only common
//   1 = common (80%) / uncommon (20%)
//   2 = common (50%) / uncommon (40%) / rare (10%)
//   3 = uncommon (45%) / rare (40%) / epic (15%)
//   4 = rare (40%) / epic (45%) / legendary (15%)
export function getStartingStoreState() {
  const s = _read(STORE_STATE_KEY, null);
  if (!s || typeof s !== 'object') return { slots: 3, rarityTier: 0 };
  return {
    slots: Math.max(3, Math.min(9, s.slots | 0 || 3)),
    rarityTier: Math.max(0, Math.min(4, s.rarityTier | 0 || 0)),
  };
}
export function setStartingStoreState(s) { _write(STORE_STATE_KEY, s); }

// Character silhouette style. 'operator' (default) = the tactical-
// operator primitive rig. 'marine' = cartoon Warhammer 40K space-
// marine decorations (big pauldrons, power pack, helmet) on top of
// the same rig. Switching recolours materials + toggles decorations
// live via player.applyCharacterStyle().
export function getCharacterStyle() {
  const v = _read(CHARACTER_STYLE_KEY, 'operator');
  return v === 'marine' ? 'marine' : 'operator';
}
export function setCharacterStyle(v) {
  _write(CHARACTER_STYLE_KEY, v === 'marine' ? 'marine' : 'operator');
}

// Character appearance — color palette + accessory toggles. Stored
// as a single object so adding fields doesn't require new keys.
const CHARACTER_APPEARANCE_KEY = 'tacticalrogue:characterAppearance:v1';
export const APPEARANCE_DEFAULTS = {
  primary:    '#3a4a5a',     // jacket / armor body
  accent:     '#c9a87a',     // straps / trim
  skin:       '#caa07a',     // skin tone
  hair:       '#3a2c1c',     // hair / beard
  helmet:     true,
  vestOver:   true,           // overlay vest decoration
};
export function getCharacterAppearance() {
  const raw = _read(CHARACTER_APPEARANCE_KEY, null);
  if (!raw || typeof raw !== 'object') return { ...APPEARANCE_DEFAULTS };
  return { ...APPEARANCE_DEFAULTS, ...raw };
}
export function setCharacterAppearance(patch) {
  if (!patch || typeof patch !== 'object') return;
  const cur = getCharacterAppearance();
  _write(CHARACTER_APPEARANCE_KEY, { ...cur, ...patch });
}

// Persistent pouch slot count. Starts at 1 — the player spends
// contract chips to unlock more slots, up to a cap of 9. Very expensive
// ramp: the last slot should feel like a milestone upgrade, not a
// trickle. Costs are in chips; see POUCH_SLOT_COSTS below.
const POUCH_SLOTS_KEY = 'tacticalrogue_pouch_slots_v1';
export const POUCH_SLOT_MIN = 1;
export const POUCH_SLOT_MAX = 9;
// Cost to buy the Nth slot (index 0 = buying slot #2 from the base 1).
export const POUCH_SLOT_COSTS = [
  40,    // slot #2
  80,    // slot #3
  140,   // slot #4
  220,   // slot #5
  320,   // slot #6
  460,   // slot #7
  640,   // slot #8
  880,   // slot #9
];
export function getPouchSlots() {
  const n = _read(POUCH_SLOTS_KEY, POUCH_SLOT_MIN) | 0;
  return Math.max(POUCH_SLOT_MIN, Math.min(POUCH_SLOT_MAX, n || POUCH_SLOT_MIN));
}
export function setPouchSlots(n) {
  const clamped = Math.max(POUCH_SLOT_MIN, Math.min(POUCH_SLOT_MAX, n | 0));
  _write(POUCH_SLOTS_KEY, clamped);
}
export function pouchNextSlotCost(currentSlots) {
  if (currentSlots >= POUCH_SLOT_MAX) return null;
  // currentSlots = 1 → buying slot #2 → index 0 of POUCH_SLOT_COSTS.
  return POUCH_SLOT_COSTS[currentSlots - POUCH_SLOT_MIN];
}

// Per-merchant stock-size upgrades + a one-time "reroll-any-shop"
// unlock. Both fund out of contract chips.
//
// MERCHANT_KINDS lists every kind that can be upgraded. The bear
// merchant ("bearMerchant") is intentionally surfaced under a
// mysterious label in the UI — the player can spend on it without
// knowing exactly what they're upgrading.
const MERCHANT_UPGRADES_KEY = 'tacticalrogue_merchant_upgrades_v1';
const REROLL_UNLOCK_KEY = 'tacticalrogue_merchant_reroll_v1';
export const MERCHANT_KINDS = [
  'merchant', 'healer', 'gunsmith', 'armorer',
  'tailor', 'relicSeller', 'blackMarket', 'bearMerchant',
];
export const MERCHANT_UPGRADE_MAX = 4;
// Cost to buy level N from level N-1 (index 0 = buy level 1).
export const MERCHANT_UPGRADE_COSTS = [40, 80, 160, 280];
export const REROLL_UNLOCK_COST = 220;

export function getMerchantUpgrades() {
  const raw = _read(MERCHANT_UPGRADES_KEY, null);
  const out = {};
  for (const k of MERCHANT_KINDS) {
    const v = (raw && typeof raw === 'object') ? (raw[k] | 0) : 0;
    out[k] = Math.max(0, Math.min(MERCHANT_UPGRADE_MAX, v));
  }
  return out;
}
export function setMerchantUpgrade(kind, level) {
  if (!MERCHANT_KINDS.includes(kind)) return;
  const all = getMerchantUpgrades();
  all[kind] = Math.max(0, Math.min(MERCHANT_UPGRADE_MAX, level | 0));
  _write(MERCHANT_UPGRADES_KEY, all);
}
export function merchantUpgradeNextCost(level) {
  if ((level | 0) >= MERCHANT_UPGRADE_MAX) return null;
  return MERCHANT_UPGRADE_COSTS[level | 0];
}
export function getMerchantStockBonus(kind) {
  const all = getMerchantUpgrades();
  return all[kind] | 0;     // adds N items to the kind's base stock size
}

export function getRerollUnlocked() {
  return !!_read(REROLL_UNLOCK_KEY, false);
}
export function setRerollUnlocked(v) {
  _write(REROLL_UNLOCK_KEY, !!v);
}

// Random-encounter completion tracker. Each encounter id (e.g.
// 'royal_emissary', 'duck', 'fountain', 'circle') gets its `oncePerSave`
// flag flipped after the player triggers the rewarding interaction.
// Stored as a Set serialised to a sorted string array.
const COMPLETED_ENCOUNTERS_KEY = 'tacticalrogue_completed_encounters_v1';
export function getCompletedEncounters() {
  const arr = _read(COMPLETED_ENCOUNTERS_KEY, []);
  return Array.isArray(arr) ? new Set(arr) : new Set();
}
export function markEncounterDone(id) {
  if (!id) return;
  const set = getCompletedEncounters();
  if (set.has(id)) return;
  set.add(id);
  _write(COMPLETED_ENCOUNTERS_KEY, [...set].sort());
}
export function resetEncounterCompletion(id) {
  if (!id) return;
  const set = getCompletedEncounters();
  if (!set.has(id)) return;
  set.delete(id);
  _write(COMPLETED_ENCOUNTERS_KEY, [...set].sort());
}

// Per-encounter persistent state — used by mystery-thread encounters
// that build up across runs. Each encounter id maps to a free-form
// state blob the encounter's interact() reads + mutates. Distinct
// from getCompletedEncounters() (which is the binary "done forever"
// set) so state can persist on a chain that hasn't fully resolved.
const ENCOUNTER_STATE_KEY = 'tacticalrogue:encounterState:v1';
export function getEncounterState(id) {
  if (!id) return {};
  const all = _read(ENCOUNTER_STATE_KEY, {}) || {};
  return (all && typeof all === 'object' && all[id] && typeof all[id] === 'object')
    ? all[id]
    : {};
}
export function setEncounterState(id, state) {
  if (!id) return;
  const all = _read(ENCOUNTER_STATE_KEY, {}) || {};
  all[id] = (state && typeof state === 'object') ? state : {};
  _write(ENCOUNTER_STATE_KEY, all);
}
export function patchEncounterState(id, patch) {
  if (!id || !patch) return;
  const cur = getEncounterState(id);
  setEncounterState(id, { ...cur, ...patch });
}

// Run-cooldown tracker — encounters with `cooldownRuns: N` are
// suppressed for the next N completed runs after a player triggers
// them. The map is { encounterId: runIndexAtUnsuppress }. Compared
// against getRunCount() in the eligibility filter.
const ENCOUNTER_COOLDOWN_KEY = 'tacticalrogue:encounterCooldown:v1';
export function getEncounterCooldowns() {
  const raw = _read(ENCOUNTER_COOLDOWN_KEY, {}) || {};
  return (raw && typeof raw === 'object') ? raw : {};
}
export function setEncounterCooldown(id, unsuppressAtRun) {
  if (!id) return;
  const all = getEncounterCooldowns();
  all[id] = unsuppressAtRun | 0;
  _write(ENCOUNTER_COOLDOWN_KEY, all);
}

// Forced-followup queue — encounters can request that a specific
// follow-up encounter spawn on the next 1-2 floors regardless of
// the normal encounter roll. Each entry is { id, floorsRemaining }.
// Decremented on every level transition; consumed on placement.
// Persists across save/load so a thread doesn't break on a quit-out.
const FOLLOWUP_QUEUE_KEY = 'tacticalrogue:encounterFollowups:v1';
export function getEncounterFollowups() {
  const arr = _read(FOLLOWUP_QUEUE_KEY, []);
  return Array.isArray(arr) ? arr : [];
}
export function setEncounterFollowups(arr) {
  _write(FOLLOWUP_QUEUE_KEY, Array.isArray(arr) ? arr : []);
}
export function queueEncounterFollowup(id, floors = 1) {
  if (!id) return;
  const cur = getEncounterFollowups();
  cur.push({ id, floorsRemaining: Math.max(1, floors | 0) });
  setEncounterFollowups(cur);
}
// Tick the queue on level transition — decrements all entries; drops
// any that hit 0. Returns the entry that was placed (if any) so the
// caller can consume it.
export function takeEncounterFollowupForFloor() {
  const cur = getEncounterFollowups();
  if (!cur.length) return null;
  // Pop the oldest entry that's ready to fire.
  const idx = cur.findIndex(e => (e.floorsRemaining | 0) > 0);
  if (idx < 0) { setEncounterFollowups([]); return null; }
  const out = cur[idx];
  cur.splice(idx, 1);
  // Decrement remaining entries (they wait one more floor).
  for (const e of cur) e.floorsRemaining = Math.max(0, (e.floorsRemaining | 0) - 1);
  setEncounterFollowups(cur.filter(e => e.floorsRemaining > 0));
  return out;
}
export function clearEncounterFollowups() { setEncounterFollowups([]); }

// Lifetime run counter — bumps once per completed run (extract OR
// death). Feeds the hidden encounter-tier formula and the cooldown
// timing for cooldownRuns-flagged encounters. Visible to nobody —
// the player should never see this number.
const RUN_COUNT_KEY = 'tacticalrogue:runCount:v1';
export function getRunCount() {
  try { return parseInt(localStorage.getItem(RUN_COUNT_KEY) || '0', 10) || 0; }
  catch (_) { return 0; }
}
export function bumpRunCount() {
  try {
    const next = getRunCount() + 1;
    localStorage.setItem(RUN_COUNT_KEY, String(next));
    return next;
  } catch (_) { return 0; }
}

// ---------------------------------------------------------------------
// Weapon unlocks — chips spent at the Stash Armory permanently unlock
// a weapon flagged `worldDrop: false` in tunables. Two effects per
// purchase: (a) the weapon enters the player's free-take starter pool,
// (b) it starts dropping in chests via loot.js's filter.
// Stored as a Set serialised to a sorted string array.
// ---------------------------------------------------------------------
const UNLOCKED_WEAPONS_KEY = 'tacticalrogue:unlockedWeapons:v1';
export function getUnlockedWeapons() {
  const arr = _read(UNLOCKED_WEAPONS_KEY, []);
  return Array.isArray(arr) ? new Set(arr) : new Set();
}
export function unlockWeapon(name) {
  if (!name) return;
  const set = getUnlockedWeapons();
  if (set.has(name)) return;
  set.add(name);
  _write(UNLOCKED_WEAPONS_KEY, [...set].sort());
}
export function isWeaponUnlocked(name) {
  return getUnlockedWeapons().has(name);
}

// Selected starter weapon — the player picks ONE weapon name from
// their stash (baseline-5 ∪ unlocked) before starting a run. Read by
// main.js's _pickStarterWeapon at run start. If null, falls back to
// the old class-based pick (any common-or-unlocked of the chosen
// class).
const STARTER_WEAPON_KEY = 'tacticalrogue:selectedStarterWeapon:v1';
export function getSelectedStarterWeapon() {
  try { return localStorage.getItem(STARTER_WEAPON_KEY) || null; }
  catch (_) { return null; }
}
export function setSelectedStarterWeapon(name) {
  try {
    if (name) localStorage.setItem(STARTER_WEAPON_KEY, String(name));
    else localStorage.removeItem(STARTER_WEAPON_KEY);
  } catch (_) {}
}

// ---------------------------------------------------------------------
// Pre-Run Store — rotating stock of single-use items (weapons, armor,
// consumables) the player buys with chips at the Stash. Items go into
// the next-run starter inventory and are consumed at run start. The
// store auto-refreshes after STORE_REFRESH_MS; once an item is bought,
// its slot is empty until the next refresh. Prices float ±30% per
// refresh so timing matters.
//
// Schema:
//   slots         int — base 4, expandable via chip purchases (max 8)
//   ceiling       int 0..4 — rarity ceiling: 0 common-only, 4 legendary
//   refreshMs     int — refresh cadence in ms (default 4h, min 1h)
//   lastRefreshAt int — UTC ms timestamp of last roll
//   stock         array of { id, kind, rarity, price, sold } per slot
//
// `kind` is one of: 'weapon' | 'armor' | 'consumable' | 'ammo' | 'buff'
// ---------------------------------------------------------------------
const STORE_KEY = 'tacticalrogue:preRunStore:v1';
export const STORE_SLOT_MIN = 6;
export const STORE_SLOT_MAX = 10;
export const STORE_CEILING_MAX = 4;
export const STORE_REFRESH_DEFAULT_MS = 4 * 60 * 60 * 1000;   // 4h
export const STORE_REFRESH_MIN_MS     = 1 * 60 * 60 * 1000;   // 1h floor
export const STORE_SLOT_COSTS    = [400, 700, 1100, 1700];    // buying slot 7..10
export const STORE_CEILING_COSTS = [250, 500, 900, 1500];     // ceiling 1..4
export const STORE_REFRESH_COSTS = [300, 600, 1200];          // refresh tier upgrades

export function getStoreState() {
  const raw = _read(STORE_KEY, null);
  if (!raw || typeof raw !== 'object') {
    return {
      slots: STORE_SLOT_MIN,
      ceiling: 0,
      refreshMs: STORE_REFRESH_DEFAULT_MS,
      lastRefreshAt: 0,
      stock: [],
    };
  }
  return {
    slots: Math.max(STORE_SLOT_MIN, Math.min(STORE_SLOT_MAX, (raw.slots | 0) || STORE_SLOT_MIN)),
    ceiling: Math.max(0, Math.min(STORE_CEILING_MAX, raw.ceiling | 0)),
    refreshMs: Math.max(STORE_REFRESH_MIN_MS, (raw.refreshMs | 0) || STORE_REFRESH_DEFAULT_MS),
    // ms timestamps overflow int32 (Date.now() ~1.76 trillion). Use
    // Number coercion + Math.max so we never apply the `| 0` truncation
    // that previously zeroed the timestamp on every save and caused
    // the store to reroll on every render.
    lastRefreshAt: Math.max(0, Number(raw.lastRefreshAt) || 0),
    stock: Array.isArray(raw.stock) ? raw.stock : [],
  };
}
export function setStoreState(state) {
  _write(STORE_KEY, {
    slots: Math.max(STORE_SLOT_MIN, Math.min(STORE_SLOT_MAX, state?.slots | 0 || STORE_SLOT_MIN)),
    ceiling: Math.max(0, Math.min(STORE_CEILING_MAX, state?.ceiling | 0)),
    refreshMs: Math.max(STORE_REFRESH_MIN_MS, state?.refreshMs | 0 || STORE_REFRESH_DEFAULT_MS),
    // See note in getStoreState — keep the full ms timestamp.
    lastRefreshAt: Math.max(0, Number(state?.lastRefreshAt) || 0),
    stock: Array.isArray(state?.stock) ? state.stock : [],
  });
}
export function storeNextSlotCost(currentSlots) {
  if (currentSlots >= STORE_SLOT_MAX) return null;
  return STORE_SLOT_COSTS[currentSlots - STORE_SLOT_MIN];
}
export function storeNextCeilingCost(currentCeiling) {
  if (currentCeiling >= STORE_CEILING_MAX) return null;
  return STORE_CEILING_COSTS[currentCeiling];
}
export function storeNextRefreshCost(currentRefreshMs) {
  // Tiered refresh rates: 4h → 2h → 1h. Each tier has a cost.
  if (currentRefreshMs <= 60 * 60 * 1000) return null;          // already at 1h
  if (currentRefreshMs <= 2 * 60 * 60 * 1000) return STORE_REFRESH_COSTS[2];
  if (currentRefreshMs <= 3 * 60 * 60 * 1000) return STORE_REFRESH_COSTS[1];
  return STORE_REFRESH_COSTS[0];
}

// ---------------------------------------------------------------------
// Pre-run starter inventory queue — items the player buys from the
// Pre-Run Store get queued here and applied at startNewRun(). Hard-cap
// is "what fits in the run-start inventory" — over-buying is prevented
// at the UI layer (paperdoll) rather than auto-converted to chips.
// ---------------------------------------------------------------------
const STARTER_INVENTORY_KEY = 'tacticalrogue:starterInventory:v1';
export function getStarterInventory() {
  const arr = _read(STARTER_INVENTORY_KEY, []);
  return Array.isArray(arr) ? arr : [];
}
export function setStarterInventory(arr) {
  _write(STARTER_INVENTORY_KEY, Array.isArray(arr) ? arr : []);
}
export function addStarterInventoryItem(item) {
  if (!item) return;
  const cur = getStarterInventory();
  cur.push(item);
  setStarterInventory(cur);
}
export function consumeStarterInventory() {
  const cur = getStarterInventory();
  setStarterInventory([]);
  return cur;
}

// Sigils — the rarest currency. Earned from named-bounty contracts
// (megaboss kills under specific contract targets). Spent at the
// Black Market on relic permits + keystone perks. Distinct from
// the lifetime counter (below) which never decays so meta-content
// stays unlocked even after the player spends down their balance.
const SIGILS_KEY = 'tacticalrogue:sigils:v1';
export function getSigils() {
  try { return parseInt(localStorage.getItem(SIGILS_KEY) || '0', 10) || 0; }
  catch (_) { return 0; }
}
export function setSigils(n) {
  try { localStorage.setItem(SIGILS_KEY, String(Math.max(0, n | 0))); }
  catch (_) {}
}
export function awardSigils(n) {
  const add = Math.max(0, n | 0);
  if (!add) return getSigils();
  const next = getSigils() + add;
  setSigils(next);
  // Bump the lifetime counter too — feeds the hidden encounter-tier
  // formula. Spending sigils later doesn't decrement this.
  bumpSigilsLifetime(add);
  return next;
}
export function spendSigils(n) {
  const cost = Math.max(0, n | 0);
  const cur = getSigils();
  if (cost > cur) return false;
  setSigils(cur - cost);
  return true;
}

// Lifetime sigils-earned counter — distinct from current sigil
// balance (which gets spent down). The hidden encounter-tier
// formula reads this so spending sigils doesn't *unlock* the
// gameplay surface and then *re-lock* it once you've cashed in.
const SIGILS_LIFETIME_KEY = 'tacticalrogue:sigilsLifetime:v1';
export function getSigilsLifetime() {
  try { return parseInt(localStorage.getItem(SIGILS_LIFETIME_KEY) || '0', 10) || 0; }
  catch (_) { return 0; }
}
export function bumpSigilsLifetime(n) {
  const add = Math.max(0, n | 0);
  if (!add) return getSigilsLifetime();
  try {
    const next = getSigilsLifetime() + add;
    localStorage.setItem(SIGILS_LIFETIME_KEY, String(next));
    return next;
  } catch (_) { return 0; }
}

// Shrine tiers — three independent purchases, each one-shot per RUN
// (not per save). Tracked in-memory only so a fresh run resets every
// tier. resetShrineTiersForRun() is called from main.js on startNewRun.
//   tier 1 (500c)   → +5 max HP for the rest of the run
//   tier 2 (5000c)  → unowned artifact scroll
//   tier 3 (50000c) → guaranteed mythic weapon
// Tracked separately from getCompletedEncounters so the room itself
// can re-appear (until ALL tiers are claimed in the current run) while
// individual tiers stay locked.
let _shrineTiersThisRun = new Set();
export function getShrineTiers() {
  return new Set(_shrineTiersThisRun);
}
export function setShrineTierPurchased(tier) {
  _shrineTiersThisRun.add(tier);
}
export function resetShrineTiersForRun() {
  _shrineTiersThisRun = new Set();
}

// Mythic-run unlock — flipped true when the player sells The Gift to
// the Bear Merchant for 1c. Once set, the run-start weapon roll
// includes one always-mythic offer; selecting it stamps the run as a
// mythic run and starts difficulty at level 20.
const MYTHIC_RUN_UNLOCK_KEY = 'tacticalrogue_mythic_run_unlocked_v1';
export function getMythicRunUnlocked() {
  return !!_read(MYTHIC_RUN_UNLOCK_KEY, false);
}
export function setMythicRunUnlocked(v) {
  _write(MYTHIC_RUN_UNLOCK_KEY, !!v);
}

// ---------------------------------------------------------------------
// Hideout — persistent meta-game state. The hideout is the
// between-runs panel where the player banks key gear, picks
// contracts, and spends chips on between-run upgrades. None of these
// values are touched by `startNewRun` / death — they're the player's
// long-term identity outside any single run.
// ---------------------------------------------------------------------

// Stash — a small fixed-slot persistent inventory that survives death.
// Slot 0 is always available; the rest are unlocked via chip purchases.
// Items are stored as full ItemDef objects (same shape as inventory.js
// items), wrapped in { slot, item }. Slot count caps at STASH_SLOT_MAX.
const STASH_KEY = 'tacticalrogue:stash:v1';
export const STASH_SLOT_MIN = 4;
export const STASH_SLOT_MAX = 8;
// Cost (in chips) to unlock the Nth slot. Index 0 = buying slot #5
// from the base 4 — slots #1-4 are free / on by default.
export const STASH_SLOT_COSTS = [
  150,    // slot #5
  300,    // slot #6
  550,    // slot #7
  950,    // slot #8
];
export function getStash() {
  const arr = _read(STASH_KEY, []);
  return Array.isArray(arr) ? arr : [];
}
export function setStash(arr) {
  _write(STASH_KEY, Array.isArray(arr) ? arr : []);
}
// Convenience: list of items (no slot indexing). Use getStash() if you
// need slot positions.
export function getStashItems() {
  return getStash().map(e => e?.item).filter(Boolean);
}
// Add item; returns the slot it landed in or -1 if no room.
export function stashAddItem(item, slotCap) {
  if (!item) return -1;
  const cap = Math.max(STASH_SLOT_MIN, Math.min(STASH_SLOT_MAX, slotCap | 0 || STASH_SLOT_MIN));
  const cur = getStash();
  // Find first empty slot index < cap.
  const used = new Set(cur.map(e => e.slot | 0));
  for (let s = 0; s < cap; s++) {
    if (!used.has(s)) {
      cur.push({ slot: s, item });
      setStash(cur);
      return s;
    }
  }
  return -1;
}
export function stashRemoveAt(slotIdx) {
  const cur = getStash();
  const i = cur.findIndex(e => (e.slot | 0) === (slotIdx | 0));
  if (i < 0) return null;
  const removed = cur[i].item;
  cur.splice(i, 1);
  setStash(cur);
  return removed;
}

// Hideout upgrades — chip-purchased tier levels for the various
// hideout NPCs. stashSlots = total stash slot count (4..8).
// quartermasterTier raises rarity floor of guaranteed gear sold by
// the Quartermaster (0 = common only, 4 = legendary floor).
// mailboxUnlocked flips true once the player has played a co-op
// session — gates the trade-mailbox panel until then.
const HIDEOUT_UPGRADES_KEY = 'tacticalrogue:hideoutUpgrades:v1';
export const QUARTERMASTER_TIER_MAX = 4;
export const QUARTERMASTER_TIER_COSTS = [200, 450, 850, 1500];
export function getHideoutUpgrades() {
  const raw = _read(HIDEOUT_UPGRADES_KEY, null);
  return {
    stashSlots: Math.max(STASH_SLOT_MIN, Math.min(STASH_SLOT_MAX,
      (raw?.stashSlots | 0) || STASH_SLOT_MIN)),
    quartermasterTier: Math.max(0, Math.min(QUARTERMASTER_TIER_MAX,
      (raw?.quartermasterTier | 0) || 0)),
    mailboxUnlocked: !!raw?.mailboxUnlocked,
  };
}
export function setHideoutUpgrades(u) {
  _write(HIDEOUT_UPGRADES_KEY, {
    stashSlots: Math.max(STASH_SLOT_MIN, Math.min(STASH_SLOT_MAX, u?.stashSlots | 0 || STASH_SLOT_MIN)),
    quartermasterTier: Math.max(0, Math.min(QUARTERMASTER_TIER_MAX, u?.quartermasterTier | 0 || 0)),
    mailboxUnlocked: !!u?.mailboxUnlocked,
  });
}
export function stashNextSlotCost(currentSlots) {
  if (currentSlots >= STASH_SLOT_MAX) return null;
  return STASH_SLOT_COSTS[currentSlots - STASH_SLOT_MIN];
}
export function quartermasterNextTierCost(currentTier) {
  if (currentTier >= QUARTERMASTER_TIER_MAX) return null;
  return QUARTERMASTER_TIER_COSTS[currentTier];
}

// Active contract — daily/weekly modifier challenge picked at the
// hideout. activeContractId references CONTRACT_DEFS in contracts.js.
// expiresAt is a UTC ms timestamp; progress is contract-specific
// (a counter or a flag map). claimedAt is set when the reward has
// been paid out so we don't double-credit on a save/load.
const CONTRACTS_KEY = 'tacticalrogue:contracts:v1';
export function getActiveContract() {
  const v = _read(CONTRACTS_KEY, null);
  if (!v || typeof v !== 'object') return null;
  return {
    activeContractId: typeof v.activeContractId === 'string' ? v.activeContractId : null,
    // ms timestamps overflow int32 — Number-coerce instead of `| 0`.
    expiresAt: Math.max(0, Number(v.expiresAt) || 0),
    progress: v.progress && typeof v.progress === 'object' ? v.progress : {},
    claimedAt: Math.max(0, Number(v.claimedAt) || 0),
  };
}
export function setActiveContract(c) {
  if (!c) { _write(CONTRACTS_KEY, null); return; }
  _write(CONTRACTS_KEY, {
    activeContractId: c.activeContractId || null,
    expiresAt: Math.max(0, Number(c.expiresAt) || 0),
    progress: c.progress || {},
    claimedAt: Math.max(0, Number(c.claimedAt) || 0),
  });
}
export function clearActiveContract() { _write(CONTRACTS_KEY, null); }

// Persistent contract chips — the meta currency. Mirrors the
// `persistentChips` accessor in main.js so any module can read/write
// without importing from main.js. Single source of truth for the key.
const CHIPS_KEY = 'tacticalrogue:persistentChips';
export function getPersistentChips() {
  try { return parseInt(localStorage.getItem(CHIPS_KEY) || '0', 10) || 0; }
  catch (_) { return 0; }
}
export function setPersistentChips(n) {
  try { localStorage.setItem(CHIPS_KEY, String(Math.max(0, n | 0))); }
  catch (_) { /* private mode / quota */ }
}

// Marks — the death currency. Earned by dying on a run; spent at the
// Recruiter for permanent structural unlocks (NPCs, classes,
// stat-tier upgrades). Separate from chips so the player can never
// "skip the death loop" by extracting more. Storage key kept as
// `bones:v1` from the prior naming so existing local saves carry
// over cleanly — only the JS surface is renamed.
const MARKS_KEY = 'tacticalrogue:bones:v1';
export function getMarks() {
  try { return parseInt(localStorage.getItem(MARKS_KEY) || '0', 10) || 0; }
  catch (_) { return 0; }
}
export function setMarks(n) {
  try { localStorage.setItem(MARKS_KEY, String(Math.max(0, n | 0))); }
  catch (_) {}
}
export function awardMarks(n) {
  const add = Math.max(0, n | 0);
  if (!add) return getMarks();
  const next = getMarks() + add;
  setMarks(next);
  return next;
}
export function spendMarks(n) {
  const cost = Math.max(0, n | 0);
  const cur = getMarks();
  if (cost > cur) return false;
  setMarks(cur - cost);
  return true;
}

// Contract rank — number of contracts the player has successfully
// claimed. Acts as the primary "I am ready for harder content" gate
// for harder contract tiers (`unlockedAt.contractsCompleted`).
const CONTRACT_RANK_KEY = 'tacticalrogue:contractRank:v1';
export function getContractRank() {
  try { return parseInt(localStorage.getItem(CONTRACT_RANK_KEY) || '0', 10) || 0; }
  catch (_) { return 0; }
}
export function setContractRank(n) {
  try { localStorage.setItem(CONTRACT_RANK_KEY, String(Math.max(0, n | 0))); }
  catch (_) {}
}
export function bumpContractRank() {
  const next = getContractRank() + 1;
  setContractRank(next);
  return next;
}

// Relic permits — sigil-spent unlocks that admit a locked relic
// into the relic-merchant rotation. Persistent Set; once owned, the
// permit stays forever.
const RELIC_PERMITS_KEY = 'tacticalrogue:relicPermits:v1';
export function getRelicPermits() {
  const arr = _read(RELIC_PERMITS_KEY, []);
  return Array.isArray(arr) ? new Set(arr) : new Set();
}
export function setRelicPermitOwned(id) {
  if (!id) return;
  const set = getRelicPermits();
  if (set.has(id)) return;
  set.add(id);
  _write(RELIC_PERMITS_KEY, [...set].sort());
}
export function hasRelicPermit(id) {
  return getRelicPermits().has(id);
}

// Keystones — sigil-spent run-modifier perks. Two patterns: one-shot
// (consumed on next run start, e.g. "Deep Run starts at floor 5") and
// permanent (always-on once owned, e.g. "Pain drops enabled"). The
// queue holds one-shots; the owned set holds permanents.
const KEYSTONE_QUEUE_KEY = 'tacticalrogue:keystoneQueue:v1';
const KEYSTONE_OWNED_KEY = 'tacticalrogue:keystoneOwned:v1';
export function getKeystoneQueue() {
  const arr = _read(KEYSTONE_QUEUE_KEY, []);
  return Array.isArray(arr) ? arr : [];
}
export function queueKeystone(id) {
  if (!id) return;
  const cur = getKeystoneQueue();
  cur.push(id);
  _write(KEYSTONE_QUEUE_KEY, cur);
}
export function consumeKeystoneQueue() {
  const cur = getKeystoneQueue();
  _write(KEYSTONE_QUEUE_KEY, []);
  return cur;
}
export function getOwnedKeystones() {
  const arr = _read(KEYSTONE_OWNED_KEY, []);
  return Array.isArray(arr) ? new Set(arr) : new Set();
}
export function setKeystoneOwned(id) {
  if (!id) return;
  const set = getOwnedKeystones();
  if (set.has(id)) return;
  set.add(id);
  _write(KEYSTONE_OWNED_KEY, [...set].sort());
}

// Lifetime megaboss kills — counted once per (boss, run-end). Feeds
// `unlockedAt.megabossKills` predicates on top-tier contracts.
const MEGABOSS_KILLS_KEY = 'tacticalrogue:megabossKills:v1';
export function getMegabossKills() {
  try { return parseInt(localStorage.getItem(MEGABOSS_KILLS_KEY) || '0', 10) || 0; }
  catch (_) { return 0; }
}
export function bumpMegabossKills() {
  try {
    const next = getMegabossKills() + 1;
    localStorage.setItem(MEGABOSS_KILLS_KEY, String(next));
    return next;
  } catch (_) { return 0; }
}

// Recruiter — marks-spent permanent unlocks. Each row is one-shot;
// once purchased, the upgrade applies forever. Stored as a Set
// serialised to a sorted array so we can grow the catalog without
// worrying about positional drift. Storage key kept as the prior
// `morticianUnlocks` for save-file compatibility.
const RECRUITER_UNLOCKS_KEY = 'tacticalrogue:morticianUnlocks:v1';
export function getRecruiterUnlocks() {
  const arr = _read(RECRUITER_UNLOCKS_KEY, []);
  return Array.isArray(arr) ? new Set(arr) : new Set();
}
export function setRecruiterUnlocked(id) {
  if (!id) return;
  const set = getRecruiterUnlocks();
  if (set.has(id)) return;
  set.add(id);
  _write(RECRUITER_UNLOCKS_KEY, [...set].sort());
}
export function hasRecruiterUnlock(id) {
  return getRecruiterUnlocks().has(id);
}
