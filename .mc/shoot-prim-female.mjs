import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
const { chromium } = pw;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
const errs = [];
page.on('pageerror', e => errs.push('[err] ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });

await page.goto('http://localhost:8080/tools/rig_tuner.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Click the "load female" primitive rig button
await page.evaluate(() => {
  const ctrl = Array.from(document.querySelectorAll('.lil-gui .controller'))
    .find(c => c.textContent.includes('load female'));
  ctrl?.querySelector('button')?.click();
});
await page.waitForTimeout(1500);

// Make sure idle preset is active
await page.evaluate(() => {
  const sel = Array.from(document.querySelectorAll('select'))
    .find(s => Array.from(s.options).some(o => o.value === 'idle'));
  if (sel) {
    sel.value = 'idle';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await page.waitForTimeout(800);

// Hide GUI for clean shot
await page.evaluate(() => {
  const root = document.querySelector('.lil-gui.root');
  if (root) root.style.display = 'none';
  if (window.__camera) {
    window.__camera.position.set(2.4, 1.6, 4.5);
    window.__controls.target.set(0, 1.40, 0);
    window.__controls.update();
  }
});
await page.waitForTimeout(400);

await page.screenshot({ path: 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots/rig/_prim-female-idle.png' });
console.log('errors:', errs.join('\n') || '(none)');
await browser.close();
