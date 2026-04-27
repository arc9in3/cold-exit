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
    // --- Loot pool -------------------------------------------------
    // Pre-allocate N "slots" for standard (non-toy) ground loot.
    // Each slot owns its own Group, Mesh (cube), PointLight, and
    // Sprite nametag with a dedicated Canvas. The cube's geometry is
    // shared across every slot (one BufferGeometry for the whole
    // pool). Spawning recolors the material emissive + the light
    // color, redraws the canvas with the new item name, and flips
    // visibility on. Nothing is added to or removed from the scene
    // after constructor runs, so Three.js's shader cache stays
    // stable (no recompile spikes on disarm / kill-drop).
    this._pool = [];
    this._sharedBoxGeom = new THREE.BoxGeometry(0.35, 0.35, 0.35);
    const POOL_SIZE = 24;
    for (let i = 0; i < POOL_SIZE; i++) {
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x151515,
        roughness: 0.35,
        metalness: 0.55,
        emissive: new THREE.Color(0x222222),
      });
      const mesh = new THREE.Mesh(this._sharedBoxGeom, mat);
      mesh.castShadow = true;
      group.add(mesh);

      // Nametag — pre-built Canvas + CanvasTexture. On spawn we
      // redraw the canvas (cheap, CPU-only) and flip
      // `texture.needsUpdate = true` so the GPU re-uploads. No new
      // allocations per drop.
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 64;
      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.renderOrder = 999;
      sprite.position.y = 0.6;
      sprite.visible = false;
      group.add(sprite);

      // PointLight stays parented to the group at intensity 0 when
      // the slot is idle. Scene is part of a fixed-count shader
      // key set; no recompile when a slot activates.
      const light = new THREE.PointLight(0xffffff, 0, 2.2);
      light.position.y = 0.2;
      group.add(light);

      // Pre-allocated rarity beacon — vertical column of light + a
      // pulse PointLight, parked invisible at the bottom of the
      // group. Activated for epic / legendary / mythic / mastercraft
      // drops; previously these were allocated per drop, which
      // pushed a fresh light into the scene and forced a shader
      // recompile EVERY hit (the visible "freeze on drop" hitch).
      // Geometry is shared across slots; per-slot material so the
      // colour can be set independently.
      if (!this._sharedBeamGeom) {
        this._sharedBeamGeom = new THREE.CylinderGeometry(0.18, 0.32, 1, 8, 1, true);
      }
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const beam = new THREE.Mesh(this._sharedBeamGeom, beamMat);
      beam.userData.isProp = true;
      beam.userData.beam = true;
      beam.visible = false;
      beam.position.y = 0.5;
      group.add(beam);
      const beamPulse = new THREE.PointLight(0xffffff, 0, 5.5);
      beamPulse.position.y = 0.4;
      group.add(beamPulse);

      group.visible = false;
      group.position.set(0, -1000, 0);
      this.scene.add(group);
      this._pool.push({
        group, mesh, mat, light,
        beam, beamMat, beamPulse,
        sprite, canvas, ctx: canvas.getContext('2d'), tex,
        inUse: false,
      });
    }
  }

  // Grab an idle pool slot; if all are in use, steal the oldest.
  _acquire() {
    for (const s of this._pool) if (!s.inUse) return s;
    // Pool exhausted — evict the oldest live entry (matches how the
    // tracer / flash pools handle saturation in combat.js).
    const oldest = this.items[0];
    if (oldest && oldest.slot) {
      this.remove(oldest);
      return oldest.slot;
    }
    return this._pool[0];
  }

  // Redraw the pre-allocated canvas with the item name. Much cheaper
  // than creating a new canvas + CanvasTexture each drop.
  _paintNameTag(slot, name) {
    const w = slot.canvas.width, h = slot.canvas.height;
    const ctx = slot.ctx;
    ctx.clearRect(0, 0, w, h);
    const padX = 18, padY = 8;
    const fontSize = 26;
    ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    const text = (name || 'item').toUpperCase();
    const textW = Math.ceil(ctx.measureText(text).width);
    const pillW = textW + padX * 2;
    const pillH = fontSize + padY * 2;
    const x0 = (w - pillW) / 2;
    const y0 = (h - pillH) / 2;
    ctx.fillStyle = 'rgba(20, 24, 32, 0.92)';
    ctx.strokeStyle = 'rgba(0, 230, 255, 0.6)';
    ctx.lineWidth = 2;
    const r = 4;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x0 + pillW, y0, x0 + pillW, y0 + pillH, r);
    ctx.arcTo(x0 + pillW, y0 + pillH, x0, y0 + pillH, r);
    ctx.arcTo(x0, y0 + pillH, x0, y0, r);
    ctx.arcTo(x0, y0, x0 + pillW, y0, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
    slot.tex.needsUpdate = true;
    // Scale sprite so the label is ~0.22m tall regardless of
    // canvas aspect. Width follows the painted pill, not the full
    // canvas, so short labels don't get a huge empty frame.
    const worldH = 0.22;
    slot.sprite.scale.set(worldH * (pillW / pillH), worldH, 1);
  }

  spawnItem(position, item) {
    const tint = item.tint ?? 0xaaaaaa;

    // Bear / duck toys keep the hand-built primitive path — they're
    // rare, decorative, not a hitch concern. Pool is only for the
    // common "colored box" drops (weapons / gear / consumables /
    // disarmed weapons).
    if (item.shape === 'bear' || item.shape === 'duck') {
      const e = this._spawnToy(position, item, tint);
      this._maybeAttachBeacon(e, item);
      return e;
    }

    const slot = this._acquire();
    slot.inUse = true;
    // Reuse the slot's MeshStandardMaterial — only the emissive
    // color changes. Three.js treats this as an in-place uniform
    // update, no shader recompile.
    slot.mat.emissive.setHex(tint).multiplyScalar(0.75);
    slot.light.color.setHex(tint);
    slot.light.intensity = 0.9;
    // Defer the nametag canvas paint + texture upload until the
    // sprite actually becomes visible (proximity-gated in update()).
    // Painting + uploading per drop was a real ~1-3ms cost on a
    // texture the player can't see yet — disarm/loot bursts piled
    // a paint per drop. Stash the pending name; update() paints when
    // the sprite first toggles visible.
    // Strip any HTML wrappers from the display name before it lands
    // on the canvas — wrapWeapon prefixes mastercraft items with a
    // raw `<span class="mastercraft-tag">MASTERCRAFT</span> ` literal
    // for the inventory cell renderer, but the floor sprite paints
    // text verbatim and would otherwise show the tags.
    slot.pendingName = String(item.name || 'item').replace(/<[^>]+>/g, '').trim();
    slot.paintedName = null;
    slot.sprite.visible = false;   // proximity-gated in update()
    slot.group.position.set(position.x, 0.45, position.z);
    slot.group.visible = true;

    const entry = {
      slot,
      group: slot.group, box: slot.mesh, light: slot.light,
      nameTag: slot.sprite,
      item,
      age: Math.random() * Math.PI * 2,
      isToy: false,
    };
    this._maybeAttachBeacon(entry, item);
    this.items.push(entry);
    return entry;
  }

  // Rare-tier ground beacon — re-tints the pre-allocated beam mesh +
  // pulse light owned by the pool slot. No allocations, no light
  // count changes (beamPulse always exists at intensity 0 when idle),
  // no shader recompile. Epic / legendary / mythic / mastercraft
  // each get a distinct color / height / intensity profile.
  _maybeAttachBeacon(entry, item) {
    if (!entry || !item || !entry.slot) return;
    const slot = entry.slot;
    const rarity = item.rarity || 'common';
    const isMaster = !!item.mastercraft;
    if (!isMaster && rarity !== 'epic' && rarity !== 'legendary' && rarity !== 'mythic') {
      // Make sure the slot's beacon is hidden (a previous use of this
      // slot may have shown one).
      if (slot.beam) slot.beam.visible = false;
      if (slot.beamPulse) slot.beamPulse.intensity = 0;
      return;
    }
    const profile = isMaster
      ? { color: 0xffd040, height: 6.5, opacity: 0.55, pulse: 1.7 }
      : rarity === 'mythic'    ? { color: 0xff3a55, height: 7.5, opacity: 0.65, pulse: 2.0 }
      : rarity === 'legendary' ? { color: 0xffc040, height: 5.5, opacity: 0.5,  pulse: 1.6 }
      :                          { color: 0xb060ff, height: 4.5, opacity: 0.45, pulse: 1.4 }; // epic
    if (slot.beam) {
      slot.beamMat.color.setHex(profile.color);
      slot.beamMat.opacity = profile.opacity;
      // Pre-allocated geometry is unit-height; scale Y to the
      // profile height. Position pivots from the drop origin upward.
      slot.beam.scale.set(1, profile.height, 1);
      slot.beam.position.y = profile.height / 2 - 0.45;
      slot.beam.visible = true;
    }
    if (slot.beamPulse) {
      slot.beamPulse.color.setHex(profile.color);
      slot.beamPulse.intensity = profile.pulse;
    }
  }

  // Toys still use the old one-off group path — small, fixed count,
  // no shader-recompile concern since they're pure MeshBasicMaterial
  // which doesn't live in the lit shader cache.
  _spawnToy(position, item, tint) {
    const group = new THREE.Group();
    const primaryMesh = item.shape === 'bear'
      ? this._buildBearGroup(tint)
      : this._buildDuckGroup(tint);
    group.add(primaryMesh);
    const light = new THREE.PointLight(tint, 1.8, 6);
    light.position.y = 0.6;
    group.add(light);
    group.position.copy(position);
    group.position.y = 0.3;
    this.scene.add(group);
    const entry = {
      group, box: primaryMesh, light, nameTag: null,
      item,
      age: Math.random() * Math.PI * 2,
      isToy: true,
    };
    this.items.push(entry);
    return entry;
  }

  // Floating nametag sprite — rendered once from a 2D canvas so the
  // label reads crisply from any distance. Sprites always face the
  // camera, so this gives a clean "hover label" above each cube
  // without per-item camera-align math. Only created for non-toy
  // items (toys are already self-identifying as the bear / duck).
  _buildNameTag(name) {
    const padX = 18, padY = 8;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontSize = 26;
    ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    const text = (name || 'item').toUpperCase();
    const metrics = ctx.measureText(text);
    const w = Math.ceil(metrics.width) + padX * 2;
    const h = fontSize + padY * 2;
    canvas.width = w;
    canvas.height = h;
    // Dark navy pill with ice-blue border — matches the style guide.
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(20, 24, 32, 0.92)';
    ctx.strokeStyle = 'rgba(0, 230, 255, 0.6)';
    ctx.lineWidth = 2;
    const r = 4;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Text on top, centered, tech-mono uppercase.
    ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    // World units — ~0.7m wide per label, proportional to canvas.
    const worldH = 0.22;
    sprite.scale.set(worldH * (w / h), worldH, 1);
    sprite.renderOrder = 999;   // draw over fog / walls
    return sprite;
  }

  _buildBearGroup(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color });
    const bright = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const nose = new THREE.MeshBasicMaterial({ color: 0x222222 });
    // Body — slightly squatter so the head can dominate the silhouette.
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), mat);
    body.position.y = 0.30;
    g.add(body);
    // Head — bumped 0.24 → 0.36 so the silhouette reads as the
    // chibi-mascot bear (head ~as wide as body). Sits low against
    // the body, slight forward tilt.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 10), mat);
    head.position.set(0, 0.82, 0.12);
    g.add(head);
    // Ears — wider apart and taller-set so they cap the round head.
    const earGeom = new THREE.SphereGeometry(0.10, 10, 8);
    const earL = new THREE.Mesh(earGeom, mat);
    earL.position.set(-0.24, 1.08, 0.10);
    g.add(earL);
    const earR = new THREE.Mesh(earGeom, mat);
    earR.position.set(0.24, 1.08, 0.10);
    g.add(earR);
    // Smaller snout pulled flat against the face for the rounder
    // profile.
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), bright);
    snout.position.set(0, 0.74, 0.40);
    g.add(snout);
    const noseDot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), nose);
    noseDot.position.set(0, 0.78, 0.46);
    g.add(noseDot);
    // Bigger eyes with white catchlights so the toy reads as a
    // proper cartoon face at toy scale.
    const eyeGeom = new THREE.SphereGeometry(0.06, 10, 8);
    const eyeL = new THREE.Mesh(eyeGeom, nose);
    eyeL.position.set(-0.13, 0.88, 0.32);
    g.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeom, nose);
    eyeR.position.set(0.13, 0.88, 0.32);
    g.add(eyeR);
    const catchMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const catchGeom = new THREE.SphereGeometry(0.018, 6, 4);
    const catchL = new THREE.Mesh(catchGeom, catchMat);
    catchL.position.set(-0.115, 0.90, 0.38);
    g.add(catchL);
    const catchR = new THREE.Mesh(catchGeom, catchMat);
    catchR.position.set(0.145, 0.90, 0.38);
    g.add(catchR);
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
    // Pooled slot — hide + zero light + return to pool. No dispose,
    // no scene removal. This is the common case for weapon /
    // gear / consumable drops.
    if (entry.slot) {
      entry.slot.group.visible = false;
      entry.slot.group.position.set(0, -1000, 0);
      entry.slot.sprite.visible = false;
      entry.slot.light.intensity = 0;
      // Hide the rare-drop beacon if this slot had one. Geometry +
      // material stay alive on the slot, ready for the next rare
      // drop with a re-tint instead of a re-alloc.
      if (entry.slot.beam) entry.slot.beam.visible = false;
      if (entry.slot.beamPulse) entry.slot.beamPulse.intensity = 0;
      entry.slot.inUse = false;
      return;
    }
    // Legacy (toy) path — disposed inline since toys aren't pooled.
    this.scene.remove(entry.group);
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

  update(dt, playerPos) {
    const tagRadius = (tunables.loot.pickupRadius ?? 2.0) + 0.6;
    const tagR2 = tagRadius * tagRadius;
    // Cap the number of nametag canvases repainted per frame. When the
    // player walks past a fresh pile of disarmed-weapon drops, every
    // sprite flips visible at once; without a cap, we'd repaint +
    // upload a texture for every entry on the same frame, spiking
    // ~3-10ms in one go. One paint per frame keeps the visible labels
    // catching up over the next few frames instead of jamming up.
    let paintsThisFrame = 0;
    const MAX_PAINTS_PER_FRAME = 1;
    for (const it of this.items) {
      it.age += dt;
      const baseY = it.isToy ? 0.3 : 0.45;
      const bob = Math.sin(it.age * 2.2) * tunables.loot.bobAmplitude;
      it.group.position.y = baseY + bob;
      it.group.rotation.y = it.age * 0.7;
      // Nametag visibility — show when the player is within pickup
      // radius + a small buffer. Sprites face the camera
      // automatically so we just toggle .visible.
      if (it.nameTag && playerPos) {
        const dx = it.group.position.x - playerPos.x;
        const dz = it.group.position.z - playerPos.z;
        const visible = (dx * dx + dz * dz) <= tagR2;
        it.nameTag.visible = visible;
        // Lazy-paint the canvas only when the sprite first becomes
        // visible AND the name has changed since last paint. Saves a
        // texture upload per drop the player can't see yet.
        if (visible && it.slot && it.slot.pendingName
            && it.slot.pendingName !== it.slot.paintedName
            && paintsThisFrame < MAX_PAINTS_PER_FRAME) {
          this._paintNameTag(it.slot, it.slot.pendingName);
          it.slot.paintedName = it.slot.pendingName;
          paintsThisFrame++;
        }
      }
    }
  }
}
