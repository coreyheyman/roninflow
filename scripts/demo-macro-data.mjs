// Snapshot of real macro data for the public demo site (which has no server): every FRED / New York Fed series the
// Macro pages use, the economic calendar (ForexFactory + TradingView actuals) and the CFTC COT report — written as
// static JSON next to the demo, refreshed each time the demo site is rebuilt (on push and on a schedule).
//   node scripts/demo-macro-data.mjs public/demo-data
// Anything that fails is skipped; the demo falls back to sample data for it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SERIES } from '../src/lib/fredSeries.js';
import { parseFredCsv, parsePd } from '../fred.js';
import { createMacroHandler } from '../macro.js';

const out = path.resolve(process.argv[2] || 'public/demo-data');
const UA = 'Mozilla/5.0 (RoninFlow demo snapshot; +https://github.com/coreyheyman/roninflow)';
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const write = (rel, obj) => { const f = path.join(out, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, accept) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.text();
      if (r.status < 500 && r.status !== 429 && r.status !== 403) throw new Error(`HTTP ${r.status}`);
      if (attempt === 4) throw new Error(`HTTP ${r.status}`);
      await sleep(r.status === 403 || r.status === 429 ? 30000 * (attempt + 1) : 2000 * (attempt + 1)); // FRED's rate limit: wait it out
      continue;
    } catch (e) { if (attempt === 4 || /^HTTP 4/.test(e.message)) throw e; }
    await sleep(2000 * (attempt + 1));
  }
  throw new Error('gave up');
}

async function series() {
  const ids = Object.entries(SERIES).filter(([, d]) => !d.derive).map(([id]) => id);
  const ok = [], failed = [];
  const keepFrom = iso(Date.now() - 12 * 366 * DAY); // enough for the 10Y range and year-on-year maths
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      try {
        const pd = SERIES[id].src === 'pd';
        const obs = pd
          ? parsePd(JSON.parse(await get(`https://markets.newyorkfed.org/api/pd/get/${encodeURIComponent(id)}.json`, 'application/json')), id)
          : parseFredCsv(await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, 'text/csv'));
        if (!obs.length) throw new Error('no observations');
        await sleep(400); // stay under FRED's request rate
        write(`fred/${id}.json`, { obs: obs.filter((r) => r[0] >= keepFrom), at: Date.now() });
        ok.push(id);
      } catch (e) { failed.push(`${id} (${e.message})`); }
    }
  };
  await Promise.all([worker(), worker()]);
  write('fred/index.json', { at: Date.now(), ids: ok.sort() });
  console.log(`series: ${ok.length} saved${failed.length ? `, ${failed.length} failed: ${failed.join(', ')}` : ''}`);
}

/** call one of the Macro handler's routes the way the server would */
const call = (h, url) => new Promise((resolve) => {
  const res = { statusCode: 200, setHeader() {}, end(b) { try { resolve({ code: res.statusCode, body: JSON.parse(b) }); } catch { resolve({ code: res.statusCode, body: null }); } } };
  h({ method: 'GET', url, on() {} }, res);
});
async function settle(h, url, tries = 18) {
  let r;
  for (let k = 0; k < tries; k++) { r = await call(h, url); if (!r.body?.refreshing) break; await sleep(5000); }
  return r;
}

async function calendarAndCot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-demo-macro-'));
  const h = createMacroHandler(tmp, { log: (...a) => console.log('  ', ...a) });
  try {
    const from = iso(Date.now() - 60 * DAY), to = iso(Date.now() + 30 * DAY);
    const r = await settle(h, `/api/macro/calendar?from=${from}&to=${to}`);
    if (r.body?.events?.length >= 80) { write('calendar.json', { ...r.body, from, to, snapshotAt: Date.now(), refreshing: false }); console.log(`calendar: ${r.body.events.length} events`); }
    else console.log('calendar: too little to save (ForexFactory / TradingView unreachable?)', r.body?.error || '');
  } catch (e) { console.log('calendar failed:', e.message); }
  try {
    await h.refreshCot().catch(() => {});
    const r = await settle(h, '/api/macro/cot');
    if (r.body?.markets?.length) { write('cot.json', { ...r.body, refreshing: false }); console.log(`cot: ${r.body.markets.length} markets`); }
    const m = await call(h, '/api/macro/cot/markets');
    if (m.body?.markets?.length) write('cot-markets.json', m.body);
  } catch (e) { console.log('cot failed:', e.message); }
}

fs.mkdirSync(out, { recursive: true });
await series();
await calendarAndCot();
write('index.json', { at: Date.now() });
process.exit(0); // the Macro handler's timers would otherwise keep Node running
