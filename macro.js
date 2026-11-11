// Macro data for the Macro pages: the economic calendar and the CFTC Commitments of Traders report.
// This server fetches both from free public sources and keeps a copy in data/macro/, so the pages work offline and
// past weeks build up over time.
//
//   GET  /api/macro/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD → { events, coverage, updatedAt, error? }
//   GET  /api/macro/calendar/history?ccy=USD&title=…   → { events }  earlier releases of one event (what we've kept)
//   GET  /api/macro/cot[?extra=CODE,CODE]                  → { markets, reportDate, updatedAt, error? }
//   GET  /api/macro/cot/markets                            → { markets: [{ code, name }] }  every market in the latest report
//   POST /api/macro/refresh { what: 'calendar' | 'cot' }   → fetch now (still within each source's limits)
//
// Sources
//   • ForexFactory's public weekly feed (nfs.faireconomy.media): this week and next week, with impact, forecast,
//     previous and actual. It allows a few requests every five minutes, so we fetch at most every 30 minutes. Every
//     week we fetch is kept, so the calendar's history grows from the day you start using it.
//   • TradingView's economic calendar (the public feed its calendar widget uses): actual figures as they are released —
//     ForexFactory's feed has none — and the weeks ForexFactory hasn't published yet. Each actual is matched to the
//     ForexFactory event by currency, time and name. Can be turned off (?tv=0) in the calendar page.
//   • Official US release dates (Federal Reserve, BLS) as a last resort for months neither feed has.
//   • CFTC Public Reporting (publicreporting.cftc.gov), Legacy report, futures only: weekly positions published
//     Fridays at 3:30 PM ET for the Tuesday before. Public domain, no key.
import fs from 'node:fs';
import path from 'node:path';
import { holidayEvents } from './holidays.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TV_URL = 'https://economic-calendar.tradingview.com/events';
const TV_HEADERS = { Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' }; // the feed refuses requests without these
const TV_COUNTRIES = 'US,EU,DE,FR,IT,ES,GB,JP,AU,CA,CH,NZ,CN';
const TV_CHUNK_DAYS = 14;
const FF_FEEDS = ['https://nfs.faireconomy.media/ff_calendar_thisweek.json', 'https://nfs.faireconomy.media/ff_calendar_nextweek.json'];
const CFTC = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json'; // Legacy – Futures Only
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const CAL_STALE = 30 * MIN;
const CAL_RETRY = 10 * MIN; // after a failed or rate-limited fetch
const CAL_KEEP = 400 * DAY; // calendar history kept
const COT_YEARS = 3;
const COT_RETRY = 2 * HOUR;

// ---------- the markets on the COT page ----------
// Several codes = the first one the CFTC still publishes wins (contracts are sometimes re-coded).
export const COT_MARKETS = [
  { key: 'ES', label: 'S&P 500 E-mini', group: 'Indices', codes: ['13874A', '13874+'] },
  { key: 'NQ', label: 'Nasdaq-100 E-mini', group: 'Indices', codes: ['209742', '20974+'] },
  { key: 'YM', label: 'Dow E-mini', group: 'Indices', codes: ['124603', '12460+'] },
  { key: 'RTY', label: 'Russell 2000 E-mini', group: 'Indices', codes: ['239742'] },
  { key: 'VX', label: 'VIX', group: 'Indices', codes: ['1170E1'] },
  { key: 'ZT', label: '2-Year Note', group: 'Rates', codes: ['042601'] },
  { key: 'ZF', label: '5-Year Note', group: 'Rates', codes: ['044601'] },
  { key: 'ZN', label: '10-Year Note', group: 'Rates', codes: ['043602'] },
  { key: 'ZB', label: '30-Year Bond', group: 'Rates', codes: ['020601'] },
  { key: 'DX', label: 'US Dollar Index', group: 'FX', codes: ['098662'] },
  { key: '6E', label: 'Euro', group: 'FX', codes: ['099741'] },
  { key: '6J', label: 'Japanese Yen', group: 'FX', codes: ['097741'] },
  { key: '6B', label: 'British Pound', group: 'FX', codes: ['096742'] },
  { key: '6A', label: 'Australian Dollar', group: 'FX', codes: ['232741'] },
  { key: '6C', label: 'Canadian Dollar', group: 'FX', codes: ['090741'] },
  { key: '6S', label: 'Swiss Franc', group: 'FX', codes: ['092741'] },
  { key: '6N', label: 'New Zealand Dollar', group: 'FX', codes: ['112741'] },
  { key: '6M', label: 'Mexican Peso', group: 'FX', codes: ['095741'] },
  { key: 'GC', label: 'Gold', group: 'Metals', codes: ['088691'] },
  { key: 'SI', label: 'Silver', group: 'Metals', codes: ['084691'] },
  { key: 'HG', label: 'Copper', group: 'Metals', codes: ['085692'] },
  { key: 'PL', label: 'Platinum', group: 'Metals', codes: ['076651'] },
  { key: 'CL', label: 'Crude Oil (WTI)', group: 'Energy', codes: ['067651', '067411'] },
  { key: 'NG', label: 'Natural Gas', group: 'Energy', codes: ['023651'] },
  { key: 'RB', label: 'RBOB Gasoline', group: 'Energy', codes: ['111659'] },
  { key: 'HO', label: 'Heating Oil', group: 'Energy', codes: ['022651'] },
  { key: 'BTC', label: 'Bitcoin', group: 'Crypto', codes: ['133741'] },
  { key: 'ETH', label: 'Ether', group: 'Crypto', codes: ['146021'] },
  { key: 'ZC', label: 'Corn', group: 'Grains', codes: ['002602'] },
  { key: 'ZS', label: 'Soybeans', group: 'Grains', codes: ['005602'] },
  { key: 'ZW', label: 'Wheat', group: 'Grains', codes: ['001602'] },
];
const COT_FIELDS = ['report_date_as_yyyy_mm_dd', 'cftc_contract_market_code', 'market_and_exchange_names', 'open_interest_all',
  'noncomm_positions_long_all', 'noncomm_positions_short_all', 'comm_positions_long_all', 'comm_positions_short_all',
  'nonrept_positions_long_all', 'nonrept_positions_short_all'];
const CODE_RE = /^[0-9A-Z+]{6}$/;

// ---------- official US release dates (Eastern Time) ----------
// For the months ForexFactory hasn't published yet. Sources: federalreserve.gov FOMC calendars (2026: Jan 2025
// release; 2027: press release of Sep 5, 2025) and bls.gov/schedule/2026 + /2027. Extend when the next year's dates
// are out (the Fed usually announces in August, BLS in the autumn).
const SCHEDULE = [
  { title: 'FOMC Rate Decision', time: '14:00', dates: ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09', '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08'] },
  { title: 'FOMC Press Conference', time: '14:30', same: 'FOMC Rate Decision' },
  { title: 'Non-Farm Payrolls (Employment Situation)', time: '08:30', dates: ['2026-11-06', '2026-12-04', '2027-01-08', '2027-02-05', '2027-03-05', '2027-04-02', '2027-05-07', '2027-06-04', '2027-07-02', '2027-08-06', '2027-09-03', '2027-10-08', '2027-11-05', '2027-12-03'] },
  { title: 'CPI (Consumer Price Index)', time: '08:30', dates: ['2026-11-10', '2026-12-10', '2027-01-13', '2027-02-11', '2027-03-10', '2027-04-13', '2027-05-12', '2027-06-10', '2027-07-14', '2027-08-11', '2027-09-14', '2027-10-14', '2027-11-10', '2027-12-10'] },
  { title: 'PPI (Producer Price Index)', time: '08:30', dates: ['2026-11-13', '2026-12-15', '2027-01-14', '2027-02-12', '2027-03-12', '2027-04-14', '2027-05-13', '2027-06-11', '2027-07-15', '2027-08-10', '2027-09-10', '2027-10-15', '2027-11-12', '2027-12-15'] },
  { title: 'JOLTS Job Openings', time: '10:00', dates: ['2026-11-03', '2026-12-01', '2027-01-05', '2027-02-02', '2027-03-09', '2027-03-30', '2027-05-04', '2027-06-02', '2027-06-29', '2027-08-03', '2027-08-31', '2027-10-05', '2027-11-02', '2027-12-01'] },
];

// ---------- helpers ----------
function tzOffsetMs(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}
/** A wall-clock time in New York → epoch ms. */
export function nyTime(dateStr, hhmm) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m);
  let t = guess - tzOffsetMs(guess, 'America/New_York');
  t = guess - tzOffsetMs(t, 'America/New_York');
  return t;
}
const nyDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const clean = (v) => { const s = String(v ?? '').replace(/&nbsp;/g, ' ').trim(); return s || null; };
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const IMPACT = { high: 'high', medium: 'medium', low: 'low', holiday: 'holiday', 'non-economic': 'none' };

