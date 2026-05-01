// Coop lobby overlay — host/join UI + connected-peer list.
//
// Behind a feature flag (URL `?coop=1` or localStorage `coop:enabled`).
// Currently a standalone overlay rather than a hideout tab so we can
// iterate on it without touching the hideout's tab framework. Promote
// to a hideout tab once the protocol stabilises.
//
// The lobby owns:
//   - host / join flow (calls into CoopTransport)
//   - shareable URL with `?room=ABC123` for the host to copy
//   - peer-list rendering
//   - a tiny ghost-echo demo so two clients can verify the wire works
//
// The ghost-echo demo broadcasts the local player's XZ position at
// 5Hz under kind='pos'. Receivers spawn a translucent ghost mesh per
// remote peer and lerp it toward the latest received position. This
// is THROWAWAY scaffolding — once authoritative-sim work lands, it
// gets replaced by snapshot-driven rendering.

import { getCoopTransport } from './transport.js';

export function isCoopEnabled() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('coop') === '1') return true;
    return localStorage.getItem('coop:enabled') === '1';
  } catch (_) { return false; }
}

export function enableCoop(on = true) {
  try { localStorage.setItem('coop:enabled', on ? '1' : '0'); } catch (_) {}
}

export class CoopLobbyUI {
  constructor({ getPlayerName }) {
    this.getPlayerName = getPlayerName || (() => 'anon');
    this.transport = getCoopTransport();
    this.visible = false;
    this.root = null;
    this.statusEl = null;
    this.peerListEl = null;
    this.codeEl = null;
    this.msgEl = null;
    // ghosts: peerId → { x, z, targetX, targetZ } updated from 'pos' msgs
    this.ghosts = new Map();
    this._buildDom();
    this._wireTransport();
  }

  show() {
    if (!this.root) return;
    this.visible = true;
    this.root.style.display = 'flex';
    this._refresh();
  }
  hide() {
    if (!this.root) return;
    this.visible = false;
    this.root.style.display = 'none';
  }
  isOpen() { return this.visible; }

