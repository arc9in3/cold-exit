// level_audit.js — dev-only generation auditor.
//
// Objective regression gate for the room-generation overhaul. Given a
// generated Level, it measures the invariants the overhaul is meant to
// guarantee and returns a plain-data report (no rendering, no scene
// mutation), so it runs headless via window.__auditLevel(n) and in CI
// later. Every metric here maps to a rule in the room-gen rule set:
//
//   R1 sealing   -> voidLeaks         (void-facing edge with no wall)
//   R2 path      -> pathBlocks        (movable clutter on a door->door lane)
//   R3 placement -> propsInWalls,     (prop footprint clipping a wall)
//                   propsOutsideWalk  (prop dropped in a shape's void cut-out)
//   R4 door net  -> doorBandProps     (a VISIBLE prop/crate in a door corridor)
//
// "Wall" = any solid obstacle that isn't a movable prop/container or a
// walk-through (railing/ramp/platform/fall-guard). "Prop" = anything
// tagged isProp (theme props AND container collision proxies both are).
//
// IMPORTANT: this never disposes geometry or edits obstacles — it only
// reads. Safe to call between runs.

import { WALL_THICK, DOOR_WIDTH } from './level_geom.js';

const STEP = 0.5;          // edge sample pitch (m)
const SEG_MIN = 1.0;       // ignore leaks shorter than this (corner slop)
const PROBE_OUT = WALL_THICK + 0.6;  // how far outside an edge to test for a neighbour room
const COVER_TOL = 0.35;    // wall-coverage tolerance around a sample
const PATH_W = 3.0;        // door->door keep-clear lane width (m)
const BAND_DEPTH = 3.5;    // door corridor reach into the room (matches _clearDoorCorridors)

// Anything with collision that isn't a movable prop SEALS the player in
// (railings, fall-guards, parapets, platforms all block movement). This
// is the R1 collision-sealing test — what stops the player escaping to
// the void — and it matches what _sealRoomPerimeters treats as coverage.
const sealsMovement = (o) => {
  const u = o.userData;
  if (!u || !u.collisionXZ) return false;
  if (u.isProp) return false;
  return true;
};
// A FULL-HEIGHT wall is what reads as visual encapsulation (vs a low
// parapet / invisible fall-guard you can see the void over). ~WALL_HEIGHT
// tall AND visible. Used only for the softer visualOpenEdges metric.
const isFullWall = (o) => {
  if (!sealsMovement(o) || !o.visible) return false;
  if (o.userData.isRailing || o.userData.isFallGuard) return false;
  const g = o.geometry && o.geometry.parameters;
  const h = (g && g.height) || (o.userData.platformHeight) || 0;
  return h >= 2.4;   // tall enough to occlude the void at the iso camera
};
const isPropObstacle = (o) => !!(o.userData && o.userData.isProp && o.userData.collisionXZ);
const isDoorObstacle = (o) => !!(o.userData && o.userData.isDoor);

const aabbOverlap = (a, b, shrink = 0) => (
  a.minX < b.maxX - shrink && a.maxX > b.minX + shrink
  && a.minZ < b.maxZ - shrink && a.maxZ > b.minZ + shrink
);

