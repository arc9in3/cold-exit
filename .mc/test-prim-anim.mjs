import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
const { chromium } = pw;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
const errs = [];
page.on('pageerror', e => errs.push('[err] ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });

await page.goto('http://localhost:8080/tools/rig_tuner.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Click "load female" in the primitive rigs folder
await page.evaluate(() => {
  const ctrl = Array.from(document.querySelectorAll('.lil-gui .controller'))
    .find(c => c.textContent.includes('load female'));
  ctrl?.querySelector('button')?.click();
});
await page.waitForTimeout(1500);

// Switch to walk preset to see anim
await page.evaluate(() => {
  const sel = Array.from(document.querySelectorAll('select'))
    .find(s => Array.from(s.options).some(o => o.value === 'walk'));
  if (sel) {
    sel.value = 'walk';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await page.waitForTimeout(1500);

// Hide GUI for clean shot, frame camera
await page.evaluate(() => {
  const root = document.querySelector('.lil-gui.root');
  if (root) root.style.display = 'none';
});
await page.waitForTimeout(300);

await page.screenshot({ path: 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots/rig/_prim-female-walk.png' });

console.log('errors:', errs.join('\n') || '(none)');
const meshCount = await page.evaluate(() => {
  let n = 0;
  window.__rig?.group?.traverse(o => { if (o.isMesh) n++; });
  return n;
});
console.log('mesh count in rig group:', meshCount);

await browser.close();
