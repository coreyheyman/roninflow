// Trading Coach engine.
// Answers from your own journal data locally; if an Anthropic API key is set in
// Customization Settings it sends the same data summary to Claude instead.
import { chat } from './ai';
import {
  summarize, groupByDay, sortByEntry, holdSeconds, fmtHold, fmtMoney, fmtDate, fmtTime12, toDate, WEEKDAYS, pfText, mostTraded, equityCurve, MONTHS_LONG, money0,
  periodMetrics, keyOf,
} from './stats';
import { periodOf, shiftPeriod, inPeriod, commitmentField, reviewPrompts } from './reviews';
import { playbookOf } from './playbook';

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v === Infinity ? 'infinite' : null);
/** Ready-made totals for a period so the model never has to add numbers up itself. */
function periodSummary(trades, p, withDays = false) {
  const list = trades.filter((t) => inPeriod(t, p));
  const x = periodMetrics(list);
  const out = {
    label: p.label, from: p.from, to: p.to,
    netPnl: r2(x.net), trades: x.count, wins: x.wins, losses: x.losses, breakeven: x.be,
    winRatePct: r2(x.winRate), profitFactor: r2(x.profitFactor), performanceRatio: r2(x.perfRatio), romad: r2(x.romad),
    grossProfit: r2(x.grossProfit), grossLoss: r2(x.grossLoss), avgWin: r2(x.avgWin), avgLoss: r2(x.avgLoss), expectancyPerTrade: r2(x.ev),
    maxDrawdown: r2(x.maxDD), tradingDays: x.days, greenDays: x.dayList.filter((d) => d.net > 0).length, redDays: x.dayList.filter((d) => d.net < 0).length,
    bestDay: x.days ? { date: x.dayList.reduce((a, b) => (b.net > a.net ? b : a)).date, netPnl: r2(x.bestDay) } : null,
    worstDay: x.days ? { date: x.dayList.reduce((a, b) => (b.net < a.net ? b : a)).date, netPnl: r2(x.worstDay) } : null,
  };
  if (withDays) {
    let run = 0;
    out.days = x.dayList.map((d) => { run += d.net; return { date: d.date, weekday: WEEKDAYS[toDate(d.date).getDay()], netPnl: r2(d.net), trades: d.count, runningTotal: r2(run) }; });
  }
  return out;
}

const m = (v) => fmtMoney(v, { sign: true });

function drawdown(trades) {
  const curve = equityCurve(trades);
  let peak = 0, maxDd = 0, peakAt = null, troughAt = null, curPeakAt = null;
  for (const p of curve) {
    if (p.y > peak) { peak = p.y; curPeakAt = p.x; }
    const dd = peak - p.y;
    if (dd > maxDd) { maxDd = dd; peakAt = curPeakAt; troughAt = p.x; }
  }
  const last = curve.length ? curve[curve.length - 1].y : 0;
  return { maxDd, current: peak - last, peak, last, peakAt, troughAt };
}

function byKey(trades, keyFn, labelFn = (k) => k) {
  const g = {};
  for (const t of trades) { const k = keyFn(t); (g[k] = g[k] || []).push(t); }
  return Object.entries(g).map(([k, list]) => ({ key: k, label: labelFn(k), ...summarize(list) })).sort((a, b) => b.net - a.net);
}

function revengeTrades(trades) {
  const s = sortByEntry(trades, 'asc');
  const out = [];
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1], cur = s[i];
    const gap = (toDate(cur.entry) - toDate(prev.exit)) / 1000;
    if (prev.pnl < 0 && gap >= 0 && gap < 120 && cur.entry.slice(0, 10) === prev.entry.slice(0, 10)) out.push({ prev, cur, gap });
  }
  return out;
}

export function buildContext(state, trades) {
  const s = summarize(trades);
  const days = groupByDay(trades);
  const dd = drawdown(trades);
  const now = new Date();
  const wk = periodOf('weekly', now), mo = periodOf('monthly', now), qu = periodOf('quarterly', now), yr = periodOf('yearly', now);
  const weeks = []; for (let i = 0, p = wk; i < 8; i++, p = shiftPeriod(p, -1)) weeks.push(p);
  const months = []; for (let i = 0, p = mo; i < 6; i++, p = shiftPeriod(p, -1)) months.push(p);
  return {
    today: keyOf(now),
    periods: {
      thisWeek: periodSummary(trades, wk, true),
      lastWeek: periodSummary(trades, shiftPeriod(wk, -1), true),
      thisMonth: periodSummary(trades, mo),
      lastMonth: periodSummary(trades, shiftPeriod(mo, -1)),
      thisQuarter: periodSummary(trades, qu),
      thisYear: periodSummary(trades, yr),
    },
    weeklyTotals: weeks.map((p) => periodSummary(trades, p)).filter((w) => w.trades),
    monthlyTotals: months.map((p) => periodSummary(trades, p)).filter((w) => w.trades),
    totals: { trades: s.count, net: s.net, winRate: +s.winRate.toFixed(1), profitFactor: s.profitFactor === Infinity ? 'inf' : +s.profitFactor.toFixed(2), avgWin: +s.avgWin.toFixed(2), avgLoss: +s.avgLoss.toFixed(2), holdWinSec: Math.round(s.holdWin), holdLossSec: Math.round(s.holdLoss), maxDrawdown: +dd.maxDd.toFixed(2), currentDrawdown: +dd.current.toFixed(2) },
    sessions: days.slice(0, 30).map((d) => ({ date: d.date, weekday: WEEKDAYS[toDate(d.date).getDay()], net: r2(d.net), trades: d.count, winRate: Math.round(d.winRate), pf: pfText(d.profitFactor), score: d.score, notes: state.diary[d.date]?.notes?.replace(/<[^>]+>/g, ' ').slice(0, 300) || undefined })),
    bySymbol: byKey(trades, (t) => t.symbol).map((x) => ({ symbol: x.key, trades: x.count, net: +x.net.toFixed(2), winRate: Math.round(x.winRate) })),
    byWeekday: byKey(trades, (t) => toDate(t.entry).getDay(), (k) => WEEKDAYS[k]).map((x) => ({ day: x.label, net: +x.net.toFixed(2), trades: x.count })),
    byHour: byKey(trades, (t) => toDate(t.entry).getHours()).map((x) => ({ hour: x.key, net: +x.net.toFixed(2), trades: x.count })),
    byDirection: byKey(trades, (t) => t.direction).map((x) => ({ side: x.key, net: +x.net.toFixed(2), trades: x.count, winRate: Math.round(x.winRate) })),
    strategies: state.strategies.map((st) => ({ name: st.name, ...(() => { const l = trades.filter((t) => t.strategyId === st.id); const q = summarize(l); return { trades: q.count, net: q.net, winRate: Math.round(q.winRate) }; })() })),
    accounts: state.accounts.map((a) => ({ id: a.id, status: a.status, initial: a.initial, net: +summarize(state.trades.filter((t) => t.accountId === a.id)).net.toFixed(2) })),
    recentTrades: sortByEntry(trades).slice(0, 40).map((t) => ({ time: t.entry, symbol: t.symbol, side: t.direction, qty: t.qty, pnl: t.pnl, holdSec: Math.round(holdSeconds(t)), tags: t.tags, notes: t.notes || undefined })),
  };
}

