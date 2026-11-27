// Macro → GEX: dealer gamma positioning for the indices — call wall, put wall, gamma flip, GEX by strike, vanna and
// charm — with every level converted to the futures you trade (ES, NQ, RTY). Data: gex.js on the journal's server.
import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Settings2, Info, Sparkles, TriangleExclamationPoint as TriangleAlert, Check } from 'lucide-react';
import MacroSwitch from '../components/MacroSwitch';
import { Popover, Switch, useSize } from '../components/ui';
import { useStore } from '../store/store';
import { useMacro } from '../lib/macro';
import { Markdown } from './Coach';
import { chat, providerConfig, PROVIDERS } from '../lib/ai';
import { IS_DEMO } from '../lib/demoMode';

const SYMBOLS = [
  { key: 'SPX', fut: 'ES' }, { key: 'NDX', fut: 'NQ' }, { key: 'RUT', fut: 'RTY' },
  { key: 'SPY', fut: 'ES' }, { key: 'QQQ', fut: 'NQ' }, { key: 'IWM', fut: 'RTY' },
];
const SOURCES = [
  { id: 'cboe', label: 'Cboe (free)', desc: 'About 15 minutes delayed · no key needed' },
  { id: 'polygon', label: 'Polygon', desc: 'Real time · your Polygon key (needs an options plan)' },
  { id: 'tradier', label: 'Tradier', desc: 'Real time · a free Tradier brokerage account’s API token' },
];

export const fmtUsd = (v, sign = true) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '-' : sign && v > 0 ? '+' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
};
const fmtPx = (v, dp) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: dp ?? (v < 1000 ? 2 : 2), maximumFractionDigits: dp ?? 2 }));
const q4 = (v) => Math.round(v * 4) / 4;
const dayLabel = (d) => { const x = new Date(`${d}T12:00:00Z`); return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); };
const dte = (d) => Math.max(0, Math.round((Date.parse(`${d}T21:00:00Z`) - Date.now()) / 864e5));

