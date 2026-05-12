import * as THREE from 'three';
import { tunables } from './tunables.js';
import { modelForItem, gripOffsetForModelPath, rotationOverrideForModelPath, shouldMirrorInHand, scaleForModelPath } from './model_manifest.js';
import { getCharacterStyle } from './prefs.js';
import { loadModelClone, fitToRadius } from './gltf_cache.js';
import { buildRig, initAnim, updateAnim, pokeHit, pokeRecoil, pokeDeath,
         RIFLE_WEAPON_HIP, RIFLE_WEAPON_AIM,
         SMG_WEAPON_HIP,   SMG_WEAPON_AIM,
         SUPPORT_GRIP_FRACTION_BY_CLASS } from './actor_rig.js';
import { buildMeleePrimitive } from './melee_primitives.js';
import { loadStateMachine, selectFromPlayerState, selectLayeredFromPlayerState, deriveInputs } from './anim/state_machine.js';
import { attachGraph } from './anim/graph.js';
import { selectGaspLocomotion } from './anim/locomotion.js';
import { solveTwoBoneIK, solvePostClipTwoBoneIK, resetIkCache } from './anim/ik_two_bone.js';

// ============================================================
// ANIM_TUNE — live-tunable knobs for weapon position, size, and
// arm pose. Bound by tweakpane in src/ui_anim_tuner.js
// (window.__openTuner()). setWeapon + _runUpperBodyIK read these
// fresh each call, so panel slider changes apply immediately on
// the next frame (or on the next reattachWeapon() for grip/scale).
// ============================================================
export const ANIM_TUNE = {
  // Per-class visible-factor: muzzle Z offset is `len * vf` for
  // pistol-class weapons (grip-at-hand authoring). Long-gun muzzle
  // uses `len * 0.2 + len * vf * 0.5`. Higher vf → muzzle further
  // from grip → tracer originates at the visible barrel tip.
  visibleFactor: {
    pistol: 0.20, smg: 0.20, rifle: 0.40, shotgun: 0.45,
    sniper: 0.20, lmg: 0.35, flame: 1.50, melee: 0.90,
  },
  // Per-class grip Z offset multiplier (applied as `gripZScale * len`).
  // 0 = grip-end clones (pistol used to want this; tuner pass moved
  // it to 0.58). SMG / flame / melee clones have center origin →
  // ~0.42-0.50 keeps the back from clipping into the chest. Long
  // guns sit near 0.0-0.20 so the stock overlaps wrist + forearm.
  gripZScale: {
    pistol: 0.00, smg: 0.22, rifle: -0.10, shotgun: -0.10,
    sniper: 0.00, lmg: -0.10, flame: 0.24, melee: -0.10,
  },
  // Per-class size multiplier — applied as inHandModel.scale.setScalar
  // on top of the fitToRadius initial fit. 1.0 = no change. Pistol
  // and SMG were undersized post-fit and got bumped via the tuner
  // pass to match the class-uniform diameter targets.
  sizeMul: {
    pistol: 2.4, smg: 1.5, rifle: 1.0, shotgun: 1.8,
    sniper: 1.0, lmg: 1.0, flame: 1.25, melee: 0.85,
  },
  // Per-class GRIP X/Y offset — applied to gunMesh.position (X, Y).
  // Z is driven by gripZScale × len. Use this to nudge the visible
  // gun left/right/up/down relative to the dominant hand bone. Units
  // are world meters (post weapon-scale).
  gripOffset: {
    pistol:  { x: -0.16, y:  0.04 }, smg:     { x: -0.15, y:  0.20 },
    rifle:   { x: -0.13, y:  0.17 }, shotgun: { x: -0.17, y:  0.24 },
    sniper:  { x: -0.11, y:  0.24 }, lmg:     { x: -0.13, y:  0.17 },
    flame:   { x:  0.00, y:  0.00 }, melee:   { x: -0.15, y:  0.02 },
  },
  // Per-class SUPPORT-HAND grip fraction along the grip→muzzle line.
  // 0 = skip support-arm IK (pistol / melee — single-handed); larger
  // values pull the support hand further down the barrel. Overrides
  // actor_rig's SUPPORT_GRIP_FRACTION_BY_CLASS at runtime.
  supportGrip: {
    pistol: 0.00, smg: 0.35, rifle: 1.00, shotgun: 0.50,
    sniper: 0.65, lmg: 0.45, flame: 0.50, melee:   0.00,
  },
  // Arm + body pose tunables read by _runUpperBodyIK per frame.
  // anchorOffset is a DIRECT additive shift on the gun-anchor lerp
  // target (the lerp follows the dominant hand bone); slider drags
  // visibly translate the gun. Replaces the prior hipY/adsY/fwdMin
  // floor knobs which only kicked in when the hand bone dropped
  // below the floor — confusing and often inert.
  arm: {
    // Hipfire arm pitch baseline — chest pitches down by this many
    // radians at adsAmount=0, lerping to 0 at adsAmount=1. Negative
    // lifts arms up. (1 - ads) * gaspPitchHipfire is added to aimPitch.
    gaspPitchHipfire: -0.02,
    // Direct additive offset on the gun-anchor lerp target. Always
    // visible. Local to rig.group (so x = right, y = up, z = forward).
    anchorOffset: { x: -0.12, y: -0.08, z: -0.01 },
    // OFF by default — dominant-arm IK forces the hand to grip the
    // gun, which prevents tuning held-close poses (the arm becomes
    // fully outstretched no matter what the user dials in).
    // Flip ON in the tuner if you want hand-on-grip behavior; the
    // gameplay default trusts the clip's authored arm pose.
    dominantArmIK: false,
    // Master kill switch — when ON, ALL upper-body IK + anchor logic
    // skips: spine twist applyChain, stance yaw, arm-shoulder twist,
    // support-arm IK, dominant-arm IK, gun-anchor hand-tracking lerp,
    // gun-anchor pitch/yaw aim. Body still rotates to cursor (rigid
    // follow), so the player can move + look around, but the rig is
    // pure clip-driven from there. DEFAULT TRUE — user found IK was
    // the cause of the persistent arm-vs-gun + bias issues. The clip
    // authoring is what the tuning sliders compose against now;
    // re-enable IK at your own risk via the tuner toggle.
    disableAllIK: true,
    // Per-axis lerp rate on the gun-anchor's hand-tracking. Lower =
    // more smoothing (gun lags more, bob attenuates). Y is dropped
    // by default because vertical hand-bob during the run cycle is
    // the most visible source of gun jitter; X/Z stay snappy so the
    // gun still tracks aim direction + chest twist responsively.
    anchorLerp: { x: 0.16, y: 0.16, z: 0.15 },
    // Per-class bladed-stance yaw (radians). Spine twists this much
    // in world frame relative to body forward — used to put the
    // shoulder forward / arms slightly off-axis for a "ready to
    // shoot" stance silhouette. Causes the arm-vs-gun split when
    // the gun is anchored to cursor while spine is offset; dial to
    // 0 if you want arms and gun perfectly co-linear.
    stanceYaw: {
      rifle: 0.26, shotgun: 0.26, sniper: 0.26, lmg: 0.00,
      smg: -0.63, pistol: -0.10, flame: 0.0, melee: 0.0,
    },
    // When ON, the gun-anchor inherits the dominant hand bone's
    // position + rotation DELTAS each frame — gun visibly tracks the
    // hand swing during run / aim / reload clips. Reference pose is
    // captured the first frame the rig updates, so the gun's static
    // baked position (and per-class gripOffsets) is preserved at t=0
    // and the hand's clip-driven motion is added on top. Independent
    // of disableAllIK; works with raw clips. Toggle in tuner.
    gunFollowsHand: true,
  },
};

// Frozen pre-merge snapshot of the SHIPPING ANIM_TUNE — what a
// fresh-localStorage user sees on first visit. Tuner's "Reset to
// defaults" uses this so reset really restores the baked code
// values, not the user's last saved tuning. When new values are
// baked into ANIM_TUNE above, this constant tracks them
// automatically (deep clone before any mutation runs).
export const ANIM_TUNE_DEFAULTS = JSON.parse(JSON.stringify(ANIM_TUNE));

// Apply persisted tuner overrides from localStorage (set by
// ui_anim_tuner's "save" action). Survives reload. Failure-safe.
// Only KNOWN keys merge in — drops orphaned fields from old schemas
// (e.g. arm.hipY/adsY/fwdMin from the pre-2026-05-08 floor-style
// knobs that were superseded by anchorOffset). Without this, stale
// fields linger in the live ANIM_TUNE forever and clutter the
// Print dump.
try {
  const saved = JSON.parse(localStorage.getItem('coldExitAnimTune') || 'null');
  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(ANIM_TUNE)) {
      const dst = ANIM_TUNE[k];
      const src = saved[k];
      if (!src || typeof src !== 'object' || typeof dst !== 'object') continue;
      for (const inner of Object.keys(dst)) {
        const v = src[inner];
        if (v == null) continue;
        // Nested object (per-class { x, y } or arm.anchorOffset).
        if (typeof dst[inner] === 'object' && typeof v === 'object') {
          for (const leaf of Object.keys(dst[inner])) {
            if (typeof v[leaf] === 'number' || typeof v[leaf] === 'boolean') {
              dst[inner][leaf] = v[leaf];
            }
          }
        } else if (typeof v === typeof dst[inner]) {
          dst[inner] = v;
        }
      }
    }
  }
} catch (_) { /* corrupt entry; ignore */ }

// Lazy-load the GASP locomotion state machine (only fetched when a
// rig with useGaspLocomotion=true is loaded). Same fire-and-forget
// pattern as _ensurePlayerSmLoaded.
let _gaspSmCfg = null;
let _gaspSmFetched = false;
function _ensureGaspSmLoaded() {
  // Skip if anything has already supplied a state machine. Without this
  // guard, this function fires from the player.update tick the instant
  // useGaspLocomotion=true is set, races against __usePeekPlayer's
  // setLocomotionStateMachine(runner_sm) call, and (on .then resolve)
  // overwrites runner_sm with gasp_lower_body — whose clip names refer
  // to GASP M_Neutral_* clips that aren't loaded on peek, leaving
  // selectGaspLocomotion's lookups silently null and locomotion broken.
  if (_gaspSmFetched || _gaspSmCfg) return;
  _gaspSmFetched = true;
  loadStateMachine('gasp_lower_body').then(cfg => {
    // Re-check: setLocomotionStateMachine may have run between the
    // fetch start and resolution. Don't clobber an explicitly-chosen SM.
    if (_gaspSmCfg) return;
    _gaspSmCfg = cfg;
    if (cfg) console.log('[player] gasp_lower_body state machine loaded');
  }).catch(err => {
    console.warn('[player] gasp SM load failed:', err.message);
  });
}

// Swap the active locomotion state machine. The variable name says
// "gasp" for historical reasons (the GASP UEFN clip set was the
// original consumer); selectGaspLocomotion is generic and works on
// any state-machine config that uses the same state IDs (walk_F,
// run_FL, sprint_F, etc.). Used by the Mixamo runner-pack player
// swap to point the selector at runner_lower_body.json instead of
// gasp_lower_body.json.
export function setLocomotionStateMachine(cfg) {
  _gaspSmCfg = cfg;
  // Flip the auto-load guard so the gasp_lower_body fetch (kicked off
  // from player.update the first tick after useGaspLocomotion=true)
  // can't clobber the explicit choice when its promise resolves.
  _gaspSmFetched = true;
}

// Aim-IK target scratch (world-space point the wrist should reach).
const _aimIkTarget = new THREE.Vector3();
const _aimIkPole = new THREE.Vector3();

// Gun-follow-hand scratch — see _updateGunFollow below.
const _gfM = new THREE.Matrix4();
const _gfPos = new THREE.Vector3();
const _gfQuat = new THREE.Quaternion();
const _gfScale = new THREE.Vector3();
const _gfDeltaPos = new THREE.Vector3();
const _gfDeltaQuat = new THREE.Quaternion();
const _gfRefInv = new THREE.Quaternion();

