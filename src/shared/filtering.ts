import type { FilterMode, FilterRule } from './contracts';
import { z } from 'zod';

/** 筛选体积在界面、IPC 与引擎使用相同上限，避免集合展开形成过大的查询。 */
export const FILTER_LIMITS = { conditions: 30, setValues: 200, valueLength: 4096, totalValues: 1000, totalCharacters: 1_000_000 } as const;
const operators = new Set(['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'BETWEEN', 'IS NULL', 'IS NOT NULL']);
const field = z.string().min(1).max(256), value = z.string().max(FILTER_LIMITS.valueLength,`每个筛选值不能超过 ${FILTER_LIMITS.valueLength} 个字符`);
/** 表页与命名方案共用严格形状，拒绝SQL、认证路径及未知扩展字段。 */
export const filterRuleSchema = z.object({ column: field, operator: z.enum(['=','!=','>','>=','<','<=','LIKE','NOT LIKE','IN','NOT IN','BETWEEN','IS NULL','IS NOT NULL']), value: value.optional(), values: z.array(value).max(FILTER_LIMITS.setValues,`筛选集合不能超过 ${FILTER_LIMITS.setValues} 个值`).optional() }).strict();
export const sortRulesSchema = z.array(z.object({ column: field, direction: z.enum(['ASC','DESC']) }).strict()).max(20);

/** 只校验结构与体积，不改写空白/空字符串；列名是否存在由数据库元数据另行验证。 */
export function validateFilterRules(filters: readonly FilterRule[], filterMode: FilterMode = 'all'): void {
  if (filterMode !== 'all' && filterMode !== 'any') throw new Error('筛选组合模式必须为全部满足或任一满足');
  if (!Array.isArray(filters) || filters.length > FILTER_LIMITS.conditions) throw new Error(`筛选条件不能超过 ${FILTER_LIMITS.conditions} 条`);
  let valueCount = 0, characterCount = 0;
  for (const filter of filters) {
    if (!filter || typeof filter.column !== 'string' || !filter.column.length) throw new Error('筛选字段不能为空');
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
