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
  }

  setFlameBlockers(list) { this._flameBlockers = list || []; }

  // Big orange fireball + expanding shock ring + falling sparks.
  // `radius` is the AoE radius; the fireball peaks at 1.0× and the
  // ring reaches 1.4× before fading. Auto-fades in ~0.55s.
  spawnExplosion(point, radius = 5.0) {
    const fireballMat = new THREE.MeshBasicMaterial({
      color: 0xffb040, transparent: true, opacity: 0.95, depthWrite: false,
    });
    const fireball = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 16, 12), fireballMat,
    );
    fireball.position.copy(point);
    fireball.scale.setScalar(0.2);
    this.scene.add(fireball);

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffe080, transparent: true, opacity: 0.85,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.9, 32), ringMat,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(point.x, 0.06, point.z);
    this.scene.add(ring);

    // Hot white flash + light so the explosion actually lights
    // surrounding geometry for one beat.
    const light = new THREE.PointLight(0xffcf60, 6.0, radius * 2.2);
    light.position.copy(point);
    this.scene.add(light);

    this.explosions.push({
      fireball, ring, light, t: 0, life: 0.55, radius,
    });
    // Sparks — reuse blood-burst physics with a warm tint, a few
    // bigger particles so the debris reads at distance.
    for (let i = 0; i < 14; i++) {
      const m = new THREE.MeshBasicMaterial({
        color: i % 2 ? 0xffa040 : 0xff6020, transparent: true, opacity: 0.95, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12 + Math.random() * 0.08, 6, 4), m);
      mesh.position.copy(point);
      this.scene.add(mesh);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        3 + Math.random() * 4,
        (Math.random() - 0.5) * 8,
      );
      this.bloods.push({ mesh, vel, t: 0, life: 0.6 + Math.random() * 0.35 });
    }
  }

  spawnBloodBurst(point, dir, amount = 5) {
    if (this.bloods.length > this._bloodCap) amount = Math.max(1, (amount / 2) | 0);
    const d = (dir && dir.lengthSq && dir.lengthSq() > 0.0001) ? dir : new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < amount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xa01818, transparent: true, opacity: 0.95, depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.06 + Math.random() * 0.05, 6, 4), mat);
      mesh.position.copy(point);
      this.scene.add(mesh);
      const speed = 1.5 + Math.random() * 2.5;
      const vel = new THREE.Vector3(
        d.x * speed + (Math.random() - 0.5) * 1.5,
        2.5 + Math.random() * 2.5,
        d.z * speed + (Math.random() - 0.5) * 1.5,
      );
      this.bloods.push({ mesh, vel, t: 0, life: 0.55 + Math.random() * 0.3 });
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
    const mat = new THREE.MeshBasicMaterial({
      color: color ?? 0xffffff, transparent: true, opacity: 1, depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mat);
    m.position.copy(point);
    this.scene.add(m);
    this.impacts.push({ mesh: m, t: 0, life: tunables.block.deflectFlashLife });
  }

  // Filled cone of flame at ground level — call once per flame tick for a
  // flickering continuous-spray effect.
  // Per-tick stream of transparent flame primitives. Each is a sphere
  // that flies forward with slight upward drift, fades out, and stops
  // on wall contact. Replaces the flat cone mesh — reads as volumetric
  // and respects cover, which matters now that walls occlude LoS.
  spawnFlameParticles(origin, facing, range, angleRad) {
    const N = 7;
    const baseSpeed = range / 0.28;  // cover full range in ~0.28s
    for (let i = 0; i < N; i++) {
      const spread = (Math.random() - 0.5) * angleRad;
      const c = Math.cos(spread), s = Math.sin(spread);
      const vx = facing.x * c - facing.z * s;
      const vz = facing.x * s + facing.z * c;
      const speed = baseSpeed * (0.8 + Math.random() * 0.4);
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? 0xffcc40 : (i % 3 === 1 ? 0xff7030 : 0xff4420),
        transparent: true, opacity: 0.65,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const r = 0.25 + Math.random() * 0.25;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), mat);
      m.position.set(
        origin.x + (Math.random() - 0.5) * 0.15,
        0.8 + Math.random() * 0.4,
        origin.z + (Math.random() - 0.5) * 0.15,
      );
      this.scene.add(m);
      this.flameParticles.push({
        mesh: m,
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

  // True if nothing in `blockers` lies between `from` and `to`.
  hasLineOfSight(from, to, blockers) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist < 0.0001) return true;
    dir.normalize();
    this.raycaster.set(from, dir);
    this.raycaster.far = dist;
    return this.raycaster.intersectObjects(blockers, false).length === 0;
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
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffbb55, transparent: true, opacity: 1, depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), mat);
    m.position.copy(point);
    this.scene.add(m);
    this.impacts.push({ mesh: m, t: 0, life: tunables.attack.impactLife });
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
      im.mesh.scale.setScalar(0.5 + (1 - k) * 1.2);
      im.mesh.material.opacity = Math.max(0, k);
      if (im.t >= im.life) {
        this.scene.remove(im.mesh);
        im.mesh.geometry.dispose();
        im.mesh.material.dispose();
        this.impacts.splice(i, 1);
      }
    }
    // Blood droplets — ballistic arc + fade.
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
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
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
      if (!fp.stopped) {
        const nx = fp.mesh.position.x + fp.vx * dt;
        const nz = fp.mesh.position.z + fp.vz * dt;
        let blocked = false;
        const px = fp.mesh.position.x, pz = fp.mesh.position.z;
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
          // Shorten the remaining life so stopped particles don't
          // linger as static orange blobs against the wall.
          fp.life = Math.min(fp.life, fp.t + 0.15);
        } else {
          fp.mesh.position.x = nx;
          fp.mesh.position.z = nz;
        }
        fp.mesh.position.y += fp.vy * dt;
        // Horizontal drag so the stream decelerates into the curl
        // you see from a real flame jet.
        fp.vx *= 1 - Math.min(1, 1.8 * dt);
        fp.vz *= 1 - Math.min(1, 1.8 * dt);
        void px; void pz;
      }
      // Expand + fade. Scale ramps out to give the billow-out look;
      // opacity drops faster once past 60% of life.
      const k = Math.max(0, 1 - fp.t / fp.life);
      const scale = 1 + (fp.grow * (1 - k) * 0.6);
      fp.mesh.scale.setScalar(scale);
      fp.mesh.material.opacity = 0.65 * k * k;
      if (fp.t >= fp.life) {
        this.scene.remove(fp.mesh);
        fp.mesh.geometry.dispose();
        fp.mesh.material.dispose();
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
      ex.light.intensity = 6.0 * kInv * kInv;
      if (ex.t >= ex.life) {
        this.scene.remove(ex.fireball);
        this.scene.remove(ex.ring);
        this.scene.remove(ex.light);
        ex.fireball.geometry.dispose();
        ex.fireball.material.dispose();
        ex.ring.geometry.dispose();
        ex.ring.material.dispose();
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
