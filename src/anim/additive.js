// ============================================================
// additive.js — runtime-built additive layers for aim IK + recoil
// ============================================================
//
// Aim IK and recoil have lived as POST-mixer rotation writes
// (player.js after rig.update — pokes chest yaw/pitch + head yaw/pitch +
// recoil shoulder offset). The mixer overwrites those each frame in
// the next tick, so the post-mixer code has to re-stamp every frame.
//
// Phase 2 lifts these into ADDITIVE clips that the mixer composes on
// top of the locomotion + combat layers. Two concrete additive layers:
//
//   1. aim_lookat — drives chest+head yaw/pitch toward the aim
//      direction. One AnimationClip with two QuaternionKeyframeTracks
//      (chest + head). The clip is rebuilt as needed when the aim
//      target changes by more than a small threshold; for small
//      changes we just retarget the action's `time` cursor.
//
//   2. recoil_pulse — short additive pulse on chest + dominant arm.
//      Triggered as a one-shot via recoilPulse(amount).
//
// Each builds on `THREE.AnimationUtils.makeClipAdditive` so the
// resulting clip can be added on top of the base pose.
//
// This module exposes a small API that takes a graph (created by
// graph.js) and the rig: ensureAimLayer(graph, rig), updateAim(...),
// triggerRecoil(...). The graph is responsible for the per-bone mask
// (additive_aim layer is fullbody-additive but with chest+head bones
// keyed only).

import * as THREE from 'three';

const _scratchQ = new THREE.Quaternion();
const _scratchE = new THREE.Euler();

// Build a minimal additive AnimationClip with the given bone tracks.
// Each track is { boneName, frames: [{t, quat}] }. Duration is the
// last frame's t. Returns an AnimationClip in additive form.
export function buildAdditiveClip(name, tracks, duration) {
  const clipTracks = [];
  for (const t of tracks) {
    const times = new Float32Array(t.frames.length);
    const values = new Float32Array(t.frames.length * 4);
    for (let i = 0; i < t.frames.length; i++) {
      times[i] = t.frames[i].t;
      const q = t.frames[i].quat;
      values[i * 4 + 0] = q.x;
      values[i * 4 + 1] = q.y;
      values[i * 4 + 2] = q.z;
      values[i * 4 + 3] = q.w;
    }
    clipTracks.push(new THREE.QuaternionKeyframeTrack(`${t.boneName}.quaternion`, times, values));
  }
  const clip = new THREE.AnimationClip(name, duration, clipTracks);
  // makeClipAdditive needs a reference clip — for our purposes, the
  // identity rotation IS the reference, so we mark the clip blendMode
  // directly. THREE expects AdditiveAnimationBlendMode on the action.
  return clip;
}

// Ensure an additive aim layer exists on the graph. Builds the clip
// once; subsequent calls are no-ops. Returns the layer name.
//
// boneNames is { chestBone, headBone } — resolved by the caller from
// rig._fbx.bonesByName so this module stays rig-agnostic.
export function ensureAimLayer(graph, rig, boneNames, opts = {}) {
  const { layerName = 'additive_aim', blendMs = 60, weight = 1.0 } = opts;
  if (!graph || !rig || !rig._fbx) return null;
  if (rig._fbx.actions.has(`__additive_${layerName}`)) {
    // Already built — make sure the layer is defined.
    if (!graph.layerByName.has(layerName)) {
      graph.defineLayer(layerName, { additive: true, blendMs });
    }
    return layerName;
  }
  // Build a 2-frame clip: t=0 identity, t=1 identity. We'll mutate
  // the action's time + values via ensureAimLayer's update path
  // (updateAim writes a fresh quat at the action's "current" frame).
  // For a static layer, this leaves identity in place.
  const idQ = new THREE.Quaternion();
  const tracks = [];
  if (boneNames.chestBone) {
    tracks.push({
      boneName: boneNames.chestBone,
      frames: [{ t: 0, quat: idQ.clone() }, { t: 1, quat: idQ.clone() }],
    });
  }
  if (boneNames.headBone) {
    tracks.push({
      boneName: boneNames.headBone,
      frames: [{ t: 0, quat: idQ.clone() }, { t: 1, quat: idQ.clone() }],
    });
  }
  if (!tracks.length) return null;
  const clip = buildAdditiveClip(`__additive_${layerName}`, tracks, 1);
  const action = graph.mixer.clipAction(clip);
  action.blendMode = THREE.AdditiveAnimationBlendMode;
  action.setLoop(THREE.LoopRepeat, Infinity);
  action.play();
  rig._fbx.actions.set(`__additive_${layerName}`, action);
  graph.defineLayer(layerName, { additive: true, blendMs });
  graph.playOnLayer(layerName, `__additive_${layerName}`, { loop: true, weight });
  // Stash references to bones + tracks for updateAim() to mutate.
  rig._fbx.aimLayer = {
    layerName,
    action,
    chestBone: boneNames.chestBone,
    headBone: boneNames.headBone,
    chestTrack: clip.tracks.find(t => t.name.startsWith(boneNames.chestBone || '__none__')) || null,
    headTrack:  clip.tracks.find(t => t.name.startsWith(boneNames.headBone  || '__none__')) || null,
  };
  return layerName;
}

