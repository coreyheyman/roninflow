import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, RefreshCw, Palette, Check, ChevronDown } from 'lucide-react';
import { useStore } from '../store/store';
import { todayKey, fmtMoney, fmtTime12 } from '../lib/stats';
import { Modal, ModalHead, Popover } from './ui';
import { ColorRow } from './ThemeStudio';
import { ivSec, TIMEFRAMES, SPAN_DAYS, tfLabel, toLocal, barTime, aggregate } from '../lib/bars';

// Candlestick chart of the day with your executions, drawn with TradingView Lightweight Charts™.
// Candles come from the journal server (/api/candles, cached on your PC); the library is served by it too.

let libPromise = null;
function loadLib() {
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/api/candles/lib';
      s.async = true;
      s.onload = () => (window.LightweightCharts ? resolve(window.LightweightCharts) : reject(new Error('Chart library didn’t load')));
      s.onerror = () => { libPromise = null; reject(new Error('Couldn’t load the chart library')); };
      document.head.appendChild(s);
    });
  }
  return libPromise;
}

const TICKS = { ES: 0.25, MES: 0.25, NQ: 0.25, MNQ: 0.25, YM: 1, MYM: 1, RTY: 0.1, M2K: 0.1, CL: 0.01, MCL: 0.01, QM: 0.025, GC: 0.1, MGC: 0.1, SI: 0.005, SIL: 0.005, HG: 0.0005, NG: 0.001, QG: 0.005, ZB: 0.03125, ZN: 0.015625, '6E': 0.00005, M6E: 0.0001, '6J': 0.0000005, '6B': 0.0001, '6A': 0.00005, BTC: 5, MBT: 5, ETH: 0.5, MET: 0.05 };
const ROOTS = Object.keys(TICKS).sort((a, b) => b.length - a.length);
const rootOf = (s) => { const u = String(s || '').toUpperCase(); return ROOTS.find((r) => u.startsWith(r)) || u; };
const decimals = (x) => { const s = String(x); return s.includes('e-') ? Number(s.split('e-')[1]) : (s.split('.')[1] || '').length; };

const epoch = (iso) => Math.floor(new Date(iso).getTime() / 1000); // journal times are local wall-clock

function cssColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => cs.getPropertyValue(n).trim() || d;
  return {
    bg: v('--panel', '#0a0a0a'), text: v('--muted', '#8b8b8f'), border: v('--border', '#1e1e1e'), fg: v('--fg', '#f4f4f5'),
    up: v('--pos-strong', '#1aa87f'), down: v('--neg', '#e5484d'), buy: v('--info', '#4da3e5'), sell: v('--warn', '#e8b043'),
    win: v('--pos', '#2bc48a'), loss: v('--neg', '#e5484d'), font: v('--font', '') || getComputedStyle(document.body).fontFamily,
  };
}
// Candle + execution colour presets ("theme" follows your theme's profit/loss/info/warning colours).
export const CHART_PRESETS = [
  { id: 'theme', name: 'Theme', note: 'Follows your theme' },
  { id: 'tradingview', name: 'TradingView', colors: { up: '#26a69a', down: '#ef5350', wickUp: '#26a69a', wickDown: '#ef5350', buy: '#2962ff', sell: '#f23645', win: '#26a69a', loss: '#ef5350' } },
  { id: 'orderflow', name: 'Order flow', colors: { up: '#14a394', down: '#7c3aa6', wickUp: '#14a394', wickDown: '#7c3aa6', buy: '#22c55e', sell: '#ef4444', win: '#22e05a', loss: '#ef4444' } },
  { id: 'classic', name: 'Classic', colors: { up: '#22c55e', down: '#ef4444', wickUp: '#22c55e', wickDown: '#ef4444', buy: '#3b82f6', sell: '#f59e0b', win: '#22c55e', loss: '#ef4444' } },
  { id: 'mono', name: 'Mono', colors: { up: '#d4d4d8', down: '#52525b', wickUp: '#a1a1aa', wickDown: '#71717a', buy: '#22c55e', sell: '#ef4444', win: '#22c55e', loss: '#ef4444' } },
];
export const CHART_COLOR_KEYS = [
  ['up', 'Up candle', 'Body of rising candles'],
  ['down', 'Down candle', 'Body of falling candles'],
  ['wickUp', 'Up wick', 'Wick and border of rising candles'],
  ['wickDown', 'Down wick', 'Wick and border of falling candles'],
  ['buy', 'Buy execution', 'Up-arrows at your buy fills'],
  ['sell', 'Sell execution', 'Down-arrows at your sell fills'],
  ['win', 'Winning trade line', 'Dashed entry → exit line'],
  ['loss', 'Losing trade line', 'Dashed entry → exit line'],
];
/** The colours the chart actually uses: theme colours, overridden by the chart colour setting. */
export function chartColors(setting) {
  const c = cssColors();
  const base = { up: c.up, down: c.down, wickUp: c.up, wickDown: c.down, buy: c.buy, sell: c.sell, win: c.win, loss: c.loss };
  if (!setting) return { ...c, ...base };
  const preset = CHART_PRESETS.find((p) => p.id === setting.preset)?.colors || {};
  return { ...c, ...base, ...preset, ...(setting.colors || {}) };
}

