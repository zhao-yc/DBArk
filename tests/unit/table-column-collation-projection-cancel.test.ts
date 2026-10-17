import { afterEach, expect, it, vi } from 'vitest';
import * as candidate from '../../src/engine/tableColumnCollationSql';
import { columnCollationTaskViews, type ColumnCollationTaskFacts } from '../../src/engine/tableColumnCollationTaskRead';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableIndexDefinition } from '../../src/engine/tableIndexDefinition';
import { columnPatchAccess, type TableColumnView } from '../../src/shared/tableColumnPatches';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { collationFacts } from '../fixtures/column-collation-facts';

/** 构造小型完整多列RAM目录，仅验证调度与资格保持，不代表4096列性能验收。 */
function fixture(count = 12) {
  const facts = collationFacts(), controller = new AbortController();
  const id = facts.indexes.model.columns.get('id-ref')!, note = facts.indexes.model.columns.get('note-ref')!;
  const names = Array.from({ length: count }, (_, index) => 'note' + index);
  const source = 'CREATE TABLE `subject` (`id` int NOT NULL,\n' + names.map(name => '`' + name + "` VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT 'AbC'").join(',\n') + ',\n PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';
  const document = parseTableColumnDefinition(source, facts.base.context), indexDocument = readTableIndexDefinition(document);
  Object.assign(facts.base, { source, nullability: [['id', false], ...names.map(name => [name, true])], encodings: [{ name: 'id', charset: null, collation: null }, ...names.map(name => ({ name, charset: 'utf8mb4', collation: 'utf8mb4_bin' }))], columnExtras: ['id', ...names].map(name => [name, '']) });
  Object.assign(facts.indexes, facts.base);
  facts.indexes.model.definition = document; facts.indexes.model.indexDocument = indexDocument;
  facts.indexes.model.columns = new Map([['id-ref', id], ...names.map(name => [name + '-ref', { ...note, name }] as const)]);
  facts.indexes.model.indexes.values().next().value!.parsed = indexDocument.indexes[0];
  Object.assign(facts.references, { columns: new Map<string, string>([['id-ref', 'id'] as const, ...names.map(name => [name + '-ref', name] as const)]) });
  const columns: TableColumnView[] = document.columns.map(column => ({ columnRef: column.name === 'id' ? 'id-ref' : column.name + '-ref', name: column.name, ordinal: column.ordinal, typeSql: column.type.raw, nullable: column.name !== 'id', default: column.default, comment: column.comment, rawDefinition: column.raw, access: columnPatchAccess(column, 'mysql', '8.4.11') }));
  const value: ColumnCollationTaskFacts = { facts, bytes: 8192, physical: { status: 'observed', tableId: '19611', target: { ...facts.target }, serverIdentity: facts.base.identity, bytes: 512, mapping: { dialect: 'mysql', version: '8.4.11', compileOs: 'linux', compileOsReported: 'Linux', lowerCaseTableNames: 0, tableType: 'BASE TABLE', engine: 'InnoDB', partitionName: null, catalog: 'information_schema.INNODB_TABLES', nativeName: 'ram_db/subject' } } };
  const context = { managed: { broken: false, signal: controller.signal }, checkCancelled: vi.fn(() => { if (controller.signal.aborted) throw controller.signal.reason; }) } as unknown as StructureTaskContext;
  const project = () => Promise.resolve(columnCollationTaskViews(columns, facts.base, value, context));
  return { facts, columns, value, controller, context, project };
}
afterEach(() => vi.restoreAllMocks());

it('真正Node setImmediate已排队取消能在首次候选前中止，不返回已完成投影', async () => {
  const f = fixture(), error = new Error('排队取消原件'), calls = vi.spyOn(candidate, 'buildColumnCollationDefinition');
  setImmediate(() => f.controller.abort(error));
  await expect(f.project()).rejects.toBe(error); expect(calls).not.toHaveBeenCalled();
});
it('真实候选处理中排队取消在小批次后处理，不能同步跑完所有列', async () => {
  const f = fixture(), error = new Error('批次取消原件'), original = candidate.buildColumnCollationDefinition;
  let processed = 0;
  vi.spyOn(candidate, 'buildColumnCollationDefinition').mockImplementation((...args) => {
    const result = original(...args); if (++processed === 2) setImmediate(() => f.controller.abort(error)); return result;
  });
  await expect(f.project()).rejects.toBe(error); expect(processed).toBeGreaterThanOrEqual(2); expect(processed).toBeLessThan(12);
});
it('尾部不足一个批次时仍处理最后候选排队的取消，不提前返回', async () => {
  const f = fixture(1), error = new Error('尾批取消原件'), original = candidate.buildColumnCollationDefinition;
  vi.spyOn(candidate, 'buildColumnCollationDefinition').mockImplementation((...args) => { const result = original(...args); setImmediate(() => f.controller.abort(error)); return result; });
  await expect(f.project()).rejects.toBe(error);
});
it('正常异步投影不省略任何列，不改变候选资格或旧七属性投影', async () => {
  const f = fixture(); let eventLoopRan = false; setImmediate(() => { eventLoopRan = true; });
  const result = await f.project(); expect(eventLoopRan).toBe(true); expect(result).toHaveLength(f.columns.length);
  expect(result.map(column => column.columnRef)).toEqual(f.columns.map(column => column.columnRef));
  for (const [index, column] of result.entries()) { expect(column.access).toEqual(f.columns[index].access); expect(column.rawDefinition).toBe(f.columns[index].rawDefinition); }
  expect(result[0].collation).toBeUndefined(); expect(result.slice(1).every(column => column.collation?.access.editable === true)).toBe(true);
});
it.each(['broken', 'aborted'] as const)('调用方checkCancelled未抛时仍检查原managed %s', async state => {
  const f = fixture(), error = new Error('信号原因原件'); f.context.checkCancelled = vi.fn();
  if (state === 'broken') { f.context.managed.broken = true; await expect(f.project()).rejects.toThrow('断开'); }
  else { f.controller.abort(error); await expect(f.project()).rejects.toBe(error); }
});
