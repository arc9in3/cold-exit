// level_geom.js — geometry primitives for shape templates.
//
// These helpers wrap level._addObstacle / scene mesh construction
// for shape-specific geometry (ramps, railings, platforms, arch
// openings). They're separated from level.js so the shape system
// has a stable API surface.
//
// Constants are re-exported here so level_shapes.js doesn't need to
// import from level.js (avoids a circular dependency since level.js
// imports level_shapes which would import level.js).

import * as THREE from 'three';

export const WALL_HEIGHT = 3.0;
export const WALL_THICK = 1.2;
export const DOOR_WIDTH = 4;

// Ramp — sloped walkable surface from (x1, z1) at floor height to
// (x2, z2) at `height`. We approximate with a slanted box (rotated
// around the perpendicular horizontal axis). The collision proxy is
// the ramp's AABB; AI is not yet aware of slope walking, so we mark
// the proxy as walkableSlope=true but treat it as an obstacle for
// ground AI. The player walking up a ramp uses the engine's existing
// collision-resolution pass.
//
// Returns { mesh, walkableSlope } where walkableSlope is the
// underlying slanted plane if the caller needs to register it
// elsewhere.
export function addRamp(level, x1, z1, x2, z2, height, width = 2.0) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  if (length < 0.1) return { mesh: null, walkableSlope: null };
  const yaw = Math.atan2(dz, dx);
  const pitch = Math.atan2(height, length);
  // Geometry: a thin slab the length of the ramp, oriented along +X
  // before rotation. We rotate yaw around Y to align with the x1→x2
  // direction, then pitch around the local Z to tilt up.
  const geom = new THREE.BoxGeometry(length, 0.2, width);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x5a4a3a, roughness: 0.9,
  });
  const mesh = new THREE.Mesh(geom, mat);
  // Position the ramp's center at the midpoint of (x1, z1) and (x2, z2),
  // raised by half the height so the low end sits at y=0.
  mesh.position.set((x1 + x2) / 2, height / 2, (z1 + z2) / 2);
  mesh.rotation.order = 'YXZ';
  mesh.rotation.y = yaw;
  mesh.rotation.z = -pitch;     // tilt up toward (x2, z2) end
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.collisionXZ = {
    minX: Math.min(x1, x2) - width / 2,
    maxX: Math.max(x1, x2) + width / 2,
    minZ: Math.min(z1, z2) - width / 2,
    maxZ: Math.max(z1, z2) + width / 2,
  };
  mesh.userData.isRamp = true;
  mesh.userData.walkableSlope = true;
  // Ramps should NOT block player movement (the player walks up
  // them). Setting collisionXZ to null preserves the behavior used
  // by other walk-through props. The mesh stays a raycast target
  // for projectiles.
  mesh.userData.collisionXZ = null;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  level.scene.add(mesh);
  level.obstacles.push(mesh);
  level._dirtySolid();
  return { mesh, walkableSlope: mesh };
}

// Railing — chest-high (1.0m) thin rail. Cover-shootable: the
// raycast obstacle stops bullets but the player walks around (we
// don't null collision because then the player could walk through
// the railing). The visual is a simple thin slab so the player can
// clearly see it as "edge of platform".
export function addRailing(level, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  if (length < 0.1) return null;
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const railHeight = 1.0;
  const railThick = 0.15;
  // Orient the rail along the X axis if the segment is mostly
  // horizontal, else along Z. (No rotation — keeps collision AABB
  // axis-aligned.)
  const isHoriz = Math.abs(dx) >= Math.abs(dz);
  const w = isHoriz ? length : railThick;
  const d = isHoriz ? railThick : length;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x6a6a72, roughness: 0.6,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, railHeight, d), mat);
  mesh.position.set(cx, railHeight / 2, cz);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.collisionXZ = {
    minX: cx - w / 2, maxX: cx + w / 2,
    minZ: cz - d / 2, maxZ: cz + d / 2,
  };
  mesh.userData.isRailing = true;
  // Low cover hint for the aim system — short obstacle, treated as
  // crouchable cover.
  mesh.userData.isLowCover = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  level.scene.add(mesh);
  level.obstacles.push(mesh);
  level._dirtySolid();
  return mesh;
}

