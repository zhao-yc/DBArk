import type { FilterGroup, FilterRule } from '../shared/contracts';
import { postgresAdvancedTableFilterSchema, type PostgresAdvancedTableFilter } from '../shared/postgresTable';

/** 将包含／排除的完整 NULL 补集与当前草稿相交，保留原 OR 条件及子组。 */
export function appendPostgresValueFilter(
  current: PostgresAdvancedTableFilter, column: string, values: readonly (string | null)[], exclude: boolean,
): PostgresAdvancedTableFilter {
  if (!values.length) throw Error('请选择至少一个不同值');
  const present = values.includes(null);
  const nonNull = values.filter((value): value is string => value !== null);
  const added: FilterRule[] = [];
  if (nonNull.length) added.push({ column, operator: exclude ? 'NOT IN' : 'IN', values: nonNull });
  if (present || exclude) added.push({ column, operator: present && exclude ? 'IS NOT NULL' : 'IS NULL' });
  const indices = added.map((_, index) => current.rules.length + index);
  const mode = exclude && present ? 'all' : 'any';
  const tail: number | FilterGroup = indices.length === 1 ? indices[0] : { mode, children: indices };
  const original = current.group ?? { mode: current.mode, children: current.rules.map((_, index) => index) };
  const head = current.mode === 'all' ? original.children : current.rules.length ? [original] : [];
  return postgresAdvancedTableFilterSchema.parse({
    rules: [...current.rules, ...added], mode: 'all', group: { mode: 'all', children: [...head, tail] },
  });
}
