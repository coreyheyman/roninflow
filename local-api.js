// Local data + network API for RoninFlow (used by server.js and the Vite dev server).
//
//   /api/data/state            GET  → { state, version }      PUT { state, baseVersion } → { version } | 409
//   /api/data/version          GET  → { version }
//   /api/data/images/:id       GET | HEAD | PUT (raw image bytes) | DELETE
//   /api/net/status            GET  → network access info (PC only for full detail)
//   /api/net/config            POST { lan, pin? }  (PC only)
//   /api/net/revoke            POST                (PC only) sign out every phone/tablet
//   /api/net/login             POST { pin }  → sets a session cookie for network devices
//   /api/data/images           GET  → [{ id, ext, size }]   (used by the home-server copy)
//
// Data lives in ./data: journal.json (+ daily backups in data/backups), images/, config.json.

import fs from 'node:fs';
import { createCandleHandler } from './candles.js';
import { createConnectHandler } from './connect.js';
import { createVault } from './secrets.js';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const MAX_STATE = 80e6;
const MAX_IMAGE = 40e6;
const IMG_ID = /^img_[a-z0-9_]{4,60}$/i;
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/bmp': '.bmp' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([k, v]) => [v, k]));

export const isLoopback = (addr = '') => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr.startsWith('127.');
/** Request forwarded by a local proxy (Tailscale Serve) — it reaches us over loopback but comes from another device. */
export const isProxied = (req) => !!(req.headers['x-forwarded-for'] || req.headers['tailscale-user-login'] || req.headers['x-forwarded-host']);
/** This PC itself (not a proxied phone). */
export const isLocalPc = (req) => isLoopback(req.socket.remoteAddress) && !isProxied(req);

