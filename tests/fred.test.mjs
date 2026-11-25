import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFredCsv, parsePd, staleAfter, createFredHandler } from '../fred.js';
import { transform, derive, stats, freqOf, fmtValue, fmtChange, correlationMatrix, rollingCorrelation, SERIES, SERIES_PAGES, PICK_GROUPS } from '../src/lib/fredSeries.js';
import { classify, readRegime, confirmRead, hotCold, FORCE_IDS, CONFIRM, regimeHistory, assetRead, assetPlaybook, confirmAssetRead, hotEffect, CONFIRM_ALL_IDS } from '../src/lib/regime.js';
import { demoFred } from '../src/lib/fredDemo.js';

test('FRED CSV: both header styles, missing values skipped', () => {
  assert.deepEqual(parseFredCsv('observation_date,DGS10\n2026-11-20,4.91\n2026-11-21,.\n2026-11-24,4.88\n'), [['2026-11-20', 4.91], ['2026-11-24', 4.88]]);
  assert.deepEqual(parseFredCsv('DATE,X\r\n2026-01-01,\r\n2026-02-01,1.5\r\n'), [['2026-02-01', 1.5]]);
});

test('NY Fed primary dealer JSON → $ billions, found wherever the rows sit', () => {
  const j = { pd: { timeseries: [{ asofdate: '2026-11-12', keyid: 'PDPOSGS-B', value: '97123' }, { asofdate: '2026-11-05', keyid: 'PDPOSGS-B', value: '99000' }, { asofdate: '2026-11-12', keyid: 'OTHER', value: '1' }, { asofdate: '2026-10-29', keyid: 'PDPOSGS-B', value: '*' }] } };
  assert.deepEqual(parsePd(j, 'PDPOSGS-B'), [['2026-11-05', 99], ['2026-11-12', 97.123]]);
});

test('freshness follows how often a series prints', () => {
  const daily = [['2026-11-17', 1], ['2026-11-18', 1], ['2026-11-19', 1], ['2026-11-20', 1]];
  const monthly = [['2026-07-01', 1], ['2026-08-01', 1], ['2026-09-01', 1], ['2026-10-01', 1]];
  assert.equal(staleAfter(daily), 4 * 3600e3);
  assert.equal(staleAfter(monthly), 24 * 3600e3);
  assert.equal(freqOf(monthly), 'm');
});

test('the handler serves the cache at once and fetches what is missing in the background', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-fred-'));
  let calls = 0;
  const fetchImpl = async (url) => { calls++; return { ok: true, status: 200, text: async () => (url.includes('fredgraph') ? 'observation_date,DGS10\n2026-11-20,4.91\n2026-11-21,4.95\n' : '{}') }; };
  const h = createFredHandler(dir, { fetchImpl });
  const call = (url) => new Promise((resolve) => { const res = { setHeader() {}, end(b) { resolve({ code: res.statusCode, body: JSON.parse(b) }); } }; h({ method: 'GET', url }, res); });
  const first = await call('/api/macro/fred?ids=DGS10');
  assert.equal(first.code, 200);
  assert.equal(first.body.series.DGS10.pending, true);
  await new Promise((r) => setTimeout(r, 30));
  const second = await call('/api/macro/fred?ids=DGS10&from=2026-11-21');
  assert.deepEqual(second.body.series.DGS10.obs, [['2026-11-20', 4.91], ['2026-11-21', 4.95]]); // one point before the range
  assert.equal(calls, 1);
  assert.equal((await call('/api/macro/fred?ids=')).code, 400);
});

