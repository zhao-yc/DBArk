import { useEffect, useRef, useState } from 'react';
import { FileDown, FolderOpen } from 'lucide-react';
import type { QueryFileEncoding } from '../../shared/contracts';
import type { WorkspaceTab } from '../store';
import { useWorkspace } from '../store';
import { errorMessage, invoke } from '../lib';
import { zh, formatText } from '../locales/zh-CN';
import { queryFilesZh as text } from '../locales/queryFiles.zh-CN';
import { ErrorBox, Field, Modal, Spinner } from './ui';

/** 文件操作明确通过原生选择授权；打开总是新建标签，保存只使用当前 SQL 快照。 */
export function QueryFilesDialog({ mode, tab, onClose }: { mode: 'open' | 'save'; tab: WorkspaceTab; onClose: () => void }) {
  const [encoding, setEncoding] = useState<QueryFileEncoding>('utf8');
  const [busy, setBusy] = useState(false); const active = useRef(false); const [error, setError] = useState('');
  const source = useRef(tab.sql ?? '');

  /** 选择取消时保持当前对话框；文件读取/保存错误不关闭原查询或重试写入。 */
  async function choose() {
    if (active.current) return;
    active.current = true; setBusy(true); setError('');
    try {
      const choice = await invoke('files.choose', { purpose: mode === 'open' ? 'query' : 'export', format: 'sql', suggestedName: tab.title.endsWith('.sql') ? tab.title : `${tab.title}.sql` });
      if (!choice) return;
      if (mode === 'open') {
        const result = await invoke('files.readQuery', { fileToken: choice.token, encoding });
        // 文件另开未绑定草稿，只继承默认库状态，不能借用当前标签的保存查询来源。
        useWorkspace.getState().openTab({ kind: 'query', connectionId: tab.connectionId, database: tab.database, databaseContext: tab.databaseContext, title: choice.name, sql: result.sql });
      } else {
        await invoke('files.writeQuery', { fileToken: choice.token, encoding, sql: source.current });
        useWorkspace.getState().notify(formatText(text.saved, choice.name));
      }
      onClose();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { active.current = false; setBusy(false); }
  }

  return <Modal title={mode === 'open' ? text.open : text.saveAs} onClose={() => { if (!active.current) onClose(); }}>
    <div className="modal-content">
      <p className="muted small">{mode === 'open' ? text.openHint : text.saveHint}</p>
      <Field label={text.encoding}><select value={encoding} disabled={busy} onChange={event => setEncoding(event.target.value as QueryFileEncoding)}><option value="utf8">{text.utf8}</option><option value="utf16le">{text.utf16le}</option><option value="gb18030">{text.gb18030}</option></select></Field>
      <p className="muted small">{text.limitHint}</p>
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer"><span className="grow"/>{busy && <Spinner/>}<button disabled={busy} onClick={onClose}>{zh.common.cancel}</button><button className="primary" disabled={busy} onClick={() => void choose()}>{mode === 'open' ? <FolderOpen size={14}/> : <FileDown size={14}/>}{mode === 'open' ? text.openAction : text.saveAction}</button></footer>
  </Modal>;
}

/** 查询工具栏保留独立的打开/另存入口，不改变现有“保存到本地查询库”的含义。 */
export function QueryFileActions({ tab }: { tab: WorkspaceTab }) {
  const [mode, setMode] = useState<'open' | 'save' | null>(null);
  useEffect(() => window.dbark?.onMenu(action => {
    if (useWorkspace.getState().settings.activeTabId !== tab.id || document.querySelector('[role="dialog"]')) return;
    if (action === 'open-sql-file') setMode('open');
    if (action === 'save-sql-file') setMode('save');
  }), [tab.id]);
  return <><button title={text.open} aria-label={text.open} onClick={() => setMode('open')}><FolderOpen size={15}/></button><button title={text.saveAs} aria-label={text.saveAs} onClick={() => setMode('save')}><FileDown size={15}/></button>{mode && <QueryFilesDialog mode={mode} tab={tab} onClose={() => setMode(null)}/>}</>;
}
