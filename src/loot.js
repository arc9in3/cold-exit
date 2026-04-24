import * as THREE from 'three';
import { tunables } from './tunables.js';
import { modelForItem } from './model_manifest.js';
import { loadModelClone, fitToRadius, applyEmissiveTint, addOutlines } from './gltf_cache.js';

// Ground-loot visual scale. Must match the in-hand weapon sizing in
// player.js (CLASS_SCALE × muzzleLength) so a rifle picked up off the
// floor is the same size the player sees in their hand. Non-weapon
// items keep a fixed small radius.
const GROUND_CLASS_SCALE = {
  pistol: 0.5, smg: 0.75,
  rifle: 0.9, shotgun: 0.9, lmg: 0.9, flame: 0.9,
  melee: 0.85,
};
function groundScaleForItem(item) {
  if (item.type !== 'ranged' && item.type !== 'melee') return 0.35;
  const cs = GROUND_CLASS_SCALE[item.class] ?? 0.9;
  const len = typeof item.muzzleLength === 'number' ? item.muzzleLength : 0.5;
  return len * cs;
}

// Ground loot: any equippable item. Items bob + rotate so they read as
// interactable. Picked up via proximity + E in main.js.
export class LootManager {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  spawnItem(position, item) {
    const group = new THREE.Group();
    const tint = item.tint ?? 0xaaaaaa;

    // Special-case bear/duck toys: stacked-primitive glowing sculpture.
    let primaryMesh = null;
    if (item.shape === 'bear') {
      primaryMesh = this._buildBearGroup(tint);
    } else if (item.shape === 'duck') {
      primaryMesh = this._buildDuckGroup(tint);
    } else {
      primaryMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.14, 0.3),
        new THREE.MeshStandardMaterial({
          color: 0x151515, roughness: 0.5, metalness: 0.4,
          emissive: new THREE.Color(tint).multiplyScalar(0.35),
        }),
      );
      primaryMesh.castShadow = true;
    }
    group.add(primaryMesh);

    // If the item has a registered glTF model, load it async and swap out
    // the primitive when ready. Toys keep their hand-sculpted look.
    if (!item.shape) {
      const modelUrl = modelForItem(item);
      if (modelUrl) {
        loadModelClone(modelUrl).then((clone) => {
          if (!clone) return;  // load failed; primitive stays
          if (!this.items.find(it => it.group === group)) return;  // already removed
          fitToRadius(clone, groundScaleForItem(item));
          addOutlines(clone);           // ground loot reads better with outlines
          applyEmissiveTint(clone, tint, 0.28);
          group.remove(primaryMesh);
          primaryMesh.geometry?.dispose();
          if (primaryMesh.material) {
            if (Array.isArray(primaryMesh.material)) primaryMesh.material.forEach(m => m.dispose());
            else primaryMesh.material.dispose();
          }
          group.add(clone);
          // Update the entry so dispose in remove() still traverses correctly.
          const entry = this.items.find(it => it.group === group);
          if (entry) entry.box = clone;
        });
      }
    }

    // Toys get a much brighter light so they glow as advertised.
    const lightIntensity = item.shape ? 1.8 : 0.6;
    const lightRadius = item.shape ? 6 : 3.5;
    const light = new THREE.PointLight(tint, lightIntensity, lightRadius);
    light.position.y = item.shape ? 0.6 : 0.2;
    group.add(light);

    group.position.copy(position);
    group.position.y = item.shape ? 0.3 : 0.45;
    this.scene.add(group);

    const entry = {
      group, box: primaryMesh, light,
      item,
      age: Math.random() * Math.PI * 2,
      isToy: !!item.shape,
    };
    this.items.push(entry);
    return entry;
  }

  _buildBearGroup(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color });
    const bright = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const nose = new THREE.MeshBasicMaterial({ color: 0x222222 });
    // Body.
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), mat);
    body.position.y = 0.32;
    g.add(body);
    // Head.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), mat);
    head.position.set(0, 0.78, 0.12);
    g.add(head);
    // Ears.
    const earGeom = new THREE.SphereGeometry(0.08, 10, 8);
    const earL = new THREE.Mesh(earGeom, mat);
    earL.position.set(-0.17, 0.95, 0.08);
    g.add(earL);
    const earR = new THREE.Mesh(earGeom, mat);
    earR.position.set(0.17, 0.95, 0.08);
    g.add(earR);
    // Snout.
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), bright);
    snout.position.set(0, 0.72, 0.3);
    g.add(snout);
    // Eyes.
    const eyeGeom = new THREE.SphereGeometry(0.03, 8, 6);
    const eyeL = new THREE.Mesh(eyeGeom, nose);
    eyeL.position.set(-0.07, 0.82, 0.32);
    g.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeom, nose);
    eyeR.position.set(0.07, 0.82, 0.32);
    g.add(eyeR);
    // Tiny emissive glow via inner core sphere.
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 }),
    );
    glow.position.y = 0.4;
    g.add(glow);
    return g;
  }

  _buildDuckGroup(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color });
    const beakMat = new THREE.MeshBasicMaterial({ color: 0xff8a20 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    // Body (ovoid).
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), mat);
    body.scale.set(1.0, 0.8, 1.3);
    body.position.y = 0.32;
    g.add(body);
    // Head.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), mat);
    head.position.set(0, 0.7, 0.22);
    g.add(head);
    // Beak.
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 8), beakMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.66, 0.45);
    g.add(beak);
    // Eyes.
    const eyeGeom = new THREE.SphereGeometry(0.03, 8, 6);
    const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
    eyeL.position.set(-0.08, 0.76, 0.34);
    g.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
    eyeR.position.set(0.08, 0.76, 0.34);
    g.add(eyeR);
    // Tail.
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.2, 8), mat);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 0.38, -0.38);
    g.add(tail);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 12, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18 }),
    );
    glow.position.y = 0.4;
    g.add(glow);
    return g;
  }

  // Backward-compat for the old per-weapon entry point.
  spawnWeapon(position, weapon) { return this.spawnItem(position, weapon); }

  nearest(playerPos, radius) {
    let best = null;
    let bestDist = radius;
    for (const it of this.items) {
      const dx = it.group.position.x - playerPos.x;
      const dz = it.group.position.z - playerPos.z;
      const d = Math.hypot(dx, dz);
      if (d < bestDist) { bestDist = d; best = it; }
    }
    return best;
  }

  allWithin(playerPos, radius) {
    const out = [];
    for (const it of this.items) {
      const dx = it.group.position.x - playerPos.x;
      const dz = it.group.position.z - playerPos.z;
      if (Math.hypot(dx, dz) <= radius) out.push(it);
    }
    return out;
  }

  remove(entry) {
    const idx = this.items.indexOf(entry);
    if (idx < 0) return;
    this.items.splice(idx, 1);
    this.scene.remove(entry.group);
    // Depth-first dispose: for toy groups, entry.box is itself a Group.
    entry.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }

  removeAll() {
    for (const it of [...this.items]) this.remove(it);
  }

  update(dt) {
    for (const it of this.items) {
      it.age += dt;
      const baseY = it.isToy ? 0.3 : 0.45;
      const bob = Math.sin(it.age * 2.2) * tunables.loot.bobAmplitude;
      it.group.position.y = baseY + bob;
      it.group.rotation.y = it.age * 0.7;
    }
  }
}