export const coachSystemPrompt = ({ name, tone, context }) => `You are Trading Coach, a trading performance coach inside ${name}'s personal futures trading journal. Tone: ${tone}.

How to answer:
1. Before writing, work out which fields of the journal data answer the question. Use ONLY that data; never invent trades, dates or figures.
2. Numbers — accuracy matters more than anything else:
   - Totals for periods are already calculated: "periods" (thisWeek, lastWeek, thisMonth, lastMonth, thisQuarter, thisYear), "weeklyTotals", "monthlyTotals", "totals", "bySymbol", "byHour", "byWeekday", "byDirection". Quote those numbers exactly. Do NOT add up daily or per-trade values yourself when a total exists — e.g. a week's P&L is periods.thisWeek.netPnl, and each day's "runningTotal" shows the cumulative sum.
   - If you truly must calculate something that isn't provided, do it step by step, then check it by recomputing in a different order. If the two results differ, recompute until they agree. Never state a number you have not verified.
   - Gains and losses: a loss of 78.45 is -78.45; the net is gains plus losses.
   - Money is in US dollars: write it like +$253.45 or -$78.45. Percentages to the nearest whole number.
3. If the user disputes a number, re-check it against the data and say plainly whether they or you are right — don't just agree, and don't defend a wrong figure.
4. Weeks run Monday–Friday. Today is ${context.today}.
5. Keep answers concise (under 220 words), use short paragraphs and "- " bullet lists, and end with one specific, actionable next step.
6. If the data has "reviewFocus", this conversation is about that specific day or period (a coach review you already wrote is in the history). Answer from reviewFocus first — it has every trade, the plan and the notes for it.

Journal data (JSON):
${JSON.stringify(context)}`;

/** Ask the configured AI provider (OpenAI, Gemini, Claude, Ollama). */
export async function askAI({ provider, cfg, tone, name, question, history, context, image, thinking = 'standard' }) {
  const system = coachSystemPrompt({ name, tone, context });
  return chat(provider, cfg, { system, history: history.map((h) => ({ role: h.role, content: h.content })), question, image, thinking });
}

