import { useEffect, useRef, useState } from 'react';
import { tableCopyDataMode, validateTableCopyDataName, tableCopyDataConfirmation, tableCopyDataRequiredAcknowledgements, type TableCopyDataGetInput, type TableCopyDataGetOutput, type TableCopyDataPreviewInput, type TableCopyDataPreviewOutput, type TableCopyDataApplyInput, type TableCopyDataApplyOutput, type TableCopyDataReleaseInput, type TableCopyDataProgress, type TableCopyDataTarget } from '../../shared/tableCopyData';
import { TableCopyDataRequestFence, sameTableCopyDataTarget, tableCopyDataAckLabel, tableCopyDataAcksComplete, tableCopyDataFailure, tableCopyDataStage } from '../tableCopyDataUi';
import { tableCopyDataZh as text } from '../locales/tableCopyData.zh-CN';
import { errorMessage, uid } from '../lib';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { SqlEditor } from './SqlEditor';

export interface TableCopyDataServices {
  get(input: TableCopyDataGetInput): Promise<TableCopyDataGetOutput>;
  preview(input: TableCopyDataPreviewInput): Promise<TableCopyDataPreviewOutput>;
  apply(input: TableCopyDataApplyInput): Promise<TableCopyDataApplyOutput>;
  release(input: TableCopyDataReleaseInput): Promise<void>;
  cancel(input: { taskId: string }): Promise<void>;
  subscribe(listener: (event: { taskId: string; progress: TableCopyDataProgress }) => void): () => void;
}
export interface TableCopyDataDialogProps {
  target: TableCopyDataTarget; targetVersion: number; services: TableCopyDataServices;
  onClose(): void; onCleanupError(message: string): void; onDirtyChange(dirty: boolean): void; beforeApply(newName: string): void;
  onApplied(result: TableCopyDataApplyOutput): void; onExecutionUncertain(message: string, newName: string): void;
}
type Operation = { guard: TableCopyDataRequestFence; generation: number; taskId: string };
const current = (expires: string) => Number.isFinite(Date.parse(expires)) && Date.parse(expires) > Date.now();

