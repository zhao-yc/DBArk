import { z } from 'zod';

/** 可视化新建只生成有界DDL；不接收表达式、查询正文、文件路径或任意SQLite选项。 */
export const sqliteTableCreateLimits = { columns: 128, indexes: 32, foreignKeys: 32, parts: 32, nameCharacters: 255, typeCharacters: 128, valueBytes: 64 * 1024, designBytes: 2 * 1024 * 1024, inputBytes: 2 * 1024 * 1024, statements: 33, previews: 64, previewBytes: 64 * 1024 * 1024, previewLifetimeMs: 5 * 60 * 1000 } as const;
export const sqliteTableCreateActions = ['NO ACTION', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'CASCADE'] as const;
const encoder = new TextEncoder();
const unicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
/** SQLite名称只按ASCII折叠；不把不同Unicode列名误合并。 */
const fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
const identifier = z.string().min(1).max(510).refine(value => value.length <= 510 && unicode(value) && value.trim().length > 0 && [...value].length <= sqliteTableCreateLimits.nameCharacters && !/[\u0000-\u001f\u007f-\u009f]/u.test(value), 'SQLite名称须为1～255个有效字符，不能包含控制字符');
const objectName = identifier.refine(value => !fold(value).startsWith('sqlite_'), 'SQLite表或索引名不能使用sqlite_保留前缀');
const declaredType = z.string().min(1).max(256).refine(value => value.length <= 256 && unicode(value) && value.trim().length > 0 && [...value].length <= sqliteTableCreateLimits.typeCharacters && !/[\u0000-\u001f\u007f-\u009f]/u.test(value), 'SQLite声明类型须为1～128个有效字符，不能包含控制字符');
const id = z.string().min(1).max(200).refine(value => unicode(value) && !value.includes('\0'), 'SQLite新建标识无效');
const integer = z.string().min(1).max(20).regex(/^[+-]?[0-9]{1,19}$/).refine(value => {
  if (value.length > 20) return false;
  try { const number = BigInt(value); return number >= -9223372036854775808n && number <= 9223372036854775807n; } catch { return false; }
}, 'SQLite整数默认值必须在有符号64位范围内');
const real = z.string().min(1).max(128).regex(/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/).refine(value => Number.isFinite(Number(value)), 'SQLite实数默认值必须为有限数值');

