// Macro data series for the Macro pages (rates, liquidity, credit, the economy, inflation, G10, the comparator…):
// FRED (Federal Reserve Bank of St. Louis) through its public CSV download, which needs no API key, and the New York
// Fed's Primary Dealer Statistics. Each series is cached on disk and refreshed in the background once it's stale, so a
// page opens instantly with what was saved.
//   GET /api/macro/fred?ids=DGS10,DGS2[&from=YYYY-MM-DD]   → { series: { DGS10: { obs: [[date, value]…], at, error } }, refreshing }
//   GET /api/macro/fred/pd?ids=PDPOSGST-TOT,…[&from=…]     → the same shape, values in $ billions
import fs from 'node:fs';
import path from 'node:path';

const UA = 'Mozilla/5.0 (RoninFlow trading journal; +https://github.com/coreyheyman/roninflow)';
const HOUR = 3600e3, DAY = 24 * HOUR;
const FRED_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=';
const NYFED_PD = 'https://markets.newyorkfed.org/api/pd/get/';
const ID_RE = /^[A-Z0-9][A-Z0-9_.-]{0,40}$/i;
const PARALLEL = 3;

/** FRED's CSV (header "observation_date,ID" or "DATE,ID"; "." or blank for a missing value) → [[date, value], …] */
export function parseFredCsv(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const [d, v] = line.split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) continue;
    const n = Number(v);
    if (v == null || v.trim() === '' || v.trim() === '.' || !Number.isFinite(n)) continue;
    out.push([d, n]);
  }
  return out;
}

/** The New York Fed's primary dealer JSON → [[date, value in $ billions], …]. Looks for the rows wherever they sit. */
export function parsePd(json, keyid) {
  const rows = [];
  const walk = (x) => {
    if (Array.isArray(x)) { for (const y of x) walk(y); return; }
    if (!x || typeof x !== 'object') return;
    const date = x.asofdate || x.asOfDate || x.date;
    if (date && 'value' in x && (!keyid || !x.keyid || String(x.keyid).toUpperCase() === keyid.toUpperCase())) {
      const n = Number(String(x.value).replace(/,/g, ''));
      if (/^\d{4}-\d{2}-\d{2}/.test(date) && Number.isFinite(n)) rows.push([String(date).slice(0, 10), n / 1000]); // published in $ millions
      return;
    }
    for (const v of Object.values(x)) walk(v);
  };
  walk(json);
  const by = new Map(rows.map((r) => [r[0], r]));
  return [...by.values()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** How often a series moves, from the gap between its last observations: how long a saved copy stays fresh. */
export function staleAfter(obs) {
  if (!obs?.length || obs.length < 3) return 4 * HOUR;
  const tail = obs.slice(-6);
  const gaps = tail.slice(1).map((r, i) => (Date.parse(r[0]) - Date.parse(tail[i][0])) / DAY).sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)];
  return gap <= 3 ? 4 * HOUR : gap <= 8 ? 12 * HOUR : 24 * HOUR;
}

export function createFredHandler(dataDir, { log = () => {}, fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}) {
  const dir = path.join(dataDir, 'macro', 'series');
  const file = (src, id) => path.join(dir, `${src}-${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
  const mem = new Map();
  const read = (src, id) => {
    const k = `${src}:${id}`;
    if (!mem.has(k)) { try { mem.set(k, JSON.parse(fs.readFileSync(file(src, id), 'utf8'))); } catch { mem.set(k, null); } }
    return mem.get(k);
  };
  const write = (src, id, v) => {
    mem.set(`${src}:${id}`, v);
    try { fs.mkdirSync(dir, { recursive: true }); const f = file(src, id), tmp = `${f}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, f); } catch (e) { log('[fred] save:', e.message); }
  };

  // a small queue so opening a page with 20 series doesn't fire 20 requests at once
  const queue = [], inflight = new Set();
  let running = 0, pausedUntil = 0, pumpTimer = null;
  const pump = () => {
    if (now() < pausedUntil) { if (!pumpTimer) pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, pausedUntil - now() + 50); return; } // FRED asked us to slow down
    while (running < PARALLEL && queue.length) {
      const job = queue.shift();
      running++;
      job().finally(() => { running--; pump(); });
    }
  };
  const fetchText = async (url, accept) => {
    const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return text;
  };
  const sources = {
    fred: async (id) => {
      const obs = parseFredCsv(await fetchText(FRED_CSV + encodeURIComponent(id), 'text/csv'));
      if (!obs.length) throw new Error('FRED sent no observations');
      return obs;
    },
    pd: async (id) => {
      const obs = parsePd(JSON.parse(await fetchText(`${NYFED_PD}${encodeURIComponent(id)}.json`, 'application/json')), id);
      if (!obs.length) throw new Error('the New York Fed sent no observations');
      return obs;
    },
  };
  const refresh = (src, id) => {
    const k = `${src}:${id}`;
    if (inflight.has(k)) return;
    inflight.add(k);
    const job = async () => {
      const old = read(src, id);
      try {
        const obs = await sources[src](id);
        write(src, id, { obs, at: now(), tried: now(), error: null });
      } catch (e) {
        if ((e.status === 403 || e.status === 429) && (old?.limitedTries || 0) < 4) {
          // too many requests in a row: pause the queue for a minute, then try this one again
          pausedUntil = Math.max(pausedUntil, now() + 60e3);
          write(src, id, { ...(old || { obs: [], at: null }), limitedTries: (old?.limitedTries || 0) + 1, tried: now() });
          queue.push(job); // still in flight
          return;
        }
        log(`[fred] ${src} ${id}: ${e.message}`);
        write(src, id, { obs: old?.obs || [], at: old?.at || null, tried: now(), error: `Couldn’t load ${id} (${e.message})` });
      }
      inflight.delete(k);
    };
    queue.push(job);
    pump();
  };
  const isStale = (c) => {
    if (!c) return true;
    if (c.error) return now() - (c.tried || 0) > 30 * 60e3; // retry a failed series every half hour
    return now() - (c.at || 0) > staleAfter(c.obs);
  };

  const serve = (src, ids, from) => {
    if (queue.length && !running) pump(); // resume a queue paused for FRED's rate limit
    const series = {};
    for (const id of ids) {
      const c = read(src, id);
      if (isStale(c)) refresh(src, id);
      const obs = c?.obs || [];
      let i = 0;
      if (from) { while (i < obs.length && obs[i][0] < from) i++; i = Math.max(0, i - 1); } // one point before the range so changes have a base
      series[id] = { obs: i ? obs.slice(i) : obs, at: c?.at || null, error: c?.error || null, pending: !c };
    }
    const refreshing = ids.some((id) => inflight.has(`${src}:${id}`));
    return { series, refreshing };
  };

  const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
  const handler = async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const route = u.pathname.replace(/^\/api\/macro\/fred/, '') || '/';
    if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
    const ids = [...new Set((u.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter((s) => ID_RE.test(s)))].slice(0, 40);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('from') || '') ? u.searchParams.get('from') : null;
    if (!ids.length) return send(res, 400, { error: 'ids?' });
    if (route === '/' || route === '') return send(res, 200, { ...serve('fred', ids.map((s) => s.toUpperCase()), from), source: 'FRED, Federal Reserve Bank of St. Louis' });
    if (route === '/pd') return send(res, 200, { ...serve('pd', ids.map((s) => s.toUpperCase()), from), source: 'Federal Reserve Bank of New York, Primary Dealer Statistics' });
    return send(res, 404, { error: 'not found' });
  };
  return handler;
}
