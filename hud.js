// Data for the RoninFlow Suite indicators (ATAS, NinjaTrader, Quantower, cTrader, MetaTrader, Sierra Chart): the
// account panel, gamma levels, news feed and pop-ups, in one request so a chart asks once every few seconds:
//
//   GET /api/atas/hud?symbol=NQZ2026&account=ID      (also /api/suite; add &format=tsv for a tab-separated version that
//                                                     MQL and C++ read without a JSON parser)
// MetaTrader indicators can't make web requests, so they drop  Common\Files\TradeJournal\suite-req-<id>.txt  (symbol
// TAB account) and read  suite-<id>.txt  (the TSV), refreshed every couple of seconds while the request file is fresh.
//     → { at, dayStartUtc, market, account: { tier, dailyLoss, trail, enforced, blocked, reason, … } | null,
//         gex: { index, zone, total, flip, callWall, putWall, pos: [..], neg: [..], spot, at, delayed } | null,
//         events: [{ id, t, title, ccy, impact, actual, forecast, previous }], news: [{ id, t, title, src, importance, dir, tags }] }
//
// GEX is worked out in futures prices from the index's options (NQ ← NDX, ES ← SPX, RTY ← RUT); it takes a few
// seconds, so it's refreshed in the background and the last result is served meanwhile.
import { rollStatus, rollAdvice, rootOf } from './rolls.js';
import { rollVolume } from './rollvol.js';
import fs from 'node:fs';
import path from 'node:path';
import { newsMarketOf, NEWS_MARKETS } from './src/lib/newsRules.js';

const FUT_INDEX = [['MNQ', 'NDX'], ['MES', 'SPX'], ['M2K', 'RUT'], ['NQ', 'NDX'], ['ES', 'SPX'], ['RTY', 'RUT']];
// index CFDs (MetaTrader, cTrader) follow the cash index, so they get the levels in index prices
const CASH_INDEX = [['NAS100', 'NDX'], ['US100', 'NDX'], ['USTEC', 'NDX'], ['USTECH', 'NDX'], ['NDX100', 'NDX'], ['US500', 'SPX'], ['SPX500', 'SPX'], ['SP500', 'SPX'], ['USA500', 'SPX'], ['US2000', 'RUT'], ['RUSSELL2000', 'RUT'], ['US2K', 'RUT']];
const indexOf = (symbol) => { const u = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return FUT_INDEX.find(([f]) => u.startsWith(f))?.[1] || null; };
const cashIndexOf = (symbol) => { const u = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return CASH_INDEX.find(([f]) => u.startsWith(f))?.[1] || null; };

