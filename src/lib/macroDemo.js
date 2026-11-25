import { computeGex, computeVannaCharm, expiryMs } from './gexMath';
// Made-up macro data for the public demo (no server there). Loaded only on the demo site.
const MIN = 60000, DAY = 86400000;
// [weekday (0 = Sun), ET time, ccy, title, impact, forecast, previous]
const WEEK = [
  [0, '18:50', 'JPY', 'Core Machinery Orders m/m', 'low', '1.1%', '-0.6%'],
  [1, '04:00', 'EUR', 'Sentix Investor Confidence', 'low', '-6.4', '-7.2'],
  [1, '10:00', 'USD', 'ISM Manufacturing PMI', 'high', '49.3', '48.7'],
  [1, '21:30', 'AUD', 'Retail Sales m/m', 'medium', '0.3%', '0.4%'],
  [2, '02:00', 'GBP', 'Claimant Count Change', 'medium', '21.4K', '26.1K'],
  [2, '05:00', 'EUR', 'German ZEW Economic Sentiment', 'medium', '11.2', '9.8'],
  [2, '08:30', 'USD', 'CPI m/m', 'high', '0.3%', '0.2%'],
  [2, '08:30', 'USD', 'Core CPI m/m', 'high', '0.3%', '0.3%'],
  [2, '10:00', 'USD', 'JOLTS Job Openings', 'high', '7.45M', '7.67M'],
  [3, '04:00', 'USD', 'MBA Mortgage Applications', 'low', '', '-1.2%'],
  [3, '08:30', 'CAD', 'Manufacturing Sales m/m', 'low', '0.5%', '-1.3%'],
  [3, '10:30', 'USD', 'Crude Oil Inventories', 'medium', '-1.1M', '-0.9M'],
  [3, '14:00', 'USD', 'FOMC Statement', 'high', '', ''],
  [3, '14:00', 'USD', 'Federal Funds Rate', 'high', '4.25%', '4.25%'],
  [3, '14:30', 'USD', 'FOMC Press Conference', 'high', '', ''],
  [4, '02:00', 'GBP', 'GDP m/m', 'high', '0.1%', '0.2%'],
  [4, '08:30', 'USD', 'Unemployment Claims', 'high', '219K', '221K'],
  [4, '08:30', 'USD', 'PPI m/m', 'medium', '0.2%', '0.4%'],
  [4, '08:15', 'EUR', 'Main Refinancing Rate', 'high', '2.15%', '2.15%'],
  [4, '08:45', 'EUR', 'ECB Press Conference', 'high', '', ''],
  [4, '19:30', 'AUD', 'Employment Change', 'high', '22.5K', '14.9K'],
  [5, '08:30', 'USD', 'Non-Farm Employment Change', 'high', '118K', '142K'],
  [5, '08:30', 'USD', 'Unemployment Rate', 'high', '4.3%', '4.3%'],
  [5, '08:30', 'CAD', 'Employment Change', 'high', '12.3K', '-6.5K'],
  [5, '10:00', 'USD', 'Prelim UoM Consumer Sentiment', 'medium', '53.8', '55.1'],
];
const rnd = (seed) => { let x = Math.sin(seed) * 10000; return x - Math.floor(x); };
const nyOffset = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / MIN) * MIN; };
const nyTime = (y, m, d, hh, mm) => { const g = Date.UTC(y, m, d, hh, mm); return g - nyOffset(g); };
const bump = (v, r) => {
  const m = String(v).match(/-?\d+(\.\d+)?/);
  if (!m) return v;
  const dp = (m[1] || '.').length - 1;
  const n = parseFloat(m[0]) + (r - 0.5) * Math.max(Math.abs(parseFloat(m[0])) * 0.25, 10 ** -dp * 3);
  return v.replace(m[0], n.toFixed(dp));
};

