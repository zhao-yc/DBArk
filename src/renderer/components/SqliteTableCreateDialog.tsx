import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sqliteTableCreateDesignSchema, sqliteTableCreateOutcomeSchema, type SqliteTableCreateDesign, type SqliteTableCreatePreviewInput, type SqliteTableCreatePreviewOutput, type SqliteTableCreateApplyInput, type SqliteTableCreateOutcome } from '../../shared/sqliteTableCreate';
import { acquireWorkspaceBusy, useWorkspace, type WorkspaceBusyLease } from '../store';
import { errorMessage, invoke, uid } from '../lib';
import { sqliteTableCreateZh as text } from '../locales/sqliteTableCreate.zh-CN';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';
import '../sqliteTableCreate.css';

export interface SqliteTableCreateServices {
  preview(input: SqliteTableCreatePreviewInput): Promise<SqliteTableCreatePreviewOutput>;
  apply(input: SqliteTableCreateApplyInput): Promise<SqliteTableCreateOutcome>;
  release(input: { previewId: string }): Promise<void>;
  cancel(taskId: string): Promise<unknown>;
}
export const sqliteTableCreateServices: SqliteTableCreateServices = {
  preview: input => invoke('sqlite.tableCreate.preview', input), apply: input => invoke('sqlite.tableCreate.apply', input),
  release: input => invoke('sqlite.tableCreate.release', input), cancel: taskId => invoke('query.cancel', { taskId }),
};
interface Props {
  connectionId: string; database: string; initialDesign?: SqliteTableCreateDesign; unsupportedSeed?: boolean; invalidated?: boolean; isParentCurrent?(): boolean;
  onClose(): void; onCreated?(result: SqliteTableCreateOutcome, version: number): void; onDirtyChange?(dirty: boolean): void;
  services?: SqliteTableCreateServices;
}
type Operation = { kind: 'preview' | 'apply'; taskId: string; lifetime: object; draft: SqliteTableCreateDesign; lease?: WorkspaceBusyLease; acquiring: boolean; sent: boolean; cancelled: boolean; cancel?: Promise<void>; promise?: Promise<void> };
type Column = SqliteTableCreateDesign['columns'][number];
const emptyDesign = (): SqliteTableCreateDesign => ({ name: '', columns: [{ name: 'id', declaredType: 'INTEGER', nullable: false, default: { kind: 'none' } }], primaryKey: ['id'], autoIncrement: false, indexes: [], foreignKeys: [], strict: false, withoutRowid: false });
/** 只重排准确原列表，不借新数组里的相同位置重绑旧行。 */
function moved<T>(items: T[], index: number, delta: -1 | 1): T[] { const next = [...items], to = index + delta; if (to >= 0 && to < next.length) [next[index], next[to]] = [next[to], next[index]]; return next; }

