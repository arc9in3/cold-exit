// THE GENERAL — phalanx + wave megaboss.
//
// Player and General face each other across the arena. The General
// stands at the back end gesturing; he never moves and never attacks
// directly. His threat profile is two-layered:
//
//   1. Phalanx — 3 heavy shield bearers (300 HP each) parked in front
//      of the General. They project onto the player→General line and
//      slide along it to maintain a shield wall, with a small jitter
//      so they don't read as a static rig. Slow turning toward the
//      player so flanking is rewarded.
//
//   2. Waves — a stream of melee grunts spawns from BEHIND the
//      General every `waveIntervalSec` and pours toward the player.
//      Wave size starts at `waveBaseCount` and grows by
//      `wavePerWaveBump` each wave, capped at `waveBaseCap +
//      waveCapPerEncounter * encounterIndex` (hard ceiling
//      `waveMaxCap`). One grunt per wave is randomly promoted to a
//      large swordsman with `swordsmanHpFactor`× HP and a cosmetic
//      scale bump.
//
// Killing the General freezes every troop he spawned (deepSleepT set
// to a large value so the existing melee FSM's sleep override pins
// them). Loot drops at the General's feet via the standard
// ctx.lootRolls path.
//
// All tuning lives in BALANCE.megaboss.general (src/balance.js). The
// public surface mirrors MegaBoss / MegaBossEcho:
//   constructor(ctx) — same shape as the other mega-bosses
//   spawn(_pos)      — spawn position is hard-coded opposite the
//                      arena's player-spawn corner; the conventional
//                      `pos` arg is ignored
//   update(dt)       — per-frame tick
//   applyHit(amount) — bullet damage in
//   hittables()      — raycast targets (the chest mesh)
//   alive            — bool
//   destroy()        — cleanup

import * as THREE from 'three';
import { spawnSpeechBubble } from './hud.js';
import { BALANCE } from './balance.js';

const _BAR_TINT = '#c8a050';

const BARKS_INTRO = [
  'HOLD THE LINE.',
  'FORWARD! THEY HAVE NUMBERS, WE HAVE DISCIPLINE.',
  'GENTLEMEN. TO YOUR POSITIONS.',
];
const BARKS_WAVE = [
  'AGAIN! INTO THE BREACH.',
  'PRESS THE ATTACK.',
  'DO NOT YIELD.',
  'EVERY MAN, FORWARD.',
];
const BARKS_DIE = [
  'I... underestimated...',
  'HOLD... the line...',
  '...inform my wife.',
];

// Tuning shorthand.
const _T = () => BALANCE.megaboss.general;

export class MegaBossGeneral {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    // encounterIndex: how many times the player has fought ANY
    // mega-boss in their save. Plumbed via ctx.encounterIndex; falls
    // back to 0 for first-time fight.
    this.encounterIndex = (ctx.encounterIndex | 0) || 0;

    const T = _T();
    const hpScale = 1 + T.hpScalePerEncounter * this.encounterIndex;
    this.maxHp = Math.round(T.baseHp * hpScale);
    this.hp = this.maxHp;
    this.alive = false;

    // Phalanx (live, controlled-by-boss) + active troops list.
    this.phalanx = [];
    this.troops  = [];

    // Wave scheduling.
    this.waveT     = T.firstWaveDelay;
    this.waveIndex = 0;

    this._t = 0;
    this._lastBarkT = -10;

    this.group     = null;
    this.coreMesh  = null;
    this.coreMat   = null;
    this.armMesh   = null;
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
      background: rgba(14, 10, 4, 0.78);
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
        <span>THE GENERAL</span><span id="mega-boss-pct">100%</span>
      </div>
      <div style="height:6px;background:#1a1408;border:1px solid #2a2010;border-radius:2px;overflow:hidden">
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

    const coatColor   = 0x2a3520;     // dark olive
    const accentColor = 0xc8a050;     // gold trim
    const skinColor   = 0xc89878;
    const bootColor   = 0x141008;

