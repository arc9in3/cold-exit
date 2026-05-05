// AI spatial hash + flow field. Built once per frame from the live
// level + entity lists and reused by gunman / melee / drone / cover
// modules so we can stop doing O(N²) walks across every gunman ×
// every wall × every other gunman per tick.
//
// The grid uses 5m cells (`AI_GRID`). With typical 20 entries on a
// late-game floor, query(x, z, r=4m) touches at most a 3×3 cell
// neighbourhood. Steady-state cost should be ~0.1ms.
//
// Exposes a single shared singleton `aiSpatial`. The gunman manager
// calls rebuild() from its update() and every other consumer reads
// the cached state for the rest of the frame. Network state is
// untouched — this module is render-time only.
//
// Fail-soft policy: if the level doesn't expose `_collidesAt`, every
// LoS query returns true (open world). If the flow field can't reach
// the target cell, sample() returns null and callers fall back to
// straight-line approach. The new system never gets to break the
// game just because a corner case is unmapped.

export const AI_GRID = 5;        // metres per cell
const FLOW_REPLAN_CELLS = 2;     // recompute when target moves > N cells
const LOS_STEP = 0.5;            // metres per LoS raycast sample

// Walkable-cell footprint used for the flow field. Cell size is
// deliberately smaller than AI_GRID — the spatial hash is for
// neighbour lookups and wants coarse buckets, the flow field is for
// pathing and wants something close to body-radius. 1m matches the
// hallway clearance and is what the existing pathway invariant uses
// for its BFS step.
const FLOW_CELL = 1.0;

class AISpatial {
  constructor() {
    this._cells = new Map();           // 'ix,iz' → entries[]
    this._level = null;
    this._frame = 0;
    // Flow-field cache. One slot — if a second target appears we
    // simply rebuild. Keyed by the rounded target cell so player
    // micro-movement doesn't thrash the cache.
    this._flow = null;                 // { tx, tz, dx, dz, dirs, cells }
  }

  rebuild(level, ents = {}) {
    this._frame++;
    this._level = level || null;
    this._cells.clear();
    const push = (kind, e, pos, radius) => {
      if (!pos) return;
      const ix = Math.floor(pos.x / AI_GRID);
      const iz = Math.floor(pos.z / AI_GRID);
      const k = ix + ',' + iz;
      let arr = this._cells.get(k);
      if (!arr) { arr = []; this._cells.set(k, arr); }
      arr.push({ kind, ent: e, x: pos.x, z: pos.z, r: radius });
    };
    const list = (xs) => xs && xs.length ? xs : [];
    for (const g of list(ents.gunmen)) {
      if (!g || !g.alive) continue;
      push('gunman', g, g.group?.position, 0.5);
    }
    for (const m of list(ents.melees)) {
      if (!m || !m.alive) continue;
      push('melee', m, m.group?.position, 0.5);
    }
    for (const d of list(ents.drones)) {
      if (!d || d.dead) continue;
      push('drone', d, d.group?.position || d.position, 0.4);
    }
    if (ents.player) push('player', ents.player, ents.player, 0.4);
  }

