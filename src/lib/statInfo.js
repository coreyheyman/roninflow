// What each stat means, how it's worked out, and what *your* number says. Used by the click-to-explain stat pop-ups.
// read(v, c, $) → { tone: 'good' | 'ok' | 'bad' | 'none', verdict, text }
//   v = the value shown, c = the period's stats (summarize / periodMetrics fields), $ = money formatter (respects privacy)
const pct = (v) => `${Math.round(v)}%`;
const num = (v, dp = 2) => (v === Infinity ? '∞' : Number(v).toFixed(dp));
const none = (text = 'Not enough trades in this period to say yet.') => ({ tone: 'none', verdict: 'No data yet', text });
const payoff = (c) => (c?.avgLoss ? (c.avgWin || 0) / Math.abs(c.avgLoss) : null);
/** the win rate you need to break even with your average win and loss */
const breakEvenWR = (c) => { const w = c?.avgWin || 0, l = Math.abs(c?.avgLoss || 0); return w + l ? (l / (w + l)) * 100 : null; };

export const STATS = {
  net: {
    name: 'Net P&L',
    what: 'What you made or lost after commissions, from every trade closed in this period.',
    how: 'Sum of every closed trade’s P&L (fees included)',
    read: (v, c, $) => {
      if (!c?.count) return none();
      const per = v / c.count;
      return v > 0
        ? { tone: 'good', verdict: 'In profit', text: `You’re up ${$(v)} over ${c.count} trade${c.count === 1 ? '' : 's'} — about ${$(per)} a trade. Check Profit factor and ROMAD to see how much risk it took to get there.` }
        : v < 0 ? { tone: 'bad', verdict: 'Down', text: `You’re down ${$(Math.abs(v))} over ${c.count} trades (${$(per)} a trade). Look at Win rate against your break-even win rate, and at your average loss — one of the two is usually the leak.` }
        : { tone: 'ok', verdict: 'Flat', text: 'Break-even so far.' };
    },
  },
  winRate: {
    name: 'Win rate',
    what: 'The share of your trades that made money. On its own it says little: a 40% win rate is great if winners are much bigger than losers, and 70% can still lose money if losers are bigger.',
    how: 'Winning trades ÷ all trades',
    bench: 'Compare it with your break-even win rate (below) rather than with a fixed number.',
    read: (v, c) => {
      if (!c?.count) return none();
      const be = breakEvenWR(c);
      if (be == null || !c.losses || !c.wins) return { tone: v >= 50 ? 'good' : 'ok', verdict: pct(v), text: c.losses ? 'No winners yet to compare against.' : 'No losing trades yet in this period.' };
      const gap = v - be;
      return gap >= 5
        ? { tone: 'good', verdict: 'Comfortably above break-even', text: `With your average win and loss you only need ${pct(be)} winners to break even — you’re at ${pct(v)}, ${Math.round(gap)} points of cushion.` }
        : gap >= 0 ? { tone: 'ok', verdict: 'Just above break-even', text: `You need ${pct(be)} to break even with your current win/loss sizes and you’re at ${pct(v)}. A small slip in either wins or average loss tips it negative.` }
        : { tone: 'bad', verdict: 'Below break-even', text: `With your average win and loss you need ${pct(be)} winners to break even — you’re at ${pct(v)}. Either win more often or let winners run / cut losers sooner so the break-even rate drops.` };
    },
  },
  profitFactor: {
    name: 'Profit factor',
    what: 'How many dollars you make for every dollar you lose.',
    how: 'Gross profit ÷ gross loss',
    bench: 'Below 1 loses money · 1–1.5 thin edge · 1.5–2 solid · above 2 strong',
    read: (v, c) => {
      if (!c?.count) return none();
      if (v === Infinity) return { tone: 'good', verdict: 'No losses yet', text: 'Every trade in this period was a winner or break-even, so there’s nothing to divide by yet.' };
      return v >= 2 ? { tone: 'good', verdict: 'Strong', text: `You make ${num(v)} for every 1 you lose — a strong edge. Above 3 is rare over many trades, so check it holds as the sample grows.` }
        : v >= 1.5 ? { tone: 'good', verdict: 'Solid', text: `${num(v)} back for every 1 lost: a solid, tradeable edge.` }
        : v >= 1 ? { tone: 'ok', verdict: 'Thin edge', text: `${num(v)} — profitable, but thin. Commissions, slippage or a couple of bad days can wipe it out. Trimming your average loss is usually the quickest way up.` }
        : { tone: 'bad', verdict: 'Losing', text: `${num(v)} — you lose more on losers than you make on winners. Every 1 lost brings back only ${num(v)}.` };
    },
  },
  perfRatio: {
    name: 'Performance Ratio',
    what: 'Combines how often you win with how big your wins are compared with your losses, in one number.',
    how: 'Win rate × (average win ÷ average loss)',
    bench: 'Above 0.5 good · above 0.75 great',
    read: (v, c) => {
      if (!c?.count) return none();
      if (v === Infinity) return { tone: 'good', verdict: 'No losses yet', text: 'No losing trades in this period.' };
      const p = payoff(c);
      const tail = p != null ? ` Your winners average ${num(p)}× your losers.` : '';
      return v >= 0.75 ? { tone: 'good', verdict: 'Great', text: `${num(v)} — win rate and payoff together are working well.${tail}` }
        : v >= 0.5 ? { tone: 'good', verdict: 'Good', text: `${num(v)} — a healthy mix of how often and how much you win.${tail}` }
        : { tone: 'bad', verdict: 'Needs work', text: `${num(v)} is under 0.5.${tail} Raise it by holding winners longer, cutting losers earlier, or skipping lower-quality setups.` };
    },
  },
  romad: {
    name: 'ROMAD',
    what: 'Return over max drawdown: how much you made compared with the worst dip you had to sit through to get it.',
    how: 'Net P&L ÷ biggest peak-to-trough drawdown',
    bench: 'Below 1 you were down more at some point than you made · above 2 high quality',
    read: (v, c, $) => {
      if (!c?.count) return none();
      if (v === Infinity) return { tone: 'good', verdict: 'No drawdown', text: 'Your equity never dipped from a high in this period.' };
      const dd = c.maxDD ? ` (worst dip ${$(c.maxDD)})` : '';
      return v >= 2 ? { tone: 'good', verdict: 'High quality', text: `${num(v)} — you made more than twice your worst drawdown${dd}. Smooth, controlled results.` }
        : v >= 1 ? { tone: 'ok', verdict: 'OK', text: `${num(v)} — you made more than your worst dip${dd}, but not by much. Smaller losing streaks would lift it fastest.` }
        : v >= 0 ? { tone: 'bad', verdict: 'Choppy', text: `${num(v)} — at some point you were down more${dd} than you’ve made overall. Results are swinging more than they’re growing.` }
        : { tone: 'bad', verdict: 'Losing', text: `Negative: the period lost money${dd}.` };
    },
  },
  ev: {
    name: 'EV (expectancy)',
    what: 'What an average trade is worth to you — the number your edge comes down to.',
    how: 'Net P&L ÷ number of trades',
    read: (v, c, $) => {
      if (!c?.count) return none();
      return v > 0 ? { tone: 'good', verdict: 'Positive edge', text: `Each trade adds ${$(v)} on average — about ${$(v * 100)} over the next 100 if nothing changes. Keep taking the same quality of setup.` }
        : v < 0 ? { tone: 'bad', verdict: 'Negative edge', text: `Each trade costs you ${$(Math.abs(v))} on average, so more trades means more losses. Fewer, higher-quality trades usually help before anything else.` }
        : { tone: 'ok', verdict: 'Break-even', text: 'Your average trade is worth about zero.' };
    },
  },
  sharpe: {
    name: 'Sharpe ratio',
    what: 'How steady your daily results are compared with how much you make — reward per unit of day-to-day swing.',
    how: 'Average daily P&L ÷ standard deviation of daily P&L × √252 (annualised)',
    bench: 'Below 1 weak · 1–2 good · 2–3 very good · above 3 excellent (small samples flatter it)',
    read: (v, c) => {
      if (v == null || (c?.days ?? 0) < 2) return none('Needs at least two trading days.');
      const few = c?.days < 20 ? ` With only ${c.days} trading days this moves a lot from day to day.` : '';
      return v >= 2 ? { tone: 'good', verdict: v >= 3 ? 'Excellent' : 'Very good', text: `${num(v)} — your days are consistently positive relative to their swings.${few}` }
        : v >= 1 ? { tone: 'good', verdict: 'Good', text: `${num(v)} — decent consistency.${few}` }
        : v >= 0 ? { tone: 'ok', verdict: 'Weak', text: `${num(v)} — profitable on average but with big swings between days. Capping losing days raises it the most.${few}` }
        : { tone: 'bad', verdict: 'Negative', text: `${num(v)} — your average day loses money.${few}` };
    },
  },
  maxDD: {
    name: 'Biggest drawdown',
    what: 'The largest drop from a high point in your running P&L to the low that followed, within this period.',
    how: 'Largest peak-to-trough fall of cumulative P&L',
    read: (v, c, $) => {
      const dd = Math.abs(v);
      if (!c?.count) return none();
      if (!dd) return { tone: 'good', verdict: 'None', text: 'Your running P&L never fell from a high.' };
      const days = c.avgWinDay > 0 ? dd / c.avgWinDay : null;
      return { tone: c.net > dd * 2 ? 'good' : c.net > dd ? 'ok' : 'bad', verdict: $(dd), text: `Your worst stretch gave back ${$(dd)}${days ? (days < 1 ? ' — less than one average winning day to earn back' : ` — about ${num(days, 1)} average winning days to earn back`) : ''}. Compare it with your account’s drawdown limit: keep a normal bad run well inside it.` };
    },
  },
  avgWinDay: {
    name: 'Average winning day', what: 'What a typical green day makes.', how: 'Total of winning days ÷ number of winning days',
    read: (v, c, $) => (!c?.days ? none() : c.avgLossDay ? (v >= Math.abs(c.avgLossDay)
      ? { tone: 'good', verdict: 'Bigger than your losing days', text: `Green days average ${$(v)} against ${$(Math.abs(c.avgLossDay))} on red days — your good days outweigh your bad ones.` }
      : { tone: 'bad', verdict: 'Smaller than your losing days', text: `Green days average ${$(v)} but red days ${$(Math.abs(c.avgLossDay))}. You need clearly more green days than red to come out ahead — or stop red days earlier.` })
      : { tone: 'good', verdict: $(v), text: 'No losing days to compare with yet.' }),
  },
  avgLossDay: {
    name: 'Average losing day', what: 'What a typical red day costs.', how: 'Total of losing days ÷ number of losing days',
    read: (v, c, $) => (!c?.days ? none() : !v ? { tone: 'good', verdict: 'No losing days', text: 'No red days in this period.' } : Math.abs(v) <= (c.avgWinDay || 0)
      ? { tone: 'good', verdict: 'Contained', text: `Red days average ${$(Math.abs(v))}, smaller than your average green day (${$(c.avgWinDay)}). Your daily loss control is doing its job.` }
      : { tone: 'bad', verdict: 'Larger than your green days', text: `Red days average ${$(Math.abs(v))}, more than your average green day (${$(c.avgWinDay || 0)}). A firm daily loss limit is the usual fix.` }),
  },
  avgDay: {
    name: 'Average day', what: 'What a typical trading day nets, green and red together.', how: 'Net P&L ÷ trading days',
    read: (v, c, $) => (!c?.days ? none() : v > 0 ? { tone: 'good', verdict: 'Positive', text: `About ${$(v)} a day — roughly ${$(v * 20)} over a 20-day month at this pace.` } : { tone: 'bad', verdict: 'Negative', text: `About ${$(Math.abs(v))} lost per trading day.` }),
  },
  bestDay: {
    name: 'Best day', what: 'Your biggest single-day result in the period.', how: 'Highest daily net P&L',
    read: (v, c, $) => {
      if (!c?.days || v <= 0) return none('No green days yet.');
      const share = c.net > 0 ? v / c.net : null;
      return share && share > 0.5
        ? { tone: 'ok', verdict: `${Math.round(share * 100)}% of your profit`, text: `Your best day (${$(v)}) is more than half of the period’s profit — results lean on one big day. Without it you’d have ${$(c.net - v)}.` }
        : { tone: 'good', verdict: $(v), text: share ? `It’s ${Math.round(share * 100)}% of the period’s profit, so your results aren’t riding on one day.` : `Your best day made ${$(v)}.` };
    },
  },
  worstDay: {
    name: 'Worst day', what: 'Your biggest single-day loss in the period.', how: 'Lowest daily net P&L',
    read: (v, c, $) => {
      if (!c?.days || v >= 0) return { tone: 'good', verdict: 'No red days', text: 'No losing days in this period.' };
      const x = c.avgWinDay > 0 ? Math.abs(v) / c.avgWinDay : null;
      return { tone: x && x > 3 ? 'bad' : 'ok', verdict: $(Math.abs(v)), text: x ? `${x < 1 ? 'Less than one average green day' : `About ${num(x, 1)} average green days`} earns that back.${x > 3 ? ' One day that size can undo a good week — a hard daily loss limit stops it.' : ''}` : `You lost ${$(Math.abs(v))} on your worst day.` };
    },
  },
  maxWinStreak: {
    name: 'Longest winning streak', what: 'The most green days you strung together in a row.', how: 'Most consecutive days with net P&L above 0',
    read: (v, c) => (!c?.days ? none() : { tone: v >= 3 ? 'good' : 'ok', verdict: `${v} day${v === 1 ? '' : 's'}`, text: v >= 3 ? 'Good momentum. Watch for overconfidence (bigger size, looser entries) after a run like this.' : 'Short streaks are normal; consistency matters more than streaks.' }),
  },
  maxLossStreak: {
    name: 'Longest losing streak', what: 'The most red days in a row.', how: 'Most consecutive days with net P&L below 0',
    read: (v, c) => (!c?.days ? none() : v >= 4 ? { tone: 'bad', verdict: `${v} days`, text: `${v} red days in a row is where tilt and revenge trading creep in. A rule like “after 3 red days, trade minimum size” protects you.` }
      : v >= 2 ? { tone: 'ok', verdict: `${v} days`, text: 'Normal. Stay on the same process and size.' } : { tone: 'good', verdict: v ? '1 day' : 'None', text: 'You bounced back after every red day.' }),
  },
  winDaysPct: {
    name: 'Winning days', what: 'The share of trading days that finished green.', how: 'Green days ÷ trading days',
    read: (v, c) => (!c?.days ? none() : v >= 60 ? { tone: 'good', verdict: pct(v), text: 'Most of your days are green — strong day-to-day consistency.' }
      : v >= 45 ? { tone: 'ok', verdict: pct(v), text: 'About as many green days as red. Fine as long as your green days are bigger (see Average winning day).' }
      : { tone: 'bad', verdict: pct(v), text: 'More red days than green. That only works if your green days are much bigger.' }),
  },
  discipline: {
    name: 'Disciplined trades', what: 'The share of trades you didn’t flag with an edge blocker (FOMO, revenge, moved stop …).', how: 'Trades without an edge blocker ÷ all trades',
    bench: 'Aim for 90%+',
    read: (v, c, $) => {
      if (v == null) return none();
      const cost = c?.flaggedTrades ? ` The ${c.flaggedTrades} flagged trade${c.flaggedTrades === 1 ? '' : 's'} made ${$(c.flaggedPnl)}.` : '';
      return v >= 90 ? { tone: 'good', verdict: pct(v), text: `You stuck to your rules.${cost}` }
        : v >= 75 ? { tone: 'ok', verdict: pct(v), text: `Mostly on plan.${cost} Look for the blocker that shows up most and make a rule for it.` }
        : { tone: 'bad', verdict: pct(v), text: `A quarter or more of trades broke a rule.${cost} Cutting those is usually the fastest improvement available.` };
    },
  },
  sizeMgmt: {
    name: 'Size management', what: 'The share of trades not flagged for bad sizing.', how: 'Trades without a sizing blocker ÷ all trades',
    read: (v) => (v == null ? none() : v >= 95 ? { tone: 'good', verdict: pct(v), text: 'Your size stayed where your plan says.' } : { tone: 'bad', verdict: pct(v), text: 'Some trades were sized outside your plan — oversized losers do most of the damage in a drawdown.' }),
  },
  trades: {
    name: 'Trades', what: 'How many positions you closed.', how: 'Count of closed trades',
    read: (v) => (v < 20 ? { tone: 'none', verdict: `${v}`, text: 'Fewer than 20 trades: treat every percentage here as a first read, not a verdict.' } : { tone: 'ok', verdict: `${v}`, text: v >= 100 ? 'A big enough sample for your stats to mean something.' : 'A reasonable sample — ratios will still move as you add trades.' }),
  },
  avgWin: {
    name: 'Average win', what: 'What a typical winning trade makes.', how: 'Total of winning trades ÷ number of winners',
    read: (v, c, $) => { const p = payoff(c); return p == null ? { tone: 'good', verdict: $(v), text: 'No losers to compare with yet.' } : p >= 1 ? { tone: 'good', verdict: `${num(p)}× your average loss`, text: `Winners average ${$(v)} against ${$(Math.abs(c.avgLoss))} for losers.` } : { tone: 'bad', verdict: `${num(p)}× your average loss`, text: `Winners (${$(v)}) are smaller than losers (${$(Math.abs(c.avgLoss))}), so you need a high win rate — ${pct(breakEvenWR(c))} just to break even.` }; },
  },
  avgLoss: {
    name: 'Average loss', what: 'What a typical losing trade costs.', how: 'Total of losing trades ÷ number of losers',
    read: (v, c, $) => { const p = payoff(c); return p == null ? none() : p >= 1 ? { tone: 'good', verdict: 'Smaller than your average win', text: `Losers average ${$(Math.abs(v))} against ${$(c.avgWin)} for winners — good loss control.` } : { tone: 'bad', verdict: 'Bigger than your average win', text: `Losers (${$(Math.abs(v))}) outweigh winners (${$(c.avgWin)}). Tighter stops or exiting losers sooner would change the most.` }; },
  },
  payoff: {
    name: 'Reward : risk', what: 'How big your average winner is compared with your average loser.', how: 'Average win ÷ average loss',
    bench: 'Above 1× your winners are bigger than your losers',
    read: (v, c) => (v == null ? none() : v >= 1.5 ? { tone: 'good', verdict: `${num(v)}×`, text: `Winners are ${num(v)}× your losers, so you can be wrong more often than right and still make money — you need only ${pct(100 / (1 + v))} winners.` }
      : v >= 1 ? { tone: 'ok', verdict: `${num(v)}×`, text: `Winners slightly outsize losers; you need ${pct(100 / (1 + v))} winners to break even.` }
      : { tone: 'bad', verdict: `${num(v)}×`, text: `Losers are bigger than winners, so you need ${pct(100 / (1 + v))} winners just to break even. Letting winners run or cutting losers sooner moves this most.` }),
  },
  breakEven: {
    name: 'Break-even win rate', what: 'The win rate you need to break even with your current average win and loss.', how: 'Average loss ÷ (average win + average loss)',
    read: (v, c) => (v == null || !c?.count ? none() : c.winRate >= v
      ? { tone: 'good', verdict: `You’re ${Math.round(c.winRate - v)} pts above`, text: `You need ${pct(v)} and you win ${pct(c.winRate)} of the time.` }
      : { tone: 'bad', verdict: `You’re ${Math.round(v - c.winRate)} pts below`, text: `You need ${pct(v)} but win ${pct(c.winRate)} of the time. Either raise the win rate or bring this number down by growing winners relative to losers.` }),
  },
  mostTraded: {
    name: 'Most traded', what: 'The symbol you traded most often and what it made you.', how: 'Symbol with the most closed positions; its total P&L',
    read: (v, c, $) => (v >= 0 ? { tone: 'good', verdict: 'Profitable', text: `Your main market made ${$(v)} — it’s working for you.` } : { tone: 'bad', verdict: 'Losing', text: `Your main market lost ${$(Math.abs(v))}. Compare it with your other symbols in the Symbols widget — you may be doing better elsewhere.` }),
  },
};

