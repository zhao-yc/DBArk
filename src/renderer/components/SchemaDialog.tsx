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
const blankColumn = (): TableDesign['columns'][number] => ({ name: '', type: 'varchar(255)', nullable: true, autoIncrement: false, comment: '' });
/** 保留正在输入的空段，防止输入逗号时受控表单立即把分隔符删除。 */
const splitColumns = (text: string) => text.split(',').map(item => item.trim());

/** 设计器维护字段、索引及外键草稿，必须先生成预览后才允许执行 DDL。 */
export function SchemaDialog({ connectionId, database, table, onClose, onApplied, onCreated, onDirtyChange }: { connectionId: string; database: string; table?: string; onClose: () => void; onApplied: () => void; onCreated?(result: TableCreateApplyOutput, version: number): void; onDirtyChange?(dirty: boolean): void }) {
  const [design, setDesign] = useState<TableDesign>({ database, name: table ?? '', ...(table ? { originalName: table } : {}), engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: table ? [] : [{ ...blankColumn(), name: 'id', type: 'bigint unsigned', nullable: false, autoIncrement: true }], indexes: table ? [] : [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [] });
  const [section, setSection] = useState<'columns' | 'indexes' | 'foreignKeys'>('columns'); const [busy, setBusy] = useState(!!table); const [error, setError] = useState(''); const [preview, setPreview] = useState<SqlPreview | null>(null); const [sql, setSql] = useState('');
  const [unsupported, setUnsupported] = useState(false); const [originalDdl, setOriginalDdl] = useState('');
  const [applyTaskId, setApplyTaskId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const sourceVersion = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const origin = useRef({ connectionId, database, version: sourceVersion, draft: JSON.stringify(design), invalid: false });
  if (!table && (origin.current.connectionId !== connectionId || origin.current.database !== database || origin.current.version !== sourceVersion)) origin.current.invalid = true;
  useEffect(() => {
    if (table) return;
    // 草稿阶段也观察连接ABA，不能到确认阶段才默默绑定另一份配置。
    return useWorkspace.subscribe(state => { if ((state.connectionVersions[origin.current.connectionId] ?? 0) !== origin.current.version) { origin.current.invalid = true; setError(tableCreateZh.mismatch); } });
  }, [table]);
  useEffect(() => { if (!table) onDirtyChange?.(confirming || JSON.stringify(design) !== origin.current.draft); }, [design, confirming, table]);
  useEffect(() => {
    if (!table) return;
    void invoke('connections.open', { id: connectionId }).then(() => invoke('metadata.table', { connectionId, database, table })).then(info => {
      setOriginalDdl(info.ddl);
      setUnsupported(info.columns.some(column => column.generated));
      setDesign({ database, name: table, originalName: table, engine: info.engine || 'InnoDB', charset: info.charset || 'utf8mb4', comment: info.comment || '', columns: info.columns.map(column => ({ name: column.name, originalName: column.name, type: column.type, nullable: column.nullable, defaultValue: column.defaultValue === null && !column.nullable ? undefined : column.defaultValue, autoIncrement: column.extra.toLowerCase().includes('auto_increment'), comment: column.comment })), indexes: info.indexes, foreignKeys: info.foreignKeys });
    }).catch(reason => setError(errorMessage(reason))).finally(() => setBusy(false));
  }, [connectionId, database, table]);
  /** 结构草稿一旦变化，旧 SQL 预览立即失效，避免提交过时的语句。 */
  function update(patch: Partial<TableDesign>) { setDesign(current => ({ ...current, ...patch })); setPreview(null); }
  /** 只更新指定字段的草稿，保留原字段名用于安全生成修改语句。 */
  function columnAt(index: number, patch: Partial<TableDesign['columns'][number]>) { update({ columns: design.columns.map((column, item) => item === index ? { ...column, ...patch } : column) }); }
  /** 索引编辑复用统一草稿更新流程，不直接发送数据库请求。 */
  function indexAt(index: number, patch: Partial<IndexInfo>) { update({ indexes: design.indexes.map((value, item) => item === index ? { ...value, ...patch } : value) }); }
  /** 外键更新保留未修改的引用字段及级联动作。 */
  function foreignAt(index: number, patch: Partial<ForeignKeyInfo>) { update({ foreignKeys: design.foreignKeys.map((value, item) => item === index ? { ...value, ...patch } : value) }); }
  /** 预览入口独立建立连接，不要求用户预先展开对象树，也不执行写操作。 */
  async function prepare() {
    if (!table) { if (origin.current.invalid) { setError(tableCreateZh.mismatch); return; } setConfirming(true); return; }
    setError(''); setBusy(true);
    try { if (!design.name.trim()) throw new Error(zh.schema.text001); await invoke('connections.open', { id: connectionId }); const result = await invoke('schema.preview', { connectionId, design }); setPreview(result); setSql(result.sql); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  /** 确认后先准备连接，再发送一次结构写入；失败只展示错误，不自动重放 DDL。 */
  async function apply() {
    if (!table) return; // 新表只能消费专用能力，不能降级到可编辑SQL提交。
    setError(''); setBusy(true); const taskId = uid(); setApplyTaskId(taskId);
    try { await invoke('connections.open', { id: connectionId }); await invoke('schema.apply', { connectionId, database, sql, taskId }); useWorkspace.getState().notify(zh.schema.text002); onApplied(); onClose(); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  if (!table && confirming) return <TableCreateConfirmation connectionId={connectionId} design={design} onBack={() => setConfirming(false)} onClose={onClose} onCreated={onCreated ?? (() => onApplied())} onDirtyChange={onDirtyChange}/>;
  if (unsupported) return <Modal title={formatText(zh.schema.text003, table)} wide onClose={onClose}><div className="modal-content"><div className="info-strip">{zh.schema.text004}</div><SqlEditor value={originalDdl} readOnly height={370}/></div><footer className="modal-footer"><button onClick={onClose}>{zh.common.close}</button><span className="grow"/><button className="primary" onClick={() => { useWorkspace.getState().openTab({ kind: 'query', connectionId, database, title: formatText(zh.schema.text005, table), sql: formatText(zh.schema.text006, originalDdl.split('\n').map(line => '-- ' + line).join('\n')) }); onClose(); }}>{zh.schema.text007}</button></footer></Modal>;
  return <Modal title={table ? formatText(zh.schema.text008, table) : formatText(zh.schema.text009, database)} wide onClose={() => { if (!busy) onClose(); }}><div className="modal-content schema-content"><div className="schema-properties"><Field label={zh.schema.text010}><input value={design.name} onChange={event => update({ name: event.target.value })}/></Field><Field label={zh.schema.text011}><select value={design.engine} onChange={event => update({ engine: event.target.value })}><option>InnoDB</option><option>MyISAM</option><option>MEMORY</option><option>ARCHIVE</option></select></Field><Field label={zh.schema.text012}><input value={design.charset} onChange={event => update({ charset: event.target.value })}/></Field><Field label={zh.schema.text013}><input value={design.comment} onChange={event => update({ comment: event.target.value })}/></Field></div>{preview ? <><div className="info-strip">{zh.schema.text014}</div>{preview.warnings.map(warning => <div className="warning-text" key={warning}>{warning}</div>)}<SqlEditor value={sql} onChange={setSql} height={350}/></> : <><div className="dialog-tabs inset">{(['columns', 'indexes', 'foreignKeys'] as const).map((key, index) => <button key={key} className={section === key ? 'selected' : ''} onClick={() => setSection(key)}>{[zh.common.fields, zh.common.indexes, zh.common.foreignKeys][index]} <span className="count">{design[key].length}</span></button>)}</div><div className="design-table-wrap">
    {section === 'columns' && <><table className="design-table"><thead><tr><th>{zh.schema.text015}</th><th>{zh.common.type}</th><th>{zh.schema.text016}</th><th>{zh.schema.text017}</th><th>{zh.common.defaultValue}</th><th>{zh.common.comment}</th><th/></tr></thead><tbody>{design.columns.map((column, index) => <tr key={index}><td><input aria-label={formatText(zh.schema.text018, index + 1)} value={column.name} onChange={event => columnAt(index, { name: event.target.value })}/></td><td><input aria-label={formatText(zh.schema.text019, index + 1)} value={column.type} onChange={event => columnAt(index, { type: event.target.value })}/></td><td><input type="checkbox" aria-label={formatText(zh.schema.text020, index + 1)} checked={column.nullable} onChange={event => columnAt(index, { nullable: event.target.checked })}/></td><td><input type="checkbox" aria-label={formatText(zh.schema.text021, index + 1)} checked={column.autoIncrement} onChange={event => columnAt(index, { autoIncrement: event.target.checked })}/></td><td><input aria-label={formatText(zh.schema.text022, index + 1)} value={column.defaultValue ?? ''} placeholder={column.defaultValue === null ? 'NULL' : zh.schema.text023} onChange={event => columnAt(index, { defaultValue: event.target.value === 'NULL' ? null : event.target.value || undefined })}/></td><td><input aria-label={formatText(zh.schema.text024, index + 1)} value={column.comment} onChange={event => columnAt(index, { comment: event.target.value })}/></td><td><button className="icon-button danger" title={zh.schema.text025} aria-label={formatText(zh.schema.text026, index + 1)} onClick={() => update({ columns: design.columns.filter((_, item) => item !== index) })}><Trash2 size={14}/></button></td></tr>)}</tbody></table><button className="text-button" onClick={() => update({ columns: [...design.columns, blankColumn()] })}><Plus size={14}/>{zh.schema.text027}</button></>}
    {section === 'indexes' && <><table className="design-table"><thead><tr><th>{zh.schema.text028}</th><th>{zh.schema.text029}</th><th>{zh.schema.text030}</th><th/></tr></thead><tbody>{design.indexes.map((indexInfo, index) => <tr key={index}><td><input aria-label={formatText(zh.schema.text031, index + 1)} value={indexInfo.name} placeholder={zh.schema.text032} onChange={event => indexAt(index, { name: event.target.value })}/></td><td><input type="checkbox" aria-label={formatText(zh.schema.text033, index + 1)} checked={indexInfo.unique} onChange={event => indexAt(index, { unique: event.target.checked })}/></td><td><input aria-label={formatText(zh.schema.text034, index + 1)} value={indexInfo.columns.join(', ')} onChange={event => indexAt(index, { columns: splitColumns(event.target.value) })}/></td><td><button className="icon-button danger" aria-label={formatText(zh.schema.text035, index + 1)} onClick={() => update({ indexes: design.indexes.filter((_, item) => item !== index) })}><Trash2 size={14}/></button></td></tr>)}</tbody></table><button className="text-button" onClick={() => update({ indexes: [...design.indexes, { name: '', unique: false, columns: [] }] })}><Plus size={14}/>{zh.schema.text036}</button></>}
    {section === 'foreignKeys' && <>{design.foreignKeys.map((foreign, index) => <div className="foreign-card" key={index}><div className="form-grid three"><Field label={zh.schema.text037}><input value={foreign.name} onChange={event => foreignAt(index, { name: event.target.value })}/></Field><Field label={zh.schema.text038}><input value={foreign.columns.join(', ')} onChange={event => foreignAt(index, { columns: splitColumns(event.target.value) })}/></Field><Field label={zh.schema.text039}><input value={foreign.referencedDatabase} onChange={event => foreignAt(index, { referencedDatabase: event.target.value })}/></Field><Field label={zh.schema.text040}><input value={foreign.referencedTable} onChange={event => foreignAt(index, { referencedTable: event.target.value })}/></Field><Field label={zh.schema.text041}><input value={foreign.referencedColumns.join(', ')} onChange={event => foreignAt(index, { referencedColumns: splitColumns(event.target.value) })}/></Field><Field label={zh.schema.text042}><select value={foreign.onUpdate} onChange={event => foreignAt(index, { onUpdate: event.target.value })}>{['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'].map(rule => <option key={rule}>{rule}</option>)}</select></Field><Field label={zh.schema.text043}><select value={foreign.onDelete} onChange={event => foreignAt(index, { onDelete: event.target.value })}>{['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'].map(rule => <option key={rule}>{rule}</option>)}</select></Field><button className="danger" onClick={() => update({ foreignKeys: design.foreignKeys.filter((_, item) => item !== index) })}><Trash2 size={14}/>{zh.schema.text044}</button></div></div>)}<button className="text-button" onClick={() => update({ foreignKeys: [...design.foreignKeys, { name: '', columns: [], referencedDatabase: database, referencedTable: '', referencedColumns: [], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }] })}><Plus size={14}/>{zh.schema.text045}</button></>}
    </div></>}<ErrorBox message={error}/></div><footer className="modal-footer"><button disabled={busy} onClick={onClose}>{zh.common.cancel}</button><span className="grow"/>{preview && <button disabled={busy} onClick={() => setPreview(null)}>{zh.schema.text046}</button>}{busy && applyTaskId && <button onClick={() => void invoke('query.cancel', { taskId: applyTaskId }).catch(reason => setError(errorMessage(reason)))}>{zh.schema.text047}</button>}<button className="primary" disabled={busy} onClick={() => void (preview ? apply() : prepare())}>{busy ? <Spinner/> : <>{preview ? zh.schema.text048 : zh.schema.text049}<ArrowRight size={14}/></>}</button></footer></Modal>;
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
