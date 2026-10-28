import { NewTableColumnOrder } from '../newTableColumnOrder';
import { NewTableChecksEditor } from './NewTableChecksEditor';
import { withNewTableChecks } from '../newTableChecksUi';
import { assertTableCreateChecks, tableCreateHasChecks, type TableCreateCheck } from '../../shared/tableCreateChecks';
import { tableCreateChecksZh as checksText } from '../locales/tableCreateChecks.zh-CN';
import { NewTableOnUpdateField } from './NewTableOnUpdateField';
import { NewTableGeneratedField } from './NewTableGeneratedField';
import { NewTableGeneratedDrafts, type NewTableColumnMode } from '../newTableGeneratedDrafts';
import { tableCreateGeneratedZh as generatedText } from '../locales/tableCreateGenerated.zh-CN';
import { assertTableCreateGenerated } from '../../shared/tableCreateGenerated';
import { assertTableCreateColumnEncodings, tableCreateHasColumnEncoding, tableCreateColumnEncodingAllowed } from '../../shared/tableCreateColumnEncoding';
import { NewTableColumnEncodingField } from './NewTableColumnEncodingField';
import { NewTableEncodingDirectoryReader, type NewTableEncodingDirectory } from '../newTableEncodingCatalog';
import { tableCreateServices } from '../tableCreateServices';
import { tableCreateColumnEncodingZh as columnEncodingText } from '../locales/tableCreateColumnEncoding.zh-CN';
import { tableCreateOnUpdateZh } from '../locales/tableCreateOnUpdate.zh-CN';
import { tableCreateColumnOrderZh as columnOrderText } from '../locales/tableCreateColumnOrder.zh-CN';
import { NewTableIndexEditor } from './NewTableIndexEditor';
import { tableCreateDraftSchema, type TableCreateIndex, type TableCreateDraft } from '../../shared/tableCreate';
import {databaseSearchZh} from '../locales/databaseSearch.zh-CN';
import { zh, formatText } from '../locales/zh-CN';
import { useEffect, useRef, useState } from 'react';
import type { TableCreateApplyOutput } from '../../shared/tableCreate';
import { TableCreateConfirmation } from './TableCreateConfirmation';
import { tableCreateZh } from '../locales/tableCreate.zh-CN';
import { Plus, Trash2, ArrowRight } from 'lucide-react';
import type { DatabaseObject, ForeignKeyInfo, IndexInfo, SqlPreview, TableDesign } from '../../shared/contracts';
import { errorMessage, identifier, invoke, kindLabels, qualifiedName, uid } from '../lib';
import { useWorkspace } from '../store';
import { SqlEditor } from './SqlEditor';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import type { DefinitionSearchOpen } from '../../shared/definitionNavigation';
import { DatabaseCreateDialog } from './DatabaseCreateDialog';
import { DefinitionViewer } from './DefinitionViewer';

/** 新字段仅提供可编辑默认值，不在用户确认前生成数据库对象。 */
const blankColumn = (): TableCreateDraft['columns'][number] => ({ name: '', type: 'varchar(255)', nullable: true, autoIncrement: false, comment: '' });
/** 保留正在输入的空段，防止输入逗号时受控表单立即把分隔符删除。 */
const splitColumns = (text: string) => text.split(',').map(item => item.trim());

type SchemaDraft = Omit<TableDesign, 'indexes' | 'columns'> & { columns: TableCreateDraft['columns']; indexes: TableCreateIndex[]; checks?: TableCreateCheck[] };
/** 已有表显式取回整字段模型，不能把新表前缀合同传给通用schema.preview。 */
function existingDesign(design: SchemaDraft): TableDesign { if (tableCreateHasChecks(design)) throw Error(checksText.existing); return { ...design, indexes: design.indexes.map(index => { if (!('columns' in index)) throw Error('已有表不能使用新表专属键部分'); return index; }) }; }
interface SchemaDialogProps { connectionId: string; database: string; table?: string; onClose: () => void; onApplied: () => void; onCreated?(result: TableCreateApplyOutput, version: number): void; onDirtyChange?(dirty: boolean): void; }
interface SchemaOperationContext { lifetime: object | null; connectionId: string; database: string; table?: string; version: number; revision: number; }
interface SchemaPreviewContext { context: SchemaOperationContext; preview: SqlPreview; sql: string; }
/** 已有表按准确目标隔离组件；新建草稿保持原失效保护，不因连接变动无声丢弃。 */
export function SchemaDialog(props: SchemaDialogProps) { return <SchemaDialogContent key={props.table ? JSON.stringify([props.connectionId, props.database, props.table]) : 'new'} {...props}/>; }

