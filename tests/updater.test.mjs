import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { installType, pickAssets, expectedHash, download, createUpdater } from '../updater.js';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const newer = (a, b) => a.localeCompare(b, undefined, { numeric: true }) > 0;

test('installType: only the installer’s bundled node.exe counts as an installer copy', () => {
  const root = 'C:\\Users\\Al\\AppData\\Local\\Programs\\RoninFlow';
  assert.equal(installType(root, { platform: 'win32', execPath: `${root}\\node\\node.exe`, env: {} }), 'installer');
  assert.equal(installType(root, { platform: 'win32', execPath: 'C:\\Program Files\\nodejs\\node.exe', env: {} }), 'source');
  assert.equal(installType('/app', { platform: 'linux', execPath: '/usr/local/bin/node', env: { TJ_DOCKER: '1' } }), 'docker');
});

test('pickAssets / expectedHash read a GitHub release', () => {
  const rel = { assets: [{ name: 'RoninFlow-1.2.0.zip', browser_download_url: 'z' }, { name: 'RoninFlow-Setup-1.2.0.exe', browser_download_url: 'e', size: 5 }, { name: 'SHA256SUMS.txt', browser_download_url: 's' }] };
  assert.deepEqual(pickAssets(rel), { exe: { name: 'RoninFlow-Setup-1.2.0.exe', url: 'e', size: 5 }, sums: { name: 'SHA256SUMS.txt', url: 's' } });
  const h = 'a'.repeat(64);
  assert.equal(expectedHash(`${'b'.repeat(64)}  RoninFlow-1.2.0.zip\n${h}  RoninFlow-Setup-1.2.0.exe\n`, 'RoninFlow-Setup-1.2.0.exe'), h);
  assert.equal(expectedHash(`${h} *RoninFlow-Setup-1.2.0.exe`, 'RoninFlow-Setup-1.2.0.exe'), h);
  assert.equal(expectedHash('nonsense', 'RoninFlow-Setup-1.2.0.exe'), null);
});

test('download refuses anything but HTTPS from GitHub', async () => {
  await assert.rejects(download('http://github.com/x', '/tmp/x'), /Refusing/);
  await assert.rejects(download('https://evil.example/x.exe', '/tmp/x'), /Refusing/);
});

// a fake GitHub serving a release over local http
function fakeGitHub(files) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => { const f = files[req.url]; if (!f) { res.statusCode = 404; return res.end(); } res.setHeader('content-length', f.length); res.end(f); });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}
const setup = async ({ exe = Buffer.from('MZ fake installer'), sums } = {}) => {
  const files = { '/RoninFlow-Setup-1.2.0.exe': exe };
  if (sums !== null) files['/SHA256SUMS.txt'] = Buffer.from(sums ?? `${sha(exe)}  RoninFlow-Setup-1.2.0.exe\n`);
  const { srv, base } = await fakeGitHub(files);
  const assets = [{ name: 'RoninFlow-Setup-1.2.0.exe', browser_download_url: `${base}/RoninFlow-Setup-1.2.0.exe` }];
  if (sums !== null) assets.push({ name: 'SHA256SUMS.txt', browser_download_url: `${base}/SHA256SUMS.txt` });
  const ran = [];
  const root = 'C:\\RF';
  const up = createUpdater({
    root, version: '1.1.0', newer, platform: 'win32', execPath: `${root}\\node\\node.exe`, env: {},
    getRelease: async () => ({ tag_name: 'v1.2.0', assets }), backup: () => true,
    downloadOpts: { allowHttp: true }, run: (file, args) => ran.push({ file, args }),
  });
  return { srv, up, ran };
};
const settle = async (up) => { for (let i = 0; i < 100 && ['downloading', 'verifying'].includes(up.status().state); i++) await new Promise((r) => setTimeout(r, 20)); await new Promise((r) => setTimeout(r, 700)); };

test('a verified installer is run silently', async () => {
  const { srv, up, ran } = await setup();
  try {
    assert.equal((await up.start()).state, 'downloading');
    await settle(up);
    assert.equal(up.status().state, 'installing');
    assert.equal(ran.length, 1);
    assert.match(ran[0].file, /RoninFlow-Setup-1\.2\.0\.exe$/);
    assert.ok(ran[0].args.includes('/VERYSILENT'));
  } finally { srv.close(); }
});

test('a download that doesn’t match the checksum is never run', async () => {
  const { srv, up, ran } = await setup({ sums: `${'0'.repeat(64)}  RoninFlow-Setup-1.2.0.exe\n` });
  try {
    await up.start(); await settle(up);
    assert.equal(up.status().state, 'error');
    assert.match(up.status().error, /checksum/);
    assert.equal(ran.length, 0);
  } finally { srv.close(); }
});

test('a release without SHA256SUMS.txt is refused', async () => {
  const { srv, up, ran } = await setup({ sums: null });
  try {
    await assert.rejects(up.start(), /SHA256SUMS/);
    assert.equal(ran.length, 0);
  } finally { srv.close(); }
});

test('Docker / source copies can’t self-update', async () => {
  const up = createUpdater({ root: '/app', version: '1.1.0', newer, platform: 'linux', execPath: '/usr/bin/node', env: { TJ_DOCKER: '1' }, getRelease: async () => ({}) });
  assert.equal(up.status().canAutoUpdate, false);
  await assert.rejects(up.start(), /can’t update itself/);
});
