#!/usr/bin/env node
//
// Mission Control dashboard server. Localhost-only, plain Node http,
// zero web framework dependencies. Serves the static HTML at /, exposes
// a small JSON + SSE API for live state and process control.
//
// Run: node dashboard/server.mjs
// Open: http://localhost:3001
//
// Why no Express / Vite / React: the whole point of Mission Control is
// transparency. Plain HTML/CSS/JS the user can read in 5 minutes beats
// any framework that needs a build step. If something breaks the user
// can fix it without npm install.

import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, exec } from 'node:child_process';
import { db, migrate } from '../src/db.mjs';
import { PERSONAS, BG_WORKERS } from '../src/personas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// Active project root — see comment in src/workers/local_runner.mjs.
// Set MC_PROJECT_ROOT in .env to point at the project mission-control
// should manage (e.g. C:/work/Personal/tacticalrogue).
const REPO_ROOT = process.env.MC_PROJECT_ROOT
  ? path.resolve(process.env.MC_PROJECT_ROOT)
  : path.resolve(__dirname, '..', '..', '..');

const PORT = 3001;

migrate();

// ---------- process registry -----------------------------------------
// Services the dashboard can spawn + detect. Each has:
//   detect: a process-name fragment for tasklist-based liveness checks
//   start:  a PowerShell command spawned in a new window
//   port:   optional host:port the service advertises
//   url:    optional clickable URL when running

const SERVICES = {
  ollama: {
    label: 'Ollama (local LLM server)',
    detect: 'ollama',
    // Ollama Windows installer registers itself as a system service,
    // so it's usually already running. If not, this command kicks it
    // up in a window so the user sees activity.
    start: 'ollama serve',
    url: 'http://127.0.0.1:11434',
  },
  bot: {
    label: 'Mission Control bot',
    detect: 'node',                              // generic; refined by cwd check below
    detectArgsContain: ['src/bot.mjs'],          // matches command line text
    start: 'node src/bot.mjs',
    cwd: ROOT,
  },
  reviewDashboard: {
    label: 'Review dashboard (cold-exit branch reviews)',
    detect: 'node',
    detectArgsContain: ['review-dashboard.mjs'],
    start: 'node tools/review-dashboard.mjs',
    cwd: REPO_ROOT,
    url: 'http://localhost:3000',
  },
};

// In-memory map of processes the dashboard spawned during this session.
// Key: service name → { proc, log: [lines], startedAt }
const _spawned = new Map();
// SSE clients waiting for log lines — Map<service, Set<res>>
const _sseClients = new Map();

// ---------- liveness check via tasklist ------------------------------
// Ask Windows for the running process list and check whether each
// service appears. Cached for 4s so the dashboard can poll without
// hammering the OS.

let _tasklistCache = null;
let _tasklistAt = 0;
function _runTasklist() {
  return new Promise((resolve) => {
    exec('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object Name, ProcessId, CommandLine | ConvertTo-Json -Compress"',
      { timeout: 6000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) { resolve([]); return; }
        try {
          const arr = JSON.parse(stdout);
          resolve(Array.isArray(arr) ? arr : [arr]);
        } catch (_) { resolve([]); }
      });
  });
}

async function _getTaskList() {
  const now = Date.now();
  if (_tasklistCache && now - _tasklistAt < 4000) return _tasklistCache;
  _tasklistCache = await _runTasklist();
  _tasklistAt = now;
  return _tasklistCache;
}

async function _serviceStatus(name) {
  const svc = SERVICES[name];
  if (!svc) return { name, running: false, error: 'unknown service' };
  const inSession = _spawned.get(name);
  if (inSession && inSession.proc && !inSession.proc.killed && inSession.proc.exitCode === null) {
    return { name, running: true, source: 'spawned-here', pid: inSession.proc.pid, startedAt: inSession.startedAt, url: svc.url || null };
  }
  // Fall back to tasklist scan
  const tasks = await _getTaskList();
  const hit = tasks.find(t =>
    String(t.Name || '').toLowerCase().includes(svc.detect.toLowerCase())
    && (!svc.detectArgsContain
        || svc.detectArgsContain.every(s => String(t.CommandLine || '').toLowerCase().includes(s.toLowerCase())))
  );
  if (hit) return { name, running: true, source: 'detected', pid: hit.ProcessId, url: svc.url || null };
  return { name, running: false, url: svc.url || null };
}

// ---------- launch ---------------------------------------------------
// Spawn a service in a NEW PowerShell window so the user can see the
// raw output. We also tap stdout/stderr so the dashboard can stream
// the same lines via SSE.

