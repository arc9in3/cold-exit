// level_shapes.js — Pass 1A of the level-gen overhaul.
//
// Replaces the always-rectangular room interior with one of N shape
// templates. The cell-graph topology stays the same (same neighbors,
// same doorway positions, same room.bounds AABB covering the cell
// footprint); what changes is the per-room geometry within that cell.
//
// Every shape's build() must:
//   1. Leave a gap in its outer wall on every side that has a neighbor
//      (so the doorway connector still lines up with the existing
//      `_buildDoor` placement).
//   2. Produce a `walkableBounds` array of axis-aligned Box3-likes —
//      the union must connect every doorway to every other doorway
//      and to room.cx/room.cz. The Level's flood-fill invariant uses
//      this set.
//   3. Register its walls via the Level instance's wall builders so
//      collision, raycasts, and the solid-cache stay correct.
//
// Shapes are cosmetic + tactical: they do NOT change ROOM_W (18m)
// or DOOR_WIDTH. The room AABB stays at the cell footprint so AI /
// spawn / theme code that reads room.bounds keeps working.

import * as THREE from 'three';
import {
  addRamp,
  addRailing,
  addPlatform,
  addArchOpening,
  WALL_HEIGHT,
  WALL_THICK,
  DOOR_WIDTH,
} from './level_geom.js';

// Shape selection table — see audits/level-gen-overhaul-design.md
// "Goals (Pass 1B)" goal #11. Per-room-type weights bias subBoss/boss
// toward dramatic shapes (rotunda, multiTier, plaza) and keep start
// rooms strictly rectangular for predictable spawns.
const SHAPE_WEIGHTS = {
  start:   { rect: 1.0 },
  combat:  {
    rect: 0.30, lShape: 0.15, tJunction: 0.10, cross: 0.05,
    gallery: 0.10, rotunda: 0.05, multiTier: 0.10,
    courtyard: 0.10, plaza: 0.05,
  },
  subBoss: {
    rotunda: 0.30, multiTier: 0.20, gallery: 0.15,
    plaza: 0.20, lShape: 0.15,
  },
  boss: {
    rotunda: 0.40, plaza: 0.30, multiTier: 0.20, courtyard: 0.10,
  },
  shop: { rect: 0.50, rotunda: 0.30, lShape: 0.20 },
  // Catwalk lives as a separate per-cell variant rolled inside combat
  // when the room has 2+ neighbors. It's not part of the default
  // weight table because it's geometrically heavier.
};

function _weightedPick(weights) {
  const entries = Object.entries(weights);
  if (!entries.length) return 'rect';
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [id, w] of entries) {
    r -= w;
    if (r <= 0) return id;
  }
  return entries[entries.length - 1][0];
}

// Width / depth helpers — every shape references the room's cell
// footprint via room.bounds, NOT the constants, because giant-room
// extensions and boss-doubling stretch the AABB beyond ROOM_W.
function _dims(room) {
  const b = room.bounds;
  return {
    minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ,
    cx: (b.minX + b.maxX) / 2,
    cz: (b.minZ + b.maxZ) / 2,
    w: b.maxX - b.minX,
    d: b.maxZ - b.minZ,
  };
}

// Map a neighbor.dir to the door's center coordinate on the matching
// outer wall, so each shape knows where its "must leave a gap" point
// is. Mirror the logic in level.js _buildDoor: doors land at the
// NEIGHBOR's centerline, not the host room's centerline.
function _doorCenters(level, room) {
  const out = { north: null, south: null, east: null, west: null };
  for (const n of room.neighbors || []) {
    const other = level.rooms[n.otherId];
    if (!other) continue;
    if (n.dir === 'north' || n.dir === 'south') out[n.dir] = other.cx;
    else                                          out[n.dir] = other.cz;
  }
  return out;
}

