import { useEffect, useRef, useState } from 'react';
import type { ForeignKeyAction, ForeignKeyDefinition, ForeignKeyPatch } from '../../shared/tableForeignKeyPatches';
import { tableForeignKeyPatchLimits } from '../../shared/tableForeignKeyPatches';
import { foreignKeyTaskLimits, type ForeignKeyTableTarget, type TableForeignKeyApplyInput, type TableForeignKeyApplyOutput, type TableForeignKeyApplyProgress, type TableForeignKeyGetInput, type TableForeignKeyGetOutput, type TableForeignKeyPreviewInput, type TableForeignKeyPreviewOutput, type TableForeignKeyReleaseInput, type TableForeignKeyTarget, type TableForeignKeyView } from '../../shared/tableForeignKeyTasks';
import { ForeignKeyRequestFence, ForeignKeyResourceLedger, addForeignKeyParentTarget, assertForeignKeyResponse, changeForeignKeyParent, foreignKeyAcknowledgementLabel, foreignKeyAcknowledgementsComplete, foreignKeyActionLabel, foreignKeyColumnSelectable, foreignKeyEditable, foreignKeyExecutionEffect, foreignKeyFailureState, foreignKeyProtectedTargets, foreignKeyTokenCurrent, makeForeignKeyAlter, moveForeignKeyPair, sameForeignKeyTarget, setForeignKeyPatch, validateForeignKeyDrafts } from '../foreignKeyPatches';
import { errorMessage, uid } from '../lib';
import { formatText } from '../locales/zh-CN';
import { foreignKeyPatchZh as text } from '../locales/foreignKeyPatches.zh-CN';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';
import { SqlEditor } from './SqlEditor';
import '../foreignKeyPatches.css';

/** 服务由宿主注入；组件只编辑结构化差异，不拼接 SQL 或复用查询事务。 */
export interface ForeignKeyPatchServices {
  get(input: TableForeignKeyGetInput): Promise<TableForeignKeyGetOutput>;
  preview(input: TableForeignKeyPreviewInput): Promise<TableForeignKeyPreviewOutput>;
  apply(input: TableForeignKeyApplyInput): Promise<TableForeignKeyApplyOutput>;
  release(input: TableForeignKeyReleaseInput): Promise<void>;
  cancel(input: { taskId: string }): Promise<void>;
  subscribe?(listener: (event: { taskId: string; progress: TableForeignKeyApplyProgress }) => void): () => void;
}
export interface ForeignKeyPatchDialogProps {
  target: TableForeignKeyTarget; targetVersion: number; services: ForeignKeyPatchServices;
  onClose(): void; onCleanupError(message: string): void; onDirtyChange(dirty: boolean): void;
  onApplied(result: TableForeignKeyApplyOutput): void;
  /** 执行前同步保护子表及全部已加载父表；回调抛错时不发送 apply。 */
  beforeApply(targets?: TableForeignKeyTarget[]): void;
  onExecutionUncertain(message: string): void;
}
interface EditRow { key: string; original?: TableForeignKeyView; definition: ForeignKeyDefinition; }
interface Operation { guard: ForeignKeyRequestFence; generation: number; taskId: string; }
interface Confirmation { message: string; run(): void; }

