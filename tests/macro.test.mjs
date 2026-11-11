import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFF, parseTV, tvValue, matchEvents, mergeWeek, scheduleEvents, mergeCot, nextCotRelease, nyTime, createMacroHandler, COT_MARKETS } from '../macro.js';
import { parseValue, surprise, cotStats, countdown } from '../src/lib/macroMath.js';

const ff = (date, title, extra = {}) => ({ title, country: 'USD', date, impact: 'High', forecast: '0.3%', previous: '0.2%', actual: '', ...extra });

test('ForexFactory rows become events (UTC instants, impact, blanks → null)', () => {
  const [e, h] = parseFF([ff('2026-11-12T08:30:00-05:00', 'CPI m/m', { actual: '0.4%' }), ff('2026-11-26T00:00:00-05:00', 'Bank Holiday', { impact: 'Holiday', forecast: '', previous: '' }), { title: 'broken', date: 'nope' }]);
  assert.equal(e.t, '2026-11-12T13:30:00.000Z');
  assert.equal(e.impact, 'high');
  assert.equal(e.actual, '0.4%');
  assert.equal(h.allDay, true);
  assert.equal(h.forecast, null);
});

test('a fetched week replaces the days it covers and keeps other weeks', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  let store = mergeWeek({ events: [], covered: [] }, parseFF([ff('2026-11-03T08:30:00-05:00', 'Old week'), ff('2026-11-12T08:30:00-05:00', 'CPI m/m')]), now);
  // the same week again, CPI moved to 10:00 and a new event added
  store = mergeWeek(store, parseFF([ff('2026-11-12T10:00:00-05:00', 'CPI m/m'), ff('2026-11-13T08:30:00-05:00', 'PPI m/m')]), now);
  const titles = store.events.map((e) => `${e.title}@${e.t}`);
  assert.deepEqual(titles, ['Old week@2026-11-03T13:30:00.000Z', 'CPI m/m@2026-11-12T15:00:00.000Z', 'PPI m/m@2026-11-13T13:30:00.000Z']);
  assert.ok(store.covered.length >= 1);
});

test('official US dates fill weeks ForexFactory hasn’t published, and step aside where it has', () => {
  const from = Date.parse('2026-12-01T00:00:00Z'), to = Date.parse('2026-12-31T00:00:00Z');
  const all = scheduleEvents(from, to);
  const names = all.map((e) => `${e.t.slice(0, 10)} ${e.title}`);
  assert.ok(names.includes('2026-12-04 Non-Farm Payrolls (Employment Situation)'));
  assert.ok(names.includes('2026-12-09 FOMC Rate Decision'));
  assert.ok(names.includes('2026-12-09 FOMC Press Conference'));
  const fomc = all.find((e) => e.title === 'FOMC Rate Decision');
  assert.equal(fomc.t, '2026-12-09T19:00:00.000Z'); // 2 PM Eastern (standard time)
  const covered = [[Date.parse('2026-12-06T05:00:00Z'), Date.parse('2026-12-13T04:59:00Z')]];
  assert.ok(!scheduleEvents(from, to, covered).some((e) => e.title.startsWith('FOMC')));
  assert.ok(scheduleEvents(from, to, covered).some((e) => e.title.startsWith('Non-Farm')));
});

test('New York wall clock handles both sides of the DST change', () => {
  assert.equal(new Date(nyTime('2026-07-15', '08:30')).toISOString(), '2026-07-15T12:30:00.000Z');
  assert.equal(new Date(nyTime('2026-12-15', '08:30')).toISOString(), '2026-12-15T13:30:00.000Z');
});

const cotRow = (code, date, ncL, ncS, extra = {}) => ({ report_date_as_yyyy_mm_dd: `${date}T00:00:00.000`, cftc_contract_market_code: code, market_and_exchange_names: 'GOLD - COMMODITY EXCHANGE INC.', open_interest_all: '500000', noncomm_positions_long_all: String(ncL), noncomm_positions_short_all: String(ncS), comm_positions_long_all: '100000', comm_positions_short_all: '300000', nonrept_positions_long_all: '40000', nonrept_positions_short_all: '30000', ...extra });

