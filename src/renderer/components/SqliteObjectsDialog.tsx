import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TaskEvent } from '../../shared/contracts';
import { sqliteObjectsFactMessage } from '../../shared/sqliteObjectsFact';
import { buildSqliteObjectsPlan, sqliteObjectsInspectSchema, sqliteObjectsPreviewSchema, sqliteObjectsInspectionSchema, sqliteObjectsPreviewOutputSchema, sqliteObjectsOutcomeSchema, sqliteObjectsFactSchema, assertSqliteObjectsFactTransition, type SqliteObjectsAction, type SqliteObjectsAcknowledgement, type SqliteObjectsTarget, type SqliteObjectsInspectInput, type SqliteObjectsInspectOutput, type SqliteObjectsPreviewInput, type SqliteObjectsPreviewOutput, type SqliteObjectsApplyInput, type SqliteObjectsOutcome, type SqliteObjectsReleaseInput, type SqliteObjectsFact } from '../../shared/sqliteObjects';
import { acquireWorkspaceBusy, useWorkspace, type WorkspaceBusyLease } from '../store';
import { assertSqliteObjectsTargetAvailable } from '../sqliteObjectsAvailability';
import { errorMessage, invoke, uid } from '../lib';
import { sqliteObjectsZh as text } from '../locales/sqliteObjects.zh-CN';
import { SqlEditor } from './SqlEditor';
import { SqliteObjectsFactSummary } from './SqliteObjectsFactSummary';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';
import '../sqliteObjects.css';

