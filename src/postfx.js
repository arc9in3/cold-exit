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
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// --- Kawase / dual-filter bloom ---------------------------------------------
// Drop-in replacement for UnrealBloomPass. The big difference: no mip
// chain. The work breaks down to:
//   1. Bright-pass extract at half-res (one fullscreen quad).
//   2. Two diagonal-tap blur passes ping-ponging at half-res
//      (two fullscreen quads).
//   3. Composite back into the scene at full res (one fullscreen quad).
// Total: 4 fullscreen draws at half resolution + 1 at full. UnrealBloom
// runs ~10 fullscreen draws across 5 mip levels, each with its own RT
// allocation. On a typical iGPU this is 30-50% cheaper.

const _BrightFrag = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tDiffuse, vUv);
    float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    float keep = smoothstep(uThreshold, uThreshold + 0.1, lum);
    gl_FragColor = vec4(c.rgb * keep * uIntensity, 1.0);
  }
`;
const _BlurFrag = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 uPx;
  varying vec2 vUv;
  void main() {
    vec3 sum = vec3(0.0);
    sum += texture2D(tDiffuse, vUv + vec2( uPx.x,  uPx.y)).rgb;
    sum += texture2D(tDiffuse, vUv + vec2(-uPx.x,  uPx.y)).rgb;
    sum += texture2D(tDiffuse, vUv + vec2( uPx.x, -uPx.y)).rgb;
    sum += texture2D(tDiffuse, vUv + vec2(-uPx.x, -uPx.y)).rgb;
    gl_FragColor = vec4(sum * 0.25, 1.0);
  }
`;
const _CompFrag = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform float uBloom;
  varying vec2 vUv;
  void main() {
    vec3 scene = texture2D(tDiffuse, vUv).rgb;
    vec3 bloom = texture2D(tBloom,   vUv).rgb;
    gl_FragColor = vec4(scene + bloom * uBloom, 1.0);
  }
