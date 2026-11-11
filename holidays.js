// Market and bank holidays for the economic calendar, worked out from each country's rules so the calendar shows them
// months ahead (ForexFactory's feed only lists the current and next week).
//
// Each holiday says what it does to markets:
//   closed  — exchanges closed (for the US: NYSE closed; CME futures closed or a shortened session)
//   early   — exchanges close early
//   bank    — banks / bond market closed, exchanges open (thin liquidity, no data releases)
// Exact futures hours on holidays vary by product: CME publishes them a few weeks ahead (cmegroup.com → Holiday calendar).
// China's holiday dates are announced by the government each year, so they come from the calendar feeds instead.

const pad = (n) => String(n).padStart(2, '0');
const key = (y, m, d) => { const x = new Date(Date.UTC(y, m - 1, d)); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; };
const dow = (k) => new Date(`${k}T12:00:00Z`).getUTCDay();
const add = (k, n) => { const x = new Date(`${k}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** nth weekday (0 = Sun) of a month; n = -1 for the last one */
function nth(y, m, wd, n) {
  if (n > 0) { const first = key(y, m, 1); return add(first, ((wd - dow(first) + 7) % 7) + (n - 1) * 7); }
  const last = key(y, m + 1, 0);
  return add(last, -((dow(last) - wd + 7) % 7));
}
/** Easter Sunday (Gregorian, anonymous algorithm) */
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return key(y, month, day);
}
const weekend = (k) => dow(k) === 0 || dow(k) === 6;
/** Sat → Fri, Sun → Mon (US federal rule) */
const usObserved = (k) => (dow(k) === 6 ? add(k, -1) : dow(k) === 0 ? add(k, 1) : k);
/** Weekend holidays move to the next free weekday, in order (UK, Canada, Australia, NZ "Mondayisation"). */
function substitute(dates) {
  const taken = new Set();
  return dates.map((k) => { let d = k; while (weekend(d) || taken.has(d)) d = add(d, 1); taken.add(d); return d; });
}

const NOTE = {
  usClosed: 'US stock markets closed. CME futures: closed or a shortened session with no settlement — check CME’s holiday hours.',
  usShort: 'US stock markets closed. CME futures trade a shortened session (early halt, no settlement); bond market closed.',
  usBank: 'Banks and the US bond market are closed; stock markets and CME futures are open. Expect thinner liquidity.',
  usEarly: 'US stocks close at 1:00 PM ET; CME equity futures close early (12:15 PM CT). Bond market closes at 2:00 PM ET.',
};

function us(y) {
  const out = [];
  const ny = key(y, 1, 1);
  // New Year's Day on a Saturday: NYSE stays open the Friday before
  if (dow(ny) !== 6) out.push([usObserved(ny), 'New Year’s Day', 'closed', NOTE.usClosed]);
  out.push([nth(y, 1, 1, 3), 'Martin Luther King Jr. Day', 'closed', NOTE.usShort]);
  out.push([nth(y, 2, 1, 3), 'Presidents’ Day', 'closed', NOTE.usShort]);
  out.push([add(easter(y), -2), 'Good Friday', 'closed', 'US stock markets closed. CME futures: mostly closed or a short session (in years with a jobs report that day, rates and equity futures may open briefly) — check CME’s holiday hours.']);
  out.push([nth(y, 5, 1, -1), 'Memorial Day', 'closed', NOTE.usShort]);
  out.push([usObserved(key(y, 6, 19)), 'Juneteenth', 'closed', NOTE.usShort]);
  const j4 = usObserved(key(y, 7, 4));
  out.push([j4, 'Independence Day', 'closed', NOTE.usShort]);
  const j3 = key(y, 7, 3);
  if (!weekend(j3) && j3 !== j4) out.push([j3, 'Independence Day (eve)', 'early', NOTE.usEarly]);
  out.push([nth(y, 9, 1, 1), 'Labor Day', 'closed', NOTE.usShort]);
  out.push([nth(y, 10, 1, 2), 'Columbus Day', 'bank', NOTE.usBank]);
  out.push([usObserved(key(y, 11, 11)), 'Veterans Day', 'bank', NOTE.usBank]);
  const tg = nth(y, 11, 4, 4);
  out.push([tg, 'Thanksgiving', 'closed', NOTE.usShort]);
  out.push([add(tg, 1), 'Day after Thanksgiving', 'early', NOTE.usEarly]);
  const xmas = usObserved(key(y, 12, 25));
  const eve = key(y, 12, 24);
  if (!weekend(eve) && eve !== xmas) out.push([eve, 'Christmas Eve', 'early', NOTE.usEarly]);
  out.push([xmas, 'Christmas Day', 'closed', NOTE.usClosed]);
  // the following year's New Year's Day observed on Dec 31 (federal only — NYSE stays open)
  if (dow(key(y + 1, 1, 1)) === 6) out.push([key(y, 12, 31), 'New Year’s Day (observed)', 'bank', NOTE.usBank]);
  return out.map((h) => [...h, 'USD', 'US']);
}

function uk(y) {
  const e = easter(y);
  const [ny] = substitute([key(y, 1, 1)]);
  const [x, b] = substitute([key(y, 12, 25), key(y, 12, 26)]);
  const closed = 'UK bank holiday: London Stock Exchange and banks closed.';
  return [
    [ny, 'New Year’s Day', 'closed', closed], [add(e, -2), 'Good Friday', 'closed', closed], [add(e, 1), 'Easter Monday', 'closed', closed],
    [nth(y, 5, 1, 1), 'Early May Bank Holiday', 'closed', closed], [nth(y, 5, 1, -1), 'Spring Bank Holiday', 'closed', closed],
    [nth(y, 8, 1, -1), 'Summer Bank Holiday', 'closed', closed], [x, 'Christmas Day', 'closed', closed], [b, 'Boxing Day', 'closed', closed],
  ].map((h) => [...h, 'GBP', 'UK']);
}

function eu(y) {
  const e = easter(y);
  const target = 'Eurozone TARGET2 payments and Eurex / Xetra closed.';
  const out = [
    [key(y, 1, 1), 'New Year’s Day', 'closed', target, 'EU'], [add(e, -2), 'Good Friday', 'closed', target, 'EU'], [add(e, 1), 'Easter Monday', 'closed', target, 'EU'],
    [key(y, 5, 1), 'Labour Day', 'closed', target, 'EU'],
    [key(y, 12, 24), 'Christmas Eve', 'closed', 'Eurex and Xetra closed (most European exchanges closed or close early).', 'EU'],
    [key(y, 12, 25), 'Christmas Day', 'closed', target, 'EU'], [key(y, 12, 26), 'St. Stephen’s Day', 'closed', target, 'EU'],
    [key(y, 12, 31), 'New Year’s Eve', 'closed', 'Eurex and Xetra closed (most European exchanges closed or close early).', 'EU'],
    // German national holidays: banks closed, Eurex / Xetra trade
    [add(e, 39), 'Ascension Day', 'bank', 'German and Swiss bank holiday; Eurex and Xetra trade. Thinner European liquidity.', 'DE'],
    [add(e, 50), 'Whit Monday', 'bank', 'German and Swiss bank holiday; Eurex trades. Thinner European liquidity.', 'DE'],
    [key(y, 10, 3), 'German Unity Day', 'bank', 'German bank holiday; Eurex and Xetra trade.', 'DE'],
  ];
  return out.filter(([d]) => !weekend(d)).map(([d, n, k, note, c]) => [d, n, k, note, 'EUR', c]);
}

/** Japan: fixed + "Happy Monday" holidays, equinoxes, substitute and sandwiched days; exchanges also close Dec 31 – Jan 3. */
function jp(y) {
  const vernal = Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  const autumn = Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  const base = [
    [key(y, 1, 1), 'New Year’s Day'], [nth(y, 1, 1, 2), 'Coming of Age Day'], [key(y, 2, 11), 'National Foundation Day'], [key(y, 2, 23), 'Emperor’s Birthday'],
    [key(y, 3, vernal), 'Vernal Equinox Day'], [key(y, 4, 29), 'Shōwa Day'], [key(y, 5, 3), 'Constitution Day'], [key(y, 5, 4), 'Greenery Day'], [key(y, 5, 5), 'Children’s Day'],
    [nth(y, 7, 1, 3), 'Marine Day'], [key(y, 8, 11), 'Mountain Day'], [nth(y, 9, 1, 3), 'Respect for the Aged Day'], [key(y, 9, autumn), 'Autumnal Equinox Day'],
    [nth(y, 10, 1, 2), 'Sports Day'], [key(y, 11, 3), 'Culture Day'], [key(y, 11, 23), 'Labour Thanksgiving Day'],
  ];
  const set = new Set(base.map(([d]) => d));
  const out = [...base];
  for (const [d] of base) if (dow(d) === 0) { let s = add(d, 1); while (set.has(s)) s = add(s, 1); set.add(s); out.push([s, 'Substitute holiday']); }
  // a weekday between two holidays is also a holiday (happens in some Septembers)
  for (const d of [...set]) { const mid = add(d, 1), next = add(d, 2); if (!set.has(mid) && set.has(next) && !weekend(mid)) { set.add(mid); out.push([mid, 'Citizens’ holiday']); } }
  for (const [m, d, n] of [[1, 2, 'Bank holiday'], [1, 3, 'Bank holiday'], [12, 31, 'New Year’s Eve (bank holiday)']]) { const k = key(y, m, d); if (!set.has(k)) out.push([k, n]); }
  return out.filter(([d]) => !weekend(d)).map(([d, n]) => [d, n, 'closed', 'Japanese holiday: Tokyo Stock Exchange and banks closed. Thinner yen liquidity in the Asian session.', 'JPY', 'JP']);
}

function ca(y) {
  const e = easter(y);
  const [ny] = substitute([key(y, 1, 1)]);
  const [x, b] = substitute([key(y, 12, 25), key(y, 12, 26)]);
  const closed = 'Canadian holiday: Toronto Stock Exchange and banks closed.';
  const victoria = add(key(y, 5, 25), -((dow(key(y, 5, 25)) + 6) % 7)); // Monday before May 25
  return [
    [ny, 'New Year’s Day', 'closed', closed], [nth(y, 2, 1, 3), 'Family Day', 'closed', closed], [add(e, -2), 'Good Friday', 'closed', closed],
    [victoria, 'Victoria Day', 'closed', closed], [substitute([key(y, 7, 1)])[0], 'Canada Day', 'closed', closed], [nth(y, 8, 1, 1), 'Civic Holiday', 'closed', closed],
    [nth(y, 9, 1, 1), 'Labour Day', 'closed', closed], [nth(y, 10, 1, 2), 'Thanksgiving', 'closed', closed],
    [key(y, 11, 11), 'Remembrance Day', 'bank', 'Canadian banks and bond market closed; Toronto Stock Exchange open.'],
    [x, 'Christmas Day', 'closed', closed], [b, 'Boxing Day', 'closed', closed],
  ].filter(([d]) => !weekend(d)).map((h) => [...h, 'CAD', 'CA']);
}

function au(y) {
  const e = easter(y);
  const [ny] = substitute([key(y, 1, 1)]);
  const [aus] = substitute([key(y, 1, 26)]);
  const [x, b] = substitute([key(y, 12, 25), key(y, 12, 26)]);
  const closed = 'Australian holiday: ASX and banks closed.';
  return [
    [ny, 'New Year’s Day', 'closed', closed], [aus, 'Australia Day', 'closed', closed], [add(e, -2), 'Good Friday', 'closed', closed], [add(e, 1), 'Easter Monday', 'closed', closed],
    [key(y, 4, 25), 'Anzac Day', 'closed', closed], [nth(y, 6, 1, 2), 'King’s Birthday', 'closed', closed], [x, 'Christmas Day', 'closed', closed], [b, 'Boxing Day', 'closed', closed],
  ].filter(([d]) => !weekend(d)).map((h) => [...h, 'AUD', 'AU']);
}

// Matariki is set by law for each year (Te Kāhui o Matariki Public Holiday Act 2022)
const MATARIKI = { 2025: '2025-06-20', 2026: '2026-07-10', 2027: '2027-06-25', 2028: '2028-07-14', 2029: '2029-07-06', 2030: '2030-06-21' };
function nz(y) {
  const e = easter(y);
  const [n1, n2] = substitute([key(y, 1, 1), key(y, 1, 2)]);
  const [x, b] = substitute([key(y, 12, 25), key(y, 12, 26)]);
  const closed = 'New Zealand holiday: NZX and banks closed.';
  const out = [
    [n1, 'New Year’s Day', 'closed', closed], [n2, 'Day after New Year’s Day', 'closed', closed], [substitute([key(y, 2, 6)])[0], 'Waitangi Day', 'closed', closed],
    [add(e, -2), 'Good Friday', 'closed', closed], [add(e, 1), 'Easter Monday', 'closed', closed], [substitute([key(y, 4, 25)])[0], 'Anzac Day', 'closed', closed],
    [nth(y, 6, 1, 1), 'King’s Birthday', 'closed', closed], [nth(y, 10, 1, 4), 'Labour Day', 'closed', closed], [x, 'Christmas Day', 'closed', closed], [b, 'Boxing Day', 'closed', closed],
  ];
  if (MATARIKI[y]) out.push([MATARIKI[y], 'Matariki', 'closed', closed]);
  return out.filter(([d]) => !weekend(d)).map((h) => [...h, 'NZD', 'NZ']);
}

function ch(y) {
  const e = easter(y);
  const closed = 'Swiss holiday: SIX Swiss Exchange and banks closed.';
  return [
    [key(y, 1, 1), 'New Year’s Day', 'closed', closed], [key(y, 1, 2), 'Berchtold’s Day', 'closed', closed], [add(e, -2), 'Good Friday', 'closed', closed],
    [add(e, 1), 'Easter Monday', 'closed', closed], [key(y, 5, 1), 'Labour Day', 'closed', closed], [add(e, 39), 'Ascension Day', 'closed', closed],
    [add(e, 50), 'Whit Monday', 'closed', closed], [key(y, 8, 1), 'Swiss National Day', 'closed', closed], [key(y, 12, 24), 'Christmas Eve', 'closed', closed],
    [key(y, 12, 25), 'Christmas Day', 'closed', closed], [key(y, 12, 26), 'St. Stephen’s Day', 'closed', closed], [key(y, 12, 31), 'New Year’s Eve', 'closed', closed],
  ].filter(([d]) => !weekend(d)).map((h) => [...h, 'CHF', 'CH']);
}

const COUNTRY_NAME = { US: 'US', UK: 'UK', EU: 'Eurozone', DE: 'Germany', JP: 'Japan', CA: 'Canada', AU: 'Australia', NZ: 'New Zealand', CH: 'Switzerland' };
const KIND_LABEL = { closed: 'markets closed', early: 'early close', bank: 'banks closed' };

/** Holidays between two dates (YYYY-MM-DD, inclusive) as calendar events. */
export function holidayEvents(from, to) {
  const out = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const [date, name, kind, note, ccy, country] of [...us(y), ...uk(y), ...eu(y), ...jp(y), ...ca(y), ...au(y), ...nz(y), ...ch(y)]) {
      if (date < from || date > to) continue;
      out.push({
        id: `hol:${date}:${country}:${name}`, t: `${date}T12:00:00.000Z`, allDay: true, ccy, title: `${COUNTRY_NAME[country]}: ${name} — ${KIND_LABEL[kind]}`,
        short: `${COUNTRY_NAME[country]} ${name}`, holiday: kind, note, impact: 'holiday', src: 'holiday', actual: null, forecast: null, previous: null,
      });
    }
  }
  return out.sort((a, b) => a.t.localeCompare(b.t) || a.ccy.localeCompare(b.ccy));
}
