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
// Per-connection message cap. Snapshots are ~1-3KB; well under this.
// Anything bigger is malformed or malicious.
const MAX_MESSAGE_BYTES = 64 * 1024;
// Per-connection rate limit (token bucket). Game traffic peaks at
// ~25 msg/s/peer (5Hz pos + 20Hz snapshots only on host). 200/s gives
// 8× headroom; sustained floods get rejected + counted toward kick.
const RATE_BUCKET_CAPACITY = 200;
const RATE_REFILL_PER_SEC = 200;
const RATE_KICK_OVERFLOW = 50;          // accumulate this many over-cap msgs → kick

// Server-side authorization for application-layer message kinds.
// Each kind names which role(s) may originate it. The server stamps
// `from` so peers can't spoof identity, but kind-routing also has to
// be enforced server-side — otherwise a joiner could send
// `kind: 'rpc-grant-xp'` to themselves and grant infinite XP.
const KIND_ALLOWED_FROM_HOST = new Set([
  'snapshot',
  'level-seed',
  'rpc-grant-item',   // pickup approval
  'rpc-grant-xp',
  'rpc-player-damage',
  'fx-tracer',        // host's AI bullet trace; broadcast for visuals
  'rpc-downed',       // peer entered downed state
  'rpc-revived',      // peer left downed state (revived/full HP)
  'rpc-revive-progress', // periodic broadcast of an active revive bar
]);
const KIND_ALLOWED_FROM_JOINER = new Set([
  'rpc-shoot',
  'rpc-pickup',
  'rpc-drop',
  'rpc-body-take',
  'rpc-revive-hold',  // joiner is holding interact on a downed peer
  'rpc-revive-item',  // joiner used a health item on a downed peer
  'rpc-self-down',    // joiner notifying host they entered downed state
]);
// Free-form kinds anyone may send (no server-side gameplay impact).
const KIND_ALLOWED_FROM_ANY = new Set([
  'pos', 'chat',
]);

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

    this.peers.set(peerId, {
      ws: server, name, lastSeen: Date.now(),
      // Token-bucket state — refilled from `lastSeen` delta in the
      // rate-check path. Bucket starts full so legitimate clients
      // never see a cold-start rejection.
      bucket: RATE_BUCKET_CAPACITY,
      bucketLastRefill: Date.now(),
      overCapCount: 0,
    });

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
      const peer = this.peers.get(peerId);
      if (!peer) return;   // already dropped
      peer.lastSeen = Date.now();
      // Size cap — refuse oversized frames. Cloudflare allows up to
      // 1 MiB per WS message; 64KB is plenty for our shapes.
      const data = evt.data;
      const sz = (typeof data === 'string') ? data.length : (data?.byteLength | 0);
      if (sz > MAX_MESSAGE_BYTES) {
        this._send(server, {
          v: PROTOCOL_VERSION, t: 'error', code: 'too-large',
          message: `message exceeds ${MAX_MESSAGE_BYTES} bytes`,
        });
        return;
      }
      // Rate limit — refill bucket based on elapsed time, then debit.
      // Persistent overflow drops the connection so a flood can't
      // sustain.
      const now = Date.now();
      const dt = (now - peer.bucketLastRefill) / 1000;
      peer.bucket = Math.min(RATE_BUCKET_CAPACITY,
        peer.bucket + dt * RATE_REFILL_PER_SEC);
      peer.bucketLastRefill = now;
      if (peer.bucket < 1) {
        peer.overCapCount += 1;
        if (peer.overCapCount > RATE_KICK_OVERFLOW) {
          this._dropPeer(peerId, 'rate-limit');
        }
        return;
      }
      peer.bucket -= 1;
      peer.overCapCount = Math.max(0, peer.overCapCount - 0.1);

      let msg;
      try { msg = JSON.parse(data); }
      catch (_) {
        return this._send(server, { v: PROTOCOL_VERSION, t: 'error', code: 'parse', message: 'bad json' });
      }
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
        //
        // Server-side kind authorization — the relay knows which
        // role (host vs joiner) is allowed to originate each kind.
        // Without this, a joiner could send `kind:'rpc-grant-xp'`
        // to themselves and grant arbitrary XP, etc. The client-
        // side `transport.isHost` checks are easily bypassed by a
        // modified client; the server is the choke point.
        const kind = msg.kind || 'unknown';
        const senderIsHost = (peerId === this.hostId);
        const isAllowed =
          KIND_ALLOWED_FROM_ANY.has(kind)
          || (senderIsHost && KIND_ALLOWED_FROM_HOST.has(kind))
          || (!senderIsHost && KIND_ALLOWED_FROM_JOINER.has(kind));
        if (!isAllowed) {
          this._send(this.peers.get(peerId)?.ws, {
            v: PROTOCOL_VERSION, t: 'error',
            code: 'forbidden-kind',
            message: `'${kind}' not allowed from this role`,
          });
          return;
        }
        const out = {
          v: PROTOCOL_VERSION, t: 'msg',
          from: peerId,
          to: msg.to ?? null,
          kind,
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
    // Host disconnected — END THE RUN for everyone instead of
    // promoting a new host. Promoting a peer is a fake migration:
    // they don't have the authoritative game state (level seed
    // matches, but enemy positions / loot ownership are host's
    // module-state). Sending a `host` message would silently desync.
    //
    // Better UX: explicit `host-lost` notification + clean room
    // teardown. Each remaining client falls back to single-player
    // (or to the lobby). Real state-handoff is a meaningful
    // refactor we'll address with persistent DO storage when the
    // run-state is small enough to serialize cheaply.
    if (this.hostId === peerId && this.peers.size > 0) {
      this._broadcast({
        v: PROTOCOL_VERSION, t: 'host-lost',
        message: 'host disconnected — run ended',
      });
      // Drop everyone else so they can't keep sending RPCs into a
      // dead room. Clients will reconnect to a fresh room when they
      // host/join again.
      for (const [otherId, otherPeer] of [...this.peers]) {
        try { otherPeer.ws.close(); } catch (_) {}
        this.peers.delete(otherId);
      }
      this.hostId = null;
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
