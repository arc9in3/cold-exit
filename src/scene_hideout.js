// Diegetic hideout scene — a small 3D interior the player visits
// between runs. Each tab in the hideout panel maps to a "station"
// (a camera pose anchored at one corner of the interior). Clicking
// a tab lerps the camera over ~0.6s; the 2D panel UI floats on top
// of the 3D backdrop.
//
// REUSES the game's WebGLRenderer + canvas. main.js passes both in;
// when the hideout is visible, main.js's tick calls hideoutScene.update()
// instead of (or alongside) the game scene render. Avoids a second
// GL context — that pattern broke boot on multi-renderer setups.
//
// Stations:
//   contracts     — pinboard with photos + a desk (lobby pose)
//   stash         — gun room with FBX weapons on the wall + lockers
//   quartermaster — desk + crates
//   vendors       — lockup with rolled merchandise
//   recruiter     — single chair facing a bare wall
//   tailor        — full-body mirror + sewing dummy
//   mailbox       — row of P.O. boxes
//   exit-door     — the run-start fade-out target
//
// Locked stations render dark (no lights) and prop-empty until
// unlock predicates promote them. The unlock check is read-once at
// scene-build time and re-checked on every show() call.

import * as THREE from 'three';

// Camera poses per station — { position, lookAt }. Tuned so each
// station fills the upper portion of the screen with NPC/prop while
// the bottom 1/3 is unobstructed for the 2D panel UI.
const STATION_POSES = {
  contracts: {
    position: new THREE.Vector3(0, 2.4, 4.5),
    lookAt:   new THREE.Vector3(0, 1.6, 0),
  },
  stash: {
    position: new THREE.Vector3(-6, 2.4, 4.5),
    lookAt:   new THREE.Vector3(-6, 1.6, 0),
  },
  quartermaster: {
    position: new THREE.Vector3(6, 2.4, 4.5),
    lookAt:   new THREE.Vector3(6, 1.6, 0),
  },
  vendors: {
    position: new THREE.Vector3(-12, 2.4, 4.5),
    lookAt:   new THREE.Vector3(-12, 1.6, 0),
  },
  recruiter: {
    position: new THREE.Vector3(12, 2.4, 4.5),
    lookAt:   new THREE.Vector3(12, 1.6, 0),
  },
  tailor: {
    position: new THREE.Vector3(0, 2.4, -4.5),
    lookAt:   new THREE.Vector3(0, 1.6, -8),
  },
  mailbox: {
    position: new THREE.Vector3(-6, 2.4, -4.5),
    lookAt:   new THREE.Vector3(-6, 1.6, -8),
  },
  exitDoor: {
    position: new THREE.Vector3(0, 1.8, 8),
    lookAt:   new THREE.Vector3(0, 1.6, 14),
  },
};

// Station unlock predicates. Empty function = always unlocked. The
// scene re-evaluates these on every show() so progression unlocks
// the relevant station the next time the player opens the hideout.
//
// At-launch: contracts + stash always available. Quartermaster + the
// rest gated to give the "the room brightens up" beat.
const STATION_UNLOCKS = {
  contracts: () => true,
  stash: () => true,
  quartermaster: ({ runCount }) => (runCount | 0) >= 1,
  vendors: ({ contractRank }) => (contractRank | 0) >= 3,
  recruiter: ({ marks }) => (marks | 0) > 0,
  tailor: ({ runCount }) => (runCount | 0) >= 2,
  mailbox: ({ unlocks }) => !!unlocks?.mailboxUnlocked,
};

