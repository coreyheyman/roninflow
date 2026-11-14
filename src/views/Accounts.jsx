import { useMemo, useState } from 'react';
import { Funnel, LayoutGrid, List, Plus, Upload, EllipsisVertical, RefreshCw, ChartArea, ChartLine, ChartColumn, Check, Pencil, Trash, Receipt, HandCoins, Target } from 'lucide-react';
import { useStore, navigate } from '../store/store';
import { Seg, Popover, Modal, ModalHead, Money, Private, TrendBadge, Confirm, useToast, CloseX, Switch, DateRange } from '../components/ui';
import { PnlChart } from '../components/Charts';
import ImportModal from '../components/ImportModal';
import { useAtasSync } from '../components/AtasSync';
import { summarize, equityCurve, fmtDate, fmtShortDate, fmtMoney, fmtCompact, groupByDay, fmtTime12, todayKey, inRange } from '../lib/stats';
import { accountCost, accountBought, portfolioStats } from '../lib/accountStats';
import { accountBalanceInfo } from '../lib/balance';
import { accountDrawdown, DD_TYPES, ddTypeOf, ddTypeLabel, floorSeries } from '../lib/accountDD';

const AcctLogo = ({ name = '' }) => <div className="acct-logo">{(name.match(/[A-Za-z]/) || ['A'])[0].toUpperCase()}</div>;
const STATUSES = ['Active', 'Breached', 'Passed', 'Funded'];

function useAccountData(a) {
  const { state } = useStore();
  return useMemo(() => {
    const trades = state.trades.filter((t) => t.accountId === a.id);
    const s = summarize(trades);
    const days = groupByDay(trades);
    let c = 0;
    const asc = [...days].reverse();
    const daily = asc.map((d) => { c += d.net; return { label: fmtShortDate(d.date), y: Math.round(c * 100) / 100, tip: fmtDate(d.date), net: d.net }; });
    // max-loss floor per day (P&L vs start). Intraday trailing: the live high from ATAS (open P&L included) can
    // have lifted today's floor further than the closed trades show.
    const floors = floorSeries(a, asc);
    if (floors?.length && ddTypeOf(a) === 'intraday') {
      const dd = accountDrawdown(state, a);
      const gap = accountBalanceInfo(state, a.id)?.gap || 0;
      floors[floors.length - 1] = Math.max(floors[floors.length - 1], Math.round((dd.floor - a.initial - gap) * 100) / 100);
    }
    return { trades, s, days, daily, floors };
  }, [state.trades, state.settings.sync, a, state]);
}

/** Lines for an account's P&L chart: profit target and the max-loss floor (or the daily loss limit on daily bars). */
function limitGuides(a, floors, bars = false) {
  if (bars) return Number(a.dailyLossLimit) > 0 ? [{ label: 'Daily loss limit', value: -Number(a.dailyLossLimit), tone: 'warn' }] : [];
  return [
    Number(a.profitTarget) > 0 && { label: 'Profit target', value: Number(a.profitTarget), tone: 'pos' },
    floors && { label: `Max loss · ${ddTypeLabel(a)}`, value: floors, tone: 'neg', start: -Number(a.maxDrawdown) },
  ];
}

const cleanCost = (f) => ({ ...f, cost: f.cost === '' ? 0 : Number(f.cost) || 0, fees: f.fees === '' ? 0 : Number(f.fees) || 0 });

function CostFields({ f, setF }) {
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <>
      <div className="field"><label className="label">Account cost (USD)</label><input className="input" type="number" min="0" step="0.01" value={f.cost ?? ''} onChange={set('cost')} placeholder="e.g. 149" /></div>
      <div className="field"><label className="label">Resets / activation fees (USD)</label><input className="input" type="number" min="0" step="0.01" value={f.fees ?? ''} onChange={set('fees')} placeholder="0" /></div>
      <div className="field"><label className="label">Purchase date</label><input className="input" type="date" value={f.purchasedAt || ''} onChange={set('purchasedAt')} /></div>
    </>
  );
}