/** 每种默认值独立严格分支；时钟常量不能夹带value或任意SQL表达式。 */
export const sqliteTableCreateDefaultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(), z.object({ kind: z.literal('null') }).strict(),
  z.object({ kind: z.literal('current-date') }).strict(), z.object({ kind: z.literal('current-time') }).strict(), z.object({ kind: z.literal('current-timestamp') }).strict(),
  z.object({ kind: z.literal('text'), value: z.string().max(sqliteTableCreateLimits.valueBytes).refine(value => value.length <= sqliteTableCreateLimits.valueBytes && unicode(value) && encoder.encode(value).length <= sqliteTableCreateLimits.valueBytes, 'SQLite文本默认值须为有效Unicode且不超过64KiB UTF8') }).strict(),
  z.object({ kind: z.literal('integer'), value: integer }).strict(), z.object({ kind: z.literal('real'), value: real }).strict(),
  z.object({ kind: z.literal('blob'), value: z.string().max(sqliteTableCreateLimits.valueBytes * 2).refine(value => value.length <= sqliteTableCreateLimits.valueBytes * 2 && value.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(value), 'SQLite二进制默认值须为不超过64KiB的完整Hex字节') }).strict(),
]);
export type SqliteTableCreateDefault = z.infer<typeof sqliteTableCreateDefaultSchema>;
/** 新建表和原生ADD共用受限列定义；调用方另行检查各ALTER动作的原生限制。 */
export const sqliteTableCreateColumnSchema = z.object({ name: identifier, declaredType, nullable: z.boolean(), default: sqliteTableCreateDefaultSchema, collation: z.enum(['BINARY', 'NOCASE', 'RTRIM']).optional() }).strict();
export type SqliteTableCreateColumn = z.infer<typeof sqliteTableCreateColumnSchema>;
const parts = z.array(identifier).min(1).max(sqliteTableCreateLimits.parts);
const designShape = z.object({
  name: objectName,
  columns: z.array(sqliteTableCreateColumnSchema).min(1).max(sqliteTableCreateLimits.columns),
  primaryKey: z.array(identifier).max(sqliteTableCreateLimits.parts), autoIncrement: z.boolean(),
  indexes: z.array(z.object({ name: objectName, unique: z.boolean(), columns: z.array(z.object({ name: identifier, order: z.enum(['asc', 'desc']) }).strict()).min(1).max(sqliteTableCreateLimits.parts) }).strict()).max(sqliteTableCreateLimits.indexes),
  foreignKeys: z.array(z.object({ name: identifier, columns: parts, referencedTable: identifier, referencedColumns: parts, onDelete: z.enum(sqliteTableCreateActions), onUpdate: z.enum(sqliteTableCreateActions), deferred: z.boolean() }).strict()).max(sqliteTableCreateLimits.foreignKeys),
  strict: z.boolean(), withoutRowid: z.boolean(),
}).strict().superRefine((design, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  const columns = new Map(design.columns.map(column => [fold(column.name), column]));
  if (columns.size !== design.columns.length) issue('SQLite列名不能按ASCII大小写重复');
  const checkParts = (names: string[], local: boolean) => { if (new Set(names.map(fold)).size !== names.length) issue('SQLite键的有序字段不能重复'); if (local && names.some(name => !columns.has(fold(name)))) issue('SQLite键引用了未设计的字段'); };
  checkParts(design.primaryKey, true);
  if (design.primaryKey.some(name => columns.get(fold(name))?.nullable)) issue('SQLite主键的全部字段必须明确非空');
  if (design.withoutRowid && !design.primaryKey.length) issue('WITHOUT ROWID必须设置主键');
  if (design.autoIncrement) {
    const column = design.primaryKey.length === 1 ? columns.get(fold(design.primaryKey[0])) : undefined;
    if (design.withoutRowid || !column || fold(column.declaredType) !== 'integer' || column.default.kind !== 'none') issue('AUTOINCREMENT只允许普通表的单个INTEGER主键且不能设置默认值');
  }
  if (design.strict && design.columns.some(column => !['int', 'integer', 'real', 'text', 'blob', 'any'].includes(fold(column.declaredType)))) issue('STRICT仅接受INT、INTEGER、REAL、TEXT、BLOB或ANY');
  const objects = [design.name, ...design.indexes.map(index => index.name)];
  if (new Set(objects.map(fold)).size !== objects.length) issue('SQLite表名和显式索引名不能按ASCII大小写重复');
  if (new Set(design.foreignKeys.map(key => fold(key.name))).size !== design.foreignKeys.length) issue('SQLite外键约束名不能按ASCII大小写重复');
  for (const index of design.indexes) checkParts(index.columns.map(column => column.name), true);
  for (const key of design.foreignKeys) {
    checkParts(key.columns, true); checkParts(key.referencedColumns, fold(key.referencedTable) === fold(design.name));
    if (key.columns.length !== key.referencedColumns.length) issue('SQLite外键与引用字段数量必须一致');
  }
});