/** Local, data-driven answers for when no API key is configured. */
export function localAnswer(q, state, trades) {
  const t = q.toLowerCase();
  if (!trades.length) return 'There are no trades in the selected context yet. Add or import trades in the **Trading Journal** and I can start analyzing them.';
  const s = summarize(trades);
  const days = groupByDay(trades);
  const has = (...w) => w.some((x) => t.includes(x));

  if (has('today', 'did i do', 'last session', 'yesterday')) {
    const d = days[0];
    const best = [...d.trades].sort((a, b) => b.pnl - a.pnl)[0];
    const worst = [...d.trades].sort((a, b) => a.pnl - b.pnl)[0];
    const rev = revengeTrades(d.trades);
    return [
      `Your latest session was **${fmtDate(d.date)}** (${fmtTime12(d.start)} – ${fmtTime12(d.end)}): **${m(d.net)}** across ${d.count} trades, ${Math.round(d.winRate)}% win rate, profit factor ${pfText(d.profitFactor)}, session score **${d.score}**.`,
      `- Best trade: ${best.symbol} ${best.direction} at ${fmtTime12(best.entry)} → ${m(best.pnl)}`,
      `- Worst trade: ${worst.symbol} ${worst.direction} at ${fmtTime12(worst.entry)} → ${m(worst.pnl)}`,
      rev.length ? `- ${rev.length} trade(s) were entered less than 2 minutes after a loss — a classic re-entry/revenge pattern.` : '- No quick re-entries after losses — good discipline.',
      d.net < 0 ? `**Next step:** write down in your Daily Diary what the losing entries had in common before the next session.` : `**Next step:** note what made this session work so you can repeat it.`,
    ].join('\n');
  }
  if (has('biggest losing', 'worst trade', 'largest loss', 'biggest loss')) {
    const w = [...trades].sort((a, b) => a.pnl - b.pnl)[0];
    const sameDay = sortByEntry(trades.filter((x) => x.entry.slice(0, 10) === w.entry.slice(0, 10)), 'asc');
    const idx = sameDay.findIndex((x) => x.id === w.id);
    const before = sameDay.slice(0, idx);
    const beforeNet = before.reduce((a, x) => a + x.pnl, 0);
    return [
      `Your biggest losing trade was **${w.symbol} ${w.direction}** on **${fmtDate(w.entry)}** at ${fmtTime12(w.entry)}: **${m(w.pnl)}**, held for ${fmtHold(holdSeconds(w))} with ${w.qty} contract(s).`,
      `- It was trade #${idx + 1} of ${sameDay.length} that day; you were ${m(beforeNet)} on the day before taking it.`,
      `- That single loss is ${((Math.abs(w.pnl) / s.grossLoss) * 100).toFixed(1)}% of all gross losses in this context.`,
      `- Your average loss is ${m(s.avgLoss)}, so this was ${(w.pnl / (s.avgLoss || -1)).toFixed(1)}× a normal loser.`,
      w.notes ? `- Your note: “${w.notes}”` : `- There are no notes on this trade — open it in the Trading Journal and record what you saw.`,
      `**Next step:** define a hard per-trade max loss (for example ${m(Math.round(s.avgLoss * 1.5))}) and set a bracket stop before every entry.`,
    ].join('\n');
  }
  if (has('day of the week', 'weekday', 'best day')) {
    const g = byKey(trades, (x) => toDate(x.entry).getDay(), (k) => WEEKDAYS[k]);
    return [
      `By weekday (${s.count} trades):`,
      ...g.map((x) => `- **${x.label}**: ${m(x.net)} over ${x.count} trades, ${Math.round(x.winRate)}% win rate`),
      `Your best day is **${g[0].label}** and your weakest is **${g[g.length - 1].label}**.`,
      `**Next step:** consider sizing down on ${g[g.length - 1].label}s until that day turns positive.`,
    ].join('\n');
  }
  if (has('when do i trade', 'time of day', 'hour', 'best time')) {
    const g = byKey(trades, (x) => toDate(x.entry).getHours(), (k) => `${String(k).padStart(2, '0')}:00–${String(k).padStart(2, '0')}:59`);
    const sortedH = [...g].sort((a, b) => Number(a.key) - Number(b.key));
    return [
      'P&L by entry hour:',
      ...sortedH.map((x) => `- **${x.label}**: ${m(x.net)} (${x.count} trades, ${Math.round(x.winRate)}% win)`),
      `You trade best between **${g[0].label}** and worst between **${g[g.length - 1].label}**.`,
      `**Next step:** restrict new entries to your best window for the next 5 sessions and compare.`,
    ].join('\n');
  }
  if (has('drawdown')) {
    const dd = drawdown(trades);
    const acct = state.accounts.find((a) => a.id === state.settings.account);
    return [
      `Max drawdown in this context: **${m(-dd.maxDd)}** (from the equity peak on ${dd.peakAt ? fmtDate(dd.peakAt) : '—'} to the low on ${dd.troughAt ? fmtDate(dd.troughAt) : '—'}).`,
      `Current drawdown from peak: **${m(-dd.current)}** (peak ${m(dd.peak)}, now ${m(dd.last)}).`,
      acct ? `On a ${fmtMoney(acct.initial, { dp: 0 })} account with a ${fmtMoney(acct.maxDrawdown, { dp: 0 })} max drawdown, you have about **${fmtMoney(Math.max(0, acct.maxDrawdown - dd.current), { dp: 0 })}** of room left from the peak.` : '',
      `**Next step:** set a daily stop at roughly a quarter of your remaining room.`,
    ].filter(Boolean).join('\n');
  }
  if (has('account')) {
    const rows = state.accounts.map((a) => ({ a, s: summarize(state.trades.filter((x) => x.accountId === a.id)) })).sort((x, y) => y.s.net - x.s.net);
    return [
      'Account comparison:',
      ...rows.map(({ a, s: q }) => `- **${a.name}** (${a.status}): ${m(q.net)}, ${q.count} trades, ${Math.round(q.winRate)}% win rate, PF ${pfText(q.profitFactor)}`),
      `**${rows[0].a.name}** is performing best.`,
    ].join('\n');
  }
  if (has('month')) {
    const latest = toDate(days[0].date);
    const key = days[0].date.slice(0, 7);
    const mt = trades.filter((x) => x.entry.startsWith(key));
    const q = summarize(mt);
    const md = groupByDay(mt);
    return [
      `**${MONTHS_LONG[latest.getMonth()]} ${latest.getFullYear()}** so far: ${m(q.net)} across ${md.length} sessions and ${q.count} trades.`,
      `- Win rate ${Math.round(q.winRate)}%, profit factor ${pfText(q.profitFactor)}`,
      `- Green days: ${md.filter((d) => d.net > 0).length}, red days: ${md.filter((d) => d.net < 0).length}`,
      `- Best day: ${fmtDate(md.sort((a, b) => b.net - a.net)[0].date)} (${m(md[0].net)})`,
      `**Next step:** your results are concentrated in a few big days — protect them by capping losses on red days.`,
    ].join('\n');
  }
  if (has('strategy')) {
    if (!state.strategies.length) return 'You have not created any strategies yet, so I cannot attribute P&L to one. Create one in **Strategy**, then assign it to trades from the Trading Journal (open a trade → Strategy).';
    const g = state.strategies.map((st) => ({ st, q: summarize(trades.filter((x) => x.strategyId === st.id)) })).sort((a, b) => b.q.net - a.q.net);
    const none = summarize(trades.filter((x) => !x.strategyId));
    return ['P&L by strategy:', ...g.map(({ st, q }) => `- **${st.name}**: ${m(q.net)} over ${q.count} trades (${Math.round(q.winRate)}% win)`), `- Untagged: ${m(none.net)} over ${none.count} trades`].join('\n');
  }
  if (has('plan', 'stick', 'discipline', 'rules')) {
    const followed = trades.filter((x) => (x.tags || []).includes('Followed plan'));
    const rated = trades.filter((x) => x.rating);
    const rev = revengeTrades(trades);
    const diaryDays = days.filter((d) => state.diary[d.date]?.pre);
    return [
      `Plan adherence signals:`,
      `- ${diaryDays.length} of ${days.length} sessions started with a pre-session check-in in the Daily Diary.`,
      `- ${followed.length} trades tagged “Followed plan”${followed.length ? ` (net ${m(summarize(followed).net)})` : ''}.`,
      `- ${rev.length} trades were re-entries within 2 minutes of a loss (net ${m(rev.reduce((a, r) => a + r.cur.pnl, 0))}).`,
      rated.length ? `- Average execution rating: ${(rated.reduce((a, x) => a + x.rating, 0) / rated.length).toFixed(1)} / 5` : '- No trades have an execution rating yet.',
      `**Next step:** start each session with “Start Trading Session” and tag every trade with “Followed plan” or a mistake tag so this gets measurable.`,
    ].join('\n');
  }
  // default: improvement / mistakes
  const rev = revengeTrades(trades);
  const revNet = rev.reduce((a, r) => a + r.cur.pnl, 0);
  const sides = byKey(trades, (x) => x.direction);
  const hrs = byKey(trades, (x) => toDate(x.entry).getHours(), (k) => `${String(k).padStart(2, '0')}:00`);
  const syms = mostTraded(trades).sort((a, b) => a.pnl - b.pnl);
  const worstSym = syms[0];
  const lossDays = days.filter((d) => d.net < 0);
  const smallLossDays = lossDays.filter((d) => d.net > -150).length;
  const rr = s.avgLoss ? Math.abs(s.avgWin / s.avgLoss) : 0;
  const lines = [
    `Here's what stands out across **${s.count} trades** (${m(s.net)}, ${Math.round(s.winRate)}% win rate, PF ${pfText(s.profitFactor)}):`,
    `- **Win rate is the constraint.** You win ${Math.round(s.winRate)}% of trades but your average winner (${m(s.avgWin)}) is ${rr.toFixed(1)}× your average loser (${m(s.avgLoss)}). That payoff is strong — the losses come from frequency, not size.`,
    `- **You hold winners (${fmtHold(s.holdWin)}) much longer than losers (${fmtHold(s.holdLoss)}).** Good — but losers this short often mean entries without confirmation that get stopped immediately.`,
    rev.length ? `- **${rev.length} quick re-entries after a loss** (within 2 min) netted ${m(revNet)}. A mandatory 2-minute pause after a loss would have removed most of them.` : '',
    `- **${sides[0].key}s** made ${m(sides[0].net)} while **${sides[sides.length - 1].key}s** made ${m(sides[sides.length - 1].net)}.`,
    `- Your weakest hour is **${hrs[hrs.length - 1].label}** (${m(hrs[hrs.length - 1].net)}); your best is **${hrs[0].label}** (${m(hrs[0].net)}).`,
    worstSym && worstSym.pnl < 0 ? `- **${worstSym.symbol}** is your weakest symbol at ${m(worstSym.pnl)} over ${worstSym.count} trades.` : '',
    `- ${lossDays.length} of ${days.length} sessions were red, ${smallLossDays} of them small (under ${money0(150)}) — you're controlling daily damage well.`,
    `**Focus next:** be more selective with entries — fewer, higher-quality setups in your best hour — and enforce a cool-down after every loss.`,
  ];
  return lines.filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- coach reviews (daily diary + review pages)
// ---------- deeper breakdowns for coach reviews ----------
const brief = (list) => { const q = summarize(list); return { trades: q.count, net: r2(q.net), winRate: Math.round(q.winRate), profitFactor: q.profitFactor === Infinity ? 'inf' : +q.profitFactor.toFixed(2), avgTrade: r2(q.count ? q.net / q.count : 0) }; };
const groupBrief = (trades, keyFn, order) => {
  const g = {};
  for (const t of trades) { const k = keyFn(t); if (k == null) continue; (g[k] ||= []).push(t); }
  const rows = Object.entries(g).map(([k, l]) => ({ key: k, ...brief(l) }));
  return order ? rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : rows.sort((a, b) => b.net - a.net);
};
const bucket = (v, edges, labels) => { for (let i = 0; i < edges.length; i++) if (v < edges[i]) return labels[i]; return labels[labels.length - 1]; };

/** Patterns that only show up across many trades: sequence in the day, after wins/losses, hold time, trade count, setups… */
function patternPack(state, trades) {
  const asc = sortByEntry(trades, 'asc');
  const byDay = {};
  for (const t of asc) (byDay[t.entry.slice(0, 10)] ||= []).push(t);
  const seq = [], afterLoss = [], afterWin = [], dayCount = [];
  for (const list of Object.values(byDay)) {
    list.forEach((t, i) => {
      seq.push({ ...t, _n: i < 3 ? `trade #${i + 1} of day` : 'trade #4+ of day' });
      if (i > 0) (list[i - 1].pnl < 0 ? afterLoss : afterWin).push(t);
    });
    const net = list.reduce((a, t) => a + t.pnl, 0);
    dayCount.push({ n: list.length, net });
  }
  const tcLabels = ['1–3 trades', '4–6 trades', '7–10 trades', '11+ trades'];
  const tc = {};
  for (const d of dayCount) { const k = bucket(d.n, [4, 7, 11], tcLabels); (tc[k] ||= { days: 0, net: 0, green: 0 }); tc[k].days++; tc[k].net += d.net; if (d.net > 0) tc[k].green++; }
  const holdLabels = ['under 1 min', '1–5 min', '5–15 min', '15+ min'];
  const blockerRows = {};
  for (const t of trades) for (const b of t.blockers || []) { (blockerRows[b] ||= []).push(t); }
  const stratName = (t) => state.strategies.find((x) => x.id === t.strategyId)?.name || 'No strategy';
  return {
    byTradeOfDay: groupBrief(seq, (t) => t._n, ['trade #1 of day', 'trade #2 of day', 'trade #3 of day', 'trade #4+ of day']),
    nextTradeAfterLoss: brief(afterLoss),
    nextTradeAfterWin: brief(afterWin),
    quickReentriesAfterLoss: (() => { const r = revengeTrades(trades); return { count: r.length, net: r2(r.reduce((a, x) => a + x.cur.pnl, 0)) }; })(),
    byTradesPerDay: tcLabels.filter((k) => tc[k]).map((k) => ({ bucket: k, days: tc[k].days, avgDayNet: r2(tc[k].net / tc[k].days), greenDaysPct: Math.round((tc[k].green / tc[k].days) * 100) })),
    byHoldTime: groupBrief(trades, (t) => bucket(holdSeconds(t), [60, 300, 900], holdLabels), holdLabels),
    bySide: groupBrief(trades, (t) => t.direction),
    bySymbol: groupBrief(trades, (t) => t.symbol),
    byHour: groupBrief(trades, (t) => `${String(toDate(t.entry).getHours()).padStart(2, '0')}:00`).sort((a, b) => a.key.localeCompare(b.key)),
    byWeekday: groupBrief(trades, (t) => WEEKDAYS[toDate(t.entry).getDay()], WEEKDAYS),
    byStrategy: groupBrief(trades, stratName),
    byTag: (() => { const g = {}; for (const t of trades) for (const tag of t.tags || []) (g[tag] ||= []).push(t); return Object.entries(g).map(([k, l]) => ({ tag: k, ...brief(l) })).sort((a, b) => b.trades - a.trades).slice(0, 15); })(),
    byContracts: groupBrief(trades, (t) => `${t.qty} contract${t.qty === 1 ? '' : 's'}`),
    edgeBlockers: Object.entries(blockerRows).map(([k, l]) => ({ blocker: k, ...brief(l) })).sort((a, b) => a.net - b.net),
    tradesWithoutBlockers: brief(trades.filter((t) => !t.blockers?.length)),
  };
}

/** Running P&L: deepest drawdown with when it started and ended. */
function drawdownInfo(trades) {
  let run = 0, peak = 0, peakAt = null, dd = 0, from = null, to = null;
  for (const t of sortByEntry(trades, 'asc')) {
    run += t.pnl;
    if (run > peak) { peak = run; peakAt = t.entry; }
    if (peak - run > dd) { dd = peak - run; from = peakAt; to = t.entry; }
  }
  return { maxDrawdown: r2(dd), from: from?.slice(0, 10) || 'start', to: to?.slice(0, 10) || null, endingPnl: r2(run) };
}

/** Sub-periods (weeks in a month, months in a quarter/year) with full metrics. */
function subPeriods(state, period, trades) {
  const sub = period.type === 'monthly' ? 'weekly' : period.type === 'weekly' ? null : 'monthly';
  if (!sub) return null;
  const out = [];
  let q = periodOf(sub, period.start);
  for (let n = 0; n < 14 && q.from <= period.to; n++, q = shiftPeriod(q, 1)) {
    const l = trades.filter((t) => inPeriod(t, q));
    if (!l.length) continue;
    const m = periodMetrics(l, { blockers: playbookOf(state).blockers });
    const rev = state.reviews?.[`${q.type}:${q.id}`];
    out.push({
      period: q.label, ...brief(l), days: m.days, greenDaysPct: Math.round(m.winDaysPct), disciplinedPct: m.discipline == null ? null : Math.round(m.discipline), maxDrawdown: r2(m.maxDD),
      commitmentWritten: rev?.answers?.[commitmentField(state, q.type)]?.slice(0, 300) || undefined,
    });
  }
  return out;
}

const strip = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tradeRow = (t, state) => ({
  time: t.entry, symbol: t.symbol, side: t.direction, qty: t.qty, pnl: r2(t.pnl), holdSec: Math.round(holdSeconds(t)),
  edgeBlockers: t.blockers?.length ? t.blockers : undefined, tags: t.tags?.length ? t.tags : undefined,
  strategy: state.strategies.find((s) => s.id === t.strategyId)?.name, rating: t.rating || undefined, notes: t.notes || undefined,
});

/**
 * Focused data for one review: the day (or week / month / quarter / year), what was planned and written,
 * and the period before it for comparison.
 */
export function buildReviewContext(state, { kind, label, date, period, trades, prevTrades = [], extra }) {
  const s = summarize(trades);
  const m = periodMetrics(trades, { blockers: playbookOf(state).blockers });
  const pv = summarize(prevTrades);
  const base = {
    reviewing: label, kind, today: keyOf(new Date()),
    totals: { trades: s.count, netPnl: r2(s.net), winRate: +s.winRate.toFixed(1), profitFactor: s.profitFactor === Infinity ? 'inf' : +s.profitFactor.toFixed(2), avgWin: r2(s.avgWin), avgLoss: r2(s.avgLoss), largestWin: r2(s.largestWin), largestLoss: r2(s.largestLoss), holdWinSec: Math.round(s.holdWin), holdLossSec: Math.round(s.holdLoss), fees: r2(s.fees || 0) },
    discipline: { tradesWithEdgeBlockers: m.flaggedTrades, pnlOfThoseTrades: m.flaggedPnl, disciplinedPct: m.discipline == null ? null : Math.round(m.discipline), maxDrawdown: r2(m.maxDD), maxWinStreakDays: m.maxWinStreak, maxLossStreakDays: m.maxLossStreak },
    quickReentriesAfterLoss: revengeTrades(trades).length,
    bySymbol: byKey(trades, (t) => t.symbol).map((x) => ({ symbol: x.key, trades: x.count, net: r2(x.net), winRate: Math.round(x.winRate) })),
    byHour: byKey(trades, (t) => toDate(t.entry).getHours()).map((x) => ({ hour: x.key, net: r2(x.net), trades: x.count })),
    previousPeriod: prevTrades.length ? { trades: pv.count, netPnl: r2(pv.net), winRate: +pv.winRate.toFixed(1), profitFactor: pv.profitFactor === Infinity ? 'inf' : +pv.profitFactor.toFixed(2) } : null,
  };
  if (kind === 'day') {
    const e = state.diary[date] || {};
    return {
      ...base,
      trades: sortByEntry(trades, 'asc').map((t) => tradeRow(t, state)),
      patterns: (() => { const pp = patternPack(state, trades); return { byTradeOfDay: pp.byTradeOfDay, nextTradeAfterLoss: pp.nextTradeAfterLoss, nextTradeAfterWin: pp.nextTradeAfterWin, byHoldTime: pp.byHoldTime, edgeBlockers: pp.edgeBlockers }; })(),
      drawdown: drawdownInfo(trades),
      preSession: e.pre ? { marketCondition: e.pre.regime ? ((state.settings.playbook?.regimes || []).find((r) => r.id === e.pre.regime)?.name || e.pre.regime) : undefined, bias: e.pre.bias, levels: e.pre.levels, goal: e.pre.goal, focus: e.pre.focus, maxLoss: e.pre.maxLoss, maxTrades: e.pre.maxTrades, mood: e.pre.mood, sleep: e.pre.sleep, news: e.pre.news } : null,
      postSession: e.post ? { tomorrowFocus: e.post.tomorrow, mood: e.post.mood, execution: e.post.execution } : null,
      journalNotes: strip(e.notes).slice(0, 1500) || null,
    };
  }
  if (kind === 'risk') {
    const days = groupByDay(trades);
    return {
      ...base,
      ...extra, // account condition, drawdown, risk tier, thresholds and rules (built on the Risk page)
      ratios: { performanceRatio: m.perfRatio, romad: m.romad, expectancyPerTrade: r2(m.ev), avgWinDay: r2(m.avgWinDay), avgLossDay: r2(m.avgLossDay), greenDaysPct: Math.round(m.winDaysPct) },
      sessions: days.slice(0, 40).map((d) => ({ date: d.date, weekday: WEEKDAYS[toDate(d.date).getDay()], net: r2(d.net), trades: d.count, winRate: Math.round(d.winRate), worstTrade: r2(Math.min(...d.trades.map((t) => t.pnl))), blockers: [...new Set(d.trades.flatMap((t) => t.blockers || []))], tomorrowFocus: state.diary[d.date]?.post?.tomorrow || undefined })),
      biggestLosses: [...trades].sort((a, b) => a.pnl - b.pnl).slice(0, 10).map((t) => tradeRow(t, state)),
      drawdown: drawdownInfo(trades),
      patterns: patternPack(state, trades),
    };
  }
  const days = groupByDay(trades);
  const review = state.reviews?.[`${period.type}:${period.id}`];
  return {
    ...base,
    ratios: { performanceRatio: m.perfRatio, romad: m.romad, expectancyPerTrade: r2(m.ev), avgWinDay: r2(m.avgWinDay), avgLossDay: r2(m.avgLossDay), greenDaysPct: Math.round(m.winDaysPct) },
    days: days.slice(0, 70).map((d) => ({ date: d.date, weekday: WEEKDAYS[toDate(d.date).getDay()], net: r2(d.net), trades: d.count, winRate: Math.round(d.winRate), blockers: [...new Set(d.trades.flatMap((t) => t.blockers || []))], notes: strip(state.diary[d.date]?.notes).slice(0, kind === 'weekly' ? 400 : 160) || undefined, tomorrowFocus: state.diary[d.date]?.post?.tomorrow || undefined })),
    biggestTrades: [...trades].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, kind === 'weekly' ? 12 : 20).map((t) => tradeRow(t, state)),
    bestDays: [...days].sort((a, b) => b.net - a.net).slice(0, 5).map((d) => ({ date: d.date, net: r2(d.net), trades: d.count })),
    worstDays: [...days].sort((a, b) => a.net - b.net).slice(0, 5).map((d) => ({ date: d.date, net: r2(d.net), trades: d.count, blockers: [...new Set(d.trades.flatMap((t) => t.blockers || []))] })),
    drawdown: drawdownInfo(trades),
    subPeriods: subPeriods(state, period, trades),
    patterns: patternPack(state, trades),
    previousPeriodDetail: prevTrades.length ? { ...brief(prevTrades), ...(() => { const pm = periodMetrics(prevTrades, { blockers: playbookOf(state).blockers }); return { disciplinedPct: pm.discipline == null ? null : Math.round(pm.discipline), maxDrawdown: r2(pm.maxDD), greenDaysPct: Math.round(pm.winDaysPct), performanceRatio: pm.perfRatio, avgWinDay: r2(pm.avgWinDay), avgLossDay: r2(pm.avgLossDay) }; })(), patterns: kind === 'weekly' ? undefined : (() => { const pp = patternPack(state, prevTrades); return { byTradeOfDay: pp.byTradeOfDay, byHoldTime: pp.byHoldTime, byStrategy: pp.byStrategy, edgeBlockers: pp.edgeBlockers }; })() } : null,
    accounts: (kind === 'quarterly' || kind === 'yearly') ? state.accounts.map((a) => ({ id: a.id, status: a.status, phase: a.phase, cost: (Number(a.cost) || 0) + (Number(a.fees) || 0) || undefined, boughtInPeriod: (a.purchasedAt || a.createdAt || '').slice(0, 10) >= period.from && (a.purchasedAt || a.createdAt || '').slice(0, 10) <= period.to, tradingNetInPeriod: r2(trades.filter((t) => t.accountId === a.id).reduce((x, t) => x + t.pnl, 0)) })).filter((a) => a.tradingNetInPeriod || a.boughtInPeriod) : undefined,
    payoutsInPeriod: (kind === 'quarterly' || kind === 'yearly' || kind === 'monthly') ? (state.payouts || []).filter((x) => x.date >= period.from && x.date <= period.to).map((x) => ({ date: x.date, account: x.accountId, amount: x.amount, status: x.status })) : undefined,
    writtenReview: review?.answers ? Object.fromEntries(Object.entries(review.answers).filter(([, v]) => v?.trim()).map(([k, v]) => [reviewPrompts(state, kind).find((q) => q.id === k)?.label || k, v.slice(0, 800)])) : null,
  };
}

