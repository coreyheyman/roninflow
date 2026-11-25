// Macro series pages (Fixed Income & Rates, Monetary Policy, Primary Dealer Stats, Credit & Markets, Economy & Labor,
// Inflation, International): grouped cards with the latest value, its change and a chart over the range you pick;
// click a card for the full chart, its range and to pin it or compare it.
import { useMemo, useState } from 'react';
import { RefreshCw, Star, ChartSpline, ExternalLink, TriangleExclamationPoint as TriangleAlert } from 'lucide-react';
import MacroSwitch from '../components/MacroSwitch';
import { Seg, Modal, ModalHead, useSize } from '../components/ui';
import { AreaSpark, LineChart, PALETTE } from '../components/MacroCharts';
import { useStore } from '../store/store';
import { SERIES_PAGES, RANGES, rangeFrom, stats, fmtValue, fmtChange, toneOf, FREQ_LABEL, valueAt, isoDay } from '../lib/fredSeries';
import { useSeries } from '../lib/useSeries';
import { useWatch, useOpenCompare } from '../lib/macroWatch';
import { MONTHS } from '../lib/stats';

const fmtDay = (d) => { if (!d) return '—'; const [y, m, dd] = d.split('-').map(Number); return `${MONTHS[m - 1]} ${dd}, ${y}`; };
const WIN = { '1M': '1M', '4W': '4W', prev: 'prev' };

/** a page's range, remembered per page */
export function useRange(key, def = '1Y') {
  const { state, setSetting } = useStore();
  const r = state.settings.macroRanges?.[key] || def;
  return [r, (v) => setSetting('macroRanges', (c) => ({ ...(c || {}), [key]: v }))];
}

export function SeriesHead({ title, desc, chips, children }) {
  return (
    <div className="ms-head">
      <div className="ms-head-text">
        {title}
        <p className="muted">{desc}</p>
        <div className="ms-chips">{chips.map(([k, v]) => <span key={k} className="ms-chip"><small>{k}</small><b>{v}</b></span>)}</div>
      </div>
      <div className="ms-head-tools">{children}</div>
    </div>
  );
}

