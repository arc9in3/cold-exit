// ============================================================
// graph.js — N-track weighted blender per actor (L4)
// ============================================================
//
// Replaces rig._fbx.currentAction (single-clip-at-a-time) with a
// fixed-size pool of TRACKS. Each track wraps:
//   - one THREE.AnimationAction (the clip)
//   - a per-bone mask (via action.userData.boneMask, consumed by
//     bone_mask.js's PropertyMixer.accumulate patch)
//   - a target weight (lerped per frame for cross-fade)
//   - a layer name (e.g. 'base' / 'combat' / 'additive_aim')
//
// Per-frame tick:
//   1. For each track, ease current weight toward target weight at
//      the layer's blend rate.
//   2. action.weight = current weight; if weight > 0 and !isRunning,
//      call action.play().
//   3. The mixer accumulates each action; per-bone masking happens
//      automatically inside the patched accumulate().
//
// One mixer per actor (existing rig._fbx.mixer). One AnimationGraph
// per actor (built once at init, lives on rig._fbx.graph).
//
// Allocation hygiene: tracks live in a fixed-size array (8 layers
// max). No per-frame Map iteration. No object literals constructed
// in the tick.

import * as THREE from 'three';
import { installMaskPatch, setCurrentAction, clearCurrentAction, buildBoneMask } from './bone_mask.js';

const MAX_LAYERS = 8;
const DEFAULT_BLEND_RATE = 12.0; // 1/s — ~83ms to ~95% blend

// Lazy install of the PropertyMixer patch on first graph creation.
let _patchInstalled = false;

export class AnimationGraph {
  constructor(rig) {
    if (!_patchInstalled) {
      installMaskPatch(THREE);
      _patchInstalled = true;
    }
    this.rig = rig;
    this.mixer = rig._fbx?.mixer || null;
    this.actions = rig._fbx?.actions || new Map(); // clipName -> AnimationAction
    this.rigCfg = rig._fbx?.rigCfg || null;
    // Track pool. A track is REUSED across state changes — we just
    // swap which clip its action points to via switchClip().
    this.tracks = [];
    for (let i = 0; i < MAX_LAYERS; i++) {
      this.tracks.push({
        index: i,
        layerName: '',
        action: null,
        targetWeight: 0,
        currentWeight: 0,
        blendRate: DEFAULT_BLEND_RATE,
        boneMask: null,
        additive: false,
        loop: true,
      });
    }
    this.layerByName = new Map(); // name -> track index
    // Cache resolved boneMasks per logical group so we don't rebuild
    // every state change.
    this._maskCache = new Map(); // groupName -> Map<boneName, weight>
    // Update timing — applied by step().
    this._maskedActions = []; // scratch list: actions with non-trivial mask, used by tick
  }

  // Define a layer slot. boneMaskGroup names a logical-group key
  // ('top' / 'bottom' / 'upper' / 'lower') from the rig cfg, or null
  // for full-body. Once defined, getOrPlay(layer, clip) drives it.
  defineLayer(layerName, opts = {}) {
    const { boneMaskGroup = null, additive = false, blendMs = 180 } = opts;
    let track = this.layerByName.get(layerName);
    if (track == null) {
      track = this._allocTrack(layerName);
      if (track == null) {
        console.warn(`[anim/graph] no free layer slots for "${layerName}"`);
        return null;
      }
      this.layerByName.set(layerName, track.index);
    } else {
      track = this.tracks[track];
    }
    track.layerName = layerName;
    track.additive = !!additive;
    track.blendRate = 1000 / Math.max(16, blendMs); // ms -> 1/s
    if (boneMaskGroup) {
      track.boneMask = this._maskFor(boneMaskGroup);
    } else {
      track.boneMask = null;
    }
    return track;
  }

  _allocTrack(layerName) {
    for (const t of this.tracks) {
      if (!t.layerName || t.layerName === layerName) return t;
    }
    return null;
  }

  _maskFor(groupName) {
    let mask = this._maskCache.get(groupName);
    if (!mask) {
      mask = buildBoneMask(groupName, this.rigCfg);
      this._maskCache.set(groupName, mask);
    }
    return mask;
  }

