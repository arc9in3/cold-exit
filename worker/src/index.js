// Cloudflare Worker — public leaderboard endpoint for tacticalrogue.
//
// Routes:
//   GET  /api/scores/top?category=credits&limit=20
//   POST /api/scores/submit  { name, score, category, meta? }
//   GET  /api/health
//
// Storage: a single KV namespace (`LEADERBOARD`) with one key per
// category — `top:credits`, `top:levels`, `top:damage`, `top:kills`.
// Each key holds a JSON array sorted descending by score. Keeps the
// top `KEEP_TOP` entries; writes are last-writer-wins, which at
// playtest scale is fine. If you ever need atomic inserts / larger
// history, migrate to D1 (SQLite) — the Worker shape stays the same.
//
// Deliberately no auth on writes. A friends-only leaderboard doesn't
// need it; public leaderboards would need HMAC-signed submissions,
// which can be added on top later without breaking clients.

const CATEGORIES = ['credits', 'levels', 'damage', 'kills'];
const KEEP_TOP = 50;
const MAX_NAME_LEN = 24;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === '/api/health') {
        return json({ ok: true, at: new Date().toISOString() }, 200, cors);
      }
      if (url.pathname === '/api/scores/top' && request.method === 'GET') {
        const category = url.searchParams.get('category') || 'credits';
        const limit = Math.max(1, Math.min(KEEP_TOP,
          Number(url.searchParams.get('limit')) || 20));
        if (!CATEGORIES.includes(category)) {
          return json({ error: 'unknown category' }, 400, cors);
        }
        const entries = await readTop(env, category, limit);
        return json({ category, entries }, 200, cors);
      }
      if (url.pathname === '/api/scores/submit' && request.method === 'POST') {
        const body = await readJson(request);
        const err = validateSubmission(body);
        if (err) return json({ error: err }, 400, cors);
        const result = await submitScore(env, body);
        return json(result, 200, cors);
      }
      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      return json({ error: 'server error', detail: String(e) }, 500, cors);
    }
  },
};

// ---- handlers --------------------------------------------------------

async function readTop(env, category, limit) {
  const raw = await env.LEADERBOARD.get(`top:${category}`);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.slice(0, limit) : [];
  } catch (_) {
    return [];
  }
}

async function submitScore(env, body) {
  const category = body.category;
  const key = `top:${category}`;
  const raw = await env.LEADERBOARD.get(key);
  let list = [];
  if (raw) {
    try { list = JSON.parse(raw); } catch (_) { list = []; }
    if (!Array.isArray(list)) list = [];
  }
  const entry = {
    name: String(body.name).slice(0, MAX_NAME_LEN),
    score: Math.round(Number(body.score)) || 0,
    ts: Date.now(),
  };
  if (body.meta && typeof body.meta === 'object') {
    // Copy a whitelist of meta fields — don't trust arbitrary keys.
    const m = body.meta;
    entry.meta = {};
    if (typeof m.deathLevel === 'number') entry.meta.deathLevel = m.deathLevel | 0;
    if (typeof m.kills === 'number')      entry.meta.kills = m.kills | 0;
    if (typeof m.credits === 'number')    entry.meta.credits = Math.round(m.credits);
  }
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  if (list.length > KEEP_TOP) list.length = KEEP_TOP;
  await env.LEADERBOARD.put(key, JSON.stringify(list));
  const rank = list.indexOf(entry) + 1;    // 1-indexed, or 0 if not in top
  return { ok: true, rank: rank > 0 ? rank : null, topCount: list.length };
}

// ---- helpers ---------------------------------------------------------

function validateSubmission(body) {
  if (!body || typeof body !== 'object') return 'body required';
  if (!CATEGORIES.includes(body.category)) return 'bad category';
  if (typeof body.name !== 'string' || body.name.trim().length === 0) return 'bad name';
  if (typeof body.score !== 'number' || !isFinite(body.score)) return 'bad score';
  if (body.score < 0 || body.score > 1e9) return 'score out of range';
  return null;
}

async function readJson(request) {
  try { return await request.json(); } catch (_) { return null; }
}

function json(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function corsHeaders(origin, env) {
  // If ALLOWED_ORIGINS is empty / unset → permissive (handy during
  // dev). Otherwise it's a comma-separated list and we echo back the
  // matching one.
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const allow = (!allowed.length) ? '*'
    : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