    // Boots / base.
    const baseMat = new THREE.MeshStandardMaterial({
      color: bootColor, roughness: 0.65, metalness: 0.25,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.35, 16), baseMat);
    base.position.y = 0.18;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // Long coat — main hit target. Tall cylinder so the silhouette
    // reads as a uniformed officer at iso distance.
    const coatMat = new THREE.MeshStandardMaterial({
      color: coatColor, roughness: 0.7, metalness: 0.15,
      emissive: new THREE.Color(0x1a1f10), emissiveIntensity: 0.35,
    });
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.7, 14), coatMat);
    coat.position.y = 1.20;
    coat.castShadow = true;
    coat.userData.zone     = 'torso';
    coat.userData.owner    = this;
    coat.userData.megaBoss = true;
    this.coreMesh = coat;
    this.coreMat  = coatMat;
    g.add(coat);

    // Gold sash — thin torus around the coat. Cosmetic.
    const sashMat = new THREE.MeshStandardMaterial({
      color: accentColor, roughness: 0.4, metalness: 0.7,
      emissive: new THREE.Color(0x4a3010), emissiveIntensity: 0.25,
    });
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.04, 6, 24), sashMat);
    sash.position.y = 1.55;
    sash.rotation.x = Math.PI / 2;
    g.add(sash);

    // Head — also tagged head zone so headshots register.
    const headMat = new THREE.MeshStandardMaterial({
      color: skinColor, roughness: 0.55,
    });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), headMat);
    head.position.y = 2.20;
    head.castShadow = true;
    head.userData.zone     = 'head';
    head.userData.owner    = this;
    head.userData.megaBoss = true;
    g.add(head);

    // Officer's cap — flat disk + brim.
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x101410, roughness: 0.55, metalness: 0.1,
    });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.16, 14), capMat);
    cap.position.y = 2.40;
    cap.castShadow = true;
    g.add(cap);
    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.30, 0.30, 0.025, 14),
      capMat,
    );
    brim.position.y = 2.32;
    brim.castShadow = false;
    g.add(brim);
    // Cap badge — small gold square on the front of the cap.
    const badge = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.02),
      sashMat,
    );
    badge.position.set(0, 2.40, -0.24);
    g.add(badge);

    // Shoulder boards — gold.
    const boardMat = new THREE.MeshStandardMaterial({
      color: accentColor, roughness: 0.4, metalness: 0.7,
    });
    const lBoard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.20), boardMat);
    lBoard.position.set(-0.32, 1.78, 0);
    g.add(lBoard);
    const rBoard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.20), boardMat);
    rBoard.position.set( 0.32, 1.78, 0);
    g.add(rBoard);

    // Right arm — gestures. Pivots at the shoulder; we animate
    // rotation.z over time.
    const armPivot = new THREE.Group();
    armPivot.position.set(0.36, 1.72, 0);
    g.add(armPivot);
    const armMat = new THREE.MeshStandardMaterial({
      color: coatColor, roughness: 0.7, metalness: 0.15,
    });
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.08, 0.7, 8), armMat);
    arm.position.y = -0.30;       // hangs below the pivot
    armPivot.add(arm);
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), headMat);
    fist.position.y = -0.66;
    armPivot.add(fist);
    this.armMesh = armPivot;

    // Left arm — static, hands behind back position.
    const lArm = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.08, 0.7, 8), armMat);
    lArm.position.set(-0.36, 1.40, 0);
    g.add(lArm);

    this.scene.add(g);
    this.group = g;
  }

  spawn(pos) {
    // Player spawns at SW corner of the mega-arena (level.js
    // generateMegaArena → -HALF+4, -HALF+4 = -11, -11). Place The
    // General firmly opposite — NE-ish — relative to the supplied
    // arena center (defaults to origin if main.js passes null).
    const cx = (pos && typeof pos.x === 'number') ? pos.x : 0;
    const cz = (pos && typeof pos.z === 'number') ? pos.z : 0;
    const generalX = cx + 8;
    const generalZ = cz + 8;
    this._buildMesh(generalX, generalZ);
    // Face toward the player corner (SW). atan2(x, z) = yaw that
    // points down +Z; the player is at -X / -Z so we rotate to
    // face the diagonal.
    this.group.rotation.y = Math.atan2(-1, -1);
    this.alive = true;
    if (this._barEl) this._barEl.style.display = 'block';
    this._spawnPhalanx();
    this._bark(BARKS_INTRO[Math.floor(Math.random() * BARKS_INTRO.length)]);
    this._updateBossBar();
  }

  _spawnPhalanx() {
    const T = _T();
    if (!this.ctx.spawnPhalanxBearer) return;
    const gx = this.group.position.x;
    const gz = this.group.position.z;
    // Initial stand-off — straight forward (toward player at SW).
    const fx = -1, fz = -1;
    const fd = Math.SQRT2;
    const baseX = gx + (fx / fd) * T.phalanxStandoffDist;
    const baseZ = gz + (fz / fd) * T.phalanxStandoffDist;
    const px = -fz / fd, pz = fx / fd;
    for (let i = 0; i < T.phalanxCount; i++) {
      const slot = (i - (T.phalanxCount - 1) / 2) * T.phalanxSlotSpacing;
      const sx = baseX + px * slot;
      const sz = baseZ + pz * slot;
      const e = this.ctx.spawnPhalanxBearer(sx, sz, T.phalanxHpMult);
      if (e) this.phalanx.push(e);
    }
  }

  // ---------- Per-tick ----------
  // Visual-only tick — drives the gesturing arm pendulum on the
  // joiner side. Phalanx / wave / bark logic is host-only (those
  // flow through melees snapshot). Called by joiner's coop branch
  // after applyMegaBossSnapshot so the General isn't a frozen
  // statue teleporting between snapshot ticks.
  tickVisuals(dt) {
    if (!this.alive) return;
    this._t = (this._t || 0) + dt;
    if (this.armMesh) {
      this.armMesh.rotation.z = -0.4 + Math.sin(this._t * 0.7) * 0.6;
      this.armMesh.rotation.x = Math.sin(this._t * 0.5 + 0.4) * 0.25;
    }
  }

  update(dt) {
    if (!this.alive) return;
    this._t += dt;

    // Drop dead phalanx / troops from our tracking lists. Cheap O(N)
    // sweep; lists rarely exceed ~25 entries even at max cap.
    this.phalanx = this.phalanx.filter(e => e && e.alive);
    this.troops  = this.troops.filter(e => e && e.alive);

    this._tickPhalanx(dt);

    // Wave scheduling.
    this.waveT -= dt;
    if (this.waveT <= 0) {
      this._spawnWave();
      this.waveT = _T().waveIntervalSec;
    }

    // Gesturing arm — slow pendulum motion + tilt so the General
    // reads as commanding rather than frozen.
    if (this.armMesh) {
      this.armMesh.rotation.z = -0.4 + Math.sin(this._t * 0.7) * 0.6;
      this.armMesh.rotation.x = Math.sin(this._t * 0.5 + 0.4) * 0.25;
    }

    this._updateBossBar();
  }

  _tickPhalanx(dt) {
    if (!this.phalanx.length) return;
    const playerPos = this.ctx.getPlayerPos?.();
    if (!playerPos) return;
    const T = _T();
    const gx = this.group.position.x;
    const gz = this.group.position.z;
    // Unit vector from General toward player. Phalanx sits between
    // them, `phalanxStandoffDist` m from the General, on a line
    // perpendicular to that direction.
    const toPlayerX = playerPos.x - gx;
    const toPlayerZ = playerPos.z - gz;
    const d = Math.hypot(toPlayerX, toPlayerZ);
    if (d < 0.01) return;
    const fx = toPlayerX / d;
    const fz = toPlayerZ / d;
    const baseX = gx + fx * T.phalanxStandoffDist;
    const baseZ = gz + fz * T.phalanxStandoffDist;
    const px = -fz, pz = fx;
    const liveCount = this.phalanx.length;
    for (let i = 0; i < liveCount; i++) {
      const e = this.phalanx[i];
      if (!e || !e.alive) continue;
      // Slot index across the LIVE count so a fallen bearer doesn't
      // leave a gap — survivors re-center across the line.
      const slot = (i - (liveCount - 1) / 2) * T.phalanxSlotSpacing;
      const jitter = Math.sin(this._t * T.phalanxJitterHz + i * 1.3) * T.phalanxJitterAmp;
      const tx = baseX + px * (slot + jitter);
      const tz = baseZ + pz * (slot + jitter);
      const cx = e.group.position.x;
      const cz = e.group.position.z;
      const ddx = tx - cx;
      const ddz = tz - cz;
      const dd = Math.hypot(ddx, ddz);
      if (dd > 0.04) {
        const step = Math.min(dd, T.phalanxFollowRate * dt);
        e.group.position.x = cx + (ddx / dd) * step;
        e.group.position.z = cz + (ddz / dd) * step;
      }
      // Slow facing toward the player. Standard shortest-arc lerp.
      const targetYaw = Math.atan2(playerPos.x - e.group.position.x,
                                    playerPos.z - e.group.position.z);
      const cur = e.group.rotation.y;
      let delta = targetYaw - cur;
      while (delta >  Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      e.group.rotation.y = cur
        + Math.sign(delta) * Math.min(Math.abs(delta), T.phalanxTurnRate * dt);
    }
  }

  _spawnWave() {
    const T = _T();
    if (!this.ctx.spawnGeneralTroop) return;
    // Active cap: per-encounter ramp on top of the base, hard-capped.
    const dynCap = Math.min(
      T.waveMaxCap,
      T.waveBaseCap + T.waveCapPerEncounter * this.encounterIndex,
    );
    // Wave size grows linearly with the wave index.
    const wantSize = Math.min(dynCap, T.waveBaseCount + T.wavePerWaveBump * this.waveIndex);
    this.waveIndex += 1;
    // One random promotion per wave. -1 means none if wantSize is 0.
    const promoteIdx = wantSize > 0 ? Math.floor(Math.random() * wantSize) : -1;
    // HP scaling for this wave's troops (separate slope from the
    // General's so they ramp gentler).
    const troopHp = T.troopHpMult * (1 + T.troopHpScalePerEncounter * this.encounterIndex);
    const gx = this.group.position.x;
    const gz = this.group.position.z;
    // Spawn directly behind The General (away from player). Mild
    // arc so the wave doesn't pile through one point.
    const playerPos = this.ctx.getPlayerPos?.();
    let backX = 1, backZ = 0;
    if (playerPos) {
      backX = gx - playerPos.x;
      backZ = gz - playerPos.z;
      const bd = Math.hypot(backX, backZ) || 1;
      backX /= bd; backZ /= bd;
    }
    for (let i = 0; i < wantSize; i++) {
      const t = (i / Math.max(1, wantSize - 1)) - 0.5;     // -0.5..0.5
      // Tightened spread (was 2.4 rad ≈ ±69° → 1.4 rad ≈ ±40°) so
      // the wave consistently emerges from BEHIND the General
      // rather than wrapping around to his sides — important now
      // that the phalanx stands in front; wide arcs were dropping
      // troops next to the shield wall instead of behind it.
      const arc = t * 1.4;
      const ang = Math.atan2(backX, backZ) + arc;
      const r = 2.4 + Math.random() * 0.6;
      const sx = gx + Math.sin(ang) * r;
      const sz = gz + Math.cos(ang) * r;
      const isSwordsman = (i === promoteIdx);
      const troop = this.ctx.spawnGeneralTroop(
        sx, sz,
        isSwordsman,
        troopHp,
      );
      if (troop) this.troops.push(troop);
    }
    if (this.waveIndex > 1 && Math.random() < 0.6) {
      this._bark(BARKS_WAVE[Math.floor(Math.random() * BARKS_WAVE.length)]);
    }
  }

  // ---------- Bullet hits ----------
  applyHit(amount) {
    if (!this.alive) return;
    if (typeof amount !== 'number' || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    if (this.coreMat) {
      const restore = this.coreMat.emissiveIntensity ?? 0.35;
      this.coreMat.emissiveIntensity = 1.5;
      // Single shared timer so rapid-fire weapons don't queue 50 of
      // them. clearTimeout + setTimeout pattern keeps the flash
      // rendering for ~70ms after the LAST hit.
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
    // Freeze every troop the General spawned. deepSleepT >> 0 puts
    // the existing melee FSM into permanent IDLE-pinned state (see
    // melee_enemy._updateAI's sleep override). Phalanx + troops both
    // freeze; the player can mop them up at leisure or just walk to
    // the exit.
    for (const t of this.troops)  if (t && t.alive) t.deepSleepT = 9999;
    for (const p of this.phalanx) if (p && p.alive) p.deepSleepT = 9999;
    // Hide HUD bar after a beat.
    setTimeout(() => { if (this._barEl) this._barEl.style.display = 'none'; }, 1800);
    // Drop loot. Arena half-size = 15m (level.js); clamp to ±13 so
    // an edge-position General never flings drops behind the wall.
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

  // ---------- Cleanup ----------
  destroy() {
    this.alive = false;
    if (this._coreFlashTimer != null) {
      clearTimeout(this._coreFlashTimer);
      this._coreFlashTimer = null;
    }
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
    // Don't manually kill phalanx + troops here — level regen calls
    // melees.removeAll() which handles them. Setting our refs to
    // null prevents accidental access after disposal.
    this.phalanx = [];
    this.troops  = [];
  }

  // ---------- Barks ----------
  _bark(text) {
    if (!text) return;
    const now = this._t;
    if (now - this._lastBarkT < _T().barkCooldownSec) return;
    this._lastBarkT = now;
    if (!this.group || !this.ctx.camera) return;
    const wp = this.group.position.clone().add(new THREE.Vector3(0, 2.9, 0));
    spawnSpeechBubble(wp, this.ctx.camera, text, 3.0);
  }
}

// Loot-roll builder — same shape as buildMegaBossLoot in megaboss.js.
// The General drops big — he's the boss of a meat-grinder fight, so
// the payout matches the time investment.
export function buildGeneralLoot({ randomWeapon, randomArmor, pickHealConsumable, pickJunk }, encIdx = 0) {
  const drops = [];
  // 1 weapon (epic baseline, legendary on repeats).
  const wRarity = encIdx >= 1 ? 'legendary' : 'epic';
  const w = randomWeapon?.(wRarity);
  if (w) drops.push(w);
  // 2 armor pieces.
  const aRarity = encIdx >= 2 ? 'epic' : 'rare';
  const a1 = randomArmor?.(aRarity);
  if (a1) drops.push(a1);
  const a2 = randomArmor?.(encIdx >= 1 ? 'rare' : 'uncommon');
  if (a2) drops.push(a2);
  // 2 heals + 1 junk.
  for (let i = 0; i < 2; i++) {
    const c = pickHealConsumable?.();
    if (c) drops.push(c);
  }
  const j = pickJunk?.();
  if (j) drops.push(j);
  return drops;
}
