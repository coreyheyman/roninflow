// The public demo's snapshot of real macro data (built by scripts/demo-macro-data.mjs when the demo site is published).
// Each file is fetched once; a missing one resolves to null and the demo uses sample data instead.
const cache = new Map();
const base = () => { try { return import.meta.env?.BASE_URL || '/'; } catch { return '/'; } };
export function snap(file) {
  if (!cache.has(file)) cache.set(file, fetch(`${base()}demo-data/${file}`, { cache: 'no-cache' }).then((r) => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : null)).catch(() => null));
  return cache.get(file);
}
