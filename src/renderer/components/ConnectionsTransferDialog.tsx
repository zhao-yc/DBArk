import { useEffect, useRef, useState } from 'react';
import type { FileChoice } from '../../shared/contracts';
import { connectionReplacementAcknowledgements, importReplacementProfile, type ConnectionImportApply, type ConnectionImportDecision, type ConnectionImportPreview, type ConnectionImportReview, type ExportedConnectionProfile } from '../../shared/connectionTransfer';
import { connectionReplacementText as risk } from '../../shared/connectionTransferMessages';
import { flushSettings, useWorkspace } from '../store';
import { errorMessage, invoke } from '../lib';
import { formatText, zh } from '../locales/zh-CN';
import { connectionsTransferZh as text } from '../locales/connectionsTransfer.zh-CN';
import { ErrorBox, Modal, Spinner } from './ui';
import '../connectionsTransfer.css';

const risks = { 'review-target': risk.target, 'clear-credentials': risk.secrets, 'reselect-files': risk.files, 'retain-linked-records': risk.linked };

/** 旧→新对照只展示无秘密白名单；文件名不是本机路径授权。 */
function ProfileSummary({ profile, label }: { profile: ExportedConnectionProfile; label: string }) {
  return <section className="connection-replace-summary" aria-label={label}><strong>{label}：{profile.name}</strong>
    <p>{text.target}：{profile.dialect} · {profile.host}:{profile.port} · {profile.user} · {profile.database ?? ''}</p>
    <p>{text.ssh}：{profile.ssh?.enabled ? text.enabled : text.disabled} · {profile.ssh?.host ?? ''}:{profile.ssh?.port ?? ''} · {profile.ssh?.user ?? ''} · {profile.ssh?.hostFingerprint ?? ''}</p>
    <p>{text.tls}：{profile.tls?.enabled ? text.enabled : text.disabled} · {profile.tls?.rejectUnauthorized === false ? text.noVerify : text.verify}</p>
    <p>{text.paths}：{[profile.ssh?.privateKeyFileName, profile.tls?.caFileName, profile.tls?.certFileName, profile.tls?.keyFileName].filter(Boolean).join('、') || text.noFiles}</p>
  </section>;
}

