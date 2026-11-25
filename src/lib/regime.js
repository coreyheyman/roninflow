// Macro → Daily Check: today's macro regime from five forces (growth, inflation, liquidity, policy, stress), the
// playbook that usually goes with it, the markets that should confirm it, and how this week's releases could move it.
// A rules-based read of public data — context for your trading, not a signal and not financial advice.
import { stats, valueAt, freqOf, isoDay } from './fredSeries';

const DAY = 86400000;
export const FORCES = [
  { key: 'growth', label: 'Growth', id: 'CFNAI', desc: 'Above-trend vs below-trend national activity (Chicago Fed).' },
  { key: 'inflation', label: 'Inflation', id: 'PPIACO', desc: 'Producer prices — they lead consumer prices by roughly two quarters.' },
  { key: 'liquidity', label: 'Liquidity', id: 'NETLIQ', desc: 'Fed assets minus the reverse repo and the Treasury’s account.' },
  { key: 'policy', label: 'Policy', id: 'DFEDTARU', desc: 'Upper bound of the Fed funds target.' },
  { key: 'stress', label: 'Stress', id: 'BAMLH0A0HYM2', desc: 'High-yield credit spread — the credit stress detector.' },
];
export const FORCE_IDS = FORCES.map((f) => f.id);

const before = (obs, date) => obs.filter((r) => r[0] <= date);
const shift = (date, days) => isoDay(Date.parse(`${date}T00:00:00Z`) + days * DAY);

/** one force as of a date: value, weekly change, direction over about a month, position in its 1-year range */
export function forceRead(obs, key, asOf = null) {
  const o = asOf ? before(obs || [], asOf) : obs || [];
  const s = stats(o);
  if (!s) return null;
  const f = freqOf(o);
  // direction: daily/weekly series vs a month ago; monthly vs the average of the three prints before
  let base;
  if (f === 'd' || f === 'w') base = valueAt(o, shift(s.date, -30));
  else { const prev = o.slice(-4, -1).map((r) => r[1]); base = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : null; }
  const span = s.hi - s.lo;
  const d = base == null ? 0 : s.v - base;
  let dir = 'FLAT';
  if (key === 'policy') dir = d >= 0.125 ? 'UP' : d <= -0.125 ? 'DOWN' : 'FLAT';
  else if (span > 0 && Math.abs(d) > span * 0.1) dir = d > 0 ? 'UP' : 'DOWN';
  const wk = f === 'd' || f === 'w' ? valueAt(o, shift(s.date, -7)) : s.prev;
  const pos = s.pos;
  const state = pos >= 0.9 ? 'EXTREME' : pos >= 0.7 ? 'ELEVATED' : pos <= 0.1 ? 'EXTREME LOW' : pos <= 0.3 ? 'LOW' : dir === 'UP' ? 'RISING' : dir === 'DOWN' ? 'FALLING' : 'NORMAL';
  return { v: s.v, date: s.date, week: wk == null ? null : s.v - wk, dir, pos, state, lo: s.lo, hi: s.hi };
}

