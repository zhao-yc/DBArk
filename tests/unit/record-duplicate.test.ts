import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnInfo, CommandMap, DataRow, TableInfo } from '../../src/shared/contracts';
import { validateCommand } from '../../src/shared/validation';
import { buildChanges } from '../../src/engine/sql';
import { collectChanges, type DraftRow } from '../../src/renderer/dataChanges';
import { assertCopiedRecordKeys, duplicateRecordDraft, recordDuplicateReadonlyReason } from '../../src/renderer/recordDuplicate';
import { captureRecordPagePreview, recordReadonlyReason, recordTargetKey, type RecordContext } from '../../src/renderer/recordViews';
import { errorMessage, ownCell } from '../../src/renderer/lib';
import { recordDuplicateZh } from '../../src/renderer/locales/recordDuplicate.zh-CN';
import { tableCopyMetadataKey } from '../../src/shared/tableCopySource';
import { recordCopySourceReady, recordCopyMetadataReason } from '../../src/renderer/recordCopySource';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';

/** 真实线路类型只允许精确标量和二进制包装；原行与当前草稿各自独立。 */
function fixture(auto = true) {
  const columns: ColumnInfo[] = [['id', 'bigint unsigned'], ['code', 'varchar(20)'], ['big', 'bigint unsigned'], ['amount', 'decimal(30,6)'], ['time', 'datetime(6)'], ['nullable', 'text'], ['empty', 'text'], ['word', 'text'], ['payload', 'blob'], ['empty_binary', 'blob'], ['flag', 'tinyint'], ['small', 'int'], ['json', 'json'], ['hidden', 'text'], ['default_value', 'text'], ['computed', 'varchar(20)'], ['__proto__', 'text'], ['constructor', 'text'], ['toString', 'text']].map(([name, type]) => ({ name, type, nullable: name !== 'id', generated: name === 'computed', extra: name === 'id' && auto ? 'auto_increment' : name === 'computed' ? 'STORED GENERATED' : '', defaultValue: name === 'default_value' ? '服务器默认值' : null, comment: '' }));
  const info: TableInfo = { database: '隔离库', name: '复制表', objectKind: 'table', engine: 'InnoDB', ddl: '', columns, indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], primaryKey: ['id'], editableKey: ['id'], foreignKeys: [] };
  const data: DataRow = Object.fromEntries([['id', '18446744073709551615'], ['code', '原键'], ['big', '9007199254740993123'], ['amount', '12345678901234567890.120000'], ['time', '2026-10-16 01:02:03.123456'], ['nullable', null], ['empty', ''], ['word', 'NULL'], ['payload', { type: 'binary', base64: 'AP+AAA==' }], ['empty_binary', { type: 'binary', base64: '' }], ['flag', false], ['small', 7], ['json', ' {"n":9007199254740993,"n":1e999} '], ['hidden', '隐藏值'], ['computed', '服务器计算'], ['__proto__', '原型值'], ['constructor', '构造值'], ['toString', '方法值']]);
  data.default_value = '服务器已有值';
  const source: DraftRow = { id: 'source', data, original: structuredClone(data), inserted: false, deleted: false };
  const rows = [source];
  const context: RecordContext = { target: { connectionId: '连接', database: info.database, table: info.name }, connectionVersion: 4, generation: 9, info, loaded: true, stale: false, busy: false };
  return { info, source, rows, context };
}

