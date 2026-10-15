import React, { useEffect, useMemo, useState } from 'react';
import { FEE_RATE, MAX_DEPOSIT, MIN_FEE, START_CASH, SOURCES, assetKey, day, depositFunds, executeTrade, fresh, initialState, makeAccount, money, tradeCosts, tradingSession } from './domain.js';
import { accountPerformance, performanceSeries, recordValuation } from './analytics.js';

const NAV = [ ['market','◫','行情'], ['watchlist','☆','自选'], ['search','⌕','搜索'], ['portfolio','▤','资产'], ['orders','≡','记录'] ];
const STORAGE_KEY = 'tcgstock.rifthunt.v1';
const featured = ['706014','653102','652903','652850','652802'];
const beijingTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function recordTime(value) { const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? `${beijingTime.format(date)} 北京时间` : '—'; }

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.schemaVersion === 1 && Array.isArray(saved.accounts) && saved.accounts.length) return saved;
  } catch { /* first visit */ }
  return initialState();
}

function CardArt({ card, className = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [card?.image]);
  return <div className={`card-art ${className}`}>
    {card?.image && !failed ? <img src={card.image} alt={`${card.name} 卡面`} loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <span>{card?.name?.slice(0,1) || 'R'}</span>}
  </div>;
}

function Pill({ children, tone = '' }) { return <span className={`pill ${tone}`}>{children}</span>; }
function Empty({ title, desc, action }) { return <div className="empty"><span className="empty-icon">◇</span><strong>{title}</strong><p>{desc}</p>{action}</div>; }
function TradeRecord({ order }) {
  const isBuy = order.side === 'buy';
  return <article className="order-card"><div className="order-top"><span><b className={isBuy ? 'buy' : 'sell'}>{isBuy ? '买入' : '卖出'}</b> {order.name}</span><Pill tone="green">已模拟成交</Pill></div><div className="order-values"><strong>{isBuy ? '−' : '+'}{money(order.total ?? order.amount)}</strong><span>{order.qty} 张 × {money(order.price)} · {order.finish === 'foil' ? '闪卡' : '普通'}</span></div><div className="record-meta">{recordTime(order.createdAt)} · {order.source}</div><details className="order-fee-details"><summary>查看交易详情</summary><div><span>卡牌版本</span><strong>{order.set} {order.number} · {order.finish === 'foil' ? '闪卡' : '普通'}</strong></div><div><span>价格日期</span><strong>{order.quoteDate}</strong></div><div><span>卡牌成交额</span><strong>{money(order.amount)}</strong></div><div><span>模拟手续费</span><strong>{money(order.fee ?? 0)}</strong></div><div><span>{isBuy ? '实际支出' : '实际到账'}</span><strong>{money(order.total ?? order.amount)}</strong></div>{Number.isFinite(order.balanceAfter) && <div><span>交易后现金</span><strong>{money(order.balanceAfter)}</strong></div>}<p>{`成交额 × ${((order.feeRate ?? FEE_RATE) * 100).toFixed(1)}%，每笔最低 ${money(order.minimumFee ?? MIN_FEE)}`}<br />订单号：{order.orderId}</p></details></article>;
}
function DepositRecord({ entry }) {
  return <article className="order-card deposit-record"><div className="order-top"><span><b className="deposit-label">模拟充值</b></span><Pill tone="blue">已入账</Pill></div><div className="order-values"><strong>+{money(entry.amount)}</strong><span>充值后现金 {money(entry.balanceAfter)}</span></div><div className="record-meta">{recordTime(entry.createdAt)} · 虚拟资金</div><details className="order-fee-details"><summary>查看充值详情</summary><div><span>充值金额</span><strong>{money(entry.amount)}</strong></div><div><span>充值后现金</span><strong>{money(entry.balanceAfter)}</strong></div><p>仅增加当前模拟账户的虚拟资金，不涉及实际支付。<br />记录号：{entry.id}</p></details></article>;
}

