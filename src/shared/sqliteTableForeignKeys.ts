import { z } from 'zod';
import { sqliteTableCreateActions } from './sqliteTableCreate';

/** 已有表外键编辑的有界结构模型；此阶段不接入IPC或签发写能力。 */
export const sqliteTableForeignKeyLimits = { edits: 128, keys: 1024, parts: 1024, bytes: 2 * 1024 * 1024 } as const;
const encoder = new TextEncoder();
const fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
const unicode = (value: string) => !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const name = z.string().min(1).max(512).refine(unicode, 'SQLite外键名称必须为有效Unicode且不能包含NUL');
const parts = z.array(name).max(sqliteTableForeignKeyLimits.parts).superRefine((value, context) => {
  if (new Set(value.map(fold)).size !== value.length) context.addIssue({ code: 'custom', message: 'SQLite外键有序字段不能按ASCII大小写重复' });
});
export const sqliteTableForeignKeyDefinitionSchema = z.object({
  name: name.nullable(), columns: parts.min(1), referencedTable: name, referencedColumns: parts,
  onDelete: z.enum(sqliteTableCreateActions), onUpdate: z.enum(sqliteTableCreateActions),
  deferral: z.enum(['not-deferrable', 'immediate', 'deferred']),
}).strict().superRefine((value, context) => {
  if (value.referencedColumns.length && value.referencedColumns.length !== value.columns.length) context.addIssue({ code: 'custom', message: 'SQLite外键两端明确字段数必须一致；空父字段表示原生隐式主键' });
});
export type SqliteTableForeignKeyDefinition = z.infer<typeof sqliteTableForeignKeyDefinitionSchema>;
const expectedSql = z.string().min(1).max(sqliteTableForeignKeyLimits.bytes).refine(unicode);
const original = { ordinal: z.number().int().min(0).max(sqliteTableForeignKeyLimits.keys - 1), expectedSql };
const edit = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), definition: sqliteTableForeignKeyDefinitionSchema }).strict(),
  z.object({ kind: z.literal('remove'), ...original }).strict(),
  z.object({ kind: z.literal('replace'), ...original, definition: sqliteTableForeignKeyDefinitionSchema }).strict(),
]);

/** 深解析前检查稠密数组、所有自有字段与UTF8总预算，不能让getter、循环或大副本先进入Zod。 */
function withinBudget(input: unknown): boolean {
  let units = 0; const active = new Set<object>();
  function visit(value: unknown, depth: number): boolean {
    if (depth > 6) return false;
    if (typeof value === 'string') { if (value.length > sqliteTableForeignKeyLimits.bytes) return false; units += encoder.encode(value).length; return units <= sqliteTableForeignKeyLimits.bytes; }
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) { units += 8; return units <= sqliteTableForeignKeyLimits.bytes; }
    if (!value || typeof value !== 'object' || active.has(value)) return false;
    const array = Array.isArray(value), keys = Reflect.ownKeys(value);
    if (array ? Object.getPrototypeOf(value) !== Array.prototype || value.length > sqliteTableForeignKeyLimits.parts || keys.length !== value.length + 1 : ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || keys.length > 16) return false;
    active.add(value); units += 2;
    try {
      for (const key of keys) {
        if (array && key === 'length') continue;
        const property = Object.getOwnPropertyDescriptor(value, key);
        if (typeof key !== 'string' || array && !/^(?:0|[1-9][0-9]*)$/.test(key) || !property?.enumerable || !('value' in property)) return false;
        units += encoder.encode(key).length + 4; if (units > sqliteTableForeignKeyLimits.bytes || !visit(property.value, depth + 1)) return false;
      }
      return units <= sqliteTableForeignKeyLimits.bytes;
    } finally { active.delete(value); }
  }
  try { return visit(input, 0); } catch { return false; }
}
const budget = z.unknown().superRefine((value, context) => { if (!withinBudget(value)) context.addIssue({ code: 'custom', message: 'SQLite外键编辑结构无效或超过2MiB UTF8预算' }); });
export const sqliteTableForeignKeyEditsSchema = budget.pipe(z.array(edit).min(1).max(sqliteTableForeignKeyLimits.edits).superRefine((edits, context) => {
  const sources = edits.filter(value => value.kind !== 'add').map(value => value.ordinal);
  if (new Set(sources).size !== sources.length) context.addIssue({ code: 'custom', message: '同一原SQLite外键只能编辑一次' });
}));
export type SqliteTableForeignKeyEdit = z.infer<typeof sqliteTableForeignKeyEditsSchema>[number];

/** 所有新片段仅由名称和枚举生成；父字段省略保留为SQLite原生隐式主键，不自行推断rowid。 */
export function buildSqliteTableForeignKey(raw: unknown, table: string, columns: readonly string[]): string {
  if (!withinBudget(raw)) throw Error('SQLite外键定义无效或超过预算');
  const value = sqliteTableForeignKeyDefinitionSchema.parse(raw), local = new Set(columns);
  if (value.columns.some(column => !local.has(column)) || fold(value.referencedTable) === fold(table) && value.referencedColumns.some(column => !local.has(column))) throw Error('SQLite外键须准确选择原字段，不接受名称猜测');
  const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
  const parent = fold(value.referencedTable) === fold(table) ? table : value.referencedTable;
  const sql = `${value.name === null ? '' : `CONSTRAINT ${quote(value.name)} `}FOREIGN KEY (${value.columns.map(quote).join(', ')}) REFERENCES ${quote(parent)}${value.referencedColumns.length ? ` (${value.referencedColumns.map(quote).join(', ')})` : ''} ON DELETE ${value.onDelete} ON UPDATE ${value.onUpdate} ${value.deferral === 'not-deferrable' ? 'NOT DEFERRABLE INITIALLY IMMEDIATE' : value.deferral === 'deferred' ? 'DEFERRABLE INITIALLY DEFERRED' : 'DEFERRABLE INITIALLY IMMEDIATE'}`;
  if (encoder.encode(sql).length > sqliteTableForeignKeyLimits.bytes) throw Error('SQLite外键SQL超过2MiB UTF8预算'); return sql;
}
