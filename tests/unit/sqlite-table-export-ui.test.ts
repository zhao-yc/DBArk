import { describe, expect, it } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteTableQuery } from '../../src/renderer/sqliteTableBrowser';
import { SqliteTableExportIntent, checkSqliteTableExportOutput } from '../../src/renderer/sqliteTableExportUi';

const page = (): SqliteTablePage => ({ schemaKey: 'a'.repeat(64), target: { connectionId: 'file', database: 'main', table: '奇怪"表🚢', kind: 'table' }, columns: [{ name: 'id', declaredType: 'INTEGER' }, { name: 'mixed', declaredType: '' }, { name: 'g', declaredType: 'INTEGER', generated: true }], result: { columns: [], rows: [], elapsedMs: 0, statement: '', truncated: false }, offset: 10, limit: 5, hasMore: true });
const applied = (): SqliteTableQuery => ({ limit: 5, mode: 'or', filters: [{ column: 'mixed', operator: 'eq', value: { kind: 'integer', value: '9223372036854775807' } }, { column: 'mixed', operator: 'eq', value: { kind: 'text', value: '9223372036854775807' } }], sort: [{ column: 'id', direction: 'desc' }] });
const options = { format: 'csv' as const, encoding: 'utf8' as const, csvDelimiter: ';' as const, columns: ['mixed', 'id'] };

describe('SQLite 全部筛选行意图不借 MySQL 元数据或当前页样本', () => {
  it('第二页也捕获完整typed条件和排序，输入不带offset/limit、SQL、路径或页行值', () => {
    const actual = page(), query = applied(), intent = new SqliteTableExportIntent(actual, query, [], () => true), input = intent.input(options, 'file-token', 'task');
    expect(input).toEqual({ connectionId: 'file', database: 'main', table: '奇怪"表🚢', schemaKey: actual.schemaKey, taskId: 'task', fileToken: 'file-token', mode: 'or', filters: query.filters, sort: query.sort, columns: ['mixed', 'id'], format: 'csv', encoding: 'utf8', csvDelimiter: ';' });
    expect(input.filters[0].value?.kind).toBe('integer'); expect(input.filters[1].value?.kind).toBe('text'); expect(Object.hasOwn(intent.source, 'result')).toBe(false); expect(Object.isFrozen(intent.source.columns)).toBe(true); expect(Object.isFrozen(intent.query.filters[0].value)).toBe(true);
  });
  it.each(['csv', 'json', 'xlsx'] as const)('%s保留显式列序和生成列，SQL严格剔除规则不得伪造可写视图', format => {
    const actual = page(), intent = new SqliteTableExportIntent(actual, applied(), [], () => true);
    expect(intent.input({ format, encoding: 'utf8', columns: ['g', 'mixed'] }, 'file', 'task').columns).toEqual(['g', 'mixed']);
    expect(() => intent.input({ format: 'sql', encoding: 'utf8', columns: ['g', 'id'] }, 'file', 'task')).toThrow();
    expect(intent.input({ format: 'sql', encoding: 'utf8', columns: ['mixed', 'id'] }, 'file', 'task').columns).toEqual(['mixed', 'id']);
    actual.target.kind = 'view'; const view = new SqliteTableExportIntent(actual, applied(), [], () => true); expect(() => view.input({ format: 'sql', encoding: 'utf8', columns: ['id'] }, 'file', 'task')).toThrow('视图');
  });
  it('空列、重复列、未知列与非CSV分隔符拒绝，不自动补列', () => {
    const intent = new SqliteTableExportIntent(page(), applied(), [], () => true);
    for (const columns of [[], ['id', 'id'], ['不存在']]) expect(() => intent.input({ ...options, columns }, 'file', 'task')).toThrow();
    expect(() => intent.input({ ...options, format: 'json' }, 'file', 'task')).toThrow(); expect(intent.input({ format: 'xlsx', encoding: 'gb18030', columns: ['id'] }, 'file', 'task').encoding).toBe('utf8');
  });
  it.each([0, 1, 2, 3, 4, 5])('捕获源第%s项发生ABA永久失效，不能领取后继文件能力', index => {
    const actual = page(), query = applied(), values: unknown[] = [actual, query, {}, {}, 7, true], intent = new SqliteTableExportIntent(actual, query, values, () => true), next = [...values]; next[index] = {};
    intent.observe(next); intent.observe(values); expect(intent.current()).toBe(false); expect(() => intent.input(options, 'file', 'task')).toThrow('失效');
  });
  it('直接变更真实metadata或applied条件也留下墓碑，恢复原文不会复活', () => {
    for (const kind of ['schema', 'generated', 'condition'] as const) {
      const actual = page(), query = applied(), intent = new SqliteTableExportIntent(actual, query, [], () => true);
      if (kind === 'schema') actual.schemaKey = 'b'.repeat(64); else if (kind === 'generated') actual.columns[0].generated = true; else query.filters[0].value!.value = '2';
      expect(intent.current()).toBe(false); if (kind === 'schema') actual.schemaKey = 'a'.repeat(64); else if (kind === 'generated') actual.columns[0].generated = false; else query.filters[0].value!.value = '9223372036854775807'; expect(intent.current()).toBe(false);
    }
  });
  it('schemaKey、页大小与已应用配置必须一致，不能用旧页覆盖新条件', () => {
    const actual = page(); actual.schemaKey = ''; expect(() => new SqliteTableExportIntent(actual, applied(), [], () => true)).toThrow(); const query = applied(); query.limit = 10; expect(() => new SqliteTableExportIntent(page(), query, [], () => true)).toThrow();
  });
  it('仅精确fileCommitted回执确认为成功，访问器/额外字段/负数/进度事件均不冒充落盘', () => {
    expect(checkSqliteTableExportOutput({ rows: 1353, fileCommitted: true })).toEqual({ rows: 1353, fileCommitted: true });
    for (const value of [{ rows: 1, fileCommitted: false }, { rows: -1, fileCommitted: true }, { rows: 1, fileCommitted: true, status: 'completed' }, { taskId: 'q', progress: 100, status: 'completed' }]) expect(() => checkSqliteTableExportOutput(value)).toThrow();
    const hostile = { fileCommitted: true }; Object.defineProperty(hostile, 'rows', { get() { throw Error('不得读取访问器'); }, enumerable: true }); expect(() => checkSqliteTableExportOutput(hostile)).toThrow();
  });
});

