// Upload a batch of screenshots (a whole folder, or a selection) and file each one where it belongs — on the trade
// that was open when it was taken (or had just closed), otherwise on that day's diary. Used when moving to
// RoninFlow (alongside the trade import) and from Settings → Screenshots for any period.
import { matchShot, pickTrade, shotTime, shotDay } from './shotMatch';
import { saveImage } from './imageStore';

export const isImage = (f) => /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name || '');

/**
 * Where each picture would go, without saving anything.
 * @returns [{ file, time, day, kind: 'trade' | 'day' | 'outside', trade? }] sorted by time
 */
export function planShots(files, trades, { after = 10, from = '', to = '', daysOnly = false } = {}) {
  return [...files].filter(isImage).map((file) => {
    const time = shotTime(file.name, file.lastModified);
    const day = shotDay(time);
    if ((from && day < from) || (to && day > to)) return { file, time, day, kind: 'outside' };
    if (daysOnly) return { file, time, day, kind: 'day' }; // daily screenshots: always the day's diary
    const m = matchShot(time, trades, { after });
    return m.kind === 'trade' ? { file, time, day, kind: 'trade', trade: pickTrade(m, '') } : { file, time, day, kind: 'day' };
  }).sort((a, b) => String(a.time).localeCompare(String(b.time)) || 0);
}

/** A short count of a plan for the UI. */
export function planSummary(plan) {
  const trade = plan.filter((p) => p.kind === 'trade'), day = plan.filter((p) => p.kind === 'day');
  return {
    total: plan.length, trades: trade.length, tradeCount: new Set(trade.map((p) => p.trade.id)).size,
    days: day.length, dayCount: new Set(day.map((p) => p.day)).size, outside: plan.filter((p) => p.kind === 'outside').length,
  };
}

/**
 * Save the pictures. One update per trade and per day at the end, so hundreds of pictures don't mean hundreds of saves.
 * getState() must return the journal's current state (the trades just imported included).
 */
export async function fileShots(plan, { getState, updateTrade, saveDiary, onProgress } = {}) {
  const { fileToDataUrl } = await import('../components/ui'); // loaded here so the planning above runs anywhere (tests)
  const byTrade = new Map(), byDay = new Map();
  const todo = plan.filter((p) => p.kind !== 'outside');
  let done = 0, failed = 0;
  for (const p of todo) {
    try {
      if (p.kind === 'trade') {
        const url = await fileToDataUrl(p.file);
        (byTrade.get(p.trade.id) || byTrade.set(p.trade.id, []).get(p.trade.id)).push(url);
      } else {
        const img = await saveImage(p.file);
        const syms = [...new Set(getState().trades.filter((t) => String(t.entry).slice(0, 10) === p.day).map((t) => t.symbol))];
        (byDay.get(p.day) || byDay.set(p.day, []).get(p.day)).push({ ...img, caption: syms.length === 1 ? syms[0] : '', imported: true });
      }
    } catch { failed++; }
    done++;
    onProgress?.(done, todo.length);
  }
  const st = getState();
  for (const [id, urls] of byTrade) {
    const t = st.trades.find((x) => x.id === id);
    if (t) updateTrade(id, { screenshots: [...(t.screenshots || []), ...urls] });
  }
  for (const [day, imgs] of byDay) {
    const cur = getState().diary?.[day]?.images || [];
    const have = new Set(cur.map((x) => `${x.name}|${x.size}`));
    saveDiary(day, { images: [...cur, ...imgs.filter((x) => !have.has(`${x.name}|${x.size}`))] });
  }
  return { trades: byTrade.size, tradeShots: [...byTrade.values()].reduce((a, l) => a + l.length, 0), days: byDay.size, dayShots: [...byDay.values()].reduce((a, l) => a + l.length, 0), failed };
}
