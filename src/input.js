import * as THREE from 'three';
import { tunables } from './tunables.js';
import { ACTIONS, actionsForKey, actionsForGamepadCode } from './keybinds.js';

// Centralised input. Buffers edge events (dash/melee/E presses, mouse clicks)
// so the game loop can consume them once per frame, and exposes held-state
// for movement. Raw mouseNDC + a reusable raycaster are exposed for richer
// aim resolution in main.
//
// Internally we no longer compare against `e.code` — keypresses resolve to
// abstract actions through src/keybinds.js. The same routing covers gamepad
// buttons + sticks, polled in sample(). Callers (main.js) see the same
// edge-flag / held-state shape they always did, so this refactor is
// transparent to everything downstream.
export class Input {
  constructor(domEl, camera, groundPlane) {
    this.dom = domEl;
    this.camera = camera;
    this.plane = groundPlane;
    this.raycaster = new THREE.Raycaster();
    this.mouseNDC = new THREE.Vector2(0, 0);
    this.hasAim = false;

    // Held actions split by input source so a gamepad release can't
    // erroneously drop an action that the keyboard is still holding
    // (and vice-versa). The public read uses `_isHeld(action)` which
    // is "in either set". Edge events fire on either source's rising
    // edge, but only once per discrete press (per source).
    this._kbHeld = new Set();
    this._gpadHeld = new Set();
    this.mouseButtons = new Set();

    // Edge events consumed once per frame.
    this.spacePressed = false;
    this.spaceDoublePressed = false;
    this.crouchPressed = false;
    this.crouchToggled = false;
    this.attackPressed = false;
    this.interactPressed = false;
    this.meleePressed = false;
    this.inventoryToggled = false;
    this.perksToggled = false;
    this.menuToggled = false;
    this.reloadPressed = false;
    this.lightToggled = false;
    this.healPressed = false;
    this.actionSlotPressed = -1;
    this.weaponSwitch = null;
    this.weaponCycle = false;
    this.handednessToggle = false;
    this.lootAllPressed = false;
    this.lastSpaceTime = -999;

    // (gamepad edge tracking now uses _gpadHeld vs the freshly polled
    // `nowHeld` set inside _pollGamepad — no separate prev-set needed.)

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onContextMenu = (e) => e.preventDefault();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    domEl.addEventListener('mousemove', this._onMouseMove);
    domEl.addEventListener('mousedown', this._onMouseDown);
    // Wheel binding lives on the canvas so menu / inventory scrolling
    // still works inside their modal panels (events bubble there
    // through the normal DOM, never hit this listener).
    domEl.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('contextmenu', this._onContextMenu);
  }

  clearMouseState() {
    this.mouseButtons.clear();
    this.attackPressed = false;
  }

  // Translate a single action firing into the correct edge / held flag.
  // Movement actions just live in the held set; everything else flips
  // the matching flag below. Centralising this here means keydown and
  // gamepad-press paths share the same dispatch — no second copy of
  // the action → flag table to drift.
  _fireAction(action) {
    switch (action) {
      case ACTIONS.DASH: {
        const now = performance.now() / 1000;
        if (now - this.lastSpaceTime <= tunables.dash.doubleTapWindow) {
          this.spaceDoublePressed = true;
        } else {
          this.spacePressed = true;
        }
        this.lastSpaceTime = now;
        break;
      }
      case ACTIONS.CROUCH_TOGGLE:
        this.crouchPressed = true;
        this.crouchToggled = !this.crouchToggled;
        break;
      case ACTIONS.INTERACT:      this.interactPressed = true; break;
      case ACTIONS.MELEE:         this.meleePressed = true; break;
      case ACTIONS.RELOAD:        this.reloadPressed = true; break;
      case ACTIONS.HEAL:          this.healPressed = true; break;
      case ACTIONS.LIGHT_TOGGLE:  this.lightToggled = true; break;
      case ACTIONS.SHOULDER_SWAP: this.handednessToggle = true; break;
      case ACTIONS.WEAPON_CYCLE:  this.weaponCycle = true; break;
      case ACTIONS.INVENTORY:     this.inventoryToggled = true; break;
      case ACTIONS.PERKS:         this.perksToggled = true; break;
      case ACTIONS.MENU:          this.menuToggled = true; break;
      case ACTIONS.LOOT_ALL:      this.lootAllPressed = true; break;
      case ACTIONS.WEAPON_1: this.weaponSwitch = 0; break;
      case ACTIONS.WEAPON_2: this.weaponSwitch = 1; break;
      case ACTIONS.WEAPON_3: this.weaponSwitch = 2; break;
      case ACTIONS.WEAPON_4: this.weaponSwitch = 3; break;
      case ACTIONS.QUICKSLOT_1: this.actionSlotPressed = 0; break;
      case ACTIONS.QUICKSLOT_2: this.actionSlotPressed = 1; break;
      case ACTIONS.QUICKSLOT_3: this.actionSlotPressed = 2; break;
      case ACTIONS.QUICKSLOT_4: this.actionSlotPressed = 3; break;
      case ACTIONS.ATTACK:      this.attackPressed = true; break;
      // ADS / movement / sprint resolve from heldActions in sample();
      // no edge flag needed.
    }
  }