function calendar(from, to) {
  const events = [];
  const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T23:59:59Z`);
  const now = Date.now();
  for (let t = start; t <= end; t += DAY) {
    const d = new Date(t);
    for (const [i, [wd, time, ccy, title, impact, forecast, previous]] of WEEK.entries()) {
      if (d.getUTCDay() !== wd) continue;
      // every other week for the monthly / central-bank items, so the month view isn't the same every week
      const wk = Math.floor(t / (7 * DAY));
      if (/FOMC|Funds|Refinancing|ECB|Non-Farm|Unemployment Rate|CPI|GDP|JOLTS|Employment Change/.test(title) && (wk + i) % 4) continue;
      const [hh, mm] = time.split(':').map(Number);
      const ms = nyTime(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm);
      const r = rnd(ms / MIN + i);
      events.push({ id: `demo:${ms}:${i}`, t: new Date(ms).toISOString(), ccy, title, impact, src: 'ff', allDay: false, forecast: forecast || null, previous: previous || null, actual: ms < now && forecast ? bump(forecast, r) : null });
    }
  }
  return { events: events.sort((a, b) => a.t.localeCompare(b.t)), coverage: [[new Date(now - 400 * DAY).toISOString(), new Date(now + 400 * DAY).toISOString()]], updatedAt: now, source: 'Sample data (demo)' };
}

const MARKETS = [
  ['ES', 'S&P 500 E-mini', 'Indices', 2.1e6, 0.12], ['NQ', 'Nasdaq-100 E-mini', 'Indices', 2.5e5, 0.18], ['YM', 'Dow E-mini', 'Indices', 9e4, -0.05], ['RTY', 'Russell 2000 E-mini', 'Indices', 4.5e5, -0.2],
  ['ZN', '10-Year Note', 'Rates', 4.4e6, -0.15], ['ZB', '30-Year Bond', 'Rates', 1.8e6, -0.1], ['DX', 'US Dollar Index', 'FX', 3e4, 0.25],
  ['6E', 'Euro', 'FX', 7e5, 0.14], ['6J', 'Japanese Yen', 'FX', 2.5e5, -0.3], ['6B', 'British Pound', 'FX', 2.2e5, 0.05], ['6A', 'Australian Dollar', 'FX', 1.8e5, -0.35],
  ['GC', 'Gold', 'Metals', 5e5, 0.45], ['SI', 'Silver', 'Metals', 1.6e5, 0.3], ['HG', 'Copper', 'Metals', 2.1e5, 0.08],
  ['CL', 'Crude Oil (WTI)', 'Energy', 1.7e6, 0.1], ['NG', 'Natural Gas', 'Energy', 1.5e6, -0.22], ['BTC', 'Bitcoin', 'Crypto', 2.8e4, 0.12], ['ZC', 'Corn', 'Grains', 1.5e6, -0.18],
];
// markets the demo lets you add (RoninFlow on your computer lists all ~400 in the CFTC report)
const EXTRA = [
  ['PL', 'PLATINUM - NEW YORK MERCANTILE EXCHANGE', 7e4, 0.2], ['PA', 'PALLADIUM - NEW YORK MERCANTILE EXCHANGE', 2e4, -0.25],
  ['ZW', 'WHEAT-SRW - CHICAGO BOARD OF TRADE', 4e5, -0.3], ['ZS', 'SOYBEANS - CHICAGO BOARD OF TRADE', 8e5, 0.05], ['LE', 'LIVE CATTLE - CHICAGO MERCANTILE EXCHANGE', 3.5e5, 0.4],
  ['HE', 'LEAN HOGS - CHICAGO MERCANTILE EXCHANGE', 2.8e5, 0.1], ['SB', 'SUGAR NO. 11 - ICE FUTURES U.S.', 9e5, -0.15], ['KC', 'COFFEE C - ICE FUTURES U.S.', 2e5, 0.35],
  ['CC', 'COCOA - ICE FUTURES U.S.', 1.6e5, 0.2], ['CT', 'COTTON NO. 2 - ICE FUTURES U.S.', 2.4e5, -0.2], ['6C', 'CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE', 1.7e5, -0.3],
  ['6S', 'SWISS FRANC - CHICAGO MERCANTILE EXCHANGE', 6e4, -0.1], ['6M', 'MEXICAN PESO - CHICAGO MERCANTILE EXCHANGE', 2.2e5, 0.45], ['6N', 'NZ DOLLAR - CHICAGO MERCANTILE EXCHANGE', 5e4, -0.3],
  ['VX', 'VIX FUTURES - CBOE FUTURES EXCHANGE', 3.5e5, -0.35], ['ZT', 'UST 2Y NOTE - CHICAGO BOARD OF TRADE', 4e6, -0.1], ['ZF', 'UST 5Y NOTE - CHICAGO BOARD OF TRADE', 6e6, -0.2],
  ['ETH', 'ETHER CASH SETTLED - CHICAGO MERCANTILE EXCHANGE', 1.4e4, 0.1], ['HO', 'NY HARBOR ULSD - NEW YORK MERCANTILE EXCHANGE', 3.2e5, 0.05], ['RB', 'GASOLINE RBOB - NEW YORK MERCANTILE EXCHANGE', 3.4e5, 0.15],
].map(([key, name, oi0, bias], k) => ({ key, name, oi0, bias, code: `DX${String(k).padStart(3, '0')}` }));
function cotMarkets() { return { markets: EXTRA.map(({ code, name }) => ({ code, name: `${name} (sample)` })).sort((a, b) => a.name.localeCompare(b.name)) }; }

function cot(extraCodes = []) {
  const weeks = 160;
  const last = new Date(); last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() + 5) % 7) - (last.getUTCDay() >= 5 ? 0 : 7)); // last Tuesday with a released report
  const extras = extraCodes.map((c) => EXTRA.find((x) => x.code === c)).filter(Boolean);
  const list = [...MARKETS.map(([key, label, group, oi0, bias]) => ({ key, label, group, oi0, bias })), ...extras.map((x) => ({ key: x.code, label: x.name.split(' - ')[0], group: 'Yours', oi0: x.oi0, bias: x.bias, code: x.code, name: `${x.name} (sample)`, extra: true }))];
  const markets = list.map(({ key, label, group, oi0, bias, code, name, extra }, k) => {
    let net = bias * oi0 * 0.6, oi = oi0;
    const rows = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const d = new Date(last.getTime() - w * 7 * DAY).toISOString().slice(0, 10);
      net += (rnd(k * 1000 + w) - 0.5 + (bias * oi0 * 0.6 - net) / (oi0 * 3)) * oi0 * 0.05;
      oi = Math.max(oi0 * 0.6, oi + (rnd(k * 777 + w) - 0.5) * oi0 * 0.04);
      const gross = oi * 0.32;
      const sl = Math.round(gross / 2 + net / 2), ss = Math.round(gross / 2 - net / 2);
      const small = Math.round((rnd(k * 31 + w) - 0.5) * oi * 0.04);
      const cl = Math.round(oi * 0.5 - net * 0.8), cs = Math.round(oi * 0.5 + net * 0.2);
      rows.push([d, Math.round(oi), Math.max(0, sl), Math.max(0, ss), Math.max(0, cl), Math.max(0, cs), Math.round(oi * 0.08 + small), Math.round(oi * 0.08 - small)]);
    }
    return { key, label, group, code: code || `DEMO${k}`, name: name || `${label.toUpperCase()} — sample data`, rows, ...(extra ? { extra: true } : {}) };
  });
  const reportDate = markets[0].rows[markets[0].rows.length - 1][0];
  return { markets, reportDate, nextRelease: new Date(Date.parse(`${reportDate}T20:30:00Z`) + 10 * DAY).toISOString(), updatedAt: Date.now(), source: 'Sample data (demo) — RoninFlow on your computer loads the real CFTC report' };
}

/** Earlier releases of one event (the same made-up numbers the calendar shows for those weeks). */
function history(ccy, title) {
  const now = Date.now();
  const all = calendar(new Date(now - 400 * DAY).toISOString().slice(0, 10), new Date(now).toISOString().slice(0, 10)).events;
  return { events: all.filter((e) => e.ccy === ccy && e.title === title && Date.parse(e.t) < now).slice(-12) };
}

// ---------- GEX: a made-up options chain shaped like a real one (walls, skew, a 0DTE pile-up at the money) ----------
const GEX_BASE = { SPX: [6020, 5, 'ES', 1.0052], NDX: [21480, 10, 'NQ', 1.0047], RUT: [2395, 5, 'RTY', 1.0031], SPY: [600.4, 1, 'ES', 10.03], QQQ: [522.6, 1, 'NQ', 41.3], IWM: [238.7, 1, 'RTY', 10.06] };
function gexExpirations(now) {
  const out = [];
  const d = new Date(now);
  for (let i = 0; out.length < 16 && i < 40; i++, d.setDate(d.getDate() + 1)) if (d.getDay() > 0 && d.getDay() < 6 && expiryMs(d.toLocaleDateString('en-CA')) > now) out.push(d.toLocaleDateString('en-CA'));
  for (let m = 1; m <= 6; m++) { // third Fridays out to six months
    const t = new Date(new Date(now).getFullYear(), new Date(now).getMonth() + m, 1);
    t.setDate(1 + ((5 - t.getDay() + 7) % 7) + 14);
    out.push(t.toLocaleDateString('en-CA'));
  }
  return [...new Set(out)].sort();
}
function gex(symbol, exps) {
  const [base, step, fut, ratio] = GEX_BASE[symbol] || [100 + (symbol.charCodeAt(0) % 50) * 7, 1, null, null];
  const now = Date.now();
  const wob = Math.sin(now / 9e5) * step * 0.6;
  const spot = Math.round((base + wob) * 100) / 100;
  const list = gexExpirations(now);
  const pick = exps.length ? exps.filter((e) => list.includes(e)) : list.slice(0, 1);
  const callWall = Math.round(base * 1.008 / (step * 5)) * step * 5, putWall = Math.round(base * 0.99 / (step * 5)) * step * 5;
  const rows = [];
  for (const exp of list) {
    const T = Math.max(1, (Date.parse(`${exp}T21:00:00Z`) - now) / 864e5);
    const near = T < 2 ? 6 : T < 10 ? 2 : 1;
    for (let k = Math.round(base * 0.85 / step) * step; k <= base * 1.15; k += step * (T > 45 ? 5 : 1)) {
      const dist = (k - base) / base;
      const iv = 0.15 + Math.max(0, -dist) * 0.9 + Math.max(0, dist) * 0.25 + (T < 2 ? 0.03 : 0);
      const bell = Math.exp(-(dist * dist) / (2 * (0.012 + T / 3000) ** 2));
      const round = k % (step * 25) === 0 ? 2.2 : k % (step * 5) === 0 ? 1.4 : 0.6;
      const callOi = Math.round((80 + 900 * bell * near) * round * (k === callWall ? 4 : 1) * (dist > 0 ? 1.2 : 0.6));
      const putOi = Math.round((90 + 1100 * bell * near) * round * (k === putWall ? 4.5 : 1) * (dist < 0 ? 1.3 : 0.5));
      rows.push({ exp, type: 'C', strike: k, oi: callOi, iv, mult: 100 }, { exp, type: 'P', strike: k, oi: putOi, iv, mult: 100 });
    }
  }
  const at = now - 15 * 60e3;
  const g = computeGex(rows, { spot, now: at, exps: pick });
  return {
    symbol, spot, at, source: 'cboe', delayed: true, sample: true, liveError: null, expirations: list, exps: pick, ...g,
    near: computeVannaCharm(rows, { spot, now: at, minDte: 0, maxDte: 45 }),
    regime: computeVannaCharm(rows, { spot, now: at, minDte: 46, maxDte: 180 }),
    fut: fut ? { fut, price: Math.round(spot * ratio * 4) / 4, ratio, at } : null,
  };
}

export function demoMacro(url, body) {
  const u = new URL(url, 'http://x');
  if (u.pathname.includes('/news/')) return import('./newsDemo').then((m) => m.demoNews(url, body));
  if (u.pathname.includes('/fred')) return import('./fredDemo').then((m) => m.demoFred(u));
  if (u.pathname.endsWith('/gex')) return gex(String(u.searchParams.get('symbol') || 'SPX').toUpperCase(), (u.searchParams.get('exp') || '').split(',').filter(Boolean));
  if (u.pathname.endsWith('/calendar/history')) return history(u.searchParams.get('ccy'), u.searchParams.get('title'));
  if (u.pathname.endsWith('/calendar')) return calendar(u.searchParams.get('from'), u.searchParams.get('to'));
  if (u.pathname.endsWith('/cot/markets')) return cotMarkets();
  if (u.pathname.endsWith('/cot')) return cot((u.searchParams.get('extra') || '').split(',').filter(Boolean));
  if (u.pathname.endsWith('/refresh')) return { ok: true };
  return {};
}
