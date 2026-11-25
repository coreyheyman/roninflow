// Macro → Comparator: overlay any series against any other on one chart — rebased to 100, as z-scores, min-max, or
// raw on two axes — including CFTC net positioning. Remembers what you last compared.
import { useMemo, useState } from 'react';
import { Plus, X, Search, RefreshCw, Star } from 'lucide-react';
import MacroSwitch from '../components/MacroSwitch';
import { Seg, Popover } from '../components/ui';
import { LineChart, PALETTE } from '../components/MacroCharts';
import { SeriesHead } from './MacroSeries';
import { useStore } from '../store/store';
import { useMacro } from '../lib/macro';
import { SERIES, PICK_GROUPS, RANGES, rangeFrom, seriesDef, stats, fmtValue, fmtChange, alignedReturns, pearson } from '../lib/fredSeries';
import { useSeries } from '../lib/useSeries';
import { useWatch } from '../lib/macroWatch';

const PRESETS = [
  ['10Y vs S&P 500', ['DGS10', 'SP500']], ['HY spread vs VIX', ['BAMLH0A0HYM2', 'VIXCLS']], ['Net liquidity vs S&P 500', ['NETLIQ', 'SP500']],
  ['Fed balance sheet vs S&P 500', ['WALCL', 'SP500']], ['Brent vs WTI', ['DCOILBRENTEU', 'DCOILWTICO']], ['M2 vs CPI YoY', ['M2SL', 'CPIAUCSL']],
  ['2s10s vs S&P 500', ['T10Y2Y', 'SP500']], ['Dollar vs gold specs', ['DTWEXBGS', 'cot:GC']], ['Euro specs vs EUR/USD', ['cot:6E', 'DEXUSEU']],
  ['Real yield vs Nasdaq', ['DFII10', 'NASDAQCOM']],
];
const MODES = [{ value: 'index', label: 'Index 100' }, { value: 'z', label: 'Z-score' }, { value: 'minmax', label: 'Min-max' }, { value: 'raw', label: 'Off' }];
const COT_KEYS = [['Indices', ['ES', 'NQ', 'YM', 'RTY', 'VX']], ['Rates', ['ZT', 'ZF', 'ZN', 'ZB']], ['FX', ['DX', '6E', '6J', '6B', '6A', '6C', '6S', '6N', '6M']], ['Metals', ['GC', 'SI', 'HG', 'PL']], ['Energy', ['CL', 'NG']], ['Crypto', ['BTC', 'ETH']], ['Grains', ['ZC', 'ZS', 'ZW']]];

export function AddSeries({ have, onAdd, cotLabels = {}, cot = true, max = 8 }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const all = [
    ...PICK_GROUPS.map((g) => ({ title: g.title, items: g.ids.map((id) => [id, SERIES[id].label]) })),
    { title: 'All FRED series', items: Object.entries(SERIES).filter(([id, d]) => !d.src && !PICK_GROUPS.some((g) => g.ids.includes(id))).map(([id, d]) => [id, d.label]) },
    ...(cot ? COT_KEYS : []).map(([g, keys]) => ({ title: `Positioning · ${g}`, items: keys.map((k) => [`cot:${k}`, `${cotLabels[k] || k} — specs net`]) })),
  ].map((g) => ({ ...g, items: g.items.filter(([id, l]) => !have.includes(id) && (!ql || l.toLowerCase().includes(ql) || id.toLowerCase().includes(ql))) })).filter((g) => g.items.length);
  return (
    <Popover width={340} portal trigger={({ toggle }) => <button className="btn sm" onClick={toggle} disabled={have.length >= max}><Plus size={14} /> Add series</button>}>
      {(close) => (
        <div className="cmp-add">
          <label className="ec-search"><Search size={15} /><input autoFocus className="input" placeholder="Search series" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="cmp-add-list">
            {all.map((g) => (
              <div key={g.title}>
                <div className="cmp-add-g">{g.title}</div>
                {g.items.map(([id, l]) => <button key={id} className="pop-item" onClick={() => { onAdd(id); close(); setQ(''); }}><span className="grow">{l}</span><small className="muted">{id.replace('cot:', '')}</small></button>)}
              </div>
            ))}
            {!all.length && <div className="muted" style={{ padding: 12 }}>Nothing matches.</div>}
          </div>
        </div>
      )}
    </Popover>
  );
}

