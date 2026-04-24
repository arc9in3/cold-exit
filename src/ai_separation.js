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
export function separateEnemies(groups, resolveCollision, unstick) {
  const entries = [];
  for (const { list, radius } of groups) {
    for (const e of list) {
      if (!e.alive) continue;
      entries.push({ pos: e.group.position, r: radius });
    }
  }
  const n = entries.length;
  if (n < 1) return;

  if (unstick) {
    for (const e of entries) {
      const u = unstick(e.pos.x, e.pos.z, e.r);
      if (u.x !== e.pos.x || u.z !== e.pos.z) {
        e.pos.x = u.x; e.pos.z = u.z;
      }
    }
  }
  if (n < 2) return;

  for (let i = 0; i < n; i++) {
    const a = entries[i];
    for (let j = i + 1; j < n; j++) {
      const b = entries[j];
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
