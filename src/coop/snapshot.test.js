// Round-trip smoke for the delta encoder. Run with:
//   node --test src/coop/snapshot.test.js
//
// REGRESSION: coop-snapshot-delta — verifies that the host's diff
// + the joiner's reconstruct produce a snapshot byte-equivalent to
// the source. Without this round-trip property, deltas can silently
// drop changes (false-positive _recordEq returns) and cause invisible
// joiner desync. Also covers v2-wire quantization (cm-precision pos
// + millirad yaw) and the byte-count instrumentation.

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

// Reset baselines + stats between each test so failures don't cascade.
function resetAll() {
  clearAllBaselines();
  clearJoinerBaseline();
  resetDeltaStats();
}

test('first encode for a peer is FULL with _q flag', () => {
  resetAll();
  const sim = mkSim();
  const pkt = encodeOne(sim, 'A', 1);
  assert.equal(pkt._d, undefined);
  assert.equal(pkt._q, 1);                  // v2 quantized wire format
  assert.equal(pkt.gunmen.length, 3);
  // Positions on the wire are cm-scale ints (×100).
  assert.equal(pkt.gunmen[0].x, 100);       // 1m → 100cm
  assert.equal(pkt.gunmen[0].z, 100);
  assert.equal(getDeltaStats().sentFull, 1);
  assert.equal(getDeltaStats().sentDelta, 0);
});

