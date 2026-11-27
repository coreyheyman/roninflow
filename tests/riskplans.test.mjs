import test from 'node:test';
import assert from 'node:assert/strict';
import { riskOf, defaultRiskOf, ownRiskOf, suggestRisk, DEFAULT_RISK, riskState } from '../src/lib/playbook.js';

const st = (settings) => ({ settings: { account: 'all', ...settings }, accounts: [], trades: [] });

test('every account uses the default plan until it has its own', () => {
  const s = st({ risk: { damageDD: 3000 }, account: 'A' });
  assert.equal(riskOf(s).damageDD, 3000);
  assert.equal(riskOf(s, 'B').damageDD, 3000);
  assert.equal(ownRiskOf(s, 'A'), null);
  assert.deepEqual(riskOf(s).tiers, DEFAULT_RISK.tiers);
});

test('an account with its own plan gets it; the others keep the default', () => {
  const tiers = DEFAULT_RISK.tiers.map((t) => ({ ...t, dailyLL: t.dailyLL / 2 }));
  const s = st({ risk: { damageDD: 3000 }, riskByAccount: { A: { ...DEFAULT_RISK, damageDD: 800, tiers, ddMode: 'start' } }, account: 'A' });
  assert.equal(riskOf(s).damageDD, 800); // selected account
  assert.equal(riskOf(s).ddMode, 'start');
  assert.equal(riskOf(s).tiers[2].dailyLL, 250);
  assert.equal(riskOf(s, 'B').damageDD, 3000);
  assert.equal(riskOf(s, 'all').damageDD, 3000); // all accounts combined → default
  assert.equal(defaultRiskOf(s).damageDD, 3000);
  // an own plan saved without tiers falls back to the default tiers
  const s2 = st({ riskByAccount: { A: { damageDD: 500 } }, account: 'A' });
  assert.deepEqual(riskOf(s2).tiers, DEFAULT_RISK.tiers);
  assert.equal(riskOf(s2).maxLossStreak, DEFAULT_RISK.maxLossStreak);
});

test('the tier engine uses whichever plan it is given', () => {
  const day = (date, pnl) => ({ id: date, entry: `${date}T10:00:00`, exit: `${date}T10:05:00`, pnl, qty: 1, symbol: 'MES' });
  const trades = [day('2026-10-01', 400), day('2026-10-02', -700)]; // 700 drawdown from the peak
  const loose = riskState(trades, {}, riskOf(st({})));
  const tight = riskState(trades, {}, riskOf(st({ riskByAccount: { A: { ...DEFAULT_RISK, riskOffDD: 500, damageDD: 600 } }, account: 'A' })));
  assert.equal(loose.tier.name, 'Normal');
  assert.equal(tight.tier.name, 'Damage control');
});

test('suggested plan scales to the account and respects its daily loss limit', () => {
  const base = DEFAULT_RISK; // damage control at 2000 → assumes a 4000 max drawdown
  const small = suggestRisk(base, { maxDrawdown: 2000, dailyLossLimit: 200 });
  assert.equal(small.damageDD, 1000);
  assert.equal(small.riskOffDD, 500);
  assert.deepEqual(small.tiers.map((t) => t.dailyLL), [50, 100, 200, 200]); // capped by the firm's $200 daily limit
  assert.deepEqual(small.tiers.map((t) => t.riskMax), [25, 50, 100, 150]);
  const big = suggestRisk(base, { maxDrawdown: 8000 });
  assert.equal(big.damageDD, 4000);
  assert.equal(big.tiers[2].dailyLL, 1000);
  assert.deepEqual(suggestRisk(base, {}), JSON.parse(JSON.stringify(base))); // no max drawdown: plain copy
  assert.notEqual(suggestRisk(base, {}).tiers, base.tiers); // a copy, not the same object
});

test('more tiers: you choose the Normal tier, and unlocking opens every tier above it', async () => {
  const { normalIndex, newTier } = await import('../src/lib/playbook.js');
  const T = (id, dailyLL) => ({ id, name: id, dailyLL, riskMin: dailyLL / 5, riskMax: dailyLL / 2.5, color: '#fff' });
  const six = [T('dc', 100), T('off', 200), T('light', 350), T('normal', 500), T('up1', 700), T('up2', 900)];
  const plan = { ...DEFAULT_RISK, tiers: six, normalTier: 'normal' };
  assert.equal(normalIndex(plan), 3);
  assert.equal(normalIndex({ ...plan, normalTier: 'gone' }), 2); // unknown → the third tier, as before
  assert.equal(normalIndex(DEFAULT_RISK), 2); // the original four-tier plan is unchanged
  const day = (date, pnl) => ({ id: date, entry: `${date}T10:00:00`, exit: `${date}T10:05:00`, pnl, qty: 1, symbol: 'MES' });
  // no trades: you sit at Normal; tiers above are locked
  let r = riskState([], {}, plan);
  assert.equal(r.tier.name, 'normal');
  assert.equal(r.normal, 3);
  // two max-loss days step down one tier at a time through the extra tiers
  const losing = [day('2026-10-01', -500), day('2026-10-02', -500), day('2026-10-05', -10)];
  r = riskState(losing, {}, { ...plan, damageDD: 99999, riskOffDD: 99999 });
  assert.equal(r.tier.name, 'off'); // normal → light (2 max-loss days) → off (another red day)
  // unlocked: big green days climb past Normal to the very top
  const green = [day('2026-10-01', 600), day('2026-10-02', 800), day('2026-10-05', 1000)];
  r = riskState(green, {}, { ...plan, unlockTop: true });
  assert.equal(r.normal, 5);
  assert.equal(r.tier.name, 'up2');
  // a new tier sits a step above the one given
  const nt = newTier(six[5]);
  assert.equal(nt.dailyLL, 1125);
  assert.ok(nt.id && nt.id !== newTier(six[5]).id);
});

