// ledges.js — Pass 1C climbable window-ledge surfaces.
//
// A ledge is a narrow (0.6m wide) raised walkway placed along an
// exterior wall at sill height (1.0m default). The player can:
//   - Mantle UP from inside the room (within 1.5m forward, height ≤ 1.5m)
//   - Walk along the ledge to bypass corners or enemies
//   - Drop OFF either long side (back into the room or out the
//     window if it's been broken)
//
// While the player is on a ledge, AI detection radius gets a 1.4×
// multiplier (silhouetted exposure). Pass 2's stealth scoring will
// read isOnLedge(player) directly.
//
// Ledges are stored on level.ledges (created lazily). Each ledge:
//   { x1, z1, x2, z2, height, group, walkableY, side, dropCellX,
//     dropCellZ, ... }
//
// The mesh is purely visual — the ledge has NO collision proxy on
// its top surface (the player teleports up). On its long sides we
// add thin railings only where the brief calls for them; otherwise
// dropOff() handles the fall back to the floor.

import * as THREE from 'three';

const LEDGE_DEPTH = 0.6;       // perpendicular thickness (player walks along)
const LEDGE_HEIGHT_DEFAULT = 1.0;
const LEDGE_TOP_THICK = 0.18;  // visible slab thickness

// Add a ledge to the level along the segment (x1,z1)→(x2,z2). The
// ledge is centered on the segment; players walk on top at `height`.
// Returns the ledge record. opts.side is the inside-of-room
// direction so dropOff() knows which way is "back into the room";
// auto-derived from segment orientation if omitted.
export function addLedge(level, x1, z1, x2, z2, height = LEDGE_HEIGHT_DEFAULT, opts = {}) {
  if (!level.ledges) level.ledges = [];

  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  if (length < 0.5) return null;

  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const isHoriz = Math.abs(dx) >= Math.abs(dz);

  // Slab geometry — narrow rectangle along the segment direction.
  const w = isHoriz ? length : LEDGE_DEPTH;
  const d = isHoriz ? LEDGE_DEPTH : length;
  const slabMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a55, roughness: 0.85,
  });
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(w, LEDGE_TOP_THICK, d),
    slabMat,
  );
  slab.position.set(cx, height + LEDGE_TOP_THICK / 2, cz);
  slab.castShadow = false;
  slab.receiveShadow = true;
  // Narrow brackets visually tie the ledge to the wall — purely
  // cosmetic, two thin posts under the ends.
  slab.userData.kind = 'ledge';
  // No collisionXZ — the player teleports onto the ledge via mantle;
  // bullets pass through the ledge slab so it doesn't double as
  // accidental cover.
  slab.userData.collisionXZ = null;
  slab.matrixAutoUpdate = false;
  slab.updateMatrix();
  level.scene.add(slab);
  level.decorations.push(slab);

  // Inside / outside the room for drop-off. For a ledge along a
  // wall, the inside drop-off lands the player one body-radius INTO
  // the room (perpendicular to the segment). The caller (level.js
  // exterior-wall pass) usually knows which side of the wall is
  // interior; if unspecified, we infer from the room provided in
  // opts.room.
  let insideX = cx, insideZ = cz;
  let outsideX = cx, outsideZ = cz;
  const off = 1.2;
  if (opts.room && opts.room.bounds) {
    const b = opts.room.bounds;
    if (isHoriz) {
      // Horizontal ledge: inside is whichever Z direction lands
      // inside b.minZ..b.maxZ.
      if (cz <= b.minZ + 0.5)        { insideZ = cz + off; outsideZ = cz - off; }
      else if (cz >= b.maxZ - 0.5)   { insideZ = cz - off; outsideZ = cz + off; }
      else                            { insideZ = (b.minZ + b.maxZ) / 2; outsideZ = cz; }
    } else {
      if (cx <= b.minX + 0.5)        { insideX = cx + off; outsideX = cx - off; }
      else if (cx >= b.maxX - 0.5)   { insideX = cx - off; outsideX = cx + off; }
      else                            { insideX = (b.minX + b.maxX) / 2; outsideX = cx; }
    }
  } else {
    // No room — guess: inside drop is +Z for a horizontal segment,
    // +X for vertical.
    if (isHoriz) insideZ = cz + off;
    else         insideX = cx + off;
  }

  const ledge = {
    x1, z1, x2, z2,
    cx, cz,
    length,
    isHoriz,
    height,
    walkableY: height + LEDGE_TOP_THICK,
    insideX, insideZ,
    outsideX, outsideZ,
    slab,
    room: opts.room || null,
    windowState: opts.windowState || null,
  };
  level.ledges.push(ledge);
  return ledge;
}

