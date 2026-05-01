import * as THREE from 'three';
import { tunables } from './tunables.js';
import { modelForItem, gripOffsetForModelPath, rotationOverrideForModelPath, shouldMirrorInHand, scaleForModelPath } from './model_manifest.js';
import { getCharacterStyle } from './prefs.js';
import { loadModelClone, fitToRadius } from './gltf_cache.js';
import { buildRig, initAnim, updateAnim, pokeHit, pokeRecoil, pokeDeath,
         RIFLE_WEAPON_HIP, RIFLE_WEAPON_AIM,
         SMG_WEAPON_HIP,   SMG_WEAPON_AIM } from './actor_rig.js';
import { buildMeleePrimitive } from './melee_primitives.js';

// Isometric camera is rotated 45° around Y. Map input directions so W goes
// "up the screen" in the iso view rather than along world +Z.
const FORWARD = new THREE.Vector3(-1, 0, -1).normalize();
const RIGHT = new THREE.Vector3(1, 0, -1).normalize();

// Module scratch — reused inside player.update for the aim-pitch
// chest world-position read. Consumed synchronously inside the same
// function so reuse is safe across frames.
const _aimChestScratch = new THREE.Vector3();
const _muzzleTipScratch = new THREE.Vector3();

// Movement modes. Only one is active at a time.
const MODE = {
  GROUND: 'ground',
  DASH: 'dash',
  ROLL: 'roll',
  SLIDE: 'slide',
};

// Active while the player is shooting/aiming AND trying to move
// opposite the aim direction. Only triggers with a ranged weapon —
// melee carriers don't care, a sword swing is its own directional
// commit. Side-stepping (perpendicular) reads as 90° and stays full
// speed; only clearly backward movement (dot < -0.3) flips this on.
function _isBackpedaling(state, input, aimPoint, wish, group) {
  if (!(input.attackHeld || input.adsHeld)) return false;
  if (state.equipped?.type !== 'ranged') return false;
  if (!aimPoint) return false;
  if (wish.lengthSq() < 0.01) return false;
  const ax = aimPoint.x - group.position.x;
  const az = aimPoint.z - group.position.z;
  const alen = Math.hypot(ax, az);
  if (alen < 0.01) return false;
  const dot = (wish.x * ax + wish.z * az) / alen;
  return dot < -0.3;
}

// Per-class profile for the gun-held quick melee (pistol-whip /
// rifle-butt). Damage starts at 25% of the gun's per-shot damage and
// is then biased by `dmgMult` — bigger guns hit harder at the cost of
// a slower swing. `startup + active + recovery` is the total swing
// duration; pistols come out ~0.30s, LMG rifle-butts ~0.55s.
const QUICK_MELEE_BY_CLASS = {
  pistol:  { dmgMult: 0.85, staminaCost: 5,  range: 2.2, angleDeg: 70, knockback: 0.6,
             startup: 0.07, active: 0.10, recovery: 0.14 },
  smg:     { dmgMult: 0.95, staminaCost: 6,  range: 2.4, angleDeg: 75, knockback: 0.7,
             startup: 0.08, active: 0.11, recovery: 0.15 },
  rifle:   { dmgMult: 1.20, staminaCost: 8,  range: 2.8, angleDeg: 85, knockback: 1.0,
             startup: 0.12, active: 0.14, recovery: 0.20 },
  shotgun: { dmgMult: 1.30, staminaCost: 9,  range: 2.8, angleDeg: 85, knockback: 1.2,
             startup: 0.13, active: 0.15, recovery: 0.22 },
  sniper:  { dmgMult: 1.45, staminaCost: 10, range: 3.0, angleDeg: 80, knockback: 1.2,
             startup: 0.16, active: 0.17, recovery: 0.24 },
  lmg:     { dmgMult: 1.55, staminaCost: 12, range: 3.0, angleDeg: 90, knockback: 1.4,
             startup: 0.18, active: 0.19, recovery: 0.26 },
  flame:   { dmgMult: 1.10, staminaCost: 8,  range: 2.6, angleDeg: 80, knockback: 0.9,
             startup: 0.12, active: 0.14, recovery: 0.20 },
};

