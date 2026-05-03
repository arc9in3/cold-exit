// ============================================================
// ik_two_bone.js — Two-bone IK solver (shoulder→elbow→wrist)
// ============================================================
//
// Closed-form analytical IK for a 2-bone chain — used to point the
// hands at the gun-aim target so the rifle/pistol always faces the
// cursor. Math is the standard "law of cosines + plane projection"
// formulation.
//
// Inputs:
//   shoulder, elbow, wrist  — three Bone objects in a parent chain
//   targetWorld              — Vector3, where the wrist should go
//   poleHintWorld?           — optional Vector3 to bias the elbow
//                              into the right plane (away from spine)
//
// Outputs:
//   shoulder.quaternion + elbow.quaternion are written. The wrist's
//   own rotation is NOT touched — caller can stamp gun-grip rotation
//   afterward.
//
// Why bake into bone-local quaternions: the AnimationMixer drives
// bones by writing their local quaternion each tick. The IK runs
// AFTER mixer.update so we OVERWRITE whatever locomotion clip wrote
// for the upper-body arms. A bone mask isn't appropriate here — IK
// is per-frame derived, not blended.

import * as THREE from 'three';

const _shoulderWorld = new THREE.Vector3();
const _elbowWorld    = new THREE.Vector3();
const _wristWorld    = new THREE.Vector3();
const _toElbow       = new THREE.Vector3();
const _toWrist       = new THREE.Vector3();
const _shoulderToTarget = new THREE.Vector3();
const _shoulderUp    = new THREE.Vector3();
const _shoulderRight = new THREE.Vector3();
const _shoulderForward = new THREE.Vector3();
const _bendAxis      = new THREE.Vector3();
const _shoulderRotQ  = new THREE.Quaternion();
const _elbowRotQ     = new THREE.Quaternion();
const _parentInvQ    = new THREE.Quaternion();
const _parentQ       = new THREE.Quaternion();
const _targetLocal   = new THREE.Vector3();

