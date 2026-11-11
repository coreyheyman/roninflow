// Pure calculation + formatting helpers shared by every view.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const POINT_VALUE = { MES: 5, ES: 50, MNQ: 2, NQ: 20, MYM: 0.5, YM: 5, M2K: 5, RTY: 50, MGC: 10, GC: 100, MCL: 100, CL: 1000 };

// ---------- dates ----------
export const pad = (n) => String(n).padStart(2, '0');

// ---------- your time zone ----------
// Trades are kept as wall-clock times ("2026-11-10T06:35:00"). Times that arrive as exact instants (live sync,
// broker APIs) are turned into wall-clock time in your time zone — Settings → Language & region (default: this device).
let homeTz = null;
export const setHomeTimeZone = (tz) => { homeTz = tz && tz !== 'device' ? tz : null; };
export const homeTimeZone = () => homeTz || Intl.DateTimeFormat().resolvedOptions().timeZone;
/** An instant (Date / ISO with zone) → "YYYY-MM-DDTHH:mm:ss" in your time zone. */
export function wallClock(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  if (!homeTz) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: homeTz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
export const dayKey = (iso) => iso.slice(0, 10);
export const toDate = (iso) => new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
export const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtDate = (iso) => {
  const d = toDate(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};
export const fmtShortDate = (iso) => {
  const d = toDate(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
export const fmtTime12 = (iso) => {
  const d = toDate(iso);
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${ap}`;
};
export const fmtTime24 = (iso) => {
  const d = toDate(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const holdSeconds = (t) => Math.max(0, (toDate(t.exit) - toDate(t.entry)) / 1000);
/** Trades open longer than this are left out of hold-time averages (usually broken fill pairing, e.g. an exit missed for days). */
export const HOLD_CAP_SECONDS = 6 * 3600;
const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Average + median hold time, ignoring outliers above HOLD_CAP_SECONDS. */
export function holdStats(list) {
  const all = list.map(holdSeconds);
  const kept = all.filter((h) => h <= HOLD_CAP_SECONDS);
  return { avg: kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : 0, median: median(all), excluded: all.length - kept.length, longest: all.length ? Math.max(...all) : 0 };
}
export const fmtHold = (sec) => {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${pad(s)}s`;
};
export const fmtDuration = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h}h ${pad(m)}min`;
};

// ---------- money ----------
export const fmtNum = (v, dp = 2) =>
  Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });

// ---------- display currency ----------
// Amounts are stored in USD (what ATAS / the broker reports). The user can pick a display currency in the user menu;
// values are converted with `rate` (USD → currency) unless `convert` is off (account already in that currency).
export const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British pound' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian dollar' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand dollar' },
  { code: 'CHF', symbol: 'CHF ', name: 'Swiss franc' },
  { code: 'JPY', symbol: '¥', name: 'Japanese yen', dp: 0 },
  { code: 'CNY', symbol: 'CN¥', name: 'Chinese yuan' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong dollar' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore dollar' },
  { code: 'INR', symbol: '₹', name: 'Indian rupee' },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican peso' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian real' },
  { code: 'ZAR', symbol: 'R ', name: 'South African rand' },
  { code: 'SEK', symbol: 'kr ', name: 'Swedish krona' },
  { code: 'NOK', symbol: 'kr ', name: 'Norwegian krone' },
  { code: 'DKK', symbol: 'kr ', name: 'Danish krone' },
  { code: 'PLN', symbol: 'zł ', name: 'Polish złoty' },
  { code: 'AED', symbol: 'AED ', name: 'UAE dirham' },
];
let CUR = { ...CURRENCIES[0], rate: 1 };
/** Called by the store whenever settings.currency changes. */
export function setCurrency(c) {
  const def = CURRENCIES.find((x) => x.code === c?.code) || CURRENCIES[0];
  const rate = def.code === 'USD' || c?.convert === false ? 1 : Number(c?.rate) > 0 ? Number(c.rate) : 1;
  CUR = { ...def, rate };
}
export const currency = () => CUR;
export const curSymbol = () => CUR.symbol;
/** USD amount → display currency */
export const conv = (v) => (v || 0) * CUR.rate;
/** Unsigned converted amount without symbol, e.g. "1,234.50" (no decimals for JPY). */
export const fmtAmt = (v, dp = 2) => fmtNum(conv(v), CUR.dp ?? dp);

/** "-$40.70" / "€1,301.70" / "+£439.30". `raw` = value is already in the display currency. */
export function fmtMoney(v, { sign = false, dp = 2, raw = false } = {}) {
  const x = raw ? v : conv(v);
  const neg = x < 0;
  const s = neg ? '-' : sign && x > 0 ? '+' : '';
  return `${s}${CUR.symbol}${fmtNum(x, CUR.dp ?? dp)}`;
}
/** Whole-unit amount in the display currency, e.g. "€1,234". */
export const money0 = (v) => fmtMoney(v, { dp: 0 });
export function fmtCompact(v, opts = {}) {
  const a = Math.abs(typeof opts === 'object' && opts.raw ? v : conv(v));
  const s = v < 0 ? '-' : '';
  if (a >= 1000000) return `${s}${CUR.symbol}${(a / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1000) return `${s}${CUR.symbol}${(a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return `${s}${CUR.symbol}${Math.round(a)}`;
}
export const fmtPct = (v, dp = 1, sign = true) => `${sign && v > 0 ? '+' : ''}${v.toFixed(dp)}%`;

// ---------- trade math ----------
export const result = (t) => (t.pnl > 0 ? 'win' : t.pnl < 0 ? 'loss' : 'be');

export function computePnl({ symbol, direction, entryPrice, exitPrice, qty, fees }) {
  const mult = POINT_VALUE[symbol] ?? 1;
  const diff = (Number(exitPrice) - Number(entryPrice)) * (direction === 'Long' ? 1 : -1);
  return Math.round((diff * mult * Number(qty) - Number(fees || 0)) * 100) / 100;
}

export const sortByEntry = (trades, dir = 'desc') =>
  [...trades].sort((a, b) => (dir === 'desc' ? b.entry.localeCompare(a.entry) : a.entry.localeCompare(b.entry)));

export function summarize(trades) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const be = trades.filter((t) => t.pnl === 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.pnl, 0);
  const net = Math.round(trades.reduce((s, t) => s + t.pnl, 0) * 100) / 100;
  const avg = (arr, f) => (arr.length ? arr.reduce((s, t) => s + f(t), 0) / arr.length : 0);
  const count = trades.length;
  return {
    count,
    net,
    wins: wins.length,
    losses: losses.length,
    be: be.length,
    winRate: count ? (wins.length / count) * 100 : 0,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0,
    avgTrade: count ? net / count : 0,
    avgWin: avg(wins, (t) => t.pnl),
    avgLoss: avg(losses, (t) => t.pnl),
    largestWin: wins.length ? Math.max(...wins.map((t) => t.pnl)) : 0,
    largestLoss: losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0,
    ...(() => {
      const w = holdStats(wins), l = holdStats(losses), b = holdStats(be);
      return {
        holdWin: w.avg, holdLoss: l.avg, holdBe: b.avg,
        holdWinMedian: w.median, holdLossMedian: l.median, holdBeMedian: b.median,
        holdExcluded: { win: w.excluded, loss: l.excluded, be: b.excluded },
      };
    })(),
    fees: trades.reduce((s, t) => s + (t.fees || 0), 0),
  };
}

export const pfText = (pf) => (pf === Infinity ? '∞' : pf.toFixed(2));

/** Session score 0-100 – heuristic tuned to reproduce the reference journal's scores. */
export function dayScore(s) {
  const pf = Math.min(s.profitFactor === Infinity ? 2.2 : s.profitFactor, 2.2);
  const v = 33 + 0.138 * s.winRate + 4.3 * pf + (s.net > 0 ? 12 : 0);
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function groupByDay(trades) {
  const map = new Map();
  for (const t of trades) {
    const k = dayKey(t.entry);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => {
      const sorted = sortByEntry(list, 'asc');
      const s = summarize(sorted);
      const start = sorted[0].entry;
      const end = sorted.reduce((m, t) => (t.exit > m ? t.exit : m), sorted[0].exit);
      return {
        date,
        trades: sorted,
        ...s,
        start,
        end,
        duration: (toDate(end) - toDate(start)) / 1000,
        score: dayScore(s),
      };
    });
}

/** Cumulative P&L per closed trade, ascending. */
export function equityCurve(trades) {
  let c = 0;
  return sortByEntry(trades, 'asc').map((t) => {
    c += t.pnl;
    return { x: t.exit, y: Math.round(c * 100) / 100, t };
  });
}

export function inRange(t, range) {
  if (!range || (!range.from && !range.to)) return true;
  const k = dayKey(t.entry);
  if (range.from && k < range.from) return false;
  if (range.to && k > range.to) return false;
  return true;
}

export function mostTraded(trades) {
  const m = {};
  for (const t of trades) {
    m[t.symbol] = m[t.symbol] || { symbol: t.symbol, count: 0, pnl: 0, trades: [] };
    m[t.symbol].count++;
    m[t.symbol].pnl += t.pnl;
    m[t.symbol].trades.push(t);
  }
  return Object.values(m).sort((a, b) => b.count - a.count);
}

/** % change between last and previous comparable value, safe for 0. */
export function pctChange(curr, prev) {
  if (!prev) return curr ? 100 : 0;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;

/** Sunday that starts the calendar row containing d (calendars run Sunday → Saturday). */
export function startOfCalWeek(d) {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Monday of d's trading week (used for weekly reviews and the "This week" range). */
export function startOfWeek(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function datePresets() {
  const now = new Date();
  const t = keyOf(now);
  const back = (n) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return keyOf(d);
  };
  const som = keyOf(new Date(now.getFullYear(), now.getMonth(), 1));
  const lmS = keyOf(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lmE = keyOf(new Date(now.getFullYear(), now.getMonth(), 0));
  return [
    { label: 'Today', from: t, to: t },
    { label: 'Yesterday', from: back(1), to: back(1) },
    { label: 'This week', from: keyOf(startOfWeek(now)), to: t },
    { label: 'Last 7 days', from: back(6), to: t },
    { label: 'This month', from: som, to: t },
    { label: 'Last month', from: lmS, to: lmE },
    { label: 'Last 30 days', from: back(29), to: t },
    { label: 'Last 90 days', from: back(89), to: t },
    { label: 'Year to date', from: `${now.getFullYear()}-01-01`, to: t },
    { label: 'All time', from: null, to: null },
  ];
}

export function parseCsv(text, delim = ',') {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// ---------- review / risk-adjusted metrics ----------
/** Largest peak-to-trough drop of cumulative P&L (starting at 0) over the trades, as a positive number. */
export function maxDrawdown(trades) {
  let c = 0, peak = 0, dd = 0;
  for (const t of sortByEntry(trades, 'asc')) {
    c += t.pnl;
    if (c > peak) peak = c;
    if (peak - c > dd) dd = peak - c;
  }
  return Math.round(dd * 100) / 100;
}
/** Performance Ratio = win% × (avg win / avg loss). >0.5 good, >0.75 great. */
export function perfRatio(s) {
  if (!s.count) return 0;
  if (!s.avgLoss) return s.avgWin ? Infinity : 0;
  return (s.winRate / 100) * (s.avgWin / Math.abs(s.avgLoss));
}
/** ROMAD = total P&L / max peak-to-trough drawdown in the same period. */
export function romad(net, dd) {
  if (!dd) return net > 0 ? Infinity : 0;
  return net / dd;
}
export const ratioText = (v, dp = 2) => (v === Infinity ? '∞' : v === -Infinity ? '-∞' : v.toFixed(dp));

/**
 * Everything the review pages show for a set of trades.
 * Discipline: trades flagged with an edge blocker (on the trade itself) are undisciplined, all others disciplined;
 * trades flagged with a sizing blocker ("Bad Sizing") count against size management.
 */
export function periodMetrics(trades, { blockers = [] } = {}) {
  const s = summarize(trades);
  const days = [...groupByDay(trades)].reverse(); // oldest → newest
  const nets = days.map((d) => d.net);
  const winD = days.filter((d) => d.net > 0), lossD = days.filter((d) => d.net < 0);
  const mean = nets.length ? nets.reduce((a, b) => a + b, 0) / nets.length : 0;
  const sd = nets.length > 1 ? Math.sqrt(nets.reduce((a, v) => a + (v - mean) ** 2, 0) / (nets.length - 1)) : 0;
  let cw = 0, cl = 0, mw = 0, ml = 0;
  for (const v of nets) {
    if (v > 0) { cw++; cl = 0; } else if (v < 0) { cl++; cw = 0; } else { cw = 0; cl = 0; }
    mw = Math.max(mw, cw); ml = Math.max(ml, cl);
  }
  // discipline: trades flagged with an edge blocker are undisciplined; every other trade counts as disciplined
  let flagged = 0, sizing = 0, flaggedPnl = 0;
  for (const t of trades) {
    const b = Array.isArray(t.blockers) ? t.blockers.filter((x) => !blockers.length || blockers.includes(x)) : [];
    if (!b.length) continue;
    flagged++; flaggedPnl += t.pnl;
    if (b.some((x) => /siz/i.test(x))) sizing++;
  }
  const dd = maxDrawdown(trades);
  const avgOf = (arr) => (arr.length ? arr.reduce((a, d) => a + d.net, 0) / arr.length : 0);
  return {
    ...s,
    days: days.length,
    dayList: days,
    ev: s.avgTrade,
    perfRatio: perfRatio(s),
    maxDD: dd,
    romad: romad(s.net, dd),
    sharpe: sd ? (mean / sd) * Math.sqrt(252) : null,
    avgWinDay: avgOf(winD),
    avgLossDay: avgOf(lossD),
    avgDay: mean,
    bestDay: days.length ? Math.max(...nets) : 0,
    worstDay: days.length ? Math.min(...nets) : 0,
    maxWinStreak: mw,
    maxLossStreak: ml,
    winDaysPct: days.length ? (winD.length / days.length) * 100 : 0,
    flaggedTrades: flagged,
    flaggedPnl: Math.round(flaggedPnl * 100) / 100,
    sizingTrades: sizing,
    discipline: s.count ? ((s.count - flagged) / s.count) * 100 : null,
    sizeMgmt: s.count ? ((s.count - sizing) / s.count) * 100 : null,
  };
}

// ---------- trading days (CME equity futures) ----------
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
const observed = (d) => { const x = new Date(d); if (x.getDay() === 6) x.setDate(x.getDate() - 1); else if (x.getDay() === 0) x.setDate(x.getDate() + 1); return keyOf(x); };
/** Full-day closures: New Year's Day, Good Friday, Christmas (weekend dates move to the nearest weekday). */
export function marketHolidays(y) {
  const gf = easter(y); gf.setDate(gf.getDate() - 2);
  return new Set([observed(new Date(y, 0, 1)), keyOf(gf), observed(new Date(y, 11, 25))]);
}
export function isTradingDay(key) {
  const d = toDate(key);
  return d.getDay() !== 0 && d.getDay() !== 6 && !marketHolidays(d.getFullYear()).has(key);
}
/** Today if it's a trading day, otherwise the next one. */
export function currentTradingDay(from = todayKey()) {
  let d = toDate(from);
  for (let i = 0; i < 10 && !isTradingDay(keyOf(d)); i++) d.setDate(d.getDate() + 1);
  return keyOf(d);
}