/** ForexFactory feed rows → our events. */
export function parseFF(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const title = clean(r?.title);
    const ms = Date.parse(r?.date);
    if (!title || !Number.isFinite(ms)) continue;
    const impact = IMPACT[String(r.impact || '').toLowerCase()] || 'none';
    const ccy = (clean(r.country) || '').toUpperCase().slice(0, 4) || 'ALL';
    const t = new Date(ms).toISOString();
    out.push({
      id: `ff:${t}:${ccy}:${title}`, t, ccy, title, impact, src: 'ff',
      allDay: impact === 'holiday' || /\b(all day|tentative)\b/i.test(String(r.time || '')),
      actual: clean(r.actual), forecast: clean(r.forecast), previous: clean(r.previous),
    });
  }
  return out;
}

// ---------- TradingView: actuals + weeks ForexFactory hasn't published ----------
const COUNTRY_CCY = { US: 'USD', EU: 'EUR', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', GB: 'GBP', UK: 'GBP', JP: 'JPY', AU: 'AUD', CA: 'CAD', CH: 'CHF', NZ: 'NZD', CN: 'CNY' };
const COUNTRY_WORD = { DE: 'german', FR: 'french', IT: 'italian', ES: 'spanish' };
/** a TradingView number + its scale / unit → "195K", "0.3%", "-1.2M" */
export function tvValue(v, e = {}) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return v.trim() || null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const txt = String(Number(n.toFixed(Math.abs(n) >= 100 ? 1 : 3)));
  return `${txt}${e.scale && /^[KMBT]$/i.test(e.scale) ? e.scale.toUpperCase() : ''}${e.unit === '%' ? '%' : ''}`;
}
/** importance -1 / 0 / 1 (also seen as 0 / 1 / 2) → our impact */
const tvImpact = (i) => { const n = Number(i); return n >= 1 ? 'high' : n === 0 ? 'medium' : 'low'; };
export function parseTV(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const ms = Date.parse(r?.date);
    const title = clean(r?.title);
    if (!title || !Number.isFinite(ms)) continue;
    const country = String(r.country || '').toUpperCase();
    const ccy = (clean(r.currency) || COUNTRY_CCY[country] || country || 'ALL').toUpperCase();
    out.push({
      id: `tv:${r.id ?? `${ms}:${country}:${title}`}`, t: new Date(ms).toISOString(), ccy, country, title, impact: tvImpact(r.importance), src: 'tv', allDay: false,
      period: clean(r.period), actual: tvValue(r.actual, r), forecast: tvValue(r.forecast, r), previous: tvValue(r.previous, r),
    });
  }
  return out;
}
const STOP = new Set(['the', 'of', 'and', 'change', 'index', 'initial', 's', 'sa', 'nsa', 'n', 'a', 'level']);
const SYN = { mm: 'mom', yy: 'yoy', qq: 'qoq', jobless: 'unemployment', payrolls: 'employment', payroll: 'employment', nonfarm: 'nfp', germany: 'german', france: 'french', italy: 'italian', spain: 'spanish', ppi: 'ppi', preliminary: 'prelim', flash: 'prelim' };
export function titleTokens(title, country = '') {
  const s = `${COUNTRY_WORD[country] || ''} ${String(title).toLowerCase()}`
    .replace(/\b([mqy])\/\1\b/g, (_, x) => ` ${x}o${x === 'm' ? 'm' : x} `.replace('yoy', 'yoy')) // m/m → mom, y/y → yoy, q/q → qoq
    .replace(/inflation rate/g, 'cpi').replace(/consumer price index/g, 'cpi').replace(/producer price index/g, 'ppi')
    .replace(/non[- ]farm/g, 'nonfarm').replace(/\(.*?\)/g, ' ');
  return new Set(s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).map((w) => SYN[w] || w));
}
const numOf = (v) => { if (v == null) return null; const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/); if (!m) return null; const u = String(v).slice(m.index + m[0].length).trim().charAt(0).toUpperCase(); return parseFloat(m[0]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[u] || 1); };
const same = (a, b) => { const x = numOf(a), y = numOf(b); return x != null && y != null && Math.abs(x - y) <= Math.max(1e-9, Math.abs(y) * 0.005); };
/** Pair each ForexFactory event with the TradingView release it describes; returns Map(ffId → tvEvent). */
export function matchEvents(ffEvents, tvEvents) {
  const pairs = [];
  for (const f of ffEvents) {
    const fms = Date.parse(f.t);
    const ft = titleTokens(f.title);
    for (const v of tvEvents) {
      if (v.ccy !== f.ccy || Math.abs(Date.parse(v.t) - fms) > 10 * MIN) continue;
      const vt = titleTokens(v.title, v.country);
      const inter = [...ft].filter((w) => vt.has(w)).length;
      const jac = inter / (new Set([...ft, ...vt]).size || 1);
      const score = jac + (same(f.previous, v.previous) ? 0.8 : 0) + (same(f.forecast, v.forecast) ? 0.4 : 0);
      if (score >= 0.5) pairs.push([score, f.id, v]);
    }
  }
  pairs.sort((a, b) => b[0] - a[0]);
  const out = new Map(), used = new Set();
  for (const [, fid, v] of pairs) if (!out.has(fid) && !used.has(v.id)) { out.set(fid, v); used.add(v.id); }
  return out;
}