export interface SqliteObjectsServices {
  inspect(input: SqliteObjectsInspectInput): Promise<SqliteObjectsInspectOutput>;
  preview(input: SqliteObjectsPreviewInput): Promise<SqliteObjectsPreviewOutput>;
  apply(input: SqliteObjectsApplyInput): Promise<SqliteObjectsOutcome>;
  release(input: SqliteObjectsReleaseInput): Promise<void>; cancel(taskId: string): Promise<unknown>;
  subscribe(listener: (event: TaskEvent) => void): () => void;
}
export const sqliteObjectsServices: SqliteObjectsServices = {
  inspect: input => invoke('sqlite.objects.inspect', input), preview: input => invoke('sqlite.objects.preview', input), apply: input => invoke('sqlite.objects.apply', input), release: input => invoke('sqlite.objects.release', input), cancel: taskId => invoke('query.cancel', { taskId }), subscribe: listener => window.dbark.onTask(listener),
};
export interface SqliteObjectsScope { connectionId: string; database: 'main'; kind: 'view'|'trigger'; name?: string; }
interface Props { scope: SqliteObjectsScope; targetVersion: number; action: SqliteObjectsAction; services?: SqliteObjectsServices; onClose(): void; onDirtyChange?(dirty: boolean): void; onTargetChange?(target: SqliteObjectsTarget | undefined): void; onApplied?(outcome: SqliteObjectsOutcome, version: number): void; onExecutionUncertain?(target: SqliteObjectsTarget, action: SqliteObjectsAction): void; }
type Draft = { catalogue?: SqliteObjectsInspectOutput; name: string; sql: string; sqlTouched: boolean; relation: string; acknowledgements: SqliteObjectsAcknowledgement[]; preview?: SqliteObjectsPreviewOutput; confirmation: string; outcome?: SqliteObjectsOutcome; fact?: SqliteObjectsFact; locked: boolean };
type Operation = { kind: 'inspect' | 'preview' | 'apply'; id: string; draft: Draft; lifetime: object; expectedStatements?: number; target: SqliteObjectsTarget; nameEpoch: number; lease?: WorkspaceBusyLease; tableLeases: { id: string; lease: WorkspaceBusyLease }[]; acquiring: boolean; sent: boolean; cancelled: boolean; commitBoundary: boolean; resultReceived?: boolean; fact?: SqliteObjectsFact; promise?: Promise<void>; cancel?: Promise<void>; committed?: SqliteObjectsOutcome; uncertain?: boolean };
/** 原用途与对象种类固定，名称绑定真实目录；真实ACK和后置定义核验同时成立才通知页面。 */
export function SqliteObjectsDialog({ scope, targetVersion, action, onClose, onDirtyChange, onTargetChange, onApplied, onExecutionUncertain, services = sqliteObjectsServices }: Props) {
  const fixed = useRef({ scope: Object.freeze({ ...scope }), inputScope: scope, version: targetVersion, action, profile: useWorkspace.getState().connections.find(value => value.id === scope.connectionId), services, onClose, onDirtyChange, onTargetChange, onApplied, onExecutionUncertain, key: 'sqlite-objects:' + uid() }).current;
  const [draft, setDraft] = useState<Draft>({ name: scope.name ?? '', sql: '', sqlTouched: false, relation: '', acknowledgements: [], confirmation: '', locked: false }), live = useRef(draft); live.current = draft;
  const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [discard, setDiscard] = useState(false), [templateConfirm,setTemplateConfirm]=useState(false), [reread, setReread] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [progress, setProgress] = useState<TaskEvent>(), [timeRevision, tick] = useState(0);
  const lifetime = useRef<object | null>(null), invalid = useRef(false), closed = useRef(false), operation = useRef<Operation | undefined>(undefined), consumed = useRef(new Set<string>()), sourceEpoch = useRef(0), nameEpoch = useRef(0);
  const propsNow = useRef({ scope, targetVersion, action, services }); propsNow.current = { scope, targetVersion, action, services };
  const observed = useRef({ scope, targetKey: JSON.stringify([scope.connectionId, scope.database, scope.kind, scope.name]), targetVersion, action, services, profile: fixed.profile, version: targetVersion });
  const catalogues = useRef(new Set<string>()), previews = useRef(new Set<string>()), releasing = useRef(new Map<string, Promise<void>>());
  const ticket = {}, rendered = useRef<object | undefined>(undefined);
  const targetOf = (name = live.current.name): SqliteObjectsTarget => ({ connectionId: fixed.scope.connectionId, database: fixed.scope.database, kind: fixed.scope.kind, name });
  const sameTarget = (value: SqliteObjectsTarget, expected = operation.current?.target ?? targetOf()) => value.connectionId === expected.connectionId && value.database === expected.database && value.kind === expected.kind && value.name === expected.name;
  /** 对象替换可能使同库页面与编辑来源失效，写请求期间保护所有同库表页。 */
  function tableTabs() { return useWorkspace.getState().settings.tabs.filter(tab => tab.kind === 'table' && tab.connectionId === fixed.scope.connectionId && tab.database === 'main'); }
  /** 同步订阅留下永久墓碑；profile、版本、props引用或内容ABA都不能重新授权。 */
  function current(): boolean {
    const now = useWorkspace.getState(), profile = now.connections.find(value => value.id === fixed.scope.connectionId), version = now.connectionVersions[fixed.scope.connectionId] ?? 0, props = propsNow.current, before = observed.current, targetKey = JSON.stringify([props.scope.connectionId, props.scope.database, props.scope.kind, props.scope.name]);
    if (before.scope !== props.scope || before.targetKey !== targetKey || before.targetVersion !== props.targetVersion || before.action !== props.action || before.services !== props.services || before.profile !== profile || before.version !== version) { observed.current = { ...props, targetKey, profile, version }; sourceEpoch.current++; }
    if (props.scope !== fixed.inputScope || props.scope.connectionId !== fixed.scope.connectionId || props.scope.database !== fixed.scope.database || props.scope.kind !== fixed.scope.kind || props.scope.name !== fixed.scope.name || props.targetVersion !== fixed.version || props.action !== fixed.action || props.services !== fixed.services || profile !== fixed.profile || version !== fixed.version || fixed.profile?.dialect !== 'sqlite' || fixed.scope.database !== 'main') invalid.current = true;
    const op = operation.current;
    if (op?.lease && !op.acquiring && (!op.lease.owns() || op.tableLeases.some(item => !item.lease.owns()))) invalid.current = true;
    if (op && (op.nameEpoch !== nameEpoch.current || !sameTarget(op.target, targetOf()))) invalid.current = true;
    if (op?.kind === 'apply' && !op.acquiring) { const tabs = tableTabs(); if (tabs.length !== op.tableLeases.length || tabs.some(tab => !op.tableLeases.some(item => item.id === tab.id) || now.dirtyTabs[tab.id] || now.tableLayoutDrafts[tab.id])) invalid.current = true; }
    return !!lifetime.current && !closed.current && !invalid.current;
  }
  const local = () => !!lifetime.current && rendered.current === ticket && live.current === draft && !closed.current;
  const editable = () => local() && current() && !operation.current && !closing && !draft.locked;
  const catalogueUsable = () => !!draft.catalogue && Date.parse(draft.catalogue.expiresAt) > Date.now();
  function report(reason: unknown): void { if (lifetime.current) setError(errorMessage(reason)); else useWorkspace.getState().notify(errorMessage(reason), true); }
  function replace(value: Draft): void { live.current = value; fixed.onDirtyChange?.(!value.outcome?.fact.commitAcknowledged && (value.sqlTouched || fixed.action === 'create' && !!value.name || !!value.relation || !!value.preview || !!value.acknowledgements.length || !!value.confirmation || value.locked)); setDraft(value); }
  /** 准确cap在release成功前保留责任；并发/迟到收尾共用同一Promise。 */
  async function releaseOne(kind: 'catalogueId' | 'previewId', id: string): Promise<void> { const key = kind + ':' + id; let pending = releasing.current.get(key); if (!pending) { pending = Promise.resolve().then(() => fixed.services.release({ [kind]: id })).then(() => { (kind === 'catalogueId' ? catalogues.current : previews.current).delete(id); }); releasing.current.set(key, pending); } try { await pending; } finally { if (releasing.current.get(key) === pending) releasing.current.delete(key); } }
  async function releaseAll(): Promise<void> { for (const id of [...previews.current]) await releaseOne('previewId', id); for (const id of [...catalogues.current]) await releaseOne('catalogueId', id); }
  function revokePreview(): void { if (draft.preview) void releaseOne('previewId', draft.preview.previewId).catch(report); }
  function change(value: Partial<Draft>): void { if (!editable() || !catalogueUsable()) return; replace({ ...draft, ...value, preview: undefined, confirmation: '', acknowledgements: [], outcome: undefined, fact: undefined }); revokePreview(); setError(''); setMessage(''); }
  function begin(kind: Operation['kind'], pending = draft): Operation | undefined {
    if (!editable()) return; const op: Operation = { kind, id: uid(), draft: pending, lifetime: lifetime.current!, target: targetOf(pending.name), nameEpoch: nameEpoch.current, ...(kind === 'apply' ? { expectedStatements: pending.preview?.sql.length } : {}), tableLeases: [], acquiring: true, sent: false, cancelled: false, commitBoundary: false }; operation.current = op;
    try {
      assertSqliteObjectsTargetAvailable(targetOf(pending.name), useWorkspace.getState());
      op.lease = acquireWorkspaceBusy(fixed.key);
      // 所有页面占用同步取得后才允许发送写请求，途中失效不留下部分占用。
      if (kind === 'apply') for (const tab of tableTabs()) op.tableLeases.push({ id: tab.id, lease: acquireWorkspaceBusy(tab.id) });
      op.acquiring = false; if (!current()) throw Error(text.invalid); if (pending !== draft) replace(pending); setBusy(true); setError(''); setMessage(''); setProgress(undefined); return op;
    } catch (reason) { operation.current = undefined; for (const item of op.tableLeases) item.lease.release(); op.lease?.release(); report(reason); }
  }
  const accepts = (op: Operation) => operation.current === op && lifetime.current === op.lifetime && live.current === op.draft && current() && !op.cancelled;
  /** COMMIT单向边界同步关闭所有旧stop、关闭和卸载的取消路径。 */
  function stop(op = operation.current): void { if (!op || operation.current !== op || op.cancelled || op.resultReceived || op.commitBoundary || op.fact?.commitAcknowledged || op.fact?.rollbackAcknowledged) return; op.cancelled = true; if (op.sent) op.cancel = Promise.resolve().then(() => fixed.services.cancel(op.id)).then(() => undefined).catch(report); if (lifetime.current) setMessage(text.cancelling); }
  /** 仅原请求已结束且Main强事实已通过原目标/计数/转换时兜底；错误回包本身不能提供ACK。 */
  function reconcileAcknowledged(op: Operation): boolean {
    if (op.kind !== 'apply' || !op.resultReceived) return false;
    const parsed = sqliteObjectsFactSchema.safeParse(op.fact);
    if (!parsed.success || !sameTarget(parsed.data.target) || parsed.data.action !== fixed.action || parsed.data.requestedStatements !== op.expectedStatements || !parsed.data.commitAcknowledged && !parsed.data.rollbackAcknowledged) return false;
    const fact = parsed.data, existing = live.current.outcome;
    const result = op.committed ?? (existing && JSON.stringify(existing.fact) === JSON.stringify(fact) ? existing : sqliteObjectsOutcomeSchema.parse({ operationId: fact.operationId, target: fact.target, action: fixed.action, outcome: fact.commitAcknowledged ? 'committed' : 'rolled-back', fact, message: sqliteObjectsFactMessage(fact), definitionVerified: false }));
    op.uncertain = fact.commitAcknowledged && !result.definitionVerified; if (fact.commitAcknowledged) op.committed = result;
    if (lifetime.current === op.lifetime) { if (live.current.outcome !== result) replace({ ...live.current, preview: undefined, confirmation: '', outcome: result, fact: result.fact, locked: fact.commitAcknowledged }); setMessage(fact.commitAcknowledged ? text.committed : sqliteObjectsFactMessage(fact)); }
    return true;
  }
  async function finish(op: Operation): Promise<void> {
    let wait: Promise<void> | undefined; do { wait = op.cancel; if (wait) await wait; } while (wait !== op.cancel);
    reconcileAcknowledged(op);
    if (operation.current === op) operation.current = undefined; for (const item of op.tableLeases) item.lease.release(); op.lease?.release(); if (lifetime.current === op.lifetime) setBusy(false);
    if (op.committed?.definitionVerified) { current(); if (lifetime.current && !invalid.current) { try { fixed.onApplied?.(op.committed, fixed.version); } catch (reason) { report(reason); } } else useWorkspace.getState().notify(text.committedStale, true); }
    if (op.uncertain) try { fixed.onExecutionUncertain?.(op.target, fixed.action); } catch (reason) { report(reason); }
    if (!lifetime.current) void releaseAll().catch(report);
  }
  /** 刷新前明确放弃整组草稿；撤销旧cap与草稿是同步动作，取消不复活旧预览。 */
  function inspect(confirmed = false): void {
    if (!editable()) return; if (!confirmed && (draft.sqlTouched || draft.relation || draft.preview || draft.acknowledgements.length || draft.confirmation)) { setReread(true); return; }
    const parsed = sqliteObjectsInspectSchema.safeParse({ ...targetOf(), action: fixed.action, taskId: uid() }); if (!parsed.success) { setError(text.invalid); return; }
    const op = begin('inspect', { ...draft, catalogue: undefined, preview: undefined, acknowledgements: [], confirmation: '', outcome: undefined, fact: undefined, locked: false }); if (!op) return; fixed.onTargetChange?.(undefined); setReread(false);
    op.promise = (async () => { try { await releaseAll(); if (!accepts(op)) return; op.sent = true; const raw = await fixed.services.inspect({ ...parsed.data, taskId: op.id }); if (typeof raw?.catalogueId === 'string') catalogues.current.add(raw.catalogueId); const value = sqliteObjectsInspectionSchema.parse(raw); if (!accepts(op)) { await releaseOne('catalogueId', value.catalogueId); return; } if (!sameTarget(value.target) || value.action !== fixed.action || value.readOnly !== (fixed.profile?.dialect === 'sqlite' && fixed.profile.sqlite.readOnly) || Date.parse(value.expiresAt) <= Date.now()) { await releaseOne('catalogueId', value.catalogueId); throw Error(text.response); } replace({ ...op.draft, catalogue: value, ...(fixed.action === 'replace' && !op.draft.sqlTouched && !op.draft.sql ? { sql: value.sourceSql ?? '' } : {}) }); fixed.onTargetChange?.(value.target); } catch (reason) { if (lifetime.current === op.lifetime && !op.cancelled) report(reason); } finally { await finish(op); } })();
  }
  function preview(): void {
    if (!editable() || !draft.catalogue || !catalogueUsable()) return; const parsed = sqliteObjectsPreviewSchema.safeParse({ catalogueId: draft.catalogue.catalogueId, ...(fixed.action === 'drop' ? {} : { sql: draft.sql }), taskId: uid() }); if (!parsed.success) { setError(text.designInvalid); return; }
    const op = begin('preview', { ...draft, preview: undefined, confirmation: '', acknowledgements: [], outcome: undefined, fact: undefined }); if (!op) return;
    op.promise = (async () => { try { for (const id of [...previews.current]) await releaseOne('previewId', id); if (!accepts(op)) return; op.sent = true; const raw = await fixed.services.preview({ catalogueId: op.draft.catalogue!.catalogueId, ...(fixed.action === 'drop' ? {} : { sql: op.draft.sql }), taskId: op.id }); if (typeof raw?.previewId === 'string') previews.current.add(raw.previewId); const value = sqliteObjectsPreviewOutputSchema.parse(raw), expected = buildSqliteObjectsPlan(op.target, fixed.action, fixed.action === 'drop' ? undefined : op.draft.sql, op.draft.catalogue!.attachedTriggers); if (!accepts(op)) { await releaseOne('previewId', value.previewId); return; } if (!sameTarget(value.target) || value.catalogueId !== op.draft.catalogue!.catalogueId || value.action !== fixed.action || value.attachedTriggerCount !== op.draft.catalogue!.attachedTriggers.length || JSON.stringify(value.sql) !== JSON.stringify(expected.sql) || JSON.stringify(value.requiredAcknowledgements) !== JSON.stringify(expected.requiredAcknowledgements) || Date.parse(value.expiresAt) <= Date.now()) { await releaseOne('previewId', value.previewId); throw Error(text.response); } replace({ ...op.draft, preview: value }); } catch (reason) { if (lifetime.current === op.lifetime && !op.cancelled) report(reason); } finally { await finish(op); } })();
  }
  /** 原预览仅消费一次，真实回执保留到关闭；失败可重新预览，unknown与ACK永久锁原批。 */
  function apply(): void {
    const chosen = draft.preview; if (!editable() || !chosen || fixed.profile?.dialect !== 'sqlite' || fixed.profile.sqlite.readOnly || draft.catalogue?.readOnly || draft.confirmation !== chosen.confirmation || chosen.requiredAcknowledgements.some(item => !draft.acknowledgements.includes(item)) || Date.parse(chosen.expiresAt) <= Date.now() || consumed.current.has(chosen.previewId)) return;
    const op = begin('apply'); if (!op) return; consumed.current.add(chosen.previewId);
    op.promise = (async () => {
      try {
        if (!accepts(op)) return; op.sent = true;
        const value = sqliteObjectsOutcomeSchema.parse(await fixed.services.apply({ previewId: chosen.previewId, taskId: op.id, confirmation: chosen.confirmation, acknowledgements: [...op.draft.acknowledgements] }));
        if (!sameTarget(value.target) || value.action !== fixed.action || value.fact.requestedStatements !== op.expectedStatements) throw Error(text.response);
        if (op.fact) assertSqliteObjectsFactTransition(op.fact, value.fact);
        op.fact = value.fact; op.resultReceived = true;
        if (value.fact.commitMayHaveBeenSent || value.outcome === 'unknown') op.commitBoundary = true;
        if (value.fact.commitAcknowledged) { op.committed = value; op.uncertain = !value.definitionVerified; } else if (value.outcome === 'unknown') op.uncertain = true;
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
  function close(confirmed = false): void { if (!local() || closing) return; if (!confirmed && (!draft.outcome?.fact.commitAcknowledged && (draft.sqlTouched || fixed.action === 'create' && !!draft.name || !!draft.relation || draft.preview || draft.acknowledgements.length || draft.confirmation || draft.locked || operation.current))) { setDiscard(true); return; } const token = lifetime.current, epoch = sourceEpoch.current, op = operation.current; closed.current = true; setClosing(true); stop(op); void (async () => { if (op?.promise) await op.promise; if (op?.cancel) await op.cancel; await releaseAll(); if (lifetime.current === token && sourceEpoch.current === epoch) { fixed.onDirtyChange?.(false); fixed.onClose(); } })().catch(reason => { closed.current = false; if (lifetime.current) setClosing(false); report(reason); }); }
  useLayoutEffect(() => { rendered.current = ticket; return () => { if (rendered.current === ticket) rendered.current = undefined; }; });
  useEffect(() => { const token = {}; lifetime.current = token; const observe = () => { if (!current()) { stop(); tick(value => value + 1); } }; const unsubscribe = useWorkspace.subscribe(observe), tasks = fixed.services.subscribe(event => { const op = operation.current; if (!op || event.taskId !== op.id) return; if (op.kind === 'apply' && event.sqliteObjects) { if (event.sqliteObjectsOperation !== 'apply') return; const parsed = sqliteObjectsFactSchema.safeParse(event.sqliteObjects); if (!parsed.success || !sameTarget(parsed.data.target) || parsed.data.action !== fixed.action || parsed.data.requestedStatements !== op.expectedStatements) return; try { if (op.fact) assertSqliteObjectsFactTransition(op.fact, parsed.data); } catch { return; } op.fact = parsed.data; if (parsed.data.commitMayHaveBeenSent || parsed.data.phase === 'unknown') op.commitBoundary = true; if (lifetime.current) { const next = { ...live.current, fact: parsed.data }; live.current = next; op.draft = next; setDraft(next); } if (op.resultReceived) reconcileAcknowledged(op); } if (!current()) stop(op); if (lifetime.current) { setProgress(event); /* 原Promise回包或事件已验证的ACK高于任何迟到进度，release仍在途也不能降级。 */ if (op.fact?.commitAcknowledged) setMessage(text.committed); else if (op.fact?.rollbackAcknowledged) setMessage(sqliteObjectsFactMessage(op.fact)); else if (op.resultReceived && op.uncertain) setMessage(text.unknown); else if (op.commitBoundary) setMessage(text.commitBoundary); } }); observe(); tick(value => value + 1); return () => { unsubscribe(); tasks(); if (lifetime.current === token) lifetime.current = null; stop(); if (!operation.current) void releaseAll().catch(report); fixed.onTargetChange?.(undefined); fixed.onDirtyChange?.(false); }; }, []);
  const valid = current(), disabled = busy || closing || !valid || draft.locked, catalogue = draft.catalogue, previewed = draft.preview, catalogueExpired = !!catalogue && Date.parse(catalogue.expiresAt) <= Date.now(), previewExpired = !!previewed && Date.parse(previewed.expiresAt) <= Date.now(), renderedOperation = operation.current;
  useEffect(() => { if (!valid) stop(); }, [valid]);
  useEffect(() => { const now = Date.now(), times = [catalogue?.expiresAt, previewed?.expiresAt].filter((value): value is string => !!value).map(Date.parse).filter(value => value > now); if (!times.length) return; const timer = setTimeout(() => tick(value => value + 1), Math.max(1, Math.min(...times) - now + 1)); return () => clearTimeout(timer); }, [catalogue, previewed, timeRevision]);
  const draftDisabled = disabled || catalogueExpired, isReadOnly = fixed.profile?.dialect === 'sqlite' && fixed.profile.sqlite.readOnly;
  /** create改名同步撤销原cap和绑定，SQL原文保留；不把旧定义自动替换成新名字。 */
  function changeName(name: string): void { if (!editable() || fixed.action !== 'create') return; nameEpoch.current++; setTemplateConfirm(false); fixed.onTargetChange?.(undefined); replace({ ...draft, name, catalogue: undefined, preview: undefined, acknowledgements: [], confirmation: '', outcome: undefined, fact: undefined, relation: '' }); void releaseAll().catch(report); setError(''); setMessage(''); }
  /** 正文可在同一次React提交前连续发布；按固定来源和最新草稿合并，不能用一次性按钮render票据丢弃后半输入。 */
  function changeSql(sql: string): void {
    if (!lifetime.current || closed.current || !current() || operation.current || closing || live.current.locked || fixed.action === 'drop') return;
    const latest = live.current;
    setTemplateConfirm(false); replace({ ...latest, sql, sqlTouched: true, preview: undefined, confirmation: '', acknowledgements: [], outcome: undefined, fact: undefined });
    // 只释放被本次正文修改撤销的准确预览，不借旧render闭包释放后继草稿能力。
    if (latest.preview) void releaseOne('previewId', latest.preview.previewId).catch(report);
    setError(''); setMessage('');
  }
  const quote = (value: string) => '"'+value.replaceAll('"','""')+'"';
  function fillTemplate(): void { if (!editable() || !catalogueUsable() || !catalogue) return; const relation=catalogue.eligibleRelations.find(value=>value.name===draft.relation); if(fixed.scope.kind==='trigger'&&!relation){setError(text.chooseRelation);return;} const sql=fixed.scope.kind==='view'?'CREATE VIEW main.'+quote(draft.name)+' AS\nSELECT 1 AS value;':'CREATE TRIGGER main.'+quote(draft.name)+'\n'+(relation!.kind==='view'?'INSTEAD OF':'AFTER')+' INSERT ON '+quote(relation!.name)+'\nBEGIN\n  SELECT 1;\nEND;'; if(draft.sql&&!templateConfirm){setTemplateConfirm(true);return;} setTemplateConfirm(false); changeSql(sql); }
  return <Modal title={text.title(fixed.action,fixed.scope.kind)} wide onClose={() => close()}><div className="modal-content sqlite-objects" aria-busy={busy||closing}><p>{fixed.scope.connectionId} / {fixed.scope.database} / {text.kinds[fixed.scope.kind]}</p><UsageHelp><p>{text.scope[fixed.action]}</p><p>{text.dependenciesHint}</p><p>{text.futureEffects}</p></UsageHelp>{isReadOnly&&<p className="warning-text">{text.readonly}</p>}<Field label={text.name}><input aria-label={text.name} value={draft.name} readOnly={fixed.action!=='create'} disabled={disabled} onChange={event=>changeName(event.target.value)}/></Field><button type="button" disabled={disabled||!draft.name} onClick={()=>inspect()}>{text.read}</button>
    {catalogue&&<><p>{catalogue.exists?text.exists:text.absent}</p><details><summary>{text.sourceSql}</summary><pre aria-label={text.sourceSql}>{catalogue.sourceSql??text.noSource}</pre></details><details><summary>{text.related}</summary><p>{text.fullCatalogueHint}</p><section aria-label={text.related}>{catalogue.relatedObjects.map(object=><details key={object.type+':'+object.name}><summary>{text.objectKinds[object.type]} · {object.name} / {object.table}</summary><pre aria-label={text.relatedSql(object.type,object.name)}>{object.sql??text.noSql}</pre></details>)}</section></details><section aria-label={text.attachedTriggers}><h3>{text.attachedTriggers}</h3>{catalogue.attachedTriggers.length?catalogue.attachedTriggers.map(trigger=><details key={trigger.name}><summary>{trigger.name}</summary><pre aria-label={text.attachedSql(trigger.name)}>{trigger.sql}</pre></details>):<p>{text.noAttachedTriggers}</p>}</section></>}
    {/* 渲染只读只依据状态与来源；editable包含提交后才成立的事件票据，不能用于渲染属性。 */}
    {fixed.action!=='drop'&&<section aria-label={text.editor}><h3>{text.editor}</h3><p>{text.editorHint}</p><SqlEditor value={draft.sql} onChange={changeSql} dialect="sqlite" completion={undefined} height={260} readOnly={disabled}/>{catalogue&&<div className="sqlite-objects-template">{fixed.scope.kind==='trigger'&&<Field label={text.relation}><select aria-label={text.relation} value={draft.relation} disabled={draftDisabled} onChange={event=>{if(editable()&&catalogue.eligibleRelations.some(value=>value.name===event.target.value)){setTemplateConfirm(false);replace({...draft,relation:event.target.value});}}}><option value="">{text.chooseRelation}</option>{catalogue.eligibleRelations.map(relation=><option key={relation.kind+':'+relation.name} value={relation.name}>{text.objectKinds[relation.kind]} · {relation.name}</option>)}</select></Field>}<button type="button" disabled={draftDisabled} onClick={fillTemplate}>{text.template}</button>{templateConfirm&&<><p>{text.templateOverwrite}</p><button type="button" disabled={draftDisabled} onClick={()=>{if(local())setTemplateConfirm(false);}}>{text.keepSql}</button><button type="button" disabled={draftDisabled} onClick={fillTemplate}>{text.replaceSql}</button></>}</div>}</section>}
    {previewed&&<section><p>{text.previewHint}</p><pre aria-label={text.previewTitle}>{previewed.sql.join('\n\n')}</pre><section aria-label={text.acknowledgements}>{previewed.requiredAcknowledgements.map(item=><label key={item}><input type="checkbox" aria-label={text.acknowledgementLabels[item]} checked={draft.acknowledgements.includes(item)} disabled={disabled||previewExpired} onChange={event=>{if(editable()&&draft.preview===previewed&&Date.parse(previewed.expiresAt)>Date.now())replace({...draft,acknowledgements:event.target.checked?[...draft.acknowledgements.filter(value=>value!==item),item]:draft.acknowledgements.filter(value=>value!==item)});}}/>{text.acknowledgementLabels[item]}</label>)}</section><Field label={text.confirmationHint(previewed.confirmation)}><input aria-label={text.confirmation} value={draft.confirmation} disabled={disabled||previewExpired} onChange={event=>{if(editable()&&draft.preview===previewed&&Date.parse(previewed.expiresAt)>Date.now())replace({...draft,confirmation:event.target.value});}}/></Field></section>}
    <SqliteObjectsFactSummary fact={draft.fact}/>{draft.outcome?.cleanupWarning===true&&<p role="alert" className="warning-text">{text.cleanupWarning}</p>}<ErrorBox message={!valid?text.invalid:error}/>{catalogueExpired&&<p className="warning-text">{previewed&&!previewExpired?text.catalogueExpiredPreview:text.catalogueExpired}</p>}{previewExpired&&<ErrorBox message={text.previewExpired}/>} {message&&<p role="status">{message}</p>}{progress&&<p role="status">{progress.message}</p>}{busy&&<Spinner text={text.loading}/>} {reread&&<p>{text.reread}</p>}{discard&&<p>{text.discard}</p>}
  </div><footer className="modal-footer">{discard?<><button type="button" disabled={closing} onClick={()=>{if(local())setDiscard(false);}}>{text.keep}</button><button type="button" disabled={closing} onClick={()=>close(true)}>{text.discardClose}</button></>:reread?<><button type="button" disabled={disabled} onClick={()=>{if(local())setReread(false);}}>{text.keep}</button><button type="button" disabled={disabled} onClick={()=>inspect(true)}>{text.discardRead}</button></>:<><button type="button" disabled={closing} onClick={()=>close()}>{text.close}</button><span className="grow"/>{busy&&renderedOperation&&<button type="button" disabled={renderedOperation.resultReceived||renderedOperation.commitBoundary||renderedOperation.fact?.commitAcknowledged||renderedOperation.fact?.rollbackAcknowledged} onClick={()=>{if(local()&&operation.current===renderedOperation)stop(renderedOperation);}}>{text.stop}</button>}<button type="button" disabled={draftDisabled||!catalogue||(fixed.action!=='drop'&&!draft.sql)} onClick={preview}>{text.preview}</button><button type="button" className={fixed.action==='drop'?'danger':'primary'} disabled={disabled||!previewed||previewExpired||isReadOnly||catalogue?.readOnly||draft.confirmation!==previewed.confirmation||previewed.requiredAcknowledgements.some(item=>!draft.acknowledgements.includes(item))||consumed.current.has(previewed.previewId)} onClick={apply}>{text.apply[fixed.action]}</button></>}</footer></Modal>;
}
