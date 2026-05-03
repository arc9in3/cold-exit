// ============================================================
// api.js — public façade for the modular animation system
// ============================================================
//
// Single import surface for engine + tooling consumers. The plan's
// reusability section calls this out as the drop-in for other games
// and 3D-movie tooling — anything that wants to load characters,
// run state machines, compose split rigs, sync animation over the
// network, or play cutscenes goes through here.
//
// Usage:
//   import { Anim } from './anim/api.js';
//   const anim = await Anim.create({ scene, registryPath: 'Assets/anim_data/' });
//   const actor = await anim.spawn({ characterId: 'eve_alt', position: [0,0,0] });
//   actor.setPlayerState({ speed: 1.6, crouched: false, aiming: 0.8 });
//   actor.update(dt);
//   actor.attachProp('primaryWeapon', weaponMesh);
//   const movie = await anim.loadScene('intro_lab');
//
// All Cold-Exit-specific concepts (playerState shape, weapon model
// paths) are passed THROUGH the API as opaque values — the L3 SM
// dereferences them. No engine module imports player.js or anything
// game-specific.

import * as THREE from 'three';
import { Registry } from './registry.js';
import { adapt as adaptRig } from './rig_adapter.js';
import { loadComposedCharacter } from './rig_compose.js';
import { loadCharacterFBX } from '../character_fbx.js';
import { loadStateMachine, deriveInputs, pickClip, selectLayered } from './state_machine.js';
import { attachGraph } from './graph.js';
import { ensureAimLayer, updateAim, triggerRecoil } from './additive.js';
import { applyOverrides, resolvePropAttachment, loadOverrides } from './overrides.js';
import { encodeAnimTuple, applyAnimTuple, buildStateIndex, smHash } from './net_sync.js';
import { loadAndPlayScene, Cutscene } from './cutscene.js';

export class Anim {
  constructor(scene, registry) {
    this.scene = scene;
    this.registry = registry;
    this._actors = new Set();
  }

  static async create({ scene, registryPath = 'Assets/anim_data/' } = {}) {
    if (!scene) throw new Error('[anim/api] Anim.create requires { scene }');
    const registry = await Registry.create(registryPath);
    return new Anim(scene, registry);
  }

  // Spawn an actor by characterId. Resolves first against
  // rig_compose/<id>.json (composed); falls back to a single rig
  // load via opts.src if compose lookup fails.
  async spawn(opts = {}) {
    const { characterId, position = [0,0,0], stateMachine = null, src = null, rigId = null } = opts;
    let rig = null;
    if (characterId) {
      const cmp = await this.registry.compose(characterId).catch(() => null);
      if (cmp) rig = await loadComposedCharacter(this.scene, characterId);
    }
    if (!rig && src) {
      rig = await loadCharacterFBX(this.scene, src, { rigId });
    }
    if (!rig) throw new Error(`[anim/api] could not spawn actor: characterId=${characterId} src=${src}`);
    if (rig.group && position) rig.group.position.fromArray(position);
    adaptRig(rig);
    const smCfg = stateMachine ? await loadStateMachine(stateMachine) : null;
    const overridesCfg = characterId ? await loadOverrides(characterId) : null;
    if (overridesCfg) applyOverrides(rig, overridesCfg);
    const actor = new Actor(this, rig, smCfg, overridesCfg);
    this._actors.add(actor);
    return actor;
  }

  // Cutscenes
  async loadScene(sceneId, opts = {}) {
    return await loadAndPlayScene(this.scene, sceneId, opts);
  }

  // Coop helpers — re-exported so consumers don't need to import
  // net_sync directly.
  encodeNet(actor, stateNameByLayer, flags = 0) {
    if (!actor || !actor._smIndex) return null;
    return encodeAnimTuple(actor.graph, actor._smIndex, stateNameByLayer, flags);
  }
  applyNet(actor, tuple) {
    if (!actor || !actor._smIndex || !actor.smCfg) return;
    applyAnimTuple(actor.graph, actor._smIndex, actor.smCfg, tuple);
  }
  smHash(smCfg) { return smHash(smCfg); }
}