// Pin the gun anchor to the dominant hand's clip-driven motion. We
// don't re-parent the anchor (that would fight the body-local
// gripOffsets the user already baked); instead we read the hand
// bone's CURRENT pose in body-local space, capture a one-shot
// reference pose on first call, and apply (current - reference) to
// the anchor's static base each frame. Result:
//  - frame 0: anchor stays at its baked body-relative position
//  - frame N: anchor.pos = base + (handLocalPos_N - handLocalPos_0)
//             anchor.quat = (handLocalQuat_N * inv(handLocalQuat_0))
//                           composed with the baked base quat
// So idle bob, run swing, reload reach, and aim micromotion all
// translate into gun motion, but the user's tuned chest-forward
// position survives untouched.
function _updateGunFollow(rig, state) {
  if (!ANIM_TUNE.arm.gunFollowsHand) return;
  if (!rig || !rig._gunAnchor || !rig.group) return;
  const handBone = (state?.handedness === 'left')
    ? rig.leftArm?.wrist
    : rig.rightArm?.wrist;
  if (!handBone) return;

  rig.group.updateMatrixWorld();
  handBone.updateMatrixWorld();
  // hand's pose expressed in rig.group's local frame:
  //   localM = inv(group.world) * hand.world
  _gfM.copy(rig.group.matrixWorld).invert().multiply(handBone.matrixWorld);
  _gfM.decompose(_gfPos, _gfQuat, _gfScale);

  if (!rig._gunFollowRef) {
    // Defer capture until the locomotion clip is fully blended in.
    // Capturing during T-pose (or during fade-in from T-pose) means
    // the next frame's clip-pose hand differs by 90°+ in body-local
    // → that delta gets applied as gun rotation and the gun spawns
    // visibly rotated. We require the current clip's action weight
    // ≥ 0.99 before capture so the reference is the actual idle /
    // run pose, not a transitional one.
    const fbx = rig._fbx;
    const action = fbx?.currentClipName ? fbx.actions?.get(fbx.currentClipName) : null;
    const weight = action?.getEffectiveWeight?.() ?? 0;
    if (!action || weight < 0.99) return;
    rig._gunFollowRef = {
      handPos: _gfPos.clone(),
      handQuat: _gfQuat.clone(),
      anchorBasePos: rig._gunAnchor.position.clone(),
      anchorBaseQuat: rig._gunAnchor.quaternion.clone(),
    };
    return;
  }
  const ref = rig._gunFollowRef;

  _gfDeltaPos.copy(_gfPos).sub(ref.handPos);
  // dQ such that curQ = dQ * refQ (body-local frame) → dQ = curQ * inv(refQ)
  _gfRefInv.copy(ref.handQuat).invert();
  _gfDeltaQuat.copy(_gfQuat).multiply(_gfRefInv);

  rig._gunAnchor.position.copy(ref.anchorBasePos).add(_gfDeltaPos);
  // anchor body-local rotation = dQ applied to base in body frame
  rig._gunAnchor.quaternion.copy(ref.anchorBaseQuat).premultiply(_gfDeltaQuat);
}

// Public hook so a future handedness flip / rig swap can clear the
// captured reference and re-establish it on the next update tick.
export function resetGunFollowReference(rig) {
  if (rig) rig._gunFollowRef = null;
}