// Helper — emit the four perimeter walls with door gaps. Mirrors
// level.js _buildRoomPerimeter exactly so shapes can reuse the
// "rectangle with door gaps" base when they only need partial
// override (gallery, courtyard, multiTier, plaza, catwalk).
function _addRectPerimeter(level, room, opts = {}) {
  const skip = opts.skip || {};   // e.g. { south: true } to drop a wall
  const halfGap = DOOR_WIDTH / 2;
  const { minX, maxX, minZ, maxZ } = _dims(room);
  const doors = _doorCenters(level, room);

  const horiz = (cz, side) => {
    if (skip[side]) return;
    const door = doors[side];
    if (door == null) {
      level._addObstacle((minX + maxX) / 2, WALL_HEIGHT / 2, cz,
        (maxX - minX), WALL_HEIGHT, WALL_THICK, level._outerWallColor());
      return;
    }
    const leftFrom = minX, leftTo = door - halfGap;
    const rightFrom = door + halfGap, rightTo = maxX;
    if (leftTo > leftFrom + 0.05) {
      level._addObstacle((leftFrom + leftTo) / 2, WALL_HEIGHT / 2, cz,
        leftTo - leftFrom, WALL_HEIGHT, WALL_THICK, level._outerWallColor());
    }
    if (rightTo > rightFrom + 0.05) {
      level._addObstacle((rightFrom + rightTo) / 2, WALL_HEIGHT / 2, cz,
        rightTo - rightFrom, WALL_HEIGHT, WALL_THICK, level._outerWallColor());
    }
  };
  const vert = (cx, side) => {
    if (skip[side]) return;
    const door = doors[side];
    if (door == null) {
      level._addObstacle(cx, WALL_HEIGHT / 2, (minZ + maxZ) / 2,
        WALL_THICK, WALL_HEIGHT, (maxZ - minZ), level._outerWallColor());
      return;
    }
    const topFrom = minZ, topTo = door - halfGap;
    const botFrom = door + halfGap, botTo = maxZ;
    if (topTo > topFrom + 0.05) {
      level._addObstacle(cx, WALL_HEIGHT / 2, (topFrom + topTo) / 2,
        WALL_THICK, WALL_HEIGHT, topTo - topFrom, level._outerWallColor());
    }
    if (botTo > botFrom + 0.05) {
      level._addObstacle(cx, WALL_HEIGHT / 2, (botFrom + botTo) / 2,
        WALL_THICK, WALL_HEIGHT, botTo - botFrom, level._outerWallColor());
    }
  };

  horiz(minZ, 'north');
  horiz(maxZ, 'south');
  vert(maxX, 'east');
  vert(minX, 'west');
}

// Box3-like helper. Box3 from three.js works but is heavier than we
// need; the flood-fill invariant just needs minX/maxX/minZ/maxZ.
function _box(minX, minZ, maxX, maxZ) {
  return { minX, minZ, maxX, maxZ };
}

// ----- rect (default — preserves current behavior) ---------------------
const rectShape = {
  id: 'rect',
  allowedTypes: ['start', 'combat', 'subBoss', 'boss', 'shop'],
  pickFootprint: (cellX, cellZ, pitch) => 1,
  build(level, room) {
    _addRectPerimeter(level, room);
    const d = _dims(room);
    return {
      walls: [],
      walkableBounds: [_box(d.minX, d.minZ, d.maxX, d.maxZ)],
      props: [],
    };
  },
};