export class Actor {
  constructor(anim, rig, smCfg, overridesCfg) {
    this.anim = anim;
    this.rig = rig;
    this.smCfg = smCfg;
    this.overridesCfg = overridesCfg;
    this.graph = rig._fbx ? attachGraph(rig) : null;
    this._smIndex = smCfg ? buildStateIndex(smCfg) : null;
    // Define layers from the SM if we have one.
    if (this.graph && smCfg && smCfg.layers) {
      for (const L of smCfg.layers) {
        this.graph.defineLayer(L.name, {
          boneMaskGroup: L.boneMaskGroup || null,
          additive: !!L.additive,
          blendMs: L.blendMs ?? 180,
        });
      }
    }
    this._lastPlayerState = null;
  }

  // Drive the actor by feeding it a per-frame playerState snapshot.
  // The shape of `state` is opaque to the engine — only the SM JSON
  // dereferences fields. By convention Cold Exit passes an object
  // with adsAmount / crouched / attack / speed.
  setPlayerState(state, planarSpeed = 0) {
    this._lastPlayerState = state;
    if (!this.smCfg || !this.graph) return;
    const inputs = deriveInputs(state, planarSpeed);
    if (this.smCfg.layers) {
      const layered = selectLayered(this.smCfg, inputs);
      if (layered) {
        for (const L of layered.layers) {
          if (!L.pick) continue;
          const trIdx = this.graph.layerByName.get(L.name);
          if (trIdx == null) continue;
          const cur = this.graph.tracks[trIdx];
          if (cur?.action?.getClip().name !== L.pick.clip) {
            this.graph.playOnLayer(L.name, L.pick.clip, { loop: L.pick.loop });
          }
          if (L.pick.speedRef && cur?.action) {
            const clamp = L.pick.playback?.timeScaleClamp ?? [0.5, 1.5];
            cur.action.timeScale = Math.max(clamp[0], Math.min(clamp[1], planarSpeed / L.pick.speedRef));
          }
        }
      }
    } else if (this.smCfg.selectionPriority) {
      const pick = pickClip(this.smCfg, inputs);
      if (pick && this.rig.play) this.rig.play(pick.clip, { fadeMs: pick.playback?.fadeMs ?? 180, loop: pick.loop });
    }
  }

  update(dt) {
    if (this.graph) this.graph.step(dt);
    else if (this.rig.update) this.rig.update(dt);
  }

  attachProp(propId, mesh) {
    if (!mesh || !this.rig) return false;
    const att = resolvePropAttachment(this.overridesCfg, propId);
    if (!att) return false;
    const bones = this.rig._fbx?.bonesByName;
    let bone = bones?.get(att.boneName);
    if (!bone && this.rig._fbx?.rigCfg?.boneMap) {
      // Reverse-lookup: find the bone whose mapped path matches.
      for (const [bn, path] of Object.entries(this.rig._fbx.rigCfg.boneMap)) {
        if (path === att.boneName) { bone = bones.get(bn); break; }
      }
    }
    if (!bone) return false;
    bone.add(mesh);
    mesh.position.copy(att.offset);
    mesh.rotation.copy(att.rotation);
    return true;
  }

  setAim(yaw, pitch, opts = {}) {
    if (!this.graph) return;
    if (!this.rig._fbx?.aimLayer) {
      // Resolve chest+head bone names from rigCfg.
      const cfg = this.rig._fbx?.rigCfg;
      if (!cfg) return;
      let chestBone = null, headBone = null;
      for (const [bn, path] of Object.entries(cfg.boneMap || {})) {
        if (path === 'chest' && !chestBone) chestBone = bn;
        if (path === 'head'  && !headBone)  headBone = bn;
      }
      ensureAimLayer(this.graph, this.rig, { chestBone, headBone });
    }
    updateAim(this.rig, yaw, pitch, opts);
  }

  triggerRecoil(opts = {}) {
    if (this.graph) triggerRecoil(this.rig, this.graph, opts);
  }

  destroy() {
    if (this.rig?.group?.parent) this.rig.group.parent.remove(this.rig.group);
    this.anim._actors.delete(this);
  }
}

// Default export so consumers can `import Anim from './anim/api.js'`.
export default Anim;
