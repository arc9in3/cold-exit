// Standalone Relics panel — lists every relic the player has acquired
// this run with a thumbnail, the short effect description, and the
// flavor lore. Relics never enter the inventory grid; this is the
// authoritative view of what permanent run modifiers are active.
//
// Opened via the V hotkey or the pause menu. ESC / V again / click
// the backdrop / click Close all dismiss.

import * as THREE from 'three';

const _thumbCache = new Map();

// Render a small offscreen 3D preview of a relic — coloured ring +
// floating glyph, tinted by the artifact's tint hex. Cached per id
// so repeated opens reuse the same data URL.
function _relicThumb(def) {
  if (_thumbCache.has(def.id)) return _thumbCache.get(def.id);
  const SIZE = 96;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
  cam.position.set(0, 0.5, 2.4); cam.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(2, 3, 2); scene.add(key);
  const tint = def.tint ?? 0xc9a87a;
  // Outer torus + inner glowing sphere — reads as a relic / artifact
  // without needing per-relic art.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.12, 12, 32),
    new THREE.MeshStandardMaterial({
      color: tint, roughness: 0.3, metalness: 0.7,
      emissive: new THREE.Color(tint).multiplyScalar(0.25),
    }),
  );
  ring.rotation.x = Math.PI / 4;
  scene.add(ring);
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 18, 14),
    new THREE.MeshStandardMaterial({
      color: tint, roughness: 0.2, metalness: 0.5,
      emissive: new THREE.Color(tint).multiplyScalar(0.6),
    }),
  );
  scene.add(orb);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  try { renderer.forceContextLoss(); } catch (_) {}
  renderer.dispose();
  _thumbCache.set(def.id, url);
  return url;
}

export class RelicsUI {
  constructor({ getRelics }) {
    this.getRelics = getRelics || (() => []);
    this.visible = false;
    this.root = document.createElement('div');
    this.root.id = 'relics-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="relics-card">
        <div id="relics-header">
          <div id="relics-title">Relics</div>
          <button id="relics-close" type="button">✕</button>
        </div>
        <div id="relics-sub">Permanent run modifiers. Pick more up by completing encounters or buying from a Relic Seller.</div>
        <div id="relics-grid"></div>
        <div id="relics-footer">V to toggle · click outside to close</div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.gridEl = this.root.querySelector('#relics-grid');
    this.root.querySelector('#relics-close').addEventListener('click', () => this.hide());
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  toggle() {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'flex' : 'none';
    if (this.visible) this.render();
  }
  hide() { this.visible = false; this.root.style.display = 'none'; }
  isOpen() { return this.visible; }

  render() {
    const list = this.getRelics() || [];
    if (!list.length) {
      this.gridEl.innerHTML = `
        <div class="relics-empty">
          You haven't found any relics yet.
          <br><br>
          Complete encounters or buy from a Relic Seller to grow your collection.
        </div>
      `;
      return;
    }
    const cells = list.map((def) => {
      const thumb = _relicThumb(def);
      const lore = def.lore ? `<div class="relic-cell-lore">"${def.lore}"</div>` : '';
      const desc = def.short || def.description || '';
      return `
        <div class="relic-cell">
          <div class="relic-cell-art"><img src="${thumb}" alt=""></div>
          <div class="relic-cell-body">
            <div class="relic-cell-name">${def.name}</div>
            <div class="relic-cell-desc">${desc}</div>
            ${lore}
          </div>
        </div>
      `;
    });
    this.gridEl.innerHTML = cells.join('');
  }
}