  _buildDom() {
    if (document.getElementById('coop-lobby-style')) return;
    const style = document.createElement('style');
    style.id = 'coop-lobby-style';
    style.textContent = `
      #coop-lobby-root {
        position: fixed; inset: 0; z-index: 80;
        background: rgba(0,0,0,0.78);
        display: none; align-items: center; justify-content: center;
        font-family: ui-monospace, Menlo, Consolas, monospace;
        color: #e8dfc8;
      }
      #coop-lobby-card {
        min-width: 420px; max-width: 580px;
        background: linear-gradient(180deg, #1a1d24, #0c0e14);
        border: 1px solid #2a4a6e; border-radius: 6px;
        padding: 22px 28px;
        box-shadow: 0 16px 48px rgba(0,0,0,0.7);
      }
      #coop-lobby-card h2 {
        margin: 0 0 12px; font-size: 16px; letter-spacing: 4px;
        color: #a0c0ff; text-shadow: 0 0 10px rgba(120,180,255,0.35);
      }
      #coop-lobby-card .row { display: flex; gap: 8px; margin-top: 10px; align-items: center; }
      #coop-lobby-card input {
        flex: 1; background: #0c0e14; border: 1px solid #2a2f3a;
        color: #e8dfc8; padding: 7px 10px; font: inherit; font-size: 13px;
        letter-spacing: 1.5px; text-transform: uppercase;
        border-radius: 3px;
      }
      #coop-lobby-card button {
        background: linear-gradient(180deg, #2a4a6e, #1e3450);
        border: 1px solid #5a8acf; color: #e8dfc8;
        padding: 7px 14px; font: inherit; font-size: 12px;
        letter-spacing: 1.2px; cursor: pointer; border-radius: 3px;
        text-transform: uppercase;
      }
      #coop-lobby-card button:disabled { opacity: 0.5; cursor: default; }
      #coop-lobby-card .muted { color: #6f7990; font-size: 11px; }
      #coop-lobby-card .status {
        margin-top: 14px; padding: 8px 10px;
        background: #0c0e14; border-left: 3px solid #6abf78;
        font-size: 11px; color: #a0c0a0; min-height: 22px;
      }
      #coop-lobby-card .status.bad { border-left-color: #cf5a5a; color: #f0a0a0; }
      #coop-lobby-card .code {
        font-size: 28px; font-weight: 700; letter-spacing: 8px;
        color: #f2c060; text-shadow: 0 0 12px rgba(255,200,80,0.5);
        text-align: center; padding: 12px 0;
      }
      #coop-lobby-card .peers {
        margin-top: 12px; padding: 8px 10px; background: #0c0e14;
        border: 1px solid #2a2f3a; border-radius: 3px;
        max-height: 140px; overflow-y: auto; font-size: 12px;
      }
      #coop-lobby-card .peers .peer { padding: 3px 0; }
      #coop-lobby-card .peers .peer.host { color: #f2c060; }
      #coop-lobby-card .peers .peer.you::after { content: ' (you)'; color: #6f7990; }
      #coop-lobby-card .footer {
        display: flex; justify-content: space-between; margin-top: 16px;
        font-size: 10px; color: #6f7990; letter-spacing: 1px;
      }
    `;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'coop-lobby-root';
    root.innerHTML = `
      <div id="coop-lobby-card">
        <h2>CO-OP LOBBY</h2>
        <div class="muted">Up to 4 players. Server-authoritative relay; one peer hosts the simulation.</div>
        <div class="row">
          <button id="coop-host">Host new room</button>
          <span class="muted" style="flex:1;text-align:center">— or —</span>
        </div>
        <div class="row">
          <input id="coop-code" placeholder="Enter room code" maxlength="6" />
          <button id="coop-join">Join</button>
        </div>
        <div class="code" id="coop-code-display"></div>
        <div class="peers" id="coop-peer-list"><div class="muted">Not connected.</div></div>
        <div class="status" id="coop-status">Idle.</div>
        <div class="footer">
          <span id="coop-rtt">—</span>
          <span style="display:flex; gap:6px;">
            <button id="coop-hide" title="Close this overlay; stay connected">Hide (Shift+C)</button>
            <button id="coop-leave" title="Disconnect from the room">Disconnect</button>
          </span>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;
    this.statusEl = root.querySelector('#coop-status');
    this.peerListEl = root.querySelector('#coop-peer-list');
    this.codeEl = root.querySelector('#coop-code-display');
    this.rttEl = root.querySelector('#coop-rtt');

    root.querySelector('#coop-host').addEventListener('click', () => this._host());
    root.querySelector('#coop-join').addEventListener('click', () => {
      const code = root.querySelector('#coop-code').value.trim().toUpperCase();
      if (code.length !== 6) {
        this._setStatus('Room codes are 6 characters.', true);
        return;
      }
      this._join(code);
    });
    // Hide leaves the WebSocket open — players can dismiss the overlay
    // and start a run without dropping the room. Disconnect explicitly
    // tears down the transport for "I'm done with co-op for now".
    root.querySelector('#coop-hide').addEventListener('click', () => this.hide());
    root.querySelector('#coop-leave').addEventListener('click', () => {
      this.transport.close();
      this.hide();
    });

    // If the URL carries ?room=ABC123, autofill the join field so
    // shared invite links open straight into the picker.
    try {
      const params = new URLSearchParams(window.location.search);
      const room = params.get('room');
      if (room) {
        const input = root.querySelector('#coop-code');
        if (input) input.value = room.toUpperCase();
      }
    } catch (_) {}
  }

  _wireTransport() {
    const t = this.transport;
    t.addEventListener('open', (e) => {
      const d = e.detail;
      this._setStatus(`Connected to room ${d.roomId} as ${t.isHost ? 'host' : 'joiner'}.`);
      this._setCode(d.roomId);
      this._refreshPeers();
    });
    t.addEventListener('peer-in', () => this._refreshPeers());
    t.addEventListener('peer-out', (e) => {
      this._setStatus(`Peer left (${e.detail.reason || 'disconnect'}).`);
      this._refreshPeers();
      this.ghosts.delete(e.detail.peer?.id);
    });
    t.addEventListener('host', (e) => {
      this._setStatus(`Host migrated to ${e.detail.host}.`);
      this._refreshPeers();
    });
    t.addEventListener('rtt', (e) => {
      if (this.rttEl) this.rttEl.textContent = `RTT ${e.detail.rtt}ms`;
    });
    t.addEventListener('close', () => {
      this._setStatus('Disconnected.');
      this.ghosts.clear();
    });
    t.addEventListener('error', (e) => this._setStatus(`Error: ${e.detail.message}`, true));

    // Echo demo — receive 'pos' messages and feed the ghost map.
    // Handed to main.js via `consumePosUpdate` so the actual scene
    // mesh creation happens where Three.js + camera are wired up.
    t.addEventListener('msg', (e) => {
      const { kind, from, body } = e.detail;
      if (kind === 'pos' && body && typeof body.x === 'number' && typeof body.z === 'number') {
        this.ghosts.set(from, {
          x: body.x, z: body.z,
          name: this.transport.peers.get(from)?.name || 'peer',
          ts: performance.now(),
        });
      }
    });
  }

  async _host() {
    const name = (this.getPlayerName() || 'anon').slice(0, 24);
    this._setStatus('Hosting…');
    try {
      const code = await this.transport.host(name);
      // Drop a shareable URL into clipboard if the browser supports it.
      const url = `${window.location.origin}${window.location.pathname}?coop=1&room=${code}`;
      try { await navigator.clipboard.writeText(url); } catch (_) {}
      this._setStatus(`Room created. Share URL copied to clipboard.`);
    } catch (e) {
      this._setStatus(`Host failed: ${e.message}`, true);
    }
  }

  async _join(code) {
    const name = (this.getPlayerName() || 'anon').slice(0, 24);
    this._setStatus(`Joining ${code}…`);
    try {
      await this.transport.join(code, name);
    } catch (e) {
      this._setStatus(`Join failed: ${e.message}`, true);
    }
  }

  _refreshPeers() {
    if (!this.peerListEl) return;
    if (!this.transport.isOpen) {
      this.peerListEl.innerHTML = '<div class="muted">Not connected.</div>';
      return;
    }
    const out = [];
    for (const peer of this.transport.peers.values()) {
      const cls = ['peer'];
      if (peer.id === this.transport.hostId) cls.push('host');
      if (peer.id === this.transport.peerId) cls.push('you');
      out.push(`<div class="${cls.join(' ')}">${_esc(peer.name)} <span class="muted">${peer.id}</span></div>`);
    }
    this.peerListEl.innerHTML = out.join('') || '<div class="muted">No peers.</div>';
  }

  _refresh() { this._refreshPeers(); }

  _setStatus(msg, bad = false) {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('bad', !!bad);
  }

  _setCode(code) {
    if (!this.codeEl) return;
    this.codeEl.textContent = code || '';
  }
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
