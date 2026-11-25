// Macro → Daily Check: today's macro regime read from five forces, what that environment usually asks for, whether
// the markets agree, and the releases this week that could change the picture.
import { useEffect, useMemo, useState } from 'react';
import { ArrowUp, ArrowDown, ChevronRight, Check, Minus, X, Hexagon, Info, RefreshCw, TriangleExclamationPoint as TriangleAlert } from 'lucide-react';
import { useStore } from '../store/store';
import { Seg } from '../components/ui';
import { isoDay, fmtValue, fmtChange, seriesDef } from '../lib/fredSeries';
import { useSeries } from '../lib/useSeries';
import { useMacro, countdown, FLAGS } from '../lib/macro';
import { FORCE_IDS, CONFIRM_ALL_IDS, readRegime, confirmRead, confirmAssetRead, conditions, regimeHistory, hotCold, hotEffect, assetPlaybook, ASSETS as MARKETS, REGIMES, MIXED } from '../lib/regime';
import { wallClock, fmtTime12, MONTHS } from '../lib/stats';

const FROM = isoDay(Date.now() - 2.2 * 366 * 86400000);
const ASSETS = [{ value: 'general', label: 'General' }, { value: 'stocks', label: 'Stocks' }, { value: 'gold', label: 'Gold' }, { value: 'dollar', label: 'Dollar' }, { value: 'oil', label: 'Oil' }];
const AXES = ['growth', 'inflation', 'stress', 'policy', 'liquidity']; // clockwise from the top
const AXIS_LABEL = { growth: 'GROWTH', inflation: 'INFL', stress: 'STRESS', policy: 'POLICY', liquidity: 'LIQ' };
const DIR_CLS = { UP: 'up', DOWN: 'down', FLAT: 'flat' };
const BIAS_TONE = { bullish: 'pos', bearish: 'neg', neutral: 'muted' };
const biasLabel = (a) => (a.bias !== 'neutral' ? a.bias : a.score > 0 ? 'leaning bullish' : a.score < 0 ? 'leaning bearish' : 'neutral');
const PUSH = { 1: ['helps', 'pos'], '-1': ['hurts', 'neg'], 0: ['no effect', 'flat'] };
/** helps / hurts / steady (not moving) / little effect (moving, but it doesn't matter much for this market) */
const pushLabel = (p, dir) => (p > 0 ? 'helps' : p < 0 ? 'hurts' : dir === 'FLAT' ? 'steady' : 'little effect');
const fmtDay = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${MONTHS[m - 1]} ${dd}, ${y}`; };

function Radar({ now, then, tone, dots }) {
  const S = 300, c = S / 2, R = 108;
  const pt = (i, r) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; return [c + Math.cos(a) * r, c + Math.sin(a) * r]; };
  const poly = (vals) => vals.map((v, i) => pt(i, R * (0.14 + 0.86 * Math.max(0, Math.min(1, v)))).join(',')).join(' ');
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className={`dc-radar tone-${tone}`} role="img" aria-label="Five forces, today and last week">
      {[0.25, 0.5, 0.75, 1].map((k) => <polygon key={k} points={AXES.map((_, i) => pt(i, R * k).join(',')).join(' ')} className="ring" />)}
      {AXES.map((a, i) => { const [x, y] = pt(i, R); return <line key={a} x1={c} y1={c} x2={x} y2={y} className="spoke" />; })}
      <polygon points={poly(then)} className="then" />
      <polygon points={poly(now)} className="now" />
      {now.map((v, i) => { const [x, y] = pt(i, R * (0.14 + 0.86 * v)); return dots ? <circle key={i} cx={x} cy={y} r="5" className={`pdot ${dots[i]}`} /> : <rect key={i} x={x - 3} y={y - 3} width="6" height="6" className="dot" />; })}
      {AXES.map((a, i) => { const [x, y] = pt(i, R + 22); return <text key={a} x={x} y={y + 4} textAnchor="middle">{AXIS_LABEL[a]}</text>; })}
    </svg>
  );
}

function Playbook({ ifs, then, ends }) {
  return (
    <div className="card dc-play">
      <div className="dc-play-row">
        <div className="dc-play-side">
          <span className="dc-k">If:</span>
          <ul>{ifs.length ? ifs.map((c) => <li key={c.k} className={c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'no'}>{c.ok === true ? <Check size={14} /> : c.ok === false ? <X size={14} /> : <Minus size={14} />}{c.text}</li>) : <li className="no"><Minus size={14} />No force is pushing it either way</li>}</ul>
        </div>
        <span className="dc-play-arrow"><ChevronRight size={16} /></span>
        <div className="dc-play-side">
          <span className="dc-k">Then:</span>
          <ul>{then.map(([d, t]) => <li key={t} className={d}>{d === 'up' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}{t}</li>)}</ul>
        </div>
      </div>
      <div className="dc-play-ends">
        <span className="dc-k">Ends when</span>
        <div>{ends.map((e) => <span key={e}><Hexagon size={14} />{e}</span>)}</div>
      </div>
    </div>
  );
}

function ForcesTab({ read, history, asset, play }) {
  return (
    <>
      <div className="card dc-table-card">
        <div className="dc-card-head"><div><b>The five forces</b><p className="muted">Which forces are pushing, and in which direction?</p></div></div>
        <div className="tbl-wrap">
          <table className="tbl dc-tbl">
            <thead><tr><th>Force</th><th className="r">Today</th><th className="r">Week</th><th>Position in 1Y range</th><th className="r">Direction</th><th className="r">State</th>{play && <th className="r">For {MARKETS[asset].name}</th>}</tr></thead>
            <tbody>
              {read.forces.map((f) => {
                const def = seriesDef(f.id);
                return (
                  <tr key={f.key}>
                    <td><div className="col"><b>{f.label}</b><small className="muted">{f.desc}</small></div></td>
                    <td className="r"><b>{fmtValue(def, f.now.v)}</b></td>
                    <td className="r">{fmtChange(def, f.now.week)}</td>
                    <td><span className="dc-range"><i style={{ left: `${f.now.pos * 100}%` }} /></span></td>
                    <td className="r"><span className={`dc-dir ${DIR_CLS[f.now.dir]}`}>{f.now.dir}</span></td>
                    <td className="r"><span className={`dc-state s-${f.now.state.replace(/ /g, '-').toLowerCase()}`}>{f.now.state}</span></td>
                    {play && <td className="r"><span className={`dc-push ${PUSH[play.push[f.key]][1]}`}>{pushLabel(play.push[f.key], f.now.dir)}</span></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {history.length > 1 && (
        <div className="card card-pad dc-hist">
          <b>Regime, week by week</b>
          <div className="dc-hist-row">
            {history.map((h) => <span key={h.date} className={`dc-hist-cell tone-${h.regime.tone}`} title={`${fmtDay(h.date)}: ${h.regime.name} (${h.aligned}/5)`}><i />{h.regime.name.split(' ')[0]}<small>{fmtDay(h.date).replace(/, \d+$/, '')}</small></span>)}
          </div>
        </div>
      )}
    </>
  );
}

function ConfirmTab({ series, regime, asset, play }) {
  const c = play ? confirmAssetRead(series, asset, play.bias) : confirmRead(series, regime.bias);
  const want = play ? (c.want === 'on' ? 'bullish' : 'bearish') : c.want === 'off' ? 'bearish' : 'bullish';
  return (
    <div className="card dc-table-card">
      <div className="dc-card-head">
        <div><b>The confirmation markets</b><p className="muted">{play ? (play.bias === 'neutral' ? <>The forces don’t pick a side for {MARKETS[asset].name} — which way do the markets around it lean? (Counted: {want})</> : <>Do the markets around {MARKETS[asset].name} agree with the {want} read?</>) : <>Do the markets agree with the {regime.bias === 'neutral' ? `leaning (${want})` : `${want} overall read (${regime.name})`}?</>}</p></div>
        <div className="dc-agree">
          <span className="dc-dashes">{c.rows.map((r) => <i key={r.id} className={r.ok === true ? 'ok' : r.ok === false ? 'no' : ''} />)}</span>
          <b>{c.agree}</b><span className="muted">/{c.total}</span>
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl dc-tbl">
          <thead><tr><th style={{ width: 40 }}>OK</th><th>Market</th><th className="r">Today</th><th className="r">1M change</th><th className="r">Sign</th></tr></thead>
          <tbody>
            {c.rows.map((r) => {
              const def = seriesDef(r.id);
              return (
                <tr key={r.id}>
                  <td>{r.ok === true ? <Check size={15} className="pos" /> : r.ok === false ? <X size={15} className="neg" /> : <Minus size={15} className="muted" />}</td>
                  <td><span className="row gap6">{r.label}<span className="dc-tip" title={r.tip}><Info size={13} /></span></span></td>
                  <td className="r"><b>{r.s ? fmtValue(def, r.s.v) : '—'}</b></td>
                  <td className="r muted">{r.s ? fmtChange(def, r.s.chg) : '—'}</td>
                  <td className="r">{r.sign && <span className={`dc-sign ${r.sign}`}>{r.sign === 'neutral' ? 'NEUTRAL' : play ? (r.sign === 'on' ? 'BULLISH' : 'BEARISH') : r.sign === 'off' ? 'RISK OFF' : 'RISK ON'}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Monday–Friday of the current week in your home time zone */
function weekDays(now) {
  const today = wallClock(new Date(now)).slice(0, 10);
  const d = new Date(`${today}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  const mon = new Date(d.getTime() - dow * 86400000);
  return { today, days: Array.from({ length: 5 }, (_, i) => isoDay(mon.getTime() + i * 86400000)) };
}

