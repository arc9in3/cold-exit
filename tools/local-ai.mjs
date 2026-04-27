#!/usr/bin/env node
//
// Local AI task runner. Given a prompt + scope (file globs), reads the
// matching source files, packages them into a single message, sends it
// to a local Ollama model, and writes the response to audits/<task>.md.
//
// Designed to mirror how Codex / Gemini get briefed in the multi-AI
// flow: a clear question + a bounded scope + a written report. Run
// against your 5090 + Ollama at zero cost.
//
// Setup (Windows):
//   1. Install Ollama from https://ollama.com (runs on http://localhost:11434).
//   2. Pull the models matching their lanes:
//        ollama pull qwen2.5-coder:32b   # algorithm / perf / edits
//        ollama pull deepseek-r1:32b     # reasoning / audits / planning
//   3. Test:    ollama run qwen2.5-coder:32b "say hi"
//
// Usage:
//   node tools/local-ai.mjs --task=<slug> --prompt="..." --files="src/level.js,src/encounters.js"
//   node tools/local-ai.mjs --task=<slug> --prompt-file=<path> --globs="src/**/*.js"
//   node tools/local-ai.mjs --task=<slug> --model=deepseek-r1:32b --prompt="..."
//
// Suggested task names by lane:
//   audit-*       → deepseek-r1:32b (default for audits)
//   refactor-*    → qwen2.5-coder:32b
//   perf-*        → qwen2.5-coder:32b
//
// Output: audits/<task>.md, ready for review or as a follow-up commit.

import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'node:fs/promises';

const HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1'), '..');

// ---------- arg parsing -----------------------------------------------
const args = {};
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (!m) continue;
  args[m[1]] = m[2] ?? true;
}

const task = args.task;
if (!task) {
  console.error('Missing --task=<slug>. Output is written to audits/<slug>.md.');
  process.exit(2);
}

let prompt = args.prompt;
if (!prompt && args['prompt-file']) {
  prompt = fs.readFileSync(args['prompt-file'], 'utf8');
}
if (!prompt) {
  console.error('Missing --prompt="..." or --prompt-file=<path>.');
  process.exit(2);
}

// Pick a model. Defaults bias by task slug — audits → reasoning model,
// perf / refactor / edit work → coder model. Override with --model.
const auditish = /^(audit|review|trace|find|locate)/i.test(task);
const DEFAULT_MODEL = auditish ? 'deepseek-r1:32b' : 'qwen2.5-coder:32b';
const model = args.model || DEFAULT_MODEL;

// File scope. Two ways to provide it:
//   --files=a.js,b.js       (comma-separated explicit list)
//   --globs="src/**/*.js"   (glob patterns, semicolon-separated)
async function collectFiles() {
  const out = new Set();
  if (args.files) {
    for (const f of String(args.files).split(',')) {
      const p = f.trim();
      if (p) out.add(p);
    }
  }
  if (args.globs) {
    const patterns = String(args.globs).split(';').map(s => s.trim()).filter(Boolean);
    for (const pat of patterns) {
      try {
        for await (const entry of glob(pat, { cwd: REPO_ROOT })) {
          out.add(entry);
        }
      } catch (e) {
        console.error(`glob error on "${pat}": ${e.message}`);
      }
    }
  }
  return [...out].sort();
}

// ---------- file packaging --------------------------------------------
// Each file becomes a fenced block tagged with its repo-relative path.
// Truncate per-file at 60k chars; total budget at ~400k chars (a 32B
// model with 128k context handles this comfortably as Q4_K_M on a 5090).
const PER_FILE_CHARS = 60000;
const TOTAL_BUDGET   = 400000;

