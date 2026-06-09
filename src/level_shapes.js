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
import { sharedMaterial } from './material_pool.js';

// Shape selection table — see audits/level-gen-overhaul-design.md
// "Goals (Pass 1B)" goal #11. Per-room-type weights bias subBoss/boss
// toward dramatic shapes (rotunda, multiTier, plaza) and keep start
// rooms strictly rectangular for predictable spawns.
// Per the user's locked architectural rule: "Main path always
// ground-level walkable. Mantling/ledges/multiTier/plaza-dais are
// branches only." multiTier drops a 4.5m × room-width solid platform
// hugging a wall (full-footprint collision); plaza drops a 7m-diameter
// solid dais at room center. Both block significant portions of the
// floor and are NEVER allowed in main-path rooms (start, combat, boss).
//
// Branches (subBoss, shop, encounter) may roll them — branches aren't
// part of the player's required path and the impassable geometry there
// is a deliberate design choice.
const SHAPE_WEIGHTS = {
  start:   { rect: 1.0 },
  combat:  {
    // Main path. Only shapes whose entire interior is ground-walkable.
    // Removed: multiTier (platform), plaza (dais). Weight redistributed
    // toward rect / lShape / courtyard / gallery.
    // New geometry pass: twoBay / alcove / hexHall added at MODEST weight
    // so they appear sometimes (lowers blast radius if any has an issue).
    // All three are fully ground-walkable (twoBay's divider has a center
    // doorway gap; alcove only adds an inward pocket; hexHall only bevels
    // two corners on a doorless edge).
    rect: 0.30, lShape: 0.18, tJunction: 0.10, cross: 0.05,
    gallery: 0.13, rotunda: 0.05,
    courtyard: 0.09,
    twoBay: 0.05, alcove: 0.03, hexHall: 0.02,
  },
  subBoss: {
    // Branch — multiTier + plaza fine here.
    rotunda: 0.28, multiTier: 0.18, gallery: 0.14,
    plaza: 0.18, lShape: 0.14,
    twoBay: 0.04, hexHall: 0.04,
  },
  boss: {
    // Main path — boss arena must be fully ground-walkable so player
    // and boss can engage anywhere without a platform in the way.
    // Removed plaza (7m dais blocks center) + multiTier (4.5m platform).
    // Replaced with weight-balanced open shapes.
    rotunda: 0.55, courtyard: 0.30, lShape: 0.15,
  },
  shop: { rect: 0.46, rotunda: 0.28, lShape: 0.18, alcove: 0.05, hexHall: 0.03 },
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

// Tag wall meshes built by shape templates with userData.kind so
// _clearDoorCorridors can recognise + clear them when a shape
// template sealed off a doorway (Phase M step 3). Pass the mesh
// returned from level._addObstacle through this helper at every
// shape-wall site below.
function _tagShapeWall(mesh) {
  if (mesh && mesh.userData) mesh.userData.kind = 'shape-wall';
  return mesh;
}

// Cosmetic corner detailing — softens the harsh 90° meeting of two
// perimeter walls with a slim accent-tinted corner pillar plus a small
// chamfer fillet, consistent with how the rotunda shape overlays a
// decorative diagonal accent. PURELY VISUAL: the mesh is added via
// level.scene.add + level.decorations (disposed in level.clear()) and
// NEVER gets a userData.collisionXZ, so it never enters level.obstacles
// and cannot affect collision, raycasts, the navmesh, or the
// walkableBounds flood-fill invariant.
//
// Pillars hug the inside corner of the cell footprint. They're inset
// against the wall faces and kept thin (0.45m) + short of the door
// gaps (doors are at wall centers; corners are far from any doorway),
// so they read as architecture without crowding the play space.
function _addCornerPillars(level, room) {
  const d = _dims(room);
  if (level.decorations == null) return;
  const inset = WALL_THICK / 2;          // sit just inside the wall face
  const pillarT = 0.45;                  // footprint of the pillar
  const half = pillarT / 2;
  const accent = level._accentColor ? level._accentColor() : 0xc9a464;
  const accentHi = level._accentHiColor ? level._accentHiColor() : 0xddb878;
  const corners = [
    { x: d.minX + inset, z: d.minZ + inset },
    { x: d.maxX - inset, z: d.minZ + inset },
    { x: d.minX + inset, z: d.maxZ - inset },
    { x: d.maxX - inset, z: d.maxZ - inset },
  ];
  const matBody = sharedMaterial({
    color: level._outerWallColor(), roughness: 0.8, metalness: 0.0,
  });
  const matCap = sharedMaterial({
    color: accent, roughness: 0.5, metalness: 0.2,
  });
  const matCrown = sharedMaterial({
    color: accentHi, roughness: 0.45, metalness: 0.25,
  });
  for (const c of corners) {
    // Pillar body — full-height thin rib at the corner.
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(pillarT, WALL_HEIGHT - 0.04, pillarT),
      matBody,
    );
    body.position.set(c.x, WALL_HEIGHT / 2, c.z);
    body.castShadow = false;
    body.receiveShadow = true;
    body.userData.kind = 'corner-pillar';
    body.matrixAutoUpdate = false;
    body.updateMatrix();
    level.scene.add(body);
    level.decorations.push(body);

    // Accent capital band near the top — ties the pillar into the
    // perimeter accent band visually.
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(pillarT + 0.06, 0.22, pillarT + 0.06),
      matCap,
    );
    cap.position.set(c.x, WALL_HEIGHT * 0.62, c.z);
    cap.castShadow = false;
    cap.receiveShadow = true;
    cap.userData.kind = 'corner-pillar-cap';
    cap.matrixAutoUpdate = false;
    cap.updateMatrix();
    level.scene.add(cap);
    level.decorations.push(cap);

    // Bright crown at the very top — a small chamfered glint.
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(pillarT + 0.1, 0.06, pillarT + 0.1),
      matCrown,
    );
    crown.position.set(c.x, WALL_HEIGHT - 0.06, c.z);
    crown.castShadow = false;
    crown.receiveShadow = true;
    crown.userData.kind = 'corner-pillar-crown';
    crown.matrixAutoUpdate = false;
    crown.updateMatrix();
    level.scene.add(crown);
    level.decorations.push(crown);
  }
}

