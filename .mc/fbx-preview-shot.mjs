// Open the rig tuner, click "load Idle.fbx" in the FBX preview folder,
// capture the result so we can verify Mixamo + animation playback.
import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
import fs from 'node:fs';
const { chromium } = pw;

const OUT = 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots/rig';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => {
  const t = m.type();
  if (t === 'error' || t === 'warning' || t === 'log') console.log(`[${t}]`, m.text());
});

await page.goto('http://localhost:8080/tools/rig_tuner.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Open FBX folder + click "load Idle.fbx"
await page.evaluate(() => {
  // Expand the FBX folder if it's closed.
  const folders = Array.from(document.querySelectorAll('.lil-gui .title'));
  const fbxTitle = folders.find(t => t.textContent.includes('FBX preview'));
  if (fbxTitle) fbxTitle.click();
  // Click the load button.
  const buttons = Array.from(document.querySelectorAll('.lil-gui button'));
  const loadBtn = buttons.find(b => b.textContent.trim() === 'load Idle.fbx');
  if (loadBtn) loadBtn.click();
});

// Wait for the 115MB FBX to load + animate a few frames.
console.log('[fbx-shot] loading FBX (115MB) — waiting up to 30s...');
await page.waitForTimeout(15000);

// Hide GUI for clean capture, frame on the FBX.
await page.evaluate(() => {
  document.querySelector('.lil-gui.root').style.display = 'none';
  if (window.__camera) {
    window.__camera.position.set(2.0, 1.6, 4.0);
    window.__controls.target.set(0, 1.0, 0);
    window.__controls.update();
  }
});
await page.waitForTimeout(400);

await page.screenshot({ path: `${OUT}/_fbx-idle.png` });
await browser.close();
console.log('saved:', `${OUT}/_fbx-idle.png`);
