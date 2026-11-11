import { useEffect, useMemo, useState } from 'react';
import { Plug, Webhook, FileUp, Radio, KeyRound, Bitcoin, Copy, RefreshCw, Eye, EyeOff, Check, Trash, ArrowUpRight } from 'lucide-react';
import { useStore } from '../store/store';
import { Modal, ModalHead, Seg, Confirm, useToast } from '../components/ui';
import ImportModal from '../components/ImportModal';
import { useAtasSync } from '../components/AtasSync';
import { useConnect } from '../components/ConnectSync';
import { GROUPS, CONNECTORS, platformName } from '../lib/connectors';
import { IS_DEMO, DOWNLOAD_URL } from '../lib/demoMode';
import { useJournalOs, OS_OPTIONS } from '../lib/journalOs';

const ago = (iso) => {
  if (!iso) return null;
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};
const GROUP_ICON = { live: Radio, api: KeyRound, crypto: Bitcoin, webhook: Webhook, file: FileUp };

function copy(text, toast, what = 'Copied') {
  navigator.clipboard?.writeText(text).then(() => toast(what), () => toast('Couldn’t copy — select and copy it manually'));
}

function Card({ c, state: st, onOpen }) {
  const soon = c.status === 'soon' && st?.tone !== 'live'; // a planned platform that's already sending counts as connected
  return (
    <button className={`cx-card ${soon ? 'soon' : ''} ${st?.tone || ''}`} onClick={soon ? undefined : onOpen} disabled={soon}>
      <div className="row between" style={{ gap: 8, width: '100%' }}>
        <span className="cx-logo">{c.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()}</span>
        <span className={`cx-pill ${soon ? '' : st?.tone || 'ready'}`}>{soon ? 'Coming soon' : st?.label || (c.group === 'file' ? 'Import' : 'Set up')}</span>
      </div>
      <div className="cx-name">{c.name}{c.beta && <span className="cx-beta">beta</span>}</div>
      <div className="cx-blurb">{c.blurb}</div>
      {st?.sub && <div className="cx-sub">{st.sub}</div>}
    </button>
  );
}

