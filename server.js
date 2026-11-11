// RoninFlow production server — no terminal or dev server needed.
//   npm run start                 (foreground, for testing)
//   npm run autostart:install     (run hidden at every Windows log-in)
//
// Serves the built app from dist/ and mounts the same local APIs the dev server has:
//   /api/atas/*   ATAS "RoninFlow Sync" receiver (data in data/atas-sync/)
//   /api/ai/*     Trading Coach AI relay
//   /api/candles  price candles for the diary's execution chart (candles.js)
//   /api/connect  connector inbox: add-ons / webhooks push fills & trades (connect.js)
//   /api/replica/* the home-server standby copy (replica.js) keeps itself in sync through these
// Journal data is stored in ./data. Port 5173 on this computer; with network access turned on (Phone access
// settings in the app) it also listens on your home network and other devices must enter your PIN.
// If anything in src/ is newer than the last build, it rebuilds with Vite before starting.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAtasHandler } from './atas-sync.js';
import { createAiProxy } from './ai-proxy.js';
import { createCandleHandler } from './candles.js';
import { createConnectHandler } from './connect.js';
import { createVault } from './secrets.js';
import { createSystemHandler } from './system.js';
import { createDataHandler, createNetHandler, createConfig, isLocalPc, cookieToken, lanUrls, loginPage } from './local-api.js';

const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
const PORT = Number(process.env.PORT || 5173);
const DIST = path.join(root, 'dist');
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- rebuild if sources changed ----------
function newest(p) {
  let t = 0;
  if (!fs.existsSync(p)) return 0;
  const st = fs.statSync(p);
  if (st.isFile()) return st.mtimeMs;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) t = Math.max(t, newest(path.join(p, e.name)));
  return t;
}
function buildIfNeeded() {
  const built = fs.existsSync(path.join(DIST, 'index.html')) ? fs.statSync(path.join(DIST, 'index.html')).mtimeMs : 0;
  const src = Math.max(newest(path.join(root, 'src')), newest(path.join(root, 'index.html')), newest(path.join(root, 'vite.config.js')), newest(path.join(root, 'public')));
  if (built && src <= built && process.env.FORCE_BUILD !== '1') return;
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(vite)) { log('[build] vite not installed — run "npm install"', built ? '(serving previous build)' : ''); return; }
  log('[build] sources changed, building…');
  const r = spawnSync(process.execPath, [vite, 'build'], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  log(r.status === 0 ? '[build] done' : `[build] FAILED (exit ${r.status}) ${built ? '— serving previous build' : ''}`);
}
buildIfNeeded();

// ---------- static files ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json', '.txt': 'text/plain',
};
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(DIST, p));
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
  fs.stat(file, (err, st) => {
    const target = !err && st.isFile() ? file : path.join(DIST, 'index.html'); // app uses #/routes; fall back to index
    fs.readFile(target, (e, data) => {
      if (e) { res.statusCode = 503; res.setHeader('Content-Type', 'text/plain'); return res.end('RoninFlow has not been built yet. Run "npm run build" in the project folder.'); }
      const ext = path.extname(target).toLowerCase();
      res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', target.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.end(data);
    });
  });
}

// ---------- APIs ----------
// where everything is stored (Docker: mount a volume at /data and set DATA_DIR=/data)
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
// ATAS receiver data: data/atas-sync (older versions used .iq-sync — moved on first start)
const atasDir = path.join(DATA_DIR, 'atas-sync');
try { if (!fs.existsSync(atasDir) && fs.existsSync(path.join(root, '.iq-sync'))) fs.cpSync(path.join(root, '.iq-sync'), atasDir, { recursive: true }); } catch { /* keep going */ }
const atas = createAtasHandler(atasDir);
let vaultRef = null;
const ai = createAiProxy({ getVault: () => vaultRef });
const mounted = (prefix, handler) => (req, res) => {
  req.url = req.url.slice(prefix.length) || '/'; // same as Vite/connect mounting
  handler(req, res, () => { res.statusCode = 404; res.end(); });
};
const atasRoute = mounted('/api/atas', atas);
const aiRoute = mounted('/api/ai', ai);