// ---------- Tailscale (HTTPS address for installing the app on phones) ----------
const TS_BINS = process.platform === 'win32'
  ? ['tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe', 'C:\\Program Files (x86)\\Tailscale\\tailscale.exe']
  : ['tailscale', '/usr/bin/tailscale', '/usr/local/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
const tsRun = (args) => new Promise((resolve) => {
  const tryBin = (i) => {
    if (i >= TS_BINS.length) return resolve(null);
    execFile(TS_BINS[i], args, { timeout: 4000, windowsHide: true }, (err, out) => (err && err.code === 'ENOENT' ? tryBin(i + 1) : resolve(err ? null : out)));
  };
  tryBin(0);
});
let tsCache = { at: 0, val: null };
/** { dns, ip, url, serving } or null when Tailscale isn't installed / running. Cached for 30 s. */
export async function tailscaleInfo(port) {
  if (Date.now() - tsCache.at < 30000) return tsCache.val;
  let val = null;
  try {
    const st = JSON.parse((await tsRun(['status', '--json'])) || 'null');
    const self = st?.Self;
    if (self?.DNSName) {
      const dns = self.DNSName.replace(/\.$/, '');
      let serving = false;
      try {
        const sv = JSON.parse((await tsRun(['serve', 'status', '--json'])) || '{}');
        serving = JSON.stringify(sv).includes(`:${port}`);
      } catch { /* older Tailscale */ }
      val = { dns, ip: (self.TailscaleIPs || []).find((x) => x.includes('.')) || null, url: `https://${dns}`, serving, magicDns: !!st.CurrentTailnet?.MagicDNSEnabled };
    }
  } catch { val = null; }
  tsCache = { at: Date.now(), val };
  return val;
}

const send = (res, code, obj, headers = {}) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(obj === undefined ? '' : JSON.stringify(obj));
};
const readRaw = (req, limit) => new Promise((resolve, reject) => {
  const chunks = [];
  let n = 0;
  req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('Too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const readJson = async (req, limit) => { const b = await readRaw(req, limit); return b.length ? JSON.parse(b.toString('utf8')) : {}; };
const writeAtomic = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
};

// ---------------- config + sessions ----------------
export function createConfig(dataDir) {
  const file = path.join(dataDir, 'config.json');
  let cfg = { lan: false, pinHash: null, pinSalt: null, pwHash: null, pwSalt: null, requireLocal: false, sessions: {} };
  let fresh = false;
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { fresh = true; }
  // Docker / home servers: start with network access on (the app is only reachable through the container's port)
  if (fresh && /^(1|true|yes)$/i.test(process.env.TJ_LAN || '')) cfg.lan = true;
  const save = () => { writeAtomic(file, JSON.stringify(cfg, null, 2)); try { fs.chmodSync(file, 0o600); } catch { /* windows */ } };
  const hash = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
  const pwHashOf = (pw, salt) => crypto.scryptSync(String(pw), salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
  const same = (a, b) => { const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex'); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const SESSION_IDLE = 30 * 86400e3; // signed out after 30 days without a visit
  // one-time code for setting the first password from another device (shown in the server log)
  const setupToken = crypto.randomBytes(9).toString('base64url');
  return {
    get: () => cfg,
    setupToken: () => (cfg.pwHash || cfg.pinHash ? null : setupToken),
    setLan(on) { cfg.lan = !!on; save(); },
    setRequireLocal(on) { cfg.requireLocal = !!on; save(); },
    setPin(pin) { cfg.pinSalt = crypto.randomBytes(16).toString('hex'); cfg.pinHash = hash(pin, cfg.pinSalt); cfg.sessions = {}; save(); },
    setPassword(pw, keepToken) {
      cfg.pwSalt = crypto.randomBytes(16).toString('hex'); cfg.pwHash = pwHashOf(pw, cfg.pwSalt);
      cfg.pinHash = null; cfg.pinSalt = null; // the password replaces the old PIN
      cfg.sessions = keepToken && cfg.sessions[keepToken] ? { [keepToken]: cfg.sessions[keepToken] } : {};
      save();
    },
    hasPassword: () => !!cfg.pwHash,
    hasLogin: () => !!(cfg.pwHash || cfg.pinHash),
    /** Password, or the PIN from older versions until a password is set. */
    checkPin(secret) {
      if (cfg.pwHash) return same(pwHashOf(secret, cfg.pwSalt), cfg.pwHash);
      if (!cfg.pinHash) return false;
      return same(hash(secret, cfg.pinSalt), cfg.pinHash);
    },
    newSession(label) {
      const token = crypto.randomBytes(32).toString('hex');
      cfg.sessions[token] = { label, created: new Date().toISOString(), lastSeen: new Date().toISOString() };
      save();
      return token;
    },
    validSession(token) {
      const s = token && cfg.sessions[token];
      if (!s) return false;
      const now = Date.now();
      if (now - new Date(s.lastSeen).getTime() > SESSION_IDLE) { delete cfg.sessions[token]; save(); return false; }
      if (now - new Date(s.lastSeen).getTime() > 3600e3) { s.lastSeen = new Date(now).toISOString(); save(); }
      return true;
    },
    revokeAll(except) { cfg.sessions = except && cfg.sessions[except] ? { [except]: cfg.sessions[except] } : {}; save(); },
    revoke(token) { delete cfg.sessions[token]; save(); },
    /** Secret the home-server copy uses to talk to this PC (created on first use). */
    replicaKey(create = false) {
      if (!cfg.replicaKey && create) { cfg.replicaKey = crypto.randomBytes(32).toString('hex'); save(); }
      return cfg.replicaKey || null;
    },
    checkReplicaKey(key) {
      if (!cfg.replicaKey || typeof key !== 'string' || key.length !== cfg.replicaKey.length) return false;
      return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(cfg.replicaKey));
    },
    /** Home-server copy only: take the PIN from the PC (signs everyone out if it changed). */
    adoptPin(pinHash, pinSalt, pwHash, pwSalt) {
      if (cfg.pinHash === (pinHash || null) && cfg.pinSalt === (pinSalt || null) && cfg.pwHash === (pwHash || null) && cfg.pwSalt === (pwSalt || null)) return;
      cfg.pinHash = pinHash || null; cfg.pinSalt = pinSalt || null; cfg.pwHash = pwHash || null; cfg.pwSalt = pwSalt || null; cfg.sessions = {}; save();
    },
  };
}

export const cookieToken = (req) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === 'tj_session')?.[1];

export function lanUrls(port) {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push({ name, url: `http://${a.address}:${port}` });
    }
  }
  return out;
}

