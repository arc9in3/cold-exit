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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sharedMaterial, disposeIfNotShared } from './material_pool.js';

export const WALL_HEIGHT = 3.0;
export const WALL_THICK = 1.2;
export const DOOR_WIDTH = 4;

// ---------------------------------------------------------------------------
// Architectural wall profile — shared, instanced unit geometry.
//
// The wall instancer used to feed every wall a plain THREE.BoxGeometry(1,1,1)
// scaled per-instance. That reads as a featureless extruded slab at the iso
// camera. This builds a richer SHARED profile — a baseboard lip at the floor,
// a slightly inset panel face on the long sides, and a chamfered cornice cap
// at the top — and bakes it into ONE BufferGeometry normalised to the exact
// same 1×1×1 footprint (centered at the origin, spanning -0.5..0.5 on every
// axis). Because the footprint is unchanged, the existing per-instance
// (translation + scale = w,h,d) matrices keep mapping correctly, the
// collision AABB (which is computed independently in level._addObstacle from
// position+dims) still lines up with the visual, and the instancer stays one
// InstancedMesh per color.
//
// IMPORTANT invariants this profile preserves:
//   * Outer extent is still exactly [-0.5, 0.5] on X/Y/Z. The baseboard and
//     cornice bands span the FULL footprint so the wall still reads solid at
//     the floor line and the top line (no gaps where collision is). Only the
//     mid-shaft face is inset, and only by a hair (~4% of thickness), so the
//     silhouette is unchanged — it just gains a panel shadow line.
//   * Vertical band proportions are keyed off the unit height. Every wall in
//     this game is WALL_HEIGHT (3.0m) tall, so after the per-instance Y scale
//     the baseboard / cornice land at consistent WORLD heights (~0.27m base,
//     ~0.24m cornice) across all walls.
//   * It is a single geometry shared by every instance (merged once, cached).
//
// Proportions (in unit space, full height = 1.0):
//   base band   : y ∈ [-0.50, -0.41]  full 1.0 footprint (baseboard lip)
//   shaft       : y ∈ [-0.41,  0.41]  inset face (0.92 on the thin axis)
//   cornice     : y ∈ [ 0.41,  0.50]  full footprint, top edge chamfered in
const PROFILE = {
  baseTop:    -0.41,   // top of the baseboard band
  shaftTop:    0.41,   // top of the main shaft / bottom of the cornice
  faceInset:   0.04,   // how far the shaft face pulls in from 0.5 (per side)
  corniceChamfer: 0.03, // how far the very top edge pulls in (the bevel)
};

let _wallProfileGeom = null;

