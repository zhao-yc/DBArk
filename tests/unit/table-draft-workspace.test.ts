import { describe, expect, it } from 'vitest';
import { decodeTableDraft, encodeTableDraft, parseTableDraftDocument, parseTableDraftPayload, type TableDraftDocument, type TableDraftWorkspace } from '../../src/shared/tableDraft';
import { bindTableDraft, assertTableDraftBinding } from '../../src/main/tableDraftBinding';
import { tableDraftSaveSchema, tableDraftVerifySchema } from '../../src/shared/tableDraftCommands';
import { TableEditWorkspace } from '../../src/renderer/tableEditWorkspace';
import { captureTableDraft } from '../../src/renderer/tableDraft';
import { collectChanges } from '../../src/renderer/dataChanges';
import type { ConnectionProfile, TableInfo } from '../../src/shared/contracts';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';

/** 合成精度和字节跨两原页；文件不携带数据库密码或任何原会话令牌。 */
function fixture() {
  const info: TableInfo = { database: 'db', name: 'items', objectKind: 'table', engine: 'InnoDB', ddl: '', primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], columns: ['id', 'note', 'bytes'].map(name => ({ name, type: name === 'bytes' ? 'blob' : 'text', nullable: false, defaultValue: null, extra: '', generated: false, comment: '' })) };
  const profile = { id: 'conn', name: '合成连接', dialect: 'mysql', host: 'fixture.invalid', port: 3306, user: 'fixture', database: 'db', color: '', group: '', rememberPassword: false } satisfies ConnectionProfile;
  const document: TableDraftDocument = { kind: 'dbark.table-draft', version: 2, endpointKey: 'a'.repeat(64), target: { connectionId: profile.id, database: info.database, table: info.name }, metadataKey: tableCopyMetadataKey(info), changes: [
    { kind: 'update', before: { id: '18446744073709551615', note: '{"n":9007199254740993,"n":-0}', bytes: { type: 'binary', base64: 'AP+A' } }, values: { note: '第一页\0中文🚢' } },
    { kind: 'delete', before: { id: '2', note: '', bytes: { type: 'binary', base64: '' } } },
    { kind: 'insert', values: { note: null } },
  ], workspace: { pageSize: 50, activePage: 7, pages: [{ index: 2, changes: 1 }, { index: 7, changes: 2 }] } };
  const edits = new TableEditWorkspace(), scope = '准确查询', uid = () => crypto.randomUUID();
  return { info, profile, document, edits, scope, uid };
}