export default function Comparator() {
  const { state, setSetting } = useStore();
  const w = useWatch();
  const cfg = state.settings.macroCompare || {};
  const ids = cfg.ids?.length ? cfg.ids : ['DGS10', 'SP500'];
  const range = cfg.range || '2Y', mode = cfg.mode || 'index';
  const set = (patch) => setSetting('macroCompare', (c) => ({ ...(c || {}), ids, range, mode, ...patch }));
  const from = rangeFrom(range);
  const fredIds = ids.filter((id) => !id.startsWith('cot:'));
  const cotIds = ids.filter((id) => id.startsWith('cot:'));
  const { series, loading, refreshing, reload } = useSeries(fredIds, from);
  const cot = useMacro('/api/macro/cot'); // also names the positioning series in the picker
  const cotLabels = useMemo(() => Object.fromEntries((cot.data?.markets || []).map((m) => [m.key, m.label])), [cot.data]);
  const lines = ids.map((id, k) => {
    if (id.startsWith('cot:')) {
      const m = cot.data?.markets?.find((x) => x.key === id.slice(4));
      const obs = (m?.rows || []).map((r) => [r[0], r[2] - r[3]]).filter((r) => !from || r[0] >= from);
      return { id, label: `${m?.label || id.slice(4)} specs net`, def: { label: `${m?.label || id.slice(4)} — specs net`, unit: 'num', dp: 0 }, obs, all: obs, color: PALETTE[k % PALETTE.length] };
    }
    const s = series[id];
    return { id, label: seriesDef(id).label, def: seriesDef(id), obs: s?.view || [], all: s?.obs || [], color: PALETTE[k % PALETTE.length] };
  });
  const presetOn = PRESETS.find(([, p]) => p.join() === ids.join())?.[0];
  const corr = lines.length > 1 && lines[0].obs.length > 10 ? lines.slice(1).map((l) => { const { rets } = alignedReturns([lines[0].obs, l.obs]); return rets[0].length > 10 ? pearson(rets[0], rets[1]) : null; }) : [];

  return (
    <div className="page ms-page cmp-page">
      <SeriesHead title={<MacroSwitch current="compare" />} desc="Overlay any series against any other on one chart. Rebase to 100 at the start of the range, switch to z-scores or min-max, or turn normalisation off to see two series on their own axes." chips={[['Series', ids.length], ['Range', range], ['Normalisation', MODES.find((m) => m.value === mode).label], ['Sources', cotIds.length ? 'FRED · CFTC' : 'FRED']]}>
        <button className="icon-btn" onClick={() => { reload(); cot.reload(); }} title="Reload"><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button>
      </SeriesHead>
      <div className="cmp-presets">
        {PRESETS.map(([l, p]) => <button key={l} className={`chip ${presetOn === l ? 'on' : ''}`} onClick={() => set({ ids: p })}>{l}</button>)}
      </div>
      <div className="card card-pad cmp-card">
        <div className="cmp-bar">
          <div className="cmp-picked">
            {lines.map((l) => (
              <span key={l.id} className="cmp-pill"><i style={{ background: l.color }} />{l.label}{ids.length > 1 && <button className="icon-btn" onClick={() => set({ ids: ids.filter((x) => x !== l.id) })} title="Remove"><X size={12} /></button>}</span>
            ))}
            <AddSeries have={ids} onAdd={(id) => set({ ids: [...ids, id] })} cotLabels={cotLabels} />
          </div>
          <div className="row gap8 wrap">
            <Seg value={range} onChange={(v) => set({ range: v })} options={RANGES} />
            <Seg value={mode} onChange={(v) => set({ mode: v })} options={MODES} />
          </div>
        </div>
        {loading && !lines.some((l) => l.obs.length) ? <div className="ec-empty">Loading…</div> : (
          <LineChart lines={lines} mode={mode} dual={mode === 'raw'} height={380} zeroLine={mode === 'z'} />
        )}
        <div className="muted cmp-mode-note">
          {mode === 'index' && `Each series rebased to 100 at the start of the range (${range}).`}
          {mode === 'z' && 'Each series as standard deviations from its own average over the range.'}
          {mode === 'minmax' && 'Each series scaled from 0 (its low) to 100 (its high) over the range.'}
          {mode === 'raw' && (ids.length === 2 ? 'Raw values, each series on its own axis.' : 'Raw values on one axis — with two series each gets its own.')}
        </div>
      </div>
      <div className="tbl-wrap card" style={{ marginTop: 14 }}>
        <table className="tbl cmp-tbl">
          <thead><tr><th>Series</th><th className="r">Latest</th><th className="r">Change over {range}</th><th className="r">Range low</th><th className="r">Range high</th><th className="r" title={`Correlation of daily/weekly changes with ${lines[0]?.label}`}>Corr. with first</th><th /></tr></thead>
          <tbody>
            {lines.map((l, k) => {
              const st = stats(l.all);
              const first = l.obs[0]?.[1], last = l.obs[l.obs.length - 1]?.[1];
              const vals = l.obs.map((r) => r[1]);
              const pctChg = first && last != null && l.def.unit !== 'pct' && first > 0 ? `${((last / first - 1) * 100).toFixed(1)}%` : null;
              return (
                <tr key={l.id}>
                  <td><span className="cmp-dot" style={{ background: l.color }} />{l.label}</td>
                  <td className="r"><b>{fmtValue(l.def, st?.v)}</b></td>
                  <td className="r">{first != null && last != null ? (pctChg ? <span className={last >= first ? 'pos' : 'neg'}>{last >= first ? '+' : ''}{pctChg}</span> : fmtChange(l.def, last - first)) : '—'}</td>
                  <td className="r muted">{vals.length ? fmtValue(l.def, Math.min(...vals)) : '—'}</td>
                  <td className="r muted">{vals.length ? fmtValue(l.def, Math.max(...vals)) : '—'}</td>
                  <td className="r">{k === 0 ? <span className="muted">—</span> : corr[k - 1] == null ? '—' : <b className={Math.abs(corr[k - 1]) < 0.005 ? 'muted' : corr[k - 1] > 0 ? 'pos' : 'neg'}>{(Math.abs(corr[k - 1]) < 0.005 ? 0 : corr[k - 1]).toFixed(2)}</b>}</td>
                  <td className="r">{!l.id.startsWith('cot:') && <button className={`icon-btn ms-pin ${w.has(l.id) ? 'on' : ''}`} onClick={() => w.toggle(l.id)} title={w.has(l.id) ? 'Unpin' : `Pin to ${w.list.name}`}><Star size={14} /></button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="muted ec-source">Sources: FRED®, Federal Reserve Bank of St. Louis{cotIds.length ? '; CFTC Commitments of Traders (large speculators’ net position, weekly)' : ''}. Not financial advice.</div>
    </div>
  );
}
