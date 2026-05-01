// Cloudflare Durable Object — one instance per coop room.
//
// Responsibility: WebSocket fanout + lobby state. NOT the game
// simulation — host-peer is authoritative for gameplay state.
// This object tracks who's in the room, broadcasts messages between
// peers, and handles host migration if the host disconnects.
//
// Protocol (JSON over text frames):
//   { v: 1, t: 'hello',    seq: N, peerId, name }
//   { v: 1, t: 'welcome',  roomId, you: peerId, host: peerId, peers: [{id,name}] }
//   { v: 1, t: 'peer-in',  peer: {id, name} }
//   { v: 1, t: 'peer-out', peer: {id, name}, reason }
//   { v: 1, t: 'host',     host: peerId }                      // host migration
//   { v: 1, t: 'msg',      from: peerId, to: peerId|null, body, kind }
//   { v: 1, t: 'ping',     ts }                                // client → server keepalive
//   { v: 1, t: 'pong',     ts }                                // server → client
//   { v: 1, t: 'error',    code, message }
//
// `kind` is the application-level message tag — e.g. 'pos', 'input',
// 'snapshot', 'chat'. The relay doesn't interpret bodies; that's the
// game client's job. Versioning via `v` so we can change the wire
// format without breaking older clients.

const PROTOCOL_VERSION = 1;
const MAX_PEERS_PER_ROOM = 4;
const IDLE_TIMEOUT_MS = 60_000;        // disconnect peers idle this long
const HEARTBEAT_INTERVAL_MS = 15_000;  // server-side ping cadence

export class CoopRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Map<peerId, { ws, name, lastSeen }>
    this.peers = new Map();
    this.hostId = null;
    this.roomId = null;          // assigned on first hello
    this._heartbeatT = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const upgrade = request.headers.get('Upgrade');
    if (upgrade !== 'websocket') {
      return new Response('expected websocket', { status: 400 });
    }
    // Pull room metadata from the URL — the parent worker rewrites
    // /coop/host and /coop/join/:code into ?roomId=…&peerId=…&name=….
    this.roomId = url.searchParams.get('roomId') || this.roomId || 'unknown';
    const peerId = url.searchParams.get('peerId') || _randomPeerId();
    const name = (url.searchParams.get('name') || 'anon').slice(0, 24);

    // Capacity gate.
    if (this.peers.size >= MAX_PEERS_PER_ROOM) {
      return new Response('room full', { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    // First peer becomes host. Host migration on host disconnect.
    if (!this.hostId || !this.peers.has(this.hostId)) {
      this.hostId = peerId;
    }

    this.peers.set(peerId, { ws: server, name, lastSeen: Date.now() });

    // Welcome the joining peer.
    this._send(server, {
      v: PROTOCOL_VERSION,
      t: 'welcome',
      roomId: this.roomId,
      you: peerId,
      host: this.hostId,
      peers: [...this.peers.entries()].map(([id, p]) => ({ id, name: p.name })),
    });
    // Announce to everyone else.
    this._broadcast({
      v: PROTOCOL_VERSION,
      t: 'peer-in',
      peer: { id: peerId, name },
    }, peerId);

    server.addEventListener('message', (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); }
      catch (_) {
        return this._send(server, { v: PROTOCOL_VERSION, t: 'error', code: 'parse', message: 'bad json' });
      }
      const peer = this.peers.get(peerId);
      if (peer) peer.lastSeen = Date.now();
      this._handle(peerId, msg);
    });

    const onClose = () => this._dropPeer(peerId, 'close');
    server.addEventListener('close', onClose);
    server.addEventListener('error', onClose);

    // Lazy-start the server heartbeat so empty rooms cost nothing.
    if (!this._heartbeatT) {
      this._heartbeatT = setInterval(() => this._heartbeat(), HEARTBEAT_INTERVAL_MS);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  _handle(peerId, msg) {
    if (!msg || msg.v !== PROTOCOL_VERSION) return;
    switch (msg.t) {
      case 'ping': {
        const peer = this.peers.get(peerId);
        if (peer) this._send(peer.ws, { v: PROTOCOL_VERSION, t: 'pong', ts: msg.ts });
        return;
      }
      case 'msg': {
        // Application-layer relay. `to` null means broadcast to
        // everyone except sender. Sender is stamped server-side so
        // clients can't spoof the from field.
        const out = {
          v: PROTOCOL_VERSION, t: 'msg',
          from: peerId,
          to: msg.to ?? null,
          kind: msg.kind || 'unknown',
          body: msg.body,
        };
        if (msg.to) {
          const target = this.peers.get(msg.to);
          if (target) this._send(target.ws, out);
        } else {
          this._broadcast(out, peerId);
        }
        return;
      }
      default:
        // Unknown — silently drop. Forward-compat for future client
        // message types we haven't taught the server about.
    }
  }

  _dropPeer(peerId, reason) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    try { peer.ws.close(); } catch (_) {}
    this._broadcast({
      v: PROTOCOL_VERSION, t: 'peer-out',
      peer: { id: peerId, name: peer.name }, reason,
    });
    // Host migration — promote the lowest-ID remaining peer.
    if (this.hostId === peerId) {
      const next = [...this.peers.keys()].sort()[0] || null;
      this.hostId = next;
      if (next) {
        this._broadcast({ v: PROTOCOL_VERSION, t: 'host', host: next });
      }
    }
    // Stop heartbeat if room is empty.
    if (!this.peers.size && this._heartbeatT) {
      clearInterval(this._heartbeatT);
      this._heartbeatT = null;
    }
  }

  _heartbeat() {
    const now = Date.now();
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > IDLE_TIMEOUT_MS) {
        this._dropPeer(id, 'idle');
        continue;
      }
      // Server-driven keepalive — clients echo as 'pong'.
      this._send(peer.ws, { v: PROTOCOL_VERSION, t: 'ping', ts: now });
    }
  }

  _broadcast(msg, exceptPeerId = null) {
    const text = JSON.stringify(msg);
    for (const [id, peer] of this.peers) {
      if (id === exceptPeerId) continue;
      try { peer.ws.send(text); } catch (_) { /* dropped on next heartbeat */ }
    }
  }

  _send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch (_) { /* socket closed */ }
  }
}

function _randomPeerId() {
  // Crypto-random 8-char id. Cheap; collision odds inside a 4-peer
  // room are astronomical so we don't bother retrying.
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}
