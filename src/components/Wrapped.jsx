import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, Share, Sparkles, Pause, Play } from 'lucide-react';
import { useStore, useAccountTrades } from '../store/store';
import { groupByDay, toDate, keyOf, fmtMoney, fmtCompact, fmtDate, fmtTime12, WEEKDAYS, MONTHS, MONTHS_LONG, periodMetrics, ratioText } from '../lib/stats';
import { REVIEW_TYPES, inPeriod, shiftPeriod, periodOf, reviewKey, commitmentField } from '../lib/reviews';
import { playbookOf } from '../lib/playbook';

const SLIDE_MS = 6500;
const short = (d) => WEEKDAYS[toDate(d).getDay()].slice(0, 3).toUpperCase();

// ---------------------------------------------------------------- slide builder
/** 3–4 slides that fit the day: revenue, win rate, trade of the day, then streak / best symbol / session score. */
function buildSlides({ date, days, initial, today }) {
  const asc = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const i = asc.findIndex((d) => d.date === date);
  const day = asc[i];
  if (!day) return [];
  const prev = i > 0 ? asc[i - 1] : null;
  const lw = new Date(toDate(date)); lw.setDate(lw.getDate() - 7);
  const lastWeek = asc.find((d) => d.date === keyOf(lw)) || null;
  const isToday = date === today;
  const dayLabel = isToday ? 'TODAY' : short(date);
  const yest = new Date(toDate(date)); yest.setDate(yest.getDate() - 1);
  const adjacent = prev && (prev.date === keyOf(yest) || (toDate(date).getDay() === 1 && (toDate(date) - toDate(prev.date)) / 864e5 <= 3));
  const prevLabel = !prev ? 'PREV DAY' : isToday && adjacent ? 'YESTERDAY' : short(prev.date);
  const up = day.net >= 0;
  const slides = [];

  // 1 · Revenue
  slides.push({
    id: 'revenue', theme: up ? 'revenue-up' : 'revenue-down', title: 'Revenue',
    sub: `${isToday ? 'Today' : fmtDate(date)} vs. the previous session vs. this day last week.`,
    bars: [
      { label: dayLabel, value: day.net, hi: true },
      { label: prevLabel, value: prev ? prev.net : null },
      { label: 'LAST WEEK', value: lastWeek ? lastWeek.net : null },
    ],
  });

  // 2 · Win rate
  slides.push({
    id: 'winrate', theme: day.winRate >= 50 ? 'lime' : day.winRate >= 34 ? 'olive' : 'ember', title: 'Win Rate of the Day',
    big: `${Math.round(day.winRate)}%`, chip: `${day.wins}W · ${day.losses}L · ${day.count} TRADE${day.count === 1 ? '' : 'S'}`,
    foot: day.winRate >= 50 ? 'More winners than losers. Keep it boring.' : day.net > 0 ? 'Fewer winners, but they paid for the losers.' : 'How your trades landed today.',
  });

  // 3 · Trade of the day / toughest trade
  if (day.count > 1 || day.trades[0]) {
    const best = [...day.trades].sort((a, b) => b.pnl - a.pnl)[0];
    const worst = [...day.trades].sort((a, b) => a.pnl - b.pnl)[0];
    const t = best.pnl > 0 ? best : worst;
    slides.push({
      id: 'trade', theme: best.pnl > 0 ? 'peach' : 'bruise', title: best.pnl > 0 ? 'Trade of the Day' : 'Toughest Trade',
      tag: `${t.symbol} ${t.direction === 'Short' ? 'SHORT ↘' : 'LONG ↗'}`, label: 'NET PROFIT', money: t.pnl,
      pct: initial ? (t.pnl / initial) * 100 : null,
      foot: best.pnl > 0 ? `The best trade of your day · ${fmtTime12(t.entry)}` : `Worth a replay in the journal · ${fmtTime12(t.entry)}`,
    });
  }

  // 4 · Win streak, best symbol, or session score
  let streak = [];
  for (let j = i; j >= 0 && asc[j].net > 0; j--) streak.unshift(asc[j]);
  const bySym = {};
  for (const t of day.trades) bySym[t.symbol] = (bySym[t.symbol] || 0) + t.pnl;
  const syms = Object.entries(bySym).sort((a, b) => b[1] - a[1]);
  if (streak.length >= 2) {
    const full = streak.length;
    streak = streak.slice(-4);
    slides.push({
      id: 'streak', theme: 'sunset', title: `${full}-Day Win Streak`,
      sub: 'Your green days, back to back.',
      bars: streak.map((d, k) => ({ label: d.date === date ? dayLabel : k === streak.length - 2 ? prevLabel : short(d.date), value: d.net, hi: d.date === date, chip: `${d.wins} TRADE${d.wins === 1 ? '' : 'S'} WON` })),
    });
  } else if (syms.length >= 2 && syms[0][1] > 0) {
    slides.push({ id: 'symbol', theme: 'flare', title: 'Best Symbol', bigWord: syms[0][0], label: 'NET PROFIT TODAY', money: syms[0][1], foot: `vs ${syms.slice(1).map(([s, v]) => `${s} ${fmtMoney(v, { sign: true, dp: 0 })}`).join(' · ')}` });
  } else {
    slides.push({ id: 'score', theme: day.score >= 60 ? 'ocean' : day.score >= 40 ? 'dusk' : 'bruise', title: 'Session Score', score: day.score, foot: day.score >= 60 ? 'A disciplined session. Do it again.' : day.score >= 40 ? 'Middle of the road. What would make it a 70?' : 'Rough one. Write down what you’ll change tomorrow.' });
  }
  return slides;
}


