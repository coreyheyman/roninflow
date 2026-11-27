import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Minus, Plus, Trash, ShieldCheck, TrendingDown, Lightbulb, Pencil, X } from 'lucide-react';
import { balanceGap } from '../lib/balance';
import { useStore, useAccountTrades, navigate } from '../store/store';
import { Modal, ModalHead, Stars, useToast, Private, Switch, Seg, Popover } from './ui';
import { accountDrawdown, ddTypeLabel } from '../lib/accountDD';
import { DEFAULT_PLAYBOOK, playbookOf, riskOf, defaultRiskOf, suggestRisk, normalIndex, newTier, tierDD, withTierDD, profilesOf, matchingProfiles, DEFAULT_RISK, regimeStats, blockerStats, riskState, lastTomorrowNote, tradeBlockers, daysToRuin } from '../lib/playbook';
import { fmtDate, fmtMoney, fmtTime12, pfText, todayKey, uid } from '../lib/stats';

export const MOODS = ['😫', '😕', '😐', '🙂', '😄'];
const money0 = (v) => fmtMoney(v, { dp: 0 });

// ---------- hooks ----------
export function useRisk() {
  const { state } = useStore();
  const trades = useAccountTrades();
  const id = state.settings.account;
  const account = state.accounts.find((a) => a.id === id);
  return useMemo(() => riskState(trades, account ? { ...account, balanceGap: balanceGap(state, id) } : id === 'all' ? { balanceGap: balanceGap(state, 'all') } : account, riskOf(state)), [trades, account, state, id]);
}
/** Days to ruin for the selected account: { r, account, dd } or a reason it can't be worked out. */
export function useDaysToRuin() {
  const { state } = useStore();
  const trades = useAccountTrades();
  const id = state.settings.account;
  const account = state.accounts.find((a) => a.id === id);
  return useMemo(() => {
    if (!account) return { why: 'all' };
    if (!(Number(account.maxDrawdown) > 0)) return { why: 'nodd', account };
    const dd = accountDrawdown(state, account);
    const r = daysToRuin(trades, { ...account, balanceGap: balanceGap(state, id) }, riskOf(state), dd.left, { firmDaily: Number(account.dailyLossLimit) || 0 });
    return { r, account, dd };
  }, [trades, account, state, id]);
}

/** "N days to ruin" chip for the Current risk card; click it for the day-by-day path. */
export function DaysToRuin() {
  const { r, account, dd, why } = useDaysToRuin();
  if (why === 'all') return <span className="ruin-chip muted" title="Days to ruin is worked out per account — pick one at the top">Days to ruin: pick an account</span>;
  if (why === 'nodd') return <a className="ruin-chip muted" href="#/accounts" title="Set the account’s max drawdown to see days to ruin">Days to ruin: set a max drawdown</a>;
  if (!r) return null;
  const tone = r.days <= 3 ? 'neg' : r.days <= 10 ? 'warn' : 'pos';
  const inf = r.ruinDay == null;
  const when = r.ruinDate ? fmtDate(r.ruinDate).replace(/, \d{4}$/, '') : null;
  return (
    <Popover
      align="right"
      width={360}
      className="ruin-pop"
      trigger={({ toggle }) => (
        <button className={`ruin-chip ${tone}`} onClick={toggle} title="How many full max-loss days the account can take before it hits its max drawdown — click for details">
          <span className="ruin-n">{inf ? `${r.days}+` : r.days}</span>
          <span className="ruin-l"><b>day{r.days === 1 ? '' : 's'} to ruin</b><em><Private>{money0(dd.left)}</Private> to max drawdown</em></span>
        </button>
      )}
    >
      {() => (
        <div className="ruin-body">
          <div className="ruin-h"><b className={tone}>{inf ? `${r.days}+` : r.days}</b> full max-loss day{r.days === 1 ? '' : 's'} before the max drawdown</div>
          <p className="muted">If every trading day from {r.segments[0]?.today ? 'today' : 'tomorrow'} lost its whole daily loss limit, {account.name || account.id} would hit its max drawdown on trading day {r.ruinDay}{when ? ` (${when})` : ''}. Tiers step down as your risk rules say.</p>
          <div className="ruin-path">
            {r.segments.map((g) => {
              const n = g.to - g.from + 1;
              return (
                <div key={g.from} className="ruin-seg">
                  <i style={{ background: g.color }} />
                  <span className="ruin-d">{g.today ? 'Today' : n === 1 ? `Day ${g.from}` : `Days ${g.from}–${g.to}`}</span>
                  <span className="grow">{g.name}</span>
                  <span className="muted ruin-calc">−{money0(g.loss)}{n > 1 ? ` × ${n}` : ''}</span>
                  <b><Private>−{money0(g.loss * n)}</Private></b>
                </div>
              );
            })}
            {r.ruinDay != null && <div className="ruin-seg end"><i /><span className="ruin-d">Day {r.ruinDay}</span><span className="grow">Max drawdown hit</span><span className="muted ruin-calc">only <Private>{money0(dd.left - r.lost)}</Private> of room left</span></div>}
          </div>
          <div className="ruin-foot">
            <div><span>Room to the max-loss floor</span><b><Private>{money0(dd.left)}</Private></b></div>
            <div><span>Floor ({ddTypeLabel(account)})</span><b><Private>{money0(dd.floor)}</Private></b></div>
            {Number(account.dailyLossLimit) > 0 && <div><span>Each day capped at the firm’s daily limit</span><b>{money0(account.dailyLossLimit)}</b></div>}
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>Assumes no green days in between — a worst case to size risk against, not a forecast.</div>
        </div>
      )}
    </Popover>
  );
}

export function useBlockers() {
  const { state } = useStore();
  const trades = useAccountTrades();
  const pb = playbookOf(state);
  return useMemo(() => blockerStats(trades, pb.blockers, riskOf(state).lookbackDays), [trades, state, pb.blockers]);
}

/** Edge blockers flagged on one day's trades. */
export function dayBlockerSummary(trades, blockers) {
  const map = {};
  let flagged = 0, flaggedPnl = 0;
  for (const t of trades) {
    const b = tradeBlockers(t).filter((x) => blockers.includes(x));
    if (!b.length) continue;
    flagged++; flaggedPnl += t.pnl;
    for (const x of b) { (map[x] ||= { name: x, count: 0, pnl: 0, trades: [] }); map[x].count++; map[x].pnl += t.pnl; map[x].trades.push(t); }
  }
  return { rows: blockers.filter((b) => map[b]).map((b) => map[b]), flagged, flaggedPnl };
}

