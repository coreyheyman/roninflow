import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { initialState } from '../data/seed';
import { DEMO_ACCOUNT, demoTrades } from '../data/demo';
import { uid, computePnl, setCurrency, setHomeTimeZone } from '../lib/stats';
import { setLanguage } from '../lib/i18n';
import { applyAtasBatch, groupAtasTrades } from '../lib/atasSync';
import { applyTheme, findTheme } from '../lib/themes';
import { applyConnectBatch } from '../lib/connectSync';

const KEY = 'trade-journal-state-v1';
const OLD_KEY = 'iq-journal-state-v1'; // earlier versions
const Ctx = createContext(null);

/** Apply one-time migrations and fill in defaults for state from storage or the server. */
function normalize(saved) {
      const base = initialState();
      // one-time: show the new edge-blocker widget on existing dashboards
      const mig = saved.settings?.migrations || [];
      if (saved.settings && !mig.includes('blockers-widget')) {
        saved.settings.dashboardWidgets = [...(saved.settings.dashboardWidgets || []), 'blockers'];
        saved.settings.migrations = [...mig, 'blockers-widget'];
      }
      if (saved.settings && !(saved.settings.migrations || []).includes('trade-widgets')) {
        saved.settings.dashboardWidgets = [...new Set([...(saved.settings.dashboardWidgets || []), 'avgtrade', 'streaks'])];
        saved.settings.migrations = [...(saved.settings.migrations || []), 'trade-widgets'];
      }
      if (saved.settings && !(saved.settings.migrations || []).includes('avgday-widget')) {
        saved.settings.dashboardWidgets = [...new Set([...(saved.settings.dashboardWidgets || []).filter((w) => w !== 'side'), 'avgday'])];
        saved.settings.migrations = [...(saved.settings.migrations || []), 'avgday-widget'];
      }
      // ATAS live fills were read with the wrong time zone: re-read everything the receiver holds once to correct them
      if (saved.settings && !(saved.settings.migrations || []).includes('atas-live-time')) {
        if (saved.settings.sync) saved.settings.sync = { ...saved.settings.sync, cursor: 0 };
        saved.settings.migrations = [...(saved.settings.migrations || []), 'atas-live-time'];
      }
      // scaled entries/exits from ATAS become one trade per position (once, for trades synced before this existed)
      if (saved.settings && !(saved.settings.migrations || []).includes('group-positions')) {
        if (Array.isArray(saved.trades) && saved.settings.sync?.groupPositions !== false) saved.trades = groupAtasTrades(saved.trades, true);
        saved.settings.migrations = [...(saved.settings.migrations || []), 'group-positions'];
      }
      if (saved.settings && !(saved.settings.migrations || []).includes('account-progress')) {
        const w = saved.settings.dashboardWidgets || [];
        if (!w.includes('progress')) { const i = w.indexOf('kpis'); saved.settings.dashboardWidgets = i >= 0 ? [...w.slice(0, i + 1), 'progress', ...w.slice(i + 1)] : ['progress', ...w]; }
        saved.settings.migrations = [...(saved.settings.migrations || []), 'account-progress'];
      }
      // older versions stored a single Anthropic key on the coach settings
      if (saved.settings?.coach && saved.settings.coach.provider === undefined) {
        const c = saved.settings.coach;
        saved.settings.coach = { ...c, provider: c.apiKey ? 'anthropic' : 'local', providers: c.apiKey ? { anthropic: { apiKey: c.apiKey, model: c.model } } : {} };
        delete saved.settings.coach.apiKey;
        delete saved.settings.coach.model;
      }
      // journals from before the first-run setup existed don't need it
      if (saved.settings && saved.settings.setupDone === undefined) saved.settings.setupDone = true;
      // the framework card was removed from the playbook
      if (saved.settings && !(saved.settings.migrations || []).includes('public-defaults')) {
        const pb = { ...(saved.settings.playbook || {}) };
        delete pb.nadro; delete pb.framework;
        saved.settings.playbook = pb;
        saved.settings.migrations = [...(saved.settings.migrations || []), 'public-defaults'];
      }
      return { ...base, ...saved, settings: { ...base.settings, ...saved.settings, coach: { ...base.settings.coach, ...(saved.settings?.coach || {}) }, sync: { ...base.settings.sync, ...(saved.settings?.sync || {}) }, currency: { ...base.settings.currency, ...(saved.settings?.currency || {}) } } };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* ignore corrupted storage */ }
  return initialState();
}

