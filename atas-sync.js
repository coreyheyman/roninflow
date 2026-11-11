// Local receiver for the "RoninFlow Sync" ATAS add-on.
// Runs inside the Vite dev/preview server (see vite.config.js) and stores everything in
// data/atas-sync/atas.json so trades are kept even while the browser tab is closed.
//
//   POST /api/atas/trades     { trades: [...], snapshot?: bool }   ← from ATAS
//   POST /api/atas/heartbeat  { version, accounts, trades }         ← from ATAS
//   GET  /api/atas/changes?since=<seq>                             ← from the app
//   GET  /api/atas/status
import fs from 'node:fs';
import path from 'node:path';

export function createAtasHandler(dir = path.resolve('data', 'atas-sync')) {
  const file = path.join(dir, 'atas.json');
  let db = { seq: 0, trades: {}, heartbeat: null, received: 0 };
  try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }

  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file + '.tmp', JSON.stringify(db));
        fs.renameSync(file + '.tmp', file);
      } catch (e) { console.error('[atas-sync] could not save', e.message); }
    }, 300);
  };

  const send = (res, code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify(obj));
  };
  const body = (req) => new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { s += c; if (s.length > 50e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
  const same = (a, b) => ['account', 'security', 'openTime', 'closeTime', 'openPrice', 'closePrice', 'openVolume', 'pnl', 'commission', 'comment'].every((k) => String(a[k] ?? '') === String(b[k] ?? ''));

  return async function atasHandler(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname.replace(/^\/api\/atas/, '').replace(/\/$/, '') || '/';
    try {
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return send(res, 204, {});
      }
      if (req.method === 'POST' && route === '/trades') {
        const b = await body(req);
        let added = 0, updated = 0;
        for (const t of b.trades || []) {
          if (t == null || t.id === undefined || t.id === null) continue;
          const id = String(t.id);
          const prev = db.trades[id];
          if (prev && same(prev, t)) continue;
          db.trades[id] = { ...t, id, seq: ++db.seq, receivedAt: new Date().toISOString() };
          prev ? updated++ : added++;
        }
        db.received += (b.trades || []).length;
        db.lastPost = new Date().toISOString();
        if (added || updated) save();
        if (added || updated) console.log(`[atas-sync] +${added} new, ${updated} updated (${Object.keys(db.trades).length} stored)`);
        return send(res, 200, { ok: true, added, updated, stored: Object.keys(db.trades).length });
      }
      if (req.method === 'POST' && route === '/heartbeat') {
        const b = await body(req);
        db.heartbeat = { ...b, at: new Date().toISOString() };
        save();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && route === '/changes') {
        const asked = Number(url.searchParams.get('since') || 0);
        const since = asked > db.seq ? 0 : asked; // receiver was reset → start over
        const trades = Object.values(db.trades).filter((t) => t.seq > since).sort((a, b) => a.seq - b.seq).slice(0, 2000);
        return send(res, 200, { seq: trades.length ? trades[trades.length - 1].seq : since, reset: asked > db.seq, latest: db.seq, more: trades.length === 2000, trades, heartbeat: db.heartbeat, serverTime: new Date().toISOString() });
      }
      if (req.method === 'GET' && route === '/status') {
        return send(res, 200, { ok: true, stored: Object.keys(db.trades).length, seq: db.seq, heartbeat: db.heartbeat, lastPost: db.lastPost || null, serverTime: new Date().toISOString() });
      }
      if (req.method === 'POST' && route === '/reset') {
        db = { seq: 0, trades: {}, heartbeat: db.heartbeat, received: 0 };
        save();
        return send(res, 200, { ok: true });
      }
      return next ? next() : send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  };
}

/** Vite plugin: mounts the receiver on the dev and preview servers. */
export default function atasSync() {
  // Must not return anything: Vite treats a returned function as a post-middleware hook and calls it.
  const handler = createAtasHandler();
  const mount = (server) => { server.middlewares.use('/api/atas', handler); };
  return { name: 'iq-atas-sync', configureServer: mount, configurePreviewServer: mount };
}
