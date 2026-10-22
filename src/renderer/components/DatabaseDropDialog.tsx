import { useEffect, useRef, useState } from 'react';
import type { DatabaseDropTarget, DatabaseDropGetInput, DatabaseDropGetOutput, DatabaseDropPreviewInput, DatabaseDropPreviewOutput, DatabaseDropApplyInput, DatabaseDropApplyOutput, DatabaseDropReleaseInput, DatabaseDropProgress, DatabaseDropCounts } from '../../shared/databaseDrop';
import { DatabaseDropRequestFence, sameDatabaseDropTarget, databaseDropAckLabel, databaseDropAcksComplete, databaseDropFailure } from '../databaseDropUi';
import { databaseDropZh as text } from '../locales/databaseDrop.zh-CN';
import { errorMessage, uid } from '../lib';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { SqlEditor } from './SqlEditor';

export interface DatabaseDropServices {
  get(input: DatabaseDropGetInput): Promise<DatabaseDropGetOutput>;
  preview(input: DatabaseDropPreviewInput): Promise<DatabaseDropPreviewOutput>;
  apply(input: DatabaseDropApplyInput): Promise<DatabaseDropApplyOutput>;
  release(input: DatabaseDropReleaseInput): Promise<void>;
  cancel(input: { taskId: string }): Promise<void>;
  subscribe(listener: (event: { taskId: string; progress: DatabaseDropProgress }) => void): () => void;
}
export interface DatabaseDropDialogProps {
  target: DatabaseDropTarget; targetVersion: number; services: DatabaseDropServices;
  onClose(): void; onCleanupError(message: string): void; onDirtyChange(dirty: boolean): void; beforeApply(): void;
  onApplied(result: DatabaseDropApplyOutput): void; onExecutionUncertain(message: string): void;
}
type Operation = { guard: DatabaseDropRequestFence; generation: number; taskId: string };
type SnapshotOwner = { value: DatabaseDropGetOutput; target: DatabaseDropTarget; counts: DatabaseDropCounts; reasons: string[]; warnings: string[]; receipt: string; invalid: boolean };
type PreviewOwner = { value: DatabaseDropPreviewOutput; source: SnapshotOwner; target: DatabaseDropTarget; counts: DatabaseDropCounts; required: string[]; warnings: string[]; receipt: string; invalid: boolean; consumed: boolean };
const countKeys = ['tables', 'views', 'procedures', 'functions', 'triggers', 'events'] as const;
/** TTL动作检查使用真实时钟，显示刷新计时不能代替执行前复核。 */
const current = (expires: string) => Number.isFinite(Date.parse(expires)) && Date.parse(expires) > Date.now();
/** 六类对象均须有真实非负整数计数，不以缺值补零或假定数据库为空。 */
const validCounts = (counts: DatabaseDropCounts) => !!counts && countKeys.every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0);
/** 计数只是来源绑定的一部分，不能替代服务端完整目录摘要与执行前重核。 */
const sameCounts = (a: DatabaseDropCounts, b: DatabaseDropCounts) => validCounts(a) && validCounts(b) && countKeys.every(key => a[key] === b[key]);

