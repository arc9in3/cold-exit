import * as THREE from 'three';
import { tunables } from './tunables.js';

// Centralised input. Buffers edge events (space/ctrl/E presses, mouse clicks)
// so the game loop can consume them once per frame, and exposes held-state for
// movement. Raw mouseNDC + a reusable raycaster are exposed for richer aim
// resolution in main.
export class Input {
  constructor(domEl, camera, groundPlane) {
    this.dom = domEl;
    this.camera = camera;
    this.plane = groundPlane;
    this.raycaster = new THREE.Raycaster();
    this.mouseNDC = new THREE.Vector2(0, 0);
    this.hasAim = false;

    this.keys = new Set();
    this.mouseButtons = new Set();

    // Edge events consumed once per frame.
    this.spacePressed = false;
    this.spaceDoublePressed = false;
    this.crouchPressed = false;
    this.crouchToggled = false;       // toggle state flipped on every C tap
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
    this.lastSpaceTime = -999;

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
    // Capture mouseup on window rather than the canvas so a release
    // that happens OVER a modal overlay still clears the held-state.
    // Prior canvas-only binding let a popup (level-up draft, looting,
    // etc.) swallow the release and leave attackHeld / adsHeld stuck
    // true indefinitely.
    window.addEventListener('mouseup', this._onMouseUp);
    // Block the browser context menu anywhere in the tab — the game
    // uses RMB for ADS and having the menu pop up mid-aim was jarring.
    // Canvas-only binding let modal overlays leak RMB back to the OS.
    window.addEventListener('contextmenu', this._onContextMenu);
  }

  // Force-clear transient click state. Call when opening a modal /
  // popup so a click that *triggers* the popup doesn't also register
  // as a game attack, and a stuck button from focus shenanigans can
  // be reset manually.
  clearMouseState() {
    this.mouseButtons.clear();
    this.attackPressed = false;
  }

  _onKeyDown(e) {
    if (e.repeat) return;

    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) {
      e.preventDefault();
    }

    if (e.code === 'Space') {
      const now = performance.now() / 1000;
      if (now - this.lastSpaceTime <= tunables.dash.doubleTapWindow) {
        this.spaceDoublePressed = true;
      } else {
        this.spacePressed = true;
      }
      this.lastSpaceTime = now;
    }

    // Crouch is a toggle on C — press once to crouch, again to stand.
    if (e.code === 'KeyC') {
      this.crouchPressed = true;
      this.crouchToggled = !this.crouchToggled;
      e.preventDefault();
    }

    if (e.code === 'KeyE') {
      this.interactPressed = true;
      e.preventDefault();
    }

    if (e.code === 'KeyF') {
      this.meleePressed = true;
      e.preventDefault();
    }

    if (e.code.startsWith('Digit') || e.code.startsWith('Numpad')) {
      const suffix = e.code.startsWith('Digit') ? e.code.slice(5) : e.code.slice(6);
      const n = parseInt(suffix, 10);
      if (n >= 5 && n <= 8) {
        this.actionSlotPressed = n - 5;
        e.preventDefault();
      } else if (n >= 1 && n <= 4) {
        this.weaponSwitch = n - 1;
        e.preventDefault();
      }
    }

    // Q swaps the player's firing shoulder (right-handed ↔ left-handed)
    // so players can peek/fire around a corner from either side.
    if (e.code === 'KeyQ') {
      this.handednessToggle = true;
      e.preventDefault();
    }
    // Weapon cycle moved to X so Q is free for shoulder swap.
    if (e.code === 'KeyX') {
      this.weaponCycle = true;
      e.preventDefault();
    }

    if (e.code === 'Tab') {
      this.inventoryToggled = true;
      e.preventDefault();
    }

    if (e.code === 'KeyK') {
      this.perksToggled = true;
      e.preventDefault();
    }

    if (e.code === 'Escape') {
      this.menuToggled = true;
      e.preventDefault();
    }

    if (e.code === 'KeyR') {
      this.reloadPressed = true;
      e.preventDefault();
    }

    if (e.code === 'KeyT') {
      this.lightToggled = true;
      e.preventDefault();
    }

    if (e.code === 'KeyH') {
      this.healPressed = true;
      e.preventDefault();
    }

    this.keys.add(e.code);
  }

  _onKeyUp(e) { this.keys.delete(e.code); }
  _onBlur() { this.keys.clear(); this.mouseButtons.clear(); }

  _onMouseMove(e) {
    const rect = this.dom.getBoundingClientRect();
    this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.hasAim = true;
  }

  _onMouseDown(e) {
    this.mouseButtons.add(e.button);
    if (e.button === 0) this.attackPressed = true;
  }
  _onMouseUp(e) { this.mouseButtons.delete(e.button); }

  // Raycast the cursor against the given meshes; fall back to the ground plane.
  // Returns { point, zone, owner } — zone/owner are null on non-body hits.
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

  sample() {
    const move = { x: 0, y: 0 };
    if (this.keys.has('KeyW')) move.y += 1;
    if (this.keys.has('KeyS')) move.y -= 1;
    if (this.keys.has('KeyD')) move.x += 1;
    if (this.keys.has('KeyA')) move.x -= 1;

    const sprintHeld = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const crouchHeld = this.crouchToggled;

    const out = {
      move,
      sprintHeld,
      crouchHeld,
      spacePressed: this.spacePressed,
      spaceDoublePressed: this.spaceDoublePressed,
      crouchPressed: this.crouchPressed,
      attackPressed: this.attackPressed,
      attackHeld: this.mouseButtons.has(0),
      adsHeld: this.mouseButtons.has(2),
      interactPressed: this.interactPressed,
      meleePressed: this.meleePressed,
      inventoryToggled: this.inventoryToggled,
      perksToggled: this.perksToggled,
      menuToggled: this.menuToggled,
      reloadPressed: this.reloadPressed,
      lightToggled: this.lightToggled,
      healPressed: this.healPressed,
      actionSlotPressed: this.actionSlotPressed,
      weaponSwitch: this.weaponSwitch,
      weaponCycle: this.weaponCycle,
      handednessToggle: this.handednessToggle,
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
    return out;
  }
}
