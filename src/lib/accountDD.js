// Prop-firm style max drawdown for one account, by drawdown type:
//   static     — the floor never moves: starting balance − max drawdown.
//   eod        — the floor trails your highest END-OF-DAY balance by the max drawdown.
//   intraday   — the floor trails your highest balance at any moment, open P&L included.
// Trailing floors usually stop once they reach the starting balance (a.ddLock !== false).
// Intraday peaks: the highest balance ever seen live from ATAS (balance + open P&L) and the highest closed
// balance after any trade — unrealized highs from before live balances existed can't be known.
import { accountBalanceInfo } from './balance';
import { equityCurve, groupByDay, todayKey } from './stats';

export const DD_TYPES = [
  { id: 'static', label: 'Static', note: 'Floor stays at starting balance − max drawdown.' },
  { id: 'eod', label: 'EOD trailing', note: 'Floor trails your highest end-of-day balance.' },
  { id: 'intraday', label: 'Intraday trailing', note: 'Floor trails your highest balance at any moment, open P&L included.' },
];
export const ddTypeOf = (a) => (DD_TYPES.some((t) => t.id === a?.ddType) ? a.ddType : 'eod');
export const ddTypeLabel = (a) => DD_TYPES.find((t) => t.id === ddTypeOf(a)).label;

export function accountDrawdown(state, a) {
  const type = ddTypeOf(a);
  const initial = Number(a.initial) || 0;
  const maxDD = Number(a.maxDrawdown) || 0;
  const lock = a.ddLock !== false;
  const trades = state.trades.filter((t) => t.accountId === a.id);
  const info = accountBalanceInfo(state, a.id);
  const gap = info?.gap || 0;
  const curve = equityCurve(trades);
  const closedNet = (curve.length ? curve[curve.length - 1].y : 0) + gap;
  const b = state.settings.sync?.balances?.[a.id];
  const fresh = b?.at && Date.now() - new Date(b.at).getTime() < 3 * 60000;
  const openPnl = fresh ? Number(b.openPnl) || 0 : 0;
  const balance = initial + closedNet + openPnl; // live equity (open P&L while ATAS is connected)

  let peakNet = 0; // highest net (vs start) that moves the floor
  if (type === 'eod') {
    const today = todayKey();
    let run = gap;
    for (const d of [...groupByDay(trades)].reverse()) { // oldest first
      run += d.net;
      if (d.date < today) peakNet = Math.max(peakNet, run); // today's balance only counts once the day closes
    }
  } else if (type === 'intraday') {
    for (const p of curve) peakNet = Math.max(peakNet, p.y + gap);
    peakNet = Math.max(peakNet, closedNet + openPnl, (Number(b?.peakEquity) || 0) - initial);
  }
  let floor = initial - maxDD + (type === 'static' ? 0 : peakNet);
  const locked = type !== 'static' && lock && floor >= initial;
  if (locked) floor = initial;
  const left = balance - floor;
  const used = maxDD ? Math.min(maxDD, Math.max(0, maxDD - left)) : 0;
  return { type, maxDD, floor, balance, left, used, pct: maxDD ? (used / maxDD) * 100 : 0, peak: initial + peakNet, locked, openPnl, live: !!fresh, breached: maxDD > 0 && left <= 0 };
}

/**
 * The max-loss floor for each trading day, as P&L relative to the starting balance (e.g. −2000), so it can be
 * drawn on the account's cumulative P&L chart. `days` is oldest first: [{ net, trades }].
 * The value for a day is the floor you had to stay above during that day:
 *   static   — always −maxDD.
 *   eod      — −maxDD + the highest end-of-day P&L before that day (it moves up after a day closes).
 *   intraday — −maxDD + the highest P&L reached after any trade so far, that day included (closed trades:
 *              open-P&L highs from the past aren't known).
 * Trailing floors stop at 0 (the starting balance) unless the account's "stops trailing" box is unticked.
 * Returns null when the account has no max drawdown set.
 */
export function floorSeries(a, days) {
  const type = ddTypeOf(a);
  const maxDD = Number(a?.maxDrawdown) || 0;
  if (!maxDD) return null;
  const lock = a.ddLock !== false;
  let run = 0, eodPeak = 0, livePeak = 0;
  const out = [];
  for (const d of days) {
    let floor = -maxDD;
    if (type === 'eod') floor += eodPeak;
    else if (type === 'intraday') {
      let r = run;
      const byExit = [...(d.trades || [])].sort((x, y) => String(x.exit || x.entry).localeCompare(String(y.exit || y.entry)));
      for (const t of byExit) { r += t.pnl; livePeak = Math.max(livePeak, r); }
      floor += livePeak;
    }
    if (type !== 'static' && lock) floor = Math.min(floor, 0);
    out.push(Math.round(floor * 100) / 100);
    run += d.net;
    eodPeak = Math.max(eodPeak, run);
  }
  return out;
}
