import { expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { assertSqliteIncomingOutput, sqliteIncomingInputSchema, type SqliteIncomingInput, type SqliteIncomingOutput } from '../../src/shared/sqliteIncoming';
import { SqliteIncomingReader } from '../../src/renderer/sqliteIncomingReader';
const source: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: 'parent', kind: 'table' }, schemaKey: 'a'.repeat(64), columns: [{ name: 'id', declaredType: 'INTEGER' }], storageTypes: ['i'], offset: 0, limit: 50, hasMore: false, result: { columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }], rows: [{ c0: '9223372036854775807' }], elapsedMs: 0, statement: '', truncated: false } };
const entry = { table: 'child', schemaKey: 'b'.repeat(64), key: { ordinal: 0, columns: ['p'], referencedTable: 'PARENT', referencedColumns: null, onUpdate: 'NO ACTION' as const, onDelete: 'NO ACTION' as const }, referencedColumns: ['id'] };
const parent = { name: 'parent', columns: [{ name: 'id', type: 'INTEGER', notNull: true, primaryKey: 1, hidden: 0 }], foreignKeys: [] };
function reply(request: SqliteIncomingInput): SqliteIncomingOutput { return { request, source: parent, references: [entry], ...(request.incoming === 'page' ? { page: { ...source, target: { ...source.target, table: 'child' }, schemaKey: entry.schemaKey, columns: [{ name: 'p', declaredType: '' }], storageTypes: ['t'], result: { ...source.result, columns: [{ key: 'c0', name: 'p', type: 'SQLITE' }], rows: [{ c0: '原始子值' }] }, offset: request.offset, limit: request.limit } } : {}) }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture() { let current = true, n = 0; const services = { read: vi.fn(async (request: SqliteIncomingInput) => reply(request)), cancel: vi.fn(async (_id: string) => {}), id: () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0') }, reader = new SqliteIncomingReader(source, [{ kind: 'integer', value: '9223372036854775807' }], () => current, services); return { reader, services, invalidate: () => { current = false; }, restore: () => { current = true; } }; }
it('打开零读取，明确目录不带父值；子页原INTEGER不丢精度并强绑子表hash及外键编号', async () => {
  const f = fixture(); expect(f.services.read).not.toHaveBeenCalled(); await f.reader.catalog(); expect(f.services.read.mock.calls[0][0]).not.toHaveProperty('values');
  await f.reader.page(entry, 50); expect(f.services.read.mock.calls[1][0]).toMatchObject({ incoming: 'page', childTable: 'child', childSchemaKey: entry.schemaKey, foreignKey: 0, values: [{ kind: 'integer', value: '9223372036854775807' }], offset: 50, limit: 50 });
});
it.each(['read-first', 'ack-first'] as const)('%s取消等待准确原读和ACK；迟到子页拒绝，不允许重入目录读取', async order => {
  const f = fixture(), pending = deferred<SqliteIncomingOutput>(), ack = deferred<void>(); f.services.read.mockReturnValueOnce(pending.promise); f.services.cancel.mockReturnValueOnce(ack.promise);
  const reading = f.reader.page(entry, 0), rejected = expect(reading).rejects.toThrow('停止'); await Promise.resolve(); const request = f.services.read.mock.calls[0][0], stop = f.reader.stop(); await expect(f.reader.catalog()).rejects.toThrow('仍在读取');
  if (order === 'read-first') pending.resolve(reply(request)); else ack.resolve(); await Promise.resolve(); expect(f.reader.busy).toBe(true);
  if (order === 'read-first') ack.resolve(); else pending.resolve(reply(request)); await stop; await rejected; expect(f.reader.busy).toBe(false); expect(f.services.cancel).toHaveBeenCalledExactlyOnceWith(request.taskId);
});
it('未发送即停止不投递cancel；来源ABA永久撤权', async () => {
  const f = fixture(), reading = f.reader.catalog(), rejected = expect(reading).rejects.toThrow('停止'); await f.reader.stop(); await rejected; expect(f.services.read).not.toHaveBeenCalled(); expect(f.services.cancel).not.toHaveBeenCalled();
  f.invalidate(); expect(f.reader.current()).toBe(false); f.restore(); await expect(f.reader.catalog()).rejects.toThrow('失效');
});
it('未解析声明和不完整父键不猜rowid、默认值或截断值', async () => {
  const f = fixture(); await expect(f.reader.page({ ...entry, referencedColumns: null }, 0)).rejects.toThrow('无法解析');
  const reader = new SqliteIncomingReader(source, [undefined], () => true, f.services); expect(() => reader.page(entry, 0)).toThrow('原值无法完整'); expect(f.services.read).not.toHaveBeenCalled();
});
it.each(['target', 'schema', 'offset', 'truncated', 'storage', 'request', 'mapping', 'duplicate'] as const)('%s伪造回包不授予反向子页读取权', mode => {
  const request: SqliteIncomingInput = { connectionId: 'c', database: 'main', table: 'parent', schemaKey: source.schemaKey, taskId: '00000000-0000-4000-8000-000000000001', incoming: 'page', childTable: 'child', childSchemaKey: entry.schemaKey, foreignKey: 0, values: [{ kind: 'integer', value: '1' }], offset: 0, limit: 50 }, value = structuredClone(reply(request));
  if (mode === 'target') value.page!.target.table = 'other'; if (mode === 'schema') value.page!.schemaKey = 'c'.repeat(64); if (mode === 'offset') value.page!.offset++; if (mode === 'truncated') value.page!.result.truncated = true; if (mode === 'storage') value.page!.storageTypes = ['b']; if (mode === 'request') value.request = { ...request, foreignKey: 9 }; if (mode === 'mapping') value.references[0].referencedColumns = ['other']; if (mode === 'duplicate') value.references.push(value.references[0]);
  expect(() => assertSqliteIncomingOutput(value, request)).toThrow();
});
it('共享合同拒绝路径、SQL、超预算页长、空元组和目录夹带父值', () => {
  const valid = { connectionId: 'c', database: 'main', table: 'parent', schemaKey: source.schemaKey, taskId: '00000000-0000-4000-8000-000000000001', incoming: 'catalog' };
  for (const patch of [{ path: '/不读取' }, { sql: 'SELECT 1' }, { values: [{ kind: 'null' }] }, { database: 'temp' }]) expect(sqliteIncomingInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  expect(sqliteIncomingInputSchema.safeParse({ ...valid, incoming: 'page', childTable: 'child', childSchemaKey: entry.schemaKey, foreignKey: 0, values: [], offset: 0, limit: 201 }).success).toBe(false);
});
