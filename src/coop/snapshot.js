// Coop snapshot — host serializes enemy state, joiners apply.
//
// v1 sends a FULL snapshot of every alive gunman + melee at 20Hz.
// JSON for now (debuggable; binary delta-encoding lands when bandwidth
// becomes a real constraint, not before). Each entity is keyed by
// `netId` — assigned at spawn from a deterministic per-room counter
// in gunman.js / melee_enemy.js. Because the seeded RNG in
// regenerateLevel produces identical spawn order on host and joiner,
// the same netId refers to the same conceptual enemy on both ends.
//
// What's in the snapshot (host-authoritative):
//   - Position (x, z) + facing yaw — drives ghost-lerp on joiner
//   - HP — joiner uses for HUD bars + ragdoll on death
//   - Alive flag — falling edge → joiner kills the local rep
//   - State string — minimal AI phase tag for animation cues
//
// What's NOT synced (joiner runs locally for now):
//   - Detailed animation pose (rig joints) — too expensive to sync
//   - Particle FX, blood, gore — visual only
//   - Smoke / fire zones — fed from broadcast 'level-seed' regen
//   - Projectiles, loot — next session
//
// Sequence numbers + timestamps stamp every packet so the joiner can
// drop out-of-order packets and a future tick can do interpolation
// between two snapshots.

const _scratch = { gunmen: [], melees: [], drones: [], loot: [], corpses: [], brokenWindows: [], destroyedProps: [] };

// Windows snapshot — Phase H. Both peers regenerate the level from
// the same _runSeed (see main.js:_runSeed + level-seed broadcast), so
// `level._windows` is the same array (same length, same order) on
// host + joiner. The wire format is just a list of indices — every
// entry in _windows whose `state.broken === true`. Mutations are
// monotonic (a window can only break, never un-break within a level),
// so the joiner-side apply is idempotent: walk indices, call shatter()
// on entries that aren't already broken, ignore the rest.
//
// Why indices not netIds: windows have no spawn-order dependency on
// AI, so threading a netId field through level.js purely for coop
// would cost more than the index lookup it saves. If the seeded gen
// ever becomes order-unstable for windows we revisit.
function _encodeWindows(level) {
  _scratch.brokenWindows.length = 0;
  if (!level || !level._windows) return _scratch.brokenWindows.slice();
  for (let i = 0; i < level._windows.length; i++) {
    const entry = level._windows[i];
    const st = entry?.window?.state;
    if (st && st.broken) _scratch.brokenWindows.push(i);
  }
  return _scratch.brokenWindows.slice();
}

// Destructible-props snapshot — Phase J. Mirrors the windows pattern:
// host re-encodes the full set of destroyed propIds every tick (cheap;
// destructibles per level cap around 30-40), joiner re-applies
// idempotently. Encoded under key `dp` on the per-frame snapshot.
//
// The propId counter is host-deterministic (level._destructiblePropIdNext
// increments inside _registerProp during seeded gen), so id N on host
// === id N on joiner. Joiner-apply walks the obstacle list, finds the
// proxy with the matching propId, and calls level.destroyProp() if
// not already destroyed. destroyProp() is itself idempotent so a
// duplicate apply is a no-op.
function _encodeDestroyedProps(level) {
  _scratch.destroyedProps.length = 0;
  if (!level || !level.obstacles) return _scratch.destroyedProps.slice();
  for (const m of level.obstacles) {
    const ud = m && m.userData;
    if (!ud) continue;
    if (ud.maxHp == null) continue;     // not destructible
    if (!ud.destroyed) continue;
    if (ud.propId == null) continue;
    _scratch.destroyedProps.push(ud.propId | 0);
  }
  return _scratch.destroyedProps.slice();
}

// Joiner-side destructible-prop apply. snapshot.dp is an id list;
// for each id, find the proxy in level.obstacles whose
// userData.propId matches, and (if not already destroyed) call
// level.destroyProp(). Idempotent across both axes — repeat ids in
// successive snapshots are no-ops, and a prop the joiner already
// destroyed locally for any reason is skipped.
export function applyDestroyedPropsSnapshot(level, snapshot) {
  if (!level || !level.obstacles || !snapshot) return;
  const ids = snapshot.dp;
  if (!ids || !ids.length) return;
  // Build a propId → proxy map once per apply rather than scanning
  // the whole obstacle list per id. Cheap: <100 obstacles per level
  // and Map.set is O(1) amortized.
  const map = new Map();
  for (const m of level.obstacles) {
    const pid = m && m.userData ? m.userData.propId : null;
    if (pid != null) map.set(pid | 0, m);
  }
  for (const id of ids) {
    const proxy = map.get(id | 0);
    if (!proxy) continue;
    if (proxy.userData?.destroyed) continue;
    try { level.destroyProp(proxy); }
    catch (e) { console.warn('[coop] destroyProp apply failed', e); }
  }
}

// Joiner-side window apply. snapshot.bw is an index list; for each
// index, call shatter() on the corresponding entry's state if the
// joiner's local mirror isn't already broken. Idempotent — a window
// that's already broken locally is skipped without side effects.
// Single-player + host both bypass this (the apply path is gated by
// the caller).
export function applyWindowsSnapshot(level, snapshot) {
  if (!level || !level._windows || !snapshot) return;
  const indices = snapshot.bw;
  if (!indices || !indices.length) return;
  // Lazy-import shatter to dodge a module cycle: snapshot.js is
  // imported by main.js which also imports windows.js. Static import
  // here would still resolve, but keeping snapshot.js dependency-free
  // matches how applyLootSnapshot handles its spawn closure.
  const winLib = (typeof window !== 'undefined') ? window.__windowsLib : null;
  if (!winLib || typeof winLib.shatter !== 'function') return;
  for (const idx of indices) {
    const entry = level._windows[idx | 0];
    const st = entry?.window?.state;
    if (!st || st.broken) continue;
    try { winLib.shatter(st); }
    catch (e) { console.warn('[coop] window shatter apply failed', e); }
  }
}

