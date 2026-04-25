import * as THREE from 'three';
import { tunables } from './tunables.js';
import { buildRig, initAnim, updateAnim, pokeHit, pokeDeath } from './actor_rig.js';
import { spawnSpeechBubble } from './hud.js';

// Melee rusher: idle → chase → windup → swing → recovery. Stockier than the
// gunman so they read as distinct at a glance. No defensive system — they
// commit to hitting the player with a telegraphed swing.
const STATE = { IDLE: 'idle', CHASE: 'chase', WINDUP: 'windup', SWING: 'swing', RECOVERY: 'recovery', DEAD: 'dead' };

// Reused scratch vector for blade-tip world-position lookups each
// frame. Avoids per-frame Vector3 allocations across the whole enemy
// list.
const _enemyTipTmp = new THREE.Vector3();

// Smash-themed chatter — deliberately louder/angrier than gunman
// chatter so rushers read as unhinged. Rolls on an IDLE cooldown.
const MELEE_CHATTER = [
  'SMASH!', 'Break their bones!', 'Rip them apart!',
  'Grrraaah!', 'Crush it!', 'Pound them flat!',
  'FEED ME!', 'Crack it open!', 'Blood!',
  'Where are you hiding?!', "I'll find you!",
  'Come out come out...', 'Hunger.', '*gurgling*',
  'One more...', 'Break everything!', "I'll eat your face!",
];

export class MeleeEnemyManager {
  constructor(scene) {
    this.scene = scene;
    this.enemies = [];
    this._baseBody = new THREE.Color(0x2c3a24);
    this._baseHead = new THREE.Color(0x1e2a18);
    this._hurt = new THREE.Color(0xff4a4a);
  }

