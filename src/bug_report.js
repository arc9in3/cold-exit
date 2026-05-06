// bug_report.js — F2 stuck-state capture for paste-into-Discord workflow.
//
// Player encounters a blocked / unreachable / weird level → presses F2.
// We capture a COMPACT level state dump (under ~1500 chars so it fits
// in a single Discord message), wrap it in a marker header, copy to
// clipboard, and toast the player to paste it into #cold-exit-bugs.
//
// The Mission Control bot has a matching listener that recognizes the
// marker in a regular user message and intakes the dump as a structured
// bug — auto-loads the same seed for repro + flags as a gen-time bug.
//
// Why F2 (not webhook auto-post): no webhook URL to manage, works in
// every build, gives the player a paste-able artifact they can also
// share in DMs / GitHub / wherever. Single source of truth for stuck
// reports.
//
// Idempotent — debounced 3s so accidental key-mash doesn't flood.

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
        z: +player.mesh.position.z.toFixed(2) }
    : null;

  const playerRoomId = (level && playerPos)
    ? (level.roomAt?.(playerPos.x, playerPos.z)?.id ?? null)
    : null;

  // Compact rooms: id + type + shape only. No bounds, no neighbors —
  // those can be re-derived from the seed.
  const rooms = (level?.rooms || []).map(r => ({
    id: r.id, type: r.type || null, shape: r.shape || r.layout || null,
    cleared: !!r.cleared, sealed: !!r._sealed,
  }));

  const aliveGunmen = (gunmen?.gunmen || []).filter(g => g.alive).length;
  const aliveMelees = (melees?.enemies || []).filter(m => m.alive).length;

  // Walkability snapshot — the killer field for stuck-bug repros.
  let walkability = null;
  try {
    const w = level?.checkRealWalkability?.();
    if (w) {
      walkability = {
        ok: w.ok,
        unreachable: (w.unreachable || []).map(r => `R${r.id}:${r.type}/${r.shape || '?'}`),
      };
    }
  } catch (_) { /* defensive */ }

  return {
    ts,
    runSeed,
    levelIndex: level?.index ?? null,
    bossRoomId: level?.bossRoomId ?? null,
    playerPos,
    playerRoomId,
    walkability,
    rooms,
    aliveGunmen,
    aliveMelees,
    notes: '',     // user can edit this in the message before sending
  };
}

// Wrap the JSON in a marker header so the MC bot can grep for it
// without false-matching casual JSON in a chat message. Format keeps
// the JSON in a code fence so it renders cleanly in Discord.
function _formatForPaste(payload) {
  const json = JSON.stringify(payload, null, 2);
  return [
    '🐛 **COLD-EXIT F2 LEVEL DUMP v1**',
    `_${payload.walkability?.ok === false
        ? `unreachable rooms: ${payload.walkability.unreachable.join(', ')}`
        : 'something feels wrong here'}_`,
    '```json',
    json,
    '```',
    '',
    '<!-- describe what felt broken: -->',
  ].join('\n');
}

function _showToast(text, ok = true) {
  if (typeof window !== 'undefined' && typeof window.transientHudMsg === 'function') {
    try { window.transientHudMsg(text, 3.0); return; } catch (_) {}
  }
  const div = document.createElement('div');
  div.textContent = text;
  div.style.cssText = `position:fixed;right:12px;bottom:12px;padding:10px 14px;
    background:${ok ? '#1a3a1a' : '#3a1a1a'};color:#e0e0e0;font:14px/1.4 sans-serif;
    border:1px solid ${ok ? '#4a7a4a' : '#7a4a4a'};border-radius:4px;z-index:99999;
    box-shadow:0 2px 8px rgba(0,0,0,0.4);max-width:340px`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

async function _fileBug() {
  const now = Date.now();
  if (now - _lastFiredT < DEBOUNCE_MS) return;
  _lastFiredT = now;
  let payload;
  try {
    payload = _capturePayload();
  } catch (e) {
    console.warn('[bug-report] capture failed:', e);
    _showToast('F2 capture failed (see console)', false);
    return;
  }
  const text = _formatForPaste(payload);
  // Also dump to console so the user can pull it from there if
  // clipboard write is blocked (some browsers gate clipboard on
  // user gesture; F2 IS a user gesture so it should work).
  console.log('=== COLD-EXIT F2 LEVEL DUMP ===');
  console.log(text);
  console.log('=== END DUMP ===');
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      _showToast('📋 Level dump copied — paste into #cold-exit-bugs');
    } else {
      _showToast('Clipboard not available — see console for dump', false);
    }
  } catch (err) {
    console.warn('[bug-report] clipboard write failed:', err);
    _showToast('Clipboard blocked — see console for dump', false);
  }
}

// Public — call once at boot to bind the keydown listener.
export function initBugReport() {
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'F2') return;
    // Skip when typing in a real text field.
    const tag = (ev.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || ev.target?.isContentEditable) return;
    ev.preventDefault();
    _fileBug();
  });
  console.log('[bug-report] initialised — press F2 to copy a stuck-state dump for #cold-exit-bugs');
}
