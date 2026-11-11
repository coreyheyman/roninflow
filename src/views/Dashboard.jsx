import { useMemo, useState } from 'react';
import { ChevronDown, ChartArea, ChartLine, ChartColumn, Trophy, Minus, TrendingDown, TrendingUp, Check, ArrowUp, ArrowDown, LayoutGrid } from 'lucide-react';
import { useStore, useAccountTrades, navigate } from '../store/store';
import { AccountPicker, DateRange, Popover, Seg, TrendBadge, Modal, ModalHead, Private } from '../components/ui';
import { PnlChart, Sparkline, Gauge, RateBar, HBars, MarkerScale } from '../components/Charts';
import { FilterButton, applyFilters, EMPTY_FILTERS } from '../components/Filters';
import { PnlCalendar } from '../components/Calendar';
import { useOpenDay } from '../lib/dayPopup';
import { TradeDrawer } from '../components/TradeForms';
import { DASHBOARD_WIDGETS } from '../data/seed';
import { BlockerStrip, TierCards, useRisk } from '../components/Playbook';
import { balanceGap } from '../lib/balance';
import AccountProgress from '../components/AccountProgress';
import {
  summarize, equityCurve, inRange, mostTraded, fmtNum, fmtShortDate, fmtDate, fmtTime12, fmtTime24, fmtHold, pfText, groupByDay, sortByEntry, pctChange,
  WEEKDAYS, toDate, fmtMoney, keyOf, HOLD_CAP_SECONDS, curSymbol, fmtAmt, money0, perfRatio, maxDrawdown, romad, ratioText,
} from '../lib/stats';

const LAYOUTS = ['My Dashboard', 'Performance', 'Risk', 'Psychology'];
const LAYOUT_WIDGETS = {
  Performance: ['kpis', 'netpnl', 'daily', 'calendar'],
  Risk: ['kpis', 'progress', 'hold', 'symbols', 'avgday', 'avgtrade', 'streaks', 'hour'],
  Psychology: ['kpis', 'weekday', 'hour', 'calendar'],
};

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