/** 窗口固定目标和连接版本；一次预览只允许一次 apply，取消等待原请求和释放终态。 */
export function ForeignKeyPatchDialog({ target, targetVersion, services, onClose, onCleanupError, onDirtyChange, onApplied, beforeApply, onExecutionUncertain }: ForeignKeyPatchDialogProps) {
  const fixed = useRef({ target: structuredClone(target), version: targetVersion });
  const service = useRef(services); service.current = services;
  // 结果回调固定到最初目标；配置变化后不能将旧 DDL 的事实刷新到另一服务器。
  const completion = useRef({ onApplied, onExecutionUncertain });
  const beforeApplyRef = useRef(beforeApply); beforeApplyRef.current = beforeApply;
  const cleanupError = useRef(onCleanupError); cleanupError.current = onCleanupError;
  const dirtyCallback = useRef(onDirtyChange); dirtyCallback.current = onDirtyChange;
  const fence = useRef(new ForeignKeyRequestFence()), alive = useRef(true);
  const resources = useRef(new ForeignKeyResourceLedger(input => service.current.release(input)));
  const snapshotRef = useRef<TableForeignKeyGetOutput | null>(null), previewRef = useRef<TableForeignKeyPreviewOutput | null>(null);
  const [snapshot, setSnapshot] = useState<TableForeignKeyGetOutput | null>(null), [preview, setPreview] = useState<TableForeignKeyPreviewOutput | null>(null);
  const [patches, setPatches] = useState<ForeignKeyPatch[]>([]), [editor, setEditor] = useState<EditRow | null>(null);
  const [parents, setParents] = useState<ForeignKeyTableTarget[]>([]), [parentDatabase, setParentDatabase] = useState(target.database), [parentTable, setParentTable] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null), confirmationRef = useRef<Confirmation | null>(null);
  const [snapshotUsable, setSnapshotUsable] = useState(false), [busy, setBusy] = useState(false), [cancelling, setCancelling] = useState(false);
  const [acks, setAcks] = useState<ReadonlySet<string>>(new Set()), [consumed, setConsumed] = useState(false), consumedRef = useRef(false);
  const [error, setError] = useState(''), [outcome, setOutcome] = useState(''), [executionUncertain, setExecutionUncertain] = useState(false);
  const [progress, setProgress] = useState<TableForeignKeyApplyProgress | null>(null), progressRef = useRef<TableForeignKeyApplyProgress | null>(null);
  const [clock, setClock] = useState(Date.now());
  const mismatch = !sameForeignKeyTarget(fixed.current.target, target) || fixed.current.version !== targetVersion;
  const mismatchRef = useRef(mismatch); mismatchRef.current = mismatch;
  const snapshotExpired = !!snapshot && !foreignKeyTokenCurrent(snapshot.expiresAt, clock), previewExpired = !!preview && !foreignKeyTokenCurrent(preview.expiresAt, clock);
  const writable = snapshotUsable && !!snapshot?.writable && !!snapshot.capabilities && !snapshotExpired;
  const editingDisabled = busy || mismatch || !writable || !!preview || !!confirmation;

  useEffect(() => { onDirtyChange(patches.length > 0 || editor !== null); }, [patches, editor, onDirtyChange]);
  useEffect(() => () => dirtyCallback.current(false), []);
  useEffect(() => {
    // StrictMode 的旧异步回调仍持有旧围栏，重挂载不能使它重新获得投影权。
    const guard = new ForeignKeyRequestFence(); fence.current = guard; alive.current = true; void read([]);
    return () => {
      alive.current = false; const taskId = guard.dispose();
      if (taskId) void service.current.cancel({ taskId }).catch(reason => cleanupError.current(errorMessage(reason)));
      void resources.current.releaseAll(true).catch(reason => cleanupError.current(formatText(text.releaseFailed, errorMessage(reason))));
    };
  }, []);
  useEffect(() => services.subscribe?.(event => {
    if (alive.current && event.taskId === fence.current.taskId) { progressRef.current = event.progress; setProgress(event.progress); }
  }), [services]);
  useEffect(() => {
    const deadlines = [snapshot?.expiresAt, preview?.expiresAt].filter((value): value is string => value !== undefined).map(Date.parse).filter(Number.isFinite);
    if (!deadlines.length) return;
    const now = Date.now(), deadline = Math.min(...deadlines); setClock(now);
    if (deadline > now) { const timer = window.setTimeout(() => setClock(Date.now()), Math.min(deadline - now + 1, 2147483647)); return () => window.clearTimeout(timer); }
  }, [snapshot?.expiresAt, preview?.expiresAt]);
  useEffect(() => {
    /** 模态编辑和预览期间禁止快捷键穿透到后台 SQL 标签。 */
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true); return () => document.removeEventListener('keydown', block, true);
  }, []);

  /** 旧预览立即不可执行，只有实际释放成功才从责任集合删除。 */
  async function invalidatePreview(): Promise<void> { previewRef.current = null; if (alive.current) { setPreview(null); setAcks(new Set()); } await resources.current.releaseAll(false); }
  /** 保留旧定义用于核对；释放失败不抹掉责任集合，也不继续读取新快照。 */
  async function invalidateSnapshot(): Promise<void> { snapshotRef.current = null; if (alive.current) setSnapshotUsable(false); await resources.current.releaseAll(true); }
  /** 同步互斥发生在首个 await 前，确认面板未回答时不接受后台动作。 */
  function begin(allowMismatch = false): Operation | undefined {
    if (confirmationRef.current || (mismatchRef.current && !allowMismatch)) return;
    const guard = fence.current, operation = guard.begin(uid()); if (!operation) return;
    setBusy(true); setCancelling(false); setError(''); setProgress(null); progressRef.current = null;
    return { ...operation, guard };
  }
  /** 取消、卸载、目标变化或旧代次结果只能清理，不能成为可执行预览。 */
  function accepts(operation: Operation): boolean { return alive.current && operation.guard === fence.current && operation.guard.accepts(operation) && !mismatchRef.current; }
  /** 只有原请求 settled 才解锁；取消 IPC 已返回仍不能重入或关闭。 */
  function finish(operation: Operation): void { operation.guard.finish(operation); if (alive.current && operation.guard === fence.current) setBusy(false); }
  /** 活动窗口显示错误，卸载后的失败报告宿主，避免吞掉资源清理失败。 */
  function report(reason: unknown, operation?: Operation): void { if (alive.current && (!operation || operation.guard === fence.current)) setError(errorMessage(reason)); else cleanupError.current(errorMessage(reason)); }
  /** 所有放弃确认留在当前对话框；等待答案时不改变草稿或令牌。 */
  function ask(message: string, run: () => void): void { if (fence.current.busy || confirmationRef.current) return; const value = { message, run }; confirmationRef.current = value; setConfirmation(value); }
  /** 先同步清确认锁再运行明确授权的动作；取消保持全部原数据。 */
  function answerConfirmation(proceed: boolean): void { const value = confirmationRef.current; confirmationRef.current = null; setConfirmation(null); if (proceed) value?.run(); }
  /** 对重读请求捕获完整父目标列表，确认期间输入变化不能改变即将读取的对象。 */
  function requestRead(nextParents = parents): void {
    if (fence.current.busy || mismatchRef.current || confirmationRef.current) return;
    const captured = nextParents.map(value => ({ ...value }));
    if (patches.length || editor || executionUncertain) ask(executionUncertain ? text.closeUnknown : text.discard, () => void read(captured));
    else void read(captured);
  }
  /** 先释放全部旧资源，再读取新快照；只有接受新快照时才真正丢弃旧草稿。 */
  async function read(nextParents: ForeignKeyTableTarget[]): Promise<void> {
    const operation = begin(); if (!operation) return;
    try {
      await invalidatePreview(); await invalidateSnapshot(); if (!accepts(operation)) return;
      const next = await service.current.get({ ...fixed.current.target, parentTargets: nextParents, taskId: operation.taskId }); resources.current.track('snapshotId', next.snapshotId);
      if (!accepts(operation)) { await resources.current.release('snapshotId', next.snapshotId); return; }
      try { assertForeignKeyResponse(next, fixed.current.target); } catch (reason) { await resources.current.release('snapshotId', next.snapshotId); throw reason; }
      snapshotRef.current = next; setSnapshot(next); setSnapshotUsable(true); setPatches([]); setEditor(null); setParents(nextParents); setParentTable('');
      consumedRef.current = false; setConsumed(false); setOutcome(''); setExecutionUncertain(false); setClock(Date.now());
    } catch (reason) { report(reason, operation); } finally { finish(operation); }
  }
  /** 输入只描述真实父表目标，不按子表字段名自动猜测父表。 */
  function loadParent(): void { try { requestRead(addForeignKeyParentTarget(parents, { database: parentDatabase, table: parentTable })); } catch (reason) { report(reason); } }
  /** 固定预览只能来自当前快照，迟到或失配的令牌立即登记并释放。 */
  async function makePreview(): Promise<void> {
    const current = snapshotRef.current; if (!current || !snapshotUsable || editor || !writable || previewRef.current) return;
    const operation = begin(); if (!operation) return;
    try {
      if (!foreignKeyTokenCurrent(current.expiresAt)) throw new Error(text.expired);
      const input = validateForeignKeyDrafts(current, patches); await invalidatePreview(); if (!accepts(operation)) return;
      const next = await service.current.preview({ snapshotId: current.snapshotId, patches: input, taskId: operation.taskId }); resources.current.track('previewToken', next.previewToken);
      if (!accepts(operation)) { await resources.current.release('previewToken', next.previewToken); return; }
      try { assertForeignKeyResponse(next, fixed.current.target, current.ddlHash); } catch (reason) { await resources.current.release('previewToken', next.previewToken); throw reason; }
      previewRef.current = next; setPreview(next); setAcks(new Set()); consumedRef.current = false; setConsumed(false); setOutcome(''); setClock(Date.now());
    } catch (reason) { report(reason, operation); } finally { finish(operation); }
  }
  /** 同步消费令牌并检查所有父子表页；只投递一次，失败或取消后均不重放。 */
  async function apply(): Promise<void> {
    const current = previewRef.current, original = snapshotRef.current;
    if (!current || !original || !snapshotUsable || !original.writable || !original.capabilities || consumedRef.current || !foreignKeyAcknowledgementsComplete(current.requiredAcknowledgements, acks)) return;
    const operation = begin(); if (!operation) return; consumedRef.current = true; setConsumed(true); let attempted = false;
    try {
      assertForeignKeyResponse(current, fixed.current.target, original.ddlHash);
      if (!foreignKeyTokenCurrent(original.expiresAt)) throw new Error(text.expired);
      beforeApplyRef.current(foreignKeyProtectedTargets(original)); if (!accepts(operation)) return;
      attempted = true;
      const result = await service.current.apply({ previewToken: current.previewToken, acknowledgements: current.requiredAcknowledgements.slice(), taskId: operation.taskId });
      const effect = foreignKeyExecutionEffect({ kind: 'resolved', result });
      if (alive.current && operation.guard === fence.current) {
        setOutcome(result.definitionVerified ? text.succeeded : text.verificationFailed); setExecutionUncertain(effect.page === 'stale');
        if (effect.clearDrafts) { setPatches([]); setEditor(null); dirtyCallback.current(false); }
        setError([result.verificationError, ...result.warnings].filter(Boolean).join('\n'));
      }
      // 取消或卸载不能抹掉已完成 DDL 的事实，宿主回调仍对应原目标。
      try { completion.current.onApplied(result); } catch (reason) { report(reason, operation); }
    } catch (reason) {
      const state = progressRef.current, status = attempted ? foreignKeyFailureState(state) : 'notSent', effect = foreignKeyExecutionEffect({ kind: 'rejected', progress: state, attempted });
      if (alive.current && operation.guard === fence.current) {
        setOutcome(text[status]); setExecutionUncertain(effect.page === 'stale'); setError(errorMessage(reason));
        if (effect.clearDrafts) { setPatches([]); setEditor(null); dirtyCallback.current(false); }
      } else cleanupError.current(errorMessage(reason));
      if (effect.page === 'stale') try { completion.current.onExecutionUncertain(text[status]); } catch (callbackError) { report(callbackError, operation); }
    } finally { finish(operation); }
  }
  /** 一次取消只发一个控制请求，主任务释放结束前保持 busy。 */
  async function cancel(): Promise<void> { const taskId = fence.current.cancel(); if (!taskId) return; setCancelling(true); try { await service.current.cancel({ taskId }); } catch (reason) { report(reason); } }
  /** 本行切换要求在弹窗内明确放弃，稳定来源引用不会被显示名碰撞替换。 */
  function openEditor(next: EditRow): void { if (editingDisabled || fence.current.busy) return; if (editor) ask(text.discardEditor, () => setEditor(next)); else setEditor(next); }
  /** 旧外键只合并自己的差异，未知定义不允许猜测父子映射。 */
  function edit(value: TableForeignKeyView): void {
    if (!foreignKeyEditable(value)) return;
    const patch = patches.find(item => item.op !== 'add' && item.foreignKeyRef === value.foreignKeyRef); if (patch?.op === 'drop') return;
    openEditor({ key: value.foreignKeyRef, original: value, definition: structuredClone({ ...value.editableDefinition!, ...(patch?.op === 'alter' ? patch.changes : {}) }) });
  }
  /** 新草稿显式使用服务器已验证默认动作，绝不猜测版本默认行为。 */
  function add(): void {
    if (!snapshot?.capabilities || editingDisabled || fence.current.busy) return;
    const child = snapshot.columns.find(foreignKeyColumnSelectable), parent = snapshot.parents.find(value => value.columns.some(foreignKeyColumnSelectable)), parentColumn = parent?.columns.find(foreignKeyColumnSelectable);
    if (!child || !parent || !parentColumn) { setError(text.noColumns); return; }
    openEditor({ key: uid(), definition: { name: '', parentRef: parent.parentRef, pairs: [{ childColumnRef: child.columnRef, parentColumnRef: parentColumn.columnRef }], onUpdate: snapshot.capabilities.defaultAction, onDelete: snapshot.capabilities.defaultAction } });
  }
  /** 保存仅更新本地补丁；空操作撤销原差异，整批校验通过才能离开本行编辑。 */
  function saveRow(): void {
    if (!snapshot || !editor || editingDisabled || fence.current.busy) return;
    try {
      const next = editor.original ? makeForeignKeyAlter(editor.original, editor.definition) : { op: 'add' as const, clientKey: editor.key, definition: editor.definition };
      const updated = setForeignKeyPatch(patches, editor.key, next, editor.original ? 'existing' : 'added'); if (updated.length) validateForeignKeyDrafts(snapshot, updated);
      setPatches(updated); setEditor(null); setError('');
    } catch (reason) { report(reason); }
  }
  /** 删除始终先说明约束影响，确认后只生成草稿，不执行 SQL。 */
  function drop(value: TableForeignKeyView): void {
    if (!snapshot || editingDisabled || fence.current.busy || !value.access.drop.allowed) return;
    ask(`${text.deleteRisk}${editor ? `\n${text.discardEditor}` : ''}`, () => {
      try { const next = setForeignKeyPatch(patches, value.foreignKeyRef, { op: 'drop', foreignKeyRef: value.foreignKeyRef }); validateForeignKeyDrafts(snapshot, next); setPatches(next); setEditor(null); setError(''); } catch (reason) { report(reason); }
    });
  }
  /** 撤销只针对选定来源，不丢其他尚未应用的本行输入。 */
  function undo(key: string, source: 'existing' | 'added'): void {
    if (editingDisabled || fence.current.busy) return;
    const run = () => { setPatches(setForeignKeyPatch(patches, key, null, source)); if (editor?.key === key && !!editor.original === (source === 'existing')) setEditor(null); };
    if (editor?.key === key && !!editor.original === (source === 'existing')) ask(text.discardEditor, run); else run();
  }
  /** 返回编辑先让旧预览失效并等待真实释放，失败集合保留至后续清理。 */
  async function back(): Promise<void> { if (consumedRef.current) return; const operation = begin(); if (!operation) return; try { await invalidatePreview(); } catch (reason) { report(reason, operation); } finally { finish(operation); } }
  /** 关闭前明确处理草稿或未知执行结果；Escape 在确认面板中只取消确认。 */
  function requestClose(): void {
    if (fence.current.busy) return;
    if (confirmationRef.current) { answerConfirmation(false); return; }
    if (patches.length || editor || executionUncertain) ask(executionUncertain ? text.closeUnknown : text.discard, () => void close()); else void close();
  }
  /** 必须释放成功才关闭；失败不能丢弃持有的资源责任。 */
  async function close(): Promise<void> { const operation = begin(true); if (!operation) return; try { await invalidatePreview(); await invalidateSnapshot(); onClose(); } catch (reason) { report(reason, operation); } finally { finish(operation); } }
  /** 仅活动编辑行接受输入，所有执行或确认中的输入均冻结。 */
  function changeEditor(value: ForeignKeyDefinition): void { if (editor && !editingDisabled && !fence.current.busy) setEditor({ ...editor, definition: value }); }
  /** 追加一对未使用的普通字段；多余映射不会截断或复用已有引用。 */
  function addPair(): void {
    if (!editor || !snapshot || editingDisabled || fence.current.busy || editor.definition.pairs.length >= tableForeignKeyPatchLimits.keyParts) return;
    const parent = snapshot.parents.find(value => value.parentRef === editor.definition.parentRef);
    const child = snapshot.columns.find(value => foreignKeyColumnSelectable(value) && !editor.definition.pairs.some(pair => pair.childColumnRef === value.columnRef));
    const column = parent?.columns.find(value => foreignKeyColumnSelectable(value) && !editor.definition.pairs.some(pair => pair.parentColumnRef === value.columnRef));
    if (child && column) changeEditor({ ...editor.definition, pairs: [...editor.definition.pairs, { childColumnRef: child.columnRef, parentColumnRef: column.columnRef }] });
  }
  const selectedParent = snapshot?.parents.find(value => value.parentRef === editor?.definition.parentRef);
  const canAddPair = !!editor && !!snapshot && editor.definition.pairs.length < tableForeignKeyPatchLimits.keyParts && snapshot.columns.some(value => foreignKeyColumnSelectable(value) && !editor.definition.pairs.some(pair => pair.childColumnRef === value.columnRef)) && selectedParent?.columns.some(value => foreignKeyColumnSelectable(value) && !editor.definition.pairs.some(pair => pair.parentColumnRef === value.columnRef));

  return <Modal title={text.title} wide onClose={requestClose}><div className="modal-content foreign-key-patch-content">
    <strong>{fixed.current.target.database} / {fixed.current.target.table}</strong>
    <p className="muted small">{snapshot?.capabilities ? `${snapshot.capabilities.dialect} ${snapshot.capabilities.serverVersion}` : text.capabilityUnknown}</p>
    <p className="warning-text">{text.maintenance}</p><p className="warning-text">{text.ddl}</p><UsageHelp><p>{text.requirements}</p></UsageHelp>
    {mismatch && <ErrorBox message={text.targetChanged}/>}{(snapshotExpired || previewExpired) && <ErrorBox message={text.expired}/>}
    {confirmation && <section className="foreign-key-patch-confirm" role="alertdialog" aria-label={text.confirmTitle}><h3>{text.confirmTitle}</h3><p>{confirmation.message}</p><div><button onClick={() => answerConfirmation(false)}>{text.confirmCancel}</button><button className="primary" onClick={() => answerConfirmation(true)}>{text.confirmContinue}</button></div></section>}
    {snapshot && (!snapshot.writable || !snapshot.capabilities) && <p className="warning-text">{text.readonlyTable}</p>}
    {snapshot?.incomingCoverage.kind === 'partial' && <p className="warning-text">{text.incomingPartial}</p>}
    {snapshot?.namespaceCoverage === 'partial' && <p className="warning-text">{text.namespacePartial}</p>}
    {!preview && <fieldset className="foreign-key-patch-parents" disabled={busy || mismatch || !!confirmation}><legend>{text.extraParents}</legend><UsageHelp><p>{text.extraHint}</p></UsageHelp>
      {parents.map((parent, i) => <div className="foreign-key-patch-parent-target" key={JSON.stringify([parent.database, parent.table])}><span>{parent.database} / {parent.table}</span><button aria-label={formatText(text.removeParent, `${parent.database} / ${parent.table}`)} onClick={() => requestRead(parents.filter((_, position) => position !== i))}>×</button></div>)}
      <div className="foreign-key-patch-fields"><Field label={text.extraDatabase}><input aria-label={text.extraDatabase} value={parentDatabase} onChange={event => setParentDatabase(event.target.value)}/></Field><Field label={text.extraTable}><input aria-label={text.extraTable} value={parentTable} onChange={event => setParentTable(event.target.value)}/></Field></div>
      <button disabled={parents.length >= foreignKeyTaskLimits.extraParents || !parentDatabase || !parentTable} onClick={loadParent}>{text.loadParent}</button>
    </fieldset>}
    {!preview && snapshot && <><p>{formatText(text.patches, patches.length)}</p><div className="foreign-key-patch-list">
      {snapshot.foreignKeys.map(value => {
        const patch = patches.find(item => item.op !== 'add' && item.foreignKeyRef === value.foreignKeyRef);
        const reasons = [...new Set([...value.unsupportedReasons, ...value.access.replace.reasons, ...value.access.drop.reasons])];
        return <section className={`foreign-key-patch-item ${patch?.op === 'drop' ? 'deleted' : ''}`} key={value.foreignKeyRef} aria-label={value.name}>
          <div className="foreign-key-patch-row"><strong>{value.name}</strong><span>{patch?.op === 'drop' ? text.deleted : patch ? text.changed : text.unchanged}</span><button disabled={editingDisabled || !foreignKeyEditable(value) || patch?.op === 'drop'} aria-label={formatText(text.editNamed, value.name)} onClick={() => edit(value)}>{text.edit}</button><button disabled={editingDisabled || !value.access.drop.allowed || patch?.op === 'drop'} aria-label={formatText(text.dropNamed, value.name)} onClick={() => drop(value)}>{text.drop}</button>{patch && <button disabled={editingDisabled} aria-label={formatText(text.undoNamed, value.name)} onClick={() => undo(value.foreignKeyRef, 'existing')}>{text.undo}</button>}</div>
          <p className="muted small">{value.childColumnNames.join('、')} → {value.parentTarget ? `${value.parentTarget.database} / ${value.parentTarget.table}` : ''} ({value.parentColumnNames.join('、')})</p>
          <details><summary>{text.original}</summary><pre className="foreign-key-patch-raw">{value.rawSql}</pre></details>{reasons.map((reason, i) => <p className="warning-text small" key={i}>{reason}</p>)}
        </section>;
      })}
      {patches.filter(patch => patch.op === 'add').map(patch => <section className="foreign-key-patch-item" key={`added:${patch.clientKey}`}><div className="foreign-key-patch-row"><strong>{text.added}：{patch.definition.name}</strong><button disabled={editingDisabled} aria-label={formatText(text.editNamed, patch.definition.name)} onClick={() => openEditor({ key: patch.clientKey, definition: structuredClone(patch.definition) })}>{text.edit}</button><button disabled={editingDisabled} aria-label={formatText(text.undoNamed, patch.definition.name)} onClick={() => undo(patch.clientKey, 'added')}>{text.undo}</button></div></section>)}
    </div><button disabled={editingDisabled || !snapshot.parents.length || !snapshot.columns.some(foreignKeyColumnSelectable)} onClick={add}>{text.add}</button>{!snapshot.parents.length && <p className="muted">{text.noParents}</p>}
    {editor && <section className="foreign-key-patch-editor" aria-label={text.edit}><h3>{text.edit}</h3><UsageHelp><p>{text.pairsHint}</p><p>{text.draftOnly}</p></UsageHelp>{editor.original && <><pre className="foreign-key-patch-raw" aria-label={text.original}>{editor.original.rawSql}</pre><p className="warning-text">{text.replacement}</p></>}
      <fieldset disabled={editingDisabled}><div className="foreign-key-patch-fields"><Field label={text.name}><input aria-label={text.name} title={text.nameRule} value={editor.definition.name} onChange={event => changeEditor({ ...editor.definition, name: event.target.value })}/></Field>
        <Field label={text.parent}><select aria-label={text.parent} value={editor.definition.parentRef} onChange={event => { try { changeEditor(changeForeignKeyParent(editor.definition, event.target.value, snapshot)); } catch (reason) { report(reason); } }}><option value="" disabled>{text.parent}</option>{snapshot.parents.map(parent => <option key={parent.parentRef} value={parent.parentRef}>{parent.target.database} / {parent.target.table}</option>)}</select></Field>
        {(['onUpdate', 'onDelete'] as const).map(action => <Field key={action} label={text[action]}><select aria-label={text[action]} value={editor.definition[action]} onChange={event => changeEditor({ ...editor.definition, [action]: event.target.value as ForeignKeyAction })}>{(['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL'] as const).map(value => <option key={value} value={value}>{foreignKeyActionLabel(value)}</option>)}</select></Field>)}
      </div><p className="muted small">{snapshot.capabilities && formatText(text.defaultAction, foreignKeyActionLabel(snapshot.capabilities.defaultAction))}</p>
      <p className="muted small">{selectedParent?.keys.length ? formatText(text.parentKeys, selectedParent.keys.map(key => `${key.name} (${key.columnRefs.map(ref => selectedParent.columns.find(column => column.columnRef === ref)?.name ?? ref).join('、')})`).join('；')) : text.noParentKeys}</p>
      <fieldset className="foreign-key-patch-pairs"><legend>{text.pairs}</legend>
        {editor.definition.pairs.map((pair, position) => <div className="foreign-key-patch-pair" key={position}>
          <Field label={formatText(text.childColumn, position + 1)}><select aria-label={formatText(text.childColumn, position + 1)} value={pair.childColumnRef} onChange={event => changeEditor({ ...editor.definition, pairs: editor.definition.pairs.map((old, i) => i === position ? { ...old, childColumnRef: event.target.value } : old) })}><option value="" disabled>{formatText(text.childColumn, position + 1)}</option>{snapshot.columns.map(column => <option key={column.columnRef} value={column.columnRef} disabled={!foreignKeyColumnSelectable(column) || editor.definition.pairs.some((old, i) => i !== position && old.childColumnRef === column.columnRef)}>{column.name} · {column.typeSql}</option>)}</select></Field>
          <Field label={formatText(text.parentColumn, position + 1)}><select aria-label={formatText(text.parentColumn, position + 1)} value={pair.parentColumnRef} onChange={event => changeEditor({ ...editor.definition, pairs: editor.definition.pairs.map((old, i) => i === position ? { ...old, parentColumnRef: event.target.value } : old) })}><option value="" disabled>{formatText(text.parentColumn, position + 1)}</option>{selectedParent?.columns.map(column => <option key={column.columnRef} value={column.columnRef} disabled={!foreignKeyColumnSelectable(column) || editor.definition.pairs.some((old, i) => i !== position && old.parentColumnRef === column.columnRef)}>{column.name} · {column.typeSql}</option>)}</select></Field>
          <div className="foreign-key-patch-pair-actions"><button aria-label={formatText(text.moveUp, position + 1)} disabled={position === 0} onClick={() => changeEditor({ ...editor.definition, pairs: moveForeignKeyPair(editor.definition.pairs, position, position - 1) })}>↑</button><button aria-label={formatText(text.moveDown, position + 1)} disabled={position === editor.definition.pairs.length - 1} onClick={() => changeEditor({ ...editor.definition, pairs: moveForeignKeyPair(editor.definition.pairs, position, position + 1) })}>↓</button><button aria-label={formatText(text.removePair, position + 1)} disabled={editor.definition.pairs.length <= 1} onClick={() => changeEditor({ ...editor.definition, pairs: editor.definition.pairs.filter((_, i) => i !== position) })}>×</button></div>
        </div>)}<button disabled={!canAddPair} onClick={addPair}>{text.addPair}</button>
      </fieldset></fieldset><footer><button disabled={busy || mismatch || !!confirmation} onClick={() => setEditor(null)}>{text.editorCancel}</button><button disabled={editingDisabled} onClick={saveRow}>{text.rowSave}</button></footer>
    </section>}</>}
    {preview && <><h3>{text.fixedSql}</h3><SqlEditor value={preview.sql} readOnly height={260}/>{preview.changes.map((change, i) => <p key={i}>{change.description}</p>)}{preview.warnings.map((warning, i) => <p className="warning-text" key={i}>{warning}</p>)}
      <div className="foreign-key-patch-acks" aria-label={text.confirmation}>{preview.requiredAcknowledgements.map((ack, i) => foreignKeyAcknowledgementLabel(ack) === undefined ? <p className="warning-text" key={`${ack}:${i}`}>{formatText(text.unsupportedAck, ack)}</p> : <label key={`${ack}:${i}`}><input type="checkbox" disabled={busy || consumed || mismatch || previewExpired || snapshotExpired || !!confirmation} checked={acks.has(ack)} onChange={event => { const next = new Set(acks); if (event.target.checked) next.add(ack); else next.delete(ack); setAcks(next); }}/>{foreignKeyAcknowledgementLabel(ack)}</label>)}</div>{consumed && <p>{text.consumed}</p>}
    </>}
    {snapshot?.warnings.map((warning, i) => <p className="warning-text" key={i}>{warning}</p>)}
    {busy && <div aria-label={text.resultProgress}><Spinner text={progress ? progress.phase === 'reading' ? text.readingPhase : text[progress.phase] : text.reading}/></div>}
    {cancelling && busy && <p>{text.cancelling}</p>}{outcome && <div className="foreign-key-patch-state" role="status">{outcome}</div>}{executionUncertain && <p className="warning-text">{text.resetUnknown}</p>}<ErrorBox message={error}/>
  </div><footer className="modal-footer"><button disabled={busy || !!confirmation} onClick={requestClose}>{text.close}</button><button disabled={!busy || cancelling} onClick={() => void cancel()}>{text.cancel}</button><button disabled={busy || mismatch || !!confirmation} onClick={() => requestRead()}>{text.read}</button><span className="grow"/>
    {preview && <button disabled={busy || consumed || mismatch || !!confirmation} onClick={() => void back()}>{text.back}</button>}
    <button disabled={editingDisabled || !patches.length || !!editor} onClick={() => void makePreview()}>{text.preview}</button>
    <button className="primary" disabled={busy || mismatch || !writable || !preview || previewExpired || consumed || !!confirmation || !foreignKeyAcknowledgementsComplete(preview.requiredAcknowledgements, acks)} onClick={() => void apply()}>{text.apply}</button>
  </footer></Modal>;
}
