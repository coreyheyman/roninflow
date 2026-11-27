import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeStates } from '../src/lib/mergeState.js';

const trade = (id, extra = {}) => ({ id, atasId: `a${id}`, pnl: 10, reviewed: false, ...extra });
const base = { trades: [trade(1), trade(2)], settings: { sync: { cursor: 5, balances: { A: { balance: 100 } } }, theme: 'dark' } };

test('a review saved while another window saved balances keeps both', () => {
  const local = { ...base, trades: [trade(1, { reviewed: true }), trade(2)] };
  const remote = { ...base, settings: { ...base.settings, sync: { ...base.settings.sync, balances: { A: { balance: 140 } } } } };
  const m = mergeStates(base, local, remote);
  assert.equal(m.trades[0].reviewed, true, 'your review');
  assert.equal(m.settings.sync.balances.A.balance, 140, 'their balance');
  assert.equal(m.settings.theme, 'dark');
});

test('their changes to other trades and their new trades survive; yours win on the trade you edited', () => {
  const local = { ...base, trades: [trade(1, { notes: 'mine' }), trade(2)] };
  const remote = { ...base, trades: [trade(3), trade(1, { notes: 'theirs' }), trade(2, { tags: ['x'] })] };
  const m = mergeStates(base, local, remote);
  assert.deepEqual(m.trades.map((t) => t.id), [3, 1, 2]);
  assert.equal(m.trades[1].notes, 'mine');
  assert.deepEqual(m.trades[2].tags, ['x']);
});

test('deletes and adds on your side carry over; the same ATAS trade added in both windows is kept once', () => {
  const local = { ...base, trades: [trade(9), { id: 10, atasId: 'a3' }, trade(1)] }; // deleted 2, added 9 and a copy of ATAS trade a3
  const remote = { ...base, trades: [trade(3), trade(1), trade(2)] };
  const m = mergeStates(base, local, remote);
  assert.deepEqual(m.trades.map((t) => t.id).sort(), [1, 3, 9]);
});

test('nothing changed on your side: theirs as is', () => {
  const remote = { ...base, trades: [trade(1, { reviewed: true })] };
  assert.deepEqual(mergeStates(base, base, remote), remote);
});
