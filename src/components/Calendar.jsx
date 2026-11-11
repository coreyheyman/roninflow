import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, ChevronRight as Chev } from 'lucide-react';
import { useStore } from '../store/store';
import { ScoreBox } from './ui';
import { MONTHS_LONG, keyOf, fmtMoney, fmtCompact, fmtDuration, startOfCalWeek, toDate } from '../lib/stats';

/** Month calendar with daily P&L cells and weekly summary column. days: groupByDay() output */
export function PnlCalendar({ days, onDay, initial, compact = false }) {
  const { state } = useStore();
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
      <div className="cal">
        <div className="cal-head">
          {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Week'].map((d) => <div key={d}>{compact ? (d === 'Week' ? 'Wk' : d.slice(0, 3)) : d}</div>)}
        </div>
        {weeks.map((wk, wi) => {
          const wd = wk.map((d) => map[keyOf(d)]).filter(Boolean);
          const wNet = wd.reduce((s, d) => s + d.net, 0);
          const wTrades = wd.reduce((s, d) => s + d.count, 0);
          const wWins = wd.reduce((s, d) => s + d.wins, 0);
          return (
            <div className="cal-week" key={wi}>
              {wk.map((d) => {
                const k = keyOf(d);
                const day = map[k];
                const out = d.getMonth() !== m;
                return (
                  <div
                    key={k}
                    className={`cal-cell ${out ? 'out' : ''} ${day ? (day.net >= 0 ? 'win' : 'loss') : ''}`}
                    style={compact ? { minHeight: 96, padding: 8 } : undefined}
                    onClick={() => !out && onDay?.(k)}
                  >
                    <span className="d">{k === today ? <span className="today">{d.getDate()}</span> : d.getDate()}</span>
                    {day && (
                      <>
                        {!compact && <span className="sc"><ScoreBox v={day.score} /></span>}
                        <div className={`pnl ${day.net >= 0 ? 'pos' : 'neg'}`} style={compact ? { fontSize: 14 } : undefined}>
                          <span className={`pv-full ${priv ? 'hidden-val' : ''}`}>{fmtMoney(day.net, { sign: true })}</span><span className={`pv-short ${priv ? 'hidden-val' : ''}`}>{day.net > 0 ? '+' : ''}{fmtCompact(day.net)}</span>
                        </div>
                        <div className="meta">
                          <Clock size={12} />
                          {compact ? `${day.count} trades` : fmtDuration(day.duration)}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
              <div className={`cal-wk ${wd.length ? (wNet >= 0 ? 'win' : 'loss') : ''}`}>
                <div className="row between">W{wi + 1} {wd.length > 0 && !compact && <Chev size={13} className="muted" />}</div>
                {wd.length > 0 && (
                  <>
                    <div className={`wk-pnl ${wNet >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: compact ? 13 : 16, fontWeight: 500, marginTop: 'auto', marginBottom: 6, filter: priv ? 'blur(6px)' : undefined }}>
                      <span className="pv-full">{fmtMoney(wNet, { sign: true })}</span><span className="pv-short">{wNet > 0 ? "+" : ""}{fmtCompact(wNet)}</span>
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
