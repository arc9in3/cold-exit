// Probe — assert that _encodeWindows reports broken indices and that
// applyWindowsSnapshot is idempotent. Stub a fake level + windows
// lib; bypass the import path by injecting via globalThis.
//
// Run: node .mc/probe-coop-windows.mjs

import { encodeEnemySnapshot, applyWindowsSnapshot }
  from '../src/coop/snapshot.js';

// Build a fake level with three "windows" — entries 0 and 2 are
// pristine, entry 1 is broken to start.
const winA = { state: { broken: false, hp: 2 } };
const winB = { state: { broken: true, hp: 0 } };
const winC = { state: { broken: false, hp: 2 } };
const level = {
  _windows: [
    { window: winA },
    { window: winB },
    { window: winC },
  ],
};
const gunmen = { gunmen: [] };
const melees = { enemies: [] };

// Encode — only entry 1 is broken so bw should be [1].
const snap = encodeEnemySnapshot(gunmen, melees, 1, 0, null, null, null, level);
console.log('bw:', snap.bw);
if (JSON.stringify(snap.bw) !== '[1]') {
  console.error('FAIL: expected [1], got', snap.bw);
  process.exit(1);
}

// Manually shatter window 0 — re-encode should now report [0, 1].
winA.state.broken = true;
const snap2 = encodeEnemySnapshot(gunmen, melees, 2, 0, null, null, null, level);
console.log('bw after shatter:', snap2.bw);
if (JSON.stringify(snap2.bw) !== '[0,1]') {
  console.error('FAIL: expected [0,1], got', snap2.bw);
  process.exit(1);
}

// Apply path — install fake windows lib, reset windows so we can
// verify shatter is invoked.
let shatterCalls = 0;
globalThis.window = globalThis.window || {};
globalThis.window.__windowsLib = {
  shatter: (st) => { shatterCalls++; st.broken = true; },
};
const winD = { state: { broken: false } };
const winE = { state: { broken: true } };  // already broken — should skip
const winF = { state: { broken: false } };
const level2 = {
  _windows: [
    { window: winD },
    { window: winE },
    { window: winF },
  ],
};
applyWindowsSnapshot(level2, { bw: [0, 1, 2] });
console.log('shatterCalls:', shatterCalls);
if (shatterCalls !== 2) {
  console.error('FAIL: expected 2 shatter calls (skip already-broken), got', shatterCalls);
  process.exit(1);
}
if (!winD.state.broken || !winF.state.broken) {
  console.error('FAIL: expected D and F broken');
  process.exit(1);
}
// Idempotency — second apply with same input should add zero calls.
applyWindowsSnapshot(level2, { bw: [0, 1, 2] });
if (shatterCalls !== 2) {
  console.error('FAIL: not idempotent. Calls now', shatterCalls);
  process.exit(1);
}

console.log('PASS — _encodeWindows + applyWindowsSnapshot behave correctly');
