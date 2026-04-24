// DOM-layer floating damage numbers. Colors communicate the zone hit so the
// player can see whether they tagged a head, legs, arm, or torso at a glance.
const ZONE_CLASS = {
  head: 'crit',
  legs: 'legs',
  arm: 'arm',
  torso: '',
};

export function spawnDamageNumber(worldPos, camera, amount, zone) {
  const p = worldPos.clone().project(camera);
  const x = (p.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-p.y * 0.5 + 0.5) * window.innerHeight;

  const el = document.createElement('div');
  const cls = ZONE_CLASS[zone] ?? '';
  el.className = 'dmg-number' + (cls ? ' ' + cls : '');
  el.textContent = Math.round(amount);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// Short-lived dialogue bubble above a target (enemy chatter).
// Projects the 3D world pos to screen each spawn. `life` in seconds.
export function spawnSpeechBubble(worldPos, camera, text, life = 2.5) {
  const p = worldPos.clone().project(camera);
  const x = (p.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
  const el = document.createElement('div');
  el.className = 'enemy-chatter';
  el.textContent = text;
  Object.assign(el.style, {
    position: 'fixed', left: `${x}px`, top: `${y}px`,
    transform: 'translate(-50%, -100%)',
    background: 'rgba(0,0,0,0.72)',
    color: '#e8dfc8',
    border: '1px solid rgba(201,168,122,0.35)',
    borderRadius: '3px',
    padding: '4px 10px',
    fontSize: '11px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    letterSpacing: '0.5px',
    pointerEvents: 'none',
    zIndex: 40,
    opacity: '0',
    transition: 'opacity 0.18s',
    whiteSpace: 'nowrap',
  });
  document.body.appendChild(el);
  // Fade in, then out at life-end.
  requestAnimationFrame(() => { el.style.opacity = '0.95'; });
  setTimeout(() => { el.style.opacity = '0'; }, Math.max(200, life * 1000 - 220));
  setTimeout(() => el.remove(), life * 1000);
}