// Megaboss snapshot — single optional object since at most one
// megaboss exists per arena. Mirrors position + yaw + hp so the
// joiner sees the boss move + damage progress. v1: AI / hazards
// (fires, bullets, gas) are NOT synced — that needs hazard-list
// snapshotting which we'll layer on next pass.
function _encodeMegaBoss(megaBoss) {
  if (!megaBoss || !megaBoss.alive) return null;
  // The three megaboss classes store their root mesh inconsistently
  // — Arboter uses `.boss` while Echo + General use `.group`. Fall
  // back to either so all three rotate cleanly into the snapshot.
  const root = megaBoss.boss || megaBoss.group;
  if (!root || !root.position) return null;
  const out = {
    x: +(root.position.x.toFixed(3)),
    z: +(root.position.z.toFixed(3)),
    y: +((megaBoss.facing ?? root.rotation?.y ?? 0).toFixed(3)),
    h: Math.round(megaBoss.hp || 0),
    m: Math.round(megaBoss.maxHp || 0),
    p: (megaBoss.phase | 0) || 1,
    s: megaBoss.state || 'idle',
  };
  // Echo-specific: ghost minions live on echoBoss.ghosts[] outside
  // any standard snapshot list. Encode their stable gids + positions
  // so the joiner can spawn local mirror rigs.
  if (typeof megaBoss._coopEncodeGhosts === 'function') {
    const ghosts = megaBoss._coopEncodeGhosts();
    if (ghosts && ghosts.length) out.eg = ghosts;
  }
  return out;
}

// Drone snapshot — same shape as gunmen/melees minus the state
// string (drones don't have a meaningful AI state worth syncing).
// Joiner mirrors via netId; missing entries despawn locally.
function _encodeDrones(droneMgr) {
  _scratch.drones.length = 0;
  if (!droneMgr || !droneMgr.drones) return _scratch.drones.slice();
  for (const d of droneMgr.drones) {
    if (!d || !d.alive || !d.group) continue;
    _scratch.drones.push({
      n: d.netId | 0,
      x: +(d.group.position.x.toFixed(3)),
      y: +(d.group.position.y.toFixed(3)),
      z: +(d.group.position.z.toFixed(3)),
      h: Math.round(d.hp),
      m: Math.round(d.maxHp),
    });
  }
  return _scratch.drones.slice();
}

// Body-loot snapshot — per dead+unlooted enemy, mirror their full
// `enemy.loot` array so joiners can search corpses without a
// request/response round-trip. Loot pieces are inlined since their
// total size per body is small (~3-5 items, ~50 bytes each). Host
// drives ownership; joiners send rpc-body-take to remove an item
// after pickup, host applies + the next snapshot reflects.
// Corpse encoder. When forPeerId is provided AND the entity has a
// per-peer loot map (e.lootByPeer), reads that peer's slice instead
// of the shared e.loot. Falls back to e.loot for entities killed
// outside coop or when forPeerId == null (single-player snapshot).
//
// Per-peer body-loot lets each player roll their own instanced
// drops at kill time, mirroring how containers already work.
function _encodeCorpses(gunmen, melees, forPeerId = null) {
  _scratch.corpses.length = 0;
  const collect = (list) => {
    for (const e of list) {
      if (!e || e.alive) continue;
      // Pick the per-peer slice if available, else the shared list.
      const hasPeerMap = !!(forPeerId && e.lootByPeer);
      const lootForPeer = hasPeerMap
        ? (e.lootByPeer.get(forPeerId) || [])
        : (e.loot || []);
      // Skip only when THIS peer has nothing left. e.looted is a
      // global "all peers empty" flag; if the local-peer slice still
      // has items, send them — even if other peers have emptied
      // their slices and the global flag was flipped. (Without this
      // gate, host emptying their slice would set e.looted=true and
      // the joiner's snapshot would drop the corpse, leaving the
      // joiner unable to access their own remaining items.)
      if (!hasPeerMap && e.looted) continue;
      if (!lootForPeer.length) continue;
      _scratch.corpses.push({
        n: e.netId | 0,
        x: +(e.group.position.x.toFixed(2)),
        z: +(e.group.position.z.toFixed(2)),
        // Loot items shipped verbatim — they're the full item defs
        // already; serializing once at packet build is cheaper than
        // round-tripping per-take RPCs.
        l: lootForPeer,
      });
    }
  };
  collect(gunmen.gunmen);
  collect(melees.enemies);
  return _scratch.corpses.slice();
}

