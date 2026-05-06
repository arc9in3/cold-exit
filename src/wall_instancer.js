// Wall instancer — collapses per-wall draw calls.
//
// Pre-instancing, each call to Level._addObstacle minted a fresh
// THREE.Mesh(BoxGeometry, MeshStandardMaterial) for every wall
// segment. A typical level had 250-550 such walls, all axis-aligned
// boxes scaled per-instance. The renderer paid a draw call per wall.
//
// This module pools wall meshes into per-color InstancedMesh objects.
// One unit-cube geometry feeds every wall via per-instance matrices
// (translation + scale baked into the matrix). Per-instance color is
// not required — every wall in a pool already shares a color, so the
// pool's material carries it.
//
// Design choices:
//   - Existing call sites (Level._addObstacle) keep returning a
//     "proxy" object with `.userData`, `.position`, `.material`,
//     `.geometry`, `.visible`, etc. so downstream code (collision,
//     `_clearDoorCorridors`, `_repairDoorOverlaps`, the dispose loop
//     in `clear()`) keeps working unchanged. The proxy is NOT added
//     to the scene; the InstancedMesh is.
//   - Setting `proxy.visible = false` zero-scales the instance slot
//     so the visual disappears immediately, matching the original
//     mesh.visible behaviour. Implemented via a property setter on
//     the proxy.
//   - Doors are NOT routed through this instancer. They animate
//     (open/close scale.y, color flip), and the cost of plumbing
//     dynamic instances isn't worth it for the small set of doors
//     per level. They still build via the original Mesh path.
//   - Disposing the InstancedMesh + shared geometry happens in
//     teardown(); Level.clear() invokes it before zeroing
//     this.obstacles.

import * as THREE from 'three';

// Initial per-color pool capacity. Walls per level peak around 280-320
// outer walls + ~50 interior walls per single-color theme, but most
// levels only use 1 outer color and 1 inner color, so 512 is a safe
// upper bound that avoids any reallocation churn during generation.
const INITIAL_CAP = 512;

// One shared unit-cube geometry. Per-instance matrices scale it to
// each wall's (w, h, d). Stamp shared so any traversal-based dispose
// loop skips it.
let _unitCube = null;
function unitCubeGeometry() {
  if (_unitCube) return _unitCube;
  _unitCube = new THREE.BoxGeometry(1, 1, 1);
  _unitCube.userData = _unitCube.userData || {};
  _unitCube.userData.sharedRigGeom = true;
  return _unitCube;
}

const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _scratchMat4 = new THREE.Matrix4();
const _scratchPos = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3();

class WallInstancer {
  constructor(scene) {
    this.scene = scene;
    // color (hex int) → pool record { inst, free, occupied, sources, cap }
    this._pools = new Map();
    this._poolFullWarned = false;
  }

  _poolFor(color, roughness = 0.85) {
    let pool = this._pools.get(color);
    if (!pool) {
      // OPAQUE twin — every wall renders here by default. Standard
      // settings: writes depth, no alpha blend.
      const opaqueMat = new THREE.MeshStandardMaterial({ color, roughness });
      const opaqueInst = new THREE.InstancedMesh(unitCubeGeometry(), opaqueMat, INITIAL_CAP);
      opaqueInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      opaqueInst.castShadow = false;
      opaqueInst.receiveShadow = true;
      opaqueInst.frustumCulled = false;
      // GHOST twin — same geometry pool, alpha-blended material with
      // depthWrite OFF. Faded walls swap to this mesh so:
      //   * the slot in the opaque mesh zero-scales (no occluder)
      //   * the slot in the ghost mesh full-scales (faded silhouette)
      // The ghost pool's depthWrite=false means anything behind the
      // wall (the enemy the player wants to see) renders without
      // being occluded; transparent=true + opacity=0.45 keeps a
      // visible silhouette so the wall has presence.
      //
      // Per-instance color (instanceColor) was tried first but it
      // only changes the surface RGB — the wall still wrote to
      // depth and blocked everything behind it. Real alpha blending
      // requires transparent=true on the material, which is a per-
      // pool flag, hence the twin pool.
      const ghostMat = new THREE.MeshStandardMaterial({
        color, roughness,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      });
      const ghostInst = new THREE.InstancedMesh(unitCubeGeometry(), ghostMat, INITIAL_CAP);
      ghostInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      ghostInst.castShadow = false;
      ghostInst.receiveShadow = true;
      ghostInst.frustumCulled = false;
      ghostInst.renderOrder = 1;          // render after opaque pass
      // Park every slot zero-scaled in BOTH twins. setMatrixAt
      // copies, so _zero is reusable.
      for (let i = 0; i < INITIAL_CAP; i++) {
        opaqueInst.setMatrixAt(i, _zero);
        ghostInst.setMatrixAt(i, _zero);
      }
      this.scene.add(opaqueInst);
      this.scene.add(ghostInst);
      pool = {
        inst: opaqueInst,
        ghostInst,
        free: [],
        sources: new Array(INITIAL_CAP).fill(null),
        cap: INITIAL_CAP,
        color,
      };
      for (let i = INITIAL_CAP - 1; i >= 0; i--) pool.free.push(i);
      this._pools.set(color, pool);
    }
    return pool;
  }

