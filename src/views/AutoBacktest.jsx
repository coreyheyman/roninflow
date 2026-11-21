// Automated backtests: build a strategy from rules (or code), run it over the 1-minute history your platform add-on
// downloaded, and check the result for luck and overfitting — out-of-sample lock, parameter sweeps that favour
// broad plateaus, walk-forward, Monte Carlo, slippage stress and a random-entry baseline.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, ArrowLeft, Play, Trash, Download, Square, Lock, Unlock, Copy, AlertTriangle, CheckCircle2, Info, Code2, ListChecks, X, FileDown } from 'lucide-react';
import { useStore, navigate } from '../store/store';
import { Seg, Modal, ModalHead, Money, Confirm, useToast } from '../components/ui';
import { PnlChart } from '../components/Charts';
import { fmtMoney, uid, keyOf, pfText, summarize } from '../lib/stats';
import { pointValueOf, rootOf, localIso } from '../lib/backtest';
import { TICKS } from '../components/ExecChart';
import Range from '../components/Range';
import { engine, loadSeries, stopEngine } from '../lib/autoWorker';

// a micro and its full-size contract trade at the same price, so either chart's history works
const MICRO_OF = { MES: 'ES', MNQ: 'NQ', MYM: 'YM', M2K: 'RTY', MCL: 'CL', MGC: 'GC', SIL: 'SI' };
const TWIN_OF = { ...MICRO_OF, ...Object.fromEntries(Object.entries(MICRO_OF).map(([m, f]) => [f, m])) };

const ChartStudio = lazy(() => import('../components/ChartStudio'));

// ---------------------------------------------------------------------------------------------- vocabulary
const KINDS = [
  ['close', 'Close'], ['open', 'Open'], ['high', 'High'], ['low', 'Low'],
  ['ema', 'EMA', 'n', 21], ['sma', 'SMA', 'n', 50], ['vwap', 'VWAP'], ['rsi', 'RSI', 'n', 14], ['atr', 'ATR', 'n', 14],
  ['bbu', 'Bollinger upper', 'n', 20], ['bbl', 'Bollinger lower', 'n', 20],
  ['orHigh', 'Opening range high', 'min', 15], ['orLow', 'Opening range low', 'min', 15],
  ['pdHigh', 'Prior day high'], ['pdLow', 'Prior day low'], ['pdClose', 'Prior day close'],
  ['dayOpen', 'Today’s open (9:30 NY)'], ['dayHigh', 'High of day so far'], ['dayLow', 'Low of day so far'], ['value', 'Number', 'v', 0],
];
const KIND = Object.fromEntries(KINDS.map((k) => [k[0], k]));
const OPS = [['>', 'is above'], ['<', 'is below'], ['xa', 'crosses above'], ['xb', 'crosses below']];
const TFS = [1, 2, 3, 5, 10, 15, 30, 60];
const STOP_TYPES = [['none', 'None'], ['ticks', 'Ticks'], ['points', 'Points'], ['atr', '× ATR']];
const TARGET_TYPES = [['none', 'None'], ['ticks', 'Ticks'], ['points', 'Points'], ['atr', '× ATR'], ['r', '× stop (R)']];
const OBJECTIVES = [['net', 'Net P&L'], ['pf', 'Profit factor'], ['exp', 'Average trade'], ['sharpe', 'Sharpe'], ['retDD', 'Net ÷ max drawdown']];

const CODE_TEMPLATE = `// Runs on every closed bar of your timeframe. Return 'buy', 'sell', 'exit' or nothing.
// Orders fill at the next 1-minute bar's open. You can also return { action: 'buy', stop: price, target: price }.
// ctx: open / high / low / close / volume (arrays), ema(n) sma(n) rsi(n) atr(n) vwap() bbUpper(n) bbLower(n)
//      orHigh(minutes) orLow(minutes) pdHigh() pdLow() pdClose() dayOpen() dayHigh() dayLow()
//      crossAbove(a, b, i) crossBelow(a, b, i) · position (1 long, −1 short, 0 flat) · barsInTrade · tradesToday
// params: your parameters by name (add them under Parameters), e.g. params.fast
function onBar(bar, i, ctx) {
  const fast = ctx.ema(params.fast), slow = ctx.ema(params.slow);
  if (ctx.position !== 0) return;
  if (ctx.crossAbove(fast, slow, i) && bar.close > ctx.vwap()[i]) return 'buy';
  if (ctx.crossBelow(fast, slow, i) && bar.close < ctx.vwap()[i]) return 'sell';
}
`;

const P = (name) => ({ p: name });
const TEMPLATES = [
  {
    id: 'ema', name: 'EMA cross with VWAP filter', desc: 'Long when the fast EMA crosses above the slow one above VWAP; short the opposite.',
    spec: { tf: 5, long: [{ a: { k: 'ema', n: P('fast') }, op: 'xa', b: { k: 'ema', n: P('slow') } }, { a: { k: 'close' }, op: '>', b: { k: 'vwap' } }], short: [{ a: { k: 'ema', n: P('fast') }, op: 'xb', b: { k: 'ema', n: P('slow') } }, { a: { k: 'close' }, op: '<', b: { k: 'vwap' } }], stop: { type: 'atr', v: P('stopAtr'), n: 14 }, target: { type: 'r', v: 2 } },
    params: [{ name: 'fast', value: 9, min: 5, max: 15, step: 2 }, { name: 'slow', value: 21, min: 15, max: 45, step: 5 }, { name: 'stopAtr', value: 1.5, min: 1, max: 3, step: 0.5 }],
  },
  {
    id: 'orb', name: 'Opening range breakout', desc: 'Trade the first close outside the opening range; stop at the other side.',
    spec: { tf: 1, long: [{ a: { k: 'close' }, op: 'xa', b: { k: 'orHigh', n: P('range') } }], short: [{ a: { k: 'close' }, op: 'xb', b: { k: 'orLow', n: P('range') } }], stop: { type: 'points', v: P('stopPts') }, target: { type: 'r', v: P('rr') }, maxTradesDay: 1, entryTo: '' },
    params: [{ name: 'range', value: 15, min: 5, max: 60, step: 5 }, { name: 'stopPts', value: 10, min: 4, max: 20, step: 2 }, { name: 'rr', value: 2, min: 1, max: 3, step: 0.5 }],
  },
  {
    id: 'rsi', name: 'RSI mean reversion', desc: 'Buy oversold, sell overbought; exit when RSI is back in the middle.',
    spec: { tf: 5, long: [{ a: { k: 'rsi', n: 14 }, op: 'xb', b: { k: 'value', v: P('low') } }], short: [{ a: { k: 'rsi', n: 14 }, op: 'xa', b: { k: 'value', v: P('high') } }], exitWhen: [{ a: { k: 'rsi', n: 14 }, op: 'xa', b: { k: 'value', v: 50 } }, { a: { k: 'rsi', n: 14 }, op: 'xb', b: { k: 'value', v: 50 } }], stop: { type: 'atr', v: 2, n: 14 }, target: { type: 'none' } },
    params: [{ name: 'low', value: 30, min: 20, max: 40, step: 5 }, { name: 'high', value: 70, min: 60, max: 80, step: 5 }],
  },
  {
    id: 'pdh', name: 'Prior-day high / low break', desc: 'Long through yesterday’s high, short through yesterday’s low.',
    spec: { tf: 5, long: [{ a: { k: 'close' }, op: 'xa', b: { k: 'pdHigh' } }], short: [{ a: { k: 'close' }, op: 'xb', b: { k: 'pdLow' } }], stop: { type: 'atr', v: 1.5, n: 14 }, target: { type: 'r', v: P('rr') }, maxTradesDay: 2 },
    params: [{ name: 'rr', value: 2, min: 1, max: 4, step: 0.5 }],
  },
  { id: 'blank', name: 'Blank — my own rules', desc: 'Start from nothing.', spec: { tf: 5, long: [], short: [] }, params: [] },
  { id: 'code', name: 'Code (JavaScript)', desc: 'Write onBar() yourself for anything the rules can’t say.', spec: { tf: 5, mode: 'code', code: CODE_TEMPLATE, stop: { type: 'atr', v: 1.5, n: 14 }, target: { type: 'r', v: 2 } }, params: [{ name: 'fast', value: 9, min: 5, max: 15, step: 2 }, { name: 'slow', value: 21, min: 15, max: 45, step: 5 }] },
];
const DEFAULT_SPEC = { mode: 'rules', tf: 5, side: 'both', long: [], short: [], exitWhen: [], entry: { type: 'market', off: 1, expire: 3 }, stop: { type: 'ticks', v: 40 }, target: { type: 'r', v: 2 }, trail: { type: 'none', v: 20, n: 14 }, be: { type: 'none', v: 1, plus: 1 }, sizing: { type: 'fixed', risk: 200, max: 10 }, path: 'worst', initial: 50000, maxBars: '', entryFrom: '06:30', entryTo: '11:30', flatAt: '12:55', flatEod: true, maxTradesDay: 3, reverse: false, qty: 1, fee: 0, slip: 1, code: CODE_TEMPLATE };
const ENTRY_TYPES = [['market', 'Market'], ['stop', 'Stop (breakout)'], ['limit', 'Limit (pullback)']];
const TRAIL_TYPES = [['none', 'Off'], ['ticks', 'Ticks'], ['atr', '× ATR']];
const BE_TYPES = [['none', 'Off'], ['ticks', 'After ticks'], ['r', 'After × stop (R)']];

