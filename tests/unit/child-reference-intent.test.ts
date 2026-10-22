import { expect, it } from 'vitest';
import type { DataRow, TableInfo } from '../../src/shared/contracts';
import type { IncomingReferenceRelation, IncomingReferencesOutput } from '../../src/shared/incomingReferences';
import { ChildReferenceIntent, checkChildReferencePage, checkIncomingReferencePage, childReferenceTuple } from '../../src/renderer/childReferenceIntent';

const source: TableInfo = { database: 'parent_db', name: 'parent', engine: 'InnoDB', objectKind: 'table', columns: [{ name: 'id', type: 'bigint', nullable: false }, { name: 'part', type: 'varbinary(8)', nullable: true }] as TableInfo['columns'], indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], ddl: 'CREATE TABLE parent (`id` bigint,`part` varbinary(8)) AUTO_INCREMENT=2' };
const relation: IncomingReferenceRelation = { database: 'child_db', table: 'child', digest: 'b'.repeat(64), foreignKey: { name: 'fk_child_parent', columns: ['parent_id', 'parent_part'], referencedDatabase: 'parent_db', referencedTable: 'parent', referencedColumns: ['id', 'part'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' } };
const directory = (): IncomingReferencesOutput => ({ source: structuredClone(source), sourceDigest: 'a'.repeat(64), scope: 'visible-only', relations: [structuredClone(relation)] });
/** RAM只冻结原数值及字节包装，不提供任何数据库或权限证明。 */
function intent(data: DataRow = { id: '9223372036854775807', part: { type: 'binary', base64: 'AP8=' } }) { return new ChildReferenceIntent(source, 'original-row', data, ['page', 2], () => true); }
it('按完整真实映射顺序保留BIGINT与BLOB，不依赖当前字段有正向外键', () => {
  const captured = intent(); expect(captured.source.foreignKeys).toEqual([]); expect(childReferenceTuple(captured, relation)).toEqual({ kind: 'values', values: ['9223372036854775807', { type: 'binary', base64: 'AP8=' }] });
  const reversed = { ...relation, foreignKey: { ...relation.foreignKey, columns: ['parent_part', 'parent_id'], referencedColumns: ['part', 'id'] } };
  expect(childReferenceTuple(captured, reversed)).toEqual({ kind: 'values', values: [{ type: 'binary', base64: 'AP8=' }, '9223372036854775807'] });
});
it('部分NULL与缺字段分别拒绝，原型同名不是父行字段', () => {
  expect(childReferenceTuple(intent({ id: '1', part: null }), relation)).toEqual({ kind: 'null' });
  expect(childReferenceTuple(intent({ id: '1' }), relation)).toEqual({ kind: 'missing' });
  const data = Object.create({ part: '伪字段' }) as DataRow; data.id = '1'; expect(childReferenceTuple(intent(data), relation)).toEqual({ kind: 'missing' });
});
it('行/页/连接ABA在观察首次变化时永久失效，异步通知不复活', async () => {
  const captured = intent(), notices: boolean[] = []; captured.subscribe(() => notices.push(captured.current())); captured.observe(['different-page', 2]); captured.observe(['page', 2]); expect(captured.current()).toBe(false); await Promise.resolve(); expect(notices).toEqual([false]);
});
it('同步身份门失效后恢复true也不复活原意图', () => {
  let active = true; const captured = new ChildReferenceIntent(source, 'row', { id: '1' }, [], () => active); active = false; expect(captured.current()).toBe(false); active = true; expect(captured.current()).toBe(false);
});
it('原父行克隆不可变，外部后改不改元组且不会写父草稿', () => {
  const data: DataRow = { id: '1', part: { type: 'binary', base64: 'AA==' } }; const captured = intent(data); data.id = '2'; (data.part as { base64: string }).base64 = '/w=='; expect(childReferenceTuple(captured, relation)).toEqual({ kind: 'values', values: ['1', { type: 'binary', base64: 'AA==' }] }); expect(Object.isFrozen(captured.data)).toBe(true); expect(Object.isFrozen(captured.data.part)).toBe(true);
});
it('首次完整metadata保守拒绝变化，后续准确digest允许仅DDL自增计数变化', () => {
  const captured = intent(), first = directory(); checkIncomingReferencePage(captured, first); const after = directory(); after.source.ddl = after.source.ddl.replace('AUTO_INCREMENT=2', 'AUTO_INCREMENT=3'); expect(() => checkIncomingReferencePage(captured, after)).toThrow(); expect(() => checkIncomingReferencePage(captured, after, first.sourceDigest)).not.toThrow(); after.source.columns[0].type = 'int'; expect(() => checkIncomingReferencePage(captured, after, first.sourceDigest)).toThrow();
});
it('摘要、映射、可见范围、重复目录和分页目标不能被替换', () => {
  const captured = intent(); for (const mutate of [
    (value: IncomingReferencesOutput) => { value.sourceDigest = 'c'.repeat(64); },
    (value: IncomingReferencesOutput) => { value.relations[0].foreignKey.referencedTable = 'other'; },
    (value: IncomingReferencesOutput) => { value.relations.push(structuredClone(value.relations[0])); },
    (value: IncomingReferencesOutput) => { value.scope = 'all' as 'visible-only'; },
  ]) { const output = directory(); mutate(output); expect(() => checkIncomingReferencePage(captured, output, 'a'.repeat(64))).toThrow(); }
  const output = { source, sourceDigest: 'a'.repeat(64), relation, target: { ...source, database: 'child_db', name: 'child', editableKey: [] }, page: { rows: [], columns: [], page: 1, pageSize: 50, hasMore: false }, stablePagination: false };
  expect(() => checkChildReferencePage(captured, relation, 'a'.repeat(64), output, 1, 50)).not.toThrow(); expect(() => checkChildReferencePage(captured, relation, 'a'.repeat(64), output, 2, 50)).toThrow();
});