function _launch(name) {
  const svc = SERVICES[name];
  if (!svc) throw new Error(`unknown service: ${name}`);
  const existing = _spawned.get(name);
  if (existing && existing.proc && !existing.proc.killed && existing.proc.exitCode === null) {
    return { ok: true, alreadyRunning: true, pid: existing.proc.pid };
  }
  // PowerShell with -NoExit so the user can read what happened. We
  // still capture stdout via the spawned process pipe — even though
  // the window is visible, we can mirror to SSE.
  const cmdline = svc.start;
  const psArgs = [
    '-NoProfile',
    '-NoExit',
    '-Command',
    `$Host.UI.RawUI.WindowTitle = 'mc:${name}'; ${cmdline}`,
  ];
  const proc = spawn('powershell.exe', psArgs, {
    cwd: svc.cwd || ROOT,
    detached: true,                              // independent of dashboard exit
    windowsHide: false,                          // show the new PS window
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.unref();
  const log = [];
  const broadcast = (line) => {
    log.push(line);
    if (log.length > 500) log.shift();
    const subs = _sseClients.get(name);
    if (!subs) return;
    for (const res of subs) {
      try { res.write(`data: ${JSON.stringify({ line })}\n\n`); } catch (_) {}
    }
  };
  proc.stdout.on('data', d => String(d).split(/\r?\n/).filter(Boolean).forEach(broadcast));
  proc.stderr.on('data', d => String(d).split(/\r?\n/).filter(Boolean).forEach(l => broadcast('[err] ' + l)));
  proc.on('exit', code => broadcast(`[exit ${code}]`));
  _spawned.set(name, { proc, log, startedAt: new Date().toISOString() });
  return { ok: true, alreadyRunning: false, pid: proc.pid };
}

// ---------- state assembly -------------------------------------------
// Single endpoint that returns everything the dashboard renders. Cheap
// — pure SQL + a tasklist scan that's cached.

async function _buildState() {
  const project = db().prepare("SELECT value FROM meta WHERE key='current_project'").get()?.value || 'cold-exit';

  const rows = db().prepare(`SELECT * FROM tasks WHERE status IN ('pending','in_progress') ORDER BY created_at ASC`).all();
  const recent = db().prepare(`SELECT * FROM tasks WHERE status IN ('done','failed') ORDER BY finished_at DESC LIMIT 10`).all();

  // Build a per-bot view: which bot is currently working on what,
  // their recent finishes, what's queued for them.
  const botList = ['claudie', 'newsie', 'thinkie', 'sortie', 'wrenchy', 'sage'];
  const bots = {};
  for (const b of botList) {
    const persona = PERSONAS[b] || BG_WORKERS[b];
    if (!persona) continue;
    const inProg = rows.find(r => r.owner === b && r.status === 'in_progress');
    const queued = rows.filter(r => r.owner === b && r.status === 'pending');
    const done = recent.filter(r => r.owner === b);
    bots[b] = {
      name: persona.name,
      emoji: persona.emoji,
      role: persona.role,
      model: persona.ackModel || persona.summaryModel || persona.model || '—',
      current: inProg
        ? { id: inProg.id, slug: inProg.slug, startedAt: inProg.started_at }
        : null,
      queued: queued.map(r => ({ id: r.id, slug: r.slug })),
      done: done.slice(0, 3).map(r => ({
        id: r.id, slug: r.slug,
        durationMs: r.duration_ms,
        status: r.status,
        finishedAt: r.finished_at,
      })),
    };
  }

  // Service status for the launch panel.
  const services = {};
  for (const k of Object.keys(SERVICES)) {
    services[k] = {
      ...await _serviceStatus(k),
      label: SERVICES[k].label,
    };
  }

  // Recent global events (any bot, any kind) for the activity feed.
  const events = db().prepare(`SELECT * FROM events ORDER BY created_at DESC LIMIT 20`).all();

  return { project, bots, services, recent, events, ts: new Date().toISOString() };
}

// ---------- HTTP routing ---------------------------------------------
function _send(res, status, body, type = 'text/plain') {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function _json(res, status, obj) {
  _send(res, status, JSON.stringify(obj, null, 2), 'application/json');
}
function _file(res, abs, type) {
  if (!fs.existsSync(abs)) return _send(res, 404, 'not found');
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(abs).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // Static
  if (p === '/' || p === '/index.html') return _file(res, path.join(__dirname, 'index.html'), 'text/html');
  if (p === '/style.css') return _file(res, path.join(__dirname, 'style.css'), 'text/css');
  if (p === '/app.js')   return _file(res, path.join(__dirname, 'app.js'),   'application/javascript');

  // API
  if (p === '/api/state') {
    try { _json(res, 200, await _buildState()); }
    catch (e) { _json(res, 500, { error: e.message }); }
    return;
  }

  if (p.startsWith('/api/launch/') && req.method === 'POST') {
    const name = p.slice('/api/launch/'.length);
    try { _json(res, 200, _launch(name)); }
    catch (e) { _json(res, 400, { error: e.message }); }
    return;
  }

  if (p.startsWith('/api/stream/')) {
    const name = p.slice('/api/stream/'.length);
    if (!SERVICES[name]) return _json(res, 404, { error: 'unknown service' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    });
    if (!_sseClients.has(name)) _sseClients.set(name, new Set());
    _sseClients.get(name).add(res);
    // Replay buffered log on connect.
    const entry = _spawned.get(name);
    if (entry) {
      for (const line of entry.log.slice(-100)) {
        res.write(`data: ${JSON.stringify({ line })}\n\n`);
      }
    } else {
      res.write(`data: ${JSON.stringify({ line: '[not running — click LAUNCH to start]' })}\n\n`);
    }
    req.on('close', () => { _sseClients.get(name)?.delete(res); });
    return;
  }

  return _send(res, 404, 'not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mc-dash] http://127.0.0.1:${PORT}`);
});