// Loot snapshot — host serializes alive ground-loot items so joiners
// can render mirror representations. Item shape on the wire stays
// minimal (netId / position / display tint / display name) — the
// full item data is not synced; pickup will resolve the full item
// via a separate RPC in a follow-up session. For now, joiners SEE
// loot but can't pick it up (the local mirror is flagged
// _coopRemote so the joiner's pickup loop should skip it).
function _encodeLootForPeer(loot, forPeerId) {
  // Filter to entries this peer should see: their own claimed loot,
  // plus any null-claimed (shared) entries. Loot claimed by other
  // peers is invisible to this recipient — instanced co-op drops.
  _scratch.loot.length = 0;
  if (!loot || !loot.items) return _scratch.loot.slice();
  for (const e of loot.items) {
    if (!e || !e.group || !e.item) continue;
    if (e.group.visible === false) continue;
    // null = shared. A non-null claimedBy that doesn't match the
    // recipient is filtered out.
    if (e.claimedBy != null && e.claimedBy !== forPeerId) continue;
    _scratch.loot.push({
      n: e.netId | 0,
      x: +(e.group.position.x.toFixed(3)),
      z: +(e.group.position.z.toFixed(3)),
      // Mirror just enough to render the right colored cube label.
      t: e.item.tint | 0,
      r: e.item.rarity || 'common',
      nm: String(e.item.name || 'item').slice(0, 32),
      ty: e.item.type || '',
      // Claimed-for-recipient bit. Drives the owner-glow tint on
      // the joiner side so they can tell their personal drops
      // apart from shared loot at a glance. Omitted for shared
      // entries (claimedBy === null).
      ...(e.claimedBy != null ? { cb: 1 } : {}),
    });
  }
  return _scratch.loot.slice();
}

// Build the snapshot once per peer (loot section is per-recipient).
// Returns a Map<peerId, snapshot>. Caller iterates and sends targeted.
// Enemy section is the same across recipients so we build it once.
export function encodeSnapshotsPerPeer(gunmen, melees, seq, t, loot, peerIds, droneMgr = null, megaBoss = null, level = null) {
  // Build the truly-shared enemy section once; rebuild loot + corpses
  // per-peer so each recipient sees only their own instanced ground
  // drops AND only their own slice of body loot.
  const enemyPart = encodeEnemySnapshot(gunmen, melees, seq, t, null, droneMgr, megaBoss, level);
  const out = new Map();
  if (!peerIds || !peerIds.length) return out;
  for (const peerId of peerIds) {
    out.set(peerId, {
      ...enemyPart,
      loot: _encodeLootForPeer(loot, peerId),
      corpses: _encodeCorpses(gunmen, melees, peerId),
    });
  }
  return out;
}

export function encodeEnemySnapshot(gunmen, melees, seq, t, loot = null, droneMgr = null, megaBoss = null, level = null) {
  // Reuse scratch arrays so a 20Hz publish doesn't allocate a fresh
  // outer object each frame; per-entity payloads are still per-call.
  _scratch.gunmen.length = 0;
  _scratch.melees.length = 0;
  for (const g of gunmen.gunmen) {
    if (!g.alive) continue;
    _scratch.gunmen.push({
      n: g.netId | 0,
      x: +(g.group.position.x.toFixed(3)),
      z: +(g.group.position.z.toFixed(3)),
      y: +(g.group.rotation.y.toFixed(3)),    // yaw
      h: Math.round(g.hp),
      m: Math.round(g.maxHp),
      s: g.state || 'idle',
      // Tier + variant so the joiner's late-arrival spawn fallback
      // can mint a mirror that matches host's archetype (tank /
      // dasher / shieldBearer / sniper / boss). Omitted when the
      // entry is normal/no-variant to keep the typical packet small.
      ...(g.tier && g.tier !== 'normal' ? { t: g.tier } : {}),
      ...(g.variant ? { v: g.variant } : {}),
      // Burn DoT visual — sent only when active (>0) so the typical
      // snapshot stays small. Joiner reads this in _applyInterp to
      // pose flame particles on the right enemy.
      ...(g.burnT > 0 ? { bt: +g.burnT.toFixed(2), bs: g.burnStacks | 0 } : {}),
    });
  }
  for (const e of melees.enemies) {
    if (!e.alive) continue;
    _scratch.melees.push({
      n: e.netId | 0,
      x: +(e.group.position.x.toFixed(3)),
      z: +(e.group.position.z.toFixed(3)),
      y: +(e.group.rotation.y.toFixed(3)),
      h: Math.round(e.hp),
      m: Math.round(e.maxHp),
      s: e.state || 'idle',
      ...(e.tier && e.tier !== 'normal' ? { t: e.tier } : {}),
      ...(e.variant ? { v: e.variant } : {}),
      ...(e.burnT > 0 ? { bt: +e.burnT.toFixed(2), bs: e.burnStacks | 0 } : {}),
    });
  }
  return {
    seq: seq | 0,
    t: t | 0,
    gunmen: _scratch.gunmen.slice(),
    melees: _scratch.melees.slice(),
    drones: _encodeDrones(droneMgr),
    boss: _encodeMegaBoss(megaBoss),
    // Note: loot + corpses sections are empty/shared-fallback here.
    // Per-peer fanout via encodeSnapshotsPerPeer is the path that
    // includes per-peer loot AND per-peer body loot. The shared
    // fallback below covers single-player + legacy callers.
    loot: [],
    corpses: _encodeCorpses(gunmen, melees, null),
    // bw = broken-window indices (Phase H). Empty array when no
    // window has been damaged yet on this floor; cheap to keep on
    // every packet so the joiner doesn't need a separate "windows
    // changed" event channel.
    bw: _encodeWindows(level),
    // dp = destroyed-prop ids (Phase J). Same monotonic-state model
    // as bw — host re-encodes the full set every tick, joiner mirrors
    // idempotently via applyDestroyedPropsSnapshot. Empty until the
    // first destructible pops on this floor.
    dp: _encodeDestroyedProps(level),
  };
}

