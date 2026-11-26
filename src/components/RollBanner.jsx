// A one-line reminder across the journal when a market you trade is about to roll, has just rolled, or your last trade
// was on a contract the market has moved off. Dismiss it and it stays dismissed for that roll.
import { useMemo } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { useStore, navigate } from '../store/store';
import { tradedMarkets, fmtDate, useRollVolumes } from '../views/ContractRolls';
import { rollStatus, rollAdvice } from '../../rolls.js';

export default function RollBanner() {
  const { state, setSetting } = useStore();
  const dismissed = state.settings.rollDismissed || [];
  const traded = useMemo(() => tradedMarkets(state.trades, 30), [state.trades]);
  const vols = useRollVolumes(state.settings.rollReminders === false ? [] : Object.keys(traded));
  const items = useMemo(() => {
    return Object.entries(traded)
      .map(([root, t]) => ({ root, st: rollAdvice(rollStatus(t.last || root, new Date(), { soonDays: 5 }), vols[root]) }))
      .filter(({ st }) => st && ['soon', 'roll', 'expired', 'rolled'].includes(st.phase))
      .map(({ root, st }) => ({ root, st, key: `${root}:${st.switchTo?.symbol}:${st.phase === 'soon' ? 'soon' : 'roll'}` }))
      .filter((x) => !dismissed.includes(x.key));
  }, [traded, vols, dismissed.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  if (state.settings.rollReminders === false || !items.length) return null;
  const x = items[0];
  const { st } = x;
  const urgent = st.phase === 'roll' || st.phase === 'expired';
  const text = st.phase === 'soon' ? <>Contract roll: <b>{x.root}</b> moves from <b>{st.front.symbol}</b> to <b>{st.next.symbol}</b> on {fmtDate(st.front.roll)}{st.daysToRoll <= 1 ? (st.daysToRoll === 0 ? ' — today' : ' — tomorrow') : ` — in ${st.daysToRoll} days`}.</>
    : st.phase === 'rolled' ? <><b>{x.root}</b>: <b>{st.switchTo.symbol}</b> is now the active contract{st.reason === 'volume' ? ` (${Math.round(st.share * 100)}% of the volume)` : ''} — make sure your charts and DOM are on it.</>
      : <>Your last <b>{x.root}</b> trade was on <b>{st.held.symbol}</b>, but {st.reason === 'volume' ? <><b>{st.switchTo.symbol}</b> now trades more ({Math.round(st.share * 100)}% of the volume)</> : <>volume moved to <b>{st.switchTo.symbol}</b> on {fmtDate(st.held.roll)}</>}{st.phase === 'expired' ? ` and ${st.held.symbol} has expired` : ''} — switch contracts.</>;
  const dismiss = () => setSetting('rollDismissed', [...dismissed, x.key].slice(-30));
  return (
    <div className={`storage-banner roll-banner ${urgent ? 'neg-b' : 'warn-b'}`}>
      <CalendarClock size={15} />
      <span>{text}{items.length > 1 ? <span className="muted"> (+{items.length - 1} more)</span> : null}</span>
      <button onClick={() => navigate('macro/rolls')}>Contract rolls</button>
      <button onClick={dismiss} title="Dismiss for this roll"><X size={14} /></button>
    </div>
  );
}
