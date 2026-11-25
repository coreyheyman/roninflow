// #/embed/trade?ids=…&acct=…&sym=…&t=…&p=… — one trade's review on its own page, for the RoninFlow Suite's window over an
// ATAS chart (click an execution). The same store as the journal: edits save to RoninFlow's server straight away and
// every open journal picks them up within seconds; changes made elsewhere show up here the same way.
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useStore } from '../store/store';
import { TradeDrawer } from '../components/TradeForms';
import { wallClock } from '../lib/stats';

const readQuery = () => Object.fromEntries(new URLSearchParams((window.location.hash.split('?')[1] || '')));
const root = (s) => String(s || '').toUpperCase().replace(/@.*/, '').replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');

/** the journal trade for an ATAS execution: by its ATAS ids first, then by account, market and entry time */
export function findTrade(trades, q) {
  const ids = new Set(String(q.ids || '').split(',').filter(Boolean));
  if (ids.size) {
    const hit = trades.find((t) => ids.has(String(t.atasId)) || (t.atasIds || []).some((x) => ids.has(String(x))) || (t.fills || []).some((f) => ids.has(String(f.atasId))));
    if (hit) return hit;
  }
  if (!q.t) return null;
  const at = Date.parse(wallClock(new Date(q.t)) || '');
  const sym = root(q.sym);
  const near = trades
    .filter((t) => (!q.acct || t.accountId === q.acct) && (!sym || root(t.symbol).endsWith(sym) || sym.endsWith(root(t.symbol))))
    .map((t) => ({ t, d: Math.abs(Date.parse(t.entry) - at) }))
    .filter((x) => x.d <= 3 * 60e3)
    .sort((a, b) => a.d - b.d);
  return near[0]?.t || null;
}

export default function EmbedTrade() {
  const { state, storage } = useStore();
  const [q, setQ] = useState(readQuery);
  const [since, setSince] = useState(Date.now());
  useEffect(() => {
    const on = () => { setQ(readQuery()); setSince(Date.now()); }; // the window is reused for the next execution clicked
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => { document.title = 'Trade review · RoninFlow'; }, []);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 2000); return () => clearInterval(id); }, []);
  const trade = useMemo(() => findTrade(state.trades || [], q), [state.trades, q]);
  const close = () => window.close();
  if (trade) return <div className="embed-page"><TradeDrawer key={trade.id} trade={trade} onClose={close} embed /></div>;
  const waiting = Date.now() - since < 25000;
  return (
    <div className="embed-page embed-empty">
      {storage.mode === 'checking' || waiting ? (
        <>
          <RefreshCw size={22} className="spin" />
          <b>Finding this trade in your journal…</b>
          <p className="muted">Journal Sync sends each trade a few seconds after it closes.</p>
        </>
      ) : (
        <>
          <b>This trade isn’t in your journal yet</b>
          <p className="muted">Check that Journal Sync is on in ATAS and that this account syncs (Accounts → the account → Auto-sync). Trades still open are added when they close.</p>
          <div className="row gap8"><button className="btn sm" onClick={() => setSince(Date.now())}>Look again</button><a className="btn sm" href="#/journal/inbox">Open the inbox</a></div>
        </>
      )}
    </div>
  );
}
