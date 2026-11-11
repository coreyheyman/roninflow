// Direct broker / prop-firm connections that the journal server polls, plus the MetaTrader file drop.
// Everything found is handed to the connector inbox (connect.js → ingest), so pairing, de-duplication and the
// journal sync are the same as for add-ons and webhooks.
//
//   projectx   TopstepX / ProjectX Gateway API   — POST /api/Auth/loginKey, /api/Account/search, /api/Trade/search,
//                                                   /api/Contract/searchById   (every minute)
//   tradovate  Tradovate REST API                — /auth/accesstokenrequest (+ renewaccesstoken), /account/list,
//                                                   /fill/list, /order/items, /contract/items   (every minute)
//   ibkr       Interactive Brokers Flex Web Service — SendRequest → GetStatement (XML)   (every 30 minutes)
//   metatrader Files written by the MT4/MT5 Expert Advisors into MetaTrader's shared "Common\Files\TradeJournal"
//              folder (MetaTrader can't make web requests to this PC, so it drops files we pick up)   (every 10 s)
//   ctrader    The cTrader cBot posts to /api/connect/ingest and also writes the same trades to
//              Documents\cAlgo\Data\cBots (backup path in case web requests to this PC are blocked)   (every 10 s)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const UA = 'RoninFlow/1.0 (self-hosted)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(url, { method = 'GET', headers = {}, body, timeout = 20000 } = {}) {
  const r = await fetch(url, {
    method,
    headers: { 'User-Agent': UA, Accept: 'application/json, text/xml, */*', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* xml or text */ }
  return { ok: r.ok, status: r.status, text, json };
}

// ---------- time zones (no library) ----------
function tzOffsetMs(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}
/** Wall-clock parts in a time zone → UTC ISO. */
export function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return new Date(t).toISOString();
}

