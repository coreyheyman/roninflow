// Macro → Economic Calendar: every scheduled release in your time zone, as a list, a week or a month.
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Search, CalendarDays, TriangleExclamationPoint as TriangleAlert } from 'lucide-react';
import { useStore } from '../store/store';
import { Seg, Modal, ModalHead, Switch } from '../components/ui';
import { keyOf, MONTHS, MONTHS_LONG, WEEKDAYS, homeTimeZone, wallClock, fmtTime12 } from '../lib/stats';
import { useMacro, refreshMacro, IMPACTS, impactOf, CURRENCIES, FLAGS, surprise, countdown } from '../lib/macro';

const DAY = 86400000;
const VIEWS = [{ value: 'list', label: 'List' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }];
const RANGES = [{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'next', label: 'Next week' }];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const sunday = (k) => { const d = parseKey(k); d.setDate(d.getDate() - d.getDay()); return keyOf(d); };
const nyDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
/** today's date in your time zone */
const homeToday = () => wallClock(new Date()).slice(0, 10);
const tzLabel = () => { try { return new Intl.DateTimeFormat('en-US', { timeZone: homeTimeZone(), timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || ''; } catch { return ''; } };
const dayTitle = (k) => { const d = parseKey(k); return `${WEEKDAYS[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`; };

/** an event with its day and clock time in your time zone */
const localize = (e) => {
  const wc = wallClock(e.t);
  return { ...e, ms: Date.parse(e.t), day: e.allDay ? nyDay(e.t) : wc.slice(0, 10), clock: wc };
};

function useNow(every = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), every); return () => clearInterval(id); }, [every]);
  return now;
}

const HOL = { closed: 'Markets closed', early: 'Early close', bank: 'Banks closed' };
const HolBadge = ({ k }) => <span className={`ec-hol ${k}`}>{HOL[k]}</span>;
const Impact = ({ id, title }) => <i className={`ec-imp ${id}`} title={title || `${impactOf(id).label} impact`} />;
const Ccy = ({ c }) => <span className="ec-ccy"><span className="ec-flag">{FLAGS[c] || '🏳️'}</span>{c}</span>;

function Val({ e, k }) {
  const v = e[k];
  if (!v) return <span className="muted2">—</span>;
  if (k !== 'actual') return <span>{v}</span>;
  const s = surprise(e);
  return <span className={`ec-act ${s || ''}`} title={s === 'beat' ? 'Better than expected for the currency' : s === 'miss' ? 'Worse than expected for the currency' : undefined}>{v}</span>;
}

