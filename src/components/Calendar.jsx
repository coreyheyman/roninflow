import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, ChevronRight as Chev } from 'lucide-react';
import { useStore } from '../store/store';
import { Fit, ScoreBox } from './ui';
import { MONTHS_LONG, keyOf, fmtMoney, fmtCompact, fmtDuration, startOfCalWeek, toDate } from '../lib/stats';
import { periodOf } from '../lib/reviews';
import { useOpenReview } from '../lib/dayPopup';

/** Month calendar with daily P&L cells and weekly summary column. days: groupByDay() output */
export function PnlCalendar({ days, onDay, initial, compact = false }) {
  const { state } = useStore();
  const openReview = useOpenReview();
  const priv = state.settings.privacy;
  const latest = days[0]?.date;
  const [anchor, setAnchor] = useState(() => (initial ? toDate(initial) : latest ? toDate(latest) : new Date()));
  const map = useMemo(() => Object.fromEntries(days.map((d) => [d.date, d])), [days]);
  const y = anchor.getFullYear(), m = anchor.getMonth();
  const start = startOfCalWeek(new Date(y, m, 1));
  const weeks = [];
  const cur = new Date(start);
  while (weeks.length < 6) {
    const wk = [];
    for (let i = 0; i < 7; i++) { wk.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
    weeks.push(wk);
    if (cur.getMonth() !== m && cur > new Date(y, m + 1, 0)) break;
  }
  const today = keyOf(new Date());
  const monthDays = days.filter((d) => d.date.startsWith(`${y}-${String(m + 1).padStart(2, '0')}`));
  const monthNet = monthDays.reduce((s, d) => s + d.net, 0);
  const money = (v) => (priv ? '•••••' : fmtMoney(v, { sign: true }));
  // on a phone the calendar drops Saturday and Sunday when no trades fall on a weekend this month
  const wkndMode = state.settings.calWeekends || 'auto'; // auto · show · hide
  const isWknd = (d) => d.getDay() === 0 || d.getDay() === 6;
  const noWknd = wkndMode === 'auto' && !weeks.flat().some((d) => isWknd(d) && d.getMonth() === m && map[keyOf(d)]);
  const hideWknd = wkndMode === 'hide';
  const shown = (list) => (hideWknd ? list.filter((d) => !isWknd(d)) : list);
  return (
    <div className="cal-box">
      <div className="row gap16 cal-top" style={{ marginBottom: 20 }}>
        <button className="btn sm" style={{ width: 32, padding: 0 }} onClick={() => setAnchor(new Date(y, m - 1, 1))}><ChevronLeft size={15} /></button>
        <div style={{ fontSize: 18, fontWeight: 500, minWidth: 150, textAlign: 'center' }}>{MONTHS_LONG[m]} {y}</div>
        <button className="btn sm" style={{ width: 32, padding: 0 }} onClick={() => setAnchor(new Date(y, m + 1, 1))}><ChevronRight size={15} /></button>
        <button className="btn xs" onClick={() => setAnchor(new Date())}>Today</button>
        <div className="grow" />
        {monthDays.length > 0 && (
          <div className="row gap12" style={{ fontSize: 13 }}>
            <span className="muted">Monthly P&L</span>
            <b className={monthNet >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 600 }}>{money(monthNet)}</b>
            <span className="muted">{monthDays.length} days</span>
          </div>
        )}
      </div>
      <div className={`cal ${noWknd ? 'no-wknd' : ''} ${hideWknd ? 'weekdays' : ''}`} style={{ '--days': hideWknd ? 5 : 7 }}>
        <div className="cal-head">
          {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Week'].filter((d) => !hideWknd || !/^S(at|un)/.test(d)).map((d) => <div key={d}><span className="wd-full">{compact ? (d === 'Week' ? 'Wk' : d.slice(0, 3)) : d}</span><span className="wd-abbr">{d.slice(0, 3)}</span></div>)}
        </div>
        {weeks.map((wk, wi) => {
          const wd = wk.map((d) => map[keyOf(d)]).filter(Boolean);
          const wNet = wd.reduce((s, d) => s + d.net, 0);
          const wTrades = wd.reduce((s, d) => s + d.count, 0);
          const wWins = wd.reduce((s, d) => s + d.wins, 0);
          return (
            <div className="cal-week" key={wi}>
              {shown(wk).map((d) => {
                const k = keyOf(d);
                const day = map[k];
                const out = d.getMonth() !== m;
                return (
                  <div
                    key={k}
                    className={`cal-cell ${out ? 'out' : ''} ${k === today ? 'today' : ''} ${day ? (day.net >= 0 ? 'win' : 'loss') : ''}`}
                    onClick={() => !out && onDay?.(k)}
                  >
                    <span className="d">{d.getDate()}</span>
                    {day && (
                      <>
                        {!compact && <span className="sc"><ScoreBox v={day.score} ctx={day} /></span>}
                        <div className={`pnl ${day.net >= 0 ? 'pos' : 'neg'}`}>
                          <Fit className={priv ? 'hidden-val' : ''} short={`${day.net > 0 ? '+' : ''}${fmtCompact(day.net)}`}>{fmtMoney(day.net, { sign: true })}</Fit>
                          <span className={`phone-v ${priv ? 'hidden-val' : ''}`}>{`${day.net > 0 ? '+' : ''}${fmtCompact(day.net)}`}</span>
                        </div>
                        <div className="ct">{day.count} trade{day.count === 1 ? '' : 's'}</div>
                        <div className="meta">
                          <Clock size={12} />
                          {compact ? `${day.count} trade${day.count === 1 ? '' : 's'}` : fmtDuration(day.duration)}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
              <div className={`cal-wk wk-link ${wd.length ? (wNet >= 0 ? 'win' : 'loss') : ''}`} title="Open this week’s review" onClick={() => openReview(periodOf('weekly', wk[1]))}>
                <div className="row between">W{wi + 1} {wd.length > 0 && !compact && <Chev size={13} className="muted" />}</div>
                {wd.length > 0 && (
                  <>
                    <div className={`wk-pnl ${wNet >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 16, fontWeight: 500, marginTop: 'auto', marginBottom: 6, filter: priv ? 'blur(6px)' : undefined }}>
                      <Fit short={`${wNet > 0 ? '+' : ''}${fmtCompact(wNet)}`}>{fmtMoney(wNet, { sign: true })}</Fit>
                      <span className="phone-v">{fmtMoney(wNet, { sign: true, dp: 0 })}</span>
                    </div>
                    <div className="muted" style={{ fontWeight: 500 }}>{wTrades}t · {Math.round((wWins / wTrades) * 100)}%</div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
