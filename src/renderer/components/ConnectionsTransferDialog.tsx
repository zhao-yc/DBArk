import { useEffect, useRef, useState } from 'react';
import type { FileChoice } from '../../shared/contracts';
import type { ConnectionImportApply, ConnectionImportPreview } from '../../shared/connectionTransfer';
import { useWorkspace } from '../store';
import { errorMessage, invoke } from '../lib';
import { formatText, zh } from '../locales/zh-CN';
import { connectionsTransferZh as text } from '../locales/connectionsTransfer.zh-CN';
import { ErrorBox, Modal, Spinner } from './ui';
import '../connectionsTransfer.css';

/** 交换仅操作本地文件与配置；预览令牌绑定已读取快照，最终确认不重新读源文件。 */
export function ConnectionsTransferDialog({ onClose }: { onClose(): void }) {
  const connections = useWorkspace(state => state.connections);
  const [mode, setMode] = useState<'export' | 'import'>('export'); const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(connections.map(profile => profile.id)));
  const [file, setFile] = useState<FileChoice | null>(null); const [preview, setPreview] = useState<ConnectionImportPreview | null>(null);
  const [decisions, setDecisions] = useState<ConnectionImportApply['decisions']>([]); const [staged, setStaged] = useState(false);
  const [busy, setBusy] = useState(false); const lock = useRef(false); const [error, setError] = useState(''); const [done, setDone] = useState(''); const [failed, setFailed] = useState(false);
  useEffect(() => {
    /** 文件预览模态不能执行后台SQL或触发原生保存快捷键。 */
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true); return () => document.removeEventListener('keydown', block, true);
  }, []);
  /** 模式切换清除不匹配的文件授权、预览和确认，不能跨用途复用令牌。 */
  function switchMode(next: 'export' | 'import') { if (lock.current) return; setMode(next); setFile(null); setPreview(null); setDecisions([]); setStaged(false); setError(''); setDone(''); setFailed(false); }
  /** 原生文件选择授权在操作前完成；仅展示文件名。 */
  async function choose() {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      const choice = await invoke('files.choose', { purpose: mode === 'export' ? 'connection-export' : 'connection-import', format: 'json', suggestedName: `${text.defaultName}.json` });
      if (!choice) return; setFile(choice); setPreview(null); setStaged(false); setDone(''); setFailed(false);
      if (mode === 'import') { const snapshot = await invoke('connections.importPreview', { fileToken: choice.token }); setPreview(snapshot); setDecisions(snapshot.entries.map(entry => ({ sourceId: entry.sourceId, action: entry.matches.length ? 'skip' : 'add' }))); }
    } catch (reason) { setError(errorMessage(reason)); setFailed(true); }
    finally { lock.current = false; setBusy(false); }
  }
  /** 最后确认同步互斥，失败不自动重试；导入只新增新ID或跳过，不替换现有连接。 */
  async function execute() {
    if (lock.current || done || !file) return;
    if (mode === 'export' && !selected.size) { setError(text.noSelection); return; }
    if (mode === 'import' && (!preview || !staged)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (mode === 'export') { await invoke('connections.export', { connectionIds: [...selected], fileToken: file.token }); setDone(text.exported); }
      else {
        if (Date.now() >= Date.parse(preview!.expiresAt)) throw new Error(text.expired);
        const result = await invoke('connections.importApply', { previewToken: preview!.previewToken, decisions: decisions.map(decision => ({ ...decision })), allowIncomplete: staged });
        useWorkspace.getState().setConnections(result.connections); setDone(`${text.imported} ${formatText(text.count, result.added, result.skipped)}`);
      }
    } catch (reason) { setError(errorMessage(reason)); setFailed(true); setStaged(false); }
    finally { lock.current = false; setBusy(false); }
  }
  /** 文件与批次资源释放前禁止关闭；最终按钮保持独立节点，双击不切换处理器。 */
  function close() { if (!lock.current) onClose(); }
  return <Modal title={text.title} wide onClose={close}><div className="dialog-tabs"><button disabled={busy} className={mode === 'export' ? 'selected' : ''} onClick={() => switchMode('export')}>{text.export}</button><button disabled={busy} className={mode === 'import' ? 'selected' : ''} onClick={() => switchMode('import')}>{text.import}</button></div><div className="modal-content"><p className="info-strip">{text.hint}</p>
    {mode === 'export' && <section aria-label={text.select}><label className="check"><input type="checkbox" disabled={busy || !!done} checked={!!connections.length && selected.size === connections.length} onChange={event => setSelected(event.target.checked ? new Set(connections.map(profile => profile.id)) : new Set())}/>{text.all}</label><div className="connections-transfer-list">{connections.map(profile => <label className="check" key={profile.id}><input type="checkbox" disabled={busy || !!done} checked={selected.has(profile.id)} onChange={event => { const next = new Set(selected); if (event.target.checked) next.add(profile.id); else next.delete(profile.id); setSelected(next); }}/><span>{profile.name}<small>{profile.dialect} · {profile.host}:{profile.port} · {profile.user} · {profile.database ?? ''}</small></span></label>)}</div></section>}
    <button className="file-picker" aria-label={mode === "export" ? text.chooseExport : text.chooseImport} disabled={busy || !!done} onClick={() => void choose()}><span><strong>{file?.name ?? (mode === 'export' ? text.chooseExport : text.chooseImport)}</strong><small>{text.fileHint}</small></span></button>
    {preview && <div className="connections-transfer-preview">{preview.entries.map((entry, index) => <section key={entry.sourceId} aria-label={`${text.source} ${index + 1}`}><h3>{entry.profile.name}</h3><p>{text.target}：{entry.profile.dialect} · {entry.profile.host}:{entry.profile.port} · {entry.profile.user} · {entry.profile.database ?? ''}</p><p>{text.ssh}：{entry.profile.ssh?.enabled ? text.enabled : text.disabled} · {entry.profile.ssh?.host ?? ""}:{entry.profile.ssh?.port ?? ""} · {entry.profile.ssh?.hostFingerprint ?? ""}</p><p>{text.tls}：{entry.profile.tls?.enabled ? text.enabled : text.disabled} · {entry.profile.tls?.rejectUnauthorized === false ? text.noVerify : text.verify}</p><p>{text.candidates}：{entry.matches.length ? entry.matches.map(match => `${match.name} (${match.reasons.map(reason => reason === 'id' ? text.idReason : reason === 'name' ? text.nameReason : text.targetReason).join('、')})`).join('；') : text.none}</p>{entry.warnings.map((warning, warningIndex) => <p className="warning-text" key={warningIndex}>{warning}</p>)}{(entry.profile.ssh?.privateKeyFileName || entry.profile.tls?.caFileName || entry.profile.tls?.certFileName || entry.profile.tls?.keyFileName) && <p>{text.paths}：{[entry.profile.ssh?.privateKeyFileName, entry.profile.tls?.caFileName, entry.profile.tls?.certFileName, entry.profile.tls?.keyFileName].filter(Boolean).join('、')}</p>}<label className="field"><span>{text.action} {index + 1}</span><select disabled={busy || !!done} value={decisions.find(decision => decision.sourceId === entry.sourceId)?.action ?? 'skip'} onChange={event => { setDecisions(current => current.map(decision => decision.sourceId === entry.sourceId ? { ...decision, action: event.target.value as 'add' | 'skip' } : decision)); setStaged(false); }}><option value="add">{text.add}</option><option value="skip">{text.skip}</option></select></label></section>)}</div>}
    {mode === 'import' && preview && !done && <label className="check connections-transfer-confirm"><input type="checkbox" disabled={busy} checked={staged} onChange={event => setStaged(event.target.checked)}/>{text.staged}</label>}
    {busy && <Spinner text={text.pending}/ >}{failed && <p className="warning-text">{text.fail}</p>}{done && <div className="success-box">{done}</div>}<ErrorBox message={error}/>
  </div><footer className="modal-footer"><button disabled={busy} onClick={close}>{zh.common.close}</button><span className="grow"/><button className="primary" disabled={busy || !!done || !file || (mode === 'export' ? !selected.size : !preview || !staged)} onClick={() => void execute()}>{mode === 'export' ? text.exportStart : text.confirm}</button></footer></Modal>;
}
