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
  if (t === 'log' || t === 'error' || t === 'warning') console.log(`[${t}]`, m.text().slice(0, 240));
});

await page.goto('http://localhost:8080/tools/rig_tuner.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

await page.evaluate(() => {
  const folders = Array.from(document.querySelectorAll('.lil-gui .title'));
  const t = folders.find(t => t.textContent.includes('MotusMan'));
  if (t) t.click();
  const btns = Array.from(document.querySelectorAll('.lil-gui button'));
  const load = btns.find(b => b.textContent.trim() === 'load MotusMan + all clips');
  if (load) load.click();
});

console.log('[motus-shot] loading + merging 16 clips — wait 25s...');
await page.waitForTimeout(25000);

await page.evaluate(() => {
  document.querySelector('.lil-gui.root').style.display = 'none';
  if (window.__camera) {
    window.__camera.position.set(2.0, 1.7, 4.5);
    window.__controls.target.set(0, 1.0, 0);
    window.__controls.update();
  }
});
await page.waitForTimeout(400);

await page.screenshot({ path: `${OUT}/_motus-pack.png` });
await browser.close();
console.log('saved:', `${OUT}/_motus-pack.png`);
