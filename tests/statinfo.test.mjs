import test from 'node:test';
import assert from 'node:assert/strict';
import { explain, statKey, STATS } from '../src/lib/statInfo.js';

const $ = (x) => `$${Math.round(x)}`;
const ctx = { count: 40, wins: 16, losses: 24, winRate: 40, avgWin: 300, avgLoss: -100, net: 2400, maxDD: 600, days: 12, avgWinDay: 500, avgLossDay: -200 };

test('labels on screen map to stats', () => {
  for (const [label, key] of [['Profit Factor', 'profitFactor'], ['Win rate', 'winRate'], ['Realized P&L', 'net'], ['Total P&L', 'net'], ['Sharpe ratio', 'sharpe'],
    ['Max drawdown', 'maxDD'], ['Biggest drawdown', 'maxDD'], ['EV', 'ev'], ['Max consecutive losing days', 'maxLossStreak'], ['Reward : risk', 'payoff'], ['Avg hold', null]]) {
    assert.equal(statKey(label), key, label);
  }
});

test('win rate is judged against the break-even win rate, not a fixed 50%', () => {
  const r = explain('winRate', 40, ctx, $).result;
  assert.equal(r.tone, 'good'); // 3:1 payoff → 25% needed
  assert.match(r.text, /25%/);
  const r2 = explain('winRate', 60, { ...ctx, winRate: 60, avgWin: 50, avgLoss: -100 }, $).result;
  assert.equal(r2.tone, 'bad'); // 1:2 payoff → 67% needed
});

test('every stat explains itself for normal, empty and edge values without throwing', () => {
  for (const key of Object.keys(STATS)) {
    for (const [v, c] of [[1.2, ctx], [0, {}], [Infinity, ctx], [null, ctx], [-50, ctx]]) {
      const e = explain(key, v, c, $);
      assert.ok(e.name && e.what && e.how, key);
      assert.ok(e.result && typeof e.result.text === 'string' && e.result.verdict != null, `${key} ${v}`);
    }
  }
});

test('small samples are flagged', () => {
  assert.equal(explain('profitFactor', 2, { ...ctx, count: 8 }, $).small, true);
  assert.equal(explain('profitFactor', 2, ctx, $).small, false);
});
