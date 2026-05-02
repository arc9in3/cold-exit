import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
const { chromium } = pw;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', e => errs.push('[pageerror] ' + e.message + '\n' + (e.stack || '')));
page.on('console', m => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
await page.goto('http://localhost:8080/tools/rig_tuner.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
console.log('--- ERRORS ---');
console.log(errs.join('\n'));
await browser.close();
