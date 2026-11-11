import { useEffect, useState } from 'react';
import { Smartphone, Copy, Check, TriangleExclamationPoint as TriangleAlert, HardDrive, Wifi, ShieldCheck, RefreshCw, Download, Lock } from 'lucide-react';
import { useStore } from '../store/store';
import { Modal, ModalHead, Switch, useToast } from './ui';
import { fmtDate, fmtTime12 } from '../lib/stats';

const jsonOf = async (r) => ((r.headers.get('content-type') || '').includes('json') ? r.json() : null);

/** Status of the journal server's network access (null when there is no server). */
export function useNetStatus(deps = []) {
  const [st, setSt] = useState(null);
  const load = async () => {
    try {
      const r = await fetch('/api/net/status', { cache: 'no-store' });
      setSt(r.ok ? await jsonOf(r) : null);
    } catch { setSt(null); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, deps);
  return [st, load];
}

function CopyLine({ text }) {
  const toast = useToast();
  return (
    <div className="row gap8" style={{ padding: '10px 12px', background: 'var(--card-2)', border: '1px solid var(--border-2)' }}>
      <span className="grow" style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 15 }}>{text}</span>
      <button className="btn xs" onClick={() => { navigator.clipboard?.writeText(text); toast('Copied'); }}><Copy size={12} /> Copy</button>
    </div>
  );
}