test('each tier below Normal can kick in at its own drawdown', async () => {
  const { tierDD, withTierDD, ddSteps } = await import('../src/lib/playbook.js');
  const T = (id, dailyLL, capDD) => ({ id, name: id, dailyLL, riskMin: 10, riskMax: 20, color: '#fff', ...(capDD !== undefined ? { capDD } : {}) });
  // older plans: the two plan-wide thresholds become the first two tiers' thresholds
  assert.deepEqual(tierDD(DEFAULT_RISK), [2000, 1000, null, null]);
  const migrated = withTierDD(DEFAULT_RISK);
  assert.deepEqual(migrated.tiers.map((t) => t.capDD), [2000, 1000, undefined, undefined]);
  // five tiers below Normal, one with no threshold (streak rules only)
  const plan = { ...DEFAULT_RISK, normalTier: 'normal', tiers: [T('dc', 50, 900), T('off', 100, 600), T('light', 150, null), T('easy', 200, 200), T('normal', 300), T('up', 400, 5)] };
  assert.deepEqual(tierDD(plan), [900, 600, null, 200, null, null]); // Normal and above never have one
  assert.deepEqual(ddSteps(plan).map((x) => [x.name, x.at]), [['easy', 200], ['off', 600], ['dc', 900]]);
  const day = (date, pnl) => ({ id: date, entry: `${date}T10:00:00`, exit: `${date}T10:05:00`, pnl, qty: 1, symbol: 'MES' });
  const at = (ddAmount) => riskState([day('2026-10-01', 1000), day('2026-10-02', -ddAmount)], {}, plan);
  let r = at(100);
  assert.equal(r.tier.name, 'normal');
  assert.deepEqual([r.nextDrop.name, Math.round(r.nextDrop.left)], ['easy', 100]);
  r = at(250);
  assert.equal(r.ddLevel, 3); // capped at "easy"
  assert.deepEqual([r.nextDrop.name, Math.round(r.nextDrop.left)], ['off', 350]);
  assert.equal(r.recover.name, 'easy');
  assert.match(r.reasons[0], /“easy”/);
  r = at(700);
  assert.equal(r.ddLevel, 1);
  r = at(950);
  assert.equal(r.ddLevel, 0);
  assert.equal(r.nextDrop, null);
});

test('days to ruin follows the tiers down as losses pile up', async () => {
  const { daysToRuin } = await import('../src/lib/playbook.js');
  const today = new Date().toISOString().slice(0, 10);
  // default plan: Normal $500/day; 2 max-loss days → Risk off ($200, also at $1,000 drawdown); every red day after → Damage control ($100)
  const wed = '2026-11-18'; // a weekday, so today counts as day 1
  const r = daysToRuin([], {}, DEFAULT_RISK, 3000, { today: wed });
  // today 500 + 500 (→ Risk off) + 200 (→ Damage control) = 1,200; then $100 days while staying under 3,000: 17 → 20 days, ruin on the 21st
  assert.deepEqual(r.segments.map((s) => [s.name, s.from, s.to, s.loss]), [['Normal', 1, 1, 500], ['Normal', 2, 2, 500], ['Risk off', 3, 3, 200], ['Damage control', 4, 20, 100]]);
  assert.equal(r.days, 20);
  assert.equal(r.ruinDay, 21);
  assert.equal(r.lost, 2900);
  assert.ok(r.segments[0].today);
  // the firm's daily loss limit caps each day
  assert.equal(r.ruinDate, '2026-12-16'); // 20 trading days from Wed 18th, then the next one
  // on a weekend there's no session today: day 1 is Monday
  const sun = daysToRuin([], {}, DEFAULT_RISK, 3000, { today: '2026-11-15' });
  assert.equal(sun.days, 20); assert.ok(!sun.segments[0].today);
  const capped = daysToRuin([], {}, DEFAULT_RISK, 3000, { firmDaily: 300, today: wed });
  assert.equal(capped.segments[0].loss, 300);
  // drawdown thresholds kick in on their own: a plan with no streak rule still drops at 1,000 and 2,000
  const noStreak = { ...DEFAULT_RISK, maxLossStreak: 99 };
  const n = daysToRuin([], {}, noStreak, 3000, { today: wed });
  assert.deepEqual(n.segments.map((s) => [s.name, s.loss]).slice(-2), [['Risk off', 200], ['Damage control', 100]]);
  assert.equal(n.segments.filter((s) => s.name === 'Normal').reduce((a, s) => a + (s.to - s.from + 1), 0), 2); // 500 + 500 hits the 1,000 threshold
  // already at or past the floor
  assert.deepEqual([daysToRuin([], {}, DEFAULT_RISK, 0).days, daysToRuin([], {}, DEFAULT_RISK, 0).ruinDay], [0, 1]);
  // a bigger cushion takes longer but finishes instantly (the lowest tier is worked out, not looped)
  const t0 = Date.now(); const big = daysToRuin([], {}, DEFAULT_RISK, 100000, { today: wed });
  assert.equal(big.days, 3 + 987); assert.ok(Date.now() - t0 < 500);
  assert.equal(daysToRuin([], {}, DEFAULT_RISK, null), null);
  void today;
});

