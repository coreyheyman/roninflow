// Automatic screenshot imports: watch the folder your screenshots save to (Snipping Tool, Win+PrtScn, ShareX,
// your platform's screenshot folder, Downloads for TradingView…). Each new picture is copied into the journal's
// images (data/images) and queued; the app picks the queue up and files every picture by the time it was taken —
// on the trade that was open then, or the one that had just closed, otherwise on that day's diary.
//
//   GET  /api/shots/config           → { on, folder, exists, after, suggestions, pending, imported, lastAt, error }
//   POST /api/shots/config { on?, folder?, after? }   (turning it on only picks up pictures saved from then on)
//   POST /api/shots/backfill { hours } → also queue pictures already in the folder from the last few hours
//   GET  /api/shots/inbox?client=ID  → { items: [{ id, name, takenAt, size }], after } — and claims them for two
//        minutes, so two open windows (your PC and your phone) don't both file the same picture
//   POST /api/shots/release { ids }  → not filed yet (no trade for it so far) — free for the next look
//   POST /api/shots/ack { ids }      → done with these (filed in the journal)
//
// The folder is checked every few seconds (fs.watch is unreliable on network drives and OneDrive folders); a file is
// imported once its size stops changing, so a picture still being written isn't copied half-way. Subfolders are
// included two levels down (ShareX saves into a folder per month).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXTS = { '.png': '.png', '.jpg': '.jpg', '.jpeg': '.jpg', '.webp': '.webp', '.gif': '.gif', '.bmp': '.bmp' };
const MAX = 40e6;
const POLL_MS = 4000;

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = `${f}.${process.pid}.tmp`; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); };

/** Where screenshots usually land on this computer (only the ones that exist). */
export function suggestFolders(home = os.homedir()) {
  const c = [
    ['Screenshots (Snipping Tool, Win+PrtScn)', path.join(home, 'Pictures', 'Screenshots')],
    ['OneDrive screenshots', path.join(home, 'OneDrive', 'Pictures', 'Screenshots')],
    ['OneDrive screenshots', path.join(home, 'OneDrive', 'Pictures', 'Screenshots 1')],
    ['ShareX', path.join(home, 'Documents', 'ShareX', 'Screenshots')],
    ['ATAS', path.join(home, 'Documents', 'ATAS', 'Screenshots')],
    ['NinjaTrader', path.join(home, 'Documents', 'NinjaTrader 8', 'screenshots')],
    ['Sierra Chart', 'C:\\SierraChart\\Images'],
    ['Pictures', path.join(home, 'Pictures')],
    ['Downloads (TradingView saves here)', path.join(home, 'Downloads')],
    ['Desktop', path.join(home, 'Desktop')],
  ];
  const seen = new Set();
  return c.filter(([, p]) => { if (seen.has(p)) return false; seen.add(p); try { return fs.statSync(p).isDirectory(); } catch { return false; } })
    .map(([label, p]) => ({ label, path: p }));
}

/** Image files under dir (two levels of subfolders), with size and the time each was taken. */
export function listImages(dir, depth = 2) {
  const out = [];
  const walk = (d, left) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name.startsWith('~')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (left > 0) walk(p, left - 1); continue; }
      if (!EXTS[path.extname(e.name).toLowerCase()]) continue;
      try {
        const st = fs.statSync(p);
        // the earlier of created / modified: a copied file keeps its modified time, a fresh capture has both ≈ now
        const born = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
        out.push({ path: p, name: e.name, size: st.size, mtime: st.mtimeMs, takenAt: Math.round(Math.min(born, st.mtimeMs)) });
      } catch { /* gone */ }
    }
  };
  walk(dir, depth);
  return out;
}

