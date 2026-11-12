// The dashboard's widget library: what each widget is, where it's listed and how big it starts.
// Sizes are in grid units (12 columns; rows are ROW_H px tall with GAP px between them).
import { pack, normalize } from './grid';

export const ROW_H = 40;
export const GAP = 20;

export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'chart', label: 'Charts' },
  { id: 'table', label: 'Tables' },
  { id: 'kpi', label: 'KPIs' },
  { id: 'calendar', label: 'Calendar' },
];

const PNL_OR_RATE = { key: 'metric', label: 'Show', choices: [['pnl', 'P&L'], ['winRate', 'Win rate'], ['count', 'Trades']], def: 'pnl' };

export const WIDGETS = {
  net: { name: 'Total P&L', cat: 'kpi', w: 4, h: 4, minW: 2, minH: 3, desc: 'Net P&L with its trend and average trade' },
  winRate: { name: 'Win Rate', cat: 'kpi', w: 4, h: 4, minW: 2, minH: 3, desc: 'Share of winning trades, with wins, losses and break-evens' },
  profitFactor: { name: 'Profit Factor', cat: 'kpi', w: 4, h: 4, minW: 2, minH: 3, desc: 'Gross profit ÷ gross loss, on a gauge' },
  perfRatio: { name: 'Performance Ratio', cat: 'kpi', w: 4, h: 4, minW: 2, minH: 3, desc: 'Win rate × average win / average loss' },
  romad: { name: 'ROMAD', cat: 'kpi', w: 4, h: 4, minW: 2, minH: 3, desc: 'Return over max drawdown' },
  mostTraded: { name: 'Most Traded', cat: 'kpi', w: 4, h: 4, minW: 2, minH: 3, desc: 'Your most traded symbol and its P&L' },
  longShort: { name: 'Long vs Short', cat: 'kpi', w: 4, h: 4, minW: 3, minH: 3, desc: 'P&L, trades and win rate for longs and shorts' },
  hold: { name: 'Average Hold Time', cat: 'kpi', w: 6, h: 4, minW: 4, minH: 3, desc: 'How long you hold winners, losers and break-evens' },
  payouts: { name: 'Total Payouts', cat: 'kpi', w: 4, h: 4, minW: 2, minH: 3, desc: 'Paid out, pending, and return on what accounts cost' },
  progress: { name: 'Account Progress', cat: 'kpi', w: 12, h: 3, minW: 6, minH: 2, desc: 'Profit target and max drawdown for each account' },

  netpnl: { name: 'Net P&L Chart', cat: 'chart', w: 6, h: 8, minW: 4, minH: 5, desc: 'Cumulative P&L, by trade or by day',
    options: [{ key: 'mode', label: 'Chart', choices: [['area', 'Area'], ['line', 'Line'], ['bar', 'Daily bars']], def: 'area' }] },
  equity: { name: 'Equity Chart', cat: 'chart', w: 6, h: 7, minW: 4, minH: 5, desc: 'Account balance over time, from the starting balance' },
  daily: { name: 'Daily P&L Chart', cat: 'chart', w: 12, h: 6, minW: 4, minH: 4, desc: 'Net P&L for each session' },
  drawdown: { name: 'Max Drawdown', cat: 'chart', w: 6, h: 6, minW: 4, minH: 4, desc: 'How far below its peak your P&L has been' },
  weekday: { name: 'Performance by Day', cat: 'chart', w: 4, h: 6, minW: 3, minH: 4, desc: 'Results for each day of the week', options: [PNL_OR_RATE] },
  hour: { name: 'Performance by Hour', cat: 'chart', w: 4, h: 6, minW: 3, minH: 4, desc: 'Results by the hour you entered', options: [PNL_OR_RATE] },
  holdDur: { name: 'Performance by Hold Duration', cat: 'chart', w: 4, h: 6, minW: 3, minH: 4, desc: 'Results by how long the trade was held', options: [PNL_OR_RATE] },
  symbols: { name: 'Performance by Symbol', cat: 'chart', w: 4, h: 6, minW: 3, minH: 4, desc: 'Results per symbol, with largest win and loss', options: [PNL_OR_RATE] },
  strategy: { name: 'Strategy Performance', cat: 'chart', w: 4, h: 6, minW: 3, minH: 4, desc: 'Results per strategy from your playbook', options: [PNL_OR_RATE] },
  tags: { name: 'Performance by Tag', cat: 'chart', w: 4, h: 6, minW: 3, minH: 4, desc: 'Results per trade tag', options: [PNL_OR_RATE] },

  recent: { name: 'Recent Trades', cat: 'table', w: 6, h: 6, minW: 3, minH: 3, desc: 'Your latest trades; click one to open it' },
  avgtrade: { name: 'Average Trade', cat: 'table', w: 4, h: 8, minW: 3, minH: 6, desc: 'Average win vs loss, reward:risk and expectancy' },
  avgday: { name: 'Average Day', cat: 'table', w: 4, h: 8, minW: 3, minH: 6, desc: 'Average green vs red day and green-day rate' },
  streaks: { name: 'Trading Streaks', cat: 'table', w: 4, h: 8, minW: 3, minH: 5, desc: 'Current and longest win and loss runs' },
  risk: { name: 'Current Risk', cat: 'table', w: 6, h: 5, minW: 4, minH: 4, desc: 'Your risk tier and drawdown from the risk plan' },
  blockers: { name: 'Edge Blockers', cat: 'table', w: 6, h: 5, minW: 4, minH: 3, desc: 'What the trades you flagged cost you' },

  calendar: { name: 'P&L Calendar', cat: 'calendar', w: 12, h: 16, minW: 6, minH: 10, desc: 'Each day and week of the month, colour coded' },
};

