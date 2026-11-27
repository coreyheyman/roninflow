// GEX (gamma exposure) for the Macro → GEX page and the "GEX levels" chart indicator.
//
// Dealer positioning from the options chain: how much the market makers who sold the options have to buy or sell as
// price moves (gamma), as implied volatility moves (vanna) and as time passes (charm). Usual convention: dealers are
// long the calls customers sell them and short the puts customers buy, so call gamma counts positive, put gamma negative.
//
//   GET  /api/macro/gex/config                       → { source, sources, autoSave, symbols }
//   POST /api/macro/gex/config { source?, tradierKey?, tradierSandbox?, autoSave? }
//   GET  /api/macro/gex/expirations?symbol=SPX       → { symbol, expirations: ['YYYY-MM-DD', …] }
//   GET  /api/macro/gex?symbol=SPX&exp=D1,D2         → levels, GEX by strike, aggregate profile, vanna/charm, futures
//   GET  /api/macro/gex/levels?fut=ES&date=YYYY-MM-DD → { levels: [{ t, callWall, putWall, flip, spot }] } in ES prices
//
// Sources
//   • Cboe's delayed option quotes (cdn-api.cboe.com — formerly cdn.cboe.com — the data behind its delayed-quotes pages) — free, no key, ~15 minutes
//     delayed, with open interest, implied volatility and Greeks for every strike. The default, and always used for
//     the vanna/charm charts and the expiration list (they change slowly).
//   • Polygon (your Polygon key, needs an options plan) or Tradier (a free brokerage account's API token) — real time,
//     used for the GEX chart and levels when chosen.
// Open interest is published once a day (overnight), so intraday GEX uses the morning's positions — like every GEX tool.
import fs from 'node:fs';
import path from 'node:path';
import { bsGreeks, parseOcc, expiryMs, computeGex, computeVannaCharm, nyDate } from './src/lib/gexMath.js';
import { usMarketDay } from './holidays.js';

export { bsGreeks, parseOcc, expiryMs, computeGex, computeVannaCharm };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
export const CBOE_HOSTS = ['https://cdn-api.cboe.com', 'https://cdn.cboe.com'];
const CBOE_HEADERS = {
  Origin: 'https://www.cboe.com', Referer: 'https://www.cboe.com/', 'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty',
  'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
};

/** The page's indices (any optionable ticker works too); each one's futures market for the converted levels. */
export const GEX_SYMBOLS = [
  { key: 'SPX', label: 'S&P 500 index', fut: 'ES', index: true },
  { key: 'NDX', label: 'Nasdaq-100 index', fut: 'NQ', index: true },
  { key: 'RUT', label: 'Russell 2000 index', fut: 'RTY', index: true },
  { key: 'SPY', label: 'S&P 500 ETF', fut: 'ES' },
  { key: 'QQQ', label: 'Nasdaq-100 ETF', fut: 'NQ' },
  { key: 'IWM', label: 'Russell 2000 ETF', fut: 'RTY' },
];
const INDEX = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'XSP', 'DJX', 'OEX', 'XEO', 'MRUT']);
export const FUT_OF = { SPX: 'ES', SPY: 'ES', XSP: 'ES', NDX: 'NQ', QQQ: 'NQ', RUT: 'RTY', IWM: 'RTY' };
const INDEX_OF_FUT = { ES: 'SPX', MES: 'SPX', NQ: 'NDX', MNQ: 'NDX', RTY: 'RUT', M2K: 'RUT' };

// ---------- chains ----------
/** a chain whose options carry volatility or gamma (Cboe's file has neither for the first minutes after the open) */
export function hasGreeks(rows) {
  const held = rows.filter((r) => r.oi > 0);
  const priced = held.filter((r) => r.gamma > 0 || r.iv > 0).length;
  return held.length > 0 && priced >= Math.max(5, held.length * 0.2);
}

