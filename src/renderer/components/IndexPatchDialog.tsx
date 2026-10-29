import { useEffect, useRef, useState } from 'react';
import type { IndexDefinition, IndexPatch, TableIndexView } from '../../shared/tableIndexPatches';
import { indexMethodForKind, isSpecialIndexKind } from '../../shared/specialIndexRules';
import type { TableIndexApplyInput, TableIndexApplyOutput, TableIndexApplyProgress, TableIndexGetInput, TableIndexGetOutput, TableIndexPatchTarget, TableIndexPreviewInput, TableIndexPreviewOutput, TableIndexReleaseInput } from '../../shared/tableIndexTasks';
import { IndexRequestFence, changeIndexDraftKind, indexAcknowledgementLabel, indexAcknowledgementsComplete, indexColumnSelectable, indexCreationKinds, indexDraftPermission, indexExecutionEffect, indexFailureState, indexNameDraftPermission, indexTokenCurrent, makeIndexAlter, moveIndexPart, sameIndexTarget, setIndexPatch, setIndexPrefix, validateIndexDrafts } from '../indexPatches';
import { errorMessage, uid } from '../lib';
import { formatText } from '../locales/zh-CN';
import { indexPatchZh as text } from '../locales/indexPatches.zh-CN';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';
import { SqlEditor } from './SqlEditor';
import { IndexOptimizerEditor } from './IndexOptimizerEditor';
import { IndexOptimizerIntent, IndexOptimizerPreview, hasIndexOptimizerPatch, makeIndexOptimizerAlter } from '../indexOptimizer';
import '../indexPatches.css';

/** 所有结构请求由真实服务注入；组件只编辑结构化补丁，不生成或执行客户端 SQL。 */
export interface IndexPatchServices {
  get(input: TableIndexGetInput): Promise<TableIndexGetOutput>;
  preview(input: TableIndexPreviewInput): Promise<TableIndexPreviewOutput>;
  apply(input: TableIndexApplyInput): Promise<TableIndexApplyOutput>;
  release(input: TableIndexReleaseInput): Promise<void>;
  cancel(input: { taskId: string }): Promise<void>;
  subscribe?(listener: (event: { taskId: string; progress: TableIndexApplyProgress }) => void): () => void;
}
interface EditRow { key: string; original?: TableIndexView; definition: IndexDefinition; nonPrimaryName: string; }
interface OptimizerRow { index: TableIndexView; intent: IndexOptimizerIntent; visible: boolean; }
interface Operation { guard: IndexRequestFence; generation: number; taskId: string; }
export interface IndexPatchDialogProps {
  target: TableIndexPatchTarget; targetVersion: number; services: IndexPatchServices;
  onClose(): void; onCleanupError(message: string): void; onDirtyChange(dirty: boolean): void;
  onApplied(result: TableIndexApplyOutput): void; beforeApply(): void; onExecutionUncertain(message: string): void;
}

