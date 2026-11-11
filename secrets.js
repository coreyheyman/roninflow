// Encryption for secrets kept on disk (API keys, broker logins, data-provider keys).
//
// A random 256-bit key is created once in data/secret.key (or taken from the TJ_SECRET_KEY environment variable,
// e.g. in Docker), and secrets are stored with AES-256-GCM. This keeps keys unreadable in backups, synced folders
// and copies of journal files. Anyone who can read data/secret.key as well (full access to this computer) could
// still decrypt them — keep the data folder private.
//
//   const vault = createVault(dataDir)
//   vault.encrypt(obj) → "enc:v1:…"     vault.decrypt(str) → obj
//   vault.get(name) / vault.set(name, value) / vault.del(name) / vault.names()   (data/vault.json)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';

export function createVault(dataDir) {
  const keyFile = path.join(dataDir, 'secret.key');
  const vaultFile = path.join(dataDir, 'vault.json');
  let key;
  if (process.env.TJ_SECRET_KEY) key = crypto.createHash('sha256').update(process.env.TJ_SECRET_KEY).digest();
  else {
    try { key = Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64'); } catch { /* new */ }
    if (!key || key.length !== 32) {
      key = crypto.randomBytes(32);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(keyFile, key.toString('base64'), { mode: 0o600 });
    }
  }
  const encrypt = (value) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
    return PREFIX + Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
  };
  const decrypt = (str) => {
    if (typeof str !== 'string' || !str.startsWith(PREFIX)) return str; // stored before encryption existed
    const buf = Buffer.from(str.slice(PREFIX.length), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  };
  let store = {};
  try { store = JSON.parse(fs.readFileSync(vaultFile, 'utf8')); } catch { /* empty */ }
  const save = () => { fs.writeFileSync(vaultFile + '.tmp', JSON.stringify(store, null, 1), { mode: 0o600 }); fs.renameSync(vaultFile + '.tmp', vaultFile); };
  return {
    encrypt,
    decrypt,
    isEncrypted: (s) => typeof s === 'string' && s.startsWith(PREFIX),
    get(name) { try { return store[name] ? decrypt(store[name]) : null; } catch { return null; } },
    set(name, value) { if (value === null || value === undefined || value === '') delete store[name]; else store[name] = encrypt(value); save(); },
    del(name) { delete store[name]; save(); },
    names: () => Object.keys(store),
  };
}
