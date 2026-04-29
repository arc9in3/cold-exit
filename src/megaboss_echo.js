// THE ECHO — surveillance compliance mega-boss.
//
// Stationary central tower-core. Records the player's last 8 seconds of
// movement on a ring buffer; periodically spawns translucent ghost
// silhouettes that re-walk that recorded path while firing a slow
// tracking pistol back at the player. Mechanically novel — your own
// footwork becomes the attack.
//
// Phases (HP threshold based):
//   1 (>75%):  1 ghost active at a time, slow fire, 5s spawn interval
//   2 (35-75%): 2 ghosts staggered, faster fire, 4s spawn interval
//   3 (<35%):  4 ghosts, fastest fire, plus the core itself sweeps a sensor
//              laser across the arena
//
// Public surface mirrors MegaBoss in megaboss.js so main.js's existing
// mega-boss spawn / hit / loot pipeline works without changes:
//   - constructor(ctx) — same ctx shape as MegaBoss
//   - spawn(pos) — place in world
//   - update(dt) — per-frame tick
//   - applyHit(amount) — bullet damage in
//   - hittables() — raycast targets
//   - alive — bool
//   - destroy() — cleanup
//
// Hittable meshes carry userData.megaBoss = true + userData.owner so
// the mega-boss branch in main.js fireOneShot triggers, and the bullet
// magnetism patch maps to the core's center.

import * as THREE from 'three';
import { spawnSpeechBubble } from './hud.js';

const _BAR_TINT = '#7a4abf';

const BARKS_INTRO = [
  'YOUR MOVEMENT IS RECORDED.',
  'FIDELITY 99.4 PERCENT. INPUT MIRRORED.',
  'WE HAVE YOUR FOOTAGE.',
  'PLAYBACK QUEUED.',
  'THE TAPE LOOPS.',
];
const BARKS_PHASE2 = [
  'COVERAGE EXPANDED.',
  'WITNESSES MULTIPLIED.',
  'NEW ANGLES UNLOCKED.',
];
const BARKS_PHASE3 = [
  'FULL RETROSPECTIVE ENGAGED.',
  'YOUR HISTORY OUTNUMBERS YOU.',
  'COMPLIANCE: ENFORCED.',
];

// Recording: 80 samples × 0.1s spacing = 8s of player movement.
const RECORD_HZ = 10;
const RECORD_LEN = 80;

export class MegaBossEcho {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;

    this.maxHp = 35000;
    this.hp = this.maxHp;
    this.alive = false;
    this.phase = 1;

    this.group = null;
    this.coreMesh = null;
    this.eyeMesh = null;
    this.eyeMat = null;

    // Ring buffer of recent player positions: { x, z }[].
    this.recording = [];
    this.recordT = 0;

    // Active ghost replicas walking the recording.
    this.ghosts = [];
    this.spawnT = 0;

    // Phase 3 sensor-laser sweep state.
    this.sweepAngle = 0;
    this.sweepT = 0;

    this._t = 0;
    this._lastBarkT = -10;