  // Build a wall proxy. Returns an object that quacks like a THREE.Mesh
  // for the slice of API Level / projectiles / scene-graph dispose use:
  //   - userData (collisionXZ, kind, etc.)
  //   - visible (settable; flips InstancedMesh slot to zero-scale)
  //   - position { x, y, z, set(...) }
  //   - geometry, material (geometry is the shared unit cube; material
  //     is a plain object whose color.getHex() returns this wall's hex,
  //     so `_clearDoorCorridors` color-comparison still works)
  //   - geometry.parameters (BoxGeometry stamps {width,height,depth};
  //     `_clearDoorCorridors` reads .geometry.parameters to detect
  //     horizontal vs vertical orientation, but only on doors — doors
  //     skip this path entirely so we don't need parameter accuracy)
  //
  // The proxy is NOT added to the scene. The InstancedMesh visual is
  // added once per pool when the pool is created.
  addWall(x, y, z, w, h, d, color, roughness = 0.85) {
    const pool = this._poolFor(color, roughness);
    if (pool.free.length === 0) {
      if (!this._poolFullWarned) {
        console.warn('[wall_instancer] pool full for color',
          color.toString(16), '— exceeding cap', pool.cap);
        this._poolFullWarned = true;
      }
      // Caller falls back to direct mesh; signal by returning null.
      return null;
    }
    const slot = pool.free.pop();
    const proxy = makeProxy(this, pool, slot, x, y, z, w, h, d, color);
    pool.sources[slot] = proxy;
    // Bake matrix once — walls don't move.
    _scratchPos.set(x, y, z);
    _scratchQuat.identity();
    _scratchScale.set(w, h, d);
    _scratchMat4.compose(_scratchPos, _scratchQuat, _scratchScale);
    pool.inst.setMatrixAt(slot, _scratchMat4);
    pool.inst.instanceMatrix.needsUpdate = true;
    return proxy;
  }

  // Recompute the slot's matrix in BOTH twin meshes. Three states:
  //   gameplay-hidden (!_visible)            → zero-scale both
  //   occlusion-faded (_occlHidden, visible) → opaque zero, ghost full
  //   normal          (visible, !occlHidden) → opaque full, ghost zero
  _refreshSlot(proxy) {
    const pool = proxy._pool;
    if (!pool) return;
    const slot = proxy._slot;
    let opaqueMat = _zero;
    let ghostMat = _zero;
    if (proxy._visible) {
      _scratchPos.set(proxy.position.x, proxy.position.y, proxy.position.z);
      _scratchQuat.identity();
      _scratchScale.set(proxy._w, proxy._h, proxy._d);
      _scratchMat4.compose(_scratchPos, _scratchQuat, _scratchScale);
      if (proxy._occlHidden) {
        ghostMat = _scratchMat4;
      } else {
        opaqueMat = _scratchMat4;
      }
    }
    pool.inst.setMatrixAt(slot, opaqueMat);
    pool.inst.instanceMatrix.needsUpdate = true;
    if (pool.ghostInst) {
      pool.ghostInst.setMatrixAt(slot, ghostMat);
      pool.ghostInst.instanceMatrix.needsUpdate = true;
    }
  }

  // Old name kept for back-compat with the visible-setter call site
  // below — same as _refreshSlot.
  _setVisible(proxy /* , _v unused */) {
    this._refreshSlot(proxy);
  }

  // Tear down every pool and dispose its InstancedMesh + material. The
  // shared unit-cube geometry stays alive across teardowns (it'll be
  // reused on the next generate()'s pool creation).
  teardown() {
    for (const pool of this._pools.values()) {
      this.scene.remove(pool.inst);
      pool.inst.dispose?.();
      pool.inst.material?.dispose?.();
      if (pool.ghostInst) {
        this.scene.remove(pool.ghostInst);
        pool.ghostInst.dispose?.();
        pool.ghostInst.material?.dispose?.();
      }
    }
    this._pools.clear();
  }

  // Stats — used by perf probe / debugging.
  stats() {
    const out = {};
    for (const [color, p] of this._pools) {
      out[color.toString(16)] = {
        cap: p.cap,
        used: p.cap - p.free.length,
      };
    }
    return out;
  }
}

