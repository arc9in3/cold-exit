// Shared runner for the local-Ollama background workers (Wrenchy +
// Sage). Loads the requested file scope, packages a prompt, calls
// Ollama, writes the result to audits/<slug>.md, returns a summary.
//
// Mirrors tools/local-ai.mjs from the Cold Exit repo so the behaviour
// is identical — same num_ctx, same per-file budgets, same prompt
// shape. We re-implement instead of importing because mission-control
// is its own subdirectory with its own deps; deliberate dup.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ollamaChat } from '../util/ollama.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// PROJECT_ROOT is the root of the active codebase mission-control is
// working ON (e.g. C:\work\Personal\tacticalrogue). Audits land in
// PROJECT_ROOT/audits/ — next to the source the worker analysed.
//
// Resolution order:
//   1. MC_PROJECT_ROOT env var (set in .env after the directory move)
//   2. Fallback: assume mission-control is nested under tools/ inside
//      the project (legacy layout — pre-extract). Lets the same
//      checkout work in both locations during the migration window.
const PROJECT_ROOT = process.env.MC_PROJECT_ROOT
  ? path.resolve(process.env.MC_PROJECT_ROOT)
  : path.resolve(__dirname, '..', '..', '..', '..');
const REPO_ROOT = PROJECT_ROOT;     // alias kept for clarity in the rest of the file

// Per-file 30k chars; total 90k. Mirrors the lessons from local-ai.mjs:
// going over silently truncates the prompt FROM THE START.
const PER_FILE_CHARS = 30000;
const TOTAL_BUDGET = 90000;
const NUM_CTX = 32768;

function _packFiles(files) {
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

// `mode` is 'audit' (cautious system prompt, R1 reasoning) or 'edit'
// (terse system prompt, qwen coder, patch output format). Both write
// to audits/<slug>.md.
export async function runLocalTask({ slug, prompt, files, model, mode = 'audit' }) {
  const packed = _packFiles(files || []);
  const systemPrompt = mode === 'audit'
    ? `You are a careful senior engineer doing a code audit of an existing JavaScript codebase. Cite file:line for every claim. List concrete findings as a numbered list. End with a "Risk:" line (none|low|medium|high) and a "Suggested fix:" line. Be concise.`
    : `You are a senior engineer working on an existing JavaScript codebase. Output exact patches anchored to file:line so a reviewer can copy-apply them. Format each change as:\n\n--- file:LINE ---\nBEFORE: <old line>\nAFTER:  <new line>\n\nList ALL occurrences. Do not change behavior beyond what was asked.`;

  const userContent = files?.length
    ? `${prompt}\n\n---\n\nSource files in scope:\n\n${packed.text}`
    : prompt;

  const t0 = Date.now();
  let result;
  try {
    result = await ollamaChat({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      // R1 burns more tokens on chain-of-thought; bump cap.
      maxTokens: /r1|reasoner/i.test(model) ? 4096 : 1500,
      temperature: mode === 'audit' ? 0.20 : 0.30,
      numCtx: NUM_CTX,
    });
  } catch (e) {
    return { ok: false, error: e.message, durationMs: Date.now() - t0 };
  }
  const durationMs = Date.now() - t0;

  // Write the report next to the user's project source.
  const auditsDir = path.join(REPO_ROOT, 'audits');
  if (!fs.existsSync(auditsDir)) fs.mkdirSync(auditsDir, { recursive: true });
  const outPath = path.join(auditsDir, `${slug}.md`);
  const header = [
    `# ${slug}`,
    ``,
    `Model: \`${result.model}\``,
    `Generated: ${new Date().toISOString()}`,
    `Files in scope (${files?.length || 0}): ${files?.length ? files.map(f => `\`${f}\``).join(', ') : '(none)'}`,
    `Mode: ${mode}`,
    ``,
    `## Prompt`,
    ``,
    prompt,
    ``,
    `## Report`,
    ``,
  ].join('\n');
  fs.writeFileSync(outPath, header + result.text + '\n');

  // First-line / first-150-chars summary for the Discord post-back.
  const summary = result.text.split('\n').filter(l => l.trim()).slice(0, 3).join(' ').slice(0, 280);

  return {
    ok: true,
    outputPath: path.relative(REPO_ROOT, outPath),
    summary,
    durationMs,
    contextBytes: packed.bytes,
    tokens: result.usage,
  };
}
