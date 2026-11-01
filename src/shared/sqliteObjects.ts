import { z } from 'zod';

/** 视图和触发器定义只在原会话短期保存；完整目录超限不截断。 */
export const sqliteObjectsLimits = { catalogues: 64, previews: 64, catalogueBytes: 64 * 1024 * 1024, previewBytes: 64 * 1024 * 1024, catalogueLifetimeMs: 5 * 60 * 1000, previewLifetimeMs: 5 * 60 * 1000, statements: 4098, attachedTriggers: 4096, relatedObjects: 4096, eligibleRelations: 4096, ddlBytes: 2 * 1024 * 1024 } as const;
const encoder = new TextEncoder(), fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
const unicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const id = z.string().min(1).max(200).refine(value => unicode(value) && !value.includes('\0'));
const name = z.string().min(1).max(512).refine(value => unicode(value) && !value.includes('\0'));
const sqlText = z.string().max(sqliteObjectsLimits.ddlBytes).refine(value => unicode(value) && !value.includes('\0'));
export const sqliteObjectsKindSchema = z.enum(['view', 'trigger']);
export type SqliteObjectsKind = z.infer<typeof sqliteObjectsKindSchema>;
export const sqliteObjectsActionSchema = z.enum(['create', 'replace', 'drop']);
export type SqliteObjectsAction = z.infer<typeof sqliteObjectsActionSchema>;
export const sqliteObjectsTargetSchema = z.object({ connectionId: id, database: z.literal('main'), kind: sqliteObjectsKindSchema, name: name.refine(value => !/^sqlite_/i.test(value), 'SQLite系统对象不能管理定义') }).strict();
export type SqliteObjectsTarget = z.infer<typeof sqliteObjectsTargetSchema>;
export const sqliteObjectsAcknowledgementSchema = z.enum(['definition-effects', 'native-validation', 'dependent-objects', 'attached-view-triggers', 'drop-object']);
export type SqliteObjectsAcknowledgement = z.infer<typeof sqliteObjectsAcknowledgementSchema>;
const acknowledgements = z.array(sqliteObjectsAcknowledgementSchema).min(1).max(5).refine(value => new Set(value).size === value.length, 'SQLite对象风险确认不能重复');
const attachedTriggerSchema = z.object({ name, sql: sqlText.min(1) }).strict();

