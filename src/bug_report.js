// bug_report.js — Phase M step 9.
//
// One-key bug capture for stuck-state repros. Bound to `]` (F2 is taken
// by the level-dump dev key). Captures:
//   - run seed (window.__runSeed if set, else level.seed)
//   - level index, level seed, room map summary
//   - player position + room id
//   - all alive gunman / melee positions + state
//   - last input frame (if exposed via window.__lastInputFrame)
//   - base64-encoded canvas screenshot
//
// POSTs to http://localhost:3001/api/bugs/intake (Mission Control
// dashboard). On failure (dashboard offline / CORS / etc.) falls back
// to console.log + clipboard copy.
//
// Idempotent — debounced 3s so accidental key-mash doesn't flood.

const ENDPOINT = 'http://localhost:3001/api/bugs/intake';
const DEBOUNCE_MS = 3000;
let _lastFiredT = 0;

function _capturePayload() {
  const ts = new Date().toISOString();
  const level = (typeof window !== 'undefined') ? window.__level : null;
  const player = (typeof window !== 'undefined') ? window.__player : null;
  const gunmen = (typeof window !== 'undefined') ? window.__gunmen : null;
  const melees = (typeof window !== 'undefined') ? window.__melees : null;
  const runSeed = (typeof window !== 'undefined' && window.__runSeed) || null;

  const playerPos = player?.mesh?.position
    ? { x: +player.mesh.position.x.toFixed(2),
        y: +player.mesh.position.y.toFixed(2),
        z: +player.mesh.position.z.toFixed(2) }
    : null;

  const playerRoomId = (level && playerPos)
    ? (level.roomAt?.(playerPos.x, playerPos.z)?.id ?? null)
    : null;

  const rooms = (level?.rooms || []).map((r, i) => ({
    i,
    id: r.id ?? null,
    type: r.type || null,
    shape: r.shape || null,
    layout: r.layout || null,
    cleared: !!r.cleared,
    sealed: !!r._sealed,
    sealReleased: !!r._sealReleased,
    bounds: r.bounds ? {
      minX: +r.bounds.minX.toFixed(2), maxX: +r.bounds.maxX.toFixed(2),
      minZ: +r.bounds.minZ.toFixed(2), maxZ: +r.bounds.maxZ.toFixed(2),
    } : null,
    neighbors: (r.neighbors || []).map(n => ({ otherId: n.otherId, dir: n.dir })),
  }));

  const gunmenSnap = (gunmen?.gunmen || [])
    .filter(g => g.alive)
    .map(g => ({
      pos: g.group ? {
        x: +g.group.position.x.toFixed(2),
        z: +g.group.position.z.toFixed(2),
      } : null,
      state: g.state || null,
      tier: g.tier || null,
      roomId: g.roomId ?? null,
      hp: g.hp ?? null,
      aware: !!g.aware,
    }));

  const meleesSnap = (melees?.enemies || [])
    .filter(m => m.alive)
    .map(m => ({
      pos: m.group ? {
        x: +m.group.position.x.toFixed(2),
        z: +m.group.position.z.toFixed(2),
      } : null,
      state: m.state || null,
      tier: m.tier || null,
      roomId: m.roomId ?? null,
      hp: m.hp ?? null,
    }));

  const lastInput = (typeof window !== 'undefined') ? window.__lastInputFrame : null;

  // Walkability snapshot — tells us at-a-glance if any room is
  // unreachable from the player's current position. Cheap (we already
  // have the method on Level).
  let walkability = null;
  try {
    walkability = level?.checkRealWalkability?.() || null;
  } catch (_) { /* defensive */ }

  // Take a screenshot of the WebGL canvas. The renderer must be set
  // with preserveDrawingBuffer=true OR we capture immediately after a
  // render — Three.js drops the buffer after present otherwise. We
  // just call toDataURL and accept blank if the buffer is gone.
  let screenshot = null;
  try {
    const canvas = document.querySelector('canvas');
    if (canvas) screenshot = canvas.toDataURL('image/png');
  } catch (_) { /* CORS / context lost — skip */ }

  return {
    ts,
    runSeed,
    levelIndex: level?.index ?? null,
    levelSeed: level?.seed ?? null,
    bossRoomId: level?.bossRoomId ?? null,
    playerPos,
    playerRoomId,
    walkability,
    rooms,
    gunmen: gunmenSnap,
    melees: meleesSnap,
    lastInput,
    screenshot,
  };
}

async function _post(payload) {
  // Build a compact title so a list-view can identify the repro
  // without expanding the body.
  const title = `auto: stuck repro [seed=${payload.runSeed ?? '?'} idx=${payload.levelIndex ?? '?'} room=${payload.playerRoomId ?? '?'}]`;
  const screenshot = payload.screenshot;
  const bodyPayload = { ...payload };
  delete bodyPayload.screenshot;
  const body = '```json\n' + JSON.stringify(bodyPayload, null, 2) + '\n```';

  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: 'cold-exit',
      title,
      body,
      screenshot,
      severity: 'major',
    }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function _showToast(text, ok = true) {
  // transientHudMsg is exposed on window in main.js for the F2 dev
  // key. Fall back to a corner div if it's missing.
  if (typeof window !== 'undefined' && typeof window.transientHudMsg === 'function') {
    try { window.transientHudMsg(text, 2.0); return; } catch (_) {}
  }
  const div = document.createElement('div');
  div.textContent = text;
  div.style.cssText = `position:fixed;right:12px;bottom:12px;padding:8px 12px;
    background:${ok ? '#1a3a1a' : '#3a1a1a'};color:#e0e0e0;font:14px/1.4 sans-serif;
    border:1px solid ${ok ? '#4a7a4a' : '#7a4a4a'};border-radius:4px;z-index:99999;
    box-shadow:0 2px 8px rgba(0,0,0,0.4)`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2500);
}

async function _fileBug() {
  const now = Date.now();
  if (now - _lastFiredT < DEBOUNCE_MS) return;   // debounce
  _lastFiredT = now;
  let payload = null;
  try {
    payload = _capturePayload();
  } catch (e) {
    console.warn('[bug-report] capture failed:', e);
    _showToast('Bug capture failed (see console)', false);
    return;
  }
  try {
    const result = await _post(payload);
    console.log('[bug-report] filed:', result);
    _showToast(`Bug filed — repro captured (#${result.id ?? '?'})`);
  } catch (err) {
    console.warn('[bug-report] dashboard unreachable, falling back to clipboard:', err);
    const text = JSON.stringify(payload, null, 2);
    console.log('=== BUG REPORT (clipboard fallback) ===');
    console.log(text);
    console.log('=== END BUG REPORT ===');
    try {
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
      _showToast('Bug copied to clipboard (dashboard offline)', false);
    } catch (_) {
      _showToast('Bug logged to console (clipboard blocked)', false);
    }
  }
}

// Public — call once at boot to bind the keydown listener.
export function initBugReport() {
  window.addEventListener('keydown', (ev) => {
    // `]` is the bind. We deliberately don't trap modifiers — Ctrl/
    // Alt/Shift+] should still trigger so the user can fire it
    // mid-text-entry without the form swallowing the key.
    if (ev.key !== ']') return;
    // Skip when typing in a real text field.
    const tag = (ev.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || ev.target?.isContentEditable) return;
    ev.preventDefault();
    _fileBug();
  });
  console.log('[bug-report] initialised — press ] to file a stuck-state repro');
}
