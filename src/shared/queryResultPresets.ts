import { z } from 'zod';
import type { ResultColumn } from './contracts';

export type QueryResultFilterOperator = 'contains' | 'notContains' | 'startsWith' | 'notStartsWith' | 'endsWith' | 'notEndsWith' | 'like' | 'notLike' | 'empty' | 'notEmpty' | 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'notBetween' | 'in' | 'notIn' | 'null' | 'notNull';
export type QueryResultFilterMode = 'AND' | 'OR';
export interface QueryResultFilterRule { column: string; operator: QueryResultFilterOperator; value: string; upper?: string; values?: readonly string[]; ignoreCase?: boolean; enabled?: boolean; }
export interface QueryResultFilterGroup { readonly mode: QueryResultFilterMode; readonly children: readonly (QueryResultFilterRule | QueryResultFilterGroup)[]; }
export interface QueryResultSortRule { column: string; direction: 'ASC' | 'DESC'; nulls?: 'FIRST' | 'LAST'; ignoreCase?: boolean; }
export interface QueryResultOrganization { readonly expression: QueryResultFilterGroup; readonly sort: readonly QueryResultSortRule[]; }
/** 只保存完整字段身份与整理配置，任何行、SQL及文件路径均不属于方案。 */
export interface QueryResultPresetValue { readonly columns: readonly ResultColumn[]; readonly visible: readonly ResultColumn[]; readonly configuration: QueryResultOrganization; readonly frozenThrough?: string; }
export const queryResultPresetLimits = { name: 80, perConnection: 100, connections: 500, entries: 1000, entryBytes: 512 * 1024, totalBytes: 8 * 1024 * 1024, valueUnits: 128 * 1024 } as const;
const structure = { columns: 1024, conditions: 32, groups: 16, depth: 8, members: 128, literalUnits: 4096 } as const;
const operators = new Set<QueryResultFilterOperator>(['contains', 'notContains', 'startsWith', 'notStartsWith', 'endsWith', 'notEndsWith', 'like', 'notLike', 'empty', 'notEmpty', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'notBetween', 'in', 'notIn', 'null', 'notNull']);
const invalid = (): never => { throw Error('查询结果方案结构或字段无效'); };

/** 只接受普通对象的自有数据属性；访问器、原型扩展及符号字段一律不执行或忽略。 */
function record(input: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length > allowed.length || keys.some(key => typeof key !== 'string' || !allowed.includes(key))) return invalid();
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
    output[key] = descriptor.value;
  }
  if (required.some(key => !Object.hasOwn(output, key))) return invalid();
  return output;
}

/** 数组先核上限再读取索引，拒绝空洞、访问器与额外属性，不能靠map跳过校验。 */
function array(input: unknown, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return invalid();
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < minimum || length > maximum) return invalid();
  if (Reflect.ownKeys(input).length !== length + 1) return invalid();
  const output: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return invalid();
    output.push(descriptor.value);
  }
  return output;
}

