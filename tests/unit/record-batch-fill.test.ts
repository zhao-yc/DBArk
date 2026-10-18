import { describe, expect, it } from 'vitest';
import { BatchFillIntent, batchFillColumns } from '../../src/renderer/recordBatchFill';
import { DraftHistory } from '../../src/renderer/draftHistory';
import { collectChanges, type DraftRow } from '../../src/renderer/dataChanges';
import type { TableInfo, TablePage } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { recordTargetKey, type RecordContext, type RecordInput } from '../../src/renderer/recordViews';
import type { RecordCopyPage } from '../../src/renderer/recordCopySource';

/** 仅构造内存中的已加载当前页，来源绑定与生产table.page格式一致，无任何IO。 */
function fixture() {
  const info: TableInfo = { database: '库', name: '表', objectKind: 'table', engine: 'InnoDB', primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], ddl: '', columns: ['id', 'note', 'num', 'doc', 'bin'].map(name => ({ name, type: name === 'num' ? 'decimal(65,30)' : name === 'doc' ? 'json' : name === 'bin' ? 'blob' : 'text', nullable: name !== 'id' && name !== 'num', generated: false, extra: name === 'id' ? 'auto_increment' : '', defaultValue: null, comment: '' })) };
  const data = [1, 2, 3].map(id => ({ id: String(id), note: '原' + id, num: '0.000000000000000000000000000001', doc: '{"n":900719925474099312345,"x":1,"x":-0}', bin: { type: 'binary' as const, base64: 'AP8=' } }));
  const page: TablePage = { page: 1, pageSize: 50, hasMore: false, rows: data, columns: info.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), copyMetadataKey: tableCopyMetadataKey(info) };
  const context: RecordContext = { target: { connectionId: '连接', database: info.database, table: info.name }, connectionVersion: 1, generation: 2, info, loaded: true, stale: false, busy: false };
  const binding: RecordCopyPage = { page, target: recordTargetKey(context.target), connectionVersion: 1, generation: 2 };
  const rows: DraftRow[] = data.map((data, index) => ({ id: 'UUID' + index, data: structuredClone(data), original: structuredClone(data), inserted: false, deleted: false })), ids = new Set(rows.slice(0, 2).map(row => row.id));
  return { info, page, rows, ids, context, binding, create: () => new BatchFillIntent(rows, ids, context, binding, page), consume: (intent: BatchFillIntent, column: string, input: RecordInput) => intent.consume(column, input, rows, ids, context, binding, page) };
}