export default function Dashboard() {
  const openDay = useOpenDay();
  const { state, setSetting } = useStore();
  const all = useAccountTrades();
  const [range, setRange] = useState({ from: null, to: null });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [chartMode, setChartMode] = useState('area');
  const [layout, setLayout] = useState('My Dashboard');
  const [editOpen, setEditOpen] = useState(false);
  const [openTrade, setOpenTrade] = useState(null);

  const trades = useMemo(() => applyFilters(all.filter((t) => inRange(t, range)), filters), [all, range, filters]);
  const prevTrades = useMemo(() => {
    const pr = previousRange(range, all);
    return pr ? applyFilters(all.filter((t) => inRange(t, pr)), filters) : [];
  }, [all, range, filters]);
  const s = useMemo(() => summarize(trades), [trades]);
  const p = useMemo(() => summarize(prevTrades), [prevTrades]);
  const curve = useMemo(() => equityCurve(trades), [trades]);
  const pr = perfRatio(s), prPrev = perfRatio(p);
  const dd = useMemo(() => maxDrawdown(trades), [trades]);
  const ro = romad(s.net, dd), roPrev = romad(p.net, maxDrawdown(prevTrades));
  const fin = (v) => (v === Infinity ? 99 : v === -Infinity ? -99 : v);
  const days = useMemo(() => groupByDay(trades), [trades]);
  const sym = mostTraded(trades);
  const top = sym[0];
  const prevTop = prevTrades.filter((t) => t.symbol === top?.symbol).reduce((a, t) => a + t.pnl, 0);
  const account = state.accounts.find((a) => a.id === state.settings.account);
  const initial = account?.initial || state.accounts.filter((a) => all.some((t) => t.accountId === a.id)).reduce((a, x) => a + x.initial, 0) || 50000;
  const widgets = layout === 'My Dashboard' ? state.settings.dashboardWidgets : LAYOUT_WIDGETS[layout];
  const show = (id) => widgets.includes(id);
  const priv = state.settings.privacy;
  // all-time view: P&L = live balance − starting balance (the gap to the trades is shown underneath)
  const unfiltered = !range.from && !range.to && JSON.stringify(filters) === JSON.stringify(EMPTY_FILTERS);
  const gap = unfiltered ? balanceGap(state) : 0;
  const totalNet = s.net + gap;

  const chartData = chartMode === 'bar'
    ? [...days].reverse().map((d) => ({ label: fmtDate(d.date).replace(/, \d{4}$/, ''), y: d.net, tip: fmtDate(d.date) }))
    : curve.map((c) => ({ label: fmtDate(c.x), y: c.y, tip: `${fmtDate(c.x)} · ${fmtTime12(c.x)} · ${c.t.symbol}` }));

  const recent = sortByEntry(trades).slice(0, 4);

  const order = DASHBOARD_WIDGETS.map((w) => w.id).filter(show);
  const sectionsAfter = order.filter((id) => !['kpis', 'netpnl', 'hold'].includes(id));

  return (
    <div className="page">
      <div className="toolbar">
        <AccountPicker />
        <DateRange value={range} onChange={setRange} />
        <div className="grow" />
        <Popover
          align="right"
          trigger={({ toggle }) => (
            <button className="btn" onClick={toggle} style={{ fontWeight: 600, color: 'var(--fg)', minWidth: 140 }}>{layout} <ChevronDown size={15} className="muted" /></button>
          )}
        >
          {(close) => LAYOUTS.map((l) => (
            <button key={l} className={`pop-item ${l === layout ? 'on' : ''}`} onClick={() => { setLayout(l); close(); }}>
              <LayoutGrid size={14} /> <span className="grow">{l}</span> {l === layout && <Check size={14} />}
            </button>
          ))}
        </Popover>
        <div className="sep-v" style={{ margin: '4px 6px' }} />
        <FilterButton value={filters} onChange={setFilters} trades={all} />
        <div className="sep-v" style={{ margin: '4px 6px' }} />
        <button className="btn" onClick={() => setEditOpen(true)}>Edit layout</button>
      </div>

      {trades.length === 0 && (
        <div className="panel empty" style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 16, color: 'var(--fg)' }}>No trades in this view</div>
          <div>Change the date range or filters, or add a trade from the Trading Journal.</div>
          <button className="btn white" onClick={() => navigate('journal/database')}>Go to Trading Journal</button>
        </div>
      )}

      {show('kpis') && trades.length > 0 && (
        <div className="kpis">
          <div className={`kpi ${totalNet >= 0 ? 'posc' : 'negc'}`}>
            <div className="kpi-head">Total P&L <TrendBadge value={(totalNet / initial) * 100} /></div>
            <div className="kpi-val"><Private>{fmtMoney(totalNet)}</Private></div>
            <div className="kpi-sub">{gap
              ? <span title="Total P&L is your ATAS balance minus your starting balance. The adjustment is what the trades in the journal don't account for (missing fills, account fees…).">Trades <Private>{fmtMoney(s.net)}</Private> · balance adj. <Private>{fmtMoney(gap, { sign: true })}</Private></span>
              : <>Avg: <Private>{fmtMoney(s.avgTrade)}</Private></>}</div>
            <Sparkline values={[0, ...curve.map((c) => c.y)]} />
            <div className="kpi-foot">{s.count} closed positions</div>
          </div>
          <div className={`kpi ${s.winRate >= 50 ? 'posc' : 'negc'}`}>
            <div className="kpi-head">Win Rate <TrendBadge value={prevTrades.length ? pctChange(s.winRate, p.winRate) : s.winRate - 50} /></div>
            <div className="row gap24" style={{ marginTop: 30 }}>
              <div className="kpi-val" style={{ margin: 0 }}>{Math.round(s.winRate)}%</div>
              <div className="grow"><RateBar pct={s.winRate} /></div>
            </div>
            <div className="kpi-sub row gap16">
              <span className="neg">L: {s.losses}</span>
              <span>BE: {s.be}</span>
              <span className="pos">W: {s.wins}</span>
            </div>
            <div className="kpi-foot">{s.count} closed positions</div>
          </div>
          <div className={`kpi ${s.profitFactor >= 1 ? 'posc' : 'negc'}`}>
            <div className="kpi-head">Profit Factor <TrendBadge value={prevTrades.length ? pctChange(s.profitFactor === Infinity ? 99 : s.profitFactor, p.profitFactor === Infinity ? 99 : p.profitFactor) : (s.profitFactor - 1) * 100} /></div>
            <div style={{ position: 'relative', alignSelf: 'center', marginTop: 12 }}>
              <Gauge value={s.profitFactor} />
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 10, textAlign: 'center', fontSize: 31, fontWeight: 500, letterSpacing: '-0.03em' }}>{pfText(s.profitFactor)}</div>
            </div>
            <div className="kpi-foot" style={{ textAlign: 'center' }}>Gross profit / gross loss ratio</div>
          </div>
          <div className={`kpi ${pr >= 0.5 ? 'posc' : 'negc'}`} title="Performance Ratio = win% × (avg win ÷ avg loss). Above 0.5 is good performance, above 0.75 is great.">
            <div className="kpi-head">Performance Ratio <TrendBadge value={prevTrades.length ? pctChange(fin(pr), fin(prPrev)) : (fin(pr) - 0.5) * 100} /></div>
            <div className="kpi-val" style={{ marginTop: 22 }}>{ratioText(pr)}</div>
            <div className="kpi-sub muted" style={{ fontWeight: 400, fontSize: 13 }}>{Math.round(s.winRate)}% win × {s.avgLoss ? (s.avgWin / Math.abs(s.avgLoss)).toFixed(2) : '∞'} avg win/loss</div>
            <div style={{ margin: '14px 0 10px' }}><MarkerScale value={pr} min={0} max={1.5} marks={[{ v: 0.5, color: 'var(--neg)', label: '0.5 good' }, { v: 0.75, color: 'var(--pos)', label: '0.75 great' }]} /></div>
            <div className="kpi-foot">Win% × avg win / avg loss</div>
          </div>
          <div className={`kpi ${ro >= 1 ? 'posc' : 'negc'}`} title="ROMAD = total P&L ÷ maximum peak-to-trough drawdown in the same period. Below 1 means you lost more at some point than you ended up making; above 2 is high-quality trading.">
            <div className="kpi-head">ROMAD <TrendBadge value={prevTrades.length ? pctChange(fin(ro), fin(roPrev)) : (fin(ro) - 1) * 100} /></div>
            <div className="kpi-val" style={{ marginTop: 22 }}>{ratioText(ro)}</div>
            <div className="kpi-sub muted" style={{ fontWeight: 400, fontSize: 13 }}><Private>{fmtMoney(s.net, { dp: 0, sign: true })}</Private> P&L ÷ <Private>{fmtMoney(dd, { dp: 0 })}</Private> max drawdown</div>
            <div style={{ margin: '14px 0 10px' }}><MarkerScale value={ro} min={-2} max={4} marks={[{ v: 1, color: 'var(--warn)', label: '1' }, { v: 2, color: 'var(--pos)', label: '2 high quality' }]} /></div>
            <div className="kpi-foot">Return over max drawdown</div>
          </div>
          <div className={`kpi ${(top?.pnl || 0) >= 0 ? 'posc' : 'negc'}`}>
            <div className="kpi-head">Most Traded {top && <TrendBadge value={prevTrades.length ? pctChange(top.pnl, prevTop) : (top.pnl / initial) * 100} />}</div>
            <div className="kpi-val"><Private>{fmtMoney(top?.pnl || 0)}</Private></div>
            <div className="kpi-sub">{top?.symbol} — {top?.count} positions</div>
            {top && <Sparkline values={[0, ...equityCurve(top.trades).map((c) => c.y)]} />}
            <div className="kpi-foot">Most traded symbol</div>
          </div>
        </div>
      )}

      {show('progress') && <AccountProgress />}

      {trades.length > 0 && (show('netpnl') || show('hold')) && (
        <div className="dash-grid" style={!(show('netpnl') && show('hold')) ? { gridTemplateColumns: '1fr' } : undefined}>
          {show('netpnl') && (
            <div className="panel">
              <div className="panel-head">
                <div className="card-title">Net P&L Chart</div>
                <Seg icon value={chartMode} onChange={setChartMode} options={[{ value: 'area', icon: ChartArea, title: 'Area' }, { value: 'line', icon: ChartLine, title: 'Line' }, { value: 'bar', icon: ChartColumn, title: 'Daily bars' }]} />
              </div>
              <div className="row gap16" style={{ marginBottom: 14 }}>
                <span style={{ fontSize: 23, fontWeight: 500, letterSpacing: '-0.02em' }}><Private>{fmtMoney(s.net)}</Private></span>
                {(() => {
                  const ch = prevTrades.length ? pctChange(s.net, p.net) : (s.net / initial) * 100;
                  return <TrendBadge value={ch} label={`${ch >= 0 ? '+' : ''}${ch.toFixed(1)}% ${ch >= 0 ? 'increase' : 'decrease'}`} />;
                })()}
              </div>
              <PnlChart data={chartData} mode={chartMode} height={330} xLabels={8} />
            </div>
          )}
          {show('hold') && (
            <div className="panel">
              <div className="card-title">Average Hold Time</div>
              <div className="hold-cards">
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
              <div>
                {recent.map((t) => (
                  <div key={t.id} className="recent-row" onClick={() => setOpenTrade(t)}>
                    <span>{fmtShortDate(t.entry)} &nbsp;•&nbsp; {fmtTime24(t.entry)}</span>
                    <span><span className={`dir ${t.direction}`}>{t.direction}</span></span>
                    <span>{t.symbol}</span>
                    <span className={`row gap6 ${t.pnl >= 0 ? 'pos' : 'neg'}`} style={{ justifyContent: 'flex-end' }}>
                      {t.pnl >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                      <span className={priv ? 'hidden-val' : ''}>{fmtMoney(t.pnl, { sign: true })}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {trades.length > 0 && (
        <div className="dash-grid thirds">
          {sectionsAfter.filter((id) => !['calendar', 'daily', 'blockers'].includes(id)).map((id) => <Widget key={id} id={id} trades={trades} s={s} days={days} />)}
        </div>
      )}
      {show('blockers') && <DashRisk />}
      {trades.length > 0 && show('daily') && (
        <div className="panel" style={{ marginBottom: 22 }}>
          <div className="panel-head"><div className="card-title">Daily P&L</div><span className="muted" style={{ fontSize: 13 }}>{days.length} sessions</span></div>
          <PnlChart data={[...days].reverse().map((d) => ({ label: fmtShortDate(d.date), y: d.net, tip: fmtDate(d.date) }))} mode="bar" height={220} xLabels={12} />
        </div>
      )}
      {trades.length > 0 && show('calendar') && (
        <div className="panel">
          <PnlCalendar days={days} onDay={openDay} compact />
        </div>
      )}

      <Modal open={editOpen} onClose={() => setEditOpen(false)} width={460}>
        <ModalHead title="Edit layout" sub="Choose and order the widgets on My Dashboard" onClose={() => setEditOpen(false)} />
        <div className="modal-body col gap6">
          {(() => {
            const cur = state.settings.dashboardWidgets;
            const ordered = [...cur, ...DASHBOARD_WIDGETS.map((w) => w.id).filter((id) => !cur.includes(id))];
            const move = (id, d) => {
              const i = cur.indexOf(id), j = i + d;
              if (i < 0 || j < 0 || j >= cur.length) return;
              const n = [...cur]; [n[i], n[j]] = [n[j], n[i]];
              setSetting('dashboardWidgets', n);
            };
            return ordered.map((id) => {
              const w = DASHBOARD_WIDGETS.find((x) => x.id === id);
              const on = cur.includes(id);
              return (
                <div key={id} className="rule" style={{ marginBottom: 0 }}>
                  <input type="checkbox" className="cbx" checked={on} onChange={() => setSetting('dashboardWidgets', on ? cur.filter((x) => x !== id) : [...cur, id])} />
                  <span className="grow">{w.label}</span>
                  {on && <><button className="icon-btn" onClick={() => move(id, -1)}><ArrowUp size={14} /></button><button className="icon-btn" onClick={() => move(id, 1)}><ArrowDown size={14} /></button></>}
                </div>
              );
            });
          })()}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => setSetting('dashboardWidgets', DASHBOARD_WIDGETS.map((w) => w.id))}>Reset</button>
          <button className="btn white" onClick={() => { setLayout('My Dashboard'); setEditOpen(false); }}>Done</button>
        </div>
      </Modal>
      {openTrade && <TradeDrawer trade={openTrade} onClose={() => setOpenTrade(null)} />}
    </div>
  );
}

function Widget({ id, trades, s }) {
  if (id === 'weekday') {
    const rows = [1, 2, 3, 4, 5].map((d) => {
      const list = trades.filter((t) => toDate(t.entry).getDay() === d);
      return { label: WEEKDAYS[d], value: list.reduce((a, t) => a + t.pnl, 0), extra: `${list.length} trades` };
    });
    return <Panel title="P&L by weekday"><HBars rows={rows} /></Panel>;
  }
  if (id === 'hour') {
    const hours = [...new Set(trades.map((t) => toDate(t.entry).getHours()))].sort((a, b) => a - b);
    const rows = hours.map((h) => {
      const list = trades.filter((t) => toDate(t.entry).getHours() === h);
      return { label: `${String(h).padStart(2, '0')}:00`, value: list.reduce((a, t) => a + t.pnl, 0), extra: `${list.length} trades` };
    });
    return <Panel title="P&L by hour"><HBars rows={rows} /></Panel>;
  }
  if (id === 'symbols') {
    return (
      <Panel title="Symbols">
        <HBars rows={mostTraded(trades).map((x) => ({ label: x.symbol, value: x.pnl, extra: `${x.count} trades` }))} />
        <div className="row between muted" style={{ fontSize: 12.5, marginTop: 16 }}>
          <span>Largest win <Private className="pos">{fmtMoney(s.largestWin, { sign: true })}</Private></span>
          <span>Largest loss <Private className="neg">{fmtMoney(s.largestLoss)}</Private></span>
        </div>
      </Panel>
    );
  }
  if (id === 'avgtrade') return <AvgTradePanel s={s} />;
  if (id === 'avgday') return <AvgDayPanel trades={trades} />;
  if (id === 'streaks') return <StreaksPanel trades={trades} />;
  return null;
}

function AvgTradePanel({ s }) {
  return <AvgWinLoss title="Average Trade" unit="trade" win={s.avgWin} loss={Math.abs(s.avgLoss)} wins={s.wins} losses={s.losses} total={s.count} winRate={s.winRate} avg={s.avgTrade} rateLabel="Your win rate" />;
}

function AvgDayPanel({ trades }) {
  const days = useMemo(() => groupByDay(trades), [trades]);
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
  return (
    <Panel title={title}>
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
          <div><span>Reward : risk</span><b className={rr == null ? '' : rr >= 1 ? 'pos' : 'neg'}>{rr == null ? '—' : `${rr.toFixed(2)}x`}</b></div>
          <div><span>Break-even {unit === 'day' ? 'green-day rate' : 'win rate'}</span><b>{beWr == null ? '—' : `${beWr.toFixed(1)}%`}</b></div>
          <div><span>{rateLabel}</span><b className={edge == null ? '' : edge >= 0 ? 'pos' : 'neg'}>{total ? `${winRate.toFixed(1)}%` : '—'}{edge != null && total ? <em> {edge >= 0 ? '+' : ''}{edge.toFixed(1)} pts</em> : null}</b></div>
          <div><span>Expectancy / {unit}</span><b><Private className={avg >= 0 ? 'pos' : 'neg'}>{fmtMoney(avg, { sign: true })}</Private></b></div>
        </div>
      </div>
    </Panel>
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
    <Panel title="Trading Streaks">
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
    </Panel>
  );
}

const Panel = ({ title, children }) => (
  <div className="panel">
    <div className="panel-head"><div className="card-title">{title}</div></div>
    {children}
  </div>
);

function DashRisk() {
  const risk = useRisk();
  return (
    <div className="dash-grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
      <a href="#/risk" className="panel" style={{ display: 'block' }}>
        <div className="panel-head"><div className="card-title">Current risk</div><span className="muted" style={{ fontSize: 12.5 }}>Drawdown −{money0(risk.dd)}</span></div>
        <TierCards risk={risk} compact />
      </a>
      <BlockerStrip />
    </div>
  );
}
