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
