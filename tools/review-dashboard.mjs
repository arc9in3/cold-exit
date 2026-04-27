#!/usr/bin/env node
// Review dashboard — local web UI for reviewing AI-authored branches
// and launching the game's static server in one place.
//
// Run with:   node tools/review-dashboard.mjs
// Or use the launcher script: review.bat (Win) / ./review.sh (Unix)
//
// What it does:
//  - Spawns two HTTP servers:
//      port 8765  — this dashboard's UI + JSON API
//      port 8080  — static file server for the game (refresh-on-checkout)
//  - Drives git operations (fetch, branches, diff, log, checkout) via
//    child_process; streams output back to the dashboard.
//  - Generates a review checklist per branch (rules vary by owner —
//    claude / codex / gemini / unknown).
//  - One-click "Open Game" button to launch the game on localhost:8080
//    against whatever branch is currently checked out.
//
// No npm dependencies — pure Node stdlib + ES modules.

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execP = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const DASH_PORT = parseInt(process.env.REVIEW_DASH_PORT || '8765', 10);
const GAME_PORT = parseInt(process.env.REVIEW_GAME_PORT || '8080', 10);

// ===========================================================================
// Helpers — git + shell
// ===========================================================================

async function git(args, opts = {}) {
  // Run a git command; return stdout. Errors throw with stderr attached.
  const cmd = `git ${args}`;
  try {
    const { stdout } = await execP(cmd, { cwd: REPO_ROOT, ...opts });
    return stdout;
  } catch (e) {
    const wrapped = new Error(`git ${args}: ${e.stderr || e.message}`);
    wrapped.stderr = e.stderr;
    wrapped.stdout = e.stdout;
    throw wrapped;
  }
}

async function gitState() {
  const [current, status, allBranches, remoteBranches] = await Promise.all([
    git('rev-parse --abbrev-ref HEAD').then(s => s.trim()),
    git('status --porcelain').then(s => s.trim()),
    git('branch --format=%(refname:short)').then(s => s.split('\n').filter(Boolean)),
    git('branch -r --format=%(refname:short)').then(s => s.split('\n').filter(Boolean)),
  ]);
  return {
    current,
    dirty: status.length > 0,
    statusText: status,
    localBranches: allBranches,
    remoteBranches: remoteBranches.filter(b => !b.endsWith('/HEAD')),
  };
}

