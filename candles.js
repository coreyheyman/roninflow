// Price candles for the execution chart in the daily diary.
//   GET  /api/candles?symbol=MES&date=2026-11-09&tz=America/Los_Angeles
//        → { symbol, interval, source, candles: [[t, o, h, l, c, v], …] }   (t = unix seconds, UTC)
//   POST /api/candles/ingest  { symbol, bars: [[t, o, h, l, c, v], …] }  ← platform add-ons (token unless from this PC)
//   GET  /api/candles/config  · POST /api/candles/config { provider, yahoo, databentoKey?, polygonKey? }   (journal only)
//   GET  /api/candles/lib     → TradingView Lightweight Charts (downloaded once, then served from data/vendor)
//
// Where prices come from is up to you (Settings → Price data). In order:
//   1. bars your platform add-on sends (ATAS today) — your own data feed, no extra service
//   2. Databento with your own API key (CME futures, 1-minute OHLCV)
//   3. Polygon with your own API key (stocks, crypto, forex)
//   4. Yahoo Finance — off by default: its feed is unofficial and not licensed for this, so only if you opt in
// Every candle set is saved in data/candles/ so a day only has to be fetched once.
import fs from 'node:fs';
import path from 'node:path';

const LIB_VERSION = '5.0.7';
const LIB_URLS = [
  `https://cdn.jsdelivr.net/npm/lightweight-charts@${LIB_VERSION}/dist/lightweight-charts.standalone.production.js`,
  `https://unpkg.com/lightweight-charts@${LIB_VERSION}/dist/lightweight-charts.standalone.production.js`,
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const DAY = 86400;
// Coarser fallbacks and how far back Yahoo serves each one (days).
const INTERVALS = [['1m', 29], ['2m', 59], ['5m', 59], ['15m', 59], ['60m', 729]];

// Root symbols we know, longest first so "MES" wins over "ES".
const ROOTS = ['MBT', 'MET', 'MES', 'MNQ', 'MYM', 'M2K', 'MCL', 'MGC', 'SIL', 'M6E', 'M6B', 'M6A', 'RTY', 'BTC', 'ETH', 'ES', 'NQ', 'YM', 'CL', 'GC', 'SI', 'HG', 'NG', 'QM', 'QG', 'ZB', 'ZN', 'ZF', 'ZT', 'UB', 'PL', 'PA', 'HE', 'LE', 'ZC', 'ZS', 'ZW', '6E', '6J', '6B', '6A', '6C', '6S', '6N', '6M'];
export function rootOf(symbol) {
  const s = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ROOTS.find((r) => s.startsWith(r)) || s.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '') || s;
}
const MICRO = { MES: 'ES', MNQ: 'NQ', MYM: 'YM', M2K: 'RTY', MCL: 'CL', MGC: 'GC', SIL: 'SI', QM: 'CL', QG: 'NG', M6E: '6E', M6B: '6B', M6A: '6A' };
const TWIN = { ...MICRO, ...Object.fromEntries(Object.entries(MICRO).filter(([k]) => k !== 'QM' && k !== 'QG').map(([m, f]) => [f, m])) };
export const yahooSymbol = (symbol) => `${rootOf(symbol)}=F`;

// ---------- time zones without a library ----------
function tzOffsetMs(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}
/** Unix seconds for a wall-clock time in a time zone. */
function zoned(dateStr, h, m, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz); // settle across a DST change
  return Math.floor(t / 1000);
}
/** A diary day = the previous evening's open (3 PM) through the end of the calendar day, in your time zone. */
export function dayWindow(date, tz) {
  const prev = new Date(Date.UTC(...date.split('-').map((n, i) => (i === 1 ? n - 1 : +n))) - DAY * 1000).toISOString().slice(0, 10);
  return { from: zoned(prev, 15, 0, tz), to: zoned(date, 23, 59, tz) + 60 };
}
const validTz = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

