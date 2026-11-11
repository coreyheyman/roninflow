// Trading Coach AI providers: Anthropic, OpenAI (and compatible), Google Gemini, Ollama (local + cloud).
// Requests go through the dev server's /api/ai/proxy relay (avoids CORS); falls back to a direct call.

export const PROVIDERS = {
  local: { label: 'Built-in analytics', short: 'Built-in', needsKey: false, desc: 'No AI service. Answers come from formulas run on your journal data, offline and free.' },
  anthropic: { label: 'Anthropic Claude', short: 'Claude', needsKey: true, base: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', keyUrl: 'https://console.anthropic.com/settings/keys', desc: 'Claude models via the Anthropic API.' },
  openai: { label: 'OpenAI', short: 'OpenAI', needsKey: true, base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keyUrl: 'https://platform.openai.com/api-keys', desc: 'GPT models. Also works with OpenAI-compatible servers (OpenRouter, LM Studio, Groq…) by changing the base URL.' },
  google: { label: 'Google Gemini', short: 'Gemini', needsKey: true, base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/app/apikey', desc: 'Gemini models via Google AI Studio.' },
  ollama: { label: 'Ollama (local)', short: 'Ollama', needsKey: false, base: 'http://localhost:11434', model: 'llama3.1', keyUrl: 'https://ollama.com/download', desc: 'Models running on your own computer with Ollama. Free and private.' },
  ollamaCloud: { label: 'Ollama Cloud', short: 'Ollama Cloud', needsKey: true, base: 'https://ollama.com', model: 'gpt-oss:120b', keyUrl: 'https://ollama.com/settings/keys', desc: 'Ollama-hosted models with an ollama.com API key.' },
};

/** Marker for an API key kept encrypted on the journal server (the browser never sees the key itself). */
export const VAULT = '__vault__';
export const providerConfig = (coach, id) => {
  const p = PROVIDERS[id] || PROVIDERS.local;
  const c = coach.providers?.[id] || {};
  // the relay swaps {{vault:ai:<id>}} for the saved key on the server
  const apiKey = c.apiKey === VAULT ? `{{vault:ai:${id}}}` : c.apiKey || '';
  return { apiKey, base: (c.base || p.base || '').replace(/\/+$/, ''), model: c.model || p.model || '' };
};

/** Save an API key in the server's encrypted vault. Returns true when it's stored there. */
export async function storeKey(id, key) {
  try {
    const r = await fetch('/api/vault', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `ai:${id}`, value: key || null }) });
    return r.ok;
  } catch { return false; }
}
/** Move keys typed into Coach settings into the vault; returns the coach settings with markers instead. */
export async function vaultKeys(coach) {
  const providers = { ...(coach.providers || {}) };
  for (const [id, c] of Object.entries(providers)) {
    if (!c?.apiKey || c.apiKey === VAULT) continue;
    if (await storeKey(id, c.apiKey)) providers[id] = { ...c, apiKey: VAULT };
  }
  return { ...coach, providers };
}

let proxyOk = null; // null = unknown, true/false after first try

