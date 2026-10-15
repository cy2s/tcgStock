export const ANALYTICS_TIME_ZONE = 'Asia/Shanghai';
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: ANALYTICS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
export const beijingDay = (date = new Date()) => dayFormatter.format(date);

export function accountPerformance(account, prices) {
  const deposits = (account.deposits || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  let marketValue = 0;
  let complete = true;
  for (const [key, position] of Object.entries(account.positions || {})) {
    if (!position.qty) continue;
    const price = prices[key];
    if (!Number.isFinite(price) || price <= 0) complete = false;
    else marketValue += price * position.qty;
  }
  const equity = complete ? round((Number(account.cash) || 0) + marketValue) : null;
  const profit = equity !== null && deposits > 0 ? round(equity - deposits) : null;
  return { deposits: round(deposits), equity, profit, returnRate: profit === null ? null : profit / deposits * 100, complete };
}

export function recordValuation(snapshots = [], performance, date = new Date()) {
  if (performance.profit === null) return snapshots;
  const day = beijingDay(date);
  const next = { day, equity: performance.equity, deposits: performance.deposits, profit: performance.profit };
  const existing = snapshots.findIndex((item) => item.day === day);
  if (existing >= 0 && ['equity', 'deposits', 'profit'].every((key) => snapshots[existing][key] === next[key])) return snapshots;
  const result = existing >= 0 ? snapshots.map((item, index) => index === existing ? next : item) : [...snapshots, next];
  return result.sort((a, b) => a.day.localeCompare(b.day)).slice(-365);
}

export function performanceSeries(snapshots = [], interval = 'day') {
  const valid = snapshots.filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.day) && Number.isFinite(item.profit)).sort((a, b) => a.day.localeCompare(b.day));
  if (interval === 'day') return valid.slice(-30);
  const weeks = new Map();
  for (const point of valid) {
    const date = new Date(`${point.day}T12:00:00Z`);
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    weeks.set(monday.toISOString().slice(0, 10), { ...point, week: monday.toISOString().slice(0, 10) });
  }
  return [...weeks.values()].slice(-12);
}
