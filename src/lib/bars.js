// Candle timeframes for the execution chart: turning 1-minute candles into 5m … 1d bars.

// Lightweight Charts shows times as UTC, so shift everything by your UTC offset to read in local time.
export const toLocal = (t) => t - new Date(t * 1000).getTimezoneOffset() * 60;
/** "1m" / "60m" / "4h" / "1d" → seconds */
export const ivSec = (s) => { const m = /^(\d+)([mhd])$/.exec(String(s || '1m')); return m ? Number(m[1]) * { m: 60, h: 3600, d: 86400 }[m[2]] : 60; };
export const TIMEFRAMES = ['1m', '2m', '3m', '5m', '10m', '15m', '30m', '1h', '4h', '1d'];
// how many calendar days back are loaded so the bigger timeframes have more than a few candles
export const SPAN_DAYS = { '1h': 2, '4h': 7, '1d': 35 };
export const tfLabel = (s) => String(s || '1m').replace(/^60m$/, '1h').replace(/^240m$/, '4h');

// Bars count from the futures session open (6 PM New York, as on TradingView), so a 4h bar is 6–10 PM, 10 PM–2 AM …
const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const nyParts = (u) => Object.fromEntries(nyFmt.formatToParts(new Date(u * 1000)).map((x) => [x.type, x.value]));
const sinceOpen = (u) => { const p = nyParts(u); return ((Number(p.hour) - 18 + 24) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second); };
/** UTC seconds → the chart time of the bar that holds it (daily bars are labelled with the session's trading date) */
export function barTime(u, iv) {
  if (iv <= 60) return toLocal(u - (u % 60));
  if (iv >= 86400) { const p = nyParts(u - sinceOpen(u) + 7 * 3600); return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 1000; }
  return toLocal(u - (sinceOpen(u) % iv));
}
/** [t, o, h, l, c, v] candles (UTC) → bars of `iv` seconds for the chart */
export function aggregate(rows, iv) {
  const out = [];
  for (const [t, o, h, l, c, v] of rows) {
    const time = barTime(t, iv);
    const last = out[out.length - 1];
    if (last && last.time === time) { last.high = Math.max(last.high, h); last.low = Math.min(last.low, l); last.close = c; last.volume += v || 0; }
    else out.push({ time, open: o, high: h, low: l, close: c, volume: v || 0 });
  }
  return out;
}
