import test from 'node:test';
import assert from 'node:assert/strict';
import { accountPerformance, beijingDay, performanceSeries, recordValuation } from './analytics.js';
import { makeAccount } from './domain.js';

test('profit removes deposits and fees remain in account equity', () => {
  const account = { ...makeAccount(), cash: 845, positions: { '706014:foil': { qty: 1, average: 146.62 } }, deposits: [{ amount: 1000 }] };
  const value = accountPerformance(account, { '706014:foil': 144 });
  assert.equal(value.equity, 989);
  assert.equal(value.profit, -11);
  assert.ok(Math.abs(value.returnRate + 1.1) < 1e-9);
  assert.equal(accountPerformance({ ...account, cash: 1845, deposits: [{ amount: 2000 }] }, { '706014:foil': 144 }).profit, -11);
});

test('missing prices and accounts without deposits do not create false returns', () => {
  const account = { ...makeAccount(), cash: 500, positions: { '706014:foil': { qty: 1, average: 100 } }, deposits: [{ amount: 500 }] };
  assert.equal(accountPerformance(account, {}).profit, null);
  assert.equal(accountPerformance(makeAccount(), {}).returnRate, null);
});

test('daily valuation keeps one observed point per Beijing day; weekly uses final observed day', () => {
  assert.equal(beijingDay(new Date('2026-10-15T16:00:00Z')), '2026-10-16');
  const v = (profit) => ({ equity: 1000 + profit, deposits: 1000, profit });
  let points = recordValuation([], v(5), new Date('2026-10-15T04:00:00Z'));
  points = recordValuation(points, v(7), new Date('2026-10-15T08:00:00Z'));
  points = recordValuation(points, v(-3), new Date('2026-10-16T04:00:00Z'));
  points = recordValuation(points, v(12), new Date('2026-10-19T04:00:00Z'));
  assert.deepEqual(performanceSeries(points, 'day').map(({ day, profit }) => [day, profit]), [['2026-10-15', 7], ['2026-10-16', -3], ['2026-10-19', 12]]);
  assert.deepEqual(performanceSeries(points, 'week').map(({ day, profit }) => [day, profit]), [['2026-10-16', -3], ['2026-10-19', 12]]);
});
