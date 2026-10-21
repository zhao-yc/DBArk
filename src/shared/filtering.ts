import type { FilterGroup, FilterMode, FilterRule } from './contracts';
import { z } from 'zod';

/** 筛选体积在界面、IPC 与引擎使用相同上限，避免集合展开形成过大的查询。 */
export const FILTER_LIMITS = { conditions: 30, groups: 16, depth: 8, setValues: 200, valueLength: 4096, totalValues: 1000, totalCharacters: 1_000_000 } as const;
const operators = new Set(['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'BETWEEN', 'IS NULL', 'IS NOT NULL']);
const field = z.string().min(1).max(256), value = z.string().max(FILTER_LIMITS.valueLength,`每个筛选值不能超过 ${FILTER_LIMITS.valueLength} 个字符`);
/** 表页与命名方案共用严格形状，拒绝SQL、认证路径及未知扩展字段。 */
const filterRuleShape = z.object({ column: field, operator: z.enum(['=','!=','>','>=','<','<=','LIKE','NOT LIKE','IN','NOT IN','BETWEEN','IS NULL','IS NOT NULL']), value: value.optional(), values: z.array(value).max(FILTER_LIMITS.setValues,`筛选集合不能超过 ${FILTER_LIMITS.setValues} 个值`).optional(), enabled: z.boolean().optional() }).strict();
export const filterRuleSchema = z.unknown().transform((input, context): FilterRule => {
  try { return filterRuleShape.parse(copyRule(input)); }
  catch (reason) { context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : '筛选条件无效' }); return z.NEVER; }
});
export const sortRulesSchema = z.array(z.object({ column: field, direction: z.enum(['ASC','DESC']) }).strict()).max(20);

/** 字段必须是普通对象的自有数据属性；不调用访问器，不接受未知扩展。 */
function ownRecord(input: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('筛选只接受普通自有字段对象');
  const prototype=Object.getPrototypeOf(input);
  if(prototype!==null&&prototype!==Object.prototype){
    // IPC/VM的普通Object原型可来自另一realm；只用描述符核原生构造器，不执行其成员getter。
    const constructor=Object.getOwnPropertyDescriptor(prototype,'constructor');
    if(Object.getPrototypeOf(prototype)!==null||!constructor||!('value'in constructor)||typeof constructor.value!=='function'||Object.getOwnPropertyDescriptor(constructor.value,'prototype')?.value!==prototype||Function.prototype.toString.call(constructor.value)!=='function Object() { [native code] }')throw Error('筛选只接受普通自有字段对象');
  }
  const keys = Reflect.ownKeys(input), output: Record<string, unknown> = Object.create(null);
  if (keys.length > allowed.length || keys.some(key => typeof key !== 'string' || !allowed.includes(key))) throw Error('筛选包含未知字段');
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error('筛选字段只接受自有数据属性');
    output[key] = descriptor.value;
  }
  if (required.some(key => !Object.hasOwn(output, key))) throw Error('筛选缺少必要自有字段');
  return output;
}
/** 数组先核硬上限再读索引，不执行自定义迭代器，也不跳过空洞或getter。 */
function ownArray(input: unknown, maximum: number, message: string): unknown[] {
  if (!Array.isArray(input)) throw Error('筛选必须提供原始数组');
  const length = Object.getOwnPropertyDescriptor(input, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) throw Error(message);
  if (Reflect.ownKeys(input).length !== length + 1) throw Error('筛选数组不能包含额外字段');
  const output: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !('value' in descriptor)) throw Error('筛选数组不能包含空洞或访问器');
    output.push(descriptor.value);
  }
  return output;
}
/** 条件副本保留原字符串及显式启停，只用于有界校验及SQL构造，不转换原始数值。 */
function copyRule(input: unknown): FilterRule {
  const output = ownRecord(input, ['column', 'operator', 'value', 'values', 'enabled'], ['column', 'operator']);
  if (output.values !== undefined) output.values = ownArray(output.values, FILTER_LIMITS.setValues, `筛选集合必须包含 1～${FILTER_LIMITS.setValues} 个值`);
  return output as unknown as FilterRule;
}
/** 引擎不直接消费未知数组及条件对象，校验和构造共用描述符读取副本。 */
export function copyFilterRules(filters: readonly FilterRule[]): FilterRule[] {
  return ownArray(filters, FILTER_LIMITS.conditions, `筛选条件不能超过 ${FILTER_LIMITS.conditions} 条`).map(copyRule);
}

