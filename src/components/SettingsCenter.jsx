import { useEffect, useState } from 'react';
import { Check, Download, RefreshCw, ShieldCheck, Globe, CandlestickChart, Archive, Info, KeyRound, TriangleExclamationPoint as TriangleAlert, ExternalLink } from 'lucide-react';
import { useStore } from '../store/store';
import { Modal, ModalHead, Switch, useToast } from './ui';
import { LANGS } from '../lib/i18n';
import { fmtDate, fmtTime12 } from '../lib/stats';
import { useNetStatus } from './NetworkAccess';

const jsonOf = async (r) => ((r.headers.get('content-type') || '').includes('json') ? r.json() : null);
const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo']; } })();

const TABS = [
  ['general', 'General', Globe],
  ['security', 'Security & privacy', ShieldCheck],
  ['prices', 'Price data', CandlestickChart],
  ['backups', 'Backups & updates', Archive],
  ['about', 'About & credits', Info],
];

/** Everything that isn't part of trading itself, in one place. */
export default function SettingsCenter({ open, tab: initialTab = 'general', onClose, onNetwork, onCurrency, onPlaybook }) {
  const [tab, setTab] = useState(initialTab);
  const [was, setWas] = useState(open);
  if (was !== open) { setWas(open); if (open) setTab(initialTab); }
  if (!open) return null;
  return (
    <Modal open onClose={onClose} width={860}>
      <ModalHead title="Settings" sub="Language, security, price data, backups and updates" onClose={onClose} />
      <div className="set-wrap">
        <nav className="set-nav">
          {TABS.map(([id, label, Icon]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><Icon size={15} /> <span>{label}</span></button>)}
        </nav>
        <div className="set-body">
          {tab === 'general' && <General onCurrency={onCurrency} onPlaybook={onPlaybook} />}
          {tab === 'security' && <Security onNetwork={onNetwork} />}
          {tab === 'prices' && <Prices />}
          {tab === 'backups' && <Backups />}
          {tab === 'about' && <About />}
        </div>
      </div>
      <div className="modal-foot"><div className="grow" /><button className="btn white" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

function General({ onCurrency, onPlaybook }) {
  const { state, setSetting, update, removeDemo } = useStore();
  const toast = useToast();
  const [name, setName] = useState(state.user?.name || '');
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="col gap16">
      <div className="field">
        <label className="label">Your name</label>
        <div className="row gap8">
          <input className="input" style={{ maxWidth: 320 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown in the sidebar and used by the coach" />
          <button className="btn" disabled={name === (state.user?.name || '')} onClick={() => { update((s) => ({ ...s, user: { ...s.user, name: name.trim(), handle: s.user?.handle || name.trim() } })); toast('Saved'); }}>Save</button>
        </div>
      </div>
      <div className="field">
        <label className="label">Language</label>
        <div className="lang-grid">
          {LANGS.map((l) => <button key={l.code} className={`chip no-i18n ${(state.settings.language || 'en') === l.code ? 'on' : ''}`} onClick={() => setSetting('language', l.code)}>{(state.settings.language || 'en') === l.code && <Check size={12} />}{l.label}</button>)}
        </div>
        <span className="muted" style={{ fontSize: 12, marginTop: 6 }}>Menus, buttons and headings are translated; your own notes and some detailed text stay as written.</span>
      </div>
      <div className="field">
        <label className="label">Your time zone</label>
        <select className="select no-i18n" style={{ maxWidth: 360 }} value={state.settings.timeZone || 'device'} onChange={(e) => setSetting('timeZone', e.target.value)}>
          <option value="device">This device ({device})</option>
          {ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
        </select>
        <span className="muted" style={{ fontSize: 12, marginTop: 6 }}>Trades from live sync, broker connections and imports with a time zone are recorded in this time zone, so session days stay the same on every device.</span>
      </div>
      <div className="field">
        <label className="label">Features</label>
        <label className="row gap8" style={{ fontSize: 13.5 }}><Switch on={state.settings.riskEnabled !== false} onChange={(v) => setSetting('riskEnabled', v)} /> Risk tiers <span className="muted" style={{ fontSize: 12 }}>(Risk Management page, today’s risk in the sidebar and diary)</span></label>
        {state.trades.some((t) => t.demo) && <button className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={() => { removeDemo(); toast('Demo data removed'); }}>Remove demo data</button>}
      </div>
      <div className="row gap8 wrap">
        <button className="btn" onClick={onCurrency}>Currency: {state.settings.currency?.code || 'USD'}</button>
        <button className="btn" onClick={onPlaybook}>Playbook, risk tiers & edge blockers</button>
      </div>
    </div>
  );
}

const LEAVES = [
  ['AI coach', 'Only if you choose an AI provider (Coach settings): the question and the journal figures it needs go to that provider. The built-in analytics and a local Ollama model keep everything on your computer.'],
  ['Price data', 'For the execution charts: the symbol and day go to the price source you pick (Settings → Price data). Bars from your platform add-on never leave your computer.'],
  ['Broker & exchange connections', 'Only the ones you connect: your journal logs in to them to read your trades. Credentials are stored encrypted here and sent only to that broker.'],
  ['Currency conversion', 'Only when you show amounts in another currency: today’s rate is fetched from open.er-api.com (or frankfurter.app). Nothing about you is sent.'],
  ['Chart library & font', 'Once: the TradingView Lightweight Charts library is downloaded from jsDelivr/unpkg and kept in data/vendor; the Inter font loads from Google Fonts.'],
  ['Update check', 'Once a day, if on (Settings → Backups & updates): asks GitHub for the newest release number. Nothing about you is sent.'],
];

function Security({ onNetwork }) {
  const [st] = useNetStatus([]);
  const [names, setNames] = useState(null);
  useEffect(() => { fetch('/api/vault').then(jsonOf).then((j) => setNames(j?.names || [])).catch(() => setNames(null)); }, []);
  return (
    <div className="col gap16">
      <div className="panel col gap8" style={{ padding: 14 }}>
        <div className="row between">
          <b style={{ fontWeight: 600 }}><KeyRound size={14} style={{ verticalAlign: -2 }} /> Password</b>
          {st ? (st.hasPassword ? <span className="badge pos-soft"><Check size={12} /> Set</span> : st.hasPin ? <span className="badge neutral">Old PIN — replace it</span> : <span className="badge neutral">Not set</span>) : <span className="muted" style={{ fontSize: 12 }}>server not reachable</span>}
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>
          Other devices (phone, tablet, a home server in your browser) sign in with your password. Sessions end after 30 days without a visit, and repeated wrong attempts are blocked for a minute.
          {st?.hasPassword && (st.requireLocal ? ' This computer asks for it too.' : ' This computer opens without it — you can change that.')}
        </div>
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={onNetwork}>Password & network access…</button>
      </div>
      <div className="panel col gap6" style={{ padding: 14 }}>
        <b style={{ fontWeight: 600 }}>Saved keys are encrypted</b>
        <div className="muted" style={{ fontSize: 12.5 }}>
          Broker logins, exchange keys, price-data keys and AI keys are stored encrypted (AES-256) in the data folder and never sent back to the browser.
          {names ? ` ${names.length} AI key${names.length === 1 ? '' : 's'} in the vault.` : ''} Keep the data folder private: its <code>secret.key</code> file unlocks them.
        </div>
      </div>
      <div>
        <div className="label">What leaves this computer</div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Your journal, trades, notes and screenshots stay in your data folder. There is no account, no analytics and no tracking. The only outside connections are the ones below — each only when you use that feature:</div>
        <ul className="cx-rules">{LEAVES.map(([k, v]) => <li key={k}><b style={{ color: 'var(--fg)', fontWeight: 600 }}>{k}:</b> {v}</li>)}</ul>
      </div>
      <div>
        <div className="label">Using it away from home</div>
        <ul className="cx-rules">
          <li><b style={{ color: 'var(--fg)', fontWeight: 600 }}>Tailscale (easiest, private):</b> install Tailscale on the computer running the journal and on your phone, sign in to both with the same account, then run <code>npm run phone:https</code> (or <code>tailscale serve --bg 5173</code>). Open the https://…ts.net address on your phone. Nothing is exposed to the internet.</li>
          <li><b style={{ color: 'var(--fg)', fontWeight: 600 }}>Cloudflare Tunnel (public address):</b> with a domain on Cloudflare, run <code>cloudflared tunnel --url http://localhost:5173</code> (quick test) or set up a named tunnel, and put Cloudflare Access in front of it. Always set a password first.</li>
          <li>Never forward the journal’s port on your router.</li>
        </ul>
        <div className="muted" style={{ fontSize: 12.5 }}>Step-by-step guide: <code>docs/remote-access.md</code> in the project folder.</div>
      </div>
    </div>
  );
}

function Prices() {
  const toast = useToast();
  const [cfg, setCfg] = useState(null);
  const [keys, setKeys] = useState({ databentoKey: '', polygonKey: '' });
  const [busy, setBusy] = useState(false);
  const load = () => fetch('/api/candles/config').then(jsonOf).then(setCfg).catch(() => setCfg(false));
  useEffect(() => { load(); }, []);
  const save = async (patch) => {
    setBusy(true);
    try {
      const r = await fetch('/api/candles/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ yahoo: cfg.yahoo, ...patch }) });
      setCfg(await jsonOf(r)); setKeys({ databentoKey: '', polygonKey: '' }); toast('Price data settings saved');
    } catch { toast('Couldn’t save'); }
    setBusy(false);
  };
  if (cfg === null) return <div className="muted">Loading…</div>;
  if (cfg === false) return <div className="muted">The journal server isn’t reachable, so price data can’t be configured from here.</div>;
  return (
    <div className="col gap16">
      <div className="muted" style={{ fontSize: 13 }}>The execution charts in your diary need 1-minute price bars. Pick where they come from — the first one that has the symbol is used, and every day is saved so it’s only fetched once.</div>
      <div className="panel col gap6" style={{ padding: 14 }}>
        <div className="row between"><b style={{ fontWeight: 600 }}>1 · Your platform add-on</b>{cfg.addonSymbols?.length ? <span className="badge pos-soft">{cfg.addonSymbols.length} symbol{cfg.addonSymbols.length === 1 ? '' : 's'} received</span> : <span className="badge neutral">Nothing received yet</span>}</div>
        <div className="muted" style={{ fontSize: 12.5 }}>Your own data feed, free and private. The ATAS Journal Sync indicator sends the bars of the chart it’s on (put it on a 1-minute chart). Other tools can POST bars to <code>/api/candles/ingest</code> with your webhook token.</div>
      </div>
      <div className="panel col gap8" style={{ padding: 14 }}>
        <div className="row between"><b style={{ fontWeight: 600 }}>2 · Databento <span className="muted" style={{ fontWeight: 400 }}>— CME futures</span></b>{cfg.databento && <span className="badge pos-soft"><Check size={12} /> Key saved</span>}</div>
        <div className="muted" style={{ fontSize: 12.5 }}>Licensed CME Globex 1-minute bars with your own key (pay-as-you-go; new accounts get free credit). <a className="accent" href="https://databento.com/signup" target="_blank" rel="noreferrer">Get a key <ExternalLink size={11} /></a></div>
        <div className="row gap8"><input className="input grow" type="password" autoComplete="off" placeholder={cfg.databento ? 'Saved — paste a new key to replace' : 'db-…'} value={keys.databentoKey} onChange={(e) => setKeys((k) => ({ ...k, databentoKey: e.target.value }))} /><button className="btn" disabled={busy || !keys.databentoKey} onClick={() => save({ databentoKey: keys.databentoKey })}>Save</button>{cfg.databento && <button className="btn" disabled={busy} onClick={() => save({ databentoKey: '' })}>Remove</button>}</div>
      </div>
      <div className="panel col gap8" style={{ padding: 14 }}>
        <div className="row between"><b style={{ fontWeight: 600 }}>3 · Polygon <span className="muted" style={{ fontWeight: 400 }}>— stocks, crypto, forex</span></b>{cfg.polygon && <span className="badge pos-soft"><Check size={12} /> Key saved</span>}</div>
        <div className="muted" style={{ fontSize: 12.5 }}>1-minute bars with your own key (free tier available). <a className="accent" href="https://polygon.io/dashboard/signup" target="_blank" rel="noreferrer">Get a key <ExternalLink size={11} /></a></div>
        <div className="row gap8"><input className="input grow" type="password" autoComplete="off" placeholder={cfg.polygon ? 'Saved — paste a new key to replace' : 'API key'} value={keys.polygonKey} onChange={(e) => setKeys((k) => ({ ...k, polygonKey: e.target.value }))} /><button className="btn" disabled={busy || !keys.polygonKey} onClick={() => save({ polygonKey: keys.polygonKey })}>Save</button>{cfg.polygon && <button className="btn" disabled={busy} onClick={() => save({ polygonKey: '' })}>Remove</button>}</div>
      </div>
      <div className="panel col gap8" style={{ padding: 14 }}>
        <div className="row between">
          <b style={{ fontWeight: 600 }}>4 · Yahoo Finance <span className="muted" style={{ fontWeight: 400 }}>— opt-in</span></b>
          <Switch on={!!cfg.yahoo} onChange={(v) => save({ yahoo: v })} />
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}><TriangleAlert size={12} style={{ verticalAlign: -2 }} /> Yahoo’s chart feed is unofficial and not licensed for use in other apps — it can stop working at any time and you use it at your own risk. Continuous front-month futures only; 1-minute bars for the last 30 days.</div>
      </div>
    </div>
  );
}

function Backups() {
  const toast = useToast();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const call = async (path, body) => {
    setBusy(true);
    try { const r = await fetch(`/api/system/${path}`, body !== undefined ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}); setInfo(await jsonOf(r)); return true; } catch { setInfo(false); return false; } finally { setBusy(false); }
  };
  useEffect(() => { call('info'); }, []);
  if (info === null) return <div className="muted">Loading…</div>;
  if (info === false) return <div className="muted">The journal server isn’t reachable. In browser-only mode, use the user menu → Export backup.</div>;
  return (
    <div className="col gap16">
      <div className="panel col gap8" style={{ padding: 14 }}>
        <div className="row between"><b style={{ fontWeight: 600 }}>Automatic daily backups</b><button className="btn xs" disabled={busy} onClick={async () => { if (await call('backup', {})) toast('Backup made'); }}><Archive size={12} /> Back up now</button></div>
        <div className="muted" style={{ fontSize: 12.5 }}>A copy of your journal (and your connections) is saved every day in <code>{info.dataDir}/backups</code>. Copy that folder to another drive or cloud storage now and then.</div>
        <div className="row gap8" style={{ fontSize: 13 }}>Keep the last <input className="input" type="number" min="1" style={{ width: 80, height: 30 }} defaultValue={info.keep} onBlur={(e) => Number(e.target.value) !== info.keep && call('settings', { keep: Number(e.target.value) })} /> days</div>
        <div className="set-list">
          {info.backups.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>No backups yet — the first one is made a minute after the journal starts.</div>}
          {info.backups.slice(0, 12).map((b) => (
            <div key={b.file} className="row between" style={{ fontSize: 13 }}>
              <span>{fmtDate(b.date)}</span><span className="muted">{(b.size / 1024).toFixed(0)} KB</span>
              <a className="btn xs" href={`/api/system/backups/${b.file}`} download><Download size={12} /> Download</a>
            </div>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>To restore one: user menu → Restore backup, and choose the downloaded file.</div>
      </div>
      <div className="panel col gap8" style={{ padding: 14 }}>
        <div className="row between"><b style={{ fontWeight: 600 }}>Updates</b><span className="muted no-i18n" style={{ fontSize: 12.5 }}>You have v{info.version}</span></div>
        {info.updateAvailable
          ? <div className="badge pos-soft" style={{ padding: '8px 10px', whiteSpace: 'normal' }}>Version {info.latest} is available. <a className="accent" href={info.updateUrl} target="_blank" rel="noreferrer">See what’s new & download</a></div>
          : <div className="muted" style={{ fontSize: 12.5 }}>{info.repo ? (info.checkedAt ? `Up to date · checked ${fmtDate(info.checkedAt)} ${fmtTime12(info.checkedAt)}` : 'Not checked yet.') : 'Update checks start once this copy knows where it was published (repository in package.json).'}</div>}
        <label className="row gap8" style={{ fontSize: 13 }}><Switch on={!!info.updateCheck} onChange={(v) => call('settings', { updateCheck: v })} /> Check for new versions once a day</label>
        {info.repo && <button className="btn xs" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => call('check-updates', {})}><RefreshCw size={12} /> Check now</button>}
        <div className="muted" style={{ fontSize: 12 }}>Updating: Docker — <code>docker compose pull && docker compose up -d</code>. Windows — run the new installer (your data is kept).</div>
      </div>
    </div>
  );
}

const CREDITS = [
  ['TradingView Lightweight Charts™', 'Apache-2.0', 'Execution charts. Copyright © TradingView, Inc. — the TradingView logo on the charts links to tradingview.com as the licence requires.', 'https://www.tradingview.com/lightweight-charts/'],
  ['React', 'MIT', 'User interface.', 'https://react.dev'],
  ['Lucide icons', 'ISC', 'Icons.', 'https://lucide.dev'],
  ['Inter typeface', 'SIL OFL 1.1', 'Default font, by Rasmus Andersson.', 'https://rsms.me/inter/'],
  ['Vite', 'MIT', 'Build tool.', 'https://vitejs.dev'],
];

function About() {
  return (
    <div className="col gap16">
      <div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>RoninFlow</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>A free, open-source trading journal you run yourself. Released under the MIT licence — use it, change it and share it. Not financial advice; trade at your own risk.</div>
      </div>
      <div>
        <div className="label">Built with</div>
        <div className="col gap6">
          {CREDITS.map(([name, lic, what, url]) => (
            <div key={name} className="row gap8" style={{ fontSize: 13, alignItems: 'baseline' }}>
              <a className="accent no-i18n" href={url} target="_blank" rel="noreferrer" style={{ minWidth: 210 }}>{name}</a>
              <span className="badge neutral no-i18n" style={{ fontSize: 11 }}>{lic}</span>
              <span className="muted">{what}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>Trademarks belong to their owners. RoninFlow is not affiliated with any broker, prop firm, exchange, platform or data provider it connects to. Full licence texts: LICENSE and NOTICE.md in the project folder.</div>
    </div>
  );
}
