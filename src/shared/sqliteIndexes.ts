import { z } from 'zod';

/** 查看原目录与DDL预览独立限额；128个动作也包含替换所需的DROP与CREATE两条。 */
export const sqliteIndexesLimits = { catalogues: 64, previews: 64, catalogueBytes: 64 * 1024 * 1024, previewBytes: 64 * 1024 * 1024, catalogueLifetimeMs: 5 * 60 * 1000, previewLifetimeMs: 5 * 60 * 1000, indexes: 128, keys: 64, actions: 128, statements: 128, columns: 1024, xinfo: 1088, collations: 256, ddlBytes: 2 * 1024 * 1024, expressionBytes: 64 * 1024 } as const;
const encoder = new TextEncoder(), fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
const unicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const id = z.string().min(1).max(200).refine(value => unicode(value) && !value.includes('\0'));
const name = z.string().min(1).max(512).refine(value => unicode(value) && !value.includes('\0'));
const indexName = name.refine(value => value.trim().length > 0 && [...value].length <= 255 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) && !fold(value).startsWith('sqlite_'), 'SQLite索引名须为1～255个有效字符，不能使用控制字符或sqlite_前缀');
export const sqliteIndexesTargetSchema = z.object({ connectionId: id, database: z.literal('main'), table: name }).strict();
export type SqliteIndexesTarget = z.infer<typeof sqliteIndexesTargetSchema>;