function ownerOf(branch) {
  const stripped = branch.replace(/^origin\//, '');
  const slash = stripped.indexOf('/');
  if (slash === -1) return stripped === 'main' ? 'main' : 'unknown';
  return stripped.slice(0, slash).toLowerCase();
}

// ===========================================================================
// Plain-English file purpose mapping — translates `src/*.js` into "what
// part of the game this file is about" so non-developer reviewers can
// see at a glance which systems a branch touches.
// ===========================================================================
const FILE_PURPOSE_EXACT = {
  'src/main.js': 'core game logic (the heart of everything)',
  'src/encounters.js': 'special rooms / NPC interactions (encounters)',
  'src/gunman.js': 'gunman AI (how ranged enemies behave)',
  'src/melee_enemy.js': 'melee enemy AI (how melee enemies behave)',
  'src/player.js': 'player movement, shooting, melee',
  'src/inventory.js': 'inventory + item / weapon / armor definitions',
  'src/artifacts.js': 'relics (permanent run buffs)',
  'src/attachments.js': 'weapon attachments (sights, mags, suppressors)',
  'src/combat.js': 'shooting / hit-detection / blood / tracers',
  'src/projectiles.js': 'grenades, molotovs, rockets in flight',
  'src/level.js': 'level + map generation',
  'src/loot.js': 'ground loot (items dropped on the floor)',
  'src/tunables.js': 'balance numbers (damage, speed, drop rates)',
  'src/skills.js': 'skill tree + derived player stats',
  'src/skill_tree.js': 'skill tree node definitions',
  'src/perks.js': 'weapon + gear perks',
  'src/audio.js': 'sound effects',
  'src/scene.js': 'lighting / camera / post-processing',
  'src/actor_rig.js': 'enemy + player body rigging (procedural cylinders+spheres)',
  'src/rig_instancer.js': 'enemy rig rendering optimization',
  'src/corpse_bake.js': 'baking dead enemies into static corpse meshes',
  'src/hud.js': 'in-game HUD (HP, ammo, prompts)',
  'src/input.js': 'keyboard / mouse / gamepad input',
  'src/leaderboard.js': 'leaderboard + run-stats tracking',
  'src/prefs.js': 'persistent preferences (localStorage)',
  'src/buffs.js': 'temporary buff system',
  'src/melee_primitives.js': 'melee weapon primitive shapes',
  'src/model_manifest.js': 'weapon FBX model paths',
  'src/gltf_cache.js': 'FBX/GLTF model loader + cache',
  'src/grid_container.js': 'inventory grid math',
  'src/spatial_hash.js': 'spatial hash for AI proximity queries',
  'src/dummies.js': 'training-dummy enemies',
  'src/drones.js': 'drone enemy behaviour',
  'src/ai_separation.js': 'enemy crowd-avoidance',
  'src/bvh.js': 'bounding-volume hierarchy for raycasts',
  'index.html': 'the game webpage + CSS styles',
  'tasks.md': 'task queue (bookkeeping)',
  'PROJECT.md': 'shared AI project rules',
  'CLAUDE.md': "Claude's lane / instructions",
  'AGENTS.md': "Codex's lane / instructions",
  'GEMINI.md': "Gemini's lane / instructions",
};
const FILE_PURPOSE_PATTERNS = [
  [/^audits\//, 'audit report (Gemini findings)'],
  [/^tools\/.*bench\./i, 'performance benchmark script'],
  [/^tools\//, 'developer tooling / scripts'],
  [/^src\/ui_(\w+)/, (m) => `UI: ${m[1].replace(/_/g, ' ')}`],
  [/^\.locks\//, 'AI coordination lock'],
  [/^\.claude\/skills\//, "Claude skill (slash-command)"],
  [/^Assets\//, 'game asset (3D model / texture / audio)'],
  [/\.md$/, 'documentation'],
  [/^src\/.*\.js$/, 'game module'],
];

function describeFile(filePath) {
  if (FILE_PURPOSE_EXACT[filePath]) return FILE_PURPOSE_EXACT[filePath];
  for (const [pat, desc] of FILE_PURPOSE_PATTERNS) {
    const m = filePath.match(pat);
    if (m) return typeof desc === 'function' ? desc(m) : desc;
  }
  return 'other';
}

// Parse the per-file numstat block git outputs with --numstat.
//   added\tremoved\tpath
async function getFileStats(ref) {
  let raw = '';
  try { raw = await git(`diff main..${ref} --numstat`); } catch (_) { return []; }
  const lines = raw.trim().split('\n').filter(Boolean);
  return lines.map(l => {
    const [add, rem, ...rest] = l.split('\t');
    const file = rest.join('\t');
    return {
      file,
      added: parseInt(add || '0', 10) || 0,
      removed: parseInt(rem || '0', 10) || 0,
      purpose: describeFile(file),
    };
  });
}

// Risk flags — patterns in the filename that warrant a "watch this when
// you playtest" warning.
function riskFlagsFor(files, owner) {
  const flags = [];
  const has = (re) => files.some(f => re.test(f.file));
  if (has(/^src\/(actor_rig|rig_instancer|corpse_bake|gunman|melee_enemy)\.js$/)) {
    flags.push({
      level: 'high',
      msg: 'Rig + AI subsystem touched. Verify the InstancedMesh + corpse-bake + ghost-mode interactions: shoot enemies, watch hit flashes, kill one and confirm the corpse appears, walk in/out of fog.',
    });
  }
  if (has(/^src\/main\.js$/)) {
    flags.push({
      level: 'high',
      msg: 'Core game loop touched. Anything could be affected — playtest 2-3 minutes of normal gameplay.',
    });
  }
  if (has(/^src\/projectiles\.js$/)) {
    flags.push({
      level: 'medium',
      msg: 'Throwable physics touched. Throw a grenade, a molotov, and the maotai over a wall — verify they reach where you aimed.',
    });
  }
  if (has(/^src\/encounters\.js$/)) {
    flags.push({
      level: 'medium',
      msg: 'Encounter content changed. Trigger every encounter mentioned in the diff at least once.',
    });
  }
  if (has(/^src\/level\.js$/)) {
    flags.push({
      level: 'medium',
      msg: 'Level generation changed. Regenerate a few levels and check rooms still connect.',
    });
  }
  if (has(/^src\/tunables\.js$/)) {
    flags.push({
      level: 'low',
      msg: 'Balance numbers changed. Numbers are easy to revert — playtest the affected weapons / drops.',
    });
  }
  // Branch-owner-specific extra flags.
  if (owner === 'codex' && has(/^src\/(encounters|inventory|artifacts|player)\.js$/)) {
    flags.push({
      level: 'high',
      msg: 'Codex edited a file outside its lane (gameplay/content code). This is unusual — read the diff carefully.',
    });
  }
  if (owner === 'gemini' && files.some(f => /^src\//.test(f.file))) {
    flags.push({
      level: 'high',
      msg: 'Gemini edited source code. Audits should ONLY add files in audits/ — verify this is a refactor task, not an audit.',
    });
  }
  return flags;
}

// Heuristic plain-English summary of a branch. Combines:
//  - One-sentence headline derived from file count + purpose mix
//  - Per-file plain-English purpose
//  - Risk flags
//  - "What to playtest" guidance
function generateHeuristicSummary({ files, stats, commits, owner, isPushed }) {
  const total = files.length;
  const totalAdded = files.reduce((a, f) => a + f.added, 0);
  const totalRemoved = files.reduce((a, f) => a + f.removed, 0);
  const scale = totalAdded + totalRemoved;

  // Headline.
  let scaleWord;
  if (scale === 0) scaleWord = 'an empty';
  else if (scale < 30) scaleWord = 'a small';
  else if (scale < 200) scaleWord = 'a medium';
  else if (scale < 800) scaleWord = 'a large';
  else scaleWord = 'a sprawling';

  const purposeCounts = {};
  for (const f of files) {
    purposeCounts[f.purpose] = (purposeCounts[f.purpose] || 0) + 1;
  }
  const topPurposes = Object.entries(purposeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([p]) => p);

  const ownerLabel = owner === 'codex' ? 'Codex (algorithm work)'
                  : owner === 'gemini' ? 'Gemini (audits / sweeps)'
                  : owner === 'claude' ? 'Claude (gameplay iteration)'
                  : 'unassigned author';

  let headline;
  if (total === 0) {
    headline = `${ownerLabel} created this branch but it has no changes vs main yet.`;
  } else if (total === 1 && commits.length === 1) {
    headline = `${ownerLabel} made ${scaleWord} change touching ${files[0].purpose}.`;
  } else {
    headline = `${ownerLabel} made ${scaleWord} change across ${total} file${total === 1 ? '' : 's'}, mostly affecting ${topPurposes.join(' + ')}.`;
  }

  // Bullet "what changed" — group by purpose.
  const byPurpose = {};
  for (const f of files) {
    if (!byPurpose[f.purpose]) byPurpose[f.purpose] = [];
    byPurpose[f.purpose].push(f);
  }
  const whatChanged = Object.entries(byPurpose).map(([purpose, fs]) => {
    const names = fs.map(f => f.file).join(', ');
    const sum = fs.reduce((s, f) => s + f.added + f.removed, 0);
    return { purpose, files: names, lines: sum };
  });

  // Risk flags.
  const flags = riskFlagsFor(files, owner);

  // Test guidance — one line based on what was touched.
  const tests = [];
  if (files.some(f => /^src\/encounters\.js$/.test(f.file))) {
    tests.push('Trigger the new/modified encounter (read the diff for the encounter name) and walk through its full path.');
  }
  if (files.some(f => /^src\/(gunman|melee_enemy|actor_rig|rig_instancer|corpse_bake)/.test(f.file))) {
    tests.push('Shoot enemies, watch hit flashes, kill one, walk out of LoS and back in. Confirm corpses + ghost silhouettes work.');
  }
  if (files.some(f => /^src\/projectiles/.test(f.file))) {
    tests.push('Throw a frag, a molotov, and the maotai over a wall — they should all reach the cursor target.');
  }
  if (files.some(f => /^src\/inventory|attachments|artifacts/.test(f.file))) {
    tests.push('Pick up items, drag/drop in the inventory grid, equip a weapon attachment, take a relic from the floor.');
  }
  if (files.some(f => /^src\/level\.js$/.test(f.file))) {
    tests.push('Hit "next level" several times, walk through 3+ rooms, verify doors still open / no stuck spawns.');
  }
  if (files.some(f => /^audits\//.test(f.file))) {
    tests.push('Read the audit report. No code change to test in-game.');
  }
  if (files.some(f => /^tools\/.*bench/i.test(f.file))) {
    tests.push(`Run the benchmark: \`node ${files.find(f => /^tools\/.*bench/i.test(f.file)).file}\`. Compare numbers vs the claim.`);
  }
  if (!tests.length && files.length) {
    tests.push('Read the diff carefully — no auto-suggested test path matches. Branch may be docs-only or tooling.');
  }

  return {
    headline,
    ownerLabel,
    scale: { added: totalAdded, removed: totalRemoved, files: total, label: scaleWord.replace(/^a /, '') },
    whatChanged,
    flags,
    tests,
    pushedNote: isPushed ? null : 'NOTE: branch is local-only — push it before merging so the work isn\'t lost.',
  };
}

// ===========================================================================
// Tasks.md parser — turns the markdown table into structured records
// with plain-English-friendly fields.
// ===========================================================================
function parseTasksMd() {
  const tasksPath = path.join(REPO_ROOT, 'tasks.md');
  let raw = '';
  try { raw = fs.readFileSync(tasksPath, 'utf8'); }
  catch (_) { return { active: [], done: [], error: 'tasks.md not found' }; }
  const sections = { active: [], done: [] };
  let mode = null;
  for (const line of raw.split('\n')) {
    const heading = line.match(/^##\s+(\w+)/);
    if (heading) {
      const h = heading[1].toLowerCase();
      mode = (h === 'active' || h === 'done') ? h : null;
      continue;
    }
    if (!mode) continue;
    if (!line.startsWith('|')) continue;
    if (line.includes('---')) continue;        // separator row
    const cells = line.split('|').map(c => c.trim());
    // First and last entries from split('|') are empty — drop them.
    const fields = cells.slice(1, -1);
    if (!fields.length) continue;
    if (fields[0].toLowerCase() === 'task') continue;   // header row
    if (mode === 'active') {
      const [task, owner, status, notes] = fields;
      sections.active.push({ task, owner: owner?.toLowerCase() || 'unassigned', status: status?.toLowerCase() || 'open', notes: notes || '' });
    } else {
      const [task, owner, shipped] = fields;
      sections.done.push({ task, owner: owner?.toLowerCase() || 'unassigned', shipped: shipped || '' });
    }
  }
  return sections;
}

// ===========================================================================
// AI summary — optional, requires OPENAI_API_KEY env var.
// ===========================================================================
async function aiSummary({ branch, owner, diff, stats, commits, files }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return {
      ok: false,
      reason: 'OPENAI_API_KEY not set. Run `setx OPENAI_API_KEY "sk-..."` and restart this dashboard to enable AI summaries.',
    };
  }
  // Truncate diff to 12k chars — gpt-4o-mini handles ~128k tokens but
  // we don't want to pay for huge diffs that the heuristic summary
  // already covered.
  const trimmed = diff.length > 12000
    ? diff.slice(0, 12000) + '\n\n[... diff truncated, ' + (diff.length - 12000) + ' more chars ...]'
    : diff;
  const fileList = files.map(f => `${f.file} (+${f.added}/-${f.removed}) — ${f.purpose}`).join('\n');
  const commitList = commits.map(c => `${c.short}  ${c.subject}`).join('\n');

  const prompt = [
    { role: 'system', content: 'You are explaining a code change to someone who does not read code. Be concise. Output exactly four bullet points — no preamble, no closing remarks. Use plain English, no jargon. If a technical term is unavoidable, put a quick parenthesized hint after it.' },
    { role: 'user', content:
`Branch: ${branch}
Author: ${owner}
Files changed (${files.length}, +${stats.added}/-${stats.removed}):
${fileList || '(none)'}

Commits:
${commitList || '(none)'}

Diff:
${trimmed}

Output four bullet points in this exact order:

• What it does — one sentence, plain English, no jargon.
• What the player will notice (or "nothing user-visible" if it's invisible to the player).
• Biggest risk if this gets merged.
• The first thing the reviewer should test.`
    },
  ];

  // Direct fetch to OpenAI — node 18+ has global fetch.
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: prompt,
      max_tokens: 400,
      temperature: 0.25,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    return { ok: false, reason: `OpenAI API error ${res.status}: ${errText.slice(0, 300)}` };
  }
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content?.trim() || '';
  return {
    ok: true,
    summary: text,
    tokens: json.usage,
    model: json.model,
  };
}

// Review checklist text per owner. Hand-written based on AGENTS / GEMINI /
// CLAUDE markdown files at repo root.
function checklistFor(owner) {
  if (owner === 'codex') {
    return [
      'Files touched stay in lane (no edits to encounters / inventory / rig / ui)',
      'For perf claims: a benchmark exists in tools/ AND the diff includes wall-time numbers',
      'No new npm dependencies (no package.json changes)',
      'Co-author trailer: "Co-Authored-By: GPT (Codex) <noreply@openai.com>"',
      'Branch is pushed (visible under remotes)',
      'If the algorithm regresses vs naive, branch should be CLOSED with a closure commit, not merged',
      'Critical interactions in PROJECT.md not violated (rig instancer + corpse-bake + ghost mode triangle)',
    ];
  }
  if (owner === 'gemini') {
    return [
      'Audit branches: ONLY changes to audits/<topic>.md (no code edits in same branch)',
      'Refactor branches: scope matches what the user asked for, no opportunistic rewrites',
      'Co-author trailer: "Co-Authored-By: Gemini <noreply@google.com>"',
      'Audit format follows audits/README.md (severity grouping, file:line references)',
      'Branch is pushed (visible under remotes)',
      'Findings are actionable — no "this could be improved" without specifics',
    ];
  }
  if (owner === 'claude') {
    return [
      'Reviewed by user or /ultrareview — Claude does not self-review',
      'Co-author trailer: "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"',
      'Critical interactions in PROJECT.md respected (rig + corpse + ghost)',
      'Playtested in browser before merge',
      'One change per commit',
    ];
  }
  return [
    'Owner could not be inferred from branch name. Verify via git log.',
    'Branch follows <owner>/<task> convention before merging',
  ];
}

// ===========================================================================
// Static file server — serves the game on its own port
// ===========================================================================

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.fbx': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function staticHandler(req, res) {
  // Resolve to repo root, prevent path traversal. WHATWG URL needs a
  // base since req.url is relative (e.g. "/foo?bar=1"); the base is
  // discarded once we read .pathname.
  const parsed = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(parsed.pathname || '/');
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const safePath = path.normalize(pathname).replace(/^[\\/]+/, '');
  const fullPath = path.join(REPO_ROOT, safePath);
  if (!fullPath.startsWith(REPO_ROOT)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.stat(fullPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',     // always serve fresh during review
    });
    fs.createReadStream(fullPath).pipe(res);
  });
}

let gameServer = null;

// ===========================================================================
// CLI launcher — open Claude / Codex / Gemini in their own terminal windows
// ===========================================================================

const CLI_TARGETS = [
  { id: 'claude', title: 'Claude Code',  cli: 'claude', greeting: 'Active session — ships to main directly. Read CLAUDE.md.' },
  { id: 'codex',  title: 'Codex (GPT)',  cli: 'codex',  greeting: 'Algorithm + tooling lane. Read AGENTS.md. ALWAYS git checkout -b before editing.' },
  { id: 'gemini', title: 'Gemini',       cli: 'gemini', greeting: 'Audits + sweeps lane. Read GEMINI.md. ALWAYS git checkout -b before editing.' },
];

function launchOneCli(target) {
  if (process.platform === 'win32') {
    const greetCmd = `echo === ${target.title} === ^&^& echo. ^&^& echo ${target.greeting} ^&^& echo. ^&^& git status --short ^&^& echo.`;
    const inner = `${greetCmd} ^&^& ${target.cli}`;
    return new Promise((resolve, reject) => {
      exec(`start "${target.title}" cmd /K "${inner}"`, { cwd: REPO_ROOT }, (err) => {
        if (err) reject(err); else resolve({ id: target.id, launched: true });
      });
    });
  }
  if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script "cd ${REPO_ROOT.replace(/"/g, '\\"')} && ${target.cli}"`;
    return new Promise((resolve, reject) => {
      exec(`osascript -e '${script}'`, (err) => {
        if (err) reject(err); else resolve({ id: target.id, launched: true });
      });
    });
  }
  return Promise.resolve({
    id: target.id, launched: false,
    hint: `Linux: run manually:  cd ${REPO_ROOT} && ${target.cli}`,
  });
}

async function launchAllClis(opts = {}) {
  const status = await cliRunningStatus();
  const results = [];
  for (const t of CLI_TARGETS) {
    if (status[t.id]) {
      results.push({ id: t.id, launched: false, alreadyRunning: true });
      continue;
    }
    try { results.push(await launchOneCli(t)); }
    catch (e) { results.push({ id: t.id, launched: false, error: e.message }); }
  }
  return { results, status };
}

// Detect whether each CLI is already running by inspecting open
// console window titles. We launched them via `start "Title" cmd /K ...`
// so each window carries the title in CLI_TARGETS — match against it.
// On non-Windows, fall back to a `ps` command-line scan.
async function cliRunningStatus() {
  const out = { claude: false, codex: false, gemini: false };
  try {
    if (process.platform === 'win32') {
      // tasklist /v with CSV output. The last quoted column on each
      // row is the window title.
      const { stdout } = await execP('tasklist /v /fo csv /nh');
      const titles = [];
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/"([^"]*)"\s*$/);
        if (m) titles.push(m[1]);
      }
      for (const t of CLI_TARGETS) {
        if (titles.some(title => title.includes(t.title))) out[t.id] = true;
      }
    } else {
      const { stdout } = await execP('ps -ef');
      out.claude = /\b(claude)\b/.test(stdout);
      out.codex  = /\b(codex)\b/.test(stdout);
      out.gemini = /\b(gemini)\b/.test(stdout);
    }
  } catch (_) { /* if the probe fails, assume nothing running */ }
  return out;
}

