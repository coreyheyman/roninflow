import { StatLabel } from '../components/StatInfo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, List, LayoutGrid, Calendar, EllipsisVertical, X, Maximize2, CircleCheck, Circle, Quote, Sunrise, TrendingUp, TrendingDown, ArrowLeft, ChevronLeft, ChevronRight, Clock, Settings, ChartArea, ChartColumn, ChevronDown } from 'lucide-react';
import { useStore, useAccountTrades, navigate } from '../store/store';
import { DateRange, Seg, Popover, ScoreBox, Money, Private, useToast } from '../components/ui';
import { PnlChart } from '../components/Charts';
import { PnlCalendar } from '../components/Calendar';
import { useOpenDay } from '../lib/dayPopup';
import { WrappedButton } from '../components/Wrapped';
import { TradeDrawer } from '../components/TradeForms';
import RichText from '../components/RichText';
import Gallery from '../components/Gallery';
import ExecChart from '../components/ExecChart';
import { SessionWizard, PrePanel, PostPanel, BlockerStrip, PlaybookSettings, MOODS, useRisk } from '../components/Playbook';
import { groupByDay, inRange, fmtDate, fmtTime24, fmtTime12, pfText, todayKey, fmtHold, holdSeconds, fmtMoney, money0, fmtDuration, toDate, WEEKDAYS, currentTradingDay } from '../lib/stats';
import { lastTomorrowNote, playbookOf } from '../lib/playbook';
import CoachReview from '../components/CoachReview';
import { askCoachAboutImage } from '../lib/askCoach';
import { chartCaption, CAPTION_TF, retimeCaption } from '../lib/chartLabel';
import { buildReviewContext } from '../lib/coach';


/** One bar per trade (in the order they were taken). */
function tradeBars(d) {
  return [...d.trades].sort((a, b) => a.entry.localeCompare(b.entry)).map((t) => ({ label: fmtTime24(t.entry), y: t.pnl, tip: `${fmtTime12(t.entry)} · ${t.symbol} ${t.direction}` }));
}

function dayChart(d) {
  let c = 0;
  return [...d.trades].sort((a, b) => a.exit.localeCompare(b.exit)).map((t) => { c += t.pnl; return { label: fmtTime24(t.exit), y: Math.round(c * 100) / 100, tip: `${fmtTime12(t.exit)} · ${t.symbol} ${fmtMoney(t.pnl, { sign: true })}` }; });
}

export default function Diary({ sub }) {
  if (sub) return <DayPage date={sub} />;
  return <DiaryIndex />;
}

