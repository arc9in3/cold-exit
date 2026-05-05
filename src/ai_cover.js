// Cover scoring. Given a shooter pos S and a target pos T (the
// player), return ranked candidate positions where the shooter can
// stand such that the obstacle blocks LoS from T to S, AND a peek
// 0.4m to one side gives clear LoS back to T.
//
// Used by every gunman variant in Pass 1 (the design unifies cover
// behaviour across standard / dasher / runner / coverSeeker / sniper /
// shielded / tank — formerly only coverSeeker really used cover at
// all). Pure function — no side effects, no state. Caches nothing
// across calls; the spatial hash already does the per-frame query
// reuse for us.
//
// Algorithm (per the design doc):
//   1. aiSpatial.query inside this module would over-couple us — we
//      take the obstacle list directly. The caller (gunman.update)
//      pre-filters to obstacles-near-shooter from level.obstacles +
//      a max search radius. We re-window inside to be defensive.
//   2. For each obstacle, walk the 4 axis-aligned edges. Pick the 2
//      "behind" edges — those whose outward normal points AWAY from T.
//      A candidate position sits 0.5m beyond the edge centre on the
//      shooter side of the obstacle.
//   3. Score = 1.0 if (a) the segment T→candidate is blocked by THIS
//      obstacle's AABB AND (b) at least one of the two side-peek
//      positions has clear LoS to T. 0.6 if blocked but no peek.
//      0.0 if not blocked (candidate is in the open).

const COVER_SEARCH_RADIUS = 8;          // metres
const COVER_OFFSET = 0.5;               // metres behind the edge
const PEEK_OFFSET = 0.4;                // sideways peek
const PROP_MIN_HALF = 0.4;              // skip rugs / decals
const PROP_MAX_HALF = 1.4;              // skip oversized props (full bookshelves)

