import { describe, expect, it } from 'vitest';
import type { DataRow, TableInfo } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import type { TableDraftDocument } from '../../src/shared/tableDraft';
import { captureTableDraft, restoreTableDraftRows } from '../../src/renderer/tableDraft';
import { collectChanges, type DraftRow } from '../../src/renderer/dataChanges';

/** 可靠键及生成列同时存在，确保恢复不绕过原编辑和乐观锁边界。 */
function fixture() {
  const info: TableInfo = { database: 'db', name: 'subject', objectKind: 'table', engine: 'InnoDB', ddl: '', primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], columns: [
    { name: 'id', type: 'bigint', nullable: false, defaultValue: null, extra: '', generated: false, comment: '' },
    { name: 'note', type: 'text', nullable: true, defaultValue: null, extra: '', generated: false, comment: '' },
    { name: 'computed', type: 'text', nullable: true, defaultValue: null, extra: 'STORED GENERATED', generated: true, comment: '' },
  ] };
  const target = { connectionId: 'fixture', database: 'db', table: 'subject' };
  const before = { id: '9007199254740993', note: '原值', computed: '生成原值' };
  const rows: DraftRow[] = [
    { id: 'old-update', original: before, data: { ...before, id: '9007199254740994', note: '修改' }, inserted: false, deleted: false },
    { id: 'old-delete', original: { ...before, id: '3' }, data: { ...before, id: '3' }, inserted: false, deleted: true },
    { id: 'old-insert', data: { note: null }, inserted: true, deleted: false },
    { id: 'unchanged', original: { ...before, id: '4' }, data: { ...before, id: '4' }, inserted: false, deleted: false },
    { id: 'insert-deleted', data: {}, inserted: true, deleted: true },
  ];
  const document = (): TableDraftDocument => ({ ...captureTableDraft(rows, target, info), kind: 'dbark.table-draft', version: 1, endpointKey: 'a'.repeat(64) });
  return { info, target, before, rows, document };
}

describe('表格草稿独立恢复视图', () => {
  it('只捕获真实变化，保存不修改原页或使用旧UUID，恢复后变更逐值一致', () => {
    const f = fixture(), source = f.document(), snapshot = structuredClone(f.rows); let id = 0;
    const restored = restoreTableDraftRows(source, f.info, () => `new-${++id}`);
    expect(source.changes).toHaveLength(3); expect(restored.map(row => row.id)).toEqual(['new-1', 'new-2', 'new-3']);
    expect(collectChanges(restored)).toEqual(collectChanges(f.rows)); expect(f.rows).toEqual(snapshot);
    expect(restored[0].original).toEqual(f.before); expect(restored[0].data.id).toBe('9007199254740994');
    expect(restored[1]).toMatchObject({ deleted: true, inserted: false }); expect(restored[1].data).not.toBe(restored[1].original);
    expect(Object.hasOwn(restored[2].data, 'id')).toBe(false); expect(restored[2].data.note).toBeNull();
  });
  it('原值与恢复值分别复制，不共享源文档/页面字节包装', () => {
    const f = fixture(); f.rows[0].original!.note = { type: 'binary', base64: 'AA==' }; f.rows[0].data.note = { type: 'binary', base64: 'AQ==' };
    const doc = f.document(), restored = restoreTableDraftRows(doc, f.info, () => crypto.randomUUID());
    (restored[0].data.note as { base64: string }).base64 = 'Ag==';
    const change = doc.changes[0]; expect(change.kind === 'update' && change.values.note).toEqual({ type: 'binary', base64: 'AQ==' });
    expect(f.rows[0].data.note).toEqual({ type: 'binary', base64: 'AQ==' });
  });
  it('任何目标或结构变化整次拒绝，不能按同名列或页位置猜测匹配', () => {
    const f = fixture(), doc = f.document();
    for (const info of [{ ...f.info, name: 'other' }, { ...f.info, database: 'other' }, { ...f.info, columns: f.info.columns.map(column => column.name === 'note' ? { ...column, type: 'varchar(10)' } : column) }, { ...f.info, indexes: [{ name: 'uq', unique: true, columns: ['note'] }] }]) expect(() => restoreTableDraftRows(doc, info, () => crypto.randomUUID())).toThrow();
    expect(() => restoreTableDraftRows({ ...doc, metadataKey: '旧结构' }, f.info, () => crypto.randomUUID())).toThrow();
  });
  it.each(['view', undefined])('非明确普通表拒绝：%s', objectKind => {
    const f = fixture(), info = { ...f.info, objectKind } as TableInfo;
    expect(() => captureTableDraft(f.rows, f.target, info)).toThrow();
  });
  it('非InnoDB、无可靠键、未知键列和重复键列均拒绝', () => {
    const f = fixture();
    for (const info of [{ ...f.info, engine: 'MyISAM' }, { ...f.info, editableKey: [] }, { ...f.info, editableKey: ['missing'] }, { ...f.info, editableKey: ['id', 'id'] }]) expect(() => captureTableDraft(f.rows, f.target, info)).toThrow();
  });
  it('更新删除必须完整before，NULL可靠键和额外旧字段不能恢复', () => {
    const f = fixture(), original = f.document();
    for (const before of [{ id: '1', note: '缺生成列' }, { ...f.before, id: null }, { ...f.before, extra: '未知' }] as DataRow[]) {
      const doc: TableDraftDocument = { ...original, changes: [{ kind: 'update', before, values: { note: '后值' } }] };
      expect(() => restoreTableDraftRows(doc, f.info, () => crypto.randomUUID())).toThrow();
    }
  });
  it('未知列或生成列赋值不因保存在文件里获得授权', () => {
    const f = fixture(), original = f.document();
    for (const values of [{ missing: '未知' }, { computed: '手写生成值' }] as DataRow[]) {
      for (const kind of ['insert', 'update'] as const) {
        const doc: TableDraftDocument = { ...original, changes: [kind === 'insert' ? { kind, values } : { kind, values, before: f.before }] };
        expect(() => restoreTableDraftRows(doc, f.info, () => crypto.randomUUID())).toThrow();
      }
    }
  });
  it('全部原行/数据字段中的proto同名列是普通字段，不能污染恢复原型', () => {
    const f = fixture(), original = f.document(); f.info.columns.push({ ...f.info.columns[1], name: '__proto__' });
    const before: DataRow = Object.fromEntries([...Object.entries(f.before), ['__proto__', '原值']]);
    const doc: TableDraftDocument = { ...original, metadataKey: tableCopyMetadataKey(f.info), changes: [{ kind: 'update', before, values: Object.fromEntries([['__proto__', '新值']]) }] };
    const restored = restoreTableDraftRows(doc, f.info, () => 'new');
    expect(Object.hasOwn(restored[0].data, '__proto__')).toBe(true); expect(restored[0].data.__proto__).toBe('新值'); expect(Object.getPrototypeOf(restored[0].data)).toBe(Object.prototype);
  });
  it('编号工厂必须为每条记录产生不同非空编号，不能部分发布坏结果', () => {
    const f = fixture(), doc = f.document();
    for (const create of [() => '', () => 'same', () => undefined as unknown as string]) expect(() => restoreTableDraftRows(doc, f.info, create)).toThrow();
  });
  it('无已暂存变化明确拒绝保存；不保存已撤销新增或只读输入', () => {
    const f = fixture(); expect(() => captureTableDraft(f.rows.slice(3), f.target, f.info)).toThrow();
  });
});