// ====================================================================== ProjectX / TopstepX
// ProjectX "trades" are fills: side 0 = Buy, 1 = Sell; profitAndLoss is null on opening (half-turn) fills.
const PX_ROOTS = { EP: 'ES', ENQ: 'NQ', MES: 'MES', MNQ: 'MNQ', RTY: 'RTY', M2K: 'M2K', YM: 'YM', MYM: 'MYM', CLE: 'CL', MCLE: 'MCL', GCE: 'GC', MGC: 'MGC', SIE: 'SI', NGE: 'NG', HGE: 'HG', ZB: 'ZB', ZN: 'ZN', '6E': '6E', '6J': '6J', '6B': '6B', '6A': '6A' };
/** "CON.F.US.MNQ.Z25" → "MNQZ25" (fallback when the contract lookup fails). */
export function projectxSymbol(contractId) {
  const p = String(contractId || '').split('.');
  if (p.length >= 5) return `${PX_ROOTS[p[3]] || p[3]}${p[4]}`;
  return String(contractId || '');
}
export function createProjectX(cfg, { log }) {
  const base = (cfg.baseUrl || 'https://api.topstepx.com').replace(/\/+$/, '');
  let token = null, tokenAt = 0;
  const contracts = new Map();
  const call = async (p, body) => {
    if (!token || Date.now() - tokenAt > 20 * 3600e3) await login();
    let r = await http(`${base}${p}`, { method: 'POST', body, headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) { await login(); r = await http(`${base}${p}`, { method: 'POST', body, headers: { Authorization: `Bearer ${token}` } }); }
    if (!r.ok || !r.json) throw new Error(`${p} → HTTP ${r.status}`);
    if (r.json.success === false) throw new Error(`${p}: ${r.json.errorMessage || `error ${r.json.errorCode}`}`);
    return r.json;
  };
  async function login() {
    if (!cfg.userName || !cfg.apiKey) throw new Error('Enter your username and API key');
    const r = await http(`${base}/api/Auth/loginKey`, { method: 'POST', body: { userName: cfg.userName, apiKey: cfg.apiKey } });
    if (!r.ok || !r.json?.success || !r.json.token) throw new Error(r.json?.errorMessage || `Login failed (HTTP ${r.status}${r.json?.errorCode ? `, code ${r.json.errorCode}` : ''}) — check the username and API key`);
    token = r.json.token; tokenAt = Date.now();
  }
  async function contract(id) {
    if (contracts.has(id)) return contracts.get(id);
    let info = { name: projectxSymbol(id), pointValue: undefined };
    try {
      const j = await call('/api/Contract/searchById', { contractId: id });
      const c = j.contract;
      if (c?.name) info = { name: c.name, pointValue: c.tickSize > 0 && c.tickValue > 0 ? c.tickValue / c.tickSize : undefined };
    } catch (e) { log(`[projectx] contract ${id}: ${e.message}`); }
    contracts.set(id, info);
    return info;
  }
  return {
    async test() { await login(); const j = await call('/api/Account/search', { onlyActiveAccounts: true }); return `${(j.accounts || []).length} active account(s): ${(j.accounts || []).map((a) => a.name).join(', ')}`; },
    async poll(state) {
      const j = await call('/api/Account/search', { onlyActiveAccounts: true });
      const accounts = j.accounts || [];
      const since = state.since ? new Date(new Date(state.since).getTime() - 24 * 3600e3) : new Date(Date.now() - 30 * 86400e3); // overlap a day; repeats are ignored
      const fills = [];
      for (const a of accounts) {
        const t = await call('/api/Trade/search', { accountId: a.id, startTimestamp: since.toISOString(), endTimestamp: new Date(Date.now() + 60e3).toISOString() });
        for (const x of t.trades || []) {
          if (x.voided) continue;
          const c = await contract(x.contractId);
          fills.push({ id: `px-${x.id}`, account: a.name, symbol: c.name, side: x.side === 0 ? 'Buy' : 'Sell', qty: x.size, price: x.price, time: x.creationTimestamp, commission: Number(x.fees) || 0, pointValue: c.pointValue });
        }
      }
      return { fills, balances: accounts.map((a) => ({ account: a.name, balance: a.balance })), accounts: accounts.map((a) => a.name) };
    },
  };
}

// ====================================================================== Tradovate
export function createTradovate(cfg, { log, deviceId }) {
  const base = cfg.baseUrl || (cfg.env === 'live' ? 'https://live.tradovateapi.com/v1' : 'https://demo.tradovateapi.com/v1');
  let token = null, expires = 0;
  const orders = new Map(), contractNames = new Map();
  let accountNames = new Map();
  async function auth() {
    if (!cfg.name || !cfg.password) throw new Error('Enter your Tradovate username and password');
    const body = { name: cfg.name, password: cfg.password, appId: cfg.appId || 'Trade Journal', appVersion: '1.0', deviceId, ...(cfg.cid ? { cid: Number(cfg.cid) || cfg.cid } : {}), ...(cfg.sec ? { sec: cfg.sec } : {}) };
    const r = await http(`${base}/auth/accesstokenrequest`, { method: 'POST', body });
    const j = r.json || {};
    if (j['p-ticket']) throw new Error(j['p-captcha'] ? 'Tradovate asked for a captcha — wait about an hour, then try again' : `Tradovate rate limit — try again in ${j['p-time'] || 'a few'} seconds`);
    if (!r.ok || !j.accessToken) throw new Error(j.errorText || `Login failed (HTTP ${r.status}) — check the username, password and API key (cid/sec)`);
    token = j.accessToken; expires = new Date(j.expirationTime || Date.now() + 80 * 60e3).getTime();
  }
  async function ensure() {
    if (!token || Date.now() > expires - 60e3) return auth();
    if (Date.now() > expires - 15 * 60e3) { // renew the same session instead of opening a new one
      const r = await http(`${base}/auth/renewaccesstoken`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok && r.json?.accessToken) { token = r.json.accessToken; expires = new Date(r.json.expirationTime || Date.now() + 80 * 60e3).getTime(); } else await auth();
    }
  }
  const get = async (p) => {
    await ensure();
    let r = await http(`${base}${p}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) { await auth(); r = await http(`${base}${p}`, { headers: { Authorization: `Bearer ${token}` } }); }
    if (r.status === 429) throw new Error('Tradovate rate limit — will retry');
    if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`);
    return r.json;
  };
  const items = async (entity, ids, cache, pick) => {
    const need = [...new Set(ids)].filter((id) => !cache.has(id));
    for (let i = 0; i < need.length; i += 100) {
      const list = await get(`/${entity}/items?ids=${need.slice(i, i + 100).join(',')}`);
      for (const x of list || []) cache.set(x.id, pick(x));
    }
  };
  return {
    async test() { await auth(); const a = await get('/account/list'); return `${(a || []).length} account(s): ${(a || []).map((x) => x.name).join(', ')}`; },
    async poll() {
      const accounts = await get('/account/list');
      accountNames = new Map((accounts || []).map((a) => [a.id, a.name]));
      const fills = (await get('/fill/list') || []).filter((f) => f.active !== false);
      await items('order', fills.map((f) => f.orderId), orders, (o) => o.accountId);
      await items('contract', fills.map((f) => f.contractId), contractNames, (c) => c.name);
      const out = [];
      for (const f of fills) {
        const acc = accountNames.get(orders.get(f.orderId));
        if (!acc) continue; // order not found (yet) — picked up next round
        out.push({ id: `tv-${f.id}`, account: acc, symbol: contractNames.get(f.contractId) || String(f.contractId), side: f.action, qty: f.qty, price: f.price, time: f.timestamp });
      }
      return { fills: out, accounts: [...accountNames.values()] };
    },
  };
}

// ====================================================================== Interactive Brokers Flex
const FLEX = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';
const tag = (xml, name) => (xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i')) || [])[1];
const attrs = (s) => { const o = {}; for (const m of s.matchAll(/(\w+)="([^"]*)"/g)) o[m[1]] = m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'"); return o; };
/** "20261110;093105" | "2026-11-10;09:31:05" | "2026-11-10 09:31:05" | "20261110" → parts, in the statement's zone. */
export function flexTime(v, tz = 'America/New_York') {
  const m = String(v || '').match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[;, T](\d{2}):?(\d{2}):?(\d{2}))?/);
  if (!m) return null;
  return zonedToUtc(+m[1], +m[2], +m[3], +(m[4] || 12), +(m[5] || 0), +(m[6] || 0), tz);
}
/** Flex statement XML → fills. Uses EXECUTION rows when the query includes both order and execution detail. */
export function parseFlex(xml, tz) {
  const rows = [...xml.matchAll(/<Trade\s([^>]*?)\/?>/g)].map((m) => attrs(m[1]));
  const exec = rows.some((r) => r.levelOfDetail === 'EXECUTION') ? rows.filter((r) => r.levelOfDetail === 'EXECUTION') : rows.filter((r) => !r.levelOfDetail || r.levelOfDetail === 'ORDER' || r.levelOfDetail === 'TRADE');
  const fills = [];
  for (const r of exec) {
    const qty = Math.abs(Number(r.quantity));
    const time = flexTime(r.dateTime || (r.tradeDate && `${r.tradeDate};${r.tradeTime || ''}`), tz);
    if (!qty || !time || !r.symbol) continue;
    fills.push({
      id: `ib-${r.ibExecID || r.tradeID || `${r.accountId}-${r.dateTime}-${r.symbol}-${r.quantity}-${r.tradePrice}`}`,
      account: r.accountId || 'IBKR', symbol: r.assetCategory === 'FUT' ? r.symbol : r.symbol, side: /^S/i.test(r.buySell) ? 'Sell' : 'Buy',
      qty, price: Number(r.tradePrice), time, commission: Math.abs(Number(r.ibCommission) || 0), pointValue: Number(r.multiplier) || 1,
    });
  }
  return fills;
}
export function createIbkr(cfg) {
  return {
    async fetchStatement() {
      if (!cfg.token || !cfg.queryId) throw new Error('Enter your Flex token and query ID');
      const flex = cfg.flexUrl || FLEX;
      const s = await http(`${flex}/SendRequest?t=${encodeURIComponent(cfg.token)}&q=${encodeURIComponent(cfg.queryId)}&v=3`);
      if (tag(s.text, 'Status') !== 'Success') throw new Error(`IBKR: ${tag(s.text, 'ErrorMessage') || `HTTP ${s.status}`}${tag(s.text, 'ErrorCode') ? ` (code ${tag(s.text, 'ErrorCode')})` : ''}`);
      const ref = tag(s.text, 'ReferenceCode');
      const url = tag(s.text, 'Url') || tag(s.text, 'url') || `${flex}/GetStatement`;
      for (let i = 0; i < 12; i++) {
        await sleep(i === 0 ? 3000 : 10000);
        const g = await http(`${url}?t=${encodeURIComponent(cfg.token)}&q=${encodeURIComponent(ref)}&v=3`, { timeout: 60000 });
        if (/<FlexQueryResponse/i.test(g.text)) return g.text;
        const code = tag(g.text, 'ErrorCode');
        if (code === '1019' || code === '1018' || code === '1021') continue; // still generating / busy — wait and retry
        throw new Error(`IBKR: ${tag(g.text, 'ErrorMessage') || `HTTP ${g.status}`}${code ? ` (code ${code})` : ''}`);
      }
      throw new Error('IBKR is still generating the statement — will try again later');
    },
    async test() { const xml = await this.fetchStatement(); const f = parseFlex(xml, cfg.tz); return `Statement received · ${f.length} execution(s)`; },
    async poll() { const xml = await this.fetchStatement(); return { fills: parseFlex(xml, cfg.tz) }; },
  };
}

