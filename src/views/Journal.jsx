import { useMemo, useState } from 'react';
import { List, LayoutGrid, Calendar, Plus, Upload, EllipsisVertical, ArrowUp, ArrowDown, EyeOff, Check, Trash, Inbox as InboxIcon, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore, useAccountTrades } from '../store/store';
import { AccountPicker, DateRange, Seg, Popover, Money, Confirm, useToast } from '../components/ui';
import { FilterButton, applyFilters, EMPTY_FILTERS } from '../components/Filters';
import { TradeFormModal, TradeDrawer } from '../components/TradeForms';
import { PnlCalendar } from '../components/Calendar';
import { useOpenDay } from '../lib/dayPopup';
import ImportModal from '../components/ImportModal';
import { inRange, sortByEntry, fmtDate, fmtTime12, groupByDay, holdSeconds, fmtHold, summarize, pfText } from '../lib/stats';

const COLS = [
  { id: 'symbol', label: 'Pair', get: (t) => t.symbol },
  { id: 'direction', label: 'Direction', get: (t) => t.direction },
  { id: 'date', label: 'Date', get: (t) => t.entry },
  { id: 'entry', label: 'Entry Time', get: (t) => t.entry.slice(11) },
  { id: 'exit', label: 'Exit Time', get: (t) => t.exit.slice(11) },
  { id: 'account', label: 'Account', get: (t) => t.accountId },
  { id: 'qty', label: 'Qty', get: (t) => t.qty, hidden: true },
  { id: 'hold', label: 'Hold', get: holdSeconds, hidden: true },
  { id: 'strategy', label: 'Strategy', get: (t) => t.strategyId || '', hidden: true },
  { id: 'tags', label: 'Tags', get: (t) => (t.tags || []).join(',') },
  { id: 'pnl', label: 'Net P&L', get: (t) => t.pnl },
];

