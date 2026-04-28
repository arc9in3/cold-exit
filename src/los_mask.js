// Player line-of-sight visibility mask. Rendered once per frame into a
// half-resolution render target and consumed by the postfx finisher
// shader to darken the world outside the player's LoS.
//
// Approach: a top-down fan polygon from the player's world position to
// raycast endpoints against vision-blocking obstacles (walls + closed
// doors). Rendered with the SAME main camera projection as the scene
// so the mask UVs line up with screen UVs in the post-fx pass — no
// depth reconstruction needed. Tall objects above out-of-LoS floor
// inherit the darkening because the floor beneath them at that screen
// pixel is dark in the mask.
//
// Mask is single-channel grayscale: 1.0 = visible, 0.0 = occluded. The
// finisher shader smoothsteps the edge so shadow lines aren't jagged.

import * as THREE from 'three';

// Ray count dropped 48 → 32 (~33% fewer rays/eval). The finisher's
// smoothstep on the sampled mask hides the slight extra faceting; at
// the iso camera distance + half-res mask, the difference isn't
// readable in motion.
const RAY_COUNT = 32;
const RAY_RANGE = 48;       // meters — bumped 32 → 48 so the player sees rooms ahead before
                            // entering them; was reading as a tight, claustrophobic LoS bubble
const MASK_SCALE = 0.35;    // quarter-ish-res mask cuts GPU mask render to ~30%; smoothstep masks the resolution loss
const FAN_HEIGHT = 0.04;    // sits a hair above the floor so it doesn't z-fight
// Update cadence — every 3 frames (~20Hz at 60fps) is still plenty
// for human walking pace, and saves another ~33% of LoS CPU vs the
// previous every-other-frame schedule.
const UPDATE_EVERY_N_FRAMES = 3;

export function createLosMask(renderer, sourceCamera) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);   // anything outside the fan = black

  // Visibility fan — N triangles meeting at the player position. Each
  // triangle's outer edge is between two adjacent ray endpoints, so
  // the fan tightly hugs whatever the rays found (walls, doors, max
  // range). We allocate N+1 vertices: index 0 = player centre, indices
  // 1..N = ray endpoints (closed by wrapping back to index 1).
  const fanGeom = new THREE.BufferGeometry();
  const positions = new Float32Array((RAY_COUNT + 1) * 3);
  fanGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const indices = new Uint16Array(RAY_COUNT * 3);
  for (let i = 0; i < RAY_COUNT; i++) {
    const next = (i + 1) % RAY_COUNT;
    indices[i * 3 + 0] = 0;            // player centre
    indices[i * 3 + 1] = i + 1;        // ray endpoint i
    indices[i * 3 + 2] = next + 1;     // ray endpoint i+1 (wrap)
  }
  fanGeom.setIndex(new THREE.BufferAttribute(indices, 1));
  const fanMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, side: THREE.DoubleSide, depthWrite: false, depthTest: false,
  });
  const fan = new THREE.Mesh(fanGeom, fanMat);
  fan.frustumCulled = false;
  scene.add(fan);

  // Render target — half-res because the mask will be smoothstep'd in
  // the finisher anyway, and a 1× target doubles GPU bandwidth for no
  // perceptual gain. R-only would be ideal but RGBA stays portable.
  const w = Math.max(1, Math.floor(renderer.domElement.width  * MASK_SCALE));
  const h = Math.max(1, Math.floor(renderer.domElement.height * MASK_SCALE));
  const renderTarget = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
  });

  const _origin = new THREE.Vector3();
  const _dir    = new THREE.Vector3();
  const _ray    = new THREE.Raycaster();

  let _frame = 0;
  function update(playerPos, blockers) {
    if (!playerPos) return;
    // Skip the raycast + render most frames. The mask texture stays
    // valid on intermediate frames (the postFx finisher samples
    // whatever was last written), and the smoothstep edge masks the
    // brief positional staleness when the player is moving fast.
    _frame = (_frame + 1) | 0;
    if ((_frame % UPDATE_EVERY_N_FRAMES) !== 0) return;
    const arr = fan.geometry.attributes.position.array;
    arr[0] = playerPos.x;
    arr[1] = FAN_HEIGHT;
    arr[2] = playerPos.z;
    _origin.set(playerPos.x, 1.2, playerPos.z);
    const list = blockers || [];
    // Minimum hit distance — anything closer than this is treated as
    // a self-intersection (player standing on a wall edge / inside a
    // door's bbox after walking through a frame) and ignored. Without
    // this filter, BVH-accelerated raycasts return a 0-distance hit
    // for a ray whose origin is inside a wall AABB, which collapses
    // the visibility fan to a single point and renders the whole world
    // black to the player.
    const NEAR = 0.15;
    for (let i = 0; i < RAY_COUNT; i++) {
      const angle = (i / RAY_COUNT) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      _dir.set(dx, 0, dz);
      _ray.set(_origin, _dir);
      _ray.far = RAY_RANGE;
      const hits = list.length ? _ray.intersectObjects(list, false) : [];
      // Walk past degenerate near-zero hits to the first real wall
      // intersection. If every hit is near-zero (player jammed inside
      // a wall) fall back to max range so the fan doesn't collapse.
      let dist = RAY_RANGE;
      for (let h = 0; h < hits.length; h++) {
        if (hits[h].distance >= NEAR) { dist = hits[h].distance; break; }
      }
      const idx = (i + 1) * 3;
      arr[idx]     = playerPos.x + dx * dist;
      arr[idx + 1] = FAN_HEIGHT;
      arr[idx + 2] = playerPos.z + dz * dist;
    }
    fan.geometry.attributes.position.needsUpdate = true;

    // Pre-clear → render → restore. The finisher uniform points at
    // renderTarget.texture so reading it next pass gets the latest.
    const prev = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(renderTarget);
    renderer.render(scene, sourceCamera);
    renderer.setRenderTarget(prev);
    renderer.autoClear = prevAutoClear;
  }

  function resize(rw, rh) {
    renderTarget.setSize(
      Math.max(1, Math.floor(rw * MASK_SCALE)),
      Math.max(1, Math.floor(rh * MASK_SCALE)),
    );
  }

  return { texture: renderTarget.texture, update, resize };
}
