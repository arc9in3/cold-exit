// THE JAILER — proximity-mine + chain megaboss.
//
// Stalks the player around the arena dropping armed mines as he goes;
// every dash that passes near one of his own mines triggers a chain
// throw at the player, trying to pull them ONTO the mine. Mid-fight
// grenade barrages and a close-range spin attack round out the kit.
//
// Threat layers:
//   1. PROXIMITY MINES — dropped every ~3s while the Jailer is in
//      DASH state. Arm over 1.5s (pulsing light), then trigger when
//      the player enters their proximity radius (30 dmg + 1.2s stun).
//      Cap of `mineCap` simultaneously-armed mines so the arena
//      doesn't carpet-mine itself.
//   2. CHAIN HOOK — whenever a dash brings the Jailer within
//      `chainTriggerRadius` of an armed mine, he winds up
//      (`chainWindupSec`) and launches a hooked chain at the player's
//      position. On hit, drags the player to the Jailer's feet over
//      `chainPullSec` — likely landing on top of the mine that
//      triggered the throw. Player must dodge laterally to escape.
//   3. GRENADE BARRAGE — on a `grenadeIntervalSec` timer, scatters
//      `grenadeCount` grenades across the arena that detonate after
//      `grenadeFuseSec`. Forces movement away from cover lines.
//   4. SPIN ATTACK — if the Jailer's dash brings him within
//      `spinTriggerRadius` of the player, halts and telegraphs a
//      circular slash (`spinWindupSec`); on resolve, hits everything
//      in `spinAttackRadius` for `spinDamage` + knockback.
//
// Public surface mirrors MegaBoss / MegaBossEcho / MegaBossGeneral:
//   constructor(ctx)   — same ctx shape
//   spawn(pos)         — place at arena center
//   update(dt)         — host-side per-frame
//   tickVisuals(dt)    — joiner-side visual tick (cosmetic only)
//   applyHit(amount)   — bullet damage in
//   hittables()        — raycast targets (chest mesh)
//   alive              — bool
//   destroy()          — cleanup

import * as THREE from 'three';
import { spawnSpeechBubble } from './hud.js';

// Module-level scratch vectors so per-frame hot paths (chain tick,
// hazard scan) don't allocate a fresh THREE.Vector3 every call. Each
// site uses .copy() / .set() on the scratch, then reads.
const _scratchVec3a = new THREE.Vector3();

const _BAR_TINT = '#c84038';

const BARKS_INTRO = [
  'YOU WILL NOT LEAVE THIS ROOM.',
  'EVERY EXIT HAS BEEN CLOSED.',
  'I HAVE BEEN WAITING.',
  'THE SENTENCE IS PERPETUAL.',
];
const BARKS_CHAIN = [
  'COME HERE.',
  'CLOSER.',
  'THE LEASH IS LONG ENOUGH.',
];
const BARKS_GRENADE = [
  'RUN, THEN.',
  'NO ROOM LEFT.',
];
const BARKS_SPIN = [
  'TOO CLOSE.',
];
const BARKS_SEARCH = [
  'STAY WHERE YOU ARE.',
  'I SEE YOU.',
  'NO HIDING.',
];
const BARKS_DIE = [
  'the cell... opens...',
  'finally... I... rest...',
  'go on then... leave...',
];

const T = {
  baseHp:              50000,
  hpScalePerEncounter: 0.35,
  // Dash — top speed + retarget cadence. Jailer paths to a random
  // arena point, drifts there at dashSpeed, picks a new one when he
  // arrives or `dashRetargetSec` elapses.
  dashSpeed:           7.5,
  dashRetargetSec:     2.2,
  dashArriveDist:      1.2,
  // Mine drop cadence + cap.
  mineDropIntervalSec: 3.0,
  mineCap:             6,
  mineArmSec:          1.5,
  mineTriggerRadius:   2.0,
  mineDamage:          30,
  mineStunSec:         1.2,
  mineExplosionRadius: 2.8,    // visual + AoE
  // Chain hook trigger + throw.
  chainTriggerRadius:  3.0,    // dash brushes mine within this → wind up
  chainCooldownSec:    4.0,    // min gap between chain throws
  chainWindupSec:      0.85,
  chainThrowRange:     14,
  chainThrowSpeed:     20,
  chainHitRadius:      0.65,   // XZ distance to player counted as hit
  chainPullSec:        0.55,   // pull duration once hit
  // Spin attack — close-range punishment when the player tries to
  // melee the boss.
  spinTriggerRadius:   3.5,
  spinWindupSec:       0.6,
  spinAttackRadius:    3.6,
  spinDamage:          35,
  spinCooldownSec:     5.5,
  spinKnockbackSpeed:  6.5,
  // Grenade barrage — periodic forced movement.
  grenadeIntervalSec:  11,
  grenadeCount:        5,
  grenadeFuseSec:      1.4,
  grenadeRadius:       2.4,
  grenadeDamage:       22,
  grenadeKnockback:    3.0,
  // Searchlight sweep — plants the Jailer for a few seconds, rotates
  // a wide beam around him. Player must run tangentially (around the
  // boss) faster than the beam rotation to stay clear. Random
  // direction per cast so the player can't pre-commit to one circle.
  searchBeamIntervalSec: 14,
  searchBeamWindupSec:   0.55,    // brief telegraph before the beam fires
  searchBeamDurationSec: 5.0,
  searchBeamLength:      10.5,    // m — reach from boss center
  searchBeamWidth:       2.6,     // m — beam thickness (player ~0.4r)
  searchBeamRotSpeed:    1.55,    // rad/s ≈ 89°/s; full revolution ≈ 4.05s
  searchBeamTickSec:     0.35,    // damage tick interval while standing in the beam
  searchBeamDamage:      16,      // per tick
  // Bark cooldown.
  barkCooldownSec:     2.0,
};

// Arena bounds (level.js generateMegaArena → HALF = 15). Mines,
// grenades, and dash targets clamp to ±innerHalf so nothing lands
// behind the walls.
const ARENA_HALF       = 15;
const ARENA_INNER_HALF = 13;

const STATE = {
  DASH:         'dash',
  WINDUP_CHAIN: 'windup_chain',
  THROW_CHAIN:  'throw_chain',
  PULL_PLAYER:  'pull_player',
  WINDUP_SPIN:  'windup_spin',
  SPIN:         'spin',
  SEARCH_BEAM:  'search_beam',
};

export class MegaBossJailer {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.encounterIndex = (ctx.encounterIndex | 0) || 0;

    const hpScale = 1 + T.hpScalePerEncounter * this.encounterIndex;
    this.maxHp = Math.round(T.baseHp * hpScale);
    this.hp = this.maxHp;
    this.alive = false;

    this.state = STATE.DASH;
    this.stateT = 0;

    // Dash target — point on the arena floor we're walking to.
    this._dashTarget = { x: 0, z: 0 };
    this._dashRetargetT = 0;

