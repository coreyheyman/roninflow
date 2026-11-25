// Macro → Correlation Matrix: rolling Pearson correlation of daily returns across the majors and US indices, with the
// strongest pairs and how any pair's correlation has moved over time.
import { useMemo, useState } from 'react';
import { RefreshCw, TriangleExclamationPoint as TriangleAlert } from 'lucide-react';
import MacroSwitch from '../components/MacroSwitch';
import { Seg } from '../components/ui';
import { LineChart } from '../components/MacroCharts';
import { SeriesHead } from './MacroSeries';
import { useStore } from '../store/store';
import { correlationMatrix, rollingCorrelation, isoDay } from '../lib/fredSeries';
import { useSeries } from '../lib/useSeries';

const BASE = [['DEXUSEU', 'EURUSD'], ['DEXUSUK', 'GBPUSD'], ['DEXJPUS', 'USDJPY'], ['DEXSZUS', 'USDCHF'], ['DEXCAUS', 'USDCAD'], ['DEXUSAL', 'AUDUSD'], ['DEXUSNZ', 'NZDUSD'], ['SP500', 'SPX'], ['NASDAQ100', 'NDX'], ['DJIA', 'DJIA']];
const EXTRA = [['DTWEXBGS', 'DXY broad'], ['DGS10', 'US 10Y'], ['VIXCLS', 'VIX'], ['DCOILWTICO', 'WTI'], ['BAMLH0A0HYM2', 'HY spread']];
const WINDOWS = [{ value: 30, label: '30D' }, { value: 60, label: '60D' }, { value: 180, label: '180D' }, { value: 252, label: '252D' }];
const FROM = isoDay(Date.now() - 4 * 366 * 86400000);

const cellBg = (r) => {
  const a = Math.min(1, Math.abs(r));
  return r >= 0 ? `color-mix(in srgb, var(--pos-strong) ${Math.round(a * 70)}%, transparent)` : `color-mix(in srgb, var(--neg) ${Math.round(a * 70)}%, transparent)`;
};
const word = (r) => { const a = Math.abs(r); const s = a >= 0.7 ? 'strongly' : a >= 0.4 ? 'moderately' : a >= 0.2 ? 'weakly' : 'barely'; return a < 0.2 ? 'move independently' : `move ${s} ${r > 0 ? 'together' : 'opposite'}`; };

