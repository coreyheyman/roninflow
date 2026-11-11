import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash, Pencil, ImagePlus, Clock, Check, X, Plus, MessageCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from '../store/store';
import { Modal, ModalHead, Drawer, Money, Stars, Seg, useToast, Confirm, fileToDataUrl } from './ui';
import { computePnl, fmtDate, fmtTime12, fmtHold, holdSeconds, POINT_VALUE, pad, fmtMoney } from '../lib/stats';
import { BlockerPicker } from './Playbook';
import ExecChart from './ExecChart';
import { askCoachAboutImage } from '../lib/askCoach';
import { buildReviewContext } from '../lib/coach';

const SYMBOLS = Object.keys(POINT_VALUE);

export function TagPicker({ value = [], onChange }) {
  const { state, addTag } = useStore();
  const [txt, setTxt] = useState('');
  const toggle = (t) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  return (
    <div className="col gap8">
      <div className="row gap6 wrap">
        {state.tags.map((t) => (
          <button key={t} className={`chip ${value.includes(t) ? 'on' : ''}`} onClick={() => toggle(t)} type="button">
            {value.includes(t) && <Check size={12} />} {t}
          </button>
        ))}
      </div>
      <form
        className="row gap8"
        onSubmit={(e) => {
          e.preventDefault();
          const t = txt.trim();
          if (!t) return;
          addTag(t);
          if (!value.includes(t)) onChange([...value, t]);
          setTxt('');
        }}
      >
        <input className="input" style={{ height: 32 }} placeholder="Create a tag…" value={txt} onChange={(e) => setTxt(e.target.value)} />
        <button className="btn sm" type="submit"><Plus size={14} /> Add</button>
      </form>
    </div>
  );
}

const nowParts = () => {
  const d = new Date();
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
};