// Platform — raised flat surface. Builds a top mesh + four side
// walls (so the player can't walk through the platform's vertical
// faces). The top is purely cosmetic / decorative — AI walks around
// the AABB the same as any other obstacle. Pass 2 will add proper
// upper-floor walkability.
export function addPlatform(level, bbox, height) {
  const { minX, minZ, maxX, maxZ } = bbox;
  const w = maxX - minX;
  const d = maxZ - minZ;
  if (w <= 0 || d <= 0) return null;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  // Single box from y=0 to y=height — engine-friendly: one mesh, one
  // collision AABB. Sides are covered because it's a solid box.
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4a4a52, roughness: 0.85,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), mat);
  mesh.position.set(cx, height / 2, cz);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.collisionXZ = {
    minX, maxX, minZ, maxZ,
  };
  mesh.userData.isPlatform = true;
  mesh.userData.platformHeight = height;
  // Treat as low cover when height < 1.5m so the aim system handles
  // crouching shots correctly.
  if (height < WALL_HEIGHT / 2) mesh.userData.isLowCover = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  level.scene.add(mesh);
  level.obstacles.push(mesh);
  level._dirtySolid();
  return mesh;
}

// Arch opening — given an existing wall mesh and a desired gap
// width, replace it with two stub walls flanking a centered gap.
// The original mesh is removed from the scene + obstacles list.
//
// Used for cross / tJunction openings where shape-internal walls
// need a passage. NOT used on perimeter walls — those already get
// door gaps via _buildRoomPerimeter.
//
// archH is currently informational (no overhead arch geometry); we
// just produce the two stub walls.
export function addArchOpening(level, wall, gapW, archH) {
  if (!wall || !wall.userData) return [];
  const { minX, maxX, minZ, maxZ } = wall.userData.collisionXZ || {};
  if (minX == null) return [];
  const w = maxX - minX;
  const d = maxZ - minZ;
  const isHoriz = w >= d;
  // Remove the original wall.
  level.scene.remove(wall);
  if (wall.geometry) wall.geometry.dispose();
  if (wall.material) wall.material.dispose();
  const idx = level.obstacles.indexOf(wall);
  if (idx >= 0) level.obstacles.splice(idx, 1);
  level._dirtySolid();

  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const halfGap = gapW / 2;
  const stubs = [];
  if (isHoriz) {
    const leftFrom = minX, leftTo = cx - halfGap;
    const rightFrom = cx + halfGap, rightTo = maxX;
    if (leftTo > leftFrom + 0.05) {
      stubs.push(level._addObstacle(
        (leftFrom + leftTo) / 2, WALL_HEIGHT / 2, cz,
        leftTo - leftFrom, WALL_HEIGHT, d, level._outerWallColor(),
      ));
    }
    if (rightTo > rightFrom + 0.05) {
      stubs.push(level._addObstacle(
        (rightFrom + rightTo) / 2, WALL_HEIGHT / 2, cz,
        rightTo - rightFrom, WALL_HEIGHT, d, level._outerWallColor(),
      ));
    }
  } else {
    const topFrom = minZ, topTo = cz - halfGap;
    const botFrom = cz + halfGap, botTo = maxZ;
    if (topTo > topFrom + 0.05) {
      stubs.push(level._addObstacle(
        cx, WALL_HEIGHT / 2, (topFrom + topTo) / 2,
        w, WALL_HEIGHT, topTo - topFrom, level._outerWallColor(),
      ));
    }
    if (botTo > botFrom + 0.05) {
      stubs.push(level._addObstacle(
        cx, WALL_HEIGHT / 2, (botFrom + botTo) / 2,
        w, WALL_HEIGHT, botTo - botFrom, level._outerWallColor(),
      ));
    }
  }
  return stubs;
}
