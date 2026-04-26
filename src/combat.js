import * as THREE from 'three';
import { tunables } from './tunables.js';

// Visual-only weapon effects: tracers, muzzle flashes, impact sparks, and a
// shared raycaster. This module holds no per-shooter state — each shooter
// tracks its own fire cooldown.
export class Combat {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.flashes = [];
    this.impacts = [];
    this.arcs = [];
    this.bloods = [];   // small red spheres that arc and fade
    this.pools = [];    // flat blood pools under dead enemies
    this.gore = [];     // detached body parts (heads on execute)
    this.explosions = []; // expanding fireball + scorch ring
    this.flameParticles = [];   // per-shot flamethrower primitives
    this.raycaster = new THREE.Raycaster();
    this._bloodCap = 140;
    this._poolCap = 30;
    this._goreCap = 20;
    // Obstacle AABBs used by flame particles for wall collision.
    // Refreshed once per frame by main.js before Combat.update.
    this._flameBlockers = [];

    // --- Particle pool ----------------------------------------------
    // Pre-allocated mesh/material slots for blood + explosion sparks.
    // Without this, every shotgun pellet hit + every grenade impact
    // allocates 5-20 fresh SphereGeometries + MeshBasicMaterials. At
    // 200 particles in flight this generates real GC pressure and
    // visible jitter. The pool reuses the same geometry across all
    // particles (sphere is identical visually); each slot keeps its
    // own per-particle material so colour can vary per spawn.
    this._particlePool = [];
    this._sharedParticleGeom = new THREE.SphereGeometry(0.08, 6, 4);
    const PARTICLE_POOL_SIZE = 256;
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xa01818, transparent: true, opacity: 0, depthWrite: false,
      });
      const mesh = new THREE.Mesh(this._sharedParticleGeom, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this._particlePool.push({ mesh, mat, inUse: false });
    }

    // --- Explosion light pool ---------------------------------------
    // The explosion fireball used to allocate a fresh PointLight per
    // detonation, push it into the scene, then dispose it on expiry.
    // Adding/removing a light to the scene flips the lit-shader cache
    // key and forces a full shader recompile EACH time. Two
    // recompiles per explosion = visible hitch on every grenade or
    // kill blast. Pool: pre-allocated PointLights parked at intensity 0,
    // brought up on detonation, dimmed back to 0 on expiry. Scene
    // light count stays constant.
    this._explosionLightPool = [];
    const EXPLOSION_LIGHT_POOL_SIZE = 6;
    for (let i = 0; i < EXPLOSION_LIGHT_POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xffcf60, 0, 8);
      light.position.set(0, -1000, 0);
      this.scene.add(light);
      this._explosionLightPool.push({ light, inUse: false });
    }
  }

  _acquireExplosionLight() {
    for (const s of this._explosionLightPool) if (!s.inUse) return s;
    return this._explosionLightPool[0];   // saturated — reuse oldest
  }

  _acquireParticle() {
    for (const s of this._particlePool) if (!s.inUse) return s;
    // Pool saturated — steal the oldest live blood entry's slot.
    const oldest = this.bloods[0];
    if (oldest && oldest.slot) {
      this.bloods.shift();
      return oldest.slot;
    }
    return this._particlePool[0];
  }

  setFlameBlockers(list) { this._flameBlockers = list || []; }

  // Big orange fireball + expanding shock ring + falling sparks.
  // `radius` is the AoE radius; the fireball peaks at 1.0× and the
  // ring reaches 1.4× before fading. Auto-fades in ~0.55s.
  spawnExplosion(point, radius = 5.0) {
    this._ensurePools();
    // Pool-backed fireball + ring. Find an idle slot, or recycle the
    // oldest in-use one (visually invisible — it's mid-fade).
    let exEntry = this._explosionPool.find(e => !e.inUse);
    if (!exEntry) exEntry = this._explosionPool[0];
    exEntry.inUse = true;
    const fireball = exEntry.fireball;
    const ring = exEntry.ring;
    fireball.position.copy(point);
    fireball.scale.setScalar(0.2);
    fireball.material.opacity = 0.95;
    fireball.visible = true;
    ring.position.set(point.x, 0.06, point.z);
    ring.scale.setScalar(1);
    ring.material.opacity = 0.85;
    ring.visible = true;

    // Hot white flash + light so the explosion actually lights
    // surrounding geometry for one beat. Pool-backed (see ctor) so
    // there's no add-light/remove-light cycle that would force a
    // shader recompile per detonation.
    const lightSlot = this._acquireExplosionLight();
    lightSlot.inUse = true;
    lightSlot.light.position.copy(point);
    lightSlot.light.distance = radius * 2.2;
    lightSlot.light.intensity = 6.0;

    this.explosions.push({
      exEntry, fireball, ring, lightSlot, t: 0, life: 0.55, radius,
    });
    // Sparks — reuse the shared particle pool with a warm tint and
    // bigger scale so the debris reads at distance.
    for (let i = 0; i < 14; i++) {
      const slot = this._acquireParticle();
      slot.inUse = true;
      slot.mat.color.setHex(i % 2 ? 0xffa040 : 0xff6020);
      slot.mat.opacity = 0.95;
      slot.mesh.scale.setScalar(1.5 + Math.random() * 1.0);
      slot.mesh.position.copy(point);
      slot.mesh.visible = true;
      if (!slot.vel) slot.vel = new THREE.Vector3();
      slot.vel.set(
        (Math.random() - 0.5) * 8,
        3 + Math.random() * 4,
        (Math.random() - 0.5) * 8,
      );
      this.bloods.push({
        slot, mesh: slot.mesh, vel: slot.vel,
        t: 0, life: 0.6 + Math.random() * 0.35,
      });
    }
  }

  spawnBloodBurst(point, dir, amount = 5) {
    if (this.bloods.length > this._bloodCap) amount = Math.max(1, (amount / 2) | 0);
    const d = (dir && dir.lengthSq && dir.lengthSq() > 0.0001) ? dir : new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < amount; i++) {
      const slot = this._acquireParticle();
      slot.inUse = true;
      slot.mat.color.setHex(0xa01818);
      slot.mat.opacity = 0.95;
      // Per-particle scale jitter — sphere geometry is shared so we
      // vary perceived size via mesh.scale instead of a fresh geom.
      const sc = 0.75 + Math.random() * 0.6;
      slot.mesh.scale.setScalar(sc);
      slot.mesh.position.copy(point);
      slot.mesh.visible = true;
      const speed = 1.5 + Math.random() * 2.5;
      // Reuse the slot's persistent vel Vector3 instead of allocating
      // a fresh one per particle.
      if (!slot.vel) slot.vel = new THREE.Vector3();
      slot.vel.set(
        d.x * speed + (Math.random() - 0.5) * 1.5,
        2.5 + Math.random() * 2.5,
        d.z * speed + (Math.random() - 0.5) * 1.5,
      );
      this.bloods.push({
        slot, mesh: slot.mesh, vel: slot.vel,
        t: 0, life: 0.55 + Math.random() * 0.3,
      });
    }
  }

  spawnBloodPool(point, radius = 0.75) {
    if (this.pools.length > this._poolCap) {
      // oldest pool pops
      const old = this.pools.shift();
      this.scene.remove(old.mesh);
      old.mesh.geometry.dispose();
      old.mesh.material.dispose();
    }
    const mat = new THREE.MeshBasicMaterial({
      color: 0x5c1010, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius * (0.9 + Math.random() * 0.3), 20), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(point.x, 0.04, point.z);
    this.scene.add(mesh);
    this.pools.push({ mesh, t: 0, life: 45, fadeIn: 0.4, maxOpacity: 0.7 });
  }

  // Adopt an existing mesh into the gore pool so it flies off with physics.
  spawnGore(mesh, vel, spin) {
    if (this.gore.length > this._goreCap) {
      const old = this.gore.shift();
      this.scene.remove(old.mesh);
    }
    this.gore.push({
      mesh,
      vel: vel.clone ? vel.clone() : new THREE.Vector3(vel.x, vel.y, vel.z),
      spin: spin ? spin.clone() : new THREE.Vector3(),
      t: 0, life: 12, settled: false,
    });
  }

  spawnShockwave(origin, radius, color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.2, radius, 48),
      new THREE.MeshBasicMaterial({
        color: color ?? 0xffc24a, transparent: true, opacity: 0.8,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(origin);
    ring.position.y = 0.1;
    this.scene.add(ring);
    this.arcs.push({ line: ring, t: 0, life: 0.45, shockwave: true });
  }

  spawnDeflectFlash(point, color) {
    // Reuse the impact pool — same fade-and-shrink visual envelope.
    // Material color is reset per spawn (defaults to white). Slightly
    // larger scale than a normal impact so the parry pop reads as
    // distinct from a regular bullet hit.
    this._ensurePools();
    let entry = this._impactPool.find(e => !e.inUse);
    if (!entry) entry = this._impactPool[0];
    entry.inUse = true;
    entry.mesh.position.copy(point);
    entry.mesh.material.color.setHex(color ?? 0xffffff);
    entry.mesh.material.opacity = 1;
    entry.mesh.scale.setScalar(1.5);
    entry.mesh.visible = true;
    this.impacts.push({ entry, t: 0, life: tunables.block.deflectFlashLife });
  }

  // Filled cone of flame at ground level — call once per flame tick for a
  // flickering continuous-spray effect.
  // Per-tick stream of transparent flame primitives. Each is a sphere
  // that flies forward with slight upward drift, fades out, and stops
  // on wall contact. Replaces the flat cone mesh — reads as volumetric
  // and respects cover, which matters now that walls occlude LoS.
  spawnFlameParticles(origin, facing, range, angleRad) {
    this._ensurePools();
    const N = 7;
    const baseSpeed = range / 0.28;  // cover full range in ~0.28s
    for (let i = 0; i < N; i++) {
      const spread = (Math.random() - 0.5) * angleRad;
      const c = Math.cos(spread), s = Math.sin(spread);
      const vx = facing.x * c - facing.z * s;
      const vz = facing.x * s + facing.z * c;
      const speed = baseSpeed * (0.8 + Math.random() * 0.4);
      // Pool path — find idle slot, recycle oldest if full.
      let entry = this._flamePool.find(e => !e.inUse);
      if (!entry) entry = this._flamePool[0];
      entry.inUse = true;
      const m = entry.mesh;
      m.material.color.setHex(i % 3 === 0 ? 0xffcc40 : (i % 3 === 1 ? 0xff7030 : 0xff4420));
      m.material.opacity = 0.65;
      // Geometry is shared — vary the size via scale instead of new geom.
      const baseScale = (0.25 + Math.random() * 0.25) / 0.4;   // 0.4 = pool sphere radius
      m.scale.setScalar(baseScale);
      m.position.set(
        origin.x + (Math.random() - 0.5) * 0.15,
        0.8 + Math.random() * 0.4,
        origin.z + (Math.random() - 0.5) * 0.15,
      );
      m.visible = true;
      this.flameParticles.push({
        entry,
        baseScale,
        vx: vx * speed,
        vz: vz * speed,
        vy: 0.4 + Math.random() * 0.4,   // slight upward drift
        t: 0, life: 0.45 + Math.random() * 0.15,
        stopped: false,
        grow: 1.5 + Math.random() * 0.6,  // scale expansion per second
      });
    }
  }

  spawnFlame(origin, facing, range, angleRad, life) {
    const seg = 14;
    const verts = [origin.x, 0.15, origin.z];
    const idx = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg - 0.5;
      const a = t * angleRad;
      const c = Math.cos(a), s = Math.sin(a);
      const dx = facing.x * c - facing.z * s;
      const dz = facing.x * s + facing.z * c;
      verts.push(origin.x + dx * range, 0.15, origin.z + dz * range);
      if (i > 0) idx.push(0, i, i + 1);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geom.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff7030,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    this.scene.add(mesh);
    this.arcs.push({ line: mesh, t: 0, life });
  }

  spawnSwipeArc(origin, facing, range, angleRad, life) {
    // Flat arc on the ground at facing direction.
    const seg = 12;
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg - 0.5;
      const a = t * angleRad;
      const c = Math.cos(a), s = Math.sin(a);
      const dx = facing.x * c - facing.z * s;
      const dz = facing.x * s + facing.z * c;
      pts.push(new THREE.Vector3(origin.x + dx * range, origin.y + 0.1, origin.z + dz * range));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: 0xf2e7c9, transparent: true, opacity: 1, depthWrite: false,
    });
    const line = new THREE.Line(geom, mat);
    this.scene.add(line);
    this.arcs.push({ line, t: 0, life });
  }

  // Thin quad drawn between two world-space points — one segment of
  // a weapon-tip trail. Called per frame during a swing so the
  // accumulated segments trace the actual path of the weapon rather
  // than a pre-computed fan. Each segment fades independently via
  // the existing `arcs` update loop (which also disposes geometry +
  // material). Orientation: the quad's "up" is perpendicular to the
  // travel direction in the XZ plane, giving the ribbon a thickness
  // that reads from the isometric camera.
  spawnMeleeSegment(fromPos, toPos, life, opts = {}) {
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const dz = toPos.z - fromPos.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.001) return;
    // Perpendicular-in-XZ-plane so the ribbon has thickness visible
    // from the isometric camera. For near-vertical travel, fall back
    // to world X axis so we don't get a zero-length perp.
    let nx = -dz, nz = dx;
    let nlen = Math.hypot(nx, nz);
    if (nlen < 0.001) { nx = 1; nz = 0; nlen = 1; }
    nx /= nlen; nz /= nlen;
    const width = opts.width ?? 0.14;
    const h = width * 0.5;
    // Taper the tail end so segment→segment joins read as a flowing
    // ribbon rather than stacked rectangles.
    const tailH = h * (opts.tailFrac ?? 0.75);
    const positions = new Float32Array([
      fromPos.x + nx * tailH, fromPos.y, fromPos.z + nz * tailH,
      fromPos.x - nx * tailH, fromPos.y, fromPos.z - nz * tailH,
      toPos.x   + nx * h,     toPos.y,   toPos.z   + nz * h,
      toPos.x   - nx * h,     toPos.y,   toPos.z   - nz * h,
    ]);
    const indices = [0, 1, 2, 1, 3, 2];
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(indices);
    const mat = new THREE.MeshBasicMaterial({
      color: opts.color ?? 0xf2e7c9,
      transparent: true,
      opacity: opts.opacity ?? 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geom, mat);
    this.scene.add(mesh);
    this.arcs.push({ line: mesh, t: 0, life });
  }

  spawnMeleeArc(origin, facing, range, angleRad, life, opts = {}) {
    const color = opts.color ?? 0xf2e7c9;
    const style = opts.style || 'horizontal';
    const isCrit = !!opts.isCrit;
    // Per-style band geometry. `low` and `high` are y-offsets from
    // origin.y defining the ribbon's vertical extent; `tilt` is an
    // additional radians tilt of the band normal (overhead drops
    // the band vertically, thrust keeps it flat but narrow).
    const band = (() => {
      switch (style) {
        case 'overhead': return { low: -0.10, high: 1.60, seg: 12 };  // tall vertical sweep (downchop)
        case 'thrust':   return { low:  0.90, high: 1.30, seg: 6 };   // short, forward at chest
        case 'critical': return { low: -0.20, high: 1.85, seg: 18 };  // biggest sweep
        default:         return { low:  0.55, high: 1.55, seg: 14 };  // horizontal arc at torso
      }
    })();
    const { low, high, seg } = band;
    const positions = new Float32Array((seg + 1) * 2 * 3);
    const indices = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg - 0.5;
      const a = t * angleRad;
      const c = Math.cos(a), s = Math.sin(a);
      const dx = facing.x * c - facing.z * s;
      const dz = facing.x * s + facing.z * c;
      // For overhead: scale range down through the arc to create a
      // downward chop arc (range shortens as we approach the bottom
      // of the swing). Others use uniform range.
      const r = range;
      const topIdx = i * 2, botIdx = topIdx + 1;
      positions[topIdx * 3 + 0] = origin.x + dx * r;
      positions[topIdx * 3 + 1] = origin.y + high;
      positions[topIdx * 3 + 2] = origin.z + dz * r;
      positions[botIdx * 3 + 0] = origin.x + dx * r;
      positions[botIdx * 3 + 1] = origin.y + low;
      positions[botIdx * 3 + 2] = origin.z + dz * r;
      if (i < seg) {
        const a1 = i * 2, b1 = a1 + 1, c1 = (i + 1) * 2, d1 = c1 + 1;
        indices.push(a1, b1, c1);
        indices.push(b1, d1, c1);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(indices);
    const mat = new THREE.MeshBasicMaterial({
      color: isCrit ? 0xfff4a8 : color,
      transparent: true,
      opacity: isCrit ? 0.95 : 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geom, mat);
    this.scene.add(mesh);
    this.arcs.push({ line: mesh, t: 0, life });
  }

  // Closest hit among `targets`, or null.
  raycast(origin, dir, targets, range) {
    this.raycaster.set(origin, dir);
    this.raycaster.far = range;
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;
    const h = hits[0];
    return {
      mesh: h.object,
      point: h.point,
      distance: h.distance,
      zone: h.object.userData?.zone || 'body',
      owner: h.object.userData?.owner || null,
    };
  }
  // All hits along the ray, sorted near→far. Used by the sniper
  // penetration path so a single shot can resolve damage on multiple
  // bodies before being stopped by a wall. Each hit normalises the
  // owner / zone like raycast() so callers can iterate uniformly.
  raycastAll(origin, dir, targets, range) {
    this.raycaster.set(origin, dir);
    this.raycaster.far = range;
    const hits = this.raycaster.intersectObjects(targets, false);
    return hits.map((h) => ({
      mesh: h.object,
      point: h.point,
      distance: h.distance,
      zone: h.object.userData?.zone || 'body',
      owner: h.object.userData?.owner || null,
    }));
  }

  // True if nothing in `blockers` lies between `from` and `to`.
  // Filters out self-intersections at the ray origin (BVH-accelerated
  // raycasts report a 0-distance hit when the origin point sits inside
  // a wall's AABB, which would otherwise misclassify every enemy as
  // occluded and render the whole field as ghosts).
  hasLineOfSight(from, to, blockers) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist < 0.0001) return true;
    dir.normalize();
    this.raycaster.set(from, dir);
    this.raycaster.far = dist;
    const hits = this.raycaster.intersectObjects(blockers, false);
    if (hits.length === 0) return true;
    // Treat near-zero hits as origin self-intersection.
    for (let i = 0; i < hits.length; i++) {
      if (hits[i].distance >= 0.15) return false;
    }
    return true;
  }

  // opts.light — whether to attach a dynamic PointLight to the flash.
  //   Defaults to true. Pass false for AI fires (particularly bullet
  //   hell volleys) where stacking 10+ point lights per frame tanks
  //   fragment shading cost massively.
  // opts.flash — whether to spawn the muzzle flash mesh at all.
  //   Defaults to true. Pellet-based weapons (shotguns, Dragonbreath)
  //   should set this false for pellets 2..N so a 9-pellet volley
  //   emits a single flash instead of nine overlapping spheres.
  spawnShot(origin, endPoint, tracerColor, opts = {}) {
    this._spawnTracer(origin, endPoint, tracerColor);
    if (opts.flash !== false) this._spawnFlash(origin, tracerColor, opts.light !== false);
  }
  // Public standalone flash — call this once per fire event when you
  // want the flash to fire a single time regardless of pellet count.
  spawnFlash(origin, color, withLight = true) { this._spawnFlash(origin, color, withLight); }

  spawnImpact(point) {
    this._ensurePools();
    let entry = this._impactPool.find(e => !e.inUse);
    if (!entry) entry = this._impactPool[0];   // starved → overwrite oldest
    entry.inUse = true;
    entry.mesh.position.copy(point);
    // Reset color in case the slot was last used by spawnDeflectFlash
    // with a custom tint. Default impact spark is warm orange.
    entry.mesh.material.color.setHex(0xffbb55);
    entry.mesh.material.opacity = 1;
    entry.mesh.scale.setScalar(1);
    entry.mesh.visible = true;
    this.impacts.push({ entry, t: 0, life: tunables.attack.impactLife });
  }

  // Wipe every transient effect — blood pools, gore, impacts,
  // explosions, bloods, arcs. Called on level regen so dead-enemy
  // pools from the previous level don't carry over and accumulate.
  // Tracers + flashes are pool-backed (no allocations to release)
  // so they're handled with a simple hide pass.
  clearAll() {
    const dispose = (arr) => {
      for (const it of arr) {
        const m = it.mesh || it.line || it;
        if (m) {
          if (m.parent) m.parent.remove(m);
          else if (this.scene && m.isObject3D) this.scene.remove(m);
          if (m.geometry?.dispose) m.geometry.dispose();
          if (m.material?.dispose) m.material.dispose();
        }
      }
      arr.length = 0;
    };
    dispose(this.pools);
    dispose(this.gore);
    // Impacts are a mix of pool-backed (spawnImpact) and direct-allocated
    // (deflect-flash). Release the pooled ones and dispose the rest.
    for (const im of this.impacts) {
      if (im.entry) {
        im.entry.mesh.visible = false;
        im.entry.inUse = false;
      } else if (im.mesh) {
        if (im.mesh.parent) im.mesh.parent.remove(im.mesh);
        im.mesh.geometry?.dispose();
        im.mesh.material?.dispose();
      }
    }
    this.impacts.length = 0;
    dispose(this.arcs);
    // Bloods are pool-backed — hide + release each slot, no dispose.
    for (const b of this.bloods) {
      if (b.slot) { b.mesh.visible = false; b.slot.inUse = false; }
      else if (b.mesh) {
        this.scene.remove(b.mesh);
        b.mesh.geometry?.dispose();
        b.mesh.material?.dispose();
      }
    }
    this.bloods.length = 0;
    // Explosions — fireball + ring are now pool-backed (see
    // _ensurePools), so release the entry instead of disposing.
    // Direct-allocated explosions from older code paths still get
    // disposed; both shapes coexist for safety.
    for (const e of this.explosions) {
      if (e.exEntry) {
        e.exEntry.fireball.visible = false;
        e.exEntry.ring.visible = false;
        e.exEntry.fireball.material.opacity = 0;
        e.exEntry.ring.material.opacity = 0;
        e.exEntry.inUse = false;
      } else {
        if (e.fireball) { this.scene.remove(e.fireball); e.fireball.geometry?.dispose(); e.fireball.material?.dispose(); }
        if (e.ring)     { this.scene.remove(e.ring);     e.ring.geometry?.dispose();     e.ring.material?.dispose(); }
      }
      if (e.lightSlot) {
        e.lightSlot.light.intensity = 0;
        e.lightSlot.light.position.set(0, -1000, 0);
        e.lightSlot.inUse = false;
      }
    }
    this.explosions.length = 0;
    // Pooled tracers / flashes — return to pool, no dispose.
    if (this._tracerPool) {
      for (const t of this._tracerPool) {
        if (t.inUse) { t.line.visible = false; t.inUse = false; }
      }
    }
    if (this._flashPool) {
      for (const f of this._flashPool) {
        if (f.inUse) {
          f.mesh.visible = false;
          if (f.light) f.light.intensity = 0;
          f.inUse = false;
        }
      }
    }
    this.tracers.length = 0;
    this.flashes.length = 0;
    // Flame particles — pool-backed. Hide + release each in-flight
    // entry; non-pool entries (legacy) get disposed normally.
    for (const fp of this.flameParticles) {
      if (fp.entry) {
        fp.entry.mesh.visible = false;
        fp.entry.inUse = false;
      } else if (fp.mesh) {
        if (fp.mesh.parent) fp.mesh.parent.remove(fp.mesh);
        fp.mesh.geometry?.dispose();
        fp.mesh.material?.dispose();
      }
    }
    this.flameParticles.length = 0;
  }

  update(dt) {
    // Tracers — pool-backed. On expire, hide + return the entry
    // instead of disposing its resources.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      const entry = tr.entry;
      entry.line.material.opacity = Math.max(0, 1 - tr.t / tr.life);
      if (tr.t >= tr.life) {
        entry.line.visible = false;
        entry.inUse = false;
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i];
      fl.t += dt;
      const k = 1 - fl.t / fl.life;
      const flash = fl.flash;
      flash.mesh.scale.setScalar(1.6 * (0.5 + k * 0.5));
      flash.mesh.material.opacity = Math.max(0, k);
      if (fl.lightEntry) fl.lightEntry.light.intensity = 3.2 * k * k;
      if (fl.t >= fl.life) {
        flash.mesh.visible = false;
        flash.inUse = false;
        if (fl.lightEntry) {
          fl.lightEntry.light.intensity = 0;
          fl.lightEntry.light.position.set(0, -1000, 0);
          fl.lightEntry.inUse = false;
        }
        this.flashes.splice(i, 1);
      }
    }
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const im = this.impacts[i];
      im.t += dt;
      const k = 1 - im.t / im.life;
      // Two callers in flight today:
      //   * spawnImpact uses pooled entries (im.entry.mesh)
      //   * deflect-flash + legacy paths still allocate directly (im.mesh)
      const mesh = im.entry ? im.entry.mesh : im.mesh;
      mesh.scale.setScalar(0.5 + (1 - k) * 1.2);
      mesh.material.opacity = Math.max(0, k);
      if (im.t >= im.life) {
        if (im.entry) {
          // Pool path — hide + release, no dispose.
          mesh.visible = false;
          im.entry.inUse = false;
        } else {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
        this.impacts.splice(i, 1);
      }
    }
    // Blood droplets — ballistic arc + fade. Pool-backed: on expire
    // we hide the slot's mesh and return it to the pool instead of
    // disposing geometry/material per particle.
    for (let i = this.bloods.length - 1; i >= 0; i--) {
      const b = this.bloods[i];
      b.t += dt;
      b.vel.y -= 18 * dt;
      b.mesh.position.x += b.vel.x * dt;
      b.mesh.position.y += b.vel.y * dt;
      b.mesh.position.z += b.vel.z * dt;
      if (b.mesh.position.y < 0.04) {
        b.mesh.position.y = 0.04;
        b.vel.set(0, 0, 0);
      }
      b.mesh.material.opacity = Math.max(0, 0.95 * (1 - b.t / b.life));
      if (b.t >= b.life) {
        if (b.slot) {
          // Pool path — hide + return.
          b.mesh.visible = false;
          b.slot.inUse = false;
        } else {
          // Legacy non-pooled (shouldn't happen post-pool, kept as
          // defense in case clearAll injects a non-pool entry).
          this.scene.remove(b.mesh);
          b.mesh.geometry?.dispose();
          b.mesh.material?.dispose();
        }
        this.bloods.splice(i, 1);
      }
    }

    // Blood pools — fade in, persist, eventually despawn.
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      p.t += dt;
      if (p.t < p.fadeIn) {
        p.mesh.material.opacity = p.maxOpacity * (p.t / p.fadeIn);
      } else {
        p.mesh.material.opacity = p.maxOpacity;
      }
      if (p.t >= p.life) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.pools.splice(i, 1);
      }
    }

    // Gore (detached heads) — physics arc, then settle and decay.
    for (let i = this.gore.length - 1; i >= 0; i--) {
      const g = this.gore[i];
      g.t += dt;
      if (!g.settled) {
        g.vel.y -= 14 * dt;
        g.mesh.position.x += g.vel.x * dt;
        g.mesh.position.y += g.vel.y * dt;
        g.mesh.position.z += g.vel.z * dt;
        g.mesh.rotation.x += g.spin.x * dt;
        g.mesh.rotation.y += g.spin.y * dt;
        g.mesh.rotation.z += g.spin.z * dt;
        if (g.mesh.position.y < 0.12) {
          g.mesh.position.y = 0.12;
          g.vel.multiplyScalar(0.3);
          g.vel.y = Math.max(0, g.vel.y * 0.3);
          g.spin.multiplyScalar(0.4);
          if (g.vel.lengthSq() < 0.05 && Math.abs(g.spin.x) + Math.abs(g.spin.z) < 0.4) {
            g.settled = true;
          }
        }
      }
      if (g.t >= g.life) {
        this.scene.remove(g.mesh);
        this.gore.splice(i, 1);
      }
    }

    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const ar = this.arcs[i];
      ar.t += dt;
      const k = 1 - ar.t / ar.life;
      ar.line.material.opacity = Math.max(0, k);
      if (ar.shockwave) {
        ar.line.scale.setScalar(0.6 + (1 - k) * 1.4);
      }
      if (ar.t >= ar.life) {
        this.scene.remove(ar.line);
        ar.line.geometry.dispose();
        ar.line.material.dispose();
        this.arcs.splice(i, 1);
      }
    }

    // Flame particles — transparent primitives that fly forward, drift
    // upward, grow as they age, and STOP on wall contact so cover
    // actually protects against the flamethrower cone. Damage itself
    // is still resolved by the caller's cone test (see tickFlame); the
    // particles are visual, but the wall stop keeps visual and damage
    // model in sync.
    for (let i = this.flameParticles.length - 1; i >= 0; i--) {
      const fp = this.flameParticles[i];
      fp.t += dt;
      // Pool-backed: read from entry.mesh. Older direct-allocated
      // path (if any caller still uses fp.mesh) is preserved as a
      // fallback for safety.
      const mesh = fp.entry ? fp.entry.mesh : fp.mesh;
      const baseScale = fp.baseScale || 1;
      if (!fp.stopped) {
        const nx = mesh.position.x + fp.vx * dt;
        const nz = mesh.position.z + fp.vz * dt;
        let blocked = false;
        const pr = 0.1;
        for (const o of this._flameBlockers) {
          const b = o.userData?.collisionXZ;
          if (!b) continue;
          if (nx > b.minX - pr && nx < b.maxX + pr
           && nz > b.minZ - pr && nz < b.maxZ + pr) {
            blocked = true;
            break;
          }
        }
        if (blocked) {
          fp.stopped = true;
          fp.vx = 0; fp.vz = 0;
          fp.life = Math.min(fp.life, fp.t + 0.15);
        } else {
          mesh.position.x = nx;
          mesh.position.z = nz;
        }
        mesh.position.y += fp.vy * dt;
        fp.vx *= 1 - Math.min(1, 1.8 * dt);
        fp.vz *= 1 - Math.min(1, 1.8 * dt);
      }
      const k = Math.max(0, 1 - fp.t / fp.life);
      const scale = baseScale * (1 + (fp.grow * (1 - k) * 0.6));
      mesh.scale.setScalar(scale);
      mesh.material.opacity = 0.65 * k * k;
      if (fp.t >= fp.life) {
        if (fp.entry) {
          mesh.visible = false;
          fp.entry.inUse = false;
        } else {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
        this.flameParticles.splice(i, 1);
      }
    }

    // Explosions — fireball swells to 1.0× radius, ring expands to
    // 1.4× radius, light intensity dies off quadratically.
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i];
      ex.t += dt;
      const k = ex.t / ex.life;            // 0 → 1
      const kInv = 1 - k;
      const fireScale = ex.radius * Math.min(1.0, 0.3 + k * 1.5);
      ex.fireball.scale.setScalar(fireScale);
      ex.fireball.material.opacity = Math.max(0, 0.95 * kInv);
      const ringScale = ex.radius * (0.3 + k * 1.2);
      ex.ring.scale.setScalar(ringScale);
      ex.ring.material.opacity = Math.max(0, 0.85 * kInv * kInv);
      ex.lightSlot.light.intensity = 6.0 * kInv * kInv;
      if (ex.t >= ex.life) {
        // Pool-backed fireball + ring — hide + release, no dispose.
        if (ex.exEntry) {
          ex.exEntry.fireball.visible = false;
          ex.exEntry.ring.visible = false;
          ex.exEntry.fireball.material.opacity = 0;
          ex.exEntry.ring.material.opacity = 0;
          ex.exEntry.inUse = false;
        }
        // Release the pooled light — park it dim and off-screen.
        ex.lightSlot.light.intensity = 0;
        ex.lightSlot.light.position.set(0, -1000, 0);
        ex.lightSlot.inUse = false;
        this.explosions.splice(i, 1);
      }
    }
  }

  // --- Pooled spawn paths --------------------------------------------
  // Pre-allocated tracer Lines, flash meshes, and PointLights. Pool
  // members are created once at module init, parked in the scene with
  // `visible=false` (and `intensity=0` for lights), and recycled on
  // each spawn instead of freshly allocating Three.js resources.
  //
  // Why this matters:
  //   * Line allocation per bullet was creating a BufferGeometry +
  //     LineBasicMaterial + WebGL upload per shot. 9-pellet shotgun =
  //     27 fresh objects per fire.
  //   * Adding a PointLight to the scene increments the light count
  //     in the shader cache key — Three.js recompiles every shader
  //     that uses lights on next render. THAT is the "shotgun fires
  //     and the frame freezes" spike. Lights never leave the pool,
  //     so the count is fixed and shaders are stable.
  _ensurePools() {
    if (this._poolsReady) return;
    this._poolsReady = true;
    const TRACER_POOL = 48;
    const FLASH_POOL  = 24;
    const LIGHT_POOL  = 8;      // max concurrent flash lights
    // Tracers — two-vertex Line with a shared-per-entry material so
    // each can fade its own opacity independently.
    this._tracerPool = [];
    for (let i = 0; i < TRACER_POOL; i++) {
      const geom = new THREE.BufferGeometry();
      const pts = new Float32Array(6);
      geom.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      geom.setDrawRange(0, 2);
      const mat = new THREE.LineBasicMaterial({
        color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false,
      });
      const line = new THREE.Line(geom, mat);
      line.frustumCulled = false;
      line.visible = false;
      this.scene.add(line);
      this._tracerPool.push({ line, pts, inUse: false });
    }
    // Flash meshes — additive sphere with per-entry material so the
    // shrink / fade animation is local to each flash.
    this._flashPool = [];
    const flashGeom = new THREE.SphereGeometry(0.28, 10, 8);
    for (let i = 0; i < FLASH_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe0a0, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(flashGeom, mat);
      m.visible = false;
      m.frustumCulled = false;
      this.scene.add(m);
      this._flashPool.push({ mesh: m, inUse: false });
    }
    // PointLight pool — lives in the scene FOREVER at intensity 0.
    // We never add/remove them mid-game; only mutate intensity.
    // Three.js caches shaders keyed on light count; keeping the
    // count fixed at `LIGHT_POOL` means zero recompile spikes during
    // combat.
    this._lightPool = [];
    for (let i = 0; i < LIGHT_POOL; i++) {
      const L = new THREE.PointLight(0xffcf80, 0, 4.5, 1.8);
      L.position.set(0, -1000, 0); // parked below floor to be safe
      this.scene.add(L);
      this._lightPool.push({ light: L, inUse: false });
    }
    // Impact spark pool — small additive sphere per bullet hit. Was
    // allocating a fresh SphereGeometry + MeshBasicMaterial per call
    // inside spawnImpact; with shotgun pellets across multiple
    // targets this fired 20+ times per shot. Pool a fixed 32.
    const IMPACT_POOL = 32;
    this._impactPool = [];
    const impactGeom = new THREE.SphereGeometry(0.15, 8, 6);
    for (let i = 0; i < IMPACT_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffbb55, transparent: true, opacity: 0,
        depthWrite: false,
      });
      const m = new THREE.Mesh(impactGeom, mat);
      m.visible = false;
      m.frustumCulled = false;
      this.scene.add(m);
      this._impactPool.push({ mesh: m, inUse: false });
    }
    // Flame particle pool. spawnFlameParticles fires 7 spheres per
    // flame-weapon tick (~60Hz while held) — that's 420 mesh +
    // material allocations per second of held trigger, plus the
    // matching disposes ~0.6s later. Pool 80 (7 × ~10 frames of
    // life leaves a little headroom) sharing one SphereGeometry.
    const FLAME_POOL = 80;
    this._flamePool = [];
    const flameGeom = new THREE.SphereGeometry(0.4, 6, 4);
    for (let i = 0; i < FLAME_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff7030, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(flameGeom, mat);
      m.visible = false;
      m.frustumCulled = false;
      this.scene.add(m);
      this._flamePool.push({ mesh: m, inUse: false });
    }
    // Explosion fireball + scorch-ring pool. spawnExplosion was
    // creating a fresh SphereGeometry + RingGeometry + 2 materials
    // per detonation, then disposing them ~0.55s later. With
    // grenades / claymores / The Gift, this churned hard during a
    // boss fight. Pool 12 (more than enough for simultaneous
    // detonations); each entry holds the fireball + ring meshes
    // reused per spawn.
    const EXPLOSION_POOL = 12;
    this._explosionPool = [];
    const fireballGeom = new THREE.SphereGeometry(1.0, 16, 12);
    const ringGeom = new THREE.RingGeometry(0.6, 0.9, 32);
    for (let i = 0; i < EXPLOSION_POOL; i++) {
      const fmat = new THREE.MeshBasicMaterial({
        color: 0xffb040, transparent: true, opacity: 0, depthWrite: false,
      });
      const fireball = new THREE.Mesh(fireballGeom, fmat);
      fireball.visible = false;
      fireball.frustumCulled = false;
      this.scene.add(fireball);
      const rmat = new THREE.MeshBasicMaterial({
        color: 0xffe080, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeom, rmat);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.frustumCulled = false;
      this.scene.add(ring);
      this._explosionPool.push({ fireball, ring, inUse: false });
    }
  }

  _spawnTracer(a, b, color) {
    this._ensurePools();
    // Pick an idle tracer, or recycle the oldest in-use one.
    let entry = this._tracerPool.find(e => !e.inUse);
    if (!entry) entry = this._tracerPool[0];   // starved → overwrite oldest
    entry.inUse = true;
    entry.pts[0] = a.x; entry.pts[1] = a.y; entry.pts[2] = a.z;
    entry.pts[3] = b.x; entry.pts[4] = b.y; entry.pts[5] = b.z;
    entry.line.geometry.attributes.position.needsUpdate = true;
    entry.line.material.color.setHex(color ?? 0xffd27a);
    entry.line.material.opacity = 1;
    entry.line.visible = true;
    this.tracers.push({ entry, t: 0, life: tunables.attack.tracerLife });
  }

  _spawnFlash(origin, color, withLight = true) {
    this._ensurePools();
    // Pick an idle flash mesh or recycle oldest.
    let flash = this._flashPool.find(e => !e.inUse);
    if (!flash) flash = this._flashPool[0];
    flash.inUse = true;
    flash.mesh.position.copy(origin);
    flash.mesh.scale.setScalar(1.6);
    flash.mesh.material.color.setHex(color ?? 0xffe0a0);
    flash.mesh.material.opacity = 1;
    flash.mesh.visible = true;
    // Flash light (only if requested) — grab one from the pool and
    // set its intensity. Never added/removed, so no shader recompile.
    let lightEntry = null;
    if (withLight) {
      lightEntry = this._lightPool.find(e => !e.inUse);
      if (!lightEntry) lightEntry = this._lightPool[0];
      lightEntry.inUse = true;
      lightEntry.light.color.setHex(color ?? 0xffcf80);
      lightEntry.light.position.copy(origin);
      lightEntry.light.intensity = 3.2;
    }
    this.flashes.push({
      flash, lightEntry,
      t: 0, life: tunables.attack.muzzleFlashLife,
    });
  }
}
