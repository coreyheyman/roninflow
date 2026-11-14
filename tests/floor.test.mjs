import test from 'node:test';
import assert from 'node:assert/strict';
import { floorSeries } from '../src/lib/accountDD.js';

// day helper: a list of trade P&Ls in the order they closed
const day = (date, ...pnls) => ({ date, net: pnls.reduce((a, b) => a + b, 0), trades: pnls.map((pnl, i) => ({ pnl, entry: `${date}T09:${String(i).padStart(2, '0')}:00`, exit: `${date}T09:${String(i).padStart(2, '0')}:30` })) });
// +600 (high +700 during the day), −300, +900, −200
const days = [day('2026-11-02', 700, -100), day('2026-11-03', -300), day('2026-11-04', 400, 500), day('2026-11-05', -200)];
const acct = (ddType, extra = {}) => ({ initial: 50000, maxDrawdown: 2000, ddType, ...extra });

test('static floor never moves', () => {
  assert.deepEqual(floorSeries(acct('static'), days), [-2000, -2000, -2000, -2000]);
});

test('EOD trailing moves up only after a day closes higher', () => {
  // closes: +600, +300, +1200, +1000 → floor during each day trails the best close before it
  assert.deepEqual(floorSeries(acct('eod', { ddLock: false }), days), [-2000, -1400, -1400, -800]);
});

test('intraday trailing follows the highest point, the same day included', () => {
  // running after each trade: 700, 600 | 300 | 700, 1200 | 1000
  assert.deepEqual(floorSeries(acct('intraday', { ddLock: false }), days), [-1300, -1300, -800, -800]);
});

test('trailing stops at the starting balance when locked (the default)', () => {
  const big = [day('2026-11-02', 1500), day('2026-11-03', 1500), day('2026-11-04', -500)];
  assert.deepEqual(floorSeries(acct('eod'), big), [-2000, -500, 0]);
  assert.deepEqual(floorSeries(acct('eod', { ddLock: false }), big), [-2000, -500, 1000]);
  assert.deepEqual(floorSeries(acct('intraday'), big), [-500, 0, 0]);
  assert.deepEqual(floorSeries(acct('static'), big), [-2000, -2000, -2000]); // lock doesn't apply
});

test('defaults and missing data', () => {
  assert.equal(floorSeries({ initial: 50000 }, days), null); // no max drawdown set
  assert.deepEqual(floorSeries({ initial: 50000, maxDrawdown: 1000 }, days.slice(0, 2)), [-1000, -400]); // EOD is the default type
  assert.deepEqual(floorSeries(acct('eod'), []), []);
});
