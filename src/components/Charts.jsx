import { useId, useMemo, useState } from 'react';
import { useSize } from './ui';
import { useStore } from '../store/store';
import { fmtCompact, fmtMoney, currency } from '../lib/stats';

function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const raw = span / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/** Monotone cubic interpolation path (no overshoot). */
function smoothPath(pts) {
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
  const n = pts.length;
  const dx = [], dy = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0] || 1e-6; dy[i] = pts[i + 1][1] - pts[i][1]; m[i] = dy[i] / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${pts[i][0] + h},${pts[i][1] + h * t[i]} ${pts[i + 1][0] - h},${pts[i + 1][1] - h * t[i + 1]} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}
const linePath = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');

/**
 * Generic P&L chart. data: [{ label, y, tip? }]
 * mode: 'area' | 'line' | 'bar'
 */
/** P&L over time. `base` is the level the chart is measured from (0 for P&L; the starting balance for an
 *  equity curve): above it is green, below it red, and the axis fits the data around it. */
export function PnlChart({ data, mode = 'area', height = 300, smooth = false, compact = false, yFmt, xLabels = 8, padLeft = 56, showZero = true, startAtZero = true, dotted = true, base: base0 = 0 }) {
  const [ref, { w }] = useSize();
  const [hover, setHover] = useState(null);
  const { state } = useStore();
  const uidRaw = useId().replace(/:/g, '');
  const priv = state.settings.privacy;
  const width = Math.max(w, 50);
  const pl = compact ? 2 : padLeft, pr = compact ? 2 : 12, pt = compact ? 4 : 14, pb = compact ? 4 : 30;
  const rate = currency().rate; // plot in the display currency so axis ticks are round numbers
  const base = base0 * rate;
  const series = useMemo(() => {
    const conv = rate === 1 ? data : data.map((d) => ({ ...d, y: d.y * rate }));
    return startAtZero && mode !== 'bar' && conv.length ? [{ label: conv[0].label, y: base, start: true }, ...conv] : conv;
  }, [data, startAtZero, mode, rate, base]);
  const ys = series.map((d) => d.y);
  const ticks = niceTicks(Math.min(base, ...ys), Math.max(base, ...ys), compact ? 3 : 5);
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const H = height;
  const sy = (v) => pt + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - pt - pb);
  const n = series.length;
  const bw = mode === 'bar' ? (width - pl - pr) / Math.max(n, 1) : 0;
  const sx = (i) => (mode === 'bar' ? pl + bw * i + bw / 2 : pl + (n <= 1 ? 0 : (i / (n - 1)) * (width - pl - pr)));
  const pts = series.map((d, i) => [sx(i), sy(d.y)]);
  const zy = sy(base);
  const path = smooth ? smoothPath(pts) : linePath(pts);
  const area = n ? `${path}L${pts[n - 1][0]},${zy}L${pts[0][0]},${zy}Z` : '';
  // short labels ($51k) unless that would make two ticks look the same, e.g. on a balance chart ($50,500)
  const short = ticks.map((t) => fmtCompact(t, { raw: true }));
  const fullTicks = new Set(short).size < short.length;
  const fmt = yFmt || ((v) => (priv ? '•••' : fullTicks ? fmtMoney(v, { dp: 0, raw: true }) : fmtCompact(v, { raw: true })));
  const idxs = n <= xLabels ? series.map((_, i) => i) : Array.from({ length: xLabels }, (_, k) => Math.round((k / (xLabels - 1)) * (n - 1)));
  const uniq = [];
  let lastX = -1e9, lastL = null;
  for (const i of [...new Set(idxs)]) {
    if (!series[i] || series[i].start) continue;
    const x = sx(i);
    if (x - lastX < (compact ? 0 : Math.max(60, String(series[i].label).length * 6.4 + 14)) || series[i].label === lastL) continue;
    uniq.push(i); lastX = x; lastL = series[i].label;
  }
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(p[0] - x); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  };
  const g = `g${uidRaw}`;
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height: H }}>
      {w > 0 && (
        <svg width={width} height={H} onMouseMove={compact ? undefined : onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block', overflow: 'visible' }}>
          <defs>
            <clipPath id={`${g}up`}><rect x={0} y={0} width={width} height={Math.max(0, zy)} /></clipPath>
            <clipPath id={`${g}dn`}><rect x={0} y={zy} width={width} height={Math.max(0, H - zy)} /></clipPath>
            <linearGradient id={`${g}fu`} x1="0" y1={pt} x2="0" y2={zy} gradientUnits="userSpaceOnUse">
              <stop offset="0" style={{ stopColor: 'var(--pos-strong)' }} stopOpacity="0.35" />
              <stop offset="1" style={{ stopColor: 'var(--pos-strong)' }} stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id={`${g}fd`} x1="0" y1={zy} x2="0" y2={H - pb} gradientUnits="userSpaceOnUse">
              <stop offset="0" style={{ stopColor: 'var(--neg)' }} stopOpacity="0.02" />
              <stop offset="1" style={{ stopColor: 'var(--neg)' }} stopOpacity="0.3" />
            </linearGradient>
            <pattern id={`${g}dots`} width="5" height="5" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.7" fill="var(--grid-dot)" />
            </pattern>
          </defs>
          {!compact && (
            <g className="axis">
              {ticks.map((t) => (
                <g key={t}>
                  <text x={pl - 14} y={sy(t) + 3.5} textAnchor="end">{fmt(t)}</text>
                </g>
              ))}
              {uniq.map((i) => (
                <text key={i} x={Math.min(Math.max(sx(i), pl + 24), width - pr - String(series[i].label).length * 3.3)} y={H - 8} textAnchor="middle">{series[i].label}</text>
              ))}
            </g>
          )}
          {!compact && dotted && <rect x={pl} y={pt} width={width - pl - pr} height={H - pt - pb} fill={`url(#${g}dots)`} />}
          {showZero && !compact && <line x1={pl} x2={width - pr} y1={zy} y2={zy} stroke="var(--border-2)" strokeDasharray="2 4" />}
          {mode === 'bar' ? (
            series.map((d, i) => {
              const y0 = Math.min(zy, sy(d.y));
              const h = Math.max(1, Math.abs(sy(d.y) - zy));
              return <rect key={i} x={sx(i) - Math.min(bw * 0.32, 18)} width={Math.min(bw * 0.64, 36)} y={y0} height={h} rx={1.5} style={{ fill: d.y >= 0 ? 'var(--pos-strong)' : 'var(--neg)' }} opacity={hover === null || hover === i ? 1 : 0.55} />;
            })
          ) : (
            <>
              {mode === 'area' && (
                <>
                  <path d={area} fill={`url(#${g}fu)`} clipPath={`url(#${g}up)`} />
                  <path d={area} fill={`url(#${g}fd)`} clipPath={`url(#${g}dn)`} />
                </>
              )}
              <path d={path} fill="none" style={{ stroke: 'var(--pos)' }} strokeWidth={compact ? 1.4 : 1.6} clipPath={`url(#${g}up)`} strokeLinejoin="round" />
              <path d={path} fill="none" style={{ stroke: 'var(--neg)' }} strokeWidth={compact ? 1.4 : 1.6} clipPath={`url(#${g}dn)`} strokeLinejoin="round" />
            </>
          )}
          {hover !== null && !compact && (
            <>
              <line x1={pts[hover][0]} x2={pts[hover][0]} y1={pt} y2={H - pb} stroke="var(--muted-2)" strokeDasharray="3 3" />
              {mode !== 'bar' && <circle cx={pts[hover][0]} cy={pts[hover][1]} r={4} style={{ fill: series[hover].y >= base ? 'var(--pos)' : 'var(--neg)' }} stroke="var(--bg)" strokeWidth={2} />}
            </>
          )}
        </svg>
      )}
      {hover !== null && !compact && series[hover] && (
        <div className="chart-tip" style={{ left: pts[hover][0], top: pts[hover][1] }}>
          <div className="muted" style={{ marginBottom: 2 }}>{series[hover].tip || series[hover].label}</div>
          {base ? (
            <div style={{ filter: priv ? 'blur(5px)' : undefined }}>
              <b style={{ fontWeight: 600 }}>{fmtMoney(series[hover].y, { raw: true })}</b>
              <span className={series[hover].y >= base ? 'pos' : 'neg'} style={{ marginLeft: 8 }}>{fmtMoney(series[hover].y - base, { sign: true, raw: true })}</span>
            </div>
          ) : <b className={series[hover].y >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 600, filter: priv ? 'blur(5px)' : undefined }}>{fmtMoney(series[hover].y, { sign: true, raw: true })}</b>}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, width = 110, height = 70 }) {
  const data = values.map((y, i) => ({ label: String(i), y }));
  return (
    <div style={{ width, height }} className="spark">
      <PnlChart data={data} mode="line" height={height} compact startAtZero={false} />
    </div>
  );
}

