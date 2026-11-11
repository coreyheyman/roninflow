import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { RefreshCw, Check, Copy, TriangleExclamationPoint as TriangleAlert, Zap } from 'lucide-react';
import { useStore } from '../store/store';
import { Modal, ModalHead, Switch, Seg, useToast, Private } from './ui';
import { useJournalOs, OS_OPTIONS } from '../lib/journalOs';
import { standardOffset } from '../lib/importers';
import { fmtDate, fmtTime12, fmtMoney } from '../lib/stats';

const Ctx = createContext({ status: {}, open: () => {}, checkNow: () => {} });
export const useAtasSync = () => useContext(Ctx);

const ago = (iso) => {
  if (!iso) return null;
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};
const fmtOffset = (h) => `UTC${h >= 0 ? '+' : '−'}${String(Math.floor(Math.abs(h))).padStart(2, '0')}:${Math.abs(h) % 1 ? String(Math.round((Math.abs(h) % 1) * 60)).padStart(2, '0') : '00'}`;

/**
 * Polls the local receiver (atas-sync.js in the Vite server) and merges new trades.
 * status.receiver: 'online' | 'offline' | 'unknown'; status.addon: 'live' | 'stale' | 'never'
 */
export function AtasSyncProvider({ children }) {
  const { state, syncAtas, setSync } = useStore();
  const toast = useToast();
  const sync = state.settings.sync || {};
  const [status, setStatus] = useState({ receiver: 'unknown' });
  const [modal, setModal] = useState(false);
  const cursor = useRef(sync.cursor || 0);
  const [remoteDevice, setRemoteDevice] = useState(false);
  useEffect(() => { fetch('/api/net/status').then((r) => (r.ok ? r.json() : null)).then((j) => setRemoteDevice(j?.you === 'network')).catch(() => {}); }, []);
  const busy = useRef(false);

  useEffect(() => { cursor.current = sync.cursor || 0; }, [sync.cursor]);

  const syncRef = useRef(sync);
  syncRef.current = sync;
  const tick = useCallback(async (manual = false) => {
    if (busy.current) return;
    busy.current = true;
    try {
      let more = true, total = { added: 0, updated: 0, linked: 0 }, guard = 0, freshBalances = null;
      while (more && guard++ < 50) {
        const r = await fetch(`/api/atas/changes?since=${cursor.current}`, { cache: 'no-store' });
        if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('offline');
        const j = await r.json();
        const hb = j.heartbeat?.at;
        const addon = !hb ? 'never' : Date.now() - new Date(hb).getTime() < 90000 ? 'live' : 'stale';
        setStatus({ receiver: 'online', addon, heartbeat: j.heartbeat, stored: j.latest, checkedAt: new Date().toISOString() });
        // live account balances from ATAS: keep the latest per account in the journal (saved only when they change)
        if (addon === 'live' && Array.isArray(j.heartbeat?.balances) && j.heartbeat.balances.length) {
          // compare with what the journal has saved (not a local memo: the saved state may load after the first check)
          const saved = syncRef.current.balances || {};
          const changed = j.heartbeat.balances.some((b) => b.account && b.balance != null && (Number(saved[b.account]?.balance) !== Number(b.balance) || Number(saved[b.account]?.openPnl || 0) !== Number(b.openPnl || 0)));
          const stale = j.heartbeat.balances.some((b) => b.account && Date.now() - new Date(saved[b.account]?.at || 0).getTime() > 5 * 60000);
          if (changed || stale) freshBalances = j.heartbeat; // saved together with the cursor below (one update, so neither overwrites the other)
        }
        if (j.reset) cursor.current = 0;
        if (j.trades?.length) {
          const res = syncAtas(j.trades);
          total = { added: total.added + res.added, updated: total.updated + res.updated, linked: total.linked + res.linked };
        }
        cursor.current = j.seq;
        more = !!j.more;
      }
      setSync((sy) => {
        if (!freshBalances) return { cursor: cursor.current };
        const balances = { ...(sy.balances || {}) };
        for (const b of freshBalances.balances) {
          if (!b.account || b.balance == null) continue;
          // highest equity seen live (balance + open P&L) — used by intraday trailing drawdown
          const eq = Number(b.balance) + (Number(b.openPnl) || 0);
          const peakEquity = Math.max(Number(balances[b.account]?.peakEquity) || 0, eq, Number(b.balance));
          balances[b.account] = { ...b, at: freshBalances.at, peakEquity };
        }
        return { cursor: cursor.current, balances };
      });
      if (total.added) toast(`${total.added} new trade${total.added > 1 ? 's' : ''} synced from ATAS`);
      else if (manual) toast(total.linked || total.updated ? `Up to date · ${total.linked} matched, ${total.updated} updated` : 'Up to date');
    } catch {
      setStatus((s) => ({ ...s, receiver: 'offline', checkedAt: new Date().toISOString() }));
      if (manual) toast('Sync receiver not reachable — is “npm run dev” running?');
    } finally {
      busy.current = false;
    }
  }, [syncAtas, setSync, toast]);

  useEffect(() => {
    if (!sync.enabled || remoteDevice) return undefined; // phones get ATAS trades through the PC's saved journal
    tick();
    const id = setInterval(() => tick(), 4000);
    return () => clearInterval(id);
  }, [sync.enabled, tick, remoteDevice]);

  const value = { status: remoteDevice ? { ...status, remote: true } : status, open: () => setModal(true), checkNow: () => tick(true) };
  return (
    <Ctx.Provider value={value}>
      {children}
      <SyncModal open={modal} onClose={() => setModal(false)} status={status} checkNow={() => tick(true)} />
    </Ctx.Provider>
  );
}