// ----- lShape — two rectangles joined at an inside corner ---------------
// Pick a quadrant to "cut out". The cut-out quadrant becomes a
// recessed corner; the remaining walkable area is L-shaped. Native
// blind angles for ambush play. We never cut a corner that has a
// neighbor on either of its two sides — otherwise the doorway would
// land in the cut-out region and orphans the shape.
const lShape = {
  id: 'lShape',
  allowedTypes: ['combat', 'subBoss', 'boss', 'shop'],
  pickFootprint: (cellX, cellZ, pitch) => 1,
  build(level, room) {
    const d = _dims(room);
    const doors = _doorCenters(level, room);
    // Quadrant table — NE / NW / SE / SW. Each entry: which two
    // outer sides border this corner. We pick a quadrant whose two
    // sides have NO doorway, otherwise the cut-out severs a doorway.
    const quadrants = [
      { id: 'ne', sides: ['north', 'east'] },
      { id: 'nw', sides: ['north', 'west'] },
      { id: 'se', sides: ['south', 'east'] },
      { id: 'sw', sides: ['south', 'west'] },
    ];
    const safe = quadrants.filter(q => !q.sides.some(s => doors[s] != null));
    if (!safe.length) {
      // No safe quadrant — degrade to rect. Better than breaking
      // doorway invariants.
      return rectShape.build(level, room);
    }
    const pick = safe[Math.floor(Math.random() * safe.length)];
    const cutW = d.w * 0.4;     // cut a 40% × 40% notch
    const cutD = d.d * 0.4;
    const isE = pick.sides.includes('east');
    const isN = pick.sides.includes('north');
    const cutMinX = isE ? d.maxX - cutW : d.minX;
    const cutMaxX = isE ? d.maxX        : d.minX + cutW;
    const cutMinZ = isN ? d.minZ        : d.maxZ - cutD;
    const cutMaxZ = isN ? d.minZ + cutD : d.maxZ;

    // Outer walls — same as rect, but on the two cut-corner sides
    // we replace the full-length wall with a SHORTER segment that
    // only spans the un-cut portion.
    _addRectPerimeter(level, room, {
      skip: { [pick.sides[0]]: true, [pick.sides[1]]: true },
    });
    // Re-add the cut sides with shortened spans.
    // Side 1: the horizontal one (north/south)
    {
      const horizSide = pick.sides.find(s => s === 'north' || s === 'south');
      const cz = horizSide === 'north' ? d.minZ : d.maxZ;
      // Wall runs from the un-cut edge to the room's other end.
      const fromX = isE ? d.minX : cutMaxX;
      const toX   = isE ? cutMinX : d.maxX;
      if (toX > fromX + 0.05) {
        level._addObstacle((fromX + toX) / 2, WALL_HEIGHT / 2, cz,
          toX - fromX, WALL_HEIGHT, WALL_THICK, level._outerWallColor());
      }
    }
    // Side 2: the vertical one (east/west)
    {
      const vertSide = pick.sides.find(s => s === 'east' || s === 'west');
      const cx = vertSide === 'east' ? d.maxX : d.minX;
      const fromZ = isN ? cutMaxZ : d.minZ;
      const toZ   = isN ? d.maxZ  : cutMinZ;
      if (toZ > fromZ + 0.05) {
        level._addObstacle(cx, WALL_HEIGHT / 2, (fromZ + toZ) / 2,
          WALL_THICK, WALL_HEIGHT, toZ - fromZ, level._outerWallColor());
      }
    }
    // The two NEW interior walls that close off the cut-out quadrant
    // and form the inside corner of the L. One horizontal, one vertical.
    {
      const cz = isN ? cutMaxZ : cutMinZ;
      const fromX = isE ? cutMinX : d.minX;
      const toX   = isE ? d.maxX  : cutMaxX;
      if (toX > fromX + 0.05) {
        level._addObstacle((fromX + toX) / 2, WALL_HEIGHT / 2, cz,
          toX - fromX, WALL_HEIGHT, WALL_THICK, level._outerWallColor());
      }
    }
    {
      const cx = isE ? cutMinX : cutMaxX;
      const fromZ = isN ? d.minZ : cutMinZ;
      const toZ   = isN ? cutMaxZ : d.maxZ;
      if (toZ > fromZ + 0.05) {
        level._addObstacle(cx, WALL_HEIGHT / 2, (fromZ + toZ) / 2,
          WALL_THICK, WALL_HEIGHT, toZ - fromZ, level._outerWallColor());
      }
    }
    // Walkable bounds — the L splits into two overlapping rectangles
    // that share the inside-corner band. Both connect doorways.
    const wb = [];
    if (isE) {
      // The "long" side runs along the west portion of the room.
      wb.push(_box(d.minX, d.minZ, cutMinX, d.maxZ));
      // The "short" side runs along the un-cut Z half on the east.
      wb.push(isN
        ? _box(d.minX, cutMaxZ, d.maxX, d.maxZ)
        : _box(d.minX, d.minZ, d.maxX, cutMinZ));
    } else {
      wb.push(_box(cutMaxX, d.minZ, d.maxX, d.maxZ));
      wb.push(isN
        ? _box(d.minX, cutMaxZ, d.maxX, d.maxZ)
        : _box(d.minX, d.minZ, d.maxX, cutMinZ));
    }
    return { walls: [], walkableBounds: wb, props: [] };
  },
};

