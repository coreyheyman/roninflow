
export const DEFAULT_TEMPLATES = [
  'What should I focus on to improve?',
  'What happened on my biggest losing trade?',
  "What's my best trading day of the week?",
  'How did I do today?',
  'When do I trade my best?',
  "What's my biggest mistake right now?",
  'Which strategy makes me the most money?',
  'Do I stick to my trading plan?',
  'Which of my accounts is performing best?',
  "What's my current drawdown?",
  'How was my performance this month?',
];

export const DASHBOARD_WIDGETS = [
  { id: 'kpis', label: 'Key metrics' },
  { id: 'progress', label: 'Account progress (profit target & max drawdown)' },
  { id: 'netpnl', label: 'Net P&L chart' },
  { id: 'hold', label: 'Average hold time & recent trades' },
  { id: 'daily', label: 'Daily P&L' },
  { id: 'weekday', label: 'P&L by weekday' },
  { id: 'hour', label: 'P&L by hour' },
  { id: 'symbols', label: 'Symbols' },
  { id: 'avgday', label: 'Average winning / losing day' },
  { id: 'avgtrade', label: 'Average win / loss' },
  { id: 'streaks', label: 'Win / loss streaks' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'blockers', label: 'Edge blockers & risk' },
];

export function initialState() {
  return {
    version: 1,
    user: { name: '', handle: '' },
    trades: [],
    accounts: [],
    strategies: [],
    payouts: [],
    diary: {}, // { 'YYYY-MM-DD': { pre: {...}, notes: '', mistakes: [], lessons: '', mood } }
    notebook: { folders: [], notes: [] },
    reviews: {},
    coachReviews: {},
    chats: [],
    templates: DEFAULT_TEMPLATES,
    notifications: [],
    tags: ['A+ setup', 'FOMO', 'Revenge', 'Early exit', 'Followed plan', 'Overtrading', 'News'],
    settings: {
      theme: 'dark',
      privacy: false,
      sidebarCollapsed: false,
      account: 'all',
      setupDone: false, // first-run setup (src/components/Setup.jsx)
      dashboardWidgets: DASHBOARD_WIDGETS.map((w) => w.id),
      coach: { provider: 'local', providers: {}, tone: 'Direct', requestsUsed: 0, requestsLimit: 200 },
      sync: { enabled: true, cursor: 0, tz: 'auto', detectedTz: null, skip: [] },
      playbook: null,
      risk: null,
      migrations: ['blockers-widget', 'rebrand', 'trade-widgets', 'avgday-widget', 'atas-live-time', 'group-positions', 'account-progress', 'public-defaults'],
      reviewNotified: [],
      currency: { code: 'USD', convert: true, rate: 1, auto: true, updatedAt: null },
    },
  };
}
