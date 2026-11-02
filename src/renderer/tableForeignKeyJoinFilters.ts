import type { ColumnInfo, FilterMode, FilterRule, TableInfo } from '../shared/contracts';
import { FILTER_LIMITS, copyFilterRules, validateFilterRules } from '../shared/filtering';
import { assertTableReadUnicode, buildTableFilterSql, tableReadIdentifier, tableReadTextLiteral } from '../shared/tableReadSql';
import { tableForeignKeyJoinFilterZh as text } from './locales/tableForeignKeyJoinFilter.zh-CN';
import { filterRuleFromDraft, type FilterDraft } from './tableFilters';

export interface ForeignKeyJoinFilter extends FilterRule { side: 'child' | 'parent'; }
export interface ForeignKeyJoinFilterDraft { id: string; side: 'child' | 'parent'; enabled: boolean; draft: FilterDraft; }
type Source = { columns: readonly Pick<ColumnInfo, 'name' | 'type'>[] };

/** 在复制前拒绝未知属性、访问器和空洞；side以外的形状、原值和总量仍由既有筛选合同核验。 */
function copy(raw: unknown): { side: 'child' | 'parent'; rule: FilterRule }[] {
  if (!Array.isArray(raw)) throw Error(text.invalid);
  const length = Object.getOwnPropertyDescriptor(raw, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > FILTER_LIMITS.conditions || Reflect.ownKeys(raw).length !== length + 1) throw Error(text.invalid);
  const sides: ('child' | 'parent')[] = [], rules: FilterRule[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index)); if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error(text.invalid);
    const value = descriptor.value; if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(text.invalid);
    const keys = Reflect.ownKeys(value); if (keys.length > 6 || keys.some(key => typeof key !== 'string' || !['side','column','operator','value','values','enabled'].includes(key))) throw Error(text.invalid);
    const fields = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>; let side: unknown;
    for (const key of keys as string[]) { const property = Object.getOwnPropertyDescriptor(value, key); if (!property || !('value' in property) || !property.enumerable) throw Error(text.invalid); if (key === 'side') side = property.value; else Object.defineProperty(fields, key, property); }
    if (side !== 'child' && side !== 'parent') throw Error(text.invalid); sides.push(side); rules.push(fields as unknown as FilterRule);
  }
  return copyFilterRules(rules).map((rule,index) => ({ side: sides[index], rule }));
}

/** 精确转换、LIKE和集合均复用表页编译；只限定c/p列，不文本替换SQL或把值转成JS数值。 */
export function buildForeignKeyJoinWhere(child: Source, parent: Source, raw: unknown, mode: FilterMode, sqlUnits: number): string | undefined {
  const filters = copy(raw); validateFilterRules(filters.map(filter => filter.rule), mode);
  let literalUnits = 0;
  const clauses = filters.map(({side,rule}) => {
    const source = side === 'child' ? child : parent;
    const original = source.columns.find(column => column.name === rule.column); if (!original) throw Error(text.invalid);
    // 停用条件同样校Unicode；再次启用不能悄悄替换原值或原列名。
    assertTableReadUnicode(rule.column); for (const value of rule.values ?? (rule.value === undefined ? [] : [rule.value])) assertTableReadUnicode(value);
    const columns: ColumnInfo[] = [{ name: original.name, type: original.type, nullable: true, generated: false, extra: '', comment: '', defaultValue: null }];
    const info = { columns } as TableInfo;
    return buildTableFilterSql(info, [rule], 'all', undefined, value => {
      const literal = tableReadTextLiteral(value); literalUnits += literal.length; if (literalUnits > sqlUnits) throw Error(text.budget); return literal;
    }, column => (side === 'child' ? 'c.' : 'p.') + tableReadIdentifier(column)).where;
  }).filter((clause): clause is string => clause !== undefined);
  const where = clauses.length ? '(' + clauses.join(mode === 'all' ? ' AND ' : ' OR ') + ')' : undefined;
  if (where && where.length > sqlUnits) throw Error(text.budget); return where;
}

/** 表单只把当前运算符需要的值编入选项，切换字段或运算符保留其它输入供用户修正。 */
export function foreignKeyJoinFiltersFromDraft(entries: readonly ForeignKeyJoinFilterDraft[], child: Source, parent: Source): ForeignKeyJoinFilter[] {
  if (entries.length > FILTER_LIMITS.conditions) throw Error(text.invalid);
  return entries.map(entry => ({ side: entry.side, ...filterRuleFromDraft(entry.draft, (entry.side === 'child' ? child : parent).columns.map(column => column.name)), ...(entry.enabled ? {} : { enabled: false }) }));
}