// ----- tJunction — three corridor stubs into a hub ----------------------
// Pick one outer side as the "back wall" (no stub there). The other
// three sides each get a corridor leading inward to a central hub.
// Doorways stay where they were on each open side.
const tJunction = {
  id: 'tJunction',
  allowedTypes: ['combat', 'subBoss'],
  pickFootprint: (cellX, cellZ, pitch) => 1,
  build(level, room) {
    const d = _dims(room);
    const doors = _doorCenters(level, room);
    const sides = ['north', 'south', 'east', 'west'];
    const sidesWithoutDoors = sides.filter(s => doors[s] == null);
    if (sidesWithoutDoors.length === 0) {
      // All four sides are entries — degrade to cross.
      return crossShape.build(level, room);
    }
    // closedSide — the wall that's solid (no stub). Prefer one that
    // actually has no neighbor; if none, degrade to rect.
    const closedSide = sidesWithoutDoors[Math.floor(Math.random() * sidesWithoutDoors.length)];

    _addRectPerimeter(level, room);

    // Central hub — a 7×7 region the three stubs converge on.
    const hubR = 3.5;
    const hub = _box(d.cx - hubR, d.cz - hubR, d.cx + hubR, d.cz + hubR);
    // Four "infill" regions around the hub — each that is on the
    // CLOSED side gets blocked off; the other three are open
    // corridors. We model each infill as two interior walls forming
    // an L that funnels traffic toward the hub center.
    const corridorHalf = DOOR_WIDTH / 2 + 0.5;
    // North stub fill — only added if north is closed
    const fillSide = (side) => {
      if (side !== closedSide) return;
      if (side === 'north') {
        // Wall runs across the room just inside the closed wall.
        level._addObstacle(d.cx, WALL_HEIGHT / 2, d.cz - hubR,
          d.w - 2.5, WALL_HEIGHT, WALL_THICK, level._outerWallColor());
      } else if (side === 'south') {
        level._addObstacle(d.cx, WALL_HEIGHT / 2, d.cz + hubR,
          d.w - 2.5, WALL_HEIGHT, WALL_THICK, level._outerWallColor());
      } else if (side === 'east') {
        level._addObstacle(d.cx + hubR, WALL_HEIGHT / 2, d.cz,
          WALL_THICK, WALL_HEIGHT, d.d - 2.5, level._outerWallColor());
      } else {
        level._addObstacle(d.cx - hubR, WALL_HEIGHT / 2, d.cz,
          WALL_THICK, WALL_HEIGHT, d.d - 2.5, level._outerWallColor());
      }
    };
    sides.forEach(fillSide);
    // Walkable bounds — hub + three corridor strips. Even when one
    // arm has no doorway, leave the corridor open to keep the hub
    // visually a T (otherwise it reads as a corner).
    const wb = [hub];
    if (closedSide !== 'north') wb.push(_box(d.cx - corridorHalf, d.minZ, d.cx + corridorHalf, d.cz));
    if (closedSide !== 'south') wb.push(_box(d.cx - corridorHalf, d.cz, d.cx + corridorHalf, d.maxZ));
    if (closedSide !== 'east')  wb.push(_box(d.cx, d.cz - corridorHalf, d.maxX, d.cz + corridorHalf));
    if (closedSide !== 'west')  wb.push(_box(d.minX, d.cz - corridorHalf, d.cx, d.cz + corridorHalf));
    return { walls: [], walkableBounds: wb, props: [] };
  },
};

// ----- cross — 4 corridor stubs around central plaza --------------------
const crossShape = {
  id: 'cross',
  allowedTypes: ['combat', 'subBoss'],
  pickFootprint: (cellX, cellZ, pitch) => 1,
  build(level, room) {
    const d = _dims(room);
    _addRectPerimeter(level, room);
    // Four "corner blocker" interior walls — one per corner, forming
    // an L that closes off the diagonal. The result is a + shape:
    // a central plaza with a corridor stub running to each cardinal.
    const armHalf = DOOR_WIDTH / 2 + 1.5;
    const cornerSize = Math.min(d.w, d.d) / 2 - armHalf;
    if (cornerSize > 1) {
      // Each corner: two interior walls meeting at a right angle,
      // facing the central plaza.
      const corners = [
        { x: d.minX, z: d.minZ, hx: 1, hz: 1 },  // NW
        { x: d.maxX, z: d.minZ, hx: -1, hz: 1 }, // NE
        { x: d.minX, z: d.maxZ, hx: 1, hz: -1 }, // SW
        { x: d.maxX, z: d.maxZ, hx: -1, hz: -1 },// SE
      ];
      for (const c of corners) {
        // Horizontal segment of the L — runs along the X axis at the
        // corner-side facing the plaza.
        level._addObstacle(
          c.x + c.hx * cornerSize / 2,
          WALL_HEIGHT / 2,
          c.z + c.hz * cornerSize,
          cornerSize, WALL_HEIGHT, WALL_THICK, level._outerWallColor(),
        );
        // Vertical segment of the L
        level._addObstacle(
          c.x + c.hx * cornerSize,
          WALL_HEIGHT / 2,
          c.z + c.hz * cornerSize / 2,
          WALL_THICK, WALL_HEIGHT, cornerSize, level._outerWallColor(),
        );
      }
    }
    // Walkable bounds — cross of two perpendicular strips.
    const wb = [
      _box(d.cx - armHalf, d.minZ, d.cx + armHalf, d.maxZ),  // vert arm
      _box(d.minX, d.cz - armHalf, d.maxX, d.cz + armHalf),  // horiz arm
    ];
    return { walls: [], walkableBounds: wb, props: [] };
  },
};

