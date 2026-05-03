import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
import fs from 'node:fs';
const { chromium } = pw;

const OUT = 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const consoleLines = [];
page.on('console', m => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => consoleLines.push(`[pageerror] ${e.message}`));

await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/01-hideout.png` });

// Step 1: START NEW RUN
let btn = await page.$('#contractor-cta');
if (btn) { await btn.click(); await page.waitForTimeout(1500); }
await page.screenshot({ path: `${OUT}/02-contract-pick.png` });

// Step 2: pick the first contract card. The cards have class .wanted-card per the css inspected earlier.
const cards = await page.$$('.wanted-card');
if (cards.length > 0) {
  await cards[0].click();
  await page.waitForTimeout(800);
}
await page.screenshot({ path: `${OUT}/03-card-selected.png` });

// Now the screen may show CONFIRM CONTRACT or move to loadout. Try common confirm labels.
async function clickByText(texts) {
  for (const t of texts) {
    const loc = page.locator(`button:has-text("${t}"), [role="button"]:has-text("${t}"), .btn:has-text("${t}"), :text-is("${t}")`).first();
    if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) {
      try { await loc.click({ timeout: 1500 }); return t; } catch {}
    }
  }
  return null;
}

// On the loadout screen, click a starter weapon card to select it (first card in the unlocked grid)
const weaponCards = await page.$$('.starter-weapon-card, .loadout-weapon-card, .unlocked-weapon-card, .loadout-pool .weapon-card, .weapon-card');
if (weaponCards[0]) { await weaponCards[0].click(); await page.waitForTimeout(400); }
await page.screenshot({ path: `${OUT}/04-weapon-picked.png` });

// Now click the actual CONFIRM LOADOUT button (it has class .loadout-confirm)
let lc = await page.$('.loadout-confirm');
if (lc) { await lc.click({ force: true }); }
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/05-after-confirm2.png` });

// Game might still be loading. Wait long, then check for canvas / lack of hideout.
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/06-loaded.png` });

// Try once more for any straggling deploy button
const confirm3 = await clickByText(['DEPLOY', 'CONFIRM', 'GO', 'START RUN']);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/07-final-load.png` });

// Capture flow stamps
consoleLines.push(`[flow] confirm3="${confirm3}"`);

// Click in middle of viewport to focus the canvas
await page.mouse.move(800, 450);
await page.mouse.click(800, 450);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/08-focused.png` });

// Walk forward
await page.keyboard.down('w');
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${OUT}/walk-${String(i).padStart(2,'0')}.png` });
}
await page.keyboard.up('w');

// Stand idle
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/idle.png` });

// Aim and fire
await page.mouse.move(1000, 450);
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/aim-pre.png` });
await page.mouse.down();
await page.waitForTimeout(120);
await page.screenshot({ path: `${OUT}/fire-01.png` });
await page.waitForTimeout(120);
await page.screenshot({ path: `${OUT}/fire-02.png` });
await page.mouse.up();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/fire-after.png` });

fs.writeFileSync(`${OUT}/console.log`, consoleLines.join('\n'));
await browser.close();
console.log('done');
