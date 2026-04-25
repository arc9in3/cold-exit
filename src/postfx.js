// Post-processing pipeline: bloom on bright emissives + vignette/grain
// composite. Runs through EffectComposer stacked on the main renderer.
// Gated by qualityFlags.postFx — low-quality mode skips the whole chain
// and reverts to a direct renderer.render call for cheap frames.
//
// Shader notes: the vignette and film-grain live in one fragment shader
// to keep the final pass count small (one bloom combine + one grain).
// Grain is driven off gl_FragCoord plus a time uniform so it animates.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Combined vignette + film-grain + subtle chromatic edge tint. Cheap
// one-pass finisher that runs after the bloom composite.
const FinisherShader = {
  uniforms: {
    tDiffuse:  { value: null },
    uTime:     { value: 0.0 },
    uStrength: { value: 0.22 },    // vignette darkness at corners
    uGrain:    { value: 0.0 },     // grain disabled — read as static noise in play
    uChroma:   { value: 0.0015 },  // chromatic edge split (in UV units)
    // LoS mask — texture written by los_mask.js each frame. UVs match
    // the main camera's screen so we sample by vUv directly. Mask is
    // 1.0 where the player can see, 0.0 where occluded.
    tLosMask:  { value: null },
    uLosOn:    { value: 0.0 },     // 0 disables the LoS pass entirely (toggle / saves)
    uLosDark:  { value: 0.30 },    // floor brightness applied outside LoS
    uLosSoft:  { value: 0.06 },    // smoothstep edge width on the mask
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform sampler2D tLosMask;
    uniform float uTime;
    uniform float uStrength;
    uniform float uGrain;
    uniform float uChroma;
    uniform float uLosOn;
    uniform float uLosDark;
    uniform float uLosSoft;

    // Classic hash for per-pixel noise; the per-frame time shift
    // animates the grain so it reads as film instead of a static
    // paper texture.
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      // Edge-biased chromatic split — stronger aberration at the
      // corners, near zero in the middle.
      vec2 off = c * uChroma * (0.4 + r2 * 3.0);
      float colR = texture2D(tDiffuse, uv + off).r;
      float colG = texture2D(tDiffuse, uv).g;
      float colB = texture2D(tDiffuse, uv - off).b;
      vec3 col = vec3(colR, colG, colB);

      // Vignette — smooth falloff so the darkening doesn't band.
      float vig = smoothstep(0.75, 0.2, length(c));
      col *= mix(1.0 - uStrength, 1.0, vig);

      // LoS darkening — sample the visibility mask written by
      // los_mask.js. White inside the player's visibility fan, black
      // elsewhere. Smoothstep widens shadow edges so the boundary
      // doesn't read as a hard line. Tap a 4-sample box-blur to soften
      // any aliasing at the half-resolution mask edge.
      if (uLosOn > 0.5) {
        vec2 px = vec2(0.0015, 0.002);
        float m  = texture2D(tLosMask, uv).r;
        m += texture2D(tLosMask, uv + vec2( px.x, 0.0)).r;
        m += texture2D(tLosMask, uv + vec2(-px.x, 0.0)).r;
        m += texture2D(tLosMask, uv + vec2(0.0,  px.y)).r;
        m += texture2D(tLosMask, uv + vec2(0.0, -px.y)).r;
        m *= 0.2;
        float vis = smoothstep(0.0, max(0.001, uLosSoft), m);
        col *= mix(uLosDark, 1.0, vis);
      }

      // Animated grain — additive, small amplitude.
      float n = hash(gl_FragCoord.xy + uTime * 60.0) - 0.5;
      col += n * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createPostFx(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Bloom — tuned for the game's dark interiors where only emissives
  // (muzzle flashes, tracers, explosions, lamps) should bleed light.
  // Threshold is pushed high so the baseline scene doesn't glow.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.75,   // strength
    0.8,    // radius
    0.85,   // threshold — only pixels brighter than this bloom
  );
  composer.addPass(bloom);

  const finisher = new ShaderPass(FinisherShader);
  composer.addPass(finisher);

  const output = new OutputPass();
  composer.addPass(output);

  function resize(w, h) {
    composer.setSize(w, h);
    bloom.setSize(w, h);
  }

  function render(dt) {
    finisher.uniforms.uTime.value += (dt || 0.016);
    composer.render();
  }

  // Wire the LoS visibility mask and toggle the darkening pass on.
  // Pass null/false to disable. Once wired, the mask texture is read
  // each composer.render so the caller just needs to keep it updated.
  function setLosMask(texture, enabled = true) {
    finisher.uniforms.tLosMask.value = texture || null;
    finisher.uniforms.uLosOn.value = enabled && texture ? 1.0 : 0.0;
  }

  return { composer, bloom, finisher, render, resize, setLosMask };
}
