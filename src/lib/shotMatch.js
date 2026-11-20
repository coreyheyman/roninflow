// Where an automatically imported screenshot belongs, from the time it was taken: the trade that was open then (a
// minute's grace before the entry), else the trade that closed most recently within `after` minutes, else that day's
// diary. Trade times are wall-clock times in your home time zone, so the picture's time is turned into one too.
import { wallClock, toDate } from './stats';

const ROOT = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(M?[A-Z]{1,3}?)[FGHJKMNQUVXZ]\d{1,4}$/, '$1');
/** Does the instrument read off the picture ("MNQ 1m", "NQZ2026 · 5m") fit this trade's symbol? */
export function symbolFits(caption, symbol) {
  const c = String(caption || '').split(/[\s·,]/)[0];
  if (!c) return false;
  const a = ROOT(c), b = ROOT(symbol);
  if (!a || !b) return false;
  const bare = (x) => x.replace(/^M(?=[A-Z]{2})/, ''); // MNQ ≈ NQ, MES ≈ ES
  return a === b || bare(a) === bare(b) || a.startsWith(b) || b.startsWith(a);
}

/**
 * @param takenAt epoch ms
 * @param trades journal trades ({ id, symbol, entry, exit })
 * @param opts { after: minutes after a trade closes that still count for it, before: minutes before the entry }
 * @returns { kind: 'trade', trades: [candidates, best first], open: bool } | { kind: 'day' }, plus `day` and `at`
 */
export function matchShot(takenAt, trades, { after = 10, before = 1 } = {}) {
  const wall = wallClock(new Date(takenAt));
  const day = wall.slice(0, 10);
  const at = toDate(wall).getTime();
  const open = [], closed = [];
  for (const t of trades || []) {
    if (!t?.entry || !t.exit) continue;
    const e = toDate(String(t.entry)).getTime(), x = toDate(String(t.exit)).getTime();
    if (!Number.isFinite(e) || !Number.isFinite(x)) continue;
    if (at >= e - before * 60e3 && at <= x) open.push({ t, e, x });
    else if (at > x && at - x <= after * 60e3) closed.push({ t, e, x });
  }
  if (open.length) return { kind: 'trade', open: true, day, at, trades: open.sort((a, b) => b.e - a.e).map((c) => c.t) };
  if (closed.length) return { kind: 'trade', open: false, day, at, trades: closed.sort((a, b) => b.x - a.x).map((c) => c.t) };
  return { kind: 'day', day, at };
}

/**
 * The trades to attach the picture to: the best candidate — and, when the instrument could be read off the picture,
 * the most recent one on that market. Copies of the same trade on other accounts get it through the review sync.
 */
export function pickTrade(match, caption) {
  if (match.kind !== 'trade') return null;
  const list = match.trades;
  if (caption) { const fit = list.find((t) => symbolFits(caption, t.symbol)); if (fit) return fit; }
  return list[0];
}
