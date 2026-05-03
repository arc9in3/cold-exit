// Generate a primitive rig matching Assets/anatomy/bodyshapes.png and
// load it into the rig_builder via localStorage. Verifies by
// screenshotting the result.
import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
import fs from 'node:fs';
const { chromium } = pw;

// Build the rig as a flat primitive array. Hierarchy:
//   pelvis (root)
//     ribs
//       chest
//         neck
//           head
//         shoulder L/R
//           upperArm L/R
//             elbow L/R
//               forearm L/R
//                 wrist L/R
//                   hand L/R
//     hip L/R
//       thigh L/R
//         knee L/R
//           calf L/R
//             ankle L/R
//               foot L/R

const BODY  = '#3a4048';
const SKIN  = '#c39066';
const JOINT = '#2a2f3a';   // slightly darker so joints read as separate

const primitives = [];
const add = (p) => { primitives.push(p); return p; };
const mirror = (p, newId, newName, parentId) => {
  const m = JSON.parse(JSON.stringify(p));
  m.id = newId;
  m.name = newName;
  m.parentId = parentId;
  m.pos.x = -m.pos.x;
  return m;
};

// PELVIS — wedge tapering down (wider iliac at top, narrower at pubic)
add({
  id: 'pelvis', name: 'pelvis', type: 'cylinder', parentId: null,
  pos: { x: 0, y: 0.95, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  color: BODY, opacity: 1.0,
  shape: { topR: 0.18, botR: 0.11, h: 0.18, segs: 24, topDepth: 0.85, botDepth: 0.85 },
});

// RIBS — lower chest, narrower than upper chest
add({
  id: 'ribs', name: 'ribs', type: 'cylinder', parentId: 'pelvis',
  pos: { x: 0, y: 0.16, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  color: BODY, opacity: 1.0,
  shape: { topR: 0.16, botR: 0.13, h: 0.13, segs: 24, topDepth: 0.80, botDepth: 0.80 },
});

// CHEST — upper torso, widest at the shoulder line
add({
  id: 'chest', name: 'chest', type: 'cylinder', parentId: 'ribs',
  pos: { x: 0, y: 0.14, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  color: BODY, opacity: 1.0,
  shape: { topR: 0.20, botR: 0.16, h: 0.16, segs: 24, topDepth: 0.80, botDepth: 0.80 },
});

// NECK
add({
  id: 'neck', name: 'neck', type: 'cylinder', parentId: 'chest',
  pos: { x: 0, y: 0.11, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  color: BODY, opacity: 1.0,
  shape: { topR: 0.055, botR: 0.065, h: 0.06, segs: 16, topDepth: 1.0, botDepth: 1.0 },
});

// HEAD — slightly egg-shaped
add({
  id: 'head', name: 'head', type: 'sphere', parentId: 'neck',
  pos: { x: 0, y: 0.13, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1.10, z: 1 },
  color: SKIN, opacity: 1.0,
  shape: { r: 0.12, segsW: 24, segsH: 16 },
});

// LEFT SIDE arms — shoulder → upperarm → elbow → forearm → wrist → hand
const lshoulder = add({
  id: 'lshoulder', name: 'leftShoulder', type: 'sphere', parentId: 'chest',
  pos: { x: -0.21, y: 0.07, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  color: JOINT, opacity: 1.0,
  shape: { r: 0.075, segsW: 16, segsH: 12 },
});
const lupperarm = add({
  id: 'lupperarm', name: 'leftUpperArm', type: 'cylinder', parentId: 'lshoulder',
  pos: { x: 0, y: -0.14, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  color: BODY, opacity: 1.0,
  shape: { topR: 0.062, botR: 0.048, h: 0.26, segs: 16, topDepth: 1.0, botDepth: 1.0 },
});
const lelbow = add({
  id: 'lelbow', name: 'leftElbow', type: 'sphere', parentId: 'lupperarm',
  pos: { x: 0, y: -0.14, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  color: JOINT, opacity: 1.0,
  shape: { r: 0.042, segsW: 16, segsH: 12 },
});
const lforearm = add({
  id: 'lforearm', name: 'leftForearm', type: 'cylinder', parentId: 'lelbow',
  pos: { x: 0, y: -0.12, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  color: BODY, opacity: 1.0,
  shape: { topR: 0.048, botR: 0.034, h: 0.23, segs: 16, topDepth: 1.0, botDepth: 1.0 },
});
const lwrist = add({
  id: 'lwrist', name: 'leftWrist', type: 'sphere', parentId: 'lforearm',
  pos: { x: 0, y: -0.13, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  color: JOINT, opacity: 1.0,
  shape: { r: 0.026, segsW: 12, segsH: 8 },
});
const lhand = add({
  id: 'lhand', name: 'leftHand', type: 'cylinder', parentId: 'lwrist',
  pos: { x: 0, y: -0.05, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 0.55 },
  color: SKIN, opacity: 1.0,
  shape: { topR: 0.04, botR: 0.028, h: 0.09, segs: 12, topDepth: 1.0, botDepth: 1.0 },
});

// RIGHT SIDE arms (mirror of left)
add(mirror(lshoulder, 'rshoulder', 'rightShoulder', 'chest'));
add(mirror(lupperarm, 'rupperarm', 'rightUpperArm', 'rshoulder'));
add(mirror(lelbow,    'relbow',    'rightElbow',    'rupperarm'));
add(mirror(lforearm,  'rforearm',  'rightForearm',  'relbow'));
add(mirror(lwrist,    'rwrist',    'rightWrist',    'rforearm'));
add(mirror(lhand,     'rhand',     'rightHand',     'rwrist'));

// LEFT SIDE legs — hip → thigh → knee → calf → ankle → foot
const lhip = add({
  id: 'lhip', name: 'leftHipJoint', type: 'sphere', parentId: 'pelvis',
  pos: { x: -0.09, y: -0.08, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  color: JOINT, opacity: 1.0,
  shape: { r: 0.075, segsW: 16, segsH: 12 },
});
const lthigh = add({
  id: 'lthigh', name: 'leftThigh', type: 'cylinder', parentId: 'lhip',
  pos: { x: 0, y: -0.19, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  color: BODY, opacity: 1.0,
  shape: { topR: 0.085, botR: 0.05, h: 0.34, segs: 16, topDepth: 1.0, botDepth: 1.0 },
});
const lknee = add({
  id: 'lknee', name: 'leftKnee', type: 'sphere', parentId: 'lthigh',
  pos: { x: 0, y: -0.18, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  color: JOINT, opacity: 1.0,
  shape: { r: 0.045, segsW: 16, segsH: 12 },
});
const lcalf = add({
  id: 'lcalf', name: 'leftCalf', type: 'cylinder', parentId: 'lknee',
  pos: { x: 0, y: -0.17, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  color: BODY, opacity: 1.0,
  shape: { topR: 0.05, botR: 0.028, h: 0.31, segs: 16, topDepth: 1.0, botDepth: 1.0 },
});
const lankle = add({
  id: 'lankle', name: 'leftAnkle', type: 'sphere', parentId: 'lcalf',
  pos: { x: 0, y: -0.16, z: 0 }, rot: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  color: JOINT, opacity: 1.0,
  shape: { r: 0.028, segsW: 12, segsH: 8 },
});
const lfoot = add({
  id: 'lfoot', name: 'leftFoot', type: 'cylinder', parentId: 'lankle',
  pos: { x: 0, y: -0.025, z: 0.045 }, rot: { x: Math.PI / 2, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 0.55 },
  color: BODY, opacity: 1.0,
  shape: { topR: 0.04, botR: 0.028, h: 0.13, segs: 12, topDepth: 1.0, botDepth: 1.0 },
});

// RIGHT SIDE legs (mirror)
add(mirror(lhip,    'rhip',    'rightHipJoint', 'pelvis'));
add(mirror(lthigh,  'rthigh',  'rightThigh',    'rhip'));
add(mirror(lknee,   'rknee',   'rightKnee',     'rthigh'));
add(mirror(lcalf,   'rcalf',   'rightCalf',     'rknee'));
add(mirror(lankle,  'rankle',  'rightAnkle',    'rcalf'));
add(mirror(lfoot,   'rfoot',   'rightFoot',     'rankle'));

// Save to disk for reference + future preset loading.
const OUT_JSON = 'C:/work/personal/cold-exit/Assets/anatomy/bodyshapes-rig.json';
fs.writeFileSync(OUT_JSON, JSON.stringify(primitives, null, 2));
console.log(`saved ${primitives.length} primitives to ${OUT_JSON}`);

// Load into rig_builder via localStorage and screenshot to verify.
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1280 } });
page.on('pageerror', e => console.error('[err]', e.message));

await page.goto('http://localhost:8080/tools/rig_builder.html', { waitUntil: 'networkidle' });
await page.evaluate((p) => {
  localStorage.setItem('cold-exit-rig-builder-v1', JSON.stringify(p));
}, primitives);

// Reload so the page picks up the seeded localStorage
await page.goto('http://localhost:8080/tools/rig_builder.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// Trigger the load via the GUI button
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('.lil-gui .controller'))
    .find(c => c.textContent.includes('load (localStorage)'));
  btn?.querySelector('button')?.click();
});
await page.waitForTimeout(1500);

// Hide GUI for clean shot
await page.evaluate(() => {
  const root = document.querySelector('.lil-gui.root');
  if (root) root.style.display = 'none';
});

// Reframe camera so the full rig fits
await page.evaluate(() => {
  if (window.__rb && window.__camera) {
    window.__camera.position.set(2.6, 1.4, 4.0);
    window.__controls.target.set(0, 1.05, 0);
    window.__controls.update();
  }
});
await page.waitForTimeout(500);

const OUT_PNG = 'C:/Users/Landon/AppData/Local/Temp/coldexit-shots/rig/_bodyshapes-builder.png';
await page.screenshot({ path: OUT_PNG });
await browser.close();
console.log(`screenshot: ${OUT_PNG}`);
