// Risk enforcement for the ATAS add-on (Journal Sync → "Enforce RoninFlow risk rules").
// The app works out each account's rules (its risk tier's daily loss limit, the trailing drawdown, trading windows,
// trade counts…) and posts them here whenever they change; the add-on in ATAS reads them every few seconds and posts
// back what it sees and does, which the app shows under Settings → Risk enforcement.
//
//   POST /api/atas/risk/rules   { tz, accounts: [...] }       ← from the app
//   GET  /api/atas/risk/rules                                  ← from the add-on: the rules + whether each account is
//                                                                 inside its trading window right now
//   POST /api/atas/risk/status  { version, accounts, ... }     ← from the add-on
//   GET  /api/atas/risk/status                                 ← from the app
import fs from 'node:fs';
import path from 'node:path';

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = `${f}.${process.pid}.tmp`; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); };

/** The wall clock in a time zone: { y, m, d, h, min, wd (0 = Sunday), offsetMin }. */
export function zoneClock(tz, at = new Date()) {
  let parts;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }).formatToParts(at).map((x) => [x.type, x.value]));
  } catch {
    return zoneClock(undefined, at);
  }
  const y = Number(parts.year), m = Number(parts.month), d = Number(parts.day), h = Number(parts.hour) % 24, min = Number(parts.minute), s = Number(parts.second);
  const asUtc = Date.UTC(y, m - 1, d, h, min, s);
  const offsetMin = Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { y, m, d, h, min, wd, offsetMin };
}

const toMin = (s) => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Is the wall-clock minute `now` (with weekday `wd`) inside one of the windows? No windows = always. */
export function inWindows(windows, days, now, wd) {
  const list = (windows || []).map((w) => [toMin(w.from), toMin(w.to)]).filter(([a, b]) => a != null && b != null && a !== b);
  const dayOk = (d) => !Array.isArray(days) || !days.length || days.includes(d);
  if (!list.length) return dayOk(wd);
  return list.some(([a, b]) => (a < b ? dayOk(wd) && now >= a && now < b : (now >= a && dayOk(wd)) || (now < b && dayOk((wd + 6) % 7)))); // b < a: runs past midnight
}

/** Minutes until the next window opens or the current one closes (for the add-on's status line), or null. */
export function nextChange(windows, days, now, wd) {
  const inside = inWindows(windows, days, now, wd);
  for (let k = 1; k <= 8 * 1440; k++) {
    const t = now + k, w = (wd + Math.floor(t / 1440)) % 7;
    if (inWindows(windows, days, t % 1440, w) !== inside) return k;
  }
  return null;
}

export function createRiskHandler(dataDir, { log = () => {}, now = () => Date.now() } = {}) {
  const file = path.join(dataDir, 'atas-sync', 'risk.json');
  let rules = readJson(file, { tz: '', accounts: [], tiers: {}, at: 0 });
  let status = null; // the add-on's last report (kept in memory)

  const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
  const body = (req) => new Promise((resolve, reject) => { let t = ''; req.setEncoding('utf8'); req.on('data', (c) => { t += c; if (t.length > 2e6) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(t || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); });

  /** What the add-on gets: every account's rules, with the trading window worked out for right now. */
  function forAddon() {
    const at = new Date(now());
    const c = zoneClock(rules.tz, at);
    const nowMin = c.h * 60 + c.min;
    const dayStartUtc = Date.UTC(c.y, c.m - 1, c.d) - c.offsetMin * 60000; // midnight in your time zone
    return {
      at: rules.at || 0,
      serverUtc: at.getTime(),
      dayStartUtc,
      tz: rules.tz || '',
      accounts: (rules.accounts || []).map((a) => {
        const windowed = (a.windows || []).some((w) => toMin(w.from) != null && toMin(w.to) != null);
        const allowed = inWindows(a.windows, a.days, nowMin, c.wd);
        return { ...a, windowed, inWindow: allowed, windowChangeMin: windowed || (a.days || []).length < 7 ? nextChange(a.windows, a.days, nowMin, c.wd) : null };
      }),
    };
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    const route = url.pathname.replace(/^\/api\/atas\/risk/, '') || '/';
    try {
      if (route === '/rules' && req.method === 'GET') return send(res, 200, forAddon());
      if (route === '/rules' && req.method === 'POST') {
        const b = await body(req);
        const accounts = Array.isArray(b.accounts) ? b.accounts.filter((a) => a && typeof a.account === 'string').slice(0, 200) : [];
        const tiers = b.tiers && typeof b.tiers === 'object' ? b.tiers : {};
        const next = { tz: typeof b.tz === 'string' ? b.tz : '', accounts, tiers, at: now() };
        const changed = JSON.stringify([next.tz, next.accounts, next.tiers]) !== JSON.stringify([rules.tz, rules.accounts, rules.tiers]);
        rules = next;
        if (changed) { writeJson(file, rules); log(`[risk] rules for ${accounts.filter((a) => a.on).length} account(s)`); }
        return send(res, 200, { ok: true });
      }
      if (route === '/status' && req.method === 'POST') {
        const b = await body(req);
        status = { ...b, receivedAt: now() };
        return send(res, 200, { ok: true });
      }
      if (route === '/status' && req.method === 'GET') return send(res, 200, { status, rules: forAddon() });
      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }
  /** For the HUD: the rules as the add-on sees them, every account's tier, and the add-on's last report. */
  handler.snapshot = () => ({ rules: forAddon(), tiers: rules.tiers || {}, status });
  return handler;
}