/** 在有界结构中逐项复制；只对可信副本序列化，不递归未知原对象或解析比较字面值。 */
function parseValue(input: unknown): QueryResultPresetValue {
  let units = 0, groups = 0, conditions = 0;
  const ancestors = new Set<object>();
  /** 字符串原文先计费，最终还会计入JSON标点与转义的完整UTF-16长度。 */
  function string(value: unknown, minimum: number, maximum: number): string {
    if (typeof value !== 'string' || value.length < minimum || value.length > maximum) return invalid();
    units += value.length;
    if (units > queryResultPresetLimits.valueUnits) throw Error('查询结果方案超过128 Ki UTF-16单元容量');
    return value;
  }
  /** 元数据不使用键作为对象属性，允许真实字段名为__proto__等原型同名字符串。 */
  function columns(value: unknown): ResultColumn[] {
    const output = array(value, structure.columns, 1).map(item => {
      const source = record(item, ['key', 'name', 'type']);
      return { key: string(source.key, 1, 4096), name: string(source.name, 0, 4096), type: string(source.type, 0, 256) };
    });
    if (new Set(output.map(column => column.key)).size !== output.length) return invalid();
    return output;
  }
  const source = record(input, ['columns', 'visible', 'configuration', 'frozenThrough'], ['columns', 'visible', 'configuration']);
  const all = columns(source.columns), visible = columns(source.visible), available = new Set(visible.map(column => column.key));
  for (const column of visible) if (!all.some(other => other.key === column.key && other.name === column.name && other.type === column.type)) return invalid();
  // 可选字段存在时也必须有效，undefined不能冒充省略；冻结仅绑定当前可见内部key。
  const frozenThrough = Object.hasOwn(source, 'frozenThrough') ? string(source.frozenThrough, 1, 4096) : undefined;
  if (frozenThrough !== undefined && !available.has(frozenThrough)) return invalid();
  /** 所有叶（包括停用叶）保留原值及选项；仅核结构，不把数字或日期转成Main比较值。 */
  function rule(value: unknown): QueryResultFilterRule {
    if (++conditions > structure.conditions) return invalid();
    const node = record(value, ['column', 'operator', 'value', 'upper', 'values', 'ignoreCase', 'enabled'], ['column', 'operator', 'value']);
    const column = string(node.column, 1, 4096), operator = node.operator as QueryResultFilterOperator;
    if (!available.has(column) || !operators.has(operator)) return invalid();
    const output: QueryResultFilterRule = { column, operator, value: string(node.value, 0, structure.literalUnits) };
    const range = operator === 'between' || operator === 'notBetween', list = operator === 'in' || operator === 'notIn';
    if (range) output.upper = string(node.upper, 0, structure.literalUnits);
    else if (node.upper !== undefined) return invalid();
    if (list) output.values = array(node.values, structure.members, 1).map(item => string(item, 0, structure.literalUnits));
    else if (node.values !== undefined) return invalid();
    if ((list || ['null', 'notNull', 'empty', 'notEmpty'].includes(operator)) && output.value !== '') return invalid();
    for (const key of ['ignoreCase', 'enabled'] as const) if (node[key] !== undefined) {
      if (typeof node[key] !== 'boolean') return invalid();
      output[key] = node[key];
    }
    return output;
  }
  /** 根允许空条件，子组不允许空；深度、组数及条件数在进入递归前受硬上限约束。 */
  function group(value: unknown, depth: number): QueryResultFilterGroup {
    if (depth > structure.depth || ++groups > structure.groups || !value || typeof value !== 'object' || ancestors.has(value)) return invalid();
    const node = record(value, ['mode', 'children']);
    if (node.mode !== 'AND' && node.mode !== 'OR') return invalid();
    ancestors.add(value);
    const children = array(node.children, structure.conditions + structure.groups, depth === 1 ? 0 : 1).map(child => {
      if (!child || typeof child !== 'object' || ancestors.has(child)) return invalid();
      return Object.hasOwn(child, 'children') ? group(child, depth + 1) : rule(child);
    });
    ancestors.delete(value);
    return { mode: node.mode, children };
  }
  const configuration = record(source.configuration, ['expression', 'sort']);
  const expression = group(configuration.expression, 1);
  const sort: QueryResultSortRule[] = array(configuration.sort, structure.columns).map(item => {
    const node = record(item, ['column', 'direction', 'nulls', 'ignoreCase'], ['column', 'direction']);
    const column = string(node.column, 1, 4096);
    if (!available.has(column) || node.direction !== 'ASC' && node.direction !== 'DESC') return invalid();
    const output: QueryResultSortRule = { column, direction: node.direction };
    if (node.nulls !== undefined) {
      if (node.nulls !== 'FIRST' && node.nulls !== 'LAST') return invalid();
      output.nulls = node.nulls;
    }
    if (node.ignoreCase !== undefined) {
      if (typeof node.ignoreCase !== 'boolean') return invalid();
      output.ignoreCase = node.ignoreCase;
    }
    return output;
  });
  if (new Set(sort.map(item => item.column)).size !== sort.length) return invalid();
  const output: QueryResultPresetValue = { columns: all, visible, configuration: { expression, sort }, ...(frozenThrough === undefined ? {} : { frozenThrough }) };
  if (JSON.stringify(output).length > queryResultPresetLimits.valueUnits) throw Error('查询结果方案超过128 Ki UTF-16单元容量');
  return output;
}

/** 统一将有界读取错误转成Zod校验失败，safeParse不会执行不可信getter。 */
function guarded<T>(parse: (input: unknown) => T) {
  return z.unknown().transform((input, context): T => {
    try { return parse(input); }
    catch (reason) { context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : '查询结果方案无效' }); return z.NEVER; }
  });
}

