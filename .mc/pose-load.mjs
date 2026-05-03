// Smoke test for the new pose authoring loop:
// 1. Boot rig_tuner with the new (JSON) rig
// 2. Drive the GUI's 'load pose from Assets/poses/' control with name='rifle-hip'
// 3. Capture the result so we can see if rifle-hip.json applies cleanly
import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
import fs from 'node:fs';
const { chromium } = pw;

const OUT = 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots/rig';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });

await page.goto('http://localhost:8080/tools/rig_tuner.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// POSE_NAME env var picks which pose to load; defaults to rifle-hip.
const POSE_NAME = process.env.POSE_NAME || 'rifle-hip';

// Drive the lil-gui controls: find the 'load name' input + click the
// 'load pose from Assets/poses/' button.
await page.evaluate(async (poseName) => {
  // Find the load-name input + set value
  const inputs = Array.from(document.querySelectorAll('.lil-gui input[type="text"]'));
  const loadNameInput = inputs.find(i => {
    const ctrl = i.closest('.controller');
    return ctrl && ctrl.querySelector('.name')?.textContent.trim() === 'load name';
  });
  if (loadNameInput) {
    loadNameInput.value = poseName;
    loadNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    loadNameInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Find + click 'load pose from Assets/poses/'
  const buttons = Array.from(document.querySelectorAll('.lil-gui button'));
  const loadBtn = buttons.find(b => b.textContent.trim() === 'load pose from Assets/poses/');
  if (loadBtn) loadBtn.click();
}, POSE_NAME);

// Give IK solver a frame to settle.
await page.waitForTimeout(500);

// Diagnostic: dump where the hands ACTUALLY landed vs where the
// IK targets are. If they match, IK reached the target. If they
// don't, the pole hint or bone length computation is off.
const diagnostics = await page.evaluate(() => {
  const r = window.__rig;
  const v = new (r.hips.position.constructor)();
  const dump = (m, label) => {
    if (!m) return null;
    m.getWorldPosition(v);
    return { label, x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) };
  };
  return {
    bones: [
      dump(r.leftArm?.hand?.mesh,  'leftHand actual'),
      dump(r.rightArm?.hand?.mesh, 'rightHand actual'),
      dump(r.leftArm?.elbow,       'leftElbow actual'),
      dump(r.rightArm?.elbow,      'rightElbow actual'),
    ].filter(Boolean),
    dimsArms: r.dims?.arms,
  };
});
console.log('--- pose diagnostics ---');
for (const b of diagnostics.bones) console.log(`  ${b.label.padEnd(20)} (${b.x}, ${b.y}, ${b.z})`);
console.log('  dims.arms:', JSON.stringify(diagnostics.dimsArms));

// Hide GUI for clean capture + front 3/4 framing showing both arms.
await page.evaluate(() => {
  document.querySelector('.lil-gui.root').style.display = 'none';
  if (window.__camera) {
    window.__camera.position.set(0.5, 1.4, 4.5);
    window.__controls.target.set(0, 1.20, 0);
    window.__controls.update();
  }
});
await page.waitForTimeout(200);

const outPath = `${OUT}/_pose-${POSE_NAME}.png`;
await page.screenshot({ path: outPath });
await browser.close();
console.log('saved:', outPath);
