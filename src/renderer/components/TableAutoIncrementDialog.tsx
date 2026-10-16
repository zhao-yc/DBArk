import { useEffect, useRef, useState } from 'react';
import { validateTableAutoIncrement, type TableAutoIncrementGetInput, type TableAutoIncrementGetOutput, type TableAutoIncrementPreviewInput, type TableAutoIncrementPreviewOutput, type TableAutoIncrementApplyInput, type TableAutoIncrementApplyOutput, type TableAutoIncrementReleaseInput, type TableAutoIncrementProgress, type TableAutoIncrementTarget } from '../../shared/tableAutoIncrement';
import { TableAutoIncrementRequestFence, sameTableAutoIncrementTarget, tableAutoIncrementAckLabel, tableAutoIncrementAcksComplete, tableAutoIncrementFailure, tableAutoIncrementResultMatches } from '../tableAutoIncrementUi';
import { tableAutoIncrementZh as text } from '../locales/tableAutoIncrement.zh-CN';
import { errorMessage, uid } from '../lib';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { SqlEditor } from './SqlEditor';

export interface TableAutoIncrementServices {
  get(input: TableAutoIncrementGetInput): Promise<TableAutoIncrementGetOutput>;
  preview(input: TableAutoIncrementPreviewInput): Promise<TableAutoIncrementPreviewOutput>;
  apply(input: TableAutoIncrementApplyInput): Promise<TableAutoIncrementApplyOutput>;
  release(input: TableAutoIncrementReleaseInput): Promise<void>;
  cancel(input: { taskId: string }): Promise<void>;
  subscribe(listener: (event: { taskId: string; progress: TableAutoIncrementProgress }) => void): () => void;
}
export interface TableAutoIncrementDialogProps {
  target: TableAutoIncrementTarget; targetVersion: number; services: TableAutoIncrementServices;
  onClose(): void; onCleanupError(message: string): void; onDirtyChange(dirty: boolean): void; beforeApply(): void;
  onApplied(result: TableAutoIncrementApplyOutput): void; onExecutionUncertain(message: string): void;
}
type Operation = { guard: TableAutoIncrementRequestFence; generation: number; taskId: string };
const current = (expires: string) => Number.isFinite(Date.parse(expires)) && Date.parse(expires) > Date.now();

