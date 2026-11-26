// Futures contract rolls: which contract month you should be trading, when the market moves to the next one, and
// when the old one stops trading. Exchange calendar rules (CME / COMEX / NYMEX / CBOT) with US exchange holidays —
// used by Macro → Contract Rolls, the journal's roll reminder and the RoninFlow Suite on your chart.
//
// "Roll date" is when volume and open interest move to the next contract — the day to switch. For stock index futures
// that's CME's published roll date: the Thursday 8 days before expiry. For physically delivered markets it's a couple of
// business days before first notice (metals, Treasuries, grains) or a week before the last trading day (energy).

export const MONTH_CODES = 'FGHJKMNQUVXZ';
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const Q = 'HMUZ', ALL = MONTH_CODES;

// rule: index (3rd Friday) · fx (2 business days before the 3rd Wednesday) · notice (first notice = last business day of
// the month before) · crude (3 business days before the 25th of the month before) · gas (3 business days before the 1st)
// · lastfri (last Friday of the month)
export const PRODUCTS = {
  ES: { name: 'E-mini S&P 500', months: Q, rule: 'index' }, MES: { name: 'Micro E-mini S&P 500', months: Q, rule: 'index' },
  NQ: { name: 'E-mini Nasdaq-100', months: Q, rule: 'index' }, MNQ: { name: 'Micro E-mini Nasdaq-100', months: Q, rule: 'index' },
  RTY: { name: 'E-mini Russell 2000', months: Q, rule: 'index' }, M2K: { name: 'Micro E-mini Russell 2000', months: Q, rule: 'index' },
  YM: { name: 'E-mini Dow', months: Q, rule: 'index' }, MYM: { name: 'Micro E-mini Dow', months: Q, rule: 'index' },
  EMD: { name: 'E-mini S&P MidCap 400', months: Q, rule: 'index' }, NKD: { name: 'Nikkei 225 (USD)', months: Q, rule: 'index' },
  '6E': { name: 'Euro FX', months: Q, rule: 'fx' }, M6E: { name: 'Micro EUR/USD', months: Q, rule: 'fx' },
  '6J': { name: 'Japanese Yen', months: Q, rule: 'fx' }, '6B': { name: 'British Pound', months: Q, rule: 'fx' }, M6B: { name: 'Micro GBP/USD', months: Q, rule: 'fx' },
  '6A': { name: 'Australian Dollar', months: Q, rule: 'fx' }, M6A: { name: 'Micro AUD/USD', months: Q, rule: 'fx' },
  '6C': { name: 'Canadian Dollar', months: Q, rule: 'fx' }, '6S': { name: 'Swiss Franc', months: Q, rule: 'fx' }, '6N': { name: 'New Zealand Dollar', months: Q, rule: 'fx' },
  ZT: { name: '2-Year T-Note', months: Q, rule: 'notice' }, ZF: { name: '5-Year T-Note', months: Q, rule: 'notice' }, ZN: { name: '10-Year T-Note', months: Q, rule: 'notice' },
  TN: { name: 'Ultra 10-Year T-Note', months: Q, rule: 'notice' }, ZB: { name: 'U.S. Treasury Bond', months: Q, rule: 'notice' }, UB: { name: 'Ultra T-Bond', months: Q, rule: 'notice' },
  GC: { name: 'Gold', months: 'GJMQVZ', rule: 'notice' }, MGC: { name: 'Micro Gold', months: 'GJMQVZ', rule: 'notice' },
  SI: { name: 'Silver', months: 'HKNUZ', rule: 'notice' }, SIL: { name: 'Micro Silver', months: 'HKNUZ', rule: 'notice' },
  HG: { name: 'Copper', months: 'HKNUZ', rule: 'notice' }, MHG: { name: 'Micro Copper', months: 'HKNUZ', rule: 'notice' },
  PL: { name: 'Platinum', months: 'FJNV', rule: 'notice' },
  CL: { name: 'Crude Oil', months: ALL, rule: 'crude' }, MCL: { name: 'Micro Crude Oil', months: ALL, rule: 'crude' }, QM: { name: 'E-mini Crude Oil', months: ALL, rule: 'crude' },
  NG: { name: 'Natural Gas', months: ALL, rule: 'gas' }, QG: { name: 'E-mini Natural Gas', months: ALL, rule: 'gas' },
  ZC: { name: 'Corn', months: 'HKNUZ', rule: 'notice' }, ZS: { name: 'Soybeans', months: 'FHKNQUX', rule: 'notice' }, ZW: { name: 'Wheat', months: 'HKNUZ', rule: 'notice' },
  BTC: { name: 'Bitcoin', months: ALL, rule: 'lastfri' }, MBT: { name: 'Micro Bitcoin', months: ALL, rule: 'lastfri' },
  ETH: { name: 'Ether', months: ALL, rule: 'lastfri' }, MET: { name: 'Micro Ether', months: ALL, rule: 'lastfri' },
};
const ROOTS = Object.keys(PRODUCTS).sort((a, b) => b.length - a.length);
export const RULE_TEXT = {
  index: 'Stock index futures expire on the 3rd Friday of March, June, September and December. Volume moves to the next contract on CME’s roll date — the Thursday 8 days before expiry.',
  fx: 'Currency futures stop trading 2 business days before the 3rd Wednesday of the contract month. Volume usually moves about a week before.',
  notice: 'Physically delivered: first notice day is the last business day of the month before the contract month, and traders roll a couple of business days before it to avoid delivery.',
  crude: 'Crude stops trading 3 business days before the 25th of the month before delivery. Most volume moves about a week before that.',
  gas: 'Natural gas stops trading 3 business days before the first day of the delivery month. Most volume moves about a week before that.',
  lastfri: 'CME crypto futures expire on the last Friday of the month. Volume moves to the next month about a week before.',
};

