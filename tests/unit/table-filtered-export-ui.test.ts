import { describe, expect, it, vi } from 'vitest';
import type { FilterRule, TableInfo } from '../../src/shared/contracts';
import { TableFilteredExportIntent, checkTableFilteredExportOutput } from '../../src/renderer/tableFilteredExportUi';

const source = (): TableInfo => ({ database: 'd', name: 'subject', objectKind: 'table', engine: 'InnoDB', ddl: 'CREATE TABLE subject(id BIGINT,g INT GENERATED ALWAYS AS(1))', columns: [
  { name: 'id', type: 'BIGINT', nullable: false, defaultValue: null, generated: false, extra: '', comment: '' },
  { name: 'g', type: 'INT', nullable: true, defaultValue: null, generated: true, extra: 'GENERATED', comment: '' },
], indexes: [], primaryKey: ['id'], editableKey: ['id'], foreignKeys: [] });
const target = { connectionId: 'c', database: 'd', table: 'subject' };

describe('全量筛选行导出原来源与完整配置', () => {
  it('完整保留原嵌套OR、停用项、精确值和多列排序，快照深冻结且与原对象独立', () => {
    const info = source(), filters: FilterRule[] = [{ column: 'id', operator: 'IN', values: ['9007199254740993', '9007199254740992'] }, { column: 'g', operator: '=', value: '1', enabled: false }];
    const conditions = { filters, filterMode: 'any' as const, filterGroup: { mode: 'any' as const, children: [0, { mode: 'all' as const, children: [1] }] } }, sort = [{ column: 'g', direction: 'DESC' as const }, { column: 'id', direction: 'ASC' as const }];
    const original = structuredClone({ info, conditions, sort }), intent = new TableFilteredExportIntent(target, info, conditions, sort, [], () => true);
    expect(intent.conditions).toEqual(conditions); expect(intent.sort).toEqual(sort); expect({ info, conditions, sort }).toEqual(original);
    expect(Object.isFrozen(intent.source.columns[0])).toBe(true); expect(Object.isFrozen(intent.conditions.filters[0].values)).toBe(true); expect(Object.isFrozen(intent.conditions.filterGroup!.children)).toBe(true); expect(Object.isFrozen(intent.sort)).toBe(true);
    filters[0].values![0] = 'changed'; info.columns[0].comment = 'changed'; expect(intent.source.columns[0].comment).toBe(''); expect(intent.conditions.filters[0].values![0]).toBe('9007199254740993');
  });
  it.each(['csv', 'json', 'sql', 'xlsx'] as const)('四格式参数不包含当前页、行样本、CSV字段投影或路径 %s', format => {
    const intent = new TableFilteredExportIntent(target, source(), { filters: [], filterMode: 'all' }, [], [], () => true), input = intent.input({ format, encoding: 'gb18030', ...(format === 'csv' ? { csvDelimiter: ';' } : {}) }, 'file', 'task');
    expect(input).toMatchObject({ ...target, format, encoding: format === 'xlsx' ? 'utf8' : 'gb18030', filters: [], sort: [], fileToken: 'file', taskId: 'task' });
    expect(input.metadataKey).toBe(intent.metadataKey); for (const key of ['page', 'pageSize', 'rows', 'csvSelection', 'filePath', 'result']) expect(Object.hasOwn(input, key)).toBe(false);
    expect(Object.hasOwn(input, 'csvDelimiter')).toBe(format === 'csv');
  });
  it('每个input使用独立副本，不能借回包或调用方原地改写后续导出条件', () => {
    const intent = new TableFilteredExportIntent(target, source(), { filters: [{ column: 'id', operator: '=', value: '9007199254740993' }], filterMode: 'all' }, [{ column: 'id', direction: 'DESC' }], [], () => true);
    const input = intent.input({ format: 'csv', encoding: 'utf8' }, 'file', 'task'); input.filters[0].value = 'changed'; input.sort[0].direction = 'ASC';
    expect(intent.input({ format: 'json', encoding: 'utf8' }, 'other', 'next').filters[0].value).toBe('9007199254740993'); expect(intent.sort[0].direction).toBe('DESC');
  });
  it('父来源失效再恢复true不能复活，observe引用ABA同样永久失效', () => {
    let allowed = true; const original = {}, intent = new TableFilteredExportIntent(target, source(), { filters: [], filterMode: 'all' }, [], [original], () => allowed);
    allowed = false; expect(intent.current()).toBe(false); allowed = true; expect(intent.current()).toBe(false); expect(() => intent.input({ format: 'csv', encoding: 'utf8' }, 'file', 'task')).toThrow();
    const second = new TableFilteredExportIntent(target, source(), { filters: [], filterMode: 'all' }, [], [original], () => true); second.observe([{}]); second.observe([original]); expect(second.current()).toBe(false);
  });
  it('失效通知异步发送一次且可取消订阅，不在父渲染直接重入子组件', async () => {
    const intent = new TableFilteredExportIntent(target, source(), { filters: [], filterMode: 'all' }, [], [], () => true), listener = vi.fn(), removed = vi.fn(); intent.subscribe(listener); const unsubscribe = intent.subscribe(removed); unsubscribe(); intent.invalidate(); intent.invalidate(); expect(listener).not.toHaveBeenCalled(); await Promise.resolve(); expect(listener).toHaveBeenCalledOnce(); expect(removed).not.toHaveBeenCalled();
  });
  it('错误库、未知类型、缺失字段、重复排序及不完整分组不能产生意图', () => {
    expect(() => new TableFilteredExportIntent({ ...target, database: 'other' }, source(), { filters: [], filterMode: 'all' }, [], [], () => true)).toThrow();
    expect(() => new TableFilteredExportIntent(target, { ...source(), objectKind: undefined }, { filters: [], filterMode: 'all' }, [], [], () => true)).toThrow();
    expect(() => new TableFilteredExportIntent(target, source(), { filters: [{ column: 'missing', operator: 'IS NULL' }], filterMode: 'all' }, [], [], () => true)).toThrow();
    expect(() => new TableFilteredExportIntent(target, source(), { filters: [], filterMode: 'all' }, [{ column: 'id', direction: 'ASC' }, { column: 'id', direction: 'DESC' }], [], () => true)).toThrow();
    expect(() => new TableFilteredExportIntent(target, source(), { filters: [{ column: 'id', operator: 'IS NULL' }], filterMode: 'all', filterGroup: { mode: 'all', children: [] } }, [], [], () => true)).toThrow();
  });
  it('CSV分隔符不夹带其它格式，所有字段均生成时拒绝SQL', () => {
    const info = source(); info.columns.forEach(column => { column.generated = true; }); const intent = new TableFilteredExportIntent(target, info, { filters: [], filterMode: 'all' }, [], [], () => true);
    expect(() => intent.input({ format: 'json', encoding: 'utf8', csvDelimiter: ';' }, 'file', 'task')).toThrow(); expect(() => intent.input({ format: 'sql', encoding: 'utf8' }, 'file', 'task')).toThrow(); expect(() => intent.input({ format: 'xlsx', encoding: 'utf8' }, 'file', 'task')).not.toThrow();
  });
  it('视图可能包含无法识别为generated的表达式，SQL仍明确拒绝，三数据格式保留', () => {
    const view = { ...source(), objectKind: 'view' as const, engine: '' }; view.columns.forEach(column => { column.generated = false; });
    const intent = new TableFilteredExportIntent(target, view, { filters: [], filterMode: 'all' }, [], [], () => true);
    expect(() => intent.input({ format: 'sql', encoding: 'utf8' }, 'file', 'task')).toThrow('视图');
    for (const format of ['csv', 'json', 'xlsx'] as const) expect(() => intent.input({ format, encoding: 'utf8' }, 'file', 'task')).not.toThrow();
  });
});
describe('完整文件落盘回执', () => {
  it('仅原rows与fileCommitted:true证明完成，0行是合法空匹配输出', () => { expect(checkTableFilteredExportOutput({ rows: 0, fileCommitted: true })).toEqual({ rows: 0, fileCommitted: true }); expect(checkTableFilteredExportOutput({ rows: 1105, fileCommitted: true }).rows).toBe(1105); });
  it.each([{ rows: -1, fileCommitted: true }, { rows: 1.1, fileCommitted: true }, { rows: 2, fileCommitted: false }, { rows: 2 }, { rows: '2', fileCommitted: true }, { rows: 2, fileCommitted: true, done: true }])('未知或未提交回执拒绝 %j', value => { expect(() => checkTableFilteredExportOutput(value)).toThrow(); });
  it('回执getter不能执行为成功', () => { const getter = vi.fn(() => 1), value = { fileCommitted: true }; Object.defineProperty(value, 'rows', { enumerable: true, get: getter }); expect(() => checkTableFilteredExportOutput(value)).toThrow(); expect(getter).not.toHaveBeenCalled(); });
});

