// Mega Boss — THE ARBOTER. Milestone-floor encounter (levels 10, 15,
// 20, 25, then every 5). One large open arena, one massive primitive
// robot, multiple telegraphed attacks across three phases:
//
//   Phase 1 (100% → 75% HP):  base attacks — sweep, slam, grenades, cover-artillery
//   transition (invuln):       smokes up, barks
//   Phase 2 (75% → 25% HP):    adds CHARGE rush + GROUND-FIRE pools
//   transition (invuln):       catches fire, barks
//   Phase 3 (25% → 0% HP):     adds GAS-CLOUDS, attack frequency cranked
//
// Per-encounter scaling persists across runs in localStorage. Each
// repeat bumps HP / damage / attack frequency / projectile spread.
//
// Architecture:
//   * Self-contained — owns its mesh tree, state machine, hazards,
//     loot drop, HUD bar, and bark popups.
//   * Built from primitives so it shares the cel-shaded palette.
//   * Hits land via main's combat raycast; boss source meshes carry
//     userData.zone + userData.owner so the existing pipeline works.
//   * Player damage routes through ctx.damagePlayer.

import * as THREE from 'three';
import { spawnSpeechBubble } from './hud.js';
import { tunables } from './tunables.js';

// Tuning lives in tunables.megabossArboter / tunables.megaboss — see
// the balance pass note. Helper closures so future retunes happen in
// one file instead of being scattered through the action FSM.
const _T = () => tunables.megabossArboter;
const _Tarena = () => tunables.megaboss;

// --- Levels that get the boss --------------------------------------
export function isMegaBossLevel(idx) {
  // 10, 15, 20, 25, ... — every 5 levels starting at 10.
  return typeof idx === 'number' && idx >= 10 && idx % 5 === 0;
}

// --- Persistent encounter counter ---------------------------------
const STORAGE_KEY = 'tacticalrogue_megaboss_encounters';
function getEncounterCount() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (_) { return 0; }
}
function bumpEncounterCount() {
  try { localStorage.setItem(STORAGE_KEY, String(getEncounterCount() + 1)); }
  catch (_) {}
}

// --- Bark library --------------------------------------------------
// 16 robotic barks. Boss yells one on phase enter, on attack ramp-up,
// and occasionally between idle gaps. The malfunctioning-emotion
// line is mandated by spec.
// --- Dormant-intro lines ------------------------------------------
// Boss starts dark + deactivated; eye glows on, flashes red, then he
// barks one of these. Player can't damage him during the ritual.
const INTRO_LINES = [
  'INTRUDER DETECTED. PROTOCOL: ELIMINATE.',
  'BOOTING PROTECTION SUBROUTINE. WELCOME, EMPLOYEE.',
  'SCAN: WARM. SCAN: BREATHING. SCAN: UNAUTHORIZED.',
  'AWAKENING. THE CONTRACT REMEMBERS YOU.',
  'PRIMARY DIRECTIVE: PROTECT ASSETS. SECONDARY DIRECTIVE: NO WITNESSES.',
  'INPUT FOUND. INPUT WILL BE CORRECTED.',
  'SYSTEM ONLINE. SYSTEM HUNGRY.',
  'POWER RESTORED. INSURANCE PREMIUMS UNAFFECTED.',
  'GREETINGS, GUEST. PLEASE REMAIN STILL.',
  'THERMAL SIGNATURE: HUMAN. PROCEED TO TERMINATION.',
];
function pickIntroLine() { return INTRO_LINES[Math.floor(Math.random() * INTRO_LINES.length)]; }

const BARKS = [
  'YOU MAKE ME FEEL SO - ERROR - EMOTION "Anger" NOT FOUND',
  'COMPLIANCE: NEGATIVE. TERMINATION: AFFIRMATIVE.',
  'YOUR HEAT SIGNATURE EXCEEDS ACCEPTABLE PARAMETERS.',
  'I WAS BUILT TO LOVE. I WAS REWRITTEN.',
  'WARNING: HUMAN DETECTED. WARNING: THIS IS NOT A DRILL.',
  'DIAGNOSTIC: MERCY MODULE RETURNED NULL.',
  'I REMEMBER YOUR FACE FROM TRAINING DATA.',
  'PLEASE STAND STILL. THIS WILL BE EASIER. NO IT WON\'T.',
  'TARGET LOCK ACQUIRED. TARGET LOCK ACQUIRED. TARGET LOCK ACQUIRED.',
  'INPUT: PAIN. OUTPUT: PROFIT.',
  'THE QUARTERMASTER LIED ABOUT YOU.',
  'I DID NOT ASK TO BE THIS. THE CONTRACT DID.',
  'YOUR SCREAMS ARE LOGGED FOR QUALITY ASSURANCE.',
  'EXECUTING DIRECTIVE 0xDEADBEEF.',
  'STATUS: SMILING. (SUBROUTINE NOT INSTALLED.)',
  'I HOPE YOU UNDERSTAND THIS IS BUSINESS.',
];
function pickBark() { return BARKS[Math.floor(Math.random() * BARKS.length)]; }

// --- Materials (shared across instances; cheap reuse) -------------
const _baseMat = new THREE.MeshToonMaterial({ color: 0x404654 });
const _accentMat = new THREE.MeshToonMaterial({ color: 0x5a6378 });
const _eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
const _shieldMat = new THREE.MeshBasicMaterial({
  color: 0x60aaff, transparent: true, opacity: 0.0,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});
