// Wrenchy — local code-drafts worker. Runs qwen2.5-coder:32b through
// the shared local runner in 'edit' mode (terse system prompt, patch
// output format anchored to file:line).
//
// Spawns a small loop: every POLL_MS, claim the next pending task
// where owner='wrenchy', run it, mark done. Keep the loop simple —
// concurrency is N=1 by design. The 32B model owns the GPU end-to-end.

import { claimNext, markDone, markFailed } from '../queue.mjs';
import { runLocalTask } from './local_runner.mjs';
import { log, err } from '../util/log.mjs';

const POLL_MS = 5000;

let _running = false;
let _onResultPosted = null;       // optional callback (taskRow, result) — bot.mjs wires Discord post-back here

export function setOnResultPosted(fn) { _onResultPosted = fn; }

export async function startWrenchy() {
  if (_running) return;
  _running = true;
  log('wrenchy', 'started — polling every 5s');
  _loop().catch(e => err('wrenchy', `loop crashed: ${e.message}`));
}

async function _loop() {
  while (_running) {
    const task = claimNext('wrenchy');
    if (!task) {
      await _sleep(POLL_MS);
      continue;
    }
    log('wrenchy', `task #${task.id} ${task.slug} — running…`);
    const result = await runLocalTask({
      slug: task.slug,
      prompt: task.prompt,
      files: task.files,
      model: 'qwen2.5-coder:32b',
      mode: 'edit',
    });
    if (result.ok) {
      markDone({ id: task.id, outputPath: result.outputPath, summary: result.summary, durationMs: result.durationMs });
      log('wrenchy', `task #${task.id} done in ${(result.durationMs / 1000).toFixed(1)}s → ${result.outputPath}`);
    } else {
      markFailed({ id: task.id, errorText: result.error });
      err('wrenchy', `task #${task.id} failed: ${result.error}`);
    }
    if (_onResultPosted) {
      try { await _onResultPosted(task, result); } catch (e) { err('wrenchy', `post-back hook crashed: ${e.message}`); }
    }
  }
}

export function stopWrenchy() { _running = false; }

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