test('CFTC rows merge by market and date (revisions replace)', () => {
  let m = mergeCot({}, [cotRow('088691', '2026-10-27', 250000, 50000), cotRow('088691', '2026-11-03', 260000, 40000)]);
  m = mergeCot(m, [cotRow('088691', '2026-11-03', 261000, 40000)]);
  assert.equal(m['088691'].rows.length, 2);
  assert.deepEqual(m['088691'].rows[1], ['2026-11-03', 500000, 261000, 40000, 100000, 300000, 40000, 30000]);
  assert.equal(m['088691'].name, 'GOLD - COMMODITY EXCHANGE INC.');
});

test('next COT release is the Friday after next Tuesday, 3:45 PM ET', () => {
  assert.equal(new Date(nextCotRelease('2026-11-03')).toISOString(), '2026-11-13T20:45:00.000Z');
});

test('COT stats: net, change, % long, index and crowding', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push([`2026-${String(1 + Math.floor(i / 5)).padStart(2, '0')}-0${(i % 5) + 1}`, 1000, 400 + i * 5, 300, 200, 500, 50, 40]);
  const s = cotStats(rows, 52);
  assert.equal(s.spec, 400 + 59 * 5 - 300);
  assert.equal(s.specChg, 5);
  assert.equal(Math.round(s.index), 100);
  assert.equal(s.crowd, 'long');
  assert.equal(s.extreme, 'high');
  assert.equal(s.comm, -300);
});

test('calendar values: parsing and beat / miss', () => {
  assert.equal(parseValue('195K'), 195000);
  assert.equal(parseValue('-0.3%'), -0.3);
  assert.equal(parseValue('1,710K'), 1710000);
  assert.equal(parseValue(''), null);
  assert.equal(surprise({ title: 'CPI m/m', actual: '0.4%', forecast: '0.3%' }), 'beat');
  assert.equal(surprise({ title: 'Unemployment Claims', actual: '230K', forecast: '219K' }), 'miss');
  assert.equal(surprise({ title: 'Unemployment Rate', actual: '4.1%', forecast: '4.3%' }), 'beat');
  assert.equal(surprise({ title: 'X', actual: null, forecast: '1' }), null);
  assert.equal(countdown(90 * 60000), 'in 1h 30m');
});

// ---------- the handler, with ForexFactory and the CFTC mocked ----------
function mockRes() {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
    resolve.res = res;
    mockRes.last = res;
  });
}
async function call(h, url, method = 'GET', body) {
  const p = mockRes();
  const res = mockRes.last;
  const req = { url, method, on(ev, fn) { if (ev === 'data' && body) fn(JSON.stringify(body)); if (ev === 'end') fn(); } };
  h(req, res);
  return p;
}
const reply = (status, body, type = 'application/json') => ({ ok: status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), headers: new Map([['content-type', type]]) });

const tvRow = (date, country, title, o = {}) => ({ id: `${date}${title}`, date, country, currency: { US: 'USD', DE: 'EUR', GB: 'GBP' }[country], title, importance: 1, actual: null, forecast: null, previous: null, unit: '', scale: '', ...o });

test('TradingView values and impact', () => {
  assert.equal(tvValue(195, { scale: 'K' }), '195K');
  assert.equal(tvValue(0.3, { unit: '%' }), '0.3%');
  assert.equal(tvValue(-1.2346, { scale: 'M' }), '-1.235M');
  assert.equal(tvValue(null), null);
  const [e] = parseTV([tvRow('2026-11-12T13:30:00.000Z', 'US', 'Initial Jobless Claims', { actual: 230, forecast: 219, previous: 221, scale: 'K', importance: 0 })]);
  assert.equal(e.ccy, 'USD');
  assert.equal(e.actual, '230K');
  assert.equal(e.impact, 'medium');
});