const ANY = null;
// key: what defines the regime · full: what the other forces usually do (arrays = any of)
export const REGIMES = [
  {
    id: 'crisis', name: 'Crisis', tone: 'neg', bias: 'off',
    summary: 'Stress high and liquidity tight. Cash, gold, small size only.',
    key: { stress: 'UP', liquidity: 'DOWN' },
    full: { growth: 'DOWN', inflation: ['FLAT', 'DOWN'], liquidity: 'DOWN', policy: ['FLAT', 'DOWN'], stress: 'UP' },
    then: [['down', 'Raise cash'], ['up', 'Buy gold'], ['down', 'Short risk — small positions only']],
    ends: ['Credit spreads tighten', 'VIX falls back below 25'],
    reads: { stocks: ['bearish', 'Rallies get sold until spreads stop widening. Trade smaller, favour shorts and quality.'], gold: ['bullish', 'The safe haven of choice when credit cracks; dips tend to be bought.'], dollar: ['bullish', 'A dash for dollars — the funding currency gets bid in stress.'], oil: ['bearish', 'Demand fears dominate; supply news gets ignored.'] },
  },
  {
    id: 'stagflation', name: 'Stagflation', tone: 'neg', bias: 'off',
    summary: 'Growth slowing while inflation rises. The Fed can’t help — real assets over stocks and bonds.',
    key: { growth: 'DOWN', inflation: 'UP' },
    full: { growth: 'DOWN', inflation: 'UP', liquidity: ['DOWN', 'FLAT'], policy: ['UP', 'FLAT'], stress: ['UP', 'FLAT'] },
    then: [['up', 'Own commodities and gold'], ['down', 'Underweight long bonds'], ['down', 'Trim growth stocks — favour value and energy']],
    ends: ['Producer prices roll over', 'Activity stops falling'],
    reads: { stocks: ['bearish', 'Margins squeezed and multiples compress; energy and staples hold up best.'], gold: ['bullish', 'Inflation hedge with falling real growth — a classic gold backdrop.'], dollar: ['neutral', 'Torn between a hawkish Fed and slowing growth; trades the rate differential.'], oil: ['bullish', 'Supply-driven inflation usually runs through energy.'] },
  },
  {
    id: 'tightening', name: 'Tightening', tone: 'warn', bias: 'off',
    summary: 'The Fed is raising rates and draining liquidity. Expect lower valuations and choppier trends.',
    key: { policy: 'UP', liquidity: 'DOWN' },
    full: { growth: ['FLAT', 'UP'], inflation: ['UP', 'FLAT'], liquidity: 'DOWN', policy: 'UP', stress: ['FLAT', 'UP'] },
    then: [['down', 'Reduce duration'], ['up', 'Favour the dollar and short-dated bills'], ['down', 'Fade rallies in long-duration growth']],
    ends: ['The Fed signals a pause', 'Net liquidity turns up'],
    reads: { stocks: ['bearish', 'Higher discount rates weigh on valuations, most on unprofitable growth.'], gold: ['bearish', 'Rising real yields are gold’s headwind.'], dollar: ['bullish', 'Rate differentials favour the dollar.'], oil: ['neutral', 'Depends on demand; tightening usually slows it with a lag.'] },
  },
  {
    id: 'slowdown', name: 'Slowdown', tone: 'warn', bias: 'off',
    summary: 'Growth and inflation both cooling. Bonds work, cyclicals don’t — wait for the Fed to turn.',
    key: { growth: 'DOWN', inflation: 'DOWN' },
    full: { growth: 'DOWN', inflation: 'DOWN', liquidity: ['FLAT', 'UP'], policy: ['DOWN', 'FLAT'], stress: ['FLAT', 'UP'] },
    then: [['up', 'Add duration — bonds rally'], ['down', 'Cut cyclical exposure'], ['up', 'Favour defensives and quality']],
    ends: ['Activity bottoms', 'The Fed starts cutting'],
    reads: { stocks: ['neutral', 'Defensives outperform; the index waits on the Fed. Earnings estimates drift lower.'], gold: ['bullish', 'Falling yields help gold even as inflation cools.'], dollar: ['bearish', 'Expected cuts erode the dollar’s yield edge.'], oil: ['bearish', 'Weaker demand and cooling prices.'] },
  },
  {
    id: 'reflation', name: 'Reflation', tone: 'pos', bias: 'on',
    summary: 'Growth and inflation picking up together. Cyclicals, commodities and value lead.',
    key: { growth: 'UP', inflation: 'UP' },
    full: { growth: 'UP', inflation: 'UP', liquidity: ['UP', 'FLAT'], policy: ['FLAT', 'UP'], stress: ['DOWN', 'FLAT'] },
    then: [['up', 'Own cyclicals and commodities'], ['down', 'Short long bonds'], ['up', 'Buy dips in small caps and value']],
    ends: ['Inflation forces faster hikes', 'Credit spreads start widening'],
    reads: { stocks: ['bullish', 'Earnings rise with nominal growth; cyclicals and small caps lead.'], gold: ['neutral', 'Inflation helps, rising yields hurt — usually a draw.'], dollar: ['bearish', 'Global growth pulls money out of the dollar.'], oil: ['bullish', 'Strong demand meets tight supply.'] },
  },
  {
    id: 'goldilocks', name: 'Goldilocks', tone: 'pos', bias: 'on',
    summary: 'Growth firming, inflation cooling, stress low. The easiest backdrop to be long risk.',
    key: { growth: 'UP', stress: 'DOWN' },
    full: { growth: 'UP', inflation: ['DOWN', 'FLAT'], liquidity: ['UP', 'FLAT'], policy: ['FLAT', 'DOWN'], stress: 'DOWN' },
    then: [['up', 'Stay long equities, buy dips'], ['up', 'Add growth and tech'], ['down', 'Keep hedges light']],
    ends: ['Inflation turns back up', 'Stress or spreads start rising'],
    reads: { stocks: ['bullish', 'Rising earnings and stable rates — trends persist and dips get bought.'], gold: ['neutral', 'Little need for a haven; drifts with real yields.'], dollar: ['bearish', 'Risk appetite favours higher-beta currencies.'], oil: ['neutral', 'Steady demand without an inflation scare.'] },
  },
  {
    id: 'liquidity', name: 'Liquidity-driven', tone: 'pos', bias: 'on',
    summary: 'Liquidity expanding and stress falling. Risk assets float higher — momentum works.',
    key: { liquidity: 'UP', stress: 'DOWN' },
    full: { growth: ['FLAT', 'UP'], inflation: ['FLAT', 'DOWN'], liquidity: 'UP', policy: ['DOWN', 'FLAT'], stress: 'DOWN' },
    then: [['up', 'Ride momentum in risk assets'], ['up', 'Favour high beta and crypto'], ['down', 'Avoid fighting the trend with shorts']],
    ends: ['The Treasury refills its account', 'The Fed shrinks its balance sheet faster'],
    reads: { stocks: ['bullish', 'Excess cash finds its way into equities; breadth improves.'], gold: ['bullish', 'More money chasing hard assets.'], dollar: ['bearish', 'More dollars in the system weighs on it.'], oil: ['neutral', 'Helped by risk appetite, still driven by supply.'] },
  },
];
export const MIXED = {
  id: 'mixed', name: 'Mixed signals', tone: 'muted', bias: 'neutral',
  summary: 'The forces disagree. No clear regime — trade your levels, keep size normal and stay nimble.',
  key: {}, full: {}, then: [['up', 'Trade levels, not the macro story'], ['down', 'Keep size normal or smaller'], ['up', 'Wait for two forces to line up']],
  ends: ['Two or more forces start moving together'],
  reads: { stocks: ['neutral', 'Range-bound until growth or stress picks a direction.'], gold: ['neutral', 'Follows real yields day to day.'], dollar: ['neutral', 'Trades the next data surprise.'], oil: ['neutral', 'Supply headlines dominate.'] },
};

