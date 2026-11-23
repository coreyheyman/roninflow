// Settings → Risk enforcement: per-account rules the ATAS add-on (Journal Sync) applies — the risk tier's daily loss
// limit, a trailing drawdown on realised P&L, trading windows, trade counts and position size — plus what the add-on
// reports back live.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash, TriangleExclamationPoint as TriangleAlert, Check, ShieldCheck, Copy, LockOpen } from 'lucide-react';
import { useStore } from '../store/store';
import { Switch, useToast } from './ui';
import { enforceOf, rulesFor, tierOf, DEFAULT_ENFORCE } from '../lib/riskEnforce';
import { fmtMoney } from '../lib/stats';

const money0 = (v) => fmtMoney(v, { dp: 0 });
const DAYS = [['S', 0], ['M', 1], ['T', 2], ['W', 3], ['T', 4], ['F', 5], ['S', 6]];
const ago = (ms) => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

/** A number box that saves on every change; empty = use the default shown as the placeholder. */
function Num({ value, onChange, placeholder, prefix, step = 1, min = 0, width = 120 }) {
  const [txt, setTxt] = useState(value == null ? '' : String(value));
  const [was, setWas] = useState(value);
  if (was !== value) { setWas(value); setTxt(value == null ? '' : String(value)); }
  return (
    <div className="re-num" style={{ width }}>
      {prefix && <span className="muted">{prefix}</span>}
      <input
        className="input" inputMode="decimal" value={txt} placeholder={placeholder} step={step} min={min}
        onChange={(e) => { const t = e.target.value.replace(/[^\d.]/g, ''); setTxt(t); onChange(t === '' ? null : Number(t)); }}
      />
    </div>
  );
}

