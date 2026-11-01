import { z } from 'zod';
import { buildSqliteTableCreateColumn, buildSqliteTableCreateDefault, sqliteTableCreateColumnSchema } from './sqliteTableCreate';
import type { SqliteTableCreateDefault } from './sqliteTableCreate';

/** 原生ALTER能力独立限额；目录全量超限即拒绝，不截断影响检查所需的定义。 */
export const sqliteColumnsLimits = { catalogues: 64, previews: 64, catalogueBytes: 64 * 1024 * 1024, previewBytes: 64 * 1024 * 1024, catalogueLifetimeMs: 5 * 60 * 1000, previewLifetimeMs: 5 * 60 * 1000, actions: 128, statements: 128, columns: 1024, relatedObjects: 4096, ddlBytes: 2 * 1024 * 1024 } as const;
const encoder = new TextEncoder(), fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
const unicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const id = z.string().min(1).max(200).refine(value => unicode(value) && !value.includes('\0'));
const name = z.string().min(1).max(512).refine(value => unicode(value) && !value.includes('\0'));
const sqlText = z.string().max(sqliteColumnsLimits.ddlBytes).refine(value => unicode(value) && !value.includes('\0'));
export const sqliteColumnsTargetSchema = z.object({ connectionId: id, database: z.literal('main'), table: name }).strict();
export type SqliteColumnsTarget = z.infer<typeof sqliteColumnsTargetSchema>;