export class HideoutScene {
  // Shares the game's renderer. Caller passes { renderer } so we
  // don't spin up a second GL context. Rendering happens via the
  // shared renderer; main.js controls when (game-scene vs
  // hideout-scene swap) based on hideoutUI.visible.
  constructor({ renderer } = {}) {
    if (!renderer) throw new Error('HideoutScene needs the shared renderer');
    this.renderer = renderer;
    this.visible = false;
    this.stationId = 'contracts';
    this._activePose = STATION_POSES.contracts;
    this._lerpFromPos = STATION_POSES.contracts.position.clone();
    this._lerpFromLook = STATION_POSES.contracts.lookAt.clone();
    this._lerpToPos = STATION_POSES.contracts.position.clone();
    this._lerpToLook = STATION_POSES.contracts.lookAt.clone();
    this._lerpT = 1;          // 0..1; 1 = settled at target
    this._lerpDuration = 0.6;
    this._lookHelper = new THREE.Vector3();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c12);
    this.scene.fog = new THREE.Fog(0x0a0c12, 6, 24);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 60);
    this._applyPose(this._activePose);

    // Scene root — interior box + per-station prop groups.
    this._stations = {};        // { id: THREE.Group }
    this._stationLights = {};   // { id: THREE.Light[] }
    this._buildInterior();
    this._buildStations();

    // Resize handling — only the camera aspect needs updating; the
    // renderer's size is owned by the host.
    this._onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', this._onResize);
  }

  // Build the interior shell — one big U-shape so the camera can pan
  // across the long axis between stations. Walls are stripped boxes
  // with subtle albedo shading; the floor is a single dark plane.
  _buildInterior() {
    const room = new THREE.Group();
    // Floor — long axis runs east-west so stations line up along it.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 24),
      new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    room.add(floor);

    // Back wall.
    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 6),
      new THREE.MeshStandardMaterial({ color: 0x14171e, roughness: 0.9 })
    );
    backWall.position.set(0, 3, -12);
    room.add(backWall);

    // Side walls.
    for (const x of [-20, 20]) {
      const w = new THREE.Mesh(
        new THREE.PlaneGeometry(24, 6),
        new THREE.MeshStandardMaterial({ color: 0x14171e, roughness: 0.9 })
      );
      w.position.set(x, 3, 0);
      w.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
      room.add(w);
    }

    // Ambient + a global fill so even unlit stations are barely
    // visible. Locked stations sit in this fill alone — bright
    // enough to read the silhouette, dim enough to read as "dark."
    this.scene.add(new THREE.AmbientLight(0x404048, 0.4));
    const fill = new THREE.DirectionalLight(0x6080a0, 0.25);
    fill.position.set(0, 10, 5);
    this.scene.add(fill);

    this.scene.add(room);
  }

  // Per-station decoration. Minimal: a colored placeholder box per
  // station + a local spotlight that brightens when the station is
  // unlocked. No FBX loading, no canvas-text sprites — those were
  // adding init time that contributed to a boot hang. Real props
  // can be layered on once we confirm the basic scene boots clean.
  _buildStations() {
    for (const id of Object.keys(STATION_POSES)) {
      const pose = STATION_POSES[id];
      const group = new THREE.Group();
      group.position.copy(pose.lookAt).setY(0);

      // Placeholder geometry — color-tagged per station so each
      // station is at least visually distinct even pre-content.
      const stationColor = ({
        contracts:     0xc9a87a,
        stash:         0x6abf78,
        quartermaster: 0x5a8acf,
        vendors:       0xb87830,
        recruiter:     0xd24868,
        tailor:        0xb870e0,
        mailbox:       0x9b8b6a,
        exitDoor:      0xf2c060,
      })[id] || 0x2a2f3a;
      const tag = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 2.0, 0.6),
        new THREE.MeshStandardMaterial({
          color: stationColor,
          roughness: 0.85,
          emissive: stationColor,
          emissiveIntensity: 0.05,
        })
      );
      tag.position.y = 1;
      group.add(tag);

      // Local spotlight — gives the station "lit" feel when unlocked.
      const spot = new THREE.SpotLight(0xffe0a0, 0, 10, Math.PI / 4, 0.6, 1);
      spot.position.copy(pose.lookAt).setY(4);
      spot.target.position.copy(pose.lookAt);
      group.add(spot);
      group.add(spot.target);
      this._stationLights[id] = [spot];

      this.scene.add(group);
      this._stations[id] = group;
    }
    this._refreshLockedStations();
  }

  // Re-evaluate unlock predicates and toggle visibility / lighting.
  // Called on show() and after any progress that might unlock a
  // station (chip purchase, contract claim, etc.). Locked stations
  // dim their spot, dim their materials, and gate label opacity so
  // the player gets a clear "the room brightens up" beat as they
  // unlock more.
  _refreshLockedStations(state = {}) {
    for (const id of Object.keys(STATION_POSES)) {
      const unlocked = STATION_UNLOCKS[id] ? STATION_UNLOCKS[id](state) : true;
      const grp = this._stations[id];
      if (!grp) continue;
      grp.visible = true;
      // Spotlight intensity.
      const lights = this._stationLights[id] || [];
      for (const l of lights) l.intensity = unlocked ? 1.2 : 0;
      // Material dim — walk the group's children and scale color
      // intensity. Locked stations dim to 25% of original color so
      // the placeholder box reads as "in shadow."
      grp.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            if (m._origColor === undefined && m.color) m._origColor = m.color.clone();
            if (m.color && m._origColor) {
              if (unlocked) m.color.copy(m._origColor);
              else m.color.copy(m._origColor).multiplyScalar(0.25);
            }
          }
        }
      });
    }
  }

  show(state = {}) {
    this.visible = true;
    this._refreshLockedStations(state);
    this.gotoStation(this.stationId, true);
  }

  hide() {
    this.visible = false;
  }

  // Switch active station. `instant: true` snaps the camera; otherwise
  // lerps over ~0.6s.
  gotoStation(id, instant = false) {
    const pose = STATION_POSES[id];
    if (!pose) return;
    this.stationId = id;
    if (instant) {
      this._activePose = pose;
      this._applyPose(pose);
      this._lerpT = 1;
      return;
    }
    this._lerpFromPos.copy(this.camera.position);
    this._lerpFromLook.copy(this._lookHelper);
    this._lerpToPos.copy(pose.position);
    this._lerpToLook.copy(pose.lookAt);
    this._lerpT = 0;
  }

  _applyPose(pose) {
    this.camera.position.copy(pose.position);
    this.camera.lookAt(pose.lookAt);
    this._lookHelper.copy(pose.lookAt);
  }

  // Per-frame tick. Drives the camera lerp + redraw. Caller invokes
  // from a rAF loop while the hideout is open. Wrapped in try/catch
  // so a single per-frame error doesn't freeze the page.
  update(dt) {
    if (!this.visible) return;
    try {
      if (this._lerpT < 1) {
        this._lerpT = Math.min(1, this._lerpT + (dt / this._lerpDuration));
        const t = this._lerpT * this._lerpT * (3 - 2 * this._lerpT);
        this.camera.position.lerpVectors(this._lerpFromPos, this._lerpToPos, t);
        this._lookHelper.lerpVectors(this._lerpFromLook, this._lerpToLook, t);
        this.camera.lookAt(this._lookHelper);
      }
      this.renderer.render(this.scene, this.camera);
    } catch (e) {
      // One log + disable to prevent log-spam from a stuck error.
      if (!this._renderErrLogged) {
        console.warn('[hideout-scene] render failed, disabling scene:', e);
        this._renderErrLogged = true;
        this.hide();
      }
    }
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    // Don't dispose the renderer — it's shared with the main game.
  }
}
