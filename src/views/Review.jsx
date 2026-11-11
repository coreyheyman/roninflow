import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Maximize2, ChevronLeft, ChevronRight, ChartArea, ChartColumn, CircleCheck, CircleDashed, Clock3, Flag, Quote, RotateCcw, TriangleExclamationPoint as TriangleAlert, ArrowRight, Pencil, ChevronUp, ChevronDown, Trash, Plus, Check } from 'lucide-react';
import { useStore, useAccountTrades, navigate } from '../store/store';
import { AccountPicker, Seg, Private, Modal, ModalHead, useToast } from '../components/ui';
import { PnlChart, MarkerScale } from '../components/Charts';
import { RegimeCards } from '../components/Playbook';
import { playbookOf } from '../lib/playbook';
import { DiaryDayModal } from './Diary';
import { WrappedButton } from '../components/Wrapped';
import CoachReview from '../components/CoachReview';
import { periodBalanceGap } from '../lib/balance';

/** Opens a day's diary in a pop-up on top of the review page. */
const OpenDay = createContext(() => {});
const useOpenDay = () => useContext(OpenDay);
/** Opens another period's review in a pop-up (null outside the Review page). */
const OpenReview = createContext(null);

/** Link to a review: opens the pop-up on the Review page (Ctrl/⌘-click still opens the page). */
function RevLink({ p, className, children, style }) {
  const open = useContext(OpenReview);
  return (
    <a
      href={reviewHref(p)}
      className={className}
      style={style}
      onClick={(e) => { if (open && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); open(p); } }}
    >
      {children}
    </a>
  );
}
import {
  uid, periodMetrics, groupByDay, keyOf, fmtMoney, fmtDate, fmtTime12, pfText, ratioText, MONTHS, MONTHS_LONG, WEEKDAYS, toDate, startOfCalWeek, fmtCompact, equityCurve, startOfWeek, fmtShortDate,
} from '../lib/stats';
import {
  REVIEW_TYPES, REVIEW_PROMPTS, reviewPrompts, commitmentField, periodFromId, periodOf, shiftPeriod, reviewKey, reviewHref, reviewStatus, inPeriod, dueReviews, withReviewNotifications,
} from '../lib/reviews';

