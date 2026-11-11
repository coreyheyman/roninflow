import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillsToTrades, rootSymbol } from '../src/lib/pairing.js';

const f = (time, side, qty, price, extra = {}) => ({ account: 'A', contract: extra.contract || 'MESZ6', root: rootSymbol(extra.contract || 'MESZ6'), time: `2026-11-10T${time}`, side, qty, price, commission: 0, row: 0, ...extra });

test('root symbols', () => {
  assert.equal(rootSymbol('MESZ6'), 'MES');
  assert.equal(rootSymbol('MES 12-26'), 'MES');
  assert.equal(rootSymbol('F.US.MESZ26'), 'MES');
  assert.equal(rootSymbol('BTCUSDT'), 'BTCUSDT');
});

test('round trip with scale-in and partial exits', () => {
  const { trades, open } = fillsToTrades([f('09:30:00', 1, 1, 6000), f('09:31:00', 1, 1, 6002), f('09:35:00', -1, 1, 6005), f('09:36:00', -1, 1, 6006)]);
  assert.equal(trades.length, 1);
  assert.equal(open.length, 0);
  assert.equal(trades[0].direction, 'Long');
  assert.equal(trades[0].qty, 2);
  assert.equal(trades[0].entryPrice, 6001);
  assert.equal(trades[0].exitPrice, 6005.5);
});

test('reversal closes one trade and opens the next', () => {
  const { trades, open } = fillsToTrades([f('09:30:00', 1, 1, 6000), f('09:31:00', -1, 2, 6004), f('09:40:00', 1, 1, 6001)]);
  assert.equal(trades.length, 2);
  assert.deepEqual(trades.map((t) => t.direction), ['Long', 'Short']);
  assert.equal(open.length, 0);
});

test('fractional sizes (crypto) end flat despite float dust', () => {
  const { trades, open } = fillsToTrades([f('09:30:00', 1, 0.1, 60000, { contract: 'BTCUSDT' }), f('09:31:00', 1, 0.2, 60100, { contract: 'BTCUSDT' }), f('09:40:00', -1, 0.3, 60500, { contract: 'BTCUSDT' })]);
  assert.equal(trades.length, 1);
  assert.equal(open.length, 0);
});

test('tiny prices keep their precision', () => {
  const { trades } = fillsToTrades([f('09:30:00', 1, 1e6, 0.00001234, { contract: 'PEPEUSDT' }), f('09:31:00', -1, 1e6, 0.00001301, { contract: 'PEPEUSDT' })]);
  assert.equal(trades[0].entryPrice, 0.00001234);
});

test('spot: selling coins bought before the history does not create a short', () => {
  const { trades, open } = fillsToTrades([f('09:00:00', -1, 2, 150, { contract: 'SOL-SPOT', spot: true }), f('09:30:00', 1, 1, 140, { contract: 'SOL-SPOT', spot: true }), f('09:40:00', -1, 1, 145, { contract: 'SOL-SPOT', spot: true })]);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].direction, 'Long');
  assert.equal(open.length, 0);
});

test('closing fill for a position opened before the history is skipped', () => {
  const { trades } = fillsToTrades([f('09:00:00', -1, 1, 6000, { closes: 1 }), f('09:30:00', 1, 1, 6001), f('09:40:00', -1, 1, 6003, { closes: 1 })]);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].direction, 'Long');
});
