// Pure helpers for the Macro pages (no React, so tests and the server-side code can use them).

// ---------- economic calendar ----------
export const IMPACTS = [
  { id: 'high', label: 'High', color: 'var(--neg)' },
  { id: 'medium', label: 'Medium', color: '#f59e0b' },
  { id: 'low', label: 'Low', color: '#eab308' },
  { id: 'holiday', label: 'Holiday', color: 'var(--muted-2)' },
  { id: 'none', label: 'Other', color: 'var(--muted-2)' },
];
export const impactOf = (id) => IMPACTS.find((i) => i.id === id) || IMPACTS[4];
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY'];
export const FLAGS = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', AUD: '🇦🇺', CAD: '🇨🇦', CHF: '🇨🇭', NZD: '🇳🇿', CNY: '🇨🇳', ALL: '🌐' };

/** "195K" → 195000, "-0.3%" → -0.3, "1.2T" → 1.2e12, "<0.1%" → 0.1; null if it isn't a number. */
export function parseValue(v) {
  if (v == null) return null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  const unit = String(v).replace(/,/g, '').slice(m.index + m[0].length).trim().charAt(0).toUpperCase();
  return n * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[unit] || 1);
}
// For these, a lower number than expected is the good surprise for the currency.
const LOWER_IS_BETTER = /unemploy|jobless|claims|claimant|layoff|job cuts|challenger|bankrupt|deficit/i;
/** 'beat' | 'miss' | 'inline' | null — the actual against the forecast (or the previous print when there's no forecast). */
export function surprise(e) {
  const a = parseValue(e.actual);
  const f = parseValue(e.forecast ?? e.previous);
  if (a == null || f == null) return null;
  if (a === f) return 'inline';
  const higher = a > f;
  return (LOWER_IS_BETTER.test(e.title) ? !higher : higher) ? 'beat' : 'miss';
}

/** "in 3h 12m" / "in 2d 4h" / "now" until an instant. */
export function countdown(ms) {
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

// ---------- COT ----------
// rows: [date, openInterest, specLong, specShort, commLong, commShort, smallLong, smallShort]
export const LOOKBACKS = [{ value: 26, label: '6M' }, { value: 52, label: '1Y' }, { value: 156, label: '3Y' }];
export const COT_GROUPS = ['Indices', 'Rates', 'FX', 'Metals', 'Energy', 'Crypto', 'Grains', 'Yours'];
const net = (r, i) => r[i] - r[i + 1];
/** Where `v` sits between the lowest and highest of `arr` (0–100). */
const rank = (arr, v) => { const lo = Math.min(...arr), hi = Math.max(...arr); return hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100; };

/** Everything the COT table and detail view show for one market, over the last `weeks` reports. */
export function cotStats(rows, weeks = 156) {
  if (!rows?.length) return null;
  const win = rows.slice(-weeks);
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2] || last;
  const spec = net(last, 2), comm = net(last, 4), small = net(last, 6);
  const specs = win.map((r) => net(r, 2));
  const comms = win.map((r) => net(r, 4));
  const longs = last[2], shorts = last[3];
  const index = rank(specs, spec);
  return {
    date: last[0],
    oi: last[1], oiChg: last[1] - prev[1],
    spec, specChg: spec - net(prev, 2), specLong: longs, specShort: shorts,
    specLongChg: longs - prev[2], specShortChg: shorts - prev[3],
    pctLong: longs + shorts ? (longs / (longs + shorts)) * 100 : 50,
    comm, commChg: comm - net(prev, 4), small, smallChg: small - net(prev, 6),
    specPctOi: last[1] ? (spec / last[1]) * 100 : 0,
    index, commIndex: rank(comms, comm),
    crowd: index >= 90 ? 'long' : index <= 10 ? 'short' : null,
    // a fresh extreme: positioning hasn’t been this one-sided at any point in the window
    extreme: spec >= Math.max(...specs) ? 'high' : spec <= Math.min(...specs) ? 'low' : null,
    trend: specs,
  };
}

/** A few words on what large speculators did last week. */
export function cotRead(s) {
  if (!s) return '';
  const { specLongChg: l, specShortChg: sh } = s;
  const big = (x) => Math.abs(x) >= Math.max(500, (s.specLong + s.specShort) * 0.02);
  if (big(l) && big(sh)) return l > 0 && sh > 0 ? 'Both sides added' : l < 0 && sh < 0 ? 'Both sides cut' : l > 0 ? 'Longs added, shorts covered' : 'Longs cut, shorts added';
  if (big(l)) return l > 0 ? 'Longs added' : 'Longs cut';
  if (big(sh)) return sh > 0 ? 'Shorts added' : 'Shorts covered';
  return 'Little change';
}

export const fmtContracts = (n, sign = false) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(1)}K` : Math.round(a).toLocaleString('en-US');
  return `${n < 0 ? '−' : sign && n > 0 ? '+' : ''}${s}`;
};
