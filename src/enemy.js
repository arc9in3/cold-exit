import * as THREE from 'three';
import { tunables } from './tunables.js';

// Static training dummies. No AI, no movement — just two-zone targets that
// react, die, and respawn so combat feel can be tuned in isolation.
export class DummyManager {
  constructor(scene) {
    this.scene = scene;
    this.dummies = [];
    this._baseBodyColor = 0xa08c6a;
    this._baseHeadColor = 0xb39a72;
  }

  spawn(x, z) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const bodyMat = new THREE.MeshStandardMaterial({ color: this._baseBodyColor, roughness: 0.8 });
    const headMat = new THREE.MeshStandardMaterial({ color: this._baseHeadColor, roughness: 0.8 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.2, 4, 12), bodyMat);
    body.position.y = 1.0;
    body.castShadow = true;
    body.userData = { zone: 'torso' };
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), headMat);
    head.position.y = 1.95;
    head.castShadow = true;
    head.userData = { zone: 'head' };
    group.add(head);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.6, 0.15, 12),
      new THREE.MeshStandardMaterial({ color: 0x1f1d1a, roughness: 0.9 }),
    );
    base.position.y = 0.075;
    base.receiveShadow = true;
    base.castShadow = true;
    group.add(base);

    this.scene.add(group);

    const dummy = {
      group, body, head, bodyMat, headMat,
      hp: tunables.enemy.maxHealth,
      alive: true,
      flashT: 0,
      deathT: 0,
      offsetX: 0, offsetZ: 0,
      homeX: x, homeZ: z,
    };
    dummy.manager = this;
    body.userData.owner = dummy;
    head.userData.owner = dummy;

    this.dummies.push(dummy);
    return dummy;
  }

  hittables() {
    const out = [];
    for (const d of this.dummies) {
      // `unhittable` is set by encounters that want a dummy to remain
      // visible but ignore further bullets — e.g. the surviving NPC
      // in Choices and Consequences after a decision is made.
      if (d.alive && !d.unhittable) { out.push(d.body); out.push(d.head); }
    }
    return out;
  }

  // Main calls this uniformly for all enemy kinds. Dummies never melee so
  // they can't block shots.
  applyHit(dummy, damage, _zone, hitDir) {
    if (!dummy.alive) return { drops: [], blocked: false };
    dummy.hp -= damage;
    dummy.flashT = tunables.enemy.hitFlashTime;
    if (hitDir) {
      dummy.offsetX += hitDir.x * tunables.enemy.knockback * 0.3;
      dummy.offsetZ += hitDir.z * tunables.enemy.knockback * 0.3;
    }
    if (dummy.hp <= 0) {
      dummy.alive = false;
      dummy.deathT = 0;
    }
    return { drops: [], blocked: false };
  }

  update(dt) {
    for (const d of this.dummies) {
      if (d.flashT > 0) {
        d.flashT = Math.max(0, d.flashT - dt);
        const k = d.flashT / tunables.enemy.hitFlashTime;
        const flashColor = new THREE.Color(0xff4a4a);
        d.bodyMat.color.copy(new THREE.Color(this._baseBodyColor)).lerp(flashColor, k);
        d.headMat.color.copy(new THREE.Color(this._baseHeadColor)).lerp(flashColor, k);
      }

      d.offsetX *= Math.max(0, 1 - dt * 8);
      d.offsetZ *= Math.max(0, 1 - dt * 8);
      d.group.position.x = d.homeX + d.offsetX;
      d.group.position.z = d.homeZ + d.offsetZ;

      if (!d.alive) {
        d.deathT += dt;
        const tipProgress = Math.min(1, d.deathT / 0.35);
        d.group.rotation.x = THREE.MathUtils.lerp(0, Math.PI / 2, tipProgress);
        // `keepDead` is set by encounters that need a corpse to STAY a
        // corpse (Choices and Consequences both-die path, etc.) so the
        // tutorial/range respawn doesn't clobber the narrative.
        if (!d.keepDead && d.deathT >= tunables.enemy.respawnDelay) {
          d.alive = true;
          d.hp = tunables.enemy.maxHealth;
          d.deathT = 0;
          d.group.rotation.x = 0;
        }
      }
    }
  }
}
