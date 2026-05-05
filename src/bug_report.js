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
// Routing priority:
//   1. Discord webhook (window.__COLD_EXIT_BUG_WEBHOOK or build-injected
//      URL). Works from the live deploy because Discord webhooks are
//      public-facing. Posts a compact embed + the screenshot as an
//      attachment + the dump JSON as a markdown code block.
//   2. Mission Control dashboard (http://localhost:3001/api/bugs/intake)
//      — only when the user is running cold-exit alongside their MC
//      stack at home.
//   3. Console.log + clipboard fallback if neither is reachable.
//
// The Discord webhook URL is read at runtime from window.__COLD_EXIT_BUG_WEBHOOK
// so it can be injected by an HTML <script> tag (e.g. Cloudflare Pages
// build snippet or per-environment override) without rebuilding the
// game module. If the URL contains 'webhooks/' Discord IDs we treat it
// as a Discord webhook and route there first; otherwise we treat it as
// a generic JSON intake endpoint.
//
// Idempotent — debounced 3s so accidental key-mash doesn't flood.

const DASHBOARD_ENDPOINT = 'http://localhost:3001/api/bugs/intake';
const DEBOUNCE_MS = 3000;
let _lastFiredT = 0;

function _discordWebhookUrl() {
  if (typeof window === 'undefined') return null;
  const url = window.__COLD_EXIT_BUG_WEBHOOK;
  if (!url || typeof url !== 'string') return null;
  // Sanity check — must look like a Discord webhook URL.
  if (!/discord(?:app)?\.com\/api\/webhooks\//i.test(url)) return null;
  return url;
}

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

// Build a compact title so a list-view (Discord embed / MC dashboard
// row) can identify the repro without expanding the body.
function _titleFor(payload) {
  return `auto: stuck repro [seed=${payload.runSeed ?? '?'} idx=${payload.levelIndex ?? '?'} room=${payload.playerRoomId ?? '?'}]`;
}

// Post to a Discord channel webhook. Sends a multipart form so the
// screenshot lands as a real attached image (.png) plus a JSON-only
// payload describing the embed + the level dump. Bot listeners on
// the channel parse the F2-marker in the embed footer to recognize
// this as a structured stuck-repro.
async function _postDiscord(webhookUrl, payload) {
  const title = _titleFor(payload);
  const screenshot = payload.screenshot;
  const bodyPayload = { ...payload }; delete bodyPayload.screenshot;
  // Truncate the dump so the message fits in Discord's 2000-char
  // content limit; full JSON is attached as a file separately.
  const dumpFull = JSON.stringify(bodyPayload, null, 2);
  const dumpShort = dumpFull.length > 1500 ? dumpFull.slice(0, 1500) + '\n... (truncated; see dump.json attachment)' : dumpFull;
  const embed = {
    title: `🐛 ${title}`,
    color: 0xd84a3a,
    description:
      `**Player:** \`${payload.playerPos ? `(${payload.playerPos.x}, ${payload.playerPos.z}) room=${payload.playerRoomId}` : '?'}\`\n` +
      `**Walkability:** \`${payload.walkability?.ok ? 'OK' : `FAIL — unreachable: ${(payload.walkability?.unreachable || []).map(r=>'R'+r.id).join(', ') || '?'}`}\`\n` +
      `**Gunmen alive:** ${payload.gunmen?.length ?? 0}  ·  **Melees alive:** ${payload.melees?.length ?? 0}\n` +
      `**Boss room:** R${payload.bossRoomId ?? '?'}\n` +
      '```json\n' + dumpShort + '\n```',
    footer: { text: 'cold-exit-f2-dump v1' },
    timestamp: payload.ts,
  };
  // Multipart: payload_json (the message) + file0 (screenshot) + file1 (full dump).
  const fd = new FormData();
  fd.append('payload_json', JSON.stringify({
    content: '',
    embeds: [embed],
    allowed_mentions: { parse: [] },
  }));
  if (screenshot && screenshot.startsWith('data:image/')) {
    const blob = await (await fetch(screenshot)).blob();
    fd.append('files[0]', blob, 'screenshot.png');
  }
  fd.append('files[1]', new Blob([dumpFull], { type: 'application/json' }), 'dump.json');
  const resp = await fetch(webhookUrl + '?wait=true', { method: 'POST', body: fd });
  if (!resp.ok) throw new Error(`Discord webhook HTTP ${resp.status}`);
  return resp.json();
}

// Post to Mission Control dashboard's bugs intake. Used when the
// user is running cold-exit alongside their local MC stack and wants
// the bug to land in the dashboard's bug list instead of (or in
// addition to) Discord.
async function _postDashboard(payload) {
  const title = _titleFor(payload);
  const screenshot = payload.screenshot;
  const bodyPayload = { ...payload }; delete bodyPayload.screenshot;
  const body = '```json\n' + JSON.stringify(bodyPayload, null, 2) + '\n```';
  const resp = await fetch(DASHBOARD_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: 'cold-exit', title, body, screenshot, severity: 'major',
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
  // Try Discord webhook first (works in live deploy), fall back to
  // local dashboard, then clipboard. Each step is best-effort; we
  // log specifically why we fell through so a user with a misconfigured
  // webhook URL gets a clear console signal.
  const webhook = _discordWebhookUrl();
  if (webhook) {
    try {
      const result = await _postDiscord(webhook, payload);
      console.log('[bug-report] posted to Discord:', result?.id || '(ok)');
      _showToast('🐛 Bug posted to #cold-exit-bugs');
      return;
    } catch (err) {
      console.warn('[bug-report] Discord webhook failed, trying dashboard:', err);
    }
  }
  try {
    const result = await _postDashboard(payload);
    console.log('[bug-report] filed via dashboard:', result);
    _showToast(`Bug filed (#${result.id ?? '?'})`);
    return;
  } catch (err) {
    console.warn('[bug-report] dashboard unreachable, falling back to clipboard:', err);
  }
  const text = JSON.stringify(payload, null, 2);
  console.log('=== BUG REPORT (clipboard fallback) ===');
  console.log(text);
  console.log('=== END BUG REPORT ===');
  try {
    if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
    _showToast('Bug copied to clipboard (no webhook / dashboard)', false);
  } catch (_) {
    _showToast('Bug logged to console (clipboard blocked)', false);
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