export function TradeFormModal({ open, onClose, trade }) {
  const { state, addTrade, updateTrade } = useStore();
  const toast = useToast();
  const init = () => {
    if (trade) {
      return {
        accountId: trade.accountId, symbol: trade.symbol, direction: trade.direction, date: trade.entry.slice(0, 10),
        entryTime: trade.entry.slice(11, 19), exitDate: trade.exit.slice(0, 10), exitTime: trade.exit.slice(11, 19), qty: trade.qty, entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice, fees: trade.fees, pnl: trade.pnl, manualPnl: true, strategyId: trade.strategyId || '', tags: trade.tags || [], notes: trade.notes || '',
      };
    }
    const n = nowParts();
    return {
      accountId: state.settings.account === 'all' ? state.accounts[0]?.id : state.settings.account, symbol: 'MES', direction: 'Long', date: n.date, entryTime: n.time + ':00',
      exitDate: n.date, exitTime: n.time + ':00', qty: 1, entryPrice: '', exitPrice: '', fees: 0.7, pnl: '', manualPnl: false, strategyId: '', tags: [], notes: '',
    };
  };
  const [f, setF] = useState(init);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) { setLastOpen(open); if (open) setF(init()); }
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const auto = f.entryPrice !== '' && f.exitPrice !== '' ? computePnl(f) : null;
  const pnl = f.manualPnl ? Number(f.pnl) : auto;
  const valid = f.accountId && f.symbol && f.date && f.entryTime && (pnl !== null && !Number.isNaN(pnl));

  const save = () => {
    const tm = (t) => (t.length === 5 ? t + ':00' : t);
    const data = {
      accountId: f.accountId, symbol: f.symbol.toUpperCase(), direction: f.direction, entry: `${f.date}T${tm(f.entryTime)}`, exit: `${f.exitDate || f.date}T${tm(f.exitTime || f.entryTime)}`,
      qty: Number(f.qty), entryPrice: Number(f.entryPrice) || 0, exitPrice: Number(f.exitPrice) || 0, fees: Number(f.fees) || 0, pnl: Math.round(pnl * 100) / 100,
      strategyId: f.strategyId || null, tags: f.tags, notes: f.notes,
    };
    if (trade) { updateTrade(trade.id, data); toast('Trade updated'); }
    else { addTrade(data); toast('Trade added to your Inbox'); }
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} width={720}>
      <ModalHead title={trade ? 'Edit trade' : 'Add trade'} sub={trade ? `${trade.symbol} · ${fmtDate(trade.entry)}` : 'Log a trade manually — use Import for ATAS / broker files'} onClose={onClose} />
      <div className="modal-body form-grid">
          <div className="field">
            <label className="label">Account</label>
            <select className="select" value={f.accountId} onChange={set('accountId')}>
              {state.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">Symbol</label>
            <input className="input" list="symbols" value={f.symbol} onChange={set('symbol')} />
            <datalist id="symbols">{SYMBOLS.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div className="field">
            <label className="label">Direction</label>
            <Seg value={f.direction} onChange={set('direction')} options={[{ value: 'Long', label: 'Long' }, { value: 'Short', label: 'Short' }]} />
          </div>
          <div className="field">
            <label className="label">Quantity</label>
            <input className="input" type="number" min="1" value={f.qty} onChange={set('qty')} />
          </div>
          <div className="field">
            <label className="label">Entry date & time</label>
            <div className="row gap8">
              <input className="input" type="date" value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value, exitDate: x.exitDate === x.date ? e.target.value : x.exitDate }))} />
              <input className="input" type="time" step="1" value={f.entryTime} onChange={set('entryTime')} />
            </div>
          </div>
          <div className="field">
            <label className="label">Exit date & time</label>
            <div className="row gap8">
              <input className="input" type="date" value={f.exitDate} onChange={set('exitDate')} />
              <input className="input" type="time" step="1" value={f.exitTime} onChange={set('exitTime')} />
            </div>
          </div>
          <div className="field">
            <label className="label">Entry price</label>
            <input className="input" type="number" step="0.01" value={f.entryPrice} onChange={set('entryPrice')} placeholder="e.g. 6905.25" />
          </div>
          <div className="field">
            <label className="label">Exit price</label>
            <input className="input" type="number" step="0.01" value={f.exitPrice} onChange={set('exitPrice')} placeholder="e.g. 6911.50" />
          </div>
          <div className="field">
            <label className="label">Fees & commissions</label>
            <input className="input" type="number" step="0.01" value={f.fees} onChange={set('fees')} />
          </div>
          <div className="field">
            <label className="label row between">
              <span>Net P&L</span>
              <span className="row gap6 muted" style={{ fontSize: 11.5 }}>
                <input type="checkbox" className="cbx" checked={f.manualPnl} onChange={(e) => setF((x) => ({ ...x, manualPnl: e.target.checked, pnl: x.pnl === '' && auto !== null ? auto : x.pnl }))} /> Override
              </span>
            </label>
            {f.manualPnl ? (
              <input className="input" type="number" step="0.01" value={f.pnl} onChange={set('pnl')} />
            ) : (
              <div className="input row" style={{ background: 'var(--card-2)' }}>
                {auto === null ? <span className="muted2">Calculated from prices</span> : <Money v={auto} colored />}
              </div>
            )}
          </div>
          <div className="field full">
            <label className="label">Strategy</label>
            <select className="select" value={f.strategyId} onChange={set('strategyId')}>
              <option value="">No strategy</option>
              {state.strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field full">
            <label className="label">Tags</label>
            <TagPicker value={f.tags} onChange={set('tags')} />
          </div>
          <div className="field full">
            <label className="label">Notes</label>
            <textarea className="textarea" value={f.notes} onChange={set('notes')} placeholder="Why did you take it? What did you see?" />
          </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn white" disabled={!valid} onClick={save}>{trade ? 'Save changes' : 'Add trade'}</button>
      </div>
    </Modal>
  );
}

/**
 * siblings: optional ordered list of trades (e.g. the day's trades) — adds ‹ › to step through them, and
 * "Mark as reviewed" then jumps to the next unreviewed one (closing when none are left).
 */
