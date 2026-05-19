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
import { buildRig, initAnim, updateAnim } from './actor_rig.js';
import { spawnSpeechBubble } from './hud.js';
import { tunables } from './tunables.js';

// Tuning lives in `tunables.megabossEcho` — see balance pass note. All
// damage / range / cadence / phase-threshold values are sourced through
// `_T()` so a single retune happens in one place.
const _T = () => tunables.megabossEcho;
const _Tarena = () => tunables.megaboss;

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

// Recording window — `recordHz` samples per second × `recordLen` samples
// = ~8s of player movement at the defaults. See tunables.megabossEcho.

export class MegaBossEcho {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;

    this.maxHp = _T().maxHp;
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
    // Tagged as a head-zone hittable so bullets aimed at the visually
    // dominant pulse sphere actually register damage. Without this the
    // raycast passed through the eye into empty air above the core
    // cylinder and the player couldn't damage the boss from iso angles.
    const eyeGeo = new THREE.SphereGeometry(0.55, 24, 16);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xb892f0 });
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.y = 4.1;
    eye.userData.zone = 'head';
    eye.userData.owner = this;
    eye.userData.megaBoss = true;
    g.add(eye);
    this.eyeMesh = eye;
    this.eyeMat = eyeMat;

    // Halo ring — additive, gives the eye a bloom-friendly aura.
    // Hittable too so a near-miss on the eye still registers.
    const ringGeo = new THREE.TorusGeometry(0.85, 0.06, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xb892f0, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 4.1;
    ring.rotation.x = Math.PI / 2;
    ring.userData.zone = 'torso';
    ring.userData.owner = this;
    ring.userData.megaBoss = true;
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

    // Spider chassis — 6 jointed legs splayed from the base. Each leg
    // is thigh + shin pivoting at the base; pivots are stored on
    // `this.legs[]` so the per-tick animator can drive a slow walk
    // cycle while the body drifts. Outward angles spaced evenly
    // around the base.
    this.legs = [];
    const legCount = 6;
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x1a1224, metalness: 0.6, roughness: 0.5,
      emissive: new THREE.Color(0x2a1a3a), emissiveIntensity: 0.4,
    });
    const legJointMat = new THREE.MeshStandardMaterial({
      color: 0x4a2a78, metalness: 0.7, roughness: 0.3,
      emissive: new THREE.Color(0x4a2a78), emissiveIntensity: 0.6,
    });
    for (let i = 0; i < legCount; i++) {
      const theta = (i / legCount) * Math.PI * 2;
      // Outer hip group holds the leg's outward orientation. A nested
      // swingPivot is what the animator drives — keeps the gait
      // independent of the orientation matrix.
      const hipPivot = new THREE.Group();
      hipPivot.position.set(Math.cos(theta) * 1.6, 0.55, Math.sin(theta) * 1.6);
      hipPivot.rotation.y = -theta;     // align leg's local +X outward
      g.add(hipPivot);

      const swingPivot = new THREE.Group();
      hipPivot.add(swingPivot);

      // Thigh — slanted down-and-out from the hip. Mesh rotated so
      // the cylinder lies along the leg's local +X.
      const thighGeo = new THREE.CylinderGeometry(0.085, 0.07, 1.05, 8);
      const thighMesh = new THREE.Mesh(thighGeo, legMat);
      thighMesh.position.set(0.45, 0, 0);
      thighMesh.rotation.z = -Math.PI / 2;
      thighMesh.castShadow = true;
      swingPivot.add(thighMesh);

      // Knee joint — small glowing sphere where thigh meets shin.
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.10, 10, 8), legJointMat);
      knee.position.set(0.95, 0, 0);
      swingPivot.add(knee);

      // Shin — descends from the knee to the ground. Anchored as a
      // child of swingPivot so it inherits the gait swing.
      const shinGeo = new THREE.CylinderGeometry(0.06, 0.04, 1.20, 8);
      const shinMesh = new THREE.Mesh(shinGeo, legMat);
      shinMesh.position.set(1.20, -0.45, 0);
      shinMesh.rotation.z = -Math.PI / 4;
      shinMesh.castShadow = true;
      swingPivot.add(shinMesh);

      this.legs.push({
        swingPivot,
        baseY: hipPivot.rotation.y,   // kept for reference; not modified per tick
        phase: i * (Math.PI * 2 / legCount),
      });
    }

    // Arms — two articulated arms hanging from the upper core with
    // claws on the end. Anchored on the sides at core's mid height.
    // Each arm: shoulder pivot → upper-arm → elbow → forearm →
    // claw cluster. Pivots stored so we can swing them per tick.
    this.arms = [];
    const armMat = new THREE.MeshStandardMaterial({
      color: 0x2a1a44, metalness: 0.6, roughness: 0.4,
      emissive: new THREE.Color(0x4a2a78), emissiveIntensity: 0.3,
    });
    const clawMat = new THREE.MeshStandardMaterial({
      color: 0xb892f0, metalness: 0.7, roughness: 0.3,
      emissive: new THREE.Color(0xb892f0), emissiveIntensity: 0.7,
    });
    for (let side = 0; side < 2; side++) {
      const sgn = side === 0 ? -1 : 1;
      const shoulder = new THREE.Group();
      shoulder.position.set(sgn * 0.65, 3.0, 0);
      g.add(shoulder);

      // Upper arm — angled down + outward.
      const upper = new THREE.Group();
      shoulder.add(upper);
      const upperGeo = new THREE.CylinderGeometry(0.13, 0.10, 1.0, 10);
      const upperMesh = new THREE.Mesh(upperGeo, armMat);
      upperMesh.position.set(sgn * 0.45, -0.20, 0);
      upperMesh.rotation.z = sgn * Math.PI / 2.5;
      upperMesh.castShadow = true;
      upper.add(upperMesh);

      // Elbow joint.
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), legJointMat);
      elbow.position.set(sgn * 0.85, -0.55, 0);
      upper.add(elbow);

      // Forearm — pivots at the elbow, dangles forward + down.
      const forearm = new THREE.Group();
      forearm.position.set(sgn * 0.85, -0.55, 0);
      upper.add(forearm);
      const forearmGeo = new THREE.CylinderGeometry(0.10, 0.07, 0.95, 8);
      const forearmMesh = new THREE.Mesh(forearmGeo, armMat);
      forearmMesh.position.set(0, -0.45, 0);
      forearmMesh.castShadow = true;
      forearm.add(forearmMesh);

      // Claw cluster — three fingers spreading outward.
      const clawRoot = new THREE.Group();
      clawRoot.position.set(0, -0.92, 0);
      forearm.add(clawRoot);
      for (let c = 0; c < 3; c++) {
        const finger = new THREE.Mesh(
          new THREE.ConeGeometry(0.05, 0.32, 6),
          clawMat,
        );
        finger.position.set(0, -0.16, 0);
        const cAng = (c - 1) * 0.45;
        const fingerPivot = new THREE.Group();
        fingerPivot.rotation.z = cAng;
        fingerPivot.rotation.x = 0.18;
        fingerPivot.add(finger);
        clawRoot.add(fingerPivot);
      }

      this.arms.push({ shoulder, upper, forearm, sgn, phase: side * Math.PI });
    }

    this.scene.add(g);
    this.group = g;
  }

  spawn(pos) {
    const p = pos.clone ? pos.clone() : pos;
    this._buildMesh(p);
    // Remember the arena center so the drift orbits around it rather
    // than wandering off the floor plate.
    this._driftCenterX = p.x;
    this._driftCenterZ = p.z;
    this._driftAngle = Math.random() * Math.PI * 2;
    this.alive = true;
    if (this._barEl) this._barEl.style.display = 'block';
    this._bark(BARKS_INTRO[Math.floor(Math.random() * BARKS_INTRO.length)]);
    this._updateBossBar();
  }

  // ---------- Visual-only tick ----------
  // Drives eye + ring spin, color pulse, and phase-3 beam reveal.
  // Called by both the host's update() (below) and by the joiner's
  // post-snapshot path so the mirror doesn't freeze when its local
  // update() is gated off. Reads megaBoss.phase from the snapshot
  // rather than recomputing it from hpRatio so joiner stays aligned
  // with host's authoritative phase.
  tickVisuals(dt) {
    if (!this.alive) return;
    this._t = (this._t || 0) + dt;
    if (this.eyeMesh) this.eyeMesh.rotation.y += dt * 1.2;
    if (this.ringMesh) {
      this.ringMesh.rotation.z += dt * 0.6;
      this.ringMesh.rotation.x = Math.PI / 2 + Math.sin(this._t * 0.8) * 0.18;
    }
    this._animateLimbs();
    const hpRatio = this.maxHp ? this.hp / this.maxHp : 1;
    const targetHex = hpRatio > 0.75 ? 0xb892f0 : hpRatio > 0.35 ? 0xff70d0 : 0xff5070;
    if (this.eyeMat) this.eyeMat.color.setHex(targetHex);
    if (this.beamMat) this.beamMat.opacity = this.phase === 3 ? 0.65 : 0;
  }

  // Slow orbital drift around the spawn-time arena center. Host-only
  // (joiner sees the boss position via the megaboss snapshot's x/z).
  // Radius + angular speed both ramp with phase so the boss gets
  // harder to pre-aim as the fight progresses.
  _tickDrift(dt) {
    if (!this.group || this._driftCenterX == null) return;
    // Phase 1: tight slow drift. Phase 2/3 widen + speed up so the
    // boss is meaningfully moving by the time ghosts are stacking.
    const radius = this.phase === 3 ? 5.5 : this.phase === 2 ? 4.0 : 2.6;
    const angVel = this.phase === 3 ? 0.55 : this.phase === 2 ? 0.40 : 0.28;
    this._driftAngle = (this._driftAngle || 0) + angVel * dt;
    const tx = this._driftCenterX + Math.cos(this._driftAngle) * radius;
    const tz = this._driftCenterZ + Math.sin(this._driftAngle) * radius;
    // Lerp toward the target each frame so phase transitions don't
    // teleport — Echo glides into the wider orbit.
    const k = 1 - Math.exp(-1.2 * dt);
    const prevX = this.group.position.x;
    const prevZ = this.group.position.z;
    const nextX = prevX + (tx - prevX) * k;
    const nextZ = prevZ + (tz - prevZ) * k;
    this.group.position.x = nextX;
    this.group.position.z = nextZ;
    // Record how fast we're actually moving so _animateLimbs can dial
    // the gait amplitude. ~0.3 m/s baseline, 2-3 m/s at phase 3.
    const dx = nextX - prevX;
    const dz = nextZ - prevZ;
    const moved = Math.hypot(dx, dz) / Math.max(1e-4, dt);
    // Smooth so gait doesn't twitch frame to frame.
    const prevSpeed = this._driftSpeed || 0;
    this._driftSpeed = prevSpeed + (Math.min(1.6, moved * 0.6) - prevSpeed) * Math.min(1, dt * 6);
    // Slow facing yaw toward direction of travel so legs lead the body.
    if (moved > 0.05) {
      const targetYaw = Math.atan2(dx, dz);
      const cur = this.group.rotation.y;
      let delta = targetYaw - cur;
      while (delta >  Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.group.rotation.y = cur + delta * Math.min(1, dt * 2.0);
    }
  }

  // Drives the spider-leg walk cycle + arm/claw sway. Runs from both
  // host update() and joiner tickVisuals() so the boss is animated on
  // both sides. Body Y bob is folded in so legs + chassis stay in
  // sync rather than drifting against each other.
  _animateLimbs() {
    const t = this._t || 0;
    // Speed up the gait when the body is actually moving so a still
    // boss reads as standing rather than perpetually marching.
    const speed = this._driftSpeed || 0.6;
    if (this.legs) {
      for (const leg of this.legs) {
        // Forward/back swing around the local vertical — sweeps the
        // foot in an arc around the hip anchor (proper gait).
        const swing = Math.sin(t * 1.8 + leg.phase) * 0.45 * speed;
        leg.swingPivot.rotation.y = swing;
        // Small Y lift during the forward half of the cycle so the
        // foot looks like it leaves the ground.
        const lift = Math.max(0, Math.sin(t * 1.8 + leg.phase)) * 0.18 * speed;
        leg.swingPivot.position.y = lift;
      }
    }
    if (this.arms) {
      for (const arm of this.arms) {
        const sway = Math.sin(t * 0.9 + arm.phase) * 0.35;
        arm.upper.rotation.x = sway;
        arm.forearm.rotation.x = -sway * 0.8 + Math.sin(t * 1.4 + arm.phase) * 0.15;
      }
    }
    // Subtle body bob — small Y pulse so the chassis breathes.
    if (this.group) {
      this.group.position.y = Math.sin(t * 1.4) * 0.06;
    }
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
    // Drift — Echo slowly orbits the spawn center, faster in later
    // phases so it doesn't read as static while still being trackable.
    // Limb animation runs after the position update so the spider
    // gait is in sync with body motion.
    this._tickDrift(dt);
    this._animateLimbs();
    // Eye color pulses by phase: purple → magenta → red as HP drops.
    const hpRatio = this.hp / this.maxHp;
    const targetHex = hpRatio > 0.75 ? 0xb892f0 : hpRatio > 0.35 ? 0xff70d0 : 0xff5070;
    if (this.eyeMat) this.eyeMat.color.setHex(targetHex);

    // Phase transitions.
    const T = _T();
    const nextPhase = hpRatio > T.phase2HpRatio ? 1 : hpRatio > T.phase3HpRatio ? 2 : 3;
    if (nextPhase !== this.phase) {
      this.phase = nextPhase;
      const lib = nextPhase === 2 ? BARKS_PHASE2 : BARKS_PHASE3;
      this._bark(lib[Math.floor(Math.random() * lib.length)]);
      // Phase 3 reveals the sweep beam.
      if (this.beamMat) this.beamMat.opacity = nextPhase === 3 ? 0.65 : 0;
    }

    // Record the player's position once per recordHz.
    this.recordT += dt;
    if (this.recordT >= 1 / T.recordHz) {
      this.recordT = 0;
      const p = this.ctx.getPlayerPos();
      if (p) {
        this.recording.push({ x: p.x, z: p.z });
        if (this.recording.length > T.recordLen) this.recording.shift();
      }
    }

    // Ghost spawning — phase-controlled count + interval. Indexed
    // (phase − 1) into the per-phase tunable arrays.
    const phaseIdx = this.phase - 1;
    const wantCount     = T.ghostCountPerPhase[phaseIdx];
    const spawnInterval = T.ghostSpawnIntervalSec[phaseIdx];
    this.spawnT -= dt;
    // Min recording length to spawn ghost — 30 samples ≈ 3s of movement
    // history. Held inline as an algorithm minimum (insufficient samples
    // would give a degenerate path, not a tuning value).
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
      this.sweepAngle += dt * T.beamRotationRadPerSec;
      this.beamMesh.rotation.y = this.sweepAngle;
      this.sweepT -= dt;
      if (this.sweepT <= 0) {
        this.sweepT = T.beamDamageTickSec;
        this._sweepDamageCheck();
      }
    }

    this._updateBossBar();
  }

  // Spawn a ghost at the OLDEST recorded position. It will walk forward
  // through the buffer at real-time pace, lagging the player by 8s.
  _spawnGhost() {
    if (!this.recording.length) return;
    const T = _T();
    const start = this.recording[0];
    const rig = this._buildGhostRig();
    rig.group.position.set(start.x, 0, start.z);
    this.scene.add(rig.group);
    this._ghostIdCounter = (this._ghostIdCounter | 0) + 1;
    this.ghosts.push({
      gid: this._ghostIdCounter,         // stable id for coop snapshot matching
      rig,
      pathIdx: 0,                        // float — fractional sample index
      pathSpeed: T.recordHz,             // samples per second (replays in real time)
      fireT: T.ghostFirstShotDelayMin + Math.random() * T.ghostFirstShotDelayJitter,
      bornT: this._t,
      lastX: start.x,
      lastZ: start.z,
    });
  }
  // Coop: encode the live ghost list as a compact [{gid, x, z}, ...]
  // array. Joiner's snapshot apply (in coop/snapshot.js) reads this
  // off the megaboss snapshot's `extras.echoGhosts` field and
  // reconciles local mirror rigs so the joiner can SEE the ghosts.
  _coopEncodeGhosts() {
    if (!this.ghosts.length) return null;
    const out = [];
    for (const g of this.ghosts) {
      if (!g?.rig?.group) continue;
      out.push({
        n: g.gid | 0,
        x: +g.rig.group.position.x.toFixed(2),
        z: +g.rig.group.position.z.toFixed(2),
      });
    }
    return out;
  }
  // Joiner-side: reconcile local mirror ghosts against an array
  // received from the host's snapshot. Spawns rigs for new gids,
  // updates positions for known ones, despawns ones the host has
  // dropped. This is visual-only — no recording / ghost AI runs on
  // the joiner; damage still routes through the host's auth path.
  _coopApplyGhostMirrors(snapList) {
    const list = Array.isArray(snapList) ? snapList : [];
    const live = new Set();
    for (const sg of list) {
      live.add(sg.n | 0);
      let local = null;
      for (const g of this.ghosts) {
        if ((g.gid | 0) === (sg.n | 0)) { local = g; break; }
      }
      if (!local) {
        // Late-arrival mirror — joiner's recording buffer is empty
        // so we can't reuse _spawnGhost (which reads from it).
        // Build the rig directly + park at the snapshot position.
        const rig = this._buildGhostRig();
        rig.group.position.set(+sg.x || 0, 0, +sg.z || 0);
        this.scene.add(rig.group);
        this.ghosts.push({
          gid: sg.n | 0, rig,
          pathIdx: 0, pathSpeed: 0, fireT: 1e9, bornT: 0,
          lastX: +sg.x || 0, lastZ: +sg.z || 0,
          _coopRemote: true,
        });
        continue;
      }
      // Position update.
      local.rig.group.position.set(+sg.x || 0, 0, +sg.z || 0);
    }
    // Despawn locals the host says are gone.
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      if (!live.has(g.gid | 0)) {
        try { this._destroyGhost(g); } catch (_) {}
        this.ghosts.splice(i, 1);
      }
    }
  }

  _buildGhostRig() {
    // The "echo" replays the player's recorded movement — so the
    // visual must read as a haunted player figure, not a generic blob.
    // Reuses the canonical buildRig (same rig system as the player and
    // gunmen) and converts every material to translucent additive so
    // the silhouette reads ghostly without losing the recognizable
    // humanoid shape. Animation is driven by frame-to-frame ground
    // speed in _tickGhost so the legs actually walk.
    const rig = buildRig({
      scale: 0.77,
      bodyColor: 0x4a3878, headColor: 0x6850a0,
      legColor:  0x3a2860, armColor:  0x4a3878,
      handColor: 0x2a1840, gearColor: 0x301848,
      bootColor: 0x180c20,
    });
    initAnim(rig);
    rig.group.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material.transparent = true;
        o.material.opacity = 0.55;
        o.material.depthWrite = false;
      }
    });
    return rig;
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
    const grp = ghost.rig.group;
    grp.position.x = x;
    grp.position.z = z;
    // Face the actual player.
    const p = this.ctx.getPlayerPos();
    if (p) {
      const dx = p.x - x, dz = p.z - z;
      grp.rotation.y = Math.atan2(dx, dz);
    }
    // Drive rig animation from real frame-to-frame ground speed so the
    // ghost's gait matches the recorded movement (idle → walk → run).
    const stepDx = x - ghost.lastX;
    const stepDz = z - ghost.lastZ;
    const speed  = Math.hypot(stepDx, stepDz) / Math.max(0.001, dt);
    ghost.lastX = x; ghost.lastZ = z;
    updateAnim(ghost.rig, { speed, dying: false }, dt);
    // Fire on cooldown — slow tracking pistol shot.
    ghost.fireT -= dt;
    if (ghost.fireT <= 0) {
      const T = _T();
      const fireInterval = T.ghostFireIntervalSec[this.phase - 1];
      ghost.fireT = fireInterval + Math.random() * T.ghostFireIntervalJitter;
      this._ghostFire(ghost);
    }
    return true;
  }

  _destroyGhost(ghost) {
    if (!ghost?.rig) return;
    const grp = ghost.rig.group;
    if (grp.parent) grp.parent.remove(grp);
    grp.traverse((o) => {
      if (o.geometry?.dispose) o.geometry.dispose();
      if (o.material?.dispose) o.material.dispose();
    });
  }

  // Fire a hitscan-style pistol shot from the ghost toward the player.
  // Damage routes through ctx.damagePlayer; iframes honored.
  _ghostFire(ghost) {
    const ctx = this.ctx;
    const p = ctx.getPlayerPos();
    if (!p || !ghost?.rig) return;
    const T = _T();
    const grp = ghost.rig.group;
    const dx = p.x - grp.position.x;
    const dz = p.z - grp.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > T.ghostFireRange) return;     // out of effective range
    // Visual tracer — reuse combat.spawnShot.
    const from = new THREE.Vector3(grp.position.x, 1.0, grp.position.z);
    const to   = new THREE.Vector3(p.x, 1.0, p.z);
    if (ctx.combat && ctx.combat.spawnShot) {
      ctx.combat.spawnShot(from, to, 0xb892f0, { light: false, flash: false });
    }
    // Hit check — accuracy = max(min, base − falloffPerM·dist). Iframes ignore.
    if (ctx.playerHasIFrames && ctx.playerHasIFrames()) return;
    const hitChance = Math.max(
      T.ghostHitChanceMin,
      T.ghostHitChanceBase - dist * T.ghostHitChanceFalloffPerM,
    );
    if (Math.random() > hitChance) return;
    const dmg = T.ghostDamagePerPhase[this.phase - 1];
    ctx.damagePlayer(dmg, 'echo-ghost', { source: 'megaboss-echo' });
    // Coop: ghost hitscan also hits joiner ghosts standing near the
    // host's hit point. Loose 1.0m radius — Echo ghosts are aiming
    // at the host position so this approximates "co-located" damage.
    ctx.damageRemotePlayersInRadius?.(p.x, p.z, 1.0, dmg, 'megaboss');
  }

  // Phase 3 sweep beam damage check. The beam points along the eye's
  // sweepAngle; if the player is inside the narrow cone, take damage.
  _sweepDamageCheck() {
    if (this.phase !== 3) return;
    const ctx = this.ctx;
    if (!ctx.getPlayerPos || (ctx.playerHasIFrames && ctx.playerHasIFrames())) return;
    const p = ctx.getPlayerPos();
    if (!this.group || !p) return;
    const T = _T();
    const cx = this.group.position.x;
    const cz = this.group.position.z;
    const dx = p.x - cx, dz = p.z - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq > T.beamRange * T.beamRange) return;          // out of beam range
    const angToPlayer = Math.atan2(dx, dz);
    let delta = angToPlayer - this.sweepAngle;
    while (delta >  Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) < T.beamHalfConeRad) {
      ctx.damagePlayer(T.beamDamage, 'echo-beam', { source: 'megaboss-echo-beam' });
    }
    // Coop: sweep beam also damages joiner ghosts inside the cone.
    // Independent of the host hit (joiner can be in the cone when
    // host isn't, and vice versa).
    ctx.damageRemotePlayersInCone?.(
      cx, cz, this.sweepAngle, T.beamHalfConeRad, T.beamRange,
      T.beamDamage, 'megaboss',
    );
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
    if (this.ctx.bumpEncounterCount) {
      try { this.ctx.bumpEncounterCount(); } catch (_) {}
    }
    this._bark('PLAYBACK ENDED.');
    // Vanish ghosts immediately.
    for (const g of this.ghosts) this._destroyGhost(g);
    this.ghosts.length = 0;
    // Hide HUD bar after a beat.
    setTimeout(() => { if (this._barEl) this._barEl.style.display = 'none'; }, 1800);
    // Drop loot at base. Arena half-size = 15m (level.js); clamp to
    // megaboss.arenaInner so an edge-of-arena death never flings drops
    // behind a wall.
    if (this.ctx.lootRolls && this.ctx.loot && this.group) {
      try {
        const T = _T();
        const inner = _Tarena().arenaInner;
        const drops = this.ctx.lootRolls(0) || [];
        const cx = this.group.position.x, cz = this.group.position.z;
        for (let i = 0; i < drops.length; i++) {
          const a = (i / Math.max(1, drops.length)) * Math.PI * 2;
          const r = T.lootDropRadiusBase + Math.random() * T.lootDropRadiusJitter;
          let lx = cx + Math.cos(a) * r;
          let lz = cz + Math.sin(a) * r;
          lx = Math.max(-inner, Math.min(inner, lx));
          lz = Math.max(-inner, Math.min(inner, lz));
          this.ctx.loot.spawnItem({ x: lx, y: T.lootDropY, z: lz }, drops[i]);
        }
      } catch (_) { /* swallow — loot is best-effort */ }
    }
    if (this.ctx.onMegaBossDead) this.ctx.onMegaBossDead(this);
  }

  hittables() {
    if (!this.alive) return [];
    const out = [];
    if (this.coreMesh) out.push(this.coreMesh);
    if (this.eyeMesh)  out.push(this.eyeMesh);
    if (this.ringMesh) out.push(this.ringMesh);
    return out;
  }

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
  // hud.spawnSpeechBubble takes positional (worldPos, camera, text, life)
  // — the (text, opts) call shape that lived here was a holdover from
  // a different bubble API and was silently no-op'ing every Echo bark.
  _bark(text) {
    if (!text) return;
    const now = this._t;
    if (now - this._lastBarkT < _T().barkCooldownSec) return;
    this._lastBarkT = now;
    if (!this.group || !this.ctx.camera) return;
    const wp = this.group.position.clone().add(new THREE.Vector3(0, 4.6, 0));
    spawnSpeechBubble(wp, this.ctx.camera, text, 3.0);
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