// Snapshot buffer for interpolation — joiners render at a fixed
// delay behind the latest received snapshot, blending between two
// known-good frames. Gives smooth motion at any snapshot rate
// (Quake/CS approach). Without this, lerp-toward-latest produces
// visible chase-stutter at 20Hz packets / 60Hz render.
const _snapBuffer = [];
const SNAPSHOT_BUFFER_MAX = 6;          // ~300ms of history at 20Hz
const RENDER_DELAY_MS = 100;            // render T - 100ms
// Reset snapshot buffer on disconnect so a stale frame doesn't
// briefly drive the apply path on the next session.
export function clearSnapshotBuffer() { _snapBuffer.length = 0; }
export function pushSnapshotForInterp(snap) {
  if (!snap) return;
  // Stamp local-receive time so we can derive interpolation T from
  // the client's wall clock — server t is unsynchronized.
  snap._recvT = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  _snapBuffer.push(snap);
  if (_snapBuffer.length > SNAPSHOT_BUFFER_MAX) _snapBuffer.shift();
}
export function pickInterpSnapshots() {
  // Returns { a, b, alpha } where the rendered state is
  // lerp(a, b, alpha) at render-time T = now - delay. If we don't
  // have two frames straddling that time, fall back to the latest.
  if (_snapBuffer.length === 0) return null;
  if (_snapBuffer.length === 1) return { a: _snapBuffer[0], b: _snapBuffer[0], alpha: 1 };
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const target = now - RENDER_DELAY_MS;
  // Find the most recent pair (a, b) where a._recvT <= target <= b._recvT.
  for (let i = _snapBuffer.length - 1; i >= 1; i--) {
    const b = _snapBuffer[i];
    const a = _snapBuffer[i - 1];
    if (a._recvT <= target && target <= b._recvT) {
      const span = Math.max(1, b._recvT - a._recvT);
      const alpha = Math.max(0, Math.min(1, (target - a._recvT) / span));
      return { a, b, alpha };
    }
  }
  // Outside the buffered range — clamp to extrapolation: use the
  // latest two frames at alpha=1 so we always render SOMETHING and
  // catch up cleanly if delivery hiccups.
  const b = _snapBuffer[_snapBuffer.length - 1];
  const a = _snapBuffer[_snapBuffer.length - 2];
  return { a, b, alpha: 1 };
}

// Apply via interpolation between two buffered snapshots — the
// standard Quake/Source approach. Picks the entity record from
// `a` and `b`, lerps position + yaw at `alpha`. Smoother than
// chasing a single moving target since we render strictly between
// known-good frames at the cost of a fixed render-time lag.
// Module-scope reusable scratch sets/maps for applyInterpolated.
// Joiner runs this every frame at render rate; allocating fresh
// Sets / Maps per call generated visible GC pressure on low-end
// devices. clear() + repopulate sidesteps the alloc.
const _SHARED_HIT_DIR = Object.freeze({ x: 0, z: -1 });
const _droneLive = new Set();
const _droneAMap = new Map();
const _lootLive = new Set();
const _interpLiveG = new Set();
const _interpLiveM = new Set();
const _interpAGmap = new Map();
const _interpAMmap = new Map();
const _corpseSeen = new Set();
export function applyInterpolated(gunmen, melees, lootMgr, spawnFn) {
  const pair = pickInterpSnapshots();
  if (!pair) return;
  const { a, b, alpha } = pair;
  _interpLiveG.clear();
  _interpLiveM.clear();
  _interpAGmap.clear();
  _interpAMmap.clear();
  const liveG = _interpLiveG;
  const liveM = _interpLiveM;
  const aGmap = _interpAGmap;
  for (const g of a.gunmen || []) aGmap.set(g.n, g);
  const aMmap = _interpAMmap;
  for (const m of a.melees || []) aMmap.set(m.n, m);
  for (const sb of b.gunmen || []) {
    liveG.add(sb.n);
    let g = _findByNetId(gunmen.gunmen, sb.n);
    if (!g) {
      // Late-arrival spawn — host added an enemy after our level-gen
      // (necromant minion, encounter wave, megaboss summon). Mint a
      // local mirror so the joiner can see + shoot it. tier/variant
      // pulled from the snapshot so a tank reads as a tank, sniper
      // as a sniper, etc. Position + HP keep up via subsequent interp.
      try {
        const opts = { tier: sb.t || 'normal', gearLevel: 0 };
        if (sb.v) opts.variant = sb.v;
        g = gunmen.spawn(sb.x, sb.z, null, opts);
        if (g) {
          g.netId = sb.n | 0;
          g._coopRemote = true;
          if (g.group?.position) g.group.position.set(sb.x, 0, sb.z);
        }
      } catch (e) { console.warn('[coop] late gunman spawn failed', e); }
      if (!g) continue;
    }
    const sa = aGmap.get(sb.n) || sb;
    _applyInterp(g, sa, sb, alpha);
  }
  for (const sb of b.melees || []) {
    liveM.add(sb.n);
    let e = _findByNetId(melees.enemies, sb.n);
    if (!e) {
      try {
        const opts = { tier: sb.t || 'normal', gearLevel: 0 };
        if (sb.v) opts.variant = sb.v;
        e = melees.spawn(sb.x, sb.z, opts);
        if (e) {
          e.netId = sb.n | 0;
          e._coopRemote = true;
          if (e.group?.position) e.group.position.set(sb.x, 0, sb.z);
        }
      } catch (err) { console.warn('[coop] late melee spawn failed', err); }
      if (!e) continue;
    }
    const sa = aMmap.get(sb.n) || sb;
    _applyInterp(e, sa, sb, alpha);
  }
  // Death sweep — locals alive but missing from the LATEST snapshot
  // get killed visually. (Same intent as the old snap-and-apply path
  // before the interpolation refactor.)
  const _coopHitDir = _SHARED_HIT_DIR;
  for (const g of gunmen.gunmen) {
    if (g.alive && !liveG.has(g.netId)) {
      try {
        g.manager.applyHit(g, (g.hp | 0) + 1, 'torso', _coopHitDir,
          { silent: true, coopVisualOnly: true });
      } catch (_) {
        g.hp = 0; g.alive = false;
      }
    }
  }
  for (const e of melees.enemies) {
    if (e.alive && !liveM.has(e.netId)) {
      try {
        e.manager.applyHit(e, (e.hp | 0) + 1, 'torso', _coopHitDir,
          { silent: true, coopVisualOnly: true });
      } catch (_) {
        e.hp = 0; e.alive = false;
      }
    }
  }
  // Loot section — apply from the latest snapshot directly. Loot
  // doesn't move on host today (drops are stationary), so
  // interpolation buys nothing for it.
  if (lootMgr && spawnFn) {
    applyLootSnapshot(b, lootMgr, spawnFn);
  }
  // Body-loot mirror — pulled out into a helper so the corpse +
  // unlooted-loot section can be applied independently of the
  // position-interp pass.
  _applyCorpseSection(b, gunmen, melees);
}

