import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { QueryRecentFileView } from '../../shared/queryFileSources';
import type { QueryFileEncoding } from '../../shared/contracts';
import type { QueryFileSourceController } from '../useQueryFileSource';
import { errorMessage } from '../lib';
import { queryFilesZh as text } from '../locales/queryFiles.zh-CN';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { QueryFileTaskProgress } from './QueryFileTaskProgress';

/** 只展示Main有界元数据；选中及确认以前不请求正文，路径不进入任何打开参数。 */
export function RecentQueryFilesDialog({ files, onClose }: { files: QueryFileSourceController; onClose(): void }) {
  const [entries, setEntries] = useState<QueryRecentFileView[]>([]), [selected, setSelected] = useState('');
  const [encoding, setEncoding] = useState<QueryFileEncoding>('utf8'), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const latest = useRef(files), active = useRef(false), alive = useRef(true); latest.current = files;
  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; };
  }, []);
  /** 初次列表可能初始化本地稳定ID；失败只显示错误，后续读取必须由用户明确重试。 */
  async function load() {
    if (active.current) return;
    active.current = true; setBusy(true); setError('');
    try { const items = await latest.current.recent(); if (alive.current) { setEntries(items); setSelected(''); } }
    catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally { active.current = false; if (alive.current) setBusy(false); }
  }
  /** 选择只切换展示和默认编码；显式点击打开才走原文件任务、占位文档及来源提交链路。 */
  function select(id: string) { setSelected(id); setEncoding(entries.find(item => item.id === id)?.encoding ?? 'utf8'); }
  /** 显式按钮只提交一次ID意图，晚返不更新已关闭的对话框，失败由原恢复入口处理。 */
  async function act(mode: 'open' | 'forget') {
    if (active.current || files.isBusy() || !selected) return;
    const item = entries.find(item => item.id === selected); if (!item) return;
    active.current = true; setBusy(true); setError('');
    try {
      if (mode === 'open') { if (await files.open(encoding, item.id) && alive.current) onClose(); }
      else { await files.forgetRecent(item.id); if (alive.current) { setEntries(items => items.filter(value => value.id !== item.id)); setSelected(''); } }
    } catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally { active.current = false; if (alive.current) setBusy(false); }
  }
  return createPortal(<Modal title={text.recent} onClose={() => { if (!active.current) onClose(); }}><div className="modal-content">
    <p className="muted small">{text.recentHint}</p>
    <Field label={text.recentSelection}><select value={selected} disabled={busy} onChange={event => select(event.target.value)}><option value="">{text.selectRecent}</option>{entries.map(item => <option key={item.id} value={item.id}>{item.name} — {item.displayPath}</option>)}</select></Field>
    {!busy && !entries.length && <p>{text.noRecent}</p>}
    <Field label={text.encoding}><select value={encoding} disabled={busy || !selected} onChange={event => setEncoding(event.target.value as QueryFileEncoding)}><option value="utf8">{text.utf8}</option><option value="utf16le">{text.utf16le}</option><option value="gb18030">{text.gb18030}</option></select></Field>
    {busy && files.task && <QueryFileTaskProgress task={files.task}/>}<ErrorBox message={error}/>
  </div><footer className="modal-footer"><button disabled={busy || !selected} onClick={() => void act('forget')}>{text.forgetRecent}</button>{error && <button disabled={busy} onClick={() => void load()}>{text.retryRecent}</button>}<span className="grow"/>{busy && <Spinner/>}<button disabled={busy} onClick={onClose}>{text.cancelRecent}</button><button className="primary" disabled={busy || !selected} onClick={() => void act('open')}>{text.openRecent}</button></footer></Modal>, document.body);
}