// ---------------- data store ----------------
export function createDataHandler(dataDir, { onChange } = {}) {
  const stateFile = path.join(dataDir, 'journal.json');
  const imgDir = path.join(dataDir, 'images');
  const backupDir = path.join(dataDir, 'backups');
  let version = 0;
  let cached = null; // raw JSON string of state
  let savedAt = null;
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    version = raw.version || 1;
    cached = JSON.stringify(raw.state);
    savedAt = raw.savedAt || null;
  } catch { /* none yet */ }
  const persist = () => writeAtomic(stateFile, `{"version":${version},"savedAt":${JSON.stringify(savedAt)},"state":${cached}}`);

  const backup = () => {
    try {
      const day = new Date().toISOString().slice(0, 10);
      const f = path.join(backupDir, `journal-${day}.json`);
      if (!fs.existsSync(f) && fs.existsSync(stateFile)) {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.copyFileSync(stateFile, f); // old backups are pruned by system.js (Settings → Backups & updates)
      }
    } catch { /* best effort */ }
  };
  const imgFile = (id) => {
    if (!IMG_ID.test(id) || !fs.existsSync(imgDir)) return null;
    const f = fs.readdirSync(imgDir).find((x) => x.startsWith(id + '.'));
    return f ? path.join(imgDir, f) : null;
  };

  const handler = async function dataHandler(req, res, next, ctx = {}) {
    const url = new URL(req.url, 'http://x');
    const route = url.pathname.replace(/^\/api\/data/, '') || '/';
    try {
      if (route === '/version' && req.method === 'GET') return send(res, 200, { version, exists: cached !== null });

      if (route === '/state' && req.method === 'GET') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        return res.end(`{"version":${version},"savedAt":${JSON.stringify(savedAt)},"state":${cached ?? 'null'}}`);
      }

      if (route === '/state' && req.method === 'PUT') {
        const body = await readJson(req, MAX_STATE);
        if (!body.state || typeof body.state !== 'object' || !Array.isArray(body.state.trades)) return send(res, 400, { error: 'Invalid journal data' });
        // Only the PC itself may create the journal file (stops a phone uploading empty sample data).
        if (cached === null && !ctx.loopback && !ctx.authed) return send(res, 403, { error: 'Open the journal on your PC first so your data can be moved to the server.' });
        if (cached !== null && Number(body.baseVersion) !== version) return send(res, 409, { error: 'conflict', version });
        backup();
        // minVersion: the home-server copy merging offline edits asks for a version above any it handed out
        version = Math.max(version, Number(body.minVersion) || 0) + 1;
        cached = JSON.stringify(body.state);
        savedAt = new Date().toISOString();
        persist();
        onChange?.('state', { version });
        return send(res, 200, { version });
      }

      if (route === '/images' && req.method === 'GET') {
        const list = fs.existsSync(imgDir) ? fs.readdirSync(imgDir).map((f) => {
          const ext = path.extname(f);
          const id = f.slice(0, -ext.length);
          return IMG_ID.test(id) && MIME[ext] ? { id, ext, size: fs.statSync(path.join(imgDir, f)).size } : null;
        }).filter(Boolean) : [];
        return send(res, 200, list);
      }

      const m = route.match(/^\/images\/([^/]+)$/);
      if (m) {
        const id = m[1];
        if (!IMG_ID.test(id)) return send(res, 400, { error: 'bad id' });
        if (req.method === 'GET' || req.method === 'HEAD') {
          const f = imgFile(id);
          if (!f) return send(res, 404, { error: 'not found' });
          const st = fs.statSync(f);
          res.statusCode = 200;
          res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
          res.setHeader('Content-Length', st.size);
          res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
          if (req.method === 'HEAD') return res.end();
          return fs.createReadStream(f).pipe(res);
        }
        if (req.method === 'PUT') {
          const type = (req.headers['content-type'] || '').split(';')[0].trim();
          if (!EXT[type]) return send(res, 415, { error: 'Unsupported image type' });
          const buf = await readRaw(req, MAX_IMAGE);
          const old = imgFile(id);
          if (old) fs.rmSync(old, { force: true });
          writeAtomic(path.join(imgDir, id + EXT[type]), buf);
          onChange?.('image', { id });
          return send(res, 200, { ok: true, id, size: buf.length });
        }
        if (req.method === 'DELETE') {
          const f = imgFile(id);
          if (f) fs.rmSync(f, { force: true });
          onChange?.('image-delete', { id });
          return send(res, 200, { ok: true });
        }
      }
      return next ? next() : send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, e.code === 413 ? 413 : 400, { error: e.message });
    }
  };
  /** Home-server copy: current snapshot, and replacing it with the PC's. */
  handler.current = () => ({ version, savedAt, json: cached });
  handler.load = ({ version: v, savedAt: at, json }) => { version = v; savedAt = at || null; cached = json; persist(); };
  handler.imageFile = imgFile;
  handler.imageDir = imgDir;
  return handler;
}