// ---------------------------------------------------------------- period wrapped (weekly / monthly / quarterly / yearly)
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
const pct = (v) => `${Math.round(v)}%`;
/** Short label for a period on a bar: NOV 2 · NOV · Q4 · 2026. */
const periodTag = (q) => (q.type === 'weekly' ? `${MONTHS[q.start.getMonth()].toUpperCase()} ${q.start.getDate()}` : q.type === 'monthly' ? MONTHS[q.start.getMonth()].toUpperCase() : q.type === 'quarterly' ? `Q${q.q}` : q.id);
const COMMIT_FIELD = { weekly: 'better', monthly: 'goals', quarterly: 'objectives', yearly: 'vision' };

/** A longer story for a review period; slides appear only when there's something worth showing. */
export function buildPeriodSlides({ p, trades, state, initial }) {
  const list = trades.filter((t) => inPeriod(t, p));
  if (!list.length) return [];
  const pb = playbookOf(state);
  const m = periodMetrics(list, { diary: state.diary, blockers: pb.blockers });
  const noun = REVIEW_TYPES.find((x) => x.id === p.type).noun;
  const Noun = cap(noun);
  const days = m.dayList; // oldest → newest
  const up = m.net >= 0;
  const slides = [];

  // 1 · the headline number
  slides.push({
    id: 'intro', theme: up ? 'revenue-up' : 'revenue-down', title: `Your ${p.type === 'weekly' ? 'Week' : p.label}, Wrapped`,
    sub: p.type === 'weekly' ? p.label : `${m.days} trading day${m.days === 1 ? '' : 's'}`,
    label: 'NET P&L', money: m.net, pct: initial ? (m.net / initial) * 100 : null,
    foot: `${m.count} trade${m.count === 1 ? '' : 's'} across ${m.days} day${m.days === 1 ? '' : 's'}${p.type === 'weekly' ? '' : ` · ${pct(m.winDaysPct)} of days green`}`,
  });

  // 2 · vs the previous two periods
  const prevs = [shiftPeriod(p, -2), shiftPeriod(p, -1)];
  const prevNets = prevs.map((q) => { const t = trades.filter((x) => inPeriod(x, q)); return t.length ? t.reduce((a, x) => a + x.pnl, 0) : null; });
  if (prevNets.some((v) => v != null)) {
    const last = prevNets[1];
    slides.push({
      id: 'compare', theme: up ? 'revenue-up' : 'revenue-down', title: 'Revenue',
      sub: `This ${noun} vs. the two before it.`,
      bars: [...prevs.map((q, k) => ({ label: periodTag(q), value: prevNets[k] })), { label: `THIS ${noun.toUpperCase()}`, value: m.net, hi: true }],
      foot: last == null ? null : m.net > last ? `Up ${fmtMoney(m.net - last, { dp: 0 })} on last ${noun}.` : m.net < last ? `${fmtMoney(last - m.net, { dp: 0 })} below last ${noun}.` : `Level with last ${noun}.`,
    });
  }

  // 3 · breakdown inside the period
  let parts = [];
  if (p.type === 'weekly') parts = days.map((d) => ({ label: WEEKDAYS[toDate(d.date).getDay()].slice(0, 3).toUpperCase(), value: d.net }));
  else {
    const sub = p.type === 'yearly' ? 'quarterly' : p.type === 'quarterly' ? 'monthly' : 'weekly';
    let q = periodOf(sub, p.start);
    for (let n = 0; n < 6 && q.from <= p.to; n++, q = shiftPeriod(q, 1)) {
      const t = list.filter((x) => inPeriod(x, q));
      if (t.length) parts.push({ label: sub === 'weekly' ? periodTag(q) : sub === 'monthly' ? MONTHS[q.start.getMonth()].toUpperCase() : `Q${q.q}`, value: t.reduce((a, x) => a + x.pnl, 0) });
    }
  }
  if (parts.length >= 2) {
    const best = parts.reduce((a, b) => (b.value > a.value ? b : a));
    parts = parts.map((x) => ({ ...x, hi: x === best }));
    const unit = p.type === 'weekly' ? 'Day' : p.type === 'monthly' ? 'Week' : p.type === 'quarterly' ? 'Month' : 'Quarter';
    slides.push({ id: 'parts', theme: 'ocean', title: `${unit} by ${unit}`, sub: `Where this ${noun}'s P&L came from.`, bars: parts, foot: best.value > 0 ? `Best ${unit.toLowerCase()}: ${best.label} · ${fmtMoney(best.value, { sign: true, dp: 0 })}` : `A red ${noun} throughout — ${best.label} lost the least.` });
  }

  // 4 · win rate
  slides.push({
    id: 'winrate', theme: m.winRate >= 50 ? 'lime' : m.winRate >= 34 ? 'olive' : 'ember', title: 'Win Rate',
    big: pct(m.winRate), chip: `${m.wins}W · ${m.losses}L · ${m.count} TRADES`,
    foot: `${days.filter((d) => d.net > 0).length} of ${m.days} trading days finished green.`,
  });

  // 5 · best day
  if (days.length >= 2 && (p.type === 'weekly' || days.length < 4)) { // longer periods show a Top Days list instead
    const bd = days.reduce((a, b) => (b.net > a.net ? b : a));
    if (bd.net > 0) slides.push({ id: 'bestday', theme: 'peach', title: `Best Day of the ${Noun}`, tag: `${WEEKDAYS[toDate(bd.date).getDay()].toUpperCase()} · ${fmtDate(bd.date).toUpperCase()}`, label: 'NET PROFIT', money: bd.net, pct: initial ? (bd.net / initial) * 100 : null, foot: `${bd.count} trade${bd.count === 1 ? '' : 's'} · ${pct(bd.winRate)} win rate` });
  }

  // 6 · trade of the period
  const bt = [...list].sort((a, b) => b.pnl - a.pnl)[0];
  if (bt.pnl > 0) slides.push({ id: 'trade', theme: 'flare', title: `Trade of the ${Noun}`, tag: `${bt.symbol} ${bt.direction === 'Short' ? 'SHORT ↘' : 'LONG ↗'}`, label: 'NET PROFIT', money: bt.pnl, foot: `${fmtDate(bt.entry)} · ${fmtTime12(bt.entry)}` });

  // 7 · longest win streak
  if (m.maxWinStreak >= 2) slides.push({ id: 'streak', theme: 'sunset', title: 'Longest Win Streak', big: String(m.maxWinStreak), chip: 'GREEN DAYS IN A ROW', foot: m.maxLossStreak >= 2 ? `Longest red run: ${m.maxLossStreak} days.` : 'No back-to-back red days. Clean.' });

  // 8 · best symbol
  const bySym = {};
  for (const t of list) bySym[t.symbol] = (bySym[t.symbol] || 0) + t.pnl;
  const syms = Object.entries(bySym).sort((a, b) => b[1] - a[1]);
  if (syms.length >= 2 && syms[0][1] > 0) slides.push({ id: 'symbol', theme: 'dusk', title: 'Best Symbol', bigWord: syms[0][0], label: `NET PROFIT THIS ${noun.toUpperCase()}`, money: syms[0][1], foot: `vs ${syms.slice(1, 4).map(([k, v]) => `${k} ${fmtMoney(v, { sign: true, dp: 0 })}`).join(' · ')}` });

  // 9 · best weekday (quarter / year — enough days to mean something)
  if ((p.type === 'quarterly' || p.type === 'yearly') && days.length >= 10) {
    const wd = {};
    for (const d of days) { const k = toDate(d.date).getDay(); (wd[k] ||= { net: 0, n: 0 }); wd[k].net += d.net; wd[k].n++; }
    const top = Object.entries(wd).sort((a, b) => b[1].net - a[1].net)[0];
    if (top && top[1].net > 0) slides.push({ id: 'weekday', theme: 'lime', title: 'Your Best Weekday', bigWord: WEEKDAYS[top[0]].slice(0, 3).toUpperCase(), label: `${top[1].n} SESSIONS · NET`, money: top[1].net, foot: `Average ${fmtMoney(top[1].net / top[1].n, { sign: true, dp: 0 })} per ${WEEKDAYS[top[0]]}.` });
  }

  // 10 · top days / months
  if (p.type === 'yearly') {
    const months = [];
    for (let k = 0; k < 12; k++) { const t = list.filter((x) => toDate(x.entry).getMonth() === k); if (t.length) months.push({ label: MONTHS_LONG[k], sub: `${t.length} trades`, value: t.reduce((a, x) => a + x.pnl, 0) }); }
    if (months.length >= 3) slides.push({ id: 'top', theme: 'peach', title: 'Top Months', rows: months.sort((a, b) => b.value - a.value).slice(0, 3), foot: `${months.filter((x) => x.value > 0).length} of ${months.length} months were green.` });
  }
  if (p.type !== 'weekly' && days.length >= 4 && !slides.some((x) => x.id === 'top')) {
    slides.push({ id: 'top', theme: 'peach', title: 'Top Days', rows: [...days].sort((a, b) => b.net - a.net).slice(0, 3).map((d) => ({ label: fmtDate(d.date), sub: `${WEEKDAYS[toDate(d.date).getDay()]} · ${d.count} trades`, value: d.net })) });
  }

  // 11 · the numbers
  const pf = m.profitFactor;
  const tiles = [
    { label: 'Profit factor', value: pf === Infinity ? '∞' : pf.toFixed(2), tone: pf >= 1 ? 'pos' : 'neg' },
    { label: 'Performance ratio', value: ratioText(m.perfRatio), tone: m.perfRatio >= 1 ? 'pos' : 'neg' },
    { label: 'ROMAD', value: m.maxDD ? ratioText(m.romad) : '∞', tone: m.romad >= 1 || !m.maxDD ? 'pos' : 'neg' },
    { label: 'Max drawdown', money: -m.maxDD, tone: m.maxDD ? 'neg' : '' },
  ];
  if (p.type !== 'weekly') tiles.push({ label: 'Avg winning day', money: m.avgWinDay, tone: 'pos' }, { label: 'Avg losing day', money: m.avgLossDay, tone: m.avgLossDay < 0 ? 'neg' : '' });
  slides.push({ id: 'numbers', theme: 'ocean', title: 'The Numbers', sub: `Expectancy ${fmtMoney(m.ev, { sign: true, dp: 0 })} per trade.`, tiles });

  // 12 · discipline (trades without an edge blocker ÷ all trades) — only once blockers are being flagged
  if (m.discipline != null && list.some((t) => Array.isArray(t.blockers))) {
    const d = Math.round(m.discipline);
    slides.push({ id: 'discipline', theme: d >= 80 ? 'ocean' : d >= 60 ? 'dusk' : 'bruise', title: 'Discipline', score: d, scoreChip: 'DISCIPLINED TRADES %', foot: m.flaggedTrades ? `${m.flaggedTrades} of ${m.count} trades had an edge blocker · ${fmtMoney(m.flaggedPnl, { sign: true, dp: 0 })} from them.` : 'No edge blockers on any trade. Textbook.' });
  }

  // 13 · outro: the commitment from the review, if written
  const review = state.reviews?.[reviewKey(p)];
  const commit = review?.answers?.[commitmentField(state, p.type) || COMMIT_FIELD[p.type]]?.trim();
  slides.push({
    id: 'outro', theme: up ? 'sunset' : 'dusk', title: commit ? `Next ${Noun}` : 'That’s a Wrap',
    plain: !commit,
    quote: commit ? (commit.length > 240 ? `${commit.slice(0, 237)}…` : commit) : `${fmtMoney(m.net, { sign: true, dp: 0 })} · ${pct(m.winRate)} win rate · PF ${pf === Infinity ? '∞' : pf.toFixed(2)}`,
    foot: commit ? 'Your commitment from this review.' : review?.completedAt ? 'Review complete. On to the next one.' : `Write your ${noun}ly review to set the focus for next ${noun}.`,
  });
  return slides;
}

