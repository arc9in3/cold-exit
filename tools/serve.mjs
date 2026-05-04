#!/usr/bin/env node
// Cold Exit local dev server. Zero deps — uses Node's built-in http.
// Pinned to port 8080 so coop-test-launch.sh's `local` mode and any
// Playwright MCP runs hit the same URL without configuration.
//
// Usage:
//   node tools/serve.mjs           # serves repo root on http://localhost:8080
//   PORT=9000 node tools/serve.mjs # override port
//
// Why not python -m http.server: that one doesn't set the JS module
// MIME type correctly on Windows, which silently breaks ES-module
// imports in Chrome. This server hard-codes the right Content-Type.

import { createServer } from 'node:http';
import { stat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.glb':  'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.fbx':  'application/octet-stream',
  '.wav':  'audio/wav',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
};

// POST /api/save-weapon-tuning — patches src/model_manifest.js in place
// with entries from the pose-editor's weapon transform panel.
//
// Body shape:
//   { gripOffsets:        { '<path>': { x, y, z }, ... },
//     rotationOverrides:  { '<path>': { x, y, z }, ... },
//     scaleOverrides:     { '<path>': <number>,    ... } }
//
// Strategy: locate each of the three `export const <name> = { ... };`
// object literals via brace counting, then for each entry either
// replace the existing key's line in place (preserving indent and any
// trailing comment) or insert a new line just before the closing
// brace. Existing manifest comments and formatting are otherwise
// preserved.
const MANIFEST_PATH = resolve(ROOT, 'src', 'model_manifest.js');
function patchManifestObject(content, objectName, entries, valueFmt) {
  if (!entries || !Object.keys(entries).length) return { content, changed: 0 };
  const startMarker = `export const ${objectName} = {`;
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`Manifest: no ${objectName}`);
  let depth = 1;
  let i = startIdx + startMarker.length;
  while (i < content.length && depth > 0) {
    const c = content[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) throw new Error(`Manifest: unbalanced braces in ${objectName}`);
  const bodyStart = startIdx + startMarker.length;
  const bodyEnd = i;
  let body = content.slice(bodyStart, bodyEnd);
  let changed = 0;
  for (const [key, value] of Object.entries(entries)) {
    const valStr = valueFmt(value);
    const keyEsc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^([ \\t]*)'${keyEsc}':[ \\t]*[^\\n]*$`, 'm');
    const m = body.match(re);
    if (m) {
      body = body.replace(re, `${m[1]}'${key}': ${valStr},`);
    } else {
      // Insert before the closing '}'. Trim any trailing whitespace
      // from body, append our line, restore newline so the closing
      // brace lands on its own line.
      const trimmed = body.replace(/[\s\n]+$/, '');
      body = trimmed + `\n  '${key}': ${valStr},\n`;
    }
    changed++;
  }
  return {
    content: content.slice(0, bodyStart) + body + content.slice(bodyEnd),
    changed,
  };
}
function fmtVec3(v) {
  const n = (x) => Number((+x).toFixed(3));
  return `{ x: ${n(v.x).toFixed(3)}, y: ${n(v.y).toFixed(3)}, z: ${n(v.z).toFixed(3)} }`;
}
function fmtScale(n) {
  return Number((+n).toFixed(4)).toString();
}
async function handleSaveWeaponTuning(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    res.writeHead(400); res.end('Bad JSON'); return;
  }
  const grip  = payload.gripOffsets       || {};
  const rot   = payload.rotationOverrides || {};
  const scale = payload.scaleOverrides    || {};
  let content;
  try {
    content = await readFile(MANIFEST_PATH, 'utf8');
  } catch (e) {
    res.writeHead(500); res.end(`read failed: ${e.message}`); return;
  }
  let report;
  try {
    let n = 0;
    let r = patchManifestObject(content, 'MODEL_GRIP_OFFSET',       grip,  fmtVec3); content = r.content; n += r.changed;
    r     = patchManifestObject(content, 'MODEL_ROTATION_OVERRIDE', rot,   fmtVec3); content = r.content; n += r.changed;
    r     = patchManifestObject(content, 'MODEL_SCALE_OVERRIDE',    scale, fmtScale); content = r.content; n += r.changed;
    report = { entriesPatched: n };
  } catch (e) {
    res.writeHead(500); res.end(`patch failed: ${e.message}`); return;
  }
  try {
    await writeFile(MANIFEST_PATH, content, 'utf8');
  } catch (e) {
    res.writeHead(500); res.end(`write failed: ${e.message}`); return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, ...report, path: 'src/model_manifest.js' }));
}

// POST /api/save-pose/<name> — writes JSON body to Assets/poses/<name>.json.
// Restricted: name must be alphanumeric+dash, write path must stay inside
// Assets/poses/. Used by the rig_tuner pose authoring flow.
const POSES_DIR = resolve(ROOT, 'Assets', 'poses');
async function handleSavePose(req, res, name) {
  if (!/^[a-z0-9_-]{1,40}$/i.test(name)) {
    res.writeHead(400); res.end('Bad pose name'); return;
  }
  const target = normalize(join(POSES_DIR, `${name}.json`));
  if (!target.startsWith(POSES_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8');
  try { JSON.parse(body); } catch { res.writeHead(400); res.end('Bad JSON'); return; }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body, 'utf8');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ saved: name, path: `Assets/poses/${name}.json` }));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);

    if (req.method === 'POST' && pathname.startsWith('/api/save-pose/')) {
      const name = pathname.slice('/api/save-pose/'.length);
      await handleSavePose(req, res, name);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/save-weapon-tuning') {
      await handleSaveWeaponTuning(req, res);
      return;
    }

    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    const s = await stat(filePath).catch(() => null);
    if (!s || !s.isFile()) {
      res.writeHead(404); res.end('Not found'); return;
    }

    const ext = extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      // Cross-origin-isolation headers — harmless and future-proof if
      // we ever need SharedArrayBuffer (web workers, audio worklets).
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500); res.end(`Server error: ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`Cold Exit dev server: http://localhost:${PORT}/`);
  console.log(`Coop test mode:       http://localhost:${PORT}/?coop=1`);
  console.log(`Stop with Ctrl+C.`);
});