// Theme accent color helper — prefers the live accent getter, falls
// back to the theme object's accent, then a neutral brass. Used by the
// cosmetic floor-decal helpers below so each biome's floor dressing
// picks up its own hue.
function _shapeAccent(level) {
  if (level._accentColor) return level._accentColor();
  if (level.theme && level.theme.accent != null) return level.theme.accent;
  return 0xc9a464;
}

// Cosmetic floor border — a thin inset accent frame painted a hair
// above the floor, hugging the cell perimeter. PURELY VISUAL via the
// same contract as _addCornerPillars: each strip is a THREE.Mesh
// added to level.scene + tracked in level.decorations, NEVER given a
// userData.collisionXZ and NEVER routed through level._addObstacle.
// It cannot enter level.obstacles and so cannot touch collision,
// raycasts, the navmesh, or the walkableBounds flood-fill.
//
// The frame is an OPEN rectangle (four border strips, hollow center)
// inset ~1.2m from the walls, so it never overlaps a doorway gap
// (doors sit at wall centers, the frame is set in from the wall) and
// the floor stays fully readable. Flat (1.5cm tall) → no z-fighting,
// nothing to walk into.
function _addFloorBorder(level, room, opts = {}) {
  if (level.decorations == null) return;
  const d = _dims(room);
  const inset = opts.inset ?? 1.4;       // pull in from the wall face
  const t = opts.t ?? 0.16;              // strip width
  const y = 0.015;                       // flat decal height
  const color = opts.color ?? _shapeAccent(level);
  // Skip tiny rooms where the inset frame would collapse.
  if (d.w - inset * 2 < 2 || d.d - inset * 2 < 2) return;
  const minX = d.minX + inset, maxX = d.maxX - inset;
  const minZ = d.minZ + inset, maxZ = d.maxZ - inset;
  const fw = maxX - minX, fd = maxZ - minZ;
  const m = sharedMaterial({ color, roughness: 0.5, metalness: 0.15 });
  // Each strip carries its footprint directly as (sw on X, sd on Z).
  const strips = [
    // two along X (north + south edges of the frame)
    { sw: fw, sd: t, x: (minX + maxX) / 2, z: minZ },
    { sw: fw, sd: t, x: (minX + maxX) / 2, z: maxZ },
    // two along Z (east + west edges), trimmed so corners don't double
    { sw: t, sd: fd - t * 2, x: minX, z: (minZ + maxZ) / 2 },
    { sw: t, sd: fd - t * 2, x: maxX, z: (minZ + maxZ) / 2 },
  ];
  for (const s of strips) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.sw, 0.03, s.sd), m);
    mesh.position.set(s.x, y, s.z);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.kind = 'floor-border-accent';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    level.scene.add(mesh);
    level.decorations.push(mesh);
  }
}

