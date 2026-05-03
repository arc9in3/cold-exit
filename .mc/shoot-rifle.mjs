import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
const { chromium } = pw;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
await page.goto('http://localhost:8080/tools/rig_tuner.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Switch to rifle preset (sets rifleHold + aiming)
await page.evaluate(() => {
  const sel = Array.from(document.querySelectorAll('select'))
    .find(s => Array.from(s.options).some(o => o.value === 'rifle'));
  if (sel) {
    sel.value = 'rifle';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await page.waitForTimeout(1500);

// Hide GUI + frame camera
await page.evaluate(() => {
  document.querySelector('.lil-gui.root').style.display = 'none';
  if (window.__camera) {
    window.__camera.position.set(2.0, 1.4, 3.8);
    window.__controls.target.set(0, 1.10, 0);
    window.__controls.update();
  }
});
await page.waitForTimeout(400);

await page.screenshot({ path: 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots/rig/_rifle-female.png' });
await browser.close();
