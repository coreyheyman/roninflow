import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, barTime, ivSec, toLocal } from '../src/lib/bars.js';

// 1-minute candles for one futures session: Nov 10 6 PM ET (23:00 UTC) to Nov 11 5 PM ET
const open = Date.parse('2026-11-10T23:00:00Z') / 1000;
const rows = [];
for (let i = 0; i < 23 * 60; i++) rows.push([open + i * 60, 100 + i, 101 + i, 99 + i, 100.5 + i, 2]);
const utc = (x) => new Date((x - (toLocal(x) - x)) * 1000).toISOString().slice(11, 16); // chart time → UTC clock

test('timeframe names', () => {
  assert.deepEqual(['1m', '5m', '10m', '15m', '30m', '1h', '4h', '1d', '60m'].map(ivSec), [60, 300, 600, 900, 1800, 3600, 14400, 86400, 3600]);
});

test('intraday bars count from the 6 PM New York session open', () => {
  const h4 = aggregate(rows, 14400);
  assert.equal(h4.length, 6);
  assert.deepEqual(h4.map((b) => utc(b.time)), ['23:00', '03:00', '07:00', '11:00', '15:00', '19:00']); // 6 PM, 10 PM, 2 AM, 6 AM, 10 AM, 2 PM ET
  assert.equal(h4[0].open, rows[0][1]);
  assert.equal(h4[0].close, rows[239][4]);
  assert.equal(h4[0].high, rows[239][2]);
  assert.equal(h4[0].low, rows[0][3]);
  assert.equal(h4[0].volume, 480);
  assert.equal(aggregate(rows, 300).length, 276);
  assert.equal(aggregate(rows, 600).length, 138);
});

test('a daily bar is one session, labelled with its trading date', () => {
  const d = aggregate(rows, 86400);
  assert.equal(d.length, 1);
  assert.equal(new Date(d[0].time * 1000).toISOString().slice(0, 10), '2026-11-11');
  // an execution at 7 PM ET the evening before belongs to the same session's bar
  assert.equal(barTime(Date.parse('2026-11-11T00:00:00Z') / 1000, 86400), d[0].time);
});

test('daylight-saving change keeps bars on the session open', () => {
  const summer = Date.parse('2026-07-14T22:00:00Z') / 1000; // 6 PM EDT
  assert.equal(utc(barTime(summer + 3 * 3600 + 120, 14400)), '22:00');
});