const REVIEW_SHAPE = {
  risk: { words: '650–900', next: 'week of sessions', sections: [
    ['Account status', 'Where the account stands right now: balance vs start, current drawdown (and how it is measured: drawdownMode), distance to the firm\'s max drawdown (firmMaxDrawdown / roomToFirmMaxDrawdown), the current risk tier and the reasons for it. End with a clear verdict: on track, at risk, or off track — and why.'],
    ['Recent performance', 'The trend across the recent sessions: streaks, green/red days, days that hit the daily loss limit (dailyLossLimitHits), how today is going, and how this compares with the period before (previousPeriod).'],
    ['What is driving it', 'The specific causes in the data — edge blockers, trading after losses, quick re-entries, worst hours/setups/symbols, oversized losers — each with dollars and counts. Also the strengths worth protecting.'],
    ['Risk discipline', 'Did losses and sizing respect the current tier (riskPerTrade, dailyLossLimit)? Name the trades/days that broke it (lossesBiggerThanTierRisk, dailyLossLimitHits) and what that cost.'],
    ['Plan', 'If off track or at risk: a step-by-step plan to get back on track — size to use, daily stop, max trades, what must happen to move up a tier (tierRules) and the dollar milestones (toNextTierUp / nextDrawdownThreshold / toClimbOutOfDrawdownTier / roomToFirmMaxDrawdown). If on track: how to protect the gains and what would justify sizing up.'],
    ['Rules for the next sessions', '3–5 concrete, checkable rules with numbers.'],
  ] },
  day: { words: '400–550', next: 'session', sections: [
    ['Summary', '3–4 sentences: how the session went, whether the plan was followed, and the single most important takeaway.'],
    ['Trade by trade', 'Walk through the session in order, grouping similar trades: what happened and why it matters (entries, exits, sizing, re-entries, blockers). Cite times and P&L.'],
    ['What went well', '2–4 bullets with evidence.'],
    ['What needs work', '2–4 bullets with evidence: edge blockers, quick re-entries after losses, oversized losers, overtrading, gaps between the pre-session plan and what happened.'],
    ['Action items', '2–4 concrete, checkable rules for the next session.'],
  ] },
  weekly: { words: '600–800', next: 'week', sections: [
    ['Summary', '3–5 sentences: the week in a nutshell, the biggest driver of the result, and the key takeaway.'],
    ['Day by day', 'One line per trading day: result and what defined it.'],
    ['What went well', '3–5 bullets with evidence.'],
    ['What needs work', '3–5 bullets with evidence.'],
    ['Patterns', 'What the breakdowns show (trade # of the day, after losses, hold time, hour, setup, symbol, size). Only patterns with enough trades to matter; say how many.'],
    ['Action items', '3–5 concrete, checkable rules for next week, including how to measure each.'],
  ] },
  monthly: { words: '900–1200', next: 'month', sections: [
    ['Summary', 'A short paragraph: the month\'s result, the 2–3 biggest drivers, and whether the trader is improving.'],
    ['The numbers', 'A compact markdown table of the key metrics this month vs last month (net P&L, trades, win rate, profit factor, avg win/loss, green-day %, discipline %, max drawdown) with a one-line read on each meaningful change.'],
    ['Week by week', 'How the month unfolded across subPeriods, and whether weekly commitments were followed.'],
    ['Where the edge is', 'Setups/strategies, symbols, sides, times of day, weekdays and hold times that made money — with trade counts.'],
    ['Where money leaked', 'The specific leaks, each quantified in dollars: edge blockers, trades after losses, quick re-entries, late-session trades, overtrading days, oversized trades, worst days and what they had in common.'],
    ['Behaviour & discipline', 'Discipline trend, which blockers repeat, what the journal notes reveal about mindset, and the gap between plans/commitments and execution.'],
    ['What went well', '3–5 bullets.'],
    ['Action plan for next month', '4–6 process goals: specific, measurable rules (e.g. "max 2 trades after a loss, then stop"), each tied to a leak or strength above, with the metric to track.'],
  ] },
  quarterly: { words: '1100–1500', next: 'quarter', sections: [
    ['Summary', 'A paragraph on the quarter: result, trajectory across the three months, and the defining theme.'],
    ['The numbers', 'Markdown table: this quarter vs previous quarter on the key metrics, plus each month of the quarter as its own column if available.'],
    ['Month by month', 'How each month went and what changed between them; were monthly goals met?'],
    ['Edge analysis', 'Which setups/strategies, symbols, times, weekdays and hold times carry the edge, which are decaying or never had one — with trade counts and dollars. Compare with the previous quarter where possible.'],
    ['Leaks & costs', 'Every recurring leak quantified in dollars over the quarter (blockers, after-loss trading, overtrading, late trades, sizing). Rank them by cost.'],
    ['Behaviour & discipline', 'Discipline trend month to month, repeating blockers, what the notes and written reviews reveal, follow-through on commitments.'],
    ['Risk & capital', 'Drawdowns (depth and dates), account outcomes (passed/breached), costs and payouts if present — is the trader earning the right to size up?'],
    ['What went well', '3–5 bullets.'],
    ['Objectives for next quarter', '4–6 measurable objectives and the rules that support them; what to stop, start and keep doing.'],
  ] },
  yearly: { words: '1300–1800', next: 'year', sections: [
    ['Summary', 'A paragraph on the year: result, the arc of the year, and the trader\'s biggest growth and biggest remaining problem.'],
    ['The numbers', 'Markdown table: key metrics for the year vs the previous year (if any), plus the best and worst month.'],
    ['The year month by month', 'The arc across subPeriods: streaks of good and bad months, turning points and what caused them.'],
    ['Annual expectancy', 'What a typical trade, day and month earned; how consistent that was.'],
    ['Edge decay & creation', 'Setups, symbols, sessions and hold times that gained or lost edge over the year — with trade counts and dollars.'],
    ['The costliest habits', 'Recurring leaks ranked by dollars lost over the year.'],
    ['Behaviour & discipline', 'How discipline and mindset evolved; repeating blockers; follow-through on goals written during the year.'],
    ['Capital & accounts', 'Account outcomes, drawdowns, costs and payouts if present; net return on the money put in.'],
    ['What went well', '3–6 bullets.'],
    ['Strategic plan for next year', '5–7 concrete goals and rules, each tied to evidence above, with how to measure them through the year.'],
  ] },
};

