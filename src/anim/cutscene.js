// ============================================================
// cutscene.js — multi-actor timeline runtime (L7)
// ============================================================
//
// Loads a scene JSON from Assets/anim_data/scenes/<id>.json and runs
// it against a master clock. Each event is { actor?, t, kind/event,
// payload }. Events fire when the master clock crosses their `t`.
//
// Supported event kinds:
//   { actor, event:"play",    state:"<sm-state-id>", duration?, layer? }
//   { actor, event:"trigger", oneShot:"<clip-name>" }
//   { kind:"camera", t, from:[x,y,z], to:[x,y,z], lookAt:"<actor>" }
//   { kind:"audio",  t, src:"<path>" }
//
// Scrubbing: scrubTo(time) seeks the master clock and re-applies the
// last "active" event per (actor, layer). A simple memo keeps the
// last-applied per slot so a forward scrub doesn't replay every prior
// event from t=0.
//
// Actors come from rig_compose.loadComposedCharacter (composed) OR
// loadCharacterFBX (single rig). The scene JSON's actor entry says
// which: if `characterId` resolves to a rig_compose/<id>.json, the
// composer runs; otherwise we treat it as a single-rig characterId
// resolved by the registry.

import * as THREE from 'three';
import { Registry } from './registry.js';
import { loadComposedCharacter } from './rig_compose.js';
import { loadCharacterFBX } from '../character_fbx.js';
import { loadStateMachine, selectFromPlayerState } from './state_machine.js';

let _registry = null;
async function getRegistry() {
  if (_registry) return _registry;
  _registry = await Registry.create('Assets/anim_data/').catch(err => {
    console.warn('[anim/cutscene] Registry.create failed:', err.message);
    return null;
  });
  return _registry;
}

export class Cutscene {
  constructor(scene, sceneCfg, opts = {}) {
    this.scene = scene;
    this.cfg = sceneCfg;
    this.duration = sceneCfg.duration || 0;
    this.t = 0;
    this.playing = false;
    this.actors = new Map(); // actorId -> { rig, smCfg, lastApplied:{} }
    this.audioPlayed = new Set(); // event index -> seen
    this.cameraOnApply = opts.onCamera || null;   // (from, to, lookAt) => void
    this.audioOnApply  = opts.onAudio  || null;   // (src) => void
    // Pre-sort events by t for forward scan.
    this._events = (sceneCfg.tracks || []).slice().sort((a,b) => (a.t||0) - (b.t||0));
    this._eventCursor = 0; // next-to-fire index
  }

  async loadActors() {
    const reg = await getRegistry();
    for (const [actorId, decl] of Object.entries(this.cfg.actors || {})) {
      let rig = null;
      // Try compose first; if not found, fall back to a direct char load.
      try {
        if (reg) {
          const cmp = await reg.compose(decl.characterId).catch(() => null);
          if (cmp) {
            rig = await loadComposedCharacter(this.scene, decl.characterId);
          }
        }
      } catch (_) {}
      if (!rig && decl.src) {
        rig = await loadCharacterFBX(this.scene, decl.src, { rigId: decl.rigId });
      }
      if (!rig) {
        console.warn(`[cutscene] could not load actor ${actorId}`);
        continue;
      }
      if (rig.group && decl.spawn) {
        rig.group.position.fromArray(decl.spawn);
      }
      let smCfg = null;
      if (decl.stateMachine) {
        smCfg = await loadStateMachine(decl.stateMachine).catch(() => null);
      }
      this.actors.set(actorId, { rig, smCfg, lastApplied: {} });
    }
  }

  play() { this.playing = true; }
  pause() { this.playing = false; }

  // Tick the cutscene master clock. Call once per frame.
  step(dt) {
    if (!this.playing) return;
    const newT = Math.min(this.t + dt, this.duration);
    this._fireRange(this.t, newT);
    this.t = newT;
    // Tick each actor's mixer so anim plays during the scene.
    for (const a of this.actors.values()) {
      if (a.rig?.update) a.rig.update(dt);
    }
    if (this.t >= this.duration) this.playing = false;
  }

  // Seek to absolute t. Replays events from the last memoized snapshot
  // forward — if going backward, resets all actor state and replays
  // from 0 (no per-clip rewind in THREE; simpler than memoizing every
  // mixer's prior state).
  scrubTo(t) {
    t = Math.max(0, Math.min(this.duration, t));
    if (t < this.t) {
      // Backward — reset cursor + actor state, then replay forward.
      this._eventCursor = 0;
      for (const a of this.actors.values()) a.lastApplied = {};
      this.t = 0;
    }
    this._fireRange(this.t, t);
    this.t = t;
  }

  _fireRange(t0, t1) {
    while (this._eventCursor < this._events.length) {
      const e = this._events[this._eventCursor];
      const et = e.t || 0;
      if (et > t1) break;
      if (et >= t0) this._applyEvent(e);
      this._eventCursor++;
    }
  }

  _applyEvent(e) {
    const kind = e.kind || (e.actor ? 'actor' : null);
    if (kind === 'camera' && this.cameraOnApply) {
      this.cameraOnApply(e.from, e.to, e.lookAt);
      return;
    }
    if (kind === 'audio' && this.audioOnApply) {
      this.audioOnApply(e.src);
      return;
    }
    if (e.actor) {
      const a = this.actors.get(e.actor);
      if (!a || !a.rig) return;
      if (e.event === 'play' && e.state && a.smCfg) {
        // Look up the clip for the named state across either the
        // Phase 1 priority list OR the layered format. Layered: pick
        // by state name from layers[*].states.
        let clipName = null;
        if (a.smCfg.states && a.smCfg.states[e.state]) {
          clipName = a.smCfg.states[e.state].clip;
        } else if (a.smCfg.layers) {
          for (const L of a.smCfg.layers) {
            if (L.states && L.states[e.state]) { clipName = L.states[e.state].clip; break; }
          }
        }
        if (clipName && a.rig.play) {
          a.rig.play(clipName, { fadeMs: 200, loop: e.loop !== false });
          a.lastApplied.state = e.state;
        }
      } else if (e.event === 'trigger' && e.oneShot) {
        if (a.rig.play) a.rig.play(e.oneShot, { fadeMs: 80, loop: false });
      }
    }
  }
}

// Convenience: load + return a started cutscene. Caller is
// responsible for calling step(dt) per frame.
export async function loadAndPlayScene(scene, sceneId, opts = {}) {
  const reg = await getRegistry();
  if (!reg) throw new Error('[cutscene] registry unavailable');
  const cfg = await reg.scene(sceneId);
  if (!cfg) throw new Error(`[cutscene] scene ${sceneId} not found`);
  const cs = new Cutscene(scene, cfg, opts);
  await cs.loadActors();
  cs.play();
  return cs;
}
