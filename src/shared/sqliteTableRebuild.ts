import { z } from 'zod';
import { sqliteTableCreateDefaultSchema, sqliteTableCreateColumnSchema } from './sqliteTableCreate';


/** 独立重建能力独立限额；目录全量超限即拒绝，不截断影响检查所需的定义。 */
export const sqliteTableRebuildLimits = { catalogues: 64, previews: 64, catalogueBytes: 64 * 1024 * 1024, previewBytes: 64 * 1024 * 1024, catalogueLifetimeMs: 5 * 60 * 1000, previewLifetimeMs: 5 * 60 * 1000, changes: 128, statements: 8192, columns: 1024, relatedObjects: 4096, ddlBytes: 2 * 1024 * 1024 } as const;
const encoder = new TextEncoder(), fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
const unicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const id = z.string().min(1).max(200).refine(value => unicode(value) && !value.includes('\0'));
const name = z.string().min(1).max(512).refine(value => unicode(value) && !value.includes('\0'));
const sqlText = z.string().max(sqliteTableRebuildLimits.ddlBytes).refine(value => unicode(value) && !value.includes('\0'));
export const sqliteTableRebuildTargetSchema = z.object({ connectionId: id, database: z.literal('main'), table: name }).strict();
export type SqliteTableRebuildTarget = z.infer<typeof sqliteTableRebuildTargetSchema>;

