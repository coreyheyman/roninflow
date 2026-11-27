import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseOcc, bsGreeks, computeGex, computeVannaCharm, expiryMs, createGexHandler, futuresFromCandles } from '../gex.js';

const NOW = Date.parse('2026-11-18T15:00:00Z'); // 10:00 AM New York
const EXP = '2026-11-18', EXP2 = '2026-12-18';

test('OCC symbols, expiry time and Greeks', () => {
  assert.deepEqual(parseOcc('SPXW261118C06050000'), { root: 'SPXW', exp: '2026-11-18', type: 'C', strike: 6050 });
  assert.deepEqual(parseOcc('O:SPY261218P00590500'), { root: 'SPY', exp: '2026-12-18', type: 'P', strike: 590.5 });
  assert.equal(parseOcc('nope'), null);
  assert.equal(new Date(expiryMs('2026-11-18')).toISOString(), '2026-11-18T21:00:00.000Z', '4 PM EST');
  assert.equal(new Date(expiryMs('2026-07-17')).toISOString(), '2026-07-17T20:00:00.000Z', '4 PM EDT');
  const g = bsGreeks(6000, 6000, 30 / 365, 0.2, 'C');
  assert.ok(Math.abs(g.gamma - 0.0011591) < 2e-6, `ATM gamma ${g.gamma}`);
  assert.ok(Math.abs(g.delta - 0.5115) < 2e-3);
  assert.ok(Math.abs(bsGreeks(6000, 6000, 30 / 365, 0.2, 'P').delta - (g.delta - 1)) < 1e-9);
});

// a chain: heavy call open interest at 6100, heavy puts at 5900, a little everywhere
function chain(spot = 6000) {
  const rows = [];
  for (let k = 5700; k <= 6300; k += 25) {
    for (const [exp, T] of [[EXP, 6 / 24 / 365], [EXP2, 30 / 365]]) {
      const big = exp === EXP ? 20 : 1; // same-day gamma is packed at the price: the walls need far more there
      const callOi = k === 6100 ? 30000 * big : 1500, putOi = k === 5900 ? 40000 * big : 1500;
      const iv = 0.18 + Math.abs(k - spot) / spot;
      rows.push({ exp, type: 'C', strike: k, oi: callOi, iv, gamma: bsGreeks(spot, k, T, iv, 'C').gamma, mult: 100 });
      rows.push({ exp, type: 'P', strike: k, oi: putOi, iv, gamma: bsGreeks(spot, k, T, iv, 'P').gamma, mult: 100 });
    }
  }
  return rows;
}

test('GEX: walls at the big strikes, a flip between them, and the regime at the price', () => {
  const g = computeGex(chain(), { spot: 6000, now: NOW, exps: [EXP2] });
  assert.equal(g.callWall, 6100);
  assert.equal(g.putWall, 5900);
  assert.ok(g.flip > 5900 && g.flip < 6300, `flip ${g.flip}`);
  assert.equal(g.zone, 'negative', 'more put gamma than call gamma around the price');
  assert.ok(g.strikes.find((s) => s.strike === 6100).call > 0 && g.strikes.find((s) => s.strike === 5900).put < 0);
  // dollars per 1% move: gamma × OI × 100 × S² × 1%
  const s = g.strikes.find((x) => x.strike === 6100);
  const T = (expiryMs(EXP2) - NOW) / (365 * 864e5);
  assert.ok(Math.abs(s.callOi - 30000) < 1e-9);
  assert.ok(s.call > 0 && s.call < 30000 * 100 * 6000 * 6000 * 0.01 * bsGreeks(6000, 6100, 30 / 365, 0.18 + 100 / 6000, 'C').gamma * 1.2, `${T}`);
  assert.ok(['positive', 'negative'].includes(g.zone));
  // only the chosen expirations; nothing chosen = all
  assert.ok(computeGex(chain(), { spot: 6000, now: NOW }).contracts > g.contracts);
  // gamma worked out from IV when a source has none
  const noGamma = chain().map((r) => ({ ...r, gamma: 0 }));
  assert.equal(computeGex(noGamma, { spot: 6000, now: NOW, exps: [EXP2] }).callWall, 6100);
});

