import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchShot, pickTrade, symbolFits } from '../src/lib/shotMatch.js';
import { createShotsHandler } from '../shots.js';

const T = (s) => new Date(s).getTime(); // local wall clock → epoch (no home time zone set in tests)
const trades = [
  { id: 'a', symbol: 'MES', direction: 'Long', entry: '2026-11-20T07:40:00', exit: '2026-11-20T07:52:00' },
  { id: 'b', symbol: 'NQ', direction: 'Short', entry: '2026-11-20T07:45:00', exit: '2026-11-20T08:05:00' },
  { id: 'c', symbol: 'CL', direction: 'Long', entry: '2026-11-20T09:00:00', exit: '2026-11-20T09:10:00' },
];

test('a screenshot goes on the trade open when it was taken, then the one just closed, else the diary', () => {
  let m = matchShot(T('2026-11-20T07:42:00'), trades);
  assert.equal(m.kind, 'trade'); assert.equal(m.open, true); assert.deepEqual(m.trades.map((t) => t.id), ['a']);
  m = matchShot(T('2026-11-20T07:50:00'), trades); // both open: latest entry first
  assert.deepEqual(m.trades.map((t) => t.id), ['b', 'a']);
  assert.equal(pickTrade(m, '').id, 'b');
  assert.equal(pickTrade(m, 'MES · 1m').id, 'a', 'the instrument read off the picture decides');
  m = matchShot(T('2026-11-20T09:15:00'), trades, { after: 10 });
  assert.equal(m.open, false); assert.equal(m.trades[0].id, 'c');
  assert.equal(matchShot(T('2026-11-20T09:25:00'), trades, { after: 10 }).kind, 'day');
  assert.equal(matchShot(T('2026-11-20T09:25:00'), trades, { after: 10 }).day, '2026-11-20');
  assert.equal(matchShot(T('2026-11-20T08:59:30'), trades).trades[0].id, 'c', 'a minute before the entry counts');
});

test('reading the instrument: front-month codes and micros fit the trade', () => {
  assert.ok(symbolFits('NQZ2026 · 5m', 'NQ'));
  assert.ok(symbolFits('MNQ 1m', 'NQ'));
  assert.ok(symbolFits('ES', 'MES'));
  assert.ok(symbolFits('MESZ6', 'MES'));
  assert.ok(!symbolFits('CL 1m', 'NQ'));
  assert.ok(!symbolFits('', 'NQ'));
});

test('the folder watcher imports new pictures once they finish writing, and only new ones', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-')), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pics-'));
  fs.writeFileSync(path.join(dir, 'old.png'), 'x'.repeat(50));
  let clock = Date.now() - 5000;
  const old = path.join(dir, 'old.png'); const t2 = (clock - 3600e3) / 1000; fs.utimesSync(old, t2, t2); // taken an hour ago
  const h = createShotsHandler(data, { now: () => clock, home: dir });
  const call = (method, url, b) => new Promise((resolve) => {
    const req = { method, url, setEncoding() {}, on(ev, fn) { if (ev === 'data' && b) fn(JSON.stringify(b)); if (ev === 'end') setImmediate(fn); } };
    const res = { setHeader() {}, end(t) { resolve({ status: this.statusCode, body: JSON.parse(t) }); } };
    h(req, res);
  });
  let r = await call('POST', '/api/shots/config', { folder: dir, on: true });
  assert.equal(r.body.on, true);
  fs.mkdirSync(path.join(dir, '2026-11'));
  const f = path.join(dir, '2026-11', 'chart.png');
  fs.writeFileSync(f, 'y'.repeat(100));
  const t = (clock + 1000) / 1000; fs.utimesSync(f, t, t);
  assert.equal(h.scan(), 0, 'first look: wait until the size stops changing');
  assert.equal(h.scan(), 1);
  assert.equal(h.scan(), 0, 'not twice');
  r = await call('GET', '/api/shots/inbox?client=pc');
  assert.equal(r.body.items.length, 1); assert.equal(r.body.items[0].name, 'chart.png');
  assert.ok(fs.existsSync(path.join(data, 'images', `${r.body.items[0].id}.png`)));
  assert.equal((await call('GET', '/api/shots/inbox?client=phone')).body.items.length, 0, 'claimed by the other window');
  await call('POST', '/api/shots/ack', { ids: [r.body.items[0].id] });
  assert.equal((await call('GET', '/api/shots/inbox?client=pc')).body.items.length, 0);
  // the picture from before it was turned on: only with "pick up ones already there"
  r = await call('POST', '/api/shots/backfill', { hours: 24 });
  assert.equal(r.body.added, 1);
  h.stop();
});

import { shotTime } from '../src/lib/shotMatch.js';
test('the time a picture was taken is read from common screenshot file names', () => {
  assert.equal(shotTime('Screenshot 2026-11-20 073800.png', 1), '2026-11-20T07:38:00');
  assert.equal(shotTime('Screenshot 2026-11-20 at 1.05.09 PM.png', 1), '2026-11-20T13:05:09');
  assert.equal(shotTime('MESZ2026_2026-11-20_07-38-12_ab12c.png', 1), '2026-11-20T07:38:12');
  assert.equal(shotTime('chrome_2026-11-20_07-38-00.png', 1), '2026-11-20T07:38:00');
  assert.equal(shotTime('Screenshot_20261120-073800.png', 1), '2026-11-20T07:38:00');
  assert.equal(shotTime('Screenshot 2026-11-20 at 12.10.00 AM.png', 1), '2026-11-20T00:10:00');
  assert.equal(shotTime('chart.png', 12345), 12345, 'no time in the name: the file date');
  assert.equal(shotTime('notes-2026-11-20.png', 777), 777, 'a date without a time is not enough');
});
