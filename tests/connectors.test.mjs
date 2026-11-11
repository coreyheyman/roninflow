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

// ---------------------------------------------------------------- MetaTrader / Sierra Chart under Wine or CrossOver
import fsW from 'node:fs';
import osW from 'node:os';
import pathW from 'node:path';
import { wineUserDirs, createDropWatcher } from '../connect-apis.js';

test('wineUserDirs finds the Windows user folders in Wine / CrossOver prefixes on a Mac or Linux', () => {
  const home = fsW.mkdtempSync(pathW.join(osW.tmpdir(), 'rf-wine-'));
  const mk = (...p) => fsW.mkdirSync(pathW.join(home, ...p), { recursive: true });
  mk('Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user');   // MetaQuotes' Mac app
  mk('Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/Public');
  mk('.mt5/drive_c/users/al');                                                             // MetaQuotes' Linux script
  mk('Library/Application Support/CrossOver/Bottles/Sierra/drive_c/users/crossover');      // a CrossOver bottle
  const found = wineUserDirs(home, 'darwin').map((d) => pathW.relative(home, d)).sort();
  assert.deepEqual(found, [
    '.mt5/drive_c/users/al',
    'Library/Application Support/CrossOver/Bottles/Sierra/drive_c/users/crossover',
    'Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user',
  ]);
  assert.deepEqual(wineUserDirs(home, 'win32'), []);
});

test('a MetaTrader trade written inside the Mac MT5 app reaches the journal', () => {
  const home = fsW.mkdtempSync(pathW.join(osW.tmpdir(), 'rf-wine-'));
  const common = pathW.join(home, 'Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/TradeJournal');
  fsW.mkdirSync(common, { recursive: true });
  fsW.writeFileSync(pathW.join(common, 'mt5-12345.jsonl'), JSON.stringify({ platform: 'MetaTrader 5', account: '12345', id: 't1', symbol: 'EURUSD', side: 'Long', qty: 0.1, entryTime: '2026-11-10T09:00:00Z', exitTime: '2026-11-10T10:00:00Z', entryPrice: 1.1, exitPrice: 1.101, pnl: 10 }) + '\n');
  const realHome = process.env.HOME; process.env.HOME = home;
  try {
    const got = [];
    const scan = createDropWatcher({ ingest: (b) => { got.push(b); return {}; }, setHeartbeat: () => {}, log: () => {}, offsets: {} });
    scan();
    assert.equal(got.length, 1);
    assert.equal(got[0].source, 'metatrader');
    assert.equal(got[0].trades[0].symbol, 'EURUSD');
  } finally { process.env.HOME = realHome; }
});