// Build (once) and return the shared architectural wall profile geometry.
// Normalised to the unit cube footprint; safe to feed straight into the
// wall InstancedMesh in place of BoxGeometry(1,1,1).
export function wallProfileGeometry() {
  if (_wallProfileGeom) return _wallProfileGeom;
  const half = 0.5;
  const { baseTop, shaftTop, faceInset, corniceChamfer } = PROFILE;
  const parts = [];

  // Helper — an axis-aligned box spanning [x0,x1]×[y0,y1]×[z0,z1].
  const box = (x0, x1, y0, y1, z0, z1) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return g;
  };

  // 1. Baseboard lip — full footprint, bottom band. Reads as a plinth.
  parts.push(box(-half, half, -half, baseTop, -half, half));

  // 2. Main shaft — full height between base and cornice, but the face is
  //    pulled in slightly on BOTH planar axes so the wall gets a recessed
  //    panel read (a thin shadow line at the base + cornice reveals).
  const s = half - faceInset;
  parts.push(box(-s, s, baseTop, shaftTop, -s, s));

  // 3. Cornice base — full footprint band at the top (caps the shaft, gives
  //    the wall a defined top edge / crown).
  parts.push(box(-half, half, shaftTop, half - corniceChamfer, -half, half));

  // 4. Cornice chamfer — the very top edge, pulled in by `corniceChamfer`
  //    on the planar axes, so the top reads as a beveled crown rather than a
  //    sharp slab edge. Still inside the unit footprint (extent never exceeds
  //    0.5), so collision/footprint invariants hold.
  const c = half - corniceChamfer;
  parts.push(box(-c, c, half - corniceChamfer, half, -c, c));

  let merged = mergeGeometries(parts, false);
  // Defensive: if the merge ever fails (attribute mismatch), fall back to a
  // plain unit cube so walls still render solid rather than vanishing.
  if (!merged) {
    for (const p of parts) p.dispose();
    merged = new THREE.BoxGeometry(1, 1, 1);
  } else {
    for (const p of parts) p.dispose();
  }
  merged.userData = merged.userData || {};
  // Stamp matches the dispose-skip flag used everywhere else for shared geo
  // (PROJECT.md critical interaction): never dispose this from a traversal.
  merged.userData.sharedRigGeom = true;
  _wallProfileGeom = merged;
  return _wallProfileGeom;
}

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
  const mat = sharedMaterial({ color: 0x5a4a3a, roughness: 0.9 });
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
  const mat = sharedMaterial({ color: 0x6a6a72, roughness: 0.6 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, railHeight, d), mat);
  mesh.position.set(cx, railHeight / 2, cz);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.collisionXZ = {
    minX: cx - w / 2, maxX: cx + w / 2,
    minZ: cz - d / 2, maxZ: cz + d / 2,
  };
  mesh.userData.isRailing = true;
  // Phase M step 6 — railings double as fall guards. The visible
  // rail mesh blocks player movement; tagging isFallGuard lets
  // debug tooling list every fall-defending segment in one query.
  mesh.userData.isFallGuard = true;
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

// Phase M step 6 — invisible fall guard. Thin (WALL_THICK) collision
// wall, 0.6m tall, that blocks player movement off a raised edge but
// renders nothing. Used along platform / catwalk / skybridge / parapet
// edges so the player can't slip off into the void. visible=false so
// the wall doesn't render; collisionXZ is the same AABB walls use.
// Tag userData.isFallGuard = true so debug tooling + the runtime
// fall-respawn watcher can identify these segments.
export function addFallGuard(level, x1, z1, x2, z2) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  if (length < 0.1) return null;
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const guardH = 0.6;
  const guardThick = WALL_THICK * 0.5;
  const isHoriz = Math.abs(dx) >= Math.abs(dz);
  const w = isHoriz ? length : guardThick;
  const d = isHoriz ? guardThick : length;
  // Pooled material — won't ever render (visible=false) but the
  // BoxGeometry still participates in raycasts unless we exclude
  // it. We don't want bullets to ricochet off the invisible guard
  // either, so wire it as a collision-only proxy with a non-shadow,
  // transparent material in case someone toggles visible=true for
  // debugging.
  const mat = sharedMaterial({ color: 0xff00ff, roughness: 0.9 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, guardH, d), mat);
  mesh.position.set(cx, guardH / 2, cz);
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.collisionXZ = {
    minX: cx - w / 2, maxX: cx + w / 2,
    minZ: cz - d / 2, maxZ: cz + d / 2,
  };
  mesh.userData.isFallGuard = true;
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
  const mat = sharedMaterial({ color: 0x4a4a52, roughness: 0.85 });
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
  // Phase M step 6 — fall guards on raised platforms only. The
  // current addPlatform models the whole platform as a solid box
  // (collision AABB == full footprint), so the player can't walk
  // ON the top in regular play and a perimeter-edge guard would
  // just inflate the side bumpers. We skip guards on tall opaque
  // platforms; only callers that produce walkable raised surfaces
  // (catwalks via Pass 2 walkability) need to call addFallGuard
  // explicitly along their edges.
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
  // Material may be pooled (shared across all walls of the same color);
  // disposeIfNotShared skips those so other walls aren't corrupted.
  if (wall.material) disposeIfNotShared(wall.material);
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