/** 先计量实际自有数据，拒绝getter、循环、稀疏数组及超过2MiB的深层克隆。 */
function withinBudget(input: unknown): boolean {
  let bytes = 0; const active = new Set<object>();
  const add = (value: number) => (bytes += value) <= sqliteIndexesLimits.ddlBytes;
  const visit = (value: unknown, depth: number): boolean => {
    if (depth > 12) return false;
    if (typeof value === 'string') return value.length <= sqliteIndexesLimits.ddlBytes && add(encoder.encode(JSON.stringify(value)).length);
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return add(JSON.stringify(value).length);
    if (!value || typeof value !== 'object' || active.has(value)) return false;
    const array = Array.isArray(value); if (array ? value.length > sqliteIndexesLimits.xinfo : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
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
const budget = z.unknown().superRefine((value, context) => { if (!withinBudget(value)) context.addIssue({ code: 'custom', message: 'SQLite索引合同无效或超过2MiB预算' }); });
interface Token { kind: 'word' | 'quoted' | 'string' | 'symbol'; value: string; start: number; end: number; depth: number; }
/** 仅做SQLite词法隔离，不执行表达式；引号内的分号/问号合法，外部参数及未闭合文字一律拒绝。 */
function lex(sql: string, ddl = false): Token[] {
  if (!unicode(sql) || sql.includes('\0')) throw Error('SQLite表达式包含无效Unicode或NUL');
  const result: Token[] = []; let index = 0, depth = 0;
  while (index < sql.length) {
    const start = index, character = sql[index], next = sql[index + 1];
    if (/[ \t\r\n\v\f]/.test(character)) { index++; continue; }
    if (character === '-' && next === '-') { index += 2; while (index < sql.length && sql[index] !== '\n') index++; continue; }
    if (character === '/' && next === '*') { const end = sql.indexOf('*/', index + 2); if (end < 0) throw Error('SQLite表达式注释未闭合'); index = end + 2; continue; }
    if (['\'', '"', '`', '['].includes(character)) {
      const closing = character === '[' ? ']' : character; let value = '', closed = false; index++;
      while (index < sql.length) { const part = sql[index++]; if (part === closing) { if (character !== '[' && sql[index] === closing) { value += closing; index++; } else { closed = true; break; } } else value += part; }
      if (!closed) throw Error('SQLite表达式引号未闭合'); result.push({ kind: character === '\'' ? 'string' : 'quoted', value, start, end: index, depth }); continue;
    }
    if ('?:@$'.includes(character) || character === ';' && !ddl) throw Error('SQLite表达式不能包含外部参数或语句分隔符');
    if (/[A-Za-z_]/.test(character) || character.charCodeAt(0) >= 0x80) {
      index++; while (index < sql.length && (/[A-Za-z0-9_$]/.test(sql[index]) || sql.charCodeAt(index) >= 0x80)) index++;
      result.push({ kind: 'word', value: sql.slice(start, index), start, end: index, depth }); continue;
    }
    if (character === ')') { if (--depth < 0) throw Error('SQLite表达式括号不平衡'); }
    result.push({ kind: 'symbol', value: character, start, end: ++index, depth });
    if (character === '(' && ++depth > 64) throw Error('SQLite表达式括号嵌套超过64层');
  }
  if (depth) throw Error('SQLite表达式括号不平衡'); return result;
}
const expression = z.string().min(1).max(sqliteIndexesLimits.expressionBytes).superRefine((value, context) => {
  try { if (encoder.encode(value).length > sqliteIndexesLimits.expressionBytes || !lex(value).length) throw Error(); }
  catch { context.addIssue({ code: 'custom', message: 'SQLite索引表达式须为64KiB内平衡单表达式，不能含外部参数或语句分隔符' }); }
});
export const sqliteIndexKeySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('column'), name, order: z.enum(['asc', 'desc']), collation: name.optional() }).strict(),
  z.object({ kind: z.literal('expression'), expression, order: z.enum(['asc', 'desc']), collation: name.optional() }).strict(),
]);
export type SqliteIndexesKey = z.infer<typeof sqliteIndexKeySchema>;
export const sqliteIndexDesignSchema = budget.pipe(z.object({ name: indexName, unique: z.boolean(), keys: z.array(sqliteIndexKeySchema).min(1).max(sqliteIndexesLimits.keys), where: expression.optional() }).strict());
export type SqliteIndexesDesign = z.infer<typeof sqliteIndexDesignSchema>;
export const sqliteIndexesActionsSchema = budget.pipe(z.array(z.discriminatedUnion('kind', [z.object({ kind: z.literal('create'), design: sqliteIndexDesignSchema }).strict(), z.object({ kind: z.literal('drop'), name: indexName }).strict()])).min(1).max(sqliteIndexesLimits.actions).superRefine((actions, context) => {
  const created = new Set<string>(), removed = new Set<string>();
  for (const action of actions) { const name = fold(action.kind === 'create' ? action.design.name : action.name), own = action.kind === 'create' ? created : removed; if (own.has(name) || action.kind === 'drop' && created.has(name)) context.addIssue({ code: 'custom', message: 'SQLite索引动作按ASCII大小写重复或顺序无效；替换须先删后建' }); own.add(name); }
}));
export type SqliteIndexesAction = z.infer<typeof sqliteIndexesActionsSchema>[number];
export const sqliteIndexesInspectSchema = budget.pipe(z.object({ ...sqliteIndexesTargetSchema.shape, taskId: id }).strict());
export const sqliteIndexesInspectionSchema = budget.pipe(z.object({ catalogueId: id, target: sqliteIndexesTargetSchema,
  columns: z.array(z.object({ name, declaredType: z.string().max(4096).refine(unicode) }).strict()).min(1).max(sqliteIndexesLimits.columns),
  indexes: z.array(z.object({ name, unique: z.boolean(), origin: z.enum(['c', 'u', 'pk']), partial: z.boolean(), sql: z.string().max(sqliteIndexesLimits.ddlBytes).refine(value => unicode(value) && !value.includes('\0')).nullable(), keys: z.array(z.object({ seqno: z.number().int().min(0).max(sqliteIndexesLimits.xinfo), cid: z.number().int().min(-2).max(2147483647), name: name.nullable(), desc: z.boolean(), collation: name.nullable(), key: z.boolean() }).strict()).max(sqliteIndexesLimits.xinfo) }).strict()).max(sqliteIndexesLimits.indexes),
  collations: z.array(name).min(1).max(sqliteIndexesLimits.collations), readOnly: z.boolean(), expiresAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (new Set(value.columns.map(column => fold(column.name))).size !== value.columns.length || new Set(value.indexes.map(index => fold(index.name))).size !== value.indexes.length || new Set(value.collations.map(fold)).size !== value.collations.length || value.indexes.some(index => new Set(index.keys.map(key => key.seqno)).size !== index.keys.length || index.origin !== 'c' && index.sql !== null)) context.addIssue({ code: 'custom', message: 'SQLite索引目录名称、键顺序或约束来源矛盾' });
}));
export const sqliteIndexesPreviewSchema = budget.pipe(z.object({ catalogueId: id, actions: sqliteIndexesActionsSchema, taskId: id }).strict());
export const sqliteIndexesPreviewOutputSchema = budget.pipe(z.object({ previewId: id, catalogueId: id, target: sqliteIndexesTargetSchema, sql: z.array(z.string().min(1).max(sqliteIndexesLimits.ddlBytes)).min(1).max(sqliteIndexesLimits.statements), confirmation: z.string().min(1).max(1024), added: z.number().int().min(0).max(sqliteIndexesLimits.actions), removed: z.number().int().min(0).max(sqliteIndexesLimits.actions), expiresAt: z.string().datetime() }).strict().superRefine((value, context) => { if (value.sql.length !== value.added + value.removed || value.confirmation !== 'main.' + value.target.table) context.addIssue({ code: 'custom', message: 'SQLite索引预览数量或准确确认目标矛盾' }); }));
export const sqliteIndexesApplySchema = budget.pipe(z.object({ previewId: id, taskId: id, confirmation: z.string().min(1).max(1024) }).strict());
export const sqliteIndexesReleaseSchema = budget.pipe(z.object({ catalogueId: id.optional(), previewId: id.optional() }).strict().refine(value => !!value.catalogueId || !!value.previewId, '缺少要释放的SQLite索引能力'));
export type SqliteIndexesInspectInput = z.infer<typeof sqliteIndexesInspectSchema>;
export type SqliteIndexesInspectOutput = z.infer<typeof sqliteIndexesInspectionSchema>;
export type SqliteIndexesPreviewInput = z.infer<typeof sqliteIndexesPreviewSchema>;
export type SqliteIndexesPreviewOutput = z.infer<typeof sqliteIndexesPreviewOutputSchema>;
export type SqliteIndexesApplyInput = z.infer<typeof sqliteIndexesApplySchema>;
export type SqliteIndexesReleaseInput = z.infer<typeof sqliteIndexesReleaseSchema>;
export const sqliteIndexesFactSchema = z.object({ operationId: id, target: sqliteIndexesTargetSchema, phase: z.enum(['not-sent', 'writing', 'commit-pending', 'committed', 'rolled-back', 'unknown']), requestedStatements: z.number().int().min(1).max(sqliteIndexesLimits.statements), completedStatements: z.number().int().min(0).max(sqliteIndexesLimits.statements), commitMayHaveBeenSent: z.boolean(), commitAcknowledged: z.boolean(), rollbackAcknowledged: z.boolean() }).strict().superRefine((fact, context) => {
  if (fact.completedStatements > fact.requestedStatements || fact.commitAcknowledged !== (fact.phase === 'committed') || fact.rollbackAcknowledged !== (fact.phase === 'rolled-back') || fact.commitAcknowledged && !fact.commitMayHaveBeenSent || ['commit-pending', 'committed'].includes(fact.phase) && (!fact.commitMayHaveBeenSent || fact.completedStatements !== fact.requestedStatements) || ['not-sent', 'writing'].includes(fact.phase) && fact.commitMayHaveBeenSent || fact.phase === 'not-sent' && fact.completedStatements !== 0) context.addIssue({ code: 'custom', message: 'SQLite索引事务阶段、数量或确认事实矛盾' });
});
export type SqliteIndexesFact = z.infer<typeof sqliteIndexesFactSchema>;
/** 持久化COMMIT前失败后的真实rollbackACK可收束maySent；已确认终态及计数不能倒退。 */
export function assertSqliteIndexesFactTransition(previous: SqliteIndexesFact, next: SqliteIndexesFact): void {
  const before = sqliteIndexesFactSchema.parse(previous), after = sqliteIndexesFactSchema.parse(next);
  const phases: Record<SqliteIndexesFact['phase'], readonly SqliteIndexesFact['phase'][]> = { 'not-sent': ['not-sent', 'writing', 'rolled-back', 'unknown'], writing: ['writing', 'commit-pending', 'rolled-back', 'unknown'], 'commit-pending': ['commit-pending', 'committed', 'rolled-back', 'unknown'], committed: ['committed'], 'rolled-back': ['rolled-back'], unknown: ['unknown', 'committed', 'rolled-back'] };
  if (before.operationId !== after.operationId || JSON.stringify(before.target) !== JSON.stringify(after.target) || before.requestedStatements !== after.requestedStatements || after.completedStatements < before.completedStatements || before.commitMayHaveBeenSent && !after.commitMayHaveBeenSent && !after.rollbackAcknowledged || !phases[before.phase].includes(after.phase)) throw Error('SQLite索引事务事实身份变化或倒退');
}
export const sqliteIndexesOutcomeSchema = budget.pipe(z.object({ operationId: id, target: sqliteIndexesTargetSchema, outcome: z.enum(['committed', 'rolled-back', 'not-sent', 'unknown']), fact: sqliteIndexesFactSchema, message: z.string().min(1).max(4096).refine(unicode), definitionVerified: z.boolean().optional(), cleanupWarning: z.boolean().optional() }).strict().superRefine((value, context) => { if (value.operationId !== value.fact.operationId || JSON.stringify(value.target) !== JSON.stringify(value.fact.target) || value.outcome !== value.fact.phase || value.definitionVerified && value.outcome !== 'committed') context.addIssue({ code: 'custom', message: 'SQLite索引结果与原操作或确认事实矛盾' }); }));
export type SqliteIndexesOutcome = z.infer<typeof sqliteIndexesOutcomeSchema>;
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
/** 两侧换行终止原行注释，额外括号隔离键表达式和WHERE，不让其逃逸为另一DDL片段。 */
const isolated = (value: string) => '(\n' + value + '\n)';
export function buildSqliteIndexesPlan(rawTarget: SqliteIndexesTarget, rawActions: readonly SqliteIndexesAction[]): { sql: string[]; storedSql: { name: string; sql: string }[]; removed: string[] } {
  const target = sqliteIndexesTargetSchema.parse(rawTarget), actions = sqliteIndexesActionsSchema.parse(rawActions), sql: string[] = [], storedSql: { name: string; sql: string }[] = [], removed: string[] = [];
  for (const action of actions) {
    if (action.kind === 'drop') { sql.push('DROP INDEX main.' + quote(action.name)); removed.push(action.name); continue; }
    const design = action.design; if (fold(design.name) === fold(target.table)) throw Error('SQLite索引名不能与原表名相同');
    const prefix = design.unique ? 'CREATE UNIQUE INDEX ' : 'CREATE INDEX ', body = quote(design.name) + ' ON ' + quote(target.table) + ' (' + design.keys.map(key => (key.kind === 'column' ? quote(key.name) : isolated(key.expression)) + (key.collation === undefined ? '' : ' COLLATE ' + quote(key.collation)) + ' ' + key.order.toUpperCase()).join(', ') + ')' + (design.where === undefined ? '' : ' WHERE ' + isolated(design.where));
    sql.push(prefix + 'main.' + body); storedSql.push({ name: design.name, sql: prefix + body });
  }
  if (sql.reduce((sum, value) => sum + encoder.encode(value).length, 0) > sqliteIndexesLimits.ddlBytes) throw Error('SQLite索引DDL超过2MiB预算'); return { sql, storedSql, removed };
}