const hashOf = (o) => { const s = JSON.stringify(o); let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const yesterday = () => keyOf(new Date(Date.now() - 86400e3));
const fmtT = (u) => { const d = new Date(u * 1000); return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`; };
const dayOfUnix = (u) => keyOf(new Date(u * 1000));
const rangeValues = (p) => { const out = []; const step = Number(p.step) || 1; for (let v = Number(p.min); v <= Number(p.max) + 1e-9 && out.length < 60; v += step) out.push(Math.round(v * 1e6) / 1e6); return out; };
const paramValues = (s) => Object.fromEntries((s.params || []).map((p) => [p.name, Number(p.value)]));

// ---------------------------------------------------------------------------------------------- price data
const seriesCache = new Map();
async function fetchSeries(symbol, from, to) {
  const key = `${symbol}|${from}|${to}`;
  if (seriesCache.has(key)) return { key, data: seriesCache.get(key) };
  const r = await fetch(`/api/candles/history/bars?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  seriesCache.clear(); // keep one series in memory
  seriesCache.set(key, j);
  return { key, data: j };
}
function useHistory(symbol) {
  const [h, setH] = useState(null);
  const [err, setErr] = useState(null);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const load = (action) => fetch(`/api/candles/history?symbol=${encodeURIComponent(symbol)}${action ? `&action=${action}&tz=${encodeURIComponent(tz)}` : ''}`, { method: action ? 'POST' : 'GET' })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Error ${r.status}`); setErr(null); setH(j); return j; })
    .catch((e) => setErr(e.message));
  useEffect(() => { if (symbol) load(); }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (h?.job?.status !== 'running') return undefined;
    const id = setInterval(() => load(), 10000);
    return () => clearInterval(id);
  }, [h?.job?.status, symbol]); // eslint-disable-line react-hooks/exhaustive-deps
  return { h, err, start: () => load('start'), stop: () => load('stop'), refresh: () => load() };
}

// ---------------------------------------------------------------------------------------------- list
export function AutoList() {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const list = state.autoStrategies || [];
  return (
    <div className="col gap16">
      <div className="toolbar">
        <div className="muted" style={{ fontSize: 13 }}>Rules or code, run over the 1-minute history your platform add-on downloads — with checks for luck and overfitting.</div>
        <div className="grow" />
        <button className="btn white" onClick={() => setOpen(true)}>New strategy <Plus size={16} /></button>
      </div>
      {list.length === 0 ? (
        <div className="empty panel" style={{ minHeight: '46vh' }}>
          <ListChecks size={34} className="muted2" />
          <div style={{ color: 'var(--fg)', fontSize: 17, fontWeight: 500 }}>No automated strategies yet</div>
          <div className="muted" style={{ maxWidth: 480, textAlign: 'center', fontSize: 13.5 }}>Start from a template — EMA cross, opening range breakout, RSI reversion, prior-day break — or your own rules or code. Then download your market’s history and run it.</div>
          <button className="btn" onClick={() => setOpen(true)}>Create one</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 18 }}>
          {[...list].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map((s) => (
            <div key={s.id} className="strat-card" onClick={() => navigate(`backtest/auto/${s.id}`)}>
              <div className="row between gap8"><b style={{ fontWeight: 600, fontSize: 16 }}>{s.name}</b><span className="badge neutral">{s.symbol}</span></div>
              <div className="muted" style={{ fontSize: 12.5 }}>{s.spec.mode === 'code' ? 'Code' : 'Rules'} · {s.spec.tf}m · {s.variations || 0} variation{s.variations === 1 ? '' : 's'} tried{s.oos ? ' · out-of-sample unlocked' : ''}</div>
              {s.last ? (
                <div className="row gap24" style={{ fontSize: 13 }}>
                  <div><div className="muted">Net (in-sample)</div><Money v={s.last.net} colored /></div>
                  <div><div className="muted">Trades</div>{s.last.trades}</div>
                  <div><div className="muted">PF</div>{pfText(s.last.pf)}</div>
                  {s.oos && <div><div className="muted">Out-of-sample</div><Money v={s.oos.stats.net} colored /></div>}
                </div>
              ) : <div className="muted" style={{ fontSize: 13 }}>Not run yet</div>}
            </div>
          ))}
        </div>
      )}
      {open && <NewStrategy onClose={() => setOpen(false)} />}
    </div>
  );
}

function NewStrategy({ onClose }) {
  const { state, setAutoStrategies } = useStore();
  const symbols = useMemo(() => [...new Set([...state.trades.map((t) => rootOf(t.symbol)), 'MES', 'MNQ', 'ES', 'NQ'])], [state.trades]);
  const [symbol, setSymbol] = useState(symbols[0] || 'MES');
  const create = (tpl) => {
    const id = uid('ab');
    const root = rootOf(symbol) || 'MES';
    const mine = state.trades.filter((t) => rootOf(t.symbol) === root && Number(t.qty) > 0 && Number(t.fees) > 0);
    const q = mine.reduce((s, t) => s + Number(t.qty), 0);
    const fee = q ? Math.round((mine.reduce((s, t) => s + Number(t.fees), 0) / q) * 100) / 100 : 0;
    setAutoStrategies((l) => [...l, {
      id, name: tpl.id === 'blank' ? `${root} strategy` : tpl.name, symbol: root, from: '', to: '', split: 70,
      spec: { ...DEFAULT_SPEC, ...tpl.spec, fee, tick: TICKS[root] || 0.01, pv: pointValueOf(root) },
      params: tpl.params.map((p) => ({ ...p })), variations: 0, oos: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }]);
    onClose();
    navigate(`backtest/auto/${id}`);
  };
  return createPortal(
    <Modal open onClose={onClose} width={720}>
      <ModalHead title="New automated strategy" sub="Pick a market and a starting point — everything can be changed afterwards" onClose={onClose} />
      <div className="modal-body col gap16">
        <div className="field" style={{ maxWidth: 240 }}>
          <label className="label">Market</label>
          <input className="input" list="ab-symbols" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          <datalist id="ab-symbols">{symbols.map((x) => <option key={x} value={x} />)}</datalist>
        </div>
        <div className="ab-templates">
          {TEMPLATES.map((t) => (
            <button key={t.id} className="ab-template" onClick={() => create(t)}>
              <b>{t.id === 'code' ? <Code2 size={14} /> : null} {t.name}</b>
              <span className="muted">{t.desc}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>,
    document.body,
  );
}

// ---------------------------------------------------------------------------------------------- editor
export function AutoEditor({ id }) {
  const { state, setAutoStrategies } = useStore();
  const toast = useToast();
  const s = (state.autoStrategies || []).find((x) => x.id === id);
  const patch = (p) => setAutoStrategies((l) => l.map((x) => (x.id === id ? { ...x, ...(typeof p === 'function' ? p(x) : p), updatedAt: new Date().toISOString() } : x)));
  const setSpec = (p) => patch((x) => ({ spec: { ...x.spec, ...p } }));
  const hist = useHistory(s?.symbol);
  const [tab, setTab] = useState('results');
  const [busy, setBusy] = useState(null); // { what, progress }
  const [res, setRes] = useState(null);
  const [sw, setSw] = useState(null);
  const [wf, setWf] = useState(null);
  const [err, setErr] = useState(null);
  const [del, setDel] = useState(false);
  const [unlock, setUnlock] = useState(false);
  const lastHash = useRef(null);
  if (!s) return <div className="page empty">Strategy not found. <a href="#/backtest/auto" className="accent">Back</a></div>;

  const cov = hist.h?.coverage;
  const from = s.from || cov?.first || '';
  const to = s.to || cov?.last || '';
  const splitDay = from && to ? keyOf(new Date(Date.parse(`${from}T12:00:00`) + ((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) * (Number(s.split) || 70)) / 100)) : null;
  const unixOf = (day) => Math.floor(new Date(`${day}T00:00:00`).getTime() / 1000);
  const is = from && splitDay ? { from: unixOf(from), to: unixOf(splitDay) } : null;
  const oosR = splitDay && to ? { from: unixOf(splitDay), to: unixOf(to) + 86400 } : null;
  const specFull = { ...s.spec, tick: Number(s.spec.tick) || TICKS[s.symbol] || 0.01, pv: Number(s.spec.pv) || pointValueOf(s.symbol) };
  const P0 = paramValues(s);
  const nowHash = hashOf([specFull, P0, s.symbol, from, to, s.split]);
  const oosFresh = s.oos && s.oos.hash === nowHash;

  const prepare = async () => {
    if (!from || !to) throw new Error('No price history for this market yet — download it first.');
    setBusy({ what: 'Loading prices…' });
    const { key, data } = await fetchSeries(s.symbol, from, to);
    if (!data.n) throw new Error(`No ${s.symbol} 1-minute bars between ${from} and ${to}.`);
    await loadSeries(key, data);
    return data;
  };
  const go = async (fn) => {
    setErr(null);
    try { await fn(); } catch (e) { if (e.message !== 'Stopped') setErr(e.message); } finally { setBusy(null); }
  };
  const runIt = () => go(async () => {
    await prepare();
    setBusy({ what: 'Running…' });
    const r = await engine.analyze(specFull, P0, { is, oos: s.oos ? oosR : null, initial: Number(specFull.initial) || 50000 });
    setRes({ ...r, hash: nowHash });
    setTab('results');
    if (lastHash.current !== nowHash && s.lastHash !== nowHash) patch((x) => ({ variations: (x.variations || 0) + 1, lastHash: nowHash, last: { net: r.is.stats.net, trades: r.is.stats.trades, pf: r.is.stats.pf } }));
    else patch({ last: { net: r.is.stats.net, trades: r.is.stats.trades, pf: r.is.stats.pf } });
    lastHash.current = nowHash;
  });
  const grid = (s.params || []).filter((p) => p.sweep !== false && p.min !== '' && p.max !== '' && Number(p.max) > Number(p.min)).map((p) => ({ name: p.name, values: rangeValues(p) }));
  const combos = grid.reduce((a, g) => a * g.values.length, 1);
  const sweepIt = () => go(async () => {
    if (!grid.length) throw new Error('Give at least one parameter a range (from, to, step) to sweep.');
    if (combos > 2000) throw new Error(`${combos.toLocaleString()} combinations is too many — narrow the ranges or use bigger steps (2,000 at most).`);
    await prepare();
    setBusy({ what: `Sweeping ${combos} settings…`, progress: 0 });
    const r = await engine.sweep(specFull, P0, grid, is, { metric: s.objective || 'net', minTrades: Number(s.minTrades) || 30 }, (p) => setBusy((b) => ({ ...b, progress: p })));
    setSw(r);
    patch((x) => ({ variations: (x.variations || 0) + combos }));
    setTab('optimize');
  });
  const wfIt = () => go(async () => {
    await prepare();
    setBusy({ what: 'Walk-forward…', progress: 0 });
    const range = s.oos ? { from: unixOf(from), to: unixOf(to) + 86400 } : is;
    const r = await engine.walkForward(specFull, P0, combos <= 400 ? grid : [], range, { trainDays: Number(s.wfTrain) || 120, testDays: Number(s.wfTest) || 40, metric: s.objective || 'net', minTrades: 10 }, (p) => setBusy((b) => ({ ...b, progress: p })));
    setWf(r);
    if (grid.length && combos <= 400) patch((x) => ({ variations: (x.variations || 0) + combos * r.folds.length }));
    setTab('walk');
  });
  const doUnlock = () => go(async () => {
    setUnlock(false);
    await prepare();
    setBusy({ what: 'Testing on the locked period…' });
    const r = await engine.analyze(specFull, P0, { is, oos: oosR, checks: false, initial: Number(specFull.initial) || 50000 });
    patch({ oos: { at: new Date().toISOString(), hash: nowHash, stats: r.oos.stats, params: P0, from: splitDay, to } });
    setRes((x) => ({ ...(x || r), oos: r.oos, is: x?.is || r.is, hash: nowHash }));
    toast('Out-of-sample result recorded');
  });
  const stop = () => { stopEngine(); setBusy(null); };

  return (
    <div className="page">
      <div className="row gap12 wrap" style={{ marginBottom: 14 }}>
        <button className="btn sm" onClick={() => navigate('backtest/auto')}><ArrowLeft size={15} /> Strategies</button>
        <div className="grow" />
        <button className="btn sm" onClick={() => { const nid = uid('ab'); setAutoStrategies((l) => [...l, { ...s, id: nid, name: `${s.name} (copy)`, oos: null, variations: 0, lastHash: null, createdAt: new Date().toISOString() }]); navigate(`backtest/auto/${nid}`); }}><Copy size={14} /> Duplicate</button>
        <button className="btn sm danger" onClick={() => setDel(true)}><Trash size={14} /> Delete</button>
      </div>
      <div className="row gap12 wrap" style={{ marginBottom: 18 }}>
        <input className="input ab-name" value={s.name} onChange={(e) => patch({ name: e.target.value })} aria-label="Strategy name" />
        <span className="badge neutral">{s.symbol}</span>
        <div className="grow" />
        {busy ? (
          <div className="row gap8"><span className="muted" style={{ fontSize: 13 }}>{busy.what}{busy.progress != null ? ` ${Math.round(busy.progress * 100)}%` : ''}</span><button className="btn" onClick={stop}><Square size={13} /> Stop</button></div>
        ) : <button className="btn white" onClick={runIt}><Play size={14} /> Run backtest</button>}
      </div>
      {err && <div className="ab-err"><AlertTriangle size={15} /> {err}</div>}
      <div className="ab-grid">
        <div className="col gap16" style={{ minWidth: 0 }}>
          <DataPanel s={s} patch={patch} hist={hist} from={from} to={to} splitDay={splitDay} />
          <StrategyPanel s={s} setSpec={setSpec} patch={patch} />
          <ExitsPanel s={s} setSpec={setSpec} />
          <ParamsPanel s={s} patch={patch} />
        </div>
        <div className="col gap16" style={{ minWidth: 0 }}>
          <Seg value={tab} onChange={setTab} options={[{ value: 'results', label: 'Results' }, { value: 'optimize', label: 'Optimize' }, { value: 'walk', label: 'Walk-forward' }]} />
          {tab === 'results' && <Results s={s} res={res} fresh={res?.hash === nowHash} oosFresh={oosFresh} splitDay={splitDay} to={to} onUnlock={() => setUnlock(true)} busy={!!busy} from={from} />}
          {tab === 'optimize' && <Optimize s={s} patch={patch} sw={sw} grid={grid} combos={combos} onRun={sweepIt} busy={!!busy} />}
          {tab === 'walk' && <WalkForward s={s} patch={patch} wf={wf} grid={grid} combos={combos} onRun={wfIt} busy={!!busy} />}
        </div>
      </div>
      <Confirm open={del} title="Delete this strategy?" body={`${s.name} and its results will be removed.`} onCancel={() => setDel(false)} onConfirm={() => { setAutoStrategies((l) => l.filter((x) => x.id !== id)); navigate('backtest/auto'); }} />
      <Confirm
        open={unlock} title="Unlock the out-of-sample period?" confirmText="Unlock and test"
        body={`Your strategy runs once on ${splitDay} – ${to}, data it has never seen, with the settings you have now. The result is recorded. If you keep changing the strategy after this, that period is no longer “unseen” — the result is only honest the first time.`}
        onCancel={() => setUnlock(false)} onConfirm={doUnlock}
      />
    </div>
  );
}

function DataPanel({ s, patch, hist, from, to, splitDay }) {
  const { h, err } = hist;
  const job = h?.job;
  const cov = h?.coverage;
  const running = job?.status === 'running';
  return (
    <div className="panel">
      <div className="panel-head"><div className="card-title">Price history</div>{cov?.days ? <span className="muted" style={{ fontSize: 12.5 }}>{cov.days} days of 1-minute bars</span> : null}</div>
      <div className="col gap10" style={{ fontSize: 13 }}>
        {cov?.days ? <div>Saved: <b>{cov.first}</b> → <b>{cov.last}</b></div> : <div className="muted">No {s.symbol} history saved yet.</div>}
        {running && job.mode === 'chart' && (
          <div className="ab-job">
            <div className="ab-job-bar"><i /></div>
            <b style={{ fontWeight: 500 }}>Waiting for ATAS charts</b>
            <ol className="ab-steps">
              <li>In ATAS, open a <b>1-minute</b> {s.symbol} chart{TWIN_OF[s.symbol] ? <> — or {TWIN_OF[s.symbol]}, same prices</> : null} (time frame M1).</li>
              <li>Chart settings → <b>Days to load</b>: as many as you want (365 = a year, if your data feed has it).</li>
              <li>Add the <b>Journal Sync</b> indicator to that chart (or remove and re-add it). It sends everything the chart loaded within a minute.</li>
              <li>To go further back, do the same on earlier contracts’ charts (e.g. {TWIN_OF[s.symbol] || s.symbol}U6, {TWIN_OF[s.symbol] || s.symbol}M6…) — RoninFlow joins them at each roll and back-adjusts the prices.</li>
            </ol>
            {Object.keys(job.seen || {}).length === 0 && <span className="muted">No ATAS chart has checked in yet. This needs Journal Sync 1.4 or newer — reinstall it from Start menu → RoninFlow → Install platform add-ons → ATAS.</span>}
            {Object.entries(job.charts || {}).map(([name, c]) => (
              <span key={name} className={c.oneMinute ? '' : 'neg'}>{name}: {c.oneMinute ? `${c.count.toLocaleString()} bars, ${new Date(c.first * 1000).toLocaleDateString()} – ${new Date(c.last * 1000).toLocaleDateString()}` : 'this chart isn’t a 1-minute time chart — switch it to M1'}</span>
            ))}
            {job.oldest && <span className="muted">History now goes back to <b>{job.oldest}</b>.</span>}
          </div>
        )}
        {running && job.mode !== 'chart' && (
          <div className="ab-job">
            <div className="ab-job-bar"><i /></div>
            <span>Downloading from {job.source} · back to {job.next ? job.next : '…'} · {job.done} week{job.done === 1 ? '' : 's'} checked{job.failed ? ` · ${job.failed} skipped` : ''}</span>
            {job.stale && <span className="neg">No answer from the add-on for 15 minutes — is {job.source} running with the RoninFlow add-on?</span>}
          </div>
        )}
        {job && !running && job.mode === 'chart' && job.oldest && <div className="muted">From your ATAS charts: back to <b>{job.oldest}</b> ({Object.keys(job.charts || {}).join(', ')}). Press Download more history to add more charts.</div>}
        {job && !running && job.reason === 'start' && <div className="muted">Your platform’s 1-minute history starts around <b>{job.oldest}</b> — that’s as far back as it goes.</div>}
        {job && !running && job.reason === 'contract' && <div className="muted">Stopped at {job.next}: the contract names before that can’t be worked out for {s.symbol}.</div>}
        {job?.reason === 'demo' && <div className="muted">Demo: made-up prices from Jan 2025.</div>}
        <div className="row gap8 wrap">
          {running ? <button className="btn sm" onClick={hist.stop}><Square size={12} /> {job.mode === 'chart' ? 'Done' : 'Stop download'}</button>
            : job?.reason !== 'demo' && <button className="btn sm" onClick={hist.start}><Download size={13} /> {cov?.days ? 'Download more history' : 'Download history'}</button>}
        </div>
        {err && <div className="neg" style={{ fontSize: 12.5 }}>{err}</div>}
        {!running && <div className="muted" style={{ fontSize: 12 }}>NinjaTrader, Quantower, cTrader, MetaTrader and Sierra Chart add-ons fetch a week at a time, newest first, using the contract that was front month then. ATAS sends the history of your 1-minute charts instead. Either way, prices are back-adjusted at contract rolls (no fake jumps).</div>}
        <div className="form-grid" style={{ marginTop: 4 }}>
          <div className="field"><label className="label">Test from</label><input className="input" type="date" value={from} min={cov?.first || undefined} max={to || yesterday()} onChange={(e) => patch({ from: e.target.value })} /></div>
          <div className="field"><label className="label">to</label><input className="input" type="date" value={to} min={from || undefined} max={cov?.last || yesterday()} onChange={(e) => patch({ to: e.target.value })} /></div>
        </div>
        <div className="field">
          <label className="label">In-sample (for building and tuning): {s.split}% · out-of-sample (locked): {100 - s.split}%</label>
          <Range min={50} max={90} step={5} value={s.split} disabled={!!s.oos} onChange={(v) => patch({ split: v })} style={{ width: '100%' }} />
          {splitDay && <span className="muted" style={{ fontSize: 12 }}>Tuning uses {from} – {splitDay}. {s.oos ? 'The split is fixed now that you’ve unlocked.' : `${splitDay} – ${to} stays locked until you’re done.`}</span>}
        </div>
      </div>
    </div>
  );
}

function NumOrParam({ value, onChange, params, step = 'any', width = 70 }) {
  const isP = value && typeof value === 'object' && 'p' in value;
  return (
    <span className="ab-nump">
      {isP ? <span className="chip on ab-pchip">{value.p}</span> : <input className="input" type="number" step={step} value={value ?? ''} style={{ width }} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />}
      {params.length > 0 && (
        <select className="select ab-psel" value={isP ? value.p : ''} title="Use a fixed number or one of your parameters" onChange={(e) => onChange(e.target.value ? { p: e.target.value } : Number(params.find((p) => p.name === value?.p)?.value ?? 0))}>
          <option value="">#</option>
          {params.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
      )}
    </span>
  );
}

function OperandPicker({ op, onChange, params }) {
  const k = KIND[op.k] || KIND.close;
  return (
    <span className="ab-operand">
      <select className="select" value={op.k} onChange={(e) => { const nk = KIND[e.target.value]; onChange({ k: e.target.value, ...(nk[2] === 'v' ? { v: nk[3] } : nk[2] ? { n: nk[3] } : {}) }); }}>
        {KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      {k[2] === 'n' || k[2] === 'min' ? <NumOrParam value={op.n} params={params} onChange={(n) => onChange({ ...op, n })} width={56} /> : null}
      {k[2] === 'v' ? <NumOrParam value={op.v} params={params} onChange={(v) => onChange({ ...op, v })} width={80} /> : null}
      {k[2] === 'min' && <span className="muted" style={{ fontSize: 11.5 }}>min</span>}
    </span>
  );
}

function CondList({ title, hint, conds = [], onChange, params }) {
  const set = (i, c) => onChange(conds.map((x, k) => (k === i ? c : x)));
  return (
    <div className="ab-conds">
      <div className="row between"><b style={{ fontWeight: 500, fontSize: 13 }}>{title}</b><button className="btn xs" onClick={() => onChange([...conds, { a: { k: 'close' }, op: '>', b: { k: 'ema', n: 21 } }])}><Plus size={12} /> Condition</button></div>
      {hint && <div className="muted" style={{ fontSize: 12 }}>{hint}</div>}
      {conds.map((c, i) => (
        <div key={i} className="ab-cond">
          <OperandPicker op={c.a} params={params} onChange={(a) => set(i, { ...c, a })} />
          <select className="select ab-op" value={c.op} onChange={(e) => set(i, { ...c, op: e.target.value })}>{OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <OperandPicker op={c.b} params={params} onChange={(b) => set(i, { ...c, b })} />
          <button className="icon-btn" title="Remove" onClick={() => onChange(conds.filter((_, k) => k !== i))}><X size={14} /></button>
        </div>
      ))}
      {!conds.length && <div className="muted" style={{ fontSize: 12.5 }}>None.</div>}
    </div>
  );
}

function StrategyPanel({ s, setSpec }) {
  const sp = s.spec;
  const [help, setHelp] = useState(false);
  return (
    <div className="panel">
      <div className="panel-head"><div className="card-title">Entries</div><Seg value={sp.mode || 'rules'} onChange={(v) => setSpec({ mode: v })} options={[{ value: 'rules', label: 'Rules' }, { value: 'code', label: 'Code' }]} /></div>
      <div className="row gap12 wrap" style={{ marginBottom: 12, fontSize: 13 }}>
        <label className="row gap6">Timeframe <select className="select ab-small" value={sp.tf} onChange={(e) => setSpec({ tf: Number(e.target.value) })}>{TFS.map((x) => <option key={x} value={x}>{x}m</option>)}</select></label>
        <Seg value={sp.side || 'both'} onChange={(v) => setSpec({ side: v })} options={[{ value: 'both', label: 'Both' }, { value: 'long', label: 'Longs' }, { value: 'short', label: 'Shorts' }]} />
      </div>
      {(sp.mode || 'rules') === 'rules' ? (
        <div className="col gap16">
          <CondList title="Go long when all of these are true" conds={sp.long} params={s.params || []} onChange={(long) => setSpec({ long })} />
          <CondList title="Go short when all of these are true" conds={sp.short} params={s.params || []} onChange={(short) => setSpec({ short })} />
          <CondList title="Exit early when any of these is true" hint="Optional — on top of the stop, target and time rules." conds={sp.exitWhen} params={s.params || []} onChange={(exitWhen) => setSpec({ exitWhen })} />
          <div className="muted" style={{ fontSize: 12 }}>Signals are read when a {sp.tf}-minute bar closes and fill at the next 1-minute bar’s open.</div>
        </div>
      ) : (
        <div className="col gap8">
          <textarea className="textarea ab-code" spellCheck={false} value={sp.code || CODE_TEMPLATE} onChange={(e) => setSpec({ code: e.target.value })} />
          <div className="row gap8"><button className="btn xs ghost" onClick={() => setHelp((x) => !x)}><Info size={12} /> {help ? 'Hide' : 'How it works'}</button><button className="btn xs ghost" onClick={() => setSpec({ code: CODE_TEMPLATE })}>Reset to the example</button></div>
          {help && (
            <div className="muted ab-help">
              <p><code>onBar(bar, i, ctx)</code> runs once per closed bar of your timeframe. <code>i</code> is the bar’s index in the <code>ctx</code> arrays; <code>ctx.close[i]</code> is this bar, <code>ctx.close[i - 1]</code> the one before. Indicator functions return whole arrays (cached), so read them at <code>[i]</code>.</p>
              <p>Return <code>'buy'</code>, <code>'sell'</code> or <code>'exit'</code>. Your stop, target, max-bars and time rules below still apply. Return <code>{'{ action: \'buy\', stop: 4510, target: 4530 }'}</code> to set prices yourself.</p>
              <p>It runs in a sandboxed background thread with no access to your journal. If it hangs, press Stop.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExitsPanel({ s, setSpec }) {
  const sp = s.spec;
  const params = s.params || [];
  const sub = (key, patch) => setSpec({ [key]: { ...(sp[key] || DEFAULT_SPEC[key]), ...patch } });
  const typeSel = (key, types) => (
    <span className="row gap6 wrap">
      <select className="select ab-small" value={sp[key]?.type || 'none'} onChange={(e) => sub(key, { type: e.target.value, v: sp[key]?.v ?? (e.target.value === 'r' ? 2 : 20), n: sp[key]?.n ?? 14 })}>{types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {sp[key]?.type && sp[key].type !== 'none' && <NumOrParam value={sp[key].v} params={params} onChange={(v) => sub(key, { v })} />}
    </span>
  );
  const entry = sp.entry || DEFAULT_SPEC.entry, be = sp.be || DEFAULT_SPEC.be, sizing = sp.sizing || DEFAULT_SPEC.sizing;
  return (
    <div className="panel">
      <div className="card-title" style={{ marginBottom: 12 }}>Orders, exits & costs</div>
      <div className="ab-rows">
        <label>Entry order</label>
        <span className="row gap6 wrap">
          <select className="select ab-small" style={{ width: 'auto' }} value={entry.type} onChange={(e) => sub('entry', { type: e.target.value })}>{ENTRY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {entry.type !== 'market' && <><NumOrParam value={entry.off} params={params} onChange={(v) => sub('entry', { off: v })} width={50} /><span className="muted">ticks · lasts</span><input className="input ab-small" style={{ width: 54 }} type="number" min={1} value={entry.expire} onChange={(e) => sub('entry', { expire: e.target.value })} /><span className="muted">bars</span></>}
        </span>
        <label>Stop loss</label>{typeSel('stop', STOP_TYPES)}
        <label>Profit target</label>{typeSel('target', TARGET_TYPES)}
        <label>Trailing stop</label>{typeSel('trail', TRAIL_TYPES)}
        <label>Move stop to break-even</label>
        <span className="row gap6 wrap">
          <select className="select ab-small" style={{ width: 'auto' }} value={be.type} onChange={(e) => sub('be', { type: e.target.value })}>{BE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {be.type !== 'none' && <><NumOrParam value={be.v} params={params} onChange={(v) => sub('be', { v })} width={50} /><span className="muted">+</span><input className="input ab-small" style={{ width: 50 }} type="number" value={be.plus} onChange={(e) => sub('be', { plus: e.target.value })} /><span className="muted">ticks</span></>}
        </span>
        <label>Exit after this many bars</label><NumOrParam value={sp.maxBars} params={params} onChange={(v) => setSpec({ maxBars: v })} />
        <label>New trades only between</label><span className="row gap6"><input className="input ab-time" type="time" value={sp.entryFrom || ''} onChange={(e) => setSpec({ entryFrom: e.target.value })} /><span className="muted">–</span><input className="input ab-time" type="time" value={sp.entryTo || ''} onChange={(e) => setSpec({ entryTo: e.target.value })} /></span>
        <label>Close everything at</label><input className="input ab-time" type="time" value={sp.flatAt || ''} onChange={(e) => setSpec({ flatAt: e.target.value })} />
        <label>Close at the end of each day</label><input type="checkbox" className="cbx" checked={sp.flatEod !== false} onChange={(e) => setSpec({ flatEod: e.target.checked })} />
        <label>Max trades a day</label><NumOrParam value={sp.maxTradesDay} params={params} onChange={(v) => setSpec({ maxTradesDay: v })} />
        <label>Reverse on an opposite signal</label><input type="checkbox" className="cbx" checked={!!sp.reverse} onChange={(e) => setSpec({ reverse: e.target.checked })} />
        <label>Position size</label>
        <span className="row gap6 wrap">
          <select className="select ab-small" style={{ width: 'auto' }} value={sizing.type} onChange={(e) => sub('sizing', { type: e.target.value })}><option value="fixed">Fixed contracts</option><option value="risk">Risk $ per trade</option></select>
          {sizing.type === 'fixed' ? <input className="input ab-small" style={{ width: 60 }} type="number" min={1} value={sp.qty} onChange={(e) => setSpec({ qty: Math.max(1, Number(e.target.value) || 1) })} />
            : <><span className="muted">$</span><input className="input ab-small" style={{ width: 76 }} type="number" min={1} value={sizing.risk} onChange={(e) => sub('sizing', { risk: e.target.value })} /><span className="muted">max</span><input className="input ab-small" style={{ width: 54 }} type="number" min={1} value={sizing.max} onChange={(e) => sub('sizing', { max: e.target.value })} /></>}
        </span>
        <label>Starting capital</label><input className="input ab-small" type="number" min={0} step={1000} value={sp.initial ?? 50000} onChange={(e) => setSpec({ initial: e.target.value })} />
        <label>Commission per contract (round trip)</label><input className="input ab-small" type="number" min={0} step="0.01" value={sp.fee} onChange={(e) => setSpec({ fee: e.target.value })} />
        <label>Slippage, ticks per side</label><input className="input ab-small" type="number" min={0} step="0.5" value={sp.slip} onChange={(e) => setSpec({ slip: e.target.value })} />
        <label>Tick size · $ per point</label><span className="row gap6"><input className="input ab-small" type="number" step="any" value={sp.tick} onChange={(e) => setSpec({ tick: e.target.value })} /><input className="input ab-small" type="number" step="any" value={sp.pv} onChange={(e) => setSpec({ pv: e.target.value })} /></span>
        <label title="When one 1-minute bar touches both your stop and your target">Bar hits stop and target</label>
        <select className="select ab-small" style={{ width: 'auto' }} value={sp.path || 'worst'} onChange={(e) => setSpec({ path: e.target.value })}><option value="worst">Count the stop (safest)</option><option value="ohlc">TradingView’s rule (open → nearer extreme first)</option></select>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Times are your time zone. Everything fills on 1-minute bars, like TradingView’s Bar Magnifier. Market orders and stops pay the slippage; limit orders and targets don’t. Risk sizing divides your $ risk by the stop distance (plus commission) and skips trades it can’t size to one contract.</div>
    </div>
  );
}

function ParamsPanel({ s, patch }) {
  const params = s.params || [];
  const set = (i, p) => patch({ params: params.map((x, k) => (k === i ? { ...x, ...p } : x)) });
  return (
    <div className="panel">
      <div className="panel-head"><div className="card-title">Parameters</div><button className="btn xs" onClick={() => patch({ params: [...params, { name: `p${params.length + 1}`, value: 10, min: 5, max: 20, step: 5 }] })}><Plus size={12} /> Parameter</button></div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Numbers you want to tune. Use them in rules with the # menu next to a number, or as <code>params.name</code> in code. The range is what Optimize and Walk-forward try — keep it small: every extra setting tried makes a lucky result more likely.</div>
      {params.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl ab-ptbl">
            <thead><tr><th>Name</th><th>Value</th><th>Sweep from</th><th>to</th><th>step</th><th /></tr></thead>
            <tbody>
              {params.map((p, i) => (
                <tr key={i}>
                  <td><input className="input" value={p.name} onChange={(e) => set(i, { name: e.target.value.replace(/[^\w]/g, '') })} /></td>
                  <td><input className="input" type="number" step="any" value={p.value} onChange={(e) => set(i, { value: e.target.value })} /></td>
                  <td><input className="input" type="number" step="any" value={p.min} onChange={(e) => set(i, { min: e.target.value })} /></td>
                  <td><input className="input" type="number" step="any" value={p.max} onChange={(e) => set(i, { max: e.target.value })} /></td>
                  <td><input className="input" type="number" step="any" value={p.step} onChange={(e) => set(i, { step: e.target.value })} /></td>
                  <td><button className="icon-btn" onClick={() => patch({ params: params.filter((_, k) => k !== i) })}><X size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- results
function Metrics({ st }) {
  const m = (label, v) => <div className="ab-metric"><span className="muted">{label}</span><b>{v}</b></div>;
  return (
    <div className="ab-metrics">
      {m('Net P&L', <Money v={st.net} colored />)}
      {m('Trades', st.trades)}
      {m('Win rate', `${st.winRate.toFixed(1)}%`)}
      {m('Profit factor', pfText(st.pf))}
      {m('Avg trade', <Money v={st.exp} colored />)}
      {m('Max drawdown', <Money v={-(st.maxDDIntra ?? st.maxDD)} colored />)}
      {m('Sharpe', st.sharpe.toFixed(2))}
      {m('Sortino', (st.sortino ?? 0).toFixed(2))}
    </div>
  );
}

/** The full report, laid out like TradingView's Performance Summary / NinjaTrader's Summary tab. */
function Report({ st }) {
  const $ = (v) => <Money v={v} colored />;
  const pct = (v, dp = 1) => (v == null ? '—' : `${v.toFixed(dp)}%`);
  const num = (v, dp = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(dp));
  const rows = [
    ['Performance', [
      ['Net P&L', $(st.net), $(st.long.net), $(st.short.net)],
      ['Gross profit / gross loss', <span><Money v={st.grossProfit} /> / <Money v={st.grossLoss} /></span>],
      ['Commission paid', <Money v={-st.fees} />],
      ['Return on starting capital', pct(st.returnPct, 2)],
      ['Annualised return (CAGR)', pct(st.cagr, 1)],
      ['Buy & hold (1 contract)', st.buyHold == null ? '—' : $(st.buyHold)],
      ['Sharpe · Sortino (daily, annualised)', `${num(st.sharpe)} · ${num(st.sortino)}`],
      ['Profit factor', pfText(st.pf)],
      ['Net ÷ max drawdown', num(st.retDD === Infinity ? Infinity : st.retDD)],
    ]],
    ['Trades', [
      ['Total trades', st.trades, st.long.trades, st.short.trades],
      ['Win rate', pct(st.winRate), pct(st.long.winRate), pct(st.short.winRate)],
      ['Winners · losers · even', `${st.wins} · ${st.losses} · ${st.even}`],
      ['Average trade', $(st.exp)],
      ['Average win · average loss', <span><Money v={st.avgWin} /> · <Money v={st.avgLoss} /></span>],
      ['Average win ÷ average loss', num(st.ratioWL)],
      ['Largest win', <span>{$(st.largestWin)} <span className="muted">({pct(st.largestWinPct, 0)} of gross profit)</span></span>],
      ['Largest loss', <span>{$(st.largestLoss)} <span className="muted">({pct(st.largestLossPct, 0)} of gross loss)</span></span>],
      ['Max consecutive wins · losses', `${st.maxConsecWins} · ${st.maxConsecLosses}`],
      ['Average bars in trades · winners · losers', `${num(st.avgBars, 1)} · ${num(st.avgBarsWin, 1)} · ${num(st.avgBarsLoss, 1)}`],
      ['Average MAE · MFE (worst / best open P&L)', <span><Money v={st.avgMae} /> · <Money v={st.avgMfe} /></span>],
      ['Time in the market', st.exposure == null ? '—' : pct(st.exposure * 100)],
    ]],
    ['Risk', [
      ['Max drawdown (intrabar)', <span>{$(-st.maxDDIntra)} <span className="muted">({pct(st.ddPct)} of capital)</span></span>],
      ['Max drawdown (close to close)', $(-st.maxDD)],
      ['Longest drawdown', `${Math.round(st.longestDD)} days`],
      ['Max run-up (intrabar · close to close)', <span><Money v={st.maxRunUpIntra} /> · <Money v={st.maxRunUp} /></span>],
      ['Average trade t-statistic', num(st.tstat)],
    ]],
  ];
  return (
    <div className="tbl-wrap">
      <table className="tbl ab-report">
        {rows.map(([title, list]) => (
          <tbody key={title}>
            <tr className="ab-report-h"><th>{title}</th><th>All</th><th>Long</th><th>Short</th></tr>
            {list.map(([label, all, lo, sh]) => <tr key={label}><td className="muted">{label}</td><td colSpan={lo === undefined ? 3 : 1}>{all}</td>{lo !== undefined && <td>{lo}</td>}{sh !== undefined && <td>{sh}</td>}</tr>)}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** Net P&L by month (rows = years). */
function Monthly({ trades }) {
  const cells = new Map();
  for (const t of trades) { const d = new Date(t.x * 1000); const k = `${d.getFullYear()}-${d.getMonth()}`; cells.set(k, (cells.get(k) || 0) + t.pnl); }
  const years = [...new Set(trades.map((t) => new Date(t.x * 1000).getFullYear()))].sort();
  const max = Math.max(1, ...[...cells.values()].map(Math.abs));
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <div className="tbl-wrap">
      <table className="tbl ab-monthly">
        <thead><tr><th />{M.map((m) => <th key={m}>{m}</th>)}<th>Year</th></tr></thead>
        <tbody>
          {years.map((y) => {
            const total = M.reduce((a, _, i) => a + (cells.get(`${y}-${i}`) || 0), 0);
            return (
              <tr key={y}><td className="muted">{y}</td>
                {M.map((_, i) => { const v = cells.get(`${y}-${i}`); return <td key={i} style={v == null ? undefined : { background: `color-mix(in srgb, var(${v >= 0 ? '--pos' : '--neg'}) ${Math.round(8 + (Math.abs(v) / max) * 40)}%, transparent)` }}>{v == null ? '' : fmtMoney(v, { dp: 0 })}</td>; })}
                <td><Money v={total} colored /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** How far below its last high the account was after each trade. */
function Underwater({ trades }) {
  const W = 800, H = 120, PAD = { l: 60, r: 10, t: 8, b: 8 };
  let eq = 0, peak = 0;
  const dd = [0, ...trades.map((t) => { eq += t.pnl; peak = Math.max(peak, eq); return eq - peak; })];
  const lo = Math.min(-1, ...dd);
  const x = (i) => PAD.l + (i / Math.max(1, dd.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (v / lo) * (H - PAD.t - PAD.b);
  const path = `M${x(0)},${y(0)}` + dd.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('') + `L${x(dd.length - 1)},${y(0)}Z`;
  return (
    <svg className="ab-under" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Drawdown">
      <path d={path} className="ab-under-area" />
      <text x={PAD.l - 6} y={PAD.t + 10} textAnchor="end" className="wi-tick">$0</text>
      <text x={PAD.l - 6} y={H - PAD.b} textAnchor="end" className="wi-tick">{fmtMoney(lo, { dp: 0 })}</text>
    </svg>
  );
}

function Results({ s, res, fresh, oosFresh, splitDay, to, onUnlock, busy, from }) {
  const { state, setAutoStrategies } = useStore();
  if (!res) return <div className="panel empty" style={{ minHeight: 280 }}>Press <b>Run backtest</b> to test {s.name} on the in-sample period.</div>;
  const st = res.is.stats;
  const checks = [];
  if (res.is.error) checks.push(['bad', `Your code threw an error — ${res.is.error}`]);
  checks.push(st.trades < 30 ? ['bad', `Only ${st.trades} trades — too few to tell skill from luck. Aim for 100+; at least 30.`] : st.trades < 100 ? ['warn', `${st.trades} trades — a start, but 100+ makes the numbers much more dependable.`] : ['ok', `${st.trades} trades — enough to take the numbers seriously.`]);
  const v = s.variations || 0;
  checks.push(v > 200 ? ['bad', `You’ve tried ${v.toLocaleString()} variations. With that many, a good-looking result can easily be luck — trust the out-of-sample and walk-forward numbers, not this one.`] : v > 30 ? ['warn', `You’ve tried ${v} variations of this strategy — the more you try, the more the best one flatters itself.`] : ['ok', `${v} variation${v === 1 ? '' : 's'} tried so far.`]);
  if (res.stress) checks.push(res.stress.net <= 0 && st.net > 0 ? ['bad', `With one more tick of slippage a side it loses money (${fmtMoney(res.stress.net)}). The edge is too thin to survive real fills.`] : ['ok', `One more tick of slippage a side: ${fmtMoney(res.stress.net, { sign: true })} (${st.net ? Math.round((res.stress.net / st.net) * 100) : 0}% of the result).`]);
  if (res.random) checks.push(res.random.beat >= 0.95 ? ['ok', `Better than ${Math.round(res.random.beat * 100)}% of ${res.random.runs} runs with random entries and the same exits.`] : res.random.beat >= 0.8 ? ['warn', `Better than ${Math.round(res.random.beat * 100)}% of random-entry runs with the same exits — the exits may be doing most of the work.`] : ['bad', `Only better than ${Math.round(res.random.beat * 100)}% of random-entry runs with the same exits — the entries add little.`]);
  if (st.trades > 1) {
    const tries = Math.max(1, v);
    const adj = 1 - Math.pow(1 - st.pLuck, tries); // Šidák: the chance at least one of your variations looks this good by luck
    checks.push(adj <= 0.05 ? ['ok', `Luck test: a result this good would come from luck alone ${(adj * 100).toFixed(adj < 0.01 ? 2 : 1)}% of the time, allowing for the ${tries} variation${tries === 1 ? '' : 's'} you tried (t = ${st.tstat.toFixed(2)}).`]
      : adj <= 0.25 ? ['warn', `Luck test: ${Math.round(adj * 100)}% chance luck alone gives a result this good after ${tries} variation${tries === 1 ? '' : 's'} (t = ${st.tstat.toFixed(2)}). Not convincing yet.`]
        : ['bad', `Luck test: ${Math.round(adj * 100)}% chance luck alone gives a result this good after ${tries} variation${tries === 1 ? '' : 's'} (t = ${st.tstat.toFixed(2)}). Indistinguishable from luck.`]);
  }
  if (res.mc) checks.push(res.mc.profitable >= 0.9 ? ['ok', `Monte Carlo: profitable in ${Math.round(res.mc.profitable * 100)}% of ${res.mc.n.toLocaleString()} reshuffles.`] : ['warn', `Monte Carlo: profitable in only ${Math.round(res.mc.profitable * 100)}% of reshuffles.`]);
  const isTrades = res.is.trades;
  const oos = res.oos;
  const link = state.strategies.find((x) => x.id === s.strategyId);
  const live = link ? state.trades.filter((t) => t.strategyId === link.id) : [];
  return (
    <div className="col gap16">
      {!fresh && <div className="ab-note"><Info size={14} /> You’ve changed the strategy since this run — press Run backtest to update.</div>}
      <div className="panel">
        <div className="panel-head"><div className="card-title">In-sample</div><span className="muted" style={{ fontSize: 12.5 }}>{isTrades.length ? `${dayOfUnix(isTrades[0].e)} – ${dayOfUnix(isTrades[isTrades.length - 1].x)}` : ''}</span></div>
        <Metrics st={st} />
        <EquitySvg a={isTrades} b={oos?.trades} />
        <div className="muted" style={{ fontSize: 12, margin: '10px 0 4px' }}>Drawdown</div>
        <Underwater trades={[...isTrades, ...(oos?.trades || [])]} />
      </div>
      <details className="panel ab-details" open>
        <summary className="card-title">Performance summary</summary>
        <Report st={st} />
      </details>
      <details className="panel ab-details">
        <summary className="card-title">Monthly P&L</summary>
        <Monthly trades={[...isTrades, ...(oos?.trades || [])]} />
      </details>
      <div className="panel">
        <div className="card-title" style={{ marginBottom: 10 }}>Checks</div>
        <div className="col gap8">
          {checks.map(([kind, text], i) => <div key={i} className={`ab-check ${kind}`}>{kind === 'ok' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}<span>{text}</span></div>)}
        </div>
        {res.mc && (
          <div className="ab-mc">
            <div><span className="muted">Likely range of P&L (5% – 95%)</span><b><Money v={res.mc.net.p5} colored /> to <Money v={res.mc.net.p95} colored /></b></div>
            <div><span className="muted">Max drawdown to plan for (95%)</span><b><Money v={-res.mc.dd.p95} colored /></b></div>
            <div><span className="muted">Random entries, median</span><b><Money v={res.random?.median || 0} colored /></b></div>
          </div>
        )}
      </div>
      <div className="panel">
        <div className="panel-head"><div className="card-title row gap8">{s.oos ? <Unlock size={15} /> : <Lock size={15} />} Out-of-sample · {splitDay} – {to}</div></div>
        {!s.oos ? (
          <div className="col gap10" style={{ fontSize: 13 }}>
            <span className="muted">This period is locked so it stays unseen while you build and tune. When you’re happy with the strategy, unlock it once: the result is the closest thing to how it would trade from here.</span>
            <div><button className="btn" disabled={busy} onClick={onUnlock}><Unlock size={14} /> Unlock and test</button></div>
          </div>
        ) : (
          <div className="col gap10">
            <span className="muted" style={{ fontSize: 12.5 }}>Unlocked {new Date(s.oos.at).toLocaleDateString()} with {Object.entries(s.oos.params || {}).map(([k, x]) => `${k} ${x}`).join(', ') || 'these settings'}.</span>
            <Metrics st={s.oos.stats} />
            {!oosFresh && <div className="ab-check warn"><AlertTriangle size={15} /><span>The strategy has changed since you unlocked. The recorded result above is the honest one; anything you see on this period now has been tuned with it in view.</span></div>}
            {oos && oosFresh && <div className="muted" style={{ fontSize: 12.5 }}>Shown in the equity curve after the dashed line.</div>}
            <OosVerdict is={st} oos={s.oos.stats} />
          </div>
        )}
      </div>
      <div className="panel">
        <div className="panel-head"><div className="card-title">Compare with your live trading</div>
          <select className="select ab-small" style={{ width: 'auto' }} value={s.strategyId || ''} onChange={(e) => { const v = e.target.value || null; setAutoStrategies((l) => l.map((x) => (x.id === s.id ? { ...x, strategyId: v } : x))); }}>
            <option value="">Pick one of your strategies…</option>
            {state.strategies.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        {link ? <LiveCompare bt={[...isTrades, ...(oos?.trades || [])]} live={live} name={link.name} /> : <div className="muted" style={{ fontSize: 13 }}>Link this backtest to a strategy in your journal to see backtest and live side by side.</div>}
      </div>
      <TradesTable trades={[...isTrades, ...(oos?.trades || [])]} s={s} />
    </div>
  );
}
function OosVerdict({ is, oos }) {
  if (!is.days || !oos.days) return null;
  const a = is.net / is.days, b = oos.net / oos.days;
  const ratio = a > 0 ? b / a : null;
  const text = oos.net <= 0 ? ['bad', 'It lost money on unseen data. Treat the in-sample result as overfitted.']
    : ratio != null && ratio >= 0.5 ? ['ok', `On unseen data it made ${Math.round(ratio * 100)}% of its in-sample P&L per day — it held up.`]
      : ['warn', `On unseen data it made ${ratio != null ? Math.round(ratio * 100) : '?'}% of its in-sample P&L per day — weaker; expect less than the backtest.`];
  return <div className={`ab-check ${text[0]}`}>{text[0] === 'ok' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}<span>{text[1]}</span></div>;
}
function LiveCompare({ bt, live, name }) {
  const a = summarize(bt.map((t) => ({ pnl: t.pnl }))), b = summarize(live);
  const row = (label, f, money) => <tr key={label}><td className="muted">{label}</td><td>{money ? <Money v={f(a)} colored /> : f(a)}</td><td>{live.length ? (money ? <Money v={f(b)} colored /> : f(b)) : '—'}</td></tr>;
  return (
    <div className="tbl-wrap">
      <table className="tbl bt-compare">
        <thead><tr><th /><th>Backtest</th><th>Live · {name}</th></tr></thead>
        <tbody>
          {row('Trades', (x) => x.count)}
          {row('Win rate', (x) => (x.count ? `${Math.round(x.winRate)}%` : '—'))}
          {row('Profit factor', (x) => (x.count ? pfText(x.profitFactor) : '—'))}
          {row('Average win', (x) => x.avgWin || 0, true)}
          {row('Average loss', (x) => -Math.abs(x.avgLoss || 0), true)}
          {row('Average trade', (x) => (x.count ? x.net / x.count : 0), true)}
        </tbody>
      </table>
    </div>
  );
}
function TradesTable({ trades, s }) {
  const [n, setN] = useState(50);
  const [view, setView] = useState(null);
  if (!trades.length) return null;
  const list = [...trades].reverse();
  const why = { stop: 'Stop', trail: 'Trailing stop', target: 'Target', signal: 'Exit rule', bars: 'Max bars', time: 'Time', eod: 'End of day', end: 'End of test', reverse: 'Reversed' };
  const csv = () => {
    const head = ['entry_time', 'side', 'qty', 'entry_price', 'exit_time', 'exit_price', 'exit_reason', 'pnl', 'commission', 'mae', 'mfe', 'bars'];
    const lines = trades.map((t) => [localIso(t.e), t.d > 0 ? 'long' : 'short', t.q, t.ep, localIso(t.x), t.xp, t.r, t.pnl, t.fee ?? '', t.mae ?? '', t.mfe ?? '', t.bars].join(','));
    const url = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `${s.name.replace(/[^\w-]+/g, '-')}-trades.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  // the price series the backtest ran on (back-adjusted), for the chart
  const series = [...seriesCache.values()][0];
  const candleSource = (date) => {
    const out = [];
    if (series) for (let i = 0; i < series.n; i++) if (keyOf(new Date(series.t[i] * 1000)) === date) out.push([series.t[i], series.o[i], series.h[i], series.l[i], series.c[i], series.v[i]]);
    return { candles: out, interval: '1m', source: 'Backtest prices' };
  };
  const asJournal = (t) => ({ id: `bt${t.e}`, symbol: s.symbol, direction: t.d > 0 ? 'Long' : 'Short', entry: localIso(t.e), exit: localIso(t.x), entryPrice: t.ep, exitPrice: t.xp, qty: t.q, pnl: t.pnl, fees: t.fee || 0 });
  return (
    <div className="panel">
      <div className="panel-head"><div className="card-title">Trades</div><span className="row gap8"><span className="muted" style={{ fontSize: 12.5 }}>{trades.length.toLocaleString()} · newest first · click one to see it on the chart</span><button className="btn xs" onClick={csv}><FileDown size={12} /> CSV</button></span></div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Entry</th><th>Side</th><th>Entry price</th><th>Exit</th><th>Exit price</th><th>Why</th><th>MAE</th><th>MFE</th><th>P&L</th></tr></thead>
          <tbody>
            {list.slice(0, n).map((t, i) => (
              <tr key={i} onClick={() => setView(t)} style={{ cursor: 'pointer' }}><td>{fmtT(t.e)}</td><td className={t.d > 0 ? 'pos' : 'neg'}>{t.d > 0 ? 'Long' : 'Short'}{t.q > 1 ? ` ×${t.q}` : ''}</td><td>{+t.ep.toFixed(4)}</td><td className="muted">{fmtT(t.x)}</td><td>{+t.xp.toFixed(4)}</td><td className="muted">{why[t.r] || t.r}</td><td className="neg">{t.mae != null ? fmtMoney(t.mae, { dp: 0 }) : ''}</td><td className="pos">{t.mfe != null ? fmtMoney(t.mfe, { dp: 0 }) : ''}</td><td><Money v={t.pnl} colored /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > n && <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setN((x) => x + 200)}>Show more</button>}
      {view && (
        <Suspense fallback={null}>
          <ChartStudio date={keyOf(new Date(view.e * 1000))} trades={trades.filter((t) => keyOf(new Date(t.e * 1000)) === keyOf(new Date(view.e * 1000))).map(asJournal)} candleSource={candleSource} onClose={() => setView(null)} />
        </Suspense>
      )}
    </div>
  );
}

/** Equity of the in-sample trades, then (dashed divider) the out-of-sample ones. */
function EquitySvg({ a, b }) {
  const { state } = useStore();
  const W = 800, H = 230, PAD = { l: 60, r: 10, t: 10, b: 22 };
  const all = [...a, ...(b || [])];
  if (!all.length) return <div className="muted" style={{ padding: 20, fontSize: 13 }}>No trades.</div>;
  let eq = 0;
  const pts = [{ y: 0 }, ...all.map((t) => ({ y: (eq += t.pnl) }))];
  const lo = Math.min(0, ...pts.map((p) => p.y)), hi = Math.max(0, ...pts.map((p) => p.y)), span = hi - lo || 1;
  const x = (i) => PAD.l + (i / Math.max(1, pts.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - (v - lo) / span) * (H - PAD.t - PAD.b);
  const cut = a.length;
  const path = (s, e) => pts.slice(s, e + 1).map((p, k) => `${k ? 'L' : 'M'}${x(s + k).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  const m = (v) => (state.settings.privacy ? '•••' : fmtMoney(v, { dp: 0 }));
  return (
    <svg className="wi-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Equity curve">
      {[lo, (lo + hi) / 2, hi].map((v, i) => <g key={i}><line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="wi-grid-line" /><text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="wi-tick">{m(v)}</text></g>)}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="wi-zero" />
      <path d={path(0, cut)} className="wi-line-now" />
      {b?.length > 0 && <><line x1={x(cut)} x2={x(cut)} y1={PAD.t} y2={H - PAD.b} className="wi-zero" /><path d={path(cut, pts.length - 1)} className="ab-line-oos" /><text x={x(cut) + 6} y={PAD.t + 12} className="wi-tick">out-of-sample</text></>}
      <text x={PAD.l} y={H - 5} className="wi-tick">{dayOfUnix(all[0].e)}</text>
      <text x={W - PAD.r} y={H - 5} textAnchor="end" className="wi-tick">{dayOfUnix(all[all.length - 1].x)}</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------- optimize
function Optimize({ s, patch, sw, grid, combos, onRun, busy }) {
  const metric = s.objective || 'net';
  const fmtM = (v) => (metric === 'net' || metric === 'exp' ? fmtMoney(v, { dp: 0 }) : Number(v).toFixed(2));
  const apply = (P) => patch({ params: (s.params || []).map((p) => (P[p.name] !== undefined ? { ...p, value: P[p.name] } : p)) });
  return (
    <div className="col gap16">
      <div className="panel">
        <div className="card-title" style={{ marginBottom: 8 }}>Parameter sweep</div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Runs every combination of your parameter ranges on the in-sample period. Pick the <b>most robust</b> setting — the one whose neighbours do well too — not the single best: a lonely peak is usually luck.</div>
        <div className="row gap12 wrap" style={{ fontSize: 13 }}>
          <label className="row gap6">Optimize for <select className="select ab-small" style={{ width: 'auto' }} value={metric} onChange={(e) => patch({ objective: e.target.value })}>{OBJECTIVES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="row gap6">Ignore settings with fewer than <input className="input ab-small" type="number" min={1} value={s.minTrades ?? 30} onChange={(e) => patch({ minTrades: e.target.value })} /> trades</label>
          <div className="grow" />
          <span className="muted">{grid.length ? `${combos.toLocaleString()} combinations (${grid.map((g) => `${g.name}: ${g.values.length}`).join(' × ')})` : 'No parameter ranges yet'}</span>
          <button className="btn white" disabled={busy || !grid.length} onClick={onRun}><Play size={14} /> Sweep</button>
        </div>
      </div>
      {sw && (
        <div className="panel">
          <div className="panel-head"><div className="card-title">Results · {OBJECTIVES.find((o) => o[0] === sw.metric)?.[1]}</div></div>
          <div className="row gap12 wrap" style={{ marginBottom: 12 }}>
            {sw.robust && <div className="ab-pick robust"><b>Most robust</b><span>{Object.entries(sw.robust.P).filter(([k]) => grid.some((g) => g.name === k)).map(([k, v]) => `${k} ${v}`).join(' · ')}</span><button className="btn xs" onClick={() => apply(sw.robust.P)}>Use these</button></div>}
            {sw.best && <div className="ab-pick"><b>Single best</b><span>{Object.entries(sw.best.P).filter(([k]) => grid.some((g) => g.name === k)).map(([k, v]) => `${k} ${v}`).join(' · ')}</span><button className="btn xs ghost" onClick={() => apply(sw.best.P)}>Use these</button></div>}
          </div>
          <Heat sw={sw} grid={grid} fmtM={fmtM} />
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>{Math.round((sw.cells.filter((c) => c.net > 0).length / sw.cells.length) * 100)}% of the settings tried were profitable. A strategy with a real edge is profitable across most of its range; if only a few corners work, it’s probably fitting noise.</div>
        </div>
      )}
    </div>
  );
}
function Heat({ sw, grid, fmtM }) {
  const [hover, setHover] = useState(null);
  const vals = sw.cells.map((c) => c.m);
  const max = Math.max(...vals.map(Math.abs), 1e-9);
  const color = (v, ok) => (!ok ? 'var(--border)' : v >= 0 ? `color-mix(in srgb, var(--pos) ${Math.round(15 + (v / max) * 75)}%, transparent)` : `color-mix(in srgb, var(--neg) ${Math.round(15 + (-v / max) * 75)}%, transparent)`);
  const isR = (c) => sw.robust && c.ix.join() === sw.robust.ix.join();
  const isB = (c) => sw.best && c.ix.join() === sw.best.ix.join();
  const tip = hover && <div className="ab-heat-tip">{Object.entries(hover.P).filter(([k]) => grid.some((g) => g.name === k)).map(([k, v]) => `${k} ${v}`).join(' · ')} — {fmtM(hover.m)} · {hover.trades} trades · neighbours {fmtM(hover.robust)}{!hover.ok ? ' · too few trades' : ''}</div>;
  if (grid.length === 2) {
    const [gx, gy] = grid;
    return (
      <div>
        <div className="ab-heat" style={{ gridTemplateColumns: `auto repeat(${gx.values.length}, minmax(26px, 1fr))` }}>
          <span className="ab-heat-corner muted">{gy.name} ↓ · {gx.name} →</span>
          {gx.values.map((v) => <span key={v} className="ab-heat-ax">{v}</span>)}
          {gy.values.map((vy, iy) => (
            <FragmentRow key={vy}>
              <span className="ab-heat-ax">{vy}</span>
              {gx.values.map((vx, ix) => {
                const c = sw.cells.find((q) => q.ix[0] === ix && q.ix[1] === iy);
                return <span key={vx} className={`ab-cell ${isR(c) ? 'robust' : ''} ${isB(c) ? 'best' : ''}`} style={{ background: color(c.m, c.ok) }} onMouseEnter={() => setHover(c)} onMouseLeave={() => setHover(null)} />;
              })}
            </FragmentRow>
          ))}
        </div>
        <div className="row gap16 muted" style={{ fontSize: 12, marginTop: 8 }}><span><i className="ab-key robust" /> most robust</span><span><i className="ab-key best" /> single best</span><span>grey = too few trades</span></div>
        {tip}
      </div>
    );
  }
  if (grid.length === 1) {
    return (
      <div>
        <div className="ab-bars">
          {sw.cells.map((c, i) => <div key={i} className={`ab-bar ${isR(c) ? 'robust' : ''}`} onMouseEnter={() => setHover(c)} onMouseLeave={() => setHover(null)}><i style={{ height: `${Math.max(2, (Math.abs(c.m) / max) * 100)}%`, background: color(c.m, c.ok) }} className={c.m < 0 ? 'down' : ''} /><span>{grid[0].values[c.ix[0]]}</span></div>)}
        </div>
        {tip}
      </div>
    );
  }
  const top = [...sw.cells].sort((a, b) => b.robust - a.robust).slice(0, 25);
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr>{grid.map((g) => <th key={g.name}>{g.name}</th>)}<th>Result</th><th>Neighbours</th><th>Trades</th></tr></thead>
        <tbody>{top.map((c, i) => <tr key={i} className={isR(c) ? 'ab-row-robust' : ''}>{grid.map((g) => <td key={g.name}>{c.P[g.name]}</td>)}<td>{fmtM(c.m)}</td><td>{fmtM(c.robust)}</td><td>{c.trades}</td></tr>)}</tbody>
      </table>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Top 25 by robustness, of {sw.total.toLocaleString()}.</div>
    </div>
  );
}
const FragmentRow = ({ children }) => <>{children}</>;

// ---------------------------------------------------------------------------------------------- walk-forward
function WalkForward({ s, patch, wf, grid, combos, onRun, busy }) {
  return (
    <div className="col gap16">
      <div className="panel">
        <div className="card-title" style={{ marginBottom: 8 }}>Walk-forward</div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Tune on a stretch of days, trade the next stretch with the setting it picked, slide forward and repeat. Every trade it counts was taken on days the tuning hadn’t seen — the most honest preview of re-tuning it as you go. {s.oos ? 'Uses all your history (out-of-sample is unlocked).' : 'Stays inside the in-sample period while out-of-sample is locked.'}</div>
        <div className="row gap12 wrap" style={{ fontSize: 13 }}>
          <label className="row gap6">Tune on <input className="input ab-small" type="number" min={10} value={s.wfTrain ?? 120} onChange={(e) => patch({ wfTrain: e.target.value })} /> trading days</label>
          <label className="row gap6">then trade <input className="input ab-small" type="number" min={5} value={s.wfTest ?? 40} onChange={(e) => patch({ wfTest: e.target.value })} /> days</label>
          <div className="grow" />
          <span className="muted">{grid.length ? (combos <= 400 ? `${combos} settings tuned each step` : 'Too many combinations to tune each step — uses your current values') : 'No parameter ranges: uses your current values'}</span>
          <button className="btn white" disabled={busy} onClick={onRun}><Play size={14} /> Run</button>
        </div>
      </div>
      {wf && (
        <div className="panel">
          <div className="panel-head"><div className="card-title">Out-of-sample trades from every step</div>{wf.efficiency != null && <span className={`badge ${wf.efficiency >= 0.5 ? 'pos-soft' : 'neg-soft'}`}>Efficiency {Math.round(wf.efficiency * 100)}%</span>}</div>
          {wf.folds.length ? <>
            <Metrics st={wf.stats} />
            <EquitySvg a={wf.oos} />
            <div className="muted" style={{ fontSize: 12, margin: '6px 0 12px' }}>Efficiency = P&L per day on the traded stretches ÷ P&L per day on the tuning stretches. Above ~50% means what the tuning found mostly carried over.</div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Tuned on</th><th>Setting</th><th>Tuning P&L</th><th>Traded</th><th>Trades</th><th>P&L</th></tr></thead>
                <tbody>{wf.folds.map((f, i) => <tr key={i}><td className="muted">{dayOfUnix(f.train.from)} – {dayOfUnix(f.train.to - 1)}</td><td>{Object.entries(f.P).filter(([k]) => grid.some((g) => g.name === k)).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}</td><td><Money v={f.trainStats.net} colored /></td><td className="muted">{dayOfUnix(f.test.from)} – {dayOfUnix(f.test.to - 1)}</td><td>{f.testStats.trades}</td><td><Money v={f.testStats.net} colored /></td></tr>)}</tbody>
              </table>
            </div>
          </> : <div className="muted">Not enough history for one step — shorten the tuning stretch or download more history.</div>}
        </div>
      )}
    </div>
  );
}
