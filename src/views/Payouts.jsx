import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash, HandCoins } from 'lucide-react';
import { useStore, navigate } from '../store/store';
import { Modal, ModalHead, Private, Confirm, useToast, Popover, DateRange } from '../components/ui';
import { fmtDate, fmtMoney, todayKey } from '../lib/stats';
import { PAYOUT_STATUSES, PAYOUT_METHODS, portfolioStats, accountBought } from '../lib/accountStats';

const query = () => new URLSearchParams((window.location.hash.split('?')[1] || ''));
const STATUS_CLS = { Paid: 'Active', Pending: 'Passed', Rejected: 'Breached' }; // reuse the account status pill colours

function PayoutForm({ payout, presetAccount, onClose }) {
  const { state, addPayout, updatePayout } = useStore();
  const toast = useToast();
  // funded / passed accounts first, then the rest
  const accounts = useMemo(() => {
    const rank = { Funded: 0, Passed: 1, Active: 2, Breached: 3 };
    return [...state.accounts].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  }, [state.accounts]);
  const [f, setF] = useState(() => payout || {
    accountId: presetAccount || accounts.find((a) => a.status === 'Funded')?.id || accounts[0]?.id || '',
    amount: '', gross: '', date: todayKey(), status: 'Paid', method: 'Rise', notes: '',
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const amount = Number(f.amount);
  const gross = Number(f.gross);
  const split = gross > 0 && amount > 0 ? (amount / gross) * 100 : null;
  const ok = f.accountId && amount > 0 && f.date;
  const save = () => {
    const rec = { ...f, amount, gross: f.gross === '' ? null : gross };
    if (payout) updatePayout(payout.id, rec); else addPayout(rec);
    toast(payout ? 'Payout updated' : `Payout of ${fmtMoney(amount, { dp: 0 })} added`);
    onClose();
  };
  return (
    <Modal open onClose={onClose} width={600}>
      <ModalHead title={payout ? 'Edit payout' : 'Add payout'} sub="Money paid out to you from a funded account" onClose={onClose} />
      <div className="modal-body form-grid">
        <div className="field full">
          <label className="label">Account</label>
          <select className="select" value={f.accountId} onChange={set('accountId')}>
            {!accounts.some((a) => a.id === f.accountId) && f.accountId && <option value={f.accountId}>{f.accountId} (deleted)</option>}
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.id} · {a.status}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">Amount received (USD)</label>
          <input className="input" type="number" min="0" step="0.01" autoFocus value={f.amount} onChange={set('amount')} placeholder="What landed in your account" />
        </div>
        <div className="field">
          <label className="label">Gross requested (USD) <span className="muted">optional</span></label>
          <input className="input" type="number" min="0" step="0.01" value={f.gross ?? ''} onChange={set('gross')} placeholder="Before the firm's split / fees" />
          {split != null && <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>You kept {split.toFixed(0)}%</span>}
        </div>
        <div className="field"><label className="label">Date</label><input className="input" type="date" value={f.date} onChange={set('date')} /></div>
        <div className="field"><label className="label">Status</label><select className="select" value={f.status} onChange={set('status')}>{PAYOUT_STATUSES.map((x) => <option key={x}>{x}</option>)}</select></div>
        <div className="field full"><label className="label">Method</label>
          <div className="row gap6 wrap">{PAYOUT_METHODS.map((m) => <button key={m} type="button" className={`chip ${f.method === m ? 'on' : ''}`} onClick={() => setF((x) => ({ ...x, method: m }))}>{m}</button>)}</div>
        </div>
        <div className="field full"><label className="label">Notes</label><textarea className="textarea" style={{ minHeight: 70 }} value={f.notes} onChange={set('notes')} placeholder="Payout cycle, anything worth remembering…" /></div>
        {f.status !== 'Paid' && <div className="full muted" style={{ fontSize: 12.5 }}>Only payouts marked <b>Paid</b> count toward your return on investment. Pending ones are shown separately.</div>}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn white" disabled={!ok} onClick={save}>{payout ? 'Save' : 'Add payout'}</button>
      </div>
    </Modal>
  );
}

export default function Payouts() {
  const { state, deletePayout, updatePayout } = useStore();
  const toast = useToast();
  const payouts = state.payouts || [];
  const [form, setForm] = useState(null); // { payout?, account? }
  const [del, setDel] = useState(null);
  const [acct, setAcct] = useState('all');

  // "Add payout" from an account's ⋮ menu lands here with ?account=…&add=1
  useEffect(() => {
    const q = query();
    if (q.get('add')) { setForm({ account: q.get('account') || null }); navigate('payouts'); }
  }, []);

  const [range, setRange] = useState({ from: null, to: null });
  const ranged = !!(range.from || range.to);
  const inR = (k) => !ranged || (!!k && (!range.from || k.slice(0, 10) >= range.from) && (!range.to || k.slice(0, 10) <= range.to));
  // in a period: payouts received in it, and the accounts bought in it (their cost)
  const periodPayouts = useMemo(() => payouts.filter((p) => inR(p.date)), [payouts, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const periodAccounts = useMemo(() => (ranged ? state.accounts.filter((a) => inR(accountBought(a))) : state.accounts), [state.accounts, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useMemo(() => portfolioStats(periodAccounts, periodPayouts, state.trades), [periodAccounts, periodPayouts, state.trades]);
  const list = useMemo(() => periodPayouts.filter((p) => acct === 'all' || p.accountId === acct).sort((a, b) => (b.date || '').localeCompare(a.date || '')), [periodPayouts, acct]);
  const name = (id) => state.accounts.find((a) => a.id === id)?.name || id;
  const usedAccounts = [...new Set(payouts.map((p) => p.accountId))];
  const M = ({ v, sign }) => <Private>{fmtMoney(v, { dp: 0, sign })}</Private>;
  const yearPaid = payouts.filter((p) => p.status === 'Paid' && (p.date || '').startsWith(String(new Date().getFullYear()))).reduce((s, p) => s + Number(p.amount || 0), 0);

  return (
    <div className="page">
      <div className="row between wrap gap12" style={{ marginBottom: 6 }}>
        <div className="page-title" style={{ marginBottom: 12 }}>Payouts</div>
        <div className="row gap8 wrap">
          <DateRange value={range} onChange={setRange} />
          <button className="btn white" onClick={() => setForm({})}><Plus size={16} /> Add payout</button>
        </div>
      </div>

      <div className="rv-tiles acct-kpis" style={{ marginBottom: 22 }}>
        <div className="rv-tile pos"><div className="rv-tile-l">Total received</div><div className="rv-tile-v"><M v={st.paid} /></div><div className="rv-tile-s">{st.payouts} payout{st.payouts === 1 ? '' : 's'}{ranged ? ' in this period' : ''}</div></div>
        {ranged
          ? <div className="rv-tile"><div className="rv-tile-l">Account costs</div><div className="rv-tile-v"><M v={st.spent} /></div><div className="rv-tile-s">accounts bought in this period</div></div>
          : <div className="rv-tile"><div className="rv-tile-l">This year</div><div className="rv-tile-v"><M v={yearPaid} /></div><div className="rv-tile-s">{new Date().getFullYear()}</div></div>}
        <div className="rv-tile"><div className="rv-tile-l">Average payout</div><div className="rv-tile-v"><M v={st.avgPayout} /></div><div className="rv-tile-s">paid payouts only</div></div>
        <div className={`rv-tile ${st.pending ? 'warn' : ''}`}><div className="rv-tile-l">Pending</div><div className="rv-tile-v"><M v={st.pending} /></div><div className="rv-tile-s">requested, not received</div></div>
        <div className={`rv-tile ${st.net > 0 ? 'pos' : st.net < 0 ? 'neg' : ''}`}><div className="rv-tile-l">Net after account costs</div><div className="rv-tile-v"><M v={st.net} sign /></div><div className="rv-tile-s">spent <M v={st.spent} /> on accounts</div></div>
        <div className={`rv-tile ${st.roi == null ? '' : st.roi >= 0 ? 'pos' : 'neg'}`} style={{ cursor: 'pointer' }} onClick={() => navigate('accounts')} title="See costs & ROI on the Accounts page">
          <div className="rv-tile-l">Return on investment</div><div className="rv-tile-v">{st.roi == null ? '—' : `${st.roi >= 0 ? '+' : ''}${st.roi.toFixed(1)}%`}</div><div className="rv-tile-s">{st.spent ? 'see Accounts → Costs & ROI' : 'add account costs to see ROI'}</div>
        </div>
      </div>

      {payouts.length === 0 ? (
        <div className="panel empty">
          <HandCoins size={34} className="muted" />
          <div style={{ color: 'var(--fg)', fontSize: 16, fontWeight: 500 }}>No payouts yet</div>
          <div style={{ maxWidth: 420 }}>Log each payout you receive from a funded account. Together with what your accounts cost, it works out your return on investment.</div>
          <button className="btn white" onClick={() => setForm({})}><Plus size={16} /> Add your first payout</button>
        </div>
      ) : (
        <>
          {usedAccounts.length > 1 && (
            <div className="toolbar">
              <Popover trigger={({ toggle }) => <button className="btn" onClick={toggle}>{acct === 'all' ? 'All accounts' : name(acct)}</button>}>
                {(close) => ['all', ...usedAccounts].map((id) => <button key={id} className={`pop-item ${acct === id ? 'on' : ''}`} onClick={() => { setAcct(id); close(); }}>{id === 'all' ? 'All accounts' : name(id)}</button>)}
              </Popover>
            </div>
          )}
          {list.length === 0 && <div className="panel empty" style={{ marginBottom: 16 }}>No payouts in this period.</div>}
          <div className="tbl-wrap" style={list.length ? undefined : { display: 'none' }}>
            <table className="tbl">
              <thead><tr>{['Date', 'Account', 'Received', 'Gross', 'Status', 'Method', 'Notes', ''].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} onClick={() => setForm({ payout: p })}>
                    <td>{p.date ? fmtDate(p.date) : '—'}</td>
                    <td style={{ fontWeight: 500 }}>{name(p.accountId)}</td>
                    <td className={p.status === 'Paid' ? 'pos' : p.status === 'Pending' ? 'warn' : 'muted'} style={{ fontWeight: 500 }}><M v={Number(p.amount)} /></td>
                    <td className="muted">{p.gross ? <M v={Number(p.gross)} /> : '—'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Popover trigger={({ toggle }) => <button className={`status ${STATUS_CLS[p.status] || ''}`} onClick={toggle} title="Change status">{p.status}</button>}>
                        {(close) => PAYOUT_STATUSES.map((x) => <button key={x} className={`pop-item ${p.status === x ? 'on' : ''}`} onClick={() => { updatePayout(p.id, { status: x }); close(); }}>{x}</button>)}
                      </Popover>
                    </td>
                    <td className="muted">{p.method || '—'}</td>
                    <td className="muted truncate" style={{ maxWidth: 260 }}>{p.notes || ''}</td>
                    <td onClick={(e) => e.stopPropagation()} style={{ width: 90 }}>
                      <div className="row gap4" style={{ justifyContent: 'flex-end' }}>
                        <button className="icon-btn" title="Edit" onClick={() => setForm({ payout: p })}><Pencil size={14} /></button>
                        <button className="icon-btn" title="Delete" onClick={() => setDel(p)}><Trash size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {form && <PayoutForm payout={form.payout} presetAccount={form.account} onClose={() => setForm(null)} />}
      <Confirm open={!!del} title="Delete payout?" body={del ? `${fmtMoney(Number(del.amount), { dp: 0 })} from ${name(del.accountId)} on ${fmtDate(del.date)} will be removed.` : ''} onCancel={() => setDel(null)} onConfirm={() => { deletePayout(del.id); setDel(null); toast('Payout deleted'); }} />
    </div>
  );
}
