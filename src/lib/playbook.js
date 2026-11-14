// Trading playbook: routines, market conditions, edge blockers and the risk-tier engine.
import { groupByDay, summarize, equityCurve, todayKey, toDate, keyOf, money0 } from './stats';

// Generic starting playbook for new journals — everything is editable (Diary → Playbook) and any part can be removed.
export const DEFAULT_PLAYBOOK = {
  preRoutine: [
    { id: 'system', time: '30 min before', title: 'System check', text: 'Open your platform, confirm data feeds and connections, check account limits and load your workspace.' },
    { id: 'mental', time: '25 min before', title: 'Mental calibration', text: "Review yesterday's notes and your current biggest edge blocker." },
    { id: 'levels', time: '15 min before', title: 'Market conditions & levels', text: 'Decide what kind of market it is and mark your key levels.' },
    { id: 'observe', time: 'Open', title: 'Observation', text: 'Let the open settle before taking a trade. Watch how price reacts to your levels.' },
  ],
  postRoutine: [
    { id: 'lockout', title: 'Screenshot your charts and lock the platform' },
    { id: 'report', title: 'Fill out the daily report' },
    { id: 'review', title: 'Review executions and performance' },
    { id: 'tomorrow', title: 'Choose what you will work on tomorrow' },
  ],
  // "market conditions" (stored as `regimes` for compatibility with older journals)
  regimes: [
    { id: 'trend', name: 'Trending', style: 'Directional', color: '#6fb3c0', trigger: 'Price builds higher highs / lower lows away from value and pullbacks are shallow.', confirmation: '' },
    { id: 'range', name: 'Range-bound', style: 'Mean-reverting', color: '#a99ad6', trigger: 'Price rotates between clear highs and lows; breakouts fail and come back inside.', confirmation: '' },
    { id: 'volatile', name: 'Volatile / news', style: 'Fast', color: '#e3a86b', trigger: 'Wide, fast candles around news or a big open gap.', confirmation: '' },
    { id: 'quiet', name: 'Quiet', style: 'Low volume', color: '#8fa3a8', trigger: 'Narrow range and thin volume — holiday or pre-event trade.', confirmation: '' },
  ],
  regimeTime: '',
  blockers: ['Tilt', 'Overtrading', 'Impatience', 'FOMO', 'Bad Sizing', 'Overthinking', 'Moving stops'],
};


export const DEFAULT_RISK = {
  tiers: [
    { id: 't1', name: 'Damage control', dailyLL: 100, riskMin: 25, riskMax: 50, note: 'Damage control, −$2k DD', color: '#f2b98a' },
    { id: 't2', name: 'Risk off', dailyLL: 200, riskMin: 50, riskMax: 100, note: 'Risk off days or −$1k DD', color: '#f3e3b0' },
    { id: 't3', name: 'Normal', dailyLL: 500, riskMin: 100, riskMax: 200, note: 'Normal risk, market-edge aligned, DD recovered', color: '#b5d6a7' },
    { id: 't4', name: 'Elevated', dailyLL: 700, riskMin: 150, riskMax: 300, note: 'Next risk level if deemed appropriate in quarterly risk review', color: '#93c47d' },
  ],
  damageDD: 2000, // drawdown at/over this → tier 1
  riskOffDD: 1000, // drawdown at/over this → tier 2 at most
  maxLossStreak: 2, // consecutive max-loss days before stepping down
  greenMultiple: 1, // a "sizable" green day = net ≥ this × the current tier's daily loss limit
  unlockTop: false, // tier 4 only after a quarterly review
  lookbackDays: 90,
};

export const playbookOf = (state) => { const pb = { ...DEFAULT_PLAYBOOK, ...(state.settings.playbook || {}) }; delete pb.nadro; delete pb.framework; return pb; };
/** The default risk plan (used by every account that doesn't have its own). */
export const defaultRiskOf = (state) => ({ ...DEFAULT_RISK, ...(state.settings.risk || {}), tiers: state.settings.risk?.tiers || DEFAULT_RISK.tiers });
/** An account's own risk plan, or null when it uses the default. */
export const ownRiskOf = (state, id) => (id && id !== 'all' ? state.settings.riskByAccount?.[id] || null : null);
/** The risk plan in force for an account (the selected account by default): its own plan, else the default. */
export function riskOf(state, id = state.settings.account) {
  const own = ownRiskOf(state, id);
  const base = defaultRiskOf(state);
  return own ? { ...DEFAULT_RISK, ...own, tiers: own.tiers?.length ? own.tiers : base.tiers } : base;
}

