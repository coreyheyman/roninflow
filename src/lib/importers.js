// Trade-file importers: ATAS (Executions + Journal), Tradovate performance, generic CSV/XLSX.
import { parseCsv, pad, wallClock } from './stats';
import { readXlsx } from './xlsx';

// contract specs, symbol roots and fill pairing live in pairing.js (also used by the server's connector inbox)
import { POINT_VALUES, rootSymbol, fillsToTrades } from './pairing';
export { POINT_VALUES, rootSymbol, fillsToTrades };

// ---------- parsing helpers ----------
export function toNumber(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return NaN;
  let s = String(v).trim();
  if (!s) return NaN;
  const neg = (s.includes('(') && s.includes(')')) || /^-|^\$-|^-\$/.test(s) || /-$/.test(s);
  s = s.replace(/[^0-9.,]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = parseFloat(s);
  return neg ? -Math.abs(n) : n;
}

/** Parse many date formats into local "YYYY-MM-DDTHH:mm:ss". order: 'auto' | 'MDY' | 'DMY' */
export function toIso(v, order = 'auto') {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    }
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,]\d+)?\s*(AM|PM)?/i);
  let y, mo, d, h, mi, se, ap;
  if (m) [, y, mo, d, h, mi, se, ap] = m;
  else {
    m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,]\d+)?\s*(AM|PM)?)?/i);
    if (!m) {
      const t = new Date(s);
      if (Number.isNaN(t.getTime())) return null;
      return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
    }
    let a = Number(m[1]), b = Number(m[2]);
    const sep = s.match(/^\d{1,2}([./-])/)[1];
    let dmy = order === 'DMY' || (order === 'auto' && (a > 12 || (sep === '.' && b <= 12)));
    if (order === 'MDY') dmy = false;
    if (order === 'auto' && b > 12) dmy = false;
    [d, mo] = dmy ? [a, b] : [b, a];
    y = Number(m[3]); if (y < 100) y += 2000;
    [h, mi, se, ap] = [m[4] || 0, m[5] || 0, m[6] || 0, m[7]];
  }
  h = Number(h || 0);
  if (ap) { ap = ap.toUpperCase(); if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0; }
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi || 0)}:${pad(se || 0)}`;
}

export function shiftIso(iso, hours) {
  if (!hours || !iso) return iso;
  const d = new Date(iso);
  d.setTime(d.getTime() + hours * 3600000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ---------- field definitions ----------
const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const MODES = {
  fills: {
    label: 'Executions / fills (ATAS Executions tab)',
    fields: [
      { id: 'account', label: 'Account', names: ['account', 'accountname', 'portfolio', 'счет', 'konto'] },
      { id: 'instrument', label: 'Instrument', req: true, names: ['instrument', 'symbol', 'security', 'contract', 'ticker', 'инструмент'] },
      { id: 'time', label: 'Time', req: true, names: ['time', 'datetime', 'date', 'executiontime', 'filltime', 'timestamp', 'filledtime', 'closingtime', 'updatetime', 'время'] },
      { id: 'side', label: 'Direction (Buy/Sell)', req: true, names: ['direction', 'side', 'buysell', 'action', 'bs', 'type', 'направление'] },
      { id: 'price', label: 'Price', req: true, names: ['price', 'fillprice', 'avgprice', 'execprice', 'avgfillprice', 'averagefillprice', 'filledprice', 'цена'] },
      { id: 'qty', label: 'Volume', req: true, names: ['volume', 'qty', 'quantity', 'size', 'filled', 'contracts', 'qtyfilled', 'filledqty', 'filledquantity', 'fillqty', 'объем'] },
      { id: 'commission', label: 'Commission', names: ['commission', 'commissions', 'fee', 'fees', 'комиссия'] },
      { id: 'id', label: 'Exchange ID', names: ['exchangeid', 'id', 'fillid', 'execid', 'executionid', 'tradeid'] },
      { id: 'status', label: 'Order status (only filled rows are used)', names: ['status', 'orderstatus', 'state'] },
    ],
  },
  trades: {
    label: 'Closed trades (ATAS Journal, Tradovate, other)',
    fields: [
      { id: 'account', label: 'Account', names: ['account', 'accountname', 'portfolio'] },
      { id: 'instrument', label: 'Instrument', req: true, names: ['instrument', 'symbol', 'security', 'contract', 'ticker', 'contractname'] },
      { id: 'direction', label: 'Direction', names: ['direction', 'side', 'type', 'position', 'marketpos', 'longshort'] },
      { id: 'entryTime', label: 'Open time', names: ['opentime', 'entrytime', 'opendate', 'entrydate', 'entrydt', 'open', 'entry', 'timeopen', 'entered'] },
      { id: 'exitTime', label: 'Close time', names: ['closetime', 'exittime', 'closedate', 'exitdate', 'exitdt', 'close', 'exit', 'timeclose', 'exited'] },
      { id: 'entryPrice', label: 'Open price', names: ['openprice', 'entryprice', 'avgentry', 'avgopenprice', 'priceopen'] },
      { id: 'exitPrice', label: 'Close price', names: ['closeprice', 'exitprice', 'avgexit', 'avgcloseprice', 'priceclose'] },
      { id: 'qty', label: 'Volume', names: ['openvolume', 'volume', 'qty', 'quantity', 'size', 'contracts', 'maxvolume'] },
      { id: 'pnl', label: 'P&L', names: ['pnl', 'netpnl', 'profit', 'profitloss', 'realizedpnl', 'netprofit', 'pl', 'result', 'totalpnl'] },
      { id: 'commission', label: 'Commission', names: ['commission', 'commissions', 'fee', 'fees'] },
      { id: 'buyTime', label: 'Bought time (Tradovate)', names: ['boughttimestamp', 'buytime'] },
      { id: 'sellTime', label: 'Sold time (Tradovate)', names: ['soldtimestamp', 'selltime'] },
      { id: 'buyPrice', label: 'Buy price (Tradovate)', names: ['buyprice'] },
      { id: 'sellPrice', label: 'Sell price (Tradovate)', names: ['sellprice'] },
    ],
  },
};

function autoMap(header, mode) {
  const h = header.map(norm);
  const map = {};
  const used = new Set();
  for (const f of MODES[mode].fields) {
    let idx = -1;
    for (const n of f.names) { idx = h.findIndex((x, i) => !used.has(i) && x === n); if (idx >= 0) break; }
    if (idx < 0) for (const n of f.names) { if (n.length < 5) continue; idx = h.findIndex((x, i) => !used.has(i) && x.includes(n)); if (idx >= 0) break; }
    if (idx >= 0) { map[f.id] = idx; used.add(idx); }
  }
  return map;
}
const score = (map, mode) => MODES[mode].fields.reduce((s, f) => s + (map[f.id] !== undefined ? (f.req ? 3 : 1) : 0), 0);

/** Find the best sheet / header row / mode for a parsed workbook. */
export function detect(tables) {
  let best = null;
  tables.forEach((t, ti) => {
    for (let r = 0; r < Math.min(t.rows.length, 15); r++) {
      const header = t.rows[r] || [];
      if (header.filter((c) => String(c).trim()).length < 3) continue;
      for (const mode of ['fills', 'trades']) {
        const map = autoMap(header, mode);
        const ok = mode === 'fills'
          ? ['instrument', 'time', 'side', 'price', 'qty'].every((k) => map[k] !== undefined)
          : map.instrument !== undefined && (map.pnl !== undefined || map.entryPrice !== undefined || map.buyPrice !== undefined) && (map.entryTime !== undefined || map.exitTime !== undefined || map.buyTime !== undefined);
        const tradovate = mode === 'trades' && map.buyTime !== undefined && map.sellTime !== undefined ? 50 : 0;
        const sc = score(map, mode) + (ok ? 100 : 0) + (mode === 'fills' && ok ? 5 : 0) + tradovate + (t.rows.length - r > 1 ? 1 : 0);
        if (!best || sc > best.score) best = { table: ti, headerRow: r, mode, map, score: sc, ok };
      }
    }
  });
  return best;
}

export async function readFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    const { sheets } = await readXlsx(await file.arrayBuffer());
    return sheets.filter((s) => s.rows.length);
  }
  if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported. In Excel use File → Save As → .xlsx or .csv.');
  let text = await file.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const first = text.split(/\r?\n/)[0] || '';
  const delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = parseCsv(text, delim);
  return [{ name: file.name, rows }];
}

// ---------- conversion ----------
const sideOf = (v, qty) => {
  const s = String(v ?? '').toLowerCase().trim();
  if (/^(buy|b|long|bot|bought|купля|покупка|kauf)/.test(s)) return 1;
  if (/^(sell|s|short|sld|sold|продажа|verkauf)/.test(s)) return -1;
  return qty < 0 ? -1 : qty > 0 ? 1 : 0;
};

/**
 * Convert a table with a column mapping into normalized trades.
 * opts: { mode, map, headerRow, dateOrder, shiftHours, multipliers, pnlIncludesFees }
 */
export function convert(rows, opts) {
  const { mode, map, headerRow, dateOrder = 'auto', tz = 'local', multipliers = {}, pnlIncludesFees = false } = opts;
  const get = (r, k) => (map[k] === undefined || map[k] === '' ? undefined : r[map[k]]);
  const body = rows.slice(headerRow + 1).filter((r) => r && r.some((c) => String(c).trim() !== ''));
  const errors = [];
  const multOf = (root) => multipliers[root] ?? POINT_VALUES[root];
  let trades = [], open = [];

  if (mode === 'fills') {
    const fills = [];
    body.forEach((r, i) => {
      const st = get(r, 'status');
      if (st !== undefined && String(st).trim() && !/fill|exec|complet|done/i.test(String(st))) return; // cancelled / working orders
      const time = toLocal(toIso(get(r, 'time'), dateOrder), tz);
      const contract = String(get(r, 'instrument') ?? '').trim();
      const rawQty = toNumber(get(r, 'qty'));
      const price = toNumber(get(r, 'price'));
      const side = sideOf(get(r, 'side'), rawQty);
      if (!time || !contract || !price || !rawQty || !side) { errors.push(i + headerRow + 2); return; }
      fills.push({ row: i, account: String(get(r, 'account') ?? '').trim() || 'Imported', contract, root: rootSymbol(contract), time, side, qty: Math.abs(rawQty), price, commission: toNumber(get(r, 'commission')) || 0, id: get(r, 'id') ?? '' });
    });
    const res = fillsToTrades(fills);
    open = res.open;
    trades = res.trades.map((t) => {
      const m = multOf(t.symbol);
      const gross = m ? (t.exitPrice - t.entryPrice) * (t.direction === 'Long' ? 1 : -1) * m * t.qty : NaN;
      return { ...t, needsMultiplier: !m, pnl: Number.isNaN(gross) ? NaN : Math.round((gross - t.fees) * 100) / 100 };
    });
  } else {
    body.forEach((r, i) => {
      const contract = String(get(r, 'instrument') ?? '').trim();
      if (!contract) { errors.push(i + headerRow + 2); return; }
      const root = rootSymbol(contract);
      let entry = toIso(get(r, 'entryTime'), dateOrder);
      let exit = toIso(get(r, 'exitTime'), dateOrder);
      let entryPrice = toNumber(get(r, 'entryPrice'));
      let exitPrice = toNumber(get(r, 'exitPrice'));
      let qty = toNumber(get(r, 'qty'));
      let dir = sideOf(get(r, 'direction'), qty);
      const bt = toIso(get(r, 'buyTime'), dateOrder), stt = toIso(get(r, 'sellTime'), dateOrder);
      if ((!entry || Number.isNaN(entryPrice)) && bt && stt) {
        dir = bt <= stt ? 1 : -1;
        entry = dir > 0 ? bt : stt; exit = dir > 0 ? stt : bt;
        const bp = toNumber(get(r, 'buyPrice')), sp = toNumber(get(r, 'sellPrice'));
        entryPrice = dir > 0 ? bp : sp; exitPrice = dir > 0 ? sp : bp;
      }
      entry = entry || exit; exit = exit || entry;
      if (!entry) { errors.push(i + headerRow + 2); return; }
      qty = Math.abs(qty) || 1;
      if (!dir) dir = !Number.isNaN(entryPrice) && !Number.isNaN(exitPrice) && toNumber(get(r, 'pnl')) !== 0 ? Math.sign((exitPrice - entryPrice) * toNumber(get(r, 'pnl'))) || 1 : 1;
      const fees = Math.abs(toNumber(get(r, 'commission')) || 0);
      const rawPnl = toNumber(get(r, 'pnl'));
      const m = multOf(root);
      let pnl;
      if (!Number.isNaN(rawPnl)) pnl = pnlIncludesFees ? rawPnl : rawPnl - fees;
      else if (m && !Number.isNaN(entryPrice) && !Number.isNaN(exitPrice)) pnl = (exitPrice - entryPrice) * dir * m * qty - fees;
      else pnl = NaN;
      trades.push({
        accountRaw: String(get(r, 'account') ?? '').trim() || 'Imported', symbol: root, contract, direction: dir > 0 ? 'Long' : 'Short',
        entry: toLocal(entry, tz), exit: toLocal(exit, tz), qty, entryPrice: Number.isNaN(entryPrice) ? 0 : entryPrice, exitPrice: Number.isNaN(exitPrice) ? 0 : exitPrice,
        fees, pnl: Number.isNaN(pnl) ? NaN : Math.round(pnl * 100) / 100, needsMultiplier: Number.isNaN(pnl) && !m,
      });
    });
  }
  trades.sort((a, b) => a.entry.localeCompare(b.entry));
  return { trades, open, errors, rowCount: body.length };
}

/** Identity of a trade for de-duplication: to the second, with prices and P&L to the cent. */
export const fingerprint = (t) => [t.accountId, t.symbol, t.entry.slice(0, 19), t.exit.slice(0, 19), t.direction, Number(t.qty), Number(t.entryPrice || 0).toFixed(2), Number(t.exitPrice || 0).toFixed(2), Number(t.pnl).toFixed(2)].join('|');

/** "APEX-50K-123456" → 50000 */
export function guessInitial(name) {
  const m = String(name).toUpperCase().match(/(\d{2,3})K/);
  return m ? Number(m[1]) * 1000 : 50000;
}

// ---------- time zones ----------
/** The computer's standard-time (non-DST) UTC offset in hours, e.g. -8 for Pacific. */
export function standardOffset() {
  const y = new Date().getFullYear();
  return -Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset()) / 60;
}
/** Convert a naive timestamp written at fixed UTC offset `tz` (hours) to this computer's local clock (DST-aware). */
export function toLocal(iso, tz) {
  if (!iso || tz === 'local' || tz === undefined || tz === null || tz === '') return iso;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return iso;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - Number(tz) * 3600000;
  return wallClock(new Date(ms)); // into your time zone (Settings → Language & region)
}

// ---------- ATAS statistics workbook (Statistics + Journal + Executions) ----------
const findSheet = (tables, name) => tables.findIndex((t) => String(t.name).trim().toLowerCase() === name);

export function detectAtasWorkbook(tables) {
  const j = findSheet(tables, 'journal');
  if (j < 0) return null;
  const h = (tables[j].rows[0] || []).map(norm);
  if (!['account', 'instrument', 'opentime', 'closetime', 'pnl'].every((k) => h.includes(k))) return null;
  return { journal: j, executions: findSheet(tables, 'executions') };
}

/**
 * Trades come from the Journal sheet (ATAS's own round trips and gross PnL, which match its Statistics tab).
 * Commissions come from the Executions sheet: each fill's commission is split across the journal rows
 * that opened or closed at that exact second on that side.
 */
export function convertAtas(tables, { tz = 'local', multipliers = {} } = {}) {
  const info = detectAtasWorkbook(tables);
  const J = tables[info.journal].rows;
  const jh = J[0].map(norm);
  const c = (n) => jh.indexOf(n);
  const ix = { acc: c('account'), ins: c('instrument'), ot: c('opentime'), op: c('openprice'), ov: c('openvolume'), ct: c('closetime'), cp: c('closeprice'), cv: c('closevolume'), pnl: c('pnl'), pp: c('pricepnl'), cm: c('comment') };
  const rows = [];
  let orphans = 0;
  const errors = [];
  J.slice(1).forEach((r, i) => {
    if (!r || !r.some((x) => String(x).trim() !== '')) return;
    const account = String(r[ix.acc] ?? '').trim();
    const contract = String(r[ix.ins] ?? '').trim();
    const entry = toIso(r[ix.ot]);
    const exit = toIso(r[ix.ct]);
    const ov = toNumber(r[ix.ov]);
    if (!account || !contract || !entry || !ov) { errors.push(i + 2); return; }
    if (!exit) { orphans++; return; } // position ATAS never saw close – not a trade
    rows.push({
      account, contract, root: rootSymbol(contract), dir: Math.sign(ov), qty: Math.abs(ov), entry, exit,
      entryPrice: toNumber(r[ix.op]), exitPrice: toNumber(r[ix.cp]), gross: toNumber(r[ix.pnl]), pricePnl: toNumber(r[ix.pp]), comment: ix.cm >= 0 ? String(r[ix.cm] ?? '').trim() : '', fees: 0,
    });
  });

  // allocate commissions
  let feeTotal = 0, feeMatched = 0;
  if (info.executions >= 0) {
    const E = tables[info.executions].rows;
    const eh = E[0].map(norm);
    const e = (n) => eh.indexOf(n);
    const ex = { acc: e('account'), ins: e('instrument'), t: e('time'), d: e('direction'), v: e('volume'), cm: e('commission') };
    const byKey = new Map();
    const key = (acc, con, t, side) => `${acc}|${con.split('@')[0]}|${t.slice(0, 19)}|${side}`;
    for (const r of rows) {
      for (const [t, side] of [[r.entry, r.dir], [r.exit, -r.dir]]) {
        const k = key(r.account, r.contract, t, side);
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(r);
      }
    }
    for (const f of E.slice(1)) {
      if (!f || ex.cm < 0) continue;
      const comm = Math.abs(toNumber(f[ex.cm]) || 0);
      if (!comm) continue;
      feeTotal += comm;
      const side = /^b/i.test(String(f[ex.d])) ? 1 : -1;
      const t = toIso(f[ex.t]);
      const list = t && byKey.get(key(String(f[ex.acc]).trim(), String(f[ex.ins]).trim(), t, side));
      if (!list) continue;
      const vol = list.reduce((s, r) => s + r.qty, 0);
      for (const r of list) r.fees += (comm * r.qty) / vol;
      feeMatched += comm;
    }
  }

  const trades = rows.map((r) => {
    let gross = r.gross;
    const m = multipliers[r.root] ?? POINT_VALUES[r.root];
    if (Number.isNaN(gross) && m && !Number.isNaN(r.pricePnl)) gross = r.pricePnl * m * r.qty;
    const fees = Math.round(r.fees * 100) / 100;
    return {
      accountRaw: r.account, symbol: r.root, contract: r.contract, direction: r.dir > 0 ? 'Long' : 'Short',
      entry: toLocal(r.entry, tz), exit: toLocal(r.exit, tz), qty: r.qty, entryPrice: r.entryPrice, exitPrice: r.exitPrice,
      fees, gross, pnl: Number.isNaN(gross) ? NaN : Math.round((gross - fees) * 100) / 100, needsMultiplier: Number.isNaN(gross) && !m, notes: r.comment,
    };
  });
  trades.sort((a, b) => a.entry.localeCompare(b.entry));
  return { trades, open: [], errors, rowCount: J.length - 1, orphans, feeTotal, feeMatched };
}