/** fetch through the local relay; returns { status, ok, json, text } */
async function call(url, { method = 'POST', headers = {}, body } = {}) {
  if (proxyOk !== false) {
    try {
      const r = await fetch('/api/ai/proxy', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tj-proxy': '1' }, body: JSON.stringify({ url, method, headers, body }) });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
        proxyOk = true;
        const j = await r.json();
        if (j.network) throw Object.assign(new Error(j.body), { network: true });
        let json = null;
        try { json = JSON.parse(j.body); } catch { /* not json */ }
        return { status: j.status, ok: j.ok, json, text: j.body };
      }
      proxyOk = false;
    } catch (e) {
      if (e.network) throw e;
      proxyOk = false;
    }
  }
  // Direct call (works for providers that allow browser CORS, e.g. Anthropic with its opt-in header, Gemini)
  const r = await fetch(url, { method, headers, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, ok: r.ok, json, text };
}

const errText = (res, who) => {
  const m = res.json?.error?.message || res.json?.error || res.json?.message || res.text?.slice(0, 300) || `HTTP ${res.status}`;
  const hint = res.status === 401 || res.status === 403 ? ' — check the API key.' : res.status === 404 ? ' — check the model name / base URL.' : res.status === 429 ? ' — rate limit or quota reached.' : '';
  return `${who} error ${res.status}: ${typeof m === 'string' ? m : JSON.stringify(m)}${hint}`;
};

const headersFor = (id, cfg) => {
  if (id === 'anthropic') return { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  if (id === 'openai') return { 'content-type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) };
  if (id === 'google') return { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey };
  if (id === 'ollama' || id === 'ollamaCloud') return { 'content-type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) };
  return {};
};

/** List available model names for a provider (used by “Load models” and “Test connection”). */
export async function listModels(id, cfg) {
  const h = headersFor(id, cfg);
  let res;
  if (id === 'anthropic') res = await call(`${cfg.base}/v1/models?limit=100`, { method: 'GET', headers: h });
  else if (id === 'openai') res = await call(`${cfg.base}/models`, { method: 'GET', headers: h });
  else if (id === 'google') res = await call(`${cfg.base}/models?pageSize=200`, { method: 'GET', headers: h });
  else if (id === 'ollama' || id === 'ollamaCloud') res = await call(`${cfg.base}/api/tags`, { method: 'GET', headers: h });
  else return [];
  if (!res.ok) throw new Error(errText(res, PROVIDERS[id].label));
  const j = res.json || {};
  if (id === 'google') return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  if (id === 'ollama' || id === 'ollamaCloud') return (j.models || []).map((m) => m.name || m.model);
  return (j.data || []).map((m) => m.id).sort();
}

const splitDataUrl = (d) => ({ mime: d.slice(5, d.indexOf(';')), data: d.slice(d.indexOf(',') + 1) });

/**
 * Send a chat turn. history: [{role:'user'|'assistant', content}], image: data URL or null.
 * Returns the assistant's text.
 */
export const THINKING = [
  { value: 'off', label: 'Off', desc: 'Fastest. Answers straight away.' },
  { value: 'standard', label: 'Standard', desc: 'Reasons before answering. Recommended.' },
  { value: 'deep', label: 'Deep', desc: 'Thinks longest — most careful with numbers, slower and uses more of your quota.' },
];

// Errors that mean "this model doesn't take that thinking option" → retry once without it.
const unsupported = (res) => res.status === 400 || res.status === 422 || (res.status === 500 && /think/i.test(res.text || ''));

/** Provider-specific reasoning ("thinking") options. Models that don't support them get a plain request instead. */
function thinkingFor(id, model, level) {
  const m = (model || '').toLowerCase();
  if (id === 'anthropic') {
    if (level === 'off') return null;
    const budget = level === 'deep' ? 12000 : 4000;
    return { thinking: { type: 'enabled', budget_tokens: budget }, max_tokens: budget + 3000 };
  }
  if (id === 'openai') {
    if (!/^(o\d|gpt-5)/.test(m)) return null; // only reasoning models accept reasoning_effort
    return { reasoning_effort: level === 'deep' ? 'high' : level === 'off' ? 'low' : 'medium' };
  }
  if (id === 'google') {
    if (/gemini-3/.test(m)) return { generationConfig: { thinkingConfig: { thinkingLevel: level === 'off' ? 'low' : 'high' } } };
    if (/gemini-2\.5/.test(m)) return { generationConfig: { thinkingConfig: { thinkingBudget: level === 'off' ? 0 : level === 'deep' ? 24576 : -1 } } };
    return null;
  }
  if (id === 'ollama' || id === 'ollamaCloud') {
    if (level === 'off') return { think: false };
    return { think: /gpt-oss/.test(m) ? (level === 'deep' ? 'high' : 'medium') : true };
  }
  return null;
}

/** One chat turn. Returns the answer text. thinking: 'off' | 'standard' | 'deep'. */
export async function chat(id, cfg, { system, history = [], question, image, thinking = 'standard', maxTokens = 1500, longContext = false }) {
  if (PROVIDERS[id]?.needsKey && !cfg.apiKey) throw new Error(`Add your ${PROVIDERS[id].label} API key in Customization Settings.`);
  if (!cfg.model) throw new Error('Choose a model in Customization Settings.');
  const h = headersFor(id, cfg);
  const img = image ? splitDataUrl(image) : null;
  const extra0 = thinkingFor(id, cfg.model, thinking);
  // Anthropic: thinking budget + room for the answer itself
  const extra = extra0?.max_tokens ? { ...extra0, max_tokens: extra0.thinking.budget_tokens + maxTokens } : extra0;
  /** POST with the thinking options; if the model rejects them, POST again without. */
  const send = async (url, body) => {
    if (extra) {
      const merged = { ...body, ...extra, ...(extra.generationConfig ? { generationConfig: { ...(body.generationConfig || {}), ...extra.generationConfig } } : {}) };
      const res = await call(url, { headers: h, body: merged });
      if (res.ok || !unsupported(res)) return res;
    }
    return call(url, { headers: h, body });
  };

  if (id === 'anthropic') {
    const content = img ? [{ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } }, { type: 'text', text: question }] : question;
    const res = await send(`${cfg.base}/v1/messages`, { model: cfg.model, max_tokens: maxTokens, system, messages: [...history, { role: 'user', content }] });
    if (!res.ok) throw new Error(errText(res, 'Anthropic'));
    return (res.json.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('');
  }
  if (id === 'openai') {
    const content = img ? [{ type: 'text', text: question }, { type: 'image_url', image_url: { url: image } }] : question;
    const res = await send(`${cfg.base}/chat/completions`, { model: cfg.model, messages: [{ role: 'system', content: system }, ...history, { role: 'user', content }] });
    if (!res.ok) throw new Error(errText(res, 'OpenAI'));
    const msg = res.json.choices?.[0]?.message?.content;
    return Array.isArray(msg) ? msg.map((p) => p.text || '').join('') : msg || '';
  }
  if (id === 'google') {
    const parts = [{ text: question }, ...(img ? [{ inline_data: { mime_type: img.mime, data: img.data } }] : [])];
    const contents = [...history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), { role: 'user', parts }];
    const res = await send(`${cfg.base}/models/${encodeURIComponent(cfg.model)}:generateContent`, { systemInstruction: { parts: [{ text: system }] }, contents });
    if (!res.ok) throw new Error(errText(res, 'Gemini'));
    const cand = res.json.candidates?.[0];
    if (!cand) throw new Error(`Gemini returned no answer${res.json.promptFeedback?.blockReason ? ` (blocked: ${res.json.promptFeedback.blockReason})` : ''}.`);
    return (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  }
  if (id === 'ollama' || id === 'ollamaCloud') {
    const last = { role: 'user', content: question, ...(img ? { images: [img.data] } : {}) };
    const res = await send(`${cfg.base}/api/chat`, { model: cfg.model, stream: false, ...(longContext ? { options: { num_ctx: 32768 } } : {}), messages: [{ role: 'system', content: system }, ...history, last] });
    if (!res.ok) throw new Error(errText(res, PROVIDERS[id].label));
    return res.json.message?.content || '';
  }
  throw new Error('Unknown provider');
}

/** Quick check used by the settings screen. */
export async function testConnection(id, cfg) {
  const t0 = performance.now();
  const models = await listModels(id, cfg);
  const has = !cfg.model || models.includes(cfg.model) || models.some((m) => m.startsWith(cfg.model));
  return { ms: Math.round(performance.now() - t0), models, modelFound: has };
}