// ----- gallery — long hall, narrowed in one axis ------------------------
const gallery = {
  id: 'gallery',
  allowedTypes: ['combat', 'subBoss'],
  pickFootprint: (cellX, cellZ, pitch) => 1,
  build(level, room) {
    const d = _dims(room);
    const doors = _doorCenters(level, room);
    // Pick the narrow axis — choose whichever has no doorways on
    // either of its perpendicular sides (so we can pinch it without
    // cutting a doorway). Default to X (narrow east/west).
    const eastWestHasDoors = doors.east != null || doors.west != null;
    const narrowZ = eastWestHasDoors;  // narrow Z if E/W has doors
    _addRectPerimeter(level, room);
    // Pinch walls — two long interior walls that narrow the hall.
    const halfWidth = 4;   // 8m wide hall
    if (narrowZ) {
      // Hall runs E-W; pinch in Z.
      level._addObstacle(d.cx, WALL_HEIGHT / 2, d.cz - halfWidth,
        d.w - 2.0, WALL_HEIGHT, WALL_THICK, level._outerWallColor());
      level._addObstacle(d.cx, WALL_HEIGHT / 2, d.cz + halfWidth,
        d.w - 2.0, WALL_HEIGHT, WALL_THICK, level._outerWallColor());
    } else {
      // Hall runs N-S; pinch in X.
      level._addObstacle(d.cx - halfWidth, WALL_HEIGHT / 2, d.cz,
        WALL_THICK, WALL_HEIGHT, d.d - 2.0, level._outerWallColor());
      level._addObstacle(d.cx + halfWidth, WALL_HEIGHT / 2, d.cz,
        WALL_THICK, WALL_HEIGHT, d.d - 2.0, level._outerWallColor());
    }
    const wb = narrowZ
      ? [_box(d.minX, d.cz - halfWidth, d.maxX, d.cz + halfWidth)]
      : [_box(d.cx - halfWidth, d.minZ, d.cx + halfWidth, d.maxZ)];
    return { walls: [], walkableBounds: wb, props: [] };
  },
};