export function createHudHandler({ gexApi, newsApi, macroApi, riskApi, log = () => {}, now = () => Date.now() } = {}) {
  const gexCache = new Map(); // index → { at, data, busy }
  let calCache = { at: 0, day: '', events: [] };

  function gexFor(index, cash = false) {
    if (!index || !gexApi?.report) return null;
    const key = cash ? `${index}:cash` : index;
    let c = gexCache.get(key);
    if (!c) gexCache.set(key, (c = { at: 0, data: null, busy: false, error: '' }));
    if (!c.busy && now() - c.at > 90e3) {
      c.busy = true;
      gexApi.report(index, null)
        .then((r) => { c.data = shape(r, cash); c.error = ''; })
        .catch((e) => { c.error = e.message; log('[hud] gex', index, e.message); })
        .finally(() => { c.at = now(); c.busy = false; });
    }
    return c.data ? c.data : c.error ? { index, error: c.error } : null;
  }

  /** The report in futures prices: the walls, the flip, and the biggest other strikes either side. */
  function shape(r, cash = false) {
    const ratio = cash ? 1 : r.fut?.ratio;
    if (!(ratio > 0)) return { index: r.symbol, error: 'no futures price to convert the levels with yet' };
    const x = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * ratio * 4) / 4);
    const spot = r.implied?.spot || r.spot;
    const near = (r.strikes || []).filter((s) => Math.abs(s.strike / spot - 1) <= 0.03 && s.strike !== r.callWall && s.strike !== r.putWall);
    const pos = near.filter((s) => s.net > 0).sort((a, b) => b.net - a.net).slice(0, 3).map((s) => ({ price: x(s.strike), gex: s.net }));
    const neg = near.filter((s) => s.net < 0).sort((a, b) => a.net - b.net).slice(0, 3).map((s) => ({ price: x(s.strike), gex: s.net }));
    return {
      index: r.symbol, zone: r.zone, total: r.total, at: r.at, delayed: !!r.delayed, cashOpen: !!r.cashOpen,
      spot: x(spot), flip: x(r.flip), callWall: x(r.callWall), putWall: x(r.putWall), pos, neg,
      indexFlip: r.flip ? Math.round(r.flip) : null, indexCallWall: r.callWall, indexPutWall: r.putWall,
    };
  }

  async function eventsToday() {
    const d = new Date(now());
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (calCache.day === day && now() - calCache.at < 60e3) return calCache.events;
    try {
      const list = macroApi?.events ? await macroApi.events(day, day) : [];
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), end = start + 86400e3;
      const events = list
        .map((e) => ({ id: e.id, t: Date.parse(e.t), title: e.title, ccy: e.ccy, impact: e.impact, actual: e.actual ?? null, forecast: e.forecast ?? null, previous: e.previous ?? null, allDay: !!e.allDay }))
        .filter((e) => Number.isFinite(e.t) && e.t >= start && e.t < end && !e.allDay && ['high', 'medium', 'low'].includes(e.impact))
        .sort((a, b) => a.t - b.t);
      calCache = { at: now(), day, events };
    } catch (e) {
      log('[hud] calendar', e.message);
      calCache = { ...calCache, at: now() };
    }
    return calCache.events;
  }

  function newsFor(market) {
    if (!newsApi?.flow) return [];
    const { items = [] } = newsApi.flow(18);
    return items
      .filter((x) => !x.repeatOf && !x.under && !x.filler)
      .sort((a, b) => b.t - a.t)
      .slice(0, 40)
      .map((x) => {
        const tags = Object.entries(x.impacts || {}).filter(([, v]) => v).slice(0, 10).map(([m, v]) => ({ m, dir: v > 0 ? 1 : -1 }));
        if (market && x.impacts?.[market]) tags.sort((a, b) => (a.m === market ? -1 : b.m === market ? 1 : 0));
        return {
          id: x.id, t: x.t, title: x.title, src: x.src, importance: x.importance || 0, dir: market ? Math.sign(x.impacts?.[market] || 0) : 0, tags,
          summary: String(x.summary || '').replace(/\s+/g, ' ').trim().slice(0, 700), link: x.link || '', story: x.storyTitle || '', driver: x.driver || '',
          data: x.data ? { actual: x.data.actual ?? '', forecast: x.data.forecast ?? '', previous: x.data.previous ?? '' } : null,
        };
      });
  }

  function accountFor(id) {
    if (!id || !riskApi?.snapshot) return null;
    const snap = riskApi.snapshot();
    const tier = snap.tiers?.[id];
    const rule = snap.rules.accounts.find((a) => a.account === id);
    const live = snap.status && now() - snap.status.receivedAt < 20e3 && snap.status.enforcing ? snap.status.accounts?.find((a) => a.account === id) : null;
    if (!tier && !rule) return null;
    if (rule?.manualOnly && !tier) return { tier: null, dailyLoss: 0, trail: 0, maxTrades: null, target: null, targetOpen: true, flattenLoss: false, flattenTarget: false, enforced: true, enforcing: !!live, blocked: !!live?.blocked, reason: live?.reason || '', windowed: false, inWindow: true, windowChangeMin: null, manualLock: true };
    return {
      tier: tier ? { name: tier.name, level: tier.level, of: tier.of, color: tier.color } : rule?.tier || null,
      dailyLoss: rule?.dailyLoss ?? tier?.dailyLoss ?? 0,
      trail: rule?.trail ?? tier?.trail ?? 0,
      maxTrades: rule?.maxTrades ?? tier?.maxTrades ?? null,
      target: rule?.target ?? tier?.target ?? null,
      targetOpen: (rule?.targetOpen ?? tier?.targetOpen) !== false,
      flattenLoss: rule ? rule.flattenLoss !== false : false,
      flattenTarget: rule ? !!rule.flattenTarget : false,
      enforced: !!rule,
      enforcing: !!live,
      blocked: !!live?.blocked,
      reason: live?.reason || '',
      windowed: !!rule?.windowed,
      inWindow: rule ? rule.inWindow !== false : true,
      windowChangeMin: rule?.windowChangeMin ?? null,
      manualLock: !!rule?.manualLock,
      paused: !!rule?.paused,
    };
  }

  const send = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };

  /** Everything one chart needs. */
  async function build(symbol, account) {
    const market = newsMarketOf(symbol);
    const snap = riskApi?.snapshot?.();
    return {
      at: now(),
      dayStartUtc: snap?.rules?.dayStartUtc ?? null,
      market, marketLabel: market ? NEWS_MARKETS[market]?.short || market : '',
      account: accountFor(account),
      enforcer: !!(snap?.status && now() - snap.status.receivedAt < 20e3 && snap.status.enforcing),
      gex: indexOf(symbol) ? gexFor(indexOf(symbol)) : gexFor(cashIndexOf(symbol), true),
      events: await eventsToday(),
      news: newsFor(market),
      roll: rollFor(symbol),
    };
  }

  /** the chart's contract against the roll calendar: { symbol, phase, to, rollAt, lastAt, lastLabel, days } */
  function rollFor(symbol) {
    try {
      const root = rootOf(symbol);
      if (root) rollVolume.forRoot(root).catch(() => {}); // refresh in the background (cached 20 min)
      const st = rollAdvice(rollStatus(symbol, new Date(now()), { soonDays: 5 }), root ? rollVolume.peek(root) : null);
      if (!st?.held) return null;
      const ms = (d) => Date.parse(`${d}T13:30:00Z`); // the US open, so “days” counts trading mornings
      const c = st.phase === 'roll' || st.phase === 'expired' ? st.held : st.front;
      return { symbol: st.held.symbol, phase: st.phase, to: st.switchTo?.symbol || st.next.symbol, rollAt: ms(c.roll), lastAt: ms(c.last), lastLabel: c.lastLabel, days: st.phase === 'soon' || st.phase === 'hold' ? st.daysToRoll : -(st.daysSinceRoll || 0), reason: st.reason || '', share: st.share == null ? null : Math.round(st.share * 100) };
    } catch { return null; }
  }

  async function handler(req, res) {
    try {
      const u = new URL(req.url, 'http://x');
      const symbol = String(u.searchParams.get('symbol') || '').slice(0, 40);
      const account = String(u.searchParams.get('account') || '').slice(0, 80);
      const data = await build(symbol, account);
      if (u.searchParams.get('format') === 'tsv') {
        res.statusCode = 200; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
        return res.end(toTsv(data));
      }
      return send(res, 200, data);
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }
  handler.build = build;

  /** MetaTrader's file bridge: answer every fresh suite-req-<id>.txt with suite-<id>.txt. */
  handler.startFileBridge = (dirsFn, every = 2000) => {
    let busy = false;
    const round = async () => {
      if (busy) return;
      busy = true;
      try {
        for (const dir of dirsFn()) {
          let names;
          try { names = await fs.promises.readdir(dir); } catch { continue; }
          for (const name of names) {
            const m = name.match(/^suite-req-([\w.-]{1,60})\.txt$/i);
            if (!m) continue;
            const file = path.join(dir, name);
            try {
              const st = await fs.promises.stat(file);
              if (now() - st.mtimeMs > 90e3) continue; // that chart has gone quiet
              const [symbol = '', account = ''] = (await fs.promises.readFile(file, 'utf8')).replace(/^\uFEFF/, '').trim().split('\t');
              const out = path.join(dir, `suite-${m[1]}.txt`);
              const tmp = `${out}.tmp`;
              await fs.promises.writeFile(tmp, toTsv(await build(symbol.trim().slice(0, 40), account.trim().slice(0, 80))));
              await fs.promises.rename(tmp, out);
            } catch { /* MetaTrader had the file open: next round */ }
          }
        }
      } finally { busy = false; }
    };
    const t = setInterval(round, every);
    t.unref?.();
    return () => clearInterval(t);
  };
  return handler;
}

