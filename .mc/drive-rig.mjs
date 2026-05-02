import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
import fs from 'node:fs';
const { chromium } = pw;

const OUT = 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots/rig';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

await page.goto('http://localhost:8080/tools/rig_tuner.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// lil-gui exposes selects + inputs in #lil-gui or generic .lil-gui shadow.
// Find the preset <select> — there's only one select in the panel that maps to PRESETS.
const PRESETS = ['idle', 'walk', 'run', 'aim', 'rifle', 'crouch', 'crouch-aim', 'melee', 'dash'];

async function setPreset(name) {
  // lil-gui renders selects with the option values matching keys.
  await page.evaluate((preset) => {
    const sel = Array.from(document.querySelectorAll('select')).find(s =>
      Array.from(s.options).some(o => o.value === 'idle' || o.value === preset));
    if (!sel) return false;
    sel.value = preset;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, name);
}

// Hide the GUI panel for clean shots, then snap each preset.
await page.evaluate(() => {
  const root = document.querySelector('.lil-gui.root');
  if (root) root.style.display = 'none';
});

// Drive a couple of camera angles too: orbit the camera by dragging mouse.
async function snapAngles(stem) {
  // Default angle
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${stem}-front.png`, clip: { x: 200, y: 60, width: 760, height: 700 } });
  // Drag-orbit to ~side view
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(940, 400, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${stem}-side.png`, clip: { x: 200, y: 60, width: 760, height: 700 } });
  // Drag back to ~original
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(340, 400, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

for (const p of PRESETS) {
  await setPreset(p);
  await page.waitForTimeout(800);
  await snapAngles(p);
  console.log('captured', p);
}

// For animations (walk / run / dash), capture multiple frames at the front angle
async function captureCycle(preset, frames = 8, intervalMs = 130) {
  await setPreset(preset);
  await page.waitForTimeout(400);
  for (let i = 0; i < frames; i++) {
    await page.waitForTimeout(intervalMs);
    await page.screenshot({ path: `${OUT}/${preset}-cycle-${String(i).padStart(2,'0')}.png`, clip: { x: 200, y: 60, width: 760, height: 700 } });
  }
}

await captureCycle('walk', 6, 120);
await captureCycle('run', 6, 110);
await captureCycle('dash', 4, 130);

// Final wide shot in idle for size reference (keep GUI visible for context)
await page.evaluate(() => {
  const root = document.querySelector('.lil-gui.root');
  if (root) root.style.display = '';
});
await setPreset('idle');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/_overview.png` });

// --- archetype comparison: hide GUI, snap each preset under each look
async function clickPreset(label) {
  await page.evaluate((target) => {
    const buttons = Array.from(document.querySelectorAll('button, .name'));
    const btn = buttons.find(b => b.textContent && b.textContent.trim() === target);
    if (btn) btn.click();
  }, label);
  await page.waitForTimeout(400);
}
await page.evaluate(() => {
  const root = document.querySelector('.lil-gui.root');
  if (root) root.style.display = 'none';
});
// Reframe camera: directly mutate via JS to bypass orbit-control quirks.
// Find the THREE camera by walking the canvas and looking up. This is
// brittle but the rig_tuner only has one camera. We hit the controls
// indirectly by simulating a smaller mouse move.
await page.mouse.move(640, 400);
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, 220);  // zoom out
  await page.waitForTimeout(80);
}
// Tilt camera UP toward the head. With OrbitControls, dragging mouse
// UP orbits the camera toward the rig's height. Small drag.
await page.mouse.move(640, 460);
await page.mouse.down();
await page.mouse.move(640, 380, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
await clickPreset('preset → male / operator');
await setPreset('idle');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/_raiden-idle.png`, clip: { x: 200, y: 60, width: 760, height: 700 } });
await setPreset('rifle');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/_raiden-rifle.png`, clip: { x: 200, y: 60, width: 760, height: 700 } });
await setPreset('melee');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/_raiden-melee.png`, clip: { x: 200, y: 60, width: 760, height: 700 } });

await clickPreset('preset → female / Eve');
await setPreset('idle');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/_eve-idle.png`, clip: { x: 200, y: 60, width: 760, height: 700 } });
await setPreset('rifle');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/_eve-rifle.png`, clip: { x: 200, y: 60, width: 760, height: 700 } });
await setPreset('melee');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/_eve-melee.png`, clip: { x: 200, y: 60, width: 760, height: 700 } });

await browser.close();
console.log('done');
