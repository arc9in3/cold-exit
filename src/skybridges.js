// skybridges.js — Pass 1C connector-room generator.
//
// A "connector room" is a thin walkway that joins two adjacent
// cells in DIFFERENT buildings. The connector is built into the
// world as its own level.rooms entry (id stays low-positive but is
// allocated AFTER chain + branches; same shape as the synthetic
// extraction room — has bounds / cx / cz / neighbors so roomAt()
// can find the player while they're crossing).
//
// IMPORTANT: cell-graph topology is fixed by the cell pitch
// (ROOM_W + WALL_THICK = ~19.2m), so a connector between two
// adjacent cells fits in the WALL_THICK slot between them — about
// 1.2m of run length. The visual difference between a connector and
// a normal door is therefore floor color, railings (skybridge-open),
// glass panels (skybridge-glass), or a low ceiling (sewer-tunnel).
// "Long" 12m skybridges from the design doc require non-adjacent
// rooms — that's a Pass 1D extension, not in scope here.
//
// Five kinds (from the design doc):
//   skybridge-glass — fully enclosed glass tunnel (4×12). Bullets
//     pass through but bodies don't until shattered. Reuses
//     buildWindow() for the side panels.
//   skybridge-open  — open catwalk with railings on BOTH long sides.
//     Visually striking; players using it are exposed.
//   crane-arm       — narrow plank walkway over an industrial yard,
//     2m wide, no railings. Falling triggers the level fall handler.
//   fire-escape     — staircase + landing pattern, ground-up access.
//   sewer-tunnel    — low-ceiling pipe segment 3×8 underground; the
//     cells above can be in different buildings.
//
// The connector exists between fromRoom and toRoom; it occupies
// space NOT covered by either's bounds (parallel to the line between
// their centers, slightly beyond their flush edges). The doorways
// into each end remain in the original wall positions of the host
// rooms — we don't re-cut walls; we just place the connector
// geometry sitting in front of the existing doorway gaps.

import * as THREE from 'three';
import { addRamp, addRailing, addPlatform, WALL_HEIGHT, WALL_THICK } from './level_geom.js';
import { buildWindow } from './windows.js';

// Default connector dimensions per kind. width is the perpendicular
// span (corridor width), length is the run direction.
const KIND_DIMS = {
  'skybridge-glass': { width: 4, length: 12, elevation: 3.0, hasRailing: false, hasGlass: true,  hasFloor: true,  isOpen: false },
  'skybridge-open':  { width: 4, length: 12, elevation: 3.0, hasRailing: true,  hasGlass: false, hasFloor: true,  isOpen: true  },
  'crane-arm':       { width: 2, length: 14, elevation: 2.5, hasRailing: false, hasGlass: false, hasFloor: true,  isOpen: true,  isFallable: true },
  'fire-escape':     { width: 3, length: 8,  elevation: 0.0, hasRailing: true,  hasGlass: false, hasFloor: true,  isOpen: true  },
  'sewer-tunnel':    { width: 3, length: 8,  elevation: 0.0, hasRailing: false, hasGlass: false, hasFloor: true,  isOpen: false, lowCeiling: true },
};