export function createShotsHandler(dataDir, { log = () => {}, now = () => Date.now(), home } = {}) {
  const dir = path.join(dataDir, 'shots');
  const imgDir = path.join(dataDir, 'images');
  const cfgFile = path.join(dir, 'config.json'), inboxFile = path.join(dir, 'inbox.json'), seenFile = path.join(dir, 'seen.json');
  let cfg = { on: false, folder: '', after: 10, daysOnly: false, since: 0, imported: 0, lastAt: 0, ...readJson(cfgFile, {}) };
  let inbox = readJson(inboxFile, []);
  let seen = readJson(seenFile, {}); // path → "size:mtime" already imported (or skipped)
  const sizes = new Map(); // path → size at the last check (imported once it stops changing)
  let error = '';
  let timer = null;
  const saveCfg = () => writeJson(cfgFile, cfg);
  const saveInbox = () => writeJson(inboxFile, inbox);
  const saveSeen = () => {
    const keys = Object.keys(seen);
    if (keys.length > 5000) seen = Object.fromEntries(keys.slice(-4000).map((k) => [k, seen[k]]));
    writeJson(seenFile, seen);
  };

  function importFile(f) {
    const ext = EXTS[path.extname(f.name).toLowerCase()];
    const id = `img_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    fs.mkdirSync(imgDir, { recursive: true });
    fs.copyFileSync(f.path, path.join(imgDir, id + ext));
    inbox.push({ id, name: f.name, takenAt: f.takenAt, size: f.size });
    cfg.imported = (cfg.imported || 0) + 1;
    cfg.lastAt = now();
    log(`[shots] imported ${f.name}`);
  }

  /** One look at the folder. `since`: only pictures taken from then on. */
  function scan({ since = cfg.since, stable = true } = {}) {
    if (!cfg.folder) return 0;
    if (!fs.existsSync(cfg.folder)) { error = 'The folder can’t be found'; return 0; }
    error = '';
    let n = 0, changed = false;
    for (const f of listImages(cfg.folder)) {
      const key = `${f.size}:${Math.round(f.mtime)}`;
      if (seen[f.path] === key) continue;
      if (f.takenAt < since || f.size === 0 || f.size > MAX) continue; // older ones only come in with “pick up ones already there”
      if (stable && sizes.get(f.path) !== f.size) { sizes.set(f.path, f.size); continue; } // still being written? next time
      sizes.delete(f.path);
      try { importFile(f); n++; } catch (e) { log(`[shots] couldn't import ${f.name}: ${e.message}`); }
      seen[f.path] = key; changed = true;
    }
    if (n) { saveInbox(); saveCfg(); }
    if (changed) saveSeen();
    return n;
  }

  const tick = () => { try { if (cfg.on) scan(); } catch (e) { error = e.message; } };
  function start() { if (!timer) { timer = setInterval(tick, POLL_MS); timer.unref?.(); } }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
  const body = (req) => new Promise((resolve, reject) => { let t = ''; req.setEncoding('utf8'); req.on('data', (c) => { t += c; if (t.length > 1e5) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(t || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); });
  const status = () => ({
    on: !!cfg.on, folder: cfg.folder, after: cfg.after, daysOnly: !!cfg.daysOnly, exists: !!cfg.folder && fs.existsSync(cfg.folder),
    suggestions: suggestFolders(home), pending: inbox.length, imported: cfg.imported || 0, lastAt: cfg.lastAt || null, error,
  });

  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    const route = url.pathname.replace(/^\/api\/shots/, '') || '/';
    try {
      if (route === '/config' && req.method === 'GET') return send(res, 200, status());
      if (route === '/config' && req.method === 'POST') {
        const b = await body(req);
        if (typeof b.folder === 'string') {
          const f = b.folder.trim().replace(/^"(.*)"$/, '$1');
          if (f && !fs.existsSync(f)) return send(res, 400, { error: 'That folder doesn’t exist on this computer' });
          if (f !== cfg.folder) { cfg.folder = f; cfg.since = now(); sizes.clear(); }
        }
        if (b.after != null) cfg.after = Math.max(0, Math.min(240, Number(b.after) || 0));
        if (b.daysOnly != null) cfg.daysOnly = !!b.daysOnly;
        if (b.on != null) { const on = !!b.on; if (on && !cfg.on) cfg.since = now(); cfg.on = on; }
        saveCfg();
        if (cfg.on) start();
        return send(res, 200, status());
      }
      if (route === '/backfill' && req.method === 'POST') {
        const b = await body(req);
        if (!cfg.folder) return send(res, 400, { error: 'Choose a folder first' });
        const hours = Math.max(1, Math.min(24 * 14, Number(b.hours) || 24));
        // pictures from the last few hours that weren't imported yet
        const n = scan({ since: now() - hours * 3600e3, stable: false });
        return send(res, 200, { ...status(), added: n });
      }
      if (route === '/inbox' && req.method === 'GET') {
        const client = String(url.searchParams.get('client') || '').slice(0, 40);
        const t = now();
        const mine = inbox.filter((x) => !x.claim || x.claim.by === client || t - x.claim.at > 120e3);
        if (client) for (const x of mine) x.claim = { by: client, at: t };
        return send(res, 200, { items: mine.map(({ claim, ...x }) => x), after: cfg.after, daysOnly: !!cfg.daysOnly });
      }
      if (route === '/release' && req.method === 'POST') {
        const b = await body(req);
        const ids = new Set(Array.isArray(b.ids) ? b.ids : []);
        for (const x of inbox) if (ids.has(x.id)) delete x.claim;
        return send(res, 200, { ok: true });
      }
      if (route === '/ack' && req.method === 'POST') {
        const b = await body(req);
        const ids = new Set(Array.isArray(b.ids) ? b.ids : []);
        inbox = inbox.filter((x) => !ids.has(x.id));
        saveInbox();
        return send(res, 200, { ok: true, pending: inbox.length });
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }
  handler.start = () => { if (cfg.on) start(); };
  handler.stop = stop;
  handler.scan = scan;
  return handler;
}