// ----- rotunda — octagonal room (chamfered corners) ---------------------
// We model the octagon by adding four diagonal walls in the corners
// of the rectangular cell. Each diagonal cuts off ~3m × 3m of corner.
// Doorway gaps stay where they were on the four cardinal walls.
const rotunda = {
  id: 'rotunda',
  allowedTypes: ['combat', 'subBoss', 'boss', 'shop'],
  pickFootprint: (cellX, cellZ, pitch) => 1,
  build(level, room) {
    const d = _dims(room);
    _addRectPerimeter(level, room);
    const chamfer = Math.min(d.w, d.d) * 0.25;  // ~4.5m on a 18m room
    const corners = [
      { x: d.minX, z: d.minZ, dx: 1, dz: 1 },  // NW — wall from (minX, minZ+ch) to (minX+ch, minZ)
      { x: d.maxX, z: d.minZ, dx: -1, dz: 1 }, // NE
      { x: d.minX, z: d.maxZ, dx: 1, dz: -1 }, // SW
      { x: d.maxX, z: d.maxZ, dx: -1, dz: -1 },// SE
    ];
    for (const c of corners) {
      // Diagonal wall placed as a rotated thin box. We approximate
      // collision by the AABB (engine has no rotated collision
      // shapes for obstacles); visual rotation alone communicates
      // the chamfer. Length = chamfer * sqrt(2).
      const length = chamfer * Math.SQRT2;
      const midX = c.x + c.dx * chamfer / 2;
      const midZ = c.z + c.dz * chamfer / 2;
      const mat = new THREE.MeshStandardMaterial({
        color: level._outerWallColor(), roughness: 0.85,
      });
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(length, WALL_HEIGHT, WALL_THICK),
        mat,
      );
      // Rotate so the diagonal points from corner toward room center.
      // c.dx=1, c.dz=1 (NW corner) → rotation -45deg (-PI/4).
      // c.dx=1, c.dz=-1 (SW)       → rotation +45deg.
      const yaw = Math.atan2(-c.dz, c.dx) - Math.PI / 4;
      mesh.position.set(midX, WALL_HEIGHT / 2, midZ);
      mesh.rotation.y = yaw;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      // Bound the AABB conservatively so collision still works for
      // straight-line movement. Use the full chamfer × chamfer
      // square as the collisionXZ band.
      mesh.userData.collisionXZ = {
        minX: Math.min(c.x, c.x + c.dx * chamfer),
        maxX: Math.max(c.x, c.x + c.dx * chamfer),
        minZ: Math.min(c.z, c.z + c.dz * chamfer),
        maxZ: Math.max(c.z, c.z + c.dz * chamfer),
      };
      mesh.userData.isRotundaChamfer = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      level.scene.add(mesh);
      level.obstacles.push(mesh);
      level._dirtySolid();
    }
    // Walkable bounds — approximate the octagon as a single inset
    // rectangle (the inscribed square). Doorway corridors extend out
    // to the perimeter on each cardinal axis. The flood-fill check
    // only cares that doorways are reachable from each other, so the
    // inscribed square + four corridor strips is sufficient.
    const inset = chamfer * 0.5;
    const wb = [
      _box(d.minX + inset, d.minZ + inset, d.maxX - inset, d.maxZ - inset),
      _box(d.cx - DOOR_WIDTH / 2 - 0.5, d.minZ, d.cx + DOOR_WIDTH / 2 + 0.5, d.maxZ),
      _box(d.minX, d.cz - DOOR_WIDTH / 2 - 0.5, d.maxX, d.cz + DOOR_WIDTH / 2 + 0.5),
    ];
    return { walls: [], walkableBounds: wb, props: [] };
  },
};

// ----- multiTier — degraded to plaza-with-cosmetic-platform -------------
// Per the brief: if a shape feels too risky (multiTier requires AI +
// projectile changes for two heights), ship a flatter variant. Here
// we drop a 1m cosmetic platform along one wall with a ramp at one
// end and a railing at the other. Walkability is the floor — the
// platform's top is decorative only (props can sit on it; AI walks
// around). This is visually distinct from rect without changing
// pathfinding semantics.
const multiTier = {
  id: 'multiTier',
  allowedTypes: ['combat', 'subBoss', 'boss'],
  pickFootprint: (cellX, cellZ, pitch) => 1,
  build(level, room) {
    const d = _dims(room);
    const doors = _doorCenters(level, room);
    _addRectPerimeter(level, room);
    // Pick a wall to hug — one without a doorway, otherwise we'd
    // block the door with the platform.
    const candidates = ['north', 'south', 'east', 'west'].filter(s => doors[s] == null);
    if (!candidates.length) {
      // Fall back to plaza if every side has a door.
      return plaza.build(level, room);
    }
    const side = candidates[Math.floor(Math.random() * candidates.length)];
    const platformDepth = 4.5;
    const platformHeight = 1.0;
    let plMinX, plMaxX, plMinZ, plMaxZ;
    if (side === 'north') {
      plMinX = d.minX + 1.5; plMaxX = d.maxX - 1.5;
      plMinZ = d.minZ + WALL_THICK; plMaxZ = plMinZ + platformDepth;
    } else if (side === 'south') {
      plMinX = d.minX + 1.5; plMaxX = d.maxX - 1.5;
      plMaxZ = d.maxZ - WALL_THICK; plMinZ = plMaxZ - platformDepth;
    } else if (side === 'east') {
      plMaxX = d.maxX - WALL_THICK; plMinX = plMaxX - platformDepth;
      plMinZ = d.minZ + 1.5; plMaxZ = d.maxZ - 1.5;
    } else {
      plMinX = d.minX + WALL_THICK; plMaxX = plMinX + platformDepth;
      plMinZ = d.minZ + 1.5; plMaxZ = d.maxZ - 1.5;
    }
    addPlatform(level, _box(plMinX, plMinZ, plMaxX, plMaxZ), platformHeight);
    // Ramp at one end of the platform — walkable, lands at floor
    // height. We pick the end nearest the room center on the long
    // axis so it's reachable.
    const isHoriz = (side === 'north' || side === 'south');
    if (isHoriz) {
      // Ramp along X at the end nearer to room center
      const rampStartX = plMinX;
      const rampEndX   = plMinX - 2.0;
      const rampZ = (plMinZ + plMaxZ) / 2;
      addRamp(level, rampStartX, rampZ, rampEndX, rampZ, platformHeight, platformDepth);
      // Railing along the inner edge of the platform
      if (side === 'north') {
        addRailing(level, plMinX, plMaxZ, plMaxX, plMaxZ);
      } else {
        addRailing(level, plMinX, plMinZ, plMaxX, plMinZ);
      }
    } else {
      const rampStartZ = plMinZ;
      const rampEndZ   = plMinZ - 2.0;
      const rampX = (plMinX + plMaxX) / 2;
      addRamp(level, rampX, rampStartZ, rampX, rampEndZ, platformHeight, platformDepth);
      if (side === 'east') {
        addRailing(level, plMinX, plMinZ, plMinX, plMaxZ);
      } else {
        addRailing(level, plMaxX, plMinZ, plMaxX, plMaxZ);
      }
    }
    // Walkable bounds — the entire room floor MINUS the platform
    // footprint is walkable. We approximate as the full cell because
    // _collidesAt already accounts for the platform's collision proxy,
    // and the flood-fill just needs doorway reachability.
    return {
      walls: [],
      walkableBounds: [_box(d.minX, d.minZ, d.maxX, d.maxZ)],
      props: [],
    };
  },
};

