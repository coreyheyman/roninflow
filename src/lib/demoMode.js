// The public demo site is the same app built with VITE_DEMO=1: a made-up journal kept only in the visitor's browser,
// with features that need the RoninFlow server (live sync, broker logins, backups, password) explained instead.
export const IS_DEMO = (() => { try { return import.meta.env?.VITE_DEMO === '1'; } catch { return false; } })();
export const REPO_URL = 'https://github.com/coreyheyman/roninflow';
export const DOWNLOAD_URL = `${REPO_URL}/releases/latest`;

/** In the demo there is no server: answer its API calls in the browser so nothing waits on the network. */
export function installDemoFetch() {
  if (!IS_DEMO || typeof window === 'undefined' || window.__demoFetch) return;
  window.__demoFetch = true;
  const real = window.fetch.bind(window);
  const reply = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.startsWith('/api/')) return real(input, init);
    if (url.startsWith('/api/candles')) return reply(424, { error: 'Execution charts use price data from RoninFlow running on your computer (your platform add-on or your own data key). Not available in the demo.' });
    return reply(404, { error: 'Not available in the demo — this needs RoninFlow running on your computer.' });
  };
}
