// Per-run stats + a persistent top-N leaderboard. Local-first by
// default (localStorage) with an optional remote sync layer that
// pushes completed runs to the Cloudflare Worker in `worker/` and
// fetches the global top. When no `apiBase()` is configured, the
// remote sync is a no-op and the module behaves exactly like the
// original local-only version.
//
// Run eligibility: a run only counts toward the leaderboard when it
// ends naturally (on death) AND was not tainted by save / load at any
// point during it. Saving or loading flips `tainted = true`, and the
// run is silently dropped on submission. That prevents save-scumming
// from polluting top scores.

import { apiBase, apiEnabled } from './api_config.js';

const STORAGE_KEY = 'tacticalrogue_leaderboard_v1';
const PER_CATEGORY_CAP = 10;

export class RunStats {
  constructor() { this.reset(); }

  reset() {
    this.startedAt = Date.now();
    this.credits = 0;        // cumulative value earned (loot credits + sold chips etc.)
    this.levels = 0;         // highest level index reached this run
    this.damage = 0;         // total damage dealt to enemies
    this.kills = 0;          // enemies killed
    this.tainted = false;    // true if save/load was used this run
    this.restartCount = 0;   // how many times the player hit "Restart Level" from death
    this.playerName = null;  // filled in on submit
    this.deathLevel = null;  // level index when the player died
    this.deathAt = null;     // timestamp of death
    this.mythicRun = false;  // started via mythic-run unlock — leaderboard tag
    // Priest encounter — repeats until you've refused 3 times and
    // earned the demon bear. hasDemonBear gates re-spawning the
    // priest AND the special bear-merchant trade for the Pain mace.
    this.priestRefusals = 0;
    this.hasDemonBear = false;
    // Pity-timer for random encounters. Base spawn chance is 30% per
    // level; every level WITHOUT an encounter pumps this by +10%
    // (capped at 95%). Resets to 0 the moment an encounter actually
    // spawns. Read by level.js _pickAndMarkEncounterRoom via a
    // per-level config field set by main.js before generate().
    this.encounterChanceBonus = 0;
    // Contract-relevant event flags + counters. Read by contracts.js
    // evaluate(snapshot) on extract / death; they aren't part of the
    // leaderboard payload. Defaults are the "best-case" assumptions
    // that get flipped off as the player plays:
    //   pistolOnly  flips false on first non-pistol fire
    //   noConsum    flips false on first consumable use
    //   noMelee     flips false on first melee swing landed
    //   critHeadshots / throwableKills count up
    //   extracted   flips true on a successful extract event
    //   (peakLevel mirrors `levels` and is exposed on snapshot)
    this.pistolOnly = true;
    this.noConsumables = true;
    this.noMelee = true;
    this.critHeadshots = 0;
    this.throwableKills = 0;
    this.extracted = false;
  }

  markTainted() { this.tainted = true; }

  addCredits(n) {
    if (!isFinite(n) || n <= 0) return;
    this.credits += n;
  }
  addDamage(n) {
    if (!isFinite(n) || n <= 0) return;
    this.damage += n;
  }
  addKill()  { this.kills += 1; }
  setLevel(i) {
    // Monotonic — don't regress if the player somehow moves backward
    // (there's no mechanic for it today, but future flow changes
    // shouldn't quietly drop their furthest-reached record).
    if (i > this.levels) this.levels = i;
  }
  // Contract-event helpers — main.js calls these from the relevant
  // gameplay sites (fire path, melee resolve, throwable kill, etc.).
  noteFireWeaponClass(cls) { if (cls && cls !== 'pistol') this.pistolOnly = false; }
  noteConsumableUsed()     { this.noConsumables = false; }
  noteMeleeLanded()        { this.noMelee = false; }
  noteCritHeadshot()       { this.critHeadshots += 1; }
  noteThrowableKill()      { this.throwableKills += 1; }
  noteExtracted()          { this.extracted = true; }