describe('完整流式导出字段投影的意图参数', () => {
  /** 增加普通字段供四格式排序测试，生成列仍保留为SQL拒绝反例。 */
  function projectedIntent() { const info = source(); info.columns.splice(1, 0, { ...info.columns[0], name: 'name', type: 'VARCHAR(80)' }); return new TableFilteredExportIntent(target, info, { filters: [], filterMode: 'all' }, [{ column: 'g', direction: 'DESC' }], [], () => true); }
  it.each(['csv', 'json', 'sql', 'xlsx'] as const)('%s保留精确选择与顺序，每次input复制数组且不污染后续配置', format => {
    const intent = projectedIntent(), columns = ['name', 'id'], options = { format, encoding: 'utf8' as const, columns }, input = intent.input(options, 'file', 'task');
    expect(input.columns).toEqual(['name', 'id']); expect(input.columns).not.toBe(columns); expect(input.sort).toEqual([{ column: 'g', direction: 'DESC' }]);
    columns.reverse(); expect(input.columns).toEqual(['name', 'id']); input.columns!.push('changed');
    expect(intent.input(options, 'next-file', 'next-task').columns).toEqual(['id', 'name']); expect(intent.source.columns.map(column => column.name)).toEqual(['id', 'name', 'g']);
  });
  it.each(['csv', 'json', 'sql', 'xlsx'] as const)('%s未提供columns保留旧全列协议，显式undefined不伪造空选择', format => {
    const intent = projectedIntent();
    expect(Object.hasOwn(intent.input({ format, encoding: 'utf8' }, 'file', 'task'), 'columns')).toBe(false);
    expect(Object.hasOwn(intent.input({ format, encoding: 'utf8', columns: undefined }, 'file', 'task'), 'columns')).toBe(false);
  });
  it.each(['csv', 'json', 'sql', 'xlsx'] as const)('%s空选择、重复及未知列拒绝，不静默回退全部字段', format => {
    const intent = projectedIntent();
    for (const columns of [[], ['id', 'id'], ['unknown'], ['name', 'unknown']]) expect(() => intent.input({ format, encoding: 'utf8', columns }, 'file', 'task')).toThrow();
  });
  it('仅SQL显式选择生成列拒绝，三数据格式保留生成列及调用方顺序', () => {
    const intent = projectedIntent(); expect(() => intent.input({ format: 'sql', encoding: 'utf8', columns: ['g'] }, 'file', 'task')).toThrow();
    expect(() => intent.input({ format: 'sql', encoding: 'utf8', columns: ['id', 'g'] }, 'file', 'task')).toThrow();
    for (const format of ['csv', 'json', 'xlsx'] as const) expect(intent.input({ format, encoding: 'utf8', columns: ['g', 'id'] }, 'file', 'task').columns).toEqual(['g', 'id']);
    expect(intent.input({ format: 'sql', encoding: 'utf8', columns: ['name', 'id'] }, 'file', 'task').columns).toEqual(['name', 'id']);
  });
});
