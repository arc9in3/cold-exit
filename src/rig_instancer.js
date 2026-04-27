// Rig instancer — collapses per-rig draw calls.
//
// Today: each gunman rig is ~36 primitive meshes. With 20 enemies that's
// 700+ draw calls per frame from rigs alone. Three.js draws each mesh
// individually even when geometry/material is shared.
//
// This module pools source rig meshes into one InstancedMesh per
// (geometry, role) pair and writes per-frame matrixWorld into the
// instance buffer. Source meshes stay in the scene graph (still get
// matrixWorld updates so hit-tests / world-position lookups work) but
// are made invisible to the renderer. Per-actor tint and hit-flash
// are driven through `instanceColor`.
//
// Lifecycle:
//   - register(rig)        on actor spawn (after buildRig + initAnim).
//   - syncFrame()          once per frame, after AI ticks, before render.
//   - setActorFlash(rig,k) replace per-material color lerps.
//   - hideMeshes(list,b)   disarm path — write zero-scale for hidden slots.
//   - unregister(rig)      on actor death/cleanup (before corpse bake).
//
// Capacity: each pool starts at 96 slots. Overflow falls back to
// rendering the source mesh directly (warns once) — the actor is never
// dropped.

import * as THREE from 'three';

const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _baseColor = new THREE.Color();
const _outColor  = new THREE.Color();
const _flashColor = new THREE.Color(0xff4a4a);
const INITIAL_CAP = 96;