const config = createConfig(DATA_DIR);
const dataApi = createDataHandler(DATA_DIR);
const readTrades = () => { const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'journal.json'), 'utf8')); return (j.state || j).trades; };
const vault = createVault(DATA_DIR); // encrypted API keys / broker logins (data/secret.key + data/vault.json)
vaultRef = vault;
const systemApi = createSystemHandler(root, DATA_DIR, { log });
const vaultApi = async (req, res) => {
  const body = () => new Promise((resolve, reject) => { let t = ''; req.setEncoding('utf8'); req.on('data', (c) => { t += c; if (t.length > 1e5) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(t || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); });
  try {
    if (req.method === 'GET') return sendJson(res, 200, { names: vault.names().filter((n) => n.startsWith('ai:')) });
    if (req.method === 'POST') {
      const b = await body();
      if (!/^ai:[\w.-]{1,40}$/.test(String(b.name || ''))) return sendJson(res, 400, { error: 'bad name' });
      vault.set(b.name, typeof b.value === 'string' ? b.value.trim() : null);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 405, { error: 'method' });
  } catch (e) { return sendJson(res, 400, { error: e.message }); }
};
const connectApi = createConnectHandler(DATA_DIR, { log, vault });
const candleApi = createCandleHandler(DATA_DIR, { readTrades, log, vault, tokenOk: (req) => connectApi.tokenOk(req, isLocalPc(req)) });
const netApi = createNetHandler({ config, port: PORT, mode: 'server', onLanChange: (on) => setImmediate(() => bind(on)) });

// ---------- home-server standby copy ----------
// replica.js on the home server forwards every request here while this PC is on, and keeps a copy for when it's off.
// It authenticates with a secret key (data/config.json → replicaKey) instead of a PIN session.
const sendJson = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
function appManifest() {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else { const st = fs.statSync(path.join(dir, e.name)); out.push({ p: r, size: st.size, mtime: Math.round(st.mtimeMs) }); }
    }
  };
  if (fs.existsSync(DIST)) walk(DIST, '');
  return out;
}
function replicaApi(req, res, isReplica, loopback) {
  const route = new URL(req.url, 'http://x').pathname.replace(/^\/api\/replica/, '') || '/';
  // The deploy script (on this PC) fetches the key to hand to the home server.
  if (route === '/key' && req.method === 'POST') return loopback ? sendJson(res, 200, { key: config.replicaKey(true) }) : sendJson(res, 403, { error: 'PC only' });
  if (!isReplica) return sendJson(res, 403, { error: 'forbidden' });
  if (route === '/auth') { const c = config.get(); return sendJson(res, 200, { pinHash: c.pinHash, pinSalt: c.pinSalt, pwHash: c.pwHash, pwSalt: c.pwSalt }); }
  if (route === '/app') return sendJson(res, 200, appManifest());
  if (route.startsWith('/app/')) {
    const file = path.normalize(path.join(DIST, decodeURIComponent(route.slice(5))));
    if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file)) return sendJson(res, 404, { error: 'not found' });
    res.setHeader('Content-Type', 'application/octet-stream');
    return fs.createReadStream(file).pipe(res);
  }
  return sendJson(res, 404, { error: 'not found' });
}