// ---------- Yahoo ----------
async function yahoo(ysym, interval, from, to) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?interval=${interval}&period1=${from}&period2=${to}&includePrePost=true&events=`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => null);
  const err = j?.chart?.error;
  if (!r.ok || err) throw new Error(err?.description || `Yahoo answered ${r.status}`);
  const res = j?.chart?.result?.[0];
  const ts = res?.timestamp || [];
  const q = res?.indicators?.quote?.[0] || {};
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if ([o, h, l, c].some((v) => v == null || !Number.isFinite(v))) continue;
    out.push([ts[i], o, h, l, c, q.volume?.[i] || 0]);
  }
  return out;
}

// ---------- Databento (CME Globex, continuous front month) ----------
async function databento(key, root, from, to) {
  const q = new URLSearchParams({ dataset: 'GLBX.MDP3', symbols: `${root}.c.0`, stype_in: 'continuous', schema: 'ohlcv-1m', start: new Date(from * 1000).toISOString(), end: new Date(to * 1000).toISOString(), encoding: 'csv', pretty_px: 'true', pretty_ts: 'true', map_symbols: 'true' });
  const r = await fetch(`https://hist.databento.com/v0/timeseries.get_range?${q}`, { headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` }, signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  if (!r.ok) { let msg = text; try { msg = JSON.parse(text).detail || msg; } catch { /* text */ } throw new Error(`Databento: ${String(msg).slice(0, 200)}`); }
  const lines = text.trim().split(/\r?\n/);
  const head = (lines.shift() || '').split(',');
  const col = (n) => head.indexOf(n);
  const [it, io, ih, il, ic, iv] = ['ts_event', 'open', 'high', 'low', 'close', 'volume'].map(col);
  if (it < 0 || ic < 0) throw new Error('Databento: unexpected response');
  return lines.map((l) => l.split(',')).map((c) => [Math.floor(Date.parse(c[it]) / 1000), +c[io], +c[ih], +c[il], +c[ic], +c[iv] || 0]).filter((b) => Number.isFinite(b[0]) && Number.isFinite(b[4]));
}

// ---------- Polygon (stocks, crypto, forex) ----------
export function polygonTicker(symbol) {
  const raw = String(symbol || '').toUpperCase();
  if (/-PERP$/.test(raw)) return `X:${raw.replace(/-PERP$/, '').replace(/^\d+/, '')}USD`;
  const s = raw.replace(/-(SPOT|SWAP)$/, '').replace(/-USDT?-SWAP$/, '');
  const crypto = s.match(/^([A-Z0-9]{2,10}?)[-/]?(USDT|USDC|USD)$/);
  if (crypto) return `X:${crypto[1]}USD`;
  const fx = s.replace('_', '').match(/^(EUR|GBP|AUD|NZD|USD|CAD|CHF|JPY)(EUR|GBP|AUD|NZD|USD|CAD|CHF|JPY)$/);
  if (fx) return `C:${fx[1]}${fx[2]}`;
  return /^[A-Z.]{1,6}$/.test(s) ? s : null;
}
async function polygon(key, ticker, from, to) {
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${from * 1000}/${to * 1000}?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(key)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error(`Polygon: ${j?.error || j?.message || r.status}`);
  return (j.results || []).map((b) => [Math.floor(b.t / 1000), b.o, b.h, b.l, b.c, b.v || 0]);
}

const isFutures = (symbol) => !/(-PERP|-SPOT|-SWAP|USDT|USDC|\/|:)/i.test(String(symbol)) && (ROOTS.includes(rootOf(symbol)) || /^[A-Z0-9]{1,4}[FGHJKMNQUVXZ]\d{1,2}$/.test(String(symbol).toUpperCase()));

