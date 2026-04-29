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
    expiresAt: v.expiresAt | 0,
    progress: v.progress && typeof v.progress === 'object' ? v.progress : {},
    claimedAt: v.claimedAt | 0,
  };
}
export function setActiveContract(c) {
  if (!c) { _write(CONTRACTS_KEY, null); return; }
  _write(CONTRACTS_KEY, {
    activeContractId: c.activeContractId || null,
    expiresAt: c.expiresAt | 0,
    progress: c.progress || {},
    claimedAt: c.claimedAt | 0,
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