function FileSteps({ c, onClose, onImport }) {
  return (
    <Modal open onClose={onClose} width={520}>
      <ModalHead title={`Import from ${c.name}`} sub="Export your history, then drop the file in" onClose={onClose} />
      <div className="modal-body">
        <ol className="cx-steps">{c.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>Menus differ between versions — any export with fills (time, side, quantity, price) or closed trades works. Trades already in your journal are skipped, so re-importing is safe.</div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn white" onClick={onImport}><FileUp size={15} /> Choose file</button>
      </div>
    </Modal>
  );
}

function AddonSetup({ c, src, onClose, onWebhook }) {
  const { refresh } = useConnect();
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);
  const hb = src?.heartbeat;
  const live = hb?.at && Date.now() - new Date(hb.at).getTime() < 90000;
  const journalOs = useJournalOs();
  const [picked, setOs] = useState(null);
  const os = picked || journalOs;
  const steps = os === 'unix' && c.unix ? c.unix : c;
  return (
    <Modal open onClose={onClose} width={620}>
      <ModalHead title={`${c.name} live sync${c.beta ? ' (beta)' : ''}`} sub={c.blurb} onClose={onClose} />
      <div className="modal-body">
        <div className={`cx-status ${live ? 'on' : ''}`}>
          <span className={`cx-dot ${live ? 'on' : ''}`} />
          {live
            ? <span><b>Connected</b> · v{hb.version || '?'} · {(hb.accounts || []).length} account{(hb.accounts || []).length === 1 ? '' : 's'}: {(hb.accounts || []).join(', ') || '—'}{hb.queued ? ` · ${hb.queued} waiting to send` : ''}</span>
            : src ? <span><b>Not running</b> · last heard {ago(hb?.at || src.lastSeen) || 'never'}</span> : <span><b>Not set up yet</b> — follow the steps below.</span>}
        </div>
        {src && <div className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>{src.fills ? `${src.fills} fills` : `${src.trades || 0} trades`} received so far.</div>}
        {c.unix && (
          <div className="row gap10 cx-os">
            <span className="muted" style={{ fontSize: 12.5 }}>RoninFlow runs on</span>
            <Seg value={os} onChange={setOs} options={OS_OPTIONS} />
          </div>
        )}
        <ol className="cx-setup">
          {steps.setup.map(([t, d], i) => <li key={i}><b>{t}</b><span>{d}</span></li>)}
        </ol>
        <div className="label" style={{ marginTop: 16 }}>Good to know</div>
        <ul className="cx-rules">{steps.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onWebhook}><KeyRound size={14} /> Token &amp; endpoint</button>
        <div className="grow" />
        <button className="btn white" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

function ApiSetup({ c, api, src, onClose }) {
  const toast = useToast();
  const { refresh, checkNow } = useConnect();
  const init = () => Object.fromEntries(c.fields.filter((f) => !f.signin).map((f) => [f.key, api?.config?.[f.key] ?? (f.options ? f.options[0].value : '')]));
  const [form, setForm] = useState(init);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [drop, setDrop] = useState(false);
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const call = async (what, method, body) => {
    setBusy(what);
    try {
      const r = await fetch(`/api/connect/apis/${c.id}${what === 'sync' ? '/sync' : ''}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    } finally { setBusy(null); refresh(); }
  };
  const connect = async () => {
    setResult(null);
    try {
      const j = await call('connect', 'POST', { config: form, enabled: true });
      setResult(j.ok ? { ok: true, text: j.message } : { ok: false, text: j.error });
      if (j.ok) { toast(`${c.name} connected — importing trades`); setTimeout(() => checkNow(), 8000); }
    } catch (e) { setResult({ ok: false, text: e.message }); }
  };
  const sync = async () => {
    try { const j = await call('sync', 'POST'); setResult(j.lastError ? { ok: false, text: j.lastError } : { ok: true, text: j.lastResult || 'Checked' }); checkNow(true); }
    catch (e) { setResult({ ok: false, text: e.message }); }
  };
  const hb = src?.heartbeat;
  const on = api?.configured && api.enabled && !api.lastError;
  return (
    <Modal open onClose={onClose} width={620}>
      <ModalHead title={c.name} sub={c.blurb} onClose={onClose} />
      <div className="modal-body">
        <div className={`cx-status ${on ? 'on' : ''}`}>
          <span className={`cx-dot ${on ? 'on' : ''}`} />
          {!api?.configured ? <span><b>Not connected</b> — follow the steps below.</span>
            : api.lastError ? <span><b>{api.enabled ? 'Problem' : 'Paused'}</b> · {api.lastError}</span>
            : !api.enabled ? <span><b>Paused</b></span>
            : <span><b>Connected</b> · checked {ago(api.lastPoll) || 'not yet'}{api.lastResult ? ` · ${api.lastResult}` : ''}{hb?.accounts?.length ? ` · ${hb.accounts.length} account${hb.accounts.length === 1 ? '' : 's'}` : ''}</span>}
        </div>
        <ol className="cx-setup">{c.setup.map(([t, d], i) => <li key={i}><b>{t}</b><span>{d}</span></li>)}</ol>
        <div className="cx-form">
          {c.fields.map((f) => f.signin ? (
            <div key={f.key} className="field cx-signin">
              <button type="button" className="btn" disabled={(f.need || []).some((k) => !form[k])} onClick={() => window.open(c.authorize(form), '_blank', 'noopener')}><ArrowUpRight size={14} /> Open {c.name} sign-in</button>
              {api?.config?.refreshToken && <span className="muted" style={{ fontSize: 12 }}>Signed in{api.config.signedInAt ? ` ${ago(api.config.signedInAt)}` : ''} — only needed again if the connection pauses.</span>}
            </div>
          ) : (
            <div key={f.key} className={`field ${f.wide ? 'cx-wide' : ''}`}>
              <label className="label">{f.label}</label>
              {f.options ? <Seg value={form[f.key]} onChange={(v) => set(f.key, v)} options={f.options} />
                : f.multiline ? <textarea className="textarea no-mask" rows={4} spellCheck={false} value={form[f.key] === '••••••••' ? '' : form[f.key] || ''} placeholder={api?.config?.[f.key] ? 'saved — leave blank to keep' : f.placeholder || ''} onChange={(e) => set(f.key, e.target.value)} style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5 }} />
                : <input className={`input ${f.secret ? 'no-mask' : ''}`} type={f.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} value={form[f.key] || ''} placeholder={f.secret && api?.config?.[f.key] ? 'saved — leave blank to keep' : f.placeholder || ''}
                  onChange={(e) => set(f.key, e.target.value)} onFocus={(e) => { if (f.secret && e.target.value === '••••••••') set(f.key, ''); }} />}
              {f.help && <span className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{f.help}</span>}
            </div>
          ))}
        </div>
        {result && <div className={`cx-result ${result.ok ? 'ok' : 'err'}`}>{result.ok ? <Check size={14} /> : null}{result.text}</div>}
        <div className="label" style={{ marginTop: 16 }}>Good to know</div>
        <ul className="cx-rules">
          {c.notes.map((n, i) => <li key={i}>{n}</li>)}
          <li>Your credentials are stored encrypted on the computer running RoninFlow and are never shown again here.</li>
        </ul>
      </div>
      <div className="modal-foot">
        {api?.configured && <button className="btn" onClick={() => setDrop(true)} disabled={!!busy}><Trash size={14} /> Disconnect</button>}
        {api?.configured && api.enabled && <button className="btn" onClick={sync} disabled={!!busy}><RefreshCw size={14} /> {busy === 'sync' ? 'Checking…' : 'Check now'}</button>}
        <div className="grow" />
        <button className="btn white" onClick={connect} disabled={!!busy}>{busy === 'connect' ? 'Connecting…' : api?.configured ? 'Save & reconnect' : 'Connect'}</button>
      </div>
      <Confirm open={drop} title={`Disconnect ${c.name}?`} body="Stops checking for new trades and deletes the saved credentials. Trades already in your journal stay." confirmText="Disconnect"
        onCancel={() => setDrop(false)} onConfirm={async () => { setDrop(false); await call('drop', 'DELETE'); setResult(null); toast(`${c.name} disconnected`); }} />
    </Modal>
  );
}

const FILL_EXAMPLE = (account) => JSON.stringify({
  source: 'my-platform',
  account,
  fills: [
    { id: 'fill-1001', symbol: 'MESZ6', side: 'Buy', qty: 2, price: 6012.25, time: new Date(Date.UTC(2026, 10, 10, 14, 31, 5)).toISOString(), commission: 0.62 },
    { id: 'fill-1002', symbol: 'MESZ6', side: 'Sell', qty: 2, price: 6015.5, time: new Date(Date.UTC(2026, 10, 10, 14, 36, 40)).toISOString(), commission: 0.62 },
  ],
}, null, 2);
const TRADE_EXAMPLE = (account) => JSON.stringify({
  source: 'my-platform',
  account,
  trades: [
    { id: 'trade-77', symbol: 'MNQZ6', direction: 'Short', qty: 1, entryTime: '2026-11-10T07:42:10-08:00', exitTime: '2026-11-10T07:49:55-08:00', entryPrice: 25210.5, exitPrice: 25188.25, fees: 0.74 },
  ],
}, null, 2);

function WebhookModal({ onClose }) {
  const { state } = useStore();
  const toast = useToast();
  const { status, refresh } = useConnect();
  const [show, setShow] = useState(false);
  const [tab, setTab] = useState('fills');
  const [rotate, setRotate] = useState(false);
  const [testing, setTesting] = useState(false);
  useEffect(() => { refresh(); }, [refresh]);
  const url = `${window.location.origin}/api/connect/ingest`;
  const token = status?.token || '';
  const account = state.settings.account !== 'all' ? state.settings.account : state.accounts[0]?.id || 'SIM101';
  const example = tab === 'fills' ? FILL_EXAMPLE(account) : TRADE_EXAMPLE(account);
  const curl = `curl -X POST "${url}" \\\n  -H "Authorization: Bearer ${show ? token : '<your token>'}" \\\n  -H "Content-Type: application/json" \\\n  -d @trades.json`;
  const test = async () => {
    setTesting(true);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ source: 'test', heartbeat: { note: 'Connection test from the journal' } }) });
      const j = await r.json();
      toast(r.ok ? 'Webhook is working — the test arrived (no trades were added)' : `Test failed: ${j.error || r.status}`);
      refresh();
    } catch { toast('Test failed — the journal server isn’t reachable'); }
    setTesting(false);
  };
  return (
    <Modal open onClose={onClose} width={720}>
      <ModalHead title="Webhook / API" sub="Push fills or closed trades into the journal from any script, bot or service" onClose={onClose} />
      <div className="modal-body cx-hook">
        <div className="field full">
          <label className="label">Endpoint (POST, JSON)</label>
          <div className="cx-copy"><code>{url}</code><button className="icon-btn" title="Copy" onClick={() => copy(url, toast, 'Endpoint copied')}><Copy size={14} /></button></div>
          <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>From another device use this journal’s network or Tailscale address. Add-ons running on this PC can post to <code>http://127.0.0.1:5173/api/connect/ingest</code> without a token.</span>
        </div>
        <div className="field full">
          <label className="label">Token <span className="muted">· send as <code>Authorization: Bearer …</code> (or <code>?token=</code>)</span></label>
          <div className="cx-copy">
            <code className="no-mask">{token ? (show ? token : '•'.repeat(32)) : 'Loading…'}</code>
            <button className="icon-btn" title={show ? 'Hide' : 'Show'} onClick={() => setShow((v) => !v)}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            <button className="icon-btn" title="Copy" onClick={() => copy(token, toast, 'Token copied')} disabled={!token}><Copy size={14} /></button>
            <button className="icon-btn" title="Make a new token" onClick={() => setRotate(true)}><RefreshCw size={14} /></button>
          </div>
        </div>
        <div className="field full">
          <div className="row between" style={{ marginBottom: 8 }}>
            <label className="label" style={{ margin: 0 }}>What to send</label>
            <Seg value={tab} onChange={setTab} options={[{ value: 'fills', label: 'Fills' }, { value: 'trades', label: 'Closed trades' }]} />
          </div>
          <pre className="cx-code">{example}</pre>
          <ul className="cx-rules">
            {tab === 'fills' ? (
              <>
                <li>Each fill: <code>symbol</code>, <code>side</code> (Buy/Sell), <code>qty</code>, <code>price</code>, <code>time</code>. Optional: <code>id</code>, <code>account</code>, <code>commission</code>, <code>pointValue</code>.</li>
                <li>Fills are paired into trades per account and contract — scale-ins, partial exits and reversals included. A trade appears once the position is flat.</li>
              </>
            ) : (
              <>
                <li>Each trade: <code>symbol</code>, <code>direction</code> (Long/Short), <code>qty</code>, <code>entryTime</code>, <code>exitTime</code>, <code>entryPrice</code>, <code>exitPrice</code>. Optional: <code>id</code>, <code>pnl</code>, <code>fees</code>, <code>pointValue</code>.</li>
                <li>Without <code>pnl</code>, P&L is worked out from prices and the contract’s point value (common futures are built in).</li>
              </>
            )}
            <li>Times must include a time zone (<code>2026-11-10T14:31:05Z</code>, <code>-08:00</code>) or be epoch milliseconds.</li>
            <li>Sending the same <code>id</code> again updates instead of duplicating. <code>source</code> names the platform (shown on the trade and in Connections).</li>
          </ul>
        </div>
        <div className="field full">
          <label className="label">Example request</label>
          <pre className="cx-code">{curl}</pre>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={test} disabled={!token || testing}>{testing ? 'Testing…' : 'Send a test'}</button>
        <div className="grow" />
        <button className="btn white" onClick={onClose}>Done</button>
      </div>
      <Confirm open={rotate} title="Make a new token?" body="Anything using the current token will stop being able to send trades until you give it the new one." confirmText="New token" onCancel={() => setRotate(false)}
        onConfirm={async () => { setRotate(false); await fetch('/api/connect/token', { method: 'POST' }); refresh(); toast('New token made'); }} />
    </Modal>
  );
}

export default function Connections() {
  const { state } = useStore();
  const toast = useToast();
  const atas = useAtasSync();
  const { status, refresh, checkNow } = useConnect();
  const [steps, setSteps] = useState(null);
  const [importing, setImporting] = useState(false); // false | connector id
  const [hook, setHook] = useState(false);
  const [reset, setReset] = useState(null);
  const [addon, setAddon] = useState(null);
  const [apiCfg, setApiCfg] = useState(null);
  useEffect(() => { refresh(); const t = setInterval(refresh, 20000); return () => clearInterval(t); }, [refresh]);

  const sources = useMemo(() => Object.entries(status?.sources || {}).filter(([id]) => id !== 'test').sort((a, b) => (b[1].lastSeen || '').localeCompare(a[1].lastSeen || '')), [status]);
  const tradesBySource = useMemo(() => {
    const m = {};
    for (const t of state.trades) if (t.connId) m[t.source] = (m[t.source] || 0) + 1;
    return m;
  }, [state.trades]);

  const cardState = (c) => {
    if (c.id === 'atas') {
      const a = atas.status?.addon;
      if (a === 'live') return { label: 'Connected', tone: 'live', sub: `Live · ${state.trades.filter((t) => t.atasId).length} trades synced` };
      if (a === 'stale') return { label: 'Not running', tone: 'warn', sub: `Last heard ${ago(atas.status?.heartbeat?.at)}` };
      return { label: 'Set up', sub: 'Install the Journal Sync indicator' };
    }
    if (c.id === 'webhook') {
      const n = sources.length;
      return n ? { label: 'Active', tone: 'live', sub: `${n} source${n === 1 ? '' : 's'} · last ${ago(sources[0][1].lastSeen)}` } : { label: 'Set up' };
    }
    const src = status?.sources?.[c.id];
    if (c.fields) { // direct API connections polled by the journal server
      const a = status?.apis?.[c.id];
      if (!a?.configured) return { label: 'Connect', sub: c.id === 'ibkr' ? 'Flex token + query ID' : c.id === 'hyperliquid' ? 'Just your wallet address' : 'Enter your API key' };
      if (a.lastError) return { label: a.enabled ? 'Problem' : 'Paused', tone: 'warn', sub: a.lastError.slice(0, 80) };
      if (!a.enabled) return { label: 'Paused', tone: 'warn' };
      return { label: 'Connected', tone: 'live', sub: `Checked ${ago(a.lastPoll) || 'soon'} · ${tradesBySource[c.id] || 0} trade${tradesBySource[c.id] === 1 ? '' : 's'} in journal` };
    }
    if (c.setup) { // live add-ons that use the connector inbox
      const at = src?.heartbeat?.at;
      if (at && Date.now() - new Date(at).getTime() < 90000) return { label: 'Connected', tone: 'live', sub: `Live · ${tradesBySource[c.id] || 0} trade${tradesBySource[c.id] === 1 ? '' : 's'} in journal` };
      if (src) return { label: 'Not running', tone: 'warn', sub: `Last heard ${ago(at || src.lastSeen)}` };
      return { label: 'Set up', sub: 'Install the add-on' };
    }
    if (src) return { label: 'Connected', tone: 'live', sub: `Last ${ago(src.lastSeen)}` };
    return null;
  };
  const open = (c) => {
    if (c.id === 'atas') return atas.open();
    if (c.id === 'webhook') return setHook(true);
    if (c.group === 'file') return setImporting(c.id);
    if (c.fields) return setApiCfg(c);
    if (c.setup) return setAddon(c);
    return setHook(true); // live/API sources that already send through the webhook
  };
  const readyCount = CONNECTORS.filter((c) => c.status === 'ready').length;

  return (
    <div className="page">
      <div className="row between wrap gap12" style={{ marginBottom: 4 }}>
        <div>
          <div className="page-title" style={{ marginBottom: 6 }}>Connections</div>
          <div className="muted" style={{ fontSize: 13 }}>Bring trades in automatically from your platforms, or import a file. {readyCount} ways ready today, more on the way.</div>
        </div>
        {!IS_DEMO && <button className="btn" onClick={() => checkNow(true)}><RefreshCw size={15} /> Check for new trades</button>}
      </div>
      {IS_DEMO && (
        <div className="demo-note" style={{ margin: '12px 0 4px' }}>
          In the demo you can read each platform's setup steps and try a <b>file import</b> (it runs right here in your browser).
          Live add-ons and broker or exchange logins need RoninFlow running on your computer — <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer">download it free</a>.
        </div>
      )}

      {sources.length > 0 && (
        <div className="panel" style={{ margin: '22px 0 6px' }}>
          <div className="panel-head"><div className="card-title">Sending trades</div><span className="muted" style={{ fontSize: 12 }}>via add-ons, APIs and webhooks</span></div>
          <div className="cx-sources">
            {sources.map(([id, s]) => (
              <div key={id} className="cx-src">
                <span className={`cx-dot ${Date.now() - new Date(s.lastSeen).getTime() < 10 * 60000 ? 'on' : ''}`} />
                <b>{platformName(id)}</b>
                <span className="muted">{s.fills} fills · {s.trades} trades received · {tradesBySource[id] || 0} in journal</span>
                {s.heartbeat?.version && <span className="muted">v{s.heartbeat.version}</span>}
                <span className="grow" />
                <span className="muted">{ago(s.lastSeen)}</span>
                <button className="icon-btn" title={`Forget everything received from ${platformName(id)}`} onClick={() => setReset(id)}><Trash size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {GROUPS.map((g) => {
        const Icon = GROUP_ICON[g.id];
        const list = CONNECTORS.filter((c) => c.group === g.id);
        return (
          <section key={g.id} className="cx-group">
            <div className="cx-group-h"><Icon size={16} /><b>{g.label}</b></div>
            <div className="cx-group-sub muted">{g.sub}</div>
            <div className="cx-grid">{list.map((c) => <Card key={c.id} c={c} state={cardState(c)} onOpen={() => open(c)} />)}</div>
          </section>
        );
      })}

      <div className="muted" style={{ fontSize: 12.5, margin: '26px 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Plug size={14} /> Building an add-on for another platform? It only needs to POST fills to the webhook — see <button className="accent" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }} onClick={() => setHook(true)}>Webhook / API <ArrowUpRight size={13} /></button>
      </div>

      {steps && <FileSteps c={steps} onClose={() => setSteps(null)} onImport={() => { setImporting(steps.id); setSteps(null); }} />}
      <ImportModal open={!!importing} initialSource={typeof importing === 'string' ? importing : null} onClose={() => setImporting(false)} />
      {hook && <WebhookModal onClose={() => setHook(false)} />}
      {apiCfg && <ApiSetup c={apiCfg} api={status?.apis?.[apiCfg.id]} src={status?.sources?.[apiCfg.id]} onClose={() => setApiCfg(null)} />}
      {addon && <AddonSetup c={addon} src={status?.sources?.[addon.id]} onClose={() => setAddon(null)} onWebhook={() => { setAddon(null); setHook(true); }} />}
      <Confirm open={!!reset} title={`Forget ${reset ? platformName(reset) : ''}?`} body="Clears what the journal server received from this source. Trades already in your journal stay unless they’re untouched (no notes, tags or review) — those are removed." confirmText="Forget"
        onCancel={() => setReset(null)} onConfirm={async () => { const id = reset; setReset(null); await fetch(`/api/connect/reset?source=${encodeURIComponent(id)}`, { method: 'POST' }); refresh(); checkNow(); toast(`${platformName(id)} cleared`); }} />
    </div>
  );
}