  spawn(x, z, opts = {}) {
    const tier = opts.tier || 'normal';
    const roomId = opts.roomId ?? -1;
    const difficultyHp = opts.hpMult || 1;
    const damageMult = opts.damageMult || 1;
    const variant = opts.variant || 'standard';
    const shieldProfile = variant === 'shieldBearer'
      ? { hp: 3.5, scale: 1.25 } : null;
    const hpMult = (tier === 'boss' ? 2.8 : tier === 'subBoss' ? 1.6 : 1)
      * (shieldProfile ? shieldProfile.hp : 1) * difficultyHp;
    // Tier×variant compounds; clamp so a shieldBearer boss doesn't
    // push past ~1.4× normal height.
    const MAX_MELEE_SCALE = 1.45;
    const tierScale = tier === 'boss' ? 1.18 : (tier === 'subBoss' ? 1.08 : 1);
    const scale = Math.min(MAX_MELEE_SCALE,
      tierScale * (shieldProfile ? shieldProfile.scale : 1));

    const bodyHex = tier === 'boss' ? 0x5a1a1a : (tier === 'subBoss' ? 0x3a1e58 : this._baseBody.getHex());
    const headHex = tier === 'boss' ? 0x3a0f10 : (tier === 'subBoss' ? 0x22103e : this._baseHead.getHex());
    const gearHex = tier === 'boss' ? 0x7a3020
                  : tier === 'subBoss' ? 0x5a1f28
                  : (variant === 'shieldBearer' ? 0x606060 : 0x26221c);

    // Jointed rig — shared with gunmen + player. Melee rushers are a
    // touch stouter than gunmen so bodyColor/legColor push darker and
    // headColor picks up the tier tint.
    const rig = buildRig({
      scale: 0.77,          // matches player baseline (~1.85m)
      bodyColor: bodyHex,
      headColor: headHex,
      legColor: 0x1a2212,
      armColor: 0x141012,
      handColor: 0x2a1612,
      gearColor: gearHex,
      bootColor: 0x0a0a08,
    });
    initAnim(rig);
    const group = rig.group;
    group.position.set(x, 0, z);
    group.scale.setScalar(scale);

    const leftLeg  = rig.leftLeg.thigh.mesh;
    const rightLeg = rig.rightLeg.thigh.mesh;
    const torso    = rig.chestMesh;
    const head     = rig.headMesh;
    const { bodyMat, headMat, legMat } = rig.materials;
    // Weapon arm + blade attached to the right wrist so the blade tracks
    // the animated hand. The blade's box reaches forward in +Z from the
    // wrist, giving a sword-held-in-fist read.
    const weaponArm = rig.rightArm.shoulder.mesh;
    weaponArm.userData.zone = 'arm';
    // Blade length axis needs to point along the hand's "forward"
    // (the hand's local -Y direction, which tracks the cumulative
    // arm rotation). Rotating the box +π/2 around X maps its +Z
    // length axis to -Y, matching how the player's gun is oriented
    // in the hand. Without this the blade's +Z pointed up-forward in
    // the melee-stance pose — rushers read as if they were stabbing
    // the ceiling.
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.9),
      new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.35, metalness: 0.7, emissive: 0x110804 }),
    );
    blade.rotation.x = Math.PI / 2;
    blade.position.set(0, -0.55, 0);
    blade.castShadow = true;
    // Parent to wrist, not hand.pivot — hand.pivot carries the grip-
    // curl rotation which would tilt the blade into the floor.
    rig.rightArm.wrist.add(blade);
    // Tip marker — an empty Object3D placed at the far end of the
    // 0.9m blade box (half-length in blade-local +Z). Sampled per
    // frame during a swing to feed the weapon-tip trail ribbon so
    // the FX traces the actual swing path.
    const tipMarker = new THREE.Object3D();
    tipMarker.position.set(0, 0, 0.45);
    blade.add(tipMarker);

    // Off-arm is just the rig's left arm meshes — already built in.
    const offArm = rig.leftArm.shoulder.mesh;

    // Visible gear cues — helmet / chest plate parented to the rig's
    // head + chest so they track animation pose.
    const gearLevel = opts.gearLevel ?? 0;
    // Helmet + chest plate cues sized for the slimmer cylindrical
    // rig (half-sphere helmet, narrower plate).
    if (tier === 'boss' || Math.random() < 0.30 + gearLevel * 0.08) {
      const helmet = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
        new THREE.MeshStandardMaterial({
          color: tier === 'boss' ? 0x6a1a1a : 0x3f4028,
          roughness: 0.6, metalness: 0.3,
        }),
      );
      helmet.position.y = 0.18;
      helmet.castShadow = true;
      rig.head.add(helmet);
    }
    if (tier === 'boss' || variant === 'shieldBearer' || Math.random() < 0.25 + gearLevel * 0.08) {
      // Curved heavy plate matching the rig's tapered chest. Arc
      // covers the front ~150°, stands proud of the built-in plate.
      const plate = new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.34, 0.30,
          0.42,
          14, 1,
          true,
          -Math.PI / 2.4,
          Math.PI / 1.2,
        ),
        new THREE.MeshStandardMaterial({
          color: tier === 'boss' ? 0x7a2222 : 0x3f4028,
          roughness: 0.65, metalness: 0.3,
          side: THREE.DoubleSide,
        }),
      );
      plate.position.set(0, 0.24, 0);
      plate.scale.z = 0.72;
      plate.castShadow = true;
      rig.chest.add(plate);
    }

    const alertMat = new THREE.MeshBasicMaterial({
      color: 0xffa030, transparent: true, opacity: 0, depthTest: false,
    });
    const alert = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 8), alertMat);
    alert.position.y = 2.35;
    alert.rotation.x = Math.PI;
    alert.renderOrder = 2;
    group.add(alert);

    // Windup telegraph — a small ring that fills as they ready the swing.
    const telMat = new THREE.MeshBasicMaterial({
      color: 0xff5030, transparent: true, opacity: 0, depthWrite: false,
    });
    const telegraph = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 8, 20), telMat);
    telegraph.rotation.x = Math.PI / 2;
    telegraph.position.y = 1.3;
    group.add(telegraph);

    this.scene.add(group);

    const e = {
      group, leftLeg, rightLeg, torso, head, weaponArm, blade, offArm, alert, alertMat,
      telegraph, telMat,
      tipMarker,
      // Prev-frame blade-tip world position; filled while in WINDUP
      // or SWING state so the trail stitches segment-to-segment
      // across the swing path.
      _tipTrailPrev: null,
      bodyMat, headMat, legMat,
      rig,
      tier,
      variant,
      roomId,
      damageMult,
      hp: tunables.meleeEnemy.maxHealth * hpMult,
      maxHp: tunables.meleeEnemy.maxHealth * hpMult,
      alive: true,
      state: STATE.IDLE,
      swingT: 0,
      recoveryT: 0,
      cooldownT: 0,
      flashT: 0,
      deathT: 0,
      knockVel: new THREE.Vector3(),
      disarmed: false,
      burnT: 0,
      surpriseT: 0,   // brief freeze after a throwable detonation; see main.js
      blindT: 0,
      dazzleT: 0,
      dashT: 0,
      dashCdT: 0.5 + Math.random() * 0.5,
      homeX: x, homeZ: z,
      suspicion: 0,     // see gunman.js for the shared stealth model
      chatterT: 5 + Math.random() * 7,
      stuckX: x, stuckZ: z, stuckT: 0,
      // Major-boss flags — Assassin archetype ships here because the
      // fighter lives in melee_enemy, not gunman.
      majorBoss: !!opts.majorBoss,
      archetype: opts.archetype || null,
      assassinPhase: 'closing',
      assassinDmgTaken: 0,
      assassinRetreatT: 0,
      // Assassin archetype lurks invisible until the player triggers
      // their detection. The flag tells the per-frame visibility
      // pass to render the body at zero opacity until materializing.
      // Materialization happens in the suspicion ramp (see update).
      cloaked: opts.archetype === 'assassin',
    };
    e.manager = this;
    if (rig) for (const m of rig.meshes) m.userData.owner = e;
    leftLeg.userData.owner = e;
    rightLeg.userData.owner = e;
    torso.userData.owner = e;
    head.userData.owner = e;
    weaponArm.userData.owner = e;
    offArm.userData.owner = e;

    if (variant === 'shieldBearer') {
      const shieldMat = new THREE.MeshStandardMaterial({
        color: 0x4a6a88, roughness: 0.5, metalness: 0.4, emissive: 0x0a1420,
        side: THREE.DoubleSide,
      });
      // Curved ballistic panel — open-ended cylinder wedge gives the
      // characteristic riot-shield arc. Radius 1.0 with a 0.7 rad
      // span puts the outer face at roughly z=+0.55 from the enemy's
      // origin (axis offset backwards so the shell sits in front of
      // the body), arc width ~0.7 m, height 1.15 m — chest-to-knee
      // coverage, not the prior 2.1 m slab.
      const shieldGeom = new THREE.CylinderGeometry(
        1.0, 1.0, 1.15, 24, 1, true,
        -0.35, 0.7,
      );
      const shieldMesh = new THREE.Mesh(shieldGeom, shieldMat);
      shieldMesh.position.set(0, 1.05, -0.45);
      shieldMesh.castShadow = true;
      shieldMesh.userData = { zone: 'shield', owner: e };
      group.add(shieldMesh);
      // Dark visor slit across the upper panel — purely cosmetic, no
      // separate hit zone. Slightly larger radius so it z-fights
      // cleanly on top of the shield face.
      const visorMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a0a, roughness: 0.85, metalness: 0.15,
        side: THREE.DoubleSide,
      });
      const visor = new THREE.Mesh(
        new THREE.CylinderGeometry(
          1.005, 1.005, 0.11, 24, 1, true,
          -0.28, 0.56,
        ),
        visorMat,
      );
      visor.position.set(0, 1.45, -0.45);
      group.add(visor);
      e.shield = { mesh: shieldMesh, visor, hp: 260, maxHp: 260, fullBlock: true };
    }

    this.enemies.push(e);
    return e;
  }

  removeAll() {
    for (const e of this.enemies) {
      e.group.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
      this.scene.remove(e.group);
    }
    this.enemies = [];
  }

  hittables() {
    const out = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.rig) {
        const rightArmMeshes = new Set([
          e.rig.rightArm.shoulder.mesh,
          e.rig.rightArm.shoulderBulge,
          e.rig.rightArm.shoulderPad,
          e.rig.rightArm.forearm.mesh,
          e.rig.rightArm.elbowBulge,
          e.rig.rightArm.wristCuff,
          e.rig.rightArm.hand.mesh,
        ]);
        for (const m of e.rig.meshes) {
          if (e.disarmed && rightArmMeshes.has(m)) continue;
          out.push(m);
        }
      }
      if (e.shield && e.shield.hp > 0) out.push(e.shield.mesh);
    }
    return out;
  }

  applyHit(e, damage, zone, hitDir, opts = {}) {
    const drops = [];
    if (!e.alive) return { drops, blocked: false };

    // Assassin archetype — blocks bullets at range. Melee and shotgun
    // blows ignore the block (the player's counterplay is to close),
    // and the block cuts off entirely once the boss is inside 5m so
    // point-blank shots still bite.
    if (e.archetype === 'assassin' && opts.weaponClass !== 'melee'
        && opts.weaponClass !== 'shotgun' && hitDir) {
      const dx = hitDir.x;   // unit vector from attacker
      void dx;
      const distToPlayer = e._lastRangeToPlayer || 10;
      if (distToPlayer > 5) {
        damage *= 0.12;    // heavy block — sparks only, chips 12% through
        e._blockFlashT = 0.12;
      }
    }

    // Frontal shield absorbs damage until the shield breaks. Shotgun and
    // melee hits to the shield destroy it outright.
    if (e.shield && e.shield.hp > 0 && (zone === 'shield' || hitDir)) {
      const fx = Math.sin(e.group.rotation.y), fz = Math.cos(e.group.rotation.y);
      const frontDot = hitDir ? -hitDir.x * fx - hitDir.z * fz : 1;
      if (zone === 'shield' || frontDot > 0.2) {
        const wClass = opts.weaponClass;
        const breaker = wClass === 'shotgun' || wClass === 'melee';
        if (breaker) {
          e.shield.hp = 0;
          this._disableShield(e);
          return { drops, blocked: false, shieldBroke: true };
        }
        e.shield.hp -= damage;
        if (e.shield.hp <= 0) this._disableShield(e);
        e.flashT = tunables.enemy.hitFlashTime;
        return { drops, blocked: true, shieldHit: true };
      }
    }

    // Assassin disengage trigger — after taking enough cumulative
    // damage, the boss dashes far away and restarts the closing
    // pattern. Threshold scales with maxHp so scaling still works.
    if (e.archetype === 'assassin' && e.assassinPhase !== 'disengaging') {
      e.assassinDmgTaken = (e.assassinDmgTaken || 0) + damage;
      if (e.assassinDmgTaken >= e.maxHp * 0.18) {
        e.assassinPhase = 'disengaging';
        e.assassinDmgTaken = 0;
        e.assassinRetreatT = 1.4;
        e.dashCdT = 0;    // allow a fresh escape dash immediately
      }
    }

    e.hp -= damage;
    e.flashT = tunables.enemy.hitFlashTime;
    const isMelee = opts.weaponClass === 'melee';
    let hitMag = Math.max(0.3, Math.min(1.5, damage / Math.max(1, e.maxHp * 0.25)));
    if (isMelee) hitMag = Math.min(2.5, hitMag * 1.7);
    if (hitDir && e.rig) pokeHit(e.rig, hitDir.x, hitDir.z, hitMag);
    if (hitDir) {
      const knockScale = isMelee ? 0.45 : 0.15;
      e.group.position.x += hitDir.x * tunables.enemy.knockback * knockScale;
      e.group.position.z += hitDir.z * tunables.enemy.knockback * knockScale;
      if (isMelee) {
        e.staggerT = Math.max(e.staggerT || 0, 0.4);
      }
    }
    if (zone === 'arm' && !e.disarmed) {
      e.disarmed = true;
      // Hide the whole right-arm chain (the rig's right shoulder pivot).
      if (e.rig) e.rig.rightArm.shoulder.pivot.visible = false;
      else e.weaponArm.visible = false;
      e.blade.visible = false;
    }
    if (e.hp <= 0) {
      e.alive = false;
      e.state = STATE.DEAD;
      e.deathT = 0;
      if (e.rig && hitDir) {
        const deathMag = Math.max(0.6, Math.min(3.0, damage / Math.max(1, e.maxHp * 0.3)));
        pokeDeath(e.rig, hitDir.x, hitDir.z, deathMag);
      }
      // Brief ragdoll-lite phase — same as gunman: hit-direction
      // drift + gravity + collision until the body settles.
      e.deathPhys = {
        vx: (hitDir?.x || 0) * 3.2,
        vy: 2.6 + Math.random() * 0.8,
        vz: (hitDir?.z || 0) * 3.2,
        settled: false,
        settleT: 0,
      };
    }
    return { drops, blocked: false };
  }

  _disableShield(e) {
    if (!e.shield) return;
    if (e.shield.mesh) {
      e.group.remove(e.shield.mesh);
      e.shield.mesh.geometry.dispose();
      e.shield.mesh.material.dispose();
    }
    if (e.shield.visor) {
      e.group.remove(e.shield.visor);
      e.shield.visor.geometry.dispose();
      e.shield.visor.material.dispose();
    }
    e.shield = null;
  }

  applyKnockback(e, impulse) {
    e.knockVel.x += impulse.x;
    e.knockVel.z += impulse.z;
  }

  update(ctx) {
    const dt = ctx.dt;
    // LOD scheduler — same approach as the gunman manager. Idle
    // melee enemies more than 28m from the player tick at half
    // rate, cutting AI cost on big rooms / dense levels.
    const px = ctx.playerPos?.x ?? 0;
    const pz = ctx.playerPos?.z ?? 0;
    const farSq = 28 * 28;
    if (this._frame === undefined) this._frame = 0;
    this._frame++;
    const odd = (this._frame & 1) === 1;
    for (const e of this.enemies) {
      if (e.alive && e.state === STATE.IDLE) {
        const dx = e.group.position.x - px;
        const dz = e.group.position.z - pz;
        if (dx * dx + dz * dz > farSq && odd) continue;
      }
      if (e.flashT > 0) {
        e.flashT = Math.max(0, e.flashT - dt);
        const k = e.flashT / tunables.enemy.hitFlashTime;
        e.bodyMat.color.copy(this._baseBody).lerp(this._hurt, k);
        e.headMat.color.copy(this._baseHead).lerp(this._hurt, k);
      }

      e.blindT = Math.max(0, (e.blindT || 0) - dt);
      e.dazzleT = Math.max(0, (e.dazzleT || 0) - dt);
      // Grenade / flash surprise — freezes the rusher briefly after a
      // throwable detonation alerts them. Drained each frame; the
      // chase/windup logic below skips while surpriseT > 0.
      if (e.surpriseT > 0) e.surpriseT = Math.max(0, e.surpriseT - dt);

      if (e.burnT > 0 && e.alive) {
        e.burnT = Math.max(0, e.burnT - dt);
        const tickDmg = tunables.burn.dps * dt;
        e.hp -= tickDmg;
        ctx.onBurnDamage?.(e, tickDmg);
        if (e.hp <= 0) {
          e.alive = false;
          e.state = STATE.DEAD;
          e.deathT = 0;
          if (ctx.onBurnKill) ctx.onBurnKill(e);
        }
      }

      // Knockback glide with collision.
      if (e.knockVel.lengthSq() > 0.001) {
        const nx = e.group.position.x + e.knockVel.x * dt;
        const nz = e.group.position.z + e.knockVel.z * dt;
        const res = ctx.resolveCollision(e.group.position.x, e.group.position.z, nx, nz, tunables.meleeEnemy.collisionRadius);
        e.group.position.x = res.x;
        e.group.position.z = res.z;
        e.knockVel.multiplyScalar(Math.max(0, 1 - 12 * dt));
      }

      if (!e.alive) {
        e.deathT += dt;
        e.alertMat.opacity = 0;
        e.telMat.opacity = 0;
        const dp = e.deathPhys;
        if (dp && !dp.settled) {
          dp.vy -= 18 * dt;
          const drag = 1 - Math.min(1, 3.5 * dt);
          dp.vx *= drag; dp.vz *= drag;
          const nx = e.group.position.x + dp.vx * dt;
          const nz = e.group.position.z + dp.vz * dt;
          const res = ctx.resolveCollision
            ? ctx.resolveCollision(e.group.position.x, e.group.position.z, nx, nz, tunables.meleeEnemy.collisionRadius)
            : { x: nx, z: nz };
          e.group.position.x = res.x;
          e.group.position.z = res.z;
          e.group.position.y = Math.max(0, e.group.position.y + dp.vy * dt);
          if (e.group.position.y <= 0) {
            e.group.position.y = 0;
            dp.vy = 0;
            dp.vx *= 0.4; dp.vz *= 0.4;
            dp.settleT += dt;
            const horiz = Math.hypot(dp.vx, dp.vz);
            if (horiz < 0.3 && dp.settleT > 0.15) dp.settled = true;
          }
        }
        if (e.rig) updateAnim(e.rig, { dying: true }, dt);
        continue;
      }

      if (!tunables.ai.active) {
        e.state = STATE.IDLE;
        e.alertMat.opacity = THREE.MathUtils.lerp(e.alertMat.opacity, 0, Math.min(1, dt * 10));
        e.telMat.opacity = THREE.MathUtils.lerp(e.telMat.opacity, 0, Math.min(1, dt * 10));
        if (e.rig) updateAnim(e.rig, { speed: 0, meleeStance: true }, dt);
        continue;
      }

      // Melee-hit stagger — pause AI decisions so the rig's flinch
      // plays cleanly and the player gets a follow-up window. The
      // telegraph windup fades during stagger so interrupted swings
      // feel properly cancelled.
      if ((e.staggerT || 0) > 0) {
        e.staggerT = Math.max(0, e.staggerT - dt);
        e.telMat.opacity = THREE.MathUtils.lerp(e.telMat.opacity, 0, Math.min(1, dt * 12));
        if (e.rig) updateAnim(e.rig, { speed: 0, meleeStance: true }, dt);
        continue;
      }

      this._updateAI(e, ctx, dt);

      // --- idle chatter ---------------------------------------------
      // Smash-themed phrases roll on a per-enemy cooldown. Fires in
      // both IDLE and CHASE so players still hear growling while
      // being pursued — reinforces the "I'm being hunted" vibe.
      if ((e.state === STATE.IDLE || e.state === STATE.CHASE) && ctx.camera) {
        e.chatterT -= dt;
        if (e.chatterT <= 0) {
          e.chatterT = 7 + Math.random() * 12;
          if (Math.random() < 0.55) {
            const head = e.rig ? e.rig.head.getWorldPosition(new THREE.Vector3())
                               : e.group.position.clone().setY(2);
            head.y += 0.5;
            const line = MELEE_CHATTER[Math.floor(Math.random() * MELEE_CHATTER.length)];
            spawnSpeechBubble(head, ctx.camera, line, 2.2);
          }
        }
      }

      // --- animation pose layer -------------------------------------
      // Speed derived from frame delta so the walk cycle matches
      // however fast they're actually moving.
      if (e.rig) {
        const lastX = e._animLastX ?? e.group.position.x;
        const lastZ = e._animLastZ ?? e.group.position.z;
        const dx = e.group.position.x - lastX;
        const dz = e.group.position.z - lastZ;
        const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
        e._animLastX = e.group.position.x;
        e._animLastZ = e.group.position.z;
        // Swing progress drives the arm arc. WINDUP cocks back from 0
        // to -1 over the windup timer; the moment the strike lands
        // we hop straight to +1 and decay to 0 through RECOVERY for
        // the follow-through sweep. Mapped off the REAL timers
        // (e.swingT / e.recoveryT) so the visible arc stays locked
        // to the telegraph the telMat ring is already drawing.
        let swingProgress = 0;
        if (e.state === STATE.WINDUP) {
          const total = tunables.meleeEnemy.swingWindup || 0.22;
          const t = 1 - Math.max(0, e.swingT / total);
          swingProgress = -Math.min(1, t);
        } else if (e.state === STATE.SWING) {
          swingProgress = 1;
        } else if (e.state === STATE.RECOVERY) {
          const total = 0.22;
          const t = Math.max(0, e.recoveryT / total);
          swingProgress = Math.max(0, t);   // +t decays to 0
        }
        updateAnim(e.rig, {
          speed,
          meleeStance: true,  // one-handed blade hold, not rifle pose
          aiming: e.state !== STATE.IDLE,
          swingProgress,
          swingStyle: e.swingStyle || 'horizontal',
        }, dt);

        // Weapon-tip trail — sample the blade-tip world position each
        // frame while the arm is in a swing phase, then spawn a short
        // ribbon segment between the previous and current sample.
        // Accumulated segments trace the actual path of the blade tip
        // (since `tipMarker` is parented to the blade), so the FX
        // matches whatever the rig animation produced this swing.
        if (ctx.combat && e.tipMarker
            && (e.state === STATE.WINDUP || e.state === STATE.RECOVERY)) {
          const tip = e.tipMarker.getWorldPosition(_enemyTipTmp);
          if (e._tipTrailPrev) {
            const threat = e.tier === 'boss' ? 0xff6a5a
              : e.tier === 'subBoss' ? 0xffa66a : 0xf2e7c9;
            ctx.combat.spawnMeleeSegment(e._tipTrailPrev, tip, 0.22, {
              color: threat,
              width: e.tier === 'boss' ? 0.18 : 0.13,
              opacity: 0.8,
            });
          }
          if (!e._tipTrailPrev) e._tipTrailPrev = new THREE.Vector3();
          e._tipTrailPrev.copy(tip);
        } else {
          e._tipTrailPrev = null;
        }
      }
    }
  }

  _respawn(e) {
    e.alive = true;
    e.hp = tunables.meleeEnemy.maxHealth;
    e.deathT = 0;
    e.group.rotation.x = 0;
    e.group.position.set(e.homeX, 0, e.homeZ);
    e.state = STATE.IDLE;
    e.swingT = 0;
    e.cooldownT = 0;
    e.recoveryT = 0;
    e.knockVel.set(0, 0, 0);
    e.disarmed = false;
    e.weaponArm.visible = true;
    e.blade.visible = true;
  }

  _updateAI(e, ctx, dt) {
    e.cooldownT = Math.max(0, e.cooldownT - dt);
    const toPlayer = new THREE.Vector3().subVectors(ctx.playerPos, e.group.position);
    const dist = Math.hypot(toPlayer.x, toPlayer.z);
    const dir2d = new THREE.Vector3(toPlayer.x, 0, toPlayer.z);
    if (dir2d.lengthSq() > 0.0001) dir2d.normalize();
    e._lastRangeToPlayer = dist;   // read by applyHit for assassin block

    // Door-state gating removed — keycard redesign opens most doors
    // by default. Detection falls through to LoS + suspicion only.
    const roomActive = true;

    // Perception — looser than gunman since they just need to notice you.
    // Stealth only gates the first spot; once chasing, LoS alone decides.
    const hasLos = roomActive && ctx.combat.hasLineOfSight(
      e.torso.getWorldPosition(new THREE.Vector3()),
      ctx.playerPos.clone().setY(1.0),
      ctx.obstacles,
    );
    const detRangeIdle = tunables.meleeEnemy.detectionRange * (ctx.playerStealthMult || 1);
    const detRangeAlert = tunables.meleeEnemy.detectionRange * 2;

    // Suspicion ramp — partial detection accumulates; a brief sight
    // while the player is sneaking no longer instantly commits the
    // rusher to a charge. Idle enemies use the stealth-modulated
    // range; once chasing, any LoS keeps them locked on.
    // Rear-blindspot — face-on detection normally, but if the player
    // is clearly behind the rusher's heading (patrol direction), they
    // can get close without triggering. Mirrors the gunman logic so
    // stealth-approach works against both archetypes.
    const fwd = new THREE.Vector3(
      Math.sin(e.group.rotation.y), 0, Math.cos(e.group.rotation.y),
    );
    const facingDot = fwd.dot(dir2d);
    const inRearBlindspot = facingDot < -0.4;
    // Point-blank presence overrides stealth entirely — but only if
    // the player isn't directly behind. Without that guard, creeping
    // up to a patrolling rusher's back would still trigger proximity.
    const proximity = hasLos && !inRearBlindspot && dist < tunables.meleeEnemy.proximityRange;
    const maxRange = detRangeIdle * 1.5;
    // Signal only accumulates when the rusher is facing toward the
    // player. Fully tucked behind them = zero signal, enemy keeps
    // patrolling unobstructed.
    const canAccrueSignal = hasLos && !inRearBlindspot;
    const signal = proximity ? 1 : (canAccrueSignal ? Math.max(0, 1 - dist / maxRange) : 0);
    const suspTarget = e.state !== STATE.IDLE && hasLos ? 1 : signal;
    const rampRate = suspTarget > e.suspicion ? 2.0 : 0.4;
    e.suspicion += Math.sign(suspTarget - e.suspicion)
      * Math.min(Math.abs(suspTarget - e.suspicion), rampRate * dt);
    e.suspicion = Math.max(0, Math.min(1.2, e.suspicion));

    const canSee = e.state !== STATE.IDLE
      ? (hasLos && dist <= detRangeAlert)
      : (e.suspicion >= 1.0);

    if (canSee && e.state === STATE.IDLE) {
      e.state = STATE.CHASE;
      ctx.onAlert?.(e);
    }
    // Cloaked assassin — uncloak the moment the player enters the
    // assassin's room (or LoS is established). Once materialized the
    // boss is just a dasher-melee with the assassinPhase machine.
    if (e.cloaked) {
      const playerInRoom = ctx.playerRoomId !== undefined && ctx.playerRoomId === e.roomId;
      if (playerInRoom || canSee) {
        e.cloaked = false;
        e.state = STATE.CHASE;
        ctx.onAlert?.(e);
      }
    }

    const targetAlpha = e.state === STATE.IDLE ? 0 : (e.state === STATE.WINDUP ? 1 : 0.6);
    e.alertMat.opacity = THREE.MathUtils.lerp(e.alertMat.opacity, targetAlpha, Math.min(1, dt * 10));

    // Face the player when engaged.
    if (e.state !== STATE.IDLE && dir2d.lengthSq() > 0) {
      e.group.rotation.y = Math.atan2(dir2d.x, dir2d.z);
    }

    if (e.state === STATE.CHASE) {
      // Assassin disengage — when in the retreat phase the boss
      // flees straight AWAY from the player until the timer runs
      // out or they hit a safe distance, then flips back to
      // closing. Dash stays enabled so the escape is fast.
      if (e.archetype === 'assassin' && e.assassinPhase === 'disengaging') {
        e.assassinRetreatT -= dt;
        if (e.assassinRetreatT <= 0 || dist > 18) {
          e.assassinPhase = 'closing';
        }
      }
      // Door-graph pathing: if the player is in a different room,
      // don't bee-line through walls — route via the shortest door
      // chain. The path is cached for a fraction of a second so the
      // BFS isn't run per-frame.
      let approach = dir2d;
      let usePathDoor = false;
      // Assassin retreating: flip the approach direction so the
      // chase branch below moves them away instead of toward. Skip
      // door-graph lookup — just run.
      if (e.archetype === 'assassin' && e.assassinPhase === 'disengaging') {
        approach = new THREE.Vector3(-dir2d.x, 0, -dir2d.z);
      } else
      if (ctx.level && ctx.playerPos) {
        const here = ctx.level.roomAt(e.group.position.x, e.group.position.z);
        const there = ctx.level.roomAt(ctx.playerPos.x, ctx.playerPos.z);
        if (here && there && here.id !== there.id) {
          e.pathCache = e.pathCache || { t: 0, toId: -1, nextDoor: null };
          e.pathCache.t -= dt;
          if (e.pathCache.t <= 0 || e.pathCache.toId !== there.id) {
            e.pathCache.t = 0.45 + Math.random() * 0.25;
            e.pathCache.toId = there.id;
            const doors = ctx.level.pathDoorsFrom(here.id, there.id);
            e.pathCache.nextDoor = (doors && doors.length) ? doors[0] : null;
          }
          const nd = e.pathCache.nextDoor;
          if (nd) {
            const tx = nd.userData.cx - e.group.position.x;
            const tz = nd.userData.cz - e.group.position.z;
            const tl = Math.hypot(tx, tz);
            if (tl > 0.1) {
              approach = new THREE.Vector3(tx / tl, 0, tz / tl);
              usePathDoor = true;
            }
          }
        }
      }
      // Stuck-avoidance: if the last move got clamped, deflect perpendicular
      // for a short window so we slide around corners/walls. Skip this
      // when the path-door is providing the heading — that's already
      // a smart direction.
      if (!usePathDoor && e.stuckT > 0) {
        e.stuckT -= dt;
        const side = (e.stuckSide || 1);
        const nx = -dir2d.z * side;
        const nz = dir2d.x * side;
        approach = new THREE.Vector3(
          dir2d.x * 0.4 + nx * 0.9,
          0,
          dir2d.z * 0.4 + nz * 0.9,
        );
        if (approach.lengthSq() > 0.0001) approach.normalize();
      }

      // Dash-close: when we're mid-range and cooldowns are ready, kick into
      // a brief burst of speed straight at the player. Makes rushers feel
      // like they commit rather than walk.
      e.dashCdT = Math.max(0, e.dashCdT - dt);
      e.dashT = Math.max(0, e.dashT - dt);
      const bossSpeed = e.tier === 'boss' ? 1.35 : (e.tier === 'subBoss' ? 1.15 : 1);
      let moveSpeed = tunables.meleeEnemy.moveSpeed * bossSpeed;
      if (e.dashT > 0) moveSpeed = tunables.meleeEnemy.dashSpeed * bossSpeed;
      else if (e.dashCdT <= 0 && dist <= tunables.meleeEnemy.dashRange
        && dist > tunables.meleeEnemy.swingRange) {
        e.dashT = tunables.meleeEnemy.dashDuration;
        e.dashCdT = tunables.meleeEnemy.dashCooldown;
      }

      const beforeX = e.group.position.x, beforeZ = e.group.position.z;
      const nx = beforeX + approach.x * moveSpeed * dt;
      const nz = beforeZ + approach.z * moveSpeed * dt;
      const res = ctx.resolveCollision(beforeX, beforeZ, nx, nz, tunables.meleeEnemy.collisionRadius);
      e.group.position.x = res.x;
      e.group.position.z = res.z;
      // Clamp bosses to their arena bounds (see gunman.js for rationale).
      if (e.tier === 'boss' && ctx.level && e.roomId >= 0) {
        const room = ctx.level.rooms[e.roomId];
        if (room) {
          const b = room.bounds;
          const m = tunables.meleeEnemy.collisionRadius + 0.4;
          e.group.position.x = Math.max(b.minX + m, Math.min(b.maxX - m, e.group.position.x));
          e.group.position.z = Math.max(b.minZ + m, Math.min(b.maxZ - m, e.group.position.z));
        }
      }
      const wantedLen = Math.hypot(nx - beforeX, nz - beforeZ);
      const actualLen = Math.hypot(res.x - beforeX, res.z - beforeZ);
      if (wantedLen > 0.01 && actualLen < wantedLen * 0.3 && e.stuckT <= 0) {
        e.stuckT = 0.7;
        e.stuckSide = Math.random() < 0.5 ? -1 : 1;
      }

      // Skip windup while disengaging — the assassin is in escape
      // phase and shouldn't stop to strike.
      const disengaging = e.archetype === 'assassin' && e.assassinPhase === 'disengaging';
      if (!disengaging
          && dist <= tunables.meleeEnemy.swingRange
          && e.cooldownT <= 0 && e.dazzleT <= 0 && e.surpriseT <= 0) {
        e.state = STATE.WINDUP;
        // Bosses telegraph less; tiered enemies swing a hair faster too.
        const windupMult = e.tier === 'boss' ? 0.6 : (e.tier === 'subBoss' ? 0.8 : 1);
        e.swingT = tunables.meleeEnemy.swingWindup * windupMult;
        // Pick a swing style at the start of each WINDUP so the
        // animation varies per strike instead of always playing the
        // default horizontal arc.
        const styles = ['horizontal', 'overhead', 'thrust'];
        e.swingStyle = styles[Math.floor(Math.random() * styles.length)];
      }
    } else if (e.state === STATE.WINDUP) {
      e.swingT -= dt;
      e.telMat.opacity = THREE.MathUtils.lerp(
        e.telMat.opacity, 0.2 + 0.6 * (1 - e.swingT / tunables.meleeEnemy.swingWindup), Math.min(1, dt * 14),
      );
      if (e.swingT <= 0) {
        // Strike lands. Player iFrames negate the hit.
        if (dist <= tunables.meleeEnemy.swingRange * 1.15 && !ctx.playerIFrames) {
          ctx.onPlayerHit?.(tunables.meleeEnemy.swingDamage * e.damageMult, e);
        }
        e.state = STATE.RECOVERY;
        // Large bosses swing on a noticeably tighter loop than subs or
        // grunts — both the recovery window and the between-swing
        // cooldown collapse so the pressure doesn't let up.
        const cooldownMult = e.tier === 'boss' ? 0.40 : (e.tier === 'subBoss' ? 0.70 : 1);
        e.recoveryT = 0.22 * cooldownMult;
        e.cooldownT = tunables.meleeEnemy.swingCooldown * cooldownMult;
        e.telMat.opacity = 0;
      }
    } else if (e.state === STATE.RECOVERY) {
      e.recoveryT -= dt;
      if (e.recoveryT <= 0) {
        // Once alerted they stay committed — chase even if out of detection
        // radius so they follow the player through doorways.
        e.state = STATE.CHASE;
      }
    }
  }
}
