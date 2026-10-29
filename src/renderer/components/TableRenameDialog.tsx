import { useEffect, useRef, useState } from 'react';
import { validateTableRenameName, type TableRenameGetInput, type TableRenameGetOutput, type TableRenamePreviewInput, type TableRenamePreviewOutput, type TableRenameApplyInput, type TableRenameApplyOutput, type TableRenameReleaseInput, type TableRenameProgress, type TableRenameTarget } from '../../shared/tableRename';
import { TableRenameRequestFence, sameTableRenameTarget, tableRenameAckLabel, tableRenameAcksComplete, tableRenameFailure } from '../tableRenameUi';
import { tableRenameZh as text } from '../locales/tableRename.zh-CN';
import { errorMessage, uid } from '../lib';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';
import { SqlEditor } from './SqlEditor';

export interface TableRenameServices {
  get(input: TableRenameGetInput): Promise<TableRenameGetOutput>;
  preview(input: TableRenamePreviewInput): Promise<TableRenamePreviewOutput>;
  apply(input: TableRenameApplyInput): Promise<TableRenameApplyOutput>;
  release(input: TableRenameReleaseInput): Promise<void>;
  cancel(input: { taskId: string }): Promise<void>;
  subscribe(listener: (event: { taskId: string; progress: TableRenameProgress }) => void): () => void;
}
export interface TableRenameDialogProps {
  target: TableRenameTarget; targetVersion: number; services: TableRenameServices;
  onClose(): void; onCleanupError(message: string): void; onDirtyChange(dirty: boolean): void; beforeApply(newName: string): void;
  onApplied(result: TableRenameApplyOutput): void; onExecutionUncertain(message: string, newName: string): void;
}
type Operation = { guard: TableRenameRequestFence; generation: number; taskId: string };
type SnapshotOwner = { value: TableRenameGetOutput; target: TableRenameTarget; reasons: string[]; warnings: string[]; receipt: string; invalid: boolean };
type PreviewOwner = { value: TableRenamePreviewOutput; source: SnapshotOwner; target: TableRenameTarget; required: string[]; warnings: string[]; receipt: string; invalid: boolean; consumed: boolean };
/** TTL依据真实时钟复核，按钮刷新计时不能代替动作入口检查。 */
const current = (expires: string) => Number.isFinite(Date.parse(expires)) && Date.parse(expires) > Date.now();

