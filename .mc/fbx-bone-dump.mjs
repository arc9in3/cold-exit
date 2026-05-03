// Quick FBX bone enumerator. Loads an FBX in headless Chromium via
// the rig_tuner's FBXLoader, walks the scene, prints every Bone /
// SkinnedMesh found. Run as:
//   node .mc/fbx-bone-dump.mjs <relative-url>
// e.g.:
//   node .mc/fbx-bone-dump.mjs ../Assets/models/animations/FBX_Pistol_Starter_27A/Animation/In-Place/W1_Stand_Relaxed_Idle_IPC.fbx
import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
const { chromium } = pw;

const arg = process.argv[2] || '../Assets/models/animations/FBX_Pistol_Starter_27A/MotusMan/MotusMan_v55.fbx';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.error('[pageerror]', e.message));

// Minimal page that just hosts FBXLoader.
await page.setContent(`
  <!doctype html>
  <html><body>
  <script type="importmap">
  { "imports": {
    "three": "https://unpkg.com/three@0.161.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.161.0/examples/jsm/"
  } }
  </script>
  <script type="module">
    import * as THREE from 'three';
    import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
    window.THREE = THREE;
    window.FBXLoader = FBXLoader;
  </script>
  </body></html>
`, { waitUntil: 'networkidle' });
await page.goto('http://localhost:8080/tools/rig_tuner.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const out = await page.evaluate(async (url) => {
  const FBXLoader = (await import('https://unpkg.com/three@0.161.0/examples/jsm/loaders/FBXLoader.js')).FBXLoader;
  const THREE = await import('https://unpkg.com/three@0.161.0/build/three.module.js');
  const loader = new FBXLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, (group) => {
      const bones = [];
      const meshes = [];
      group.traverse(o => {
        if (o.isBone) bones.push(o.name);
        if (o.isSkinnedMesh) meshes.push({ name: o.name, vertCount: o.geometry?.attributes?.position?.count });
        if (o.isMesh && !o.isSkinnedMesh) meshes.push({ name: o.name, mesh: true });
      });
      resolve({
        url,
        boneCount: bones.length,
        bones,
        meshes,
        clipNames: (group.animations || []).map(c => `${c.name} (${c.duration.toFixed(2)}s)`),
      });
    }, undefined, e => resolve({ url, error: String(e?.message || e) }));
  });
}, arg);

console.log(JSON.stringify(out, null, 2));
await browser.close();
