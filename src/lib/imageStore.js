// Chart screenshots: stored on the journal server (data/images, shared with your phone) when it's running,
// otherwise in this browser's IndexedDB. Images saved in IndexedDB earlier are uploaded automatically the first
// time they're shown while the server is available.
const DB = 'iq-journal-images';
const STORE = 'images';
let dbp = null;
const urlCache = new Map();

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
};

/** Downscale very large screenshots (keeps PNG for crisp charts unless it's huge). */
async function prepare(file, max = 2600) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (s === 1 && file.size < 4e6) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b || file), file.size > 4e6 ? 'image/jpeg' : 'image/png', 0.9));
}

let serverP = null;
/** true when /api/data/images exists (journal server running) */
function hasServer() {
  if (!serverP) {
    serverP = fetch('/api/data/images/img_probe_0000', { method: 'HEAD', cache: 'no-store' })
      .then((r) => r.status === 404 && (r.headers.get('content-type') || '').includes('json'))
      .catch(() => false);
  }
  return serverP;
}
const serverUrl = (id) => `/api/data/images/${id}`;
const upload = async (id, blob) => {
  const type = /^image\/(png|jpeg|webp|gif|svg\+xml|bmp)$/.test(blob.type) ? blob.type : 'image/png';
  const r = await fetch(serverUrl(id), { method: 'PUT', headers: { 'content-type': type }, body: blob });
  if (!r.ok) throw new Error(`upload failed (${r.status})`);
};

export async function saveImage(file) {
  const blob = await prepare(file);
  const id = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  if (await hasServer()) await upload(id, blob);
  else await tx('readwrite', (s) => s.put(blob, id));
  return { id, name: file.name || 'screenshot.png', size: blob.size, addedAt: new Date().toISOString() };
}

export async function imageUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const server = await hasServer();
  if (server) {
    const h = await fetch(serverUrl(id), { method: 'HEAD' }).catch(() => null);
    if (h?.ok) { urlCache.set(id, serverUrl(id)); return serverUrl(id); }
  }
  const blob = await tx('readonly', (s) => s.get(id)).catch(() => null);
  if (!blob) return null;
  if (server) {
    try { await upload(id, blob); urlCache.set(id, serverUrl(id)); return serverUrl(id); } catch { /* fall back to local copy */ }
  }
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export async function deleteImage(id) {
  if (await hasServer()) await fetch(serverUrl(id), { method: 'DELETE' }).catch(() => {});
  await tx('readwrite', (s) => s.delete(id)).catch(() => {});
  const u = urlCache.get(id);
  if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
  urlCache.delete(id);
}

export async function imageBlob(id) {
  return tx('readonly', (s) => s.get(id));
}
