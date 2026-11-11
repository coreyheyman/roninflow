// Pure helpers shared by the browser importers and the server's connector inbox (no browser/Node APIs here).

// ---------- contract specs ----------
export const POINT_VALUES = {
  ES: 50, MES: 5, NQ: 20, MNQ: 2, YM: 5, MYM: 0.5, RTY: 50, M2K: 5, EMD: 100,
  CL: 1000, MCL: 100, QM: 500, NG: 10000, QG: 2500, RB: 42000, HO: 42000,
  GC: 100, MGC: 10, SI: 5000, SIL: 1000, HG: 25000, MHG: 2500, PL: 50, PA: 100,
  ZB: 1000, UB: 1000, ZN: 1000, TN: 1000, ZF: 1000, ZT: 2000,
  '6E': 125000, M6E: 12500, '6J': 12500000, '6B': 62500, M6B: 6250, '6A': 100000, M6A: 10000, '6C': 100000, '6S': 125000,
  ZC: 50, ZS: 50, ZW: 50, ZL: 600, ZM: 100, LE: 400, HE: 400, GF: 500,
  BTC: 5, MBT: 0.1, ETH: 50, MET: 0.1, FDAX: 25, FDXM: 5, FDXS: 1, FESX: 10, FGBL: 1000,
};

/** "MESZ6", "MES 12-26", "MESZ2026@CME", "F.US.MESZ26" → "MES" */
export function rootSymbol(raw) {
  let s = String(raw || '').toUpperCase().trim();
  s = s.split('@')[0].split(':').pop().replace(/^F\.US\./, '').replace(/^\//, '');
  s = s.replace(/\s+\d{1,2}[-/]\d{2,4}$/, '').trim(); // "MES 12-26"
  s = s.split(/[\s.]/)[0];
  const m = s.match(/^([A-Z0-9]{1,5}?)([FGHJKMNQUVXZ])(\d{1,4})$/);
  if (m && (POINT_VALUES[m[1]] || m[1].length >= 2)) return m[1];
  return s;
}

/** Pair fills into round-trip trades per account + contract (handles scaling and reversals). */
export function fillsToTrades(fills) {
  const groups = {};
  for (const f of fills) (groups[`${f.account}|${f.contract}`] ||= []).push(f);
  const trades = [];
  const open = [];
  for (const list of Object.values(groups)) {
    list.sort((a, b) => a.time.localeCompare(b.time) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }) || a.row - b.row);
    let pos = 0, cur = null;
    const start = (f, q) => { cur = { f, dir: Math.sign(q), openQty: 0, openNot: 0, closeQty: 0, closeNot: 0, fees: 0, entry: f.time, exit: f.time, fills: 0 }; };
    for (const f of list) {
      let q = f.side * f.qty;
      const feePer = f.qty ? Math.abs(f.commission || 0) / f.qty : 0;
      // the exchange says this fill closed `closes` of an existing position — if we hold nothing, that position
      // was opened before the history we have, so that part is skipped instead of becoming a bogus new trade
      if (f.closes > 0 && pos === 0) { const skip = Math.min(f.closes, Math.abs(q)); q -= Math.sign(q) * skip; if (Math.abs(q) < 1e-9) q = 0; }
      while (q !== 0) {
        // spot (cash) markets can't go short: a sell with nothing open closes coins/shares bought before the
        // history we have, so it's skipped rather than turned into a short trade
        if (f.spot && pos <= 0 && q < 0) break;
        if (pos === 0) start(f, q);
        cur.fills++;
        if (Math.sign(q) === cur.dir) {
          const a = Math.abs(q);
          cur.openQty += a; cur.openNot += a * f.price; cur.fees += a * feePer; pos += q; q = 0;
          if (Math.abs(pos) < 1e-9) pos = 0;
        } else {
          const c = Math.min(Math.abs(q), Math.abs(pos));
          cur.closeQty += c; cur.closeNot += c * f.price; cur.fees += c * feePer; cur.exit = f.time;
          pos += Math.sign(q) * c; q -= Math.sign(q) * c;
          // fractional sizes (crypto, FX lots) leave float dust like 1e-17 — treat it as flat
          if (Math.abs(pos) < 1e-9) pos = 0;
          if (Math.abs(q) < 1e-9) q = 0;
          if (pos === 0) {
            const entryPrice = cur.openNot / cur.openQty, exitPrice = cur.closeNot / cur.closeQty;
            const mult = POINT_VALUES[cur.f.root];
            const gross = mult ? (exitPrice - entryPrice) * cur.dir * mult * cur.closeQty : NaN;
            trades.push({
              accountRaw: cur.f.account, symbol: cur.f.root, contract: cur.f.contract, direction: cur.dir > 0 ? 'Long' : 'Short',
              entry: cur.entry, exit: cur.exit, qty: cur.openQty, entryPrice: +entryPrice.toPrecision(10), exitPrice: +exitPrice.toPrecision(10),
              fees: +cur.fees.toFixed(2), gross, fills: cur.fills, needsMultiplier: !mult,
            });
            cur = null;
          }
        }
      }
    }
    if (pos !== 0 && cur) open.push({ account: cur.f.account, contract: cur.f.contract, qty: pos, since: cur.entry });
  }
  return { trades, open };
}

