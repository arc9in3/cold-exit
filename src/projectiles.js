// Projectile system — gravity-affected ballistic rounds (grenades,
// rockets, thrown frags). Each projectile integrates its own position
// each frame, collides with level obstacles and enemies, and on
// detonation applies AoE damage via the supplied onExplode callback.
// Kept deliberately simple: no rigid-body physics, no per-vertex
// collision — just AABB checks against `level.solidObstacles()` and
// radius checks against the enemy list.
import * as THREE from 'three';

export class ProjectileManager {
  constructor(scene) {
    this.scene = scene;
    this.projectiles = [];
  }

  // Remove every in-flight + settled projectile + their meshes.
  // Called on level regen so claymores and unexploded grenades from
  // the previous floor don't persist into the new one.
  removeAll() {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      if (p.body) {
        this.scene.remove(p.body);
        p.body.geometry?.dispose?.();
        if (p.body.material) {
          if (Array.isArray(p.body.material)) p.body.material.forEach(m => m.dispose());
          else p.body.material.dispose();
        }
      }
      if (p.trail) {
        this.scene.remove(p.trail);
        p.trail.geometry?.dispose?.();
        p.trail.material?.dispose?.();
      }
    }
    this.projectiles = [];
  }

  // spec: {
  //   pos: Vector3, vel: Vector3,
  //   type: 'grenade' | 'rocket' | 'throwable',
  //   lifetime: seconds (fuse; 0 means impact-only),
  //   radius: visual sphere radius,
  //   color: hex (trail + body tint),
  //   explosion: { radius, damage, shake },
  //   owner: 'player' | 'enemy',
  //   gravity: m/s² (0 for rockets that fly straight),
  //   bounciness: 0..1 (grenades bounce off walls/ground),
  // }
  spawn(spec) {
    // Caller can supply a custom Object3D for the in-flight visual
    // (e.g. The Gift's little red bear). Falls back to a tinted
    // sphere when omitted — the default for every other throwable.
    let body;
    if (spec.customBody) {
      body = spec.customBody;
    } else {
      body = new THREE.Mesh(
        new THREE.SphereGeometry(spec.radius || 0.14, 10, 8),
        new THREE.MeshBasicMaterial({ color: spec.color || 0xffa040 }),
      );
    }
    body.position.copy(spec.pos);
    this.scene.add(body);

    // Thin trail — a stretched emissive cylinder that follows the
    // projectile for about half a second. Helps the player read the
    // arc and lets them lead shots.
    const trail = new THREE.Mesh(
      new THREE.SphereGeometry(spec.radius * 1.6 || 0.22, 6, 4),
      new THREE.MeshBasicMaterial({
        color: spec.color || 0xffa040,
        transparent: true, opacity: 0.35,
      }),
    );
    trail.position.copy(spec.pos);
    this.scene.add(trail);

    this.projectiles.push({
      ...spec,
      pos: spec.pos.clone(),
      vel: spec.vel.clone(),
      body,
      trail,
      age: 0,
      bounces: 0,
      dead: false,
      // Fuse-after-landing tracking — set to the projectile's age the
      // first time it touches ground. Detonation timer runs from then
      // on instead of from spawn, so a thrown grenade arcs, bounces,
      // and settles before going off. Stays -1 for impact-detonating
      // projectiles (rockets, molotov) where the fuse never gates
      // detonation in the first place.
      fuseStartT: -1,
    });
  }

  // Called each tick from main.js. `onExplode(pos, explosion, owner)`
  // should apply AoE damage + visual effects; it's a callback so this
  // module stays decoupled from the damage pipeline.
  update(dt, level, onExplode) {
    // Early-out — no in-flight projectiles means no work. This single
    // line removed a measurable chunk of per-frame cost (profile
    // showed update() at ~0.54s self-time across a long session
    // even when the player wasn't throwing anything).
    if (!this.projectiles.length) return;
    // Scratch vectors reused for detonation positions — was allocating
    // a fresh Vector3 per ground / wall hit.
    const _detPos = this._detPos || (this._detPos = new THREE.Vector3());
    void _detPos;
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.age += dt;

      // Sticky-impact fuse (EX-* Explosive Crossbow path) — once a
      // sticky projectile has hit something (enemy / wall / ground)
      // and entered the stuck state, it stops integrating physics
      // and just runs its fuse timer. When the fuse expires we call
      // the spawn-supplied onDetonate hook FIRST (lets the caller
      // apply stuck-enemy bonus damage with full context), then the
      // standard _detonate fans the AoE explosion. Skipping the
      // rest of the per-frame work avoids any contact-test re-fire
      // that would otherwise double-detonate.
      if (p.stuck && p.stickyImpact) {
        p.stuckT = (p.stuckT || 0) + dt;
        if (p.stuckT >= (p.fuseSec || 0.6)) {
          if (typeof p.onDetonate === 'function') {
            try { p.onDetonate(p); } catch (_) { /* defensive */ }
          }
          this._detPos.copy(p.pos);
          this._detonate(p, this._detPos, onExplode);
        }
        continue;
      }

      // Fuse timeout. Behaviour depends on whether the projectile
      // wants its fuse to start on landing (player throwables — give
      // them time to bounce + settle before going off) or at spawn
      // (rockets, molotovs that detonate on impact). When
      // `fuseAfterLand` is set, we don't even consider the fuse until
      // `fuseStartT` has been stamped by the first ground contact;
      // a `maxAge` safety cap (4× the fuse) catches anything that
      // somehow never lands so a stuck grenade can't roam forever.
      if (p.lifetime > 0) {
        if (p.fuseAfterLand) {
          if (p.fuseStartT >= 0 && (p.age - p.fuseStartT) >= p.lifetime) {
            this._detPos.copy(p.pos); this._detonate(p, this._detPos, onExplode);
            continue;
          }
          // Safety cap — defuse anything that's spent 4× its fuse in
          // flight without ever touching ground (caught in geometry,
          // launched off the level edge, etc.).
          if (p.age >= p.lifetime * 4) {
            this._detPos.copy(p.pos); this._detonate(p, this._detPos, onExplode);
            continue;
          }
        } else if (p.age >= p.lifetime) {
          // Molotov design says the bottle only ignites on floor
          // contact — see the spawn path's `bounciness: 0` for
          // molotovs and the wall-skip branch below. The fuse field
          // is repurposed as a safety cap (8s) so a thrown bottle
          // that never lands (off a ledge, caught in geometry) just
          // fizzles silently instead of igniting mid-air. Without
          // this, a long throw whose lifetime elapses while the
          // bottle is still arcing detonates in midair — exactly
          // the bug playtest reported on 2026-05-11.
          if (p.throwKind === 'molotov') {
            p.dead = true;
            this.scene.remove(p.body);
            p.body.geometry?.dispose?.();
            if (p.body.material) {
              if (Array.isArray(p.body.material)) p.body.material.forEach(m => m.dispose());
              else p.body.material.dispose();
            }
            if (p.trail) {
              this.scene.remove(p.trail);
              p.trail.geometry?.dispose?.();
              p.trail.material?.dispose?.();
            }
            continue;
          }
          this._detPos.copy(p.pos); this._detonate(p, this._detPos, onExplode);
          continue;
        }
      }

      // Integrate gravity + position.
      const g = p.gravity ?? 9.8;
      p.vel.y -= g * dt;
      const nx = p.pos.x + p.vel.x * dt;
      const ny = p.pos.y + p.vel.y * dt;
      const nz = p.pos.z + p.vel.z * dt;

      // Enemy-contact test for impact-style projectiles. Runs AFTER a
      // short arming window so a close-range shot doesn't detonate on
      // an enemy the shooter is already shoulder-to-shoulder with —
      // which would just blow up the player via self-damage.
      const armed = p.age > 0.12;
      if (armed && p.type === 'rocket' && p.owner === 'player') {
        const close = this._nearbyEnemy(p.pos, 0.8);
        if (close) {
          // Sticky-impact (EX-* Explosive Crossbow): bind to the
          // enemy + start the fuse instead of detonating now. The
          // top-of-loop fuse handler picks it up next frame.
          if (p.stickyImpact && !p.stuck) {
            p.stuck = true;
            p.stuckEnemy = close;
            p.stuckT = 0;
            p.vel.set(0, 0, 0);
            p.gravity = 0;
            continue;
          }
          this._detPos.copy(p.pos); this._detonate(p, this._detPos, onExplode);
          continue;
        }
      }
      // Grenades also detonate on a direct torso hit — otherwise
      // players see the round tumble off an enemy's shoulder and
      // bounce into a corner. SKIPPED for fuseAfterLand throwables
      // until the first ground contact: those are designed to arc,
      // bounce, then explode. Mid-air pop on a chest-height enemy
      // contradicted the bounce-and-settle intent and felt buggy.
      //
      // Molotovs are also skipped here — they're glass bottles whose
      // whole point is to break on a SURFACE and spread fire. Players
      // throw them toward a chokepoint or group; popping mid-air on
      // the first enemy in the arc looked like the bottle was
      // detonating before reaching its destination. Floor contact
      // remains the only trigger.
      if (armed && p.type === 'grenade' && p.owner === 'player'
          && p.throwKind !== 'molotov'
          && !(p.fuseAfterLand && p.fuseStartT < 0)) {
        const close = this._nearbyEnemy(p.pos, 0.7);
        if (close) {
          this._detPos.copy(p.pos); this._detonate(p, this._detPos, onExplode);
          continue;
        }
      }

      // Ground contact — floor plane at y=0.
      if (ny <= 0.08) {
        // Sticky-impact: stick at landing point + run the fuse.
        if (p.stickyImpact && !p.stuck) {
          p.pos.set(nx, 0.08, nz);
          p.body.position.copy(p.pos);
          p.trail.position.copy(p.pos);
          p.stuck = true;
          p.stuckEnemy = null;
          p.stuckT = 0;
          p.vel.set(0, 0, 0);
          p.gravity = 0;
          continue;
        }
        if (p.type === 'rocket' || !(p.bounciness > 0)) {
          this._detPos.set(nx, 0.08, nz);
          this._detonate(p, this._detPos, onExplode);
          continue;
        }
        // Bounce: reflect Y velocity, damp horizontal, increment count.
        p.pos.set(nx, 0.08, nz);
        p.vel.y = -p.vel.y * p.bounciness;
        p.vel.x *= 1 - 0.25 * p.bounciness;
        p.vel.z *= 1 - 0.25 * p.bounciness;
        p.bounces += 1;
        // First ground touch starts the fuse for fuseAfterLand
        // throwables. Subsequent bounces don't reset it — once the
        // grenade has hit ground, the countdown is committed.
        if (p.fuseAfterLand && p.fuseStartT < 0) p.fuseStartT = p.age;
        p.body.position.copy(p.pos);
        p.trail.position.copy(p.pos);
        continue;
      }

      // Obstacle contact — AABB check against solid walls. Molotovs
      // skip this check entirely: they're glass bottles arcing high
      // over walls and the only thing that matters is the floor
      // contact (which spawns the fire pool). The previous bounce-
      // off-walls behaviour was confusing — throws looked like they
      // were destroyed mid-air or ricocheted off invisible geometry.
      const hitWall = p.throwKind === 'molotov'
        ? false
        : this._hitsObstacle(level, p.pos.x, p.pos.z, nx, ny, nz, p.pos.y);
      if (hitWall) {
        // Sticky-impact: bind to wall at the contact point + run fuse.
        if (p.stickyImpact && !p.stuck) {
          p.pos.set(nx, Math.max(0.08, ny), nz);
          p.body.position.copy(p.pos);
          p.trail.position.copy(p.pos);
          p.stuck = true;
          p.stuckEnemy = null;
          p.stuckT = 0;
          p.vel.set(0, 0, 0);
          p.gravity = 0;
          continue;
        }
        if (p.type === 'rocket') {
          this._detPos.set(nx, Math.max(0.08, ny), nz);
          this._detonate(p, this._detPos, onExplode);
          continue;
        }
        // Molotovs (bounciness 0) used to detonate immediately on any
        // wall contact, which made mid-arc throws over a low partition
        // pop a fireball in the air. They now BOUNCE off walls with a
        // low coefficient and only detonate on FLOOR contact, matching
        // the player's expectation of a glass bottle skimming a wall
        // and falling. Claymores keep the original on-impact place
        // behavior since they read as a sticky mine.
        if (!(p.bounciness > 0) && p.throwKind !== 'claymore') {
          if (Math.abs(p.vel.x) > Math.abs(p.vel.z)) p.vel.x = -p.vel.x * 0.35;
          else p.vel.z = -p.vel.z * 0.35;
          p.vel.y *= 0.35;
          p.bounces += 1;
          p.body.position.copy(p.pos);
          p.trail.position.copy(p.pos);
          continue;
        }
        if (!(p.bounciness > 0)) {
          this._detPos.set(nx, Math.max(0.08, ny), nz);
          this._detonate(p, this._detPos, onExplode);
          continue;
        }
        // Bounce off wall — flip the dominant horizontal axis. Cheap
        // approximation; a proper swept-AABB would pick the axis by
        // penetration depth, but for grenades the reading is fine.
        if (Math.abs(p.vel.x) > Math.abs(p.vel.z)) p.vel.x = -p.vel.x * p.bounciness;
        else p.vel.z = -p.vel.z * p.bounciness;
        p.vel.y *= p.bounciness;
        p.bounces += 1;
        p.body.position.copy(p.pos);
        p.trail.position.copy(p.pos);
        continue;
      }

      p.pos.set(nx, ny, nz);
      p.body.position.copy(p.pos);
      // Trail lags one sub-step behind.
      p.trail.position.lerp(p.pos, 0.55);

      // Tumble — rockets spin around flight axis, grenades tumble.
      if (p.type === 'rocket') {
        p.body.rotation.z += dt * 12;
      } else {
        p.body.rotation.x += dt * 8;
        p.body.rotation.z += dt * 6;
      }
    }
    // Reap dead entries to keep the list bounded. In-place compaction —
    // the old `.filter()` allocated a fresh array every frame anything
    // was in flight, which added GC churn during grenade-heavy fights.
    let w = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      if (!p.dead) this.projectiles[w++] = p;
    }
    this.projectiles.length = w;
  }

  _hitsObstacle(level, fromX, fromZ, x, y, z, fromY = y) {
    // Walls extend full height (~3m); props / cover / containers
    // are short (~1m). The previous coarse `y > 3` cutoff treated
    // every obstacle's AABB as if it reached 3m, so grenades and
    // molotovs arcing over a couch would 'hit' the couch's invisible
    // ceiling and either bounce or detonate mid-air. Per-obstacle
    // height threshold: tall walls always block, short props only
    // block when the projectile is below their plausible top.
    if (y > 3.0) return false;
    const obstacleGrid = level.projectileObstacleGrid ? level.projectileObstacleGrid() : null;
    const obstacles = obstacleGrid
      ? obstacleGrid.queryAabb(
        Math.min(fromX, x) - 0.1,
        Math.max(fromX, x) + 0.1,
        Math.min(fromZ, z) - 0.1,
        Math.max(fromZ, z) + 0.1,
        this._obstacleScratch || (this._obstacleScratch = []),
      )
      : (level.solidObstacles ? level.solidObstacles() : []);
    const PROP_TOP = 1.5;     // generous over-approximation of cover height
    // Bug #36: grenades thrown FROM BEHIND cover were ricocheting
    // back into the player. When a throwable is *rising* near prop
    // height, the previous-frame y was below the AABB top and the
    // current-frame y is above — the grenade is clearly arcing up
    // and over the cover. Treat that crossing as a clean pass-through
    // rather than a wall hit. Symmetric handling for descents on the
    // far side: if the throwable was already above PROP_TOP on the
    // previous frame, it's coming back down behind cover and we
    // shouldn't snag it on the prop's invisible front face.
    const wasAbovePropTop = fromY > PROP_TOP;
    for (const o of obstacles) {
      const b = o.userData.collisionXZ;
      if (!b) continue;
      const ud = o.userData;
      // Pass 1C — windows. A pristine window is solid (matches a wall),
      // but the projectile collision applies window damage on contact
      // and lets the round through if the pane shatters. We don't want
      // every grenade arc bouncing off a window — once shattered, the
      // grenade flies through cleanly. Pre-shatter the projectile pops
      // (registers as a wall hit, applies 1 hit of damage, and
      // detonates per the existing wall-contact branch below).
      if (ud.kind === 'window' && ud.windowState) {
        // If already broken, treat as walk-through.
        if (ud.windowState.broken) continue;
        // Apply 1 hit of damage. The window may or may not shatter
        // from this hit; either way the projectile registers as
        // wall-contact (the round hit a window). Subsequent hits
        // accumulate via the same path.
        //
        // Coop: window damage is host-authoritative (Phase H). The
        // joiner skips the hp decrement + broken-flip and waits for
        // the next snapshot to mirror the host's state. The visual
        // wall-stop still happens locally so the grenade doesn't
        // visibly fly through an intact pane on the joiner's screen
        // — they'll see it pop a frame or two before the host's
        // snapshot catches up. Single-player + host fall through to
        // the mutation path.
        try {
          const _isJoiner = (typeof window !== 'undefined' && window.__coopIsJoiner === true);
          if (!_isJoiner) {
            // Lazy-init once. Inline so this file stays import-free
            // of windows.js (matches the pre-coop pattern).
            if (!this._winDmg) this._winDmg = (s) => { s.hp -= 1; if (s.hp <= 0) { s.broken = true; if (s.collisionProxy) s.collisionProxy.userData.collisionXZ = null; } };
            this._winDmg(ud.windowState);
          }
        } catch (_) { /* defensive */ }
        const r = 0.1;
        if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) {
          return true;
        }
        continue;
      }
      const isShort = !!(ud.isProp || ud.containerRef);
      if (isShort && y > PROP_TOP) continue;
      // For short props, give the rising / falling arc the benefit of
      // the doubt — a grenade visibly above prop height on either the
      // previous or current frame should not collide with the prop's
      // side face. Tall walls keep their original behaviour.
      if (isShort && wasAbovePropTop) continue;
      const r = 0.1;
      if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) {
        return true;
      }
    }
    return false;
  }

  _nearbyEnemy(pos, radius) {
    // Caller supplies the enemy list via `this.enemyLists` — set by
    // main.js each tick so projectiles can scan without importing the
    // manager modules directly.
    if (!this.enemyLists) return null;
    const r2 = radius * radius;
    for (const list of this.enemyLists) {
      for (const c of list) {
        if (!c.alive) continue;
        const dx = c.group.position.x - pos.x;
        const dy = (c.group.position.y + 0.9) - pos.y;
        const dz = c.group.position.z - pos.z;
        if (dx * dx + dy * dy + dz * dz < r2) return c;
      }
    }
    return null;
  }

  _detonate(p, pos, onExplode) {
    p.dead = true;
    this.scene.remove(p.body);
    this.scene.remove(p.trail);
    p.body.geometry.dispose();
    p.body.material.dispose();
    p.trail.geometry.dispose();
    p.trail.material.dispose();
    if (onExplode && p.explosion) onExplode(pos, p.explosion, p.owner, p);
  }

  // Launch helper for the player — computes a ballistic velocity that
  // puts the projectile near `aimPoint` given muzzle position and
  // launch speed. Solves the 2D ballistic equation and picks the low
  // trajectory (feels more like aiming than a lob). Falls back to a
  // straight-line vector if the target is out of range.
  // Launch velocity that lands at `aimPoint` and peaks at `apex`
  // metres above the muzzle. Preferred over `ballisticVelocity` for
  // throwables — we want the arc HEIGHT to scale with distance (a
  // nearby toss barely rises; a long lob peaks higher) instead of
  // fixing speed and letting the ballistic equation pick a huge
  // launch angle on short throws. apex is capped by the caller.
  static ballisticVelocityApex(muzzle, aimPoint, apex, gravity) {
    const dx = aimPoint.x - muzzle.x;
    const dy = aimPoint.y - muzzle.y;
    const dz = aimPoint.z - muzzle.z;
    const horiz = Math.hypot(dx, dz);
    const g = gravity;
    const vy = Math.sqrt(2 * g * Math.max(0.05, apex));
    if (horiz < 0.001) return new THREE.Vector3(0, vy, 0);
    // Time from muzzle up to apex, then down from apex to aim point.
    const tRise = vy / g;
    // Fall distance from apex = (apex - dy). When target is ABOVE
    // muzzle (dy>0) the fall is short; when below (dy<0) it's
    // long. Clamp to 0 so grenades aimed at eye-level enemies still
    // solve (they'll land a little short of the target height).
    const fallH = Math.max(0, apex - dy);
    const tFall = Math.sqrt(2 * fallH / g);
    const totalT = tRise + tFall;
    return new THREE.Vector3(dx / totalT, vy, dz / totalT);
  }

  static ballisticVelocity(muzzle, aimPoint, speed, gravity, opts = {}) {
    const dx = aimPoint.x - muzzle.x;
    const dy = aimPoint.y - muzzle.y;
    const dz = aimPoint.z - muzzle.z;
    const horiz = Math.hypot(dx, dz);
    if (horiz < 0.001) return new THREE.Vector3(0, speed, 0);
    const v2 = speed * speed;
    const g = gravity;
    const under = v2 * v2 - g * (g * horiz * horiz + 2 * dy * v2);
    if (under < 0) {
      // Target out of range — aim straight with a ~15° uptilt.
      const nx = dx / horiz, nz = dz / horiz;
      return new THREE.Vector3(
        nx * speed * 0.97, speed * 0.26, nz * speed * 0.97,
      );
    }
    const root = Math.sqrt(under);
    // Two valid launch angles exist: low (flat) and high (lob). The
    // LOW solution reads as a direct-fire arc — fine for rockets
    // and hurled-hard weapons; the HIGH solution sends the round up
    // then steeply down, which is the classic grenade lob. Caller
    // passes { highAngle: true } for throwables.
    const useHigh = !!opts.highAngle;
    const tanTheta = useHigh
      ? (v2 + root) / (g * horiz)
      : (v2 - root) / (g * horiz);
    const theta = Math.atan(tanTheta);
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    const nx = dx / horiz, nz = dz / horiz;
    return new THREE.Vector3(nx * speed * cosT, speed * sinT, nz * speed * cosT);
  }
}
