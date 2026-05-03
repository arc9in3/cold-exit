// Open the recruiter preview page, click "Open with forced special merc",
// capture the modal so we can review the card UI design.
import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
import fs from 'node:fs';
const { chromium } = pw;

const OUT = 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots/ui';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

await page.goto('http://localhost:8080/tools/recruiter_preview.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// Click "Open with forced special merc" so we always see a special card.
await page.click('#open-special');
await page.waitForTimeout(300);

await page.screenshot({ path: `${OUT}/recruiter-special.png` });

// Close + open the regular roster (random).
await page.evaluate(() => {
  document.querySelector('#recruiter-close').click();
});
await page.waitForTimeout(200);
await page.click('#open');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/recruiter-default.png` });

await browser.close();
console.log('saved:', `${OUT}/recruiter-special.png`);
console.log('saved:', `${OUT}/recruiter-default.png`);