// ===========================================================================
// Dev branch lifecycle — staging area for AI work before promotion to main
// ===========================================================================
const DEV_BRANCH = 'dev';

async function devStatus() {
  const state = await gitState();
  const hasLocal = state.localBranches.includes(DEV_BRANCH);
  const hasRemote = state.remoteBranches.includes(`origin/${DEV_BRANCH}`);
  let aheadOfMain = 0, behindMain = 0;
  if (hasLocal) {
    try {
      const ah = await git(`rev-list --count main..${DEV_BRANCH}`);
      const be = await git(`rev-list --count ${DEV_BRANCH}..main`);
      aheadOfMain = parseInt(ah.trim() || '0', 10);
      behindMain  = parseInt(be.trim() || '0', 10);
    } catch (_) { /* ignore */ }
  }
  return { hasLocal, hasRemote, aheadOfMain, behindMain };
}

async function setupOrSyncDev() {
  const state = await gitState();
  if (state.dirty) throw new Error('working tree is dirty — commit or stash first');
  const hasLocal = state.localBranches.includes(DEV_BRANCH);
  const hasRemote = state.remoteBranches.includes(`origin/${DEV_BRANCH}`);
  if (!hasLocal) {
    if (hasRemote) await git(`checkout -b ${DEV_BRANCH} origin/${DEV_BRANCH}`);
    else           await git(`checkout -b ${DEV_BRANCH}`);
  } else {
    await git(`checkout ${DEV_BRANCH}`);
  }
  await git(`merge main --ff`);
  await git(`push -u origin ${DEV_BRANCH}`);
  await git(`checkout main`);
  return await devStatus();
}

async function mergeToDev(ref) {
  const state = await gitState();
  if (state.dirty) throw new Error('working tree is dirty');
  if (state.current !== 'main') {
    throw new Error(`expected to start on main, currently on ${state.current}`);
  }
  if (!state.localBranches.includes(DEV_BRANCH)) {
    throw new Error('dev branch missing — run "Setup dev branch" first');
  }
  await git(`checkout ${DEV_BRANCH}`);
  try {
    await git(`merge ${ref} --no-ff -m "merge ${ref} into dev (staging)"`);
    await git(`push origin ${DEV_BRANCH}`);
    await git(`checkout main`);
    return { ok: true };
  } catch (e) {
    try { await git('merge --abort'); } catch (_) { /* ignore */ }
    try { await git('checkout main'); } catch (_) { /* ignore */ }
    throw new Error(`merge into dev failed: ${e.message}`);
  }
}

async function promoteToProd(refs) {
  const state = await gitState();
  if (state.dirty) throw new Error('working tree is dirty');
  if (state.current !== 'main') {
    throw new Error(`must start on main, currently on ${state.current}`);
  }
  const merged = [];
  for (const ref of refs) {
    try {
      await git(`merge ${ref} --no-ff -m "merge ${ref} into main (prod)"`);
      merged.push(ref);
    } catch (e) {
      try { await git('merge --abort'); } catch (_) { /* ignore */ }
      throw new Error(`merge ${ref} failed (after ${merged.length} successful merges): ${e.message}`);
    }
  }
  await git(`push origin main`);
  return { mergedRefs: merged };
}

function sanitizeBranchForCF(name) {
  return name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().slice(0, 28);
}

async function deployPreview(branch) {
  const cf = sanitizeBranchForCF(branch);
  const cmd = `npx wrangler pages deploy . --project-name=cold-exit --branch=${cf} --commit-dirty=true`;
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = (stdout || '') + (stderr || '');
      const urlMatch = out.match(/https?:\/\/[a-z0-9.-]+\.cold-exit\.pages\.dev/i);
      if (err) return reject(new Error(out.slice(-2000) || err.message));
      resolve({ ok: true, url: urlMatch ? urlMatch[0] : null, branch: cf, log: out.slice(-2000) });
    });
  });
}

async function deployProd() {
  const cmd = `npx wrangler pages deploy . --project-name=cold-exit --commit-dirty=true`;
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = (stdout || '') + (stderr || '');
      const urlMatch = out.match(/https?:\/\/[a-z0-9.-]+\.cold-exit\.pages\.dev/i);
      if (err) return reject(new Error(out.slice(-2000) || err.message));
      resolve({ ok: true, url: urlMatch ? urlMatch[0] : null, log: out.slice(-2000) });
    });
  });
}

function startGameServer() {
  if (gameServer) return { port: GAME_PORT, alreadyRunning: true };
  gameServer = http.createServer(staticHandler);
  return new Promise((resolve, reject) => {
    gameServer.listen(GAME_PORT, '127.0.0.1', () => {
      resolve({ port: GAME_PORT, alreadyRunning: false });
    });
    gameServer.on('error', (err) => {
      gameServer = null;
      reject(err);
    });
  });
}

function stopGameServer() {
  if (!gameServer) return false;
  gameServer.close();
  gameServer = null;
  return true;
}