    this._barEl = null;
    this._buildBossBar();
  }

  // ---------- HUD bar (same DOM pattern as MegaBoss) ----------
  _buildBossBar() {
    const root = document.createElement('div');
    root.id = 'mega-boss-bar';
    root.style.cssText = `
      position: fixed; top: 28px; left: 50%; transform: translateX(-50%);
      width: 60vw; max-width: 760px; padding: 8px 12px;
      background: rgba(8, 6, 14, 0.78);
      border: 1px solid ${_BAR_TINT};
      border-radius: 6px;
      font-family: ui-monospace, Menlo, Consolas, monospace;
      color: ${_BAR_TINT};
      font-size: 12px; letter-spacing: 2px;
      text-transform: uppercase;
      z-index: 18; pointer-events: none;
      display: none;
    `;
    root.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span>THE ECHO</span><span id="mega-boss-pct">100%</span>
      </div>
      <div style="height:6px;background:#1a1024;border:1px solid #2a1a3a;border-radius:2px;overflow:hidden">
        <div id="mega-boss-fill" style="height:100%;width:100%;background:${_BAR_TINT};transition:width 0.18s"></div>
      </div>
    `;
    document.body.appendChild(root);
    this._barEl = root;
  }

  _updateBossBar() {
    if (!this._barEl) return;
    const pct = Math.max(0, this.hp / this.maxHp);
    const fill = this._barEl.querySelector('#mega-boss-fill');
    const txt  = this._barEl.querySelector('#mega-boss-pct');
    if (fill) fill.style.width = (pct * 100).toFixed(1) + '%';
    if (txt)  txt.textContent  = (pct * 100).toFixed(0) + '%';
  }

  // ---------- Build ----------
  _buildMesh(pos) {
    const g = new THREE.Group();
    g.position.copy(pos);

    // Wide flat base — disk anchoring the boss to the floor.
    const baseGeo = new THREE.CylinderGeometry(2.0, 2.4, 0.35, 24);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1a1224, metalness: 0.55, roughness: 0.55,
      emissive: new THREE.Color(0x261a3a), emissiveIntensity: 0.6,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.18;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // Tower core — tall cylinder. THIS is the hit target.
    const coreGeo = new THREE.CylinderGeometry(0.7, 0.9, 3.4, 18);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x2a1a44, metalness: 0.65, roughness: 0.4,
      emissive: new THREE.Color(0x4a2a78), emissiveIntensity: 0.35,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.y = 2.05;
    core.castShadow = true;
    core.userData.zone = 'torso';
    core.userData.owner = this;
    core.userData.megaBoss = true;
    this.coreMesh = core;
    this.coreMat = coreMat;
    g.add(core);

    // Eye — glowing ring at the top. Rotates slowly. Pulses on phase.
    const eyeGeo = new THREE.SphereGeometry(0.55, 24, 16);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xb892f0 });
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.y = 4.1;
    g.add(eye);
    this.eyeMesh = eye;
    this.eyeMat = eyeMat;

    // Halo ring — additive, gives the eye a bloom-friendly aura.
    const ringGeo = new THREE.TorusGeometry(0.85, 0.06, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xb892f0, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 4.1;
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    this.ringMesh = ring;

    // Phase 3 sweep beam — long flat plane fanning from the eye. Hidden
    // until phase 3. Uses additive material, no real light, no shadow.
    const beamGeo = new THREE.PlaneGeometry(0.14, 22);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xff5070, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 1.0;
    beam.rotation.x = Math.PI / 2;
    g.add(beam);
    this.beamMesh = beam;
    this.beamMat = beamMat;

    this.scene.add(g);
    this.group = g;
  }

  spawn(pos) {
    this._buildMesh(pos.clone ? pos.clone() : pos);
    this.alive = true;
    if (this._barEl) this._barEl.style.display = 'block';
    this._bark(BARKS_INTRO[Math.floor(Math.random() * BARKS_INTRO.length)]);
    this._updateBossBar();
  }

  // ---------- Per-tick ----------
  update(dt) {
    if (!this.alive) return;
    this._t += dt;

    // Eye + ring spin.
    if (this.eyeMesh) this.eyeMesh.rotation.y += dt * 1.2;
    if (this.ringMesh) {
      this.ringMesh.rotation.z += dt * 0.6;
      this.ringMesh.rotation.x = Math.PI / 2 + Math.sin(this._t * 0.8) * 0.18;
    }
    // Eye color pulses by phase: purple → magenta → red as HP drops.
    const hpRatio = this.hp / this.maxHp;
    const targetHex = hpRatio > 0.75 ? 0xb892f0 : hpRatio > 0.35 ? 0xff70d0 : 0xff5070;
    if (this.eyeMat) this.eyeMat.color.setHex(targetHex);

    // Phase transitions.
    const nextPhase = hpRatio > 0.75 ? 1 : hpRatio > 0.35 ? 2 : 3;
    if (nextPhase !== this.phase) {
      this.phase = nextPhase;
      const lib = nextPhase === 2 ? BARKS_PHASE2 : BARKS_PHASE3;
      this._bark(lib[Math.floor(Math.random() * lib.length)]);
      // Phase 3 reveals the sweep beam.
      if (this.beamMat) this.beamMat.opacity = nextPhase === 3 ? 0.65 : 0;
    }

    // Record the player's position once per RECORD_HZ.
    this.recordT += dt;
    if (this.recordT >= 1 / RECORD_HZ) {
      this.recordT = 0;
      const p = this.ctx.getPlayerPos();
      if (p) {
        this.recording.push({ x: p.x, z: p.z });
        if (this.recording.length > RECORD_LEN) this.recording.shift();
      }
    }

    // Ghost spawning — phase-controlled count + interval.
    const wantCount = this.phase === 1 ? 1 : this.phase === 2 ? 2 : 4;
    const spawnInterval = this.phase === 1 ? 5.0 : this.phase === 2 ? 4.0 : 3.0;
    this.spawnT -= dt;
    if (this.ghosts.length < wantCount && this.spawnT <= 0 && this.recording.length >= 30) {
      this._spawnGhost();
      this.spawnT = spawnInterval;
    }

    // Tick ghosts: walk them along the recording, fire on cooldown.
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const ghost = this.ghosts[i];
      if (!this._tickGhost(ghost, dt)) {
        this._destroyGhost(ghost);
        this.ghosts.splice(i, 1);
      }
    }

    // Phase 3 sweep beam — rotate slowly + raycast for hits.
    if (this.phase === 3 && this.beamMesh) {
      this.sweepAngle += dt * 0.65;
      this.beamMesh.rotation.y = this.sweepAngle;
      this.sweepT -= dt;
      if (this.sweepT <= 0) {
        this.sweepT = 0.25;        // 4 Hz sweep damage tick
        this._sweepDamageCheck();
      }
    }

    this._updateBossBar();
  }

  // Spawn a ghost at the OLDEST recorded position. It will walk forward
  // through the buffer at real-time pace, lagging the player by 8s.
  _spawnGhost() {
    if (!this.recording.length) return;
    const start = this.recording[0];
    const mesh = this._buildGhostMesh();
    mesh.position.set(start.x, 0.9, start.z);
    this.scene.add(mesh);
    this.ghosts.push({
      mesh,
      pathIdx: 0,            // float — fractional sample index
      pathSpeed: RECORD_HZ,  // samples per second (replays in real time)
      fireT: 0.8 + Math.random() * 0.8,
      bornT: this._t,
    });
  }

  _buildGhostMesh() {
    const g = new THREE.Group();
    // Translucent humanoid silhouette: pelvis box + torso box + head sphere.
    const mat = new THREE.MeshBasicMaterial({
      color: 0xb892f0, transparent: true, opacity: 0.55,
      depthWrite: false,
    });
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.22), mat);
    pelvis.position.y = -0.5;
    g.add(pelvis);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.5, 12), mat);
    torso.position.y = -0.18;
    g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mat);
    head.position.y = 0.2;
    g.add(head);
    return g;
  }

  // Returns true to keep ghost alive, false to retire it.
  _tickGhost(ghost, dt) {
    ghost.pathIdx += dt * ghost.pathSpeed;
    const idx = Math.floor(ghost.pathIdx);
    if (idx >= this.recording.length - 1) return false;   // ran out of recording
    // Smooth between samples for visual glide.
    const a = this.recording[idx];
    const b = this.recording[Math.min(idx + 1, this.recording.length - 1)];
    const f = ghost.pathIdx - idx;
    const x = a.x + (b.x - a.x) * f;
    const z = a.z + (b.z - a.z) * f;
    ghost.mesh.position.x = x;
    ghost.mesh.position.z = z;
    // Face the actual player.
    const p = this.ctx.getPlayerPos();
    if (p) {
      const dx = p.x - x, dz = p.z - z;
      ghost.mesh.rotation.y = Math.atan2(dx, dz);
    }
    // Fire on cooldown — slow tracking pistol shot.
    ghost.fireT -= dt;
    if (ghost.fireT <= 0) {
      const fireInterval = this.phase === 1 ? 1.5 : this.phase === 2 ? 1.1 : 0.8;
      ghost.fireT = fireInterval + Math.random() * 0.4;
      this._ghostFire(ghost);
    }
    return true;
  }

  _destroyGhost(ghost) {
    if (!ghost?.mesh) return;
    if (ghost.mesh.parent) ghost.mesh.parent.remove(ghost.mesh);
    ghost.mesh.traverse((o) => { if (o.geometry?.dispose) o.geometry.dispose(); });
  }

  // Fire a hitscan-style pistol shot from the ghost toward the player.
  // Damage routes through ctx.damagePlayer; iframes honored.
  _ghostFire(ghost) {
    const ctx = this.ctx;
    const p = ctx.getPlayerPos();
    if (!p || !ghost?.mesh) return;
    const dx = p.x - ghost.mesh.position.x;
    const dz = p.z - ghost.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 18) return;     // out of effective range
    // Visual tracer — reuse combat.spawnShot.
    const from = new THREE.Vector3(ghost.mesh.position.x, 1.0, ghost.mesh.position.z);
    const to   = new THREE.Vector3(p.x, 1.0, p.z);
    if (ctx.combat && ctx.combat.spawnShot) {
      ctx.combat.spawnShot(from, to, 0xb892f0, { light: false, flash: false });
    }
    // Hit check — 70% accuracy, drops with distance. Iframes ignore.
    if (ctx.playerHasIFrames && ctx.playerHasIFrames()) return;
    const hitChance = Math.max(0.25, 0.85 - dist * 0.04);
    if (Math.random() > hitChance) return;
    const dmg = this.phase === 1 ? 12 : this.phase === 2 ? 14 : 16;
    ctx.damagePlayer(dmg, 'echo-ghost', { source: 'megaboss-echo' });
  }

  // Phase 3 sweep beam damage check. The beam points along the eye's
  // sweepAngle; if the player is inside the narrow cone, take damage.
  _sweepDamageCheck() {
    if (this.phase !== 3) return;
    const ctx = this.ctx;
    if (!ctx.getPlayerPos || (ctx.playerHasIFrames && ctx.playerHasIFrames())) return;
    const p = ctx.getPlayerPos();
    if (!this.group || !p) return;
    const cx = this.group.position.x;
    const cz = this.group.position.z;
    const dx = p.x - cx, dz = p.z - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq > 14 * 14) return;          // out of beam range
    const angToPlayer = Math.atan2(dx, dz);
    let delta = angToPlayer - this.sweepAngle;
    while (delta >  Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const halfBeam = 0.06;                  // ~3.4° half-cone
    if (Math.abs(delta) < halfBeam) {
      ctx.damagePlayer(8, 'echo-beam', { source: 'megaboss-echo-beam' });
    }
  }

  // ---------- Bullet hits ----------
  applyHit(amount) {
    if (!this.alive) return;
    if (typeof amount !== 'number' || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    // Brief flash on the core mat — cheap emissiveIntensity bump.
    if (this.coreMat) {
      const restore = this.coreMat.emissiveIntensity;
      this.coreMat.emissiveIntensity = 1.4;
      setTimeout(() => { if (this.coreMat) this.coreMat.emissiveIntensity = restore; }, 70);
    }
    if (this.hp <= 0) this._die();
  }

  _die() {
    this.alive = false;
    this._bark('PLAYBACK ENDED.');
    // Vanish ghosts immediately.
    for (const g of this.ghosts) this._destroyGhost(g);
    this.ghosts.length = 0;
    // Hide HUD bar after a beat.
    setTimeout(() => { if (this._barEl) this._barEl.style.display = 'none'; }, 1800);
    // Drop loot at base.
    if (this.ctx.lootRolls && this.ctx.loot && this.group) {
      try {
        const drops = this.ctx.lootRolls(0) || [];
        const cx = this.group.position.x, cz = this.group.position.z;
        for (let i = 0; i < drops.length; i++) {
          const a = (i / Math.max(1, drops.length)) * Math.PI * 2;
          const r = 1.2 + Math.random() * 0.4;
          this.ctx.loot.spawnItem({ x: cx + Math.cos(a) * r, y: 0.4, z: cz + Math.sin(a) * r }, drops[i]);
        }
      } catch (_) { /* swallow — loot is best-effort */ }
    }
    if (this.ctx.onMegaBossDead) this.ctx.onMegaBossDead(this);
  }

  hittables() { return this.alive && this.coreMesh ? [this.coreMesh] : []; }

  // ---------- Cleanup ----------
  destroy() {
    this.alive = false;
    for (const g of this.ghosts) this._destroyGhost(g);
    this.ghosts.length = 0;
    if (this.group) {
      if (this.group.parent) this.group.parent.remove(this.group);
      this.group.traverse((o) => {
        if (o.geometry?.dispose) o.geometry.dispose();
        if (o.material?.dispose) o.material.dispose();
      });
      this.group = null;
    }
    if (this._barEl) {
      if (this._barEl.parentNode) this._barEl.parentNode.removeChild(this._barEl);
      this._barEl = null;
    }
  }

  // ---------- Barks ----------
  _bark(text) {
    if (!text) return;
    const now = this._t;
    if (now - this._lastBarkT < 1.0) return;
    this._lastBarkT = now;
    if (!this.group || !this.ctx.camera) return;
    spawnSpeechBubble(text, {
      worldPos: this.group.position.clone().add(new THREE.Vector3(0, 4.6, 0)),
      camera: this.ctx.camera,
      durationMs: 3000,
      tint: '#b892f0',
    });
  }
}

// Loot-roll builder — same shape as buildMegaBossLoot in megaboss.js.
// Echo's tier is slightly under THE ARBOTER (lower max HP, less arena
// pressure) so the rolls are a hair lighter.
export function buildEchoLoot({ randomWeapon, randomArmor, pickHealConsumable, pickJunk }, encIdx = 0) {
  const drops = [];
  // 1 weapon (epic on first encounter, scales toward legendary on repeats).
  const wRarity = encIdx >= 2 ? 'legendary' : 'epic';
  const w = randomWeapon?.(wRarity);
  if (w) drops.push(w);
  // 1 armor (rare baseline, epic on repeats).
  const aRarity = encIdx >= 1 ? 'epic' : 'rare';
  const a = randomArmor?.(aRarity);
  if (a) drops.push(a);
  // 2 heal consumables.
  for (let i = 0; i < 2; i++) {
    const c = pickHealConsumable?.();
    if (c) drops.push(c);
  }
  // 1 junk for credits.
  const j = pickJunk?.();
  if (j) drops.push(j);
  return drops;
}