// Audit ONE already-generated level. Returns a structured report.
export function auditLevel(level) {
  const rooms = level.rooms.filter(r => r.id >= 0 && r.bounds);
  const walls = level.obstacles.filter(sealsMovement);     // collision sealing (incl. parapets/guards)
  const fullWalls = level.obstacles.filter(isFullWall);    // visual encapsulation only
  const doors = level.obstacles.filter(isDoorObstacle);
  const props = level.obstacles.filter(isPropObstacle);

  const coveredBy = (list, x, z) => {
    for (const w of list) {
      const b = w.userData.collisionXZ;
      if (x >= b.minX - COVER_TOL && x <= b.maxX + COVER_TOL
        && z >= b.minZ - COVER_TOL && z <= b.maxZ + COVER_TOL) return true;
    }
    return false;
  };
  const coveredByWall = (x, z) => coveredBy(walls, x, z);
  const coveredByFullWall = (x, z) => coveredBy(fullWalls, x, z);
  const coveredByDoor = (x, z) => {
    for (const d of doors) {
      const cx = d.userData.cx, cz = d.userData.cz;
      if (cx == null) continue;
      if (Math.abs(x - cx) <= DOOR_WIDTH / 2 + 0.6 && Math.abs(z - cz) <= DOOR_WIDTH / 2 + 0.6) return true;
    }
    return false;
  };
  const inAnotherRoom = (x, z, self) => {
    for (const r of rooms) {
      if (r === self) continue;
      const b = r.bounds;
      if (x >= b.minX - 0.2 && x <= b.maxX + 0.2 && z >= b.minZ - 0.2 && z <= b.maxZ + 0.2) return true;
    }
    return false;
  };

  const report = {
    rooms: rooms.length,
    voidLeaks: [],        // collision leaks: void-facing edge w/ NO movement-blocking obstacle (hard bug)
    visualOpenEdges: [],  // void-facing edge sealed only by low/invisible geo (no full wall) — softer
    pathBlocks: [],       // { roomId, kind }
    propsInWalls: [],     // { roomId, kind }
    propsOutsideWalk: [], // { roomId, kind }
    doorBandProps: 0,     // VISIBLE prop/crate in a door corridor
    shapeCounts: {},
    layoutCounts: {},
  };

  for (const room of rooms) {
    if (room.shape) report.shapeCounts[room.shape] = (report.shapeCounts[room.shape] || 0) + 1;
    if (room.layout) report.layoutCounts[room.layout] = (report.layoutCounts[room.layout] || 0) + 1;
    const b = room.bounds;
    const edges = [
      { ax: 'z', fv: b.minZ, from: b.minX, to: b.maxX, out: [0, -1], name: 'N' },
      { ax: 'z', fv: b.maxZ, from: b.minX, to: b.maxX, out: [0, 1], name: 'S' },
      { ax: 'x', fv: b.minX, from: b.minZ, to: b.maxZ, out: [-1, 0], name: 'W' },
      { ax: 'x', fv: b.maxX, from: b.minZ, to: b.maxZ, out: [1, 0], name: 'E' },
    ];
    for (const e of edges) {
      let run = 0;       // collision-open run (no movement-blocking obstacle)
      let vrun = 0;      // visual-open run (no full-height wall)
      const flush = () => {
        if (run > SEG_MIN) {
          report.voidLeaks.push({ roomId: room.id, type: room.type, shape: room.shape || 'rect',
            layout: room.layout, edge: e.name, len: +run.toFixed(1) });
        }
        run = 0;
      };
      const vflush = () => {
        if (vrun > SEG_MIN) {
          report.visualOpenEdges.push({ roomId: room.id, type: room.type, shape: room.shape || 'rect',
            layout: room.layout, edge: e.name, len: +vrun.toFixed(1) });
        }
        vrun = 0;
      };
      for (let t = e.from; t <= e.to + 1e-6; t += STEP) {
        const x = e.ax === 'x' ? e.fv : t;
        const z = e.ax === 'z' ? e.fv : t;
        const px = x + e.out[0] * PROBE_OUT;
        const pz = z + e.out[1] * PROBE_OUT;
        if (inAnotherRoom(px, pz, room)) { flush(); vflush(); continue; }   // shared edge — not void
        if (coveredByDoor(x, z)) { flush(); vflush(); continue; }           // doorway gap
        if (!coveredByWall(x, z)) run += STEP; else flush();
        if (!coveredByFullWall(x, z)) vrun += STEP; else vflush();
      }
      flush();
      vflush();
    }
  }

  // props clipping walls
  for (const p of props) {
    const pb = p.userData.collisionXZ;
    for (const w of walls) {
      if (aabbOverlap(pb, w.userData.collisionXZ, 0.05)) {
        report.propsInWalls.push({ kind: p.userData.kind || 'prop' });
        break;
      }
    }
  }

  // props dropped outside their room's walkable polygon (shape cut-out / void)
  const roomAt = (x, z) => rooms.find(r => x >= r.bounds.minX && x <= r.bounds.maxX
    && z >= r.bounds.minZ && z <= r.bounds.maxZ);
  for (const p of props) {
    const cx = (p.userData.collisionXZ.minX + p.userData.collisionXZ.maxX) / 2;
    const cz = (p.userData.collisionXZ.minZ + p.userData.collisionXZ.maxZ) / 2;
    const room = roomAt(cx, cz);
    const wb = room && room._walkableBounds;
    if (!wb || !wb.length) continue;
    let inside = false;
    for (const w of wb) {
      if (cx >= w.minX - 0.4 && cx <= w.maxX + 0.4 && cz >= w.minZ - 0.4 && cz <= w.maxZ + 0.4) { inside = true; break; }
    }
    if (!inside) report.propsOutsideWalk.push({ roomId: room.id, kind: p.userData.kind || 'prop' });
  }

  // door-band: a VISIBLE prop/crate sitting in a door corridor
  const visibleClutter = [];
  for (const c of (level.containers || [])) {
    if (c.group && c.group.visible) visibleClutter.push({ x: c.x, z: c.z });
  }
  for (const p of props) {
    const g = p.userData.propGroup;
    if (g && g.visible) {
      const cx = (p.userData.collisionXZ.minX + p.userData.collisionXZ.maxX) / 2;
      const cz = (p.userData.collisionXZ.minZ + p.userData.collisionXZ.maxZ) / 2;
      visibleClutter.push({ x: cx, z: cz });
    }
  }
  for (const d of doors) {
    const cx = d.userData.cx, cz = d.userData.cz;
    if (cx == null) continue;
    const g = d.geometry && d.geometry.parameters;
    const horiz = (g && g.width || 0) > (g && g.depth || 0);
    const half = DOOR_WIDTH / 2 + 1.0;
    const band = horiz
      ? { minX: cx - half, maxX: cx + half, minZ: cz - BAND_DEPTH, maxZ: cz + BAND_DEPTH }
      : { minX: cx - BAND_DEPTH, maxX: cx + BAND_DEPTH, minZ: cz - half, maxZ: cz + half };
    for (const c of visibleClutter) {
      if (c.x >= band.minX && c.x <= band.maxX && c.z >= band.minZ && c.z <= band.maxZ) report.doorBandProps++;
    }
  }

  // path blocks: movable clutter sitting on a door->door straight lane
  const doorsByRoom = new Map();
  for (const d of doors) {
    const cx = d.userData.cx, cz = d.userData.cz;
    if (cx == null) continue;
    const r = roomAt(cx, cz) || rooms.find(rr => Math.abs(((rr.bounds.minX + rr.bounds.maxX) / 2) - cx) < 14
      && Math.abs(((rr.bounds.minZ + rr.bounds.maxZ) / 2) - cz) < 14);
    if (!r) continue;
    if (!doorsByRoom.has(r.id)) doorsByRoom.set(r.id, []);
    doorsByRoom.get(r.id).push({ x: cx, z: cz });
  }
  const clutterFootprints = props.map(p => p.userData.collisionXZ)
    .concat((level.containers || []).filter(c => c.group && c.group.visible)
      .map(c => ({ minX: c.x - 0.6, maxX: c.x + 0.6, minZ: c.z - 0.6, maxZ: c.z + 0.6 })));
  for (const [roomId, ds] of doorsByRoom) {
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        const a = ds[i], bb = ds[j];
        // sample the lane center; flag any clutter whose footprint covers a sample
        const steps = Math.max(2, Math.ceil(Math.hypot(bb.x - a.x, bb.z - a.z) / 1.0));
        for (let s = 1; s < steps; s++) {
          const lx = a.x + (bb.x - a.x) * (s / steps);
          const lz = a.z + (bb.z - a.z) * (s / steps);
          for (const f of clutterFootprints) {
            if (lx >= f.minX - PATH_W / 2 && lx <= f.maxX + PATH_W / 2
              && lz >= f.minZ - PATH_W / 2 && lz <= f.maxZ + PATH_W / 2) {
              report.pathBlocks.push({ roomId, kind: 'clutter-on-lane' });
              s = steps; break;
            }
          }
        }
      }
    }
  }

  report.summary = {
    rooms: report.rooms,
    voidLeaks: report.voidLeaks.length,
    worstLeak: report.voidLeaks.reduce((m, l) => Math.max(m, l.len), 0),
    visualOpenEdges: report.visualOpenEdges.length,
    pathBlocks: report.pathBlocks.length,
    propsInWalls: report.propsInWalls.length,
    propsOutsideWalk: report.propsOutsideWalk.length,
    doorBandProps: report.doorBandProps,
  };
  return report;
}

