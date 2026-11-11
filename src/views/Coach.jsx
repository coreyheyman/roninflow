import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Search, SquarePen, PanelLeftClose, PanelLeft, MessageCircle, Settings, Database, ChevronDown, ImagePlus, Mic, ArrowUp, Lightbulb, Plus, ChevronLeft, ChevronRight, Trash, X } from 'lucide-react';
import { useStore, navigate } from '../store/store';
import { Modal, ModalHead, Popover, useToast, fileToDataUrl } from '../components/ui';
import { CoachLogo } from '../components/Layout';
import { takePendingAsk } from '../lib/askCoach';
import { localAnswer, askAI, buildContext } from '../lib/coach';
import { PROVIDERS, providerConfig } from '../lib/ai';
import CoachSettings from '../components/CoachSettings';
import { uid, inRange, datePresets } from '../lib/stats';

export function Markdown({ text }) {
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>));
  const blocks = [];
  let list = null;
  text.split('\n').forEach((line, i) => {
    if (/^\s*[-*•]\s+/.test(line)) {
      if (!list) { list = []; blocks.push({ list }); }
      list.push(line.replace(/^\s*[-*•]\s+/, ''));
    } else {
      list = null;
      if (line.trim()) blocks.push({ p: line.replace(/^#+\s*/, ''), i });
    }
  });
  return (
    <div className="md">
      {blocks.map((b, i) => (b.list ? <ul key={i}>{b.list.map((l, j) => <li key={j}>{inline(l)}</li>)}</ul> : <p key={i}>{inline(b.p)}</p>))}
    </div>
  );
}

/** Shared chat logic used by the full page and the floating mini coach. */
function useCoach() {
  const store = useStore();
  const { state, setChats, setSetting } = store;
  const [ctx, setCtx] = useState({ account: 'current', range: 'All time' });
  const [busy, setBusy] = useState(false);
  const scopeTrades = useMemo(() => {
    const acc = ctx.account === 'current' ? state.settings.account : ctx.account;
    const hidden = state.settings.hideBreached ? new Set(state.accounts.filter((a) => a.status === 'Breached').map((a) => a.id)) : null;
    let list = acc === 'all' ? state.trades.filter((t) => !hidden?.has(t.accountId)) : state.trades.filter((t) => t.accountId === acc);
    const p = datePresets().find((x) => x.label === ctx.range);
    if (p) list = list.filter((t) => inRange(t, p));
    return list;
  }, [state.trades, state.accounts, state.settings.account, state.settings.hideBreached, ctx]);

  /** onOpen(id) is called as soon as a new chat exists, so the view can switch to it before the answer arrives. */
  const send = async (chatId, question, image, onOpen, opts = {}) => {
    const coach = state.settings.coach;
    if (coach.requestsUsed >= coach.requestsLimit) return { error: 'You have used all your requests. Raise the limit in Customization Settings.' };
    let id = chatId;
    const userMsg = { role: 'user', content: question, image };
    if (!id) {
      id = uid('chat');
      setChats((c) => [{ id, title: opts.title || question.slice(0, 60), createdAt: new Date().toISOString(), ...(opts.focus ? { focus: opts.focus } : {}), messages: [userMsg] }, ...c]);
      onOpen?.(id);
    } else {
      setChats((c) => c.map((x) => (x.id === id ? { ...x, messages: [...x.messages, userMsg] } : x)));
    }
    setBusy(true);
    setSetting('coach', (c) => ({ ...c, requestsUsed: c.requestsUsed + 1 }));
    let answer;
    try {
      const provider = coach.provider || 'local';
      if (provider !== 'local') {
        const history = (state.chats.find((x) => x.id === id)?.messages || []).slice(-10).map(({ role, content }) => ({ role, content }));
        // chats opened from a Coach Review keep that day's / period's detailed data
        const focus = state.chats.find((x) => x.id === id)?.focus || opts.focus;
        const context = focus ? { ...buildContext(state, scopeTrades), reviewFocus: focus } : buildContext(state, scopeTrades);
        answer = await askAI({ provider, cfg: providerConfig(coach, provider), tone: coach.tone, name: state.user.name, question, history, context, image, thinking: coach.thinking || 'standard' });
        if (!answer?.trim()) throw new Error('The model returned an empty answer.');
      } else {
        await new Promise((r) => setTimeout(r, 650));
        answer = localAnswer(question, state, scopeTrades);
      }
    } catch (e) {
      answer = `I couldn't get an answer from ${PROVIDERS[coach.provider]?.label || 'the AI provider'}: ${e.message}\n\nHere's what your data says locally:\n\n${localAnswer(question, state, scopeTrades)}`;
    }
    setChats((c) => c.map((x) => (x.id === id ? { ...x, messages: [...x.messages, { role: 'assistant', content: answer }] } : x)));
    setBusy(false);
    return { id };
  };
  return { state, ctx, setCtx, busy, send, scopeTrades };
}

function Composer({ onSend, busy, ctx, setCtx, compact = false, draft = null }) {
  const { state } = useStore();
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const taRef = useRef(null);
  // a chart handed over from "Ask coach about this chart"
  useEffect(() => {
    if (!draft) return;
    setText(draft.text || ''); setImage(draft.image || null);
    setTimeout(() => { const el = taRef.current || document.querySelector('.composer textarea'); el?.focus(); el?.setSelectionRange?.(el.value.length, el.value.length); }, 50);
  }, [draft]);
  const noVision = image && (state.settings.coach.provider || 'local') === 'local';
  const [listening, setListening] = useState(false);
  const fileRef = useRef(null);
  const toast = useToast();
  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text.trim(), image);
    setText('');
    setImage(null);
  };
  const mic = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Voice input is not supported in this browser'); return; }
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = false;
    r.onresult = (e) => setText((t) => (t ? t + ' ' : '') + e.results[0][0].transcript);
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };
  return (
    <div className="composer" style={compact ? { padding: '10px 10px 8px 14px' } : undefined}>
      {image && (
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}>
          <img src={image} alt="" style={{ height: 60, border: '1px solid var(--border-2)' }} />
          <button className="close-x" style={{ position: 'absolute', top: -6, right: -6 }} onClick={() => setImage(null)}><X size={11} /></button>
        </div>
      )}
      {noVision && <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>No AI provider is set up, so the coach can't look at the image. Choose OpenAI, Gemini or Claude in Customization Settings.</div>}
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        placeholder="Ask your Trading Coach about your trading"
        style={compact ? { minHeight: 44 } : undefined}
      />
      <div className="row gap12">
        {!compact && (
          <Popover
            up
            width={260}
            trigger={({ toggle }) => (
              <button className="row gap8 muted" onClick={toggle} style={{ fontSize: 15 }}><Database size={18} /> Context <ChevronDown size={14} /></button>
            )}
          >
            <div className="col gap8" style={{ padding: 8 }}>
              <div className="field">
                <label className="label">Account</label>
                <select className="select" style={{ height: 34 }} value={ctx.account} onChange={(e) => setCtx({ ...ctx, account: e.target.value })}>
                  <option value="current">Selected account</option>
                  <option value="all">All accounts</option>
                  {state.accounts.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label">Period</label>
                <select className="select" style={{ height: 34 }} value={ctx.range} onChange={(e) => setCtx({ ...ctx, range: e.target.value })}>
                  {datePresets().map((p) => <option key={p.label}>{p.label}</option>)}
                </select>
              </div>
            </div>
          </Popover>
        )}
        <div className="grow" />
        {!compact && (
          <>
            <button className="icon-btn" title="Attach image" onClick={() => fileRef.current?.click()}><ImagePlus size={20} /></button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImage(await fileToDataUrl(f, 1200)); e.target.value = ''; }} />
            <button className={`icon-btn ${listening ? 'active' : ''}`} title="Voice input" onClick={mic}><Mic size={20} /></button>
          </>
        )}
        <button className="send-btn" style={compact ? { width: 34, height: 34 } : undefined} disabled={!text.trim() || busy} onClick={submit}><ArrowUp size={20} /></button>
      </div>
    </div>
  );
}

