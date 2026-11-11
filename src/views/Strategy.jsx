import { useMemo, useState } from 'react';
import { Settings, LayoutGrid, List, Plus, ChevronDown, ChevronLeft, ChevronRight, X, Trash, Pencil, ArrowLeft, ImagePlus, Check, Target, Link as LinkIcon } from 'lucide-react';
import { useStore, navigate, useAccountTrades } from '../store/store';
import { RegimeCards, PlaybookSettings } from '../components/Playbook';
import { playbookOf, regimeStats } from '../lib/playbook';
import { groupByDay, keyOf } from '../lib/stats';
import { Seg, Modal, Popover, Money, Confirm, useToast, fileToDataUrl, CloseX } from '../components/ui';
import { PnlChart } from '../components/Charts';
import { TradeDrawer } from '../components/TradeForms';
import RichText from '../components/RichText';
import { summarize, equityCurve, fmtDate, fmtTime12, pfText, sortByEntry } from '../lib/stats';

const CATEGORIES = ['Scalping', 'Day trading', 'Swing trading', 'Breakout', 'Reversal', 'Trend following', 'Mean reversion', 'Momentum', 'Opening range', 'Other'];
const TIMEFRAMES = ['15s', '1m', '2m', '3m', '5m', '15m', '30m', '1h', '4h', 'Daily'];
const CONDITIONS = ['Trending', 'Ranging', 'High volatility', 'Low volatility', 'News driven', 'Opening drive', 'Gap up', 'Gap down'];
const STRAT_TAGS = ['Futures', 'Indices', 'NY session', 'London session', 'Price action', 'Order flow', 'VWAP', 'Supply/Demand', 'ICT', 'Volume profile'];

const blank = () => ({ name: '', category: '', description: '', tags: [], timeframes: [], conditions: [], rr: '', entryRules: [], exitRules: [], riskRules: [], media: [], links: [], notes: '' });

function MultiSelect({ placeholder, options, value, onChange, allowCustom }) {
  const [txt, setTxt] = useState('');
  return (
    <Popover
      width="100%"
      block
      trigger={({ toggle }) => (
        <button type="button" className="input row between" onClick={toggle} style={{ textAlign: 'left', width: '100%', minHeight: 40, height: 'auto', padding: '6px 12px' }}>
          <span className="row gap6 wrap">
            {value.length ? value.map((v) => (
              <span key={v} className="chip" style={{ padding: '2px 7px' }}>{v}<span onClick={(e) => { e.stopPropagation(); onChange(value.filter((x) => x !== v)); }} className="muted" style={{ display: 'grid', cursor: 'pointer' }}><X size={11} /></span></span>
            )) : <span className="muted2">{placeholder}</span>}
          </span>
          <ChevronDown size={14} className="muted" />
        </button>
      )}
    >
      <div style={{ maxHeight: 240, overflow: 'auto' }}>
        {[...new Set([...options, ...value])].map((o) => (
          <button key={o} type="button" className={`pop-item ${value.includes(o) ? 'on' : ''}`} onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}>
            <span style={{ width: 14 }}>{value.includes(o) && <Check size={14} />}</span>{o}
          </button>
        ))}
      </div>
      {allowCustom && (
        <form className="row gap6" style={{ padding: 6, borderTop: '1px solid var(--border)' }} onSubmit={(e) => { e.preventDefault(); if (txt.trim() && !value.includes(txt.trim())) onChange([...value, txt.trim()]); setTxt(''); }}>
          <input className="input" style={{ height: 30 }} placeholder="Add your own…" value={txt} onChange={(e) => setTxt(e.target.value)} />
          <button className="btn xs" type="submit"><Plus size={13} /></button>
        </form>
      )}
    </Popover>
  );
}

function RuleList({ title, hint, value, onChange }) {
  const [txt, setTxt] = useState('');
  const add = () => { if (txt.trim()) { onChange([...value, txt.trim()]); setTxt(''); } };
  return (
    <div style={{ marginBottom: 26 }}>
      <div className="sec-title">{title}</div>
      {value.map((r, i) => (
        <div key={i} className="rule">
          <span className="muted" style={{ width: 18, fontSize: 12 }}>{i + 1}.</span>
          <input className="grow" style={{ background: 'transparent', border: 0, outline: 'none' }} value={r} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          <button className="muted" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash size={13} /></button>
        </div>
      ))}
      <div className="row gap8">
        <input className="input" placeholder={hint} value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn" onClick={add} disabled={!txt.trim()}><Plus size={15} /> Add</button>
      </div>
    </div>
  );
}

