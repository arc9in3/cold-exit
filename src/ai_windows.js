// Window-aware LoS test for AI fire decisions. Walks a 0.5m-step
// segment from (ax,az) to (bx,bz) against `level.obstacles`,
// classifying the first hit it encounters:
//
//   { clear: true,  throughBrokenWindow: false, blockedByIntactWindow: null,
//     fullBlock: false }
//      → no obstacle in the way; AI can fire freely
//
//   { clear: true,  throughBrokenWindow: true,  blockedByIntactWindow: null,
//     fullBlock: false }
//      → segment passes through ≥1 broken window with no other
//        blocker; AI fires through the gap
//
//   { clear: false, throughBrokenWindow: false,
//     blockedByIntactWindow: { x, z, hp }, fullBlock: false }
//      → first blocker is an intact window; AI breaks it (advance +
//        fire AT it) instead of giving up
//
//   { clear: false, throughBrokenWindow: false,
//     blockedByIntactWindow: null, fullBlock: true }
//      → solid wall / prop; AI must reroute via flow field
//
// Pass 1C plumbed windows as `userData.kind === 'window'` with a
// nested `windowState` carrying `{ broken, hp, ...}` (see
// src/windows.js). Bullets already do the right thing on contact —
// this helper lets the AI's pre-fire LoS decision do the same so
// a gunman doesn't refuse to shoot just because some glass is in
// the way.

const STEP = 0.5;       // metres per sample
const SELF_HIT_SKIP = 0.15; // metres at the origin we skip (avoids
                            // shooter-standing-in-AABB false positives)

export function windowLosBetween(level, ax, az, bx, bz) {
  const result = {
    clear: false,
    throughBrokenWindow: false,
    blockedByIntactWindow: null,
    fullBlock: false,
  };
  if (!level || !level.obstacles || !level.obstacles.length) {
    result.clear = true;
    return result;
  }
  const dx = bx - ax, dz = bz - az;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.001) {
    result.clear = true;
    return result;
  }
  const steps = Math.max(2, Math.ceil(dist / STEP));
  const ux = dx / steps, uz = dz / steps;
  // Track which window proxies we've already counted as "passed
  // through" so a thick window AABB doesn't get double-stamped.
  const passedWindows = new Set();
  for (let i = 1; i <= steps; i++) {
    const x = ax + ux * i;
    const z = az + uz * i;
    // Skip self-hit zone near the shooter origin.
    if (i * STEP < SELF_HIT_SKIP) continue;
    let hit = null;
    for (const o of level.obstacles) {
      const ud = o.userData;
      if (!ud) continue;
      const b = ud.collisionXZ;
      if (!b) continue;
      // Tight 0.05 inflation matches aiSpatial.losClear and the bullet
      // path so AI / bullets agree on the same blockers.
      if (x > b.minX - 0.05 && x < b.maxX + 0.05
          && z > b.minZ - 0.05 && z < b.maxZ + 0.05) {
        hit = o;
        break;
      }
    }
    if (!hit) continue;
    const ud = hit.userData;
    if (ud.kind === 'window') {
      // Already through this window, skip subsequent samples inside
      // the same proxy.
      if (passedWindows.has(hit)) continue;
      passedWindows.add(hit);
      const ws = ud.windowState;
      const broken = !!(ws && ws.broken);
      if (broken) {
        // Walk past — keep stepping.
        result.throughBrokenWindow = true;
        continue;
      }
      // Intact window: blocker, but the kind of blocker the AI can
      // do something about. Stamp + bail out.
      result.blockedByIntactWindow = {
        x: (ud.collisionXZ.minX + ud.collisionXZ.maxX) * 0.5,
        z: (ud.collisionXZ.minZ + ud.collisionXZ.maxZ) * 0.5,
        hp: ws ? (ws.hp || 0) : 2,
        proxy: hit,
      };
      result.clear = false;
      result.fullBlock = false;
      return result;
    }
    // Any other obstacle: full block.
    result.clear = false;
    result.fullBlock = true;
    return result;
  }
  // Walked the whole segment without a wall hit. Clear (possibly
  // through 1+ broken windows).
  result.clear = true;
  return result;
}