// Upper-body aim for the GASP rig — the locomotion clips already
// pose the arms holding the gun forward (they're authored as
// "_Pistol" gun-aim cycles), so we DON'T run a 2-bone IK on the
// arms. The arms naturally track the cursor via chest yaw, since
// the upperarm bones are children of the spine chain.
//
// The 2-bone IK code (src/anim/ik_two_bone.js) is kept for future
// non-aim-pose clips but not invoked here — it has math instability
// on the shoulder bind-pose composition that produced visible arm-
// orbit-in-circles motion. Plain chest+head additive aim looks
// correct for the GASP locomotion set.
function _runUpperBodyIK(rig, state, aimPoint, aimPitch, dt = 1/60) {
  if (!rig || !rig._fbx) return;
  // Master kill switch — see ANIM_TUNE.arm.disableAllIK doc above.
  // When ON, the entire upper-body IK pipeline is skipped: clips
  // own everything from the spine up.
  if (ANIM_TUNE.arm.disableAllIK) return;
  const fbx = rig._fbx;
  const aimYaw = state.chestTwist || 0;
  // Add the GASP pitch-up baseline (negative aimPitch tilts upper
  // body forward; we want backward when below ADS so arms rise).
  aimPitch += (state._gaspPitchOffset || 0);
  // Recoil pulse — kickRecoil() set fbx._recoilT and _recoilAmt;
  // decay over time. ~180ms total, peak at trigger, smooth ease-out.
  // Drives THREE additive layers each frame:
  //   1. aimPitch += -recoil — chest/spine pitch backward (muzzle rises)
  //   2. dominant shoulder kick — additive rotation on the gun-arm
  //      shoulder so the visible arm jerks rearward (not just spine)
  //   3. dominant elbow kick — small bend on the gun-arm elbow so the
  //      forearm absorbs some of the kick (reads as "gun pushes the
  //      forearm back into a slightly tighter bend")
  // Layers 2 and 3 fire on bones AFTER the spine writes below, so
  // they're applied to the post-locomotion bone state. Stored as
  // pendingRecoilKick — used in the dominant-arm clavicle/upperarm
  // block further down. Magnitudes scaled to the recoil amount.
  let recoilK = 0;
  if (fbx._recoilT > 0) {
    fbx._recoilT = Math.max(0, fbx._recoilT - dt);
    const phase = fbx._recoilT / 0.18;            // 1.0 → 0.0
    recoilK = phase * phase;                       // ease-out quadratic
    aimPitch += -fbx._recoilAmt * recoilK;         // chest pitches up (muzzle rises)
  }
  // Stash for the arm-kick block below.
  fbx._pendingRecoilK = recoilK;

  // Resolve spine chain + neck + head + clavicles on first call.
  // Prefers registry-driven abstract refs (rig.stomach, rig.chest,
  // rig.neck, rig.leftArm.shoulder.pivot, rig.rightArm.shoulder.pivot)
  // so this works on any rig (gasp_uefn, mixamo, future). Falls back
  // to hardcoded UE5 names if the abstract refs aren't populated.
  if (!fbx._spineChain) {
    const bones = fbx.bonesByName;
    const fromAbstract = [rig.stomach, rig.chest].filter(Boolean);
    if (fromAbstract.length) {
      fbx._spineChain = fromAbstract;
    } else {
      const candidates = ['spine_01', 'spine_02', 'spine_03', 'spine_04', 'spine_05'];
      fbx._spineChain = candidates.map(n => bones?.get(n) || null).filter(Boolean);
    }
    fbx._neckBone  = rig.neck                       || bones?.get('neck_01')   || null;
    fbx._clavicleL = rig.leftArm?.shoulder?.pivot   || bones?.get('clavicle_l') || null;
    fbx._clavicleR = rig.rightArm?.shoulder?.pivot  || bones?.get('clavicle_r') || null;
  }

  // Hip-sway cancellation: stabilize ONLY spine_01 to a fixed
  // world orientation (group.world × spine_01_bindRel). This
  // absorbs whatever pelvis sway the clip applied. Above spine_01,
  // bones use LOCAL multiplication (snapshot-restore + delta) so
  // the parent chain compounds — the arms (children of spine_05)
  // naturally inherit the full chestTwist accumulated up the spine.
  //
  // Captured once at load: spine_01's bind orientation in the
  // group's frame, plus each upper-body bone's bind LOCAL Q.
  if (!fbx._upperBodyBindRel) {
    fbx._upperBodyBindRel = new Map();
    fbx._upperBodyBindLocal = new Map();
    rig.group.updateMatrixWorld(true);
    rig.group.getWorldQuaternion(_aimParentWorldQ);
    const groupInvW = _aimParentWorldQ.clone().invert();
    const stabilize = [fbx._spineChain[0]];  // spine_01 only
    for (const bone of stabilize) {
      if (!bone) continue;
      bone.updateMatrixWorld(true);
      const w = new THREE.Quaternion();
      bone.getWorldQuaternion(w);
      fbx._upperBodyBindRel.set(bone, groupInvW.clone().multiply(w));
    }
    const allBones = [...fbx._spineChain, fbx._neckBone, rig.head].filter(Boolean);
    for (const bone of allBones) {
      fbx._upperBodyBindLocal.set(bone, bone.quaternion.clone());
    }
  }

  // Step 1: lock spine_01 to (group.world × bind_rel) — cancels hip sway.
  rig.group.updateMatrixWorld(true);
  rig.group.getWorldQuaternion(_aimParentWorldQ);
  const spine01 = fbx._spineChain[0];
  if (spine01 && spine01.parent) {
    const bindRel = fbx._upperBodyBindRel.get(spine01);
    if (bindRel) {
      const desired = _aimComposeQ.copy(_aimParentWorldQ).multiply(bindRel);
      const parentW = new THREE.Quaternion();
      spine01.parent.getWorldQuaternion(parentW);
      spine01.quaternion.copy(parentW.invert()).multiply(desired);
      spine01.updateMatrixWorld(true);
    }
  }

  // Step 2: each spine bone above spine_01 + neck + head gets a
  // LOCAL aim delta. Through the parent chain, deltas compound,
  // so the arms (children of spine_05's clavicle) inherit the full
  // chest twist.
  // LEAN REDUCTION step 1 — halved from baseline so we can dial
  // Spine distribution zeroed for cursor-tracking (body locks to
  // cursor). Rifle-class weapons get a STATIC bladed-stance twist
  // applied in WORLD frame (not bone-local Euler) — bone-local
  // axes on UEFN spine bones aren't aligned with world Y after
  // the chain accumulates, so a local-Y "yaw" reads as a roll.
  // World-frame conversion below produces a clean horizontal twist.
  const cls = state?.equipped?.class;
  // Live-tunable per-class bladed-stance yaw — see ANIM_TUNE.arm.stanceYaw.
  // Was a hardcoded 0.26 for rifle-class and 0 for everything else;
  // the offset is what made arms point ~15° off where the gun aims,
  // so this is the user-facing knob to fix that misalignment per
  // weapon class.
  const stanceYaw = (ANIM_TUNE.arm.stanceYaw?.[cls]) ?? 0;
  const STANCE_WEIGHTS = [0, 0.05, 0.18, 0.35, 0.42];
  const YAW_WEIGHTS   = [0, 0, 0, 0, 0];
  const PITCH_WEIGHTS = [0, 0, 0, 0, 0];
  const applyChain = (bone, yawAmt, pitchAmt) => {
    if (!bone || !bone.parent) return;
    const bindLocal = fbx._upperBodyBindLocal.get(bone);
    if (!bindLocal) return;
    bone.quaternion.copy(bindLocal);
    if (Math.abs(yawAmt) > 0.001 || Math.abs(pitchAmt) > 0.001) {
      _aimDeltaE.set(pitchAmt, yawAmt, 0, 'YXZ');
      _aimDeltaQ.setFromEuler(_aimDeltaE);
      bone.quaternion.multiply(_aimDeltaQ);
    }
    bone.updateMatrixWorld(true);
  };
  for (let i = 1; i < fbx._spineChain.length; i++) {
    applyChain(fbx._spineChain[i], aimYaw * YAW_WEIGHTS[i], aimPitch * PITCH_WEIGHTS[i]);
  }
  // Rifle-stance twist — applied in WORLD frame after local Euler
  // pass. Each spine bone left-multiplies a parent-frame conversion
  // of a world-Y rotation:
  //   bone.local = (parent.world⁻¹ × worldYawQ × parent.world) × bind
  // This guarantees the rotation is around world Y regardless of
  // the bone's local axis convention — pure horizontal twist, no
  // lean.
  if (Math.abs(stanceYaw) > 0.001) {
    const _stanceWorldQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), stanceYaw);
    const _parentW = new THREE.Quaternion();
    const _delta = new THREE.Quaternion();
    for (let i = 1; i < fbx._spineChain.length; i++) {
      const bone = fbx._spineChain[i];
      const bind = fbx._upperBodyBindLocal.get(bone);
      if (!bone || !bone.parent || !bind) continue;
      const w = STANCE_WEIGHTS[i];
      if (w < 0.001) continue;
      const partial = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0), stanceYaw * w);
      bone.parent.getWorldQuaternion(_parentW);
      _delta.copy(_parentW).invert().multiply(partial).multiply(_parentW);
      bone.quaternion.copy(_delta).multiply(bind);
      bone.updateMatrixWorld(true);
    }
    // Counter the bladed-stance bias on the dominant clavicle so
    // the hand lines up with the gun (which sits on the body-forward
    // axis = cursor line). Spine accumulated +stanceYaw rotation;
    // we apply -stanceYaw on the firing-side clavicle in world frame
    // to pull the arm BACK to body-forward. Net: shoulders bladed,
    // hand at cursor line.
    const dominantClav = state?.handedness === 'left'
      ? fbx._clavicleL
      : fbx._clavicleR;
    if (dominantClav && dominantClav.parent) {
      const counterQ = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0), -stanceYaw);
      dominantClav.parent.getWorldQuaternion(_parentW);
      _delta.copy(_parentW).invert().multiply(counterQ).multiply(_parentW);
      let bind = fbx._upperBodyBindLocal.get(dominantClav);
      if (!bind) {
        bind = dominantClav.quaternion.clone();
        fbx._upperBodyBindLocal.set(dominantClav, bind);
      }
      dominantClav.quaternion.copy(_delta).multiply(bind);
      dominantClav.updateMatrixWorld(true);
    }
  }

  // ── Recoil arm-kick ─────────────────────────────────────────
  // During the recoil pulse (~180ms after firing), apply additive
  // rotations on the dominant arm's shoulder and elbow so the arm
  // visibly jerks back instead of just having the chest tilt up.
  // Magnitudes scale with the kickRecoil amount (sniper hits hardest,
  // pistol softest). The chest pitch from aimPitch already runs in
  // the spine writes above; this layer is what makes the arm itself
  // pop back. Reads from fbx._pendingRecoilK (set above).
  const _recK = fbx._pendingRecoilK || 0;
  if (_recK > 0 && fbx._recoilAmt) {
    const dominantArm = state?.handedness === 'left' ? rig.leftArm : rig.rightArm;
    const shoulderPiv = dominantArm?.shoulder?.pivot;
    const elbow = dominantArm?.elbow;
    // Shoulder kick: rotate arm rearward (positive X = pitch back in
    // typical bone-local convention for upper arms). Magnitude = ~3×
    // the chest pitch so the arm motion is visibly bigger than the
    // spine motion. Multiply per-frame, additive on top of clip pose.
    const shoulderKick = _recK * fbx._recoilAmt * 3.0;
    if (shoulderPiv) {
      shoulderPiv.rotation.x -= shoulderKick;
    }
    // Elbow kick: small additional bend so the forearm absorbs some
    // of the kick. Smaller magnitude than the shoulder.
    const elbowKick = _recK * fbx._recoilAmt * 1.5;
    if (elbow) {
      elbow.rotation.x -= elbowKick;
    }
    if (shoulderPiv) shoulderPiv.updateMatrixWorld(true);
  }

  // Neck + head: yaw ONLY. User feedback — pitching the head/neck
  // reads as a lean and breaks the silhouette. Head turns to face
  // the cursor; neck stays straight; pitch contribution = 0.
  applyChain(fbx._neckBone, aimYaw * 0.10, 0);
  applyChain(rig.head,      aimYaw * 0.30, 0);

  // Absolute head-yaw override — Mixamo idle clips author the head
  // pitched down, and the bindLocal capture above runs AFTER the clip
  // posed the bone, so applyChain composes deltas against a downward-
  // looking "rest" pose. This block snaps the head's WORLD rotation
  // to body-yaw + aim delta, ignoring bindLocal entirely — the head
  // ends up looking forward (or toward the cursor) regardless of what
  // the clip authored. Same world-frame technique as the spine_01
  // stabilization at the top of this function.
  if (rig.head && rig.head.parent) {
    rig.group.updateMatrixWorld(true);
    rig.group.getWorldQuaternion(_aimParentWorldQ);
    _aimDeltaE.set(0, aimYaw * 0.4, 0, 'YXZ');
    _aimDeltaQ.setFromEuler(_aimDeltaE);
    const _desired = _aimComposeQ.copy(_aimParentWorldQ).multiply(_aimDeltaQ);
    const _parentW = new THREE.Quaternion();
    rig.head.parent.updateMatrixWorld(true);
    rig.head.parent.getWorldQuaternion(_parentW);
    rig.head.quaternion.copy(_parentW.invert()).multiply(_desired);
  }

  // ── Support-arm IK (option 5: gun-anchored target) ─────────
  // Target is computed from the gun's grip + muzzle anchors —
  // both are children of the right-hand wrist, so they move with
  // the gun automatically. No re-binding, no per-aim-angle
  // authoring. Five class-level fractions are the only knobs.
  //
  // Uses solvePostClipTwoBoneIK (post-AnimationMixer solver) —
  // reads current bone state every frame instead of caching a
  // bind direction. This is what fixes the wild swinging from
  // the previous solveTwoBoneIK attempt: the post-clip solver
  // doesn't compose its delta with the clip's per-frame rotation.
  const _ikCls = state.equipped?.class;
  // Live-tunable override; falls back to the rig-builder's class
  // table if no entry. ANIM_TUNE.supportGrip exposes 0..1 sliders
  // per class so the user can move the support hand along the
  // grip→muzzle line without restarting.
  const _ikFracTune = ANIM_TUNE.supportGrip?.[_ikCls];
  const _ikFrac = (_ikFracTune != null) ? _ikFracTune : SUPPORT_GRIP_FRACTION_BY_CLASS[_ikCls];
  // Skip the support-arm IK while a one-shot is locked AND when the
  // currently-running clip set includes a layered upper-body action
  // (reload / fire / hit-react). The IK forces the support hand to
  // grip the gun's grip-anchor, which fights the layered clip's
  // authored arm pose and locks the off-hand mid-reload. Detection:
  // if the current locomotion action's mixer has any non-locomotion
  // action with weight > 0.1, defer to the clip.
  const _now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const _clipLocked = rig._fbx?._clipLockUntil && _now < rig._fbx._clipLockUntil;
  let _layeredActive = false;
  if (rig._fbx?.actions && rig._fbx.currentAction) {
    for (const a of rig._fbx.actions.values()) {
      if (a !== rig._fbx.currentAction && a.isRunning?.() && (a.getEffectiveWeight?.() ?? 1) > 0.1) {
        _layeredActive = true; break;
      }
    }
  }
  if (_ikFrac && _ikFrac > 0.01
      && !_clipLocked
      && !_layeredActive
      && !state.offhandEquipped
      && rig._weaponGripAnchor
      && rig._weaponMuzzleAnchor
      && rig.leftArm?.shoulder?.pivot
      && rig.leftArm?.elbow
      && rig.leftArm?.wrist) {
    rig.group.updateMatrixWorld(true);
    const _gW = new THREE.Vector3();
    const _mW = new THREE.Vector3();
    rig._weaponGripAnchor.getWorldPosition(_gW);
    rig._weaponMuzzleAnchor.getWorldPosition(_mW);
    const _target = _gW.clone().lerp(_mW, _ikFrac);
    // Pole hint = away from spine + slightly down. Computed
    // dynamically so it works at any character orientation.
    const _shW = new THREE.Vector3();
    const _chW = new THREE.Vector3();
    rig.leftArm.shoulder.pivot.getWorldPosition(_shW);
    rig.chest.getWorldPosition(_chW);
    const _pole = _shW.clone().sub(_chW).normalize();
    _pole.y -= 0.3;
    _pole.normalize();
    solvePostClipTwoBoneIK(
      rig.leftArm.shoulder.pivot,
      rig.leftArm.elbow,
      rig.leftArm.wrist,
      _target,
      _pole,
    );
  }

  // ============================================================
  // DOMINANT-ARM IK — pulls the dominant hand to the gun's grip
  // position so the hand visibly stays on the gun no matter how
  // the user shifts arm.anchorOffset / gripOffset / gripZScale via
  // the tuner. Without this, the dominant hand stays wherever the
  // clip's authored pose put it and the gun floats off into space.
  //
  // Same gating as the support-arm IK: skip during one-shot locks
  // (death, reload), during layered upper-body clips (reload-arm
  // pose), and during melee swings (the swing clip authors the
  // arm). AnimationMixer rewrites bone quaternions every frame
  // before this IK runs, so there's no compounding across frames.
  //
  // Skipped for melee weapons (the melee swing clip authors the
  // dominant arm) and for state.attack.phase !== 'idle' (a swing
  // is in flight).
  // ============================================================
  const _domSide = state.handedness === 'right' ? rig.rightArm : rig.leftArm;
  const _domSwinging = state.attack && state.attack.phase !== 'idle';
  if (ANIM_TUNE.arm.dominantArmIK
      && state.equipped?.type === 'ranged'
      && !_clipLocked
      && !_layeredActive
      && !_domSwinging
      && rig._weaponGripAnchor
      && _domSide?.shoulder?.pivot
      && _domSide?.elbow
      && _domSide?.wrist
      && rig.chest) {
    rig.group.updateMatrixWorld(true);
    const _domTarget = new THREE.Vector3();
    rig._weaponGripAnchor.getWorldPosition(_domTarget);
    const _domShW = new THREE.Vector3();
    const _domChW = new THREE.Vector3();
    _domSide.shoulder.pivot.getWorldPosition(_domShW);
    rig.chest.getWorldPosition(_domChW);
    const _domPole = _domShW.clone().sub(_domChW).normalize();
    _domPole.y -= 0.3;
    _domPole.normalize();
    solvePostClipTwoBoneIK(
      _domSide.shoulder.pivot,
      _domSide.elbow,
      _domSide.wrist,
      _domTarget,
      _domPole,
    );
  }
}

// Lazy-load the player FBX clip-selection state machine. Until the
// JSON is fetched, the legacy if/else cascade below runs as a
// fallback so behaviour matches the previous version exactly. Once
// the JSON resolves, it becomes the source of truth.
let _playerSmCfg = null;
let _playerSmFetched = false;
function _ensurePlayerSmLoaded() {
  if (_playerSmFetched) return;
  _playerSmFetched = true;
  loadStateMachine('cold_exit_player').then(cfg => {
    _playerSmCfg = cfg;
    if (cfg) console.log('[player] state machine loaded: cold_exit_player');
  }).catch(err => {
    console.warn('[player] state machine load failed; falling back to legacy clip selection:', err.message);
  });
}

// Isometric camera is rotated 45° around Y. Map input directions so W goes
// "up the screen" in the iso view rather than along world +Z.
const FORWARD = new THREE.Vector3(-1, 0, -1).normalize();
const RIGHT = new THREE.Vector3(1, 0, -1).normalize();

// Module scratch — reused inside player.update for the aim-pitch
// chest world-position read. Consumed synchronously inside the same
// function so reuse is safe across frames.
const _aimChestScratch = new THREE.Vector3();
const _muzzleTipScratch = new THREE.Vector3();
// Scratch vector for hand-bone tracking on the GASP gun anchor.
const _handTrackV = new THREE.Vector3();
// Scratches for the FBX aim-IK quaternion path. The IK applies a
// delta quaternion to the bone's mixer-driven base each frame in
// WORLD space (not bone-local) — bone local axes vary by export
// pack (Motus / Mixamo / Biped all author them differently), so
// "yaw on bone-local Y" can be a lean depending on the pack. Doing
// the rotation in world frame and then converting to local-of-parent
// makes the IK behave the same regardless of bone orientation.
const _aimDeltaQ = new THREE.Quaternion();
const _aimDeltaE = new THREE.Euler(0, 0, 0, 'YXZ');
const _aimParentWorldQ = new THREE.Quaternion();
const _aimComposeQ = new THREE.Quaternion();

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

