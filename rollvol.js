// Where the volume is: each session's volume for the expiring contract and the next one (Yahoo Finance's free contract-month
// quotes), so the roll alert fires when the market has actually moved — not just on the calendar date.
//   GET /api/rolls/volume?roots=NQ,GC → { volumes: { NQ: { a: {symbol, last, today}, b: {...}, day, leader, share } } }
// Cached for 20 minutes per market. A rule of thumb traders use: switch once the next contract trades more than the
// current one; the calendar roll date (rolls.js) stays the backstop and the early warning.
import { PRODUCTS, contracts, MONTH_CODES } from './rolls.js';

const UA = 'Mozilla/5.0 (RoninFlow trading journal; +https://github.com/coreyheyman/roninflow)';
const EXCHANGE = {
  CBT: ['YM', 'MYM', 'ZT', 'ZF', 'ZN', 'TN', 'ZB', 'UB', 'ZC', 'ZS', 'ZW'],
  NYM: ['CL', 'MCL', 'QM', 'NG', 'QG', 'PL'],
  CMX: ['GC', 'MGC', 'SI', 'SIL', 'HG', 'MHG'],
};
const exchangeOf = (root) => Object.entries(EXCHANGE).find(([, list]) => list.includes(root))?.[0] || 'CME';
export const yahooSymbol = (c) => `${c.root}${MONTH_CODES[c.month]}${String(c.year).slice(-2)}.${exchangeOf(c.root)}`;

const chicago = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
/** the CME trading day a moment belongs to: sessions open at 5 PM Chicago time and count as the next day */
export function sessionDay(ms) {
  const p = Object.fromEntries(chicago.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  if (+p.hour >= 17) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Yahoo's hourly bars → volume per CME session: { last: the latest complete session, lastDay, today: the session
 * trading now }. (Yahoo's daily bars for contract months repeat and mislabel sessions; hourly bars add up right.)
 */
export function sessionVolumes(json, nowMs) {
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp || [], vol = r?.indicators?.quote?.[0]?.volume || [];
  const by = new Map();
  for (let i = 0; i < ts.length; i++) {
    const day = sessionDay(ts[i] * 1000);
    by.set(day, (by.get(day) || 0) + (vol[i] || 0));
  }
  const current = sessionDay(nowMs);
  const done = [...by.entries()].filter(([d, v]) => d < current && v > 0).sort((a, b) => a[0].localeCompare(b[0]));
  const last = done[done.length - 1];
  return { last: last ? last[1] : null, lastDay: last ? last[0] : null, today: by.get(current) ?? null };
}

/** the expiring contract and the next one, compared */
export function compare(a, b) {
  const pick = (x) => x.last;
  if (pick(a) == null || pick(b) == null) return { leader: null, share: null };
  const tot = pick(a) + pick(b);
  return { leader: pick(b) > pick(a) ? 'next' : 'current', share: tot ? pick(b) / tot : 0 };
}

export function createRollVolume({ log = () => {}, fetchImpl = (...x) => fetch(...x), now = () => Date.now() } = {}) {
  const cache = new Map(); // root → { at, data }
  const inflight = new Map();
  async function bars(sym) {
    const r = await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1h&range=5d`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    const j = await r.json().catch(() => null);
    if (!r.ok || j?.chart?.error) throw new Error(j?.chart?.error?.description || `Yahoo answered ${r.status}`);
    return j;
  }
  /** volume for a market's expiring contract (a) and the next (b) — the pair that matters around a roll */
  async function forRoot(root) {
    if (!PRODUCTS[root]) return null;
    const hit = cache.get(root);
    if (hit && now() - hit.at < 20 * 60e3) return hit.data;
    if (inflight.has(root)) return inflight.get(root);
    const p = (async () => {
      const todayIso = new Date(now()).toISOString().slice(0, 10);
      const list = contracts(root, new Date(now()), 6);
      const i = list.findIndex((c) => c.last >= todayIso);
      if (i < 0 || !list[i + 1]) return null;
      const [ca, cb] = [list[i], list[i + 1]];
      try {
        const [ja, jb] = await Promise.all([bars(yahooSymbol(ca)), bars(yahooSymbol(cb))]);
        const a = { symbol: ca.symbol, year: ca.year, month: ca.month, ...sessionVolumes(ja, now()) };
        const b = { symbol: cb.symbol, year: cb.year, month: cb.month, ...sessionVolumes(jb, now()) };
        const data = { root, a, b, day: a.lastDay || b.lastDay, ...compare(a, b), at: now(), source: 'Yahoo Finance (delayed)' };
        cache.set(root, { at: now(), data });
        return data;
      } catch (e) {
        log(`[rolls] volume ${root}: ${e.message}`);
        const data = hit?.data || { root, error: e.message, at: now() };
        cache.set(root, { at: now() - 15 * 60e3, data }); // try again in 5 minutes
        return data;
      }
    })().finally(() => inflight.delete(root));
    inflight.set(root, p);
    return p;
  }
  const peek = (root) => cache.get(root)?.data || null; // what's cached, without waiting (for the HUD)
  const handler = async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const roots = [...new Set((u.searchParams.get('roots') || '').toUpperCase().split(',').filter((r) => PRODUCTS[r]))].slice(0, 12);
    const volumes = Object.fromEntries(await Promise.all(roots.map(async (r) => [r, await forRoot(r)])));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ volumes }));
  };
  return { forRoot, peek, handler };
}

/** one shared instance: the server route and the Suite's HUD data use the same cache */
export const rollVolume = createRollVolume();