/** 深解析前计实际UTF8预算，拒访问器、循环及稀疏数组，避免先复制巨大目录。 */
function withinBudget(input: unknown): boolean {
  let bytes = 0; const active = new Set<object>();
  const add = (size: number) => (bytes += size) <= sqliteObjectsLimits.ddlBytes;
  const visit = (value: unknown, depth: number): boolean => {
    if (depth > 12) return false;
    if (typeof value === 'string') return value.length <= sqliteObjectsLimits.ddlBytes && add(encoder.encode(JSON.stringify(value)).length);
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return add(JSON.stringify(value).length);
    if (!value || typeof value !== 'object' || active.has(value)) return false;
    const array = Array.isArray(value); if (array ? value.length > Math.max(sqliteObjectsLimits.relatedObjects, sqliteObjectsLimits.statements) : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
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
const budget = z.unknown().superRefine((value, context) => { if (!withinBudget(value)) context.addIssue({ code: 'custom', message: 'SQLite对象定义合同无效或超过2MiB UTF8预算' }); });
export const sqliteObjectsInspectSchema = budget.pipe(z.object({ ...sqliteObjectsTargetSchema.shape, action: sqliteObjectsActionSchema, taskId: id }).strict());
export const sqliteObjectsInspectionSchema = budget.pipe(z.object({ catalogueId: id, target: sqliteObjectsTargetSchema, action: sqliteObjectsActionSchema, exists: z.boolean(), sourceSql: sqlText.nullable(),
  relatedObjects: z.array(z.object({ type: z.enum(['table', 'index', 'view', 'trigger']), name, table: name, sql: sqlText.nullable() }).strict()).max(sqliteObjectsLimits.relatedObjects),
  attachedTriggers: z.array(attachedTriggerSchema).max(sqliteObjectsLimits.attachedTriggers),
  eligibleRelations: z.array(z.object({ name, kind: z.enum(['table', 'view']) }).strict()).max(sqliteObjectsLimits.eligibleRelations),
  readOnly: z.boolean(), expiresAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (value.exists !== (value.action !== 'create') || value.exists !== (value.sourceSql !== null) || value.sourceSql !== null && !value.sourceSql.trim() || (value.target.kind !== 'view' || !value.exists) && value.attachedTriggers.length > 0 || new Set(value.attachedTriggers.map(trigger => fold(trigger.name))).size !== value.attachedTriggers.length || new Set(value.relatedObjects.map(object => object.type + ':' + fold(object.name))).size !== value.relatedObjects.length || new Set(value.eligibleRelations.map(relation => fold(relation.name))).size !== value.eligibleRelations.length) context.addIssue({ code: 'custom', message: 'SQLite对象目录的动作、原定义或关联对象重复/缺失' });
}));
export const sqliteObjectsPreviewSchema = budget.pipe(z.object({ catalogueId: id, sql: sqlText.min(1).optional(), taskId: id }).strict());
export const sqliteObjectsPreviewOutputSchema = budget.pipe(z.object({ previewId: id, catalogueId: id, target: sqliteObjectsTargetSchema, action: sqliteObjectsActionSchema, attachedTriggerCount: z.number().int().min(0).max(sqliteObjectsLimits.attachedTriggers), sql: z.array(sqlText.min(1)).min(1).max(sqliteObjectsLimits.statements), confirmation: z.string().min(1).max(1024), requiredAcknowledgements: acknowledgements, expiresAt: z.string().datetime() }).strict().superRefine((value, context) => {
  const invalidAttached = (value.target.kind !== 'view' || value.action === 'create') && value.attachedTriggerCount > 0, expected = value.action === 'replace' ? 2 + (value.target.kind === 'view' ? value.attachedTriggerCount : 0) : 1;
  if (invalidAttached || value.confirmation !== 'main.' + value.target.name || value.sql.length !== expected || JSON.stringify(value.requiredAcknowledgements) !== JSON.stringify(expectedAcknowledgements(value.target.kind, value.action, value.attachedTriggerCount))) context.addIssue({ code: 'custom', message: 'SQLite对象预览用途、准确目标、语句数或风险确认矛盾' });
}));
export const sqliteObjectsApplySchema = budget.pipe(z.object({ previewId: id, taskId: id, confirmation: z.string().min(1).max(1024), acknowledgements }).strict());
export const sqliteObjectsReleaseSchema = budget.pipe(z.object({ catalogueId: id.optional(), previewId: id.optional() }).strict().refine(value => !!value.catalogueId || !!value.previewId, '缺少要释放的SQLite对象能力'));
export type SqliteObjectsInspectInput = z.infer<typeof sqliteObjectsInspectSchema>;
export type SqliteObjectsInspectOutput = z.infer<typeof sqliteObjectsInspectionSchema>;
export type SqliteObjectsPreviewInput = z.infer<typeof sqliteObjectsPreviewSchema>;
export type SqliteObjectsPreviewOutput = z.infer<typeof sqliteObjectsPreviewOutputSchema>;
export type SqliteObjectsApplyInput = z.infer<typeof sqliteObjectsApplySchema>;
export type SqliteObjectsReleaseInput = z.infer<typeof sqliteObjectsReleaseSchema>;
export const sqliteObjectsFactSchema = z.object({ operationId: id, target: sqliteObjectsTargetSchema, action: sqliteObjectsActionSchema, phase: z.enum(['not-sent', 'writing', 'commit-pending', 'committed', 'rolled-back', 'unknown']), requestedStatements: z.number().int().min(1).max(sqliteObjectsLimits.statements), completedStatements: z.number().int().min(0).max(sqliteObjectsLimits.statements), commitMayHaveBeenSent: z.boolean(), commitAcknowledged: z.boolean(), rollbackAcknowledged: z.boolean() }).strict().superRefine((fact, context) => {
  if (fact.completedStatements > fact.requestedStatements || fact.action !== 'replace' && fact.requestedStatements !== 1 || fact.action === 'replace' && (fact.requestedStatements < 2 || fact.target.kind === 'trigger' && fact.requestedStatements !== 2) || fact.commitAcknowledged !== (fact.phase === 'committed') || fact.rollbackAcknowledged !== (fact.phase === 'rolled-back') || fact.commitAcknowledged && !fact.commitMayHaveBeenSent || ['commit-pending', 'committed'].includes(fact.phase) && (!fact.commitMayHaveBeenSent || fact.completedStatements !== fact.requestedStatements) || ['not-sent', 'writing'].includes(fact.phase) && fact.commitMayHaveBeenSent || fact.phase === 'not-sent' && fact.completedStatements !== 0) context.addIssue({ code: 'custom', message: 'SQLite对象事务阶段、动作、数量或确认事实矛盾' });
});
export type SqliteObjectsFact = z.infer<typeof sqliteObjectsFactSchema>;
/** 原目标、用途和语句计数不可偷换；只有真实ACK可收束原操作终态。 */
export function assertSqliteObjectsFactTransition(previous: SqliteObjectsFact, next: SqliteObjectsFact): void {
  const before = sqliteObjectsFactSchema.parse(previous), after = sqliteObjectsFactSchema.parse(next);
  const phases: Record<SqliteObjectsFact['phase'], readonly SqliteObjectsFact['phase'][]> = { 'not-sent': ['not-sent', 'writing', 'rolled-back', 'unknown'], writing: ['writing', 'commit-pending', 'rolled-back', 'unknown'], 'commit-pending': ['commit-pending', 'committed', 'rolled-back', 'unknown'], committed: ['committed'], 'rolled-back': ['rolled-back'], unknown: ['unknown', 'committed', 'rolled-back'] };
  if (before.operationId !== after.operationId || JSON.stringify(before.target) !== JSON.stringify(after.target) || before.action !== after.action || before.requestedStatements !== after.requestedStatements || after.completedStatements < before.completedStatements || before.commitMayHaveBeenSent && !after.commitMayHaveBeenSent && !after.rollbackAcknowledged || !phases[before.phase].includes(after.phase)) throw Error('SQLite对象事务事实身份、用途变化或阶段倒退');
}
export const sqliteObjectsOutcomeSchema = budget.pipe(z.object({ operationId: id, target: sqliteObjectsTargetSchema, action: sqliteObjectsActionSchema, outcome: z.enum(['committed', 'rolled-back', 'not-sent', 'unknown']), fact: sqliteObjectsFactSchema, message: z.string().min(1).max(4096).refine(unicode), definitionVerified: z.boolean().optional(), cleanupWarning: z.boolean().optional() }).strict().superRefine((value, context) => { if (value.operationId !== value.fact.operationId || JSON.stringify(value.target) !== JSON.stringify(value.fact.target) || value.action !== value.fact.action || value.outcome !== value.fact.phase || value.definitionVerified && value.outcome !== 'committed') context.addIssue({ code: 'custom', message: 'SQLite对象结果与原用途或确认事实矛盾' }); }));
export type SqliteObjectsOutcome = z.infer<typeof sqliteObjectsOutcomeSchema>;

interface HeaderToken { value: string; quoted: boolean; }
/** 只读有界CREATE头，理解原生注释和引用名称；不扫描ON/END，也不假装验证SQL正文。 */
export function parseSqliteObjectsCreateHeader(raw: string): { kind: SqliteObjectsKind; database: 'main'; name: string } {
  const sql = sqlText.min(1).parse(raw); let offset = 0;
  /** 单向跳过空白及原生非嵌套注释；块注释按SQLite规则可延伸至输入结尾。 */
  function skip(): void {
    while (offset < sql.length) {
      if (/[\t\n\v\f\r \uFEFF]/.test(sql[offset])) { offset++; continue; }
      if (sql.startsWith('--', offset)) { const end = sql.indexOf('\n', offset + 2); offset = end < 0 ? sql.length : end + 1; continue; }
      if (sql.startsWith('/*', offset)) { const end = sql.indexOf('*/', offset + 2); offset = end < 0 ? sql.length : end + 2; continue; }
      break;
    }
  }
  /** 只读前缀必要token；正文中的ON、END及字符串不参与对象身份判定。 */
  function token(): HeaderToken {
    skip(); if (offset >= sql.length) throw Error('SQLite CREATE头不完整');
    const first = sql[offset++];
    if (first === '"' || first === "'" || first === '\x60' || first === '[') {
      const close = first === '[' ? ']' : first; let value = '';
      while (offset < sql.length) { const character = sql[offset++]; if (character === close) { if (first !== '[' && sql[offset] === close) { value += close; offset++; continue; } return { value, quoted: true }; } value += character; if (value.length > 512) throw Error('SQLite CREATE头名称超过512字符'); }
      throw Error('SQLite CREATE头包含未结束引用名');
    }
    if (first === '.') throw Error('SQLite CREATE头缺少限定名称');
    if (!/[A-Za-z_\u0080-\uffff]/.test(first)) throw Error('SQLite CREATE头中的对象名称或关键字无效');
    const start = offset - 1; while (offset < sql.length && /[A-Za-z0-9_$\u0080-\uffff]/.test(sql[offset])) { offset++; if (offset - start > 512) throw Error('SQLite CREATE头名称超过512字符'); } return { value: sql.slice(start, offset), quoted: false };
  }
  const create = token(), kindToken = token();
  if (create.quoted || fold(create.value) !== 'create' || kindToken.quoted || !['view', 'trigger'].includes(fold(kindToken.value))) throw Error('只支持main中的单条CREATE VIEW或CREATE TRIGGER；TEMP、IF NOT EXISTS与EXPLAIN不受支持');
  const kind = fold(kindToken.value) as SqliteObjectsKind, firstName = token(); if (!firstName.quoted && fold(firstName.value) === 'if') throw Error('SQLite对象定义不接受IF NOT EXISTS');
  // 对象名后的正文由native prepare/authorizer确认；这里只读取可能存在的schema点号。
  let nameToken = firstName;
  skip(); if (sql[offset] === '.') { offset++; if (fold(firstName.value) !== 'main') throw Error('SQLite对象定义只允许main schema'); nameToken = token(); }
  const parsed = sqliteObjectsTargetSchema.parse({ connectionId: 'header-only', database: 'main', kind, name: nameToken.value }); return { kind, database: 'main', name: parsed.name };
}

const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
/** schema细化只推导固定项，不对已dirty字段重复parse并向safeParse外抛错。 */
function expectedAcknowledgements(kind: SqliteObjectsKind, action: SqliteObjectsAction, attachedTriggerCount: number): SqliteObjectsAcknowledgement[] {
  return ['definition-effects', ...(action !== 'drop' ? ['native-validation'] as const : []), ...(action !== 'create' ? ['dependent-objects'] as const : []), ...(action !== 'create' && kind === 'view' && attachedTriggerCount > 0 ? ['attached-view-triggers'] as const : []), ...(action === 'drop' ? ['drop-object'] as const : [])];
}
/** 风险确认由用途和原view附属触发器数量固定推导，不接受renderer删减。 */
export function getSqliteObjectsAcknowledgements(rawTarget: SqliteObjectsTarget, rawAction: SqliteObjectsAction, attachedTriggerCount = 0): SqliteObjectsAcknowledgement[] {
  const target = sqliteObjectsTargetSchema.parse(rawTarget), action = sqliteObjectsActionSchema.parse(rawAction); z.number().int().min(0).max(sqliteObjectsLimits.attachedTriggers).parse(attachedTriggerCount);
  if ((target.kind !== 'view' || action === 'create') && attachedTriggerCount) throw Error('只有view可以带附属触发器');
  return expectedAcknowledgements(target.kind, action, attachedTriggerCount);
}
/** 勾选顺序可变，但必须包含原预览的全部、唯一、已知确认项。 */
export function assertSqliteObjectsAcknowledgements(target: SqliteObjectsTarget, action: SqliteObjectsAction, attachedTriggerCount: number, raw: readonly SqliteObjectsAcknowledgement[]): void {
  const supplied = acknowledgements.parse(raw), required = getSqliteObjectsAcknowledgements(target, action, attachedTriggerCount);
  if (supplied.length !== required.length || required.some(value => !supplied.includes(value))) throw Error('请完成原SQLite对象预览中的全部风险确认；定义尚未发送');
}
/** CREATE原文保持逐字节；VIEW替换显式重建原触发器，正文仅在apply由native解析和原生授权核验。 */
export function buildSqliteObjectsPlan(rawTarget: SqliteObjectsTarget, rawAction: SqliteObjectsAction, rawSql?: string, rawAttached: readonly { name: string; sql: string }[] = []): { sql: string[]; requiredAcknowledgements: SqliteObjectsAcknowledgement[]; attachedTriggerCount: number } {
  budget.parse({ target: rawTarget, action: rawAction, sql: rawSql, attachedTriggers: rawAttached });
  const target = sqliteObjectsTargetSchema.parse(rawTarget), action = sqliteObjectsActionSchema.parse(rawAction), attached = z.array(attachedTriggerSchema).max(sqliteObjectsLimits.attachedTriggers).parse(rawAttached);
  if ((target.kind !== 'view' || action === 'create') && attached.length || new Set(attached.map(value => fold(value.name))).size !== attached.length) throw Error('SQLite原附属触发器数量或身份矛盾');
  const drop = 'DROP ' + target.kind.toUpperCase() + ' main.' + quote(target.name), requiredAcknowledgements = getSqliteObjectsAcknowledgements(target, action, attached.length);
  if (action === 'drop') { if (rawSql !== undefined) throw Error('SQLite删除对象不能携带额外SQL'); return { sql: [drop], requiredAcknowledgements, attachedTriggerCount: attached.length }; }
  const sql = sqlText.min(1).parse(rawSql), header = parseSqliteObjectsCreateHeader(sql);
  if (header.kind !== target.kind || header.name !== target.name) throw Error('SQLite CREATE头与原对象种类或准确名称不一致');
  if (action === 'replace') for (const trigger of attached) { const header = parseSqliteObjectsCreateHeader(trigger.sql); if (header.kind !== 'trigger' || header.name !== trigger.name) throw Error('SQLite原view附属触发器头与目录身份不一致'); }
  return { sql: action === 'create' ? [sql] : [drop, sql, ...attached.map(value => value.sql)], requiredAcknowledgements, attachedTriggerCount: attached.length };
}
export const sqliteObjectsMessages = { stale: 'SQLite原对象目录、连接或预览已失效，请重新检查；不会自动重放。', readonly: 'SQLite连接为只读，不能创建、修改或删除视图及触发器。', unknown: 'SQLite对象事务结果未知，请核对原对象和依赖，禁止重复提交。', notSent: 'SQLite对象定义尚未发送，原草稿保留。', running: '正在修改SQLite对象；任务概要不保存SQL、关联定义或路径。', committed: 'SQLite对象事务已确认提交；请核对保留依赖，不代表所有引用均有效。', rolledBack: 'SQLite对象事务已确认整批回滚，草稿保留，未自动重试。', invalid: '请先保存并授权准确main的SQLite文件连接及对象用途。', busyTarget: '同一SQLite文件的表页存在未提交数据、布局草稿或运行任务，请先处理。' } as const;
