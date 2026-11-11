import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect, convert, toIso, toNumber } from '../src/lib/importers.js';
import { parseCsv } from '../src/lib/stats.js';

const table = (csv, delim = ',') => [{ name: 't', rows: parseCsv(csv, delim) }];

test('numbers and dates in common export formats', () => {
  assert.equal(toNumber('$1,234.50'), 1234.5);
  assert.equal(toNumber('(45.70)'), -45.7);
  assert.equal(toIso('2026-11-10 09:31:05'), '2026-11-10T09:31:05');
  assert.equal(toIso('11/10/2026 9:31:05 AM'), '2026-11-10T09:31:05');
});

test('fills export is detected and paired into a trade', () => {
  const t = table('Account,Time,Instrument,Action,Quantity,Price,Commission\nSIM1,2026-11-10 09:30:00,MESZ6,Buy,2,6000.25,0.62\nSIM1,2026-11-10 09:35:00,MESZ6,Sell,2,6002.25,0.62\n');
  const d = detect(t);
  assert.ok(d.ok);
  assert.equal(d.mode, 'fills');
  const r = convert(t[d.table].rows, { mode: d.mode, map: d.map, headerRow: d.headerRow });
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].symbol, 'MES');
  assert.equal(r.trades[0].pnl, 2 * 5 * 2 - 1.24); // 2 points × $5 × 2 contracts − fees
});

test('closed-trades export with P&L', () => {
  const t = table('Symbol;Side;Qty;Entry time;Exit time;Entry price;Exit price;Profit\nMNQZ6;Short;1;2026-11-10 07:42:10;2026-11-10 07:49:55;25210.5;25188.25;44.5\n', ';');
  const d = detect(t);
  assert.ok(d.ok);
  assert.equal(d.mode, 'trades');
  const r = convert(t[d.table].rows, { mode: d.mode, map: d.map, headerRow: d.headerRow, pnlIncludesFees: true });
  assert.equal(r.trades[0].direction, 'Short');
  assert.equal(r.trades[0].pnl, 44.5);
});

test('Tradovate performance CSV (buy/sell columns)', () => {
  const t = table('symbol,_priceFormat,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp\nMESZ6,-2,1,6000.25,6001.25,$5.00,11/10/2026 09:30:00,11/10/2026 09:31:00\n');
  const d = detect(t);
  assert.ok(d.ok);
  const r = convert(t[d.table].rows, { mode: d.mode, map: d.map, headerRow: d.headerRow, pnlIncludesFees: true });
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].direction, 'Long');
  assert.equal(r.trades[0].pnl, 5);
});
