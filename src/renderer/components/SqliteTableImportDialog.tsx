import { txtImportDefaults, txtImportZh, type TxtImportOptions } from '../../shared/txtImport';
import { TxtImportFields } from './TxtImportFields';
import { xmlImportZh, type SqliteXmlImportOptions } from '../../shared/xmlImport';
import { SqliteXmlImportFields, sqliteXmlImportDefaults } from './SqliteXmlImportFields';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FileChoice, TaskEvent } from '../../shared/contracts';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import { sqliteTableCreateOutcomeSchema, type SqliteTableCreateOutcome } from '../../shared/sqliteTableCreate';
import { sqliteTableImportInspectSchema, sqliteTableImportInspectionSchema, sqliteTableImportMappingSchema, sqliteTableImportPreviewOutputSchema, sqliteTableImportOutcomeSchema, sqliteTableImportLimits, sqliteImportWriteFactSchema, assertSqliteImportWriteFactTransition, type SqliteImportWriteFact, type SqliteTableImportInspectInput, type SqliteTableImportInspectOutput, type SqliteTableImportPreviewInput, type SqliteTableImportPreviewOutput, type SqliteTableImportApplyInput, type SqliteTableImportReleaseInput, type SqliteTableImportOutcome, type SqliteTableImportMapping } from '../../shared/sqliteTableImport';
import { errorMessage, invoke, uid } from '../lib';
import { sqliteTableImportZh as text } from '../locales/sqliteTableImport.zh-CN';
import { sqliteImportFactMessage } from '../../shared/sqliteTableImportFact';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';
import '../sqliteTableImport.css';
import { csvImportDelimiters } from '../../shared/csvImport';

