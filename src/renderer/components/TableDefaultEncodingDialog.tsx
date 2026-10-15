import { useEffect, useRef, useState } from 'react';
import { sameTableEncodingPair, validateTableEncodingPair, type TableEncodingPair, type TableDefaultEncodingGetInput, type TableDefaultEncodingGetOutput, type TableDefaultEncodingPreviewInput, type TableDefaultEncodingPreviewOutput, type TableDefaultEncodingApplyInput, type TableDefaultEncodingApplyOutput, type TableDefaultEncodingReleaseInput, type TableDefaultEncodingProgress, type TableDefaultEncodingTarget } from '../../shared/tableDefaultEncoding';
import { TableDefaultEncodingRequestFence, sameTableDefaultEncodingTarget, tableDefaultEncodingAckLabel, tableDefaultEncodingAcksComplete, tableDefaultEncodingFailure, changeDefaultCharset, defaultEncodingSelectable } from '../tableDefaultEncodingUi';
import { tableDefaultEncodingZh as text } from '../locales/tableDefaultEncoding.zh-CN';
import { errorMessage, uid } from '../lib';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { SqlEditor } from './SqlEditor';

export interface TableDefaultEncodingServices {
  get(input: TableDefaultEncodingGetInput): Promise<TableDefaultEncodingGetOutput>;
  preview(input: TableDefaultEncodingPreviewInput): Promise<TableDefaultEncodingPreviewOutput>;
  apply(input: TableDefaultEncodingApplyInput): Promise<TableDefaultEncodingApplyOutput>;
  release(input: TableDefaultEncodingReleaseInput): Promise<void>;
  cancel(input: { taskId: string }): Promise<void>;
  subscribe(listener: (event: { taskId: string; progress: TableDefaultEncodingProgress }) => void): () => void;
}
export interface TableDefaultEncodingDialogProps {
  target: TableDefaultEncodingTarget; targetVersion: number; services: TableDefaultEncodingServices;
  onClose(): void; onCleanupError(message: string): void; onDirtyChange(dirty: boolean): void; beforeApply(): void;
  onApplied(result: TableDefaultEncodingApplyOutput): void; onExecutionUncertain(message: string): void;
}
type Operation = { guard: TableDefaultEncodingRequestFence; generation: number; taskId: string };
/** 过期时间必须能解析且仍有效，未知时间不能形成可执行能力。 */
const current = (expires: string) => Number.isFinite(Date.parse(expires)) && Date.parse(expires) > Date.now();