/** 深解析前计实际UTF8预算，拒访问器、循环及稀疏数组，避免先复制巨大目录。 */
function withinBudget(input: unknown): boolean {
  let bytes = 0; const active = new Set<object>();
  const add = (size: number) => (bytes += size) <= sqliteColumnsLimits.ddlBytes;
  const visit = (value: unknown, depth: number): boolean => {
    if (depth > 12) return false;
    if (typeof value === 'string') return value.length <= sqliteColumnsLimits.ddlBytes && add(encoder.encode(JSON.stringify(value)).length);
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return add(JSON.stringify(value).length);
    if (!value || typeof value !== 'object' || active.has(value)) return false;
    const array = Array.isArray(value); if (array ? value.length > sqliteColumnsLimits.relatedObjects : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    active.add(value);
    try {
      if (!add(2)) return false; let count = 0; const keys = Reflect.ownKeys(value);
      if (array && keys.length !== value.length + 1) return false;
      for (const key of keys) {
        if (array && key === 'length') continue;
        const item = Object.getOwnPropertyDescriptor(value, key); if (typeof key !== 'string' || !item || !item.enumerable || !('value' in item)) return false;
        if (array && !/^(?:0|[1-9][0-9]*)$/.test(key)) return false;
        if (item.value === undefined && !array) continue;
        if (count++ && !add(1) || !array && !add(encoder.encode(JSON.stringify(key)).length + 1) || !visit(item.value, depth + 1)) return false;
      }
      return true;
    } finally { active.delete(value); }
  };
  try { return visit(input, 0); } catch { return false; }
}
const budget = z.unknown().superRefine((value, context) => { if (!withinBudget(value)) context.addIssue({ code: 'custom', message: 'SQLite字段合同无效或超过2MiB UTF8预算' }); });
const addColumn = sqliteTableCreateColumnSchema.superRefine((column, context) => {
  if (column.default.kind.startsWith('current-') || column.default.kind === 'text' && column.default.value.includes('\0')) context.addIssue({ code: 'custom', message: 'SQLite原生ADD COLUMN不支持时钟常量或含NUL的表达式默认值；不会替换原值或重建表' });
});
export const sqliteColumnsActionsSchema = budget.pipe(z.array(z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), column: addColumn }).strict(),
  z.object({ kind: z.literal('rename'), name, newName: sqliteTableCreateColumnSchema.shape.name }).strict(),
  z.object({ kind: z.literal('drop'), name }).strict(),
  z.object({ kind: z.literal('nullable'), name, nullable: z.boolean() }).strict(),
])).min(1).max(sqliteColumnsLimits.actions).superRefine((actions, context) => {
  // 一个动作可继续引用前步重命名结果；同一原字段的相同动作不能重复领取。
  const seen = new Set<string>();
  for (const action of actions) {
    const key = action.kind + ':' + fold(action.kind === 'add' ? action.column.name : action.name);
    if (seen.has(key) || action.kind === 'rename' && action.name === action.newName) context.addIssue({ code: 'custom', message: 'SQLite字段动作重复或重命名没有变化' }); seen.add(key);
  }
}));
export type SqliteColumnsAction = z.infer<typeof sqliteColumnsActionsSchema>[number];
export const sqliteColumnsInspectSchema = budget.pipe(z.object({ ...sqliteColumnsTargetSchema.shape, taskId: id }).strict());
export const sqliteColumnsInspectionSchema = budget.pipe(z.object({ catalogueId: id, target: sqliteColumnsTargetSchema,
  columns: z.array(z.object({ cid: z.number().int().min(0).max(2147483647), name, declaredType: z.string().max(4096).refine(unicode), notNull: z.boolean(), defaultSql: sqlText.nullable(), primaryKey: z.number().int().min(0).max(sqliteColumnsLimits.columns), hidden: z.number().int().min(0).max(3) }).strict()).min(1).max(sqliteColumnsLimits.columns),
  tableSql: sqlText,
  relatedObjects: z.array(z.object({ type: z.enum(['table', 'index', 'view', 'trigger']), name, table: name, sql: sqlText.nullable() }).strict()).max(sqliteColumnsLimits.relatedObjects),
  strict: z.boolean(), withoutRowid: z.boolean(), capabilities: z.object({ alterNullability: z.boolean() }).strict(), readOnly: z.boolean(), expiresAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (!value.tableSql.trim() || new Set(value.columns.map(column => fold(column.name))).size !== value.columns.length || new Set(value.columns.map(column => column.cid)).size !== value.columns.length || new Set(value.relatedObjects.map(object => object.type + ':' + fold(object.name))).size !== value.relatedObjects.length) context.addIssue({ code: 'custom', message: 'SQLite字段目录名称、编号或定义重复/缺失' });
}));
export const sqliteColumnsPreviewSchema = budget.pipe(z.object({ catalogueId: id, actions: sqliteColumnsActionsSchema, taskId: id }).strict());
export const sqliteColumnsPreviewOutputSchema = budget.pipe(z.object({ previewId: id, catalogueId: id, target: sqliteColumnsTargetSchema, sql: z.array(sqlText.min(1)).min(1).max(sqliteColumnsLimits.statements), confirmation: z.string().min(1).max(1024), added: z.number().int().min(0).max(sqliteColumnsLimits.actions), renamed: z.number().int().min(0).max(sqliteColumnsLimits.actions), removed: z.number().int().min(0).max(sqliteColumnsLimits.actions), nullabilityChanged: z.number().int().min(0).max(sqliteColumnsLimits.actions), expiresAt: z.string().datetime() }).strict().superRefine((value, context) => { if (value.sql.length !== value.added + value.renamed + value.removed + value.nullabilityChanged || value.confirmation !== 'main.' + value.target.table) context.addIssue({ code: 'custom', message: 'SQLite字段预览数量或准确确认目标矛盾' }); }));
export const sqliteColumnsApplySchema = budget.pipe(z.object({ previewId: id, taskId: id, confirmation: z.string().min(1).max(1024) }).strict());
export const sqliteColumnsReleaseSchema = budget.pipe(z.object({ catalogueId: id.optional(), previewId: id.optional() }).strict().refine(value => !!value.catalogueId || !!value.previewId, '缺少要释放的SQLite字段能力'));
export type SqliteColumnsInspectInput = z.infer<typeof sqliteColumnsInspectSchema>;
export type SqliteColumnsInspectOutput = z.infer<typeof sqliteColumnsInspectionSchema>;
export type SqliteColumnsPreviewInput = z.infer<typeof sqliteColumnsPreviewSchema>;
export type SqliteColumnsPreviewOutput = z.infer<typeof sqliteColumnsPreviewOutputSchema>;
export type SqliteColumnsApplyInput = z.infer<typeof sqliteColumnsApplySchema>;
export type SqliteColumnsReleaseInput = z.infer<typeof sqliteColumnsReleaseSchema>;
export const sqliteColumnsFactSchema = z.object({ operationId: id, target: sqliteColumnsTargetSchema, phase: z.enum(['not-sent', 'writing', 'commit-pending', 'committed', 'rolled-back', 'unknown']), requestedStatements: z.number().int().min(1).max(sqliteColumnsLimits.statements), completedStatements: z.number().int().min(0).max(sqliteColumnsLimits.statements), commitMayHaveBeenSent: z.boolean(), commitAcknowledged: z.boolean(), rollbackAcknowledged: z.boolean() }).strict().superRefine((fact, context) => {
  if (fact.completedStatements > fact.requestedStatements || fact.commitAcknowledged !== (fact.phase === 'committed') || fact.rollbackAcknowledged !== (fact.phase === 'rolled-back') || fact.commitAcknowledged && !fact.commitMayHaveBeenSent || ['commit-pending', 'committed'].includes(fact.phase) && (!fact.commitMayHaveBeenSent || fact.completedStatements !== fact.requestedStatements) || ['not-sent', 'writing'].includes(fact.phase) && fact.commitMayHaveBeenSent || fact.phase === 'not-sent' && fact.completedStatements !== 0) context.addIssue({ code: 'custom', message: 'SQLite字段事务阶段、数量或确认事实矛盾' });
});
export type SqliteColumnsFact = z.infer<typeof sqliteColumnsFactSchema>;
/** 持久化COMMIT前失败后的真实rollbackACK可收束maySent；已确认终态及计数不能倒退。 */
export function assertSqliteColumnsFactTransition(previous: SqliteColumnsFact, next: SqliteColumnsFact): void {
  const before = sqliteColumnsFactSchema.parse(previous), after = sqliteColumnsFactSchema.parse(next);
  const phases: Record<SqliteColumnsFact['phase'], readonly SqliteColumnsFact['phase'][]> = { 'not-sent': ['not-sent', 'writing', 'rolled-back', 'unknown'], writing: ['writing', 'commit-pending', 'rolled-back', 'unknown'], 'commit-pending': ['commit-pending', 'committed', 'rolled-back', 'unknown'], committed: ['committed'], 'rolled-back': ['rolled-back'], unknown: ['unknown', 'committed', 'rolled-back'] };
  if (before.operationId !== after.operationId || JSON.stringify(before.target) !== JSON.stringify(after.target) || before.requestedStatements !== after.requestedStatements || after.completedStatements < before.completedStatements || before.commitMayHaveBeenSent && !after.commitMayHaveBeenSent && !after.rollbackAcknowledged || !phases[before.phase].includes(after.phase)) throw Error('SQLite字段事务事实身份变化或倒退');
}
export const sqliteColumnsOutcomeSchema = budget.pipe(z.object({ operationId: id, target: sqliteColumnsTargetSchema, outcome: z.enum(['committed', 'rolled-back', 'not-sent', 'unknown']), fact: sqliteColumnsFactSchema, message: z.string().min(1).max(4096).refine(unicode), definitionVerified: z.boolean().optional(), cleanupWarning: z.boolean().optional() }).strict().superRefine((value, context) => { if (value.operationId !== value.fact.operationId || JSON.stringify(value.target) !== JSON.stringify(value.fact.target) || value.outcome !== value.fact.phase || value.definitionVerified && value.outcome !== 'committed') context.addIssue({ code: 'custom', message: 'SQLite字段结果与原操作或确认事实矛盾' }); }));
export type SqliteColumnsOutcome = z.infer<typeof sqliteColumnsOutcomeSchema>;

