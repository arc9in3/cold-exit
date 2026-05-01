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

const _scratch = { gunmen: [], melees: [] };

export function encodeEnemySnapshot(gunmen, melees, seq, t) {
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