`;
const _PassVtx = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

class KawaseBloomPass extends Pass {
  constructor(width, height, strength = 0.75, threshold = 0.85) {
    super();
    this.needsSwap = true;
    const w = Math.max(1, width >> 1);
    const h = Math.max(1, height >> 1);
    const rtOpts = {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.HalfFloatType,
      depthBuffer: false, stencilBuffer: false,
    };
    this.rtA = new THREE.WebGLRenderTarget(w, h, rtOpts);
    this.rtB = new THREE.WebGLRenderTarget(w, h, rtOpts);

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse:   { value: null },
        uThreshold: { value: threshold },
        uIntensity: { value: strength },
      },
      vertexShader: _PassVtx, fragmentShader: _BrightFrag,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uPx:      { value: new THREE.Vector2(1 / w, 1 / h) },
      },
      vertexShader: _PassVtx, fragmentShader: _BlurFrag,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tBloom:   { value: null },
        uBloom:   { value: 1.0 },
      },
      vertexShader: _PassVtx, fragmentShader: _CompFrag,
    });
    this._fs = new FullScreenQuad();
  }

  setSize(width, height) {
    const w = Math.max(1, width >> 1);
    const h = Math.max(1, height >> 1);
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.blurMat.uniforms.uPx.value.set(1 / w, 1 / h);
  }

  // strength / threshold getter-setters mirror the UnrealBloom API
  // surface so the rest of postfx.js can configure them the same way.
  get strength()  { return this.brightMat.uniforms.uIntensity.value; }
  set strength(v) { this.brightMat.uniforms.uIntensity.value = v; }
  get threshold()  { return this.brightMat.uniforms.uThreshold.value; }
  set threshold(v) { this.brightMat.uniforms.uThreshold.value = v; }

  dispose() {
    this.rtA.dispose(); this.rtB.dispose();
    this.brightMat.dispose(); this.blurMat.dispose(); this.compMat.dispose();
    if (this._fs?.dispose) this._fs.dispose();
  }

  render(renderer, writeBuffer, readBuffer) {
    // Save/restore renderer state — we touch render targets ourselves.
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;

    // 1) Bright extract: readBuffer → rtA at half-res.
    this.brightMat.uniforms.tDiffuse.value = readBuffer.texture;
    this._fs.material = this.brightMat;
    renderer.setRenderTarget(this.rtA);
    this._fs.render(renderer);

    // 2) Two-pass blur ping-pong (4 diagonal-tap blurs total → ~5×5
    //    effective kernel). rtA → rtB → rtA → rtB.
    this._fs.material = this.blurMat;

    this.blurMat.uniforms.tDiffuse.value = this.rtA.texture;
    renderer.setRenderTarget(this.rtB);
    this._fs.render(renderer);

    this.blurMat.uniforms.tDiffuse.value = this.rtB.texture;
    renderer.setRenderTarget(this.rtA);
    this._fs.render(renderer);

    this.blurMat.uniforms.tDiffuse.value = this.rtA.texture;
    renderer.setRenderTarget(this.rtB);
    this._fs.render(renderer);
    // Final blur lives in rtB.

    // 3) Composite scene (readBuffer) + rtB → writeBuffer at full res.
    this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.compMat.uniforms.tBloom.value = this.rtB.texture;
    this._fs.material = this.compMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this._fs.render(renderer);

    renderer.autoClear = prevAutoClear;
  }
}

// Combined vignette + film-grain + subtle chromatic edge tint + ASC-CDL
// style color grade. Cheap one-pass finisher that runs after the bloom
// composite.
//
// Color grade tunables — push for the Continental-noir aesthetic the
// splash art is selling. Crushed blacks + warm highlights + slight
// desaturation. All of it is per-pixel arithmetic; the cost is one
// extra block of math in a shader that's already running.
const FinisherShader = {
  uniforms: {
    tDiffuse:  { value: null },
    uTime:     { value: 0.0 },
    uStrength: { value: 0.22 },    // vignette darkness at corners
    uGrain:    { value: 0.0 },     // grain disabled — read as static noise in play
    uChroma:   { value: 0.0015 },  // chromatic edge split (in UV units)
    uContrast:    { value: 1.12 }, // 1.0 = no change. >1 crushes blacks + lifts highlights
    uSaturation:  { value: 0.92 }, // 1.0 = no change. <1 desaturates toward gray
    uShadowTint:  { value: new THREE.Color(0xa8b4c4) },  // cool steel into the shadows
    uHighlightTint: { value: new THREE.Color(0xffe2b8) },// warm tungsten into the highlights
    uGradeStrength: { value: 0.55 }, // overall grade mix — 0 = bypass, 1 = full
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
    uniform float uContrast;
    uniform float uSaturation;
    uniform vec3  uShadowTint;
    uniform vec3  uHighlightTint;
    uniform float uGradeStrength;

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

      // ----- Color grade (ASC-CDL-ish) ---------------------------------
      // 1) Tonal split: tint shadows toward a cool steel, highlights
      //    toward warm tungsten. luma drives the blend so midtones
      //    don't get pushed.
      // 2) Contrast around 0.5 mid-gray — crushes blacks, lifts whites.
      // 3) Saturation toward luma — desaturates a touch for the noir
      //    feel without going monochrome.
      vec3 graded = col;
      float luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
      vec3 tint = mix(uShadowTint, uHighlightTint, smoothstep(0.0, 1.0, luma));
      graded *= tint;
      graded = (graded - 0.5) * uContrast + 0.5;
      float gLuma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
      graded = mix(vec3(gLuma), graded, uSaturation);
      graded = max(graded, vec3(0.0));
      col = mix(col, graded, uGradeStrength);

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

  // Bloom — Kawase / dual-filter, half-res, ~30-50% cheaper than the
  // original UnrealBloomPass. Same threshold + strength controls.
  const bloom = new KawaseBloomPass(size.x, size.y, 0.75, 0.85);
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
