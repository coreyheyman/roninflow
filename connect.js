// Connector inbox: one place any platform add-on, script or service can push trades into the journal.
//
//   POST /api/connect/ingest            ← from add-ons / webhooks (token required unless it comes from this PC)
//        { source: "ninjatrader", fills: [...], trades: [...], heartbeat: {...} }
//   GET  /api/connect/changes?since=N    ← from the app: round-trip trades that changed since N
//   GET  /api/connect/status             ← from the app: per-source activity + the token
//   POST /api/connect/token              ← from the app: make a new token (the old one stops working)
//   POST /api/connect/reset?source=x     ← from the app: forget everything received from one source
//
// Fills (single executions) are paired into round-trip trades here, per source + account + contract, using the
// same logic as the file importer (scale-ins, partial exits, reversals). Times must say their zone
// (ISO with Z / ±hh:mm, or epoch milliseconds) and are stored in UTC. Data lives in data/connect.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fillsToTrades, rootSymbol, POINT_VALUES } from './src/lib/pairing.js';
import { API_DEFS as BASE_DEFS, createDropWatcher, newDeviceId } from './connect-apis.js';
import { MARKET_DEFS } from './connect-markets.js';

const API_DEFS = { ...BASE_DEFS, ...MARKET_DEFS };

const MAX_BODY = 20e6;
const SOURCE_RX = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/** Any time the sender gives → UTC ISO, or null when the zone is unknown/invalid. */
export function utcIso(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
    const n = Number(v);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = String(v).trim();
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) return null; // naive times are ambiguous — refuse rather than guess
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : NaN; };
const sideOf = (v, qty) => {
  const s = String(v ?? '').toLowerCase();
  if (/^(buy|b|long|bot|bought)/.test(s)) return 1;
  if (/^(sell|s|short|sld|sold)/.test(s)) return -1;
  return qty < 0 ? -1 : qty > 0 ? 1 : 0;
};