export function createPlayer(scene) {
  // Jointed player rig — shared with enemies. `body` below is aliased
  // to the rig's chest mesh so AI cover + hit raycasts still resolve to
  // the same target they always did (userData.isPlayer preserved).
  const rig = buildRig({
    scale: 0.77,          // ~1.85m character — matches world / weapon scale
    // All-dark operator palette. Head uses a dark hood/balaclava
    // colour so no skin shows; only the visor-like gear stripe on
    // the new sectional accents provides any contrast.
    bodyColor: 0x1c1e22,     // near-black jacket
    headColor: 0x141518,     // balaclava / hood
    legColor:  0x121317,     // dark pants
    armColor:  0x1a1c20,     // dark sleeves
    handColor: 0x0d0e10,     // black gloves
    gearColor: 0x2a2c30,     // subtle dark-grey plate/strap contrast
    bootColor: 0x0a0b0c,     // black boots
  });
  initAnim(rig);
  const group = rig.group;
  // Apply yaw before pitch so the roll somersault (rotation.x) happens
  // in the character's local frame — otherwise a rolling player facing
  // sideways would barrel-roll instead of tumble forward.
  group.rotation.order = 'YXZ';
  const leftLeg  = rig.leftLeg.thigh.mesh;
  const rightLeg = rig.rightLeg.thigh.mesh;
  const body     = rig.chestMesh;
  body.userData.isPlayer = true;   // AI raycast hit target (preserved)
  const head     = rig.headMesh;
  const leftArm  = rig.leftArm.shoulder.mesh;
  const rightArm = rig.rightArm.shoulder.mesh;

  // (Facing-direction cone nose removed — the head-yaw + weapon
  // orientation convey the facing direction clearly enough, and the
  // wedge was reading as a literal nose cone on the character.)

  // Character FBX overlay disabled pending proper recentering — the
  // animpic rig ships with internal transforms that plant the mesh at
  // its own origin, not the player's. Primitive body stays visible
  // until that's solved.

  // Gun body + muzzle anchor. The body is resized per-weapon via setWeapon();
  // the muzzle always sits at the front edge of the body so tracers emanate
  // from the visible barrel tip.
  const gunMat = new THREE.MeshStandardMaterial({
    color: 0x151515, roughness: 0.4, metalness: 0.6, emissive: 0x000000,
  });
  // Weapons are sized in raw tunable metres (e.g. muzzleLength=0.5 for
  // a rifle) but the character rig runs at rig.scale (0.77 ≈ 1.85m).
  // Scaling the weapon meshes by the same factor keeps guns in
  // proportion — otherwise a 0.5m rifle on a 1.85m character reads as
  // an SMG-on-a-giant.
  const WEAPON_SCALE = rig.scale || 1.0;

  const gunMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), gunMat);
  gunMesh.scale.setScalar(WEAPON_SCALE);
  gunMesh.castShadow = true;
  // Parent to the WRIST (not hand.pivot) so the weapon doesn't inherit
  // the grip-curl rotation the hand pivot uses to approximate closed
  // fingers around the grip. Rotating the weapon mount by the curl
  // (~0.95 rad) was tilting every gun into the floor. The wrist sits
  // at the end of the forearm and rotates with arm aim only.
  const handPivot = rig.rightArm.wrist;
  gunMesh.rotation.x = Math.PI / 2;
  gunMesh.position.set(0, -(0.1 + 0.25) * WEAPON_SCALE, 0);
  handPivot.add(gunMesh);

  // Per-class accessory bits (magazine / stock / scope) attached alongside
  // the main gun body. Inherits gunMesh.scale automatically (child-of-mesh).
  const weaponExtras = new THREE.Group();
  gunMesh.add(weaponExtras);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -(0.1 + 0.5) * WEAPON_SCALE, 0);
  handPivot.add(muzzle);

  // In-hand FBX weapon model — mirrors gunMesh's parent + orientation
  // so imported weapon art tracks the hand too. FBXes authored +Z
  // forward need the same 90° X-rotation to align with the arm axis.
  const inHandModel = new THREE.Group();
  inHandModel.scale.setScalar(WEAPON_SCALE);
  inHandModel.rotation.x = Math.PI / 2;
  inHandModel.position.copy(gunMesh.position);
  inHandModel.visible = false;
  handPivot.add(inHandModel);

  // Off-hand mount — used by akimbo dual-wield. Mirrors the dominant-
  // hand setup but parented to the LEFT wrist. Carries both a
  // primitive placeholder box AND an FBX clone group, so akimbo
  // weapons render with the same model the dominant hand uses
  // (pistols / SMGs) instead of a stub box.
  const offhandPivot = rig.leftArm.wrist;
  const offhandGunMat = new THREE.MeshStandardMaterial({
    color: 0x151515, roughness: 0.4, metalness: 0.6, emissive: 0x000000,
  });
  const offhandGunMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), offhandGunMat);
  offhandGunMesh.scale.setScalar(WEAPON_SCALE);
  offhandGunMesh.castShadow = true;
  offhandGunMesh.rotation.x = Math.PI / 2;
  offhandGunMesh.position.set(0, -(0.1 + 0.25) * WEAPON_SCALE, 0);
  offhandGunMesh.visible = false;
  offhandPivot.add(offhandGunMesh);
  const offhandInHandModel = new THREE.Group();
  offhandInHandModel.scale.setScalar(WEAPON_SCALE);
  offhandInHandModel.rotation.x = Math.PI / 2;
  offhandInHandModel.position.copy(offhandGunMesh.position);
  offhandInHandModel.visible = false;
  offhandPivot.add(offhandInHandModel);
  // Off-hand muzzle anchor — Object3D at the barrel tip on the left
  // weapon, used by main.js to spawn tracers from the correct hand
  // when akimbo's RMB fires weapon2. Tracker world position
  // surfaced via playerInfo.offhandMuzzleWorld each tick.
  const offhandMuzzle = new THREE.Object3D();
  offhandMuzzle.position.set(0, -(0.1 + 0.5) * WEAPON_SCALE, 0);
  offhandPivot.add(offhandMuzzle);
  // Per-clone cache for off-hand. Independent of the dominant-hand
  // cache so the same gun model can sit in both at once (akimbo with
  // the same weapon in both slots — duplicate item, separate clones).
  const _offhandCloneCache = new Map();
  let offhandLoadSerial = 0;

  function _clearOffhandModel() {
    for (const clone of _offhandCloneCache.values()) clone.visible = false;
    while (offhandInHandModel.children.length) {
      const c = offhandInHandModel.children[0];
      if (!_offhandCloneCache.has(c.userData?.modelUrl)) {
        offhandInHandModel.remove(c);
        c.traverse?.((o) => {
          o.geometry?.dispose?.();
          o.material?.dispose?.();
        });
      } else {
        offhandInHandModel.remove(c);
      }
    }
    // Re-parent cached clones (kept alive across swaps) — reverse the
    // detach we did above so the cache survives the visibility flip.
    for (const clone of _offhandCloneCache.values()) {
      offhandInHandModel.add(clone);
    }
  }

  function setOffhandWeapon(weapon) {
    if (!weapon) {
      offhandGunMesh.visible = false;
      offhandInHandModel.visible = false;
      _clearOffhandModel();
      state.offhandEquipped = null;
      return;
    }
    state.offhandEquipped = weapon;
    const len = weapon.muzzleLength || 0.4;
    const g = weapon.muzzleGirth || 0.10;
    offhandGunMesh.geometry.dispose();
    offhandGunMesh.geometry = new THREE.BoxGeometry(g, g, len);
    if (weapon.tracerColor != null) {
      offhandGunMat.emissive.setHex(weapon.tracerColor).multiplyScalar(0.15);
    }
    const ws = WEAPON_SCALE;
    offhandGunMesh.rotation.set(Math.PI / 2, 0, 0);
    offhandGunMesh.position.set(0, -(0.1 + len / 2) * ws, 0);
    offhandInHandModel.rotation.set(Math.PI / 2, 0, 0);
    offhandInHandModel.position.copy(offhandGunMesh.position);
    offhandMuzzle.position.set(0, -(0.1 + len) * ws, 0);
    // Show primitive immediately as placeholder; FBX swap below
    // hides it once the clone lands. Failures keep the primitive.
    _clearOffhandModel();
    offhandGunMesh.visible = true;
    offhandInHandModel.visible = false;

    const mySerial = ++offhandLoadSerial;
    const modelUrl = modelForItem(weapon);
    if (!modelUrl) return;
    const cached = _offhandCloneCache.get(modelUrl);
    if (cached) {
      cached.visible = true;
      offhandInHandModel.visible = true;
      offhandGunMesh.visible = false;
      return;
    }
    loadModelClone(modelUrl).then(clone => {
      if (!clone || mySerial !== offhandLoadSerial) return;
      const CLASS_SCALE = {
        pistol: 0.45, smg: 0.65, rifle: 0.75, shotgun: 0.75,
        lmg: 0.75, flame: 0.7, melee: 0.7,
      };
      const cs = CLASS_SCALE[weapon.class] ?? 0.9;
      fitToRadius(clone, len * cs * scaleForModelPath(modelUrl));
      const r = weapon.modelRotation;
      const rotOverride = rotationOverrideForModelPath(modelUrl);
      if (rotOverride) {
        clone.rotation.set(rotOverride.x || 0, rotOverride.y || 0, rotOverride.z || 0);
      } else if (r) {
        clone.rotation.set(r.x || 0, r.y || 0, r.z || 0);
      } else {
        clone.rotation.set(0, Math.PI / 2, 0);
      }
      // Off-hand uses the SAME mirror flip as the dominant hand —
      // the model is authored facing forward when shouldMirrorInHand
      // says so; the wrist anchor on the left arm carries the same
      // local-frame orientation as the right wrist (rig is symmetric),
      // so the same flip yields a forward-pointing barrel.
      if (shouldMirrorInHand(weapon)) clone.scale.x = -clone.scale.x;
      const gripOff = gripOffsetForModelPath(modelUrl);
      if (gripOff) {
        clone.position.set(gripOff.x || 0, gripOff.y || 0, gripOff.z || 0);
      }
      clone.userData.modelUrl = modelUrl;
      offhandInHandModel.add(clone);
      _offhandCloneCache.set(modelUrl, clone);
      offhandInHandModel.visible = true;
      offhandGunMesh.visible = false;
    }).catch(() => { /* swallow — primitive remains visible */ });
  }

  // Serial for each setWeapon call so a slow model load can't clobber
  // the weapon the player swapped to in the meantime.
  let weaponLoadSerial = 0;

  // Resolve the current dominant-side mount points. Called when the
  // weapon class or handedness changes. Shoulder anchor = stock mount
  // for shouldered long guns; hand anchor = grip mount for pistols,
  // SMGs, melee blades.
  function _handAnchor() {
    return state.handedness === 'right'
      ? rig.rightArm.wrist
      : rig.leftArm.wrist;
  }
  function _shoulderAnchor() {
    return state.handedness === 'right'
      ? rig.rightShoulderAnchor
      : rig.leftShoulderAnchor;
  }

  // Per-weapon clone cache. Weapon swaps used to dispose the FBX
  // hierarchy (geometry + materials per node) and then re-clone the
  // template for the new weapon — both operations traverse the entire
  // tree and stalled the main thread for a few frames on rifles /
  // shotguns. Now we hide-and-keep instead: each weapon's prepared
  // clone (rotated, scaled, positioned for the in-hand pivot) gets
  // cached by its key once and reused on every subsequent swap-back.
  // Melee primitives use the same map; their key is `melee:<name>`.
  const _weaponCloneCache = new Map();

  function clearInHandModel() {
    // Hide every cached clone instead of disposing. The prepared
    // clones stay parented to inHandModel so they survive across
    // swaps; we just toggle visibility. Anything not in the cache
    // (legacy direct-add path, defensive fallback) still gets
    // removed + disposed so we don't leak.
    const cached = new Set(_weaponCloneCache.values());
    for (let i = inHandModel.children.length - 1; i >= 0; i--) {
      const c = inHandModel.children[i];
      if (cached.has(c)) {
        c.visible = false;
        continue;
      }
      inHandModel.remove(c);
      c.traverse?.(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
    }
  }

  function clearExtras() {
    while (weaponExtras.children.length) {
      const c = weaponExtras.children[0];
      weaponExtras.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
  }

  function addExtra(w, h, d, x, y, z, color) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.3 }),
    );
    m.position.set(x, y, z);
    m.castShadow = true;
    weaponExtras.add(m);
    return m;
  }

  function buildAccessories(weapon) {
    clearExtras();
    const cls = weapon.class || (weapon.type === 'melee' ? 'melee' : 'pistol');
    const g = weapon.muzzleGirth ?? 0.12;
    const len = weapon.muzzleLength ?? 0.5;
    if (cls === 'melee') return;
    // Magazine under the body (all ranged).
    addExtra(g * 1.1, g * 1.8, g * 1.2, 0, -g * 1.0, -len * 0.15, 0x2a2018);
    // Stock behind (rifles / SMGs / shotguns / LMG / flame).
    if (cls === 'rifle' || cls === 'smg' || cls === 'shotgun' || cls === 'lmg' || cls === 'flame') {
      addExtra(g * 0.9, g * 0.9, len * 0.45, 0, 0, -(len * 0.4), 0x222024);
    }
    // Top rail / scope stub (rifles + LMG + SMG).
    if (cls === 'rifle' || cls === 'lmg' || cls === 'smg') {
      addExtra(g * 0.6, g * 0.5, len * 0.35, 0, g * 0.85, -len * 0.1, 0x1a1d24);
    }
    // Pistol gets a slight rail bump on top.
    if (cls === 'pistol') {
      addExtra(g * 0.5, g * 0.3, len * 0.4, 0, g * 0.7, 0, 0x202226);
    }
    // Shotgun / LMG get a larger / wider barrel.
    if (cls === 'shotgun') {
      addExtra(g * 1.3, g * 1.3, len * 0.45, 0, 0, len * 0.18, 0x2c2f36);
    }
  }

  function setWeapon(weapon) {
    state.equipped = weapon;
    const len = weapon.muzzleLength;
    const g = weapon.muzzleGirth;
    gunMesh.geometry.dispose();
    gunMesh.geometry = new THREE.BoxGeometry(g, g, len);
    gunMat.emissive.setHex(weapon.tracerColor).multiplyScalar(0.15);

    // Rifles / shotguns / LMGs / snipers mount against the dominant
    // shoulder (stock cheek-welded to the collarbone, barrel past
    // both hands). Pistols, SMGs, flame, melee stay in the hand.
    const cls = weapon.class;
    const isShouldered = cls === 'rifle' || cls === 'shotgun'
      || cls === 'lmg' || cls === 'sniper';
    const anchor = isShouldered ? _shoulderAnchor() : _handAnchor();
    if (gunMesh.parent !== anchor) anchor.add(gunMesh);
    if (muzzle.parent  !== anchor) anchor.add(muzzle);
    if (inHandModel.parent !== anchor) anchor.add(inHandModel);

    const ws = WEAPON_SCALE;
    if (isShouldered) {
      // Chest-local forward is +Z (no axis swap needed). Stock sits at
      // anchor, barrel extends forward by `len`.
      gunMesh.rotation.set(0, 0, 0);
      inHandModel.rotation.set(0, 0, 0);
      gunMesh.position.set(0, 0, (0.1 + len / 2) * ws);
      muzzle.position.set(0, 0, (0.1 + len) * ws);
      inHandModel.position.copy(gunMesh.position);
    } else {
      // Hand-local forward is -Y (thanks to the cumulative arm rot).
      // Align the box length with -Y by rotating 90° around X.
      gunMesh.rotation.set(Math.PI / 2, 0, 0);
      inHandModel.rotation.set(Math.PI / 2, 0, 0);
      gunMesh.position.set(0, -(0.1 + len / 2) * ws, 0);
      muzzle.position.set(0, -(0.1 + len) * ws, 0);
      inHandModel.position.copy(gunMesh.position);
    }
    buildAccessories(weapon);
    state.blocking = false;

    // Kick off the in-hand FBX swap. Primitive gunMesh + extras stay
    // visible as a placeholder while the model loads, then hide once
    // the FBX lands. Load failures keep the primitive forever.
    //
    // Melee weapons skip the FBX path entirely — the imported melee
    // models never aligned cleanly with the hand pivot (handle floating,
    // blade pointing the wrong way) so we build a procedural primitive
    // instead. melee_primitives.js dispatches on weapon name and uses
    // tracerColor + muzzleLength + muzzleGirth from the tunable so each
    // weapon's silhouette tracks its description.
    const mySerial = ++weaponLoadSerial;
    clearInHandModel();
    inHandModel.visible = false;
    gunMesh.visible = true;
    weaponExtras.visible = true;
    if (weapon.type === 'melee') {
      const meleeKey = `melee:${weapon.name}`;
      let prim = _weaponCloneCache.get(meleeKey);
      if (!prim) {
        prim = buildMeleePrimitive(weapon);
        _weaponCloneCache.set(meleeKey, prim);
        inHandModel.add(prim);
      }
      prim.visible = true;
      inHandModel.visible = true;
      gunMesh.visible = false;
      weaponExtras.visible = false;
      window.__activeWeaponClone = prim;
      window.__activeWeaponUrl = `(primitive) ${weapon.name}`;
      state.parryT = 0;
      return;
    }
    const modelUrl = modelForItem(weapon);
    if (modelUrl) {
      // Cache hit — reuse the prepared clone, no work needed.
      const cached = _weaponCloneCache.get(modelUrl);
      if (cached) {
        cached.visible = true;
        window.__activeWeaponClone = cached;
        window.__activeWeaponUrl = modelUrl;
        inHandModel.visible = true;
        gunMesh.visible = false;
        weaponExtras.visible = false;
        state.parryT = 0;
        return;
      }
      loadModelClone(modelUrl).then(clone => {
        if (!clone || mySerial !== weaponLoadSerial) return;
        // Size per weapon class. `muzzleLength` on the tunables doesn't
        // reflect real-world proportions (rifles are only ~1.8× pistol
        // muzzleLength in data, vs. ~5× IRL), so a flat multiplier
        // makes pistols oversized. Rifle/lmg/shotgun/sniper at 0.9×
        // muzzleLength radius reads right; pistols and SMGs need less.
        // Per-class fit radius multipliers. Previous halving produced
        // pistols so small they vanished into the fist; these values
        // sit between the old (pre-scale) numbers and the halved pass.
        const CLASS_SCALE = {
          pistol: 0.45,
          smg:    0.65,
          rifle:  0.75,
          shotgun:0.75,
          lmg:    0.75,
          flame:  0.7,
          melee:  0.7,
        };
        const cs = CLASS_SCALE[weapon.class] ?? 0.9;
        // Pack-based size correction on top of the class fit —
        // animpic and lowpoly packs were authored at different
        // baseline scales; per-FBX overrides catch outliers like
        // Makarov (too big) and P90 (too small).
        fitToRadius(clone, len * cs * scaleForModelPath(modelUrl));
        // Animpic weapons are authored pointing along -X in their local
        // frame, so a +90° yaw points the barrel along +Z (aim axis).
        // Per-weapon modelRotation on the tunable overrides, then a
        // per-FBX override wins over both (lets a single model with an
        // off-standard axis be corrected without duplicating tunables).
        const r = weapon.modelRotation;
        const rotOverride = rotationOverrideForModelPath(modelUrl);
        if (rotOverride) {
          clone.rotation.set(rotOverride.x || 0, rotOverride.y || 0, rotOverride.z || 0);
        } else if (r) {
          clone.rotation.set(r.x || 0, r.y || 0, r.z || 0);
        } else {
          clone.rotation.set(0, Math.PI / 2, 0);
        }
        // In-hand mirror: most MIRROR_X_BY_NAME weapons need it
        // here too. AS VAL + VSS are excluded — see
        // IN_HAND_MIRROR_EXCLUDE in model_manifest.
        if (shouldMirrorInHand(weapon)) clone.scale.x = -clone.scale.x;
        inHandModel.add(clone);
        // Keep inHandModel at the box position (set in setWeapon's
        // branch above) so the FBX lands exactly where the primitive
        // placeholder was. Clone sits at inHandModel origin — the
        // box's own center-of-mass matches the weapon's visual center.
        clone.position.set(0, 0, 0);
        const gripOff = gripOffsetForModelPath(modelUrl);
        if (gripOff) {
          clone.position.set(gripOff.x || 0, gripOff.y || 0, gripOff.z || 0);
        }
        // Cache the prepared clone so subsequent swaps to this same
        // weapon URL are zero-work (just visibility toggles in the
        // hide-and-keep clearInHandModel above).
        _weaponCloneCache.set(modelUrl, clone);
        // Expose the active clone for live tuning — see
        // __debug.tuneWeapon / __debug.inspectWeapon in main.js.
        window.__activeWeaponClone = clone;
        window.__activeWeaponUrl = modelUrl;
        inHandModel.visible = true;
        gunMesh.visible = false;
        weaponExtras.visible = false;
      });
    }
    state.parryT = 0;
  }

  scene.add(group);

  // Warm ground-spill around the player — a PointLight planted AT
  // floor level so it illuminates the floor + nearby wall bases
  // without lighting the character (or the camera-facing air,
  // which is what was blowing out in bloom). Keeps the "I have a
  // presence" feel from the splash art without the glare.
  const auraLight = new THREE.PointLight(
    tunables.lighting?.playerAuraColor ?? 0xffb070,
    tunables.lighting?.playerAuraIntensity ?? 0.7,
    tunables.lighting?.playerAuraDistance ?? 4.0,
    tunables.lighting?.playerAuraDecay ?? 1.8,
  );
  auraLight.position.set(0, 0.08, 0);   // ground level under the character
  group.add(auraLight);
  // Keep a handle on it so `syncLighting()` in main.js can update
  // intensity / color / distance live from the tunables panel.
  group.userData.auraLight = auraLight;

  const velocity = new THREE.Vector3();
  const facing = new THREE.Vector3(0, 0, 1);

  const state = {
    mode: MODE.GROUND,
    modeT: 0,            // time in current mode
    yVel: 0,
    airborne: false,

    dashCd: 0,
    rollCd: 0,
    dashDir: new THREE.Vector3(),
    rollDir: new THREE.Vector3(),

    crouched: false,
    crouchSprinting: false,
    sprinting: false,

    // Shooting shoulder — 'right' or 'left'. Q toggles this so players
    // can peek around corners from either side. The gun mesh re-parents
    // to the matching rig hand when it flips.
    handedness: 'right',

    adsAmount: 0,        // 0..1 easing for camera/zoom
    iFrames: 0,

    health: tunables.player.maxHealth,
    maxHealth: tunables.player.maxHealth,
    // regenCap is the ceiling natural regen can restore to. Damage cuts it
    // by a fraction (regenLossFactor); only healing items raise it back.
    regenCap: tunables.player.maxHealth,
    regenT: 0,
    // Status effects — bleed damages current HP only; brokenBones damages
    // both current HP and the regen cap while active.
    bleedT: 0,
    brokenT: 0,
    hitFlashT: 0,
    // Derived stats applied each frame from main (skills + gear).
    moveSpeedMult: 1,
    healthRegenMult: 1,
    healthRegenDelayBonus: 0,
    staminaRegenMult: 1,
    dmgReduction: 0,

    // Stamina — spent on dodge, combo steps, block drain, parry, deflect.
    stamina: tunables.stamina.max,
    maxStamina: tunables.stamina.max,
    staminaRegenT: 0,

    // Combo attack state. Separate from movement modes so normal ground
    // control still runs during the `window` phase.
    attack: {
      phase: 'idle',     // 'idle' | 'startup' | 'active' | 'recovery' | 'window'
      weapon: null,
      step: 0,
      current: null,
      phaseT: 0,
      facing: new THREE.Vector3(),
      advanceSpeed: 0,
      firedActive: false,
    },

    // Block + parry.
    equipped: null,       // set via setWeapon
    blocking: false,
    parryT: 0,            // remaining parry-active time
  };

  // Hit-flash baseline. Was hardcoded to 0xbfa77a (tan), which the
  // per-frame flash lerp at the bottom of update() copies onto the
  // body material every tick — overwriting the dark operator color
  // set in buildRig. That's why playtest reports of 'body looks
  // bright tan' kept coming back even after the noir grade was
  // dialled. Now reads the actual current bodyMat color so the lerp
  // restores TO whatever color the rig is configured with (handles
  // operator/marine style toggles too).
  const baseBodyColor = rig.materials.bodyMat.color.clone();
  const hurtColor = new THREE.Color(0xff5050);

  function cancelCombo() {
    const a = state.attack;
    a.phase = 'idle';
    a.weapon = null;
    a.step = 0;
    a.current = null;
    a.phaseT = 0;
    a.advanceSpeed = 0;
    a.firedActive = false;
  }

  function consumeStamina(amount, kind) {
    // Battle Trance / mastery rebates lower the cost of melee attacks
    // and parries. `kind` is an optional tag — 'melee' covers swings,
    // combos, parry, deflect; other kinds bypass the melee multiplier.
    // Carbon Cycle (relic) applies a flat multiplier to every kind.
    // Self-heal: if any prior path corrupted stamina to NaN/Infinity
    // (level-up pause + a multi-frame race could land here with a
    // bad staminaRegenMult), recover to full so the player isn't
    // stuck with infinite actions.
    if (!Number.isFinite(state.stamina)) state.stamina = state.maxStamina ?? tunables.stamina.max;
    let cost = amount;
    if (kind === 'melee' && Number.isFinite(state.meleeStaminaMult) && state.meleeStaminaMult < 1) {
      cost = cost * state.meleeStaminaMult;
    }
    const scm = state.staminaCostMult;
    if (Number.isFinite(scm) && scm !== 1) {
      cost = cost * scm;
    }
    cost = Math.max(1, Math.round(cost));
    if (state.stamina < cost) return false;
    state.stamina -= cost;
    state.staminaRegenT = tunables.stamina.regenDelay;
    return true;
  }
  // Refund stamina on demand — used by the melee Battle Trance capstone
  // when a kill is registered. Caps at maxStamina so we never overflow.
  function refundStamina(amount) {
    if (!(amount > 0)) return;
    state.stamina = Math.min(state.maxStamina ?? state.stamina, state.stamina + amount);
  }

  function canAct() {
    return state.stamina >= tunables.stamina.minToAct;
  }

  // LMB with a melee weapon equipped. Supports:
  //  - fresh combo start from idle
  //  - chain in `window` phase
  //  - *branch* (interrupt) during startup/active/recovery of any step EXCEPT
  //    the final one, which commits
  // Returns true if the attack started (click consumed).
  function tryMeleeAttack(weapon, cursorDistance, facingDir) {
    const a = state.attack;

    let nextStep;
    if (a.phase === 'idle') {
      nextStep = 0;
    } else if (a.phase === 'window' && a.weapon === weapon) {
      nextStep = a.step + 1;
      if (nextStep >= weapon.combo.length) nextStep = 0;
    } else if ((a.phase === 'startup' || a.phase === 'active' || a.phase === 'recovery')
      && a.weapon === weapon) {
      // Branch — chain to next step. Final step now wraps back to
      // step 0 instead of locking the player into the finisher's
      // recovery; gives combat freedom without breaking the
      // committed-finisher feel (the player paid for the heavy
      // step's startup + active, they just don't sit through the
      // entire wind-down before swinging again).
      nextStep = (a.step + 1) % weapon.combo.length;
    } else {
      return false;
    }

    const cost = tunables.stamina.comboCosts[nextStep] ?? 10;
    if (!consumeStamina(cost, 'melee')) return false;

    const variantKey = cursorDistance >= (weapon.meleeThreshold ?? 3.0) ? 'far' : 'close';
    const step = weapon.combo[nextStep];
    const attack = step[variantKey];

    a.weapon = weapon;
    a.step = nextStep;
    a.current = attack;
    a.phase = 'startup';
    a.phaseT = attack.startup;
    a.facing.copy(facingDir).setY(0);
    if (a.facing.lengthSq() > 0.0001) a.facing.normalize();
    else a.facing.set(0, 0, 1);
    a.advanceSpeed = attack.advance / Math.max(0.01, attack.active);
    a.firedActive = false;
    // Pick a swing style — random for variety, but a crit overrides
    // with a dedicated "critical" style that the rig reads to throw a
    // bigger whole-body strike. Style is locked for this swing so the
    // wind-up and follow-through match.
    a.isCrit = Math.random() < (state.critChance || 0);
    if (a.isCrit) {
      a.style = 'critical';
    } else {
      const styles = ['horizontal', 'overhead', 'thrust'];
      a.style = styles[Math.floor(Math.random() * styles.length)];
    }
    state.blocking = false;  // block breaks on attack
    state.parryT = 0;
    return true;
  }

  // Quick melee off a gun: pistol-whip / rifle-butt. Builds a one-
  // off attack step on the fly from the held gun's stats so the
  // swing reads, animates, and draws its weapon-tip trail identically
  // to a proper melee combo — the only difference is damage and
  // swing speed scale with the gun's "size" (class). Small / fast
  // guns → quick jab; big / slow guns → heavy butt-smash.
  //
  // No combo chaining (unlike tryMeleeAttack): each press is a single
  // standalone swing. Stamina cost is also smaller since the strike
  // doesn't drop your weapon.
  function tryQuickMelee(gunWeapon, facingDir) {
    if (!gunWeapon || gunWeapon.type !== 'ranged') return false;
    const a = state.attack;
    if (a.phase !== 'idle' && a.phase !== 'window') return false;
    // Class-based timing. Small guns swing fast, big guns swing slow
    // — startup + recovery scale so the whole swing takes more real
    // time, and `active` (when damage lands) grows proportionally.
    // Damage baseline is 25% of per-shot gun damage, scaled further
    // by class so pistols don't land as hard as rifle-butts.
    const cls = gunWeapon.class || 'rifle';
    const profile = QUICK_MELEE_BY_CLASS[cls] || QUICK_MELEE_BY_CLASS.rifle;
    const baseDmg = (gunWeapon.damage || 20) * 0.25 * profile.dmgMult;
    const cost = profile.staminaCost;
    if (!consumeStamina(cost, 'melee')) return false;
    const attack = {
      damage: baseDmg,
      range: profile.range,
      angleDeg: profile.angleDeg,
      knockback: profile.knockback,
      startup: profile.startup,
      active: profile.active,
      recovery: profile.recovery,
      window: 0.20,              // short tail so the next shot isn't held up
      advance: 0.0,              // no forward lunge on a gun-swing
      zone: 'torso',
    };
    a.weapon = null;             // sentinel — no combo chaining
    a.step = 0;
    a.current = attack;
    a.phase = 'startup';
    a.phaseT = attack.startup;
    a.facing.copy(facingDir).setY(0);
    if (a.facing.lengthSq() > 0.0001) a.facing.normalize();
    else a.facing.set(0, 0, 1);
    a.advanceSpeed = 0;
    a.firedActive = false;
    a.isCrit = Math.random() < (state.critChance || 0);
    if (a.isCrit) {
      a.style = 'critical';
    } else {
      // Most quick-melees read as horizontal sideways strikes (the
      // classic pistol-whip); occasional overhead or thrust for
      // variety.
      const styles = ['horizontal', 'horizontal', 'overhead', 'thrust'];
      a.style = styles[Math.floor(Math.random() * styles.length)];
    }
    state.blocking = false;
    state.parryT = 0;
    return true;
  }

  function tryParry() {
    if (!state.blocking) return false;
    if (!consumeStamina(tunables.stamina.parryCost, 'melee')) return false;
    state.parryT = tunables.block.parryWindow;
    return true;
  }

  function isBlocking() { return state.blocking; }
  function isParryActive() { return state.parryT > 0; }

  function takeDamage(amount) {
    if (state.iFrames > 0) return 0;
    const reduced = amount * (1 - Math.min(0.9, state.dmgReduction || 0));
    const dealt = Math.min(state.health, reduced);
    state.health -= dealt;
    // A fraction of each hit locks out of natural regen — only healing
    // items raise regenCap back toward the hard max. Innocent Heart
    // (artifact) suspends this entirely so the player can always
    // regen back to full.
    if (!state.regenCapImmune) {
      const lossFactor = tunables.player.regenLossFactor ?? 0.5;
      state.regenCap = Math.max(state.health, state.regenCap - reduced * lossFactor);
    }
    state.regenT = Math.max(0.1, tunables.player.regenDelay + (state.healthRegenDelayBonus || 0));
    state.hitFlashT = tunables.player.hitFlashTime;
    if (state.health <= 0) {
      state.health = 0;
      velocity.set(0, 0, 0);
    }
    return dealt;
  }

  // Coop downed flag — read by movement / fire / consumeStamina paths
  // to early-out so the player can't act while down. Visuals (rig
  // collapse, opacity dim) hook off this in the HUD render layer.
  function applyDownedState(on) {
    state.downed = !!on;
    if (on) {
      // Pin health at a sliver above zero so death detection elsewhere
      // doesn't re-fire each frame. Bleedout is tracked separately.
      state.health = 1;
      velocity.set(0, 0, 0);
      state.airborne = false;
      state.blocking = false;
    }
  }
  // Revive helper — restore HP to a fraction of max (defib uses 1.0
  // for a full-HP res). Clears the downed flag side effects.
  function restoreHealthPct(pct = 0.30) {
    state.health = Math.max(1, Math.round(state.maxHealth * Math.max(0.05, Math.min(1, pct))));
    state.regenCap = Math.max(state.health, state.regenCap);
    state.regenT = 0;
    state.staminaRegenT = 0;
    state.bleedT = 0;
    state.brokenT = 0;
    state.downed = false;
  }

  function restoreFullHealth() {
    state.health = state.maxHealth;
    state.regenCap = state.maxHealth;
    state.stamina = state.maxStamina;
    state.regenT = 0;
    state.staminaRegenT = 0;
    state.bleedT = 0;
    state.brokenT = 0;
  }

  // Apply bleed or broken-bone status with a duration (seconds).
  function applyStatus(kind, duration) {
    if (kind === 'bleed') state.bleedT = Math.max(state.bleedT, duration);
    else if (kind === 'broken') state.brokenT = Math.max(state.brokenT, duration);
  }

  // Heal raises both current HP and the regen cap — healing items are the
  // only way to lift the locked "unregenerable" portion of the HP bar.
  // `opts.cures` is a string array of status ids to clear ('bleed', 'broken').
  function heal(amount, opts = {}) {
    state.regenCap = Math.min(state.maxHealth, state.regenCap + amount);
    state.health = Math.min(state.regenCap, state.health + amount);
    if (opts.cures?.includes('bleed')) state.bleedT = 0;
    if (opts.cures?.includes('broken')) state.brokenT = 0;
  }

  function wishDirFromInput(move) {
    const d = new THREE.Vector3();
    if (move.y !== 0) d.addScaledVector(FORWARD, move.y);
    if (move.x !== 0) d.addScaledVector(RIGHT, move.x);
    if (d.lengthSq() > 1) d.normalize();
    return d;
  }

  function startDash(dir) {
    if (state.dashCd > 0) return false;
    if (!consumeStamina(tunables.stamina.dodgeCost)) return false;
    const d = dir.lengthSq() > 0.001 ? dir.clone().normalize() : facing.clone();
    state.mode = MODE.DASH;
    state.modeT = 0;
    state.dashDir.copy(d);
    state.dashCd = tunables.dash.cooldown;
    state.iFrames = tunables.dash.iFrames;
    state.dashStartedEvent = true;   // picked up by main.js for shake/FOV
    cancelCombo();               // dodge always cancels in-progress attacks
    state.blocking = false;
    state.parryT = 0;
    return true;
  }

  function startRoll(_dir) {
    // Roll is disabled — the hip-pivot tumble was launching the player
    // across the map in some cases. Leaving the entry point wired so
    // the input callsites compile but always short-circuiting to a
    // no-op until the motion is redesigned.
    return false;
  }

  function startSlide(_dir) {
    // Slide disabled — crouch-running would auto-trigger it above a
    // certain speed, which felt like a lurch the player didn't ask
    // for. Leaving the entry wired so callers still compile, but
    // it's a no-op until the motion is redesigned.
    return;
  }

  function endToGround() {
    state.mode = MODE.GROUND;
    state.modeT = 0;
  }

  function applyDerivedStats(s) {
    // Compose player-facing fields from the per-frame stats bag so takeDamage,
    // regen, and movement all share one source of truth.
    // Floor of 1 (not 10) so The Gift's sacrifice can drop max past
    // the normal min. Main.js already clamps the bonus so the
    // resulting max can never go below 1.
    // Defensive coerce — any of these multipliers landing as NaN/Infinity
    // would propagate to state.stamina via consume / regen and break the
    // game. Always fall back to the safe default.
    const _num = (v, dflt) => (Number.isFinite(v) ? v : dflt);
    state.maxHealth = Math.max(1, tunables.player.maxHealth + _num(s.maxHealthBonus, 0));
    state.maxStamina = Math.max(10, tunables.stamina.max + _num(s.maxStaminaBonus, 0));
    state.moveSpeedMult = _num(s.moveSpeedMult, 1);
    state.crouchMoveBonus = _num(s.crouchMoveBonus, 1);
    state.healthRegenMult = _num(s.healthRegenMult, 1);
    state.healthRegenDelayBonus = _num(s.healthRegenDelayBonus, 0);
    state.staminaRegenMult = _num(s.staminaRegenMult, 1);
    state.dmgReduction = s.dmgReduction || 0;
    // Encounter-artifact flags. Innocent Heart suspends the
    // damage-shrinks-regen-cap rule; Unused Rocket Ticket scales
    // dash velocity (and so distance) by the multiplier.
    state.regenCapImmune  = !!s.regenCapImmune;
    state.dashDistanceMult = s.dashDistanceMult || 1;
    // Battle Trance — feeds consumeStamina('melee', ...) to halve the
    // cost of swings, parries, and quick-melee.
    state.meleeStaminaMult = s.meleeStaminaMult ?? 1;
    // Carbon Cycle relic — flat multiplier on EVERY stamina drain
    // (dodge, block, melee). Stacks multiplicatively with melee mult.
    state.staminaCostMult = s.staminaCostMult ?? 1;
    // Sniper Lung Drag — speeds up ADS easing.
    state.adsSpeedMult = s.adsSpeedMult ?? 1;
    // Sway dampener (currently consumed by AI sway emulation when the
    // player has the perk; sniper sway baseline is implicit in the
    // existing aim-jitter pipeline).
    state.swayMult = s.swayMult ?? 1;
    // Melee reads these at swing start to decide whether to roll the
    // special crit animation + damage bump.
    state.critChance = s.critChance || 0;
    state.critDamageMult = s.critDamageMult || 2.0;
    // Backpedal relief (0..1) — how much of the shooting-while-moving-
    // away speed penalty the player's skills have bought back. 0 =
    // full penalty (60% walk / 50% dash), 1 = no penalty.
    state.backpedalRelief = Math.max(0, Math.min(1, s.backpedalRelief || 0));
    // Clamp current pools to new caps (don't auto-heal beyond the bonus).
    if (state.health > state.maxHealth) state.health = state.maxHealth;
    if (state.stamina > state.maxStamina) state.stamina = state.maxStamina;
    if (state.regenCap > state.maxHealth) state.regenCap = state.maxHealth;
    // If the max bumped upward, widen the regen cap to match so the player
    // feels the change immediately rather than only after a heal.
    state.regenCap = Math.max(state.health, Math.min(state.maxHealth, state.regenCap));
  }

  function update(dt, input, aimPoint, resolveCollision) {
    // Clear one-shot event flags from the prior frame before input
    // processing (which may set them again via startDash etc.).
    state.dashStartedEvent = false;
    state.rollStartedEvent = false;
    state.slideStartedEvent = false;
    // Coop downed — player can't move, fire, dash, jump, etc. We
    // still tick a few timers (iFrames, hitFlash) above so a revived
    // player isn't stuck with stale flags. Just early-out before
    // input dispatch.
    if (state.downed) return;
    // Cooldowns and timers tick regardless of mode.
    state.dashCd = Math.max(0, state.dashCd - dt);
    state.rollCd = Math.max(0, state.rollCd - dt);
    state.iFrames = Math.max(0, state.iFrames - dt);
    state.hitFlashT = Math.max(0, state.hitFlashT - dt);
    state.modeT += dt;

    // Advance the combo state machine first so we know whether movement is
    // locked for the rest of this frame.
    let attackEvent = null;
    const a = state.attack;
    if (a.phase !== 'idle') {
      a.phaseT -= dt;
      if (a.phase === 'startup' && a.phaseT <= 0) {
        a.phase = 'active';
        a.phaseT = a.current.active;
        a.firedActive = false;
      }
      if (a.phase === 'active' && !a.firedActive) {
        a.firedActive = true;
        attackEvent = {
          attack: a.current,
          step: a.step,
          // Read by main.resolveComboHit's per-weapon finisher hooks
          // (e.g. heavy-weapon AoE stagger fires on the last step
          // only). a.weapon is the active combo's weapon; we read
          // .combo.length defensively in case a weapon swap mid-
          // attack ever happens.
          isFinalStep: !!(a.weapon && a.weapon.combo
            && a.step === a.weapon.combo.length - 1),
          facing: a.facing.clone(),
          origin: new THREE.Vector3(group.position.x, 1.1, group.position.z),
          isCrit: !!a.isCrit,
          style: a.style || 'horizontal',
        };
      }
      if (a.phase === 'active' && a.phaseT <= 0) {
        a.phase = 'recovery';
        a.phaseT = a.current.recovery;
      }
      if (a.phase === 'recovery' && a.phaseT <= 0) {
        a.phase = 'window';
        a.phaseT = a.current.window;
      }
      if (a.phase === 'window' && a.phaseT <= 0) {
        cancelCombo();
      }
    }
    const attackLocked =
      a.phase === 'startup' || a.phase === 'active' || a.phase === 'recovery';

    // Status effects — bleed chips at current HP only; broken bones chip
    // at both current HP and the regen cap until treated.
    if (state.bleedT > 0) {
      state.bleedT = Math.max(0, state.bleedT - dt);
      const dps = tunables.status?.bleedDps ?? 3;
      state.health = Math.max(0, state.health - dps * dt);
      if (state.health <= 0) velocity.set(0, 0, 0);
    }
    if (state.brokenT > 0) {
      state.brokenT = Math.max(0, state.brokenT - dt);
      const dps = tunables.status?.brokenDps ?? 2;
      const capDps = tunables.status?.brokenCapDps ?? 1.2;
      state.health = Math.max(0, state.health - dps * dt);
      state.regenCap = Math.max(state.health, state.regenCap - capDps * dt);
      if (state.health <= 0) velocity.set(0, 0, 0);
    }

    // Health regen: tick down delay, then regen up to regenCap only.
    if (state.regenT > 0) state.regenT = Math.max(0, state.regenT - dt);
    else if (state.health < state.regenCap) {
      state.health = Math.min(
        state.regenCap,
        state.health + tunables.player.regenRate * state.healthRegenMult * dt,
      );
    }

    // Stamina regen — same pattern as health. Defensive: if a derived
    // multiplier landed as NaN/Infinity (corruption observed after
    // level-up pause), reset to 1 before the multiply so the regen
    // tick can't propagate NaN into state.stamina.
    if (!Number.isFinite(state.staminaRegenMult)) state.staminaRegenMult = 1;
    if (!Number.isFinite(state.maxStamina)) state.maxStamina = tunables.stamina.max;
    if (!Number.isFinite(state.stamina)) state.stamina = state.maxStamina;
    if (state.staminaRegenT > 0) state.staminaRegenT = Math.max(0, state.staminaRegenT - dt);
    else if (state.stamina < state.maxStamina) {
      state.stamina = Math.min(
        state.maxStamina,
        state.stamina + tunables.stamina.regenRate * state.staminaRegenMult * dt,
      );
    }

    // Parry window countdown.
    if (state.parryT > 0) state.parryT = Math.max(0, state.parryT - dt);

    // Block — only valid with a melee weapon equipped, while
    // grounded, with stamina available. Block input during the
    // RECOVERY phase of an in-progress swing cancels the swing's
    // wind-down so the player gets a defensive escape mid-combo.
    // Startup + active stay committed (the strike already happened
    // / is happening; canceling there would be swing-cheese).
    const wantsBlockRaw = input.adsHeld
      && state.equipped?.type === 'melee'
      && state.mode === MODE.GROUND
      && !state.airborne;
    if (wantsBlockRaw && a.phase === 'recovery') {
      cancelCombo();
    }
    const wantsBlock = wantsBlockRaw
      && a.phase !== 'startup'
      && a.phase !== 'active';
    if (wantsBlock && state.stamina > 0) {
      state.blocking = true;
    } else {
      state.blocking = false;
      state.parryT = 0;
    }
    if (state.blocking) {
      // Carbon Cycle relic — block drain pays the same staminaCostMult.
      const scm = Number.isFinite(state.staminaCostMult) ? state.staminaCostMult : 1;
      const drain = tunables.stamina.blockDrainRate * scm * dt;
      state.stamina = Math.max(0, state.stamina - drain);
      state.staminaRegenT = tunables.stamina.regenDelay;
      if (state.stamina <= 0) state.blocking = false;
    }

    // Facing: the lower body (hips/legs, carried on group.rotation.y)
    // tracks MOVEMENT direction. The upper body rotates toward the
    // cursor via a chest-twist delta passed into the rig. When the
    // twist exceeds MAX_BODY_TWIST (±90°) the body is dragged along
    // so the upper body can't spin more than that off the hips.
    //
    // Melee attacks still snap the body to the swing direction so the
    // chain of startup/active/recovery reads as a committed strike.
    const MAX_BODY_TWIST = Math.PI / 2;
    const BODY_YAW_LERP = 8;
    if (state.bodyYaw === undefined) state.bodyYaw = group.rotation.y;
    const wrapPi = (ang) => Math.atan2(Math.sin(ang), Math.cos(ang));

    // Absolute world aim yaw (from cursor). Falls back to body yaw if
    // no aim target so chest twist goes to zero.
    let aimYaw = state.bodyYaw;
    if (aimPoint) {
      const dx = aimPoint.x - group.position.x;
      const dz = aimPoint.z - group.position.z;
      if (dx * dx + dz * dz > 0.0001) {
        aimYaw = Math.atan2(dx, dz);
      }
    }

    if (state.mode === MODE.ROLL) {
      // Roll freezes the facing direction — startRoll already snapped
      // bodyYaw to the roll heading; the tumble isn't steerable.
      facing.set(Math.sin(state.bodyYaw), 0, Math.cos(state.bodyYaw));
    } else if (attackLocked) {
      // Attack snap — body aligns with the swing direction and holds.
      facing.copy(a.facing);
      state.bodyYaw = Math.atan2(facing.x, facing.z);
    } else {
      // Pick the target body yaw from movement direction; idle keeps
      // the current yaw (character holds pose while strafing-aim).
      let targetBodyYaw = state.bodyYaw;
      const moveWish = wishDirFromInput(input.move);
      if (moveWish.lengthSq() > 0.02) {
        targetBodyYaw = Math.atan2(moveWish.x, moveWish.z);
      }
      // Twist constraint: if aim is >90° off body, push body toward
      // aim by the overflow so the upper body can't exceed the limit.
      const twistWant = wrapPi(aimYaw - targetBodyYaw);
      if (Math.abs(twistWant) > MAX_BODY_TWIST) {
        const overflow = twistWant - Math.sign(twistWant) * MAX_BODY_TWIST;
        targetBodyYaw = wrapPi(targetBodyYaw + overflow);
      }
      // Shortest-arc lerp toward targetBodyYaw.
      const kBody = 1 - Math.exp(-BODY_YAW_LERP * dt);
      const dBody = wrapPi(targetBodyYaw - state.bodyYaw);
      state.bodyYaw = wrapPi(state.bodyYaw + dBody * kBody);
      // Keep `facing` in sync for callers that read the forward vector.
      facing.set(Math.sin(state.bodyYaw), 0, Math.cos(state.bodyYaw));
    }
    group.rotation.y = state.bodyYaw;
    // Chest twist delta (aim relative to body), clamped defensively.
    // Rolling freezes the twist so the body reads as fully committed
    // to the tumble rather than wobbling toward the cursor.
    state.chestTwist = state.mode === MODE.ROLL
      ? 0
      : Math.max(-MAX_BODY_TWIST,
          Math.min(MAX_BODY_TWIST, wrapPi(aimYaw - state.bodyYaw)));

    const wish = attackLocked
      ? new THREE.Vector3()
      : wishDirFromInput(input.move);

    // ADS amount eases in/out. Sniper "Lung Drag" tree perk multiplies
    // adsRate by `adsSpeedMult` so scoped weapons enter ADS faster
    // when the player has invested in the sniper class tree.
    const targetAds = input.adsHeld ? 1 : 0;
    const adsRate = (1 / Math.max(0.0001, tunables.ads.enterTime))
                  * (state.adsSpeedMult || 1);
    state.adsAmount += Math.sign(targetAds - state.adsAmount)
      * Math.min(Math.abs(targetAds - state.adsAmount), dt * adsRate);

    // --- Input → mode transitions -----------------------------------------
    // Dodge is always available, regardless of attack phase (it breaks combos
    // cleanly) — this is what makes melee feel fluid. Space = dash, double =
    // roll. Both cost stamina.
    if (input.spaceDoublePressed) {
      startRoll(wish);
    } else if (input.spacePressed) {
      if (state.mode === MODE.SLIDE) {
        state.yVel = tunables.jump.impulse;
        state.airborne = true;
        endToGround();
      } else {
        startDash(wish);
      }
    }

    if (input.crouchPressed) {
      if (state.mode === MODE.SLIDE) {
        startRoll(velocity.clone().setY(0));
      }
    }

    // Enter slide from sprinting ground movement when ctrl newly held.
    const wasSprinting = state.sprinting;
    state.sprinting = input.sprintHeld && wish.lengthSq() > 0.01;
    if (
      state.mode === MODE.GROUND
      && input.crouchHeld
      && state.sprinting
      && velocity.length() >= tunables.slide.entrySpeedMin
      && !state.airborne
    ) {
      startSlide(wish.lengthSq() > 0 ? wish : velocity);
    }

    // Crouch stance: held ctrl while grounded & not sliding.
    state.crouched = input.crouchHeld && state.mode === MODE.GROUND && !state.airborne;
    // Crouch-sprint: if the player holds sprint while crouched and wants to
    // move, they shuffle faster than a sneak but make more noise.
    state.crouchSprinting = state.crouched && input.sprintHeld && wish.lengthSq() > 0.01;

    // --- Mode execution ---------------------------------------------------
    // Re-check live attack state in case a dodge just cancelled the combo.
    const activeAttack =
      a.phase === 'startup' || a.phase === 'active' || a.phase === 'recovery';
    if (activeAttack) {
      if (a.phase === 'active') {
        velocity.x = a.facing.x * a.advanceSpeed;
        velocity.z = a.facing.z * a.advanceSpeed;
      } else {
        velocity.x = 0;
        velocity.z = 0;
      }
    } else if (state.mode === MODE.DASH) {
      // Front-loaded speed curve — ~1.5× base speed at t=0, tapering
      // smoothly to ~0.5× at end. Reads as "punchy launch, smooth
      // recovery" instead of a rectangular speed block.
      const t = Math.min(1, state.modeT / tunables.dash.duration);
      // 1.5 at t=0, 1.0 around t=0.35, 0.5 at t=1.
      const curve = 1.5 - t;
      // Backpedal dash penalty — 2× slower when dashing away from
      // the aim direction while shooting. Reduced by the pistol-
      // class relief stat. Using the dash direction (already locked
      // at dash start) instead of the live wish so mid-dash steering
      // can't dodge the penalty.
      let dashMult = 1;
      if (aimPoint && (input.attackHeld || input.adsHeld)
          && state.equipped?.type === 'ranged') {
        const ax = aimPoint.x - group.position.x;
        const az = aimPoint.z - group.position.z;
        const alen = Math.hypot(ax, az);
        if (alen > 0.01) {
          const dot = (state.dashDir.x * ax + state.dashDir.z * az) / alen;
          if (dot < -0.3) {
            // Penalty = 0.5 (half speed) with no relief, up to 1.0
            // with full relief.
            const relief = state.backpedalRelief || 0;
            dashMult = 0.5 + 0.5 * relief;
          }
        }
      }
      // Unused Rocket Ticket scales dash speed (and so distance over
      // the fixed dash duration) by the artifact's multiplier.
      const distMul = state.dashDistanceMult || 1;
      velocity.x = state.dashDir.x * tunables.dash.speed * curve * dashMult * distMul;
      velocity.z = state.dashDir.z * tunables.dash.speed * curve * dashMult * distMul;
      if (state.modeT >= tunables.dash.duration) {
        // Preserve a fraction of dash momentum so it blends into running,
        // then clamp to the player's max ground speed so a Rocket-Ticket
        // dash (distMul=2) can't dump 12-24 m/s of carry-over into the
        // ground tick — the lerp-to-walkSpeed decay was too slow to mask
        // it and players read as "very fast" with no movespeed bonus.
        velocity.multiplyScalar(0.3);
        const carryCap = tunables.move.sprintSpeed * (state.moveSpeedMult || 1);
        const carrySpeed = Math.hypot(velocity.x, velocity.z);
        if (carrySpeed > carryCap && carrySpeed > 0.0001) {
          const k = carryCap / carrySpeed;
          velocity.x *= k;
          velocity.z *= k;
        }
        endToGround();
      }
    } else if (state.mode === MODE.ROLL) {
      // Similar front-loaded curve for roll — launches quick, then
      // decelerates into the recovery so the stand-up doesn't feel
      // like braking hard.
      const t = Math.min(1, state.modeT / tunables.roll.duration);
      const curve = 1.4 - t * 0.9;   // 1.4 at t=0, 0.5 at t=1
      velocity.x = state.rollDir.x * tunables.roll.speed * curve;
      velocity.z = state.rollDir.z * tunables.roll.speed * curve;
      if (state.modeT >= tunables.roll.duration) {
        velocity.multiplyScalar(0.25);
        endToGround();
      }
    } else if (state.mode === MODE.SLIDE) {
      // Friction-based decel with light steering.
      const steer = wish.clone().multiplyScalar(tunables.slide.steerStrength * dt);
      velocity.x += steer.x;
      velocity.z += steer.z;
      const decay = Math.max(0, 1 - tunables.slide.friction * dt);
      velocity.x *= decay;
      velocity.z *= decay;
      const speed = Math.hypot(velocity.x, velocity.z);
      const expired =
        state.modeT >= tunables.slide.maxDuration
        || (state.modeT >= tunables.slide.minDuration && speed < tunables.move.walkSpeed * 0.9);
      if (expired) {
        // Clamp slide-exit velocity to sprint speed so the carry-over
        // into ground walking can't sustain mega-momentum across
        // chained slides.
        const carryCap = tunables.move.sprintSpeed * (state.moveSpeedMult || 1);
        if (speed > carryCap && speed > 0.0001) {
          const k = carryCap / speed;
          velocity.x *= k;
          velocity.z *= k;
        }
        endToGround();
      }
    } else {
      // GROUND movement.
      let maxSpeed = tunables.move.walkSpeed;
      if (state.crouchSprinting) maxSpeed = tunables.move.crouchSprintSpeed * (state.crouchMoveBonus || 1);
      else if (state.crouched) maxSpeed = tunables.move.crouchSpeed * (state.crouchMoveBonus || 1);
      else if (state.sprinting) maxSpeed = tunables.move.sprintSpeed;
      if (state.blocking) maxSpeed *= tunables.block.moveMultiplier;
      else if (input.adsHeld) maxSpeed *= tunables.ads.moveMultiplier;
      maxSpeed *= state.moveSpeedMult;

      // Backpedal — when the player is actively shooting / aiming and
      // their wish direction is opposite their aim direction, replace
      // walk/sprint with a slow backpedal. Rewards good positioning
      // (an out-of-position player can't just hose-and-retreat at
      // sprint speed). `backpedalRelief` from the pistol class skill
      // tree lerps the penalty back toward 1.0.
      if (_isBackpedaling(state, input, aimPoint, wish, group)) {
        const BASE_PENALTY = 0.6;
        const relief = state.backpedalRelief || 0;
        const mult = BASE_PENALTY + (1 - BASE_PENALTY) * relief;
        maxSpeed *= mult;
        state._backpedaling = true;
      } else {
        state._backpedaling = false;
      }

      const target = wish.clone().multiplyScalar(maxSpeed);
      if (target.lengthSq() > 0) {
        const k = Math.min(1, tunables.move.accel * dt / maxSpeed);
        velocity.x += (target.x - velocity.x) * k;
        velocity.z += (target.z - velocity.z) * k;
      } else {
        const decay = Math.max(0, 1 - tunables.move.friction * dt);
        velocity.x *= decay;
        velocity.z *= decay;
      }
    }

    // --- Vertical integration (jump arc) ----------------------------------
    // Track physical ground/jump Y separately from the final render
    // Y so the roll-tumble lift can be layered on top without
    // corrupting the next frame's gravity input.
    if (state._physicalY === undefined) state._physicalY = group.position.y;
    if (state.airborne) {
      state.yVel -= tunables.jump.gravity * dt;
      state._physicalY += state.yVel * dt;
      if (state._physicalY <= 0) {
        state._physicalY = 0;
        state.yVel = 0;
        state.airborne = false;
      }
    } else {
      state._physicalY = 0;
    }
    // Render Y starts at physical Y; the roll block below adds the
    // hip-pivot offset and any sink on top.
    group.position.y = state._physicalY;

    // Horizontal integration with collision resolution.
    const nextX = group.position.x + velocity.x * dt;
    const nextZ = group.position.z + velocity.z * dt;
    if (resolveCollision) {
      const res = resolveCollision(
        group.position.x, group.position.z, nextX, nextZ,
        tunables.player.collisionRadius,
      );
      group.position.x = res.x;
      group.position.z = res.z;
    } else {
      group.position.x = nextX;
      group.position.z = nextZ;
    }

    // Roll = full forward somersault around the character's local X
    // axis (YXZ Euler order above makes this pitch-in-local-frame).
    // modeT goes 0→duration; we rotate a full 2π over that window
    // so the player tumbles once and lands upright.
    //
    // The rotation is applied to `group` at its origin, which sits at
    // the feet. To make the visual pivot land at the HIPS instead, we
    // offset group.position so the world-position of the hip point
    // stays fixed through the rotation. Math: a child at local
    // (0, HIP_H, 0) ends up at group.position + Ry(yaw) * Rx(θ) *
    // (0, HIP_H, 0). Solving for a compensation that pins that world
    // position back to group.position + (0, HIP_H, 0) gives:
    //   dx = −HIP_H * sin(θ) * sin(yaw)
    //   dy =  HIP_H * (1 − cos(θ))
    //   dz = −HIP_H * sin(θ) * cos(yaw)
    // On top of that a small sin-arc sinks the character a touch so
    // the tucked body reads lower than standing.
    const HIP_H = 0.9 * (rig.scale || 1);
    if (state.mode === MODE.ROLL) {
      const t = Math.min(1, state.modeT / tunables.roll.duration);
      const theta = t * Math.PI * 2;
      group.rotation.x = theta;
      const yaw = state.bodyYaw || 0;
      const s = Math.sin(theta), c = Math.cos(theta);
      state._rollPivotX = -HIP_H * s * Math.sin(yaw);
      state._rollPivotY =  HIP_H * (1 - c) - 0.22 * Math.sin(t * Math.PI);
      state._rollPivotZ = -HIP_H * s * Math.cos(yaw);
    } else {
      group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, 0, Math.min(1, dt * 14));
      state._rollPivotX = THREE.MathUtils.lerp(state._rollPivotX || 0, 0, Math.min(1, dt * 14));
      state._rollPivotY = THREE.MathUtils.lerp(state._rollPivotY || 0, 0, Math.min(1, dt * 14));
      state._rollPivotZ = THREE.MathUtils.lerp(state._rollPivotZ || 0, 0, Math.min(1, dt * 14));
    }
    group.position.x += state._rollPivotX || 0;
    group.position.y += state._rollPivotY || 0;
    group.position.z += state._rollPivotZ || 0;
    // Slide keeps a small Y-squash since the rig sits low on one knee;
    // other modes return to full height. Roll uses pitch instead of
    // squash now, so Y stays at 1.0 throughout.
    const stanceY =
      state.mode === MODE.SLIDE ? 0.65 :
      1.0;
    group.scale.y = THREE.MathUtils.lerp(group.scale.y, stanceY, Math.min(1, dt * 15));

    // Lower the muzzle when crouched so the player can shoot under low gaps /
    // lose the line over regular low cover.
    // Gun is now parented to the right hand via the rig, so crouch
    // height, aim pose, and recoil kick are handled by the animation
    // layer (actor_rig.updateAnim). The old per-frame gun pose writes
    // fought with the rig's rotation chain and produced bent wrists,
    // so they've been removed — block spin / melee ready flourish
    // need a future rewrite against the rig's hand pivot if we want
    // them back.
    void state.blocking;  // kept in scope for future hand-based poses

    // Hit flash: blend body color toward red. The rig's shared body
    // material tints the whole torso chain (chest + stomach + neck)
    // in one lerp. Gate on hitFlashT > 0 so on idle frames we don't
    // overwrite whatever color applyCharacterStyle set — that
    // overwrite is what made the body read tan even after the rig
    // was configured all-dark.
    if (state.hitFlashT > 0) {
      const k = state.hitFlashT / Math.max(0.0001, tunables.player.hitFlashTime);
      rig.materials.bodyMat.color.copy(baseBodyColor).lerp(hurtColor, k);
    }

    // Procedural animation — pose legs/arms/torso on top of the
    // movement resolver. The baseline pose now always holds the gun
    // at chest level with both hands; `aiming` only gates the
    // ADS-specific head-level raise (right-click in main.js).
    // aimYaw = chest-twist delta relative to the body (computed
    // above as state.chestTwist). The rig's chest.rotation.y uses
    // this directly so the upper body swivels toward the cursor
    // while the legs continue to face the movement direction.
    const planarSpeed = Math.hypot(velocity.x, velocity.z);
    // Melee swing progress drives the weapon-arm pose in the rig.
    //   startup:  0 → -1  (arm cocks back, weapon raised)
    //   active:  -1 → +1  (sweeps across body in a horizontal arc)
    //   recovery: +1 → 0  (returns to neutral)
    //   idle:      0
    let swingProgress = 0;
    let swingStyle = 'horizontal';
    // Swing animation fires for ANY non-idle attack — a melee combo
    // (melee weapon) or a gun-held quick melee both drive the rig.
    // Previously this gated on `state.equipped?.type === 'melee'`
    // which left the arm frozen during pistol-whips.
    if (state.attack.phase !== 'idle') {
      const a2 = state.attack;
      const total = Math.max(0.01, a2.current?.startup || 0.01);
      const activeT = Math.max(0.01, a2.current?.active || 0.01);
      const recovT = Math.max(0.01, a2.current?.recovery || 0.01);
      if (a2.phase === 'startup') {
        const p = 1 - (a2.phaseT / total);
        swingProgress = -p;
      } else if (a2.phase === 'active') {
        const p = 1 - (a2.phaseT / activeT);
        swingProgress = -1 + 2 * p;
      } else if (a2.phase === 'recovery') {
        const p = 1 - (a2.phaseT / recovT);
        swingProgress = 1 - p;
      }
      swingStyle = a2.style || 'horizontal';
    }

    const cls2 = state.equipped?.class;
    // SMG was missing — fell through to the base pose where recoil
    // pushes the shoulder UP (the muzzle ends up at chest level
    // pointing down). Adding it to rifleHold uses the corrected
    // recoil direction below.
    //
    // SMGs in akimbo: keep rifleHold = true so the DOMINANT arm
    // still uses the shouldered SMG pose (otherwise the FBX mount
    // tilts toward the floor — the model is authored to suit the
    // shouldered wrist orientation). The support-arm half of the
    // rifleHold pose is skipped inside actor_rig.js when
    // state.akimbo is set, so the off-hand still gets the parallel
    // pistol-style pose.
    const rifleHold = cls2 === 'rifle' || cls2 === 'shotgun'
      || cls2 === 'lmg' || cls2 === 'sniper' || cls2 === 'smg';
    // Aim pitch — vertical angle from the fire origin (chest) to the
    // cursor target. Positive = target above shoulder (looking up),
    // negative = target below (crouched enemy / floor cursor). The
    // body already faces aim horizontally via group.rotation.y, so
    // yaw stays 0 here; pitch drives head + arm tilt in the rig.
    let aimPitch = 0;
    if (aimPoint) {
      body.getWorldPosition(_aimChestScratch);
      const dy = aimPoint.y - _aimChestScratch.y;
      const dx = aimPoint.x - _aimChestScratch.x;
      const dz = aimPoint.z - _aimChestScratch.z;
      const horiz = Math.hypot(dx, dz);
      if (horiz > 0.05) aimPitch = Math.atan2(dy, horiz);
      // Clamp so extreme angles (cursor on player's own feet) don't
      // wrench the head/arms past believable range. While crouching,
      // never pitch down — gun always stays parallel to the ground or
      // above so it looks correct when shooting over low cover.
      const pitchMin = state.crouched ? 0 : -0.6;
      aimPitch = Math.max(pitchMin, Math.min(0.7, aimPitch));
    }
    // Melee block stance — raise the weapon across the chest with
    // both hands holding it at a defensive angle. Only triggers when
    // holding block with a melee weapon equipped; ranged weapons keep
    // their normal aim pose.
    const blockPose = state.blocking && state.equipped?.type === 'melee';
    // Melee stance — switch from the two-handed forward aim pose to
    // the one-handed "weapon in hand, off-arm at side" pose. Active
    // whenever a melee weapon is equipped, OR whenever the player is
    // mid-swing with a gun (quick melee) — in that case we swap the
    // rifle hold out for the swing stance so the rig can animate
    // the strike. Block still overrides with the raised defensive
    // hold.
    const inQuickMelee = state.equipped?.type === 'ranged' && state.attack.phase !== 'idle';
    const meleeStance = (state.equipped?.type === 'melee' || inQuickMelee) && !blockPose;
    // Akimbo pose — when an off-hand weapon is equipped (player has
    // dual pistols / SMGs), force a meaningful aim-blend so BOTH
    // arms come up to near-shoulder level even though ADS is
    // suppressed. The rig's existing two-arm aim blend already
    // covers the symmetric pose; we just need a nonzero target.
    const akimboAimBlend = state.offhandEquipped ? 0.75 : 0;
    updateAnim(rig, {
      speed: planarSpeed,
      // Pass adsAmount directly so the chest→head-level raise eases
      // smoothly with the ADS zoom, not stepped at a threshold.
      // Akimbo forces a 0.75 floor so the off-hand reads as
      // actively aiming.
      aiming: Math.max(state.adsAmount || 0, akimboAimBlend),
      crouched: state.crouched,
      handedness: state.handedness,
      dashing: state.mode === MODE.DASH || state.mode === MODE.SLIDE,
      rifleHold,
      // Specific class drives sub-variants of the rifle hold —
      // rifles get a fully-extended support arm across the body;
      // SMG / shotgun / sniper / lmg keep the bent foregrip pose.
      weaponClass: cls2,
      blockPose,
      meleeStance,
      // Akimbo flag drives the support-arm pose override in
      // actor_rig: outward yaw + straighter elbow so the off-hand
      // gun extends forward in parallel instead of crossing the
      // chest into a two-hand grip.
      akimbo: !!state.offhandEquipped,
      attacking: state.attack.phase !== 'idle',
      swingProgress,
      swingStyle,
      swingIsCrit: !!state.attack.isCrit && state.attack.phase !== 'idle',
      aimYaw: state.chestTwist || 0,
      aimPitch,
    }, dt);

    // --- weapon-offset overlay (per-frame, shouldered classes) ------
    // Rotates / nudges gunMesh + inHandModel + muzzle on top of the
    // class-default position laid down in setWeapon. Hip ↔ aim values
    // come from RIFLE_WEAPON_{HIP,AIM} (authored in tools/pose_editor)
    // and lerp by aimBlend. Mirror across YZ for left-handed actors.
    // Applied here (not actor_rig.js) because gunMesh / muzzle live
    // outside the rig — they're parented to a shoulder anchor by
    // setWeapon and we don't want the rig module to know about them.
    //
    // Apr-26: extended from rifle-only to ALL shouldered classes
    // (rifle/shotgun/lmg/sniper). They share the rifle anchor + the
    // same Z-forward base orientation, so the same offset formula
    // applies cleanly. SMG is hand-anchored (wrist mount, base rot
    // π/2 around X, gun extends in -Y) — its math is different and
    // we'd dunk it into a weird spot if we used the rifle deltas, so
    // SMG keeps the no-overlay default for now.
    const _shouldered = cls2 === 'rifle' || cls2 === 'shotgun'
      || cls2 === 'lmg' || cls2 === 'sniper';
    if (_shouldered && rig.anim) {
      const ab = rig.anim.aimBlend ?? 0;
      const hb = 1 - ab;
      const m  = state.handedness === 'left' ? -1 : 1;
      const lerp = (h, x) => h * hb + x * ab;
      const wlen = (state.equipped?.muzzleLength ?? 0.5);
      const wsScale = WEAPON_SCALE;
      // Class-default base position / rotation set by setWeapon for
      // shouldered rifles. We rebuild them here so the offset is
      // additive even after weapon swaps.
      const baseGunZ = (0.1 + wlen / 2) * wsScale;
      const baseMuzZ = (0.1 + wlen)     * wsScale;
      const px = lerp(RIFLE_WEAPON_HIP.px, RIFLE_WEAPON_AIM.px) * m;
      const py = lerp(RIFLE_WEAPON_HIP.py, RIFLE_WEAPON_AIM.py);
      const pz = lerp(RIFLE_WEAPON_HIP.pz, RIFLE_WEAPON_AIM.pz);
      const rx = lerp(RIFLE_WEAPON_HIP.rx, RIFLE_WEAPON_AIM.rx);
      const ry = lerp(RIFLE_WEAPON_HIP.ry, RIFLE_WEAPON_AIM.ry) * m;
      const rz = lerp(RIFLE_WEAPON_HIP.rz, RIFLE_WEAPON_AIM.rz) * m;
      gunMesh.position.set(px, py, baseGunZ + pz);
      gunMesh.rotation.set(rx, ry, rz);
      inHandModel.position.copy(gunMesh.position);
      inHandModel.rotation.copy(gunMesh.rotation);
      // Muzzle is parented to the SAME anchor as gunMesh, not as a
      // child of gunMesh — so its world position needs the gun's
      // rotation applied to the tip-offset vector before adding to
      // the gun pivot. Result: muzzle marker tracks the gun barrel
      // tip wherever the gun swings.
      _muzzleTipScratch.set(0, 0, (wlen / 2) * wsScale);
      _muzzleTipScratch.applyEuler(gunMesh.rotation);
      muzzle.position.set(
        gunMesh.position.x + _muzzleTipScratch.x,
        gunMesh.position.y + _muzzleTipScratch.y,
        gunMesh.position.z + _muzzleTipScratch.z,
      );
      muzzle.rotation.copy(gunMesh.rotation);
    }

    // SMG weapon-offset overlay — same authoring pipeline as the
    // shouldered classes, but the SMG hand-mount baseline differs:
    // gunMesh starts at (0, -(0.1+len/2)*ws, 0) in WRIST-local with
    // rotation (π/2, 0, 0). The offset is added on top. Tip-offset
    // in gun-local +Z still resolves to the muzzle (gun's own +Z
    // axis points along the barrel post-rotation), so the muzzle
    // formula is identical to the shouldered branch.
    if (cls2 === 'smg' && rig.anim) {
      const ab = rig.anim.aimBlend ?? 0;
      const hb = 1 - ab;
      const m  = state.handedness === 'left' ? -1 : 1;
      const lerp = (h, x) => h * hb + x * ab;
      const wlen = (state.equipped?.muzzleLength ?? 0.5);
      const wsScale = WEAPON_SCALE;
      const baseGunY = -(0.1 + wlen / 2) * wsScale;
      const baseRotX = Math.PI / 2;
      const px = lerp(SMG_WEAPON_HIP.px, SMG_WEAPON_AIM.px) * m;
      const py = lerp(SMG_WEAPON_HIP.py, SMG_WEAPON_AIM.py);
      const pz = lerp(SMG_WEAPON_HIP.pz, SMG_WEAPON_AIM.pz);
      const rx = lerp(SMG_WEAPON_HIP.rx, SMG_WEAPON_AIM.rx);
      const ry = lerp(SMG_WEAPON_HIP.ry, SMG_WEAPON_AIM.ry) * m;
      const rz = lerp(SMG_WEAPON_HIP.rz, SMG_WEAPON_AIM.rz) * m;
      gunMesh.position.set(px, baseGunY + py, pz);
      gunMesh.rotation.set(baseRotX + rx, ry, rz);
      inHandModel.position.copy(gunMesh.position);
      inHandModel.rotation.copy(gunMesh.rotation);
      _muzzleTipScratch.set(0, 0, (wlen / 2) * wsScale);
      _muzzleTipScratch.applyEuler(gunMesh.rotation);
      muzzle.position.set(
        gunMesh.position.x + _muzzleTipScratch.x,
        gunMesh.position.y + _muzzleTipScratch.y,
        gunMesh.position.z + _muzzleTipScratch.z,
      );
      muzzle.rotation.copy(gunMesh.rotation);
    }

    // Virtual firing origin — pinned to a STABLE point above the
    // player's foot center. Previously read body.getWorldPosition()
    // which is the animated chest mesh's world pos — that gets
    // displaced laterally by hip roll (gaitHipRoll + idle breathing
    // sway), so every bullet fires from a swaying chest pos and
    // shots whiff to the side of the cursor target. Anchoring to
    // group.position + chest-height Y keeps bullets straight at the
    // cursor regardless of pose. Visible muzzle (tracer origin)
    // still follows the hand's animation.
    const fireOrigin = new THREE.Vector3(
      group.position.x,
      group.position.y + (state.crouched ? 0.85 : 1.25),
      group.position.z,
    );
    return {
      position: group.position,
      aim: aimPoint || null,
      facing: facing.clone(),
      muzzleWorld: muzzle.getWorldPosition(new THREE.Vector3()),
      // Off-hand muzzle world position — used by main.js's akimbo
      // path so RMB tracers spawn from weapon2's muzzle instead of
      // weapon1's. Always populated even if akimbo isn't active so
      // consumers don't need to null-check; main.js only reads it
      // when firing the off-hand weapon.
      offhandMuzzleWorld: offhandMuzzle.getWorldPosition(new THREE.Vector3()),
      fireOrigin,
      adsAmount: state.adsAmount,
      mode: state.mode,
      crouched: state.crouched,
      crouchSprinting: state.crouchSprinting,
      iFrames: state.iFrames > 0,
      iFramesRemaining: state.iFrames,
      speed: Math.hypot(velocity.x, velocity.z),
      health: state.health,
      regenCap: state.regenCap,
      bleedT: state.bleedT,
      brokenT: state.brokenT,
      maxHealth: state.maxHealth,
      stamina: state.stamina,
      maxStamina: state.maxStamina,
      blocking: state.blocking,
      parryActive: state.parryT > 0,
      attackEvent,
      attackPhase: a.phase,
      attackStep: a.step,
      attackWeapon: a.weapon,
      attackIsCrit: !!a.isCrit,
      // One-shot flags for feel FX — main.js reads these and we
      // clear below so each event fires exactly once.
      dashStarted:  !!state.dashStartedEvent,
      rollStarted:  !!state.rollStartedEvent,
      slideStarted: !!state.slideStartedEvent,
      // Consumed-by-returning so the next frame's playerInfo has
      // them as false unless another dash/roll/slide fires.
    };
  }
  // Clear the one-shot event flags AFTER returning playerInfo so
  // main.js has already seen them. Actually reset happens at the
  // top of the next update frame to keep things synchronous — see
  // _clearDashEvents call at entry to update().

  // Expose rig + poke helpers so main.js can drive shot recoil / hit
  // flinches without knowing the internal rig structure.
  function kickRecoil() { pokeRecoil(rig); }
  function reactToHit(dirX, dirZ, mag) { pokeHit(rig, dirX, dirZ, mag); }
  function reactToDeath(dirX, dirZ, mag) { pokeDeath(rig, dirX, dirZ, mag); }

  // Swap the firing shoulder. Reparents the gun mesh + muzzle + FBX
  // in-hand model to the opposite anchor (shoulder for long guns,
  // hand for pistols/SMGs/melee). Rig arm-pose mirror applies
  // automatically because we pass state.handedness to updateAnim
  // each frame.
  function swapHandedness() {
    state.handedness = state.handedness === 'right' ? 'left' : 'right';
    const cls = state.equipped?.class;
    const isShouldered = cls === 'rifle' || cls === 'shotgun'
      || cls === 'lmg' || cls === 'sniper';
    const newAnchor = isShouldered ? _shoulderAnchor() : _handAnchor();
    if (gunMesh.parent !== newAnchor) newAnchor.add(gunMesh);
    if (muzzle.parent !== newAnchor) newAnchor.add(muzzle);
    if (inHandModel.parent !== newAnchor) newAnchor.add(inHandModel);
  }

  // --- Character style: operator (default) vs marine -----------------
  // "marine" adds stacked-primitive Warhammer 40K decorations on top
  // of the same rig — huge shoulder pauldrons, a power-pack backpack,
  // a rounded helmet with a visor strip, knee guards, a chest aquila.
  // Everything is parented to existing rig pivots so the decorations
  // inherit the rig's animation, lean, recoil, and aim without any
  // skinning. Toggling the style recolours the shared materials and
  // flips the decor group's visibility — no rebuild needed.
  const marineDecor = _buildMarineDecor(rig);
  // Palettes for the two silhouettes. Operator values match the
  // original buildRig call (so toggling back restores the original
  // look); marine values push toward Ultramarine blue with gold
  // trim and a cream helmet.
  const OPERATOR_COLORS = {
    body: 0x1c1e22, head: 0x141518, leg: 0x121317, arm: 0x1a1c20,
    hand: 0x0d0e10, gear: 0x2a2c30, boot: 0x0a0b0c,
  };
  const MARINE_COLORS = {
    body: 0x1e3a82, head: 0xdad2b0, leg: 0x1e3a82, arm: 0x1e3a82,
    hand: 0x0e1020, gear: 0xc89a3a, boot: 0x0e182a,
  };
  // Cache the active style baseline. applyArmorTint reads from this
  // when an armor slot is empty, so the body falls back to the
  // operator/marine palette instead of staying tinted.
  let _styleBase = OPERATOR_COLORS;
  function applyCharacterStyle(style) {
    const isMarine = style === 'marine';
    const p = isMarine ? MARINE_COLORS : OPERATOR_COLORS;
    _styleBase = p;
    rig.materials.bodyMat.color.setHex(p.body);
    rig.materials.headMat.color.setHex(p.head);
    rig.materials.legMat.color.setHex(p.leg);
    rig.materials.armMat.color.setHex(p.arm);
    rig.materials.handMat.color.setHex(p.hand);
    rig.materials.gearMat.color.setHex(p.gear);
    rig.materials.bootMat.color.setHex(p.boot);
    marineDecor.setVisible(isMarine);
    // Re-capture baseBodyColor after a style change so the hit-flash
    // lerp restores TO the new base (matters for operator↔marine
    // toggles mid-run).
    if (typeof baseBodyColor !== 'undefined' && rig.materials?.bodyMat) {
      baseBodyColor.copy(rig.materials.bodyMat.color);
    }
  }
  applyCharacterStyle(getCharacterStyle());

  // Apply equipped-armor tints to the rig material chain. Each armor
  // slot maps to a rig material; equipped items override the style
  // baseline with their own item.tint (or item.bodyTint if specified).
  // Slots without an equipped item fall back to the style base. Called
  // from main.js per frame after applyDerivedStats — cheap (just
  // material color writes), only writes when the cached value differs.
  function applyArmorTint(equipment) {
    if (!equipment) return;
    const set = (mat, hex, last) => {
      if (mat.color._lastHex !== hex) {
        mat.color.setHex(hex);
        mat.color._lastHex = hex;
      }
    };
    // chest → body + arms (top covers shoulders too)
    const chest = equipment.chest;
    const chestHex = chest && typeof chest.tint === 'number' ? chest.tint : _styleBase.body;
    set(rig.materials.bodyMat, chestHex);
    set(rig.materials.armMat, chestHex);
    // pants → legs
    const pants = equipment.pants;
    const pantsHex = pants && typeof pants.tint === 'number' ? pants.tint : _styleBase.leg;
    set(rig.materials.legMat, pantsHex);
    // boots
    const boots = equipment.boots;
    const bootsHex = boots && typeof boots.tint === 'number' ? boots.tint : _styleBase.boot;
    set(rig.materials.bootMat, bootsHex);
    // gloves → hands
    const hands = equipment.hands;
    const handsHex = hands && typeof hands.tint === 'number' ? hands.tint : _styleBase.hand;
    set(rig.materials.handMat, handsHex);
    // helmet (head) — visibility toggle handled separately. If a
    // helmet is equipped, head reads as gear (helmet shell color);
    // otherwise it stays the style head colour.
    const head = equipment.head;
    const headHex = head && typeof head.tint === 'number' ? head.tint : _styleBase.head;
    set(rig.materials.headMat, headHex);
    // belt + chest secondary gear — both feed gearMat. Belt wins
    // since it's smaller / more specific; chest takes over if no
    // belt is equipped.
    const belt = equipment.belt;
    const gearHex = (belt && typeof belt.tint === 'number') ? belt.tint
      : (chest && typeof chest.gearTint === 'number') ? chest.gearTint
      : _styleBase.gear;
    set(rig.materials.gearMat, gearHex);
  }

  // ----- Equipped-backpack visual swap ------------------------------
  // A primitive backpack mesh sits on the chest pivot; size + tint
  // reflect the equipped backpack item. setBackpackVisual(item) is
  // called from main.js on every inventory change so the silhouette
  // reads the player's current load. Pre-built once with three slots
  // (a body, a top flap, two strap loops); swap = re-tint + re-scale.
  const backpackGroup = new THREE.Group();
  const backpackMat = new THREE.MeshToonMaterial({ color: 0x6a5530 });
  const backpackStrapMat = new THREE.MeshToonMaterial({ color: 0x2a2218 });
  const _backpackBody = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), backpackMat);
  _backpackBody.castShadow = true;
  backpackGroup.add(_backpackBody);
  const _backpackTop = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), backpackStrapMat);
  backpackGroup.add(_backpackTop);
  // Two shoulder straps coming up over the chest.
  for (const sx of [-1, 1]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.04), backpackStrapMat);
    strap.position.set(sx * 0.13, 0.05, 0.18);
    strap.rotation.x = -0.18;
    backpackGroup.add(strap);
  }
  backpackGroup.visible = false;
  rig.chest.add(backpackGroup);

  // Pack profiles by item id. (w, h, d) are world-units sizes; the
  // box geometry is unit-cube and gets scaled per profile so we never
  // re-allocate geometry on swap. Values calibrated to read at iso
  // distance — small profile sits flat on the back, large rucksack
  // bulges noticeably above the shoulders.
  const PACK_PROFILES = {
    backpack_small:   { w: 0.36, h: 0.40, d: 0.18, topH: 0.08, yOff: 0.10 },
    backpack_satchel: { w: 0.42, h: 0.38, d: 0.15, topH: 0.06, yOff: 0.08 },
    backpack_med:     { w: 0.46, h: 0.50, d: 0.22, topH: 0.10, yOff: 0.13 },
    backpack_assault: { w: 0.46, h: 0.55, d: 0.24, topH: 0.10, yOff: 0.16 },
    backpack_large:   { w: 0.52, h: 0.65, d: 0.28, topH: 0.12, yOff: 0.20 },
    backpack_ranger:  { w: 0.50, h: 0.62, d: 0.26, topH: 0.12, yOff: 0.19 },
  };
  const PACK_DEFAULT = PACK_PROFILES.backpack_small;

  function setBackpackVisual(item) {
    if (!item) {
      backpackGroup.visible = false;
      return;
    }
    const prof = PACK_PROFILES[item.id] || PACK_DEFAULT;
    const s = rig.scale || 1;
    _backpackBody.scale.set(prof.w * s, prof.h * s, prof.d * s);
    _backpackBody.position.set(0, prof.yOff * s, -prof.d * s * 0.5 - 0.18 * s);
    _backpackTop.scale.set((prof.w + 0.03) * s, prof.topH * s, (prof.d + 0.04) * s);
    _backpackTop.position.set(0, (prof.yOff + prof.h * 0.5 + prof.topH * 0.5 - 0.02) * s, -prof.d * s * 0.5 - 0.18 * s);
    if (typeof item.tint === 'number') {
      backpackMat.color.setHex(item.tint);
    } else {
      backpackMat.color.setHex(0x6a5530);
    }
    backpackGroup.visible = true;
  }

  // Pre-load + clone + cache a weapon's FBX without changing the
  // currently-equipped weapon. Used by main.regenerateLevel to warm
  // every weapon in the player's rotation during level-transition,
  // so the first swap to each one in-game is a free visibility
  // toggle instead of a multi-frame stall on FBX clone + traversal.
  // Melee weapons + missing models no-op cleanly.
  function prewarmWeapon(weapon) {
    if (!weapon || weapon.type === 'melee') return;
    const modelUrl = modelForItem(weapon);
    if (!modelUrl || _weaponCloneCache.has(modelUrl)) return;
    loadModelClone(modelUrl).then((clone) => {
      if (!clone || _weaponCloneCache.has(modelUrl)) return;
      const len = weapon.muzzleLength;
      const CLASS_SCALE = {
        pistol: 0.45, smg: 0.65, rifle: 0.75, shotgun: 0.75,
        lmg: 0.75, flame: 0.7, melee: 0.7,
      };
      const cs = CLASS_SCALE[weapon.class] ?? 0.9;
      fitToRadius(clone, len * cs * scaleForModelPath(modelUrl));
      const r = weapon.modelRotation;
      const rotOverride = rotationOverrideForModelPath(modelUrl);
      if (rotOverride) {
        clone.rotation.set(rotOverride.x || 0, rotOverride.y || 0, rotOverride.z || 0);
      } else if (r) {
        clone.rotation.set(r.x || 0, r.y || 0, r.z || 0);
      } else {
        clone.rotation.set(0, Math.PI / 2, 0);
      }
      if (shouldMirrorInHand(weapon)) clone.scale.x = -clone.scale.x;
      const gripOff = gripOffsetForModelPath(modelUrl);
      if (gripOff) clone.position.set(gripOff.x || 0, gripOff.y || 0, gripOff.z || 0);
      else         clone.position.set(0, 0, 0);
      clone.visible = false;
      inHandModel.add(clone);
      _weaponCloneCache.set(modelUrl, clone);
    }).catch(() => {});
  }

  return {
    mesh: group, body, rig, update, setWeapon, setOffhandWeapon, prewarmWeapon, takeDamage, heal, applyStatus,
    tryMeleeAttack, tryQuickMelee, cancelCombo,
    tryParry, isBlocking, isParryActive,
    consumeStamina, refundStamina, applyDerivedStats, restoreFullHealth,
    applyDownedState, restoreHealthPct,
    kickRecoil, reactToHit, reactToDeath,
    swapHandedness,
    getHandedness: () => state.handedness,
    applyCharacterStyle,
    setBackpackVisual,
    applyArmorTint,
  };
}

