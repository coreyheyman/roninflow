// Top-bar heads-up for today: the next high-impact release (with a countdown) or a market holiday.
// Small and out of the way; click for today's list, or hide it until tomorrow.
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { useStore } from '../store/store';
import { Popover } from './ui';
import { useMacro, countdown, FLAGS, surprise } from '../lib/macro';
import { wallClock, fmtTime12 } from '../lib/stats';

const DISMISS = 'rf-news-hidden';
const readHidden = () => { try { return localStorage.getItem(DISMISS); } catch { return null; } };
const HOL = { closed: 'markets closed', early: 'early close', bank: 'banks closed' };

export default function MacroPill() {
  const { state } = useStore();
  const s = state.settings;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const today = wallClock(new Date(now)).slice(0, 10);
  const [hidden, setHidden] = useState(readHidden);
  const off = s.newsPill === false || hidden === today;
  const { data } = useMacro(off ? null : `/api/macro/calendar?from=${today}&to=${today}${s.ecTradingView === false ? '&tv=0' : ''}`, { poll: 5 * 60e3 });

  const ccys = s.ecCcys || [];
  const { majors, holidays } = useMemo(() => {
    const list = (data?.events || []).map((e) => ({ ...e, ms: Date.parse(e.t), clock: wallClock(e.t) }))
      .filter((e) => (!ccys.length || ccys.includes(e.ccy)) && (e.allDay ? e.t.slice(0, 10) : e.clock.slice(0, 10)) === today);
    return {
      majors: list.filter((e) => e.impact === 'high' && !e.allDay).sort((a, b) => a.ms - b.ms),
      // closures first, US first
      holidays: list.filter((e) => e.holiday).sort((a, b) => (a.holiday === 'bank') - (b.holiday === 'bank') || (b.ccy === 'USD') - (a.ccy === 'USD')),
    };
  }, [data, ccys, today]);

  if (off || (!majors.length && !holidays.length)) return null;
  const next = majors.find((e) => e.ms > now - 2 * 60e3);
  // every release at the same minute as the next one ("CPI m/m +2")
  const batch = next ? majors.filter((e) => e.ms === next.ms) : [];
  const soon = next && next.ms - now < 15 * 60e3;
  const hol = holidays[0];
  if (!next && !hol) return null; // today's big releases are done and it isn't a holiday

  const hide = () => { try { localStorage.setItem(DISMISS, today); } catch { /* private window */ } setHidden(today); };
  const label = next
    ? <><b className="truncate">{next.ccy} {next.title}</b>{batch.length > 1 && <span className="muted"> +{batch.length - 1}</span>}<span className="mp-when">{next.ms <= now ? 'now' : soon ? countdown(next.ms - now) : fmtTime12(next.clock)}</span></>
    : <b className="truncate">{hol.short} — {HOL[hol.holiday]}</b>;

  return (
    <Popover align="right" width={360} trigger={({ toggle }) => (
      <button className={`btn sm ghost macro-pill ${soon ? 'soon' : ''} ${!next ? 'hol' : ''}`} onClick={toggle} title="Today’s market events">
        <i className={`mp-dot ${next ? 'high' : hol.holiday}`} />
        <span className="mp-lbl row gap6">{label}</span>
        {next && hol && <span className="mp-holmark" title={`${hol.short} — ${HOL[hol.holiday]}`}>{FLAGS[hol.ccy]}</span>}
      </button>
    )}>
      {(close) => (
        <div className="mp-pop">
          <div className="mp-head"><span>Today</span><button className="icon-btn" title="Hide until tomorrow" onClick={() => { close(); hide(); }}><X size={14} /></button></div>
          {holidays.map((h) => (
            <div key={h.id} className="mp-row"><span className={`ec-hol ${h.holiday}`}>{HOL[h.holiday]}</span><span className="grow">{FLAGS[h.ccy]} {h.short}</span></div>
          ))}
          {majors.map((e) => {
            const sp = surprise(e);
            return (
              <div key={e.id} className={`mp-row ${e.ms < now - 2 * 60e3 ? 'past' : ''}`}>
                <span className="mp-t">{fmtTime12(e.clock)}</span>
                <span className="grow truncate" title={e.title}>{FLAGS[e.ccy]} {e.ccy} {e.title}</span>
                <span className={`mp-v ${sp === 'beat' ? 'pos' : sp === 'miss' ? 'neg' : ''}`}>{e.actual || (e.ms > now ? countdown(e.ms - now).replace('in ', '') : e.forecast ? `f ${e.forecast}` : '')}</span>
              </div>
            );
          })}
          {!majors.length && <div className="mp-row muted">No high-impact releases today.</div>}
          <div className="mp-foot">
            <a href="#/macro/calendar" onClick={close}><CalendarDays size={14} /> Open the calendar</a>
            <span className="muted">{ccys.length ? ccys.join(', ') : 'All currencies'}</span>
          </div>
        </div>
      )}
    </Popover>
  );
}