function TriggerTab({ asset }) {
  const { state, setSetting } = useStore();
  const allCcy = state.settings.dcAllCcy === true;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const { today, days } = weekDays(now);
  const { data, loading, error } = useMacro(`/api/macro/calendar?from=${days[0]}&to=${days[4]}${state.settings.ecTradingView === false ? '&tv=0' : ''}`, { poll: 5 * 60e3 });
  const events = (data?.events || []).filter((e) => !e.allDay && (e.impact === 'high' || e.impact === 'medium') && (allCcy || e.ccy === 'USD'));
  const byDay = Object.fromEntries(days.map((d) => [d, []]));
  for (const e of events) { const d = wallClock(e.t)?.slice(0, 10); if (byDay[d]) byDay[d].push(e); }
  const next = events.filter((e) => Date.parse(e.t) > now).sort((a, b) => a.t.localeCompare(b.t))[0];
  const hc = next && hotCold(next.title);
  const mk = asset !== 'general' ? MARKETS[asset] : null;
  const fx = (title, sign) => { if (!mk) return null; const e = hotEffect(title, asset) * sign; return e ? <span className={`dc-fx ${e > 0 ? 'pos' : 'neg'}`}>{mk.label} {e > 0 ? '▲' : '▼'}</span> : <span className="dc-fx muted">{mk.label} —</span>; };
  const wd = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase();
  return (
    <div className="card dc-table-card">
      <div className="dc-card-head">
        <div><b>This week’s calendar</b><p className="muted">What can move prices, and which way would it push the read?</p></div>
        <Seg value={allCcy ? 'all' : 'usd'} onChange={(v) => setSetting('dcAllCcy', v === 'all')} options={[{ value: 'usd', label: 'USD' }, { value: 'all', label: 'All currencies' }]} />
      </div>
      {error && !data && <div className="ec-warn" style={{ margin: '0 16px 12px' }}><TriangleAlert size={15} /> {error}</div>}
      {next ? (
        <div className={`dc-next imp-${next.impact}`}>
          <div className="dc-next-cd"><small>Next up</small><b>{countdown(Date.parse(next.t) - now)}</b></div>
          <div className="dc-next-body">
            <div className="row gap8 wrap"><b className="dc-next-title">{allCcy && <span>{FLAGS[next.ccy] || ''} </span>}{next.title}</b><span className="muted no-i18n">{wd(wallClock(next.t).slice(0, 10))} {fmtTime12(wallClock(next.t))}</span><span className={`dc-imp ${next.impact}`}>{next.impact === 'high' ? 'HIGH' : 'MED.'} IMPACT</span></div>
            <div className="dc-hc">
              <span><b className="hot">HOTTER</b> → {hc.hot}{fx(next.title, 1)}</span>
              <span><b className="cold">COOLER</b> → {hc.cold}{fx(next.title, -1)}</span>
              {(next.forecast || next.previous) && <span className="muted">forecast {next.forecast || '—'} · previous {next.previous || '—'}</span>}
            </div>
          </div>
        </div>
      ) : <div className="ec-empty" style={{ margin: '0 16px 12px' }}>{loading ? 'Loading this week’s calendar…' : 'Nothing high or medium impact left this week.'}</div>}
      <div className="dc-week">
        {days.map((d) => (
          <div key={d} className={`dc-day ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}`}>
            <div className="dc-day-h">{wd(d)}{d === today && <small>TODAY</small>}</div>
            {byDay[d].length ? byDay[d].map((e) => (
              <a key={e.id} href="#/macro/calendar" className={`dc-ev imp-${e.impact} ${Date.parse(e.t) < now ? 'done' : ''}`} title={hotCold(e.title).hot}>
                <b>{allCcy && `${FLAGS[e.ccy] || ''} `}{e.title}</b>
                <span className="muted">{fmtTime12(wallClock(e.t))}{e.actual ? ` · ${e.actual}` : ''}</span>
                <small>{e.impact === 'high' ? 'HIGH IMPACT' : 'MED. IMPACT'}{mk && hotEffect(e.title, asset) !== 0 && <i className="dc-ev-fx">hotter = {mk.label} {hotEffect(e.title, asset) > 0 ? '▲' : '▼'}</i>}</small>
              </a>
            )) : <span className="dc-none muted">—</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DailyCheck() {
  const { state, setSetting } = useStore();
  const { series, loading, error, refreshing, reload } = useSeries([...FORCE_IDS, ...CONFIRM_ALL_IDS], FROM);
  const read = useMemo(() => readRegime(series), [series]);
  const history = useMemo(() => regimeHistory(series, 12), [series]);
  const asset = MARKETS[state.settings.dcAsset] ? state.settings.dcAsset : 'general';
  const setAsset = (v) => setSetting('dcAsset', v);
  const [tab, setTab] = useState('regime');
  if (!read) {
    return (
      <div className="page dc-page">
        <h1 className="page-title macro-title">Daily Check</h1>
        {error && <div className="ec-warn"><TriangleAlert size={15} /> {error}</div>}
        <div className="ec-empty">{loading || refreshing ? 'Reading the five forces from FRED… (the first time takes a few seconds)' : 'Not enough data yet to read the regime — try again in a minute.'}</div>
      </div>
    );
  }
  const g = read.today.regime;
  const last = read.lastWeek.regime;
  const mk = MARKETS[asset];
  const play = mk ? assetPlaybook(asset, read.today.dirs) : null;
  const playLast = mk ? assetPlaybook(asset, read.lastWeek.dirs) : null;
  const tone = play ? BIAS_TONE[play.bias] : g.tone;
  const pos = (k) => AXES.map((a) => read.forces.find((f) => f.key === a)[k].pos);
  const book = play ? play : { ifs: conditions(g, read.today.dirs), then: g.then, ends: g.ends };
  return (
    <div className={`page dc-page tone-${tone}`}>
      <div className="dc-hero">
        <div className="dc-hero-l">
          <span className="dc-eyebrow">{play ? `${mk.label} · today’s read` : 'Today’s regime'}</span>
          {play ? (
            <>
              <h1 className="dc-name dc-bias-name">{biasLabel(play)}</h1>
              <p className="dc-sum">The five forces net out <b>{play.score > 0 ? '+' : ''}{play.score}</b> for {mk.name}: {play.support} pushing {play.bias === 'bearish' ? 'against it' : 'for it'}, {play.against} the other way. <span className="muted">In a {g.name.toLowerCase()} regime: {g.reads[asset][1]}</span></p>
            </>
          ) : (
            <>
              <h1 className="dc-name">{g.name}</h1>
              <p className="dc-sum">{g.summary}</p>
            </>
          )}
          <div className="row gap8 wrap">
            {play
              ? play.bias === 'neutral'
                ? <span className="dc-aligned" title={`Forces pushing ${mk.name} up / down`}>For / against {mk.name}:&nbsp;<b>{Object.values(play.push).filter((v) => v > 0).length}</b>&nbsp;/&nbsp;<b>{Object.values(play.push).filter((v) => v < 0).length}</b></span>
                : <span className="dc-aligned" title={`How many of the five forces push ${mk.name} the way of today’s read`}>Forces {play.bias === 'bearish' ? 'against' : 'behind'} {mk.name}:&nbsp;<b>{play.support}</b>/5</span>
              : <span className="dc-aligned" title="How many of the five forces are doing what this regime usually looks like">Forces aligned:&nbsp;<b>{read.today.aligned}</b>/5</span>}
            {play ? (playLast.bias !== play.bias && <span className="dc-was muted">Last week: {biasLabel(playLast)}</span>) : last.id !== g.id && <span className="dc-was muted">Last week: {last.name}</span>}
            {play && <span className={`dc-regime-tag tone-${g.tone}`}>{g.name}</span>}
          </div>
        </div>
        <div className="dc-hero-c">
          <span className="dc-eyebrow center">Read the page for</span>
          <Seg value={asset} onChange={setAsset} options={ASSETS} />
          <Radar now={pos('now')} then={pos('then')} tone={tone} dots={play ? AXES.map((a) => PUSH[play.push[a]][1]) : null} />
          <div className="dc-radar-key">
            <span><i className="now" />Today</span><span><i className="then" />Last week</span>
            {play && <><span><i className="pd pos" />Helps</span><span><i className="pd neg" />Hurts</span></>}
          </div>
        </div>
        <div className="dc-hero-r">
          <span className="dc-eyebrow center">{play ? `What each force does to ${mk.name}` : 'Regime details'}</span>
          {read.forces.map((f) => (
            play ? (
              <div key={f.key} className="dc-detail" title={`${f.label} ${f.now.dir.toLowerCase()} — ${pushLabel(play.push[f.key], f.now.dir)} for ${mk.name}`}>
                <i className={PUSH[play.push[f.key]][1] === 'flat' ? 'flat' : PUSH[play.push[f.key]][1] === 'pos' ? 'up' : 'down'} /><span>{f.label} <small className="muted">{f.now.dir.toLowerCase()}</small></span>
                <b className={`dc-push ${PUSH[play.push[f.key]][1]}`}>{pushLabel(play.push[f.key], f.now.dir)}</b>
              </div>
            ) : (
              <div key={f.key} className="dc-detail"><i className={DIR_CLS[f.now.dir]} /><span>{f.label}</span><b className={`dc-dir ${DIR_CLS[f.now.dir]}`}>{f.now.dir}</b></div>
            )
          ))}
          <span className="muted dc-asof">Data to {fmtDay(read.asOf)} <button className="icon-btn" onClick={reload} title="Reload"><RefreshCw size={13} className={refreshing ? 'spin' : ''} /></button></span>
        </div>
      </div>

      <div className="dc-sec-head"><b>Playbook{play ? ` · ${mk.label}` : ''}</b><p className="muted">{play ? `What this backdrop usually asks for in ${mk.name}.` : 'What does this environment usually ask for?'}</p></div>
      <Playbook {...book} />

      <div className="dc-tabs">
        {[['regime', 'Regime'], ['confirm', 'Confirmation'], ['trigger', 'Trigger']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'regime' && <ForcesTab read={read} history={history} asset={asset} play={play} />}
      {tab === 'confirm' && <ConfirmTab series={series} regime={g} asset={asset} play={play} />}
      {tab === 'trigger' && <TriggerTab asset={asset} />}

      <details className="dc-how card card-pad">
        <summary>How the regime is read</summary>
        <p>Each force’s direction compares today with about a month ago (monthly data: with the average of the three prints before), measured against its own 1-year range — a move of more than a tenth of that range counts as up or down. The regime is the pattern the directions fit best: {[...REGIMES, MIXED].map((r) => r.name).join(', ')}. “Forces aligned” counts how many of the five forces match that pattern.</p>
        <p>For a market, each force that is moving counts +1 if it usually helps that market and −1 if it hurts it: stocks like growth and liquidity and dislike inflation, tightening and stress; gold likes inflation, liquidity and stress and dislikes tightening; the dollar likes growth, inflation, tightening and stress; oil likes growth, inflation and liquidity. +2 or more reads bullish, −2 or less bearish.</p>
        <p className="muted">Sources: FRED® — Chicago Fed National Activity Index, producer prices, the Fed’s balance sheet, reverse repo and Treasury account, the Fed funds target and ICE BofA high-yield spreads. A rules-based read of public data, not financial advice.</p>
      </details>
    </div>
  );
}
