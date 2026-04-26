import * as THREE from 'three';
import { tunables } from './tunables.js';

export function createScene() {
  const scene = new THREE.Scene();
  // Very dark blue-black — same colour the fog fades to so distant
  // geometry blends into the background seamlessly. The reference
  // splash has no visible horizon line; this matches.
  scene.background = new THREE.Color(0x06080f);
  // Exponential fog hides distance much faster than linear — geometry
  // starts fading almost immediately and is effectively invisible
  // past ~25m, so rooms feel enclosed and atmospheric instead of the
  // whole map rendering at once. Density = 0.035 gives the "visible
  // haze" read around light pools without making close objects
  // foggy.
  // Fog + global lights are driven by `tunables.lighting` so the F3
  // export + console tweaks can retune the whole look without a
  // reload. Initial values come from the tunable defaults.
  const L = tunables.lighting;
  scene.fog = new THREE.FogExp2(L.fogColor, L.fogDensity);

  const halfH = tunables.camera.viewHeight / 2;
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.OrthographicCamera(
    -halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, 200,
  );

  const isoOffset = new THREE.Vector3(20, 16.5, 20);
  const lookAt = new THREE.Vector3();

  function resize() {
    const aspect = window.innerWidth / window.innerHeight;
    const halfH = tunables.camera.viewHeight / 2;
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }

  // ADS press-snapshot offset. The pivot is the player; on press,
  // we blend toward a snapshotted direction (the cursor at press
  // time) by a *fraction* of the click-distance — the camera moves
  // partway between the player and the click point and STOPS. Only
  // outer-edge cursor pan extends the offset further (capped at the
  // weapon's drag budget). Lives at module scope so the edge-pan
  // smoothing carries across frames.
  const _adsEdgePan = new THREE.Vector3();
  // Scratch reused for the per-frame `desired` target — was a
  // `base.clone()` allocation every camera tick.
  const _desiredScratch = new THREE.Vector3();

  function updateCamera(dt, opts = {}) {
    const adsAmt = opts.adsAmount ?? 0;
    const weaponPeek = opts.adsPeekDistance ?? 5;
    // ADS frustum push-in driven by the equipped sight. sightZoom is
    // the multiplier on apparent size (iron 1.05, red dot 1.10, holo
    // 1.15, mid scope 1.20, long scope 1.30). Frustum shrinks to
    // 1/sightZoom so 1.20× zoom = 0.833× frustum height. Drag
    // distance (weaponPeek) is decoupled — better sights also bump
    // the peek budget so you can pan further.
    const sightZoom = opts.sightZoom ?? 1.05;
    const adsFrustumShrink = 1 / sightZoom;
    const adsEased = adsAmt * adsAmt * (3 - 2 * adsAmt);
    const base = opts.target || new THREE.Vector3();
    const zoomK = THREE.MathUtils.lerp(1, adsFrustumShrink, adsEased);
    const halfH = (tunables.camera.viewHeight * zoomK) / 2;
    const aspect = window.innerWidth / window.innerHeight;
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();

    // ADS camera offset model — press snapshot + edge pan:
    //   1. Pivot is ALWAYS the player position (`base`).
    //   2. On press, main.js snapshots the cursor's direction +
    //      distance from the player into `opts.adsPeekDir`. Camera
    //      blends from the pivot toward a point that's PRESS_REACH_FACTOR
    //      of the way to the click point, then stops. This is the
    //      "centers the crosshair somewhat between pivot and click"
    //      feel — moderate push-in, not a yank to the click point.
    //   3. While ADS-held, only when the cursor enters the OUTER
    //      EDGE_THRESHOLD region of the screen does the offset
    //      extend further in that direction. Edge-pan can consume
    //      whatever budget the press didn't, up to weaponPeek total.
    //   4. ADS release bleeds the edge-pan offset back to zero so
    //      the next press starts cleanly.
    const desired = _desiredScratch.copy(base);
    if (adsEased > 0.05 && opts.adsPeekDir) {
      // PRESS_REACH_FACTOR controls how far between the player and
      // the click point the camera travels. Lower = subtler push-in
      // (user feedback: "the camera distance was too great"). With
      // 0.45, a 10m cursor distance pushes the camera 4.5m toward
      // it. Hard-capped at weaponPeek.
      const PRESS_REACH_FACTOR = 0.45;
      const distAtPress = opts.adsPeekDir._distAtPress ?? weaponPeek;
      const initialReach = Math.min(distAtPress * PRESS_REACH_FACTOR, weaponPeek);
      const peekStrength = adsEased * initialReach;
      desired.x += opts.adsPeekDir.x * peekStrength;
      desired.z += opts.adsPeekDir.z * peekStrength;
      // Edge-of-screen pan — outer region only (deadzone is the
      // inner EDGE_THRESHOLD of the cursor NDC). When the cursor
      // enters the outer band, the anchor slides in that direction.
      const ndc = opts.cursorNDC;
      if (ndc) {
        const EDGE_THRESHOLD = 0.65;
        // Reserve whatever budget the press didn't use for edge-pan.
        // Sniper press at 6m of an 8m budget leaves 2m of edge-pan;
        // SMG press at 1m of 4m leaves 3m. With the smaller press
        // factor above the budget mostly survives for edge-pan.
        const MAX_EDGE_OFFSET = Math.max(0, weaponPeek - initialReach);
        const computeAxis = (v) => {
          const a = Math.abs(v);
          if (a <= EDGE_THRESHOLD) return 0;
          const t = Math.min(1, (a - EDGE_THRESHOLD) / (1 - EDGE_THRESHOLD));
          return Math.sign(v) * t * t * (3 - 2 * t);
        };
        const ex = computeAxis(ndc.x);
        const ey = computeAxis(ndc.y);
        // NDC y points UP; iso forward is roughly -Z, so a positive
        // ndc.y nudges the anchor toward -Z. NDC x maps to +X.
        const targetEdgeX = ex * MAX_EDGE_OFFSET * adsEased;
        const targetEdgeZ = -ey * MAX_EDGE_OFFSET * adsEased;
        // Smooth chase so the lean eases in/out instead of snapping
        // when the cursor crosses the deadzone boundary.
        const ek = 1 - Math.exp(-6 * dt);
        _adsEdgePan.x += (targetEdgeX - _adsEdgePan.x) * ek;
        _adsEdgePan.z += (targetEdgeZ - _adsEdgePan.z) * ek;
        desired.x += _adsEdgePan.x;
        desired.z += _adsEdgePan.z;
      } else {
        _adsEdgePan.multiplyScalar(0.85);
      }
    } else {
      // ADS released — bleed the edge-pan offset back to zero.
      _adsEdgePan.multiplyScalar(0.85);
    }

    const k = 1 - Math.exp(-tunables.camera.followLerp * dt);
    lookAt.lerp(desired, k);

    camera.position.copy(lookAt).add(isoOffset);
    camera.lookAt(lookAt);
  }

  // Cold-Exit palette: unlit surfaces fall to near-black. Global fill
  // lights are dialled WAY down so SpotLights (streetlamp cones in the
  // world) do the heavy lifting — walls only light up where a real
  // source falls on them, corridors between lights drop into cool
  // darkness, and the player silhouettes against fog-lit backgrounds.
  // Previous values had a 0.70-intensity key directional that was
  // effectively an outdoor sun, which washed the whole map evenly
  // and killed contrast.
  const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiIntensity);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(L.keyColor, L.keyIntensity);
  key.position.set(30, 40, 20);
  key.castShadow = true;
  // Shadow map dropped 1024² → 512² (4× fewer pixels rendered per
  // shadow pass). Combined with the corpse + wall castShadow flips
  // below, the shadow render pass cost is roughly 25% of what it
  // was. Visual loss at iso angle is minor — soft-PCF filtering
  // hides the resolution drop on low-frequency wall shadows.
  key.shadow.mapSize.set(512, 512);
  const s = 40;
  key.shadow.camera.left = -s;
  key.shadow.camera.right = s;
  key.shadow.camera.top = s;
  key.shadow.camera.bottom = -s;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 140;
  key.shadow.bias = -0.0005;
  scene.add(key);

  // Fill keeps shadow side from blocking into the fog as an
  // indistinct blob, but stays cool so it doesn't fight the warm
  // SpotLights visually.
  const fill = new THREE.DirectionalLight(L.fillColor, L.fillIntensity);
  fill.position.set(-20, 15, -25);
  scene.add(fill);

  // Rim stays — it's THE thing that carves characters out against the
  // dark ground in the reference image.
  const rim = new THREE.DirectionalLight(L.rimColor, L.rimIntensity);
  rim.position.set(-10, 22, 35);
  scene.add(rim);

  // Floor catches warm SpotLight as a wet-concrete streak. Lowered
  // roughness and a touch of metalness give lamp pools a visible
  // specular falloff across the ground — sells the neon-noir look
  // far more than any single lighting change.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshStandardMaterial({
      color: 0x0a0c12,
      roughness: 0.6,
      metalness: 0.35,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(300, 150, 0x1a1c24, 0x0e1014);
  grid.position.y = 0.01;
  scene.add(grid);

  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  return { scene, camera, updateCamera, resize, groundPlane,
    hemiLight: hemi, keyLight: key, fillLight: fill, rimLight: rim,
    gridHelper: grid };
}