describe('SQLite SQL 内容模式的准确投影与旧合同兼容', () => {
  it('旧SQL数据请求省略sqlContent，明确选择data后才携带该字段', () => {
    const intent = new SqliteTableExportIntent(page(), applied(), [], () => true), data = { format: 'sql' as const, encoding: 'utf8' as const, columns: ['mixed', 'id'] };
    expect(Object.hasOwn(intent.input(data, 'file', 'task'), 'sqlContent')).toBe(false); expect(intent.input({ ...data, sqlContent: 'data' }, 'file', 'task')).toHaveProperty('sqlContent', 'data');
  });
  it.each(['table', 'view'] as const)('%s仅结构固定空投影，准确schema/target仍沿原冻结意图', kind => {
    const actual = page(); actual.target.kind = kind; const intent = new SqliteTableExportIntent(actual, applied(), [], () => true);
    const input = intent.input({ format: 'sql', encoding: 'utf8', sqlContent: 'structure', columns: [] }, 'file', 'task'); expect(input).toMatchObject({ table: actual.target.table, schemaKey: actual.schemaKey, columns: [], sqlContent: 'structure', format: 'sql' });
    expect(() => intent.input({ format: 'sql', encoding: 'utf8', sqlContent: 'structure', columns: ['id'] }, 'file', 'task')).toThrow();
    if (kind === 'view') { expect(() => intent.input({ format: 'sql', encoding: 'utf8', columns: ['id'] }, 'file', 'task')).toThrow('视图'); expect(() => intent.input({ format: 'sql', encoding: 'utf8', sqlContent: 'data', columns: ['id'] }, 'file', 'task')).toThrow('视图'); expect(() => intent.input({ format: 'sql', encoding: 'utf8', sqlContent: 'structure-data', columns: ['id', 'mixed'] }, 'file', 'task')).toThrow('视图'); }
  });
  it('结构及数据接受全部非生成列显式重排，拒绝子集、重复、未知或生成列', () => {
    const intent = new SqliteTableExportIntent(page(), applied(), [], () => true), base = { format: 'sql' as const, encoding: 'utf8' as const, sqlContent: 'structure-data' as const };
    expect(intent.input({ ...base, columns: ['mixed', 'id'] }, 'file', 'task').columns).toEqual(['mixed', 'id']);
    for (const columns of [[], ['id'], ['id', 'id'], ['id', 'mixed', 'g'], ['id', '不存在']]) expect(() => intent.input({ ...base, columns }, 'file', 'task')).toThrow();
  });
  it('非SQL或显式undefined不能夹带内容字段，数据模式仍不能空列', () => {
    const intent = new SqliteTableExportIntent(page(), applied(), [], () => true);
    for (const format of ['csv', 'json', 'xlsx'] as const) expect(() => intent.input({ format, encoding: 'utf8', columns: ['id'], sqlContent: 'structure' }, 'file', 'task')).toThrow();
    expect(() => intent.input({ format: 'sql', encoding: 'utf8', columns: ['id'], sqlContent: undefined }, 'file', 'task')).toThrow();
    expect(() => intent.input({ format: 'sql', encoding: 'utf8', columns: [], sqlContent: 'data' }, 'file', 'task')).toThrow();
  });
  it('结构模式也不能复活过期来源，0行可信提交回执仍表示已保存文件', () => {
    const actual = page(), intent = new SqliteTableExportIntent(actual, applied(), [], () => true); actual.schemaKey = 'b'.repeat(64); expect(() => intent.input({ format: 'sql', encoding: 'utf8', columns: [], sqlContent: 'structure' }, 'file', 'task')).toThrow('失效');
    expect(checkSqliteTableExportOutput({ rows: 0, fileCommitted: true })).toEqual({ rows: 0, fileCommitted: true });
  });
});