describe('复制现有记录只追加精确新增草稿', () => {
  it('保留完整现有精确值和隐藏列，仅省略自增/生成；真实校验/SQL仍为INSERT', () => {
    const f = fixture(), next = duplicateRecordDraft(f.rows, f.source.id, f.context, 'copy'), copy = next[1];
    expect(next).not.toBe(f.rows); expect(next[0]).toBe(f.source); expect(f.rows).toHaveLength(1);
    expect(copy).toMatchObject({ id: 'copy', inserted: true, deleted: false }); expect(copy.original).toBeUndefined();
    for (const name of ['id', 'computed']) expect(Object.hasOwn(copy.data, name)).toBe(false);
    expect(copy.data.default_value).toBe('服务器已有值');
    for (const name of ['big', 'amount', 'time', 'nullable', 'empty', 'word', 'flag', 'small', 'json', 'hidden']) expect(ownCell(copy.data, name)).toBe(ownCell(f.source.data, name));
    const changes = collectChanges(next), validated = validateCommand('table.preview', { ...f.context.target, changes }) as CommandMap['table.preview']['input'];
    expect(validated.changes).toEqual(changes); expect(changes).toHaveLength(1); expect(changes[0].kind).toBe('insert');
    const preview = buildChanges(f.info, changes); expect(preview.statements).toHaveLength(1); expect(preview.statements[0].sql).toMatch(/^INSERT INTO/); expect(preview.statements[0].sql).not.toContain('`computed`'); expect(preview.statements[0].sql).toContain('`default_value`');
    expect(preview.statements[0].params).toContain('12345678901234567890.120000'); expect(preview.statements[0].params).toContain('2026-10-16 01:02:03.123456'); expect(preview.statements[0].params).toContain(null);
  });
  it('二进制包装不共享，零字节与NULL分开，不能借修改复制值污染原始快照', () => {
    const f = fixture(), copy = duplicateRecordDraft(f.rows, 'source', f.context, 'copy')[1];
    expect(copy.data.payload).toEqual(f.source.data.payload); expect(copy.data.payload).not.toBe(f.source.data.payload); expect(copy.data.payload).not.toBe(f.source.original!.payload);
    expect(copy.data.empty_binary).toEqual({ type: 'binary', base64: '' }); expect(copy.data.nullable).toBeNull();
    (copy.data.payload as { base64: string }).base64 = 'AQ=='; expect(f.source.data.payload).toEqual({ type: 'binary', base64: 'AP+AAA==' }); expect(f.source.original!.payload).toEqual({ type: 'binary', base64: 'AP+AAA==' });
  });
  it.each(['__proto__', 'constructor', 'toString'])('特殊列%s保持自有属性，不污染对象原型', key => {
    const f = fixture(), copy = duplicateRecordDraft(f.rows, 'source', f.context, 'copy')[1]; expect(Object.hasOwn(copy.data, key)).toBe(true); expect(ownCell(copy.data, key)).toBe(ownCell(f.source.data, key)); expect(Object.getPrototypeOf(copy.data)).toBe(Object.prototype);
  });
  it('只按auto_increment标记省略；DEFAULT_GENERATED普通列的现有值仍复制', () => {
    const f = fixture(); f.info.columns.find(column => column.name === 'id')!.extra = 'AuTo_InCrEmEnT'; f.info.columns.find(column => column.name === 'time')!.extra = 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP';
    const copy = duplicateRecordDraft(f.rows, 'source', f.context, 'copy')[1]; expect(Object.hasOwn(copy.data, 'id')).toBe(false); expect(copy.data.time).toBe(f.source.data.time);
  });
  it('复制当前已暂存值，同时保持原行修改、其他新增/删除草稿及数组顺序', () => {
    const f = fixture(); f.source.data.hidden = '已暂存隐藏值'; const added: DraftRow = { id: 'added', data: { code: '其他新增' }, inserted: true, deleted: false }, deleted: DraftRow = { ...f.source, id: 'deleted', deleted: true }; f.rows.push(added, deleted);
    const next = duplicateRecordDraft(f.rows, 'source', f.context, 'copy'); expect(next.slice(0, 3)).toEqual(f.rows); next.slice(0, 3).forEach((row, index) => expect(row).toBe(f.rows[index])); expect(next[3].data.hidden).toBe('已暂存隐藏值'); expect(f.source.original!.hidden).toBe('隐藏值'); expect(collectChanges(next).map(change => change.kind)).toEqual(['update', 'insert', 'delete', 'insert']);
  });
  it('普通主键和唯一键原样保留，不自动编号、填NULL或更换值', () => {
    const f = fixture(false); f.info.indexes.push({ name: 'uq_code', columns: ['code'], unique: true }); const next = duplicateRecordDraft(f.rows, 'source', f.context, 'copy'); expect(next[1].data.id).toBe('18446744073709551615'); expect(next[1].data.code).toBe('原键'); expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).toThrow('主键或唯一键冲突'); expect(next[1].data.id).toBe(f.source.data.id);
  });
  it.each(['', 'source'])('拒绝无效或复用本地草稿身份：%s', newId => { const f = fixture(); expect(() => duplicateRecordDraft(f.rows, 'source', f.context, newId)).toThrow(recordDuplicateZh.changed); expect(f.rows).toHaveLength(1); });
  it.each(['not-loaded', 'no-info', 'stale', 'busy', 'view', 'unknown-kind', 'no-key', 'non-InnoDB', 'deleted', 'inserted', 'missing-original', 'missing-source', 'missing-original-key', 'null-original-key', 'unknown-key-column', 'wrong-target'] as const)('%s不提升可写资格且不生成草稿', condition => {
    const f = fixture(); let sourceId: string | undefined = 'source';
    if (condition === 'not-loaded') f.context.loaded = false; else if (condition === 'no-info') f.context.info = null; else if (condition === 'stale') f.context.stale = true; else if (condition === 'busy') f.context.busy = true; else if (condition === 'view') f.info.objectKind = 'view'; else if (condition === 'unknown-kind') f.info.objectKind = undefined; else if (condition === 'no-key') f.info.editableKey = []; else if (condition === 'non-InnoDB') f.info.engine = 'MyISAM'; else if (condition === 'deleted') f.source.deleted = true; else if (condition === 'inserted') f.source.inserted = true; else if (condition === 'missing-original') f.source.original = undefined; else if (condition === 'missing-source') sourceId = undefined; else if (condition === 'missing-original-key') delete f.source.original!.id; else if (condition === 'null-original-key') f.source.original!.id = null; else if (condition === 'unknown-key-column') f.info.columns = f.info.columns.filter(column => column.name !== 'id'); else f.context.target.table = '其他目标';
    expect(() => duplicateRecordDraft(f.rows, sourceId, f.context, 'copy')).toThrow(); expect(recordDuplicateReadonlyReason(f.context, sourceId ? f.source : undefined)).not.toBe(''); expect(f.rows).toHaveLength(1);
  });
});

