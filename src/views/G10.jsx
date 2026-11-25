// Macro → G10 Indicators: eight economies side by side — unemployment, inflation, the policy rate, the real policy
// rate and the 10-year yield — with the latest prints. FRED (OECD, ECB, BoE and national sources it republishes).
import { useMemo, useState } from 'react';
import { RefreshCw, TriangleExclamationPoint as TriangleAlert } from 'lucide-react';
import MacroSwitch from '../components/MacroSwitch';
import { SeriesHead, SeriesModal } from './MacroSeries';
import { freqOf, valueAt, isoDay, rangeFrom, fmtValue } from '../lib/fredSeries';
import { useSeries } from '../lib/useSeries';
import { MONTHS } from '../lib/stats';

// each cell: candidate series, first one with a print in the last ~9 months wins
const COUNTRIES = [
  { c: 'USA', flag: '🇺🇸', un: ['UNRATE'], cpi: ['CPIAUCSL'], rate: ['DFEDTARU'], y10: ['DGS10'] },
  { c: 'Canada', flag: '🇨🇦', un: ['LRHUTTTTCAM156S'], cpi: ['CPALTT01CAM659N'], rate: ['IRSTCI01CAM156N'], y10: ['IRLTLT01CAM156N'] },
  { c: 'Germany', flag: '🇩🇪', un: ['LRHUTTTTDEM156S'], cpi: ['CPALTT01DEM659N', 'CP0000EZ19M086NEST'], rate: ['ECBDFR'], y10: ['IRLTLT01DEM156N'] },
  { c: 'UK', flag: '🇬🇧', un: ['LRHUTTTTGBM156S'], cpi: ['CPALTT01GBM659N'], rate: ['IRSTCI01GBM156N', 'IUDSOIA'], y10: ['IRLTLT01GBM156N'] },
  { c: 'Japan', flag: '🇯🇵', un: ['LRHUTTTTJPM156S'], cpi: ['CPALTT01JPM659N'], rate: ['IRSTCI01JPM156N'], y10: ['IRLTLT01JPM156N'] },
  { c: 'Australia', flag: '🇦🇺', un: ['LRHUTTTTAUM156S'], cpi: ['CPALTT01AUQ659N'], rate: ['IRSTCI01AUM156N'], y10: ['IRLTLT01AUM156N'] },
  { c: 'New Zealand', flag: '🇳🇿', un: ['LRHUTTTTNZQ156S'], cpi: ['CPALTT01NZQ659N'], rate: ['IRSTCI01NZM156N'], y10: ['IRLTLT01NZM156N'] },
  { c: 'Switzerland', flag: '🇨🇭', un: ['LRHUTTTTCHQ156S'], cpi: ['CPALTT01CHM659N'], rate: ['IRSTCI01CHM156N'], y10: ['IRLTLT01CHM156N'] },
];
const COLS = [
  { k: 'un', label: 'Unemployment', name: 'Unemployment' },
  { k: 'cpi', label: 'Inflation (CPI YoY)', name: 'CPI' },
  { k: 'rate', label: 'Policy rate', name: 'Policy rate' },
  { k: 'real', label: 'Real policy rate', name: 'Real rate', tip: 'Policy rate minus inflation. Above zero = policy is restrictive.' },
  { k: 'y10', label: '10Y yield', name: '10Y yield' },
];
const FROM = isoDay(Date.now() - 6 * 366 * 86400000);
const STALE = 280 * 86400000;
const fmtDay = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${MONTHS[m - 1]} ${dd}, ${y}`; };

function cell(series, ids) {
  for (const id of ids) {
    const s = series[id];
    const o = s?.obs;
    if (!o?.length || Date.now() - Date.parse(o[o.length - 1][0]) > STALE) continue;
    const [date, v] = o[o.length - 1];
    const f = freqOf(o);
    const prev = f === 'd' || f === 'w' ? valueAt(o, isoDay(Date.parse(date) - 91 * 86400000)) : o.length > 1 ? o[o.length - 2][1] : null;
    const prevDate = f === 'd' || f === 'w' ? null : o[o.length - 2]?.[0];
    return { id, s, date, v, prev, d: prev == null ? null : v - prev, win: f === 'd' || f === 'w' ? '3M' : 'prev', prevDate };
  }
  return null;
}
function delta(k, c, cpiV) {
  if (!c || c.d == null) return { text: '—', cls: 'muted' };
  const dp = k === 'un' || k === 'cpi' ? 1 : 2;
  const d = Math.round(c.d * 10 ** dp) / 10 ** dp;
  const pp = d === 0 ? 'unch.' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(dp)}pp`;
  if (k === 'un') return { text: `${pp} · ${d > 0 ? 'rising' : d < 0 ? 'falling' : 'steady'}`, cls: d > 0 ? 'neg' : d < 0 ? 'pos' : 'muted' };
  if (k === 'cpi') { const closer = Math.abs(c.v - 2) < Math.abs(c.prev - 2); return { text: `${pp} · ${d === 0 ? 'steady' : closer ? 'to target' : 'off target'}`, cls: d === 0 ? 'muted' : closer ? 'pos' : 'neg' }; }
  if (k === 'rate') return { text: `${pp} · ${d > 0 ? 'hiking' : d < 0 ? 'cutting' : 'on hold'}`, cls: d > 0 ? 'neg' : d < 0 ? 'pos' : 'muted' };
  if (k === 'real') return { text: c.v > 0 ? 'restrictive' : 'accommodative', cls: c.v > 0 ? 'neg' : 'pos' };
  return { text: `${pp} · ${d > 0 ? 'rising' : d < 0 ? 'falling' : 'steady'}`, cls: 'muted' };
}