const alpha = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** Executions for one symbol → markers, trade lines and the time span to show. */
export function buildExecutions(trades, barTimes, toBar = (u) => toLocal(u)) {
  const snap = (t) => { // the bar that contains time t
    let lo = 0, hi = barTimes.length - 1, ans = barTimes[0];
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (barTimes[mid] <= t) { ans = barTimes[mid]; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  };
  const groups = new Map();
  const lines = [];
  let first = Infinity, last = -Infinity;
  const add = (iso, price, side, qty, tradeId, kind) => {
    if (!iso || !Number.isFinite(Number(price))) return null;
    const raw = toBar(epoch(iso));
    first = Math.min(first, raw); last = Math.max(last, raw);
    const time = snap(raw);
    const k = `${time}|${side}|${price}`;
    const g = groups.get(k) || { time, side, price: Number(price), qty: 0, ids: [], kinds: [] };
    g.qty += Number(qty) || 1;
    if (!g.ids.includes(tradeId)) g.ids.push(tradeId);
    if (!g.kinds.includes(kind)) g.kinds.push(kind);
    groups.set(k, g);
    return time;
  };
  for (const t of trades) {
    const buyFirst = t.direction !== 'Short';
    const fills = t.fills?.length ? t.fills : [t];
    for (const f of fills) {
      add(f.entry, f.entryPrice, buyFirst ? 'buy' : 'sell', f.qty || t.qty, t.id, 'entry');
      add(f.exit, f.exitPrice, buyFirst ? 'sell' : 'buy', f.qty || t.qty, t.id, 'exit');
    }
    if (t.entry && t.exit && Number.isFinite(Number(t.entryPrice)) && Number.isFinite(Number(t.exitPrice))) {
      const a = snap(toBar(epoch(t.entry))), b = snap(toBar(epoch(t.exit)));
      if (b > a) lines.push({ id: t.id, pnl: t.pnl, points: [{ time: a, value: Number(t.entryPrice) }, { time: b, value: Number(t.exitPrice) }] });
    }
  }
  const markers = [...groups.values()].sort((a, b) => a.time - b.time || (a.side === 'buy' ? -1 : 1));
  return { markers, lines, first, last };
}

export default function ExecChart({ date: dateProp, trades: tradesProp, onOpenTrade, focus, big, title }) {
  // focus = one trade (the trade review drawer): just that trade's executions, zoomed in on them
  const trades = useMemo(() => (focus ? [focus] : tradesProp), // eslint-disable-line react-hooks/exhaustive-deps
    focus ? [focus.id, focus.entry, focus.exit, focus.entryPrice, focus.exitPrice, focus.pnl, focus.fills] : [tradesProp]);
  const date = focus ? String(focus.entry || '').slice(0, 10) : dateProp;
  const { state, setSetting } = useStore();
  const symbols = useMemo(() => {
    const n = new Map();
    for (const t of trades) n.set(t.symbol, (n.get(t.symbol) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => ({ s, c }));
  }, [trades]);
  const [pick, setPick] = useState(null);
  const sym = symbols.some((x) => x.s === pick) ? pick : symbols[0]?.s;
  const [rec, setRec] = useState({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const box = useRef(null);
  const legend = useRef(null);
  const chartRef = useRef(null);
  const fitRef = useRef(() => {});
  const openRef = useRef(onOpenTrade);
  openRef.current = onOpenTrade;
  const tipRef = useRef(null);
  const viewRef = useRef(null); // keeps your zoom when the chart redraws (live refresh, theme change)
  const themeKey = `${state.settings.themeId}|${state.settings.theme}|${JSON.stringify(state.settings.customThemes || [])}|${JSON.stringify(state.settings.chartColors || {})}`;
  const [colorsOpen, setColorsOpen] = useState(false);
  const legendColors = useMemo(() => chartColors(state.settings.chartColors), [themeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const isToday = date === todayKey();
  const tf = TIMEFRAMES.includes(state.settings.execTf) ? state.settings.execTf : '1m';
  const span = SPAN_DAYS[tf] || 0;

  // candles
  useEffect(() => {
    if (!sym) return undefined;
    let alive = true;
    let timer;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const get = (d, refresh) => fetch(`/api/candles?symbol=${encodeURIComponent(sym)}&date=${d}&tz=${encodeURIComponent(tz)}${refresh ? '&refresh=1' : ''}`)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); return j; });
    // earlier days for the 1h / 4h / 1d timeframes (weekdays only; a day without prices is just skipped)
    const extraDays = [];
    for (let i = 1; i <= span; i++) { const x = new Date(`${date}T12:00:00`); x.setDate(x.getDate() - i); if (x.getDay() !== 6) extraDays.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`); }
    let extra = null;
    const load = (quiet, refresh) => {
      if (!quiet) setRec({ status: 'loading' });
      if (!extra) extra = Promise.all(extraDays.map((d) => get(d).then((j) => j.candles || []).catch(() => []))).then((xs) => xs.flat());
      Promise.all([get(date, refresh), extra])
        .then(([j, more]) => alive && setRec((old) => {
          const byT = new Map();
          for (const c of [...more, ...(j.candles || [])]) byT.set(c[0], c);
          const b = [...byT.values()].sort((x, y) => x[0] - y[0]);
          const a = old.candles;
          if (quiet && a && a.length === b.length && String(a[a.length - 1]) === String(b[b.length - 1])) return old;
          return { status: 'ok', ...j, candles: b, key: `${sym}|${date}|${span}` };
        }))
        .catch((e) => alive && !quiet && setRec({ status: 'error', error: e.message }));
    };
    load(false, nonce > 0);
    if (isToday) timer = setInterval(() => load(true), 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [sym, date, isToday, nonce, span]);

  const symTrades = useMemo(() => trades.filter((t) => t.symbol === sym), [trades, sym]);

  // chart
  useEffect(() => {
    // only draw candles that belong to the instrument/day being shown (not the previous one while the new one loads)
    if (rec.status !== 'ok' || !rec.candles?.length || !box.current || rec.key !== `${sym}|${date}|${span}`) return undefined;
    let fitted = false;
    let chart;
    let cancelled = false;
    loadLib().then((LW) => {
      if (cancelled || !box.current) return;
      const c = chartColors(state.settings.chartColors);
      const iv = Math.max(ivSec(tf), ivSec(rec.interval)); // can't draw finer than the price source sends
      const toBar = (u) => barTime(u, iv);
      const tick = TICKS[rootOf(sym)];
      const prec = tick ? decimals(tick) : 2;
      chart = LW.createChart(box.current, {
        autoSize: true,
        layout: { background: { type: 'solid', color: c.bg }, textColor: c.text, fontFamily: c.font, fontSize: 11, attributionLogo: true },
        grid: { vertLines: { color: alpha(c.border, 0.55) }, horzLines: { color: alpha(c.border, 0.55) } },
        rightPriceScale: { borderColor: c.border, scaleMargins: { top: 0.08, bottom: 0.08 } },
        timeScale: { borderColor: c.border, timeVisible: iv < 86400, secondsVisible: false, rightOffset: 3, barSpacing: iv >= 86400 ? 12 : 7 },
        crosshair: { mode: 0 },
      });
      chartRef.current = chart;
      const candles = aggregate(rec.candles, iv);
      const series = chart.addSeries(LW.CandlestickSeries, {
        upColor: c.up, downColor: c.down, wickUpColor: c.wickUp, wickDownColor: c.wickDown, borderUpColor: c.wickUp, borderDownColor: c.wickDown, borderVisible: c.wickUp !== c.up || c.wickDown !== c.down,
        priceFormat: { type: 'price', precision: prec, minMove: tick || 0.01 },
        priceLineVisible: !!isToday,
      });
      series.setData(candles);

      const barTimes = candles.map((x) => x.time);
      const ex = buildExecutions(symTrades, barTimes, toBar);
      for (const ln of ex.lines) {
        const s = chart.addSeries(LW.LineSeries, {
          color: alpha(ln.pnl >= 0 ? c.win : c.loss, 0.85), lineWidth: 1, lineStyle: 2,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, pointMarkersVisible: false,
        });
        s.setData(ln.points);
      }
      LW.createSeriesMarkers(series, ex.markers.map((m) => ({
        time: m.time,
        position: m.side === 'buy' ? 'atPriceBottom' : 'atPriceTop',
        price: m.price,
        shape: m.side === 'buy' ? 'arrowUp' : 'arrowDown',
        color: m.side === 'buy' ? c.buy : c.sell,
        text: m.qty > 1 ? String(m.qty) : '',
        size: 1,
      })));

      const fit = () => {
        if (!Number.isFinite(ex.first)) { chart.timeScale().fitContent(); return; }
        const pad = focus ? Math.max(12 * 60, (ex.last - ex.first) * 1.2, iv * 12) : Math.max(30 * 60, (ex.last - ex.first) * 0.15, iv * 20);
        const from = Math.max(barTimes[0], ex.first - pad);
        const to = Math.min(barTimes[barTimes.length - 1] + iv * 3, ex.last + pad);
        try { chart.timeScale().setVisibleRange({ from, to }); } catch { chart.timeScale().fitContent(); }
      };
      fitRef.current = fit;
      const key = `${sym}|${date}|${iv}`;
      const keep = viewRef.current?.key === key && viewRef.current.range;
      requestAnimationFrame(() => {
        if (cancelled) return;
        fitted = true;
        if (keep) { try { chart.timeScale().setVisibleRange(keep); return; } catch { /* fall through */ } }
        fit();
      });

      // OHLC readout
      const fmt = (v) => Number(v).toFixed(prec);
      const show = (d) => {
        if (!legend.current) return;
        if (!d) { legend.current.textContent = ''; return; }
        const chg = d.close - d.open;
        legend.current.innerHTML = `O <b>${fmt(d.open)}</b> H <b>${fmt(d.high)}</b> L <b>${fmt(d.low)}</b> C <b style="color:${chg >= 0 ? c.up : c.down}">${fmt(d.close)}</b>`;
      };
      show(candles[candles.length - 1]);
      // executions are clickable: find the marker under the pointer (by pixel distance), show a tip, open the trade
      const byId = new Map(symTrades.map((t) => [t.id, t]));
      const hit = (pt) => {
        if (!pt) return null;
        let best = null, bestD = 15;
        for (const m of ex.markers) {
          const x = chart.timeScale().timeToCoordinate(m.time);
          const y0 = series.priceToCoordinate(m.price);
          if (x == null || y0 == null) continue;
          const y = y0 + (m.side === 'buy' ? 9 : -9); // arrows sit just below (buy) / above (sell) the price
          const dd = Math.hypot(pt.x - x, pt.y - y);
          if (dd < bestD) { bestD = dd; best = { m, x, y }; }
        }
        return best;
      };
      const tip = (h) => {
        const el = tipRef.current;
        if (!el) return;
        if (!h) { el.style.display = 'none'; box.current && (box.current.style.cursor = ''); return; }
        const ts = h.m.ids.map((id) => byId.get(id)).filter(Boolean);
        const t = ts[0];
        if (!t) return;
        const priv = state.settings.privacy;
        const what = h.m.kinds.length > 1 ? 'Entry / exit' : h.m.kinds[0] === 'entry' ? 'Entry' : 'Exit';
        el.innerHTML = `<b>${h.m.side === 'buy' ? 'Buy' : 'Sell'} ${h.m.qty} @ ${Number(h.m.price).toFixed(prec)}</b>`
          + `<span>${what} · ${t.direction} ${t.symbol}${ts.length > 1 ? ` · ${ts.length} trades` : ''}</span>`
          + `<span>${fmtTime12(t.entry)} → ${fmtTime12(t.exit)} · <em style="color:${t.pnl >= 0 ? c.win : c.loss}">${priv ? '•••' : fmtMoney(t.pnl, { sign: true })}</em></span>`
          + (openRef.current ? '<small>Click to review</small>' : '');
        el.style.display = 'block';
        const w = box.current.clientWidth;
        el.style.left = `${Math.min(Math.max(8, h.x + 12), w - 200)}px`;
        el.style.top = `${Math.max(8, h.y + (h.m.side === 'buy' ? 12 : -86))}px`;
        box.current.style.cursor = openRef.current ? 'pointer' : '';
      };
      chart.subscribeCrosshairMove((p) => {
        show(p?.seriesData?.get(series) || candles[candles.length - 1]);
        tip(hit(p?.point));
      });
      chart.subscribeClick((p) => {
        const h = hit(p?.point);
        const t = h && byId.get(h.m.ids[0]);
        if (t && openRef.current) { tip(null); openRef.current(t); }
      });
    }).catch((e) => !cancelled && setRec({ status: 'error', error: e.message }));
    return () => {
      cancelled = true;
      if (chart) {
        // remember your zoom for redraws of this same chart, but only once it was actually framed
        if (fitted) { try { viewRef.current = { key: `${sym}|${date}|${Math.max(ivSec(tf), ivSec(rec.interval))}`, range: chart.timeScale().getVisibleRange() }; } catch { /* */ } }
        chart.remove();
      }
      chartRef.current = null;
    };
  }, [rec, symTrades, themeKey, sym, isToday, date, tf, span]);

  if (!symbols.length) return null;
  const old = rec.status === 'ok' && rec.interval && rec.interval !== '1m';
  const wins = symTrades.filter((t) => t.pnl > 0).length;
  const net = symTrades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);

  return (
    <div className={big ? 'panel exec-chart ec-mini ec-big' : focus ? 'exec-chart ec-mini' : 'panel exec-chart'}>
      <div className="ec-head">
        <div className={focus && !big ? 'label' : 'card-title'} style={focus && !big ? { margin: 0 } : undefined}>{title || (focus ? 'Chart' : 'Executions')}</div>
        {!focus && <div className="ec-syms" role="tablist">
          {symbols.map(({ s, c }) => (
            <button key={s} role="tab" aria-selected={s === sym} className={`chip ${s === sym ? 'on' : ''}`} onClick={() => setPick(s)}>{s} <span className="muted" style={{ marginLeft: 4 }}>{c}</span></button>
          ))}
        </div>}
        <div className="row gap4 ec-tools">
          <TimeframePicker tf={tf} native={rec.status === 'ok' ? rec.interval : null} source={rec.source} onPick={(v) => setSetting('execTf', v)} />
          <button className="icon-btn" title="Chart colours" onClick={() => setColorsOpen(true)}><Palette size={15} /></button>
          <button className="icon-btn" title={focus ? 'Zoom to this trade' : 'Fit all executions'} onClick={() => fitRef.current()}><Maximize2 size={15} /></button>
          <button className="icon-btn" title="Reload prices" onClick={() => setNonce((n) => n + 1)}><RefreshCw size={15} /></button>
        </div>
      </div>
      <div className="ec-stage">
        <div className="ec-legend"><span className="ec-sym">{sym}</span><span ref={legend} /></div>
        <div ref={box} className="ec-canvas" />
        <div ref={tipRef} className="ec-tip" />
        {rec.status === 'loading' && <div className="ec-msg muted">Loading {sym} candles…</div>}
        {rec.status === 'error' && (
          <div className="ec-msg">
            <div style={{ color: 'var(--fg)', fontWeight: 500 }}>Couldn’t load {sym} prices</div>
            <div className="muted" style={{ fontSize: 12.5, maxWidth: 360 }}>{rec.error}</div>
            {/Price data/.test(rec.error || '')
              ? <button className="btn" style={{ marginTop: 6 }} onClick={() => window.dispatchEvent(new CustomEvent('tj:open-settings', { detail: 'prices' }))}>Choose a price source</button>
              : <button className="btn" style={{ marginTop: 6 }} onClick={() => setNonce((n) => n + 1)}><RefreshCw size={14} /> Try again</button>}
          </div>
        )}
        {rec.status === 'ok' && !rec.candles?.length && <div className="ec-msg muted">No {sym} prices for this day.</div>}
      </div>
      <div className="ec-foot">
        <span className="row gap6"><i className="ec-dot" style={{ background: legendColors.buy }} /> Buy</span>
        <span className="row gap6"><i className="ec-dot" style={{ background: legendColors.sell }} /> Sell</span>
        {!focus && <span className="muted">{symTrades.length} trade{symTrades.length === 1 ? '' : 's'} · {wins} won · <span className={net >= 0 ? 'pos' : 'neg'}>{state.settings.privacy ? '•••' : fmtMoney(net, { sign: true })}</span></span>}
        <span className="grow" />
        {rec.status === 'ok' && rec.source && (
          <span className="muted2" title={/Yahoo|Databento/.test(rec.source) ? 'Continuous front-month contract; prices can differ slightly from your contract around rollovers.' : rec.source}>
            {old && /Yahoo/.test(rec.source) ? `${rec.interval.replace('60m', '1h')} candles: Yahoo only keeps 1-minute data for 30 days` : rec.source}
          </span>
        )}
      </div>
      {colorsOpen && <ChartColors onClose={() => setColorsOpen(false)} />}
    </div>
  );
}

/** The timeframe button: shows the candle size, opens a list of timeframes. */
function TimeframePicker({ tf, native, source, onPick }) {
  const nat = native ? ivSec(native) : 60;
  return (
    <Popover align="right" width={150} trigger={({ toggle, open }) => (
      <button className={`ec-iv ec-tf ${open ? 'on' : ''}`} onClick={toggle} title={`Timeframe${source ? ` · prices: ${source}` : ''}`}>
        {ivSec(tf) < nat ? tfLabel(native) : tf}<ChevronDown size={11} />
      </button>
    )}>
      {(close) => (
        <div className="ec-tf-list">
          {TIMEFRAMES.map((x) => {
            const tooFine = ivSec(x) < nat;
            return (
              <button key={x} className={`pop-item ${x === tf ? 'on' : ''}`} disabled={tooFine} title={tooFine ? `Your price source sends ${tfLabel(native)} candles for this day` : undefined} onClick={() => { onPick(x); close(); }}>
                <span className="grow">{x}</span>{x === tf && <Check size={13} className="accent" />}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

/** Chart colours: presets + every colour editable. Saved in settings, used by every execution chart. */
function ChartColors({ onClose }) {
  const { state, setSetting } = useStore();
  const saved = state.settings.chartColors || { preset: 'theme' };
  const [draft, setDraft] = useState(saved);
  const timer = useRef(null);
  const commit = (next) => {
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSetting('chartColors', next), 150);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const current = chartColors(draft);
  const custom = draft.colors && Object.keys(draft.colors).length > 0;
  return (
    <Modal open onClose={() => { clearTimeout(timer.current); setSetting('chartColors', draft); onClose(); }} width={520}>
      <ModalHead title="Chart colours" sub="Candles and executions on every execution chart" onClose={() => { clearTimeout(timer.current); setSetting('chartColors', draft); onClose(); }} />
      <div className="modal-body" style={{ paddingTop: 4 }}>
        <div className="label" style={{ marginBottom: 8 }}>Presets</div>
        <div className="ec-presets">
          {CHART_PRESETS.map((p) => {
            const col = p.id === 'theme' ? chartColors({ preset: 'theme' }) : { ...chartColors({ preset: 'theme' }), ...p.colors };
            const on = draft.preset === p.id && !custom;
            return (
              <button key={p.id} className={`ec-preset ${on ? 'on' : ''}`} onClick={() => commit({ preset: p.id })}>
                <span className="ec-swatches">
                  <svg width="44" height="30" viewBox="0 0 44 30" aria-hidden="true">
                    <line x1="8" y1="3" x2="8" y2="27" stroke={col.wickUp} /><rect x="4" y="8" width="8" height="14" fill={col.up} />
                    <line x1="22" y1="5" x2="22" y2="25" stroke={col.wickDown} /><rect x="18" y="10" width="8" height="11" fill={col.down} />
                    <path d="M36 15 l-4 7 h8z" fill={col.buy} /><path d="M36 13 l-4 -7 h8z" fill={col.sell} />
                  </svg>
                </span>
                <span className="row gap4" style={{ fontSize: 12.5 }}>{on && <Check size={12} className="accent" />}{p.name}</span>
              </button>
            );
          })}
        </div>
        <div className="row between" style={{ margin: '16px 0 4px' }}>
          <div className="label" style={{ margin: 0 }}>Colours {custom && <span className="muted" style={{ fontWeight: 400 }}>· customised</span>}</div>
          {custom && <button className="btn sm" onClick={() => commit({ preset: draft.preset })}>Reset to {CHART_PRESETS.find((p) => p.id === draft.preset)?.name}</button>}
        </div>
        <div className="ec-colors">
          {CHART_COLOR_KEYS.map(([k, label, desc]) => (
            <ColorRow key={k} k={k} label={label} desc={desc} value={/^#[0-9a-f]{6}$/i.test(current[k]) ? current[k] : '#888888'}
              onChange={(key, v) => commit({ preset: draft.preset === 'theme' && !custom ? 'theme' : draft.preset, colors: { ...(draft.colors || {}), [key]: v } })} />
          ))}
        </div>
      </div>
      <div className="modal-foot"><button className="btn white" onClick={() => { clearTimeout(timer.current); setSetting('chartColors', draft); onClose(); }}>Done</button></div>
    </Modal>
  );
}
