// Crypto exchanges and stock / forex brokers that the journal server polls with the user's own read-only keys.
// Same contract as connect-apis.js: each factory returns { test(), poll({ since }) } and poll() hands back
// fills (paired into trades by the connector inbox) and/or finished trades, plus balances.
//
//   bybit        Bybit V5            GET /v5/execution/list (linear + spot, 7-day windows), /v5/account/wallet-balance
//   binance      Binance USDⓈ-M      GET /fapi/v1/income (find traded symbols), /fapi/v1/userTrades, /fapi/v2/account;
//                                    optional spot pairs via api.binance.com /api/v3/myTrades (24-hour windows)
//   okx          OKX V5              GET /api/v5/account/positions-history (closed positions), /api/v5/account/balance
//   hyperliquid  Hyperliquid         POST /info userFillsByTime + clearinghouseState (public — wallet address only)
//   coinbase     Coinbase Advanced   GET /api/v3/brokerage/orders/historical/fills (CDP key, ES256 JWT per request)
//   kraken       Kraken spot         POST /0/private/TradesHistory (API-Sign: HMAC-SHA512)
//   alpaca       Alpaca              GET /v2/account/activities/FILL, /v2/account
//   oanda        OANDA v20           GET /v3/accounts, /v3/accounts/{id}/trades?state=CLOSED, /v3/accounts/{id}/summary
//   tastytrade   tastytrade          OAuth refresh token → GET /accounts/{n}/transactions, /accounts/{n}/balances
//
// Crypto quantities are in coins, so P&L = price move × quantity (pointValue 1). Spot fills are flagged `spot`
// (they can't open shorts), and fills that the exchange reports as closing a position opened before the history
// window carry `closes`, so neither turns into a bogus trade.
import crypto from 'node:crypto';

const UA = 'RoninFlow/1.0 (self-hosted)';
const DAY = 86400e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const STABLE = new Set(['USD', 'USDT', 'USDC', 'BUSD', 'FDUSD', 'DAI', 'USDE', 'TUSD']);

