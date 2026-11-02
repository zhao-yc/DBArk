import { z } from 'zod';

/** 主键只有一个准确原目标；结构模型不签发写能力，不把列模式DESC转换成表模式。 */
export const sqliteTablePrimaryKeyLimits = { parts: 1024, bytes: 2 * 1024 * 1024 } as const;
export const sqlitePrimaryKeyConflicts = ['ROLLBACK', 'ABORT', 'FAIL', 'IGNORE', 'REPLACE'] as const;
const encoder = new TextEncoder(), fold = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
const unicode = (value: string) => !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const name = z.string().min(1).max(512).refine(unicode, 'SQLite主键名称须为有效Unicode且不能包含NUL');
export const sqliteTablePrimaryKeyDefinitionSchema = z.object({
  name: name.nullable(), location: z.enum(['column', 'table']),
  columns: z.array(z.object({ column: name, collation: name.nullable(), order: z.enum(['ASC', 'DESC']).nullable() }).strict()).min(1).max(sqliteTablePrimaryKeyLimits.parts),
  conflict: z.enum(sqlitePrimaryKeyConflicts).nullable(), autoIncrement: z.boolean(),
}).strict().superRefine((value, context) => {
  if (new Set(value.columns.map(term => fold(term.column))).size !== value.columns.length) context.addIssue({ code: 'custom', message: 'SQLite新主键字段不能按ASCII大小写重复' });
  if (value.location === 'column' && (value.columns.length !== 1 || value.columns.some(term => term.collation !== null))) context.addIssue({ code: 'custom', message: '行内主键只能选择一个字段；列排序规则由原COLLATE声明保留' });
  if (value.autoIncrement && (value.columns.length !== 1 || value.location === 'column' && value.columns[0].order === 'DESC')) context.addIssue({ code: 'custom', message: 'SQLite自增只能用于单列INTEGER ROWID主键，行内DESC不具备该身份' });
});
export type SqliteTablePrimaryKeyDefinition = z.infer<typeof sqliteTablePrimaryKeyDefinitionSchema>;

/** Zod读属性前拒绝访问器、稀疏数组、循环、额外原型及超大UTF8输入。 */
function withinBudget(input: unknown): boolean {
  let bytes = 0; const active = new Set<object>();
  function visit(value: unknown, depth: number): boolean {
    if (depth > 6) return false;
    if (typeof value === 'string') { if (value.length > sqliteTablePrimaryKeyLimits.bytes) return false; bytes += encoder.encode(value).length; return bytes <= sqliteTablePrimaryKeyLimits.bytes; }
    if (value === null || typeof value === 'boolean') { bytes += 8; return bytes <= sqliteTablePrimaryKeyLimits.bytes; }
    if (!value || typeof value !== 'object' || active.has(value)) return false;
    const array = Array.isArray(value), keys = Reflect.ownKeys(value);
    if (array ? Object.getPrototypeOf(value) !== Array.prototype || value.length > sqliteTablePrimaryKeyLimits.parts || keys.length !== value.length + 1 : ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || keys.length > 8) return false;
    active.add(value); bytes += 2;
    try {
      for (const key of keys) {
        if (array && key === 'length') continue; const property = Object.getOwnPropertyDescriptor(value, key);
        if (typeof key !== 'string' || array && !/^(?:0|[1-9][0-9]*)$/.test(key) || !property?.enumerable || !('value' in property)) return false;
        bytes += encoder.encode(key).length + 4; if (bytes > sqliteTablePrimaryKeyLimits.bytes || !visit(property.value, depth + 1)) return false;
      }
      return bytes <= sqliteTablePrimaryKeyLimits.bytes;
    } finally { active.delete(value); }
  }
  try { return visit(input, 0); } catch { return false; }
}
const budget = z.unknown().superRefine((value, context) => { if (!withinBudget(value)) context.addIssue({ code: 'custom', message: 'SQLite主键编辑结构无效或超过2MiB UTF8预算' }); });
const expectedSql = z.string().min(1).max(sqliteTablePrimaryKeyLimits.bytes).refine(unicode);
export const sqliteTablePrimaryKeyEditSchema = budget.pipe(z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), definition: sqliteTablePrimaryKeyDefinitionSchema }).strict(),
  z.object({ kind: z.literal('remove'), expectedSql }).strict(),
  z.object({ kind: z.literal('replace'), expectedSql, definition: sqliteTablePrimaryKeyDefinitionSchema }).strict(),
]));
export type SqliteTablePrimaryKeyEdit = z.infer<typeof sqliteTablePrimaryKeyEditSchema>;

/** 新片段只从准确原字段和枚举构建；类型、自增、WITHOUT ROWID由编译器结合原声明再核对。 */
export function buildSqliteTablePrimaryKey(raw: unknown, columns: readonly { name: string; hidden: number }[]): string {
  if (!withinBudget(raw)) throw Error('SQLite主键定义无效或超过预算'); const value = sqliteTablePrimaryKeyDefinitionSchema.parse(raw);
  if (value.columns.some(term => !columns.some(column => column.name === term.column && column.hidden === 0))) throw Error('SQLite主键须准确选择原普通字段，不能猜名称或使用生成列');
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  const prefix = value.name === null ? '' : 'CONSTRAINT ' + quote(value.name) + ' ';
  const conflict = value.conflict === null ? '' : ' ON CONFLICT ' + value.conflict;
  const auto = value.autoIncrement ? ' AUTOINCREMENT' : '';
  return prefix + 'PRIMARY KEY' + (value.location === 'column' ? (value.columns[0].order === null ? '' : ' ' + value.columns[0].order) + conflict + auto : ' (' + value.columns.map(term => quote(term.column) + (term.collation === null ? '' : ' COLLATE ' + quote(term.collation)) + (term.order === null ? '' : ' ' + term.order)).join(', ') + auto + ')' + conflict);
}