function _applyCorpseSection(snap, gunmen, melees) {
  if (!snap || !snap.corpses) return;
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  _corpseSeen.clear();
  const seen = _corpseSeen;
  for (const c of snap.corpses) {
    seen.add(c.n);
    let entity = _findByNetId(gunmen.gunmen, c.n);
    if (!entity) entity = _findByNetId(melees.enemies, c.n);
    if (!entity) continue;
    // Anti-flicker: just took an item locally and the host hasn't
    // ack'd via the next snapshot yet. Skip the loot replace until
    // the cooldown elapses so the just-taken item doesn't briefly
    // re-appear in the modal.
    if (entity._coopBodyLootCooldown && entity._coopBodyLootCooldown > now) continue;
    // CRITICAL: mutate entity.loot in place rather than replacing
    // the reference. lootUI.open() installs a splice wrap on the
    // open target's array; replacing the array orphans the wrap,
    // which means subsequent takes skip the rpc-body-take broadcast
    // and the joiner can re-loot the body indefinitely until the
    // host walks up and looks at it. (REGRESSION: bug-coop-bodyloot)
    if (!Array.isArray(entity.loot)) entity.loot = [];
    const incoming = c.l || [];
    entity.loot.length = 0;
    for (let i = 0; i < incoming.length; i++) entity.loot.push(incoming[i]);
    entity.looted = false;
  }
  for (const list of [gunmen.gunmen, melees.enemies]) {
    for (const e of list) {
      if (e._coopBodyLootCooldown && e._coopBodyLootCooldown > now) continue;
      if (!e.alive && e.netId && !seen.has(e.netId) && !e.looted) {
        e.looted = true;
        e.loot = [];
      }
    }
  }
}
// Megaboss apply — pulls position + hp off the latest snapshot
// (interpolation isn't worth the bookkeeping for one entity).
// Joiner's local megaBoss instance was spawned via the same
// regenerateLevel path (seeded), so the reference exists.
export function applyMegaBossSnapshot(snap, megaBoss) {
  if (!snap || !megaBoss) return;
  if (!snap.boss) {
    // Host says boss is gone (just died, or never spawned). If our
    // local mirror is still alive, kill the visual + flip alive=false
    // so the joiner doesn't keep seeing a corpse-looking-alive boss
    // standing in the arena while the run continues without it.
    // Don't trigger _die() — that fires loot-drop / onMegaBossDead
    // side effects which are host-auth and would double-fire here.
    if (megaBoss.alive) {
      megaBoss.alive = false;
      megaBoss.hp = 0;
      const root = megaBoss.boss || megaBoss.group;
      if (root) root.visible = false;
      // Hide the floating HP bar element if the boss exposes it.
      if (megaBoss._barEl) megaBoss._barEl.style.display = 'none';
    }
    return;
  }
  const b = snap.boss;
  // Mirror the root mesh from whichever field this megaboss class
  // uses. Arboter `.boss`, Echo + General `.group`.
  const root = megaBoss.boss || megaBoss.group;
  if (root?.position) {
    root.position.x = b.x;
    root.position.z = b.z;
  }
  if (typeof megaBoss.facing === 'number') megaBoss.facing = b.y;
  if (root?.rotation) root.rotation.y = b.y;
  megaBoss.hp = b.h;
  if (b.m) megaBoss.maxHp = b.m;
  if (typeof b.p === 'number') megaBoss.phase = b.p;
  if (b.s) megaBoss.state = b.s;
  // Echo ghost mirrors — encoded in `b.eg` when the host's boss is
  // an Echo with live ghosts. Joiner's _coopApplyGhostMirrors
  // reconciles spawn / position-update / despawn against the
  // local rig pool. No-op on Arboter / General (no method).
  if (typeof megaBoss._coopApplyGhostMirrors === 'function') {
    megaBoss._coopApplyGhostMirrors(b.eg || []);
  }
}