describe('复制草稿的集中预览键冲突边界', () => {
  it('INT载入数字与网格重新输入的同值字符串仍冲突，不将精确大整数转Number', () => {
    const f = fixture(false); f.source.data.id = 1; f.source.original!.id = 1; const next = duplicateRecordDraft(f.rows, 'source', f.context, 'copy'); next[1].data.id = '1'; expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).toThrow('PRIMARY'); next[1].data.id = '2'; expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).not.toThrow(); expect(next[1].data.big).toBe('9007199254740993123');
  });
  it('自增键省略可预览；新增行显式填回冲突值后必须修改', () => {
    const f = fixture(), next = duplicateRecordDraft(f.rows, 'source', f.context, 'copy'); expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).not.toThrow(); next[1].data.id = f.source.data.id; expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).toThrow('PRIMARY'); next[1].data.id = '18446744073709551614'; expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).not.toThrow();
  });
  it('复合唯一键须完整相等才是确定冲突；任何NULL/DEFAULT不能被当相同键值', () => {
    const f = fixture(); f.info.indexes.push({ name: 'uq_code_hidden', columns: ['code', 'hidden'], unique: true }); const next = duplicateRecordDraft(f.rows, 'source', f.context, 'copy'); expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).toThrow('uq_code_hidden'); next[1].data.code = '用户新键'; expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).not.toThrow(); next[1].data.code = null; expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).not.toThrow(); delete next[1].data.code; expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).not.toThrow();
  });
  it('二进制唯一键按完整字节包装比对；不做文本或浮点数转换', () => {
    const f = fixture(); f.info.indexes.push({ name: 'uq_bytes', columns: ['payload'], unique: true }); const next = duplicateRecordDraft(f.rows, 'source', f.context, 'copy'); expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).toThrow('uq_bytes'); next[1].data.payload = { type: 'binary', base64: 'AQ==' }; expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).not.toThrow();
  });
  it('以提交前有效草稿值比较，已有更新释放旧键后不拿original误报；删除先于复制插入', () => {
    const f = fixture(false), next = duplicateRecordDraft(f.rows, 'source', f.context, 'copy'); f.source.data.id = '2'; expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).not.toThrow(); next[1].data.id = '2'; expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).toThrow(); f.source.deleted = true; expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).not.toThrow();
  });
  it('不检查原有普通草稿，也不把已删除的复制草稿拿来阻塞预览', () => {
    const f = fixture(false), next = duplicateRecordDraft(f.rows, 'source', f.context, 'copy'); expect(() => assertCopiedRecordKeys(next, f.info, new Set())).not.toThrow(); next[1].deleted = true; expect(() => assertCopiedRecordKeys(next, f.info, new Set(['copy']))).not.toThrow();
  });
});