export default function Correlation() {
  const { state, setSetting } = useStore();
  const n = state.settings.corrWindow || 60;
  const extra = state.settings.corrExtra || [];
  const markets = [...BASE, ...EXTRA.filter(([id]) => extra.includes(id))];
  const ids = markets.map((m) => m[0]);
  const { series, loading, error, refreshing, reload } = useSeries(ids, FROM);
  const lists = ids.map((id) => series[id]?.obs || []);
  const ready = lists.every((l) => l.length > 10);
  const { m, n: used, end } = useMemo(() => (ready ? correlationMatrix(lists, n) : { m: [], n: 0, end: null }), [ready, n, ...lists]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState([0, 7]);
  const [hover, setHover] = useState(null);
  const pairs = useMemo(() => {
    const out = [];
    for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) out.push({ i, j, r: m[i][j] });
    return out.sort((a, b) => b.r - a.r);
  }, [m]);
  const [pi, pj] = pick[0] < markets.length && pick[1] < markets.length ? pick : [0, 1];
  const roll = useMemo(() => (ready ? rollingCorrelation(lists[pi], lists[pj], n) : []), [ready, pi, pj, n, ...lists]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = hover || { i: pi, j: pj };
  const label = (k) => markets[k]?.[1];

  return (
    <div className="page ms-page cr-page">
      <SeriesHead title={<MacroSwitch current="correlation" />} desc="Rolling Pearson correlation of daily returns across the majors and the US indices. +1 = always move together, −1 = always opposite, 0 = no relationship." chips={[['Series', ids.length], ['Source', 'FRED'], ['Refresh', 'Daily'], ['Window', `${used || n} trading days`]]}>
        <Seg value={n} onChange={(v) => setSetting('corrWindow', v)} options={WINDOWS} />
        <button className="icon-btn" onClick={reload} title="Reload"><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button>
      </SeriesHead>
      <div className="row gap6 wrap" style={{ marginBottom: 14 }}>
        <span className="muted" style={{ fontSize: 13 }}>Also show</span>
        {EXTRA.map(([id, l]) => <button key={id} className={`chip ${extra.includes(id) ? 'on' : ''}`} onClick={() => setSetting('corrExtra', extra.includes(id) ? extra.filter((x) => x !== id) : [...extra, id])}>{l}</button>)}
      </div>
      {error && <div className="ec-warn"><TriangleAlert size={15} /> {error}</div>}
      {!ready ? <div className="ec-empty">{loading || refreshing ? 'Loading four years of daily prices from FRED… (the first time takes a few seconds)' : 'Not enough data yet — try again in a minute.'}</div> : (
        <div className="cr-layout">
          <div className="card card-pad cr-matrix-card">
            <div className="cr-matrix" style={{ gridTemplateColumns: `76px repeat(${markets.length}, minmax(34px, 1fr))` }} onMouseLeave={() => setHover(null)}>
              <span />
              {markets.map(([id, l]) => <span key={id} className="cr-h">{l}</span>)}
              {markets.map(([id, l], i) => (
                <div key={id} className="cr-row">
                  <span className="cr-h cr-rh">{l}</span>
                  {markets.map(([id2], j) => {
                    const r = m[i]?.[j] ?? 0;
                    const sel = (i === pi && j === pj) || (i === pj && j === pi);
                    return (
                      <button key={id2} className={`cr-cell ${i === j ? 'diag' : ''} ${sel ? 'sel' : ''}`} style={{ background: i === j ? undefined : cellBg(r) }}
                        onMouseEnter={() => i !== j && setHover({ i, j })} onClick={() => i !== j && setPick([i, j])} title={i === j ? l : `${l} vs ${markets[j][1]}: ${r.toFixed(2)}`}>
                        {r.toFixed(2)}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="cr-foot muted">
              <span className="cr-scale"><i style={{ background: 'linear-gradient(90deg, var(--neg), transparent, var(--pos-strong))' }} /><small>−1</small><small>0</small><small>+1</small></span>
              <span>{shown && shown.i !== shown.j ? <><b>{label(shown.i)}</b> and <b>{label(shown.j)}</b> {word(m[shown.i][shown.j])} ({m[shown.i][shown.j].toFixed(2)}) over the last {used} days.</> : 'Hover a cell to read it, click it to chart it below.'}</span>
            </div>
          </div>
          <div className="cr-side">
            <div className="card card-pad">
              <b className="cr-side-title">Moving together</b>
              {pairs.slice(0, 5).map((p) => <button key={`${p.i}-${p.j}`} className="cr-pair" onClick={() => setPick([p.i, p.j])}><span>{label(p.i)} · {label(p.j)}</span><b className="pos">{p.r.toFixed(2)}</b></button>)}
            </div>
            <div className="card card-pad">
              <b className="cr-side-title">Moving opposite</b>
              {pairs.slice(-5).reverse().map((p) => <button key={`${p.i}-${p.j}`} className="cr-pair" onClick={() => setPick([p.i, p.j])}><span>{label(p.i)} · {label(p.j)}</span><b className="neg">{p.r.toFixed(2)}</b></button>)}
            </div>
          </div>
        </div>
      )}
      {ready && roll.length > 1 && (
        <div className="card card-pad" style={{ marginTop: 14 }}>
          <div className="row gap8 wrap" style={{ marginBottom: 8 }}><b>{label(pi)} vs {label(pj)}</b><span className="muted" style={{ fontSize: 12.5 }}>— {n}-day rolling correlation{end ? `, to ${end}` : ''}</span></div>
          <LineChart lines={[{ id: 'roll', label: 'Correlation', def: { unit: 'num', dp: 2 }, obs: roll, color: 'var(--primary)' }]} height={220} zeroLine />
        </div>
      )}
      <div className="muted ec-source">Source: FRED®, Federal Reserve Bank of St. Louis (noon buying rates and index closes). Only days every market traded are used. Not financial advice.</div>
    </div>
  );
}
