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

test('Webull request signature matches the documented example', async () => {
  const { webullSign } = await import('../connect-markets.js');
  const sig = webullSign({
    path: '/trade/place_order',
    query: { a1: 'webull', a2: '123', a3: 'xxx', q1: 'yyy' },
    headers: { 'x-app-key': '776da210ab4a452795d74e726ebd74b6', 'x-timestamp': '2022-01-04T03:55:31Z', 'x-signature-version': '1.0', 'x-signature-algorithm': 'HMAC-SHA1', 'x-signature-nonce': '48ef5afed43d4d91ae514aaeafbc29ba', host: 'api.webull.com' },
    body: '{"k1":123,"k2":"this is the api request body","k3":true,"k4":{"foo":[1,2]}}',
    secret: '0f50a2e853334a9aae1a783bee120c1f',
  });
  assert.equal(sig, 'kvlS6opdZDhEBo5jq40nHYXaLvM=');
});

test('Webull: token approval in the app, then filled orders become fills', async () => {
  const { createWebull } = await import('../connect-markets.js');
  const real = globalThis.fetch;
  let approved = false, creates = 0;
  const calls = [];
  globalThis.fetch = async (url, opt) => {
    const u = new URL(url);
    calls.push(`${opt.method} ${u.pathname}`);
    assert.ok(opt.headers['x-signature'] && opt.headers['x-app-key'] === 'K');
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.pathname === '/auth/tokens/create') { creates++; return json({ token: 'TOK', status: 'PENDING' }); }
    if (u.pathname === '/auth/tokens/check') return json({ token: 'TOK', status: approved ? 'NORMAL' : 'PENDING' });
    const tokOk = opt.headers['x-access-token'] === 'TOK' && approved;
    if (u.pathname === '/trading/accounts/list') return tokOk ? json([{ account_id: 'A1', account_number: '5UX123', account_type: 'MARGIN' }]) : json({ message: 'token not verified' }, 401);
    if (u.pathname === '/trading/orders/historical-orders/list') {
      assert.equal(u.searchParams.get('account_id'), 'A1');
      return json([
        { client_order_id: 'c1', order_id: 'o1', side: 'BUY', status: 'FILLED', filled_time_at: '2026-11-20T15:31:02Z', items: [{ order_id: 'o1', symbol: 'AAPL', side: 'BUY', filled_quantity: '10', filled_price: '190.5', status: 'FILLED' }] },
        { client_order_id: 'c2', order_id: 'o2', side: 'SELL', status: 'FILLED', filled_time_at: 1795700000000, items: [{ order_id: 'o2', symbol: 'AAPL', side: 'SELL', filled_quantity: '10', filled_price: '191.25', status: 'FILLED' }] },
        { client_order_id: 'c3', order_id: 'o3', side: 'BUY', status: 'CANCELLED', items: [{ order_id: 'o3', symbol: 'TSLA', side: 'BUY', filled_quantity: '0', status: 'CANCELLED' }] },
      ]);
    }
    return json({}, 404);
  };
  try {
    const cfg = { appKey: 'K', appSecret: 'S' };
    const api = createWebull(cfg);
    await assert.rejects(api.test(), /Webull app/);
    assert.equal(cfg.accessToken, 'TOK');
    approved = true;
    assert.match(await api.test(), /1 account\(s\): 5UX123 \(MARGIN\)/);
    assert.equal(creates, 1, 'no second SMS while the first request is still valid');
    const out = await api.poll({ since: null });
    assert.equal(out.fills.length, 2);
    assert.deepEqual(out.fills.map((f) => [f.side, f.qty, f.price, f.account, f.pointValue]), [['Buy', 10, 190.5, '5UX123', 1], ['Sell', 10, 191.25, '5UX123', 1]]);
    assert.equal(out.fills[1].time, new Date(1795700000000).toISOString());
  } finally { globalThis.fetch = real; }
});