const matches = (want, dir) => want == null || (Array.isArray(want) ? want.includes(dir) : want === dir);

/** force directions → the regime that fits best, and how many of the five forces agree with it */
export function classify(dirs) {
  let best = null;
  for (const r of REGIMES) {
    const keys = Object.entries(r.key);
    const keyHit = keys.filter(([k, w]) => matches(w, dirs[k])).length / keys.length;
    const full = Object.entries(r.full).filter(([k, w]) => w !== ANY && matches(w, dirs[k])).length;
    if (!best || keyHit > best.keyHit || (keyHit === best.keyHit && full > best.full)) best = { regime: r, keyHit, full };
  }
  if (!best || best.keyHit < 1) return { regime: MIXED, aligned: best ? best.full : 0 };
  return { regime: best.regime, aligned: best.full };
}

const PHRASE = {
  growth: { UP: 'Growth picking up', DOWN: 'Growth down', FLAT: 'Growth steady' },
  inflation: { UP: 'Inflation rising', DOWN: 'Inflation cooling', FLAT: 'Inflation steady' },
  liquidity: { UP: 'Liquidity expanding', DOWN: 'Liquidity tight', FLAT: 'Liquidity steady' },
  policy: { UP: 'Fed tightening', DOWN: 'Fed easing', FLAT: 'Fed on hold' },
  stress: { UP: 'Stress high', DOWN: 'Stress easing', FLAT: 'Stress steady' },
};
/** the playbook's "if" lines: the regime's defining forces first, each ticked when it holds today */
export function conditions(regime, dirs) {
  const order = [...Object.keys(regime.key), ...Object.keys(regime.full).filter((k) => !(k in regime.key) && !Array.isArray(regime.full[k]))];
  return order.slice(0, 3).map((k) => { const w = regime.full[k] || regime.key[k]; const want = Array.isArray(w) ? w[0] : w; return { k, text: PHRASE[k][want], ok: matches(w, dirs[k]) }; });
}

