import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, makeAccount, depositFunds, executeTrade } from './domain.js';
import { canonicalJson, createBackup, readBackup, MAX_BACKUP_BYTES } from './backup.js';

const at = new Date('2026-10-15T04:00:00.000Z');
const later = new Date('2026-10-15T05:00:00.000Z');
const order = { id: '706014', name: 'Nasus', set: 'VEN', number: 192, finish: 'foil', side: 'buy', qty: 3, price: 143.04, quoteDate: '2026-10-14', source: 'RiftHunt', feed: 'rift', accountId: 'us-primary', accountName: '主账户' };
function stateWithTrades() {
  const state = initialState();
  let account = depositFunds(state.accounts[0], '1000', at);
  account = executeTrade(account, order, at);
  account = executeTrade(account, { ...order, side: 'sell', qty: 1, price: 145 }, at);
  account = depositFunds(account, '5.50', at);
  state.accounts = [account, makeAccount('second', '另一个账户')];
  state.entered = true;
  state.watch = ['706014'];
  return state;
}
async function rewrite(content, edit) {
  const file = JSON.parse(content);
  edit(file);
  const { checksum, ...payload } = file;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(payload)));
  file.checksum.value = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return JSON.stringify(file);
}

test('backup round trip preserves independent accounts and replays same-millisecond events', async () => {
  const state = stateWithTrades();
  const result = await readBackup(await createBackup(state, later), later);
  assert.deepEqual(result.state, state);
  assert.equal(result.summary.accounts, 2);
  assert.equal(result.summary.trades, 2);
  assert.equal(result.summary.deposits, 2);
  assert.equal(result.state.accounts[1].cash, 0);
  assert.deepEqual((await readBackup(await createBackup(initialState(), later), later)).state, initialState());
});

test('corrupted checksum is rejected even when account data remains consistent', async () => {
  const file = JSON.parse(await createBackup(stateWithTrades(), later));
  file.state.accounts[0].name = '改过的名称';
  await assert.rejects(readBackup(JSON.stringify(file), later), /校验和不匹配/);
});

test('recomputed checksums do not bypass balance, cost or fee checks', async () => {
  const content = await createBackup(stateWithTrades(), later);
  for (const edit of [
    (file) => { file.state.accounts[0].cash += 100; },
    (file) => { file.state.accounts[0].positions['706014:foil'].average += 1; },
    (file) => { file.state.accounts[0].orders[0].fee = 0.30; },
    (file) => { file.state.accounts[0].orders[0].qty = 999; },
    (file) => { file.state.accounts[0].deposits[0].amount = 5.555; },
    (file) => { file.state.accounts[0].orders[0].accountId = 'second'; },
    (file) => { file.state.accounts[0].deposits[0].sequence = 1; },
    (file) => { file.state.accounts[0].orders.push(file.state.accounts[0].orders[0]); },
  ]) await assert.rejects(readBackup(await rewrite(content, edit), later));
});

test('invalid schema, excessive files and future dates are rejected without mutating input state', async () => {
  const state = stateWithTrades();
  const original = structuredClone(state);
  const content = await createBackup(state, later);
  await assert.rejects(readBackup('not json', later), /JSON/);
  await assert.rejects(readBackup(' '.repeat(MAX_BACKUP_BYTES + 1), later), /5 MB/);
  for (const edit of [
    (file) => { file.formatVersion = 999; },
    (file) => { file.state.activeAccountId = 'missing'; },
    (file) => { file.state.accounts[0].currency = 'CNY'; },
    (file) => { file.state.accounts[0].cash = '1000'; },
    (file) => { file.state.accounts.push(file.state.accounts[0]); },
    (file) => { file.state.accounts[0].secret = 'unexpected'; },
    (file) => { file.exportedAt = '2030-01-01T00:00:00.000Z'; },
    (file) => { file.state.accounts[0].valuations = [{ day: '2026-10-15', equity: 10, deposits: 1000, profit: 50 }]; },
    (file) => { file.state.accounts[0].valuations = [{ day: '2099-10-15', equity: 1000, deposits: 1000, profit: 0 }]; },
  ]) await assert.rejects(readBackup(await rewrite(content, edit), later));
  assert.deepEqual(state, original);
});

test('import is replacement data: reading the same backup twice never adds deposits', async () => {
  const content = await createBackup(stateWithTrades(), later);
  const first = await readBackup(content, later);
  const second = await readBackup(content, later);
  assert.deepEqual(first.state, second.state);
  assert.equal(second.summary.deposits, 2);
});

test('checksum is not authentication: a wholly consistent rewritten history cannot be distinguished', async () => {
  const state = initialState();
  state.accounts[0] = depositFunds(state.accounts[0], '100', at);
  const content = await rewrite(await createBackup(state, later), (file) => {
    file.state.accounts[0].cash = 200;
    file.state.accounts[0].deposits[0].amount = 200;
    file.state.accounts[0].deposits[0].balanceAfter = 200;
  });
  assert.equal((await readBackup(content, later)).state.accounts[0].cash, 200);
});