// Update the aim layer's keyframe values. Re-encodes chest + head
// quaternions for the current aim direction. Call once per frame.
// Mutates the existing Float32Array in place — no allocation per call.
export function updateAim(rig, aimYaw, aimPitch, opts = {}) {
  const { chestYawShare = 0.6, chestPitchShare = 0.7, blend = 1.0 } = opts;
  const aim = rig._fbx?.aimLayer;
  if (!aim) return;
  const chestYaw   = aimYaw   * chestYawShare * blend;
  const chestPitch = aimPitch * chestPitchShare * blend;
  const headYaw    = aimYaw   * (1 - chestYawShare) * blend;
  const headPitch  = aimPitch * (1 - chestPitchShare) * blend;
  if (aim.chestTrack) {
    _scratchE.set(chestPitch, chestYaw, 0, 'YXZ');
    _scratchQ.setFromEuler(_scratchE);
    _writeFrameQuat(aim.chestTrack.values, 0, _scratchQ);
    _writeFrameQuat(aim.chestTrack.values, 1, _scratchQ);
  }
  if (aim.headTrack) {
    _scratchE.set(headPitch, headYaw, 0, 'YXZ');
    _scratchQ.setFromEuler(_scratchE);
    _writeFrameQuat(aim.headTrack.values, 0, _scratchQ);
    _writeFrameQuat(aim.headTrack.values, 1, _scratchQ);
  }
}

function _writeFrameQuat(values, frameIdx, q) {
  const o = frameIdx * 4;
  values[o + 0] = q.x;
  values[o + 1] = q.y;
  values[o + 2] = q.z;
  values[o + 3] = q.w;
}

// Trigger a one-shot recoil pulse. Builds-and-plays a short additive
// clip on the chest+rightArm.shoulder bones (via the rig's
// procedural-rig handedness — code's leftArm = char's right, so the
// firing arm is leftArm). Decays out over `duration` seconds.
export function triggerRecoil(rig, graph, opts = {}) {
  const { amount = 0.06, duration = 0.18, layerName = 'additive_recoil' } = opts;
  if (!rig || !rig._fbx || !graph) return;
  // Resolve bones via rigCfg + bonesByName.
  const cfg = rig._fbx.rigCfg;
  const bones = rig._fbx.bonesByName;
  if (!cfg || !bones) return;
  // Find the bone names that map to chest + leftArm.shoulder.pivot
  // (= char's right shoulder = firing arm).
  let chestBoneName = null, armBoneName = null;
  for (const [name, path] of Object.entries(cfg.boneMap || {})) {
    if (path === 'chest' && !chestBoneName) chestBoneName = name;
    if (path === 'leftArm.shoulder.pivot' && !armBoneName) armBoneName = name;
  }
  if (!chestBoneName && !armBoneName) return;
  const tracks = [];
  const eu = new THREE.Euler(-amount, 0, 0, 'YXZ');
  const peak = new THREE.Quaternion().setFromEuler(eu);
  const id = new THREE.Quaternion();
  if (chestBoneName) {
    tracks.push({
      boneName: chestBoneName,
      frames: [
        { t: 0,            quat: id.clone() },
        { t: duration*0.2, quat: peak.clone() },
        { t: duration,     quat: id.clone() },
      ],
    });
  }
  if (armBoneName) {
    const eu2 = new THREE.Euler(-amount * 1.5, 0, 0, 'YXZ');
    const peak2 = new THREE.Quaternion().setFromEuler(eu2);
    tracks.push({
      boneName: armBoneName,
      frames: [
        { t: 0,            quat: id.clone() },
        { t: duration*0.2, quat: peak2.clone() },
        { t: duration,     quat: id.clone() },
      ],
    });
  }
  if (!tracks.length) return;
  const clipName = `__additive_${layerName}`;
  // Replace any prior recoil clip on this layer.
  const prior = rig._fbx.actions.get(clipName);
  if (prior) {
    graph.mixer.uncacheAction(prior.getClip());
    rig._fbx.actions.delete(clipName);
  }
  const clip = buildAdditiveClip(clipName, tracks, duration);
  const action = graph.mixer.clipAction(clip);
  action.blendMode = THREE.AdditiveAnimationBlendMode;
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  rig._fbx.actions.set(clipName, action);
  if (!graph.layerByName.has(layerName)) {
    graph.defineLayer(layerName, { additive: true, blendMs: 30 });
  }
  graph.playOnLayer(layerName, clipName, { loop: false, weight: 1.0 });
}