/** 分组先限制深度/组数/叶数，再复制；不使用可对未知对象无限递归的z.lazy。 */
function parseFilterGroup(input: unknown): FilterGroup {
  let groups = 0, leaves = 0; const ancestors = new Set<object>(), indices = new Set<number>();
  function parse(value: unknown, depth: number): FilterGroup {
    if (depth > FILTER_LIMITS.depth || ++groups > FILTER_LIMITS.groups) throw Error('筛选分组最多16组、8层');
    if (!value || typeof value !== 'object' || ancestors.has(value)) throw Error('筛选分组不能循环引用');
    const node = ownRecord(value, ['mode', 'children'], ['mode', 'children']);
    if (node.mode !== 'all' && node.mode !== 'any') throw Error('筛选分组模式必须为全部满足或任一满足');
    const children = ownArray(node.children, FILTER_LIMITS.conditions + FILTER_LIMITS.groups, '筛选分组节点超过预算');
    if (depth > 1 && !children.length) throw Error('筛选子组不能为空');
    ancestors.add(value);
    const copy = children.map(child => {
      if (typeof child !== 'number') return parse(child, depth + 1);
      if (++leaves > FILTER_LIMITS.conditions || !Number.isSafeInteger(child) || child < 0 || child >= FILTER_LIMITS.conditions || indices.has(child)) throw Error('筛选条件索引必须为不重复的0～29安全整数');
      indices.add(child); return child;
    });
    ancestors.delete(value); return Object.freeze({ mode: node.mode, children: Object.freeze(copy) });
  }
  return parse(input, 1);
}
export const filterGroupSchema = z.unknown().transform((input, context): FilterGroup => {
  try { return parseFilterGroup(input); }
  catch (reason) { context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : '筛选分组无效' }); return z.NEVER; }
});

/** IPC对象schema读字段之前先检查原始分组和条件，继承字段或getter不能变成缺省平铺。 */
export function assertFilterGroupInput(input: unknown): void {
  if (!input || typeof input !== 'object') return;
  for (const key of ['filters', 'filterMode', 'filterGroup']) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor) { if (key in input) throw Error('筛选字段必须为自有数据属性'); continue; }
    if (!('value' in descriptor)) throw Error('筛选字段不能使用访问器');
    if (key === 'filters') copyFilterRules(descriptor.value as FilterRule[]);
    if (key === 'filterGroup' && descriptor.value !== undefined) parseFilterGroup(descriptor.value);
  }
}

/** 与原条件预算共用；停用条件也必须在树中恰好出现一次，缺省不补造分组。 */
export function validateFilterGroup(filters: readonly FilterRule[], mode: FilterMode = 'all', group?: FilterGroup): FilterGroup | undefined {
  validateFilterRules(filters, mode);
  if (group === undefined) return undefined;
  const result = parseFilterGroup(group), indices = new Set<number>();
  if (result.mode !== mode) throw Error('最外层筛选分组模式必须与filterMode一致');
  function visit(node: FilterGroup): void { for (const child of node.children) if (typeof child === 'number') indices.add(child); else visit(child); }
  visit(result);
  if (indices.size !== filters.length || [...indices].some(index => index >= filters.length)) throw Error('每条筛选条件（包括停用条件）必须在分组中恰好出现一次');
  return result;
}

/** 只校验结构与体积，不改写空白/空字符串；列名是否存在由数据库元数据另行验证。 */
export function validateFilterRules(filters: readonly FilterRule[], filterMode: FilterMode = 'all'): void {
  if (filterMode !== 'all' && filterMode !== 'any') throw new Error('筛选组合模式必须为全部满足或任一满足');
  const admitted = copyFilterRules(filters);
  let valueCount = 0, characterCount = 0;
  for (const filter of admitted) {
    if (!filter || typeof filter.column !== 'string' || !filter.column.length) throw new Error('筛选字段不能为空');
    if (filter.enabled !== undefined && typeof filter.enabled !== 'boolean') throw new Error('筛选启用状态必须为布尔值');
    if (!operators.has(filter.operator)) throw new Error('不支持的筛选操作符');
    let values: string[];
    if (filter.operator === 'IS NULL' || filter.operator === 'IS NOT NULL') {
      if (filter.value !== undefined || filter.values !== undefined) throw new Error('NULL 判断不接受筛选值');
      values = [];
    } else if (filter.operator === 'IN' || filter.operator === 'NOT IN' || filter.operator === 'BETWEEN') {
      if (filter.value !== undefined) throw new Error('集合或区间筛选只能使用 values，不能同时传入 value');
      if (!Array.isArray(filter.values)) throw new Error(filter.operator === 'BETWEEN' ? 'BETWEEN 必须提供恰好 2 个边界值' : `${filter.operator} 必须提供非空集合`);
      if (filter.operator === 'BETWEEN' && filter.values.length !== 2) throw new Error('BETWEEN 必须提供恰好 2 个边界值');
      if (filter.operator !== 'BETWEEN' && (!filter.values.length || filter.values.length > FILTER_LIMITS.setValues)) throw new Error(`${filter.operator} 集合必须包含 1～${FILTER_LIMITS.setValues} 个值`);
      values = filter.values;
    } else {
      if (filter.values !== undefined) throw new Error('当前筛选操作只接受单个 value');
      values = [filter.value ?? ''];
    }
    for (const value of values) {
      if (typeof value !== 'string') throw new Error('筛选值必须为字符串；NULL 请使用 IS NULL 或 IS NOT NULL');
      if (value.length > FILTER_LIMITS.valueLength) throw new Error(`每个筛选值不能超过 ${FILTER_LIMITS.valueLength} 个字符`);
      valueCount++; characterCount += value.length;
    }
  }
  if (valueCount > FILTER_LIMITS.totalValues) throw new Error(`全部筛选条件合计不能超过 ${FILTER_LIMITS.totalValues} 个值`);
  if (characterCount > FILTER_LIMITS.totalCharacters) throw new Error(`全部筛选值合计不能超过 ${FILTER_LIMITS.totalCharacters} 个字符`);
}
