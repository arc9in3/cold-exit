// Verify the procgen rig path still works after the GASP integration.
// Sets localStorage to skip FBX auto-load and probes for errors +
// rig structure.
import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
const { chromium } = pw;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
const errs = [];
page.on('pageerror', e => errs.push({ t: 'pageerror', txt: e.message }));
page.on('console', m => {
  if (m.type() === 'error') errs.push({ t: 'console', txt: m.text() });
});

await page.goto('http://localhost:8080/', { waitUntil: 'load' });
// Force procgen on the next reload.
await page.evaluate(() => { localStorage.setItem('coldExitDefaultRig', 'procgen'); });
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2500);

const probe = await page.evaluate(() => {
  const r = window.__player?.rig;
  if (!r) return { err: 'no rig' };
  return {
    kind: r.kind || 'unknown',
    hasGroup: !!r.group,
    hasFbx: !!r._fbx,
    hasMaterials: !!r.materials,
    hasMeshes: Array.isArray(r.meshes),
    meshCount: r.meshes?.length || 0,
    hasChestMesh: !!r.chestMesh,
    hipsAtY: r.hips?.position?.y ?? null,
  };
});
console.log('procgen probe:', JSON.stringify(probe));
console.log('errors:', errs.length);
for (const e of errs.slice(0, 8)) console.log(' ', e.t, e.txt.slice(0, 200));

// Reset for next run.
await page.evaluate(() => { localStorage.removeItem('coldExitDefaultRig'); });
await browser.close();
