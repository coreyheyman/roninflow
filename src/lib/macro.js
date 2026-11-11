// Macro pages: loading the data RoninFlow's server fetches (economic calendar, CFTC COT report) and the maths on it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { IS_DEMO } from './demoMode';

// ---------- loading ----------
/** GET a /api/macro endpoint; re-asks while the server is still fetching in the background. */
export function useMacro(url, { poll = 0 } = {}) {
  const [st, setSt] = useState({ loading: true, data: null, error: null });
  const alive = useRef(true);
  const load = useCallback(async (quiet) => {
    if (!url) return; // nothing to load (e.g. the top-bar pill is switched off)
    if (!quiet) setSt((s) => ({ ...s, loading: true }));
    try {
      const data = IS_DEMO ? (await import('./macroDemo')).demoMacro(url) : await fetch(url, { cache: 'no-store' }).then(async (r) => {
        const j = (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
        if (!r.ok) throw new Error(j?.error || `RoninFlow’s server didn’t answer (${r.status})`);
        return j;
      });
      if (!alive.current) return;
      setSt({ loading: false, data, error: null });
      if (data?.refreshing) setTimeout(() => alive.current && load(true), 6000);
    } catch (e) {
      if (alive.current) setSt((s) => ({ loading: false, data: s.data, error: e.message }));
    }
  }, [url]);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);
  useEffect(() => {
    if (!poll) return undefined;
    const id = setInterval(() => load(true), poll);
    return () => clearInterval(id);
  }, [load, poll]);
  return { ...st, reload: load };
}

export async function refreshMacro(what) {
  if (IS_DEMO) return { ok: true };
  const r = await fetch('/api/macro/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ what }) });
  return r.json().catch(() => ({}));
}

export * from './macroMath';
