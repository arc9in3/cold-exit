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

const _scratch = { gunmen: [], melees: [], drones: [], loot: [], corpses: [] };

// Megaboss snapshot — single optional object since at most one
// megaboss exists per arena. Mirrors position + yaw + hp so the
// joiner sees the boss move + damage progress. v1: AI / hazards
// (fires, bullets, gas) are NOT synced — that needs hazard-list
// snapshotting which we'll layer on next pass.
function _encodeMegaBoss(megaBoss) {
  if (!megaBoss || !megaBoss.alive || !megaBoss.boss) return null;
  return {
    x: +(megaBoss.boss.position.x.toFixed(3)),
    z: +(megaBoss.boss.position.z.toFixed(3)),
    y: +(megaBoss.facing?.toFixed?.(3) ?? 0),
    h: Math.round(megaBoss.hp),
    m: Math.round(megaBoss.maxHp),
    p: megaBoss.phase | 0,
    s: megaBoss.state || 'idle',
  };
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
function _encodeCorpses(gunmen, melees) {
  _scratch.corpses.length = 0;
  const collect = (list) => {
    for (const e of list) {
      if (!e || e.alive) continue;
      if (e.looted) continue;
      if (!e.loot || !e.loot.length) continue;
      _scratch.corpses.push({
        n: e.netId | 0,
        x: +(e.group.position.x.toFixed(2)),
        z: +(e.group.position.z.toFixed(2)),
        // Loot items shipped verbatim — they're the full item defs
        // already; serializing once at packet build is cheaper than
        // round-tripping per-take RPCs.
        l: e.loot,
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
export function encodeSnapshotsPerPeer(gunmen, melees, seq, t, loot, peerIds, droneMgr = null, megaBoss = null) {
  const enemyPart = encodeEnemySnapshot(gunmen, melees, seq, t, null, droneMgr, megaBoss);
  const out = new Map();
  if (!peerIds || !peerIds.length) return out;
  for (const peerId of peerIds) {
    out.set(peerId, {
      ...enemyPart,
      loot: _encodeLootForPeer(loot, peerId),
    });
  }
  return out;
}

export function encodeEnemySnapshot(gunmen, melees, seq, t, loot = null, droneMgr = null, megaBoss = null) {
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
    // Note: loot section is empty here. Per-peer fanout via
    // encodeSnapshotsPerPeer is the path that includes loot,
    // so each recipient sees only their instanced items + shared.
    loot: [],
    // Corpses with searchable body-loot. Shared across all peers
    // (anyone in the room can search any body).
    corpses: _encodeCorpses(gunmen, melees),
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

// Apply a received snapshot to the joiner's local enemy lists.
// Strategy: build a netId index from the local enemy arrays, then
// for every entry in the snapshot find-and-update. Locals not in
// the snapshot are killed (host says they're gone). The joiner's
// enemies were spawned in lockstep with the host via seed sync, so
// netIds line up — find-or-create is just find.
export function applyEnemySnapshot(snap, gunmen, melees, lerp = 1) {
  if (!snap) return;
  const liveG = new Set();
  const liveM = new Set();
  for (const sg of snap.gunmen || []) {
    liveG.add(sg.n);
    const g = _findByNetId(gunmen.gunmen, sg.n);
    if (!g) continue;
    _applyTo(g, sg, lerp);
  }
  for (const sm of snap.melees || []) {
    liveM.add(sm.n);
    const e = _findByNetId(melees.enemies, sm.n);
    if (!e) continue;
    _applyTo(e, sm, lerp);
  }
  // Kill locals the host didn't include — they died on the host's
  // sim and the joiner needs to mirror the death pose / corpse
  // collapse. Driving the death through applyHit (with overkill
  // damage) triggers the rig pose, deathT, alert hide, and the
  // other visual side effects locally. The {coopVisualOnly: true}
  // flag tells main.js's hit interceptor to skip the rpc-shoot
  // forwarding and lets the local applyHit run; managers ignore
  // the flag, but `silent: true` suppresses death sfx and witness
  // alerts (we're already remote, no witness logic should fire).
  // Loot / XP side effects live in the CALLER of applyHit (not
  // inside it) so they don't fire here — joiner stays read-only.
  // Synthetic hit direction — pokeDeath() inside applyHit gates the
  // rig pose on `hitDir` being non-null, so passing null leaves the
  // corpse standing upright. Any non-zero vector triggers the
  // corpse collapse + ragdoll-lite physics. Forward-facing default;
  // hit direction doesn't matter much for a remote-mirrored death.
  const _coopHitDir = { x: 0, z: -1 };
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
  // Body loot mirror — host's corpses with unlooted items send the
  // full item array. Joiner copies onto the local entity so the
  // search-body interact uses the host's authoritative list. The
  // looted flag flips when host's enemy.loot empties (corpse
  // disappears from the corpses[] section).
  const corpseSeen = new Set();
  for (const c of (snap.corpses || [])) {
    corpseSeen.add(c.n);
    let entity = _findByNetId(gunmen.gunmen, c.n);
    if (!entity) entity = _findByNetId(melees.enemies, c.n);
    if (!entity) continue;
    entity.loot = c.l || [];
    entity.looted = false;
  }
  // Any local dead entity that ISN'T in the snapshot's corpse list
  // is either (a) host already had it looted (host dropped it from
  // loot) or (b) been around long enough that snapshots stopped
  // including it — flag looted so the search prompt hides.
  const flagLooted = (list) => {
    for (const e of list) {
      if (!e.alive && e.netId && !corpseSeen.has(e.netId)) {
        if (!e.looted) {
          e.looted = true;
          e.loot = [];
        }
      }
    }
  };
  flagLooted(gunmen.gunmen);
  flagLooted(melees.enemies);
}

function _applyTo(entity, snap, lerp) {
  // Position lerp toward snapshot — at lerp=1 this snaps; smaller
  // values give visual smoothing between 20Hz packets. Yaw uses the
  // same lerp but on the shortest arc.
  const k = Math.max(0, Math.min(1, lerp));
  const cur = entity.group.position;
  cur.x += (snap.x - cur.x) * k;
  cur.z += (snap.z - cur.z) * k;
  // Shortest-arc yaw lerp.
  let dy = (snap.y - entity.group.rotation.y);
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  entity.group.rotation.y += dy * k;
  // Direct HP / state writes — these come from the authoritative
  // sim, not local actions, so no animation-trigger logic runs.
  entity.hp = snap.h;
  if (snap.m) entity.maxHp = snap.m;
  if (snap.s) entity.state = snap.s;
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
  // Death sweep — same as applyEnemySnapshot. Locals alive but
  // missing from the LATEST snapshot get killed visually.
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
  // Body-loot mirror — also from latest snapshot. Pulled out into a
  // helper so applyEnemySnapshot can share the pruning logic.
  _applyCorpseSection(b, gunmen, melees);
}

function _applyCorpseSection(snap, gunmen, melees) {
  if (!snap || !snap.corpses) return;
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const seen = new Set();
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
    // No boss info — host says boss is gone or not spawned.
    return;
  }
  const b = snap.boss;
  if (megaBoss.boss?.position) {
    megaBoss.boss.position.x = b.x;
    megaBoss.boss.position.z = b.z;
  }
  if (typeof megaBoss.facing === 'number') {
    megaBoss.facing = b.y;
    if (megaBoss.boss) megaBoss.boss.rotation.y = b.y;
  }
  megaBoss.hp = b.h;
  if (b.m) megaBoss.maxHp = b.m;
  if (typeof b.p === 'number') megaBoss.phase = b.p;
  if (b.s) megaBoss.state = b.s;
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
