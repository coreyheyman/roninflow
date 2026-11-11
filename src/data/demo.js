// Made-up sample trades for trying the journal out (Setup → "Load demo data"). Nothing here is real.
import { keyOf, pad } from '../lib/stats';

export const DEMO_ACCOUNT = {
  id: 'DEMO-50K', name: 'DEMO-50K', phase: 'Challenge', market: 'Futures', plan: 'Demo', status: 'Active',
  initial: 50000, profitTarget: 3000, maxDrawdown: 2000, dailyLossLimit: 1000, ddType: 'eod', broker: 'Demo', demo: true, createdAt: null,
};

// small deterministic random generator so the demo looks the same every time
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const SPECS = { MES: { pv: 5, tick: 0.25, base: 6000, fee: 0.74 }, MNQ: { pv: 2, tick: 0.25, base: 21000, fee: 0.74 } };

/** ~45 trading days of plausible MES / MNQ day trades ending yesterday. */
export function demoTrades(days = 45) {
  const r = rng(42);
  const out = [];
  const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - 1);
  let n = 0, price = { MES: SPECS.MES.base, MNQ: SPECS.MNQ.base };
  for (let made = 0; made < days; d.setDate(d.getDate() - 1)) {
    if ([0, 6].includes(d.getDay())) continue;
    made++;
    const date = keyOf(d);
    const count = 1 + Math.floor(r() * 5);
    let minute = 6 * 60 + 35 + Math.floor(r() * 20);
    for (let i = 0; i < count; i++) {
      const sym = r() < 0.6 ? 'MES' : 'MNQ';
      const sp = SPECS[sym];
      price[sym] += (r() - 0.5) * sp.base * 0.004;
      const qty = r() < 0.7 ? 1 : 2;
      const dir = r() < 0.55 ? 'Long' : 'Short';
      const win = r() < 0.52;
      const ticks = win ? 6 + Math.floor(r() * 24) : -(4 + Math.floor(r() * 14));
      const entryPrice = Math.round(price[sym] / sp.tick) * sp.tick;
      const exitPrice = entryPrice + (dir === 'Long' ? 1 : -1) * ticks * sp.tick;
      const hold = 30 + Math.floor(r() * 900);
      const em = minute, es = Math.floor(r() * 60);
      const exitTotal = em * 60 + es + hold;
      const fees = +(sp.fee * qty).toFixed(2);
      const pnl = +(((exitPrice - entryPrice) * (dir === 'Long' ? 1 : -1) * sp.pv * qty) - fees).toFixed(2);
      out.push({
        id: `demo${String(++n).padStart(4, '0')}`, accountId: DEMO_ACCOUNT.id, symbol: sym, direction: dir,
        entry: `${date}T${pad(Math.floor(em / 60))}:${pad(em % 60)}:${pad(es)}`,
        exit: `${date}T${pad(Math.floor(exitTotal / 3600))}:${pad(Math.floor((exitTotal % 3600) / 60))}:${pad(exitTotal % 60)}`,
        qty, entryPrice, exitPrice, fees, pnl, tags: [], strategyId: null, notes: '', rating: 0, reviewed: r() < 0.6, screenshots: [], demo: true,
      });
      minute += 8 + Math.floor(r() * 35);
    }
  }
  return out.sort((a, b) => b.entry.localeCompare(a.entry));
}