// Regenerate the level `n` times and aggregate the summaries. Returns
// totals + a few worst-offender examples so a single console call gives
// a verdict. Leaves a freshly generated level in place when done.
export function auditSeeds(level, n = 20) {
  const totals = { seeds: 0, genErrors: 0, rooms: 0, voidLeaks: 0, worstLeak: 0,
    visualOpenEdges: 0, pathBlocks: 0, propsInWalls: 0, propsOutsideWalk: 0, doorBandProps: 0,
    shapeCounts: {}, layoutCounts: {}, leakExamples: [], visualExamples: [] };
  for (let i = 0; i < n; i++) {
    try { level.generate(); } catch (e) { totals.genErrors++; continue; }
    totals.seeds++;
    const r = auditLevel(level);
    totals.rooms += r.summary.rooms;
    totals.voidLeaks += r.summary.voidLeaks;
    totals.worstLeak = Math.max(totals.worstLeak, r.summary.worstLeak);
    totals.visualOpenEdges += r.summary.visualOpenEdges;
    totals.pathBlocks += r.summary.pathBlocks;
    totals.propsInWalls += r.summary.propsInWalls;
    totals.propsOutsideWalk += r.summary.propsOutsideWalk;
    totals.doorBandProps += r.summary.doorBandProps;
    for (const k in r.shapeCounts) totals.shapeCounts[k] = (totals.shapeCounts[k] || 0) + r.shapeCounts[k];
    for (const k in r.layoutCounts) totals.layoutCounts[k] = (totals.layoutCounts[k] || 0) + r.layoutCounts[k];
    for (const l of r.voidLeaks) if (totals.leakExamples.length < 12) totals.leakExamples.push(l);
    for (const v of r.visualOpenEdges) if (totals.visualExamples.length < 12) totals.visualExamples.push(v);
  }
  return totals;
}