/** 一次弹窗固定目标和连接版本，预览、执行及资源清理共享同步互斥。 */
export function IndexPatchDialog({ target, targetVersion, services, onClose, onCleanupError, onDirtyChange, onApplied, beforeApply, onExecutionUncertain }: IndexPatchDialogProps) {
  const fixed = useRef({ target: structuredClone(target), version: targetVersion });
  const service = useRef(services); service.current = services;
  // 结果回调和最初目标绑定，连接版本变化不能把旧目标的结果刷新到新目标。
  const completion = useRef({ onApplied, onExecutionUncertain });
  const beforeApplyRef = useRef(beforeApply); beforeApplyRef.current = beforeApply;
  const cleanupError = useRef(onCleanupError); cleanupError.current = onCleanupError;
  const dirtyCallback = useRef(onDirtyChange); dirtyCallback.current = onDirtyChange;
  const fence = useRef(new IndexRequestFence()), alive = useRef(true);
  const snapshotRef = useRef<TableIndexGetOutput | null>(null), previewRef = useRef<TableIndexPreviewOutput | null>(null);
  const snapshots = useRef(new Set<string>()), tokens = useRef(new Set<string>()), releases = useRef(new Map<string, Promise<void>>());
  const [snapshot, setSnapshot] = useState<TableIndexGetOutput | null>(null), [preview, setPreview] = useState<TableIndexPreviewOutput | null>(null);
  const [patches, setPatchesState] = useState<IndexPatch[]>([]), [editor, setEditorState] = useState<EditRow | null>(null);
  const [optimizerEditor, setOptimizerEditorState] = useState<OptimizerRow | null>(null), optimizerEditorRef = useRef(optimizerEditor);
  const patchesRef = useRef(patches), editorRef = useRef(editor), draftRevision = useRef(0), discardConfirmation = useRef(false), targetRetired = useRef(false);
  const optimizerIntents = useRef(new Map<TableIndexView, IndexOptimizerIntent>()), optimizerDraft = useRef<IndexOptimizerIntent | null>(null), optimizerPlans = useRef(new WeakMap<TableIndexPreviewOutput, IndexOptimizerPreview>());
  const [snapshotUsable, setSnapshotUsable] = useState(false), [busy, setBusy] = useState(false), [cancelling, setCancelling] = useState(false);
  const [acks, setAcksState] = useState<ReadonlySet<string>>(new Set()), acksRef = useRef(acks), ackRevision = useRef(0), renderedAckRevision = ackRevision.current;
  const [consumed, setConsumed] = useState(false), consumedRef = useRef(false);
  const [error, setError] = useState(''), [outcome, setOutcome] = useState(''), [executionUncertain, setExecutionUncertainState] = useState(false), executionUncertainRef = useRef(false);
  const [progress, setProgress] = useState<TableIndexApplyProgress | null>(null), progressRef = useRef<TableIndexApplyProgress | null>(null);
  const [clock, setClock] = useState(Date.now());
  if (!sameIndexTarget(fixed.current.target, target) || fixed.current.version !== targetVersion) { targetRetired.current = true; for (const intent of optimizerIntents.current.values()) intent.invalidate(); }
  const mismatch = targetRetired.current;
  const mismatchRef = useRef(mismatch); mismatchRef.current = mismatch;
  const snapshotExpired = !!snapshot && !indexTokenCurrent(snapshot.expiresAt, clock), previewExpired = !!preview && !indexTokenCurrent(preview.expiresAt, clock);
  const writable = snapshotUsable && !!snapshot?.writable && !!snapshot.capabilities && !snapshotExpired;
  const editingDisabled = busy || mismatch || !writable;

  /** 草稿同步换代，旧DOM和同轮回调不能在React重绘前覆写后继输入。 */
  function setPatches(value: IndexPatch[]): void { draftRevision.current++; patchesRef.current = value; setPatchesState(value); }
  /** 普通行编辑也同步换代，不能让旧键控件覆盖新专属草稿。 */
  function setEditor(value: EditRow | null): void { draftRevision.current++; editorRef.current = value; setEditorState(value); }
  /** 专属行保持独立输入，不往普通IndexDefinition混入布尔属性。 */
  function setOptimizerEditor(value: OptimizerRow | null): void { draftRevision.current++; optimizerEditorRef.current = value; setOptimizerEditorState(value); }
  /** 每次确认均换身份和代次，相同勾选集合恢复也不能复活旧执行回调。 */
  function setAcks(value: ReadonlySet<string>): void { acksRef.current = value; ackRevision.current++; setAcksState(value); }
  /** 旧关闭回调始终读取最新执行事实，不能降级未知提交状态。 */
  function setExecutionUncertain(value: boolean): void { executionUncertainRef.current = value; setExecutionUncertainState(value); }
  /** 丢稿授权只属于确认当刻的来源；确认本身可重入，所有动作入口须共享此锁。 */
  function confirmDiscard(message: string, editorOnly = false): boolean {
    if (!alive.current || fence.current.busy || discardConfirmation.current) return false;
    const owner = { patches: patchesRef.current, editor: editorRef.current, optimizer: optimizerEditorRef.current, revision: draftRevision.current, snapshot: snapshotRef.current, preview: previewRef.current, fence: fence.current, uncertain: executionUncertainRef.current, mismatch: mismatchRef.current, acks: acksRef.current, ackRevision: ackRevision.current };
    discardConfirmation.current = true;
    try {
      const dirty = owner.editor || owner.optimizer || !editorOnly && (owner.patches.length || owner.uncertain), accepted = !dirty || window.confirm(message);
      return accepted && alive.current && !fence.current.busy && owner.fence === fence.current && owner.patches === patchesRef.current && owner.editor === editorRef.current && owner.optimizer === optimizerEditorRef.current && owner.revision === draftRevision.current && owner.snapshot === snapshotRef.current && owner.preview === previewRef.current && owner.uncertain === executionUncertainRef.current && owner.mismatch === mismatchRef.current && owner.acks === acksRef.current && owner.ackRevision === ackRevision.current;
    } finally { discardConfirmation.current = false; }
  }
  /** 旧页面操作绑定当前来源和草稿；关闭/重读另用最新同步refs进行丢稿确认。 */
  function draftCurrent(): boolean {
    if (snapshot && !indexTokenCurrent(snapshot.expiresAt)) { for (const intent of optimizerIntents.current.values()) intent.invalidate(); return false; }
    return alive.current && !fence.current.busy && !discardConfirmation.current && !mismatchRef.current && snapshotRef.current === snapshot && patchesRef.current === patches && editorRef.current === editor && optimizerEditorRef.current === optimizerEditor && !previewRef.current && !!snapshot;
  }
  /** 勾选框只更新本次确认集合，不能复制旧Set恢复用户刚取消的确认。 */
  function changeAcknowledgement(value: TableIndexPreviewOutput, expected: ReadonlySet<string>, revision: number, id: string, checked: boolean): void {
    if (!alive.current || fence.current.busy || discardConfirmation.current || mismatchRef.current || consumedRef.current || previewRef.current !== value || acksRef.current !== expected || ackRevision.current !== revision || typeof checked !== 'boolean' || !value.requiredAcknowledgements.includes(id) || !indexAcknowledgementLabel(id)) return;
    if (optimizerPlans.current.has(value) && !optimizerPlans.current.get(value)!.current(snapshotRef.current, patchesRef.current, value)) { setError(text.optimizerStale); return; }
    const next = new Set(expected); if (checked) next.add(id); else next.delete(id); setAcks(next);
  }
  useEffect(() => { onDirtyChange(patches.length > 0 || editor !== null || optimizerEditor !== null); }, [patches, editor, optimizerEditor, onDirtyChange]);
  useEffect(() => () => dirtyCallback.current(false), []);
  useEffect(() => {
    // StrictMode 的旧异步回调保留旧围栏，不能因重新挂载而进入新代次。
    const guard = new IndexRequestFence(); fence.current = guard; alive.current = true; void read();
    return () => {
      alive.current = false; const taskId = guard.dispose();
      if (taskId) void service.current.cancel({ taskId }).catch(reason => cleanupError.current(errorMessage(reason)));
      void releaseAll(true).catch(reason => cleanupError.current(formatText(text.releaseFailed, errorMessage(reason))));
    };
  }, []);
  useEffect(() => services.subscribe?.(event => {
    if (alive.current && event.taskId === fence.current.taskId) { progressRef.current = event.progress; setProgress(event.progress); }
  }), [services]);
  useEffect(() => {
    const deadlines = [snapshot?.expiresAt, preview?.expiresAt].filter((value): value is string => value !== undefined).map(Date.parse).filter(Number.isFinite);
    if (!deadlines.length) return;
    const deadline = Math.min(...deadlines), now = Date.now(); setClock(now);
    if (deadline > now) { const timer = window.setTimeout(() => setClock(Date.now()), Math.min(deadline - now + 1, 2147483647)); return () => window.clearTimeout(timer); }
  }, [snapshot?.expiresAt, preview?.expiresAt]);
  useEffect(() => {
    /** 模态表单和只读 SQL 编辑器不能触发后台查询或保存快捷键。 */
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true); return () => document.removeEventListener('keydown', block, true);
  }, []);

  /** 先记录释放责任；失败不删待释放集合，同一 ID 的并发释放共用真实 Promise。 */
  async function releaseOne(kind: 'snapshotId' | 'previewToken', id: string): Promise<void> {
    const pending = kind === 'snapshotId' ? snapshots.current : tokens.current, key = `${kind}:${id}`; pending.add(id);
    let request = releases.current.get(key);
    if (!request) { request = Promise.resolve().then(() => service.current.release({ [kind]: id })).then(() => { pending.delete(id); }); releases.current.set(key, request); }
    try { await request; } finally { if (releases.current.get(key) === request) releases.current.delete(key); }
  }
  /** 尽力释放全部已知资源，不让首个失败跳过其他令牌，失败集合仍可再次清理。 */
  async function releaseAll(includeSnapshots: boolean): Promise<void> {
    const failures: string[] = [];
    for (const id of [...tokens.current]) try { await releaseOne('previewToken', id); } catch (reason) { failures.push(errorMessage(reason)); }
    if (includeSnapshots) for (const id of [...snapshots.current]) try { await releaseOne('snapshotId', id); } catch (reason) { failures.push(errorMessage(reason)); }
    if (failures.length) throw new Error(failures.join('\n'));
  }
  /** 旧令牌在第一次 await 前失效；清理失败绝不使它重新可执行。 */
  async function invalidatePreview(): Promise<void> { previewRef.current = null; if (alive.current) { setPreview(null); setAcks(new Set()); } await releaseAll(false); }
  /** 显示旧定义用于核对，但它已经不能用于编辑或生成预览。 */
  async function invalidateSnapshot(): Promise<void> { for (const intent of optimizerIntents.current.values()) intent.invalidate(); optimizerIntents.current.clear(); optimizerDraft.current = null; snapshotRef.current = null; if (alive.current) setSnapshotUsable(false); await releaseAll(true); }
  /** 同步锁先于任何服务请求，旧目标失效后只允许明确关闭清理。 */
  function begin(allowMismatch = false): Operation | undefined {
    if (!alive.current || discardConfirmation.current || mismatchRef.current && !allowMismatch) return undefined;
    const guard = fence.current, token = guard.begin(uid()); if (!token) return undefined;
    setBusy(true); setCancelling(false); setError(''); setProgress(null); progressRef.current = null;
    return { ...token, guard };
  }
  /** cancelled 或旧代次响应只能释放，不允许投影为新快照/预览。 */
  function accepts(operation: Operation): boolean { return alive.current && operation.guard === fence.current && operation.guard.accepts(operation) && !mismatchRef.current; }
  /** 真实 IPC finally 才释放忙碌，取消按钮返回不等于主任务已结束。 */
  function finish(operation: Operation): void { operation.guard.finish(operation); if (alive.current && operation.guard === fence.current) setBusy(false); }
  /** 当前窗口错误走界面，卸载后的清理错误交给宿主，不静默吞掉。 */
  function report(reason: unknown, operation?: Operation): void { if (alive.current && (!operation || operation.guard === fence.current)) setError(errorMessage(reason)); else cleanupError.current(errorMessage(reason)); }
  /** 重读只读取真实定义；放弃确认发生在同步锁之前，不自动重套旧补丁。 */
  async function read(): Promise<void> {
    if (fence.current.busy || mismatchRef.current) return;
    if (!confirmDiscard(executionUncertainRef.current ? text.closeUnknown : text.discard)) return;
    const operation = begin(); if (!operation) return;
    try {
      await invalidatePreview(); await invalidateSnapshot(); if (!accepts(operation)) return;
      const next = await service.current.get({ ...fixed.current.target, includeOptimizerFacts: true, taskId: operation.taskId }); snapshots.current.add(next.snapshotId);
      if (!accepts(operation) || !sameIndexTarget(next.target, fixed.current.target) || !indexTokenCurrent(next.expiresAt)) {
        await releaseOne('snapshotId', next.snapshotId);
        if (accepts(operation)) throw new Error(!sameIndexTarget(next.target, fixed.current.target) ? text.targetChanged : text.expired);
        return;
      }
      for (const index of next.indexes) if (index.optimizer?.access.allowed === true && typeof index.optimizer.visible === 'boolean') optimizerIntents.current.set(index, new IndexOptimizerIntent(next, index));
      snapshotRef.current = next; setSnapshot(next); setSnapshotUsable(true); setPatches([]); setEditor(null); setOptimizerEditor(null); consumedRef.current = false; setConsumed(false); setOutcome(''); setExecutionUncertain(false); setClock(Date.now());
    } catch (reason) { report(reason, operation); } finally { finish(operation); }
  }
  /** 只由明确点击生成只读预览，响应必须匹配同一目标及原定义哈希。 */
  async function makePreview(): Promise<void> {
    const current = snapshotRef.current; if (!current || !snapshotUsable || editorRef.current || optimizerEditorRef.current || !writable || !draftCurrent()) return;
    const originalPatches = patchesRef.current, intent = hasIndexOptimizerPatch(originalPatches) ? optimizerDraft.current : null;
    if (hasIndexOptimizerPatch(originalPatches) && !intent?.current(current)) { setError(text.optimizerStale); return; }
    const operation = begin(); if (!operation) return;
    try {
      if (!indexTokenCurrent(current.expiresAt)) throw new Error(text.expired);
      const input = validateIndexDrafts(current, originalPatches); await invalidatePreview(); if (!accepts(operation)) return;
      const next = await service.current.preview({ snapshotId: current.snapshotId, patches: input, taskId: operation.taskId }); tokens.current.add(next.previewToken);
      const owner = intent ? new IndexOptimizerPreview(intent, originalPatches, next) : null;
      if (!accepts(operation) || snapshotRef.current !== current || patchesRef.current !== originalPatches || owner && !owner.current(snapshotRef.current, patchesRef.current, next) || !sameIndexTarget(next.target, fixed.current.target) || next.ddlHash !== current.ddlHash || !indexTokenCurrent(next.expiresAt)) {
        await releaseOne('previewToken', next.previewToken);
        if (accepts(operation)) throw new Error(!indexTokenCurrent(next.expiresAt) ? text.expired : owner ? text.optimizerStale : text.previewMismatch);
        return;
      }
      if (owner) optimizerPlans.current.set(next, owner);
      previewRef.current = next; setPreview(next); setAcks(new Set()); consumedRef.current = false; setConsumed(false); setOutcome(''); setClock(Date.now());
    } catch (reason) { report(reason, operation); } finally { finish(operation); }
  }
  /** 单次令牌同步消费，失败也不能重试；只有真实完成证据才清本地结构草稿。 */
  async function apply(): Promise<void> {
    const current = previewRef.current, original = snapshotRef.current;
    if (!current || current !== preview || !original || consumedRef.current || discardConfirmation.current || fence.current.busy || acksRef.current !== acks || ackRevision.current !== renderedAckRevision || !indexAcknowledgementsComplete(current.requiredAcknowledgements, acksRef.current)) return;
    const owner = optimizerPlans.current.get(current), originalPatches = patchesRef.current;
    if (hasIndexOptimizerPatch(originalPatches) && (!owner || !owner.current(original, originalPatches, current))) { setError(text.optimizerStale); return; }
    const operation = begin(); if (!operation) return; consumedRef.current = true; setConsumed(true); let attempted = false;
    owner?.consume();
    try {
      if (!indexTokenCurrent(current.expiresAt) || !indexTokenCurrent(original.expiresAt)) throw new Error(text.expired);
      beforeApplyRef.current(); if (!accepts(operation)) return;
      if (previewRef.current !== current || snapshotRef.current !== original || patchesRef.current !== originalPatches || acksRef.current !== acks || ackRevision.current !== renderedAckRevision || !indexAcknowledgementsComplete(current.requiredAcknowledgements, acksRef.current)) throw Error(text.acknowledgementsChanged);
      if (owner && !owner.current(snapshotRef.current, patchesRef.current, previewRef.current, true)) throw Error(text.optimizerStale);
      attempted = true;
      const result = await service.current.apply({ previewToken: current.previewToken, acknowledgements: current.requiredAcknowledgements.slice(), taskId: operation.taskId });
      const effect = indexExecutionEffect({ kind: 'resolved', result });
      if (alive.current && operation.guard === fence.current) {
        setOutcome(result.definitionVerified ? text.succeeded : text.verificationFailed); setExecutionUncertain(effect.page === 'stale');
        if (effect.clearDrafts) { setPatches([]); setEditor(null); setOptimizerEditor(null); optimizerDraft.current = null; dirtyCallback.current(false); }
        setError([result.verificationError, ...result.warnings].filter(Boolean).join('\n'));
      }
      // 卸载或配置变化也保留已完成事实；回调仍绑定本窗口最初目标。
      try { completion.current.onApplied(result); } catch (reason) { report(reason, operation); }
    } catch (reason) {
      const state = progressRef.current, status = attempted ? indexFailureState(state) : 'notSent', effect = indexExecutionEffect({ kind: 'rejected', progress: state, attempted });
      if (alive.current && operation.guard === fence.current) {
        setOutcome(text[status]); setExecutionUncertain(effect.page === 'stale'); setError(errorMessage(reason));
        if (effect.clearDrafts) { setPatches([]); setEditor(null); setOptimizerEditor(null); optimizerDraft.current = null; dirtyCallback.current(false); }
      } else cleanupError.current(errorMessage(reason));
      if (effect.page === 'stale') completion.current.onExecutionUncertain(text[status]);
    } finally { finish(operation); }
  }
  /** 只发一次真实取消请求，保持所有编辑/关闭按钮锁定到原请求终态。 */
  async function cancel(): Promise<void> { const taskId = fence.current.cancel(); if (!taskId) return; setCancelling(true); try { await service.current.cancel({ taskId }); } catch (reason) { report(reason); } }
  /** 按稳定引用恢复本行原模型与当前差异，不按显示名字或行号识别旧索引。 */
  function edit(index: TableIndexView): void {
    if (!draftCurrent() || !snapshot || editingDisabled || !snapshot.indexes.includes(index)) return;
    if (optimizerEditorRef.current || hasIndexOptimizerPatch(patchesRef.current)) { setError(text.optimizerMixed); return; }
    if (!index.editableDefinition || !(['rename', 'replace'] as const).some(action => indexDraftPermission(snapshot, index.indexRef, action, patches).allowed) || !confirmDiscard(text.discardEditor, true)) return;
    const patch = patches.find(item => item.op !== 'add' && item.indexRef === index.indexRef); if (patch?.op === 'drop') return;
    const definition = structuredClone({ ...index.editableDefinition, ...(patch?.op === 'alter' ? patch.changes : {}) });
    setEditor({ key: index.indexRef, original: index, definition, nonPrimaryName: definition.kind === 'primary' ? '' : definition.name });
  }
  /** 新增 clientKey 仅存在本地，未选择和确认前没有 SQL 请求。 */
  function add(): void {
    if (editingDisabled || !draftCurrent() || !snapshot) return;
    if (optimizerEditorRef.current || hasIndexOptimizerPatch(patchesRef.current)) { setError(text.optimizerMixed); return; }
    if (!confirmDiscard(text.discardEditor, true)) return;
    const kind = indexCreationKinds(snapshot)[0], first = snapshot.columns.find(column => indexColumnSelectable(column, kind)); if (!kind || !first) { setError(text.noColumns); return; }
    setEditor({ key: uid(), nonPrimaryName: '', definition: { name: kind === 'primary' ? 'PRIMARY' : '', kind, method: indexMethodForKind(kind), keyParts: [{ columnRef: first.columnRef, direction: 'asc' }], comment: '' } });
  }
  /** 本行确认只改变草稿；全批恢复原值时自然清零，不提交空预览。 */
  function saveRow(): void {
    if (!snapshot || !editor || editingDisabled || !draftCurrent() || optimizerEditorRef.current || hasIndexOptimizerPatch(patchesRef.current)) return;
    try {
      const next = editor.original ? makeIndexAlter(editor.original, editor.definition, { snapshot, patches }) : { op: 'add' as const, clientKey: editor.key, definition: editor.definition };
      const updated = setIndexPatch(patches, editor.key, next); if (updated.length) validateIndexDrafts(snapshot, updated);
      setPatches(updated); setEditor(null); setError('');
    } catch (reason) { report(reason); }
  }
  /** 删除或撤销仅改本地补丁；任何预览都必须先返回并释放，不能留旧令牌。 */
  function drop(index: TableIndexView): void {
    if (!snapshot || editingDisabled || !draftCurrent() || !snapshot.indexes.includes(index)) return;
    if (optimizerEditorRef.current || hasIndexOptimizerPatch(patchesRef.current)) { setError(text.optimizerMixed); return; }
    if (!indexDraftPermission(snapshot, index.indexRef, 'drop', patches).allowed || !confirmDiscard(text.discardEditor, true)) return;
    // 删除风险确认同样阻止嵌套任务，并在返回后重核本轮草稿身份。
    const revision = draftRevision.current; discardConfirmation.current = true;
    let accepted = false; try { accepted = window.confirm(text.deleteRisk); } finally { discardConfirmation.current = false; }
    if (!accepted || revision !== draftRevision.current || !draftCurrent()) return;
    try { const next = setIndexPatch(patches, index.indexRef, { op: 'drop', indexRef: index.indexRef }); validateIndexDrafts(snapshot, next); setPatches(next); setEditor(null); setError(''); } catch (reason) { report(reason); }
  }
  /** 返回编辑先释放预览；清理失败保留草稿但不恢复可执行令牌。 */
  async function back(): Promise<void> { if (!preview || previewRef.current !== preview) return; const operation = begin(); if (!operation) return; try { await invalidatePreview(); } catch (reason) { report(reason); } finally { finish(operation); } }
  /** 关闭要等待实际释放，unknown 结果独立确认；busy 时 Escape/关闭均无效。 */
  async function close(): Promise<void> {
    if (fence.current.busy || !confirmDiscard(executionUncertainRef.current ? text.closeUnknown : text.discard)) return;
    const operation = begin(true); if (!operation) return;
    try { await invalidatePreview(); await invalidateSnapshot(); if (alive.current && operation.guard === fence.current && operation.guard.accepts(operation)) onClose(); } catch (reason) { report(reason); } finally { finish(operation); }
  }
  /** 单项依赖限制可由其他草稿进入整批预览，原定义不透明及未知能力始终只读。 */
  function changeEditor(value: IndexDefinition): void { if (editor && !editingDisabled && draftCurrent() && !optimizerEditorRef.current && !hasIndexOptimizerPatch(patchesRef.current)) setEditor({ ...editor, definition: value }); }
  /** 独立入口既能停用优化器参与，也能从旧解析器只读的不可见状态恢复。 */
  function editOptimizer(index: TableIndexView): void {
    if (!snapshot || !draftCurrent() || editingDisabled || !snapshot.indexes.includes(index)) return;
    if (editorRef.current || patchesRef.current.some(patch => patch.op !== 'alter' || patch.indexRef !== index.indexRef || Object.keys(patch.changes).length !== 1 || !Object.hasOwn(patch.changes, 'optimizerVisible'))) { setError(text.optimizerMixed); return; }
    const intent = optimizerIntents.current.get(index); if (!intent?.current(snapshotRef.current)) { setError(index.optimizer?.access.reasons.join('\n') || text.optimizerStale); return; }
    if (!confirmDiscard(text.discardEditor, true)) return;
    const patch = patchesRef.current.find(patch => patch.op === 'alter' && patch.indexRef === index.indexRef);
    setOptimizerEditor({ index, intent, visible: patch?.op === 'alter' ? patch.changes.optimizerVisible! : index.optimizer!.visible }); setError('');
  }
  /** 旧checkbox、恢复与保存回调都必须属于准确编辑行和读取时意图。 */
  function optimizerCurrent(value: OptimizerRow): boolean { return draftCurrent() && optimizerEditorRef.current === value && value.intent.current(snapshotRef.current); }
  /** 明确布尔输入才替换当前行，恢复按钮与checkbox走同一个守卫。 */
  function changeOptimizer(value: OptimizerRow, visible: boolean): void { if (!optimizerCurrent(value) || typeof visible !== 'boolean') { if (alive.current) setError(text.optimizerStale); return; } setOptimizerEditor({ ...value, visible }); }
  /** 保存只形成单项结构草稿；恢复原状态删除差异，不投递空预览。 */
  function saveOptimizer(value: OptimizerRow): void {
    if (!optimizerCurrent(value) || !snapshot) { if (alive.current) setError(text.optimizerStale); return; }
    try { const patch = makeIndexOptimizerAlter(value.index, value.visible), next = setIndexPatch(patchesRef.current, value.index.indexRef, patch); if (next.length) validateIndexDrafts(snapshot, next); optimizerDraft.current = patch ? value.intent : null; setPatches(next); setOptimizerEditor(null); setError(''); } catch (reason) { report(reason); }
  }
  /** 撤销绑定原补丁数组，旧按钮不能清除后继同索引的另一个意图。 */
  function undoPatch(key: string): void { if (!draftCurrent()) return; const next = setIndexPatch(patches, key, null); setPatches(next); if (!hasIndexOptimizerPatch(next)) optimizerDraft.current = null; if (editor?.key === key) setEditor(null); if (optimizerEditor?.index.indexRef === key) setOptimizerEditor(null); }
  const editorReplace = snapshot && editor?.original ? indexDraftPermission(snapshot, editor.original.indexRef, 'replace', patches) : null;
  const editorRename = snapshot && editor?.original ? indexNameDraftPermission(snapshot, editor.original.indexRef, editor.definition, patches) : null;
  const canReplace = !!editor && (!editor.original || editorReplace?.allowed);
  const canRename = !!editor && (!editor.original || editorRename?.allowed);
  const snapshotWarnings = snapshot?.warnings ?? [];

  return <Modal title={text.title} wide onClose={() => void close()}><div className="modal-content index-patch-content">
    <strong>{fixed.current.target.database} / {fixed.current.target.table}</strong>
    <p className="muted small">{snapshot?.capabilities ? `${snapshot.capabilities.dialect} ${snapshot.capabilities.serverVersion}` : text.capabilityUnknown}</p>
    <p className="warning-text">{text.maintenance}</p><p className="warning-text">{text.ddl}</p>
    {mismatch && <ErrorBox message={text.targetChanged}/>}{(snapshotExpired || previewExpired) && <ErrorBox message={text.expired}/>}
    {snapshot && (!snapshot.writable || !snapshot.capabilities) && <p className="warning-text">{text.readonlyTable}</p>}
    {snapshot?.incomingCoverage.kind === 'partial' && <p className="warning-text">{text.incomingPartial}</p>}
    {!preview && snapshot && <><p>{formatText(text.patches, patches.length)}</p><div className="index-patch-list">
      {snapshot.indexes.map(index => {
        const patch = patches.find(item => item.op !== 'add' && item.indexRef === index.indexRef);
        const permissions = { drop: indexDraftPermission(snapshot, index.indexRef, 'drop', patches), rename: indexDraftPermission(snapshot, index.indexRef, 'rename', patches), replace: indexDraftPermission(snapshot, index.indexRef, 'replace', patches) };
        const editable = permissions.rename.allowed || permissions.replace.allowed;
        const reasons = [...new Set([...index.unsupportedReasons, ...(!index.access.rename.allowed ? index.access.rename.reasons : []), ...(!index.access.replace.allowed ? index.access.replace.reasons : []), ...(!index.access.drop.allowed ? index.access.drop.reasons : [])])];
        return <section key={index.indexRef} className={`index-patch-item ${patch?.op === 'drop' ? 'deleted' : ''}`} aria-label={index.name}>
          <div className="index-patch-row"><strong>{index.name}</strong><span>{text[index.kind]} · {patch?.op === 'drop' ? text.deleted : patch ? text.changed : text.unchanged}</span>
            <button aria-label={formatText(text.editNamed, index.name)} disabled={editingDisabled || !editable || patch?.op === 'drop' || !!optimizerEditor || hasIndexOptimizerPatch(patches)} onClick={() => edit(index)}>{text.edit}</button>
            <button aria-label={formatText(text.dropNamed, index.name)} disabled={editingDisabled || !permissions.drop.allowed || !!optimizerEditor || hasIndexOptimizerPatch(patches)} onClick={() => drop(index)}>{text.drop}</button>
            <button aria-label={formatText(text.optimizerEntryNamed, index.name)} disabled={editingDisabled || index.optimizer?.access.allowed !== true || typeof index.optimizer.visible !== 'boolean' || !!editor || patches.some(value => value.op !== 'alter' || value.indexRef !== index.indexRef || !Object.hasOwn(value.changes, 'optimizerVisible'))} onClick={() => editOptimizer(index)}>{text.optimizerEntry}</button>
            {patch && <button aria-label={formatText(text.undoNamed, index.name)} disabled={editingDisabled} onClick={() => undoPatch(index.indexRef)}>{text.undo}</button>}
          </div><details><summary>{text.original}</summary><pre className="index-patch-raw">{index.rawSql}</pre></details>
          <p className="muted small">{text.optimizerCurrent}：{typeof index.optimizer?.visible === 'boolean' ? index.optimizer.visible ? text.optimizerVisible : text.optimizerHidden : text.optimizerUnknown}</p>
          {index.optimizer?.access.allowed !== true && <p className="warning-text small">{index.optimizer?.access.reasons.join('\n') || text.optimizerReadonly}</p>}
          {reasons.map((reason, i) => <p key={i} className="warning-text small">{reason}</p>)}
          {Object.values(permissions).some(permission => permission.requiresBatchPreview) && <p className="warning-text small">{text.batchReview}</p>}
        </section>;
      })}
      {patches.filter(patch => patch.op === 'add').map(patch => <section className="index-patch-item" key={patch.clientKey}><div className="index-patch-row"><strong>{text.added}：{patch.definition.name}</strong><span>{text[patch.definition.kind]}</span><button disabled={editingDisabled} aria-label={formatText(text.editNamed, patch.definition.name)} onClick={() => { if (draftCurrent() && !optimizerEditorRef.current && confirmDiscard(text.discardEditor, true)) setEditor({ key: patch.clientKey, definition: structuredClone(patch.definition), nonPrimaryName: patch.definition.kind === 'primary' ? '' : patch.definition.name }); }}>{text.edit}</button><button disabled={editingDisabled} aria-label={formatText(text.undoNamed, patch.definition.name)} onClick={() => undoPatch(patch.clientKey)}>{text.undo}</button></div></section>)}
    </div><button disabled={editingDisabled || !indexCreationKinds(snapshot).length || !!optimizerEditor || hasIndexOptimizerPatch(patches)} onClick={add}>{text.add}</button>
    {optimizerEditor && <IndexOptimizerEditor
      index={optimizerEditor.index} visible={optimizerEditor.visible} dialect={snapshot.capabilities?.dialect} disabled={editingDisabled}
      onChange={visible => changeOptimizer(optimizerEditor, visible)} onSave={() => saveOptimizer(optimizerEditor)}
      onClose={() => { if (optimizerCurrent(optimizerEditor)) setOptimizerEditor(null); }}
    />}
    {editor && <section className="index-patch-editor" aria-label={text.edit}><h3>{text.edit}</h3>
      {editor.original && <pre className="index-patch-raw" aria-label={text.original}>{editor.original.rawSql}</pre>}
      {(editorReplace?.requiresBatchPreview || editorRename?.requiresBatchPreview) && <p className="warning-text small">{text.batchReview}</p>}
      <p>{text.specialFields}</p><div className="index-patch-fields"><Field label={text.kind}><select aria-label={text.kind} disabled={editingDisabled || !canReplace} value={editor.definition.kind} onChange={event => {
        if (!draftCurrent() || optimizerEditorRef.current || hasIndexOptimizerPatch(patchesRef.current)) return;
        const kind = event.target.value as IndexDefinition['kind'], old = editor.definition;
        setEditor({ ...editor, nonPrimaryName: old.kind === 'primary' ? editor.nonPrimaryName : old.name, definition: { ...changeIndexDraftKind(old, kind, snapshot.columns), name: kind === 'primary' ? 'PRIMARY' : old.kind === 'primary' ? editor.nonPrimaryName : old.name } });
      }}>{(editor.original ? ['ordinary', 'unique', 'primary'] as const : indexCreationKinds(snapshot)).map(kind => <option key={kind} value={kind}>{text[kind]}</option>)}</select></Field>
      <Field label={text.name}><input aria-label={text.name} disabled={editingDisabled || !canRename || editor.definition.kind === 'primary'} value={editor.definition.name} onChange={event => changeEditor({ ...editor.definition, name: event.target.value })}/></Field>
      <Field label={text.method}><input aria-label={text.method} readOnly value={editor.definition.method}/></Field>
      <Field label={text.comment}><textarea aria-label={text.comment} disabled={editingDisabled || !canReplace} value={editor.definition.comment} onChange={event => changeEditor({ ...editor.definition, comment: event.target.value })}/></Field></div>
      <fieldset className="index-patch-parts" disabled={editingDisabled || !canReplace}><legend>{text.parts}</legend><UsageHelp><p>{text.fullColumn}</p></UsageHelp>
        {editor.definition.keyParts.map((part, position) => {
          const column = snapshot.columns.find(value => value.columnRef === part.columnRef), label = position + 1;
          return <div className="index-patch-part" key={position}>
            <Field label={formatText(text.column, label)}><select aria-label={formatText(text.column, label)} value={part.columnRef} onChange={event => changeEditor({ ...editor.definition, keyParts: editor.definition.keyParts.map((old, i) => i === position ? { columnRef: event.target.value, direction: old.direction } : old) })}>
              {snapshot.columns.map(value => <option key={value.columnRef} value={value.columnRef} disabled={!indexColumnSelectable(value, editor.definition.kind) || editor.definition.keyParts.some((old, i) => i !== position && old.columnRef === value.columnRef)}>{value.name} · {value.typeSql}</option>)}
            </select></Field>
            <Field label={formatText(text.prefix, label)}><input aria-label={formatText(text.prefix, label)} type="number" min={1} max={column?.prefix.kind === 'allowed' ? column.prefix.maxLength : undefined} disabled={isSpecialIndexKind(editor.definition.kind) || column?.prefix.kind !== 'allowed'} value={part.prefixLength ?? ''} onChange={event => changeEditor({ ...editor.definition, keyParts: editor.definition.keyParts.map((old, i) => i === position ? setIndexPrefix(old, event.target.value) : old) })}/><small>{isSpecialIndexKind(editor.definition.kind) ? text.specialNoPrefix : editor.definition.kind === 'primary' ? text.invalidPrimary : column?.prefix.kind === 'allowed' ? text[column.prefix.unit] : column?.prefix.kind === 'forbidden' ? text.prefixForbidden : text.prefixUnknown}</small></Field>
            <Field label={formatText(text.direction, label)}><select aria-label={formatText(text.direction, label)} value={part.direction} disabled={isSpecialIndexKind(editor.definition.kind)} onChange={event => changeEditor({ ...editor.definition, keyParts: editor.definition.keyParts.map((old, i) => i === position ? { ...old, direction: event.target.value as 'asc' | 'desc' } : old) })}><option value="asc">{isSpecialIndexKind(editor.definition.kind) ? text.specialNoDirection : text.asc}</option><option value="desc" disabled={!snapshot.capabilities?.descendingIndexes}>{text.desc}</option></select></Field>
            <div className="index-patch-part-actions"><button aria-label={formatText(text.moveUp, label)} disabled={position === 0} onClick={() => changeEditor({ ...editor.definition, keyParts: moveIndexPart(editor.definition.keyParts, position, position - 1) })}>↑</button><button aria-label={formatText(text.moveDown, label)} disabled={position === editor.definition.keyParts.length - 1} onClick={() => changeEditor({ ...editor.definition, keyParts: moveIndexPart(editor.definition.keyParts, position, position + 1) })}>↓</button><button aria-label={formatText(text.removePart, label)} disabled={editor.definition.keyParts.length <= 1} onClick={() => changeEditor({ ...editor.definition, keyParts: editor.definition.keyParts.filter((_, i) => i !== position) })}>×</button></div>
          </div>;
        })}
        <button disabled={editor.definition.kind === 'spatial' || editor.definition.keyParts.length >= (snapshot.capabilities?.maxKeyParts ?? 0) || !snapshot.columns.some(value => indexColumnSelectable(value, editor.definition.kind) && !editor.definition.keyParts.some(part => part.columnRef === value.columnRef))} onClick={() => { const column = snapshot.columns.find(value => indexColumnSelectable(value, editor.definition.kind) && !editor.definition.keyParts.some(part => part.columnRef === value.columnRef)); if (column) changeEditor({ ...editor.definition, keyParts: [...editor.definition.keyParts, { columnRef: column.columnRef, direction: 'asc' }] }); }}>{text.addPart}</button>
      </fieldset><footer><button disabled={busy || mismatch} onClick={() => { if (draftCurrent()) setEditor(null); }}>{text.editorCancel}</button><button disabled={editingDisabled} onClick={saveRow}>{text.rowSave}</button></footer>
    </section>}</>}
    {preview && <><h3>{text.fixedSql}</h3><SqlEditor value={preview.sql} readOnly height={260}/>
      {preview.changes.map((change, i) => <p key={i}>{change.description}</p>)}{preview.warnings.map((warning, i) => <p className="warning-text" key={i}>{warning}</p>)}
      <div className="index-patch-acks" aria-label={text.confirmation}>{preview.requiredAcknowledgements.map((ack, i) => indexAcknowledgementLabel(ack) === undefined ? <p className="warning-text" key={`${ack}:${i}`}>{formatText(text.unsupportedAck, ack)}</p> : <label key={`${ack}:${i}`}><input type="checkbox" disabled={busy || consumed || mismatch || previewExpired || snapshotExpired} checked={acks.has(ack)} onChange={event => changeAcknowledgement(preview, acks, renderedAckRevision, ack, event.target.checked)}/>{indexAcknowledgementLabel(ack)}</label>)}</div>
      {consumed && <p>{text.consumed}</p>}
    </>}
    {snapshotWarnings.map((warning, i) => <p className="warning-text" key={i}>{warning}</p>)}
    {busy && <div aria-label={text.resultProgress}><Spinner text={progress ? progress.phase === 'reading' ? text.readingPhase : text[progress.phase] : text.reading}/></div>}
    {cancelling && busy && <p>{text.cancelling}</p>}{outcome && <div className="index-patch-state" role="status">{outcome}</div>}{executionUncertain && <p className="warning-text">{text.resetUnknown}</p>}<ErrorBox message={error}/>
  </div><footer className="modal-footer"><button disabled={busy} onClick={() => void close()}>{text.close}</button><button disabled={!busy || cancelling} onClick={() => void cancel()}>{text.cancel}</button><button disabled={busy || mismatch} onClick={() => void read()}>{text.read}</button><span className="grow"/>
    {preview && <button disabled={busy || consumed || mismatch} onClick={() => void back()}>{text.back}</button>}
    <button disabled={editingDisabled || !!preview || !patches.length || !!editor || !!optimizerEditor} onClick={() => void makePreview()}>{text.preview}</button>
    <button className="primary" disabled={busy || mismatch || !writable || !preview || previewExpired || consumed || !indexAcknowledgementsComplete(preview.requiredAcknowledgements, acks)} onClick={() => void apply()}>{text.apply}</button>
  </footer></Modal>;
}