class RigInstancer {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.toon = opts.toon !== false;
    // Optional shared gradient texture for the toon ramp. Caller can
    // pass a pre-built texture so the look matches the per-rig MeshToon
    // exactly. If null, Three.js uses the default ramp.
    this.gradient = opts.gradient || null;
    // role → shared MeshToonMaterial (white, instanceColor handles tint).
    this._roleMats = new Map();
    // (geometry.uuid + role) → pool record.
    this._pools = new Map();
    // Registered rigs whose source meshes need per-frame matrix syncs.
    this._actors = new Set();
    this._poolFullWarned = false;
  }

  _matFor(role) {
    let m = this._roleMats.get(role);
    if (!m) {
      const matOpts = { color: 0xffffff };
      if (this.toon) {
        if (this.gradient) matOpts.gradientMap = this.gradient;
        m = new THREE.MeshToonMaterial(matOpts);
      } else {
        m = new THREE.MeshStandardMaterial({ ...matOpts, roughness: 0.78 });
      }
      this._roleMats.set(role, m);
    }
    return m;
  }

  _poolFor(geometry, role, castShadow) {
    const key = `${geometry.uuid}::${role}`;
    let pool = this._pools.get(key);
    if (!pool) {
      const inst = new THREE.InstancedMesh(geometry, this._matFor(role), INITIAL_CAP);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.castShadow = castShadow;
      inst.receiveShadow = true;
      // Frustum culling on InstancedMesh tests the LOCAL bounding
      // sphere (from the source geometry, sized for one instance)
      // against the camera. Our instances are spread across the
      // entire level, so the local sphere doesn't represent the real
      // world bounds and Three.js would cull the whole mesh whenever
      // the camera doesn't include world-origin. Disable culling —
      // unused slots are zero-scaled and cost almost nothing in the
      // vertex shader.
      inst.frustumCulled = false;
      // Initialize all slots zero-scale (parked off-screen).
      for (let i = 0; i < INITIAL_CAP; i++) inst.setMatrixAt(i, _zero);
      // Force creation of the instanceColor attribute so future
      // setColorAt calls don't allocate mid-frame.
      _outColor.setRGB(1, 1, 1);
      for (let i = 0; i < INITIAL_CAP; i++) inst.setColorAt(i, _outColor);
      this.scene.add(inst);
      pool = {
        inst,
        free: [],
        // sources[i] = the source rig mesh whose matrixWorld feeds slot i.
        sources: new Array(INITIAL_CAP).fill(null),
        cap: INITIAL_CAP,
        role,
      };
      // Push in reverse so .pop() yields slot 0 first (visually nicer
      // when debugging — early actors land in low slot indices).
      for (let i = INITIAL_CAP - 1; i >= 0; i--) pool.free.push(i);
      this._pools.set(key, pool);
    }
    return pool;
  }

  // Identify role by comparing the source mesh's material reference
  // against the rig's per-role material map. This is the same role
  // taxonomy buildRig uses internally — six base roles + 'body' default.
  _roleOf(mesh, mats) {
    if (!mats) return 'body';
    if (mesh.material === mats.headMat) return 'head';
    if (mesh.material === mats.legMat)  return 'leg';
    if (mesh.material === mats.armMat)  return 'arm';
    if (mesh.material === mats.handMat) return 'hand';
    if (mesh.material === mats.gearMat) return 'gear';
    if (mesh.material === mats.bootMat) return 'boot';
    return 'body';
  }

  register(rig) {
    if (!rig || !rig.meshes || !rig.materials) return;
    if (rig._instSlots) return;     // already registered
    const mats = rig.materials;
    const slots = [];
    for (const m of rig.meshes) {
      if (!m || !m.geometry || !m.material) continue;
      const role = this._roleOf(m, mats);
      const pool = this._poolFor(m.geometry, role, m.castShadow === true);
      if (pool.free.length === 0) {
        // Pool full — keep the source mesh visible so the actor
        // still renders (just not via instancing). Warn once.
        if (!this._poolFullWarned) {
          console.warn('[rig_instancer] pool full for role', role,
            '- falling back to direct render');
          this._poolFullWarned = true;
        }
        continue;
      }
      const slot = pool.free.pop();
      pool.sources[slot] = m;
      m.userData._instSlot = slot;
      m.userData._instPool = pool;
      m.userData._instRole = role;
      // Capture the source material's base hex so flash lerp can
      // interpolate FROM the actor's actual tint, not a constant.
      m.userData._instBaseColor = m.material.color
        ? m.material.color.getHex()
        : 0xffffff;
      m.visible = false;
      _outColor.setHex(m.userData._instBaseColor);
      pool.inst.setColorAt(slot, _outColor);
      pool.inst.instanceColor.needsUpdate = true;
      slots.push({ pool, slot, mesh: m, role });
    }
    rig._instSlots = slots;
    this._actors.add(rig);
  }

  unregister(rig) {
    if (!rig || !rig._instSlots) return;
    const dirtyMatrix = new Set();
    for (const e of rig._instSlots) {
      e.pool.sources[e.slot] = null;
      e.pool.free.push(e.slot);
      e.pool.inst.setMatrixAt(e.slot, _zero);
      dirtyMatrix.add(e.pool);
      // Clear back-pointers on the source mesh so re-registration is safe.
      if (e.mesh && e.mesh.userData) {
        e.mesh.userData._instSlot = undefined;
        e.mesh.userData._instPool = undefined;
        e.mesh.userData._instRole = undefined;
        // Don't restore visible — the source mesh follows the rig
        // group's lifetime; if the caller is unregistering it's
        // because the actor is going away.
      }
    }
    for (const pool of dirtyMatrix) pool.inst.instanceMatrix.needsUpdate = true;
    rig._instSlots = null;
    this._actors.delete(rig);
  }

  // Per-frame sync. Forces matrixWorld updates on every registered
  // actor's root, then writes each source mesh's matrixWorld into its
  // instance slot. Hidden meshes (`_instHide=true` set by the disarm
  // path) get a zero-scale matrix so they don't draw without the slot
  // being released.
  syncFrame() {
    // Refresh matrixWorld on each registered actor's subtree. Three.js
    // would do this inside renderer.render() anyway; doing it here
    // means the instance matrices read from current data instead of
    // last-frame's matrices. The render pass's later updateMatrixWorld
    // is then a no-op for these subtrees.
    for (const rig of this._actors) {
      if (rig.group) rig.group.updateMatrixWorld(false);
    }
    const dirty = new Set();
    for (const rig of this._actors) {
      const slots = rig._instSlots;
      if (!slots) continue;
      for (let i = 0; i < slots.length; i++) {
        const e = slots[i];
        const m = e.mesh;
        if (!m) continue;
        if (m.userData._instHide) {
          e.pool.inst.setMatrixAt(e.slot, _zero);
        } else {
          e.pool.inst.setMatrixAt(e.slot, m.matrixWorld);
        }
        dirty.add(e.pool);
      }
    }
    for (const pool of dirty) pool.inst.instanceMatrix.needsUpdate = true;
  }

  // Hit-flash blend. k ∈ [0,1]; 0 = base actor color, 1 = full hurt red.
  // Mirrors the OLD bodyMat/headMat color lerp (which only flashed body
  // and head — gear/legs/arms/etc. didn't). Restores to base color
  // automatically as k drops (the AI tick lerps k → 0 over flashTime).
  setActorFlash(rig, k) {
    if (!rig || !rig._instSlots) return;
    const kk = Math.max(0, Math.min(1, k));
    const dirty = new Set();
    for (const e of rig._instSlots) {
      // Match old flash semantics: only body + head got tinted.
      if (e.role !== 'body' && e.role !== 'head') continue;
      const baseHex = e.mesh.userData._instBaseColor || 0xffffff;
      _baseColor.setHex(baseHex);
      _outColor.copy(_baseColor).lerp(_flashColor, kk);
      e.pool.inst.setColorAt(e.slot, _outColor);
      dirty.add(e.pool);
    }
    for (const pool of dirty) pool.inst.instanceColor.needsUpdate = true;
  }

  // Disarm path — flag a list of source meshes so syncFrame writes
  // zero-scale for them instead of matrixWorld. Used when the right
  // arm is hidden (boss/grunt disarm). Re-call with hidden=false to
  // restore (e.g. boss picks up a fallen weapon).
  hideMeshes(meshes, hidden) {
    if (!meshes) return;
    for (const m of meshes) {
      if (m && m.userData) m.userData._instHide = !!hidden;
    }
  }
}

let _singleton = null;
export function initRigInstancer(scene, opts) {
  _singleton = new RigInstancer(scene, opts);
  return _singleton;
}
export function rigInstancer() { return _singleton; }