const nTrades = (n) => `${n} trade${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- hooks used by the layout
/** Adds "review due" notifications once the server/browser state has loaded. */
export function useReviewWatcher() {
  const { storage, update } = useStore();
  const ready = storage.mode === 'server' || storage.mode === 'local';
  useEffect(() => {
    if (!ready) return undefined;
    const run = () => update((s) => withReviewNotifications(s) || s);
    run();
    const id = setInterval(run, 60000);
    return () => clearInterval(id);
  }, [ready, update]);
}
export function useDueReviews() {
  const { state } = useStore();
  return useMemo(() => dueReviews(state), [state.trades, state.reviews]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------------------------------------------------------------- formatting helpers
const money0 = (v) => fmtMoney(v, { dp: 0, sign: true });
const tone = {
  money: (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : ''),
  winRate: (v) => (v >= 50 ? 'pos' : v >= 35 ? 'warn' : 'neg'),
  pf: (v) => (v >= 1.5 ? 'pos' : v >= 1 ? 'warn' : 'neg'),
  pr: (v) => (v >= 0.75 ? 'pos' : v >= 0.5 ? 'warn' : 'neg'),
  romad: (v) => (v >= 2 ? 'pos' : v >= 1 ? 'warn' : 'neg'),
  sharpe: (v) => (v == null ? '' : v >= 1 ? 'pos' : v >= 0 ? 'warn' : 'neg'),
  pct90: (v) => (v == null ? '' : v >= 90 ? 'pos' : v >= 70 ? 'warn' : 'neg'),
  lossStreak: (v) => (v >= 4 ? 'neg' : v >= 2 ? 'warn' : 'pos'),
};
const STATUS = {
  complete: { label: 'Completed', cls: 'pos-soft', icon: CircleCheck },
  due: { label: 'Review due', cls: 'warn-soft', icon: Flag },
  missed: { label: 'Not reviewed', cls: 'neg-soft', icon: TriangleAlert },
  draft: { label: 'In progress', cls: 'neutral', icon: Clock3 },
  open: { label: 'Upcoming', cls: 'neutral', icon: Clock3 },
  none: { label: 'No trades', cls: 'neutral', icon: CircleDashed },
};
export function StatusBadge({ status, small }) {
  const s = STATUS[status];
  return <span className={`badge ${s.cls}`} style={small ? { fontSize: 11, padding: '2px 6px' } : undefined}><s.icon size={small ? 11 : 13} /> {s.label}</span>;
}

function Tile({ label, value, t = '', sub, title, big }) {
  return (
    <div className={`rv-tile ${t}`} title={title}>
      <div className="rv-tile-l">{label}</div>
      <div className={`rv-tile-v ${big ? 'big' : ''}`}>{value}</div>
      {sub && <div className="rv-tile-s">{sub}</div>}
    </div>
  );
}

function useMetrics(trades) {
  const { state } = useStore();
  const pb = playbookOf(state);
  return useMemo(() => periodMetrics(trades, { diary: state.diary, blockers: pb.blockers }), [trades, state.diary, pb.blockers]);
}

/** The full metric grid from the monthly sheet. */
function MetricGrid({ m }) {
  const P = ({ v, f = money0 }) => <Private>{f(v)}</Private>;
  const pctOrDash = (v) => (v == null ? '—' : `${Math.round(v)}%`);
  const discSub = m.count ? `${m.flaggedTrades} of ${m.count} trades flagged${m.flaggedTrades ? ` · ${money0(m.flaggedPnl)}` : ''}` : '';
  return (
    <div className="rv-tiles five">
      <Tile label="Realized P&L" value={<P v={m.net} />} t={tone.money(m.net)} />
      <Tile label="Win rate" value={`${Math.round(m.winRate)}%`} t={m.count ? tone.winRate(m.winRate) : ''} sub={`${m.wins}W · ${m.losses}L · ${m.be}BE`} />
      <Tile label="Profit factor" value={pfText(m.profitFactor)} t={m.count ? tone.pf(m.profitFactor) : ''} />
      <Tile label="Sharpe ratio" value={m.sharpe == null ? '—' : m.sharpe.toFixed(2)} t={tone.sharpe(m.sharpe)} sub="daily, annualised" title="Mean daily P&L ÷ standard deviation of daily P&L × √252" />
      <Tile label="Biggest drawdown" value={<P v={-m.maxDD} />} t={m.maxDD ? 'neg' : ''} sub="peak to trough" />
      <Tile label="Avg winning day" value={<P v={m.avgWinDay} />} t={tone.money(m.avgWinDay)} />
      <Tile label="Avg losing day" value={<P v={m.avgLossDay} />} t={tone.money(m.avgLossDay)} />
      <Tile label="Avg day" value={<P v={m.avgDay} />} t={tone.money(m.avgDay)} />
      <Tile label="Best day" value={<P v={m.bestDay} />} t={tone.money(m.bestDay)} />
      <Tile label="Worst day" value={<P v={m.worstDay} />} t={tone.money(m.worstDay)} />
      <Tile label="Max consecutive winning days" value={m.maxWinStreak} t={m.days ? 'pos' : ''} />
      <Tile label="Max consecutive losing days" value={m.maxLossStreak} t={m.days ? tone.lossStreak(m.maxLossStreak) : ''} />
      <Tile label="Winning days" value={`${Math.round(m.winDaysPct)}%`} t={m.days ? tone.winRate(m.winDaysPct) : ''} sub={`${m.days} trading day${m.days === 1 ? '' : 's'}`} />
      <Tile label="Disciplined trades" value={pctOrDash(m.discipline)} t={tone.pct90(m.discipline)} sub={discSub} title="Trades with no edge blocker flagged ÷ all trades. Flag blockers on each trade from its details." />
      <Tile label="Size management" value={pctOrDash(m.sizeMgmt)} t={tone.pct90(m.sizeMgmt)} sub={m.count ? `${m.sizingTrades} of ${m.count} trades flagged for sizing` : ''} title="Trades not flagged with a sizing blocker (Bad Sizing) ÷ all trades" />
    </div>
  );
}

/** EV · Performance Ratio · ROMAD headline cards. */
function Headline({ m }) {
  return (
    <div className="rv-head3">
      <div className="panel rv-hcard">
        <div className="rv-tile-l">EV <span className="muted2">· expectancy per trade</span></div>
        <div className={`rv-hval ${tone.money(m.ev)}`}><Private>{fmtMoney(m.ev, { sign: true })}</Private></div>
        <div className="muted" style={{ fontSize: 12.5 }}>{nTrades(m.count)} · net ÷ trades</div>
      </div>
      <div className="panel rv-hcard">
        <div className="rv-tile-l">Performance Ratio</div>
        <div className={`rv-hval ${m.count ? tone.pr(m.perfRatio) : ''}`}>{ratioText(m.perfRatio)}</div>
        <MarkerScale value={m.perfRatio} min={0} max={1.5} marks={[{ v: 0.5, color: 'var(--neg)', label: '0.5' }, { v: 0.75, color: 'var(--pos)', label: '0.75' }]} />
        <div className="muted" style={{ fontSize: 12.5 }}>win% × avg win ÷ avg loss</div>
      </div>
      <div className="panel rv-hcard">
        <div className="rv-tile-l">ROMAD <span className="muted2">· return over max drawdown</span></div>
        <div className={`rv-hval ${m.count ? tone.romad(m.romad) : ''}`}>{ratioText(m.romad)}</div>
        <MarkerScale value={m.romad} min={-2} max={4} marks={[{ v: 1, color: 'var(--warn)', label: '1' }, { v: 2, color: 'var(--pos)', label: '2' }]} />
        <div className="muted" style={{ fontSize: 12.5 }}><Private>{money0(m.net)}</Private> ÷ <Private>{fmtMoney(m.maxDD, { dp: 0 })}</Private> max drawdown</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- calendars
function useDayMap(trades) {
  return useMemo(() => Object.fromEntries(groupByDay(trades).map((d) => [d.date, d])), [trades]);
}
const wr = (d) => (d.count ? Math.round((d.wins / d.count) * 100) : 0);

/** Month grid. variant: full (P&L + trades + win rate, week column) | mini (compact P&L) | heat (colour only). */
function MonthCal({ year, month, dayMap, variant = 'full', onDay: onDayProp }) {
  const openDay = useOpenDay();
  const onDay = onDayProp || openDay;
  const { state } = useStore();
  const priv = state.settings.privacy;
  const first = new Date(year, month, 1), last = new Date(year, month + 1, 0);
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthDays = Object.values(dayMap).filter((d) => d.date.startsWith(prefix));
  const cols = [0, 1, 2, 3, 4, 5, 6]; // Sunday → Saturday
  const weeks = [];
  for (let s = startOfCalWeek(first); s <= last; s = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7)) {
    weeks.push(cols.map((i) => new Date(s.getFullYear(), s.getMonth(), s.getDate() + i)));
  }
  const maxAbs = Math.max(1, ...monthDays.map((d) => Math.abs(d.net)));
  const today = keyOf(new Date());
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const short = (v) => `${v > 0 ? '+' : ''}${fmtCompact(v)}`;
  const showWeek = variant !== 'heat';
  return (
    <div className={`rv-cal ${variant}`} style={{ '--cols': cols.length + (showWeek ? 1 : 0) }}>
      <div className="rv-cal-row head">
        {cols.map((i) => <div key={i}>{variant === 'full' ? WEEKDAYS[i] : names[i].slice(0, variant === 'heat' ? 1 : 3)}</div>)}
        {showWeek && <div>{variant === 'full' ? 'Week' : 'Wk'}</div>}
      </div>
      {weeks.map((wk, wi) => {
        const inWeek = wk.map((d) => dayMap[keyOf(d)]).filter((d) => d && d.date.startsWith(prefix));
        const wNet = inWeek.reduce((s, d) => s + d.net, 0);
        const wCount = inWeek.reduce((s, d) => s + d.count, 0);
        const wWins = inWeek.reduce((s, d) => s + d.wins, 0);
        return (
          <div className="rv-cal-row" key={wi}>
            {wk.map((d) => {
              const k = keyOf(d);
              const out = d.getMonth() !== month;
              const day = out ? null : dayMap[k];
              const cls = `rv-day ${out ? 'out' : ''} ${day ? (day.net >= 0 ? 'win' : 'loss') : ''} ${k === today ? 'today' : ''}`;
              const heatBg = variant === 'heat' && day ? { background: `color-mix(in srgb, var(${day.net >= 0 ? '--pos-strong' : '--neg'}) ${Math.round(18 + 62 * Math.min(1, Math.abs(day.net) / maxAbs))}%, transparent)` } : undefined;
              const tip = day ? `${fmtDate(k)} · ${fmtMoney(day.net, { sign: true })} · ${nTrades(day.count)} · ${wr(day)}% win` : out ? '' : fmtDate(k);
              return (
                <div key={k} className={cls} style={heatBg} title={tip} onClick={() => !out && onDay?.(k)}>
                  {variant !== 'heat' && !out && <span className="dn">{d.getDate()}</span>}
                  {day && variant === 'full' && (
                    <>
                      <div className={`pv ${day.net >= 0 ? 'pos' : 'neg'}`}><span className={`pv-full ${priv ? 'hidden-val' : ''}`}>{fmtMoney(day.net, { sign: true, dp: 0 })}</span><span className={`pv-short ${priv ? 'hidden-val' : ''}`}>{short(day.net)}</span></div>
                      <div className="rv-day-meta"><span>{nTrades(day.count)}</span><span>{wr(day)}%</span></div>
                    </>
                  )}
                  {day && variant === 'mini' && <div className={`pv ${day.net >= 0 ? 'pos' : 'neg'}`}><span className={priv ? 'hidden-val' : ''}>{short(day.net)}</span></div>}
                </div>
              );
            })}
            {showWeek && (
              <div className={`rv-wk ${inWeek.length ? (wNet >= 0 ? 'win' : 'loss') : ''}`}>
                {variant === 'full' && <span className="muted" style={{ fontSize: 11.5 }}>W{wi + 1}</span>}
                {inWeek.length > 0 && (
                  <>
                    <div className={`pv ${wNet >= 0 ? 'pos' : 'neg'}`}>{variant === 'mini' ? <span className={priv ? 'hidden-val' : ''}>{short(wNet)}</span> : <><span className={`pv-full ${priv ? 'hidden-val' : ''}`}>{fmtMoney(wNet, { sign: true, dp: 0 })}</span><span className={`pv-short ${priv ? 'hidden-val' : ''}`}>{short(wNet)}</span></>}</div>
                    {variant === 'full' && <div className="rv-day-meta"><span>{wCount}t</span><span>WR {Math.round((wWins / wCount) * 100)}%</span></div>}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MonthCard({ year, month, trades, dayMap, variant }) {
  const { state } = useStore();
  const m = useMetrics(trades);
  const p = periodOf('monthly', new Date(year, month, 1));
  const open = useContext(OpenReview);
  const onOpen = () => (open ? open(p) : navigate(`review/monthly/${p.id}`));
  const status = reviewStatus(state.reviews?.[reviewKey(p)], p);
  return (
    <div className="panel rv-month">
      <div className="rv-month-head">
        <button className="rv-link" onClick={onOpen}>{variant === 'heat' ? MONTHS[month] : MONTHS_LONG[month]}</button>
        {status === 'complete' && <CircleCheck size={13} className="pos" title="Monthly review completed" />}
        <div className="grow" />
        {m.count > 0 ? (
          <span className="row gap8" style={{ fontSize: 12 }}>
            <span className={tone.pf(m.profitFactor)}>PF {pfText(m.profitFactor)}</span>
            <b className={tone.money(m.net)} style={{ fontWeight: 600 }}><Private>{money0(m.net)}</Private></b>
          </span>
        ) : <span className="muted2" style={{ fontSize: 12 }}>No trades</span>}
      </div>
      <MonthCal year={year} month={month} dayMap={dayMap} variant={variant} />
    </div>
  );
}

function EquityPanel({ trades, title = 'Equity curve', height = 240 }) {
  const { state, setSetting } = useStore();
  const bars = state.settings.reviewChart === 'bar';
  const priv = state.settings.privacy;
  const curve = useMemo(() => equityCurve(trades), [trades]);
  const area = useMemo(() => curve.map((c) => ({ label: fmtShortDate(c.x), y: c.y, tip: `${fmtDate(c.x)} · ${fmtTime12(c.x)} · ${c.t.symbol} ${fmtMoney(c.t.pnl, { sign: true })}` })), [curve]);
  const days = useMemo(() => [...groupByDay(trades)].reverse().map((d) => ({ label: fmtShortDate(d.date), y: d.net, tip: `${WEEKDAYS[toDate(d.date).getDay()]}, ${fmtDate(d.date)} · ${d.count} trade${d.count === 1 ? '' : 's'}` })), [trades]);
  const yFmt = (v) => (priv ? '•••' : fmtMoney(v, { dp: 0, raw: true }));
  return (
    <div className="panel" style={{ padding: 18 }}>
      <div className="panel-head" style={{ marginBottom: 6 }}>
        <div className="card-title">{bars ? title.replace(/equity curve/i, 'P&L by day') : title}</div>
        <Seg icon value={bars ? 'bar' : 'area'} onChange={(v) => setSetting('reviewChart', v)} options={[{ value: 'area', icon: ChartArea, title: 'Equity curve' }, { value: 'bar', icon: ChartColumn, title: 'P&L by day' }]} />
      </div>
      {!trades.length ? <div className="empty" style={{ padding: 30 }}>No trades in this period.</div>
        : bars ? <PnlChart data={days} mode="bar" height={height} xLabels={7} yFmt={yFmt} />
        : <PnlChart data={area} smooth height={height} xLabels={6} yFmt={yFmt} />}
    </div>
  );
}

// ---------------------------------------------------------------- review form
function AutoText({ value, onChange, placeholder }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(140, el.scrollHeight + 2)}px`;
  }, [value]);
  return <textarea ref={ref} className="input rv-text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** Edit the questions for one review type (weekly, monthly…). Answers are kept per question. */