/** the whole read from loaded series: { forces, today: {dirs, regime, aligned}, lastWeek } */
export function readRegime(series) {
  const latest = FORCES.map((f) => series[f.id]?.obs?.[series[f.id].obs.length - 1]?.[0]).filter(Boolean).sort().pop();
  if (!latest) return null;
  const weekAgo = shift(latest, -7);
  const forces = FORCES.map((f) => ({ ...f, now: forceRead(series[f.id]?.obs, f.key), then: forceRead(series[f.id]?.obs, f.key, weekAgo) }));
  if (forces.some((f) => !f.now)) return null;
  const dirsOf = (k) => Object.fromEntries(forces.map((f) => [f.key, f[k]?.dir || 'FLAT']));
  const today = { dirs: dirsOf('now'), ...classify(dirsOf('now')) };
  const lastWeek = { dirs: dirsOf('then'), ...classify(dirsOf('then')) };
  return { forces, today, lastWeek, asOf: latest };
}

// ---------- confirmation markets ----------
// each market's sign from its move over the last month, scaled by its 1-year range
export const CONFIRM = [
  { id: 'BAMLH0A0HYM2', label: 'Credit spreads', tip: 'High-yield spreads widening = lenders demanding more to hold risk.', sign: (d) => (d > 0 ? 'off' : 'on') },
  { id: 'VIXCLS', label: 'Volatility', tip: 'VIX above 20 and rising = risk off; below 16 and falling = risk on.', sign: (d, v) => (v >= 25 || (v >= 20 && d >= 0) ? 'off' : v < 16 && d <= 0 ? 'on' : d > 0 ? 'off' : 'on') },
  { id: 'DTWEXBGS', label: 'US dollar', tip: 'A rising dollar tightens global financial conditions.', sign: (d) => (d > 0 ? 'off' : 'on') },
  { id: 'T10Y2Y', label: 'Yield curve', tip: 'Inverted (2Y above 10Y) = a recession warning; a fast steepening from low levels often comes just before cuts.', sign: (d, v) => (v < 0 ? 'off' : d > 0.15 ? 'off' : d < -0.15 ? 'on' : 'neutral'), neutralBand: 0 },
  { id: 'PCOPPUSDM', label: 'Copper', tip: '“Dr. Copper” — falling copper says industrial demand is weakening.', sign: (d) => (d < 0 ? 'off' : 'on') },
  { id: 'SP500', label: 'Stocks (S&P 500)', tip: 'Equities falling over the month = risk off.', sign: (d) => (d < 0 ? 'off' : 'on') },
  { id: 'DGS10', label: '10Y Treasury yield', tip: 'Yields falling while stocks fall = a flight to safety.', sign: (d) => (d < 0 ? 'off' : 'on') },
];
export function confirmRead(series, bias) {
  const rows = CONFIRM.map((c) => {
    const s = stats(series[c.id]?.obs);
    if (!s) return { ...c, s: null, sign: null, ok: null };
    const span = s.hi - s.lo;
    const d = s.chg ?? 0;
    const sign = c.neutralBand !== 0 && span > 0 && Math.abs(d) < span * 0.05 ? 'neutral' : c.sign(d, s.v);
    return { ...c, s, sign };
  });
  const on = rows.filter((r) => r.sign === 'on').length, off = rows.filter((r) => r.sign === 'off').length;
  const want = bias === 'neutral' ? (off >= on ? 'off' : 'on') : bias;
  for (const r of rows) r.ok = r.sign == null || r.sign === 'neutral' ? null : r.sign === want;
  return { rows, agree: rows.filter((r) => r.ok).length, total: rows.filter((r) => r.s).length, want };
}

