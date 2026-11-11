// One-click updates for copies installed with the Windows installer.
//
// Installed copies run on their own bundled Node.js, which is how we recognise them:
//   Windows installer   <app>\node\node.exe      → download RoninFlow-Setup-<v>.exe and run it silently; the installer
//                                                   stops this server, replaces the files and starts RoninFlow again.
//   macOS / Linux       <app>/node/bin/node        → download RoninFlow-<v>-<os>-<arch>.tar.gz, swap <app> for the new
//   (install.sh)                                     copy (the old one is kept as <app>.old) and exit; launchd/systemd
//                                                   starts the new version. Only when run by that service (TJ_SERVICE=1).
// Every download is checked against the release's SHA256SUMS.txt (refused without one) and the journal is backed up
// first. Data lives outside <app> and is never touched. Docker and source installs get instructions instead.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';

export const GITHUB_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
const MAX_BYTES = 300 * 1024 * 1024;

/** 'installer' (Windows) | 'unix' (macOS / Linux install.sh) | 'docker' | 'source' */
export function installType(root, { platform = process.platform, execPath = process.execPath, env = process.env } = {}) {
  if (env.TJ_DOCKER) return 'docker';
  const bundled = path.win32.join(root, 'node', 'node.exe').toLowerCase();
  if (platform === 'win32' && path.win32.resolve(execPath).toLowerCase() === bundled) return 'installer';
  if ((platform === 'darwin' || platform === 'linux') && path.posix.resolve(execPath) === path.posix.join(root, 'node', 'bin', 'node')) return 'unix';
  return 'source';
}

/** The release package name for this macOS / Linux machine, e.g. RoninFlow-1.2.0-macos-arm64.tar.gz */
export const unixAsset = (version, platform = process.platform, arch = process.arch) =>
  `RoninFlow-${version}-${platform === 'darwin' ? 'macos' : 'linux'}-${arch === 'arm64' ? 'arm64' : 'x64'}.tar.gz`;

/** The Windows installer and checksum file attached to a GitHub release (or nulls). */
export function pickAssets(release, unixName = null) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const exe = unixName ? assets.find((a) => a.name === unixName) : assets.find((a) => /^RoninFlow-Setup-[\w.-]+\.exe$/i.test(a.name || ''));
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
  const exit = deps.exit || (() => process.exit(0));
  const env = deps.env || process.env;
  const type = installType(root, deps);
  // a macOS / Linux copy can only restart itself when launchd / systemd runs it (they start it again after we exit)
  const canAuto = type === 'installer' || (type === 'unix' && env.TJ_SERVICE === '1');
  let st = { state: 'idle' };

  const status = () => ({ installType: type, canAutoUpdate: canAuto, ...st });

  async function start() {
    if (!canAuto) throw Object.assign(new Error('This copy of RoninFlow can’t update itself — see the instructions.'), { code: 400 });
    if (['downloading', 'verifying', 'installing'].includes(st.state)) return status();
    const release = await getRelease();
    const target = String(release?.tag_name || '').replace(/^v/, '');
    if (!target || !newer(target, version)) throw Object.assign(new Error('You already have the newest version.'), { code: 409 });
    const unixName = type === 'unix' ? unixAsset(target, deps.platform, deps.arch) : null;
    const { exe, sums } = pickAssets(release, unixName);
    if (!exe) throw Object.assign(new Error(`Release ${target} has no ${unixName || 'Windows installer'}.`), { code: 409 });
    if (!sums) throw Object.assign(new Error(`Release ${target} has no SHA256SUMS.txt, so the download can’t be verified. Download it from GitHub instead.`), { code: 409 });

    st = { state: 'downloading', target, progress: 0 };
    (async () => {
      // macOS / Linux: work next to the app folder so the final swap is a same-disk rename
      const dir = fs.mkdtempSync(type === 'unix' ? path.join(path.dirname(root), '.update-') : path.join(os.tmpdir(), 'roninflow-update-'));
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
        if (type === 'unix') {
          await swapUnix(file, dir);
          fs.rmSync(dir, { recursive: true, force: true });
          log('[update] restarting into the new version');
          setTimeout(exit, 800); // launchd / systemd starts the new copy
        } else {
          // The installer stops this server, replaces the app files and starts RoninFlow again in the background.
          setTimeout(() => run(file, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/LOG=${path.join(dir, 'install.log')}`]), 600);
        }
      } catch (e) {
        fs.rmSync(dir, { recursive: true, force: true });
        log('[update] failed:', e.message);
        st = { state: 'error', target, error: e.message };
      }
    })();
    return status();
  }

  /** Unpack the release next to <app> and swap folders; on any failure <app> is put back as it was. */
  async function swapUnix(file, dir) {
    await new Promise((res, rej) => execFile('tar', ['-xzf', file, '-C', dir], (e) => (e ? rej(new Error(`Couldn’t unpack the update: ${e.message}`)) : res())));
    const fresh = path.join(dir, 'roninflow');
    if (!fs.existsSync(path.join(fresh, 'server.js')) || !fs.existsSync(path.join(fresh, 'node', 'bin', 'node'))) throw new Error('The update package is missing files.');
    const old = `${root}.old`;
    fs.rmSync(old, { recursive: true, force: true });
    fs.renameSync(root, old);
    try { fs.renameSync(fresh, root); }
    catch (e) { fs.renameSync(old, root); throw new Error(`Couldn’t put the new version in place: ${e.message}`); }
  }

  return { status, start, type };
}
