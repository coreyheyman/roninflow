// #/embed/trade?ids=…&acct=…&sym=…&t=…&p=… — one trade's review on its own page, for the RoninFlow Suite's window over an
// ATAS chart (click an execution). The same store as the journal: edits save to RoninFlow's server straight away and
// every open journal picks them up within seconds; changes made elsewhere show up here the same way.
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useStore } from '../store/store';
import { TradeDrawer } from '../components/TradeForms';
import { wallClock } from '../lib/stats';
import { HOST, hostSend } from '../components/HostWindow';

const readQuery = () => Object.fromEntries(new URLSearchParams((window.location.hash.split('?')[1] || '')));
const root = (s) => String(s || '').toUpperCase().replace(/@.*/, '').replace(/[FGHJKMNQUVXZ]\d{1,2}$/, '');

/** the journal trade for an ATAS execution: by its ATAS ids first, then by account, market and entry time */
/**
 * The chart's review window stays open (hidden) between executions, so it would keep running an old version of the
 * journal after an update: reload when the journal's script has changed.
 */
async function reloadIfUpdated() {
  try {
    const mine = document.querySelector('script[src*="/assets/"]')?.getAttribute('src');
    if (!mine) return; // the development server
    const html = await fetch('/', { cache: 'no-store' }).then((r) => r.text());
    const now = html.match(/src="([^"]*\/assets\/[^"]+\.js)"/)?.[1];
    if (now && now !== mine) window.location.reload();
  } catch { /* offline for a moment */ }
}

export function findTrade(trades, q) {
  const ids = new Set(String(q.ids || '').split(',').filter(Boolean));
  if (ids.size) {
    // ATAS reuses trade ids (per account, and after a reinstall), so an id can match old trades too: prefer the chart's
    // account, then the one nearest the execution's time
    const hits = trades.filter((t) => ids.has(String(t.atasId)) || (t.atasIds || []).some((x) => ids.has(String(x))) || (t.fills || []).some((f) => ids.has(String(f.atasId))));
    const mine = q.acct ? hits.filter((t) => t.accountId === q.acct) : hits;
    const pool = mine.length ? mine : hits;
    if (pool.length === 1) return pool[0];
    if (pool.length > 1) {
      const at = q.t ? Date.parse(wallClock(new Date(q.t)) || '') : NaN;
      return Number.isFinite(at) ? [...pool].sort((a, b) => Math.abs(Date.parse(a.entry) - at) - Math.abs(Date.parse(b.entry) - at))[0] : pool[0];
    }
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
  const { state, storage, saveNow } = useStore();
  const [q, setQ] = useState(readQuery);
  const [since, setSince] = useState(Date.now());
  useEffect(() => {
    const on = () => { setQ(readQuery()); setSince(Date.now()); reloadIfUpdated(); }; // the window is reused for the next execution clicked
    const shown = () => { if (!document.hidden) reloadIfUpdated(); }; // brought back for the same execution
    window.addEventListener('hashchange', on);
    document.addEventListener('visibilitychange', shown);
    return () => { window.removeEventListener('hashchange', on); document.removeEventListener('visibilitychange', shown); };
  }, []);
  useEffect(() => { document.title = 'Trade review · RoninFlow'; }, []);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 2000); return () => clearInterval(id); }, []);
  const trade = useMemo(() => findTrade(state.trades || [], q), [state.trades, q]);
  // the save first (closing ends the page), then ask the RoninFlow window itself to close — a page's own window.close()
  // can be ignored once it's no longer straight after the click
  const close = async () => { await saveNow(); if (HOST) hostSend('close'); else window.close(); };
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