export default function G10() {
  const ids = useMemo(() => [...new Set(COUNTRIES.flatMap((c) => [...c.un, ...c.cpi, ...c.rate, ...c.y10]))], []);
  const { series, loading, error, refreshing, reload } = useSeries(ids, FROM);
  const [open, setOpen] = useState(null);
  const rows = COUNTRIES.map((co) => {
    const un = cell(series, co.un), cpi = cell(series, co.cpi), rate = cell(series, co.rate), y10 = cell(series, co.y10);
    const real = cpi && rate ? { v: rate.v - cpi.v, d: 0, real: true } : null;
    return { ...co, cells: { un, cpi, rate, real, y10 } };
  });
  const releases = rows.flatMap((r) => ['un', 'cpi', 'rate', 'y10'].map((k) => r.cells[k] && { country: r.c, flag: r.flag, k, ...r.cells[k] }).filter(Boolean))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  const latest = releases[0]?.date;
  const fiveY = rangeFrom('5Y');
  const view = open && series[open] ? { ...series[open], view: series[open].obs.filter((r) => r[0] >= fiveY) } : null;

  return (
    <div className="page ms-page g10-page">
      <SeriesHead title={<MacroSwitch current="g10" />} desc="Eight economies side by side. FRED where it publishes current data (OECD, ECB and Bank of England series it carries); a cell shows n/a when there’s no current public series." chips={[['Economies', COUNTRIES.length], ['Indicators', COLS.length], ['Source', 'FRED'], ['Latest print', latest ? fmtDay(latest) : '—']]}>
        <button className="icon-btn" onClick={reload} title="Reload"><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button>
      </SeriesHead>
      {error && <div className="ec-warn"><TriangleAlert size={15} /> {error}</div>}
      {loading ? <div className="ec-empty">Loading {ids.length} series from FRED… (the first time takes a few seconds)</div> : (
        <>
          <div className="tbl-wrap card">
            <table className="tbl g10-tbl">
              <thead><tr><th>Country</th>{COLS.map((c) => <th key={c.k} title={c.tip}>{c.label}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.c}>
                    <td><span className="g10-flag">{r.flag}</span> {r.c}</td>
                    {COLS.map((col) => {
                      const c = r.cells[col.k];
                      if (!c) return <td key={col.k} className="g10-cell muted">n/a<small>—</small></td>;
                      const dl = delta(col.k, c);
                      const clickable = !c.real;
                      return (
                        <td key={col.k} className={`g10-cell ${clickable ? 'click' : ''}`} onClick={() => clickable && setOpen(c.id)} title={clickable ? `${c.s.def.label} — ${fmtDay(c.date)}. Click for 5-year history.` : col.tip}>
                          <b className={col.k === 'real' ? dl.cls : ''}>{c.v.toFixed(col.k === 'un' || col.k === 'cpi' ? 1 : 2)}%</b>
                          <small className={dl.cls}>{dl.text}</small>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted g10-note">Click any cell for its 5-year history. Green = easier conditions: lower unemployment, inflation moving toward 2%, a falling policy rate. Changes are against the previous print (3 months for daily rates).</p>
          <div className="card g10-rel">
            <div className="g10-rel-head"><b>Recent releases</b><span className="muted"> · latest prints</span></div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Date</th><th>Country</th><th>Release</th><th className="r">Latest</th><th className="r">Previous</th></tr></thead>
                <tbody>
                  {releases.map((x) => (
                    <tr key={`${x.country}-${x.k}`} onClick={() => setOpen(x.id)} className="click">
                      <td className="no-i18n">{x.date}</td><td>{x.flag} {x.country}</td><td>{COLS.find((c) => c.k === x.k).name}</td>
                      <td className="r"><b>{fmtValue(x.s.def, x.v)}</b></td><td className="r muted">{x.prev == null ? '—' : fmtValue(x.s.def, x.prev)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      <div className="muted ec-source">Source: FRED®, Federal Reserve Bank of St. Louis — OECD Main Economic Indicators, ECB, Bank of England and national statistics. Not financial advice.</div>
      <SeriesModal id={open} s={view} range="5Y" onRange={null} onClose={() => setOpen(null)} />
    </div>
  );
}