// ===========================================================================
// Dashboard UI — single HTML file inlined
// ===========================================================================

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Cold Exit — Review Dashboard</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: ui-monospace, "Cascadia Code", Menlo, Consolas, monospace;
    background: #0e1018; color: #d8dde4; min-height: 100vh;
  }
  header {
    background: linear-gradient(180deg, #1a1f29 0%, #0e1018 100%);
    padding: 14px 22px; border-bottom: 1px solid #2a3340;
    display: flex; align-items: center; justify-content: space-between;
    position: sticky; top: 0; z-index: 10;
  }
  header h1 { margin: 0; font-size: 16px; letter-spacing: 4px; color: #c9a87a; text-transform: uppercase; }
  .state-row { display: flex; align-items: center; gap: 18px; font-size: 12px; }
  .state-row b { color: #c9a87a; letter-spacing: 1px; }
  .badge {
    display: inline-block; padding: 3px 9px; border-radius: 3px;
    font-size: 11px; letter-spacing: 1px;
  }
  .badge-clean { background: rgba(60, 200, 130, 0.15); color: #6ce0a0; }
  .badge-dirty { background: rgba(220, 70, 50, 0.18); color: #ff8a78; }
  main { display: grid; grid-template-columns: 320px 1fr; gap: 0; min-height: calc(100vh - 60px); }
  .panel { padding: 20px; }
  .panel.left {
    border-right: 1px solid #2a3340; background: #11141d;
    overflow-y: auto; max-height: calc(100vh - 60px);
  }
  .panel.right { background: #0e1018; }
  h2 {
    margin: 0 0 14px 0; font-size: 12px; color: #c9a87a;
    letter-spacing: 3px; text-transform: uppercase;
  }
  h2:not(:first-child) { margin-top: 28px; }
  h3 { margin: 0 0 8px 0; font-size: 12px; color: #d8dde4; }

  /* Plain-English summary blocks */
  .pe-card {
    background: linear-gradient(180deg, rgba(125, 167, 200, 0.08) 0%, rgba(125, 167, 200, 0.03) 100%);
    border: 1px solid rgba(125, 167, 200, 0.30);
    border-radius: 4px; padding: 18px 22px; margin-bottom: 18px;
  }
  .pe-card h3 {
    font-size: 11px; color: #6aa3d8;
    letter-spacing: 2px; text-transform: uppercase; margin-bottom: 12px;
  }
  .pe-headline { font-size: 14px; line-height: 1.5; color: #e8edf2; margin-bottom: 10px; }
  .pe-section { font-size: 12px; line-height: 1.55; margin-top: 12px; }
  .pe-section ul { margin: 4px 0 0 0; padding-left: 22px; }
  .pe-section li { margin-bottom: 4px; }
  .pe-section .lbl { color: #6aa3d8; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; display: block; margin-bottom: 4px; }
  .pe-purpose { color: #c9a87a; }
  .pe-files { color: #888; font-size: 11px; }

  .flag {
    padding: 8px 12px; border-radius: 3px; margin-bottom: 6px;
    font-size: 12px; line-height: 1.45;
    border-left: 3px solid;
  }
  .flag-high { background: rgba(220, 70, 50, 0.10); border-left-color: #ff8a78; color: #ffbab0; }
  .flag-medium { background: rgba(220, 160, 50, 0.10); border-left-color: #f0c060; color: #ffd99a; }
  .flag-low { background: rgba(122, 130, 144, 0.10); border-left-color: #aab2c0; color: #c0c8d2; }

  .ai-card {
    background: rgba(106, 163, 216, 0.06);
    border: 1px dashed rgba(106, 163, 216, 0.45);
    border-radius: 4px; padding: 14px 18px; margin-bottom: 18px;
  }
  .ai-card.unavailable { opacity: 0.7; }
  .ai-card pre { white-space: pre-wrap; font-family: inherit; margin: 0; line-height: 1.55; font-size: 12px; color: #d8dde4; }

  /* Tasks panel */
  .tasks-list { display: flex; flex-direction: column; gap: 10px; }
  .task-card {
    background: #11141d; border: 1px solid #2a3340;
    border-radius: 3px; padding: 14px 16px;
  }
  .task-card.in-progress { border-color: rgba(106, 163, 216, 0.55); }
  .task-card.blocked { border-color: rgba(220, 70, 50, 0.4); }
  .task-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px; flex-wrap: wrap;
  }
  .task-title { font-size: 13px; color: #d8dde4; line-height: 1.4; flex: 1; min-width: 250px; }
  .task-pill {
    display: inline-block; font-size: 10px; letter-spacing: 1px;
    padding: 2px 8px; border-radius: 2px; text-transform: uppercase;
  }
  .pill-claude { background: rgba(201, 168, 122, 0.18); color: #f0d9b0; }
  .pill-codex { background: rgba(60, 200, 130, 0.15); color: #6ce0a0; }
  .pill-gemini { background: rgba(106, 163, 216, 0.18); color: #aad0f0; }
  .pill-unassigned { background: rgba(122, 130, 144, 0.18); color: #aab2c0; }
  .pill-status-open { background: rgba(122, 130, 144, 0.18); color: #aab2c0; }
  .pill-status-in-progress { background: rgba(106, 163, 216, 0.22); color: #aad0f0; }
  .pill-status-blocked { background: rgba(220, 70, 50, 0.18); color: #ff8a78; }
  .pill-status-done { background: rgba(60, 200, 130, 0.15); color: #6ce0a0; }
  .task-notes { font-size: 11px; color: #8a96a8; margin-top: 6px; line-height: 1.5; }

  .view-toggle { display: flex; gap: 4px; margin-bottom: 14px; }
  .view-toggle button { padding: 6px 12px; font-size: 10px; }
  .view-toggle button.active {
    background: rgba(201, 168, 122, 0.30); border-color: rgba(201, 168, 122, 0.7);
    color: #f0d9b0;
  }

  button {
    background: rgba(125, 167, 200, 0.12);
    color: #cbd6e2;
    border: 1px solid rgba(125, 167, 200, 0.45);
    padding: 8px 14px; cursor: pointer;
    font-family: inherit; font-size: 11px; letter-spacing: 2px;
    text-transform: uppercase; font-weight: 600;
    border-radius: 3px; transition: all 0.12s;
  }
  button:hover:not(:disabled) {
    background: rgba(125, 167, 200, 0.22);
    border-color: rgba(125, 167, 200, 0.7);
  }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  button.primary {
    background: rgba(201, 168, 122, 0.18); border-color: rgba(201, 168, 122, 0.55);
    color: #f0d9b0;
  }
  button.primary:hover:not(:disabled) {
    background: rgba(201, 168, 122, 0.30); border-color: rgba(201, 168, 122, 0.8);
  }
  button.danger { border-color: rgba(220, 70, 50, 0.5); color: #ff8a78; }
  button.danger:hover:not(:disabled) {
    background: rgba(220, 70, 50, 0.18); border-color: rgba(220, 70, 50, 0.8);
  }

  .branch-group { margin-bottom: 18px; }
  .branch-group .label {
    font-size: 10px; color: #6a7280; letter-spacing: 2px;
    text-transform: uppercase; margin-bottom: 6px;
  }
  .branch-row {
    padding: 10px 12px; margin-bottom: 6px; cursor: pointer;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid transparent; border-radius: 3px;
    display: flex; align-items: center; justify-content: space-between;
    transition: background 0.12s;
  }
  .branch-row:hover { background: rgba(125, 167, 200, 0.08); }
  .branch-row.active { background: rgba(201, 168, 122, 0.14); border-color: rgba(201, 168, 122, 0.5); }
  .branch-row .name { font-size: 12px; }
  .branch-row .pill {
    font-size: 10px; padding: 2px 6px; border-radius: 2px;
    background: rgba(255,255,255,0.05); color: #888;
  }
  .branch-row.current .pill { background: rgba(60, 200, 130, 0.15); color: #6ce0a0; }
  .branch-row { gap: 8px; }
  .row-actions {
    display: flex; gap: 4px; flex-shrink: 0;
  }
  button.row-btn {
    padding: 3px 8px; font-size: 9px; letter-spacing: 1px;
    background: rgba(125, 167, 200, 0.10);
    border: 1px solid rgba(125, 167, 200, 0.35);
    color: #cbd6e2; border-radius: 2px;
    text-transform: uppercase; font-weight: 600; cursor: pointer;
    font-family: inherit;
  }
  button.row-btn:hover { background: rgba(125, 167, 200, 0.20); }
  button.row-btn.primary {
    background: rgba(201, 168, 122, 0.18);
    border-color: rgba(201, 168, 122, 0.55);
    color: #f0d9b0;
  }
  button.row-btn.primary:hover { background: rgba(201, 168, 122, 0.30); }
  input.row-check {
    margin-right: 4px; transform: scale(0.95); cursor: pointer;
    accent-color: #c9a87a;
  }
  .cli-row { display: flex; gap: 6px; }
  .cli-row button { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 8px; }
  .cli-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #5a606c; flex-shrink: 0;
    box-shadow: 0 0 0 2px rgba(0,0,0,0.25);
    transition: background 0.18s;
  }
  .cli-dot.running { background: #6ce0a0; box-shadow: 0 0 6px rgba(108, 224, 160, 0.55), 0 0 0 2px rgba(0,0,0,0.25); }
  .cli-row button.running { border-color: rgba(108, 224, 160, 0.55); }

  .game-controls { display: flex; gap: 8px; flex-wrap: wrap; }

  pre.diff {
    background: #11141d; border: 1px solid #2a3340; border-radius: 3px;
    padding: 14px; overflow: auto; font-size: 12px; line-height: 1.45;
    max-height: 60vh; white-space: pre; color: #c0c8d2;
  }
  pre.diff .add { color: #6ce0a0; background: rgba(60, 200, 130, 0.08); }
  pre.diff .del { color: #ff8a78; background: rgba(220, 70, 50, 0.08); }
  pre.diff .meta { color: #c9a87a; }
  pre.diff .hunk { color: #6aa3d8; }

  .checklist {
    background: rgba(201, 168, 122, 0.06);
    border-left: 3px solid #c9a87a; padding: 14px 18px;
    margin-bottom: 18px; border-radius: 0 3px 3px 0;
  }
  .checklist h3 {
    margin: 0 0 10px 0; font-size: 11px; color: #c9a87a;
    letter-spacing: 2px; text-transform: uppercase;
  }
  .checklist ul { margin: 0; padding-left: 20px; font-size: 12px; line-height: 1.6; }
  .checklist li { margin-bottom: 4px; }

  .empty {
    color: #6a7280; font-size: 12px; padding: 30px 0; text-align: center;
  }

  #server-status {
    font-size: 11px; padding: 5px 10px; border-radius: 3px;
    display: inline-block; letter-spacing: 1px;
  }
  #server-status.running { background: rgba(60, 200, 130, 0.18); color: #6ce0a0; }
  #server-status.stopped { background: rgba(122, 130, 144, 0.18); color: #aab2c0; }

  #log {
    background: #08090e; padding: 10px 14px; border-radius: 3px;
    border: 1px solid #2a3340;
    font-size: 11px; max-height: 180px; overflow-y: auto;
    white-space: pre-wrap; line-height: 1.5; color: #8a96a8;
  }
  #log .ok { color: #6ce0a0; }
  #log .err { color: #ff8a78; }

  .stats-row { display: flex; gap: 18px; flex-wrap: wrap; font-size: 11px; color: #6a7280; }
  .stats-row b { color: #d8dde4; }
</style>
</head>
<body>
<header>
  <h1>Cold Exit — Review Dashboard</h1>
  <div class="state-row">
    <span><b>HEAD:</b> <span id="state-current">…</span></span>
    <span id="state-dirty"></span>
    <span><b>SERVER:</b> <span id="server-status" class="stopped">stopped</span></span>
  </div>
</header>

<main>
  <aside class="panel left">
    <h2>Orchestration</h2>
    <div class="game-controls">
      <button id="btn-launch-all" class="primary" title="Open any not-running CLIs in new shell windows. Already-running CLIs are skipped.">Launch all 3 CLIs</button>
    </div>
    <div class="cli-row" style="margin-top:8px;">
      <button id="btn-launch-claude" data-id="claude"><span class="cli-dot" id="dot-claude"></span>Claude</button>
      <button id="btn-launch-codex"  data-id="codex"><span class="cli-dot" id="dot-codex"></span>Codex</button>
      <button id="btn-launch-gemini" data-id="gemini"><span class="cli-dot" id="dot-gemini"></span>Gemini</button>
    </div>

    <h2>Dev branch</h2>
    <div id="dev-status" style="font-size:12px; color:#8a96a8; margin-bottom:8px;">…</div>
    <div class="game-controls">
      <button id="btn-dev-setup" class="primary">Setup / sync dev</button>
      <button id="btn-deploy-dev">Deploy dev preview</button>
    </div>

    <h2>Game server (local)</h2>
    <div class="game-controls">
      <button id="btn-start" class="primary">Start server</button>
      <button id="btn-stop" class="danger">Stop server</button>
      <button id="btn-open" disabled>Open in browser</button>
    </div>

    <h2>Repo state</h2>
    <div class="game-controls">
      <button id="btn-fetch">Fetch origin</button>
      <button id="btn-refresh">Refresh state</button>
    </div>

    <h2>Branches</h2>
    <div class="game-controls" style="margin-bottom:8px;">
      <button id="btn-toggle-select">Multi-select mode</button>
      <button id="btn-promote-selected" disabled>Promote selected → prod</button>
    </div>
    <div id="branches"><div class="empty">Loading…</div></div>

    <h2>Activity</h2>
    <div id="log">Ready.</div>
  </aside>

  <section class="panel right">
    <div class="view-toggle">
      <button id="view-branches" class="active">Branch review</button>
      <button id="view-tasks">Tasks queue</button>
    </div>
    <div id="diff-view">
      <div class="empty">Select a branch on the left to review it.<br><br>Tip: click "Tasks queue" to see what each AI is currently working on.</div>
    </div>
  </section>
</main>

<script>
let state = null;
let selected = null;
let selectMode = false;
const selectedRefs = new Set();

const $ = (id) => document.getElementById(id);
const log = (msg, kind = '') => {
  const el = $('log');
  const line = document.createElement('div');
  if (kind) line.className = kind;
  line.textContent = '[' + new Date().toTimeString().slice(0,8) + '] ' + msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
};

async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  const data = r.headers.get('content-type')?.includes('application/json')
    ? await r.json()
    : await r.text();
  if (!r.ok) throw new Error((data && data.error) || ('HTTP ' + r.status));
  return data;
}

async function refreshState() {
  state = await api('/api/state');
  $('state-current').textContent = state.current;
  const dirty = $('state-dirty');
  dirty.innerHTML = state.dirty
    ? '<span class="badge badge-dirty">Dirty</span>'
    : '<span class="badge badge-clean">Clean</span>';

  // Group branches by owner.
  const groups = { main: [], claude: [], codex: [], gemini: [], unknown: [] };
  const seen = new Set();
  for (const b of state.localBranches) {
    const own = ownerOf(b);
    if (!groups[own]) groups[own] = [];
    groups[own].push({ name: b, isLocal: true, isRemote: state.remoteBranches.includes('origin/' + b) });
    seen.add(b);
  }
  for (const r of state.remoteBranches) {
    const local = r.replace(/^origin\\//, '');
    if (seen.has(local)) continue;
    const own = ownerOf(r);
    if (!groups[own]) groups[own] = [];
    groups[own].push({ name: r, isLocal: false, isRemote: true });
  }

  const root = $('branches');
  root.innerHTML = '';
  const order = ['main', 'claude', 'codex', 'gemini', 'unknown'];
  for (const owner of order) {
    const list = groups[owner];
    if (!list || !list.length) continue;
    const g = document.createElement('div');
    g.className = 'branch-group';
    g.innerHTML = '<div class="label">' + owner + '</div>';
    for (const b of list) {
      const row = document.createElement('div');
      const isCurrent = b.name === state.current;
      const isMain = b.name === 'main' || b.name === 'origin/main';
      const isDev  = b.name === 'dev'  || b.name === 'origin/dev';
      row.className = 'branch-row' + (isCurrent ? ' current' : '') + (selected === b.name ? ' active' : '');
      const pillText = isCurrent ? 'HEAD' : (b.isLocal ? 'local' : 'remote');
      // Build the row contents — checkbox (selection mode), name+pill,
      // and per-branch action buttons for non-main / non-dev branches.
      const actionBtns = (isMain || isDev) ? ''
        : '<div class="row-actions">'
          + '<button class="row-btn" data-act="diff" data-ref="' + b.name + '">Diff</button>'
          + '<button class="row-btn" data-act="dev" data-ref="' + b.name + '">→ dev</button>'
          + '<button class="row-btn primary" data-act="prod" data-ref="' + b.name + '">→ prod</button>'
          + '</div>';
      const checkbox = selectMode && !isMain && !isDev
        ? '<input type="checkbox" class="row-check" data-ref="' + b.name + '" ' + (selectedRefs.has(b.name) ? 'checked' : '') + ' onclick="event.stopPropagation()">'
        : '';
      row.innerHTML = checkbox
        + '<span class="name">' + b.name + '</span>'
        + '<span class="pill">' + pillText + '</span>'
        + actionBtns;
      row.onclick = (e) => {
        if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
        selectBranch(b.name);
      };
      // Wire row action buttons.
      row.querySelectorAll('button.row-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
          const ref = btn.dataset.ref;
          if (act === 'diff') selectBranch(ref);
          if (act === 'dev')  rowMergeToDev(ref);
          if (act === 'prod') rowPromoteToProd(ref);
        };
      });
      // Wire checkboxes for multi-select.
      const cb = row.querySelector('input.row-check');
      if (cb) cb.onchange = (e) => toggleSelection(b.name, e.target.checked);
      g.appendChild(row);
    }
    root.appendChild(g);
  }
}

function ownerOf(branch) {
  const s = branch.replace(/^origin\\//, '');
  const slash = s.indexOf('/');
  if (slash === -1) return s === 'main' ? 'main' : 'unknown';
  return s.slice(0, slash).toLowerCase();
}

async function selectBranch(name) {
  selected = name;
  document.querySelectorAll('.branch-row').forEach(r => r.classList.remove('active'));
  document.querySelectorAll('.branch-row').forEach(r => {
    if (r.querySelector('.name').textContent === name) r.classList.add('active');
  });
  await renderDiff(name);
}

async function renderDiff(branchName) {
  const view = $('diff-view');
  view.innerHTML = '<div class="empty">Loading diff…</div>';
  try {
    const target = branchName.startsWith('origin/') ? branchName : (state.remoteBranches.includes('origin/' + branchName) ? 'origin/' + branchName : branchName);
    const data = await api('/api/branch?ref=' + encodeURIComponent(target));
    const owner = ownerOf(branchName);
    const checklist = data.checklist || [];
    const summary = data.summary || {};

    let html = '';

    html += '<h2>' + branchName + '</h2>';
    html += '<div class="stats-row" style="margin-bottom: 16px;">';
    html += '<span><b>Owner:</b> ' + owner + '</span>';
    html += '<span><b>Files changed:</b> ' + (data.stats.filesChanged || 0) + '</span>';
    html += '<span><b>+' + (data.stats.added || 0) + ' / -' + (data.stats.removed || 0) + '</b></span>';
    html += '<span><b>Commits:</b> ' + (data.commits.length || 0) + '</span>';
    html += '<span><b>Pushed:</b> ' + (data.isPushed ? 'yes' : 'no') + '</span>';
    html += '</div>';

    // Plain-English summary card — heuristic, always-on.
    html += '<div class="pe-card">';
    html += '<h3>Plain English</h3>';
    html += '<div class="pe-headline">' + escape(summary.headline || '(no summary available)') + '</div>';
    if (summary.pushedNote) {
      html += '<div class="flag flag-medium">' + escape(summary.pushedNote) + '</div>';
    }
    if (summary.whatChanged && summary.whatChanged.length) {
      html += '<div class="pe-section"><span class="lbl">What changed</span><ul>';
      for (const w of summary.whatChanged) {
        html += '<li><span class="pe-purpose">' + escape(w.purpose) + '</span>'
              + ' <span class="pe-files">(' + escape(w.files) + ', ~' + w.lines + ' lines)</span></li>';
      }
      html += '</ul></div>';
    }
    if (summary.flags && summary.flags.length) {
      html += '<div class="pe-section"><span class="lbl">Watch out for</span>';
      for (const f of summary.flags) {
        html += '<div class="flag flag-' + f.level + '">' + escape(f.msg) + '</div>';
      }
      html += '</div>';
    }
    if (summary.tests && summary.tests.length) {
      html += '<div class="pe-section"><span class="lbl">What to playtest</span><ul>';
      for (const t of summary.tests) html += '<li>' + escape(t) + '</li>';
      html += '</ul></div>';
    }
    html += '</div>';

    // AI summary — collapsed by default, expandable. Disabled if no key.
    if (data.aiAvailable) {
      html += '<div class="ai-card" id="ai-card">';
      html += '<h3 style="font-size:11px; color:#aad0f0; letter-spacing:2px; text-transform:uppercase; margin: 0 0 8px 0;">AI summary (GPT-4o-mini)</h3>';
      html += '<div id="ai-body" style="color:#8a96a8; font-size:12px;">Click the button below for an AI-written plain-English explanation. Costs ~$0.001 per branch.</div>';
      html += '<div style="margin-top:10px;"><button id="btn-ai-summary" data-ref="' + escape(target) + '">Get AI summary</button></div>';
      html += '</div>';
    } else {
      html += '<div class="ai-card unavailable">';
      html += '<h3 style="font-size:11px; color:#aad0f0; letter-spacing:2px; text-transform:uppercase; margin: 0 0 8px 0;">AI summary (unavailable)</h3>';
      html += '<div style="color:#8a96a8; font-size:11px;">Set <code>OPENAI_API_KEY</code> in your environment and restart the dashboard to enable a deeper plain-English summary written by GPT-4o-mini.</div>';
      html += '</div>';
    }

    if (data.commits.length) {
      html += '<h2>Commits on this branch</h2>';
      html += '<pre class="diff" style="max-height: 200px;">' + escape(data.commits.map(c => c.short + '  ' + c.subject).join('\\n')) + '</pre>';
    }

    html += '<div class="checklist"><h3>Reviewer checklist (' + owner + ')</h3><ul>';
    for (const item of checklist) html += '<li>' + escape(item) + '</li>';
    html += '</ul></div>';

    html += '<h2>Raw diff vs main</h2>';
    html += '<pre class="diff">' + colorDiff(data.diff || '(no diff)') + '</pre>';

    html += '<div style="display:flex; gap:8px; margin-top: 16px;">';
    if (data.canCheckout) html += '<button class="primary" onclick="checkoutBranch(\\'' + branchName.replace(/^origin\\//, '') + '\\')">Checkout this branch</button>';
    html += '<button onclick="copyText(\\'' + escape(target).replace(/'/g, '\\\\\\'') + '\\')">Copy ref</button>';
    html += '</div>';

    view.innerHTML = html;
    // Wire AI summary button if present.
    const aiBtn = $('btn-ai-summary');
    if (aiBtn) aiBtn.onclick = () => fetchAiSummary(target);
  } catch (e) {
    view.innerHTML = '<div class="empty" style="color:#ff8a78">' + escape(e.message) + '</div>';
    log('diff failed: ' + e.message, 'err');
  }
}

async function fetchAiSummary(ref) {
  const body = $('ai-body');
  const btn = $('btn-ai-summary');
  if (!body || !btn) return;
  body.textContent = 'Calling OpenAI…';
  btn.disabled = true;
  try {
    const res = await api('/api/branch/ai-summary?ref=' + encodeURIComponent(ref));
    if (!res.ok) {
      body.innerHTML = '<span style="color:#ff8a78">' + escape(res.reason || 'AI summary failed') + '</span>';
      btn.disabled = false;
      return;
    }
    body.innerHTML = '<pre>' + escape(res.summary) + '</pre>';
    if (res.tokens) {
      body.innerHTML += '<div style="color:#6a7280; font-size:10px; margin-top:8px;">'
        + 'tokens: ' + (res.tokens.total_tokens || 0) + ' (prompt ' + (res.tokens.prompt_tokens || 0)
        + ' + completion ' + (res.tokens.completion_tokens || 0) + ')</div>';
    }
    btn.style.display = 'none';
    log('AI summary loaded', 'ok');
  } catch (e) {
    body.innerHTML = '<span style="color:#ff8a78">' + escape(e.message) + '</span>';
    btn.disabled = false;
  }
}

async function renderTasks() {
  const view = $('diff-view');
  view.innerHTML = '<div class="empty">Loading tasks…</div>';
  try {
    const t = await api('/api/tasks');
    let html = '<h2>Active tasks</h2>';
    html += '<div class="tasks-list">';
    if (!t.active || !t.active.length) {
      html += '<div class="empty">No active tasks. Add some to tasks.md.</div>';
    } else {
      for (const task of t.active) {
        const ownerCls = ['claude', 'codex', 'gemini'].includes(task.owner) ? task.owner : 'unassigned';
        const statusKey = (task.status || 'open').replace(/\\s+/g, '-');
        html += '<div class="task-card ' + statusKey + '">';
        html += '<div class="task-row">';
        html += '<div class="task-title">' + escape(task.task || '') + '</div>';
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
        html += '<span class="task-pill pill-' + ownerCls + '">' + escape(task.owner) + '</span>';
        html += '<span class="task-pill pill-status-' + statusKey + '">' + escape(task.status) + '</span>';
        html += '</div></div>';
        if (task.notes && task.notes.trim()) {
          html += '<div class="task-notes">' + escape(task.notes) + '</div>';
        }
        html += '</div>';
      }
    }
    html += '</div>';

    if (t.done && t.done.length) {
      html += '<h2 style="margin-top:32px;">Recently shipped</h2>';
      html += '<div class="tasks-list">';
      for (const task of t.done) {
        html += '<div class="task-card" style="opacity:0.7;">';
        html += '<div class="task-row">';
        html += '<div class="task-title">' + escape(task.task) + '</div>';
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
        html += '<span class="task-pill pill-' + task.owner + '">' + escape(task.owner) + '</span>';
        if (task.shipped) html += '<span class="task-pill pill-status-done">' + escape(task.shipped) + '</span>';
        html += '</div></div></div>';
      }
      html += '</div>';
    }
    view.innerHTML = html;
  } catch (e) {
    view.innerHTML = '<div class="empty" style="color:#ff8a78">' + escape(e.message) + '</div>';
  }
}

function escape(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function colorDiff(s) {
  return escape(s).split('\\n').map(line => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) return '<span class="meta">' + line + '</span>';
    if (line.startsWith('@@')) return '<span class="hunk">' + line + '</span>';
    if (line.startsWith('+')) return '<span class="add">' + line + '</span>';
    if (line.startsWith('-')) return '<span class="del">' + line + '</span>';
    return line;
  }).join('\\n');
}

async function checkoutBranch(name) {
  if (!confirm('Checkout ' + name + '? Working tree must be clean.')) return;
  log('checkout ' + name + '…');
  try {
    await api('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch: name }) });
    log('checkout ' + name + ' ok', 'ok');
    await refreshState();
    await renderDiff(name);
  } catch (e) { log('checkout failed: ' + e.message, 'err'); alert(e.message); }
}

async function fetchOrigin() {
  log('git fetch origin…');
  try {
    await api('/api/fetch', { method: 'POST' });
    log('fetch ok', 'ok');
    await refreshState();
  } catch (e) { log('fetch failed: ' + e.message, 'err'); }
}

async function startServer() {
  log('starting game server…');
  try {
    const r = await api('/api/server/start', { method: 'POST' });
    log('game server on http://localhost:' + r.port, 'ok');
    setServerStatus(true, r.port);
  } catch (e) { log('start failed: ' + e.message, 'err'); }
}

async function stopServer() {
  try {
    await api('/api/server/stop', { method: 'POST' });
    log('game server stopped', 'ok');
    setServerStatus(false);
  } catch (e) { log('stop failed: ' + e.message, 'err'); }
}

function setServerStatus(running, port) {
  const el = $('server-status');
  el.className = running ? 'running' : 'stopped';
  el.textContent = running ? ('running :' + port) : 'stopped';
  $('btn-open').disabled = !running;
  $('btn-open').dataset.port = port || '';
}

function copyText(t) { navigator.clipboard.writeText(t); log('copied: ' + t); }

$('btn-start').onclick = startServer;
$('btn-stop').onclick = stopServer;
$('btn-open').onclick = () => {
  const p = $('btn-open').dataset.port;
  if (p) window.open('http://localhost:' + p, '_blank');
};
$('btn-fetch').onclick = fetchOrigin;
$('btn-refresh').onclick = refreshState;

$('view-branches').onclick = () => {
  $('view-branches').classList.add('active');
  $('view-tasks').classList.remove('active');
  if (selected) renderDiff(selected);
  else $('diff-view').innerHTML = '<div class="empty">Select a branch on the left to review it.</div>';
};
$('view-tasks').onclick = () => {
  $('view-tasks').classList.add('active');
  $('view-branches').classList.remove('active');
  renderTasks();
};

// Orchestration — launch CLIs, manage dev, promote to prod.
let cliStatusCache = { claude: false, codex: false, gemini: false };

async function refreshCliStatus() {
  try {
    const s = await api('/api/clis/status');
    cliStatusCache = s;
    paintCliStatus();
  } catch (_) { /* ignore */ }
}
function paintCliStatus() {
  const ids = ['claude', 'codex', 'gemini'];
  let runningCount = 0;
  for (const id of ids) {
    const dot = $('dot-' + id);
    const btn = $('btn-launch-' + id);
    const running = !!cliStatusCache[id];
    if (running) runningCount++;
    if (dot) dot.classList.toggle('running', running);
    if (btn) {
      btn.classList.toggle('running', running);
      btn.title = running ? (id + ' is already running — click to launch another window anyway')
                          : ('launch ' + id + ' in a new shell window');
    }
  }
  const allBtn = $('btn-launch-all');
  if (allBtn) {
    if (runningCount === 3) {
      allBtn.textContent = 'All 3 CLIs running';
      allBtn.disabled = true;
    } else if (runningCount > 0) {
      allBtn.textContent = 'Launch missing ' + (3 - runningCount) + ' CLI' + (3 - runningCount === 1 ? '' : 's');
      allBtn.disabled = false;
    } else {
      allBtn.textContent = 'Launch all 3 CLIs';
      allBtn.disabled = false;
    }
  }
}

async function launchAll() {
  log('checking which CLIs are running…');
  try {
    const r = await api('/api/clis/launch-all', { method: 'POST' });
    let launched = 0, skipped = 0;
    for (const x of r.results) {
      if (x.launched) { log('  ✓ ' + x.id + ' launched', 'ok'); launched++; }
      else if (x.alreadyRunning) { log('  · ' + x.id + ' already running — skipped'); skipped++; }
      else log('  ✗ ' + x.id + ' — ' + (x.hint || x.error || 'failed'), 'err');
    }
    if (launched === 0 && skipped > 0) log('all running CLIs were already open. nothing to do.', 'ok');
    setTimeout(refreshCliStatus, 1500);
  } catch (e) { log('launch-all failed: ' + e.message, 'err'); }
}
async function launchOne(id) {
  // If already running, ask whether to spawn another window anyway.
  if (cliStatusCache[id]) {
    if (!confirm(id + ' looks like it\\'s already running. Launch another window anyway?')) return;
  }
  log('launching ' + id + '…');
  try {
    const r = await api('/api/clis/launch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, force: cliStatusCache[id] }),
    });
    if (r.alreadyRunning && !r.launched) {
      log(id + ' already running — skipped (status flag mismatch?)');
    } else {
      log(r.launched ? (id + ' launched') : (id + ' — ' + (r.hint || 'failed')), r.launched ? 'ok' : 'err');
    }
    setTimeout(refreshCliStatus, 1500);
  } catch (e) { log('launch failed: ' + e.message, 'err'); }
}
$('btn-launch-all').onclick = launchAll;
$('btn-launch-claude').onclick = () => launchOne('claude');
$('btn-launch-codex').onclick = () => launchOne('codex');
$('btn-launch-gemini').onclick = () => launchOne('gemini');

async function refreshDevStatus() {
  try {
    const d = await api('/api/dev/status');
    const el = $('dev-status');
    if (!d.hasLocal && !d.hasRemote) {
      el.innerHTML = '<span style="color:#aab2c0;">Not set up yet.</span>';
    } else {
      el.innerHTML = '<b style="color:#aad0f0;">dev</b> '
        + (d.hasRemote ? '(pushed)' : '(local only)') + ' '
        + 'ahead of main: ' + d.aheadOfMain
        + (d.behindMain ? ' · behind: ' + d.behindMain : '');
    }
  } catch (_) { /* ignore */ }
}
$('btn-dev-setup').onclick = async () => {
  if (!confirm('Setup or sync the dev branch from main? Requires clean working tree.')) return;
  log('setup dev…');
  try {
    await api('/api/dev/setup', { method: 'POST' });
    log('dev branch ready', 'ok');
    await refreshState(); await refreshDevStatus();
  } catch (e) { log('dev setup failed: ' + e.message, 'err'); alert(e.message); }
};
$('btn-deploy-dev').onclick = async () => {
  if (!confirm('Deploy the dev branch to its Cloudflare preview URL? This will take ~30s.')) return;
  log('deploying dev preview…');
  try {
    // Server picks current branch — we need to be on dev for this to make sense.
    // Quick check.
    const s = await api('/api/state');
    if (s.current !== 'dev') {
      if (!confirm('You\\'re not on the dev branch (currently: ' + s.current + '). Deploy dev anyway? (Will checkout dev first.)')) return;
      await api('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch: 'dev' }) });
    }
    const r = await api('/api/deploy/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: 'dev' }),
    });
    log('dev preview at ' + (r.url || '(see wrangler output)'), 'ok');
    if (r.url) window.open(r.url, '_blank');
  } catch (e) { log('dev deploy failed: ' + e.message, 'err'); alert(e.message); }
};

// Per-branch action buttons.
async function rowMergeToDev(ref) {
  const target = ref.startsWith('origin/') ? ref : (state && state.remoteBranches.includes('origin/' + ref) ? 'origin/' + ref : ref);
  if (!confirm('Merge ' + ref + ' into dev (staging)?')) return;
  log('merge ' + ref + ' → dev…');
  try {
    await api('/api/dev/merge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: target }) });
    log(ref + ' merged into dev', 'ok');
    await refreshState(); await refreshDevStatus();
  } catch (e) { log('merge → dev failed: ' + e.message, 'err'); alert(e.message); }
}
async function rowPromoteToProd(ref) {
  const target = ref.startsWith('origin/') ? ref : (state && state.remoteBranches.includes('origin/' + ref) ? 'origin/' + ref : ref);
  if (!confirm('PROMOTE ' + ref + ' to prod (merge into main + deploy live)? This goes to cold-exit.pages.dev.')) return;
  log('promote ' + ref + ' → prod…');
  try {
    await api('/api/prod/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refs: [target] }) });
    log(ref + ' merged into main', 'ok');
    if (confirm('Deploy main to prod now?')) {
      const r = await api('/api/deploy/prod', { method: 'POST' });
      log('prod deploy: ' + (r.url || 'done'), 'ok');
      if (r.url) window.open(r.url, '_blank');
    }
    await refreshState();
  } catch (e) { log('promote failed: ' + e.message, 'err'); alert(e.message); }
}

// Selection mode for bulk promotion.
function toggleSelection(ref, checked) {
  if (checked) selectedRefs.add(ref); else selectedRefs.delete(ref);
  $('btn-promote-selected').disabled = selectedRefs.size === 0;
  $('btn-promote-selected').textContent = 'Promote ' + selectedRefs.size + ' → prod';
}
$('btn-toggle-select').onclick = () => {
  selectMode = !selectMode;
  $('btn-toggle-select').classList.toggle('primary', selectMode);
  $('btn-toggle-select').textContent = selectMode ? 'Exit select mode' : 'Multi-select mode';
  if (!selectMode) selectedRefs.clear();
  $('btn-promote-selected').disabled = selectedRefs.size === 0;
  $('btn-promote-selected').textContent = selectedRefs.size ? ('Promote ' + selectedRefs.size + ' → prod') : 'Promote selected → prod';
  refreshState();
};
$('btn-promote-selected').onclick = async () => {
  if (!selectedRefs.size) return;
  const refs = [...selectedRefs];
  if (!confirm('PROMOTE ' + refs.length + ' branch(es) to prod?\\n\\n' + refs.join('\\n'))) return;
  log('promoting ' + refs.length + ' branches → prod…');
  try {
    const targets = refs.map(r => r.startsWith('origin/') ? r : ('origin/' + r));
    await api('/api/prod/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refs: targets }) });
    log('all merged into main', 'ok');
    if (confirm('Deploy main to prod now?')) {
      const r = await api('/api/deploy/prod', { method: 'POST' });
      log('prod deploy: ' + (r.url || 'done'), 'ok');
      if (r.url) window.open(r.url, '_blank');
    }
    selectedRefs.clear();
    selectMode = false;
    $('btn-toggle-select').textContent = 'Multi-select mode';
    $('btn-toggle-select').classList.remove('primary');
    $('btn-promote-selected').disabled = true;
    $('btn-promote-selected').textContent = 'Promote selected → prod';
    await refreshState();
  } catch (e) { log('bulk promote failed: ' + e.message, 'err'); alert(e.message); }
};

async function init() {
  await refreshState();
  await refreshDevStatus();
  await refreshCliStatus();
  try {
    const s = await api('/api/server/status');
    setServerStatus(s.running, s.port);
  } catch (e) { /* ignore */ }
  // Poll CLI status every 6 seconds so the dots reflect reality
  // when the user opens / closes terminal windows outside the dashboard.
  setInterval(refreshCliStatus, 6000);
}
init();
</script>
</body>
</html>
`;

// ===========================================================================
// Dashboard HTTP server — UI + API
// ===========================================================================

async function dashApi(req, res, parsedUrl) {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const sendErr = (code, msg) => send(code, { error: msg });

  try {
    if (parsedUrl.pathname === '/api/state' && req.method === 'GET') {
      return send(200, await gitState());
    }
    if (parsedUrl.pathname === '/api/fetch' && req.method === 'POST') {
      await git('fetch origin --prune');
      return send(200, { ok: true });
    }
    if (parsedUrl.pathname === '/api/branch' && req.method === 'GET') {
      const ref = parsedUrl.query.ref;
      if (!ref) return sendErr(400, 'missing ref');

      const owner = ownerOf(ref);
      const checklist = checklistFor(owner);

      // Diff vs main, log of commits unique to this branch.
      let diff = '';
      let commits = [];
      let stats = { filesChanged: 0, added: 0, removed: 0 };
      let isPushed = true;

      const localName = ref.replace(/^origin\//, '');
      const remoteName = ref.startsWith('origin/') ? ref : `origin/${localName}`;

      try {
        diff = await git(`diff main..${ref} --no-color`);
      } catch (_) {
        diff = '';
      }

      try {
        const statRaw = await git(`diff main..${ref} --shortstat`);
        const m = statRaw.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
        if (m) {
          stats.filesChanged = parseInt(m[1] || '0', 10);
          stats.added = parseInt(m[2] || '0', 10);
          stats.removed = parseInt(m[3] || '0', 10);
        }
      } catch (_) { /* ignore */ }

      try {
        const logRaw = await git(`log main..${ref} --oneline --no-color`);
        commits = logRaw.trim().split('\n').filter(Boolean).map(line => {
          const idx = line.indexOf(' ');
          return { short: line.slice(0, idx), subject: line.slice(idx + 1) };
        });
      } catch (_) { commits = []; }

      try {
        await git(`rev-parse --verify ${remoteName}`);
        isPushed = true;
      } catch (_) {
        isPushed = false;
      }

      // Can checkout if the branch exists locally OR can be tracked from remote.
      const state = await gitState();
      const canCheckout = state.localBranches.includes(localName)
        || state.remoteBranches.includes(remoteName);

      // Heuristic plain-English summary.
      const files = await getFileStats(ref);
      const summary = generateHeuristicSummary({ files, stats, commits, owner, isPushed });
      const aiAvailable = !!process.env.OPENAI_API_KEY;

      return send(200, {
        ref, owner, checklist, diff, stats, commits, isPushed, canCheckout,
        files, summary, aiAvailable,
      });
    }
    if (parsedUrl.pathname === '/api/branch/ai-summary' && req.method === 'GET') {
      const ref = parsedUrl.query.ref;
      if (!ref) return sendErr(400, 'missing ref');
      const owner = ownerOf(ref);
      let diff = '';
      try { diff = await git(`diff main..${ref} --no-color`); } catch (_) { /* ignore */ }
      const files = await getFileStats(ref);
      let commits = [];
      try {
        const logRaw = await git(`log main..${ref} --oneline --no-color`);
        commits = logRaw.trim().split('\n').filter(Boolean).map(line => {
          const idx = line.indexOf(' ');
          return { short: line.slice(0, idx), subject: line.slice(idx + 1) };
        });
      } catch (_) { commits = []; }
      let statsObj = { filesChanged: files.length, added: 0, removed: 0 };
      for (const f of files) { statsObj.added += f.added; statsObj.removed += f.removed; }
      const result = await aiSummary({ branch: ref, owner, diff, stats: statsObj, commits, files });
      return send(200, result);
    }
    if (parsedUrl.pathname === '/api/tasks' && req.method === 'GET') {
      return send(200, parseTasksMd());
    }
    if (parsedUrl.pathname === '/api/checkout' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.branch) return sendErr(400, 'missing branch');
      const name = String(body.branch).replace(/^origin\//, '');
      const state = await gitState();
      if (state.dirty) return sendErr(409, 'working tree is dirty — commit or stash first');
      // If local branch exists, just checkout. Otherwise track from remote.
      if (state.localBranches.includes(name)) {
        await git(`checkout ${name}`);
      } else {
        await git(`checkout -b ${name} origin/${name}`);
      }
      return send(200, { ok: true });
    }
    if (parsedUrl.pathname === '/api/server/start' && req.method === 'POST') {
      const r = await startGameServer();
      return send(200, r);
    }
    if (parsedUrl.pathname === '/api/server/stop' && req.method === 'POST') {
      const stopped = stopGameServer();
      return send(200, { stopped });
    }
    if (parsedUrl.pathname === '/api/server/status' && req.method === 'GET') {
      return send(200, { running: !!gameServer, port: gameServer ? GAME_PORT : null });
    }
    if (parsedUrl.pathname === '/api/clis/launch-all' && req.method === 'POST') {
      return send(200, await launchAllClis());
    }
    if (parsedUrl.pathname === '/api/clis/launch' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const target = CLI_TARGETS.find(t => t.id === body.id);
      if (!target) return sendErr(400, 'unknown CLI id');
      const running = await cliRunningStatus();
      if (running[target.id] && !body.force) {
        return send(200, { id: target.id, launched: false, alreadyRunning: true });
      }
      return send(200, await launchOneCli(target));
    }
    if (parsedUrl.pathname === '/api/clis/status' && req.method === 'GET') {
      return send(200, await cliRunningStatus());
    }
    if (parsedUrl.pathname === '/api/dev/status' && req.method === 'GET') {
      return send(200, await devStatus());
    }
    if (parsedUrl.pathname === '/api/dev/setup' && req.method === 'POST') {
      return send(200, await setupOrSyncDev());
    }
    if (parsedUrl.pathname === '/api/dev/merge' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ref) return sendErr(400, 'missing ref');
      return send(200, await mergeToDev(body.ref));
    }
    if (parsedUrl.pathname === '/api/prod/promote' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const refs = Array.isArray(body.refs) ? body.refs : (body.ref ? [body.ref] : []);
      if (!refs.length) return sendErr(400, 'missing refs');
      return send(200, await promoteToProd(refs));
    }
    if (parsedUrl.pathname === '/api/deploy/preview' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const state = await gitState();
      const branch = body.branch || state.current;
      return send(200, await deployPreview(branch));
    }
    if (parsedUrl.pathname === '/api/deploy/prod' && req.method === 'POST') {
      const state = await gitState();
      if (state.current !== 'main') return sendErr(409, `must be on main to deploy prod (currently on ${state.current})`);
      return send(200, await deployProd());
    }
    return sendErr(404, 'unknown endpoint');
  } catch (e) {
    return sendErr(500, e.message || String(e));
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const dashServer = http.createServer(async (req, res) => {
  // Wrap req.url in a WHATWG URL — base is dummy since req.url is
  // already absolute-on-host. Expose a .query helper that mirrors
  // the legacy url.parse(true) shape so existing handlers don't
  // need to switch to searchParams.get() everywhere.
  const parsed = new URL(req.url, 'http://localhost');
  parsed.query = Object.fromEntries(parsed.searchParams);
  if (parsed.pathname.startsWith('/api/')) return dashApi(req, res, parsed);
  if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }
  res.writeHead(404); res.end('not found');
});

dashServer.listen(DASH_PORT, '127.0.0.1', () => {
  console.log(`Cold Exit review dashboard:`);
  console.log(`  Dashboard:   http://localhost:${DASH_PORT}/`);
  console.log(`  Game server: http://localhost:${GAME_PORT}/  (start from dashboard)`);
  console.log(`Press Ctrl+C to stop.`);
});

process.on('SIGINT', () => {
  if (gameServer) gameServer.close();
  dashServer.close();
  process.exit(0);
});
