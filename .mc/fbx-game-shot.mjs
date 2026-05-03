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
await page.waitForTimeout(2500);

// Try to swap the player rig once the game has booted.
const result = await page.evaluate(async () => {
  if (!window.__player || !window.__scene) {
    return { ok: false, reason: 'no __player/__scene exposed' };
  }
  try {
    const mod = await import('/src/player.js');
    if (!mod.swapPlayerToFbxRig) return { ok: false, reason: 'no swap helper exported' };
    await mod.swapPlayerToFbxRig(window.__player, window.__scene, '/Assets/models/Idle.fbx');
    return { ok: true, clips: window.__player.rig.clipNames?.() };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
});
console.log('swap result:', JSON.stringify(result));

await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/_fbx-in-game.png` });
await browser.close();
console.log('saved:', `${OUT}/_fbx-in-game.png`);