// Find the nearest ledge edge the player can mantle up to. Returns
// the ledge record + a target point, or null. Criteria:
//   - within 1.5m forward of the player along facingYaw
//   - ledge top height ≤ 1.5m
//   - player's foot is below the ledge top
//
// facingYaw is rotation around Y; +X is at yaw=0 (matches the
// game's existing yaw convention; if it doesn't match a particular
// caller, normalize before calling).
export function mantleableAt(level, playerPos, facingYaw, opts = {}) {
  if (!level.ledges || !level.ledges.length) return null;
  const reach = opts.reach ?? 1.5;
  const cosY = Math.cos(facingYaw);
  const sinY = Math.sin(facingYaw);
  // Player must be roughly facing the ledge — dot(playerForward, ledgeNormal) > 0
  let best = null;
  let bestDist = reach * reach;
  for (const ledge of level.ledges) {
    if (ledge.height > 1.5) continue;
    if (playerPos.y > ledge.walkableY + 0.2) continue;
    // Closest point on the ledge segment to the player.
    const cp = _closestPointOnSegment(playerPos.x, playerPos.z,
      ledge.x1, ledge.z1, ledge.x2, ledge.z2);
    const dx = cp.x - playerPos.x;
    const dz = cp.z - playerPos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > bestDist) continue;
    // Forward-facing check — player's forward (cosY, sinY) points
    // toward the ledge.
    const len = Math.sqrt(d2) || 1;
    const dot = (dx / len) * cosY + (dz / len) * sinY;
    if (dot < 0.2) continue;       // not facing
    bestDist = d2;
    best = { ledge, target: { x: cp.x, y: ledge.walkableY, z: cp.z } };
  }
  return best;
}

// Apply mantle — instant teleport up to ledge top. Sets
// player.onLedge = ledge so isOnLedge() picks it up. The opts.player
// here is the raw player object (state container in main.js); we
// don't import player.js to keep the dependency direction clean.
export function applyMantle(player, ledge) {
  if (!player || !ledge) return false;
  // Lift the player. Player position is at foot height; ledge top
  // is walkableY. We don't animate — instant snap. Camera lift is
  // the caller's responsibility (main.js raises camera by 1m while
  // onLedge).
  if (player.position) {
    player.position.y = ledge.walkableY;
    // Nudge XZ onto the closest point of the ledge so the player
    // stands ON the ledge, not floating off the edge.
    const cp = _closestPointOnSegment(player.position.x, player.position.z,
      ledge.x1, ledge.z1, ledge.x2, ledge.z2);
    player.position.x = cp.x;
    player.position.z = cp.z;
  } else if (player.mesh && player.mesh.position) {
    player.mesh.position.y = ledge.walkableY;
    const cp = _closestPointOnSegment(player.mesh.position.x, player.mesh.position.z,
      ledge.x1, ledge.z1, ledge.x2, ledge.z2);
    player.mesh.position.x = cp.x;
    player.mesh.position.z = cp.z;
  }
  player.onLedge = ledge;
  return true;
}

export function isOnLedge(player) {
  return !!(player && player.onLedge);
}

// Drop off the ledge. side = 'inside' (back into the room) or
// 'outside' (out the window — only safe if the window is broken,
// otherwise this is a fall). Sets player.onLedge = null and applies
// the position; gravity + level fall handler take it from there.
export function dropOff(player, side = 'inside') {
  if (!player || !player.onLedge) return false;
  const ledge = player.onLedge;
  const target = side === 'outside'
    ? { x: ledge.outsideX, z: ledge.outsideZ }
    : { x: ledge.insideX,  z: ledge.insideZ };
  if (player.position) {
    player.position.x = target.x;
    player.position.z = target.z;
    player.position.y = 0;
  } else if (player.mesh && player.mesh.position) {
    player.mesh.position.x = target.x;
    player.mesh.position.z = target.z;
    player.mesh.position.y = 0;
  }
  player.onLedge = null;
  return true;
}

function _closestPointOnSegment(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-6) return { x: x1, z: z1 };
  let t = ((px - x1) * dx + (pz - z1) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + dx * t, z: z1 + dz * t };
}