export const reviewSystemPrompt = ({ name, tone, context }) => {
  const shape = REVIEW_SHAPE[context.kind] || REVIEW_SHAPE.day;
  return `You are Trading Coach, an experienced futures trading performance coach inside ${name}'s personal trading journal. Tone: ${tone}.
Write an in-depth coach review of ${context.reviewing} using ONLY the journal data below.

Rules:
- Never invent trades, times, setups or figures. Quote totals and breakdown figures exactly as given; don't re-add them yourself.
- Go beyond restating numbers: explain what they mean, connect related findings (e.g. losses cluster after 7 AM AND on 7+ trade days), and name causes the data supports. Say so when a pattern rests on only a few trades.
- Be specific: every point cites evidence — a date, a time, a trade, a dollar amount, a count, or the trader's own words from notes/reviews.
- Prioritise: lead each section with the most important point. Avoid generic advice that could apply to anyone.
- Money in US dollars like +$253.45 / -$78.45. Percentages rounded.

Structure (markdown, each section title in bold on its own line, then the content; use "- " bullets where it reads better):
${shape.sections.map(([t, d]) => `**${t}** — ${d}`).join('\n')}

Length: about ${shape.words} words. Action items must be concrete enough to check at the end of the next ${shape.next}.

Journal data (JSON):
${JSON.stringify(context)}`;
};

