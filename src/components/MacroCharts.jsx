// Charts for the Macro series pages: a small area sparkline for cards and a full line chart with a hover readout,
// one or many series, rebased (index 100 / z-score / min-max) or on two axes.
import { useMemo, useState } from 'react';
import { useSize } from './ui';
import { MONTHS } from '../lib/stats';
import { fmtTick, fmtValue } from '../lib/fredSeries';

export const PALETTE = ['var(--primary)', '#e8a33d', '#3fb68b', '#e5484d', '#a78bfa', '#38bdf8', '#f472b6', '#facc15'];
const fmtDay = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${MONTHS[m - 1]} ${dd}, ${y}`; };

/** compact area sparkline; colour follows the direction over the window */
export function AreaSpark({ obs, w = 220, h = 46, up: upIsGood = true, className = '' }) {
  if (!obs || obs.length < 2) return <svg width="100%" height={h} className={`m-spark ${className}`} aria-hidden="true" />;
  const vals = obs.map((r) => r[1]);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const x = (i) => (i / (obs.length - 1)) * w, y = (v) => 3 + (1 - (v - lo) / span) * (h - 6);
  const pts = obs.map((r, i) => `${x(i).toFixed(1)},${y(r[1]).toFixed(1)}`).join(' ');
  const rising = vals[vals.length - 1] >= vals[0];
  const cls = rising === upIsGood ? 'good' : 'bad';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" width="100%" height={h} className={`m-spark ${cls} ${className}`} aria-hidden="true">
      <polygon points={`0,${h} ${pts} ${w},${h}`} className="fill" />
      <polyline points={pts} className="line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const z = (vals) => { const m = vals.reduce((s, v) => s + v, 0) / vals.length; const sd = Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / vals.length) || 1; return (v) => (v - m) / sd; };

/**
 * lines: [{ id, label, def, obs, color }]
 * mode: 'raw' (one axis, or two when 2 series and dual) · 'index' · 'z' · 'minmax'
 */
export function LineChart({ lines, mode = 'raw', height = 300, refLines = [], dual = false, zeroLine = false }) {
  const [ref, { w }] = useSize();
  const [hover, setHover] = useState(null);
  const padL = 58, padR = dual ? 58 : 14, padT = 12, padB = 26;
  const prepared = useMemo(() => lines.filter((l) => l.obs?.length > 1).map((l) => {
    const vals = l.obs.map((r) => r[1]);
    let f = (v) => v;
    if (mode === 'index') { const b = vals.find((v) => v !== 0) || 1; f = (v) => (v / b) * 100; }
    if (mode === 'z') f = z(vals);
    if (mode === 'minmax') { const lo = Math.min(...vals), hi = Math.max(...vals); f = (v) => (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50); }
    return { ...l, pts: l.obs.map(([d, v]) => [Date.parse(`${d}T00:00:00Z`), f(v), v, d]) };
  }), [lines, mode]);
  if (!prepared.length) return <div ref={ref} className="m-chart empty" style={{ height }}><span className="muted">No data in this range yet.</span></div>;
  const t0 = Math.min(...prepared.map((l) => l.pts[0][0])), t1 = Math.max(...prepared.map((l) => l.pts[l.pts.length - 1][0]));
  const twoAxes = dual && mode === 'raw' && prepared.length === 2;
  const axes = twoAxes ? [prepared.slice(0, 1), prepared.slice(1)] : [prepared];
  const scales = axes.map((group) => {
    const vs = group.flatMap((l) => l.pts.map((p) => p[1])).concat(twoAxes ? [] : refLines.map((r) => r.v));
    if (zeroLine && mode !== 'minmax') vs.push(0);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.05 || 1;
    lo -= pad; hi += pad;
    return { lo, hi };
  });
  const W = Math.max(10, w - padL - padR);
  const X = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * W;
  const Y = (v, k = 0) => padT + (1 - (v - scales[k].lo) / (scales[k].hi - scales[k].lo || 1)) * (height - padT - padB);
  const ticks = (k) => [0, 0.25, 0.5, 0.75, 1].map((p) => scales[k].lo + p * (scales[k].hi - scales[k].lo));
  const tickFmt = (k, v) => (mode === 'raw' ? fmtTick(axes[k][0].def, v) : mode === 'z' ? `${v.toFixed(1)}σ` : v.toFixed(0));
  // x labels: about one per 90px
  const nX = Math.max(2, Math.floor(W / 90));
  const spanDays = (t1 - t0) / 86400000;
  const xl = Array.from({ length: nX + 1 }, (_, i) => t0 + (i / nX) * (t1 - t0)).map((t) => { const d = new Date(t); return { t, s: spanDays > 1400 ? String(d.getUTCFullYear()) : `${MONTHS[d.getUTCMonth()]}${spanDays > 200 ? ` ’${String(d.getUTCFullYear()).slice(2)}` : ` ${d.getUTCDate()}`}` }; });
  const xls = xl.filter((x, i) => i === 0 || x.s !== xl[i - 1].s);
  const hoverT = hover != null ? t0 + ((hover - padL) / W) * (t1 - t0) : null;
  const near = (l) => { if (hoverT == null) return null; let best = l.pts[0]; for (const p of l.pts) { if (Math.abs(p[0] - hoverT) < Math.abs(best[0] - hoverT)) best = p; } return best; };
  const hv = prepared.map((l) => ({ l, p: near(l) }));
  const hvDate = hv[0]?.p?.[3];
  return (
    <div ref={ref} className="m-chart" onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={height} onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(padL, Math.min(w - padR, e.clientX - r.left))); }}>
          {ticks(0).map((t) => <g key={`a${t}`}><line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} className="grid" /><text x={padL - 8} y={Y(t) + 4} textAnchor="end" style={twoAxes ? { fill: prepared[0].color } : undefined}>{tickFmt(0, t)}</text></g>)}
          {twoAxes && ticks(1).map((t) => <text key={`b${t}`} x={w - padR + 8} y={Y(t, 1) + 4} style={{ fill: prepared[1].color }}>{tickFmt(1, t)}</text>)}
          {zeroLine && mode !== 'minmax' && scales[0].lo < 0 && scales[0].hi > 0 && <line x1={padL} x2={w - padR} y1={Y(0)} y2={Y(0)} className="zero" />}
          {!twoAxes && refLines.map((r) => <g key={r.label}><line x1={padL} x2={w - padR} y1={Y(r.v)} y2={Y(r.v)} className="ref" /><text x={w - padR - 4} y={Y(r.v) - 5} textAnchor="end" className="ref-t">{r.label}</text></g>)}
          {xls.map((x, i) => <text key={x.t} x={X(x.t)} y={height - 7} textAnchor={i === xls.length - 1 && xls.length > 1 ? 'end' : i === 0 ? 'start' : 'middle'}>{x.s}</text>)}
          {prepared.map((l, k) => <polyline key={l.id} className="ln" style={{ stroke: l.color }} points={l.pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1], twoAxes ? k : 0).toFixed(1)}`).join(' ')} />)}
          {hover != null && <line x1={hover} x2={hover} y1={padT} y2={height - padB} className="cursor" />}
          {hover != null && hv.map(({ l, p }, k) => p && <circle key={l.id} cx={X(p[0])} cy={Y(p[1], twoAxes ? k : 0)} r="3.5" style={{ fill: l.color }} />)}
        </svg>
      )}
      <div className="m-legend">
        {hvDate ? <b className="no-i18n">{fmtDay(hvDate)}</b> : null}
        {prepared.map((l) => {
          const p = hover != null ? hv.find((x) => x.l.id === l.id)?.p : l.pts[l.pts.length - 1];
          return (
            <span key={l.id}><i style={{ background: l.color }} />{l.label} <b>{fmtValue(l.def, p?.[2])}</b>{mode !== 'raw' && <small className="muted"> {mode === 'z' ? `${p?.[1]?.toFixed(2)}σ` : p?.[1]?.toFixed(1)}</small>}</span>
          );
        })}
      </div>
    </div>
  );
}