/** 深解析前计实际UTF8预算，拒访问器、循环及稀疏数组，避免先复制巨大目录。 */
function withinBudget(input: unknown): boolean {
  let bytes = 0; const active = new Set<object>();
  const add = (size: number) => (bytes += size) <= sqliteTableRebuildLimits.ddlBytes;
  const visit = (value: unknown, depth: number): boolean => {
    if (depth > 12) return false;
    if (typeof value === 'string') return value.length <= sqliteTableRebuildLimits.ddlBytes && add(encoder.encode(JSON.stringify(value)).length);
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return add(JSON.stringify(value).length);
    if (!value || typeof value !== 'object' || active.has(value)) return false;
    const array = Array.isArray(value); if (array ? Object.getPrototypeOf(value) !== Array.prototype || value.length > sqliteTableRebuildLimits.statements : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
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
const budget = z.unknown().superRefine((value, context) => { if (!withinBudget(value)) context.addIssue({ code: 'custom', message: 'SQLite表重建合同无效或超过2MiB UTF8预算' }); });
/** 仅允许类型/默认值补丁；空类型明确表示去掉声明，不能夹带任意SQL。 */
export const sqliteTableRebuildChangesSchema = budget.pipe(z.array(z.object({
  column: name,
  declaredType: z.union([z.literal(''), sqliteTableCreateColumnSchema.shape.declaredType]).optional(),
  default: sqliteTableCreateDefaultSchema.optional(),
}).strict().refine(change => change.declaredType !== undefined || change.default !== undefined, 'SQLite重建补丁缺少类型或默认值')).min(1).max(sqliteTableRebuildLimits.changes).superRefine((changes, context) => {
  if (new Set(changes.map(change => fold(change.column))).size !== changes.length) context.addIssue({ code: 'custom', message: 'SQLite重建补丁字段不能重复' });
}));
export type SqliteTableRebuildChange = z.infer<typeof sqliteTableRebuildChangesSchema>[number];
const rows = z.string().regex(/^(?:0|[1-9][0-9]{0,18})$/).refine(value => { try { return /^(?:0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n; } catch { return false; } }, 'SQLite行数超过有符号64位范围');
const signed = z.string().regex(/^(?:0|-?[1-9][0-9]{0,18})$/).refine(value => { try { const number = BigInt(value); return /^(?:0|-?[1-9][0-9]{0,18})$/.test(value) && number >= -9223372036854775808n && number <= 9223372036854775807n; } catch { return false; } });
export const sqliteTableRebuildInspectSchema = budget.pipe(z.object({ ...sqliteTableRebuildTargetSchema.shape, taskId: id }).strict());
export const sqliteTableRebuildInspectionSchema = budget.pipe(z.object({ catalogueId: id, target: sqliteTableRebuildTargetSchema,
  columns: z.array(z.object({ cid: z.number().int().min(0).max(2147483647), name, declaredType: z.string().max(4096).refine(unicode), notNull: z.boolean(), defaultSql: sqlText.nullable(), primaryKey: z.number().int().min(0).max(sqliteTableRebuildLimits.columns), hidden: z.number().int().min(0).max(3) }).strict()).min(1).max(sqliteTableRebuildLimits.columns),
  tableSql: sqlText,
  relatedObjects: z.array(z.object({ type: z.enum(['table', 'index', 'view', 'trigger']), name, table: name, sql: sqlText.nullable() }).strict()).max(sqliteTableRebuildLimits.relatedObjects),
  strict: z.boolean(), withoutRowid: z.boolean(), rowIdentity: z.discriminatedUnion('kind', [z.object({ kind: z.literal('rowid'), source: name }).strict(), z.object({ kind: z.literal('primary-key'), columns: z.array(name).min(1).max(sqliteTableRebuildLimits.columns) }).strict()]), sequence: z.object({ present: z.boolean(), value: signed.optional() }).strict().refine(value => value.present === (value.value !== undefined), 'SQLite序列存在性与准确值矛盾').optional(), readOnly: z.boolean(), expiresAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (value.withoutRowid !== (value.rowIdentity.kind === 'primary-key') || value.rowIdentity.kind === 'primary-key' && (new Set(value.rowIdentity.columns.map(fold)).size !== value.rowIdentity.columns.length || JSON.stringify(value.rowIdentity.columns) !== JSON.stringify(value.columns.filter(column => column.primaryKey > 0).sort((a, b) => a.primaryKey - b.primaryKey).map(column => column.name)))) context.addIssue({ code: 'custom', message: 'SQLite行身份与真实主键目录矛盾' });
  if (!value.tableSql.trim() || new Set(value.columns.map(column => fold(column.name))).size !== value.columns.length || new Set(value.columns.map(column => column.cid)).size !== value.columns.length || new Set(value.relatedObjects.map(object => object.type + ':' + fold(object.name))).size !== value.relatedObjects.length) context.addIssue({ code: 'custom', message: 'SQLite表重建目录名称、编号或定义重复/缺失' });
}));
export const sqliteTableRebuildPreviewSchema = budget.pipe(z.object({ catalogueId: id, changes: sqliteTableRebuildChangesSchema, taskId: id }).strict());
export const sqliteTableRebuildPreviewOutputSchema = budget.pipe(z.object({ previewId: id, catalogueId: id, target: sqliteTableRebuildTargetSchema, sql: z.array(sqlText.min(1)).min(1).max(sqliteTableRebuildLimits.statements), confirmation: z.string().min(1).max(1024), changedTypes: z.number().int().min(0).max(sqliteTableRebuildLimits.changes), changedDefaults: z.number().int().min(0).max(sqliteTableRebuildLimits.changes), warnings: z.array(z.string().min(1).max(4096).refine(unicode)).max(128), expiresAt: z.string().datetime() }).strict().superRefine((value, context) => { if (!value.changedTypes && !value.changedDefaults || value.confirmation !== 'main.' + value.target.table) context.addIssue({ code: 'custom', message: 'SQLite重建预览数量或准确确认目标矛盾' }); }));
export const sqliteTableRebuildApplySchema = budget.pipe(z.object({ previewId: id, taskId: id, confirmation: z.string().min(1).max(1024) }).strict());
export const sqliteTableRebuildReleaseSchema = budget.pipe(z.object({ catalogueId: id.optional(), previewId: id.optional() }).strict().refine(value => !!value.catalogueId || !!value.previewId, '缺少要释放的SQLite表重建能力'));
export type SqliteTableRebuildInspectInput = z.infer<typeof sqliteTableRebuildInspectSchema>;
export type SqliteTableRebuildInspectOutput = z.infer<typeof sqliteTableRebuildInspectionSchema>;
export type SqliteTableRebuildPreviewInput = z.infer<typeof sqliteTableRebuildPreviewSchema>;
export type SqliteTableRebuildPreviewOutput = z.infer<typeof sqliteTableRebuildPreviewOutputSchema>;
export type SqliteTableRebuildApplyInput = z.infer<typeof sqliteTableRebuildApplySchema>;
export type SqliteTableRebuildReleaseInput = z.infer<typeof sqliteTableRebuildReleaseSchema>;
export const sqliteTableRebuildFactSchema = budget.pipe(z.object({ operationId: id, target: sqliteTableRebuildTargetSchema, phase: z.enum(['not-sent', 'writing', 'commit-pending', 'committed', 'rolled-back', 'unknown']), requestedStatements: z.number().int().min(1).max(sqliteTableRebuildLimits.statements), completedStatements: z.number().int().min(0).max(sqliteTableRebuildLimits.statements), sourceRows: rows, copiedRows: rows, verifiedRows: rows, commitMayHaveBeenSent: z.boolean(), commitAcknowledged: z.boolean(), rollbackAcknowledged: z.boolean() }).strict().superRefine((fact, context) => {
  if (![fact.sourceRows, fact.copiedRows, fact.verifiedRows].every(value => rows.safeParse(value).success)) return;
  if (BigInt(fact.verifiedRows) > BigInt(fact.copiedRows) || BigInt(fact.copiedRows) > BigInt(fact.sourceRows) || fact.phase === 'not-sent' && [fact.sourceRows, fact.copiedRows, fact.verifiedRows].some(value => value !== '0') || ['commit-pending', 'committed'].includes(fact.phase) && (fact.sourceRows !== fact.copiedRows || fact.sourceRows !== fact.verifiedRows)) context.addIssue({ code: 'custom', message: 'SQLite重建复制核验数量或提交边界矛盾' });
  if (fact.completedStatements > fact.requestedStatements || fact.commitAcknowledged !== (fact.phase === 'committed') || fact.rollbackAcknowledged !== (fact.phase === 'rolled-back') || fact.commitAcknowledged && !fact.commitMayHaveBeenSent || ['commit-pending', 'committed'].includes(fact.phase) && (!fact.commitMayHaveBeenSent || fact.completedStatements !== fact.requestedStatements) || ['not-sent', 'writing'].includes(fact.phase) && fact.commitMayHaveBeenSent || fact.phase === 'not-sent' && fact.completedStatements !== 0) context.addIssue({ code: 'custom', message: 'SQLite表重建事务阶段、数量或确认事实矛盾' });
}));
export type SqliteTableRebuildFact = z.infer<typeof sqliteTableRebuildFactSchema>;
/** 持久化COMMIT前失败后的真实rollbackACK可收束maySent；已确认终态及计数不能倒退。 */
export function assertSqliteTableRebuildFactTransition(previous: SqliteTableRebuildFact, next: SqliteTableRebuildFact): void {
  const before = sqliteTableRebuildFactSchema.parse(previous), after = sqliteTableRebuildFactSchema.parse(next);
  const phases: Record<SqliteTableRebuildFact['phase'], readonly SqliteTableRebuildFact['phase'][]> = { 'not-sent': ['not-sent', 'writing', 'rolled-back', 'unknown'], writing: ['writing', 'commit-pending', 'rolled-back', 'unknown'], 'commit-pending': ['commit-pending', 'committed', 'rolled-back', 'unknown'], committed: ['committed'], 'rolled-back': ['rolled-back'], unknown: ['unknown', 'committed', 'rolled-back'] };
  if (before.operationId !== after.operationId || JSON.stringify(before.target) !== JSON.stringify(after.target) || before.requestedStatements !== after.requestedStatements || after.completedStatements < before.completedStatements || (['sourceRows', 'copiedRows', 'verifiedRows'] as const).some(key => BigInt(after[key]) < BigInt(before[key])) || before.commitMayHaveBeenSent && !after.commitMayHaveBeenSent && !after.rollbackAcknowledged || !phases[before.phase].includes(after.phase)) throw Error('SQLite表重建事务事实身份变化或倒退');
}
export const sqliteTableRebuildOutcomeSchema = budget.pipe(z.object({ operationId: id, target: sqliteTableRebuildTargetSchema, outcome: z.enum(['committed', 'rolled-back', 'not-sent', 'unknown']), fact: sqliteTableRebuildFactSchema, message: z.string().min(1).max(4096).refine(unicode), definitionVerified: z.boolean().optional(), cleanupWarning: z.boolean().optional() }).strict().superRefine((value, context) => { if (value.operationId !== value.fact.operationId || JSON.stringify(value.target) !== JSON.stringify(value.fact.target) || value.outcome !== value.fact.phase || value.definitionVerified && value.outcome !== 'committed') context.addIssue({ code: 'custom', message: 'SQLite表重建结果与原操作或确认事实矛盾' }); }));
export type SqliteTableRebuildOutcome = z.infer<typeof sqliteTableRebuildOutcomeSchema>;

export const sqliteTableRebuildMessages = { stale: 'SQLite重建目录、连接或预览已失效，请重新检查；不会自动重放。', readonly: 'SQLite连接为只读，不能重建表。', unknown: 'SQLite重建事务结果未知，请核对原表，禁止重复提交。', notSent: 'SQLite表重建尚未发送，原草稿保留。', running: '正在重建SQLite表；任务概要不保存字段、默认值、SQL或路径。', committed: 'SQLite重建事务已确认提交。', rolledBack: 'SQLite重建事务已确认整批回滚，草稿保留，未自动重试。' } as const;
