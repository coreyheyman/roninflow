import { keyOf, toDate, startOfWeek, MONTHS, MONTHS_LONG, uid } from './stats';

export const REVIEW_TYPES = [
  { id: 'weekly', label: 'Weekly', noun: 'week' },
  { id: 'monthly', label: 'Monthly', noun: 'month' },
  { id: 'quarterly', label: 'Quarterly', noun: 'quarter' },
  { id: 'yearly', label: 'Yearly', noun: 'year' },
];

/** Reviews become due at the close (1:00 PM local) of the last weekday of the period. */
const DUE_HOUR = 13;

export const REVIEW_PROMPTS = {
  weekly: [
    { id: 'reflect', label: "Reflect on this week's performance", hint: 'What went well, what went wrong, and did you trade your plan?' },
    { id: 'better', label: 'What will you do better next week?', hint: 'One or two concrete commitments you can check next Friday.' },
  ],
  monthly: [
    { id: 'data', label: 'Data Review', hint: 'Read the numbers: P&L, win rate, profit factor, Performance Ratio, ROMAD, drawdown. What do they say about this month?' },
    { id: 'tape', label: 'Tape Review', hint: 'Replay your best and worst trades. What did the tape show at your entries and exits?' },
    { id: 'playbook', label: 'Playbook Audit', hint: 'Which setups paid, which bled? Anything to add, refine or retire?' },
    { id: 'behavior', label: 'Behavioral Review', hint: 'Discipline, emotions, edge blockers. Where did behaviour cost you money?' },
    { id: 'goals', label: 'Process-Driven Goals', hint: 'Process goals for next month — things you control, not P&L targets.' },
  ],
  quarterly: [
    { id: 'metrics', label: '90-Day Metrics', hint: 'How do the last 90 days compare with the previous quarter? Is the edge holding?' },
    { id: 'regime', label: 'Market Conditions', hint: 'How did you do in each market condition? Which suit you, which should you sit out or trade smaller?' },
    { id: 'setups', label: 'Setup Evolution', hint: 'How have your setups changed? What is improving, what is decaying?' },
    { id: 'scaling', label: 'Capital Scaling Audit', hint: 'Did you earn the right to size up? Review risk tiers, drawdowns and account status.' },
    { id: 'objectives', label: 'Quarterly Objectives', hint: 'Objectives for next quarter.' },
  ],
  yearly: [
    { id: 'expectancy', label: 'Annual Expectancy', hint: 'Expectancy per trade and per day over the year. What does a typical year of your trading earn?' },
    { id: 'edge', label: 'Edge Decay & Creation', hint: 'Which edges faded this year and which new ones did you build?' },
    { id: 'capital', label: 'Capital Logistics', hint: 'Accounts, evaluations, payouts, funding, fees and costs.' },
    { id: 'career', label: 'Career Trajectory', hint: 'Where are you as a trader compared with a year ago? What is the next step?' },
    { id: 'vision', label: 'Strategic Vision', hint: 'Your vision and the big goals for next year.' },
  ],
};

/** The questions for a review type — your own (Review → Edit questions) or the built-in ones. */
export const reviewPrompts = (state, type) => {
  const own = state?.settings?.reviewQuestions?.[type];
  return Array.isArray(own) && own.length ? own : REVIEW_PROMPTS[type];
};
/** The answer shown as "your commitment" at the start of the next period: the last question. */
export const commitmentField = (state, type) => {
  const qs = reviewPrompts(state, type);
  return (type === 'weekly' && qs.some((q) => q.id === 'better') ? 'better' : qs[qs.length - 1]?.id) || null;
};

const lastWeekday = (d) => {
  const x = new Date(d);
  while ([0, 6].includes(x.getDay())) x.setDate(x.getDate() - 1);
  return x;
};
const dueOn = (endDate) => {
  const x = lastWeekday(endDate);
  x.setHours(DUE_HOUR, 0, 0, 0);
  return x;
};
const short = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