async function packFiles(files) {
  const blocks = [];
  let used = 0;
  for (const rel of files) {
    const full = path.join(REPO_ROOT, rel);
    let text;
    try {
      text = fs.readFileSync(full, 'utf8');
    } catch (e) {
      blocks.push(`### ${rel}\n[unreadable: ${e.message}]\n`);
      continue;
    }
    let snippet = text;
    let truncNote = '';
    if (snippet.length > PER_FILE_CHARS) {
      truncNote = `\n[... truncated, ${snippet.length - PER_FILE_CHARS} more chars ...]`;
      snippet = snippet.slice(0, PER_FILE_CHARS);
    }
    const block = `### ${rel}\n\`\`\`\n${snippet}${truncNote}\n\`\`\`\n`;
    if (used + block.length > TOTAL_BUDGET) {
      blocks.push(`### ${rel}\n[skipped — total context budget reached]\n`);
      continue;
    }
    blocks.push(block);
    used += block.length;
  }
  return { text: blocks.join('\n'), bytes: used, count: files.length };
}

// ---------- ollama call -----------------------------------------------
async function callOllama(messages) {
  const res = await fetch(`${HOST}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      // Reasoning models (R1) use more tokens for chain-of-thought; bump
      // the cap so we don't truncate the conclusion.
      max_tokens: /r1|reasoner/i.test(model) ? 4096 : 1500,
      temperature: auditish ? 0.20 : 0.30,
      stream: false,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama HTTP ${res.status}: ${t.slice(0, 400)}`);
  }
  const json = await res.json();
  return {
    text: json.choices?.[0]?.message?.content?.trim() || '',
    usage: json.usage,
    modelUsed: json.model || model,
  };
}

// ---------- main ------------------------------------------------------
(async () => {
  const files = await collectFiles();
  console.log(`[local-ai] task=${task} model=${model} files=${files.length}`);
  if (!files.length) {
    console.warn('[local-ai] no files matched. Continuing with prompt-only context.');
  }
  const packed = await packFiles(files);
  console.log(`[local-ai] context bytes=${packed.bytes}`);

  const systemPrompt = auditish
    ? `You are a careful senior engineer doing a code audit of an existing JavaScript codebase. The user's prompt asks a specific question. Answer it by walking the provided source. Cite file:line for every claim. List concrete findings as a numbered list. End with a "Risk" line (none / low / medium / high) and a "Suggested fix" line (or "no action" if the code is correct). Be concise — every line should carry information.`
    : `You are a senior engineer working on an existing JavaScript codebase. The user asks for a code change or analysis. Be concise. When suggesting code, output exact patches anchored to file:line so a reviewer can copy-apply them. When answering questions, prefer short paragraphs over bullets.`;

  const userPrompt = files.length
    ? `${prompt}\n\n---\n\nSource files in scope:\n\n${packed.text}`
    : prompt;

  console.log(`[local-ai] calling ${HOST} ...`);
  const t0 = Date.now();
  let result;
  try {
    result = await callOllama([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
  } catch (e) {
    console.error(`[local-ai] FAILED: ${e.message}`);
    process.exit(1);
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[local-ai] done in ${dt}s, model=${result.modelUsed}`);
  if (result.usage) {
    console.log(`[local-ai] tokens: prompt=${result.usage.prompt_tokens} completion=${result.usage.completion_tokens}`);
  }

  // Write the report to audits/<task>.md.
  const auditsDir = path.join(REPO_ROOT, 'audits');
  if (!fs.existsSync(auditsDir)) fs.mkdirSync(auditsDir, { recursive: true });
  const outPath = path.join(auditsDir, `${task}.md`);
  const header = [
    `# ${task}`,
    ``,
    `Model: \`${result.modelUsed}\``,
    `Generated: ${new Date().toISOString()}`,
    `Files in scope (${files.length}): ${files.length ? files.map(f => `\`${f}\``).join(', ') : '(none)'}`,
    ``,
    `## Prompt`,
    ``,
    prompt,
    ``,
    `## Report`,
    ``,
  ].join('\n');
  fs.writeFileSync(outPath, header + result.text + '\n');
  console.log(`[local-ai] wrote ${path.relative(REPO_ROOT, outPath)}`);
})();
