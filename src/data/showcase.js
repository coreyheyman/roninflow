// A complete made-up journal for the public demo site (built with VITE_DEMO=1). Nothing here is real.
// Deterministic (seeded), and dated relative to today so the demo always looks current.
import { initialState } from './seed';
import { keyOf, pad } from '../lib/stats';

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const pick = (r, list) => list[Math.floor(r() * list.length)];
const daysAgo = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
const iso = (n) => keyOf(daysAgo(n));

const SPECS = { MES: { pv: 5, tick: 0.25, base: 6050, fee: 0.74 }, MNQ: { pv: 2, tick: 0.25, base: 21400, fee: 0.74 }, MCL: { pv: 100, tick: 0.01, base: 71.2, fee: 0.84 } };

const STRATEGIES = [
  {
    id: 'st_orb', name: 'Opening Range Breakout', category: 'Breakout', description: 'Trade the break of the first 15-minute range in the direction of the higher-timeframe trend.',
    tags: ['Futures', 'Open'], timeframes: ['1m', '5m'], conditions: ['Trending'], rr: '1:2',
    entryRules: ['Mark the 15-minute opening range', 'Enter on a 1-minute close outside the range with volume above average', 'Only trade in the direction of the daily trend'],
    exitRules: ['Stop on the other side of the breakout candle', 'Take half at 1R, trail the rest under 1-minute swing lows'],
    riskRules: ['Max 2 attempts per day', 'Skip if the range is wider than 1.5× the average'], media: [], links: [], notes: '',
  },
  {
    id: 'st_vwap', name: 'VWAP Reclaim', category: 'Mean reversion', description: 'After a flush below VWAP, buy the first clean reclaim and hold back to the prior high.',
    tags: ['Futures'], timeframes: ['1m'], conditions: ['Range-bound', 'Trending'], rr: '1:2.5',
    entryRules: ['Price loses VWAP and stalls at a level', 'Enter on the first 1-minute close back above VWAP'],
    exitRules: ['Stop below the flush low', 'Target the prior swing high'], riskRules: ['No entries in the first 5 minutes'], media: [], links: [], notes: '',
  },
  {
    id: 'st_fade', name: 'Failed Breakout Fade', category: 'Reversal', description: 'Fade a breakout that traps traders and comes back inside the range.',
    tags: ['Futures', 'Range'], timeframes: ['1m', '5m'], conditions: ['Range-bound', 'Quiet'], rr: '1:1.5',
    entryRules: ['Breakout of a clear range high/low fails within 3 bars', 'Enter when price closes back inside the range'],
    exitRules: ['Stop above the failed high', 'Target the middle, then the other side of the range'], riskRules: ['Only in range-bound conditions'], media: [], links: [], notes: '',
  },
];

const ACCOUNTS = [
  { id: 'DEMO-PA-100K', name: 'DEMO-PA-100K', phase: 'Funded', market: 'Futures', plan: '100K Funded', status: 'Funded', initial: 100000, profitTarget: 0, maxDrawdown: 3000, dailyLossLimit: 2000, ddType: 'eod', broker: 'Demo Prop Firm', cost: 167, fees: 85, created: 95 },
  { id: 'DEMO-EVAL-50K', name: 'DEMO-EVAL-50K', phase: 'Challenge', market: 'Futures', plan: '50K Challenge', status: 'Active', initial: 50000, profitTarget: 3000, maxDrawdown: 2000, dailyLossLimit: 1000, ddType: 'intraday', broker: 'Demo Prop Firm', cost: 99, fees: 0, created: 26 },
  { id: 'DEMO-EVAL-150K', name: 'DEMO-EVAL-150K', phase: 'Challenge', market: 'Futures', plan: '150K Challenge', status: 'Breached', initial: 150000, profitTarget: 9000, maxDrawdown: 4500, dailyLossLimit: 3000, ddType: 'eod', broker: 'Demo Prop Firm', cost: 199, fees: 0, created: 120 },
];

const CONDITIONS = ['trend', 'trend', 'range', 'range', 'volatile', 'quiet']; // ids from DEFAULT_PLAYBOOK
const NOTES = [
  'Waited for the open to settle and took the ORB long. Clean day — stuck to two trades.',
  'Chopped around VWAP early. Took one bad trade out of boredom, then sat on my hands.',
  'News at 7:00 made it fast. Sized down to the bottom tier and it paid off.',
  'Best day of the week: patient entries and I let the runner work.',
  'Moved my stop on the second trade. Need to stop doing that — it turned a small loss into a full one.',
  'Quiet tape. One fade at the range high, then done for the day.',
  'Overtraded after the first loss. Three trades in ten minutes. Walked away after hitting the daily limit.',
  'Good read on the range. Took the failed breakout short and covered at the mid.',
];
const TOMORROW = ['Wait for the 15-minute range before any trade', 'No more than 3 trades', 'Keep the stop where it is', 'Only A+ setups — skip the chop', 'Take partials at 1R'];
const BIAS = ['Long above the overnight high', 'Neutral — range day expected', 'Short below VWAP', 'Long bias, trend day', 'Wait for the open'];

