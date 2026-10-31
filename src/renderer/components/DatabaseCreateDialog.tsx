import { connectionOverview } from '../sqliteWorkspace';
import { useEffect, useRef, useState } from 'react';
import type { DatabaseCreateGetOutput, DatabaseCreatePreviewOutput, DatabaseCreateProgress, DatabaseCreateApplyOutput } from '../../shared/databaseCreate';
import { databaseCreateAcknowledgements, databaseCreateSelection, validateDatabaseCreateName } from '../../shared/databaseCreate';
import { sameTableEncodingPair } from '../../shared/tableDefaultEncoding';
import { IndexRequestFence } from '../indexPatches';
import { invoke, errorMessage, uid } from '../lib';
import { useWorkspace } from '../store';
import { databaseCreateZh as text } from '../locales/databaseCreate.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import { SqlEditor } from './SqlEditor';

export interface DatabaseCreateServices {
  get(connectionId: string, taskId: string): Promise<DatabaseCreateGetOutput>;
  preview(input: { snapshotId: string; name: string; charset: string; collation: string; taskId: string }): Promise<DatabaseCreatePreviewOutput>;
  apply(input: { previewToken: string; confirmation: string; acknowledgements: string[]; taskId: string }): Promise<DatabaseCreateApplyOutput>;
  release(input: { snapshotId?: string; previewToken?: string }): Promise<void>;
  cancel(taskId: string): Promise<void>;
  subscribe(listener: (taskId: string, progress: DatabaseCreateProgress) => void): () => void;
}
/** 无默认库的连接也可准备目录；生产适配器不接收用户SQL、无写入fallback或重试。 */
export const databaseCreateServices: DatabaseCreateServices = {
  get: async (connectionId, taskId) => { await invoke('connections.open', { id: connectionId }); return invoke('schema.databaseCreate.get', { connectionId, taskId }); },
  preview: input => invoke('schema.databaseCreate.preview', input), apply: input => invoke('schema.databaseCreate.apply', input),
  release: input => invoke('schema.databaseCreate.release', input), cancel: taskId => invoke('query.cancel', { taskId }),
  subscribe: listener => window.dbark.onTask(event => { if (event.databaseCreate) listener(event.taskId, event.databaseCreate); }),
};
interface Props { connectionId: string; onClose(): void; onApplied(): void; onDirtyChange?(dirty: boolean): void; services?: DatabaseCreateServices; }
/** 一窗固定连接与修订；目录只读、配对受控、预览只读，必须明确确认且最多执行一次。 */
export function DatabaseCreateDialog({ connectionId, onClose, onApplied, onDirtyChange, services = databaseCreateServices }: Props) {
  const version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0), profile = useWorkspace(state => state.connections.find(value => value.id === connectionId));
  const fixed = useRef({ connectionId, version, label: profile ? `${profile.name} · ${connectionOverview(profile)}` : connectionId });
  const service = useRef(services); service.current = services;
  const callbacks = useRef({ onClose, onApplied, onDirtyChange }); callbacks.current = { onClose, onApplied, onDirtyChange };
  const fence = useRef(new IndexRequestFence()), alive = useRef(true), consumedRef = useRef(false), progress = useRef<DatabaseCreateProgress | null>(null);
  const snapshots = useRef(new Set<string>()), tokens = useRef(new Set<string>());
  const [snapshot, setSnapshot] = useState<DatabaseCreateGetOutput | null>(null), [preview, setPreview] = useState<DatabaseCreatePreviewOutput | null>(null);
  const [name, setName] = useState(''), [charset, setCharset] = useState(''), [collation, setCollation] = useState(''), [confirmation, setConfirmation] = useState('');
  const [acks, setAcks] = useState<ReadonlySet<string>>(new Set()), [busy, setBusy] = useState(false), [consumed, setConsumed] = useState(false), [complete, setComplete] = useState(false), [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(''), [outcome, setOutcome] = useState(''), [clock, setClock] = useState(Date.now());
  const mismatch = fixed.current.connectionId !== connectionId || fixed.current.version !== version, mismatchRef = useRef(mismatch); mismatchRef.current = mismatch;
  const dirty = !complete && (!!name || !!charset || !!collation || !!preview) || uncertain;
  const expired = !!snapshot && !current(snapshot.expiresAt) || !!preview && !current(preview.expiresAt);
  const editable = !busy && !mismatch && !expired && !consumed && !!snapshot?.writable;
  // clock触发TTL重绘；最终动作仍用同步真实时间重核，不以计时器精度作为授权。
  void clock;
  useEffect(() => { callbacks.current.onDirtyChange?.(dirty); }, [dirty]);
  useEffect(() => {
    const guard = new IndexRequestFence(); fence.current = guard; alive.current = true; void read();
    return () => { alive.current = false; callbacks.current.onDirtyChange?.(false); const id = guard.dispose(); if (id) void service.current.cancel(id).catch(report); void releaseAll().catch(report); };
  }, []);
  useEffect(() => services.subscribe((id, value) => { if (id === fence.current.taskId) progress.current = value; }), [services]);
  useEffect(() => {
    const times = [snapshot?.expiresAt, preview?.expiresAt].filter((value): value is string => !!value).map(Date.parse).filter(Number.isFinite); if (!times.length) return;
    const timer = window.setTimeout(() => setClock(Date.now()), Math.max(1, Math.min(...times) - Date.now() + 1)); return () => window.clearTimeout(timer);
  }, [snapshot?.expiresAt, preview?.expiresAt]);
  useEffect(() => { const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } }; document.addEventListener('keydown', block, true); return () => document.removeEventListener('keydown', block, true); }, []);
  /** 非法或到期的TTL从不被当成永久有效。 */
  function current(value: string): boolean { const time = Date.parse(value); return Number.isFinite(time) && time > Date.now(); }
  /** 卸载后的清理错误交宿主提示，不能复活已离开的表单。 */
  function report(reason: unknown, operation?: Operation): void { if (alive.current && (!operation || operation.guard === fence.current)) setError(errorMessage(reason)); else useWorkspace.getState().notify(errorMessage(reason), true); }
  /** 迟到响应只释放自己签发的令牌，不能清理新代次已接受的目录。 */
  async function releaseOne(kind: 'snapshotId' | 'previewToken', id: string): Promise<void> {
    await service.current.release({ [kind]: id }); (kind === 'snapshotId' ? snapshots.current : tokens.current).delete(id);
  }
  /** 两类令牌各自释放；失败项继续保留清理责任，不跳过后续令牌。 */
  async function releaseAll(previewsOnly = false): Promise<void> {
    const errors: string[] = [];
    for (const [kind, values] of [['previewToken', tokens.current], ...(!previewsOnly ? [['snapshotId', snapshots.current] as const] : [])] as const) {
      for (const id of [...values]) try { await releaseOne(kind, id); } catch (reason) { errors.push(errorMessage(reason)); }
    }
    if (errors.length) throw Error(errors.join('\n'));
  }
  /** 同步锁拒绝双击和重入，取消请求结束不提前解除原任务忙态。 */
  function begin(allowMismatch = false) { if (mismatchRef.current && !allowMismatch) return; const guard = fence.current, operation = guard.begin(uid()); if (!operation) return; setBusy(true); setError(''); progress.current = null; return { guard, ...operation }; }
  type Operation = NonNullable<ReturnType<typeof begin>>;
  /** 只接受当前窗口当前代次的响应；迟到令牌只允许外部释放。 */
  function accepts(operation: Operation) { return alive.current && operation.guard === fence.current && operation.guard.accepts(operation) && !mismatchRef.current; }
  /** 等真实请求finally才恢复按钮，不以取消控制请求代替服务器终态。 */
  function finish(operation: Operation) { operation.guard.finish(operation); if (alive.current && operation.guard === fence.current) setBusy(false); }
  /** 重读使旧预览立即失效；目录响应必须属于同一连接且仍在TTL内。 */
  async function read() {
    if (fence.current.busy || mismatchRef.current || dirty && !window.confirm(uncertain ? text.unknownClose : text.discard)) return;
    const operation = begin(); if (!operation) return;
    setSnapshot(null); setPreview(null); setAcks(new Set());
    try {
      await releaseAll(); if (!accepts(operation)) return;
      const value = await service.current.get(fixed.current.connectionId, operation.taskId); snapshots.current.add(value.snapshotId);
      if (!accepts(operation) || value.target.connectionId !== fixed.current.connectionId || !current(value.expiresAt)) { await releaseOne('snapshotId', value.snapshotId); if (accepts(operation)) throw Error(text.mismatch); return; }
      setSnapshot(value); setCharset(''); setCollation(''); setConfirmation(''); consumedRef.current = false; setConsumed(false); setComplete(false); setUncertain(false); setOutcome(''); setClock(Date.now());
    } catch (reason) { report(reason, operation); } finally { finish(operation); }
  }
  /** 只提交名称和目录配对；预览响应必须精确匹配原目录、目标与草稿。 */
  async function prepare() {
    if (!editable || !snapshot || preview) return;
    const operation = begin(); if (!operation) return;
    try {
      validateDatabaseCreateName(name); databaseCreateSelection({ charset, collation }, snapshot.candidates);
      const value = await service.current.preview({ snapshotId: snapshot.snapshotId, name, charset, collation, taskId: operation.taskId }); tokens.current.add(value.previewToken);
      if (!accepts(operation) || value.target.connectionId !== fixed.current.connectionId || value.name !== name || value.catalogDigest !== snapshot.catalogDigest || !sameTableEncodingPair(value.selection, { charset, collation }) || !current(value.expiresAt) || value.requiredAcknowledgements.length !== databaseCreateAcknowledgements.length || databaseCreateAcknowledgements.some(valueId => !value.requiredAcknowledgements.includes(valueId))) { await releaseOne('previewToken', value.previewToken); if (accepts(operation)) throw Error(text.previewMismatch); return; }
      setPreview(value); setConfirmation(''); setAcks(new Set());
    } catch (reason) { report(reason, operation); } finally { finish(operation); }
  }
  const confirmed = !!preview && confirmation === preview.name && acks.size === databaseCreateAcknowledgements.length && databaseCreateAcknowledgements.every(value => acks.has(value));
  /** 树刷新回调异常不能抹掉服务器已经完成的事实，也不能触发第二次创建。 */
  function notifyCompletion(operation: Operation) { try { callbacks.current.onApplied(); } catch (reason) { report(reason, operation); } }
  /** 确认前同步消费预览；失败结果缺少证明时标未知，绝不自动重建或重放预览。 */
  async function apply() {
    if (!editable || !preview || !snapshot || !confirmed || consumedRef.current || !current(preview.expiresAt) || !current(snapshot.expiresAt)) return;
    const operation = begin(); if (!operation) return; consumedRef.current = true; setConsumed(true);
    try {
      const result = await service.current.apply({ previewToken: preview.previewToken, confirmation, acknowledgements: [...databaseCreateAcknowledgements], taskId: operation.taskId });
      if (result.name !== preview.name) throw Error(text.previewMismatch);
      if (alive.current && operation.guard === fence.current) { setComplete(true); setUncertain(!result.definitionVerified); setOutcome(result.definitionVerified ? text.succeeded : text.unverified); setError(result.warnings.join('\n')); }
      notifyCompletion(operation);
    } catch (reason) {
      const actual = progress.current;
      if (alive.current && operation.guard === fence.current) {
        if (actual?.ddlCompleted) { setComplete(true); setUncertain(!actual.definitionVerified); setOutcome(actual.definitionVerified ? text.succeeded : text.unverified); }
        else { const notSent = actual?.outcome === 'not-sent' && !actual.ddlSubmitted; setUncertain(!notSent); setOutcome(notSent ? text.notSent : text.unknown); }
      }
      if (actual?.ddlCompleted) notifyCompletion(operation);
      report(reason, operation);
    } finally { finish(operation); }
  }
  /** 取消不消费新的预览，也不解除原请求同步锁。 */
  async function cancel() { const id = fence.current.cancel(); if (id) try { await service.current.cancel(id); } catch (reason) { report(reason); } }
  /** 关闭先确认草稿/未知状态并释放令牌，忙态不能离开窗口。 */
  async function close() {
    if (fence.current.busy || dirty && !window.confirm(uncertain ? text.unknownClose : text.discard)) return;
    const operation = begin(true); if (!operation) return;
    try { await releaseAll(); callbacks.current.onClose(); } catch (reason) { report(reason, operation); } finally { finish(operation); }
  }
  /** 返回编辑先失效旧预览；已尝试执行的窗口必须显式重读目录。 */
  async function back() { if (fence.current.busy || consumedRef.current) return; const operation = begin(); if (!operation) return; setPreview(null); setAcks(new Set()); try { await releaseAll(true); } catch (reason) { report(reason, operation); } finally { finish(operation); } }
  return <Modal title={text.title} wide onClose={() => void close()}><div className="modal-content">
    <p>{text.target}：{fixed.current.label} · {snapshot?.serverVersion}</p>{mismatch && <ErrorBox message={text.mismatch}/>}{expired && <ErrorBox message={text.expired}/>}
    {snapshot && !snapshot.writable && <p className="warning-text">{text.readonly}</p>}
    {snapshot?.reasons.map(reason => <p className="warning-text" key={reason}>{reason}</p>)}
    {snapshot?.warnings.map(warning => <p className="warning-text small" key={warning}>{warning}</p>)}
    {!preview && <div className="form-grid"><Field label={text.name}><input aria-label={text.name} disabled={!editable} value={name} onChange={event => setName(event.target.value)}/></Field>
      <Field label={text.charset}><select aria-label={text.charset} disabled={!editable} value={charset} onChange={event => { setCharset(event.target.value); setCollation(''); }}><option value="">{text.choose}</option>{[...new Set(snapshot?.candidates.map(value => value.charset) ?? [])].map(value => <option key={value}>{value}</option>)}</select></Field>
      <Field label={text.collation}><select aria-label={text.collation} disabled={!editable || !charset} value={collation} onChange={event => setCollation(event.target.value)}><option value="">{text.choose}</option>{snapshot?.candidates.filter(value => value.charset === charset).map(value => <option key={value.collation}>{value.collation}</option>)}</select></Field></div>}
    {preview && <><h3>{text.sql}</h3><SqlEditor value={preview.sql} readOnly height={260}/><Field label={text.confirmation}><input aria-label={text.confirmation} disabled={!editable} value={confirmation} onChange={event => setConfirmation(event.target.value)}/></Field>
      {databaseCreateAcknowledgements.map((id, position) => <label className="checkbox-field" key={id}><input type="checkbox" disabled={!editable} checked={acks.has(id)} onChange={event => setAcks(current => { const next = new Set(current); if (event.target.checked) next.add(id); else next.delete(id); return next; })}/>{position ? text.ackCreate : text.ackDdl}</label>)}</>}
    {outcome && <p role="status">{outcome}</p>}<ErrorBox message={error}/>
  </div><footer className="modal-footer"><button disabled={busy} onClick={() => void close()}>关闭</button><button disabled={busy || mismatch} onClick={() => void read()}>{text.read}</button>{busy && <button onClick={() => void cancel()}>{text.cancel}</button>}<span className="grow"/>
    {preview ? <><button disabled={busy || consumed} onClick={() => void back()}>{text.back}</button><button className="primary" disabled={!editable || !confirmed} onClick={() => void apply()}>{text.apply}</button></> : <button className="primary" disabled={!editable || !name || !charset || !collation} onClick={() => void prepare()}>{text.preview}</button>}
  </footer></Modal>;
}
