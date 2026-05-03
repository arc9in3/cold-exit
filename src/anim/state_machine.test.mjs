// Regression test: cold_exit_player.json + state_machine.js should
// pick the same clip as the legacy if/else cascade in player.js for
// every realistic input combination.
//
// Run: node src/anim/state_machine.test.mjs
//
// Phase 1 parity verification per the migration plan. Catches the
// "did I get the priority order right" class of bugs without needing
// a running game.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pickClip, deriveInputs } from './state_machine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SM_PATH = resolve(__dirname, '..', '..', 'Assets', 'anim_data', 'states', 'cold_exit_player.json');
const smCfg = JSON.parse(readFileSync(SM_PATH, 'utf-8'));

// Legacy cascade — exact copy of player.js:1717-1729 prior to this
// commit. Used only by this test as the source-of-truth oracle.
function legacyPick(state, planarSpeed) {
  const aim = (state.adsAmount || 0) > 0.4;
  const swinging = state.attack && state.attack.phase !== 'idle';
  const moving = planarSpeed > 0.05;
  const running = planarSpeed > 3.5;
  const crouched = !!state.crouched;
  if (swinging) {
    return crouched ? 'W1_Crouch_Fire_Single' : 'W1_Stand_Fire_Single';
  } else if (crouched && moving) {
    return 'W1_CrouchWalk_Aim_F_Loop_IPC';
  } else if (crouched) {
    return aim ? 'W1_Crouch_Aim_Idle_IPC' : 'W1_Crouch_Idle_IPC';
  } else if (running) {
    return 'W1_Jog_Aim_F_Loop_IPC';
  } else if (moving) {
    return 'W1_Walk_Aim_F_Loop_IPC';
  } else {
    return aim ? 'W1_Stand_Aim_Idle_IPC' : 'W1_Stand_Relaxed_Idle_IPC';
  }
}

function legacySpeedRef(target) {
  const SPEED_REF = {
    W1_Walk_Aim_F_Loop_IPC: 1.6,
    W1_Jog_Aim_F_Loop_IPC: 3.5,
    W1_CrouchWalk_Aim_F_Loop_IPC: 1.0,
  };
  return SPEED_REF[target] ?? null;
}

// Cartesian product over the boolean-axis input space + a handful of
// distinct planarSpeed values that bracket the thresholds.
const SPEEDS = [0, 0.04, 0.06, 1.5, 3.4, 3.6, 6.0];
const ADS    = [0, 0.39, 0.41, 0.9];
const CROUCH = [false, true];
const ATTACK = [{ phase: 'idle' }, { phase: 'swinging' }];

let total = 0, fails = 0;
for (const s of SPEEDS) {
  for (const a of ADS) {
    for (const c of CROUCH) {
      for (const at of ATTACK) {
        total++;
        const state = { adsAmount: a, crouched: c, attack: at };
        const expected = legacyPick(state, s);
        const expectedSpeedRef = legacySpeedRef(expected);
        const inputs = deriveInputs(state, s);
        const got = pickClip(smCfg, inputs);
        if (!got || got.clip !== expected || got.speedRef !== expectedSpeedRef) {
          fails++;
          console.error(
            `MISMATCH speed=${s} ads=${a} crouched=${c} swinging=${at.phase !== 'idle'}`,
            `expected="${expected}" speedRef=${expectedSpeedRef}`,
            `got="${got?.clip}" speedRef=${got?.speedRef}`
          );
        }
      }
    }
  }
}

console.log(`state_machine parity: ${total - fails}/${total} cases match`);
if (fails > 0) {
  process.exit(1);
}
