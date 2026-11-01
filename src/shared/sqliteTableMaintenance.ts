import { z } from 'zod';

/** 清空与删除能力独立有界；完整目录超限拒绝，不截断影响确认所需的定义。 */
export const sqliteTableMaintenanceLimits = { catalogues: 64, previews: 64, catalogueBytes: 64 * 1024 * 1024, previewBytes: 64 * 1024 * 1024, catalogueLifetimeMs: 5 * 60 * 1000, previewLifetimeMs: 5 * 60 * 1000, statements: 2, columns: 1024, relatedObjects: 4096, foreignKeys: 10000, ddlBytes: 2 * 1024 * 1024 } as const;
const encoder = new TextEncoder(), fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
const unicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const id = z.string().min(1).max(200).refine(value => unicode(value) && !value.includes('\0'));
const name = z.string().min(1).max(512).refine(value => unicode(value) && !value.includes('\0'));
const sqlText = z.string().max(sqliteTableMaintenanceLimits.ddlBytes).refine(value => unicode(value) && !value.includes('\0'));
const count = z.string().max(19).refine(value => value.length <= 19 && /^(?:0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 9223372036854775807n, 'SQLite行数必须是无损非负int64十进制字符串');
export const sqliteTableMaintenanceTargetSchema = z.object({ connectionId: id, database: z.literal('main'), table: name }).strict();
export type SqliteTableMaintenanceTarget = z.infer<typeof sqliteTableMaintenanceTargetSchema>;
export const sqliteTableMaintenanceActionSchema = z.enum(['clear', 'drop']);
export type SqliteTableMaintenanceAction = z.infer<typeof sqliteTableMaintenanceActionSchema>;
export const sqliteTableMaintenanceAcknowledgementSchema = z.enum(['all-current-data', 'trigger-foreign-effects', 'drop-structure', 'retained-dependencies', 'reset-sequence']);
export type SqliteTableMaintenanceAcknowledgement = z.infer<typeof sqliteTableMaintenanceAcknowledgementSchema>;
const acknowledgements = z.array(sqliteTableMaintenanceAcknowledgementSchema).min(1).max(5).refine(value => new Set(value).size === value.length, 'SQLite表维护风险确认不能重复');

/** 深解析前计实际UTF8预算，拒访问器、循环及稀疏数组，避免先复制巨大目录。 */
function withinBudget(input: unknown): boolean {
  let bytes = 0; const active = new Set<object>();
  const add = (size: number) => (bytes += size) <= sqliteTableMaintenanceLimits.ddlBytes;
  const visit = (value: unknown, depth: number): boolean => {
    if (depth > 12) return false;
    if (typeof value === 'string') return value.length <= sqliteTableMaintenanceLimits.ddlBytes && add(encoder.encode(JSON.stringify(value)).length);
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return add(JSON.stringify(value).length);
    if (!value || typeof value !== 'object' || active.has(value)) return false;
    const array = Array.isArray(value); if (array ? value.length > Math.max(sqliteTableMaintenanceLimits.relatedObjects, sqliteTableMaintenanceLimits.foreignKeys) : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
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
const budget = z.unknown().superRefine((value, context) => { if (!withinBudget(value)) context.addIssue({ code: 'custom', message: 'SQLite表维护合同无效或超过2MiB UTF8预算' }); });
export const sqliteTableMaintenanceInspectSchema = budget.pipe(z.object({ ...sqliteTableMaintenanceTargetSchema.shape, taskId: id }).strict());
export const sqliteTableMaintenanceInspectionSchema = budget.pipe(z.object({ catalogueId: id, target: sqliteTableMaintenanceTargetSchema,
  columns: z.array(z.object({ cid: z.number().int().min(0).max(2147483647), name, declaredType: z.string().max(4096).refine(unicode), notNull: z.boolean(), defaultSql: sqlText.nullable(), primaryKey: z.number().int().min(0).max(sqliteTableMaintenanceLimits.columns), hidden: z.number().int().min(0).max(3) }).strict()).min(1).max(sqliteTableMaintenanceLimits.columns),
  tableSql: sqlText,
  relatedObjects: z.array(z.object({ type: z.enum(['table', 'index', 'view', 'trigger']), name, table: name, sql: sqlText.nullable() }).strict()).max(sqliteTableMaintenanceLimits.relatedObjects),
  foreignKeys: z.array(z.object({ table: name, id: z.number().int().min(0).max(2147483647), sequence: z.number().int().min(0).max(2147483647), parent: name, from: name, to: name.nullable(), onUpdate: z.string().min(1).max(100), onDelete: z.string().min(1).max(100), match: z.string().min(1).max(100) }).strict()).max(sqliteTableMaintenanceLimits.foreignKeys),
  strict: z.boolean(), withoutRowid: z.boolean(), autoIncrement: z.boolean(), rowCount: count, readOnly: z.boolean(), expiresAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (!value.tableSql.trim() || new Set(value.columns.map(column => fold(column.name))).size !== value.columns.length || new Set(value.columns.map(column => column.cid)).size !== value.columns.length || new Set(value.relatedObjects.map(object => object.type + ':' + fold(object.name))).size !== value.relatedObjects.length || new Set(value.foreignKeys.map(key => JSON.stringify([fold(key.table), key.id, key.sequence]))).size !== value.foreignKeys.length || value.autoIncrement && value.withoutRowid) context.addIssue({ code: 'custom', message: 'SQLite表维护目录、编号、定义或AUTOINCREMENT标记矛盾' });
}));
export const sqliteTableMaintenancePreviewSchema = budget.pipe(z.object({ catalogueId: id, action: sqliteTableMaintenanceActionSchema, resetSequence: z.boolean().default(false), taskId: id }).strict().superRefine((value, context) => { if (value.action === 'drop' && value.resetSequence) context.addIssue({ code: 'custom', message: 'SQLite删表不能附加自增重置动作' }); }));
export const sqliteTableMaintenancePreviewOutputSchema = budget.pipe(z.object({ previewId: id, catalogueId: id, target: sqliteTableMaintenanceTargetSchema, action: sqliteTableMaintenanceActionSchema, resetSequence: z.boolean(), sql: z.array(sqlText.min(1)).min(1).max(sqliteTableMaintenanceLimits.statements), confirmation: z.string().min(1).max(1024), rowCount: count, requiredAcknowledgements: acknowledgements, expiresAt: z.string().datetime() }).strict().superRefine((value, context) => {
  if (value.confirmation !== 'main.' + value.target.table || value.action === 'drop' && value.resetSequence || value.sql.length !== (value.resetSequence ? 2 : 1) || JSON.stringify(value.requiredAcknowledgements) !== JSON.stringify(getSqliteTableMaintenanceAcknowledgements(value.action, value.resetSequence))) context.addIssue({ code: 'custom', message: 'SQLite表维护预览动作、准确目标、语句数量或风险确认矛盾' });
}));
export const sqliteTableMaintenanceApplySchema = budget.pipe(z.object({ previewId: id, taskId: id, confirmation: z.string().min(1).max(1024), acknowledgements }).strict());
export const sqliteTableMaintenanceReleaseSchema = budget.pipe(z.object({ catalogueId: id.optional(), previewId: id.optional() }).strict().refine(value => !!value.catalogueId || !!value.previewId, '缺少要释放的SQLite表维护能力'));
export type SqliteTableMaintenanceInspectInput = z.infer<typeof sqliteTableMaintenanceInspectSchema>;
export type SqliteTableMaintenanceInspectOutput = z.infer<typeof sqliteTableMaintenanceInspectionSchema>;
export type SqliteTableMaintenancePreviewInput = z.infer<typeof sqliteTableMaintenancePreviewSchema>;
export type SqliteTableMaintenancePreviewOutput = z.infer<typeof sqliteTableMaintenancePreviewOutputSchema>;
export type SqliteTableMaintenanceApplyInput = z.infer<typeof sqliteTableMaintenanceApplySchema>;
export type SqliteTableMaintenanceReleaseInput = z.infer<typeof sqliteTableMaintenanceReleaseSchema>;
export const sqliteTableMaintenanceFactSchema = z.object({ operationId: id, target: sqliteTableMaintenanceTargetSchema, action: sqliteTableMaintenanceActionSchema, phase: z.enum(['not-sent', 'writing', 'commit-pending', 'committed', 'rolled-back', 'unknown']), requestedStatements: z.number().int().min(1).max(sqliteTableMaintenanceLimits.statements), completedStatements: z.number().int().min(0).max(sqliteTableMaintenanceLimits.statements), actualBeforeRows: count.optional(), commitMayHaveBeenSent: z.boolean(), commitAcknowledged: z.boolean(), rollbackAcknowledged: z.boolean() }).strict().superRefine((fact, context) => {
  if (fact.completedStatements > fact.requestedStatements || fact.action === 'drop' && fact.requestedStatements !== 1 || fact.commitAcknowledged !== (fact.phase === 'committed') || fact.rollbackAcknowledged !== (fact.phase === 'rolled-back') || fact.commitAcknowledged && !fact.commitMayHaveBeenSent || ['commit-pending', 'committed'].includes(fact.phase) && (!fact.commitMayHaveBeenSent || fact.completedStatements !== fact.requestedStatements || fact.actualBeforeRows === undefined) || ['not-sent', 'writing'].includes(fact.phase) && fact.commitMayHaveBeenSent || fact.completedStatements > 0 && fact.actualBeforeRows === undefined || fact.phase === 'not-sent' && (fact.completedStatements !== 0 || fact.actualBeforeRows !== undefined)) context.addIssue({ code: 'custom', message: 'SQLite表维护事务阶段、动作、实际行数或确认事实矛盾' });
});
export type SqliteTableMaintenanceFact = z.infer<typeof sqliteTableMaintenanceFactSchema>;
/** 原目标/动作/计数及锁内行数不能偷换；真实回滚ACK可收束COMMIT前持久化失败。 */
export function assertSqliteTableMaintenanceFactTransition(previous: SqliteTableMaintenanceFact, next: SqliteTableMaintenanceFact): void {
  const before = sqliteTableMaintenanceFactSchema.parse(previous), after = sqliteTableMaintenanceFactSchema.parse(next);
  const phases: Record<SqliteTableMaintenanceFact['phase'], readonly SqliteTableMaintenanceFact['phase'][]> = { 'not-sent': ['not-sent', 'writing', 'rolled-back', 'unknown'], writing: ['writing', 'commit-pending', 'rolled-back', 'unknown'], 'commit-pending': ['commit-pending', 'committed', 'rolled-back', 'unknown'], committed: ['committed'], 'rolled-back': ['rolled-back'], unknown: ['unknown', 'committed', 'rolled-back'] };
  if (before.operationId !== after.operationId || JSON.stringify(before.target) !== JSON.stringify(after.target) || before.action !== after.action || before.requestedStatements !== after.requestedStatements || after.completedStatements < before.completedStatements || before.actualBeforeRows !== undefined && after.actualBeforeRows !== before.actualBeforeRows || before.commitMayHaveBeenSent && !after.commitMayHaveBeenSent && !after.rollbackAcknowledged || !phases[before.phase].includes(after.phase)) throw Error('SQLite表维护事务事实身份、动作、行数变化或阶段倒退');
}
export const sqliteTableMaintenanceOutcomeSchema = budget.pipe(z.object({ operationId: id, target: sqliteTableMaintenanceTargetSchema, action: sqliteTableMaintenanceActionSchema, resetSequence: z.boolean(), outcome: z.enum(['committed', 'rolled-back', 'not-sent', 'unknown']), fact: sqliteTableMaintenanceFactSchema, message: z.string().min(1).max(4096).refine(unicode), definitionVerified: z.boolean().optional(), cleanupWarning: z.boolean().optional() }).strict().superRefine((value, context) => { if (value.operationId !== value.fact.operationId || JSON.stringify(value.target) !== JSON.stringify(value.fact.target) || value.action !== value.fact.action || value.action === 'drop' && value.resetSequence || value.fact.requestedStatements !== (value.resetSequence ? 2 : 1) || value.outcome !== value.fact.phase || value.definitionVerified && value.outcome !== 'committed') context.addIssue({ code: 'custom', message: 'SQLite表维护结果与原操作、动作或确认事实矛盾' }); }));
export type SqliteTableMaintenanceOutcome = z.infer<typeof sqliteTableMaintenanceOutcomeSchema>;

const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
/** 清空/删除必须确认全部当前数据和原生副作用；风险项固定，不能由输入缩减。 */
export function getSqliteTableMaintenanceAcknowledgements(rawAction: SqliteTableMaintenanceAction, resetSequence = false): SqliteTableMaintenanceAcknowledgement[] {
  const action = sqliteTableMaintenanceActionSchema.parse(rawAction); z.boolean().parse(resetSequence);
  if (action === 'drop' && resetSequence) throw Error('SQLite删表不能重置自增计数');
  return ['all-current-data', 'trigger-foreign-effects', ...(action === 'drop' ? ['drop-structure', 'retained-dependencies'] as const : []), ...(resetSequence ? ['reset-sequence'] as const : [])];
}
/** 公开确认允许不同勾选顺序，但必须完整、唯一且没有新增未知项。 */
export function assertSqliteTableMaintenanceAcknowledgements(action: SqliteTableMaintenanceAction, resetSequence: boolean, raw: readonly SqliteTableMaintenanceAcknowledgement[]): void {
  const supplied = acknowledgements.parse(raw), required = getSqliteTableMaintenanceAcknowledgements(action, resetSequence);
  if (supplied.length !== required.length || required.some(value => !supplied.includes(value))) throw Error('请完成准确预览中的全部风险确认；本次维护尚未发送');
}
/** 原生DELETE保留表结构；可选重置只绑定原表名，不把名称拼成SQL字面量或任意参数。 */
export function buildSqliteTableMaintenancePlan(rawTarget: SqliteTableMaintenanceTarget, action: SqliteTableMaintenanceAction, resetSequence = false): { sql: string[]; requiredAcknowledgements: SqliteTableMaintenanceAcknowledgement[] } {
  const target = sqliteTableMaintenanceTargetSchema.parse(rawTarget), requiredAcknowledgements = getSqliteTableMaintenanceAcknowledgements(action, resetSequence);
  if (/^sqlite_/i.test(target.table)) throw Error('SQLite系统表不能清空或删除');
  return { sql: action === 'clear' ? ['DELETE FROM main.' + quote(target.table), ...(resetSequence ? ['DELETE FROM main.sqlite_sequence WHERE name=?'] : [])] : ['DROP TABLE main.' + quote(target.table)], requiredAcknowledgements };
}
export const sqliteTableMaintenanceMessages = { stale: 'SQLite原表目录、连接或预览已失效，请重新检查；不会自动重放。', readonly: 'SQLite连接为只读，不能清空或删除表。', unknown: 'SQLite表维护事务结果未知，请核对原表和关联数据，禁止重复提交。', notSent: 'SQLite表维护尚未发送，原确认保留。', running: '正在执行SQLite表维护；任务概要不保存SQL、关联定义或路径。', committed: 'SQLite表维护事务已确认提交。', rolledBack: 'SQLite表维护事务已确认整批回滚，原确认保留，未自动重试。', invalid: '请先保存并授权准确main普通表的SQLite文件连接。', busyTarget: '同一SQLite文件的表页存在未提交数据、布局草稿或运行任务，请先处理。' } as const;