// Async helper to swap the player's procgen rig out for a Mixamo
// FBX rig at runtime. Use case:
//   const player = createPlayer(scene);
//   await swapPlayerToFbxRig(player, scene, 'Assets/models/Idle.fbx');
//
// The procgen rig stays in scene but is hidden; player.rig now points
// at the FBX adapter so weapon attach (rig.rightArm.hand.pivot etc.)
// keeps working through the rest of the codebase. updateAnim
// auto-detects rig._fbx and routes to the AnimationMixer instead.
// Dispose an FBX/GLB rig — removes the group from its scene parent
// and disposes geometry / materials / mixer. Called before a new
// FBX swap (to prevent scene-stacking) and during revert-to-procgen.
function _disposeFbxRig(rig) {
  if (!rig || !rig._fbx) return;
  if (rig._fbx.mixer) {
    try { rig._fbx.mixer.stopAllAction(); } catch (_) {}
    try { rig._fbx.mixer.uncacheRoot(rig.group); } catch (_) {}
  }
  if (rig.group) {
    if (rig.group.parent) rig.group.parent.remove(rig.group);
    rig.group.traverse(o => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m?.dispose?.());
        else o.material.dispose?.();
      }
    });
  }
}

// Public revert helper — drops the current FBX rig and shows the
// procgen rig. Used by __useFbx(null) so the FBX assets get freed
// instead of accumulating in scene.
export function revertPlayerToProcgen(player) {
  if (!player._procgenRig) return false;
  player._procgenRig.group.visible = true;
  if (player.rig && player.rig !== player._procgenRig && player.rig._fbx) {
    _disposeFbxRig(player.rig);
  }
  player.rig = player._procgenRig;
  if (typeof player._setRig === 'function') player._setRig(player._procgenRig);
  return true;
}

export async function swapPlayerToFbxRig(player, scene, url, opts = {}) {
  const { loadCharacterFBX } = await import('./character_fbx.js');
  // Save the procgen rig once on first swap; subsequent swaps go
  // FBX→FBX and we don't want to overwrite our procgen reference.
  if (player.rig && player.rig.group && !player._procgenRig) {
    player._procgenRig = player.rig;
  }
  // If we were on a previous FBX rig (FBX→FBX swap), dispose it
  // before loading the new one so the scene doesn't accumulate
  // hidden meshes + leaked GPU buffers.
  if (player.rig && player.rig._fbx && player.rig !== player._procgenRig) {
    _disposeFbxRig(player.rig);
  }
  const fbxRig = await loadCharacterFBX(scene, url, opts);
  if (player._procgenRig?.group) player._procgenRig.group.visible = false;
  player.rig = fbxRig;
  // Critical: flip the closure binding inside player.update so the
  // FBX branch (`if (rig._fbx)`) actually fires. Without this, the
  // update loop keeps using the procgen rig that was captured at
  // construction.
  if (typeof player._setRig === 'function') player._setRig(fbxRig);
  // Mirror the world group transform so the FBX inherits whatever
  // position/rotation the procgen rig was using (player respawn,
  // hideout placement, etc.).
  if (player._procgenRig?.group) {
    fbxRig.group.position.copy(player._procgenRig.group.position);
    fbxRig.group.rotation.copy(player._procgenRig.group.rotation);
  }
  return fbxRig;
}

