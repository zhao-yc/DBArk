import { expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { assertSqliteReferenceOutput, sqliteReferenceInputSchema, type SqliteReferenceInput, type SqliteReferenceOutput } from '../../src/shared/sqliteReference';
import { SqliteReferenceReader } from '../../src/renderer/sqliteReferenceReader';
import { captureSqliteReferenceSource } from '../../src/renderer/sqliteReferenceSource';
import type { SqliteDraftRow } from '../../src/renderer/sqliteTableEditor';
import { sqliteReferenceTuple, sqliteReferenceDraft, assertSqliteReferenceChoice } from '../../src/renderer/sqliteReferenceChoice';

const key = { ordinal: 0, columns: ['p'], referencedTable: 'PARENT', referencedColumns: null, onUpdate: 'NO ACTION' as const, onDelete: 'NO ACTION' as const };
const child = { name: 'child', columns: [{ name: 'p', type: '', notNull: false, primaryKey: 0, hidden: 0 }], foreignKeys: [key] };
const parent = { name: 'parent', columns: [{ name: 'id', type: 'INTEGER', notNull: true, primaryKey: 1, hidden: 0 }], foreignKeys: [] };
function page(): SqliteTablePage { return { target: { connectionId: 'c', database: 'main', table: 'child', kind: 'table' }, schemaKey: 'a'.repeat(64), columns: [{ name: 'p', declaredType: '' }], storageTypes: ['t'], offset: 0, limit: 50, hasMore: false, result: { columns: [{ key: 'c0', name: 'p', type: 'SQLITE' }], rows: [{ c0: '001' }], elapsedMs: 0, statement: '', truncated: false } }; }
function reply(request: SqliteReferenceInput): SqliteReferenceOutput {
  if (request.reference === 'catalog') return { request, source: child };
  const p = page(); p.target.table = 'parent'; p.schemaKey = 'b'.repeat(64); p.columns = [{ name: 'id', declaredType: 'INTEGER' }]; p.result.columns = [{ key: 'c0', name: 'id', type: 'SQLITE' }]; p.result.rows = [{ c0: '1' }]; p.storageTypes = ['i']; p.offset = request.offset; p.limit = request.limit;
  return { request, source: child, parent, referencedColumns: ['id'], page: p };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture() { let current = true, n = 0; const services = { read: vi.fn(async (request: SqliteReferenceInput) => reply(request)), cancel: vi.fn(async (_id: string) => {}), id: () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0') }, source = page(), reader = new SqliteReferenceReader(source, [{ kind: 'text', value: '001' }], () => current, services); return { services, reader, source, invalidate: () => { current = false; }, restore: () => { current = true; } }; }

it('父候选不发送子值；搜索分页与确认复读绑定父结构，未填写的新行也能读候选', async () => {
  const f = fixture(), search = { column: 'id', text: '1' };
  const candidate = await f.reader.candidates(key, 0, search); await f.reader.candidates(key, 50, search);
  expect(f.services.read.mock.calls[0][0]).toMatchObject({ reference: 'candidates', search }); expect(f.services.read.mock.calls[0][0]).not.toHaveProperty('values');
  expect(f.services.read.mock.calls[1][0]).toHaveProperty('parentSchemaKey', candidate.page!.schemaKey);
  const values = sqliteReferenceTuple(candidate, 0), proof = await f.reader.verify(key, values, candidate.page!.schemaKey);
  assertSqliteReferenceChoice(proof, values); expect(f.services.read.mock.calls[2][0]).toMatchObject({ reference: 'page', values: [{ kind: 'integer', value: '1' }], limit: 200, parentSchemaKey: candidate.page!.schemaKey });
  const fresh = new SqliteReferenceReader(f.source, [undefined], () => true, f.services); await fresh.candidates(key, 0);
});
it.each(['null', 'missing', 'collation'] as const)('%s父键不能伪装为原选择仍存在', mode => {
  const request: SqliteReferenceInput = { connectionId: 'c', database: 'main', table: 'child', schemaKey: 'a'.repeat(64), taskId: '00000000-0000-4000-8000-000000000001', reference: 'page', foreignKey: 0, values: [{ kind: 'text', value: 'Alpha' }], offset: 0, limit: 200 }, value = reply(request);
  value.page!.storageTypes = [mode === 'null' ? 'n' : 't']; value.page!.result.rows = mode === 'missing' ? [] : [{ c0: mode === 'null' ? null : 'ALPHA' }];
  expect(() => assertSqliteReferenceChoice(value, request.values)).toThrow('删除或变化');
});
it('复合键精确INTEGER/BLOB保持，单次草稿保留其它列；不可空/生成列禁止清空或选择', () => {
  const source = page(); source.columns = ['p', 'q', 'note'].map(name => ({ name, declaredType: '' })); source.edit = { kind: 'editable', snapshotId: 's', expiresAt: new Date(60000).toISOString(), columns: source.columns.map(column => ({ ...column, generated: false, nullable: true, hasDefault: false })), rows: [], locator: { kind: 'rowid', columns: [] } };
  const row: SqliteDraftRow = { id: 'draft', values: [undefined, undefined, { kind: 'text', value: '保留草稿' }], deleted: false };
  const request: SqliteReferenceInput = { connectionId: 'c', database: 'main', table: 'child', schemaKey: source.schemaKey, taskId: '00000000-0000-4000-8000-000000000001', reference: 'page', foreignKey: 0, values: [{ kind: 'integer', value: '9223372036854775807' }, { kind: 'blob', value: '00ff' }], offset: 0, limit: 200 };
  const proof = reply(request); proof.source = { ...proof.source, foreignKeys: [{ ...key, columns: ['p', 'q'] }] }; proof.referencedColumns = ['i', 'b']; proof.page!.columns = [{ name: 'i', declaredType: '' }, { name: 'b', declaredType: '' }]; proof.page!.result.columns = [{ name: 'i', key: 'c0', type: '' }, { name: 'b', key: 'c1', type: '' }]; proof.page!.result.rows = [{ c0: '9223372036854775807', c1: { type: 'binary', base64: 'AP8=' } }]; proof.page!.storageTypes = ['ib'];
  const choice = { foreignKey: 0, proof, values: request.values };
  expect(sqliteReferenceDraft(source, row, choice)).toEqual([...request.values, row.values[2]]); expect(row.values[0]).toBeUndefined();
  const clear = { ...choice, values: null, proof: { request: { ...request, reference: 'catalog' } as SqliteReferenceInput, source: proof.source } };
  expect(sqliteReferenceDraft(source, row, clear)).toEqual([{ kind: 'null' }, { kind: 'null' }, row.values[2]]);
  source.edit.columns[1].nullable = false; expect(() => sqliteReferenceDraft(source, row, clear)).toThrow('不允许'); source.edit.columns[1].generated = true; expect(() => sqliteReferenceDraft(source, row, choice)).toThrow('不可编辑');
});

it('明确目录不带值；父记录保持真实TEXT子键，续页绑定父结构指纹', async () => {
  const f = fixture(); await f.reader.catalog(); expect(f.services.read.mock.calls[0][0]).not.toHaveProperty('values');
  await f.reader.page(key, 0); expect(f.services.read.mock.calls[1][0]).toMatchObject({ reference: 'page', values: [{ kind: 'text', value: '001' }], offset: 0 });
  await f.reader.page(key, 50); expect(f.services.read.mock.calls[2][0]).toHaveProperty('parentSchemaKey', 'b'.repeat(64));
});
it.each(['read-first', 'ack-first'] as const)('%s取消链双方终态前仍busy且不能重入，迟到结果拒绝', async order => {
  const f = fixture(), pending = deferred<SqliteReferenceOutput>(), ack = deferred<void>(); f.services.read.mockReturnValue(pending.promise); f.services.cancel.mockReturnValue(ack.promise);
  const reading = f.reader.page(key, 0); const rejected = expect(reading).rejects.toThrow('停止'); await Promise.resolve(); const request = f.services.read.mock.calls[0][0], stop = f.reader.stop();
  await expect(f.reader.catalog()).rejects.toThrow('未结束'); expect(f.reader.busy).toBe(true);
  if (order === 'read-first') pending.resolve(reply(request)); else ack.resolve(); await Promise.resolve(); expect(f.reader.busy).toBe(true);
  if (order === 'read-first') ack.resolve(); else pending.resolve(reply(request)); await stop; await rejected; expect(f.reader.busy).toBe(false); expect(f.services.cancel).toHaveBeenCalledExactlyOnceWith(request.taskId);
});
it('尚未发送时停止不取消不存在的任务，环境ABA不复活原读取', async () => {
  const f = fixture(), reading = f.reader.catalog(), rejected = expect(reading).rejects.toThrow('停止'); await f.reader.stop(); await rejected; expect(f.services.cancel).not.toHaveBeenCalled(); expect(f.services.read).not.toHaveBeenCalled();
  f.invalidate(); expect(f.reader.current()).toBe(false); f.restore(); await expect(f.reader.catalog()).rejects.toThrow('失效');
});
it.each(['target', 'mapping', 'truncated', 'offset', 'storage', 'request'] as const)('%s回包不能冒领父记录', mode => {
  const request: SqliteReferenceInput = { connectionId: 'c', database: 'main', table: 'child', schemaKey: 'a'.repeat(64), taskId: '00000000-0000-4000-8000-000000000001', reference: 'page', foreignKey: 0, values: [{ kind: 'text', value: '001' }], offset: 0, limit: 50 }, value = reply(request);
  if (mode === 'target') value.page!.target.table = 'other'; if (mode === 'mapping') value.referencedColumns = ['wrong']; if (mode === 'truncated') value.page!.result.truncated = true;
  if (mode === 'offset') value.page!.offset++; if (mode === 'storage') value.page!.storageTypes = ['b']; if (mode === 'request') value.request = { ...request, foreignKey: 1 };
  expect(() => assertSqliteReferenceOutput(value, request)).toThrow();
});
it('路径、SQL、超限页长与空元组均不能进入IPC合同', () => {
  const valid = { connectionId: 'c', database: 'main', table: 'child', schemaKey: 'a'.repeat(64), taskId: '00000000-0000-4000-8000-000000000001', reference: 'catalog' };
  for (const patch of [{ path: '/不打开' }, { sql: 'SELECT 1' }, { database: 'temp' }]) expect(sqliteReferenceInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  expect(sqliteReferenceInputSchema.safeParse({ ...valid, reference: 'page', foreignKey: 0, values: [], offset: 0, limit: 201 }).success).toBe(false);
  const candidate = { ...valid, reference: 'candidates', foreignKey: 0, offset: 0, limit: 50 };
  for (const text of ['', '\0', '\ud800', 'x'.repeat(257)]) expect(sqliteReferenceInputSchema.safeParse({ ...candidate, search: { column: 'p', text } }).success).toBe(false);
  expect(sqliteReferenceInputSchema.safeParse({ ...candidate, values: [{ kind: 'null' }] }).success).toBe(false);
});
it('只读原行和本地草稿分别捕获typed值，任何原值漂移留下墓碑；无关大BLOB不阻塞其它字段', () => {
  const source = page(), ro = captureSqliteReferenceSource(source, 0); expect(ro.values).toEqual([{ kind: 'text', value: '001' }]); source.result.rows[0].c0 = '2'; expect(ro.current()).toBe(false); source.result.rows[0].c0 = '001'; expect(ro.current()).toBe(false);
  const row: SqliteDraftRow = { id: 'new', deleted: false, values: [{ kind: 'integer', value: '9223372036854775807' }] }, rows = [row], capture = captureSqliteReferenceSource(source, 0, { row, rows }); expect(capture.values).toEqual(row.values); row.values[0] = { kind: 'integer', value: '1' }; expect(capture.current()).toBe(false);
  source.columns.push({ name: 'large', declaredType: '' }); source.result.columns.push({ key: 'c1', name: 'large', type: 'SQLITE' }); source.storageTypes = ['tb']; source.result.rows[0].c1 = { type: 'binary', base64: Buffer.alloc(32769).toString('base64') };
  const large = captureSqliteReferenceSource(source, 0); expect(large.values[0]).toEqual({ kind: 'text', value: '001' }); expect(large.values[1]).toBeUndefined(); expect(large.current()).toBe(true);
});