test('actuals are matched to the right ForexFactory event even when several print at once', () => {
  const ff = parseFF([
    ff_('2026-11-10T08:30:00-05:00', 'CPI m/m', '0.3%', '0.2%'),
    ff_('2026-11-10T08:30:00-05:00', 'Core CPI m/m', '0.3%', '0.3%'),
    ff_('2026-11-10T08:30:00-05:00', 'CPI y/y', '2.9%', '3.0%'),
    ff_('2026-11-12T08:30:00-05:00', 'Unemployment Claims', '219K', '221K'),
    { ...ff_('2026-11-11T02:00:00-05:00', 'German Final CPI m/m', '-0.2%', '-0.2%'), country: 'EUR' },
  ]);
  const tv = parseTV([
    tvRow('2026-11-10T13:30:00.000Z', 'US', 'Core Inflation Rate MoM', { actual: 0.4, forecast: 0.3, previous: 0.3, unit: '%' }),
    tvRow('2026-11-10T13:30:00.000Z', 'US', 'Inflation Rate MoM', { actual: 0.2, forecast: 0.3, previous: 0.2, unit: '%' }),
    tvRow('2026-11-10T13:30:00.000Z', 'US', 'Inflation Rate YoY', { actual: 2.8, forecast: 2.9, previous: 3.0, unit: '%' }),
    tvRow('2026-11-10T13:30:00.000Z', 'US', 'CPI', { actual: 324.1, previous: 323.4 }),
    tvRow('2026-11-12T13:30:00.000Z', 'US', 'Initial Jobless Claims', { actual: 230, forecast: 219, previous: 221, scale: 'K' }),
    tvRow('2026-11-12T13:30:00.000Z', 'US', 'Continuing Jobless Claims', { actual: 1710, previous: 1718, scale: 'K' }),
    tvRow('2026-11-11T07:00:00.000Z', 'DE', 'Inflation Rate MoM Final', { actual: -0.2, forecast: -0.2, previous: -0.2, unit: '%' }),
  ]);
  const m = matchEvents(ff, tv);
  const act = Object.fromEntries(ff.map((e) => [e.title, m.get(e.id)?.actual]));
  assert.deepEqual(act, { 'CPI m/m': '0.2%', 'Core CPI m/m': '0.4%', 'CPI y/y': '2.8%', 'Unemployment Claims': '230K', 'German Final CPI m/m': '-0.2%' });
});
function ff_(date, title, forecast, previous) { return { title, country: 'USD', date, impact: 'High', forecast, previous }; }

test('calendar: first visit waits for the feeds, fills actuals from TradingView and its later weeks, and keeps a copy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-macro-'));
  const calls = [];
  const now = () => Date.parse('2026-11-13T16:00:00Z');
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    if (url.endsWith('thisweek.json')) return reply(200, [ff('2026-11-12T08:30:00-05:00', 'Unemployment Claims', { forecast: '219K', previous: '221K' }), ff('2026-11-13T08:30:00-05:00', 'PPI m/m', { country: 'USD' })]);
    if (url.endsWith('nextweek.json')) return reply(404, 'not found', 'text/plain');
    if (url.startsWith('https://economic-calendar.tradingview.com/events')) {
      assert.equal(opts.headers.Origin, 'https://www.tradingview.com');
      const q = new URL(url).searchParams;
      const from = Date.parse(q.get('from')), to = Date.parse(q.get('to'));
      const rows = [
        tvRow('2026-11-12T13:30:00.000Z', 'US', 'Initial Jobless Claims', { actual: 230, forecast: 219, previous: 221, scale: 'K' }),
        tvRow('2026-12-09T19:00:00.000Z', 'US', 'Fed Interest Rate Decision', { forecast: 3.75, previous: 4, unit: '%', period: 'Dec' }),
      ].filter((r) => Date.parse(r.date) >= from && Date.parse(r.date) <= to);
      return reply(200, { status: 'ok', result: rows });
    }
    throw new Error('unexpected ' + url);
  };
  const h = createMacroHandler(dir, { fetchImpl, now });
  const r = await call(h, '/api/macro/calendar?from=2026-11-08&to=2026-12-12');
  assert.equal(r.status, 200);
  const claims = r.body.events.find((e) => e.title === 'Unemployment Claims');
  assert.equal(claims.src, 'ff');
  assert.equal(claims.actual, '230K', 'actual from TradingView');
  assert.equal(r.body.events.filter((e) => e.title.includes('Claims')).length, 1, 'no duplicate inside ForexFactory’s week');
  const fed = r.body.events.find((e) => e.title === 'Fed Interest Rate Decision (Dec)');
  assert.ok(fed && fed.src === 'tv' && fed.forecast === '3.75%', 'December from TradingView');
  assert.ok(!r.body.events.some((e) => e.src === 'schedule'), 'official dates not needed when TradingView has the days');
  assert.equal(r.body.extended, true);
  assert.equal(r.body.error, null);
  const n = calls.length;
  await call(h, '/api/macro/calendar?from=2026-11-08&to=2026-11-14');
  assert.equal(calls.length, n, 'fresh: nothing fetched again');
  // a new process reads the saved copies; the matched actual was kept for history
  const h2 = createMacroHandler(dir, { fetchImpl: async () => { throw new Error('offline'); }, now });
  const hist = await call(h2, '/api/macro/calendar/history?ccy=USD&title=Unemployment%20Claims');
  assert.equal(hist.body.events[0].actual, '230K');
  // TradingView switched off: ForexFactory + official dates only
  const r3 = await call(h2, '/api/macro/calendar?from=2026-11-08&to=2026-12-12&tv=0');
  assert.ok(r3.body.events.some((e) => e.title === 'FOMC Rate Decision' && e.t.startsWith('2026-12-09')));
  assert.ok(!r3.body.events.some((e) => e.src === 'tv'));
});

