// RoninFlow — home-server standby copy.
//
// Runs on the home server (Linux). Your PC stays the home of the journal:
//   • PC on   → every request is forwarded to the PC, so edits land straight in the PC's data/journal.json.
//               Meanwhile this keeps a fresh copy of the journal, screenshots and the app itself.
//   • PC off  → the journal is served from that copy. Edits and screenshots are saved here as pending changes.
//   • PC back → pending changes are merged into the PC's journal item by item (diary days, reviews, notes,
//               trades, settings…) and new screenshots are uploaded, then forwarding resumes.
// If the same field was changed on both sides while they couldn't reach each other, the newer edit wins and
// the other version is saved in data/conflicts/ so nothing is lost.
//
// Settings: replica.json next to this file  { "upstreams": ["https://pc.tailnet.ts.net", "http://100.x.y.z:5173"], "key": "…", "port": 5173 }
// Devices sign in with the same PIN as on the PC (it's copied from the PC).

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createAiProxy } from './ai-proxy.js';
import { createCandleHandler } from './candles.js';
import { createDataHandler, createConfig, cookieToken, loginPage } from './local-api.js';

const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const CFG = JSON.parse(fs.readFileSync(path.join(root, 'replica.json'), 'utf8'));
const PORT = Number(process.env.PORT || CFG.port || 5173);
const UPSTREAMS = (CFG.upstreams || []).map((u) => u.replace(/\/$/, ''));
const KEY = CFG.key;
const DIST = path.join(root, 'dist');
const DATA = path.join(root, 'data');
const META_FILE = path.join(DATA, 'replica-meta.json');
const BASE_FILE = path.join(DATA, 'replica-base.json');
const TICK_MS = 15000;

fs.mkdirSync(DATA, { recursive: true });
const writeAtomic = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const t = `${file}.${process.pid}.tmp`; fs.writeFileSync(t, data); fs.renameSync(t, file); };
const readJsonFile = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };

// ---------- local state ----------
// meta.dirty: edits made here that the PC hasn't got yet. base: the PC's journal as last seen (the merge ancestor).
const meta = { dirty: false, lastLocalEdit: null, images: [], deletedImages: [], lastSync: null, appSyncedAt: 0, ...readJsonFile(META_FILE, {}) };
const saveMeta = () => writeAtomic(META_FILE, JSON.stringify(meta, null, 2));
let base = readJsonFile(BASE_FILE, null); // { version, savedAt, json }
const saveBase = () => writeAtomic(BASE_FILE, JSON.stringify(base));

const config = createConfig(DATA);
const dataApi = createDataHandler(DATA, {
  onChange(kind, info) {
    meta.dirty = true;
    meta.lastLocalEdit = new Date().toISOString();
    if (kind === 'image') { meta.images = [...new Set([...meta.images, info.id])]; meta.deletedImages = meta.deletedImages.filter((x) => x !== info.id); }
    if (kind === 'image-delete') { meta.deletedImages = [...new Set([...meta.deletedImages, info.id])]; meta.images = meta.images.filter((x) => x !== info.id); }
    saveMeta();
  },
});
const ai = createAiProxy();
const candleApi = createCandleHandler(DATA, { log });

let online = false; // forwarding to the PC
let upstream = null; // the PC address that answered
let lastError = null;

// ---------- talking to the PC ----------
function request(base0, p, { method = 'GET', headers = {}, body = null, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base0 + p);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers: { 'x-tj-replica-key': KEY, ...headers }, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.end(body); else req.end();
  });
}
const pcJson = async (p, opts) => {
  const r = await request(upstream, p, opts);
  if (r.status === 403) throw new Error('The PC refused the sync key — run the home-server setup again on the PC.');
  if (r.status >= 300 && r.status !== 409) throw new Error(`PC answered ${r.status} for ${p}`);
  return { status: r.status, json: r.body.length ? JSON.parse(r.body.toString('utf8')) : null };
};

async function findUpstream() {
  for (const u of UPSTREAMS) {
    try {
      const r = await request(u, '/healthz', { timeout: 4000 });
      if (r.status === 200 && JSON.parse(r.body.toString()).app === 'trade-journal') return u;
    } catch { /* try the next address */ }
  }
  return null;
}

// ---------- three-way merge ----------
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const hasId = (v) => isObj(v) && (typeof v.id === 'string' || typeof v.id === 'number');
const idArray = (a) => Array.isArray(a) && a.every(hasId);
const primArray = (a) => Array.isArray(a) && a.every((x) => x === null || typeof x !== 'object');

