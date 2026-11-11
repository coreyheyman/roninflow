// Applies trades streamed from the ATAS "Journal Sync" add-on to the journal state.
import { rootSymbol, toLocal, guessInitial } from './importers';
import { uid, pad, wallClock } from './stats';

const localIso = (d) => wallClock(d); // instant → wall-clock time in your time zone
const RX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/** C# DateTime.ToString("o") → local "YYYY-MM-DDTHH:mm:ss". Naive values use `tz` (hours offset, or 'local'). */
export function atasTime(raw, tz) {
  const m = String(raw || '').match(RX);
  if (!m) return null;
  if (m[2] === 'Z') return localIso(new Date(raw)); // explicit UTC
  // ATAS stamps live fills as DateTimeKind.Local with the PC's offset appended, but the clock value is still
  // ATAS's internal (UTC) time — so a numeric offset can't be trusted. Treat it like a naive time.
  return tz === 'local' ? m[1] : toLocal(m[1], Number(tz) || 0);
}
const isNaive = (raw) => { const m = String(raw || '').match(RX); return !!m && m[2] !== 'Z'; };

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const p2 = (n) => Number(n || 0).toFixed(2);

export function mapAtasTrade(t, tz) {
  const ov = Number(t.openVolume);
  const fees = Math.abs(Number(t.commission) || 0);
  const gross = Number(t.pnl);
  return {
    atasId: String(t.id),
    accountId: String(t.account || 'ATAS').trim(),
    symbol: rootSymbol(t.security),
    direction: ov >= 0 ? 'Long' : 'Short',
    qty: Math.abs(ov) || Math.abs(Number(t.closeVolume)) || 1,
    entry: atasTime(t.openTime, tz),
    exit: atasTime(t.closeTime, tz),
    entryPrice: Number(t.openPrice) || 0,
    exitPrice: Number(t.closePrice) || 0,
    fees: r2(fees),
    pnl: Number.isFinite(gross) ? r2(gross - fees) : NaN,
    gross,
    hasCommission: t.commission !== null && t.commission !== undefined && Number(t.commission) !== 0,
    comment: t.comment || '',
  };
}

const shapeKey = (t) => [t.accountId, t.symbol, t.direction, Number(t.qty), p2(t.entryPrice), p2(t.exitPrice)].join('|');

/**
 * Work out which fixed UTC offset ATAS used for naive timestamps by lining incoming trades up with
 * trades already in the journal (e.g. from an earlier file import). Returns hours or null.
 */
export function calibrateOffset(dtos, trades) {
  const byShape = new Map();
  for (const t of trades) {
    if (!t.entry) continue;
    const k = shapeKey(t);
    if (!byShape.has(k)) byShape.set(k, []);
    byShape.get(k).push(t.entry);
  }
  const votes = new Map();
  for (const d of dtos) {
    if (!isNaive(d.openTime)) continue;
    const m = mapAtasTrade(d, 0);
    const cands = byShape.get(shapeKey(m));
    if (!cands) continue;
    const naive = String(d.openTime).match(RX)[1];
    const [y, mo, dd, h, mi, s] = naive.split(/[-T:]/).map(Number);
    const utcOfNaive = Date.UTC(y, mo - 1, dd, h, mi, s);
    for (const local of cands) {
      const off = (utcOfNaive - new Date(local).getTime()) / 3600000; // naive = instant + offset
      const q = Math.round(off * 4) / 4;
      if (Math.abs(off - q) < 0.02 && Math.abs(q) <= 14) votes.set(q, (votes.get(q) || 0) + 1);
    }
  }
  let best = null, n = 0;
  for (const [k, v] of votes) if (v > n) { best = k; n = v; }
  return n >= 2 ? best : null;
}

/**
 * Merge a batch of add-on trades into state. Returns { next, added, updated, linked, skipped, newAccounts, detectedTz }.
 * - known ATAS id → broker fields refreshed, your notes/tags/review kept
 * - same trade already imported from a file → linked (kept as is, gets the ATAS id)
 * - otherwise → added to the Inbox
 */
