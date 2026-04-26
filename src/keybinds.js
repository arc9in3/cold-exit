// Action-based input mapping with rebindable keyboard + gamepad bindings.
// The Input class talks in actions ("dash", "reload", "weapon_1") instead
// of raw e.code values, so the user can change bindings without us
// touching the rest of the codebase. Persisted to localStorage as a flat
// JSON blob so a page reload keeps the player's setup.
//
// Each action carries one keyboard binding (an `e.code` string like
// 'KeyR' or 'Space') and one gamepad binding (a string like 'btn:0' for
// button 0 / 'axisP:1' for axis 1 positive / 'axisN:0' for axis 0
// negative). Sticks aren't rebindable — left stick is always movement,
// right stick is reserved for camera/aim (not used yet but parked).

const STORAGE_KEY = 'cold-exit:keybinds:v1';

// Canonical action ids. Keep string-stable forever — these become save
// keys that ship to players' localStorage.
export const ACTIONS = {
  // Held movement (resolved from keys + left stick axes each frame)
  MOVE_FORWARD:  'move_forward',
  MOVE_BACKWARD: 'move_backward',
  MOVE_LEFT:     'move_left',
  MOVE_RIGHT:    'move_right',
  SPRINT:        'sprint',
  // Held combat (also true when gamepad RT/LT past threshold)
  ATTACK:        'attack',
  ADS:           'ads',
  // Edge-triggered (fire once per press)
  DASH:          'dash',
  CROUCH_TOGGLE: 'crouch_toggle',
  INTERACT:      'interact',
  MELEE:         'melee',
  RELOAD:        'reload',
  HEAL:          'heal',
  LIGHT_TOGGLE:  'light_toggle',
  SHOULDER_SWAP: 'shoulder_swap',
  WEAPON_CYCLE:  'weapon_cycle',
  WEAPON_1:      'weapon_1',
  WEAPON_2:      'weapon_2',
  WEAPON_3:      'weapon_3',
  WEAPON_4:      'weapon_4',
  QUICKSLOT_1:   'quickslot_1',
  QUICKSLOT_2:   'quickslot_2',
  QUICKSLOT_3:   'quickslot_3',
  QUICKSLOT_4:   'quickslot_4',
  INVENTORY:     'inventory',
  PERKS:         'perks',
  MENU:          'menu',
  LOOT_ALL:      'loot_all',
};

// Display order + human-readable label for the rebind UI. Grouped so
// related actions cluster in the menu.
export const ACTION_GROUPS = [
  { title: 'Movement', items: [
    [ACTIONS.MOVE_FORWARD, 'Move Forward'],
    [ACTIONS.MOVE_BACKWARD, 'Move Backward'],
    [ACTIONS.MOVE_LEFT, 'Move Left'],
    [ACTIONS.MOVE_RIGHT, 'Move Right'],
    [ACTIONS.SPRINT, 'Sprint'],
    [ACTIONS.DASH, 'Dash / Roll'],
    [ACTIONS.CROUCH_TOGGLE, 'Crouch (toggle)'],
  ]},
  { title: 'Combat', items: [
    [ACTIONS.ATTACK, 'Attack / Fire'],
    [ACTIONS.ADS, 'Aim / Block'],
    [ACTIONS.MELEE, 'Quick Melee'],
    [ACTIONS.RELOAD, 'Reload'],
    [ACTIONS.SHOULDER_SWAP, 'Swap Shoulder'],
    [ACTIONS.WEAPON_CYCLE, 'Cycle Weapon'],
  ]},
  { title: 'Weapon Slots', items: [
    [ACTIONS.WEAPON_1, 'Weapon 1'],
    [ACTIONS.WEAPON_2, 'Weapon 2'],
    [ACTIONS.WEAPON_3, 'Weapon 3'],
    [ACTIONS.WEAPON_4, 'Weapon 4'],
  ]},
  { title: 'Quickslots', items: [
    [ACTIONS.QUICKSLOT_1, 'Quickslot 1'],
    [ACTIONS.QUICKSLOT_2, 'Quickslot 2'],
    [ACTIONS.QUICKSLOT_3, 'Quickslot 3'],
    [ACTIONS.QUICKSLOT_4, 'Quickslot 4'],
  ]},
  { title: 'Interface', items: [
    [ACTIONS.INTERACT, 'Interact / Pick Up'],
    [ACTIONS.HEAL, 'Quick Heal'],
    [ACTIONS.LIGHT_TOGGLE, 'Toggle Lights'],
    [ACTIONS.INVENTORY, 'Inventory'],
    [ACTIONS.PERKS, 'Perks Menu'],
    [ACTIONS.MENU, 'Pause / Menu'],
    [ACTIONS.LOOT_ALL, 'Loot All (in loot menu)'],
  ]},
];