export default function NetworkAccess({ open, onClose }) {
  const { storage } = useStore();
  const toast = useToast();
  const [st, reload] = useNetStatus([open]);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [cur, setCur] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (open) { setPin(''); setPin2(''); setCur(''); setErr(''); } }, [open]);

  const post = async (url, body) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
      const j = await jsonOf(r);
      if (!r.ok) throw new Error(j?.error || `Error ${r.status}`);
      await reload();
      return j;
    } catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  };
  const savePin = async () => {
    if (pin.length < 8) return setErr('Use at least 8 characters.');
    if (pin !== pin2) return setErr("The two passwords don't match.");
    if (await post('/api/net/config', { password: pin, currentPassword: cur })) { toast('Password saved — other devices need to sign in again'); setPin(''); setPin2(''); setCur(''); }
  };
  // this PC, or another device signed in with the password (full details come back only then)
  const isPc = st?.you === 'pc' || !!st?.urls;
  const onPc = st?.you === 'pc';

  return (
    <Modal open={open} onClose={onClose} width={680}>
      <ModalHead title="Phone & network access" sub="Use your journal on your phone or tablet over your home Wi-Fi" onClose={onClose} />
      <div className="modal-body col gap16">
        <div className="panel row gap12" style={{ padding: 14, alignItems: 'flex-start' }}>
          <HardDrive size={18} className={storage.mode === 'server' ? 'pos' : 'muted'} style={{ marginTop: 2 }} />
          <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            {storage.mode === 'server' && <><b style={{ fontWeight: 600 }}>Saved on your PC</b> in the journal's <code>data</code> folder (backed up daily), shared by every device.{storage.savedAt && <span className="muted"> Last saved {fmtTime12(storage.savedAt)}.</span>}</>}
            {storage.mode === 'local' && <><b style={{ fontWeight: 600 }}>Saved only in this browser.</b> <span className="muted">The journal server isn't running, so nothing is shared. Start it with <code>npm run autostart:install</code>.</span></>}
            {storage.mode === 'waiting' && <><b style={{ fontWeight: 600 }}>Waiting for your PC.</b> <span className="muted">Open the journal once on your PC so your data moves to the server.</span></>}
            {storage.mode === 'checking' && <span className="muted">Checking storage…</span>}
            {storage.error && <div className="neg" style={{ marginTop: 4 }}>{storage.error}</div>}
          </div>
        </div>

        {!st && <div className="badge neutral" style={{ padding: '8px 12px', whiteSpace: 'normal' }}><TriangleAlert size={14} /> The journal server isn't reachable from this page.</div>}

        {st && !isPc && (
          <div className="panel row gap12" style={{ padding: 14 }}>
            <Smartphone size={18} className="accent" />
            <div style={{ fontSize: 13.5 }}>You're signed in on this device. Sign in with the password to change these settings.</div>
          </div>
        )}

        {st && isPc && (
          <>
            {st.mode !== 'server' && (
              <div className="badge neutral" style={{ padding: '10px 12px', whiteSpace: 'normal', lineHeight: 1.5 }}>
                <TriangleAlert size={14} /> You're running <b>&nbsp;npm run dev&nbsp;</b>, which only works on this PC. For phone access use the background server: stop the dev server and run <code>npm run autostart:install</code>, then open this window again.
              </div>
            )}
            <div className="panel col gap12" style={{ padding: 16 }}>
              <div className="row gap8" style={{ fontWeight: 600 }}><ShieldCheck size={16} /> {st.hasPassword ? 'Change password' : st.hasPin ? 'Replace your PIN with a password' : 'Step 1 · Set a password'}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>Other devices (and this PC, if you turn that on below) sign in with it. At least 8 characters — a few words make a strong one.</div>
              <div className="row gap8 wrap">
                {st.hasPin && !onPc && <input className="input" style={{ width: 190 }} type="password" autoComplete="current-password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} />}
                <input className="input" style={{ width: 190 }} type="password" autoComplete="new-password" placeholder="New password" value={pin} onChange={(e) => setPin(e.target.value)} />
                <input className="input" style={{ width: 190 }} type="password" autoComplete="new-password" placeholder="Repeat" value={pin2} onChange={(e) => setPin2(e.target.value)} />
                <button className="btn" onClick={savePin} disabled={busy || !pin}>{st.hasPassword ? 'Change' : 'Save password'}</button>
                {st.hasPassword && <span className="badge pos-soft"><Check size={12} /> Password set</span>}
              </div>
              {st.hasPassword && (
                <label className="row gap8" style={{ fontSize: 13 }}>
                  <Switch on={!!st.requireLocal} onChange={async (v) => { if (await post('/api/net/config', { requireLocal: v })) toast(v ? 'This PC asks for the password too' : 'This PC opens without the password'); }} />
                  Ask for the password on this PC too <span className="muted" style={{ fontSize: 12 }}>(shared computers)</span>
                </label>
              )}
            </div>

            <div className="panel col gap12" style={{ padding: 16 }}>
              <div className="row between">
                <div className="row gap8" style={{ fontWeight: 600 }}><Wifi size={16} /> {st.hasPin ? '' : 'Step 2 · '}Allow devices on my home network</div>
                <Switch on={!!st.lan} onChange={async (v) => { if (await post('/api/net/config', { lan: v })) toast(v ? 'Network access on' : 'Network access off'); }} />
              </div>
              {!st.lan && <div className="muted" style={{ fontSize: 12.5 }}>Off: the journal only answers this PC.</div>}
              {st.lan && (
                <>
                  <div style={{ fontSize: 13.5 }}>On your phone (same Wi-Fi), open:</div>
                  {st.urls?.length ? st.urls.map((u) => <CopyLine key={u.url} text={u.url} />) : <div className="muted">No network address found — is this PC connected to Wi-Fi or Ethernet?</div>}
                  <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                    Tip: after unlocking, use your browser's <b style={{ color: 'var(--fg)', fontWeight: 500 }}>Add to Home Screen</b> to get an app icon.
                  </div>
                  <div className="row gap12" style={{ fontSize: 13 }}>
                    <span className="muted">{st.devices} device{st.devices === 1 ? '' : 's'} signed in</span>
                    {st.devices > 0 && <button className="btn xs" onClick={async () => { if (await post('/api/net/revoke')) toast('All devices signed out'); }}>Sign out all devices</button>}
                    {st.sessions?.length > 0 && <span className="muted" style={{ fontSize: 12 }}>Last: {fmtDate(st.sessions[st.sessions.length - 1].lastSeen)} {fmtTime12(st.sessions[st.sessions.length - 1].lastSeen)}</span>}
                  </div>
                </>
              )}
            </div>

            <div className="panel col gap12" style={{ padding: 16 }}>
              <div className="row between">
                <div className="row gap8" style={{ fontWeight: 600 }}><Download size={16} /> Install as an app <span className="muted" style={{ fontWeight: 400, fontSize: 12.5 }}>· secure HTTPS via Tailscale</span></div>
                {st.tailscale?.serving && <span className="badge pos-soft"><Lock size={11} /> On</span>}
              </div>
              {!st.tailscale && <div className="muted" style={{ fontSize: 12.5 }}>Tailscale isn't running on this PC. Install / sign in to Tailscale, then press Refresh.</div>}
              {st.tailscale && !st.tailscale.serving && (
                <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                  One-time setup: in the journal folder run <code>npm run phone:https</code>. It gives the journal a secure address your phone can install:
                  <div style={{ marginTop: 8 }}><CopyLine text={st.tailscale.url} /></div>
                </div>
              )}
              {st.tailscale?.serving && (
                <>
                  <CopyLine text={st.tailscale.url} />
                  <ol className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.65 }}>
                    <li>On your phone, turn Tailscale on and open the address above.</li>
                    <li>Sign in with your password.</li>
                    <li><b style={{ color: 'var(--fg)', fontWeight: 500 }}>Android (Chrome):</b> ⋮ menu → <b style={{ color: 'var(--fg)', fontWeight: 500 }}>Install app</b>. <b style={{ color: 'var(--fg)', fontWeight: 500 }}>iPhone (Safari):</b> Share → <b style={{ color: 'var(--fg)', fontWeight: 500 }}>Add to Home Screen</b>.</li>
                  </ol>
                  {!st.lan && <div className="badge neutral" style={{ padding: '6px 10px', whiteSpace: 'normal' }}><TriangleAlert size={13} /> Turn on “Allow devices on my home network” above — it controls the HTTPS address too.</div>}
                  <div className="muted" style={{ fontSize: 12 }}>Works anywhere your phone has Tailscale on, not just home Wi-Fi.</div>
                </>
              )}
            </div>

            <div className="panel" style={{ padding: '12px 16px', fontSize: 12.5, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Phone can't connect?</div>
              <ol className="muted" style={{ margin: 0, paddingLeft: 18 }}>
                <li>Allow it through Windows Firewall once: run <code>npm run phone:firewall</code> in the journal folder and approve the admin prompt.</li>
                <li>Set your Wi-Fi as a <b style={{ color: 'var(--fg)', fontWeight: 500 }}>Private network</b> (Windows Settings → Network & internet → Wi-Fi → your network → Private).</li>
                <li>Make sure the phone is on the same Wi-Fi, not cellular or a guest network.</li>
              </ol>
            </div>
          </>
        )}
        {err && <div className="badge neg-soft" style={{ padding: '8px 12px', whiteSpace: 'normal' }}><TriangleAlert size={14} /> {err}</div>}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={reload}><RefreshCw size={13} /> Refresh</button>
        <div className="grow" />
        <button className="btn white" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