test('vanna and charm by strike, near term and regime', () => {
  const v = computeVannaCharm(chain(), { spot: 6000, now: NOW, minDte: 0, maxDte: 45 });
  assert.ok(v.strikes.length > 10);
  assert.ok(Number.isFinite(v.vanna) && Number.isFinite(v.charm));
  assert.ok(v.maxVanna != null && v.minVanna != null);
  assert.equal(computeVannaCharm(chain(), { spot: 6000, now: NOW, minDte: 46, maxDte: 180 }).strikes.length, 0, 'nothing that far out here');
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tj-gex-'));
const res = () => { const r = { headers: {}, setHeader: (k, v) => { r.headers[k] = v; }, end: (b) => { r.body = JSON.parse(String(b)); } }; return r; };
const req = (url, method = 'GET', body) => ({ url, method, on(ev, cb) { if (ev === 'data' && body) cb(JSON.stringify(body)); if (ev === 'end') cb(); } });
const occ = (r) => `SPXW${r.exp.slice(2).replace(/-/g, '')}${r.type}${String(Math.round(r.strike * 1000)).padStart(8, '0')}`;
const cboeJson = () => ({ timestamp: '2026-11-18 14:45:00', data: { symbol: '_SPX', current_price: 6000, options: chain().map((r) => ({ option: occ(r), open_interest: r.oi, iv: r.iv, gamma: r.gamma, delta: 0.5 })) } });

test('the page’s report from Cboe: expirations, levels, vanna/charm, futures prices, and levels kept for the charts', async () => {
  const dir = tmp(); const asked = [];
  const fetchImpl = async (url) => { asked.push(url); return { ok: true, status: 200, text: async () => JSON.stringify(url.includes('_SPX') ? cboeJson() : {}) }; };
  const h = createGexHandler(dir, { fetchImpl, now: () => NOW, futuresAt: async (fut) => (fut === 'ES' ? { price: 6030, at: NOW } : null) });
  const e = res(); await h(req('/api/macro/gex/expirations?symbol=SPX'), e);
  assert.deepEqual(e.body.expirations, [EXP, EXP2]);
  assert.ok(asked[0].endsWith('/_SPX.json'), 'indices are "_SPX" at Cboe');
  const r = res(); await h(req(`/api/macro/gex?symbol=SPX&exp=${EXP}`), r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const b = r.body;
  assert.equal(b.source, 'cboe'); assert.equal(b.delayed, true);
  assert.equal(b.spot, 6000); assert.deepEqual(b.exps, [EXP]);
  assert.equal(b.callWall, 6100); assert.equal(b.putWall, 5900);
  assert.ok(b.near.strikes.length && b.regime);
  assert.equal(b.fut.fut, 'ES'); assert.ok(Math.abs(b.fut.ratio - 1.005) < 1e-9);
  assert.equal(asked.length, 1, 'the chain is fetched once and kept');
  // the nearest expiration's levels are kept, in ES prices for the charts
  const l = res(); await h(req('/api/macro/gex/levels?fut=MES&date=2026-11-18'), l);
  assert.equal(l.body.levels.length, 1);
  assert.equal(l.body.levels[0].callWall, Math.round(6100 * 1.005 * 4) / 4);
  assert.equal(l.body.levels[0].putWall, Math.round(5900 * 1.005 * 4) / 4);
  // another expiration choice isn't what the indicator shows: not kept
  const r2 = res(); await h(req(`/api/macro/gex?symbol=SPX&exp=${EXP},${EXP2}`), r2);
  const l2 = res(); await h(req('/api/macro/gex/levels?fut=ES&date=2026-11-18'), l2);
  assert.equal(l2.body.levels.length, 1);
});

test('Tradier (real time) for the GEX chart, Cboe still for vanna/charm; a failing source says why and falls back', async () => {
  const dir = tmp();
  const vault = new Map([['gex:tradier', 'tok']]);
  const asked = [];
  const rows = chain().filter((r) => r.exp === EXP);
  const fetchImpl = async (url, opts) => {
    asked.push([url, opts?.headers?.Authorization]);
    let j = {};
    if (url.includes('cboe')) j = cboeJson();
    else if (url.includes('/markets/quotes')) j = { quotes: { quote: { symbol: 'SPX', last: 6001 } } };
    else if (url.includes('/markets/options/chains')) j = { options: { option: rows.map((r) => ({ strike: r.strike, option_type: r.type === 'C' ? 'call' : 'put', open_interest: r.oi, expiration_date: r.exp, contract_size: 100, greeks: { gamma: r.gamma, mid_iv: r.iv } })) } };
    return { ok: true, status: 200, text: async () => JSON.stringify(j) };
  };
  const h = createGexHandler(dir, { fetchImpl, now: () => NOW, vault: { get: (k) => vault.get(k), set: (k, v) => vault.set(k, v) } });
  const c = res(); await h(req('/api/macro/gex/config', 'POST', { source: 'tradier' }), c);
  assert.equal(c.body.source, 'tradier'); assert.equal(c.body.sources.tradier, true);
  const r = res(); await h(req(`/api/macro/gex?symbol=SPX&exp=${EXP}`), r);
  assert.equal(r.body.source, 'tradier'); assert.equal(r.body.delayed, false); assert.equal(r.body.spot, 6001);
  assert.ok(asked.some(([u, a]) => u.startsWith('https://api.tradier.com/v1/markets/options/chains?symbol=SPX&expiration=2026-11-18&greeks=true') && a === 'Bearer tok'));
  assert.ok(r.body.near, 'vanna/charm from Cboe');
  // Polygon chosen without a key: the reason, and the free data meanwhile
  await h(req('/api/macro/gex/config', 'POST', { source: 'polygon' }), res());
  const p = res(); await h(req(`/api/macro/gex?symbol=SPX&exp=${EXP}`), p);
  assert.equal(p.body.source, 'cboe');
  assert.match(p.body.liveError, /Polygon key/);
});

test('Polygon snapshot pages are followed (indices as I:SPX)', async () => {
  const dir = tmp();
  const rows = chain().filter((r) => r.exp === EXP);
  const half = Math.ceil(rows.length / 2);
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    let j = {};
    const item = (r) => ({ details: { contract_type: r.type === 'C' ? 'call' : 'put', strike_price: r.strike, expiration_date: r.exp, shares_per_contract: 100 }, greeks: { gamma: r.gamma }, implied_volatility: r.iv, open_interest: r.oi, underlying_asset: { price: 5999.5 } });
    if (url.includes('cboe')) j = cboeJson();
    else if (url.includes('cursor=2')) j = { results: rows.slice(half).map(item) };
    else if (url.includes('api.polygon.io')) j = { results: rows.slice(0, half).map(item), next_url: 'https://api.polygon.io/v3/snapshot/options/I:SPX?cursor=2' };
    return { ok: true, status: 200, text: async () => JSON.stringify(j) };
  };
  const h = createGexHandler(dir, { fetchImpl, now: () => NOW, vault: { get: (k) => (k === 'price:polygon' ? 'pk' : null), set() {} } });
  await h(req('/api/macro/gex/config', 'POST', { source: 'polygon' }), res());
  const r = res(); await h(req(`/api/macro/gex?symbol=SPX&exp=${EXP}`), r);
  assert.equal(r.body.source, 'polygon'); assert.equal(r.body.spot, 5999.5);
  assert.equal(r.body.strikes.length, rows.length / 2);
  assert.ok(asked.some((u) => u.includes('/v3/snapshot/options/I%3ASPX?expiration_date=2026-11-18')));
  assert.ok(asked.some((u) => u.includes('cursor=2&apiKey=pk')));
});

test('Cboe’s timestamp is UTC (it doesn’t say so)', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(cboeJson()) });
  const h = createGexHandler(tmp(), { fetchImpl, now: () => NOW });
  const r = res(); await h(req(`/api/macro/gex?symbol=SPX&exp=${EXP}`), r);
  assert.equal(new Date(r.body.at).toISOString(), '2026-11-18T14:45:00.000Z');
});