  // Set the active clip for a layer. If clipName changed, fade out
  // the previous action on this layer and fade in the new one. If
  // the same clip, this is a no-op.
  playOnLayer(layerName, clipName, opts = {}) {
    const idx = this.layerByName.get(layerName);
    if (idx == null) {
      console.warn(`[anim/graph] layer "${layerName}" not defined`);
      return null;
    }
    const track = this.tracks[idx];
    const action = this.actions.get(clipName);
    if (!action) return null;
    if (track.action === action) return action;
    // Fade out the old action by zeroing its target weight if it's
    // still on this layer (cross-fade is owned by the layer, not the
    // action — same action can run on multiple layers in theory).
    const newAction = action;
    if (track.action) {
      // Stash a fadeOut on the OLD action if no other layer holds it.
      let stillUsed = false;
      for (const other of this.tracks) {
        if (other !== track && other.action === track.action) { stillUsed = true; break; }
      }
      if (!stillUsed) {
        track.action.setEffectiveWeight(track.currentWeight); // freeze
        track.action.fadeOut(1 / track.blendRate);
      }
    }
    newAction.userData = newAction.userData || {};
    newAction.userData.boneMask = track.boneMask;
    newAction.setLoop(opts.loop !== false ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    newAction.timeScale = opts.timeScale ?? 1.0;
    newAction.reset();
    newAction.setEffectiveWeight(0);
    newAction.play();
    track.action = newAction;
    track.targetWeight = opts.weight ?? 1.0;
    track.loop = opts.loop !== false;
    return newAction;
  }

  setLayerWeight(layerName, w) {
    const idx = this.layerByName.get(layerName);
    if (idx == null) return;
    this.tracks[idx].targetWeight = Math.max(0, Math.min(1, w));
  }

  setLayerTimeScale(layerName, ts) {
    const idx = this.layerByName.get(layerName);
    if (idx == null) return;
    const tr = this.tracks[idx];
    if (tr.action) tr.action.timeScale = ts;
  }

  // Per-frame tick. Lerp track weights toward targets (frame-rate
  // independent), copy into action.weight, then mixer.update.
  // The bone-mask patch does the per-bone modulation transparently.
  step(dt) {
    if (!this.mixer) return;
    for (const tr of this.tracks) {
      if (!tr.action) continue;
      // Frame-rate-independent lerp (1 - exp(-rate * dt)).
      const a = 1 - Math.exp(-tr.blendRate * dt);
      tr.currentWeight += (tr.targetWeight - tr.currentWeight) * a;
      tr.action.setEffectiveWeight(tr.currentWeight);
      // Re-attach the mask each frame in case the track was
      // re-purposed (cheap — same Map ref).
      tr.action.userData = tr.action.userData || {};
      tr.action.userData.boneMask = tr.boneMask;
    }
    // Tick the mixer. bone_mask.js patches AnimationAction._update
    // to set _currentAction before each action's per-binding
    // accumulate() runs, so the mask-patch in PropertyMixer can
    // multiply the action's effective weight by the per-bone factor.
    this.mixer.update(dt);
  }

  // Diagnostic — used by the test page + console hooks.
  diag() {
    const out = { layers: [] };
    for (const tr of this.tracks) {
      if (!tr.layerName) continue;
      out.layers.push({
        name: tr.layerName,
        clip: tr.action?.getClip().name || null,
        target: +tr.targetWeight.toFixed(2),
        current: +tr.currentWeight.toFixed(2),
        masked: !!(tr.boneMask && tr.boneMask.size > 0),
        running: tr.action?.isRunning() || false,
        time: tr.action ? +tr.action.time.toFixed(2) : 0,
      });
    }
    return out;
  }
}

// Convenience: ensure a rig has a graph attached. Idempotent.
export function attachGraph(rig) {
  if (!rig || !rig._fbx) return null;
  if (rig._fbx.graph) return rig._fbx.graph;
  rig._fbx.graph = new AnimationGraph(rig);
  return rig._fbx.graph;
}

// Re-export the patched-accumulate hook helpers so unit tests can
// simulate a mixer update without a full Three scene.
export { setCurrentAction, clearCurrentAction };