// ---------------------------------------------------------------- charts
/** GEX by strike: call (up) and put (down) bars, net cumulative and aggregate lines, the levels marked. Wheel = zoom, drag = pan. */
function GexChart({ data, ratio, fut, show }) {
  const [ref, size] = useSize();
  const W = Math.max(320, size.w || 900), H = 390, padL = 64, padR = 16, padT = 40, padB = 34;
  const spot = data.spot;
  const [win, setWin] = useState(null);
  const drag = useRef(null);
  const [hover, setHover] = useState(null);
  useEffect(() => { setWin(null); }, [data.symbol, data.exps?.join()]);
  const span = win || [spot * 0.97, spot * 1.03];
  const strikes = data.strikes.filter((s) => s.strike >= span[0] && s.strike <= span[1]);
  const x = (k) => padL + ((k - span[0]) / (span[1] - span[0])) * (W - padL - padR);
  const mid = padT + (H - padT - padB) / 2, half = (H - padT - padB) / 2 - 4;
  const maxBar = Math.max(1, ...strikes.map((s) => (show.netOnly ? Math.abs(s.net) : Math.max(s.call, -s.put))));
  const y = (v) => mid - (v / maxBar) * half;
  const step = strikes.length > 1 ? Math.min(...strikes.slice(1).map((s, i) => s.strike - strikes[i].strike).filter((d) => d > 0)) : 5;
  const bw = Math.max(1, Math.min(18, (x(span[0] + step) - x(span[0])) * (show.netOnly ? 0.8 : 0.42)));
  const line = (pts, key) => {
    const vals = pts.map((p) => p[key]);
    const m = Math.max(1, ...vals.map(Math.abs));
    return pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.k).toFixed(1)},${(mid - (p[key] / m) * half).toFixed(1)}`).join('');
  };
  const cumPath = show.net && strikes.length > 1 ? line(strikes.map((s) => ({ k: s.strike, v: s.cum })), 'v') : '';
  const prof = (data.profile || []).filter((p) => p.price >= span[0] && p.price <= span[1]);
  const aggPath = show.agg && prof.length > 1 ? line(prof.map((p) => ({ k: p.price, v: p.gex })), 'v') : '';
  const ticks = useMemo(() => {
    const n = Math.max(3, Math.floor((W - padL - padR) / 90));
    const raw = (span[1] - span[0]) / n, mag = 10 ** Math.floor(Math.log10(raw));
    const st = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw) || raw;
    const out = [];
    for (let v = Math.ceil(span[0] / st) * st; v <= span[1]; v += st) out.push(v);
    return out;
  }, [span[0], span[1], W]);
  const toK = (clientX, el) => { const r = el.getBoundingClientRect(); return span[0] + ((clientX - r.left - padL) / (W - padL - padR)) * (span[1] - span[0]); };
  const onWheel = (e) => {
    e.preventDefault();
    const k = toK(e.clientX, e.currentTarget), f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const lo = k - (k - span[0]) * f, hi = k + (span[1] - k) * f;
    if (hi - lo < spot * 0.004 || hi - lo > spot * 0.5) return;
    setWin([lo, hi]);
  };
  useEffect(() => { // passive: false, so the page doesn't scroll while zooming
    const el = ref.current?.querySelector('svg');
    if (!el) return undefined;
    const h = (e) => onWheel(e);
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  });
  const onMove = (e) => {
    const k = toK(e.clientX, e.currentTarget);
    if (drag.current) { const d = drag.current.k - k; setWin([drag.current.span[0] + d, drag.current.span[1] + d]); return; }
    const near = strikes.reduce((a, s) => (a == null || Math.abs(s.strike - k) < Math.abs(a.strike - k) ? s : a), null);
    setHover(near);
  };
  // labels on two rows when two levels sit close together
  const marks = [[data.putWall, 'put', 'Put wall'], [data.callWall, 'call', 'Call wall'], [data.flip, 'flip', 'Flip'], [data.implied?.spot || spot, 'spot', data.implied ? 'Price now' : 'Price']]
    .filter(([v]) => v != null && v >= span[0] && v <= span[1]).sort((a, b) => a[0] - b[0]);
  let lastX = -1e9, row = 0;
  const marked = marks.map(([v, cls, label]) => { const px = x(v); row = px - lastX < 70 ? 1 - row : 0; lastX = px; return { v, cls, label, row }; });
  const mark = ({ v, cls, label, row: r }) => (
    <g key={cls} className={`gx-mark ${cls}`}>
      <line x1={x(v)} x2={x(v)} y1={padT - 8 - r * 14} y2={H - padB} />
      <text x={x(v)} y={padT - 12 - r * 14} textAnchor="middle">{label}</text>
    </g>
  );
  const fp = (v) => (ratio ? ` · ${fut} ${fmtPx(q4(v * ratio))}` : '');
  return (
    <div className="gx-chart" ref={ref}>
      <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => { setHover(null); drag.current = null; }}
        onMouseDown={(e) => { drag.current = { k: toK(e.clientX, e.currentTarget), span }; }} onMouseUp={() => { drag.current = null; }} onDoubleClick={() => setWin(null)}>
        <line className="gx-zero" x1={padL} x2={W - padR} y1={mid} y2={mid} />
        {[1, -1].map((s) => <text key={s} className="gx-axis" x={padL - 8} y={y(s * maxBar) + 4} textAnchor="end">{fmtUsd(s * maxBar)}</text>)}
        <text className="gx-axis" x={padL - 8} y={mid + 4} textAnchor="end">0</text>
        {ticks.map((t) => <text key={t} className="gx-axis" x={x(t)} y={H - padB + 18} textAnchor="middle">{fmtPx(t, 0)}</text>)}
        {strikes.map((s) => show.netOnly ? (
          <rect key={s.strike} className={s.net >= 0 ? 'gx-call' : 'gx-put'} x={x(s.strike) - bw / 2} width={bw} y={Math.min(y(s.net), mid)} height={Math.max(0.5, Math.abs(y(s.net) - mid))} />
        ) : (
          <g key={s.strike}>
            <rect className="gx-call" x={x(s.strike) - bw} width={bw} y={y(s.call)} height={Math.max(0.5, mid - y(s.call))} />
            <rect className="gx-put" x={x(s.strike)} width={bw} y={mid} height={Math.max(0.5, y(s.put) - mid)} />
          </g>
        ))}
        {cumPath && <path className="gx-cum" d={cumPath} />}
        {aggPath && <path className="gx-agg" d={aggPath} />}
        {marked.map(mark)}
        {hover && <line className="gx-hover" x1={x(hover.strike)} x2={x(hover.strike)} y1={padT} y2={H - padB} />}
      </svg>
      {hover && (
        <div className="gx-tip" style={{ left: Math.min(W - 230, Math.max(0, x(hover.strike) + 12)) }}>
          <b className="no-i18n">{fmtPx(hover.strike, hover.strike % 1 ? 2 : 0)}{fp(hover.strike)}</b>
          <div><span className="pos">Call GEX</span> {fmtUsd(hover.call)} <span className="muted">· OI {hover.callOi.toLocaleString()}</span></div>
          <div><span className="neg">Put GEX</span> {fmtUsd(hover.put)} <span className="muted">· OI {hover.putOi.toLocaleString()}</span></div>
          <div>Net {fmtUsd(hover.net)}</div>
        </div>
      )}
    </div>
  );
}

/** Vanna or charm by strike (bars), the price marked. */
function ExpoChart({ block, k, spot, title, unit }) {
  const [ref, size] = useSize();
  const [hover, setHover] = useState(null);
  const W = Math.max(280, size.w || 420), H = 190, padL = 56, padR = 10, padT = 10, padB = 24;
  const list = (block?.strikes || []).filter((s) => Math.abs(s.strike / spot - 1) <= 0.08);
  if (!list.length) return <div className="gx-mini card card-pad" ref={ref}><div className="gx-mini-h">{title}</div><div className="muted" style={{ fontSize: 13, padding: '30px 0', textAlign: 'center' }}>No options in this range.</div></div>;
  const lo = list[0].strike, hi = list[list.length - 1].strike;
  const x = (v) => padL + ((v - lo) / (hi - lo || 1)) * (W - padL - padR);
  const m = Math.max(1, ...list.map((s) => Math.abs(s[k])));
  const mid = padT + (H - padT - padB) / 2, half = (H - padT - padB) / 2 - 2;
  const y = (v) => mid - (v / m) * half;
  const bw = Math.max(1, Math.min(10, (W - padL - padR) / list.length * 0.7));
  const total = block[k];
  return (
    <div className="gx-mini card card-pad" ref={ref}>
      <div className="gx-mini-h"><span>{title}</span><span className={total >= 0 ? 'pos' : 'neg'}>{fmtUsd(total)} <span className="muted">{unit}</span></span></div>
      <svg width={W} height={H} onMouseLeave={() => setHover(null)} onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const v = lo + ((e.clientX - r.left - padL) / (W - padL - padR)) * (hi - lo); setHover(list.reduce((a, s) => (a == null || Math.abs(s.strike - v) < Math.abs(a.strike - v) ? s : a), null)); }}>
        <line className="gx-zero" x1={padL} x2={W - padR} y1={mid} y2={mid} />
        <text className="gx-axis" x={padL - 6} y={y(m) + 4} textAnchor="end">{fmtUsd(m)}</text>
        <text className="gx-axis" x={padL - 6} y={y(-m) + 4} textAnchor="end">{fmtUsd(-m)}</text>
        {list.map((s) => <rect key={s.strike} className={s[k] >= 0 ? 'gx-call' : 'gx-put'} x={x(s.strike) - bw / 2} width={bw} y={Math.min(y(s[k]), mid)} height={Math.max(0.5, Math.abs(y(s[k]) - mid))} />)}
        {spot >= lo && spot <= hi && <g className="gx-mark spot"><line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} /></g>}
        <text className="gx-axis" x={padL} y={H - 6}>{fmtPx(lo, 0)}</text>
        <text className="gx-axis" x={W - padR} y={H - 6} textAnchor="end">{fmtPx(hi, 0)}</text>
        {hover && <text className="gx-axis gx-hv" x={Math.min(W - 120, Math.max(padL, x(hover.strike)))} y={padT + 10}>{fmtPx(hover.strike, 0)}: {fmtUsd(hover[k])}</text>}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------- summary
function facts(d, ratio, fut) {
  const f = (v) => (v == null ? 'n/a' : `${fmtPx(v)}${ratio ? ` (${fut} ${fmtPx(q4(v * ratio))})` : ''}`);
  return [
    `Index: ${d.symbol}, price ${f(d.spot)}, data ${d.delayed ? 'about 15 minutes delayed (Cboe)' : `real time (${d.source})`}.`,
    `Expirations: ${d.exps.join(', ')}.`,
    `Total GEX: ${fmtUsd(d.total)} per 1% move. Gamma zone at the price: ${d.zone}.`,
    `Call wall: ${f(d.callWall)}. Put wall: ${f(d.putWall)}. Gamma flip: ${f(d.flip)}.`,
    d.near && `Near-term (0–45 days) vanna ${fmtUsd(d.near.vanna)} per vol point, charm ${fmtUsd(d.near.charm)} per day; biggest positive vanna at ${f(d.near.maxVanna)}, most negative at ${f(d.near.minVanna)}.`,
    d.regime && d.regime.strikes.length && `Longer-term (46–180 days) vanna ${fmtUsd(d.regime.vanna)}, charm ${fmtUsd(d.regime.charm)}.`,
  ].filter(Boolean).join('\n');
}
function localSummary(d, ratio, fut) {
  const f = (v) => (v == null ? '—' : `**${fmtPx(v, 0)}**${ratio ? ` (${fut} ${fmtPx(q4(v * ratio))})` : ''}`);
  const pos = d.zone === 'positive';
  const out = [
    pos ? `- **Positive gamma**: dealers hedge against the move — they sell rallies and buy dips — which tends to calm price and favor mean reversion.`
      : `- **Negative gamma**: dealers hedge with the move — selling into drops, buying into rallies — which tends to speed price up and favor trends.`,
    d.flip != null && `- The **gamma flip** is at ${f(d.flip)}. ${d.spot > d.flip ? 'Price is above it; falling below it would switch dealers to amplifying moves.' : 'Price is below it; reclaiming it would switch dealers to dampening moves.'}`,
    d.callWall != null && `- **Call wall** ${f(d.callWall)}: the most call gamma — often acts as resistance or a magnet into expiration.`,
    d.putWall != null && `- **Put wall** ${f(d.putWall)}: the most put gamma — often support; a break below can accelerate.`,
    d.near && `- Near-term charm is ${d.near.charm >= 0 ? 'positive: as time passes dealers tend to buy back hedges (a tailwind into the close)' : 'negative: as time passes dealers tend to sell hedges (a headwind into the close)'}.`,
    `- Open interest updates once a day, so these levels reflect this morning’s positions.`,
  ];
  return out.filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- settings
function SourceSettings({ cfg, onSaved }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async (patch) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/macro/gex/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Couldn’t save');
      onSaved(j);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  if (IS_DEMO) return <div className="gx-set muted">In the demo, GEX uses sample data. In your own RoninFlow it comes from Cboe (free) or, in real time, Polygon or Tradier.</div>;
  if (!cfg) return <div className="gx-set muted">Loading…</div>;
  return (
    <div className="gx-set">
      <div className="gx-set-h">Data source</div>
      {SOURCES.map((s) => (
        <button key={s.id} className={`pop-item gx-src ${cfg.source === s.id ? 'on' : ''}`} disabled={busy} onClick={() => save({ source: s.id })}>
          <span className="grow"><b>{s.label}</b><small>{s.desc}{s.id !== 'cboe' && !cfg.sources?.[s.id] ? ' — not set up yet' : ''}</small></span>
          {cfg.source === s.id && <Check size={14} />}
        </button>
      ))}
      {cfg.source === 'polygon' && !cfg.sources?.polygon && <div className="gx-set-note">Add your Polygon key in <b>Settings → Price data</b>. GEX needs a plan that includes options (and indices for SPX/NDX).</div>}
      {cfg.source === 'tradier' && (
        <div className="gx-set-note">
          <div className="row gap6">
            <input className="input grow" type="password" placeholder={cfg.sources?.tradier ? 'Token saved — paste a new one to replace it' : 'Tradier API access token'} value={token} onChange={(e) => setToken(e.target.value)} />
            <button className="btn sm primary" disabled={busy || !token.trim()} onClick={() => save({ tradierKey: token }).then(() => setToken(''))}>Save</button>
          </div>
          <label className="row gap8" style={{ marginTop: 8 }}><Switch on={cfg.tradierSandbox} onChange={(v) => save({ tradierSandbox: v })} /> <span>Sandbox token (delayed data)</span></label>
          <div className="muted" style={{ marginTop: 6 }}>Open a free account at tradier.com, then copy the token from <b>Settings → API Access</b>. It’s kept encrypted on this computer.</div>
        </div>
      )}
      <div className="gx-set-h" style={{ marginTop: 10 }}>For your charts</div>
      <label className="row gap8 gx-set-row"><Switch on={cfg.autoSave} onChange={(v) => save({ autoSave: v })} /> <span>Save levels during market hours (every 15 min)</span></label>
      <div className="row gap6 wrap" style={{ marginTop: 6 }}>
        {['SPX', 'NDX', 'RUT'].map((s) => {
          const on = cfg.symbols?.includes(s);
          return <button key={s} className={`chip ${on ? 'on' : ''}`} disabled={busy || !cfg.autoSave} onClick={() => save({ symbols: on ? cfg.symbols.filter((x) => x !== s) : [...(cfg.symbols || []), s] })}>{s}</button>;
        })}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>The “GEX levels” indicator on ES, NQ and RTY charts draws these, replays too.</div>
      {err && <div className="neg" style={{ marginTop: 6, fontSize: 12.5 }}>{err}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- page
export default function Gex() {
  const { state, setSetting } = useStore();
  const s = state.settings;
  const symbol = s.gexSymbol || 'SPX';
  const [custom, setCustom] = useState('');
  const [exps, setExps] = useState([]);
  const [show, setShow] = useState({ agg: true, net: true, netOnly: false });
  const [help, setHelp] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [summary, setSummary] = useState(null);
  const [sumBusy, setSumBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = `/api/macro/gex?symbol=${symbol}${exps.length ? `&exp=${exps.join(',')}` : ''}`;
  const { data, error, loading, reload } = useMacro(url, { poll: 60e3 });
  useEffect(() => { if (!IS_DEMO) fetch('/api/macro/gex/config').then((r) => r.json()).then(setCfg).catch(() => {}); }, []);
  useEffect(() => { setExps([]); setSummary(null); }, [symbol]);
  useEffect(() => { setSummary(null); }, [exps.join()]);

  const futRoot = SYMBOLS.find((x) => x.key === symbol)?.fut;
  const manual = s.gexFut?.[symbol];
  const ratio = data?.fut?.ratio || (manual?.ratio > 0 ? manual.ratio : null);
  const fut = data?.fut?.fut || futRoot;
  const F = (v) => (ratio && v != null ? fmtPx(q4(v * ratio)) : null);
  const list = data?.expirations || [];
  const chosen = data?.exps || [];
  const pick = (d) => setExps((cur) => { const base = cur.length ? cur : chosen; const next = base.includes(d) ? base.filter((x) => x !== d) : [...base, d].sort(); return next.length ? next.slice(0, 12) : []; });
  const quick = [
    { label: 'Nearest', get: () => list.slice(0, 1) },
    { label: 'This week', get: () => { const fri = new Date(); fri.setDate(fri.getDate() + ((5 - fri.getDay() + 7) % 7)); const k = fri.toLocaleDateString('en-CA'); return list.filter((d) => d <= k).slice(0, 12); } },
    { label: '≤ 30 days', get: () => list.filter((d) => dte(d) <= 30).slice(0, 12) },
  ];
  const refresh = async () => { setBusy(true); try { await reload(true); } finally { setBusy(false); } };
  const summarize = async () => {
    if (!data) return;
    const coach = s.coach || {};
    const provider = coach.provider || 'local';
    setSumBusy(true);
    try {
      if (provider === 'local' || IS_DEMO) { setSummary({ text: localSummary(data, ratio, fut), by: 'local' }); return; }
      const text = await chat(provider, providerConfig(coach, provider), {
        system: 'You explain options dealer positioning (gamma exposure) to a futures day trader in plain English. Use 4–6 short bullet points in Markdown: the gamma regime and what it means for how price may behave today, the key levels (give the futures prices when provided) and what tends to happen at them, and anything notable in vanna or charm. Be concrete and brief. No trade recommendations, no disclaimers beyond one short line that open interest updates once a day.',
        question: `Summarize this GEX snapshot:\n${facts(data, ratio, fut)}`, thinking: 'off', maxTokens: 700,
      });
      setSummary({ text: text?.trim() || localSummary(data, ratio, fut), by: text?.trim() ? provider : 'local' });
    } catch (e) {
      setSummary({ text: localSummary(data, ratio, fut), by: 'local', err: `${PROVIDERS[provider]?.label || 'The AI provider'} didn’t answer (${e.message}) — here’s the built-in summary.` });
    } finally { setSumBusy(false); }
  };

  const Kpi = ({ label, v, sub, cls = '', title }) => (
    <div className={`card gx-kpi ${cls}`} title={title}>
      <span className="muted">{label}</span>
      <b className="no-i18n">{v}</b>
      {sub && <small className="no-i18n">{sub}</small>}
    </div>
  );

  return (
    <div className="page gx-page">
      <div className="row gap12 wrap" style={{ alignItems: 'flex-end', marginBottom: 14 }}>
        <div className="grow">
          <MacroSwitch current="gex" />
          <div className="muted" style={{ fontSize: 13.5 }}>
            Where options dealers have to buy and sell — gamma walls, the gamma flip, vanna and charm — in your futures’ prices.
          </div>
        </div>
        <button className="btn sm" onClick={() => setHelp((x) => !x)}><Info size={14} /> How to read it</button>
      </div>

      {help && (
        <div className="card card-pad cot-help">
          <p><b>Gamma exposure (GEX)</b> estimates how much options dealers must buy or sell as price moves to stay hedged. The usual assumption: dealers are long the calls customers sell them and short the puts customers buy.</p>
          <p><b className="pos">Positive gamma</b> (price above the flip): dealers sell rallies and buy dips, which tends to dampen moves. <b className="neg">Negative gamma</b> (below the flip): they sell drops and buy rips, which tends to amplify moves.</p>
          <p><b>Call wall</b> = the strike with the most call gamma (often resistance or a magnet). <b>Put wall</b> = the most put gamma (often support). <b>Gamma flip</b> = where total GEX, recomputed as if price were there, changes sign.</p>
          <p><b>Vanna</b> is how dealers’ hedges change when implied volatility moves (falling volatility after a selloff often fuels a bounce); <b>charm</b> is how they change as time passes, which matters into the close and expiration.</p>
          <p className="muted">Open interest is published once a day, so intraday levels use this morning’s positions. The bars and lines on the chart: green = call GEX, red = put GEX, yellow = net GEX added up from the lowest strike, purple = total GEX if price were at each level (where it crosses zero is the flip).</p>
        </div>
      )}

      <div className="toolbar gx-bar">
        <div className="row gap6 wrap">
          {SYMBOLS.map((x) => <button key={x.key} className={`chip ${symbol === x.key ? 'on' : ''}`} onClick={() => setSetting('gexSymbol', x.key)}>{x.key}</button>)}
          <form className="gx-custom" onSubmit={(e) => { e.preventDefault(); const v = custom.trim().toUpperCase().replace(/^\$|^\^/, ''); if (/^[A-Z]{1,6}$/.test(v)) { setSetting('gexSymbol', v); setCustom(''); } }}>
            <input className="input" placeholder="Other…" value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={7} />
          </form>
        </div>
        <div className="grow" />
        {data && <span className={`badge ${data.delayed ? 'neutral' : 'pos-soft'}`} title={data.at ? `Data as of ${new Date(data.at).toLocaleTimeString()}` : ''}>{data.sample ? 'Sample data (demo)' : data.delayed ? 'Cboe · ~15 min delayed' : `${data.source === 'polygon' ? 'Polygon' : 'Tradier'} · real time`}{data.at ? ` · ${new Date(data.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</span>}
        {data?.waiting && <span className="badge warn-soft" title="Cboe’s newest file has no volatility or Greeks yet (normal for the first minutes after the open). These are the last complete numbers; they update by themselves once Cboe fills them in.">Waiting for Cboe’s opening Greeks</span>}
        <Popover width={340} align="right" trigger={({ toggle }) => <button className="icon-btn" onClick={toggle} title="Data source"><Settings2 size={16} /></button>}>
          {() => <SourceSettings cfg={cfg} onSaved={(c) => { setCfg(c); reload(true); }} />}
        </Popover>
        <button className="icon-btn" onClick={refresh} disabled={busy} title="Refresh"><RefreshCw size={16} className={busy ? 'spin' : ''} /></button>
      </div>

      {list.length > 0 && (
        <div className="gx-exps">
          <span className="muted">Expirations</span>
          {quick.map((qk) => <button key={qk.label} className="chip sm" onClick={() => setExps(qk.get())}>{qk.label}</button>)}
          <span className="gx-sep" />
          {list.slice(0, 14).map((d) => <button key={d} className={`chip sm ${chosen.includes(d) ? 'on' : ''}`} onClick={() => pick(d)} title={`${dte(d)} days`}>{dayLabel(d)}{dte(d) === 0 ? ' · 0DTE' : ''}</button>)}
        </div>
      )}

      {(error || data?.liveError) && <div className="ec-warn"><TriangleAlert size={15} /> {data?.liveError ? `${data.liveError} — showing Cboe’s delayed data meanwhile.` : error}</div>}

      {loading && !data ? <div className="ec-empty">Loading the {symbol} options chain…</div> : !data ? (
        <div className="ec-empty">No GEX data.{error ? '' : ' Try refreshing in a minute.'}</div>
      ) : (
        <>
          <div className="gx-kpis">
            {data.implied
              ? <Kpi label={`${symbol} now (from ${data.fut.fut})`} v={fmtPx(data.implied.spot)} sub={`${fut} ${fmtPx(data.implied.fut)} · ${symbol} ${data.cashOpen ? 'at data time' : 'closed at'} ${fmtPx(data.spot)}`} title={`The options data is from ${data.cashOpen ? 'a delayed snapshot' : 'the cash close'}; this is where ${symbol} would be at ${fut}’s latest price`} />
              : <Kpi label={`${symbol} price`} v={fmtPx(data.spot)} sub={F(data.spot) && `${fut} ${F(data.spot)}`} />}
            <Kpi label="Gamma zone" v={data.zone === 'positive' ? '+γ positive' : '−γ negative'} sub={data.zone === 'positive' ? 'mean-reverting' : 'trending / volatile'} cls={data.zone === 'positive' ? 'pos' : 'neg'} />
            <Kpi label="Total GEX" v={fmtUsd(data.total)} sub="per 1% move" />
            <Kpi label="Call wall" v={fmtPx(data.callWall, 0)} sub={F(data.callWall) && `${fut} ${F(data.callWall)}`} cls="call" title="The strike with the most call gamma — often resistance" />
            <Kpi label="Put wall" v={fmtPx(data.putWall, 0)} sub={F(data.putWall) && `${fut} ${F(data.putWall)}`} cls="put" title="The strike with the most put gamma — often support" />
            <Kpi label="Gamma flip" v={fmtPx(data.flip)} sub={F(data.flip) && `${fut} ${F(data.flip)}`} cls="flip" title="Where total GEX changes sign" />
          </div>

          {futRoot && (
            <div className="gx-futline muted">
              {data.fut ? <>Converted to <b>{fut}</b>: {fmtPx(data.fut.price)} ÷ {fmtPx(data.spot)} = ×{data.fut.ratio.toFixed(4)} <span>({data.fut.atClose ? `${fut} at the ${symbol} cash close, ` : 'your price data at '}{new Date(data.fut.at || data.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{data.fut.atClose ? ' — the index doesn’t trade after hours, so both prices are from the same moment' : ''})</span></>
                : (
                  <form className="row gap6" onSubmit={(e) => { e.preventDefault(); const v = Number(e.currentTarget.fp.value); if (v > 0 && data.spot > 0) setSetting('gexFut', { ...(s.gexFut || {}), [symbol]: { price: v, ratio: v / data.spot, at: Date.now() } }); }}>
                    <span>No {fut} prices from your platform for {data.delayed ? 'the time of this data' : 'now'}. {manual ? <>Using ×{manual.ratio.toFixed(4)} you entered.</> : 'Type the futures price to convert the levels:'}</span>
                    <input name="fp" className="input" style={{ width: 110 }} placeholder={`${fut} price`} inputMode="decimal" />
                    <button className="btn sm">Use</button>
                  </form>
                )}
            </div>
          )}

          <div className="card card-pad gx-main">
            <div className="row gap8 wrap" style={{ marginBottom: 6 }}>
              <b className="grow">Gamma exposure by strike · {symbol} <span className="muted no-i18n">({chosen.map(dayLabel).join(', ')})</span></b>
              <button className={`chip sm ${show.agg ? 'on' : ''}`} onClick={() => setShow((x) => ({ ...x, agg: !x.agg }))}><i className="gx-sw agg" /> Total GEX by price</button>
              <button className={`chip sm ${show.net ? 'on' : ''}`} onClick={() => setShow((x) => ({ ...x, net: !x.net }))}><i className="gx-sw cum" /> Net (cumulative)</button>
              <button className={`chip sm ${show.netOnly ? 'on' : ''}`} onClick={() => setShow((x) => ({ ...x, netOnly: !x.netOnly }))}>Net bars only</button>
            </div>
            <GexChart data={data} ratio={ratio} fut={fut} show={show} />
            <div className="muted gx-hint">Scroll to zoom · drag to pan · double-click to reset</div>
          </div>

          <div className="card card-pad gx-sum">
            <div className="row gap8">
              <b className="grow"><Sparkles size={15} /> What it means</b>
              <button className="btn sm" onClick={summarize} disabled={sumBusy}>{sumBusy ? 'Thinking…' : summary ? 'Again' : 'Summarize'}</button>
            </div>
            {summary ? <><Markdown text={summary.text} />{summary.err && <div className="muted" style={{ fontSize: 12 }}>{summary.err}</div>}{summary.by === 'local' && !summary.err && (s.coach?.provider || 'local') === 'local' && <div className="muted" style={{ fontSize: 12 }}>Built-in summary. Set up an AI provider in the Trading Coach for a written one.</div>}</>
              : <div className="muted" style={{ fontSize: 13.5 }}>A plain-English read of these levels{(s.coach?.provider || 'local') !== 'local' ? ', written by your Trading Coach’s AI' : ''}.</div>}
          </div>

          <div className="gx-grid">
            <ExpoChart block={data.near} k="vanna" spot={data.spot} title="Vanna · 0–45 days" unit="per vol pt" />
            <ExpoChart block={data.near} k="charm" spot={data.spot} title="Charm · 0–45 days" unit="per day" />
            <ExpoChart block={data.regime} k="vanna" spot={data.spot} title="Vanna · 46–180 days" unit="per vol pt" />
            <ExpoChart block={data.regime} k="charm" spot={data.spot} title="Charm · 46–180 days" unit="per day" />
          </div>
          {data.near && (
            <div className="gx-vlv">
              <Kpi label="Vanna flip (0–45 d)" v={fmtPx(data.near.vannaFlip, 0)} sub={F(data.near.vannaFlip) && `${fut} ${F(data.near.vannaFlip)}`} title="Where cumulative vanna changes sign" />
              <Kpi label="Most positive vanna" v={fmtPx(data.near.maxVanna, 0)} sub={F(data.near.maxVanna) && `${fut} ${F(data.near.maxVanna)}`} />
              <Kpi label="Most negative vanna" v={fmtPx(data.near.minVanna, 0)} sub={F(data.near.minVanna) && `${fut} ${F(data.near.minVanna)}`} />
              <Kpi label="Vanna above ÷ below" v={data.near.upDown != null ? data.near.upDown.toFixed(2) : '—'} sub={data.near.upDown != null ? (data.near.upDown >= 1 ? 'more above the price' : 'more below the price') : ''} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