// Drone apply for the interpolation path. droneMgr is the joiner's
// local DroneManager. spawnFn is a closure that wraps droneMgr.spawn
// and stamps the netId from the snapshot. Same shape as the loot
// path so we don't reach into manager internals here.
export function applyDroneSnapshot(snapA, snapB, droneMgr, spawnFn, alpha) {
  if (!snapB || !droneMgr) return;
  _droneLive.clear();
  _droneAMap.clear();
  const live = _droneLive;
  const aMap = _droneAMap;
  if (snapA && snapA.drones) for (const d of snapA.drones) aMap.set(d.n, d);
  for (const sb of (snapB.drones || [])) {
    live.add(sb.n);
    let local = null;
    for (const d of droneMgr.drones) { if (d.netId === sb.n) { local = d; break; } }
    if (!local) {
      // Spawn a mirror; stamp the netId from snapshot.
      local = spawnFn(sb.x, sb.y, sb.z);
      if (local) local.netId = sb.n;
      if (local) local._coopRemote = true;
      continue;
    }
    // Lerp position. Drones have a y axis (hover), so include it.
    const sa = aMap.get(sb.n) || sb;
    local.group.position.x = sa.x + (sb.x - sa.x) * alpha;
    local.group.position.y = sa.y + (sb.y - sa.y) * alpha;
    local.group.position.z = sa.z + (sb.z - sa.z) * alpha;
    local.hp = sb.h;
    if (sb.m) local.maxHp = sb.m;
  }
  // Despawn drones missing from latest snapshot.
  for (let i = droneMgr.drones.length - 1; i >= 0; i--) {
    const d = droneMgr.drones[i];
    if (!d || !d._coopRemote) continue;
    if (live.has(d.netId)) continue;
    d.alive = false;
    if (d.slot) {
      d.slot.inUse = false;
      d.group.visible = false;
      d.group.position.set(0, -1000, 0);
    }
    droneMgr.drones.splice(i, 1);
  }
}

function _applyInterp(entity, a, b, alpha) {
  const ax = a.x, az = a.z, ay = a.y;
  const bx = b.x, bz = b.z, by = b.y;
  entity.group.position.x = ax + (bx - ax) * alpha;
  entity.group.position.z = az + (bz - az) * alpha;
  let dy = by - ay;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  entity.group.rotation.y = ay + dy * alpha;
  entity.hp = b.h;
  if (b.m) entity.maxHp = b.m;
  if (b.s) entity.state = b.s;
  // Burn DoT mirror — drives the per-actor flame particles in
  // main.js. Setting burnT > 0 on a coop-mirror enemy spawns the
  // same flame pose as a host-side burning enemy. Decays naturally
  // in the next snapshot when the host clears burnT.
  entity.burnT = +b.bt || 0;
  entity.burnStacks = b.bs | 0;
}

// Per-list netId → entity cache. Rebuilt when the list length
// changes (entries added or removed). Avoids the O(N²) scan
// pattern of calling _findByNetId once per snapshot entry against
// a list of similar size — gunmen / melees lists routinely have
// 20-40 entries, so a snapshot tick was 400-1600 ops without this.
function _findByNetId(list, netId) {
  if (!list._coopNetIdMap || list._coopNetIdLen !== list.length) {
    const map = new Map();
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e?.netId != null) map.set(e.netId, e);
    }
    list._coopNetIdMap = map;
    list._coopNetIdLen = list.length;
  }
  return list._coopNetIdMap.get(netId) || null;
}

// Apply the loot section of a snapshot to the joiner's local loot
// manager. For each entry in the snapshot, find the local mirror by
// netId; spawn one if missing. For local entries marked _coopRemote
// that aren't in the snapshot, drop them (host removed it — pickup,
// despawn timeout, etc).
//
// `lootMgr` is the LootManager. `spawnFn` is a closure provided by
// main.js that wraps `loot.spawnItem(pos, item)` to set _coopRemote
// + the snapshot-derived netId on the entry. Encapsulating it keeps
// snapshot.js free of LootManager internals.
export function applyLootSnapshot(snap, lootMgr, spawnFn) {
  if (!snap || !snap.loot) return;
  if (!lootMgr || !lootMgr.items) return;
  // First apply on a fresh joiner — wipe any locally-spawned loot
  // (from pre-coop solo play) so snapshot mirroring isn't fighting
  // a non-authoritative entry. _coopRemote items from prior applies
  // are kept; the live-set sweep below prunes ones the host removed.
  if (!lootMgr._coopWipedOnFirstApply) {
    for (let i = lootMgr.items.length - 1; i >= 0; i--) {
      const e = lootMgr.items[i];
      if (!e || e._coopRemote) continue;
      if (e.slot) { e.slot.inUse = false; e.group.visible = false; }
      lootMgr.items.splice(i, 1);
    }
    lootMgr._netIdCounter = 0;
    lootMgr._coopWipedOnFirstApply = true;
  }
  _lootLive.clear();
  const live = _lootLive;
  for (const sl of snap.loot) {
    live.add(sl.n);
    let entry = null;
    for (const e of lootMgr.items) { if (e.netId === sl.n) { entry = e; break; } }
    if (entry) {
      // Already mirrored; just keep position synced (loot doesn't
      // move on host today, but defensive).
      entry.group.position.x = sl.x;
      entry.group.position.z = sl.z;
      continue;
    }
    // Spawn a fresh mirror entry. Item is a stub with just the fields
    // needed to render — enough for the colored cube + nametag. Real
    // item data lands via the pickup RPC when that ships.
    const stubItem = {
      name: sl.nm,
      type: sl.ty || 'gear',
      tint: sl.t || 0xaaaaaa,
      rarity: sl.r || 'common',
    };
    const newEntry = spawnFn({ x: sl.x, y: 0.4, z: sl.z }, stubItem);
    if (newEntry) {
      newEntry.netId = sl.n;
      newEntry._coopRemote = true;
      // Owner-glow tint — recipient is either the claimer or the
      // entry is shared (cb omitted). Bumping emissive intensity +
      // adding an outline halo lets the joiner spot personal drops
      // versus shared loot at iso distance.
      if (sl.cb) {
        newEntry.claimedForLocal = true;
        if (newEntry.slot?.mat) {
          newEntry.slot.mat.emissive.setHex(stubItem.tint || 0xaaaaaa)
            .multiplyScalar(1.6);
          newEntry.slot.mat.emissiveIntensity = 1.0;
        }
        if (newEntry.slot?.light) {
          newEntry.slot.light.intensity = 1.6;
        }
      }
    }
  }
  // Despawn locals the host says are gone. Only despawn entries that
  // were spawned via snapshot (_coopRemote) — local-original entries
  // (host's own spawns, single-player drops) stay put.
  for (let i = lootMgr.items.length - 1; i >= 0; i--) {
    const e = lootMgr.items[i];
    if (!e || !e._coopRemote) continue;
    if (live.has(e.netId)) continue;
    // Drop via the manager's release path so the slot returns to the
    // pool. Some loot managers expose a remove(); fall back to the
    // splice + slot.inUse=false pattern if not.
    if (lootMgr.remove) lootMgr.remove(e);
    else if (e.slot) {
      e.slot.inUse = false;
      e.group.visible = false;
      lootMgr.items.splice(i, 1);
    }
  }
}

