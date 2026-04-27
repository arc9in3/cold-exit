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

export class DroneManager {
  constructor(scene) {
    this.scene = scene;
    this.drones = [];
  }

  // Spawn a drone at the given world position, owned by `ownerId`
  // (currently unused, available if we want kill credit later).
  spawn(x, y, z, ownerId = null) {
    const group = new THREE.Group();
    // Body — emissive diamond. Octahedron silhouette reads distinct
    // from spheres so the player spots a drone instantly across the
    // room.
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x301010, roughness: 0.45, metalness: 0.55,
      emissive: 0xff3030, emissiveIntensity: 0.55,
    });
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), bodyMat);
    body.castShadow = false;
    body.userData.zone = 'torso';
    body.userData.owner = null;        // filled in below
    group.add(body);
    // Inner glowing core — visual interest + reads as "armed".
    // Bumped to fully-saturated emissive (was MeshBasicMaterial which
    // is already unlit). Replaces the per-drone PointLight underglow:
    // drones swarm 8+ at a time and each PointLight forced a per-mesh
    // shader recompile path, so the swarm tanked the frame. Bloom in
    // postfx gives the moving glow effect for free.
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xff6020, transparent: true, opacity: 0.95,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), coreMat);
    group.add(core);
    group.position.set(x, y || DRONE_HOVER_Y, z);
    this.scene.add(group);
    const drone = {
      group,
      body, core,
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
      _tmpDir: new THREE.Vector3(),
      // Mirror the gunman/melee shape just enough that downstream
      // hit / aim code treats this as a hittable enemy. `hittable`
      // is the array allHittables() will pull body parts from; for
      // drones it's just the body mesh.
      hittables: [body],
    };
    body.userData.owner = drone;
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
        d._tmpDir.set(dx / dist, 0, dz / dist);
        const step = DRONE_SPEED * dt;
        const nx = gx + d._tmpDir.x * step;
        const nz = gz + d._tmpDir.z * step;
        if (ctx.level && ctx.level.resolveCollision) {
          const r = ctx.level.resolveCollision(gx, gz, nx, nz, 0.25);
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

  _removeMesh(drone) {
    drone.dead = true;
    if (drone.group && drone.group.parent) {
      drone.group.parent.remove(drone.group);
    }
    drone.body.geometry.dispose();
    drone.body.material.dispose();
    drone.core.geometry.dispose();
    drone.core.material.dispose();
  }

  removeAll() {
    for (const d of this.drones) {
      if (d.group && d.group.parent) d.group.parent.remove(d.group);
      d.body?.geometry.dispose();
      d.body?.material.dispose();
      d.core?.geometry.dispose();
      d.core?.material.dispose();
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