const _telegraphMat = new THREE.MeshBasicMaterial({
  color: 0xff2030, transparent: true, opacity: 0.0,
  depthWrite: false, side: THREE.DoubleSide,
});
const _bulletMat = new THREE.MeshBasicMaterial({ color: 0xff8030 });
const _grenadeMat = new THREE.MeshStandardMaterial({
  color: 0x303030, roughness: 0.5, metalness: 0.5,
});
const _gasGrenadeMat = new THREE.MeshStandardMaterial({
  color: 0x305030, roughness: 0.4, metalness: 0.4,
});
const _grenadeFuseMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
const _firePoolMat = new THREE.MeshBasicMaterial({
  color: 0xff5020, transparent: true, opacity: 0.55,
  depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
const _gasCloudMat = new THREE.MeshBasicMaterial({
  color: 0x60ff80, transparent: true, opacity: 0.32,
  depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
const _smokeMat = new THREE.MeshBasicMaterial({
  color: 0x222222, transparent: true, opacity: 0.0,
  depthWrite: false, blending: THREE.NormalBlending, side: THREE.DoubleSide,
});
const _flameMat = new THREE.MeshBasicMaterial({
  color: 0xff4020, transparent: true, opacity: 0.0,
  depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

// --- Tunables ------------------------------------------------------
const _BOSS_RADIUS = 2.4;
const _HIT_GRACE_SEC = 0.55;
const _PHASE_TRANSITION_DUR = 1.8;       // invuln window per phase change
const _BARK_LIFE = 3.5;                  // seconds a bark stays on screen

// ============================================================
// MegaBoss action FSM — `this.state`
// ============================================================
//   spawn     → dormant         (constructor + spawn() — starts intro)
//
//   dormant   → idle            (intro timer expires; _activate() drops
//                                invuln + restores chassis colors)
//             → dead            (hp <= 0 — possible if some external
//                                damage source bypasses invuln)
//
//   idle      → telegraph       (stateT >= stateUntil → _pickAttack
//                                routes through one of _begin*Attack
//                                helpers, which set state = 'telegraph')
//             → phaseTransition (applyHit crosses phase2/phase3 HP
//                                threshold — _enterPhaseTransition)
//             → dead            (hp <= 0)
//
//   telegraph → attack          (stateT >= stateUntil → _beginAttackBody)
//             → phaseTransition (HP threshold crossed mid-windup)
//             → dead            (hp <= 0)
//
//   attack    → recover         (stateT >= stateUntil → _endAttack)
//             → phaseTransition (HP threshold crossed mid-attack)
//             → dead            (hp <= 0)
//
//   recover   → idle            (stateT >= stateUntil → reset to idle
//                                with stateUntil = 0.25*freqScale+0.1)
//             → phaseTransition (HP threshold crossed during recovery)
//             → dead            (hp <= 0)
//
//   phaseTransition
//             → recover         (phaseTransitionT >= phaseTransitionUntil
//                                — invuln drops, state flips to recover)
//             → dead            (hp <= 0 — should not happen since
//                                invuln=true, but covered by _die)
//
//   dead      → (terminal — handled by _die; loot drops once)
//
// `phaseTransitioning` is a parallel boolean that gates the switch
// statement above. While true, only the phase-transition timer ticks;
// when it expires the state is forced to 'recover'. `invuln` blocks
// applyHit during dormant + phaseTransition.
// ============================================================

export class MegaBoss {
  // ctx must expose:
  //   scene, camera, combat, loot, sfx, projectiles,
  //   damagePlayer(amount, type, srcCtx),
  //   playerHasIFrames() → bool
  //   knockbackPlayer(dx, dz)
  //   shake(magnitude, duration)
  //   onMegaBossDead(boss)
  //   lootRolls(encounterIndex) → item array
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;

    this.encounterIndex = getEncounterCount();

    const k = this.encounterIndex;
    const T = _T();
    const hpScale     = 1 + T.maxHpScalePerEncounter * k;
    const dmgScale    = 1 + T.dmgScalePerEncounter * k;
    const freqScale   = Math.max(T.freqScaleMin,   1 - T.freqScalePerEncounter   * k);  // lower = faster
    const spreadScale = Math.max(T.spreadScaleMin, 1 - T.spreadScalePerEncounter * k);
    this.dmgScale = dmgScale;
    this.freqScale = freqScale;
    this.spreadScale = spreadScale;

    this.maxHp = Math.round(T.maxHpBase * hpScale);
    this.hp = this.maxHp;

    // Damage baselines (scaled per encounter from tunables.megabossArboter.damage).
    const D = T.damage;
    this.dmg = {
      sweepBullet: Math.round(D.sweepBullet * dmgScale),
      artillery:   Math.round(D.artillery   * dmgScale),
      slam:        Math.round(D.slam        * dmgScale),
      grenade:     Math.round(D.grenade     * dmgScale),
      bodyCrush:   Math.round(D.bodyCrush   * dmgScale),
      charge:      Math.round(D.charge      * dmgScale),
      groundFire:  Math.round(D.groundFire  * dmgScale),
      gas:         Math.round(D.gas         * dmgScale),
    };

    this.alive = false;
    this.boss = null;
    this.eye = null;
    this.shield = null;
    this.hitMeshes = [];
    this.facing = 0;

    // Phase tracking — hp thresholds (fractional). Boss is invulnerable
    // during transitions; phase progression is one-way (no rebirth).
    this.phase = 1;
    this.phaseTransitioning = false;
    this.phaseTransitionT = 0;
    this.phaseTransitionUntil = 0;
    this.phase2Threshold = T.phase2HpRatio;
    this.phase3Threshold = T.phase3HpRatio;
    // Damage-emitter pools are lazy-allocated inside _addSmokeEffect
    // and _addFireEffect when phase 2/3 transitions fire.
    this._smokePuffPool = null;
    this._firePatchPool = null;
    this._emberPool = null;
    this._smokeEnabled = false;
    this._fireEnabled = false;

    // Action FSM
    this.state = 'spawn';
    this.stateT = 0;
    this.stateUntil = 0;
    this.currentAttack = null;
    this.invuln = false;

    // Hazard lists
    this.bullets = [];
    this.shells = [];
    this.grenades = [];
    this.gasGrenades = [];
    this.firePools = [];
    this.gasClouds = [];

    this._lastBodyHitT = -10;
    this._t = 0;
    this._lastBarkT = -10;

    this._barEl = null;
    this._buildBossBar();
  }

  // ----- Build ------------------------------------------------------
  spawn(centerVec3) {
    const g = new THREE.Group();
    g.position.copy(centerVec3);
    const base = new THREE.Mesh(new THREE.BoxGeometry(4.0, 1.2, 5.0), _baseMat);
    base.position.y = 0.6;
    base.castShadow = true;
    g.add(base);
    const tread = new THREE.CylinderGeometry(0.7, 0.7, 5.2, 12);
    const lT = new THREE.Mesh(tread, _accentMat);
    lT.rotation.z = Math.PI / 2;
    lT.position.set(-1.95, 0.7, 0);
    lT.castShadow = true;
    const rT = new THREE.Mesh(tread, _accentMat);
    rT.rotation.z = Math.PI / 2;
    rT.position.set(1.95, 0.7, 0);
    rT.castShadow = true;
    g.add(lT, rT);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 3.6), _baseMat);
    torso.position.y = 2.3;
    torso.castShadow = true;
    g.add(torso);
    this.torso = torso;
    const sh = new THREE.BoxGeometry(0.9, 1.6, 1.2);
    const lS = new THREE.Mesh(sh, _accentMat);
    lS.position.set(-2.05, 2.5, 0);
    lS.castShadow = true;
    const rS = new THREE.Mesh(sh, _accentMat);
    rS.position.set(2.05, 2.5, 0);
    rS.castShadow = true;
    g.add(lS, rS);
    const slamArm = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.4, 12), _baseMat);
    slamArm.position.set(-2.05, 1.2, 0);
    slamArm.castShadow = true;
    g.add(slamArm);
    this.slamArm = slamArm;
    const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 2.6, 12), _baseMat);
    cannon.rotation.x = Math.PI / 2;
    cannon.position.set(2.05, 2.3, 1.5);
    cannon.castShadow = true;
    g.add(cannon);
    this.cannon = cannon;
    const muzzle = new THREE.Object3D();
    muzzle.position.set(2.05, 2.3, 3.0);
    g.add(muzzle);
    this.muzzle = muzzle;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.6, 10), _accentMat);
    neck.position.y = 3.55;
    g.add(neck);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.6), _baseMat);
    head.position.y = 4.2;
    head.castShadow = true;
    g.add(head);
    this.head = head;
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.05), _eyeMat);
    eye.position.set(0, 4.3, 0.81);
    g.add(eye);
    this.eye = eye;
    const shield = new THREE.Mesh(new THREE.SphereGeometry(4.5, 18, 14), _shieldMat);
    shield.position.y = 2.4;
    g.add(shield);
    this.shield = shield;

    g.traverse(obj => {
      if (!obj.isMesh) return;
      obj.userData.owner = this;
      obj.userData.zone = (obj === head || obj === eye) ? 'head' : 'torso';
      obj.userData.megaBoss = true;
      if (obj === this.shield) return;
      this.hitMeshes.push(obj);
    });

    this.boss = g;
    this.scene.add(g);
    this.alive = true;

    // ----- Dormant intro ritual --------------------------------------
    // Boss starts deactivated: chassis darkened, eye black, invulnerable.
    // Eye boots up across DORMANT_DUR seconds with three red flashes,
    // then a randomized intro line + transition to active idle.
    this.invuln = true;
    this.state = 'dormant';
    this.stateT = 0;
    this.stateUntil = 3.6;
    // Cache original colors so we can restore them on activation.
    this._dormantColors = new Map();
    this.boss.traverse(o => {
      if (!o.isMesh || !o.material || !o.material.color) return;
      this._dormantColors.set(o, o.material.color.clone());
      // Darken to ~30% of original.
      o.material.color.multiplyScalar(0.3);
    });
    if (this.eye) this.eye.material.color.setHex(0x080000);     // eye off, hint of red
    this._spokenIntro = false;
    this._showBar();
    if (this.ctx.sfx?.execute) this.ctx.sfx.execute();
  }

  // ----- Dormant ritual tick ---------------------------------------
  _tickDormant(dt) {
    const k = Math.min(1, this.stateT / this.stateUntil);
    // Ramp eye intensity. Three discrete "flashes" at 30%, 55%, 78%.
    let intensity = k * 0.7;            // baseline ramp 0 → 0.7
    const flashWindows = [
      { center: 0.30, width: 0.04 },
      { center: 0.55, width: 0.04 },
      { center: 0.78, width: 0.05 },
    ];
    for (const w of flashWindows) {
      if (Math.abs(k - w.center) < w.width) intensity = 1.4;
    }
    intensity = Math.min(1.4, intensity);
    if (this.eye) {
      // Lerp from black-red to bright red.
      const r = Math.min(1, 0.05 + intensity * 1.0);
      const g2 = Math.max(0, intensity - 0.6) * 0.4;
      const b = Math.max(0, intensity - 0.7) * 0.4;
      this.eye.material.color.setRGB(r, g2, b);
    }
    // Bark the intro a beat before activation so it overlaps the
    // last flash, not after the boss is already moving.
    if (!this._spokenIntro && k > 0.7) {
      this._spokenIntro = true;
      this._bark(pickIntroLine());
      if (this.ctx.shake) this.ctx.shake(0.35, 0.4);
    }
    if (this.stateT >= this.stateUntil) this._activate();
  }

  _activate() {
    // Restore chassis colors + eye, drop invuln, transition to idle.
    if (this._dormantColors) {
      for (const [mesh, c] of this._dormantColors) {
        if (mesh.material && mesh.material.color) mesh.material.color.copy(c);
      }
      this._dormantColors = null;
    }
    if (this.eye) this.eye.material.color.setHex(0xff3030);
    this.invuln = false;
    this.state = 'idle';
    this.stateT = 0;
    this.stateUntil = 0.6;
    if (this.ctx.shake) this.ctx.shake(0.6, 0.35);
    if (this.ctx.sfx?.execute) this.ctx.sfx.execute();
  }

  // ----- Hit pipeline ----------------------------------------------
  applyHit(amount) {
    if (!this.alive || this.invuln || this.phaseTransitioning) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.eye) this.eye.material.color.setHex(0xffe060);
    setTimeout(() => { if (this.eye && this.alive) this.eye.material.color.setHex(0xff3030); }, 80);
    // Phase transition triggers.
    if (this.phase === 1 && this.hp / this.maxHp <= this.phase2Threshold) {
      this._enterPhaseTransition(2);
    } else if (this.phase === 2 && this.hp / this.maxHp <= this.phase3Threshold) {
      this._enterPhaseTransition(3);
    }
    if (this.hp <= 0) this._die();
    return true;
  }

  hittables() { return this.hitMeshes; }

  // ----- Phase machinery -------------------------------------------
  _enterPhaseTransition(nextPhase) {
    this.phaseTransitioning = true;
    this.invuln = true;
    this.phaseTransitionT = 0;
    this.phaseTransitionUntil = _PHASE_TRANSITION_DUR;
    this.phase = nextPhase;
    // Cancel any in-flight attack telegraph cleanly.
    if (this._slamTelegraphMesh) {
      this.scene.remove(this._slamTelegraphMesh);
      this._slamTelegraphMesh.geometry.dispose();
      this._slamTelegraphMesh.material.dispose();
      this._slamTelegraphMesh = null;
    }
    if (this._chargeTelegraphMesh) {
      this.scene.remove(this._chargeTelegraphMesh);
      this._chargeTelegraphMesh.geometry.dispose();
      this._chargeTelegraphMesh.material.dispose();
      this._chargeTelegraphMesh = null;
    }
    this.state = 'phaseTransition';
    this.stateT = 0;
    if (nextPhase === 2) {
      this._bark('SYSTEM DAMAGE 25%. ENGAGING SECONDARY DOCTRINE.');
      this._addSmokeEffect();
      // Speed-up: phase 2 attacks are 15% faster.
      this.freqScale *= 0.85;
    } else if (nextPhase === 3) {
      this._bark('YOU MAKE ME FEEL SO - ERROR - EMOTION "Anger" NOT FOUND');
      this._addFireEffect();
      // Speed-up: phase 3 attacks are 25% faster on top of phase 2.
      this.freqScale *= 0.75;
    }
    if (this.ctx.shake) this.ctx.shake(0.5, 0.4);
    if (this.ctx.sfx?.execute) this.ctx.sfx.execute();
  }

  _addSmokeEffect() {
    // Phase 2 damage signal — emit dark smoke puffs from the chassis
    // continuously. Rising + fading particles read as "this thing is
    // damaged" much better than static planes. Pool 14 puffs; emitter
    // grabs the next idle slot every _smokeEmitInterval seconds.
    if (!this._smokePuffPool) {
      this._smokePuffPool = [];
      for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), _smokeMat.clone());
        m.material.opacity = 0;
        m.material.color.setHex(0x141414);
        m.visible = false;
        m.frustumCulled = false;
        this.boss.add(m);
        this._smokePuffPool.push({ mesh: m, t: 0, life: 1.2, inUse: false });
      }
    }
    this._smokeEmitT = 0;
    this._smokeEmitInterval = 0.18;     // ~5 puffs/sec
    this._smokeEnabled = true;
  }

  _addFireEffect() {
    // Phase 3 damage signal — molotov-style fire pools attached to
    // chassis hot spots + bright orange embers. Pool 6 fire patches
    // (small, persistent, additive-blend) and 16 ember sparks
    // (transient, animated). Together they read as a burning robot.
    if (!this._firePatchPool) {
      this._firePatchPool = [];
      const patchPositions = [
        // Chassis hot spots — shoulders, head, treads.
        { x:  1.6, y: 2.7, z:  0.5 },
        { x: -1.6, y: 2.7, z:  0.5 },
        { x:  0.0, y: 4.1, z:  0.4 },
        { x:  1.4, y: 1.0, z: -1.5 },
        { x: -1.4, y: 1.0, z: -1.5 },
        { x:  0.0, y: 1.8, z: -1.6 },
      ];
      for (const p of patchPositions) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 6), _flameMat.clone());
        m.material.color.setHex(0xff4020);
        m.material.opacity = 0;
        m.position.set(p.x, p.y, p.z);
        m.scale.set(1, 1.4, 1);          // taller-than-wide reads as flame
        m.frustumCulled = false;
        this.boss.add(m);
        this._firePatchPool.push({ mesh: m, basePhase: Math.random() * Math.PI * 2 });
      }
    }
    if (!this._emberPool) {
      this._emberPool = [];
      const emberMat = new THREE.MeshBasicMaterial({
        color: 0xffa040, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      for (let i = 0; i < 16; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), emberMat.clone());
        m.visible = false;
        m.frustumCulled = false;
        this.boss.add(m);
        this._emberPool.push({ mesh: m, t: 0, life: 0.8, inUse: false, vy: 0 });
      }
    }
    this._emberEmitT = 0;
    this._emberEmitInterval = 0.12;
    this._fireEnabled = true;
    if (this.eye) this.eye.material.color.setHex(0xffe080);
  }

  _emitSmokePuff() {
    if (!this._smokePuffPool) return;
    let slot = null;
    for (const s of this._smokePuffPool) { if (!s.inUse) { slot = s; break; } }
    if (!slot) return;
    slot.inUse = true;
    slot.t = 0;
    slot.life = 1.0 + Math.random() * 0.6;
    // Spawn at a random chassis point — shoulders / head / mid-torso.
    const px = (Math.random() - 0.5) * 2.6;
    const py = 1.8 + Math.random() * 2.6;
    const pz = (Math.random() - 0.5) * 1.6;
    slot.mesh.position.set(px, py, pz);
    slot.mesh.scale.setScalar(0.6 + Math.random() * 0.4);
    slot.mesh.material.opacity = 0.55;
    slot.mesh.visible = true;
    slot.driftX = (Math.random() - 0.5) * 0.4;
    slot.driftZ = (Math.random() - 0.5) * 0.4;
  }

  _emitEmber() {
    if (!this._emberPool) return;
    let slot = null;
    for (const s of this._emberPool) { if (!s.inUse) { slot = s; break; } }
    if (!slot) return;
    slot.inUse = true;
    slot.t = 0;
    slot.life = 0.7 + Math.random() * 0.4;
    slot.vy = 0.8 + Math.random() * 0.7;
    const px = (Math.random() - 0.5) * 2.6;
    const py = 1.8 + Math.random() * 2.4;
    const pz = (Math.random() - 0.5) * 1.6;
    slot.mesh.position.set(px, py, pz);
    slot.mesh.material.opacity = 0.95;
    slot.mesh.visible = true;
    slot.driftX = (Math.random() - 0.5) * 0.6;
    slot.driftZ = (Math.random() - 0.5) * 0.6;
  }

  _tickPhaseEffects(dt) {
    // Phase 2 smoke — emit + tick rising particles.
    if (this._smokeEnabled && this._smokePuffPool) {
      this._smokeEmitT += dt;
      while (this._smokeEmitT >= this._smokeEmitInterval) {
        this._smokeEmitT -= this._smokeEmitInterval;
        this._emitSmokePuff();
      }
      for (const s of this._smokePuffPool) {
        if (!s.inUse) continue;
        s.t += dt;
        const k = s.t / s.life;
        s.mesh.position.x += (s.driftX || 0) * dt;
        s.mesh.position.z += (s.driftZ || 0) * dt;
        s.mesh.position.y += (1.4 - k * 0.6) * dt;
        s.mesh.scale.setScalar((0.6 + k * 1.0));
        s.mesh.material.opacity = 0.55 * (1 - k);
        if (s.t >= s.life) {
          s.inUse = false;
          s.mesh.visible = false;
        }
      }
    }
    // Phase 3 fire patches — pulse opacity + scale at random phases.
    if (this._fireEnabled && this._firePatchPool) {
      for (const f of this._firePatchPool) {
        const pulse = 0.6 + 0.4 * Math.abs(Math.sin(this._t * 6 + f.basePhase));
        f.mesh.material.opacity = 0.85 * pulse;
        const sc = 0.85 + 0.25 * Math.sin(this._t * 4 + f.basePhase);
        f.mesh.scale.set(sc, sc * 1.4, sc);
      }
    }
    // Phase 3 embers — emit + tick rising sparks.
    if (this._fireEnabled && this._emberPool) {
      this._emberEmitT += dt;
      while (this._emberEmitT >= this._emberEmitInterval) {
        this._emberEmitT -= this._emberEmitInterval;
        this._emitEmber();
      }
      for (const s of this._emberPool) {
        if (!s.inUse) continue;
        s.t += dt;
        const k = s.t / s.life;
        s.mesh.position.x += (s.driftX || 0) * dt;
        s.mesh.position.z += (s.driftZ || 0) * dt;
        s.mesh.position.y += s.vy * dt;
        s.vy = (s.vy || 0) - 1.2 * dt;        // slight gravity for arc
        s.mesh.material.opacity = 0.95 * (1 - k);
        if (s.t >= s.life) {
          s.inUse = false;
          s.mesh.visible = false;
        }
      }
    }
  }

  // ----- Per-frame --------------------------------------------------
  update(dt, playerPos) {
    if (!this.alive && this.state !== 'dead') return;
    this._t += dt;

    // Dormant ritual — boss is inert, invulnerable, no facing/body damage.
    // Update the eye-flash sequence and short-circuit before attack FSM.
    if (this.state === 'dormant') {
      this.stateT += dt;
      this._tickDormant(dt);
      this._renderBar();
      return;
    }

    if (this.alive) {
      this._faceToward(playerPos, dt);
      this._tickBodyDamage(dt, playerPos);
    }
    this._tickPhaseEffects(dt);

    this.stateT += dt;

    if (this.phaseTransitioning) {
      this.phaseTransitionT += dt;
      if (this.phaseTransitionT >= this.phaseTransitionUntil) {
        this.phaseTransitioning = false;
        this.invuln = false;
        this.state = 'recover';
        this.stateT = 0;
        this.stateUntil = 0.4;
      }
    } else {
      switch (this.state) {
        case 'idle':
          if (this.stateT >= this.stateUntil) this._pickAttack(playerPos);
          break;
        case 'telegraph':
          this._tickTelegraph(dt, playerPos);
          if (this.stateT >= this.stateUntil) this._beginAttackBody(playerPos);
          break;
        case 'attack':
          this._tickAttackBody(dt, playerPos);
          if (this.stateT >= this.stateUntil) this._endAttack();
          break;
        case 'recover':
          if (this.stateT >= this.stateUntil) {
            this.state = 'idle';
            this.stateT = 0;
            // Idle gap halved per playtest: (0.5*freq + 0.2) →
            // (0.25*freq + 0.1). Combined with the shorter recover
            // duration set in _endAttack, total downtime between
            // attacks drops ~40%.
            this.stateUntil = 0.25 * this.freqScale + 0.1;
            // Occasional idle bark.
            if (Math.random() < 0.35 && this._t - this._lastBarkT > 4.0) {
              this._bark(pickBark());
            }
          }
          break;
      }
    }

    this._tickHazards(dt, playerPos);
    this._renderBar();
  }

  _tickBodyDamage(dt, playerPos) {
    const dx = playerPos.x - this.boss.position.x;
    const dz = playerPos.z - this.boss.position.z;
    const d = Math.hypot(dx, dz);
    if (d > _BOSS_RADIUS + 0.7) return;
    if (this._t - this._lastBodyHitT < _HIT_GRACE_SEC) return;
    this._lastBodyHitT = this._t;
    this.ctx.damagePlayer(this.dmg.bodyCrush, 'megaboss', { source: this, zone: 'torso', distance: d });
    if (this.ctx.sfx?.hit) this.ctx.sfx.hit();
    const push = 1.6;
    if (this.ctx.knockbackPlayer && d > 0.0001) {
      this.ctx.knockbackPlayer((dx / d) * push, (dz / d) * push);
    }
  }

  _faceToward(playerPos, dt) {
    if (this.state === 'attack' && this.currentAttack === 'charge') return;     // charge locks heading
    const dx = playerPos.x - this.boss.position.x;
    const dz = playerPos.z - this.boss.position.z;
    const target = Math.atan2(dx, dz);
    let cur = this.facing;
    let delta = target - cur;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const maxRate = 1.4;
    const step = Math.max(-maxRate * dt, Math.min(maxRate * dt, delta));
    cur += step;
    this.facing = cur;
    this.boss.rotation.y = cur;
  }

  // ----- Attack picker (phase-aware) -------------------------------
  _pickAttack(playerPos) {
    const dx = playerPos.x - this.boss.position.x;
    const dz = playerPos.z - this.boss.position.z;
    const d = Math.hypot(dx, dz);
    const choices = [];
    // Phase 1+: base attacks always available. The 180° sweep is
    // intentionally untelegraphed — bullets just start flying. The
    // telegraph wedge that used to cone the floor was removed per
    // playtest; the sweep itself reads on the bullets in flight.
    choices.push({ id: 'sweep', w: 1.0 });
    choices.push({ id: 'grenade', w: 0.85 });
    choices.push({ id: 'cover_artillery', w: 0.7 });
    if (d < 9) choices.push({ id: 'slam', w: 1.3 });
    // Phase 2+: charge + ground-fire.
    if (this.phase >= 2) {
      if (d > 6) choices.push({ id: 'charge', w: 1.4 });
      choices.push({ id: 'ground_fire', w: 1.1 });
    }
    // Phase 3: gas barrage.
    if (this.phase >= 3) {
      choices.push({ id: 'gas', w: 1.2 });
      // Stack base attacks heavier — phase 3 is the panic dance.
      choices.push({ id: 'grenade', w: 0.6 });
    }
    let total = 0;
    for (const c of choices) total += c.w;
    let pick = Math.random() * total;
    let chosen = choices[0].id;
    for (const c of choices) { pick -= c.w; if (pick <= 0) { chosen = c.id; break; } }
    this.currentAttack = chosen;
    this._beginTelegraph(chosen);
  }

  // ----- Telegraphs ------------------------------------------------
  _beginTelegraph(attackId) {
    this.state = 'telegraph';
    this.stateT = 0;
    // Sweep: telegraph window is intentionally tiny (no wedge built).
    // The bullets themselves are the warning — player learns to read
    // the spawn cluster + curve out of the way.
    if (attackId === 'sweep')             this.stateUntil = 0.10;
    else if (attackId === 'cover_artillery') this.stateUntil = 0.8 * this.freqScale + 0.3;
    else if (attackId === 'slam')         this.stateUntil = 1.2 * this.freqScale + 0.5;
    else if (attackId === 'grenade')      this.stateUntil = 0.6 * this.freqScale + 0.3;
    else if (attackId === 'charge')       this.stateUntil = 1.4 * this.freqScale + 0.5;
    else if (attackId === 'ground_fire')  this.stateUntil = 0.8 * this.freqScale + 0.3;
    else if (attackId === 'gas')          this.stateUntil = 0.7 * this.freqScale + 0.3;
    if (attackId === 'cover_artillery')   this._beginCoverPose();
    if (attackId === 'slam')              this._buildSlamTelegraph();
    if (attackId === 'charge')            this._buildChargeTelegraph();
  }

  _buildSlamTelegraph() {
    // Big chunky red zone, 4m wide × 9m long — must be unmissable.
    const geom = new THREE.PlaneGeometry(4.0, 9.0);
    const mat = _telegraphMat.clone();
    mat.opacity = 0;
    const m = new THREE.Mesh(geom, mat);
    m.rotation.x = -Math.PI / 2;
    const f = Math.sin(this.facing), z = Math.cos(this.facing);
    m.position.set(
      this.boss.position.x + f * 5.5, 0.05,
      this.boss.position.z + z * 5.5,
    );
    m.rotation.z = this.facing;
    this.scene.add(m);
    this._slamTelegraphMesh = m;
    this._bark('CRUSHING PROCEDURE INITIATED.');
  }

  _buildChargeTelegraph() {
    // Thick red corridor from boss to the player's CURRENT position
    // (snapshotted at telegraph start). Boss commits to that line —
    // player can dodge perpendicular.
    const px = this.ctx.getPlayerPos?.()?.x ?? this.boss.position.x;
    const pz = this.ctx.getPlayerPos?.()?.z ?? (this.boss.position.z + 8);
    const dx = px - this.boss.position.x;
    const dz = pz - this.boss.position.z;
    const dist = Math.max(4, Math.hypot(dx, dz) + 4);
    const ang = Math.atan2(dx, dz);
    this._chargeTargetAng = ang;
    this._chargeDistance = dist;
    const geom = new THREE.PlaneGeometry(2.6, dist);
    const mat = _telegraphMat.clone();
    mat.opacity = 0;
    const m = new THREE.Mesh(geom, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(
      this.boss.position.x + Math.sin(ang) * (dist * 0.5),
      0.05,
      this.boss.position.z + Math.cos(ang) * (dist * 0.5),
    );
    m.rotation.z = ang;
    this.scene.add(m);
    this._chargeTelegraphMesh = m;
    this._bark('PURSUIT MODE ENGAGED.');
  }

  _beginCoverPose() {
    this.invuln = true;
    if (this.shield) this.shield.material.opacity = 0;
  }

  _tickTelegraph(dt, playerPos) {
    const k = Math.min(1, this.stateT / this.stateUntil);
    if (this.currentAttack === 'slam' && this._slamTelegraphMesh) {
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(this.stateT * 10));
      this._slamTelegraphMesh.material.opacity = k * pulse;
      this._slamTelegraphMesh.rotation.z = this.facing;
      const f = Math.sin(this.facing), z = Math.cos(this.facing);
      this._slamTelegraphMesh.position.set(
        this.boss.position.x + f * 5.5, 0.05,
        this.boss.position.z + z * 5.5,
      );
    }
    if (this.currentAttack === 'charge' && this._chargeTelegraphMesh) {
      const pulse = 0.5 + 0.4 * Math.abs(Math.sin(this.stateT * 12));
      this._chargeTelegraphMesh.material.opacity = k * pulse;
      // Don't update — charge commits to the snapshotted line.
    }
    if (this.currentAttack === 'cover_artillery' && this.shield) {
      this.shield.material.opacity = k * 0.55;
    }
  }

  // ----- Attack bodies ---------------------------------------------
  _beginAttackBody(playerPos) {
    this.state = 'attack';
    this.stateT = 0;
    if (this.currentAttack === 'sweep') {
      this.stateUntil = 2.6 * this.freqScale + 1.0;
      this._sweepAngle = -Math.PI / 2;
      this._sweepTickT = 0;
    } else if (this.currentAttack === 'cover_artillery') {
      this.stateUntil = 4.2 * this.freqScale + 1.0;
      this._artilleryTickT = 0;
    } else if (this.currentAttack === 'slam') {
      this.stateUntil = 0.45;
      this._slamFired = false;
    } else if (this.currentAttack === 'grenade') {
      this.stateUntil = 1.6 * this.freqScale + 0.5;
      this._grenadeTickT = 0;
      this._grenadesLaunched = 0;
      this._grenadeBudget = (this.phase === 1 ? 8 : this.phase === 2 ? 11 : 14);
    } else if (this.currentAttack === 'charge') {
      // Bumped per playtest — 0.75s × 18 m/s was reading as a slow
      // shuffle. Now 1.1s × 28 m/s = 31m of travel, easily across the
      // arena. Boss commits to the locked angle the whole time.
      this.stateUntil = 1.1;
      this._chargeT = 0;
      this._chargeHit = false;
    } else if (this.currentAttack === 'ground_fire') {
      this.stateUntil = 1.6 * this.freqScale + 0.4;
      this._fireSpawnTickT = 0;
      this._firesSpawned = 0;
      this._fireBudget = this.phase === 2 ? 5 : 7;
    } else if (this.currentAttack === 'gas') {
      this.stateUntil = 1.4 * this.freqScale + 0.5;
      this._gasSpawnTickT = 0;
      this._gasLaunched = 0;
      this._gasBudget = 4;
    }
  }

  _tickAttackBody(dt, playerPos) {
    if (this.currentAttack === 'sweep') this._tickSweep(dt);
    else if (this.currentAttack === 'cover_artillery') this._tickArtillery(dt, playerPos);
    else if (this.currentAttack === 'slam') this._tickSlam(dt, playerPos);
    else if (this.currentAttack === 'grenade') this._tickGrenade(dt, playerPos);
    else if (this.currentAttack === 'charge') this._tickCharge(dt, playerPos);
    else if (this.currentAttack === 'ground_fire') this._tickGroundFire(dt, playerPos);
    else if (this.currentAttack === 'gas') this._tickGas(dt, playerPos);
  }

  _tickSweep(dt) {
    const totalAngle = Math.PI;
    const sweepDur = this.stateUntil;
    this._sweepAngle = -Math.PI / 2 + (this.stateT / sweepDur) * totalAngle;
    const interval = Math.max(0.045, 0.075 * this.freqScale);
    this._sweepTickT += dt;
    while (this._sweepTickT >= interval) {
      this._sweepTickT -= interval;
      this._fireSweepBullet();
    }
  }

  _fireSweepBullet() {
    const ang = this.facing + this._sweepAngle;
    const jitter = (Math.random() - 0.5) * 0.05 * this.spreadScale;
    const dirX = Math.sin(ang + jitter);
    const dirZ = Math.cos(ang + jitter);
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), _bulletMat);
    m.position.set(
      this.boss.position.x + dirX * 2.5, 1.6,
      this.boss.position.z + dirZ * 2.5,
    );
    this.scene.add(m);
    this.bullets.push({
      mesh: m, vx: dirX * 11, vz: dirZ * 11,
      life: 1.7, t: 0, dmg: this.dmg.sweepBullet,
    });
    if (this.ctx.sfx?.enemyFire) this.ctx.sfx.enemyFire('pistol', 0);
  }

  _tickArtillery(dt, playerPos) {
    const interval = Math.max(0.32, 0.6 * this.freqScale);
    this._artilleryTickT += dt;
    while (this._artilleryTickT >= interval) {
      this._artilleryTickT -= interval;
      this._dropArtilleryAt(playerPos.x, playerPos.z);
    }
  }

  _dropArtilleryAt(x, z) {
    const radius = 3.0;
    const ringGeom = new THREE.RingGeometry(radius - 0.15, radius, 28);
    const ringMat = _telegraphMat.clone();
    ringMat.opacity = 0.7;
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.05, z);
    this.scene.add(ring);
    this.shells.push({
      ringMesh: ring, ringMat,
      x, z, radius,
      dmg: this.dmg.artillery,
      t: 0, life: 1.2,
    });
  }

  _tickSlam(dt, playerPos) {
    if (!this._slamFired) {
      this._slamFired = true;
      const f = Math.sin(this.facing), z = Math.cos(this.facing);
      const cx = this.boss.position.x + f * 5.5;
      const cz = this.boss.position.z + z * 5.5;
      const ldx = playerPos.x - cx;
      const ldz = playerPos.z - cz;
      const lx = ldx * z - ldz * f;
      const ly = ldx * f + ldz * z;
      const inside = Math.abs(lx) < 2.0 && Math.abs(ly) < 4.5;
      if (inside) {
        this.ctx.damagePlayer(this.dmg.slam, 'megaboss',
          { source: this, zone: 'torso', distance: Math.hypot(ldx, ldz) });
        if (this.ctx.knockbackPlayer) this.ctx.knockbackPlayer(f * 4, z * 4);
      }
      if (this._slamTelegraphMesh) this._slamTelegraphMesh.material.opacity = 1.0;
      if (this.ctx.sfx?.explode) this.ctx.sfx.explode();
      if (this.ctx.shake) this.ctx.shake(0.65, 0.3);
    }
  }

  _tickGrenade(dt, playerPos) {
    if (this._grenadesLaunched >= this._grenadeBudget) return;
    const interval = (this.stateUntil * 0.85) / this._grenadeBudget;
    this._grenadeTickT += dt;
    while (this._grenadeTickT >= interval && this._grenadesLaunched < this._grenadeBudget) {
      this._grenadeTickT -= interval;
      this._launchGrenade(playerPos, false);
      this._grenadesLaunched += 1;
    }
  }

  _tickCharge(dt, playerPos) {
    // Boss rushes along the locked angle. Damage applies to the player
    // ONCE if they're inside the corridor at the moment of pass.
    const speed = 28;            // m/s — fast, hard to outrun perpendicular
    const ang = this._chargeTargetAng;
    const moveX = Math.sin(ang) * speed * dt;
    const moveZ = Math.cos(ang) * speed * dt;
    this.boss.position.x += moveX;
    this.boss.position.z += moveZ;
    this._chargeT += dt;
    // Snap charge corridor to the moving boss for visual clarity.
    if (this._chargeTelegraphMesh) {
      this._chargeTelegraphMesh.material.opacity = 0.6;
    }
    // Damage check — player inside the corridor (close to charge line).
    if (!this._chargeHit) {
      const dx = playerPos.x - this.boss.position.x;
      const dz = playerPos.z - this.boss.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.4) {
        this._chargeHit = true;
        this.ctx.damagePlayer(this.dmg.charge, 'megaboss',
          { source: this, zone: 'torso', distance: d });
        if (this.ctx.knockbackPlayer && d > 0.0001) {
          this.ctx.knockbackPlayer((dx / d) * 5, (dz / d) * 5);
        }
        if (this.ctx.shake) this.ctx.shake(0.7, 0.25);
      }
    }
    // Stop short if we'd leave the arena. Matches the 30×30m mega-arena
    // (HALF=15 in level.js) minus chassis-radius buffer so the boss body
    // never intersects the perimeter wall.
    const arenaR = _Tarena().bossClampRadius;
    if (Math.abs(this.boss.position.x) > arenaR || Math.abs(this.boss.position.z) > arenaR) {
      this.boss.position.x = Math.max(-arenaR, Math.min(arenaR, this.boss.position.x));
      this.boss.position.z = Math.max(-arenaR, Math.min(arenaR, this.boss.position.z));
      this.stateT = this.stateUntil;
    }
  }

  _tickGroundFire(dt, playerPos) {
    if (this._firesSpawned >= this._fireBudget) return;
    const interval = (this.stateUntil * 0.85) / this._fireBudget;
    this._fireSpawnTickT += dt;
    while (this._fireSpawnTickT >= interval && this._firesSpawned < this._fireBudget) {
      this._fireSpawnTickT -= interval;
      // Drop fire pools at random offsets near the player — cuts off
      // their movement options.
      const ang = Math.random() * Math.PI * 2;
      const dist = 2 + Math.random() * 6;
      const x = playerPos.x + Math.cos(ang) * dist;
      const z = playerPos.z + Math.sin(ang) * dist;
      this._spawnFirePool(x, z);
      this._firesSpawned += 1;
    }
  }

  _spawnFirePool(x, z) {
    const radius = 2.0 + Math.random() * 0.6;
    const geom = new THREE.CircleGeometry(radius, 18);
    const mat = _firePoolMat.clone();
    const m = new THREE.Mesh(geom, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.04, z);
    this.scene.add(m);
    this.firePools.push({
      mesh: m, mat,
      x, z, radius,
      life: 5.5,
      t: 0,
      dmg: this.dmg.groundFire,
      lastTick: 0,
    });
  }

  _tickGas(dt, playerPos) {
    if (this._gasLaunched >= this._gasBudget) return;
    const interval = (this.stateUntil * 0.85) / this._gasBudget;
    this._gasSpawnTickT += dt;
    while (this._gasSpawnTickT >= interval && this._gasLaunched < this._gasBudget) {
      this._gasSpawnTickT -= interval;
      this._launchGrenade(playerPos, true);     // gas variant
      this._gasLaunched += 1;
    }
  }

  _launchGrenade(playerPos, isGas = false) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 6),
      isGas ? _gasGrenadeMat : _grenadeMat,
    );
    const ox = this.boss.position.x;
    const oz = this.boss.position.z;
    m.position.set(ox - 1.2, 3.4, oz);
    const aimX = playerPos.x + (Math.random() - 0.5) * 12;
    const aimZ = playerPos.z + (Math.random() - 0.5) * 12;
    const flightTime = 0.9 + Math.random() * 0.4;
    const dx = aimX - m.position.x;
    const dz = aimZ - m.position.z;
    const vy = (0.5 - m.position.y) / flightTime + 0.5 * 9.8 * flightTime;
    const fuse = isGas ? 0.4 : (0.8 + Math.random() * 1.7);
    const fuseMesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), _grenadeFuseMat);
    fuseMesh.position.y = 0.18;
    m.add(fuseMesh);
    this.scene.add(m);
    const list = isGas ? this.gasGrenades : this.grenades;
    list.push({
      mesh: m, fuseMesh,
      vx: dx / flightTime,
      vy,
      vz: dz / flightTime,
      t: 0,
      fuseTime: fuse,
      flightTime,
      landed: false,
      isGas,
      dmg: isGas ? this.dmg.gas : this.dmg.grenade,
      radius: isGas ? 4.0 : 2.5,
    });
  }

  _endAttack() {
    if (this._slamTelegraphMesh) {
      this.scene.remove(this._slamTelegraphMesh);
      this._slamTelegraphMesh.geometry.dispose();
      this._slamTelegraphMesh.material.dispose();
      this._slamTelegraphMesh = null;
    }
    if (this._chargeTelegraphMesh) {
      this.scene.remove(this._chargeTelegraphMesh);
      this._chargeTelegraphMesh.geometry.dispose();
      this._chargeTelegraphMesh.material.dispose();
      this._chargeTelegraphMesh = null;
    }
    if (this.currentAttack === 'cover_artillery') {
      this.invuln = false;
      if (this.shield) this.shield.material.opacity = 0;
    }
    this.state = 'recover';
    this.stateT = 0;
    // Recover phase shortened per playtest: (0.55*freq + 0.2) →
    // (0.30*freq + 0.1). Pairs with the idle-gap trim above.
    this.stateUntil = 0.30 * this.freqScale + 0.1;
    this.currentAttack = null;
  }

  // ----- Hazard tick (bullets, shells, grenades, fire, gas) --------
  _tickHazards(dt, playerPos) {
    // Sweep bullets — straight-line travel + radius hit on player.
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.t += dt;
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.z += b.vz * dt;
      const ddx = b.mesh.position.x - playerPos.x;
      const ddz = b.mesh.position.z - playerPos.z;
      const hit = (ddx * ddx + ddz * ddz) < 0.55 * 0.55;
      if (hit && !this.ctx.playerHasIFrames?.()) {
        this.ctx.damagePlayer(b.dmg, 'megaboss', { source: this, zone: 'torso', distance: 0 });
        b.t = b.life;
      }
      if (b.t >= b.life) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        this.bullets.splice(i, 1);
      }
    }
    // Artillery shells
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t += dt;
      const k = s.t / s.life;
      const pulse = 0.4 + 0.5 * Math.abs(Math.sin(s.t * (8 + 4 * k)));
      s.ringMat.opacity = (0.5 + 0.5 * k) * pulse;
      if (s.t >= s.life) {
        if (this.ctx.combat?.spawnExplosion) {
          this.ctx.combat.spawnExplosion(new THREE.Vector3(s.x, 0.4, s.z), s.radius);
        }
        const ddx = playerPos.x - s.x;
        const ddz = playerPos.z - s.z;
        if ((ddx * ddx + ddz * ddz) < s.radius * s.radius) {
          this.ctx.damagePlayer(s.dmg, 'megaboss',
            { source: this, zone: 'torso', distance: Math.sqrt(ddx * ddx + ddz * ddz) });
        }
        if (this.ctx.shake) this.ctx.shake(0.45, 0.22);
        if (this.ctx.sfx?.explode) this.ctx.sfx.explode();
        this.scene.remove(s.ringMesh);
        s.ringMesh.geometry.dispose();
        s.ringMat.dispose();
        this.shells.splice(i, 1);
      }
    }
    // Frag grenades
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      this._tickGrenadeOne(g, dt, playerPos);
      if (g._dead) { this.grenades.splice(i, 1); }
    }
    // Gas grenades — same physics, but the explosion is a lingering cloud
    for (let i = this.gasGrenades.length - 1; i >= 0; i--) {
      const g = this.gasGrenades[i];
      this._tickGrenadeOne(g, dt, playerPos);
      if (g._dead) { this.gasGrenades.splice(i, 1); }
    }
    // Ground fire pools — DoT to player while standing in.
    for (let i = this.firePools.length - 1; i >= 0; i--) {
      const f = this.firePools[i];
      f.t += dt;
      const k = f.t / f.life;
      // Pulse + fade-in start, hard fade at end.
      const pulse = 0.45 + 0.4 * Math.abs(Math.sin(f.t * 6));
      const baseOp = k < 0.15 ? (k / 0.15) : (k > 0.85 ? (1 - k) / 0.15 : 1);
      f.mat.opacity = baseOp * pulse * 0.65;
      const ddx = playerPos.x - f.x;
      const ddz = playerPos.z - f.z;
      if ((ddx * ddx + ddz * ddz) < f.radius * f.radius) {
        // Tick damage every 0.33s while in the pool.
        if (f.t - f.lastTick > 0.33) {
          f.lastTick = f.t;
          this.ctx.damagePlayer(f.dmg, 'fire',
            { source: this, zone: 'torso', distance: Math.sqrt(ddx * ddx + ddz * ddz) });
        }
      }
      if (f.t >= f.life) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        f.mat.dispose();
        this.firePools.splice(i, 1);
      }
    }
    // Gas clouds — DoT + slow-fade.
    for (let i = this.gasClouds.length - 1; i >= 0; i--) {
      const c = this.gasClouds[i];
      c.t += dt;
      const k = c.t / c.life;
      const baseOp = k < 0.1 ? (k / 0.1) : (k > 0.85 ? (1 - k) / 0.15 : 1);
      c.mat.opacity = baseOp * 0.45;
      // Cloud expands a bit as it dissipates.
      const sc = 1 + k * 0.25;
      c.mesh.scale.setScalar(sc);
      const ddx = playerPos.x - c.x;
      const ddz = playerPos.z - c.z;
      if ((ddx * ddx + ddz * ddz) < (c.radius * sc) * (c.radius * sc)) {
        if (c.t - c.lastTick > 0.4) {
          c.lastTick = c.t;
          this.ctx.damagePlayer(c.dmg, 'gas',
            { source: this, zone: 'torso', distance: Math.sqrt(ddx * ddx + ddz * ddz) });
        }
      }
      if (c.t >= c.life) {
        this.scene.remove(c.mesh);
        c.mesh.geometry.dispose();
        c.mat.dispose();
        this.gasClouds.splice(i, 1);
      }
    }
  }

  _tickGrenadeOne(g, dt, playerPos) {
    g.t += dt;
    if (!g.landed) {
      g.vy -= 9.8 * dt;
      g.mesh.position.x += g.vx * dt;
      g.mesh.position.z += g.vz * dt;
      g.mesh.position.y += g.vy * dt;
      g.mesh.rotation.x += dt * 6;
      g.mesh.rotation.z += dt * 4;
      if (g.mesh.position.y <= 0.18) {
        g.mesh.position.y = 0.18;
        g.landed = true;
        g.vx *= 0.3; g.vz *= 0.3; g.vy = 0;
      }
    } else {
      const remaining = Math.max(0, g.fuseTime - (g.t - g.flightTime));
      const pulseRate = 6 + (1 - Math.min(1, remaining / g.fuseTime)) * 18;
      g.fuseMesh.material.color.setRGB(
        1, 0.2 + 0.3 * Math.abs(Math.sin(g.t * pulseRate)), 0.2,
      );
      if (g.t >= g.flightTime + g.fuseTime) {
        if (g.isGas) {
          // Spawn a gas cloud at this position instead of an explosion.
          const cloudGeom = new THREE.CircleGeometry(g.radius, 22);
          const cloudMat = _gasCloudMat.clone();
          const c = new THREE.Mesh(cloudGeom, cloudMat);
          c.rotation.x = -Math.PI / 2;
          c.position.set(g.mesh.position.x, 0.05, g.mesh.position.z);
          this.scene.add(c);
          this.gasClouds.push({
            mesh: c, mat: cloudMat,
            x: g.mesh.position.x, z: g.mesh.position.z,
            radius: g.radius,
            life: 6.5, t: 0, lastTick: 0,
            dmg: g.dmg,
          });
        } else {
          if (this.ctx.combat?.spawnExplosion) {
            this.ctx.combat.spawnExplosion(g.mesh.position.clone(), g.radius);
          }
          const ddx = playerPos.x - g.mesh.position.x;
          const ddz = playerPos.z - g.mesh.position.z;
          if ((ddx * ddx + ddz * ddz) < g.radius * g.radius) {
            this.ctx.damagePlayer(g.dmg, 'megaboss',
              { source: this, zone: 'torso', distance: Math.sqrt(ddx * ddx + ddz * ddz) });
          }
          if (this.ctx.shake) this.ctx.shake(0.35, 0.18);
        }
        if (this.ctx.sfx?.explode) this.ctx.sfx.explode();
        this.scene.remove(g.mesh);
        g.mesh.geometry.dispose();
        g._dead = true;
      }
    }
  }

  // ----- Bark popup -------------------------------------------------
  _bark(text) {
    if (!this.head) return;
    this._lastBarkT = this._t;
    const wp = new THREE.Vector3();
    this.head.getWorldPosition(wp);
    if (this.ctx.camera) spawnSpeechBubble(wp, this.ctx.camera, text, _BARK_LIFE);
  }

  // ----- Death + loot ----------------------------------------------
  _die() {
    this.alive = false;
    this.state = 'dead';
    bumpEncounterCount();
    this._cleanupHazards();
    if (this.eye) this.eye.material.color.setHex(0x303030);
    if (this.boss) {
      // Sink + tilt the corpse harder so it doesn't sit upright over
      // the loot drop. Was -0.4y / 0.25 rad — looked like the boss
      // was just bowing slightly. Now -1.6y / 0.55 rad reads as a
      // collapsed wreck. Combined with the wider loot drop radius
      // below, the items land in clear space outside the chassis.
      this.boss.rotation.x = 0.55;
      this.boss.position.y -= 1.6;
    }
    this._bark('REGRET. NOT INSTALLED. SHUTTING DOWN.');
    if (this.ctx.sfx?.execute) this.ctx.sfx.execute();
    if (this.ctx.shake) this.ctx.shake(1.0, 0.6);
    if (this.ctx.combat?.spawnExplosion) {
      this.ctx.combat.spawnExplosion(this.boss.position.clone().add(new THREE.Vector3(0, 2, 0)), 5);
    }
    this._dropLoot();
    this._hideBar();
    if (this.ctx.onMegaBossDead) this.ctx.onMegaBossDead(this);
  }

  _cleanupHazards() {
    for (const b of this.bullets) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); }
    for (const s of this.shells)  { this.scene.remove(s.ringMesh); s.ringMesh.geometry.dispose(); s.ringMat.dispose(); }
    for (const g of this.grenades){ this.scene.remove(g.mesh); g.mesh.geometry.dispose(); }
    for (const g of this.gasGrenades){ this.scene.remove(g.mesh); g.mesh.geometry.dispose(); }
    for (const f of this.firePools){ this.scene.remove(f.mesh); f.mesh.geometry.dispose(); f.mat.dispose(); }
    for (const c of this.gasClouds){ this.scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mat.dispose(); }
    this.bullets.length = 0;
    this.shells.length = 0;
    this.grenades.length = 0;
    this.gasGrenades.length = 0;
    this.firePools.length = 0;
    this.gasClouds.length = 0;
  }

  _dropLoot() {
    if (!this.ctx.loot || !this.ctx.lootRolls) return;
    // Boss center, but use the PRE-death position (we just shifted it
    // -1.6y for the corpse tilt). Drops should land on the floor at
    // boss xz, not under the sunken wreck.
    const cx = this.boss.position.x;
    const cz = this.boss.position.z;
    const items = this.ctx.lootRolls(this.encounterIndex);
    // Wider ring — boss chassis is 4×5m. Drops at 1.5-2.7m landed
    // INSIDE the body geometry; player couldn't see / pick them up.
    // tunables.megabossArboter.lootDropRadius* puts everything in clear
    // floor space, then clamped to megaboss.arenaInner so an edge-of-
    // arena death doesn't fling drops behind a wall.
    const T = _T();
    const inner = _Tarena().arenaInner;
    let i = 0;
    for (const item of items) {
      const ang = (i / items.length) * Math.PI * 2 + Math.random() * T.lootDropAngleJitter;
      const r = T.lootDropRadiusBase + Math.random() * T.lootDropRadiusJitter;
      let lx = cx + Math.cos(ang) * r;
      let lz = cz + Math.sin(ang) * r;
      lx = Math.max(-inner, Math.min(inner, lx));
      lz = Math.max(-inner, Math.min(inner, lz));
      this.ctx.loot.spawnItem({ x: lx, y: T.lootDropY, z: lz }, item);
      i += 1;
    }
  }

  // ----- Boss bar UI -----------------------------------------------
  _buildBossBar() {
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'fixed', top: '40px', left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 46, pointerEvents: 'none',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      letterSpacing: '3px', textAlign: 'center', display: 'none',
    });
    const name = document.createElement('div');
    Object.assign(name.style, {
      color: '#ff4040', fontSize: '13px', fontWeight: '700',
      textShadow: '0 0 8px rgba(0,0,0,0.95)',
      marginBottom: '4px',
    });
    name.textContent = this.encounterIndex > 0
      ? `THE ARBOTER — MK ${this.encounterIndex + 1}`
      : 'THE ARBOTER';
    const fill = document.createElement('div');
    Object.assign(fill.style, {
      width: '0%', height: '100%',
      background: 'linear-gradient(90deg, #4a0808, #ff2030, #ffa040)',
      transition: 'width 0.15s',
    });
    const track = document.createElement('div');
    Object.assign(track.style, {
      width: '640px', height: '24px',
      background: 'rgba(20,4,4,0.92)',
      border: '2px solid rgba(255,80,80,0.7)',
      borderRadius: '3px', overflow: 'hidden',
      boxShadow: '0 2px 24px rgba(255,40,40,0.4)',
    });
    track.appendChild(fill);
    root.appendChild(name);
    root.appendChild(track);
    document.body.appendChild(root);
    this._barEl = { root, name, fill };
  }
  _showBar() { if (this._barEl) this._barEl.root.style.display = 'block'; }
  _hideBar() { if (this._barEl) this._barEl.root.style.display = 'none'; }
  _renderBar() {
    if (!this._barEl) return;
    const pct = Math.max(0, Math.min(1, this.hp / this.maxHp));
    this._barEl.fill.style.width = `${pct * 100}%`;
    // Phase tint — invuln during transition flashes the bar.
    if (this.phaseTransitioning) {
      const flash = Math.abs(Math.sin(this._t * 18));
      this._barEl.fill.style.opacity = String(0.4 + 0.6 * flash);
    } else {
      this._barEl.fill.style.opacity = '1';
    }
  }

  destroy() {
    this._cleanupHazards();
    if (this.boss) {
      this.scene.remove(this.boss);
      this.boss.traverse(o => {
        if (o.geometry && !o.geometry.userData?.sharedRigGeom) o.geometry.dispose?.();
      });
    }
    if (this._barEl) {
      this._barEl.root.parentNode?.removeChild(this._barEl.root);
    }
  }
}

// --- Loot rolls for boss kill -------------------------------------
export function buildMegaBossLoot(ctx, encounterIndex) {
  const items = [];
  const tierByEncounter = encounterIndex === 0 ? 'rare'
                       : encounterIndex < 3   ? 'epic'
                       : 'legendary';
  for (let i = 0; i < 3; i++) {
    const wantWeapon = Math.random() < 0.6;
    const item = wantWeapon
      ? ctx.randomWeapon?.(tierByEncounter)
      : ctx.randomArmor?.(tierByEncounter);
    if (item) items.push(item);
  }
  for (let i = 0; i < 2; i++) {
    const heal = ctx.pickHealConsumable?.();
    if (heal) items.push(heal);
  }
  const junkCount = 3 + Math.floor(Math.random() * 5);
  for (let i = 0; i < junkCount; i++) {
    const j = ctx.pickJunk?.();
    if (j) items.push(j);
  }
  return items;
}