// ----- Delta encoding (v1) -----
//
// Behind the `coop:delta` localStorage flag (host-side). When the flag
// is on, the host emits a delta packet against the per-peer baseline
// instead of the full snapshot. The joiner reconstructs the full
// snapshot from baseline + delta and feeds the same downstream apply
// path (interp buffer, applyInterpolated, applyMegaBossSnapshot, etc).
//
// Wire shape:
//   FULL  (existing): { seq, t, gunmen:[..], melees:[..], drones:[..],
//                       boss, loot:[..], corpses:[..], bw:[..], dp:[..] }
//   DELTA (new):      { seq, t, _d:1, base:<prior_seq>,
//                       dgunmen?:[..changed], xgunmen?:[netIds],
//                       dmelees?, xmelees?, ddrones?, xdrones?,
//                       dloot?, xloot?, dcorpses?, xcorpses?,
//                       boss?, bw?, dp? }
//   For dgunmen / dmelees / etc., entries are FULL records keyed by n;
//   the joiner replaces baseline.<n> with the new record. xgunmen lists
//   netIds removed since baseline.
//   boss / bw / dp are sent in full when changed; absent fields mean
//   "use baseline value." `boss` may be `null` to mean "boss died."
//
// Resync: if the joiner's baseline doesn't match the delta's `base`
// seq, it sends `snapshot-resync` (kind allowlisted on the worker).
// The host drops that peer's baseline; the next encode tick emits a
// FULL snapshot and the cycle restarts.

const _peerBaselines = new Map();   // host-side: peerId → last full snapshot
let _joinerLastFullSnap = null;     // joiner-side: last reconstructed full
const _deltaStats = {
  sentFull: 0, sentDelta: 0,
  bytesFull: 0, bytesDelta: 0,
  recvFull: 0, recvDelta: 0,
  resyncRequested: 0, resyncServed: 0,
};
export function getDeltaStats() { return { ..._deltaStats }; }
export function resetDeltaStats() {
  _deltaStats.sentFull = 0; _deltaStats.sentDelta = 0;
  _deltaStats.bytesFull = 0; _deltaStats.bytesDelta = 0;
  _deltaStats.recvFull = 0; _deltaStats.recvDelta = 0;
  _deltaStats.resyncRequested = 0; _deltaStats.resyncServed = 0;
}

// Host-side: peer disconnected → free its baseline. Caller wires this
// from the transport's peer-out event so memory doesn't grow with
// churn over a long session.
export function dropPeerBaseline(peerId) {
  if (_peerBaselines.delete(peerId)) _deltaStats.resyncServed += 1;
}
// Host-side: clear all baselines (e.g., on transport close, host-lost,
// or when the user toggles the flag mid-session).
export function clearAllBaselines() { _peerBaselines.clear(); }
// Joiner-side: forget the reconstructed baseline. Pair with
// clearSnapshotBuffer() on disconnect / host-lost so the next session
// starts clean.
export function clearJoinerBaseline() { _joinerLastFullSnap = null; }

// Host-side encode wrapper. Builds full snapshots via the existing
// encodeSnapshotsPerPeer, then for each peer either sends the full
// (no baseline yet) or computes a delta against the stored baseline.
// Returns Map<peerId, payload>; caller iterates and `transport.send`s.
export function encodeSnapshotsPerPeerWithDelta(
  gunmen, melees, seq, t, loot, peerIds, droneMgr, megaBoss, level,
) {
  const fullPerPeer = encodeSnapshotsPerPeer(
    gunmen, melees, seq, t, loot, peerIds, droneMgr, megaBoss, level,
  );
  const out = new Map();
  for (const [peerId, full] of fullPerPeer) {
    const baseline = _peerBaselines.get(peerId);
    if (!baseline) {
      _peerBaselines.set(peerId, full);
      _deltaStats.sentFull += 1;
      out.set(peerId, full);
      continue;
    }
    const delta = _diffSnap(baseline, full);
    _peerBaselines.set(peerId, full);
    _deltaStats.sentDelta += 1;
    out.set(peerId, delta);
  }
  return out;
}

