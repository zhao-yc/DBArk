import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TaskEvent } from '../../shared/contracts';
import { sqliteTableRenameFactMessage } from '../../shared/sqliteTableRenameFact';
import { sqliteTableRenameInspectSchema, sqliteTableRenamePreviewSchema, sqliteTableRenameInspectionSchema, sqliteTableRenamePreviewOutputSchema, sqliteTableRenameOutcomeSchema, sqliteTableRenameFactSchema, assertSqliteTableRenameFactTransition, type SqliteTableRenameTarget, type SqliteTableRenameInspectInput, type SqliteTableRenameInspectOutput, type SqliteTableRenamePreviewInput, type SqliteTableRenamePreviewOutput, type SqliteTableRenameApplyInput, type SqliteTableRenameOutcome, type SqliteTableRenameReleaseInput, type SqliteTableRenameFact } from '../../shared/sqliteTableRename';
import { acquireWorkspaceBusy, useWorkspace, type WorkspaceBusyLease } from '../store';
import { assertSqliteTableRenameTargetAvailable } from '../sqliteTableRenameAvailability';
import { errorMessage, invoke, uid } from '../lib';
import { sqliteTableRenameZh as text } from '../locales/sqliteTableRename.zh-CN';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';
import '../sqliteTableRename.css';