export function applyAtasBatch(state, dtos) {
  const sync = state.settings.sync || {};
  let tz = sync.tz ?? 'auto';
  let detectedTz = sync.detectedTz ?? null;
  if (tz === 'auto') {
    if (detectedTz === null || detectedTz === undefined) {
      const c = calibrateOffset(dtos, state.trades);
      if (c !== null) detectedTz = c;
    }
    tz = detectedTz ?? 0; // ATAS keeps times in UTC internally unless calibration says otherwise
  }

  const grouping = sync.groupPositions !== false;
  const trades = state.trades.flatMap(explodeTrade); // combined positions → their fills, so each fill can be matched/updated
  const byAtas = new Map();
  const byShape = new Map(); // same account/symbol/side/qty/prices → candidates, matched on time ±2 s
  trades.forEach((t, i) => {
    if (t.atasId) byAtas.set(String(t.atasId), i);
    else if (t.entry) {
      const k = shapeKey(t);
      if (!byShape.has(k)) byShape.set(k, []);
      byShape.get(k).push(i);
    }
  });
  const ms = (iso) => new Date(iso).getTime();
  const findLink = (m) => {
    const list = byShape.get(shapeKey(m));
    if (!list) return -1;
    const e = ms(m.entry), x = ms(m.exit);
    let best = -1, bestD = Infinity;
    list.forEach((j, pos) => {
      const t = trades[j];
      const d = Math.abs(ms(t.entry) - e) + Math.abs(ms(t.exit) - x);
      if (Math.abs(ms(t.entry) - e) <= 2000 && Math.abs(ms(t.exit) - x) <= 2000 && d < bestD) { best = pos; bestD = d; }
    });
    return best < 0 ? -1 : list.splice(best, 1)[0];
  };

  const accounts = [...state.accounts];
  const skipList = new Set(sync.skip || []);
  const newAccounts = [];
  let added = 0, updated = 0, linked = 0, skipped = 0;
  const fresh = [];

  for (const d of dtos) {
    const m = mapAtasTrade(d, tz);
    if (!m.entry || !m.exit || !Number.isFinite(m.pnl)) { skipped++; continue; }
    let acct = accounts.find((a) => a.id === m.accountId);
    if (!acct) {
      if (skipList.has(m.accountId)) { skipped++; continue; }
      acct = { id: m.accountId, name: m.accountId, phase: /demo|sim/i.test(m.accountId) ? 'Personal' : 'Challenge', market: 'Futures', plan: 'Classic', status: 'Active', initial: guessInitial(m.accountId), profitTarget: 3000, maxDrawdown: 2000, dailyLossLimit: 1000, broker: 'ATAS', autoSync: true, syncDisabled: false, createdAt: m.entry.slice(0, 10) };
      accounts.push(acct);
      newAccounts.push(acct.id);
    }
    if (acct.syncDisabled) { skipped++; continue; }

    const broker = { accountId: m.accountId, symbol: m.symbol, direction: m.direction, qty: m.qty, entry: m.entry, exit: m.exit, entryPrice: m.entryPrice, exitPrice: m.exitPrice, fees: m.fees, pnl: m.pnl };
    const i = byAtas.get(m.atasId);
    if (i === -1) continue; // duplicate inside this batch
    if (i !== undefined) {
      const old = trades[i];
      if (!m.hasCommission && old.fees > 0) { broker.fees = old.fees; broker.pnl = r2(m.gross - old.fees); }
      const changed = Object.keys(broker).some((k) => String(old[k]) !== String(broker[k]));
      if (changed) { trades[i] = { ...old, ...broker }; updated++; }
      continue;
    }
    const j = findLink(m);
    if (j >= 0) {
      trades[j] = { ...trades[j], atasId: m.atasId };
      byAtas.set(m.atasId, j);
      linked++;
      continue;
    }
    const t = { id: uid('t'), ...broker, atasId: m.atasId, source: 'atas', tags: [], notes: m.comment, rating: 0, reviewed: false, screenshots: [], strategyId: null };
    fresh.push(t);
    byAtas.set(m.atasId, -1);
    added++;
  }

  const next = {
    ...state,
    accounts,
    trades: groupAtasTrades([...fresh.reverse(), ...trades], grouping),
    settings: { ...state.settings, sync: { ...sync, detectedTz, lastSync: new Date().toISOString(), lastAdded: added || sync.lastAdded || 0 } },
  };
  if (added) {
    const net = fresh.reduce((s, t) => s + t.pnl, 0);
    next.notifications = [{ id: uid('n'), title: `${added} new trade${added > 1 ? 's' : ''} synced from ATAS`, body: `Net ${net >= 0 ? '+' : '-'}$${Math.abs(net).toFixed(2)} · review them in your Inbox`, date: localIso(new Date()), read: false, link: '#/journal/inbox' }, ...state.notifications];
  }
  return { next, added, updated, linked, skipped, newAccounts, detectedTz };
}

// ---------------------------------------------------------------- one trade per position
// ATAS pairs each entry fill with an exit fill, so scaling in/out produces several records for one position.
// We combine records on the same account, symbol and direction whose holding times overlap (the position never
// went flat between them) into one trade, and keep the individual fills on it.

