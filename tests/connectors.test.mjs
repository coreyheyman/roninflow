import { test } from 'node:test';
import assert from 'node:assert/strict';
import { polygonTicker } from '../candles.js';
import { flexTime, projectxSymbol, zonedToUtc } from '../connect-apis.js';
import { createVault } from '../secrets.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('price-source symbol mapping', () => {
  assert.equal(polygonTicker('AAPL'), 'AAPL');
  assert.equal(polygonTicker('BTCUSDT'), 'X:BTCUSD');
  assert.equal(polygonTicker('ETH-PERP'), 'X:ETHUSD');
  assert.equal(polygonTicker('EUR_USD'), 'C:EURUSD');
  assert.equal(polygonTicker('ESZ6'), null);
});

test('IBKR Flex times are Eastern time, daylight saving included', () => {
  assert.equal(flexTime('20261110;093105'), '2026-11-10T14:31:05.000Z');
  assert.equal(flexTime('20260710;093105'), '2026-07-10T13:31:05.000Z');
  assert.equal(new Date(zonedToUtc(2026, 3, 9, 9, 30, 0, 'America/New_York')).toISOString(), '2026-03-09T13:30:00.000Z'); // day after the clocks change
});

test('ProjectX contract ids map to roots', () => {
  assert.match(projectxSymbol('CON.F.US.EP.H25'), /^ES/);
  assert.match(projectxSymbol('CON.F.US.ENQ.Z26'), /^NQ/);
});

test('vault encrypts and survives a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-vault-'));
  const v = createVault(dir);
  v.set('ai:openai', 'sk-secret');
  assert.ok(!fs.readFileSync(path.join(dir, 'vault.json'), 'utf8').includes('sk-secret'));
  assert.equal(createVault(dir).get('ai:openai'), 'sk-secret');
  const enc = v.encrypt({ a: 1 });
  assert.deepEqual(v.decrypt(enc), { a: 1 });
});
