// Boot the actual game, swap the player rig to the FBX, capture in-game.
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
  if (t === 'error' || t === 'warning' || t === 'log') console.log(`[${t}]`, m.text().slice(0, 240));
});

await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

// Click through the menus to actually drop into a level.
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button, .btn, [role="button"]'));
  const start = buttons.find(b => /start.*run|start new|begin/i.test(b.textContent || ''));
  if (start) start.click();
});
await page.waitForTimeout(2000);
// Pick the first contract card.
await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.contract-card, [data-contract-id], .pick-contract-card'));
  if (cards[0]) cards[0].click();
});
await page.waitForTimeout(1500);
// Confirm/embark
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button, .btn'));
  const go = buttons.find(b => /embark|confirm|deploy|begin contract|start run/i.test(b.textContent || ''));
  if (go) go.click();
});
await page.waitForTimeout(5000);

// Try to load the MotusMan + pistol pack via the new __useFbx hook.
const url = process.env.FBX_URL
  || 'Assets/models/animations/FBX_Pistol_Starter_27A/Animation/In-Place/W1_Stand_Relaxed_Idle_IPC.fbx';
const result = await page.evaluate(async (u) => {
  if (typeof window.__useFbx !== 'function') {
    return { ok: false, reason: 'no __useFbx hook on window' };
  }
  try {
    const out = await window.__useFbx(u);
    return { ok: true, msg: out };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}, url);
console.log('swap result:', JSON.stringify(result));

await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/_fbx-in-game.png` });
await browser.close();
console.log('saved:', `${OUT}/_fbx-in-game.png`);
