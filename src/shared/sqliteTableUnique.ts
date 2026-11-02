import { z } from 'zod';

/** UNIQUE声明独立于显式索引；结构模型只生成声明，不签发数据库写能力。 */
export const sqliteTableUniqueLimits = { edits: 128, keys: 1024, parts: 1024, bytes: 2 * 1024 * 1024 } as const;
export const sqliteUniqueConflicts = ['ROLLBACK', 'ABORT', 'FAIL', 'IGNORE', 'REPLACE'] as const;
const encoder = new TextEncoder(), fold = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
const unicode = (value: string) => !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const name = z.string().min(1).max(512).refine(unicode, 'SQLite唯一约束名称须为有效Unicode且不能包含NUL');

/** 在Zod读取之前核对全部自有数据属性及序列化UTF8预算，拒绝getter、循环和稀疏数组。 */
function withinBudget(input: unknown): boolean {
  let bytes = 0; const active = new Set<object>();
  function take(count: number): boolean { bytes += count; return bytes <= sqliteTableUniqueLimits.bytes; }
  function visit(value: unknown, depth: number): boolean {
    if (depth > 7) return false;
    if (typeof value === 'string') return value.length <= sqliteTableUniqueLimits.bytes && take(encoder.encode(JSON.stringify(value)).length);
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return take(JSON.stringify(value).length);
    if (!value || typeof value !== 'object' || active.has(value)) return false;
    const array = Array.isArray(value), keys = Reflect.ownKeys(value);
    if (array ? Object.getPrototypeOf(value) !== Array.prototype || value.length > sqliteTableUniqueLimits.parts || keys.length !== value.length + 1 : ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || keys.length > 8) return false;
    active.add(value);
    try {
      if (!take(2)) return false; let count = 0;
      for (const key of keys) {
        if (array && key === 'length') continue; const property = Object.getOwnPropertyDescriptor(value, key);
        if (typeof key !== 'string' || array && !/^(?:0|[1-9][0-9]*)$/.test(key) || !property?.enumerable || !('value' in property)) return false;
        if (count++ && !take(1) || !array && !take(encoder.encode(JSON.stringify(key)).length + 1) || !visit(property.value, depth + 1)) return false;
      }
      return true;
    } finally { active.delete(value); }
  }
  try { return visit(input, 0); } catch { return false; }
}
const budget = z.unknown().superRefine((value, context) => { if (!withinBudget(value)) context.addIssue({ code: 'custom', message: 'SQLite唯一约束结构无效或超过2MiB UTF8预算' }); });
const definition = z.object({
  name: name.nullable(), location: z.enum(['column', 'table']),
  columns: z.array(z.object({ column: name, collation: name.nullable(), order: z.enum(['ASC', 'DESC']).nullable() }).strict()).min(1).max(sqliteTableUniqueLimits.parts),
  conflict: z.enum(sqliteUniqueConflicts).nullable(),
}).strict().superRefine((value, context) => {
  if (new Set(value.columns.map(term => fold(term.column))).size !== value.columns.length) context.addIssue({ code: 'custom', message: 'SQLite新唯一约束字段不能按ASCII大小写重复' });
  if (value.location === 'column' && (value.columns.length !== 1 || value.columns.some(term => term.collation !== null || term.order !== null))) context.addIssue({ code: 'custom', message: '行内UNIQUE只能选择一个字段；排序规则由原列声明保留，不支持独立排序方向' });
});
export const sqliteTableUniqueDefinitionSchema = budget.pipe(definition);
export type SqliteTableUniqueDefinition = z.infer<typeof sqliteTableUniqueDefinitionSchema>;
const expectedSql = z.string().min(1).max(sqliteTableUniqueLimits.bytes).refine(unicode);
const original = { ordinal: z.number().int().min(0).max(sqliteTableUniqueLimits.keys - 1), expectedSql };
const edit = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), definition }).strict(),
  z.object({ kind: z.literal('remove'), ...original }).strict(),
  z.object({ kind: z.literal('replace'), ...original, definition }).strict(),
]);
export const sqliteTableUniqueEditsSchema = budget.pipe(z.array(edit).min(1).max(sqliteTableUniqueLimits.edits).superRefine((edits, context) => {
  const targets = edits.filter(value => value.kind !== 'add').map(value => value.ordinal);
  if (new Set(targets).size !== targets.length) context.addIssue({ code: 'custom', message: '同一原SQLite唯一约束只能编辑一次' });
}));
export type SqliteTableUniqueEdit = z.infer<typeof sqliteTableUniqueEditsSchema>[number];

/** 新片段只能选择准确原字段，包含生成字段；列级声明不能夹带COLLATE、表达式或DDL。 */
export function buildSqliteTableUnique(raw: unknown, columns: readonly { name: string; hidden: number }[]): string {
  const value = sqliteTableUniqueDefinitionSchema.parse(raw);
  if (value.columns.some(term => !columns.some(column => column.name === term.column && [0, 2, 3].includes(column.hidden)))) throw Error('SQLite唯一约束须准确选择原字段，不接受名称猜测或隐藏字段');
  const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
  const prefix = value.name === null ? '' : 'CONSTRAINT ' + quote(value.name) + ' ';
  const sql = prefix + 'UNIQUE' + (value.location === 'column' ? '' : ' (' + value.columns.map(term => quote(term.column) + (term.collation === null ? '' : ' COLLATE ' + quote(term.collation)) + (term.order === null ? '' : ' ' + term.order)).join(', ') + ')') + (value.conflict === null ? '' : ' ON CONFLICT ' + value.conflict);
  if (encoder.encode(sql).length > sqliteTableUniqueLimits.bytes) throw Error('SQLite唯一约束SQL超过2MiB UTF8预算'); return sql;
}
