import type { CellValue, FilterGroup, FilterMode, FilterRule, TableInfo } from '../shared/contracts';
import { copyFilterRules, FILTER_LIMITS, validateFilterGroup } from '../shared/filtering';
import { tableValueOptionsColumnCapability, validateTableValueOptionsOutput, type TableValueOptionsOutput } from '../shared/tableValueOptions';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import { tableValueOptionsZh as text } from './locales/tableValueOptions.zh-CN';

export interface TableValueOptionsConditions { filters: readonly FilterRule[]; filterMode: FilterMode; filterGroup?: FilterGroup; }

/** 条件入口只读取自有数据属性，不在预算校验前执行调用方访问器。 */
function own(value: unknown, key: string, optional = false): unknown {
  if (!value || typeof value !== 'object') throw Error(text.invalid);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) { if (optional && !(key in value)) return undefined; throw Error(text.invalid); }
  if (!('value' in descriptor)) throw Error(text.invalid);
  return descriptor.value;
}

/** 筛选原值不经文本行编辑器；换行、空串和大整数字符串均原样保留。 */
export function tableValueOptionsLiteral(value: CellValue, columnType?: string): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value) || columnType !== undefined && tableValueOptionsColumnCapability(columnType) === 'floating')) return String(value);
  throw Error(text.unsupported);
}
/** 合并前后均核完整条件预算，原 OR/嵌套树整体与新增集合相交，保留显式停用。 */
export function buildTableValueOptionsConditions(original: TableValueOptionsConditions, column: string, selectedValues: readonly CellValue[], exclude: boolean, columnType?: string): TableValueOptionsConditions {
  if (typeof column !== 'string' || !column.length || column.length > 256 || typeof exclude !== 'boolean' || !Array.isArray(selectedValues) || selectedValues.length < 1 || selectedValues.length > FILTER_LIMITS.setValues) throw Error(text.selection);
  if (Reflect.ownKeys(selectedValues).length !== selectedValues.length + 1) throw Error(text.invalid);
  const literals: string[] = [], seen = new Set<string>(); let includesNull = false;
  for (let index = 0; index < selectedValues.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(selectedValues, String(index));
    if (!descriptor || !('value' in descriptor)) throw Error(text.invalid);
    const literal = tableValueOptionsLiteral(descriptor.value, columnType), key = literal === null ? 'null' : 'text:' + literal;
    if (literal !== null && literal.length > FILTER_LIMITS.valueLength) throw Error(text.budget);
    if (seen.has(key)) throw Error(text.invalid); seen.add(key);
    if (literal === null) includesNull = true; else literals.push(literal);
  }
  try {
    const originalMode = own(original, 'filterMode') as FilterMode;
    const filters = copyFilterRules(own(original, 'filters') as readonly FilterRule[]), before = validateFilterGroup(filters, originalMode, own(original, 'filterGroup', true) as FilterGroup | undefined);
    const originalLength = filters.length, children: (number | FilterGroup)[] = [];
    if (literals.length) { children.push(filters.length); filters.push({ column, operator: exclude ? 'NOT IN' : 'IN', values: [...literals] }); }
    if (includesNull || exclude) { children.push(filters.length); filters.push({ column, operator: exclude ? includesNull ? 'IS NOT NULL' : 'IS NULL' : 'IS NULL' }); }
    const member: FilterGroup = { mode: literals.length && (exclude ? !includesNull : includesNull) ? 'any' : 'all', children };
    const prior: FilterGroup = before ?? { mode: originalMode, children: Array.from({ length: originalLength }, (_, index) => index) };
    const group: FilterGroup = originalLength ? { mode: 'all', children: [...(prior.mode === 'all' ? prior.children : [prior]), ...(member.mode === 'all' ? member.children : [member])] } : member;
    const checked = validateFilterGroup(filters, group.mode, group)!;
    for (const filter of filters) { if (filter.values) Object.freeze(filter.values); Object.freeze(filter); } Object.freeze(filters);
    return Object.freeze({ filters, filterMode: checked.mode, filterGroup: checked });
  } catch (reason) {
    if (reason instanceof Error && /不能超过|超过预算|最多16组、8层|集合必须包含/.test(reason.message)) throw Error(text.budget);
    throw reason;
  }
}
/** 完整绑定源元数据、搜索原文与列；回执计数只作为精确十进制字符串展示。 */
export function checkTableValueOptionsOutput(source: TableInfo, column: string, searchPattern: string, output: TableValueOptionsOutput): void {
  validateTableValueOptionsOutput(output, { database: source.database, table: source.name, column, searchPattern });
  if (tableCopyMetadataKey(output.source) !== tableCopyMetadataKey(source)) throw Error(text.mismatch);
}