  _onKeyDown(e) {
    if (e.repeat) return;
    // Don't eat keys while the player is typing in a form element
    // (player-name input, leaderboard search, etc.). Tab/Escape still
    // pass through — those are modal nav.
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
      if (e.code !== 'Tab' && e.code !== 'Escape') return;
    }

    // Keep WASD/Space preventDefault even when unbound — in case the
    // user un-bound movement we still don't want the page to scroll.
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) {
      e.preventDefault();
    }

    const actions = actionsForKey(e.code);
    if (actions.length) {
      e.preventDefault();
      for (const a of actions) {
        // Edge fires only when the action transitions from no-source-
        // held to keyboard-held. Without checking the gamepad set too,
        // a player holding the same action on both sources would get
        // duplicate edge fires.
        const wasHeld = this._kbHeld.has(a) || this._gpadHeld.has(a);
        this._kbHeld.add(a);
        if (!wasHeld) this._fireAction(a);
      }
    }
  }

  _onKeyUp(e) {
    const actions = actionsForKey(e.code);
    for (const a of actions) this._kbHeld.delete(a);
  }

  _onBlur() {
    this._kbHeld.clear();
    this._gpadHeld.clear();
    this.mouseButtons.clear();
  }

  _isHeld(action) {
    return this._kbHeld.has(action) || this._gpadHeld.has(action);
  }

  _onMouseMove(e) {
    const rect = this.dom.getBoundingClientRect();
    this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.hasAim = true;
  }

  _onMouseDown(e) {
    this.mouseButtons.add(e.button);
    if (e.button === 0) this.attackPressed = true;
    // Route mouse buttons through the keybind layer so users can bind
    // actions like Reload / Heal / Quickslot to extra mouse buttons.
    // LMB / RMB stay hardcoded for attack / ADS via mouseButtons but
    // ALSO fire any user-bound action — both can coexist.
    const code = `mouse:${e.button}`;
    const actions = actionsForKey(code);
    for (const a of actions) {
      const wasHeld = this._kbHeld.has(a) || this._gpadHeld.has(a);
      this._kbHeld.add(a);
      if (!wasHeld) this._fireAction(a);
    }
  }
  _onMouseUp(e) {
    this.mouseButtons.delete(e.button);
    const code = `mouse:${e.button}`;
    const actions = actionsForKey(code);
    for (const a of actions) this._kbHeld.delete(a);
  }
  _onWheel(e) {
    // Edge-fire only — wheel deltas are pulses, not held inputs.
    // Throttle to ignore micro-deltas (touchpad noise).
    if (Math.abs(e.deltaY) < 0.5) return;
    const code = e.deltaY > 0 ? 'wheel:down' : 'wheel:up';
    const actions = actionsForKey(code);
    if (actions.length) {
      e.preventDefault();
      for (const a of actions) this._fireAction(a);
    }
  }

  computeAim(targetMeshes) {
    if (!this.hasAim) return { point: null, zone: null, owner: null };
    this.raycaster.setFromCamera(this.mouseNDC, this.camera);

    if (targetMeshes && targetMeshes.length) {
      const hits = this.raycaster.intersectObjects(targetMeshes, false);
      if (hits.length > 0) {
        const h = hits[0];
        return {
          point: h.point.clone(),
          zone: h.object.userData?.zone || null,
          owner: h.object.userData?.owner || null,
        };
      }
    }

    const gp = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.plane, gp)) {
      return { point: gp, zone: null, owner: null };
    }
    return { point: null, zone: null, owner: null };
  }

  // Poll all connected gamepads and translate the current button /
  // axis state into the held-action set. Edges fire actions exactly
  // once per press by diffing against the previous frame. Sticks
  // contribute to MOVE_* via axis bindings (handled in sample's
  // movement resolution) and also feed any axis bindings registered
  // for non-movement actions.
  _pollGamepad() {
    const pads = (navigator.getGamepads ? navigator.getGamepads() : []) || [];
    const pad = Array.from(pads).find(p => p);
    if (!pad) {
      // No pad connected — clear gamepad-held set so we don't carry
      // phantom held actions if the pad disconnects mid-press.
      this._gpadHeld.clear();
      return;
    }
    const nowHeld = new Set();
    // Buttons
    for (let i = 0; i < pad.buttons.length; i++) {
      if (!pad.buttons[i]) continue;
      const pressed = pad.buttons[i].value > 0.5 || pad.buttons[i].pressed;
      if (!pressed) continue;
      for (const a of actionsForGamepadCode(`btn:${i}`)) nowHeld.add(a);
    }
    // Axes — past 0.5 magnitude counts as held in that direction.
    for (let i = 0; i < pad.axes.length; i++) {
      const v = pad.axes[i];
      if (Math.abs(v) <= 0.5) continue;
      const code = v > 0 ? `axisP:${i}` : `axisN:${i}`;
      for (const a of actionsForGamepadCode(code)) nowHeld.add(a);
    }
    // Edge fire: actions newly held by the pad that no source was
    // holding before. Suppresses duplicate fires when the keyboard
    // already had this action down.
    for (const a of nowHeld) {
      const wasHeld = this._kbHeld.has(a) || this._gpadHeld.has(a);
      if (!wasHeld) this._fireAction(a);
    }
    // Replace the gamepad-held set wholesale; release of a pad button
    // only drops the gamepad source — keyboard hold (in _kbHeld) is
    // untouched and continues to keep the action live for sample().
    this._gpadHeld = nowHeld;
  }

  sample() {
    this._pollGamepad();

    // Resolve movement vector. WASD and gamepad MOVE_* bindings both
    // contribute to the held-action sets; reading via _isHeld unifies
    // them. Analog stick magnitude is then read directly so the
    // player can walk, not just sprint, when leaning the stick partway.
    const move = { x: 0, y: 0 };
    if (this._isHeld(ACTIONS.MOVE_FORWARD))  move.y += 1;
    if (this._isHeld(ACTIONS.MOVE_BACKWARD)) move.y -= 1;
    if (this._isHeld(ACTIONS.MOVE_RIGHT))    move.x += 1;
    if (this._isHeld(ACTIONS.MOVE_LEFT))     move.x -= 1;
    const pads = (navigator.getGamepads ? navigator.getGamepads() : []) || [];
    const pad = Array.from(pads).find(p => p);
    if (pad && pad.axes.length >= 2) {
      const ax = pad.axes[0], ay = pad.axes[1];
      const dz = 0.18;
      if (Math.abs(ax) > dz || Math.abs(ay) > dz) {
        move.x = ax;
        move.y = -ay;  // pad Y is inverted relative to forward
      }
    }

    const sprintHeld = this._isHeld(ACTIONS.SPRINT);
    const crouchHeld = this.crouchToggled;
    const adsFromAction = this._isHeld(ACTIONS.ADS);
    const attackFromAction = this._isHeld(ACTIONS.ATTACK);
    // Currently-held quickslot index (0..3) or -1 if none.
    // Used by the throwable arc-preview hold/release flow in main.
    let actionSlotHeld = -1;
    if      (this._isHeld(ACTIONS.QUICKSLOT_1)) actionSlotHeld = 0;
    else if (this._isHeld(ACTIONS.QUICKSLOT_2)) actionSlotHeld = 1;
    else if (this._isHeld(ACTIONS.QUICKSLOT_3)) actionSlotHeld = 2;
    else if (this._isHeld(ACTIONS.QUICKSLOT_4)) actionSlotHeld = 3;

    const out = {
      move,
      sprintHeld,
      crouchHeld,
      spacePressed: this.spacePressed,
      spaceDoublePressed: this.spaceDoublePressed,
      crouchPressed: this.crouchPressed,
      attackPressed: this.attackPressed,
      attackHeld: this.mouseButtons.has(0) || attackFromAction,
      adsHeld: this.mouseButtons.has(2) || adsFromAction,
      interactPressed: this.interactPressed,
      meleePressed: this.meleePressed,
      inventoryToggled: this.inventoryToggled,
      perksToggled: this.perksToggled,
      menuToggled: this.menuToggled,
      reloadPressed: this.reloadPressed,
      lightToggled: this.lightToggled,
      healPressed: this.healPressed,
      actionSlotPressed: this.actionSlotPressed,
      actionSlotHeld,
      weaponSwitch: this.weaponSwitch,
      weaponCycle: this.weaponCycle,
      handednessToggle: this.handednessToggle,
      lootAllPressed: this.lootAllPressed,
    };

    this.spacePressed = false;
    this.spaceDoublePressed = false;
    this.crouchPressed = false;
    this.attackPressed = false;
    this.interactPressed = false;
    this.meleePressed = false;
    this.inventoryToggled = false;
    this.perksToggled = false;
    this.menuToggled = false;
    this.reloadPressed = false;
    this.lightToggled = false;
    this.healPressed = false;
    this.actionSlotPressed = -1;
    this.weaponSwitch = null;
    this.weaponCycle = false;
    this.handednessToggle = false;
    this.lootAllPressed = false;
    return out;
  }
}