test('yoy, diff, scale and derived series', () => {
  const idx = Array.from({ length: 25 }, (_, i) => [`${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, 100 * 1.03 ** (i / 12)]);
  const yoy = transform({ tf: 'yoy' }, idx);
  assert.ok(Math.abs(yoy[yoy.length - 1][1] - 3) < 0.05);
  assert.deepEqual(transform({ tf: 'diff' }, [['a', 10], ['b', 13], ['c', 12]]), [['b', 3], ['c', -1]]);
  assert.deepEqual(transform({ scale: 0.001 }, [['a', 5000]]), [['a', 5]]);
  const net = derive((a, b, c) => a - b - c, [[['2026-01-07', 100], ['2026-01-14', 90]], [['2026-01-06', 5], ['2026-01-13', 10]], [['2026-01-07', 20]]]);
  assert.deepEqual(net, [['2026-01-07', 75], ['2026-01-14', 60]]);
});

test('formatting by unit', () => {
  assert.equal(fmtValue(SERIES.DGS10, 4.912), '4.91%');
  assert.equal(fmtChange(SERIES.DGS10, -0.08), '−8 bps');
  assert.equal(fmtValue(SERIES.WALCL, 6741.2), '$6,741B');
  assert.equal(fmtChange(SERIES.WALCL, -12), '−$12B');
  assert.equal(fmtValue(SERIES.PAYEMS, 165), '+165K');
  assert.equal(fmtChange(SERIES.BAMLH0A0HYM2, 0.54), '+0.54%');
});

test('correlation of returns', () => {
  const a = [], b = [], c = [];
  let x = 100, y = 50;
  for (let i = 0; i < 80; i++) { const r = Math.sin(i * 1.7) * 0.01; x *= 1 + r; y *= 1 - r; const d = `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`; a.push([`${2020 + Math.floor(i / 28)}${d.slice(4)}`, x]); b.push([a[i][0], y]); c.push([a[i][0], x * 2]); }
  const { m } = correlationMatrix([a, b, c], 60);
  assert.ok(m[0][1] < -0.99);
  assert.ok(m[0][2] > 0.99);
  assert.equal(rollingCorrelation(a, c, 20).length, 79 - 20 + 1);
});

test('regimes: the defining forces pick it, otherwise mixed', () => {
  assert.equal(classify({ growth: 'DOWN', inflation: 'FLAT', liquidity: 'DOWN', policy: 'FLAT', stress: 'UP' }).regime.id, 'crisis');
  assert.equal(classify({ growth: 'DOWN', inflation: 'FLAT', liquidity: 'DOWN', policy: 'FLAT', stress: 'UP' }).aligned, 5);
  assert.equal(classify({ growth: 'UP', inflation: 'UP', liquidity: 'FLAT', policy: 'FLAT', stress: 'DOWN' }).regime.id, 'reflation');
  assert.equal(classify({ growth: 'UP', inflation: 'DOWN', liquidity: 'UP', policy: 'FLAT', stress: 'DOWN' }).regime.id, 'goldilocks');
  assert.equal(classify({ growth: 'FLAT', inflation: 'FLAT', liquidity: 'FLAT', policy: 'FLAT', stress: 'FLAT' }).regime.id, 'mixed');
  assert.match(hotCold('Goods Trade Balance Adv').hot, /widening/);
  assert.match(hotCold('Unemployment Claims').hot, /Layoffs/);
});

test('every page and pick refers to a defined series', () => {
  for (const p of Object.values(SERIES_PAGES)) for (const g of p.groups) for (const id of g.ids) assert.ok(SERIES[id], id);
  for (const g of PICK_GROUPS) for (const id of g.ids) assert.ok(SERIES[id], id);
  for (const id of [...FORCE_IDS, ...CONFIRM.map((c) => c.id)]) assert.ok(SERIES[id], id);
  for (const [id, d] of Object.entries(SERIES)) if (!d.derive) assert.ok(d.demo, `${id} has demo data`);
});

test('the demo data reads as a crisis with most markets confirming', async () => {
  const ids = [...new Set([...FORCE_IDS.flatMap((id) => SERIES[id].derive || [id]), ...CONFIRM.map((c) => c.id)])];
  const raw = (await demoFred(new URL(`http://x/api/macro/fred?ids=${ids.join(',')}&from=2024-06-01`), { real: false })).series;
  const series = {};
  for (const id of [...FORCE_IDS, ...CONFIRM.map((c) => c.id)]) {
    const def = SERIES[id];
    series[id] = { obs: def.derive ? derive(def.fn, def.derive.map((x) => transform(SERIES[x], raw[x].obs))) : transform(def, raw[id].obs) };
  }
  const r = readRegime(series);
  assert.equal(r.today.regime.id, 'crisis', JSON.stringify(r.today.dirs));
  const c = confirmRead(series, r.today.regime.bias);
  assert.ok(c.agree >= 4, `${c.agree}/${c.total}`);
  assert.ok(stats(series.BAMLH0A0HYM2.obs).v > 3.7);
  assert.ok(regimeHistory(series, 12).length >= 10);
});

test('each market reads the forces its own way', () => {
  const stag = { growth: 'DOWN', inflation: 'UP', liquidity: 'DOWN', policy: 'FLAT', stress: 'UP' };
  assert.equal(assetRead('stocks', stag).bias, 'bearish');
  assert.equal(assetRead('dollar', stag).bias, 'bullish');
  assert.equal(assetRead('gold', { ...stag, liquidity: 'FLAT' }).bias, 'bullish');
  const p = assetPlaybook('stocks', stag);
  assert.ok(p.ifs.every((c) => c.ok === true));
  assert.notDeepEqual(p.then, assetPlaybook('dollar', stag).then);
  assert.equal(hotEffect('Core CPI m/m', 'gold'), -1);
  assert.equal(hotEffect('Core CPI m/m', 'dollar'), 1);
  assert.equal(hotEffect('Crude Oil Inventories', 'oil'), -1);
  for (const id of CONFIRM_ALL_IDS) assert.ok(SERIES[id], id);
});

test('a returning visitor’s demo is brought up to today', async () => {
  const { freshShowcase, freshenDemo, stampDemo, shiftDemoDates } = await import('../src/data/showcase.js');
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const back = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
  const lastTrade = (st) => st.trades.map((t) => t.entry.slice(0, 10)).sort().pop();
  const fresh = stampDemo(freshShowcase());
  assert.equal(fresh.settings.demoDay, ymd(new Date()));
  assert.ok(fresh.settings.demoSig && !fresh.settings.demoFresh);
  // untouched, saved 3 weeks ago → rebuilt (settings kept)
  const old = shiftDemoDates(fresh, -21);
  old.settings = { ...fresh.settings, demoDay: back(21), theme: 'mine' };
  old.settings.demoSig = (await import('../src/data/showcase.js')).demoSig(old);
  const a = freshenDemo(old);
  assert.equal(lastTrade(a), lastTrade(fresh));
  assert.equal(a.settings.theme, 'mine');
  // changed → kept, moved forward by whole weeks
  const edited = { ...old, trades: [...old.trades, { ...old.trades[0], id: 'mine', notes: 'my trade' }] };
  const b = freshenDemo(edited);
  assert.ok(b.trades.some((t) => t.id === 'mine'));
  assert.equal(Math.round((new Date(`${lastTrade(fresh)}T12:00`) - new Date(`${lastTrade(b)}T12:00`)) / 864e5), 0);
  assert.ok(b.trades.every((t) => ![0, 6].includes(new Date(`${t.entry.slice(0, 10)}T12:00`).getDay())));
  // already today → untouched
  assert.equal(freshenDemo(fresh), fresh);
});

test('FRED saying slow down (403) pauses and retries instead of failing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-fred-'));
  let calls = 0, t = 1_000_000;
  const fetchImpl = async () => { calls++; return calls === 1 ? { ok: false, status: 403, text: async () => 'slow down' } : { ok: true, status: 200, text: async () => 'observation_date,X\n2026-11-20,1.5\n' }; };
  const h = createFredHandler(dir, { fetchImpl, now: () => t });
  const call = (url) => new Promise((resolve) => { const res = { setHeader() {}, end(b) { resolve(JSON.parse(b)); } }; h({ method: 'GET', url }, res); });
  await call('/api/macro/fred?ids=X');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 1);
  const mid = await call('/api/macro/fred?ids=X');
  assert.equal(mid.series.X.error, null);
  assert.equal(mid.refreshing, true);
  t += 61e3; // a minute later the queue resumes (the next request nudges it)
  await call('/api/macro/fred?ids=X');
  await new Promise((r) => setTimeout(r, 50));
  const done = await call('/api/macro/fred?ids=X');
  assert.deepEqual(done.series.X.obs, [['2026-11-20', 1.5]]);
});