// ====================================================================== file drops (MetaTrader, cTrader)
const listDirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)); } catch { return []; } };
/**
 * macOS / Linux: the Windows user folders inside Wine / CrossOver prefixes, where MetaTrader and Sierra Chart write when
 * they run there — MetaQuotes' own Mac app (a Wine bundle), its Linux install script (~/.mt5), plain Wine, CrossOver
 * bottles, Bottles, PlayOnLinux, Lutris (~/Games) and winetricks prefixes.
 */
export function wineUserDirs(home = os.homedir(), platform = process.platform) {
  if (platform === 'win32') return [];
  const lib = path.join(home, 'Library', 'Application Support');
  const prefixes = [
    path.join(home, '.wine'), path.join(home, '.mt5'), path.join(home, '.mt4'),
    path.join(lib, 'net.metaquotes.wine.metatrader5'), path.join(lib, 'net.metaquotes.wine.metatrader4'),
    ...listDirs(path.join(lib, 'CrossOver', 'Bottles')),
    ...listDirs(path.join(home, '.local', 'share', 'wineprefixes')),
    ...listDirs(path.join(home, '.local', 'share', 'bottles', 'bottles')),
    ...listDirs(path.join(home, '.var', 'app', 'com.usebottles.bottles', 'data', 'bottles', 'bottles')),
    ...listDirs(path.join(home, '.PlayOnLinux', 'wineprefix')),
    ...listDirs(path.join(home, 'Games')),
  ];
  return prefixes.flatMap((p) => listDirs(path.join(p, 'drive_c', 'users')).filter((u) => path.basename(u).toLowerCase() !== 'public'));
}