function Thread({ chat, busy }) {
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat?.messages.length, busy]);
  return (
    <>
      {chat.messages.map((msg, i) => (
        <div key={i} className={`msg ${msg.role}`}>
          {msg.role === 'assistant' ? (
            <>
              <div className="mini-logo"><CoachLogo size={30} icon={15} /></div>
              <div className="grow"><Markdown text={msg.content} /></div>
            </>
          ) : (
            <div className="bubble">
              {msg.image && <img src={msg.image} alt="" style={{ maxWidth: 220, display: 'block', marginBottom: 8 }} />}
              {msg.content}
            </div>
          )}
        </div>
      ))}
      {busy && (
        <div className="msg"><div className="mini-logo"><CoachLogo size={30} icon={15} /></div><div className="row gap8" style={{ paddingTop: 10, alignItems: 'center' }}><div className="typing"><span /><span /><span /></div><span className="muted" style={{ fontSize: 13 }}>Thinking it through…</span></div></div>
      )}
      <div ref={end} />
    </>
  );
}

export default function Coach({ sub }) {
  const { state, ctx, setCtx, busy, send } = useCoach();
  const { setChats, setTemplates, setSetting, update } = useStore();
  const [chatId, setChatId] = useState(null);
  const [q, setQ] = useState('');
  const [sideOpen, setSideOpen] = useState(true);
  const [mobileSide, setMobileSide] = useState(false);
  const [tplPage, setTplPage] = useState(0);
  const [addTpl, setAddTpl] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(sub === 'settings');
  // "Chat more with the coach" from a Coach Review opens #/coach?chat=<id>;
  // "Ask coach about this chart" opens #/coach?ask=1 with the image waiting in the message box
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split('?')[1] || '');
    if (q.get('chat')) { setChatId(q.get('chat')); navigate('coach'); }
    if (q.get('ask')) { const p = takePendingAsk(); if (p) { setChatId(null); setDraft(p); } navigate('coach'); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const coach = state.settings.coach;
  const chat = state.chats.find((c) => c.id === chatId);
  const first = state.user.name.split(' ')[0];
  const pages = Math.max(1, Math.ceil(state.templates.length / 4));
  const tpls = state.templates.slice(tplPage * 4, tplPage * 4 + 4);
  const chats = state.chats.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
  const go = (text, image) => {
    const opts = !chatId && draft ? { focus: draft.focus, title: draft.title } : {};
    if (!chatId) setDraft(null);
    return send(chatId, text, image, setChatId, opts);
  };

  useEffect(() => { if (sub === 'settings') setSettingsOpen(true); }, [sub]);

  return (
    <>
      <div className="coach-bar">
        <button className="icon-btn cb-chats" onClick={() => setMobileSide(true)} title="Chats"><PanelLeft size={17} /></button>
        <b style={{ fontWeight: 500 }}>Trading Coach</b>
        <span className="muted cb-powered" style={{ fontSize: 12.5 }}>Powered by your trading data{coach.provider && coach.provider !== 'local' ? ` + ${PROVIDERS[coach.provider]?.short} · ${providerConfig(coach, coach.provider).model}` : ''}.</span>
        <div className="grow" />
        <MessageCircle size={17} className="accent" />
        <span className="cb-req-label" style={{ fontSize: 15 }}>Requests</span>
        <div className="progress cb-progress" style={{ width: 186 }}><i style={{ width: `${Math.min(100, (coach.requestsUsed / coach.requestsLimit) * 100)}%` }} /></div>
        <span style={{ fontSize: 15 }}>{coach.requestsUsed}<span className="muted">/{coach.requestsLimit}</span></span>
        <div className="sep-v cb-sep" style={{ margin: '14px 10px' }} />
        <button className="row gap8" onClick={() => setSettingsOpen(true)} title="Customization Settings"><Settings size={18} /> <span className="cb-settings-label">Customization Settings</span></button>
      </div>
      <div className="coach" style={!sideOpen ? { gridTemplateColumns: '0 1fr' } : undefined}>
        {mobileSide && <div className="overlay coach-side-scrim" onMouseDown={() => setMobileSide(false)} />}
        <div className={`coach-side ${mobileSide ? 'mobile-open' : ''}`} style={!sideOpen && !mobileSide ? { padding: 0, border: 0, overflow: 'hidden' } : undefined} onClick={(e) => { if (e.target.closest('.it')) setMobileSide(false); }}>
          <div className="row gap8" style={{ padding: '0 8px 6px' }}>
            <Search size={15} className="muted" />
            <input className="grow" style={{ background: 'transparent', border: 0, outline: 'none', fontSize: 14 }} placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => setSideOpen(false)}><PanelLeftClose size={16} /></button>
          </div>
          <div className="it" onClick={() => setChatId(null)}><SquarePen size={16} /> New chat</div>
          <div className="muted" style={{ fontSize: 11, letterSpacing: '0.06em', padding: '18px 8px 8px', fontWeight: 500 }}>RECENT CHATS</div>
          {chats.length === 0 && <div style={{ padding: '4px 8px', fontSize: 14 }} className="muted">No chats yet</div>}
          {chats.map((c) => (
            <div key={c.id} className={`it ${c.id === chatId ? 'on' : ''}`} onClick={() => setChatId(c.id)}>
              <span className="grow truncate">{c.title}</span>
              <button className="muted" onClick={(e) => { e.stopPropagation(); setChats((l) => l.filter((x) => x.id !== c.id)); if (chatId === c.id) setChatId(null); }}><Trash size={13} /></button>
            </div>
          ))}
        </div>
        <div className="coach-main">
          {!sideOpen && <button className="icon-btn" style={{ position: 'absolute', margin: 10 }} onClick={() => setSideOpen(true)}><PanelLeft size={16} /></button>}
          {!chat ? (
            <div className="col coach-welcome" style={{ alignItems: 'center', padding: '48px 24px', maxWidth: 968, width: '100%', margin: '0 auto' }}>
              <CoachLogo />
              <h1 className="coach-hi" style={{ fontSize: 31, fontWeight: 500, letterSpacing: '-0.03em', margin: '48px 0 42px' }}>Hey {first}, I'm your Trading Coach</h1>
              <Composer onSend={go} busy={busy} ctx={ctx} setCtx={setCtx} draft={draft} />
              <div className="row between coach-tpl-head" style={{ width: '100%', margin: '64px 0 18px' }}>
                <div className="row gap16"><b style={{ fontWeight: 500, fontSize: 15.5 }}>My Templates</b><button onClick={() => setAddTpl('')}><Plus size={18} /></button></div>
                <div className="row gap12">
                  <button className="muted" onClick={() => setTplPage((p) => (p - 1 + pages) % pages)}><ChevronLeft size={16} /></button>
                  {Array.from({ length: pages }).map((_, i) => <span key={i} onClick={() => setTplPage(i)} style={{ width: 5, height: 5, borderRadius: '50%', background: i === tplPage ? 'var(--fg)' : 'var(--muted-2)', cursor: 'pointer' }} />)}
                  <button onClick={() => setTplPage((p) => (p + 1) % pages)}><ChevronRight size={16} /></button>
                </div>
              </div>
              <div className="tpl-grid">
                {tpls.map((t) => (
                  <div key={t} style={{ position: 'relative' }} className="tpl-wrap">
                    <button className="tpl-card" style={{ width: '100%' }} onClick={() => go(t)}>
                      <Lightbulb size={20} className="accent" />
                      <span>{t}</span>
                    </button>
                    <button className="muted" title="Remove template" style={{ position: 'absolute', top: 10, right: 10 }} onClick={() => setTemplates((l) => l.filter((x) => x !== t))}><X size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="coach-thread" style={{ flex: 1, padding: '24px 24px 0' }}><Thread chat={chat} busy={busy} /></div>
              <div className="coach-compose-dock" style={{ position: 'sticky', bottom: 0, padding: '12px 24px 24px', background: 'var(--bg)' }}>
                <div style={{ maxWidth: 820, margin: '0 auto' }}><Composer onSend={go} busy={busy} ctx={ctx} setCtx={setCtx} /></div>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal open={addTpl !== null} onClose={() => setAddTpl(null)} width={480}>
        <ModalHead title="New template" onClose={() => setAddTpl(null)} />
        <div className="modal-body"><input className="input" autoFocus value={addTpl || ''} onChange={(e) => setAddTpl(e.target.value)} placeholder="e.g. How do I trade after a losing streak?" /></div>
        <div className="modal-foot">
          <button className="btn" onClick={() => setAddTpl(null)}>Cancel</button>
          <button className="btn white" disabled={!addTpl?.trim()} onClick={() => { setTemplates((l) => [addTpl.trim(), ...l]); setAddTpl(null); setTplPage(0); }}>Save template</button>
        </div>
      </Modal>
      <CoachSettings open={settingsOpen} onClose={() => { setSettingsOpen(false); if (sub === 'settings') navigate('coach'); }} coach={coach} save={(c, name) => { setSetting('coach', c); update((s) => ({ ...s, user: { ...s.user, name } })); }} name={state.user.name} />
    </>
  );
}

export function MiniCoach({ onClose }) {
  const { state, ctx, setCtx, busy, send } = useCoach();
  const [chatId, setChatId] = useState(null);
  const chat = state.chats.find((c) => c.id === chatId);
  const go = (text) => send(chatId, text, undefined, setChatId);
  const tpl = state.templates.slice(0, 2);
  return (
    <div className="modal mini-coach" style={{ position: 'fixed', right: 26, bottom: 104, width: 400, height: 560, zIndex: 31, display: 'flex', flexDirection: 'column' }}>
      <div className="row gap8" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
        <button className="btn xs" onClick={() => setChatId(null)}><SquarePen size={13} /> New chat</button>
        <div className="grow" />
        <button className="btn xs" onClick={() => { onClose(); navigate('coach'); }}>Open full coach</button>
        <button className="icon-btn" onClick={onClose}><X size={15} /></button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 14px' }}>
        {!chat ? (
          <div className="col" style={{ alignItems: 'center', paddingTop: 36, gap: 18 }}>
            <CoachLogo size={64} icon={28} />
            <div style={{ fontSize: 18, fontWeight: 500, textAlign: 'center' }}>Hey {state.user.name.split(' ')[0]}, I'm your Trading Coach</div>
            <div className="col gap8" style={{ width: '100%' }}>
              {tpl.map((t) => <button key={t} className="tpl-card" style={{ minHeight: 0, padding: 14, flexDirection: 'row', gap: 10, justifyContent: 'flex-start', alignItems: 'center', fontSize: 13.5 }} onClick={() => go(t)}><Lightbulb size={15} className="accent" /> {t}</button>)}
            </div>
          </div>
        ) : <div style={{ fontSize: 13 }}><Thread chat={chat} busy={busy} /></div>}
      </div>
      <div style={{ padding: 12 }}><Composer onSend={go} busy={busy} ctx={ctx} setCtx={setCtx} compact /></div>
    </div>
  );
}