const cell = (v) => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' ').trim());
const row = (...xs) => xs.map(cell).join('\t');
const b01 = (v) => (v ? '1' : '0');

/**
 * The same snapshot as tab-separated lines, one record per line (first cell = record type):
 *   RF  version  at  dayStartUtc  market  marketLabel  enforcer
 *   A   tier  level  of  tierColor  dailyLoss  trail  target  maxTrades  enforced  enforcing  blocked  paused  manualLock  inWindow  reason
 *   G   index  zone  total  flip  callWall  putWall  spot  delayed  error
 *   P / Q  price  gex            (biggest positive / negative strikes, futures prices)
 *   E   t  impact  ccy  title  actual  forecast  previous
 *   N   id  t  importance  dir  src  title  link  summary
 */
export function toTsv(d) {
  const lines = [row('RF', 1, d.at, d.dayStartUtc ?? 0, d.market || '', d.marketLabel || '', b01(d.enforcer))];
  const a = d.account;
  if (a) lines.push(row('A', a.tier?.name || '', a.tier?.level ?? 0, a.tier?.of ?? 0, a.tier?.color || '', a.dailyLoss || 0, a.trail || 0, a.target || 0, a.maxTrades || 0, b01(a.enforced), b01(a.enforcing), b01(a.blocked), b01(a.paused), b01(a.manualLock), b01(a.inWindow !== false), a.reason || ''));
  const g = d.gex;
  if (g) {
    lines.push(row('G', g.index || '', g.zone || '', g.total ?? '', g.flip ?? '', g.callWall ?? '', g.putWall ?? '', g.spot ?? '', b01(g.delayed), g.error || ''));
    for (const x of g.pos || []) lines.push(row('P', x.price, x.gex));
    for (const x of g.neg || []) lines.push(row('Q', x.price, x.gex));
  }
  for (const e of d.events || []) lines.push(row('E', e.t, e.impact, e.ccy, e.title, e.actual ?? '', e.forecast ?? '', e.previous ?? ''));
  for (const n of d.news || []) lines.push(row('N', n.id, n.t, n.importance, n.dir, n.src, n.title, n.link, String(n.summary || '').slice(0, 300)));
  return lines.join('\n') + '\n';
}