/** Card for a trading day with no trades yet (today / upcoming) or a diary-only day. */
function EmptyDayCard({ date, today, onCheckIn }) {
  const { state } = useStore();
  const e = state.diary[date] || {};
  const upcoming = date > today, isToday = date === today, future = date >= today;
  const note = future ? lastTomorrowNote(state.diary, date) : null;
  const pb = e.pre;
  return (
    <div className={`day-card empty-day ${future ? 'pending' : ''}`} onClick={() => navigate(`diary/${date}`)}>
      <div className="top">
        <span>{WEEKDAYS[toDate(date).getDay()]}, {fmtDate(date)}</span>
        {isToday && <span className="badge pos-soft" style={{ fontSize: 10.5 }}>Today</span>}
        {upcoming && <span className="badge neutral" style={{ fontSize: 10.5 }}>Upcoming</span>}
        <div className="grow" />
      </div>
      <div className="stats" style={{ borderBottom: 0 }}>
        <div className="row gap12" style={{ marginTop: 4 }}>
          <span className="muted" style={{ fontSize: 13 }}>Net P&L:</span>
          <span className="muted2" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em' }}>{future ? 'No trades yet' : 'No trades'}</span>
        </div>
        <div className="empty-day-body">
          <div className={`row gap8 ${pb ? 'pos' : ''}`} style={{ fontSize: 13.5, fontWeight: 500 }}>
            {pb ? <CircleCheck size={16} /> : <Circle size={16} className="muted" />}
            {pb ? 'Pre-session check-in complete' : future ? 'Pre-session check-in not started' : 'Diary entry'}
          </div>
          {pb && (pb.regime || pb.goal || pb.maxLoss) && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>
              {[pb.regime && `Market: ${playbookOf(state).regimes.find((x) => x.id === pb.regime)?.name || pb.regime}`, pb.maxLoss && `Max loss ${money0(Number(pb.maxLoss))}`, pb.goal && `Goal: ${pb.goal}`].filter(Boolean).join(' · ')}
            </div>
          )}
          {note && (
            <div className="day-commit" style={{ margin: '14px 0 0', width: '100%' }}>
              <Quote size={14} className="accent" style={{ flexShrink: 0, marginTop: 3 }} />
              <span><b>Your commitment for {isToday ? 'today' : WEEKDAYS[toDate(date).getDay()]} · from {fmtDate(note.date)}</b>{note.text}</span>
            </div>
          )}
          {future && (
            <button className={`btn ${pb ? '' : 'primary'}`} style={{ marginTop: 14 }} onClick={(ev) => { ev.stopPropagation(); if (pb) navigate(`diary/${date}`); else onCheckIn(); }}>
              {pb ? (isToday ? 'Review today\'s plan' : 'Review plan') : <><Sunrise size={15} /> Start pre-session check-in</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DiaryIndex() {
  const openDay = useOpenDay();
  const { state } = useStore();
  const all = useAccountTrades();
  const [view, setView] = useState('grid');
  const [range, setRange] = useState({ from: null, to: null });
  const [wizard, setWizard] = useState(false);
  const [pbOpen, setPbOpen] = useState(false);
  const risk = useRisk();
  const days = useMemo(() => groupByDay(all.filter((t) => inRange(t, range))), [all, range]);
  const today = todayKey();
  // Every trading day gets a card before it starts: today (or the next trading day on weekends / holidays), plus any
  // day you wrote in the diary without trading.
  const entries = useMemo(() => {
    const inR = (k) => (!range.from || k >= range.from) && (!range.to || k <= range.to);
    const map = new Map(days.map((d) => [d.date, d]));
    const extra = new Set([currentTradingDay(today)]);
    for (const [k, e] of Object.entries(state.diary)) if (e && (e.pre || e.post || e.notes?.replace(/<[^>]+>/g, '').trim() || e.images?.length)) extra.add(k);
    const keys = new Set([...map.keys(), ...[...extra].filter(inR)]);
    return [...keys].sort((a, b) => b.localeCompare(a)).map((k) => ({ date: k, day: map.get(k) || null }));
  }, [days, state.diary, range, today]);
  const priv = state.settings.privacy;
  const currentDay = currentTradingDay(today);
  const commitment = useMemo(() => lastTomorrowNote(state.diary, currentDay), [state.diary, currentDay]);
  const acct = state.accounts.find((a) => a.id === state.settings.account);
  const initial = acct?.initial || 50000;

  return (
    <div className="page">
      <div className="row between wrap gap8" style={{ marginBottom: 14 }}>
        <div className="page-title" style={{ margin: 0 }}>Daily Diary</div>
        <div className="row gap8">
          <a className="btn sm" href="#/strategy?tab=conditions" title="How you perform in each market condition"><ChartColumn size={14} /> Market conditions</a>
          <button className="btn sm" onClick={() => setPbOpen(true)}><Settings size={14} /> Playbook</button>
        </div>
      </div>
      <div className="dash-grid diary-top" style={{ gridTemplateColumns: state.settings.riskEnabled === false ? '1fr' : 'minmax(0,1fr) minmax(0,1.6fr)', marginBottom: 16 }}>
        {state.settings.riskEnabled !== false && <a href="#/risk" className="panel" style={{ padding: 16, display: 'block' }}>
          <div className="row between"><div className="card-title">Today’s risk</div><span className="muted" style={{ fontSize: 12.5 }}>Drawdown <Private className={risk.dd > 0 ? 'neg' : 'pos'}>−{money0(risk.dd)}</Private></span></div>
          <div className="risk-banner" style={{ '--tier': risk.tier.color }}>
            <b>{risk.tier.name}</b>
            <span>Daily LL −{money0(risk.tier.dailyLL)}</span>
            <span>Risk/trade {money0(risk.tier.riskMin)}–{money0(risk.tier.riskMax)}</span>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{risk.stopNow ? <b className="neg">Daily loss limit hit — stop trading for today.</b> : `${risk.reasons[0]}.`}</div>
        </a>}
        <BlockerStrip />
      </div>
      <div className="hero">
        <div style={{ position: 'relative' }}>
          <h3>{state.diary[today]?.pre ? 'Session check-in complete' : 'Ready to start trading?'}</h3>
          <p>{state.diary[today]?.pre ? 'Your plan for today is saved. Review it any time before you trade.' : 'Answer a few questions and get on track'}</p>
        </div>
        <button className="btn primary" style={{ position: 'relative', background: 'var(--primary)' }} onClick={() => (state.diary[today]?.pre ? navigate(`diary/${today}`) : setWizard(true))}>
          <Play size={18} /> {state.diary[today]?.pre ? "Open today's diary" : 'Start Trading Session'}
        </button>
      </div>
      <div className="toolbar" style={{ marginBottom: 24 }}>
        <DateRange value={range} onChange={setRange} />
        <div className="grow" />
        <Seg value={view} onChange={setView} options={[{ value: 'list', label: 'List', icon: List }, { value: 'grid', label: 'Grid', icon: LayoutGrid }, { value: 'calendar', label: 'Calendar', icon: Calendar }]} />
      </div>

      {entries.length === 0 && <div className="panel empty">No trading sessions yet in this range.</div>}

      {view === 'grid' && (
        <div className="day-grid">
          {entries.map(({ date, day: d }) => (!d ? <EmptyDayCard key={date} date={date} today={today} onCheckIn={() => setWizard(date)} /> : (
            <div key={d.date} className="day-card" onClick={() => navigate(`diary/${d.date}`)}>
              <div className="top">
                <span>{fmtDate(d.date)}</span>
                {d.date === today && <span className="badge neutral" style={{ fontSize: 10.5 }}>Today</span>}
                <span className="sep-v" />
                <span className="muted">Session Time:</span>
                <span>{fmtTime24(d.start)} – {fmtTime24(d.end)}</span>
                <ScoreBox v={d.score} ctx={d} />
                <div className="grow" />
                <WrappedButton date={d.date} />
                <Popover align="right" trigger={({ toggle }) => <button className="icon-btn" onClick={(e) => { e.stopPropagation(); toggle(); }} style={{ border: '1px solid var(--border-2)', width: 26, height: 26 }}><EllipsisVertical size={15} /></button>}>
                  {(close) => (
                    <div onClick={(e) => e.stopPropagation()}>
                      <button className="pop-item" onClick={() => { close(); navigate(`diary/${d.date}`); }}>Open diary</button>
                      <button className="pop-item" onClick={() => { close(); navigate(`journal/database`); }}>View trades in journal</button>
                    </div>
                  )}
                </Popover>
              </div>
              <div className="stats">
                <div className="row gap12" style={{ marginTop: 4 }}>
                  <span className="muted" style={{ fontSize: 13 }}>Net P&L:</span>
                  <span style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em' }}><Private>{fmtMoney(d.net)}</Private></span>
                  <span className={`badge ${d.net >= 0 ? 'pos' : 'neg'}`}>{d.net >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{d.net >= 0 ? '+' : ''}{((d.net / initial) * 100).toFixed(2)}%</span>
                </div>
                <div className="row gap24" style={{ marginTop: 22 }}>
                  <div><div className="lbl"><StatLabel ctx={d}>Profit Factor</StatLabel></div><div style={{ fontWeight: 500, marginTop: 6 }}>{pfText(d.profitFactor)}</div></div>
                  <div><div className="lbl"><StatLabel ctx={d}>Win Rate</StatLabel></div><div style={{ fontWeight: 500, marginTop: 6 }}>{Math.round(d.winRate)}%</div></div>
                  <div><div className="lbl"><StatLabel ctx={d}>Trades</StatLabel></div><div style={{ fontWeight: 500, marginTop: 6 }}>{d.count}</div></div>
                  {state.diary[d.date]?.mood && <div><div className="lbl">Mood</div><div style={{ marginTop: 4, fontSize: 16 }}>{MOODS[state.diary[d.date].mood - 1]}</div></div>}
                </div>
              </div>
              {d.date === currentDay && commitment && (
                <div className="day-commit" style={{ marginTop: 14 }}>
                  <Quote size={14} className="accent" style={{ flexShrink: 0, marginTop: 3 }} />
                  <span><b>Your commitment for today · from {fmtDate(commitment.date)}</b>{commitment.text}</span>
                </div>
              )}
              <div style={{ padding: '12px 8px 4px' }}>
                <PnlChart data={dayChart(d)} smooth height={190} xLabels={9} padLeft={66} yFmt={(v) => (priv ? '•••' : fmtMoney(v, { dp: 0, raw: true }))} dotted={false} />
              </div>
            </div>
          )))}
        </div>
      )}

      {view === 'list' && entries.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>{['Date', 'Time', 'Net P&L', 'Win Rate', 'Profit Factor', 'Trades', 'Score'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {entries.map(({ date, day: d }) => (!d ? (
                <tr key={date} onClick={() => navigate(`diary/${date}`)}>
                  <td>{fmtDate(date)} {date >= today && <span className="badge neutral" style={{ fontSize: 10.5, marginLeft: 6 }}>{date === today ? 'Today' : 'Upcoming'}</span>}</td>
                  <td className="muted" colSpan={6}>{state.diary[date]?.pre ? 'Check-in complete · no trades yet' : date >= today ? 'Check-in not started' : 'No trades — diary only'}</td>
                </tr>
              ) : (
                <tr key={d.date} className={d.net >= 0 ? 'r-win' : 'r-loss'} onClick={() => navigate(`diary/${d.date}`)}>
                  <td>{fmtDate(d.date)}</td>
                  <td className="muted">{fmtTime24(d.start)} – {fmtTime24(d.end)}</td>
                  <td><Money v={d.net} colored /></td>
                  <td>{Math.round(d.winRate)}%</td>
                  <td>{pfText(d.profitFactor)}</td>
                  <td>{d.count}</td>
                  <td><ScoreBox v={d.score} ctx={d} /></td>
                </tr>
              )))}
            </tbody>
          </table>
          <div className="pager"><span className="grow" />1 to {entries.length} of {entries.length} &nbsp; Page 1 of 1</div>
        </div>
      )}

      {view === 'calendar' && <PnlCalendar days={days} onDay={openDay} />}

      <SessionWizard open={!!wizard} date={typeof wizard === 'string' ? wizard : today} existing={typeof wizard === 'string' ? state.diary[wizard]?.pre : undefined} onClose={() => setWizard(false)} />
      <PlaybookSettings open={pbOpen} onClose={() => setPbOpen(false)} />
    </div>
  );
}

/** A day's diary in a pop-up (used by the Review pages so you don't lose your place). */
export function DiaryDayModal({ date: initial, onClose }) {
  const [date, setDate] = useState(initial);
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => setDate(initial), [initial]);
  useEffect(() => {
    // Esc closes the pop-up, unless a trade drawer / wizard / image viewer opened on top of it
    const k = (e) => {
      if (e.key !== 'Escape') return;
      const layers = document.querySelectorAll('.overlay, .drawer, .wr-overlay');
      if (layers[layers.length - 1] === ref.current) closeRef.current();
    };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, []);
  if (!date) return null;
  return createPortal(
    <div className="overlay day-modal-wrap" ref={ref} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal day-modal">
        <DayPage key={date} date={date} embedded onDate={setDate} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}

function DayPage({ date, embedded = false, onDate, onClose }) {
  const { state, saveDiary, setSetting } = useStore();
  const toast = useToast();
  const all = useAccountTrades();
  const [open, setOpen] = useState(null);
  const [wizard, setWizard] = useState(false);
  const [pbOpen, setPbOpen] = useState(false);
  const risk = useRisk();
  const days = useMemo(() => groupByDay(all), [all]);
  const idx = days.findIndex((d) => d.date === date);
  const d = days[idx];
  const prevDay = idx >= 0 ? days[idx + 1] : null; // days are newest first
  const entry = state.diary[date] || {};
  const capTf = state.settings.coach?.captionTf === undefined ? 'auto' : state.settings.coach.captionTf;
  const pre = entry.pre;
  const priv = state.settings.privacy;
  const barView = state.settings.diaryChart === 'bar';
  const dow = WEEKDAYS[toDate(date).getDay()];
  const go = (k) => (embedded ? onDate?.(k) : navigate(`diary/${k}`));
  // Previous / Next walk every session you can open: trading days, days with diary entries, and today's card
  const nav = useMemo(() => {
    const keys = new Set(days.map((x) => x.date));
    for (const [k, e] of Object.entries(state.diary)) if (e && (e.pre || e.post || e.notes?.replace(/<[^>]+>/g, '').trim() || e.images?.length)) keys.add(k);
    const cur = currentTradingDay(todayKey());
    keys.add(cur);
    const sorted = [...keys].filter((k) => k <= cur || k === date).sort();
    return { prev: [...sorted].reverse().find((k) => k < date) || null, next: sorted.find((k) => k > date) || null };
  }, [days, state.diary, date]);
  const commitment = useMemo(() => lastTomorrowNote(state.diary, date), [state.diary, date]);

  return (
    <div className={embedded ? 'day-modal-body' : 'page'}>
      <div className={`row gap12 ${embedded ? 'day-modal-bar' : ''}`} style={{ marginBottom: 18 }}>
        {embedded
          ? <button className="btn sm" onClick={() => { onClose?.(); navigate(`diary/${date}`); }} title="Open this day in the Daily Diary"><Maximize2 size={14} /> <span className="hide-sm">Open in Daily Diary</span></button>
          : <button className="btn sm" onClick={() => navigate('diary')}><ArrowLeft size={15} /> All sessions</button>}
        <div className="grow" />
        <button className="btn sm" disabled={!nav.prev} onClick={() => go(nav.prev)} title={nav.prev ? fmtDate(nav.prev) : undefined}><ChevronLeft size={15} /> <span className={embedded ? 'hide-sm' : ''}>Previous</span></button>
        <button className="btn sm" disabled={!nav.next} onClick={() => go(nav.next)} title={nav.next ? fmtDate(nav.next) : undefined}><span className={embedded ? 'hide-sm' : ''}>Next</span> <ChevronRight size={15} /></button>
        {embedded && <button className="icon-btn" style={{ border: '1px solid var(--border-2)' }} onClick={onClose} title="Close (Esc)"><X size={16} /></button>}
      </div>
      <div className="row gap16" style={{ marginBottom: 20 }}>
        <div>
          <div className="page-title" style={{ margin: 0 }}>{fmtDate(date)}</div>
          <div className="muted" style={{ marginTop: 4 }}>{dow}{d && <> · Session {fmtTime24(d.start)} – {fmtTime24(d.end)} · <Clock size={12} style={{ verticalAlign: -1 }} /> {fmtDuration(d.duration)}</>}</div>
        </div>
        <div className="grow" />
        {d && <WrappedButton date={date} />}
        {d && <ScoreBox v={d.score} ctx={d} />}
      </div>
      {commitment && (
        <div className="day-commit" style={{ margin: '0 0 20px' }}>
          <Quote size={14} className="accent" style={{ flexShrink: 0, marginTop: 3 }} />
          <span><b>Your commitment for {date === todayKey() ? 'today' : dow} · from {fmtDate(commitment.date)}</b>{commitment.text}</span>
        </div>
      )}

      {d ? (
        <>
          <div className="kpis day-kpis" style={{ gridTemplateColumns: 'repeat(5,minmax(0,1fr))' }}>
            {[
              ['Net P&L', <Money key="n" v={d.net} colored />],
              ['Win rate', `${Math.round(d.winRate)}%`],
              ['Profit factor', pfText(d.profitFactor)],
              ['Trades', `${d.count} (${d.wins}W / ${d.losses}L${d.be ? ` / ${d.be}BE` : ''})`],
              ['Avg hold', `${fmtHold(d.holdWin)} W · ${fmtHold(d.holdLoss)} L`],
            ].map(([k, v]) => (
              <div key={k} className="panel" style={{ padding: '16px 18px' }}>
                <div className="muted" style={{ fontSize: 12.5 }}><StatLabel ctx={d}>{k}</StatLabel></div>
                <div style={{ fontSize: 20, fontWeight: 500, marginTop: 8 }}>{v}</div>
              </div>
            ))}
          </div>
          <div className="dash-grid">
            <div className="panel">
              <div className="panel-head">
                <div className="card-title">{barView ? 'P&L by trade' : 'Intraday P&L'}</div>
                <Seg icon value={barView ? 'bar' : 'area'} onChange={(v) => setSetting('diaryChart', v)} options={[{ value: 'area', icon: ChartArea, title: 'Cumulative P&L' }, { value: 'bar', icon: ChartColumn, title: 'Trade by trade' }]} />
              </div>
              {barView
                ? <PnlChart data={tradeBars(d)} mode="bar" height={280} xLabels={10} yFmt={(v) => (priv ? '•••' : fmtMoney(v, { dp: 0, raw: true }))} />
                : <PnlChart data={dayChart(d)} smooth height={280} xLabels={10} yFmt={(v) => (priv ? '•••' : fmtMoney(v, { dp: 0, raw: true }))} />}
            </div>
            <div className="panel" style={{ padding: 0, overflow: 'auto', maxHeight: 360 }}>
              <table className="tbl day-tbl">
                <thead><tr>{['Time', 'Pair', 'Side', 'Hold', 'Edge blockers', 'Net P&L'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {d.trades.map((t) => (
                    <tr key={t.id} className={`r-${t.pnl > 0 ? 'win' : t.pnl < 0 ? 'loss' : 'be'}`} onClick={() => setOpen(t)}>
                      <td>{fmtTime12(t.entry)}</td><td>{t.symbol}</td><td><span className={`dir ${t.direction}`}>{t.direction}</span>{t.qty > 1 && <span className="qty-x" title={t.fills?.length > 1 ? `${t.qty} contracts over ${t.fills.length} fills` : `${t.qty} contracts`}>×{t.qty}</span>}</td>
                      <td className="muted">{fmtHold(holdSeconds(t))}</td>
                      <td>{t.blockers?.length ? <span className="row gap4 wrap">{t.blockers.map((b) => <span key={b} className="blk-tag">{b}</span>)}</span> : <span className="muted2">—</span>}</td>
                      <td><span className="row" style={{ justifyContent: 'space-between', gap: 8 }}><Money v={t.pnl} colored />{!t.reviewed && <span className="unrev-dot" title="Not reviewed yet" />}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="panel muted" style={{ marginBottom: 22 }}>No trades recorded for this day yet.</div>
      )}

      <div className="dash-grid" style={{ alignItems: 'start' }}>
        <PrePanel date={date} entry={entry} day={d} onEdit={() => setWizard(true)} />
        <PostPanel date={date} entry={entry} />
      </div>
      <div className="panel">
        <div className="panel-head wrap"><div className="card-title">Journal notes</div><span className="muted" style={{ fontSize: 12 }}>Saved automatically</span></div>
        <RichText boxed docKey={date} value={entry.notes} onChange={(html) => saveDiary(date, { notes: html })} placeholder="Write about your session…" minHeight={220} />
      </div>
      <div className={d ? 'diary-media' : ''}>
      {d && <ExecChart date={date} trades={d.trades} onOpenTrade={setOpen} />}
      <div className="panel" style={{ marginTop: d ? 0 : 22 }}>
        <div className="panel-head">
          <div className="card-title">Chart screenshots</div>
          <div className="row gap8">
            <span className="muted" style={{ fontSize: 12 }}>{(entry.images || []).length} image{(entry.images || []).length === 1 ? '' : 's'}</span>
            <Popover align="right" trigger={({ toggle }) => (
              <button className="btn xs" onClick={toggle} title="How screenshots are auto-captioned">Captions: {CAPTION_TF.find((x) => x.value === capTf)?.label.replace('Always ', '').replace(/ \(M\d\)/, '')} <ChevronDown size={13} /></button>
            )}>
              {(close) => (
                <>
                  <div className="muted" style={{ fontSize: 11.5, padding: '4px 10px' }}>Timeframe in auto-captions</div>
                  {CAPTION_TF.map((x) => (
                    <button key={x.value} className={`pop-item ${capTf === x.value ? 'on' : ''}`} onClick={() => { setSetting('coach', (c) => ({ ...c, captionTf: x.value })); close(); }}>{x.label}</button>
                  ))}
                  {capTf !== 'auto' && (entry.images || []).some((im) => im.caption && retimeCaption(im.caption, capTf) !== im.caption) && (
                    <>
                      <div className="pop-sep" />
                      <button className="pop-item" onClick={() => { saveDiary(date, { images: (entry.images || []).map((im) => ({ ...im, caption: retimeCaption(im.caption, capTf) })) }); close(); toast('Captions updated'); }}>Apply to this day’s screenshots</button>
                    </>
                  )}
                </>
              )}
            </Popover>
          </div>
        </div>
        <Gallery images={entry.images || []} onChange={(images) => saveDiary(date, { images })}
          autoCaption={(file) => chartCaption(file, { coach: state.settings.coach, daySymbols: (d?.trades || []).map((t) => t.symbol), onRequest: () => setSetting('coach', (c) => ({ ...c, requestsUsed: c.requestsUsed + 1 })) })}
          onAsk={(src, caption) => askCoachAboutImage({
          src,
          title: `Chart · ${dow}, ${fmtDate(date)}`,
          text: `This is my chart from ${dow}, ${fmtDate(date)}${caption ? ` (${caption})` : ''}, with my executions, market structure and order flow. How were my entries and exits relative to the structure and order flow? What did I do well, and what should I have done differently?`,
          focus: d ? buildReviewContext(state, { kind: 'day', label: `${dow}, ${fmtDate(date)}`, date, trades: d.trades, prevTrades: prevDay?.trades || [] }) : null,
        }).catch(() => toast('Couldn’t open that image'))} />
      </div>
      </div>
      {d && <CoachReview reviewKey={`day:${date}`} kind="day" label={`${dow}, ${fmtDate(date)}`} date={date} trades={d.trades} prevTrades={prevDay?.trades || []} />}
      {open && <TradeDrawer trade={open} onClose={() => setOpen(null)} siblings={d?.trades} onNavigate={setOpen} />}
      <SessionWizard open={wizard} onClose={() => setWizard(false)} date={date} existing={pre} />
    </div>
  );
}