// ---------------- network / auth ----------------
const attempts = new Map(); // ip → [timestamps]

export function createNetHandler({ config, port, mode, onLanChange }) {
  return async function netHandler(req, res, next, ctx = {}) {
    const route = new URL(req.url, 'http://x').pathname.replace(/^\/api\/net/, '') || '/';
    try {
      if (route === '/status' && req.method === 'GET') {
        const c = config.get();
        const base = { lan: c.lan, hasPin: !!(c.pinHash || c.pwHash), hasPassword: !!c.pwHash, requireLocal: !!c.requireLocal, mode, you: ctx.loopback ? 'pc' : 'network', docker: !!process.env.TJ_DOCKER };
        if (!ctx.loopback && !ctx.authed) return send(res, 200, base);
        const tailscale = mode === 'server' ? await tailscaleInfo(port) : null;
        return send(res, 200, { ...base, urls: mode === 'server' ? lanUrls(port) : [], tailscale, devices: Object.values(c.sessions).length, sessions: Object.values(c.sessions).slice(-10) });
      }
      if (route === '/login' && req.method === 'POST') {
        const ip = (isProxied(req) && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
        const now = Date.now();
        const list = (attempts.get(ip) || []).filter((t) => now - t < 60e3);
        if (list.length >= 8) return send(res, 429, { error: 'Too many attempts — wait a minute.' });
        const { pin, password, device, setup } = await readJson(req, 1e4);
        const secret = password ?? pin;
        // first start on a server: set the password with the one-time setup code from the log
        if (setup && !config.hasLogin()) {
          if (setup !== config.setupToken()) { list.push(now); attempts.set(ip, list); return send(res, 401, { error: 'Wrong setup code — copy it from the server log.' }); }
          if (String(secret || '').length < 8) return send(res, 400, { error: 'Use at least 8 characters.' });
          config.setPassword(String(secret));
        } else if (!config.checkPin(String(secret ?? ''))) { list.push(now); attempts.set(ip, list); return send(res, 401, { error: config.hasPassword() ? 'Wrong password' : 'Wrong PIN or password' }); }
        attempts.delete(ip);
        const token = config.newSession(String(device || req.headers['user-agent'] || 'device').slice(0, 120));
        const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
        return send(res, 200, { ok: true }, { 'Set-Cookie': `tj_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}` });
      }
      if (route === '/logout' && req.method === 'POST') {
        const tok = cookieToken(req);
        if (tok) config.revoke(tok);
        return send(res, 200, { ok: true }, { 'Set-Cookie': 'tj_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
      }
      // everything below changes security settings → this PC, or a device signed in with the password
      if (!ctx.loopback && !ctx.authed) return send(res, 403, { error: 'Sign in to change security settings.' });
      if (route === '/config' && req.method === 'POST') {
        const { lan, pin, password, currentPassword, requireLocal } = await readJson(req, 1e4);
        if (password !== undefined && password !== null && password !== '') {
          if (String(password).length < 8) return send(res, 400, { error: 'Use at least 8 characters for the password.' });
          // changing an existing password from another device needs the current one
          if (config.hasLogin() && !ctx.loopback && !config.checkPin(String(currentPassword || ''))) return send(res, 401, { error: 'Your current password is wrong.' });
          config.setPassword(String(password), cookieToken(req));
        } else if (pin !== undefined && pin !== null && pin !== '') {
          if (!/^\d{4,12}$/.test(String(pin))) return send(res, 400, { error: 'PIN must be 4–12 digits.' });
          config.setPin(String(pin));
        }
        if (requireLocal !== undefined) {
          if (requireLocal && !config.hasLogin()) return send(res, 400, { error: 'Set a password first.' });
          config.setRequireLocal(requireLocal);
        }
        if (lan !== undefined) {
          if (lan && !config.hasLogin()) return send(res, 400, { error: 'Set a password before turning on network access.' });
          if (lan && mode !== 'server') return send(res, 400, { error: 'Phone access needs the background server (npm run autostart:install or npm run start), not npm run dev.' });
          config.setLan(lan);
          onLanChange?.(!!lan);
        }
        const c = config.get();
        return send(res, 200, { ok: true, lan: c.lan, hasPin: !!(c.pinHash || c.pwHash), hasPassword: !!c.pwHash, requireLocal: !!c.requireLocal, urls: lanUrls(port) });
      }
      if (route === '/revoke' && req.method === 'POST') { config.revokeAll(cookieToken(req)); return send(res, 200, { ok: true }); }
      return next ? next() : send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  };
}


/** Sign-in page for other devices (or this PC when "require password here too" is on). `setup` = first start. */
export const loginPage = ({ setup = false, legacyPin = false } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RoninFlow</title><meta name="theme-color" content="#000000"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/favicon.svg"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<style>
*{box-sizing:border-box}button,input{font-family:inherit}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f4f4f5;font-family:'JetBrains Mono',ui-monospace,Consolas,monospace,-apple-system,Segoe UI,sans-serif;padding:16px}
.card{width:100%;max-width:380px;background:#0f0f0f;border:1px solid #2a2a2a;padding:28px 24px}
h1{font-size:24px;margin:0;letter-spacing:-.04em;font-weight:700;display:flex;align-items:center;gap:10px}p{color:#8b8b8f;margin:12px 0 20px;font-size:14px;line-height:1.5}
label{display:block;font-size:12.5px;color:#a1a1a6;margin:12px 0 6px}
input{width:100%;height:46px;font-size:16px;padding:0 12px;background:#0a0a0a;border:1px solid #2a2a2a;color:#fff;outline:none}
input:focus{border-color:#7452ff}button{width:100%;height:46px;margin-top:18px;background:#7452ff;color:#fff;border:0;font-size:15px;font-weight:600;cursor:pointer}
.err{color:#e5484d;font-size:13px;min-height:18px;margin-top:10px;text-align:center}code{background:#1a1a1a;padding:1px 5px}
</style></head><body><form class="card" id="f"><h1>RoninFlow</h1>
${setup
    ? `<p>Welcome! Choose the password that protects your journal. The one-time setup code is printed in the server log (<code>docker logs roninflow</code>, or the console window).</p>
<label for="code">Setup code</label><input id="code" autocomplete="off" autofocus>
<label for="pw">New password <span style="color:#666">(at least 8 characters)</span></label><input id="pw" type="password" autocomplete="new-password">
<label for="pw2">Repeat password</label><input id="pw2" type="password" autocomplete="new-password">
<button>Set password &amp; continue</button>`
    : `<p>${legacyPin ? 'Enter your PIN (or password).' : 'Enter your password to open your journal.'}</p>
<input id="pw" type="password" autocomplete="current-password" autofocus placeholder="${legacyPin ? 'PIN or password' : 'Password'}">
<button>Sign in</button>`}
<div class="err" id="e"></div></form>
<script>const $=(i)=>document.getElementById(i);$('f').onsubmit=async(ev)=>{ev.preventDefault();const e=$('e');e.textContent='';
const body={password:$('pw').value,device:navigator.userAgent};
if($('code')){if($('pw').value.length<8){e.textContent='Use at least 8 characters.';return}if($('pw').value!==$('pw2').value){e.textContent='The passwords don\\'t match.';return}body.setup=$('code').value.trim()}
try{const r=await fetch('/api/net/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const j=await r.json();if(r.ok){location.reload()}else{e.textContent=j.error||'Could not sign in'}}catch(x){e.textContent='Connection problem'}};</script></body></html>`;
export const LOGIN_PAGE = loginPage();

/** Vite dev server: same data API (PC only). Phone access requires server.js. */
export default function localApiPlugin() {
  const dataDir = path.resolve('data');
  const data = createDataHandler(dataDir);
  const net = createNetHandler({ config: createConfig(dataDir), port: 5173, mode: 'dev' });
  const vault = createVault(dataDir);
  const connect = createConnectHandler(dataDir, { vault });
  const candles = createCandleHandler(dataDir, { vault, tokenOk: () => true });
  const ctx = (req) => ({ loopback: isLocalPc(req) });
  const mount = (server) => {
    server.middlewares.use('/api/data', (req, res, next) => data(req, res, next, ctx(req)));
    server.middlewares.use('/api/net', (req, res, next) => net(req, res, next, ctx(req)));
    server.middlewares.use('/api/candles', (req, res) => candles(req, res));
    server.middlewares.use('/api/connect', (req, res) => connect(req, res, { trusted: true, loopback: true }));
  };
  return { name: 'tj-local-api', configureServer: mount, configurePreviewServer: mount };
}