/** 只捕获原表页来源；不把当前页数据、筛选草稿或编辑快照当成导入内容。 */
export class SqliteTableImportSource {
  readonly id = uid();
  readonly target: { connectionId: string; database: 'main'; table: string }; readonly readOnly: boolean;
  private dead = false; private checking = false; private readonly values: readonly unknown[]; private listeners = new Set<() => void>();
  private readonly page?: SqliteTablePage;
  constructor(page: SqliteTablePage, readOnly: boolean, values: readonly unknown[], guard: () => boolean);
  constructor(created: SqliteTableCreateOutcome, readOnly: boolean, values: readonly unknown[], guard: () => boolean);
  constructor(input: SqliteTablePage | SqliteTableCreateOutcome, readOnly: boolean, values: readonly unknown[], private readonly guard: () => boolean) {
    if ('outcome' in input) {
      const receipt = sqliteTableCreateOutcomeSchema.parse(input);
      if (receipt.outcome !== 'committed' || !receipt.fact.commitAcknowledged || !receipt.definitionVerified) throw Error(text.invalid);
      this.target = Object.freeze({ ...receipt.target });
    } else {
      if (input.target.kind !== 'table' || input.target.database !== 'main' || !input.target.connectionId || !input.target.table) throw Error(text.invalid);
      this.page = input; this.target = Object.freeze({ connectionId: input.target.connectionId, database: 'main', table: input.target.table });
    }
    this.readOnly = readOnly; this.values = [...values];
  }
  /** 新表来源只由真实且核验通过的建表回执建立，不伪造表页或查询会话。 */
  static forCreated(receipt: SqliteTableCreateOutcome, readOnly: boolean, values: readonly unknown[], guard: () => boolean): SqliteTableImportSource { return new SqliteTableImportSource(receipt, readOnly, values, guard); }
  observe(values: readonly unknown[]): void { if (values.length !== this.values.length || values.some((value, index) => !Object.is(value, this.values[index]))) this.invalidate(); }
  observePage(page?: SqliteTablePage): void { if (page !== this.page) this.invalidate(); }
  current(): boolean { if (this.dead || this.checking) return false; this.checking = true; try { if (!this.guard()) this.invalidate(); } catch { this.invalidate(); } finally { this.checking = false; } return !this.dead; }
  invalidate(): void { if (this.dead) return; this.dead = true; queueMicrotask(() => { for (const listener of this.listeners) listener(); }); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
}
export interface SqliteTableImportServices {
  choose(input: { purpose: 'import'; format: SqliteTableImportInspectInput['format'] }): Promise<FileChoice | null>;
  inspect(input: SqliteTableImportInspectInput): Promise<SqliteTableImportInspectOutput>;
  preview(input: SqliteTableImportPreviewInput): Promise<SqliteTableImportPreviewOutput>;
  apply(input: SqliteTableImportApplyInput): Promise<SqliteTableImportOutcome>;
  release(input: SqliteTableImportReleaseInput): Promise<void>; cancel(taskId: string): Promise<unknown>; subscribe(listener: (event: TaskEvent) => void): () => void;
}
export const sqliteTableImportServices: SqliteTableImportServices = {
  choose: input => invoke('files.choose', input), inspect: input => invoke('sqlite.tableImport.inspect', input), preview: input => invoke('sqlite.tableImport.preview', input), apply: input => invoke('sqlite.tableImport.apply', input), release: input => invoke('sqlite.tableImport.release', input), cancel: taskId => invoke('query.cancel', { taskId }), subscribe: listener => window.dbark.onTask(listener),
};
export interface SqliteTableImportInitialSource { file: FileChoice; sourceId: string; format: SqliteTableImportInspectInput['format']; encoding: SqliteTableImportInspectInput['encoding']; csvDelimiter?: NonNullable<SqliteTableImportInspectInput['csvDelimiter']>; csvHasHeader?: boolean; xmlOptions?: SqliteXmlImportOptions; txtOptions?: TxtImportOptions; }
interface Props { source: SqliteTableImportSource; initialSource?: SqliteTableImportInitialSource; services?: SqliteTableImportServices; onActivity(delta: 1 | -1): void; onDirtyChange?(dirty: boolean): void; onClose(): void; onCommitted?(output: SqliteTableImportOutcome, sourceChanged: boolean): void; onCleanupError(message: string): void; }
type Mapping = { id: string; source: string | null; target: string; kind: SqliteTableImportMapping['kind'] };
type Draft = { format: SqliteTableImportInspectInput['format']; encoding: SqliteTableImportInspectInput['encoding']; delimiter: NonNullable<SqliteTableImportInspectInput['csvDelimiter']>; header: boolean; xmlOptions: SqliteXmlImportOptions; txtOptions: TxtImportOptions; file?: FileChoice; inspection?: SqliteTableImportInspectOutput; mapping: Mapping[]; preview?: SqliteTableImportPreviewOutput; confirmation: string; outcome?: SqliteTableImportOutcome; locked: boolean; };
type Operation = { kind: 'choose' | 'inspect' | 'preview' | 'apply'; id?: string; draft: Draft; generation: number; readonly expectedRows?: number; cancelled: boolean; sent: boolean; resultReceived?: boolean; receivedOutcome?: SqliteTableImportOutcome; commitBoundary: boolean; fact?: SqliteImportWriteFact; cancel?: Promise<void>; promise?: Promise<void>; committed?: SqliteTableImportOutcome; committedNotified?: boolean; };

/** 完整文件检查与显式映射分阶段进行；只有一次明确确认才能提交原表的独立事务。 */
export function SqliteTableImportDialog({ source, initialSource, services = sqliteTableImportServices, ...callbacks }: Props) {
  const owner = useRef({ source, initialSource, services, callbacks }).current;
  // 只固定同一检查能力及原文件选项；仍需用户对真实新表重新检查、映射和预检。
  const seed = useRef(initialSource ? sqliteTableImportInspectSchema.safeParse({ ...source.target, sourceId: initialSource.sourceId, fileToken: initialSource.file.token, format: initialSource.format, encoding: initialSource.encoding, ...(initialSource.format === 'csv' ? { csvDelimiter: initialSource.csvDelimiter ?? ',', csvHasHeader: initialSource.csvHasHeader ?? true } : {}), ...(initialSource.format === 'xml' ? { xmlOptions: initialSource.xmlOptions } : {}), ...(initialSource.format === 'txt' ? { txtOptions: initialSource.txtOptions } : {}), taskId: 'initial-source-validation' }) : undefined).current;
  const [draft, setDraft] = useState<Draft>(() => ({ format: seed?.success ? seed.data.format : 'csv', encoding: seed?.success ? seed.data.encoding : 'utf8', delimiter: seed?.success ? seed.data.csvDelimiter ?? ',' : ',', header: seed?.success ? seed.data.csvHasHeader ?? true : true, xmlOptions: seed?.success && seed.data.xmlOptions ? seed.data.xmlOptions : sqliteXmlImportDefaults, txtOptions: seed?.success && seed.data.txtOptions ? seed.data.txtOptions : txtImportDefaults, ...(seed?.success ? { file: { ...initialSource!.file } } : {}), mapping: [], confirmation: '', locked: false })), live = useRef(draft); live.current = draft;
  const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [discard, setDiscard] = useState(false), [stale, setStale] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [progress, setProgress] = useState<TaskEvent>(), [timeRevision, tick] = useState(0);
  const mounted = useRef(true), closed = useRef(false), invalid = useRef(false), generation = useRef(0), operation = useRef<Operation | undefined>(undefined), consumed = useRef(new Set<string>()), closedProps = useRef({ source, services, initialSource }); closedProps.current = { source, services, initialSource };
  const propsEpoch = useRef(0), observedProps = useRef({ source, services, initialSource });
  if (observedProps.current.source !== source || observedProps.current.services !== services || observedProps.current.initialSource !== initialSource) { observedProps.current = { source, services, initialSource }; propsEpoch.current++; }
  const inspections = useRef(new Set<string>()), previews = useRef(new Set<string>()), releases = useRef(new Map<string, Promise<void>>());
  const renderTicket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; }; });
  if (owner.source !== source || owner.services !== services || owner.initialSource !== initialSource || seed && !seed.success) invalid.current = true;
  const sameTarget = (value: { connectionId: string; database: string; table: string }) => value.connectionId === owner.source.target.connectionId && value.database === 'main' && value.table === owner.source.target.table;
  function current(): boolean { if (!mounted.current || closed.current || invalid.current) return false; if (!owner.source.current()) invalid.current = true; return !invalid.current; }
  function localCurrent(): boolean { return mounted.current && !closed.current && committed.current === renderTicket && live.current === draft; }
  function editable(): boolean { return localCurrent() && current() && !operation.current && !closing && !draft.locked; }
  function report(reason: unknown): void { const value = errorMessage(reason); if (mounted.current && !closed.current) setError(value); else try { owner.callbacks.onCleanupError(value); } catch { /* 收尾反馈不能替代原事务事实。 */ } }
  /** dirty先同步登记到原表页，退出守卫不能错过尚未提交的映射或预检。 */
  function replace(next: Draft): void { live.current = next; owner.callbacks.onDirtyChange?.(!next.outcome?.fact.commitAcknowledged && (!!next.file || !!next.inspection || next.mapping.some(row => !!row.target) || next.locked)); setDraft(next); }
  async function releaseOne(kind: 'inspectionId' | 'previewId', id: string): Promise<void> {
    const key = kind + ':' + id; let promise = releases.current.get(key);
    if (!promise) { promise = Promise.resolve().then(() => owner.services.release({ [kind]: id })).then(() => { (kind === 'inspectionId' ? inspections.current : previews.current).delete(id); }); releases.current.set(key, promise); }
    try { await promise; } finally { if (releases.current.get(key) === promise) releases.current.delete(key); }
  }
  async function releaseAll(): Promise<void> { const errors: string[] = []; for (const [kind, values] of [['previewId', previews.current], ['inspectionId', inspections.current]] as const) for (const id of [...values]) try { await releaseOne(kind, id); } catch (reason) { errors.push(errorMessage(reason)); } if (errors.length) throw Error(errors.join('\n')); }
  function revokePreview(): void { if (draft.preview?.ok) void releaseOne('previewId', draft.preview.previewId).catch(report); }
  /** 配置变化撤销文件授权和原检查，不继承旧格式的令牌或旧SQL。 */
  function configure(patch: Partial<Pick<Draft, 'format' | 'encoding' | 'delimiter' | 'header' | 'xmlOptions' | 'txtOptions'>>): void {
    if (!editable() || owner.initialSource) return; void releaseAll().catch(report); replace({ ...draft, ...patch, ...(patch.format === 'xml' ? { encoding: 'utf8' } : {}), file: undefined, inspection: undefined, mapping: [], preview: undefined, confirmation: '', outcome: undefined, locked: false }); setError(''); setMessage('');
  }
  function mappingAt(row: Mapping, patch: Partial<Pick<Mapping, 'target' | 'kind'>>): void { if (!editable() || !draft.inspection || Date.parse(draft.inspection.expiresAt) <= Date.now() || row.source === null || !draft.mapping.includes(row)) return; revokePreview(); replace({ ...draft, mapping: draft.mapping.map(value => value === row ? { ...value, ...patch } : value), preview: undefined, confirmation: '', outcome: undefined }); setError(''); setMessage(''); }
  function addMapping(): void { if (!editable() || !draft.inspection || Date.parse(draft.inspection.expiresAt) <= Date.now() || draft.mapping.length >= sqliteTableImportLimits.mapping) return; revokePreview(); replace({ ...draft, mapping: [...draft.mapping, { id: uid(), source: null, target: '', kind: 'text' }], preview: undefined, confirmation: '', outcome: undefined }); }
  function removeMapping(row: Mapping): void { if (!editable() || !draft.inspection || Date.parse(draft.inspection.expiresAt) <= Date.now() || !draft.mapping.includes(row)) return; revokePreview(); replace({ ...draft, mapping: draft.mapping.filter(value => value !== row), preview: undefined, confirmation: '', outcome: undefined }); }
  /** 空字符串是合法JSON键；只有null表示未选择，选项值用索引编码避免键名与哨兵冲突。 */
  function sourceAt(row: Mapping, encoded: string): void {
    if (!editable() || !draft.inspection || Date.parse(draft.inspection.expiresAt) <= Date.now() || !draft.mapping.includes(row)) return;
    const index = /^s\d+$/.test(encoded) ? Number(encoded.slice(1)) : -1;
    if (encoded !== '' && (!Number.isSafeInteger(index) || index < 0 || index >= draft.inspection.sourceColumns.length)) return;
    const source = encoded === '' ? null : draft.inspection.sourceColumns[index]; revokePreview();
    replace({ ...draft, mapping: draft.mapping.map(value => value === row ? { ...row, source } : value), preview: undefined, confirmation: '', outcome: undefined });
  }
  /** 同步原租约覆盖每个请求和原取消ACK；旧finally只释放自己的busy。 */
  function begin(kind: Operation['kind'], pendingDraft = draft, expectedRows?: number): Operation | undefined {
    if (!editable()) return;
    const op: Operation = { kind, ...(kind === 'choose' ? {} : { id: uid() }), draft: pendingDraft, generation: generation.current, expectedRows, cancelled: false, sent: false, commitBoundary: false }; operation.current = op;
    try { owner.callbacks.onActivity(1); if (!current()) throw Error(text.stale); if (pendingDraft !== draft) replace(pendingDraft); setBusy(true); setError(''); setMessage(''); setProgress(undefined); return op; }
    catch (reason) { operation.current = undefined; try { owner.callbacks.onActivity(-1); } catch {} report(reason); }
  }
  const accepts = (op: Operation) => operation.current === op && generation.current === op.generation && live.current === op.draft && current() && !op.cancelled;
  async function finish(op: Operation): Promise<void> {
    let pending: Promise<void> | undefined; do { pending = op.cancel; if (pending) await pending; } while (pending !== op.cancel);
    // 原请求、预览释放和取消ACK均结束后，再收束清理期间晚到的真实事务ACK。
    reconcileAcknowledged(op);
    if (operation.current === op) operation.current = undefined;
    try { owner.callbacks.onActivity(-1); } catch (reason) { report(reason); }
    if (mounted.current && generation.current === op.generation) setBusy(false);
    if (op.committed && !op.committedNotified) { op.committedNotified = true; const changed = !mounted.current || invalid.current || !owner.source.current(); try { owner.callbacks.onCommitted?.(op.committed, changed); } catch (reason) { report(reason); } }
    if (!mounted.current) void releaseAll().catch(report);
  }
  function stop(op = operation.current): void { if (!op || operation.current !== op || op.cancelled || op.commitBoundary || op.resultReceived || op.fact?.commitAcknowledged || op.fact?.rollbackAcknowledged) return; op.cancelled = true; if (op.sent && op.id) op.cancel = Promise.resolve().then(() => owner.services.cancel(op.id!)).then(() => undefined).catch(report); if (mounted.current) setMessage(text.cancelling); }
  /** 取消文件选择保留完整旧草稿；chooser晚回不得给新格式或后继来源签入令牌。 */
  function choose(): void {
    if (owner.initialSource) return;
    const op = begin('choose'); if (!op) return;
    op.promise = (async () => {
      try { const file = await owner.services.choose({ purpose: 'import', format: op.draft.format }); if (!accepts(op)) return; if (!file) { replace({ ...op.draft }); return; } if (!file.token || !file.name) throw Error(text.invalid); op.draft = { ...op.draft, file, inspection: undefined, preview: undefined, confirmation: '', outcome: undefined }; replace(op.draft); await releaseAll(); if (!accepts(op)) return; }
      catch (reason) { if (mounted.current && generation.current === op.generation) report(reason); }
      finally { await finish(op); }
    })();
  }
  /** 检查完整原文件和准确目标元数据；有限样本不作为导入记录来源。 */
  function inspect(): void {
    if (!editable() || !draft.file) return;
    const parsedInput = sqliteTableImportInspectSchema.safeParse({ ...owner.source.target, ...(seed?.success ? { sourceId: seed.data.sourceId } : {}), fileToken: draft.file.token, format: draft.format, encoding: draft.encoding, ...(draft.format === 'csv' ? { csvDelimiter: draft.delimiter, csvHasHeader: draft.header } : {}), ...(draft.format === 'xml' ? { xmlOptions: draft.xmlOptions } : {}), ...(draft.format === 'txt' ? { txtOptions: draft.txtOptions } : {}), taskId: uid() });
    if (!parsedInput.success) { setError(text.invalid); return; } const input = parsedInput.data;
    // 首次释放能力前同步撤销可提交草稿，停止/失败不能恢复已经release的旧预览。
    const op = begin('inspect', { ...draft, inspection: undefined, preview: undefined, confirmation: '', outcome: undefined }); if (!op) return; input.taskId = op.id!;
    op.promise = (async () => {
      try {
        await releaseAll(); if (!accepts(op)) return; op.sent = true; const raw = await owner.services.inspect(input); if (typeof raw.inspectionId === 'string') inspections.current.add(raw.inspectionId); const value = sqliteTableImportInspectionSchema.parse(raw);
        if (!accepts(op)) { await releaseOne('inspectionId', value.inspectionId); return; }
        if (!sameTarget(value.target) || value.readOnly !== owner.source.readOnly || Date.parse(value.expiresAt) <= Date.now()) { await releaseOne('inspectionId', value.inspectionId); throw Error(text.invalid); }
        const mapping = op.draft.mapping.filter(row => row.source !== null && value.sourceColumns.includes(row.source) && value.columns.some(column => column.name === row.target && !column.generated)).map(row => ({ ...row, id: uid() }));
        replace({ ...op.draft, inspection: value, mapping, preview: undefined, confirmation: '', outcome: undefined });
      } catch (reason) { if (mounted.current && generation.current === op.generation && !op.cancelled) { replace({ ...op.draft, file: undefined, inspection: undefined, preview: undefined, confirmation: '' }); report(reason); } }
      finally { await finish(op); }
    })();
  }
  /** 全部映射先经共享严格合同，整文件预检有错误时没有可提交preview能力。 */
  function preview(): void {
    if (!editable() || !draft.inspection) return;
    if (Date.parse(draft.inspection.expiresAt) <= Date.now()) { setError(text.expired); return; }
    const parsed = sqliteTableImportMappingSchema.safeParse(draft.mapping.flatMap(({ source, target, kind }) => source !== null && target ? [{ source, target, kind }] : [])); if (!parsed.success) { setError(text.noMapping); return; }
    const op = begin('preview', { ...draft, preview: undefined, confirmation: '', outcome: undefined }); if (!op) return;
    op.promise = (async () => {
      try {
        for (const id of [...previews.current]) await releaseOne('previewId', id); if (!accepts(op)) return; op.sent = true;
        const raw = await owner.services.preview({ inspectionId: op.draft.inspection!.inspectionId, mapping: parsed.data, taskId: op.id! }); if (raw.ok && typeof raw.previewId === 'string') previews.current.add(raw.previewId); const value = sqliteTableImportPreviewOutputSchema.parse(raw);
        if (!accepts(op)) { if (value.ok) await releaseOne('previewId', value.previewId); return; }
        const original = op.draft.inspection!;
        if (!sameTarget(value.target) || value.inspectionId !== original.inspectionId || value.source.sha256 !== original.source.sha256 || value.source.bytes !== original.source.bytes || value.records !== original.records || value.ok && Date.parse(value.expiresAt) <= Date.now()) { if (value.ok) await releaseOne('previewId', value.previewId); throw Error(text.invalid); }
        replace({ ...op.draft, preview: value, confirmation: '', outcome: undefined }); if (!value.ok) setMessage(text.invalidRows);
      } catch (reason) { if (mounted.current && generation.current === op.generation && !op.cancelled) { replace({ ...op.draft, preview: undefined, confirmation: '' }); report(reason); } }
      finally { await finish(op); }
    })();
  }
  /** 只收束本操作已由Main事件核验的ACK；预览记录数在领取时固定，不能随显示草稿变化。 */
  function confirmedFailureOutcome(op: Operation): SqliteTableImportOutcome | undefined {
    const parsed = sqliteImportWriteFactSchema.safeParse(op.fact);
    if (!op.sent || op.kind !== 'apply' || !parsed.success || !sameTarget(parsed.data.target) || parsed.data.requestedRows !== op.expectedRows || !parsed.data.commitAcknowledged && !parsed.data.rollbackAcknowledged) return;
    const fact = parsed.data;
    const received = op.receivedOutcome;
    // 已知终态不重建，保留原请求的失败行及清理告警；未知回执只能由同操作ACK收束。
    if (received && JSON.stringify(received.fact) === JSON.stringify(fact)) return received;
    return sqliteTableImportOutcomeSchema.parse({ operationId: fact.operationId, target: fact.target, outcome: fact.commitAcknowledged ? 'committed' : 'rolled-back', counts: { insert: fact.requestedRows, update: 0, delete: 0 }, fact, message: sqliteImportFactMessage(fact), cleanupWarning: true, ...(!fact.commitAcknowledged && received?.operationId === fact.operationId && received.failure ? { failure: received.failure } : {}) });
  }
  /** 事件只更新已settle请求的准确回执，提交通知仍由finish在所有原收尾完成后单次发送。 */
  function reconcileAcknowledged(op: Operation): SqliteTableImportOutcome | undefined {
    if (!op.resultReceived) return;
    const value = confirmedFailureOutcome(op); if (!value) return;
    if (value.fact.commitAcknowledged) op.committed = value;
    if (mounted.current && generation.current === op.generation) {
      replace({ ...op.draft, preview: undefined, confirmation: '', outcome: value, locked: value.fact.commitAcknowledged });
      setMessage(value.fact.commitAcknowledged ? text.committed(value.fact.appliedRows) : sqliteImportFactMessage(value.fact));
    }
    return value;
  }
  /** 预览一次性消费，已确认COMMIT独立于晚取消和刷新；未知批次绝不自动重放。 */
  function apply(): void {
    const chosen = draft.preview;
    if (!editable() || !chosen?.ok || owner.source.readOnly || draft.inspection?.readOnly || draft.confirmation !== chosen.confirmation || consumed.current.has(chosen.previewId)) return;
    if (Date.parse(chosen.expiresAt) <= Date.now()) { setError(text.expired); return; }
    const op = begin('apply', draft, chosen.records); if (!op) return; consumed.current.add(chosen.previewId);
    op.promise = (async () => {
      try {
        if (!accepts(op)) return; op.sent = true; const value = sqliteTableImportOutcomeSchema.parse(await owner.services.apply({ previewId: chosen.previewId, confirmation: chosen.confirmation, taskId: op.id! }));
        if (!sameTarget(value.target) || value.fact.requestedRows !== op.expectedRows) throw Error(text.invalid);
        if (op.fact) assertSqliteImportWriteFactTransition(op.fact, value.fact);
        // 请求已取得可信终态；元数据释放仍在等待时，也不能再向已结束的任务发取消。
        op.fact = value.fact; op.receivedOutcome = value; op.resultReceived = true;
        if (value.fact.commitMayHaveBeenSent || value.fact.phase === 'unknown') op.commitBoundary = true;
        if (value.fact.commitAcknowledged) op.committed = value;
        if (mounted.current && generation.current === op.generation) { replace({ ...op.draft, preview: undefined, confirmation: '', outcome: value, locked: value.fact.commitAcknowledged || value.outcome === 'unknown' }); setMessage(value.fact.commitAcknowledged ? text.committed(value.fact.appliedRows) : value.outcome === 'unknown' ? text.unknown : value.message); }
      } catch (reason) {
        const confirmed = confirmedFailureOutcome(op);
        // transport已settle并不代表release已完成；保持原busy等待，同时禁止旧Stop再取消终结任务。
        if (op.sent) op.resultReceived = true;
        if (confirmed?.fact.commitAcknowledged) op.committed = confirmed;
        if (mounted.current && generation.current === op.generation) {
          replace({ ...op.draft, preview: undefined, confirmation: '', ...(confirmed ? { outcome: confirmed } : {}), locked: confirmed ? confirmed.fact.commitAcknowledged : op.sent });
          setMessage(confirmed ? confirmed.fact.commitAcknowledged ? text.committed(confirmed.fact.appliedRows) : confirmed.message : op.sent ? text.unknown : ''); report(reason);
        }
      }
      finally { await releaseOne('previewId', chosen.previewId).catch(report); await finish(op); }
    })();
  }
  /** 关闭只处理原owner，等待真实任务与取消ACK后再释放所有准确能力。 */
  function close(confirmed = false): void {
    if (!localCurrent() || closing) return;
    if (!confirmed && !draft.outcome?.fact.commitAcknowledged && (!!draft.file || !!draft.inspection || draft.locked)) { setDiscard(true); return; }
    const token = generation.current, epoch = propsEpoch.current; setClosing(true); closed.current = true; const active = operation.current; stop(active);
    void (async () => { if (active?.promise) await active.promise; if (active?.cancel) await active.cancel; await releaseAll(); if (mounted.current && generation.current === token && propsEpoch.current === epoch && closedProps.current.source === owner.source && closedProps.current.services === owner.services && closedProps.current.initialSource === owner.initialSource) { owner.callbacks.onDirtyChange?.(false); owner.callbacks.onClose(); } })().catch(reason => { closed.current = false; if (mounted.current) setClosing(false); report(reason); });
  }
  useEffect(() => {
    mounted.current = true;
    if (owner.initialSource && seed?.success) owner.callbacks.onDirtyChange?.(true);
    const unsubscribeSource = owner.source.subscribe(() => { invalid.current = true; if (mounted.current) setStale(true); stop(); });
    const unsubscribe = owner.services.subscribe(event => {
      const op = operation.current; if (!op || event.taskId !== op.id) return;
      if (op.kind === 'apply' && event.sqliteWrite) {
        const parsed = sqliteImportWriteFactSchema.safeParse(event.sqliteWrite);
        if (!parsed.success || !sameTarget(parsed.data.target) || parsed.data.requestedRows !== op.expectedRows) return;
        try { if (op.fact) assertSqliteImportWriteFactTransition(op.fact, parsed.data); } catch { return; }
        op.fact = parsed.data;
        if (parsed.data.commitMayHaveBeenSent || parsed.data.phase === 'commit-pending' || parsed.data.phase === 'unknown') op.commitBoundary = true;
        reconcileAcknowledged(op);
      }
      // 来源撤权、旧stop闭包、关闭和卸载都必须尊重已观察的COMMIT单向边界。
      if (!owner.source.current()) { invalid.current = true; if (mounted.current) setStale(true); stop(op); }
      if (mounted.current) {
        // 迟到进度不能把已确认COMMIT/ROLLBACK重新描述为等待提交；原事实始终优先。
        if (op.fact?.commitAcknowledged) setMessage(text.committed(op.fact.appliedRows));
        else if (op.fact?.rollbackAcknowledged) setMessage(sqliteImportFactMessage(op.fact));
        else if (op.kind === 'apply' && op.resultReceived && (!op.receivedOutcome || op.receivedOutcome.outcome === 'unknown')) setMessage(text.unknown);
        else if (op.commitBoundary) setMessage(text.commitBoundary);
        setProgress(event);
      }
    });
    return () => { mounted.current = false; generation.current++; unsubscribeSource(); unsubscribe(); stop(); if (!operation.current) void releaseAll().catch(report); owner.callbacks.onDirtyChange?.(false); };
  }, []);
  useEffect(() => { const now = Date.now(), deadlines = [draft.inspection?.expiresAt, draft.preview?.ok ? draft.preview.expiresAt : undefined].filter((value): value is string => !!value).map(Date.parse).filter(value => Number.isFinite(value) && value > now); if (!deadlines.length) return; const timer = setTimeout(() => tick(value => value + 1), Math.max(1, Math.min(...deadlines) - now + 1)); return () => clearTimeout(timer); }, [draft.preview, draft.inspection, timeRevision]);
  const valid = current(), disabled = busy || closing || !valid || draft.locked, inspection = draft.inspection, selected = draft.preview?.ok ? draft.preview : undefined;
  const configurationDisabled = disabled || !!owner.initialSource;
  const inspectionExpired = !!inspection && Date.parse(inspection.expiresAt) <= Date.now(), previewExpired = !!selected && Date.parse(selected.expiresAt) <= Date.now();
  const renderedOperation = operation.current;
  return <Modal title={text.title} wide onClose={() => close()}><div className="modal-content sqlite-table-import" aria-busy={busy || closing}>
    <p>{owner.source.target.connectionId} / {owner.source.target.database} / {owner.source.target.table}</p><UsageHelp><p>{text.inspectHint}</p><p>{text.mappingHint}</p><p>{draft.format === 'xml' ? draft.xmlOptions?.documentResult === undefined ? xmlImportZh.hint : xmlImportZh.documentHint : text.nullHint}</p><p>{text.triggerHint}</p></UsageHelp>{owner.source.readOnly && <p className="warning-text">{text.readonly}</p>}{(!valid || stale) && !draft.outcome?.fact.commitAcknowledged && <ErrorBox message={text.stale}/>}
    <div className="form-grid"><Field label={text.format}><select aria-label={text.format} value={draft.format} disabled={configurationDisabled} onChange={event => configure({ format: event.target.value as Draft['format'] })}><option value="csv">CSV</option><option value="json">JSON</option><option value="txt">{txtImportZh.format}</option><option value="xml">XML</option></select></Field><Field label={text.encoding}><select aria-label={text.encoding} value={draft.encoding} disabled={configurationDisabled || draft.format === 'xml'} onChange={event => configure({ encoding: event.target.value as Draft['encoding'] })}><option value="utf8">UTF-8</option><option value="utf16le">UTF-16 LE</option><option value="gb18030">GB18030</option></select></Field>{draft.format === 'csv' && <><Field label={text.delimiter}><select aria-label={text.delimiter} value={draft.delimiter} disabled={configurationDisabled} onChange={event => configure({ delimiter: event.target.value as Draft['delimiter'] })}>{csvImportDelimiters.map(value => <option value={value} key={value}>{value === '\t' ? 'Tab' : value}</option>)}</select></Field><label><input type="checkbox" aria-label={text.header} checked={draft.header} disabled={configurationDisabled} onChange={event => configure({ header: event.target.checked })}/>{text.header}</label></>}{draft.format === 'txt' && <TxtImportFields options={draft.txtOptions} disabled={configurationDisabled} onChange={txtOptions => configure({ txtOptions })}/>}{draft.format === 'xml' && <SqliteXmlImportFields options={draft.xmlOptions} disabled={configurationDisabled} onChange={xmlOptions => configure({ xmlOptions })}/>}</div>
    <div className="sqlite-import-actions"><button type="button" disabled={configurationDisabled} onClick={choose}>{draft.file ? text.chooseAgain : text.choose}</button><span aria-label={text.source}>{draft.file?.name ?? text.noFile}</span><button type="button" disabled={disabled || !draft.file} onClick={inspect}>{text.inspect}</button></div>
    {inspection && <><p>{draft.format === 'xml' && draft.xmlOptions?.documentResult !== undefined ? xmlImportZh.documentRecords(inspection.records) : text.records(inspection.records)} · {inspection.strict ? text.strict : ''}</p><p className="muted small">{text.sourceHash}：{inspection.source.sha256}</p><details><summary>{text.targetColumns}</summary><ul>{inspection.columns.map(column => <li key={column.name}>{column.name} · {column.declaredType} · {text.affinity} {column.affinity} · {column.nullable ? text.nullable : text.notNull} · {column.hasDefault ? text.hasDefault : text.noDefault}{column.generated ? ' · ' + text.generated : ''}</li>)}</ul></details>
      <section aria-label={text.mapping}><h3>{text.mapping}</h3><button type="button" disabled={disabled || inspectionExpired || draft.mapping.length >= sqliteTableImportLimits.mapping} onClick={addMapping}>{text.addMapping}</button>{draft.mapping.map((row, index) => <div className="sqlite-import-mapping" key={row.id}><select aria-label={text.sourceColumn(index + 1)} value={row.source === null ? '' : 's' + inspection.sourceColumns.indexOf(row.source)} disabled={disabled || inspectionExpired} onChange={event => sourceAt(row, event.target.value)}><option value="">{text.noSource}</option>{inspection.sourceColumns.map((name, at) => <option key={at} value={'s' + at}>{name || text.emptySource}</option>)}</select><select aria-label={text.target(row.source ?? text.noSource)} value={row.target} disabled={disabled || inspectionExpired || row.source === null} onChange={event => mappingAt(row, { target: event.target.value })}><option value="">{text.exclude}</option>{inspection.columns.map(column => <option key={column.name} value={column.name} disabled={column.generated}>{column.name}{column.generated ? ' · ' + text.generated : ''}</option>)}</select><select aria-label={text.kind(row.source ?? text.noSource)} value={row.kind} disabled={disabled || inspectionExpired || !row.target} onChange={event => mappingAt(row, { kind: event.target.value as Mapping['kind'] })}>{Object.entries(text.kinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select><button type="button" aria-label={text.removeMapping(index + 1)} disabled={disabled || inspectionExpired} onClick={() => removeMapping(row)}>×</button></div>)}</section>
      <details><summary>{text.sample}</summary>{inspection.sampleOmitted && <p>{text.sampleLimit}</p>}<div className="sqlite-import-scroll"><table aria-label={text.sample}><thead><tr>{inspection.sourceColumns.map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{inspection.sample.map((row, index) => <tr key={index}>{inspection.sourceColumns.map(name => <td key={name}>{!Object.hasOwn(row, name) ? draft.format === 'xml' ? text.null : text.missing : row[name] === null ? text.null : row[name] === '' ? text.empty : typeof row[name] === 'object' ? JSON.stringify(row[name]) : String(row[name])}</td>)}</tr>)}</tbody></table></div></details>
    </>}
    {draft.preview && <section aria-label={text.report}><h3>{text.report}</h3><p>{text.reportSummary(draft.preview.report.checkedRecords, draft.preview.records, draft.preview.report.invalidRecords, draft.preview.report.issueCount)}</p>{draft.preview.report.truncated && <p className="warning-text">{text.reportTruncated(draft.preview.report.issues.length, draft.preview.report.issueCount)}</p>}{!draft.preview.report.complete && <p className="warning-text">{text.reportPartial}</p>}<div className="sqlite-import-scroll"><table><thead><tr><th>{text.reportRow}</th><th>{text.reportColumn}</th><th>{text.reportReason}</th></tr></thead><tbody>{draft.preview.report.issues.map((issue, index) => <tr key={index}><td>{issue.record ?? ''}</td><td>{[issue.source, issue.target].filter(Boolean).join(' → ')}</td><td>{issue.code} · {issue.message}</td></tr>)}</tbody></table></div>{draft.preview.warnings.map((warning, index) => <p key={index} className="warning-text">{warning}</p>)}{selected && <><p>{text.previewHint}</p><pre aria-label={text.previewTitle}>{selected.sql}</pre><Field label={text.confirmationHint(selected.confirmation)}><input aria-label={text.confirmation} value={draft.confirmation} disabled={disabled || previewExpired} onChange={event => { if (editable() && draft.preview === selected) replace({ ...draft, confirmation: event.target.value }); }}/></Field></>}</section>}
    {draft.outcome && <details aria-label={text.factTitle}><summary>{text.phases[draft.outcome.fact.phase]}</summary><dl><dt>{text.factOperation}</dt><dd>{draft.outcome.operationId}</dd><dt>{text.factTarget}</dt><dd>{draft.outcome.target.connectionId} / {draft.outcome.target.database} / {draft.outcome.target.table}</dd><dt>{text.factRequested}</dt><dd>{draft.outcome.fact.requestedRows}</dd><dt>{text.factApplied}</dt><dd>{draft.outcome.fact.appliedRows}</dd></dl></details>}
    {draft.outcome?.failure && <table aria-label={text.failure}><thead><tr><th>{text.reportRow}</th><th>{text.reportColumn}</th><th>{text.reportReason}</th></tr></thead><tbody><tr><td>{draft.outcome.failure.record ?? ''}</td><td>{[draft.outcome.failure.source, draft.outcome.failure.target].filter(Boolean).join(' → ')}</td><td>{draft.outcome.failure.code} · {draft.outcome.failure.message}</td></tr></tbody></table>}
    {(previewExpired || !selected && inspectionExpired) && <ErrorBox message={text.expired}/>} {selected && !previewExpired && inspectionExpired && <p className="info-strip">{text.inspectionExpiredPreviewValid}</p>}<ErrorBox message={error}/>{message && <p role="status">{message}</p>}{progress && <p role="status">{progress.message}{progress.rows === undefined ? '' : ' · ' + progress.rows}<progress max={100} value={progress.progress}/></p>}{busy && <Spinner text={text.working}/>} {discard && <p className="warning-text">{text.discard}</p>}
  </div><footer className="modal-footer">{discard ? <><button type="button" disabled={closing} onClick={() => { if (localCurrent()) setDiscard(false); }}>{text.keep}</button><button type="button" disabled={closing} onClick={() => close(true)}>{text.discardClose}</button></> : <><button type="button" disabled={closing} onClick={() => close()}>{text.close}</button><span className="grow"/>{busy && renderedOperation?.id && <button type="button" disabled={renderedOperation.commitBoundary || renderedOperation.resultReceived || renderedOperation.fact?.commitAcknowledged || renderedOperation.fact?.rollbackAcknowledged} title={renderedOperation.fact?.commitAcknowledged ? text.committed(renderedOperation.fact.appliedRows) : renderedOperation.fact?.rollbackAcknowledged ? sqliteImportFactMessage(renderedOperation.fact) : renderedOperation.commitBoundary ? text.commitBoundary : undefined} onClick={() => { if (localCurrent() && operation.current === renderedOperation) stop(renderedOperation); }}>{text.stop}</button>}<button type="button" disabled={disabled || !inspection || inspectionExpired} onClick={preview}>{text.preview}</button><button type="button" className="primary" disabled={disabled || !selected || previewExpired || owner.source.readOnly || inspection?.readOnly || draft.confirmation !== selected.confirmation || consumed.current.has(selected.previewId)} onClick={apply}>{text.apply}</button></>}</footer></Modal>;
}