/** A starting point for an account's own plan, scaled from the default plan to the account's max drawdown. */
export function suggestRisk(base, account) {
  const maxDD = Number(account?.maxDrawdown) || 0;
  const daily = Number(account?.dailyLossLimit) || 0;
  if (!maxDD) return JSON.parse(JSON.stringify(base));
  // the default plan's thresholds as a share of its own worst case, applied to this account's max drawdown
  const ref = Math.max(base.damageDD, 1) / 0.5; // by default "damage control" starts at half the max drawdown
  const k = maxDD / ref;
  const round = (v, step = 5) => Math.max(step, Math.round(v / step) * step);
  const tiers = base.tiers.map((t) => {
    let dailyLL = round(t.dailyLL * k);
    if (daily) dailyLL = Math.min(dailyLL, daily); // never above the firm's daily loss limit
    return { ...t, dailyLL, riskMin: round(t.riskMin * k), riskMax: round(t.riskMax * k) };
  });
  return { ...JSON.parse(JSON.stringify(base)), tiers, damageDD: round(maxDD * 0.5, 50), riskOffDD: round(maxDD * 0.25, 50) };
}

const daysAgoKey = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return keyOf(d); };

/** Performance per market condition over the look-back window (sessions where a condition was logged). */
export function regimeStats(trades, diary, regimes, lookback = 90) {
  const from = daysAgoKey(lookback);
  const days = groupByDay(trades).filter((d) => d.date >= from);
  return regimes.map((r) => {
    const ds = days.filter((d) => diary[d.date]?.pre?.regime === r.id);
    const tr = ds.flatMap((d) => d.trades);
    const s = summarize(tr);
    const up = ds.filter((d) => d.net > 0), dn = ds.filter((d) => d.net < 0);
    const avgUp = up.length ? up.reduce((a, d) => a + d.net, 0) / up.length : 0;
    const avgDn = dn.length ? dn.reduce((a, d) => a + d.net, 0) / dn.length : 0;
    const n = ds.length;
    const ev = n ? (up.length / n) * avgUp + (dn.length / n) * avgDn : 0;
    return { ...r, days: n, winRate: s.winRate, net: s.net, pf: s.profitFactor, avgUp, avgDn, ev, trades: s.count };
  });
}

/** Names of the edge blockers flagged on a trade. */
export const tradeBlockers = (t) => (Array.isArray(t?.blockers) ? t.blockers : []);

/**
 * Edge blockers flagged on individual trades: how many trades each was flagged on, on how many days,
 * and the net P&L of exactly those trades (a trade with two blockers counts toward both).
 */
export function blockerStats(trades, blockers, lookback = 90) {
  const from = daysAgoKey(lookback);
  const rows = blockers.map((b) => ({ name: b, count: 0, days: 0, pnl: 0, dates: new Set() }));
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  for (const t of trades) {
    if (t.entry.slice(0, 10) < from) continue;
    for (const b of tradeBlockers(t)) {
      const row = byName[b];
      if (!row) continue;
      row.count++; row.pnl += t.pnl; row.dates.add(t.entry.slice(0, 10));
    }
  }
  for (const r of rows) { r.days = r.dates.size; delete r.dates; r.pnl = Math.round(r.pnl * 100) / 100; }
  const ranked = [...rows].filter((r) => r.count > 0).sort((a, b) => a.pnl - b.pnl || b.count - a.count);
  return { rows, biggest: ranked[0] || null };
}

/**
 * Risk engine.
 * 1. Drawdown from the account's equity peak caps the tier (≥ damageDD → tier 1, ≥ riskOffDD → tier 2).
 * 2. Day-by-day rules: after `maxLossStreak` consecutive max-loss days step down one tier, then step down again
 *    after every consecutive red day; every sizable green day steps up one tier until normal is reached.
 */