export function StrategyWizard({ open, onClose, initial }) {
  const { state, saveStrategy } = useStore();
  const condOptions = [...new Set([...playbookOf(state).regimes.map((r) => r.name).filter(Boolean), ...CONDITIONS])];
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [s, setS] = useState(blank);
  const [cond, setCond] = useState('');
  const [link, setLink] = useState('');
  const [was, setWas] = useState(open);
  if (was !== open) { setWas(open); if (open) { setStep(0); setS(initial ? { ...blank(), ...initial } : blank()); } }
  const set = (k) => (v) => setS((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const canNext = step === 0 ? s.name.trim() && s.category : true;
  const STEPS = [['The Basics', 'Name, tags, parameters'], ['The Rules Engine', 'Entry and exit rules'], ['Media & Education', 'Screenshots and notes']];
  const finish = () => { saveStrategy(s); toast(initial ? 'Strategy updated' : 'Strategy created'); onClose(); };

  return (
    <Modal open={open} onClose={onClose} width={1080} className="">
      <div className="wizard">
        <aside>
          <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.03em' }}>{initial ? 'Edit strategy' : 'Create a new strategy'}</div>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>Define your trading strategy</div>
          <div className="steps">
            {STEPS.map(([t, sub], i) => (
              <div key={t} className={`step ${i === step ? 'on' : i < step ? 'done' : ''}`} onClick={() => (i < step || canNext) && setStep(i)}>
                <div className="n">{i < step ? <Check size={14} /> : i + 1}</div>
                <div><div className="t">{t}</div><div className="s">{sub}</div></div>
              </div>
            ))}
          </div>
        </aside>
        <main>
          <div style={{ position: 'absolute', right: 18, top: 18, zIndex: 2 }}><CloseX onClick={onClose} /></div>
          <div className="scroll">
            {step === 0 && (
              <>
                <div className="sec-title">Basic Information</div>
                <div className="col gap16">
                  <div className="field"><label className="label">Strategy name</label><input className="input" placeholder="Insert name" value={s.name} onChange={set('name')} /></div>
                  <div className="field">
                    <label className="label">Strategy category</label>
                    <select className="select" value={s.category} onChange={set('category')}>
                      <option value="">Choose type</option>
                      {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="field"><label className="label">Description</label>
                    <RichText boxed docKey={`desc-${open}-${initial?.id}`} value={s.description} onChange={set('description')} placeholder="Add strategy description, notes, observations..." minHeight={220} />
                  </div>
                </div>
                <div className="sec-title" style={{ marginTop: 30 }}>Tags</div>
                <MultiSelect placeholder="Add tag" options={STRAT_TAGS} value={s.tags} onChange={set('tags')} allowCustom />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 30 }}>
                  <div style={{ gridColumn: 'span 2' }}>
                    <div className="sec-title">Trading Parameters</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div className="field"><label className="label">Timeframe</label><MultiSelect placeholder="Add timeframe" options={TIMEFRAMES} value={s.timeframes} onChange={set('timeframes')} /></div>
                      <div className="field">
                        <label className="label">Market conditions</label>
                        <MultiSelect placeholder="Add condition" options={condOptions} value={s.conditions} onChange={set('conditions')} />
                        <div className="row gap6" style={{ marginTop: 8 }}>
                          <input className="input" placeholder="Your own condition..." value={cond} onChange={(e) => setCond(e.target.value)} />
                          <button className="btn" style={{ width: 40, padding: 0 }} disabled={!cond.trim()} onClick={() => { set('conditions')([...s.conditions, cond.trim()]); setCond(''); }}><Plus size={14} /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="sec-title">Risk reward Ratio</div>
                    <div className="field"><label className="label">Ratio</label><input className="input" placeholder="e.g. 1:2" value={s.rr} onChange={set('rr')} /></div>
                  </div>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <div className="muted" style={{ marginBottom: 22, fontSize: 13.5 }}>Rules become a pre-trade checklist on the strategy page. Keep each one specific and verifiable.</div>
                <RuleList title="Entry rules" hint="e.g. Price reclaims VWAP with volume above 20-bar average" value={s.entryRules} onChange={set('entryRules')} />
                <RuleList title="Exit rules" hint="e.g. Take 50% at 1R, trail the rest under the last swing low" value={s.exitRules} onChange={set('exitRules')} />
                <RuleList title="Risk management" hint="e.g. Max 2 contracts, stop no wider than 8 points" value={s.riskRules} onChange={set('riskRules')} />
              </>
            )}
            {step === 2 && (
              <>
                <div className="sec-title">Example screenshots</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 26 }}>
                  {s.media.map((m, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img src={m} alt="" style={{ width: '100%', aspectRatio: '16/10', objectFit: 'cover', border: '1px solid var(--border-2)', display: 'block' }} />
                      <button className="close-x" style={{ position: 'absolute', top: 6, right: 6 }} onClick={() => set('media')(s.media.filter((_, j) => j !== i))}><X size={11} /></button>
                    </div>
                  ))}
                  <label className="btn" style={{ aspectRatio: '16/10', height: 'auto', flexDirection: 'column', borderStyle: 'dashed', cursor: 'pointer' }}>
                    <ImagePlus size={22} /> Upload images
                    <input type="file" accept="image/*" multiple hidden onChange={async (e) => { const urls = await Promise.all([...e.target.files].map((f) => fileToDataUrl(f))); set('media')([...s.media, ...urls]); e.target.value = ''; }} />
                  </label>
                </div>
                <div className="sec-title">Education links</div>
                {s.links.map((l, i) => (
                  <div key={i} className="rule"><LinkIcon size={14} className="muted" /><a href={l} target="_blank" rel="noreferrer" className="grow truncate" style={{ color: 'var(--primary)' }}>{l}</a><button className="muted" onClick={() => set('links')(s.links.filter((_, j) => j !== i))}><Trash size={13} /></button></div>
                ))}
                <div className="row gap8" style={{ marginBottom: 26 }}>
                  <input className="input" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
                  <button className="btn" disabled={!link.trim()} onClick={() => { set('links')([...s.links, link.trim()]); setLink(''); }}><Plus size={15} /> Add</button>
                </div>
                <div className="sec-title">Notes</div>
                <RichText boxed docKey={`notes-${open}-${initial?.id}`} value={s.notes} onChange={set('notes')} placeholder="Lessons, variations, what invalidates the setup…" minHeight={160} />
              </>
            )}
          </div>
          <div className="row between" style={{ padding: '18px 32px', borderTop: '1px solid var(--border)' }}>
            <button className="btn" onClick={() => (step ? setStep(step - 1) : onClose())}><ChevronLeft size={15} /> Go back</button>
            {step < 2 ? (
              <button className="btn" style={{ background: canNext ? 'var(--white-btn-bg)' : 'var(--card-3)', color: canNext ? 'var(--white-btn-fg)' : 'var(--muted)', minWidth: 130 }} disabled={!canNext} onClick={() => setStep(step + 1)}>Continue <ChevronRight size={15} /></button>
            ) : (
              <button className="btn primary" style={{ minWidth: 150 }} onClick={finish}><Check size={15} /> {initial ? 'Save strategy' : 'Create strategy'}</button>
            )}
          </div>
        </main>
      </div>
    </Modal>
  );
}