/** Wide screens show the trade's chart as a large window beside the review drawer; narrow ones inline. */
const WIDE_Q = '(min-width: 1100px)';
function useWide() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE_Q).matches);
  useEffect(() => {
    const m = window.matchMedia(WIDE_Q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

export function TradeDrawer({ trade, onClose, siblings = null, onNavigate }) {
  const { state, updateTrade, deleteTrades } = useStore();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const toast = useToast();
  const fileRef = useRef(null);
  const live = useMemo(() => trade && state.trades.find((t) => t.id === trade.id), [trade, state.trades]);
  // ← / → step through the day's trades (not while typing); jump back to the top on each new trade
  const navRef = useRef(null);
  const slideRef = useRef({ id: trade?.id, at: null, dir: '' }); // which way to swipe when stepping trades
  useEffect(() => {
    if (!siblings || !onNavigate) return;
    const k = (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' && navRef.current?.prev) { e.preventDefault(); onNavigate(navRef.current.prev); }
      if (e.key === 'ArrowRight' && navRef.current?.next) { e.preventDefault(); onNavigate(navRef.current.next); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [siblings, onNavigate]);
  const wide = useWide();
  useEffect(() => { document.querySelectorAll('.drawer .drawer-scroll').forEach((el) => el.scrollTo?.(0, 0)); }, [trade?.id]);
  if (!trade || !live) return null;
  const t = live;
  const up = (patch) => updateTrade(t.id, patch);
  const acct = state.accounts.find((a) => a.id === t.accountId);
  // stepping through the day's trades
  const list = siblings ? siblings.map((x) => state.trades.find((y) => y.id === x.id) || x) : null;
  const at = list ? list.findIndex((x) => x.id === t.id) : -1;
  const nav = list && at >= 0 && list.length > 1 ? {
    pos: at + 1, total: list.length, prev: list[at - 1] || null, next: list[at + 1] || null,
    left: list.filter((x) => !x.reviewed && x.id !== t.id).length,
  } : null;
  navRef.current = nav;
  if (slideRef.current.id !== t.id) slideRef.current = { id: t.id, at, dir: slideRef.current.at == null || at === slideRef.current.at ? '' : at > slideRef.current.at ? 'from-right' : 'from-left' };
  else slideRef.current.at = at;
  const slide = slideRef.current.dir;
  const markReviewed = () => {
    up({ reviewed: true });
    if (list && onNavigate) {
      // next unreviewed after this one, wrapping round to earlier ones
      const order = [...list.slice(at + 1), ...list.slice(0, Math.max(0, at))];
      const nxt = order.find((x) => !x.reviewed && x.id !== t.id);
      if (nxt) { toast('Trade reviewed — next one'); onNavigate(nxt); return; }
      toast('All trades for this day reviewed');
    } else toast('Trade reviewed');
    onClose();
  };
  const askAboutShot = (src) => {
    const day = t.entry.slice(0, 10);
    const dayTrades = state.trades.filter((x) => x.accountId === t.accountId && x.entry.slice(0, 10) === day);
    const label = `${t.symbol} ${t.direction} · ${fmtDate(t.entry)} ${fmtTime12(t.entry)}`;
    askCoachAboutImage({
      src,
      title: `Chart · ${label}`,
      text: `This is the chart for my ${t.symbol} ${t.direction} trade on ${fmtDate(t.entry)} at ${fmtTime12(t.entry)} (${fmtMoney(t.pnl, { sign: true })}), with my execution, market structure and order flow. Was the entry and exit well placed relative to the structure and order flow? What should I have done differently?`,
      focus: { ...buildReviewContext(state, { kind: 'day', label: fmtDate(t.entry), date: day, trades: dayTrades }), focusTrade: { time: t.entry, exit: t.exit, symbol: t.symbol, side: t.direction, qty: t.qty, entryPrice: t.entryPrice, exitPrice: t.exitPrice, pnl: t.pnl, edgeBlockers: t.blockers, tags: t.tags, notes: t.notes || undefined } },
    }).catch(() => {});
  };
  const addShots = async (e) => {
    const files = [...(e.target.files || [])];
    const urls = await Promise.all(files.map((f) => fileToDataUrl(f)));
    up({ screenshots: [...(t.screenshots || []), ...urls] });
    e.target.value = '';
  };
  const Stat = ({ k, v }) => (
    <div style={{ padding: '12px 14px', background: 'var(--card-2)', border: '1px solid var(--border)' }}>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>{k}</div>
      <div style={{ fontWeight: 500 }}>{v}</div>
    </div>
  );
  return (
    <>
      <Drawer open onClose={onClose}>
        <div key={`h-${t.id}`} className={`modal-head trade-slide ${slide}`} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 18 }}>
          <div>
            <div className="row gap12">
              <span className="modal-title">{t.symbol}</span>
              <span className={`dir ${t.direction}`}>{t.direction}</span>
              {!t.reviewed && <span className="badge neutral">Inbox</span>}
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>{fmtDate(t.entry)} · {fmtTime12(t.entry)} → {fmtTime12(t.exit)}</div>
          </div>
          <div className="row gap8">
            <button className="icon-btn" title="Edit" onClick={() => setEdit(true)}><Pencil size={16} /></button>
            <button className="icon-btn" title="Delete" onClick={() => setDel(true)}><Trash size={16} /></button>
            <button className="icon-btn" onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        <div key={`b-${t.id}`} style={{ overflow: 'auto', flex: 1, padding: '20px 24px' }} className={`col gap24 drawer-scroll trade-slide ${slide}`}>
          {wide && t.entry && t.exit && t.symbol && createPortal(
            <div className="ec-float" onMouseDown={(e) => e.stopPropagation()}>
              <ExecChart key={t.id} focus={t} big title={<>{t.symbol} <span className={`dir ${t.direction}`} style={{ marginLeft: 6 }}>{t.direction}</span> <span className="muted" style={{ fontWeight: 400, fontSize: 13, marginLeft: 6 }}>{fmtDate(String(t.entry).slice(0, 10))} · {fmtTime12(t.entry)} → {fmtTime12(t.exit)}</span></>} />
            </div>,
            document.body,
          )}
          <div>
            <div className="muted" style={{ fontSize: 12.5 }}>Net P&L</div>
            <div style={{ fontSize: 34, fontWeight: 500, letterSpacing: '-0.03em' }}><Money v={t.pnl} colored /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            <Stat k={t.fills?.length > 1 ? 'Avg entry' : 'Entry price'} v={t.entryPrice ? +Number(t.entryPrice).toFixed(2) : '—'} />
            <Stat k={t.fills?.length > 1 ? 'Avg exit' : 'Exit price'} v={t.exitPrice ? +Number(t.exitPrice).toFixed(2) : '—'} />
            <Stat k="Quantity" v={t.fills?.length > 1 ? `${t.qty} (${t.fills.length} fills)` : t.qty} />
            <Stat k="Hold time" v={<span className="row gap6"><Clock size={13} />{fmtHold(holdSeconds(t))}</span>} />
            <Stat k="Fees" v={<Money v={t.fees || 0} />} />
            <Stat k="Account" v={<span className="truncate" style={{ display: 'block' }}>{acct?.name || t.accountId}</span>} />
          </div>
          {t.entry && t.exit && t.symbol && !wide && <ExecChart focus={t} />}
          {t.fills?.length > 1 && (
            <div className="field">
              <label className="label">Fills <span className="muted" style={{ fontWeight: 400 }}>— scaled entries / exits combined into this trade</span></label>
              <div className="fills">
                <div className="fills-row head"><span>In</span><span>Out</span><span>Qty</span><span>Entry</span><span>Exit</span><span>P&L</span></div>
                {t.fills.map((f) => (
                  <div key={f.atasId} className="fills-row">
                    <span>{fmtTime12(f.entry)}</span><span>{fmtTime12(f.exit)}</span><span>{f.qty}</span>
                    <span>{f.entryPrice}</span><span>{f.exitPrice}</span><span><Money v={f.pnl} colored /></span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="field">
            <label className="label">Strategy</label>
            <select className="select" value={t.strategyId || ''} onChange={(e) => up({ strategyId: e.target.value || null })}>
              <option value="">No strategy</option>
              {state.strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {state.strategies.length === 0 && <a href="#/strategy" className="muted" style={{ fontSize: 12, marginTop: 6 }}>Create a strategy →</a>}
          </div>
          <div className="field">
            <label className="label">Tags</label>
            <TagPicker value={t.tags || []} onChange={(tags) => up({ tags })} />
          </div>
          <div className="field">
            <label className="label">Edge blockers <span className="muted" style={{ fontWeight: 400 }}>— anything that pulled you off your plan on this trade</span></label>
            <BlockerPicker value={t.blockers || []} onChange={(blockers) => up({ blockers })} />
            {!(t.blockers || []).length && <span className="muted2" style={{ fontSize: 12, marginTop: 6 }}>None flagged — counts as a disciplined trade.</span>}
          </div>
          <div className="field">
            <label className="label">Execution rating</label>
            <Stars value={t.rating || 0} onChange={(rating) => up({ rating })} />
          </div>
          <div className="field">
            <label className="label">Notes</label>
            <textarea className="textarea" style={{ minHeight: 120 }} value={t.notes || ''} onChange={(e) => up({ notes: e.target.value })} placeholder="What was the setup? Did you follow your plan?" />
          </div>
          <div className="field">
            <label className="label row between"><span>Screenshots</span>
              <button className="btn xs" onClick={() => fileRef.current?.click()}><ImagePlus size={13} /> Add</button>
            </label>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={addShots} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
              {(t.screenshots || []).map((src, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <a href={src} target="_blank" rel="noreferrer"><img src={src} alt="" style={{ width: '100%', display: 'block', border: '1px solid var(--border)' }} /></a>
                  <button className="close-x" style={{ position: 'absolute', top: 6, right: 6 }} onClick={() => up({ screenshots: t.screenshots.filter((_, j) => j !== i) })}><X size={12} /></button>
                  <button className="btn xs shot-ask" onClick={() => askAboutShot(src)} title="Ask coach about this chart"><MessageCircle size={12} /> Ask coach</button>
                </div>
              ))}
              {!t.screenshots?.length && <div className="muted2" style={{ fontSize: 13 }}>No screenshots yet</div>}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          {nav && (
            <div className="row gap6 trade-nav">
              <button className="icon-btn bordered" disabled={!nav.prev} onClick={() => onNavigate(nav.prev)} title="Previous trade (←)"><ChevronLeft size={16} /></button>
              <span className="muted" style={{ fontSize: 12.5, minWidth: 54, textAlign: 'center' }}>{nav.pos} of {nav.total}</span>
              <button className="icon-btn bordered" disabled={!nav.next} onClick={() => onNavigate(nav.next)} title="Next trade (→)"><ChevronRight size={16} /></button>
              {nav.left > 0 && <span className="muted2 hide-sm" style={{ fontSize: 12, marginLeft: 6 }}>{nav.left} to review</span>}
            </div>
          )}
          <div className="grow" />
          {t.reviewed ? (
            <button className="btn" onClick={() => up({ reviewed: false })}>Move back to Inbox</button>
          ) : (
            <button className="btn primary" onClick={markReviewed}><Check size={15} /> Mark as reviewed</button>
          )}
        </div>
      </Drawer>
      <TradeFormModal open={edit} onClose={() => setEdit(false)} trade={t} />
      <Confirm open={del} title="Delete trade?" body="This trade will be permanently removed from your journal." onCancel={() => setDel(false)} onConfirm={() => { deleteTrades([t.id]); setDel(false); onClose(); toast('Trade deleted'); }} />
    </>
  );
}