const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
/** 原默认值构造器单一复用；后验目录不能另拼一套数值或文本规则。 */
export function sqliteColumnsDefaultSql(value: SqliteTableCreateDefault): string | undefined { return buildSqliteTableCreateDefault(value); }
/** 每个动作恰好一条原生ALTER；目录、版本及约束由原运行时在独立事务内复核。 */
export function buildSqliteColumnsPlan(rawTarget: SqliteColumnsTarget, rawActions: readonly SqliteColumnsAction[]): { sql: string[] } {
  const target = sqliteColumnsTargetSchema.parse(rawTarget), actions = sqliteColumnsActionsSchema.parse(rawActions), prefix = 'ALTER TABLE main.' + quote(target.table), sql = actions.map(action => {
    switch (action.kind) {
      case 'add': return prefix + ' ADD COLUMN ' + buildSqliteTableCreateColumn(action.column);
      case 'rename': return prefix + ' RENAME COLUMN ' + quote(action.name) + ' TO ' + quote(action.newName);
      case 'drop': return prefix + ' DROP COLUMN ' + quote(action.name);
      case 'nullable': return prefix + ' ALTER COLUMN ' + quote(action.name) + (action.nullable ? ' DROP NOT NULL' : ' SET NOT NULL');
    }
  });
  if (sql.reduce((sum, value) => sum + encoder.encode(value).length, 0) > sqliteColumnsLimits.ddlBytes) throw Error('SQLite字段DDL超过2MiB预算');
  return { sql };
}
export const sqliteColumnsMessages = { stale: 'SQLite原字段目录、连接或预览已失效，请重新检查；不会自动重放。', readonly: 'SQLite连接为只读，不能修改字段。', unknown: 'SQLite字段事务结果未知，请核对原表，禁止重复提交。', notSent: 'SQLite字段修改尚未发送，原草稿保留。', running: '正在修改SQLite字段；任务概要不保存字段名、默认值、SQL或路径。', committed: 'SQLite字段事务已确认提交。', rolledBack: 'SQLite字段事务已确认整批回滚，草稿保留，未自动重试。' } as const;