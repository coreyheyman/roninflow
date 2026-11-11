import { useState } from 'react';
import { Check, Eye, EyeOff, RefreshCw, TriangleExclamationPoint as TriangleAlert, ExternalLink, Cpu, Cloud, Sparkles, Zap, Bot, Server } from 'lucide-react';
import { Modal, ModalHead } from './ui';
import { PROVIDERS, providerConfig, testConnection, THINKING, VAULT, vaultKeys } from '../lib/ai';

const ICONS = { local: Cpu, anthropic: Sparkles, openai: Zap, google: Bot, ollama: Server, ollamaCloud: Cloud };

export default function CoachSettings({ open, onClose, coach, save, name: initialName }) {
  const [c, setC] = useState(coach);
  const [name, setName] = useState(initialName);
  const [sel, setSel] = useState(coach.provider || 'local');
  const [show, setShow] = useState(false);
  const [models, setModels] = useState({});
  const [test, setTest] = useState({});
  const [busy, setBusy] = useState(false);
  const [was, setWas] = useState(open);
  if (open !== was) {
    setWas(open);
    if (open) { setC({ providers: {}, ...coach }); setName(initialName); setSel(coach.provider || 'local'); setTest({}); setShow(false); }
  }

  const P = PROVIDERS[sel];
  const cfg = providerConfig(c, sel);
  const setP = (patch) => setC((x) => ({ ...x, providers: { ...(x.providers || {}), [sel]: { ...(x.providers?.[sel] || {}), ...patch } } }));
  const run = async () => {
    setBusy(true);
    setTest((t) => ({ ...t, [sel]: { pending: true } }));
    try {
      const r = await testConnection(sel, cfg);
      setModels((m) => ({ ...m, [sel]: r.models }));
      setTest((t) => ({ ...t, [sel]: { ok: true, ...r } }));
      if (!cfg.model && r.models[0]) setP({ model: r.models[0] });
    } catch (e) {
      setTest((t) => ({ ...t, [sel]: { ok: false, error: e.message } }));
    }
    setBusy(false);
  };
  const tr = test[sel];
  const list = models[sel] || [];

  return (
    <Modal open={open} onClose={onClose} width={860}>
      <ModalHead title="Customization Settings" sub="Choose which AI powers your Trading Coach and how it talks to you" onClose={onClose} />
      <div className="modal-body col gap16">
        <div>
          <div className="label">AI provider</div>
          <div className="prov-grid">
            {Object.entries(PROVIDERS).map(([id, p]) => {
              const Icon = ICONS[id];
              const configured = !!c.providers?.[id]?.apiKey;
              return (
                <button key={id} className={`prov ${sel === id ? 'on' : ''}`} onClick={() => setSel(id)}>
                  <div className="row gap8"><Icon size={16} /><b>{p.label}</b></div>
                  <div className="row gap6" style={{ fontSize: 11.5, marginTop: 6 }}>
                    {c.provider === id ? <span className="badge pos" style={{ padding: '1px 6px' }}>Active</span>
                      : id === 'local' ? <span className="muted">Offline · free</span>
                        : id === 'ollama' ? <span className="muted">No key needed</span>
                          : configured ? <span className="muted">Key saved</span> : <span className="muted">Needs API key</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="panel col gap12" style={{ padding: 16 }}>
          <div className="row between">
            <div className="row gap8" style={{ fontWeight: 600 }}>{(() => { const I = ICONS[sel]; return <I size={16} />; })()} {P.label}</div>
            {sel !== 'local' && P.keyUrl && <a className="row gap6 muted" style={{ fontSize: 12.5 }} href={P.keyUrl} target="_blank" rel="noreferrer">{sel === 'ollama' ? 'Download Ollama' : 'Get an API key'} <ExternalLink size={12} /></a>}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>{P.desc}</div>

          {sel !== 'local' && (
            <div className="form-grid">
              {(P.needsKey || sel === 'openai') && (
                <div className="field full">
                  <label className="label">API key{sel === 'openai' && ' (leave empty for local OpenAI-compatible servers)'}</label>
                  <div className="row gap8">
                    <input className="input" type={show ? 'text' : 'password'} autoComplete="off" placeholder={c.providers?.[sel]?.apiKey === VAULT ? 'Saved securely on the server — type to replace' : { anthropic: 'sk-ant-…', openai: 'sk-…', google: 'AIza…', ollamaCloud: 'ollama.com API key' }[sel]} value={c.providers?.[sel]?.apiKey === VAULT ? '' : c.providers?.[sel]?.apiKey || ''} onChange={(e) => setP({ apiKey: e.target.value.trim() || (c.providers?.[sel]?.apiKey === VAULT ? VAULT : '') })} />
                    <button className="btn" style={{ width: 40, padding: 0 }} onClick={() => setShow((s) => !s)} title={show ? 'Hide' : 'Show'}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                  </div>
                </div>
              )}
              <div className="field">
                <label className="label">{sel === 'ollama' ? 'Ollama address' : 'Base URL'}</label>
                <input className="input" value={c.providers?.[sel]?.base ?? ''} placeholder={P.base} onChange={(e) => setP({ base: e.target.value.trim() })} />
              </div>
              <div className="field">
                <label className="label">Model</label>
                <div className="row gap8">
                  <input className="input" list={`models-${sel}`} placeholder={P.model} value={c.providers?.[sel]?.model ?? ''} onChange={(e) => setP({ model: e.target.value.trim() })} />
                  <datalist id={`models-${sel}`}>{list.map((m) => <option key={m} value={m} />)}</datalist>
                  {list.length > 0 && (
                    <select className="select" style={{ width: 44, padding: '0 0 0 8px', backgroundPosition: 'right 10px center' }} value="" onChange={(e) => e.target.value && setP({ model: e.target.value })} title="Pick from available models">
                      <option value="" />
                      {list.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}
                </div>
              </div>
            </div>
          )}

          {sel !== 'local' && (
            <div className="row gap12 wrap">
              <button className="btn sm" onClick={run} disabled={busy || (P.needsKey && !c.providers?.[sel]?.apiKey)}>
                <RefreshCw size={13} className={busy ? 'spin' : ''} /> Test connection & load models
              </button>
              {tr?.ok && <span className="badge pos-soft"><Check size={12} /> Connected · {tr.models.length} models · {tr.ms} ms</span>}
              {tr?.ok && cfg.model && !tr.modelFound && <span className="badge neutral" style={{ whiteSpace: 'normal' }}>Model “{cfg.model}” not in the list — pick one from the menu</span>}
              {tr && tr.ok === false && <span className="badge neg-soft" style={{ whiteSpace: 'normal', lineHeight: 1.45 }}><TriangleAlert size={12} /> {tr.error}</span>}
            </div>
          )}
          {sel === 'ollama' && (
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
              Install Ollama, then pull a model in a terminal, e.g. <code>ollama pull llama3.1</code> (or <code>qwen2.5</code>, <code>gemma3</code>; use a vision model such as <code>llava</code> for chart screenshots). Requests go from the journal's dev server straight to Ollama, so nothing leaves your computer. To reach Ollama on another machine, set the address (e.g. <code>http://192.168.1.20:11434</code>) and start Ollama there with <code>OLLAMA_HOST=0.0.0.0</code>.
            </div>
          )}
          {sel !== 'local' && sel !== 'ollama' && (
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              Your key is stored only in this browser. When you ask a question, a summary of the selected account's trades, sessions and diary notes is sent to {P.label} along with your message.
            </div>
          )}

          <div className="row gap12">
            {c.provider === sel ? (
              <span className="badge pos"><Check size={12} /> {P.label} is powering the Coach</span>
            ) : (
              <button className="btn sm white" onClick={() => setC((x) => ({ ...x, provider: sel }))} disabled={P.needsKey && !c.providers?.[sel]?.apiKey}>Use {P.label}</button>
            )}
          </div>
        </div>

        {c.provider && c.provider !== 'local' && (
          <div className="field" style={{ marginBottom: 16 }}>
            <label className="label">Thinking</label>
            <div className="row gap8 wrap">
              {THINKING.map((t) => (
                <button key={t.value} className={`chip ${(c.thinking || 'standard') === t.value ? 'on' : ''}`} style={{ padding: '7px 14px' }} onClick={() => setC({ ...c, thinking: t.value })}>
                  {(c.thinking || 'standard') === t.value && <Check size={13} />} {t.label}
                </button>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              {THINKING.find((t) => t.value === (c.thinking || 'standard')).desc} Uses the model's reasoning mode where it has one (Gemini 2.5/3, Claude, OpenAI o-series/GPT-5, Ollama thinking models like gpt-oss, qwen3, deepseek-r1); other models answer normally.
            </div>
          </div>
        )}
        <div className="form-grid">
          <div className="field"><label className="label">Your name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field">
            <label className="label">Tone</label>
            <select className="select" value={c.tone} onChange={(e) => setC({ ...c, tone: e.target.value })}>
              {['Direct', 'Encouraging', 'Analytical', 'Tough love'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="field"><label className="label">Request limit</label><input className="input" type="number" value={c.requestsLimit} onChange={(e) => setC({ ...c, requestsLimit: Number(e.target.value) || 0 })} /></div>
          <div className="field">
            <label className="label">Requests used</label>
            <div className="row gap8"><input className="input" readOnly value={c.requestsUsed} /><button className="btn" onClick={() => setC({ ...c, requestsUsed: 0 })}>Reset</button></div>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn white" onClick={async () => { save(await vaultKeys(c), name); onClose(); }}><Check size={15} /> Save</button>
      </div>
    </Modal>
  );
}