// Build a proxy object. Implemented as a plain factory rather than a
// class so the closure over the pool/slot is dead simple and there's
// no prototype machinery for engine code to trip over.
function makeProxy(instancer, pool, slot, x, y, z, w, h, d, color) {
  const proxy = {
    isMesh: true,                  // tricks scene.traverse type checks
    isWallProxy: true,
    _pool: pool,
    _slot: slot,
    _w: w, _h: h, _d: d,
    _visible: true,
    // Independent occlusion-fade flag. main.js's wall-occlusion pass
    // uses setOcclHidden(true) to make a wall visually disappear when
    // it sits between the camera and the player/enemy, without
    // touching `_visible` (which gameplay code uses for "this wall
    // doesn't exist any more"). Keeping these orthogonal means
    // raycasts still hit faded walls — without that, the next frame
    // wouldn't see the wall as occluding and we'd flicker on/off.
    _occlHidden: false,
    position: { x, y, z, set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; } },
    rotation: { x: 0, y: 0, z: 0 },
    // Three.js Raycaster.intersectObject calls `object.layers.test(...)`
    // and `object.raycast(...)` on every candidate. We need both to work
    // correctly because:
    //   - hasLineOfSight (combat.js) raycasts the obstacle list to
    //     decide enemy LoS / wall occlusion. Returning false from
    //     layers.test() makes the raycaster skip every wall — AI then
    //     thinks LoS is clear and shoots through walls.
    //   - But the proxy isn't a real mesh; its geometry is just a
    //     {parameters} stub, so the default Mesh.raycast (which walks
    //     triangles) would crash. We provide our own raycast that
    //     does an analytic ray-vs-AABB intersection from the wall's
    //     world-space box (translation + scale baked into the
    //     InstancedMesh slot, mirrored on the proxy via _w/_h/_d).
    layers: { test() { return true; }, mask: 1 },
    raycast(raycaster, intersects) {
      // Skip if the proxy slot is hidden (zero-scaled in the InstancedMesh)
      // or the raycaster doesn't include our layer.
      if (!this._visible) return;
      const ray = raycaster.ray;
      const px = this.position.x, py = this.position.y, pz = this.position.z;
      const minX = px - this._w / 2, maxX = px + this._w / 2;
      const minY = py - this._h / 2, maxY = py + this._h / 2;
      const minZ = pz - this._d / 2, maxZ = pz + this._d / 2;
      // Slab-test ray vs AABB. Each axis: tNear = enter-distance,
      // tFar = exit-distance. Intersection when max(tNear) <= min(tFar)
      // AND that interval overlaps [near, far]. Standard branchless
      // version is messier; explicit branches read fine for one wall.
      const o = ray.origin, d = ray.direction;
      let tmin = -Infinity, tmax = Infinity;
      const axes = [
        [o.x, d.x, minX, maxX],
        [o.y, d.y, minY, maxY],
        [o.z, d.z, minZ, maxZ],
      ];
      for (const [oi, di, lo, hi] of axes) {
        if (Math.abs(di) < 1e-9) {
          if (oi < lo || oi > hi) return;     // parallel + outside slab
          continue;
        }
        let t1 = (lo - oi) / di;
        let t2 = (hi - oi) / di;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return;
      }
      // tmin = first entry distance (could be negative if ray starts inside).
      const t = tmin >= 0 ? tmin : tmax;
      if (t < raycaster.near || t > raycaster.far) return;
      // Build a hit point. point MUST be a real THREE.Vector3 — downstream
      // code (resolveAim's _resolveAimRaycast, melee proximity, etc.)
      // calls .distanceTo() / .clone() / .sub() on it, all real Vector3
      // methods. A plain {x,y,z} stub crashes those callers.
      intersects.push({
        distance: t,
        point: new THREE.Vector3(
          o.x + d.x * t,
          o.y + d.y * t,
          o.z + d.z * t,
        ),
        object: this,
        face: null, faceIndex: -1, uv: null,
      });
    },
    userData: {},
    // Proxy geometry/material are stubs whose .dispose() is a no-op so
    // Level.clear()'s blanket dispose loop can run unchanged. The real
    // visual geometry + material live on the InstancedMesh inside the
    // pool; teardown() owns their lifecycle.
    geometry: {
      parameters: { width: w, height: h, depth: d },
      dispose() {},
    },
    material: {
      color: {
        _hex: color,
        getHex() { return this._hex; },
        setHex(h) { this._hex = h; },   // pretend; doors don't go through here
      },
      dispose() {},                  // no-op; pool owns disposal
    },
    parent: null,
    matrixAutoUpdate: false,
    updateMatrix() {},               // no-op; matrix lives in the InstancedMesh
    updateMatrixWorld() {},
    // Occlusion-fade entry. Pass true to visually hide the slot for
    // the camera→target line; false to restore. Independent from
    // `visible` so raycasts (LoS, AI, fade-detection itself) still
    // see the wall.
    setOcclHidden(hidden) {
      const next = !!hidden;
      if (this._occlHidden === next) return;
      this._occlHidden = next;
      instancer._refreshSlot(this);
    },
  };
  Object.defineProperty(proxy, 'visible', {
    get() { return this._visible; },
    set(v) {
      const next = !!v;
      if (this._visible === next) return;
      this._visible = next;
      instancer._refreshSlot(this);
    },
    enumerable: true, configurable: false,
  });
  return proxy;
}

let _singleton = null;
export function initWallInstancer(scene) {
  if (_singleton) _singleton.teardown();
  _singleton = new WallInstancer(scene);
  return _singleton;
}
export function wallInstancer() { return _singleton; }
