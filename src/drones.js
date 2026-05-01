// Suicide drones — small floating units summoned by the
// drone-summoner boss archetype. Each drone tracks the player at
// medium speed, explodes on contact for AoE damage, and can be
// shot down before it reaches you. Player aim is routed through
// the standard hittables list so existing aim / damage logic
// applies (headshot multiplier doesn't, since drones have no head
// zone — `torso` zone is stamped instead).
//
// Visual: small glowing diamond (octahedron) hovering at chest
// height, with a faint emissive trail and an underbody point of
// light. Cheap geometry; no shadow casting.

import * as THREE from 'three';

const DRONE_HP            = 24;       // ~2 pistol shots, 1 SMG burst
const DRONE_SPEED         = 3.4;      // m/s — slower than player sprint, faster than walk
const DRONE_HOVER_Y       = 1.35;     // chest-height tracking
const DRONE_BOB_AMPLITUDE = 0.10;
const DRONE_BOB_FREQ      = 4.2;      // Hz × 2π in update math
const DRONE_CONTACT_RADIUS = 0.7;     // detonate within this distance from player
const DRONE_AOE_RADIUS    = 2.4;
const DRONE_AOE_DAMAGE    = 22;
const DRONE_AOE_SHAKE     = 0.32;
const POOL_SIZE           = 16;       // covers a Hivemaster swarm (2-3/summon × 5 summons)

// Shared geometry + materials. The Hivemaster swarm previously paid a
// fresh OctahedronGeometry + SphereGeometry + MeshStandardMaterial +
// MeshBasicMaterial per spawn AND a fresh dispose chain per kill —
// 4 GPU uploads + 4 disposals per drone, every drone, in a tight
// 8-drone-per-second loop. Hoisted to module scope so every spawn is
// just a slot reuse.
const _BODY_GEOM = new THREE.OctahedronGeometry(0.32, 0);
const _CORE_GEOM = new THREE.SphereGeometry(0.14, 10, 8);
const _BODY_MAT  = new THREE.MeshStandardMaterial({
  color: 0x301010, roughness: 0.45, metalness: 0.55,
  emissive: 0xff3030, emissiveIntensity: 0.55,
});
const _CORE_MAT  = new THREE.MeshBasicMaterial({
  color: 0xff6020, transparent: true, opacity: 0.95,
});
// Per-frame scratch reused by every drone — was allocated per drone
// in the old shape (1 Vector3 per spawn).
const _DIR_TMP = new THREE.Vector3();

// Drones hover at 1.35m, well above couches / crates / containers, so
// they shouldn't pay collision cost for any of them. Only full-height
// walls + closed doors should block. This filter mirrors visionBlockers
// in level.js (props skipped) but keeps the cheap AABB shape so we
// don't allocate per-frame.
//
// `level.solidObstacles()` is cached behind a dirty flag, so calling
// it every frame is essentially free — the per-frame cost was the
// inner loop iterating short props the drone could fly over anyway.
function _droneCollidesAt(level, x, z, radius) {
  const obstacles = level.solidObstacles ? level.solidObstacles() : null;
  if (!obstacles) return false;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const ud = o.userData;
    if (ud.isProp) continue;          // skip cover / decor
    if (ud.containerRef) continue;    // skip lootable containers
    const b = ud.collisionXZ;
    if (!b) continue;
    if (x > b.minX - radius && x < b.maxX + radius
     && z > b.minZ - radius && z < b.maxZ + radius) return true;
  }
  return false;
}
function _droneResolveCollision(level, oldX, oldZ, newX, newZ, radius) {
  let x = newX, z = oldZ;
  if (_droneCollidesAt(level, x, z, radius)) x = oldX;
  let nz = newZ;
  if (_droneCollidesAt(level, x, nz, radius)) nz = oldZ;
  return { x, z: nz };
}