function normCboe(j) {
  const d = j?.data || j;
  const spot = Number(d?.current_price ?? d?.close ?? d?.last_trade_price);
  const rows = [];
  for (const o of d?.options || []) {
    const p = parseOcc(o.option);
    if (!p) continue;
    rows.push({ exp: p.exp, type: p.type, strike: p.strike, oi: Number(o.open_interest) || 0, gamma: Number(o.gamma) || 0, iv: Number(o.iv) || 0, mult: 100 });
  }
  // Cboe writes its time in UTC without saying so ("2026-11-18 23:51:04")
  const raw = String(j?.timestamp || d?.last_trade_time || '').trim().replace(' ', 'T');
  const ts = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`) || null;
  return { spot, rows, at: ts };
}

/** futuresAt(root, ms) from the journal's price data (your platform's / Yahoo's 1-minute bars; never a paid source). */
export const futuresFromCandles = (candles) => async (fut, atMs) => {
  const date = nyDate(atMs);
  const rec = await candles?.get?.(fut, date, 'America/New_York', { noPaid: true }).catch(() => null);
  const c = (rec?.candles || []).filter((r) => r[0] * 1000 <= atMs + 60e3);
  const last = c[c.length - 1];
  if (!last || atMs - last[0] * 1000 > 30 * 60e3 || !/m$/.test(rec.interval || '1m')) {
    // your platform only sends the markets you traded that day: ask its add-on for this one too (it arrives within a
    // minute or two while the platform is open)
    candles?.requestDay?.(fut, date, 'America/New_York');
    return null;
  }
  return { price: last[4], at: last[0] * 1000 };
};

export function createGexHandler(dataDir, { log = () => {}, vault = null, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), futuresAt = async () => null } = {}) {
  const dir = path.join(dataDir, 'gex');
  const cfgFile = path.join(dir, 'config.json');
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = `${f}.tmp`; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); };
  let cfg = { source: 'cboe', autoSave: true, symbols: ['SPX', 'NDX'], tradierSandbox: false, ...readJson(cfgFile, {}) };
  const saveCfg = () => writeJson(cfgFile, cfg);
  const key = (n) => vault?.get(n) || null;
  const polygonKey = () => key('price:polygon');
  const tradierKey = () => key('gex:tradier');
  const cache = new Map(); // source|symbol|exps → { at, data }
  const busy = new Map();
  const once = (k, fn) => { if (!busy.has(k)) busy.set(k, fn().finally(() => busy.delete(k))); return busy.get(k); };

  async function getJson(url, { headers = {}, timeout = 30000 } = {}) {
    const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) });
    const text = await r.text();
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; e.body = text.slice(0, 300); throw e; }
    return JSON.parse(text);
  }

  // Cboe: the whole chain in one file (indices are "_SPX"); kept 2 minutes, it's delayed anyway
  const lastGood = new Map(); // symbol → the last Cboe chain that had Greeks
  async function cboeChain(symbol) {
    const k = `cboe|${symbol}`, c = cache.get(k);
    if (c && now() - c.at < 120e3) return c.data;
    return once(k, async () => {
      const names = INDEX.has(symbol) ? [`_${symbol}`, symbol] : [symbol, `_${symbol}`];
      // Cboe moved the files to cdn-api.cboe.com (Nov 2026), behind a firewall that only lets through requests that come
      // from its own quote pages — so ask the way those pages do
      const urls = [];
      for (const host of CBOE_HOSTS) for (const n of names) urls.push(`${host}/api/global/delayed_quotes/options/${n}.json`);
      let last, notReady = false;
      for (const u of urls) {
        try {
          const data = normCboe(await getJson(u, { headers: CBOE_HEADERS }));
          if (!(data.rows.length && data.spot > 0)) continue;
          if (!hasGreeks(data.rows)) { notReady = true; continue; }
          data.source = 'cboe'; data.at ||= now() - 15 * 60e3;
          cache.set(k, { at: now(), data }); lastGood.set(symbol, data);
          return data;
        } catch (e) { last = e; }
      }
      // for the first minutes after the open Cboe's file lists the options with no volatility or Greeks yet: everything
      // would come out as zero, so keep showing the last good chain (marked as waiting) and look again soon
      if (notReady) {
        const prev = lastGood.get(symbol);
        if (prev) { const data = { ...prev, waiting: true }; cache.set(k, { at: now() - 90e3, data }); return data; }
        throw new Error('Cboe’s data has no volatility or Greeks yet — that happens for the first minutes after the open; it fills in shortly');
      }
      throw new Error(last?.status === 404 ? `Cboe has no options for ${symbol}` : last?.status === 403 ? `Cboe refused the request (HTTP 403) — its firewall may be blocking it; try again in a few minutes, or use Polygon or Tradier` : `Couldn’t reach Cboe (${last?.message || 'no data'})`);
    });
  }

  // Polygon: the snapshot of the chosen expirations (needs an options plan; indices as I:SPX)
  async function polygonChain(symbol, exps) {
    const k2 = polygonKey();
    if (!k2) throw new Error('Add your Polygon key in Settings → Price data first');
    const u = INDEX.has(symbol) ? `I:${symbol}` : symbol;
    const rows = [];
    let spot = null;
    for (const exp of exps.slice(0, 6)) {
      let url = `https://api.polygon.io/v3/snapshot/options/${encodeURIComponent(u)}?expiration_date=${exp}&limit=250&apiKey=${encodeURIComponent(k2)}`;
      for (let page = 0; url && page < 40; page++) {
        let j;
        try { j = await getJson(url); } catch (e) { throw new Error(e.status === 403 || e.status === 401 ? 'Your Polygon plan doesn’t include options snapshots' : `Polygon: ${e.message}`); }
        for (const o of j.results || []) {
          const d = o.details || {};
          if (!d.strike_price) continue;
          rows.push({ exp: d.expiration_date, type: d.contract_type === 'put' ? 'P' : 'C', strike: Number(d.strike_price), oi: Number(o.open_interest) || 0, gamma: Number(o.greeks?.gamma) || 0, iv: Number(o.implied_volatility) || 0, mult: Number(d.shares_per_contract) || 100 });
          if (!spot && o.underlying_asset?.price > 0) spot = Number(o.underlying_asset.price);
        }
        url = j.next_url ? `${j.next_url}${j.next_url.includes('?') ? '&' : '?'}apiKey=${encodeURIComponent(k2)}` : null;
      }
    }
    return { rows, spot, at: now(), source: 'polygon' };
  }

  // Tradier: one chain per expiration, with Greeks (from ORATS); real time with a brokerage account's token
  const tradierBase = () => (cfg.tradierSandbox ? 'https://sandbox.tradier.com/v1' : 'https://api.tradier.com/v1');
  const tradierGet = (p) => {
    const t = tradierKey();
    if (!t) throw new Error('Add your Tradier API token first');
    return getJson(`${tradierBase()}${p}`, { headers: { Authorization: `Bearer ${t}` } }).catch((e) => { throw new Error(e.status === 401 ? 'Tradier didn’t accept the token' : `Tradier: ${e.message}`); });
  };
  const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  async function tradierChain(symbol, exps) {
    const q = await tradierGet(`/markets/quotes?symbols=${encodeURIComponent(symbol)}`);
    const quote = arr(q?.quotes?.quote)[0] || {};
    const spot = Number(quote.last || quote.close || quote.prevclose) || null;
    const rows = [];
    for (const exp of exps.slice(0, 6)) {
      const j = await tradierGet(`/markets/options/chains?symbol=${encodeURIComponent(symbol)}&expiration=${exp}&greeks=true`);
      for (const o of arr(j?.options?.option)) rows.push({ exp: o.expiration_date || exp, type: o.option_type === 'put' ? 'P' : 'C', strike: Number(o.strike), oi: Number(o.open_interest) || 0, gamma: Number(o.greeks?.gamma) || 0, iv: Number(o.greeks?.mid_iv || o.greeks?.smv_vol) || 0, mult: Number(o.contract_size) || 100 });
    }
    return { rows, spot, at: now(), source: 'tradier' };
  }
  async function tradierExpirations(symbol) {
    const j = await tradierGet(`/markets/options/expirations?symbol=${encodeURIComponent(symbol)}&includeAllRoots=true`);
    return arr(j?.expirations?.date).map(String).sort();
  }

  async function expirations(symbol) {
    try {
      const c = await cboeChain(symbol);
      return [...new Set(c.rows.map((r) => r.exp))].filter((d) => expiryMs(d) > now()).sort(); // not ones that closed today
    } catch (e) {
      if (cfg.source === 'tradier' && tradierKey()) return tradierExpirations(symbol);
      throw e;
    }
  }

  /** The futures price at a moment (for converting levels): your platform's / Yahoo's 1-minute bars. */
  async function ratioFor(symbol, spot, atMs) {
    const fut = FUT_OF[symbol];
    if (!fut || !(spot > 0)) return null;
    try {
      const p = await futuresAt(fut, atMs);
      return p?.price > 0 ? { fut, price: p.price, ratio: p.price / spot, at: p.at } : null;
    } catch { return null; }
  }

  /**
   * Is the US cash market open at ms? If not, when did it last close? Skips weekends and market holidays (Thanksgiving,
   * Good Friday …) and knows the 1:00 PM early closes — otherwise the futures price is looked up for a session that
   * never happened and the levels can't be converted.
   */
  function cashState(ms) {
    const ny = new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const mins = ny.getHours() * 60 + ny.getMinutes(), wd = ny.getDay();
    const today = nyDate(ms);
    const kind = (d) => (d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 'closed' : usMarketDay(d.toISOString().slice(0, 10)));
    const closeMin = (k) => (k === 'early' ? 780 : 960);
    const todayKind = wd > 0 && wd < 6 ? usMarketDay(today) : 'closed';
    if (todayKind !== 'closed' && mins >= 570 && mins < closeMin(todayKind)) return { open: true };
    let d = new Date(Date.parse(`${today}T12:00:00Z`));
    if (!(todayKind !== 'closed' && mins >= closeMin(todayKind))) d = new Date(d.getTime() - 864e5); // before today's open: an earlier day's close
    for (let i = 0; i < 10 && kind(d) === 'closed'; i++) d = new Date(d.getTime() - 864e5);
    const day = d.toISOString().slice(0, 10);
    return { open: false, close: expiryMs(day) - (kind(d) === 'early' ? 3 * 3600e3 : 0) };
  }

  async function report(symbol, exps, { source = cfg.source } = {}) {
    const free = await cboeChain(symbol).catch((e) => ({ error: e.message }));
    let all = free.rows ? free.rows : [];
    const list = free.rows ? [...new Set(free.rows.map((r) => r.exp))].filter((d) => expiryMs(d) > now()).sort() : await expirations(symbol);
    if (!exps?.length) exps = list.slice(0, 1);
    let live = null, liveError = null;
    if (source === 'polygon' || source === 'tradier') {
      try {
        const k = `${source}|${symbol}|${exps.join(',')}`, c = cache.get(k);
        live = c && now() - c.at < 30e3 ? c.data : await once(k, () => (source === 'polygon' ? polygonChain(symbol, exps) : tradierChain(symbol, exps)));
        cache.set(k, { at: now(), data: live });
        if (!live.rows.length) { liveError = `${source === 'polygon' ? 'Polygon' : 'Tradier'} returned no options for those expirations`; live = null; }
      } catch (e) { liveError = e.message; live = null; }
    }
    if (!live && free.error) throw new Error(liveError ? `${liveError}; ${free.error}` : free.error);
    const main = live || free;
    const spot = main.spot > 0 ? main.spot : free.spot;
    const at = main.at || now();
    const gex = computeGex(main.rows, { spot, now: at, exps });
    // the index's price and the futures' must be from the same moment: outside cash hours the index sits at its
    // close while the futures keep trading, so convert with the futures' price at the close
    const cs = cashState(at);
    const ratioAt = cs.open ? at : Math.min(at, cs.close);
    const near = all.length ? computeVannaCharm(all, { spot: free.spot || spot, now: free.at || at, minDte: 0, maxDte: 45 }) : null;
    const regime = all.length ? computeVannaCharm(all, { spot: free.spot || spot, now: free.at || at, minDte: 46, maxDte: 180 }) : null;
    const fut = await ratioFor(symbol, spot, ratioAt);
    // where the index would be now, from the futures' live price (after hours, or while the data is delayed)
    let implied = null;
    if (fut) {
      try {
        const p = await futuresAt(fut.fut, now());
        if (p?.price > 0 && Math.abs((p.at || now()) - ratioAt) > 2 * 60e3) implied = { spot: p.price / fut.ratio, fut: p.price, at: p.at || now() };
      } catch { /* none */ }
    }
    if (implied && gex.profile?.length) { // the regime where price is now
      const near2 = gex.profile.reduce((a, q) => (Math.abs(q.price - implied.spot) < Math.abs(a.price - implied.spot) ? q : a));
      if (Math.abs(near2.price - implied.spot) / implied.spot < 0.01) gex.zone = near2.gex >= 0 ? 'positive' : 'negative';
    }
    const out = {
      symbol, spot, at, source: main.source, delayed: main.source === 'cboe', waiting: !live && !!free.waiting, liveError, expirations: list, exps,
      ...gex, near, regime, fut: fut ? { ...fut, atClose: !cs.open } : null, implied, cashOpen: cs.open, closeAt: cs.close || null,
    };
    remember(symbol, out);
    return out;
  }

  // ---------- levels kept for the charts (one file per index per day, a point at most every 10 minutes) ----------
  const levelFile = (symbol, date) => path.join(dir, 'levels', symbol, `${date}.json`);
  function remember(symbol, r) {
    if (!r.exps?.length || r.exps[0] !== r.expirations?.[0] || r.exps.length !== 1) return; // only the nearest expiration (what the indicator shows)
    const date = nyDate(r.at), f = levelFile(symbol, date);
    const list = readJson(f, []).filter((p) => p.t <= now() + 30 * 60e3); // (points saved with a wrong clock)
    const last = list[list.length - 1];
    if (last && r.at - last.t < 10 * 60e3) list.pop();
    list.push({ t: r.at, spot: r.spot, callWall: r.callWall, putWall: r.putWall, flip: r.flip, total: r.total, zone: r.zone, ratio: r.fut?.ratio ?? null, exp: r.exps[0] });
    try { writeJson(f, list); } catch (e) { log('[gex] could not save levels', e.message); }
  }
  function levelsFor(futRoot, date) {
    const symbol = INDEX_OF_FUT[futRoot];
    if (!symbol) return [];
    const etfFallback = { SPX: 'SPY', NDX: 'QQQ', RUT: 'IWM' }[symbol];
    let list = readJson(levelFile(symbol, date), []);
    if (!list.length && etfFallback) list = readJson(levelFile(etfFallback, date), []);
    // into futures prices: each point's own ratio, else the day's nearest one known
    const known = list.filter((p) => p.ratio > 0);
    return list.map((p) => {
      const ratio = p.ratio > 0 ? p.ratio : known.reduce((a, q) => (a == null || Math.abs(q.t - p.t) < Math.abs(a.t - p.t) ? q : a), null)?.ratio;
      if (!ratio) return null;
      const x = (v) => (v == null ? null : Math.round(v * ratio * 4) / 4);
      return { t: p.t, spot: x(p.spot), callWall: x(p.callWall), putWall: x(p.putWall), flip: x(p.flip), zone: p.zone };
    }).filter(Boolean);
  }

  // during US market hours, keep the nearest-expiration levels of your indices so charts (and replays) can show them
  async function autoRound() {
    if (!cfg.autoSave) return;
    const t = now();
    const ny = new Date(new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const mins = ny.getHours() * 60 + ny.getMinutes();
    if (ny.getDay() === 0 || ny.getDay() === 6 || mins < 9 * 60 + 25 || mins > 16 * 60 + 20) return;
    for (const s of cfg.symbols || []) {
      try { await report(s, null); } catch (e) { log('[gex]', s, e.message); }
    }
  }

  const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
  const body = (req) => new Promise((resolve) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 1e4) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } }); });
  const SYM_RE = /^[A-Z]{1,6}$/;
  const configView = () => ({
    source: cfg.source, autoSave: cfg.autoSave !== false, symbols: cfg.symbols, tradierSandbox: !!cfg.tradierSandbox,
    sources: { cboe: true, polygon: !!polygonKey(), tradier: !!tradierKey() }, list: GEX_SYMBOLS,
  });

  const handler = async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const route = u.pathname.replace(/^\/api\/macro\/gex/, '') || '/';
    try {
      if (req.method === 'GET' && route === '/config') return send(res, 200, configView());
      if (req.method === 'POST' && route === '/config') {
        const b = await body(req);
        if (['cboe', 'polygon', 'tradier'].includes(b.source)) cfg.source = b.source;
        if (typeof b.autoSave === 'boolean') cfg.autoSave = b.autoSave;
        if (typeof b.tradierSandbox === 'boolean') cfg.tradierSandbox = b.tradierSandbox;
        if (Array.isArray(b.symbols)) cfg.symbols = b.symbols.map((s) => String(s).toUpperCase()).filter((s) => SYM_RE.test(s)).slice(0, 6);
        if (typeof b.tradierKey === 'string' && vault) vault.set('gex:tradier', b.tradierKey.trim() || null);
        saveCfg();
        cache.clear();
        return send(res, 200, configView());
      }
      const symbol = String(u.searchParams.get('symbol') || 'SPX').toUpperCase().replace(/^\$|^\^/, '');
      if (!SYM_RE.test(symbol)) return send(res, 400, { error: 'Unknown symbol' });
      if (req.method === 'GET' && route === '/expirations') return send(res, 200, { symbol, expirations: await expirations(symbol) });
      if (req.method === 'GET' && route === '/levels') {
        const fut = String(u.searchParams.get('fut') || '').toUpperCase(), date = String(u.searchParams.get('date') || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'date?' });
        return send(res, 200, { fut, date, levels: levelsFor(fut, date) });
      }
      if (req.method === 'GET' && route === '/') {
        const exps = (u.searchParams.get('exp') || '').split(',').filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 12);
        return send(res, 200, await report(symbol, exps));
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      log('[gex]', e.message);
      return send(res, 502, { error: e.message });
    }
  };
  handler.report = report;
  handler.levelsFor = levelsFor;
  handler.autoRound = autoRound;
  handler.start = () => { setTimeout(autoRound, 30e3).unref?.(); setInterval(autoRound, 15 * 60e3).unref?.(); };
  return handler;
}
