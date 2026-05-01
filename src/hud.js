// DOM-layer floating damage numbers. Colors communicate the zone hit so the
// player can see whether they tagged a head, legs, arm, or torso at a glance.
const ZONE_CLASS = {
  head: 'crit',
  legs: 'legs',
  arm: 'arm',
  torso: '',
  coin: 'coin',     // gold "+N" floater for kill-coin payouts
};

// Pooled damage-number nodes. Was creating + appending a fresh
// <div> per hit and removing it 900ms later via setTimeout. Shotgun
// pellets across multiple targets fired 20+ DOM creates per shot
// + matching removals 900ms later — both are layout/GC tax.
//
// Pool keeps 64 div nodes appended once. spawnDamageNumber reuses an
// idle slot; each call cancels the prior Web Animations API animation
// (built off the same dmg-rise keyframes the CSS used) and starts a
// fresh one. .onfinish flips the slot back to idle. No DOM
// creation/removal in the hot path.
const _DMG_POOL_SIZE = 64;
const _dmgPool = [];
let _dmgPoolIdx = 0;
const _DMG_KEYFRAMES = [
  { transform: 'translate(-50%, -50%) scale(0.9)', opacity: 0 },
  { transform: 'translate(-50%, -70%) scale(1.1)', opacity: 1, offset: 0.15 },
  { transform: 'translate(-50%, -160%) scale(1.0)', opacity: 0 },
];
// Crit + headshot keyframes — number punches in larger, then settles
// to the regular display size before drifting up to fade. The brief
// oversize pop is the visual reward for landing the high-skill hit.
const _DMG_CRIT_KEYFRAMES = [
  { transform: 'translate(-50%, -50%) scale(0.7)', opacity: 0 },
  { transform: 'translate(-50%, -65%) scale(1.7)', opacity: 1, offset: 0.10 },
  { transform: 'translate(-50%, -85%) scale(1.0)', opacity: 1, offset: 0.30 },
  { transform: 'translate(-50%, -160%) scale(1.0)', opacity: 0 },
];
const _DMG_ANIM_OPTS = { duration: 900, easing: 'ease-out', fill: 'forwards' };

function _ensureDmgPool() {
  if (_dmgPool.length === _DMG_POOL_SIZE) return;
  for (let i = _dmgPool.length; i < _DMG_POOL_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'dmg-number';
    // Hide until first use so the slot doesn't paint at 0,0.
    el.style.opacity = '0';
    document.body.appendChild(el);
    _dmgPool.push({ el, anim: null, inUse: false });
  }
}

export function spawnDamageNumber(worldPos, camera, amount, zone, isCrit) {
  _ensureDmgPool();
  const p = worldPos.clone().project(camera);
  const x = (p.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-p.y * 0.5 + 0.5) * window.innerHeight;

  // Find an idle slot starting from the rolling cursor. If every
  // slot is busy, reuse the oldest (cursor position) — overflow
  // is rare and visually invisible (the older one is mid-fade).
  let slot = null;
  for (let i = 0; i < _DMG_POOL_SIZE; i++) {
    const idx = (_dmgPoolIdx + i) % _DMG_POOL_SIZE;
    if (!_dmgPool[idx].inUse) { slot = _dmgPool[idx]; _dmgPoolIdx = (idx + 1) % _DMG_POOL_SIZE; break; }
  }
  if (!slot) {
    slot = _dmgPool[_dmgPoolIdx];
    _dmgPoolIdx = (_dmgPoolIdx + 1) % _DMG_POOL_SIZE;
    if (slot.anim) slot.anim.cancel();
  }
  slot.inUse = true;
  // Headshots and crits both get the punchy "crit" animation. Zone
  // classes still drive color (head → crit-color via ZONE_CLASS).
  const isHeadOrCrit = zone === 'head' || !!isCrit;
  const cls = ZONE_CLASS[zone] ?? '';
  slot.el.className = 'dmg-number'
    + (cls ? ' ' + cls : '')
    + (isHeadOrCrit ? ' crit-pop' : '');
  slot.el.textContent = Math.round(amount);
  slot.el.style.left = `${x}px`;
  slot.el.style.top = `${y}px`;
  // Cancel any in-flight animation on this slot so the new one
  // restarts from frame zero.
  if (slot.anim) slot.anim.cancel();
  const frames = isHeadOrCrit ? _DMG_CRIT_KEYFRAMES : _DMG_KEYFRAMES;
  const anim = slot.el.animate(frames, _DMG_ANIM_OPTS);
  slot.anim = anim;
  anim.onfinish = () => {
    if (slot.anim === anim) {
      slot.inUse = false;
      slot.anim = null;
      slot.el.style.opacity = '0';
    }
  };
}

// Short-lived dialogue bubble above a target (enemy chatter).
// Projects the 3D world pos to screen each spawn. `life` in seconds.
//
// Pooled — each spawn reuses an idle slot. With many enemies barking
// + encounters firing speech, the old append-then-remove pattern
// ran ~one DOM lifecycle every few seconds on top of normal play.
const _BUBBLE_POOL_SIZE = 24;
const _bubblePool = [];
let _bubblePoolIdx = 0;
function _ensureBubblePool() {
  if (_bubblePool.length === _BUBBLE_POOL_SIZE) return;
  const baseStyle = {
    position: 'fixed',
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
  };
  for (let i = _bubblePool.length; i < _BUBBLE_POOL_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'enemy-chatter';
    Object.assign(el.style, baseStyle);
    document.body.appendChild(el);
    _bubblePool.push({ el, inUse: false, hideT: 0, removeT: 0 });
  }
}
export function spawnSpeechBubble(worldPos, camera, text, life = 7.0) {
  _ensureBubblePool();
  const p = worldPos.clone().project(camera);
  const x = (p.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
  // Pick the next idle slot, or recycle the oldest if all are busy.
  let slot = null;
  for (let i = 0; i < _BUBBLE_POOL_SIZE; i++) {
    const idx = (_bubblePoolIdx + i) % _BUBBLE_POOL_SIZE;
    if (!_bubblePool[idx].inUse) { slot = _bubblePool[idx]; _bubblePoolIdx = (idx + 1) % _BUBBLE_POOL_SIZE; break; }
  }
  if (!slot) {
    slot = _bubblePool[_bubblePoolIdx];
    _bubblePoolIdx = (_bubblePoolIdx + 1) % _BUBBLE_POOL_SIZE;
    if (slot.hideT) clearTimeout(slot.hideT);
    if (slot.removeT) clearTimeout(slot.removeT);
  }
  slot.inUse = true;
  slot.el.textContent = text;
  slot.el.style.left = `${x}px`;
  slot.el.style.top = `${y}px`;
  slot.el.style.opacity = '0';
  // Fade in next frame, then out near life-end. Capture timer ids
  // on the slot so a recycled slot can clear stale timers.
  requestAnimationFrame(() => { slot.el.style.opacity = '0.95'; });
  slot.hideT = setTimeout(() => { slot.el.style.opacity = '0'; }, Math.max(200, life * 1000 - 220));
  slot.removeT = setTimeout(() => {
    slot.inUse = false;
    slot.hideT = 0; slot.removeT = 0;
    slot.el.style.opacity = '0';
  }, life * 1000);
}