/** 下一自增值只编辑一个字符串；同步围栏先于await，所有执行参数来自真实服务。 */
export function TableAutoIncrementDialog({ target, targetVersion, services, onClose, onCleanupError, onDirtyChange, beforeApply, onApplied, onExecutionUncertain }: TableAutoIncrementDialogProps) {
  const fixed = useRef({ target: structuredClone(target), version: targetVersion }), service = useRef(services); service.current = services;
  const callbacks = useRef({ onCleanupError, onDirtyChange, beforeApply }); callbacks.current = { onCleanupError, onDirtyChange, beforeApply };
  const completion = useRef({ onApplied, onExecutionUncertain });
  const alive = useRef(true), fence = useRef(new TableAutoIncrementRequestFence());
  const snapshots = useRef(new Set<string>()), tokens = useRef(new Set<string>()), releases = useRef(new Map<string, Promise<void>>());
  const snapshotRef = useRef<TableAutoIncrementGetOutput | null>(null), previewRef = useRef<TableAutoIncrementPreviewOutput | null>(null), progressRef = useRef<TableAutoIncrementProgress | null>(null);
  const consumedRef = useRef(false), [consumed, setConsumed] = useState(false);
  const [snapshot, setSnapshot] = useState<TableAutoIncrementGetOutput | null>(null), [preview, setPreview] = useState<TableAutoIncrementPreviewOutput | null>(null), [usable, setUsable] = useState(false);
  const [observed, setObserved] = useState('');
  const [value, setValue] = useState(''), [busy, setBusy] = useState(false), [cancelling, setCancelling] = useState(false), [uncertain, setUncertain] = useState(false);
  const [acks, setAcks] = useState<ReadonlySet<string>>(new Set()), [error, setError] = useState(''), [outcome, setOutcome] = useState(''), [progress, setProgress] = useState<TableAutoIncrementProgress | null>(null), [clock, setClock] = useState(Date.now());
  const mismatch = !sameTableAutoIncrementTarget(fixed.current.target, target) || fixed.current.version !== targetVersion, mismatchRef = useRef(mismatch); mismatchRef.current = mismatch;
  const dirty = usable && !!snapshot && value !== (snapshot.autoIncrement ?? ''), expired = !!snapshot && Date.parse(snapshot.expiresAt) <= clock || !!preview && Date.parse(preview.expiresAt) <= clock;
  const writable = usable && !!snapshot?.writable && !!snapshot.column && !mismatch && !expired && !consumed;
  useEffect(() => { onDirtyChange(dirty || uncertain); }, [dirty, uncertain, onDirtyChange]);
  useEffect(() => () => callbacks.current.onDirtyChange(false), []);
  useEffect(() => {
    const guard = new TableAutoIncrementRequestFence(); fence.current = guard; alive.current = true; void read();
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
  function accepts(op: Operation): boolean { return alive.current && op.guard === fence.current && op.guard.accepts(op) && !mismatchRef.current; }
  function finish(op: Operation): void { op.guard.finish(op); if (alive.current && op.guard === fence.current) setBusy(false); }
  function report(reason: unknown): void { if (alive.current) setError(errorMessage(reason)); else callbacks.current.onCleanupError(errorMessage(reason)); }
  /** 失效发生在清理之前，释放失败不能复活可执行预览。 */
  async function invalidatePreview(): Promise<void> { previewRef.current = null; if (alive.current) { setPreview(null); setAcks(new Set()); } await releaseAll(true); }
  /** 重读不重套旧草稿，不重放旧DDL。 */
  async function read(): Promise<void> {
    if (fence.current.busy || mismatchRef.current || (dirty || uncertain) && !window.confirm(uncertain ? text.unknownClose : text.discard)) return;
    const op = begin(); if (!op) return;
    try {
      await invalidatePreview(); snapshotRef.current = null; setUsable(false); await releaseAll(); if (!accepts(op)) return;
      const next = await service.current.get({ ...fixed.current.target, taskId: op.taskId }); snapshots.current.add(next.snapshotId);
      if (!accepts(op) || !sameTableAutoIncrementTarget(next.target, fixed.current.target) || !current(next.expiresAt)) { await releaseOne('snapshotId', next.snapshotId); if (accepts(op)) throw new Error(text.mismatch); return; }
      snapshotRef.current = next; setSnapshot(next); setValue((next.autoIncrement ?? '')); setUsable(true); setUncertain(false); consumedRef.current = false; setConsumed(false); setOutcome(''); setObserved(''); setClock(Date.now());
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
      const nextValue = validateTableAutoIncrement(value, original.column?.maximum); await invalidatePreview(); if (!accepts(op)) return;
      const next = await service.current.preview({ snapshotId: original.snapshotId, value: nextValue, taskId: op.taskId }); tokens.current.add(next.previewToken);
      if (!accepts(op) || !sameTableAutoIncrementTarget(next.target, fixed.current.target) || next.ddlHash !== original.ddlHash || next.before !== (original.autoIncrement ?? '') || next.after !== nextValue || !current(next.expiresAt)) { await releaseOne('previewToken', next.previewToken); if (accepts(op)) throw new Error(text.mismatch); return; }
      previewRef.current = next; setPreview(next); setAcks(new Set()); setOutcome(''); setClock(Date.now());
    } catch (reason) { report(reason); } finally { finish(op); }
  }
  /** 同步消费防双击；结果回调固定原目标，卸载也不丢执行事实。 */
  async function apply(): Promise<void> {
    const next = previewRef.current, original = snapshotRef.current;
    if (!next || !original || consumedRef.current || !tableAutoIncrementAcksComplete(next.requiredAcknowledgements, acks)) return;
    const op = begin(); if (!op) return; consumedRef.current = true; setConsumed(true); let attempted = false, responseRejected = false;
    try {
      if (!current(next.expiresAt) || !current(original.expiresAt)) throw new Error(text.expired);
      callbacks.current.beforeApply(); if (!accepts(op)) return; attempted = true;
      const result = await service.current.apply({ previewToken: next.previewToken, acknowledgements: [...next.requiredAcknowledgements], taskId: op.taskId });
      if (!tableAutoIncrementResultMatches(result, next.after, original.tableId)) { responseRejected = true; throw new Error(text.mismatch); }
      if (alive.current && op.guard === fence.current && !mismatchRef.current) { setValue((original.autoIncrement ?? '')); setUncertain(!result.definitionVerified); setObserved(result.after?.value ?? text.unset); setOutcome(result.definitionVerified ? text.succeeded : text.verificationFailed); setError([result.verificationError, ...result.warnings].filter(Boolean).join('\n')); }
      completion.current.onApplied(result);
    } catch (reason) {
      const state = responseRejected ? progressRef.current?.ddlCompleted ? 'verificationFailed' : 'unknown' : tableAutoIncrementFailure(progressRef.current, attempted), stale = state !== 'notSent';
      if (alive.current && op.guard === fence.current && !mismatchRef.current) { if (progressRef.current?.ddlCompleted) setValue((original.autoIncrement ?? '')); setOutcome(text[state]); setUncertain(stale); }
      report(reason); if (stale) completion.current.onExecutionUncertain(text[state]);
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
  const unsupportedAck = preview?.requiredAcknowledgements.some(id => !tableAutoIncrementAckLabel(id));
  return <Modal title={text.title} wide onClose={() => void close()}><div className="modal-content table-auto-increment-dialog">
    <p>{fixed.current.target.database} / {fixed.current.target.table}</p>
    {snapshot && <><div className="form-grid"><Field label={text.engine}><input readOnly value={snapshot.engine}/></Field><Field label={text.charset}><input readOnly value={snapshot.charset}/></Field><Field label={text.collation}><input readOnly value={snapshot.collation}/></Field><Field label={text.rowFormat}><input readOnly value={snapshot.rowFormat}/></Field><Field label={text.autoIncrement}><input readOnly value={snapshot.autoIncrement ?? text.unset}/></Field><Field label={text.version}><input readOnly value={snapshot.serverVersion}/></Field></div>
      {!snapshot.writable && <div role="status"><strong>{text.readonly}</strong>{snapshot.reasons.map((reason, index) => <p key={index}>{reason}</p>)}</div>}
      {snapshot.column && <p>{text.column}：{snapshot.column.name} / {snapshot.column.type} / {text.maximum}：{snapshot.column.maximum}</p>}
      {snapshot.warnings.map((warning, index) => <p className="warning-text" key={index}>{warning}</p>)}
      <Field label={text.value}><textarea aria-label={text.value} rows={1} value={value} disabled={busy || !writable || !!preview} onChange={event => { if (!fence.current.busy && !previewRef.current && writable) setValue(event.target.value); }}/></Field>
    </>}
    {observed && <p role="status">{text.observed}：{observed}</p>}
    {mismatch && <p role="alert">{text.targetChanged}</p>}{expired && <p role="status">{text.expired}</p>}
    {preview && <><h3>{text.fixedSql}</h3><p>{text.before}：{preview.before}</p><p>{text.after}：{preview.after}</p><SqlEditor value={preview.sql} readOnly height={180}/>{preview.requiredAcknowledgements.map(id => <label className="check" key={id}><input type="checkbox" disabled={busy || consumed || !tableAutoIncrementAckLabel(id)} checked={acks.has(id)} onChange={event => { const checked = event.target.checked; setAcks(old => { const next = new Set(old); if (checked) next.add(id); else next.delete(id); return next; }); }}/>{tableAutoIncrementAckLabel(id) ?? text.unsupportedAck}</label>)}</>}
    {busy && <Spinner/>}{progress && <p className="table-auto-increment-state" role="status">{text[progress.phase]}</p>}{cancelling && <p>{text.cancelling}</p>}{outcome && <p className="table-auto-increment-outcome" role="status">{outcome}</p>}{consumed && <p>{text.consumed}</p>}<ErrorBox message={error}/>
  </div><footer className="modal-footer"><button disabled={busy || mismatch} onClick={() => void read()}>{text.read}</button><span className="grow"/>{busy && <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button>}{preview && !consumed && <button disabled={busy || mismatch} onClick={() => void back()}>{text.back}</button>}{!preview && <button disabled={busy || !writable || !dirty} onClick={() => void makePreview()}>{text.preview}</button>}{preview && <button className="primary" disabled={busy || consumed || mismatch || expired || unsupportedAck || !tableAutoIncrementAcksComplete(preview.requiredAcknowledgements, acks)} onClick={() => void apply()}>{text.apply}</button>}<button disabled={busy} onClick={() => void close()}>{text.close}</button></footer></Modal>;
}
