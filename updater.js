// One-click updates for copies installed with the Windows installer.
//
// The installer puts its own node.exe in <app>\node, so "this server runs on <app>\node\node.exe" is how we know it's an
// installer copy. Docker and source installs can't replace themselves from inside the app; they get instructions.
//
// Update = download RoninFlow-Setup-<v>.exe from the GitHub release, check its SHA-256 against the release's
// SHA256SUMS.txt (refused without one), back up the journal, then run the installer silently. The installer stops this
// server, replaces the files (data lives elsewhere and is never touched) and starts RoninFlow again.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export const GITHUB_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
const MAX_BYTES = 300 * 1024 * 1024;

/** 'installer' | 'docker' | 'source' */
export function installType(root, { platform = process.platform, execPath = process.execPath, env = process.env } = {}) {
  if (env.TJ_DOCKER) return 'docker';
  const bundled = path.win32.join(root, 'node', 'node.exe').toLowerCase();
  if (platform === 'win32' && path.win32.resolve(execPath).toLowerCase() === bundled) return 'installer';
  return 'source';
}

/** The Windows installer and checksum file attached to a GitHub release (or nulls). */
export function pickAssets(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const exe = assets.find((a) => /^RoninFlow-Setup-[\w.-]+\.exe$/i.test(a.name || ''));
  const sums = assets.find((a) => /^SHA256SUMS(\.txt)?$/i.test(a.name || ''));
  return {
    exe: exe ? { name: exe.name, url: exe.browser_download_url, size: exe.size } : null,
    sums: sums ? { name: sums.name, url: sums.browser_download_url } : null,
  };
}

/** The expected hash for `name` from a `sha256sum` listing ("<hex>  <name>" or "<hex> *<name>"). */
export function expectedHash(listing, name) {
  for (const line of String(listing || '').split(/\r?\n/)) {
    const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (m && m[2].trim() === name) return m[1].toLowerCase();
  }
  return null;
}

const allowedUrl = (u, hosts) => {
  try { const x = new URL(u); return x.protocol === 'https:' && hosts.includes(x.hostname); } catch { return false; }
};

/** Download over HTTPS from an allowed host into `dest`, returning its SHA-256. `onProgress(fraction)` while it runs. */
export async function download(url, dest, { hosts = GITHUB_HOSTS, ua = 'RoninFlow updater', onProgress = () => {}, fetchImpl = fetch, maxBytes = MAX_BYTES, allowHttp = false } = {}) {
  const ok = (u) => allowedUrl(u, hosts) || (allowHttp && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(u));
  if (!ok(url)) throw new Error(`Refusing to download from ${url}`);
  const r = await fetchImpl(url, { headers: { 'User-Agent': ua, Accept: 'application/octet-stream' }, redirect: 'follow', signal: AbortSignal.timeout(10 * 60e3) });
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  if (r.url && !ok(r.url)) throw new Error(`Download was redirected to an unexpected address (${new URL(r.url).hostname})`);
  const total = Number(r.headers.get('content-length')) || 0;
  if (total > maxBytes) throw new Error('Download is unexpectedly large');
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);
  let got = 0;
  try {
    for await (const chunk of r.body) {
      got += chunk.length;
      if (got > maxBytes) throw new Error('Download is unexpectedly large');
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
      if (total) onProgress(got / total);
    }
  } catch (e) { out.destroy(); fs.rmSync(dest, { force: true }); throw e; }
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  return hash.digest('hex');
}

/**
 * Updater state machine shared with the UI through /api/system/info → `update`.
 * deps: { root, version, newer(a,b), getRelease(): Promise<release json>, backup(): bool, log, platform?, execPath?, env?, run? }
 */
export function createUpdater(deps) {
  const { root, version, newer, getRelease, backup = () => true, log = () => {} } = deps;
  const run = deps.run || ((exe, args) => spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref());
  const type = installType(root, deps);
  let st = { state: 'idle' };

  const status = () => ({ installType: type, canAutoUpdate: type === 'installer', ...st });

  async function start() {
    if (type !== 'installer') throw Object.assign(new Error('This copy of RoninFlow can’t update itself — see the instructions.'), { code: 400 });
    if (['downloading', 'verifying', 'installing'].includes(st.state)) return status();
    const release = await getRelease();
    const target = String(release?.tag_name || '').replace(/^v/, '');
    if (!target || !newer(target, version)) throw Object.assign(new Error('You already have the newest version.'), { code: 409 });
    const { exe, sums } = pickAssets(release);
    if (!exe) throw Object.assign(new Error(`Release ${target} has no Windows installer.`), { code: 409 });
    if (!sums) throw Object.assign(new Error(`Release ${target} has no SHA256SUMS.txt, so the download can’t be verified. Download it from GitHub instead.`), { code: 409 });

    st = { state: 'downloading', target, progress: 0 };
    (async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roninflow-update-'));
      const file = path.join(dir, exe.name);
      try {
        const sumsFile = path.join(dir, 'SHA256SUMS.txt');
        await download(sums.url, sumsFile, deps.downloadOpts);
        const want = expectedHash(fs.readFileSync(sumsFile, 'utf8'), exe.name);
        if (!want) throw new Error(`SHA256SUMS.txt has no entry for ${exe.name}.`);
        const got = await download(exe.url, file, { ...deps.downloadOpts, onProgress: (p) => { st = { ...st, progress: p }; } });
        st = { ...st, state: 'verifying', progress: 1 };
        if (got !== want) throw new Error('The downloaded installer doesn’t match the release’s checksum, so it wasn’t run.');
        if (!backup()) log('[update] backup before updating failed — continuing, your data folder is not touched by the installer');
        st = { ...st, state: 'installing' };
        log(`[update] installing RoninFlow ${target} (you have ${version})`);
        // The installer stops this server, replaces the app files and starts RoninFlow again in the background.
        setTimeout(() => run(file, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/LOG=${path.join(dir, 'install.log')}`]), 600);
      } catch (e) {
        fs.rmSync(dir, { recursive: true, force: true });
        log('[update] failed:', e.message);
        st = { state: 'error', target, error: e.message };
      }
    })();
    return status();
  }

  return { status, start, type };
}