export default function Strategy({ sub }) {
  if (sub) return <StrategyDetail id={sub} />;
  return <StrategyIndex />;
}

function StrategyIndex() {
  const [tab, setTabState] = useState(() => ((window.location.hash.split('?')[1] || '').includes('tab=conditions') ? 'conditions' : 'strategies'));
  const setTab = (t) => { setTabState(t); try { window.history.replaceState(null, '', t === 'conditions' ? '#/strategy?tab=conditions' : '#/strategy'); } catch { /* ignore */ } };
  return (
    <div className="page">
      <div className="row page-head-row" style={{ marginBottom: 18 }}>
        <div className="page-title" style={{ margin: 0 }}>Strategy</div>
        <div className="grow" />
        <Seg value={tab} onChange={setTab} options={[{ value: 'strategies', label: 'Trading strategies' }, { value: 'conditions', label: 'Market conditions' }]} />
      </div>
      {tab === 'conditions' ? <MarketConditions /> : <Strategies />}
    </div>
  );
}

const LOOKBACKS = [{ value: 30, label: '30 days' }, { value: 90, label: '90 days' }, { value: 365, label: '1 year' }, { value: 100000, label: 'All time' }];

/** How you perform in each market condition you log on your sessions. */
function MarketConditions() {
  const { state } = useStore();
  const trades = useAccountTrades();
  const pb = playbookOf(state);
  const [lookback, setLookback] = useState(90);
  const [edit, setEdit] = useState(false);
  const stats = useMemo(() => regimeStats(trades, state.diary, pb.regimes, lookback), [trades, state.diary, pb.regimes, lookback]);
  const untagged = useMemo(() => {
    const from = lookback >= 100000 ? '' : keyOf(new Date(Date.now() - lookback * 86400e3));
    const ids = new Set(pb.regimes.map((r) => r.id));
    const ds = groupByDay(trades).filter((d) => d.date >= from && !ids.has(state.diary[d.date]?.pre?.regime));
    return { days: ds.length, net: ds.reduce((a, d) => a + d.net, 0) };
  }, [trades, state.diary, pb.regimes, lookback]);
  const best = [...stats].filter((r) => r.days >= 3).sort((a, b) => b.ev - a.ev)[0];
  const worst = [...stats].filter((r) => r.days >= 3).sort((a, b) => a.ev - b.ev)[0];
  return (
    <div className="col gap16">
      <div className="toolbar">
        <Seg value={lookback} onChange={setLookback} options={LOOKBACKS} />
        <div className="grow" />
        <button className="btn" onClick={() => setEdit(true)}><Settings size={15} /> Edit market conditions</button>
      </div>
      {pb.regimes.length === 0 ? (
        <div className="panel empty">
          <div style={{ color: 'var(--fg)', fontSize: 16, fontWeight: 500 }}>No market conditions set up</div>
          <div style={{ maxWidth: 440 }}>Add the kinds of market you trade in (trending, range-bound, news…). Pick one on each session and this page shows where your edge is.</div>
          <button className="btn white" onClick={() => setEdit(true)}><Plus size={15} /> Add market conditions</button>
        </div>
      ) : (
        <>
          {(best || worst) && best !== worst && (
            <div className="panel" style={{ padding: '14px 18px', fontSize: 13.5 }}>
              {best && <span>Your best conditions: <b className="pos">{best.name}</b> </span>}
              {worst && worst.ev < 0 && <span className="muted"> · consider sitting out <b className="neg">{worst.name}</b> or trading it smaller.</span>}
            </div>
          )}
          <RegimeCards trades={trades} lookback={lookback} caption={LOOKBACKS.find((l) => l.value === lookback)?.label} />
          <div className="muted" style={{ fontSize: 12.5 }}>
            {untagged.days > 0 ? `${untagged.days} trading day${untagged.days === 1 ? '' : 's'} in this period had no market condition logged — set it in the pre-session check-in or on the day page.` : 'Every trading day in this period has a market condition logged.'}
          </div>
        </>
      )}
      <PlaybookSettings open={edit} initialTab="regimes" onClose={() => setEdit(false)} />
    </div>
  );
}