// ----- courtyard — replace one wall with a parapet-style fence ----------
// Visually distinct because the missing wall reads as "outside". We
// don't actually open the cell — there's a low parapet line to keep
// the player in. The "removed" wall must be one without a neighbor.
const courtyard = {
  id: 'courtyard',
  allowedTypes: ['combat', 'subBoss', 'boss'],
  pickFootprint: (cellX, cellZ, pitch) => 1,
  build(level, room) {
    const d = _dims(room);
    const doors = _doorCenters(level, room);
    const candidates = ['north', 'south', 'east', 'west'].filter(s => doors[s] == null);
    if (!candidates.length) {
      // Every side has a door — degrade to rect. Don't break the seal.
      return rectShape.build(level, room);
    }
    const side = candidates[Math.floor(Math.random() * candidates.length)];
    _addRectPerimeter(level, room, { skip: { [side]: true } });
    // Parapet — a chest-high (1.0m) low wall replacing the full
    // wall. Acts as cover but visually opens the cell.
    let p1x, p1z, p2x, p2z;
    if (side === 'north') { p1x = d.minX; p1z = d.minZ; p2x = d.maxX; p2z = d.minZ; }
    else if (side === 'south') { p1x = d.minX; p1z = d.maxZ; p2x = d.maxX; p2z = d.maxZ; }
    else if (side === 'east') { p1x = d.maxX; p1z = d.minZ; p2x = d.maxX; p2z = d.maxZ; }
    else { p1x = d.minX; p1z = d.minZ; p2x = d.minX; p2z = d.maxZ; }
    addRailing(level, p1x, p1z, p2x, p2z);
    // Walkable bounds — full cell footprint.
    return {
      walls: [],
      walkableBounds: [_box(d.minX, d.minZ, d.maxX, d.maxZ)],
      props: [],
    };
  },
};