async function req(url, { method = 'GET', headers = {}, body, timeout = 25000 } = {}) {
  const isStr = typeof body === 'string';
  const r = await fetch(url, {
    method,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(body !== undefined && !isStr ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : isStr ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { ok: r.ok, status: r.status, text, json };
}
const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const hmac = (alg, key, data, enc) => crypto.createHmac(alg, key).update(data).digest(enc);
/** Where to start: 30 days back the first time (or the exchange's limit), then a day before the last good check. */
const startFrom = (since, firstDays = 30) => (since ? new Date(since).getTime() - DAY : Date.now() - firstDays * DAY);
const need = (cfg, keys, what) => { for (const k of keys) if (!cfg[k]) throw new Error(`Enter your ${what}`); };
const trim = (s) => String(s || '').replace(/\/+$/, '');

// ====================================================================== Bybit
export function createBybit(cfg) {
  const base = trim(cfg.baseUrl) || (cfg.env === 'testnet' ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com');
  const account = cfg.label || 'Bybit';
  async function get(path, params) {
    need(cfg, ['apiKey', 'apiSecret'], 'API key and secret');
    const query = qs(params);
    const ts = String(Date.now()), recv = '10000';
    const sign = hmac('sha256', cfg.apiSecret, ts + cfg.apiKey + recv + query, 'hex');
    const r = await req(`${base}${path}?${query}`, { headers: { 'X-BAPI-API-KEY': cfg.apiKey, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': recv, 'X-BAPI-SIGN': sign } });
    if (!r.json) throw new Error(`Bybit ${path} → HTTP ${r.status}`);
    if (r.json.retCode !== 0) throw new Error(`Bybit: ${r.json.retMsg || `error ${r.json.retCode}`}`);
    return r.json.result || {};
  }
  async function balances() {
    try {
      const w = await get('/v5/account/wallet-balance', { accountType: 'UNIFIED' });
      const a = w.list?.[0];
      if (a) return [{ account, balance: n(a.totalWalletBalance), openPnl: n(a.totalPerpUPL) }];
    } catch { /* classic accounts: no unified wallet — trades still sync */ }
    return [];
  }
  return {
    async test() { await get('/v5/account/wallet-balance', { accountType: 'UNIFIED' }).catch(async (e) => { if (/accountType|not supported|unified/i.test(e.message)) return get('/v5/execution/list', { category: 'linear', limit: 1 }); throw e; }); return 'Key works · reading perpetuals (USDT/USDC) and spot trades'; },
    async poll({ since }) {
      const fills = [];
      const end = Date.now() + 60e3;
      for (const category of ['linear', 'spot']) {
        for (let from = startFrom(since, 30); from < end; from += 7 * DAY) {
          let cursor;
          for (let page = 0; page < 50; page++) {
            const r = await get('/v5/execution/list', { category, startTime: from, endTime: Math.min(from + 7 * DAY - 1, end), limit: 100, cursor });
            for (const x of r.list || []) {
              if (x.execType && x.execType !== 'Trade') continue; // funding / settlement rows aren't fills
              const price = n(x.execPrice), qty = n(x.execQty);
              if (!qty) continue;
              let fee = n(x.execFee);
              if (category === 'spot') { // spot fees can be charged in the coin bought
                const fc = String(x.feeCurrency || '').toUpperCase();
                if (fc && x.symbol.startsWith(fc) && !STABLE.has(fc)) fee *= price;
                else if (fc && !STABLE.has(fc) && !x.symbol.endsWith(fc)) fee = 0;
              }
              fills.push({ id: `bybit-${x.execId}`, account, symbol: category === 'spot' ? `${x.symbol}-SPOT` : x.symbol, side: x.side, qty, price, time: n(x.execTime), commission: Math.abs(fee),
                pointValue: 1, ...(category === 'spot' ? { spot: true } : n(x.closedSize) > 0 ? { closes: n(x.closedSize) } : {}) });
            }
            cursor = r.nextPageCursor;
            if (!cursor || !(r.list || []).length) break;
          }
        }
      }
      return { fills, balances: await balances(), accounts: [account] };
    },
  };
}

// ====================================================================== Binance (USDⓈ-M futures + optional spot pairs)
export function createBinance(cfg) {
  const fapi = trim(cfg.baseUrl) || 'https://fapi.binance.com';
  const spotBase = trim(cfg.spotUrl) || 'https://api.binance.com';
  const account = cfg.label || 'Binance';
  let offset = 0; // server clock − ours, learned on a timestamp error
  async function get(base, path, params = {}) {
    need(cfg, ['apiKey', 'apiSecret'], 'API key and secret');
    const query = qs({ ...params, recvWindow: 10000, timestamp: Date.now() + offset });
    const sig = hmac('sha256', cfg.apiSecret, query, 'hex');
    const r = await req(`${base}${path}?${query}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': cfg.apiKey } });
    if (r.json?.code === -1021 && offset === 0) { // clock out of sync — ask Binance for its time once
      const t = await req(`${base}${base === fapi ? '/fapi/v1/time' : '/api/v3/time'}`);
      if (t.json?.serverTime) { offset = t.json.serverTime - Date.now(); return get(base, path, params); }
    }
    if (!r.ok || !r.json) throw new Error(`Binance: ${r.json?.msg || `${path} → HTTP ${r.status}`}`);
    return r.json;
  }
  const spotPairs = () => String(cfg.spotSymbols || '').toUpperCase().split(/[\s,;]+/).filter(Boolean);
  return {
    async test() {
      const a = await get(fapi, '/fapi/v2/account');
      const sp = spotPairs();
      return `Futures wallet ${n(a.totalWalletBalance).toFixed(2)} USDT${sp.length ? ` · spot pairs: ${sp.join(', ')}` : ''}`;
    },
    async poll({ since }) {
      const fills = [];
      const end = Date.now() + 60e3;
      const start = Math.max(startFrom(since, 30), Date.now() - 89 * DAY); // Binance keeps ~3 months
      // 1) which futures symbols were traded — every fill pays a commission, so commission income lists them
      const symbols = new Set();
      for (let from = start; from < end; from += 7 * DAY) {
        let s = from;
        const to = Math.min(from + 7 * DAY - 1, end);
        for (let i = 0; i < 20; i++) {
          const rows = await get(fapi, '/fapi/v1/income', { incomeType: 'COMMISSION', startTime: s, endTime: to, limit: 1000 });
          for (const r of rows) if (r.symbol) symbols.add(r.symbol);
          if (rows.length < 1000) break;
          s = Math.max(...rows.map((r) => r.time)) + 1;
        }
      }
      // 2) the fills for each symbol
      for (const symbol of symbols) {
        for (let from = start; from < end; from += 7 * DAY) {
          let s = from;
          const to = Math.min(from + 7 * DAY - 1, end);
          for (let i = 0; i < 20; i++) {
            const rows = await get(fapi, '/fapi/v1/userTrades', { symbol, startTime: s, endTime: to, limit: 1000 });
            for (const x of rows) {
              const ps = x.positionSide || 'BOTH';
              const closing = ps === 'BOTH' ? n(x.realizedPnl) !== 0 : (ps === 'LONG' && x.side === 'SELL') || (ps === 'SHORT' && x.side === 'BUY');
              fills.push({ id: `bnf-${x.id}`, account, symbol: ps === 'BOTH' ? x.symbol : `${x.symbol}-${ps}`, side: x.side, qty: n(x.qty), price: n(x.price), time: x.time,
                commission: STABLE.has(String(x.commissionAsset).toUpperCase()) ? Math.abs(n(x.commission)) : 0, pointValue: 1, ...(closing ? { closes: n(x.qty) } : {}) });
            }
            if (rows.length < 1000) break;
            s = Math.max(...rows.map((r) => r.time)) + 1;
          }
        }
      }
      // 3) spot pairs the user listed (Binance can't list spot symbols traded, and allows 24-hour windows)
      for (const symbol of spotPairs()) {
        for (let from = start; from < end; from += DAY) {
          const rows = await get(spotBase, '/api/v3/myTrades', { symbol, startTime: from, endTime: Math.min(from + DAY - 1, end), limit: 1000 });
          for (const x of rows) {
            const price = n(x.price), ca = String(x.commissionAsset || '').toUpperCase();
            const fee = STABLE.has(ca) || symbol.endsWith(ca) ? n(x.commission) : symbol.startsWith(ca) ? n(x.commission) * price : 0;
            fills.push({ id: `bns-${x.id}`, account, symbol: `${symbol}-SPOT`, side: x.isBuyer ? 'Buy' : 'Sell', qty: n(x.qty), price, time: x.time, commission: Math.abs(fee), pointValue: 1, spot: true });
          }
          await sleep(120);
        }
      }
      let balances = [];
      try { const a = await get(fapi, '/fapi/v2/account'); balances = [{ account, balance: n(a.totalWalletBalance), openPnl: n(a.totalUnrealizedProfit) }]; } catch { /* trades still sync */ }
      return { fills, balances, accounts: [account] };
    },
  };
}

// ====================================================================== OKX (closed positions)
export function createOkx(cfg) {
  const base = trim(cfg.baseUrl) || 'https://www.okx.com';
  const account = cfg.label || 'OKX';
  async function get(path, params = {}) {
    need(cfg, ['apiKey', 'apiSecret', 'passphrase'], 'API key, secret and passphrase');
    const query = qs(params);
    const full = query ? `${path}?${query}` : path;
    const ts = new Date().toISOString();
    const sign = hmac('sha256', cfg.apiSecret, `${ts}GET${full}`, 'base64');
    const headers = { 'OK-ACCESS-KEY': cfg.apiKey, 'OK-ACCESS-SIGN': sign, 'OK-ACCESS-TIMESTAMP': ts, 'OK-ACCESS-PASSPHRASE': cfg.passphrase };
    if (cfg.env === 'demo') headers['x-simulated-trading'] = '1';
    const r = await req(`${base}${full}`, { headers });
    if (!r.json) throw new Error(`OKX ${path} → HTTP ${r.status}`);
    if (String(r.json.code) !== '0') throw new Error(`OKX: ${r.json.msg || `error ${r.json.code}`}`);
    return r.json.data || [];
  }
  return {
    async test() { const b = await get('/api/v5/account/balance'); return `Key works · account equity ${n(b[0]?.totalEq).toFixed(2)} USD`; },
    async poll({ since }) {
      const stopAt = startFrom(since, 90);
      const trades = [];
      let after;
      for (let page = 0; page < 100; page++) {
        const rows = await get('/api/v5/account/positions-history', { limit: 100, after });
        for (const p of rows) {
          const ccy = String(p.ccy || '').toUpperCase();
          if (ccy && !STABLE.has(ccy)) continue; // coin-margined (inverse) P&L isn't in dollars
          const dir = String(p.direction || p.posSide || '').toLowerCase() === 'short' ? 'Short' : 'Long';
          trades.push({ id: `okx-${p.posId}-${p.cTime}`, account, symbol: p.instId, direction: dir, qty: n(p.closeTotalPos) || n(p.openMaxPos),
            entryTime: n(p.cTime), exitTime: n(p.uTime), entryPrice: n(p.openAvgPx), exitPrice: n(p.closeAvgPx), pnl: n(p.realizedPnl), fees: Math.abs(n(p.fee)) });
        }
        if (rows.length < 100) break;
        const oldest = Math.min(...rows.map((p) => n(p.uTime)));
        if (oldest < stopAt) break;
        after = String(oldest);
      }
      let balances = [];
      try { const b = await get('/api/v5/account/balance'); if (b[0]) balances = [{ account, balance: n(b[0].totalEq), openPnl: 0 }]; } catch { /* trades still sync */ }
      return { trades, balances, accounts: [account] };
    },
  };
}

// ====================================================================== Hyperliquid (public, wallet address)
export function createHyperliquid(cfg) {
  const base = trim(cfg.baseUrl) || 'https://api.hyperliquid.xyz';
  const user = String(cfg.address || '').trim().toLowerCase();
  const account = cfg.label || (user ? `Hyperliquid ${user.slice(0, 6)}…${user.slice(-4)}` : 'Hyperliquid');
  const info = async (body) => {
    if (!/^0x[0-9a-f]{40}$/.test(user)) throw new Error('Enter your wallet address (0x… 42 characters)');
    const r = await req(`${base}/info`, { method: 'POST', body });
    if (!r.ok) throw new Error(`Hyperliquid → HTTP ${r.status}`);
    return r.json;
  };
  async function balances() {
    const s = await info({ type: 'clearinghouseState', user });
    const upl = (s?.assetPositions || []).reduce((a, p) => a + n(p.position?.unrealizedPnl), 0);
    return [{ account, balance: n(s?.marginSummary?.accountValue) - upl, openPnl: upl }];
  }
  return {
    async test() { const b = await balances(); return `Wallet found · account value ${(b[0].balance + b[0].openPnl).toFixed(2)} USDC`; },
    async poll({ since }) {
      const fills = [];
      let start = startFrom(since, 90);
      for (let page = 0; page < 10; page++) { // ≤2000 per response; Hyperliquid keeps the latest 10,000
        const rows = (await info({ type: 'userFillsByTime', user, startTime: start })) || [];
        for (const f of rows) {
          const coin = String(f.coin || '');
          if (coin.startsWith('@') || coin.includes('/')) continue; // spot pairs — perps only for now
          const side = f.side === 'B' ? 1 : -1, sz = n(f.sz), sp = n(f.startPosition);
          const closes = sp !== 0 && Math.sign(sp) !== side ? Math.min(sz, Math.abs(sp)) : 0;
          fills.push({ id: `hl-${f.tid}`, account, symbol: `${coin}-PERP`, side: side > 0 ? 'Buy' : 'Sell', qty: sz, price: n(f.px), time: n(f.time),
            commission: Math.abs(n(f.fee)) + Math.abs(n(f.builderFee)), pointValue: 1, ...(closes ? { closes } : {}) });
        }
        if (rows.length < 2000) break;
        start = Math.max(...rows.map((f) => n(f.time))) + 1;
      }
      return { fills, balances: await balances(), accounts: [account] };
    },
  };
}

// ====================================================================== Coinbase Advanced Trade (CDP key → ES256 JWT)
function coinbaseJwt(keyName, pem, method, host, path) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: keyName, nonce: crypto.randomBytes(16).toString('hex'), typ: 'JWT' });
  const body = b64({ iss: 'cdp', nbf: now, exp: now + 120, sub: keyName, uri: `${method} ${host}${path}` });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: pem, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${body}.${sig}`;
}
export function createCoinbase(cfg) {
  const base = trim(cfg.baseUrl) || 'https://api.coinbase.com';
  const host = new URL(base).host;
  const account = cfg.label || 'Coinbase';
  // the key may arrive with real newlines, literal \n, or flattened onto one line by a form field — rebuild the PEM
  const pem = () => {
    const raw = String(cfg.privateKey || '').replace(/\\n/g, '\n').trim();
    const m = raw.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
    if (!m) return raw + '\n';
    const body = m[2].replace(/\s+/g, '');
    return `-----BEGIN ${m[1]}-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END ${m[1]}-----\n`;
  };
  async function get(path, params = {}) {
    need(cfg, ['keyName', 'privateKey'], 'API key name and private key');
    let jwt;
    try { jwt = coinbaseJwt(cfg.keyName.trim(), pem(), 'GET', host, path); } catch { throw new Error('The private key isn’t readable — paste the whole key including the BEGIN/END lines (ECDSA keys only; Ed25519 keys aren’t supported by Coinbase for this API)'); }
    const query = qs(params);
    const r = await req(`${base}${path}${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${jwt}` } });
    if (r.status === 401) throw new Error('Coinbase rejected the key (401) — check the key name and that it has the “View” permission');
    if (!r.ok || !r.json) throw new Error(`Coinbase: ${r.json?.message || r.json?.error || `${path} → HTTP ${r.status}`}`);
    return r.json;
  }
  return {
    async test() { const a = await get('/api/v3/brokerage/accounts', { limit: 50 }); return `Key works · ${(a.accounts || []).length} wallet(s)`; },
    async poll({ since }) {
      const fills = [];
      let cursor;
      const start = new Date(startFrom(since, 90)).toISOString();
      for (let page = 0; page < 200; page++) {
        const r = await get('/api/v3/brokerage/orders/historical/fills', { start_sequence_timestamp: start, limit: 250, cursor });
        for (const f of r.fills || []) {
          if (f.trade_type && f.trade_type !== 'FILL') continue;
          const price = n(f.price);
          const qty = f.size_in_quote ? (price ? n(f.size) / price : 0) : n(f.size);
          if (!qty || !price) continue;
          const pid = String(f.product_id || '');
          const spot = /^[A-Z0-9]+-[A-Z]{3,5}$/.test(pid);
          fills.push({ id: `cb-${f.entry_id || f.trade_id}`, account, symbol: pid, side: f.side, qty, price, time: f.trade_time, commission: Math.abs(n(f.commission)),
            ...(spot ? { spot: true, pointValue: 1 } : /-PERP-INTX$/.test(pid) ? { pointValue: 1 } : {}) });
        }
        cursor = r.cursor;
        if (!cursor || !(r.fills || []).length) break;
      }
      return { fills, accounts: [account] };
    },
  };
}

// ====================================================================== Kraken (spot + margin)
export function createKraken(cfg) {
  const base = trim(cfg.baseUrl) || 'https://api.kraken.com';
  const account = cfg.label || 'Kraken';
  let last = 0;
  async function post(path, params = {}) {
    need(cfg, ['apiKey', 'apiSecret'], 'API key and private key');
    const nonce = Math.max(Date.now() * 1000, last + 1); last = nonce;
    const body = qs({ nonce, ...params });
    let secret;
    try { secret = Buffer.from(cfg.apiSecret.trim(), 'base64'); } catch { throw new Error('The private key isn’t valid base64'); }
    const hash = crypto.createHash('sha256').update(String(nonce) + body).digest();
    const sign = crypto.createHmac('sha512', secret).update(Buffer.concat([Buffer.from(path), hash])).digest('base64');
    const r = await req(`${base}${path}`, { method: 'POST', body, headers: { 'API-Key': cfg.apiKey.trim(), 'API-Sign': sign, 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' } });
    if (!r.json) throw new Error(`Kraken ${path} → HTTP ${r.status}`);
    if (r.json.error?.length) throw new Error(`Kraken: ${r.json.error.join(', ')}`);
    return r.json.result || {};
  }
  return {
    async test() { const r = await post('/0/private/TradesHistory', {}); return `Key works · ${n(r.count)} trade(s) in your history`; },
    async poll({ since }) {
      const fills = [];
      const start = Math.floor(startFrom(since, 90) / 1000);
      let ofs = 0;
      for (let page = 0; page < 200; page++) {
        const r = await post('/0/private/TradesHistory', { start, ofs });
        const rows = Object.entries(r.trades || {});
        for (const [txid, t] of rows) {
          const margin = n(t.margin) > 0;
          fills.push({ id: `kr-${txid}`, account, symbol: margin ? t.pair : `${t.pair}-SPOT`, side: t.type, qty: n(t.vol), price: n(t.price), time: Math.round(n(t.time) * 1000),
            commission: Math.abs(n(t.fee)), pointValue: 1, ...(margin ? {} : { spot: true }) });
        }
        ofs += rows.length;
        if (!rows.length || ofs >= n(r.count)) break;
        await sleep(6000); // Kraken's private API counter refills slowly (2 points per call, ~0.33/s)
      }
      return { fills, accounts: [account] };
    },
  };
}

// ====================================================================== Alpaca
export function createAlpaca(cfg) {
  const base = trim(cfg.baseUrl) || (cfg.env === 'live' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets');
  const account = cfg.label || (cfg.env === 'live' ? 'Alpaca' : 'Alpaca Paper');
  async function get(path, params = {}) {
    need(cfg, ['keyId', 'secretKey'], 'API key ID and secret');
    const query = qs(params);
    const r = await req(`${base}${path}${query ? `?${query}` : ''}`, { headers: { 'APCA-API-KEY-ID': cfg.keyId.trim(), 'APCA-API-SECRET-KEY': cfg.secretKey.trim() } });
    if (r.status === 401 || r.status === 403) throw new Error(`Alpaca rejected the key (${r.status}) — check it’s a ${cfg.env === 'live' ? 'live' : 'paper'} key`);
    if (!r.ok || !r.json) throw new Error(`Alpaca: ${r.json?.message || `${path} → HTTP ${r.status}`}`);
    return r.json;
  }
  const isOption = (s) => /^[A-Z.]{1,6}\d{6}[CP]\d{8}$/.test(s);
  return {
    async test() { const a = await get('/v2/account'); return `Account ${a.account_number || ''} · equity ${n(a.equity).toFixed(2)}`; },
    async poll({ since }) {
      const fills = [];
      let token;
      const after = new Date(startFrom(since, 90)).toISOString();
      for (let page = 0; page < 200; page++) {
        const rows = await get('/v2/account/activities/FILL', { after, direction: 'asc', page_size: 100, page_token: token });
        for (const x of rows) {
          const sym = String(x.symbol || '');
          const crypto_ = sym.includes('/');
          fills.push({ id: `alp-${x.id}`, account, symbol: sym, side: String(x.side).startsWith('buy') ? 'Buy' : 'Sell', qty: n(x.qty), price: n(x.price), time: x.transaction_time,
            commission: 0, pointValue: isOption(sym) ? 100 : 1, ...(crypto_ ? { spot: true } : {}) });
        }
        if (rows.length < 100) break;
        token = rows[rows.length - 1].id;
      }
      let balances = [];
      try { const a = await get('/v2/account'); balances = [{ account, balance: n(a.equity), openPnl: 0 }]; } catch { /* trades still sync */ }
      return { fills, balances, accounts: [account] };
    },
  };
}

// ====================================================================== OANDA v20 (closed trades)
export function createOanda(cfg) {
  const base = trim(cfg.baseUrl) || (cfg.env === 'practice' ? 'https://api-fxpractice.oanda.com' : 'https://api-fxtrade.oanda.com');
  async function get(path, params = {}) {
    need(cfg, ['token'], 'API token');
    const query = qs(params);
    const r = await req(`${base}${path}${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${cfg.token.trim()}`, 'Accept-Datetime-Format': 'RFC3339' } });
    if (r.status === 401) throw new Error(`OANDA rejected the token (401) — check it’s a ${cfg.env === 'practice' ? 'practice (demo)' : 'live'} token`);
    if (!r.ok || !r.json) throw new Error(`OANDA: ${r.json?.errorMessage || `${path} → HTTP ${r.status}`}`);
    return r.json;
  }
  const accountIds = async () => {
    const want = String(cfg.accountId || '').split(/[\s,]+/).filter(Boolean);
    if (want.length) return want;
    return ((await get('/v3/accounts')).accounts || []).map((a) => a.id);
  };
  return {
    async test() { const ids = await accountIds(); return `${ids.length} account(s): ${ids.join(', ')}`; },
    async poll({ since }) {
      const trades = [], balances = [];
      const stopAt = startFrom(since, 90);
      const ids = await accountIds();
      for (const id of ids) {
        let beforeID;
        for (let page = 0; page < 50; page++) {
          const r = await get(`/v3/accounts/${id}/trades`, { state: 'CLOSED', count: 500, beforeID });
          const rows = r.trades || [];
          for (const t of rows) {
            const units = n(t.initialUnits);
            trades.push({ id: `oanda-${id}-${t.id}`, account: id, symbol: t.instrument, direction: units < 0 ? 'Short' : 'Long', qty: Math.abs(units),
              entryTime: t.openTime, exitTime: t.closeTime, entryPrice: n(t.price), exitPrice: n(t.averageClosePrice),
              pnl: n(t.realizedPL) + n(t.financing) + n(t.dividendAdjustment), fees: 0 });
          }
          if (rows.length < 500) break;
          const oldest = rows[rows.length - 1];
          if (new Date(oldest.openTime).getTime() < stopAt) break;
          beforeID = oldest.id;
        }
        try { const s = (await get(`/v3/accounts/${id}/summary`)).account; balances.push({ account: id, balance: n(s.balance), openPnl: n(s.unrealizedPL) }); } catch { /* trades still sync */ }
      }
      return { trades, balances, accounts: ids };
    },
  };
}

// ====================================================================== tastytrade (OAuth refresh token)
export function createTastytrade(cfg) {
  const base = trim(cfg.baseUrl) || (cfg.env === 'sandbox' ? 'https://api.cert.tastyworks.com' : 'https://api.tastyworks.com');
  let token = null, expires = 0;
  async function auth() {
    need(cfg, ['clientSecret', 'refreshToken'], 'client secret and refresh token');
    const r = await req(`${base}/oauth/token`, { method: 'POST', body: { grant_type: 'refresh_token', refresh_token: cfg.refreshToken.trim(), client_secret: cfg.clientSecret.trim() } });
    const j = r.json || {};
    if (!r.ok || !j.access_token) throw new Error(`tastytrade login failed: ${j.error_description || j.error?.message || j.error || `HTTP ${r.status}`} — check the client secret and refresh token`);
    token = j.access_token; expires = Date.now() + (n(j.expires_in) || 900) * 1000 - 60e3;
  }
  async function get(path, params = {}) {
    if (!token || Date.now() > expires) await auth();
    const query = qs(params);
    let r = await req(`${base}${path}${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) { await auth(); r = await req(`${base}${path}${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${token}` } }); }
    if (!r.ok || !r.json) throw new Error(`tastytrade: ${r.json?.error?.message || `${path} → HTTP ${r.status}`}`);
    return r.json;
  }
  const accounts = async () => ((await get('/customers/me/accounts')).data?.items || []).map((i) => i.account?.['account-number']).filter(Boolean);
  const pv = (type) => ({ Equity: 1, 'Equity Option': 100, Cryptocurrency: 1, Bond: undefined })[type];
  return {
    async test() { const a = await accounts(); return `${a.length} account(s): ${a.join(', ')}`; },
    async poll({ since }) {
      const fills = [], balances = [];
      const startDate = new Date(startFrom(since, 90)).toISOString().slice(0, 10);
      const list = await accounts();
      for (const acct of list) {
        for (let page = 0; page < 50; page++) {
          const r = await get(`/accounts/${acct}/transactions`, { 'start-date': startDate, 'per-page': 2000, 'page-offset': page, sort: 'Asc' });
          const items = r.data?.items || [];
          for (const t of items) {
            const type = t['transaction-type'];
            if (type !== 'Trade' && type !== 'Receive Deliver') continue;
            const action = String(t.action || '');
            const qty = n(t.quantity);
            if (!action || !qty || !t.symbol) continue; // cash movements, dividends…
            const fees = ['commission', 'clearing-fees', 'regulatory-fees', 'proprietary-index-option-fees'].reduce((a, k) => a + Math.abs(n(t[k])), 0);
            const it = t['instrument-type'];
            fills.push({ id: `tt-${t.id}`, account: acct, symbol: t.symbol, side: action.startsWith('Buy') ? 'Buy' : 'Sell', qty, price: n(t.price), time: t['executed-at'], commission: fees,
              ...(pv(it) ? { pointValue: pv(it) } : {}), ...(it === 'Cryptocurrency' ? { spot: true } : {}), ...(/to Close$/i.test(action) ? { closes: qty } : {}) });
          }
          const pg = r.pagination || {};
          if (!items.length || (pg['total-pages'] !== undefined && page + 1 >= n(pg['total-pages']))) break;
        }
        try { const b = (await get(`/accounts/${acct}/balances`)).data || {}; balances.push({ account: acct, balance: n(b['net-liquidating-value']), openPnl: 0 }); } catch { /* trades still sync */ }
      }
      return { fills, balances, accounts: list };
    },
  };
}

// ====================================================================== OAuth helpers (Schwab, TradeStation)
/** The code from the address the browser landed on after signing in (the page itself may not load — that's fine). */
function codeFrom(redirected) {
  const raw = String(redirected || '').trim();
  if (!raw) return null;
  try { return new URL(raw).searchParams.get('code'); } catch { return /^[\w.@%-]+$/.test(raw) ? decodeURIComponent(raw) : null; }
}
const fatal = (msg) => Object.assign(new Error(msg), { fatal: true }); // pauses the connection instead of retrying
const form = (o) => qs(o);

// ====================================================================== Charles Schwab (Trader API, OAuth)
export function createSchwab(cfg) {
  const base = trim(cfg.baseUrl) || 'https://api.schwabapi.com';
  const callback = () => String(cfg.callbackUrl || 'https://127.0.0.1').trim();
  let token = null, expires = 0;
  async function tokenCall(body) {
    need(cfg, ['appKey', 'appSecret'], 'App key and secret');
    const basic = Buffer.from(`${cfg.appKey.trim()}:${cfg.appSecret.trim()}`).toString('base64');
    const r = await req(`${base}/v1/oauth/token`, { method: 'POST', body: form(body), headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' } });
    return r;
  }
  async function auth() {
    const code = codeFrom(cfg.redirectUrl);
    if (code && code !== cfg.usedCode) { // first sign-in: swap the one-time code for tokens
      cfg.usedCode = code;
      const r = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: callback() });
      if (!r.ok || !r.json?.refresh_token) throw fatal(`Schwab didn’t accept the sign-in (${r.json?.error_description || r.json?.error || `HTTP ${r.status}`}). The code only lasts about 30 seconds — open the Schwab sign-in again and paste the new address right away.`);
      cfg.refreshToken = r.json.refresh_token; cfg.signedInAt = new Date().toISOString(); cfg.redirectUrl = '';
      token = r.json.access_token; expires = Date.now() + (n(r.json.expires_in) || 1800) * 1000 - 60e3;
      return;
    }
    if (!cfg.refreshToken) throw fatal('Sign in with Schwab first (steps 2 and 3).');
    const r = await tokenCall({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken });
    if (!r.ok || !r.json?.access_token) throw fatal(`Schwab sign-in has expired — Schwab asks you to sign in again every 7 days. Open the Schwab sign-in, paste the new address and press Save & reconnect. (${r.json?.error_description || r.json?.error || `HTTP ${r.status}`})`);
    if (r.json.refresh_token) cfg.refreshToken = r.json.refresh_token;
    token = r.json.access_token; expires = Date.now() + (n(r.json.expires_in) || 1800) * 1000 - 60e3;
  }
  async function get(path, params = {}) {
    if (!token || Date.now() > expires) await auth();
    const query = qs(params);
    let r = await req(`${base}/trader/v1${path}${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) { await auth(); r = await req(`${base}/trader/v1${path}${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${token}` } }); }
    if (!r.ok || !r.json) throw new Error(`Schwab: ${r.json?.message || r.json?.errors?.[0]?.detail || `${path} → HTTP ${r.status}`}`);
    return r.json;
  }
  const daysLeft = () => (cfg.signedInAt ? Math.max(0, 7 - Math.floor((Date.now() - new Date(cfg.signedInAt).getTime()) / DAY)) : null);
  return {
    async test() { const a = await get('/accounts/accountNumbers'); return `${a.length} account(s): ${a.map((x) => `…${String(x.accountNumber).slice(-4)}`).join(', ')} · sign in again within ${daysLeft() ?? 7} days`; },
    async poll({ since }) {
      const fills = [], balances = [], accounts = [];
      const list = await get('/accounts/accountNumbers');
      const start = new Date(startFrom(since, 90)).toISOString(), end = new Date(Date.now() + 60e3).toISOString();
      for (const { accountNumber, hashValue } of list) {
        const acct = String(accountNumber);
        accounts.push(acct);
        const txs = await get(`/accounts/${hashValue}/transactions`, { startDate: start, endDate: end, types: 'TRADE' });
        for (const t of Array.isArray(txs) ? txs : []) {
          const items = t.transferItems || [];
          const fees = items.filter((i) => i.feeType).reduce((a, i) => a + Math.abs(n(i.cost)), 0);
          const legs = items.filter((i) => !i.feeType && i.instrument && !/^CURRENCY/.test(i.instrument.assetType || '') && n(i.amount));
          legs.forEach((i, k) => {
            const it = i.instrument.assetType;
            const cost = n(i.cost), amount = n(i.amount);
            const buy = cost !== 0 ? cost < 0 : amount > 0; // paying cash = buying (futures have no cost, so use the quantity's sign)
            fills.push({ id: `schwab-${t.activityId}-${k}`, account: acct, symbol: i.instrument.symbol, side: buy ? 'Buy' : 'Sell', qty: Math.abs(amount), price: n(i.price), time: t.time,
              commission: k === 0 ? fees : 0, ...(it === 'OPTION' ? { pointValue: 100 } : it === 'FUTURE' ? {} : { pointValue: 1 }), ...(i.positionEffect === 'CLOSING' ? { closes: Math.abs(amount) } : {}) });
          });
        }
        try { const d = await get(`/accounts/${hashValue}`); const b = d.securitiesAccount?.currentBalances || {}; balances.push({ account: acct, balance: n(b.liquidationValue ?? b.cashBalance), openPnl: 0 }); } catch { /* trades still sync */ }
      }
      const left = daysLeft();
      return { fills, balances, accounts, note: left !== null && left <= 1 ? 'Schwab sign-in expires within a day — sign in again' : undefined };
    },
  };
}

// ====================================================================== TradeStation (OAuth)
export function createTradestation(cfg) {
  const base = trim(cfg.baseUrl) || 'https://api.tradestation.com/v3';
  const signin = trim(cfg.signinUrl) || 'https://signin.tradestation.com';
  const callback = () => String(cfg.callbackUrl || 'http://localhost:3000').trim();
  let token = null, expires = 0;
  async function tokenCall(body) {
    need(cfg, ['apiKey', 'apiSecret'], 'API key and secret');
    return req(`${signin}/oauth/token`, { method: 'POST', body: form({ ...body, client_id: cfg.apiKey.trim(), client_secret: cfg.apiSecret.trim() }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  }
  async function auth() {
    const code = codeFrom(cfg.redirectUrl);
    if (code && code !== cfg.usedCode) {
      cfg.usedCode = code;
      const r = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: callback() });
      if (!r.ok || !r.json?.access_token) throw fatal(`TradeStation didn’t accept the sign-in (${r.json?.error_description || r.json?.error || `HTTP ${r.status}`}). Open the TradeStation sign-in again and paste the new address.`);
      if (!r.json.refresh_token) throw fatal('TradeStation didn’t return a refresh token — make sure the sign-in link includes offline_access (use the button here).');
      cfg.refreshToken = r.json.refresh_token; cfg.redirectUrl = '';
      token = r.json.access_token; expires = Date.now() + (n(r.json.expires_in) || 1200) * 1000 - 60e3;
      return;
    }
    if (!cfg.refreshToken) throw fatal('Sign in with TradeStation first (steps 2 and 3).');
    const r = await tokenCall({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken });
    if (!r.ok || !r.json?.access_token) throw fatal(`TradeStation sign-in is no longer valid — sign in again. (${r.json?.error_description || r.json?.error || `HTTP ${r.status}`})`);
    if (r.json.refresh_token) cfg.refreshToken = r.json.refresh_token; // only with rotating tokens
    token = r.json.access_token; expires = Date.now() + (n(r.json.expires_in) || 1200) * 1000 - 60e3;
  }
  async function get(path, params = {}) {
    if (!token || Date.now() > expires) await auth();
    const query = qs(params);
    let r = await req(`${base}${path}${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) { await auth(); r = await req(`${base}${path}${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${token}` } }); }
    if (!r.ok || !r.json) throw new Error(`TradeStation: ${r.json?.Message || r.json?.message || `${path} → HTTP ${r.status}`}`);
    return r.json;
  }
  const pv = (assetType) => (/OPTION/i.test(assetType || '') && !/FUTURE/i.test(assetType || '') ? 100 : /STOCK/i.test(assetType || '') ? 1 : undefined);
  function toFills(orders, out) {
    for (const o of orders || []) {
      const legs = (o.Legs || []).filter((l) => n(l.ExecQuantity) > 0);
      legs.forEach((l, k) => {
        const price = n(l.ExecutionPrice) || n(o.FilledPrice);
        if (!price) return;
        const qty = n(l.ExecQuantity);
        const p = pv(l.AssetType);
        out.push({ id: `ts-${o.OrderID}-${k}`, account: o.AccountID, symbol: l.Symbol, side: /^buy/i.test(l.BuyOrSell || '') ? 'Buy' : 'Sell', qty, price, time: o.ClosedDateTime || o.OpenedDateTime,
          commission: k === 0 ? Math.abs(n(o.CommissionFee)) : 0, ...(p ? { pointValue: p } : {}), ...(/close/i.test(l.OpenOrClose || '') || /To(Cover|Close)$/i.test(l.BuyOrSell || '') ? { closes: qty } : {}) });
      });
    }
  }
  return {
    async test() { const a = (await get('/brokerage/accounts')).Accounts || []; return `${a.length} account(s): ${a.map((x) => `${x.AccountID} (${x.AccountType})`).join(', ')}`; },
    async poll({ since }) {
      const accts = ((await get('/brokerage/accounts')).Accounts || []).map((a) => a.AccountID);
      if (!accts.length) return { fills: [], accounts: [] };
      const ids = accts.join(',');
      const fills = [];
      const sinceDate = new Date(Math.max(startFrom(since, 89), Date.now() - 89 * DAY)).toISOString().slice(0, 10);
      let next;
      for (let page = 0; page < 50; page++) {
        const r = await get(`/brokerage/accounts/${ids}/historicalorders`, { since: sinceDate, pageSize: 600, nextToken: next });
        toFills(r.Orders, fills);
        next = r.NextToken;
        if (!next) break;
      }
      // historical orders stop at yesterday — today's come from the regular orders list
      next = undefined;
      for (let page = 0; page < 20; page++) {
        const r = await get(`/brokerage/accounts/${ids}/orders`, { pageSize: 600, nextToken: next });
        toFills(r.Orders, fills);
        next = r.NextToken;
        if (!next) break;
      }
      let balances = [];
      try { balances = ((await get(`/brokerage/accounts/${ids}/balances`)).Balances || []).map((b) => ({ account: b.AccountID, balance: n(b.Equity ?? b.CashBalance), openPnl: 0 })); } catch { /* trades still sync */ }
      return { fills, balances, accounts: accts };
    },
  };
}

// ====================================================================== Bitget (closed futures positions; classic and unified accounts)
export function createBitget(cfg) {
  const base = trim(cfg.baseUrl) || 'https://api.bitget.com';
  const account = cfg.label || 'Bitget';
  async function get(path, params = {}) {
    need(cfg, ['apiKey', 'apiSecret', 'passphrase'], 'API key, secret and passphrase');
    const query = qs(params);
    const full = query ? `${path}?${query}` : path;
    const ts = String(Date.now());
    const sign = hmac('sha256', cfg.apiSecret, `${ts}GET${full}`, 'base64');
    const r = await req(`${base}${full}`, { headers: { 'ACCESS-KEY': cfg.apiKey, 'ACCESS-SIGN': sign, 'ACCESS-TIMESTAMP': ts, 'ACCESS-PASSPHRASE': cfg.passphrase, locale: 'en-US' } });
    if (!r.json) throw new Error(`Bitget ${path} → HTTP ${r.status}`);
    if (String(r.json.code) !== '00000') throw new Error(`Bitget: ${r.json.msg || `error ${r.json.code}`}`);
    return r.json.data;
  }
  const PRODUCTS = ['USDT-FUTURES', 'USDC-FUTURES'];
  const toTrade = (p, uta) => {
    const dir = String(p.holdSide || p.posSide || '').toLowerCase() === 'short' ? 'Short' : 'Long';
    return { id: `bitget-${p.positionId}`, account, symbol: p.symbol, direction: dir, qty: n(p.closeTotalPos) || n(p.openTotalPos),
      entryTime: n(uta ? p.createdTime : p.ctime), exitTime: n(uta ? p.updatedTime : p.utime),
      entryPrice: n(uta ? p.openPriceAvg : p.openAvgPrice), exitPrice: n(uta ? p.closePriceAvg : p.closeAvgPrice),
      pnl: n(p.netProfit), fees: Math.abs(n(uta ? p.openFeeTotal : p.openFee)) + Math.abs(n(uta ? p.closeFeeTotal : p.closeFee)) };
  };
  async function classic(from, out) {
    for (const productType of PRODUCTS) {
      let idLessThan;
      for (let page = 0; page < 50; page++) {
        const d = await get('/api/v2/mix/position/history-position', { productType, startTime: from, endTime: Date.now(), limit: 100, idLessThan });
        const list = d?.list || [];
        for (const p of list) out.push(toTrade(p, false));
        if (list.length < 100 || !d.endId) break;
        idLessThan = d.endId;
      }
    }
  }
  async function unified(from, out) {
    for (const category of PRODUCTS) {
      for (let s = from; s < Date.now(); s += 30 * DAY) { // windows of at most 30 days
        let cursor;
        for (let page = 0; page < 50; page++) {
          const d = await get('/api/v3/position/history-position', { category, startTime: s, endTime: Math.min(s + 30 * DAY - 1, Date.now()), limit: 100, cursor });
          const list = d?.list || [];
          for (const p of list) out.push(toTrade(p, true));
          if (list.length < 100 || !d.cursor) break;
          cursor = d.cursor;
        }
      }
    }
  }
  // classic and unified (UTA) accounts use different endpoints — use whichever this key's account answers
  async function both(from) {
    const out = [];
    const errs = [];
    await classic(from, out).catch((e) => errs.push(e));
    await unified(from, out).catch((e) => errs.push(e));
    if (errs.length === 2) throw errs[0];
    return out;
  }
  return {
    async test() { const t = await both(Date.now() - 7 * DAY); return `Key works · ${t.length} closed position(s) in the last 7 days`; },
    async poll({ since }) {
      const trades = await both(Math.max(startFrom(since, 89), Date.now() - 89 * DAY));
      let balances = [];
      try {
        const d = await get('/api/v2/mix/account/accounts', { productType: 'USDT-FUTURES' });
        const eq = (d || []).reduce((a, x) => a + n(x.usdtEquity ?? x.accountEquity), 0), upl = (d || []).reduce((a, x) => a + n(x.unrealizedPL), 0);
        if (d?.length) balances = [{ account, balance: eq - upl, openPnl: upl }];
      } catch { /* unified accounts: trades still sync */ }
      return { trades, balances, accounts: [account] };
    },
  };
}

export const MARKET_DEFS = {
  bybit: { name: 'Bybit', every: 2 * 60e3, make: createBybit, secrets: ['apiSecret'] },
  binance: { name: 'Binance', every: 3 * 60e3, make: createBinance, secrets: ['apiSecret'] },
  okx: { name: 'OKX', every: 2 * 60e3, make: createOkx, secrets: ['apiSecret', 'passphrase'] },
  hyperliquid: { name: 'Hyperliquid', every: 60e3, make: createHyperliquid, secrets: [] },
  coinbase: { name: 'Coinbase', every: 2 * 60e3, make: createCoinbase, secrets: ['privateKey'] },
  kraken: { name: 'Kraken', every: 5 * 60e3, make: createKraken, secrets: ['apiSecret'] },
  alpaca: { name: 'Alpaca', every: 60e3, make: createAlpaca, secrets: ['secretKey'] },
  oanda: { name: 'OANDA', every: 60e3, make: createOanda, secrets: ['token'] },
  tastytrade: { name: 'tastytrade', every: 2 * 60e3, make: createTastytrade, secrets: ['clientSecret', 'refreshToken'] },
  schwab: { name: 'Charles Schwab', every: 2 * 60e3, make: createSchwab, secrets: ['appSecret', 'refreshToken', 'usedCode'] },
  tradestation: { name: 'TradeStation', every: 2 * 60e3, make: createTradestation, secrets: ['apiSecret', 'refreshToken', 'usedCode'] },
  bitget: { name: 'Bitget', every: 2 * 60e3, make: createBitget, secrets: ['apiSecret', 'passphrase'] },
};
