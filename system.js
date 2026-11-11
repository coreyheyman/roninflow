// Version, update checks and backups for Settings → Backups & updates.
//
//   GET  /api/system/info              → { version, latest?, updateUrl?, checkedAt, backups: [...], keep, dataDir }
//   POST /api/system/check-updates     → same, after asking GitHub for the newest release
//   POST /api/system/backup            → makes a backup now
//   POST /api/system/settings          { keep, updateCheck }
//   GET  /api/system/backups/<file>    → download one backup
//
// Backups: data/backups/journal-YYYY-MM-DD.json (one per day, made automatically when the journal changes and once
// a day by the timer below), plus connect.json and vault.json copies, so a backup restores trades *and* connections.
// The newest `keep` days are kept (default 30).
import fs from 'node:fs';
import path from 'node:path';

const UA = 'RoninFlow (self-hosted update check)';

export function createSystemHandler(root, dataDir, { log = () => {} } = {}) {
  const pkg = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { return {}; } })();
  const version = pkg.version || '0.0.0';
  // "repository": "github:owner/repo" or { "url": "https://github.com/owner/repo" } in package.json, or TJ_UPDATE_REPO
  const repo = (process.env.TJ_UPDATE_REPO || (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) || '')
    .replace(/^github:/, '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const cfgFile = path.join(dataDir, 'system.json');
  const backupDir = path.join(dataDir, 'backups');
  let cfg = { keep: 30, updateCheck: true, latest: null, updateUrl: null, checkedAt: null, notes: null };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')) }; } catch { /* first run */ }
  const save = () => { try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 1)); } catch { /* ignore */ } };

  const newer = (a, b) => { // is version a newer than b?
    const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
  };
  async function checkUpdates() {
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return;
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const j = await r.json();
      cfg = { ...cfg, latest: String(j.tag_name || '').replace(/^v/, '') || null, updateUrl: j.html_url || null, notes: String(j.body || '').slice(0, 2000), checkedAt: new Date().toISOString() };
      save();
      if (cfg.latest && newer(cfg.latest, version)) log(`[update] RoninFlow ${cfg.latest} is available (you have ${version}) — ${cfg.updateUrl}`);
    } catch (e) { cfg.checkedAt = new Date().toISOString(); save(); log('[update] check failed:', e.message); }
  }

  const SIDE_FILES = ['connect.json', 'vault.json', 'config.json', 'price-source.json'];
  function backupNow(force = false) {
    try {
      const day = new Date().toISOString().slice(0, 10);
      fs.mkdirSync(backupDir, { recursive: true });
      const main = path.join(dataDir, 'journal.json');
      const f = path.join(backupDir, `journal-${day}.json`);
      if (fs.existsSync(main) && (force || !fs.existsSync(f))) fs.copyFileSync(main, f);
      for (const s of SIDE_FILES) {
        const src = path.join(dataDir, s);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(backupDir, `${s.replace('.json', '')}-${day}.json`));
      }
      prune();
      return true;
    } catch (e) { log('[backup]', e.message); return false; }
  }
  function prune() {
    const keep = Math.max(1, Number(cfg.keep) || 30);
    const files = fs.readdirSync(backupDir);
    const days = [...new Set(files.map((x) => x.match(/-(\d{4}-\d{2}-\d{2})\.json$/)?.[1]).filter(Boolean))].sort().reverse();
    const drop = new Set(days.slice(keep));
    for (const x of files) { const d = x.match(/-(\d{4}-\d{2}-\d{2})\.json$/)?.[1]; if (d && drop.has(d)) fs.rmSync(path.join(backupDir, x), { force: true }); }
  }
  const list = () => {
    try {
      return fs.readdirSync(backupDir).filter((x) => x.startsWith('journal-')).sort().reverse()
        .map((x) => ({ file: x, date: x.slice(8, 18), size: fs.statSync(path.join(backupDir, x)).size }));
    } catch { return []; }
  };
  const info = () => ({ version, repo: repo || null, updateCheck: cfg.updateCheck, latest: cfg.latest, updateAvailable: !!(cfg.latest && newer(cfg.latest, version)), updateUrl: cfg.updateUrl, notes: cfg.notes, checkedAt: cfg.checkedAt, keep: cfg.keep, backups: list(), dataDir });

  // daily: a backup, and (if allowed) a look for a new release
  const daily = () => { backupNow(); if (cfg.updateCheck) checkUpdates(); };
  setTimeout(daily, 60e3).unref?.();
  setInterval(daily, 12 * 3600e3).unref?.();

  const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
  const body = (req) => new Promise((resolve, reject) => { let t = ''; req.setEncoding('utf8'); req.on('data', (c) => { t += c; if (t.length > 1e5) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(t || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); });

  return async function system(req, res) {
    const route = new URL(req.url, 'http://x').pathname.replace(/^\/api\/system/, '') || '/';
    try {
      if (route === '/info' && req.method === 'GET') return send(res, 200, info());
      if (route === '/check-updates' && req.method === 'POST') { await checkUpdates(); return send(res, 200, info()); }
      if (route === '/backup' && req.method === 'POST') return send(res, backupNow(true) ? 200 : 500, info());
      if (route === '/settings' && req.method === 'POST') {
        const b = await body(req);
        if (b.keep !== undefined) cfg.keep = Math.min(3650, Math.max(1, Math.round(Number(b.keep) || 30)));
        if (b.updateCheck !== undefined) cfg.updateCheck = !!b.updateCheck;
        save();
        try { prune(); } catch { /* no backups yet */ }
        return send(res, 200, info());
      }
      const m = route.match(/^\/backups\/(journal-\d{4}-\d{2}-\d{2}\.json)$/);
      if (m && req.method === 'GET') {
        const f = path.join(backupDir, m[1]);
        if (!fs.existsSync(f)) return send(res, 404, { error: 'not found' });
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="roninflow-${m[1]}"`);
        return fs.createReadStream(f).pipe(res);
      }
      return send(res, 404, { error: 'not found' });
    } catch (e) { return send(res, 400, { error: e.message }); }
  };
}