/** 表重命名只编辑新名称；同步围栏先于await，所有执行参数来自真实服务。 */
export function TableRenameDialog({ target, targetVersion, services, onClose, onCleanupError, onDirtyChange, beforeApply, onApplied, onExecutionUncertain }: TableRenameDialogProps) {
  const fixed = useRef({ target: structuredClone(target), version: targetVersion }), service = useRef(services); service.current = services;
  const callbacks = useRef({ onCleanupError, onDirtyChange, beforeApply }); callbacks.current = { onCleanupError, onDirtyChange, beforeApply };
  const completion = useRef({ onApplied, onExecutionUncertain });
  const alive = useRef(true), fence = useRef(new TableRenameRequestFence());
  const snapshots = useRef(new Set<string>()), tokens = useRef(new Set<string>()), releases = useRef(new Map<string, Promise<void>>());
  const snapshotRef = useRef<TableRenameGetOutput | null>(null), previewRef = useRef<TableRenamePreviewOutput | null>(null), progressRef = useRef<TableRenameProgress | null>(null);
  const sourceRef = useRef<SnapshotOwner | null>(null), planRef = useRef<PreviewOwner | null>(null), targetChanged = useRef(false), discardConfirmation = useRef(false);
  const consumedRef = useRef(false), [consumed, setConsumed] = useState(false);
  const [snapshot, setSnapshot] = useState<TableRenameGetOutput | null>(null), [preview, setPreview] = useState<TableRenamePreviewOutput | null>(null), [usable, setUsable] = useState(false);
  const [newName, setNewNameState] = useState(''), [busy, setBusy] = useState(false), [cancelling, setCancelling] = useState(false), [uncertain, setUncertainState] = useState(false);
  const nameRef = useRef(newName), nameRevision = useRef(0), uncertainRef = useRef(uncertain), usableRef = useRef(usable);
  const [acks, setAcksState] = useState<ReadonlySet<string>>(new Set()), [error, setError] = useState(''), [outcome, setOutcome] = useState(''), [progress, setProgress] = useState<TableRenameProgress | null>(null), [clock, setClock] = useState(Date.now());
  const acksRef = useRef(acks), ackRevision = useRef(0), renderedAckRevision = ackRevision.current, renderedNameRevision = nameRevision.current;
  if (!sameTableRenameTarget(fixed.current.target, target) || fixed.current.version !== targetVersion) targetChanged.current = true;
  const mismatch = targetChanged.current, mismatchRef = useRef(mismatch); mismatchRef.current = mismatch;
  const dirty = usable && !!snapshot && newName !== snapshot.target.table, expired = !!snapshot && Date.parse(snapshot.expiresAt) <= clock || !!preview && Date.parse(preview.expiresAt) <= clock;
  const writable = usable && !!snapshot?.writable && !mismatch && !expired && !consumed;
  /** 同步修改名称代次；同值恢复也不复活旧输入或旧丢稿同意。 */
  function setNewName(value: string): void { nameRef.current = value; nameRevision.current++; setNewNameState(value); }
  /** 执行未知事实同步保存，初始渲染留下的关闭事件也不能降级提示。 */
  function setUncertain(value: boolean): void { uncertainRef.current = value; setUncertainState(value); }
  /** 可用性先同步撤销，再触发重绘；清理等待期间旧事件不能重新预览。 */
  function updateUsable(value: boolean): void { usableRef.current = value; setUsable(value); }
  /** ACK绑定集合身份和单调代次，不凭内容相同继承早先确认。 */
  function setAcks(value: ReadonlySet<string>): void { acksRef.current = value; ackRevision.current++; setAcksState(value); }
  /** 集合内容恢复相同也不继承旧回调持有的确认。 */
  function acknowledgementsCurrent(expected: ReadonlySet<string>, revision: number): boolean { return acksRef.current === expected && ackRevision.current === revision; }
  /** 已观察到的读取漂移不可ABA复活；只允许重新读取创建新来源。 */
  function sourceCurrent(owner: SnapshotOwner | null): owner is SnapshotOwner {
    if (!owner || owner !== sourceRef.current || owner.invalid) return false;
    if (!alive.current || mismatchRef.current || !usableRef.current || snapshotRef.current !== owner.value || owner.target !== owner.value.target || owner.reasons !== owner.value.reasons || owner.warnings !== owner.value.warnings || !current(owner.value.expiresAt) || !sameTableRenameTarget(owner.value.target, fixed.current.target) || JSON.stringify(owner.value) !== owner.receipt) { owner.invalid = true; return false; }
    return true;
  }
  /** 本次执行的预览、原读取和完整回执必须仍属于同一租约；applying只用于消费后的二核。 */
  function planCurrent(owner: PreviewOwner | null, applying = false): owner is PreviewOwner {
    if (!owner || owner !== planRef.current || owner.invalid || owner.consumed && !applying) return false;
    if (previewRef.current !== owner.value || owner.target !== owner.value.target || owner.required !== owner.value.requiredAcknowledgements || owner.warnings !== owner.value.warnings || !sourceCurrent(owner.source) || !current(owner.value.expiresAt) || JSON.stringify(owner.value) !== owner.receipt) { owner.invalid = true; return false; }
    return true;
  }
  /** 输入只更新当前渲染的名称；确认中的新意图会换代，使外层旧同意失效。 */
  function changeName(expected: TableRenameGetOutput, revision: number, value: string): void {
    if (fence.current.busy || consumedRef.current || previewRef.current || expected !== snapshotRef.current || revision !== nameRevision.current || !expected.writable || !sourceCurrent(sourceRef.current)) return;
    setNewName(value);
  }
  /** 旧确认框不能给新预览勾选，也不能恢复同预览后续已取消的确认。 */
  function changeAcknowledgement(expected: TableRenamePreviewOutput, selected: ReadonlySet<string>, revision: number, id: string, checked: boolean): void {
    if (fence.current.busy || discardConfirmation.current || consumedRef.current || expected !== previewRef.current || typeof checked !== 'boolean' || !acknowledgementsCurrent(selected, revision) || !expected.requiredAcknowledgements.includes(id) || !tableRenameAckLabel(id) || !planCurrent(planRef.current)) return;
    const next = new Set(selected); if (checked) next.add(id); else next.delete(id); setAcks(next);
  }
  /** 原生确认不能授权同步重入写入；确认后重新核对名称、来源、ACK和执行事实。 */
  function confirmDiscard(): boolean {
    if (!alive.current || fence.current.busy || discardConfirmation.current) return false;
    const owner = { source: sourceRef.current, snapshot: snapshotRef.current, plan: planRef.current, preview: previewRef.current, name: nameRef.current, revision: nameRevision.current, ack: ackRevision.current, usable: usableRef.current, uncertain: uncertainRef.current, mismatch: mismatchRef.current, consumed: consumedRef.current, guard: fence.current };
    const changed = owner.usable && !!owner.snapshot && owner.name !== owner.snapshot.target.table;
    discardConfirmation.current = true;
    try {
      const accepted = !(changed || owner.uncertain) || window.confirm(owner.uncertain ? text.unknownClose : text.discard);
      return accepted && alive.current && !fence.current.busy && owner.guard === fence.current && owner.source === sourceRef.current && owner.snapshot === snapshotRef.current && owner.plan === planRef.current && owner.preview === previewRef.current && owner.name === nameRef.current && owner.revision === nameRevision.current && owner.ack === ackRevision.current && owner.usable === usableRef.current && owner.uncertain === uncertainRef.current && owner.mismatch === mismatchRef.current && owner.consumed === consumedRef.current;
    } finally { discardConfirmation.current = false; }
  }
  useEffect(() => { onDirtyChange(dirty || uncertain); }, [dirty, uncertain, onDirtyChange]);
  useEffect(() => () => callbacks.current.onDirtyChange(false), []);
  useEffect(() => {
    const guard = new TableRenameRequestFence(); fence.current = guard; alive.current = true; void read();
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
    if (!alive.current || discardConfirmation.current || mismatchRef.current && !allowMismatch) return;
    const guard = fence.current, token = guard.begin(uid()); if (!token) return;
    setBusy(true); setCancelling(false); setError(''); setProgress(null); progressRef.current = null; return { guard, ...token };
  }
  /** 取消、卸载或目标变化后的结果不能继续推进当前操作。 */
  function accepts(op: Operation): boolean { return alive.current && op.guard === fence.current && op.guard.accepts(op) && !mismatchRef.current; }
  /** 只有原请求真正settled后释放忙碌，旧finally不解锁后继任务。 */
  function finish(op: Operation): void { op.guard.finish(op); if (alive.current && op.guard === fence.current) setBusy(false); }
  /** 卸载后的清理错误仍上报父级，不向已卸载窗口写状态。 */
  function report(reason: unknown): void { if (alive.current) setError(errorMessage(reason)); else callbacks.current.onCleanupError(errorMessage(reason)); }
  /** 失效发生在清理之前，释放失败不能复活可执行预览。 */
  async function invalidatePreview(): Promise<void> { if (planRef.current) planRef.current.invalid = true; planRef.current = null; previewRef.current = null; if (alive.current) { setPreview(null); setAcks(new Set()); } await releaseAll(true); }
  /** 重读不重套旧草稿，不重放旧DDL。 */
  async function read(): Promise<void> {
    if (mismatchRef.current || !confirmDiscard() || mismatchRef.current) return;
    const op = begin(); if (!op) return;
    try {
      await invalidatePreview(); if (sourceRef.current) sourceRef.current.invalid = true; sourceRef.current = null; snapshotRef.current = null; updateUsable(false); await releaseAll(); if (!accepts(op)) return;
      const next = await service.current.get({ ...fixed.current.target, taskId: op.taskId }); snapshots.current.add(next.snapshotId);
      if (!accepts(op) || !sameTableRenameTarget(next.target, fixed.current.target) || !current(next.expiresAt)) { await releaseOne('snapshotId', next.snapshotId); if (accepts(op)) throw new Error(text.mismatch); return; }
      snapshotRef.current = next; sourceRef.current = { value: next, target: next.target, reasons: next.reasons, warnings: next.warnings, receipt: JSON.stringify(next), invalid: false }; setSnapshot(next); setNewName(next.target.table); updateUsable(true); setUncertain(false); consumedRef.current = false; setConsumed(false); setOutcome(''); setClock(Date.now());
    } catch (reason) { report(reason); } finally { finish(op); }
  }
  /** 返回编辑释放旧预览，输入本身永远不产生SQL执行请求。 */
  async function back(): Promise<void> { if (!preview || preview !== previewRef.current || consumedRef.current) return; const op = begin(); if (!op) return; try { await invalidatePreview(); } catch (reason) { report(reason); } finally { finish(op); } }
  /** 响应必须与固定目标、原定义和当前草稿一致。 */
  async function makePreview(): Promise<void> {
    const original = snapshotRef.current, source = sourceRef.current; if (!writable || !original || snapshot !== original || !dirty || previewRef.current || renderedNameRevision !== nameRevision.current || newName !== nameRef.current || !sourceCurrent(source)) return;
    const op = begin(); if (!op) return;
    try {
      if (!current(original.expiresAt)) throw new Error(text.expired);
      const value = validateTableRenameName(newName); await invalidatePreview(); if (!accepts(op) || !sourceCurrent(source) || renderedNameRevision !== nameRevision.current) return;
      const next = await service.current.preview({ snapshotId: original.snapshotId, newName: value, taskId: op.taskId }); tokens.current.add(next.previewToken);
      if (!accepts(op) || !sourceCurrent(source) || renderedNameRevision !== nameRevision.current || !sameTableRenameTarget(next.target, fixed.current.target) || next.ddlHash !== original.ddlHash || next.before !== original.target.table || next.after !== value || !current(next.expiresAt)) { await releaseOne('previewToken', next.previewToken); if (accepts(op)) throw new Error(text.mismatch); return; }
      previewRef.current = next; planRef.current = { value: next, source, target: next.target, required: next.requiredAcknowledgements, warnings: next.warnings, receipt: JSON.stringify(next), invalid: false, consumed: false }; setPreview(next); setAcks(new Set()); setOutcome(''); setClock(Date.now());
    } catch (reason) { report(reason); } finally { finish(op); }
  }
  /** 同步消费防双击；结果回调固定原目标，卸载也不丢执行事实。 */
  async function apply(): Promise<void> {
    const next = preview, original = snapshot, owner = planRef.current;
    if (!next || !original || next !== previewRef.current || original !== snapshotRef.current || consumedRef.current || !acknowledgementsCurrent(acks, renderedAckRevision) || !tableRenameAcksComplete(next.requiredAcknowledgements, acks) || !planCurrent(owner)) return;
    const op = begin(); if (!op) return; consumedRef.current = true; owner.consumed = true; setConsumed(true); let attempted = false;
    try {
      if (!current(next.expiresAt) || !current(original.expiresAt)) throw new Error(text.expired);
      callbacks.current.beforeApply(next.after);
      if (!accepts(op) || !planCurrent(owner, true)) throw new Error(text.mismatch);
      if (!acknowledgementsCurrent(acks, renderedAckRevision) || !tableRenameAcksComplete(next.requiredAcknowledgements, acksRef.current)) throw new Error(text.acknowledgementsChanged);
      attempted = true;
      const result = await service.current.apply({ previewToken: next.previewToken, acknowledgements: [...acksRef.current], taskId: op.taskId });
      if (!sameTableRenameTarget(result.target, fixed.current.target) || result.newTarget.table !== next.after || result.newTarget.database !== fixed.current.target.database || result.newTarget.connectionId !== fixed.current.target.connectionId) throw new Error(text.mismatch);
      if (alive.current && op.guard === fence.current && !mismatchRef.current) { setNewName(original.target.table); setUncertain(!result.definitionVerified); setOutcome(result.definitionVerified ? text.succeeded : text.verificationFailed); setError([result.verificationError, ...result.warnings].filter(Boolean).join('\n')); }
      completion.current.onApplied(result);
    } catch (reason) {
      const state = tableRenameFailure(progressRef.current, attempted), stale = state !== 'notSent';
      if (alive.current && op.guard === fence.current && !mismatchRef.current) { if (progressRef.current?.ddlCompleted) setNewName(original.target.table); setOutcome(text[state]); setUncertain(stale); }
      report(reason); if (stale) completion.current.onExecutionUncertain(text[state], next.after);
    } finally { finish(op); }
  }
  /** 取消只发控制请求，原任务finally到来前保持编辑和关闭禁用。 */
  async function cancel(): Promise<void> { const taskId = fence.current.cancel(); if (!taskId) return; setCancelling(true); try { await service.current.cancel({ taskId }); } catch (reason) { report(reason); } }
  /** 明确放弃后等待令牌真正释放再关闭。 */
  async function close(): Promise<void> {
    if (!confirmDiscard()) return;
    const op = begin(true); if (!op) return;
    try { await invalidatePreview(); if (sourceRef.current) sourceRef.current.invalid = true; sourceRef.current = null; snapshotRef.current = null; updateUsable(false); await releaseAll(); if (alive.current && op.guard === fence.current) onClose(); } catch (reason) { report(reason); } finally { finish(op); }
  }
  const unsupportedAck = preview?.requiredAcknowledgements.some(id => !tableRenameAckLabel(id));
  return <Modal title={text.title} wide onClose={() => void close()}><div className="modal-content table-rename-dialog">
    <p>{fixed.current.target.database} / {fixed.current.target.table}</p><UsageHelp><p>{text.scope}</p></UsageHelp>
    {snapshot && <><div className="form-grid"><Field label={text.engine}><input readOnly value={snapshot.engine}/></Field><Field label={text.charset}><input readOnly value={snapshot.charset}/></Field><Field label={text.collation}><input readOnly value={snapshot.collation}/></Field><Field label={text.rowFormat}><input readOnly value={snapshot.rowFormat}/></Field><Field label={text.autoIncrement}><input readOnly value={snapshot.autoIncrement ?? text.unset}/></Field><Field label={text.version}><input readOnly value={snapshot.serverVersion}/></Field></div>
      {!snapshot.writable && <div role="status"><strong>{text.readonly}</strong>{snapshot.reasons.map((reason, index) => <p key={index}>{reason}</p>)}</div>}
      {snapshot.warnings.map((warning, index) => <p className="warning-text" key={index}>{warning}</p>)}
      <Field label={text.newName}><textarea aria-label={text.newName} rows={1} value={newName} disabled={busy || !writable || !!preview} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) changeName(snapshot, renderedNameRevision, event.target.value); }}/></Field>
    </>}
    {mismatch && <p role="alert">{text.targetChanged}</p>}{expired && <p role="status">{text.expired}</p>}
    {preview && <><h3>{text.fixedSql}</h3><p>{text.before}：{preview.before}</p><p>{text.after}：{preview.after}</p><SqlEditor value={preview.sql} readOnly height={180}/>{preview.requiredAcknowledgements.map(id => <label className="check" key={id}><input type="checkbox" disabled={busy || consumed || !tableRenameAckLabel(id)} checked={acks.has(id)} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) changeAcknowledgement(preview, acks, renderedAckRevision, id, event.target.checked); }}/>{tableRenameAckLabel(id) ?? text.unsupportedAck}</label>)}</>}
    {busy && <Spinner/>}{progress && <p className="table-rename-state" role="status">{text[progress.phase]}</p>}{cancelling && <p>{text.cancelling}</p>}{outcome && <p className="table-rename-outcome" role="status">{outcome}</p>}{consumed && <p>{text.consumed}</p>}<ErrorBox message={error}/>
  </div><footer className="modal-footer"><button disabled={busy || mismatch} onClick={() => void read()}>{text.read}</button><span className="grow"/>{busy && <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button>}{preview && !consumed && <button disabled={busy || mismatch} onClick={() => void back()}>{text.back}</button>}{!preview && <button disabled={busy || !writable || !dirty} onClick={() => void makePreview()}>{text.preview}</button>}{preview && <button className="primary" disabled={busy || consumed || mismatch || expired || unsupportedAck || !tableRenameAcksComplete(preview.requiredAcknowledgements, acks)} onClick={() => void apply()}>{text.apply}</button>}<button disabled={busy} onClick={() => void close()}>{text.close}</button></footer></Modal>;
}
