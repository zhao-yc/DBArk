import { describe, expect, it, vi } from 'vitest';
import type { DataRow, TableInfo, TablePage } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { copyInsertSqlLimits } from '../../src/shared/copyInsertSql';
import { duplicateSelectedRecordDrafts } from '../../src/renderer/recordDuplicateBatch';
import { DraftHistory } from '../../src/renderer/draftHistory';
import type { DraftRow } from '../../src/renderer/dataChanges';
import { recordTargetKey, type RecordContext } from '../../src/renderer/recordViews';
import type { RecordCopyPage } from '../../src/renderer/recordCopySource';
import { recordDuplicateZh } from '../../src/renderer/locales/recordDuplicate.zh-CN';

/** 合成完整页包含隐藏字段和保真值；所有端口均为内存，不读取数据库或剪贴板。 */
function fixture() {
  const info: TableInfo = { database: '库', name: '表', objectKind: 'table', engine: 'InnoDB', primaryKey: ['auto'], editableKey: ['auto'], foreignKeys: [], indexes: [], ddl: '', columns: ['auto', 'id', 'note', 'doc', 'bytes', '__proto__', 'hidden', 'computed'].map(name => ({ name, type: name === 'bytes' ? 'blob' : 'text', nullable: true, defaultValue: null, extra: name === 'auto' ? 'auto_increment' : name === 'hidden' ? 'INVISIBLE' : '', generated: name === 'computed', comment: '' })) };
  const context: RecordContext = { target: { connectionId: '连接', database: '库', table: '表' }, connectionVersion: 4, generation: 8, info, loaded: true, busy: false, stale: false };
  const data = (auto: number): DataRow => Object.fromEntries(Object.entries({ auto, id: '18446744073709551615', note: auto === 1 ? null : '', doc: '{"x":1,"x":-0,"n":9007199254740993}', bytes: { type: 'binary' as const, base64: 'AAH/' }, hidden: false, computed: '不复制' }).concat([['__proto__', '-0']] as any));
  const loaded = [data(1), data(2)];
  const page: TablePage = { rows: loaded, columns: info.columns.map(column => ({ key: column.name, name: column.name, type: column.type })), page: 1, pageSize: 50, hasMore: true, copyMetadataKey: tableCopyMetadataKey(info), copySource: { status: 'ready', pageRef: '页来源', rowRefs: ['来源1', '来源2'], expiresAt: Date.now() + 60_000, metadataKey: tableCopyMetadataKey(info), missingColumns: [] } };
  const binding: RecordCopyPage = { page, target: recordTargetKey(context.target), connectionVersion: 4, generation: 8 };
  const rows: DraftRow[] = loaded.map((data, index) => ({ id: '原行' + index, data: structuredClone(data), original: structuredClone(data), inserted: false, deleted: false }));
  const ids = new Set(rows.map(row => row.id)); let counter = 0;
  const uid = vi.fn(() => '复制' + ++counter);
  const run = () => duplicateSelectedRecordDrafts(rows, ids, context, binding, page, uid);
  return { info, context, page, binding, rows, ids, uid, run };
}

