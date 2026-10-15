export const START_CASH = 0;
export const MAX_DEPOSIT = 1_000_000;
export const SOURCES = { rift: 'RiftHunt' };
export const FEE_RATE = 0.025;
export const MIN_FEE = 0.30;
export const FEE_POLICY = 'tcgstock-v1';
export const MARKET_TIME_ZONE = 'Asia/Shanghai';
export const MARKET_OPEN_MINUTE = 7 * 60;
export const MARKET_CLOSE_MINUTE = 23 * 60;
const marketClock = new Intl.DateTimeFormat('en-GB', { timeZone: MARKET_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const money = (value) => {
  const amount = Number(value || 0);
  return `${amount < 0 ? '-' : ''}$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const assetKey = (id, finish) => `${id}:${finish}`;
export const fresh = (date) => Boolean(date && Date.now() - new Date(date).getTime() < 7 * 86400000);
export const day = (date) => date ? String(date).slice(0, 10) : '暂无';

export function tradingSession(now = new Date()) {
  const parts = Object.fromEntries(marketClock.formatToParts(now).map(({ type, value }) => [type, value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const open = minute >= MARKET_OPEN_MINUTE && minute < MARKET_CLOSE_MINUTE;
  return { open, minute, nextOpen: open ? null : minute >= MARKET_CLOSE_MINUTE ? '次日 07:00' : '今日 07:00' };
}

export function makeAccount(id = 'us-primary', name = '主账户') {
  return { id, name, market: 'US', currency: 'USD', cash: START_CASH, realized: 0, positions: {}, orders: [], deposits: [], valuations: [] };
}

export function initialState() {
  return {
    schemaVersion: 1, entered: false, activeAccountId: 'us-primary',
    watch: [], accounts: [makeAccount()],
  };
}

export function depositFunds(account, rawAmount, now = new Date()) {
  const raw = String(rawAmount).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw)) throw new Error('请输入最多两位小数的充值金额');
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0.01 || amount > MAX_DEPOSIT) throw new Error(`单笔模拟充值须在 $0.01—$${MAX_DEPOSIT.toLocaleString('en-US')} 之间`);
  const cash = Math.round((account.cash + amount) * 100) / 100;
  const deposit = { id: crypto.randomUUID(), accountId: account.id, sequence: account.orders.length + (account.deposits || []).length + 1, amount, balanceAfter: cash, createdAt: now.toISOString() };
  return { ...account, cash, deposits: [deposit, ...(account.deposits || [])] };
}

export function tradeCosts(price, qty, side) {
  if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(qty) || qty < 1 || !['buy', 'sell'].includes(side)) throw new Error('订单数量、价格或方向无效');
  const amount = Math.round(price * qty * 100) / 100;
  const percentageFee = Math.round(amount * FEE_RATE * 100) / 100;
  const fee = Math.max(MIN_FEE, percentageFee);
  const total = Math.round((amount + (side === 'buy' ? fee : -fee)) * 100) / 100;
  return { amount, fee, total, percentageFee, minimumApplied: fee === MIN_FEE && percentageFee < MIN_FEE };
}

export function executeTrade(account, order, now = new Date()) {
  if (!tradingSession(now).open) throw new Error('闭市中：北京时间 23:00—次日 07:00 暂停交易');
  const { id, finish, qty, side, price } = order;
  const { amount, fee, total } = tradeCosts(price, qty, side);
  const key = assetKey(id, finish);
  const current = account.positions[key] || { qty: 0, average: 0 };
  if (side === 'buy' && total > account.cash + 0.001) throw new Error('可用资金不足（含手续费）');
  if (side === 'sell' && qty > current.qty) throw new Error('持仓数量不足');
  if (side === 'sell' && total <= 0) throw new Error('成交额不足以支付最低手续费，请增加数量');
  const positions = { ...account.positions };
  let realized = account.realized;
  if (side === 'buy') {
    const nextQty = current.qty + qty;
    positions[key] = { qty: nextQty, average: (current.average * current.qty + total) / nextQty };
  } else {
    const remaining = current.qty - qty;
    if (remaining) positions[key] = { ...current, qty: remaining };
    else delete positions[key];
    realized += total - current.average * qty;
  }
  const cash = Math.round((account.cash + (side === 'buy' ? -total : total)) * 100) / 100;
  return {
    ...account,
    cash,
    realized,
    positions,
    orders: [{ ...order, sequence: account.orders.length + (account.deposits || []).length + 1, amount, fee, total, balanceAfter: cash, feePolicy: FEE_POLICY, feeRate: FEE_RATE, minimumFee: MIN_FEE, orderId: crypto.randomUUID(), createdAt: now.toISOString() }, ...account.orders],
  };
}