describe('当前页已有记录批量填充domain', () => {
  it.each([['num', 'text', '18446744073709551615.123456789012345678901234567890'], ['doc', 'json', '{ "n":900719925474099312345,"n":-0 }'], ['bin', 'binary', '0x00FF00'], ['note', 'null', '忽略的输入'], ['note', 'text', 'NULL']] as const)('%s的%s类型保持精度/JSON原文/字节/NULL语义', (column, mode, text) => {
    const f = fixture(), original = f.rows.map(row => row.original), before = structuredClone(f.rows), next = f.consume(f.create(), column, { mode, text });
    const value = mode === 'null' ? null : mode === 'binary' ? { type: 'binary', base64: 'AP8A' } : text;
    expect(next.slice(0, 2).map(row => row.data[column])).toEqual([value, value]); expect(next[2]).toBe(f.rows[2]); expect(f.rows).toEqual(before); expect(next.map(row => row.original)).toEqual(original); expect(next[0].original).toBe(original[0]);
    if (mode === 'binary') expect(next[0].data.bin).not.toBe(next[1].data.bin);
    const history = new DraftHistory(); history.record(f.rows, next); expect(history.status.undo).toBe(1); const undone = history.move(next, 'undo')!; expect(undone).toEqual(f.rows); const redone = history.move(undone, 'redo')!; expect(redone).toEqual(next); expect(history.status.undo).toBe(1);
  });
  it('保留其它列已有草稿与original，集中提交仍得到两项普通update', () => {
    const f = fixture(); f.rows[0].data.doc = '{ "已暂存": true }'; const next = f.consume(f.create(), 'note', { mode: 'text', text: '统一值' });
    expect(next[0].data.doc).toBe('{ "已暂存": true }'); const changes = collectChanges(next); expect(changes).toHaveLength(2); expect(changes.every(change => change.kind === 'update')).toBe(true);
  });
  it('完全相同值不伪造历史，意图成功后仍只能消费一次', () => {
    const f = fixture(); f.ids.delete(f.rows[1].id); const intent = f.create(); expect(f.consume(intent, 'note', { mode: 'text', text: '原1' })).toBe(f.rows); expect(() => f.consume(intent, 'note', { mode: 'text', text: '第二次' })).toThrow();
  });
  it.each(['主键', '定位键', '生成列', '自增列'] as const)('拒绝目标%s且不修改任何行', mode => {
    const f = fixture(); const name = mode === '主键' ? 'id' : 'note'; if (mode === '定位键') f.info.editableKey.push(name); if (mode === '生成列') f.info.columns[1].generated = true; if (mode === '自增列') f.info.columns[1].extra = 'auto_increment'; f.page.copyMetadataKey = tableCopyMetadataKey(f.info);
    expect(batchFillColumns(f.context).some(column => column.name === name)).toBe(false); const before = structuredClone(f.rows); expect(() => f.consume(f.create(), name, { mode: 'text', text: '禁止' })).toThrow(); expect(f.rows).toEqual(before);
  });
  it.each(['空选择', '未加载身份', '新增', '删除', '重复UUID', '缺data字段', '缺original字段', '缺页列', '页原值漂移', '目录未知'] as const)('%s使整批拒绝，不忽略非法子集', mode => {
    const f = fixture(); if (mode === '空选择') f.ids.clear(); if (mode === '未加载身份') f.ids.add('未知'); if (mode === '新增') f.rows[0].inserted = true; if (mode === '删除') f.rows[1].deleted = true; if (mode === '重复UUID') f.rows[2].id = f.rows[0].id; if (mode === '缺data字段') delete f.rows[1].data.note; if (mode === '缺original字段') delete f.rows[1].original!.doc; if (mode === '缺页列') f.page.columns.pop(); if (mode === '页原值漂移') f.page.rows[0].note = '不同'; if (mode === '目录未知') delete f.page.copyMetadataKey;
    const before = structuredClone(f.rows); expect(() => f.create()).toThrow(); expect(f.rows).toEqual(before);
  });
  it.each(['视图', '无键', '忙碌', '失效', '未加载'] as const)('沿原可编辑门拒绝%s', mode => {
    const f = fixture(); if (mode === '视图') f.info.objectKind = 'view'; if (mode === '无键') f.info.editableKey = []; if (mode === '忙碌') f.context.busy = true; if (mode === '失效') f.context.stale = true; if (mode === '未加载') f.context.loaded = false; expect(() => f.create()).toThrow();
  });
  it.each([['doc', 'json', '{'], ['bin', 'binary', '0x0'], ['bin', 'text', '不是字节'], ['num', 'null', ''], ['note', 'default', ''], ['note', 'text', '字'.repeat(100000)], ['note', 'text', 'x'.repeat(262145)]] as const)('非法或超预算输入%s/%s整批拒绝', (column, mode, text) => {
    const f = fixture(), intent = f.create(), before = structuredClone(f.rows); expect(() => f.consume(intent, column, { mode, text })).toThrow(); expect(f.rows).toEqual(before);
  });
  it.each(['rows', 'selection', 'metadata', 'connection', 'generation', 'page', 'binding', 'inPlace'] as const)('打开后%s变化拒绝，观察后ABA恢复不复活', mode => {
    const f = fixture(), intent = f.create(); let rows = f.rows, ids: ReadonlySet<string> = f.ids, page = f.page, binding = f.binding;
    if (mode === 'rows') rows = [...rows]; if (mode === 'selection') ids = new Set(ids); if (mode === 'metadata') f.info.columns[1].comment = '变更'; if (mode === 'connection') f.context.connectionVersion++; if (mode === 'generation') f.context.generation++; if (mode === 'page') page = { ...page }; if (mode === 'binding') binding = { ...binding }; if (mode === 'inPlace') f.rows[0].data.note = '外部变更';
    expect(intent.reason(rows, ids, f.context, binding, page)).not.toBe(''); f.context.connectionVersion = 1; f.context.generation = 2; f.info.columns[1].comment = ''; f.rows[0].data.note = '原1'; expect(() => f.consume(intent, 'note', { mode: 'text', text: '禁止复活' })).toThrow();
  });
  it('整批扇出超过1MiB在任何发布前拒绝', () => {
    const f = fixture(); f.rows.push(...Array.from({ length: 18 }, (_, i) => ({ ...f.rows[2], id: '更多' + i, data: { ...f.rows[2].data }, original: { ...f.rows[2].original! } }))); f.page.rows = f.rows.map(row => row.original!); f.rows.forEach(row => f.ids.add(row.id));
    const intent = f.create(), before = structuredClone(f.rows); expect(() => f.consume(intent, 'note', { mode: 'text', text: 'x'.repeat(60000) })).toThrow(); expect(f.rows).toEqual(before);
  });
  it('线路值很小但整步历史超过8MiB也必须整批拒绝，不能先写再清历史', () => {
    const f = fixture(); f.info.columns = Array.from({ length: 40 }, (_, i) => ({ ...f.info.columns[1], name: i ? 'v' + i : 'id' }));
    const rows: DraftRow[] = Array.from({ length: 1000 }, (_, i) => { const data = Object.fromEntries(f.info.columns.map(column => [column.name, column.name === 'id' ? String(i + 1) : ''])); return { id: 'row' + i, data, original: { ...data }, inserted: false, deleted: false }; });
    f.page.rows = rows.map(row => row.original!); f.page.columns = f.info.columns.map(column => ({ key: column.name, name: column.name, type: column.type })); f.page.copyMetadataKey = tableCopyMetadataKey(f.info); const ids = new Set(rows.map(row => row.id));
    const intent = new BatchFillIntent(rows, ids, f.context, f.binding, f.page); expect(() => intent.consume('v1', { mode: 'text', text: '值' }, rows, ids, f.context, f.binding, f.page)).toThrow('预算'); expect(rows.every(row => row.data.v1 === '')).toBe(true);
  });
});