// ---------- this week's releases ----------
const HOTCOLD = [
  [/trade balance|goods trade/i, 'Trade gap widening', 'Trade gap narrowing'],
  [/unemployment rate/i, 'Labor weakening — cuts priced in', 'Labor tight — fewer cuts'],
  [/claims/i, 'Layoffs picking up', 'Layoffs staying low'],
  [/core pce|pce price|cpi|ppi|price index|inflation|hicp/i, 'Inflation sticky — yields up, cuts pushed back', 'Disinflation — yields down, risk-on'],
  [/non-?farm|payroll|employment change|adp/i, 'Jobs strong — fewer cuts', 'Hiring slowing — cuts priced in'],
  [/jolts|job openings/i, 'Demand for workers strong', 'Hiring demand cooling'],
  [/average hourly|earnings|wage/i, 'Wage pressure building', 'Wage growth cooling'],
  [/gdp/i, 'Growth beating', 'Growth slowing'],
  [/pmi|ism/i, 'Activity expanding', 'Activity contracting'],
  [/retail sales|spending/i, 'Consumer strong', 'Consumer pulling back'],
  [/sentiment|confidence/i, 'Mood improving', 'Mood souring'],
  [/inventor/i, 'Stockpiles building', 'Stockpiles drawing'],
  [/crude|oil|gasoline/i, 'Supply building — bearish oil', 'Supply drawing — bullish oil'],
  [/housing|home|building|permits|pending|case-shiller/i, 'Housing firming', 'Housing weakening'],
  [/durable|factory|industrial|manufacturing|production|activity index/i, 'Orders and output rising', 'Orders and output falling'],
  [/rate decision|funds rate|fomc|refinancing|cash rate|bank rate|policy rate/i, 'Hawkish — tighter policy', 'Dovish — easier policy'],
];
export function hotCold(title) {
  const r = HOTCOLD.find(([re]) => re.test(title || ''));
  return r ? { hot: r[1], cold: r[2] } : { hot: 'Above forecast', cold: 'Below forecast' };
}

/** the regime as it read at each of the last `weeks` weeks (oldest first) */
export function regimeHistory(series, weeks = 12) {
  const latest = FORCES.map((f) => series[f.id]?.obs?.[series[f.id].obs.length - 1]?.[0]).filter(Boolean).sort().pop();
  if (!latest) return [];
  const out = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const asOf = shift(latest, -7 * k);
    const reads = FORCES.map((f) => forceRead(series[f.id]?.obs, f.key, asOf));
    if (reads.some((r) => !r)) continue;
    const dirs = Object.fromEntries(FORCES.map((f, i) => [f.key, reads[i].dir]));
    out.push({ date: asOf, dirs, ...classify(dirs) });
  }
  return out;
}
