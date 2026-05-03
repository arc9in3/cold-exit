// Multi-pose rig survey. Drives the rig_tuner through the 'pose
// presets' GUI to capture idle, walk, run, crouch idle, crouch walk,
// + ADS variants. Outputs PNGs that can be reviewed at a glance.
//
// Pose preset names match rig_tuner.html POSE_PRESETS:
//   idle, walk, run, aim, rifle, crouch, crouch-aim, melee, dash
//
// Usage: node .mc/rig-pose-survey.mjs
import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
import fs from 'node:fs';
const { chromium } = pw;

const OUT = 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots/rig';
fs.mkdirSync(OUT, { recursive: true });

const POSES = ['idle', 'walk', 'run', 'aim', 'rifle', 'crouch', 'crouch-aim', 'melee', 'dash'];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
page.on('pageerror', e => console.error('[pageerror]', e.message));

await page.goto('http://localhost:8080/tools/rig_tuner.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Hide GUI + frame camera once.
await page.evaluate(() => {
  document.querySelector('.lil-gui.root').style.display = 'none';
  if (window.__camera) {
    window.__camera.position.set(2.0, 1.4, 4.0);
    window.__controls.target.set(0, 1.10, 0);
    window.__controls.update();
  }
});

for (const pose of POSES) {
  // Drive the pose by calling the global helper if one exists, else
  // mutate state directly.
  await page.evaluate((p) => {
    const PRESETS = {
      idle:        { speed: 0,   aimYaw: 0, aimPitch: 0, aiming: 0, crouched: 0, rifleHold: false, meleeStance: false, dashing: false },
      walk:        { speed: 1.8, aimYaw: 0, aimPitch: 0, aiming: 0, crouched: 0, rifleHold: false, meleeStance: false, dashing: false },
      run:         { speed: 4.5, aimYaw: 0, aimPitch: 0, aiming: 0, crouched: 0, rifleHold: false, meleeStance: false, dashing: false },
      aim:         { speed: 0,   aimYaw: 0, aimPitch: 0, aiming: 1, crouched: 0, rifleHold: false, meleeStance: false, dashing: false },
      rifle:       { speed: 0,   aimYaw: 0, aimPitch: 0, aiming: 1, crouched: 0, rifleHold: true,  meleeStance: false, dashing: false },
      crouch:      { speed: 0,   aimYaw: 0, aimPitch: 0, aiming: 0, crouched: 1, rifleHold: false, meleeStance: false, dashing: false },
      'crouch-aim':{ speed: 0,   aimYaw: 0, aimPitch: 0, aiming: 1, crouched: 1, rifleHold: true,  meleeStance: false, dashing: false },
      melee:       { speed: 0,   aimYaw: 0, aimPitch: 0, aiming: 0, crouched: 0, rifleHold: false, meleeStance: true,  dashing: false },
      dash:        { speed: 6.0, aimYaw: 0, aimPitch: 0, aiming: 0, crouched: 0, rifleHold: false, meleeStance: false, dashing: true  },
    };
    const preset = PRESETS[p];
    if (preset && window.__state) {
      Object.assign(window.__state.pose, preset);
      window.__state.pose.preset = p;
      window.__state.pose.freeze = false;
    }
  }, pose);
  // Also test the crouched-running combo by overriding speed for crouch poses.
  if (pose === 'crouch') {
    // Take both static and moving captures for crouch.
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/_pose-crouch-idle.png` });
    await page.evaluate(() => { window.__state.pose.speed = 4.5; });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/_pose-crouch-run.png` });
    continue;
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/_pose-${pose}.png` });
}

await browser.close();
console.log('captured', POSES.length + 1, 'poses to', OUT);