// Build the Warhammer-40K-style decoration set. All meshes parent to
// rig pivots so they inherit animation automatically. Returns an
// object with `setVisible(bool)` to toggle the whole kit at once.
function _buildMarineDecor(rig) {
  const scale = rig.scale || 1;
  const parts = [];
  const blue = new THREE.MeshStandardMaterial({ color: 0x1e3a82, roughness: 0.55, metalness: 0.15 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xc89a3a, roughness: 0.45, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0e1624, roughness: 0.7 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xe8dfbc, roughness: 0.5 });
  const lens = new THREE.MeshStandardMaterial({
    color: 0xa02020, emissive: 0x600808, emissiveIntensity: 0.7, roughness: 0.3,
  });

  // Pauldrons — signature half-spheres on each shoulder with a gold
  // trim ring at the base. Reference render had them at ~0.38*scale
  // which swallowed the whole silhouette; shrunk to 0.22 so the
  // arms/head read cleanly around them.
  const PAULDRON_R = 0.22 * scale;
  const mkPauldron = (side) => {
    const sign = side === 'left' ? -1 : 1;
    const group = new THREE.Group();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(PAULDRON_R, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      blue,
    );
    dome.castShadow = true;
    group.add(dome);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(PAULDRON_R * 0.95, 0.035 * scale, 8, 20),
      trim,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.01 * scale;
    group.add(ring);
    // Sit the pauldron outboard + slightly above the shoulder pivot
    // so it reads as sitting ON TOP of the deltoid rather than
    // replacing it.
    group.position.set(sign * 0.08 * scale, 0.08 * scale, 0);
    parts.push(group);
    return group;
  };
  rig.leftArm.shoulder.pivot.add(mkPauldron('left'));
  rig.rightArm.shoulder.pivot.add(mkPauldron('right'));

  // Power pack / backpack — rectangular block on the upper back
  // with two exhaust stacks rising above the shoulder line.
  const pack = new THREE.Group();
  const packBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.55 * scale, 0.70 * scale, 0.28 * scale),
    dark,
  );
  packBody.castShadow = true;
  pack.add(packBody);
  // Gold edge trim across the top of the pack.
  const packTrim = new THREE.Mesh(
    new THREE.BoxGeometry(0.58 * scale, 0.05 * scale, 0.31 * scale),
    trim,
  );
  packTrim.position.y = 0.35 * scale;
  pack.add(packTrim);
  // Two exhaust stacks.
  for (const side of [-1, 1]) {
    const stack = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05 * scale, 0.065 * scale, 0.40 * scale, 10),
      dark,
    );
    stack.position.set(side * 0.17 * scale, 0.55 * scale, -0.02 * scale);
    pack.add(stack);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075 * scale, 0.075 * scale, 0.05 * scale, 10),
      trim,
    );
    cap.position.set(side * 0.17 * scale, 0.77 * scale, -0.02 * scale);
    pack.add(cap);
  }
  // Sit behind the chest — chest pivot's local +Z is forward, so
  // pushing -Z puts the pack on the back. Y offset lifts it to the
  // upper back region.
  pack.position.set(0, (rig.dims?.torso?.chestH ?? 0.38) * scale * 0.45, -0.23 * scale);
  rig.chest.add(pack);
  parts.push(pack);

  // Chest aquila — a small gold plate with two spread wings on the
  // front of the torso. Stacked primitives: centre rounded plate,
  // two side wings, a little gold skull blob at top.
  const aquila = new THREE.Group();
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11 * scale, 0.14 * scale, 0.04 * scale, 10),
    trim,
  );
  plate.rotation.x = Math.PI / 2;
  aquila.add(plate);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(
      new THREE.ConeGeometry(0.07 * scale, 0.24 * scale, 4),
      trim,
    );
    wing.position.set(side * 0.18 * scale, 0, 0);
    wing.rotation.z = side * Math.PI * 0.5;
    aquila.add(wing);
  }
  const skull = new THREE.Mesh(
    new THREE.SphereGeometry(0.055 * scale, 8, 6),
    cream,
  );
  skull.position.y = 0.11 * scale;
  aquila.add(skull);
  aquila.position.set(0, (rig.dims?.torso?.chestH ?? 0.38) * scale * 0.30, 0.21 * scale);
  rig.chest.add(aquila);
  parts.push(aquila);

  // Helmet — needs to be clearly the most prominent thing above the
  // shoulder line, otherwise the silhouette reads as "blob with a
  // small knob on top". Previous 0.22*scale was smaller than the
  // cranium + hair volume and disappeared between the pauldrons.
  // 0.32 fully envelops the head mesh with visible armour.
  const helmet = new THREE.Group();
  const HELM_R = 0.32 * scale;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(HELM_R, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.78),
    blue,
  );
  dome.castShadow = true;
  helmet.add(dome);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(HELM_R * 0.96, 0.03 * scale, 6, 20),
    trim,
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.06 * scale;
  helmet.add(rim);
  // Visor strip — dark band across the face with a red emissive
  // centre lens. Scaled up with the helmet so proportions track.
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.44 * scale, 0.08 * scale, 0.02 * scale),
    dark,
  );
  visor.position.set(0, 0.00 * scale, 0.28 * scale);
  helmet.add(visor);
  const lensMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.20 * scale, 0.055 * scale, 0.015 * scale),
    lens,
  );
  lensMesh.position.set(0, 0.00 * scale, 0.295 * scale);
  helmet.add(lensMesh);
  // Respirator / snout — trapezoidal block jutting forward from the
  // lower face.
  const snout = new THREE.Mesh(
    new THREE.BoxGeometry(0.20 * scale, 0.13 * scale, 0.14 * scale),
    dark,
  );
  snout.position.set(0, -0.11 * scale, 0.27 * scale);
  helmet.add(snout);
  const snoutTrim = new THREE.Mesh(
    new THREE.BoxGeometry(0.21 * scale, 0.025 * scale, 0.15 * scale),
    trim,
  );
  snoutTrim.position.set(0, -0.17 * scale, 0.27 * scale);
  helmet.add(snoutTrim);
  rig.head.add(helmet);
  parts.push(helmet);

  // Knee guards — chunky half-domes on the front of each knee.
  const mkKnee = (leg) => {
    const knee = new THREE.Mesh(
      new THREE.SphereGeometry(0.12 * scale, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
      blue,
    );
    knee.rotation.x = Math.PI;
    knee.position.set(0, 0, 0.08 * scale);
    leg.knee.add(knee);
    parts.push(knee);
  };
  if (rig.leftLeg?.knee)  mkKnee(rig.leftLeg);
  if (rig.rightLeg?.knee) mkKnee(rig.rightLeg);

  // Chunky gauntlet cuffs over the wrist cuffs — gold rings so the
  // silhouette reads as armoured gloves.
  for (const arm of [rig.leftArm, rig.rightArm]) {
    const cuff = new THREE.Mesh(
      new THREE.TorusGeometry(0.10 * scale, 0.04 * scale, 6, 14),
      trim,
    );
    cuff.rotation.x = Math.PI / 2;
    arm.wrist.add(cuff);
    parts.push(cuff);
  }

  // Hide every decoration by default; applyCharacterStyle toggles
  // visibility on the whole kit at once.
  for (const p of parts) p.visible = false;
  return {
    setVisible(on) { for (const p of parts) p.visible = on; },
  };
}
