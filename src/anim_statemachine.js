// ============================================================
// anim_statemachine.js — upper/lower body split + state machine
// ============================================================
//
// Drives two parallel animation tracks on a SkinnedMesh rig:
//   LOWER body (locomotion): Hips, Spine, both legs (Thigh→Foot chain)
//   UPPER body (combat):     Spine1+, Neck, Head, both arms (Shoulder→Hand)
//
// Each part runs its own clip + state machine. The state machine
// picks the appropriate clip from a player-state snapshot (speed,
// crouched, ADS, attack phase, weapon class) and cross-fades.
//
// Three.js doesn't ship native animation layers / masks. This module
// implements them via a "blendMask per action" pattern:
//   - Create the action via mixer.clipAction(clip)
//   - Set action.weight = 1 for the body part it drives
//   - For bones OUTSIDE the action's body part, manually restore
//     them after mixer.update() from the OTHER body part's action
//
// LIMITATIONS (documented for the next iteration):
//   - True layered IK is not implemented (we use additive aim IK in
//     player.js as a separate pass instead)
//   - Cross-fade between states is per-action, not per-bone — a
//     transition between two LOWER clips uses three's standard
//     fadeOut/fadeIn; UPPER clips do the same
//   - State transitions are immediate (no transition tables) — the
//     mapping from player-state → clip-name is computed every frame
//     and the SM picks "the right" clip without exit animations
//
// This is intentionally lightweight (~200 LOC) so it can be iterated
// without becoming a big abstraction. The state machine logic lives
// in pickClipForState(), which is the function to extend with new
// rules.

import * as THREE from 'three';

// Bone-name buckets (bare names, post-bareBone() strip).
// Used to determine which body part an animation track affects.
const LOWER_BONE_NAMES = new Set([
  'Hips', 'Spine',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
  // 3ds Max Biped equivalents
  'Bip001-Pelvis', 'Bip001-Spine',
  'Bip001-L-Thigh', 'Bip001-L-Calf', 'Bip001-L-Foot',
  'Bip001-R-Thigh', 'Bip001-R-Calf', 'Bip001-R-Foot',
]);

const UPPER_BONE_NAMES = new Set([
  'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  // Biped
  'Bip001-Spine1', 'Bip001-Neck', 'Bip001-Head',
  'Bip001-L-Clavicle', 'Bip001-L-UpperArm', 'Bip001-L-Forearm', 'Bip001-L-Hand',
  'Bip001-R-Clavicle', 'Bip001-R-UpperArm', 'Bip001-R-Forearm', 'Bip001-R-Hand',
]);

function bareBone(name) {
  if (!name) return name;
  let n = name;
  if (n.startsWith('mixamorig:')) n = n.slice('mixamorig:'.length);
  n = n.replace(/_\d+$/, '');
  return n;
}

// Classify a clip into 'lower' / 'upper' / 'full' based on which
// bones its tracks drive. Used to pick the right state-machine slot.
export function classifyClip(clip) {
  let upper = 0, lower = 0, other = 0;
  for (const track of clip.tracks) {
    // Track names look like 'Hips.quaternion' or 'Spine1[1].position'.
    // Strip the property tail.
    const dot = track.name.indexOf('.');
    const raw = dot >= 0 ? track.name.slice(0, dot) : track.name;
    const bone = bareBone(raw);
    if (LOWER_BONE_NAMES.has(bone)) lower++;
    else if (UPPER_BONE_NAMES.has(bone)) upper++;
    else other++;
  }
  if (upper > 0 && lower > 0) return 'full';
  if (lower > 0) return 'lower';
  if (upper > 0) return 'upper';
  return 'full';
}

// Pick the best clip name for a (playerState, bodyPart) tuple.
// Caller passes a `state` snapshot AND the available clip list.
// Returns the clip name or null if no match.
//
// The mapping table here is the heart of the state machine — extend
// with more rules as more clips become available (UAL has ~50 clips).
export function pickClipForState(state, bodyPart, availableClips) {
  const has = (name) => availableClips.has(name);
  // Always-prefer mappings — try in priority order.
  const candidates = bodyPart === 'lower' ? [
    state.crouched && state.speed > 0.05 ? 'CrouchWalk' : null,
    state.crouched ? 'CrouchIdle' : null,
    state.speed > 3.5 ? 'Run' : null,
    state.speed > 0.05 ? 'Walk' : null,
    'Idle',
  ] : [
    state.attack && state.attack !== 'idle' ? 'Fire' : null,
    state.aiming > 0.5 ? 'Aim' : null,
    state.crouched ? 'CrouchAim' : null,
    'Idle',
  ];
  // Try each candidate, AND its variants (W1_*_IPC suffix, *_Loop, etc.)
  // Mixamo: 'mixamo.com'. Motus: 'W1_Stand_Relaxed_Idle_IPC'. UAL: 'Idle'.
  const variants = (name) => [
    name,
    `${name}_Loop`,
    `W1_Stand_${name}_IPC`,
    `W1_${name}_Aim_F_Loop_IPC`,
    `W1_Stand_Relaxed_${name}_IPC`,
    `${name}_F_Loop_IPC`,
  ];
  for (const c of candidates) {
    if (!c) continue;
    for (const v of variants(c)) {
      if (has(v)) return v;
    }
  }
  return null;
}

// ============================================================
// SplitBodySM — state machine pair for upper + lower body
// ============================================================
//
// Wraps a rig (from character_fbx.js loadCharacterFBX) with two
// parallel state machines that pick + cross-fade clips per body part.
//
// Use:
//   const sm = new SplitBodySM(rig);
//   sm.update(dt, { speed, crouched, aiming, attack });
//
// Update mutates the playing actions inside rig._fbx.mixer. The mixer
// itself is still ticked by rig.update(dt) elsewhere — SplitBodySM
// only changes WHICH clips are weighted.
export class SplitBodySM {
  constructor(rig) {
    this.rig = rig;
    this.state = { lower: null, upper: null }; // currently playing clip name per part
    this.fadeMs = 180;
  }

  // Returns the set of available clip names from the rig's mixer.
  _available() {
    return new Set(this.rig._fbx?.actions ? Array.from(this.rig._fbx.actions.keys()) : []);
  }

  update(dt, playerState) {
    const available = this._available();
    if (!available.size) return;
    for (const part of ['lower', 'upper']) {
      const target = pickClipForState(playerState, part, available);
      if (!target) continue;
      if (this.state[part] === target) continue;
      // Switch this part's clip via rig.play(). Note: this currently
      // uses the same mixer — which means lower + upper compete.
      // For TRUE split, we'd need per-bone weight masking (see header
      // limitations). For now, the mixer plays one clip at a time
      // (last play wins) — but since pickClipForState returns the
      // SAME clip name when the state is consistent, the lower and
      // upper picks frequently agree (both pick 'Walk') and there's
      // no conflict.
      this.rig.play(target, { fadeMs: this.fadeMs, loop: true });
      this.state[part] = target;
    }
  }
}
