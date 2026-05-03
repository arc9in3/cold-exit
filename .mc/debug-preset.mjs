import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
const { chromium } = pw;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
const errs = [];
page.on('pageerror', e => errs.push('[err] ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });

await page.goto('http://localhost:8080/tools/rig_builder.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// Probe how lil-gui buttons render so we know what to click
const probe = await page.evaluate(() => {
  const ctrl = Array.from(document.querySelectorAll('.lil-gui .controller'))
    .find(c => c.textContent.includes('load preset → bodyshapes'));
  if (!ctrl) return { found: false };
  return {
    found: true,
    html: ctrl.outerHTML.slice(0, 400),
    childCount: ctrl.children.length,
  };
});
console.log('button probe:', JSON.stringify(probe, null, 2));

// Call loadPreset directly via the exposed window hook + await it.
const loadResult = await page.evaluate(async () => {
  if (typeof window.__loadPreset !== 'function') {
    return { ok: false, reason: 'window.__loadPreset not exposed' };
  }
  try {
    await window.__loadPreset('bodyshapes');
    return { ok: true, count: window.__rb?.primitives?.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});
console.log('loadPreset result:', JSON.stringify(loadResult, null, 2));
await page.waitForTimeout(500);

const sceneInfo = await page.evaluate(() => ({
  meshCount: window.__rb?.meshIndex?.size || 0,
  groupCount: window.__rb?.groupIndex?.size || 0,
}));
console.log('scene info:', JSON.stringify(sceneInfo));
console.log('errors:', errs.join('\n') || '(none)');

// Hide GUI + reframe + screenshot
await page.evaluate(() => {
  const root = document.querySelector('.lil-gui.root');
  if (root) root.style.display = 'none';
  if (window.__camera) {
    window.__camera.position.set(2.6, 1.4, 4.0);
    window.__controls.target.set(0, 1.05, 0);
    window.__controls.update();
  }
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots/rig/_preset-load.png' });
await browser.close();