export interface SqliteTableRenameServices {
  inspect(input: SqliteTableRenameInspectInput): Promise<SqliteTableRenameInspectOutput>;
  preview(input: SqliteTableRenamePreviewInput): Promise<SqliteTableRenamePreviewOutput>;
  apply(input: SqliteTableRenameApplyInput): Promise<SqliteTableRenameOutcome>;
  release(input: SqliteTableRenameReleaseInput): Promise<void>; cancel(taskId: string): Promise<unknown>;
  subscribe(listener: (event: TaskEvent) => void): () => void;
}
export const sqliteTableRenameServices: SqliteTableRenameServices = {
  inspect: input => invoke('sqlite.tableRename.inspect', input), preview: input => invoke('sqlite.tableRename.preview', input), apply: input => invoke('sqlite.tableRename.apply', input), release: input => invoke('sqlite.tableRename.release', input), cancel: taskId => invoke('query.cancel', { taskId }), subscribe: listener => window.dbark.onTask(listener),
};
interface Props { target: SqliteTableRenameTarget; targetVersion: number; services?: SqliteTableRenameServices; onClose(): void; onDirtyChange?(dirty: boolean): void; onApplied?(outcome: SqliteTableRenameOutcome, version: number): void; onExecutionUncertain?(newName: string): void; }
type Draft = { catalogue?: SqliteTableRenameInspectOutput; newName: string; preview?: SqliteTableRenamePreviewOutput; confirmation: string; outcome?: SqliteTableRenameOutcome; fact?: SqliteTableRenameFact; locked: boolean };
type Operation = { kind: 'inspect' | 'preview' | 'apply'; id: string; draft: Draft; lifetime: object; expectedStatements?: number; expectedNewName?: string; expectedNavigationIdentity?: string; lease?: WorkspaceBusyLease; tableLeases: { id: string; lease: WorkspaceBusyLease }[]; acquiring: boolean; sent: boolean; cancelled: boolean; commitBoundary: boolean; resultReceived?: boolean; fact?: SqliteTableRenameFact; promise?: Promise<void>; cancel?: Promise<void>; committed?: SqliteTableRenameOutcome; uncertain?: boolean };
/** 原目录与新表名先明确预览，只有原请求COMMIT ACK才通知界面刷新或改名。 */
export function SqliteTableRenameDialog({ target, targetVersion, onClose, onDirtyChange, onApplied, onExecutionUncertain, services = sqliteTableRenameServices }: Props) {
  const fixed = useRef({ target: Object.freeze({ ...target }), inputTarget: target, version: targetVersion, profile: useWorkspace.getState().connections.find(value => value.id === target.connectionId), services, onClose, onDirtyChange, onApplied, onExecutionUncertain, key: 'sqlite-table-rename:' + uid() }).current;
  const [draft, setDraft] = useState<Draft>({ newName: '', confirmation: '', locked: false }), live = useRef(draft); live.current = draft;
  const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [discard, setDiscard] = useState(false), [reread, setReread] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [progress, setProgress] = useState<TaskEvent>(), [timeRevision, tick] = useState(0);
  const lifetime = useRef<object | null>(null), invalid = useRef(false), closed = useRef(false), operation = useRef<Operation | undefined>(undefined), consumed = useRef(new Set<string>()), sourceEpoch = useRef(0);
  const propsNow = useRef({ target, targetVersion, services }); propsNow.current = { target, targetVersion, services };
  const observed = useRef({ target, targetKey: JSON.stringify([target.connectionId, target.database, target.table]), targetVersion, services, profile: fixed.profile, version: targetVersion });
  const catalogues = useRef(new Set<string>()), previews = useRef(new Set<string>()), releasing = useRef(new Map<string, Promise<void>>());
  const ticket = {}, rendered = useRef<object | undefined>(undefined);
  const sameTarget = (value: SqliteTableRenameTarget) => value.connectionId === fixed.target.connectionId && value.database === fixed.target.database && value.table === fixed.target.table;
  /** 原/新表的页面共用占用；大小写按SQLite ASCII名称规则保护。 */
  function tableTabs(newName?: string) { const fold = (name: string) => name.replace(/[A-Z]/g, value => value.toLowerCase()); return useWorkspace.getState().settings.tabs.filter(tab => tab.kind === 'table' && tab.connectionId === fixed.target.connectionId && tab.database === 'main' && typeof tab.table === 'string' && (fold(tab.table) === fold(fixed.target.table) || newName !== undefined && fold(tab.table) === fold(newName))); }
  /** 同步订阅留下永久墓碑；profile、版本、props引用或内容ABA都不能重新授权。 */
  function current(): boolean {
    const now = useWorkspace.getState(), profile = now.connections.find(value => value.id === fixed.target.connectionId), version = now.connectionVersions[fixed.target.connectionId] ?? 0, props = propsNow.current, before = observed.current, targetKey = JSON.stringify([props.target.connectionId, props.target.database, props.target.table]);
    if (before.target !== props.target || before.targetKey !== targetKey || before.targetVersion !== props.targetVersion || before.services !== props.services || before.profile !== profile || before.version !== version) { observed.current = { ...props, targetKey, profile, version }; sourceEpoch.current++; }
    if (props.target !== fixed.inputTarget || !sameTarget(props.target) || props.targetVersion !== fixed.version || props.services !== fixed.services || profile !== fixed.profile || version !== fixed.version || fixed.profile?.dialect !== 'sqlite' || fixed.target.database !== 'main') invalid.current = true;
    const op = operation.current;
    if (op?.lease && !op.acquiring && (!op.lease.owns() || op.tableLeases.some(item => !item.lease.owns()))) invalid.current = true;
    if (op?.kind === 'apply' && !op.acquiring) { const tabs = tableTabs(op.expectedNewName); if (tabs.length !== op.tableLeases.length || tabs.some(tab => !op.tableLeases.some(item => item.id === tab.id) || now.dirtyTabs[tab.id] || now.tableLayoutDrafts[tab.id])) invalid.current = true; }
    return !!lifetime.current && !closed.current && !invalid.current;
  }
  const local = () => !!lifetime.current && rendered.current === ticket && live.current === draft && !closed.current;
  const editable = () => local() && current() && !operation.current && !closing && !draft.locked;
  const catalogueUsable = () => !!draft.catalogue && Date.parse(draft.catalogue.expiresAt) > Date.now();
  function report(reason: unknown): void { if (lifetime.current) setError(errorMessage(reason)); else useWorkspace.getState().notify(errorMessage(reason), true); }
  function replace(value: Draft): void { live.current = value; fixed.onDirtyChange?.(!value.outcome?.fact.commitAcknowledged && (!!value.newName || value.locked)); setDraft(value); }
  /** 准确cap在release成功前保留责任；并发/迟到收尾共用同一Promise。 */
  async function releaseOne(kind: 'catalogueId' | 'previewId', id: string): Promise<void> { const key = kind + ':' + id; let pending = releasing.current.get(key); if (!pending) { pending = Promise.resolve().then(() => fixed.services.release({ [kind]: id })).then(() => { (kind === 'catalogueId' ? catalogues.current : previews.current).delete(id); }); releasing.current.set(key, pending); } try { await pending; } finally { if (releasing.current.get(key) === pending) releasing.current.delete(key); } }
  async function releaseAll(): Promise<void> { for (const id of [...previews.current]) await releaseOne('previewId', id); for (const id of [...catalogues.current]) await releaseOne('catalogueId', id); }
  function revokePreview(): void { if (draft.preview) void releaseOne('previewId', draft.preview.previewId).catch(report); }
  function change(value: Partial<Draft>): void { if (!editable() || !catalogueUsable()) return; replace({ ...draft, ...value, preview: undefined, confirmation: '', outcome: undefined, fact: undefined }); revokePreview(); setError(''); setMessage(''); }
  function begin(kind: Operation['kind'], pending = draft): Operation | undefined {
    if (!editable()) return; const op: Operation = { kind, id: uid(), draft: pending, lifetime: lifetime.current!, ...(kind === 'apply' ? { expectedStatements: pending.preview?.sql.length, expectedNewName: pending.preview?.newName, expectedNavigationIdentity: pending.preview?.navigationIdentity } : {}), tableLeases: [], acquiring: true, sent: false, cancelled: false, commitBoundary: false }; operation.current = op;
    try {
      assertSqliteTableRenameTargetAvailable(fixed.target, useWorkspace.getState(), op.expectedNewName);
      op.lease = acquireWorkspaceBusy(fixed.key);
      // 所有页面占用同步取得后才允许发送写请求，途中失效不留下部分占用。
      if (kind === 'apply') for (const tab of tableTabs(op.expectedNewName)) op.tableLeases.push({ id: tab.id, lease: acquireWorkspaceBusy(tab.id) });
      op.acquiring = false; if (!current()) throw Error(text.invalid); if (pending !== draft) replace(pending); setBusy(true); setError(''); setMessage(''); setProgress(undefined); return op;
    } catch (reason) { operation.current = undefined; for (const item of op.tableLeases) item.lease.release(); op.lease?.release(); report(reason); }
  }
  const accepts = (op: Operation) => operation.current === op && lifetime.current === op.lifetime && live.current === op.draft && current() && !op.cancelled;
  /** COMMIT单向边界同步关闭所有旧stop、关闭和卸载的取消路径。 */
  function stop(op = operation.current): void { if (!op || operation.current !== op || op.cancelled || op.resultReceived || op.commitBoundary || op.fact?.commitAcknowledged || op.fact?.rollbackAcknowledged) return; op.cancelled = true; if (op.sent) op.cancel = Promise.resolve().then(() => fixed.services.cancel(op.id)).then(() => undefined).catch(report); if (lifetime.current) setMessage(text.cancelling); }
  /** 仅原请求已结束且Main强事实已通过原目标/计数/转换时兜底；错误回包本身不能提供ACK。 */
  function reconcileAcknowledged(op: Operation): boolean {
    if (op.kind !== 'apply' || !op.resultReceived) return false;
    const parsed = sqliteTableRenameFactSchema.safeParse(op.fact);
    if (!parsed.success || !sameTarget(parsed.data.target) || parsed.data.requestedStatements !== op.expectedStatements || !parsed.data.commitAcknowledged && !parsed.data.rollbackAcknowledged) return false;
    const fact = parsed.data, existing = live.current.outcome;
    const result = op.committed ?? (existing && JSON.stringify(existing.fact) === JSON.stringify(fact) ? existing : sqliteTableRenameOutcomeSchema.parse({ operationId: fact.operationId, target: fact.target, newName: op.expectedNewName, navigationIdentity: op.expectedNavigationIdentity, outcome: fact.commitAcknowledged ? 'committed' : 'rolled-back', fact, message: sqliteTableRenameFactMessage(fact), definitionVerified: false }));
    op.uncertain = false; if (fact.commitAcknowledged) op.committed = result;
    if (lifetime.current === op.lifetime) { if (live.current.outcome !== result) replace({ ...live.current, preview: undefined, confirmation: '', outcome: result, fact: result.fact, locked: fact.commitAcknowledged }); setMessage(fact.commitAcknowledged ? text.committed : sqliteTableRenameFactMessage(fact)); }
    return true;
  }
  async function finish(op: Operation): Promise<void> {
    let wait: Promise<void> | undefined; do { wait = op.cancel; if (wait) await wait; } while (wait !== op.cancel);
    reconcileAcknowledged(op);
    if (operation.current === op) operation.current = undefined; for (const item of op.tableLeases) item.lease.release(); op.lease?.release(); if (lifetime.current === op.lifetime) setBusy(false);
    if (op.committed) { current(); if (lifetime.current && !invalid.current) { try { fixed.onApplied?.(op.committed, fixed.version); } catch (reason) { report(reason); } } else useWorkspace.getState().notify(text.committedStale, true); }
    if (op.uncertain) try { fixed.onExecutionUncertain?.(op.expectedNewName!); } catch (reason) { report(reason); }
    if (!lifetime.current) void releaseAll().catch(report);
  }
  /** 刷新前明确放弃整组草稿；撤销旧cap与草稿是同步动作，取消不复活旧预览。 */
  function inspect(confirmed = false): void {
    if (!editable()) return; if (!confirmed && (draft.newName || draft.preview)) { setReread(true); return; }
    const parsed = sqliteTableRenameInspectSchema.safeParse({ ...fixed.target, taskId: uid() }); if (!parsed.success) { setError(text.invalid); return; }
    const op = begin('inspect', { newName: '', confirmation: '', locked: false }); if (!op) return; setReread(false);
    op.promise = (async () => { try { await releaseAll(); if (!accepts(op)) return; op.sent = true; const raw = await fixed.services.inspect({ ...parsed.data, taskId: op.id }); if (typeof raw?.catalogueId === 'string') catalogues.current.add(raw.catalogueId); const value = sqliteTableRenameInspectionSchema.parse(raw); if (!accepts(op)) { await releaseOne('catalogueId', value.catalogueId); return; } if (!sameTarget(value.target) || value.readOnly !== (fixed.profile?.dialect === 'sqlite' && fixed.profile.sqlite.readOnly) || Date.parse(value.expiresAt) <= Date.now()) { await releaseOne('catalogueId', value.catalogueId); throw Error(text.response); } replace({ ...op.draft, catalogue: value }); } catch (reason) { if (lifetime.current === op.lifetime && !op.cancelled) report(reason); } finally { await finish(op); } })();
  }
  function preview(): void {
    if (!editable() || !draft.catalogue || !catalogueUsable()) return; const parsed = sqliteTableRenamePreviewSchema.safeParse({ catalogueId: draft.catalogue.catalogueId, newName: draft.newName, taskId: uid() }); if (!parsed.success) { setError(text.designInvalid); return; }
    const op = begin('preview', { ...draft, preview: undefined, confirmation: '', outcome: undefined, fact: undefined }); if (!op) return;
    op.promise = (async () => { try { for (const id of [...previews.current]) await releaseOne('previewId', id); if (!accepts(op)) return; op.sent = true; const raw = await fixed.services.preview({ catalogueId: op.draft.catalogue!.catalogueId, newName: parsed.data.newName, taskId: op.id }); if (typeof raw?.previewId === 'string') previews.current.add(raw.previewId); const value = sqliteTableRenamePreviewOutputSchema.parse(raw); if (!accepts(op)) { await releaseOne('previewId', value.previewId); return; } if (!sameTarget(value.target) || value.catalogueId !== op.draft.catalogue!.catalogueId || value.newName !== parsed.data.newName || value.navigationIdentity !== op.draft.catalogue!.navigationIdentity || Date.parse(value.expiresAt) <= Date.now()) { await releaseOne('previewId', value.previewId); throw Error(text.response); } replace({ ...op.draft, preview: value }); } catch (reason) { if (lifetime.current === op.lifetime && !op.cancelled) report(reason); } finally { await finish(op); } })();
  }
  /** 原预览仅消费一次，真实回执保留到关闭；失败可重新预览，unknown与ACK永久锁原批。 */
  function apply(): void {
    const chosen = draft.preview; if (!editable() || !chosen || fixed.profile?.dialect !== 'sqlite' || fixed.profile.sqlite.readOnly || draft.catalogue?.readOnly || draft.confirmation !== chosen.confirmation || Date.parse(chosen.expiresAt) <= Date.now() || consumed.current.has(chosen.previewId)) return;
    const op = begin('apply'); if (!op) return; consumed.current.add(chosen.previewId);
    op.promise = (async () => {
      try {
        if (!accepts(op)) return; op.sent = true;
        const value = sqliteTableRenameOutcomeSchema.parse(await fixed.services.apply({ previewId: chosen.previewId, taskId: op.id, confirmation: chosen.confirmation }));
        if (!sameTarget(value.target) || value.newName !== op.expectedNewName || value.navigationIdentity !== op.expectedNavigationIdentity || value.fact.requestedStatements !== op.expectedStatements) throw Error(text.response);
        if (op.fact) assertSqliteTableRenameFactTransition(op.fact, value.fact);
        op.fact = value.fact; op.resultReceived = true;
        if (value.fact.commitMayHaveBeenSent || value.outcome === 'unknown') op.commitBoundary = true;
        if (value.fact.commitAcknowledged) op.committed = value; else if (value.outcome === 'unknown') op.uncertain = true;
        if (lifetime.current === op.lifetime) { replace({ ...op.draft, preview: undefined, confirmation: '', outcome: value, fact: value.fact, locked: value.fact.commitAcknowledged || value.outcome === 'unknown' }); setMessage(value.fact.commitAcknowledged ? text.committed : value.outcome === 'unknown' ? text.unknown : value.message); }
      } catch (reason) {
        if (op.sent) { op.resultReceived = true; if (!reconcileAcknowledged(op)) { op.uncertain = true; op.commitBoundary = true; } }
        if (lifetime.current === op.lifetime) {
          if (!op.fact?.commitAcknowledged && !op.fact?.rollbackAcknowledged) { replace({ ...op.draft, preview: undefined, confirmation: '', ...(op.fact ? { fact: op.fact } : {}), locked: op.sent }); setMessage(op.sent ? text.unknown : ''); }
          report(reason);
        }
      } finally { await releaseOne('previewId', chosen.previewId).catch(report); await finish(op); }
    })();
  }
  /** 关闭可取消只读/尚未提交阶段；COMMIT边界后仍等原Promise，绝不假报撤销。 */
  function close(confirmed = false): void { if (!local() || closing) return; if (!confirmed && (!draft.outcome?.fact.commitAcknowledged && (draft.newName || draft.locked || operation.current))) { setDiscard(true); return; } const token = lifetime.current, epoch = sourceEpoch.current, op = operation.current; closed.current = true; setClosing(true); stop(op); void (async () => { if (op?.promise) await op.promise; if (op?.cancel) await op.cancel; await releaseAll(); if (lifetime.current === token && sourceEpoch.current === epoch) { fixed.onDirtyChange?.(false); fixed.onClose(); } })().catch(reason => { closed.current = false; if (lifetime.current) setClosing(false); report(reason); }); }
  useLayoutEffect(() => { rendered.current = ticket; return () => { if (rendered.current === ticket) rendered.current = undefined; }; });
  useEffect(() => { const token = {}; lifetime.current = token; const observe = () => { if (!current()) { stop(); tick(value => value + 1); } }; const unsubscribe = useWorkspace.subscribe(observe), tasks = fixed.services.subscribe(event => { const op = operation.current; if (!op || event.taskId !== op.id) return; if (op.kind === 'apply' && event.sqliteTableRename) { if (event.sqliteTableRenameOperation !== 'apply') return; const parsed = sqliteTableRenameFactSchema.safeParse(event.sqliteTableRename); if (!parsed.success || !sameTarget(parsed.data.target) || parsed.data.requestedStatements !== op.expectedStatements) return; try { if (op.fact) assertSqliteTableRenameFactTransition(op.fact, parsed.data); } catch { return; } op.fact = parsed.data; if (parsed.data.commitMayHaveBeenSent || parsed.data.phase === 'unknown') op.commitBoundary = true; if (lifetime.current) { const next = { ...live.current, fact: parsed.data }; live.current = next; op.draft = next; setDraft(next); } if (op.resultReceived) reconcileAcknowledged(op); } if (!current()) stop(op); if (lifetime.current) { setProgress(event); /* 原Promise回包或事件已验证的ACK高于任何迟到进度，release仍在途也不能降级。 */ if (op.fact?.commitAcknowledged) setMessage(text.committed); else if (op.fact?.rollbackAcknowledged) setMessage(sqliteTableRenameFactMessage(op.fact)); else if (op.resultReceived && op.uncertain) setMessage(text.unknown); else if (op.commitBoundary) setMessage(text.commitBoundary); } }); observe(); tick(value => value + 1); return () => { unsubscribe(); tasks(); if (lifetime.current === token) lifetime.current = null; stop(); if (!operation.current) void releaseAll().catch(report); fixed.onDirtyChange?.(false); }; }, []);
  const valid = current(), disabled = busy || closing || !valid || draft.locked, catalogue = draft.catalogue, previewed = draft.preview, catalogueExpired = !!catalogue && Date.parse(catalogue.expiresAt) <= Date.now(), previewExpired = !!previewed && Date.parse(previewed.expiresAt) <= Date.now(), renderedOperation = operation.current;
  useEffect(() => { if (!valid) stop(); }, [valid]);
  useEffect(() => { const now = Date.now(), times = [catalogue?.expiresAt, previewed?.expiresAt].filter((value): value is string => !!value).map(Date.parse).filter(value => value > now); if (!times.length) return; const timer = setTimeout(() => tick(value => value + 1), Math.max(1, Math.min(...times) - now + 1)); return () => clearTimeout(timer); }, [catalogue, previewed, timeRevision]);
  const draftDisabled = disabled || catalogueExpired, fact = draft.fact, isReadOnly = fixed.profile?.dialect === 'sqlite' && fixed.profile.sqlite.readOnly;
  return <Modal title={text.title} wide onClose={() => close()}><div className="modal-content sqlite-table-rename" aria-busy={busy || closing}><p>{fixed.target.connectionId} / {fixed.target.database} / {fixed.target.table}</p><UsageHelp><p>{text.scope}</p><p>{text.dependenciesHint}</p></UsageHelp>{isReadOnly && <p className="warning-text">{text.readonly}</p>}<button type="button" disabled={disabled} onClick={() => inspect()}>{text.read}</button>
    {catalogue && <><p>{text.strict}：{catalogue.strict ? text.yes : text.no} · {text.withoutRowid}：{catalogue.withoutRowid ? text.yes : text.no}</p><section aria-label={text.catalogue}><h3>{text.catalogue}</h3><div className="sqlite-table-rename-scroll"><table><thead><tr><th>{text.name}</th><th>{text.declaredType}</th><th>{text.notNull}</th><th>{text.defaultSql}</th><th>{text.primaryKey}</th><th>{text.hidden}</th></tr></thead><tbody>{catalogue.columns.map(column => <tr key={column.cid}><td>{column.name}</td><td>{column.declaredType}</td><td>{column.notNull ? text.yes : text.no}</td><td>{column.defaultSql ?? text.noDefault}</td><td>{column.primaryKey}</td><td>{column.hidden}</td></tr>)}</tbody></table></div></section><details><summary>{text.tableSql}</summary><pre aria-label={text.tableSql}>{catalogue.tableSql}</pre></details><details><summary>{text.related}</summary><section aria-label={text.related}>{catalogue.relatedObjects.map(object => <details key={object.type + ':' + object.name}><summary>{text.objectKinds[object.type]} · {object.name} / {object.table}</summary><pre aria-label={text.relatedSql(object.type, object.name)}>{object.sql ?? text.noSql}</pre></details>)}</section></details><Field label={text.newName}><input aria-label={text.newName} value={draft.newName} disabled={draftDisabled} onChange={event => change({ newName: event.target.value })}/></Field></>}
    {previewed && <section><p>{text.previewHint}</p><p>{text.renameTarget(fixed.target.table, previewed.newName)}</p><pre aria-label={text.previewTitle}>{previewed.sql.join('\n\n')}</pre><Field label={text.confirmationHint(previewed.confirmation)}><input aria-label={text.confirmation} value={draft.confirmation} disabled={disabled || previewExpired} onChange={event => { if (editable() && draft.preview === previewed && Date.parse(previewed.expiresAt) > Date.now()) replace({ ...draft, confirmation: event.target.value }); }}/></Field></section>}
    {fact && <details aria-label={text.factTitle}><summary>{text.phases[fact.phase]}</summary><dl><dt>{text.factOperation}</dt><dd>{fact.operationId}</dd><dt>{text.factTarget}</dt><dd>{fact.target.connectionId} / {fact.target.database} / {fact.target.table}</dd><dt>{text.factRequested}</dt><dd>{fact.requestedStatements}</dd><dt>{text.factCompleted}</dt><dd>{fact.completedStatements}</dd></dl></details>}
    <ErrorBox message={!valid ? text.invalid : error}/>{catalogueExpired && <p className="warning-text">{previewed && !previewExpired ? text.catalogueExpiredPreview : text.catalogueExpired}</p>}{previewExpired && <ErrorBox message={text.previewExpired}/>} {message && <p role="status">{message}</p>}{progress && <p role="status">{progress.message}</p>}{busy && <Spinner text={text.loading}/>} {reread && <p>{text.reread}</p>}{discard && <p>{text.discard}</p>}
  </div><footer className="modal-footer">{discard ? <><button type="button" disabled={closing} onClick={() => { if (local()) setDiscard(false); }}>{text.keep}</button><button type="button" disabled={closing} onClick={() => close(true)}>{text.discardClose}</button></> : reread ? <><button type="button" disabled={disabled} onClick={() => { if (local()) setReread(false); }}>{text.keep}</button><button type="button" disabled={disabled} onClick={() => inspect(true)}>{text.discardRead}</button></> : <><button type="button" disabled={closing} onClick={() => close()}>{text.close}</button><span className="grow"/>{busy && renderedOperation && <button type="button" disabled={renderedOperation.resultReceived || renderedOperation.commitBoundary || renderedOperation.fact?.commitAcknowledged || renderedOperation.fact?.rollbackAcknowledged} title={renderedOperation.fact && (renderedOperation.resultReceived || renderedOperation.fact.commitAcknowledged || renderedOperation.fact.rollbackAcknowledged) ? sqliteTableRenameFactMessage(renderedOperation.fact) : renderedOperation.commitBoundary ? text.commitBoundary : undefined} onClick={() => { if (local() && operation.current === renderedOperation) stop(renderedOperation); }}>{text.stop}</button>}<button type="button" disabled={draftDisabled || !draft.newName} onClick={preview}>{text.preview}</button><button type="button" className="primary" disabled={disabled || !previewed || previewExpired || isReadOnly || catalogue?.readOnly || draft.confirmation !== previewed.confirmation || consumed.current.has(previewed.previewId)} onClick={apply}>{text.apply}</button></>}</footer></Modal>;
}
