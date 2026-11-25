// Macro → Watch List: the series you've pinned (the ☆ on any card), with the latest value, the change on the week and
// a sparkline of the last 60 observations. Several named lists; kept with your settings.
import { useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, ChartSpline, ArrowUp, ArrowDown, X, RefreshCw } from 'lucide-react';
import MacroSwitch from '../components/MacroSwitch';
import { AreaSpark } from '../components/MacroCharts';
import { SeriesHead, SeriesModal, useRange } from './MacroSeries';
import { AddSeries } from './Comparator';
import { rangeFrom, freqOf, valueAt, isoDay, fmtValue, fmtChange, toneOf, FREQ_LABEL, seriesDef } from '../lib/fredSeries';
import { useSeries } from '../lib/useSeries';
import { useWatch, useOpenCompare } from '../lib/macroWatch';

const FROM = rangeFrom('5Y');
function weekChange(obs) {
  if (!obs?.length) return null;
  const [date, v] = obs[obs.length - 1];
  const f = freqOf(obs);
  const prev = f === 'd' || f === 'w' ? valueAt(obs, isoDay(Date.parse(`${date}T00:00:00Z`) - 7 * 86400000)) : obs.length > 1 ? obs[obs.length - 2][1] : null;
  return { date, v, d: prev == null ? null : v - prev, f };
}

export default function Watchlist() {
  const w = useWatch();
  const compare = useOpenCompare();
  const ids = w.list.ids;
  const { series, loading, refreshing, reload } = useSeries(ids, FROM);
  const [open, setOpen] = useState(null);
  const [range, setRange] = useRange('watch', '1Y');
  const [editing, setEditing] = useState(null);
  const modalS = useMemo(() => { if (!open || !series[open]) return null; const f = rangeFrom(range); return { ...series[open], view: f ? series[open].obs.filter((r) => r[0] >= f) : series[open].obs }; }, [open, series, range]);

  return (
    <div className="page ms-page wl-page">
      <SeriesHead title={<MacroSwitch current="watch" />} desc="Every series you’ve pinned in one place — pin any card with its ☆. The latest value, the change on the week (or on the previous print for monthly data) and the last 60 observations." chips={[['Lists', w.lists.length], ['In this list', ids.length], ['Saved', 'with your settings']]}>
        <button className="icon-btn" onClick={reload} title="Reload"><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button>
      </SeriesHead>
      <div className="wl-bar">
        <div className="wl-tabs">
          {w.lists.map((l) => (
            editing === l.id ? (
              <input key={l.id} className="input wl-rename" autoFocus defaultValue={l.name} onBlur={(e) => { w.rename(l.id, e.target.value.trim() || l.name); setEditing(null); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null); }} />
            ) : (
              <button key={l.id} className={`chip ${l.id === w.list.id ? 'on' : ''}`} onClick={() => w.select(l.id)} onDoubleClick={() => setEditing(l.id)}>{l.name} <small className="muted">{l.ids.length}</small></button>
            )
          ))}
          <button className="chip" onClick={() => w.create(`List ${w.lists.length + 1}`)}><Plus size={13} /> New list</button>
        </div>
        <div className="row gap8 wrap">
          <button className="btn sm" onClick={() => setEditing(w.list.id)} title="Rename this list"><Pencil size={14} /> Rename</button>
          {w.lists.length > 1 && <button className="btn sm" onClick={() => w.drop(w.list.id)} title="Delete this list"><Trash2 size={14} /> Delete list</button>}
          <button className="btn sm" onClick={() => compare(ids)} disabled={!ids.length}><ChartSpline size={14} /> Add to Comparator</button>
          <AddSeries have={ids} onAdd={w.add} cot={false} max={40} />
        </div>
      </div>
      {!ids.length ? <div className="ec-empty">This list is empty. Pin series with the ☆ on any Macro card, or add one here.</div> : loading ? <div className="ec-empty">Loading…</div> : (
        <div className="tbl-wrap card">
          <table className="tbl wl-tbl">
            <thead><tr><th>Kind</th><th>Series</th><th className="r">Latest</th><th className="r">Δ</th><th>Trend (60 obs)</th><th>Refresh</th><th /></tr></thead>
            <tbody>
              {ids.map((id, i) => {
                const s = series[id];
                const def = seriesDef(id);
                const c = weekChange(s?.obs);
                return (
                  <tr key={id} className="click" onClick={() => setOpen(id)}>
                    <td><span className="ms-tag">{def.src === 'pd' ? 'NY Fed' : 'FRED'}</span></td>
                    <td><div className="col"><span>{def.label}</span><small className="ms-id">{id}</small></div></td>
                    <td className="r"><b>{c ? fmtValue(def, c.v) : s?.error ? 'No data' : '…'}</b></td>
                    <td className="r"><span className={toneOf(id, c?.d)}>{c ? fmtChange(def, c.d) : '—'}</span></td>
                    <td className="wl-trend"><AreaSpark obs={(s?.obs || []).slice(-60)} h={30} /></td>
                    <td className="muted">{c ? FREQ_LABEL[c.f] : '—'}</td>
                    <td className="r wl-act" onClick={(e) => e.stopPropagation()}>
                      <button className="icon-btn" disabled={i === 0} onClick={() => w.move(id, -1)} title="Move up"><ArrowUp size={14} /></button>
                      <button className="icon-btn" disabled={i === ids.length - 1} onClick={() => w.move(id, 1)} title="Move down"><ArrowDown size={14} /></button>
                      <button className="icon-btn" onClick={() => w.remove(id)} title="Remove"><X size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted ec-source">Double-click a list’s name to rename it. Sources: FRED®, Federal Reserve Bank of St. Louis; Federal Reserve Bank of New York. Not financial advice.</div>
      <SeriesModal id={open} s={modalS} range={range} onRange={setRange} onClose={() => setOpen(null)} src={seriesDef(open || '').src === 'pd' ? 'NY Fed' : 'FRED'} />
    </div>
  );
}