function QuestionEditor({ type, onClose }) {
  const { state, setSetting } = useStore();
  const toast = useToast();
  const [qs, setQs] = useState(() => reviewPrompts(state, type).map((q) => ({ ...q })));
  const label = REVIEW_TYPES.find((t) => t.id === type).label;
  const upd = (i, k, v) => setQs((x) => x.map((q, j) => (j === i ? { ...q, [k]: v } : q)));
  const move = (i, d) => setQs((x) => { const y = [...x]; const [q] = y.splice(i, 1); y.splice(i + d, 0, q); return y; });
  const save = (list) => {
    setSetting('reviewQuestions', (cur) => ({ ...(cur || {}), [type]: list }));
    toast(list ? `${label} review questions saved` : `${label} review questions reset`);
    onClose();
  };
  return (
    <Modal open onClose={onClose} width={720}>
      <ModalHead title={`${label} review questions`} sub="Write the questions you want to answer each period. The last one shows up as your commitment at the start of the next period." onClose={onClose} />
      <div className="modal-body col gap8">
        {qs.map((q, i) => (
          <div key={q.id} className="panel col gap6" style={{ padding: 12 }}>
            <div className="row gap6">
              <span className="muted" style={{ width: 18, fontSize: 12 }}>{i + 1}.</span>
              <input className="input grow" style={{ height: 34 }} placeholder="Question" value={q.label} onChange={(e) => upd(i, 'label', e.target.value)} />
              <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp size={14} /></button>
              <button className="icon-btn" title="Move down" disabled={i === qs.length - 1} onClick={() => move(i, 1)}><ChevronDown size={14} /></button>
              <button className="icon-btn" title="Remove" disabled={qs.length === 1} onClick={() => setQs((x) => x.filter((_, j) => j !== i))}><Trash size={14} /></button>
            </div>
            <input className="input" style={{ height: 32, marginLeft: 24, width: 'calc(100% - 24px)' }} placeholder="Hint shown under the question (optional)" value={q.hint || ''} onChange={(e) => upd(i, 'hint', e.target.value)} />
          </div>
        ))}
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setQs((x) => [...x, { id: uid('q'), label: '', hint: '' }])}><Plus size={14} /> Add question</button>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => save(null)}>Reset to built-in questions</button>
        <div className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn white" disabled={!qs.some((q) => q.label.trim())} onClick={() => save(qs.filter((q) => q.label.trim()))}><Check size={15} /> Save</button>
      </div>
    </Modal>
  );
}