// Cosmetic center medallion — a flat accent disc + inner ring painted
// at the room center, a hair above the floor. Same decoration-only
// contract as above (scene.add + decorations.push, no collisionXZ, no
// _addObstacle). Gives open shapes (rotunda, plaza) a deliberate
// "centerpiece" read without any free-standing geometry that could
// trap the player. Flat → fully walkable across.
function _addCenterMedallion(level, room, opts = {}) {
  if (level.decorations == null) return;
  const d = _dims(room);
  const r = opts.r ?? Math.min(d.w, d.d) * 0.18;
  if (r < 1) return;
  const color = opts.color ?? _shapeAccent(level);
  const floorColor = (level.theme && level.theme.floor != null)
    ? level.theme.floor : 0x2a2a2e;
  // Outer disc — tinted toward the floor so it reads as inlaid stone.
  const discMat = sharedMaterial({ color: floorColor, roughness: 0.7 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.03, 32), discMat);
  disc.position.set(d.cx, 0.012, d.cz);
  disc.castShadow = false;
  disc.receiveShadow = true;
  disc.userData.kind = 'center-medallion';
  disc.matrixAutoUpdate = false;
  disc.updateMatrix();
  level.scene.add(disc);
  level.decorations.push(disc);
  // Accent ring just inside the disc edge.
  const ringMat = sharedMaterial({ color, roughness: 0.45, metalness: 0.2,
    side: THREE.DoubleSide });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r * 0.78, r * 0.9, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(d.cx, 0.02, d.cz);
  ring.castShadow = false;
  ring.receiveShadow = false;
  ring.userData.kind = 'center-medallion-ring';
  ring.matrixAutoUpdate = false;
  ring.updateMatrix();
  level.scene.add(ring);
  level.decorations.push(ring);
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
    // Cosmetic corner pillars — soften the 90° corners. Decoration-only,
    // does NOT touch walkableBounds (see _addCornerPillars).
    _addCornerPillars(level, room);
    // Cosmetic floor border — a thin inset accent frame. Flat decal,
    // decoration-only (see _addFloorBorder); never touches collision
    // or walkableBounds. ~55% of rect rooms get one so the floor
    // dressing reads varied rather than uniform.
    if (Math.random() < 0.55) _addFloorBorder(level, room);
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
    _addCornerPillars(level, room);

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
    _addCornerPillars(level, room);
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
// The hall's "long" axis must be the axis where doorways live; pinching
// the perpendicular axis is what creates the hall feel. If doorways
// exist on BOTH axes we can't pinch without orphaning a door, so the
// shape degrades to rect.
const gallery = {
  id: 'gallery',
  allowedTypes: ['combat', 'subBoss'],
  pickFootprint: (cellX, cellZ, pitch) => 1,
  build(level, room, opts = {}) {
    const d = _dims(room);
    const doors = _doorCenters(level, room);
    const ewDoors = doors.east != null || doors.west != null;
    const nsDoors = doors.north != null || doors.south != null;
    // If both axes have doors we can't pinch either without sealing a
    // door. Fall back to rect so doorway invariants stay intact.
    if (ewDoors && nsDoors) return rectShape.build(level, room);
    // Default: hall runs E-W (long X axis) when doors are on E/W only.
    // Pinch in Z (north/south walls move inward).
    const narrowZ = ewDoors;
    _addRectPerimeter(level, room);
    // Phase M step 5 — main-path rooms must keep the corridor
    // width >= 3m end-to-end; branches keep the original 8m hall.
    // Both currently land well above the 3m hard floor (>=3m means
    // halfWidth >= 1.5), but stamp the flag explicitly so future
    // narrowings can't silently regress below the floor.
    const halfWidth = opts.isMainPath ? Math.max(4, 1.5) : 4;   // 8m wide hall
    if (narrowZ) {
      level._addObstacle(d.cx, WALL_HEIGHT / 2, d.cz - halfWidth,
        d.w - 2.0, WALL_HEIGHT, WALL_THICK, level._outerWallColor());
      level._addObstacle(d.cx, WALL_HEIGHT / 2, d.cz + halfWidth,
        d.w - 2.0, WALL_HEIGHT, WALL_THICK, level._outerWallColor());
    } else {
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
      // Chamfer "wall" was a rotated thin box (length × WALL_THICK)
      // that VISUALLY rendered as a diagonal accent, but the engine
      // collision is axis-aligned and the AABB was set to the full
      // chamfer × chamfer corner quadrant. Result: player saw a thin
      // diagonal line but felt a solid 4.5×4.5 wall — the playtest
      // "standing next to an invisible wall" report. The cut-out
      // CORNER is supposed to be impassable (the rotunda's whole
      // point is octagonal play space), so we'd rather match the
      // collision than shrink it.
      //
      // New approach: render the corner as a SOLID corner block —
      // axis-aligned, exactly matching the collision footprint — and
      // overlay a thin diagonal accent on top so the chamfered shape
      // still reads visually. The corner block is the gameplay wall;
      // the diagonal is decoration.
      const minXc = Math.min(c.x, c.x + c.dx * chamfer);
      const maxXc = Math.max(c.x, c.x + c.dx * chamfer);
      const minZc = Math.min(c.z, c.z + c.dz * chamfer);
      const maxZc = Math.max(c.z, c.z + c.dz * chamfer);
      const cornerW = maxXc - minXc;
      const cornerD = maxZc - minZc;
      const cornerCx = (minXc + maxXc) / 2;
      const cornerCz = (minZc + maxZc) / 2;
      const blockMat = sharedMaterial({
        color: level._outerWallColor(), roughness: 0.85,
      });
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(cornerW, WALL_HEIGHT, cornerD),
        blockMat,
      );
      block.position.set(cornerCx, WALL_HEIGHT / 2, cornerCz);
      block.castShadow = false;
      block.receiveShadow = true;
      block.userData.collisionXZ = {
        minX: minXc, maxX: maxXc, minZ: minZc, maxZ: maxZc,
      };
      block.userData.isRotundaChamfer = true;
      block.matrixAutoUpdate = false;
      block.updateMatrix();
      level.scene.add(block);
      level.obstacles.push(block);
      level._dirtySolid();

      // Decorative diagonal accent — slightly darker/lighter tint
      // so the chamfer reads as a beveled corner rather than a flat
      // square. No collision (hidden by the solid block behind it).
      // Inset 0.05m above the floor + outward from the block so it
      // doesn't z-fight against the corner-block face.
      const length = chamfer * Math.SQRT2;
      const midX = c.x + c.dx * chamfer / 2;
      const midZ = c.z + c.dz * chamfer / 2;
      const accentMat = sharedMaterial({
        color: level._outerWallColor(), roughness: 0.6, metalness: 0.05,
      });
      const accent = new THREE.Mesh(
        new THREE.BoxGeometry(length, WALL_HEIGHT - 0.04, 0.18),
        accentMat,
      );
      accent.position.set(midX, WALL_HEIGHT / 2, midZ);
      accent.rotation.y = Math.atan2(-c.dz, c.dx) - Math.PI / 4;
      accent.castShadow = false;
      accent.receiveShadow = true;
      accent.userData.kind = 'rotunda-chamfer-accent';
      level.scene.add(accent);
      // Tracked as a decoration so room-clear / level-clear teardown
      // disposes it cleanly.
      if (level.decorations) level.decorations.push(accent);
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
    // Cosmetic center medallion — a flat inlaid disc. The octagon's
    // center is walkable (inscribed square above), and the medallion is
    // a flat decal (see _addCenterMedallion): no collision, no
    // walkableBounds change. Gives the rotunda a deliberate centerpiece.
    _addCenterMedallion(level, room);
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
    // Track the platform footprint so walkableBounds below excludes
    // it. Without this, the verifier thinks the entire cell is
    // walkable and the doorway-reachability check passes even when
    // the platform sits between two doorways.
    const _plFootprint = _box(plMinX, plMinZ, plMaxX, plMaxZ);
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
    // Walkable bounds — the floor MINUS the platform footprint.
    // Decompose the L-shape (or strip) of remaining walkable area
    // into 1-2 axis-aligned boxes so the verifier sees the platform
    // as impassable. side==='north' platform sits at the top so the
    // walkable area is everything south of platMaxZ + the strips
    // on either side. Same logic mirrored for other sides.
    const wb = [];
    if (side === 'north') {
      wb.push(_box(d.minX, plMaxZ, d.maxX, d.maxZ));    // big region south of platform
      wb.push(_box(d.minX, d.minZ, plMinX, plMaxZ));    // strip west of platform
      wb.push(_box(plMaxX, d.minZ, d.maxX, plMaxZ));    // strip east of platform
    } else if (side === 'south') {
      wb.push(_box(d.minX, d.minZ, d.maxX, plMinZ));
      wb.push(_box(d.minX, plMinZ, plMinX, d.maxZ));
      wb.push(_box(plMaxX, plMinZ, d.maxX, d.maxZ));
    } else if (side === 'east') {
      wb.push(_box(d.minX, d.minZ, plMinX, d.maxZ));
      wb.push(_box(plMinX, d.minZ, d.maxX, plMinZ));
      wb.push(_box(plMinX, plMaxZ, d.maxX, d.maxZ));
    } else {
      wb.push(_box(plMaxX, d.minZ, d.maxX, d.maxZ));
      wb.push(_box(d.minX, d.minZ, plMaxX, plMinZ));
      wb.push(_box(d.minX, plMaxZ, plMaxX, d.maxZ));
    }
    return { walls: [], walkableBounds: wb, props: [] };
  },
};

// ----- courtyard — glazed "window wall" on one doorless side -----------
// Reads as open/airy without breaking encapsulation. The OLD version
// deleted the outer wall on a doorless side and dropped a 1m parapet,
// which left the cell visually open to the void (the doorless side
// almost always faces the map edge, not a neighbour) — that was the
// "rooms no longer encapsulating the gameplay area" report. Now the
// side stays a FULL-HEIGHT sealed wall, dressed with tall recessed
// glazing panels so it reads as a window wall, and the chest-high
// parapet rail moves a few metres inboard as a balcony rail + cover.
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
    // FULL perimeter — every side sealed (no skip). Encapsulation first.
    _addRectPerimeter(level, room);
    _addCornerPillars(level, room);
    const horiz = (side === 'north' || side === 'south');
    // Glazing decoration on the interior face of the window wall —
    // a cool recessed panel + vertical mullions. Decoration-only
    // (level._addAccentDeco never sets collisionXZ), so it changes
    // nothing about sealing / pathing / raycasts. Cheap flavour.
    const GLASS = 0x223040, MULLION = 0x10151c;
    const proud = WALL_THICK / 2 + 0.06;
    const panelH = WALL_HEIGHT - 0.7, panelY = WALL_HEIGHT / 2;
    if (typeof level._addAccentDeco === 'function') {
      if (horiz) {
        const z = (side === 'north' ? d.minZ : d.maxZ) + (side === 'north' ? proud : -proud);
        const len = (d.maxX - d.minX) - 1.0;
        level._addAccentDeco((d.minX + d.maxX) / 2, panelY, z, len, panelH, 0.06, GLASS,
          { kind: 'window-glass', roughness: 0.25, metalness: 0.4 });
        const bays = 4;
        for (let i = 1; i < bays; i++) {
          const mx = d.minX + (d.maxX - d.minX) * (i / bays);
          level._addAccentDeco(mx, panelY, z, 0.18, panelH, 0.1, MULLION, { kind: 'window-mullion' });
        }
      } else {
        const x = (side === 'west' ? d.minX : d.maxX) + (side === 'west' ? proud : -proud);
        const len = (d.maxZ - d.minZ) - 1.0;
        level._addAccentDeco(x, panelY, (d.minZ + d.maxZ) / 2, 0.06, panelH, len, GLASS,
          { kind: 'window-glass', roughness: 0.25, metalness: 0.4 });
        const bays = 4;
        for (let i = 1; i < bays; i++) {
          const mz = d.minZ + (d.maxZ - d.minZ) * (i / bays);
          level._addAccentDeco(x, panelY, mz, 0.1, panelH, 0.18, MULLION, { kind: 'window-mullion' });
        }
      }
    }
    // Balcony parapet — chest-high rail set ~3m inboard from the window
    // wall: cover + a "you're looking out over an edge" read, without
    // touching the sealed perimeter.
    const inset = 3.0;
    let p1x, p1z, p2x, p2z;
    if (side === 'north') { const z = d.minZ + inset; p1x = d.minX + 1.5; p1z = z; p2x = d.maxX - 1.5; p2z = z; }
    else if (side === 'south') { const z = d.maxZ - inset; p1x = d.minX + 1.5; p1z = z; p2x = d.maxX - 1.5; p2z = z; }
    else if (side === 'east') { const x = d.maxX - inset; p1x = x; p1z = d.minZ + 1.5; p2x = x; p2z = d.maxZ - 1.5; }
    else { const x = d.minX + inset; p1x = x; p1z = d.minZ + 1.5; p2x = x; p2z = d.maxZ - 1.5; }
    addRailing(level, p1x, p1z, p2x, p2z);
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
    _addCornerPillars(level, room);
    // No interior walls — plaza is intentionally open. A 1m raised
    // dais at center signals "this is a plaza, not just an empty
    // room", and gives the boss-arena variant a visual anchor.
    // Plaza now only rolls on subBoss (per the updated SHAPE_WEIGHTS).
    // Boss rooms got plaza removed because the dais blocks center-of-
    // room engagement. Keep the dais visual on subBoss for spectacle.
    let daisFp = null;
    if (room.type === 'subBoss') {
      const daisR = 3.5;
      daisFp = _box(d.cx - daisR, d.cz - daisR, d.cx + daisR, d.cz + daisR);
      addPlatform(level, daisFp, 0.3);
    }
    // Walkable bounds — exclude the dais footprint when present so
    // the verifier sees it as impassable. Without the dais we just
    // ship the full cell.
    const wb = daisFp ? [
      _box(d.minX, d.minZ, d.maxX, daisFp.minZ),
      _box(d.minX, daisFp.maxZ, d.maxX, d.maxZ),
      _box(d.minX, daisFp.minZ, daisFp.minX, daisFp.maxZ),
      _box(daisFp.maxX, daisFp.minZ, d.maxX, daisFp.maxZ),
    ] : [_box(d.minX, d.minZ, d.maxX, d.maxZ)];
    // Cosmetic center medallion — ONLY when there's no raised dais
    // (the dais is a real platform; a flat decal on top would clip).
    // Flat decal, decoration-only (see _addCenterMedallion): no
    // collision, no walkableBounds change. Anchors the open plaza floor.
    if (!daisFp) _addCenterMedallion(level, room);
    return { walls: [], walkableBounds: wb, props: [] };
  },
};

