// P&L from the account balance: (live balance − starting balance), using the balance ATAS reports.
// The difference from the sum of the journal's trades is the "balance adjustment" (fills ATAS's trade history
// is missing, fees charged to the account, …). Turn off with settings.balancePnl = false.

/** { live, at, tradeNet, pnl, gap } for one account, or null when there's no live balance (or it's turned off). */
export function accountBalanceInfo(state, accountId) {
  if (state.settings.balancePnl === false) return null;
  const acct = state.accounts.find((a) => a.id === accountId);
  const b = state.settings.sync?.balances?.[accountId];
  if (!acct || !b || b.balance == null || !Number.isFinite(Number(b.balance))) return null;
  const tradeNet = state.trades.filter((t) => t.accountId === accountId).reduce((s, t) => s + t.pnl, 0);
  const pnl = Number(b.balance) - Number(acct.initial || 0);
  const gap = Math.round((pnl - tradeNet) * 100) / 100;
  return { live: Number(b.balance), at: b.at, tradeNet, pnl, gap: Math.abs(gap) < 0.01 ? 0 : gap };
}

/** Total adjustment for the selected account ('all' = every visible account). */
export function balanceGap(state, accountId = state.settings.account) {
  if (accountId !== 'all') return accountBalanceInfo(state, accountId)?.gap || 0;
  const hidden = state.settings.hideBreached ? new Set(state.accounts.filter((a) => a.status === 'Breached').map((a) => a.id)) : new Set();
  return state.accounts.filter((a) => !hidden.has(a.id)).reduce((s, a) => s + (accountBalanceInfo(state, a.id)?.gap || 0), 0);
}

/** The balance adjustment that belongs to a period: an account's gap counts toward a period when every one of
 *  that account's trades falls inside it (the gap can't be pinned to a date, so it goes to the smallest period
 *  that holds the whole account). inPeriod(trade) → boolean. */
export function periodBalanceGap(state, inPeriod, accountId = state.settings.account) {
  if (state.settings.balancePnl === false) return 0;
  const hidden = state.settings.hideBreached ? new Set(state.accounts.filter((a) => a.status === 'Breached').map((a) => a.id)) : new Set();
  const ids = accountId === 'all' ? state.accounts.filter((a) => !hidden.has(a.id)).map((a) => a.id) : [accountId];
  let sum = 0;
  for (const id of ids) {
    const gap = accountBalanceInfo(state, id)?.gap || 0;
    if (!gap) continue;
    const ts = state.trades.filter((t) => t.accountId === id);
    if (ts.length && ts.every(inPeriod)) sum += gap;
  }
  return Math.round(sum * 100) / 100;
}