test('risk profiles: accounts can follow a saved profile, and edits to it reach every account using it', async () => {
  const { riskSourceOf, profilesOf, matchingProfiles } = await import('../src/lib/playbook.js');
  const small = { ...DEFAULT_RISK, tiers: DEFAULT_RISK.tiers.map((t) => ({ ...t, dailyLL: t.dailyLL / 4 })) };
  const settings = {
    risk: { damageDD: 3000 },
    riskProfiles: [{ id: 'p2k', name: '$2k DD', maxDD: 2000, plan: small }, { id: 'p5k', name: '$5k DD', maxDD: 5000, plan: { ...DEFAULT_RISK, damageDD: 2500 } }, { id: 'broken' }],
    riskByAccount: { A: { profile: 'p2k' }, B: { profile: 'p2k' }, C: { profile: 'gone' }, D: { ...DEFAULT_RISK, damageDD: 900 } },
  };
  const s = st(settings);
  assert.equal(profilesOf(s).length, 2); // the broken entry is ignored
  assert.equal(riskOf(s, 'A').tiers[2].dailyLL, 125);
  assert.equal(riskOf(s, 'B').tiers[2].dailyLL, 125);
  assert.equal(riskSourceOf(s, 'A').kind, 'profile');
  assert.equal(riskSourceOf(s, 'A').profile.name, '$2k DD');
  assert.equal(riskSourceOf(s, 'C').kind, 'default'); // its profile was deleted
  assert.equal(riskOf(s, 'C').damageDD, 3000);
  assert.equal(riskSourceOf(s, 'D').kind, 'own');
  assert.equal(riskOf(s, 'D').damageDD, 900);
  assert.equal(riskSourceOf(s, 'E').kind, 'default');
  assert.equal(riskSourceOf(s, 'all').kind, 'default');
  // editing the profile changes both accounts that follow it
  const edited = st({ ...settings, riskProfiles: [{ ...settings.riskProfiles[0], plan: { ...small, maxLossStreak: 3 } }] });
  assert.equal(riskOf(edited, 'A').maxLossStreak, 3);
  assert.equal(riskOf(edited, 'B').maxLossStreak, 3);
  // suggestions by drawdown size
  assert.deepEqual(matchingProfiles(profilesOf(s), { maxDrawdown: 2000 }).map((p) => p.id), ['p2k']);
  assert.deepEqual(matchingProfiles(profilesOf(s), { maxDrawdown: 3000 }), []);
  assert.deepEqual(matchingProfiles(profilesOf(s), {}), []);
});

test('the tier moves at the end of the day: a losing day doesn’t drop you a tier halfway through it', () => {
  const T = (date, pnl) => ({ id: date + pnl, entry: `${date}T10:00:00`, exit: `${date}T10:05:00`, pnl, qty: 1, symbol: 'MES' });
  const trades = [T('2026-11-26', 400), T('2026-11-27', -1200)]; // today: 1,200 below the high, past "Risk off" at 1,000
  const plan = riskOf(st({}));
  const eod = riskState(trades, {}, plan, { today: '2026-11-27' });
  assert.equal(eod.tier.name, 'Normal', 'still Normal today');
  assert.equal(eod.remaining, 500 - 1200, 'today’s loss still counts against Normal’s $500 daily limit');
  assert.equal(eod.stopNow, true);
  assert.equal(eod.pending?.tier.name, 'Risk off', 'and it says where tomorrow starts');
  const tomorrow = riskState(trades, {}, plan, { today: '2026-11-30' });
  assert.equal(tomorrow.tier.name, 'Risk off');
  const live = riskState(trades, {}, { ...plan, tierUpdate: 'live' }, { today: '2026-11-27' });
  assert.equal(live.tier.name, 'Risk off', 'straight away when asked');
  assert.equal(live.pending, null);
});