function Strategies() {
  const { state, setSetting } = useStore();
  const [view, setView] = useState('grid');
  const [cat, setCat] = useState('');
  const [open, setOpen] = useState(false);
  const tourDone = state.settings.strategyTourDone;
  const list = state.strategies.filter((s) => !cat || s.category === cat);
  const stats = (id) => summarize(state.trades.filter((t) => t.strategyId === id));
  return (
    <div>
      <div className="row page-head-row" style={{ marginBottom: 18 }}>
        <div className="grow" />
        <div className="row gap12 page-head-tools">
          <Popover align="right" trigger={({ toggle }) => <button className="btn" onClick={toggle}>{cat || 'Filters'} <ChevronDown size={14} /></button>}>
            {(close) => ['', ...CATEGORIES].map((c) => <button key={c} className={`pop-item ${cat === c ? 'on' : ''}`} onClick={() => { setCat(c); close(); }}>{c || 'All categories'}</button>)}
          </Popover>
          <div className="sep-v" />
          <Seg value={view} onChange={setView} options={[{ value: 'grid', label: 'Grid', icon: LayoutGrid }, { value: 'list', label: 'List', icon: List }]} />
          <div className="sep-v" />
          <div style={{ position: 'relative' }}>
            <button className="btn white" onClick={() => setOpen(true)}>Add Strategy <Plus size={17} /></button>
            {!tourDone && state.strategies.length === 0 && (
              <div className="pop tour-pop" style={{ right: 0, top: 'calc(100% + 10px)', width: 280, padding: 16 }}>
                <div className="row between"><b style={{ fontWeight: 600 }}>Add strategy</b><span className="muted" style={{ fontSize: 12 }}>1/3</span></div>
                <div className="muted" style={{ fontSize: 13, margin: '8px 0 14px' }}>Rules, examples, and a checklist in one place.</div>
                <div className="row between">
                  <button className="btn xs ghost" onClick={() => setSetting('strategyTourDone', true)}>Skip</button>
                  <button className="btn xs white" onClick={() => { setSetting('strategyTourDone', true); setOpen(true); }}>Next</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty" style={{ minHeight: '55vh' }}>
          <Target size={34} className="muted2" />
          <div style={{ color: 'var(--fg)', fontSize: 17, fontWeight: 500 }}>No strategies yet</div>
          <button className="btn" onClick={() => setOpen(true)}>Create your first strategy</button>
        </div>
      ) : view === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 18 }}>
          {list.map((s) => {
            const st = stats(s.id);
            return (
              <div key={s.id} className="strat-card" onClick={() => navigate(`strategy/${s.id}`)}>
                {s.media[0] && <img src={s.media[0]} alt="" style={{ width: '100%', aspectRatio: '16/8', objectFit: 'cover', border: '1px solid var(--border)' }} />}
                <div className="row between"><b style={{ fontWeight: 600, fontSize: 16 }}>{s.name}</b><span className="badge neutral">{s.category}</span></div>
                <div className="row gap6 wrap">{[...s.timeframes, ...s.tags].slice(0, 5).map((t) => <span key={t} className="chip" style={{ padding: '2px 7px' }}>{t}</span>)}</div>
                <div className="row gap24" style={{ fontSize: 13 }}>
                  <div><div className="muted">Net P&L</div><Money v={st.net} colored /></div>
                  <div><div className="muted">Win rate</div>{st.count ? `${Math.round(st.winRate)}%` : '—'}</div>
                  <div><div className="muted">Trades</div>{st.count}</div>
                  <div><div className="muted">R:R</div>{s.rr || '—'}</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>{['Name', 'Category', 'Timeframes', 'R:R', 'Trades', 'Win rate', 'Net P&L'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {list.map((s) => { const st = stats(s.id); return (
                <tr key={s.id} onClick={() => navigate(`strategy/${s.id}`)}>
                  <td>{s.name}</td><td>{s.category}</td><td className="muted">{s.timeframes.join(', ') || '—'}</td><td>{s.rr || '—'}</td><td>{st.count}</td><td>{st.count ? `${Math.round(st.winRate)}%` : '—'}</td><td><Money v={st.net} colored /></td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      )}
      <StrategyWizard open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function StrategyDetail({ id }) {
  const { state, deleteStrategy } = useStore();
  const toast = useToast();
  const s = state.strategies.find((x) => x.id === id);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [checked, setChecked] = useState([]);
  const [openT, setOpenT] = useState(null);
  const trades = useMemo(() => state.trades.filter((t) => t.strategyId === id), [state.trades, id]);
  if (!s) return <div className="page empty">Strategy not found. <a href="#/strategy" className="accent">Back to strategies</a></div>;
  const st = summarize(trades);
  const rules = [...s.entryRules.map((r) => ['Entry', r]), ...s.exitRules.map((r) => ['Exit', r]), ...s.riskRules.map((r) => ['Risk', r])];
  return (
    <div className="page">
      <div className="row gap12" style={{ marginBottom: 18 }}>
        <button className="btn sm" onClick={() => navigate('strategy')}><ArrowLeft size={15} /> Strategies</button>
        <div className="grow" />
        <button className="btn sm" onClick={() => setEdit(true)}><Pencil size={14} /> Edit</button>
        <button className="btn sm danger" onClick={() => setDel(true)}><Trash size={14} /> Delete</button>
      </div>
      <div className="row gap12" style={{ marginBottom: 6 }}>
        <div className="page-title" style={{ margin: 0 }}>{s.name}</div>
        <span className="badge neutral">{s.category}</span>
      </div>
      <div className="row gap6 wrap" style={{ marginBottom: 22 }}>
        {[...s.timeframes, ...s.conditions, ...s.tags].map((t) => <span key={t} className="chip">{t}</span>)}
        {s.rr && <span className="chip on">R:R {s.rr}</span>}
      </div>
      <div className="kpis">
        {[['Net P&L', <Money key="m" v={st.net} colored />], ['Win rate', st.count ? `${Math.round(st.winRate)}%` : '—'], ['Profit factor', st.count ? pfText(st.profitFactor) : '—'], ['Trades', st.count]].map(([k, v]) => (
          <div key={k} className="panel"><div className="muted" style={{ fontSize: 13 }}>{k}</div><div style={{ fontSize: 26, fontWeight: 500, marginTop: 10 }}>{v}</div></div>
        ))}
      </div>
      <div className="dash-grid">
        <div className="panel">
          <div className="panel-head"><div className="card-title">Equity</div></div>
          {trades.length ? <PnlChart data={equityCurve(trades).map((c) => ({ label: fmtDate(c.x), y: c.y }))} height={260} /> : <div className="muted">Assign trades to this strategy from the Trading Journal (open a trade → Strategy).</div>}
        </div>
        <div className="panel">
          <div className="panel-head"><div className="card-title">Pre-trade checklist</div>{checked.length > 0 && <button className="btn xs" onClick={() => setChecked([])}>Reset</button>}</div>
          {rules.length === 0 && <div className="muted">No rules defined yet.</div>}
          {rules.map(([k, r], i) => (
            <label key={i} className="check-item" style={{ cursor: 'pointer' }}>
              <input type="checkbox" className="cbx" checked={checked.includes(i)} onChange={() => setChecked((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))} />
              <span className="badge neutral" style={{ width: 46, justifyContent: 'center' }}>{k}</span>
              <span style={{ textDecoration: checked.includes(i) ? 'line-through' : undefined, color: checked.includes(i) ? 'var(--muted)' : undefined }}>{r}</span>
            </label>
          ))}
          {rules.length > 0 && checked.length === rules.length && <div className="badge pos-soft" style={{ marginTop: 14 }}><Check size={13} /> All rules met — setup is valid</div>}
        </div>
      </div>
      {(s.description || s.notes) && (
        <div className="dash-grid">
          {s.description && <div className="panel"><div className="card-title" style={{ marginBottom: 10 }}>Description</div><div className="rte" style={{ padding: 0, minHeight: 0 }} dangerouslySetInnerHTML={{ __html: s.description }} /></div>}
          {s.notes && <div className="panel"><div className="card-title" style={{ marginBottom: 10 }}>Notes</div><div className="rte" style={{ padding: 0, minHeight: 0 }} dangerouslySetInnerHTML={{ __html: s.notes }} /></div>}
        </div>
      )}
      {(s.media.length > 0 || s.links.length > 0) && (
        <div className="panel" style={{ marginBottom: 22 }}>
          <div className="card-title" style={{ marginBottom: 12 }}>Media & Education</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 10 }}>
            {s.media.map((m, i) => <a key={i} href={m} target="_blank" rel="noreferrer"><img src={m} alt="" style={{ width: '100%', border: '1px solid var(--border)' }} /></a>)}
          </div>
          {s.links.map((l) => <a key={l} href={l} target="_blank" rel="noreferrer" className="row gap8 pos" style={{ marginTop: 10 }}><LinkIcon size={14} />{l}</a>)}
        </div>
      )}
      {trades.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>{['Date', 'Time', 'Pair', 'Side', 'Net P&L'].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{sortByEntry(trades).map((t) => (
              <tr key={t.id} className={t.pnl >= 0 ? 'r-win' : 'r-loss'} onClick={() => setOpenT(t)}>
                <td>{fmtDate(t.entry)}</td><td>{fmtTime12(t.entry)}</td><td>{t.symbol}</td><td><span className={`dir ${t.direction}`}>{t.direction}</span></td><td><Money v={t.pnl} colored /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <StrategyWizard open={edit} onClose={() => setEdit(false)} initial={s} />
      <Confirm open={del} title={`Delete “${s.name}”?`} body="Trades linked to this strategy will be kept but unlinked." onCancel={() => setDel(false)} onConfirm={() => { deleteStrategy(id); toast('Strategy deleted'); navigate('strategy'); }} />
      {openT && <TradeDrawer trade={openT} onClose={() => setOpenT(null)} />}
    </div>
  );
}
