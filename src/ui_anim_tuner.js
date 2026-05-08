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
import { ANIM_TUNE, ANIM_TUNE_DEFAULTS } from './player.js';
import { DETAIL_TUNE, refreshDetailOverlay } from './material_pool.js';

const STORAGE_KEY = 'coldExitAnimTune';
const CLASSES = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'lmg', 'flame', 'melee'];

// Defaults source — ANIM_TUNE_DEFAULTS is captured BEFORE the
// localStorage merge in player.js, so this is the actual baked
// shipping values, NOT a snapshot of what the user already had
// saved. Reset to defaults via this constant restores the code
// state instead of looping back to the user's stored tuning
// (which was the bug — bakes felt invisible).
const DEFAULTS = ANIM_TUNE_DEFAULTS;

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
    if (ANIM_TUNE.arm.stanceYaw && cls in ANIM_TUNE.arm.stanceYaw) {
      sub.addBinding(ANIM_TUNE.arm.stanceYaw, cls, {
        label: 'upper-body twist (rad)', min: -0.8, max: 0.8, step: 0.01,
      });
    }
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
  armFolder.addBinding(ANIM_TUNE.arm, 'dominantArmIK', {
    label: 'pull hand to grip (IK)',
  });
  armFolder.addBinding(ANIM_TUNE.arm, 'disableAllIK', {
    label: 'DISABLE ALL IK (raw clips)',
  });
  // Per-axis hand-tracking smoothing. Lower = more smoothing /
  // more gun lag. Y in particular dampens running stride bob.
  armFolder.addBinding(ANIM_TUNE.arm.anchorLerp, 'x', {
    label: 'anchor lerp X', min: 0.02, max: 0.5, step: 0.01,
  });
  armFolder.addBinding(ANIM_TUNE.arm.anchorLerp, 'y', {
    label: 'anchor lerp Y (bob)', min: 0.02, max: 0.5, step: 0.01,
  });
  armFolder.addBinding(ANIM_TUNE.arm.anchorLerp, 'z', {
    label: 'anchor lerp Z', min: 0.02, max: 0.5, step: 0.01,
  });

  // ---- World material detail overlay ----
  const matFolder = pane.addFolder({ title: 'World materials', expanded: false });
  matFolder.addBinding(DETAIL_TUNE, 'enabled', { label: 'detail overlay' });
  matFolder.addBinding(DETAIL_TUNE, 'strength', {
    label: 'strength', min: 0.0, max: 0.6, step: 0.01,
  });
  matFolder.addBinding(DETAIL_TUNE, 'scale', {
    label: 'scale (per m)', min: 0.2, max: 6.0, step: 0.05,
  });
  // Push DETAIL_TUNE → live shader uniforms on any change in this
  // folder. The general pane.on('change') handler below ALSO fires
  // but only triggers reattachWeapon (cheap to no-op call here).
  matFolder.on('change', () => { refreshDetailOverlay(); });

  // ---- Buttons ----
  pane.addBlade({ view: 'separator' });
  pane.addButton({ title: '⤺ Adopt baked defaults (clear saved)' }).on('click', () => {
    _resetAll();
    _reapply(player);
    refreshDetailOverlay();
    pane.refresh();
    console.log('[anim-tuner] localStorage cleared; ANIM_TUNE reset to baked code defaults.');
  });
  pane.addButton({ title: 'Reattach active weapon' }).on('click', () => {
    _reapply(player);
  });
  pane.addButton({ title: 'Log anim state (NOW)' }).on('click', () => {
    // Snapshot current clip + active layered actions + locomotion
    // inputs. Use during reload-while-running playtests so we can
    // see exactly which clip is feeding the legs and which layered
    // actions are stacked.
    const p = window.__player;
    const fbx = p?.rig?._fbx;
    const playing = [];
    if (fbx?.actions) {
      for (const [name, a] of fbx.actions) {
        if (a.isRunning?.() && (a.getEffectiveWeight?.() ?? 1) > 0.01) {
          playing.push(`${name}  w=${a.getEffectiveWeight().toFixed(2)}  ts=${a.timeScale.toFixed(2)}  t=${a.time.toFixed(2)}`);
        }
      }
    }
    const v = p?.body?.velocity;
    const planar = v ? Math.hypot(v.x || 0, v.z || 0) : 0;
    const eq = p?.__equipped || p?.state?.equipped;
    console.log('[anim-snap]\n  base       :', fbx?.currentClipName,
      '\n  layered    :', fbx?.currentLayeredClipName,
      '\n  weapon     :', eq?.name, '/', eq?.class,
      '\n  reloading  :', eq?.reloadingT > 0 ? 'YES' : 'no',
      '\n  speed      :', planar.toFixed(2), 'm/s',
      '\n  adsAmount  :', (p?.state?.adsAmount ?? 0).toFixed(2),
      '\n  sprinting  :', !!p?.state?.sprinting,
      '\n  crouched   :', !!p?.state?.crouched,
      '\n  running    :', playing.join('\n               '));
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
