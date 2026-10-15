import { depositFunds, executeTrade, makeAccount, FEE_POLICY, FEE_RATE, MIN_FEE, MAX_DEPOSIT } from './domain.js';
import { beijingDay } from './analytics.js';

export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS = 10000;
const MAX_MONEY = 1e12;
const productId = /^\d{4,10}$/;
const identifier = /^[a-zA-Z0-9_-]{1,100}$/;
const fail = (message) => { throw new Error(message); };
const check = (condition, message) => { if (!condition) fail(message); };
const finite = (value, min = -MAX_MONEY, max = MAX_MONEY) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const cents = (value, min = 0, max = MAX_MONEY) => finite(value, min, max) && Math.abs(value * 100 - Math.round(value * 100)) < 0.001;
const same = (a, b) => Math.abs(a - b) < 0.000001;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function fields(value, keys, context) {
  check(value && typeof value === 'object' && !Array.isArray(value), `${context}格式无效`);
  check(Object.keys(value).every((key) => keys.includes(key)), `${context}含有不支持的字段`);
}
function iso(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function dateOnly(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function unique(values, context) {
  check(new Set(values).size === values.length, `${context}存在重复 ID`);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function digest(value) {
  check(Boolean(globalThis.crypto?.subtle), '当前环境不支持安全校验，请使用 HTTPS 或 localhost 打开网站');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateAccount(account, recordIds, exportedAt) {
  fields(account, ['id', 'name', 'market', 'currency', 'cash', 'realized', 'positions', 'orders', 'deposits', 'valuations'], '账户');
  check(typeof account.id === 'string' && identifier.test(account.id) && text(account.name, 24), '账户 ID 或名称无效');
  check(account.market === 'US' && account.currency === 'USD', '暂只支持美区 USD 账户');
  check(cents(account.cash) && finite(account.realized), '账户余额或已实现盈亏无效');
  check(Array.isArray(account.orders) && Array.isArray(account.deposits) && account.orders.length + account.deposits.length <= MAX_EVENTS, '每个账户最多支持 10,000 笔流水');
  fields(account.positions, Object.keys(account.positions || {}).filter((key) => /^\d{4,10}:(normal|foil)$/.test(key)), '持仓');
  for (const position of Object.values(account.positions)) {
    fields(position, ['qty', 'average'], '持仓');
    check(Number.isSafeInteger(position.qty) && position.qty > 0 && position.qty <= 1e9 && finite(position.average, Number.MIN_VALUE), '持仓数量或成本无效');
  }
  const events = [];
  const add = (entry, kind) => {
    const id = kind === 'deposit' ? entry.id : entry.orderId;
    check(typeof id === 'string' && identifier.test(id) && !recordIds.has(id), '流水 ID 无效或重复');
    recordIds.add(id);
    check(entry.accountId === account.id, '流水不属于当前账户');
    check(iso(entry.createdAt) && Date.parse(entry.createdAt) <= Date.parse(exportedAt) + 300000, '流水时间无效或晚于备份时间');
    check(cents(entry.balanceAfter), '流水记录的余额无效');
    if (entry.sequence !== undefined) check(Number.isSafeInteger(entry.sequence) && entry.sequence > 0, '流水序号无效');
    events.push({ entry, kind });
  };
  for (const entry of account.deposits) {
    fields(entry, ['id', 'accountId', 'sequence', 'amount', 'balanceAfter', 'createdAt'], '充值记录');
    check(cents(entry.amount, 0.01, MAX_DEPOSIT), '充值金额无效');
    add(entry, 'deposit');
  }
  for (const order of account.orders) {
    fields(order, ['id', 'name', 'set', 'number', 'finish', 'side', 'qty', 'price', 'quoteDate', 'source', 'feed', 'accountId', 'accountName', 'sequence', 'amount', 'fee', 'total', 'balanceAfter', 'feePolicy', 'feeRate', 'minimumFee', 'orderId', 'createdAt'], '交易记录');
    check(typeof order.id === 'string' && productId.test(order.id) && ['normal', 'foil'].includes(order.finish) && ['buy', 'sell'].includes(order.side), '交易卡牌版本或方向无效');
    check(text(order.name, 300) && text(order.set, 40) && (typeof order.number === 'string' || Number.isSafeInteger(order.number)) && String(order.number).length <= 40 && text(order.accountName, 24), '交易卡牌信息无效');
    check(Number.isSafeInteger(order.qty) && order.qty > 0 && order.qty <= 1e6 && finite(order.price, Number.MIN_VALUE), '交易数量或价格无效');
    check(order.source === 'RiftHunt' && order.feed === 'rift' && dateOnly(order.quoteDate), '交易行情来源或日期无效');
    check(order.feePolicy === FEE_POLICY && order.feeRate === FEE_RATE && order.minimumFee === MIN_FEE, '交易手续费规则不受支持');
    check(cents(order.amount) && cents(order.fee, MIN_FEE) && cents(order.total, 0.01), '交易成交额或费用无效');
    const age = Date.parse(order.createdAt) - Date.parse(order.quoteDate);
    check(age >= -86400000 && age < 7 * 86400000, '交易使用的报价日期不在有效期内');
    add(order, 'trade');
  }

  // New records carry a shared sequence, so a deposit and a trade in the same
  // millisecond can be replayed in their actual order. Earlier records use time.
  const sequenced = events.every(({ entry }) => entry.sequence !== undefined);
  events.sort((a, b) => sequenced ? a.entry.sequence - b.entry.sequence : Date.parse(a.entry.createdAt) - Date.parse(b.entry.createdAt) || (a.kind === 'deposit' ? -1 : 1));
  let replay = makeAccount(account.id, account.name);
  for (let index = 0; index < events.length; index++) {
    const { entry, kind } = events[index];
    if (sequenced) check(entry.sequence === index + 1, '流水序号重复或不连续');
    try {
      replay = kind === 'deposit' ? depositFunds(replay, String(entry.amount), new Date(entry.createdAt)) : executeTrade(replay, entry, new Date(entry.createdAt));
    } catch (error) { fail(`「${account.name}」流水无法重算：${error.message}`); }
    check(same(replay.cash, entry.balanceAfter), `「${account.name}」流水余额与重算结果不符`);
    if (kind === 'trade') {
      const computed = replay.orders[0];
      check(['amount', 'fee', 'total'].every((key) => same(computed[key], entry[key])), '交易金额或手续费与重算结果不符');
    }
  }
  check(same(replay.cash, account.cash) && same(replay.realized, account.realized), `「${account.name}」余额或已实现盈亏与流水不符`);
  check(Object.keys(replay.positions).length === Object.keys(account.positions).length, `「${account.name}」持仓与流水不符`);
  for (const [key, position] of Object.entries(account.positions)) {
    check(replay.positions[key]?.qty === position.qty && same(replay.positions[key].average, position.average), `「${account.name}」持仓数量或成本与流水不符`);
  }
  check(Array.isArray(account.valuations) && account.valuations.length <= 365, '账户估值记录无效或超过 365 天');
  const days = [];
  const depositTotal = account.deposits.reduce((total, entry) => total + entry.amount, 0);
  for (const point of account.valuations) {
    fields(point, ['day', 'equity', 'deposits', 'profit'], '估值记录');
    check(dateOnly(point.day) && point.day <= beijingDay(new Date(exportedAt)) && cents(point.equity) && cents(point.deposits, 0.01) && cents(point.profit, -MAX_MONEY) && point.deposits <= depositTotal + 0.001, '估值记录日期或金额无效');
    check(same(Math.round((point.equity - point.deposits) * 100) / 100, point.profit), '估值记录盈亏计算不符');
    days.push(point.day);
  }
  unique(days, '估值日期');
}

export function validateState(state, exportedAt) {
  fields(state, ['schemaVersion', 'entered', 'activeAccountId', 'watch', 'accounts'], '账户数据');
  check(state.schemaVersion === 1 && typeof state.entered === 'boolean', '账户数据版本不受支持');
  check(Array.isArray(state.accounts) && state.accounts.length > 0 && state.accounts.length <= 50, '备份须包含 1—50 个账户');
  check(Array.isArray(state.watch) && state.watch.length <= 2000 && state.watch.every((id) => typeof id === 'string' && productId.test(id)), '自选列表无效');
  unique(state.watch, '自选卡牌');
  const recordIds = new Set();
  for (const account of state.accounts) validateAccount(account, recordIds, exportedAt);
  unique(state.accounts.map((account) => account.id), '账户');
  check(state.accounts.some((account) => account.id === state.activeAccountId), '当前账户不存在');
  return state;
}

export function backupSummary(state) {
  return {
    accounts: state.accounts.length,
    trades: state.accounts.reduce((total, account) => total + account.orders.length, 0),
    deposits: state.accounts.reduce((total, account) => total + account.deposits.length, 0),
    cash: Math.round(state.accounts.reduce((total, account) => total + account.cash, 0) * 100) / 100,
    positions: state.accounts.reduce((total, account) => total + Object.keys(account.positions).length, 0),
    watch: state.watch.length,
  };
}

export async function createBackup(state, now = new Date()) {
  const copy = JSON.parse(JSON.stringify(state));
  const payload = { app: 'tcgstock', formatVersion: 1, exportedAt: now.toISOString(), state: copy };
  validateState(copy, payload.exportedAt);
  const file = JSON.stringify({ ...payload, checksum: { algorithm: 'SHA-256', value: await digest(payload) } }, null, 2);
  check(new TextEncoder().encode(file).length <= MAX_BACKUP_BYTES, '备份超过 5 MB，暂无法导出');
  return file;
}

export async function readBackup(content, now = new Date()) {
  check(typeof content === 'string' && new TextEncoder().encode(content).length <= MAX_BACKUP_BYTES, '备份文件不能超过 5 MB');
  let file;
  try { file = JSON.parse(content); } catch { fail('文件不是有效的 JSON 备份'); }
  fields(file, ['app', 'formatVersion', 'exportedAt', 'state', 'checksum'], '备份文件');
  check(file.app === 'tcgstock' && file.formatVersion === 1, '这不是受支持的 tcgStock 备份');
  check(iso(file.exportedAt) && Date.parse(file.exportedAt) <= now.getTime() + 300000, '备份导出时间无效或晚于当前时间');
  fields(file.checksum, ['algorithm', 'value'], '校验和');
  check(file.checksum.algorithm === 'SHA-256' && /^[a-f0-9]{64}$/.test(file.checksum.value), '备份缺少有效的 SHA-256 校验和');
  const payload = { app: file.app, formatVersion: file.formatVersion, exportedAt: file.exportedAt, state: file.state };
  validateState(file.state, file.exportedAt);
  check(await digest(payload) === file.checksum.value, '文件校验和不匹配，可能已损坏或被修改');
  return { state: file.state, exportedAt: file.exportedAt, summary: backupSummary(file.state), checksum: file.checksum.value };
}