// ---------- dates (all UTC calendar days) ----------
const D = (y, m, d) => new Date(Date.UTC(y, m, d));
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const nthWeekday = (y, m, wd, n) => { const first = D(y, m, 1); return addDays(first, ((wd - first.getUTCDay() + 7) % 7) + (n - 1) * 7); };
const lastWeekday = (y, m, wd) => { const last = D(y, m + 1, 0); return addDays(last, -((last.getUTCDay() - wd + 7) % 7)); };
function easter(y) { // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return D(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
const observed = (d) => (d.getUTCDay() === 6 ? addDays(d, -1) : d.getUTCDay() === 0 ? addDays(d, 1) : d);
const holidayCache = new Map();
/** US exchange holidays (CME full closures) for a year */
export function holidays(y) {
  if (!holidayCache.has(y)) {
    holidayCache.set(y, new Set([
      observed(D(y, 0, 1)), nthWeekday(y, 0, 1, 3), nthWeekday(y, 1, 1, 3), addDays(easter(y), -2), lastWeekday(y, 4, 1),
      observed(D(y, 5, 19)), observed(D(y, 6, 4)), nthWeekday(y, 8, 1, 1), nthWeekday(y, 10, 4, 4), observed(D(y, 11, 25)),
    ].map(iso)));
  }
  return holidayCache.get(y);
}
export const isBusinessDay = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !holidays(d.getUTCFullYear()).has(iso(d));
const prevBiz = (d) => { let x = d; while (!isBusinessDay(x)) x = addDays(x, -1); return x; };
const bizBack = (d, n) => { let x = d; for (let i = 0; i < n; i++) { x = addDays(x, -1); while (!isBusinessDay(x)) x = addDays(x, -1); } return x; };

/** last trading (or first notice) day and roll day for one contract month */
export function contractDates(root, year, month) {
  const p = PRODUCTS[root];
  if (!p) return null;
  let last, roll, lastLabel = 'Last trading day';
  switch (p.rule) {
    case 'index': last = prevBiz(nthWeekday(year, month, 5, 3)); roll = prevBiz(addDays(nthWeekday(year, month, 5, 3), -8)); break;
    case 'fx': last = bizBack(nthWeekday(year, month, 3, 3), 2); roll = bizBack(last, 5); break;
    case 'notice': last = prevBiz(D(year, month, 0)); roll = bizBack(last, 2); lastLabel = 'First notice day'; break;
    case 'crude': { const d25 = D(year, month - 1, 25); last = bizBack(isBusinessDay(d25) ? d25 : prevBiz(d25), 3); roll = bizBack(last, 5); break; }
    case 'gas': last = bizBack(D(year, month, 1), 3); roll = bizBack(last, 5); break;
    case 'lastfri': last = prevBiz(lastWeekday(year, month, 5)); roll = bizBack(last, 5); break;
    default: return null;
  }
  return { last: iso(last), roll: iso(roll), lastLabel };
}

// ---------- symbols ----------
/** 'NQZ6', 'MNQZ25', 'NQZ2026', 'NQ Z6', 'NQZ6.CME', '/NQZ6' → { root, month (0-11), year, digits } (null when it isn't one) */
export function parseSymbol(sym, now = new Date()) {
  const s = String(sym || '').toUpperCase().replace(/^\//, '').replace(/[@.:].*$/, '').replace(/[\s_-]/g, '');
  const root = ROOTS.find((r) => s.startsWith(r) && /^[FGHJKMNQUVXZ]\d{1,4}$/.test(s.slice(r.length)));
  if (!root) return null;
  const code = s[root.length], ys = s.slice(root.length + 1);
  const month = MONTH_CODES.indexOf(code);
  const cy = now.getUTCFullYear();
  let year;
  if (ys.length === 4) year = +ys;
  else if (ys.length === 2) year = 2000 + +ys;
  else if (ys.length === 1) { year = Math.floor(cy / 10) * 10 + +ys; if (year < cy - 2) year += 10; if (year > cy + 7) year -= 10; }
  else year = 2000 + +ys.slice(-2);
  return { root, month, year, digits: ys.length >= 2 ? 2 : 1 };
}
/** the root of a symbol, even without a contract month ('NQ', 'MNQZ6' → 'MNQ') */
export const rootOf = (sym) => parseSymbol(sym)?.root || ROOTS.find((r) => String(sym || '').toUpperCase().replace(/^\//, '').replace(/[@.:\s].*$/, '') === r) || null;
export const symbolFor = (root, year, month, digits = 1) => `${root}${MONTH_CODES[month]}${digits === 2 ? String(year).slice(-2) : String(year).slice(-1)}`;

/** a run of contracts for a root, oldest first, starting a few months back */
export function contracts(root, from = new Date(), count = 8, digits = 1) {
  const p = PRODUCTS[root];
  if (!p) return [];
  const out = [];
  let y = from.getUTCFullYear(), m = from.getUTCMonth() - 4;
  if (m < 0) { m += 12; y -= 1; }
  while (out.length < count + 3) {
    if (p.months.includes(MONTH_CODES[m])) {
      const d = contractDates(root, y, m);
      out.push({ root, year: y, month: m, symbol: symbolFor(root, y, m, digits), label: `${MONTH_NAMES[m]} ${y}`, ...d });
    }
    m += 1; if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

/**
 * Where you stand for a market (a root like 'NQ') or the contract you're holding (like 'NQZ6'):
 * front = the contract to trade today (the first whose roll date hasn't come), next = the one after it.
 * phase: hold (nothing to do) · soon (rolls within `soonDays`) · roll (the roll date has passed for the contract you hold:
 * switch) · expired (it has stopped trading) · early (you're already in the next one) · rolled (no contract given, and the
 * market rolled in the last 3 days)
 */
export function rollStatus(symOrRoot, now = new Date(), { soonDays = 7 } = {}) {
  const held = parseSymbol(symOrRoot, now);
  const root = held?.root || rootOf(symOrRoot);
  if (!root) return null;
  const digits = held?.digits || 1;
  const today = iso(now);
  const list = contracts(root, now, 8, digits);
  const fi = list.findIndex((c) => c.roll > today);
  if (fi < 0) return null;
  const front = list[fi], next = list[fi + 1], prev = list[fi - 1] || null;
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const base = { root, product: PRODUCTS[root].name, rule: PRODUCTS[root].rule, front, next, prev, today, daysToRoll: days(today, front.roll), daysToLast: days(today, front.last) };
  if (!held) {
    // no contract month to go on: flag the days before a roll, and the first few after it (check your charts and DOM)
    if (prev && days(prev.roll, today) <= 3) return { ...base, held: null, phase: 'rolled', switchTo: front, daysSinceRoll: days(prev.roll, today) };
    return { ...base, held: null, phase: base.daysToRoll <= soonDays ? 'soon' : 'hold', switchTo: base.daysToRoll <= soonDays ? next : null };
  }
  const h = list.find((c) => c.year === held.year && c.month === held.month)
    || { root, year: held.year, month: held.month, symbol: symbolFor(root, held.year, held.month, digits), label: `${MONTH_NAMES[held.month]} ${held.year}`, ...contractDates(root, held.year, held.month) };
  const cmp = (held.year * 12 + held.month) - (front.year * 12 + front.month);
  if (cmp > 0) return { ...base, held: h, phase: 'early', switchTo: null };
  if (cmp === 0) return { ...base, held: h, phase: base.daysToRoll <= soonDays ? 'soon' : 'hold', switchTo: base.daysToRoll <= soonDays ? next : null };
  return { ...base, held: h, phase: h.last && h.last < today ? 'expired' : 'roll', switchTo: front, daysSinceRoll: h.roll ? days(h.roll, today) : null };
}

/**
 * The calendar status sharpened by where the volume actually is (vol: rollvol.js's comparison of the expiring contract
 * `a` with the next one `b`). Once the next contract trades more than the current one, that's the moment to switch —
 * often a day or two before the calendar roll date for physically delivered markets. Adds share (the next contract's
 * part of the latest session's volume) and reason ('volume' | 'calendar').
 */
export function rollAdvice(st, vol) {
  if (!st) return st;
  const valid = vol && !vol.error && vol.a && vol.b && vol.leader;
  if (!valid) return { ...st, reason: st.phase === 'hold' || st.phase === 'early' ? null : 'calendar', share: null, vol: null };
  const same = (c, v) => c && v && c.year === v.year && c.month === v.month;
  const out = { ...st, share: vol.share, vol, reason: st.phase === 'hold' || st.phase === 'early' ? null : 'calendar' };
  const holding = st.held || st.front; // without a contract month, assume the calendar front
  if (vol.leader === 'next' && same(holding, vol.a)) {
    const to = st.held ? (st.switchTo && same(st.switchTo, vol.b) ? st.switchTo : { ...st.next, ...(same(st.next, vol.b) ? {} : { symbol: vol.b.symbol }) }) : (same(st.front, vol.b) ? st.front : st.next);
    return { ...out, phase: st.held ? (st.phase === 'expired' ? 'expired' : 'roll') : 'rolled', switchTo: to, reason: 'volume' };
  }
  return out;
}