export function SyncPill() {
  const { state } = useStore();
  const { status, open } = useAtasSync();
  const on = state.settings.sync?.enabled;
  const live = on && status.receiver === 'online' && status.addon === 'live';
  const color = !on ? 'var(--muted-2)' : live ? 'var(--primary)' : status.receiver === 'online' ? 'var(--warn)' : 'var(--muted-2)';
  const label = status.remote ? 'Synced via PC' : !on ? 'Sync off' : live ? 'ATAS live' : status.receiver === 'online' ? 'Waiting for ATAS' : 'ATAS offline';
  // only for journals that use ATAS (it has sent something, or it was picked in setup)
  const usesAtas = live || !!status.heartbeat?.at || (state.settings.platforms || []).includes('atas') || state.trades.some((t) => t.atasId);
  if (!usesAtas) return null;
  return (
    <button className="btn sm ghost sync-pill" onClick={open} title={`ATAS auto sync · ${label}`} style={{ gap: 8, color: 'var(--fg-2)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: live ? '0 0 0 3px color-mix(in srgb, var(--pos-strong) 20%, transparent)' : undefined }} />
      <span className="sync-lbl">{label}</span>
    </button>
  );
}

function Step({ n, done, title, children }) {
  return (
    <div className="row gap12" style={{ alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="score" style={{ minWidth: 24, height: 24, fontSize: 12, background: done ? 'var(--pos-bg)' : 'var(--card-3)', border: `1px solid ${done ? 'var(--primary)' : 'var(--border-2)'}`, color: done ? 'var(--primary)' : 'var(--fg-2)' }}>{done ? <Check size={13} /> : n}</span>
      <div className="grow" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
        <div style={{ fontWeight: 500, marginBottom: 2 }}>{title}</div>
        <div className="muted">{children}</div>
      </div>
    </div>
  );
}

function CopyCode({ text }) {
  const toast = useToast();
  return (
    <span className="row gap6" style={{ display: 'inline-flex', background: 'var(--card-3)', border: '1px solid var(--border-2)', padding: '3px 4px 3px 8px', marginTop: 6, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12.5, color: 'var(--fg)' }}>
      {text}
      <button className="icon-btn" style={{ width: 22, height: 22 }} title="Copy" onClick={() => { navigator.clipboard?.writeText(text); toast('Copied'); }}><Copy size={12} /></button>
    </span>
  );
}

function SyncModal({ open, onClose, status, checkNow }) {
  const { state, setSync, updateAccount, setPositionGrouping, setSetting } = useStore();
  const journalOs = useJournalOs();
  const [picked, setOs] = useState(null);
  const os = picked || journalOs;
  const sync = state.settings.sync || {};
  const hb = status.heartbeat;
  const synced = state.trades.filter((t) => t.atasId).length;
  const seen = [...new Set([...(hb?.accounts || []), ...state.trades.filter((t) => t.atasId).map((t) => t.accountId)])];
  const rows = [...new Set([...seen, ...state.accounts.filter((a) => a.broker === 'ATAS').map((a) => a.id)])];
  const tzVal = sync.tz ?? 'auto';
  const detected = sync.detectedTz;
  const tzOptions = [-12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 5.5, 6, 7, 8, 9, 10, 11, 12];
  const receiverOk = status.receiver === 'online';
  const addonOk = status.addon === 'live';

  const Dot = ({ ok, warn }) => <span style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: ok ? 'var(--primary)' : warn ? 'var(--warn)' : 'var(--neg)' }} />;

  return (
    <Modal open={open} onClose={onClose} width={760}>
      <ModalHead title="ATAS auto sync" sub="New trades from every connected ATAS account land in your Inbox automatically" onClose={onClose} />
      <div className="modal-body col gap16">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="panel" style={{ padding: 16 }}>
            <div className="row gap8" style={{ fontWeight: 500 }}><Dot ok={receiverOk} /> Journal receiver</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              {receiverOk ? `Running · ${status.stored || 0} trades received` : 'Not reachable — start the app with “npm run dev”.'}
            </div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div className="row gap8" style={{ fontWeight: 500 }}><Dot ok={addonOk} warn={status.addon === 'stale'} /> ATAS add-on</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              {addonOk ? `Connected · seen ${ago(hb.at)} · ${hb.trades ?? 0} trades in ATAS${hb.version ? ` · v${hb.version}` : ''}`
                : status.addon === 'stale' ? `Last seen ${ago(hb.at)} — is ATAS X open with the indicator on a chart?`
                  : 'Not connected yet — follow the setup steps below.'}
            </div>
          </div>
        </div>

        <div className="row gap16 wrap">
          <div className="col" style={{ gap: 10 }}>
            <label className="row gap12" style={{ fontSize: 14 }}><Switch on={!!sync.enabled} onChange={(v) => setSync({ enabled: v })} /> Sync automatically</label>
            <div className="row gap12" style={{ fontSize: 14 }} title="ATAS sends one record per entry/exit pair. When on, fills of the same position (scaling in or out) are combined into a single trade.">
              <Switch on={sync.groupPositions !== false} onChange={(v) => setPositionGrouping(v)} />
              <span>One trade per position <span className="muted" style={{ fontSize: 12.5 }}>— combine scaled entries &amp; exits</span></span>
            </div>
            <div className="row gap12" style={{ fontSize: 14 }} title="Total P&L, account P&L and drawdown use the balance ATAS reports (balance − starting balance). Anything the trades don't account for shows as a balance adjustment.">
              <Switch on={state.settings.balancePnl !== false} onChange={(v) => setSetting('balancePnl', v)} />
              <span>P&L from account balance <span className="muted" style={{ fontSize: 12.5 }}>— balance − starting balance</span></span>
            </div>
          </div>
          <div className="grow" />
          <div className="field" style={{ width: 300 }}>
            <label className="label">ATAS time stamps</label>
            <select className="select" style={{ height: 34 }} value={String(tzVal)} onChange={(e) => { const v = e.target.value; setSync({ tz: v === 'auto' || v === 'local' ? v : Number(v), detectedTz: v === 'auto' ? null : sync.detectedTz }); }}>
              <option value="auto">Auto-detect{detected !== null && detected !== undefined ? ` (${fmtOffset(detected)})` : ''}</option>
              <option value="local">Already in my local time</option>
              {tzOptions.map((h) => <option key={h} value={String(h)}>{fmtOffset(h)}{h === 0 ? ' (UTC)' : ''}{h === standardOffset() ? ' — your standard time' : ''}</option>)}
            </select>
          </div>
        </div>
        <div className="row gap16 muted wrap" style={{ fontSize: 12.5, marginTop: -6 }}>
          <span>{synced} trades linked to ATAS</span>
          {sync.lastSync && <span>Last sync {fmtDate(sync.lastSync)} {fmtTime12(sync.lastSync)}</span>}
          <span className="grow" />
          <button className="btn xs" onClick={checkNow}><RefreshCw size={12} /> Check now</button>
          <button className="btn xs" title="Re-read every trade the receiver has stored (nothing is duplicated)" onClick={() => { setSync({ cursor: 0 }); setTimeout(checkNow, 50); }}>Resync all</button>
        </div>

        {rows.length > 0 && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>{['Account', 'Trades in journal', 'ATAS balance', 'Journal vs ATAS', 'Sync'].map((h) => <th key={h} style={{ height: 38 }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((id) => {
                  const acct = state.accounts.find((a) => a.id === id);
                  const on = acct ? !acct.syncDisabled : !(sync.skip || []).includes(id);
                  return (
                    <tr key={id} style={{ cursor: 'default' }}>
                      <td style={{ height: 44 }}>{id}{!acct && <span className="muted" style={{ fontSize: 12 }}> · will be created</span>}</td>
                      <td>{state.trades.filter((t) => t.accountId === id).length}</td>
                      {(() => {
                        const b = sync.balances?.[id];
                        if (!b) return <><td className="muted2">—</td><td className="muted2">—</td></>;
                        const jb = (acct?.initial || 0) + state.trades.filter((t) => t.accountId === id).reduce((x, t) => x + t.pnl, 0);
                        const diff = jb - Number(b.balance);
                        return (
                          <>
                            <td title={`Updated ${ago(b.at)}`}><Private>{fmtMoney(Number(b.balance))}</Private></td>
                            <td className={Math.abs(diff) < 1 ? 'pos' : 'warn'}>{!acct ? '—' : Math.abs(diff) < 1 ? 'Matches' : <Private>{fmtMoney(diff, { sign: true })}</Private>}</td>
                          </>
                        );
                      })()}
                      <td style={{ width: 90 }}>
                        <Switch on={on} onChange={(v) => {
                          if (acct) updateAccount(id, { syncDisabled: !v, autoSync: v });
                          setSync((s) => ({ skip: v ? (s.skip || []).filter((x) => x !== id) : [...new Set([...(s.skip || []), id])] }));
                        }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="panel" style={{ padding: '6px 18px' }}>
          <div className="row gap8 between" style={{ padding: '10px 0 4px', flexWrap: 'wrap' }}>
            <span className="row gap8" style={{ fontWeight: 600 }}><Zap size={15} className="accent" /> One-time setup</span>
            <span className="row gap8"><span className="muted" style={{ fontSize: 12.5 }}>RoninFlow runs on</span><Seg value={os} onChange={setOs} options={OS_OPTIONS} /></span>
          </div>
          {os === 'windows' ? (
            <>
              <Step n={1} done={addonOk} title="Install the .NET 10 SDK (free, from Microsoft)">
                Needed once to build the add-on. <a className="accent" href="https://dotnet.microsoft.com/download/dotnet/10.0" target="_blank" rel="noreferrer">Download .NET 10 SDK</a> → choose the Windows x64 installer.
              </Step>
              <Step n={2} done={addonOk} title="Close ATAS X, then build and install the add-on">
                Start menu → RoninFlow → <b style={{ color: 'var(--fg)', fontWeight: 500 }}>Install platform add-ons</b> → ATAS. (Running from the source code? In the RoninFlow folder run <CopyCode text="npm run addon" />.)<br />
                It builds <b style={{ color: 'var(--fg)', fontWeight: 500 }}>JournalSync.dll</b> and copies it to <code>%APPDATA%\ATAS X\Indicators</code>.
              </Step>
              <Step n={3} done={addonOk} title="Add “Journal Sync” to any chart in ATAS X">
                Open ATAS X → any chart → Indicators → search <b style={{ color: 'var(--fg)', fontWeight: 500 }}>Journal Sync</b> → add. One chart is enough: it sends every account's closed trades, then each new trade as it closes.
              </Step>
              <Step n={4} done={receiverOk && addonOk} title="Keep RoninFlow running">
                It starts with Windows. If it's closed while you trade, nothing is lost — the add-on resends its history every 10 minutes and whenever ATAS starts.
              </Step>
            </>
          ) : (
            <>
              <Step n={1} done={addonOk} title="ATAS runs on a Windows PC">
                ATAS X is a Windows program, so the add-on goes on the Windows PC (or Windows virtual machine) you trade on. It sends your trades over the network to RoninFlow on this computer.
              </Step>
              <Step n={2} done={addonOk} title="Let other devices reach this journal">
                Here: Settings → Security & privacy → <b style={{ color: 'var(--fg)', fontWeight: 500 }}>Phone & network access</b> → allow devices on your network. It shows this computer's address, like <code>http://192.168.1.20:5173</code>. Copy the token from Connections → <b style={{ color: 'var(--fg)', fontWeight: 500 }}>Webhook / API</b>.
              </Step>
              <Step n={3} done={addonOk} title="Install the add-on on the Windows PC">
                There, install the free <a className="accent" href="https://dotnet.microsoft.com/download/dotnet/10.0" target="_blank" rel="noreferrer">.NET 10 SDK</a>, download <b style={{ color: 'var(--fg)', fontWeight: 500 }}>RoninFlow-&lt;version&gt;.zip</b> from the Releases page on GitHub and unzip it. Close ATAS X, right-click <code>scripts\addons.ps1</code> → Run with PowerShell, and choose ATAS.
              </Step>
              <Step n={4} done={receiverOk && addonOk} title="Point Journal Sync at this journal">
                In ATAS X add <b style={{ color: 'var(--fg)', fontWeight: 500 }}>Journal Sync</b> to any chart. In its settings set <b style={{ color: 'var(--fg)', fontWeight: 500 }}>Journal URL</b> to <code>http://&lt;this computer's address&gt;:5173/api/atas</code> and <b style={{ color: 'var(--fg)', fontWeight: 500 }}>Token</b> to the token. Trading in a VM on this Mac? Use the Mac's address on the VM's network.
              </Step>
            </>
          )}
        </div>
        {!receiverOk && status.receiver === 'offline' && (
          <div className="badge neg-soft" style={{ padding: '8px 12px', whiteSpace: 'normal' }}><TriangleAlert size={14} /> RoninFlow isn't answering, so it can't receive trades. Start it again (Windows: Start menu → RoninFlow; Mac / Linux: roninflow start) and reopen this page.</div>
        )}
      </div>
      <div className="modal-foot"><button className="btn white" onClick={onClose}>Done</button></div>
    </Modal>
  );
}