export function riskState(trades, account, risk) {
  const tiers = risk.tiers;
  const normal = risk.unlockTop ? tiers.length - 1 : Math.min(2, tiers.length - 1);
  const curve = equityCurve(trades);
  // account.balanceGap: what the live balance says the trades are missing (missing fills, fees…). We can't tell
  // when it happened, so it's applied from the start: the equity curve is shifted by it, and the drawdown is
  // measured from the starting balance or the highest point of that shifted curve, down to the live balance.
  const gap = Number(account?.balanceGap) || 0;
  // ddMode 'start': drawdown = how far below the starting balance you are (profits above it don't count).
  // ddMode 'hwm' (default): drawdown = how far below the highest balance you are (a trailing high watermark).
  const mode = risk.ddMode === 'start' ? 'start' : 'hwm';
  let peak = 0, peakAt = null;
  if (mode === 'hwm') for (const p of curve) if (p.y + gap > peak) { peak = p.y + gap; peakAt = p.x; }
  const current = (curve.length ? curve[curve.length - 1].y : 0) + gap;
  const dd = Math.max(0, peak - current);

  const sessions = [...groupByDay(trades)].reverse(); // oldest → newest
  let L = normal, mlStreak = 0, reducing = false;
  const history = [];
  const today = todayKey();
  for (const d of sessions) {
    if (d.date === today) continue; // today's result doesn't change today's tier
    const tier = tiers[L];
    const maxLoss = d.net <= -tier.dailyLL * 0.95;
    mlStreak = maxLoss ? mlStreak + 1 : 0;
    if (d.net < 0) {
      if (!reducing && mlStreak >= risk.maxLossStreak) {
        if (L > 0) { L--; history.push({ date: d.date, dir: -1, to: L, why: `${risk.maxLossStreak} consecutive max-loss days` }); }
        reducing = true;
      } else if (reducing) {
        if (L > 0) { L--; history.push({ date: d.date, dir: -1, to: L, why: 'Another consecutive red day' }); }
      }
    } else {
      reducing = false;
      if (d.net >= tier.dailyLL * risk.greenMultiple && L < normal) {
        L++;
        history.push({ date: d.date, dir: 1, to: L, why: `Sizable green day (+${money0(d.net)})` });
      }
    }
  }
  const ruleLevel = L;
  const ddLevel = dd >= risk.damageDD ? 0 : dd >= risk.riskOffDD ? Math.min(1, normal) : normal;
  const level = Math.min(ruleLevel, ddLevel);
  const reasons = [];
  if (ddLevel < normal) reasons.push(`Drawdown of ${money0(dd)} is at or beyond ${money0(dd >= risk.damageDD ? risk.damageDD : risk.riskOffDD)}`);
  if (ruleLevel < normal) reasons.push(history.length ? `${history[history.length - 1].why} on ${history[history.length - 1].date}` : 'Recent losing streak');
  if (!reasons.length) reasons.push(dd > 0 ? `Drawdown ${money0(dd)} is inside your limits and no losing streak is active` : mode === 'start' ? 'Account is at or above its starting balance' : 'Account is at its equity high');

  const todaySess = sessions.find((d) => d.date === today);
  const todayNet = todaySess?.net || 0;
  const tier = tiers[level];
  const remaining = tier.dailyLL + Math.min(0, todayNet);
  const recent = sessions.slice(-10);
  const nextDown = dd >= risk.damageDD ? null : risk.damageDD - dd;
  return {
    level, ruleLevel, ddLevel, normal, tier, tiers, dd, peak, peakAt, current, ddMode: mode, reasons, history: history.slice(-12).reverse(),
    todayNet, remaining, stopNow: remaining <= 0, recent, toRiskOff: dd >= risk.riskOffDD ? null : risk.riskOffDD - dd, toDamage: nextDown,
    balance: (account?.initial || 0) + current,
  };
}

/** Last "What will I do better tomorrow?" written before `date`. */
export function lastTomorrowNote(diary, date) {
  const keys = Object.keys(diary).filter((k) => k < date && diary[k]?.post?.tomorrow).sort();
  const k = keys[keys.length - 1];
  return k ? { date: k, text: diary[k].post.tomorrow } : null;
}

export const isWeekend = (key) => [0, 6].includes(toDate(key).getDay());