    // Mine list. Each: { id, mesh, lightMesh, lightMat, x, z, armT, armed, mat, _coopRemote? }
    // Stable per-mine id counter so the coop snapshot can reconcile
    // remote mirrors across frames (joiner uses id to match a snapshot
    // entry to an existing local mirror).
    this.mines = [];
    this._mineIdCounter = 0;
    this._mineDropT = T.mineDropIntervalSec * 0.5;   // first mine ~mid-cooldown so the player sees one fast

    // Grenade barrage state. Each grenade: { id, mesh, mat, x, z, fuseT, exploded }
    this.grenades = [];
    this._grenadeIdCounter = 0;
    this._grenadeT = T.grenadeIntervalSec * 0.6;

    // Chain state — projectile + cable.
    this._chainCooldown = T.chainCooldownSec * 0.5;
    this.chain = null;         // { hook, hookMat, cable, cablePts, dx, dz, t, range, hit }
    this._pullStartX = 0;
    this._pullStartZ = 0;
    this._pullTargetX = 0;
    this._pullTargetZ = 0;

    // Spin attack state.
    this._spinCooldown = 0;
    this._spinTelegraph = null;     // { mesh, mat } when telegraphing

    // Searchlight sweep state — null when inactive. While active:
    //   { pivot, beamMesh, beamMat, angle, dir, tickT, phase, phaseT }
    // phase: 'windup' (telegraph, no damage) → 'sweep' (rotating + dmg).
    this._searchBeam = null;
    this._searchBeamT = T.searchBeamIntervalSec * 0.7;   // first cast a bit earlier than full interval

    this._t = 0;
    this._lastBarkT = -10;

    this.group     = null;
    this.coreMesh  = null;
    this.coreMat   = null;
    this.armMesh   = null;          // right arm — holds the chain
    this.handAnchor = null;         // world-space hand point for chain origin
    this._coreFlashTimer = null;

