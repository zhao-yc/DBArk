import { describe, expect, it } from 'vitest';
import type { ColumnInfo, DataRow, TableInfo } from '../../src/shared/contracts';
import { collectChanges, type DraftRow } from '../../src/renderer/dataChanges';
import { beginRecordDraft, editRecordInput, RecordLeaveGuard, type RecordContext } from '../../src/renderer/recordViews';
import { parseJsonLexicalTree, type LexicalPathSegment } from '../../src/renderer/jsonLexicalTree';
import { beginRecordJsonStructureInput, changeRecordJsonStructureInput, recordJsonStructureDirty, stageRecordJsonStructureInput } from '../../src/renderer/recordJsonStructureInput';

/** 原始服务器值与既有页面草稿分开，捕获同一真实文档、行及有序根对象。 */
function fixture(key = 'doc', value = ' {"n":9007199254740993, "\\u006e" : -0,\n "n":1e999}\r\n', segments: readonly LexicalPathSegment[] = []) {
  const data = Object.fromEntries([['id', '18446744073709551615'], [key, value], ['note', '既有页面草稿'], ['flag', true]]) as DataRow;
  const row: DraftRow = { id: '本地行', data, original: { ...data, note: '服务器备注' }, inserted: false, deleted: false }, rows = [row];
  const columns: ColumnInfo[] = ['id', key, 'note', 'flag'].map(name => ({ name, type: name === key ? 'LONGTEXT' : 'TEXT', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' }));
  const info: TableInfo = { database: '库', name: '表', objectKind: 'table', engine: 'InnoDB', editableKey: ['id'], primaryKey: ['id'], columns, indexes: [], foreignKeys: [], ddl: '' };
  const context: RecordContext = { target: { connectionId: '连接', database: '库', table: '表' }, connectionVersion: 2, generation: 3, info, loaded: true, stale: false, busy: false }, draft = beginRecordDraft(row, context);
  const document = parseJsonLexicalTree(value); if (document.status !== 'ready') throw Error(document.reason);
  const selection = { row, columnName: key, document, segments, identity: { target: draft.target, metadata: draft.metadata, connectionVersion: 2, generation: 3, rowId: row.id, data, original: row.original, inserted: false, deleted: false } };
  return { row, rows, value, context, draft, document, columnName: key, selection };
}
/** 输入仍是未归一化原文，只有最终暂存才解析一基成员序号。 */
function changed(x: ReturnType<typeof fixture>, fromText = '2', toText = '1') { return changeRecordJsonStructureInput(beginRecordJsonStructureInput(x, 'move-member'), { kind: 'move-member', fromText, toText }); }

describe('记录对象成员移动：真实草稿与捕获身份', () => {
  it('入口无待移动输入时不dirty，位置改字后仍只保存在原互斥缓冲', () => {
    const x = fixture(), input = beginRecordJsonStructureInput(x, 'move-member'), next = changeRecordJsonStructureInput(input, { kind: 'move-member', fromText: '2', toText: '1' });
    expect(input.action).toEqual({ kind: 'move-member', fromText: '1', toText: '1' }); expect(recordJsonStructureDirty(input)).toBe(false); expect(stageRecordJsonStructureInput(x.rows, input, x.context)).toBe(x.rows);
    expect(recordJsonStructureDirty(next)).toBe(true); expect(next.base.session).toBe(input.base.session); expect(x.row.data.doc).toBe(x.value); expect(next.base.draft.fields.size).toBe(0);
  });
  it('只更新原DraftRow.data的JSON字段，保留原值、其它页面草稿及另行引用', () => {
    const x = fixture(), input = changed(x), other: DraftRow = { ...x.row, id: '另一行', data: { ...x.row.data, id: '2' }, original: { ...x.row.original!, id: '2' } }, next = stageRecordJsonStructureInput([x.row, other], input, x.context);
    expect(next[0].data.doc).toBe(' {"\\u006e" : -0, "n":9007199254740993,\n "n":1e999}\r\n'); expect(next[0].data.note).toBe('既有页面草稿'); expect(next[0].data.flag).toBe(true); expect(next[0].original).toBe(x.row.original); expect(next[1]).toBe(other);
    expect(collectChanges(next)).toEqual([{ kind: 'update', before: x.row.original, values: { doc: next[0].data.doc, note: '既有页面草稿' } }, { kind: 'update', before: other.original, values: { note: '既有页面草稿' } }]); expect(x.row.data.doc).toBe(x.value);
  });
  it.each(['__proto__', 'constructor', '名 字'])('真实列%s仍按Map精确定位', key => { const x = fixture(key), next = stageRecordJsonStructureInput(x.rows, changed(x), x.context); expect(Object.hasOwn(next[0].data, key)).toBe(true); expect(Object.getPrototypeOf(next[0].data)).toBe(Object.prototype); expect(next[0].data[key]).not.toBe(x.value); });
  it('同位置或完全相同成员的移动不制造新行数组', () => {
    const x = fixture(); expect(stageRecordJsonStructureInput(x.rows, changed(x, '2', '2'), x.context)).toBe(x.rows);
    const same = fixture('doc', '{"n":1,"n":1}'); expect(stageRecordJsonStructureInput(same.rows, changed(same), same.context)).toBe(same.rows);
  });
  it.each(['', '0', '01', '-1', '+1', '1.0', '1e0', ' 1', '1 ', '１', '9007199254740992'])('非法成员序号%s保留且不部分暂存', value => {
    const x = fixture(); for (const input of [changed(x, value, '1'), changed(x, '1', value)]) { expect(recordJsonStructureDirty(input)).toBe(true); expect(() => stageRecordJsonStructureInput(x.rows, input, x.context)).toThrow('完整十进制'); expect(x.row.data.doc).toBe(x.value); }
  });
  it.each([['4', '1'], ['1', '4']])('成员越界%s到%s整体拒绝', (from, to) => { const x = fixture(); expect(() => stageRecordJsonStructureInput(x.rows, changed(x, from, to), x.context)).toThrow('范围'); expect(x.row.data.doc).toBe(x.value); });
  it('位置字段的联合UTF16/UTF8预算仍保留旧完整缓冲', () => {
    const x = fixture(), input = beginRecordJsonStructureInput(x, 'move-member'); for (const fromText of ['1'.repeat(262144), '汉'.repeat(90000)]) expect(() => changeRecordJsonStructureInput(input, { kind: 'move-member', fromText, toText: '1' })).toThrow('单字段预算'); expect(input.action).toEqual({ kind: 'move-member', fromText: '1', toText: '1' });
  });
  it('操作类型与输入会话不互换，重新打开形成独立session', () => {
    const x = fixture(), first = beginRecordJsonStructureInput(x, 'move-member'), second = beginRecordJsonStructureInput(x, 'move-member'); expect(first.base.session).not.toBe(second.base.session); expect(() => changeRecordJsonStructureInput(first, { kind: 'move-element', fromText: '1', toText: '0' })).toThrow('操作类型');
  });
  it('已有未暂存普通字段不能和成员移动同时打开', () => {
    const x = fixture(), draft = editRecordInput(x.draft, x.context.info!.columns.find(column => column.name === 'note')!, { mode: 'text', text: '尚未暂存' }); expect(() => beginRecordJsonStructureInput({ ...x, draft }, 'move-member')).toThrow('先处理');
  });
  it.each(['target', 'version', 'generation', 'metadata', 'row', 'data', 'original', 'uuid', 'inserted', 'deleted', 'raw'])('最终暂存重新拒绝陈旧身份%s', kind => {
    const x = fixture(), input = changed(x), context = { ...x.context }, rows = [x.row];
    if (kind === 'target') context.target = { ...context.target, table: '另表' }; if (kind === 'version') context.connectionVersion++; if (kind === 'generation') context.generation++; if (kind === 'metadata') context.info = { ...context.info!, editableKey: [] }; if (kind === 'row') rows[0] = { ...x.row }; if (kind === 'data') rows[0] = { ...x.row, data: { ...x.row.data } }; if (kind === 'original') rows[0] = { ...x.row, original: { ...x.row.original! } }; if (kind === 'uuid') rows[0] = { ...x.row, id: '新行' }; if (kind === 'inserted') rows[0] = { ...x.row, inserted: true }; if (kind === 'deleted') rows[0] = { ...x.row, deleted: true }; if (kind === 'raw') x.row.data.doc = '{}';
    expect(() => stageRecordJsonStructureInput(rows, input, context)).toThrow(); expect(input.action).toEqual({ kind: 'move-member', fromText: '2', toText: '1' });
  });
  it.each(['view', 'key', 'engine', 'generated', 'busy', 'stale', 'loaded'])('入口和暂存复用能力门%s', kind => {
    const x = fixture(), input = changed(x), context = { ...x.context, info: { ...x.context.info!, columns: x.context.info!.columns.map(column => ({ ...column })) } };
    if (kind === 'view') context.info.objectKind = 'view'; if (kind === 'key') context.info.editableKey = []; if (kind === 'engine') context.info.engine = 'MyISAM'; if (kind === 'generated') context.info.columns.find(column => column.name === 'doc')!.generated = true; if (kind === 'busy') context.busy = true; if (kind === 'stale') context.stale = true; if (kind === 'loaded') context.loaded = false;
    expect(() => beginRecordJsonStructureInput({ ...x, context, draft: beginRecordDraft(x.row, context) }, 'move-member')).toThrow(); expect(() => stageRecordJsonStructureInput(x.rows, input, context)).toThrow(); expect(x.row.data.doc).toBe(x.value);
  });
  it('空对象、非对象和过期相同文档选择拒绝', () => {
    for (const value of ['{}', '[]', '0']) { const x = fixture('doc', value); expect(() => beginRecordJsonStructureInput(x, 'move-member')).toThrow(); }
    const x = fixture(), document = parseJsonLexicalTree(x.value); if (document.status !== 'ready') throw Error(document.reason); expect(() => beginRecordJsonStructureInput({ ...x, document }, 'move-member')).toThrow('身份');
  });
  it('当前三选保持首次导航意图，暂存失败不清门、放弃不应用对象移动', () => {
    const x = fixture(), invalid = changed(x, '0', '2'), guard = new RecordLeaveGuard(), actions: string[] = [];
    expect(guard.request(recordJsonStructureDirty(invalid), () => actions.push('首次导航'))).toBe(false); expect(guard.request(true, () => actions.push('后续导航'))).toBe(false);
    expect(guard.resolve('stage', () => { try { stageRecordJsonStructureInput(x.rows, invalid, x.context); return true; } catch { return false; } }, () => actions.push('放弃'))).toBe(false); expect(actions).toEqual([]);
    expect(guard.resolve('discard', () => false, () => actions.push('放弃'))).toBe(true); expect(actions).toEqual(['放弃', '首次导航']); expect(x.row.data.doc).toBe(x.value);
  });
  it('三选留在当前保持原文，合法暂存后才继续原导航', () => {
    const x = fixture(), input = changed(x), guard = new RecordLeaveGuard(), actions: string[] = []; let rows = x.rows;
    guard.request(true, () => actions.push('导航')); expect(guard.resolve('stay', () => false, () => undefined)).toBe(true); expect(actions).toEqual([]); expect(input.action).toEqual({ kind: 'move-member', fromText: '2', toText: '1' });
    guard.request(true, () => actions.push('导航')); expect(guard.resolve('stage', () => { rows = stageRecordJsonStructureInput(rows, input, x.context); return true; }, () => undefined)).toBe(true); expect(actions).toEqual(['导航']); expect(rows[0].data.doc).not.toBe(x.value);
  });
});
