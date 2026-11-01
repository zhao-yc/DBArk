import { z } from 'zod';

/** 重命名目录与预览独立限额；完整依赖目录超限即拒绝。 */
export const sqliteTableRenameLimits = { catalogues: 64, previews: 64, catalogueBytes: 64 * 1024 * 1024, previewBytes: 64 * 1024 * 1024, catalogueLifetimeMs: 5 * 60 * 1000, previewLifetimeMs: 5 * 60 * 1000, statements: 1, lineages: 64, columns: 1024, relatedObjects: 4096, ddlBytes: 2 * 1024 * 1024 } as const;
const encoder = new TextEncoder(), fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
const unicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const id = z.string().min(1).max(200).refine(value => unicode(value) && !value.includes('\0'));
const name = z.string().min(1).max(512).refine(value => unicode(value) && !value.includes('\0'));
const newName = name.refine(value => !/^sqlite_/i.test(value), 'SQLite保留sqlite_前缀，不能作为新表名');
const navigationIdentity = z.string().regex(/^[a-f0-9]{64}$/, 'SQLite重命名导航身份无效');
const sqlText = z.string().max(sqliteTableRenameLimits.ddlBytes).refine(value => unicode(value) && !value.includes('\0'));
export const sqliteTableRenameTargetSchema = z.object({ connectionId: id, database: z.literal('main'), table: name }).strict();
export type SqliteTableRenameTarget = z.infer<typeof sqliteTableRenameTargetSchema>;

