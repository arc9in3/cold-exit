// ============================================================
// ui_anim_tuner.js — tweakpane panel for live anim/weapon tuning
// ============================================================
//
// Open from console:    window.__openTuner()
// Close:                window.__closeTuner()
//
// Bound to ANIM_TUNE in src/player.js (exported). Sliders mutate
// the live config; setWeapon + _runUpperBodyIK read fresh on each
// frame / weapon swap. Position + size changes apply immediately
// via player.reattachWeapon(); arm/anchor changes apply on the
// very next frame (no reattach needed).
//
// Persistence: any change auto-saves to localStorage under
// 'coldExitAnimTune'. player.js loads this on module init so
// edits survive page reloads. Reset to defaults clears the entry.
//
// Usage hint: equip the weapon class you want to tune, run
// __openTuner() in console, scrub sliders. The active weapon
// re-applies on every change; arm/anchor changes are continuous.

import { Pane } from 'tweakpane';
import { ANIM_TUNE } from './player.js';

const STORAGE_KEY = 'coldExitAnimTune';
const CLASSES = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'lmg', 'flame', 'melee'];

// Snapshot of defaults so "Reset" can restore. Captured once on
// module load before any user edits. Deep-clone to dodge nested
// object aliasing.
const DEFAULTS = JSON.parse(JSON.stringify({
  visibleFactor: ANIM_TUNE.visibleFactor,
  gripZScale:    ANIM_TUNE.gripZScale,
  sizeMul:       ANIM_TUNE.sizeMul,
  gripOffset:    ANIM_TUNE.gripOffset,
  supportGrip:   ANIM_TUNE.supportGrip,
  arm:           ANIM_TUNE.arm,
}));

function _save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      visibleFactor: ANIM_TUNE.visibleFactor,
      gripZScale:    ANIM_TUNE.gripZScale,
      sizeMul:       ANIM_TUNE.sizeMul,
      gripOffset:    ANIM_TUNE.gripOffset,
      supportGrip:   ANIM_TUNE.supportGrip,
      arm:           ANIM_TUNE.arm,
    }));
  } catch (_) { /* quota / private mode — ignore */ }
}

// Deep-merge defaults back into ANIM_TUNE without re-creating the
// containing objects (other modules close over the references).
function _resetAll() {
  for (const cls of CLASSES) {
    ANIM_TUNE.visibleFactor[cls] = DEFAULTS.visibleFactor[cls];
    ANIM_TUNE.gripZScale[cls]    = DEFAULTS.gripZScale[cls];
    ANIM_TUNE.sizeMul[cls]       = DEFAULTS.sizeMul[cls];
    ANIM_TUNE.supportGrip[cls]   = DEFAULTS.supportGrip[cls];
    if (DEFAULTS.gripOffset[cls]) {
      ANIM_TUNE.gripOffset[cls].x = DEFAULTS.gripOffset[cls].x;
      ANIM_TUNE.gripOffset[cls].y = DEFAULTS.gripOffset[cls].y;
    }
  }
  ANIM_TUNE.arm.gaspPitchHipfire = DEFAULTS.arm.gaspPitchHipfire;
  ANIM_TUNE.arm.anchorOffset.x = DEFAULTS.arm.anchorOffset.x;
  ANIM_TUNE.arm.anchorOffset.y = DEFAULTS.arm.anchorOffset.y;
  ANIM_TUNE.arm.anchorOffset.z = DEFAULTS.arm.anchorOffset.z;
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

function _reapply(player) {
  // Only weapon-position knobs need reattach; arm/anchor knobs
  // are read per-frame and apply automatically.
  try { player?.reattachWeapon?.(); } catch (_) {}
}

export function openAnimTuner(player) {
  if (window.__animTunerPane) {
    window.__animTunerPane.element.style.display = '';
    return window.__animTunerPane;
  }
  const pane = new Pane({ title: 'Anim Tuner', expanded: true });

  // ---- Per-class weapon position + size ----
  const classFolder = pane.addFolder({ title: 'Per-class weapon', expanded: true });
  for (const cls of CLASSES) {
    const sub = classFolder.addFolder({ title: cls, expanded: false });
    sub.addBinding(ANIM_TUNE.visibleFactor, cls, {
      label: 'muzzle distance (vf)', min: 0.2, max: 3.0, step: 0.05,
    });
    sub.addBinding(ANIM_TUNE.gripZScale, cls, {
      label: 'grip Z (× len)', min: 0.0, max: 1.0, step: 0.02,
    });
    sub.addBinding(ANIM_TUNE.sizeMul, cls, {
      label: 'size mul', min: 0.3, max: 3.5, step: 0.05,
    });
    if (!ANIM_TUNE.gripOffset[cls]) ANIM_TUNE.gripOffset[cls] = { x: 0, y: 0 };
    sub.addBinding(ANIM_TUNE.gripOffset[cls], 'x', {
      label: 'main hand X', min: -0.5, max: 0.5, step: 0.01,
    });
    sub.addBinding(ANIM_TUNE.gripOffset[cls], 'y', {
      label: 'main hand Y', min: -0.5, max: 0.5, step: 0.01,
    });
    sub.addBinding(ANIM_TUNE.supportGrip, cls, {
      label: 'support hand frac', min: 0.0, max: 1.0, step: 0.05,
    });
  }

  // ---- Arm + anchor pose (live, no reattach) ----
  const armFolder = pane.addFolder({ title: 'Arm / gun anchor', expanded: true });
  armFolder.addBinding(ANIM_TUNE.arm, 'gaspPitchHipfire', {
    label: 'hipfire arm pitch', min: -0.4, max: 0.4, step: 0.01,
  });
  armFolder.addBinding(ANIM_TUNE.arm.anchorOffset, 'x', {
    label: 'anchor offset X', min: -0.5, max: 0.5, step: 0.01,
  });
  armFolder.addBinding(ANIM_TUNE.arm.anchorOffset, 'y', {
    label: 'anchor offset Y', min: -0.5, max: 0.5, step: 0.01,
  });
  armFolder.addBinding(ANIM_TUNE.arm.anchorOffset, 'z', {
    label: 'anchor offset Z', min: -0.5, max: 0.5, step: 0.01,
  });

  // ---- Buttons ----
  pane.addBlade({ view: 'separator' });
  pane.addButton({ title: 'Reset all to defaults' }).on('click', () => {
    _resetAll();
    _reapply(player);
    pane.refresh();
  });
  pane.addButton({ title: 'Reattach active weapon' }).on('click', () => {
    _reapply(player);
  });
  pane.addButton({ title: 'Print ANIM_TUNE → console' }).on('click', () => {
    // Pretty-printed JSON so devtools doesn't truncate nested objects
    // with `{...}`. The string is also handed to clipboard if the user
    // grants permission, otherwise just logged for copy-paste.
    const dump = JSON.stringify(ANIM_TUNE, null, 2);
    console.log('[anim-tuner] ANIM_TUNE (paste back to bake defaults):\n' + dump);
    try { navigator.clipboard?.writeText(dump); } catch (_) {}
  });

  // Auto-save + auto-reapply on any change. Tweakpane fires `change`
  // for every slider drag tick; debounce save but reapply immediately.
  let _saveT = 0;
  pane.on('change', () => {
    _reapply(player);
    if (_saveT) clearTimeout(_saveT);
    _saveT = setTimeout(_save, 200);
  });

  window.__animTunerPane = pane;
  return pane;
}

export function closeAnimTuner() {
  const pane = window.__animTunerPane;
  if (!pane) return;
  try { pane.dispose(); } catch (_) {}
  window.__animTunerPane = null;
}