/** Add, rename, reorder and remove your tags or edge blockers. A rename carries over onto past trades. */
export function LabelListEditor({ kind, open, onClose }) {
  const { state, setLabelList } = useStore();
  const isTags = kind === 'tags';
  const current = isTags ? state.tags : playbookOf(state).blockers;
  const [rows, setRows] = useState(null);
  const list = rows || current.map((name) => ({ orig: name, name }));
  const edit = (fn) => setRows(fn(list));
  const used = useMemo(() => {
    const m = {};
    for (const t of state.trades) for (const x of (isTags ? t.tags : t.blockers) || []) m[x] = (m[x] || 0) + 1;
    return m;
  }, [state.trades, isTags]);
  const names = list.map((r) => r.name.trim()).filter(Boolean);
  const dupe = names.find((n, i) => names.indexOf(n) !== i);
  const close = () => { setRows(null); onClose(); };
  const save = () => {
    const renames = Object.fromEntries(list.filter((r) => r.orig && r.name.trim() && r.name.trim() !== r.orig).map((r) => [r.orig, r.name.trim()]));
    setLabelList(kind, [...new Set(names)], renames);
    close();
  };
  if (!open) return null;
  return createPortal(
    <Modal open onClose={close} width={460} className="lle-modal">
      <ModalHead title={isTags ? 'Edit tags' : 'Edit edge blockers'} sub={isTags ? 'Your own labels for trades — setups, mistakes, anything you want to track' : 'The habits that pull you off your plan — flag them on trades to see what they cost'} onClose={close} />
      <div className="modal-body col gap8" style={{ maxHeight: '60vh', overflow: 'auto' }}>
        {list.map((r, i) => (
          <div key={i} className="row gap6 lle-row">
            <div className="col" style={{ gap: 0 }}>
              <button className="icon-btn" style={{ width: 20, height: 16 }} disabled={i === 0} title="Move up" onClick={() => edit((l) => { const n = [...l]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}><ChevronUp size={13} /></button>
              <button className="icon-btn" style={{ width: 20, height: 16 }} disabled={i === list.length - 1} title="Move down" onClick={() => edit((l) => { const n = [...l]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}><ChevronDown size={13} /></button>
            </div>
            <input className="input grow" style={{ height: 34 }} value={r.name} autoFocus={!r.orig && i === list.length - 1} placeholder={isTags ? 'Tag name' : 'Blocker name'} onChange={(e) => edit((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); edit((l) => [...l, { orig: null, name: '' }]); } }} />
            <span className="muted2" style={{ fontSize: 12, minWidth: 64, textAlign: 'right' }} title={r.orig ? `${used[r.orig] || 0} trades have it` : 'New'}>{r.orig ? `${used[r.orig] || 0} trade${used[r.orig] === 1 ? '' : 's'}` : 'new'}</span>
            <button className="icon-btn" title="Remove from the list (trades that have it keep it)" onClick={() => edit((l) => l.filter((_, j) => j !== i))}><Trash size={14} /></button>
          </div>
        ))}
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => edit((l) => [...l, { orig: null, name: '' }])}><Plus size={14} /> Add {isTags ? 'tag' : 'blocker'}</button>
        <div className="muted" style={{ fontSize: 12.5 }}>Renaming one renames it on your past trades too. Removing one takes it off the list; trades that already have it keep it.</div>
        {dupe && <div className="ec-warn">“{dupe}” is in the list twice — they’ll be merged.</div>}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn white" onClick={save}>Save</button>
      </div>
    </Modal>,
    document.body,
  );
}

/** Toggle the edge blockers that applied to one trade. */
export function BlockerPicker({ value = [], onChange }) {
  const { state } = useStore();
  const pb = playbookOf(state);
  const set = new Set(value);
  const [editing, setEditing] = useState(false);
  const extra = value.filter((b) => !pb.blockers.includes(b)); // renamed/removed in settings — still shown so it can be cleared
  return (
    <div className="row gap6 wrap">
      <LabelListEditor kind="blockers" open={editing} onClose={() => setEditing(false)} />
      {[...pb.blockers, ...extra].map((b) => {
        const on = set.has(b);
        return (
          <button key={b} type="button" className={`chip blk ${on ? 'neg-on' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== b) : [...value, b])} aria-pressed={on}>
            {on && <Check size={12} strokeWidth={3} />}{b}
          </button>
        );
      })}
      <button type="button" className="chip ghost-chip" title="Add, rename or remove edge blockers" onClick={() => setEditing(true)}><Pencil size={11} /> Edit</button>
    </div>
  );
}

// ---------- small pieces ----------
export function CheckBox({ on, onChange, size = 20 }) {
  return (
    <button className={`pb-check ${on ? 'on' : ''}`} style={{ width: size, height: size }} onClick={(e) => { e.stopPropagation(); onChange(!on); }} aria-pressed={on}>
      {on && <Check size={size - 6} strokeWidth={3} />}
    </button>
  );
}

export function TierCards({ risk, compact = false }) {
  return (
    <div className="tier-row" style={{ gridTemplateColumns: risk.tiers.length > 5 ? "repeat(auto-fit, minmax(150px, 1fr))" : `repeat(${risk.tiers.length}, minmax(0,1fr))` }}>
      {risk.tiers.map((t, i) => {
        const on = i === risk.level;
        const locked = i > risk.normal;
        return (
          <div key={t.id} className={`tier ${on ? 'on' : ''}`} style={{ '--tier': t.color, opacity: locked && !on ? 0.55 : 1 }}>
            <div className="row gap8" style={{ alignItems: 'flex-start' }}>
              <span className={`pb-check ${on ? 'on' : ''}`} style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}>{on && <Check size={12} strokeWidth={3} />}</span>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{t.name}{locked && <span style={{ fontWeight: 400, fontSize: 11.5 }}> · locked</span>}</div>
                <div style={{ marginTop: 6 }}>Daily LL: <b>−{money0(t.dailyLL)}</b></div>
                <div>Risk/Trade: <b>{money0(t.riskMin)}–{money0(t.riskMax)}</b></div>
                {!compact && <div style={{ fontSize: 11.5, marginTop: 6, opacity: 0.85 }}>{t.note}</div>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RegimeCards({ trades, selected, onSelect, lookback = 90, caption }) {
  const { state } = useStore();
  const pb = playbookOf(state);
  const stats = useMemo(() => regimeStats(trades, state.diary, pb.regimes, lookback), [trades, state.diary, pb.regimes, lookback]);
  return (
    <div className="regime-row">
      {stats.map((r) => {
        const on = selected === r.id;
        return (
          <div key={r.id} className={`regime ${on ? 'on' : ''} ${onSelect ? 'pick' : ''}`} style={{ '--rg': r.color }} onClick={() => onSelect?.(on ? null : r.id)}>
            <div className="row gap12">
              {onSelect && <span className={`pb-check ${on ? 'on' : ''}`} style={{ width: 20, height: 20 }}>{on && <Check size={14} strokeWidth={3} />}</span>}
              <div className="grow" style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                {r.style && <div className="muted" style={{ fontSize: 12.5 }}>({r.style})</div>}
              </div>
            </div>
            {r.trigger && <div className="regime-txt"><i>How to spot it:</i> {r.trigger}</div>}
            {r.confirmation && <div className="regime-txt"><i>Confirmation:</i> {r.confirmation}</div>}
            <div className="regime-stats">
              <div className="muted" style={{ gridColumn: '1/-1', textAlign: 'center', fontSize: 11.5 }}>{caption || `Last ${lookback} day stats`} · {r.days} trading day{r.days === 1 ? '' : 's'}</div>
              <Stat k="Win rate" v={r.days ? `${Math.round(r.winRate)}%` : '—'} />
              <Stat k="P&L" v={r.days ? <Private>{money0(r.net)}</Private> : '—'} cls={r.net >= 0 ? 'pos' : 'neg'} />
              <Stat k="Performance" v={r.days ? pfText(r.pf) : '—'} cls={r.pf >= 1 ? 'pos' : 'neg'} />
              <Stat k="Avg + day" v={r.days ? <Private>{money0(r.avgUp)}</Private> : '—'} />
              <Stat k="Avg − day" v={r.days ? <Private>{money0(r.avgDn)}</Private> : '—'} />
              <Stat k="EV / day" v={r.days ? <Private>{money0(r.ev)}</Private> : '—'} cls={r.ev >= 0 ? 'pos' : 'neg'} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
const Stat = ({ k, v, cls = '' }) => (
  <div style={{ textAlign: 'center' }}>
    <div className="muted" style={{ fontSize: 11 }}>{k}</div>
    <div className={cls} style={{ fontWeight: 600, fontSize: 15, marginTop: 3 }}>{v}</div>
  </div>
);

export function BlockerStrip({ title = true }) {
  const { state } = useStore();
  const { rows, biggest } = useBlockers();
  const lb = riskOf(state).lookbackDays;
  return (
    <div className="panel blocker-panel" style={{ padding: 0 }}>
      {title && (
        <div className="row between" style={{ padding: '14px 18px' }}>
          <div className="card-title">Edge Blockers <span className="muted" style={{ fontWeight: 400 }}>(last {lb} days)</span></div>
          {biggest ? <span className="badge neg-soft"><TrendingDown size={12} /> Biggest: {biggest.name}</span> : <span className="muted" style={{ fontSize: 12.5 }}>Flag blockers on individual trades</span>}
        </div>
      )}
      <div className="blocker-row" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0,1fr))` }}>
        {rows.map((r) => (
          <div key={r.name} className={`blocker ${biggest?.name === r.name ? 'top' : ''}`} title={r.count ? `${r.count} trade${r.count === 1 ? '' : 's'} flagged on ${r.days} day${r.days === 1 ? '' : 's'} · net P&L of those trades` : 'No trades flagged'}>
            <div className="b-count">{r.count}</div>
            <div className={`b-pnl ${r.pnl < 0 ? 'neg' : r.pnl > 0 ? 'pos' : 'muted'}`}><Private>{r.count ? money0(r.pnl) : '—'}</Private></div>
            <div className="b-name">{r.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BiggestBlocker({ compact = false }) {
  const { biggest } = useBlockers();
  if (!biggest) return <span className="muted">No edge blockers logged yet.</span>;
  return (
    <span>
      <b style={{ fontWeight: 600, color: 'var(--neg)' }}>{biggest.name}</b>
      <span className="muted">{compact ? ` · ${biggest.count}×` : ` — ${biggest.count} trade${biggest.count > 1 ? 's' : ''} on ${biggest.days} day${biggest.days > 1 ? 's' : ''}, `}</span>
      {!compact && <Private className={biggest.pnl < 0 ? 'neg' : 'pos'}>{money0(biggest.pnl)}</Private>}
    </span>
  );
}

// ---------- pre-session wizard ----------
export function SessionWizard({ open, onClose, date = todayKey(), existing }) {
  const { state, saveDiary } = useStore();
  const toast = useToast();
  const trades = useAccountTrades();
  const pb = playbookOf(state);
  const risk = useRisk();
  const prev = lastTomorrowNote(state.diary, date);
  const [step, setStep] = useState(0);
  const [a, setA] = useState({});
  const [was, setWas] = useState(open);
  if (was !== open) {
    setWas(open);
    if (open) { setStep(0); setA({ routine: {}, ...(existing || {}), maxLoss: existing?.maxLoss ?? risk.tier.dailyLL, riskTier: existing?.riskTier ?? risk.tier.name }); }
  }
  const set = (k, v) => setA((x) => ({ ...x, [k]: v }));
  const setIn = (o, k, v) => setA((x) => ({ ...x, [o]: { ...(x[o] || {}), [k]: v } }));
  const STEPS = ['Pre-Market Routine', 'Market Conditions & Levels', 'Risk & Plan'];
  const finish = () => {
    saveDiary(date, { pre: { ...a, at: new Date().toISOString() }, mood: a.mood });
    toast('Session check-in saved — trade your plan');
    onClose();
    navigate(`diary/${date}`);
  };
  const done = pb.preRoutine.filter((r) => a.routine?.[r.id]).length;

  return (
    <Modal open={open} onClose={onClose} width={860}>
      <ModalHead title="Start Trading Session" sub={`${fmtDate(date)} · Step ${step + 1} of 3 — ${STEPS[step]}`} onClose={onClose} />
      <div className="row gap8" style={{ padding: '4px 24px 0' }}>
        {STEPS.map((s, i) => <div key={s} className="progress grow" style={{ height: 3 }}><i style={{ width: i <= step ? '100%' : 0 }} /></div>)}
      </div>
      <div className="modal-body col gap16" style={{ paddingTop: 20 }}>
        {step === 0 && (
          <>
            <div className="routine">
              {pb.preRoutine.map((r) => (
                <div key={r.id} className={`routine-item ${a.routine?.[r.id] ? 'on' : ''}`} onClick={() => setIn('routine', r.id, !a.routine?.[r.id])}>
                  <CheckBox on={!!a.routine?.[r.id]} onChange={(v) => setIn('routine', r.id, v)} />
                  <div className="r-time">{r.time}</div>
                  <div className="grow"><b>{r.title}:</b> {r.text}</div>
                </div>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>{done} of {pb.preRoutine.length} routine steps done</div>
            <div className="row gap24 wrap">
              <div className="field">
                <label className="label">How are you feeling?</label>
                <div className="row gap6">
                  {MOODS.map((m, i) => <button key={i} onClick={() => set('mood', i + 1)} className={`mood ${a.mood === i + 1 ? 'on' : ''}`}>{m}</button>)}
                </div>
              </div>
              <div className="field"><label className="label">Sleep</label><Stars value={a.sleep || 0} onChange={(v) => set('sleep', v)} /></div>
              <div className="field"><label className="label">Focus</label><Stars value={a.focus || 0} onChange={(v) => set('focus', v)} /></div>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <div className="panel" style={{ padding: '14px 16px' }}>
              <div className="row gap8" style={{ fontWeight: 600, marginBottom: 8 }}><Lightbulb size={15} className="accent" /> Mental calibration</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                <div><span className="muted">Biggest edge blocker right now: </span><BiggestBlocker /></div>
                <div style={{ marginTop: 4 }}>
                  <span className="muted">You said you'd do better at{prev ? ` (${fmtDate(prev.date)})` : ''}: </span>
                  {prev ? <i>“{prev.text}”</i> : <span className="muted">— nothing logged yet</span>}
                </div>
              </div>
            </div>
            <div>
              <div className="sec-title" style={{ marginBottom: 4 }}>Market conditions</div>
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>{pb.regimeTime ? `At ${pb.regimeTime}, l` : 'L'}et the market tell you which playbook to use. You can also set this later on the day page.</div>
              {pb.regimes.length ? <RegimeCards trades={trades} selected={a.regime} onSelect={(v) => set('regime', v)} /> : <div className="muted" style={{ fontSize: 13 }}>No market conditions set up — add them in Playbook settings.</div>}
            </div>
            <div className="field">
              <label className="label">Key levels & setups you're waiting for</label>
              <textarea className="textarea" style={{ minHeight: 60 }} placeholder="e.g. ONH 6921, ORB high/low, VWAP reclaim…" value={a.levels || ''} onChange={(e) => set('levels', e.target.value)} />
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <div>
              <div className="row between" style={{ marginBottom: 8 }}>
                <div className="sec-title" style={{ margin: 0 }}>Today's risk <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· current drawdown <Private className="neg">−{money0(risk.dd)}</Private></span></div>
                <a href="#/risk" onClick={onClose} className="muted" style={{ fontSize: 12.5 }}>Why? →</a>
              </div>
              <TierCards risk={risk} compact />
              <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{risk.reasons[0]}.</div>
            </div>
            <div className="form-grid">
              <div className="field"><label className="label">Max loss for today (USD)</label><input className="input" type="number" value={a.maxLoss ?? ''} onChange={(e) => set('maxLoss', e.target.value)} /></div>
              <div className="field"><label className="label">Max number of trades</label><input className="input" type="number" placeholder="5" value={a.maxTrades || ''} onChange={(e) => set('maxTrades', e.target.value)} /></div>
              <div className="field full">
                <label className="label">Bias</label>
                <div className="row gap8 wrap">{['Bullish', 'Bearish', 'Neutral', 'No bias – react to price'].map((o) => <button key={o} className={`chip ${a.bias === o ? 'on' : ''}`} style={{ padding: '7px 12px', fontSize: 13.5 }} onClick={() => set('bias', o)}>{o}</button>)}</div>
              </div>
              <div className="field full"><label className="label">News / events to watch</label><input className="input" placeholder="e.g. CPI 5:30 AM PT" value={a.news || ''} onChange={(e) => set('news', e.target.value)} /></div>
              <div className="field full"><label className="label">One process goal for this session</label><input className="input" placeholder="e.g. No trades during the observation zone" value={a.goal || ''} onChange={(e) => set('goal', e.target.value)} /></div>
            </div>
          </>
        )}
      </div>
      <div className="modal-foot">
        {step > 0 ? <button className="btn" onClick={() => setStep(step - 1)}><ChevronLeft size={15} /> Back</button> : <button className="btn" onClick={onClose}>Cancel</button>}
        <div className="grow" />
        {step < 2 ? <button className="btn white" onClick={() => setStep(step + 1)}>Continue <ChevronRight size={15} /></button> : <button className="btn primary" onClick={finish}><Check size={15} /> Start session</button>}
      </div>
    </Modal>
  );
}

// ---------- day page panels ----------
export function PrePanel({ date, entry, day, onEdit }) {
  const { state, saveDiary } = useStore();
  const pb = playbookOf(state);
  const pre = entry.pre || {};
  const setPre = (patch) => saveDiary(date, { pre: { ...pre, ...patch } });
  const [settings, setSettings] = useState(null);
  return (
    <div className="panel col gap16">
      <div className="panel-head" style={{ margin: 0 }}>
        <div className="card-title">Pre-session</div>
        <div className="row gap6">
          <button className="icon-btn" title="Edit the pre-market routine and market conditions" onClick={() => setSettings('pre')}><Pencil size={14} /></button>
          <button className="btn xs" onClick={onEdit}>{entry.pre ? 'Edit check-in' : 'Start check-in'}</button>
        </div>
      </div>
      <PlaybookSettings open={!!settings} initialTab={settings || 'pre'} onClose={() => setSettings(null)} />
      <div className="routine compact">
        {pb.preRoutine.map((r) => (
          <div key={r.id} className={`routine-item ${pre.routine?.[r.id] ? 'on' : ''}`} onClick={() => setPre({ routine: { ...(pre.routine || {}), [r.id]: !pre.routine?.[r.id] } })}>
            <CheckBox on={!!pre.routine?.[r.id]} onChange={(v) => setPre({ routine: { ...(pre.routine || {}), [r.id]: v } })} size={18} />
            <div className="r-time">{r.time}</div>
            <div className="grow"><b>{r.title}</b><span className="muted"> — {r.text}</span></div>
          </div>
        ))}
      </div>
      <div>
        <div className="row between" style={{ marginBottom: 8 }}>
          <div className="label" style={{ margin: 0 }}>Market conditions</div>
          <button className="btn xs ghost" onClick={() => setSettings('regimes')}><Pencil size={12} /> Edit list</button>
        </div>
        {!pb.regimes.length && <span className="muted" style={{ fontSize: 12.5 }}>No market conditions yet — add some with “Edit list”.</span>}
        <div className="row gap8 wrap">
          {pb.regimes.map((r) => (
            <button key={r.id} className={`chip ${pre.regime === r.id ? 'on' : ''}`} style={{ padding: '7px 12px', fontSize: 13.5 }} onClick={() => setPre({ regime: pre.regime === r.id ? null : r.id })}>
              {pre.regime === r.id && <Check size={13} />} {r.name} {r.style && <span className="muted">({r.style})</span>}
            </button>
          ))}
        </div>
      </div>
      {entry.pre && (
        <div className="col" style={{ fontSize: 13.5 }}>
          {[
            ['Mood / sleep / focus', [pre.mood ? MOODS[pre.mood - 1] : null, pre.sleep ? `sleep ${'★'.repeat(pre.sleep)}` : null, pre.focus ? `focus ${'★'.repeat(pre.focus)}` : null].filter(Boolean).join(' · ')],
            ['Risk tier', pre.riskTier],
            ['Bias', pre.bias], ['Key levels', pre.levels], ['News', pre.news], ['Process goal', pre.goal],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="check-item" style={{ alignItems: 'flex-start' }}><span className="muted" style={{ width: 150, flexShrink: 0 }}>{k}</span><span className="grow" style={{ whiteSpace: 'pre-wrap' }}>{v}</span></div>
          ))}
          {day && pre.maxLoss && (
            <div className="row gap8 wrap" style={{ marginTop: 12 }}>
              {day.net >= -Number(pre.maxLoss) ? <span className="badge pos-soft">Respected max loss ({money0(Number(pre.maxLoss))})</span> : <span className="badge neg-soft">Max loss exceeded ({money0(Number(pre.maxLoss))})</span>}
              {pre.maxTrades && (day.count <= Number(pre.maxTrades) ? <span className="badge pos-soft">Within max trades</span> : <span className="badge neg-soft">{day.count - Number(pre.maxTrades)} trades over plan</span>)}
            </div>
          )}
        </div>
      )}
      {!entry.pre && <div className="muted" style={{ fontSize: 13 }}>Tick routine items as you go, or run the full check-in.</div>}
    </div>
  );
}

export function PostPanel({ date, entry }) {
  const { state, saveDiary } = useStore();
  const pb = playbookOf(state);
  const post = entry.post || {};
  const setPost = (patch) => saveDiary(date, { post: { ...post, ...patch } });
  const trades = useAccountTrades();
  const day = useMemo(() => trades.filter((t) => t.entry.slice(0, 10) === date), [trades, date]);
  const summary = useMemo(() => dayBlockerSummary(day, pb.blockers), [day, pb.blockers]);
  const legacy = Object.entries(post.blockers || {}).filter(([, c]) => Number(c) > 0);
  const [settings, setSettings] = useState(null);
  return (
    <div className="panel col gap16">
      <div className="panel-head" style={{ margin: 0 }}>
        <div className="card-title">Post-session review</div>
        <button className="icon-btn" title="Edit the post-market routine and edge blockers" onClick={() => setSettings('post')}><Pencil size={14} /></button>
      </div>
      <PlaybookSettings open={!!settings} initialTab={settings || 'post'} onClose={() => setSettings(null)} />
      <div className="routine compact">
        {pb.postRoutine.map((r) => (
          <div key={r.id} className={`routine-item ${post.routine?.[r.id] ? 'on' : ''}`} onClick={() => setPost({ routine: { ...(post.routine || {}), [r.id]: !post.routine?.[r.id] } })}>
            <CheckBox on={!!post.routine?.[r.id]} onChange={(v) => setPost({ routine: { ...(post.routine || {}), [r.id]: v } })} size={18} />
            <div className="grow">{r.title}</div>
          </div>
        ))}
      </div>
      <div className="field">
        <label className="label row between" style={{ display: 'flex' }}><span>Edge blockers today <span className="muted">(flag them on each trade — click a trade in the list above)</span></span><button className="btn xs ghost" onClick={() => setSettings('blockers')}><Pencil size={12} /> Edit list</button></label>
        {summary.rows.length ? (
          <>
            <div className="row gap6 wrap">
              {summary.rows.map((r) => (
                <span key={r.name} className="chip blk neg-on" title={`${r.count} trade${r.count === 1 ? '' : 's'}: ${r.trades.map((t) => `${fmtTime12(t.entry)} ${t.symbol}`).join(', ')}`}>
                  {r.name}{r.count > 1 ? ` ×${r.count}` : ''} <span className={r.pnl < 0 ? 'neg' : 'pos'} style={{ fontWeight: 600 }}><Private>{money0(r.pnl)}</Private></span>
                </span>
              ))}
            </div>
            <span className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              {summary.flagged} of {day.length} trade{day.length === 1 ? '' : 's'} flagged · <Private className={summary.flaggedPnl < 0 ? 'neg' : 'pos'}>{money0(summary.flaggedPnl)}</Private> from those trades
            </span>
          </>
        ) : (
          <span className="muted" style={{ fontSize: 12, marginTop: 2 }}>{day.length ? 'No trades flagged — a clean session.' : 'No trades on this day.'}</span>
        )}
        {legacy.length > 0 && (
          <div className="row gap8 wrap" style={{ marginTop: 8, fontSize: 12 }}>
            <span className="muted">Old day-level entries (not tied to a trade, not counted): {legacy.map(([b, c]) => `${b} ×${c}`).join(', ')}</span>
            <button className="btn xs" onClick={() => setPost({ blockers: {} })}>Clear</button>
          </div>
        )}
      </div>
      <div className="row gap24 wrap">
        <div className="field"><label className="label">Execution</label><Stars value={entry.execution || 0} onChange={(v) => saveDiary(date, { execution: v })} /></div>
        <div className="field">
          <label className="label">Mood after</label>
          <div className="row gap6">{MOODS.map((m, i) => <button key={i} onClick={() => saveDiary(date, { moodAfter: i + 1 })} className={`mood sm ${entry.moodAfter === i + 1 ? 'on' : ''}`}>{m}</button>)}</div>
        </div>
      </div>
      <div className="field">
        <label className="label" style={{ fontWeight: 600, color: 'var(--fg)' }}>What will I do better tomorrow?</label>
        <textarea className="textarea" style={{ minHeight: 70 }} placeholder="e.g. Don't force trades — if there's no setup, don't take it. Focus on trade location (use profiles)." value={post.tomorrow || ''} onChange={(e) => setPost({ tomorrow: e.target.value })} />
      </div>
    </div>
  );
}

// ---------- settings ----------
export function PlaybookSettings({ open, onClose, initialTab = 'pre' }) {
  const { state, setSetting } = useStore();
  const toast = useToast();
  const [pb, setPb] = useState(null);
  const [plans, setPlans] = useState(null); // { default: plan, own: { [accountId]: plan | null } }
  const [who, setWho] = useState('default'); // which plan the risk tab is editing: 'default', 'profile:<id>' or an account id
  const [saveAs, setSaveAs] = useState(null); // { name, maxDD } while naming a new profile
  const [tab, setTab] = useState(initialTab);
  const [was, setWas] = useState(open);
  if (was !== open) {
    setWas(open);
    if (open) {
      setTab(initialTab);
      setPb(JSON.parse(JSON.stringify(playbookOf(state))));
      const profiles = profilesOf(state).map((p) => ({ ...p, plan: withTierDD({ ...DEFAULT_RISK, ...p.plan }) }));
      // an account's entry: { profile: id } when it follows a profile, its own plan, or nothing (default plan)
      const own = Object.fromEntries(Object.entries(state.settings.riskByAccount || {}).map(([id, v]) => [id, !v ? v : v.profile ? (profiles.some((p) => p.id === v.profile) ? { profile: v.profile } : null) : withTierDD(riskOf(state, id))]));
      setPlans(JSON.parse(JSON.stringify({ default: withTierDD(defaultRiskOf(state)), own, profiles })));
      setSaveAs(null);
      setWho(state.settings.account !== 'all' && state.accounts.some((a) => a.id === state.settings.account) ? state.settings.account : 'default');
    }
  }
  if (!open || !pb) return null;
  const profId = who.startsWith('profile:') ? who.slice(8) : null;
  const whoProf = profId ? plans.profiles.find((p) => p.id === profId) : null;
  const whoAcct = state.accounts.find((a) => a.id === who);
  const acctEntry = whoAcct ? plans.own[who] || null : null;
  const linked = acctEntry?.profile ? plans.profiles.find((p) => p.id === acctEntry.profile) : null; // the account follows this profile
  const rk = who === 'default' ? plans.default : whoProf ? whoProf.plan : acctEntry && !acctEntry.profile ? acctEntry : null;
  const setRk = (f) => setPlans((p) => {
    const cur = who === 'default' ? p.default : profId ? p.profiles.find((x) => x.id === profId)?.plan : p.own[who];
    const next = typeof f === 'function' ? f(cur) : f;
    if (who === 'default') return { ...p, default: next };
    if (profId) return { ...p, profiles: p.profiles.map((x) => (x.id === profId ? { ...x, plan: next } : x)) };
    return { ...p, own: { ...p.own, [who]: next } };
  });
  const setOwn = (v) => setPlans((p) => ({ ...p, own: { ...p.own, [who]: v } }));
  const usersOf = (pid) => state.accounts.filter((a) => plans.own[a.id]?.profile === pid);
  const usesDefault = state.accounts.filter((a) => !plans.own[a.id]).length;
  const acctLabel = (a) => { const e = plans.own[a.id]; return !e ? 'uses default' : e.profile ? `profile: ${plans.profiles.find((x) => x.id === e.profile)?.name}` : 'own rules'; };
  const matches = whoAcct ? matchingProfiles(plans.profiles, whoAcct) : [];
  const startSaveAs = () => {
    const dd = Number(whoAcct?.maxDrawdown) || null;
    setSaveAs({ name: dd ? `${money0(dd)} max DD` : whoProf ? `${whoProf.name} copy` : 'My risk profile', maxDD: dd ?? whoProf?.maxDD ?? '' });
  };
  const commitSaveAs = () => {
    const id = `rp${Date.now().toString(36)}`;
    const prof = { id, name: saveAs.name.trim() || 'Risk profile', maxDD: Number(saveAs.maxDD) || null, plan: JSON.parse(JSON.stringify(rk)) };
    // an account's own rules become the profile, and the account follows it from now on
    setPlans((p) => ({ ...p, profiles: [...p.profiles, prof], own: whoAcct ? { ...p.own, [who]: { profile: id } } : p.own }));
    setSaveAs(null);
    toast(`Saved profile “${prof.name}”`);
  };
  const upd = (k, i, f, v) => setPb((p) => ({ ...p, [k]: p[k].map((x, j) => (j === i ? { ...x, [f]: v } : x)) }));
  const del = (k, i) => setPb((p) => ({ ...p, [k]: p[k].filter((_, j) => j !== i) }));
  const TABS = [['pre', 'Pre-market routine'], ['post', 'Post-market routine'], ['regimes', 'Market conditions'], ['blockers', 'Edge blockers'], ['risk', 'Risk tiers']];
  return (
    <Modal open={open} onClose={onClose} width={1040}>
      <ModalHead title="Playbook settings" sub="Edit your routines, market conditions, edge blockers and risk rules" onClose={onClose} />
      <div className="row gap6 wrap" style={{ padding: '6px 24px 0' }}>
        {TABS.map(([k, l]) => <button key={k} className={`chip ${tab === k ? 'on' : ''}`} style={{ padding: '6px 12px' }} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="modal-body col gap8" style={{ minHeight: 360 }}>
        {tab === 'pre' && (
          <>
            {pb.preRoutine.map((r, i) => (
              <div key={r.id} className="rule" style={{ alignItems: 'flex-start' }}>
                <input className="input" style={{ width: 130, height: 34 }} value={r.time} onChange={(e) => upd('preRoutine', i, 'time', e.target.value)} />
                <input className="input" style={{ width: 180, height: 34 }} value={r.title} onChange={(e) => upd('preRoutine', i, 'title', e.target.value)} />
                <textarea className="textarea grow" style={{ minHeight: 34, padding: '7px 10px' }} value={r.text} onChange={(e) => upd('preRoutine', i, 'text', e.target.value)} />
                <button className="icon-btn" onClick={() => del('preRoutine', i)}><Trash size={14} /></button>
              </div>
            ))}
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPb((p) => ({ ...p, preRoutine: [...p.preRoutine, { id: uid('r'), time: '', title: 'New step', text: '' }] }))}><Plus size={14} /> Add step</button>
          </>
        )}
        {tab === 'post' && (
          <>
            {pb.postRoutine.map((r, i) => (
              <div key={r.id} className="rule">
                <input className="input grow" style={{ height: 34 }} value={r.title} onChange={(e) => upd('postRoutine', i, 'title', e.target.value)} />
                <button className="icon-btn" onClick={() => del('postRoutine', i)}><Trash size={14} /></button>
              </div>
            ))}
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPb((p) => ({ ...p, postRoutine: [...p.postRoutine, { id: uid('r'), title: 'New step' }] }))}><Plus size={14} /> Add step</button>
          </>
        )}
        {tab === 'regimes' && (
          <>
            <div className="muted" style={{ fontSize: 13 }}>The kinds of market you trade in. Pick one each session (pre-session check-in or the day page) and the Strategy page shows how you perform in each. Removing one keeps past sessions’ stats under the old name.</div>
            <div className="field" style={{ width: 240 }}><label className="label">Decided at <span className="muted">(optional)</span></label><input className="input" style={{ height: 34 }} placeholder="e.g. 6:45 AM" value={pb.regimeTime || ''} onChange={(e) => setPb((p) => ({ ...p, regimeTime: e.target.value }))} /></div>
            {pb.regimes.map((r, i) => (
              <div key={r.id} className="panel col gap8" style={{ padding: 12 }}>
                <div className="row gap8">
                  <input type="color" value={r.color || '#8fa3a8'} onChange={(e) => upd('regimes', i, 'color', e.target.value)} style={{ width: 40, height: 34, background: 'none', border: 0, flexShrink: 0 }} title="Colour" />
                  <input className="input grow" style={{ height: 34 }} placeholder="Name (e.g. Trending)" value={r.name} onChange={(e) => upd('regimes', i, 'name', e.target.value)} />
                  <input className="input" style={{ height: 34, width: 170 }} placeholder="Tag (e.g. Momentum)" value={r.style || ''} onChange={(e) => upd('regimes', i, 'style', e.target.value)} />
                  <button className="icon-btn" title="Remove" onClick={() => del('regimes', i)}><Trash size={14} /></button>
                </div>
                <textarea className="textarea" style={{ minHeight: 40 }} value={r.trigger || ''} onChange={(e) => upd('regimes', i, 'trigger', e.target.value)} placeholder="How to spot it (optional)" />
                <textarea className="textarea" style={{ minHeight: 40 }} value={r.confirmation || ''} onChange={(e) => upd('regimes', i, 'confirmation', e.target.value)} placeholder="Confirmation (optional)" />
              </div>
            ))}
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPb((p) => ({ ...p, regimes: [...p.regimes, { id: uid('mc'), name: 'New condition', style: '', color: '#8fa3a8', trigger: '', confirmation: '' }] }))}><Plus size={14} /> Add market condition</button>
          </>
        )}
        {tab === 'blockers' && (
          <>
            <div className="muted" style={{ fontSize: 13 }}>Edge blockers are the habits that cost you money. Flag them on trades. (To rename one on your past trades too, use Edit next to the blockers on any trade.)</div>
            {pb.blockers.map((b, i) => (
              <div key={i} className="rule">
                <input className="input grow" style={{ height: 34 }} value={b} onChange={(e) => setPb((p) => ({ ...p, blockers: p.blockers.map((x, j) => (j === i ? e.target.value : x)) }))} />
                <button className="icon-btn" onClick={() => setPb((p) => ({ ...p, blockers: p.blockers.filter((_, j) => j !== i) }))}><Trash size={14} /></button>
              </div>
            ))}
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPb((p) => ({ ...p, blockers: [...p.blockers, 'New blocker'] }))}><Plus size={14} /> Add blocker</button>
          </>
        )}
        {tab === 'risk' && (
          <>
            <div className="risk-who">
              <label className="label" htmlFor="risk-who">Rules for</label>
              <select id="risk-who" className="select" value={who} onChange={(e) => { setWho(e.target.value); setSaveAs(null); }}>
                <option value="default">Default plan{state.accounts.length ? ` — used by ${usesDefault} account${usesDefault === 1 ? '' : 's'}` : ''}</option>
                {plans.profiles.length > 0 && (
                  <optgroup label="Profiles">
                    {plans.profiles.map((p) => { const n = usersOf(p.id).length; return <option key={p.id} value={`profile:${p.id}`}>{p.name} — {n ? `used by ${n} account${n === 1 ? '' : 's'}` : 'not in use'}</option>; })}
                  </optgroup>
                )}
                {state.accounts.length > 0 && (
                  <optgroup label="Accounts">
                    {state.accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}{a.status && a.status !== 'Active' ? ` (${a.status})` : ''} — {acctLabel(a)}</option>)}
                  </optgroup>
                )}
              </select>
              {whoAcct && acctEntry && <button className="btn sm" onClick={() => setOwn(null)}>Use the default plan instead</button>}
            </div>

            {who === 'default' && state.accounts.length > 0 && <div className="muted" style={{ fontSize: 12.5 }}>Every account follows these rules unless you give it a profile or its own rules. Pick a profile or an account above to set rules for it.</div>}

            {whoProf && (
              <div className="risk-prof-head">
                <label className="field"><span className="label">Profile name</span><input className="input" value={whoProf.name} onChange={(e) => setPlans((p) => ({ ...p, profiles: p.profiles.map((x) => (x.id === profId ? { ...x, name: e.target.value } : x)) }))} /></label>
                <label className="field"><span className="label">For accounts with max drawdown (USD)</span><input className="input" type="number" placeholder="any" value={whoProf.maxDD ?? ''} onChange={(e) => setPlans((p) => ({ ...p, profiles: p.profiles.map((x) => (x.id === profId ? { ...x, maxDD: e.target.value === '' ? null : Number(e.target.value) } : x)) }))} /></label>
                <button className="btn sm danger-ghost" onClick={() => { const n = usersOf(profId).length; setPlans((p) => ({ ...p, profiles: p.profiles.filter((x) => x.id !== profId), own: Object.fromEntries(Object.entries(p.own).map(([k, v]) => [k, v?.profile === profId ? null : v])) })); setWho('default'); toast(n ? `Profile deleted — ${n} account${n === 1 ? '' : 's'} back on the default plan` : 'Profile deleted'); }}><Trash size={13} /> Delete profile</button>
                <div className="muted full" style={{ fontSize: 12.5 }}>{usersOf(profId).length ? <>Changes here apply to every account that follows this profile: {usersOf(profId).map((a) => a.name || a.id).join(', ')}.</> : 'No account follows this profile yet — pick an account above and choose it.'}</div>
              </div>
            )}

            {whoAcct && linked && (
              <div className="risk-own-empty">
                <div><b>{whoAcct.name || who}</b> follows the profile <b>“{linked.name}”</b>.</div>
                <div className="muted" style={{ fontSize: 12.5 }}>Edits to the profile apply to this account{usersOf(linked.id).length > 1 ? ` and ${usersOf(linked.id).length - 1} other${usersOf(linked.id).length > 2 ? 's' : ''}` : ''}.</div>
                <div className="row gap8 wrap" style={{ marginTop: 6 }}>
                  <button className="btn white sm" onClick={() => setWho(`profile:${linked.id}`)}>Edit the profile</button>
                  <button className="btn sm" onClick={() => setOwn(JSON.parse(JSON.stringify(linked.plan)))} title="A copy of the profile's rules that only this account uses">Give it its own copy</button>
                  <ProfilePicker profiles={plans.profiles} matches={matches} value={linked.id} onPick={(id) => setOwn({ profile: id })} label="Switch profile" />
                </div>
              </div>
            )}

            {whoAcct && !acctEntry && (
              <div className="risk-own-empty">
                <div><b>{whoAcct.name || who}</b> follows the default plan.</div>
                <div className="muted" style={{ fontSize: 12.5 }}>Give it a profile, or its own rules, to set different tiers, loss limits and drawdown thresholds for it.{whoAcct.maxDrawdown ? <> Its firm limits: max drawdown {money0(whoAcct.maxDrawdown)}{whoAcct.dailyLossLimit ? <>, daily loss limit {money0(whoAcct.dailyLossLimit)}</> : null}.</> : null}</div>
                {matches.length > 0 && (
                  <div className="risk-match">
                    <span>Profile for {money0(whoAcct.maxDrawdown)} max drawdown:</span>
                    {matches.map((m) => <button key={m.id} className="btn white sm" onClick={() => setOwn({ profile: m.id })}>Use “{m.name}”</button>)}
                  </div>
                )}
                <div className="row gap8 wrap" style={{ marginTop: 6 }}>
                  {plans.profiles.length > 0 && <ProfilePicker profiles={plans.profiles} matches={matches} onPick={(id) => setOwn({ profile: id })} label="Use a profile" />}
                  {Number(whoAcct.maxDrawdown) > 0 && <button className={`btn sm ${matches.length || plans.profiles.length ? '' : 'white'}`} onClick={() => setRk(suggestRisk(plans.default, whoAcct))} title="The default plan's tiers and thresholds, scaled to this account's max drawdown and capped at its daily loss limit">Start from this account’s limits</button>}
                  <button className="btn sm" onClick={() => setRk(JSON.parse(JSON.stringify(plans.default)))}>Copy the default plan</button>
                </div>
              </div>
            )}

            {rk && (
              <div className="risk-saveas">
                {saveAs ? (
                  <>
                    <input className="input" autoFocus value={saveAs.name} onChange={(e) => setSaveAs({ ...saveAs, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') commitSaveAs(); if (e.key === 'Escape') setSaveAs(null); }} aria-label="Profile name" placeholder="Profile name" />
                    <input className="input" type="number" value={saveAs.maxDD} onChange={(e) => setSaveAs({ ...saveAs, maxDD: e.target.value })} aria-label="For accounts with max drawdown" placeholder="Max DD (any)" title="Accounts with this max drawdown get this profile suggested" style={{ width: 130 }} />
                    <button className="btn white sm" onClick={commitSaveAs}><Check size={13} /> Save profile</button>
                    <button className="btn sm" onClick={() => setSaveAs(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    {!whoProf && (plans.profiles.length > 0
                      ? <ProfilePicker profiles={plans.profiles} matches={matches} label={whoAcct ? 'Use a profile' : 'Copy from a profile'} title={whoAcct ? 'Switch this account to follow a saved profile (replaces its own rules)' : 'Replace the default plan’s rules with a copy of a profile’s'}
                          onPick={(id) => {
                            const pr = plans.profiles.find((x) => x.id === id);
                            if (whoAcct) { setOwn({ profile: id }); toast(`${whoAcct.name || who} now follows “${pr.name}”`); }
                            else { setRk(JSON.parse(JSON.stringify(pr.plan))); toast(`Copied “${pr.name}” into the default plan`); }
                          }} />
                      : <button className="btn sm" disabled title="Save a profile first — then you can pick it here">Use a profile <ChevronDown size={13} /></button>)}
                    <div className="grow" />
                    <span className="muted" style={{ fontSize: 12.5 }}>{whoProf ? 'Want a variation?' : 'Use these rules for other accounts of this size?'}</span>
                    <button className="btn sm" onClick={startSaveAs}><Plus size={13} /> {whoProf ? 'Save as a new profile' : 'Save as profile'}</button>
                  </>
                )}
              </div>
            )}
            {saveAs && whoAcct && <div className="muted" style={{ fontSize: 12 }}>{whoAcct.name || who} will follow the new profile.</div>}
            {rk && <RiskEditor rk={rk} setRk={setRk} account={whoAcct} />}
          </>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => { setSetting('playbook', null); setSetting('risk', null); setSetting('riskByAccount', null); toast('Playbook reset to defaults — risk profiles kept'); onClose(); }}>Reset to defaults</button>
        <div className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn white" onClick={() => {
          setSetting('playbook', pb);
          // damageDD / riskOffDD mirror the first two tiers' thresholds, for older versions of the app
          const legacy = (pl) => { const d = tierDD(pl); return { ...pl, damageDD: d[0] ?? pl.damageDD, riskOffDD: d[1] ?? pl.riskOffDD }; };
          setSetting('risk', legacy(plans.default));
          setSetting('riskProfiles', plans.profiles.length ? plans.profiles.map((p) => ({ ...p, plan: legacy(p.plan) })) : null);
          const own = Object.fromEntries(Object.entries(plans.own).filter(([id, v]) => v && state.accounts.some((a) => a.id === id) && (!v.profile || plans.profiles.some((p) => p.id === v.profile))).map(([id, v]) => [id, v.profile ? { profile: v.profile } : legacy(v)]));
          setSetting('riskByAccount', Object.keys(own).length ? own : null);
          toast('Playbook saved'); onClose();
        }}><Check size={15} /> Save</button>
      </div>
    </Modal>
  );
}

/** A small menu of saved profiles; ones made for this account's drawdown size come first. */
function ProfilePicker({ profiles, matches = [], value, onPick, label, title }) {
  const first = new Set(matches.map((m) => m.id));
  const list = [...profiles].sort((a, b) => (first.has(b.id) ? 1 : 0) - (first.has(a.id) ? 1 : 0));
  return (
    <Popover trigger={({ toggle }) => <button className="btn sm" onClick={toggle} title={title}>{label} <ChevronDown size={13} /></button>} width={280}>
      {(close) => list.map((p) => (
        <button key={p.id} className={`pop-item ${p.id === value ? 'on' : ''}`} onClick={() => { onPick(p.id); close(); }}>
          <span className="grow">{p.name}</span>
          {p.maxDD ? <span className="muted" style={{ fontSize: 11.5 }}>{money0(p.maxDD)} DD{first.has(p.id) ? ' · match' : ''}</span> : null}
          {p.id === value && <Check size={13} />}
        </button>
      ))}
    </Popover>
  );
}

/** Tiers, thresholds and rules of one risk plan. `account`: shown against its firm limits. */
function RiskEditor({ rk, setRk, account }) {
  const firmDaily = Number(account?.dailyLossLimit) || 0;
  const firmDD = Number(account?.maxDrawdown) || 0;
  const overDaily = firmDaily > 0 && rk.tiers.some((t) => t.dailyLL > firmDaily);
  const ni = normalIndex(rk);
  const normalId = rk.tiers[ni]?.id;
  // structural changes keep the Normal tier pinned by id, so it doesn't shift when tiers move around
  const setTiers = (f) => setRk((r) => { const tiers = f(r.tiers); return { ...r, tiers, normalTier: tiers.some((t) => t.id === normalId) ? normalId : tiers[Math.min(2, tiers.length - 1)]?.id }; });
  const move = (i, d) => setTiers((ts) => { const a = [...ts]; [a[i], a[i + d]] = [a[i + d], a[i]]; return a; });
  return (
    <>
      <div className="muted" style={{ fontSize: 12.5 }}>Lowest risk at the top. A drawdown past a tier’s threshold drops you to that tier; losing streaks step you down one tier at a time, and green days step you back up to <b style={{ color: 'var(--fg-2)' }}>Normal</b>. Tiers above Normal stay locked until you unlock them below.</div>
      <div className="rule risk-cols" aria-hidden="true"><span style={{ width: 34 }} /><span style={{ width: 56 }}>Normal</span><span style={{ width: 156 }}>Tier</span><span style={{ width: 96 }}>Kicks in at drawdown</span><span style={{ width: 88 }}>Daily loss limit</span><span style={{ width: 88 }}>Risk / trade min</span><span style={{ width: 88 }}>Risk / trade max</span><span className="grow">Note</span><span style={{ width: 96 }} /></div>
      {rk.tiers.map((t, i) => (
        <div key={t.id} className={`rule ${i === ni ? 'is-normal' : i > ni ? 'is-above' : ''}`}>
          <input type="color" value={t.color} onChange={(e) => setRk((r) => ({ ...r, tiers: r.tiers.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) }))} style={{ width: 34, height: 30, background: 'none', border: 0 }} />
          <label className="tier-normal" title="Normal tier: where green days bring you back to"><input type="radio" name="normal-tier" checked={i === ni} onChange={() => setRk((r) => ({ ...r, normalTier: t.id }))} aria-label={`Make “${t.name}” the Normal tier`} /></label>
          {[['name', 'Name', 156, 'text'], ['capDD', 'Drawdown', 96, 'dd'], ['dailyLL', 'Daily LL (USD)', 88, 'number'], ['riskMin', 'Risk min (USD)', 88, 'number'], ['riskMax', 'Risk max (USD)', 88, 'number'], ['note', 'Note', 0, 'text']].map(([f, ph, w, type]) => (type === 'dd'
            ? i < ni
              ? <input key={f} className={`input ${firmDD && Number(t.capDD) >= firmDD ? 'warn-input' : ''}`} type="number" min="0" placeholder="none" title={`Drawdown (USD) at which you drop to “${t.name}”. Leave empty for no drawdown trigger (losing streaks only).${firmDD && Number(t.capDD) > 0 ? ` ${Math.round((Number(t.capDD) / firmDD) * 100)}% of the firm’s ${money0(firmDD)} max drawdown.` : ''}`} aria-label={`Drawdown for ${t.name}`} style={{ height: 32, width: w }} value={t.capDD ?? ''} onChange={(e) => setRk((r) => ({ ...r, tiers: r.tiers.map((x, j) => (j === i ? { ...x, capDD: e.target.value === '' ? null : Number(e.target.value) } : x)) }))} />
              : <span key={f} className="tier-dd-na" style={{ width: w }} title={i === ni ? 'Normal: where you are with no drawdown' : 'Above Normal: reached with green days once unlocked'}>{i === ni ? '—' : 'locked'}</span>
            : <input key={f} className={`input ${w ? '' : 'grow'} ${f === 'dailyLL' && firmDaily && t.dailyLL > firmDaily ? 'warn-input' : ''}`} title={ph} placeholder={ph} type={type} style={{ height: 32, width: w || undefined, minWidth: w ? undefined : 60 }} value={t[f]} onChange={(e) => setRk((r) => ({ ...r, tiers: r.tiers.map((x, j) => (j === i ? { ...x, [f]: type === 'number' ? Number(e.target.value) : e.target.value } : x)) }))} />
          ))}
          <div className="tier-acts">
            <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up (less risk)" aria-label="Move up"><ChevronUp size={14} /></button>
            <button className="icon-btn" disabled={i === rk.tiers.length - 1} onClick={() => move(i, 1)} title="Move down (more risk)" aria-label="Move down"><ChevronDown size={14} /></button>
            <button className="icon-btn" disabled={rk.tiers.length <= 2} onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))} title={rk.tiers.length <= 2 ? 'A plan needs at least two tiers' : 'Remove tier'} aria-label="Remove tier"><Trash size={14} /></button>
          </div>
        </div>
      ))}
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setTiers((ts) => [...ts, newTier(ts[ts.length - 1])])}><Plus size={14} /> Add tier</button>
      {rk.tiers.some((t, i) => i > 0 && Number(t.dailyLL) < Number(rk.tiers[i - 1].dailyLL)) && <div className="risk-warn">Daily loss limits usually go up from the top tier to the bottom one — check the order (a lower row should allow at least as much as the row above it).</div>}
      {(() => {
        const dds = tierDD(rk).slice(0, ni);
        const set = dds.map((v, i) => [v, i]).filter(([v]) => v != null);
        const bad = set.some(([v], k) => k > 0 && v >= set[k - 1][0]);
        return (
          <>
            {bad && <div className="risk-warn">Drawdown thresholds should get bigger towards the top: the lowest-risk tier kicks in at the deepest drawdown.</div>}
            {firmDD > 0 && set.length > 0 && <div className="muted" style={{ fontSize: 12 }}>Against the firm’s {money0(firmDD)} max drawdown: {set.map(([v, i]) => `“${rk.tiers[i].name}” at ${Math.round((v / firmDD) * 100)}%`).join(' · ')}</div>}
          </>
        );
      })()}
      {overDaily && <div className="risk-warn">A daily loss limit here is above this account’s firm daily loss limit of {money0(firmDaily)}.</div>}
      <div className="form-grid" style={{ marginTop: 10 }}>
        <div className="field full"><label className="label">Measure drawdown from</label>
          <Seg value={rk.ddMode === 'start' ? 'start' : 'hwm'} onChange={(v) => setRk({ ...rk, ddMode: v })} options={[{ value: 'start', label: 'Starting balance' }, { value: 'hwm', label: 'High watermark (trailing)' }]} />
          <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>{rk.ddMode === 'start' ? 'Drawdown only counts how far you are below where the account started — profits give you a cushion.' : 'Drawdown counts how far you are below your highest balance — like a trailing max-drawdown rule.'}</span>
        </div>
        <div className="field full"><label className="label">Tier changes from drawdown</label>
          <Seg value={rk.tierUpdate === 'live' ? 'live' : 'eod'} onChange={(v) => setRk({ ...rk, tierUpdate: v })} options={[{ value: 'eod', label: 'At the end of the day' }, { value: 'live', label: 'Straight away' }]} />
          <span className="muted" style={{ fontSize: 12, marginTop: 4 }}>{rk.tierUpdate === 'live' ? 'The tier (and its daily loss limit) changes the moment your drawdown crosses a threshold — even halfway through a day.' : 'The tier is set by your drawdown at the last close, so it never changes halfway through a day: today’s losses count against today’s daily loss limit, and move your tier tomorrow.'}</span>
        </div>
        <div className="field"><label className="label">Consecutive max-loss days before reducing</label><input className="input" type="number" min="1" value={rk.maxLossStreak} onChange={(e) => setRk({ ...rk, maxLossStreak: Math.max(1, Number(e.target.value)) })} /></div>
        <div className="field"><label className="label">Sizable green day = × daily loss limit</label><input className="input" type="number" step="0.25" value={rk.greenMultiple} onChange={(e) => setRk({ ...rk, greenMultiple: Number(e.target.value) })} /></div>
        <div className="field"><label className="label">Look-back for stats (days)</label><input className="input" type="number" value={rk.lookbackDays} onChange={(e) => setRk({ ...rk, lookbackDays: Number(e.target.value) })} /></div>
        {ni < rk.tiers.length - 1 && <label className="row gap8" style={{ fontSize: 13.5, marginTop: 22 }}><input type="checkbox" className="cbx" checked={!!rk.unlockTop} onChange={(e) => setRk({ ...rk, unlockTop: e.target.checked })} /> Unlock {rk.tiers.length - 1 - ni === 1 ? `“${rk.tiers[rk.tiers.length - 1]?.name}”` : `the ${rk.tiers.length - 1 - ni} tiers above “${rk.tiers[ni]?.name}”`} (approved in quarterly risk review)</label>}
      </div>
    </>
  );
}

export function RiskMini({ collapsed }) {
  const risk = useRisk();
  const { state } = useStore();
  if (state.settings.riskEnabled === false) return null;
  const t = risk.tier;
  if (collapsed) return <a href="#/risk" title={`Risk: ${t.name}`} className="nav-item" style={{ justifyContent: 'center' }}><ShieldCheck size={20} style={{ color: t.color }} /></a>;
  return (
    <a href="#/risk" className="risk-mini" style={{ '--tier': t.color }}>
      <div className="row between">
        <span className="row gap6" style={{ fontWeight: 600 }}><ShieldCheck size={15} style={{ color: t.color }} /> {t.name}</span>
        <span className={state.settings.privacy ? 'hidden-val' : ''} style={{ color: risk.dd > 0 ? 'var(--neg)' : 'var(--pos)', fontSize: 12.5 }}>DD −{money0(risk.dd)}</span>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>LL −{money0(t.dailyLL)} · {money0(t.riskMin)}–{money0(t.riskMax)}/trade</div>
      {risk.stopNow && <div className="neg" style={{ fontSize: 12, marginTop: 4, fontWeight: 600 }}>Daily loss limit hit — stop trading</div>}
    </a>
  );
}