// ----- catwalk — degraded to "plaza with two raised cosmetic catwalks" --
// Same caveat as multiTier — true two-height pathing is a Pass 2
// concern. We render two narrow raised strips along walls, each with
// a ramp + railing, but the floor is the only walkable level.
const catwalk = {
  id: 'catwalk',
  allowedTypes: ['combat', 'subBoss'],
  pickFootprint: (cellX, cellZ, pitch) => 1,
  build(level, room) {
    const d = _dims(room);
    const doors = _doorCenters(level, room);
    _addRectPerimeter(level, room);
    // Two adjacent walls without doorways — pick perpendicular pair.
    const candidates = ['north', 'south', 'east', 'west'].filter(s => doors[s] == null);
    if (candidates.length < 2) {
      return plaza.build(level, room);
    }
    // Pick a horizontal + a vertical
    const horiz = candidates.find(s => s === 'north' || s === 'south');
    const vert  = candidates.find(s => s === 'east' || s === 'west');
    if (!horiz || !vert) return plaza.build(level, room);
    const cwDepth = 2.5;
    const cwHeight = 1.0;
    // Horizontal strip
    let hMinZ, hMaxZ;
    if (horiz === 'north') { hMinZ = d.minZ + WALL_THICK; hMaxZ = hMinZ + cwDepth; }
    else                   { hMaxZ = d.maxZ - WALL_THICK; hMinZ = hMaxZ - cwDepth; }
    addPlatform(level, _box(d.minX + 1.5, hMinZ, d.maxX - 1.5, hMaxZ), cwHeight);
    addRailing(level,
      d.minX + 1.5, horiz === 'north' ? hMaxZ : hMinZ,
      d.maxX - 1.5, horiz === 'north' ? hMaxZ : hMinZ);
    // Vertical strip
    let vMinX, vMaxX;
    if (vert === 'east') { vMaxX = d.maxX - WALL_THICK; vMinX = vMaxX - cwDepth; }
    else                 { vMinX = d.minX + WALL_THICK; vMaxX = vMinX + cwDepth; }
    addPlatform(level, _box(vMinX, d.minZ + 1.5, vMaxX, d.maxZ - 1.5), cwHeight);
    addRailing(level,
      vert === 'east' ? vMinX : vMaxX, d.minZ + 1.5,
      vert === 'east' ? vMinX : vMaxX, d.maxZ - 1.5);
    // Single ramp at one corner of the horizontal strip
    addRamp(level,
      d.minX + 2, horiz === 'north' ? hMaxZ : hMinZ,
      d.minX + 2, horiz === 'north' ? hMaxZ + 2 : hMinZ - 2,
      cwHeight, cwDepth);
    return {
      walls: [],
      walkableBounds: [_box(d.minX, d.minZ, d.maxX, d.maxZ)],
      props: [],
    };
  },
};

// ----- plaza — fully open, internal "prop island" cluster sites ---------
// Plaza shape itself is just the perimeter. Prop island clusters are
// a Pass 1B prop-placement concern; here we just produce an open
// rectangle but add a ring of low-cover hint blocks at the room
// center so it reads as "plaza with a centerpiece" instead of empty.
const plaza = {
  id: 'plaza',
  allowedTypes: ['combat', 'subBoss', 'boss'],
  pickFootprint: (cellX, cellZ, pitch) => 1,
  build(level, room) {
    const d = _dims(room);
    _addRectPerimeter(level, room);
    // No interior walls — plaza is intentionally open. A 1m raised
    // dais at center signals "this is a plaza, not just an empty
    // room", and gives the boss-arena variant a visual anchor.
    if (room.type === 'boss' || room.type === 'subBoss') {
      const daisR = 3.5;
      addPlatform(level,
        _box(d.cx - daisR, d.cz - daisR, d.cx + daisR, d.cz + daisR),
        0.3,  // low dais — not high enough to obstruct line of sight
      );
    }
    return {
      walls: [],
      walkableBounds: [_box(d.minX, d.minZ, d.maxX, d.maxZ)],
      props: [],
    };
  },
};

export const SHAPE_REGISTRY = {
  rect: rectShape,
  lShape,
  tJunction,
  cross: crossShape,
  gallery,
  rotunda,
  multiTier,
  courtyard,
  catwalk,
  plaza,
};

// Pick a shape ID for this room based on its type. Returns 'rect' if
// no weights are defined for the type. Honors the shape's
// allowedTypes — falls through to rect if a sampled shape doesn't
// match (defensive, shouldn't normally happen).
export function pickShapeForRoom(room) {
  const weights = SHAPE_WEIGHTS[room.type];
  if (!weights) return 'rect';
  // Filter by allowedTypes — a shape that doesn't list this room.type
  // gets dropped from the weight pool.
  const filtered = {};
  for (const [id, w] of Object.entries(weights)) {
    const shape = SHAPE_REGISTRY[id];
    if (shape && shape.allowedTypes.includes(room.type)) {
      filtered[id] = w;
    }
  }
  if (!Object.keys(filtered).length) return 'rect';
  return _weightedPick(filtered);
}