test('calendar: a rate-limit page is reported, the saved copy stays', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-macro-'));
  const h = createMacroHandler(dir, { fetchImpl: async () => reply(200, '<!DOCTYPE html><html>slow down</html>', 'text/html'), now: () => Date.parse('2026-11-11T12:00:00Z') });
  const r = await call(h, '/api/macro/calendar?from=2026-11-08&to=2026-11-14');
  assert.match(r.body.error, /slow down/);
  assert.ok(Array.isArray(r.body.events));
});

test('COT: three years for new markets, picks the code that is still published, falls back when $select is refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-macro-'));
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const q = new URL(url).searchParams;
    if (q.has('$select') && urls.length === 1) return reply(400, { message: 'No such column: noncomm_positions_long_all' });
    const where = q.get('$where');
    const rows = [];
    if (where.includes("'088691'")) for (const d of ['2026-10-20', '2026-10-27', '2026-11-03']) rows.push(cotRow('088691', d, 250000, 50000));
    // ES: the old code stopped in 2025, the consolidated one is current
    if (where.includes("'13874A'")) rows.push(cotRow('13874A', '2025-03-04', 1, 2), cotRow('13874+', '2026-11-03', 300000, 400000));
    if (where.includes("'XYZ123'")) rows.push(cotRow('XYZ123', '2026-11-03', 10, 20, { market_and_exchange_names: 'LUMBER - CHICAGO MERCANTILE EXCHANGE' }));
    return reply(200, rows);
  };
  const h = createMacroHandler(dir, { fetchImpl, now: () => Date.parse('2026-11-11T12:00:00Z') });
  const r = await call(h, '/api/macro/cot?extra=XYZ123,bad!!');
  assert.equal(r.status, 200);
  assert.ok(urls[0].includes('%24select') && !urls[1].includes('%24select'), 'retried without $select');
  assert.match(new URL(urls[1]).searchParams.get('$where'), /report_date_as_yyyy_mm_dd >= '2023-/);
  const gc = r.body.markets.find((m) => m.key === 'GC');
  assert.equal(gc.rows.length, 3);
  const es = r.body.markets.find((m) => m.key === 'ES');
  assert.equal(es.code, '13874+');
  const mine = r.body.markets.find((m) => m.extra);
  assert.equal(mine.code, 'XYZ123');
  assert.equal(mine.label, 'LUMBER');
  assert.equal(r.body.reportDate, '2026-11-03');
  assert.equal(r.body.nextRelease, '2026-11-13T20:45:00.000Z');
  assert.ok(COT_MARKETS.length >= 25);
});

test('COT: before the next release nothing is fetched; after it, only the last few weeks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-macro-'));
  let t = Date.parse('2026-11-11T12:00:00Z');
  const urls = [];
  const all = COT_MARKETS.flatMap((m) => m.codes);
  const fetchImpl = async (url) => { urls.push(new URL(url).searchParams.get('$where')); return reply(200, all.map((c) => cotRow(c, '2026-11-03', 1000, 500))); };
  const h = createMacroHandler(dir, { fetchImpl, now: () => t });
  await call(h, '/api/macro/cot');
  const n = urls.length;
  t += 3 * 3600e3;
  await call(h, '/api/macro/cot');
  assert.equal(urls.length, n, 'report not due yet');
  t = Date.parse('2026-11-13T21:00:00Z');
  const r = await call(h, '/api/macro/cot');
  assert.equal(r.body.refreshing, true);
  await new Promise((ok) => setTimeout(ok, 20));
  assert.ok(urls.length > n);
  assert.match(urls[urls.length - 1], /report_date_as_yyyy_mm_dd >= '2026-10-06/);
});