/** Trades for one account over `days` trading days ending `endAgo` days ago. */
function tradesFor(acct, r, { days, endAgo = 1, edge = 0.53, size = 1, reach = 1 }, diaryDays) {
  const out = [];
  const price = Object.fromEntries(Object.entries(SPECS).map(([k, v]) => [k, v.base]));
  let made = 0;
  for (let ago = endAgo; made < days; ago++) {
    const d = daysAgo(ago);
    if ([0, 6].includes(d.getDay())) continue;
    made++;
    const date = keyOf(d);
    const cond = diaryDays[date]?.cond || pick(r, CONDITIONS);
    diaryDays[date] = diaryDays[date] || { cond, trades: [] };
    const count = 1 + Math.floor(r() * (cond === 'volatile' ? 5 : 3));
    let minute = 6 * 60 + 33 + Math.floor(r() * 25);
    for (let i = 0; i < count; i++) {
      const sym = r() < 0.55 ? 'MES' : r() < 0.85 ? 'MNQ' : 'MCL';
      const sp = SPECS[sym];
      price[sym] += (r() - 0.5) * sp.base * 0.004;
      const strat = cond === 'trend' ? (r() < 0.7 ? 'st_orb' : 'st_vwap') : cond === 'range' || cond === 'quiet' ? (r() < 0.6 ? 'st_fade' : 'st_vwap') : pick(r, ['st_orb', 'st_vwap', 'st_fade']);
      // the edge is better in the conditions each strategy is built for
      const fit = (strat === 'st_orb' && cond === 'trend') || (strat === 'st_fade' && (cond === 'range' || cond === 'quiet')) || strat === 'st_vwap';
      const win = r() < edge + (fit ? 0.08 : -0.12) - (i >= 3 ? 0.15 : 0);
      const qty = size * (r() < 0.7 ? 1 : 2);
      const dir = r() < 0.55 ? 'Long' : 'Short';
      const ticks = Math.round(reach * (sym === 'MCL' ? (win ? 8 + Math.floor(r() * 25) : -(6 + Math.floor(r() * 14))) : (win ? 6 + Math.floor(r() * 26) : -(4 + Math.floor(r() * 14)))));
      const entryPrice = +(Math.round(price[sym] / sp.tick) * sp.tick).toFixed(2);
      const exitPrice = +(entryPrice + (dir === 'Long' ? 1 : -1) * ticks * sp.tick).toFixed(2);
      const hold = 40 + Math.floor(r() * 840);
      const es = Math.floor(r() * 60);
      const exitTotal = minute * 60 + es + hold;
      const fees = +(sp.fee * qty).toFixed(2);
      const pnl = +(((exitPrice - entryPrice) * (dir === 'Long' ? 1 : -1) * sp.pv * qty) - fees).toFixed(2);
      const blockers = !win && r() < 0.35 ? [pick(r, ['Impatience', 'FOMO', 'Moving stops', 'Overtrading', 'Tilt', 'Bad Sizing'])] : [];
      const tags = win && r() < 0.4 ? ['A+ setup'] : blockers.includes('FOMO') ? ['FOMO'] : !win && r() < 0.2 ? ['Early exit'] : r() < 0.25 ? ['Followed plan'] : [];
      const t = {
        id: `demo_${acct.id}_${date}_${i}`, accountId: acct.id, symbol: sym, direction: dir,
        entry: `${date}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}:${pad(es)}`,
        exit: `${date}T${pad(Math.floor(exitTotal / 3600))}:${pad(Math.floor((exitTotal % 3600) / 60))}:${pad(exitTotal % 60)}`,
        qty, entryPrice, exitPrice, fees, pnl, tags, blockers, strategyId: strat,
        notes: i === 0 && r() < 0.25 ? (win ? 'Textbook entry at the level — patience paid.' : 'Entered early before confirmation.') : '',
        rating: win ? 3 + Math.floor(r() * 3) : 1 + Math.floor(r() * 3), reviewed: ago > 3 || r() < 0.4, screenshots: [], demo: true,
      };
      out.push(t);
      diaryDays[date].trades.push(t);
      minute += 9 + Math.floor(r() * 30);
    }
  }
  return out;
}