// Defaults match the legacy hardcoded bindings so existing players see
// no behaviour change after the refactor lands. New players inherit
// these and can rebind any of them through Settings → Keybinds.
const DEFAULT_KEYBOARD = {
  [ACTIONS.MOVE_FORWARD]:  'KeyW',
  [ACTIONS.MOVE_BACKWARD]: 'KeyS',
  [ACTIONS.MOVE_LEFT]:     'KeyA',
  [ACTIONS.MOVE_RIGHT]:    'KeyD',
  [ACTIONS.SPRINT]:        'ShiftLeft',
  [ACTIONS.DASH]:          'Space',
  [ACTIONS.CROUCH_TOGGLE]: 'KeyC',
  [ACTIONS.INTERACT]:      'KeyE',
  [ACTIONS.MELEE]:         'KeyF',
  [ACTIONS.RELOAD]:        'KeyR',
  [ACTIONS.HEAL]:          'KeyH',
  [ACTIONS.LIGHT_TOGGLE]:  'KeyT',
  [ACTIONS.SHOULDER_SWAP]: 'KeyQ',
  [ACTIONS.WEAPON_CYCLE]:  'KeyX',
  [ACTIONS.WEAPON_1]:      'Digit1',
  [ACTIONS.WEAPON_2]:      'Digit2',
  [ACTIONS.WEAPON_3]:      'Digit3',
  [ACTIONS.WEAPON_4]:      'Digit4',
  [ACTIONS.QUICKSLOT_1]:   'Digit5',
  [ACTIONS.QUICKSLOT_2]:   'Digit6',
  [ACTIONS.QUICKSLOT_3]:   'Digit7',
  [ACTIONS.QUICKSLOT_4]:   'Digit8',
  [ACTIONS.INVENTORY]:     'Tab',
  [ACTIONS.PERKS]:         'KeyK',
  [ACTIONS.MENU]:          'Escape',
  [ACTIONS.LOOT_ALL]:      'KeyY',
  // ATTACK / ADS stay mouse-only by default (button 0 / button 2 are
  // hardcoded in the input layer). They're still in the action map so
  // gamepad bindings can target them.
  [ACTIONS.ATTACK]:        '',
  [ACTIONS.ADS]:           '',
};

