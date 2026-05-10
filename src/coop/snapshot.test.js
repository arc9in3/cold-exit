// Round-trip smoke for the delta encoder. Run with:
//   node --test src/coop/snapshot.test.js
//
// REGRESSION: coop-snapshot-delta — verifies that the host's diff
// + the joiner's reconstruct produce a snapshot byte-equivalent to
// the source. Without this round-trip property, deltas can silently
// drop changes (false-positive _recordEq returns) and cause invisible
// joiner desync.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeSnapshotsPerPeerWithDelta,
  reconstructFromDelta,
  clearAllBaselines,
  clearJoinerBaseline,
  resetDeltaStats,
  getDeltaStats,
} from './snapshot.js';

// Minimal stubs that satisfy encodeSnapshotsPerPeer's surface. The
// encoder only reads .alive, .netId, .group.position{x,z}, .group.rotation.y,
// .hp, .maxHp, .state, .tier, .variant, .burnT, .burnStacks on entities,
// and .items on the loot manager / .drones on the drone manager.
function ent(n, x, z, hp = 100, state = 'idle') {
  return {
    netId: n, alive: true, hp, maxHp: 100, state,
    tier: 'normal', variant: null,
    burnT: 0, burnStacks: 0,
    group: { position: { x, y: 0, z }, rotation: { y: 0 } },
  };
}
function mkSim() {
  return {
    gunmen:  { gunmen:  [ent(1, 1, 1), ent(2, 2, 2), ent(3, 3, 3)] },
    melees:  { enemies: [ent(10, 5, 5), ent(11, 6, 6)] },
    drones:  { drones: [] },
    loot:    { items: [] },
    boss:    null,
    level:   { _windows: [], obstacles: [] },
  };
}

function encodeOne(sim, peerId, seq) {
  const map = encodeSnapshotsPerPeerWithDelta(
    sim.gunmen, sim.melees, seq, 0, sim.loot, [peerId],
    sim.drones, sim.boss, sim.level,
  );
  return map.get(peerId);
}

test('first encode for a peer is FULL (no _d flag)', () => {
  clearAllBaselines();
  clearJoinerBaseline();
  resetDeltaStats();
  const sim = mkSim();
  const pkt = encodeOne(sim, 'A', 1);
  assert.equal(pkt._d, undefined);
  assert.equal(pkt.gunmen.length, 3);
  assert.equal(getDeltaStats().sentFull, 1);
  assert.equal(getDeltaStats().sentDelta, 0);
});

test('second encode is DELTA when nothing changed', () => {
  clearAllBaselines();
  clearJoinerBaseline();
  resetDeltaStats();
  const sim = mkSim();
  encodeOne(sim, 'A', 1);
  const pkt = encodeOne(sim, 'A', 2);
  assert.equal(pkt._d, 1);
  assert.equal(pkt.base, 1);
  // No changed entries → no dgunmen / xgunmen at all.
  assert.equal(pkt.dgunmen, undefined);
  assert.equal(pkt.xgunmen, undefined);
  assert.equal(pkt.dmelees, undefined);
});

test('delta carries only changed entries', () => {
  clearAllBaselines();
  clearJoinerBaseline();
  resetDeltaStats();
  const sim = mkSim();
  encodeOne(sim, 'A', 1);
  // Move one gunman, leave others untouched.
  sim.gunmen.gunmen[1].group.position.x = 99;
  const pkt = encodeOne(sim, 'A', 2);
  assert.equal(pkt._d, 1);
  assert.equal(pkt.dgunmen.length, 1);
  assert.equal(pkt.dgunmen[0].n, 2);
  assert.equal(pkt.dgunmen[0].x, 99);
  // Removed entries appear in xgunmen as netIds.
  sim.gunmen.gunmen[2].alive = false;
  const pkt2 = encodeOne(sim, 'A', 3);
  assert.deepEqual(pkt2.xgunmen, [3]);
});

test('joiner reconstruct round-trip equals host state', () => {
  clearAllBaselines();
  clearJoinerBaseline();
  resetDeltaStats();
  const sim = mkSim();
  // Tick 1 — full.
  const p1 = encodeOne(sim, 'A', 1);
  const r1 = reconstructFromDelta(p1);
  assert.equal(r1.gunmen.length, 3);
  // Tick 2 — move one, despawn one.
  sim.gunmen.gunmen[0].group.position.x = 50;
  sim.gunmen.gunmen[2].alive = false;
  const p2 = encodeOne(sim, 'A', 2);
  const r2 = reconstructFromDelta(p2);
  assert.equal(r2.gunmen.length, 2);
  const g1 = r2.gunmen.find(g => g.n === 1);
  assert.equal(g1.x, 50);
  assert.equal(r2.gunmen.find(g => g.n === 3), undefined);
  // Tick 3 — add a fresh enemy.
  sim.gunmen.gunmen.push(ent(99, 9, 9));
  const p3 = encodeOne(sim, 'A', 3);
  const r3 = reconstructFromDelta(p3);
  assert.equal(r3.gunmen.length, 3);
  assert.ok(r3.gunmen.some(g => g.n === 99));
});

test('joiner returns null when delta references unknown baseline', () => {
  clearAllBaselines();
  clearJoinerBaseline();
  resetDeltaStats();
  const sim = mkSim();
  // Host sends full at seq=1, joiner reconstructs.
  const p1 = encodeOne(sim, 'A', 1);
  reconstructFromDelta(p1);
  // Host sends delta at seq=2 against base=1 — fine.
  const p2 = encodeOne(sim, 'A', 2);
  assert.notEqual(reconstructFromDelta(p2), null);
  // Now simulate joiner missed a packet: host sends seq=4 with base=3,
  // but joiner's baseline is at seq=2. Reconstruct must return null.
  sim.gunmen.gunmen[0].hp = 50;
  encodeOne(sim, 'A', 3);   // host moves baseline forward, joiner missed
  sim.gunmen.gunmen[0].hp = 25;
  const p4 = encodeOne(sim, 'A', 4);
  assert.equal(p4.base, 3);
  assert.equal(reconstructFromDelta(p4), null);
});

test('peer baselines are independent', () => {
  clearAllBaselines();
  clearJoinerBaseline();
  resetDeltaStats();
  const sim = mkSim();
  const a1 = encodeOne(sim, 'A', 1);
  const b1 = encodeOne(sim, 'B', 1);
  // Both peers get FULL on their first packet.
  assert.equal(a1._d, undefined);
  assert.equal(b1._d, undefined);
  // Mutate, then encode for A only; B's baseline should still be at seq=1.
  sim.gunmen.gunmen[0].hp = 1;
  const a2 = encodeOne(sim, 'A', 2);
  assert.equal(a2._d, 1);
  assert.equal(a2.base, 1);
  // Encode for B at seq=3 — delta against B's seq=1 baseline.
  const b2 = encodeOne(sim, 'B', 3);
  assert.equal(b2._d, 1);
  assert.equal(b2.base, 1);
});