// ---------------------------------------------------------------- slide views
function Bars({ bars, priv }) {
  const vals = bars.map((b) => Math.abs(b.value ?? 0));
  const max = Math.max(1, ...vals);
  return (
    <div className={`wr-bars ${bars.length > 3 ? 'dense' : ''}`}>
      {bars.map((b, k) => {
        const h = b.value == null ? 0 : Math.max(6, (Math.abs(b.value) / max) * 100);
        return (
          <div key={k} className={`wr-bar ${b.hi ? 'hi' : ''} ${b.value != null && b.value < 0 ? 'neg' : ''}`}>
            <div className="wr-bar-col">
              {b.chip && <span className="wr-chip sm">{b.chip}</span>}
              <span className="wr-bar-val">{b.value == null ? '—' : priv ? '•••' : `${b.value > 0 ? '+' : ''}${fmtCompact(b.value)}`}</span>
              <div className="wr-bar-fill" style={{ height: `${h}%`, animationDelay: `${0.15 + k * 0.12}s` }} />
            </div>
            <span className="wr-bar-label">{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Slide({ s, priv }) {
  const money = (v) => (priv ? '•••' : `${v > 0 ? '+' : ''}${fmtMoney(v, { dp: 0 })}`);
  return (
    <div className={`wr-slide theme-${s.theme}`}>
      <div className="wr-bg"><i /><i /><i /></div>
      <div className="wr-dots" />
      <div className="wr-inner">
        <h2 className="wr-title">{s.title}</h2>
        {s.sub && <div className="wr-sub">{s.sub}</div>}
        {s.bars && <Bars bars={s.bars} priv={priv} />}
        {s.big && (
          <div className="wr-center">
            <div className="wr-big">{s.big}</div>
            <span className="wr-chip">{s.chip}</span>
          </div>
        )}
        {s.money != null && !s.bigWord && (
          <div className="wr-center">
            {s.tag && <span className="wr-chip tag">● {s.tag}</span>}
            <div className="wr-label">{s.label}</div>
            <div className={`wr-big money ${String(money(s.money)).length > 6 ? 'long' : ''}`}>{money(s.money)}</div>
            {s.pct != null && !priv && <span className={`wr-pct ${s.money >= 0 ? 'pos' : 'neg'}`}>{s.money >= 0 ? '+' : ''}{s.pct.toFixed(1)}%</span>}
          </div>
        )}
        {s.bigWord && (
          <div className="wr-center">
            <div className="wr-big word">{s.bigWord}</div>
            <span className="wr-chip tag" style={{ marginTop: 28 }}>{s.label}</span>
            <div className="wr-big money sm">{money(s.money)}</div>
          </div>
        )}
        {s.score != null && (
          <div className="wr-center">
            <div className="wr-ring-wrap"><div className="wr-ring" style={{ '--p': s.score }} /><span>{s.score}</span></div>
            <span className="wr-chip" style={{ marginTop: 18 }}>{s.scoreChip || 'OUT OF 100'}</span>
          </div>
        )}
        {s.tiles && (
          <div className="wr-center">
            <div className="wr-tiles">
              {s.tiles.map((t, k) => (
                <div key={t.label} className={`wr-tile ${t.tone || ''}`} style={{ animationDelay: `${0.1 + k * 0.08}s` }}>
                  <span>{t.label}</span>
                  <b>{t.money != null ? (priv ? '•••' : fmtMoney(t.money, { dp: 0 })) : t.value}</b>
                </div>
              ))}
            </div>
          </div>
        )}
        {s.rows && (
          <div className="wr-center">
            <div className="wr-rows">
              {s.rows.map((r, k) => (
                <div key={r.label} className="wr-row" style={{ animationDelay: `${0.1 + k * 0.12}s` }}>
                  <span className="wr-rank">{k + 1}</span>
                  <div className="wr-row-t"><b>{r.label}</b><span>{r.sub}</span></div>
                  <span className={`wr-row-v ${r.value < 0 ? 'neg' : ''}`}>{money(r.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {s.quote && <div className="wr-center"><div className={`wr-quote ${s.plain ? 'plain' : ''}`}>{s.quote}</div></div>}
        {s.foot && <div className="wr-foot">{s.foot}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- share image (canvas)
const THEME_COLORS = {
  'revenue-up': ['#2fd47a', '#0d3d22', '#000'], 'revenue-down': ['#e5484d', '#3d0d10', '#000'], lime: ['#c8ec4f', '#2b5e09', '#071503'],
  olive: ['#9cbf3a', '#2d3d0b', '#050802'], ember: ['#f0703c', '#4a1206', '#070201'], peach: ['#ffb070', '#c2410c', '#2a0a02'],
  bruise: ['#a14d6b', '#3a0f22', '#060104'], sunset: ['#ff8a3d', '#b4300c', '#0b0402'], flare: ['#f59e0b', '#7f1d1d', '#0a0603'],
  ocean: ['#3fb8c7', '#0b3b4a', '#020809'], dusk: ['#9b7bd8', '#2c1a4f', '#05030a'],
};
function drawShare(s, priv) {
  const W = 1080, H = 1920, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const [a, b, z] = THEME_COLORS[s.theme] || THEME_COLORS.ocean;
  const lg = g.createLinearGradient(0, 0, W, H); lg.addColorStop(0, b); lg.addColorStop(1, z);
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
  const rg = g.createRadialGradient(W * 0.75, H * 0.22, 0, W * 0.75, H * 0.22, W * 0.9); rg.addColorStop(0, a + 'cc'); rg.addColorStop(1, a + '00');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (let x = 60; x < W; x += 36) for (let y = 420; y < H - 300; y += 36) g.fillRect(x, y, 3, 3);
  const font = (w, px, fam = 'Inter, "Segoe UI", Arial, sans-serif') => `${w} ${px}px ${fam}`;
  const mono = 'ui-monospace, Consolas, "Courier New", monospace';
  g.textAlign = 'center'; g.fillStyle = '#fff'; g.shadowColor = 'rgba(255,255,255,0.45)'; g.shadowBlur = 24;
  g.font = font(500, 92); g.fillText(s.title, W / 2, 300);
  g.shadowBlur = 0;
  if (s.sub) { g.font = font(400, 36); g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillText(s.sub, W / 2, 370); }
  const money = (v) => (priv ? '•••' : `${v > 0 ? '+' : ''}${fmtMoney(v, { dp: 0 })}`);
  const chip = (text, x, y, bg = '#eaff8f', fg = '#111') => {
    g.font = font(600, 34, mono); const w = g.measureText(text).width + 40;
    g.fillStyle = bg; g.fillRect(x - w / 2, y - 40, w, 58); g.fillStyle = fg; g.fillText(text, x, y);
  };
  if (s.bars) {
    const n = s.bars.length, bw = 220, gap = (W - 160 - n * bw) / Math.max(1, n - 1), base = H - 420, maxH = 900;
    const max = Math.max(1, ...s.bars.map((x) => Math.abs(x.value ?? 0)));
    s.bars.forEach((bar, k) => {
      const x = 80 + k * (bw + gap), h = bar.value == null ? 0 : Math.max(24, (Math.abs(bar.value) / max) * maxH);
      g.fillStyle = bar.hi ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)';
      for (let y = base - h; y < base; y += 22) g.fillRect(x, y, bw, 12);
      g.fillStyle = '#fff'; g.font = font(400, 54);
      g.fillText(bar.value == null ? '—' : priv ? '•••' : `${bar.value > 0 ? '+' : ''}${fmtCompact(bar.value)}`, x + bw / 2, base - h - 30);
      if (bar.chip) chip(bar.chip, x + bw / 2, base - h - 110, '#a6f59a');
      g.fillStyle = bar.hi ? a : 'rgba(255,255,255,0.18)'; g.fillRect(x, base + 24, bw, 70);
      g.fillStyle = bar.hi ? '#000' : '#fff'; g.font = font(600, 34, mono); g.fillText(bar.label, x + bw / 2, base + 72);
    });
  } else if (s.tiles) {
    const cols = 2, tw = 440, th = s.tiles.length > 4 ? 230 : 280, gx = 40, top = 560;
    s.tiles.forEach((t, k) => {
      const x = (W - cols * tw - gx) / 2 + (k % cols) * (tw + gx), y = top + Math.floor(k / cols) * (th + 40);
      g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x, y, tw, th);
      g.textAlign = 'left'; g.font = font(600, 30, mono); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText(t.label.toUpperCase(), x + 32, y + 64);
      g.font = font(400, 96); g.fillStyle = t.tone === 'neg' ? '#ff9a9a' : t.tone === 'pos' ? '#a6f59a' : '#fff';
      g.fillText(t.money != null ? (priv ? '•••' : fmtMoney(t.money, { dp: 0 })) : t.value, x + 32, y + th - 50);
      g.textAlign = 'center';
    });
  } else if (s.rows) {
    s.rows.forEach((r, k) => {
      const y = 620 + k * 260;
      g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(90, y, W - 180, 210);
      g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = font(300, 120); g.fillText(String(k + 1), 130, y + 150);
      g.font = font(600, 52); g.fillText(r.label, 260, y + 95);
      g.font = font(400, 34); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText(r.sub || '', 260, y + 150);
      g.textAlign = 'right'; g.font = font(500, 60); g.fillStyle = r.value < 0 ? '#ff9a9a' : '#a6f59a'; g.fillText(money(r.value), W - 130, y + 125);
      g.textAlign = 'center';
    });
  } else if (s.quote) {
    g.font = font(400, 62); g.fillStyle = '#fff';
    const words = s.quote.split(/\s+/); const lines = []; let line = '';
    for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > W - 200 && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    const y0 = H / 2 - ((lines.length - 1) * 84) / 2;
    lines.slice(0, 9).forEach((l, k) => g.fillText(l, W / 2, y0 + k * 84));
  } else {
    let y = 1000;
    if (s.tag) chip(`● ${s.tag}`, W / 2, 640);
    if (s.label && !s.bigWord) { g.font = font(600, 40, mono); g.fillStyle = '#fff'; g.fillText(s.label, W / 2, 800); }
    const big = s.big || (s.bigWord ? s.bigWord : s.score != null ? String(s.score) : money(s.money));
    g.shadowColor = 'rgba(255,255,255,0.6)'; g.shadowBlur = 40; g.fillStyle = '#fff';
    g.font = font(300, big.length > 6 ? 230 : 320); g.fillText(big, W / 2, y);
    g.shadowBlur = 0;
    if (s.chip) chip(s.chip, W / 2, y + 120);
    if (s.bigWord) { chip(s.label, W / 2, y + 150); g.font = font(300, 150); g.fillStyle = '#fff'; g.fillText(money(s.money), W / 2, y + 340); }
    if (s.pct != null && !priv) chip(`${s.money >= 0 ? '+' : ''}${s.pct.toFixed(1)}%`, W / 2, y + 120, s.money >= 0 ? '#1aa87f' : '#e5484d', '#fff');
    if (s.score != null) chip(s.scoreChip || 'OUT OF 100', W / 2, y + 120);
  }
  if (s.foot) { g.font = font(500, 36); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillText(s.foot, W / 2, H - 230); }
  g.font = font(700, 34); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillText('RoninFlow.', W / 2, H - 120);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

// ---------------------------------------------------------------- viewer
export function WrappedViewer({ date, period, onClose }) {
  const { state } = useStore();
  const trades = useAccountTrades();
  const priv = state.settings.privacy;
  const acct = state.accounts.find((a) => a.id === state.settings.account);
  const initial = acct?.initial || 50000;
  const slides = useMemo(() => (period
    ? buildPeriodSlides({ p: period, trades, state, initial })
    : buildSlides({ date, days: groupByDay(trades), initial, today: keyOf(new Date()) })), [date, period, trades, state, initial]);
  const topLabel = period ? `${REVIEW_TYPES.find((x) => x.id === period.type).label} · ${period.label}` : fmtDate(date);
  const fileTag = period ? `${period.type}-${period.id}` : date;
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [sharing, setSharing] = useState(false);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const touch = useRef(null);

  const next = () => setI((x) => (x < slides.length - 1 ? x + 1 : (closeRef.current(), x)));
  const prev = () => setI((x) => Math.max(0, x - 1));
  useEffect(() => {
    if (paused || !slides.length) return undefined;
    const t = setTimeout(next, SLIDE_MS);
    return () => clearTimeout(t);
  }, [i, paused, slides.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') closeRef.current();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener('keydown', k);
    const o = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = o; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async (e) => {
    e.stopPropagation();
    setSharing(true); setPaused(true);
    try {
      const blob = await drawShare(slides[i], priv);
      const file = new File([blob], `wrapped-${fileTag}-${slides[i].id}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: period ? `My trading ${REVIEW_TYPES.find((x) => x.id === period.type).noun} · ${period.label}` : `My trading day · ${fmtDate(date)}` }).catch(() => {});
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
    } finally { setSharing(false); }
  };

  if (!slides.length) return null;
  const s = slides[i];
  return createPortal(
    // Rendered in a portal, but React still bubbles events to the day card that opened it — stop them here.
    <div
      className="wr-overlay"
      onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <button className="wr-close" onClick={onClose} title="Close (Esc)"><X size={20} /></button>
      {i > 0 && <button className="wr-nav left" onClick={prev} title="Previous"><ChevronLeft size={20} /></button>}
      <div
        className="wr-card"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - (touch.current ?? 0); if (Math.abs(dx) > 40) (dx < 0 ? next() : prev()); }}
        onClick={(e) => { if (e.target.closest('button')) return; const r = e.currentTarget.getBoundingClientRect(); (e.clientX - r.left < r.width * 0.3 ? prev : next)(); }}
      >
        <div className="wr-progress">
          {slides.map((x, k) => (
            <span key={x.id}><i key={`${k}-${i}`} style={k < i ? { width: '100%' } : k === i ? { animation: `wr-fill ${SLIDE_MS}ms linear forwards`, animationPlayState: paused ? 'paused' : 'running' } : { width: 0 }} /></span>
          ))}
        </div>
        <div className="wr-top">
          <span>{topLabel}</span>
          <button className="wr-pp" onClick={(e) => { e.stopPropagation(); setPaused((p) => !p); }} title={paused ? 'Play' : 'Pause'}>{paused ? <Play size={13} /> : <Pause size={13} />}</button>
        </div>
        <Slide key={s.id} s={s} priv={priv} />
        <button className="wr-share" onClick={share} disabled={sharing}>{sharing ? 'Preparing…' : 'Share wrapped'} <Share size={14} /></button>
      </div>
      {i < slides.length - 1 && <button className="wr-nav right" onClick={next} title="Next"><ChevronRight size={20} /></button>}
    </div>,
    document.body,
  );
}

/** Small "Wrapped" button for day cards / the day page. */
export function WrappedButton({ date, period, label = true }) {
  const [open, setOpen] = useState(false);
  const noun = period ? REVIEW_TYPES.find((x) => x.id === period.type)?.noun : 'day';
  return (
    <>
      <button className="wrapped-btn" onClick={(e) => { e.stopPropagation(); setOpen(true); }} title={`Your ${noun}, wrapped`}>
        <Sparkles size={13} />{label && <span>Wrapped</span>}
      </button>
      {open && <WrappedViewer date={date} period={period} onClose={() => setOpen(false)} />}
    </>
  );
}
