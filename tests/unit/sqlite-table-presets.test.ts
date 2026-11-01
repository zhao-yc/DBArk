import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { sqliteTablePresetQuerySchema, sqliteTablePresetSaveSchema, sqliteTablePresetSnapshotSchema, validateSqlitePresetColumns, type SqliteTablePresetQuery } from '../../src/shared/sqliteTablePresets';
import { sqlitePresetDraft } from '../../src/renderer/sqliteTablePresetDraft';
import { sqliteTableDraft } from '../../src/renderer/sqliteTableBrowser';

const target = { connectionId: 'sqlite', database: 'main' as const, table: '表.🚢' };
const query: SqliteTablePresetQuery = { limit: 5, mode: 'or', filters: [
  { column: 'id', operator: 'between', value: { kind: 'integer', value: '-9223372036854775808' }, secondValue: { kind: 'integer', value: '9223372036854775807' }, enabled: false },
  { column: 'memo', operator: 'in', values: [{ kind: 'text', value: '' }, { kind: 'text', value: '中文\0\r\n🚢' }] },
  { column: 'blob', operator: 'notIn', values: [{ kind: 'blob', value: '00Ff' }] },
  { column: 'nil', operator: 'isNull' }, { column: 'real', operator: 'eq', value: { kind: 'real', value: '+1.234e-5' } },
], sort: [{ column: 'id', direction: 'desc' }, { column: 'memo', direction: 'asc' }] };
const source = { connectionRevision: 0, connectionDigest: 'a'.repeat(64) };
const packet = () => ({ ...target, source, expectedRevision: 0, bindingToken: randomUUID(), name: '常用', query });

it('完整typed条件回转草稿保留原文、NULL、启用缺省及多列优先级，编号全部重建', () => {
  let sequence = 0; const next = sqlitePresetDraft(query, ['id', 'memo', 'blob', 'nil', 'real'], () => 'fresh-' + ++sequence);
  expect(sqliteTableDraft(target, next.query.limit, next.query.mode, next.filters, next.sort)).toEqual(query);
  expect([...next.filters, ...next.sort].map(value => value.id)).toEqual(Array.from({ length: 7 }, (_, index) => 'fresh-' + (index + 1)));
  next.filters[1].values![0] = '不影响原件'; expect(query.filters[1].values![0].value).toBe('');
});
it('快照保留严格文档修订、来源和令牌，缺失或额外能力均拒绝', () => {
  const snapshot = { version: 1, target, revision: 1, source, bindingToken: randomUUID(), entries: [{ id: randomUUID(), name: '常用', connectionDigest: source.connectionDigest, query }] };
  expect(sqliteTablePresetSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  expect(() => sqliteTablePresetSnapshotSchema.parse({ ...snapshot, entries: [snapshot.entries[0], snapshot.entries[0]] })).toThrow();
  for (const extra of [{ sql: 'SELECT 1' }, { path: 'private.sqlite' }, { offset: 200 }, { editing: true }]) {
    expect(() => sqliteTablePresetQuerySchema.parse({ ...query, ...extra })).toThrow();
    expect(() => sqliteTablePresetSaveSchema.parse({ ...packet(), ...extra })).toThrow();
  }
});
it.each(['', ' ', '\t坏', '坏\u007f', 'a'.repeat(81), '\ud800'])('拒绝非法名称%j', name => {
  expect(() => sqliteTablePresetSaveSchema.parse({ ...packet(), name })).toThrow();
});
it('只允许main和准确Unicode名称，条件数量及重复排序沿用页合同', () => {
  expect(() => sqliteTablePresetSaveSchema.parse({ ...packet(), table: '字'.repeat(512) })).not.toThrow();
  for (const change of [{ database: 'temp' }, { table: '\0' }, { table: '\ud800' }, { expectedRevision: -1 }, { bindingToken: '伪造' }]) expect(() => sqliteTablePresetSaveSchema.parse({ ...packet(), ...change })).toThrow();
  for (const change of [{ filters: Array(33).fill(query.filters[3]) }, { sort: Array(2).fill(query.sort[0]) }, { limit: 1001 }]) expect(() => sqliteTablePresetQuerySchema.parse({ ...query, ...change })).toThrow();
});
it('完整预算同时覆盖停用原文、启用列表绑定及超大单项序列化', () => {
  const filter = { column: 'id', operator: 'in', values: Array.from({ length: 128 }, () => ({ kind: 'integer', value: '1' })) };
  expect(() => sqliteTablePresetQuerySchema.parse({ ...query, filters: Array(8).fill(filter) })).toThrow('过多');
  const disabled = { column: 'memo', operator: 'eq', enabled: false, value: { kind: 'text', value: 'x'.repeat(65536) } };
  expect(() => sqliteTablePresetQuerySchema.parse({ ...query, filters: [disabled, disabled] })).not.toThrow();
  expect(() => sqliteTablePresetQuerySchema.parse({ ...query, filters: [disabled, disabled, { ...disabled, value: { kind: 'text', value: 'x' } }] })).toThrow('总量');
  const big = { ...query, filters: [{ ...disabled, value: { kind: 'text', value: '\0'.repeat(65536) } }, { ...disabled, value: { kind: 'text', value: '\0'.repeat(65536) } }, ...Array.from({ length: 30 }, () => ({ ...disabled, value: { kind: 'text', value: '' } }))] };
  expect(() => sqliteTablePresetQuerySchema.parse(big)).not.toThrow();
});
it('缺失字段包含停用条件，整份拒绝且不调用编号生成器，不作部分回填', () => {
  let called = 0;
  expect(() => validateSqlitePresetColumns(query, ['memo', 'blob', 'nil', 'real'])).toThrow('字段');
  expect(() => sqlitePresetDraft(query, ['memo'], () => String(++called))).toThrow(); expect(called).toBe(0);
});
