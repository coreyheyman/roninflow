import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { useToast } from './ui';
import { platformName } from '../lib/connectors';

// Pulls round-trip trades from the connector inbox (/api/connect) into the journal, every 15 s and when the
// window regains focus. Status (token, per-source activity) is loaded on demand for the Connections page.
const Ctx = createContext({ status: null, refresh: () => {}, checkNow: () => {} });
export const useConnect = () => useContext(Ctx);

export function ConnectSyncProvider({ children }) {
  const { state, storage, syncConnect } = useStore();
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const busy = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const cursorRef = useRef(state.settings.connect?.cursor || 0);
  cursorRef.current = Math.max(cursorRef.current, state.settings.connect?.cursor || 0);
  const ready = storage.mode === 'server' || storage.mode === 'local'; // only once the saved journal has loaded

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/connect/status', { cache: 'no-store' });
      if (r.ok) setStatus(await r.json());
    } catch { /* offline */ }
  }, []);

  const checkNow = useCallback(async (manual = false) => {
    if (busy.current) return;
    busy.current = true;
    try {
      let more = true, total = { added: 0, updated: 0, linked: 0, removed: 0 }, sources = new Set();
      while (more) {
        const r = await fetch(`/api/connect/changes?since=${cursorRef.current}`, { cache: 'no-store' });
        if (!r.ok) break;
        const j = await r.json();
        if (j.reset) cursorRef.current = 0;
        // balances: save when they changed, or every 5 minutes so "last updated" stays fresh
        const saved = stateRef.current.settings.sync?.balances || {};
        const bal = (j.balances || []).filter((b) => b.account && b.balance != null && (Number(saved[b.account]?.balance) !== Number(b.balance)
          || Number(saved[b.account]?.openPnl || 0) !== Number(b.openPnl || 0) || Date.now() - new Date(saved[b.account]?.at || 0).getTime() > 5 * 60000));
        if (j.trades?.length || j.seq !== cursorRef.current || bal.length) {
          const res = syncConnect(j.trades || [], j.seq, bal);
          for (const k of Object.keys(total)) total[k] += res[k] || 0;
          (j.trades || []).forEach((t) => sources.add(t.source));
        }
        cursorRef.current = j.seq;
        more = !!j.more;
      }
      if (total.added) toast(`${total.added} new trade${total.added > 1 ? 's' : ''} from ${[...sources].map(platformName).join(', ')}`);
      else if (manual) toast(total.updated || total.linked ? `Up to date · ${total.linked} matched, ${total.updated} updated` : 'Up to date');
    } catch { /* server unreachable: try again next round */ }
    busy.current = false;
    if (manual) refresh();
  }, [syncConnect, toast, refresh]);

  useEffect(() => {
    if (!ready) return undefined;
    checkNow();
    const t = setInterval(() => { if (document.visibilityState === 'visible') checkNow(); }, 15000);
    const onFocus = () => checkNow();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [ready, checkNow]);

  return <Ctx.Provider value={{ status, refresh, checkNow }}>{children}</Ctx.Provider>;
}
