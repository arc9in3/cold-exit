import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
import fs from 'node:fs';
const { chromium } = pw;

const OUT = 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots/rig';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

await page.goto('http://localhost:8080/tools/rig_tuner.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Hide GUI for a clean capture.
await page.evaluate(() => {
  const root = document.querySelector('.lil-gui.root');
  if (root) root.style.display = 'none';
});

// Force T-pose:
//   - freeze the procedural anim so our rotations stick
//   - zero hips / chest / neck / head rotations
//   - arms out to the sides (shoulder rotation.z = ±π/2), elbows + wrists straight
//   - legs straight (thigh / knee / ankle zero)
//   - reframe camera to a clean front-on perspective
await page.evaluate(() => {
  const r = window.__rig;
  const s = window.__state;
  const cam = window.__camera;
  const ctrl = window.__controls;
  if (!r || !s) throw new Error('rig not exposed on window');

  s.pose.freeze = true;

  const zero = (g) => { if (g) g.rotation.set(0, 0, 0); };

  zero(r.hips);
  zero(r.stomach);
  zero(r.chest);
  zero(r.neck);
  zero(r.head);

  // Arms straight out
  if (r.leftArm) {
    r.leftArm.shoulder.pivot.rotation.set(0, 0, +Math.PI / 2);
    zero(r.leftArm.elbow);
    zero(r.leftArm.forearm.pivot);
    zero(r.leftArm.wrist);
    if (r.leftArm.hand && r.leftArm.hand.pivot) zero(r.leftArm.hand.pivot);
  }
  if (r.rightArm) {
    r.rightArm.shoulder.pivot.rotation.set(0, 0, -Math.PI / 2);
    zero(r.rightArm.elbow);
    zero(r.rightArm.forearm.pivot);
    zero(r.rightArm.wrist);
    if (r.rightArm.hand && r.rightArm.hand.pivot) zero(r.rightArm.hand.pivot);
  }

  // Legs straight
  for (const leg of [r.leftLeg, r.rightLeg]) {
    if (!leg) continue;
    zero(leg.thigh.pivot);
    zero(leg.knee);
    zero(leg.calf.pivot);
    zero(leg.ankle);
    if (leg.foot && leg.foot.pivot) zero(leg.foot.pivot);
  }

  // Reframe camera: pulled back to fit the full T-pose (arms extend
  // ~0.8m each side; rig stands ~2.5m tall) + slight 3/4 angle so
  // the wedge limbs read in 3D rather than flattening.
  cam.position.set(3.0, 1.6, 5.0);
  ctrl.target.set(0, 1.30, 0);
  ctrl.update();
});

await page.waitForTimeout(400);
const out = `${OUT}/_tpose-female.png`;
// Full viewport — no clip, lets the whole rig fit.
await page.screenshot({ path: out });
await browser.close();
console.log('saved:', out);
