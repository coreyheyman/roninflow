import { useMemo, useState } from 'react';
import { Settings, TrendingDown, TrendingUp, TriangleExclamationPoint as TriangleAlert, ShieldCheck, Calculator } from 'lucide-react';
import { useStore, useAccountTrades } from '../store/store';
import { AccountPicker, Private, Money, Seg } from '../components/ui';
import { PnlChart } from '../components/Charts';
import { TierCards, BlockerStrip, BiggestBlocker, PlaybookSettings, useRisk } from '../components/Playbook';
import { riskOf, ownRiskOf } from '../lib/playbook';
import { equityCurve, fmtDate, fmtShortDate, fmtMoney, money0, POINT_VALUE, fmtTime12 } from '../lib/stats';
import { useOpenDay } from '../lib/dayPopup';
import CoachReview from '../components/CoachReview';
import { accountDrawdown, ddTypeLabel } from '../lib/accountDD';
import { balanceGap, accountBalanceInfo } from '../lib/balance';
import { keyOf, groupByDay } from '../lib/stats';

const SYMS = ['MES', 'MNQ', 'ES', 'NQ', 'MYM', 'M2K', 'MGC', 'MCL', 'GC', 'CL'];
const TICK = { MES: 0.25, ES: 0.25, MNQ: 0.25, NQ: 0.25, MYM: 1, YM: 1, M2K: 0.1, RTY: 0.1, MGC: 0.1, GC: 0.1, MCL: 0.01, CL: 0.01 };