export default function Journal({ sub }) {
  const openDay = useOpenDay();
  const isInbox = sub === 'inbox';
  const { state, updateTrade, deleteTrades } = useStore();
  const toast = useToast();
  const all = useAccountTrades();
  const [range, setRange] = useState({ from: null, to: null });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [view, setView] = useState('list');
  const [sort, setSort] = useState({ col: 'date', dir: 'desc' });
  const [hidden, setHidden] = useState(() => COLS.filter((c) => c.hidden).map((c) => c.id));
  const [sel, setSel] = useState([]);
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(25);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [open, setOpen] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const trades = useMemo(() => {
    let list = applyFilters(all.filter((t) => inRange(t, range)), filters);
    if (isInbox) list = list.filter((t) => !t.reviewed);
    const col = COLS.find((c) => c.id === sort.col) || COLS[2];
    return [...list].sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.dir === 'asc' ? r : -r;
    });
  }, [all, range, filters, sort, isInbox]);
  const pages = Math.max(1, Math.ceil(trades.length / perPage));
  const pg = Math.min(page, pages - 1);
  const shown = trades.slice(pg * perPage, pg * perPage + perPage);
  const cols = COLS.filter((c) => !hidden.includes(c.id));
  const stratName = (id) => state.strategies.find((s) => s.id === id)?.name || '—';
  const s = summarize(trades);
  const allSel = shown.length > 0 && shown.every((t) => sel.includes(t.id));

  const cell = (c, t) => {
    switch (c.id) {
      case 'symbol': return t.symbol;
      case 'direction': return <span className={`dir ${t.direction}`}>{t.direction}</span>;
      case 'date': return fmtDate(t.entry);
      case 'entry': return fmtTime12(t.entry);
      case 'exit': return fmtTime12(t.exit);
      case 'account': return t.accountId;
      case 'qty': return t.qty;
      case 'hold': return fmtHold(holdSeconds(t));
      case 'strategy': return stratName(t.strategyId);
      case 'tags': return t.tags?.length ? <span className="row gap4">{t.tags.slice(0, 2).map((x) => <span key={x} className="chip" style={{ padding: '2px 7px' }}>{x}</span>)}{t.tags.length > 2 && <span className="muted">+{t.tags.length - 2}</span>}</span> : <span className="muted">—</span>;
      case 'pnl': return <Money v={t.pnl} colored />;
      default: return null;
    }
  };

  return (
    <div className="page">
      <div className="toolbar">
        <AccountPicker />
        <DateRange value={range} onChange={(r) => { setRange(r); setPage(0); }} />
        <div className="grow" />
        <FilterButton value={filters} onChange={(f) => { setFilters(f); setPage(0); }} trades={all} />
        <div className="sep-v" style={{ margin: '4px 6px' }} />
        <Seg value={view} onChange={setView} options={[{ value: 'list', label: 'List', icon: List }, { value: 'grid', label: 'Grid', icon: LayoutGrid }, { value: 'calendar', label: 'Calendar', icon: Calendar }]} />
        <div className="sep-v" style={{ margin: '4px 6px' }} />
        <button className="btn" onClick={() => setImporting(true)}><Upload size={15} /> Import</button>
        <button className="btn white" onClick={() => setAdding(true)}>Add trade <Plus size={17} /></button>
      </div>

      {isInbox && (
        <div className="panel row gap16" style={{ marginBottom: 16, padding: '14px 20px' }}>
          <InboxIcon size={18} className="muted" />
          <div className="grow">
            <div style={{ fontWeight: 500 }}>{trades.length ? `${trades.length} trade${trades.length > 1 ? 's' : ''} waiting for review` : 'Inbox zero'}</div>
            <div className="muted" style={{ fontSize: 13 }}>New and synced trades land here. Add tags, a strategy and notes, then mark them reviewed.</div>
          </div>
          {trades.length > 0 && <button className="btn sm" onClick={() => { trades.forEach((t) => updateTrade(t.id, { reviewed: true })); toast('All trades marked reviewed'); }}><Check size={14} /> Mark all reviewed</button>}
        </div>
      )}

      {sel.length > 0 && (
        <div className="row gap12" style={{ marginBottom: 12, padding: '8px 14px', background: 'var(--card-2)', border: '1px solid var(--border-2)' }}>
          <b style={{ fontWeight: 500 }}>{sel.length} selected</b>
          <div className="grow" />
          <button className="btn xs" onClick={() => { sel.forEach((id) => updateTrade(id, { reviewed: true })); setSel([]); toast('Marked reviewed'); }}><Check size={13} /> Mark reviewed</button>
          <button className="btn xs danger" onClick={() => setConfirmDel(true)}><Trash size={13} /> Delete</button>
          <button className="btn xs" onClick={() => setSel([])}>Clear</button>
        </div>
      )}

      {view === 'list' && (
        <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 230px)' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th className="chk"><input type="checkbox" className="cbx" checked={allSel} onChange={() => setSel(allSel ? sel.filter((id) => !shown.some((t) => t.id === id)) : [...new Set([...sel, ...shown.map((t) => t.id)])])} /></th>
                {cols.map((c) => (
                  <th key={c.id}>
                    <div className="th">
                      <span className="row gap6" onClick={() => setSort((s0) => ({ col: c.id, dir: s0.col === c.id && s0.dir === 'desc' ? 'asc' : 'desc' }))}>
                        {c.label}
                        {sort.col === c.id && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                      </span>
                      <Popover align="right" trigger={({ toggle }) => <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={toggle}><EllipsisVertical size={15} /></button>}>
                        {(close) => (
                          <>
                            <button className="pop-item" onClick={() => { setSort({ col: c.id, dir: 'asc' }); close(); }}><ArrowUp size={14} /> Sort ascending</button>
                            <button className="pop-item" onClick={() => { setSort({ col: c.id, dir: 'desc' }); close(); }}><ArrowDown size={14} /> Sort descending</button>
                            <button className="pop-item" onClick={() => { setHidden((h) => [...h, c.id]); close(); }}><EyeOff size={14} /> Hide column</button>
                            <div className="pop-sep" />
                            <div className="muted" style={{ fontSize: 11.5, padding: '4px 10px' }}>Columns</div>
                            {COLS.map((x) => (
                              <button key={x.id} className="pop-item" onClick={() => setHidden((h) => (h.includes(x.id) ? h.filter((y) => y !== x.id) : [...h, x.id]))}>
                                <span style={{ width: 14 }}>{!hidden.includes(x.id) && <Check size={14} />}</span>{x.label}
                              </button>
                            ))}
                          </>
                        )}
                      </Popover>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className={`r-${t.pnl > 0 ? 'win' : t.pnl < 0 ? 'loss' : 'be'} ${sel.includes(t.id) ? 'sel' : ''}`} onClick={() => setOpen(t)}>
                  <td className="chk" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="cbx" checked={sel.includes(t.id)} onChange={() => setSel((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))} />
                  </td>
                  {cols.map((c) => <td key={c.id}>{cell(c, t)}</td>)}
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={cols.length + 1} style={{ height: 160, textAlign: 'center' }} className="muted">{isInbox ? 'Nothing to review — nice work.' : 'No trades match. Add one with “Add trade”.'}</td></tr>
              )}
            </tbody>
          </table>
          <div className="pager">
            <span className="grow">
              {trades.length} trades · Net <Money v={s.net} colored /> · Win rate {s.winRate.toFixed(0)}% · PF {pfText(s.profitFactor)}
            </span>
            <span>Rows</span>
            <select className="select" style={{ height: 28, width: 70 }} value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(0); }}>
              {[10, 25, 50, 100].map((n) => <option key={n}>{n}</option>)}
            </select>
            <span>{trades.length ? pg * perPage + 1 : 0} to {Math.min(trades.length, (pg + 1) * perPage)} of {trades.length}</span>
            <button className="icon-btn" disabled={pg === 0} onClick={() => setPage(pg - 1)}><ChevronLeft size={16} /></button>
            <span>Page {pg + 1} of {pages}</span>
            <button className="icon-btn" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {view === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(270px,1fr))', gap: 14 }}>
          {trades.map((t) => (
            <div key={t.id} className={`kpi ${t.pnl >= 0 ? 'posc' : 'negc'}`} style={{ minHeight: 0, padding: 18, cursor: 'pointer' }} onClick={() => setOpen(t)}>
              <div className="row between">
                <span className="row gap8"><b style={{ fontWeight: 600 }}>{t.symbol}</b><span className={`dir ${t.direction}`}>{t.direction}</span></span>
                {!t.reviewed && <span className="badge neutral">Inbox</span>}
              </div>
              <div style={{ fontSize: 24, fontWeight: 500, margin: '16px 0 8px' }}><Money v={t.pnl} colored /></div>
              <div className="row between muted" style={{ fontSize: 12.5 }}>
                <span>{fmtDate(t.entry)} · {fmtTime12(t.entry)}</span>
                <span className="row gap4"><Clock size={12} />{fmtHold(holdSeconds(t))}</span>
              </div>
              {t.tags?.length > 0 && <div className="row gap4 wrap" style={{ marginTop: 10 }}>{t.tags.map((x) => <span key={x} className="chip" style={{ padding: '2px 7px' }}>{x}</span>)}</div>}
            </div>
          ))}
          {trades.length === 0 && <div className="empty">No trades</div>}
        </div>
      )}

      {view === 'calendar' && (
        <div className="panel">
          <PnlCalendar days={groupByDay(trades)} onDay={openDay} />
        </div>
      )}

      <TradeFormModal open={adding} onClose={() => setAdding(false)} />
      <ImportModal open={importing} onClose={() => setImporting(false)} />
      {open && <TradeDrawer trade={open} onClose={() => setOpen(null)} />}
      <Confirm open={confirmDel} title={`Delete ${sel.length} trade${sel.length > 1 ? 's' : ''}?`} body="Selected trades will be permanently removed." onCancel={() => setConfirmDel(false)} onConfirm={() => { deleteTrades(sel); setSel([]); setConfirmDel(false); toast('Trades deleted'); }} />
    </div>
  );
}