/** Official dates as events, skipping days ForexFactory already covers (its listing is more complete). */
export function scheduleEvents(fromMs, toMs, covered = []) {
  const inCover = (ms) => covered.some(([a, b]) => ms >= a && ms <= b);
  const out = [];
  const byTitle = Object.fromEntries(SCHEDULE.map((s) => [s.title, s]));
  for (const s of SCHEDULE) {
    for (const date of s.dates || byTitle[s.same]?.dates || []) {
      const ms = nyTime(date, s.time);
      if (ms < fromMs || ms > toMs || inCover(ms)) continue;
      const t = new Date(ms).toISOString();
      out.push({ id: `sch:${t}:${s.title}`, t, ccy: 'USD', title: s.title, impact: 'high', src: 'schedule', allDay: false, actual: null, forecast: null, previous: null });
    }
  }
  return out;
}

/** Merge a fetched feed into the store: within the feed's days, the feed replaces what we had (times can move). */
export function mergeWeek(store, events, now = Date.now()) {
  if (!events.length) return store;
  const times = events.map((e) => Date.parse(e.t));
  const from = nyTime(nyDay(Math.min(...times)), '00:00');
  const to = nyTime(nyDay(Math.max(...times)), '23:59') + 59e3;
  const kept = (store.events || []).filter((e) => { const ms = Date.parse(e.t); return (ms < from || ms > to) && ms > now - CAL_KEEP; });
  const covered = [...(store.covered || []).filter(([, b]) => b > now - CAL_KEEP), [from, to]].sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const c of covered) { const last = merged[merged.length - 1]; if (last && c[0] <= last[1] + DAY) last[1] = Math.max(last[1], c[1]); else merged.push([...c]); }
  return { ...store, events: [...kept, ...events].sort((a, b) => a.t.localeCompare(b.t)), covered: merged };
}

