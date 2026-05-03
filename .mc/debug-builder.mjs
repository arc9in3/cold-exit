import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
const { chromium } = pw;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1024 } });
const errs = [];
page.on('pageerror', e => errs.push('[err] ' + e.message + '\n' + (e.stack || '')));
page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
await page.goto('http://localhost:8080/tools/rig_builder.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots/rig/_rig-builder.png' });
console.log('--- ERRORS ---');
console.log(errs.join('\n') || '(none)');
await browser.close();
