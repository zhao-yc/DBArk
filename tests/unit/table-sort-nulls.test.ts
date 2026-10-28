import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SortRule, TableInfo } from '../../src/shared/contracts';
import { sortRulesSchema } from '../../src/shared/filtering';
import { validateCommand } from '../../src/shared/validation';
import { tableSortFromGrid, tableSortRuleSummary, validateTableSort } from '../../src/renderer/tableSort';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { planTableFilteredExport } from '../../src/engine/tableFilteredExport';

/** 真实元数据描述包含未输出的可空排序列和可靠主键，不创建网络或文件任务。 */
function source(): TableInfo {
  return { database: 'd', name: 't', objectKind: 'table', engine: 'InnoDB', ddl: 'CREATE TABLE t(id BIGINT PRIMARY KEY,note TEXT)', indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], columns: ['id', 'note'].map(name => ({ name, type: name === 'id' ? 'BIGINT' : 'TEXT', nullable: name !== 'id', defaultValue: null, generated: false, extra: '', comment: '' })) };
}

describe('NULL位置的表页契约、列头与完整导出', () => {
  it('正式分页和导出IPC保留每列位置，缺省不补新属性，独立复制规则', () => {
    const sort: SortRule[] = [{ column: 'note', direction: 'DESC', nulls: 'FIRST' }, { column: 'id', direction: 'ASC', nulls: 'LAST' }];
    const target = { connectionId: 'c', database: 'd', table: 't' };
    const page = { ...target, page: 1, pageSize: 100, filters: [], sort };
    const exported = { ...target, taskId: randomUUID(), fileToken: randomUUID(), metadataKey: tableCopyMetadataKey(source()), filters: [], sort, format: 'json', encoding: 'utf8' };
    expect(validateCommand('table.page', page)).toEqual(page);
    expect(() => validateCommand('table.page', { ...page, taskId: randomUUID() })).toThrow('copySource');
    expect(validateCommand('table.exportFiltered', exported)).toEqual(exported);
    const copy = validateTableSort(sort, ['id', 'note']); copy[0].nulls = 'LAST'; expect(sort[0].nulls).toBe('FIRST');
    expect(sortRulesSchema.parse([{ column: 'id', direction: 'ASC' }])).toEqual([{ column: 'id', direction: 'ASC' }]);
  });
  it('未知NULL位置、SQL扩展、符号、getter和稀疏规则全部拒绝且不调用访问器', () => {
    const read = vi.fn(() => 'FIRST'), rule = { column: 'note', direction: 'ASC' };
    for (const value of [null, '', 'first', 'DEFAULT', 'FIRST DESC; SELECT 1', 1]) expect(sortRulesSchema.safeParse([{ ...rule, nulls: value }]).success).toBe(false);
    for (const input of [[{ ...rule, sql: 'ORDER BY injected' }], [{ ...rule, [Symbol('extra')]: true }], [Object.defineProperty({ ...rule }, 'nulls', { enumerable: true, get: read })], Object.defineProperty([], '0', { enumerable: true, get: read }), new Array(1)]) expect(sortRulesSchema.safeParse(input).success).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
  it('列头改方向或优先级保留同列NULL设置，移除后重新加入按默认，不遗留隐式规则', () => {
    const previous: SortRule[] = [{ column: 'note', direction: 'ASC', nulls: 'LAST' }, { column: 'id', direction: 'DESC', nulls: 'FIRST' }];
    const changed = tableSortFromGrid([{ columnKey: 'id', direction: 'ASC' }, { columnKey: 'note', direction: 'DESC' }], previous, ['id', 'note']);
    expect(changed).toEqual([{ column: 'id', direction: 'ASC', nulls: 'FIRST' }, { column: 'note', direction: 'DESC', nulls: 'LAST' }]);
    const removed = tableSortFromGrid([{ columnKey: 'id', direction: 'ASC' }], changed, ['id', 'note']);
    expect(tableSortFromGrid([{ columnKey: 'note', direction: 'ASC' }], removed, ['id', 'note'])).toEqual([{ column: 'note', direction: 'ASC' }]); expect(previous[0].direction).toBe('ASC');
  });
  it.each(['csv', 'json', 'sql', 'xlsx'] as const)('%s完整导出沿同一NULL顺序，未投影排序列仍生效，只有补键不带LIMIT', format => {
    const info = source(), sort: SortRule[] = [{ column: 'note', direction: 'DESC', nulls: 'LAST' }];
    const plan = planTableFilteredExport(info, { connectionId: 'c', database: 'd', table: 't', taskId: randomUUID(), fileToken: randomUUID(), metadataKey: tableCopyMetadataKey(info), filters: [], sort, columns: ['id'], format, encoding: 'utf8' });
    expect(plan.sql).toBe('SELECT `id` FROM `d`.`t` ORDER BY (`note` IS NULL) ASC, `note` DESC, `id` ASC'); expect(plan.columns.map(column => column.name)).toEqual(['id']);
  });
  it('中文范围摘要仅为显式NULL设置加注，默认显示逐字保持', () => {
    expect(tableSortRuleSummary({ column: 'note', direction: 'DESC' })).toBe('note DESC');
    expect(tableSortRuleSummary({ column: 'note', direction: 'ASC', nulls: 'FIRST' })).toBe('note ASC · NULL置前');
    expect(tableSortRuleSummary({ column: 'note', direction: 'DESC', nulls: 'LAST' })).toBe('note DESC · NULL置后');
  });
});