/** 仅恢复已理解的原SQLite CREATE INDEX；无法无损识别时返回undefined，调用方必须保留原SQL。 */
export function parseSqliteIndexDesign(sql: string, columns: readonly { name: string }[]): SqliteIndexesDesign | undefined {
  try {
    if (typeof sql !== 'string' || sql.length > sqliteIndexesLimits.ddlBytes || encoder.encode(sql).length > sqliteIndexesLimits.ddlBytes || !Array.isArray(columns) || columns.length > sqliteIndexesLimits.columns || !withinBudget(columns)) return;
    const tokens = lex(sql, true); if (tokens.at(-1)?.kind === 'symbol' && tokens.at(-1)?.value === ';') tokens.pop(); if (tokens.some(token => token.value === ';' && token.kind === 'symbol')) return;
    let at = 0; const word = (value: string) => tokens[at]?.kind === 'word' && tokens[at].value.toUpperCase() === value;
    const takeWord = (value: string) => { if (!word(value)) throw Error(); at++; };
    const takeName = () => { const token = tokens[at++]; if (!token || !['word', 'quoted'].includes(token.kind)) throw Error(); return token.value; };
    takeWord('CREATE'); const unique = word('UNIQUE'); if (unique) at++; takeWord('INDEX'); if (word('IF')) { at++; takeWord('NOT'); takeWord('EXISTS'); }
    let index = takeName(); if (tokens[at]?.value === '.') { if (fold(index) !== 'main') return; at++; index = takeName(); }
    takeWord('ON'); takeName(); if (tokens[at]?.value !== '(') return; const opening = tokens[at++], start = at, groups: Token[][] = []; let boundary = start;
    while (at < tokens.length && !(tokens[at].kind === 'symbol' && tokens[at].value === ')' && tokens[at].depth === opening.depth)) { if (tokens[at].kind === 'symbol' && tokens[at].value === ',' && tokens[at].depth === opening.depth + 1) { groups.push(tokens.slice(boundary, at)); boundary = at + 1; } at++; }
    if (at === tokens.length) return; groups.push(tokens.slice(boundary, at)); at++;
    const actual = new Map(columns.map(column => [fold(name.parse(column.name)), column.name])); if (actual.size !== columns.length) return;
    const keys: SqliteIndexesDesign['keys'] = groups.map((parts): SqliteIndexesDesign['keys'][number] => {
      const first = parts[0]; if (!first) throw Error(); const depth = first.depth; let order: 'asc' | 'desc' = 'asc', collation: string | undefined;
      // ASC/DESC也可能是真实字段或COLLATE名称；右操作数尚未出现时不能误删原表达式尾词。
      const last = parts.at(-1), previous = parts.at(-2), operandRequired = previous && (previous.kind === 'symbol' && !/^[0-9)]$/.test(previous.value) || previous.kind === 'word' && ['COLLATE', 'AND', 'OR', 'NOT', 'IS', 'IN', 'LIKE', 'GLOB', 'MATCH', 'REGEXP', 'BETWEEN', 'THEN', 'ELSE', 'WHEN', 'ESCAPE'].includes(previous.value.toUpperCase()));
      if (parts.length > 1 && !operandRequired && last?.kind === 'word' && last.depth === depth && ['ASC', 'DESC'].includes(last.value.toUpperCase())) { order = last.value.toLowerCase() as 'asc' | 'desc'; parts = parts.slice(0, -1); }
      const marker = parts.at(-2), collate = parts.at(-1);
      if (marker?.kind === 'word' && marker.depth === depth && marker.value.toUpperCase() === 'COLLATE' && collate && collate.depth === depth && ['word', 'quoted'].includes(collate.kind)) {
        const body = parts.slice(0, -2), simple = body.length === 1 && ['word', 'quoted'].includes(body[0].kind), grouped = body[0]?.kind === 'symbol' && body[0].value === '(' && body.at(-1)?.kind === 'symbol' && body.at(-1)?.value === ')' && body.slice(1, -1).every(token => token.depth > depth), call = body[0]?.kind === 'word' && body[1]?.kind === 'symbol' && body[1]?.value === '(' && body.at(-1)?.value === ')' && body.slice(2, -1).every(token => token.depth > depth);
        // 复合expr的末尾COLLATE可能只绑定右操作数；保留原完整片段避免更改优先级。
        if (simple || grouped || call) { collation = collate.value; parts = body; }
      }
      if (!parts.length) throw Error(); const sole = parts.length === 1 && ['word', 'quoted'].includes(parts[0].kind) ? actual.get(fold(parts[0].value)) : undefined;
      return sole ? { kind: 'column', name: sole, order, ...(collation === undefined ? {} : { collation }) } : { kind: 'expression', expression: sql.slice(parts[0].start, parts.at(-1)!.end), order, ...(collation === undefined ? {} : { collation }) };
    });
    let where: string | undefined; if (word('WHERE')) { at++; if (!tokens[at]) return; where = sql.slice(tokens[at].start, tokens.at(-1)!.end); at = tokens.length; } if (at !== tokens.length) return;
    return sqliteIndexDesignSchema.parse({ name: index, unique, keys, ...(where === undefined ? {} : { where }) });
  } catch { return; }
}
export const sqliteIndexesMessages = { stale: 'SQLite原索引目录、连接或预览已失效，请重新检查，不会自动重放。', readonly: 'SQLite连接为只读，不能提交索引修改。', running: '正在处理SQLite索引事务；概要不保存表达式、SQL、原值或路径。', committed: 'SQLite索引事务已确认提交。', rolledBack: 'SQLite索引事务已确认整批回滚；不会自动重试。', unknown: 'SQLite索引提交结果未知，请核对原表，禁止重复提交。', notSent: 'SQLite索引修改尚未发送；原设计保留。' } as const;
