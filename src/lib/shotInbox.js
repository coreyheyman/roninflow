// Files the screenshots the journal server picked up from your screenshot folder (shots.js): each goes on the trade
// that was open when it was taken (or had just closed), otherwise on that day's diary. Runs while the app is open;
// pictures taken while it was closed are filed the next time it opens.
import { useEffect, useRef } from 'react';
import { useStore } from '../store/store';
import { useToast, fileToDataUrl } from '../components/ui';
import { matchShot, pickTrade } from './shotMatch';
import { chartCaption } from './chartLabel';
import { IS_VIEWER } from './shareMode';
import { IS_DEMO } from './demoMode';
import { fmtDate, fmtTime12 } from './stats';

const CLIENT = `c${Math.random().toString(36).slice(2, 10)}`;
const POLL = 12e3;
const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).catch(() => null);

export function useShotInbox() {
  const store = useStore();
  const ref = useRef(store);
  ref.current = store;
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  useEffect(() => {
    if (IS_VIEWER || IS_DEMO) return undefined;
    let busy = false, alive = true, off = false;
    const run = async () => {
      if (busy || off || document.hidden) return;
      busy = true;
      try {
        const r = await fetch(`/api/shots/inbox?client=${CLIENT}`, { cache: 'no-store' });
        if (r.status === 404 || r.status === 403) { off = true; return; } // an older server, or the home-server copy
        const j = r.ok ? await r.json() : null;
        const items = (j?.items || []).slice().sort((a, b) => a.takenAt - b.takenAt);
        if (!items.length) return;
        const after = Number(j.after) >= 0 ? Number(j.after) : 10;
        const done = [], wait = [], said = [];
        for (const it of items) {
          if (!alive) break;
          const { state, updateTrade, saveDiary, setSetting } = ref.current;
          const m = matchShot(it.takenAt, state.trades, { after });
          // nothing yet: the trade may still be open (platforms send it when it closes) — look again later
          if (m.kind === 'day' && Date.now() - it.takenAt < (after + 10) * 60e3) { wait.push(it.id); continue; }
          const res = await fetch(`/api/data/images/${it.id}`, { cache: 'no-store' }).catch(() => null);
          if (!res?.ok) { done.push(it.id); continue; } // the file went missing
          const blob = await res.blob();
          const file = new File([blob], it.name || 'screenshot.png', { type: blob.type || 'image/png' });
          const coach = state.settings.coach;
          const onRequest = () => setSetting('coach', (c) => ({ ...c, requestsUsed: c.requestsUsed + 1 }));
          if (m.kind === 'trade') {
            // several markets open at once: read the instrument off the picture (when the coach's AI is set up)
            const symbols = [...new Set(m.trades.map((t) => t.symbol))];
            let caption = '';
            if (symbols.length > 1) { try { caption = await chartCaption(file, { coach, daySymbols: [], onRequest }); } catch { /* best guess */ } }
            const t0 = pickTrade(m, caption);
            const t = ref.current.state.trades.find((x) => x.id === t0.id) || t0;
            const url = await fileToDataUrl(file);
            updateTrade(t.id, { screenshots: [...(t.screenshots || []), url] });
            fetch(`/api/data/images/${it.id}`, { method: 'DELETE' }).catch(() => {}); // kept on the trade itself
            said.push(`${t.symbol} ${t.direction} ${fmtTime12(t.entry)}`);
          } else {
            const dayTrades = state.trades.filter((t) => String(t.entry).slice(0, 10) === m.day);
            let caption = '';
            try { caption = await chartCaption(file, { coach, daySymbols: dayTrades.map((t) => t.symbol), onRequest }); } catch { /* none */ }
            const cur = ref.current.state.diary?.[m.day]?.images || [];
            if (!cur.some((x) => x.id === it.id)) saveDiary(m.day, { images: [...cur, { id: it.id, name: it.name, size: it.size, addedAt: new Date().toISOString(), caption, auto: true }] });
            said.push(`${fmtDate(m.day)} diary`);
          }
          done.push(it.id);
        }
        if (done.length) await post('/api/shots/ack', { ids: done });
        if (wait.length) await post('/api/shots/release', { ids: wait });
        if (said.length) toastRef.current(said.length === 1 ? `Screenshot added to ${said[0]}` : `${said.length} screenshots filed (${[...new Set(said)].slice(0, 3).join(', ')}${new Set(said).size > 3 ? '…' : ''})`);
      } catch { /* server not reachable — next time */ } finally { busy = false; }
    };
    run();
    const id = setInterval(run, POLL);
    const vis = () => { if (!document.hidden) run(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, []);
}
