import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DatabaseObject, TableInfo, TaskEvent } from '../../shared/contracts';
import { resultInsertConfirmation, resultInsertPreviewInputSchema, resultInsertReleaseInputSchema, resultInsertTimeZoneSchema, type ResultInsertApplyInput, type ResultInsertApplyOutput, type ResultInsertMapping, type ResultInsertPreviewInput, type ResultInsertPreviewOutput, type ResultInsertProgress, type ResultInsertTarget } from '../../shared/resultInsert';
import { ResultInsertSourceIntent, checkResultInsertApplied, checkResultInsertMapping, checkResultInsertPreview, mergeResultInsertProgress, resultInsertWritableColumns, suggestResultInsertMapping } from '../resultInsertUi';
import { resultInsertZh as text } from '../locales/resultInsert.zh-CN';
import { errorMessage, invoke, uid } from '../lib';
import { useWorkspace } from '../store';
import { ErrorBox, Field, Modal, Spinner } from './ui';

export interface ResultInsertServices {
  open(connectionId: string): Promise<unknown>; databases(connectionId: string): Promise<string[]>;
  objects(target: Pick<ResultInsertTarget, 'connectionId' | 'database'>): Promise<DatabaseObject[]>;
  metadata(target: ResultInsertTarget): Promise<TableInfo>;
  preview(input: ResultInsertPreviewInput): Promise<ResultInsertPreviewOutput>;
  apply(input: ResultInsertApplyInput): Promise<ResultInsertApplyOutput>;
  release(input: { connectionId: string; previewToken: string }): Promise<unknown>;
  cancel(taskId: string): Promise<unknown>; subscribe(listener: (event: TaskEvent) => void): () => void;
}
const services: ResultInsertServices = {
  open: id => invoke('connections.open', { id }), databases: connectionId => invoke('metadata.databases', { connectionId }), objects: input => invoke('metadata.objects', input), metadata: input => invoke('metadata.table', input),
  preview: input => invoke('result.insertPreview', input), apply: input => invoke('result.insertApply', input), release: input => invoke('result.insertRelease', input), cancel: taskId => invoke('query.cancel', { taskId }), subscribe: listener => window.dbark.onTask(listener),
};
interface Props { intent: ResultInsertSourceIntent; initialConnectionId?: string; services?: ResultInsertServices; onActivity(delta: 1 | -1): void; onClose(): void; onCommitted(output: ResultInsertApplyOutput): void; onCleanupError(message: string): void; }
interface Draft { connectionId: string; database: string; table: string; timeZone: string; mapping: ResultInsertMapping[]; databases: string[]; tables: string[]; info?: TableInfo; }
interface Operation { kind: 'catalogue' | 'preview' | 'apply'; revision: number; promise: Promise<void>; taskId?: string; cancel?: Promise<void>; cancelled: boolean; dispatched?: boolean; progress?: ResultInsertProgress; preview?: ResultInsertPreviewOutput; }