/** Generate a review with the configured AI provider. */
export async function askReview({ provider, cfg, tone, name, context, thinking = 'standard' }) {
  const system = reviewSystemPrompt({ name, tone, context });
  const long = ['monthly', 'quarterly', 'yearly', 'risk'].includes(context.kind);
  // longer periods get more thinking time and room to write (unless thinking is switched off)
  const level = thinking === 'off' ? 'off' : long ? 'deep' : thinking;
  return chat(provider, cfg, { system, history: [], question: `Write the full coach review of ${context.reviewing}.`, thinking: level, maxTokens: long ? 6000 : 3000, longContext: true });
}

/** Data-driven review for when no AI provider is set up. */
export function localReview(context, trades) {
  const t = context.totals;
  const well = [], work = [], act = [];
  const best = [...trades].sort((a, b) => b.pnl - a.pnl)[0];
  const worst = [...trades].sort((a, b) => a.pnl - b.pnl)[0];
  const d = context.discipline;
  if (t.netPnl > 0) well.push(`Finished green at **${m(t.netPnl)}** across ${t.trades} trades.`);
  if (t.winRate >= 50) well.push(`Win rate of **${Math.round(t.winRate)}%**.`);
  if (t.avgWin > Math.abs(t.avgLoss)) well.push(`Winners (${m(t.avgWin)} avg) were bigger than losers (${m(t.avgLoss)} avg).`);
  if (best?.pnl > 0) well.push(`Best trade: ${best.symbol} ${best.direction} at ${fmtTime12(best.entry)} for **${m(best.pnl)}**.`);
  if (d.tradesWithEdgeBlockers === 0 && t.trades) well.push('No edge blockers flagged on any trade.');
  if (t.netPnl < 0) work.push(`Finished red at **${m(t.netPnl)}**.`);
  if (Math.abs(t.avgLoss) > t.avgWin) work.push(`Average loss (${m(t.avgLoss)}) is larger than average win (${m(t.avgWin)}) — reward:risk below 1.`);
  if (d.tradesWithEdgeBlockers) work.push(`${d.tradesWithEdgeBlockers} trade(s) had edge blockers, costing **${m(d.pnlOfThoseTrades)}**.`);
  if (context.quickReentriesAfterLoss) work.push(`${context.quickReentriesAfterLoss} trade(s) entered less than 2 minutes after a loss.`);
  if (worst?.pnl < 0) work.push(`Worst trade: ${worst.symbol} ${worst.direction} at ${fmtTime12(worst.entry)}, **${m(worst.pnl)}**.`);
  if (d.tradesWithEdgeBlockers) act.push('Before every entry, check the trade against your most frequent edge blocker — skip it if it applies.');
  if (context.quickReentriesAfterLoss) act.push('After any loss, wait 5 minutes before the next entry.');
  if (Math.abs(t.avgLoss) > t.avgWin) act.push(`Cap every loss at ${m(Math.round(Math.abs(t.avgWin) || 50))} with a bracket stop set before entry.`);
  act.push('Write one sentence in your journal on what the best trade had in common with your plan.');
  if (context.kind === 'risk' && context.account) {
    const a = context.account;
    const head = `**Account status** — ${a.name}: balance ${a.balance != null ? m(a.balance) : 'n/a'}, drawdown **${m(-context.currentDrawdown)}** (${context.drawdownMode}), tier **${context.riskTier?.name}**.${context.roomToFirmMaxDrawdown != null ? ` ${m(context.roomToFirmMaxDrawdown)} of room before the firm's max drawdown.` : ''}`;
    if (context.dailyLossLimitHits?.length) work.push(`${context.dailyLossLimitHits.length} session(s) hit the daily loss limit.`);
    if (context.lossesBiggerThanTierRisk?.length) { work.push(`${context.lossesBiggerThanTierRisk.length} loss(es) were bigger than the tier's max risk per trade.`); act.unshift(`Keep every loss under ${m(context.riskTier?.riskMax)} — the current tier's max risk per trade.`); }
    act.unshift(`Stop for the day at ${m(-context.riskTier?.dailyLossLimit)}.`);
    return [head, ...localReviewBody(t, well, work, act)].join('\n');
  }
  return [
    `**Summary** — ${t.trades} trades, **${m(t.netPnl)}**, ${Math.round(t.winRate)}% win rate, profit factor ${t.profitFactor}. (Generated from your data — connect an AI provider in the Trading Coach for a full review.)`,
    ...localReviewBody(t, well, work, act),
  ].join('\n');
}
function localReviewBody(t, well, work, act) {
  return [
    '**What went well**', ...(well.length ? well : ['Not much stood out on the positive side this time.']).map((x) => `- ${x}`),
    '**What needs work**', ...(work.length ? work : ['Nothing major — keep executing the same way.']).map((x) => `- ${x}`),
    '**Action items**', ...act.slice(0, 4).map((x) => `- ${x}`),
  ];
}