export default function RiskEnforce() {
  const { state, setSetting } = useStore();
  const toast = useToast();
  const accounts = useMemo(() => state.accounts.filter((a) => a.status !== 'Breached' || state.settings.riskEnforce?.[a.id]?.on), [state.accounts, state.settings.riskEnforce]);
  const [id, setId] = useState(() => (accounts.some((a) => a.id === state.settings.account) ? state.settings.account : accounts[0]?.id || ''));
  const [live, setLive] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/atas/risk/status', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setLive(j || false); }).catch(() => { if (alive) setLive(false); });
    load();
    const iv = setInterval(load, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  if (!accounts.length) return <div className="muted">Add an account first — rules are set per account.</div>;
  const cfg = enforceOf(state, id);
  const set = (patch) => setSetting('riskEnforce', { ...(state.settings.riskEnforce || {}), [id]: { ...cfg, ...patch } });
  const r = tierOf(state, id);
  const rules = rulesFor({ ...state, settings: { ...state.settings, riskEnforce: { ...(state.settings.riskEnforce || {}), [id]: { ...cfg, on: true } } } }, id); // as if it were on
  const tierDll = Number(r?.tier.dailyLL) || 0;
  const st = live?.status;
  const fresh = st && Date.now() - st.receivedAt < 20e3;
  const acc = st?.accounts?.find((a) => a.account === id);
  const inRules = live?.rules?.accounts?.find((a) => a.account === id);
  const windows = cfg.windows || [];
  const copyAll = () => {
    const all = { ...(state.settings.riskEnforce || {}) };
    let n = 0;
    for (const a of accounts) if (a.id !== id) { all[a.id] = { ...DEFAULT_ENFORCE, ...(all[a.id] || {}), ...cfg, on: all[a.id]?.on ?? false }; n++; }
    setSetting('riskEnforce', all);
    toast(`Copied to ${n} account${n === 1 ? '' : 's'} — switch enforcement on for each one you want`);
  };

  return (
    <div className="col gap16 re">
      <div className="muted" style={{ fontSize: 13 }}>
        RoninFlow can hold ATAS to your risk plan: the Journal Sync add-on sets each account’s ATAS Risk Management to its current tier, and blocks new orders (closing a position still works) when a rule below is broken — and, if you choose, flattens the account when its daily loss limit or profit target is hit — on every connected account, copy-trade followers included, whether or not a chart has it selected.
      </div>

      <div className={`re-addon ${fresh && st.enforcing ? 'ok' : 'warn'}`}>
        {fresh && st.enforcing ? <ShieldCheck size={15} /> : <TriangleAlert size={15} />}
        <div>
          {!st && <>Journal Sync hasn’t reported yet. Update the add-on (Start menu → RoninFlow → Install platform add-ons → ATAS), then in ATAS open Journal Sync’s settings and switch on <b>Enforce RoninFlow risk rules</b>.</>}
          {st && !fresh && <>Journal Sync last reported {ago(st.receivedAt)} — is ATAS open with a chart that has Journal Sync on it?</>}
          {fresh && !st.enforcing && <>Journal Sync is connected (version {st.version}), but <b>Enforce RoninFlow risk rules</b> is off in its settings in ATAS.</>}
          {fresh && st.enforcing && <>Enforcing in ATAS (Journal Sync {st.version}){st.guard ? '' : ' — '}{!st.guard && <span className="neg">couldn’t hook into ATAS’s order check: {st.guardError || 'unknown reason'} — rules are enforced by closing positions instead</span>}{st.rms === false && <span className="neg"> · couldn’t reach ATAS Risk Management: {st.rmsError || 'unknown reason'}</span>}</>}
        </div>
      </div>

      <div className="row gap8 wrap" style={{ alignItems: 'center' }}>
        <span className="label" style={{ margin: 0 }}>Account</span>
        <select className="select" style={{ maxWidth: 320 }} value={id} onChange={(e) => setId(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}{state.settings.riskEnforce?.[a.id]?.on ? ' — enforced' : ''}</option>)}
        </select>
        <div className="grow" />
        <button className="btn sm" onClick={copyAll} title="Copy these rules (not the on/off switch) to every other account"><Copy size={13} /> Copy to all accounts</button>
      </div>

      <div className="panel col" style={{ padding: 14, gap: 14 }}>
        <div className="row between gap8">
          <b style={{ fontWeight: 600 }}>Enforce rules on this account</b>
          <Switch on={!!cfg.on} onChange={(v) => set({ on: v })} />
        </div>

        {r && (
          <div className="re-tier" style={{ '--tier': r.tier.color || 'var(--primary)' }}>
            <div className="re-tier-name"><i />Current risk tier: <b>{r.tier.name}</b> <span className="muted">({r.level + 1} of {r.tiers.length})</span></div>
            <div className="muted" style={{ fontSize: 12.5 }}>Daily loss limit {money0(tierDll)} · risk per trade {money0(r.tier.riskMin)}–{money0(r.tier.riskMax)} · {r.reasons[0]}</div>
          </div>
        )}

        <div className="re-grid">
          <label className="label">Daily loss limit</label>
          <div>
            <Num value={cfg.dll} onChange={(v) => set({ dll: v })} placeholder={String(tierDll)} prefix="$" />
            <div className="re-help">Empty follows the tier ({money0(tierDll)} now) and changes with it. Counts open P&amp;L too.</div>
            <label className="row gap8" style={{ fontSize: 13, marginTop: 8 }}><input type="checkbox" className="cbx" checked={cfg.flattenLoss !== false} onChange={(e) => set({ flattenLoss: e.target.checked })} /> Flatten this account when it’s hit</label>
            <div className="re-help">{cfg.flattenLoss !== false ? 'Open positions are closed and resting orders cancelled the moment the limit (or the trailing drawdown below) is hit; no new positions until tomorrow.' : 'Open positions stay open (manage them yourself) — only new positions are blocked until tomorrow.'}</div>
          </div>

          <label className="label">Daily profit target</label>
          <div>
            <Num value={cfg.target} onChange={(v) => set({ target: v })} placeholder="None" prefix="$" />
            <label className="row gap8" style={{ fontSize: 13, marginTop: 8 }}><input type="checkbox" className="cbx" checked={cfg.targetOpen !== false} onChange={(e) => set({ targetOpen: e.target.checked })} /> Count open P&amp;L toward it</label>
            <label className="row gap8" style={{ fontSize: 13 }}><input type="checkbox" className="cbx" disabled={!(Number(cfg.target) > 0)} checked={!!cfg.flattenTarget} onChange={(e) => set({ flattenTarget: e.target.checked })} /> Flatten this account and stop for the day when it’s hit</label>
            <div className="re-help">This account’s target, shown on the RoninFlow Suite’s buffer bar on your charts (and used for its profit-target alert) whether or not rules are enforced. {cfg.flattenTarget ? 'Once hit, open positions are closed, resting orders cancelled and new positions blocked until tomorrow.' : 'Hitting it doesn’t close anything.'}</div>
          </div>

          <label className="label">Trailing drawdown (realised)</label>
          <div>
            <Num value={cfg.trail} onChange={(v) => set({ trail: v })} placeholder={String(rules?.dailyLoss ?? tierDll)} prefix="$" />
            <div className="re-help">How far the day’s closed P&amp;L may fall from its high. Empty = the same as the daily loss limit ({money0(rules?.dailyLoss ?? tierDll)}). At +$400 with $300 you’re stopped at +$100.</div>
          </div>

          <label className="label">Trading windows</label>
          <div className="col gap8">
            {windows.map((w, k) => (
              <div key={k} className="row gap8" style={{ alignItems: 'center' }}>
                <input type="time" className="input" style={{ width: 130 }} value={w.from} onChange={(e) => set({ windows: windows.map((x, j) => (j === k ? { ...x, from: e.target.value } : x)) })} />
                <span className="muted">to</span>
                <input type="time" className="input" style={{ width: 130 }} value={w.to} onChange={(e) => set({ windows: windows.map((x, j) => (j === k ? { ...x, to: e.target.value } : x)) })} />
                <button className="icon-btn" title="Remove" onClick={() => set({ windows: windows.filter((_, j) => j !== k) })}><Trash size={14} /></button>
              </div>
            ))}
            <div className="row gap8 wrap" style={{ alignItems: 'center' }}>
              <button className="btn sm" onClick={() => set({ windows: [...windows, { from: '06:30', to: '09:00' }] })}><Plus size={13} /> Add a window</button>
              <div className="re-days">
                {DAYS.map(([l, d]) => <button key={d} className={(cfg.days || []).includes(d) ? 'on' : ''} title={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]} onClick={() => set({ days: (cfg.days || []).includes(d) ? cfg.days.filter((x) => x !== d) : [...(cfg.days || []), d].sort() })}>{l}</button>)}
              </div>
            </div>
            <label className="row gap8" style={{ fontSize: 13 }}><input type="checkbox" className="cbx" checked={!!cfg.flatten} onChange={(e) => set({ flatten: e.target.checked })} /> Close open positions when a window ends</label>
            <div className="re-help">{windows.length ? 'New orders are only allowed inside these times, on the days picked' : 'No windows: trading is allowed all day on the days picked'} (your time zone). A window can run past midnight, like 15:00 to 02:00.</div>
          </div>

          <label className="label">Trades per day</label>
          <div><Num value={cfg.maxTrades} onChange={(v) => set({ maxTrades: v })} placeholder="No limit" width={110} /><div className="re-help">After this many round trips, no new positions until tomorrow.</div></div>

          <label className="label">Losing trades in a row</label>
          <div>
            <div className="row gap8 wrap" style={{ alignItems: 'center' }}>
              <Num value={cfg.maxConsec} onChange={(v) => set({ maxConsec: v })} placeholder="No limit" width={110} />
              <span className="muted" style={{ fontSize: 12.5 }}>a loss is anything worse than</span>
              <Num value={cfg.consecMin} onChange={(v) => set({ consecMin: v })} placeholder="0" prefix="$" width={100} />
            </div>
            <div className="re-help">Stop for the day after this many losers in a row (small scratches under the amount don’t count).</div>
          </div>

          <label className="label">Contracts per position</label>
          <div><Num value={cfg.maxContracts} onChange={(v) => set({ maxContracts: v })} placeholder="No limit" width={110} /><div className="re-help">Anything above this is closed straight away (ATAS can’t refuse an order for its size, only for adding to a position).</div></div>

          <label className="label">ATAS Risk Management</label>
          <div>
            <label className="row gap8" style={{ fontSize: 13 }}><input type="checkbox" className="cbx" checked={cfg.setAtas !== false} onChange={(e) => set({ setAtas: e.target.checked })} /> Keep this account’s ATAS Risk Management in step</label>
            <div className="re-help">Sets ATAS’s own loss limit to the daily loss limit (lowered as the trailing drawdown tightens), and its max trades and losses-in-a-row to the limits above. Its profit target, reset time and response mode stay as you set them in ATAS.</div>
          </div>
        </div>
      </div>

      {cfg.on && (
        <div className="panel col gap8" style={{ padding: 14 }}>
          <b style={{ fontWeight: 600 }}>Today in ATAS</b>
          {!fresh || !acc ? (
            <div className="muted" style={{ fontSize: 13 }}>{fresh ? 'ATAS hasn’t seen this account yet — is it connected?' : 'Waiting for Journal Sync…'}</div>
          ) : (
            <>
              <div className="re-stats">
                <div><span className="muted">Closed P&amp;L</span><b className={acc.realised >= 0 ? 'pos' : 'neg'}>{fmtMoney(acc.realised, { sign: true })}</b></div>
                <div><span className="muted">Open P&amp;L</span><b className={acc.unrealised >= 0 ? 'pos' : 'neg'}>{fmtMoney(acc.unrealised, { sign: true })}</b></div>
                <div><span className="muted">Day’s high</span><b>{fmtMoney(acc.peak, { sign: true })}</b></div>
                <div><span className="muted">Trailing stop at</span><b>{fmtMoney(acc.floor, { sign: true })}</b></div>
                {acc.target > 0 && <div><span className="muted">Profit target</span><b>{fmtMoney(acc.target, { sign: true })}</b></div>}
                <div><span className="muted">Trades</span><b>{acc.trades}{inRules?.maxTrades ? ` / ${inRules.maxTrades}` : ''}</b></div>
                <div><span className="muted">Losers in a row</span><b>{acc.streak}{inRules?.maxConsec ? ` / ${inRules.maxConsec}` : ''}</b></div>
              </div>
              {acc.blocked
                ? <div className="ec-warn"><TriangleAlert size={14} /> New orders blocked: {acc.reason}</div>
                : <div className="row gap6 pos" style={{ fontSize: 13 }}><Check size={14} /> Trading allowed{inRules?.windowed && inRules.windowChangeMin != null ? ` — window closes in ${inRules.windowChangeMin} min` : ''}</div>}
              {acc.native && (
                <div className="muted" style={{ fontSize: 12.5 }}>
                  ATAS Risk Management: {acc.native.ok ? `loss limit ${money0(acc.native.lossLimit)}${acc.native.maxTrades ? ` · max ${acc.native.maxTrades} trades` : ''}${acc.native.maxConsec ? ` · ${acc.native.maxConsec} losses in a row` : ''}${acc.native.state ? ` · ${acc.native.state}` : ''}` : <span className="neg">{acc.native.error}</span>}
                  {acc.native.responseMode && acc.native.responseMode !== 'ReduceOnly' && <span className="neg"> · its response mode is “{acc.native.responseMode}”, so ATAS’s own limits only warn (RoninFlow’s block still applies) — set it to Reduce only in ATAS’s Risk Management window</span>}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <EmergencyUnblock live={live} reload={() => fetch('/api/atas/risk/status', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => j && setLive(j)).catch(() => {})} />
    </div>
  );
}

const maskId = (id) => (id.length > 9 ? `${id.slice(0, 4)}•••${id.slice(-3)}` : id);
const WAIT = 10; // seconds before the unblock button works

/** The escape hatch for a block caused by a glitch: deliberately slow — open it, pick, type UNBLOCK, wait. */
function EmergencyUnblock({ live, reload }) {
  const { state } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState('');
  const [pause, setPause] = useState(false);
  const [typed, setTyped] = useState('');
  const [left, setLeft] = useState(WAIT);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    setLeft(WAIT);
    const t0 = Date.now();
    const iv = setInterval(() => { const l = Math.max(0, WAIT - Math.floor((Date.now() - t0) / 1000)); setLeft(l); if (!l) clearInterval(iv); }, 250);
    return () => clearInterval(iv);
  }, [open]);

  const st = live?.status;
  const fresh = st && Date.now() - st.receivedAt < 20e3;
  const nameOf = (id) => { const a = state.accounts.find((x) => x.id === id); return a?.name && a.name !== id ? `${a.name} (${maskId(id)})` : maskId(id); };
  const blocked = new Map();
  for (const a of (fresh ? st.accounts || [] : [])) if (a.blocked) blocked.set(a.account, a.reason || 'blocked');
  for (const m of live?.blocks?.manual || []) if (!blocked.has(m.account)) blocked.set(m.account, 'blocked by you for the rest of the day');
  const paused = live?.blocks?.paused || [];
  const others = [...new Set([...(st?.accounts || []).map((a) => a.account), ...state.accounts.map((a) => a.id)])].filter((id) => id && !blocked.has(id));
  const choice = pick || (blocked.size ? '__all' : '');
  const targets = choice === '__all' ? [...blocked.keys()] : choice ? [choice] : [];
  const ready = targets.length > 0 && typed.trim().toUpperCase() === 'UNBLOCK' && left === 0 && !busy;

  const post = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`); };
  const unblock = async () => {
    setBusy(true);
    try {
      await post('/api/atas/risk/unlock', { accounts: targets, pause });
      toast(`Unblocked ${targets.length === 1 ? nameOf(targets[0]) : `${targets.length} accounts`}${pause ? ' — rules paused until midnight' : ''}`);
      setOpen(false); setTyped(''); setPick(''); setPause(false);
      reload();
    } catch (e) { toast(`Couldn’t unblock: ${e.message}`); }
    setBusy(false);
  };
  const resume = async (id) => { try { await post('/api/atas/risk/unpause', { accounts: [id] }); toast(`Rules back on for ${nameOf(id)}`); reload(); } catch (e) { toast(`Couldn’t resume: ${e.message}`); } };

  return (
    <div className="panel col gap8" style={{ padding: 14, borderColor: open ? 'var(--neg, #e5484d)' : undefined }}>
      <div className="row between gap8 wrap">
        <div className="col" style={{ gap: 2 }}>
          <b style={{ fontWeight: 600 }}>Emergency unblock</b>
          <span className="muted" style={{ fontSize: 12.5 }}>Only for a block caused by a glitch or malfunction — not for talking yourself back into the market.</span>
        </div>
        {!open && <button className="btn sm" onClick={() => setOpen(true)}><LockOpen size={13} /> Open…</button>}
      </div>

      {paused.length > 0 && (
        <div className="col gap6">
          {paused.map((p) => (
            <div key={p.account} className="row gap8 wrap" style={{ fontSize: 13, alignItems: 'center' }}>
              <TriangleAlert size={14} style={{ color: 'var(--warn, #e8b043)' }} />
              <span>Rules paused until midnight on <b>{nameOf(p.account)}</b> — nothing is enforced on it today.</span>
              <button className="btn xs" onClick={() => resume(p.account)}>Turn rules back on</button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="col gap12" style={{ marginTop: 4 }}>
          <div className="ec-warn"><TriangleAlert size={14} /> This lifts today’s block straight away, including one set by a rule (daily loss limit, trailing drawdown, profit target, trade count…) or from the RoninFlow Suite indicator. It’s logged, and ATAS’s own Risk Management limits aren’t touched.</div>

          <div className="row gap8 wrap" style={{ alignItems: 'center' }}>
            <span className="label" style={{ margin: 0 }}>Account</span>
            <select className="select" style={{ maxWidth: 360 }} value={choice} onChange={(e) => setPick(e.target.value)}>
              {!blocked.size && <option value="">Choose an account…</option>}
              {blocked.size > 1 && <option value="__all">All blocked accounts ({blocked.size})</option>}
              {blocked.size > 0 && <optgroup label="Blocked now">{[...blocked].map(([id, why]) => <option key={id} value={id}>{nameOf(id)} — {why}</option>)}</optgroup>}
              {others.length > 0 && <optgroup label="Not blocked">{others.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}</optgroup>}
            </select>
          </div>

          <label className="row gap8" style={{ fontSize: 13 }}>
            <input type="checkbox" className="cbx" checked={pause} onChange={(e) => setPause(e.target.checked)} />
            Also pause this account’s rules until midnight
          </label>
          <div className="re-help" style={{ marginTop: -6 }}>{pause ? 'Nothing will block or close positions on it for the rest of the day.' : 'Without this, a rule that’s still broken (say you’re still past the loss limit) blocks it again within seconds.'}</div>

          <div className="row gap8 wrap" style={{ alignItems: 'center' }}>
            <span style={{ fontSize: 13 }}>Type <b>UNBLOCK</b> to confirm</span>
            <input className="input" style={{ width: 140 }} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="UNBLOCK" autoComplete="off" spellCheck={false} />
          </div>

          <div className="row gap8">
            <button className="btn danger" disabled={!ready} onClick={unblock}><LockOpen size={14} /> {busy ? 'Unblocking…' : left > 0 ? `Unblock (wait ${left}s)` : 'Unblock now'}</button>
            <button className="btn" onClick={() => { setOpen(false); setTyped(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
