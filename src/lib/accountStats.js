// Account costs, payouts and return on investment.
import { summarize } from './stats';

export const PAYOUT_STATUSES = ['Paid', 'Pending', 'Rejected'];
export const PAYOUT_METHODS = ['Rise', 'Plane', 'Wise', 'Bank transfer', 'Crypto', 'PayPal', 'Other'];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** What an account cost you: purchase price plus resets / activation fees. */
export const accountCost = (a) => num(a?.cost) + num(a?.fees);
export const accountBought = (a) => a?.purchasedAt || a?.createdAt || null;

/**
 * Totals, per-account rows and a running "money in vs money out" line.
 * Only payouts marked Paid count as received; Pending is shown separately; Rejected is ignored.
 */
export function portfolioStats(accounts, payouts = [], trades = [], gaps = {}) {
  const rows = accounts.map((a) => {
    const p = payouts.filter((x) => x.accountId === a.id);
    const paid = p.filter((x) => x.status === 'Paid').reduce((s, x) => s + num(x.amount), 0);
    const pending = p.filter((x) => x.status === 'Pending').reduce((s, x) => s + num(x.amount), 0);
    const cost = accountCost(a);
    const net = paid - cost;
    return { a, cost, paid, pending, net, roi: cost ? (net / cost) * 100 : null, count: p.filter((x) => x.status === 'Paid').length, trading: summarize(trades.filter((t) => t.accountId === a.id)).net + (gaps[a.id] || 0) };
  });
  // payouts for accounts that were deleted still count as money received
  const known = new Set(accounts.map((a) => a.id));
  const orphanPaid = payouts.filter((x) => !known.has(x.accountId) && x.status === 'Paid').reduce((s, x) => s + num(x.amount), 0);
  const spent = rows.reduce((s, r) => s + r.cost, 0);
  const paid = rows.reduce((s, r) => s + r.paid, 0) + orphanPaid;
  const pending = payouts.filter((x) => x.status === 'Pending').reduce((s, x) => s + num(x.amount), 0);
  const paidList = payouts.filter((x) => x.status === 'Paid');
  const decided = accounts.filter((a) => ['Passed', 'Funded', 'Breached'].includes(a.status));
  const passed = accounts.filter((a) => a.status === 'Passed' || a.status === 'Funded').length;
  const withCost = rows.filter((r) => r.cost > 0);

  // running net: costs on the day an account was bought, payouts on the day they were received
  const events = [
    ...rows.filter((r) => r.cost > 0 && accountBought(r.a)).map((r) => ({ date: accountBought(r.a), v: -r.cost, tip: `${r.a.name || r.a.id} bought` })),
    ...paidList.filter((x) => x.date).map((x) => ({ date: x.date, v: num(x.amount), tip: `Payout · ${x.accountId}` })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  let run = 0;
  const timeline = events.map((e) => { run += e.v; return { date: e.date, y: Math.round(run * 100) / 100, tip: e.tip }; });

  return {
    rows,
    spent,
    paid,
    pending,
    net: paid - spent,
    roi: spent ? ((paid - spent) / spent) * 100 : null,
    bought: withCost.length,
    avgCost: withCost.length ? spent / withCost.length : 0,
    payouts: paidList.length,
    avgPayout: paidList.length ? paid / paidList.length : 0,
    passRate: decided.length ? (passed / decided.length) * 100 : null,
    passed,
    breached: accounts.filter((a) => a.status === 'Breached').length,
    funded: accounts.filter((a) => a.status === 'Funded').length,
    timeline,
  };
}
