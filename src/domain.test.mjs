import test from 'node:test';
import assert from 'node:assert/strict';
import { assetKey, depositFunds, executeTrade as executeTradeAtTime, initialState, makeAccount, tradeCosts, tradingSession } from './domain.js';

const AT_OPEN = new Date('2026-10-15T04:00:00.000Z'); // 北京时间 12:00
const executeTrade = (account, order) => executeTradeAtTime(account, order, AT_OPEN);

test('Beijing trading window opens at 07:00 and closes at 23:00', () => {
  assert.equal(tradingSession(new Date('2026-10-15T14:59:59.999Z')).open, true);
  assert.deepEqual(tradingSession(new Date('2026-10-15T15:00:00.000Z')).nextOpen, '次日 07:00');
  assert.equal(tradingSession(new Date('2026-10-15T22:59:59.999Z')).open, false);
  assert.equal(tradingSession(new Date('2026-10-15T23:00:00.000Z')).open, true);
});

test('submit rechecks the trading window and does not mutate the ledger while closed', () => {
  const account = makeAccount();
  const order = { id: '706014', finish: 'foil', side: 'buy', qty: 1, price: 143.04 };
  assert.throws(() => executeTradeAtTime(account, order, new Date('2026-10-15T15:00:00.000Z')), /闭市中/);
  assert.equal(account.cash, 0);
  assert.equal(account.orders.length, 0);
});

test('accounts maintain independent cash and positions', () => {
  const state = initialState();
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.accounts[0].currency, 'USD');
  assert.equal(state.accounts[0].cash, 0);
  const other = makeAccount('second', '练习账户');
  const funded = depositFunds(state.accounts[0], '1000', AT_OPEN);
  const bought = executeTrade(funded, { id: '706014', finish: 'foil', side: 'buy', qty: 1, price: 143.04, source: 'RiftHunt' });
  assert.equal(bought.positions[assetKey('706014','foil')].qty, 1);
  assert.equal(bought.deposits.length, 1);
  assert.equal(other.cash, 0);
  assert.equal(other.positions[assetKey('706014','foil')], undefined);
});

test('same product and finish can be bought and sold after a daily quote change', () => {
  const account = depositFunds(makeAccount(), '25000', AT_OPEN);
  const bought = executeTrade(account, { id: '706014', finish: 'foil', side: 'buy', qty: 1, price: 143.04, source: 'RiftHunt' });
  const sold = executeTrade(bought, { id: '706014', finish: 'foil', side: 'sell', qty: 1, price: 144.36, source: 'RiftHunt' });
  assert.equal(bought.cash, 24853.38);
  assert.equal(bought.positions[assetKey('706014','foil')].average, 146.62);
  assert.equal(sold.cash, 24994.13);
  assert.ok(Math.abs(sold.realized - (-5.87)) < 0.0001);
  assert.equal(sold.positions[assetKey('706014','foil')], undefined);
  assert.deepEqual(sold.orders.map((order) => order.source), ['RiftHunt','RiftHunt']);
  assert.deepEqual(sold.orders.map((order) => order.fee), [3.61,3.58]);
  assert.deepEqual(sold.orders.map((order) => order.balanceAfter), [24994.13,24853.38]);
});

test('simulated deposits add cash and preserve dated account-level records', () => {
  const first = depositFunds(makeAccount(), '1000.50', new Date('2026-10-15T15:00:00.000Z'));
  const second = depositFunds(first, '0.01', AT_OPEN);
  assert.equal(first.cash, 1000.50);
  assert.equal(second.cash, 1000.51);
  assert.deepEqual(second.deposits.map((entry) => entry.amount), [0.01, 1000.50]);
  assert.equal(second.deposits[0].balanceAfter, 1000.51);
  assert.equal(second.deposits[0].accountId, 'us-primary');
  assert.equal(first.deposits[0].createdAt, '2026-10-15T15:00:00.000Z');
  assert.equal(makeAccount('other').deposits.length, 0);
});

test('deposit amount accepts cents only within the single-deposit limit', () => {
  for (const amount of ['0', '0.001', '-1', '1e3', '1000000.01', 'abc']) {
    assert.throws(() => depositFunds(makeAccount(), amount));
  }
  assert.equal(depositFunds(makeAccount(), '1000000').cash, 1000000);
});

test('fee is 2.5% of gross with a $0.30 minimum and rounded per order', () => {
  assert.deepEqual(tradeCosts(143.04, 1, 'buy'), { amount: 143.04, fee: 3.58, total: 146.62, percentageFee: 3.58, minimumApplied: false });
  assert.deepEqual(tradeCosts(0.10, 2, 'buy'), { amount: 0.20, fee: 0.30, total: 0.50, percentageFee: 0.01, minimumApplied: true });
  assert.deepEqual(tradeCosts(0.10, 2, 'sell'), { amount: 0.20, fee: 0.30, total: -0.10, percentageFee: 0.01, minimumApplied: true });
});

test('cash validation includes buy fee and low-value sell needs positive proceeds', () => {
  const account = { ...makeAccount(), cash: 143.04 };
  assert.throws(() => executeTrade(account, { id: '706014', finish: 'foil', side: 'buy', qty: 1, price: 143.04 }), /含手续费/);
  const bought = executeTrade(depositFunds(makeAccount(), '1'), { id: 'cheap', finish: 'normal', side: 'buy', qty: 1, price: 0.10 });
  assert.throws(() => executeTrade(bought, { id: 'cheap', finish: 'normal', side: 'sell', qty: 1, price: 0.10 }), /最低手续费/);
});

test('a different finish cannot sell the held card', () => {
  const bought = executeTrade(depositFunds(makeAccount(), '1000'), { id: '706014', finish: 'foil', side: 'buy', qty: 1, price: 143.04 });
  assert.throws(() => executeTrade(bought, { id: '706014', finish: 'normal', side: 'sell', qty: 1, price: 140 }), /持仓数量不足/);
});

test('new account starts with an empty independent valuation ledger', () => {
  assert.deepEqual(initialState().accounts[0].valuations, []);
  assert.deepEqual(makeAccount('second').valuations, []);
});