export function createPlayer(scene) {
  // Jointed player rig — shared with enemies. `body` below is aliased
  // to the rig's chest mesh so AI cover + hit raycasts still resolve to
  // the same target they always did (userData.isPlayer preserved).
  // `let` not `const` so swapPlayerToFbxRig can flip this closure
  // binding to the FBX adapter at runtime. The update() closure
  // below reads `rig` directly, so reassigning here is what makes
  // the FBX branch fire after a swap.
  let rig = buildRig({
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
    // Asymmetric bandolier strap — the protagonist's signature prop.
    // Only the player gets this; enemies stay bilateral so the player
    // reads as THE character on screen.
    signature: true,
    // Cyborg-ninja silhouette signatures: yellow visor across the
    // face, segmented neck cable in place of the smooth neck, gear-
    // color sheath box mounted across the back. Together these read
    // the player as the Raiden-coded protagonist; enemies skip these
    // flags and stay generic-operator.
    visor: true,
    neckCable: true,
    sheath: true,
    accentColor: 0xf2c060,   // visor glow — project's accent-gold
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
  // Weapons are sized in raw tunable metres (e.g. muzzleLength=0.5
  // for a rifle). The weapon mesh is parented to the wrist, which
  // is already inside rig.group whose scale is rig.scale (0.77 for
  // the player). So weapon WORLD size = local size × rig.scale.
  //
  // The previous code applied WEAPON_SCALE = rig.scale on TOP of
  // that, double-scaling: a 0.5m rifle would render at 0.5 × 0.77 ×
  // 0.77 = 0.296m world. Way too small — exactly the "SMG on a
  // giant" the comment was trying to avoid.
  //
  // Fix: scale weapons by 1 / rig.scale so the local mesh.scale
  // CANCELS the parent rig.scale and the weapon renders at its
  // authored metre length in world space. A 0.5m rifle is now 0.5m
  // in world.
  const WEAPON_SCALE = 1.0 / (rig.scale || 1.0);

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

  // Expose grip + muzzle anchors on the rig so the support-arm IK in
  // actor_rig.js can solve the support hand onto the gun's actual
  // grip→muzzle line every frame. Without these the rig falls back
  // to FK-only and the support hand drifts off-line at non-authored
  // aim angles.
  rig._weaponGripAnchor   = gunMesh;
  rig._weaponMuzzleAnchor = muzzle;

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
    // GASP / FBX rigs declare a stable _gunAnchor under rig.group.
    // Always prefer it over a wrist bone so the gun doesn't follow
    // locomotion-clip arm-swing motion.
    if (rig._gunAnchor) return rig._gunAnchor;
    // Procgen path — wrist bone with handedness flip.
    const armRight = rig.rightArm?.wrist;
    const armLeft  = rig.leftArm?.wrist;
    return (state.handedness === 'right' ? armRight : armLeft) || armRight || armLeft || rig.group;
  }
  function _shoulderAnchor() {
    if (rig._gunAnchor) return rig._gunAnchor;
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

    // Re-bind the support-IK anchors on every setWeapon. The player's
    // rig is a `let` in createPlayer's scope and can be flipped from
    // procgen → FBX by swapPlayerToFbxRig() via _setRig(). The
    // closure here resolves `rig` to whichever is current, so this
    // always lands on the active rig — and re-runs every weapon swap
    // for safety.
    if (rig) {
      rig._weaponGripAnchor   = gunMesh;
      rig._weaponMuzzleAnchor = muzzle;
    }

    const ws = WEAPON_SCALE;
    const usingGunAnchor = !!(rig._gunAnchor && anchor === rig._gunAnchor);
    if (usingGunAnchor) {
      // GASP path — anchor under rig.group, tracking the dominant
      // hand bone. Gun barrel extends along anchor's +Z.
      //
      // Grip placement is per-class, not per-shouldered, because GLB
      // clones in the runtime asset set don't share a common origin
      // convention:
      //   • pistol clones — origin at grip end → gripZ=0 lands the
      //     visible grip in the hand (REGRESSION: anim-gun-grip-floating
      //     — gunMesh.position.z=len/2 used to put grip 17cm forward of
      //     the hand on pistols).
      //   • smg / flame — clones have their origin at the mesh CENTER;
      //     gripZ=0 would push the back half into the chest. Keep the
      //     legacy len/2 forward offset so the visible mesh sits forward
      //     of the wrist.
      //   • long guns (rifle / shotgun / sniper / lmg) — keep the
      //     (len*0.2) offset so the rifle stock overlaps the wrist +
      //     forearm instead of clipping into the body (AK fix 8e5b22e).
      //
      // Muzzle placement: at the FORWARD tip of the visible barrel.
      // Per-class VISIBLE_FACTOR mirrors CLASS_SCALE × 2 (visible
      // bounding-sphere diameter) with small headroom for attachments.
      // SMG keeps the legacy `len` muzzle offset because that's what
      // its center-origin authoring measured against — VISIBLE_FACTOR
      // overshoots when the clone origin is at center, not grip-end.
      gunMesh.rotation.set(0, 0, 0);
      inHandModel.rotation.set(0, 0, 0);
      const isLong = cls === 'rifle' || cls === 'shotgun'
        || cls === 'sniper' || cls === 'lmg';
      // Live tuning knobs — see ANIM_TUNE at module top. Tweakpane
      // panel writes here; setWeapon reads on every weapon swap, so
      // calling player.reattachWeapon() reapplies any panel changes.
      const vf = ANIM_TUNE.visibleFactor[cls] ?? 1.0;
      const gz = ANIM_TUNE.gripZScale[cls] ?? 0.5;
      // Unified grip + muzzle formula across all classes — was three
      // different formulas (isLong / pistol / other) and the
      // visibleFactor slider for SMG/flame/melee did nothing because
      // muzzleZ was hardcoded to `len`. Now: grip = gz × len for all,
      // muzzle = grip + len × vf. Slider drag visibly affects every
      // class. (cls === 'pistol' still pins gz=0 in defaults so the
      // grip lands at the hand on a grip-end-origin clone.)
      const gripZ = gz * len;
      const muzzleZ = gripZ + len * vf;
      // Per-class grip X/Y nudge — for fine-tuning where the visible
      // gun sits relative to the hand-tracked anchor. Z stays driven
      // by gripZScale.
      const go = ANIM_TUNE.gripOffset[cls] || { x: 0, y: 0 };
      gunMesh.position.set(go.x, go.y, gripZ * ws);
      muzzle.position.set(go.x, go.y, muzzleZ * ws);
      inHandModel.position.copy(gunMesh.position);
      // Per-class size multiplier — applied on top of the clone's
      // existing fitToRadius scale. Default 1.0 = no change.
      const sm = ANIM_TUNE.sizeMul[cls] ?? 1.0;
      inHandModel.scale.setScalar(sm);
    } else if (isShouldered) {
      // PROCGEN-RIG FALLBACK — only reached when rig._gunAnchor is
      // unset, i.e. user opted into the primitive procgen rig via
      // localStorage.coldExitDefaultRig='procgen' or __useFbx(null).
      // Default boot uses peek (or GASP) which both set _gunAnchor and
      // hit the GASP branch above instead.
      //
      // Chest-local forward is +Z (no axis swap needed). Stock sits at
      // anchor, barrel extends forward by `len`.
      gunMesh.rotation.set(0, 0, 0);
      inHandModel.rotation.set(0, 0, 0);
      gunMesh.position.set(0, 0, (0.1 + len / 2) * ws);
      muzzle.position.set(0, 0, (0.1 + len) * ws);
      inHandModel.position.copy(gunMesh.position);
    } else {
      // PROCGEN-RIG FALLBACK — pistol / smg / flame / melee on procgen.
      // Same trigger condition as the isShouldered branch above (no
      // _gunAnchor on rig).
      //
      // Hand-local forward is -Y (thanks to the cumulative arm rot).
      // Pistol-class extra: tilt the gun an additional ~30° so the
      // muzzle reads as pointing FORWARD in world space rather than
      // following the wrist's rest-pose drop. The arm-fold position
      // (chestElbow ~ -0.97 rad in firing, ~ -0.72 ready) leaves the
      // wrist's local -Y pointing down-forward; an extra -0.5 rad on
      // gunMesh.rotation.x straightens that to roughly horizontal.
      const muzzleTilt = (cls === 'pistol') ? -0.50 : 0;
      gunMesh.rotation.set(Math.PI / 2 + muzzleTilt, 0, 0);
      inHandModel.rotation.set(Math.PI / 2 + muzzleTilt, 0, 0);
      // Position offset varies by class:
      //   pistol — gun extends forward of the hand by ~grip-to-muzzle
      //            distance (typically ~12cm for a 1911). Previous
      //            -0.04 put the gun INSIDE the wrist; original
      //            (0.1 + len/2) put it 38cm below. Halfway: small
      //            constant offset, no len-scaling (gun shouldn't
      //            grow with muzzleLength when held in hand).
      //   smg    — slightly more forward since off hand grips foregrip
      //   other  — keep the original shouldered-style offset.
      const handYOffset = (cls === 'pistol') ? -0.15 * ws
                       :  (cls === 'smg')    ? -(0.05 + len / 4) * ws
                       :                        -(0.1 + len / 2) * ws;
      gunMesh.position.set(0, handYOffset, 0);
      muzzle.position.set(0, handYOffset - (len / 2) * ws, 0);
      inHandModel.position.copy(gunMesh.position);
    }
    buildAccessories(weapon);
    state.blocking = false;

    // FBX/Mixamo path — toggle the pistol-stance upper-body layer.
    // Pistol/SMG/revolver classes get pistol-locomotion/pistol-idle
    // running as a layered action on top of locomotion (its lower-body
    // tracks were stripped at load in __usePeekPlayer). Shouldered
    // weapons hard-stop the layer so the rifle clip's authored upper
    // body shows. We use action.stop() (not fadeOut) on the rifle path
    // because fadeOut just drops weight to 0 over time but leaves the
    // action in the mixer's running list; if isRunning() then returns
    // a stale value on the next swap the stop branch can be skipped.
    if (rig?._fbx?.actions) {
      const pistolStance = rig._fbx.actions.get('pistol-locomotion/pistol-idle');
      if (pistolStance) {
        // SMGs use rifle locomotion (two-hand grip) — they're shouldered
        // weapons in this game's pose convention even though they're
        // smaller than rifles. Only true sidearms (pistol/revolver)
        // get the one-hand pistol-idle upper-body layer.
        const isOneHand = cls === 'pistol' || cls === 'revolver';
        if (window.__animDebug) console.log(`[setWeapon] cls=${cls} isOneHand=${isOneHand} pistolWasRunning=${pistolStance.isRunning()}`);
        if (isOneHand) {
          pistolStance.setLoop(THREE.LoopRepeat, Infinity);
          if (!pistolStance.isRunning()) {
            pistolStance.reset().fadeIn(0.2).play();
          }
          // Sync the layered-clip tracker so the locomotion tick that
          // also wants pistol-idle as the layered upper-body doesn't
          // restart what setWeapon just kicked off.
          rig._fbx.currentLayeredClipName = 'pistol-locomotion/pistol-idle';
        } else {
          // Hard stop — idempotent if already stopped.
          pistolStance.stop();
          rig._fbx.currentLayeredClipName = null;
        }
      }
    }

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
          pistol: 0.22,   // halved — 0.45 was rendering 1911 ~2× too big in hand
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
    // Per-combo-step swing clip — light / medium / heavy. Layers
    // upper-body only over the locomotion base so legs keep walking
    // through the swing. Missing clip GLBs (not yet imported) no-op
    // gracefully via playOneShot's null return. Duration covers
    // startup + active so the impact frame lands during the active
    // damage window; recovery uses whatever the clip's tail does.
    // Clip timeScale is rescaled so the authored ~1.2 s Mixamo swing
    // finishes within the gameplay window — without this, fast
    // gameplay attacks (~0.4 s) finish their damage before the
    // clip's wind-up arrives, and slow heavies look sluggish.
    const swingClip = `melee/swing-${Math.min(nextStep + 1, 3)}`;
    const swingDur = Math.max(0.1, (attack.startup || 0) + (attack.active || 0));
    const swingAction = playOneShot(swingClip, swingDur, { upperOnly: true, fadeMs: 80 });
    if (swingAction) {
      const clipLen = swingAction.getClip().duration;
      if (clipLen > 0.05) swingAction.timeScale = clipLen / swingDur;
    }
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
    // Quick-melee swing clip — pistol-whip / rifle-butt jab. Same
    // upper-body layer as combo melee. Prefers a dedicated quick-jab
    // clip when present; falls back to the fastest combo swing
    // (melee/swing-1, the horizontal slash) so quick-melee still
    // reads as a swing even if quick-jab.glb hasn't been authored
    // yet. playOneShot returns null when neither clip is loaded.
    const _qDur = Math.max(0.1, (attack.startup || 0) + (attack.active || 0));
    const qClip = rig?._fbx?.actions?.has?.('melee/quick-jab')
      ? 'melee/quick-jab' : 'melee/swing-1';
    playOneShot(qClip, _qDur, { upperOnly: true, fadeMs: 60 });
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
    // Hit-react upper-body flinch — plays the runner pack's
    // basic-shooter/hit-reaction clip layered over locomotion (lower
    // body keeps walking; arms flinch + recoil briefly). Skipped when:
    //   - dealt damage is below 5 HP (chip damage shouldn't constantly
    //     interrupt the player's pose for cosmetic reasons)
    //   - we're already in a one-shot lock (death animation playing)
    //   - a hit-react is already in flight (~250ms cooldown — multi-
    //     pellet shotgun blasts and burst-fire SMG sprays would
    //     otherwise re-trigger each frame and read as a glitch)
    //   - player just died this hit (death clip is the right one to play)
    if (dealt >= 5 && state.health > 0 && rig?._fbx?.actions?.has?.('basic-shooter/hit-reaction')) {
      const _now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const lockUntil = rig._fbx._clipLockUntil || 0;
      const lastHitReactAt = rig._fbx._lastHitReactAt || 0;
      const inLock = lockUntil > _now;
      const offCooldown = (_now - lastHitReactAt) > 250;
      if (!inLock && offCooldown) {
        playOneShot('basic-shooter/hit-reaction', 0.4, { upperOnly: true, fadeMs: 60 });
        rig._fbx._lastHitReactAt = _now;
      }
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
    // Mid-melee dash cancel — when the player is committed to a swing
    // (any phase: startup / active / recovery) OR a gun-held quick-
    // melee, a stamina dash bypasses the normal dashCd gate. Without
    // this, a recent dash's cooldown locks the player into the swing's
    // recovery + the next swing's wind-up, which reads as the dash
    // input being "eaten" during melee. Stamina is still required,
    // so spam-dashing the same swing is naturally rate-limited.
    const a = state.attack;
    const inMeleeCancel = a && (
      a.phase === 'startup' || a.phase === 'active' || a.phase === 'recovery'
    );
    if (!inMeleeCancel && state.dashCd > 0) return false;
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
    // player isn't stuck with stale flags. Return a minimal but
    // well-formed playerInfo stub so callers reading
    // playerInfo.dashStarted etc. don't NPE.
    if (state.downed) {
      return {
        position: group.position,
        aim: aimPoint || null,
        facing: facing.clone ? facing.clone() : { x: 0, y: 0, z: -1 },
        muzzleWorld: muzzle.getWorldPosition
          ? muzzle.getWorldPosition(new THREE.Vector3())
          : new THREE.Vector3(),
        offhandMuzzleWorld: offhandMuzzle?.getWorldPosition
          ? offhandMuzzle.getWorldPosition(new THREE.Vector3())
          : new THREE.Vector3(),
        fireOrigin: null,
        adsAmount: 0,
        mode: state.mode,
        crouched: false,
        crouchSprinting: false,
        iFrames: state.iFrames > 0,
        iFramesRemaining: state.iFrames,
        speed: 0,
        health: state.health,
        regenCap: state.regenCap,
        bleedT: state.bleedT,
        brokenT: state.brokenT,
        maxHealth: state.maxHealth,
        stamina: state.stamina,
        maxStamina: state.maxStamina,
        blocking: false,
        parryActive: false,
        attackEvent: null,
        attackPhase: 'idle',
        attackStep: 0,
        attackWeapon: null,
        attackIsCrit: false,
        dashStarted: false,
        rollStarted: false,
        slideStarted: false,
        // Defensive: anything else readers might index. Empty/falsy
        // values keep behaviour neutral.
        airborne: false,
        equipped: state.equipped || null,
        downed: true,
      };
    }
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
    if (state.hitFlashT > 0 && rig.materials?.bodyMat?.color) {
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
    // FBX path — when an FBX rig is loaded (rig._fbx present),
    // updateAnim's procedural code is bypassed and the AnimationMixer
    // drives the bones from the embedded clips. Map player state to
    // a clip name; loadCharacterFBX returns a rig.play(name) helper
    // that handles the cross-fade.
    if (rig._fbx) {
      // Position sync — game movement code drives `player.mesh`
      // (the procgen rig group, kept in scene + hidden after swap).
      // Mirror its world position + rotation onto the FBX group so
      // the FBX character moves with the player.
      const procgenGroup = window.__player?._procgenRig?.group;
      if (procgenGroup) {
        rig.group.position.copy(procgenGroup.position);
        rig.group.rotation.copy(procgenGroup.rotation);
      }
      // Defensive clamp — never let the rig dip below ground. The
      // upstream sources (gameplay physics, coop interp, animation
      // scale offsets) shouldn't go negative, but if any of them
      // produce a transient negative Y, this catches it before the
      // visible glitch lands. window.__animDebug logs the source.
      if (rig.group.position.y < 0) {
        if (window.__animDebug) {
          console.warn('[fbx] rig.group.y dipped below 0 — clamping', {
            y: rig.group.position.y,
            procgenY: procgenGroup?.position.y,
            time: performance.now().toFixed(0),
          });
        }
        rig.group.position.y = 0;
      }
      // Crouch sink — the GASP crouch clips fold the legs (knees
      // bent, feet still extended outward) but I stripped pelvis
      // position tracks at conversion time, so the pelvis Y stays
      // at standing height and the legs visually fold UP toward the
      // pelvis. Compensate by lowering the whole rig group: the
      // amount needs to roughly match how much the legs fold so
      // the feet wind up on the ground at crouched height.
      // 0.55m gets us there empirically (1.15× scaled rig with
      // ~1.0m crouched leg compression). Eased lerp for smooth
      // transitions in/out of crouch.
      // Crouch sink — calibrated so feet stay AT ground level when
      // the leg-fold from the clip lifts them (= silhouette appears
      // shorter without clipping through ground). 0.35m matches
      // ~0.30m visible ankle-rise from the GASP crouch loops at
      // 1.15× rig scale. Symmetric 18/s lerp — fast enough that
      // crouch-walk doesn't flicker, gentle enough that the
      // standing-up rise isn't a snap. Final position clamped to
      // >=0 so even mid-transition we never go subterranean.
      // Foot ground-clamp — replaces the static crouch sink. Reads
      // the lowest foot bone's world Y AFTER mixer.update applies
      // the locomotion/crouch clip pose, then sinks the rig group
      // by exactly that amount so the lowest foot lands at world
      // Y=0 (ground). Works for any clip — standing, walking,
      // crouching, idle — without per-clip sink tuning.
      // Resolved on first call.
      if (!rig._fbx._footBones) {
        // Prefer the registry-driven abstract refs (rig.leftLeg.ankle /
        // rightLeg.ankle) so this works on any rig (gasp_uefn → foot_l/r,
        // mixamo → mixamorigLeftFoot/RightFoot, etc.). Fall back to the
        // hardcoded UE5 names if the abstract refs aren't populated
        // (legacy procgen path).
        const fromAbstract = [rig.leftLeg?.ankle, rig.rightLeg?.ankle].filter(Boolean);
        if (fromAbstract.length) {
          rig._fbx._footBones = fromAbstract;
        } else {
          const bones = rig._fbx.bonesByName;
          rig._fbx._footBones = ['foot_l', 'foot_r']
            .map(n => bones?.get(n) || null)
            .filter(Boolean);
        }
      }
      let lowestFootY = Infinity;
      for (const fb of rig._fbx._footBones) {
        fb.getWorldPosition(_handTrackV);
        if (_handTrackV.y < lowestFootY) lowestFootY = _handTrackV.y;
      }
      if (lowestFootY === Infinity) lowestFootY = 0;
      // Foot bone sits at the ankle — the visible foot mesh extends
      // BELOW the ankle by ~8cm on a typical Mixamo/GASP rig. Without
      // this offset, the ground-clamp lifts only until the ANKLE is
      // at Y=0, which leaves the toes/sole poking through the floor.
      // Override per-rig via rig._fbx.footGroundOffset if a character
      // export uses different proportions (e.g. taller boots).
      const FOOT_GROUND_OFFSET = rig._fbx.footGroundOffset ?? 0.08;
      const wantSink = -lowestFootY + FOOT_GROUND_OFFSET;
      const cur = rig._fbx._crouchSinkY ?? 0;
      // Asymmetric lerp inverted from the previous attempt:
      //   wantSink > cur (lowestFoot is BELOW ground, rig should
      //                  RISE to un-clip): fast (25/s)
      //   wantSink < cur (lowestFoot is ABOVE ground, rig wants
      //                  to SINK to chase a lifted foot): slow
      //                  (2/s) — running airborne phase looks
      //                  natural when feet briefly fly above
      //                  ground; chasing them down bobs the rig.
      // Big transitions like crouch toggle: symmetric 12/s.
      const goingUp = wantSink > cur;
      const bigTransition = Math.abs(wantSink - cur) > 0.10;
      const rate = bigTransition
        ? 12
        : (goingUp ? 25 : 2);
      rig._fbx._crouchSinkY = cur + (wantSink - cur) * (1 - Math.exp(-rate * dt));
      rig.group.position.y += rig._fbx._crouchSinkY;
      // The SkinnedMesh inside the rig may have its OWN position
      // mutated by the loaded clip (some packs author the mesh's
      // root translation rather than a hip-bone position track).
      // Lock its local position to whatever it was at load time so
      // animations can't translate it. Cached on first hit.
      const sk = rig._fbx._skinnedMesh ||= (() => {
        let m = null;
        rig.group.traverse(o => { if (o.isSkinnedMesh && !m) m = o; });
        if (m) rig._fbx._skinnedMeshBaseY = m.position.y;
        return m;
      })();
      if (sk && rig._fbx._skinnedMeshBaseY !== undefined) {
        sk.position.y = rig._fbx._skinnedMeshBaseY;
      }
      // GASP locomotion path — engaged when the rig was loaded via
      // __useGaspMannequin() which sets rig._fbx.useGaspLocomotion.
      // Drives the LOWER body via 8-way directional clip selection
      // (forward / back / diagonals at walk / run / sprint / crouch
      // tiers) computed from velocity vs body-yaw. Upper body is
      // owned by the IK solve below.
      if (rig._fbx.useGaspLocomotion) {
        _ensureGaspSmLoaded();
        // ============================================================
        // ROOT ORIENTATION — per design spec §7:
        //   Root follows MOVEMENT direction (hipfire), with
        //   compensation: if movement-vs-aim exceeds twist limit,
        //   root catches up toward aim so chest doesn't over-twist.
        //   ADS overrides: root snaps to aim (cleaner aim, lets
        //   directional locomotion clips read correctly).
        //   Idle: root slowly rotates toward aim direction.
        // ============================================================
        const cursorYaw = aimPoint
          ? Math.atan2(aimPoint.x - rig.group.position.x, aimPoint.z - rig.group.position.z)
          : (state.bodyYaw || 0);
        const adsAmt = state.adsAmount || 0;
        const ads = adsAmt > 0.5;
        // RIGID CURSOR FOLLOW — body always tracks cursor regardless
        // of ADS / hipfire / moving / idle. User: 'lets go with the
        // consolation of making everything act like ADS does now.
        // rigid follow of the cursor upper body.' Drops the
        // hipfire-follows-movement / idle-slow-rotation modes.
        const targetYaw = cursorYaw;
        const lerpRate = 20;
        // Twist clamp = 0 since body == aim by construction.
        const TWIST_LIMIT = 0;
        // Track GASP body yaw INDEPENDENTLY of procgen — the
        // procgenGroup.rotation.copy() above resets rig.group.y to
        // procgen's lagging body yaw each frame, so a + lerp on
        // top would only ever close half the gap. We persist our
        // own _bodyYaw on rig._fbx and write it directly.
        let curBody = rig._fbx._bodyYaw;
        if (curBody === undefined) curBody = rig.group.rotation.y;
        let dyaw = targetYaw - curBody;
        while (dyaw >  Math.PI) dyaw -= 2 * Math.PI;
        while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
        curBody += dyaw * (1 - Math.exp(-lerpRate * dt));
        rig._fbx._bodyYaw = curBody;
        rig.group.rotation.y = curBody;
        // Chest twist = aim minus current body yaw (post-lerp).
        let chestTwist = cursorYaw - rig.group.rotation.y;
        while (chestTwist >  Math.PI) chestTwist -= 2 * Math.PI;
        while (chestTwist < -Math.PI) chestTwist += 2 * Math.PI;
        chestTwist = Math.max(-TWIST_LIMIT - 0.1, Math.min(TWIST_LIMIT + 0.1, chestTwist));
        // Pass-through — earlier 22/s smoother was filtering too
        // aggressively and reading as cursor-tracking lag. Cursor
        // is already smoothed upstream; chestTwist follows directly.
        state.chestTwist = chestTwist;
        // Gun-anchor lerps between hipfire (chest height ≈ 1.30m
        // after the 1.15× rig scale → ~1.50 visible) and ADS
        // (eye-line ≈ 1.55m → ~1.78 visible). Forward distance
        // stays steady (gun extends past hands at all times).
        // YAW — anchor faces cursor exactly (in body-local terms):
        //   anchor.y = cursorYaw - bodyYaw
        // So the BULLET ORIGIN always points at the cursor, even
        // while the body lags within the chest-twist deadzone.
        if (rig._gunAnchor && !ANIM_TUNE.arm.disableAllIK) {
          const ads = state.adsAmount || 0;
          // Track the dominant hand-bone's WORLD position so the
          // gun visually pins to the hand. Damped lerp so the
          // anchor doesn't shake with locomotion-clip arm-swing.
          // GATED by disableAllIK because the user's tuned gripOffsets
          // are dialled relative to the STATIC default anchor at
          // (anchorOffset). Letting the anchor lerp shifts the
          // reference frame and breaks every per-class tune.
          const handBone = state.handedness === 'right'
            ? rig.rightArm?.wrist
            : rig.leftArm?.wrist;
          if (handBone) {
            handBone.getWorldPosition(_handTrackV);
            // Convert world hand position to rig.group local.
            rig.group.worldToLocal(_handTrackV);
            // Direct additive offset — visibly shifts the gun-anchor
            // relative to the dominant hand bone. Live-tunable via
            // ANIM_TUNE.arm.anchorOffset. Per-axis lerp rate dampens
            // vertical bob (Y) more than horizontal/depth so gun
            // doesn't visibly bounce on each running stride.
            const ao = ANIM_TUNE.arm.anchorOffset;
            const al = ANIM_TUNE.arm.anchorLerp;
            rig._gunAnchor.position.x += ((_handTrackV.x + ao.x) - rig._gunAnchor.position.x) * al.x;
            rig._gunAnchor.position.y += ((_handTrackV.y + ao.y) - rig._gunAnchor.position.y) * al.y;
            rig._gunAnchor.position.z += ((_handTrackV.z + ao.z) - rig._gunAnchor.position.z) * al.z;
          } else {
            // No hand bone available (procgen rig fallback). Hold the
            // anchor at a chest-forward fixed point with the offset.
            const ao = ANIM_TUNE.arm.anchorOffset;
            rig._gunAnchor.position.set(0 + ao.x, 1.30 + ao.y, 0.45 + ao.z);
          }
          let gunYaw = cursorYaw - rig.group.rotation.y;
          while (gunYaw >  Math.PI) gunYaw -= 2 * Math.PI;
          while (gunYaw < -Math.PI) gunYaw += 2 * Math.PI;
          // Pitch the gun anchor toward target Y when the cursor is
          // significantly above or below chest height — head shots,
          // dropped enemies, low-cover targets all need the muzzle
          // angled rather than parallel-to-ground.
          let gunPitch = 0;
          if (aimPoint) {
            const chestWorldY = rig.group.position.y + 1.30;
            const dy = aimPoint.y - chestWorldY;
            const dxz = Math.hypot(aimPoint.x - rig.group.position.x,
                                   aimPoint.z - rig.group.position.z);
            if (dxz > 0.1) {
              // Apply only past a deadband so flat aim stays flat.
              const rawPitch = Math.atan2(dy, dxz);
              if      (rawPitch >  0.10) gunPitch = -(rawPitch - 0.10);
              else if (rawPitch < -0.10) gunPitch = -(rawPitch + 0.10);
              gunPitch = Math.max(-0.6, Math.min(0.6, gunPitch));
            }
          }
          rig._gunAnchor.rotation.set(gunPitch, gunYaw, 0);
        }
        // Hipfire arm-pitch baseline. Was -0.18 rad (~10° upward)
        // to lift the GASP Pistol clips' low-ready arms up to
        // chest height. User wants arms lowered for hipfire across
        // the board, so the offset is now +0.10 (~6° downward) —
        // arms hang naturally at hip level when not ADS, and
        // smoothly raise to clip-authored aim level as adsAmt → 1.
        // Bump magnitude if arms still read too high; flip sign
        // to restore old behavior.
        state._gaspPitchOffset = (1 - adsAmt) * (ANIM_TUNE.arm.gaspPitchHipfire ?? 0.10);
        // Arm-shoulder twist for extended aim range — when the
        // cursor is FAR off-axis (residual past the chest's 45°
        // limit), rotate the dominant clavicle / upperarm to point
        // toward the gun-anchor direction. Visually: the chest
        // twists 45°, the firing-side shoulder pulls forward by
        // half the residual, and the gun extends laterally on the
        // anchor. Smoothes the pose so the arm doesn't visibly
        // disconnect from the gun.
        const residual = Math.max(0, Math.abs(chestTwist === TWIST_LIMIT ? (cursorYaw - rig.group.rotation.y) : 0) - TWIST_LIMIT);
        const armYawTotal = residual * Math.sign(cursorYaw - rig.group.rotation.y) * 0.5;
        const armBone = state.handedness === 'right'
          ? rig.rightArm?.shoulder?.pivot
          : rig.leftArm?.shoulder?.pivot;
        // REGRESSION: anim-arm-base-clobber — only modify the shoulder
        // when we actually have a residual to apply, and apply it as a
        // multiply on top of the clip-driven pose rather than reset-to-
        // first-frame. The previous reset-every-frame branch captured
        // _armBaseQ from whichever clip was playing on the first call
        // (often rifle-8way/idle's down-at-side arm) and locked the
        // dominant shoulder to that pose forever, killing pistol/SMG
        // one-handed arm composition. Phase D deferred fix.
        if (armBone && armBone.quaternion && Math.abs(armYawTotal) > 0.001) {
          _aimDeltaE.set(0, armYawTotal, 0, 'YXZ');
          _aimDeltaQ.setFromEuler(_aimDeltaE);
          armBone.quaternion.multiply(_aimDeltaQ);
        }
        if (_gaspSmCfg) {
          // Populate _availableClips lazily so the selector's
          // _Pistol → _OneHand_Pistol / _Rifle suffix swap can verify
          // the candidate clip exists. The runner_lower_body path sets
          // this in main.js __usePeekPlayer; the default gasp_lower_body
          // load doesn't, so without this the OneHand_Pistol swap silently
          // no-ops and pistols idle in two-handed pose.
          if (!_gaspSmCfg._availableClips && rig._fbx?.actions) {
            _gaspSmCfg._availableClips = new Set(rig._fbx.actions.keys());
          }
          // Use the ACTUAL world velocity for sector picking. Body is
          // rigid-locked to cursor; velocity-vs-body-yaw gives the
          // honest body-relative motion direction. When cursor and
          // movement disagree (e.g. cursor left, D-key world right),
          // the velocity ends up body-back-or-side and the picker
          // selects the appropriate backstep / strafe clip.
          // (Earlier body-relative synth from input.move was hiding
          // this — D always returned body-right regardless of
          // velocity, so cursor-vs-velocity disagreement read as
          // walk_FR even when the real motion was a backpedal.)
          let pick = selectGaspLocomotion(_gaspSmCfg, state, planarSpeed, velocity, rig.group.rotation.y);
          // Dash override: while in DASH/SLIDE the picker would just
          // return the highest-speed locomotion clip (sprint_F or
          // a clamped run_F), which doesn't read as a discrete dash.
          // Force sprint_F regardless of velocity direction so the
          // forward-driving lean of the sprint clip plays no matter
          // which direction the dash is in (body's already locked
          // to cursor; sprint reads as dash visually). Pair with a
          // bumped timeScaleClamp upper bound so the legs whip.
          const isDash = state.mode === MODE.DASH || state.mode === MODE.SLIDE;
          if (isDash && _gaspSmCfg.states?.sprint_F) {
            const sprint = _gaspSmCfg.states.sprint_F;
            const wantSuffix = state?.equipped?.class
              && (state.equipped.class === 'rifle' || state.equipped.class === 'shotgun'
                  || state.equipped.class === 'sniper' || state.equipped.class === 'lmg');
            const clipName = wantSuffix && sprint.adsClip ? sprint.adsClip : sprint.clip;
            pick = {
              stateId: 'sprint_F',
              clip: clipName,
              loop: sprint.loop !== false,
              speedRef: 4.0,                           // slightly slower than sprint's 6.0 baseline so timeScale > 1
              sector: 'F',
              bucket: 'dash',
              playback: { fadeMs: 80, timeScaleClamp: [1.4, 2.4] },
              weaponClass: state?.equipped?.class,
            };
          }
          if (window.__animDebug && pick && rig._fbx.currentClipName !== pick.clip) {
            console.log(`[gasp] sector=${pick.sector} bucket=${pick.bucket} clip=${pick.clip}`,
              `body=${rig.group.rotation.y.toFixed(2)} cursor=${cursorYaw.toFixed(2)}`,
              `mv=(${input?.move?.x?.toFixed(2) ?? '?'},${input?.move?.y?.toFixed(2) ?? '?'})`,
              `vel=(${velocity.x.toFixed(2)},${velocity.z.toFixed(2)})`,
              `pickVel=(${pickVel.x?.toFixed(2)},${pickVel.z?.toFixed(2)}) ads=${ads}`);
          }
          if (pick && rig._fbx.currentClipName !== pick.clip) {
            // One-shot lock — death / reload / hit-react / jump phase
            // sets _clipLockUntil so the locomotion selector doesn't
            // immediately overwrite the held / playing clip on the
            // next frame. Lock auto-clears when the wall-clock passes
            // its deadline (Infinity for death = never auto-clear).
            const _now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            if (rig._fbx._clipLockUntil && _now < rig._fbx._clipLockUntil) {
              // Locked — leave the held one-shot in place this frame.
            } else {
              const action = rig.play(pick.clip, { fadeMs: pick.playback?.fadeMs ?? 200, loop: pick.loop });
              rig._fbx.currentClipName = pick.clip;
              rig._fbx.currentAction = action;
            }
          }
          // Layered upper-body swap — pistol/revolver class plays a
          // pistol-locomotion clip on top of the rifle-8way base so the
          // upper body holds the grip + swings to match the gait while
          // the lower body keeps the tuned rifle stride. Lower-body
          // tracks were stripped from these clips at load time. We
          // cross-fade at the same cadence as the base.
          const wantLayered = pick?.layeredClip || null;
          if (wantLayered !== rig._fbx.currentLayeredClipName) {
            const fadeS = (pick?.playback?.fadeMs ?? 200) / 1000;
            const prevName = rig._fbx.currentLayeredClipName;
            const prevAction = prevName ? rig._fbx.actions?.get(prevName) : null;
            if (prevAction && prevAction.isRunning()) prevAction.fadeOut(fadeS);
            if (wantLayered && rig.playLayered) {
              rig.playLayered(wantLayered, { fadeMs: pick?.playback?.fadeMs ?? 200, loop: true });
            }
            rig._fbx.currentLayeredClipName = wantLayered;
          }
          // Compute timeScale from the base clip's speedRef and apply
          // to BOTH the base and the layered upper-body action so the
          // pistol-locomotion arm-swing stays phase-locked with the
          // rifle-8way leg cycle. Without mirroring, the base runs at
          // planarSpeed/speedRef while the layered plays at 1.0; they
          // drift, the layered loop restarts mid-base-stride, and the
          // arms hiccup as the cycle resets while the legs continue.
          let layeredTimeScale = 1.0;
          if (pick?.speedRef && rig._fbx.currentAction) {
            const clamp = pick.playback?.timeScaleClamp ?? [0.5, 1.5];
            const ts = Math.max(clamp[0], Math.min(clamp[1], planarSpeed / pick.speedRef));
            rig._fbx.currentAction.timeScale = ts;
            layeredTimeScale = ts;
          } else if (rig._fbx.currentAction) {
            rig._fbx.currentAction.timeScale = 1.0;
          }
          if (rig._fbx.currentLayeredClipName) {
            const layeredAction = rig._fbx.actions?.get(rig._fbx.currentLayeredClipName);
            if (layeredAction) layeredAction.timeScale = layeredTimeScale;
          }
          rig.update(dt);
          // Upper body IK — point the wrists at the aim target. The
          // arms came from the locomotion clip (which is a gun-pose
          // clip with arms forward); IK overwrites the arm bones to
          // make them track the cursor. Chest + head get yaw/pitch
          // additive deltas via the existing world-space IK math.
          _runUpperBodyIK(rig, state, aimPoint, aimPitch, dt);
          // Pin the gun anchor to the hand bone's clip-driven delta
          // so the gun follows arm swing, reload reach, etc. Runs
          // independently of disableAllIK — the IK pipeline above is
          // gated, but hand-follow is a pure read-and-mirror, no
          // bone overrides involved.
          _updateGunFollow(rig, state);
          // Done with anim for this frame.
          // Skip the remainder of the FBX clip-selection block via
          // a continue-like construct: structured as a labeled
          // break-out. Use an early return-from-function would skip
          // the gameplay-update tail; we use a conditional flag.
          rig._fbx._gaspHandled = true;
        }
      }
      if (rig._fbx._gaspHandled) {
        rig._fbx._gaspHandled = false;
        // Re-enter outer loop for next frame.
      } else {
      // Clip selection — sourced from
      // Assets/anim_data/states/cold_exit_player.json via the JSON
      // state machine (src/anim/state_machine.js). The JSON encodes
      // the same priority cascade that lived inline here previously;
      // the fallback path below mirrors it for the brief window
      // before the SM JSON finishes loading on first run.
      _ensurePlayerSmLoaded();
      let target, loop, speedRef, fadeMs, tsClamp;
      // Phase 2 — layered graph path. Engaged ONLY when:
      //   1. SM JSON has `layers`
      //   2. The rig has clips for every state both layers reference
      //   3. The rigCfg has logicalGroups (top/bottom mask data)
      // Otherwise fall through to the Phase 1 single-track path so
      // existing behaviour is preserved when prereqs aren't met.
      let usedLayered = false;
      if (_playerSmCfg && _playerSmCfg.layers && rig._fbx.rigCfg?.logicalGroups) {
        if (!rig._fbx.graph) {
          // Pre-flight: only attach the graph if every required clip
          // exists on the rig. Otherwise stick with single-track.
          const allClipsPresent = _playerSmCfg.layers.every(L =>
            Object.values(L.states || {}).every(s => rig._fbx.actions.has(s.clip))
          );
          if (allClipsPresent) {
            const g = attachGraph(rig);
            for (const L of _playerSmCfg.layers) {
              g.defineLayer(L.name, {
                boneMaskGroup: L.boneMaskGroup || null,
                additive: !!L.additive,
                blendMs: L.blendMs ?? 180,
              });
            }
            if (window.__animDebug) console.log('[player/anim] Phase 2 layered graph engaged');
          } else {
            // Mark so we don't retry every frame.
            rig._fbx.layeredUnavailable = true;
          }
        }
        if (rig._fbx.graph) {
          const layered = selectLayeredFromPlayerState(_playerSmCfg, state, planarSpeed);
          if (layered) {
            for (const L of layered.layers) {
              if (!L.pick) continue;
              const cur = rig._fbx.graph.tracks[rig._fbx.graph.layerByName.get(L.name)];
              const curClip = cur?.action?.getClip().name || null;
              if (curClip !== L.pick.clip) {
                rig._fbx.graph.playOnLayer(L.name, L.pick.clip, {
                  loop: L.pick.loop,
                  weight: 1.0,
                });
              }
              // Speed-match locomotion timeScale on the layer.
              if (L.pick.speedRef && cur?.action) {
                const clamp = L.pick.playback?.timeScaleClamp ?? [0.5, 1.5];
                const ts = Math.max(clamp[0], Math.min(clamp[1], planarSpeed / L.pick.speedRef));
                cur.action.timeScale = ts;
              } else if (cur?.action) {
                cur.action.timeScale = 1.0;
              }
            }
            usedLayered = true;
          }
        }
      }
      if (!usedLayered && _playerSmCfg) {
        const pick = selectFromPlayerState(_playerSmCfg, state, planarSpeed);
        if (pick) {
          target = pick.clip;
          loop = pick.loop;
          speedRef = pick.speedRef;
          fadeMs = pick.playback?.fadeMs ?? 180;
          tsClamp = pick.playback?.timeScaleClamp ?? [0.5, 1.5];
        }
      }
      if (!target) {
        // Legacy fallback (matches the JSON exactly). Used only until
        // the SM JSON resolves on first run.
        const aim = (state.adsAmount || 0) > 0.4;
        const swinging = state.attack && state.attack.phase !== 'idle';
        const moving = planarSpeed > 0.05;
        const running = planarSpeed > 3.5;
        const crouched = !!state.crouched;
        const SPEED_REF = {
          W1_Walk_Aim_F_Loop_IPC: 1.6,
          W1_Jog_Aim_F_Loop_IPC: 3.5,
          W1_CrouchWalk_Aim_F_Loop_IPC: 1.0,
        };
        if (swinging) {
          target = crouched ? 'W1_Crouch_Fire_Single' : 'W1_Stand_Fire_Single';
          loop = false;
        } else if (crouched && moving) {
          target = 'W1_CrouchWalk_Aim_F_Loop_IPC'; loop = true;
        } else if (crouched) {
          target = aim ? 'W1_Crouch_Aim_Idle_IPC' : 'W1_Crouch_Idle_IPC'; loop = true;
        } else if (running) {
          target = 'W1_Jog_Aim_F_Loop_IPC'; loop = true;
        } else if (moving) {
          target = 'W1_Walk_Aim_F_Loop_IPC'; loop = true;
        } else {
          target = aim ? 'W1_Stand_Aim_Idle_IPC' : 'W1_Stand_Relaxed_Idle_IPC';
          loop = true;
        }
        speedRef = SPEED_REF[target] ?? null;
        fadeMs = 180;
        tsClamp = [0.5, 1.5];
      }
      if (!usedLayered) {
        if (target && rig._fbx.currentClipName !== target) {
          const action = rig.play(target, { fadeMs, loop });
          if (window.__animDebug) {
            const bindings = action?._propertyBindings || [];
            const bound = bindings.filter(b => b && b.binding && b.binding.node).length;
            console.log(`[fbx] clip → ${target} (action=${!!action}, tracks=${action?.getClip().tracks.length}, bound=${bound}, speed=${planarSpeed.toFixed(2)})`);
          }
          rig._fbx.currentClipName = target;
          rig._fbx.currentAction = action;
        }
        // Match the playing clip's timeScale to actual ground speed.
        if (speedRef && rig._fbx.currentAction) {
          const ts = Math.max(tsClamp[0], Math.min(tsClamp[1], planarSpeed / speedRef));
          rig._fbx.currentAction.timeScale = ts;
        } else if (rig._fbx.currentAction) {
          rig._fbx.currentAction.timeScale = 1.0;
        }
        rig.update(dt);
      } else {
        // Layered path — graph.step() ticks the shared mixer.
        rig._fbx.graph.step(dt);
      }
      // Aim IK — additive on top of the clip pose. CRITICAL: clips
      // like W1_Stand_Aim_Idle_IPC don't necessarily key every spine
      // bone, so we can't trust the mixer to reset rig.chest /
      // rig.head each frame. If we just multiplied deltaQ onto the
      // current quaternion, the delta would accumulate frame after
      // frame → continuous spin (the "rotates like a clock" bug).
      //
      // Fix: cache the bone's post-mixer quaternion ONCE per swap
      // (the clip's authored bind-rotation), and each frame RESTORE
      // it before applying the fresh delta. Net result: bone.q is
      // (clipBase * deltaQ) every frame regardless of whether the
      // mixer wrote it, with no accumulation.
      const aimYaw = state.chestTwist || 0;
      const fbx = rig._fbx;
      // Apply IK in WORLD space and convert back to bone-local. The
      // bone's final world rotation should be:
      //   parentWorld * localBase * localDelta  ==  worldDelta * parentWorld * localBase
      // Solving for localDelta:
      //   localDelta = (parentWorld * localBase)^-1 * worldDelta * (parentWorld * localBase)
      const applyWorldIK = (bone, baseKey, yawAmt, pitchAmt) => {
        if (!bone || !bone.quaternion || !bone.parent) return;
        if (!fbx[baseKey]) fbx[baseKey] = bone.quaternion.clone();
        bone.quaternion.copy(fbx[baseKey]);
        // Build world-space delta — pitch around world X, yaw around world Y.
        _aimDeltaE.set(pitchAmt, yawAmt, 0, 'YXZ');
        _aimDeltaQ.setFromEuler(_aimDeltaE);
        // M = parentWorld * localBase  (bone's world quaternion at clip-base).
        bone.parent.getWorldQuaternion(_aimParentWorldQ);
        _aimComposeQ.copy(_aimParentWorldQ).multiply(fbx[baseKey]);
        // localDelta = M^-1 * worldDelta * M
        // Reuse _aimDeltaQ slot for the result.
        const localDelta = _aimComposeQ.clone().invert().multiply(_aimDeltaQ).multiply(_aimComposeQ);
        bone.quaternion.multiply(localDelta);
      };
      applyWorldIK(rig.chest, '_aimChestBase', aimYaw * 0.60, aimPitch * 0.55);
      applyWorldIK(rig.head,  '_aimHeadBase',  aimYaw * 0.40, aimPitch * 0.45);
      } // end of !_gaspHandled branch
    } else {
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
    } // end procgen rig branch (FBX rig branch returned above)

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
    // Gun-barrel forward direction — derived from the actual gun's
    // grip→muzzle vector each frame. Lasers and any other "the gun
    // is pointing this way" effect should use THIS rather than
    // recomputing forward from cursor-minus-muzzle, because at
    // certain aim angles the muzzle's world position can swing past
    // the cursor (the muzzle traces a circle around the player as
    // they turn) and cursor-based forward briefly flips backward.
    const _muzzleW = muzzle.getWorldPosition(new THREE.Vector3());
    const _gripW = gunMesh.getWorldPosition(new THREE.Vector3());
    const _muzzleForward = _muzzleW.clone().sub(_gripW);
    if (_muzzleForward.lengthSq() > 1e-6) _muzzleForward.normalize();
    else _muzzleForward.set(0, 0, 1);
    return {
      position: group.position,
      aim: aimPoint || null,
      facing: facing.clone(),
      muzzleWorld: _muzzleW,
      gripWorld: _gripW,
      muzzleForward: _muzzleForward,
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
  function kickRecoil() {
    // Procgen path: existing pokeRecoil writes per-frame chest/arm
    // offsets. GASP/FBX path: trigger a short additive pulse stored
    // on rig._fbx that decays over ~180ms — chest pitches back, gun
    // muzzle rises, lerps back to neutral. Read by _runUpperBodyIK
    // and the gun anchor each frame. Magnitude scales with weapon
    // class so a sniper kicks harder than a pistol.
    if (rig._fbx) {
      const cls = state.equipped?.class;
      const amt = cls === 'sniper' ? 0.18
                : cls === 'shotgun' ? 0.16
                : cls === 'lmg' ? 0.13
                : cls === 'rifle' ? 0.12
                : cls === 'smg' ? 0.08
                : cls === 'flame' ? 0.04
                : 0.10;             // pistol / default
      rig._fbx._recoilT = 0.18;
      rig._fbx._recoilAmt = amt;
    } else {
      pokeRecoil(rig);
    }
  }
  function reactToHit(dirX, dirZ, mag) { pokeHit(rig, dirX, dirZ, mag); }
  function reactToDeath(dirX, dirZ, mag) {
    pokeDeath(rig, dirX, dirZ, mag);
    // FBX/Mixamo path — pick a death clip based on impact direction
    // (front/back/right) and lock locomotion off so the locomotion
    // selector doesn't override it on the next frame. Mirror right →
    // left via the rig group's local frame; we only have death-from-right
    // in the runner pack.
    if (rig?._fbx?.actions) {
      const bodyYaw = rig.group.rotation.y;
      const fx = -Math.sin(bodyYaw), fz = -Math.cos(bodyYaw);     // body forward (faces -Z at yaw 0)
      const rx =  Math.cos(bodyYaw), rz = -Math.sin(bodyYaw);     // body right
      const len = Math.hypot(dirX, dirZ) || 1;
      const dx = dirX / len, dz = dirZ / len;
      const dotF = dx * fx + dz * fz;
      const dotR = dx * rx + dz * rz;
      let clip;
      if (Math.abs(dotR) > Math.abs(dotF)) clip = 'rifle-8way/death-from-right';
      else if (dotF > 0)                   clip = 'rifle-8way/death-from-the-front';
      else                                 clip = 'rifle-8way/death-from-the-back';
      playOneShot(clip, Infinity, { hold: true, fadeMs: 120 });
    }
  }

  // Play a single one-shot clip (death, reload, hit-react, jump phase)
  // and optionally lock locomotion off for `durationSeconds`. Pass
  // Infinity to lock until reset (death). With `hold: true` the final
  // frame is clamped so the rig stays in the end pose. With
  // `upperOnly: true` the clip plays LAYERED on top of the locomotion
  // (reload, fire, hit-react) — caller is responsible for stripping
  // the clip's lower-body tracks ahead of time so legs keep walking.
  // Returns the AnimationAction or null if the clip isn't loaded.
  function playOneShot(clipName, durationSeconds, opts = {}) {
    if (!rig?._fbx?.actions?.has?.(clipName)) return null;
    let action;
    if (opts.upperOnly && rig.playLayered) {
      action = rig.playLayered(clipName, { fadeMs: opts.fadeMs ?? 100, loop: false });
    } else {
      action = rig.play(clipName, { fadeMs: opts.fadeMs ?? 100, loop: false });
    }
    if (!action) return null;
    action.setLoop(THREE.LoopOnce, 1);
    if (opts.hold) action.clampWhenFinished = true;
    // Lock locomotion-clip swap only when the one-shot fully owns the
    // body. Layered upper-body clips (reload etc.) leave the locomotion
    // selector free to keep the legs walking.
    if (!opts.upperOnly) {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      rig._fbx._clipLockUntil = durationSeconds > 1e6 ? Infinity : now + durationSeconds * 1000;
      rig._fbx.currentClipName = clipName;
      rig._fbx.currentAction = action;
    }
    return action;
  }

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
    // Re-baseline the hand-follow reference against the newly
    // dominant wrist so the gun's chest-forward base position
    // anchors to the new side instead of the old.
    if (rig) rig._gunFollowRef = null;
    // Note: the visual body pose itself doesn't mirror here. A
    // proper left-handed body pose requires either authored
    // left-handed clips or a per-bone mirror retarget, both of
    // which are larger projects. Earlier attempt to use
    // rig.group.scale.x = -1 produced a vertical flip due to the
    // imported rig's internal rotation conventions — don't retry
    // that without first untangling the bone-axis convention.
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
  // Three new silhouettes added 2026-05-04 — recon (urban grey-tan,
  // light), juggernaut (heavy plate, deep red trim), wraith (matte
  // black w/ teal accent). Same rig + decorations, different palettes.
  // Cheap to add — just material color writes. Marine kept for
  // backwards compat with anyone who has it saved.
  const RECON_COLORS = {
    body: 0x4a5060, head: 0x8a8b78, leg: 0x6a6e78, arm: 0x4a5060,
    hand: 0x2c2e34, gear: 0x9aa48a, boot: 0x1c1e22,
  };
  const JUGGERNAUT_COLORS = {
    body: 0x3a2624, head: 0x141518, leg: 0x2a1f1d, arm: 0x3a2624,
    hand: 0x1c1010, gear: 0xa83840, boot: 0x140a0a,
  };
  const WRAITH_COLORS = {
    body: 0x0c0d10, head: 0x080a0c, leg: 0x080a0c, arm: 0x0c0d10,
    hand: 0x040608, gear: 0x2c8aa0, boot: 0x040608,
  };
  const STYLE_PALETTE = {
    operator: OPERATOR_COLORS,
    marine: MARINE_COLORS,
    recon: RECON_COLORS,
    juggernaut: JUGGERNAUT_COLORS,
    wraith: WRAITH_COLORS,
  };
  // Cache the active style baseline. applyArmorTint reads from this
  // when an armor slot is empty, so the body falls back to the
  // operator/marine palette instead of staying tinted.
  let _styleBase = OPERATOR_COLORS;
  function applyCharacterStyle(style) {
    const isMarine = style === 'marine';
    const p = STYLE_PALETTE[style] || OPERATOR_COLORS;
    _styleBase = p;
    // FBX rig has its own per-mesh MeshStandardMaterials baked into
    // the loaded asset — no rig.materials.{bodyMat, ...} to poke.
    // Cache the palette so a later FBX-material-swap pipeline can
    // pick it up; bail early to avoid a TypeError from the writes
    // below (regression caught 2026-05-04 by the perf harness).
    if (!rig.materials) {
      marineDecor.setVisible?.(isMarine);
      return;
    }
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
    // FBX rig has its own per-mesh MeshStandardMaterials baked into
    // the loaded asset — no rig.materials.{bodyMat, armMat, ...} to
    // poke. Tinting is a no-op until/unless we add an explicit FBX
    // material-swap pipeline.
    if (!rig.materials) return;
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

  // Setter for swapPlayerToFbxRig — flips the closure-captured `rig`
  // binding so update() sees the new rig (FBX adapter or procgen).
  // External `player.rig` is also updated by the swap helper for
  // consumers that read the public field (gunman.js, weapon attach,
  // etc.).
  function _setRig(newRig) {
    rig = newRig;
    // Re-bind support-IK anchors onto the new rig immediately. Without
    // this, swapping procgen → FBX strands the anchors on the procgen
    // rig and the FBX rig's IK gate never fires.
    if (rig) {
      rig._weaponGripAnchor   = gunMesh;
      rig._weaponMuzzleAnchor = muzzle;
    }
  }
  // Re-run setWeapon with the currently equipped weapon. Used after
  // a mid-run rig swap (swapPlayerToFbxRig) so the gun mesh hops from
  // the OLD rig's anchor (now hidden) to the NEW rig's anchor. Without
  // this, bullets keep firing from the old wrist's last world position.
  function reattachWeapon() {
    if (state.equipped) setWeapon(state.equipped);
  }
  return {
    mesh: group, body, rig, _setRig, update, setWeapon, setOffhandWeapon, reattachWeapon, playOneShot, prewarmWeapon, takeDamage, heal, applyStatus,
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
