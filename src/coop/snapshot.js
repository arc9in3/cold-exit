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

const _scratch = { gunmen: [], melees: [], loot: [] };

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
    });
  }
  return _scratch.loot.slice();
}

// Build the snapshot once per peer (loot section is per-recipient).
// Returns a Map<peerId, snapshot>. Caller iterates and sends targeted.
// Enemy section is the same across recipients so we build it once.
export function encodeSnapshotsPerPeer(gunmen, melees, seq, t, loot, peerIds) {
  const enemyPart = encodeEnemySnapshot(gunmen, melees, seq, t, null);
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

export function encodeEnemySnapshot(gunmen, melees, seq, t, loot = null) {
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
    });
  }
  return {
    seq: seq | 0,
    t: t | 0,
    gunmen: _scratch.gunmen.slice(),
    melees: _scratch.melees.slice(),
    // Note: loot section is empty here. Per-peer fanout via
    // encodeSnapshotsPerPeer is the path that includes loot,
    // so each recipient sees only their instanced items + shared.
    loot: [],
  };
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
  // sim and the joiner needs to mirror. We set hp/alive directly
  // rather than going through the damage path so death VFX don't
  // double-fire (the host already played them on its end).
  for (const g of gunmen.gunmen) {
    if (g.alive && !liveG.has(g.netId)) {
      g.hp = 0; g.alive = false;
    }
  }
  for (const e of melees.enemies) {
    if (e.alive && !liveM.has(e.netId)) {
      e.hp = 0; e.alive = false;
    }
  }
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

function _findByNetId(list, netId) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].netId === netId) return list[i];
  }
  return null;
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
  const live = new Set();
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