/** Period containing `date` (Date). */
export function periodOf(type, date = new Date()) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  if (type === 'weekly') {
    const start = startOfWeek(d);
    const fri = new Date(start); fri.setDate(fri.getDate() + 4);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const sameMonth = start.getMonth() === fri.getMonth();
    return {
      type, id: keyOf(start), from: keyOf(start), to: keyOf(end), start, end,
      label: `${short(start)} – ${sameMonth ? fri.getDate() : short(fri)}, ${fri.getFullYear()}`,
      title: `Week of ${short(start)}`,
      dueAt: dueOn(fri),
    };
  }
  if (type === 'monthly') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { type, id: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`, from: keyOf(start), to: keyOf(end), start, end, label: `${MONTHS_LONG[start.getMonth()]} ${start.getFullYear()}`, title: MONTHS_LONG[start.getMonth()], dueAt: dueOn(end) };
  }
  if (type === 'quarterly') {
    const q = Math.floor(d.getMonth() / 3);
    const start = new Date(d.getFullYear(), q * 3, 1);
    const end = new Date(d.getFullYear(), q * 3 + 3, 0);
    return { type, id: `${start.getFullYear()}-Q${q + 1}`, q: q + 1, from: keyOf(start), to: keyOf(end), start, end, label: `Q${q + 1} ${start.getFullYear()}`, title: `Q${q + 1}`, sub: `${MONTHS[q * 3]} – ${MONTHS[q * 3 + 2]}`, dueAt: dueOn(end) };
  }
  const start = new Date(d.getFullYear(), 0, 1);
  const end = new Date(d.getFullYear(), 11, 31);
  return { type: 'yearly', id: String(start.getFullYear()), from: keyOf(start), to: keyOf(end), start, end, label: String(start.getFullYear()), title: String(start.getFullYear()), dueAt: dueOn(end) };
}

/** Period from its URL id (2026-11-02, 2026-11, 2026-Q4, 2026); null/invalid → current period. */
export function periodFromId(type, id) {
  if (!id) return periodOf(type);
  let d = null;
  if (type === 'weekly' && /^\d{4}-\d{2}-\d{2}$/.test(id)) d = toDate(id);
  else if (type === 'monthly' && /^\d{4}-\d{2}$/.test(id)) d = toDate(`${id}-01`);
  else if (type === 'quarterly' && /^\d{4}-Q[1-4]$/.test(id)) d = new Date(Number(id.slice(0, 4)), (Number(id.slice(6)) - 1) * 3, 1);
  else if (type === 'yearly' && /^\d{4}$/.test(id)) d = new Date(Number(id), 0, 1);
  return periodOf(type, d && !isNaN(d) ? d : new Date());
}

export function shiftPeriod(p, dir) {
  const d = new Date(p.start);
  if (p.type === 'weekly') d.setDate(d.getDate() + 7 * dir);
  else if (p.type === 'monthly') d.setMonth(d.getMonth() + dir);
  else if (p.type === 'quarterly') d.setMonth(d.getMonth() + 3 * dir);
  else d.setFullYear(d.getFullYear() + dir);
  return periodOf(p.type, d);
}

export const reviewKey = (p) => `${p.type}:${p.id}`;
export const reviewHref = (p) => `#/review/${p.type}/${p.id}`;
export const inPeriod = (t, p) => { const k = t.entry.slice(0, 10); return k >= p.from && k <= p.to; };

/** 'complete' | 'due' | 'draft' (started) | 'open' (not yet due) | 'missed' (older, never completed) | 'none' (no trades) */
export function reviewStatus(review, p, now = new Date(), hasTrades = true) {
  if (review?.completedAt) return 'complete';
  const started = review && Object.values(review.answers || {}).some((v) => v?.trim());
  if (now < p.dueAt) return started ? 'draft' : 'open';
  if (started) return 'draft';
  if (!hasTrades) return 'none';
  const latestDue = latestDuePeriod(p.type, now);
  return latestDue.id === p.id ? 'due' : 'missed';
}

/** The most recent period of this type whose review time has arrived. */
export function latestDuePeriod(type, now = new Date()) {
  const p = periodOf(type, now);
  return now >= p.dueAt ? p : shiftPeriod(p, -1);
}

/** Reviews due right now (the latest period of each type, not completed, with at least one trade). */
export function dueReviews(state, now = new Date()) {
  const out = [];
  for (const { id: type, label } of REVIEW_TYPES) {
    const p = latestDuePeriod(type, now);
    if (state.reviews?.[reviewKey(p)]?.completedAt) continue;
    if (!state.trades.some((t) => inPeriod(t, p))) continue;
    out.push({ ...p, typeLabel: label });
  }
  return out;
}

/** Notifications for reviews that became due and haven't been announced yet. Returns the next state or null. */
export function withReviewNotifications(state, now = new Date()) {
  const seen = state.settings.reviewNotified || [];
  const fresh = dueReviews(state, now).filter((p) => !seen.includes(reviewKey(p)));
  if (!fresh.length) return null;
  const notes = fresh.map((p) => ({
    id: uid('n'),
    title: `${p.typeLabel} review due`,
    body: p.type === 'weekly' ? `Time to review your week (${p.label}).` : `Time to review ${p.label}.`,
    date: new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19),
    read: false,
    link: reviewHref(p),
  }));
  return {
    ...state,
    notifications: [...notes, ...state.notifications],
    settings: { ...state.settings, reviewNotified: [...seen, ...fresh.map(reviewKey)].slice(-60) },
  };
}
