import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
const { chromium } = pw;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(2200);
const tabs = ['quartermaster', 'vendors', 'blackmarket'];
const labels = ['armorer', 'vendors', 'blackmarket'];
for (let i = 0; i < tabs.length; i++) {
  try {
    const id = tabs[i];
    await page.evaluate((id) => {
      const ui = window.__hideoutUI;
      if (ui) { ui.tab = id; ui.render(); }
    }, id);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `C:/Users/Landon/AppData/Local/Temp/coldexit-yglitch/tab-${labels[i]}.png` });
    console.log(`saved tab ${labels[i]}`);
  } catch (e) { console.log(`failed ${labels[i]}:`, e.message.slice(0, 100)); }
}
console.log('errors:', errs.length);
for (const e of errs.slice(0, 4)) console.log(' ', e.slice(0, 150));
await browser.close();
