// Claudie — orchestrator + status responder. Doesn't do "real" work
// itself; routes incoming Discord commands to Wrenchy/Sage and posts
// the status digest on /status.
//
// "Real reasoning" by Claudie happens in the user's interactive Claude
// Code session — when a task needs that, Claudie posts a placeholder
// to #claudie tagging the user, who picks it up here in Claude Code,
// composes a real answer, and pastes it back. The bot logs it as a
// claudie task so the history is complete.
//
// Routine acks (queue confirmations, status formatting) use a small
// local model so they're free + fast.

import { ollamaChat } from '../util/ollama.mjs';
import { pendingTasks, recentDone } from '../queue.mjs';
import { PERSONAS, BG_WORKERS } from '../personas.mjs';

// Quick router — slug prefix → owner. Caller can override.
export function pickOwner(slug) {
  if (/^audit-|^review-|^trace-|^find-|^locate-/i.test(slug)) return 'sage';
  if (/^refactor-|^rename-|^perf-|^draft-|^impl-/i.test(slug)) return 'wrenchy';
  return 'wrenchy';   // default to coder for ambiguous slugs
}

// Build a status report — pure SQL, no LLM call. Used by /status.
// Returns a structured object the bot can render as a Discord embed.
export function statusReport() {
  const inProgress = pendingTasks().filter(t => t.status === 'in_progress');
  const queued = pendingTasks().filter(t => t.status === 'pending');
  const done = recentDone(5);
  return { inProgress, queued, done };
}

// One-line ack for "task queued". Local-model call — fast + free.
// Falls back to a templated string if Ollama isn't reachable.
export async function ackQueue(slug, owner, reason) {
  const fallback = `📋 Queued **${slug}** → routed to **${owner}**${reason ? ` · ${reason}` : ''}`;
  try {
    const r = await ollamaChat({
      model: PERSONAS.claudie.ackModel,
      messages: [
        { role: 'system', content: PERSONAS.claudie.systemPrompt },
        { role: 'user', content: `New task queued: slug=${slug}, owner=${owner}, reason=${reason || 'default routing'}. Ack it in one sentence.` },
      ],
      maxTokens: 80,
      temperature: 0.4,
      numCtx: 4096,
    });
    return r.text || fallback;
  } catch (_) {
    return fallback;
  }
}