export default function Risk() {
  const openDay = useOpenDay();
  const { state, setSetting } = useStore();
  const trades = useAccountTrades();
  const risk = useRisk();
  const cfg = riskOf(state);
  const [settings, setSettings] = useState(false);
  const [sym, setSym] = useState('MES');
  const [stop, setStop] = useState(8);
  const [fee, setFee] = useState(0.62);
  const acct = state.accounts.find((a) => a.id === state.settings.account);
  const t = risk.tier;

  const fromStart = risk.ddMode === 'start';
  const underwater = useMemo(() => {
    let peak = 0;
    return equityCurve(trades).map((p) => { peak = fromStart ? 0 : Math.max(peak, p.y); return { label: fmtDate(p.x), y: Math.round(Math.min(0, p.y - peak) * 100) / 100, tip: `${fmtDate(p.x)} · ${fmtTime12(p.x)} · drawdown` }; });
  }, [trades, fromStart]);
  const riskChart = state.settings.riskChart === 'dd' ? 'dd' : 'equity';
  const equity = useMemo(() => equityCurve(trades).map((p) => ({ label: fmtDate(p.x), y: Math.round(p.y * 100) / 100, tip: `${fmtDate(p.x)} · ${fmtTime12(p.x)} · ${p.t.symbol}` })), [trades]);
  // the account's own plan if it has one, else the default plan
  const own = ownRiskOf(state, state.settings.account);
  const setDdMode = (ddMode) => (own
    ? setSetting('riskByAccount', (m) => ({ ...(m || {}), [state.settings.account]: { ...m[state.settings.account], ddMode } }))
    : setSetting('risk', (r) => ({ ...(r || {}), ddMode })));

  // ---- coach review of the account's condition: recent window + everything the risk page knows ----
  const coach = useMemo(() => {
    const days = Math.max(14, Math.min(90, Number(cfg.lookbackDays) || 30, 30));
    const from = keyOf(new Date(Date.now() - days * 86400000));
    const prevFrom = keyOf(new Date(Date.now() - 2 * days * 86400000));
    const day = (x) => String(x.entry).slice(0, 10);
    const recent = trades.filter((x) => day(x) >= from);
    const prev = trades.filter((x) => day(x) >= prevFrom && day(x) < from);
    const id = state.settings.account;
    const gap = balanceGap(state, id);
    const curve = equityCurve(trades);
    const hwm = Math.max(0, ...curve.map((p) => p.y + gap));
    const current = risk.current;
    const live = id !== 'all' ? accountBalanceInfo(state, id)?.live : null;
    const firmMax = Number(acct?.maxDrawdown) || null;
    const fdd = acct ? accountDrawdown(state, acct) : null; // by the account's drawdown type
    const firmUsed = fdd ? fdd.used : Math.max(0, hwm - current);
    const tier = risk.tier;
    const sessions = groupByDay(trades);
    const llHits = sessions.filter((d) => d.date >= from && d.net <= -tier.dailyLL * 0.95).map((d) => ({ date: d.date, net: Math.round(d.net * 100) / 100 }));
    const bigLosses = recent.filter((x) => x.pnl < -tier.riskMax).map((x) => ({ date: day(x), time: fmtTime12(x.entry), symbol: x.symbol, pnl: x.pnl, qty: x.qty }));
    let redStreak = 0;
    for (const d of sessions) { if (d.net < 0) redStreak++; else break; }
    const next = risk.level < risk.normal ? risk.tiers[risk.level + 1] : null;
    const extra = {
      window: `last ${days} days (${from} → today)`,
      account: acct ? { name: acct.name || acct.id, status: acct.status, phase: acct.phase, startingBalance: acct.initial, balance: live ?? risk.balance, liveBalanceFromATAS: live != null, profitTarget: acct.profitTarget || null, firmDailyLossLimit: acct.dailyLossLimit || null } : { name: 'All accounts combined (drawdown is approximate)' },
      netSinceStart: Math.round(current * 100) / 100,
      balanceAdjustment: gap ? Math.round(gap * 100) / 100 : undefined,
      drawdownMode: risk.ddMode === 'start' ? 'from starting balance' : 'from high watermark',
      currentDrawdown: Math.round(risk.dd * 100) / 100,
      highWatermark: Math.round(hwm * 100) / 100,
      highWatermarkDate: risk.peakAt ? String(risk.peakAt).slice(0, 10) : null,
      firmMaxDrawdown: firmMax,
      firmDrawdownType: acct ? `${ddTypeLabel(acct)}${fdd?.locked ? ' (floor locked at starting balance)' : ''}` : undefined,
      firmDrawdownFloorBalance: fdd ? Math.round(fdd.floor * 100) / 100 : undefined,
      firmDrawdownUsed: firmMax ? Math.round(firmUsed * 100) / 100 : undefined,
      roomToFirmMaxDrawdown: firmMax ? Math.round((fdd ? fdd.left : firmMax - firmUsed) * 100) / 100 : null,
      riskTier: { name: tier.name, dailyLossLimit: tier.dailyLL, riskPerTrade: `${tier.riskMin}-${tier.riskMax}`, riskMax: tier.riskMax, note: tier.note },
      tierReasons: risk.reasons,
      tiers: risk.tiers.map((x, i) => ({ level: i, name: x.name, dailyLossLimit: x.dailyLL, riskPerTrade: `${x.riskMin}-${x.riskMax}`, current: i === risk.level, locked: i > risk.normal })),
      tierRules: `Drop to "${risk.tiers[1]?.name}" at ${cfg.riskOffDD} drawdown and to "${risk.tiers[0]?.name}" at ${cfg.damageDD}. Reduce a tier after ${cfg.maxLossStreak} consecutive max-loss days, then after every further red day. Move up a tier after a green day of at least ${cfg.greenMultiple}x the current daily loss limit, up to "${risk.tiers[risk.normal]?.name}".`,
      toNextTierUp: next ? `A green day of +${Math.round(tier.dailyLL * cfg.greenMultiple)} or more moves you up to "${next.name}" (if drawdown allows)` : 'Already at the normal tier',
      toRiskOff: risk.toRiskOff == null ? null : Math.round(risk.toRiskOff * 100) / 100, toDamageControl: risk.toDamage == null ? null : Math.round(risk.toDamage * 100) / 100,
      tierHistory: risk.history,
      today: { net: Math.round(risk.todayNet * 100) / 100, roomBeforeDailyLossLimit: Math.round(risk.remaining * 100) / 100, shouldStop: risk.stopNow },
      currentRedStreakDays: redStreak,
      dailyLossLimitHits: llHits,
      lossesBiggerThanTierRisk: bigLosses.slice(0, 15),
    };
    const sig = `${Math.round(risk.dd)}|${risk.level}|${Math.round(current)}|${recent.length}`;
    return { recent, prev, extra, days, sig };
  }, [trades, state, risk, cfg, acct]);

  const pv = POINT_VALUE[sym] || 1;
  const perContract = stop * pv + fee * 2;
  const qty = (r) => Math.max(0, Math.floor(r / perContract));
  const maxScale = Math.max(cfg.damageDD * 1.25, risk.dd * 1.1, 1);
  const pct = (v) => `${Math.min(100, (v / maxScale) * 100)}%`;

  return (
    <div className="page">
      <div className="toolbar">
        <AccountPicker />
        <div className="grow" />
        <span className="risk-plan-tag" title={own ? 'This account has its own risk rules' : 'This account follows the default risk plan — open Risk rules to give it its own'}>
          <ShieldCheck size={13} /> {own ? <b>Own rules for this account</b> : state.settings.account === 'all' ? 'Default rules' : <>Default rules</>}
        </span>
        <button className="btn" onClick={() => setSettings(true)}><Settings size={15} /> Risk rules</button>
      </div>
      {state.settings.account === 'all' && (
        <div className="badge neutral" style={{ padding: '8px 12px', marginBottom: 16, whiteSpace: 'normal' }}><TriangleAlert size={14} /> All accounts are combined. Pick one account for an accurate drawdown.</div>
      )}

      <div className="kpis">
        <div className={`kpi ${risk.dd > 0 ? 'negc' : 'posc'}`} style={{ minHeight: 160 }}>
          <div className="row between" style={{ gap: 8 }}>
            <div className="kpi-head">Current drawdown</div>
            <div className="dd-mode" role="radiogroup" aria-label="Drawdown measured from">
              <button className={fromStart ? 'on' : ''} onClick={() => setDdMode('start')} title="Measure from your starting balance">Start</button>
              <button className={!fromStart ? 'on' : ''} onClick={() => setDdMode('hwm')} title="Measure from your highest balance (trailing high watermark)">Peak</button>
            </div>
          </div>
          <div className="kpi-val" style={{ marginTop: 14 }}><Private className={risk.dd > 0 ? 'neg' : 'pos'}>{risk.dd > 0 ? '−' : ''}{fmtMoney(risk.dd)}</Private></div>
          <div className="kpi-foot">{fromStart
            ? <>From your starting balance{acct?.initial ? <> of <Private>{money0(acct.initial)}</Private></> : null}</>
            : risk.peakAt ? <>From high watermark <Private>{fmtMoney(risk.peak, { sign: true })}</Private> on {fmtDate(risk.peakAt)}</> : 'From your starting balance (no new high yet)'}</div>
        </div>
        <div className="kpi neu" style={{ minHeight: 160, '--tier': t.color }}>
          <div className="kpi-head">Current risk tier</div>
          <div className="row gap8" style={{ marginTop: 18, fontSize: 26, fontWeight: 500 }}><ShieldCheck size={24} style={{ color: t.color }} /> {t.name}</div>
          <div className="kpi-foot">Daily LL −{money0(t.dailyLL)} · {money0(t.riskMin)}–{money0(t.riskMax)} per trade</div>
        </div>
        <div className={`kpi ${risk.stopNow ? 'negc' : 'neu'}`} style={{ minHeight: 160 }}>
          <div className="kpi-head">Today</div>
          <div className="kpi-val" style={{ marginTop: 18 }}><Money v={risk.todayNet} colored sign /></div>
          <div className="kpi-foot">{risk.stopNow ? <b className="neg">Daily loss limit hit — stop trading</b> : <>Room before daily LL: <Private>{money0(Math.max(0, risk.remaining))}</Private></>}</div>
        </div>
        <div className="kpi neu" style={{ minHeight: 160 }}>
          <div className="kpi-head">Account</div>
          <div className="kpi-val" style={{ marginTop: 18 }}><Private>{money0(risk.balance)}</Private></div>
          <div className="kpi-foot">{acct ? `${acct.status} · start ${money0(acct.initial)} · max DD ${money0(acct.maxDrawdown || 0)}` : 'Combined'}</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 22 }}>
        <div className="panel-head"><div className="card-title">Current risk <span className="muted" style={{ fontWeight: 400 }}>(based on performance and market/edge alignment)</span></div></div>
        <TierCards risk={risk} />
        <div className="muted" style={{ fontSize: 12.5, marginTop: 12, textAlign: 'center' }}>
          Reduce risk after {cfg.maxLossStreak} consecutive max-loss days, then reduce after every consecutive red day thereafter. Increase risk after every sizable green day until normal risk is reached.
        </div>
      </div>

      <div className="dash-grid">
        <div className="panel">
          <div className="panel-head"><div className="card-title">Why this tier</div></div>
          <ul style={{ margin: '0 0 16px', paddingLeft: 18, lineHeight: 1.7, fontSize: 14 }}>
            {risk.reasons.map((r) => <li key={r}>{r}.</li>)}
            {risk.ruleLevel !== risk.ddLevel && <li className="muted">Rules say “{risk.tiers[risk.ruleLevel].name}”, drawdown allows “{risk.tiers[risk.ddLevel].name}” — the lower one applies.</li>}
          </ul>
          <div className="label">Drawdown vs thresholds</div>
          <div className="dd-bar">
            <i style={{ width: pct(risk.dd) }} />
            <span className="mark" style={{ left: pct(cfg.riskOffDD) }}><em>{risk.tiers[1]?.name} {money0(cfg.riskOffDD)}</em></span>
            <span className="mark" style={{ left: pct(cfg.damageDD) }}><em>{risk.tiers[0]?.name} {money0(cfg.damageDD)}</em></span>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 30 }}>
            {risk.toRiskOff !== null ? <>You can lose <Private>{money0(risk.toRiskOff)}</Private> more {fromStart ? 'below your starting balance' : 'from the peak'} before dropping to “{risk.tiers[1]?.name}”.</> : risk.toDamage !== null ? <><Private>{money0(risk.toDamage)}</Private> more drawdown puts you in “{risk.tiers[0]?.name}”.</> : <>Recover <Private>{money0(risk.dd - cfg.damageDD + 1)}</Private> to leave “{risk.tiers[0]?.name}”.</>}
          </div>
          <div className="label" style={{ marginTop: 22 }}>Last 10 sessions</div>
          <div className="row gap6 wrap">
            {risk.recent.map((d) => (
              <a key={d.date} href={`#/diary/${d.date}`} onClick={(e) => { e.preventDefault(); openDay(d.date); }} className={`sess ${d.net >= 0 ? 'up' : 'dn'}`} title={`${fmtDate(d.date)}: ${fmtMoney(d.net, { sign: true })}`}>
                <span>{fmtShortDate(d.date)}</span>
                <b className={state.settings.privacy ? 'hidden-val' : ''}>{fmtMoney(d.net, { sign: true, dp: 0 })}</b>
              </a>
            ))}
            {!risk.recent.length && <span className="muted">No sessions yet.</span>}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div className="card-title">{riskChart === 'equity' ? 'Net P&L' : fromStart ? 'Below starting balance' : 'Drawdown from peak'}</div>
            <Seg value={riskChart} onChange={(v) => setSetting('riskChart', v)} options={[{ value: 'equity', label: 'P&L' }, { value: 'dd', label: 'Drawdown' }]} />
          </div>
          {underwater.length
            ? <PnlChart data={riskChart === 'equity' ? equity : underwater} mode="area" height={250} xLabels={6} startAtZero />
            : <div className="empty">No trades yet.</div>}
          {underwater.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{riskChart === 'equity'
            ? 'Same curve as the dashboard’s Net P&L chart.'
            : fromStart ? 'How far below the starting balance you were after each trade (0 = at or above it).' : 'How far below your highest point you were after each trade (0 = at a new high).'}</div>}
          <div className="label" style={{ marginTop: 14 }}>Tier changes</div>
          {risk.history.length ? risk.history.slice(0, 6).map((h, i) => (
            <div key={i} className="check-item" style={{ fontSize: 13 }}>
              {h.dir < 0 ? <TrendingDown size={14} className="neg" /> : <TrendingUp size={14} className="pos" />}
              <span style={{ width: 96 }} className="muted">{fmtDate(h.date)}</span>
              <span className="grow">{h.why}</span>
              <span className="badge neutral">→ {risk.tiers[h.to].name}</span>
            </div>
          )) : <div className="muted" style={{ fontSize: 13 }}>No rule-based tier changes yet.</div>}
        </div>
      </div>

      <div className="dash-grid">
        <div className="panel">
          <div className="panel-head"><div className="card-title row gap8"><Calculator size={15} /> Position size for this tier</div></div>
          <div className="row gap12 wrap">
            <div className="field" style={{ width: 120 }}><label className="label">Symbol</label><select className="select" value={sym} onChange={(e) => setSym(e.target.value)}>{SYMS.map((s) => <option key={s}>{s}</option>)}</select></div>
            <div className="field" style={{ width: 140 }}><label className="label">Stop (points)</label><input className="input" type="number" step={TICK[sym] || 0.25} value={stop} onChange={(e) => setStop(Number(e.target.value))} /></div>
            <div className="field" style={{ width: 160 }}><label className="label">Commission / side (USD)</label><input className="input" type="number" step="0.01" value={fee} onChange={(e) => setFee(Number(e.target.value))} /></div>
          </div>
          <div className="row gap16" style={{ marginTop: 16 }}>
            {[['Min risk', t.riskMin], ['Max risk', t.riskMax]].map(([k, r]) => (
              <div key={k} className="hold-card grow" style={{ textAlign: 'left', padding: 16 }}>
                <div className="muted" style={{ fontSize: 12 }}>{k} {money0(r)}</div>
                <div style={{ fontSize: 26, fontWeight: 500, marginTop: 6 }}>{qty(r)} <span className="muted" style={{ fontSize: 14 }}>contract{qty(r) === 1 ? '' : 's'}</span></div>
                <div className="muted" style={{ fontSize: 12 }}>{fmtMoney(qty(r) * perContract)} at risk</div>
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>{stop} pt × {fmtMoney(pv)}/pt + round-trip fees = {fmtMoney(perContract)} per contract.{qty(t.riskMax) === 0 && ' Your stop is too wide for this tier — tighten it or skip the trade.'}</div>
        </div>
        <div className="col gap16">
          <div className="panel">
            <div className="card-title" style={{ marginBottom: 8 }}>Biggest edge blocker</div>
            <div style={{ fontSize: 15 }}><BiggestBlocker /></div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Flagged on individual trades: open a trade and pick its edge blockers. <a className="accent" href="#/diary">Open diary →</a></div>
          </div>
          <BlockerStrip />
        </div>
      </div>
      <div style={{ marginTop: 22 }}>
        <CoachReview
          reviewKey={`risk:${state.settings.account}`}
          kind="risk"
          noun="account"
          label={`${acct ? acct.name || acct.id : 'All accounts'} · account condition (last ${coach.days} days)`}
          trades={coach.recent}
          prevTrades={coach.prev}
          extra={coach.extra}
          signature={coach.sig}
          intro="Have your Trading Coach assess where this account stands — drawdown, risk tier and recent sessions — and get a plan to get back on track or stay on track."
        />
      </div>
      <PlaybookSettings open={settings} initialTab="risk" onClose={() => setSettings(false)} />
    </div>
  );
}
