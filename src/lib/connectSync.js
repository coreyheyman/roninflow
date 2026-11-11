// Merges round-trip trades from the connector inbox (connect.js on the server) into the journal.
// Each journal trade remembers its connector record in `connId`; your tags, notes, ratings, reviews and
// screenshots are never touched when the broker data updates.
import { uid, pad, wallClock } from './stats';
import { guessInitial } from './importers';
import { platformName } from './connectors';

const localIso = (iso) => wallClock(iso); // instant → wall-clock time in your time zone
const BROKER = ['accountId', 'symbol', 'contract', 'direction', 'qty', 'entry', 'exit', 'entryPrice', 'exitPrice', 'fees', 'pnl'];
const annotated = (t) => t.reviewed || (t.notes && String(t.notes).trim()) || t.tags?.length || t.screenshots?.length || t.blockers?.length || t.rating || t.strategyId;
const ms = (iso) => new Date(iso).getTime();

export function applyConnectBatch(state, records, cursor, balances) {
  const sync = state.settings.connect || {};
  const skip = new Set(state.settings.sync?.skip || []);
  let trades = [...state.trades];
  const accounts = [...state.accounts];
  const byConn = new Map(trades.map((t, i) => [t.connId, i]).filter(([k]) => k));
  let added = 0, updated = 0, linked = 0, removed = 0, skipped = 0;
  const fresh = [];
  const drop = new Set();
  const newAccounts = [];

  for (const r of records) {
    if (r.removed) {
      const i = byConn.get(r.id);
      if (i !== undefined && !annotated(trades[i])) { drop.add(i); removed++; }
      continue;
    }
    if (r.pnl === null || r.pnl === undefined || !r.entry) { skipped++; continue; }
    const accountId = r.account;
    let acct = accounts.find((a) => a.id === accountId);
    if (!acct) {
      if (skip.has(accountId)) { skipped++; continue; }
      acct = { id: accountId, name: accountId, phase: /demo|sim/i.test(accountId) ? 'Personal' : 'Challenge', market: 'Futures', plan: 'Classic', status: 'Active', initial: guessInitial(accountId), profitTarget: 3000, maxDrawdown: 2000, dailyLossLimit: 1000, broker: platformName(r.source), autoSync: true, syncDisabled: false, createdAt: localIso(r.entry).slice(0, 10) };
      accounts.push(acct);
      newAccounts.push(accountId);
    }
    if (acct.syncDisabled) { skipped++; continue; }
    const broker = { accountId, symbol: r.symbol, contract: r.contract, direction: r.direction, qty: r.qty, entry: localIso(r.entry), exit: localIso(r.exit || r.entry), entryPrice: r.entryPrice, exitPrice: r.exitPrice, fees: r.fees, pnl: r.pnl };
    const i = byConn.get(r.id);
    if (i !== undefined) {
      const old = trades[i];
      if (BROKER.some((k) => String(old[k] ?? '') !== String(broker[k] ?? ''))) { trades[i] = { ...old, ...broker }; updated++; }
      continue;
    }
    // the same trade may already be in the journal (ATAS sync, a file import) → link instead of duplicating
    const e = ms(broker.entry), x = ms(broker.exit);
    const j = trades.findIndex((t) => !t.connId && t.accountId === accountId && t.symbol === broker.symbol && t.direction === broker.direction
      && Number(t.qty) === Number(broker.qty) && Math.abs(ms(t.entry) - e) <= 90000 && Math.abs(ms(t.exit) - x) <= 90000);
    if (j >= 0) { trades[j] = { ...trades[j], connId: r.id }; byConn.set(r.id, j); linked++; continue; }
    fresh.push({ id: uid('t'), ...broker, connId: r.id, source: r.source, tags: [], notes: '', rating: 0, reviewed: false, screenshots: [], strategyId: null });
    byConn.set(r.id, -1);
    added++;
  }
  if (drop.size) trades = trades.filter((_, i) => !drop.has(i));
  // live balances from add-on heartbeats (same place the ATAS balances go, so balance-based P&L and drawdown use them)
  let syncSettings = state.settings.sync;
  if (balances?.length) {
    const b = { ...(syncSettings?.balances || {}) };
    for (const x of balances) {
      if (!x.account || x.balance == null || !Number.isFinite(Number(x.balance))) continue;
      const eq = Number(x.balance) + (Number(x.openPnl) || 0);
      b[x.account] = { ...x, peakEquity: Math.max(Number(b[x.account]?.peakEquity) || 0, eq, Number(x.balance)) };
    }
    syncSettings = { ...syncSettings, balances: b };
    // a brand-new account: take its starting balance from the live balance minus the trades we know about,
    // so balance-based P&L starts out matching the trades (edit it on the Accounts page if you know the real one)
    for (const id of newAccounts) {
      const live = Number(b[id]?.balance);
      if (!Number.isFinite(live)) continue;
      const known = [...fresh, ...trades].filter((t) => t.accountId === id).reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
      const k = accounts.findIndex((a) => a.id === id);
      if (k >= 0) accounts[k] = { ...accounts[k], initial: Math.round((live - known) * 100) / 100 };
    }
  }
  const next = { ...state, accounts, trades: [...fresh.reverse(), ...trades], settings: { ...state.settings, sync: syncSettings, connect: { ...sync, lastSync: new Date().toISOString(), ...(cursor != null ? { cursor } : {}) } } };
  if (added) {
    const net = fresh.reduce((s, t) => s + t.pnl, 0);
    const from = [...new Set(fresh.map((t) => platformName(t.source)))].join(', ');
    next.notifications = [{ id: uid('n'), title: `${added} new trade${added > 1 ? 's' : ''} from ${from}`, body: `Net ${net >= 0 ? '+' : '-'}$${Math.abs(net).toFixed(2)} · review them in your Inbox`, date: localIso(new Date().toISOString()), read: false, link: '#/journal/inbox' }, ...state.notifications];
  }
  return { next, added, updated, linked, removed, skipped, newAccounts };
}