/** one series as a card */
export function SeriesCard({ s, onOpen, tag }) {
  const w = useWatch();
  const st = stats(s.obs);
  const pinned = w.has(s.id);
  return (
    <div className="card ms-card" role="button" tabIndex={0} onClick={() => onOpen(s.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(s.id)}>
      <div className="ms-card-top">
        <span className="ms-card-label">{s.def.label}</span>
        <button className={`icon-btn ms-pin ${pinned ? 'on' : ''}`} title={pinned ? `Remove from ${w.list.name}` : `Pin to ${w.list.name}`} onClick={(e) => { e.stopPropagation(); w.toggle(s.id); }}><Star size={14} /></button>
      </div>
      {st ? (
        <>
          <div className="ms-card-val">{fmtValue(s.def, st.v)}</div>
          <div className="ms-card-chg"><span className={toneOf(s.id, st.chg)}>{fmtChange(s.def, st.chg)}</span> <span className="muted">· {WIN[st.window]}</span></div>
        </>
      ) : <div className="ms-card-val muted">{s.error ? 'No data' : '…'}</div>}
      <AreaSpark obs={s.view} h={44} />
      <div className="ms-card-foot"><span className="ms-id">{s.id}</span>{tag && <span className="ms-tag">{tag}</span>}{st && <span className="muted">{fmtDay(st.date)}</span>}</div>
    </div>
  );
}

/** the full chart for one series */
export function SeriesModal({ id, s, range, onRange, onClose, target, src = 'FRED' }) {
  const w = useWatch();
  const compare = useOpenCompare();
  if (!s) return null;
  const st = stats(s.obs);
  return (
    <Modal open={!!id} onClose={onClose} width={860}>
      <ModalHead title={s.def.label} sub={`${s.id} · ${src}${st ? ` · ${FREQ_LABEL[st.freq]}` : ''}`} onClose={onClose} />
      <div className="ms-modal">
        {st && (
          <div className="ms-modal-stats">
            <div><small>Latest</small><b>{fmtValue(s.def, st.v)}</b><span className="muted">{fmtDay(st.date)}</span></div>
            <div><small>Change ({st.window === 'prev' ? 'vs previous' : st.window})</small><b className={toneOf(s.id, st.chg)}>{fmtChange(s.def, st.chg)}</b></div>
            <div><small>1-year low</small><b>{fmtValue(s.def, st.lo)}</b></div>
            <div><small>1-year high</small><b>{fmtValue(s.def, st.hi)}</b></div>
            <div className="ms-pos"><small>Position in 1-year range</small><span className="ms-range"><i style={{ left: `${st.pos * 100}%` }} /></span><b>{Math.round(st.pos * 100)}%</b></div>
          </div>
        )}
        {s.def.note && <p className="muted ms-note">{s.def.note}</p>}
        <div className="row gap8 wrap" style={{ marginBottom: 10 }}>
          {onRange ? <Seg value={range} onChange={onRange} options={RANGES} /> : <span className="muted" style={{ fontSize: 13 }}>Last {range === '5Y' ? '5 years' : range}</span>}
          <div className="grow" />
          <button className={`btn sm ${w.has(s.id) ? 'on' : ''}`} onClick={() => w.toggle(s.id)}><Star size={14} /> {w.has(s.id) ? 'Pinned' : 'Pin'}</button>
          <button className="btn sm" onClick={() => compare([s.id])}><ChartSpline size={14} /> Compare</button>
          {src === 'FRED' && !s.def.derive && <a className="btn sm" href={`https://fred.stlouisfed.org/series/${s.id}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> FRED</a>}
        </div>
        <LineChart lines={[{ id: s.id, label: s.def.label, def: s.def, obs: s.view, color: PALETTE[0] }]} height={320} zeroLine refLines={target != null && s.def.unit === 'pct' ? [{ v: target, label: `${target}% target` }] : []} />
      </div>
    </Modal>
  );
}

const TENORS = [['DGS3MO', '3M', 0.25], ['DGS1', '1Y', 1], ['DGS2', '2Y', 2], ['DGS5', '5Y', 5], ['DGS10', '10Y', 10], ['DGS20', '20Y', 20], ['DGS30', '30Y', 30]];
/** today's Treasury curve against a month and a year ago */
function YieldCurve({ series }) {
  const [ref, { w }] = useSize();
  const last = series.DGS10?.obs?.[series.DGS10.obs.length - 1]?.[0];
  if (!last) return null;
  const at = (days) => isoDay(Date.parse(`${last}T00:00:00Z`) - days * 86400000);
  const curves = [['Today', 0, PALETTE[0]], ['1 month ago', 30, '#e8a33d'], ['1 year ago', 365, 'var(--muted-2)']].map(([label, days, color]) => ({ label, color, pts: TENORS.map(([id]) => valueAt(series[id]?.obs || [], at(days))) }));
  const all = curves.flatMap((c) => c.pts).filter((v) => v != null);
  if (!all.length) return null;
  const lo = Math.min(...all) - 0.1, hi = Math.max(...all) + 0.1, h = 210, padL = 46, padB = 24, padT = 10;
  const W = Math.max(10, w - padL - 14);
  const X = (i) => padL + (i / (TENORS.length - 1)) * W, Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  return (
    <div className="card card-pad ms-curve">
      <div className="row gap12 wrap" style={{ marginBottom: 6 }}>
        <b>Treasury yield curve</b>
        <span className="muted" style={{ fontSize: 12.5 }}>as of {fmtDay(last)}</span>
        <div className="grow" />
        {curves.map((c) => <span key={c.label} className="ms-curve-key"><i style={{ background: c.color }} />{c.label}</span>)}
      </div>
      <div ref={ref} className="m-chart">
        {w > 0 && (
          <svg width={w} height={h}>
            {[0, 0.5, 1].map((p) => { const v = lo + p * (hi - lo); return <g key={p}><line x1={padL} x2={w - 14} y1={Y(v)} y2={Y(v)} className="grid" /><text x={padL - 8} y={Y(v) + 4} textAnchor="end">{v.toFixed(2)}%</text></g>; })}
            {TENORS.map(([, l], i) => <text key={l} x={X(i)} y={h - 6} textAnchor="middle">{l}</text>)}
            {curves.slice().reverse().map((c) => (
              <g key={c.label}>
                <polyline className="ln" style={{ stroke: c.color, strokeDasharray: c.label === 'Today' ? undefined : '4 3' }} points={c.pts.map((v, i) => (v == null ? null : `${X(i)},${Y(v)}`)).filter(Boolean).join(' ')} />
                {c.label === 'Today' && c.pts.map((v, i) => v != null && <g key={i}><circle cx={X(i)} cy={Y(v)} r="3.5" style={{ fill: c.color }} /><text x={X(i)} y={Y(v) - 9} textAnchor="middle" className="ms-curve-v">{v.toFixed(2)}</text></g>)}
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

export default function MacroSeries({ page }) {
  const cfg = SERIES_PAGES[page] || SERIES_PAGES.rates;
  const [range, setRange] = useRange(page);
  const [open, setOpen] = useState(null);
  const from = rangeFrom(range);
  const ids = useMemo(() => [...new Set([...cfg.groups.flatMap((g) => g.ids), ...(cfg.curve ? TENORS.map((t) => t[0]) : [])])], [cfg]);
  const { series, loading, error, refreshing, reload } = useSeries(ids, from);
  const total = cfg.groups.reduce((n, g) => n + g.ids.length, 0);
  const errs = ids.filter((id) => series[id]?.error && !series[id]?.obs?.length);
  const host = cfg.pd ? 'markets.newyorkfed.org' : 'fred.stlouisfed.org';
  return (
    <div className="page ms-page">
      <SeriesHead title={<MacroSwitch current={page} />} desc={cfg.desc} chips={[['Series', total], ['Source', cfg.src], ['Refresh', cfg.refresh], ['From', host]]}>
        <Seg value={range} onChange={setRange} options={RANGES} />
        <button className="icon-btn" onClick={reload} title="Reload"><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button>
      </SeriesHead>
      {error && <div className="ec-warn"><TriangleAlert size={15} /> {error}</div>}
      {!error && errs.length > 0 && <div className="ec-warn"><TriangleAlert size={15} /> Couldn’t load {errs.length === 1 ? errs[0] : `${errs.length} series`} yet — RoninFlow will try again shortly.</div>}
      {loading ? <div className="ec-empty">Loading {total} series from {cfg.src}… (the first time takes a few seconds)</div> : (
        <>
          {cfg.curve && <YieldCurve series={series} />}
          {cfg.groups.map((g) => (
            <section key={g.title} className="ms-group">
              <h3 className="ms-group-title">{g.title}</h3>
              <div className="ms-grid">
                {g.ids.map((id) => series[id] && <SeriesCard key={id} s={series[id]} onOpen={setOpen} />)}
              </div>
            </section>
          ))}
          {refreshing && <div className="muted ms-loading-more"><RefreshCw size={13} className="spin" /> Fetching the rest from {cfg.src}…</div>}
        </>
      )}
      <div className="muted ec-source">Source: {cfg.pd ? 'Federal Reserve Bank of New York, Primary Dealer Statistics' : 'FRED®, Federal Reserve Bank of St. Louis'} (public data). Not financial advice.</div>
      <SeriesModal id={open} s={open && series[open]} range={range} onRange={setRange} onClose={() => setOpen(null)} target={cfg.target} src={cfg.pd ? 'NY Fed' : 'FRED'} />
    </div>
  );
}