describe('勾选现有行原子复制新增草稿', () => {
  it('实际引擎完整页没有补取租约仍可复制；缺目录来源或缺普通投影不能借此通过', () => {
    const f = fixture(); delete f.page.copySource; expect(f.run().rows).toHaveLength(4);
    f.page.columns = f.page.columns.filter(column => column.key !== 'hidden'); f.uid.mockClear(); expect(f.run).toThrow(recordDuplicateZh.batchSource); expect(f.uid).not.toHaveBeenCalled();
    f.page.columns = f.info.columns.map(column => ({ key: column.name, name: column.name, type: column.type })); delete f.page.copyMetadataKey; expect(f.run).toThrow(recordDuplicateZh.batchSource);
  });
  it('未知期限和未知页面投影均不能被当作完整来源', () => {
    const f = fixture(); (f.page.copySource as any).expiresAt = NaN; expect(f.run).toThrow(recordDuplicateZh.batchSource);
    (f.page.copySource as any).expiresAt = Date.now() + 60_000; f.page.columns.push({ key: '未知列', name: '未知列', type: 'text' }); expect(f.run).toThrow(recordDuplicateZh.batchSource); expect(f.uid).not.toHaveBeenCalled();
  });
  it('保留NULL、空串、大数/JSON原文、隐藏值及原型列，省略自增/生成列，顺序依网格且无共享字节包装', () => {
    const f = fixture(); f.ids.delete('原行0'); f.ids.add('原行0');
    f.rows[0].data.note = '已暂存'; const before = structuredClone(f.rows), result = f.run();
    expect(result.rows.slice(0, 2)).toEqual(before); expect(result.ids).toEqual(['复制1', '复制2']);
    const [a, b] = result.rows.slice(2);
    expect(a.data).toEqual(Object.fromEntries(Object.entries(f.rows[0].data).filter(([key]) => !['auto', 'computed'].includes(key))));
    expect(a.data.doc).toBe('{"x":1,"x":-0,"n":9007199254740993}'); expect(b.data.note).toBe('');
    expect(a.data.id).toBe('18446744073709551615'); expect(a.data.hidden).toBe(false); expect(Object.hasOwn(a.data, '__proto__')).toBe(true);
    expect(a.original).toBeUndefined(); expect(a.inserted).toBe(true); expect(a.deleted).toBe(false);
    expect(a.data.bytes).not.toBe(f.rows[0].data.bytes); expect(a.data.bytes).not.toBe(b.data.bytes);
    (a.data.bytes as { base64: string }).base64 = ''; expect(f.rows[0].data.bytes).toEqual({ type: 'binary', base64: 'AAH/' }); expect(b.data.bytes).toEqual({ type: 'binary', base64: 'AAH/' });
    const history = new DraftHistory(); history.record(f.rows, result.rows); expect(history.status.undo).toBe(1);
    const undone = history.move(result.rows, 'undo')!; expect(undone).toHaveLength(2); const redone = history.move(undone, 'redo')!; expect(redone.slice(2).map(row => row.id)).toEqual(result.ids);
  });
  it.each(['无勾选', '缺失', '删除', '新增', '缺original', '重复身份', '缺字段', 'undefined', '未知字段', '访问器', '未知包装', '坏base64', '非规范base64', '非有限数'] as const)('%s使整批拒绝，身份未分配且原数组及勾选不变', condition => {
    const f = fixture();
    if (condition === '无勾选') f.ids.clear();
    if (condition === '缺失') f.ids.add('不存在');
    if (condition === '删除') f.rows[1].deleted = true;
    if (condition === '新增') f.rows[1].inserted = true;
    if (condition === '缺original') delete f.rows[1].original;
    if (condition === '重复身份') f.rows[1].id = f.rows[0].id;
    if (condition === '缺字段') delete f.rows[1].data.hidden;
    if (condition === 'undefined') f.rows[1].data.hidden = undefined as any;
    if (condition === '未知字段') f.rows[1].data.extra = '未知列';
    if (condition === '访问器') Object.defineProperty(f.rows[1].data, 'hidden', { enumerable: true, get() { throw Error('不应读取'); } });
    if (condition === '未知包装') f.rows[1].data.bytes = { type: 'binary', base64: '', extra: 1 } as any;
    if (condition === '坏base64') f.rows[1].data.bytes = { type: 'binary', base64: '坏字节' };
    if (condition === '非规范base64') f.rows[1].data.bytes = { type: 'binary', base64: 'AB==' };
    if (condition === '非有限数') f.rows[1].data.hidden = NaN;
    const first = f.rows[0], selected = [...f.ids]; expect(f.run).toThrow(); expect(f.uid).not.toHaveBeenCalled(); expect(f.rows).toHaveLength(2); expect(f.rows[0]).toBe(first); expect([...f.ids]).toEqual(selected);
  });
  it.each(['无目录来源', '未知来源', '过期', '缺列', '缺行引用', '重复行引用', '错误页', '代次', '连接版本', '目标', '原值变化', '目录变化', '只读视图', '无可靠键', '非InnoDB', '忙碌', '过期页'] as const)('%s不补取、不部分复制', condition => {
    const f = fixture(); const source = f.page.copySource! as Extract<NonNullable<TablePage['copySource']>, { status: 'ready' }>;
    if (condition === '无目录来源') delete f.page.copyMetadataKey;
    if (condition === '未知来源') f.page.copySource = { status: 'unavailable', reason: 'identity-unproven', missingColumns: [] };
    if (condition === '过期') source.expiresAt = Date.now() - 1;
    if (condition === '缺列') source.missingColumns = ['hidden'];
    if (condition === '缺行引用') source.rowRefs[1] = null;
    if (condition === '重复行引用') source.rowRefs[1] = source.rowRefs[0];
    if (condition === '错误页') f.binding.page = { ...f.page };
    if (condition === '代次') f.context.generation++;
    if (condition === '连接版本') f.context.connectionVersion++;
    if (condition === '目标') f.context.target.connectionId = '其它连接';
    if (condition === '原值变化') f.rows[1].original!.doc = '变更';
    if (condition === '目录变化') f.info.columns[1].type = 'bigint';
    if (condition === '只读视图') f.info.objectKind = 'view';
    if (condition === '无可靠键') f.info.editableKey = [];
    if (condition === '非InnoDB') f.info.engine = 'MyISAM';
    if (condition === '忙碌') f.context.busy = true;
    if (condition === '过期页') f.context.stale = true;
    expect(f.run).toThrow(); expect(f.uid).not.toHaveBeenCalled(); expect(f.rows).toHaveLength(2);
  });
  it.each(['单元格UTF8', '整批字节', '转义成本', '行数', '单元格数'] as const)('%s按既有预算在克隆和身份分配之前拒绝', condition => {
    const f = fixture();
    if (condition === '单元格UTF8') f.rows[1].data.note = '大'.repeat(Math.floor(copyInsertSqlLimits.cellBytes / 3) + 1);
    if (condition === '整批字节') for (const row of f.rows) for (const name of ['note', 'doc', 'id']) row.data[name] = 'x'.repeat(200_000);
    if (condition === '转义成本') for (const row of f.rows) row.data.note = '\0'.repeat(100_000);
    if (condition === '行数') for (let index = 0; index < copyInsertSqlLimits.rows; index++) f.ids.add('额外' + index);
    if (condition === '单元格数') { for (let index = 0; index < 600; index++) { const row = { ...f.rows[0], id: '额外' + index }; f.rows.push(row); f.ids.add(row.id); f.page.rows.push(f.page.rows[0]); (f.page.copySource as any).rowRefs.push('引用' + index); } for (let index = 0; index < 100; index++) f.info.columns.push({ ...f.info.columns[1], name: '字段' + index }); f.page.columns = f.info.columns.map(column => ({ key: column.name, name: column.name, type: column.type })); f.page.copyMetadataKey = tableCopyMetadataKey(f.info); (f.page.copySource as any).metadataKey = f.page.copyMetadataKey; for (const row of f.rows) for (const column of f.info.columns) { row.data[column.name] ??= ''; row.original![column.name] ??= ''; } for (const row of f.page.rows) for (const column of f.info.columns) row[column.name] ??= ''; }
    const clone = vi.spyOn(globalThis, 'structuredClone'); expect(f.run).toThrow(recordDuplicateZh.batchLimit); expect(f.uid).not.toHaveBeenCalled(); expect(clone).not.toHaveBeenCalled(); clone.mockRestore();
  });
  it('批内身份冲突和后续身份生成失败也不能发布第一条合法副本', () => {
    const f = fixture(); expect(() => duplicateSelectedRecordDrafts(f.rows, f.ids, f.context, f.binding, f.page, () => '同一身份')).toThrow(); expect(f.rows).toHaveLength(2);
    const uid = vi.fn().mockReturnValueOnce('第一条').mockImplementationOnce(() => { throw Error('合成分配失败'); }); expect(() => duplicateSelectedRecordDrafts(f.rows, f.ids, f.context, f.binding, f.page, uid)).toThrow('合成分配失败'); expect(f.rows).toHaveLength(2);
  });
  it('二进制空值、真正NULL和负零保留不同含义', () => {
    const f = fixture(); f.rows[0].data.note = null; f.rows[1].data.hidden = -0; f.rows[1].data.bytes = { type: 'binary', base64: '' };
    const added = f.run().rows.slice(2); expect(added[0].data.note).toBeNull(); expect(added[1].data.note).toBe(''); expect(Object.is(added[1].data.hidden, -0)).toBe(true); expect(added[1].data.bytes).toEqual({ type: 'binary', base64: '' });
  });
  it('单元格字节恰好到上限仍允许；增一字节拒绝且不消耗新身份', () => {
    const f = fixture(); f.ids.delete('原行1'); f.rows[0].data.note = 'x'.repeat(copyInsertSqlLimits.cellBytes);
    expect(f.run().rows.at(-1)!.data.note).toHaveLength(copyInsertSqlLimits.cellBytes); f.uid.mockClear(); f.rows[0].data.note += 'x';
    expect(f.run).toThrow(recordDuplicateZh.batchLimit); expect(f.uid).not.toHaveBeenCalled();
  });
  it('完整二进制到既有单元格上限仍保留原字节，超限在分配之前拒绝', () => {
    const f = fixture(); f.ids.delete('原行1'); const base64 = Buffer.alloc(copyInsertSqlLimits.cellBytes, 255).toString('base64'); f.rows[0].data.bytes = { type: 'binary', base64 };
    expect(f.run().rows.at(-1)!.data.bytes).toEqual({ type: 'binary', base64 }); f.uid.mockClear(); f.rows[0].data.bytes = { type: 'binary', base64: Buffer.alloc(copyInsertSqlLimits.cellBytes + 1).toString('base64') };
    expect(f.run).toThrow(recordDuplicateZh.batchLimit); expect(f.uid).not.toHaveBeenCalled();
  });
});