export const queryResultPresetValueSchema = guarded(parseValue);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
// 连接ID沿用既有合同，兼容历史配置；方案及绑定令牌使用UUID。
const connectionId = z.string().min(1).max(200), uuid = z.string().uuid();
const name = z.string().max(queryResultPresetLimits.name).refine(value => value.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value), '方案名不能为空或包含控制字符').transform(value => value.trim());
const entryFields = ['id', 'name', 'connectionDigest', 'value'] as const;
/** 外层同样先检查描述符，再交给Zod；内部schema的解析结果提供完整静态类型。 */
function objectSchema<S extends z.ZodType>(fields: readonly string[], schema: S, required: readonly string[] = fields) {
  return guarded((input): z.output<S> => schema.parse(record(input, fields, required)));
}
const entry = objectSchema(entryFields, z.object({ id: uuid, name, connectionDigest: digest, value: queryResultPresetValueSchema }).strict()).superRefine((value, context) => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > queryResultPresetLimits.entryBytes) context.addIssue({ code: 'custom', message: '单项方案超过512 KiB字节上限' });
});
const documentShape = { version: z.literal(1), revision, entries: guarded(input => array(input, queryResultPresetLimits.perConnection)).pipe(z.array(entry)) };
/** 文档有独立CAS修订，即使删空也保留修订墓碑；名称按规范trim后查重。 */
function uniqueEntries(value: { entries: { id: string; name: string }[] }, context: z.RefinementCtx): void {
  if (new Set(value.entries.map(item => item.name)).size !== value.entries.length || new Set(value.entries.map(item => item.id)).size !== value.entries.length) context.addIssue({ code: 'custom', message: '方案名称或编号重复' });
}
export const queryResultPresetDocumentSchema = objectSchema(['version', 'revision', 'entries'], z.object(documentShape).strict()).superRefine(uniqueEntries);
export const queryResultPresetSourceSchema = objectSchema(['connectionRevision', 'connectionDigest'], z.object({ connectionRevision: revision, connectionDigest: digest }).strict());
export const queryResultPresetStoredSnapshotSchema = objectSchema(['version', 'revision', 'entries', 'source'], z.object({ ...documentShape, source: queryResultPresetSourceSchema }).strict()).superRefine(uniqueEntries);
export const queryResultPresetSnapshotSchema = objectSchema(['version', 'revision', 'entries', 'source', 'bindingToken'], z.object({ ...documentShape, source: queryResultPresetSourceSchema, bindingToken: uuid }).strict()).superRefine(uniqueEntries);
export const queryResultPresetListSchema = objectSchema(['connectionId'], z.object({ connectionId }).strict());
const checkedShape = { connectionId, expectedRevision: revision, source: queryResultPresetSourceSchema, bindingToken: uuid };
const checkedFields = ['connectionId', 'expectedRevision', 'source', 'bindingToken'] as const;
export const queryResultPresetSaveSchema = objectSchema([...checkedFields, 'name', 'value', 'replaceId'], z.object({ ...checkedShape, name, value: queryResultPresetValueSchema, replaceId: uuid.optional() }).strict(), [...checkedFields, 'name', 'value']);
export const queryResultPresetSelectSchema = objectSchema([...checkedFields, 'id'], z.object({ ...checkedShape, id: uuid }).strict());
export const queryResultPresetRenameSchema = objectSchema([...checkedFields, 'id', 'name'], z.object({ ...checkedShape, id: uuid, name }).strict());
export type QueryResultPresetDocument = z.infer<typeof queryResultPresetDocumentSchema>;
export type QueryResultPresetSource = z.infer<typeof queryResultPresetSourceSchema>;
export type QueryResultPresetStoredSnapshot = z.infer<typeof queryResultPresetStoredSnapshotSchema>;
export type QueryResultPresetSnapshot = z.infer<typeof queryResultPresetSnapshotSchema>;
export type QueryResultPresetTarget = z.infer<typeof queryResultPresetListSchema>;
export type QueryResultPresetSave = z.infer<typeof queryResultPresetSaveSchema>;
export type QueryResultPresetSelect = z.infer<typeof queryResultPresetSelectSchema>;
export type QueryResultPresetRename = z.infer<typeof queryResultPresetRenameSchema>;

/** 汇总所有连接的内容UTF-8字节预算；不把该统计误称SQLite文件或内存硬上限。 */
export function validateQueryResultPresetBudget(connections: number, entries: number, bytes: number): void {
  if (![connections, entries, bytes].every(value => Number.isSafeInteger(value) && value >= 0) || connections > queryResultPresetLimits.connections || entries > queryResultPresetLimits.entries || bytes > queryResultPresetLimits.totalBytes) throw Error('查询结果方案超过500个连接、1000项或8 MiB本机内容上限');
}