/** CFTC rows → { [code]: { code, name, rows: [[date, oi, ncL, ncS, cL, cS, nrL, nrS], …] } } merged into `markets`. */
export function mergeCot(markets, rows) {
  const out = { ...markets };
  for (const r of Array.isArray(rows) ? rows : []) {
    const code = String(r.cftc_contract_market_code || '').trim().toUpperCase();
    const date = String(r.report_date_as_yyyy_mm_dd || '').slice(0, 10);
    if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const row = [date, num(r.open_interest_all), num(r.noncomm_positions_long_all), num(r.noncomm_positions_short_all),
      num(r.comm_positions_long_all), num(r.comm_positions_short_all), num(r.nonrept_positions_long_all), num(r.nonrept_positions_short_all)];
    const m = out[code] ? { ...out[code], rows: [...out[code].rows] } : { code, name: '', rows: [] };
    if (r.market_and_exchange_names) m.name = String(r.market_and_exchange_names).trim();
    const i = m.rows.findIndex((x) => x[0] === date);
    if (i >= 0) m.rows[i] = row; else m.rows.push(row);
    m.rows.sort((a, b) => a[0].localeCompare(b[0]));
    out[code] = m;
  }
  return out;
}

/** When the next COT report should be out: the Friday after the next Tuesday, 3:30 PM ET (+ a little slack). */
export function nextCotRelease(reportDate) {
  if (!reportDate) return 0;
  const d = new Date(`${reportDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 10);
  return nyTime(d.toISOString().slice(0, 10), '15:45');
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export function createMacroHandler(dataDir, { log = () => {}, fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}) {
  const dir = path.join(dataDir, 'macro');
  const file = (n) => path.join(dir, n);
  const load = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
  const save = (n, v) => { fs.mkdirSync(dir, { recursive: true }); const tmp = file(n) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, file(n)); };
  let cal = load('calendar.json', { events: [], covered: [] });
  let cot = load('cot.json', { markets: {} });
  let tv = load('tradingview.json', { days: {}, events: {} });
  const busy = {};
  const once = (k, fn) => (busy[k] ||= fn().finally(() => { busy[k] = null; }));

  async function get(url, { json = true, timeout = 20000, headers = {} } = {}) {
    const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) });
    const text = await r.text();
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; e.body = text.slice(0, 300); throw e; }
    if (!json) return text;
    if (/^\s*</.test(text)) { const e = new Error('rate limited'); e.rateLimited = true; throw e; } // ForexFactory answers too-frequent requests with a web page
    return JSON.parse(text);
  }

  // ---------- calendar ----------
  const refreshCalendar = () => once('cal', async () => {
    cal = { ...cal, lastTry: now() };
    let got = 0;
    let error = null;
    for (const [i, url] of FF_FEEDS.entries()) {
      try {
        const events = parseFF(await get(url));
        cal = mergeWeek(cal, events, now());
        got += events.length;
      } catch (e) {
        if (e.status === 404 && i > 0) continue; // next week's feed appears later in the week
        error = e.rateLimited ? 'ForexFactory asked us to slow down — trying again in a few minutes.' : `Couldn’t reach ForexFactory’s calendar feed (${e.message}).`;
        log('[macro] calendar:', e.message);
        break;
      }
    }
    cal = { ...cal, error, ...(got ? { updatedAt: now() } : {}) };
    save('calendar.json', cal);
    if (got) log(`[macro] calendar: ${got} events`);
  });
  const calStale = () => !cal.lastTry || now() - (cal.updatedAt || 0) > CAL_STALE && now() - cal.lastTry > (cal.error ? CAL_RETRY : CAL_STALE);

  // TradingView, one stretch of days at a time; days near today are re-checked every few minutes for actuals
  const tvDue = (d) => {
    const f = tv.days[d];
    if (!f) return true;
    const start = Date.parse(`${d}T00:00:00Z`), end = start + DAY, t = now();
    if (t >= start - DAY && t <= end + DAY) return t - f > 3 * MIN;
    if (start > t) return t - f > 6 * HOUR;
    return f < end + 2 * DAY && t - f > HOUR; // a past day fetched before its numbers settled
  };
  const refreshTv = (days) => once('tv', async () => {
    tv = { ...tv, lastTry: now() };
    const runs = [];
    for (const d of [...days].sort()) {
      const last = runs[runs.length - 1];
      if (last && Date.parse(`${d}T00:00:00Z`) - Date.parse(`${last[last.length - 1]}T00:00:00Z`) === DAY && last.length < TV_CHUNK_DAYS) last.push(d); else runs.push([d]);
    }
    try {
      for (const run of runs) {
        const from = Date.parse(`${run[0]}T00:00:00Z`), to = Date.parse(`${run[run.length - 1]}T00:00:00Z`) + DAY - 1;
        const q = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), countries: TV_COUNTRIES });
        const j = await get(`${TV_URL}?${q}`, { headers: TV_HEADERS });
        if (j?.status && j.status !== 'ok') throw new Error(`TradingView answered “${j.status}”`);
        const fresh = parseTV(j?.result);
        const events = Object.fromEntries(Object.entries(tv.events).filter(([, e]) => { const ms = Date.parse(e.t); return (ms < from || ms > to) && ms > now() - CAL_KEEP; }));
        for (const e of fresh) events[e.id] = e;
        const daysDone = { ...tv.days };
        for (const d of run) daysDone[d] = now();
        tv = { ...tv, events, days: daysDone, error: null };
      }
    } catch (e) {
      tv = { ...tv, error: `Couldn’t get actuals from TradingView (${e.message}).` };
      log('[macro] tradingview:', e.message);
    }
    for (const d of Object.keys(tv.days)) if (Date.parse(`${d}T00:00:00Z`) < now() - CAL_KEEP) delete tv.days[d];
    save('tradingview.json', tv);
  });

  async function calendar(fromStr, toStr, { useTv = true } = {}) {
    const today = now();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(fromStr || '') ? Date.parse(`${fromStr}T00:00:00Z`) - DAY : today - 7 * DAY;
    const to = Math.min(/^\d{4}-\d{2}-\d{2}$/.test(toStr || '') ? Date.parse(`${toStr}T00:00:00Z`) + 2 * DAY : today + 14 * DAY, from + 120 * DAY);
    let refreshing = false;
    const waits = [];
    if (calStale()) {
      if (!cal.events.length) waits.push(refreshCalendar().catch(() => {})); // first visit: wait for it
      else { refreshing = true; refreshCalendar().catch(() => {}); }
    }
    if (useTv && !(tv.error && today - (tv.lastTry || 0) < CAL_RETRY)) {
      const days = [];
      for (let t = from; t <= to; t += DAY) days.push(isoDay(t));
      const due = days.filter(tvDue);
      if (due.length) waits.push(refreshTv(due).catch(() => {}));
    }
    if (waits.length) {
      const done = await Promise.race([Promise.all(waits).then(() => true), new Promise((r) => setTimeout(() => r(false), 9000))]);
      if (!done) refreshing = true;
    }
    const within = (e) => { const ms = Date.parse(e.t); return ms >= from && ms <= to; };
    const inCover = (e) => { const ms = Date.parse(e.t); return (cal.covered || []).some(([a, b]) => ms >= a && ms <= b); };
    let ff = cal.events.filter(within);
    const tvIn = useTv ? Object.values(tv.events).filter(within) : [];
    if (tvIn.length) {
      // ForexFactory's feed has no actual figures: take them from the matching TradingView release
      const m = matchEvents(ff.filter((e) => !e.allDay), tvIn);
      let dirty = false;
      ff = ff.map((e) => {
        const v = m.get(e.id);
        if (!v) return e;
        const add = { actual: e.actual || v.actual, forecast: e.forecast || v.forecast, previous: e.previous || v.previous };
        if (add.actual !== e.actual) dirty = true;
        return { ...e, ...add };
      });
      if (dirty) { // keep them, so earlier releases show their actuals later
        const byId = new Map(ff.map((e) => [e.id, e]));
        cal = { ...cal, events: cal.events.map((e) => byId.get(e.id) || e) };
        save('calendar.json', cal);
      }
    }
    const tvOutside = tvIn.filter((e) => !inCover(e)).map((e) => ({ ...e, title: e.period ? `${e.title} (${e.period})` : e.title }));
    const tvDays = new Set(useTv ? Object.keys(tv.days) : []);
    const sched = scheduleEvents(from, to, cal.covered).filter((e) => !tvDays.has(isoDay(Date.parse(e.t))));
    // market & bank holidays from our own rules (months ahead); the feeds' own holiday rows for the same day give way
    const hol = holidayEvents(isoDay(from), isoDay(to));
    const holKeys = new Set(hol.map((h) => `${h.ccy}|${h.t.slice(0, 10)}`));
    const HOLIDAY_WORDS = /holiday|christmas|new year|thanksgiving|independence|labou?r day|memorial|juneteenth|easter|good friday|boxing|national day|veterans|columbus|remembrance/i;
    const isDupHoliday = (e) => !e.actual && !e.forecast && (e.impact === 'holiday' || HOLIDAY_WORDS.test(e.title))
      && (holKeys.has(`${e.ccy}|${nyDay(Date.parse(e.t))}`) || holKeys.has(`${e.ccy}|${e.t.slice(0, 10)}`));
    const events = [...[...ff, ...tvOutside].filter((e) => !isDupHoliday(e)), ...sched, ...hol].sort((a, b) => a.t.localeCompare(b.t));
    const errors = [cal.error, useTv && tvIn.length === 0 ? tv.error : null].filter(Boolean);
    return {
      events, coverage: (cal.covered || []).map(([a, b]) => [new Date(a).toISOString(), new Date(b).toISOString()]),
      extended: useTv && tvIn.some((e) => !inCover(e)), // TradingView fills the weeks ForexFactory hasn't published
      updatedAt: cal.updatedAt || null, actualsAt: useTv ? tv.lastTry || null : null, error: errors.join(' ') || null, refreshing,
      source: useTv ? 'ForexFactory · TradingView (actuals, later weeks) · Federal Reserve · BLS' : 'ForexFactory · Federal Reserve · BLS',
    };
  }

  // ---------- COT ----------
  const allCodes = () => COT_MARKETS.flatMap((m) => m.codes);
  async function cftc(where, select = true) {
    const q = new URLSearchParams({ $where: where, $order: 'report_date_as_yyyy_mm_dd ASC', $limit: '50000' });
    if (select) q.set('$select', COT_FIELDS.join(','));
    try { return await get(`${CFTC}?${q}`, { timeout: 60000 }); }
    catch (e) { if (select && e.status === 400) return cftc(where, false); throw e; } // a renamed column: take every column instead
  }
  const inList = (codes) => codes.map((c) => `'${c}'`).join(',');
  const fetchCodes = async (codes, since) => {
    const rows = await cftc(`cftc_contract_market_code in(${inList(codes)}) AND report_date_as_yyyy_mm_dd >= '${since}T00:00:00.000'`);
    cot = { ...cot, markets: mergeCot(cot.markets, rows) };
    return rows.length;
  };
  const sinceFull = () => isoDay(now() - (COT_YEARS * 365 + 35) * DAY);
  const latestDate = () => Object.values(cot.markets).reduce((a, m) => (m.rows.length && m.rows[m.rows.length - 1][0] > a ? m.rows[m.rows.length - 1][0] : a), '');
  const trim = () => {
    const keep = sinceFull();
    for (const m of Object.values(cot.markets)) m.rows = m.rows.filter((r) => r[0] >= keep);
  };

  const refreshCot = (extra = []) => once('cot', async () => {
    cot = { ...cot, lastTry: now() };
    try {
      const latest = latestDate();
      const known = new Set(Object.keys(cot.markets));
      const codes = [...new Set([...allCodes(), ...extra])];
      const fresh = codes.filter((c) => !known.has(c));
      const old = codes.filter((c) => known.has(c));
      let n = 0;
      // markets we don't have yet: three years; the rest: the last few weeks (picks up revisions too)
      if (fresh.length) n += await fetchCodes(fresh, sinceFull());
      if (old.length) n += await fetchCodes(old, latest ? isoDay(Date.parse(latest) - 28 * DAY) : sinceFull());
      trim();
      cot = { ...cot, error: null, updatedAt: now(), reportDate: latestDate() || null };
      log(`[macro] COT: ${n} rows, report of ${cot.reportDate}`);
    } catch (e) {
      cot = { ...cot, error: `Couldn’t reach the CFTC (${e.message}).` };
      log('[macro] COT:', e.message, e.body || '');
    }
    save('cot.json', cot);
  });
  const cotStale = () => {
    const t = now();
    if (cot.lastTry && t - cot.lastTry < (cot.error ? 10 * MIN : COT_RETRY)) return false;
    return !cot.reportDate || t >= nextCotRelease(cot.reportDate);
  };

  const pickCode = (m) => {
    const have = m.codes.map((c) => cot.markets[c]).filter((x) => x?.rows.length);
    if (!have.length) return null;
    return have.reduce((a, b) => (b.rows[b.rows.length - 1][0] > a.rows[a.rows.length - 1][0] ? b : a));
  };

  async function cotReport(extra) {
    let refreshing = false;
    const missing = extra.filter((c) => !cot.markets[c]);
    if (!Object.keys(cot.markets).length || missing.length) await refreshCot(extra).catch(() => {});
    else if (cotStale()) { refreshing = true; refreshCot(extra).catch(() => {}); }
    const markets = COT_MARKETS.map((m) => {
      const d = pickCode(m);
      return d ? { key: m.key, label: m.label, group: m.group, code: d.code, name: d.name, rows: d.rows } : null;
    }).filter(Boolean);
    const shown = new Set(markets.map((m) => m.code));
    for (const c of extra) {
      const d = cot.markets[c];
      if (d?.rows.length && !shown.has(c)) markets.push({ key: c, label: d.name.split(' - ')[0] || c, group: 'Yours', code: c, name: d.name, rows: d.rows, extra: true });
    }
    return { markets, reportDate: cot.reportDate || latestDate() || null, nextRelease: cot.reportDate ? new Date(nextCotRelease(cot.reportDate)).toISOString() : null, updatedAt: cot.updatedAt || null, error: cot.error || null, refreshing, source: 'CFTC Commitments of Traders (Legacy, futures only)' };
  }

  async function catalog() {
    const c = load('cot-markets.json', null);
    if (c && now() - c.at < 3 * DAY) return c.markets;
    const latest = latestDate() || isoDay(now() - 14 * DAY);
    const q = new URLSearchParams({ $select: 'cftc_contract_market_code,market_and_exchange_names', $where: `report_date_as_yyyy_mm_dd >= '${isoDay(Date.parse(latest) - 7 * DAY)}T00:00:00.000'`, $limit: '5000' });
    const rows = await get(`${CFTC}?${q}`, { timeout: 30000 });
    const seen = new Map();
    for (const r of rows) { const code = String(r.cftc_contract_market_code || '').trim().toUpperCase(); if (code && !seen.has(code)) seen.set(code, String(r.market_and_exchange_names || '').trim()); }
    const markets = [...seen].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
    save('cot-markets.json', { at: now(), markets });
    return markets;
  }

  const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
  const body = (req) => new Promise((resolve) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 1e4) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } }); });

  const handler = async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const route = u.pathname.replace(/^\/api\/macro/, '') || '/';
    try {
      if (req.method === 'GET' && route === '/calendar') return send(res, 200, await calendar(u.searchParams.get('from'), u.searchParams.get('to'), { useTv: u.searchParams.get('tv') !== '0' }));
      if (req.method === 'GET' && route === '/calendar/history') {
        const ccy = String(u.searchParams.get('ccy') || '').toUpperCase(), title = String(u.searchParams.get('title') || '');
        const tvTitle = title.replace(/ \([^)]*\)$/, '');
        const events = [...cal.events.filter((e) => e.ccy === ccy && e.title === title), ...Object.values(tv.events).filter((e) => e.ccy === ccy && e.title === tvTitle)]
          .filter((e) => Date.parse(e.t) <= now()).sort((a, b) => a.t.localeCompare(b.t)).slice(-24);
        return send(res, 200, { events });
      }
      if (req.method === 'GET' && route === '/cot') {
        const extra = (u.searchParams.get('extra') || '').split(',').map((c) => c.trim().toUpperCase()).filter((c) => CODE_RE.test(c)).slice(0, 20);
        return send(res, 200, await cotReport(extra));
      }
      if (req.method === 'GET' && route === '/cot/markets') return send(res, 200, { markets: await catalog() });
      if (req.method === 'POST' && route === '/refresh') {
        const b = await body(req);
        if (b.what === 'calendar') { if (!cal.lastTry || now() - cal.lastTry > 2 * MIN) await refreshCalendar(); return send(res, 200, { ok: true, error: cal.error || null }); }
        if (b.what === 'cot') { if (!cot.lastTry || now() - cot.lastTry > 2 * MIN) await refreshCot(); return send(res, 200, { ok: true, error: cot.error || null }); }
        return send(res, 400, { error: 'what?' });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      log('[macro]', e.message);
      return send(res, 502, { error: e.message });
    }
  };
  handler.refreshCalendar = refreshCalendar;
  handler.refreshCot = refreshCot;
  return handler;
}