// Segment-AABB intersection (XZ plane). True when the line segment
// (ax,az)→(bx,bz) passes through the box `b`. Slab method, axis-
// aligned. Mirrors level._segmentIntersectsAABB so the cover scorer
// agrees with whatever the bullet path uses.
function _segHitsAABB(ax, az, bx, bz, b) {
  const dx = bx - ax, dz = bz - az;
  let tmin = 0, tmax = 1;
  // X slab
  if (Math.abs(dx) < 1e-9) {
    if (ax < b.minX || ax > b.maxX) return false;
  } else {
    const inv = 1 / dx;
    let t1 = (b.minX - ax) * inv;
    let t2 = (b.maxX - ax) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  // Z slab
  if (Math.abs(dz) < 1e-9) {
    if (az < b.minZ || az > b.maxZ) return false;
  } else {
    const inv = 1 / dz;
    let t1 = (b.minZ - az) * inv;
    let t2 = (b.maxZ - az) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  return true;
}

// Pull the candidate edge-midpoints for an obstacle that face AWAY
// from T (the threat). Each entry is { cx, cz, nx, nz } where (nx,nz)
// points outward into the cover-side air. Up to 2 edges, picked by
// max dot product with (centre - T). Skips edges that face inwards.
function _behindEdges(obs, tx, tz) {
  const b = obs.userData?.collisionXZ;
  if (!b) return null;
  const cx = (b.minX + b.maxX) * 0.5;
  const cz = (b.minZ + b.maxZ) * 0.5;
  const halfX = (b.maxX - b.minX) * 0.5;
  const halfZ = (b.maxZ - b.minZ) * 0.5;
  // Vector from T to obstacle centre. Edges whose normal aligns with
  // this point AWAY from T (cover side).
  const fx = cx - tx, fz = cz - tz;
  const fl = Math.hypot(fx, fz);
  if (fl < 0.001) return null;
  const ux = fx / fl, uz = fz / fl;
  // 4 candidate edges (axis-aligned). normal points OUT of the obstacle.
  const edges = [
    { cx: b.maxX, cz, nx: 1, nz: 0, hw: halfZ },
    { cx: b.minX, cz, nx: -1, nz: 0, hw: halfZ },
    { cx, cz: b.maxZ, nx: 0, nz: 1, hw: halfX },
    { cx, cz: b.minZ, nx: 0, nz: -1, hw: halfX },
  ];
  // Sort by alignment with the away vector, descending. Two best are
  // the "behind" edges.
  edges.sort((a, b2) => (b2.nx * ux + b2.nz * uz) - (a.nx * ux + a.nz * uz));
  // Reject edges that don't actually face away (a thin wall lined up
  // with the threat would otherwise pick all four).
  const out = [];
  for (let i = 0; i < edges.length && out.length < 2; i++) {
    const dot = edges[i].nx * ux + edges[i].nz * uz;
    if (dot > 0) out.push(edges[i]);
  }
  return out;
}

// Score a single candidate position. Pure helper exported for tests
// + the probe. Returns:
//   { score, peekDir, blocksLoS, peekAvailable }
// where peekDir is +1 or -1 indicating which perpendicular side has
// the clean shot, or 0 when blocksLoS is false.
export function scoreCoverPosition(level, candidate, target, obstacleHint = null) {
  const tx = target.x, tz = target.z;
  const cx = candidate.x, cz = candidate.z;
  // 1. Walkability — refuse positions that are inside a wall.
  if (level && typeof level._collidesAt === 'function'
      && level._collidesAt(cx, cz, 0.45)) {
    return { score: 0, peekDir: 0, blocksLoS: false, peekAvailable: false };
  }
  // 2. Blocks-LoS test — is the target → candidate segment blocked
  //    by SOMETHING in the level? When the caller passes in the hint
  //    obstacle (the one this candidate is hiding behind), prefer
  //    its AABB; otherwise scan all obstacles.
  let blocksLoS = false;
  if (obstacleHint) {
    const b = obstacleHint.userData?.collisionXZ;
    if (b && _segHitsAABB(tx, tz, cx, cz, b)) blocksLoS = true;
  }
  if (!blocksLoS && level && level.obstacles) {
    for (const o of level.obstacles) {
      const b = o.userData?.collisionXZ;
      if (!b) continue;
      // Skip windows when scoring — they're not reliable cover, they
      // can be shot through. Skip doors for the same reason.
      if (o.userData?.kind === 'window') continue;
      if (o.userData?.isDoor && !o.userData?.collisionXZ) continue;
      if (_segHitsAABB(tx, tz, cx, cz, b)) { blocksLoS = true; break; }
    }
  }
  if (!blocksLoS) {
    return { score: 0, peekDir: 0, blocksLoS: false, peekAvailable: false };
  }
  // 3. Peek — sample 0.4m perpendicular to (T → candidate). Pick
  //    whichever side has clear LoS to T.
  const dx = cx - tx, dz = cz - tz;
  const dl = Math.hypot(dx, dz) || 1;
  const px = -dz / dl, pz = dx / dl;
  // Peek positions are slightly forward of cover (toward T) so the
  // shooter actually clears the corner instead of standing still
  // behind it.
  const advance = -0.2; // 20cm forward of candidate
  const peekA = { x: cx + advance * (dx / dl) + px * PEEK_OFFSET,
                  z: cz + advance * (dz / dl) + pz * PEEK_OFFSET };
  const peekB = { x: cx + advance * (dx / dl) - px * PEEK_OFFSET,
                  z: cz + advance * (dz / dl) - pz * PEEK_OFFSET };
  const aClear = _losBetween(level, peekA.x, peekA.z, tx, tz);
  const bClear = _losBetween(level, peekB.x, peekB.z, tx, tz);
  let peekDir = 0;
  if (aClear && bClear) {
    // Both peeks open — pick the one closer to walkable cells (i.e.
    // not inside another wall). Tie? Prefer +1 deterministically.
    if (level && typeof level._collidesAt === 'function') {
      const ablk = level._collidesAt(peekA.x, peekA.z, 0.4);
      const bblk = level._collidesAt(peekB.x, peekB.z, 0.4);
      peekDir = !ablk ? 1 : (!bblk ? -1 : 0);
    } else {
      peekDir = 1;
    }
  } else if (aClear) {
    peekDir = 1;
  } else if (bClear) {
    peekDir = -1;
  }
  const peekAvailable = peekDir !== 0;
  // Reject the peek if the peek position is itself inside a wall —
  // standing in the wall doesn't count as cover.
  if (peekAvailable && level && typeof level._collidesAt === 'function') {
    const peek = peekDir > 0 ? peekA : peekB;
    if (level._collidesAt(peek.x, peek.z, 0.4)) {
      return { score: 0.6, peekDir: 0, blocksLoS: true, peekAvailable: false };
    }
  }
  return {
    score: peekAvailable ? 1.0 : 0.6,
    peekDir,
    blocksLoS: true,
    peekAvailable,
  };
}

// Sample-stepped LoS — same primitive as aiSpatial.losClear but we
// don't import the spatial module here so this file stays a pure
// helper. Returns true when nothing in level.obstacles blocks the
// segment.
function _losBetween(level, ax, az, bx, bz) {
  if (!level || typeof level._collidesAt !== 'function') return true;
  const dx = bx - ax, dz = bz - az;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.001) return true;
  const steps = Math.max(2, Math.ceil(dist / 0.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + dx * t, z = az + dz * t;
    if (level._collidesAt(x, z, 0.05)) return false;
  }
  return true;
}

// Public entry — return up to 5 cover positions ranked by score.
// `opts.maxRadius` defaults to 8m. Caller is welcome to filter further
// (e.g. preferred range, room id) before picking.
export function findCoverFor(level, shooterPos, targetPos, opts = {}) {
  const maxR = opts.maxRadius || COVER_SEARCH_RADIUS;
  if (!level || !level.obstacles || !level.obstacles.length) return [];
  const sx = shooterPos.x, sz = shooterPos.z;
  const tx = targetPos.x, tz = targetPos.z;
  const maxR2 = maxR * maxR;
  const results = [];
  for (const o of level.obstacles) {
    const ud = o.userData;
    if (!ud || !ud.collisionXZ) continue;
    // Reject doors / windows / non-prop walls. Walls CAN be cover
    // (you hide behind a wall) but the existing wall-as-room-boundary
    // is so wide that hiding behind it puts the shooter in the next
    // room. Stick with props + cover-tagged geometry.
    if (ud.isDoor) continue;
    if (ud.kind === 'window') continue;
    if (!ud.isProp && !ud.isCover) continue;
    const b = ud.collisionXZ;
    const halfX = (b.maxX - b.minX) * 0.5;
    const halfZ = (b.maxZ - b.minZ) * 0.5;
    const propR = Math.max(halfX, halfZ);
    if (propR < PROP_MIN_HALF || propR > PROP_MAX_HALF) continue;
    const cx = (b.minX + b.maxX) * 0.5;
    const cz = (b.minZ + b.maxZ) * 0.5;
    const ddx = cx - sx, ddz = cz - sz;
    if (ddx * ddx + ddz * ddz > maxR2) continue;
    const edges = _behindEdges(o, tx, tz);
    if (!edges || !edges.length) continue;
    for (const e of edges) {
      // Candidate sits COVER_OFFSET beyond the edge centre on the
      // away-from-T side. The half-thickness of the prop is already
      // baked into the edge's cx/cz since we put the edge mid on the
      // wall plane, so we add COVER_OFFSET in the outward-normal
      // direction.
      const candX = e.cx + e.nx * COVER_OFFSET;
      const candZ = e.cz + e.nz * COVER_OFFSET;
      const r = scoreCoverPosition(level, { x: candX, z: candZ },
        { x: tx, z: tz }, o);
      if (r.score <= 0) continue;
      results.push({
        x: candX, z: candZ,
        score: r.score,
        peekDir: r.peekDir,
        peekAvailable: r.peekAvailable,
        // Distance bias: closer cover gets a slight nudge so the AI
        // doesn't sprint across the room when something equally good
        // is two metres away. 1.0 cap so it never overrides the
        // peek-vs-no-peek delta.
        bias: 1.0 - Math.min(1, Math.hypot(candX - sx, candZ - sz) / maxR) * 0.2,
      });
    }
  }
  // Final score = score × bias. Sort desc, take top 5.
  results.sort((a, b) => (b.score * b.bias) - (a.score * a.bias));
  return results.slice(0, 5);
}