  snapshot() {
    return {
      credits: Math.round(this.credits),
      levels: this.levels,
      damage: Math.round(this.damage),
      kills: this.kills,
      tainted: this.tainted,
      startedAt: this.startedAt,
      deathLevel: this.deathLevel,
      deathAt: this.deathAt,
      playerName: this.playerName || 'anon',
      // Contract-event surface — present on every snapshot so
      // contracts.js's evaluate(snapshot) gets stable field shapes.
      // peakLevel mirrors `levels` under a stable name for contract defs
      // that read by run-end "highest floor" rather than the leaderboard
      // sort key.
      peakLevel: this.levels,
      extracted: this.extracted,
      pistolOnly: this.pistolOnly,
      noConsumables: this.noConsumables,
      noMelee: this.noMelee,
      critHeadshots: this.critHeadshots,
      throwableKills: this.throwableKills,
    };
  }
}

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { credits: [], levels: [], damage: [], kills: [] };
    const parsed = JSON.parse(raw);
    return {
      credits: Array.isArray(parsed.credits) ? parsed.credits : [],
      levels:  Array.isArray(parsed.levels)  ? parsed.levels  : [],
      damage:  Array.isArray(parsed.damage)  ? parsed.damage  : [],
      kills:   Array.isArray(parsed.kills)   ? parsed.kills   : [],
    };
  } catch (_) {
    return { credits: [], levels: [], damage: [], kills: [] };
  }
}

function _save(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
}

function _insertSorted(list, entry, keyFn) {
  list.push(entry);
  list.sort((a, b) => keyFn(b) - keyFn(a));
  if (list.length > PER_CATEGORY_CAP) list.length = PER_CATEGORY_CAP;
}

// Fire-and-forget POST to the Worker for one score category. Failure
// is silent — the local leaderboard is already updated by the time we
// get here, so network flakiness or a misconfigured API base doesn't
// cost the player their local record.
async function _postCategory(category, entry) {
  if (!apiEnabled()) return;
  const base = apiBase();
  try {
    await fetch(`${base}/api/scores/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        category,
        name: entry.playerName || 'anon',
        score: entry[category] || 0,
        meta: {
          deathLevel: entry.deathLevel,
          kills: entry.kills,
          credits: entry.credits,
          mythicRun: !!entry.mythicRun,
        },
      }),
    });
  } catch (_) { /* offline or CORS — keep running */ }
}

// GET a category from the Worker. Returns null if disabled / failed
// so callers can fall back to the local list.
async function _fetchRemoteCategory(category, limit = PER_CATEGORY_CAP) {
  if (!apiEnabled()) return null;
  const base = apiBase();
  try {
    const url = `${base}/api/scores/top?category=${encodeURIComponent(category)}&limit=${limit}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.entries) ? data.entries : null;
  } catch (_) {
    return null;
  }
}

export const Leaderboard = {
  // Record a completed run. No-op if the run was tainted. Local first
  // (instant persistence); remote push fires in the background.
  submitRun(stats) {
    const s = stats.snapshot();
    if (stats.tainted) return { accepted: false, reason: 'tainted' };
    if (s.credits <= 0 && s.levels <= 0 && s.damage <= 0 && s.kills <= 0) {
      return { accepted: false, reason: 'empty' };
    }
    const state = _load();
    _insertSorted(state.credits, s, (e) => e.credits);
    _insertSorted(state.levels,  s, (e) => e.levels);
    _insertSorted(state.damage,  s, (e) => e.damage);
    _insertSorted(state.kills,   s, (e) => e.kills);
    _save(state);
    // Push each category to the remote leaderboard without blocking.
    // The caller already returned a synchronous result by the time
    // these resolve; UI that cares about ranks should read remoteTop
    // directly after the run ends.
    if (apiEnabled()) {
      _postCategory('credits', s);
      _postCategory('levels',  s);
      _postCategory('damage',  s);
      _postCategory('kills',   s);
    }
    return { accepted: true };
  },

  // Top N per category. Categories: 'credits' | 'levels' | 'damage' | 'kills'.
  top(category, n = PER_CATEGORY_CAP) {
    const state = _load();
    const list = state[category] || [];
    return list.slice(0, n);
  },

  // Async fetch of the remote top — returns the remote list, or the
  // local list if no API is configured / the request failed. Use this
  // for the main-menu leaderboard panel so friends see each other's
  // runs alongside their own.
  async remoteTop(category, n = PER_CATEGORY_CAP) {
    const remote = await _fetchRemoteCategory(category, n);
    if (remote) return { source: 'remote', entries: remote };
    return { source: 'local', entries: this.top(category, n) };
  },

  all() { return _load(); },

  clear() { try { localStorage.removeItem(STORAGE_KEY); } catch (_) {} },
};