/** 深解析前计实际UTF8预算，拒访问器、循环及稀疏数组，避免先复制巨大目录。 */
function withinBudget(input: unknown): boolean {
  let bytes = 0; const active = new Set<object>();
  const add = (size: number) => (bytes += size) <= sqliteTableRenameLimits.ddlBytes;
  const visit = (value: unknown, depth: number): boolean => {
    if (depth > 12) return false;
    if (typeof value === 'string') return value.length <= sqliteTableRenameLimits.ddlBytes && add(encoder.encode(JSON.stringify(value)).length);
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return add(JSON.stringify(value).length);
    if (!value || typeof value !== 'object' || active.has(value)) return false;
    const array = Array.isArray(value); if (array ? value.length > sqliteTableRenameLimits.relatedObjects : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
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
const budget = z.unknown().superRefine((value, context) => { if (!withinBudget(value)) context.addIssue({ code: 'custom', message: 'SQLite表重命名合同无效或超过2MiB UTF8预算' }); });
export const sqliteTableRenameInspectSchema = budget.pipe(z.object({ ...sqliteTableRenameTargetSchema.shape, taskId: id }).strict());
export const sqliteTableRenameInspectionSchema = budget.pipe(z.object({ catalogueId: id, navigationIdentity, target: sqliteTableRenameTargetSchema,
  columns: z.array(z.object({ cid: z.number().int().min(0).max(2147483647), name, declaredType: z.string().max(4096).refine(unicode), notNull: z.boolean(), defaultSql: sqlText.nullable(), primaryKey: z.number().int().min(0).max(sqliteTableRenameLimits.columns), hidden: z.number().int().min(0).max(3) }).strict()).min(1).max(sqliteTableRenameLimits.columns),
  tableSql: sqlText,
  relatedObjects: z.array(z.object({ type: z.enum(['table', 'index', 'view', 'trigger']), name, table: name, sql: sqlText.nullable() }).strict()).max(sqliteTableRenameLimits.relatedObjects),
  strict: z.boolean(), withoutRowid: z.boolean(), readOnly: z.boolean(), expiresAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (!value.tableSql.trim() || new Set(value.columns.map(column => fold(column.name))).size !== value.columns.length || new Set(value.columns.map(column => column.cid)).size !== value.columns.length || new Set(value.relatedObjects.map(object => object.type + ':' + fold(object.name))).size !== value.relatedObjects.length) context.addIssue({ code: 'custom', message: 'SQLite表重命名目录名称、编号或定义重复/缺失' });
}));
export const sqliteTableRenamePreviewSchema = budget.pipe(z.object({ catalogueId: id, newName, taskId: id }).strict());
export const sqliteTableRenamePreviewOutputSchema = budget.pipe(z.object({ previewId: id, catalogueId: id, navigationIdentity, target: sqliteTableRenameTargetSchema, newName, sql: z.array(sqlText.min(1)).length(1), confirmation: z.string().min(1).max(1024), expiresAt: z.string().datetime() }).strict().superRefine((value, context) => { if (value.confirmation !== 'main.' + value.target.table || value.newName === value.target.table) context.addIssue({ code: 'custom', message: 'SQLite表重命名预览的准确目标或新名矛盾' }); }));
export const sqliteTableRenameApplySchema = budget.pipe(z.object({ previewId: id, taskId: id, confirmation: z.string().min(1).max(1024) }).strict());
export const sqliteTableRenameReleaseSchema = budget.pipe(z.object({ catalogueId: id.optional(), previewId: id.optional() }).strict().refine(value => !!value.catalogueId || !!value.previewId, '缺少要释放的SQLite表重命名能力'));
export type SqliteTableRenameInspectInput = z.infer<typeof sqliteTableRenameInspectSchema>;
export type SqliteTableRenameInspectOutput = z.infer<typeof sqliteTableRenameInspectionSchema>;
export type SqliteTableRenamePreviewInput = z.infer<typeof sqliteTableRenamePreviewSchema>;
export type SqliteTableRenamePreviewOutput = z.infer<typeof sqliteTableRenamePreviewOutputSchema>;
export type SqliteTableRenameApplyInput = z.infer<typeof sqliteTableRenameApplySchema>;
export type SqliteTableRenameReleaseInput = z.infer<typeof sqliteTableRenameReleaseSchema>;
export const sqliteTableRenameFactSchema = z.object({ operationId: id, target: sqliteTableRenameTargetSchema, phase: z.enum(['not-sent', 'writing', 'commit-pending', 'committed', 'rolled-back', 'unknown']), requestedStatements: z.number().int().min(1).max(sqliteTableRenameLimits.statements), completedStatements: z.number().int().min(0).max(sqliteTableRenameLimits.statements), commitMayHaveBeenSent: z.boolean(), commitAcknowledged: z.boolean(), rollbackAcknowledged: z.boolean() }).strict().superRefine((fact, context) => {
  if (fact.completedStatements > fact.requestedStatements || fact.commitAcknowledged !== (fact.phase === 'committed') || fact.rollbackAcknowledged !== (fact.phase === 'rolled-back') || fact.commitAcknowledged && !fact.commitMayHaveBeenSent || ['commit-pending', 'committed'].includes(fact.phase) && (!fact.commitMayHaveBeenSent || fact.completedStatements !== fact.requestedStatements) || ['not-sent', 'writing'].includes(fact.phase) && fact.commitMayHaveBeenSent || fact.phase === 'not-sent' && fact.completedStatements !== 0) context.addIssue({ code: 'custom', message: 'SQLite表重命名事务阶段、数量或确认事实矛盾' });
});
export type SqliteTableRenameFact = z.infer<typeof sqliteTableRenameFactSchema>;
/** 持久化COMMIT前失败后的真实rollbackACK可收束maySent；已确认终态及计数不能倒退。 */
export function assertSqliteTableRenameFactTransition(previous: SqliteTableRenameFact, next: SqliteTableRenameFact): void {
  const before = sqliteTableRenameFactSchema.parse(previous), after = sqliteTableRenameFactSchema.parse(next);
  const phases: Record<SqliteTableRenameFact['phase'], readonly SqliteTableRenameFact['phase'][]> = { 'not-sent': ['not-sent', 'writing', 'rolled-back', 'unknown'], writing: ['writing', 'commit-pending', 'rolled-back', 'unknown'], 'commit-pending': ['commit-pending', 'committed', 'rolled-back', 'unknown'], committed: ['committed'], 'rolled-back': ['rolled-back'], unknown: ['unknown', 'committed', 'rolled-back'] };
  if (before.operationId !== after.operationId || JSON.stringify(before.target) !== JSON.stringify(after.target) || before.requestedStatements !== after.requestedStatements || after.completedStatements < before.completedStatements || before.commitMayHaveBeenSent && !after.commitMayHaveBeenSent && !after.rollbackAcknowledged || !phases[before.phase].includes(after.phase)) throw Error('SQLite表重命名事务事实身份变化或倒退');
}
export const sqliteTableRenameOutcomeSchema = budget.pipe(z.object({ operationId: id, target: sqliteTableRenameTargetSchema, newName, navigationIdentity, outcome: z.enum(['committed', 'rolled-back', 'not-sent', 'unknown']), fact: sqliteTableRenameFactSchema, message: z.string().min(1).max(4096).refine(unicode), definitionVerified: z.boolean().optional(), cleanupWarning: z.boolean().optional() }).strict().superRefine((value, context) => { if (value.operationId !== value.fact.operationId || JSON.stringify(value.target) !== JSON.stringify(value.fact.target) || value.outcome !== value.fact.phase || value.newName === value.target.table || value.definitionVerified && value.outcome !== 'committed') context.addIssue({ code: 'custom', message: 'SQLite表重命名结果与原操作或确认事实矛盾' }); }));
export type SqliteTableRenameOutcome = z.infer<typeof sqliteTableRenameOutcomeSchema>;

const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
/** 只构造一条原生重命名；依赖由SQLite原生改写，禁止文本替换定义。 */
export function buildSqliteTableRenamePlan(rawTarget: SqliteTableRenameTarget, rawName: string): { sql: string[] } {
  const target = sqliteTableRenameTargetSchema.parse(rawTarget), destination = newName.parse(rawName);
  if (/^sqlite_/i.test(target.table) || target.table === destination) throw Error('SQLite系统表不能重命名，或新表名没有变化');
  return { sql: ['ALTER TABLE main.' + quote(target.table) + ' RENAME TO ' + quote(destination)] };
}
export const sqliteTableRenameMessages = { stale: 'SQLite原表目录、连接或预览已失效，请重新检查；不会自动重放。', readonly: 'SQLite连接为只读，不能重命名表。', unknown: 'SQLite表重命名事务结果未知，请核对原表和新表，禁止重复提交。', notSent: 'SQLite表重命名尚未发送，原草稿保留。', running: '正在重命名SQLite表；任务概要不保存新表名、SQL或路径。', committed: 'SQLite表重命名事务已确认提交。', rolledBack: 'SQLite表重命名事务已确认整批回滚，草稿保留，未自动重试。', invalid: '请先保存并授权准确main普通表的SQLite文件连接。', busyTarget: '原表存在未提交修改或正在执行的任务，请先处理。' } as const;
