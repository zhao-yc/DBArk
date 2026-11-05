import type { FilterGroup, FilterRule } from '../../shared/contracts';
import { validateFilterGroup } from '../../shared/filtering';
import type { PostgresTableFilter } from '../../shared/postgresTable';

/** 浏览、游标和 COPY 共用条件树，参数或字面量的生成由协议入口决定。 */
export function postgresTableCondition(filter: PostgresTableFilter | undefined, column: (name: string) => string,
  bind: (value: string) => string): string {
  if (!filter) return '';
  if ('text' in filter) return filter.text ? 'pg_catalog.strpos(' + column(filter.column) + '::text, ' + bind(filter.text) + ') > 0' : '';
  const { rules, mode } = filter;
  const tree = validateFilterGroup(rules, mode, filter.group) ?? { mode, children: rules.map((_, index) => index) };

  function leaf(rule: FilterRule): string {
    if (rule.enabled === false) return '';
    const name = column(rule.column), operator = rule.operator;
    if (operator === 'IS NULL' || operator === 'IS NOT NULL') return name + ' ' + operator;
    if (operator === 'IN' || operator === 'NOT IN')
      return name + ' ' + operator + ' (' + rule.values!.map(bind).join(', ') + ')';
    if (operator === 'BETWEEN')
      return name + ' BETWEEN ' + bind(rule.values![0]) + ' AND ' + bind(rule.values![1]);
    const left = operator === 'LIKE' || operator === 'NOT LIKE' ? name + '::text' : name;
    return left + ' ' + operator + ' ' + bind(rule.value ?? '');
  }

  function visit(group: FilterGroup): string {
    const children = group.children.map(child => typeof child === 'number' ? leaf(rules[child]) : visit(child)).filter(Boolean);
    return children.length < 2 ? children[0] ?? '' : '(' + children.join(group.mode === 'all' ? ' AND ' : ' OR ') + ')';
  }
  return visit(tree);
}
