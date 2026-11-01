import { compileSqliteTableRebuildCopyDefinition } from './sqliteTableRebuildPlan';
import { sqliteTableRebuildChangesSchema, sqliteTableRebuildEditsSchema, copySqliteTableRebuildColumnOrder, sqliteTableRebuildInspectionSchema, sqliteTableRebuildLimits, type SqliteTableRebuildChange, type SqliteTableRebuildInspectOutput } from './sqliteTableRebuild';
import { parseSqliteObjectsCreateHeader } from './sqliteObjects';

export interface SqliteTableRebuildNames { candidate: string; ordinal: string; verificationCandidate: string; verificationOrdinal: string; }
export type SqliteTableRebuildPlanSource = Pick<SqliteTableRebuildInspectOutput, 'target' | 'tableSql' | 'columns' | 'relatedObjects' | 'rowIdentity' | 'sequence' | 'withoutRowid' | 'strict'>;
export interface SqliteTableRebuildStep { role: 'candidate-create' | 'candidate-index' | 'original-copy' | 'verification-create' | 'verification-index' | 'verification-copy' | 'ordinal-index-drop' | 'ordinal-drop' | 'original-drop' | 'candidate-rename' | 'restore-index' | 'restore-trigger' | 'verification-drop' | 'sequence-delete' | 'sequence-insert'; sql: string; }
const q = (value: string) => '"' + value.replaceAll('"', '""') + '"', fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());