function ReviewForm({ period }) {
  const { state, saveReview } = useStore();
  const key = reviewKey(period);
  const review = state.reviews?.[key];
  const status = reviewStatus(review, period, new Date(), state.trades.some((t) => inPeriod(t, period)));
  const prompts = reviewPrompts(state, period.type);
  const [editQs, setEditQs] = useState(false);
  const answers = review?.answers || {};
  const filled = prompts.filter((q) => answers[q.id]?.trim()).length;
  const set = (id, v) => saveReview(key, (cur) => ({ ...cur, answers: { ...(cur.answers || {}), [id]: v } }));
  const noun = REVIEW_TYPES.find((t) => t.id === period.type).noun;
  return (
    <div className="panel rv-form">
      <div className="rv-form-head">
        <div>
          <div className="rv-section-title">{REVIEW_TYPES.find((t) => t.id === period.type).label} Review</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
            {status === 'open' || status === 'draft'
              ? `Due ${fmtDate(keyOf(period.dueAt))} at ${fmtTime12(keyOf(period.dueAt) + 'T13:00:00')} — you can start any time.`
              : review?.completedAt ? `Completed ${fmtDate(review.completedAt)}` : `${filled} of ${prompts.length} answered`}
          </div>
        </div>
        <div className="row gap8">
          <button className="btn xs" onClick={() => setEditQs(true)} title="Change, add or remove the questions for this review type"><Pencil size={12} /> Edit questions</button>
          <StatusBadge status={status} />
        </div>
      </div>
      {editQs && <QuestionEditor type={period.type} onClose={() => setEditQs(false)} />}
      <div className={`rv-prompts n${prompts.length}`}>
        {prompts.map((q, i) => (
          <label key={q.id} className="rv-prompt">
            <span className="rv-prompt-l">{prompts.length > 2 && <i>{i + 1}</i>}{q.label}</span>
            <span className="rv-prompt-h">{q.hint}</span>
            <AutoText value={answers[q.id] || ''} onChange={(v) => set(q.id, v)} placeholder="Write your review…" />
          </label>
        ))}
      </div>
      <div className="row gap12" style={{ marginTop: 16, flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: 12.5 }}>Saved automatically{review?.updatedAt ? ` · ${fmtTime12(review.updatedAt)}` : ''}</span>
        <div className="grow" />
        {review?.completedAt ? (
          <button className="btn" onClick={() => saveReview(key, { completedAt: null })}><RotateCcw size={14} /> Reopen review</button>
        ) : (
          <button className="btn primary" disabled={!filled} onClick={() => saveReview(key, { completedAt: new Date().toISOString() })}><CircleCheck size={15} /> Mark {noun} reviewed</button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pages
function WeekDays({ period, dayMap }) {
  const { state } = useStore();
  const openDay = useOpenDay();
  const priv = state.settings.privacy;
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(period.start); d.setDate(d.getDate() + i);
    const k = keyOf(d);
    if (i < 5 || dayMap[k]) days.push({ d, k, day: dayMap[k] });
  }
  const list = days.map((x) => x.day).filter(Boolean);
  const net = list.reduce((s, d) => s + d.net, 0), n = list.reduce((s, d) => s + d.count, 0), w = list.reduce((s, d) => s + d.wins, 0);
  const today = keyOf(new Date());
  return (
    <div className="rv-week" style={{ '--n': days.length + 1 }}>
      {days.map(({ d, k, day }) => (
        <div key={k} className={`rv-wday ${day ? (day.net >= 0 ? 'win' : 'loss') : ''} ${k === today ? 'today' : ''}`} onClick={() => openDay(k)} title="Open this day's diary">
          <div className="rv-wday-h"><span>{WEEKDAYS[d.getDay()]}</span><span className="muted">{MONTHS[d.getMonth()]} {d.getDate()}</span></div>
          <div className={`rv-wday-v ${day ? (day.net >= 0 ? 'pos' : 'neg') : 'muted2'}`}>
            {day ? <span className={priv ? 'hidden-val' : ''}>{fmtMoney(day.net, { sign: true, dp: 0 })}</span> : '—'}
          </div>
          <div className="rv-wday-f">{day ? <><span>{nTrades(day.count)}</span><span>{wr(day)}%</span></> : <span className="muted2">No trades</span>}</div>
        </div>
      ))}
      <div className={`rv-wday total ${list.length ? (net >= 0 ? 'win' : 'loss') : ''}`}>
        <div className="rv-wday-h"><span>Week</span></div>
        <div className={`rv-wday-v ${list.length ? (net >= 0 ? 'pos' : 'neg') : 'muted2'}`}>{list.length ? <span className={priv ? 'hidden-val' : ''}>{fmtMoney(net, { sign: true, dp: 0 })}</span> : '—'}</div>
        <div className="rv-wday-f">{list.length ? <><span>{nTrades(n)}</span><span>WR {Math.round((w / n) * 100)}%</span></> : <span className="muted2">—</span>}</div>
      </div>
    </div>
  );
}

function WeekDiary({ period, trades }) {
  const { state } = useStore();
  const openDay = useOpenDay();
  const rows = [];
  const blockers = {};
  for (const t of trades) for (const b of t.blockers || []) { (blockers[b] ||= { n: 0, pnl: 0 }); blockers[b].n++; blockers[b].pnl += t.pnl; }
  for (let i = 0; i < 7; i++) {
    const d = new Date(period.start); d.setDate(d.getDate() + i);
    const k = keyOf(d);
    const post = state.diary[k]?.post;
    if (!post) continue;
    if (post.tomorrow?.trim()) rows.push({ k, d, text: post.tomorrow });
  }
  const bl = Object.entries(blockers).sort((a, b) => a[1].pnl - b[1].pnl || b[1].n - a[1].n);
  return (
    <div className="panel" style={{ padding: 18 }}>
      <div className="card-title" style={{ marginBottom: 10 }}>From your diary this week</div>
      <div className="rv-tile-l" style={{ marginBottom: 6 }}>Edge blockers flagged</div>
      {bl.length ? (
        <div className="row gap8 wrap" style={{ marginBottom: 14 }}>
          {bl.map(([b, c]) => <span key={b} className="badge neg-soft" title={`${c.n} trade${c.n === 1 ? '' : 's'} flagged`}>{b} × {c.n} · <Private>{money0(c.pnl)}</Private></span>)}
        </div>
      ) : <div className="muted2" style={{ fontSize: 12.5, marginBottom: 14 }}>No trades flagged this week.</div>}
      <div className="rv-tile-l" style={{ marginBottom: 6 }}>“What will I do better tomorrow?”</div>
      {rows.length ? rows.map((r) => (
        <a key={r.k} href={`#/diary/${r.k}`} onClick={(e) => { e.preventDefault(); openDay(r.k); }} className="rv-note"><b>{WEEKDAYS[r.d.getDay()].slice(0, 3)}</b> {r.text}</a>
      )) : <div className="muted2" style={{ fontSize: 12.5 }}>No notes yet.</div>}
    </div>
  );
}

function Commitment({ period }) {
  const { state } = useStore();
  const prev = shiftPeriod(period, -1);
  const field = commitmentField(state, period.type);
  const text = state.reviews?.[reviewKey(prev)]?.answers?.[field];
  if (!text?.trim()) return null;
  return (
    <RevLink p={prev} className="panel rv-commit">
      <Quote size={16} className="accent" style={{ flexShrink: 0, marginTop: 2 }} />
      <div className="grow">
        <div className="rv-tile-l">Your commitment from {period.type === 'weekly' ? 'last week' : prev.label}</div>
        <div style={{ whiteSpace: 'pre-wrap', marginTop: 4, lineHeight: 1.55 }}>{text}</div>
      </div>
    </RevLink>
  );
}

function Weekly({ period, trades }) {
  const m = useMetrics(trades);
  const dayMap = useDayMap(trades);
  return (
    <>
      <Commitment period={period} />
      <WeekDays period={period} dayMap={dayMap} />
      <div className="rv-tiles eight">
        <Tile label="Net P&L" value={<Private>{money0(m.net)}</Private>} t={tone.money(m.net)} big />
        <Tile label="Win rate" value={`${Math.round(m.winRate)}%`} t={m.count ? tone.winRate(m.winRate) : ''} sub={`${m.wins}W · ${m.losses}L`} big />
        <Tile label="Profit factor" value={pfText(m.profitFactor)} t={m.count ? tone.pf(m.profitFactor) : ''} big />
        <Tile label="Performance Ratio" value={ratioText(m.perfRatio)} t={m.count ? tone.pr(m.perfRatio) : ''} big title="win% × avg win ÷ avg loss" />
        <Tile label="ROMAD" value={ratioText(m.romad)} t={m.count ? tone.romad(m.romad) : ''} big title="P&L ÷ max drawdown" />
        <Tile label="EV / trade" value={<Private>{fmtMoney(m.ev, { sign: true })}</Private>} t={tone.money(m.ev)} big />
        <Tile label="Max drawdown" value={<Private>{fmtMoney(-m.maxDD, { dp: 0 })}</Private>} t={m.maxDD ? 'neg' : ''} big />
        <Tile label="Disciplined trades" value={m.discipline == null ? '—' : `${Math.round(m.discipline)}%`} t={tone.pct90(m.discipline)} big title="Trades with no edge blocker flagged ÷ all trades" sub={m.count ? `${m.flaggedTrades} of ${m.count} flagged` : undefined} />
      </div>
      <div className="rv-two">
        <EquityPanel trades={trades} title="Week equity curve" />
        <WeekDiary period={period} trades={trades} />
      </div>
      <ReviewForm period={period} />
    </>
  );
}

function Monthly({ period, trades }) {
  const { state } = useStore();
  const m = useMetrics(trades);
  const dayMap = useDayMap(trades);
  const y = period.start.getFullYear(), mo = period.start.getMonth();
  // weekly reviews whose week (Mon–Fri) ends in this month
  const weeks = [];
  for (let s = startOfWeek(period.start); s <= period.end; s = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7)) {
    const p = periodOf('weekly', s);
    const fri = new Date(p.start); fri.setDate(fri.getDate() + 4);
    if (fri.getMonth() === mo) weeks.push(p);
  }
  return (
    <>
      <Commitment period={period} />
      <div className="panel" style={{ padding: 0 }}>
        <div className="rv-cal-top">
          <div className="rv-section-title">{period.label}</div>
          <div className="grow" />
          <span className="rv-chip">P&L <b className={tone.money(m.net)}><Private>{money0(m.net)}</Private></b></span>
          <span className="rv-chip">Avg day <b className={tone.money(m.avgDay)}><Private>{money0(m.avgDay)}</Private></b></span>
          <span className="rv-chip">PF <b className={m.count ? tone.pf(m.profitFactor) : ''}>{pfText(m.profitFactor)}</b></span>
        </div>
        <MonthCal year={y} month={mo} dayMap={dayMap} variant="full" />
      </div>
      <Headline m={m} />
      <MetricGrid m={m} />
      <div className="rv-two">
        <EquityPanel trades={trades} title="Month equity curve" />
        <div className="panel" style={{ padding: 18 }}>
          <div className="card-title" style={{ marginBottom: 10 }}>Weekly reviews</div>
          {weeks.map((p) => {
            const wt = trades.filter((t) => inPeriod(t, p));
            const st = reviewStatus(state.reviews?.[reviewKey(p)], p, new Date(), wt.length > 0);
            const net = wt.reduce((s, t) => s + t.pnl, 0);
            return (
              <RevLink key={p.id} p={p} className="rv-row">
                <span className="grow">{p.label}</span>
                {wt.length > 0 && <b className={tone.money(net)} style={{ fontWeight: 500 }}><Private>{money0(net)}</Private></b>}
                <StatusBadge status={st} small />
                <ArrowRight size={14} className="muted" />
              </RevLink>
            );
          })}
        </div>
      </div>
      <ReviewForm period={period} />
    </>
  );
}

/** Period P&L headline: trades + the account balance adjustment when it belongs to this period. */
function PeriodPnl({ period, label, net }) {
  const { state } = useStore();
  const gap = periodBalanceGap(state, (t) => inPeriod(t, period));
  const total = net + gap;
  return (
    <div>
      <div className="rv-tile-l">{label}</div>
      <div className={`rv-hval ${tone.money(total)}`} style={{ fontSize: 40 }}><Private>{money0(total)}</Private></div>
      {gap !== 0 && <div className="muted" style={{ fontSize: 12, marginTop: 2 }} title="P&L is your ATAS balance minus your starting balance. The adjustment is what the journal's trades don't account for (missing fills, account fees…), so it isn't in the quarter or month figures.">Trades <Private>{money0(net)}</Private> · balance adj. <Private>{fmtMoney(gap, { sign: true, dp: 0 })}</Private></div>}
    </div>
  );
}

function Quarterly({ period, trades, allTrades }) {
  const { state } = useStore();
  const m = useMetrics(trades);
  const dayMap = useDayMap(trades);
  const y = period.start.getFullYear(), m0 = period.start.getMonth();
  const months = [0, 1, 2].map((i) => periodOf('monthly', new Date(y, m0 + i, 1)));
  return (
    <>
      <Commitment period={period} />
      <div className="rv-qhead panel">
        <PeriodPnl period={period} net={m.net} label={<>{period.label} P&L <span className="muted2">· {period.sub}</span></>} />
        <div className="grow" />
        <span className="rv-chip">Win rate <b className={m.count ? tone.winRate(m.winRate) : ''}>{Math.round(m.winRate)}%</b></span>
        <span className="rv-chip">PF <b className={m.count ? tone.pf(m.profitFactor) : ''}>{pfText(m.profitFactor)}</b></span>
        <span className="rv-chip">Perf. ratio <b className={m.count ? tone.pr(m.perfRatio) : ''}>{ratioText(m.perfRatio)}</b></span>
        <span className="rv-chip">ROMAD <b className={m.count ? tone.romad(m.romad) : ''}>{ratioText(m.romad)}</b></span>
      </div>
      <div className="rv-months three">
        {months.map((p) => (
          <MonthCard key={p.id} year={y} month={p.start.getMonth()} trades={trades.filter((t) => inPeriod(t, p))} dayMap={dayMap} variant="mini" />
        ))}
      </div>
      <Headline m={m} />
      <MetricGrid m={m} />
      <div className="rv-two">
        <EquityPanel trades={trades} title="Quarter equity curve" />
        <div className="panel" style={{ padding: 18 }}>
          <div className="card-title" style={{ marginBottom: 10 }}>Month by month</div>
          <table className="rv-table">
            <thead><tr><th>Month</th><th>P&L</th><th>Win</th><th>PF</th><th>PR</th><th>ROMAD</th><th>Review</th></tr></thead>
            <tbody>
              {months.map((p) => <MonthRow key={p.id} p={p} trades={trades.filter((t) => inPeriod(t, p))} status={reviewStatus(state.reviews?.[reviewKey(p)], p, new Date(), trades.some((t) => inPeriod(t, p)))} />)}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel" style={{ padding: 18 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>Market conditions this quarter</div>
        <RegimeCards trades={trades} lookback={100000} caption={period.label} />
      </div>
      <ReviewForm period={period} />
    </>
  );
}

function MonthRow({ p, trades, status, label }) {
  const m = useMetrics(trades);
  const open = useContext(OpenReview);
  return (
    <tr onClick={() => (open ? open(p) : navigate(`review/${p.type}/${p.id}`))}>
      <td>{label || MONTHS[p.start.getMonth()]}</td>
      <td className={tone.money(m.net)}><Private>{m.count ? money0(m.net) : '—'}</Private></td>
      <td>{m.count ? `${Math.round(m.winRate)}%` : '—'}</td>
      <td className={m.count ? tone.pf(m.profitFactor) : ''}>{m.count ? pfText(m.profitFactor) : '—'}</td>
      <td className={m.count ? tone.pr(m.perfRatio) : ''}>{m.count ? ratioText(m.perfRatio) : '—'}</td>
      <td className={m.count ? tone.romad(m.romad) : ''}>{m.count ? ratioText(m.romad) : '—'}</td>
      <td><StatusBadge status={status} small /></td>
    </tr>
  );
}

function Yearly({ period, trades }) {
  const { state } = useStore();
  const m = useMetrics(trades);
  const dayMap = useDayMap(trades);
  const y = period.start.getFullYear();
  const quarters = [0, 1, 2, 3].map((q) => periodOf('quarterly', new Date(y, q * 3, 1)));
  return (
    <>
      <Commitment period={period} />
      <div className="rv-qhead panel">
        <PeriodPnl period={period} net={m.net} label={`${y} P&L`} />
        <div className="grow" />
        <div className="rv-quarters">
          {quarters.map((q) => {
            const qt = trades.filter((t) => inPeriod(t, q));
            const net = qt.reduce((s, t) => s + t.pnl, 0);
            const st = reviewStatus(state.reviews?.[reviewKey(q)], q);
            return (
              <RevLink key={q.id} p={q} className={`rv-q ${qt.length ? (net >= 0 ? 'win' : 'loss') : ''}`}>
                <span className="row gap6">{q.title} {st === 'complete' && <CircleCheck size={12} className="pos" />}</span>
                <b className={qt.length ? tone.money(net) : 'muted2'}><Private>{qt.length ? money0(net) : '—'}</Private></b>
              </RevLink>
            );
          })}
        </div>
      </div>
      <div className="rv-qcols">
        {Array.from({ length: 12 }, (_, i) => {
          const p = periodOf('monthly', new Date(y, i, 1));
          return <MonthCard key={p.id} year={y} month={i} trades={trades.filter((t) => inPeriod(t, p))} dayMap={dayMap} variant="heat" />;
        })}
      </div>
      <Headline m={m} />
      <MetricGrid m={m} />
      <div className="rv-two">
        <EquityPanel trades={trades} title={`${y} equity curve`} />
        <div className="panel" style={{ padding: 18 }}>
          <div className="card-title" style={{ marginBottom: 10 }}>Quarter by quarter</div>
          <table className="rv-table">
            <thead><tr><th>Quarter</th><th>P&L</th><th>Win</th><th>PF</th><th>PR</th><th>ROMAD</th><th>Review</th></tr></thead>
            <tbody>
              {quarters.map((q) => <MonthRow key={q.id} p={q} label={q.title} trades={trades.filter((t) => inPeriod(t, q))} status={reviewStatus(state.reviews?.[reviewKey(q)], q, new Date(), trades.some((t) => inPeriod(t, q)))} />)}
            </tbody>
          </table>
        </div>
      </div>
      <ReviewForm period={period} />
    </>
  );
}

function ReviewBody({ period, all }) {
  const trades = useMemo(() => all.filter((t) => inPeriod(t, period)), [all, period]);
  const prev = useMemo(() => { const q = shiftPeriod(period, -1); return all.filter((t) => inPeriod(t, q)); }, [all, period]);
  const body = period.type === 'weekly' ? <Weekly period={period} trades={trades} />
    : period.type === 'monthly' ? <Monthly period={period} trades={trades} />
    : period.type === 'quarterly' ? <Quarterly period={period} trades={trades} allTrades={all} />
    : <Yearly period={period} trades={trades} />;
  const label = period.type === 'weekly' ? `the week of ${period.label}` : period.label;
  return (
    <>
      {body}
      {trades.length > 0 && <CoachReview reviewKey={reviewKey(period)} kind={period.type} label={label} period={period} trades={trades} prevTrades={prev} />}
    </>
  );
}

/** Another period's review in a pop-up over the current Review page. */
function ReviewModal({ period, onPeriod, onClose }) {
  const { state } = useStore();
  const all = useAccountTrades();
  const ref = useRef(null);
  const bodyRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
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
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [period.type, period.id]);
  const type = REVIEW_TYPES.find((t) => t.id === period.type);
  const status = reviewStatus(state.reviews?.[reviewKey(period)], period, new Date(), state.trades.some((t) => inPeriod(t, period)));
  return createPortal(
    <div className="overlay day-modal-wrap" ref={ref} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal day-modal">
        <div className="day-modal-body" ref={bodyRef}>
          <div className="row gap12 day-modal-bar" style={{ marginBottom: 18 }}>
            <button className="btn sm" onClick={() => { onClose(); navigate(`review/${period.type}/${period.id}`); }} title="Open this review as a page"><Maximize2 size={14} /> <span className="hide-sm">Open page</span></button>
            <div className="sep-v hide-sm" style={{ height: 22 }} />
            <span className="muted hide-sm" style={{ fontSize: 13 }}>{type.label} review</span>
            <button className="btn sm" style={{ width: 32, padding: 0 }} onClick={() => onPeriod(shiftPeriod(period, -1))} title={`Previous ${type.noun}`}><ChevronLeft size={15} /></button>
            <div className="rv-period" style={{ minWidth: 0 }}>{period.label}</div>
            <button className="btn sm" style={{ width: 32, padding: 0 }} onClick={() => onPeriod(shiftPeriod(period, 1))} title={`Next ${type.noun}`}><ChevronRight size={15} /></button>
            <span className="hide-sm"><StatusBadge status={status} /></span>
            <div className="grow" />
            {all.some((t) => inPeriod(t, period)) && <WrappedButton key={`${period.type}:${period.id}`} period={period} />}
            <button className="icon-btn" style={{ border: '1px solid var(--border-2)' }} onClick={onClose} title="Close (Esc)"><X size={16} /></button>
          </div>
          <div className="rv">
            <ReviewBody key={`${period.type}:${period.id}`} period={period} all={all} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function Review({ type = 'weekly', id }) {
  const { state } = useStore();
  const kind = REVIEW_TYPES.some((t) => t.id === type) ? type : 'weekly';
  const period = useMemo(() => periodFromId(kind, id), [kind, id]);
  const all = useAccountTrades();
  const trades = useMemo(() => all.filter((t) => inPeriod(t, period)), [all, period]);
  const current = periodOf(kind);
  const status = reviewStatus(state.reviews?.[reviewKey(period)], period, new Date(), state.trades.some((t) => inPeriod(t, period)));
  const go = (p) => navigate(`review/${p.type}/${p.id}`);
  const isCurrent = current.id === period.id;
  const [dayOpen, setDayOpen] = useState(null);
  const [revOpen, setRevOpen] = useState(null);
  return (
    <OpenDay.Provider value={setDayOpen}>
    <OpenReview.Provider value={setRevOpen}>
    <div className="page rv">
      <div className="toolbar">
        <AccountPicker />
        <div className="row gap8">
          <button className="btn sm" style={{ width: 32, padding: 0 }} onClick={() => go(shiftPeriod(period, -1))} title="Previous"><ChevronLeft size={15} /></button>
          <div className="rv-period">{period.label}</div>
          <button className="btn sm" style={{ width: 32, padding: 0 }} onClick={() => go(shiftPeriod(period, 1))} title="Next"><ChevronRight size={15} /></button>
          {!isCurrent && <button className="btn xs" onClick={() => go(current)}>This {REVIEW_TYPES.find((t) => t.id === kind).noun}</button>}
        </div>
        <StatusBadge status={status} />
        {trades.length > 0 && <WrappedButton key={`${period.type}:${period.id}`} period={period} />}
        <div className="grow" />
        <Seg value={kind} onChange={(v) => navigate(`review/${v}`)} options={REVIEW_TYPES.map((t) => ({ value: t.id, label: t.label }))} />
      </div>
      <ReviewBody period={period} all={all} />
      {revOpen && <ReviewModal period={revOpen} onPeriod={setRevOpen} onClose={() => setRevOpen(null)} />}
      {dayOpen && <DiaryDayModal date={dayOpen} onClose={() => setDayOpen(null)} />}
    </div>
    </OpenReview.Provider>
    </OpenDay.Provider>
  );
}