// ----- twoBay — divided room, single interior wall with a CENTER GAP -----
// Splits the cell into two bays with one full-span interior divider that
// has a centered doorway-width gap, so the two bays stay connected through
// the middle. The divider runs PERPENDICULAR to the axis that has doorways
// when possible, so it never lands on a real outer doorway. If doorways
// exist on both axes (so any divider would risk crossing a door line) we
// degrade to rect.
//
// CONNECTIVITY: the divider has a DOOR_WIDTH gap dead-center, exactly like
// the perimeter door gaps. walkableBounds is modelled as the two bay boxes
// PLUS a connector box spanning the gap, so the flood-fill sees one
// connected region that contains every doorway. The gap is centered on the
// room (d.cx / d.cz), which is interior — never near a perimeter doorway —
// so no outer door can be sealed by the divider stubs.
const twoBay = {
  id: 'twoBay',
  allowedTypes: ['combat', 'subBoss', 'shop'],
  pickFootprint: (cellX, cellZ, pitch) => 1,
  build(level, room) {
    const d = _dims(room);
    const doors = _doorCenters(level, room);
    const ewDoors = doors.east != null || doors.west != null;
    const nsDoors = doors.north != null || doors.south != null;
    // Need at least one axis CLEAR of doors so the divider can run along it
    // without overlapping an outer door gap. If both axes have doors, any
    // full-span divider risks a door line — degrade to rect.
    if (ewDoors && nsDoors) return rectShape.build(level, room);

    _addRectPerimeter(level, room);
    _addCornerPillars(level, room);

    const halfGap = DOOR_WIDTH / 2;
    // Divider runs perpendicular to the door axis. Doors on E/W (traffic
    // flows along X) → divider is a VERTICAL wall at cx splitting E/W bays.
    // Doors on N/S (traffic along Z) → divider is HORIZONTAL at cz.
    // No doors at all → default to a vertical divider.
    const dividerVertical = !nsDoors;   // true → wall along Z at x=cx
    if (dividerVertical) {
      // Vertical divider at x = cx, gap centered at z = cz.
      const topFrom = d.minZ, topTo = d.cz - halfGap;
      const botFrom = d.cz + halfGap, botTo = d.maxZ;
      if (topTo > topFrom + 0.05) {
        level._addObstacle(d.cx, WALL_HEIGHT / 2, (topFrom + topTo) / 2,
          WALL_THICK, WALL_HEIGHT, topTo - topFrom, level._outerWallColor());
      }
      if (botTo > botFrom + 0.05) {
        level._addObstacle(d.cx, WALL_HEIGHT / 2, (botFrom + botTo) / 2,
          WALL_THICK, WALL_HEIGHT, botTo - botFrom, level._outerWallColor());
      }
      const wb = [
        _box(d.minX, d.minZ, d.cx, d.maxZ),   // west bay (full)
        _box(d.cx, d.minZ, d.maxX, d.maxZ),   // east bay (full)
        // connector through the gap — overlaps both bays at center
        _box(d.cx - WALL_THICK, d.cz - halfGap, d.cx + WALL_THICK, d.cz + halfGap),
      ];
      return { walls: [], walkableBounds: wb, props: [] };
    } else {
      // Horizontal divider at z = cz, gap centered at x = cx.
      const leftFrom = d.minX, leftTo = d.cx - halfGap;
      const rightFrom = d.cx + halfGap, rightTo = d.maxX;
      if (leftTo > leftFrom + 0.05) {
        level._addObstacle((leftFrom + leftTo) / 2, WALL_HEIGHT / 2, d.cz,
          leftTo - leftFrom, WALL_HEIGHT, WALL_THICK, level._outerWallColor());
      }
      if (rightTo > rightFrom + 0.05) {
        level._addObstacle((rightFrom + rightTo) / 2, WALL_HEIGHT / 2, d.cz,
          rightTo - rightFrom, WALL_HEIGHT, WALL_THICK, level._outerWallColor());
      }
      const wb = [
        _box(d.minX, d.minZ, d.maxX, d.cz),   // north bay (full)
        _box(d.minX, d.cz, d.maxX, d.maxZ),   // south bay (full)
        _box(d.cx - halfGap, d.cz - WALL_THICK, d.cx + halfGap, d.cz + WALL_THICK),
      ];
      return { walls: [], walkableBounds: wb, props: [] };
    }
  },
};

