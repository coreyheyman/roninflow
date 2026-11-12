import { StatLabel } from '../components/StatInfo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChartArea, ChartLine, ChartColumn, Trophy, Minus, TrendingDown, TrendingUp, Check, LayoutGrid, Plus, RotateCcw, Search, Undo2, X, ArrowUpRight } from 'lucide-react';
import { useStore, useAccountTrades, navigate } from '../store/store';
import { AccountPicker, DateRange, Popover, Seg, TrendBadge, Private, useSize } from '../components/ui';
import { PnlChart, Sparkline, Gauge, RateBar, HBars, MarkerScale } from '../components/Charts';
import { FilterButton, applyFilters, EMPTY_FILTERS } from '../components/Filters';
import { PnlCalendar } from '../components/Calendar';
import { useOpenDay } from '../lib/dayPopup';
import { TradeDrawer } from '../components/TradeForms';
import { BlockerStrip, TierCards, useRisk } from '../components/Playbook';
import { balanceGap } from '../lib/balance';
import { portfolioStats } from '../lib/accountStats';
import AccountProgress from '../components/AccountProgress';
import DashGrid from '../components/DashGrid';
import { addItem, removeItem } from '../lib/grid';
import { CATEGORIES, DASHBOARDS, WIDGETS, layoutFor, optionOf, presetLayout, searchWidgets } from '../lib/widgets';
import {
  summarize, equityCurve, inRange, mostTraded, fmtShortDate, fmtDate, fmtTime12, fmtTime24, fmtHold, pfText, groupByDay, sortByEntry, pctChange,
  WEEKDAYS, toDate, fmtMoney, keyOf, HOLD_CAP_SECONDS, money0, perfRatio, maxDrawdown, romad, ratioText, holdSeconds,
} from '../lib/stats';

function previousRange(range, allTrades) {
  if (!range.from || !range.to) {
    // All time: compare against everything before the last session
    const days = groupByDay(allTrades);
    if (days.length < 2) return null;
    return { to: days[1].date, from: null };
  }
  const f = toDate(range.from), t = toDate(range.to);
  const len = Math.round((t - f) / 86400000) + 1;
  const pt = new Date(f); pt.setDate(pt.getDate() - 1);
  const pf = new Date(pt); pf.setDate(pf.getDate() - len + 1);
  return { from: keyOf(pf), to: keyOf(pt) };
}

// widgets that show something even when no trades match the filters
const NO_TRADES_OK = new Set(['progress', 'risk', 'blockers', 'payouts']);

