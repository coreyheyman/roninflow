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