export function createCandleHandler(dataDir, { readTrades, log = () => {}, vault, tokenOk } = {}) {
  const cacheDir = path.join(dataDir, 'candles');
  const barsDir = path.join(dataDir, 'bars');
  const cfgFile = path.join(dataDir, 'price-source.json');
  const readCfg = () => {
    try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch { /* first run */ }
    // journals that already used the Yahoo charts keep them; new ones start with Yahoo off
    return { yahoo: fs.existsSync(cacheDir), decided: false };
  };
  let cfg = readCfg();
  const keyOf = (name) => vault?.get(`price:${name}`) || null;

  // ---------- bars from platform add-ons: data/bars/<ROOT>/<UTC date>.json  { "<t>": [t,o,h,l,c,v] } ----------
  const barFile = (root, t) => path.join(barsDir, root.replace(/[^\w.-]/g, '_'), `${new Date(t * 1000).toISOString().slice(0, 10)}.json`);
  function storeBars(symbol, bars) {
    const root = rootOf(symbol);
    const byFile = new Map();
    for (const b of bars) {
      const t = Math.floor(Number(Array.isArray(b) ? b[0] : (b.time ?? b.t)));
      const row = Array.isArray(b) ? b.slice(0, 6).map(Number) : [t, +b.open, +b.high, +b.low, +b.close, +(b.volume || 0)];
      row[0] = t > 1e12 ? Math.floor(t / 1000) : t;
      if (!Number.isFinite(row[0]) || row.slice(1, 5).some((v) => !Number.isFinite(v))) continue;
      const f = barFile(root, row[0]);
      (byFile.get(f) || byFile.set(f, []).get(f)).push(row);
    }
    let n = 0;
    for (const [f, rows] of byFile) {
      const cur = readCache(f) || {};
      for (const r of rows) { cur[r[0]] = r; n++; }
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(cur));
    }
    return n;
  }
  function addonBars(symbol, from, to) {
    const out = [];
    // a micro trades at the same price as its full-size contract, so either chart's bars will do (MES ↔ ES …)
    for (const root of [rootOf(symbol), ...(TWIN[rootOf(symbol)] ? [TWIN[rootOf(symbol)]] : [])]) {
      for (let t = from - (from % DAY); t <= to; t += DAY) {
        const cur = readCache(barFile(root, t));
        if (cur) for (const r of Object.values(cur)) if (r[0] >= from && r[0] < to) out.push(r);
      }
      if (out.length) break;
    }
    out.sort((a, b) => a[0] - b[0]);
    // bar size from the data (an add-on on a 1-minute chart sends 1-minute bars)
    const step = out.length > 2 ? Math.min(...out.slice(1, 50).map((r, i) => r[0] - out[i][0]).filter((d) => d > 0)) : 60;
    return { candles: out, interval: step >= 3600 ? `${Math.round(step / 3600)}h` : `${Math.max(1, Math.round(step / 60))}m` };
  }
  const libFile = path.join(dataDir, 'vendor', `lightweight-charts-${LIB_VERSION}.js`);
  const inflight = new Map();

  const cachePath = (ysym, date) => path.join(cacheDir, ysym.replace(/[^\w=.-]/g, '_'), `${date}.json`);
  const readCache = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

  /** Candles for one symbol and diary day, from the cache when it's final. */
  async function get(symbol, date, tz, { force } = {}) {
    const ysym = yahooSymbol(symbol);
    const file = cachePath(ysym, date);
    const { from, to } = dayWindow(date, tz);
    const now = Math.floor(Date.now() / 1000);
    const ageDays = (now - to) / DAY;
    // saved Yahoo data is only shown while Yahoo is switched on (older saved days have no source: they're Yahoo too)
    const saved = readCache(file);
    const cached = saved && (cfg.yahoo || (saved.source && !saved.source.startsWith('Yahoo'))) ? saved : null;
    const best = INTERVALS.find(([, max]) => (now - from) / DAY <= max)?.[0] || '60m';
    if (cached && !force) {
      const better = cached.interval !== best && cached.interval !== '1m'; // a finer interval is still available
      if (cached.final && !better) return cached;
      if (!cached.final && now - cached.fetchedAt < 45) return cached; // today: refresh at most every 45s
    }
    const key = file;
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      let lastErr;
      const end = Math.min(to, now);
      const save = (rec) => { if (rec.candles.length) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(rec)); } return rec; };
      // 1. your platform add-on's bars
      const ab = addonBars(symbol, from, end);
      const addonRec = ab.candles.length >= 5 ? { symbol: rootOf(symbol), ysym, date, tz, from, to, interval: ab.interval, source: 'Your platform (add-on)', fetchedAt: now, final: false, candles: ab.candles } : null;
      if (addonRec && ab.interval === '1m') return addonRec; // coarser add-on bars are used if nothing better is set up
      // 2. Databento (futures)
      const dbKey = keyOf('databento');
      if (dbKey && isFutures(symbol)) {
        try {
          const candles = await databento(dbKey, rootOf(symbol), from, end);
          if (candles.length) return save({ symbol: rootOf(symbol), ysym, date, tz, from, to, interval: '1m', source: 'Databento (CME, front month)', fetchedAt: now, final: ageDays > 0.05, candles });
        } catch (e) { lastErr = e; }
      }
      // 3. Polygon (stocks, crypto, forex)
      const pgKey = keyOf('polygon');
      const pt = polygonTicker(symbol);
      if (pgKey && pt && !isFutures(symbol)) {
        try {
          const candles = await polygon(pgKey, pt, from, end);
          if (candles.length) return save({ symbol: rootOf(symbol), ysym: pt, date, tz, from, to, interval: '1m', source: 'Polygon', fetchedAt: now, final: ageDays > 0.05, candles });
        } catch (e) { lastErr = e; }
      }
      // 4. Yahoo, only if you turned it on
      if (!cfg.yahoo) {
        if (addonRec) return addonRec;
        if (cached) return { ...cached, stale: true };
        throw lastErr || Object.assign(new Error('No price source is set up for charts yet — choose one in Settings → Price data.'), { code: 'NO_SOURCE' });
      }
      for (const [interval, max] of INTERVALS) {
        if ((now - from) / DAY > max) continue;
        try {
          const candles = await yahoo(ysym, interval, from, Math.min(to, now));
          if (!candles.length && interval !== '60m') { lastErr = new Error('No candles for that day'); continue; }
          const rec = { symbol: rootOf(symbol), ysym, date, tz, from, to, interval, source: 'Yahoo Finance (continuous contract)', fetchedAt: now, final: ageDays > 0.05, candles };
          if (candles.length) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(rec)); }
          return rec;
        } catch (e) { lastErr = e; }
      }
      if (addonRec) return addonRec;
      if (cached) return { ...cached, stale: true };
      throw lastErr || new Error('No price data for that day');
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }

  async function lib() {
    if (fs.existsSync(libFile)) return fs.readFileSync(libFile);
    for (const u of LIB_URLS) {
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 50000) continue;
        fs.mkdirSync(path.dirname(libFile), { recursive: true });
        fs.writeFileSync(libFile, buf);
        return buf;
      } catch { /* next */ }
    }
    throw new Error('Couldn’t download the chart library (no internet?)');
  }

  // ---------- keep 1-minute data for every trade day before Yahoo drops it ----------
  async function backfill() {
    if (!readTrades || !cfg.yahoo) return; // only Yahoo forgets 1-minute data after ~30 days
    let trades;
    try { trades = readTrades() || []; } catch { return; }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = Date.now() / 1000;
    const want = new Set();
    for (const t of trades) {
      if (!t?.entry || !t.symbol) continue;
      const date = String(t.entry).slice(0, 10);
      const { from } = dayWindow(date, tz);
      if ((now - from) / DAY > 28.5) continue;
      want.add(`${yahooSymbol(t.symbol)}|${t.symbol}|${date}`);
    }
    let n = 0;
    for (const k of want) {
      const [ysym, symbol, date] = k.split('|');
      const c = readCache(cachePath(ysym, date));
      if (c?.final && c.interval === '1m') continue;
      try { await get(symbol, date, tz); n++; } catch { /* try again next round */ }
      await new Promise((r) => setTimeout(r, 1500)); // be gentle with Yahoo
    }
    if (n) log(`[candles] saved 1-minute data for ${n} trading day${n === 1 ? '' : 's'}`);
  }
  setTimeout(backfill, 20000).unref?.();
  setInterval(backfill, 6 * 3600 * 1000).unref?.();

  const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };

  return async function candles(req, res) {
    const u = new URL(req.originalUrl || req.url, 'http://x');
    try {
      if (u.pathname === '/api/candles/ingest' && req.method === 'POST') {
        if (tokenOk && !tokenOk(req)) return send(res, 401, { error: 'Missing or wrong token (Connections → Webhook / API).' });
        const body = await new Promise((resolve, reject) => { let t = ''; req.setEncoding('utf8'); req.on('data', (c) => { t += c; if (t.length > 20e6) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(t || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); });
        const groups = Array.isArray(body.series) ? body.series : [body];
        let n = 0;
        for (const g of groups) if (g?.symbol && Array.isArray(g.bars)) n += storeBars(g.symbol, g.bars);
        return send(res, 200, { ok: true, bars: n });
      }
      if (u.pathname === '/api/candles/config') {
        if (req.method === 'POST') {
          const b = await new Promise((resolve, reject) => { let t = ''; req.setEncoding('utf8'); req.on('data', (c) => { t += c; }); req.on('end', () => { try { resolve(JSON.parse(t || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); });
          cfg = { ...cfg, yahoo: !!b.yahoo, decided: true };
          for (const k of ['databento', 'polygon']) if (typeof b[`${k}Key`] === 'string' && b[`${k}Key`] !== '••••••••') vault?.set(`price:${k}`, b[`${k}Key`].trim());
          fs.mkdirSync(dataDir, { recursive: true });
          fs.writeFileSync(cfgFile, JSON.stringify(cfg));
        }
        const rootsWithBars = (() => { try { return fs.readdirSync(barsDir); } catch { return []; } })();
        return send(res, 200, { yahoo: !!cfg.yahoo, decided: !!cfg.decided, databento: !!keyOf('databento'), polygon: !!keyOf('polygon'), addonSymbols: rootsWithBars, vault: !!vault });
      }
      if (u.pathname === '/api/candles/lib') {
        const buf = await lib();
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=604800');
        return res.end(buf);
      }
      const symbol = u.searchParams.get('symbol');
      const date = u.searchParams.get('date');
      const tz = u.searchParams.get('tz') || Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !validTz(tz)) return send(res, 400, { error: 'symbol, date (YYYY-MM-DD) and tz are needed' });
      const rec = await get(symbol, date, tz, { force: u.searchParams.get('refresh') === '1' });
      return send(res, 200, rec);
    } catch (e) {
      return send(res, e.code === 'NO_SOURCE' ? 424 : 502, { error: e.message || 'Couldn’t load prices', code: e.code });
    }
  };
}
