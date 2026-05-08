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
// module load before any user edits.
const DEFAULTS = JSON.parse(JSON.stringify({
  visibleFactor: { ...ANIM_TUNE.visibleFactor },
  gripZScale:    { ...ANIM_TUNE.gripZScale },
  sizeMul:       { ...ANIM_TUNE.sizeMul },
  arm:           { ...ANIM_TUNE.arm },
}));

function _save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      visibleFactor: { ...ANIM_TUNE.visibleFactor },
      gripZScale:    { ...ANIM_TUNE.gripZScale },
      sizeMul:       { ...ANIM_TUNE.sizeMul },
      arm:           { ...ANIM_TUNE.arm },
    }));
  } catch (_) { /* quota / private mode — ignore */ }
}

function _resetAll() {
  Object.assign(ANIM_TUNE.visibleFactor, DEFAULTS.visibleFactor);
  Object.assign(ANIM_TUNE.gripZScale,    DEFAULTS.gripZScale);
  Object.assign(ANIM_TUNE.sizeMul,       DEFAULTS.sizeMul);
  Object.assign(ANIM_TUNE.arm,           DEFAULTS.arm);
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
      label: 'visibleFactor', min: 0.2, max: 3.0, step: 0.05,
    });
    sub.addBinding(ANIM_TUNE.gripZScale, cls, {
      label: 'gripZScale (× len)', min: 0.0, max: 1.0, step: 0.02,
    });
    sub.addBinding(ANIM_TUNE.sizeMul, cls, {
      label: 'sizeMul', min: 0.3, max: 2.5, step: 0.05,
    });
  }

  // ---- Arm + anchor pose (live, no reattach) ----
  const armFolder = pane.addFolder({ title: 'Arm / gun anchor', expanded: true });
  armFolder.addBinding(ANIM_TUNE.arm, 'gaspPitchHipfire', {
    label: 'hipfire arm pitch', min: -0.4, max: 0.4, step: 0.01,
  });
  armFolder.addBinding(ANIM_TUNE.arm, 'hipY', {
    label: 'anchor hipY (m)', min: 0.8, max: 1.8, step: 0.02,
  });
  armFolder.addBinding(ANIM_TUNE.arm, 'adsY', {
    label: 'anchor adsY (m)', min: 1.0, max: 2.0, step: 0.02,
  });
  armFolder.addBinding(ANIM_TUNE.arm, 'fwdMin', {
    label: 'anchor fwdMin (m)', min: 0.0, max: 0.8, step: 0.02,
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
    console.log('[anim-tuner] current ANIM_TUNE:', JSON.parse(JSON.stringify(ANIM_TUNE)));
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