export default function Dashboard() {
  const openDay = useOpenDay();
  const { state, setSetting } = useStore();
  const all = useAccountTrades();
  const [range, setRange] = useState({ from: null, to: null });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const name = DASHBOARDS.includes(state.settings.dashView) ? state.settings.dashView : 'My Dashboard';
  const [editing, setEditing] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [openTrade, setOpenTrade] = useState(null);
  const history = useRef([]);
  const [, bump] = useState(0);

  const layout = useMemo(() => layoutFor(state.settings, name), [state.settings, name]);
  const save = (next, undoable = true) => {
    if (undoable) { history.current = [...history.current.slice(-30), layout]; bump((n) => n + 1); }
    setSetting('dashLayouts', { ...(state.settings.dashLayouts || {}), [name]: next });
  };
  const undo = () => {
    const prev = history.current.pop();
    bump((n) => n + 1);
    if (prev) save(prev, false);
  };
  const reset = () => save(presetLayout(name));
  const add = (id) => {
    const next = addItem(layout, id, WIDGETS[id].w, WIDGETS[id].h);
    save(next);
    // bring the new widget into view once it's drawn
    setTimeout(() => document.querySelector(`.gw[data-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };
  const remove = (id) => save(removeItem(layout, id));
  const setOpt = (id, key, value) => save(layout.map((i) => (i.id === id ? { ...i, opts: { ...(i.opts || {}), [key]: value } } : i)));
  const finish = () => { setEditing(false); setLibOpen(false); history.current = []; };
  const switchTo = (n) => { setSetting('dashView', n); history.current = []; bump((x) => x + 1); };

  useEffect(() => {
    if (!editing) return undefined;
    const k = (e) => {
      if (e.key === 'Escape' && !libOpen) finish();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !/INPUT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const trades = useMemo(() => applyFilters(all.filter((t) => inRange(t, range)), filters), [all, range, filters]);
  const prevTrades = useMemo(() => {
    const pr = previousRange(range, all);
    return pr ? applyFilters(all.filter((t) => inRange(t, pr)), filters) : [];
  }, [all, range, filters]);
  const s = useMemo(() => summarize(trades), [trades]);
  const p = useMemo(() => summarize(prevTrades), [prevTrades]);
  const curve = useMemo(() => equityCurve(trades), [trades]);
  const dd = useMemo(() => maxDrawdown(trades), [trades]);
  const days = useMemo(() => groupByDay(trades), [trades]);
  const account = state.accounts.find((a) => a.id === state.settings.account);
  const initial = account?.initial || state.accounts.filter((a) => all.some((t) => t.accountId === a.id)).reduce((a, x) => a + x.initial, 0) || 50000;
  // all-time view: P&L = live balance − starting balance (the gap to the trades is shown underneath)
  const unfiltered = !range.from && !range.to && JSON.stringify(filters) === JSON.stringify(EMPTY_FILTERS);
  const gap = unfiltered ? balanceGap(state) : 0;

  const ctx = { trades, prevTrades, s, p, curve, dd, days, initial, gap, openDay, setOpenTrade, state, setOpt };

  const renderItem = (it) => {
    if (!trades.length && !NO_TRADES_OK.has(it.id)) {
      return <Frame title={WIDGETS[it.id].name}><div className="w-empty">No trades in this view</div></Frame>;
    }
    return <WidgetView item={it} c={ctx} />;
  };

  const renderSettings = (it) => {
    const opts = WIDGETS[it.id]?.options || [];
    if (!opts.length) return <div className="muted" style={{ fontSize: 13 }}>This widget has no options.</div>;
    return opts.map((o) => (
      <div key={o.key} className="gw-opt">
        <span>{o.label}</span>
        <Seg value={optionOf(it, o.key)} onChange={(v) => setOpt(it.id, o.key, v)} options={o.choices.map(([value, label]) => ({ value, label }))} />
      </div>
    ));
  };

  return (
    <div className="page">
      <div className="toolbar">
        <AccountPicker />
        <DateRange value={range} onChange={setRange} />
        <div className="grow" />
        <Popover
          align="right"
          trigger={({ toggle }) => (
            <button className="btn" onClick={toggle} style={{ fontWeight: 600, color: 'var(--fg)', minWidth: 140 }}>{name} <ChevronDown size={15} className="muted" /></button>
          )}
        >
          {(close) => DASHBOARDS.map((l) => (
            <button key={l} className={`pop-item ${l === name ? 'on' : ''}`} onClick={() => { switchTo(l); close(); }}>
              <LayoutGrid size={14} /> <span className="grow">{l}</span> {l === name && <Check size={14} />}
            </button>
          ))}
        </Popover>
        <div className="sep-v" style={{ margin: '4px 6px' }} />
        <FilterButton value={filters} onChange={setFilters} trades={all} />
        <div className="sep-v" style={{ margin: '4px 6px' }} />
        {!editing && <button className="btn" onClick={() => setEditing(true)}>Edit layout</button>}
      </div>

      {editing && (
        <div className="dedit-bar">
          <span className="dedit-dot" />
          <div className="dedit-txt"><b>Editing {name}</b><span>Drag widgets to move them, drag a corner to resize. Changes save as you go.</span></div>
          <div className="grow" />
          <button className="btn" onClick={undo} disabled={!history.current.length} title="Undo (Ctrl+Z)"><Undo2 size={14} /> <span className="hide-m">Undo</span></button>
          <button className="btn" onClick={reset} title="Put this dashboard back to how it started"><RotateCcw size={14} /> <span className="hide-m">Reset</span></button>
          <button className={`btn ${libOpen ? 'on' : ''}`} onClick={() => setLibOpen((o) => !o)}><Plus size={14} /> Add widgets</button>
          <button className="btn white" onClick={finish}><Check size={14} /> Done</button>
        </div>
      )}

      {trades.length === 0 && !editing && (
        <div className="panel empty" style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 16, color: 'var(--fg)' }}>No trades in this view</div>
          <div>Change the date range or filters, or add a trade from the Trading Journal.</div>
          <button className="btn white" onClick={() => navigate('journal/database')}>Go to Trading Journal</button>
        </div>
      )}

      {layout.length === 0 && (
        <div className="panel empty">
          <div style={{ fontSize: 16, color: 'var(--fg)' }}>This dashboard is empty</div>
          <div>Add widgets to build it up, or put it back to how it started.</div>
          <div className="row gap8">
            <button className="btn" onClick={reset}><RotateCcw size={14} /> Reset</button>
            <button className="btn white" onClick={() => { setEditing(true); setLibOpen(true); }}><Plus size={14} /> Add widgets</button>
          </div>
        </div>
      )}

      <DashGrid layout={layout} editing={editing} onChange={save} renderItem={renderItem} renderSettings={renderSettings} onRemove={remove} />

      {libOpen && <WidgetLibrary layout={layout} onAdd={add} onRemove={remove} onClose={() => setLibOpen(false)} />}
      {openTrade && <TradeDrawer trade={openTrade} onClose={() => setOpenTrade(null)} />}
    </div>
  );
}

/** Side panel listing every widget, by category, with a search. */
function WidgetLibrary({ layout, onAdd, onRemove, onClose }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const list = searchWidgets(q, cat);
  const on = new Set(layout.map((i) => i.id));
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <aside className="wlib" aria-label="Add widgets">
      <div className="wlib-h">
        <b>Add widgets</b>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <label className="wlib-search"><Search size={14} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search widgets…" aria-label="Search widgets" /></label>
      <div className="wlib-cats">
        {CATEGORIES.map((c) => <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>{c.label}</button>)}
      </div>
      <div className="wlib-list">
        {list.length === 0 && <div className="muted" style={{ padding: 16, fontSize: 13 }}>No widgets match “{q}”.</div>}
        {list.map((w) => (
          <div key={w.id} className={`wlib-item ${on.has(w.id) ? 'added' : ''}`}>
            <div className="wlib-ico"><MiniShape id={w.id} /></div>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="wlib-name">{w.name}</div>
              <div className="wlib-desc">{w.desc}</div>
            </div>
            {on.has(w.id)
              ? <button className="btn xs wlib-on" onClick={() => onRemove(w.id)} title="On the dashboard — click to remove"><Check size={13} /> <span>Added</span></button>
              : <button className="btn xs" onClick={() => onAdd(w.id)}><Plus size={13} /> Add</button>}
          </div>
        ))}
      </div>
    </aside>
  );
}

/** Tiny picture of a widget's default shape for the library. */
function MiniShape({ id }) {
  const w = WIDGETS[id];
  const cols = 12, W = 34, H = 26;
  const ww = Math.max(6, (w.w / cols) * W), hh = Math.max(5, Math.min(H, (w.h / 13) * H));
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true"><rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="3" className="ms-bg" /><rect x="3" y="3" width={Math.min(ww, W - 6)} height={Math.min(hh, H - 6)} rx="2" className={`ms-fg ${w.cat}`} /></svg>;
}

const Frame = ({ title, right, children, className = '', bodyRef }) => (
  <div className={`panel wpanel ${className}`}>
    <div className="panel-head"><div className="card-title truncate">{title}</div>{right}</div>
    <div className="wbody" ref={bodyRef}>{children}</div>
  </div>
);

/** One widget's content. */
function WidgetView({ item, c }) {
  const { s, p, trades, prevTrades, curve, dd, days, initial, gap } = c;
  const id = item.id;
  const fin = (v) => (v === Infinity ? 99 : v === -Infinity ? -99 : v);
  const sctx = { ...s, maxDD: dd };
  switch (id) {
    case 'net': {
      const totalNet = s.net + gap;
      return (
        <div className={`kpi wkpi ${totalNet >= 0 ? 'posc' : 'negc'}`}>
          <div className="kpi-head"><StatLabel k="net" v={s.net} ctx={sctx}>Total P&L</StatLabel> <TrendBadge value={(totalNet / initial) * 100} /></div>
          <div className="kpi-val"><Private>{fmtMoney(totalNet)}</Private></div>
          <div className="kpi-sub">{gap
            ? <span title="Total P&L is your ATAS balance minus your starting balance. The adjustment is what the trades in the journal don't account for (missing fills, account fees…).">Trades <Private>{fmtMoney(s.net)}</Private> · balance adj. <Private>{fmtMoney(gap, { sign: true })}</Private></span>
            : <>Avg: <Private>{fmtMoney(s.avgTrade)}</Private></>}</div>
          <Sparkline values={[0, ...curve.map((x) => x.y)]} />
          <div className="kpi-foot">{s.count} closed positions</div>
        </div>
      );
    }
    case 'winRate':
      return (
        <div className={`kpi wkpi ${s.winRate >= 50 ? 'posc' : 'negc'}`}>
          <div className="kpi-head"><StatLabel k="winRate" v={s.winRate} ctx={sctx}>Win Rate</StatLabel> <TrendBadge value={prevTrades.length ? pctChange(s.winRate, p.winRate) : s.winRate - 50} /></div>
          <div className="row gap24 wkpi-mid">
            <div className="kpi-val" style={{ margin: 0 }}>{Math.round(s.winRate)}%</div>
            <div className="grow"><RateBar pct={s.winRate} /></div>
          </div>
          <div className="kpi-sub row gap16"><span className="neg">L: {s.losses}</span><span>BE: {s.be}</span><span className="pos">W: {s.wins}</span></div>
          <div className="kpi-foot">{s.count} closed positions</div>
        </div>
      );
    case 'profitFactor':
      return (
        <div className={`kpi wkpi ${s.profitFactor >= 1 ? 'posc' : 'negc'}`}>
          <div className="kpi-head"><StatLabel k="profitFactor" v={s.profitFactor} ctx={sctx}>Profit Factor</StatLabel> <TrendBadge value={prevTrades.length ? pctChange(fin(s.profitFactor), fin(p.profitFactor)) : (s.profitFactor - 1) * 100} /></div>
          <div className="wkpi-gauge">
            <Gauge value={s.profitFactor} />
            <div className="wkpi-gauge-v">{pfText(s.profitFactor)}</div>
          </div>
          <div className="kpi-foot" style={{ textAlign: 'center' }}>Gross profit / gross loss ratio</div>
        </div>
      );
    case 'perfRatio': {
      const pr = perfRatio(s), prPrev = perfRatio(p);
      return (
        <div className={`kpi wkpi ${pr >= 0.5 ? 'posc' : 'negc'}`}>
          <div className="kpi-head"><StatLabel k="perfRatio" v={pr} ctx={sctx}>Performance Ratio</StatLabel> <TrendBadge value={prevTrades.length ? pctChange(fin(pr), fin(prPrev)) : (fin(pr) - 0.5) * 100} /></div>
          <div className="kpi-val wkpi-v2">{ratioText(pr)}</div>
          <div className="kpi-sub muted" style={{ fontWeight: 400, fontSize: 13 }}>{Math.round(s.winRate)}% win × {s.avgLoss ? (s.avgWin / Math.abs(s.avgLoss)).toFixed(2) : '∞'} avg win/loss</div>
          <div style={{ margin: '14px 0 10px' }}><MarkerScale value={pr} min={0} max={1.5} marks={[{ v: 0.5, color: 'var(--neg)', label: '0.5 good' }, { v: 0.75, color: 'var(--pos)', label: '0.75 great' }]} /></div>
          <div className="kpi-foot">Win% × avg win / avg loss</div>
        </div>
      );
    }
    case 'romad': {
      const ro = romad(s.net, dd), roPrev = romad(p.net, maxDrawdown(prevTrades));
      return (
        <div className={`kpi wkpi ${ro >= 1 ? 'posc' : 'negc'}`}>
          <div className="kpi-head"><StatLabel k="romad" v={ro} ctx={sctx}>ROMAD</StatLabel> <TrendBadge value={prevTrades.length ? pctChange(fin(ro), fin(roPrev)) : (fin(ro) - 1) * 100} /></div>
          <div className="kpi-val wkpi-v2">{ratioText(ro)}</div>
          <div className="kpi-sub muted" style={{ fontWeight: 400, fontSize: 13 }}><Private>{fmtMoney(s.net, { dp: 0, sign: true })}</Private> P&L ÷ <Private>{fmtMoney(dd, { dp: 0 })}</Private> max drawdown</div>
          <div style={{ margin: '14px 0 10px' }}><MarkerScale value={ro} min={-2} max={4} marks={[{ v: 1, color: 'var(--warn)', label: '1' }, { v: 2, color: 'var(--pos)', label: '2 high quality' }]} /></div>
          <div className="kpi-foot">Return over max drawdown</div>
        </div>
      );
    }
    case 'mostTraded': {
      const top = mostTraded(trades)[0];
      const prevTop = prevTrades.filter((t) => t.symbol === top?.symbol).reduce((a, t) => a + t.pnl, 0);
      return (
        <div className={`kpi wkpi ${(top?.pnl || 0) >= 0 ? 'posc' : 'negc'}`}>
          <div className="kpi-head"><StatLabel k="mostTraded" v={top?.pnl || 0} ctx={sctx}>Most Traded</StatLabel> {top && <TrendBadge value={prevTrades.length ? pctChange(top.pnl, prevTop) : (top.pnl / initial) * 100} />}</div>
          <div className="kpi-val"><Private>{fmtMoney(top?.pnl || 0)}</Private></div>
          <div className="kpi-sub">{top?.symbol} — {top?.count} positions</div>
          {top && <Sparkline values={[0, ...equityCurve(top.trades).map((x) => x.y)]} />}
          <div className="kpi-foot">Most traded symbol</div>
        </div>
      );
    }
    case 'longShort': return <LongShort trades={trades} />;
    case 'hold': return <HoldTime s={s} />;
    case 'payouts': return <Payouts state={c.state} />;
    case 'progress': return <div className="wfill"><AccountProgress /><div className="w-empty only">No active accounts. <a href="#/accounts">Add one</a></div></div>;
    case 'netpnl': return <NetPnl item={item} c={c} />;
    case 'equity': return <EquityW c={c} />;
    case 'daily': return <DailyW days={days} />;
    case 'drawdown': return <DrawdownW curve={curve} dd={dd} ctx={sctx} />;
    case 'weekday': case 'hour': case 'holdDur': case 'symbols': case 'strategy': case 'tags': return <Breakdown item={item} c={c} />;
    case 'recent': return <Recent trades={trades} onOpen={c.setOpenTrade} priv={c.state.settings.privacy} />;
    case 'avgtrade': return <AvgWinLoss title="Average Trade" unit="trade" win={s.avgWin} loss={Math.abs(s.avgLoss)} wins={s.wins} losses={s.losses} total={s.count} winRate={s.winRate} avg={s.avgTrade} rateLabel="Your win rate" />;
    case 'avgday': return <AvgDayPanel days={days} />;
    case 'streaks': return <StreaksPanel trades={trades} />;
    case 'risk': return <RiskW />;
    case 'blockers': return <div className="wfill wblock"><BlockerStrip /></div>;
    case 'calendar': return <div className="panel wpanel wcal"><div className="wbody"><PnlCalendar days={days} onDay={c.openDay} compact /></div></div>;
    default: return null;
  }
}

/** A chart that fills whatever height its widget has. */
function FillChart({ data, mode, xLabels = 8, ...rest }) {
  const [ref, { h }] = useSize();
  return <div ref={ref} className="wchart">{h > 40 && <PnlChart data={data} mode={mode} height={Math.floor(h)} xLabels={xLabels} {...rest} />}</div>;
}

function NetPnl({ item, c }) {
  const { s, p, prevTrades, curve, days, initial } = c;
  const mode = optionOf(item, 'mode');
  const data = mode === 'bar'
    ? [...days].reverse().map((d) => ({ label: fmtDate(d.date).replace(/, \d{4}$/, ''), y: d.net, tip: fmtDate(d.date) }))
    : curve.map((x) => ({ label: fmtDate(x.x), y: x.y, tip: `${fmtDate(x.x)} · ${fmtTime12(x.x)} · ${x.t.symbol}` }));
  const ch = prevTrades.length ? pctChange(s.net, p.net) : (s.net / initial) * 100;
  return (
    <Frame title="Net P&L Chart" right={<Seg icon value={mode} onChange={(v) => c.setOpt(item.id, 'mode', v)} options={[{ value: 'area', icon: ChartArea, title: 'Area' }, { value: 'line', icon: ChartLine, title: 'Line' }, { value: 'bar', icon: ChartColumn, title: 'Daily bars' }]} />}>
      <div className="row gap16" style={{ marginBottom: 10 }}>
        <span className="wbig"><Private>{fmtMoney(s.net)}</Private></span>
        <TrendBadge value={ch} label={`${ch >= 0 ? '+' : ''}${ch.toFixed(1)}% ${ch >= 0 ? 'increase' : 'decrease'}`} />
      </div>
      <FillChart data={data} mode={mode} />
    </Frame>
  );
}

function EquityW({ c }) {
  const { curve, initial, gap } = c;
  const data = curve.map((x) => ({ label: fmtDate(x.x), y: initial + x.y, tip: `${fmtDate(x.x)} · ${fmtTime12(x.x)}` }));
  const now = initial + (curve.at(-1)?.y || 0) + gap;
  return (
    <Frame title="Equity Chart" right={<span className="muted" style={{ fontSize: 12.5 }}>from <Private>{money0(initial)}</Private></span>}>
      <div className="row gap16" style={{ marginBottom: 10 }}><span className="wbig"><Private>{fmtMoney(now)}</Private></span></div>
      <FillChart data={[{ label: data[0]?.label || '', y: initial, tip: 'Start' }, ...data]} mode="area" startAtZero={false} showZero={false} />
    </Frame>
  );
}

function DailyW({ days }) {
  return (
    <Frame title="Daily P&L" right={<span className="muted" style={{ fontSize: 13 }}>{days.length} sessions</span>}>
      <FillChart data={[...days].reverse().map((d) => ({ label: fmtShortDate(d.date), y: d.net, tip: fmtDate(d.date) }))} mode="bar" xLabels={12} />
    </Frame>
  );
}

function DrawdownW({ curve, dd, ctx }) {
  let peak = 0;
  const data = curve.map((x) => { peak = Math.max(peak, x.y); return { label: fmtDate(x.x), y: Math.min(0, x.y - peak), tip: `${fmtDate(x.x)} · ${fmtTime12(x.x)}` }; });
  const cur = data.at(-1)?.y || 0;
  return (
    <Frame title={<StatLabel k="maxDD" v={dd} ctx={ctx}>Max Drawdown</StatLabel>} right={<span className="muted" style={{ fontSize: 12.5 }}>now <Private className={cur < 0 ? 'neg' : ''}>{fmtMoney(cur, { dp: 0 })}</Private></span>}>
      <div className="row gap16" style={{ marginBottom: 10 }}><span className="wbig neg"><Private>{fmtMoney(-dd)}</Private></span></div>
      <FillChart data={data} mode="area" />
    </Frame>
  );
}

const HOLD_BUCKETS = [[60, '< 1 min'], [300, '1–5 min'], [900, '5–15 min'], [3600, '15–60 min'], [14400, '1–4 h'], [Infinity, '> 4 h']];

/** Results grouped by weekday / hour / hold time / symbol / strategy / tag. */
function Breakdown({ item, c }) {
  const { trades, s, state } = c;
  const metric = optionOf(item, 'metric');
  const groups = useMemo(() => {
    const by = (keyFn, order) => {
      const m = new Map();
      for (const t of trades) for (const k of [].concat(keyFn(t))) { if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
      const keys = order ? order.filter((k) => m.has(k)) : [...m.keys()];
      return keys.map((k) => ({ label: k, list: m.get(k) }));
    };
    switch (item.id) {
      case 'weekday': return by((t) => WEEKDAYS[toDate(t.entry).getDay()], [1, 2, 3, 4, 5, 6, 0].map((d) => WEEKDAYS[d]));
      case 'hour': return by((t) => `${String(toDate(t.entry).getHours()).padStart(2, '0')}:00`).sort((a, b) => a.label.localeCompare(b.label));
      case 'holdDur': return by((t) => HOLD_BUCKETS.find(([max]) => holdSeconds(t) < max)[1], HOLD_BUCKETS.map((b) => b[1]));
      case 'symbols': return by((t) => t.symbol).sort((a, b) => b.list.length - a.list.length);
      case 'strategy': return by((t) => state.strategies.find((x) => x.id === t.strategyId)?.name || 'No strategy').sort((a, b) => b.list.length - a.list.length);
      case 'tags': return by((t) => (t.tags?.length ? t.tags : ['No tag'])).sort((a, b) => b.list.length - a.list.length);
      default: return [];
    }
  }, [trades, item.id, state.strategies]);
  const rows = groups.map(({ label, list }) => {
    const pnl = list.reduce((a, t) => a + t.pnl, 0);
    const wr = (list.filter((t) => t.pnl > 0).length / list.length) * 100;
    return { label, value: metric === 'winRate' ? wr : metric === 'count' ? list.length : pnl, extra: metric === 'count' ? `${Math.round(wr)}%` : `${list.length} trade${list.length === 1 ? '' : 's'}` };
  });
  const bars = metric === 'winRate' ? <HBars rows={rows} fmt={(v) => `${v.toFixed(0)}%`} mid={50} oneSided /> : metric === 'count' ? <HBars rows={rows} fmt={(v) => String(v)} mid={null} oneSided /> : <HBars rows={rows} />;
  return (
    <Frame title={WIDGETS[item.id].name}>
      {rows.length ? bars : <div className="w-empty">{item.id === 'tags' ? 'No tagged trades in this view' : 'Nothing to show'}</div>}
      {item.id === 'symbols' && (
        <div className="row between muted" style={{ fontSize: 12.5, marginTop: 16 }}>
          <span>Largest win <Private className="pos">{fmtMoney(s.largestWin, { sign: true })}</Private></span>
          <span>Largest loss <Private className="neg">{fmtMoney(s.largestLoss)}</Private></span>
        </div>
      )}
    </Frame>
  );
}

function HoldTime({ s }) {
  return (
    <Frame title="Average Hold Time">
      <div className="hold-cards whold">
        {[
          ['win', 'Winning trades', <Trophy key="i" size={14} className="pos" />, s.holdWin, s.holdWinMedian, s.wins],
          ['be', 'Break even', <Minus key="i" size={14} style={{ color: 'var(--warn)' }} />, s.holdBe, s.holdBeMedian, s.be],
          ['loss', 'Losing trades', <TrendingDown key="i" size={14} className="neg" />, s.holdLoss, s.holdLossMedian, s.losses],
        ].map(([k, label, icon, avg, med, n]) => {
          const ex = s.holdExcluded[k];
          return (
            <div key={k} className="hold-card" title={`Average excludes trades held over ${HOLD_CAP_SECONDS / 3600}h. Median uses every trade.`}>
              <div className="h">{icon} {label}</div>
              <div className="v">{fmtHold(avg)}</div>
              <div className="n">{n} trade{n === 1 ? '' : 's'} · median {fmtHold(med)}</div>
              {ex > 0 && <div className="n" style={{ color: 'var(--warn)', marginTop: 3 }}>{ex} held &gt;{HOLD_CAP_SECONDS / 3600}h excluded</div>}
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

function Recent({ trades, onOpen, priv }) {
  const [ref, { h }] = useSize();
  const n = Math.max(1, Math.floor((h || 200) / 44));
  const list = sortByEntry(trades).slice(0, n);
  return (
    <Frame title="Recent Trades" right={<a className="btn xs" href="#/journal/database">All trades <ArrowUpRight size={12} /></a>} bodyRef={ref} className="wrecent">
      {list.map((t) => (
        <div key={t.id} className="recent-row" onClick={() => onOpen(t)}>
          <span>{fmtShortDate(t.entry)} &nbsp;•&nbsp; {fmtTime24(t.entry)}</span>
          <span><span className={`dir ${t.direction}`}>{t.direction}</span></span>
          <span>{t.symbol}</span>
          <span className={`row gap6 ${t.pnl >= 0 ? 'pos' : 'neg'}`} style={{ justifyContent: 'flex-end' }}>
            {t.pnl >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            <span className={priv ? 'hidden-val' : ''}>{fmtMoney(t.pnl, { sign: true })}</span>
          </span>
        </div>
      ))}
    </Frame>
  );
}

function LongShort({ trades }) {
  const side = (d) => { const l = trades.filter((t) => t.direction === d); return { n: l.length, pnl: l.reduce((a, t) => a + t.pnl, 0), wr: l.length ? (l.filter((t) => t.pnl > 0).length / l.length) * 100 : 0 }; };
  const L = side('Long'), S = side('Short');
  const tot = L.n + S.n || 1;
  const Col = ({ label, v, cls }) => (
    <div className="ls-col">
      <div className={`ls-k ${cls}`}>{cls === 'long' ? <TrendingUp size={13} /> : <TrendingDown size={13} />} {label}</div>
      <div className={`ls-v ${v.pnl >= 0 ? 'pos' : 'neg'}`}><Private>{fmtMoney(v.pnl, { dp: Math.abs(v.pnl) >= 1000 ? 0 : 2 })}</Private></div>
      <div className="ls-s">{v.n} trade{v.n === 1 ? '' : 's'} · {Math.round(v.wr)}% win</div>
    </div>
  );
  return (
    <Frame title="Long vs Short">
      <div className="ls">
        <div className="ls-pair"><Col label="Long" v={L} cls="long" /><div className="avgt-sep" /><Col label="Short" v={S} cls="short" /></div>
        <div className="ls-bar" title={`${L.n} long · ${S.n} short`}><span className="l" style={{ width: `${(L.n / tot) * 100}%` }} /><span className="s" style={{ width: `${(S.n / tot) * 100}%` }} /></div>
        <div className="ls-foot muted"><span>{Math.round((L.n / tot) * 100)}% long</span><span>{Math.round((S.n / tot) * 100)}% short</span></div>
      </div>
    </Frame>
  );
}

function Payouts({ state }) {
  const st = useMemo(() => portfolioStats(state.accounts, state.payouts || [], state.trades), [state.accounts, state.payouts, state.trades]);
  return (
    <div className={`kpi wkpi ${st.net >= 0 ? 'posc' : 'negc'}`}>
      <div className="kpi-head"><span>Total Payouts</span><a className="btn xs" href="#/payouts">Payouts</a></div>
      <div className="kpi-val"><Private>{fmtMoney(st.paid, { dp: 0 })}</Private></div>
      <div className="kpi-sub">{st.payouts} payout{st.payouts === 1 ? '' : 's'}{st.pending ? <> · <span style={{ color: 'var(--warn)' }}><Private>{fmtMoney(st.pending, { dp: 0 })}</Private> pending</span></> : null}</div>
      <div className="kpi-foot">{st.spent ? <>Accounts cost <Private>{fmtMoney(st.spent, { dp: 0 })}</Private> · ROI <b className={st.roi >= 0 ? 'pos' : 'neg'}>{Math.round(st.roi)}%</b></> : 'Add account costs to see your return'}</div>
    </div>
  );
}

function RiskW() {
  const risk = useRisk();
  return (
    <Frame title="Current risk" right={<a href="#/risk" className="muted" style={{ fontSize: 12.5 }}>Drawdown −{money0(risk.dd)}</a>}>
      <TierCards risk={risk} compact />
    </Frame>
  );
}

function AvgDayPanel({ days }) {
  const up = days.filter((d) => d.net > 0), dn = days.filter((d) => d.net < 0);
  const avg = (a) => (a.length ? a.reduce((x, d) => x + d.net, 0) / a.length : 0);
  return <AvgWinLoss title="Average Day" unit="day" win={avg(up)} loss={Math.abs(avg(dn))} wins={up.length} losses={dn.length} total={days.length} winRate={days.length ? (up.length / days.length) * 100 : 0} avg={avg(days)} rateLabel="Your green-day rate" />;
}

/** Average winner vs average loser, with reward:risk and the hit rate needed to break even. */
function AvgWinLoss({ title, unit, win, loss, wins, losses, total, winRate, avg, rateLabel }) {
  const rr = loss ? win / loss : null;
  const beWr = rr ? 100 / (1 + rr) : null; // hit rate needed to break even at this reward:risk
  const edge = beWr == null ? null : winRate - beWr;
  const sum = win + loss || 1;
  const noun = unit === 'day' ? ['green day', 'red day'] : ['winning trade', 'losing trade'];
  const ctx = { count: total, wins, losses, winRate, avgWin: win, avgLoss: -loss };
  return (
    <Frame title={title}>
      <div className="avgt">
        <div className="avgt-pair">
          <div>
            <div className="avgt-k pos">W</div>
            <div className="avgt-v pos"><Private>{fmtMoney(win)}</Private></div>
            <div className="avgt-s">{wins} {noun[0]}{wins === 1 ? '' : 's'}</div>
          </div>
          <div className="avgt-sep" />
          <div>
            <div className="avgt-k neg">L</div>
            <div className="avgt-v neg"><Private>{fmtMoney(-loss)}</Private></div>
            <div className="avgt-s">{losses} {noun[1]}{losses === 1 ? '' : 's'}</div>
          </div>
        </div>
        <div className="avgt-bar" title={`Average ${noun[0]} vs average ${noun[1]}`}>
          <span className="w" style={{ width: `${(win / sum) * 100}%` }} />
          <span className="l" style={{ width: `${(loss / sum) * 100}%` }} />
        </div>
        <div className="avgt-rows">
          <div><span><StatLabel k="payoff" v={rr} ctx={ctx}>Reward : risk</StatLabel></span><b className={rr == null ? '' : rr >= 1 ? 'pos' : 'neg'}>{rr == null ? '—' : `${rr.toFixed(2)}x`}</b></div>
          <div><span><StatLabel k="breakEven" v={beWr} ctx={ctx}>{`Break-even ${unit === 'day' ? 'green-day rate' : 'win rate'}`}</StatLabel></span><b>{beWr == null ? '—' : `${beWr.toFixed(1)}%`}</b></div>
          <div><span>{rateLabel}</span><b className={edge == null ? '' : edge >= 0 ? 'pos' : 'neg'}>{total ? `${winRate.toFixed(1)}%` : '—'}{edge != null && total ? <em> {edge >= 0 ? '+' : ''}{edge.toFixed(1)} pts</em> : null}</b></div>
          <div><span><StatLabel k={unit === 'day' ? 'avgDay' : 'ev'} v={avg} ctx={unit === 'day' ? { ...ctx, days: total } : ctx}>{`Expectancy / ${unit}`}</StatLabel></span><b><Private className={avg >= 0 ? 'pos' : 'neg'}>{fmtMoney(avg, { sign: true })}</Private></b></div>
        </div>
      </div>
    </Frame>
  );
}

/** Win/loss runs, by trade and by trading day. Break-even trades/days end a run. */
function runs(results) {
  let cur = 0, curType = null, bestW = 0, bestL = 0, w = 0, l = 0;
  for (const v of results) {
    if (v > 0) { w++; l = 0; } else if (v < 0) { l++; w = 0; } else { w = 0; l = 0; }
    bestW = Math.max(bestW, w); bestL = Math.max(bestL, l);
  }
  for (let i = results.length - 1; i >= 0; i--) {
    const t = results[i] > 0 ? 'win' : results[i] < 0 ? 'loss' : null;
    if (!t || (curType && t !== curType)) break;
    curType = t; cur++;
  }
  return { cur, curType, bestW, bestL };
}

function StreaksPanel({ trades }) {
  const asc = useMemo(() => sortByEntry(trades, 'asc'), [trades]);
  const t = runs(asc.map((x) => x.pnl));
  const d = runs([...groupByDay(trades)].reverse().map((x) => x.net));
  const last = asc.slice(-24);
  const Cur = ({ r, unit }) => (
    <div className="stk-cur">
      <b>{r.cur}</b>
      <span className={r.curType === 'win' ? 'pos' : r.curType === 'loss' ? 'neg' : 'muted'}>
        {r.curType === 'win' ? <TrendingUp size={14} /> : r.curType === 'loss' ? <TrendingDown size={14} /> : <Minus size={14} />}
        {r.curType ? `${r.curType === 'win' ? 'Win' : 'Loss'}${r.cur === 1 ? '' : r.curType === 'win' ? 's' : 'es'}` : `No ${unit} run`}
      </span>
    </div>
  );
  return (
    <Frame title="Trading Streaks">
      <div className="stk">
        <div className="stk-grid">
          <div className="stk-h" />
          <div className="stk-h">Trades</div>
          <div className="stk-h">Days</div>
          <div className="stk-k">Current</div>
          <Cur r={t} unit="trade" />
          <Cur r={d} unit="day" />
          <div className="stk-k">Longest win</div>
          <div className="stk-n"><b>{t.bestW}</b><Trophy size={14} className="pos" /></div>
          <div className="stk-n"><b>{d.bestW}</b><Trophy size={14} className="pos" /></div>
          <div className="stk-k">Longest loss</div>
          <div className="stk-n"><b>{t.bestL}</b><TrendingDown size={14} className="neg" /></div>
          <div className="stk-n"><b>{d.bestL}</b><TrendingDown size={14} className="neg" /></div>
        </div>
        {last.length > 0 && (
          <div>
            <div className="stk-h" style={{ marginBottom: 8 }}>Last {last.length} trades</div>
            <div className="stk-strip">
              {last.map((x) => <i key={x.id} className={x.pnl > 0 ? 'w' : x.pnl < 0 ? 'l' : 'b'} title={`${fmtDate(x.entry)} ${fmtTime12(x.entry)} · ${x.symbol} · ${fmtMoney(x.pnl, { sign: true })}`} />)}
            </div>
          </div>
        )}
      </div>
    </Frame>
  );
}