function PerformanceChart({ points, interval }) {
  if (!points.length) return null;
  const values = points.map((point) => point.profit);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const spread = Math.max(max - min, 1);
  const coords = points.map((point, index) => ({
    x: points.length === 1 ? 320 : 38 + index * 564 / (points.length - 1),
    y: 170 - (point.profit - min) * 125 / spread,
  }));
  const path = coords.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
  const zeroY = 170 - (0 - min) * 125 / spread;
  const positive = points.at(-1).profit >= 0;
  const label = (point) => interval === 'week' ? point.week : point.day;
  return <div className="performance-chart"><svg viewBox="0 0 640 200" role="img" aria-label={`${interval === 'week' ? '每周' : '每日'}累计盈亏曲线`} preserveAspectRatio="none"><line x1="38" x2="602" y1={zeroY} y2={zeroY} stroke="#dce5f0" strokeDasharray="4 5" /><path d={path} fill="none" stroke={positive ? '#1eaa81' : '#d67666'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{coords.map(({ x, y }, index) => <circle key={points[index].day} cx={x} cy={y} r={index === coords.length - 1 ? 5 : 3} fill={positive ? '#1eaa81' : '#d67666'}><title>{points[index].day}: {money(points[index].profit)}</title></circle>)}</svg><div className="performance-axis"><span>{label(points[0])}</span><span>{label(points.at(-1))}</span></div></div>;
}

export default function App() {
  const [store, setStore] = useState(loadState);
  const [page, setPage] = useState(() => loadState().entered ? 'market' : 'welcome');
  const [catalog, setCatalog] = useState([]);
  const [catalogMeta, setCatalogMeta] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('706014');
  const [finish, setFinish] = useState('foil');
  const [side, setSide] = useState('buy');
  const [qty, setQty] = useState(1);
  const [query, setQuery] = useState('');
  const [setFilter, setSetFilter] = useState('全部系列');
  const [share, setShare] = useState(null);
  const [toast, setToast] = useState('');
  const [lastOrder, setLastOrder] = useState(null);
  const [returnPage, setReturnPage] = useState('market');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositReturn, setDepositReturn] = useState('portfolio');
  const [recordTab, setRecordTab] = useState('all');
  const [analysisInterval, setAnalysisInterval] = useState('day');
  const [clockNow, setClockNow] = useState(() => new Date());

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }, [store]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => {
    const updateClock = () => setClockNow(new Date());
    let timer;
    const scheduleNextMinute = () => {
      timer = setTimeout(() => { updateClock(); scheduleNextMinute(); }, 60000 - Date.now() % 60000 + 50);
    };
    scheduleNextMinute();
    document.addEventListener('visibilitychange', updateClock);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', updateClock); };
  }, []);

  async function loadCatalog() {
    setLoading(true); setLoadError('');
    try {
      const response = await fetch(import.meta.env.VITE_CATALOG_URL || `${import.meta.env.BASE_URL}api/catalog`);
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.cards)) throw new Error(data.error || '卡牌数据不可用');
      setCatalog(data.cards); setCatalogMeta(data);
    } catch (error) { setLoadError(error.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadCatalog(); }, []);

  const byId = useMemo(() => new Map(catalog.map((card) => [card.id, card])), [catalog]);
  const selected = byId.get(selectedId);
  const account = 'rift';
  const activeId = store.activeAccountId;
  const accountData = store.accounts.find((item) => item.id === activeId) || store.accounts[0];
  const accountName = accountData.name;
  const availableAccounts = store.accounts;
  const sets = useMemo(() => ['全部系列', ...new Set(catalog.map((card) => card.setName).filter(Boolean))], [catalog]);
  const filtered = useMemo(() => {
    const term = query.toLocaleLowerCase().trim();
    const cards = catalog.filter((card) => (setFilter === '全部系列' || card.setName === setFilter) && (!term || `${card.name} ${card.setName} ${card.set} ${card.number} ${card.id}`.toLocaleLowerCase().includes(term)));
    return cards.sort((a,b) => {
      const ap = featured.indexOf(a.id), bp = featured.indexOf(b.id);
      if (ap >= 0 || bp >= 0) return (ap < 0 ? 100 : ap) - (bp < 0 ? 100 : bp);
      return a.name.localeCompare(b.name);
    });
  }, [catalog, query, setFilter]);
  const marketCards = filtered.slice(0, page === 'search' ? 36 : 16);
  const watchCards = store.watch.map((id) => byId.get(id)).filter(Boolean);

  function quote(card, variant = finish) {
    if (!card) return null;
    const data = card.rift?.finishes?.[variant];
    return Number(data?.market) > 0 ? { market: Number(data.market), low: Number(data.low) || null, date: card.rift.date, source: 'RiftHunt' } : null;
  }

  function preferredFinish(card) {
    if (quote(card, 'normal')) return 'normal';
    return 'foil';
  }

  const currentQuote = quote(selected);
  const priceReady = Boolean(currentQuote && fresh(currentQuote.date));
  const session = tradingSession(clockNow);

  function navigate(destination) { setPage(destination); window.scrollTo({ top: 0, behavior: 'instant' }); }
  function selectCard(card, origin = page) {
    setSelectedId(card.id); setFinish(preferredFinish(card)); setReturnPage(origin); navigate('detail');
  }
  function switchAccount(id) { setStore((prev) => ({ ...prev, entered: true, activeAccountId: id })); navigate('market'); }
  function updateLedger(id, apply) {
    setStore((prev) => ({ ...prev, accounts: prev.accounts.map((item) => item.id === id ? apply(item) : item) }));
  }
  function createAccount() {
    const name = newName.trim().slice(0, 24);
    if (!name) { setToast('请输入账户名称'); return; }
    const id = crypto.randomUUID();
    const entry = makeAccount(id, name);
    setStore((prev) => ({ ...prev, entered: true, accounts: [...prev.accounts, entry], activeAccountId: id }));
    setCreating(false); setNewName(''); setToast(`已创建「${name}」`); navigate('market');
  }
  function openDeposit(origin = page) { setDepositReturn(origin); setDepositAmount(''); navigate('deposit'); }
  function submitDeposit() {
    try {
      const updated = depositFunds(accountData, depositAmount);
      updateLedger(activeId, () => updated);
      setDepositAmount(''); setToast(`已向「${accountName}」模拟充值 ${money(updated.deposits[0].amount)}`);
      if (depositReturn === 'trade') navigate('trade');
      else { setRecordTab('deposits'); navigate('orders'); }
    } catch (error) { setToast(error.message); }
  }
  function renameAccount(id, currentName) {
    const raw = window.prompt('修改账户名称', currentName);
    if (raw === null) return;
    const name = raw.trim().slice(0, 24);
    if (!name) { setToast('请输入账户名称'); return; }
    setStore((prev) => ({ ...prev, accounts: prev.accounts.map((item) => item.id === id ? { ...item, name } : item) }));
  }
  function toggleWatch(id) { setStore((prev) => ({ ...prev, watch: prev.watch.includes(id) ? prev.watch.filter((x) => x !== id) : [...prev.watch,id] })); }
  function enterTrade(direction) { setSide(direction); setQty(1); navigate('trade'); }

  const positions = Object.entries(accountData.positions).filter(([,position]) => position.qty > 0).map(([key,position]) => {
    const [id, variant] = key.split(':'); const card = byId.get(id); const q = quote(card, variant);
    return { key, card, variant, ...position, quote: q, value: q ? q.market * position.qty : null };
  });
  const incomplete = positions.some((position) => position.value === null);
  const marketValue = positions.reduce((sum,position) => sum + (position.value || 0), 0);
  const unrealized = positions.reduce((sum,position) => sum + (position.quote ? (position.quote.market - position.average) * position.qty : 0), 0);
  const total = accountData.cash + marketValue;
  const analysisPrices = Object.entries(accountData.positions).reduce((prices, [key]) => {
    const [id, variant] = key.split(':');
    const current = quote(byId.get(id), variant);
    if (current && fresh(current.date)) prices[key] = current.market;
    return prices;
  }, {});
  const performance = accountPerformance(accountData, analysisPrices);
  const valuationHistory = recordValuation(accountData.valuations || [], performance, clockNow);
  const analysisPoints = performanceSeries(valuationHistory, analysisInterval);
  useEffect(() => {
    if (!catalog.length || performance.profit === null) return;
    setStore((prev) => {
      const ledger = prev.accounts.find((item) => item.id === activeId);
      if (!ledger) return prev;
      const next = recordValuation(ledger.valuations || [], performance, clockNow);
      if (next === ledger.valuations) return prev;
      return { ...prev, accounts: prev.accounts.map((item) => item.id === activeId ? { ...item, valuations: next } : item) };
    });
  }, [activeId, catalog.length, performance.equity, performance.profit, performance.deposits, clockNow]);
  const holding = accountData.positions[assetKey(selectedId,finish)]?.qty || 0;
  const costs = currentQuote ? tradeCosts(currentQuote.market, qty, side) : null;
  const amount = costs?.amount || 0;
  const tradeError = !session.open ? `闭市中：北京时间 23:00—次日 07:00，${session.nextOpen} 开市` : !priceReady ? '暂无有效日价，暂不能交易' : side === 'buy' && costs.total > accountData.cash ? '可用资金不足（含手续费）' : side === 'sell' && qty > holding ? '持仓数量不足' : side === 'sell' && costs.total <= 0 ? '成交额不足以支付最低手续费，请增加数量' : '';
  const depositTotal = (accountData.deposits || []).reduce((sum, entry) => sum + entry.amount, 0);
  const proposedDeposit = Number(depositAmount);
  const depositReady = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(depositAmount) && proposedDeposit >= 0.01 && proposedDeposit <= MAX_DEPOSIT;
  const recordEntries = [
    ...accountData.orders.map((entry, index) => ({ type: 'trade', entry, sortAt: Date.parse(entry.createdAt) || 0, index })),
    ...(accountData.deposits || []).map((entry, index) => ({ type: 'deposit', entry, sortAt: Date.parse(entry.createdAt) || 0, index })),
  ].filter(({ type }) => recordTab === 'all' || (recordTab === 'trades' ? type === 'trade' : type === 'deposit'))
    .sort((a, b) => b.sortAt - a.sortAt || a.index - b.index);

  function confirmTrade() {
    if (!selected || !currentQuote || tradeError) { setToast(tradeError || '报价不可用'); return; }
    if (!tradingSession().open) { setClockNow(new Date()); setToast('闭市中：北京时间 23:00—次日 07:00 暂停交易'); return; }
    if (!fresh(currentQuote.date)) { setToast('报价已过期，请刷新后再交易'); return; }
    const order = { id: selected.id, name: selected.name, set: selected.set, number: selected.number, finish, side, qty, price: currentQuote.market, quoteDate: day(currentQuote.date), source: SOURCES[account], feed: account, accountId: activeId, accountName };
    try {
      const updated = executeTrade(accountData, order);
      updateLedger(activeId, () => updated);
      setLastOrder(updated.orders[0]); navigate('success');
    } catch (error) { setToast(error.message); }
  }

  function shareText() {
    if (share === 'portfolio') return `tcgStock · Riftbound 模拟资产\n模拟账户：${accountName} · 美区 USD\n估值报价源：${SOURCES[account]}\n账户总资产：${incomplete ? '部分持仓缺价' : money(total)}\n可用现金：${money(accountData.cash)}\n持仓：${positions.length} 种 · 已实现盈亏 ${money(accountData.realized)}\n数据为日级参考价，所有交易均为模拟。`;
    return `tcgStock · Riftbound 卡牌行情\n${selected?.name || ''} · ${selected?.set} ${selected?.number} · ${finish === 'foil' ? '闪卡' : '普通'}\n${SOURCES[account]} 市场参考价：${currentQuote ? money(currentQuote.market) : '暂无报价'}\n价格日期：${day(currentQuote?.date)} · USD\n日级参考价，非实时可成交报价。`;
  }
  async function copyShare() {
    try { await navigator.clipboard.writeText(shareText()); setToast('分享内容已复制'); }
    catch { setToast('复制失败，请使用系统分享'); }
  }
  async function nativeShare() {
    if (!navigator.share) return copyShare();
    try { await navigator.share({ title: 'tcgStock · Riftbound', text: shareText() }); }
    catch (error) { if (error.name !== 'AbortError') setToast('系统分享不可用'); }
  }

  function cardRow(card, variant = preferredFinish(card)) {
    const q = quote(card, variant);
    return <button className="card-row" key={`${card.id}:${variant}`} onClick={() => selectCard(card)}>
      <CardArt card={card} className="thumb" />
      <span className="card-row-copy"><strong>{card.name}</strong><small>{card.set} · {card.number} · {variant === 'foil' ? '闪卡' : '普通'}</small></span>
      <span className="card-row-price"><strong>{q ? money(q.market) : '暂无'}</strong><small>{q ? day(q.date) : '不可交易'}</small></span>
    </button>;
  }

  const nav = <nav className="bottom-nav" aria-label="主导航">{NAV.map(([id,icon,label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => { if (id === 'orders') setRecordTab('all'); navigate(id); }}><span>{icon}</span><small>{label}</small></button>)}</nav>;
  const sourceSwitch = <div className="source-control"><button className="source-switch" onClick={() => navigate('accounts')}><span className="source-dot" />{accountName} · 美区 USD<span className="chev">⌄</span></button></div>;
  const pageTitle = { market:'行情', watchlist:'自选', search:'发现', portfolio:'资产', orders:'账户记录', deposit:'模拟充值', settings:'我的', accounts:'选择账户', detail:'卡牌详情', trade:'模拟下单', review:'确认订单', success:'成交回执' }[page];

  return <div className="app-layout">
    <aside className="desktop-sidebar">
      <button className="brand" onClick={() => navigate('market')}><span className="brand-mark">T</span><span>tcgStock<small>RIFTBOUND MARKET</small></span></button>
      <div className="side-label">模拟市场</div>
      {NAV.map(([id,icon,label]) => <button key={id} className={`side-link ${page === id ? 'active' : ''}`} onClick={() => { if (id === 'orders') setRecordTab('all'); navigate(id); }}><span>{icon}</span>{label}</button>)}
      <div className="side-label lower">账户</div>
      <button className={`side-link ${page === 'accounts' ? 'active' : ''}`} onClick={() => navigate('accounts')}><span>◎</span>我的账户</button>
      <button className={`side-link ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><span>⚙</span>设置与说明</button>
      <div className="sidebar-foot"><Pill tone="blue">模拟交易</Pill><p>真实日价驱动 · 虚拟资金成交</p></div>
    </aside>
    <main className="main-content">
      {page !== 'welcome' && <header className="topbar"><div className="topbar-brand"><span className="brand-mark">T</span> tcgStock</div><span>RIFTBOUND · {pageTitle}</span><button onClick={() => navigate('settings')} aria-label="设置">☰</button></header>}
      {page !== 'welcome' && <div className={`session-banner ${session.open ? 'open' : 'closed'}`} role="status"><strong>{session.open ? '交易中' : '休市中'}</strong><span>{session.open ? '北京时间 07:00—23:00 可模拟买卖' : `北京时间 23:00—次日 07:00 暂停买卖 · ${session.nextOpen} 开市`}</span></div>}

      {page === 'welcome' && <section className="welcome-page"><div className="welcome-orb" /><div className="welcome-brand"><span className="brand-mark">T</span> tcgStock</div><Pill tone="light">RIFTBOUND MARKET SIMULATOR</Pill><h1>让热爱的卡牌，<br/>成为看得懂的资产。</h1><p>跟随真实卡价观察市场，用虚拟资金练习买卖。<br/>选择一个 TCG，开启你的模拟账户。</p><div className="game-select"><div className="game-badge">R</div><span><strong>Riftbound</strong><small>首个开放的卡牌世界</small></span><span>↗</span></div><div className="coming-games"><span>Pokémon TCG · 即将开放</span><span>Magic: The Gathering · 即将开放</span></div><button className="primary wide" onClick={() => navigate('accounts')}>选择模拟账户 <span>→</span></button><small className="legal">所有买卖均为模拟，不涉及真实资金或卡牌交割。</small></section>}

      {page === 'accounts' && <section className="page narrow"><button className="text-back" onClick={() => navigate(store.entered ? 'market' : 'welcome')}>← 返回</button><div className="eyebrow">01 / SELECT ACCOUNT</div><h1>选择模拟账户</h1><p className="lead">首版开放 Riftbound 美区英文卡。每个 USD 账户独立保存虚拟资金、持仓和订单；使用 RiftHunt 日级参考价。</p><div className="account-market"><span className="market-flag">US</span><div><strong>美区卡牌市场</strong><small>Riftbound · English · USD</small></div><Pill tone="green">已开放</Pill></div><div className="section-head"><div><span className="eyebrow">MY ACCOUNTS</span><h2>我的模拟账户</h2></div><span className="list-meta">{availableAccounts.length} 个账户</span></div><div className="account-list">{availableAccounts.map((item) => <div className="account-item" key={item.id}><button className="account-open" onClick={() => switchAccount(item.id)}><span className="account-avatar">{item.name.slice(0,1)}</span><span><strong>{item.name}</strong><small>现金 {money(item.cash)} · {item.orders.length} 笔交易 · {(item.deposits || []).length} 笔充值</small></span><span className="account-arrow">→</span></button><button className="account-rename" onClick={() => renameAccount(item.id,item.name)} aria-label={`重命名${item.name}`}>⋯</button></div>)}</div>{creating ? <div className="create-form"><input aria-label="新账户名称" autoFocus maxLength="24" placeholder="给账户起个名字" value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createAccount(); }} /><button className="primary" onClick={createAccount}>创建</button><button className="secondary" onClick={() => { setCreating(false); setNewName(''); }}>取消</button></div> : <button className="create-account" onClick={() => setCreating(true)}>＋ 创建美区 USD 模拟账户</button>}<div className="note">新账户初始资金为 $0，可进入后模拟充值。按 RiftHunt 日级参考价估值和交易；同一商品 ID 与普通／闪卡版本用于识别持仓。</div></section>}

      {page === 'deposit' && <section className="page narrow"><button className="text-back" onClick={() => navigate(depositReturn)}>← 返回</button><div className="eyebrow">SIMULATED FUNDS</div><h1>模拟充值</h1><p className="lead">向「{accountName}」增加虚拟 USD 资金。充值仅用于模拟买卖，不会发起真实支付。</p><div className="wallet-card"><div className="wallet-head"><span>当前可用现金</span><strong>{money(accountData.cash)}</strong></div><label className="deposit-label-input" htmlFor="deposit-amount">充值金额 · USD</label><div className="deposit-input"><span>$</span><input id="deposit-amount" autoFocus inputMode="decimal" placeholder="输入金额" value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && depositReady) submitDeposit(); }} /></div>{depositAmount && !depositReady && <div className="validation">单笔金额须为 $0.01—{money(MAX_DEPOSIT)}，最多两位小数。</div>}<div className="deposit-presets">{[100,1000,10000,25000].map((value) => <button key={value} className={depositAmount === String(value) ? 'selected' : ''} onClick={() => setDepositAmount(String(value))}>{money(value)}</button>)}</div><div className="trade-line"><span>充值后可用现金</span><strong>{depositReady ? money(accountData.cash + proposedDeposit) : '—'}</strong></div></div><button className="primary wide" disabled={!depositReady} onClick={submitDeposit}>确认模拟充值</button><p className="fine-note">可在账户记录中查看充值时间、金额和充值后余额。休市期间也可模拟充值。</p></section>}

      {page === 'market' && <section className="page"><div className="page-heading"><div><div className="eyebrow">RIFTBOUND / MARKET</div><h1>行情</h1><p>按真实日价观察你的卡牌市场。</p></div>{sourceSwitch}</div><div className="hero"><div className="hero-head"><span>账户总资产 · USD</span><Pill tone="dark">模拟账户</Pill></div><strong>{incomplete ? '估值不完整' : money(total)}</strong><div className="hero-bottom"><div><small>可用现金</small><b>{money(accountData.cash)}</b></div><div><small>持仓市值</small><b>{incomplete ? '部分缺价' : money(marketValue)}</b></div><button onClick={() => navigate('portfolio')}>查看资产 ↗</button></div></div>{accountData.cash === 0 && <div className="funding-strip"><span>账户尚无虚拟资金。先充值，再开始模拟买入。</span><button className="primary" onClick={() => openDeposit('market')}>＋ 模拟充值</button></div>}<div className="section-head"><div><span className="eyebrow">PRICE DISCOVERY</span><h2>发现卡牌</h2></div><button onClick={() => navigate('search')}>查看全部 →</button></div><div className="filters"><label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索卡名、系列、卡号" /></label><select aria-label="系列筛选" value={setFilter} onChange={(event) => setSetFilter(event.target.value)}>{sets.map((name) => <option key={name}>{name}</option>)}</select></div><div className="list-panel">{loading ? <Empty title="正在获取真实卡价" desc="加载 Riftbound 卡表与最新日价…" /> : loadError ? <Empty title="行情暂不可用" desc={loadError} action={<button onClick={loadCatalog}>重试</button>} /> : marketCards.length ? marketCards.map((card) => cardRow(card)) : <Empty title="没有找到卡牌" desc="试试其他卡名或系列。" />}</div><div className="data-foot">{SOURCES[account]} · USD · 日级价格参考。行情快照 {day(catalogMeta?.fetched)}。</div></section>}

      {page === 'search' && <section className="page"><div className="page-heading"><div><div className="eyebrow">DISCOVER / SEARCH</div><h1>发现卡牌</h1><p>按具体印次找到可交易卡牌。</p></div>{sourceSwitch}</div><div className="filters"><label className="search-box"><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="卡名 / TCGplayer ID / 卡号" /></label><select aria-label="系列筛选" value={setFilter} onChange={(event) => setSetFilter(event.target.value)}>{sets.map((name) => <option key={name}>{name}</option>)}</select></div><div className="list-meta">{filtered.length} 个结果 · 显示前 36 个</div><div className="list-panel">{loading ? <Empty title="正在加载卡表" desc="请稍候…" /> : marketCards.length ? marketCards.map((card) => cardRow(card)) : <Empty title="没有搜索结果" desc="试试简短的英文卡名。" />}</div></section>}

      {page === 'watchlist' && <section className="page"><div className="page-heading"><div><div className="eyebrow">MY WATCHLIST</div><h1>自选卡牌</h1><p>持续关注你感兴趣的卡。</p></div>{sourceSwitch}</div><div className="list-panel">{watchCards.length ? watchCards.map((card) => cardRow(card)) : <Empty title="还没有自选卡牌" desc="在卡牌详情页点击星标，建立自己的观察列表。" action={<button onClick={() => navigate('search')}>发现卡牌 →</button>} />}</div></section>}

      {page === 'detail' && <section className="page"><button className="text-back" onClick={() => navigate(returnPage)}>← 返回{ returnPage === 'search' ? '搜索' : returnPage === 'portfolio' ? '资产' : '行情' }</button>{selected ? <><div className="detail-grid"><div className="detail-art-wrap"><CardArt card={selected} className="detail-art" /></div><div className="detail-info"><div className="eyebrow">{selected.setName} / {selected.set} {selected.number}</div><div className="detail-title"><h1>{selected.name}</h1><button className={`icon-button ${store.watch.includes(selected.id) ? 'selected' : ''}`} onClick={() => toggleWatch(selected.id)} title="自选">{store.watch.includes(selected.id) ? '★' : '☆'}</button><button className="icon-button" onClick={() => setShare('card')} title="分享">↗</button></div><div className="detail-sub"><Pill tone="blue">{selected.rarity || 'Riftbound'}</Pill><span>产品 ID {selected.id}</span></div><div className="finish-tabs"><button className={finish === 'normal' ? 'active' : ''} onClick={() => setFinish('normal')}>普通</button><button className={finish === 'foil' ? 'active' : ''} onClick={() => setFinish('foil')}>闪卡</button></div><div className="price-panel"><div><span>市场参考价 · USD</span><Pill tone={priceReady && session.open ? 'green' : ''}>{!session.open ? '休市中' : priceReady ? '可模拟交易' : '暂无有效报价'}</Pill></div><strong>{currentQuote ? money(currentQuote.market) : '—'}</strong><small>{SOURCES[account]} · {day(currentQuote?.date)} · 日价快照</small><div className="price-low">最低挂牌参考 <b>{currentQuote?.low ? money(currentQuote.low) : '—'}</b><span>与成交价不同</span></div></div><div className="detail-actions"><button className="secondary" disabled={!session.open} onClick={() => enterTrade('sell')}>模拟卖出</button><button className="primary" disabled={!session.open} onClick={() => enterTrade('buy')}>模拟买入</button></div><div className="note">模拟成交按当前账户的最新市场参考价计算。北京时间 23:00—次日 07:00 休市；快照超过 7 天或价格缺失时也暂停交易。</div></div></div></> : <Empty title="找不到这张卡" desc="请返回市场重新选择。" />}</section>}

      {page === 'trade' && <section className="page narrow"><button className="text-back" onClick={() => navigate('detail')}>← 返回卡牌</button><div className="eyebrow">SIMULATED ORDER</div><h1>模拟下单</h1><p className="lead">交易将在「{accountName}」账户内，按 RiftHunt 日级参考价模拟成交。</p><div className="trade-card"><div className="trade-card-head"><CardArt card={selected} className="thumb" /><div><strong>{selected?.name}</strong><small>{selected?.set} · {selected?.number} · {finish === 'foil' ? '闪卡' : '普通'}</small></div></div><div className="segmented"><button className={side === 'buy' ? 'active' : ''} onClick={() => setSide('buy')}>买入</button><button className={side === 'sell' ? 'active' : ''} onClick={() => setSide('sell')}>卖出</button></div><div className="trade-line"><span>模拟成交单价</span><strong>{currentQuote ? money(currentQuote.market) : '—'}</strong></div><div className="trade-line"><span>行情渠道 / 日期</span><strong>{SOURCES[account]} · {day(currentQuote?.date)}</strong></div><div className="trade-line"><span>数量</span><div className="qty-control"><button onClick={() => setQty(Math.max(1,qty-1))}>−</button><input aria-label="交易数量" type="number" min="1" max="9999" value={qty} onChange={(event) => setQty(Math.max(1,Math.min(9999,Number(event.target.value) || 1)))} /><button onClick={() => setQty(Math.min(9999,qty+1))}>+</button></div></div><div className="trade-line"><span>{side === 'buy' ? '可用现金' : '当前持仓'}</span><strong>{side === 'buy' ? money(accountData.cash) : `${holding} 张`}</strong></div><div className="trade-line"><span>卡牌成交额</span><strong>{money(amount)}</strong></div><div className="fee-detail"><div><span>模拟手续费 <small>固定规则</small></span><strong>{costs ? money(costs.fee) : '—'}</strong></div><p>成交额 × {(FEE_RATE * 100).toFixed(1)}%，每笔最低 {money(MIN_FEE)}。{costs?.minimumApplied ? '本单按最低手续费收取。' : '本单按比例收取。'}</p></div><div className="trade-total"><span>预计{side === 'buy' ? '支付总额' : '实际到账'}</span><strong>{costs ? money(costs.total) : '—'}</strong></div></div>{tradeError && <div className="validation">{tradeError}{side === 'buy' && accountData.cash < (costs?.total || 0) && <button className="validation-action" onClick={() => openDeposit('trade')}>去模拟充值 →</button>}</div>}<button className="primary wide" disabled={Boolean(tradeError)} onClick={() => navigate('review')}>核对订单 →</button><p className="fine-note">手续费由系统统一计算，用户不能修改。这里没有真实交易、卡牌交割或资金划转。</p></section>}

      {page === 'review' && <section className="page narrow"><button className="text-back" onClick={() => navigate('trade')}>← 修改订单</button><div className="eyebrow">REVIEW ORDER</div><h1>确认模拟订单</h1><p className="lead">请核对卡牌、价格渠道和交易数量。</p><div className="review-card"><div className="review-big">{costs ? money(costs.total) : '—'}</div>{[['交易方向',side === 'buy' ? '买入' : '卖出'],['卡牌',selected?.name],['版本',`${selected?.set} ${selected?.number} · ${finish === 'foil' ? '闪卡' : '普通'}`],['数量',`${qty} 张`],['单价',money(currentQuote?.market)],['卡牌成交额',money(amount)],['手续费',costs ? money(costs.fee) : '—'],[side === 'buy' ? '支付总额' : '实际到账',costs ? money(costs.total) : '—'],['模拟账户',accountName],['报价来源',SOURCES[account]],['价格日期',day(currentQuote?.date)]].map(([label,value]) => <div className="review-line" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="note">手续费 = max（成交额 × {(FEE_RATE * 100).toFixed(1)}%，{money(MIN_FEE)}），每笔收取。买入计入持仓成本，卖出从到账金额扣除。确认后价格与手续费写入订单。</div><button className="primary wide" disabled={Boolean(tradeError)} onClick={confirmTrade}>确认模拟{side === 'buy' ? '买入' : '卖出'}</button></section>}

      {page === 'success' && <section className="page narrow success"><div className="success-check">✓</div><div className="eyebrow">ORDER FILLED</div><h1>模拟成交成功</h1><p>已{lastOrder?.side === 'sell' ? '卖出' : '买入'} {lastOrder?.qty} 张 {lastOrder?.name}</p><div className="review-card"><div className="review-big">{money(lastOrder?.total)}</div><div className="review-line"><span>卡牌成交额</span><strong>{money(lastOrder?.amount)}</strong></div><div className="review-line"><span>模拟手续费</span><strong>{money(lastOrder?.fee)}</strong></div><div className="review-line"><span>{lastOrder?.side === 'buy' ? '支付总额' : '实际到账'}</span><strong>{money(lastOrder?.total)}</strong></div><div className="review-line"><span>成交单价</span><strong>{money(lastOrder?.price)}</strong></div><div className="review-line"><span>账户 / 报价源</span><strong>{lastOrder?.accountName} · {lastOrder?.source}</strong></div><div className="review-line"><span>价格日期</span><strong>{lastOrder?.quoteDate}</strong></div></div><button className="primary wide" onClick={() => navigate('portfolio')}>查看持仓 →</button><button className="secondary wide" onClick={() => { setRecordTab('trades'); navigate('orders'); }}>查看交易记录</button></section>}

      {page === 'portfolio' && <section className="page"><div className="page-heading"><div><div className="eyebrow">SIMULATED PORTFOLIO</div><h1>我的资产</h1><p>虚拟资金与卡牌持仓。</p></div><div className="heading-actions">{sourceSwitch}<button className="primary" onClick={() => openDeposit('portfolio')}>＋ 模拟充值</button><button className="outline" onClick={() => setShare('portfolio')}>↗ 分享资产</button></div></div><div className="portfolio-hero"><small>账户总资产 · USD</small><strong>{incomplete ? '估值不完整' : money(total)}</strong><div className="portfolio-stats"><div><span>可用现金</span><b>{money(accountData.cash)}</b></div><div><span>持仓市值</span><b>{incomplete ? '部分缺价' : money(marketValue)}</b></div><div><span>已实现盈亏</span><b>{money(accountData.realized)}</b></div><div><span>持仓浮动盈亏</span><b>{incomplete ? '部分缺价' : money(unrealized)}</b></div></div></div><section className="analysis-card"><div className="analysis-heading"><div><span className="eyebrow">ACCOUNT PERFORMANCE</span><h2>账户分析</h2></div><div className="segmented analysis-tabs"><button className={analysisInterval === 'day' ? 'active' : ''} onClick={() => setAnalysisInterval('day')}>日线</button><button className={analysisInterval === 'week' ? 'active' : ''} onClick={() => setAnalysisInterval('week')}>周线</button></div></div>{performance.profit === null ? <div className="analysis-empty">{performance.equity === null ? '部分持仓缺少 RiftHunt 报价，暂不能完整估值。' : '模拟充值后开始记录账户盈亏。'}</div> : <><div className="analysis-summary"><div><span>总收益率</span><strong className={performance.profit >= 0 ? 'positive' : 'negative'}>{performance.returnRate >= 0 ? '+' : ''}{performance.returnRate.toFixed(2)}%</strong></div><div><span>累计盈亏</span><strong className={performance.profit >= 0 ? 'positive' : 'negative'}>{performance.profit >= 0 ? '+' : ''}{money(performance.profit)}</strong></div><div><span>累计充值</span><strong>{money(performance.deposits)}</strong></div></div><PerformanceChart points={analysisPoints} interval={analysisInterval} /><p className="analysis-note">总收益率 =（账户总资产 − 累计充值）÷ 累计充值。曲线显示各观测日或周末的累计盈亏；从首次记录估值开始，不补造未访问日期。分析统一使用 RiftHunt 日级参考价。</p></>}</section><div className="section-head"><div><span className="eyebrow">POSITIONS</span><h2>持仓卡牌</h2></div><button onClick={() => { setRecordTab('all'); navigate('orders'); }}>交易与充值记录 →</button></div><div className="list-panel">{positions.length ? positions.map((position) => <button className="card-row" key={position.key} onClick={() => { setSelectedId(position.card?.id); setFinish(position.variant); setReturnPage('portfolio'); navigate('detail'); }}><CardArt card={position.card} className="thumb" /><span className="card-row-copy"><strong>{position.card?.name || position.key}</strong><small>{position.qty} 张 · 均价 {money(position.average)} · {position.variant === 'foil' ? '闪卡' : '普通'}</small></span><span className="card-row-price"><strong>{position.value == null ? '待估值' : money(position.value)}</strong><small>{position.quote ? day(position.quote.date) : '暂无日价'}</small></span></button>) : <Empty title="暂无持仓" desc="前往市场模拟买入第一张卡。" action={<button onClick={() => navigate('market')}>去市场 →</button>} />}</div><div className="data-foot">累计模拟充值 {money(depositTotal)} · {accountData.orders.length} 笔交易 · {(accountData.deposits || []).length} 笔充值。{SOURCES[account]} 日级市场价估值；缺价持仓不计入市值。</div></section>}

      {page === 'orders' && <section className="page narrow"><div className="page-heading"><div><div className="eyebrow">ACCOUNT ACTIVITY</div><h1>账户记录</h1><p>「{accountName}」的模拟交易与充值流水。</p></div><button className="primary" onClick={() => openDeposit('orders')}>＋ 模拟充值</button></div><div className="record-summary"><div><span>当前可用现金</span><strong>{money(accountData.cash)}</strong></div><div><span>累计模拟充值</span><strong>{money(depositTotal)}</strong></div><div><span>交易 / 充值</span><strong>{accountData.orders.length} / {(accountData.deposits || []).length}</strong></div></div><button className="account-record-switch" onClick={() => navigate('accounts')}>当前账户：{accountName} · 美区 USD <span>切换 →</span></button><div className="segmented record-tabs">{[['all','全部流水'],['trades','交易记录'],['deposits','充值记录']].map(([key,label]) => <button key={key} className={recordTab === key ? 'active' : ''} onClick={() => setRecordTab(key)}>{label}</button>)}</div><div className="orders-list">{recordEntries.length ? recordEntries.map(({type,entry}, index) => type === 'trade' ? <TradeRecord key={entry.orderId || `trade-${index}`} order={entry} /> : <DepositRecord key={entry.id || `deposit-${index}`} entry={entry} />) : <Empty title={recordTab === 'trades' ? '还没有交易记录' : recordTab === 'deposits' ? '还没有充值记录' : '还没有账户流水'} desc="记录会保存在当前浏览器中的这个模拟账户。" action={<button onClick={() => recordTab === 'trades' ? navigate('market') : openDeposit('orders')}>{recordTab === 'trades' ? '去市场 →' : '模拟充值 →'}</button>} />}</div><div className="data-foot">所有金额均为虚拟资金。交易记录保存价格、渠道、手续费和成交时间；充值记录保存金额及充值后余额。</div></section>}

      {page === 'settings' && <section className="page narrow"><div className="eyebrow">ACCOUNT / SETTINGS</div><h1>我的 tcgStock</h1><p className="lead">Riftbound 模拟交易账户</p><div className="settings-profile"><span className="profile-icon">T</span><div><strong>{accountName}</strong><small>美区 USD · 数据保存在当前浏览器</small></div></div><div className="setting-list"><button onClick={() => navigate('accounts')}><span>◎</span><div><strong>模拟账户</strong><small>当前 {accountName} · 美区 USD</small></div><b>→</b></button><button onClick={() => openDeposit('settings')}><span>＋</span><div><strong>模拟充值</strong><small>当前现金 {money(accountData.cash)}</small></div><b>→</b></button><button onClick={() => { setRecordTab('all'); navigate('orders'); }}><span>≡</span><div><strong>交易与充值记录</strong><small>{accountData.orders.length} 笔交易 · {(accountData.deposits || []).length} 笔充值</small></div><b>→</b></button><button onClick={loadCatalog}><span>↻</span><div><strong>刷新日级卡价</strong><small>RiftHunt 批量价格 · 本地缓存</small></div><b>→</b></button><button onClick={() => { if (window.confirm(`重置「${accountName}」的资金、持仓、交易和充值记录？此操作无法撤销。`)) { updateLedger(activeId, (ledger) => makeAccount(ledger.id, ledger.name)); setToast('当前账户已重置'); } }}><span>↺</span><div><strong>重置当前账户</strong><small>清空当前账户记录并恢复 {money(START_CASH)} 现金</small></div><b>→</b></button></div><div className="section-head"><h2>模拟规则</h2></div><div className="rules"><p>美区可创建多个独立 USD 账户，每个新账户初始虚拟资金 {money(START_CASH)}，可自行模拟充值。以 RiftHunt 最新日级市场价模拟即时成交；买卖均收取手续费，为成交额的 {(FEE_RATE * 100).toFixed(1)}%，每笔最低 {money(MIN_FEE)}，系统统一计算，不可修改。</p><p>买入手续费计入持仓成本，卖出手续费从到账金额扣除；已实现和浮动盈亏均反映费用。此规则借鉴卡牌平台的比例与固定处理费结构，是 tcgStock 的简化模拟，并非 TCGplayer 完整实际收费。<a href="https://help.tcgplayer.com/hc/en-us/articles/360047732673-Fee-Calculation-Examples" target="_blank" rel="noreferrer">查看 TCGplayer 收费示例 ↗</a></p><p>交易时段为北京时间 07:00—23:00；23:00—次日 07:00 休市，仍可查看行情与持仓，但不能提交买卖。进入确认页后也会在提交时重新校验时间。</p><p>同一张卡的普通与闪卡分开计价和持仓。价格缺失或距今超过 7 天时不允许下单。</p><p>模拟充值只增加当前账户的虚拟资金，不涉及真实支付；没有提现、真实卡牌交割或跨账户转仓。数据仅保存在当前浏览器，清理站点数据后会丢失。</p><p>首版只使用 RiftHunt 批量报价，卡牌范围限美区英文版。账户盈亏曲线从首次估值起记录，不补造历史价格。</p></div></section>}
    </main>
    {page !== 'welcome' && nav}
    {share && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShare(null); }}><div className="share-sheet" role="dialog" aria-modal="true" aria-label="分享"><div className="sheet-grabber" /><div className="sheet-head"><div><div className="eyebrow">SHARE SNAPSHOT</div><h2>分享{share === 'card' ? '卡牌行情' : '模拟资产'}</h2></div><button onClick={() => setShare(null)} aria-label="关闭">×</button></div><div className="share-preview"><span className="share-brand">T · tcgStock</span><strong>{share === 'card' ? selected?.name : '我的 Riftbound 资产'}</strong><div className="share-price">{share === 'card' ? currentQuote ? money(currentQuote.market) : '暂无报价' : incomplete ? '估值不完整' : money(total)}</div><small>{SOURCES[account]} · {share === 'card' ? day(currentQuote?.date) : `${positions.length} 种持仓`} · 模拟数据</small></div><p>分享内容会注明行情来源、日期与模拟交易性质；不会生成公开账户页面。</p><div className="share-buttons"><button className="primary" onClick={nativeShare}>系统分享</button><button className="secondary" onClick={copyShare}>复制摘要</button></div></div></div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