/** 文件预览和替换确认分开；每次重选均撤销确认，不重新读取源文件或自动重试提交。 */
export function ConnectionsTransferDialog({ onClose }: { onClose(): void }) {
  const connections = useWorkspace(state => state.connections);
  const [mode, setMode] = useState<'export' | 'import'>('export');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(connections.map(profile => profile.id)));
  const [file, setFile] = useState<FileChoice | null>(null), [preview, setPreview] = useState<ConnectionImportPreview | null>(null);
  const [decisions, setDecisions] = useState<ConnectionImportApply['decisions']>([]), [staged, setStaged] = useState(false);
  const [review, setReview] = useState<ConnectionImportReview | null>(null), [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(''), [failed, setFailed] = useState(false);
  const lock = useRef(false), sequence = useRef(0), currentPreview = useRef(preview), currentReview = useRef(review), connectionSnapshot = useRef(connections), applied = useRef(false);
  currentPreview.current = preview;
  const replacing = decisions.some(item => item.action === 'replace');
  const targetIds = decisions.flatMap(item => item.action === 'replace' ? [item.targetId] : []);
  const canReview = replacing && targetIds.every(id => !!id && connections.some(profile => profile.id === id)) && new Set(targetIds).size === targetIds.length;
  const confirmed = !replacing || !!review && connectionReplacementAcknowledgements.every(id => acknowledged.has(id));

  /** 迟到响应靠序号丢弃；释放只匹配旧确认令牌，不能取消后续重新审阅。 */
  function clearReview() {
    sequence.current++; const previous = currentReview.current; currentReview.current = null; setReview(null); setAcknowledged(new Set()); setStaged(false);
    if (previous && currentPreview.current) void invoke('connections.importReviewRelease', { previewToken: currentPreview.current.previewToken, confirmationToken: previous.confirmationToken }).catch(reason => setError(errorMessage(reason)));
    return sequence.current;
  }
  useEffect(() => {
    /** 模态拦截执行/保存快捷键，不能在后台运行SQL。 */
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true);
    return () => { sequence.current++; document.removeEventListener('keydown', block, true); const previous = currentReview.current; if (previous && currentPreview.current) void invoke('connections.importReviewRelease', { previewToken: currentPreview.current.previewToken, confirmationToken: previous.confirmationToken }).catch(() => undefined); };
  }, []);
  useEffect(() => {
    if (connectionSnapshot.current === connections) return; connectionSnapshot.current = connections;
    if (!applied.current && currentPreview.current) { clearReview(); setPreview(null); setDecisions([]); setError(text.changed); }
  }, [connections]);

  /** 模式/文件/任一源行的操作或目标改变都必须重新审阅和勾选。 */
  function switchMode(next: 'export' | 'import') { if (lock.current) return; clearReview(); setMode(next); setFile(null); setPreview(null); setDecisions([]); setError(''); setDone(''); setFailed(false); applied.current = false; }
  function changeDecision(sourceId: string, decision: ConnectionImportDecision) { if (lock.current) return; clearReview(); setDecisions(current => current.map(item => item.sourceId === sourceId ? decision : item)); }

  /** 先将实际标签清单提交主进程，再获取文件用途授权；重开选择即使取消也撤销旧确认。 */
  async function choose() {
    if (lock.current) return; lock.current = true; clearReview(); setPreview(null); setBusy(true); setError(''); setDone(''); setFailed(false); applied.current = false;
    try {
      if (mode === 'import') await flushSettings();
      const choice = await invoke('files.choose', { purpose: mode === 'export' ? 'connection-export' : 'connection-import', format: 'json', suggestedName: `${text.defaultName}.json` });
      if (!choice) return; setFile(choice);
      if (mode === 'import') {
        const snapshot = await invoke('connections.importPreview', { fileToken: choice.token }); setPreview(snapshot);
        setDecisions(snapshot.entries.map(entry => ({ sourceId: entry.sourceId, action: entry.matches.length ? 'skip' : 'add' })));
      }
    } catch (reason) { setError(errorMessage(reason)); setFailed(true); }
    finally { lock.current = false; setBusy(false); }
  }

  /** 主进程再次绑定明确配对及旧概要，界面不能自行拼出确认内容。 */
  async function reviewReplacement() {
    if (lock.current || !preview || !canReview) return; lock.current = true; setBusy(true); setError('');
    const ticket = clearReview();
    try {
      const value = await invoke('connections.importReview', { previewToken: preview.previewToken, decisions: structuredClone(decisions) });
      if (sequence.current !== ticket) { await invoke('connections.importReviewRelease', { previewToken: preview.previewToken, confirmationToken: value.confirmationToken }); return; }
      currentReview.current = value; setReview(value);
    } catch (reason) { setError(errorMessage(reason)); setFailed(true); }
    finally { lock.current = false; setBusy(false); }
  }

  /** 确认单次互斥；失败令牌已消费，必须重新读文件，绝不自动连接、关闭或重放。 */
  async function execute() {
    if (lock.current || done || !file) return;
    if (mode === 'export' && !selected.size) { setError(text.noSelection); return; }
    if (mode === 'import' && (!preview || !staged || !confirmed)) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (mode === 'export') { await invoke('connections.export', { connectionIds: [...selected], fileToken: file.token }); setDone(text.exported); }
      else {
        if (Date.now() >= Date.parse(preview!.expiresAt)) throw new Error(text.expired);
        const result = await invoke('connections.importApply', { previewToken: preview!.previewToken, decisions: structuredClone(decisions), allowIncomplete: staged, ...(replacing ? { confirmationToken: review!.confirmationToken, acknowledgements: [...acknowledged] as ConnectionImportApply['acknowledgements'] } : {}) });
        applied.current = true;
        useWorkspace.getState().setConnections(result.connections);
        for (const id of result.replacementIds ?? []) useWorkspace.getState().invalidateConnection(id);
        setDone(`${text.imported} ${result.replaced ? formatText(text.replacedCount, result.added, result.replaced, result.skipped) : formatText(text.count, result.added, result.skipped)}`);
      }
    } catch (reason) { setError(errorMessage(reason)); setFailed(true); clearReview(); setPreview(null); }
    finally { lock.current = false; setBusy(false); }
  }

  /** 提交和文件操作收尾前不能关闭，最终按钮不复用其它处理器。 */
  function close() { if (!lock.current) onClose(); }
  return <Modal title={text.title} wide onClose={close}>
    <div className="dialog-tabs"><button disabled={busy} className={mode === 'export' ? 'selected' : ''} onClick={() => switchMode('export')}>{text.export}</button><button disabled={busy} className={mode === 'import' ? 'selected' : ''} onClick={() => switchMode('import')}>{text.import}</button></div>
    <div className="modal-content"><p className="info-strip">{text.hint}</p>
      {mode === 'export' && <section aria-label={text.select}><label className="check"><input type="checkbox" disabled={busy || !!done} checked={!!connections.length && selected.size === connections.length} onChange={event => setSelected(event.target.checked ? new Set(connections.map(profile => profile.id)) : new Set())}/>{text.all}</label><div className="connections-transfer-list">{connections.map(profile => <label className="check" key={profile.id}><input type="checkbox" disabled={busy || !!done} checked={selected.has(profile.id)} onChange={event => { const next = new Set(selected); if (event.target.checked) next.add(profile.id); else next.delete(profile.id); setSelected(next); }}/><span>{profile.name}<small>{profile.dialect} · {profile.host}:{profile.port} · {profile.user} · {profile.database ?? ''}</small></span></label>)}</div></section>}
      <button className="file-picker" aria-label={mode === 'export' ? text.chooseExport : text.chooseImport} disabled={busy || !!done} onClick={() => void choose()}><span><strong>{file?.name ?? (mode === 'export' ? text.chooseExport : text.chooseImport)}</strong><small>{text.fileHint}</small></span></button>
      {preview && <div className="connections-transfer-preview">{preview.entries.map((entry, index) => {
        const decision = decisions.find(item => item.sourceId === entry.sourceId);
        return <section key={entry.sourceId} aria-label={`${text.source} ${index + 1}`}><ProfileSummary profile={entry.profile} label={text.source}/>
          <p>{text.candidates}：{entry.matches.length ? entry.matches.map(match => `${match.name} (${match.reasons.map(reason => reason === 'id' ? text.idReason : reason === 'name' ? text.nameReason : text.targetReason).join('、')})`).join('；') : text.none}</p>
          {entry.warnings.map((warning, warningIndex) => <p className="warning-text" key={warningIndex}>{warning}</p>)}
          <label className="field"><span>{text.action} {index + 1}</span><select disabled={busy || !!done} value={decision?.action ?? 'skip'} onChange={event => { const action = event.target.value as ConnectionImportDecision['action']; changeDecision(entry.sourceId, action === 'replace' ? { sourceId: entry.sourceId, action, targetId: '' } : { sourceId: entry.sourceId, action }); }}><option value="add">{text.add}</option><option value="skip">{text.skip}</option><option value="replace">{text.replace}</option></select></label>
          {decision?.action === 'replace' && <label className="field"><span>{text.replaceTarget} {index + 1}</span><select disabled={busy || !!done} value={decision.targetId} onChange={event => changeDecision(entry.sourceId, { ...decision, targetId: event.target.value })}><option value="">{text.chooseTarget}</option>{connections.map(profile => <option key={profile.id} value={profile.id} disabled={decisions.some(item => item.sourceId !== entry.sourceId && item.action === 'replace' && item.targetId === profile.id)}>{profile.name} · {profile.host}:{profile.port} · {profile.user} · {profile.id}</option>)}</select></label>}
        </section>;
      })}</div>}
      {replacing && preview && !done && <><button disabled={busy || !canReview} onClick={() => void reviewReplacement()}>{text.reviewReplace}</button><p>{text.reviewRequired}</p></>}
      {review && preview && <section className="connection-replace-review" aria-label={text.reviewTitle}>{review.entries.filter(entry => entry.previous).map(entry => <section key={entry.sourceId}><ProfileSummary label={text.oldTarget} profile={entry.previous!}/><div aria-label={text.oldToNew}>→</div><ProfileSummary label={text.newTarget} profile={entry.profile}/><p className="warning-text">{text.missingFiles}：{importReplacementProfile(entry.profile, entry.previous!).pendingFiles?.map(item => text[item]).join('、') || text.noFiles}</p></section>)}<p className="warning-text">{text.linkedNotice}</p>{connectionReplacementAcknowledgements.map(id => <label className="check connections-transfer-confirm" key={id}><input type="checkbox" disabled={busy || !!done} checked={acknowledged.has(id)} onChange={event => setAcknowledged(current => { const next = new Set(current); if (event.target.checked) next.add(id); else next.delete(id); return next; })}/>{risks[id]}</label>)}</section>}
      {mode === 'import' && preview && !done && <label className="check connections-transfer-confirm"><input type="checkbox" disabled={busy} checked={staged} onChange={event => setStaged(event.target.checked)}/>{text.staged}</label>}
      {busy && <Spinner text={text.pending}/ >}{failed && <p className="warning-text">{text.fail}</p>}{done && <div className="success-box">{done}</div>}<ErrorBox message={error}/>
    </div><footer className="modal-footer"><button disabled={busy} onClick={close}>{zh.common.close}</button><span className="grow"/><button className="primary" disabled={busy || !!done || !file || (mode === 'export' ? !selected.size : !preview || !staged || !confirmed)} onClick={() => void execute()}>{mode === 'export' ? text.exportStart : replacing ? text.replaceConfirm : text.confirm}</button></footer>
  </Modal>;
}
