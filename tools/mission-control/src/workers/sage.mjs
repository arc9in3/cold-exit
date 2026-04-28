// Sage — local code-audit worker. Same shape as Wrenchy but runs
// deepseek-r1:32b in 'audit' mode. Cautious system prompt, longer
// max_tokens (R1 burns chain-of-thought).

import { claimNext, markDone, markFailed } from '../queue.mjs';
import { runLocalTask } from './local_runner.mjs';
import { log, err } from '../util/log.mjs';

const POLL_MS = 5000;

let _running = false;
let _onResultPosted = null;

export function setOnResultPosted(fn) { _onResultPosted = fn; }

export async function startSage() {
  if (_running) return;
  _running = true;
  log('sage', 'started — polling every 5s');
  _loop().catch(e => err('sage', `loop crashed: ${e.message}`));
}

async function _loop() {
  while (_running) {
    const task = claimNext('sage');
    if (!task) {
      await _sleep(POLL_MS);
      continue;
    }
    log('sage', `task #${task.id} ${task.slug} — running…`);
    const result = await runLocalTask({
      slug: task.slug,
      prompt: task.prompt,
      files: task.files,
      model: 'deepseek-r1:32b',
      mode: 'audit',
    });
    if (result.ok) {
      markDone({ id: task.id, outputPath: result.outputPath, summary: result.summary, durationMs: result.durationMs });
      log('sage', `task #${task.id} done in ${(result.durationMs / 1000).toFixed(1)}s → ${result.outputPath}`);
    } else {
      markFailed({ id: task.id, errorText: result.error });
      err('sage', `task #${task.id} failed: ${result.error}`);
    }
    if (_onResultPosted) {
      try { await _onResultPosted(task, result); } catch (e) { err('sage', `post-back hook crashed: ${e.message}`); }
    }
  }
}

export function stopSage() { _running = false; }

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