// ----- alcove — rect with a recessed interior niche on a doorless side ---
// Adds two short return walls that bracket a shallow recess against one
// outer wall, reading as a built-in alcove / display niche. The recess is
// PART of the walkable cell (it's open toward the room interior), so it
// only ADDS shape, never subtracts reachable floor. The niche is always
// placed on a side WITHOUT a doorway, and the return walls are short
// (kept well clear of the room center and the perimeter door gaps), so no
// doorway is touched and no region is severed.
//
// CONNECTIVITY: walkableBounds is the full cell footprint (the niche is an
// inward-open pocket of that same footprint — the return walls are thin and
// the recess mouth stays open to the room). The return walls are interior
// stubs flush against the chosen doorless outer wall; the open mouth faces
// the room center which is always reachable. Falls back to rect if every
// side has a doorway.
const alcove = {
  id: 'alcove',
  allowedTypes: ['combat', 'subBoss', 'shop'],
  pickFootprint: (cellX, cellZ, pitch) => 1,
  build(level, room) {
    const d = _dims(room);
    const doors = _doorCenters(level, room);
    const candidates = ['north', 'south', 'east', 'west'].filter(s => doors[s] == null);
    if (!candidates.length) return rectShape.build(level, room);

    _addRectPerimeter(level, room);
    _addCornerPillars(level, room);

    const side = candidates[Math.floor(Math.random() * candidates.length)];
    const depth = 2.6;           // how deep the recess returns reach in
    const nicheHalf = 2.4;       // half-width of the niche mouth
    const isHoriz = (side === 'north' || side === 'south');
    if (isHoriz) {
      // Niche on a north/south wall — two short walls run inward (along Z)
      // from the outer wall, bracketing a centered recess on X.
      const cz = side === 'north' ? d.minZ : d.maxZ;
      const dir = side === 'north' ? 1 : -1;   // +Z into the room from north
      const innerZ = cz + dir * depth;
      const segMidZ = (cz + innerZ) / 2;
      const segLen = depth;
      // Left return wall
      level._addObstacle(d.cx - nicheHalf, WALL_HEIGHT / 2, segMidZ,
        WALL_THICK, WALL_HEIGHT, segLen, level._outerWallColor());
      // Right return wall
      level._addObstacle(d.cx + nicheHalf, WALL_HEIGHT / 2, segMidZ,
        WALL_THICK, WALL_HEIGHT, segLen, level._outerWallColor());
    } else {
      const cx = side === 'east' ? d.maxX : d.minX;
      const dir = side === 'east' ? -1 : 1;    // into the room
      const innerX = cx + dir * depth;
      const segMidX = (cx + innerX) / 2;
      const segLen = depth;
      level._addObstacle(segMidX, WALL_HEIGHT / 2, d.cz - nicheHalf,
        segLen, WALL_HEIGHT, WALL_THICK, level._outerWallColor());
      level._addObstacle(segMidX, WALL_HEIGHT / 2, d.cz + nicheHalf,
        segLen, WALL_HEIGHT, WALL_THICK, level._outerWallColor());
    }
    // Cosmetic floor border to dress the niche read.
    if (Math.random() < 0.5) _addFloorBorder(level, room);
    // walkableBounds — full cell. The niche is an inward-open pocket of the
    // same footprint; the recess mouth faces room center (always reachable),
    // and the return walls are thin stubs that don't sever any region.
    return {
      walls: [],
      walkableBounds: [_box(d.minX, d.minZ, d.maxX, d.maxZ)],
      props: [],
    };
  },
};