/** 设计器维护字段、索引及外键草稿，必须先生成预览后才允许执行 DDL。 */
function SchemaDialogContent({ connectionId, database, table, onClose, onApplied, onCreated, onDirtyChange }: SchemaDialogProps) {
  const [design, setDesign] = useState<SchemaDraft>({ database, name: table ?? '', ...(table ? { originalName: table } : {}), engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: table ? [] : [{ ...blankColumn(), name: 'id', type: 'bigint unsigned', nullable: false, autoIncrement: true }], indexes: table ? [] : [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [] });
  const [section, setSection] = useState<'columns' | 'indexes' | 'foreignKeys' | 'checks'>('columns'); const sectionRef = useRef(section), checksViewRevision = useRef(0); sectionRef.current = section; const [busy, setBusy] = useState(!!table); const [error, setError] = useState(''); const [preview, setPreview] = useState<SqlPreview | null>(null); const [sql, setSql] = useState('');
  const [unsupported, setUnsupported] = useState(false); const [originalDdl, setOriginalDdl] = useState('');
  const [applyTaskId, setApplyTaskId] = useState('');
  const [confirming, setConfirming] = useState(false); const [createDraft, setCreateDraft] = useState<{ design: TableCreateDraft; context: SchemaOperationContext; columnEncodingCatalogDigest?: string } | null>(null);
  const [columnCatalog, setColumnCatalog] = useState<NewTableEncodingDirectory | undefined>(), [readingColumnCatalog, setReadingColumnCatalog] = useState(false), [, tickColumnCatalog] = useState(0);
  const columnDirectory = useRef<NewTableEncodingDirectoryReader | null>(null), columnEncodingDigests = useRef(new WeakMap<SchemaDraft['columns'][number], string>()), columnCatalogClosing = useRef(false);
  const previewRevision = useRef(0);
  const liveDesign = useRef(design); liveDesign.current = design;
  const columnOrder = useRef(new NewTableColumnOrder<SchemaDraft['columns'][number]>()), createLocked = useRef(false);
  const generatedDrafts = useRef(new NewTableGeneratedDrafts());
  const lifetime = useRef<object | null>(null), previewContext = useRef<SchemaPreviewContext | null>(null);
  const metadataReady = useRef(!table);
  const sourceVersion = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const closeTargetKey = useRef(''); closeTargetKey.current = JSON.stringify([connectionId, database, table, sourceVersion]);
  const origin = useRef({ connectionId, database, table, version: sourceVersion, draft: JSON.stringify(design), invalid: false });
  if (origin.current.connectionId !== connectionId || origin.current.database !== database || origin.current.table !== table || origin.current.version !== sourceVersion) origin.current.invalid = true;
  /** 每次effect挂载独立身份，StrictMode清理后的旧Promise不能借新挂载复活。 */
  useEffect(() => {
    const token = {}; lifetime.current = token;
    const directory = new NewTableEncodingDirectoryReader(tableCreateServices); columnDirectory.current = directory;
    // 直接观察每次配置修订，React合批的B→A也永久失效；等待真正请求终态后才解除busy。
    const observe = (state: ReturnType<typeof useWorkspace.getState>) => { if ((state.connectionVersions[origin.current.connectionId] ?? 0) !== origin.current.version) { origin.current.invalid = true; metadataReady.current = false; previewRevision.current++; previewContext.current = null; setPreview(null); setSql(''); setError(tableCreateZh.mismatch); } };
    observe(useWorkspace.getState()); const unsubscribe = useWorkspace.subscribe(observe);
    return () => { unsubscribe(); if (lifetime.current === token) { lifetime.current = null; previewContext.current = null; } void directory.dispose().catch(reason => useWorkspace.getState().notify(errorMessage(reason), true)); };
  }, []);
  /** 请求固定目标、连接修订、挂载和草稿代次；提交不得改取当前props的连接。 */
  function capture(): SchemaOperationContext { const source = origin.current; return { lifetime: lifetime.current, connectionId: source.connectionId, database: source.database, table: source.table, version: source.version, revision: previewRevision.current }; }
  function sameLifetime(context: SchemaOperationContext): boolean { return context.lifetime !== null && lifetime.current === context.lifetime; }
  function current(context: SchemaOperationContext): boolean { const source = origin.current; return sameLifetime(context) && !source.invalid && context.connectionId === source.connectionId && context.database === source.database && context.table === source.table && context.version === source.version && (useWorkspace.getState().connectionVersions[context.connectionId] ?? 0) === context.version && context.revision === previewRevision.current; }
  useEffect(() => { if (!table) onDirtyChange?.(confirming || JSON.stringify(design) !== origin.current.draft); }, [design, confirming, table]);
  useEffect(() => { if (!columnCatalog) return; const timer = window.setTimeout(() => tickColumnCatalog(value => value + 1), Math.max(1, Date.parse(columnCatalog.expiresAt) - Date.now() + 1)); return () => window.clearTimeout(timer); }, [columnCatalog]);
  useEffect(() => {
    if (!table) return;
    const context = capture();
    setBusy(true);
    void (async () => {
      if (!current(context)) return;
      await invoke('connections.open', { id: context.connectionId }); if (!current(context)) return;
      const info = await invoke('metadata.table', { connectionId: context.connectionId, database: context.database, table: context.table! }); if (!current(context)) return;
      if (info.database !== context.database || info.name !== context.table) throw Error(tableCreateZh.mismatch);
      setOriginalDdl(info.ddl);
      setUnsupported(info.columns.some(column => column.generated));
      setDesign({ database: context.database, name: context.table!, originalName: context.table, engine: info.engine || 'InnoDB', charset: info.charset || 'utf8mb4', comment: info.comment || '', columns: info.columns.map(column => ({ name: column.name, originalName: column.name, type: column.type, nullable: column.nullable, defaultValue: column.defaultValue === null && !column.nullable ? undefined : column.defaultValue, autoIncrement: column.extra.toLowerCase().includes('auto_increment'), comment: column.comment })), indexes: info.indexes, foreignKeys: info.foreignKeys });
      metadataReady.current = true;
    })().catch(reason => { if (current(context)) setError(errorMessage(reason)); }).finally(() => { if (sameLifetime(context)) setBusy(false); });
  }, [connectionId, database, table]);
  /** 结构草稿一旦变化，旧 SQL 预览立即失效，避免提交过时的语句。 */
  function update(patch: Partial<SchemaDraft>) { if (origin.current.invalid || table && tableCreateHasChecks(patch) || !table && (createLocked.current || columnDirectory.current?.busy || columnCatalogClosing.current)) return; previewRevision.current++; previewContext.current = null; if (table) setDesign(current => ({ ...current, ...patch })); else { const next = { ...liveDesign.current, ...patch }; liveDesign.current = tableCreateHasChecks(patch) ? withNewTableChecks(next, patch.checks) : next; setDesign(liveDesign.current); } setPreview(null); }
  /** 页签也有自己的代次，离开再返回CHECK不能复活旧列表闭包。 */
  function selectSection(next: typeof section): void { if (sectionRef.current !== next) checksViewRevision.current++; sectionRef.current = next; setSection(next); }
  /** 全部父来源/草稿/原列表与页面代次共同核对，不按当前数组位置重绑旧行。 */
  function checksCurrent(source: SchemaDraft, checks: TableCreateCheck[] | undefined, revision: number, viewRevision: number): boolean { return !table && sectionRef.current === 'checks' && checksViewRevision.current === viewRevision && liveDesign.current === source && liveDesign.current.checks === checks && columnsCurrent(source.columns, revision); }
  /** 清空最后一项真删可选键；字段/索引/外键引用完全沿原草稿保持。 */
  function checksAt(source: SchemaDraft, checks: TableCreateCheck[] | undefined, revision: number, viewRevision: number, next: TableCreateCheck[] | undefined): void { if (checksCurrent(source, checks, revision, viewRevision)) update({ checks: next }); }
  /** 返回草稿同步撤销SQL来源；旧事件回调也不能借尚未提交的React状态继续执行。 */
  function backToDraft() { previewRevision.current++; previewContext.current = null; setPreview(null); }
  /** 保留已有表SQL编辑；每次编辑替换凭据对象，等待建连中的旧提交也随之失效。 */
  function editSql(value: string) { const accepted = previewContext.current; if (busy || !accepted || !current(accepted.context)) return; previewContext.current = { ...accepted, sql: value }; setSql(value); }
  /** 新表行事件固定渲染列表及草稿代次；旧DOM回调不能用旧位置写入重排后的另一列。 */
  function columnsCurrent(columns: SchemaDraft['columns'], revision: number): boolean {
    return !busy && !createLocked.current && !columnDirectory.current?.busy && !columnCatalogClosing.current && !preview && current(capture()) && liveDesign.current.columns === columns && previewRevision.current === revision;
  }
  /** 只更新原列身份；已有表仍沿原草稿路径，不新增ALTER排序能力。 */
  function columnAt(column: SchemaDraft['columns'][number], columns: SchemaDraft['columns'], revision: number, patch: Partial<SchemaDraft['columns'][number]>) {
    if (!table && !columnsCurrent(columns, revision)) return;
    // 禁用控件的旧回调也不能把普通属性混入生成列；类型与表达式仍在预览前完整校验。
    if (!table && column.generated && Object.keys(patch).some(key => !['name', 'type', 'comment', 'generated'].includes(key))) return;
    const next = columnOrder.current.patch(columns, column, patch);
    if (next) { if (!table) { const changed = next[columns.indexOf(column)]; generatedDrafts.current.transfer(column, changed); transferColumnEncoding(column, changed); } update({ columns: next }); }
  }
  /** 编码来源绑定原列对象；普通编辑、重排和模式切换不能把另一列的目录意图移来。 */
  function transferColumnEncoding(previous: SchemaDraft['columns'][number], next: SchemaDraft['columns'][number]) { const digest = columnEncodingDigests.current.get(previous); if (digest && Object.hasOwn(next, 'collation')) columnEncodingDigests.current.set(next, digest); }
  /** 继承必须真删键；显式配对只取本次仍有效的真实目录，不接受迟到行事件。 */
  function columnEncodingAt(column: SchemaDraft['columns'][number], columns: SchemaDraft['columns'], revision: number, pair: SchemaDraft['columns'][number]['collation']) {
    if (table || !columnsCurrent(columns, revision)) return;
    if (pair && (!tableCreateColumnEncodingAllowed(column) || !columnCatalog || Date.parse(columnCatalog.expiresAt) <= Date.now() || pair.charset && !columnCatalog.candidates.some(value => value.charset === pair.charset) || pair.collation && !columnCatalog.candidates.some(value => value.charset === pair.charset && value.collation === pair.collation))) return;
    const next = columnOrder.current.patch(columns, column, { collation: pair }); if (!next) return;
    const changed = next[columns.indexOf(column)]; if (pair === undefined) delete changed.collation; else columnEncodingDigests.current.set(changed, columnCatalog!.digest);
    generatedDrafts.current.transfer(column, changed); update({ columns: next });
  }
  /** 候选读取不生成SQL；原可写快照真正释放后才发布目录，并全程保留原Promise锁。 */
  async function readColumnEncodingCatalog() {
    const context = capture(), directory = columnDirectory.current;
    if (table || busy || !directory || directory.busy || columnCatalogClosing.current || createLocked.current || !current(context)) return;
    setBusy(true); setReadingColumnCatalog(true); setError(''); setColumnCatalog(undefined);
    try { await directory.read({ connectionId: context.connectionId, database: context.database, taskId: uid() }, () => current(context), value => { if (current(context)) setColumnCatalog(value); }); }
    catch (reason) { if (sameLifetime(context)) setError(errorMessage(reason)); }
    finally { if (sameLifetime(context)) { setBusy(false); setReadingColumnCatalog(false); } }
  }
  /** 关闭先收回候选读取残留；在途get不能因取消ACK或旧关闭回调提前离开。 */
  async function closeSchema() {
    if (table) { if (!busy) onClose(); return; }
    if (busy || columnDirectory.current?.busy || columnCatalogClosing.current) return;
    const context = capture(), key = closeTargetKey.current, invalidAtStart = origin.current.invalid; columnCatalogClosing.current = true; setBusy(true);
    try { await columnDirectory.current?.releaseAll(); if (sameLifetime(context) && key === closeTargetKey.current && (invalidAtStart || current(context))) onClose(); }
    catch (reason) { if (sameLifetime(context)) setError(errorMessage(reason)); }
    finally { columnCatalogClosing.current = false; if (sameLifetime(context)) setBusy(false); }
  }
  /** 原行身份及代次守卫后切换；替换对象真删非当前模式属性，不以undefined冒充省略。 */
  function generatedModeAt(column: SchemaDraft['columns'][number], columns: SchemaDraft['columns'], revision: number, mode: NewTableColumnMode) {
    if (table || !columnsCurrent(columns, revision)) return;
    const replacement = generatedDrafts.current.switch(column, mode); if (replacement === column) return;
    const next = columnOrder.current.patch(columns, column, replacement); if (!next) return;
    const changed = next[columns.indexOf(column)];
    for (const key of ['generated', 'defaultValue', 'onUpdate', 'collation'] as const) if (!Object.hasOwn(replacement, key)) delete changed[key];
    generatedDrafts.current.transfer(replacement, changed); transferColumnEncoding(column, changed); update({ columns: next });
  }
  /** 表达式回调不能把迟到的普通列变成生成列，亦不重写任何引用。 */
  function generatedExpressionAt(column: SchemaDraft['columns'][number], columns: SchemaDraft['columns'], revision: number, expression: string) {
    if (!column.generated) return;
    columnAt(column, columns, revision, { generated: { storage: column.generated.storage, expression } });
  }
  /** 新属性省略必须真正删键；沿同一原列身份/草稿代次守卫，不能以undefined冒充未指定。 */
  function onUpdateAt(column: SchemaDraft['columns'][number], columns: SchemaDraft['columns'], revision: number, patch: Partial<SchemaDraft['columns'][number]>, remove: boolean) {
    if (table || column.generated || !columnsCurrent(columns, revision)) return;
    if (!remove) { columnAt(column, columns, revision, patch); return; }
    const next = { ...column }; delete next.onUpdate; generatedDrafts.current.transfer(column, next); transferColumnEncoding(column, next);
    update({ columns: columns.map(value => value === column ? next : value) });
  }
  /** 空串仍明确区分未设置、SQL NULL和文字NULL，重排不转换默认值。 */
  function emptyDefaultAt(column: SchemaDraft['columns'][number], columns: SchemaDraft['columns'], revision: number, selected: boolean) { columnAt(column, columns, revision, { defaultValue: selected ? '' : undefined }); }
  /** 增删也核原列表，防止旧删除按钮在重排后删错列。 */
  function removeColumn(column: SchemaDraft['columns'][number], columns: SchemaDraft['columns'], revision: number) {
    if (!table && !columnsCurrent(columns, revision)) return; update({ columns: columns.filter(value => value !== column) });
  }
  /** 只有创建前允许相邻移动；不触碰索引、外键及其列名数组。 */
  function moveColumn(column: SchemaDraft['columns'][number], columns: SchemaDraft['columns'], revision: number, direction: -1 | 1) {
    if (table || !columnsCurrent(columns, revision)) return;
    const next = columnOrder.current.move(columns, column, direction); if (next) update({ columns: next });
  }
  /** 添加普通列同样绑定本次草稿，迟到按钮不得覆盖已重排的列表。 */
  function addColumn(columns: SchemaDraft['columns'], revision: number) {
    if (!table && !columnsCurrent(columns, revision)) return; update({ columns: [...columns, blankColumn()] });
  }
  /** 返回创建草稿先结束确认租约；旧行回调不能随返回重新认领同一数组。 */
  function backFromCreate(context: SchemaOperationContext) {
    if (!current(context)) return; previewRevision.current++; createLocked.current = false; setCreateDraft(null); setConfirming(false);
  }
  /** 索引编辑复用统一草稿更新流程，不直接发送数据库请求。 */
  function indexAt(index: number, patch: Partial<IndexInfo>) { update({ indexes: design.indexes.map((value, item) => item === index && 'columns' in value ? { ...value, ...patch } : value) }); }
  /** 外键更新保留未修改的引用字段及级联动作。 */
  function foreignAt(index: number, patch: Partial<ForeignKeyInfo>) { update({ foreignKeys: design.foreignKeys.map((value, item) => item === index && 'columns' in value ? { ...value, ...patch } : value) }); }
  /** 预览入口独立建立连接，不要求用户预先展开对象树，也不执行写操作。 */
  async function prepare() {
    if (!table) {
      if (busy || createLocked.current || columnDirectory.current?.busy || columnCatalogClosing.current) return;
      if (origin.current.invalid) { setError(tableCreateZh.mismatch); return; }
      const parentContext = capture(); if (!current(parentContext)) { setError(tableCreateZh.mismatch); return; }
      try { assertTableCreateGenerated(liveDesign.current); assertTableCreateColumnEncodings(liveDesign.current); assertTableCreateChecks(liveDesign.current); } catch (reason) { setError(errorMessage(reason) || generatedText.invalid); return; }
      const parsed = tableCreateDraftSchema.safeParse(liveDesign.current); if (!parsed.success) { setError(tableCreateZh.invalidDesign); return; }
      const explicitColumns = tableCreateHasColumnEncoding(parsed.data);
      if (explicitColumns && (!columnCatalog || Date.parse(columnCatalog.expiresAt) <= Date.now() || liveDesign.current.columns.some(column => column.collation && (columnEncodingDigests.current.get(column) !== columnCatalog.digest || !columnCatalog.candidates.some(pair => pair.charset === column.collation!.charset && pair.collation === column.collation!.collation))))) { setError(columnEncodingText.stale); return; }
      createLocked.current = true; setCreateDraft({ design: parsed.data, context: parentContext, ...(explicitColumns ? { columnEncodingCatalogDigest: columnCatalog!.digest } : {}) }); setConfirming(true); return;
    }
    const context = capture(); if (busy || !metadataReady.current || !current(context)) return;
    setError(''); setBusy(true);
    // 草稿修改先同步递增代次；等待期间切换或切回原值都不能复活旧SQL，不自动重新预览或执行。
    try { if (!design.name.trim()) throw new Error(zh.schema.text001); await invoke('connections.open', { id: context.connectionId }); if (!current(context)) return; const result = await invoke('schema.preview', { connectionId: context.connectionId, design: existingDesign(design) }); if (!current(context)) return; previewContext.current = { context, preview: result, sql: result.sql }; setPreview(result); setSql(result.sql); }
    catch (reason) { if (current(context)) setError(errorMessage(reason)); } finally { if (sameLifetime(context)) setBusy(false); }
  }
  /** 确认后先准备连接，再发送一次结构写入；失败只展示错误，不自动重放 DDL。 */
  async function apply() {
    if (!table) return; // 新表只能消费专用能力，不能降级到可编辑SQL提交。
    const accepted = previewContext.current; if (busy || !accepted || accepted.preview !== preview || !current(accepted.context)) return;
    setError(''); setBusy(true); const taskId = uid(); setApplyTaskId(taskId);
    try {
      await invoke('connections.open', { id: accepted.context.connectionId }); if (previewContext.current !== accepted || !current(accepted.context)) return;
      await invoke('schema.apply', { connectionId: accepted.context.connectionId, database: accepted.context.database, sql: accepted.sql, taskId });
      // 已发送的DDL不撤销；目标失效后仍保留原任务事实，但不回调或关闭另一个目标窗口。
      if (previewContext.current !== accepted || !current(accepted.context)) return;
      useWorkspace.getState().notify(zh.schema.text002); onApplied(); onClose();
    }
    catch (reason) { if (current(accepted.context)) setError(errorMessage(reason)); } finally { if (sameLifetime(accepted.context)) setBusy(false); }
  }
  const renderedRevision = previewRevision.current, renderedChecksViewRevision = checksViewRevision.current, columnsEditable = !busy && !confirming && !preview && !createLocked.current && !origin.current.invalid;
  if (!table && confirming && createDraft) return <TableCreateConfirmation connectionId={connectionId} design={createDraft.design} columnEncodingCatalogDigest={createDraft.columnEncodingCatalogDigest} invalidated={origin.current.invalid} isParentCurrent={() => current(createDraft.context)} onBack={() => backFromCreate(createDraft.context)} onClose={onClose} onCreated={onCreated ?? (() => onApplied())} onDirtyChange={onDirtyChange}/>;
  if (unsupported) return <Modal title={formatText(zh.schema.text003, table)} wide onClose={onClose}><div className="modal-content"><div className="info-strip">{zh.schema.text004}</div><SqlEditor value={originalDdl} readOnly height={370}/></div><footer className="modal-footer"><button onClick={onClose}>{zh.common.close}</button><span className="grow"/><button className="primary" onClick={() => { useWorkspace.getState().openTab({ kind: 'query', connectionId, database, title: formatText(zh.schema.text005, table), sql: formatText(zh.schema.text006, originalDdl.split('\n').map(line => '-- ' + line).join('\n')) }); onClose(); }}>{zh.schema.text007}</button></footer></Modal>;
  return <Modal title={table ? formatText(zh.schema.text008, table) : formatText(zh.schema.text009, database)} wide onClose={() => void closeSchema()}><div className="modal-content schema-content"><div className="schema-properties"><Field label={zh.schema.text010}><input value={design.name} onChange={event => update({ name: event.target.value })}/></Field><Field label={zh.schema.text011}><select value={design.engine} onChange={event => update({ engine: event.target.value })}><option>InnoDB</option><option>MyISAM</option><option>MEMORY</option><option>ARCHIVE</option></select></Field><Field label={zh.schema.text012}><input value={design.charset} onChange={event => update({ charset: event.target.value })}/></Field><Field label={zh.schema.text013}><input value={design.comment} onChange={event => update({ comment: event.target.value })}/></Field></div>{preview ? <><div className="info-strip">{zh.schema.text014}</div>{preview.warnings.map(warning => <div className="warning-text" key={warning}>{warning}</div>)}<SqlEditor value={sql} onChange={editSql} readOnly={busy || origin.current.invalid} height={350}/></> : <><div className="dialog-tabs inset">{(['columns', 'indexes', 'foreignKeys'] as const).map((key, index) => <button key={key} className={section === key ? 'selected' : ''} onClick={() => selectSection(key)}>{[zh.common.fields, zh.common.indexes, zh.common.foreignKeys][index]} <span className="count">{design[key].length}</span></button>)}{!table && <button className={section === 'checks' ? 'selected' : ''} onClick={() => selectSection('checks')}>{checksText.title} <span className="count">{design.checks?.length ?? 0}</span></button>}</div>{!table && tableCreateHasChecks(design) && <p className="muted small">{checksText.dependency}</p>}<div className="design-table-wrap">
    {section === 'columns' && <>{!table && <div className="new-table-column-encoding-directory"><p className="muted small">{columnEncodingText.hint}</p><p className="muted small">{columnEncodingText.preparing}</p><button type="button" disabled={!columnsEditable} onClick={() => void readColumnEncodingCatalog()}>{columnCatalog ? columnEncodingText.reread : columnEncodingText.read}</button>{readingColumnCatalog && <><p role="status">{columnEncodingText.reading}</p><button type="button" onClick={() => void columnDirectory.current?.cancel().catch(reason => setError(errorMessage(reason)))}>{columnEncodingText.cancel}</button></>}{(!columnCatalog || Date.parse(columnCatalog.expiresAt) <= Date.now()) && <p className="muted small">{columnEncodingText.unavailable}</p>}{columnCatalog?.warnings.map((warning, index) => <p className="warning-text" key={index}>{warning}</p>)}</div>}<table className="design-table"><thead><tr><th>{zh.schema.text015}</th><th>{zh.common.type}</th><th>{zh.schema.text016}</th><th>{zh.schema.text017}</th><th>{zh.common.defaultValue}</th><th>{zh.common.comment}</th>{!table && <><th>{tableCreateOnUpdateZh.title}</th><th>{generatedText.title}</th><th>{columnEncodingText.title}</th></>}<th/></tr></thead><tbody>{design.columns.map((column, index) => <tr key={table ? index : columnOrder.current.key(column)}><td><input disabled={!table && !columnsEditable} aria-label={formatText(zh.schema.text018, index + 1)} value={column.name} onChange={event => columnAt(column, design.columns, renderedRevision, { name: event.target.value })}/></td><td><input disabled={!table && !columnsEditable} aria-label={formatText(zh.schema.text019, index + 1)} value={column.type} onChange={event => columnAt(column, design.columns, renderedRevision, { type: event.target.value })}/></td><td><input disabled={!table && (!columnsEditable || !!column.generated)} type="checkbox" aria-label={formatText(zh.schema.text020, index + 1)} checked={column.nullable} onChange={event => columnAt(column, design.columns, renderedRevision, { nullable: event.target.checked })}/></td><td><input disabled={!table && (!columnsEditable || !!column.generated)} type="checkbox" aria-label={formatText(zh.schema.text021, index + 1)} checked={column.autoIncrement} onChange={event => columnAt(column, design.columns, renderedRevision, { autoIncrement: event.target.checked })}/></td><td><input disabled={!table && (!columnsEditable || !!column.generated)} aria-label={formatText(zh.schema.text022, index + 1)} value={column.defaultValue ?? ''} placeholder={column.defaultValue === null ? 'NULL' : zh.schema.text023} onChange={event => columnAt(column, design.columns, renderedRevision, { defaultValue: event.target.value === 'NULL' ? null : event.target.value || undefined })}/><label title={zh.schema.emptyStringDefaultHint}><input disabled={!table && (!columnsEditable || !!column.generated)} type="checkbox" aria-label={formatText(zh.schema.emptyStringDefaultLabel, index + 1)} checked={column.defaultValue === ''} onChange={event => emptyDefaultAt(column, design.columns, renderedRevision, event.target.checked)}/>{zh.schema.emptyStringDefault}</label>{/* 显式区分SQL空值与同名文字，不改变已有NULL输入约定。 */}{(column.defaultValue === null || column.defaultValue === 'NULL') && <label><input disabled={!table && (!columnsEditable || !!column.generated)} type="checkbox" aria-label={formatText(zh.schema.literalNullLabel, index + 1)} checked={column.defaultValue === 'NULL'} onChange={event => columnAt(column, design.columns, renderedRevision, { defaultValue: event.target.checked ? 'NULL' : null })}/>{zh.schema.literalNull}</label>}</td><td><input disabled={!table && !columnsEditable} aria-label={formatText(zh.schema.text024, index + 1)} value={column.comment} onChange={event => columnAt(column, design.columns, renderedRevision, { comment: event.target.value })}/></td>{!table && <td><NewTableOnUpdateField column={column} position={index + 1} disabled={!columnsEditable || !!column.generated} onChange={(value, remove) => onUpdateAt(column, design.columns, renderedRevision, value, remove)}/></td>}{!table && <td><NewTableGeneratedField design={design} position={index + 1} disabled={!columnsEditable} onMode={mode => generatedModeAt(column, design.columns, renderedRevision, mode)} onExpression={expression => generatedExpressionAt(column, design.columns, renderedRevision, expression)}/></td>}{!table && <td><NewTableColumnEncodingField column={column} position={index + 1} catalog={columnCatalog} disabled={!columnsEditable} onChange={pair => columnEncodingAt(column, design.columns, renderedRevision, pair)}/></td>}<td>{!table && <><button type="button" disabled={!columnsEditable || index === 0} aria-label={columnOrderText.upLabel(index + 1)} onClick={() => moveColumn(column, design.columns, renderedRevision, -1)}>{columnOrderText.up}</button><button type="button" disabled={!columnsEditable || index === design.columns.length - 1} aria-label={columnOrderText.downLabel(index + 1)} onClick={() => moveColumn(column, design.columns, renderedRevision, 1)}>{columnOrderText.down}</button></>}<button className="icon-button danger" title={zh.schema.text025} aria-label={formatText(zh.schema.text026, index + 1)} disabled={!table && !columnsEditable} onClick={() => removeColumn(column, design.columns, renderedRevision)}><Trash2 size={14}/></button></td></tr>)}</tbody></table><button className="text-button" disabled={!table && !columnsEditable} onClick={() => addColumn(design.columns, renderedRevision)}><Plus size={14}/>{zh.schema.text027}</button></>}
    {!table && section === 'checks' && <NewTableChecksEditor checks={design.checks} disabled={!columnsEditable} isCurrent={() => checksCurrent(design, design.checks, renderedRevision, renderedChecksViewRevision)} onChange={next => checksAt(design, design.checks, renderedRevision, renderedChecksViewRevision, next)}/>}
    {section === 'indexes' && !table && <NewTableIndexEditor indexes={design.indexes} columns={design.columns} onChange={indexes => update({ indexes })}/>}{section === 'indexes' && !!table && <><table className="design-table"><thead><tr><th>{zh.schema.text028}</th><th>{zh.schema.text029}</th><th>{zh.schema.text030}</th><th/></tr></thead><tbody>{design.indexes.map((indexInfo, index) => <tr key={index}><td><input aria-label={formatText(zh.schema.text031, index + 1)} value={indexInfo.name} placeholder={zh.schema.text032} onChange={event => indexAt(index, { name: event.target.value })}/></td><td><input type="checkbox" aria-label={formatText(zh.schema.text033, index + 1)} checked={indexInfo.unique} onChange={event => indexAt(index, { unique: event.target.checked })}/></td><td><input aria-label={formatText(zh.schema.text034, index + 1)} value={('columns' in indexInfo ? indexInfo.columns : []).join(', ')} onChange={event => indexAt(index, { columns: splitColumns(event.target.value) })}/></td><td><button className="icon-button danger" aria-label={formatText(zh.schema.text035, index + 1)} onClick={() => update({ indexes: design.indexes.filter((_, item) => item !== index) })}><Trash2 size={14}/></button></td></tr>)}</tbody></table><button className="text-button" onClick={() => update({ indexes: [...design.indexes, { name: '', unique: false, columns: [] }] })}><Plus size={14}/>{zh.schema.text036}</button></>}
    {section === 'foreignKeys' && <>{design.foreignKeys.map((foreign, index) => <div className="foreign-card" key={index}><div className="form-grid three"><Field label={zh.schema.text037}><input value={foreign.name} onChange={event => foreignAt(index, { name: event.target.value })}/></Field><Field label={zh.schema.text038}><input value={foreign.columns.join(', ')} onChange={event => foreignAt(index, { columns: splitColumns(event.target.value) })}/></Field><Field label={zh.schema.text039}><input value={foreign.referencedDatabase} onChange={event => foreignAt(index, { referencedDatabase: event.target.value })}/></Field><Field label={zh.schema.text040}><input value={foreign.referencedTable} onChange={event => foreignAt(index, { referencedTable: event.target.value })}/></Field><Field label={zh.schema.text041}><input value={foreign.referencedColumns.join(', ')} onChange={event => foreignAt(index, { referencedColumns: splitColumns(event.target.value) })}/></Field><Field label={zh.schema.text042}><select value={foreign.onUpdate} onChange={event => foreignAt(index, { onUpdate: event.target.value })}>{['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'].map(rule => <option key={rule}>{rule}</option>)}</select></Field><Field label={zh.schema.text043}><select value={foreign.onDelete} onChange={event => foreignAt(index, { onDelete: event.target.value })}>{['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'].map(rule => <option key={rule}>{rule}</option>)}</select></Field><button className="danger" onClick={() => update({ foreignKeys: design.foreignKeys.filter((_, item) => item !== index) })}><Trash2 size={14}/>{zh.schema.text044}</button></div></div>)}<button className="text-button" onClick={() => update({ foreignKeys: [...design.foreignKeys, { name: '', columns: [], referencedDatabase: database, referencedTable: '', referencedColumns: [], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }] })}><Plus size={14}/>{zh.schema.text045}</button></>}
    </div></>}<ErrorBox message={origin.current.invalid ? tableCreateZh.mismatch : error}/></div><footer className="modal-footer"><button disabled={busy} onClick={() => void closeSchema()}>{zh.common.cancel}</button><span className="grow"/>{preview && <button disabled={busy} onClick={backToDraft}>{zh.schema.text046}</button>}{busy && applyTaskId && <button onClick={() => void invoke('query.cancel', { taskId: applyTaskId }).catch(reason => setError(errorMessage(reason)))}>{zh.schema.text047}</button>}<button className="primary" disabled={busy || origin.current.invalid || !!table && !metadataReady.current} onClick={() => void (preview ? apply() : prepare())}>{busy ? <Spinner/> : <>{preview ? zh.schema.text048 : zh.schema.text049}<ArrowRight size={14}/></>}</button></footer></Modal>;
}

/** 根据对象种类生成可编辑的 SQL；涉及重建的对象在执行前明确展示全部语句。 */
function template(kind: string, database: string, name: string) {
  const target = qualifiedName(database, name || zh.schema.text050);
  if (kind === 'view') return `CREATE OR REPLACE VIEW ${target} AS\nSELECT 1 AS example;`;
  if (kind === 'procedure') return `DELIMITER $$\nCREATE PROCEDURE ${target}()\nBEGIN\n  SELECT 1;\nEND$$\nDELIMITER ;`;
  if (kind === 'function') return `DELIMITER $$\nCREATE FUNCTION ${target}(input_value INT)\nRETURNS INT DETERMINISTIC\nBEGIN\n  RETURN input_value;\nEND$$\nDELIMITER ;`;
  if (kind === 'trigger') return formatText(zh.schema.text051, target, qualifiedName(database, zh.schema.text052));
  return `CREATE EVENT ${target}\nON SCHEDULE EVERY 1 DAY\nDO\n  SELECT 1;`;
}

/** 统一入口分流：新建库与既有对象编辑分别维护确认生命周期，无默认库也能创建。 */
interface DdlDialogProps { onDirtyChange?(dirty: boolean): void; connectionId: string; database?: string; object?: DatabaseObject; onClose(): void; onApplied(): void; readOnly?: boolean; definitionSearch?: DefinitionSearchOpen; }
/** 只读定义使用独立组件生命周期，切换编辑/查看模式不会改变同一组件的Hook顺序。 */
export function DdlDialog(props: DdlDialogProps) {
  // 新建库走独立编码目录与一次性预览，原对象DDL编辑器保持原生命周期。
  if (!props.database && !props.object && !props.readOnly) return <DatabaseCreateDialog connectionId={props.connectionId} onClose={props.onClose} onApplied={props.onApplied} onDirtyChange={props.onDirtyChange}/>;
  return props.readOnly && props.object && props.database ? <DefinitionViewer connectionId={props.connectionId} database={props.database} object={props.object} search={props.definitionSearch} onClose={props.onClose}/> : <DdlEditorDialog {...props}/>;
}
/** 原有显式DDL编辑、预览与确认执行路径保持独立。 */
function DdlEditorDialog({ connectionId, database, object, onClose, onApplied, readOnly=false }: DdlDialogProps) {
  const [name, setName] = useState(object?.name ?? ''); const [kind, setKind] = useState(object?.kind ?? 'view'); const [sql, setSql] = useState(database ? template('view', database, '') : ''); const [busy, setBusy] = useState(!!object); const [error, setError] = useState('');
  const [applyTaskId, setApplyTaskId] = useState('');
  useEffect(() => {
    if (!object || !database) return;
    // 定义读取不依赖树节点是否展开，连接准备失败时只展示原始错误。
    void invoke('connections.open', { id: connectionId }).then(() => invoke('metadata.ddl', { connectionId, database, name: object.name, kind: object.kind })).then(ddl => {
      // 搜索按名称导航时只展示重新读取的原定义，不把新同名对象变成可执行重建脚本。
      if(readOnly)setSql(ddl);
      else if (object.kind === 'view') setSql(ddl.replace(/^CREATE\s+/i, 'CREATE OR REPLACE '));
      else if (['procedure', 'function', 'trigger', 'event'].includes(object.kind)) setSql(`DROP ${object.kind.toUpperCase()} IF EXISTS ${qualifiedName(database, object.name)};\nDELIMITER $$\n${ddl.replace(/;\s*$/, '')}$$\nDELIMITER ;`);
      else setSql(ddl);
    }).catch(reason => setError(errorMessage(reason))).finally(() => setBusy(false));
  }, [connectionId, database, object, readOnly]);
  const statement = database ? sql : name ? `CREATE DATABASE ${identifier(name)} CHARACTER SET utf8mb4;` : '';
  /** 用户确认后独立准备连接并执行一次 SQL，连接失败或写入失败均不自动重试。 */
  async function apply() {
    if(readOnly)return;
    if (!statement.trim()) { setError(zh.schema.text053); return; }
    if (!window.confirm(zh.schema.text054)) return;
    setBusy(true); setError(''); const taskId = uid(); setApplyTaskId(taskId);
    try { await invoke('connections.open', { id: connectionId }); await invoke('schema.apply', { connectionId, database: database ?? '', sql: statement, taskId }); useWorkspace.getState().notify(zh.schema.text055); onApplied(); onClose(); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  return <Modal title={readOnly&&object?databaseSearchZh.definitionTitle(kindLabels[object.kind],object.name):!database ? zh.schema.text056 : object ? formatText(zh.schema.text057, kindLabels[object.kind], object.name) : zh.schema.text058} wide onClose={() => { if (!busy) onClose(); }}><div className="modal-content">{!object && <div className="form-grid"><Field label={database ? zh.schema.text059 : zh.schema.text060}><input value={name} onChange={event => { setName(event.target.value); if (database) setSql(template(kind, database, event.target.value)); }}/></Field>{database && <Field label={zh.schema.text061}><select value={kind} onChange={event => { const next = event.target.value as typeof kind; setKind(next); setSql(template(next, database, name)); }}>{['view', 'procedure', 'function', 'trigger', 'event'].map(key => <option key={key} value={key}>{kindLabels[key]}</option>)}</select></Field>}</div>}{readOnly&&<p className="muted">{databaseSearchZh.definitionReadOnly}</p>}{!readOnly&&object && object.kind !== 'view' && <p className="warning-text">{zh.schema.text062}</p>}<SqlEditor value={statement} onChange={database&&!readOnly ? setSql : undefined} readOnly={readOnly||!database} height={340}/><ErrorBox message={error}/></div><footer className="modal-footer"><span className="grow"/><button disabled={busy} onClick={onClose}>{zh.common.cancel}</button>{busy && applyTaskId && <button onClick={() => void invoke('query.cancel', { taskId: applyTaskId }).catch(reason => setError(errorMessage(reason)))}>{zh.schema.text047}</button>}{!readOnly&&<button className="primary" disabled={busy || !statement.trim()} onClick={() => void apply()}>{busy ? <Spinner/> : zh.common.executeSql}</button>}</footer></Modal>;
}
