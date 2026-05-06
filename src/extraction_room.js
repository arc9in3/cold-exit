// Extraction-room generator — replaces the old "ring on the floor of
// the boss room" exit marker with a proper exfil chamber attached to
// the boss room.
//
// Contract (matches the design doc):
//   - Pick a wall on `bossRoom`. Ideally the wall OPPOSITE the entry
//     from the chain (so the player walks "deeper" to extract). If we
//     can't tell which wall is the entry, pick any wall the boss room
//     doesn't already use for a neighbor.
//   - Build a 12×12 small room beyond that wall. Walls + props are added
//     to `level.obstacles` so AI can't walk through them.
//   - The connecting wall has a LOCKED door panel (uses the same locked-
//     door pattern the keycard system uses — `userData.collisionXZ` is
//     the locked solid box; `revealExit()` calls _openDoor to clear it).
//   - Inside the chamber: ONE of the themed extraction sets, picked from
//     `level.theme` family.
//
// Returns { room, doorMesh, exitBounds } so the caller can stash refs
// for `revealExit()` to flip the door + reveal the room visuals.

import * as THREE from 'three';
import { buildProp } from './props.js';
import { sharedMaterial } from './material_pool.js';

// Same constants as level.js — kept in sync. If level.js ever tweaks
// these, this file needs to follow. They're const there too, so this
// stays trivially in sync.
const ROOM_W = 18;       // matches level.js — used to align exit cell pitch
const WALL_THICK = 1.2;
const WALL_HEIGHT = 3.0;
const DOOR_WIDTH = 4;
const FULL_WALL_COLOR = 0x2a2e38;     // theme tint applied at runtime via _addObstacle
const OUTER_WALL_COLOR = 0x1a1e24;
const DOOR_COLOR = 0x8a3a2a;

// Map level theme slot → extraction kind. The level theme has a
// `name` (e.g. "Parking Garage") which we don't use; we sniff the
// wall colour family instead, since that's what's actually on the
// theme object. Industrial / dark = service-elevator + evac-van;
// rooftop = helo-pad / chopper-lz; sewer-y dark = sewer-grate;
// classic = evac-van.
//
// Falls back to evac-van if we can't classify.
function pickExtractionKind(theme) {
  if (!theme || typeof theme !== 'object') return 'evac-van';
  const name = (theme.name || '').toLowerCase();
  if (name.includes('rooftop')) return Math.random() < 0.5 ? 'helo-pad' : 'chopper-lz';
  if (name.includes('garage'))  return Math.random() < 0.6 ? 'service-elevator' : 'evac-van';
  if (name.includes('night'))   return 'service-elevator';
  if (name.includes('penthouse')) return Math.random() < 0.5 ? 'helo-pad' : 'service-elevator';
  if (name.includes('continental')) return 'evac-van';
  // Default — never sewer-grate by default (it's a player-falls-through
  // hazard that the rest of the game doesn't yet handle); reserved for
  // future sewer-themed levels that opt in explicitly via theme.exitKind.
  if (theme.exitKind) return theme.exitKind;
  return 'evac-van';
}

// Pick a wall direction for the extraction door. Prefer the wall
// OPPOSITE the chain entry; fall back to any wall the boss isn't
// already using for a neighbor.
//
// Reads `bossRoom.neighbors` — the chain entry is whichever neighbor
// has the smaller id (id 0 = start). Skips walls already used for a
// connection because the perimeter builder put a doorway gap there
// already and we'd be doubling up.
function pickExitWall(bossRoom) {
  const used = new Set((bossRoom.neighbors || []).map(n => n.dir));
  const opposite = { east: 'west', west: 'east', north: 'south', south: 'north' };

  // Find the entry neighbor (lowest-id neighbour, since the chain
  // builds left-to-right with id increasing).
  let entryDir = null;
  let entryId = Infinity;
  for (const n of bossRoom.neighbors || []) {
    if (n.otherId < entryId) {
      entryId = n.otherId;
      entryDir = n.dir;
    }
  }

  // Preferred = opposite of entry, if free.
  if (entryDir) {
    const want = opposite[entryDir];
    if (want && !used.has(want)) return want;
  }
  // Fallback — any unused cardinal.
  for (const d of ['north', 'east', 'south', 'west']) {
    if (!used.has(d)) return d;
  }
  // Worst case — every wall has a door. We bail; caller should skip
  // creating an extraction room (very rare; boss is always at the
  // end of the chain so it has 1 entry door, sometimes 1 sub-shop
  // branch, never all 4).
  return null;
}