test('after the cash close the index sits at its close, so futures are converted at the close and price now comes from the futures', async () => {
  const dir = tmp();
  const close = Date.parse('2026-11-18T21:00:00Z'); // 4:00 PM New York
  const late = Date.parse('2026-11-18T23:50:00Z');
  const json = { ...cboeJson(), timestamp: '2026-11-18 21:15:00' };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });
  const futuresAt = async (fut, at) => (at <= close ? { price: 6030, at: close - 60e3 } : { price: 6090, at: late - 60e3 });
  const h = createGexHandler(dir, { fetchImpl, now: () => late, futuresAt });
  const r = res(); await h(req('/api/macro/gex?symbol=SPX&exp=2026-11-19'), r);
  const b = r.body;
  assert.equal(b.cashOpen, false); assert.equal(b.closeAt, close);
  assert.ok(Math.abs(b.fut.ratio - 1.005) < 1e-9, `ratio from the close, not from after-hours futures: ${b.fut.ratio}`);
  assert.equal(b.fut.atClose, true);
  assert.ok(Math.abs(b.implied.spot - 6090 / 1.005) < 1e-6); assert.equal(b.implied.fut, 6090);
});

test('market holidays and early closes: before Friday’s open after Thanksgiving, futures are matched at Wednesday’s close', async () => {
  const wedClose = Date.parse('2026-11-25T21:00:00Z'); // Wed 4:00 PM New York (Thursday was Thanksgiving)
  const friPre = Date.parse('2026-11-27T14:26:00Z');   // Fri 9:26 AM, before the open
  const asked = [];
  const futuresAt = async (fut, at) => { asked.push(at); return at === wedClose ? { price: 6030, at: wedClose - 60e3 } : { price: 6090, at: friPre - 60e3 }; };
  const json = { ...cboeJson(), timestamp: '2026-11-27 14:26:00' };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });
  const h = createGexHandler(tmp(), { fetchImpl, now: () => friPre, futuresAt });
  const r = res(); await h(req('/api/macro/gex?symbol=SPX&exp=2026-11-27'), r);
  assert.equal(r.body.cashOpen, false);
  assert.equal(r.body.closeAt, wedClose, 'not Thursday (closed)');
  assert.ok(r.body.fut && r.body.fut.atClose, 'converted at the close');
  // after Friday's 1:00 PM early close, the close is 1:00 PM — not 4:00 PM
  const friLate = Date.parse('2026-11-27T19:30:00Z'); // 2:30 PM New York
  const json2 = { ...cboeJson(), timestamp: '2026-11-27 19:30:00' };
  const h2 = createGexHandler(tmp(), { fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(json2) }), now: () => friLate, futuresAt: async () => null });
  const r2 = res(); await h2(req('/api/macro/gex?symbol=SPX&exp=2026-11-30'), r2);
  assert.equal(r2.body.cashOpen, false);
  assert.equal(new Date(r2.body.closeAt).toISOString(), '2026-11-27T18:00:00.000Z', '1:00 PM EST');
});

