// Macro → COT Report: who's long, who's short and who's crowded, from the CFTC's weekly Commitments of Traders.
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Plus, X, Info, TriangleExclamationPoint as TriangleAlert } from 'lucide-react';
import { useStore } from '../store/store';
import { Seg, Modal, ModalHead, Popover, useSize } from '../components/ui';
import { MONTHS } from '../lib/stats';
import { useMacro, refreshMacro, cotStats, cotRead, fmtContracts, LOOKBACKS, COT_GROUPS } from '../lib/macro';
import { IS_DEMO } from '../lib/demoMode';

const fmtDay = (k, year = true) => { if (!k) return '—'; const [y, m, d] = k.split('-').map(Number); return `${MONTHS[m - 1]} ${d}${year ? `, ${y}` : ''}`; };
const weekday = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const Chg = ({ v, pct }) => <span className={v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted'}>{pct ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : fmtContracts(v, true)}</span>;

/** 0–100 meter with the crowded zones marked */
function IndexMeter({ v }) {
  const cls = v >= 90 ? 'hi' : v <= 10 ? 'lo' : '';
  return (
    <span className={`cot-meter ${cls}`} title={`COT index ${Math.round(v)} — where today's net position sits in its range`}>
      <span className="cot-meter-bar"><i style={{ left: `${Math.max(0, Math.min(100, v))}%` }} /></span>
      <b>{Math.round(v)}</b>
    </span>
  );
}

function Spark({ values, w = 96, h = 30 }) {
  if (!values?.length) return null;
  const lo = Math.min(...values, 0), hi = Math.max(...values, 0);
  const y = (v) => h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4);
  const pts = values.map((v, i) => `${((i / (values.length - 1 || 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <svg width={w} height={h} className="cot-spark" aria-hidden="true">
      <line x1="0" x2={w} y1={y(0)} y2={y(0)} className="zero" />
      <polyline points={pts} className={last >= 0 ? 'up' : 'down'} />
    </svg>
  );
}

const SERIES = [
  { key: 'spec', label: 'Large speculators', idx: 2, cls: 's1' },
  { key: 'comm', label: 'Commercials', idx: 4, cls: 's2' },
  { key: 'small', label: 'Small traders', idx: 6, cls: 's3' },
];

/** net positions of the three groups over time, with a hover readout */
function PositionChart({ rows }) {
  const [ref, { w }] = useSize();
  const [hover, setHover] = useState(null);
  const h = 260, padL = 54, padB = 24, padT = 10;
  const data = rows.map((r) => ({ date: r[0], oi: r[1], ...Object.fromEntries(SERIES.map((s) => [s.key, r[s.idx] - r[s.idx + 1]])) }));
  const all = data.flatMap((d) => SERIES.map((s) => d[s.key]));
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const span = hi - lo || 1;
  const W = Math.max(0, w - padL - 8);
  const x = (i) => padL + (i / (data.length - 1 || 1)) * W;
  const y = (v) => padT + (1 - (v - lo) / span) * (h - padT - padB);
  const ticks = [lo, lo + span / 2, hi];
  const months = data.map((d, i) => ({ i, d: d.date })).filter((p, i, arr) => i === 0 || p.d.slice(0, 7) !== arr[i - 1].d.slice(0, 7));
  const every = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor(W / 70))));
  const hv = hover != null ? data[hover] : null;
  return (
    <div ref={ref} className="cot-chart" onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={h} onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.round(((e.clientX - r.left - padL) / W) * (data.length - 1)); setHover(Math.max(0, Math.min(data.length - 1, i))); }}>
          {ticks.map((t) => <g key={t}><line x1={padL} x2={w - 8} y1={y(t)} y2={y(t)} className="grid" /><text x={padL - 8} y={y(t) + 4} textAnchor="end">{fmtContracts(t)}</text></g>)}
          <line x1={padL} x2={w - 8} y1={y(0)} y2={y(0)} className="zero" />
          {months.filter((_, k) => k % every === 0).map((m) => <text key={m.d} x={x(m.i)} y={h - 6} textAnchor="middle">{MONTHS[+m.d.slice(5, 7) - 1]}{m.d.slice(5, 7) === '01' || m.i === 0 ? ` ’${m.d.slice(2, 4)}` : ''}</text>)}
          {SERIES.map((s) => <polyline key={s.key} className={`line ${s.cls}`} points={data.map((d, i) => `${x(i).toFixed(1)},${y(d[s.key]).toFixed(1)}`).join(' ')} />)}
          {hv && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={h - padB} className="cursor" />}
          {hv && SERIES.map((s) => <circle key={s.key} cx={x(hover)} cy={y(hv[s.key])} r="3.5" className={`dot ${s.cls}`} />)}
        </svg>
      )}
      <div className="cot-legend">
        {hv ? <b className="no-i18n">{fmtDay(hv.date)}</b> : <span className="muted">Net positions (long − short), in contracts</span>}
        {SERIES.map((s) => <span key={s.key}><i className={s.cls} />{s.label}{hv && <b> {fmtContracts(hv[s.key], true)}</b>}</span>)}
      </div>
    </div>
  );
}

function MarketModal({ m, weeks, onClose }) {
  if (!m) return null;
  const st = cotStats(m.rows, weeks);
  const recent = m.rows.slice(-8).reverse();
  return (
    <Modal open onClose={onClose} width={920}>
      <ModalHead title={<span><span className="cot-key">{m.key}</span> {m.label}</span>} sub={`${m.name} · CFTC code ${m.code}`} onClose={onClose} />
      <div className="modal-body col gap16">
        <div className="cot-tiles">
          <div><span className="muted">Large specs net</span><b>{fmtContracts(st.spec, true)}</b><Chg v={st.specChg} /></div>
          <div><span className="muted">COT index ({LOOKBACKS.find((l) => l.value === weeks)?.label})</span><b>{Math.round(st.index)}</b><span className={st.crowd ? (st.crowd === 'long' ? 'pos' : 'neg') : 'muted'}>{st.crowd ? `Crowded ${st.crowd}` : 'Not stretched'}</span></div>
          <div><span className="muted">Specs long / short</span><b>{st.pctLong.toFixed(0)}% long</b><span className="muted">{fmtContracts(st.specLong)} / {fmtContracts(st.specShort)}</span></div>
          <div><span className="muted">Commercials net</span><b>{fmtContracts(st.comm, true)}</b><Chg v={st.commChg} /></div>
          <div><span className="muted">Small traders net</span><b>{fmtContracts(st.small, true)}</b><Chg v={st.smallChg} /></div>
          <div><span className="muted">Open interest</span><b>{fmtContracts(st.oi)}</b><Chg v={st.oiChg} /></div>
        </div>
        <div className="cot-read">Large speculators last week: {cotRead(st).toLowerCase()}{st.extreme ? ` · net position at its ${st.extreme === 'high' ? 'highest' : 'lowest'} in ${LOOKBACKS.find((l) => l.value === weeks)?.label}` : ''}.</div>
        <PositionChart rows={m.rows.slice(-weeks)} />
        <div className="tbl-wrap">
          <table className="tbl cot-weeks">
            <thead><tr><th>Week of</th><th className="r">Specs long</th><th className="r">Specs short</th><th className="r">Specs net</th><th className="r">Change</th><th className="r">Commercials net</th><th className="r">Open interest</th></tr></thead>
            <tbody>
              {recent.map((r, i) => {
                const p = m.rows[m.rows.length - 2 - i];
                return (
                  <tr key={r[0]}>
                    <td>{fmtDay(r[0])}</td><td className="r">{fmtContracts(r[2])}</td><td className="r">{fmtContracts(r[3])}</td>
                    <td className="r">{fmtContracts(r[2] - r[3], true)}</td><td className="r">{p ? <Chg v={(r[2] - r[3]) - (p[2] - p[3])} /> : '—'}</td>
                    <td className="r">{fmtContracts(r[4] - r[5], true)}</td><td className="r">{fmtContracts(r[1])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

function AddMarket({ have, onAdd }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState(null);
  const load = () => {
    if (list || IS_DEMO) return;
    fetch('/api/macro/cot/markets').then((r) => r.json()).then((j) => (j.markets ? setList(j.markets) : setErr(j.error || 'Couldn’t load the list'))).catch((e) => setErr(e.message));
  };
  const needle = q.trim().toLowerCase();
  const found = (list || []).filter((m) => !have.has(m.code) && (!needle || m.name.toLowerCase().includes(needle) || m.code.toLowerCase() === needle)).slice(0, 60);
  return (
    <Popover align="right" width={380} trigger={({ toggle }) => <button className="btn sm" onClick={() => { load(); toggle(); }}><Plus size={14} /> Add market</button>}>
      {(close) => (
        <div className="cot-add">
          {IS_DEMO ? <div className="muted" style={{ padding: 10, fontSize: 13 }}>In RoninFlow on your computer you can add any of the ~400 markets in the CFTC report.</div> : (
            <>
              <label className="ec-search" style={{ margin: 6 }}><Search size={15} /><input className="input" autoFocus placeholder="Search all CFTC markets" value={q} onChange={(e) => setQ(e.target.value)} /></label>
              <div className="cot-add-list">
                {err && <div className="neg" style={{ padding: 10, fontSize: 13 }}>{err}</div>}
                {!list && !err && <div className="muted" style={{ padding: 10 }}>Loading…</div>}
                {found.map((m) => <button key={m.code} className="pop-item" onClick={() => { onAdd(m.code); close(); }}><span className="grow truncate" title={m.name}>{m.name}</span><span className="muted mono">{m.code}</span></button>)}
                {list && !found.length && <div className="muted" style={{ padding: 10, fontSize: 13 }}>No match.</div>}
              </div>
            </>
          )}
        </div>
      )}
    </Popover>
  );
}

export default function Cot() {
  const { state, setSetting } = useStore();
  const s = state.settings;
  const weeks = s.cotWeeks || 156;
  const extra = s.cotExtra || [];
  const [group, setGroup] = useState('All');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [sort, setSort] = useState({ k: null, dir: -1 });
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const { data, error, loading, reload } = useMacro(`/api/macro/cot${extra.length ? `?extra=${extra.join(',')}` : ''}`);

  const rows = useMemo(() => (data?.markets || []).map((m) => ({ ...m, st: cotStats(m.rows, weeks) })).filter((m) => m.st), [data, weeks]);
  const groups = useMemo(() => COT_GROUPS.filter((g) => rows.some((r) => r.group === g)), [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows.filter((r) => (group === 'All' || r.group === group) && (!needle || `${r.key} ${r.label} ${r.name}`.toLowerCase().includes(needle)));
    if (sort.k) list = [...list].sort((a, b) => (a.st[sort.k] - b.st[sort.k]) * sort.dir);
    return list;
  }, [rows, group, q, sort]);
  const crowdedLong = useMemo(() => [...rows].sort((a, b) => b.st.index - a.st.index)[0], [rows]);
  const crowdedShort = useMemo(() => [...rows].sort((a, b) => a.st.index - b.st.index)[0], [rows]);
  const mover = useMemo(() => [...rows].sort((a, b) => Math.abs(b.st.specChg / (b.st.oi || 1)) - Math.abs(a.st.specChg / (a.st.oi || 1)))[0], [rows]);
  const opened = open && rows.find((r) => r.code === open);
  const lb = LOOKBACKS.find((l) => l.value === weeks)?.label;

  const th = (k, label, title) => (
    <th className="r" title={title}><span className="th" onClick={() => setSort((x) => ({ k, dir: x.k === k ? -x.dir : -1 }))}>{label}{sort.k === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</span></th>
  );
  const refresh = async () => { setBusy(true); try { await refreshMacro('cot'); await reload(true); } finally { setBusy(false); } };
  const Pick = ({ r, label, v }) => r ? (
    <button className="card cot-pick" onClick={() => setOpen(r.code)}>
      <span className="muted">{label}</span>
      <span className="row gap8"><span className="cot-key">{r.key}</span><b className="truncate">{r.label}</b></span>
      <span>{v(r)}</span>
    </button>
  ) : null;

  useEffect(() => { if (group !== 'All' && rows.length && !groups.includes(group)) setGroup('All'); }, [groups, group, rows.length]);

  return (
    <div className="page cot-page">
      <div className="row gap12 wrap" style={{ alignItems: 'flex-end', marginBottom: 16 }}>
        <div className="grow">
          <div className="page-title" style={{ margin: '4px 0 4px' }}>COT Report</div>
          <div className="muted" style={{ fontSize: 13.5 }}>
            Who’s long, who’s short, and who’s crowded in futures.
            {data?.reportDate && <> Positions as of <b className="no-i18n">{fmtDay(data.reportDate)}</b>{data.nextRelease && <> · next report <span className="no-i18n">{weekday(data.nextRelease)}</span></>}.</>}
          </div>
        </div>
        <button className="btn sm" onClick={() => setHelp((x) => !x)}><Info size={14} /> How to read it</button>
      </div>

      {help && (
        <div className="card card-pad cot-help">
          <p><b>Large speculators</b> (the CFTC’s “non-commercials”) are funds and CTAs trading for profit, mostly following trends. <b>Commercials</b> are producers and users hedging their business, so they usually sit on the other side. <b>Small traders</b> are positions too small to report individually.</p>
          <p><b>COT index</b> shows where the speculators’ net position sits within its range over the period you pick: 100 = the most long it has been, 0 = the most short. At 90 or above the market is <b className="pos">crowded long</b>, at 10 or below <b className="neg">crowded short</b>. Crowded positioning can unwind sharply, but it can also stay stretched for weeks, so treat it as context rather than a signal.</p>
          <p className="muted">The CFTC publishes positions as of Tuesday every Friday at 3:30 PM ET (later after US holidays). Legacy report, futures only.</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="cot-picks">
          <Pick r={crowdedLong} label="Most crowded long" v={(r) => <><IndexMeter v={r.st.index} /> <span className="muted">COT index ({lb})</span></>} />
          <Pick r={crowdedShort} label="Most crowded short" v={(r) => <><IndexMeter v={r.st.index} /> <span className="muted">COT index ({lb})</span></>} />
          <Pick r={mover} label="Biggest weekly shift" v={(r) => <><Chg v={r.st.specChg} /> <span className="muted">{cotRead(r.st)}</span></>} />
        </div>
      )}

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <div className="row gap6 wrap">
          {['All', ...groups].map((g) => <button key={g} className={`chip ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>{g}</button>)}
        </div>
        <div className="grow" />
        <span className="muted" style={{ fontSize: 13 }}>Index over</span>
        <Seg value={weeks} onChange={(v) => setSetting('cotWeeks', v)} options={LOOKBACKS} />
        <label className="ec-search"><Search size={15} /><input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <AddMarket have={new Set(rows.map((r) => r.code))} onAdd={(c) => setSetting('cotExtra', [...extra.filter((x) => x !== c), c])} />
        <button className="icon-btn" onClick={refresh} disabled={busy} title={data?.updatedAt ? `Checked ${new Date(data.updatedAt).toLocaleString()}` : 'Refresh'}><RefreshCw size={16} className={busy || data?.refreshing ? 'spin' : ''} /></button>
      </div>

      {(error || data?.error) && <div className="ec-warn"><TriangleAlert size={15} /> {error || data.error}{rows.length ? ' Showing the last report saved.' : ''}</div>}

      {loading && !data ? <div className="ec-empty">Loading three years of COT data from the CFTC… (the first time takes a few seconds)</div> : !rows.length ? (
        <div className="ec-empty">No COT data yet.{!error && !data?.error && ' Try refreshing in a minute.'}</div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl cot-tbl">
            <thead>
              <tr>
                <th>Market</th>
                {th('spec', 'Specs net', 'Large speculators: long minus short contracts')}
                {th('specChg', '1W change', 'Change in the net position since the week before')}
                {th('pctLong', '% long', 'Share of speculators’ positions that are long')}
                {th('index', `COT index`, `0 = most short, 100 = most long over ${lb}`)}
                {th('comm', 'Commercials', 'Commercials (hedgers): net position, long minus short contracts')}
                {th('oi', 'Open interest')}
                <th>Specs net, {lb}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.code} onClick={() => setOpen(r.code)}>
                  <td>
                    <div className="row gap8">
                      <span className="cot-key">{r.key}</span>
                      <div className="col" style={{ minWidth: 0 }}>
                        <span className="truncate">{r.label}</span>
                        <span className="muted cot-sub">{r.st.crowd && <><span className={r.st.crowd === 'long' ? 'pos' : 'neg'}>Crowded {r.st.crowd}</span> · </>}{cotRead(r.st)}</span>
                      </div>
                      {r.extra && <button className="icon-btn cot-rm" title="Remove" onClick={(e) => { e.stopPropagation(); setSetting('cotExtra', extra.filter((c) => c !== r.code)); }}><X size={14} /></button>}
                    </div>
                  </td>
                  <td className="r"><span className={r.st.spec >= 0 ? 'pos' : 'neg'}>{fmtContracts(r.st.spec, true)}</span></td>
                  <td className="r"><Chg v={r.st.specChg} /></td>
                  <td className="r"><span className="cot-ls" title={`${r.st.pctLong.toFixed(0)}% long`}><i style={{ width: `${r.st.pctLong}%` }} /></span> {r.st.pctLong.toFixed(0)}%</td>
                  <td className="r"><IndexMeter v={r.st.index} /></td>
                  <td className="r">{fmtContracts(r.st.comm, true)}</td>
                  <td className="r">{fmtContracts(r.st.oi)} <span className="cot-oichg"><Chg v={r.st.oi ? (r.st.oiChg / (r.st.oi - r.st.oiChg || 1)) * 100 : 0} pct /></span></td>
                  <td><Spark values={r.st.trend} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted ec-source">Source: {data?.source || 'CFTC Commitments of Traders'} (public domain). Not financial advice.</div>
      <MarketModal m={opened} weeks={weeks} onClose={() => setOpen(null)} />
    </div>
  );
}
