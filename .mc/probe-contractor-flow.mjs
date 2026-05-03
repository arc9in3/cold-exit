import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
const { chromium } = pw;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'load' });
await page.waitForTimeout(2200);
await page.screenshot({ path: 'C:/Users/Landon/AppData/Local/Temp/coldexit-yglitch/contractor-1-cards.png' });
console.log('view 1 saved');

// Click first contract card.
try {
  await page.locator('.wanted-card:not([disabled])').first().click({ timeout: 1500 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'C:/Users/Landon/AppData/Local/Temp/coldexit-yglitch/contractor-2-loadout.png' });
  console.log('view 2 saved (loadout)');
} catch (e) {
  console.log('card click failed:', e.message.slice(0, 100));
}
console.log('errors:', errs.length);
for (const e of errs.slice(0, 3)) console.log(' ', e.slice(0, 150));
await browser.close();