// 从生产组件抽取真实入口与预览处理函数，只替换状态/DOM/IPC端口，不模拟另一套实现。
const source = readFileSync(new URL('../../src/renderer/components/TableTab.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('TableTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), functions = new Map<string, string>(); let disabled = '';
/** 精确定位本功能按钮与处理函数，确保真正接到网格，而非只测未使用的helper。 */
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && ['assertGridWritable', 'duplicateCurrentRow', 'makePreview'].includes(node.name.text)) functions.set(node.name.text, node.getText(tree));
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'button' && node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'aria-label' && attribute.initializer?.getText(tree) === '{recordDuplicateZh.action}')) {
    const attribute = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'disabled'); if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) disabled = attribute.initializer.expression!.getText(tree);
  }
  node.forEachChild(visit);
}
visit(tree);
const handlerCode = ts.transpileModule([...functions.values()].join('\n') + '\nglobalThis.copyAction=duplicateCurrentRow;globalThis.previewAction=makePreview;globalThis.copyDisabled=()=>(' + disabled + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
/** 生产事件处理器在无DOM/GUI和无真实IPC环境运行，所有服务器入口均为观察端口。 */
function eventFixture(auto = true) {
  const f = fixture(auto), selected = { rowId: 'source', key: 'hidden' }, selectedRows = new Set(['source']), setRows = vi.fn(), setSelection = vi.fn(), setSelectedRows = vi.fn(), invoke = vi.fn(async (_command: string, _input: unknown) => ({ sql: 'INSERT', statements: [], warnings: [] }));
  const port = createContext({ structuredClone, Error, recordCopySourceReady, recordCopyMetadataReason, copyMetadataReason: '', copyPage: { current: { page: { copyMetadataKey: tableCopyMetadataKey(f.info) }, target: recordTargetKey(f.context.target), connectionVersion: f.context.connectionVersion, generation: f.context.generation } }, copySourceReady: false, copySources: { current: null }, copyRowRefs: { current: new Map() }, copyPendingRef: { current: false }, document: { querySelector: () => null }, rootElement: { current: { querySelector: () => null } }, record: { dirty: false, hasInput: () => false, request: vi.fn() }, rowsRef: { current: f.rows }, selectionRef: { current: selected }, selectedRows, referenceRow: f.source, blocked: false, blockedRef: { current: false }, copiedDraftIds: { current: new Set<string>() }, getRecordContext: () => f.context, uid: () => 'copy', duplicateRecordDraft, recordDuplicateReadonlyReason, assertCopiedRecordKeys, captureRecordPagePreview, recordReadonlyReason, recordDuplicateZh, recordViewZh, errorMessage, setRows, setSelection, setSelectedRows, setError: vi.fn(), setDuplicateNotice: vi.fn(), invoke, previewingRef: { current: false }, applyingRef: { current: false }, preview: null, referenceCount: { current: 0 }, loadingCount: { current: 0 }, preferencesLock: { current: false }, useWorkspace: { getState: () => ({ setBusy: vi.fn() }) }, tab: { id: 'table-tab' }, base: f.context.target, loadGeneration: { current: f.context.generation }, recordContextRef: { current: f.context }, setPreviewing: vi.fn(), setPreview: vi.fn() });
  setRows.mockImplementation(next => { port.rowsRef.current = next; }); runInContext(handlerCode, port); return { ...f, port, setRows, invoke, selected, selectedRows, setSelection, setSelectedRows };
}

describe('真实表页复制入口与集中预览控制端口', () => {
  it('按钮接生产处理器，追加一次且不改变选择/勾选/表单，不调用IPC或剪贴板', () => {
    expect(functions.size).toBe(3); expect(disabled).not.toBe(''); const f = eventFixture(); expect(f.port.copyDisabled()).toBe(false); f.port.copyAction(); expect(f.setRows).toHaveBeenCalledOnce(); expect(f.port.rowsRef.current).toHaveLength(2); expect(f.port.selectionRef.current).toBe(f.selected); expect(f.port.selectedRows).toBe(f.selectedRows); expect(f.setSelection).not.toHaveBeenCalled(); expect(f.setSelectedRows).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled(); expect([...f.port.copiedDraftIds.current]).toEqual(['copy']);
  });
  it.each(['busy', 'stale', 'view', 'no-key', 'no-selection', 'new-row', 'deleted', 'record-input', 'grid-input', 'dialog', 'missing-data', 'missing-original', 'own-undefined', 'unknown-column'] as const)('%s晚到事件再次守卫，不追加/不请求IPC', condition => {
    const f = eventFixture(); if (condition === 'busy') f.context.busy = true; else if (condition === 'stale') f.context.stale = true; else if (condition === 'view') f.info.objectKind = 'view'; else if (condition === 'no-key') f.info.editableKey = []; else if (condition === 'no-selection') { f.port.selectionRef.current = undefined; f.port.referenceRow = undefined; } else if (condition === 'new-row') f.source.inserted = true; else if (condition === 'deleted') f.source.deleted = true; else if (condition === 'record-input') { f.port.record.hasInput = () => true; f.port.record.dirty = true; } else if (condition === 'grid-input') f.port.rootElement.current.querySelector = () => ({}); else if (condition === 'dialog') f.port.document.querySelector = () => ({}); else if (condition === 'missing-data') delete f.source.data.hidden; else if (condition === 'missing-original') delete f.source.original!.hidden; else if (condition === 'own-undefined') Object.defineProperty(f.source.data, 'hidden', { value: undefined, enumerable: true }); else f.source.data.unlisted = '不在当前目录的值';
    if (!['grid-input', 'dialog'].includes(condition)) expect(f.port.copyDisabled()).toBe(true); f.port.copyAction(); expect(f.setRows).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled(); expect(f.port.rowsRef.current).toBe(f.rows); expect(f.port.copiedDraftIds.current.size).toBe(0);
  });
  it('普通键冲突在预览IPC之前报错；用户修改后仍只走原table.preview而非apply', async () => {
    const f = eventFixture(false); f.port.copyAction(); await f.port.previewAction(); expect(f.invoke).not.toHaveBeenCalled(); expect(f.port.setError).toHaveBeenLastCalledWith(expect.stringContaining('主键或唯一键冲突')); expect(f.port.setPreview).not.toHaveBeenCalled(); f.port.rowsRef.current[1].data.id = '18446744073709551614'; await f.port.previewAction(); expect(f.invoke).toHaveBeenCalledOnce(); expect(f.invoke.mock.calls[0][0]).toBe('table.preview'); expect(f.port.setPreview).toHaveBeenCalledWith(expect.objectContaining({ view: expect.objectContaining({ warnings: [recordDuplicateZh.previewHint] }) }));
  });
});
