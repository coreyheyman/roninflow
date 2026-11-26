// Macro → Contract Rolls: for each market you trade, the contract to be in today, when volume moves to the next one,
// and when the old one stops trading — with a warning if your recent trades are still on a contract that has rolled.
import { useMemo, useState } from 'react';
import { Plus, X, ArrowRight, CircleCheck, TriangleExclamationPoint as TriangleAlert, CalendarClock } from 'lucide-react';
import MacroSwitch from '../components/MacroSwitch';
import { Popover } from '../components/ui';
import { SeriesHead } from './MacroSeries';
import { useStore } from '../store/store';
import { PRODUCTS, RULE_TEXT, rollStatus, rollAdvice, rootOf, parseSymbol, contracts } from '../../rolls.js';
import { useMacro } from '../lib/macro';

const GROUPS = [
  ['Stock indices', ['ES', 'MES', 'NQ', 'MNQ', 'RTY', 'M2K', 'YM', 'MYM', 'EMD', 'NKD']],
  ['Energy', ['CL', 'MCL', 'QM', 'NG', 'QG']],
  ['Metals', ['GC', 'MGC', 'SI', 'SIL', 'HG', 'MHG', 'PL']],
  ['Treasuries', ['ZT', 'ZF', 'ZN', 'TN', 'ZB', 'UB']],
  ['Currencies', ['6E', 'M6E', '6J', '6B', 'M6B', '6A', 'M6A', '6C', '6S', '6N']],
  ['Grains', ['ZC', 'ZS', 'ZW']],
  ['Crypto', ['BTC', 'MBT', 'ETH', 'MET']],
];
const DAY = 86400000;
export const fmtDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const inDays = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`);

/** where the volume is for these markets (refreshed every 20 minutes) */
export function useRollVolumes(roots) {
  const { data } = useMacro(roots.length ? `/api/macro/rolls/volume?roots=${roots.join(',')}` : null, { poll: 20 * 60e3 });
  return data?.volumes || {};
}
const fmtVol = (v) => (v == null ? '—' : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : v.toLocaleString('en-US'));

/** the expiring contract's volume against the next one's, as two bars */
function VolumeSplit({ vol }) {
  if (!vol || vol.error || vol.a?.last == null) return <div className="roll-vol muted">{vol?.error ? 'Volume unavailable right now — going by the calendar.' : 'Loading volume…'}</div>;
  const max = Math.max(vol.a.last, vol.b.last || 0, 1);
  const row = (c, lead) => (
    <div className={`roll-vol-row ${lead ? 'lead' : ''}`}>
      <b className="no-i18n">{c.symbol}</b>
      <span className="roll-vol-bar"><i style={{ width: `${((c.last || 0) / max) * 100}%` }} /></span>
      <span className="roll-vol-n">{fmtVol(c.last)}</span>
    </div>
  );
  return (
    <div className="roll-vol">
      <div className="roll-vol-head"><span>Volume, last session{vol.day ? ` (${fmtDate(vol.day)})` : ''}</span><span className={vol.leader === 'next' ? 'pos' : 'muted'}>{vol.b.symbol} {Math.round((vol.share || 0) * 100)}%</span></div>
      {row(vol.a, vol.leader === 'current')}
      {row(vol.b, vol.leader === 'next')}
      {(vol.a.today != null || vol.b.today != null) && <div className="roll-vol-today muted">This session so far: {vol.a.symbol} {fmtVol(vol.a.today)} · {vol.b.symbol} {fmtVol(vol.b.today)}</div>}
    </div>
  );
}

/** the markets you trade, from your journal: root → { count, last symbol held, when } */
export function tradedMarkets(trades, days = 120) {
  const since = Date.now() - days * DAY;
  const out = {};
  for (const t of trades || []) {
    const at = Date.parse(t.entry || t.exit || '');
    if (!at || at < since) continue;
    const root = rootOf(t.symbol);
    if (!root) continue;
    const m = (out[root] ||= { count: 0, last: null, lastAt: 0 });
    m.count += 1;
    if (at > m.lastAt && parseSymbol(t.symbol)) { m.last = String(t.symbol).toUpperCase(); m.lastAt = at; }
  }
  return out;
}

function Status({ st }) {
  const map = {
    hold: ['ok', 'No roll yet'], early: ['ok', 'Already on the next one'], soon: ['warn', `Roll ${inDays(st.daysToRoll)}`],
    roll: ['bad', 'Switch now'], expired: ['bad', 'Expired — switch'], rolled: ['warn', 'Just rolled'],
  };
  const [cls, text] = map[st.phase] || map.hold;
  return <span className={`cr-status ${cls}`}>{cls === 'ok' ? <CircleCheck size={13} /> : <TriangleAlert size={13} />}{text}</span>;
}

/** from the last roll to the next one, with today, the roll and the last trading day marked */
function Timeline({ st }) {
  const a = Date.parse(st.prev?.roll || st.today) - (st.prev ? 0 : 30 * DAY), b = Date.parse(st.front.last) + 3 * DAY;
  const at = (d) => `${Math.max(0, Math.min(100, ((Date.parse(d) - a) / (b - a)) * 100))}%`;
  return (
    <div className="roll-line">
      <div className="roll-track"><i style={{ width: at(st.today) }} /></div>
      {st.prev && <span className="roll-mark past" style={{ left: at(st.prev.roll) }} title={`Last roll ${fmtDate(st.prev.roll)}`} />}
      <span className="roll-mark roll" style={{ left: at(st.front.roll) }} title={`Roll ${fmtDate(st.front.roll)}`}><b>Roll</b></span>
      <span className="roll-mark last" style={{ left: at(st.front.last) }} title={`${st.front.lastLabel} ${fmtDate(st.front.last)}`}><b>{st.front.lastLabel === 'First notice day' ? 'Notice' : 'Expiry'}</b></span>
      <span className="roll-today" style={{ left: at(st.today) }}><b>Today</b></span>
    </div>
  );
}

function RollCard({ root, traded, onRemove, vol }) {
  const st = rollAdvice(rollStatus(traded?.last || root), vol);
  if (!st) return null;
  const heldOld = st.held && (st.phase === 'roll' || st.phase === 'expired');
  return (
    <div className={`card roll-card ph-${st.phase}`}>
      <div className="roll-head">
        <div><b className="roll-root">{root}</b><span className="muted"> {st.product}</span></div>
        <Status st={st} />
        {onRemove && <button className="icon-btn" onClick={onRemove} title="Stop watching"><X size={14} /></button>}
      </div>
      <div className="roll-now">
        <div><small>Trade today</small><b className="no-i18n">{st.front.symbol}</b><span className="muted">{st.front.label}</span></div>
        <ArrowRight size={18} className="muted" />
        <div><small>Next</small><b className="no-i18n">{st.next.symbol}</b><span className="muted">{st.next.label}</span></div>
      </div>
      {heldOld && (
        <div className="roll-warn bad"><TriangleAlert size={14} /> Your last {root} trade was on <b>{st.held.symbol}</b> — {st.reason === 'volume' ? <><b>{st.switchTo.symbol}</b> now trades more ({Math.round(st.share * 100)}% of the last session’s volume)</> : <>volume moved to <b>{st.switchTo.symbol}</b> on {fmtDate(st.held.roll)}</>}{st.phase === 'expired' ? ` and ${st.held.symbol} has stopped trading` : ''}. Switch your charts, DOM and orders.</div>
      )}
      {st.phase === 'soon' && <div className="roll-warn warn"><CalendarClock size={14} /> Volume moves to <b>{st.next.symbol}</b> on {fmtDate(st.front.roll)} ({inDays(st.daysToRoll)}). Switch your charts and DOM that morning.</div>}
      {st.phase === 'rolled' && <div className="roll-warn warn"><CalendarClock size={14} /> {st.reason === 'volume' ? <><b>{st.switchTo.symbol}</b> now trades more than {st.front.symbol === st.switchTo.symbol ? 'the old contract' : st.front.symbol} — switch your charts and DOM.</> : <>{root} rolled to <b>{st.front.symbol}</b> {inDays(-st.daysSinceRoll)} — make sure your charts and DOM are on it.</>}</div>}
      <VolumeSplit vol={vol} />
      <Timeline st={st} />
      <dl className="roll-facts">
        <div><dt>Roll date</dt><dd>{fmtDate(st.front.roll)} <span className="muted">· {inDays(st.daysToRoll)}</span></dd></div>
        <div><dt>{st.front.lastLabel}</dt><dd>{fmtDate(st.front.last)} <span className="muted">· {inDays(st.daysToLast)}</span></dd></div>
        <div><dt>Your trades</dt><dd>{traded ? <>{traded.count} in 4 months{traded.last ? <> · last on <b className="no-i18n">{traded.last}</b></> : null}</> : <span className="muted">none recently</span>}</dd></div>
      </dl>
      <p className="muted roll-rule">{RULE_TEXT[st.rule]}</p>
    </div>
  );
}

export default function ContractRolls() {
  const { state, setSetting } = useStore();
  const traded = useMemo(() => tradedMarkets(state.trades), [state.trades]);
  const extra = state.settings.rollRoots || [];
  const hidden = state.settings.rollHidden || [];
  const roots = [...new Set([...Object.keys(traded).sort((a, b) => traded[b].count - traded[a].count), ...extra])].filter((r) => PRODUCTS[r] && !hidden.includes(r));
  const shown = roots.length ? roots : ['NQ', 'ES'];
  const vols = useRollVolumes(shown);
  const [q, setQ] = useState('');
  const upcoming = useMemo(() => shown.flatMap((r) => contracts(r, new Date(), 6).map((c, i, arr) => ({ ...c, nextSym: arr[i + 1]?.symbol })))
    .filter((c) => c.nextSym && c.roll >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.roll.localeCompare(b.roll)).slice(0, 16), [shown.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = (r) => { setSetting('rollRoots', [...new Set([...extra, r])]); setSetting('rollHidden', hidden.filter((x) => x !== r)); };
  const remove = (r) => { setSetting('rollRoots', extra.filter((x) => x !== r)); if (traded[r]) setSetting('rollHidden', [...new Set([...hidden, r])]); };
  return (
    <div className="page ms-page rolls-page">
      <SeriesHead title={<MacroSwitch current="rolls" />} desc="Which contract month to trade, and when to switch. You’re told to switch as soon as the next contract trades more than the current one (daily volume, from Yahoo Finance), with the exchange’s calendar roll date as the early warning and the backstop. Markets you’ve traded in the last four months show up on their own; add others below." chips={[['Markets', shown.length], ['Next roll', upcoming[0] ? `${upcoming[0].root} · ${fmtDate(upcoming[0].roll)}` : '—'], ['Calendar', 'CME · US holidays']]}>
        <label className="roll-toggle" title="A one-line reminder across the journal before a market you trade rolls, and if your last trade was on a contract that has rolled">
          <input type="checkbox" checked={state.settings.rollReminders !== false} onChange={(e) => setSetting('rollReminders', e.target.checked)} /> Remind me in the journal
        </label>
        <Popover width={320} portal trigger={({ toggle }) => <button className="btn sm" onClick={toggle}><Plus size={14} /> Add market</button>}>
          {(close) => (
            <div className="cmp-add">
              <input className="input" autoFocus placeholder="Search — NQ, gold, crude…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
              <div className="cmp-add-list">
                {GROUPS.map(([g, list]) => {
                  const items = list.filter((r) => !shown.includes(r) && (!q || r.toLowerCase().includes(q.toLowerCase()) || PRODUCTS[r].name.toLowerCase().includes(q.toLowerCase())));
                  return items.length ? <div key={g}><div className="cmp-add-g">{g}</div>{items.map((r) => <button key={r} className="pop-item" onClick={() => { add(r); close(); setQ(''); }}><b style={{ width: 44 }}>{r}</b><span className="grow">{PRODUCTS[r].name}</span></button>)}</div> : null;
                })}
              </div>
            </div>
          )}
        </Popover>
      </SeriesHead>
      <div className="roll-grid">
        {shown.map((r) => <RollCard key={r} root={r} traded={traded[r]} vol={vols[r]} onRemove={roots.length ? () => remove(r) : null} />)}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="dc-card-head"><div><b>Upcoming rolls</b><p className="muted">The next roll dates for the markets above.</p></div></div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Roll date</th><th>Market</th><th>Switch</th><th className="r">{'Last day / notice'}</th></tr></thead>
            <tbody>
              {upcoming.map((c) => (
                <tr key={`${c.root}-${c.symbol}`}>
                  <td>{fmtDate(c.roll)} <span className="muted">· {inDays(Math.round((Date.parse(c.roll) - Date.parse(new Date().toISOString().slice(0, 10))) / DAY))}</span></td>
                  <td><b>{c.root}</b> <span className="muted">{PRODUCTS[c.root].name}</span></td>
                  <td className="no-i18n">{c.symbol} <ArrowRight size={12} className="muted" /> {c.nextSym}</td>
                  <td className="r muted">{fmtDate(c.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="muted ec-source">Dates follow the exchanges’ contract rules (CME, CBOT, NYMEX, COMEX) and US exchange holidays. Check your broker’s notices for one-off schedule changes.</div>
    </div>
  );
}