/** 表默认编码只选择目录证明的完整编码配对；同步围栏先于await，所有执行参数来自真实服务。 */
export function TableDefaultEncodingDialog({ target, targetVersion, services, onClose, onCleanupError, onDirtyChange, beforeApply, onApplied, onExecutionUncertain }: TableDefaultEncodingDialogProps) {
  const fixed = useRef({ target: structuredClone(target), version: targetVersion }), service = useRef(services); service.current = services;
  const callbacks = useRef({ onCleanupError, onDirtyChange, beforeApply }); callbacks.current = { onCleanupError, onDirtyChange, beforeApply };
  const completion = useRef({ onApplied, onExecutionUncertain });
  const alive = useRef(true), fence = useRef(new TableDefaultEncodingRequestFence());
  const snapshots = useRef(new Set<string>()), tokens = useRef(new Set<string>()), releases = useRef(new Map<string, Promise<void>>());
  const snapshotRef = useRef<TableDefaultEncodingGetOutput | null>(null), previewRef = useRef<TableDefaultEncodingPreviewOutput | null>(null), progressRef = useRef<TableDefaultEncodingProgress | null>(null);
  const consumedRef = useRef(false), [consumed, setConsumed] = useState(false);
  const [snapshot, setSnapshot] = useState<TableDefaultEncodingGetOutput | null>(null), [preview, setPreview] = useState<TableDefaultEncodingPreviewOutput | null>(null), [usable, setUsable] = useState(false);
  const [selection, setSelection] = useState<TableEncodingPair>({ charset: '', collation: '' }), [busy, setBusy] = useState(false), [cancelling, setCancelling] = useState(false), [uncertain, setUncertain] = useState(false);
  const [acks, setAcks] = useState<ReadonlySet<string>>(new Set()), [error, setError] = useState(''), [outcome, setOutcome] = useState(''), [progress, setProgress] = useState<TableDefaultEncodingProgress | null>(null), [clock, setClock] = useState(Date.now());
  const mismatch = !sameTableDefaultEncodingTarget(fixed.current.target, target) || fixed.current.version !== targetVersion, mismatchRef = useRef(mismatch); mismatchRef.current = mismatch;
  const dirty = usable && !!snapshot && !sameTableEncodingPair(selection, snapshot.current), expired = !!snapshot && Date.parse(snapshot.expiresAt) <= clock || !!preview && Date.parse(preview.expiresAt) <= clock;
  const writable = usable && !!snapshot?.writable && !mismatch && !expired && !consumed;
  useEffect(() => { onDirtyChange(dirty || uncertain); }, [dirty, uncertain, onDirtyChange]);
  useEffect(() => () => callbacks.current.onDirtyChange(false), []);
  useEffect(() => {
    const guard = new TableDefaultEncodingRequestFence(); fence.current = guard; alive.current = true; void read();
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
  /** 迟到、取消或旧目标响应只能清理，不能覆盖当前选择。 */
  function accepts(op: Operation): boolean { return alive.current && op.guard === fence.current && op.guard.accepts(op) && !mismatchRef.current; }
  /** 原请求真正结束才释放同步锁，不用取消控制请求的返回冒充终态。 */
  function finish(op: Operation): void { op.guard.finish(op); if (alive.current && op.guard === fence.current) setBusy(false); }
  /** 卸载后的资源错误交宿主提示，不静默丢失。 */
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
      if (!accepts(op) || !sameTableDefaultEncodingTarget(next.target, fixed.current.target) || !current(next.expiresAt)) { await releaseOne('snapshotId', next.snapshotId); if (accepts(op)) throw new Error(text.mismatch); return; }
      snapshotRef.current = next; setSnapshot(next); setSelection({ ...next.current }); setUsable(true); setUncertain(false); consumedRef.current = false; setConsumed(false); setOutcome(''); setClock(Date.now());
    } catch (reason) { report(reason); } finally { finish(op); }
  }
  /** 返回编辑释放旧预览，选择本身永远不产生SQL执行请求。 */
  async function back(): Promise<void> { const op = begin(); if (!op) return; try { await invalidatePreview(); } catch (reason) { report(reason); } finally { finish(op); } }
  /** 响应必须与固定目标、原定义和当前草稿一致。 */
  async function makePreview(): Promise<void> {
    const original = snapshotRef.current; if (!writable || !original || !dirty || !defaultEncodingSelectable(selection, original.candidates)) return;
    const op = begin(); if (!op) return;
    try {
      if (!current(original.expiresAt)) throw new Error(text.expired);
      const value = validateTableEncodingPair(selection); await invalidatePreview(); if (!accepts(op)) return;
      const next = await service.current.preview({ snapshotId: original.snapshotId, ...value, taskId: op.taskId }); tokens.current.add(next.previewToken);
      if (!accepts(op) || !sameTableDefaultEncodingTarget(next.target, fixed.current.target) || next.ddlHash !== original.ddlHash || !sameTableEncodingPair(next.before, original.current) || !sameTableEncodingPair(next.after, value) || !current(next.expiresAt)) { await releaseOne('previewToken', next.previewToken); if (accepts(op)) throw new Error(text.mismatch); return; }
      previewRef.current = next; setPreview(next); setAcks(new Set()); setOutcome(''); setClock(Date.now());
    } catch (reason) { report(reason); } finally { finish(op); }
  }
  /** 同步消费防双击；结果回调固定原目标，卸载也不丢执行事实。 */
  async function apply(): Promise<void> {
    const next = previewRef.current, original = snapshotRef.current;
    if (!next || !original || consumedRef.current || !tableDefaultEncodingAcksComplete(next.requiredAcknowledgements, acks)) return;
    const op = begin(); if (!op) return; consumedRef.current = true; setConsumed(true); let attempted = false;
    try {
      if (!current(next.expiresAt) || !current(original.expiresAt)) throw new Error(text.expired);
      callbacks.current.beforeApply(); if (!accepts(op)) return; attempted = true;
      const result = await service.current.apply({ previewToken: next.previewToken, acknowledgements: [...next.requiredAcknowledgements], taskId: op.taskId });
      if (alive.current && op.guard === fence.current) { setSelection({ ...original.current }); setUncertain(!result.definitionVerified); setOutcome(result.definitionVerified ? text.succeeded : text.verificationFailed); setError([result.verificationError, ...result.warnings].filter(Boolean).join('\n')); }
      completion.current.onApplied(result);
    } catch (reason) {
      const state = tableDefaultEncodingFailure(progressRef.current, attempted), stale = state !== 'notSent';
      if (alive.current && op.guard === fence.current) { if (progressRef.current?.ddlCompleted) setSelection({ ...original.current }); setOutcome(text[state]); setUncertain(stale); }
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
  const unsupportedAck = preview?.requiredAcknowledgements.some(id => !tableDefaultEncodingAckLabel(id));
  const charsets = snapshot ? [...new Set(snapshot.candidates.map(pair => pair.charset))] : [];
  const collations = snapshot?.candidates.filter(pair => pair.charset === selection.charset) ?? [];
  const editingDisabled = busy || !writable || !!preview;
  return <Modal title={text.title} wide onClose={() => void close()}><div className="modal-content table-default-encoding-dialog">
    <p>{fixed.current.target.database} / {fixed.current.target.table}</p><p className="warning-text">{text.scope}</p>
    {snapshot && <><p>{text.before}：{snapshot.current.charset} / {snapshot.current.collation}</p><div className="form-grid"><Field label={text.engine}><input readOnly value={snapshot.engine}/></Field><Field label={text.rowFormat}><input readOnly value={snapshot.rowFormat}/></Field><Field label={text.serverVersion}><input readOnly value={snapshot.serverVersion}/></Field></div>
      {!snapshot.writable && <div role="status"><strong>{text.readonly}</strong>{snapshot.reasons.map((reason, index) => <p key={index}>{reason}</p>)}</div>}
      {snapshot.warnings.map((warning, index) => <p className="warning-text" key={index}>{warning}</p>)}
      <div className="form-grid"><Field label={text.charset}><select aria-label={text.charset} value={selection.charset} disabled={editingDisabled} onChange={event => { if (!fence.current.busy && !previewRef.current && writable) setSelection(old => changeDefaultCharset(old, event.target.value, snapshot.candidates)); }}>{!charsets.includes(selection.charset) && <option value={selection.charset}>{selection.charset}</option>}{charsets.map(charset => <option key={charset} value={charset}>{charset}</option>)}</select></Field>
      <Field label={text.collation}><select aria-label={text.collation} value={selection.collation} disabled={editingDisabled} onChange={event => { if (!fence.current.busy && !previewRef.current && writable) setSelection(old => ({ ...old, collation: event.target.value })); }}><option value="">{text.choose}</option>{collations.map(pair => <option key={pair.collation} value={pair.collation}>{pair.collation}</option>)}</select></Field></div>
      <details><summary>{text.columns} · {snapshot.columns.length}</summary><table><thead><tr><th>{text.columnName}</th><th>{text.columnCharset}</th><th>{text.columnCollation}</th></tr></thead><tbody>{snapshot.columns.slice(0, 100).map(column => <tr key={column.name}><td>{column.name}</td><td>{column.charset ?? text.notApplicable}</td><td>{column.collation ?? text.notApplicable}</td></tr>)}</tbody></table>{snapshot.columns.length > 100 && <p>{text.moreColumns}</p>}</details>
    </>}
    {!snapshot && error && <p>{text.readonly}</p>}{mismatch && <p role="alert">{text.targetChanged}</p>}{expired && <p role="status">{text.expired}</p>}
    {preview && <><h3>{text.fixedSql}</h3><p>{text.before}：{preview.before.charset} / {preview.before.collation}</p><p>{text.after}：{preview.after.charset} / {preview.after.collation}</p><SqlEditor value={preview.sql} readOnly height={180}/>{preview.requiredAcknowledgements.map(id => <label className="check" key={id}><input type="checkbox" disabled={busy || consumed || !tableDefaultEncodingAckLabel(id)} checked={acks.has(id)} onChange={event => { const checked = event.target.checked; setAcks(old => { const next = new Set(old); if (checked) next.add(id); else next.delete(id); return next; }); }}/>{tableDefaultEncodingAckLabel(id) ?? text.unsupportedAck}</label>)}</>}
    {busy && <Spinner/>}{progress && <p className="table-default-encoding-state" role="status">{text[progress.phase]}</p>}{cancelling && <p>{text.cancelling}</p>}{outcome && <p className="table-default-encoding-outcome" role="status">{outcome}</p>}{consumed && <p>{text.consumed}</p>}<ErrorBox message={error}/>
  </div><footer className="modal-footer"><button disabled={busy || mismatch} onClick={() => void read()}>{text.read}</button><span className="grow"/>{busy && <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button>}{preview && !consumed && <button disabled={busy || mismatch} onClick={() => void back()}>{text.back}</button>}{!preview && <button disabled={busy || !writable || !dirty || !snapshot || !defaultEncodingSelectable(selection, snapshot.candidates)} onClick={() => void makePreview()}>{text.preview}</button>}{preview && <button className="primary" disabled={busy || consumed || mismatch || expired || unsupportedAck || !tableDefaultEncodingAcksComplete(preview.requiredAcknowledgements, acks)} onClick={() => void apply()}>{text.apply}</button>}<button disabled={busy} onClick={() => void close()}>{text.close}</button></footer></Modal>;
}
