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
  // takenAt: epoch ms, or a wall-clock 'YYYY-MM-DDTHH:MM:SS' already in your time zone (read from a file name)
  const wall = typeof takenAt === 'string' ? takenAt : wallClock(new Date(takenAt));
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

const P = (n) => String(n).padStart(2, '0');
/**
 * The time a screenshot was taken, from its file name when it carries one (Snipping Tool "Screenshot 2026-11-20
 * 073800", macOS "Screenshot 2026-11-20 at 7.38.00 AM", TradingView "MESZ2026_2026-11-20_07-38-00_…", ShareX
 * "chrome_2026-11-20_07-38-00", Android "Screenshot_20261120-073800"), as a wall-clock string; otherwise the file's
 * modified time (epoch ms). Names are wall-clock times on the computer that took them — the same clock as your trades.
 */
export function shotTime(name, lastModified) {
  const n = String(name || '');
  const m = n.match(/(20\d\d)[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:[\sT_-]+(?:at\s+)?(\d{1,2})[-_.:h]?([0-5]\d)(?:[-_.:m]?([0-5]\d))?(?:\s*([AaPp])\.?[Mm]\.?)?)?/);
  if (m && m[4] != null) {
    let h = Number(m[4]);
    const ap = m[7]?.toLowerCase();
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
    if (h < 24) return `${m[1]}-${m[2]}-${m[3]}T${P(h)}:${m[5]}:${m[6] || '00'}`;
  }
  return lastModified || Date.now();
}

/** The wall-clock day of a shotTime() value. */
export const shotDay = (t) => (typeof t === 'string' ? t.slice(0, 10) : wallClock(new Date(t)).slice(0, 10));

/** A trade screenshot is a picture URL, or { src, orig, annot } once you've drawn on it. */
export const shotSrc = (s) => (typeof s === 'string' ? s : s?.src || '');
