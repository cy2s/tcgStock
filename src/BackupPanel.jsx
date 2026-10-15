import React, { useEffect, useRef, useState } from 'react';
import { backupSummary, createBackup, readBackup, MAX_BACKUP_BYTES } from './backup.js';
import { money } from './domain.js';
import { beijingDay } from './analytics.js';
import './backup.css';

const META_KEY = 'tcgstock.backup.meta.v1';
const displayTime = (value) => value ? `${new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} 北京时间` : '暂无';
function loadMeta() {
  try {
    const meta = JSON.parse(localStorage.getItem(META_KEY));
    return Object.fromEntries(['exportedAt', 'importedAt'].filter((key) => typeof meta?.[key] === 'string' && Number.isFinite(Date.parse(meta[key]))).map((key) => [key, meta[key]]));
  } catch { return {}; }
}

export default function BackupPanel({ store, onRestore }) {
  const fileInput = useRef(null);
  const previewRef = useRef(null);
  const feedbackRef = useRef(null);
  const [meta, setMeta] = useState(loadMeta);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(null);
  useEffect(() => { if (preview) previewRef.current?.scrollIntoView({ block: 'start' }); }, [preview]);
  useEffect(() => { if (error || message) feedbackRef.current?.scrollIntoView({ block: 'nearest' }); }, [error, message]);
  const current = backupSummary(store);
  const exportedToday = meta.exportedAt && beijingDay(new Date(meta.exportedAt)) === beijingDay();
  function saveMeta(next) {
    setMeta(next);
    try { localStorage.setItem(META_KEY, JSON.stringify(next)); } catch { /* backup itself remains usable */ }
  }
  async function exportFile() {
    setBusy(true); setError(''); setMessage('');
    try {
      const now = new Date();
      const content = await createBackup(store, now);
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `tcgstock-backup-${now.toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      saveMeta({ ...meta, exportedAt: now.toISOString() });
      setMessage('已生成备份并发起下载，请确认文件已保存。');
    } catch (reason) { setError(reason.message || '导出失败，请重试'); }
    finally { setBusy(false); }
  }
  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true); setError(''); setMessage(''); setPreview(null);
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件不能超过 5 MB');
      const checked = await readBackup(await file.text());
      setPreview({ ...checked, fileName: file.name.slice(0, 200) });
    } catch (reason) { setError(reason.message || '无法读取备份文件'); }
    finally { setBusy(false); }
  }
  function restore() {
    if (!preview) return;
    setError('');
    try {
      // The parent persists the entire replacement before changing visible state.
      onRestore(preview.state);
      saveMeta({ ...meta, importedAt: new Date().toISOString() });
      setPreview(null);
      setMessage('已恢复备份。重复导入会替换当前数据，不会重复充值或记账。');
    } catch (reason) { setError(reason.message || '恢复失败，当前账户数据已保留'); }
  }
  return <section className="page narrow backup-page">
    <div className="eyebrow">DATA / BACKUP</div><h1>备份与恢复</h1>
    <p className="lead">把账户存成一份文件，在需要时恢复到当前浏览器。</p>
    <div className="backup-status"><span className="backup-status-icon">↧</span><div><strong>{exportedToday ? '今天已发起备份下载' : '今天尚未导出备份'}</strong><p>建议每天保存一份。网页关闭后不会自动备份。</p></div><span className="pill blue">文件备份</span></div>
    <div className="backup-summary">{[['模拟账户', current.accounts], ['交易记录', current.trades], ['充值记录', current.deposits]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
    <div className="backup-actions"><article><span className="eyebrow">EXPORT</span><h2>导出全部账户</h2><p>包含现金、持仓、交易、充值、收益记录和自选卡牌。文件只保存在你选择的位置。</p><button className="primary" disabled={busy} onClick={exportFile}>{busy ? '处理中…' : '↓ 下载 JSON 备份'}</button></article><article><span className="eyebrow">RESTORE</span><h2>从文件恢复</h2><p>先检查格式、校验和与账目一致性，再预览内容。确认后替换当前全部账户。</p><button className="outline" disabled={busy} onClick={() => fileInput.current?.click()}>↑ 选择备份文件</button><input ref={fileInput} className="backup-file-input" type="file" accept=".json,application/json" aria-label="选择 JSON 备份文件" onChange={chooseFile} /></article></div>
    {error && <div ref={feedbackRef} className="backup-alert error" role="alert"><strong>未完成操作</strong><p>{error}</p><small>当前账户数据未被替换。</small></div>}
    {message && <div ref={feedbackRef} className="backup-alert success" role="status">{message}</div>}
    {preview && <div ref={previewRef} className="backup-preview" aria-label="备份导入预览"><div className="section-head"><h2>导入预览</h2><span className="pill green">一致性检查通过</span></div><p className="backup-filename">{preview.fileName}</p><dl><div><dt>备份时间</dt><dd>{displayTime(preview.exportedAt)}</dd></div><div><dt>模拟账户</dt><dd>当前 {current.accounts} 个 → 备份 {preview.summary.accounts} 个</dd></div><div><dt>交易 / 充值记录</dt><dd>{preview.summary.trades} / {preview.summary.deposits} 笔</dd></div><div><dt>账户现金合计</dt><dd>{money(preview.summary.cash)}</dd></div><div><dt>持仓种类 / 自选</dt><dd>{preview.summary.positions} / {preview.summary.watch}</dd></div></dl><div className="backup-account-names">{preview.state.accounts.map((account) => <span key={account.id}>{account.name}</span>)}</div><div className="backup-alert warning"><strong>确认后将替换当前全部账户</strong><p>不会合并或叠加充值；当前未导出的更改会被覆盖。建议先下载当前数据的备份。</p></div><div className="backup-preview-actions"><button className="outline" onClick={() => setPreview(null)}>取消</button><button className="primary" onClick={restore}>确认替换并恢复</button></div></div>}
    <dl className="backup-history"><div><dt>上次发起导出</dt><dd>{displayTime(meta.exportedAt)}</dd></div><div><dt>上次恢复</dt><dd>{displayTime(meta.importedAt)}</dd></div></dl>
    <div className="backup-boundary"><h2>校验范围</h2><p>导入会从充值和交易流水重新计算现金、持仓、成本与手续费，并检查重复记录、账户归属和估值算式。</p><p>SHA-256 校验和用于发现文件损坏。这是纯前端的一致性检查，不能证明文件来源、核实历史市场价格，或阻止有意重写整套记录的人。Notion 登录与自动云同步尚未接入。</p><p>最多支持 50 个账户、每账户 10,000 笔流水与 365 天收益记录，文件上限 5 MB。备份含账户信息，请妥善保存。</p></div>
  </section>;
}
