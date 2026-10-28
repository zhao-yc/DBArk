import { describe, expect, it, vi } from 'vitest';
import type { FilterRule, SortRule, TableInfo } from '../../src/shared/contracts';
import { buildFilteredTableSelect, buildTableReadOrder, tableReadSqlLimits } from '../../src/shared/tableReadSql';
import { buildPageSql, inlineParameters } from '../../src/engine/sql';

/** 空串/NULL不借样例重排模拟；直接核实际分页与共享SELECT的SQL及精确参数。 */
function source(extra: string[] = []): TableInfo {
  return { database: '库?`', name: '目标', objectKind: 'table', engine: 'InnoDB', ddl: '', indexes: [], foreignKeys: [], primaryKey: ['id', 'tenant'], editableKey: ['id', 'tenant'], columns: ['id', 'tenant', 'note', 'amount', 'n?`', ...extra].map(name => ({ name, type: name === 'id' ? 'BIGINT UNSIGNED' : name === 'amount' ? 'DECIMAL(40,18)' : 'VARCHAR(100)', nullable: name !== 'id' && name !== 'tenant', defaultValue: null, extra: '', comment: '', generated: false })) };
}

describe('表浏览NULL位置共享SQL编译', () => {
  it.each(['ASC', 'DESC'] as const)('%s旧双字段及显式undefined逐字保持，未选排序仍补完整可靠键', direction => {
    const info = source(), original: SortRule[] = [{ column: 'note', direction }], explicit: SortRule[] = [{ column: 'note', direction, nulls: undefined }];
    const expected = '`note` ' + direction + ', `id` ASC, `tenant` ASC';
    expect(buildTableReadOrder(info, original)).toBe(expected); expect(buildTableReadOrder(info, explicit)).toBe(expected); expect(buildTableReadOrder(info, [])).toBe('`id` ASC, `tenant` ASC'); expect(original).toEqual([{ column: 'note', direction }]);
  });
  it.each([
    ['FIRST', 'ASC', 'DESC'], ['FIRST', 'DESC', 'DESC'], ['LAST', 'ASC', 'ASC'], ['LAST', 'DESC', 'ASC']
  ] as const)('%s及%s独立控制NULL桶和值方向', (nulls, direction, bucket) => {
    expect(buildTableReadOrder(source(), [{ column: 'note', direction, nulls }])).toBe(`(\`note\` IS NULL) ${bucket}, \`note\` ${direction}, \`id\` ASC, \`tenant\` ASC`);
  });
  it('复合优先级各自保留NULL位置，显式可靠键不重复追加，空串不被COALESCE转换', () => {
    const rules: SortRule[] = [{ column: 'note', direction: 'DESC', nulls: 'LAST' }, { column: 'id', direction: 'DESC', nulls: 'FIRST' }];
    const sql = buildTableReadOrder(source(), rules);
    expect(sql).toBe('(`note` IS NULL) ASC, `note` DESC, (`id` IS NULL) DESC, `id` DESC, `tenant` ASC'); expect(sql).not.toContain('`id` ASC'); expect(sql).not.toMatch(/COALESCE|IFNULL|CAST|CONVERT|''|\?/);
    expect(rules).toEqual([{ column: 'note', direction: 'DESC', nulls: 'LAST' }, { column: 'id', direction: 'DESC', nulls: 'FIRST' }]);
  });
  it('显式20规则扩为40项表达式仍合法，补键不计入显式预算；第21规则拒绝', () => {
    const names = Array.from({ length: 21 }, (_, index) => 'c' + index), info = source(names), rules: SortRule[] = names.map(column => ({ column, direction: 'ASC', nulls: 'LAST' }));
    const sql = buildTableReadOrder(info, rules.slice(0, tableReadSqlLimits.sorts)); expect(sql.match(/ IS NULL\)/g)).toHaveLength(20); expect(sql).toMatch(/, `id` ASC, `tenant` ASC$/); expect(sql).not.toContain('`c20`');
    expect(() => buildTableReadOrder(info, rules)).toThrow();
  });
  it('精确参数、反引号标识符、WHERE及LIMIT保持，生成SELECT和实际分页使用相同完整ORDER', () => {
    const info = source(), filters: FilterRule[] = [{ column: 'id', operator: '=', value: '18446744073709551615' }, { column: 'amount', operator: 'BETWEEN', values: ['9007199254740993.123456789012345678', '9007199254740993.123456789012345679'] }, { column: 'note', operator: '=', value: '' }];
    const sort: SortRule[] = [{ column: 'n?`', direction: 'ASC', nulls: 'LAST' }, { column: 'amount', direction: 'DESC', nulls: 'FIRST' }];
    const page = buildPageSql(info, 2, 50, filters, sort), old = buildPageSql(info, 2, 50, filters, sort.map(({ column, direction }) => ({ column, direction })));
    expect(page.params).toEqual(['18446744073709551615', '9007199254740993.123456789012345678', '9007199254740993.123456789012345679', '']); expect(page.params).toEqual(old.params);
    expect(page.sql.slice(0, page.sql.indexOf(' ORDER BY '))).toBe(old.sql.slice(0, old.sql.indexOf(' ORDER BY '))); expect(page.sql).toMatch(/ORDER BY \(`n\?``` IS NULL\) ASC, `n\?``` ASC, \(`amount` IS NULL\) DESC, `amount` DESC, `id` ASC, `tenant` ASC LIMIT 51 OFFSET 50$/);
    const generated = buildFilteredTableSelect({ info, filters, sort, columns: ['note'], limit: 50 });
    const order = (sql: string) => sql.slice(sql.indexOf(' ORDER BY '), sql.lastIndexOf(' LIMIT ')); expect(order(generated.sql)).toBe(order(inlineParameters(page.sql, page.params))); expect(generated.parameters).toBe(0); expect(generated.sql).not.toMatch(/COALESCE|IFNULL/);
  });
  it('拒绝非法NULL位置、额外字段/符号、重复或未知列，不能借扩展拼接SQL', () => {
    const info = source(), base = { column: 'note', direction: 'ASC' as const };
    for (const rule of [{ ...base, nulls: 'last' }, { ...base, nulls: null }, { ...base, nulls: true }, { ...base, nulls: 'LAST; DROP TABLE x' }, { ...base, nulls: 'LAST', sql: '任意SQL' }, { ...base, [Symbol('扩展')]: 'FIRST' }, { ...base, column: 'missing', nulls: 'FIRST' }]) expect(() => buildTableReadOrder(info, [rule] as SortRule[])).toThrow();
    expect(() => buildTableReadOrder(info, [{ ...base, nulls: 'FIRST' }, { ...base, nulls: 'LAST' }] as SortRule[])).toThrow();
    expect(() => buildTableReadOrder(info, [Object.defineProperty({ ...base }, 'nulls', { value: 'LAST', enumerable: false })])).toThrow();
  });
  it('自有getter不执行，NULL位置和原字段均只消费数据描述符', () => {
    for (const key of ['column', 'direction', 'nulls']) {
      const getter = vi.fn(() => key === 'column' ? 'note' : key === 'direction' ? 'ASC' : 'FIRST'), rule = { column: 'note', direction: 'ASC' };
      Object.defineProperty(rule, key, { enumerable: true, get: getter }); expect(() => buildTableReadOrder(source(), [rule as SortRule])).toThrow(); expect(getter).not.toHaveBeenCalled();
    }
    const getter = vi.fn(() => 'FIRST'), inherited = Object.assign(Object.create(Object.defineProperty({}, 'nulls', { get: getter })), { column: 'note', direction: 'ASC' });
    expect(buildTableReadOrder(source(), [inherited])).toBe('`note` ASC, `id` ASC, `tenant` ASC'); expect(getter).not.toHaveBeenCalled();
  });
});
