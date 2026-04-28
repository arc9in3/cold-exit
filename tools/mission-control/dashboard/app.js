// Mission Control dashboard client. Polls /api/state every 2s, renders
// quadrants + services + activity. No frameworks; tiny enough to read
// top-to-bottom in a sitting.

const POLL_MS = 2000;

// ---------- helpers ---------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
};

function fmtAgo(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!t) return '—';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function fmtDur(ms) {
  if (ms == null) return '—';
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

// ---------- renderers ------------------------------------------------
function renderQuadrant(cardEl, key, bot) {
  cardEl.innerHTML = '';
  const isBusy = !!bot.current;
  cardEl.className = 'card ' + (isBusy ? 'has-current' : 'idle');

  // Head
  const head = el('div', { class: 'card-head' },
    el('span', { class: 'card-emoji' }, bot.emoji || '🤖'),
    el('span', { class: 'card-name' }, bot.name),
    el('span', { class: 'card-status ' + (isBusy ? 'busy' : '') }, isBusy ? 'BUSY' : 'IDLE'));

  // Role + meta
  const role = el('div', { class: 'card-role' }, bot.role || '');
  const meta = el('div', { class: 'card-meta' },
    el('span', {}, 'model: ', el('strong', {}, bot.model || '—')),
    el('span', {}, 'queued: ', el('strong', {}, String(bot.queued.length))),
    el('span', {}, 'recent: ', el('strong', {}, String(bot.done.length))));

  // Currently doing
  const currentSection = el('div', { class: 'card-section' },
    el('h4', {}, 'Currently'),
    bot.current
      ? el('div', { class: 'task-line in-progress' },
          el('span', { class: 'task-id' }, `#${bot.current.id}`),
          el('span', { class: 'task-slug' }, bot.current.slug),
          el('span', { class: 'task-time' }, fmtAgo(bot.current.startedAt)))
      : el('div', { class: 'empty' }, 'idle — waiting on queue'));

  // Queued
  const queuedItems = bot.queued.length
    ? bot.queued.slice(0, 4).map(t => el('div', { class: 'task-line' },
        el('span', { class: 'task-id' }, `#${t.id}`),
        el('span', { class: 'task-slug' }, t.slug)))
    : [el('div', { class: 'empty' }, '(empty)')];
  const queuedSection = el('div', { class: 'card-section' },
    el('h4', {}, `Up next (${bot.queued.length})`), ...queuedItems);

  // Recent
  const doneItems = bot.done.length
    ? bot.done.slice(0, 3).map(t => el('div', { class: 'task-line ' + (t.status === 'failed' ? 'failed' : 'done') },
        el('span', { class: 'task-id' }, `#${t.id}`),
        el('span', { class: 'task-slug' }, t.slug),
        el('span', { class: 'task-time' }, fmtDur(t.durationMs))))
    : [el('div', { class: 'empty' }, '(none yet)')];
  const recentSection = el('div', { class: 'card-section' },
    el('h4', {}, `Recently done`), ...doneItems);

  cardEl.append(head, role, meta, currentSection, queuedSection, recentSection);
}

function renderBgWorker(cardEl, key, bot) {
  cardEl.innerHTML = '';
  const isBusy = !!bot.current;
  cardEl.className = 'bg-card ' + (isBusy ? 'has-current' : 'idle');
  cardEl.append(
    el('span', { class: 'bg-emoji' }, bot.emoji || '🤖'),
    el('div', {},
      el('div', { class: 'bg-name' }, bot.name),
      el('div', { class: 'bg-model' }, bot.model || '')),
    el('div', { class: 'bg-current ' + (isBusy ? '' : 'idle') },
      el('span', { class: 'bg-current-label' }, isBusy ? 'Working on' : 'Status'),
      el('span', {}, isBusy ? bot.current.slug : `idle · ${bot.queued.length} queued`)),
  );
}

function renderServices(services) {
  const container = $('#services-list');
  container.innerHTML = '';
  for (const [key, svc] of Object.entries(services)) {
    const dot = el('div', { class: 'svc-dot ' + (svc.running ? 'running' : '') });
    const info = el('div', { class: 'svc-info' },
      el('div', { class: 'svc-label' }, svc.label),
      el('div', { class: 'svc-meta' }, [
        svc.running ? `pid ${svc.pid}` : 'stopped',
        svc.url ? ` · ` : '',
        svc.url ? el('a', { href: svc.url, target: '_blank' }, svc.url) : null,
      ].filter(Boolean)));
    const btn = el('button', {
      class: 'svc-btn ' + (svc.running ? 'running' : ''),
      onclick: () => svc.running ? null : launchService(key),
    }, svc.running ? '✓ Running' : 'Launch');
    container.append(el('div', { class: 'svc-row' }, dot, info, btn));
  }
}

function renderActivity(events) {
  const ul = $('#activity-list');
  ul.innerHTML = '';
  for (const e of events) {
    ul.appendChild(el('li', {},
      el('span', { class: 'act-time' }, fmtAgo(e.created_at)),
      el('span', { class: 'act-bot' }, e.bot),
      el('span', { class: 'act-kind' }, e.kind),
      el('span', { class: 'act-body' }, e.body || '')));
  }
  if (!events.length) {
    ul.appendChild(el('li', { class: 'empty' }, 'no activity yet — fire a task to populate'));
  }
}

// ---------- launch ----------------------------------------------------
async function launchService(key) {
  try {
    const res = await fetch(`/api/launch/${key}`, { method: 'POST' });
    const json = await res.json();
    if (json.ok) {
      console.log(`[launch] ${key} ${json.alreadyRunning ? 'already up' : `pid ${json.pid}`}`);
      // Force a state refresh so the button flips immediately.
      tick();
    } else {
      alert(`launch failed: ${json.error}`);
    }
  } catch (e) {
    alert(`launch failed: ${e.message}`);
  }
}

// ---------- main loop -------------------------------------------------
async function tick() {
  try {
    const r = await fetch('/api/state');
    const s = await r.json();
    $('#project-pill').textContent = `project: ${s.project}`;
    $('#last-updated').textContent = `updated ${fmtAgo(s.ts)}`;
    if (s.bots.claudie) renderQuadrant($('#card-claudie'), 'claudie', s.bots.claudie);
    if (s.bots.newsie)  renderQuadrant($('#card-newsie'),  'newsie',  s.bots.newsie);
    if (s.bots.thinkie) renderQuadrant($('#card-thinkie'), 'thinkie', s.bots.thinkie);
    if (s.bots.sortie)  renderQuadrant($('#card-sortie'),  'sortie',  s.bots.sortie);
    if (s.bots.wrenchy) renderBgWorker($('#card-wrenchy'), 'wrenchy', s.bots.wrenchy);
    if (s.bots.sage)    renderBgWorker($('#card-sage'),    'sage',    s.bots.sage);
    renderServices(s.services);
    renderActivity(s.events);
  } catch (e) {
    $('#last-updated').textContent = `connection lost — ${e.message}`;
  }
}

tick();
setInterval(tick, POLL_MS);
