import { describe, expect, it, vi } from 'vitest';
import { assertSqliteRelationships, sqliteRelationshipsInputSchema, sqliteRelationshipName, type SqliteRelationshipsInput, type SqliteRelationshipsOutput } from '../../src/shared/sqliteRelationships';
import { captureSqliteRelationshipDiagram } from '../../src/renderer/sqliteRelationshipDiagram';
import { SqliteRelationshipReader } from '../../src/renderer/sqliteRelationshipReader';

const request: SqliteRelationshipsInput = { connectionId: 'file', database: 'main', taskId: '3b1e5cde-66f1-467e-b851-8359c2ef2bba', anchor: { table: 'Child', schemaKey: 'a'.repeat(64) }, tables: ['Child', 'Parent'] };
/** 合成目录只用于合同和显示模型，不替代后续真实worker/界面验收。 */
function fixture(): SqliteRelationshipsOutput {
  return { request: structuredClone(request), schemaVersion: '1', tables: [
    { name: 'Child', columns: [{ name: 'fkA', type: '', notNull: false, primaryKey: 0, hidden: 0 }, { name: 'fkB', type: 'INTEGER', notNull: true, primaryKey: 0, hidden: 0 }], foreignKeys: [{ ordinal: 0, columns: ['FKA', 'fkb'], referencedTable: 'PARENT', referencedColumns: null, onUpdate: 'CASCADE', onDelete: 'NO ACTION' }] },
    { name: 'Parent', columns: [{ name: 'a', type: 'TEXT', notNull: true, primaryKey: 2, hidden: 0 }, { name: 'b', type: 'INTEGER', notNull: false, primaryKey: 1, hidden: 0 }], foreignKeys: [] },
  ] };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
describe('SQLite关系图合同与语义', () => {
  it('隐式父键使用声明主键顺序，ASCII引用指向真实大小写且空声明类型保留', () => {
    const graph = captureSqliteRelationshipDiagram(fixture(), request);
    expect(graph.nodes).toHaveLength(2); expect(graph.nodes.every(node => !node.external)).toBe(true);
    expect(graph.edges[0].key).toMatchObject({ columns: ['fkA', 'fkB'], referencedTable: 'Parent', referencedColumns: ['b', 'a'], implicit: true });
    expect(graph.edges[0].key.warning).toBeUndefined(); expect(graph.tables[0].columns[0]).toMatchObject({ type: '', notNullDeclared: false });
    expect(sqliteRelationshipName('AÄİ')).toBe('aÄİ');
  });
  it.each(['unread', 'no-pk', 'arity', 'missing-column'] as const)('%s保留声明和未确认说明，不猜测rowid或丢关系', mode => {
    const value = fixture();
    if (mode === 'unread') { value.tables.pop(); value.request.tables.pop(); }
    if (mode === 'no-pk') value.tables[1].columns.forEach(column => { column.primaryKey = 0; });
    if (mode === 'arity') { value.tables[1].columns[0].primaryKey = 0; }
    if (mode === 'missing-column') value.tables[0].foreignKeys[0].referencedColumns = ['not_here', 'b'];
    const graph = captureSqliteRelationshipDiagram(value, value.request);
    expect(graph.edges).toHaveLength(1); expect(graph.edges[0].key.warning).toBeTruthy();
    if (mode !== 'missing-column') expect(graph.edges[0].key.referencedColumns).toEqual([]);
    expect(graph.nodes.filter(node => node.external)).toHaveLength(mode === 'unread' ? 1 : 0);
  });
  it('同名自引用、重复字段声明和未读取目标只保留一个正确节点', () => {
    const value = fixture(); value.tables[0].foreignKeys.push({ ordinal: 1, columns: ['fkA', 'fkA'], referencedTable: 'cHiLd', referencedColumns: ['fka', 'fka'], onUpdate: 'NO ACTION', onDelete: 'NO ACTION' });
    const graph = captureSqliteRelationshipDiagram(value, request); expect(graph.edges[1].source).toBe(graph.edges[1].target); expect(graph.edges[1].key.referencedColumns).toEqual(['fkA', 'fkA']);
  });
  it.each([{ tables: ['Child', 'child'] }, { tables: ['Parent'] }, { database: 'temp' }, { sessionId: 'user' }, { sql: 'SELECT 1' }, { taskId: 'reused-string' }])('严格拒绝错误范围或额外可执行输入%j', patch => { expect(sqliteRelationshipsInputSchema.safeParse({ ...request, ...patch }).success).toBe(false); });
  it('回包绑定准确任务和选择，拒绝重排、重复编号、PK序号缺口和半份列映射', () => {
    for (const mutate of [
      (value: SqliteRelationshipsOutput) => { value.request.taskId = crypto.randomUUID(); },
      (value: SqliteRelationshipsOutput) => { value.tables.reverse(); },
      (value: SqliteRelationshipsOutput) => { value.tables[0].columns.push({ ...value.tables[0].columns[0] }); },
      (value: SqliteRelationshipsOutput) => { value.tables[1].columns[0].primaryKey = 3; },
      (value: SqliteRelationshipsOutput) => { value.tables[0].foreignKeys.push({ ...value.tables[0].foreignKeys[0] }); },
      (value: SqliteRelationshipsOutput) => { value.tables[0].foreignKeys[0].referencedColumns = ['a']; },
    ]) { const value = fixture(); mutate(value); expect(() => assertSqliteRelationships(value, request)).toThrow(); }
  });
  it('表、字段、外键、复合部分及UTF8字节预算整份执行，不截断图', () => {
    expect(sqliteRelationshipsInputSchema.safeParse({ ...request, tables: ['Child', ...Array.from({ length: 40 }, (_, index) => 't' + index)] }).success).toBe(false);
    const columns = fixture(); columns.tables.forEach((table, index) => { table.columns = Array.from({ length: index ? 1001 : 1000 }, (_, ordinal) => ({ name: 'c' + ordinal, type: '', notNull: false, primaryKey: 0, hidden: 0 })); table.foreignKeys = []; });
    expect(() => assertSqliteRelationships(columns, request)).toThrow('预算');
    const keys = fixture(); keys.tables[0].foreignKeys = Array.from({ length: 300 }, (_, ordinal) => ({ ...keys.tables[0].foreignKeys[0], ordinal })); keys.tables[1].foreignKeys = [{ ...keys.tables[0].foreignKeys[0], columns: ['a', 'b'] }];
    expect(() => assertSqliteRelationships(keys, request)).toThrow('预算');
    const parts = fixture(); parts.tables[0].foreignKeys[0].columns = Array(65).fill('fkA'); expect(() => assertSqliteRelationships(parts, request)).toThrow();
    const bytes = fixture(); bytes.tables.forEach(table => { table.foreignKeys = []; table.columns = Array.from({ length: 400 }, (_, index) => ({ name: 'c' + index, type: '中'.repeat(4096), notNull: false, primaryKey: 0, hidden: 0 })); }); expect(() => assertSqliteRelationships(bytes, request)).toThrow('预算');
  });
});
describe('SQLite整图读取租约', () => {
  it.each(['read-first', 'ack-first'] as const)('%s取消仅原编号，两侧终态前不释放busy或接纳新轮', async order => {
    const result = deferred<SqliteRelationshipsOutput>(), ack = deferred<void>(), read = vi.fn((_input: SqliteRelationshipsInput) => result.promise), cancel = vi.fn(() => ack.promise);
    const reader = new SqliteRelationshipReader(request, { objects: vi.fn(), read, cancel }, () => true);
    const pending = reader.read(request.tables).catch(reason => reason); await Promise.resolve(); const actual = read.mock.calls[0][0];
    const stopping = reader.stop(); await Promise.resolve(); expect(cancel).toHaveBeenCalledExactlyOnceWith(actual.taskId);
    const output = fixture(); output.request = actual;
    if (order === 'read-first') result.resolve(output); else ack.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(reader.busy).toBe(true); await expect(reader.read(request.tables)).rejects.toThrow(); expect(read).toHaveBeenCalledTimes(1);
    if (order === 'read-first') ack.resolve(); else result.resolve(output); await stopping; expect(await pending).toBeInstanceOf(Error); expect(reader.busy).toBe(false);
  });
  it('迟到目录和恢复原目标均不能复活失效租约，也不发结构请求', async () => {
    let current = true; const result = deferred<never[]>(), read = vi.fn(), reader = new SqliteRelationshipReader(request, { objects: () => result.promise, read, cancel: vi.fn() }, () => current);
    const pending = reader.catalog().catch(reason => reason); await Promise.resolve(); current = false; reader.current(); current = true; result.resolve([]); expect(await pending).toBeInstanceOf(Error); await expect(reader.read(request.tables)).rejects.toThrow(); expect(read).not.toHaveBeenCalled();
  });
  it('整轮只发一个快照请求，复制源指纹并拒绝另一任务回包', async () => {
    const source = structuredClone(request), read = vi.fn(async (_input: SqliteRelationshipsInput) => fixture());
    const reader = new SqliteRelationshipReader(source, { objects: vi.fn(), read, cancel: vi.fn() }, () => true); source.anchor.schemaKey = 'b'.repeat(64);
    await expect(reader.read(request.tables)).rejects.toThrow(); expect(read).toHaveBeenCalledTimes(1); expect(read.mock.calls[0][0]).toMatchObject({ anchor: request.anchor, tables: request.tables });
  });
});
