import GUI from 'lil-gui';
import { tunables } from './tunables.js';
import { getDevToolsEnabled } from './prefs.js';

// Show/hide the entire lil-gui panel. Called on construction to honour
// the persisted Settings → "Dev Tools" toggle, and from the toggle
// handler to flip it live without a page reload.
export function setDebugPanelVisible(gui, visible) {
  if (!gui || !gui.domElement) return;
  gui.domElement.style.display = visible ? '' : 'none';
}

export function initDebugPanel(actions = {}) {
  const gui = new GUI({ title: 'tunables', width: 300 });
  // Hidden by default — users toggle via Settings → Dev Tools. Keeps
  // the prototype clean for friends without requiring code surgery.
  setDebugPanelVisible(gui, getDevToolsEnabled());

  // Lighting — opened by default since it's the actively-tuned block.
  // Hex color fields round-trip through a `colorProxy` so lil-gui's
  // picker can read/write our integer `tunables.lighting` values.
  // `syncLighting()` in main.js pushes edits to the live scene each
  // frame; F3 dumps the current block to the console.
  const lighting = gui.addFolder('lighting');
  const L = tunables.lighting;
  const colorProxy = (obj, key) => ({
    get v() { return '#' + obj[key].toString(16).padStart(6, '0'); },
    set v(s) { obj[key] = parseInt(s.replace('#', ''), 16); },
  });
  lighting.addColor(colorProxy(L, 'hemiSky'), 'v').name('hemiSky');
  lighting.addColor(colorProxy(L, 'hemiGround'), 'v').name('hemiGround');
  lighting.add(L, 'hemiIntensity', 0, 2, 0.01);
  lighting.addColor(colorProxy(L, 'keyColor'), 'v').name('keyColor');
  lighting.add(L, 'keyIntensity', 0, 3, 0.01);
  lighting.addColor(colorProxy(L, 'fillColor'), 'v').name('fillColor');
  lighting.add(L, 'fillIntensity', 0, 2, 0.01);
  lighting.addColor(colorProxy(L, 'rimColor'), 'v').name('rimColor');
  lighting.add(L, 'rimIntensity', 0, 2, 0.01);
  lighting.addColor(colorProxy(L, 'fogColor'), 'v').name('fogColor');
  lighting.add(L, 'fogDensity', 0, 0.05, 0.0005);
  lighting.addColor(colorProxy(L, 'playerAuraColor'), 'v').name('playerAuraColor');
  lighting.add(L, 'playerAuraIntensity', 0, 5, 0.01);
  lighting.add(L, 'playerAuraDistance', 0, 15, 0.1);
  lighting.add(L, 'playerAuraDecay', 0, 4, 0.05);

  const move = gui.addFolder('move');
  move.add(tunables.move, 'walkSpeed', 1, 20, 0.1);
  move.add(tunables.move, 'sprintSpeed', 1, 25, 0.1);
  move.add(tunables.move, 'crouchSpeed', 0.5, 10, 0.1);
  move.add(tunables.move, 'accel', 5, 200, 1);
  move.add(tunables.move, 'friction', 0, 60, 0.5);
  move.add(tunables.move, 'standMuzzleY', 0.3, 2.0, 0.05);
  move.add(tunables.move, 'crouchMuzzleY', 0.1, 1.2, 0.05);
  move.close();   // collapsed by default — movement isn't the active tuning surface

  const dash = gui.addFolder('dash');
  dash.add(tunables.dash, 'speed', 5, 60, 0.5);
  dash.add(tunables.dash, 'duration', 0.05, 0.6, 0.01);
  dash.add(tunables.dash, 'cooldown', 0.05, 2.5, 0.05);
  dash.add(tunables.dash, 'doubleTapWindow', 0.05, 0.6, 0.01);
  dash.add(tunables.dash, 'iFrames', 0, 0.4, 0.01);

  const roll = gui.addFolder('roll');
  roll.add(tunables.roll, 'speed', 5, 40, 0.5);
  roll.add(tunables.roll, 'duration', 0.1, 1.0, 0.01);
  roll.add(tunables.roll, 'cooldown', 0.1, 3.0, 0.05);
  roll.add(tunables.roll, 'iFrames', 0, 0.6, 0.01);

  const slide = gui.addFolder('slide');
  slide.add(tunables.slide, 'entrySpeedMin', 0, 15, 0.1);
  slide.add(tunables.slide, 'startBoost', 1.0, 2.5, 0.05);
  slide.add(tunables.slide, 'friction', 0, 20, 0.1);
  slide.add(tunables.slide, 'minDuration', 0, 1.0, 0.05);
  slide.add(tunables.slide, 'maxDuration', 0.3, 3.0, 0.05);
  slide.add(tunables.slide, 'steerStrength', 0, 10, 0.1);

  const jump = gui.addFolder('jump');
  jump.add(tunables.jump, 'impulse', 1, 20, 0.1);
  jump.add(tunables.jump, 'gravity', 1, 60, 0.5);

  const crouch = gui.addFolder('crouch');
  crouch.add(tunables.crouch, 'heightScale', 0.2, 1.0, 0.01);

  const ads = gui.addFolder('ADS (player)');
  ads.add(tunables.ads, 'moveMultiplier', 0.1, 1.0, 0.05);
  ads.add(tunables.ads, 'enterTime', 0.0, 0.5, 0.01);

  const fx = gui.addFolder('FX');
  fx.add(tunables.attack, 'headMultiplier', 1, 6, 0.1);
  fx.add(tunables.attack, 'tracerLife', 0.01, 0.4, 0.01);
  fx.add(tunables.attack, 'muzzleFlashLife', 0.01, 0.2, 0.005);
  fx.add(tunables.attack, 'impactLife', 0.05, 1.0, 0.01);

  const weaponsFolder = gui.addFolder('weapons');
  if (actions.onGiveAll) {
    weaponsFolder.add({ giveAll: actions.onGiveAll }, 'giveAll').name('give all weapons');
  }
  tunables.weapons.forEach((w) => {
    const f = weaponsFolder.addFolder(w.name);
    if (w.type === 'melee') {
      f.add(w, 'meleeThreshold', 0.5, 8, 0.1);
      f.add(w, 'adsZoom', 0.3, 1.0, 0.01);
      f.add(w, 'adsPeekDistance', 0, 15, 0.1);
      f.addColor(w, 'tracerColor');
      (w.combo || []).forEach((step, i) => {
        ['close', 'far'].forEach((variant) => {
          const sf = f.addFolder(`step ${i + 1} ${variant}`);
          sf.add(step[variant], 'damage', 1, 200, 1);
          sf.add(step[variant], 'range', 0.5, 6, 0.1);
          sf.add(step[variant], 'angleDeg', 10, 180, 5);
          sf.add(step[variant], 'advance', 0, 6, 0.05);
          sf.add(step[variant], 'startup', 0.0, 0.5, 0.01);
          sf.add(step[variant], 'active', 0.02, 0.5, 0.01);
          sf.add(step[variant], 'recovery', 0.02, 1, 0.01);
          sf.add(step[variant], 'window', 0.05, 0.8, 0.01);
          sf.add(step[variant], 'knockback', 0, 15, 0.1);
          sf.close();
        });
      });
    } else {
      f.add(w, 'fireMode', ['semi', 'auto', 'burst']);
      f.add(w, 'fireRate', 0.2, 25, 0.1);
      f.add(w, 'damage', 1, 200, 1);
      f.add(w, 'range', 5, 120, 1);
      f.add(w, 'hipSpread', 0, 0.4, 0.005);
      f.add(w, 'adsSpread', 0, 0.2, 0.001);
      f.add(w, 'adsZoom', 0.3, 1.0, 0.01);
      f.add(w, 'adsPeekDistance', 0, 15, 0.1);
      f.add(w, 'pelletCount', 1, 16, 1);
      f.add(w, 'burstCount', 1, 8, 1);
      f.add(w, 'burstInterval', 0, 0.4, 0.005);
      f.addColor(w, 'tracerColor');
    }
    f.close();
  });

  const zones = gui.addFolder('zones');
  ['head', 'torso', 'legs', 'arm'].forEach((z) => {
    const f = zones.addFolder(z);
    f.add(tunables.zones[z], 'damageMult', 0.1, 5, 0.05);
    if (z === 'legs') f.add(tunables.zones.legs, 'slowDuration', 0, 6, 0.1);
    if (z === 'legs') f.add(tunables.zones.legs, 'slowFactor', 0.1, 1.0, 0.05);
    if (z === 'arm')  f.add(tunables.zones.arm, 'disarmChance', 0, 1, 0.05);
    f.close();
  });

  const en = gui.addFolder('enemy (dummy)');
  en.add(tunables.enemy, 'maxHealth', 10, 500, 5);
  en.add(tunables.enemy, 'respawnDelay', 0.5, 8, 0.1);
  en.add(tunables.enemy, 'hitFlashTime', 0.02, 0.3, 0.01);
  en.add(tunables.enemy, 'knockback', 0, 1.5, 0.05);

  const pf = gui.addFolder('player HP');
  pf.add(tunables.player, 'maxHealth', 10, 500, 5);
  pf.add(tunables.player, 'regenDelay', 0, 10, 0.1);
  pf.add(tunables.player, 'regenRate', 0, 60, 0.5);
  pf.add(tunables.player, 'hitFlashTime', 0.02, 0.5, 0.01);
  pf.add(tunables.player, 'collisionRadius', 0.1, 1.0, 0.01);

  const ai = gui.addFolder('AI (gunman)');
  ai.add(tunables.ai, 'active').name('AI active');
  ai.add(tunables.ai, 'spreadMultiplier', 0.5, 6, 0.05);
  ai.add(tunables.ai, 'flankChance', 0, 1, 0.05);
  ai.add(tunables.ai, 'maxHealth', 10, 400, 5);
  ai.add(tunables.ai, 'respawnDelay', 0.5, 30, 0.5);
  ai.add(tunables.ai, 'detectionRange', 2, 40, 0.5);
  ai.add(tunables.ai, 'detectionAngleDeg', 10, 360, 5);
  ai.add(tunables.ai, 'loseTargetTime', 0, 6, 0.1);
  ai.add(tunables.ai, 'reactionTime', 0, 2, 0.05);
  ai.add(tunables.ai, 'preferredRange', 2, 30, 0.5);
  ai.add(tunables.ai, 'rangeTolerance', 0, 8, 0.1);
  ai.add(tunables.ai, 'moveSpeed', 0, 10, 0.1);
  ai.add(tunables.ai, 'collisionRadius', 0.1, 1.2, 0.01);

  const me = gui.addFolder('AI (melee)');
  me.add(tunables.meleeEnemy, 'maxHealth', 10, 300, 5);
  me.add(tunables.meleeEnemy, 'respawnDelay', 0.5, 30, 0.5);
  me.add(tunables.meleeEnemy, 'moveSpeed', 0, 12, 0.1);
  me.add(tunables.meleeEnemy, 'detectionRange', 2, 40, 0.5);
  me.add(tunables.meleeEnemy, 'swingRange', 0.5, 5, 0.1);
  me.add(tunables.meleeEnemy, 'swingWindup', 0.05, 2, 0.05);
  me.add(tunables.meleeEnemy, 'swingDamage', 1, 80, 1);
  me.add(tunables.meleeEnemy, 'swingCooldown', 0.1, 3, 0.05);

  const swipe = gui.addFolder('player swipe');
  swipe.add(tunables.melee, 'swipeRange', 0.5, 6, 0.1);
  swipe.add(tunables.melee, 'swipeAngleDeg', 20, 180, 5);
  swipe.add(tunables.melee, 'swipeDamage', 1, 200, 1);
  swipe.add(tunables.melee, 'swipeCooldown', 0.05, 2, 0.05);
  swipe.add(tunables.melee, 'swipeKnockback', 0, 20, 0.1);
  swipe.add(tunables.melee, 'swipePenetration', 1, 10, 1);

  const st = gui.addFolder('stamina');
  st.add(tunables.stamina, 'max', 20, 300, 1);
  st.add(tunables.stamina, 'regenRate', 0, 100, 1);
  st.add(tunables.stamina, 'regenDelay', 0, 3, 0.05);
  st.add(tunables.stamina, 'dodgeCost', 0, 60, 1);
  st.add(tunables.stamina, 'rollCost', 0, 60, 1);
  st.add(tunables.stamina, 'blockDrainRate', 0, 80, 1);
  st.add(tunables.stamina, 'deflectCost', 0, 40, 0.5);
  st.add(tunables.stamina, 'parryCost', 0, 40, 0.5);
  st.add(tunables.stamina, 'minToAct', 0, 40, 1);

  const blk = gui.addFolder('block');
  blk.add(tunables.block, 'moveMultiplier', 0.1, 1, 0.05);
  blk.add(tunables.block, 'parryWindow', 0.05, 1, 0.01);
  blk.add(tunables.block, 'spinSpeed', 0, 20, 0.5);
  blk.add(tunables.block, 'redirectDamageMult', 0.5, 4, 0.1);

  const procgen = gui.addFolder('procgen');
  procgen.add(tunables.procgen, 'arenaSize', 20, 80, 1);
  procgen.add(tunables.procgen, 'fullWalls', 0, 20, 1);
  procgen.add(tunables.procgen, 'lowCovers', 0, 30, 1);
  procgen.add(tunables.procgen, 'gapWalls', 0, 8, 1);
  procgen.add(tunables.procgen, 'meleeEnemies', 0, 12, 1);
  procgen.add(tunables.procgen, 'rangedEnemies', 0, 8, 1);
  if (actions.onRegenerate) {
    procgen.add({ regen: actions.onRegenerate }, 'regen').name('regenerate level');
  }

  const lootF = gui.addFolder('loot');
  lootF.add(tunables.loot, 'pickupRadius', 0.5, 6, 0.1);
  lootF.add(tunables.loot, 'bobAmplitude', 0, 0.4, 0.01);

  const cam = gui.addFolder('camera');
  cam.add(tunables.camera, 'viewHeight', 8, 50, 0.5);
  cam.add(tunables.camera, 'followLerp', 1, 30, 0.1);

  [dash, roll, slide, jump, crouch, ads, fx, weaponsFolder, zones, en, pf, ai, me, swipe, st, blk, procgen, lootF, cam]
    .forEach(f => f.close());

  // Persist folder open/close across reloads so the panel remembers
  // what the user was editing. Applies after the default-close block
  // above so the saved state overrides the defaults — e.g. if you
  // had `move` expanded last session it stays expanded on reload.
  const GUI_STATE_KEY = 'tacticalrogue_gui_state_v1';
  const allFolders = [
    lighting, move, dash, roll, slide, jump, crouch, ads, fx,
    weaponsFolder, zones, en, pf, ai, me, swipe, st, blk, procgen,
    lootF, cam,
  ];
  // Restore.
  try {
    const raw = localStorage.getItem(GUI_STATE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const f of allFolders) {
        const key = f._title;
        if (saved[key] === 'open')   f.open();
        else if (saved[key] === 'closed') f.close();
      }
    }
  } catch (_) { /* ignore */ }
  // Persist on any folder open/close. lil-gui 0.18+ exposes
  // `onOpenClose`; the click-based fallback catches older builds.
  const persist = () => {
    try {
      const state = {};
      for (const f of allFolders) state[f._title] = f._closed ? 'closed' : 'open';
      localStorage.setItem(GUI_STATE_KEY, JSON.stringify(state));
    } catch (_) { /* quota / private mode — fail silently */ }
  };
  for (const f of allFolders) {
    if (typeof f.onOpenClose === 'function') {
      f.onOpenClose(persist);
    } else {
      const title = f.$title || f.domElement?.querySelector('.title');
      if (title) {
        title.addEventListener('click', () => setTimeout(persist, 0));
      }
    }
  }

  return gui;
}
