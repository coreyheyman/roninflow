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