// Joiner-side: turn an incoming snapshot (full OR delta) into a full
// snapshot the existing apply path can consume. Returns null if the
// delta references a baseline we don't have — caller should request
// resync and drop the packet.
export function reconstructFromDelta(snap) {
  if (!snap) return null;
  if (!snap._d) {
    // Full snapshot — install as new baseline and pass through.
    _joinerLastFullSnap = snap;
    _deltaStats.recvFull += 1;
    return snap;
  }
  _deltaStats.recvDelta += 1;
  const base = _joinerLastFullSnap;
  if (!base || base.seq !== snap.base) return null;
  const merged = {
    seq: snap.seq | 0,
    t:   snap.t   | 0,
    gunmen:  _applyArrayDelta(base.gunmen,  snap.dgunmen,  snap.xgunmen),
    melees:  _applyArrayDelta(base.melees,  snap.dmelees,  snap.xmelees),
    drones:  _applyArrayDelta(base.drones,  snap.ddrones,  snap.xdrones),
    loot:    _applyArrayDelta(base.loot,    snap.dloot,    snap.xloot),
    corpses: _applyArrayDelta(base.corpses, snap.dcorpses, snap.xcorpses),
    boss: Object.prototype.hasOwnProperty.call(snap, 'boss') ? snap.boss : base.boss,
    bw:   Object.prototype.hasOwnProperty.call(snap, 'bw')   ? snap.bw   : base.bw,
    dp:   Object.prototype.hasOwnProperty.call(snap, 'dp')   ? snap.dp   : base.dp,
  };
  _joinerLastFullSnap = merged;
  return merged;
}

// Joiner-side: convenience marker for "we got a delta but couldn't
// apply it." Bumps the resync counter and returns true so the caller
// can branch cleanly.
export function notifyResyncRequested() {
  _deltaStats.resyncRequested += 1;
  return true;
}

function _diffSnap(base, cur) {
  const out = { seq: cur.seq | 0, t: cur.t | 0, _d: 1, base: base.seq | 0 };
  const g = _diffArrayByN(base.gunmen, cur.gunmen);
  if (g.d.length) out.dgunmen = g.d;
  if (g.x.length) out.xgunmen = g.x;
  const m = _diffArrayByN(base.melees, cur.melees);
  if (m.d.length) out.dmelees = m.d;
  if (m.x.length) out.xmelees = m.x;
  const d = _diffArrayByN(base.drones, cur.drones);
  if (d.d.length) out.ddrones = d.d;
  if (d.x.length) out.xdrones = d.x;
  const lo = _diffArrayByN(base.loot, cur.loot);
  if (lo.d.length) out.dloot = lo.d;
  if (lo.x.length) out.xloot = lo.x;
  const c = _diffArrayByN(base.corpses, cur.corpses);
  if (c.d.length) out.dcorpses = c.d;
  if (c.x.length) out.xcorpses = c.x;
  // Boss + bw + dp ride along as full when changed, omitted when not.
  // They're tiny enough that an inner-shape diff isn't worth the code.
  if (!_bossEq(base.boss, cur.boss)) out.boss = cur.boss;
  if (!_arrEq(base.bw, cur.bw)) out.bw = cur.bw;
  if (!_arrEq(base.dp, cur.dp)) out.dp = cur.dp;
  return out;
}

// Diff arrays-of-records keyed by `n`. Emits full record for new or
// changed entries in `d`, just netIds for removals in `x`. Stable
// across orderings since we key by `n`, not array index.
function _diffArrayByN(baseArr, curArr) {
  const baseMap = new Map();
  if (baseArr) for (const e of baseArr) baseMap.set(e.n, e);
  const dOut = [];
  const live = new Set();
  if (curArr) {
    for (const e of curArr) {
      live.add(e.n);
      const prev = baseMap.get(e.n);
      if (!prev || !_recordEq(prev, e)) dOut.push(e);
    }
  }
  const xOut = [];
  if (baseArr) for (const e of baseArr) if (!live.has(e.n)) xOut.push(e.n);
  return { d: dOut, x: xOut };
}

function _applyArrayDelta(baseArr, dArr, xArr) {
  const map = new Map();
  if (baseArr) for (const e of baseArr) map.set(e.n, e);
  if (xArr) for (const n of xArr) map.delete(n);
  if (dArr) for (const e of dArr) map.set(e.n, e);
  return [...map.values()];
}

// Shallow record equality with one level of array recursion (corpse
// `l` arrays of item records, boss `eg` ghost arrays). Intentionally
// over-conservative: any non-=== object value that isn't an array
// counts as different — which means we re-send. False negatives are
// invisible-desync bugs; false positives just cost a few bytes.
function _recordEq(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const va = a[k], vb = b[k];
    if (va === vb) continue;
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (va.length !== vb.length) return false;
      for (let i = 0; i < va.length; i++) {
        const ea = va[i], eb = vb[i];
        if (ea === eb) continue;
        if (typeof ea === 'object' && ea && typeof eb === 'object' && eb) {
          if (!_recordEq(ea, eb)) return false;
        } else {
          return false;
        }
      }
      continue;
    }
    return false;
  }
  return true;
}

function _bossEq(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return _recordEq(a, b);
}
function _arrEq(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
