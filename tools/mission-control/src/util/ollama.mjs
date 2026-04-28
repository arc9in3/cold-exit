// Ollama client — OpenAI-compatible chat completions. Same shape as
// tools/local-ai.mjs uses, factored for reuse across workers.
//
// Honors the same num_ctx-must-be-explicit lesson: Ollama silently
// truncates prompts to its default ctx (2k-4k) without an override,
// and the model then answers the wrong question.

const HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

export async function ollamaChat({
  model,
  messages,
  temperature = 0.3,
  maxTokens = 1500,
  numCtx = 8192,
}) {
  const res = await fetch(`${HOST}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
      options: { num_ctx: numCtx },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Ollama HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = await res.json();
  return {
    text: json.choices?.[0]?.message?.content?.trim() || '',
    usage: json.usage,
    model: json.model || model,
  };
}

// Quick reachability probe — used by personas that fall back to local
// models when ANTHROPIC_API_KEY is missing.
export async function ollamaUp() {
  try {
    const r = await fetch(`${HOST}/api/tags`, { method: 'GET' });
    return r.ok;
  } catch (_) {
    return false;
  }
}