// ---------- list ----------
function DayList({ days, byDay, nextMs, now, onOpen, emptyNote }) {
  const any = days.some((d) => byDay[d]?.length);
  if (!any) return <div className="ec-empty">{emptyNote}</div>;
  return (
    <div className="ec-list">
      <div className="ec-row ec-headrow">
        <span>Time</span><span /><span>Ccy</span><span>Event</span><span className="r">Actual</span><span className="r">Forecast</span><span className="r">Previous</span>
      </div>
      {days.filter((d) => byDay[d]?.length).map((d) => (
        <div key={d} className="ec-day">
          <div className={`ec-dayhead ${d === homeToday() ? 'today' : ''}`}>{dayTitle(d)}<span className="muted">{byDay[d].length} event{byDay[d].length === 1 ? '' : 's'}</span></div>
          {byDay[d].map((e, i) => {
            const prev = byDay[d][i - 1];
            const sameTime = prev && prev.clock === e.clock && !e.allDay && !prev.allDay;
            const next = e.ms === nextMs;
            return (
              <button key={e.id} className={`ec-row ${e.ms < now - 60000 ? 'past' : ''} ${next ? 'next' : ''} ${sameTime ? 'same' : ''}`} onClick={() => onOpen(e)}>
                <span className="ec-time">
                  {!sameTime && (e.allDay ? (e.holiday === 'early' ? 'Early close' : 'All day') : fmtTime12(e.clock))}
                  {next && !sameTime && <em>{countdown(e.ms - now)}</em>}
                </span>
                <Impact id={e.impact} />
                <Ccy c={e.ccy} />
                <span className="ec-title">{e.holiday && <HolBadge k={e.holiday} />}{e.holiday ? e.short : e.title}{e.src === 'schedule' && <span className="ec-sched" title="From the official release calendar — forecasts appear the week before">scheduled</span>}</span>
                <span className="r ec-v" data-l="Actual"><Val e={e} k="actual" /></span>
                <span className="r ec-v" data-l="Forecast"><Val e={e} k="forecast" /></span>
                <span className="r ec-v" data-l="Previous"><Val e={e} k="previous" /></span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------- week ----------
function WeekGrid({ start, byDay, now, onOpen }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = homeToday();
  return (
    <div className="ec-week-wrap">
      <div className="ec-week">
        {days.map((d) => {
          const list = byDay[d] || [];
          const dt = parseKey(d);
          return (
            <div key={d} className={`ec-wcol ${d === today ? 'today' : ''} ${dt.getDay() % 6 === 0 ? 'wkend' : ''}`}>
              <div className="ec-whead"><span>{SHORT_DAYS[dt.getDay()]}</span><b>{dt.getDate()}</b>{d === today && <i className="today-dot" />}<span className="muted grow r">{list.length || ''}</span></div>
              <div className="ec-wbody">
                {list.map((e) => (
                  <button key={e.id} className={`ec-chip ${e.impact} ${e.holiday ? `hol ${e.holiday}` : ''} ${e.ms < now - 60000 && !e.allDay ? 'past' : ''}`} onClick={() => onOpen(e)} title={e.title}>
                    <span className="ec-chip-top"><span>{e.allDay ? 'All day' : fmtTime12(e.clock)}</span><Ccy c={e.ccy} /></span>
                    <span className="ec-chip-title">{e.holiday ? e.short : e.title}</span>
                    {e.holiday && <HolBadge k={e.holiday} />}
                    {e.actual && <span className="ec-chip-vals"><Val e={e} k="actual" /> <span className="muted">vs {e.forecast || e.previous || '—'}</span></span>}
                  </button>
                ))}
                {!list.length && <span className="muted2 ec-none">No events</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- month ----------
const RANK = { high: 0, medium: 1, low: 2, holiday: 3, none: 4 };
// market closures go first in a day, then the biggest releases
const rankOf = (e) => (e.holiday === 'closed' || e.holiday === 'early' ? (e.ccy === 'USD' ? -2 : -1) : RANK[e.impact]);
function MonthGrid({ month, byDay, onDay }) {
  const first = `${month}-01`;
  const start = sunday(first);
  const [y, m] = month.split('-').map(Number);
  const weeks = Math.ceil((parseKey(first).getDay() + new Date(y, m, 0).getDate()) / 7);
  const today = homeToday();
  return (
    <div className="ec-month">
      <div className="ec-mhead">{SHORT_DAYS.map((d) => <div key={d}>{d}</div>)}</div>
      {Array.from({ length: weeks }, (_, w) => (
        <div key={w} className="ec-mrow">
          {Array.from({ length: 7 }, (_, i) => {
            const d = addDays(start, w * 7 + i);
            const list = [...(byDay[d] || [])].sort((a, b) => rankOf(a) - rankOf(b) || a.ms - b.ms);
            const out = !d.startsWith(month);
            // three or more holidays on one day (Christmas, Easter) fold into one chip of flags
            const hols = list.filter((e) => e.holiday);
            const folded = hols.length >= 3 ? { id: `${d}:hols`, fold: true, holiday: hols.some((h) => h.holiday === 'closed') ? 'closed' : hols[0].holiday, impact: 'holiday', ccys: [...new Set(hols.map((h) => h.ccy))], title: hols.map((h) => h.short).join(' · ') } : null;
            const items = folded ? [folded, ...list.filter((e) => !e.holiday)] : list;
            const show = items.slice(0, 3);
            return (
              <button key={d} className={`ec-mcell ${out ? 'out' : ''} ${d === today ? 'today' : ''}`} onClick={() => list.length && onDay(d)} disabled={!list.length}>
                <span className="ec-mday">{parseKey(d).getDate()}{d === today && <i className="today-dot" />}</span>
                {show.map((e) => (
                  <span key={e.id} className={`ec-mev ${e.impact} ${e.holiday ? `hol ${e.holiday}` : ''}`} title={e.fold ? e.title : `${e.ccy} ${e.title}`}>
                    {e.fold ? <>{e.ccys.map((c) => FLAGS[c]).join('')} holidays</> : e.holiday ? <>{FLAGS[e.ccy]} {e.short}</> : <><span className="ec-mev-t">{e.allDay ? '' : fmtTime12(e.clock).replace(':00', '').replace(' ', '').toLowerCase()}</span> {e.ccy} {e.title}</>}
                  </span>
                ))}
                {items.length > 3 && <span className="ec-more">+{items.length - 3} more</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------- one event ----------
function EventModal({ e, onClose }) {
  const [hist, setHist] = useState(null);
  useEffect(() => {
    if (!e || e.src === 'schedule' || e.src === 'holiday') return undefined;
    let on = true;
    setHist(null);
    fetch(`/api/macro/calendar/history?ccy=${encodeURIComponent(e.ccy)}&title=${encodeURIComponent(e.title)}`).then((r) => r.json()).then((j) => on && setHist(j.events || [])).catch(() => on && setHist([]));
    return () => { on = false; };
  }, [e]);
  if (!e) return null;
  const s = surprise(e);
  const earlier = (hist || []).filter((h) => h.t !== e.t).reverse();
  return (
    <Modal open onClose={onClose} width={560}>
      <ModalHead title={e.title} sub={`${FLAGS[e.ccy] || ''} ${e.ccy} · ${dayTitle(e.day)}${e.allDay ? '' : ` · ${fmtTime12(e.clock)} ${tzLabel()}`}`} onClose={onClose} />
      <div className="modal-body col gap16">
        {e.holiday ? <div className="col gap8"><span><HolBadge k={e.holiday} /></span><div style={{ fontSize: 14, lineHeight: 1.55 }}>{e.note}</div></div> : <div className="row gap8"><Impact id={e.impact} /><span>{impactOf(e.impact).label} impact</span>{e.src === 'schedule' && <span className="ec-sched">scheduled</span>}</div>}
        {!e.holiday && <div className="ec-vals">
          {['actual', 'forecast', 'previous'].map((k) => <div key={k}><span className="muted">{k[0].toUpperCase() + k.slice(1)}</span><b><Val e={e} k={k} /></b></div>)}
        </div>}
        {s && <div className={`ec-verdict ${s}`}>{s === 'beat' ? 'Came in better than expected for the currency.' : s === 'miss' ? 'Came in worse than expected for the currency.' : 'Came in as expected.'}</div>}
        {e.src === 'schedule' && <div className="muted" style={{ fontSize: 13 }}>Taken from the official release calendar. The forecast and the full list of that day’s releases appear when ForexFactory publishes that week, usually the weekend before.</div>}
        {e.src !== 'schedule' && e.src !== 'holiday' && (
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Earlier releases</div>
            {hist == null ? <div className="muted">Loading…</div> : earlier.length ? (
              <div className="ec-hist">
                <div className="ec-hrow muted"><span>Date</span><span className="r">Actual</span><span className="r">Forecast</span><span className="r">Previous</span></div>
                {earlier.map((h) => { const l = localize(h); return (
                  <div key={h.id} className="ec-hrow"><span>{MONTHS[parseKey(l.day).getMonth()]} {parseKey(l.day).getDate()}, {l.day.slice(0, 4)}</span><span className="r"><Val e={h} k="actual" /></span><span className="r">{h.forecast || '—'}</span><span className="r">{h.previous || '—'}</span></div>
                ); })}
              </div>
            ) : <div className="muted" style={{ fontSize: 13 }}>None saved yet. RoninFlow keeps every week it fetches, so earlier releases show up here over time.</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------- page ----------
export default function EconCalendar() {
  const { state, setSetting } = useStore();
  const s = state.settings;
  const view = s.ecView || 'list';
  // holidays are on by default (also for anyone who changed the impact filter before holidays existed)
  const impacts = s.ecImpactsV2 || [...new Set([...(s.ecImpacts || ['high', 'medium']), 'holiday'])];
  const ccys = s.ecCcys || [];
  const [range, setRange] = useState('week');
  const [anchor, setAnchor] = useState(homeToday);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [dayOpen, setDayOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const today = homeToday();

  // the days on screen
  const { from, to, days, label } = useMemo(() => {
    if (view === 'list') {
      const f = range === 'today' ? today : range === 'next' ? addDays(sunday(today), 7) : sunday(today);
      const t = range === 'today' ? today : addDays(f, 6);
      return { from: f, to: t, days: Array.from({ length: Math.round((parseKey(t) - parseKey(f)) / DAY) + 1 }, (_, i) => addDays(f, i)), label: null };
    }
    if (view === 'week') {
      const f = sunday(anchor);
      const t = addDays(f, 6);
      const a = parseKey(f), b = parseKey(t);
      return { from: f, to: t, days: Array.from({ length: 7 }, (_, i) => addDays(f, i)), label: `${MONTHS[a.getMonth()]} ${a.getDate()} – ${a.getMonth() === b.getMonth() ? '' : MONTHS[b.getMonth()] + ' '}${b.getDate()}, ${b.getFullYear()}` };
    }
    const month = anchor.slice(0, 7);
    const f = sunday(`${month}-01`);
    return { from: f, to: addDays(f, 41), days: [], label: `${MONTHS_LONG[+month.slice(5) - 1]} ${month.slice(0, 4)}`, month };
  }, [view, range, anchor, today]);

  const useTv = s.ecTradingView !== false;
  const [poll, setPoll] = useState(120e3);
  const { data, error, loading, reload } = useMacro(`/api/macro/calendar?from=${from}&to=${to}${useTv ? '' : '&tv=0'}`, { poll });
  const events = useMemo(() => (data?.events || []).map(localize), [data]);
  // just after a release, check for its actual every minute
  useEffect(() => {
    const waiting = useTv && events.some((e) => !e.allDay && e.forecast && !e.actual && e.ms < now && now - e.ms < 20 * 60e3);
    setPoll(waiting ? 60e3 : 120e3);
  }, [events, now, useTv]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => (impacts.includes(e.impact) || (e.impact === 'none' && impacts.includes('low')))
      && (!ccys.length || ccys.includes(e.ccy))
      && (!needle || e.title.toLowerCase().includes(needle) || e.ccy.toLowerCase() === needle));
  }, [events, impacts, ccys, q]);
  const byDay = useMemo(() => {
    const m = {};
    for (const e of shown) (m[e.day] ||= []).push(e);
    for (const k in m) m[k].sort((a, b) => (b.allDay - a.allDay) || a.ms - b.ms);
    return m;
  }, [shown]);
  const nextMs = useMemo(() => shown.filter((e) => !e.allDay && e.ms > now - 60000).reduce((a, e) => Math.min(a, e.ms), Infinity), [shown, now]);
  const nextHigh = useMemo(() => events.filter((e) => e.impact === 'high' && !e.allDay && e.ms > now - 60000 && (!ccys.length || ccys.includes(e.ccy))).sort((a, b) => a.ms - b.ms)[0], [events, now, ccys]);
  // weeks in view that ForexFactory hasn't published yet (only the official US dates are known)
  const uncovered = useMemo(() => {
    if (view === 'list' || data?.extended) return false;
    const ends = (data?.coverage || []).map(([, b]) => Date.parse(b));
    if (!ends.length) return false;
    const last = view === 'month' ? new Date(+anchor.slice(0, 4), +anchor.slice(5, 7), 0) : parseKey(to);
    return last.getTime() > Math.max(...ends);
  }, [data, view, anchor, to]);

  const toggle = (key, list, v) => setSetting(key, list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const step = (n) => {
    if (view === 'week') setAnchor((a) => addDays(a, 7 * n));
    else { const d = parseKey(anchor); d.setDate(1); d.setMonth(d.getMonth() + n); setAnchor(keyOf(d)); }
  };
  const refresh = async () => { setBusy(true); try { await refreshMacro('calendar'); await reload(true); } finally { setBusy(false); } };
  const clock = new Date(now);

  return (
    <div className="page ec-page">
      <div className="row gap12 wrap" style={{ alignItems: 'flex-end', marginBottom: 14 }}>
        <div className="grow">
          <div className="page-title" style={{ margin: '4px 0 4px' }}>Economic Calendar</div>
          <div className="muted" style={{ fontSize: 13.5 }}>Every release in your time zone, with forecasts and actuals.</div>
        </div>
        <div className="ec-clock no-i18n"><b>{fmtTime12(wallClock(clock))}</b> <span className="muted">{tzLabel()}</span></div>
      </div>

      {nextHigh && today >= from && today <= to && (
        <button className="ec-next card" onClick={() => setOpen(nextHigh)}>
          <Impact id="high" />
          <span className="muted">Next high-impact</span>
          <Ccy c={nextHigh.ccy} />
          <b className="truncate">{nextHigh.title}</b>
          <span className="muted">{nextHigh.day === today ? 'Today' : dayTitle(nextHigh.day).split(',')[0]} {fmtTime12(nextHigh.clock)}</span>
          <span className="ec-cd">{countdown(nextHigh.ms - now)}</span>
        </button>
      )}

      <div className="toolbar ec-toolbar">
        <Seg value={view} onChange={(v) => { setSetting('ecView', v); setAnchor(today); }} options={VIEWS} />
        {view === 'list' ? <Seg value={range} onChange={setRange} options={RANGES} /> : (
          <div className="row gap6">
            <button className="icon-btn" onClick={() => step(-1)} title="Previous"><ChevronLeft size={17} /></button>
            <span className="ec-range-label">{label}</span>
            <button className="icon-btn" onClick={() => step(1)} title="Next"><ChevronRight size={17} /></button>
            <button className="btn sm" onClick={() => setAnchor(today)}>Today</button>
          </div>
        )}
        <div className="grow" />
        <label className="ec-search"><Search size={15} /><input className="input" placeholder="Search events" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <button className="icon-btn" onClick={refresh} title={data?.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleString()}` : 'Refresh'} disabled={busy}><RefreshCw size={16} className={busy || data?.refreshing ? 'spin' : ''} /></button>
      </div>

      <div className="row gap16 wrap ec-filters">
        <div className="row gap6 wrap">
          <span className="muted ec-flabel">Impact</span>
          {IMPACTS.filter((i) => i.id !== 'none').map((i) => (
            <button key={i.id} className={`chip ${impacts.includes(i.id) ? 'on' : ''}`} onClick={() => toggle('ecImpactsV2', impacts, i.id)}><Impact id={i.id} title="" />{i.label}</button>
          ))}
        </div>
        <div className="row gap6 wrap">
          <span className="muted ec-flabel">Currency</span>
          <button className={`chip ${!ccys.length ? 'on' : ''}`} onClick={() => setSetting('ecCcys', [])}>All</button>
          {CURRENCIES.map((c) => <button key={c} className={`chip ${ccys.includes(c) ? 'on' : ''}`} onClick={() => toggle('ecCcys', ccys, c)}>{FLAGS[c]} {c}</button>)}
        </div>
      </div>

      {(error || data?.error) && (
        <div className="ec-warn"><TriangleAlert size={15} /> {error || data.error}{data?.updatedAt ? ` Showing what was saved ${new Date(data.updatedAt).toLocaleString()}.` : ''}</div>
      )}
      {uncovered && view !== 'list' && <div className="ec-note"><CalendarDays size={15} /> ForexFactory publishes one week ahead, so later weeks show only the main US releases from the official calendars (Fed, BLS). The full list fills in as each week is published.</div>}

      {loading && !data ? <div className="ec-empty">Loading the calendar…</div> : (
        <div className="card ec-card">
          {view === 'list' && <DayList days={days} byDay={byDay} nextMs={nextMs} now={now} onOpen={setOpen} emptyNote={events.length ? 'No events match these filters.' : 'No events for these days yet.'} />}
          {view === 'week' && <WeekGrid start={from} byDay={byDay} now={now} onOpen={setOpen} />}
          {view === 'month' && <MonthGrid month={anchor.slice(0, 7)} byDay={byDay} onDay={setDayOpen} />}
        </div>
      )}
      <div className="muted ec-source row gap8 wrap">
        <span>Times in {homeTimeZone().replace(/_/g, ' ')} ({tzLabel()}). Data: {data?.source || 'ForexFactory · Federal Reserve · BLS'}. Not financial advice.</span>
        <label className="row gap6 ec-tvtoggle" title="ForexFactory’s free feed has no actual figures. TradingView’s public calendar feed fills them in, plus the weeks ForexFactory hasn’t published yet.">
          <Switch on={useTv} onChange={(v) => setSetting('ecTradingView', v)} /> Actuals from TradingView
        </label>
      </div>

      <EventModal e={open} onClose={() => setOpen(null)} />
      {dayOpen && (
        <Modal open onClose={() => setDayOpen(null)} width={760}>
          <ModalHead title={dayTitle(dayOpen)} sub={`${byDay[dayOpen]?.length || 0} events · ${tzLabel()}`} onClose={() => setDayOpen(null)} />
          <div className="modal-body" style={{ padding: 0 }}>
            <DayList days={[dayOpen]} byDay={byDay} nextMs={nextMs} now={now} onOpen={(e) => { setDayOpen(null); setOpen(e); }} emptyNote="No events." />
          </div>
        </Modal>
      )}
    </div>
  );
}

