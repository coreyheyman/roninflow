// Local relay for the Trading Coach's AI providers (OpenAI, Google Gemini, Anthropic, Ollama local/cloud).
// The browser can't call most AI APIs directly (CORS), so the app POSTs here and the dev server makes the call.
//
//   POST /api/ai/proxy   { url, method?, headers?, body? }  →  { status, ok, contentType, body }
//
// Only same-origin requests carrying the "x-tj-proxy" header are accepted, so other websites can't use it.

export function createAiProxy({ getVault } = {}) {
  // API keys saved on the server are referenced as {{vault:ai:<provider>}} so they never reach the browser
  const fill = (v) => { const vault = getVault?.(); return typeof v === 'string' && vault ? v.replace(/\{\{vault:([\w:.-]+)\}\}/g, (_, n) => (n.startsWith('ai:') ? vault.get(n) || '' : '')) : v; };
  const send = (res, code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { s += c; if (s.length > 30e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });

  return async function aiProxy(req, res, next) {
    const path = req.url.split('?')[0].replace(/^\/api\/ai/, '') || '/';
    if (path !== '/proxy') return next ? next() : send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

    // Same-origin guard: a custom header forces a CORS preflight that we never approve.
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (!req.headers['x-tj-proxy'] || (origin && host && new URL(origin).host !== host)) return send(res, 403, { error: 'forbidden' });

    try {
      const { url, method = 'POST', headers: rawHeaders = {}, body } = await readBody(req);
      const headers = Object.fromEntries(Object.entries(rawHeaders).map(([k, v]) => [k, fill(v)]));
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return send(res, 400, { error: 'Only http(s) URLs are allowed' });
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 180000);
      const r = await fetch(u, {
        method,
        headers: { ...headers },
        body: body === undefined || method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const text = await r.text();
      return send(res, 200, { status: r.status, ok: r.ok, contentType: r.headers.get('content-type') || '', body: text });
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'The AI provider took too long to answer (3 min).' : e.cause?.code === 'ECONNREFUSED' ? `Connection refused — is the server running at that address? (${e.cause.address || ''}:${e.cause.port || ''})` : e.message;
      return send(res, 200, { status: 0, ok: false, contentType: 'text/plain', body: msg, network: true });
    }
  };
}

export default function aiProxyPlugin() {
  const handler = createAiProxy();
  // Must not return anything (a returned function would be treated as a post hook by Vite).
  const mount = (server) => { server.middlewares.use('/api/ai', handler); };
  return { name: 'tj-ai-proxy', configureServer: mount, configurePreviewServer: mount };
}
