// Joint debug capture:
// - color each joint sphere distinctly
// - pose left arm flat T, right arm raised, so the elbow ball position
//   along each arm chain is unambiguous
// - bright lighting so geometry reads clearly
// - label each side (leftArm = code name) so the main/off swap is visible
import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
import fs from 'node:fs';
const { chromium } = pw;
const OUT = 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots/rig';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));

await page.goto('http://localhost:8080/tools/rig_tuner.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

await page.evaluate(() => { document.querySelector('.lil-gui.root').style.display = 'none'; });

await page.evaluate(() => {
  const r = window.__rig, s = window.__state, cam = window.__camera, ctrl = window.__controls;
  const THREE = window.THREE;
  s.pose.freeze = true;
  const zero = (g) => { if (g) g.rotation.set(0, 0, 0); };
  zero(r.hips); zero(r.stomach); zero(r.chest); zero(r.neck); zero(r.head);

  // Both arms in flat T-pose — straightforward chain inspection.
  if (r.leftArm) {
    r.leftArm.shoulder.pivot.rotation.set(0, 0, +Math.PI / 2);
    zero(r.leftArm.elbow); zero(r.leftArm.forearm.pivot); zero(r.leftArm.wrist);
  }
  if (r.rightArm) {
    r.rightArm.shoulder.pivot.rotation.set(0, 0, -Math.PI / 2);
    zero(r.rightArm.elbow); zero(r.rightArm.forearm.pivot); zero(r.rightArm.wrist);
  }

  for (const leg of [r.leftLeg, r.rightLeg]) { if (!leg) continue;
    zero(leg.thigh.pivot); zero(leg.knee); zero(leg.calf.pivot); zero(leg.ankle);
    if (leg.foot && leg.foot.pivot) zero(leg.foot.pivot);
  }

  // Recolor each joint sphere distinctly. Walk each arm sub-tree and
  // patch by the handle that buildRig exposes.
  // Clone the shared material first (joint balls share armMat with the
  // arm cylinders — mutating in-place would recolor everything).
  const recolor = (mesh, hex) => {
    if (!mesh) return;
    mesh.material = mesh.material.clone();
    mesh.material.color.setHex(hex);
  };

  // NB: shoulderBulge was removed in commit 00f420b (set to radius 0).
  // So the only visible balls are elbow + wrist; we color them + hand.
  // Also color the upperArm and forearm cylinders distinctly per side
  // so the chain is unambiguous.
  for (const [label, arm] of [['LEFT(code)', r.leftArm], ['RIGHT(code)', r.rightArm]]) {
    if (!arm) continue;
    // Per-side cylinder tint so left vs right is visually distinct.
    const upperHex = label.startsWith('LEFT')  ? 0xaa3344 : 0x3344aa; // dark red / dark blue
    const foreHex  = label.startsWith('LEFT')  ? 0xdd6677 : 0x6677dd; // light red / light blue
    if (arm.shoulder?.mesh) recolor(arm.shoulder.mesh, upperHex);
    if (arm.forearm?.mesh)  recolor(arm.forearm.mesh,  foreHex);
    if (arm.shoulderBulge) recolor(arm.shoulderBulge, 0xff2244); // RED — shoulder ball
    if (arm.elbowBulge)    recolor(arm.elbowBulge,    0x33dd55); // GREEN — elbow ball
    if (arm.wrist?.children) {
      for (const c of arm.wrist.children) {
        if (c.isMesh && c.geometry?.type === 'SphereGeometry') {
          recolor(c, 0x44ccff); // CYAN — wrist
        }
      }
    }
    if (arm.hand?.mesh) recolor(arm.hand.mesh, 0xffcc22); // YELLOW — hand
  }

  // Wide front view to see both arms fully extended.
  cam.position.set(0, 1.4, 4.5);
  ctrl.target.set(0, 1.4, 0);
  ctrl.update();

  // Boost ambient lighting for the debug shot.
  const ambient = window.__scene?.children?.find(c => c.isAmbientLight);
  if (ambient) ambient.intensity = 0.9;
  const ren = window.__renderer;
  if (ren) ren.setClearColor(0x222233);
});

// Dump world positions so we can verify which side is which.
const positions = await page.evaluate(() => {
  const r = window.__rig;
  const v = new (window.__rig.hips.position.constructor)();
  const dump = (mesh, label) => {
    if (!mesh) return null;
    mesh.getWorldPosition(v);
    return { label, x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) };
  };
  return [
    dump(r.leftArm?.shoulder?.pivot,  'leftArm.shoulder.pivot'),
    dump(r.leftArm?.elbow,            'leftArm.elbow'),
    dump(r.leftArm?.wrist,            'leftArm.wrist'),
    dump(r.leftArm?.hand?.mesh,       'leftArm.hand'),
    dump(r.rightArm?.shoulder?.pivot, 'rightArm.shoulder.pivot'),
    dump(r.rightArm?.elbow,           'rightArm.elbow'),
    dump(r.rightArm?.wrist,           'rightArm.wrist'),
    dump(r.rightArm?.hand?.mesh,      'rightArm.hand'),
  ].filter(Boolean);
});
console.log('joint world positions:');
for (const p of positions) console.log(`  ${p.label.padEnd(28)} x=${p.x.toString().padStart(7)}  y=${p.y.toString().padStart(7)}  z=${p.z.toString().padStart(7)}`);

await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/_joints-debug.png` });
await browser.close();
console.log('saved:', `${OUT}/_joints-debug.png`);