/** 结构及数据复制只编辑新名称；同步围栏先于await，所有执行参数来自真实服务。 */
export function TableCopyDataDialog({ target, targetVersion, services, onClose, onCleanupError, onDirtyChange, beforeApply, onApplied, onExecutionUncertain }: TableCopyDataDialogProps) {
  const fixed = useRef({ target: structuredClone(target), version: targetVersion }), service = useRef(services); service.current = services;
  const callbacks = useRef({ onCleanupError, onDirtyChange, beforeApply }); callbacks.current = { onCleanupError, onDirtyChange, beforeApply };
  const completion = useRef({ onApplied, onExecutionUncertain });
  const alive = useRef(true), fence = useRef(new TableCopyDataRequestFence());
  const snapshots = useRef(new Set<string>()), tokens = useRef(new Set<string>()), releases = useRef(new Map<string, Promise<void>>());
  const snapshotRef = useRef<TableCopyDataGetOutput | null>(null), previewRef = useRef<TableCopyDataPreviewOutput | null>(null), progressRef = useRef<TableCopyDataProgress | null>(null);
  const consumedRef = useRef(false), [consumed, setConsumed] = useState(false);
  const [snapshot, setSnapshot] = useState<TableCopyDataGetOutput | null>(null), [preview, setPreview] = useState<TableCopyDataPreviewOutput | null>(null), [usable, setUsable] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [newName, setNewName] = useState(''), [busy, setBusy] = useState(false), [cancelling, setCancelling] = useState(false), [uncertain, setUncertain] = useState(false);
  const [acks, setAcks] = useState<ReadonlySet<string>>(new Set()), [error, setError] = useState(''), [outcome, setOutcome] = useState(''), [progress, setProgress] = useState<TableCopyDataProgress | null>(null), [clock, setClock] = useState(Date.now());
  const mismatch = !sameTableCopyDataTarget(fixed.current.target, target) || fixed.current.version !== targetVersion, mismatchRef = useRef(mismatch); mismatchRef.current = mismatch;
  const dirty = usable && !!snapshot && newName.length > 0, expired = !!snapshot && Date.parse(snapshot.expiresAt) <= clock || !!preview && Date.parse(preview.expiresAt) <= clock;
  const writable = usable && !!snapshot?.writable && !mismatch && !expired && !consumed;
  useEffect(() => { onDirtyChange(dirty || uncertain); }, [dirty, uncertain, onDirtyChange]);
  useEffect(() => () => callbacks.current.onDirtyChange(false), []);
  useEffect(() => {
    const guard = new TableCopyDataRequestFence(); fence.current = guard; alive.current = true; void read();
    return () => { alive.current = false; const taskId = guard.dispose(); if (taskId) void service.current.cancel({ taskId }).catch(reason => callbacks.current.onCleanupError(errorMessage(reason))); void releaseAll().catch(reason => callbacks.current.onCleanupError(errorMessage(reason))); };
  }, []);
  useEffect(() => services.subscribe(event => { if (alive.current && event.taskId === fence.current.taskId) { progressRef.current = event.progress; setProgress(event.progress); } }), [services]);
  useEffect(() => {
    const deadlines = [snapshot?.expiresAt, preview?.expiresAt].filter((value): value is string => !!value).map(Date.parse).filter(Number.isFinite); if (!deadlines.length) return;
    setClock(Date.now()); const deadline = Math.min(...deadlines); if (deadline > Date.now()) { const timer = window.setTimeout(() => setClock(Date.now()), Math.min(deadline - Date.now() + 1, 2147483647)); return () => window.clearTimeout(timer); }
  }, [snapshot?.expiresAt, preview?.expiresAt]);
  useEffect(() => { const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } }; document.addEventListener('keydown', block, true); return () => document.removeEventListener('keydown', block, true); }, []);

  /** 先记清理责任；迟到响应、并发清理和StrictMode重挂均不漏令牌。 */
  async function releaseOne(kind: 'snapshotId' | 'previewToken', id: string): Promise<void> {
    const set = kind === 'snapshotId' ? snapshots.current : tokens.current, key = kind + ':' + id; set.add(id);
    let request = releases.current.get(key);
    if (!request) { request = Promise.resolve().then(() => service.current.release({ [kind]: id })).then(() => { set.delete(id); }); releases.current.set(key, request); }
    try { await request; } finally { if (releases.current.get(key) === request) releases.current.delete(key); }
  }
  /** 一个失败不能跳过其他资源；失败项保留供明确重试清理。 */
  async function releaseAll(previewsOnly = false): Promise<void> {
    const failures: string[] = [];
    for (const id of [...tokens.current]) try { await releaseOne('previewToken', id); } catch (reason) { failures.push(errorMessage(reason)); }
    if (!previewsOnly) for (const id of [...snapshots.current]) try { await releaseOne('snapshotId', id); } catch (reason) { failures.push(errorMessage(reason)); }
    if (failures.length) throw new Error(failures.join('\n'));
  }
  /** 锁与目标版本同步检查，取消不提前释放忙碌。 */
  function begin(allowMismatch = false): Operation | undefined {
    if (mismatchRef.current && !allowMismatch) return;
    const guard = fence.current, token = guard.begin(uid()); if (!token) return;
    setBusy(true); setCancelling(false); setError(''); setProgress(null); progressRef.current = null; return { guard, ...token };
  }
  /** 响应只属于本次挂载、请求代次和固定连接版本，迟到响应不复活预览。 */
  function accepts(op: Operation): boolean { return alive.current && op.guard === fence.current && op.guard.accepts(op) && !mismatchRef.current; }
  /** 真实请求finally才释放围栏；取消ACK不提前解除忙碌。 */
  function finish(op: Operation): void { op.guard.finish(op); if (alive.current && op.guard === fence.current) setBusy(false); }
  /** 卸载后的清理错误交回工作区，不写入已卸载组件。 */
  function report(reason: unknown): void { if (alive.current) setError(errorMessage(reason)); else callbacks.current.onCleanupError(errorMessage(reason)); }
  /** 失效发生在清理之前，释放失败不能复活可执行预览。 */
  async function invalidatePreview(): Promise<void> { previewRef.current = null; if (alive.current) { setPreview(null); setConfirmation(''); setAcks(new Set()); } await releaseAll(true); }
  /** 重读不重套旧草稿，不重放旧DDL。 */
  async function read(): Promise<void> {
    if (fence.current.busy || mismatchRef.current || (dirty || uncertain) && !window.confirm(uncertain ? text.unknownClose : text.discard)) return;
    const op = begin(); if (!op) return;
    try {
      await invalidatePreview(); snapshotRef.current = null; setUsable(false); await releaseAll(); if (!accepts(op)) return;
      const next = await service.current.get({ ...fixed.current.target, mode: tableCopyDataMode, taskId: op.taskId }); snapshots.current.add(next.snapshotId);
      if (!accepts(op) || next.mode !== tableCopyDataMode || !sameTableCopyDataTarget(next.target, fixed.current.target) || !current(next.expiresAt)) { await releaseOne('snapshotId', next.snapshotId); if (accepts(op)) throw new Error(text.mismatch); return; }
      snapshotRef.current = next; setSnapshot(next); setNewName(''); setUsable(true); setUncertain(false); consumedRef.current = false; setConsumed(false); setOutcome('');  setClock(Date.now());
    } catch (reason) { report(reason); } finally { finish(op); }
  }
  /** 返回编辑释放旧预览，输入本身永远不产生SQL执行请求。 */
  async function back(): Promise<void> { const op = begin(); if (!op) return; try { await invalidatePreview(); } catch (reason) { report(reason); } finally { finish(op); } }
  /** 响应必须与固定目标、原定义和当前草稿一致。 */
  async function makePreview(): Promise<void> {
    const original = snapshotRef.current; if (!writable || !original || !dirty) return;
    const op = begin(); if (!op) return;
    try {
      if (!current(original.expiresAt)) throw new Error(text.expired);
      const value = validateTableCopyDataName(newName); await invalidatePreview(); if (!accepts(op)) return;
      const next = await service.current.preview({ mode: tableCopyDataMode, snapshotId: original.snapshotId, newName: value, taskId: op.taskId }); tokens.current.add(next.previewToken);
      if (!accepts(op) || next.mode !== tableCopyDataMode || !sameTableCopyDataTarget(next.target, fixed.current.target) || next.ddlHash !== original.ddlHash || next.newName !== value || JSON.stringify(next.requiredAcknowledgements) !== JSON.stringify(tableCopyDataRequiredAcknowledgements()) || !current(next.expiresAt)) { await releaseOne('previewToken', next.previewToken); if (accepts(op)) throw new Error(text.mismatch); return; }
      previewRef.current = next; setPreview(next); setAcks(new Set()); setOutcome(''); setClock(Date.now());
    } catch (reason) { report(reason); } finally { finish(op); }
  }
  /** 同步消费防双击；结果回调固定原目标，卸载也不丢执行事实。 */
  async function apply(): Promise<void> {
    const next = previewRef.current, original = snapshotRef.current;
    if (!next || !original || confirmation !== tableCopyDataConfirmation(fixed.current.target, next.newName) || consumedRef.current || !tableCopyDataAcksComplete(next.requiredAcknowledgements, acks)) return;
    const op = begin(); if (!op) return; consumedRef.current = true; setConsumed(true); let attempted = false;
    try {
      if (!current(next.expiresAt) || !current(original.expiresAt)) throw new Error(text.expired);
      callbacks.current.beforeApply(next.newName); if (!accepts(op)) return; attempted = true;
      const result = await service.current.apply({ mode: tableCopyDataMode, previewToken: next.previewToken, confirmation, acknowledgements: [...next.requiredAcknowledgements], taskId: op.taskId });
      if (result.mode !== tableCopyDataMode || !result.dataCompleted || !sameTableCopyDataTarget(result.target, fixed.current.target) || result.newTarget.table !== next.newName || result.newTarget.database !== fixed.current.target.database || result.newTarget.connectionId !== fixed.current.target.connectionId) throw new Error(text.mismatch);
      if (alive.current && op.guard === fence.current && !mismatchRef.current) { setNewName('');  setUncertain(!result.definitionVerified); setOutcome(result.definitionVerified ? text.succeeded : text.verificationFailed); setError(result.warnings.filter(Boolean).join('\n')); }
      completion.current.onApplied(result);
    } catch (reason) {
      const state = tableCopyDataFailure(progressRef.current, attempted), stale = state !== 'notSent';
      if (alive.current && op.guard === fence.current && !mismatchRef.current) { if (progressRef.current?.ddlCompleted) setNewName(''); setOutcome(text[state]); setUncertain(stale); }
      report(reason);
      // 关闭/传输失败不能抹掉可信进度中的成功事实，刷新仍绑定固定来源与准确新名。
      if (progressRef.current?.dataCompleted) completion.current.onApplied({ mode: tableCopyDataMode, target: { ...fixed.current.target }, newTarget: { ...fixed.current.target, table: next.newName }, ddlSubmitted: true, ddlCompleted: true, dataSubmitted: true, insertCompleted: true, commitSubmitted: true, dataCompleted: true, definitionVerified: progressRef.current.definitionVerified, affectedRows: progressRef.current.affectedRows, warnings: [errorMessage(reason)] });
      else if (stale) completion.current.onExecutionUncertain(text[state], next.newName);
    } finally { finish(op); }
  }
  /** 取消只发控制请求，原任务finally到来前保持编辑和关闭禁用。 */
  async function cancel(): Promise<void> { const taskId = fence.current.cancel(); if (!taskId) return; setCancelling(true); try { await service.current.cancel({ taskId }); } catch (reason) { report(reason); } }
  /** 明确放弃后等待令牌真正释放再关闭。 */
  async function close(): Promise<void> {
    if (fence.current.busy || (dirty || uncertain) && !window.confirm(uncertain ? text.unknownClose : text.discard)) return;
    const op = begin(true); if (!op) return;
    try { await invalidatePreview(); snapshotRef.current = null; setUsable(false); await releaseAll(); onClose(); } catch (reason) { report(reason); } finally { finish(op); }
  }
  const unsupportedAck = preview?.requiredAcknowledgements.some(id => !tableCopyDataAckLabel(id));
  return <Modal title={text.title} wide onClose={() => void close()}><div className="modal-content table-copy-data-dialog">
    <p>{fixed.current.target.database} / {fixed.current.target.table}</p>
    {snapshot && <><p>{text.version}：{snapshot.serverVersion} · TABLE_ID：{snapshot.tableId ?? text.unset}</p><h3>{text.sourceDdl}</h3><SqlEditor value={snapshot.sourceDdl} readOnly height={180}/>
      {!snapshot.writable && <div role="status"><strong>{text.readonly}</strong>{snapshot.reasons.map((reason, index) => <p key={index}>{reason}</p>)}</div>}
      {snapshot.warnings.map((warning, index) => <p className="warning-text" key={index}>{warning}</p>)}
      <Field label={text.newName}><textarea aria-label={text.newName} rows={1} value={newName} disabled={busy || !writable || !!preview} onChange={event => { if (!fence.current.busy && !previewRef.current && writable) setNewName(event.target.value); }}/></Field>
    </>}
    {mismatch && <p role="alert">{text.targetChanged}</p>}{expired && <p role="status">{text.expired}</p>}
    {preview && <><h3>{text.fixedSql}</h3><p>{text.after}：{preview.target.database}.{preview.newName}</p><SqlEditor value={preview.sql} readOnly height={180}/><Field label={text.confirmation}><textarea aria-label={text.confirmation} rows={1} value={confirmation} disabled={busy || consumed} onChange={event => setConfirmation(event.target.value)}/></Field>{preview.requiredAcknowledgements.map(id => <label className="check" key={id}><input type="checkbox" disabled={busy || consumed || !tableCopyDataAckLabel(id)} checked={acks.has(id)} onChange={event => { const checked = event.target.checked; setAcks(old => { const next = new Set(old); if (checked) next.add(id); else next.delete(id); return next; }); }}/>{tableCopyDataAckLabel(id) ?? text.unsupportedAck}</label>)}</>}
    {busy && <Spinner/>}{progress && <p className="table-copy-data-state" role="status">{text[progress.phase]} · {tableCopyDataStage(progress)}{progress.affectedRows !== undefined && ` · 数据语句响应行数：${progress.affectedRows}`}</p>}{cancelling && <p>{text.cancelling}</p>}{outcome && <p className="table-copy-data-outcome" role="status">{outcome}</p>}{consumed && <p>{text.consumed}</p>}<ErrorBox message={error}/>
  </div><footer className="modal-footer"><button disabled={busy || mismatch} onClick={() => void read()}>{text.read}</button><span className="grow"/>{busy && <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button>}{preview && !consumed && <button disabled={busy || mismatch} onClick={() => void back()}>{text.back}</button>}{!preview && <button disabled={busy || !writable || !dirty} onClick={() => void makePreview()}>{text.preview}</button>}{preview && <button className="primary" disabled={busy || consumed || mismatch || expired || unsupportedAck || confirmation !== tableCopyDataConfirmation(fixed.current.target, preview.newName) || !tableCopyDataAcksComplete(preview.requiredAcknowledgements, acks)} onClick={() => void apply()}>{text.apply}</button>}<button disabled={busy} onClick={() => void close()}>{text.close}</button></footer></Modal>;
}