function handle(req, res) {
  try {
    // Phones reaching us through Tailscale Serve (https://<pc>.ts.net) arrive over loopback, so a forwarded request is
    // treated as another device: it needs network access on and the PIN, exactly like a phone on Wi-Fi.
    const loopback = isLocalPc(req);
    const ctx = { loopback };
    if (req.url === '/healthz') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true, app: 'trade-journal', pid: process.pid })); }
    const isReplica = !loopback && config.checkReplicaKey(req.headers['x-tj-replica-key']);
    if (req.url.startsWith('/api/replica')) return replicaApi(req, res, isReplica, loopback);

    // Platform add-ons and webhooks push trades with a token (checked inside), so they skip the PIN screen.
    if (req.url.startsWith('/api/connect/ingest')) return connectApi(req, res, { loopback });
    if (req.url.startsWith('/api/candles/ingest')) return candleApi(req, res);

    // App icon + manifest load before signing in (browsers fetch the manifest without cookies when installing).
    if (!loopback && req.method === 'GET' && /^\/(manifest\.webmanifest|favicon\.svg|sw\.js|offline\.html|icons\/[\w.-]+\.png)$/.test(req.url.split('?')[0])) return serveStatic(req, res);

    const authed = config.validSession(cookieToken(req));
    ctx.authed = authed;
    // Add-ons on this PC post here without signing in (ATAS); everything else is the app itself.
    const addonRoute = /^\/api\/atas\/(trades|heartbeat|reset)/.test(req.url);
    const needLogin = !isReplica && (!loopback || (config.get().requireLocal && !addonRoute));
    if (needLogin) {
      // Another device on the network: network access must be on, and it must sign in with the password.
      if (!loopback && !config.get().lan) { res.statusCode = 403; res.setHeader('Content-Type', 'text/plain'); return res.end('Network access to RoninFlow is turned off. Turn it on from your PC (Settings → Security & privacy).'); }
      if (req.url.startsWith('/api/net/login') || req.url.startsWith('/api/net/logout')) return netApi(req, res, null, ctx);
      if (!authed) {
        if (req.url.startsWith('/api/')) { res.statusCode = 401; res.setHeader('Content-Type', 'application/json'); return res.end('{"error":"locked"}'); }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.end(loginPage({ setup: !config.hasLogin(), legacyPin: config.hasLogin() && !config.hasPassword() }));
      }
      // The ATAS add-on only ever runs on the PC.
      if (!loopback && addonRoute) { res.statusCode = 403; return res.end(); }
    }
    if (isReplica && (req.url.startsWith('/api/atas/trades') || req.url.startsWith('/api/atas/heartbeat') || req.url.startsWith('/api/atas/reset') || (req.url.startsWith('/api/net/') && !req.url.startsWith('/api/net/status')))) { res.statusCode = 403; return res.end(); }

    if (req.url.startsWith('/api/data')) return dataApi(req, res, null, ctx);
    if (req.url.startsWith('/api/net')) return netApi(req, res, null, ctx);
    if (req.url.startsWith('/api/atas')) return atasRoute(req, res);
    if (req.url.startsWith('/api/ai')) return aiRoute(req, res);
    if (req.url.startsWith('/api/candles')) return candleApi(req, res);
    if (req.url.startsWith('/api/connect')) return connectApi(req, res, { trusted: true, loopback });
    if (req.url.startsWith('/api/system')) return isReplica ? sendJson(res, 403, { error: 'forbidden' }) : systemApi(req, res);
    if (req.url.startsWith('/api/vault')) return isReplica ? sendJson(res, 403, { error: 'forbidden' }) : vaultApi(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
    return serveStatic(req, res);
  } catch (e) {
    log('[error]', e);
    res.statusCode = 500;
    res.end();
  }
}

// Loopback only while network access is off; all interfaces (IPv4 + IPv6) while it's on.
let servers = [];
function bind(lan) {
  const old = servers;
  servers = [];
  Promise.all(old.map((s) => new Promise((r) => { s.close(() => r()); s.closeAllConnections?.(); }))).then(() => {
    const hosts = lan ? ['0.0.0.0', '::'] : ['127.0.0.1', '::1'];
    for (const host of hosts) {
      const srv = http.createServer(handle);
      srv.on('error', (e) => {
        if (e.code === 'EADDRINUSE' && (host === '127.0.0.1' || host === '0.0.0.0')) { log(`[server] port ${PORT} is already in use — is "npm run dev" or another copy running?`); process.exit(1); }
        else if (!['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EADDRINUSE'].includes(e.code)) log('[server]', host, e.message);
      });
      srv.listen({ port: PORT, host, ipv6Only: host === '::' }, () => log(`[server] listening on ${host}:${PORT}`));
      servers.push(srv);
    }
    log(`[server] RoninFlow at http://localhost:${PORT}`);
    if (lan) for (const u of lanUrls(PORT)) log(`[server] phone access: ${u.url}  (${u.name})`);
  });
}
bind(config.get().lan);
// First start on a server (no password yet): print the one-time code needed to set it from another device.
if (config.setupToken()) log(`[setup] First start — open RoninFlow in your browser and set a password. Setup code: ${config.setupToken()}`);

process.on('uncaughtException', (e) => log('[uncaught]', e));
process.on('unhandledRejection', (e) => log('[unhandled]', e));