// Build the small extraction room. Attaches to `bossRoom`'s wall on
// `dir`, sized 12×12 (smaller than a normal 18×18 cell so it reads as
// a back-of-house chamber). Walls + door + props all hide initially —
// `level.exitRoom._reveal()` flips them visible when the boss dies.
//
// Why we hide walls instead of "build later" — the wall obstacles need
// to be in `level.obstacles` from the start so AI navigation + line-of-
// sight take them into account. Otherwise an enemy could path "through"
// the back wall while the player can't, breaking sneak/cover gameplay.
export function buildExtractionRoom(level, bossRoom, opts = {}) {
  const dir = opts.dir || pickExitWall(bossRoom);
  if (!dir) return null;

  const b = bossRoom.bounds;
  const ROOM_SIZE = 12;
  const half = ROOM_SIZE / 2;

  // Position the new room flush against bossRoom on the picked wall.
  // The connecting wall (door wall) is the side facing bossRoom.
  let cx, cz;
  if (dir === 'east') { cx = b.maxX + WALL_THICK + half; cz = (b.minZ + b.maxZ) / 2; }
  else if (dir === 'west') { cx = b.minX - WALL_THICK - half; cz = (b.minZ + b.maxZ) / 2; }
  else if (dir === 'north') { cx = (b.minX + b.maxX) / 2; cz = b.minZ - WALL_THICK - half; }
  else /* south */ { cx = (b.minX + b.maxX) / 2; cz = b.maxZ + WALL_THICK + half; }

  const bounds = {
    minX: cx - half, maxX: cx + half,
    minZ: cz - half, maxZ: cz + half,
  };

  // Track every visible mesh + every obstacle proxy this room owns so
  // we can flip them visible together when revealExit fires.
  const ownedVisuals = [];   // mesh refs to flip .visible
  const ownedObstacles = []; // collision proxies to flip + un-null

  // Helper — like level._addObstacle but registers the result on this
  // exit room's owned-list AND tags userData.kind for the smoke harness.
  // We DON'T use level._addObstacle directly because we want fine
  // control over visibility (initially false) and the kind tag.
  const addWall = (x, y, z, w, h, d, isOuter, kind = 'extraction-wall') => {
    const color = isOuter ? OUTER_WALL_COLOR : FULL_WALL_COLOR;
    const matObj = sharedMaterial({ color, roughness: 0.85 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matObj);
    mesh.position.set(x, y, z);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.collisionXZ = {
      minX: x - w / 2, maxX: x + w / 2,
      minZ: z - d / 2, maxZ: z + d / 2,
    };
    mesh.userData.kind = kind;
    mesh.userData.isExtractionWall = true;
    if (y + h / 2 < WALL_HEIGHT / 2) mesh.userData.isLowCover = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;     // hidden until revealExit
    level.scene.add(mesh);
    level.obstacles.push(mesh);
    ownedVisuals.push(mesh);
    ownedObstacles.push(mesh);
    return mesh;
  };

  // ---- Walls --------------------------------------------------------
  // The wall facing bossRoom is the door wall. `dir` here is the side
  // of bossRoom the chamber sits on (e.g. dir='east' means the chamber
  // is east of boss, so its facing wall is its WEST wall). The
  // door-wall side is therefore OPP[dir]. Earlier this code used
  // `dir` directly for the flanking-segment branch, which put the
  // door gap on the FAR side of the chamber; the boss-facing wall
  // ended up sealed and the chamber appeared inaccessible.
  const OPP = { east: 'west', west: 'east', north: 'south', south: 'north' };
  const doorWallSide = OPP[dir];
  const halfGap = DOOR_WIDTH / 2;

  // ---- Floor patch --------------------------------------------------
  // Distinct EXIT-green accent so the chamber reads as the goal once
  // it reveals. Hidden until revealExit flips it visible alongside
  // the walls + prop. Inset 0.3m so the patch doesn't poke under the
  // perimeter walls; sized to the chamber's interior.
  {
    const baseHex = level.theme?.floor ?? 0x2a2a2e;
    const fpW = ROOM_SIZE - 0.6;
    const fpD = ROOM_SIZE - 0.6;
    const fpMat = sharedMaterial({
      color: baseHex,
      emissive: 0x00ff88,            // EXIT_COLOR — pops against any biome
      emissiveIntensity: 0.22,
      roughness: 0.85,
      metalness: 0.05,
    });
    const fpMesh = new THREE.Mesh(new THREE.PlaneGeometry(fpW, fpD), fpMat);
    fpMesh.rotation.x = -Math.PI / 2;
    fpMesh.position.set(cx, 0.012, cz);     // slightly above the per-room patches
    fpMesh.receiveShadow = true;
    fpMesh.userData.kind = 'room-floor';
    fpMesh.userData.roomId = -1;
    fpMesh.matrixAutoUpdate = false;
    fpMesh.updateMatrix();
    fpMesh.visible = false;                 // revealed by reveal()
    level.scene.add(fpMesh);
    level.decorations.push(fpMesh);
    ownedVisuals.push(fpMesh);
  }
  // North wall (minZ).
  if (doorWallSide !== 'north') {
    addWall(cx, WALL_HEIGHT / 2, bounds.minZ,
      ROOM_SIZE, WALL_HEIGHT, WALL_THICK, true);
  } else {
    // door wall — two flanking segments + door panel
    const leftLen  = (ROOM_SIZE / 2) - halfGap;
    const rightLen = (ROOM_SIZE / 2) - halfGap;
    if (leftLen > 0.05) addWall(bounds.minX + leftLen / 2, WALL_HEIGHT / 2, bounds.minZ,
      leftLen, WALL_HEIGHT, WALL_THICK, true);
    if (rightLen > 0.05) addWall(bounds.maxX - rightLen / 2, WALL_HEIGHT / 2, bounds.minZ,
      rightLen, WALL_HEIGHT, WALL_THICK, true);
  }
  // South wall (maxZ).
  if (doorWallSide !== 'south') {
    addWall(cx, WALL_HEIGHT / 2, bounds.maxZ,
      ROOM_SIZE, WALL_HEIGHT, WALL_THICK, true);
  } else {
    const leftLen  = (ROOM_SIZE / 2) - halfGap;
    const rightLen = (ROOM_SIZE / 2) - halfGap;
    if (leftLen > 0.05) addWall(bounds.minX + leftLen / 2, WALL_HEIGHT / 2, bounds.maxZ,
      leftLen, WALL_HEIGHT, WALL_THICK, true);
    if (rightLen > 0.05) addWall(bounds.maxX - rightLen / 2, WALL_HEIGHT / 2, bounds.maxZ,
      rightLen, WALL_HEIGHT, WALL_THICK, true);
  }
  // East wall (maxX).
  if (doorWallSide !== 'east') {
    addWall(bounds.maxX, WALL_HEIGHT / 2, cz,
      WALL_THICK, WALL_HEIGHT, ROOM_SIZE, true);
  } else {
    const topLen = (ROOM_SIZE / 2) - halfGap;
    const botLen = (ROOM_SIZE / 2) - halfGap;
    if (topLen > 0.05) addWall(bounds.maxX, WALL_HEIGHT / 2, bounds.minZ + topLen / 2,
      WALL_THICK, WALL_HEIGHT, topLen, true);
    if (botLen > 0.05) addWall(bounds.maxX, WALL_HEIGHT / 2, bounds.maxZ - botLen / 2,
      WALL_THICK, WALL_HEIGHT, botLen, true);
  }
  // West wall (minX).
  if (doorWallSide !== 'west') {
    addWall(bounds.minX, WALL_HEIGHT / 2, cz,
      WALL_THICK, WALL_HEIGHT, ROOM_SIZE, true);
  } else {
    const topLen = (ROOM_SIZE / 2) - halfGap;
    const botLen = (ROOM_SIZE / 2) - halfGap;
    if (topLen > 0.05) addWall(bounds.minX, WALL_HEIGHT / 2, bounds.minZ + topLen / 2,
      WALL_THICK, WALL_HEIGHT, topLen, true);
    if (botLen > 0.05) addWall(bounds.minX, WALL_HEIGHT / 2, bounds.maxZ - botLen / 2,
      WALL_THICK, WALL_HEIGHT, botLen, true);
  }

  // ---- Locked door --------------------------------------------------
  // The door sits in the wall facing bossRoom. Same dimensions as a
  // regular door (4m × 1.2m). userData.collisionXZ stays solid until
  // revealExit() flips it via _openDoor.
  let doorX, doorZ, doorW, doorD;
  if (dir === 'east')      { doorX = b.maxX + WALL_THICK / 2; doorZ = bounds.minZ + halfGap + (ROOM_SIZE / 2 - halfGap); doorW = WALL_THICK; doorD = DOOR_WIDTH; doorZ = cz; }
  else if (dir === 'west') { doorX = b.minX - WALL_THICK / 2; doorZ = cz; doorW = WALL_THICK; doorD = DOOR_WIDTH; }
  else if (dir === 'north'){ doorX = cx; doorZ = b.minZ - WALL_THICK / 2; doorW = DOOR_WIDTH; doorD = WALL_THICK; }
  else                     { doorX = cx; doorZ = b.maxZ + WALL_THICK / 2; doorW = DOOR_WIDTH; doorD = WALL_THICK; }

  // Boss-exit doors look + behave like the keycard system's doors —
  // user request: "for the boss door just use the same door as the
  // colored keycard doors". Distinct exit-gold tint with a soft
  // emissive glow so it reads as THE boss exit at a glance, not a
  // regular locked door. Auto-opens when no boss is alive on the
  // floor (see updateBossSealRelease in main.js).
  //
  // Own-material clone is critical (same reason as _buildDoor in
  // level.js): _openDoor mutates color + opacity, and a shared
  // material would leak that across every door in the level.
  const EXIT_DOOR_COLOR = 0xe8b22a;       // keycard-yellow family, slightly warmer
  const doorMat = sharedMaterial({
    color: EXIT_DOOR_COLOR,
    roughness: 0.55,
    metalness: 0.20,
    emissive: 0x6a3d05,
    emissiveIntensity: 0.45,
  }).clone();
  const doorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(doorW, WALL_HEIGHT, doorD),
    doorMat,
  );
  doorMesh.position.set(doorX, WALL_HEIGHT / 2, doorZ);
  doorMesh.castShadow = false;
  doorMesh.receiveShadow = true;
  doorMesh.userData.collisionXZ = {
    minX: doorX - doorW / 2, maxX: doorX + doorW / 2,
    minZ: doorZ - doorD / 2, maxZ: doorZ + doorD / 2,
  };
  // Mirror the keycard-locked door pattern: collisionXZ is solid; the
  // boss-clear path calls level._openDoor(doorMesh) to flatten + null
  // collision. lockedCollisionXZ is captured here so re-locking (if
  // anything ever does) can restore it.
  doorMesh.userData.lockedCollisionXZ = { ...doorMesh.userData.collisionXZ };
  doorMesh.userData.isDoor = true;
  doorMesh.userData.isExtractionDoor = true;
  doorMesh.userData.kind = 'extraction-door';
  doorMesh.userData.cx = doorX;
  doorMesh.userData.cz = doorZ;
  // The door mesh is visible initially — players can SEE the door is
  // locked from the boss room side, but can't walk through it. Walls
  // around the extraction room are hidden so the chamber doesn't show
  // through the corner where its perimeter would extend past the boss
  // room's outer wall.
  // Decision: door mesh visible = true (the player should know
  // there's something there), but room interior hidden.
  doorMesh.matrixAutoUpdate = false;
  doorMesh.updateMatrix();
  level.scene.add(doorMesh);
  level.obstacles.push(doorMesh);
  ownedObstacles.push(doorMesh);

  // ---- Extraction prop ---------------------------------------------
  const kind = pickExtractionKind(level.theme);
  const extractionGroup = new THREE.Group();
  extractionGroup.position.set(cx, 0, cz);
  let extractionPropKind = kind;
  // Build the prop. Each kind is a centerpiece — pinned at room centre
  // and rotated to face the door wall (so the player walks INTO it).
  const propBuilders = {
    'evac-van': () => buildProp('evacVan'),
    'helo-pad': () => buildProp('heloPad'),
    'service-elevator': () => buildProp('serviceElevator'),
    'sewer-grate': () => buildProp('sewerGrate'),
    'chopper-lz': () => buildProp('chopperLz'),
  };
  const builder = propBuilders[kind];
  const built = builder ? builder() : null;
  if (built && built.group) {
    // Face the prop's local +Z toward the door so it reads as "the way
    // out is THIS direction." dir is the BOSS-room side the chamber
    // attaches to; the door sits on the chamber's OPPOSITE wall (the
    // wall facing boss). The prop's local +Z front should point at
    // that door so the player walks INTO the prop. Earlier this map
    // was matched to the old wrong-side wall logic and had every
    // prop facing the FAR wall after the wall fix landed.
    let yaw = 0;
    if (dir === 'south') yaw = Math.PI;             // chamber south, door on N wall — face -Z
    else if (dir === 'north') yaw = 0;              // chamber north, door on S wall — face +Z
    else if (dir === 'east')  yaw =  Math.PI / 2;   // chamber east, door on W wall — face -X
    else if (dir === 'west')  yaw = -Math.PI / 2;   // chamber west, door on E wall — face +X
    built.group.rotation.y = yaw;
    built.group.position.set(cx, 0, cz);
    built.group.visible = false;     // hidden until reveal
    level.scene.add(built.group);
    level.decorations.push(built.group);
    ownedVisuals.push(built.group);
    // Stamp kind on the group's userData so the smoke harness can find
    // the extraction prop.
    built.group.userData.kind = built.kind || extractionPropKind;
    // Block the prop's footprint so AI can't path through it. Mirror
    // _registerProp's collision-proxy approach so wall raycasts treat
    // the extraction prop as solid.
    if (built.collision) {
      const w = built.collision.w, d = built.collision.d;
      const proxyMat = sharedMaterial({
        type: 'basic', color: 0xffffff,
        transparent: true, opacity: 0, depthWrite: false,
      });
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), proxyMat);
      proxy.position.set(cx, 0.8, cz);
      proxy.userData.collisionXZ = {
        minX: cx - w / 2, maxX: cx + w / 2,
        minZ: cz - d / 2, maxZ: cz + d / 2,
      };
      proxy.userData.isProp = true;
      proxy.userData.kind = 'extraction-prop-proxy';
      proxy.userData.propGroup = built.group;
      proxy.visible = false;
      level.scene.add(proxy);
      level.obstacles.push(proxy);
      ownedObstacles.push(proxy);
      ownedVisuals.push(proxy);
    }
  }

  // Some extraction kinds get supporting props (railings around a helo
  // pad, crates flanking the elevator). Add those as a second pass —
  // safe because the centerpiece is at room-centre and these go on the
  // perimeter.
  const supports = [];
  if (kind === 'helo-pad' || kind === 'chopper-lz') {
    supports.push({ kind: 'railing', count: 2 });
    supports.push({ kind: 'crate', count: 1 });
  } else if (kind === 'service-elevator') {
    supports.push({ kind: 'crateRow', count: 1 });
  } else if (kind === 'evac-van') {
    supports.push({ kind: 'crate', count: 1 });
    supports.push({ kind: 'barrel', count: 1 });
  }
  // Place each support at one of the room's free corners.
  const corners = [
    { x: bounds.minX + 1.2, z: bounds.minZ + 1.2 },
    { x: bounds.maxX - 1.2, z: bounds.minZ + 1.2 },
    { x: bounds.minX + 1.2, z: bounds.maxZ - 1.2 },
    { x: bounds.maxX - 1.2, z: bounds.maxZ - 1.2 },
  ].sort(() => Math.random() - 0.5);
  let cornerIdx = 0;
  for (const s of supports) {
    for (let i = 0; i < (s.count || 1); i++) {
      if (cornerIdx >= corners.length) break;
      const c = corners[cornerIdx++];
      const sup = buildProp(s.kind);
      if (!sup || !sup.group) continue;
      sup.group.position.set(c.x, 0, c.z);
      sup.group.visible = false;
      level.scene.add(sup.group);
      level.decorations.push(sup.group);
      ownedVisuals.push(sup.group);
      sup.group.userData.kind = sup.kind || s.kind;
      if (sup.collision) {
        const w = sup.collision.w, d = sup.collision.d;
        const proxyMat = sharedMaterial({
          type: 'basic', color: 0xffffff,
          transparent: true, opacity: 0, depthWrite: false,
        });
        const proxy = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, d), proxyMat);
        proxy.position.set(c.x, 0.5, c.z);
        proxy.userData.collisionXZ = {
          minX: c.x - w / 2, maxX: c.x + w / 2,
          minZ: c.z - d / 2, maxZ: c.z + d / 2,
        };
        proxy.userData.isProp = true;
        proxy.userData.kind = sup.kind || s.kind;
        proxy.userData.propGroup = sup.group;
        proxy.visible = false;
        level.scene.add(proxy);
        level.obstacles.push(proxy);
        ownedObstacles.push(proxy);
        ownedVisuals.push(proxy);
      }
    }
  }

  // ---- Synthetic room object ---------------------------------------
  // Mirrors the level.rooms shape so things like roomAt() can find the
  // player after they walk inside. type='extraction' is new — code that
  // handles only chain types ('start','combat','boss','encounter',
  // shop, 'subBoss') will skip extraction rooms naturally.
  const room = {
    id: -1,                            // synthetic; not in the chain
    type: 'extraction',
    layout: 'open',
    bounds,
    cx, cz,
    cellX: 0, cellZ: 0,
    neighbors: [{ otherId: bossRoom.id, dir: { east:'west', west:'east', north:'south', south:'north' }[dir] }],
    cleared: true,
    entered: false,
    hasElevator: false,
    _exitDir: dir,
  };

  // Exit bounds — slightly inset from the room walls so the trigger
  // fires when the player's IN the room, not when they're touching the
  // door from the wrong side. Using a circle (cx, cz, r) so the
  // existing isPlayerInExit() distance check works without changes.
  const exitBounds = { cx, cz, r: half - 1.2 };

  // Reveal helper — flips every owned visual to visible and unlocks
  // the door. Called from level.revealExit().
  const reveal = () => {
    for (const m of ownedVisuals) m.visible = true;
    // Unlock the door using level._openDoor — same path the keycard
    // system uses, so the visual flatten + collision-null all happens
    // together and the cached solid-obstacles list invalidates.
    if (typeof level._openDoor === 'function') {
      level._openDoor(doorMesh);
    } else {
      // Defensive fallback — null collision so player can walk through.
      doorMesh.userData.collisionXZ = null;
      if (typeof level._dirtySolid === 'function') level._dirtySolid();
    }
  };

  return { room, doorMesh, exitBounds, reveal, dir };
}
