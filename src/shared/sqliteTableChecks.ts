import { z } from 'zod';

/** CHECK只描述约束及准确声明位置，不接受执行语句、文件路径或启停PRAGMA。 */
export const sqliteTableCheckLimits = { edits: 128, checks: 1024, expressionBytes: 64 * 1024, nesting: 64, bytes: 2 * 1024 * 1024 } as const;
const encoder = new TextEncoder();
const unicode = (value: string) => !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const name = z.string().min(1).max(512).refine(unicode, 'SQLite检查约束名称须为有效Unicode且不能包含NUL');

/** 单表达式词法隔离；不执行、不求值、不猜测字段引用或函数效果，语义仍须native验证。 */
export function assertSqliteCheckExpression(value: string): void {
  const limits = sqliteTableCheckLimits;
  if (typeof value !== 'string' || !value.length || value.length > limits.expressionBytes || !unicode(value) || encoder.encode(value).length > limits.expressionBytes) throw Error('SQLite检查表达式须为64KiB内有效Unicode，不能包含NUL');
  let index = 0, depth = 0, significant = false;
  while (index < value.length) {
    const character = value[index];
    if (/[ \t\r\n\v\f]/.test(character)) { index++; continue; }
    if (value.startsWith('--', index)) { const end = value.indexOf('\n', index + 2); index = end < 0 ? value.length : end + 1; continue; }
    if (value.startsWith('/*', index)) { const end = value.indexOf('*/', index + 2); if (end < 0) throw Error('SQLite检查表达式注释未闭合'); index = end + 2; continue; }
    significant = true;
    if (["'", '"', '`', '['].includes(character)) {
      const closing = character === '[' ? ']' : character; let closed = false; index++;
      while (index < value.length) { if (value[index] !== closing) index++; else if (character !== '[' && value[index + 1] === closing) index += 2; else { index++; closed = true; break; } }
      if (!closed) throw Error('SQLite检查表达式引号未闭合'); continue;
    }
    if ('?:@$;'.includes(character)) throw Error('SQLite检查表达式不能包含外部参数或语句分隔符');
    if (/[A-Za-z_\u0080-\uFFFF]/.test(character)) { index++; while (index < value.length && /[A-Za-z0-9_$\u0080-\uFFFF]/.test(value[index])) index++; continue; }
    if (character === '(' && ++depth > limits.nesting || character === ')' && --depth < 0) throw Error('SQLite检查表达式括号越界或超过64层');
    index++;
  }
  if (!significant || depth) throw Error('SQLite检查表达式为空或括号不平衡');
}

/** Zod读取前计量全部自有数据，拒绝访问器、循环、稀疏数组及超预算深副本。 */
function withinBudget(input: unknown): boolean {
  let bytes = 0; const active = new Set<object>(); const take = (count: number) => (bytes += count) <= sqliteTableCheckLimits.bytes;
  function visit(value: unknown, depth: number): boolean {
    if (depth > 6) return false;
    if (typeof value === 'string') return value.length <= sqliteTableCheckLimits.bytes && take(encoder.encode(JSON.stringify(value)).length);
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return take(JSON.stringify(value).length);
    if (!value || typeof value !== 'object' || active.has(value)) return false;
    const array = Array.isArray(value), keys = Reflect.ownKeys(value);
    if (array ? Object.getPrototypeOf(value) !== Array.prototype || value.length > sqliteTableCheckLimits.checks || keys.length !== value.length + 1 : ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || keys.length > 8) return false;
    active.add(value);
    try {
      if (!take(2)) return false; let count = 0;
      for (const key of keys) { if (array && key === 'length') continue; const property = Object.getOwnPropertyDescriptor(value, key); if (typeof key !== 'string' || array && !/^(?:0|[1-9][0-9]*)$/.test(key) || !property?.enumerable || !('value' in property)) return false; if (count++ && !take(1) || !array && !take(encoder.encode(JSON.stringify(key)).length + 1) || !visit(property.value, depth + 1)) return false; }
      return true;
    } finally { active.delete(value); }
  }
  try { return visit(input, 0); } catch { return false; }
}
const budget = z.unknown().superRefine((value, context) => { if (!withinBudget(value)) context.addIssue({ code: 'custom', message: 'SQLite检查约束结构无效或超过2MiB UTF8预算' }); });
const expression = z.string().min(1).max(sqliteTableCheckLimits.expressionBytes).superRefine((value, context) => { try { assertSqliteCheckExpression(value); } catch { context.addIssue({ code: 'custom', message: 'SQLite检查约束须为64KiB内有界表达式，不能含外部参数或语句分隔符' }); } });
const definition = z.discriminatedUnion('location', [
  z.object({ location: z.literal('table'), name: name.nullable(), expression }).strict(),
  z.object({ location: z.literal('column'), column: name, name: name.nullable(), expression }).strict(),
]);
export const sqliteTableCheckDefinitionSchema = budget.pipe(definition);
export type SqliteTableCheckDefinition = z.infer<typeof sqliteTableCheckDefinitionSchema>;
const original = { ordinal: z.number().int().min(0).max(sqliteTableCheckLimits.checks - 1), expectedSql: z.string().min(1).max(sqliteTableCheckLimits.bytes).refine(unicode) };
const edit = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), definition }).strict(), z.object({ kind: z.literal('remove'), ...original }).strict(), z.object({ kind: z.literal('replace'), ...original, definition }).strict(),
]);
export const sqliteTableCheckEditsSchema = budget.pipe(z.array(edit).min(1).max(sqliteTableCheckLimits.edits).superRefine((edits, context) => { const targets = edits.filter(edit => edit.kind !== 'add').map(edit => edit.ordinal); if (new Set(targets).size !== targets.length) context.addIssue({ code: 'custom', message: '同一原SQLite检查约束只能编辑一次' }); }));
export type SqliteTableCheckEdit = z.infer<typeof sqliteTableCheckEditsSchema>[number];

/** 两侧换行避免尾行注释吞闭括号；新CHECK不设置无效的ON CONFLICT或忽略检查选项。 */
export function buildSqliteTableCheck(raw: unknown, columns: readonly { name: string; hidden: number }[]): string {
  const value = sqliteTableCheckDefinitionSchema.parse(raw);
  if (value.location === 'column' && !columns.some(column => column.name === value.column && [0, 2, 3].includes(column.hidden))) throw Error('SQLite检查约束须准确选择原声明字段，不接受名称猜测或隐藏字段');
  const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
  return (value.name === null ? '' : 'CONSTRAINT ' + quote(value.name) + ' ') + 'CHECK (\n' + value.expression + '\n)';
}