/** Quick "how much did this account cost" editor from the ⋮ menu. */
function CostModal({ account, onClose }) {
  const { updateAccount } = useStore();
  const toast = useToast();
  const [f, setF] = useState(() => ({ cost: account.cost ?? '', fees: account.fees ?? '', purchasedAt: accountBought(account) || todayKey() }));
  return (
    <Modal open onClose={onClose} width={560}>
      <ModalHead title="Account cost" sub={account.name || account.id} onClose={onClose} />
      <div className="modal-body form-grid"><CostFields f={f} setF={setF} /></div>
      <div className="modal-foot">
        <span className="muted" style={{ fontSize: 12.5 }}>Total: <b style={{ color: 'var(--fg)', fontWeight: 500 }}>{fmtMoney((Number(f.cost) || 0) + (Number(f.fees) || 0))}</b></span>
        <div className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn white" onClick={() => { updateAccount(account.id, cleanCost(f)); toast('Account cost saved'); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}

function AccountForm({ open, onClose, account }) {
  const { addAccount, updateAccount, state } = useStore();
  const toast = useToast();
  const init = () => ({ cost: '', fees: '', purchasedAt: account?.createdAt || todayKey(), ...(account || { name: '', phase: 'Challenge', market: 'Futures', plan: 'Classic', status: 'Active', initial: 50000, profitTarget: 3000, maxDrawdown: 2000, dailyLossLimit: 1000, broker: 'ATAS', autoSync: true }) });
  const [f, setF] = useState(init);
  const [was, setWas] = useState(open);
  if (was !== open) { setWas(open); if (open) setF(init()); }
  const set = (k, num) => (e) => setF((x) => ({ ...x, [k]: num ? Number(e.target.value) : e.target.value }));
  const dupe = !account && state.accounts.some((a) => a.id === f.name.trim());
  return (
    <Modal open={open} onClose={onClose} width={620}>
      <ModalHead title={account ? 'Edit account' : 'Add account'} sub="Track a prop-firm challenge, funded or personal account" onClose={onClose} />
      <div className="modal-body form-grid">
        <div className="field full"><label className="label">Account ID / name</label><input className="input" disabled={!!account} value={f.name} onChange={set('name')} placeholder="e.g. PA-50K-12345" />{dupe && <span className="neg" style={{ fontSize: 12, marginTop: 4 }}>An account with this ID already exists</span>}</div>
        <div className="field"><label className="label">Phase</label><select className="select" value={f.phase} onChange={set('phase')}>{['Challenge', 'Verification', 'Funded', 'Personal'].map((x) => <option key={x}>{x}</option>)}</select></div>
        <div className="field"><label className="label">Market</label><select className="select" value={f.market} onChange={set('market')}>{['Futures', 'Forex', 'Stocks', 'Crypto', 'Options'].map((x) => <option key={x}>{x}</option>)}</select></div>
        <div className="field"><label className="label">Plan</label><input className="input" value={f.plan} onChange={set('plan')} /></div>
        <div className="field"><label className="label">Status</label><select className="select" value={f.status} onChange={set('status')}>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select></div>
        <div className="field"><label className="label">Initial balance (USD)</label><input className="input" type="number" value={f.initial} onChange={set('initial', true)} /></div>
        <div className="field"><label className="label">Profit target (USD)</label><input className="input" type="number" value={f.profitTarget} onChange={set('profitTarget', true)} /></div>
        <div className="field"><label className="label">Max drawdown (USD)</label><input className="input" type="number" value={f.maxDrawdown} onChange={set('maxDrawdown', true)} /></div>
        <div className="field"><label className="label">Drawdown type</label>
          <select className="select" value={ddTypeOf(f)} onChange={set('ddType')}>{DD_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>{DD_TYPES.find((t) => t.id === ddTypeOf(f)).note}</span>
        </div>
        {ddTypeOf(f) !== 'static' && (
          <label className="field row gap8" style={{ alignItems: 'center', cursor: 'pointer', alignSelf: 'end', paddingBottom: 22 }}>
            <input type="checkbox" checked={f.ddLock !== false} onChange={(e) => setF((x) => ({ ...x, ddLock: e.target.checked }))} />
            <span style={{ fontSize: 13 }}>Stops trailing at starting balance</span>
          </label>
        )}
        <div className="field"><label className="label">Daily loss limit (USD)</label><input className="input" type="number" value={f.dailyLossLimit} onChange={set('dailyLossLimit', true)} /></div>
        <div className="field full"><label className="label">Broker / platform</label><input className="input" value={f.broker} onChange={set('broker')} /></div>
        <div className="field full form-sep">Cost <span className="muted">— used for return on investment with your payouts</span></div>
        <CostFields f={f} setF={setF} />
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn white" disabled={!f.name.trim() || dupe} onClick={() => { const g = cleanCost(f); if (account) updateAccount(account.id, g); else addAccount({ ...g, name: f.name.trim(), id: f.name.trim() }); toast(account ? 'Account updated' : 'Account added'); onClose(); }}>{account ? 'Save' : 'Add account'}</button>
      </div>
    </Modal>
  );
}

function AccountMenu({ a, onEdit, onDelete }) {
  const { setSetting, updateAccount } = useStore();
  const [costOpen, setCostOpen] = useState(false);
  return (
    <>
    <Popover align="right" trigger={({ toggle }) => <button className="icon-btn" style={{ border: '1px solid var(--border-2)', width: 26, height: 26 }} onClick={(e) => { e.stopPropagation(); toggle(); }}><EllipsisVertical size={15} /></button>}>
      {(close) => (
        <div onClick={(e) => e.stopPropagation()}>
          <button className="pop-item" onClick={() => { setSetting('account', a.id); close(); navigate('dashboard'); }}>Open dashboard</button>
          <button className="pop-item" onClick={() => { setSetting('account', a.id); close(); navigate('journal/database'); }}>View trades</button>
          <button className="pop-item" onClick={() => { close(); onEdit(); }}><Pencil size={14} /> Edit</button>
          <button className="pop-item" onClick={() => { close(); setCostOpen(true); }}><Receipt size={14} /> {accountCost(a) ? `Account cost · ${fmtMoney(accountCost(a), { dp: 0 })}` : 'Add account cost'}</button>
          <button className="pop-item" onClick={() => { close(); navigate(`payouts?account=${encodeURIComponent(a.id)}&add=1`); }}><HandCoins size={14} /> Add payout</button>
          <div className="pop-sep" />
          <div className="muted" style={{ fontSize: 11.5, padding: '4px 10px' }}>Status</div>
          {STATUSES.map((s) => <button key={s} className="pop-item" onClick={() => { updateAccount(a.id, { status: s }); close(); }}><span style={{ width: 14 }}>{a.status === s && <Check size={14} />}</span>{s}</button>)}
          <div className="pop-sep" />
          <button className="pop-item danger" onClick={() => { close(); onDelete(); }}><Trash size={14} /> Delete account</button>
        </div>
      )}
    </Popover>
    {costOpen && <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}><CostModal account={a} onClose={() => setCostOpen(false)} /></div>}
    </>
  );
}

/** Live balance reported by ATAS for this account; Net P&L is worked out from it (balance − starting balance). */
function LiveBalance({ a, big = false }) {
  const { state } = useStore();
  const b = state.settings.sync?.balances?.[a.id];
  if (!b || b.balance == null) return null;
  const info = accountBalanceInfo(state, a.id);
  const live = Number(b.balance);
  const mins = Math.round((Date.now() - new Date(b.at).getTime()) / 60000);
  const when = mins < 2 ? 'live' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : fmtDate(b.at);
  return (
    <div className={`live-bal ${big ? 'big' : ''}`} onClick={(e) => e.stopPropagation()}>
      <span className="muted">ATAS balance</span>
      <b><Private>{fmtMoney(live)}</Private></b>
      <span className="muted2">({when}{b.openPnl ? <> · open P&L <Private>{fmtMoney(Number(b.openPnl), { sign: true })}</Private></> : null})</span>
      {info && (info.gap
        ? <span className="warn" title="Net P&L is calculated from the balance. This is the part the journal's trades don't account for (missing fills, fees charged to the account…).">· trades <Private>{fmtMoney(info.tradeNet)}</Private>, balance adj. <Private>{fmtMoney(info.gap, { sign: true })}</Private></span>
        : <span className="pos">· matches the journal's trades</span>)}
    </div>
  );
}

/** Live max-drawdown read-out for an account card: room left before the floor, by drawdown type. */
function DdLine({ a }) {
  const { state } = useStore();
  if (!Number(a.maxDrawdown)) return null;
  const dd = accountDrawdown(state, a);
  const cls = dd.breached ? 'neg' : dd.pct >= 75 ? 'neg' : dd.pct >= 50 ? 'warn' : 'muted';
  return (
    <div className="dd-line" title={`Floor ${fmtMoney(dd.floor)}${dd.locked ? ' (locked at starting balance)' : ''} · highest balance ${fmtMoney(dd.peak)}${dd.live ? ` · includes open P&L ${fmtMoney(dd.openPnl, { sign: true })}` : ''}`}>
      <span className="muted">Max DD · {ddTypeLabel(a)}</span>
      <span className="dd-track"><i style={{ width: `${Math.min(100, dd.pct)}%` }} className={dd.pct >= 75 ? 'hot' : dd.pct >= 50 ? 'warm' : ''} /></span>
      <span className={cls}><Private>{dd.breached ? 'Breached' : `${fmtMoney(Math.max(0, dd.left), { dp: 0 })} left`}</Private></span>
    </div>
  );
}

function AccountCard({ a, onOpen, onEdit, onDelete }) {
  const { s, daily, floors } = useAccountData(a);
  const { state, updateAccount } = useStore();
  const net = s.net + (accountBalanceInfo(state, a.id)?.gap || 0);
  return (
    <div className="acct-card" onClick={onOpen}>
      <div className="row gap12" style={{ fontSize: 13, marginBottom: 18 }}>
        <b style={{ fontWeight: 500 }}>{a.name}</b>
        <span className="sep-v" />
        <span className="muted">{a.phase} · {a.market} · {a.plan}</span>
        <span className={`status ${a.status}`}>{a.status}</span>
        <div className="grow" />
        <AccountMenu a={a} onEdit={onEdit} onDelete={onDelete} />
      </div>
      <div className="row gap12" style={{ marginBottom: 14 }}>
        <AcctLogo name={a.name} />
        <span className="muted" style={{ fontSize: 13 }}>Net P&L:</span>
        <span style={{ fontSize: 23, fontWeight: 500, letterSpacing: '-0.03em' }}><Private>{fmtMoney(net)}</Private></span>
        <span className="muted" style={{ fontSize: 12.5 }}>Initial: {fmtCompact(a.initial)}{accountCost(a) > 0 && <> · Cost {fmtMoney(accountCost(a), { dp: 0 })}</>}</span>
        <TrendBadge value={(net / a.initial) * 100} />
        <div className="grow" />
        <button className="row gap6 muted" style={{ fontSize: 11.5 }} title={a.syncDisabled ? 'ATAS sync is off for this account — click to turn on' : 'ATAS sync is on — click to turn off'} onClick={(e) => { e.stopPropagation(); updateAccount(a.id, { syncDisabled: !a.syncDisabled }); }}>
          <RefreshCw size={12} style={{ color: a.syncDisabled ? undefined : 'var(--primary)' }} /> {a.syncDisabled ? 'Sync off' : 'Auto sync'}
        </button>
      </div>
      <LiveBalance a={a} />
      <DdLine a={a} />
      {daily.length ? <PnlChart data={daily} smooth height={180} xLabels={6} padLeft={44} startAtZero={false} dotted={false} guides={state.settings.acctLimits === false ? null : limitGuides(a, floors)} /> : <div className="muted" style={{ height: 180, display: 'grid', placeItems: 'center' }}>No trades yet</div>}
    </div>
  );
}

function AccountDetail({ a, onClose }) {
  const { s, daily, days, floors } = useAccountData(a);
  const { state, updateAccount, setSetting } = useStore();
  const showLimits = state.settings.acctLimits !== false;
  const net = s.net + (accountBalanceInfo(state, a.id)?.gap || 0);
  const toast = useToast();
  const [mode, setMode] = useState('area');
  const [syncing, setSyncing] = useState(false);
  const dd = accountDrawdown(state, a);
  const worstDay = days.reduce((m, d) => Math.min(m, d.net), 0);
  const sync = () => {
    setSyncing(true);
    setTimeout(() => { updateAccount(a.id, { lastSync: new Date().toISOString() }); setSyncing(false); toast('Account synced — journal is up to date'); }, 900);
  };
  const Bar = ({ label, v, max, color }) => (
    <div className="col gap6 grow">
      <div className="row between" style={{ fontSize: 12.5 }}><span className="muted">{label}</span><Private>{fmtMoney(v, { dp: 0 })} / {fmtMoney(max, { dp: 0 })}</Private></div>
      <div className="progress-bar"><i style={{ width: `${Math.min(100, Math.max(0, (v / max) * 100))}%`, background: color }} /></div>
    </div>
  );
  return (
    <Modal open onClose={onClose} width={920}>
      <div className="modal-head" style={{ padding: '30px 32px 6px' }}>
        <div>
          <div className="modal-title" style={{ fontSize: 21 }}>{a.name}</div>
          <div style={{ fontSize: 12.5, marginTop: 8, fontWeight: 500 }}>{a.status === 'Active' ? 'Live' : a.status}{a.lastSync && <span className="muted" style={{ fontWeight: 400 }}> · Last synced {fmtDate(a.lastSync)} {fmtTime12(a.lastSync)}</span>}</div>
        </div>
        <CloseX onClick={onClose} />
      </div>
      <div style={{ padding: '20px 32px 30px' }}>
        <div className="row gap16 wrap" style={{ padding: '14px 16px', border: '1px solid var(--border-2)', background: 'var(--card)', marginBottom: 20 }}>
          <AcctLogo name={a.name} />
          <span className="muted">Net P&L:</span>
          <span style={{ fontSize: 23, fontWeight: 500 }}><Private>{fmtMoney(net)}</Private></span>
          <TrendBadge value={(net / a.initial) * 100} />
          <span className="muted">Initial Balance:</span>
          <b style={{ fontWeight: 500 }}><Private>{fmtMoney(a.initial)}</Private></b>
          <div className="grow" />
          <button className="btn sm" onClick={sync} disabled={syncing}>{syncing ? <><RefreshCw size={13} className="spin" /> Syncing…</> : 'Sync Now'}</button>
          <button className={`btn sm limits-btn ${showLimits ? 'on' : ''}`} onClick={() => setSetting('acctLimits', !showLimits)} title="Show the profit target and max-loss lines on the charts"><Target size={13} /> Limits</button>
          <Seg icon value={mode} onChange={setMode} options={[{ value: 'area', icon: ChartArea }, { value: 'line', icon: ChartLine }, { value: 'bar', icon: ChartColumn }]} />
        </div>
        <div style={{ margin: '-8px 0 18px' }}><LiveBalance a={a} big /></div>
        {daily.length ? (
          <PnlChart data={mode === 'bar' ? daily.map((d) => ({ ...d, y: d.net })) : daily} mode={mode} height={340} xLabels={6} guides={showLimits ? limitGuides(a, floors, mode === 'bar') : null} />
        ) : <div className="empty">No trades in this account yet.</div>}
        <div className="row gap24" style={{ marginTop: 26 }}>
          <Bar label="Profit target" v={Math.max(0, net)} max={a.profitTarget || 1} color="var(--pos-strong)" />
          <Bar label={`Max drawdown used · ${ddTypeLabel(a)}`} v={dd.used} max={a.maxDrawdown || 1} color="var(--neg)" />
          <Bar label="Worst day vs daily limit" v={Math.abs(worstDay)} max={a.dailyLossLimit || 1} color="var(--warn)" />
        </div>
        <div className="row gap24 muted" style={{ marginTop: 20, fontSize: 13 }}>
          <span>{s.count} trades</span><span>{days.length} sessions</span><span>Win rate {Math.round(s.winRate)}%</span><span>Fees <Money v={-s.fees} /></span><span>{a.broker}</span>
        </div>
      </div>
    </Modal>
  );
}

const RTile = ({ label, value, sub, t = '' }) => (
  <div className={`rv-tile ${t}`}>
    <div className="rv-tile-l">{label}</div>
    <div className="rv-tile-v">{value}</div>
    {sub && <div className="rv-tile-s">{sub}</div>}
  </div>
);
const toneOf = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

/** Accounts → "Costs & ROI": what you've spent on accounts vs what you've been paid out. */
function AccountStats({ onCost }) {
  const { state } = useStore();
  const [range, setRange] = useState({ from: null, to: null });
  const ranged = !!(range.from || range.to);
  const inR = (k) => !!k && (!range.from || k.slice(0, 10) >= range.from) && (!range.to || k.slice(0, 10) <= range.to);
  const st = useMemo(() => {
    if (!ranged) return portfolioStats(state.accounts, state.payouts || [], state.trades, Object.fromEntries(state.accounts.map((x) => [x.id, accountBalanceInfo(state, x.id)?.gap || 0])));
    // a period: costs of accounts bought in it, payouts received in it, and trades taken in it
    const payouts = (state.payouts || []).filter((x) => inR(x.date));
    const trades = state.trades.filter((t) => inRange(t, range));
    const accounts = state.accounts
      .filter((a) => inR(accountBought(a)) || payouts.some((x) => x.accountId === a.id) || trades.some((t) => t.accountId === a.id))
      .map((a) => (inR(accountBought(a)) ? a : { ...a, cost: 0, fees: 0, _boughtBefore: true }));
    const out = portfolioStats(accounts, payouts, trades);
    const bought = accounts.filter((a) => !a._boughtBefore);
    const decided = bought.filter((a) => ['Passed', 'Funded', 'Breached'].includes(a.status));
    const passed = bought.filter((a) => a.status === 'Passed' || a.status === 'Funded').length;
    return { ...out, passRate: decided.length ? (passed / decided.length) * 100 : null, passed, breached: bought.filter((a) => a.status === 'Breached').length };
  }, [state, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
  const M = ({ v, sign }) => <Private>{fmtMoney(v, { dp: 0, sign })}</Private>;
  const rows = [...st.rows].sort((a, b) => (accountBought(b.a) || '').localeCompare(accountBought(a.a) || ''));
  const chart = st.timeline.map((p) => ({ label: fmtShortDate(p.date), y: p.y, tip: `${fmtDate(p.date)} · ${p.tip}` }));
  const missing = state.accounts.filter((a) => !accountCost(a)).length;
  const realCost = (a) => state.accounts.find((x) => x.id === a.id) || a; // edit the stored account, not the period copy
  return (
    <div className="col gap22">
      <div className="row gap12 wrap" style={{ alignItems: 'center', marginBottom: -6 }}>
        <DateRange value={range} onChange={setRange} />
        {ranged && <button className="btn sm" onClick={() => setRange({ from: null, to: null })}>All time</button>}
        <span className="muted" style={{ fontSize: 12.5 }}>{ranged ? 'Costs of accounts bought, payouts received and trades taken in this period' : 'All time'}</span>
      </div>
      <div className="rv-tiles acct-kpis">
        <RTile label="Return on investment" value={pct(st.roi)} t={st.roi == null ? '' : toneOf(st.roi)} sub={st.spent ? 'net payouts ÷ money spent' : ranged ? 'no account costs in this period' : 'add account costs to see ROI'} />
        <RTile label="Net profit" value={<M v={st.net} sign />} t={toneOf(st.net)} sub="payouts received − costs" />
        <RTile label="Payouts received" value={<M v={st.paid} />} t={st.paid ? 'pos' : ''} sub={`${st.payouts} payout${st.payouts === 1 ? '' : 's'}${st.payouts ? ` · avg ${fmtMoney(st.avgPayout, { dp: 0 })}` : ''}`} />
        <RTile label="Spent on accounts" value={<M v={st.spent} />} t={st.spent ? 'neg' : ''} sub={st.bought ? `${st.bought} account${st.bought === 1 ? '' : 's'} · avg ${fmtMoney(st.avgCost, { dp: 0 })}` : ranged ? 'no accounts bought in this period' : 'no costs entered yet'} />
        <RTile label="Pending payouts" value={<M v={st.pending} />} t={st.pending ? 'warn' : ''} sub="requested, not received yet" />
        <RTile label="Pass rate" value={st.passRate == null ? '—' : `${Math.round(st.passRate)}%`} sub={`${st.passed} passed/funded · ${st.breached} breached`} />
      </div>

      <div className="panel">
        <div className="panel-head"><div className="card-title">Money in vs money out</div><span className="muted" style={{ fontSize: 12.5 }}>Running total of payouts minus account costs</span></div>
        {chart.length >= 2 ? <PnlChart data={chart} height={260} xLabels={7} startAtZero /> : <div className="empty" style={{ padding: 40 }}>Add account costs and payouts to see the running total.</div>}
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-head" style={{ padding: '16px 20px 0' }}>
          <div className="card-title">By account</div>
          {missing > 0 && <span className="muted" style={{ fontSize: 12.5 }}>{missing} account{missing === 1 ? ' has' : 's have'} no cost yet</span>}
        </div>
        <div style={{ overflow: 'auto' }}>
          <table className="tbl">
            <thead><tr>{['Account', 'Status', 'Bought', 'Cost', 'Payouts', 'Net', 'ROI', 'Trading P&L', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.a.id}>
                  <td style={{ fontWeight: 500 }}>{r.a.name || r.a.id}</td>
                  <td><span className={`status ${r.a.status}`}>{r.a.status}</span></td>
                  <td className="muted">{accountBought(r.a) ? fmtDate(accountBought(r.a)) : '—'}</td>
                  <td>{r.a._boughtBefore ? <span className="muted2" title="Bought before this period">earlier</span> : r.cost ? <M v={-r.cost} /> : <span className="muted2">—</span>}</td>
                  <td>{r.paid ? <span className="pos"><M v={r.paid} /></span> : <span className="muted2">—</span>}{r.pending > 0 && <span className="warn" style={{ fontSize: 11.5, marginLeft: 6 }}>+<M v={r.pending} /> pending</span>}</td>
                  <td className={toneOf(r.net)}>{r.cost || r.paid ? <M v={r.net} sign /> : <span className="muted2">—</span>}</td>
                  <td className={r.roi == null ? '' : toneOf(r.roi)}>{pct(r.roi)}</td>
                  <td className={toneOf(r.trading)}><M v={r.trading} sign /></td>
                  <td style={{ textAlign: 'right' }}><button className="btn xs" onClick={() => onCost(realCost(r.a))}><Receipt size={12} /> {accountCost(realCost(r.a)) ? 'Edit cost' : 'Add cost'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function Accounts() {
  const { state, deleteAccount, setSetting } = useStore();
  const toast = useToast();
  const [view, setView] = useState('grid');
  const [filter, setFilter] = useState('All accounts');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const sync = useAtasSync();
  const [editing, setEditing] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [del, setDel] = useState(null);
  const [tab, setTab] = useState('accounts');
  const [costFor, setCostFor] = useState(null);
  const list = state.accounts.filter((a) => (filter === 'All accounts' ? !(state.settings.hideBreached && a.status === 'Breached') : a.status === filter));
  const open = state.accounts.find((a) => a.id === openId);
  return (
    <div className="page">
      <div className="row between wrap gap12" style={{ marginBottom: 6 }}>
        <div className="page-title" style={{ marginBottom: 12 }}>Accounts</div>
        <Seg value={tab} onChange={setTab} options={[{ value: 'accounts', label: 'Accounts' }, { value: 'stats', label: 'Costs & ROI' }]} />
      </div>
      {tab === 'stats' ? <AccountStats onCost={setCostFor} /> : <>
      <div className="toolbar">
        <Popover trigger={({ toggle }) => <button className="btn" onClick={toggle}><Funnel size={15} fill="currentColor" /> {filter}</button>}>
          {(close) => (
            <>
              {['All accounts', ...STATUSES].map((f) => <button key={f} className={`pop-item ${f === filter ? 'on' : ''}`} onClick={() => { setFilter(f); close(); }}>{f}</button>)}
              <div className="pop-foot" onClick={() => setSetting('hideBreached', !state.settings.hideBreached)}>
                <span className="grow">Hide breached accounts</span>
                <span onClick={(e) => e.stopPropagation()}><Switch on={!!state.settings.hideBreached} onChange={(v) => setSetting('hideBreached', v)} /></span>
              </div>
            </>
          )}
        </Popover>
        <div className="grow" />
        <Seg value={view} onChange={setView} options={[{ value: 'grid', label: 'Grid', icon: LayoutGrid }, { value: 'list', label: 'List', icon: List }]} />
        <div className="sep-v" style={{ margin: '4px 6px' }} />
        <button className="btn" onClick={sync.open}><RefreshCw size={15} /> Auto sync</button>
        <button className="btn" onClick={() => setImporting(true)}><Upload size={15} /> Import from ATAS</button>
        <button className="btn white" onClick={() => setAdding(true)}>Add account <Plus size={17} /></button>
      </div>
      {list.length === 0 && <div className="panel empty">No accounts match this filter.</div>}
      {view === 'grid' ? (
        <div className="acct-grid">
          {list.map((a) => <AccountCard key={a.id} a={a} onOpen={() => setOpenId(a.id)} onEdit={() => setEditing(a)} onDelete={() => setDel(a)} />)}
        </div>
      ) : list.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>{['Account', 'Type', 'Status', 'Initial', 'Net P&L', 'Return', 'Trades', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{list.map((a) => <AccountRow key={a.id} a={a} onOpen={() => setOpenId(a.id)} onEdit={() => setEditing(a)} onDelete={() => setDel(a)} />)}</tbody>
          </table>
        </div>
      )}
      </>}
      <AccountForm open={adding} onClose={() => setAdding(false)} />
      <ImportModal open={importing} onClose={() => setImporting(false)} />
      <AccountForm open={!!editing} account={editing} onClose={() => setEditing(null)} />
      {open && <AccountDetail a={open} onClose={() => setOpenId(null)} />}
      {costFor && <CostModal account={costFor} onClose={() => setCostFor(null)} />}
      <Confirm open={!!del} title={`Delete ${del?.name}?`} body="The account and all of its trades will be removed from your journal." onCancel={() => setDel(null)} onConfirm={() => { deleteAccount(del.id); setDel(null); toast('Account deleted'); }} />
    </div>
  );
}

function AccountRow({ a, onOpen, onEdit, onDelete }) {
  const { s } = useAccountData(a);
  const { state } = useStore();
  const net = s.net + (accountBalanceInfo(state, a.id)?.gap || 0);
  return (
    <tr onClick={onOpen} className={net >= 0 ? 'r-win' : 'r-loss'}>
      <td>{a.name}</td>
      <td className="muted">{a.phase} · {a.market} · {a.plan}</td>
      <td><span className={`status ${a.status}`}>{a.status}</span></td>
      <td><Money v={a.initial} dp={0} /></td>
      <td><Money v={net} colored /></td>
      <td><TrendBadge value={(net / a.initial) * 100} /></td>
      <td>{s.count}</td>
      <td onClick={(e) => e.stopPropagation()} style={{ width: 50 }}><AccountMenu a={a} onEdit={onEdit} onDelete={onDelete} /></td>
    </tr>
  );
}