/** Semi-circular gauge for profit factor (0 → 3+). */
export function Gauge({ value, max = 3, size = 190 }) {
  const id = useId().replace(/:/g, '');
  const r = size / 2 - 10;
  const cx = size / 2, cy = size / 2;
  const v = Math.max(0, Math.min(value === Infinity ? max : value, max)) / max;
  const a = Math.PI * (1 - v);
  const kx = cx + r * Math.cos(a), ky = cy - r * Math.sin(a);
  return (
    <svg width={size} height={size / 2 + 14} viewBox={`0 0 ${size} ${size / 2 + 14}`}>
      <defs>
        <linearGradient id={`gg${id}`} x1="0" x2="1">
          <stop offset="0" style={{ stopColor: 'var(--neg-strong)' }} />
          <stop offset="0.45" style={{ stopColor: 'var(--warn)' }} />
          <stop offset="1" style={{ stopColor: 'var(--pos-strong)' }} />
        </linearGradient>
      </defs>
      <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`} fill="none" stroke={`url(#gg${id})`} strokeWidth={6} strokeLinecap="round" />
      <circle cx={kx} cy={ky} r={7} fill="#fff" stroke="rgba(0,0,0,0.25)" strokeWidth={1} />
    </svg>
  );
}

/** Horizontal win-rate slider bar. */
export function RateBar({ pct, width = '100%' }) {
  return (
    <div style={{ position: 'relative', width, height: 14, display: 'flex', alignItems: 'center' }}>
      <div style={{ height: 3, width: '100%', borderRadius: 3, background: 'linear-gradient(90deg,var(--neg-strong),var(--warn) 50%,var(--pos-strong))' }} />
      <div style={{ position: 'absolute', left: `calc(${Math.min(100, Math.max(0, pct))}% - 7px)`, width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.25)' }} />
    </div>
  );
}

/** Horizontal labeled bars (weekday / hour / symbol breakdowns). */
/** Horizontal bars. Money by default (diverging around zero); pass `fmt` for other numbers and
 *  `mid` to colour against a midpoint (e.g. 50 for a win rate) with bars growing from the left. */
export function HBars({ rows, fmt, mid, oneSided = false }) {
  const { state } = useStore();
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const money = !fmt;
  const tone = (v) => (mid !== undefined ? (v >= mid ? 'pos' : 'neg') : v >= 0 ? 'pos' : 'neg');
  return (
    <div className="col gap8">
      {rows.map((r) => (
        <div key={r.label} className="row gap12" style={{ fontSize: 13 }}>
          <div style={{ width: 86 }} className="muted truncate" title={r.label}>{r.label}</div>
          {oneSided ? (
            <div className="grow" style={{ position: 'relative', height: 18 }}>
              <div style={{ width: `${(Math.abs(r.value) / max) * 100}%`, height: '100%', background: tone(r.value) === 'pos' ? 'var(--pos-strong)' : 'var(--neg)', opacity: tone(r.value) === 'pos' ? 1 : 0.85, borderRadius: 2 }} />
            </div>
          ) : (
            <div className="grow" style={{ position: 'relative', height: 18, display: 'flex' }}>
              <div style={{ width: '50%', display: 'flex', justifyContent: 'flex-end' }}>
                {r.value < 0 && <div style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: 'var(--neg)', opacity: 0.85, borderRadius: 2 }} />}
              </div>
              <div style={{ width: 1, background: 'var(--border-2)' }} />
              <div style={{ width: '50%' }}>
                {r.value > 0 && <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: 'var(--pos-strong)', borderRadius: 2 }} />}
              </div>
            </div>
          )}
          <div style={{ width: 92, textAlign: 'right' }} className={`${mid === null ? '' : tone(r.value)} ${money && state.settings.privacy ? 'hidden-val' : ''}`}>{money ? fmtMoney(r.value, { sign: true }) : fmt(r.value)}</div>
          {r.extra !== undefined && <div style={{ width: 70, textAlign: 'right' }} className="muted">{r.extra}</div>}
        </div>
      ))}
    </div>
  );
}

/** Horizontal scale with threshold ticks and a marker at `value` (clamped to the range). */
export function MarkerScale({ value, min = 0, max = 1, marks = [] }) {
  const pct = (v) => ((Math.min(max, Math.max(min, v === Infinity ? max : v === -Infinity ? min : v)) - min) / (max - min)) * 100;
  const base = pct(Math.max(min, 0)), at = pct(value || 0);
  const lo = Math.min(base, at), hi = Math.max(base, at);
  return (
    <div className="mscale">
      <div className="mscale-track">
        {min < 0 && <span className="mscale-zero" style={{ left: `${base}%` }} />}
        <span className="mscale-fill" style={{ left: `${lo}%`, width: `${hi - lo}%`, background: value < 0 ? 'var(--neg)' : undefined }} />
        {marks.map((m) => <span key={m.v} className="mscale-mark" style={{ left: `${pct(m.v)}%`, background: m.color }} title={m.label} />)}
        <span className="mscale-dot" style={{ left: `${at}%` }} />
      </div>
      <div className="mscale-labels">
        {marks.map((m) => <span key={m.v} style={{ left: `${pct(m.v)}%`, color: m.color }}>{m.label}</span>)}
      </div>
    </div>
  );
}