/** 深解析前按实际JSON UTF8字节计预算；拒绝访问器/循环/异常对象，避免先复制巨大草稿。 */
function withinBudget(value: unknown): boolean {
  let bytes = 0; const active = new Set<object>();
  const add = (size: number) => { bytes += size; return bytes <= sqliteTableCreateLimits.inputBytes; };
  const visit = (item: unknown, depth: number): boolean => {
    if (depth > 32) return false;
    if (typeof item === 'string') return item.length <= sqliteTableCreateLimits.inputBytes && add(encoder.encode(JSON.stringify(item)).length);
    if (item === null || typeof item === 'boolean' || typeof item === 'number') return add(JSON.stringify(item).length);
    if (!item || typeof item !== 'object' || active.has(item)) return false;
    const array = Array.isArray(item); if (array ? item.length > sqliteTableCreateLimits.columns : ![Object.prototype, null].includes(Object.getPrototypeOf(item))) return false;
    active.add(item); let first = true;
    try {
      if (!add(2)) return false;
      const keys = Reflect.ownKeys(item); if (keys.length > (array ? sqliteTableCreateLimits.columns + 1 : 32)) return false;
      for (const key of keys) {
        if (array && key === 'length') continue; if (typeof key !== 'string') return false;
        const descriptor = Object.getOwnPropertyDescriptor(item, key); if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false;
        if (!array && descriptor.value === undefined) continue;
        if (!first && !add(1)) return false; first = false;
        if (!array && !add(encoder.encode(JSON.stringify(key)).length + 1)) return false;
        if (!visit(descriptor.value, depth + 1)) return false;
      }
      // 稀疏数组不是完整设计；不能把空洞误计为零字节。
      return !array || keys.length === item.length + 1;
    } finally { active.delete(item); }
  };
  try { return visit(value, 0); } catch { return false; }
}
const budget = z.unknown().superRefine((value, context) => { if (!withinBudget(value)) context.addIssue({ code: 'custom', message: 'SQLite新建草稿格式无效或超过2MiB UTF8预算' }); });
export const sqliteTableCreateDesignSchema = budget.pipe(designShape);
export type SqliteTableCreateDesign = z.infer<typeof sqliteTableCreateDesignSchema>;

const target = z.object({ connectionId: id, database: z.literal('main'), table: objectName }).strict();
export type SqliteTableCreateTarget = z.infer<typeof target>;
export const sqliteTableCreatePreviewSchema = budget.pipe(z.object({ connectionId: id, database: z.literal('main'), design: sqliteTableCreateDesignSchema, taskId: id }).strict());
export const sqliteTableCreateApplySchema = z.object({ previewId: id, taskId: id, confirmation: z.string().min(1).max(1024) }).strict();
export const sqliteTableCreateReleaseSchema = z.object({ previewId: id }).strict();
export type SqliteTableCreatePreviewInput = z.infer<typeof sqliteTableCreatePreviewSchema>;
export type SqliteTableCreateApplyInput = z.infer<typeof sqliteTableCreateApplySchema>;
export type SqliteTableCreateReleaseInput = z.infer<typeof sqliteTableCreateReleaseSchema>;
export interface SqliteTableCreatePreviewOutput { previewId: string; target: SqliteTableCreateTarget; expiresAt: string; confirmation: string; sql: string[]; warnings: string[]; }
export const sqliteTableCreateFactSchema = z.object({
  operationId: id, target, phase: z.enum(['not-sent', 'writing', 'commit-pending', 'committed', 'rolled-back', 'unknown']),
  requestedStatements: z.number().int().min(1).max(sqliteTableCreateLimits.statements), completedStatements: z.number().int().min(0).max(sqliteTableCreateLimits.statements),
  commitMayHaveBeenSent: z.boolean(), commitAcknowledged: z.boolean(), rollbackAcknowledged: z.boolean(),
}).strict().superRefine((fact, context) => {
  const issue = () => context.addIssue({ code: 'custom', message: 'SQLite新建表阶段、数量与提交/回滚确认事实矛盾' });
  if (fact.completedStatements > fact.requestedStatements || fact.commitAcknowledged && fact.rollbackAcknowledged) issue();
  if (fact.commitAcknowledged !== (fact.phase === 'committed') || fact.rollbackAcknowledged !== (fact.phase === 'rolled-back') || fact.commitAcknowledged && !fact.commitMayHaveBeenSent) issue();
  if (['commit-pending', 'committed'].includes(fact.phase) && (!fact.commitMayHaveBeenSent || fact.completedStatements !== fact.requestedStatements)) issue();
  if (['not-sent', 'writing'].includes(fact.phase) && fact.commitMayHaveBeenSent || fact.phase === 'not-sent' && fact.completedStatements !== 0) issue();
});
export type SqliteTableCreateFact = z.infer<typeof sqliteTableCreateFactSchema>;
export const sqliteTableCreateOutcomeSchema = z.object({ operationId: id, target, outcome: z.enum(['committed', 'rolled-back', 'not-sent', 'unknown']), fact: sqliteTableCreateFactSchema, message: z.string().min(1).max(4096).refine(unicode), definitionVerified: z.boolean(), cleanupWarning: z.boolean().optional() }).strict().superRefine((outcome, context) => {
  if (outcome.operationId !== outcome.fact.operationId || JSON.stringify(outcome.target) !== JSON.stringify(outcome.fact.target) || outcome.outcome !== outcome.fact.phase || outcome.definitionVerified && outcome.outcome !== 'committed') context.addIssue({ code: 'custom', message: 'SQLite新建表结果与原操作/目标/确认事实不一致' });
});
export type SqliteTableCreateOutcome = z.infer<typeof sqliteTableCreateOutcomeSchema>;
/** 原计数及ACK不能倒退；真实rollbackACK可收束尚未发送COMMIT的maySent，unknown可由后来ACK收束。 */
export function assertSqliteTableCreateFactTransition(previous: SqliteTableCreateFact, next: SqliteTableCreateFact): void {
  const before = sqliteTableCreateFactSchema.parse(previous), after = sqliteTableCreateFactSchema.parse(next);
  const transitions: Record<SqliteTableCreateFact['phase'], readonly SqliteTableCreateFact['phase'][]> = { 'not-sent': ['not-sent', 'writing', 'rolled-back', 'unknown'], writing: ['writing', 'commit-pending', 'rolled-back', 'unknown'], 'commit-pending': ['commit-pending', 'committed', 'rolled-back', 'unknown'], committed: ['committed'], 'rolled-back': ['rolled-back'], unknown: ['unknown', 'committed', 'rolled-back'] };
  if (before.operationId !== after.operationId || JSON.stringify(before.target) !== JSON.stringify(after.target) || before.requestedStatements !== after.requestedStatements || after.completedStatements < before.completedStatements || before.commitMayHaveBeenSent && !after.commitMayHaveBeenSent && !after.rollbackAcknowledged || before.commitAcknowledged && !after.commitAcknowledged || before.rollbackAcknowledged && !after.rollbackAcknowledged || !transitions[before.phase].includes(after.phase)) throw Error('SQLite新建表事实身份变化或发生倒退');
}

