import { useMemo } from 'react';
import { Target, ShieldExclamationPoint as ShieldAlert } from 'lucide-react';
import { useStore, navigate } from '../store/store';
import { Private } from './ui';
import { fmtMoney, equityCurve } from '../lib/stats';
import { accountBalanceInfo } from '../lib/balance';
import { useAcctLabel } from '../lib/accountMask';
import { accountDrawdown, ddTypeLabel } from '../lib/accountDD';

/** Profit target and max drawdown progress for each account that's still live (not breached / passed). */
export function accountProgress(state, a) {
  const trades = state.trades.filter((t) => t.accountId === a.id);
  const gap = accountBalanceInfo(state, a.id)?.gap || 0;
  const curve = equityCurve(trades);
  const net = (curve.length ? curve[curve.length - 1].y : 0) + gap;
  const dd = accountDrawdown(state, a); // by the account's drawdown type (static / EOD / intraday trailing)
  return { net, ddUsed: dd.used, dd, trades: trades.length };
}

export default function AccountProgress() {
  const { state } = useStore();
  const label = useAcctLabel();
  const sel = state.settings.account;
  const rows = useMemo(() => {
    const list = sel === 'all'
      ? state.accounts.filter((a) => !['Breached', 'Passed'].includes(a.status))
      : state.accounts.filter((a) => a.id === sel);
    return list.map((a) => ({ a, ...accountProgress(state, a) }));
  }, [state, sel]);
  if (!rows.length) return null;
  return (
    <div className="panel acct-prog" style={{ marginBottom: 22 }}>
      <div className="panel-head">
        <div className="card-title">Account progress</div>
        <button className="btn xs" onClick={() => navigate('accounts')}>Accounts</button>
      </div>
      <div className="ap-list">
        {rows.map(({ a, net, ddUsed, dd }) => {
          const target = Number(a.profitTarget) || 0;
          const maxDD = Number(a.maxDrawdown) || 0;
          const tPct = target ? Math.max(0, Math.min(100, (net / target) * 100)) : 0;
          const dPct = maxDD ? Math.max(0, Math.min(100, (ddUsed / maxDD) * 100)) : 0;
          const danger = dPct >= 75 ? 'hot' : dPct >= 50 ? 'warm' : '';
          return (
            <div key={a.id} className="ap-row">
              <div className="ap-name">
                <b className="truncate">{label(a)}</b>
                <span className={`status ${a.status}`}>{a.status}</span>
              </div>
              <div className="ap-bar">
                <div className="ap-top">
                  <span className="row gap6"><Target size={13} className="pos" /> Profit target</span>
                  {target ? <Private><b>{fmtMoney(net, { dp: 0, sign: true })}</b> <span className="muted">/ {fmtMoney(target, { dp: 0 })}</span></Private> : <span className="muted">not set</span>}
                </div>
                <div className="ap-track"><i className="pos" style={{ width: `${tPct}%` }} /></div>
                <div className="ap-sub muted">{target ? (net >= target ? 'Target reached' : <><Private>{fmtMoney(target - Math.max(0, net), { dp: 0 })}</Private> to go · {Math.round(tPct)}%</>) : 'Add a profit target on the Accounts page'}</div>
              </div>
              <div className="ap-bar">
                <div className="ap-top">
                  <span className="row gap6"><ShieldAlert size={13} className="neg" /> Max drawdown <span className="muted">· {ddTypeLabel(a)}</span></span>
                  {maxDD ? <Private><b>{fmtMoney(ddUsed, { dp: 0 })}</b> <span className="muted">/ {fmtMoney(maxDD, { dp: 0 })}</span></Private> : <span className="muted">not set</span>}
                </div>
                <div className={`ap-track ${danger}`}><i className="neg" style={{ width: `${dPct}%` }} /></div>
                <div className="ap-sub muted">{maxDD ? dd.breached ? <span className="neg">Floor reached</span> : <><Private>{fmtMoney(Math.max(0, dd.left), { dp: 0 })}</Private> left · floor <Private>{fmtMoney(dd.floor, { dp: 0 })}</Private>{dd.locked ? ' (locked)' : ''}{dd.live && dd.openPnl ? ' · live' : ''}</> : 'Add a max drawdown on the Accounts page'}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
