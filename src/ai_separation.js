// Enemy-vs-enemy soft separation. Both GunmanManager and MeleeEnemyManager
// resolve collision against the world, but neither checks against each
// other, so rushing enemies visually stack into one blob. Each frame after
// their updates, this pass walks every alive pair and pushes overlapping
// ones apart by a fraction of the overlap. A single 1.0 factor resolves
// the overlap in one step; lower values let motion settle over a few
// frames if 1.0 ever looks jittery.

// Soft push so stacked enemies resolve over ~2 frames instead of one —
// keeps movement smooth at choke points (doors, corridors) where a hard
// 1.0 snap would fight against each enemy's own pathfinding.
const PUSH_FACTOR = 0.5;

// Cell size for the local separation grid. Chosen so a 0.5m-radius
// enemy + a 0.5m-radius enemy (max overlap radius ~1m) only ever
// needs to look at the same cell + 8 neighbours. 1.5m is generous
// against the largest melee/gunman pair (each ~0.5m radius) and
// keeps the per-frame allocation low.
const SEP_CELL = 1.5;
// Reused per-frame grid buckets. `Map<key, indexArrayPool>` — we
// reset the map's contents each call rather than allocating fresh
// arrays. The arrays themselves come from a tiny pool so steady-
// state alloc cost is zero.
const _sepGrid = new Map();
const _sepArrayPool = [];
function _getArr() {
  return _sepArrayPool.pop() || [];
}
function _resetGrid() {
  for (const arr of _sepGrid.values()) {
    arr.length = 0;
    _sepArrayPool.push(arr);
  }
  _sepGrid.clear();
}

// `groups` is an array of { list, radius } — `list` is an iterable of
// enemy records (each having `.alive` + `.group.position.{x,z}`), and
// `radius` is the collision radius for that group. We combine all alive
// entries into a single flat array of { pos, r } references so we don't
// care which manager an entity came from.
//
// `unstick(x, z, r)` is called for every entry before pair-wise
// separation to recover enemies that wound up inside an obstacle (door,
// wall) — the axis-separated movement resolver can't push out an
// already-overlapping point on its own, so this is the only way stuck
// enemies get freed.
// Reused per-frame entry buffer. Each slot is `{ pos, r }`; we grow
// the pool lazily and reset entry references in-place each call so
// the function allocates 0 objects in steady-state.
const _entriesPool = [];
let _entriesCount = 0;
function _entryAt(i) {
  while (_entriesPool.length <= i) _entriesPool.push({ pos: null, r: 0 });
  return _entriesPool[i];
}

export function separateEnemies(groups, resolveCollision, unstick) {
  _entriesCount = 0;
  for (const { list, radius } of groups) {
    for (const e of list) {
      if (!e.alive) continue;
      const slot = _entryAt(_entriesCount++);
      slot.pos = e.group.position;
      slot.r = radius;
    }
  }
  const n = _entriesCount;
  if (n < 1) return;

  if (unstick) {
    for (let k = 0; k < n; k++) {
      const e = _entriesPool[k];
      const u = unstick(e.pos.x, e.pos.z, e.r);
      if (u.x !== e.pos.x || u.z !== e.pos.z) {
        e.pos.x = u.x; e.pos.z = u.z;
      }
    }
  }
  if (n < 2) return;

  // Bucket every entry into the local grid so the inner loop only
  // walks the 9-cell neighbourhood instead of the full pair list.
  // For a 30-entry frame on a normal floor that's ~3-5 candidates
  // per entry vs 30 on the original O(N²) loop. Exact same overlap
  // resolution maths — we just narrow the candidate set.
  _resetGrid();
  for (let i = 0; i < n; i++) {
    const e = _entriesPool[i];
    const ix = Math.floor(e.pos.x / SEP_CELL);
    const iz = Math.floor(e.pos.z / SEP_CELL);
    const key = ix + ',' + iz;
    let arr = _sepGrid.get(key);
    if (!arr) { arr = _getArr(); _sepGrid.set(key, arr); }
    arr.push(i);
  }

  for (let i = 0; i < n; i++) {
    const a = _entriesPool[i];
    const ix = Math.floor(a.pos.x / SEP_CELL);
    const iz = Math.floor(a.pos.z / SEP_CELL);
    for (let dxC = -1; dxC <= 1; dxC++) {
      for (let dzC = -1; dzC <= 1; dzC++) {
        const arr = _sepGrid.get((ix + dxC) + ',' + (iz + dzC));
        if (!arr) continue;
        for (let kk = 0; kk < arr.length; kk++) {
          const j = arr[kk];
          // Each pair handled once — keep i < j.
          if (j <= i) continue;
          const b = _entriesPool[j];
          const dx = b.pos.x - a.pos.x;
          const dz = b.pos.z - a.pos.z;
          const minDist = a.r + b.r;
          const distSq = dx * dx + dz * dz;
          if (distSq >= minDist * minDist) continue;
          if (distSq < 1e-6) {
            // Exactly coincident — nudge deterministically on X so we don't
            // divide by zero and so two enemies spawned on top of each other
            // don't lock in place.
            const half = minDist * 0.5;
            a.pos.x -= half;
            b.pos.x += half;
            continue;
          }
          const dist = Math.sqrt(distSq);
          const overlap = (minDist - dist) * PUSH_FACTOR;
          const nx = dx / dist;
          const nz = dz / dist;
          const half = overlap * 0.5;

          const ax = a.pos.x - nx * half;
          const az = a.pos.z - nz * half;
          const bx = b.pos.x + nx * half;
          const bz = b.pos.z + nz * half;

          // Honour walls — if the push would shove an enemy into geometry,
          // the world collision clamps it back to the edge.
          if (resolveCollision) {
            const ra = resolveCollision(a.pos.x, a.pos.z, ax, az, a.r);
            a.pos.x = ra.x; a.pos.z = ra.z;
            const rb = resolveCollision(b.pos.x, b.pos.z, bx, bz, b.r);
            b.pos.x = rb.x; b.pos.z = rb.z;
          } else {
            a.pos.x = ax; a.pos.z = az;
            b.pos.x = bx; b.pos.z = bz;
          }
        }
      }
    }
  }
}