/** Folders MetaTrader's "Common\Files" may be in (Windows, or Wine / CrossOver on a Mac or Linux; MT_COMMON_DIR overrides). */
export function metatraderDirs() {
  const dirs = [];
  if (process.env.MT_COMMON_DIR) dirs.push(process.env.MT_COMMON_DIR);
  const appdata = process.env.APPDATA || (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Roaming') : null);
  if (appdata) dirs.push(path.join(appdata, 'MetaQuotes', 'Terminal', 'Common', 'Files'));
  for (const u of wineUserDirs()) dirs.push(path.join(u, 'AppData', 'Roaming', 'MetaQuotes', 'Terminal', 'Common', 'Files'));
  return dirs.map((d) => path.join(d, 'TradeJournal'));
}
/** cTrader's algo data folder (Documents\cAlgo\Data\cBots) — a cBot without extra permissions may only write there. */
export function ctraderDirs() {
  const dirs = [];
  if (process.env.CTRADER_DATA_DIR) dirs.push(process.env.CTRADER_DATA_DIR);
  const home = process.env.USERPROFILE || os.homedir();
  for (const docs of [path.join(home, 'Documents'), path.join(home, 'OneDrive', 'Documents')]) dirs.push(path.join(docs, 'cAlgo', 'Data', 'cBots'));
  for (const u of wineUserDirs()) dirs.push(path.join(u, 'Documents', 'cAlgo', 'Data', 'cBots'));
  return dirs;
}
/** The journal's own drop folder (%LOCALAPPDATA%\TradeJournal\drop) — used by add-ons that can write files anywhere (Sierra Chart). */
export function journalDropDirs() {
  const dirs = [];
  if (process.env.TJ_DROP_DIR) dirs.push(process.env.TJ_DROP_DIR);
  const local = process.env.LOCALAPPDATA || (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local') : null);
  if (local) dirs.push(path.join(local, 'TradeJournal', 'drop'));
  for (const u of wineUserDirs()) dirs.push(path.join(u, 'AppData', 'Local', 'TradeJournal', 'drop')); // Sierra Chart under Wine
  return dirs;
}
/** Which journal source a dropped file belongs to, from its name. */
export function dropSource(name) {
  if (/^sierrachart-/i.test(name)) return { source: 'sierrachart', label: 'Sierra Chart' };
  if (/^(trade-journal-)?ctrader-/i.test(name)) return { source: 'ctrader', label: 'cTrader' };
  if (/^mt[45]-/i.test(name)) return { source: 'metatrader', label: 'MetaTrader' };
  return null;
}
function listDrops(dir, depth, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) listDrops(full, depth - 1, out); }
    else if (/\.(jsonl|status\.json)$/i.test(e.name) && dropSource(e.name)) out.push(full);
  }
  return out;
}
export function createDropWatcher({ ingest, setHeartbeat, log, offsets, dirs }) {
  const folders = dirs || (() => [...metatraderDirs().map((d) => [d, 0]), ...ctraderDirs().map((d) => [d, 3]), ...journalDropDirs().map((d) => [d, 0])]);
  return function scan() {
    const seen = new Set();
    for (const [dir, depth] of folders()) {
      for (const file of listDrops(dir, depth, [])) {
        if (seen.has(file)) continue;
        seen.add(file);
        const name = path.basename(file);
        const { source, label } = dropSource(name);
        try {
          if (/\.status\.json$/i.test(name)) {
            // the add-on rewrites this every few seconds while it runs, so the file's age tells us if it's still running
            const mtime = fs.statSync(file).mtimeMs;
            if (offsets[file] === mtime) continue;
            offsets[file] = mtime;
            const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
            if (j && j.account) setHeartbeat(source, { platform: j.platform || label, version: j.version, accounts: [String(j.account)], ...(Number.isFinite(Number(j.balance)) && j.balance !== null && j.balance !== '' ? { balances: [{ account: String(j.account), balance: Number(j.balance), openPnl: Number.isFinite(Number(j.equity)) ? Number(j.equity) - Number(j.balance) : 0 }] } : {}), at: new Date(mtime).toISOString() });
            continue;
          }
          const size = fs.statSync(file).size;
          if (size < (offsets[file] || 0)) offsets[file] = 0; // file was recreated
          const from = offsets[file] || 0;
          if (size <= from) continue;
          const fd = fs.openSync(file, 'r');
          const buf = Buffer.alloc(size - from);
          fs.readSync(fd, buf, 0, buf.length, from);
          fs.closeSync(fd);
          const end = buf.lastIndexOf(10); // last complete line ("\n")
          if (end < 0) continue; // half-written line — wait for the rest
          const text = buf.subarray(0, end + 1).toString('utf8');
          offsets[file] = from + end + 1;
          let bad = 0;
          const trades = text.split('\n').map((l) => l.replace(/^\uFEFF/, '').trim()).filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { bad++; return []; } });
          if (bad) log(`[${source}] ${name}: skipped ${bad} unreadable line(s)`);
          if (trades.length) {
            // lines are either closed trades (entryTime…) or single fills (side + price), which get paired
            const fills = trades.filter((t) => t.entryTime === undefined && t.side !== undefined && t.price !== undefined);
            const closed = trades.filter((t) => !fills.includes(t));
            const res = ingest({ source, platform: trades[0].platform || label, version: trades[0].version, trades: closed, fills });
            if (res.rejected?.length) log(`[${source}] ${res.rejected.length} line(s) rejected: ${res.rejected[0].reason}`);
          }
        } catch (e) { log(`[${source}] ${name}: ${e.message}`); }
      }
    }
  };
}
export const createMetaTraderWatcher = createDropWatcher;

// ====================================================================== scheduler
export const API_DEFS = {
  projectx: { every: 60e3, make: createProjectX, secrets: ['apiKey'] },
  tradovate: { every: 60e3, make: createTradovate, secrets: ['password', 'sec'] },
  ibkr: { every: 30 * 60e3, make: createIbkr, secrets: ['token'] },
};
export const newDeviceId = () => crypto.randomUUID();