/** 双引号整体引用名称和声明类型，类型字符串永远不能扩展为DEFAULT/约束/第二条语句。 */
function quote(value: string): string { return '"' + value.replaceAll('"', '""') + '"'; }
/** char(0)遵守目标库编码；平衡拼接保留首尾/连续NUL，又不让长文本形成线性表达式深度。 */
function textDefault(value: string): string {
  const literal = (text: string) => "'" + text.replaceAll("'", "''") + "'";
  if (!value.includes('\0')) return literal(value);
  const terms: string[] = [];
  for (const [index, part] of value.split('\0').entries()) { if (index) terms.push('char(0)'); terms.push(literal(part)); }
  const join = (start: number, end: number): string => { if (end - start === 1) return terms[start]; const middle = start + Math.floor((end - start) / 2); return '(' + join(start, middle) + ' || ' + join(middle, end) + ')'; };
  return join(0, terms.length);
}
function defaultSql(value: SqliteTableCreateDefault): string | undefined {
  switch (value.kind) {
    case 'none': return undefined; case 'null': return 'NULL'; case 'current-date': return 'CURRENT_DATE'; case 'current-time': return 'CURRENT_TIME'; case 'current-timestamp': return 'CURRENT_TIMESTAMP';
    case 'text': return textDefault(value.value);
    case 'integer': return BigInt(value.value).toString(); case 'real': return /[.eE]/.test(value.value) ? value.value : value.value + '.0'; case 'blob': return "X'" + value.value + "'";
  }
}
/** 默认值仅由严格typed分支构造，不能传入任意SQL表达式。 */
export function buildSqliteTableCreateDefault(input: SqliteTableCreateDefault): string | undefined { return defaultSql(sqliteTableCreateDefaultSchema.parse(input)); }
/** 保持新建表既有引用及默认值字节语义，不加入主键或任何额外约束。 */
export function buildSqliteTableCreateColumn(input: SqliteTableCreateColumn): string {
  const column = sqliteTableCreateColumnSchema.parse(input), value = defaultSql(column.default);
  return `${quote(column.name)} ${quote(column.declaredType)}${column.nullable ? '' : ' NOT NULL'}${column.collation ? ' COLLATE ' + column.collation : ''}${value === undefined ? '' : ' DEFAULT ' + value}`;
}
/** 预览及运行时冲突检测共用准确计划名；不包含SQLite自动索引或任何隐含对象。 */
export function sqliteTableCreatePlannedNames(input: SqliteTableCreateDesign): { table: string; indexes: string[] } { const design = sqliteTableCreateDesignSchema.parse(input); return { table: design.name, indexes: design.indexes.map(index => index.name) }; }
/** 唯一DDL构造器；返回原执行SQL及SQLite去掉main限定后的精确sqlite_schema预期。 */
export function buildSqliteTableCreate(input: SqliteTableCreateDesign): { sql: string[]; storedSql: { type: 'table' | 'index'; name: string; sql: string }[] } {
  const design = sqliteTableCreateDesignSchema.parse(input), columns = new Map(design.columns.map(column => [fold(column.name), column.name]));
  const local = (name: string) => { const actual = columns.get(fold(name)); if (!actual) throw Error('SQLite设计字段已失效'); return quote(actual); };
  const entries = design.columns.map(column => buildSqliteTableCreateColumn(column) + (design.autoIncrement && fold(column.name) === fold(design.primaryKey[0]) ? ' PRIMARY KEY AUTOINCREMENT' : ''));
  if (!design.autoIncrement && design.primaryKey.length) entries.push('PRIMARY KEY (' + design.primaryKey.map(local).join(', ') + ')');
  for (const key of design.foreignKeys) entries.push(`CONSTRAINT ${quote(key.name)} FOREIGN KEY (${key.columns.map(local).join(', ')}) REFERENCES ${quote(key.referencedTable)} (${key.referencedColumns.map(name => fold(key.referencedTable) === fold(design.name) ? local(name) : quote(name)).join(', ')}) ON DELETE ${key.onDelete} ON UPDATE ${key.onUpdate}${key.deferred ? ' DEFERRABLE INITIALLY DEFERRED' : ''}`);
  const suffix = [design.strict ? 'STRICT' : '', design.withoutRowid ? 'WITHOUT ROWID' : ''].filter(Boolean).join(', '), body = `${quote(design.name)} (${entries.join(', ')})${suffix ? ' ' + suffix : ''}`;
  const sql = ['CREATE TABLE main.' + body], storedSql: { type: 'table' | 'index'; name: string; sql: string }[] = [{ type: 'table', name: design.name, sql: 'CREATE TABLE ' + body }];
  for (const index of design.indexes) { const prefix = index.unique ? 'CREATE UNIQUE INDEX ' : 'CREATE INDEX ', body = `${quote(index.name)} ON ${quote(design.name)} (${index.columns.map(column => local(column.name) + ' ' + column.order.toUpperCase()).join(', ')})`; sql.push(prefix + 'main.' + body); storedSql.push({ type: 'index', name: index.name, sql: prefix + body }); }
  return { sql, storedSql };
}
export const sqliteTableCreateMessages = { committed: 'SQLite新表事务已确认提交。', rolledBack: 'SQLite新表事务已确认整批回滚，设计保留，未自动重试。', unknown: 'SQLite新表提交结果未知，请核对原数据库，禁止重复提交。', notSent: 'SQLite新表尚未发送，原设计保留。', running: '正在创建SQLite表；任务概要不保存设计、SQL或文件路径。', stale: 'SQLite原连接、目录或预览已失效，请重新预览；不会自动重放。' } as const;