/** 四个随机名称由Main签发，不从Runtime返回的SQL反推；严格复制不能透传任意能力。 */
export function copySqliteTableRebuildNames(raw: unknown): SqliteTableRebuildNames {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw Error('SQLite重建私有名称能力无效');
  const keys = ['candidate', 'ordinal', 'verificationCandidate', 'verificationOrdinal'] as const, ownKeys = Reflect.ownKeys(raw); if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key as typeof keys[number]))) throw Error('SQLite重建私有名称能力无效');
  const values = Object.create(null) as Record<typeof keys[number], string>;
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(raw, key), value = descriptor?.value; if (!descriptor?.enumerable || !('value' in descriptor) || typeof value !== 'string' || !(key === 'candidate' || key === 'verificationCandidate' ? /^__dbark_rebuild_[a-f0-9]{32}$/.test(value) && value.length === 48 : /^__dbark_rebuild_order_[a-f0-9]{32}$/.test(value) && value.length === 54)) throw Error('SQLite重建私有名称能力无效'); values[key] = value; }
  if (new Set(Object.values(values)).size !== keys.length) throw Error('SQLite重建私有名称不能重复'); return { ...values };
}
/** 候选仍须由native复核真实rowid；三别名全被遮蔽且原IPK被移除时不能假冒身份。 */
function candidateIdentity(source: SqliteTableRebuildPlanSource, changes: readonly SqliteTableRebuildChange[]): SqliteTableRebuildInspectOutput['rowIdentity'] {
  if (source.rowIdentity.kind === 'primary-key') return { kind: 'primary-key', columns: [...source.rowIdentity.columns] };
  const originalAlias = source.columns.find(column => fold(column.name) === fold(source.rowIdentity.kind === 'rowid' ? source.rowIdentity.source : ''));
  if (originalAlias) { const changed = changes.find(change => fold(change.column) === fold(originalAlias.name)); if ((changed?.declaredType ?? originalAlias.declaredType).toUpperCase() === 'INTEGER') return { kind: 'rowid', source: originalAlias.name }; }
  const alias = ['_rowid_', 'rowid', 'oid'].find(name => !source.columns.some(column => fold(column.name) === name)); if (alias) return { kind: 'rowid', source: alias };
  throw Error('SQLite类型修改使候选真实rowid不可访问，无法证明物理行身份保持');
}
/** 固定INSERT OR ABORT显式复制普通列/真实rowid，生成列留native计算；排序从不取旧ordinal。 */
function copySql(sourceTable: string, targetTable: string, ordinal: string, copied: string[], sourceIdentity: SqliteTableRebuildInspectOutput['rowIdentity'], targetIdentity: SqliteTableRebuildInspectOutput['rowIdentity']): string {
  const target = [...copied], source = copied.map(q);
  if (sourceIdentity.kind === 'rowid' && targetIdentity.kind === 'rowid' && !target.some(name => fold(name) === fold(targetIdentity.source))) { target.push(targetIdentity.source); source.push(q(sourceIdentity.source)); }
  const order = sourceIdentity.kind === 'rowid' ? [sourceIdentity.source] : sourceIdentity.columns;
  target.push(ordinal); source.push('ROW_NUMBER() OVER(ORDER BY ' + order.map(name => q(name) + ' COLLATE BINARY ASC').join(',') + ')');
  return 'INSERT OR ABORT INTO main.' + q(targetTable) + '(' + target.map(q).join(',') + ') SELECT ' + source.join(',') + ' FROM main.' + q(sourceTable);
}
/** 仅扫描INDEX头的必要token核种类/归属；正文和单语句边界仍由native处理，不正则改写SQL。 */
function assertIndexHeader(sql: string, expectedName: string, table: string): void {
  let offset = 0;
  const skip = () => { for (;;) { while (offset < sql.length && /[\t\n\v\f\r \uFEFF]/.test(sql[offset])) offset++; if (sql.startsWith('--', offset)) { const end = sql.indexOf('\n', offset + 2); offset = end < 0 ? sql.length : end + 1; } else if (sql.startsWith('/*', offset)) { const end = sql.indexOf('*/', offset + 2); offset = end < 0 ? sql.length : end + 2; } else return; } };
  const token = (): { value: string; quoted: boolean } => {
    skip(); const first = sql[offset++]; if (!first) throw Error('SQLite原索引CREATE头不完整');
    if (['"', "'", '`', '['].includes(first)) { const close = first === '[' ? ']' : first; let value = ''; while (offset < sql.length) { const character = sql[offset++]; if (character === close) { if (first !== '[' && sql[offset] === close) { value += close; offset++; } else return { value, quoted: true }; } else value += character; if (value.length > 512) throw Error('SQLite原索引名称超过预算'); } throw Error('SQLite原索引引用名未结束'); }
    if (!/[A-Za-z_\u0080-\uffff]/.test(first)) throw Error('SQLite原索引CREATE头无效'); const start = offset - 1; while (offset < sql.length && /[A-Za-z0-9_$\u0080-\uffff]/.test(sql[offset])) { offset++; if (offset - start > 512) throw Error('SQLite原索引名称超过预算'); } return { value: sql.slice(start, offset), quoted: false };
  };
  const keyword = (value: { value: string; quoted: boolean }, expected: string) => !value.quoted && fold(value.value) === expected;
  const name = () => { let first = token(); if (!first.quoted && fold(first.value) === 'if') throw Error('SQLite原索引不能含静默IF NOT EXISTS'); skip(); if (sql[offset] === '.') { offset++; if (fold(first.value) !== 'main') throw Error('SQLite原索引只能属于main'); first = token(); } return first.value; };
  if (!keyword(token(), 'create')) throw Error('SQLite原索引必须为准确CREATE INDEX'); let kind = token(); if (keyword(kind, 'unique')) kind = token();
  if (!keyword(kind, 'index') || name() !== expectedName || !keyword(token(), 'on') || fold(name()) !== fold(table)) throw Error('SQLite原索引种类、名称或准确所属表不一致');
}
/** Main与Runtime共同重算全部固定SQL；此函数无数据库访问，不签发执行权或试写DDL。 */
export function buildSqliteTableRebuildPlan(source: SqliteTableRebuildPlanSource, rawChanges: readonly SqliteTableRebuildChange[], rawNames: SqliteTableRebuildNames, rawColumnOrder?: readonly string[]) {
  const names = copySqliteTableRebuildNames(rawNames), columnOrder = rawColumnOrder === undefined ? undefined : copySqliteTableRebuildColumnOrder(rawColumnOrder, source.columns.map(column => column.name)), changes = (columnOrder ? sqliteTableRebuildEditsSchema : sqliteTableRebuildChangesSchema).parse(rawChanges);
  // 复用公开目录校验，不允许拼凑一个不符合真实字段/行身份合同的计划来源。
  sqliteTableRebuildInspectionSchema.parse({ ...source, catalogueId: '计划来源', readOnly: false, expiresAt: new Date(0).toISOString() });
  for (const name of Object.values(names)) if (source.relatedObjects.some(object => fold(object.name) === fold(name)) || source.columns.some(column => fold(column.name) === fold(name))) throw Error('SQLite重建私有名称已被原目录占用');
  const compileInput = { table: source.target.table, tableSql: source.tableSql, columns: source.columns.map(column => ({ name: column.name, hidden: column.hidden })), changes, ...(columnOrder ? { columnOrder } : {}) };
  const candidate = compileSqliteTableRebuildCopyDefinition({ ...compileInput, candidateName: names.candidate }, names.ordinal), verification = compileSqliteTableRebuildCopyDefinition({ ...compileInput, candidateName: names.verificationCandidate }, names.verificationOrdinal), identity = candidateIdentity(source, changes), copied = candidate.columnMapping.filter(column => column.copy).map(column => column.name);
  if ([candidate.ordinalIndex, verification.ordinalIndex].some(name => source.relatedObjects.some(object => fold(object.name) === fold(name)))) throw Error('SQLite重建内部唯一索引名称已被原目录占用');
  const steps: SqliteTableRebuildStep[] = [
    { role: 'candidate-create', sql: candidate.candidateSql }, { role: 'candidate-index', sql: candidate.createOrdinalIndexSql },
    { role: 'original-copy', sql: copySql(source.target.table, names.candidate, names.ordinal, copied, source.rowIdentity, identity) },
    { role: 'verification-create', sql: verification.candidateSql }, { role: 'verification-index', sql: verification.createOrdinalIndexSql },
    { role: 'verification-copy', sql: copySql(names.candidate, names.verificationCandidate, names.verificationOrdinal, copied, identity, identity) },
    { role: 'ordinal-index-drop', sql: candidate.removeOrdinalSql[0] }, { role: 'ordinal-drop', sql: candidate.removeOrdinalSql[1] },
    { role: 'original-drop', sql: 'DROP TABLE main.' + q(source.target.table) }, { role: 'candidate-rename', sql: 'ALTER TABLE main.' + q(names.candidate) + ' RENAME TO ' + q(source.target.table) },
  ];
  for (const object of source.relatedObjects) if (object.type === 'index' && fold(object.table) === fold(source.target.table) && object.sql !== null) { assertIndexHeader(object.sql, object.name, source.target.table); steps.push({ role: 'restore-index', sql: object.sql }); }
  for (const object of source.relatedObjects) if (object.type === 'trigger' && fold(object.table) === fold(source.target.table)) { if (!object.sql) throw Error('SQLite原附属触发器SQL缺失'); const header = parseSqliteObjectsCreateHeader(object.sql); if (header.kind !== 'trigger' || header.name !== object.name) throw Error('SQLite原触发器CREATE头与准确目录不一致'); steps.push({ role: 'restore-trigger', sql: object.sql }); }
  steps.push({ role: 'verification-drop', sql: 'DROP TABLE main.' + q(names.verificationCandidate) });
  if (source.relatedObjects.some(object => object.type === 'table' && object.name === 'sqlite_sequence')) steps.push({ role: 'sequence-delete', sql: 'DELETE FROM main.sqlite_sequence WHERE name=?' }, { role: 'sequence-insert', sql: 'INSERT INTO main.sqlite_sequence(rowid,name,seq) SELECT ?,?,? WHERE ?' });
  const sql = steps.map(step => step.sql); if (steps.length > sqliteTableRebuildLimits.statements || new TextEncoder().encode(JSON.stringify(sql)).length > sqliteTableRebuildLimits.ddlBytes) throw Error('SQLite完整重建计划超过SQL预算');
  const changedTypes = changes.filter(change => change.declaredType !== undefined).length, changedDefaults = changes.filter(change => change.default !== undefined).length;
  return { names, changes, changedOrder: columnOrder !== undefined, ...(columnOrder ? { columnOrder } : {}), candidate, verification, candidateRowIdentity: identity, steps, sql, changedTypes, changedDefaults, losslessColumns: changes.filter(change => change.declaredType !== undefined && source.columns.find(column => fold(column.name) === fold(change.column))?.declaredType !== change.declaredType).map(change => source.columns.find(column => fold(column.name) === fold(change.column))!.name), warnings: ['本次将在独立事务中完整复制当前全部数据，并逐值核对精度、字节、生成列与真实行身份；不能无损转换时整批回滚。', '原索引、触发器、外键及视图定义保持；复制不执行原表的数据修改触发器。', '内部验证表仅用于核对移除序号前后及最终数据，提交前删除；自增序列保持原存在性与准确水位。', ...(columnOrder ? ['实际列顺序改变会影响 SELECT * 与未列出字段名的 INSERT 的位置语义；请核对应用、视图和触发器。'] : [])] };
}
