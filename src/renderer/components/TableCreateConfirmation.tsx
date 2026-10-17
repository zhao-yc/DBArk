import { useEffect, useRef, useState } from 'react';
import { tableCreateAcknowledgements, tableCreateConfirmation, tableCreateDesignSchema, type TableCreateApplyOutput, type TableCreateGetOutput, type TableCreatePreviewOutput, type TableCreateProgress } from '../../shared/tableCreate';
import type { TableDesign } from '../../shared/contracts';
import { IndexRequestFence } from '../indexPatches';
import { tableCreateServices, type TableCreateServices } from '../tableCreateServices';
import { tableCreateZh as text } from '../locales/tableCreate.zh-CN';
import { useWorkspace } from '../store';
import { errorMessage, uid } from '../lib';
import { Modal, ErrorBox, Field } from './ui';
import { SqlEditor } from './SqlEditor';
export interface TableCreateConfirmationProps { connectionId: string; design: TableDesign; onBack(): void; onClose(): void; onCreated(result: TableCreateApplyOutput, version: number): void; onDirtyChange?(dirty: boolean): void; services?: TableCreateServices; }
/** 只接管现有设计器的确认阶段；原字段/索引/FK表单及已有表修改无需复制或更换生成器。 */
export function TableCreateConfirmation({ connectionId, design, onBack, onClose, onCreated, onDirtyChange, services = tableCreateServices }: TableCreateConfirmationProps) {
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0), profile = useWorkspace(state => state.connections.find(value => value.id === connectionId));
  const fixed = useRef({ connectionId, version, design: structuredClone(design), key: JSON.stringify(design), label: profile ? `${profile.name} · ${profile.host}:${profile.port}` : connectionId });
  const intent = useRef(0), renderedKey = JSON.stringify([connectionId, version, design]), lastKey = useRef(renderedKey), observedVersion = useRef(version);
  if (lastKey.current !== renderedKey) { lastKey.current = renderedKey; intent.current++; }
  const completed = useRef(onCreated), callbacks = useRef({ onBack, onClose, onDirtyChange }); callbacks.current = { onBack, onClose, onDirtyChange };
  const service = useRef(services); service.current = services;
  const fence = useRef(new IndexRequestFence()), alive = useRef(true), invalid = useRef(false), consumed = useRef(false), progress = useRef<TableCreateProgress | null>(null), activeTask = useRef<string | undefined>(undefined);
  const snapshots = useRef(new Set<string>()), tokens = useRef(new Set<string>()), releasing = useRef(new Map<string, Promise<void>>());
  const [snapshot, setSnapshot] = useState<TableCreateGetOutput | null>(null), [preview, setPreview] = useState<TableCreatePreviewOutput | null>(null), [busy, setBusy] = useState(false), [confirmation, setConfirmation] = useState(''), [acks, setAcks] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState(''), [outcome, setOutcome] = useState(''), [attempted, setAttempted] = useState(false), [unknown, setUnknown] = useState(false), [complete, setComplete] = useState(false), [, tick] = useState(0);
  if (connectionId !== fixed.current.connectionId || version !== fixed.current.version || JSON.stringify(design) !== fixed.current.key) invalid.current = true;
  const validTime = (expires: string) => Number.isFinite(Date.parse(expires)) && Date.parse(expires) > Date.now();
  const expired = !!snapshot && !validTime(snapshot.expiresAt) || !!preview && !validTime(preview.expiresAt);
  const editable = !busy && !invalid.current && !expired && !attempted;
  const confirmed = !!preview && confirmation === tableCreateConfirmation(preview.target) && acks.size === tableCreateAcknowledgements.length && tableCreateAcknowledgements.every(id => acks.has(id));
  useEffect(() => { callbacks.current.onDirtyChange?.(!complete || unknown); }, [complete, unknown]);
  useEffect(() => {
    const guard = new IndexRequestFence(); fence.current = guard; alive.current = true;
    // 直接订阅修订，连续B→A即使被React合批也不能复活旧能力。
    const unsubscribe = useWorkspace.subscribe(state => { const next = state.connectionVersions[fixed.current.connectionId] ?? 0; if (next !== observedVersion.current) { observedVersion.current = next; invalid.current = true; intent.current++; if (alive.current) tick(value => value + 1); } });
    void prepare();
    return () => { alive.current = false; unsubscribe(); callbacks.current.onDirtyChange?.(false); if (guard.dispose() && activeTask.current) void service.current.cancel(activeTask.current).catch(report); void releaseAll().catch(report); };
  }, []);
  useEffect(() => services.subscribe((taskId, value) => { if (taskId === activeTask.current) progress.current = value; }), [services]);
  useEffect(() => { const deadlines = [snapshot?.expiresAt, preview?.expiresAt].filter((value): value is string => !!value).map(Date.parse).filter(Number.isFinite); if (!deadlines.length) return; const timer = window.setTimeout(() => tick(value => value + 1), Math.max(1, Math.min(...deadlines) - Date.now() + 1)); return () => window.clearTimeout(timer); }, [snapshot?.expiresAt, preview?.expiresAt]);
  useEffect(() => { const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && ['Enter', 's'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); } }; document.addEventListener('keydown', block, true); return () => document.removeEventListener('keydown', block, true); }, []);
  /** 卸载后的失败只提示宿主，不重开窗口、不重放动作。 */
  function report(reason: unknown) { if (alive.current) setError(errorMessage(reason)); else useWorkspace.getState().notify(errorMessage(reason), true); }
  /** 释放并发共用一个承诺；失败保留令牌责任，不能先退出再遗失资源。 */
  async function releaseOne(kind: 'snapshotId' | 'previewToken', id: string) {
    const key = kind + ':' + id; let promise = releasing.current.get(key);
    if (!promise) { promise = Promise.resolve().then(() => service.current.release({ [kind]: id })).then(() => { (kind === 'snapshotId' ? snapshots.current : tokens.current).delete(id); }); releasing.current.set(key, promise); }
    try { await promise; } finally { if (releasing.current.get(key) === promise) releasing.current.delete(key); }
  }
  async function releaseAll() { const errors: string[] = []; for (const [kind, ids] of [['previewToken', tokens.current], ['snapshotId', snapshots.current]] as const) for (const id of [...ids]) try { await releaseOne(kind, id); } catch (reason) { errors.push(errorMessage(reason)); } if (errors.length) throw Error(errors.join('\n')); }
  /** 同步围栏覆盖准备、执行和全部释放等待；取消控制响应不提前解锁。 */
  function begin(allowInvalid = false) { if (invalid.current && !allowInvalid) return; const guard = fence.current, value = guard.begin(uid()); if (!value) return; activeTask.current = value.taskId; setBusy(true); setError(''); progress.current = null; return { guard, ...value }; }
  type Operation = NonNullable<ReturnType<typeof begin>>;
  const accepts = (op: Operation) => alive.current && op.guard === fence.current && op.guard.accepts(op) && !invalid.current;
  function finish(op: Operation) { op.guard.finish(op); if (alive.current && op.guard === fence.current) setBusy(false); }
  /** 初次只读准备；迟到或StrictMode旧代次只释放自己返回的能力。 */
  async function prepare() {
    const op = begin(); if (!op) return;
    try {
      const parsed = tableCreateDesignSchema.safeParse(fixed.current.design); if (!parsed.success) throw Error(text.invalidDesign); const draft = parsed.data;
      const value = await service.current.get({ connectionId: fixed.current.connectionId, database: draft.database, taskId: op.taskId }); snapshots.current.add(value.snapshotId);
      if (!accepts(op) || value.target.connectionId !== fixed.current.connectionId || value.target.database !== draft.database || !validTime(value.expiresAt)) { await releaseOne('snapshotId', value.snapshotId); return; }
      setSnapshot(value);
      activeTask.current = uid();
      const next = await service.current.preview({ snapshotId: value.snapshotId, design: draft, taskId: activeTask.current }); tokens.current.add(next.previewToken);
      if (!accepts(op) || next.target.connectionId !== fixed.current.connectionId || next.target.database !== draft.database || next.target.table !== draft.name || !validTime(next.expiresAt) || next.requiredAcknowledgements.length !== tableCreateAcknowledgements.length || tableCreateAcknowledgements.some(id => !next.requiredAcknowledgements.includes(id))) { await releaseOne('previewToken', next.previewToken); if (accepts(op)) throw Error(text.response); return; }
      setPreview(next);
    } catch (reason) { if (alive.current && op.guard === fence.current) report(reason); } finally { finish(op); }
  }
  /** 服务器ACK与后核/收尾独立，刷新只针对最初目标；回调异常不能重放CREATE。 */
  function notify(result: TableCreateApplyOutput) { if (invalid.current) { report(text.mismatch); return; } try { completed.current(result, fixed.current.version); } catch (reason) { report(reason); } }
  async function apply() {
    if (!editable || !preview || !snapshot || !confirmed || consumed.current || !validTime(preview.expiresAt) || !validTime(snapshot.expiresAt)) return;
    const op = begin(); if (!op) return; consumed.current = true; setAttempted(true);
    try {
      const result = await service.current.apply({ previewToken: preview.previewToken, confirmation, acknowledgements: [...tableCreateAcknowledgements], taskId: op.taskId });
      if (JSON.stringify(result.target) !== JSON.stringify(preview.target) || result.ddlCompleted !== true || result.ddlSubmitted !== true) throw Error(text.response);
      if (alive.current && op.guard === fence.current) { setComplete(true); setUnknown(!result.definitionVerified || !result.resourcesReleased); setOutcome(!result.resourcesReleased ? text.cleanup : result.definitionVerified ? text.succeeded : text.unverified); setError(result.warnings.join('\n')); }
      notify(result);
    } catch (reason) {
      const actual = progress.current;
      if (alive.current && op.guard === fence.current) { const known = !!actual?.ddlCompleted; setComplete(known); setUnknown(known || !actual || actual.ddlSubmitted || actual.outcome !== 'not-sent'); setOutcome(known ? text.cleanup : actual?.outcome === 'not-sent' && !actual.ddlSubmitted ? text.notSent : text.unknown); }
      if (actual?.ddlCompleted) notify({ target: preview.target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: actual.definitionVerified, resourcesReleased: false, warnings: [text.cleanup] });
      report(reason);
    } finally { finish(op); }
  }
  /** 返回或关闭先失效能力，再等待真实释放；已尝试执行只能关闭保留现场，不能回到可重放草稿。 */
  async function leave(back: boolean) {
    if (fence.current.busy || back && consumed.current || !complete && !window.confirm(unknown ? text.unknownClose : text.discard)) return;
    const op = begin(true); if (!op) return; const ticket = intent.current, done = back ? callbacks.current.onBack : callbacks.current.onClose; setPreview(null);
    try { await releaseAll(); if (alive.current && op.guard === fence.current && intent.current === ticket) done(); } catch (reason) { report(reason); } finally { finish(op); }
  }
  return <Modal title={text.title} wide onClose={() => void leave(false)}><div className="modal-content">
    <p>{text.target}：{fixed.current.label} · {fixed.current.design.database}.{fixed.current.design.name} · {snapshot?.serverVersion}</p>
    {invalid.current && <ErrorBox message={text.mismatch}/ >}{expired && <ErrorBox message={text.expired}/ >}
    {busy && !preview && <p role="status">{text.preparing}</p>}{snapshot?.warnings.map(value => <p key={value} className="warning-text">{value}</p>)}
    {preview && <><h3>{text.sql}</h3><SqlEditor value={preview.sql} readOnly height={300}/><Field label={text.confirmation}><input aria-label={text.confirmation} value={confirmation} disabled={!editable} onChange={event => setConfirmation(event.target.value)}/></Field>
      {tableCreateAcknowledgements.map((id, index) => <label key={id}><input type="checkbox" checked={acks.has(id)} disabled={!editable} onChange={event => setAcks(current => { const next = new Set(current); if (event.target.checked) next.add(id); else next.delete(id); return next; })}/>{index ? text.ackCreate : text.ackDdl}</label>)}</>}
    {outcome && <p role="status">{outcome}</p>}<ErrorBox message={error}/>
  </div><footer className="modal-footer"><button disabled={busy} onClick={() => void leave(false)}>{text.close}</button><button disabled={busy || attempted} onClick={() => void leave(true)}>{text.back}</button>{busy && <button onClick={() => { if (fence.current.cancel() && activeTask.current) void service.current.cancel(activeTask.current).catch(report); }}>{text.cancel}</button>}<span className="grow"/><button className="primary" disabled={!editable || !confirmed} onClick={() => void apply()}>{text.apply}</button></footer></Modal>;
}