describe('多页草稿文件第二版', () => {
  it('二进制与精度文本和分组无损往返，旧第一版仍按原格式读写', () => {
    const f = fixture(); expect(decodeTableDraft(encodeTableDraft(f.document))).toEqual(f.document);
    const { workspace: _workspace, ...old } = f.document; old.version = 1;
    expect(decodeTableDraft(encodeTableDraft(old))).toEqual(old);
    expect(encodeTableDraft(old)).not.toContain('workspace');
    const parsed = parseTableDraftDocument(f.document); expect(parsed.workspace).not.toBe(f.document.workspace); expect(parsed.workspace!.pages[0]).not.toBe(f.document.workspace!.pages[0]);
  });
  it.each([
    undefined, null, {}, { pageSize: 0, activePage: 7, pages: [{ index: 7, changes: 3 }] },
    { pageSize: 1001, activePage: 7, pages: [{ index: 7, changes: 3 }] },
    { pageSize: 1, activePage: 2, pages: [{ index: 7, changes: 3 }] },
    { pageSize: 1, activePage: 7, pages: [{ index: 7, changes: 2 }] },
    { pageSize: 1, activePage: 7, pages: [{ index: 7, changes: 4 }] },
    { pageSize: 1, activePage: 7, pages: [{ index: 7, changes: 1 }, { index: 7, changes: 2 }] },
    { pageSize: 1, activePage: 7, pages: [{ index: 7, changes: 2 }, { index: 2, changes: 1 }] },
    { pageSize: 1, activePage: 7, pages: [{ index: 2, changes: 0 }, { index: 7, changes: 3 }] },
    { pageSize: 1, activePage: 7, pages: [{ index: 2.5, changes: 1 }, { index: 7, changes: 2 }] },
    { pageSize: 1, activePage: 10000001, pages: [{ index: 10000001, changes: 3 }] },
    { pageSize: 1, activePage: 7, pages: [{ index: 7, changes: 3, token: '不能接受' }] },
    { pageSize: 1, activePage: 7, pages: [{ index: 7, changes: 3 }], selection: '不能接受' },
  ])('分组损坏或越界整份拒绝：%j', workspace => {
    const f = fixture(); expect(() => parseTableDraftDocument({ ...f.document, workspace })).toThrow();
    expect(() => decodeTableDraft(JSON.stringify({ ...f.document, workspace }))).toThrow();
  });
  it('版本必须与分组对应，IPC保存同样严格，不允许第一版夹带分组', () => {
    const f = fixture(), { kind: _kind, version: _version, endpointKey: _endpoint, ...payload } = f.document;
    expect(tableDraftSaveSchema.parse({ payload }).payload).toEqual(payload);
    expect(() => parseTableDraftDocument({ ...f.document, version: 1 })).toThrow();
    expect(() => parseTableDraftDocument({ ...f.document, version: 3 })).toThrow();
    expect(() => parseTableDraftPayload({ ...payload, workspace: { ...payload.workspace, pages: [] } })).toThrow();
    // 原独立核验只领取目标与全组变更，分组不能改变任何SQL或绕过原核验契约。
    const verify = tableDraftVerifySchema.parse({ ...payload.target, taskId: crypto.randomUUID(), metadataKey: payload.metadataKey, changes: payload.changes });
    expect(verify.changes).toEqual(payload.changes); expect(Object.hasOwn(verify, 'workspace')).toBe(false);
  });
  it('拒绝分组getter、稀疏页数组和继承字段，不执行访问器', () => {
    const f = fixture(); let calls = 0;
    const getter = Object.defineProperty({ pageSize: 50, activePage: 7 }, 'pages', { enumerable: true, get() { calls++; return []; } });
    for (const workspace of [getter, Object.create(f.document.workspace!), { ...f.document.workspace, pages: new Array(2) }]) expect(() => parseTableDraftDocument({ ...f.document, workspace })).toThrow();
    expect(calls).toBe(0);
    const many = Array.from({ length: 17 }, (_, index) => ({ index: index + 1, changes: 1 }));
    expect(() => parseTableDraftDocument({ ...f.document, changes: many.map(() => ({ kind: 'insert', values: {} })), workspace: { pageSize: 1, activePage: 1, pages: many } })).toThrow();
  });
  it('主进程绑定第二版端点并复核准确目标，改变主机不能恢复旧分组', () => {
    const f = fixture(), { kind: _kind, version: _version, endpointKey: _endpoint, ...payload } = f.document, bound = bindTableDraft(payload, f.profile);
    expect(bound.version).toBe(2); expect(bound.workspace).toEqual(payload.workspace);
    expect(() => assertTableDraftBinding(bound, bound.target, f.profile)).not.toThrow();
    expect(() => assertTableDraftBinding(bound, bound.target, { ...f.profile, host: 'changed.invalid' })).toThrow();
  });
});