    this._barEl = null;
    this._buildBossBar();
  }

  // ---------- HUD bar ----------
  _buildBossBar() {
    const root = document.createElement('div');
    root.id = 'mega-boss-bar';
    root.style.cssText = `
      position: fixed; top: 28px; left: 50%; transform: translateX(-50%);
      width: 60vw; max-width: 760px; padding: 8px 12px;
      background: rgba(14, 6, 4, 0.78);
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
        <span>THE JAILER</span><span id="mega-boss-pct">100%</span>
      </div>
      <div style="height:6px;background:#1a0808;border:1px solid #2a1010;border-radius:2px;overflow:hidden">
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

  // ---------- Build mesh ----------
  _buildMesh(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);

    const ironColor  = 0x2a2a30;
    const rustColor  = 0x6a3018;
    const chainColor = 0x4a4a52;
    const flameColor = 0xc84038;

    // Base — heavy iron disc.
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x14141a, roughness: 0.55, metalness: 0.65,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 0.35, 16), baseMat);
    base.position.y = 0.18;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // Body — tall barrel-chested cylinder. Hit target.
    const bodyMat = new THREE.MeshStandardMaterial({
      color: ironColor, roughness: 0.55, metalness: 0.7,
      emissive: new THREE.Color(0x1a0a08), emissiveIntensity: 0.30,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 1.9, 14), bodyMat);
    body.position.y = 1.35;
    body.castShadow = true;
    body.userData.zone     = 'torso';
    body.userData.owner    = this;
    body.userData.megaBoss = true;
    this.coreMesh = body;
    this.coreMat  = bodyMat;
    g.add(body);

    // Chest plate — rusted iron rectangle.
    const plateMat = new THREE.MeshStandardMaterial({
      color: rustColor, roughness: 0.7, metalness: 0.4,
    });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 0.15), plateMat);
    plate.position.set(0, 1.45, -0.50);
    plate.castShadow = true;
    g.add(plate);

    // Chains crossing the chest — thin emissive lines.
    const chainMat = new THREE.MeshStandardMaterial({
      color: chainColor, roughness: 0.5, metalness: 0.85,
    });
    for (let i = 0; i < 3; i++) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 5, 16), chainMat);
      link.position.y = 1.05 + i * 0.18;
      link.rotation.x = Math.PI / 2;
      g.add(link);
    }

    // Head — square iron helmet with a glowing visor slit.
    const helmMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a20, roughness: 0.5, metalness: 0.8,
    });
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.50, 0.50), helmMat);
    helm.position.y = 2.40;
    helm.castShadow = true;
    helm.userData.zone     = 'head';
    helm.userData.owner    = this;
    helm.userData.megaBoss = true;
    g.add(helm);
    // Glowing horizontal visor slit.
    const visorMat = new THREE.MeshBasicMaterial({ color: flameColor });
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.02), visorMat);
    visor.position.set(0, 2.42, -0.26);
    g.add(visor);

    // Shoulder pads — heavy iron pauldrons.
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x101015, roughness: 0.55, metalness: 0.75,
    });
    const lPad = new THREE.Mesh(new THREE.SphereGeometry(0.30, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), padMat);
    lPad.position.set(-0.55, 2.05, 0);
    lPad.castShadow = true;
    g.add(lPad);
    const rPad = new THREE.Mesh(new THREE.SphereGeometry(0.30, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), padMat);
    rPad.position.set(0.55, 2.05, 0);
    rPad.castShadow = true;
    g.add(rPad);

    // Right arm — pivot at the shoulder. Holds the chain. Will be
    // animated in tickVisuals + during WINDUP_CHAIN so the throw
    // telegraphs visually.
    const armPivot = new THREE.Group();
    armPivot.position.set(0.55, 1.95, 0);
    g.add(armPivot);
    const armMatDarker = new THREE.MeshStandardMaterial({
      color: 0x14141a, roughness: 0.55, metalness: 0.7,
    });
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.10, 0.85, 8), armMatDarker);
    arm.position.y = -0.35;
    armPivot.add(arm);
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), armMatDarker);
    fist.position.y = -0.80;
    armPivot.add(fist);
    // Hand anchor — child of fist, used as the chain spawn origin in
    // world coordinates via getWorldPosition.
    const handAnchor = new THREE.Object3D();
    handAnchor.position.y = -0.10;
    fist.add(handAnchor);
    this.armMesh    = armPivot;
    this.handAnchor = handAnchor;

    // Left arm — static, hanging at side.
    const lArm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.10, 0.85, 8), armMatDarker);
    lArm.position.set(-0.55, 1.55, 0);
    g.add(lArm);

    this.scene.add(g);
    this.group = g;
  }

  spawn(pos) {
    const cx = (pos && typeof pos.x === 'number') ? pos.x : 0;
    const cz = (pos && typeof pos.z === 'number') ? pos.z : 0;
    this._buildMesh(cx, cz);
    this._pickDashTarget();
    this.alive = true;
    if (this._barEl) this._barEl.style.display = 'block';
    this._bark(BARKS_INTRO[Math.floor(Math.random() * BARKS_INTRO.length)]);
    this._updateBossBar();
  }

  // ---------- Per-tick ----------
  tickVisuals(dt) {
    if (!this.alive) return;
    this._t = (this._t || 0) + dt;
    // Right arm idle pendulum — only when not actively winding up
    // a chain (windup overrides the swing).
    if (this.armMesh && this.state !== STATE.WINDUP_CHAIN) {
      this.armMesh.rotation.x = Math.sin(this._t * 1.1) * 0.18;
      this.armMesh.rotation.z = 0;
    }
    // Hazard visuals — mine pulse + grenade flash. Joiner-side
    // _coopApplyHazardMirrors builds the meshes; this advances the
    // animation. Host runs the same paths from `_tickMines`/
    // `_tickGrenades` inside update(), so the visual is consistent
    // on both ends.
    this._tickMineVisuals(dt);
    this._tickGrenadeVisuals(dt);
  }

  // Pulled out of _tickGrenades so the joiner (which only runs
  // tickVisuals, not update) still animates the flash cadence on
  // coop-mirrored grenades. Joiner-side fuseT advancement here is
  // overwritten by the next snapshot's `g.t` re-sync.
  _tickGrenadeVisuals(dt) {
    if (!this.grenades.length) return;
    for (const g of this.grenades) {
      if (g.exploded || !g.mat) continue;
      // Mirror-side grenades need fuseT to advance locally so the
      // flash ramps up. Host-owned grenades already tick fuseT in
      // _tickGrenades; double-incrementing would just double-speed
      // the cosmetic — gate the bump to remote-only.
      if (g._coopRemote) g.fuseT = Math.min(g.fuse, g.fuseT + dt);
      const k = g.fuse > 0 ? g.fuseT / g.fuse : 0;
      g.mat.emissiveIntensity = 0.45 + 0.85 * Math.abs(Math.sin(this._t * (4 + 14 * k)));
    }
  }

  update(dt) {
    if (!this.alive) return;
    this._t += dt;
    this.stateT += dt;

    // Cooldowns tick down regardless of state.
    if (this._chainCooldown > 0) this._chainCooldown = Math.max(0, this._chainCooldown - dt);
    if (this._spinCooldown  > 0) this._spinCooldown  = Math.max(0, this._spinCooldown  - dt);

    // Per-state behavior.
    switch (this.state) {
      case STATE.DASH:         this._tickDash(dt); break;
      case STATE.WINDUP_CHAIN: this._tickWindupChain(dt); break;
      case STATE.THROW_CHAIN:  this._tickThrowChain(dt); break;
      case STATE.PULL_PLAYER:  this._tickPullPlayer(dt); break;
      case STATE.WINDUP_SPIN:  this._tickWindupSpin(dt); break;
      case STATE.SPIN:         this._tickSpin(dt); break;
      case STATE.SEARCH_BEAM:  this._tickSearchBeam(dt); break;
    }

    // Background systems run on every frame regardless of state.
    this._tickMines(dt);
    this._tickMineVisuals(dt);
    this._tickGrenades(dt);

    this._updateBossBar();
  }

  // ----- DASH state -----
  _tickDash(dt) {
    // Move toward dash target. If arrived OR retarget timer elapsed,
    // pick a new spot. Mid-arena pathing here is purely XZ — no
    // wall/collision avoidance beyond clamping to inner bounds. The
    // arena is open so this is fine for game feel.
    const dx = this._dashTarget.x - this.group.position.x;
    const dz = this._dashTarget.z - this.group.position.z;
    const d = Math.hypot(dx, dz);
    this._dashRetargetT -= dt;
    if (d < T.dashArriveDist || this._dashRetargetT <= 0) {
      this._pickDashTarget();
    } else {
      const step = Math.min(d, T.dashSpeed * dt);
      const nx = this.group.position.x + (dx / d) * step;
      const nz = this.group.position.z + (dz / d) * step;
      this.group.position.x = Math.max(-ARENA_INNER_HALF, Math.min(ARENA_INNER_HALF, nx));
      this.group.position.z = Math.max(-ARENA_INNER_HALF, Math.min(ARENA_INNER_HALF, nz));
      // Face the direction of travel — atan2(x, z) matches the
      // convention used elsewhere for actor yaw on this rig.
      this.group.rotation.y = Math.atan2(dx, dz);
    }

    // Mine drop cadence.
    this._mineDropT -= dt;
    if (this._mineDropT <= 0 && this.mines.length < T.mineCap) {
      this._dropMine(this.group.position.x, this.group.position.z);
      this._mineDropT = T.mineDropIntervalSec;
    }

    // Trigger 1: did the dash bring us close to an armed mine? If so
    // wind up a chain hook (cooldown gated).
    if (this._chainCooldown <= 0) {
      for (const m of this.mines) {
        if (!m.armed) continue;
        const mdx = m.x - this.group.position.x;
        const mdz = m.z - this.group.position.z;
        if (Math.hypot(mdx, mdz) <= T.chainTriggerRadius) {
          this._enterState(STATE.WINDUP_CHAIN);
          this._bark(BARKS_CHAIN[Math.floor(Math.random() * BARKS_CHAIN.length)]);
          return;
        }
      }
    }

    // Trigger 2: did the dash bring us close to the player? If so
    // wind up a spin attack.
    const playerPos = this.ctx.getPlayerPos?.();
    if (playerPos && this._spinCooldown <= 0) {
      const pdx = playerPos.x - this.group.position.x;
      const pdz = playerPos.z - this.group.position.z;
      if (Math.hypot(pdx, pdz) <= T.spinTriggerRadius) {
        this._enterState(STATE.WINDUP_SPIN);
        this._bark(BARKS_SPIN[Math.floor(Math.random() * BARKS_SPIN.length)]);
        return;
      }
    }

    // Grenade barrage on its own cadence — fires from DASH state so
    // it doesn't pre-empt a wind-up.
    this._grenadeT -= dt;
    if (this._grenadeT <= 0) {
      this._fireGrenadeBarrage();
      this._grenadeT = T.grenadeIntervalSec;
    }

    // Searchlight sweep — periodic; pre-empts dash so the boss
    // plants for the sweep duration. Forces the player to circle
    // tangentially around the boss to stay clear of the beam.
    this._searchBeamT -= dt;
    if (this._searchBeamT <= 0) {
      this._enterSearchBeam();
      this._searchBeamT = T.searchBeamIntervalSec;
    }
  }

  _pickDashTarget() {
    // Bias toward circling the player rather than fully random
    // wandering — gives the fight a "stalker" cadence. 70% pick a
    // point at moderate distance from the player on a random angle;
    // 30% fully random arena point so the player can't anchor on a
    // single rotation pattern.
    const playerPos = this.ctx.getPlayerPos?.();
    let tx, tz;
    if (playerPos && Math.random() < 0.7) {
      const ang = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 5;
      tx = playerPos.x + Math.cos(ang) * r;
      tz = playerPos.z + Math.sin(ang) * r;
    } else {
      tx = (Math.random() - 0.5) * 2 * ARENA_INNER_HALF;
      tz = (Math.random() - 0.5) * 2 * ARENA_INNER_HALF;
    }
    this._dashTarget.x = Math.max(-ARENA_INNER_HALF, Math.min(ARENA_INNER_HALF, tx));
    this._dashTarget.z = Math.max(-ARENA_INNER_HALF, Math.min(ARENA_INNER_HALF, tz));
    this._dashRetargetT = T.dashRetargetSec;
  }

  // ----- WINDUP_CHAIN state -----
  _tickWindupChain(dt) {
    // Visual: rotate the right arm back over the head, glow the
    // visor a touch brighter. No motion during wind-up.
    const k = Math.min(1, this.stateT / T.chainWindupSec);
    if (this.armMesh) {
      this.armMesh.rotation.x = -1.4 * k;       // back over head
      this.armMesh.rotation.z = 0.5 * k;
    }
    // Face the player so the throw goes the right way.
    const playerPos = this.ctx.getPlayerPos?.();
    if (playerPos) {
      const dx = playerPos.x - this.group.position.x;
      const dz = playerPos.z - this.group.position.z;
      if (dx * dx + dz * dz > 0.01) {
        this.group.rotation.y = Math.atan2(dx, dz);
      }
    }
    if (this.stateT >= T.chainWindupSec) this._fireChain();
  }

  _fireChain() {
    const playerPos = this.ctx.getPlayerPos?.();
    if (!playerPos) { this._enterState(STATE.DASH); return; }

    // Spawn hook projectile + cable. Hook lives on `this.chain` and is
    // ticked in THROW_CHAIN until it either hits the player, runs out
    // of range, or hits a wall.
    const origin = new THREE.Vector3();
    if (this.handAnchor) this.handAnchor.getWorldPosition(origin);
    else origin.set(this.group.position.x, 1.8, this.group.position.z);

    const dirX = playerPos.x - origin.x;
    const dirZ = playerPos.z - origin.z;
    const dlen = Math.hypot(dirX, dirZ) || 1;
    const dx = dirX / dlen;
    const dz = dirZ / dlen;

    // Hook mesh — small dark cone pointed along travel direction.
    const hookMat = new THREE.MeshStandardMaterial({
      color: 0x402418, roughness: 0.5, metalness: 0.85,
      emissive: new THREE.Color(0x1a0a05), emissiveIntensity: 0.5,
    });
    const hook = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8), hookMat);
    hook.position.copy(origin);
    hook.rotation.z = Math.PI / 2;
    hook.rotation.y = -Math.atan2(dx, dz);
    hook.castShadow = true;
    this.scene.add(hook);

    // Cable line from boss hand → hook. Updated each frame.
    const cableGeom = new THREE.BufferGeometry();
    const cablePts = new Float32Array(6);
    cablePts[0] = origin.x; cablePts[1] = origin.y; cablePts[2] = origin.z;
    cablePts[3] = origin.x; cablePts[4] = origin.y; cablePts[5] = origin.z;
    cableGeom.setAttribute('position', new THREE.BufferAttribute(cablePts, 3).setUsage(THREE.DynamicDrawUsage));
    const cableMat = new THREE.LineBasicMaterial({ color: 0x4a4a52, transparent: true, opacity: 0.85 });
    const cable = new THREE.Line(cableGeom, cableMat);
    cable.frustumCulled = false;
    this.scene.add(cable);

    this.chain = {
      hook, hookMat, cable, cablePts,
      x: origin.x, y: origin.y, z: origin.z,
      dx, dz,
      t: 0, range: T.chainThrowRange,
      hit: false,
    };
    this._enterState(STATE.THROW_CHAIN);
  }

  // ----- THROW_CHAIN state -----
  _tickThrowChain(dt) {
    if (!this.chain) { this._enterState(STATE.DASH); return; }
    const c = this.chain;
    const step = T.chainThrowSpeed * dt;
    c.x += c.dx * step;
    c.z += c.dz * step;
    c.t += step;
    c.hook.position.set(c.x, c.y, c.z);
    // Update cable endpoint at boss hand each frame so the line
    // tracks if the boss has been knocked back / animation moved it.
    // Reuses the module-level scratch vector — was a per-frame
    // allocation (audit flagged as a hot-path Vec3 churn).
    if (this.handAnchor) {
      this.handAnchor.getWorldPosition(_scratchVec3a);
      c.cablePts[0] = _scratchVec3a.x;
      c.cablePts[1] = _scratchVec3a.y;
      c.cablePts[2] = _scratchVec3a.z;
    }
    c.cablePts[3] = c.x; c.cablePts[4] = c.y; c.cablePts[5] = c.z;
    c.cable.geometry.attributes.position.needsUpdate = true;

    // Player hit check.
    const playerPos = this.ctx.getPlayerPos?.();
    if (playerPos && !(this.ctx.playerHasIFrames?.())) {
      const hdx = playerPos.x - c.x;
      const hdz = playerPos.z - c.z;
      if (Math.hypot(hdx, hdz) <= T.chainHitRadius) {
        c.hit = true;
        // Start pull. Cache start/end so the pull lerp is smooth.
        this._pullStartX = playerPos.x;
        this._pullStartZ = playerPos.z;
        // Target = jailer's current XZ (player ends up at the boss's
        // feet, hopefully onto a mine he stood next to).
        this._pullTargetX = this.group.position.x;
        this._pullTargetZ = this.group.position.z;
        this._cleanupChainVisuals();
        this._enterState(STATE.PULL_PLAYER);
        return;
      }
    }
    // Range / wall check. Wall raycast skipped here — sticking the
    // hook geometry on a wall is a polish item; the range limit alone
    // is enough to keep it from extending forever.
    if (c.t >= c.range) {
      this._cleanupChainVisuals();
      this._chainCooldown = T.chainCooldownSec;
      this._enterState(STATE.DASH);
    }
  }

  _cleanupChainVisuals() {
    const c = this.chain;
    if (!c) return;
    if (c.hook) {
      this.scene.remove(c.hook);
      c.hook.geometry?.dispose();
      c.hookMat?.dispose();
    }
    if (c.cable) {
      this.scene.remove(c.cable);
      c.cable.geometry?.dispose();
      c.cable.material?.dispose();
    }
    this.chain = null;
  }

  // ----- PULL_PLAYER state -----
  _tickPullPlayer(dt) {
    // Drag the player from _pullStart toward _pullTarget over
    // chainPullSec. Apply via ctx.knockbackPlayer in incremental
    // steps so the existing collision-clamped knockback path handles
    // walls. ctx.knockbackPlayer adds 0.5× the delta to the player's
    // position per call, so we feed the per-frame remaining delta
    // unscaled and let it consume half each tick.
    const k = Math.min(1, this.stateT / T.chainPullSec);
    const playerPos = this.ctx.getPlayerPos?.();
    if (playerPos && this.ctx.knockbackPlayer) {
      const targetX = this._pullStartX + (this._pullTargetX - this._pullStartX) * k;
      const targetZ = this._pullStartZ + (this._pullTargetZ - this._pullStartZ) * k;
      this.ctx.knockbackPlayer((targetX - playerPos.x) * 2.0, (targetZ - playerPos.z) * 2.0);
    }
    if (this.stateT >= T.chainPullSec) {
      this._chainCooldown = T.chainCooldownSec;
      this._enterState(STATE.DASH);
    }
  }

  // ----- WINDUP_SPIN state -----
  _tickWindupSpin(dt) {
    // Telegraph a red circle on the floor matching the spin AoE. The
    // mesh persists during wind-up, fading to indicate imminent hit.
    if (!this._spinTelegraph) this._spawnSpinTelegraph();
    const k = Math.min(1, this.stateT / T.spinWindupSec);
    if (this._spinTelegraph?.mat) {
      this._spinTelegraph.mat.opacity = 0.25 + 0.45 * k;
    }
    if (this.stateT >= T.spinWindupSec) {
      this._executeSpin();
      this._enterState(STATE.SPIN);
    }
  }

  _spawnSpinTelegraph() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xc83020, transparent: true, opacity: 0.25,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(T.spinAttackRadius * 0.85, T.spinAttackRadius, 32), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(this.group.position.x, 0.06, this.group.position.z);
    this.scene.add(mesh);
    this._spinTelegraph = { mesh, mat };
  }

  _executeSpin() {
    // AoE around the boss. Hits player + applies a knockback away
    // from the boss center.
    const playerPos = this.ctx.getPlayerPos?.();
    if (playerPos) {
      const dx = playerPos.x - this.group.position.x;
      const dz = playerPos.z - this.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d <= T.spinAttackRadius && !(this.ctx.playerHasIFrames?.())) {
        this.ctx.damagePlayer?.(T.spinDamage, 'megaboss', {
          source: this, zone: 'torso', distance: d,
        });
        // Knock the player outward so the spin reads as a hit, not
        // just a damage tick.
        if (this.ctx.knockbackPlayer && d > 0.01) {
          const nx = dx / d, nz = dz / d;
          this.ctx.knockbackPlayer(nx * T.spinKnockbackSpeed, nz * T.spinKnockbackSpeed);
        }
      }
    }
    if (this.ctx.shake) this.ctx.shake(0.55, 0.18);
    this._spinCooldown = T.spinCooldownSec;
  }

  _tickSpin(dt) {
    // Brief follow-through frame — clear the telegraph and return
    // to dash. Kept as its own state so future polish (animation
    // pose, sfx) has a single attach point.
    if (this._spinTelegraph) {
      this.scene.remove(this._spinTelegraph.mesh);
      this._spinTelegraph.mesh.geometry?.dispose();
      this._spinTelegraph.mat?.dispose();
      this._spinTelegraph = null;
    }
    // Spin around visually — single revolution over 0.4s.
    const spinT = 0.4;
    const k = Math.min(1, this.stateT / spinT);
    this.group.rotation.y += Math.PI * 2 * (1 - Math.abs(2 * k - 1)) * dt / spinT;
    if (this.stateT >= spinT) this._enterState(STATE.DASH);
  }

  // ----- SEARCH_BEAM state -----
  _enterSearchBeam() {
    // Build the beam mesh — a long thin rectangle on the floor,
    // anchored at one end (the boss center) so rotating its pivot
    // sweeps the far end around. Pivot is a Group at the boss's
    // current XZ; the beam mesh is offset forward by length/2 inside
    // the pivot's local frame so it extends outward from the
    // rotation center.
    const pivot = new THREE.Group();
    pivot.position.set(this.group.position.x, 0.04, this.group.position.z);
    this.scene.add(pivot);

    const mat = new THREE.MeshBasicMaterial({
      color: 0xff2820, transparent: true, opacity: 0.32,
      depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(
      new THREE.PlaneGeometry(T.searchBeamWidth, T.searchBeamLength),
      mat,
    );
    // Plane local +Y is along its long axis. Lay it flat (rotate -π/2
    // around X), then translate forward along the plane's local +Y
    // (now world +Z after the flat-lay) by half its length so the
    // near edge sits at the pivot origin.
    beam.rotation.x = -Math.PI / 2;
    beam.position.z = T.searchBeamLength / 2;
    pivot.add(beam);

    // Random rotation direction so the player can't pre-commit to a
    // single circling direction. Initial angle aimed at the player so
    // the windup telegraph clearly reads as "I am about to sweep
    // through where you're standing."
    const playerPos = this.ctx.getPlayerPos?.();
    let initialAngle = 0;
    if (playerPos) {
      const dx = playerPos.x - this.group.position.x;
      const dz = playerPos.z - this.group.position.z;
      initialAngle = Math.atan2(dx, dz);
    }
    pivot.rotation.y = initialAngle;

    this._searchBeam = {
      pivot, beamMesh: beam, beamMat: mat,
      angle: initialAngle,
      dir: Math.random() < 0.5 ? -1 : 1,
      tickT: 0,
      phase: 'windup',
      phaseT: 0,
    };
    this._bark(BARKS_SEARCH[Math.floor(Math.random() * BARKS_SEARCH.length)]);
    this._enterState(STATE.SEARCH_BEAM);
  }

  _tickSearchBeam(dt) {
    const sb = this._searchBeam;
    if (!sb) { this._enterState(STATE.DASH); return; }
    sb.phaseT += dt;

    if (sb.phase === 'windup') {
      // Telegraph — beam visible but dim + no damage tick. Pulse so
      // the player reads the impending sweep clearly.
      sb.beamMat.opacity = 0.15 + 0.20 * Math.abs(Math.sin(this._t * 18));
      if (sb.phaseT >= T.searchBeamWindupSec) {
        sb.phase = 'sweep';
        sb.phaseT = 0;
        sb.beamMat.opacity = 0.55;
      }
      // Pivot stays locked on the windup angle so the player sees
      // exactly where the sweep will start.
      return;
    }

    // SWEEP phase — rotate the pivot, damage-tick player when inside.
    sb.angle += sb.dir * T.searchBeamRotSpeed * dt;
    sb.pivot.rotation.y = sb.angle;
    // Subtle opacity flicker while active so the beam reads as
    // "scanning" rather than a static decal.
    sb.beamMat.opacity = 0.50 + 0.15 * Math.sin(this._t * 12);

    sb.tickT += dt;
    if (sb.tickT >= T.searchBeamTickSec) {
      sb.tickT = 0;
      this._searchBeamDamageCheck(sb);
    }

    if (sb.phaseT >= T.searchBeamDurationSec) {
      this._cleanupSearchBeam();
      this._enterState(STATE.DASH);
    }
  }

  _searchBeamDamageCheck(sb) {
    const playerPos = this.ctx.getPlayerPos?.();
    if (!playerPos || this.ctx.playerHasIFrames?.()) return;
    const dx = playerPos.x - this.group.position.x;
    const dz = playerPos.z - this.group.position.z;
    const d = Math.hypot(dx, dz);
    if (d > T.searchBeamLength || d < 0.1) return;
    // Angle of the player relative to the boss (atan2(x, z) matches
    // the convention used for pivot.rotation.y).
    const playerAng = Math.atan2(dx, dz);
    // Shortest signed delta between player angle and beam angle.
    let delta = playerAng - sb.angle;
    while (delta >  Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    // Half-arc at the player's distance covered by the beam's width.
    // half-width arc (rad) = atan2(width/2, d). Closer to the boss =
    // wider arc covered, which matches the visual.
    const halfArc = Math.atan2(T.searchBeamWidth / 2, d);
    if (Math.abs(delta) > halfArc) return;
    this.ctx.damagePlayer?.(T.searchBeamDamage, 'megaboss', {
      source: this, zone: 'torso', distance: d,
    });
  }

  _cleanupSearchBeam() {
    const sb = this._searchBeam;
    if (!sb) return;
    if (sb.pivot) {
      this.scene.remove(sb.pivot);
      sb.pivot.traverse((o) => {
        if (o.geometry?.dispose) o.geometry.dispose();
        if (o.material?.dispose) o.material.dispose();
      });
    }
    this._searchBeam = null;
  }

  // ----- Mines -----
  _dropMine(x, z) {
    // Disc on floor + central light. Arming pulse driven in
    // _tickMineVisuals. Once armed (armT >= mineArmSec) the light
    // goes solid and the mine begins proximity-triggering.
    const mat = new THREE.MeshStandardMaterial({
      color: 0x202028, roughness: 0.55, metalness: 0.65,
    });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.12, 14), mat);
    mesh.position.set(x, 0.06, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // Inner light disc — pulsing red while arming, solid red when
    // armed. Slightly above the housing so it doesn't z-fight.
    const lightMat = new THREE.MeshBasicMaterial({
      color: 0xff4030, transparent: true, opacity: 0.4,
    });
    const lightMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 12), lightMat);
    lightMesh.position.set(x, 0.14, z);
    this.scene.add(lightMesh);

    this._mineIdCounter += 1;
    this.mines.push({
      id: this._mineIdCounter,
      mesh, mat, lightMesh, lightMat,
      x, z,
      armT: 0,
      armed: false,
      exploded: false,
    });
  }

  _tickMineVisuals(dt) {
    if (!this.mines.length) return;
    for (const m of this.mines) {
      if (m.exploded) continue;
      if (!m.armed) {
        // Fast pulse while arming. Frequency ramps with arm progress
        // so the impending arm is readable.
        const k = m.armT / T.mineArmSec;
        const freq = 4 + 12 * k;
        m.lightMat.opacity = 0.35 + 0.55 * Math.abs(Math.sin(this._t * freq));
      } else {
        // Solid + slight breathe so the armed state stays alive on
        // the eye but doesn't blink-distract.
        m.lightMat.opacity = 0.75 + 0.15 * Math.sin(this._t * 3);
      }
    }
  }

  _tickMines(dt) {
    if (!this.mines.length) return;
    const playerPos = this.ctx.getPlayerPos?.();
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      if (m.exploded) {
        // Already exploded; pruned on next pass.
        this.mines.splice(i, 1);
        continue;
      }
      m.armT += dt;
      if (!m.armed && m.armT >= T.mineArmSec) {
        m.armed = true;
        m.lightMat.color.setHex(0xff2010);
      }
      if (m.armed && playerPos) {
        const dx = playerPos.x - m.x;
        const dz = playerPos.z - m.z;
        if (Math.hypot(dx, dz) <= T.mineTriggerRadius) this._explodeMine(m);
      }
    }
  }

  _explodeMine(m) {
    if (m.exploded) return;
    m.exploded = true;
    // Damage + stun if player in radius.
    const playerPos = this.ctx.getPlayerPos?.();
    if (playerPos && !(this.ctx.playerHasIFrames?.())) {
      const dx = playerPos.x - m.x;
      const dz = playerPos.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d <= T.mineExplosionRadius) {
        this.ctx.damagePlayer?.(T.mineDamage, 'megaboss', {
          source: this, zone: 'torso', distance: d,
        });
        // Stun — ctx.stunPlayer feeds main.js's playerStunT (same
        // pipe stun grenades use). Stack semantics: max() with the
        // existing timer so back-to-back mines don't reset.
        this.ctx.stunPlayer?.(T.mineStunSec);
      }
    }
    // Burst FX — combat.spawnImpact gives a small spark/dust ring.
    if (this.ctx.combat?.spawnImpact) {
      this.ctx.combat.spawnImpact(new THREE.Vector3(m.x, 0.4, m.z));
    }
    if (this.ctx.shake) this.ctx.shake(0.4, 0.14);
    // Cleanup mine meshes.
    this.scene.remove(m.mesh);
    m.mesh.geometry?.dispose();
    m.mat?.dispose();
    this.scene.remove(m.lightMesh);
    m.lightMesh.geometry?.dispose();
    m.lightMat?.dispose();
  }

  // ----- Grenade barrage -----
  _fireGrenadeBarrage() {
    this._bark(BARKS_GRENADE[Math.floor(Math.random() * BARKS_GRENADE.length)]);
    const playerPos = this.ctx.getPlayerPos?.();
    for (let i = 0; i < T.grenadeCount; i++) {
      // Scatter around the player's current position — forces them
      // to move. Last grenade also drops on a wider arena point so
      // the player can't simply step into safety.
      let tx, tz;
      if (playerPos && i < T.grenadeCount - 1) {
        const ang = Math.random() * Math.PI * 2;
        const r = 1.5 + Math.random() * 4.5;
        tx = playerPos.x + Math.cos(ang) * r;
        tz = playerPos.z + Math.sin(ang) * r;
      } else {
        tx = (Math.random() - 0.5) * 2 * ARENA_INNER_HALF;
        tz = (Math.random() - 0.5) * 2 * ARENA_INNER_HALF;
      }
      tx = Math.max(-ARENA_INNER_HALF, Math.min(ARENA_INNER_HALF, tx));
      tz = Math.max(-ARENA_INNER_HALF, Math.min(ARENA_INNER_HALF, tz));
      this._spawnGrenade(tx, tz, T.grenadeFuseSec + i * 0.12);
    }
  }

  _spawnGrenade(x, z, fuse) {
    // Grenade pickle on the floor — small dark cylinder + flashing
    // red light. Detonates after `fuse` with the same FX as a mine.
    const mat = new THREE.MeshStandardMaterial({
      color: 0x282820, roughness: 0.55, metalness: 0.5,
      emissive: new THREE.Color(0x401818), emissiveIntensity: 0.45,
    });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.32, 10), mat);
    mesh.position.set(x, 0.18, z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this._grenadeIdCounter += 1;
    this.grenades.push({
      id: this._grenadeIdCounter,
      mesh, mat, x, z, fuseT: 0, fuse, exploded: false,
    });
  }

  _tickGrenades(dt) {
    if (!this.grenades.length) return;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      if (g.exploded) { this.grenades.splice(i, 1); continue; }
      // Skip _coopRemote — joiner-side mirrors are reconciled by
      // _coopApplyHazardMirrors and exploded by host signal, not by
      // local fuse expiry. The visual flash lives in
      // _tickGrenadeVisuals so it animates on the joiner too.
      if (g._coopRemote) continue;
      g.fuseT += dt;
      if (g.fuseT >= g.fuse) this._explodeGrenade(g);
    }
  }

  _explodeGrenade(g) {
    if (g.exploded) return;
    g.exploded = true;
    const playerPos = this.ctx.getPlayerPos?.();
    if (playerPos && !(this.ctx.playerHasIFrames?.())) {
      const dx = playerPos.x - g.x;
      const dz = playerPos.z - g.z;
      const d = Math.hypot(dx, dz);
      if (d <= T.grenadeRadius) {
        this.ctx.damagePlayer?.(T.grenadeDamage, 'megaboss', {
          source: this, zone: 'torso', distance: d,
        });
        if (this.ctx.knockbackPlayer && d > 0.01) {
          const nx = dx / d, nz = dz / d;
          this.ctx.knockbackPlayer(nx * T.grenadeKnockback, nz * T.grenadeKnockback);
        }
      }
    }
    if (this.ctx.combat?.spawnImpact) {
      this.ctx.combat.spawnImpact(new THREE.Vector3(g.x, 0.4, g.z));
    }
    if (this.ctx.shake) this.ctx.shake(0.3, 0.10);
    this.scene.remove(g.mesh);
    g.mesh.geometry?.dispose();
    g.mat?.dispose();
  }

  // ----- State transitions -----
  _enterState(state) {
    this.state = state;
    this.stateT = 0;
  }

  // ---------- Bullet hits ----------
  applyHit(amount) {
    if (!this.alive) return;
    if (typeof amount !== 'number' || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.coreMat) {
      const restore = this.coreMat.emissiveIntensity ?? 0.30;
      this.coreMat.emissiveIntensity = 1.5;
      if (this._coreFlashTimer != null) clearTimeout(this._coreFlashTimer);
      this._coreFlashTimer = setTimeout(() => {
        if (this.coreMat) this.coreMat.emissiveIntensity = restore;
        this._coreFlashTimer = null;
      }, 70);
    }
    if (this.hp <= 0) this._die();
  }

  hittables() {
    return (this.alive && this.coreMesh) ? [this.coreMesh] : [];
  }

  _die() {
    this.alive = false;
    if (this.ctx.bumpEncounterCount) {
      try { this.ctx.bumpEncounterCount(); } catch (_) {}
    }
    this._bark(BARKS_DIE[Math.floor(Math.random() * BARKS_DIE.length)]);
    // Hide the boss bar a beat after the death bark — store the
    // handle so destroy() can clear it. Without the clear, a regen
    // that fires during the 1.8s window would orphan the callback
    // and have it touch a null _barEl after teardown.
    this._barHideTimer = setTimeout(() => {
      this._barHideTimer = null;
      if (this._barEl) this._barEl.style.display = 'none';
    }, 1800);
    // Loot drop — same pattern as the other megabosses.
    if (this.ctx.lootRolls && this.ctx.loot && this.group) {
      try {
        const drops = this.ctx.lootRolls(0) || [];
        const cx = this.group.position.x, cz = this.group.position.z;
        const inner = 13;
        for (let i = 0; i < drops.length; i++) {
          const a = (i / Math.max(1, drops.length)) * Math.PI * 2;
          const r = 1.6 + Math.random() * 0.5;
          let lx = cx + Math.cos(a) * r;
          let lz = cz + Math.sin(a) * r;
          lx = Math.max(-inner, Math.min(inner, lx));
          lz = Math.max(-inner, Math.min(inner, lz));
          this.ctx.loot.spawnItem({ x: lx, y: 0.4, z: lz }, drops[i]);
        }
      } catch (_) { /* swallow — loot is best-effort */ }
    }
    if (this.ctx.onMegaBossDead) this.ctx.onMegaBossDead(this);
  }

  // ---------- Coop snapshot ----------
  // Encode floor hazards (mines + grenades), the active chain hook,
  // and the search beam angle into a compact extras object. Called
  // host-side from snapshot._encodeMegaBoss; result lands on b.hz on
  // the joiner. Quantized to 2 decimal places for bandwidth — hazard
  // positions don't need higher resolution than that for trigger
  // visualization.
  _coopEncodeHazards() {
    const out = {};
    if (this.mines.length) {
      const arr = [];
      for (const m of this.mines) {
        if (m.exploded) continue;
        arr.push({
          n: m.id | 0,
          x: +m.x.toFixed(2),
          z: +m.z.toFixed(2),
          a: m.armed ? 1 : 0,
        });
      }
      if (arr.length) out.m = arr;
    }
    if (this.grenades.length) {
      const arr = [];
      for (const g of this.grenades) {
        if (g.exploded) continue;
        arr.push({
          n: g.id | 0,
          x: +g.x.toFixed(2),
          z: +g.z.toFixed(2),
          // Fuse remaining (s) — used by joiner to flash the grenade
          // at the right cadence as detonation approaches.
          t: +Math.max(0, g.fuse - g.fuseT).toFixed(2),
        });
      }
      if (arr.length) out.g = arr;
    }
    if (this.chain) {
      out.c = {
        x: +this.chain.x.toFixed(2),
        z: +this.chain.z.toFixed(2),
      };
    }
    if (this._searchBeam) {
      out.s = {
        a: +this._searchBeam.angle.toFixed(3),
        p: this._searchBeam.phase === 'windup' ? 0 : 1,
      };
    }
    // Return null when nothing to send so the encoder can drop the
    // field entirely (snapshot stays compact when hazards are clear).
    return (out.m || out.g || out.c || out.s) ? out : null;
  }

  // Reconcile the local mirror state against the host's hazard
  // snapshot. Runs joiner-side; host short-circuits because its
  // mines/grenades are already authoritative. Detects the joiner
  // mode by checking for a flag the host wouldn't set on its own
  // local mines (id-matching with the local id counter would fail
  // on the joiner since local _mineIdCounter stays at 0).
  _coopApplyHazardMirrors(hz) {
    // If the host clears the field, drop every mirrored hazard.
    const mineList = (hz && hz.m) ? hz.m : [];
    const grenList = (hz && hz.g) ? hz.g : [];
    const chainSnap = hz && hz.c;
    const beamSnap  = hz && hz.s;

    // Mines — reconcile by id.
    const liveMines = new Set();
    for (const sm of mineList) {
      liveMines.add(sm.n | 0);
      let local = null;
      for (const m of this.mines) {
        if ((m.id | 0) === (sm.n | 0)) { local = m; break; }
      }
      if (!local) {
        // First-arrival mirror — build a thin visual proxy at the
        // snapshot position. Mirrors carry _coopRemote so the host
        // cleanup paths skip them (they were never owned locally).
        this._dropMine(+sm.x || 0, +sm.z || 0);
        local = this.mines[this.mines.length - 1];
        local.id = sm.n | 0;        // align with host id, not local counter
        local._coopRemote = true;
      }
      // Update armed state — drives the light color + opacity in
      // _tickMineVisuals.
      const armed = !!(sm.a | 0);
      if (armed && !local.armed) {
        local.armed = true;
        local.armT = 999;            // freezes the arming pulse path
        if (local.lightMat) local.lightMat.color.setHex(0xff2010);
      }
    }
    // Despawn locals the host says are gone.
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      if (m._coopRemote && !liveMines.has(m.id | 0)) {
        // Quick burst at the mine site so the joiner sees it
        // detonate rather than just vanish.
        if (this.ctx.combat?.spawnImpact) {
          this.ctx.combat.spawnImpact(new THREE.Vector3(m.x, 0.4, m.z));
        }
        if (m.mesh) {
          this.scene.remove(m.mesh);
          m.mesh.geometry?.dispose();
          m.mat?.dispose();
        }
        if (m.lightMesh) {
          this.scene.remove(m.lightMesh);
          m.lightMesh.geometry?.dispose();
          m.lightMat?.dispose();
        }
        this.mines.splice(i, 1);
      }
    }

    // Grenades — same reconcile pattern. Position is static once
    // dropped; only fuse-remaining matters for the flash cadence.
    const liveGrens = new Set();
    for (const sg of grenList) {
      liveGrens.add(sg.n | 0);
      let local = null;
      for (const g of this.grenades) {
        if ((g.id | 0) === (sg.n | 0)) { local = g; break; }
      }
      if (!local) {
        this._spawnGrenade(+sg.x || 0, +sg.z || 0, +sg.t || T.grenadeFuseSec);
        local = this.grenades[this.grenades.length - 1];
        local.id = sg.n | 0;
        local._coopRemote = true;
      }
      // Re-sync fuse remaining each tick so the flash speed tracks
      // the host. (Mirror's local fuseT keeps ticking but the host
      // is authoritative on remaining time.)
      local.fuse = local.fuseT + (+sg.t || 0);
    }
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      if (g._coopRemote && !liveGrens.has(g.id | 0)) {
        if (this.ctx.combat?.spawnImpact) {
          this.ctx.combat.spawnImpact(new THREE.Vector3(g.x, 0.4, g.z));
        }
        if (g.mesh) {
          this.scene.remove(g.mesh);
          g.mesh.geometry?.dispose();
          g.mat?.dispose();
        }
        this.grenades.splice(i, 1);
      }
    }

    // Chain — minimal mirror. If the host has a chain in flight and
    // we don't, build a lightweight hook visual at the snapshot
    // position. If host's gone clear it. No cable mirror; joiner sees
    // a flying hook which is enough to read the attack.
    if (chainSnap) {
      if (!this.chain || !this.chain._coopRemote) {
        // Either no local chain (joiner) or local chain is host-
        // authoritative; only build remote mirror if there's nothing.
        if (!this.chain) {
          const hookMat = new THREE.MeshStandardMaterial({
            color: 0x402418, roughness: 0.5, metalness: 0.85,
            emissive: new THREE.Color(0x1a0a05), emissiveIntensity: 0.6,
          });
          const hook = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8), hookMat);
          hook.position.set(chainSnap.x, 1.5, chainSnap.z);
          this.scene.add(hook);
          this.chain = {
            hook, hookMat, cable: null, cablePts: null,
            x: chainSnap.x, y: 1.5, z: chainSnap.z,
            dx: 0, dz: 0, t: 0, range: 0, hit: false,
            _coopRemote: true,
          };
        }
      }
      // Update mirror position.
      if (this.chain && this.chain._coopRemote && this.chain.hook) {
        this.chain.hook.position.set(chainSnap.x, this.chain.y, chainSnap.z);
        this.chain.x = chainSnap.x;
        this.chain.z = chainSnap.z;
      }
    } else if (this.chain && this.chain._coopRemote) {
      this._cleanupChainVisuals();
    }

    // Search beam mirror — built when the host enters the state,
    // angle synced each tick, torn down when state exits.
    if (beamSnap) {
      if (!this._searchBeam || !this._searchBeam._coopRemote) {
        if (!this._searchBeam) {
          this._enterSearchBeam();
          this._searchBeam._coopRemote = true;
        }
      }
      if (this._searchBeam) {
        this._searchBeam.angle = beamSnap.a;
        if (this._searchBeam.pivot) this._searchBeam.pivot.rotation.y = beamSnap.a;
        // Phase 0 = windup, 1 = sweep. Sync the visual opacity hint.
        this._searchBeam.phase = beamSnap.p === 0 ? 'windup' : 'sweep';
      }
    } else if (this._searchBeam && this._searchBeam._coopRemote) {
      this._cleanupSearchBeam();
    }
  }

  // ---------- Cleanup ----------
  destroy() {
    this.alive = false;
    if (this._coreFlashTimer != null) {
      clearTimeout(this._coreFlashTimer);
      this._coreFlashTimer = null;
    }
    if (this._barHideTimer != null) {
      clearTimeout(this._barHideTimer);
      this._barHideTimer = null;
    }
    // Chain visuals.
    this._cleanupChainVisuals();
    // Spin telegraph.
    if (this._spinTelegraph) {
      this.scene.remove(this._spinTelegraph.mesh);
      this._spinTelegraph.mesh.geometry?.dispose();
      this._spinTelegraph.mat?.dispose();
      this._spinTelegraph = null;
    }
    // Searchlight sweep visuals.
    this._cleanupSearchBeam();
    // Mines.
    for (const m of this.mines) {
      if (m.mesh) {
        this.scene.remove(m.mesh);
        m.mesh.geometry?.dispose();
        m.mat?.dispose();
      }
      if (m.lightMesh) {
        this.scene.remove(m.lightMesh);
        m.lightMesh.geometry?.dispose();
        m.lightMat?.dispose();
      }
    }
    this.mines = [];
    // Grenades.
    for (const g of this.grenades) {
      if (g.mesh) {
        this.scene.remove(g.mesh);
        g.mesh.geometry?.dispose();
        g.mat?.dispose();
      }
    }
    this.grenades = [];
    // Boss group.
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
    if (now - this._lastBarkT < T.barkCooldownSec) return;
    this._lastBarkT = now;
    if (!this.group || !this.ctx.camera) return;
    const wp = this.group.position.clone().add(new THREE.Vector3(0, 3.0, 0));
    spawnSpeechBubble(wp, this.ctx.camera, text, 3.0);
  }
}

// Loot-roll builder — same shape as buildGeneralLoot.
export function buildJailerLoot({ randomWeapon, randomArmor, pickHealConsumable, pickJunk }, encIdx = 0) {
  const drops = [];
  const wRarity = encIdx >= 1 ? 'legendary' : 'epic';
  const w = randomWeapon?.(wRarity);
  if (w) drops.push(w);
  const a1 = randomArmor?.(encIdx >= 2 ? 'epic' : 'rare');
  if (a1) drops.push(a1);
  const a2 = randomArmor?.(encIdx >= 1 ? 'rare' : 'uncommon');
  if (a2) drops.push(a2);
  for (let i = 0; i < 2; i++) {
    const c = pickHealConsumable?.();
    if (c) drops.push(c);
  }
  const j = pickJunk?.();
  if (j) drops.push(j);
  return drops;
}