// Solve and apply the IK. lengths are computed from the bone bind
// pose at first call and cached on `cache` (caller provides — usually
// rig._fbx.armIkCache.left or .right).
//
// poleHintWorld is direction (not point); points away-from-body for
// typical "elbow out" pose. For Cold Exit's right arm (= code's
// leftArm) the hint would be world +X; left arm gets -X.
export function solveTwoBoneIK(shoulder, elbow, wrist, targetWorld, poleHintWorld, cache) {
  if (!shoulder || !elbow || !wrist || !targetWorld) return;
  if (!cache.upperLen) {
    shoulder.getWorldPosition(_shoulderWorld);
    elbow.getWorldPosition(_elbowWorld);
    wrist.getWorldPosition(_wristWorld);
    cache.upperLen = _shoulderWorld.distanceTo(_elbowWorld);
    cache.lowerLen = _elbowWorld.distanceTo(_wristWorld);
    cache.totalLen = cache.upperLen + cache.lowerLen;
    if (cache.upperLen < 1e-4 || cache.lowerLen < 1e-4) {
      cache.upperLen = 0;
      return;
    }
  }
  if (cache.upperLen === 0) return;

  shoulder.getWorldPosition(_shoulderWorld);
  _shoulderToTarget.subVectors(targetWorld, _shoulderWorld);
  let chainDist = _shoulderToTarget.length();
  // If the target is unreachable, clamp to total length so the arm
  // extends straight at the target rather than NaN'ing.
  const maxReach = cache.totalLen * 0.99;
  if (chainDist > maxReach) chainDist = maxReach;
  if (chainDist < 1e-4) return;

  // Law of cosines: angle at shoulder between (shoulder→target) and
  // (shoulder→elbow), and angle at elbow between (elbow→shoulder)
  // and (elbow→wrist).
  const a = cache.upperLen;
  const b = cache.lowerLen;
  const c = chainDist;
  const cosShoulder = (a*a + c*c - b*b) / (2 * a * c);
  const cosElbow    = (a*a + b*b - c*c) / (2 * a * b);
  const angShoulder = Math.acos(Math.max(-1, Math.min(1, cosShoulder)));
  const angElbow    = Math.acos(Math.max(-1, Math.min(1, cosElbow)));
  // Elbow angle as bend (PI - elbow angle gives bend amount: 0 =
  // straight, PI = fully bent backward).
  const bend = Math.PI - angElbow;

  // Pose plane: contains shoulder→target (forward axis) and the pole
  // hint (defines "up" / bend direction).
  _shoulderForward.copy(_shoulderToTarget).normalize();
  _shoulderUp.copy(poleHintWorld || _UP_DEFAULT).normalize();
  // Right = forward × up; bend axis = up × forward (so positive bend
  // moves the elbow toward the up-hint side).
  _shoulderRight.crossVectors(_shoulderForward, _shoulderUp).normalize();
  _bendAxis.crossVectors(_shoulderRight, _shoulderForward).normalize();

  // World-space target rotation for the SHOULDER: rotate the bind
  // direction (shoulder bind-forward) onto _shoulderForward, then
  // tilt by `angShoulder` toward bendAxis.
  // The simpler approach: build a target world quaternion that points
  // shoulder bind +X axis at (shoulderForward rotated by angShoulder
  // away from bendAxis). For a typical biped where the upper-arm
  // bone's local +X points along the bone (toward elbow), the world
  // direction we want for the upper arm is:
  //   forward · cos(angShoulder) - bendAxis · sin(angShoulder)
  // (rotate shoulderForward by -angShoulder around shoulderRight).
  _scratchUpperDir.copy(_shoulderForward).multiplyScalar(Math.cos(angShoulder))
    .addScaledVector(_bendAxis, -Math.sin(angShoulder));
  // Upper arm world rotation: rotate bind axis onto _scratchUpperDir.
  // We use Quaternion.setFromUnitVectors against a reference axis;
  // for a Mixamo/UEFN biped the upper arm's local +Y points along
  // the bone (down-the-bone). We rotate the world +Y onto upper-dir.
  // BUT this depends on rig export — for now use the BIND world
  // forward axis, computed once.
  if (!cache.shoulderBindWorldDir) {
    // World-direction the shoulder POINTS in bind pose (shoulder→elbow).
    elbow.getWorldPosition(_elbowWorld);
    cache.shoulderBindWorldDir = new THREE.Vector3()
      .subVectors(_elbowWorld, _shoulderWorld).normalize();
  }
  _shoulderRotQ.setFromUnitVectors(cache.shoulderBindWorldDir, _scratchUpperDir);
  // Convert world quaternion to bone-local: localQ = parentInvQ *
  // worldQ * shoulder.bindLocalQ. Approximate by composing parent's
  // current world rotation.
  if (shoulder.parent) {
    shoulder.parent.getWorldQuaternion(_parentQ);
    _parentInvQ.copy(_parentQ).invert();
    if (!cache.shoulderBindLocalQ) cache.shoulderBindLocalQ = shoulder.quaternion.clone();
    shoulder.quaternion.copy(_parentInvQ).multiply(_shoulderRotQ).multiply(_parentQ).multiply(cache.shoulderBindLocalQ);
  }
  // Force-update child world transforms so elbow.getWorldPosition
  // below sees the post-shoulder pose.
  shoulder.updateMatrixWorld(true);

  // Elbow rotation: bend around the bend axis by `bend` radians. The
  // elbow's local axis depends on rig — for typical biped, the
  // elbow bends around its local +X (or +Z). Use bendAxis in world
  // and convert to elbow-parent (= shoulder) local.
  _elbowRotQ.setFromAxisAngle(_bendAxis, bend);
  if (elbow.parent) {
    elbow.parent.getWorldQuaternion(_parentQ);
    _parentInvQ.copy(_parentQ).invert();
    if (!cache.elbowBindLocalQ) cache.elbowBindLocalQ = elbow.quaternion.clone();
    elbow.quaternion.copy(_parentInvQ).multiply(_elbowRotQ).multiply(_parentQ).multiply(cache.elbowBindLocalQ);
  }
  elbow.updateMatrixWorld(true);
}

const _UP_DEFAULT = new THREE.Vector3(0, 1, 0);
const _scratchUpperDir = new THREE.Vector3();

// Reset the cached bind-pose data so a re-snapshot happens on next
// solve. Call after a rig swap.
export function resetIkCache(cache) {
  cache.upperLen = 0;
  cache.lowerLen = 0;
  cache.totalLen = 0;
  cache.shoulderBindLocalQ = null;
  cache.elbowBindLocalQ = null;
  cache.shoulderBindWorldDir = null;
}