// Build a skybridge / connector. Mutates the level — adds obstacles,
// platforms, and pushes a synthetic-but-real room into level.rooms.
//
// Returns the new room object (with bounds + cx/cz/neighbors filled
// in) so the caller can verify and bookkeep, or null if the
// connector couldn't be placed (rooms not aligned cardinally, etc.).
//
// The connector adds itself to BOTH endpoints' neighbors as a new
// room id; the original direct fromRoom→toRoom edge is left intact
// (so the chain graph still reads the same), but the door BETWEEN
// fromRoom and toRoom that level.js built is replaced visually with
// the connector — see the call site in level.js.
export function buildSkybridge(level, fromRoom, toRoom, kind, opts = {}) {
  const dims = { ...(KIND_DIMS[kind] || KIND_DIMS['skybridge-open']), ...opts };
  // Determine the cardinal direction from fromRoom → toRoom. We only
  // support cardinal connectors (matching the cell-grid). A null dir
  // means the rooms aren't directly aligned — bail.
  const dir = _cardinalDir(fromRoom, toRoom);
  if (!dir) return null;

  // Compute the connector's footprint. The connector lives in the
  // gap between the two rooms' walls along the connecting direction;
  // it's centered on the line between their centers.
  const aBounds = fromRoom.bounds;
  const bBounds = toRoom.bounds;
  let minX, maxX, minZ, maxZ, axis;
  if (dir === 'east') {
    // toRoom is east of fromRoom. Bridge spans from fromRoom.maxX
    // to toRoom.minX; centered on average Z of the two rooms.
    minX = aBounds.maxX;
    maxX = bBounds.minX;
    const cz = (fromRoom.cz + toRoom.cz) / 2;
    minZ = cz - dims.width / 2;
    maxZ = cz + dims.width / 2;
    axis = 'x';
  } else if (dir === 'west') {
    minX = bBounds.maxX;
    maxX = aBounds.minX;
    const cz = (fromRoom.cz + toRoom.cz) / 2;
    minZ = cz - dims.width / 2;
    maxZ = cz + dims.width / 2;
    axis = 'x';
  } else if (dir === 'north') {
    minZ = bBounds.maxZ;
    maxZ = aBounds.minZ;
    const cx = (fromRoom.cx + toRoom.cx) / 2;
    minX = cx - dims.width / 2;
    maxX = cx + dims.width / 2;
    axis = 'z';
  } else /* south */ {
    minZ = aBounds.maxZ;
    maxZ = bBounds.minZ;
    const cx = (fromRoom.cx + toRoom.cx) / 2;
    minX = cx - dims.width / 2;
    maxX = cx + dims.width / 2;
    axis = 'z';
  }
  // Sanity — degenerate spans bail.
  if (maxX <= minX + 0.5 || maxZ <= minZ + 0.5) return null;

  const bounds = { minX, maxX, minZ, maxZ };
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  // ---- Floor / platform ---------------------------------------------
  // Connector floor sits at dims.elevation. For ground-level
  // connectors (fire-escape, sewer) we just add a thin platform; for
  // raised ones we add a chunkier slab so the platformHeight reads
  // visually. The platform is registered as a level obstacle so AI
  // and projectiles see it.
  if (dims.hasFloor) {
    if (dims.elevation > 0.05) {
      addPlatform(level, bounds, dims.elevation);
    } else {
      // Ground-level — add a flat decorative slab for visual
      // distinction from the surrounding floor. Tiny height keeps
      // collision near-flat so AI can walk over.
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(maxX - minX, 0.08, maxZ - minZ),
        new THREE.MeshStandardMaterial({ color: 0x3a3540, roughness: 0.9 }),
      );
      floor.position.set(cx, 0.04, cz);
      floor.castShadow = false;
      floor.receiveShadow = true;
      floor.userData.kind = `connector-floor-${kind}`;
      floor.userData.collisionXZ = null;       // walk-over
      floor.matrixAutoUpdate = false;
      floor.updateMatrix();
      level.scene.add(floor);
      level.decorations.push(floor);
    }
  }

  // ---- Railings (open variants) -------------------------------------
  if (dims.hasRailing) {
    if (axis === 'x') {
      addRailing(level, minX + 0.4, minZ, maxX - 0.4, minZ);
      addRailing(level, minX + 0.4, maxZ, maxX - 0.4, maxZ);
    } else {
      addRailing(level, minX, minZ + 0.4, minX, maxZ - 0.4);
      addRailing(level, maxX, minZ + 0.4, maxX, maxZ - 0.4);
    }
  }

  // ---- Glass tunnel walls (skybridge-glass) -------------------------
  if (dims.hasGlass) {
    // Two long glass panels along the running axis. Each panel
    // becomes a buildWindow with sillHeight=0 (floor-to-ceiling).
    const panelCount = 2;          // one panel per side
    const panelLen = (axis === 'x' ? maxX - minX : maxZ - minZ) - 0.4;
    const panelHeight = WALL_HEIGHT * 0.9;
    for (let i = 0; i < panelCount; i++) {
      const w = buildWindow({ width: panelLen, height: panelHeight, sillHeight: 0 });
      w.group.position.set(
        axis === 'x' ? cx : (i === 0 ? minX : maxX),
        dims.elevation + 0.04,
        axis === 'x' ? (i === 0 ? minZ : maxZ) : cz,
      );
      // Rotate the second axis-X panel onto the perpendicular plane.
      if (axis === 'x') {
        // Panels run along X; default geometry is along X already, so
        // no Y-rotation needed. Side panel lives on the Z-min / Z-max
        // edge of the bridge — already positioned above.
      } else {
        w.group.rotation.y = Math.PI / 2;
      }
      level.scene.add(w.group);
      level.decorations.push(w.group);
      // Build a collision proxy matching the glass slab.
      const proxyW = (axis === 'x') ? panelLen : (w.collision.d);
      const proxyD = (axis === 'x') ? (w.collision.d) : panelLen;
      const proxyMat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, depthWrite: false,
      });
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(proxyW, panelHeight, proxyD),
        proxyMat,
      );
      const px = w.group.position.x;
      const pz = w.group.position.z;
      proxy.position.set(px, dims.elevation + panelHeight / 2 + 0.04, pz);
      proxy.userData.collisionXZ = {
        minX: px - proxyW / 2, maxX: px + proxyW / 2,
        minZ: pz - proxyD / 2, maxZ: pz + proxyD / 2,
      };
      proxy.userData.kind = 'window';
      proxy.userData.windowState = w.state;
      proxy.userData.isWindowProxy = true;
      proxy.matrixAutoUpdate = false;
      proxy.updateMatrix();
      level.scene.add(proxy);
      level.obstacles.push(proxy);
      w.state.collisionProxy = proxy;
      level._dirtySolid?.();
    }
  }

  // ---- Low-ceiling sewer cap ----------------------------------------
  if (dims.lowCeiling) {
    const ceil = new THREE.Mesh(
      new THREE.BoxGeometry(maxX - minX, 0.2, maxZ - minZ),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.95 }),
    );
    ceil.position.set(cx, 1.8, cz);
    ceil.castShadow = false;
    ceil.receiveShadow = true;
    ceil.userData.kind = `connector-ceiling-${kind}`;
    ceil.userData.collisionXZ = null;
    ceil.matrixAutoUpdate = false;
    ceil.updateMatrix();
    level.scene.add(ceil);
    level.decorations.push(ceil);
  }

  // ---- Fire-escape stair detail -------------------------------------
  if (kind === 'fire-escape') {
    // Decorative stair step at one end so it reads as up-from-ground.
    const stepLen = (axis === 'x' ? (maxX - minX) : (maxZ - minZ)) * 0.3;
    const stepMid = (axis === 'x')
      ? { x: minX + stepLen / 2, z: cz }
      : { x: cx, z: minZ + stepLen / 2 };
    addRamp(
      level,
      stepMid.x - (axis === 'x' ? stepLen / 2 : 0),
      stepMid.z - (axis === 'z' ? stepLen / 2 : 0),
      stepMid.x + (axis === 'x' ? stepLen / 2 : 0),
      stepMid.z + (axis === 'z' ? stepLen / 2 : 0),
      0.6,
      dims.width - 0.4,
    );
  }

  // ---- Synthetic room object ----------------------------------------
  // Connector rooms are added to level.rooms with id = next-free; the
  // graph treats them as a hop between fromRoom and toRoom. We use a
  // POSITIVE id (not synthetic-negative like extraction) because the
  // pathway-invariant should treat the connector as a normal pass-
  // through room.
  const connectorId = level.rooms.length;
  const opp = { east: 'west', west: 'east', north: 'south', south: 'north' };
  const room = {
    id: connectorId,
    type: 'connector',
    layout: 'open',
    bounds,
    cx, cz,
    cellX: 0, cellZ: 0,
    neighbors: [
      { otherId: fromRoom.id, dir: opp[dir] },
      { otherId: toRoom.id,   dir },
    ],
    cleared: true,
    entered: false,
    hasElevator: false,
    building: 'connector',
    connectorKind: kind,
    elevation: dims.elevation,
    isOpen: !!dims.isOpen,
    isFallable: !!dims.isFallable,
    _walkableBounds: [bounds],
  };

  // Patch up the original rooms' neighbor lists. fromRoom and toRoom
  // each lose their direct edge to each other and gain an edge to
  // the connector. This way pathway flood-fill from spawn → boss
  // routes through the connector instead of teleporting through the
  // building wall.
  if (fromRoom.neighbors) {
    for (const n of fromRoom.neighbors) {
      if (n.otherId === toRoom.id) {
        n.otherId = connectorId;
      }
    }
  }
  if (toRoom.neighbors) {
    for (const n of toRoom.neighbors) {
      if (n.otherId === fromRoom.id) {
        n.otherId = connectorId;
      }
    }
  }

  return room;
}

// Cardinal direction from a → b given their cell positions. Returns
// 'east' / 'west' / 'north' / 'south' or null if the rooms aren't
// cardinally aligned.
function _cardinalDir(a, b) {
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  if (Math.abs(dx) > Math.abs(dz) * 1.5) {
    return dx > 0 ? 'east' : 'west';
  }
  if (Math.abs(dz) > Math.abs(dx) * 1.5) {
    return dz > 0 ? 'south' : 'north';
  }
  return null;
}