const USER_FIELDS = ['tags', 'blockers', 'notes', 'rating', 'reviewed', 'screenshots', 'strategyId'];
const r4 = (n) => Math.round(Number(n) * 10000) / 10000;

/** A combined trade back into its fills (as single trades that carry the combined trade's notes, tags…). */
export function explodeTrade(t) {
  if (!t.fills?.length) return [t];
  const user = Object.fromEntries(USER_FIELDS.map((k) => [k, t[k]]));
  return t.fills.map((f, k) => ({
    ...user, source: 'atas', id: k === 0 ? t.id : `${t.id}_${k}`, _group: t.id,
    accountId: t.accountId, symbol: t.symbol, direction: t.direction,
    qty: f.qty, entry: f.entry, exit: f.exit, entryPrice: f.entryPrice, exitPrice: f.exitPrice, fees: f.fees, pnl: f.pnl, atasId: f.atasId,
  }));
}

function combine(legs) {
  const byEntry = [...legs].sort((a, b) => a.entry.localeCompare(b.entry) || String(a.atasId).localeCompare(String(b.atasId)));
  const primary = legs.find((l) => l._group && l.id === l._group) || legs.find((l) => l._group) || byEntry[0];
  const qty = legs.reduce((s, l) => s + Number(l.qty || 0), 0) || 1;
  const wavg = (k) => r4(legs.reduce((s, l) => s + Number(l[k]) * Number(l.qty || 1), 0) / qty);
  const uniq = (a) => [...new Set(a.filter((x) => x !== undefined && x !== null && x !== ''))];
  const notes = uniq(legs.map((l) => (l.notes || '').trim()));
  const { _group, ...base } = primary; // eslint-disable-line no-unused-vars
  return {
    ...base,
    id: primary._group || primary.id,
    source: 'atas',
    qty,
    entry: byEntry[0].entry,
    exit: legs.reduce((m, l) => (l.exit > m ? l.exit : m), byEntry[0].exit),
    entryPrice: wavg('entryPrice'),
    exitPrice: wavg('exitPrice'),
    fees: r2(legs.reduce((s, l) => s + Number(l.fees || 0), 0)),
    pnl: r2(legs.reduce((s, l) => s + Number(l.pnl || 0), 0)),
    atasId: String(byEntry[0].atasId),
    atasIds: byEntry.map((l) => String(l.atasId)),
    fills: byEntry.map((l) => ({ atasId: String(l.atasId), entry: l.entry, exit: l.exit, qty: Number(l.qty), entryPrice: Number(l.entryPrice), exitPrice: Number(l.exitPrice), fees: r2(l.fees || 0), pnl: r2(l.pnl) })),
    tags: uniq(legs.flatMap((l) => l.tags || [])),
    blockers: uniq(legs.flatMap((l) => l.blockers || [])),
    notes: notes.join('\n'),
    screenshots: uniq(legs.flatMap((l) => l.screenshots || [])),
    rating: Math.max(0, ...legs.map((l) => Number(l.rating) || 0)),
    reviewed: legs.every((l) => l.reviewed),
    strategyId: legs.map((l) => l.strategyId).find(Boolean) || null,
  };
}

/**
 * Re-group the ATAS trades in a trades list. enabled=false splits everything back into raw executions.
 * Trades from other sources are never touched. The result keeps the list's order (newest first).
 */
export function groupAtasTrades(trades, enabled = true) {
  const flat = trades.flatMap(explodeTrade);
  if (!enabled) return flat.map(({ _group, ...t }) => t); // eslint-disable-line no-unused-vars
  const legs = flat.filter((t) => t.atasId && t.entry && t.exit);
  const keyOf = (t) => `${t.accountId}|${t.symbol}|${t.direction}`;
  const sorted = [...legs].sort((a, b) => keyOf(a).localeCompare(keyOf(b)) || a.entry.localeCompare(b.entry));
  const groupOf = new Map(); // leg → cluster array
  let cur = null, curKey = null, curEnd = '';
  for (const l of sorted) {
    const k = keyOf(l);
    if (cur && k === curKey && l.entry < curEnd) { cur.push(l); if (l.exit > curEnd) curEnd = l.exit; }
    else { cur = [l]; curKey = k; curEnd = l.exit; }
    groupOf.set(l, cur);
  }
  const out = [];
  const done = new Set();
  for (const t of flat) {
    const g = groupOf.get(t);
    if (!g) { out.push(t); continue; } // not an ATAS trade
    if (done.has(g)) continue;
    done.add(g);
    if (g.length === 1) { const { _group, ...one } = g[0]; out.push(_group ? { ...one, id: _group } : one); }
    else out.push(combine(g));
  }
  return out;
}