export function buildShowcase() {
  const r = rng(7);
  const base = initialState();
  const diaryDays = {};
  const trades = [
    ...tradesFor(ACCOUNTS[0], r, { days: 62, endAgo: 1, edge: 0.57, size: 3, reach: 2 }, diaryDays),
    ...tradesFor(ACCOUNTS[1], r, { days: 17, endAgo: 1, edge: 0.57, size: 2, reach: 2 }, diaryDays),
    ...tradesFor(ACCOUNTS[2], r, { days: 14, endAgo: 70, edge: 0.1, size: 8, reach: 2.5 }, diaryDays),
  ].sort((a, b) => b.entry.localeCompare(a.entry));

  // diary: the last ~6 weeks have full pre/post sessions
  const diary = {};
  // older days only have their market condition logged
  for (const [date, dd] of Object.entries(diaryDays)) diary[date] = { pre: { regime: dd.cond } };
  const recent = Object.keys(diaryDays).sort().reverse().slice(0, 30);
  recent.forEach((date, i) => {
    const dd = diaryDays[date];
    const net = dd.trades.reduce((s, t) => s + t.pnl, 0);
    const mood = 3 + Math.floor(r() * 3);
    diary[date] = {
      pre: {
        routine: { system: true, mental: true, levels: r() < 0.9, observe: r() < 0.8 }, maxLoss: i % 9 === 4 ? 200 : 500,
        riskTier: i % 9 === 4 ? 'Risk off' : 'Normal', mood, sleep: 2 + Math.floor(r() * 4), focus: 2 + Math.floor(r() * 4),
        regime: dd.cond, bias: pick(r, BIAS), goal: pick(r, TOMORROW), at: `${date}T06:${pad(10 + Math.floor(r() * 15))}:00`,
      },
      mood,
      post: { routine: { lockout: true, report: true, review: r() < 0.85, tomorrow: true }, tomorrow: pick(r, TOMORROW) },
      execution: net > 0 ? 3 + Math.floor(r() * 3) : 1 + Math.floor(r() * 3),
      moodAfter: net > 0 ? 4 : 2 + Math.floor(r() * 2),
      notes: `<p>${NOTES[(i * 3 + Math.floor(r() * 3)) % NOTES.length]}</p>`,
      images: [],
    };
  });

  const payouts = [
    { id: 'p_demo1', accountId: 'DEMO-PA-100K', amount: 1500, date: iso(58), status: 'Paid', method: 'Bank transfer', note: 'First payout' },
    { id: 'p_demo2', accountId: 'DEMO-PA-100K', amount: 2200, date: iso(37), status: 'Paid', method: 'Bank transfer', note: '' },
    { id: 'p_demo3', accountId: 'DEMO-PA-100K', amount: 1800, date: iso(16), status: 'Paid', method: 'Bank transfer', note: '' },
    { id: 'p_demo4', accountId: 'DEMO-PA-100K', amount: 2000, date: iso(2), status: 'Pending', method: 'Bank transfer', note: 'Requested' },
  ];

  // completed reviews for the last two weeks and last month
  const monday = (ago) => { const d = daysAgo(ago); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return keyOf(d); };
  const lastMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; })();
  const reviews = {
    [`weekly:${monday(7)}`]: { answers: { reflect: 'Solid week. Four green days out of five — the ORB worked on the two trend days and I stayed out of the chop on Wednesday.', better: 'Stop trading after two losses in a row.' }, updatedAt: daysAgo(5).toISOString(), completedAt: daysAgo(5).toISOString() },
    [`weekly:${monday(14)}`]: { answers: { reflect: 'Gave back Tuesday’s gains by overtrading on Thursday. The numbers are fine, the discipline wasn’t.', better: 'Max 3 trades per day; walk away after the daily goal.' }, updatedAt: daysAgo(12).toISOString(), completedAt: daysAgo(12).toISOString() },
    [`monthly:${lastMonth}`]: {
      answers: {
        data: 'Profit factor 1.6, win rate just over 50%. Drawdown stayed inside the first risk tier all month.',
        tape: 'Best trades all came after waiting for the opening range. Worst trades were entries in the first two minutes.',
        playbook: 'ORB is the money maker in trending conditions. The fade only works on range days — stop using it on trend days.',
        behavior: 'Moving stops cost about $600 this month. FOMO entries are down from last month.',
        goals: 'No trades before the 15-minute range. Log every trade the same day.',
      },
      updatedAt: daysAgo(9).toISOString(), completedAt: daysAgo(9).toISOString(),
    },
  };

  const notebook = {
    folders: [{ id: 'f_demo', name: 'Trading plan' }],
    notes: [{ id: 'n_demo', folderId: 'f_demo', title: 'My rules', body: '<ul><li>Trade only the first 90 minutes.</li><li>Max 3 trades, max 2 losses.</li><li>Risk tier decides size — never override it.</li></ul>', updatedAt: daysAgo(20).toISOString(), createdAt: daysAgo(40).toISOString() }],
  };

  return {
    ...base,
    user: { name: 'Demo Trader', handle: '' },
    trades,
    accounts: ACCOUNTS.map(({ created, ...a }) => ({ ...a, autoSync: false, demo: true, createdAt: iso(created) })),
    strategies: STRATEGIES.map((s) => ({ ...s, createdAt: daysAgo(100).toISOString(), updatedAt: daysAgo(30).toISOString() })),
    payouts,
    diary,
    reviews,
    notebook,
    notifications: [{ id: 'nt_demo', title: 'Welcome to the RoninFlow demo', body: 'Everything here is made up. Click around — your changes stay in this browser.', date: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19), read: false, link: '#/dashboard' }],
    settings: { ...base.settings, setupDone: true, account: 'all' },
  };
}
