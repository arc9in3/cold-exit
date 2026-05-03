// ============================================================
// state_machine.js — JSON-driven clip selector (Phase 1)
// ============================================================
//
// Phase 1 deliverable: replicates the hardcoded if/else cascade in
// player.js:1695-1737 EXACTLY, but with the rules sourced from
// Assets/anim_data/states/<id>.json.
//
// The full state-machine design (per the plan) uses layers + per-bone
// masks + transition tables with blend timings + condition expressions.
// That arrives in Phase 2 (graph.js + bone_mask.js). Phase 1 keeps the
// surface minimal: derive a small set of boolean inputs from the
// playerState snapshot, run a priority-list match, return the picked
// clip + playback hints.
//
// Why structured conditions instead of string expressions: the plan's
// risk note calls out "no eval / no Function()". A safelist parser
// for arbitrary expressions is Phase 2 work; for Phase 1 a static
// `all: [...names]` list of required-true input flags is enough to
// encode every condition the existing code uses (and zero risk of
// untrusted-string issues).

import { Registry } from './registry.js';

// Default registry instance (lazy). Same singleton pattern as
// character_fbx.js — first ensure() call fetches the JSON; future
// calls reuse the in-memory copy.
let _smCache = new Map(); // id → parsed SM config
let _registry = null;
async function getRegistry() {
  if (_registry) return _registry;
  _registry = await Registry.create('Assets/anim_data/').catch(err => {
    console.warn('[anim/state_machine] Registry.create failed:', err.message);
    return null;
  });
  return _registry;
}

// Load a state-machine JSON by id and cache the parsed config. Pass
// pre-loaded smCfg via opts.cfg to bypass fetch entirely.
export async function loadStateMachine(id, opts = {}) {
  if (opts.cfg) {
    _smCache.set(id, opts.cfg);
    return opts.cfg;
  }
  if (_smCache.has(id)) return _smCache.get(id);
  const reg = await getRegistry();
  if (!reg) return null;
  const cfg = await reg.stateMachine(id);
  _smCache.set(id, cfg);
  return cfg;
}

// Derive boolean inputs from a playerState snapshot. The mapping
// matches the if/else block in player.js — keep these in sync.
//
// playerState fields used:
//   adsAmount    (number 0..1, > 0.4 → "aim")
//   attack       ({ phase: 'idle' | 'swinging' | ... })
//   crouched     (boolean)
//   _planarSpeed (number, see player.js)
//
// `planarSpeed` is passed as a separate arg because it's computed in
// player.js's update tick, not stored on playerState directly.
export function deriveInputs(playerState, planarSpeed) {
  const aim = (playerState?.adsAmount || 0) > 0.4;
  const swinging = !!(playerState?.attack && playerState.attack.phase !== 'idle');
  const moving = planarSpeed > 0.05;
  const running = planarSpeed > 3.5;
  const crouched = !!playerState?.crouched;
  return { aim, swinging, moving, running, crouched };
}

// Evaluate the SM and return the picked state + clip metadata.
// Returns null only if the SM has no matching state (shouldn't happen
// when the priority list ends with `all: []`).
//
// Returned shape:
//   {
//     stateId,        // e.g. "walk"
//     clip,           // e.g. "W1_Walk_Aim_F_Loop_IPC"
//     loop,           // boolean
//     speedRef,       // number | null
//     playback,       // { fadeMs, timeScaleClamp:[lo,hi] }
//   }
export function pickClip(smCfg, inputs) {
  if (!smCfg || !smCfg.selectionPriority) return null;
  for (const rule of smCfg.selectionPriority) {
    const required = rule.all || [];
    let ok = true;
    for (const flag of required) {
      if (!inputs[flag]) { ok = false; break; }
    }
    if (!ok) continue;
    const state = smCfg.states[rule.state];
    if (!state) continue;
    return {
      stateId: rule.state,
      clip: state.clip,
      loop: state.loop !== false,
      speedRef: state.speedRef ?? null,
      playback: smCfg.playback || { fadeMs: 180, timeScaleClamp: [0.5, 1.5] },
    };
  }
  return null;
}

// Convenience: derive + pick in one call. Use from the per-frame
// update tick.
export function selectFromPlayerState(smCfg, playerState, planarSpeed) {
  const inputs = deriveInputs(playerState, planarSpeed);
  return pickClip(smCfg, inputs);
}

// ============================================================
// Phase 2 — layered selection
// ============================================================
//
// The Phase 2 SM JSON has a `layers` array; each layer has its own
// states + selectionPriority + bone-mask group. selectLayered()
// returns a per-layer pick:
//   { layers: [ { name, boneMaskGroup, blendMs, additive, pick }, ... ] }
// where `pick` has the same shape as pickClip()'s output.
export function selectLayered(smCfg, inputs) {
  if (!smCfg || !smCfg.layers) return null;
  const out = { layers: [] };
  for (const layer of smCfg.layers) {
    const sub = {
      states: layer.states || {},
      selectionPriority: layer.selectionPriority || [],
      playback: smCfg.playback,
    };
    const pick = pickClip(sub, inputs);
    out.layers.push({
      name: layer.name,
      boneMaskGroup: layer.boneMaskGroup || null,
      blendMs: layer.blendMs ?? 180,
      additive: !!layer.additive,
      pick,
    });
  }
  return out;
}

export function selectLayeredFromPlayerState(smCfg, playerState, planarSpeed) {
  return selectLayered(smCfg, deriveInputs(playerState, planarSpeed));
}