export class DroneManager {
  constructor(scene) {
    this.scene = scene;
    this.drones = [];
    // Pre-allocate POOL_SIZE slots up front. Each slot owns its own
    // Group + body Mesh + core Mesh, but all share _BODY_GEOM /
    // _CORE_GEOM / _BODY_MAT / _CORE_MAT — neither material is
    // mutated per-drone, so sharing is safe. `inUse` flips on
    // spawn / `_returnSlot`.
    this._pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(_BODY_GEOM, _BODY_MAT);
      body.castShadow = false;
      body.userData.zone = 'torso';
      group.add(body);
      const core = new THREE.Mesh(_CORE_GEOM, _CORE_MAT);
      group.add(core);
      group.position.set(0, -1000, 0);
      group.visible = false;
      this.scene.add(group);
      this._pool.push({ group, body, core, inUse: false });
    }
  }

  // Spawn a drone at the given world position, owned by `ownerId`
  // (currently unused, available if we want kill credit later).
  // Reuses an idle pool slot — zero allocations on the hot path.
  spawn(x, y, z, ownerId = null) {
    let slot = null;
    for (const s of this._pool) {
      if (!s.inUse) { slot = s; break; }
    }
    if (!slot) {
      // Pool full — evict the oldest live drone so a Hivemaster
      // overspawn doesn't silently fail. Mirrors the loot-pool /
      // tracer-pool eviction pattern.
      const oldest = this.drones[0];
      if (oldest && oldest.slot) {
        this._removeMesh(oldest);
        oldest.alive = false;
      }
      for (const s of this._pool) {
        if (!s.inUse) { slot = s; break; }
      }
      if (!slot) return null;
    }
    slot.inUse = true;
    slot.group.position.set(x, y || DRONE_HOVER_Y, z);
    slot.group.visible = true;
    const drone = {
      slot,
      group: slot.group,
      body: slot.body,
      core: slot.core,
      // `light` slot retained as null so any ticker that previously
      // animated the underglow intensity becomes a no-op instead of
      // a TypeError.
      light: null,
      hp: DRONE_HP,
      maxHp: DRONE_HP,
      bobT: Math.random() * Math.PI * 2,
      alive: true,
      dead: false,
      ownerId,
      // Mirror the gunman/melee shape just enough that downstream
      // hit / aim code treats this as a hittable enemy. `hittable`
      // is the array allHittables() will pull body parts from; for
      // drones it's just the body mesh.
      hittables: [slot.body],
    };
    slot.body.userData.owner = drone;
    drone.manager = this;
    this.drones.push(drone);
    return drone;
  }

  // Drone-list adapter for main.allHittables. Returns the body
  // mesh of every alive drone so bullets / aim raycasts can resolve
  // them via hit.object.userData.owner → drone.manager.applyHit.
  hittables() {
    const out = [];
    for (const d of this.drones) if (d.alive) out.push(d.body);
    return out;
  }

  // Per-frame tick. `ctx` mirrors the gunman / melee context: needs
  // playerPos, level, and an onPlayerHit callback for the contact
  // explosion.
  update(dt, ctx) {
    if (!ctx) return;
    const px = ctx.playerPos?.x ?? 0;
    const pz = ctx.playerPos?.z ?? 0;
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const d = this.drones[i];
      if (!d.alive) {
        // Reap dead drones — the kill path already removed the mesh.
        this.drones.splice(i, 1);
        continue;
      }
      // Track player at constant speed. Drones float — no gravity,
      // no collision with low cover (they fly over). They DO try to
      // avoid running through walls by clamping motion against
      // level.resolveCollision so they don't phase through doors.
      const gx = d.group.position.x;
      const gz = d.group.position.z;
      const dx = px - gx;
      const dz = pz - gz;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.001) {
        _DIR_TMP.set(dx / dist, 0, dz / dist);
        const step = DRONE_SPEED * dt;
        const nx = gx + _DIR_TMP.x * step;
        const nz = gz + _DIR_TMP.z * step;
        if (ctx.level) {
          // Drone-specific collision — only walls + doors block, props
          // are flown over. ~80% reduction in obstacle iterations vs
          // level.resolveCollision in a typical late-game room.
          const r = _droneResolveCollision(ctx.level, gx, gz, nx, nz, 0.25);
          d.group.position.x = r.x;
          d.group.position.z = r.z;
        } else {
          d.group.position.x = nx;
          d.group.position.z = nz;
        }
      }
      // Bob the body for "alive" read.
      d.bobT += dt * DRONE_BOB_FREQ;
      d.group.position.y = DRONE_HOVER_Y + Math.sin(d.bobT) * DRONE_BOB_AMPLITUDE;
      d.body.rotation.y += dt * 1.6;
      d.body.rotation.x += dt * 0.9;
      // Contact check — close enough → detonate.
      if (dist < DRONE_CONTACT_RADIUS) {
        this._detonate(d, ctx);
        continue;
      }
    }
  }

  // Damage from a player bullet / melee hit. Signature mirrors the
  // gunman manager's applyHit so the bullet pipeline can call
  // either the same way: (target, dmg, zone, hitDir, opts).
  applyHit(drone, amount, zone, hitDir, opts) {
    if (!drone || !drone.alive) return { drops: [], blocked: false };
    drone.hp -= amount;
    if (drone.hp <= 0) {
      this._kill(drone, /* exploded */ false);
    }
    return { drops: [], blocked: false };
  }

  // Drone reached the player — explode for AoE damage. Caller via
  // ctx.onDroneExplode handles damage + VFX (so the explosion
  // pipeline is unified with grenades / rockets).
  _detonate(drone, ctx) {
    if (!drone.alive) return;
    drone.alive = false;
    const pos = drone.group.position.clone();
    if (ctx && ctx.onDroneExplode) {
      ctx.onDroneExplode(pos, {
        radius: DRONE_AOE_RADIUS,
        damage: DRONE_AOE_DAMAGE,
        shake: DRONE_AOE_SHAKE,
      });
    }
    this._removeMesh(drone);
  }

  // Kill a drone — bullet finished it. No AoE explosion (the player
  // shot it down before it reached them).
  _kill(drone, exploded) {
    if (!drone.alive) return;
    drone.alive = false;
    this._removeMesh(drone);
  }

  // Return a slot to the idle pool. Geometry + material are shared
  // across all slots — never dispose them.
  _returnSlot(slot) {
    slot.inUse = false;
    slot.group.visible = false;
    slot.group.position.set(0, -1000, 0);
    slot.body.userData.owner = null;
  }

  _removeMesh(drone) {
    drone.dead = true;
    if (drone.slot) this._returnSlot(drone.slot);
  }

  removeAll() {
    for (const d of this.drones) {
      if (d.slot) this._returnSlot(d.slot);
    }
    this.drones.length = 0;
  }

  // Hittable mesh list for player aim raycasts. Mirrors the gunman /
  // melee `hittables` shape so allHittables() in main.js can fold
  // these in alongside enemies.
  allHittables() {
    const out = [];
    for (const d of this.drones) {
      if (d.alive) out.push(d.body);
    }
    return out;
  }
}