/** Merge local (this copy) and remote (PC) changes made since base. Returns the merged value (undefined = deleted). */
export function merge3(b, l, r, ctx, at = '') {
  if (same(l, b)) return r;
  if (same(r, b)) return l;
  if (same(l, r)) return l;
  if (isObj(l) && isObj(r)) {
    const out = {};
    for (const k of new Set([...Object.keys(r), ...Object.keys(l)])) {
      const v = merge3(isObj(b) ? b[k] : undefined, l[k], r[k], ctx, at ? `${at}.${k}` : k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (idArray(l) && idArray(r)) {
    const bArr = idArray(b) ? b : [];
    const bm = new Map(bArr.map((x) => [String(x.id), x]));
    const lm = new Map(l.map((x) => [String(x.id), x]));
    const rm = new Map(r.map((x) => [String(x.id), x]));
    const order = r.map((x) => String(x.id));
    // items added here go in at the same spot they have locally (e.g. newest-first lists stay newest-first)
    l.forEach((x, i) => {
      const id = String(x.id);
      if (rm.has(id) || bm.has(id)) return;
      const next = l.slice(i + 1).map((y) => String(y.id)).find((y) => order.includes(y));
      if (next === undefined) order.push(id); else order.splice(order.indexOf(next), 0, id);
    });
    const out = [];
    for (const id of order) {
      const v = merge3(bm.get(id), lm.get(id), rm.get(id), ctx, `${at}[${id}]`);
      if (v !== undefined) out.push(v);
    }
    return out;
  }
  if (primArray(l) && primArray(r)) {
    const bs = new Set(primArray(b) ? b : []);
    const gone = new Set([...bs].filter((x) => !l.includes(x) || !r.includes(x)));
    return [...new Set([...r, ...l])].filter((x) => !gone.has(x));
  }
  // Same thing changed on both sides: newer edit wins, the other is kept in the conflicts file.
  const keepLocal = ctx.localNewer;
  ctx.conflicts.push({ path: at, kept: keepLocal ? 'home server' : 'PC', otherVersion: keepLocal ? r : l });
  return keepLocal ? l : r;
}

// ---------- sync steps ----------
async function pushPending() {
  // 1. screenshots added / removed while the PC was off
  for (const id of [...meta.images]) {
    const f = dataApi.imageFile(id);
    if (f) {
      const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp' }[path.extname(f)];
      const r = await request(upstream, `/api/data/images/${id}`, { method: 'PUT', headers: { 'content-type': type }, body: fs.readFileSync(f), timeout: 60000 });
      if (r.status !== 200) throw new Error(`Uploading screenshot failed (${r.status})`);
    }
    meta.images = meta.images.filter((x) => x !== id); saveMeta();
  }
  for (const id of [...meta.deletedImages]) {
    await request(upstream, `/api/data/images/${id}`, { method: 'DELETE' });
    meta.deletedImages = meta.deletedImages.filter((x) => x !== id); saveMeta();
  }
  // 2. the journal itself
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = dataApi.current();
    const { json: remote } = await pcJson('/api/data/state', { timeout: 30000 });
    const local = JSON.parse(cur.json);
    const ancestor = base?.json ? JSON.parse(base.json) : remote.state;
    const ctx = { conflicts: [], localNewer: !!meta.lastLocalEdit && (!remote.savedAt || meta.lastLocalEdit > remote.savedAt) };
    const merged = merge3(ancestor, local, remote.state, ctx);
    const body = JSON.stringify({ state: merged, baseVersion: remote.version, minVersion: cur.version });
    const put = await pcJson('/api/data/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body, timeout: 60000 });
    if (put.status === 409) continue; // the PC saved in the meantime — merge again
    if (ctx.conflicts.length) {
      const f = path.join(DATA, 'conflicts', `merge-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      writeAtomic(f, JSON.stringify(ctx.conflicts, null, 2));
      log(`[sync] ${ctx.conflicts.length} field(s) were edited on both sides; the other versions are in ${f}`);
    }
    const json = JSON.stringify(merged);
    base = { version: put.json.version, savedAt: new Date().toISOString(), json };
    saveBase();
    if (dataApi.current().json === cur.json) { // nothing new arrived here while merging
      dataApi.load(base);
      meta.dirty = false;
    } else {
      meta.dirty = true; // a device saved here during the merge — go round again next tick
    }
    meta.lastLocalEdit = meta.dirty ? meta.lastLocalEdit : null;
    saveMeta();
    log('[sync] offline changes merged into the PC journal');
    return;
  }
  throw new Error('The PC journal kept changing during the merge — will retry');
}

async function pullJournal() {
  const { json: v } = await pcJson('/api/data/version');
  if (base && v.version === base.version && dataApi.current().version === base.version) return;
  const { json: remote } = await pcJson('/api/data/state', { timeout: 30000 });
  if (!remote?.state || meta.dirty) return;
  base = { version: remote.version, savedAt: remote.savedAt, json: JSON.stringify(remote.state) };
  saveBase();
  dataApi.load(base);
}

async function pullImages() {
  const { json: list } = await pcJson('/api/data/images');
  for (const { id, ext, size } of list || []) {
    const f = dataApi.imageFile(id);
    if (f && fs.statSync(f).size === size) continue;
    const r = await request(upstream, `/api/data/images/${id}`, { timeout: 60000 });
    if (r.status === 200) writeAtomic(path.join(dataApi.imageDir, id + ext), r.body);
  }
}

async function pullAuth() {
  const { json } = await pcJson('/api/replica/auth');
  if (json?.pinHash || json?.pwHash) config.adoptPin(json.pinHash, json.pinSalt, json.pwHash, json.pwSalt);
}

/** Keep the app files in step with the PC, so updates reach the phone app with no extra step. */
async function pullApp() {
  const { json: files } = await pcJson('/api/replica/app');
  if (!files?.length) return;
  const mfFile = path.join(DATA, 'app-manifest.json');
  const have = new Map((readJsonFile(mfFile, [])).map((f) => [f.p, f]));
  const changed = files.filter((f) => { const h = have.get(f.p); return !h || h.size !== f.size || h.mtime !== f.mtime || !fs.existsSync(path.join(DIST, f.p)); });
  if (!changed.length) return;
  changed.sort((a, b) => (a.p === 'index.html') - (b.p === 'index.html')); // index.html last, after its assets
  for (const f of changed) {
    const r = await request(upstream, `/api/replica/app/${encodeURIComponent(f.p).replace(/%2F/g, '/')}`, { timeout: 60000 });
    if (r.status !== 200) throw new Error(`Downloading ${f.p} failed (${r.status})`);
    writeAtomic(path.join(DIST, f.p), r.body);
  }
  // drop files the PC no longer has (old builds)
  const keep = new Set(files.map((f) => f.p));
  for (const old of have.keys()) if (!keep.has(old)) fs.rmSync(path.join(DIST, old), { force: true });
  writeAtomic(mfFile, JSON.stringify(files));
  log(`[sync] app updated (${changed.length} file${changed.length > 1 ? 's' : ''})`);
}

let busy = null;
async function tick() {
  if (busy) return busy;
  busy = (async () => {
    const found = await findUpstream();
    if (!found) {
      if (online) log('[sync] PC is offline — serving the journal from this copy');
      online = false; upstream = null;
      return;
    }
    upstream = found;
    try {
      if (meta.dirty || meta.images.length || meta.deletedImages.length) await pushPending();
      if (meta.dirty) return; // a device saved during the merge; stay on this copy and merge again next time
      await pullAuth();
      await pullJournal();
      if (!online) log(`[sync] PC is online at ${upstream} — forwarding to it`);
      online = true;
      lastError = null;
      meta.lastSync = new Date().toISOString(); saveMeta();
      await pullImages();
      if (Date.now() - (meta.appSyncedAt || 0) > 60000) { await pullApp(); meta.appSyncedAt = Date.now(); saveMeta(); }
    } catch (e) {
      if (lastError !== e.message) log('[sync]', e.message);
      lastError = e.message;
      if (meta.dirty) online = false;
    }
  })().finally(() => { busy = null; });
  return busy;
}

// ---------- static files ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain',
};
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(DIST, p));
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(DIST, 'index.html');
  fs.readFile(target, (e, data) => {
    if (e) { res.statusCode = 503; res.setHeader('Content-Type', 'text/plain'); return res.end('The home server has not copied the journal from your PC yet. Turn the PC on for a minute.'); }
    res.setHeader('Content-Type', TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', target.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.end(data);
  });
}
const sendJson = (res, code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
const readBody = (req, limit = 90e6) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n > limit) { req.destroy(); reject(new Error('too large')); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

// ---------- forwarding to the PC ----------
const HOP = new Set(['host', 'connection', 'keep-alive', 'cookie', 'transfer-encoding', 'upgrade', 'proxy-connection', 'content-length']);
function forward(req, res, body) {
  return new Promise((resolve) => {
    const u = new URL(upstream + req.url);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
    if (headers.origin) headers.origin = u.origin; // the AI relay only accepts same-origin calls
    if (headers.referer) headers.referer = u.origin + '/';
    headers['x-tj-replica-key'] = KEY;
    if (body) headers['content-length'] = body.length;
    const lib = u.protocol === 'https:' ? https : http;
    const up = lib.request(u, { method: req.method, headers }, (pr) => {
      const out = { ...pr.headers };
      delete out['set-cookie']; // sign-in is handled here, not by the PC
      res.writeHead(pr.statusCode, out);
      if (req.method === 'PUT' && req.url.startsWith('/api/data/state') && pr.statusCode === 200) {
        // keep our copy current with every save that passes through
        const chunks = [];
        pr.on('data', (c) => { chunks.push(c); res.write(c); });
        pr.on('end', () => {
          res.end();
          try {
            const { version } = JSON.parse(Buffer.concat(chunks).toString());
            const { state } = JSON.parse(body.toString());
            if (!meta.dirty) { base = { version, savedAt: new Date().toISOString(), json: JSON.stringify(state) }; saveBase(); dataApi.load(base); }
          } catch { /* the next sync picks it up */ }
          resolve(true);
        });
      } else {
        pr.pipe(res);
        pr.on('end', () => resolve(true));
      }
      pr.on('error', () => { res.destroy(); resolve(true); });
    });
    up.setTimeout(10000, () => { if (!res.headersSent) up.destroy(new Error('timeout')); });
    up.on('response', () => up.setTimeout(0));
    up.on('error', () => resolve(false)); // PC went away → caller serves locally
    up.end(body || undefined);
  });
}

// ---------- requests ----------
async function handle(req, res) {
  try {
    const p = req.url.split('?')[0];
    if (p === '/healthz') return sendJson(res, 200, { ok: true, app: 'trade-journal-replica', pcOnline: online });
    if (req.method === 'GET' && /^\/(manifest\.webmanifest|favicon\.svg|sw\.js|offline\.html|icons\/[\w.-]+\.png)$/.test(p)) return serveStatic(req, res);

    // sign in with the PC's PIN (sessions are this server's own)
    if (p === '/api/net/login' && req.method === 'POST') {
      if (!config.hasLogin()) return sendJson(res, 400, { error: 'No password yet — set one on your PC (Settings → Security & privacy) and turn the PC on for a minute.' });
      const { pin, password, device } = JSON.parse((await readBody(req, 1e4)).toString() || '{}');
      if (!config.checkPin(String(password ?? pin ?? ''))) { await new Promise((r) => setTimeout(r, 700)); return sendJson(res, 401, { error: 'Wrong PIN' }); }
      const token = config.newSession(String(device || req.headers['user-agent'] || 'device').slice(0, 120));
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `tj_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}` });
    }
    if (!config.validSession(cookieToken(req))) {
      if (p.startsWith('/api/')) return sendJson(res, 401, { error: 'locked' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(loginPage({ legacyPin: !config.hasPassword() }));
    }

    if (p === '/api/replica/status') return sendJson(res, 200, { role: 'replica', pcOnline: online, pending: !!(meta.dirty || meta.images.length || meta.deletedImages.length), lastSync: meta.lastSync });

    // a save that arrives while a merge is running waits for it
    if (busy && req.method !== 'GET' && p.startsWith('/api/data')) await busy;

    if (online && upstream) {
      const body = req.method === 'GET' || req.method === 'HEAD' ? null : await readBody(req);
      if (await forward(req, res, body)) return;
      online = false; // PC just went away — answer from our copy
      log('[sync] PC stopped answering — serving the journal from this copy');
      setImmediate(tick);
      return local(req, res, p, body);
    }
    return local(req, res, p, null);
  } catch (e) {
    log('[error]', e);
    if (!res.headersSent) { res.statusCode = 500; res.end(); }
  }
}

function local(req, res, p, body) {
  if (body) { // body was already read for forwarding — replay it
    const r = Readable.from([body]);
    Object.assign(r, { method: req.method, url: req.url, headers: req.headers, socket: req.socket });
    req = r;
  }
  if (p.startsWith('/api/data')) return dataApi(req, res, null, { loopback: false });
  if (p.startsWith('/api/ai')) return ai(req, res, () => sendJson(res, 404, { error: 'not found' }));
  if (p.startsWith('/api/candles')) return candleApi(req, res);
  if (p === '/api/net/status') return sendJson(res, 200, { lan: true, hasPin: true, mode: 'replica', you: 'network', pcOnline: false });
  if (p.startsWith('/api/atas')) return sendJson(res, 503, { error: 'Your PC is offline', offline: true });
  if (p.startsWith('/api/')) return sendJson(res, 503, { error: 'Your PC is offline — this works again when it is back on.' });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
  return serveStatic(req, res);
}

// ---------- start ----------
if (!KEY || !UPSTREAMS.length) { log('replica.json needs "key" and "upstreams" — run the setup from your PC.'); process.exit(1); }
const server = http.createServer(handle);
let said = false;
const started = () => !said && (said = true) && log(`[replica] RoninFlow standby copy on port ${PORT}; PC: ${UPSTREAMS.join(' or ')}`);
server.on('error', (e) => {
  if (e.code === 'EAFNOSUPPORT' || e.code === 'EADDRNOTAVAIL') return server.listen({ port: PORT, host: '0.0.0.0' }, started); // no IPv6
  log('[replica]', e.message); process.exit(1);
});
server.listen({ port: PORT, host: '::' }, started);
tick();
setInterval(tick, TICK_MS);
process.on('uncaughtException', (e) => log('[uncaught]', e));
process.on('unhandledRejection', (e) => log('[unhandled]', e));