const KPIS = ['net', 'winRate', 'profitFactor', 'perfRatio', 'romad', 'mostTraded'];

/** The layout every dashboard starts with (matches the fixed dashboard from before). */
export const DEFAULT_LAYOUT = [
  ...KPIS.map((id, i) => ({ id, x: (i % 3) * 4, y: Math.floor(i / 3) * 4, w: 4, h: 4 })),
  { id: 'progress', x: 0, y: 8, w: 12, h: 3 },
  { id: 'netpnl', x: 0, y: 11, w: 6, h: 8 },
  { id: 'hold', x: 6, y: 11, w: 6, h: 4 },
  { id: 'recent', x: 6, y: 15, w: 6, h: 4 },
  { id: 'weekday', x: 0, y: 19, w: 4, h: 6 },
  { id: 'hour', x: 4, y: 19, w: 4, h: 6 },
  { id: 'symbols', x: 8, y: 19, w: 4, h: 6 },
  { id: 'avgday', x: 0, y: 25, w: 4, h: 8 },
  { id: 'avgtrade', x: 4, y: 25, w: 4, h: 8 },
  { id: 'streaks', x: 8, y: 25, w: 4, h: 8 },
  { id: 'risk', x: 0, y: 33, w: 6, h: 5 },
  { id: 'blockers', x: 6, y: 33, w: 6, h: 5 },
  { id: 'daily', x: 0, y: 38, w: 12, h: 6 },
  { id: 'calendar', x: 0, y: 44, w: 12, h: 16 },
];

export const DASHBOARDS = ['My Dashboard', 'Performance', 'Risk', 'Psychology'];

const PRESETS = {
  Performance: ['net', 'winRate', 'profitFactor', 'netpnl', 'equity', 'daily', 'calendar'],
  Risk: ['net', 'romad', 'perfRatio', 'progress', 'drawdown', 'hold', 'symbols', 'avgday', 'avgtrade', 'streaks', 'hour'],
  Psychology: ['winRate', 'longShort', 'streaks', 'weekday', 'hour', 'holdDur', 'blockers', 'tags', 'calendar'],
};

// widget ids from the old fixed dashboard (settings.dashboardWidgets) → the widgets that replaced them
const OLD_IDS = { kpis: KPIS, hold: ['hold', 'recent'], blockers: ['risk', 'blockers'] };

/** The layout a dashboard starts with before it's been customised. */
export function presetLayout(name, oldWidgets) {
  if (PRESETS[name]) return pack(PRESETS[name], WIDGETS);
  if (!Array.isArray(oldWidgets)) return DEFAULT_LAYOUT.map((i) => ({ ...i }));
  const keep = new Set(oldWidgets.flatMap((id) => OLD_IDS[id] || [id]));
  return normalize(DEFAULT_LAYOUT.filter((i) => keep.has(i.id)), WIDGETS);
}

/** A dashboard's layout: the saved one, or its preset. */
export function layoutFor(settings, name) {
  const saved = settings?.dashLayouts?.[name];
  return saved ? normalize(saved, WIDGETS) : presetLayout(name, name === 'My Dashboard' ? settings?.dashboardWidgets : undefined);
}

/** A widget's option value (falls back to the option's default). */
export function optionOf(item, key) {
  const spec = WIDGETS[item?.id]?.options?.find((o) => o.key === key);
  return item?.opts?.[key] ?? spec?.def;
}

/** Widgets matching a library search + category. */
export function searchWidgets(q, cat = 'all') {
  const s = (q || '').trim().toLowerCase();
  return Object.entries(WIDGETS)
    .filter(([, w]) => (cat === 'all' || w.cat === cat) && (!s || w.name.toLowerCase().includes(s) || w.desc.toLowerCase().includes(s)))
    .map(([id, w]) => ({ id, ...w }));
}
