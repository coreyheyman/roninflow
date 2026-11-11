import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Plus, Trash, ShieldCheck, Cable, Users, Gauge, Bot, Sparkles, Languages as LangIcon } from 'lucide-react';
import { useStore } from '../store/store';
import { Switch } from './ui';
import { LANGS } from '../lib/i18n';
import { CONNECTORS } from '../lib/connectors';
import { DEFAULT_RISK } from '../lib/playbook';
import { DD_TYPES } from '../lib/accountDD';
import { PROVIDERS, storeKey, VAULT } from '../lib/ai';
import { Wordmark } from './Layout';

const jsonOf = async (r) => ((r.headers.get('content-type') || '').includes('json') ? r.json() : null);
const STEPS = [
  ['welcome', 'Welcome', Sparkles],
  ['security', 'Password', ShieldCheck],
  ['platforms', 'Platforms', Cable],
  ['accounts', 'Accounts', Users],
  ['risk', 'Risk tiers', Gauge],
  ['coach', 'AI coach', Bot],
];
const PRESETS = [
  { id: 'prop50', label: '50K prop challenge', a: { phase: 'Challenge', initial: 50000, profitTarget: 3000, maxDrawdown: 2000, dailyLossLimit: 1000, ddType: 'eod' } },
  { id: 'prop100', label: '100K prop challenge', a: { phase: 'Challenge', initial: 100000, profitTarget: 6000, maxDrawdown: 3000, dailyLossLimit: 2000, ddType: 'eod' } },
  { id: 'funded', label: 'Funded account', a: { phase: 'Funded', initial: 50000, profitTarget: 0, maxDrawdown: 2000, dailyLossLimit: 1000, ddType: 'eod' } },
  { id: 'personal', label: 'Personal account', a: { phase: 'Personal', initial: 10000, profitTarget: 0, maxDrawdown: 0, dailyLossLimit: 0, ddType: 'static' } },
];
const PLATFORM_GROUPS = [['live', 'Trading platforms'], ['api', 'Brokers & prop firms'], ['crypto', 'Crypto exchanges']];