export function createConnectHandler(dataDir, { log = () => {}, vault } = {}) {
  const file = path.join(dataDir, 'connect.json');
  let db = { seq: 0, token: null, sources: {}, fills: {}, trades: {} };
  try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }
  // broker / exchange logins are stored encrypted (secrets.js); older files had them in plain text
  if (db.apisEnc && vault) { try { db.apis = vault.decrypt(db.apisEnc); } catch (e) { log('[connect] could not decrypt saved connections:', e.message); db.apis = {}; } }
  delete db.apisEnc;
  if (!db.token) db.token = crypto.randomBytes(24).toString('base64url');

  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        const out = vault ? { ...db, apis: undefined, apisEnc: vault.encrypt(db.apis || {}) } : db;
        fs.writeFileSync(file + '.tmp', JSON.stringify(out), { mode: 0o600 });
        fs.renameSync(file + '.tmp', file);
      } catch (e) { log('[connect] could not save', e.message); }
    }, 250);
  };
  save();

  const send = (res, code, obj) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { s += c; if (s.length > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('Body must be JSON')); } });
    req.on('error', reject);
  });
  const tokenOf = (req, url) => {
    const h = String(req.headers.authorization || '');
    return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : (req.headers['x-journal-token'] || url.searchParams.get('token') || '');
  };
  const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const touch = (source, patch = {}) => {
    const s = db.sources[source] || (db.sources[source] = { firstSeen: new Date().toISOString(), fills: 0, trades: 0, posts: 0 });
    Object.assign(s, patch, { lastSeen: new Date().toISOString() });
    return s;
  };

  /** Re-pair every stored fill for one source + account + contract into trades (stable ids). */
  function repair(source, account, contract) {
    const key = `${source}|${account}|${contract}`;
    const list = Object.values(db.fills).filter((f) => f.group === key);
    const { trades, open } = fillsToTrades(list.map((f, row) => ({
      row, id: f.id, account, contract, root: f.root, time: f.time, side: f.side, qty: f.qty, price: f.price, commission: f.commission, spot: f.spot, closes: f.closes,
    })));
    const seen = new Set();
    for (const t of trades) {
      const id = `${source}|${account}|${contract}|${t.entry}`;
      seen.add(id);
      const pv = list.find((f) => f.pointValue)?.pointValue || POINT_VALUES[t.symbol];
      const gross = pv ? (t.exitPrice - t.entryPrice) * (t.direction === 'Long' ? 1 : -1) * pv * t.qty : NaN;
      const rec = {
        id, source, kind: 'trade', account, contract, symbol: t.symbol, direction: t.direction, qty: t.qty,
        entry: t.entry, exit: t.exit, entryPrice: t.entryPrice, exitPrice: t.exitPrice, fees: t.fees, fills: t.fills,
        pnl: Number.isFinite(gross) ? Math.round((gross - t.fees) * 100) / 100 : null, needsMultiplier: !pv,
      };
      const prev = db.trades[id];
      const same = prev && !prev.removed && ['qty', 'exit', 'entryPrice', 'exitPrice', 'fees', 'pnl', 'fills'].every((k) => prev[k] === rec[k]);
      if (!same) db.trades[id] = { ...rec, seq: ++db.seq };
    }
    // trades that no longer exist (an earlier fill arrived late and changed the pairing)
    for (const [id, t] of Object.entries(db.trades)) {
      if (t.source === source && t.account === account && t.contract === contract && t.kind === 'trade' && !t.direct && !seen.has(id) && !t.removed) {
        db.trades[id] = { id, source, account, contract, removed: true, seq: ++db.seq };
      }
    }
    return open.length;
  }

  function ingest(body, defaultSource) {
    const source = String(body.source || defaultSource || 'webhook').toLowerCase();
    if (!SOURCE_RX.test(source)) throw new Error('source must be a short name like "ninjatrader"');
    const result = { source, fills: 0, trades: 0, duplicates: 0, rejected: [] };
    const groups = new Set();
    const fills = Array.isArray(body) ? body : body.fills || body.executions || (body.price != null && body.side != null ? [body] : []);
    fills.forEach((f, i) => {
      const time = utcIso(f.time ?? f.timestamp ?? f.filledAt);
      const contract = String(f.symbol ?? f.contract ?? f.instrument ?? '').trim();
      const rawQty = num(f.qty ?? f.quantity ?? f.size);
      const price = num(f.price ?? f.fillPrice);
      const side = sideOf(f.side ?? f.action, rawQty);
      const account = String(f.account ?? body.account ?? 'Default').trim();
      if (!time || !contract || !Number.isFinite(price) || !rawQty || !side) { result.rejected.push({ index: i, kind: 'fill', reason: !time ? 'time needs a timezone (ISO with Z/offset, or epoch ms)' : 'needs symbol, side, qty and price' }); return; }
      const id = `${source}|${f.id ?? f.fillId ?? f.execId ?? `${account}|${contract}|${time}|${side}|${Math.abs(rawQty)}|${price}`}`;
      const group = `${source}|${account}|${contract}`;
      const rec = { id, group, account, contract, root: rootSymbol(contract), time, side, qty: Math.abs(rawQty), price, commission: Math.abs(num(f.commission ?? f.fee ?? f.fees)) || 0, pointValue: num(f.pointValue ?? f.multiplier) || undefined, spot: f.spot === true || undefined, closes: num(f.closes) > 0 ? num(f.closes) : undefined };
      const prev = db.fills[id];
      if (prev && prev.time === rec.time && prev.qty === rec.qty && prev.price === rec.price && prev.commission === rec.commission) { result.duplicates++; return; }
      db.fills[id] = rec;
      groups.add(`${account}\u0000${contract}`);
      result.fills++;
    });
    let open = 0;
    for (const g of groups) { const [a, c] = g.split('\u0000'); open += repair(source, a, c); }
    result.openPositions = open;

    for (const [i, t] of (body.trades || []).entries()) {
      const entry = utcIso(t.entryTime ?? t.entry ?? t.openTime);
      const exit = utcIso(t.exitTime ?? t.exit ?? t.closeTime) || entry;
      const contract = String(t.symbol ?? t.contract ?? t.instrument ?? '').trim();
      const qty = Math.abs(num(t.qty ?? t.quantity ?? t.size)) || 1;
      const entryPrice = num(t.entryPrice ?? t.openPrice), exitPrice = num(t.exitPrice ?? t.closePrice);
      let dir = sideOf(t.direction ?? t.side, num(t.qty));
      if (!dir) dir = 1;
      const account = String(t.account ?? body.account ?? 'Default').trim();
      if (!entry || !contract) { result.rejected.push({ index: i, kind: 'trade', reason: !entry ? 'entryTime needs a timezone (ISO with Z/offset, or epoch ms)' : 'needs a symbol' }); continue; }
      const root = rootSymbol(contract);
      const fees = Math.abs(num(t.fees ?? t.commission)) || 0;
      const pv = num(t.pointValue ?? t.multiplier) || POINT_VALUES[root];
      let pnl = num(t.pnl ?? t.profit);
      if (Number.isFinite(pnl)) { if (t.pnlIncludesFees === false) pnl -= fees; } else if (pv && Number.isFinite(entryPrice) && Number.isFinite(exitPrice)) pnl = (exitPrice - entryPrice) * dir * pv * qty - fees;
      const id = `${source}|${t.id ?? `${account}|${contract}|${entry}|${dir}|${qty}`}`;
      const rec = { id, source, kind: 'trade', direct: true, account, contract, symbol: root, direction: dir > 0 ? 'Long' : 'Short', qty, entry, exit, entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0, exitPrice: Number.isFinite(exitPrice) ? exitPrice : 0, fees, pnl: Number.isFinite(pnl) ? Math.round(pnl * 100) / 100 : null, needsMultiplier: !Number.isFinite(pnl) };
      const prev = db.trades[id];
      if (prev && ['entry', 'exit', 'qty', 'entryPrice', 'exitPrice', 'fees', 'pnl', 'direction'].every((k) => prev[k] === rec[k])) { result.duplicates++; continue; }
      db.trades[id] = { ...rec, seq: ++db.seq };
      result.trades++;
    }

    const s = touch(source, { posts: (db.sources[source]?.posts || 0) + 1 });
    s.fills += result.fills; s.trades += result.trades;
    if (body.heartbeat || body.platform || body.version) {
      // fill posts carry platform/version only; heartbeats carry balances — merge so neither wipes the other
      const prev = s.heartbeat || {};
      const platform = body.platform ?? body.heartbeat?.platform ?? prev.platform, version = body.version ?? body.heartbeat?.version ?? prev.version;
      // heartbeats merge per account, so two copies of an add-on (one per account) don't wipe each other's balances
      if (body.heartbeat && typeof body.heartbeat === 'object') setHeartbeat(source, { ...body.heartbeat, platform, version, at: new Date().toISOString() });
      else s.heartbeat = { ...prev, platform, version, at: prev.at || new Date().toISOString() };
    }
    if (result.fills || result.trades) log(`[connect] ${source}: +${result.fills} fills, +${result.trades} trades`);
    save();
    return result;
  }

  // ---------------------------------------------------------------- direct API connections + MetaTrader drop
  db.apis = db.apis || {};
  db.mtOffsets = db.mtOffsets || {};
  if (!db.deviceId) { db.deviceId = newDeviceId(); save(); }
  const clients = {};
  const running = new Set();
  const NAMES = { projectx: 'TopstepX / ProjectX', tradovate: 'Tradovate', ibkr: 'Interactive Brokers', ...Object.fromEntries(Object.entries(MARKET_DEFS).map(([k, v]) => [k, v.name])) };
  function setHeartbeat(source, hb) {
    const s = touch(source);
    const at = hb.at || new Date().toISOString();
    const prev = s.heartbeat || {};
    const next = { ...prev, ...hb, at };
    // several accounts can report separately (e.g. one MetaTrader terminal each): merge per account
    if (hb.balances) next.balances = [...(prev.balances || []).filter((b) => !hb.balances.some((x) => x.account === b.account)), ...hb.balances.map((b) => ({ ...b, at }))];
    if (hb.accounts) next.accounts = [...new Set([...(prev.accounts || []), ...hb.accounts])];
    s.heartbeat = next;
    save();
  }
  const clientFor = (id) => {
    const a = db.apis[id];
    if (!clients[id] || clients[id].cfg !== a.config) clients[id] = { cfg: a.config, api: API_DEFS[id].make(a.config, { log, deviceId: db.deviceId }) };
    return clients[id].api;
  };
  async function pollApi(id) {
    const a = db.apis[id];
    if (!a || running.has(id)) return;
    running.add(id);
    const started = new Date().toISOString();
    try {
      const out = await clientFor(id).poll({ since: a.since });
      const res = ingest({ source: id, platform: NAMES[id], fills: out.fills || [], trades: out.trades || [] });
      if (out.balances || out.accounts) setHeartbeat(id, { platform: NAMES[id], accounts: out.accounts, balances: out.balances });
      else setHeartbeat(id, { platform: NAMES[id] });
      Object.assign(a, { since: started, lastPoll: started, lastOk: started, lastError: null, lastResult: `${(out.fills || out.trades || []).length} ${out.fills ? 'fill' : 'trade'}(s) checked · ${res.fills + res.trades} new${out.note ? ` · ${out.note}` : ''}` });
    } catch (e) {
      Object.assign(a, { lastPoll: started, lastError: e.message });
      if (e.fatal) a.enabled = false; // expired sign-in etc. — wait for the user instead of retrying
      log(`[${id}] ${e.message}`);
    } finally { running.delete(id); save(); }
  }
  const scheduler = setInterval(() => {
    for (const [id, a] of Object.entries(db.apis)) {
      if (!a.enabled || !API_DEFS[id]) continue;
      const due = !a.lastPoll || Date.now() - new Date(a.lastPoll).getTime() >= API_DEFS[id].every;
      if (due) pollApi(id);
    }
  }, 15000);
  scheduler.unref?.();
  const mtScan = createDropWatcher({ ingest, setHeartbeat, log, offsets: db.mtOffsets });
  const mtTimer = setInterval(() => { const before = JSON.stringify(db.mtOffsets); mtScan(); if (JSON.stringify(db.mtOffsets) !== before) save(); }, 10000);
  mtTimer.unref?.();
  const publicApi = (id) => {
    const a = db.apis[id];
    if (!a) return { id, configured: false };
    const config = { ...a.config };
    for (const k of API_DEFS[id].secrets) if (config[k]) config[k] = '••••••••';
    return { id, configured: true, enabled: !!a.enabled, config, lastPoll: a.lastPoll, lastOk: a.lastOk, lastError: a.lastError, lastResult: a.lastResult };
  };

  const handler = async function connect(req, res, { trusted = false, loopback = false } = {}) {
    const url = new URL(req.originalUrl || req.url, 'http://x');
    const route = url.pathname.replace(/^\/api\/connect/, '') || '/';
    try {
      if (req.method === 'POST' && route === '/ingest') {
        // a token is required from anywhere but this PC (add-ons on this machine are trusted like ATAS)
        if (!loopback && !safeEq(tokenOf(req, url), db.token)) return send(res, 401, { error: 'Missing or wrong token. Copy it from Connections → Webhook in the journal.' });
        const body = await readBody(req);
        return send(res, 200, { ok: true, ...ingest(body, url.searchParams.get('source')) });
      }
      if (!trusted) return send(res, 403, { error: 'forbidden' });
      if (req.method === 'GET' && route === '/changes') {
        const asked = Number(url.searchParams.get('since') || 0);
        const since = asked > db.seq ? 0 : asked;
        const items = Object.values(db.trades).filter((t) => t.seq > since).sort((a, b) => a.seq - b.seq).slice(0, 2000);
        // live balances from add-on heartbeats in the last 2 minutes
        const balances = [];
        for (const [source, src] of Object.entries(db.sources)) {
          const hb = src.heartbeat;
          if (!hb?.balances?.length || Date.now() - new Date(hb.at).getTime() > 120000) continue;
          for (const b of hb.balances) if (Date.now() - new Date(b.at || hb.at).getTime() <= 120000) balances.push({ ...b, source, at: b.at || hb.at });
        }
        return send(res, 200, { seq: items.length ? items[items.length - 1].seq : since, latest: db.seq, reset: asked > db.seq, more: items.length === 2000, trades: items, balances });
      }
      if (req.method === 'GET' && route === '/status') {
        return send(res, 200, { token: db.token, sources: db.sources, seq: db.seq, apis: Object.fromEntries(Object.keys(API_DEFS).map((id) => [id, publicApi(id)])) });
      }
      const am = route.match(/^\/apis\/([a-z0-9]+)(\/sync)?$/);
      if (am && API_DEFS[am[1]]) {
        const id = am[1];
        if (req.method === 'DELETE') { delete db.apis[id]; delete clients[id]; save(); return send(res, 200, { ok: true }); }
        if (req.method === 'POST' && am[2]) { if (!db.apis[id]) return send(res, 404, { error: 'not set up' }); await pollApi(id); return send(res, 200, publicApi(id)); }
        if (req.method === 'POST') {
          const b = await readBody(req);
          const prev = db.apis[id]?.config || {};
          const config = { ...prev };
          for (const [k, v] of Object.entries(b.config || {})) {
            if (API_DEFS[id].secrets.includes(k) && (v === '' || v === '••••••••')) continue; // keep the saved secret
            config[k] = typeof v === 'string' ? v.trim() : v;
          }
          db.apis[id] = { ...(db.apis[id] || {}), config, enabled: b.enabled !== false };
          delete clients[id];
          try {
            const msg = await clientFor(id).test();
            db.apis[id].lastError = null;
            save();
            pollApi(id); // first import in the background
            return send(res, 200, { ok: true, message: msg, api: publicApi(id) });
          } catch (e) {
            // don't keep retrying bad credentials in the background (some brokers lock the login after repeated failures)
            Object.assign(db.apis[id], { lastError: e.message, enabled: false });
            save();
            return send(res, 200, { ok: false, error: e.message, api: publicApi(id) });
          }
        }
      }
      if (req.method === 'POST' && route === '/token') {
        db.token = crypto.randomBytes(24).toString('base64url');
        save();
        return send(res, 200, { token: db.token });
      }
      if (req.method === 'POST' && route === '/reset') {
        const src = url.searchParams.get('source');
        if (!src) return send(res, 400, { error: 'source needed' });
        for (const [k, f] of Object.entries(db.fills)) if (f.group.startsWith(`${src}|`)) delete db.fills[k];
        for (const [k, t] of Object.entries(db.trades)) if (t.source === src) db.trades[k] = { id: k, source: src, removed: true, seq: ++db.seq };
        delete db.sources[src];
        save();
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  };
  /** Token check for other endpoints add-ons post to (e.g. price bars). */
  handler.tokenOk = (req, loopback) => {
    if (loopback) return true;
    const url = new URL(req.url, 'http://x');
    return safeEq(tokenOf(req, url), db.token);
  };
  return handler;
}