test('right after the open Cboe lists options without Greeks: the last good chain stays up, marked as waiting', async () => {
  let t = NOW, bare = false;
  const noGreeks = () => { const j = cboeJson(); j.data.options = j.data.options.map((o) => ({ ...o, iv: 0, gamma: 0 })); return j; };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(bare ? noGreeks() : cboeJson()) });
  const h = createGexHandler(tmp(), { fetchImpl, now: () => t });
  const r1 = res(); await h(req(`/api/macro/gex?symbol=SPX&exp=${EXP}`), r1);
  assert.ok(r1.body.total !== 0 && !r1.body.waiting);
  bare = true; t += 5 * 60e3;
  const r2 = res(); await h(req(`/api/macro/gex?symbol=SPX&exp=${EXP}`), r2);
  assert.equal(r2.body.waiting, true);
  assert.equal(r2.body.callWall, r1.body.callWall, 'still the last good numbers');
  // a fresh start with only bare data: a clear message instead of an empty chart
  const h2 = createGexHandler(tmp(), { fetchImpl, now: () => t });
  const r3 = res(); await h2(req(`/api/macro/gex?symbol=SPX&exp=${EXP}`), r3);
  assert.match(JSON.stringify(r3.body), /no volatility or Greeks yet/);
});

test('no ES bars (you didn’t trade ES that day): the add-on is asked for them', async () => {
  const asked = [];
  const candles = { get: async () => ({ candles: [], interval: '1m' }), requestDay: (...a) => asked.push(a) };
  assert.equal(await futuresFromCandles(candles)('ES', NOW), null);
  assert.deepEqual(asked, [['ES', '2026-11-18', 'America/New_York']]);
  const have = { get: async () => ({ candles: [[NOW / 1000 - 60, 1, 1, 1, 6030]], interval: '1m' }), requestDay: (...a) => asked.push(a) };
  assert.equal((await futuresFromCandles(have)('ES', NOW)).price, 6030);
  assert.equal(asked.length, 1);
});

test('Cboe is asked at its new address, the way its own quote pages ask', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push({ url, h: opts.headers }); return { ok: true, status: 200, text: async () => JSON.stringify(cboeJson()) }; };
  const h = createGexHandler(tmp(), { fetchImpl, now: () => NOW, futuresAt: async () => null });
  const r = res(); await h(req('/api/macro/gex?symbol=SPX&exp=2026-11-19'), r);
  assert.ok(r.body.spot > 0);
  assert.match(seen[0].url, /^https:\/\/cdn-api\.cboe\.com\/api\/global\/delayed_quotes\/options\/_SPX\.json$/);
  assert.equal(seen[0].h.Origin, 'https://www.cboe.com');
  assert.match(seen[0].h.Referer, /^https:\/\/www\.cboe\.com/);
});