/** SQLite新表独立设计器：本地草稿→真实只读预览→单次明确提交，不使用MySQL元数据或SQL执行器。 */
export function SqliteTableCreateDialog({ connectionId, database, initialDesign, unsupportedSeed = false, invalidated = false, isParentCurrent, onClose, onCreated, onDirtyChange, services = sqliteTableCreateServices }: Props) {
  const profile = useWorkspace(state => state.connections.find(value => value.id === connectionId)), version = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const fixed = useRef({ connectionId, database, profile, version, initialDesign, unsupportedSeed, parent: isParentCurrent, services, onClose, onCreated, onDirtyChange, busyKey: 'sqlite-table-create:' + uid() }).current;
  const closeSourceRef = useRef({ connectionId, database, profile, version, initialDesign, isParentCurrent, unsupportedSeed, invalidated });
  if (closeSourceRef.current.connectionId !== connectionId || closeSourceRef.current.database !== database || closeSourceRef.current.profile !== profile || closeSourceRef.current.version !== version || closeSourceRef.current.initialDesign !== initialDesign || closeSourceRef.current.isParentCurrent !== isParentCurrent || closeSourceRef.current.unsupportedSeed !== unsupportedSeed || closeSourceRef.current.invalidated !== invalidated) closeSourceRef.current = { connectionId, database, profile, version, initialDesign, isParentCurrent, unsupportedSeed, invalidated };
  const closeSource = closeSourceRef.current, sourceEpoch = useRef(0), observed = useRef({ profile, version });
  // 正式SQLite草案只接受共享设计合同；解析会复制数据，不把父级可变对象作为编辑模型。
  const seed = useRef(initialDesign === undefined ? undefined : sqliteTableCreateDesignSchema.safeParse(initialDesign)).current;
  const [design, setDesign] = useState(() => seed?.success ? seed.data : emptyDesign()), live = useRef(design); live.current = design;
  const initial = useRef(JSON.stringify(design)).current;
  const [preview, setPreview] = useState<SqliteTableCreatePreviewOutput>(), accepted = useRef<SqliteTableCreatePreviewOutput | undefined>(undefined);
  const [confirmation, setConfirmation] = useState(''), confirmationRef = useRef(confirmation); confirmationRef.current = confirmation;
  const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), closingRef = useRef(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [complete, setComplete] = useState(false), [unknown, setUnknown] = useState(false), [, tick] = useState(0);
  const completed = useRef(false), locked = useRef(false), notified = useRef(false), invalid = useRef(false), consumed = useRef(new Set<string>());
  const lifetime = useRef<object | null>(null), operation = useRef<Operation | undefined>(undefined), previews = useRef(new Set<string>()), releasing = useRef(new Map<string, Promise<void>>());
  const renderTicket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; }; });
  if (fixed.connectionId !== connectionId || fixed.database !== database || fixed.profile !== profile || fixed.version !== version || fixed.initialDesign !== initialDesign || fixed.parent !== isParentCurrent || fixed.unsupportedSeed !== unsupportedSeed || fixed.services !== services || invalidated || seed && !seed.success) invalid.current = true;

  /** 固定原连接对象及修订，父租约首次失效后永久撤权；自己的modal不视为外来modal。 */
  function sourceCurrent(): boolean {
    const now = useWorkspace.getState();
    if (fixed.database !== 'main' || !fixed.profile || fixed.profile.dialect !== 'sqlite' || fixed.unsupportedSeed || now.connections.find(value => value.id === fixed.connectionId) !== fixed.profile || (now.connectionVersions[fixed.connectionId] ?? 0) !== fixed.version) invalid.current = true;
    if (!invalid.current && fixed.parent) try { if (fixed.parent() !== true) invalid.current = true; } catch { invalid.current = true; }
    const op = operation.current; if (op?.lease && !op.acquiring && !op.lease.owns()) invalid.current = true;
    return lifetime.current !== null && !invalid.current;
  }
  function localCurrent(): boolean { return lifetime.current !== null && committed.current === renderTicket && live.current === design; }
  function editable(): boolean { return localCurrent() && sourceCurrent() && !operation.current && !closingRef.current && !locked.current && !completed.current; }
  function report(reason: unknown): void { const value = errorMessage(reason); if (lifetime.current) setError(value); else useWorkspace.getState().notify(value, true); }
  /** 每个能力保留到真实release成功；并发释放共用Promise，失败不丢责任。 */
  async function releaseOne(id: string): Promise<void> {
    let promise = releasing.current.get(id);
    if (!promise) { promise = Promise.resolve().then(() => fixed.services.release({ previewId: id })).then(() => { previews.current.delete(id); }); releasing.current.set(id, promise); }
    try { await promise; } finally { if (releasing.current.get(id) === promise) releasing.current.delete(id); }
  }
  async function releaseAll(): Promise<void> { const errors: string[] = []; for (const id of [...previews.current]) try { await releaseOne(id); } catch (reason) { errors.push(errorMessage(reason)); } if (errors.length) throw Error(errors.join('\n')); }
  function revokePreview(): void { const previous = accepted.current; accepted.current = undefined; confirmationRef.current = ''; if (lifetime.current) { setPreview(undefined); setConfirmation(''); } if (previous) void releaseOne(previous.previewId).catch(report); }
  /** 本地编辑同步替换草稿身份，并释放旧SQL；旧DOM闭包不能改后继草稿。 */
  function change(next: SqliteTableCreateDesign): void { if (!editable()) return; live.current = next; setDesign(next); revokePreview(); setError(''); setMessage(''); }
  function columnAt(column: Column, patch: Partial<Column>): void {
    if (!editable() || !design.columns.includes(column)) return;
    const name = patch.name, previous = column.name;
    change({ ...design, columns: design.columns.map(value => value === column ? { ...value, ...patch } : value), ...(name !== undefined && name !== previous ? { primaryKey: design.primaryKey.map(value => value === previous ? name : value), indexes: design.indexes.map(index => ({ ...index, columns: index.columns.map(part => part.name === previous ? { ...part, name } : part) })), foreignKeys: design.foreignKeys.map(key => ({ ...key, columns: key.columns.map(value => value === previous ? name : value) })) } : {}) });
  }
  function rowActions(label: string, index: number, length: number, move: (delta: -1 | 1) => void, remove: () => void) {
    return <span className="sqlite-create-actions"><button type="button" aria-label={text.up(label)} disabled={!canEdit || index === 0} onClick={() => { if (editable()) move(-1); }}>↑</button><button type="button" aria-label={text.down(label)} disabled={!canEdit || index === length - 1} onClick={() => { if (editable()) move(1); }}>↓</button><button type="button" aria-label={text.remove(label)} disabled={!canEdit} onClick={() => { if (editable()) remove(); }}>×</button></span>;
  }
  /** 租约先同步占用，订阅接受准确自有占用；原Promise与取消ACK都结束才释放。 */
  function begin(kind: Operation['kind']): Operation | undefined {
    if (!editable()) return;
    const op: Operation = { kind, taskId: uid(), lifetime: lifetime.current!, draft: design, acquiring: true, sent: false, cancelled: false }; operation.current = op;
    try { op.lease = acquireWorkspaceBusy(fixed.busyKey); op.acquiring = false; if (!sourceCurrent() || !op.lease.owns()) throw Error(text.invalid); setBusy(true); setError(''); setMessage(''); return op; }
    catch (reason) { operation.current = undefined; op.lease?.release(); report(reason); }
  }
  const accepts = (op: Operation) => operation.current === op && lifetime.current === op.lifetime && live.current === op.draft && sourceCurrent() && !!op.lease?.owns();
  async function finish(op: Operation): Promise<void> {
    let pending: Promise<void> | undefined; do { pending = op.cancel; if (pending) await pending; } while (pending !== op.cancel);
    if (operation.current === op) operation.current = undefined; op.lease?.release();
    if (lifetime.current === op.lifetime) setBusy(false);
    if (!lifetime.current) void releaseAll().catch(report);
  }
  /** 仅取消准确已发送任务；控制响应不表示数据库已回滚或提交被撤销。 */
  function cancel(op = operation.current): void {
    if (!op || operation.current !== op || op.cancelled) return; op.cancelled = true;
    if (op.sent) op.cancel = Promise.resolve().then(() => fixed.services.cancel(op.taskId)).then(() => undefined).catch(report);
    if (lifetime.current) setMessage(text.cancelling);
  }
  /** 真实预览仅由明确按钮触发，完整草稿固定后每个await都核对原来源。 */
  function prepare(): void {
    if (!editable()) return;
    const parsed = sqliteTableCreateDesignSchema.safeParse(design); if (!parsed.success) { setError(text.designInvalid); return; }
    revokePreview(); const op = begin('preview'); if (!op) return;
    op.promise = (async () => {
      try {
        await releaseAll(); if (!accepts(op) || op.cancelled) return;
        op.sent = true;
        const value = await fixed.services.preview({ connectionId: fixed.connectionId, database: 'main', design: parsed.data, taskId: op.taskId }); previews.current.add(value.previewId);
        if (!accepts(op) || op.cancelled) { await releaseOne(value.previewId); return; }
        if (value.target.connectionId !== fixed.connectionId || value.target.database !== 'main' || value.target.table !== op.draft.name || value.confirmation !== 'main.' + op.draft.name || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now() || !value.sql.length) { await releaseOne(value.previewId); throw Error(text.response); }
        accepted.current = value; setPreview(value); confirmationRef.current = ''; setConfirmation('');
      } catch (reason) { if (lifetime.current === op.lifetime) report(reason); }
      finally { await finish(op); }
    })();
  }
  /** 明确确认消费一次预览；真实COMMIT事实独立于取消、核验和界面刷新。 */
  function apply(): void {
    const chosen = preview;
    if (!editable() || !chosen || accepted.current !== chosen || fixed.profile?.dialect !== 'sqlite' || fixed.profile.sqlite.readOnly || confirmationRef.current !== chosen.confirmation || confirmation !== chosen.confirmation || consumed.current.has(chosen.previewId)) return;
    if (Date.parse(chosen.expiresAt) <= Date.now()) { revokePreview(); setError(text.expired); return; }
    const op = begin('apply'); if (!op) return;
    consumed.current.add(chosen.previewId); accepted.current = undefined;
    op.promise = (async () => {
      try {
        if (!accepts(op) || op.cancelled) return;
        op.sent = true;
        const result = sqliteTableCreateOutcomeSchema.parse(await fixed.services.apply({ previewId: chosen.previewId, taskId: op.taskId, confirmation: chosen.confirmation }));
        if (result.target.connectionId !== fixed.connectionId || result.target.database !== 'main' || result.target.table !== op.draft.name || !['committed', 'rolled-back', 'not-sent', 'unknown'].includes(result.outcome) || result.outcome === 'committed' && !result.fact.commitAcknowledged) throw Error(text.response);
        if (result.outcome === 'committed') {
          completed.current = true; locked.current = true;
          if (lifetime.current === op.lifetime) { setComplete(true); setMessage(text.committed + ' ' + result.message); if (result.cleanupWarning || !result.definitionVerified) setError(result.message); }
          if (!notified.current) { notified.current = true; if (accepts(op)) { try { fixed.onCreated?.(result, fixed.version); } catch (reason) { report(reason); } } else useWorkspace.getState().notify(text.committedStale, true); }
        } else {
          if (result.outcome === 'unknown' || result.fact.commitAcknowledged) { locked.current = true; if (lifetime.current === op.lifetime) setUnknown(true); }
          if (lifetime.current === op.lifetime) setMessage(result.outcome === 'unknown' ? text.unknown : result.message);
        }
      } catch (reason) { if (op.sent) { locked.current = true; if (lifetime.current === op.lifetime) { setUnknown(true); setMessage(text.unknown); } } if (lifetime.current === op.lifetime) report(reason); }
      finally {
        if (lifetime.current === op.lifetime) { setPreview(undefined); confirmationRef.current = ''; setConfirmation(''); }
        await releaseOne(chosen.previewId).catch(report); await finish(op);
      }
    })();
  }
  const renderedOperation = operation.current;
  /** 关闭草稿需要明确放弃；运行中不关闭，释放失败仍保留原窗口及能力责任。 */
  function close(discard = false): void {
    if (!localCurrent() || operation.current || closingRef.current) return;
    if (!discard && !completed.current && (JSON.stringify(live.current) !== initial || preview || locked.current)) { setClosing(true); return; }
    const token = lifetime.current, epoch = sourceEpoch.current, draft = live.current;
    closingRef.current = true; setBusy(true);
    void releaseAll().then(() => { if (lifetime.current === token && closeSourceRef.current === closeSource && sourceEpoch.current === epoch && live.current === draft) { fixed.onDirtyChange?.(false); fixed.onClose(); } }).catch(report).finally(() => { closingRef.current = false; if (lifetime.current === token) setBusy(false); });
  }
  useEffect(() => {
    const token = {}; lifetime.current = token;
    const observe = () => {
      const now = useWorkspace.getState(), profile = now.connections.find(value => value.id === fixed.connectionId), version = now.connectionVersions[fixed.connectionId] ?? 0;
      if (observed.current.profile !== profile || observed.current.version !== version) { observed.current = { profile, version }; sourceEpoch.current++; }
      if (!sourceCurrent()) { revokePreview(); cancel(); tick(value => value + 1); }
    };
    const unsubscribe = useWorkspace.subscribe(observe); observe(); tick(value => value + 1);
    return () => { unsubscribe(); if (lifetime.current === token) lifetime.current = null; const op = operation.current; if (op?.lifetime === token) cancel(op); else void releaseAll().catch(report); fixed.onDirtyChange?.(false); };
  }, []);
  useEffect(() => { if (!sourceCurrent()) { if (accepted.current) revokePreview(); cancel(); } });
  useEffect(() => { fixed.onDirtyChange?.(!complete && (busy || !!preview || unknown || JSON.stringify(design) !== initial)); }, [design, preview, busy, complete, unknown]);
  useEffect(() => { if (!preview) return; const timer = setTimeout(() => tick(value => value + 1), Math.max(1, Date.parse(preview.expiresAt) - Date.now() + 1)); return () => clearTimeout(timer); }, [preview]);
  const valid = sourceCurrent(), canEdit = !busy && !closing && valid && !complete && !unknown && !locked.current;
  const expired = !!preview && Date.parse(preview.expiresAt) <= Date.now(), readOnly = fixed.profile?.dialect === 'sqlite' && fixed.profile.sqlite.readOnly;
  const directions = (['asc', 'desc'] as const).map(value => <option key={value} value={value}>{value === 'asc' ? text.ascending : text.descending}</option>);
  const columnOptions = design.columns.map((column, index) => <option key={index} value={column.name}>{column.name}</option>);
  return <Modal title={text.title} wide onClose={() => close()}><div className="modal-content sqlite-table-create" aria-busy={busy}>
    <p>{fixed.profile?.name ?? fixed.connectionId} / {fixed.database}</p><UsageHelp><p>{text.affinity}</p><p>{text.defaultHint}</p></UsageHelp>
    {readOnly && <p className="warning-text">{text.readonly}</p>}{(!valid || unsupportedSeed) && <ErrorBox message={unsupportedSeed ? text.unsupportedSeed : text.invalid}/>}
    <Field label={text.name}><input aria-label={text.name} value={design.name} disabled={!canEdit} onChange={event => change({ ...design, name: event.target.value })}/></Field>
    <section aria-label={text.columns}><h3>{text.columns}</h3><div className="sqlite-create-fields">{design.columns.map((column, index) => <fieldset className="sqlite-create-column" key={index}><legend>{text.columns} {index + 1}</legend>
      <Field label={text.columnName(index + 1)}><input aria-label={text.columnName(index + 1)} value={column.name} disabled={!canEdit} onChange={event => columnAt(column, { name: event.target.value })}/></Field>
      <Field label={text.declaredType(index + 1)}><input aria-label={text.declaredType(index + 1)} value={column.declaredType} disabled={!canEdit} onChange={event => columnAt(column, { declaredType: event.target.value })}/></Field>
      <label><input type="checkbox" aria-label={text.nullable(index + 1)} checked={column.nullable} disabled={!canEdit} onChange={event => columnAt(column, { nullable: event.target.checked })}/>{text.nullable(index + 1)}</label>
      <label><input type="checkbox" aria-label={text.primaryColumn(index + 1)} checked={design.primaryKey.includes(column.name)} disabled={!canEdit} onChange={event => change({ ...design, primaryKey: event.target.checked ? [...design.primaryKey, column.name] : design.primaryKey.filter(name => name !== column.name) })}/>{text.primaryColumn(index + 1)}</label>
      <Field label={text.defaultKind(index + 1)}><select aria-label={text.defaultKind(index + 1)} value={column.default.kind} disabled={!canEdit} onChange={event => { const kind = event.target.value as Column['default']['kind']; columnAt(column, { default: ['text', 'integer', 'real', 'blob'].includes(kind) ? { kind: kind as 'text' | 'integer' | 'real' | 'blob', value: '' } : { kind: kind as 'none' | 'null' | 'current-date' | 'current-time' | 'current-timestamp' } }); }}>{Object.entries(text.defaultKinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></Field>
      <Field label={text.defaultValue(index + 1)}><input aria-label={text.defaultValue(index + 1)} value={'value' in column.default ? column.default.value : ''} disabled={!canEdit || !('value' in column.default)} onChange={event => { if ('value' in column.default) columnAt(column, { default: { ...column.default, value: event.target.value } }); }}/></Field>
      <Field label={text.collation(index + 1)}><select aria-label={text.collation(index + 1)} value={column.collation ?? ''} disabled={!canEdit} onChange={event => { const next = { ...column }; if (event.target.value) next.collation = event.target.value as NonNullable<Column['collation']>; else delete next.collation; columnAt(column, next); }}><option value="">{text.inheritCollation}</option>{['BINARY', 'NOCASE', 'RTRIM'].map(value => <option key={value}>{value}</option>)}</select></Field>
      {rowActions(text.columns + ' ' + (index + 1), index, design.columns.length, delta => change({ ...design, columns: moved(design.columns, index, delta) }), () => change({ ...design, columns: design.columns.filter(value => value !== column), primaryKey: design.primaryKey.filter(name => name !== column.name) }))}
    </fieldset>)}</div><button type="button" disabled={!canEdit} onClick={() => change({ ...design, columns: [...design.columns, { name: 'column_' + (design.columns.length + 1), declaredType: 'TEXT', nullable: true, default: { kind: 'none' } }] })}>{text.addColumn}</button></section>
    <section aria-label={text.primary}><h3>{text.primary}</h3>{design.primaryKey.map((name, index) => <div className="sqlite-create-primary" key={index}><span>{index + 1}. {name}</span>{rowActions(text.primary + ' ' + name, index, design.primaryKey.length, delta => change({ ...design, primaryKey: moved(design.primaryKey, index, delta) }), () => change({ ...design, primaryKey: design.primaryKey.filter((_value, at) => at !== index) }))}</div>)}
      <label><input type="checkbox" aria-label={text.autoIncrement} checked={design.autoIncrement} disabled={!canEdit} onChange={event => change({ ...design, autoIncrement: event.target.checked })}/>{text.autoIncrement}</label>
      <div className="sqlite-create-actions"><label><input type="checkbox" aria-label={text.strict} checked={design.strict} disabled={!canEdit} onChange={event => change({ ...design, strict: event.target.checked })}/>{text.strict}</label><label><input type="checkbox" aria-label={text.withoutRowid} checked={design.withoutRowid} disabled={!canEdit} onChange={event => change({ ...design, withoutRowid: event.target.checked })}/>{text.withoutRowid}</label></div>
    </section>
    <section aria-label={text.indexes}><h3>{text.indexes}</h3>{design.indexes.map((item, index) => <fieldset key={index}><Field label={text.indexName(index + 1)}><input aria-label={text.indexName(index + 1)} value={item.name} disabled={!canEdit} onChange={event => change({ ...design, indexes: design.indexes.map(value => value === item ? { ...item, name: event.target.value } : value) })}/></Field><label><input type="checkbox" aria-label={text.unique(index + 1)} checked={item.unique} disabled={!canEdit} onChange={event => change({ ...design, indexes: design.indexes.map(value => value === item ? { ...item, unique: event.target.checked } : value) })}/>{text.unique(index + 1)}</label>
      {item.columns.map((part, at) => <div className="sqlite-create-part" key={at}><select aria-label={text.indexColumn(index + 1, at + 1)} value={part.name} disabled={!canEdit} onChange={event => change({ ...design, indexes: design.indexes.map(value => value === item ? { ...item, columns: item.columns.map(value => value === part ? { ...part, name: event.target.value } : value) } : value) })}>{columnOptions}</select><select aria-label={text.indexOrder(index + 1, at + 1)} value={part.order} disabled={!canEdit} onChange={event => change({ ...design, indexes: design.indexes.map(value => value === item ? { ...item, columns: item.columns.map(value => value === part ? { ...part, order: event.target.value as 'asc' | 'desc' } : value) } : value) })}>{directions}</select>{rowActions(text.indexColumn(index + 1, at + 1), at, item.columns.length, delta => change({ ...design, indexes: design.indexes.map(value => value === item ? { ...item, columns: moved(item.columns, at, delta) } : value) }), () => change({ ...design, indexes: design.indexes.map(value => value === item ? { ...item, columns: item.columns.filter(value => value !== part) } : value) }))}</div>)}
      <button type="button" disabled={!canEdit} onClick={() => change({ ...design, indexes: design.indexes.map(value => value === item ? { ...item, columns: [...item.columns, { name: design.columns[0]?.name ?? '', order: 'asc' }] } : value) })}>{text.addIndexColumn(index + 1)}</button>{rowActions(text.indexes + ' ' + (index + 1), index, design.indexes.length, delta => change({ ...design, indexes: moved(design.indexes, index, delta) }), () => change({ ...design, indexes: design.indexes.filter(value => value !== item) }))}
    </fieldset>)}<button type="button" disabled={!canEdit} onClick={() => change({ ...design, indexes: [...design.indexes, { name: 'idx_' + (design.indexes.length + 1), unique: false, columns: [{ name: design.columns[0]?.name ?? '', order: 'asc' }] }] })}>{text.addIndex}</button></section>
    <section aria-label={text.foreignKeys}><h3>{text.foreignKeys}</h3>{design.foreignKeys.map((item, index) => <fieldset key={index}>
      <Field label={text.foreignKeyName(index + 1)}><input aria-label={text.foreignKeyName(index + 1)} value={item.name} disabled={!canEdit} onChange={event => change({ ...design, foreignKeys: design.foreignKeys.map(value => value === item ? { ...item, name: event.target.value } : value) })}/></Field><Field label={text.referenceTable(index + 1)}><input aria-label={text.referenceTable(index + 1)} value={item.referencedTable} disabled={!canEdit} onChange={event => change({ ...design, foreignKeys: design.foreignKeys.map(value => value === item ? { ...item, referencedTable: event.target.value } : value) })}/></Field>
      {item.columns.map((name, at) => <div className="sqlite-create-part" key={at}><select aria-label={text.foreignColumn(index + 1, at + 1)} value={name} disabled={!canEdit} onChange={event => change({ ...design, foreignKeys: design.foreignKeys.map(value => value === item ? { ...item, columns: item.columns.map((value, position) => position === at ? event.target.value : value) } : value) })}>{columnOptions}</select><input aria-label={text.referenceColumn(index + 1, at + 1)} value={item.referencedColumns[at] ?? ''} disabled={!canEdit} onChange={event => change({ ...design, foreignKeys: design.foreignKeys.map(value => value === item ? { ...item, referencedColumns: item.referencedColumns.map((value, position) => position === at ? event.target.value : value) } : value) })}/>{rowActions(text.foreignColumn(index + 1, at + 1), at, item.columns.length, delta => change({ ...design, foreignKeys: design.foreignKeys.map(value => value === item ? { ...item, columns: moved(item.columns, at, delta), referencedColumns: moved(item.referencedColumns, at, delta) } : value) }), () => change({ ...design, foreignKeys: design.foreignKeys.map(value => value === item ? { ...item, columns: item.columns.filter((_value, position) => position !== at), referencedColumns: item.referencedColumns.filter((_value, position) => position !== at) } : value) }))}</div>)}
      <button type="button" disabled={!canEdit} onClick={() => change({ ...design, foreignKeys: design.foreignKeys.map(value => value === item ? { ...item, columns: [...item.columns, design.columns[0]?.name ?? ''], referencedColumns: [...item.referencedColumns, ''] } : value) })}>{text.addForeignColumn(index + 1)}</button>
      {(['onDelete', 'onUpdate'] as const).map(action => <Field key={action} label={text[action](index + 1)}><select aria-label={text[action](index + 1)} value={item[action]} disabled={!canEdit} onChange={event => change({ ...design, foreignKeys: design.foreignKeys.map(value => value === item ? { ...item, [action]: event.target.value as SqliteTableCreateDesign['foreignKeys'][number]['onDelete'] } : value) })}>{['NO ACTION', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'CASCADE'].map(value => <option key={value}>{value}</option>)}</select></Field>)}
      <label><input type="checkbox" aria-label={text.deferred(index + 1)} checked={item.deferred} disabled={!canEdit} onChange={event => change({ ...design, foreignKeys: design.foreignKeys.map(value => value === item ? { ...item, deferred: event.target.checked } : value) })}/>{text.deferred(index + 1)}</label>{rowActions(text.foreignKeys + ' ' + (index + 1), index, design.foreignKeys.length, delta => change({ ...design, foreignKeys: moved(design.foreignKeys, index, delta) }), () => change({ ...design, foreignKeys: design.foreignKeys.filter(value => value !== item) }))}
    </fieldset>)}<button type="button" disabled={!canEdit} onClick={() => change({ ...design, foreignKeys: [...design.foreignKeys, { name: 'fk_' + (design.foreignKeys.length + 1), columns: [design.columns[0]?.name ?? ''], referencedTable: '', referencedColumns: [''], onDelete: 'NO ACTION', onUpdate: 'NO ACTION', deferred: false }] })}>{text.addForeignKey}</button></section>
    {preview && <section aria-label={text.sql}><h3>{preview.target.database}.{preview.target.table}</h3><p>{text.previewHint}</p><pre className="sqlite-create-sql" tabIndex={0} aria-label={text.sql}>{preview.sql.join('\n\n')}</pre>{preview.warnings.map((warning, index) => <p className="warning-text" key={index}>{warning}</p>)}<Field label={text.confirmHint(preview.confirmation)}><input aria-label={text.confirmation} value={confirmation} disabled={!canEdit || expired} onChange={event => { if (editable() && accepted.current === preview) { confirmationRef.current = event.target.value; setConfirmation(event.target.value); } }}/></Field>{expired && <ErrorBox message={text.expired}/>}</section>}
    {busy && <Spinner text={text.working}/>}<ErrorBox message={error}/>{message && <p role="status" className={complete ? 'success-box' : 'warning-text'}>{message}</p>}{closing && <p className="warning-text">{text.discard}</p>}
  </div><footer className="modal-footer">{closing ? <><button type="button" disabled={busy} onClick={() => { if (localCurrent() && !operation.current) setClosing(false); }}>{text.keep}</button><button type="button" disabled={busy} onClick={() => close(true)}>{text.discardClose}</button></> : <><button type="button" disabled={busy} onClick={() => close()}>{text.close}</button><span className="grow"/>{busy && renderedOperation && <button type="button" onClick={() => { if (localCurrent() && operation.current === renderedOperation) cancel(renderedOperation); }}>{text.stop}</button>}<button type="button" disabled={!canEdit} onClick={prepare}>{text.preview}</button><button type="button" className="primary" disabled={!canEdit || !preview || expired || readOnly || confirmation !== preview.confirmation || consumed.current.has(preview.previewId)} onClick={apply}>{text.apply}</button></>}</footer></Modal>;
}