// ----- hexHall — twin chamfered corners on ONE doorless edge -------------
// A lighter, distinct cousin of rotunda: instead of chamfering all four
// corners, it bevels the TWO corners that share a single doorless outer
// edge, giving that end a hexagonal / bay-window read while the rest of the
// room stays rectangular. Cheaper + visually different from both lShape
// (single right-angle notch) and rotunda (full octagon). Uses the same
// solid-corner-block + diagonal-accent technique rotunda uses so the
// collision matches the visual exactly.
//
// CONNECTIVITY: the two chamfered corners share ONE edge that has NO
// doorway (we only pick an edge whose own door is null AND whose two
// flanking perpendicular sides' doors don't fall inside the chamfered
// span). walkableBounds is the full cell minus the two corner cut boxes,
// decomposed into axis-aligned boxes that still contain every doorway and
// connect through the room center. Falls back to rect if no safe edge.
const hexHall = {
  id: 'hexHall',
  allowedTypes: ['combat', 'subBoss', 'shop'],
  pickFootprint: (cellX, cellZ, pitch) => 1,
  build(level, room) {
    const d = _dims(room);
    const doors = _doorCenters(level, room);
    const chamfer = Math.min(d.w, d.d) * 0.22;   // ~4m corner cut

    // Candidate edges: pick a doorless outer edge. Its two flanking
    // perpendicular sides must not have a door that lands within `chamfer`
    // of the shared corner (else the chamfer block would seal that door).
    // Build the list of safe edges.
    const edges = [
      { side: 'north', cz: d.minZ, perp: ['west', 'east'],
        // corners at (minX,minZ) and (maxX,minZ)
        cuts: [{ x: d.minX, z: d.minZ, dx: 1, dz: 1 },
               { x: d.maxX, z: d.minZ, dx: -1, dz: 1 }] },
      { side: 'south', cz: d.maxZ, perp: ['west', 'east'],
        cuts: [{ x: d.minX, z: d.maxZ, dx: 1, dz: -1 },
               { x: d.maxX, z: d.maxZ, dx: -1, dz: -1 }] },
      { side: 'west', cx: d.minX, perp: ['north', 'south'],
        cuts: [{ x: d.minX, z: d.minZ, dx: 1, dz: 1 },
               { x: d.minX, z: d.maxZ, dx: 1, dz: -1 }] },
      { side: 'east', cx: d.maxX, perp: ['north', 'south'],
        cuts: [{ x: d.maxX, z: d.minZ, dx: -1, dz: 1 },
               { x: d.maxX, z: d.maxZ, dx: -1, dz: -1 }] },
    ];
    const isHorizEdge = (e) => e.side === 'north' || e.side === 'south';
    const safe = edges.filter(e => {
      if (doors[e.side] != null) return false;             // edge itself has a door
      // Check flanking perpendicular door positions don't fall in the
      // chamfered band near either shared corner.
      for (const p of e.perp) {
        const dc = doors[p];
        if (dc == null) continue;
        if (isHorizEdge(e)) {
          // perp sides are west/east (vertical walls); their door is a Z
          // coord. The chamfer near this horizontal edge occupies
          // z within `chamfer` of e.cz on those vertical walls.
          if (Math.abs(dc - e.cz) < chamfer + DOOR_WIDTH / 2) return false;
        } else {
          // perp sides are north/south (horizontal walls); their door is
          // an X coord. The chamfer occupies x within `chamfer` of e.cx.
          if (Math.abs(dc - e.cx) < chamfer + DOOR_WIDTH / 2) return false;
        }
      }
      return true;
    });
    if (!safe.length) return rectShape.build(level, room);
    const edge = safe[Math.floor(Math.random() * safe.length)];

    _addRectPerimeter(level, room);
    _addCornerPillars(level, room);

    // Build the two chamfer corners as solid blocks + diagonal accents,
    // mirroring rotunda's collision-matches-visual approach.
    for (const c of edge.cuts) {
      const minXc = Math.min(c.x, c.x + c.dx * chamfer);
      const maxXc = Math.max(c.x, c.x + c.dx * chamfer);
      const minZc = Math.min(c.z, c.z + c.dz * chamfer);
      const maxZc = Math.max(c.z, c.z + c.dz * chamfer);
      const cornerW = maxXc - minXc;
      const cornerD = maxZc - minZc;
      const blockMat = sharedMaterial({
        color: level._outerWallColor(), roughness: 0.85,
      });
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(cornerW, WALL_HEIGHT, cornerD), blockMat);
      block.position.set((minXc + maxXc) / 2, WALL_HEIGHT / 2, (minZc + maxZc) / 2);
      block.castShadow = false;
      block.receiveShadow = true;
      block.userData.collisionXZ = { minX: minXc, maxX: maxXc, minZ: minZc, maxZ: maxZc };
      block.userData.isHexChamfer = true;
      block.matrixAutoUpdate = false;
      block.updateMatrix();
      level.scene.add(block);
      level.obstacles.push(block);
      level._dirtySolid();

      // Diagonal accent over the block face — reads as a beveled corner.
      const length = chamfer * Math.SQRT2;
      const midX = c.x + c.dx * chamfer / 2;
      const midZ = c.z + c.dz * chamfer / 2;
      const accentMat = sharedMaterial({
        color: level._outerWallColor(), roughness: 0.6, metalness: 0.05,
      });
      const accent = new THREE.Mesh(
        new THREE.BoxGeometry(length, WALL_HEIGHT - 0.04, 0.18), accentMat);
      accent.position.set(midX, WALL_HEIGHT / 2, midZ);
      accent.rotation.y = Math.atan2(-c.dz, c.dx) - Math.PI / 4;
      accent.castShadow = false;
      accent.receiveShadow = true;
      accent.userData.kind = 'hex-chamfer-accent';
      if (level.decorations) level.decorations.push(accent);
      level.scene.add(accent);
    }

    // walkableBounds — full cell minus the two chamfer corner boxes,
    // decomposed into axis-aligned boxes. The two cuts sit on one edge,
    // so the remaining floor is: a full-width band away from that edge,
    // plus the un-chamfered middle strip along the chamfered edge.
    let wb;
    if (isHorizEdge(edge)) {
      // chamfers at the two X-extremes of edge.cz (a north or south edge).
      // Middle (un-cut) span of the chamfered edge band: from minX+chamfer
      // to maxX-chamfer, full depth of the band.
      const edgeBand = edge.side === 'north'
        ? _box(d.minX + chamfer, d.minZ, d.maxX - chamfer, d.minZ + chamfer)
        : _box(d.minX + chamfer, d.maxZ - chamfer, d.maxX - chamfer, d.maxZ);
      // Big rectangle covering everything away from the chamfered edge.
      const body = edge.side === 'north'
        ? _box(d.minX, d.minZ + chamfer, d.maxX, d.maxZ)
        : _box(d.minX, d.minZ, d.maxX, d.maxZ - chamfer);
      wb = [body, edgeBand];
    } else {
      const edgeBand = edge.side === 'west'
        ? _box(d.minX, d.minZ + chamfer, d.minX + chamfer, d.maxZ - chamfer)
        : _box(d.maxX - chamfer, d.minZ + chamfer, d.maxX, d.maxZ - chamfer);
      const body = edge.side === 'west'
        ? _box(d.minX + chamfer, d.minZ, d.maxX, d.maxZ)
        : _box(d.minX, d.minZ, d.maxX - chamfer, d.maxZ);
      wb = [body, edgeBand];
    }
    return { walls: [], walkableBounds: wb, props: [] };
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
  twoBay,
  alcove,
  hexHall,
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