/** First-run setup: name & language, password, platforms, accounts with prop-firm rules, risk tiers, AI coach. */
export default function Setup() {
  const { state, storage, update, setSetting, addAccount, loadDemo } = useStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(state.user?.name || '');
  const [net, setNet] = useState(undefined);
  const [pw, setPw] = useState({ a: '', b: '', err: '', ok: false });
  const [platforms, setPlatforms] = useState([]);
  const [acct, setAcct] = useState({ name: '', preset: 'prop50', ...PRESETS[0].a, market: 'Futures' });
  const [riskOn, setRiskOn] = useState(true);
  const [tiers, setTiers] = useState(() => DEFAULT_RISK.tiers.map((t) => ({ ...t })));
  const [coach, setCoach] = useState({ provider: 'local', key: '', base: '' });
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch('/api/net/status').then((r) => (r.ok ? jsonOf(r) : null)).then(setNet).catch(() => setNet(null)); }, []);
  const lang = state.settings.language || 'en';
  const id = STEPS[step][0];
  const last = step === STEPS.length - 1;

  const savePassword = async () => {
    if (pw.a.length < 8) return setPw((p) => ({ ...p, err: 'Use at least 8 characters.' }));
    if (pw.a !== pw.b) return setPw((p) => ({ ...p, err: "The passwords don't match." }));
    setBusy(true);
    try {
      const r = await fetch('/api/net/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw.a }) });
      const j = await jsonOf(r);
      if (!r.ok) throw new Error(j?.error || `Error ${r.status}`);
      setPw({ a: '', b: '', err: '', ok: true });
      setNet((n) => ({ ...(n || {}), hasPassword: true, hasPin: true }));
    } catch (e) { setPw((p) => ({ ...p, err: e.message })); }
    setBusy(false);
  };
  const addAcct = () => {
    const nm = acct.name.trim() || `${PRESETS.find((p) => p.id === acct.preset)?.label || 'Account'} ${state.accounts.length + 1}`;
    if (state.accounts.some((a) => a.id === nm)) return;
    const { preset, ...rest } = acct;
    addAccount({ ...rest, name: nm, id: nm, plan: PRESETS.find((p) => p.id === preset)?.label || 'Account', broker: '' });
    setAcct((x) => ({ ...x, name: '' }));
  };
  const finish = async () => {
    setBusy(true);
    let coachSettings = { ...state.settings.coach, provider: coach.provider };
    if (coach.provider !== 'local') {
      const p = { ...(state.settings.coach.providers?.[coach.provider] || {}) };
      if (coach.base) p.base = coach.base;
      if (coach.key) p.apiKey = (await storeKey(coach.provider, coach.key)) ? VAULT : coach.key;
      coachSettings = { ...coachSettings, providers: { ...(state.settings.coach.providers || {}), [coach.provider]: p } };
    }
    update((s) => ({
      ...s,
      user: { ...s.user, name: name.trim(), handle: s.user?.handle || name.trim() },
      settings: {
        ...s.settings,
        setupDone: true,
        platforms,
        riskEnabled: riskOn,
        risk: riskOn ? { ...(s.settings.risk || {}), tiers } : s.settings.risk,
        coach: coachSettings,
      },
    }));
    if (demo) loadDemo();
    setBusy(false);
    if (platforms.length) window.location.hash = '#/connections';
  };

  return (
    <div className="setup-wrap">
      <div className="setup">
        <aside className="setup-side">
          <div style={{ fontSize: 20 }}><Wordmark /></div>
          <div className="setup-steps">
            {STEPS.map(([sid, label, Icon], i) => (
              <button key={sid} className={`${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`} onClick={() => i <= step && setStep(i)}>
                <span className="setup-num">{i < step ? <Check size={12} strokeWidth={3} /> : <Icon size={13} />}</span>{label}
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 'auto' }}>You can change all of this later in Settings.</div>
        </aside>
        <main className="setup-main">
          {id === 'welcome' && (
            <div className="col gap16">
              <div><h2>Welcome to RoninFlow</h2><p className="muted">A private journal that lives on your own computer. Let’s set it up — it takes about two minutes.</p></div>
              <div className="field"><label className="label">Your name</label><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="So the journal and coach know what to call you" /></div>
              <div className="field">
                <label className="label"><LangIcon size={13} style={{ verticalAlign: -2 }} /> Language</label>
                <div className="lang-grid">{LANGS.map((l) => <button key={l.code} className={`chip no-i18n ${lang === l.code ? 'on' : ''}`} onClick={() => setSetting('language', l.code)}>{lang === l.code && <Check size={12} />}{l.label}</button>)}</div>
              </div>
            </div>
          )}

          {id === 'security' && (
            <div className="col gap16">
              <div><h2>Protect your journal</h2><p className="muted">Phones, tablets and other computers will need this password to open your journal. Your broker logins and API keys are stored encrypted.</p></div>
              {net === undefined && <div className="muted">Checking…</div>}
              {net === null && <div className="panel muted" style={{ padding: 14, fontSize: 13 }}>{storage.mode === 'local' ? 'The journal server isn’t running, so the journal is kept only in this browser and a password isn’t needed. Start the server later to use it on other devices.' : 'The journal server isn’t reachable right now — you can set a password later in Settings → Security & privacy.'}</div>}
              {net && (net.hasPassword || pw.ok
                ? <div className="badge pos-soft" style={{ padding: '10px 12px' }}><Check size={14} /> Password set{net.you === 'network' ? ' — you are signed in' : ''}</div>
                : (
                  <div className="col gap8" style={{ maxWidth: 380 }}>
                    <input className="input" type="password" autoComplete="new-password" placeholder="Password (at least 8 characters)" value={pw.a} onChange={(e) => setPw((p) => ({ ...p, a: e.target.value, err: '' }))} />
                    <input className="input" type="password" autoComplete="new-password" placeholder="Repeat password" value={pw.b} onChange={(e) => setPw((p) => ({ ...p, b: e.target.value, err: '' }))} />
                    {pw.err && <span className="neg" style={{ fontSize: 12.5 }}>{pw.err}</span>}
                    <button className="btn white" style={{ alignSelf: 'flex-start' }} disabled={busy || !pw.a} onClick={savePassword}>Set password</button>
                    {net.hasPin && <span className="muted" style={{ fontSize: 12 }}>This replaces the PIN from an older version.</span>}
                  </div>
                ))}
              {net && <div className="muted" style={{ fontSize: 12 }}>Using it only on this computer? You can skip this and set it later. Away from home: see Settings → Security & privacy for Tailscale and Cloudflare.</div>}
            </div>
          )}

          {id === 'platforms' && (
            <div className="col gap16">
              <div><h2>Where do you trade?</h2><p className="muted">Pick what you use and the journal will walk you through connecting them, so trades come in automatically. You can also import files any time.</p></div>
              {PLATFORM_GROUPS.map(([g, label]) => (
                <div key={g}>
                  <div className="label">{label}</div>
                  <div className="row gap6 wrap">
                    {CONNECTORS.filter((c) => c.group === g && c.status === 'ready').map((c) => {
                      const on = platforms.includes(c.id);
                      return <button key={c.id} className={`chip no-i18n ${on ? 'on' : ''}`} onClick={() => setPlatforms((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}>{on && <Check size={12} />}{c.name}</button>;
                    })}
                  </div>
                </div>
              ))}
              {platforms.length > 0 && <div className="muted" style={{ fontSize: 12.5 }}>After setup you’ll land on Connections with these at the top.</div>}
            </div>
          )}

          {id === 'accounts' && (
            <div className="col gap16">
              <div><h2>Your accounts</h2><p className="muted">Add the accounts you trade, with your prop firm’s rules — the journal tracks the profit target and drawdown live. Connected platforms also create accounts automatically.</p></div>
              {state.accounts.length > 0 && (
                <div className="col gap6">
                  {state.accounts.map((a) => (
                    <div key={a.id} className="row gap8 panel" style={{ padding: '8px 12px', fontSize: 13 }}>
                      <b className="grow no-i18n" style={{ fontWeight: 600 }}>{a.name}</b>
                      <span className="muted">{a.phase} · ${Number(a.initial).toLocaleString()}{a.profitTarget ? ` · target $${Number(a.profitTarget).toLocaleString()}` : ''}{a.maxDrawdown ? ` · max DD $${Number(a.maxDrawdown).toLocaleString()} (${DD_TYPES.find((t) => t.id === a.ddType)?.label || 'EOD'})` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="panel col gap12" style={{ padding: 14 }}>
                <div className="row gap6 wrap">{PRESETS.map((p) => <button key={p.id} className={`chip ${acct.preset === p.id ? 'on' : ''}`} onClick={() => setAcct((x) => ({ ...x, preset: p.id, ...p.a }))}>{p.label}</button>)}</div>
                <div className="form-grid">
                  <div className="field full"><label className="label">Account name or number</label><input className="input" value={acct.name} onChange={(e) => setAcct((x) => ({ ...x, name: e.target.value }))} placeholder="e.g. PA-50K-12345" /></div>
                  {[['initial', 'Starting balance'], ['profitTarget', 'Profit target'], ['maxDrawdown', 'Max drawdown'], ['dailyLossLimit', 'Daily loss limit']].map(([k, l]) => (
                    <div key={k} className="field"><label className="label">{l} (USD)</label><input className="input" type="number" value={acct[k]} onChange={(e) => setAcct((x) => ({ ...x, [k]: Number(e.target.value) }))} /></div>
                  ))}
                  <div className="field full"><label className="label">Drawdown type</label>
                    <select className="select" value={acct.ddType} onChange={(e) => setAcct((x) => ({ ...x, ddType: e.target.value }))}>{DD_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
                  </div>
                </div>
                <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={addAcct}><Plus size={14} /> Add account</button>
              </div>
            </div>
          )}

          {id === 'risk' && (
            <div className="col gap16">
              <div><h2>Risk tiers</h2><p className="muted">The journal moves you between tiers based on your drawdown and recent days — stepping down after losses and back up after solid green days — and shows today’s daily loss limit and risk per trade.</p></div>
              <label className="row gap8" style={{ fontSize: 14 }}><Switch on={riskOn} onChange={setRiskOn} /> Use risk tiers</label>
              {riskOn && (
                <div className="col gap6">
                  {tiers.map((t, i) => (
                    <div key={t.id} className="rule" style={{ gap: 8 }}>
                      <span style={{ width: 10, height: 30, background: t.color, flexShrink: 0 }} />
                      <input className="input" style={{ height: 32, width: 150 }} value={t.name} onChange={(e) => setTiers((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                      {[['dailyLL', 'Daily loss limit'], ['riskMin', 'Risk / trade min'], ['riskMax', 'Risk / trade max']].map(([k, l]) => (
                        <input key={k} className="input" type="number" title={l} placeholder={l} style={{ height: 32, width: 120 }} value={t[k]} onChange={(e) => setTiers((x) => x.map((y, j) => (j === i ? { ...y, [k]: Number(e.target.value) } : y)))} />
                      ))}
                      {tiers.length > 2 && <button className="icon-btn" onClick={() => setTiers((x) => x.filter((_, j) => j !== i))}><Trash size={14} /></button>}
                    </div>
                  ))}
                  <span className="muted" style={{ fontSize: 12 }}>Columns: name · daily loss limit · risk per trade (min–max), in USD. The drawdown rules are in Playbook settings.</span>
                </div>
              )}
            </div>
          )}

          {id === 'coach' && (
            <div className="col gap16">
              <div><h2>Your AI coach</h2><p className="muted">The coach reviews your days, weeks and risk. Bring your own AI key, run a free model on your own computer, or keep it fully offline.</p></div>
              <div className="prov-grid">
                {Object.entries(PROVIDERS).map(([pid, p]) => (
                  <button key={pid} className={`prov ${coach.provider === pid ? 'on' : ''}`} onClick={() => setCoach((c) => ({ ...c, provider: pid }))}>
                    <b className="no-i18n">{p.label}</b>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{pid === 'local' ? 'Offline · free' : pid === 'ollama' ? 'Free · runs on your computer' : 'Your API key'}</div>
                  </button>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 12.5 }}>{PROVIDERS[coach.provider].desc}</div>
              {PROVIDERS[coach.provider].needsKey && (
                <div className="field" style={{ maxWidth: 440 }}>
                  <label className="label">API key <a className="accent" href={PROVIDERS[coach.provider].keyUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 400 }}>get one</a></label>
                  <input className="input" type="password" autoComplete="off" value={coach.key} onChange={(e) => setCoach((c) => ({ ...c, key: e.target.value.trim() }))} />
                  <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>Stored encrypted on the journal server, never in the browser.</span>
                </div>
              )}
              {coach.provider === 'ollama' && (
                <div className="field" style={{ maxWidth: 440 }}>
                  <label className="label">Ollama address</label>
                  <input className="input" placeholder={PROVIDERS.ollama.base} value={coach.base} onChange={(e) => setCoach((c) => ({ ...c, base: e.target.value.trim() }))} />
                  <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>Install Ollama from ollama.com, then run <code>ollama pull llama3.1</code>.</span>
                </div>
              )}
              <label className="row gap8" style={{ fontSize: 13.5, marginTop: 8 }}><input type="checkbox" className="cbx" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Add demo trades so I can look around first <span className="muted" style={{ fontSize: 12 }}>(a “DEMO-50K” account you can remove in Settings)</span></label>
            </div>
          )}

          <div className="setup-foot">
            {step > 0 ? <button className="btn" onClick={() => setStep(step - 1)}><ChevronLeft size={15} /> Back</button> : <span />}
            <div className="grow" />
            {!last && step > 0 && <button className="btn ghost" onClick={() => setStep(step + 1)}>Skip</button>}
            {last
              ? <button className="btn primary" disabled={busy} onClick={finish}><Check size={15} /> Finish setup</button>
              : <button className="btn white" onClick={() => setStep(step + 1)}>Continue <ChevronRight size={15} /></button>}
          </div>
        </main>
      </div>
    </div>
  );
}
