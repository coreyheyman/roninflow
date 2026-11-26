import test from 'node:test';
import assert from 'node:assert/strict';
import { contractDates, parseSymbol, rollStatus, holidays, contracts } from '../rolls.js';

const at = (s) => new Date(`${s}T15:00:00Z`);

test('known exchange dates', () => {
  assert.deepEqual(contractDates('ES', 2025, 11), { last: '2025-12-19', roll: '2025-12-11', lastLabel: 'Last trading day' }); // CME roll date for ESZ5
  assert.equal(contractDates('NQ', 2026, 11).roll, '2026-12-10');
  assert.equal(contractDates('NQ', 2026, 11).last, '2026-12-18');
  assert.equal(contractDates('CL', 2026, 0).last, '2025-12-19'); // CLF6: the 25th is Christmas
  assert.equal(contractDates('GC', 2026, 11).last, '2026-11-30'); // GCZ6 first notice
  assert.ok(holidays(2026).has('2026-04-03')); // Good Friday
  assert.ok(holidays(2026).has('2026-07-03')); // Independence Day observed
});

test('symbols in the forms platforms use', () => {
  const now = at('2026-11-25');
  assert.deepEqual(parseSymbol('nqz6', now), { root: 'NQ', month: 11, year: 2026, digits: 1 });
  assert.deepEqual(parseSymbol('MNQH27', now), { root: 'MNQ', month: 2, year: 2027, digits: 2 });
  assert.equal(parseSymbol('M2KZ6', now).root, 'M2K');
  assert.equal(parseSymbol('/ESZ2026', now).year, 2026);
  assert.equal(parseSymbol('6EZ6.CME', now).root, '6E');
  assert.equal(parseSymbol('NQ', now), null);
  assert.equal(parseSymbol('NQH0', now).year, 2030);
});

test('what to do with the contract you hold', () => {
  assert.equal(rollStatus('NQZ6', at('2026-11-25')).phase, 'hold');
  const soon = rollStatus('NQZ6', at('2026-12-07'));
  assert.equal(soon.phase, 'soon');
  assert.equal(soon.switchTo.symbol, 'NQH7');
  assert.equal(soon.daysToRoll, 3);
  const roll = rollStatus('NQZ6', at('2026-12-11'));
  assert.equal(roll.phase, 'roll');
  assert.equal(roll.switchTo.symbol, 'NQH7');
  assert.equal(rollStatus('NQZ6', at('2026-12-21')).phase, 'expired');
  assert.equal(rollStatus('NQH7', at('2026-12-01')).phase, 'early');
  assert.equal(rollStatus('MNQZ26', at('2026-12-11')).switchTo.symbol, 'MNQH27'); // keeps the 2-digit style
  assert.equal(rollStatus('NQ', at('2026-11-25')).front.symbol, 'NQZ6');
  assert.equal(rollStatus('CL', at('2026-11-25')).front.symbol, 'CLF7');
  assert.equal(contracts('GC', at('2026-11-25')).every((c) => 'GJMQVZ'.includes('FGHJKMNQUVXZ'[c.month])), true);
});

test('a market without a contract month still gets the roll window', () => {
  assert.equal(rollStatus('NQ', at('2026-12-08')).phase, 'soon');
  const r = rollStatus('NQ', at('2026-12-11'));
  assert.equal(r.phase, 'rolled');
  assert.equal(r.switchTo.symbol, 'NQH7');
  assert.equal(rollStatus('NQ', at('2026-12-20')).phase, 'hold');
});

test('volume moving to the next contract triggers the switch before the calendar date', async () => {
  const { rollAdvice } = await import('../rolls.js');
  const { sessionVolumes, compare } = await import('../rollvol.js');
  const st = rollStatus('GCZ6', at('2026-11-23')); // before the calendar roll (Nov 25)
  assert.equal(st.phase, 'soon');
  const vol = { a: { symbol: 'GCZ6', year: 2026, month: 11, last: 90000 }, b: { symbol: 'GCG7', year: 2027, month: 1, last: 210000 } };
  const adv = rollAdvice(st, { ...vol, ...compare(vol.a, vol.b) });
  assert.equal(adv.phase, 'roll');
  assert.equal(adv.reason, 'volume');
  assert.equal(adv.switchTo.symbol, 'GCG7');
  assert.ok(Math.abs(adv.share - 0.7) < 0.01);
  // volume still on the current contract: the calendar decides
  const quiet = { a: { ...vol.a, last: 300000 }, b: { ...vol.b, last: 20000 } };
  assert.equal(rollAdvice(st, { ...quiet, ...compare(quiet.a, quiet.b) }).phase, 'soon');
  // no data: unchanged
  assert.equal(rollAdvice(st, null).phase, 'soon');
  assert.equal(sessionVolumes(null, Date.now()).last, null);
});
