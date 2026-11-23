// Data for the RoninFlow HUD indicator in ATAS (account panel, gamma levels, news feed and pop-ups), in one request
// so a chart asks once every few seconds:
//
//   GET /api/atas/hud?symbol=NQZ2026&account=ID
//     → { at, dayStartUtc, market, account: { tier, dailyLoss, trail, enforced, blocked, reason, … } | null,
//         gex: { index, zone, total, flip, callWall, putWall, pos: [..], neg: [..], spot, at, delayed } | null,
//         events: [{ id, t, title, ccy, impact, actual, forecast, previous }], news: [{ id, t, title, src, importance, dir, tags }] }
//
// GEX is worked out in futures prices from the index's options (NQ ← NDX, ES ← SPX, RTY ← RUT); it takes a few
// seconds, so it's refreshed in the background and the last result is served meanwhile.
import { newsMarketOf, NEWS_MARKETS } from './src/lib/newsRules.js';

const FUT_INDEX = [['MNQ', 'NDX'], ['MES', 'SPX'], ['M2K', 'RUT'], ['NQ', 'NDX'], ['ES', 'SPX'], ['RTY', 'RUT']];
const indexOf = (symbol) => { const u = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return FUT_INDEX.find(([f]) => u.startsWith(f))?.[1] || null; };

export function createHudHandler({ gexApi, newsApi, macroApi, riskApi, log = () => {}, now = () => Date.now() } = {}) {
  const gexCache = new Map(); // index → { at, data, busy }
  let calCache = { at: 0, day: '', events: [] };

  function gexFor(index) {
    if (!index || !gexApi?.report) return null;
    let c = gexCache.get(index);
    if (!c) gexCache.set(index, (c = { at: 0, data: null, busy: false, error: '' }));
    if (!c.busy && now() - c.at > 90e3) {
      c.busy = true;
      gexApi.report(index, null)
        .then((r) => { c.data = shape(r); c.error = ''; })
        .catch((e) => { c.error = e.message; log('[hud] gex', index, e.message); })
        .finally(() => { c.at = now(); c.busy = false; });
    }
    return c.data ? c.data : c.error ? { index, error: c.error } : null;
  }

  /** The report in futures prices: the walls, the flip, and the biggest other strikes either side. */
  function shape(r) {
    const ratio = r.fut?.ratio;
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

  return async function handler(req, res) {
    try {
      const u = new URL(req.url, 'http://x');
      const symbol = String(u.searchParams.get('symbol') || '').slice(0, 40);
      const account = String(u.searchParams.get('account') || '').slice(0, 80);
      const market = newsMarketOf(symbol);
      const snap = riskApi?.snapshot?.();
      return send(res, 200, {
        at: now(),
        dayStartUtc: snap?.rules?.dayStartUtc ?? null,
        market, marketLabel: market ? NEWS_MARKETS[market]?.short || market : '',
        account: accountFor(account),
        enforcer: !!(snap?.status && now() - snap.status.receivedAt < 20e3 && snap.status.enforcing),
        gex: gexFor(indexOf(symbol)),
        events: await eventsToday(),
        news: newsFor(market),
      });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  };
}