describe('恢复后多页本地工作区', () => {
  it('恢复原页号和活动分组，发新UUID、保留完整旧值；各组编辑及撤销独立，全组再次保存', () => {
    const f = fixture(), snapshot = structuredClone(f.document), selected = f.edits.restoreDraft(f.scope, f.profile, f.info, f.document, f.uid);
    expect(f.edits.restored).toBe(true); expect(selected.index).toBe(7); expect(f.edits.pages.map(page => page.index)).toEqual([2, 7]);
    expect(collectChanges(f.edits.allRows(selected.rows))).toEqual(f.document.changes); expect(f.edits.pages.every(page => !page.history.status.undo)).toBe(true);
    const first = f.edits.pages[0]; f.edits.selectRestored(first);
    const before = first.rows, after = before.map(row => ({ ...row, data: { ...row.data, note: '恢复后又编辑' } }));
    f.edits.update(before, after); f.edits.history.record(before, after);
    f.edits.selectRestored(selected); expect(f.edits.history.status.undo).toBe(0); expect(first.history.status.undo).toBe(1);
    f.edits.selectRestored(first); const undone = f.edits.history.move(after, 'undo')!; f.edits.update(after, undone);
    expect(collectChanges(f.edits.allRows(undone))).toEqual(snapshot.changes); expect(f.document).toEqual(snapshot);
    const payload = captureTableDraft(f.edits.allRows(undone), f.document.target, f.info, f.edits.draftLayout(undone));
    expect(payload.workspace).toEqual({ ...f.document.workspace, activePage: 2 }); expect(payload.changes).toEqual(snapshot.changes);
    expect(() => f.edits.navigate(3, f.scope)).toThrow(); expect(() => f.edits.selectRestored({ ...first })).toThrow();
    const batch = f.edits.batch(undone)!; expect(batch.pages).toBe(2); expect(batch.current()).toBe(true);
    f.edits.selectRestored(selected); expect(batch.current()).toBe(false);
  });
  it('坏结构、坏编号、坏分组及内存超限不替换原干净页，也不部分恢复', () => {
    for (const kind of ['结构', '编号', '分组', '预算']) {
      const f = fixture(), data = { id: '原页', note: '', bytes: null }, rows = [{ id: '原编号', data, original: { ...data }, inserted: false, deleted: false }];
      const original = f.edits.adopt(f.scope, f.profile, f.info, { page: 1, pageSize: 50, columns: [], rows: [data], hasMore: false }, rows);
      const doc = structuredClone(f.document);
      if (kind === '结构') doc.metadataKey = '旧结构';
      if (kind === '分组') doc.workspace!.pages[0].changes++;
      if (kind === '预算') {
        const large = Object.fromEntries(Array.from({ length: 101 }, (_, index) => ['c' + index, null]));
        f.info.columns = Object.keys(large).map(name => ({ ...f.info.columns[0], name })); f.info.primaryKey = ['c0']; f.info.editableKey = ['c0'];
        doc.metadataKey = tableCopyMetadataKey(f.info); doc.changes = Array.from({ length: 1000 }, (_, index) => ({ kind: 'update', before: { ...large, c0: String(index) }, values: { c1: '变化' } })); doc.workspace = { pageSize: 50, activePage: 1, pages: [{ index: 1, changes: 1000 }] };
      }
      expect(() => f.edits.restoreDraft(f.scope, f.profile, f.info, doc, kind === '编号' ? () => '重复编号' : f.uid)).toThrow();
      expect(f.edits.selected).toBe(original); expect(f.edits.selected!.rows).toBe(rows); expect(f.edits.restored).toBe(false);
    }
  });
  it('恢复组明确放弃、只剩一组再次保存仍保留原页号；连接ABA后不允许再切组', () => {
    const f = fixture(); f.edits.restoreDraft(f.scope, f.profile, f.info, f.document, f.uid);
    expect(f.edits.discard(f.edits.pages[0])).toBe(true);
    const selected = f.edits.selected!; expect(f.edits.draftLayout(selected.rows)).toEqual({ pageSize: 50, activePage: 7, pages: [{ index: 7, changes: 2 }] });
    f.edits.observe(f.scope, {}); f.edits.observe(f.scope, f.profile); expect(f.edits.stale).toBe(true);
    expect(() => f.edits.selectRestored(selected)).toThrow(); expect(() => f.edits.draftLayout(selected.rows)).toThrow(); expect(f.edits.changeCount).toBe(2);
  });
  it('从干净活动页保存只保留有变化的原页，活动分组确定落在实际保存的组内', () => {
    const f = fixture(); f.edits.restoreDraft(f.scope, f.profile, f.info, f.document, f.uid);
    const first = f.edits.pages[0]; f.edits.selectRestored(first);
    const before = first.rows, clean = before.map(row => ({ ...row, data: structuredClone(row.original!) })); f.edits.update(before, clean);
    const layout: TableDraftWorkspace = f.edits.draftLayout(clean)!; expect(layout.pages).toEqual([{ index: 7, changes: 2 }]); expect(layout.activePage).toBe(7);
    expect(parseTableDraftPayload(captureTableDraft(f.edits.allRows(clean), f.document.target, f.info, layout)).changes).toHaveLength(2);
  });
});