// Xbox-style defaults. Codes:
//   btn:N   — gamepad button index N (A=0, B=1, X=2, Y=3, LB=4, RB=5,
//             LT=6, RT=7, View/Back=8, Menu/Start=9, L3=10, R3=11,
//             D-Up=12, D-Down=13, D-Left=14, D-Right=15)
//   axisP:N / axisN:N — axis N over positive / negative threshold
//             (left stick: 0,1 ; right stick: 2,3 — defaults to >|0.5|)
const DEFAULT_GAMEPAD = {
  // Left stick handled directly by sample(); these axis bindings still
  // feed the held-action set so consumers like the keybind UI can show
  // "Stick" as the current binding without a separate code path.
  [ACTIONS.MOVE_FORWARD]:  'axisN:1',
  [ACTIONS.MOVE_BACKWARD]: 'axisP:1',
  [ACTIONS.MOVE_LEFT]:     'axisN:0',
  [ACTIONS.MOVE_RIGHT]:    'axisP:0',
  [ACTIONS.SPRINT]:        'btn:10',  // L3 click
  [ACTIONS.DASH]:          'btn:0',   // A
  [ACTIONS.CROUCH_TOGGLE]: 'btn:1',   // B
  [ACTIONS.INTERACT]:      'btn:3',   // Y
  [ACTIONS.MELEE]:         'btn:2',   // X (cluster button — punch / melee combo start)
  [ACTIONS.RELOAD]:        'btn:5',   // RB
  [ACTIONS.HEAL]:          'btn:12',  // D-Up
  [ACTIONS.LIGHT_TOGGLE]:  'btn:13',  // D-Down
  [ACTIONS.SHOULDER_SWAP]: 'btn:11',  // R3 click
  [ACTIONS.WEAPON_CYCLE]:  'btn:4',   // LB
  [ACTIONS.WEAPON_1]:      '',
  [ACTIONS.WEAPON_2]:      '',
  [ACTIONS.WEAPON_3]:      '',
  [ACTIONS.WEAPON_4]:      '',
  [ACTIONS.QUICKSLOT_1]:   'btn:14',  // D-Left
  [ACTIONS.QUICKSLOT_2]:   'btn:15',  // D-Right
  [ACTIONS.QUICKSLOT_3]:   '',
  [ACTIONS.QUICKSLOT_4]:   '',
  [ACTIONS.INVENTORY]:     'btn:8',   // View / Back
  [ACTIONS.PERKS]:         '',
  [ACTIONS.MENU]:          'btn:9',   // Menu / Start
  [ACTIONS.LOOT_ALL]:      '',        // unbound by default — players can map a face button
  [ACTIONS.ATTACK]:        'btn:7',   // RT
  [ACTIONS.ADS]:           'btn:6',   // LT
};

let keyboardMap = { ...DEFAULT_KEYBOARD };
let gamepadMap  = { ...DEFAULT_GAMEPAD };

// Reverse lookups, rebuilt every time bindings change. Letting the
// Input layer query "what action does e.code 'KeyR' map to?" in O(1)
// rather than scanning the whole map per keypress.
let keyToActions = new Map();
let gpadToActions = new Map();

function rebuildReverse() {
  keyToActions = new Map();
  gpadToActions = new Map();
  for (const [action, code] of Object.entries(keyboardMap)) {
    if (!code) continue;
    if (!keyToActions.has(code)) keyToActions.set(code, []);
    keyToActions.get(code).push(action);
  }
  for (const [action, code] of Object.entries(gamepadMap)) {
    if (!code) continue;
    if (!gpadToActions.has(code)) gpadToActions.set(code, []);
    gpadToActions.get(code).push(action);
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { rebuildReverse(); return; }
    const data = JSON.parse(raw);
    if (data?.keyboard) keyboardMap = { ...DEFAULT_KEYBOARD, ...data.keyboard };
    if (data?.gamepad)  gamepadMap  = { ...DEFAULT_GAMEPAD,  ...data.gamepad };
  } catch (_) {
    // Corrupt blob — fall back to defaults rather than crashing the
    // boot. The rebind UI lets the user reset explicitly later.
    keyboardMap = { ...DEFAULT_KEYBOARD };
    gamepadMap  = { ...DEFAULT_GAMEPAD };
  }
  rebuildReverse();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      keyboard: keyboardMap, gamepad: gamepadMap,
    }));
  } catch (_) {}
}

load();

export function getKeyboardBinding(action) { return keyboardMap[action] || ''; }
export function getGamepadBinding(action)  { return gamepadMap[action]  || ''; }

// `code` is an `e.code` string. Looks up which actions (if any) the
// keypress should fire. Returns array of action ids; empty if unbound.
export function actionsForKey(code) {
  return keyToActions.get(code) || [];
}
export function actionsForGamepadCode(code) {
  return gpadToActions.get(code) || [];
}

// Rebind a single action. Pass `''` as code to clear. Auto-clears any
// other action currently using the same code so two actions can't share
// a binding (last-write-wins) — without this the first action listed
// would win every keypress and the rebound action would silently fail.
export function setKeyboardBinding(action, code) {
  if (!(action in keyboardMap) && !(action in DEFAULT_KEYBOARD)) return false;
  if (code) {
    for (const k of Object.keys(keyboardMap)) {
      if (keyboardMap[k] === code && k !== action) keyboardMap[k] = '';
    }
  }
  keyboardMap[action] = code || '';
  rebuildReverse(); save();
  return true;
}
export function setGamepadBinding(action, code) {
  if (!(action in gamepadMap) && !(action in DEFAULT_GAMEPAD)) return false;
  if (code) {
    for (const k of Object.keys(gamepadMap)) {
      if (gamepadMap[k] === code && k !== action) gamepadMap[k] = '';
    }
  }
  gamepadMap[action] = code || '';
  rebuildReverse(); save();
  return true;
}