/** 结果写入是独立用途；目标每层显式读取，预览与一次提交均不重放原查询。 */
export function ResultInsertDialog({ intent, initialConnectionId = '', services: port = services, ...callbacks }: Props) {
  const owner = useRef({ intent, port, callbacks }).current;
  const profiles = useWorkspace(state => state.connections), connections = profiles.filter(profile => profile.dialect === 'mysql' || profile.dialect === 'mariadb');
  const [draft, setDraft] = useState<Draft>({ connectionId: initialConnectionId, database: '', table: '', timeZone: '+00:00', mapping: [], databases: [], tables: [] }), live = useRef(draft); live.current = draft;
  const [preview, setPreview] = useState<ResultInsertPreviewOutput>(), previewRef = useRef<ResultInsertPreviewOutput | undefined>(undefined);
  const [confirmation, setConfirmation] = useState(''), [acknowledged, setAcknowledged] = useState(false), [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [error, setError] = useState(''), [stale, setStale] = useState(false), [progress, setProgress] = useState<ResultInsertProgress>(), [done, setDone] = useState<ResultInsertApplyOutput>(), [clock, setClock] = useState(Date.now());
  const mounted = useRef(true), closed = useRef(false), invalid = useRef(false), consumed = useRef(false), revision = useRef(0), committed = useRef<object | undefined>(undefined), operation = useRef<Operation | undefined>(undefined);
  const targetOwner = useRef<{ connectionId: string; profile: unknown; version: number } | undefined>(undefined), releases = useRef(new Map<string, { connectionId: string; previewToken: string }>()), releasing = useRef(new Map<string, Promise<void>>());
  const ticket = {};
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = undefined; }; });
  if (intent !== owner.intent || port !== owner.port) invalid.current = true;
  function replace(value: Draft): void { live.current = value; setDraft(value); }
  function cleanup(reason: unknown): void { try { owner.callbacks.onCleanupError(errorMessage(reason)); } catch {} }
  /** 源租约只单向撤销；旧渲染、其它模态或后继窗口不能接管原任务。 */
  function current(): boolean { if (!mounted.current || closed.current || invalid.current) return false; if (!owner.intent.current()) { invalid.current = true; setStale(true); return false; } return true; }
  function editable(): boolean { return committed.current === ticket && live.current === draft && !operation.current && !consumed.current && current(); }
  function valid(active: Operation): boolean { return operation.current === active && active.revision === revision.current && !active.cancelled && current(); }
  function target(value = live.current): ResultInsertTarget { return { connectionId: value.connectionId, database: value.database, table: value.table }; }
  /** 每个原令牌独立收尾；失败保留责任，下一次预览及关闭都先等待它。 */
  async function release(value: { connectionId: string; previewToken: string }): Promise<void> {
    const key = value.connectionId + ':' + value.previewToken; releases.current.set(key, value);
    let pending = releasing.current.get(key);
    if (!pending) { pending = owner.port.release(value).then(() => { releases.current.delete(key); }); releasing.current.set(key, pending); }
    try { await pending; } finally { if (releasing.current.get(key) === pending) releasing.current.delete(key); }
  }
  async function drain(): Promise<void> { for (const value of [...releases.current.values()]) await release(value); }
  function revokePreview(): void { const old = previewRef.current; previewRef.current = undefined; setPreview(undefined); setConfirmation(''); setAcknowledged(false); if (old) void release({ connectionId: old.target.connectionId, previewToken: old.previewToken }).catch(cleanup); }
  /** 目标/映射/时区修改立即换代，A→B→A不重新允许旧预览或旧回调。 */
  function change(next: Draft, connectionChanged = false): void { if (!editable()) return; revision.current++; revokePreview(); if (connectionChanged) targetOwner.current = undefined; replace(next); setError(''); setProgress(undefined); }
  /** 只能取消未进入COMMIT的原任务；目录无taskId时等待原读取自然终结。 */
  function cancel(active = operation.current): void {
    if (!active || active.cancelled || active.kind === 'apply' && (active.progress?.commitMayHaveBeenSent || active.progress?.commitAcknowledged)) return;
    active.cancelled = true;
    if (active.taskId) active.cancel = Promise.resolve().then(() => owner.port.cancel(active.taskId!)).then(() => undefined).catch(cleanup);
    if (mounted.current && !closed.current) setError(text.cancelling);
  }
  /** 通用占门一直保留至原Promise与取消ACK均终结，进度事件不能提前释放。 */
  function start(kind: Operation['kind'], action: (active: Operation) => Promise<void>, taskId?: string, expected?: ResultInsertPreviewOutput): void {
    if (!editable()) return;
    try { owner.callbacks.onActivity(1); } catch (reason) { setError(errorMessage(reason)); return; }
    setBusy(true); setError(''); let active: Operation;
    const promise = Promise.resolve().then(async () => { if (valid(active)) await action(active); }).catch(reason => { if (mounted.current && !closed.current && active.revision === revision.current) setError(errorMessage(reason)); }).finally(async () => {
      if (active.cancel) await active.cancel;
      if (active.kind === 'apply' && !active.dispatched && active.preview) {
        try { await release({ connectionId: active.preview.target.connectionId, previewToken: active.preview.previewToken }); } catch (reason) { cleanup(reason); }
        if (mounted.current && !closed.current) setError(text.notSent);
      }
      if (active.kind === 'preview' && (active.cancelled || closed.current || invalid.current || active.revision !== revision.current)) { const old = previewRef.current; if (old) { previewRef.current = undefined; try { await release({ connectionId: old.target.connectionId, previewToken: old.previewToken }); } catch (reason) { cleanup(reason); } } }
      if (operation.current === active) operation.current = undefined;
      try { owner.callbacks.onActivity(-1); } catch (reason) { cleanup(reason); }
      if (mounted.current) { setBusy(false); if (active.kind === 'preview' && active.cancelled && !closed.current) setError(text.previewCancelled); }
    });
    active = { kind, taskId, revision: revision.current, promise, cancelled: false, preview: expected }; operation.current = active;
  }
  /** 目录依次读取，不自动选择首库首表；目标连接的原配置也在每个await后核对。 */
  function catalogue(kind: 'databases' | 'tables' | 'metadata'): void {
    if (!editable() || !draft.connectionId || kind !== 'databases' && !draft.database || kind === 'metadata' && !draft.table) return;
    const chosen = draft, state = useWorkspace.getState(), profile = state.connections.find(item => item.id === chosen.connectionId);
    if (!profile) { setError(text.targetChanged); return; }
    revision.current++; revokePreview();
    targetOwner.current = { connectionId: chosen.connectionId, profile, version: state.connectionVersions[chosen.connectionId] ?? 0 };
    start('catalogue', async active => {
      await drain(); if (!valid(active)) return;
      await owner.port.open(chosen.connectionId); if (!valid(active)) return;
      if (kind === 'databases') { const databases = await owner.port.databases(chosen.connectionId); if (valid(active)) replace({ ...chosen, databases: [...databases], database: '', table: '', tables: [], info: undefined, mapping: [] }); }
      else if (kind === 'tables') { const objects = await owner.port.objects({ connectionId: chosen.connectionId, database: chosen.database }); if (valid(active)) replace({ ...chosen, tables: objects.filter(item => item.kind === 'table').map(item => item.name), table: '', info: undefined, mapping: [] }); }
      else { const info = await owner.port.metadata(target(chosen)); if (!valid(active)) return; if (info.database !== chosen.database || info.name !== chosen.table || info.objectKind !== 'table') throw Error(text.invalid); resultInsertWritableColumns(info); replace({ ...chosen, info: structuredClone(info), mapping: suggestResultInsertMapping(owner.intent.data, info) }); }
    });
  }
  /** 原请求含完整typed快照；所有回包先与原目标、映射、时区、总行数一一回证。 */
  function prepare(): void {
    if (!editable() || !draft.info || !targetOwner.current) return;
    let input: ResultInsertPreviewInput;
    try { if (!resultInsertTimeZoneSchema.safeParse(draft.timeZone).success) throw Error(text.timeZoneInvalid); input = resultInsertPreviewInputSchema.parse({ ...target(), taskId: uid(), data: owner.intent.data, mapping: checkResultInsertMapping(owner.intent.data, draft.info, draft.mapping), timeZone: draft.timeZone }); }
    catch (reason) { setError(errorMessage(reason)); return; }
    revokePreview(); setProgress(undefined);
    start('preview', async active => {
      await drain(); if (!valid(active)) return;
      await owner.port.open(input.connectionId); if (!valid(active)) return;
      const raw = await owner.port.preview(input);
      const token = resultInsertReleaseInputSchema.safeParse({ connectionId: input.connectionId, previewToken: raw?.previewToken });
      if (token.success) releases.current.set(token.data.connectionId + ':' + token.data.previewToken, token.data);
      const result = checkResultInsertPreview(raw, input);
      if (!valid(active)) { if (token.success) await release(token.data); return; }
      releases.current.delete(input.connectionId + ':' + result.previewToken); previewRef.current = result; setPreview(result); setClock(Date.now());
    }, input.taskId);
  }
  /** 首次await前消费；apply仅传一次性token，不携带原SQL或再次发送数据。 */
  function apply(): void {
    if (!editable()) return; const expected = previewRef.current;
    if (!expected || Date.parse(expected.expiresAt) <= Date.now() || confirmation !== resultInsertConfirmation(expected.target) || !acknowledged) return;
    const input: ResultInsertApplyInput = { connectionId: expected.target.connectionId, taskId: uid(), previewToken: expected.previewToken, confirmation, acknowledged: true };
    start('apply', async active => {
      let output: ResultInsertApplyOutput | undefined;
      try { active.dispatched = true; output = checkResultInsertApplied(await owner.port.apply(input), expected); }
      catch (reason) {
        if (active.progress?.commitAcknowledged) { output = { target: expected.target, rows: expected.rows, outcome: 'committed', commitAcknowledged: true }; if (mounted.current && !closed.current) setError(`${text.committedCleanup} ${errorMessage(reason)}`); }
        else if (mounted.current && !closed.current) setError(`${active.progress?.outcome === 'rolled-back' && active.progress.rollbackAcknowledged && active.progress.transactionProtected ? text.rolledBack : active.progress?.outcome === 'not-sent' && !active.progress.dmlMayHaveBeenSent ? text.notSent : text.unknown} ${errorMessage(reason)}`);
      }
      if (output) { if (mounted.current && !closed.current) setDone(output); try { owner.callbacks.onCommitted(output); } catch (reason) { cleanup(reason); } }
    }, input.taskId, expected);
    // 同事件栈即消费；若取消/失效使IPC尚未发送，finally只释放原token并报告未发送。
    if (operation.current?.taskId === input.taskId) { consumed.current = true; previewRef.current = undefined; }
  }
  /** 关闭不能force释放运行中资源，COMMIT后只等待ACK，不再发送取消。 */
  function close(): void {
    if (!mounted.current || closed.current || committed.current !== ticket) return;
    closed.current = true; setClosing(true); const active = operation.current; cancel(active);
    const old = previewRef.current; previewRef.current = undefined; setPreview(undefined); setConfirmation(''); setAcknowledged(false);
    if (old) releases.current.set(old.target.connectionId + ':' + old.previewToken, { connectionId: old.target.connectionId, previewToken: old.previewToken });
    void (async () => {
      try { if (active) { await active.promise; await active.cancel; } await drain(); if (mounted.current) owner.callbacks.onClose(); }
      catch (reason) { cleanup(reason); if (mounted.current) { closed.current = false; setClosing(false); setError(errorMessage(reason)); } }
    })();
  }
  useEffect(() => {
    mounted.current = true;
    const unsubscribeIntent = owner.intent.subscribe(() => { invalid.current = true; if (mounted.current) setStale(true); cancel(); });
    const unsubscribeStore = useWorkspace.subscribe(state => {
      const original = targetOwner.current; if (!original) return;
      if (state.connections.find(item => item.id === original.connectionId) !== original.profile || (state.connectionVersions[original.connectionId] ?? 0) !== original.version) {
        targetOwner.current = undefined; revision.current++; revokePreview(); cancel(); if (mounted.current && !closed.current) { replace({ ...live.current, database: '', table: '', databases: [], tables: [], info: undefined, mapping: [] }); setError(text.targetChanged); }
      }
    });
    const unsubscribeTask = owner.port.subscribe(event => {
      const active = operation.current; if (!active || event.taskId !== active.taskId || active.kind !== 'apply') return;
      active.progress = mergeResultInsertProgress(active.progress, (event as TaskEvent & { resultInsert?: unknown }).resultInsert, active.preview?.rows);
      if (mounted.current && !closed.current) { setProgress(active.progress); if (active.progress?.commitAcknowledged && active.preview) setDone({ target: active.preview.target, rows: active.preview.rows, outcome: 'committed', commitAcknowledged: true }); }
    });
    const inspect = () => { const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]'); if (dialogs.length !== 1 || dialogs[0].querySelector('[data-result-insert-owner]')?.getAttribute('data-result-insert-owner') !== owner.intent.owner) owner.intent.invalidate(); };
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(inspect) : undefined; observer?.observe(document.body, { childList: true, subtree: true }); inspect();
    const timer = setInterval(() => { if (mounted.current) setClock(Date.now()); }, 1000);
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } }; document.addEventListener('keydown', block, true);
    return () => { mounted.current = false; unsubscribeIntent(); unsubscribeStore(); observer?.disconnect(); clearInterval(timer); document.removeEventListener('keydown', block, true); const active = operation.current; cancel(active); const old = previewRef.current; previewRef.current = undefined; if (old) releases.current.set(old.target.connectionId + ':' + old.previewToken, { connectionId: old.target.connectionId, previewToken: old.previewToken }); void (async () => { try { if (active) { await active.promise; await active.cancel; } await drain(); } finally { unsubscribeTask(); } })().catch(cleanup); };
  }, []);
  const disabled = busy || closing || stale || invalid.current || consumed.current, expired = !!preview && Date.parse(preview.expiresAt) <= clock;
  const writable = draft.info ? resultInsertWritableColumns(draft.info) : [];
  return <Modal title={text.title} wide onClose={close}><div className="modal-content" data-result-insert-owner={owner.intent.owner} aria-busy={busy || closing}>
    <p>{text.source(owner.intent.data.rows.length, owner.intent.data.columns.length, owner.intent.selected)}</p><p>{text.scope}</p>{owner.intent.data.truncated && <p className="warning-text">{text.truncated}</p>}
    <div className="form-grid"><Field label={text.connection}><select aria-label={text.connection} disabled={disabled} value={draft.connectionId} onChange={event => change({ ...draft, connectionId: event.target.value, database: '', table: '', databases: [], tables: [], info: undefined, mapping: [] }, true)}><option value="">{text.choose}</option>{connections.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></Field><button disabled={disabled || !draft.connectionId} onClick={() => catalogue('databases')}>{text.databases}</button>
      <Field label={text.database}><select aria-label={text.database} disabled={disabled} value={draft.database} onChange={event => change({ ...draft, database: event.target.value, table: '', tables: [], info: undefined, mapping: [] })}><option value="">{text.choose}</option>{draft.databases.map(name => <option key={name} value={name}>{name}</option>)}</select></Field><button disabled={disabled || !draft.database} onClick={() => catalogue('tables')}>{text.tables}</button>
      <Field label={text.table}><select aria-label={text.table} disabled={disabled} value={draft.table} onChange={event => change({ ...draft, table: event.target.value, info: undefined, mapping: [] })}><option value="">{text.choose}</option>{draft.tables.map(name => <option key={name} value={name}>{name}</option>)}</select></Field><button disabled={disabled || !draft.table} onClick={() => catalogue('metadata')}>{text.metadata}</button></div>
    <Field label={text.timeZone}><input aria-label={text.timeZone} value={draft.timeZone} maxLength={6} disabled={disabled} onChange={event => change({ ...draft, timeZone: event.target.value })}/></Field><p className="warning-text">{text.timeZoneHint}</p>
    {draft.info && <section aria-label={text.mapping}><strong>{text.mapping}</strong><p>{text.mappingHint}</p>{owner.intent.data.columns.map((column, index) => <Field key={column.key} label={text.sourceColumn(index + 1, column.name, column.key)}><select aria-label={text.mappingColumn(column.key)} value={draft.mapping.find(item => item.source === column.key)?.target ?? ''} disabled={disabled} onChange={event => change({ ...draft, mapping: [...draft.mapping.filter(item => item.source !== column.key), ...(event.target.value ? [{ source: column.key, target: event.target.value }] : [])] })}><option value="">{text.skip}</option>{writable.map(name => <option key={name} value={name} disabled={draft.mapping.some(item => item.target === name && item.source !== column.key)}>{name}</option>)}</select></Field>)}</section>}
    <p>{text.previewScope}</p>{busy && <Spinner text={operation.current?.kind === 'apply' ? text.applying : operation.current?.kind === 'preview' ? text.previewing : text.loading}/>}{closing && <p>{text.closing}</p>}{progress?.commitMayHaveBeenSent && !progress.commitAcknowledged && <p className="warning-text">{text.committing}</p>}
    {preview && <section><strong>{text.target(preview.target.database, preview.target.table)}</strong><p>{text.sample(preview.shownRows, preview.rows)}</p><ul>{preview.mapping.map(item => <li key={item.source}>{text.sourceColumn(owner.intent.data.columns.findIndex(column => column.key === item.source) + 1, owner.intent.data.columns.find(column => column.key === item.source)?.name ?? '', item.source)} → {item.target}</li>)}</ul>{preview.warnings.map((warning, index) => <p className="warning-text" key={index}>{warning}</p>)}<pre className="sql-preview" aria-label={text.sql}>{preview.sql}</pre><Field label={text.confirmation}><textarea rows={2} aria-label={text.confirmation} value={confirmation} disabled={disabled || expired} onChange={event => { if (editable()) setConfirmation(event.target.value); }}/></Field><label><input type="checkbox" aria-label={text.acknowledge} checked={acknowledged} disabled={disabled || expired} onChange={event => { if (editable()) setAcknowledged(event.target.checked); }}/>{text.acknowledge}</label></section>}
    {done && <p className="success-box" role="status">{text.committed(done.rows)}</p>}<ErrorBox message={stale || invalid.current ? text.stale : error || (expired && !consumed.current ? text.expired : '')}/>{consumed.current && !done && !busy && <p className="warning-text">{text.consumed}</p>}
  </div><footer className="modal-footer"><button disabled={closing} onClick={close}>{text.close}</button><span className="grow"/>{busy && operation.current?.taskId && <button disabled={closing || operation.current.cancelled || !!operation.current.progress?.commitMayHaveBeenSent || !!operation.current.progress?.commitAcknowledged} onClick={() => { if (committed.current === ticket) cancel(); }}>{text.cancel}</button>}<button disabled={disabled || !draft.info || !draft.mapping.length} onClick={prepare}>{text.preview}</button><button className="primary" disabled={disabled || expired || !preview || confirmation !== (preview ? resultInsertConfirmation(preview.target) : '') || !acknowledged} onClick={apply}>{text.apply}</button></footer></Modal>;
}
