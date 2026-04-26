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

  // ADS camera offset. Pivot is ALWAYS the player position; the offset
  // is the *blended* delta between the player and the cursor's world
  // position, capped at the equipped weapon's drag budget. Lives at
  // module scope so the smoothing carries across frames — the press
  // blends in, cursor drag while ADS-held smoothly tracks the cursor.
  const _adsOffset = new THREE.Vector3();
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

    // ADS camera offset model:
    //   1. Pivot is ALWAYS the player position (`base`). The camera
    //      follows the player; ADS just adds a target offset on top.
    //   2. Target offset = (cursor_world - player_world) capped at
    //      `weaponPeek` metres (the weapon's drag budget — sniper
    //      ~35m, rifle ~21m, etc.). Continuously read each frame, so
    //      the press isn't a fixed jump and dragging the cursor
    //      around smoothly pulls the camera in that direction.
    //   3. Edge-pan falls out for free: the cursor's world position
    //      naturally extends toward the screen edge as the user
    //      drags it there, so the offset (and thus the camera) pans
    //      that way until it hits the budget cap.
    //   4. Smoothing is two-stage — `_adsOffset` lerps toward the
    //      target offset (the press blend + cursor follow) at a
    //      moderate rate; the look-at then lerps toward `base + offset`
    //      via the existing followLerp. ADS amount (`adsEased`) scales
    //      the whole offset so half-pressed ADS = half-pulled camera.
    const desired = _desiredScratch.copy(base);
    let targetOffsetX = 0;
    let targetOffsetZ = 0;
    if (adsEased > 0.01 && opts.aim) {
      const cdx = opts.aim.x - base.x;
      const cdz = opts.aim.z - base.z;
      const cdist = Math.sqrt(cdx * cdx + cdz * cdz);
      if (cdist > 0.0001) {
        // Cap the cursor delta at the weapon's drag budget. Cursor
        // beyond the budget radius parks the camera at the edge of
        // its reach in that direction.
        const reach = Math.min(cdist, weaponPeek);
        const k = (reach / cdist) * adsEased;
        targetOffsetX = cdx * k;
        targetOffsetZ = cdz * k;
      }
    }
    // Smooth chase toward the target offset — gives the press blend
    // (target jumps from 0 → cursor delta as ADS engages) and the
    // tracking follow when dragging the cursor while ADS-held. Bleeds
    // back to 0 on release the same way (target becomes 0 once
    // adsEased ≤ 0.01).
    const ek = 1 - Math.exp(-6 * dt);
    _adsOffset.x += (targetOffsetX - _adsOffset.x) * ek;
    _adsOffset.z += (targetOffsetZ - _adsOffset.z) * ek;
    desired.x += _adsOffset.x;
    desired.z += _adsOffset.z;

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