const jsonOf = async (r) => ((r.headers.get('content-type') || '').includes('json') ? r.json() : null);

export function StoreProvider({ children }) {
  const [state, setState] = useState(load);
  const stateRef = useRef(state);
  stateRef.current = state;
  setCurrency(state.settings.currency); // display currency for every formatter rendered below
  setHomeTimeZone(state.settings.timeZone); // instants → wall-clock time in your time zone
  useEffect(() => { setLanguage(state.settings.language || 'en'); }, [state.settings.language]);

  // ---- server storage (data/journal.json on the PC), shared by every device ----
  // mode: 'checking' | 'server' | 'local' (no server, browser only) | 'waiting' (network device, PC hasn't moved data yet)
  const [storage, setStorage] = useState({ mode: 'checking', savedAt: null, error: null, notice: null });
  const srv = useRef({ mode: 'checking', version: 0, synced: null, lastJson: null, inflight: false, timer: null });
  const applyRemote = useCallback((remote, version) => {
    srv.current.version = version;
    const next = normalize(remote);
    srv.current.synced = next; // don't echo this change back to the server
    srv.current.lastJson = JSON.stringify(next);
    stateRef.current = next;
    setState(next);
  }, []);
  const pull = useCallback(async () => {
    const r = await fetch('/api/data/state', { cache: 'no-store' });
    if (r.status === 401) { window.location.reload(); return; }
    const j = await jsonOf(r);
    if (j?.state) applyRemote(j.state, j.version);
  }, [applyRemote]);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch('/api/data/state', { cache: 'no-store' });
        if (r.status === 401) { window.location.reload(); return; }
        const j = await jsonOf(r);
        if (!r.ok || !j) throw new Error('no server');
        if (dead) return;
        if (j.state) {
          applyRemote(j.state, j.version);
          srv.current.mode = 'server';
          setStorage((x) => ({ ...x, mode: 'server' }));
        } else {
          // First run with the server: move this browser's journal into data/journal.json (PC only).
          const put = await fetch('/api/data/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: stateRef.current, baseVersion: 0 }) });
          const pj = await jsonOf(put);
          if (put.ok) {
            srv.current.version = pj.version;
            srv.current.mode = 'server';
            setStorage((x) => ({ ...x, mode: 'server', savedAt: new Date().toISOString(), notice: 'migrated' }));
          } else {
            srv.current.mode = 'waiting';
            setStorage((x) => ({ ...x, mode: 'waiting', error: pj?.error }));
          }
        }
      } catch {
        srv.current.mode = 'local';
        setStorage((x) => ({ ...x, mode: 'local' }));
      }
    })();
    return () => { dead = true; };
  }, [applyRemote]);

  // save: browser cache always; server (debounced) when connected
  useEffect(() => {
    const id = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ }
    }, 150);
    const s0 = srv.current;
    if (state === s0.synced) return () => clearTimeout(id);
    if (s0.mode !== 'server') return () => clearTimeout(id);
    clearTimeout(s0.timer);
    s0.dirty = true;
    s0.timer = setTimeout(async function save() {
      if (s0.inflight) { s0.timer = setTimeout(save, 300); return; }
      const json = JSON.stringify(stateRef.current);
      s0.dirty = false;
      if (json === s0.lastJson) return; // nothing actually changed
      s0.inflight = true;
      try {
        const r = await fetch('/api/data/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: `{"state":${json},"baseVersion":${s0.version}}` });
        const j = await jsonOf(r);
        if (r.ok) { s0.version = j.version; s0.lastJson = json; setStorage((x) => ({ ...x, savedAt: new Date().toISOString(), error: null })); }
        else if (r.status === 409) { await pull(); setStorage((x) => ({ ...x, notice: 'conflict' })); }
        else if (r.status === 401) window.location.reload();
        else { s0.dirty = true; setStorage((x) => ({ ...x, error: j?.error || `Save failed (${r.status})` })); }
      } catch {
        s0.dirty = true;
        setStorage((x) => ({ ...x, error: 'Journal server not reachable — changes are kept in this browser and saved when it reconnects.' }));
      } finally {
        s0.inflight = false;
      }
    }, 700);
    return () => clearTimeout(id);
  }, [state, pull]);

  // pick up changes made on another device
  useEffect(() => {
    const check = async () => {
      const s0 = srv.current;
      if (s0.mode !== 'server' || s0.inflight || document.hidden) return;
      try {
        const r = await fetch('/api/data/version', { cache: 'no-store' });
        if (r.status === 401) { window.location.reload(); return; }
        const j = await jsonOf(r);
        if (!j) return;
        if (s0.dirty) { // retry a save that failed while offline
          setState((x) => ({ ...x }));
          return;
        }
        if (j.version > s0.version) await pull();
        setStorage((x) => (x.error ? { ...x, error: null } : x));
      } catch { /* offline for a moment */ }
    };
    const id = setInterval(check, 4000);
    const onVis = () => !document.hidden && check();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [pull]);

  useEffect(() => {
    if (window.__themePreview) return; // the theme editor is showing an unsaved draft
    applyTheme(findTheme(state.settings));
  }, [state.settings.theme, state.settings.themeId, state.settings.customThemes]);

  const update = useCallback((fn) => setState((s) => fn(s)), []);

  const actions = useMemo(() => {
    const patchList = (key, id, patch) =>
      update((s) => ({ ...s, [key]: s[key].map((x) => (x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)) }));
    return {
      update,
      /** Merge trades pushed by the ATAS add-on; returns counts. */
      syncAtas: (dtos) => {
        const res = applyAtasBatch(stateRef.current, dtos);
        stateRef.current = res.next;
        setState(res.next);
        return res;
      },
      /** Merge trades from the connector inbox (add-ons / webhooks); returns counts. */
      syncConnect: (records, cursor, balances) => {
        const res = applyConnectBatch(stateRef.current, records, cursor, balances);
        const base = stateRef.current;
        stateRef.current = res.next;
        // apply on top of whatever is current (another sync may have queued an update this tick)
        setState((s) => (s === base ? res.next : applyConnectBatch(s, records, cursor, balances).next));
        return res;
      },
      /** Combine (or split back) ATAS executions into one trade per position. */
      setPositionGrouping: (on) => update((s) => ({ ...s, trades: groupAtasTrades(s.trades, on), settings: { ...s.settings, sync: { ...s.settings.sync, groupPositions: on } } })),
      setSync: (patch) => update((s) => ({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, ...(typeof patch === 'function' ? patch(s.settings.sync) : patch) } } })),
      setSetting: (k, v) => update((s) => ({ ...s, settings: { ...s.settings, [k]: typeof v === 'function' ? v(s.settings[k]) : v } })),
      // trades
      addTrade: (t) => {
        const trade = { id: uid('t'), tags: [], notes: '', rating: 0, reviewed: false, screenshots: [], strategyId: null, ...t };
        if (trade.pnl === undefined || trade.pnl === '' || trade.pnl === null) trade.pnl = computePnl(trade);
        trade.pnl = Number(trade.pnl);
        update((s) => ({ ...s, trades: [trade, ...s.trades] }));
        return trade;
      },
      addTrades: (list) => update((s) => ({ ...s, trades: [...list.map((t) => ({ id: uid('t'), tags: [], notes: '', rating: 0, reviewed: false, screenshots: [], strategyId: null, ...t })), ...s.trades] })),
      updateTrade: (id, patch) => patchList('trades', id, patch),
      /** Atomic import: create accounts, optionally clear a date range per account, add trades. */
      importBatch: ({ newAccounts = [], trades = [], removeIds = [], note }) =>
        update((s) => {
          const rm = new Set(removeIds);
          const kept = s.trades.filter((t) => !rm.has(t.id));
          const added = trades.map((t) => ({ id: uid('t'), tags: [], notes: '', rating: 0, reviewed: false, screenshots: [], strategyId: null, ...t }));
          const notif = note ? [{ id: uid('n'), title: note.title, body: note.body, date: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19), read: false, link: '#/journal/inbox' }] : [];
          return { ...s, accounts: [...s.accounts, ...newAccounts], trades: [...added, ...kept], notifications: [...notif, ...s.notifications] };
        }),
      deleteTrades: (ids) => update((s) => ({ ...s, trades: s.trades.filter((t) => !ids.includes(t.id)) })),
      addTag: (tag) => update((s) => (s.tags.includes(tag) ? s : { ...s, tags: [...s.tags, tag] })),
      // accounts
      addAccount: (a) => update((s) => ({ ...s, accounts: [...s.accounts, { id: a.name, autoSync: false, status: 'Active', createdAt: new Date().toISOString().slice(0, 10), ...a }] })),
      updateAccount: (id, patch) => patchList('accounts', id, patch),
      deleteAccount: (id) => update((s) => ({ ...s, accounts: s.accounts.filter((a) => a.id !== id), trades: s.trades.filter((t) => t.accountId !== id) })),
      // payouts
      addPayout: (p) => update((s) => ({ ...s, payouts: [{ id: uid('p'), status: 'Paid', ...p }, ...(s.payouts || [])] })),
      updatePayout: (id, patch) => update((s) => ({ ...s, payouts: (s.payouts || []).map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      deletePayout: (id) => update((s) => ({ ...s, payouts: (s.payouts || []).filter((x) => x.id !== id) })),
      // strategies
      saveStrategy: (st) =>
        update((s) => {
          const exists = s.strategies.some((x) => x.id === st.id);
          const item = { ...st, updatedAt: new Date().toISOString() };
          return { ...s, strategies: exists ? s.strategies.map((x) => (x.id === st.id ? item : x)) : [...s.strategies, { ...item, id: uid('st'), createdAt: item.updatedAt }] };
        }),
      deleteStrategy: (id) => update((s) => ({ ...s, strategies: s.strategies.filter((x) => x.id !== id), trades: s.trades.map((t) => (t.strategyId === id ? { ...t, strategyId: null } : t)) })),
      // diary
      saveDiary: (date, patch) => update((s) => ({ ...s, diary: { ...s.diary, [date]: { ...(s.diary[date] || {}), ...patch } } })),
      // periodic reviews (weekly / monthly / quarterly / yearly), keyed "weekly:2026-11-02"
      saveCoachReview: (key, val) => update((s) => ({ ...s, coachReviews: { ...(s.coachReviews || {}), [key]: val } })),
      saveReview: (key, patch) => update((s) => {
        const cur = s.reviews?.[key] || { answers: {} };
        const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
        return { ...s, reviews: { ...(s.reviews || {}), [key]: { ...next, updatedAt: new Date().toISOString() } } };
      }),
      // notebook
      setNotebook: (fn) => update((s) => ({ ...s, notebook: fn(s.notebook) })),
      // coach
      setChats: (fn) => update((s) => ({ ...s, chats: fn(s.chats) })),
      setTemplates: (fn) => update((s) => ({ ...s, templates: fn(s.templates) })),
      // notifications
      markAllRead: () => update((s) => ({ ...s, notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
      markRead: (id) => patchList('notifications', id, { read: true }),
      clearNotifications: () => update((s) => ({ ...s, notifications: [] })),
      resetAll: () => setState(initialState()),
      loadDemo: () => update((s) => ({
        ...s,
        accounts: [...s.accounts.filter((a) => a.id !== DEMO_ACCOUNT.id), { ...DEMO_ACCOUNT, createdAt: new Date(Date.now() - 70 * 86400e3).toISOString().slice(0, 10) }],
        trades: [...s.trades.filter((t) => !t.demo), ...demoTrades()],
      })),
      removeDemo: () => update((s) => ({
        ...s,
        accounts: s.accounts.filter((a) => !a.demo),
        trades: s.trades.filter((t) => !t.demo),
        settings: { ...s.settings, account: s.settings.account === DEMO_ACCOUNT.id ? 'all' : s.settings.account },
      })),
      importState: (obj) => setState({ ...initialState(), ...obj }),
    };
  }, [update]);

  const value = useMemo(() => ({ state, storage, dismissStorageNotice: () => setStorage((x) => ({ ...x, notice: null })), ...actions }), [state, storage, actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);

/** Trades for the globally-selected account ("all" = every account). */
export function useAccountTrades(accountId) {
  const { state } = useStore();
  const id = accountId ?? state.settings.account;
  const hidden = useMemo(() => (state.settings.hideBreached ? new Set(state.accounts.filter((a) => a.status === 'Breached').map((a) => a.id)) : null), [state.settings.hideBreached, state.accounts]);
  // "All accounts" leaves out breached accounts while "Hide breached accounts" is on
  return useMemo(() => (id === 'all' ? (hidden?.size ? state.trades.filter((t) => !hidden.has(t.accountId)) : state.trades) : state.trades.filter((t) => t.accountId === id)), [state.trades, id, hidden]);
}

// ---------- hash router ----------
export function useRoute() {
  const get = () => (window.location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => setRoute(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route.split('/');
}
export const navigate = (path) => {
  window.location.hash = '#/' + path.replace(/^#?\/?/, '');
};