export function resetToDefaults() {
  keyboardMap = { ...DEFAULT_KEYBOARD };
  gamepadMap  = { ...DEFAULT_GAMEPAD };
  rebuildReverse(); save();
}

// ── Display helpers for the rebind UI ──────────────────────────────

// Mouse button labels — matches MouseEvent.button (0=LMB, 1=MMB, 2=RMB,
// 3=back, 4=forward). Wheel inputs encoded as wheel:up / wheel:down.
const MOUSE_LABELS = {
  '0': 'LMB', '1': 'MMB', '2': 'RMB',
  '3': 'Mouse 4', '4': 'Mouse 5',
};

export function displayKeyboard(code) {
  if (!code) return '—';
  if (code.startsWith('mouse:')) {
    const idx = code.slice(6);
    return MOUSE_LABELS[idx] || `Mouse ${(parseInt(idx, 10) | 0) + 1}`;
  }
  if (code === 'wheel:up')   return 'Wheel ↑';
  if (code === 'wheel:down') return 'Wheel ↓';
  if (code.startsWith('Key')) return code.slice(3);            // KeyW → W
  if (code.startsWith('Digit')) return code.slice(5);          // Digit1 → 1
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
  if (code === 'Space') return 'Space';
  if (code === 'Tab') return 'Tab';
  if (code === 'Escape') return 'Esc';
  if (code === 'Enter') return 'Enter';
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
}

const GP_BTN_NAMES = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y',
  4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
  8: 'View', 9: 'Menu',
  10: 'L3', 11: 'R3',
  12: 'D-Up', 13: 'D-Down', 14: 'D-Left', 15: 'D-Right',
};
const GP_AXIS_NAMES = {
  0: 'LStick X', 1: 'LStick Y', 2: 'RStick X', 3: 'RStick Y',
};
export function displayGamepad(code) {
  if (!code) return '—';
  if (code.startsWith('btn:')) {
    const i = parseInt(code.slice(4), 10);
    return GP_BTN_NAMES[i] || `Btn ${i}`;
  }
  if (code.startsWith('axisP:')) {
    const i = parseInt(code.slice(6), 10);
    return (GP_AXIS_NAMES[i] || `Axis ${i}`) + ' +';
  }
  if (code.startsWith('axisN:')) {
    const i = parseInt(code.slice(6), 10);
    return (GP_AXIS_NAMES[i] || `Axis ${i}`) + ' −';
  }
  return code;
}

// ── Gamepad capture helper for the rebind UI ───────────────────────
// Polls navigator.getGamepads() each frame; resolves with the first
// button or axis that crosses threshold. Used when the user clicks
// "Rebind" on a gamepad row in the keybind menu.
export function captureNextGamepadInput(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const start = performance.now();
    let prevButtons = null, prevAxes = null;
    const tick = () => {
      const pads = (navigator.getGamepads ? navigator.getGamepads() : []) || [];
      const pad = Array.from(pads).find(p => p);
      if (pad) {
        const btns = pad.buttons.map(b => b.value > 0.5);
        const axes = pad.axes.map(a => a);
        if (prevButtons) {
          for (let i = 0; i < btns.length; i++) {
            if (btns[i] && !prevButtons[i]) { resolve(`btn:${i}`); return; }
          }
          for (let i = 0; i < axes.length; i++) {
            if (Math.abs(axes[i]) > 0.7 && Math.abs(prevAxes[i] || 0) < 0.5) {
              resolve(axes[i] > 0 ? `axisP:${i}` : `axisN:${i}`);
              return;
            }
          }
        }
        prevButtons = btns;
        prevAxes = axes;
      }
      if (performance.now() - start > timeoutMs) { resolve(''); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