  // Entries within `r` metres of (x, z). Coarse — touches a (radius/AI_GRID + 1)
  // ring of cells; caller must do the precise distance check. Returns a fresh
  // array (small), never the cached cell arrays.
  query(x, z, r) {
    const out = [];
    if (!this._cells.size) return out;
    const r2 = r * r;
    const minIx = Math.floor((x - r) / AI_GRID);
    const maxIx = Math.floor((x + r) / AI_GRID);
    const minIz = Math.floor((z - r) / AI_GRID);
    const maxIz = Math.floor((z + r) / AI_GRID);
    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iz = minIz; iz <= maxIz; iz++) {
        const arr = this._cells.get(ix + ',' + iz);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const e = arr[i];
          const dx = e.x - x, dz = e.z - z;
          if (dx * dx + dz * dz <= r2) out.push(e);
        }
      }
    }
    return out;
  }

  // Cheap LoS — step-sampled `level._collidesAt`. Used as a drop-in
  // replacement for the BVH raycast where we don't need precise hit
  // points (we just need "yes / no, is there a wall in the way").
  // Falls open if the level isn't ready or doesn't expose
  // `_collidesAt` (e.g. tutorial / smoke harness).
  losClear(ax, az, bx, bz) {
    const lvl = this._level;
    if (!lvl || typeof lvl._collidesAt !== 'function') return true;
    const dx = bx - ax, dz = bz - az;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return true;
    const steps = Math.max(2, Math.ceil(dist / LOS_STEP));
    const ux = dx / steps, uz = dz / steps;
    // Skip the very first sample (origin sits at the shooter; a
    // 0-radius probe still picks up tiny props at the muzzle origin
    // on rare occasions). Same idea as combat.hasLineOfSight's 0.15m
    // self-hit filter.
    for (let i = 1; i < steps; i++) {
      const x = ax + ux * i;
      const z = az + uz * i;
      if (lvl._collidesAt(x, z, 0.05)) return false;
    }
    return true;
  }

  // Build / fetch a flow field that points toward (tx, tz). The flow
  // field is cached and reused as long as the target hasn't moved
  // more than FLOW_REPLAN_CELLS cells. Returns an object with
  // `sample(x, z)` → {dx, dz} (unit) or null when the cell isn't
  // reachable.
  flowFieldTo(tx, tz) {
    const lvl = this._level;
    if (!lvl) return _emptyFlow;
    // Quantise the target to the flow-cell centre.
    const tcx = Math.round(tx / FLOW_CELL);
    const tcz = Math.round(tz / FLOW_CELL);
    const cur = this._flow;
    const reuse = cur
      && Math.abs(cur.tcx - tcx) <= FLOW_REPLAN_CELLS
      && Math.abs(cur.tcz - tcz) <= FLOW_REPLAN_CELLS
      && cur.lvlGen === (lvl._aiSpatialGen | 0);
    if (reuse) return cur;
    const built = this._buildFlow(tcx, tcz);
    this._flow = built;
    return built;
  }

  _buildFlow(tcx, tcz) {
    const lvl = this._level;
    // Walkable cells from union of room walkableBounds + connectors.
    // We re-derive the same set checkPathwayInvariants uses; a
    // dedicated rebuild here would diverge over time, so mirror the
    // rules. Unlike the invariant we DON'T fail if a cell isn't in
    // the set; we just refuse to BFS through it.
    const walkable = new Set();
    const cellKey = (ix, iz) => ix + ',' + iz;
    const STEP = FLOW_CELL;
    const rooms = (lvl.rooms || []);
    let minIx = Infinity, maxIx = -Infinity, minIz = Infinity, maxIz = -Infinity;
    for (const room of rooms) {
      const wb = room && room._walkableBounds;
      if (!wb || !wb.length) continue;
      for (const b of wb) {
        const i0 = Math.ceil(b.minX / STEP);
        const i1 = Math.floor(b.maxX / STEP);
        const j0 = Math.ceil(b.minZ / STEP);
        const j1 = Math.floor(b.maxZ / STEP);
        if (i0 < minIx) minIx = i0;
        if (i1 > maxIx) maxIx = i1;
        if (j0 < minIz) minIz = j0;
        if (j1 > maxIz) maxIz = j1;
        for (let ix = i0; ix <= i1; ix++) {
          for (let iz = j0; iz <= j1; iz++) {
            walkable.add(cellKey(ix, iz));
          }
        }
      }
    }
    // Doorway pad — same trick as checkPathwayInvariants. Without
    // this, two rooms touch at a wall plane but no cell straddles
    // the door so BFS can't cross.
    if (lvl._doorPadCells) {
      // Reuse the precomputed pad if level cached one; otherwise we
      // synthesise minimally below using neighbours.
      for (const k of lvl._doorPadCells) walkable.add(k);
    } else if (rooms.length && lvl.constructor) {
      // Approximate door pads from neighbour list. Width = 2.5m
      // (DOOR_WIDTH ~3m + step), depth = 1m. We don't pull DOOR_WIDTH
      // from level.js because it's module-private — 1.5 either side
      // of the door centre is wide enough to bridge.
      const halfDoorPad = 1.5;
      const wallSpan = 1.0;
      const seen = new Set();
      for (const room of rooms) {
        if (!room || !room.neighbors) continue;
        const b = room.bounds;
        for (const n of room.neighbors) {
          const other = rooms[n.otherId];
          if (!other) continue;
          const k = (room.id < n.otherId)
            ? room.id + '-' + n.otherId
            : n.otherId + '-' + room.id;
          if (seen.has(k)) continue;
          seen.add(k);
          let cxw, czw, dW, dD;
          if (n.dir === 'north' || n.dir === 'south') {
            cxw = other.cx;
            czw = (n.dir === 'north') ? b.minZ : b.maxZ;
            dW = halfDoorPad; dD = wallSpan;
          } else {
            cxw = (n.dir === 'east') ? b.maxX : b.minX;
            czw = other.cz;
            dW = wallSpan; dD = halfDoorPad;
          }
          const i0 = Math.ceil((cxw - dW) / STEP);
          const i1 = Math.floor((cxw + dW) / STEP);
          const j0 = Math.ceil((czw - dD) / STEP);
          const j1 = Math.floor((czw + dD) / STEP);
          for (let ix = i0; ix <= i1; ix++) {
            for (let iz = j0; iz <= j1; iz++) {
              walkable.add(cellKey(ix, iz));
            }
          }
        }
      }
    }
    if (!walkable.size) return _emptyFlow;
    // Fall back: if the target cell isn't walkable, snap to the
    // closest walkable cell within 4 steps. Player on a ledge / in
    // a connector seam is the usual cause.
    let sx = tcx, sz = tcz;
    if (!walkable.has(cellKey(sx, sz))) {
      let bestD2 = Infinity;
      for (let r = 1; r <= 4 && bestD2 === Infinity; r++) {
        for (let ix = -r; ix <= r; ix++) {
          for (let iz = -r; iz <= r; iz++) {
            if (Math.abs(ix) !== r && Math.abs(iz) !== r) continue;
            const nx = tcx + ix, nz = tcz + iz;
            if (!walkable.has(cellKey(nx, nz))) continue;
            const d2 = ix * ix + iz * iz;
            if (d2 < bestD2) { bestD2 = d2; sx = nx; sz = nz; }
          }
        }
      }
      if (bestD2 === Infinity) return _emptyFlow;
    }
    // BFS — distance in cells from target. Direction at any cell
    // points to the neighbour with the smaller distance, normalised.
    const dist = new Map();
    dist.set(cellKey(sx, sz), 0);
    const q = [[sx, sz]];
    const dirs4 = [[1,0], [-1,0], [0,1], [0,-1]];
    let head = 0;
    while (head < q.length) {
      const [cx, cz] = q[head++];
      const cd = dist.get(cellKey(cx, cz));
      for (let k = 0; k < 4; k++) {
        const nx = cx + dirs4[k][0], nz = cz + dirs4[k][1];
        const nk = cellKey(nx, nz);
        if (!walkable.has(nk) || dist.has(nk)) continue;
        dist.set(nk, cd + 1);
        q.push([nx, nz]);
      }
    }
    // Direction map — compute lazily in sample() so we don't pay for
    // cells we never query. Cache the per-cell direction once
    // computed.
    const dirCache = new Map();
    const flow = {
      tcx, tcz,
      lvlGen: (lvl._aiSpatialGen | 0),
      sample(x, z) {
        const ix = Math.round(x / STEP);
        const iz = Math.round(z / STEP);
        const key = ix + ',' + iz;
        const cached = dirCache.get(key);
        if (cached !== undefined) return cached;
        const myD = dist.get(key);
        if (myD === undefined) {
          // Off the field — hand back null so caller falls back.
          dirCache.set(key, null);
          return null;
        }
        // Pick the lowest-distance walkable neighbour. Ties = pick
        // the one that better aligns with straight-line-to-target;
        // gives smoother paths than arbitrary tiebreaks.
        let best = null, bestD = myD;
        for (let k = 0; k < 4; k++) {
          const nx = ix + dirs4[k][0], nz_ = iz + dirs4[k][1];
          const nd = dist.get(nx + ',' + nz_);
          if (nd === undefined) continue;
          if (nd < bestD) {
            bestD = nd;
            best = { dx: dirs4[k][0], dz: dirs4[k][1] };
          }
        }
        if (!best) {
          // We're on the target cell — point toward target sub-cell offset.
          const tdx = (sx * STEP) - x;
          const tdz = (sz * STEP) - z;
          const tl = Math.hypot(tdx, tdz);
          best = tl > 0.001 ? { dx: tdx / tl, dz: tdz / tl } : { dx: 0, dz: 0 };
        }
        // Normalize (for diagonals / rare blends).
        const len = Math.hypot(best.dx, best.dz) || 1;
        const out = { dx: best.dx / len, dz: best.dz / len };
        dirCache.set(key, out);
        return out;
      },
      // Probe whether a position is on the field at all. Used by the
      // pathway invariant extension.
      reachable(x, z) {
        const ix = Math.round(x / STEP);
        const iz = Math.round(z / STEP);
        return dist.has(ix + ',' + iz);
      },
      // Diagnostics: number of reachable cells. The probe + the
      // smoke harness want this to assert the field actually covers
      // the level.
      get cellCount() { return dist.size; },
    };
    return flow;
  }

  // Test helper — clear the cached field. Useful when smoke /
  // playwright tests rebuild the level mid-run.
  invalidateFlow() { this._flow = null; }
}

// Empty fallback flow — sample() always returns null, reachable()
// always false. Lets callers always invoke .sample() without
// pre-checking for null fields.
const _emptyFlow = {
  tcx: 0, tcz: 0, lvlGen: -1,
  sample() { return null; },
  reachable() { return false; },
  get cellCount() { return 0; },
};

export const aiSpatial = new AISpatial();

if (typeof window !== 'undefined') {
  window.__aiSpatial = aiSpatial;
}