test('second encode is DELTA when nothing changed', () => {
  resetAll();
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

test('delta carries only changed entries (int-scale wire values)', () => {
  resetAll();
  const sim = mkSim();
  encodeOne(sim, 'A', 1);
  sim.gunmen.gunmen[1].group.position.x = 99;
  const pkt = encodeOne(sim, 'A', 2);
  assert.equal(pkt._d, 1);
  assert.equal(pkt.dgunmen.length, 1);
  assert.equal(pkt.dgunmen[0].n, 2);
  assert.equal(pkt.dgunmen[0].x, 9900);     // 99m × 100 = 9900cm
  // Removed entries appear in xgunmen as netIds.
  sim.gunmen.gunmen[2].alive = false;
  const pkt2 = encodeOne(sim, 'A', 3);
  assert.deepEqual(pkt2.xgunmen, [3]);
});

test('joiner reconstruct round-trip recovers host state (within quantization tolerance)', () => {
  resetAll();
  const sim = mkSim();
  const p1 = encodeOne(sim, 'A', 1);
  const r1 = reconstructFromDelta(p1);
  assert.equal(r1.gunmen.length, 3);
  // Dequantized positions match originals exactly (integer fixtures).
  const g1Initial = r1.gunmen.find(g => g.n === 1);
  assert.ok(Math.abs(g1Initial.x - 1) < 0.01);
  // Tick 2 — move one, despawn one.
  sim.gunmen.gunmen[0].group.position.x = 50.42;
  sim.gunmen.gunmen[2].alive = false;
  const p2 = encodeOne(sim, 'A', 2);
  const r2 = reconstructFromDelta(p2);
  assert.equal(r2.gunmen.length, 2);
  const g1 = r2.gunmen.find(g => g.n === 1);
  assert.ok(Math.abs(g1.x - 50.42) < 0.01,
    `expected ~50.42, got ${g1.x}`);
  assert.equal(r2.gunmen.find(g => g.n === 3), undefined);
  // Tick 3 — add a fresh enemy.
  sim.gunmen.gunmen.push(ent(99, 9, 9));
  const p3 = encodeOne(sim, 'A', 3);
  const r3 = reconstructFromDelta(p3);
  assert.equal(r3.gunmen.length, 3);
  assert.ok(r3.gunmen.some(g => g.n === 99));
});

test('yaw quantization (millirad) round-trips within 0.001 rad', () => {
  resetAll();
  const sim = mkSim();
  // Spin one gunman to a non-trivial yaw.
  sim.gunmen.gunmen[0].group.rotation.y = 1.234567;
  const p1 = encodeOne(sim, 'A', 1);
  const r1 = reconstructFromDelta(p1);
  const g0 = r1.gunmen.find(g => g.n === 1);
  assert.ok(Math.abs(g0.y - 1.234567) < 0.001,
    `expected ~1.234567, got ${g0.y}`);
});

test('unbounded yaw is wrapped into [-π, π] on the wire', () => {
  // REGRESSION: host rotation.y accumulates unbounded over a session
  // (turn deltas add up). Unwrapped values inflate the wire int and
  // make the joiner's interp wrap loop spin O(|yaw|/π) per frame.
  resetAll();
  const sim = mkSim();
  const TWO_PI = Math.PI * 2;
  // 8 full turns plus 1.0 rad — must hit the wire as ~1.0 rad.
  sim.gunmen.gunmen[0].group.rotation.y = TWO_PI * 8 + 1.0;
  // Negative accumulation: -4 turns minus 2.5 rad → wraps to -2.5
  // (already inside [-π, π] after the turns are stripped).
  sim.gunmen.gunmen[1].group.rotation.y = -TWO_PI * 4 - 2.5;
  const p1 = encodeOne(sim, 'A', 1);
  const r1 = reconstructFromDelta(p1);
  const g1 = r1.gunmen.find(g => g.n === 1);
  const g2 = r1.gunmen.find(g => g.n === 2);
  assert.ok(g1.y >= -Math.PI - 0.001 && g1.y <= Math.PI + 0.001,
    `wire yaw outside [-π, π]: ${g1.y}`);
  assert.ok(Math.abs(g1.y - 1.0) < 0.001, `expected ~1.0, got ${g1.y}`);
  assert.ok(g2.y >= -Math.PI - 0.001 && g2.y <= Math.PI + 0.001,
    `wire yaw outside [-π, π]: ${g2.y}`);
  assert.ok(Math.abs(g2.y - (-2.5)) < 0.001,
    `expected ~-2.5, got ${g2.y}`);
});

test('joiner returns null when delta references unknown baseline', () => {
  resetAll();
  const sim = mkSim();
  const p1 = encodeOne(sim, 'A', 1);
  reconstructFromDelta(p1);
  const p2 = encodeOne(sim, 'A', 2);
  assert.notEqual(reconstructFromDelta(p2), null);
  // Joiner missed seq=3, then receives seq=4 (base=3) → must reject.
  sim.gunmen.gunmen[0].hp = 50;
  encodeOne(sim, 'A', 3);
  sim.gunmen.gunmen[0].hp = 25;
  const p4 = encodeOne(sim, 'A', 4);
  assert.equal(p4.base, 3);
  assert.equal(reconstructFromDelta(p4), null);
});

test('peer baselines are independent', () => {
  resetAll();
  const sim = mkSim();
  const a1 = encodeOne(sim, 'A', 1);
  const b1 = encodeOne(sim, 'B', 1);
  assert.equal(a1._d, undefined);
  assert.equal(b1._d, undefined);
  sim.gunmen.gunmen[0].hp = 1;
  const a2 = encodeOne(sim, 'A', 2);
  assert.equal(a2._d, 1);
  assert.equal(a2.base, 1);
  const b2 = encodeOne(sim, 'B', 3);
  assert.equal(b2._d, 1);
  assert.equal(b2.base, 1);
});

test('byte counters track full + delta + savings', () => {
  resetAll();
  const sim = mkSim();
  // Tick 1: FULL. bytesSent == bytesFullEquivalent (savings = 0).
  encodeOne(sim, 'A', 1);
  const s1 = getDeltaStats();
  assert.equal(s1.sentFull, 1);
  assert.equal(s1.bytesSent, s1.bytesFullEquivalent);
  assert.equal(s1.bytesSaved, 0);
  // Tick 2: nothing changed → delta is tiny, fullEquivalent is large.
  encodeOne(sim, 'A', 2);
  const s2 = getDeltaStats();
  assert.equal(s2.sentDelta, 1);
  assert.ok(s2.bytesSent < s2.bytesFullEquivalent,
    `delta should be smaller than equivalent full (sent=${s2.bytesSent} eq=${s2.bytesFullEquivalent})`);
  assert.ok(s2.bytesSaved > 0);
  assert.ok(s2.savingsRatio > 0 && s2.savingsRatio < 1);
});

test('quantization is idempotent across multi-peer fanout', () => {
  // Same enemy records get shared across peers via encodeSnapshotsPerPeer.
  // If quantization didn't dedup by reference, the second peer's pass
  // would multiply positions by POS_SCALE again — sending rigs to orbit.
  resetAll();
  const sim = mkSim();
  const map = encodeSnapshotsPerPeerWithDelta(
    sim.gunmen, sim.melees, 1, 0, sim.loot, ['A', 'B', 'C'],
    sim.drones, sim.boss, sim.level,
  );
  const a = map.get('A');
  const b = map.get('B');
  const c = map.get('C');
  // Same shared enemy records => same int values across all three peers.
  assert.equal(a.gunmen[0].x, 100);
  assert.equal(b.gunmen[0].x, 100);
  assert.equal(c.gunmen[0].x, 100);
});