/** 库级删除仅接受真实预览与完整原名；同步互斥先于await，永不自动重放DDL。 */
export function DatabaseDropDialog({ target, targetVersion, services, onClose, onCleanupError, onDirtyChange, beforeApply, onApplied, onExecutionUncertain }: DatabaseDropDialogProps) {
  const fixed = useRef({ target: structuredClone(target), version: targetVersion }), service = useRef(services); service.current = services;
  const callbacks = useRef({ onCleanupError, onDirtyChange, beforeApply }); callbacks.current = { onCleanupError, onDirtyChange, beforeApply };
  const completion = useRef({ onApplied, onExecutionUncertain });
  const alive = useRef(true), fence = useRef(new DatabaseDropRequestFence());
  const snapshots = useRef(new Set<string>()), tokens = useRef(new Set<string>()), releases = useRef(new Map<string, Promise<void>>());
  const snapshotRef = useRef<DatabaseDropGetOutput | null>(null), previewRef = useRef<DatabaseDropPreviewOutput | null>(null), progressRef = useRef<DatabaseDropProgress | null>(null);
  const sourceRef = useRef<SnapshotOwner | null>(null), planRef = useRef<PreviewOwner | null>(null), targetChanged = useRef(false), discardConfirmation = useRef(false);
  const consumedRef = useRef(false), [consumed, setConsumed] = useState(false);
  const [snapshot, setSnapshot] = useState<DatabaseDropGetOutput | null>(null), [preview, setPreview] = useState<DatabaseDropPreviewOutput | null>(null), [usable, setUsable] = useState(false);
  const [confirmation, setConfirmationState] = useState(''), [busy, setBusy] = useState(false), [cancelling, setCancelling] = useState(false), [uncertain, setUncertainState] = useState(false);
  const confirmationRef = useRef(confirmation), confirmationRevision = useRef(0), uncertainRef = useRef(uncertain), usableRef = useRef(usable);
  const [acks, setAcksState] = useState<ReadonlySet<string>>(new Set()), [error, setError] = useState(''), [outcome, setOutcome] = useState(''), [progress, setProgress] = useState<DatabaseDropProgress | null>(null), [clock, setClock] = useState(Date.now());
  const acksRef = useRef(acks), ackRevision = useRef(0), renderedAckRevision = ackRevision.current, renderedConfirmationRevision = confirmationRevision.current;
  if (!sameDatabaseDropTarget(fixed.current.target, target) || fixed.current.version !== targetVersion) targetChanged.current = true;
  const mismatch = targetChanged.current, mismatchRef = useRef(mismatch); mismatchRef.current = mismatch;
  const dirty = usable && (!!preview || !!confirmation), expired = !!snapshot && Date.parse(snapshot.expiresAt) <= clock || !!preview && Date.parse(preview.expiresAt) <= clock;
  const writable = usable && !!snapshot?.writable && !mismatch && !expired && !consumed;
  /** 同值输入仍换代，不能用恢复后的相同字符串复活旧执行或旧丢稿同意。 */
  function setConfirmation(value: string): void { confirmationRef.current = value; confirmationRevision.current++; setConfirmationState(value); }
  /** 未知执行事实同步保留，初始渲染留下的旧关闭事件不能降级提示。 */
  function setUncertain(value: boolean): void { uncertainRef.current = value; setUncertainState(value); }
  /** 清理等待前先同步失效，旧事件不能在释放途中重新生成预览。 */
  function updateUsable(value: boolean): void { usableRef.current = value; setUsable(value); }
  /** ACK同时绑定集合身份和单调代次，内容相同不能继承早先确认。 */
  function setAcks(value: ReadonlySet<string>): void { acksRef.current = value; ackRevision.current++; setAcksState(value); }
  /** 旧闭包不能替代当前用户确认。 */
  function acknowledgementsCurrent(expected: ReadonlySet<string>, revision: number): boolean { return acksRef.current === expected && ackRevision.current === revision; }
  /** 已观察到的来源漂移不可ABA恢复，必须重新读取获得新来源。 */
  function sourceCurrent(owner: SnapshotOwner | null): owner is SnapshotOwner {
    if (!owner || owner !== sourceRef.current || owner.invalid) return false;
    if (!alive.current || mismatchRef.current || !usableRef.current || snapshotRef.current !== owner.value || owner.target !== owner.value.target || owner.counts !== owner.value.counts || owner.reasons !== owner.value.reasons || owner.warnings !== owner.value.warnings || !current(owner.value.expiresAt) || !sameDatabaseDropTarget(owner.value.target, fixed.current.target) || !validCounts(owner.value.counts) || JSON.stringify(owner.value) !== owner.receipt) { owner.invalid = true; return false; }
    return true;
  }
  /** 预览完整绑定原读取、对象计数及ACK清单；执行消费后仅允许本请求二次核验。 */
  function planCurrent(owner: PreviewOwner | null, applying = false): owner is PreviewOwner {
    if (!owner || owner !== planRef.current || owner.invalid || owner.consumed && !applying) return false;
    if (previewRef.current !== owner.value || owner.target !== owner.value.target || owner.counts !== owner.value.counts || owner.required !== owner.value.requiredAcknowledgements || owner.warnings !== owner.value.warnings || !sourceCurrent(owner.source) || !current(owner.value.expiresAt) || JSON.stringify(owner.value) !== owner.receipt) { owner.invalid = true; return false; }
    return true;
  }
  /** 确认只属于当前预览；读取阶段没有可提前输入的删除授权。 */
  function changeConfirmation(expected: DatabaseDropPreviewOutput, revision: number, value: string): void {
    if (fence.current.busy || consumedRef.current || expected !== previewRef.current || revision !== confirmationRevision.current || !planCurrent(planRef.current)) return;
    setConfirmation(value);
  }
  /** 当前ACK事件也不能撤销或复活后继代次的勾选。 */
  function changeAcknowledgement(expected: DatabaseDropPreviewOutput, selected: ReadonlySet<string>, revision: number, id: string, checked: boolean): void {
    if (fence.current.busy || discardConfirmation.current || consumedRef.current || expected !== previewRef.current || typeof checked !== 'boolean' || !acknowledgementsCurrent(selected, revision) || !expected.requiredAcknowledgements.includes(id) || !databaseDropAckLabel(id) || !planCurrent(planRef.current)) return;
    const next = new Set(selected); if (checked) next.add(id); else next.delete(id); setAcks(next);
  }
  /** 原生丢稿确认不授权同步重入删除；任何新意图均撤销本次丢稿同意。 */
  function confirmDiscard(): boolean {
    if (!alive.current || fence.current.busy || discardConfirmation.current) return false;
    const owner = { source: sourceRef.current, snapshot: snapshotRef.current, plan: planRef.current, preview: previewRef.current, confirmation: confirmationRef.current, revision: confirmationRevision.current, ack: ackRevision.current, usable: usableRef.current, uncertain: uncertainRef.current, mismatch: mismatchRef.current, consumed: consumedRef.current, guard: fence.current };
    const changed = owner.usable && (!!owner.preview || !!owner.confirmation);
    discardConfirmation.current = true;
    try {
      const accepted = !(changed || owner.uncertain) || window.confirm(owner.uncertain ? text.unknownClose : text.discard);
      return accepted && alive.current && !fence.current.busy && owner.guard === fence.current && owner.source === sourceRef.current && owner.snapshot === snapshotRef.current && owner.plan === planRef.current && owner.preview === previewRef.current && owner.confirmation === confirmationRef.current && owner.revision === confirmationRevision.current && owner.ack === ackRevision.current && owner.usable === usableRef.current && owner.uncertain === uncertainRef.current && owner.mismatch === mismatchRef.current && owner.consumed === consumedRef.current;
    } finally { discardConfirmation.current = false; }
  }
  useEffect(() => { onDirtyChange(dirty || uncertain); }, [dirty, uncertain, onDirtyChange]);
  useEffect(() => () => callbacks.current.onDirtyChange(false), []);
  useEffect(() => {
    const guard = new DatabaseDropRequestFence(); fence.current = guard; alive.current = true; void read();
    return () => { alive.current = false; const taskId = guard.dispose(); if (taskId) void service.current.cancel({ taskId }).catch(reason => callbacks.current.onCleanupError(errorMessage(reason))); void releaseAll().catch(reason => callbacks.current.onCleanupError(errorMessage(reason))); };
  }, []);
  useEffect(() => services.subscribe(event => { if (alive.current && event.taskId === fence.current.taskId) { progressRef.current = event.progress; setProgress(event.progress); } }), [services]);
  useEffect(() => {
    const deadlines = [snapshot?.expiresAt, preview?.expiresAt].filter((value): value is string => !!value).map(Date.parse).filter(Number.isFinite); if (!deadlines.length) return;
    setClock(Date.now()); const deadline = Math.min(...deadlines); if (deadline > Date.now()) { const timer = window.setTimeout(() => setClock(Date.now()), Math.min(deadline - Date.now() + 1, 2147483647)); return () => window.clearTimeout(timer); }
  }, [snapshot?.expiresAt, preview?.expiresAt]);
  useEffect(() => { const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } }; document.addEventListener('keydown', block, true); return () => document.removeEventListener('keydown', block, true); }, []);

  /** 先登记清理责任，迟到响应及并发清理也不漏独立令牌。 */
  async function releaseOne(kind: 'snapshotId' | 'previewToken', id: string): Promise<void> {
    const set = kind === 'snapshotId' ? snapshots.current : tokens.current, key = kind + ':' + id; set.add(id);
    let request = releases.current.get(key);
    if (!request) { request = Promise.resolve().then(() => service.current.release({ [kind]: id })).then(() => { set.delete(id); }); releases.current.set(key, request); }
    try { await request; } finally { if (releases.current.get(key) === request) releases.current.delete(key); }
  }
  /** 单项失败仍继续释放其他资源，失败项保留供用户明确重试清理。 */
  async function releaseAll(previewsOnly = false): Promise<void> {
    const failures: string[] = [];
    for (const id of [...tokens.current]) try { await releaseOne('previewToken', id); } catch (reason) { failures.push(errorMessage(reason)); }
    if (!previewsOnly) for (const id of [...snapshots.current]) try { await releaseOne('snapshotId', id); } catch (reason) { failures.push(errorMessage(reason)); }
    if (failures.length) throw new Error(failures.join('\n'));
  }
  /** 同步占用操作，避免同渲染双击或确认回调重入。 */
  function begin(allowMismatch = false): Operation | undefined {
    if (!alive.current || discardConfirmation.current || mismatchRef.current && !allowMismatch) return;
    const guard = fence.current, token = guard.begin(uid()); if (!token) return;
    setBusy(true); setCancelling(false); setError(''); setProgress(null); progressRef.current = null; return { guard, ...token };
  }
  /** 取消只撤销响应接受权，不代表原任务已经结束。 */
  function accepts(op: Operation): boolean { return alive.current && op.guard === fence.current && op.guard.accepts(op) && !mismatchRef.current; }
  /** 仅原任务真实settled后解锁，旧finally不能解锁后继任务。 */
  function finish(op: Operation): void { op.guard.finish(op); if (alive.current && op.guard === fence.current) setBusy(false); }
  /** 卸载后的清理失败仍向父级报告，不向已卸载窗口写状态。 */
  function report(reason: unknown): void { if (alive.current) setError(errorMessage(reason)); else callbacks.current.onCleanupError(errorMessage(reason)); }
  /** 清理前先同步撤销预览授权，释放失败也不能复活旧确认。 */
  function clearPreview(): void { if (planRef.current) planRef.current.invalid = true; planRef.current = null; previewRef.current = null; if (alive.current) { setPreview(null); setAcks(new Set()); setConfirmation(''); } }
  /** 返回核验保留原快照，仅释放所有预览令牌。 */
  async function invalidatePreview(): Promise<void> { clearPreview(); await releaseAll(true); }
  /** 关闭或重读时一次登记全部清理责任，预览释放失败也不跳过快照。 */
  async function invalidateAll(): Promise<void> { clearPreview(); if (sourceRef.current) sourceRef.current.invalid = true; sourceRef.current = null; snapshotRef.current = null; updateUsable(false); await releaseAll(); }
  /** 重新读取不恢复旧确认或自动重放先前删除。 */
  async function read(): Promise<void> {
    if (mismatchRef.current || !confirmDiscard() || mismatchRef.current) return;
    const op = begin(); if (!op) return;
    try {
      await invalidateAll(); if (!accepts(op)) return;
      const next = await service.current.get({ ...fixed.current.target, taskId: op.taskId }); snapshots.current.add(next.snapshotId);
      if (!accepts(op) || !sameDatabaseDropTarget(next.target, fixed.current.target) || !validCounts(next.counts) || !current(next.expiresAt)) { await releaseOne('snapshotId', next.snapshotId); if (accepts(op)) throw new Error(text.mismatch); return; }
      snapshotRef.current = next; sourceRef.current = { value: next, target: next.target, counts: next.counts, reasons: next.reasons, warnings: next.warnings, receipt: JSON.stringify(next), invalid: false }; setSnapshot(next); updateUsable(true); setUncertain(false); consumedRef.current = false; setConsumed(false); setOutcome(''); setClock(Date.now());
    } catch (reason) { report(reason); } finally { finish(op); }
  }
  /** 返回核验只释放当前预览；旧返回事件不得移除后继预览。 */
  async function back(): Promise<void> { if (!preview || preview !== previewRef.current || consumedRef.current) return; const op = begin(); if (!op) return; try { await invalidatePreview(); } catch (reason) { report(reason); } finally { finish(op); } }
  /** 服务端生成固定SQL，响应必须与原目录摘要及六类计数完全一致。 */
  async function makePreview(): Promise<void> {
    const original = snapshotRef.current, source = sourceRef.current; if (!writable || !original || snapshot !== original || previewRef.current || !sourceCurrent(source)) return;
    const op = begin(); if (!op) return;
    try {
      if (!current(original.expiresAt)) throw new Error(text.expired);
      await invalidatePreview(); if (!accepts(op) || !sourceCurrent(source)) return;
      const next = await service.current.preview({ snapshotId: original.snapshotId, taskId: op.taskId }); tokens.current.add(next.previewToken);
      if (!accepts(op) || !sourceCurrent(source) || !sameDatabaseDropTarget(next.target, fixed.current.target) || next.catalogDigest !== original.catalogDigest || !sameCounts(next.counts, original.counts) || !current(next.expiresAt)) { await releaseOne('previewToken', next.previewToken); if (accepts(op)) throw new Error(text.mismatch); return; }
      previewRef.current = next; planRef.current = { value: next, source, target: next.target, counts: next.counts, required: next.requiredAcknowledgements, warnings: next.warnings, receipt: JSON.stringify(next), invalid: false, consumed: false }; setPreview(next); setAcks(new Set()); setConfirmation(''); setOutcome(''); setClock(Date.now());
    } catch (reason) { report(reason); } finally { finish(op); }
  }
  /** 同步消费令牌防双击；父守卫返回后重核完整来源、精确原名和ACK代次。 */
  async function apply(): Promise<void> {
    const next = preview, original = snapshot, owner = planRef.current;
    if (!next || !original || next !== previewRef.current || original !== snapshotRef.current || consumedRef.current || renderedConfirmationRevision !== confirmationRevision.current || confirmation !== confirmationRef.current || confirmation !== fixed.current.target.database || !acknowledgementsCurrent(acks, renderedAckRevision) || !databaseDropAcksComplete(next.requiredAcknowledgements, acks) || !planCurrent(owner)) return;
    const op = begin(); if (!op) return; consumedRef.current = true; owner.consumed = true; setConsumed(true); let attempted = false;
    try {
      if (!current(next.expiresAt) || !current(original.expiresAt)) throw new Error(text.expired);
      callbacks.current.beforeApply();
      if (!accepts(op) || !planCurrent(owner, true)) throw new Error(text.mismatch);
      if (renderedConfirmationRevision !== confirmationRevision.current || confirmation !== confirmationRef.current || confirmationRef.current !== fixed.current.target.database || !acknowledgementsCurrent(acks, renderedAckRevision) || !databaseDropAcksComplete(next.requiredAcknowledgements, acksRef.current)) throw new Error(text.acknowledgementsChanged);
      attempted = true;
      const result = await service.current.apply({ previewToken: next.previewToken, confirmation: confirmationRef.current, acknowledgements: [...acksRef.current], taskId: op.taskId });
      if (!sameDatabaseDropTarget(result.target, fixed.current.target) || result.ddlSubmitted !== true || result.ddlCompleted !== true || result.definitionVerified && result.after?.databaseAbsent !== true) throw new Error(text.mismatch);
      if (alive.current && op.guard === fence.current && !mismatchRef.current) { setUncertain(!result.definitionVerified); setOutcome(result.definitionVerified ? text.succeeded : text.verificationFailed); setError([result.verificationError, ...result.warnings].filter(Boolean).join('\n')); }
      // 回执已证明执行完成；父级投影异常只能报告，不能把完成事实降级成可重试失败。
      try { completion.current.onApplied(result); } catch (reason) { callbacks.current.onCleanupError(errorMessage(reason)); }
    } catch (reason) {
      const state = databaseDropFailure(progressRef.current, attempted), stale = state !== 'notSent';
      if (alive.current && op.guard === fence.current && !mismatchRef.current) { setOutcome(text[state]); setUncertain(stale); }
      report(reason); if (stale) completion.current.onExecutionUncertain(text[state]);
    } finally {
      // 原apply结算后立即精确释放已消费能力；失败保留清理责任与执行事实，关闭时可重试清理。
      if (attempted) try { await releaseAll(); } catch (reason) { callbacks.current.onCleanupError(errorMessage(reason)); }
      finish(op);
    }
  }
  /** 请求取消后仍等待原任务结算，不能提前关闭或再次提交删除。 */
  async function cancel(): Promise<void> { const taskId = fence.current.cancel(); if (!taskId) return; setCancelling(true); try { await service.current.cancel({ taskId }); } catch (reason) { report(reason); } }
  /** 明确放弃后等待所有令牌释放；某项失败保留窗口和清理责任。 */
  async function close(): Promise<void> {
    if (!confirmDiscard()) return;
    const op = begin(true); if (!op) return;
    try { await invalidateAll(); if (alive.current && op.guard === fence.current) onClose(); } catch (reason) { report(reason); } finally { finish(op); }
  }
  const unsupportedAck = preview?.requiredAcknowledgements.some(id => !databaseDropAckLabel(id));
  return <Modal title={text.title} wide onClose={() => void close()}><div className="modal-content database-drop-dialog">
    <Field label={text.database}><input readOnly value={fixed.current.target.database}/></Field><p className="muted small">{text.scope}</p><p className="warning-text">{text.risk}</p>
    {snapshot && <><div className="form-grid"><Field label={text.charset}><input readOnly value={snapshot.charset}/></Field><Field label={text.collation}><input readOnly value={snapshot.collation}/></Field><Field label={text.version}><input readOnly value={snapshot.serverVersion}/></Field></div>
      {snapshot.writable ? <><h3>{text.counts}</h3><dl className="form-grid">{countKeys.map(key => <div key={key}><dt>{text[key]}</dt><dd>{snapshot.counts[key]}</dd></div>)}</dl></> : <p role="status">{text.countsUnavailable}</p>}
      {!snapshot.writable && <div role="status"><strong>{text.readonly}</strong>{snapshot.reasons.map((reason, index) => <p key={index}>{reason}</p>)}</div>}{snapshot.warnings.map((warning, index) => <p className="warning-text" key={index}>{warning}</p>)}
    </>}
    {mismatch && <p role="alert">{text.targetChanged}</p>}{expired && <p role="status">{text.expired}</p>}
    {preview && <><h3>{text.fixedSql}</h3><SqlEditor value={preview.sql} readOnly height={140}/>{preview.warnings.map((warning, index) => <p className="warning-text" key={index}>{warning}</p>)}<Field label={text.confirmation}><textarea aria-label={text.confirmation} rows={1} autoComplete="off" spellCheck={false} value={confirmation} disabled={busy || !writable} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) changeConfirmation(preview, renderedConfirmationRevision, event.target.value); }}/></Field><p className="muted small">{text.exactName}</p>{preview.requiredAcknowledgements.map((id, index) => <label className="check" key={`${index}:${id}`}><input type="checkbox" disabled={busy || consumed || !databaseDropAckLabel(id)} checked={acks.has(id)} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) changeAcknowledgement(preview, acks, renderedAckRevision, id, event.target.checked); }}/>{databaseDropAckLabel(id) ?? text.unsupportedAck}</label>)}</>}
    {busy && <Spinner/>}{progress && <p className="database-drop-state" role="status">{text[progress.phase]}</p>}{cancelling && <p>{text.cancelling}</p>}{outcome && <p className="database-drop-outcome" role="status">{outcome}</p>}{consumed && <p>{text.consumed}</p>}<ErrorBox message={error}/>
  </div><footer className="modal-footer"><button disabled={busy || mismatch} onClick={() => void read()}>{text.read}</button><span className="grow"/>{busy && <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button>}{preview && !consumed && <button disabled={busy || mismatch} onClick={() => void back()}>{text.back}</button>}{!preview && <button disabled={busy || !writable} onClick={() => void makePreview()}>{text.preview}</button>}{preview && <button className="danger" disabled={busy || consumed || mismatch || expired || unsupportedAck || confirmation !== fixed.current.target.database || !databaseDropAcksComplete(preview.requiredAcknowledgements, acks)} onClick={() => void apply()}>{text.apply}</button>}<button disabled={busy} onClick={() => void close()}>{text.close}</button></footer></Modal>;
}