/** label text → stat key (so a tile only needs its value) */
const LABELS = [
  [/^(net|total|realized) p&l$/i, 'net'], [/^win rate$/i, 'winRate'], [/^profit factor$/i, 'profitFactor'], [/^performance ratio$/i, 'perfRatio'],
  [/^romad/i, 'romad'], [/^ev\b/i, 'ev'], [/^sharpe/i, 'sharpe'], [/^(biggest|max) drawdown$/i, 'maxDD'], [/^avg winning day$/i, 'avgWinDay'],
  [/^avg losing day$/i, 'avgLossDay'], [/^avg day$/i, 'avgDay'], [/^best day$/i, 'bestDay'], [/^worst day$/i, 'worstDay'],
  [/consecutive winning/i, 'maxWinStreak'], [/consecutive losing/i, 'maxLossStreak'], [/^winning days$/i, 'winDaysPct'],
  [/^reward : risk$/i, 'payoff'], [/^break-even (win|green-day) rate$/i, 'breakEven'], [/^expectancy/i, 'ev'], [/^disciplined/i, 'discipline'], [/^size management$/i, 'sizeMgmt'], [/^trades$/i, 'trades'], [/^most traded$/i, 'mostTraded'],
];
export const statKey = (label) => (typeof label === 'string' ? LABELS.find(([re]) => re.test(label.trim()))?.[1] : null) || null;

export function explain(key, v, c, money) {
  const s = STATS[key];
  if (!s) return null;
  let r;
  try { r = s.read(v, c || {}, money); } catch { r = null; }
  return { ...s, result: r, small: c?.count != null && c.count > 0 && c.count < 20 };
}
