// Validate every weapon GLB by loading it through GLTFLoader.
// Catches conversion failures (corrupt files, empty meshes, etc.)
// before they crash gameplay when the player picks up that weapon.
import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = pw;

function listGLBs(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isFile() && f.endsWith('.glb')) out.push(full);
  }
  return out;
}

const dirs = [
  'Assets/models/weapons',
  'Assets/models/lowpolyguns',
  'Assets/models/lowpolyguns_accessories',
  'Assets/models/melee',
];
const all = dirs.flatMap(d => {
  try { return listGLBs(d).map(p => p.replace(/\\/g, '/')); }
  catch (_) { return []; }
});
console.log(`validating ${all.length} weapon GLBs across ${dirs.length} dirs`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:8080/tools/anim_preview.html', { waitUntil: 'load' });
await page.waitForTimeout(800);

const results = await page.evaluate(async (urls) => {
  const out = [];
  // Use the page's existing GLTFLoader (anim_preview.html imports it).
  // anim_preview.html imports GLTFLoader via the importmap. Reach
  // into the page's existing instance instead of doing a fresh import.
  const m = await import('https://unpkg.com/three@0.161.0/examples/jsm/loaders/GLTFLoader.js');
  const loader = new m.GLTFLoader();
  for (const url of urls) {
    const probeUrl = '../' + url;  // anim_preview.html is in /tools/
    try {
      const gltf = await loader.loadAsync(probeUrl);
      let meshes = 0, verts = 0;
      gltf.scene.traverse(o => {
        if (o.isMesh || o.isSkinnedMesh) {
          meshes++;
          verts += o.geometry?.attributes?.position?.count || 0;
        }
      });
      out.push({ url, meshes, verts, ok: meshes > 0 && verts > 0 });
    } catch (e) {
      out.push({ url, error: e.message.slice(0, 120), ok: false });
    }
  }
  return out;
}, all);

const bad = results.filter(r => !r.ok);
console.log(`total: ${results.length}  passing: ${results.length - bad.length}  failing: ${bad.length}`);
for (const r of bad.slice(0, 20)) console.log(' BAD', r.url, r.error || `meshes=${r.meshes} verts=${r.verts}`);
if (errs.length) {
  console.log('pageerrors:', errs.length);
  for (const e of errs.slice(0, 5)) console.log(' ', e);
}
await browser.close();
