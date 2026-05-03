// Smoke test for the new pose authoring loop:
// 1. Boot rig_tuner with the new (JSON) rig
// 2. Drive the GUI's 'load pose from Assets/poses/' control with name='rifle-hip'
// 3. Capture the result so we can see if rifle-hip.json applies cleanly
import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
import fs from 'node:fs';
const { chromium } = pw;

const OUT = 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots/rig';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });

await page.goto('http://localhost:8080/tools/rig_tuner.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Drive the lil-gui controls: find the 'load name' input + click the
// 'load pose from Assets/poses/' button.
await page.evaluate(async () => {
  // Find the load-name input + set value to 'rifle-hip'
  const inputs = Array.from(document.querySelectorAll('.lil-gui input[type="text"]'));
  const loadNameInput = inputs.find(i => {
    const ctrl = i.closest('.controller');
    return ctrl && ctrl.querySelector('.name')?.textContent.trim() === 'load name';
  });
  if (loadNameInput) {
    loadNameInput.value = 'rifle-hip';
    loadNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    loadNameInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Find + click 'load pose from Assets/poses/'
  const buttons = Array.from(document.querySelectorAll('.lil-gui button'));
  const loadBtn = buttons.find(b => b.textContent.trim() === 'load pose from Assets/poses/');
  if (loadBtn) loadBtn.click();
});

// Give IK solver a frame to settle.
await page.waitForTimeout(500);

// Hide GUI for clean capture + 3/4 framing.
await page.evaluate(() => {
  document.querySelector('.lil-gui.root').style.display = 'none';
  if (window.__camera) {
    window.__camera.position.set(2.2, 1.4, 4.0);
    window.__controls.target.set(0, 1.10, 0);
    window.__controls.update();
  }
});
await page.waitForTimeout(200);

await page.screenshot({ path: `${OUT}/_pose-rifle-hip.png` });
await browser.close();
console.log('saved:', `${OUT}/_pose-rifle-hip.png`);
