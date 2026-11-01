import { describe, expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import { sqliteTableEditLimits, type SqliteOriginalValue, type SqliteTableEditOutcome, type SqliteTableEditPreview } from '../../src/shared/sqliteTableEdit';
import { SqliteTableEditor } from '../../src/renderer/sqliteTableEditor';

const text = (value: string): SqliteOriginalValue => ({ kind: 'text', value }), nil = (): SqliteOriginalValue => ({ kind: 'null' });
/** 原页包含真实可显示的非有限值/生成值；矩形外的这些原对象不应被新输入schema重写。 */
function page(count = 3, width = 5, generated = new Set([3]), nonfinite = new Set([4])): SqliteTablePage {
  const columns = Array.from({ length: width }, (_, index) => ({ name: 'c' + index, declaredType: '', generated: generated.has(index) })), rows = Array.from({ length: count }, (_, row) => columns.map((column, index): SqliteOriginalValue => nonfinite.has(index) ? { kind: 'real', value: 'Infinity' } : column.generated ? text('生成' + row) : index === 0 ? { kind: 'integer', value: String(row + 1) } : text('原' + row + ':' + index)));
  return { schemaKey: 'a'.repeat(64), target: { connectionId: 'sqlite', database: 'main', table: '矩形草稿', kind: 'table' }, columns, offset: 0, limit: 1000, hasMore: false, result: { columns: columns.map((column, index) => ({ key: 'c' + index, name: column.name, type: 'SQLITE' })), rows: rows.map(() => ({})), statement: '', elapsedMs: 0, truncated: false }, edit: { kind: 'editable', snapshotId: 'snapshot-original', expiresAt: new Date(1800000).toISOString(), columns: columns.map(column => ({ ...column, nullable: true, hasDefault: true })), rows, locator: { kind: 'rowid', columns: [] } } };
}
function fixture(source = page()) {
  let current = true, active = true, available = true, now = 0, serial = 0;
  const previewResult: SqliteTableEditPreview = { previewId: 'preview-original', snapshotId: 'snapshot-original', target: source.target, schemaKey: source.schemaKey, expiresAt: new Date(300000).toISOString(), confirmation: 'main.矩形草稿', sql: ['原SQL预览'], counts: { insert: 0, update: 1, delete: 0 } }, id = vi.fn(() => 'draft-' + ++serial), release = vi.fn(async (_value: { snapshotId?: string; previewId?: string }) => {}), preview = vi.fn(async (_value: unknown) => previewResult), apply = vi.fn(async (_value: unknown): Promise<SqliteTableEditOutcome> => { throw Error('矩形暂存不得写入DB'); }), changed = vi.fn(), dirty = vi.fn();
  const editor = new SqliteTableEditor(source, { current: () => current, active: () => active, available: () => available, now: () => now, id, acquire: () => ({ owns: () => true, release: () => true }), release, preview, apply, changed, dirty, cancel: async () => {}, committed: () => {} });
  const save = (row: number, column: number, value: SqliteOriginalValue) => { const values = [...editor.view.rows[row].values]; values[column] = value; editor.save(editor.view.rows[row].id, values); };
  const ready = async () => { save(0, 1, text('已修改')); await editor.preview(); expect(editor.view.preview).toBe(previewResult); };
  return { editor, source, id, release, preview, apply, changed, dirty, previewResult, save, ready, active: (value: boolean) => { active = value; }, available: (value: boolean) => { available = value; }, current: (value: boolean) => { current = value; editor.observe(); }, expire: () => { now = 1800000; editor.observe(); } };
}
/** 只读检查真实账本引用和副作用次数，断言拒绝/noop不触发半批发布或释放。 */
function capture(f: ReturnType<typeof fixture>) { const inner = f.editor as unknown as { past: unknown[]; future: unknown[]; input: boolean }; return { rows: f.editor.view.rows, past: inner.past, pastLength: inner.past.length, future: inner.future, futureLength: inner.future.length, input: inner.input, preview: f.editor.view.preview, message: f.editor.view.message, changes: structuredClone(f.editor.changes), ids: f.id.mock.calls.length, releases: f.release.mock.calls.length, previews: f.preview.mock.calls.length, applies: f.apply.mock.calls.length, changed: f.changed.mock.calls.length, dirty: f.dirty.mock.calls.length }; }
function unchanged(f: ReturnType<typeof fixture>, before: ReturnType<typeof capture>) { const inner = f.editor as unknown as { past: unknown[]; future: unknown[]; input: boolean }; expect(f.editor.view.rows).toBe(before.rows); expect(inner.past).toBe(before.past); expect(inner.past).toHaveLength(before.pastLength); expect(inner.future).toBe(before.future); expect(inner.future).toHaveLength(before.futureLength); expect(inner.input).toBe(before.input); expect(f.editor.view.preview).toBe(before.preview); expect(f.editor.view.message).toBe(before.message); expect(f.editor.changes).toEqual(before.changes); expect(f.id).toHaveBeenCalledTimes(before.ids); expect(f.release).toHaveBeenCalledTimes(before.releases); expect(f.preview).toHaveBeenCalledTimes(before.previews); expect(f.apply).toHaveBeenCalledTimes(before.applies); expect(f.changed).toHaveBeenCalledTimes(before.changed); expect(f.dirty).toHaveBeenCalledTimes(before.dirty); }

const patch = (row: number, column: number, before: string, after: string) => ({ rowId: 'original-' + row, column, before, after });
/** 大预算夹具全部为可替换TEXT，避免测试用类型转换绕过真实TEXT目标门。 */
function textPage(count: number, width: number) { const source = page(count, width, new Set(), new Set()); if (source.edit?.kind !== 'editable') throw Error('缺少编辑夹具'); source.edit.rows.forEach((row, index) => row.forEach((_value, column) => { row[column] = text('原' + index + ':' + column); })); return source; }

describe('SQLite当前页文本替换仅原子暂存准确TEXT格', () => {
  it('同批多格与已有脏值合并，只克隆变化行和值数组，原生成/非有限/其它格引用保持', () => {
    const f = fixture(); f.save(2, 2, text('已存在草稿')); const original = f.editor.view.rows;
    expect(f.editor.replaceTextCells([patch(0, 1, '原0:1', '新A'), patch(0, 2, '原0:2', '新B'), patch(1, 1, '原1:1', '新C')])).toBe(3); const after = f.editor.view.rows;
    expect(after).not.toBe(original); expect(after[0]).not.toBe(original[0]); expect(after[1]).not.toBe(original[1]); expect(after[2]).toBe(original[2]); for (const column of [0, 3, 4]) expect(after[0].values[column]).toBe(original[0].values[column]);
    expect(f.editor.changes).toEqual([{ kind: 'update', row: 0, values: [{ column: 'c1', value: text('新A') }, { column: 'c2', value: text('新B') }] }, { kind: 'update', row: 1, values: [{ column: 'c1', value: text('新C') }] }, { kind: 'update', row: 2, values: [{ column: 'c2', value: text('已存在草稿') }] }]);
    f.editor.undo(); expect(f.editor.view.rows).toBe(original); f.editor.redo(); expect(f.editor.view.rows).toBe(after); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(f.id).not.toHaveBeenCalled();
  });

  it('纯文本保留NUL/JSON/Unicode及替换结果原字符，不解析数字、NULL、DEFAULT或捕获符号', () => {
    const f = fixture(), replacements = ['\0中文🚢{"x":1}\n$&$1', 'NULL', 'DEFAULT', '9223372036854775807'];
    replacements.forEach(after => { const cell = f.editor.view.rows[0].values[1]; if (cell?.kind !== 'text') throw Error('非TEXT夹具'); expect(f.editor.replaceTextCells([patch(0, 1, cell.value, after)])).toBe(1); expect(f.editor.view.rows[0].values[1]).toEqual(text(after)); });
  });

  it('成功仅一次发布/undo，清input且准确旧preview仅释放一次，原脏值保持', async () => {
    const f = fixture(); await f.ready(); f.editor.inputOpen(true); const before = capture(f);
    expect(f.editor.replaceTextCells([patch(0, 1, '已修改', '继续替换'), patch(1, 2, '原1:2', '第二行')])).toBe(2); expect(f.release).toHaveBeenCalledTimes(before.releases + 1); expect(f.release).toHaveBeenLastCalledWith({ previewId: f.previewResult.previewId }); expect(f.changed).toHaveBeenCalledTimes(before.changed + 1); expect((f.editor as unknown as { input: boolean }).input).toBe(false); expect(f.editor.view.preview).toBeUndefined(); f.editor.undo(); expect(f.editor.view.rows).toBe(before.rows); expect(f.editor.changes).toEqual(before.changes);
  });

  it('全部noop保原rows/undo/redo/input/preview和所有通知，不触发IPC', async () => {
    const f = fixture(); await f.ready(); f.editor.inputOpen(true); const before = capture(f); expect(f.editor.replaceTextCells([patch(0, 1, '已修改', '已修改'), patch(1, 1, '原1:1', '原1:1')])).toBe(0); unchanged(f, before);
  });

  it('混合noop与变化只统计实际改格，变回原TEXT复制原属性序以消除最后diff', () => {
    const source = page(); if (source.edit?.kind !== 'editable') throw Error('缺少编辑夹具'); source.edit.rows[0][1] = { value: '原属性序', kind: 'text' }; const f = fixture(source); f.save(0, 1, text('已改')); const original = f.editor.view.rows;
    expect(f.editor.replaceTextCells([patch(0, 1, '已改', '原属性序'), patch(1, 1, '原1:1', '原1:1')])).toBe(1); expect(f.editor.changes).toEqual([]); expect(f.editor.dirty).toBe(false); expect(f.editor.view.rows[0].values[1]).not.toBe(source.edit.rows[0][1]); expect(Object.keys(f.editor.view.rows[0].values[1]!)).toEqual(['value', 'kind']); f.editor.undo(); expect(f.editor.view.rows).toBe(original);
  });

  it('newrow实际TEXT允许替换，DEFAULT/NULL永不自动转为TEXT', () => {
    const f = fixture(), id = f.editor.add()!, values = [...f.editor.view.rows.at(-1)!.values]; values[1] = text('新增原文'); values[2] = nil(); f.editor.save(id, values);
    expect(f.editor.replaceTextCells([{ rowId: id, column: 1, before: '新增原文', after: '新增替换' }])).toBe(1); const before = capture(f);
    for (const column of [0, 2]) { expect(() => f.editor.replaceTextCells([{ rowId: id, column, before: '', after: '不可转换' }])).toThrow(); unchanged(f, before); }
    expect(f.editor.changes).toEqual([{ kind: 'insert', values: [{ column: 'c1', value: text('新增替换') }, { column: 'c2', value: nil() }] }]);
  });

  it.each([{ kind: 'integer', value: '1' }, { kind: 'real', value: '1.5' }, { kind: 'real', value: 'Infinity' }, { kind: 'blob', value: 'AA==' }, { kind: 'null' }] as SqliteOriginalValue[])('拒非TEXT原格%j，不读取显示文本冒充动态类型', value => {
    const source = page(); if (source.edit?.kind !== 'editable') throw Error('缺少编辑夹具'); source.edit.rows[0][1] = value; const f = fixture(source), before = capture(f); expect(() => f.editor.replaceTextCells([patch(0, 1, 'value' in value ? value.value : 'NULL', '文本')])).toThrow(); unchanged(f, before);
  });

  it('任何准确before不符/generated/deleted/重复坐标/越界目标使整批失败，前格也不发布', () => {
    for (const kind of ['before', 'generated', 'deleted', 'duplicate', 'column', 'row'] as const) {
      const f = fixture(); if (kind === 'deleted') f.editor.remove('original-1'); const before = capture(f), second = kind === 'before' ? patch(1, 1, '旧回包', '不应写') : kind === 'generated' ? patch(1, 3, '生成1', '不应写') : kind === 'duplicate' ? patch(0, 1, '原0:1', '重复') : kind === 'column' ? patch(1, 5, '', '越界') : kind === 'row' ? { rowId: '不存在', column: 1, before: '', after: '越界' } : patch(1, 1, '原1:1', '不应写');
      expect(() => f.editor.replaceTextCells([patch(0, 1, '原0:1', '前格'), second])).toThrow(); unchanged(f, before);
    }
  });

  it.each(['empty', 'sparse', 'getter', 'field-getter', 'hidden', 'extra', 'nonplain', 'wrong-kind', 'wrong-column', 'wrong-before', 'wrong-after'] as const)('拒%s结构，getter完全不执行且账本零变', kind => {
    const f = fixture(), before = capture(f), getter = vi.fn(() => '不应读取'); let input: unknown = [patch(0, 1, '原0:1', '新')];
    if (kind === 'empty') input = []; if (kind === 'sparse') input = new Array(1); if (kind === 'getter') Object.defineProperty(input, '0', { enumerable: true, get: getter }); if (kind === 'field-getter') Object.defineProperty((input as object[])[0], 'after', { enumerable: true, get: getter }); if (kind === 'hidden') Object.defineProperty((input as object[])[0], 'after', { enumerable: false, value: '新' }); if (kind === 'extra') Object.assign((input as object[])[0], { extra: 1 }); if (kind === 'nonplain') input = [new (class { rowId = 'original-0'; column = 1; before = '原0:1'; after = '新'; })()]; if (kind === 'wrong-kind') input = [null]; if (kind === 'wrong-column') input = [{ ...patch(0, 1, '原0:1', '新'), column: '1' }]; if (kind === 'wrong-before') input = [{ ...patch(0, 1, '原0:1', '新'), before: null }]; if (kind === 'wrong-after') input = [{ ...patch(0, 1, '原0:1', '新'), after: undefined }];
    expect(() => f.editor.replaceTextCells(input as Parameters<SqliteTableEditor['replaceTextCells']>[0])).toThrow(); expect(getter).not.toHaveBeenCalled(); unchanged(f, before);
  });

  it('重复草稿ID拒歧义，超10000项/单串/输入总量拒绝且无大矩阵分配', () => {
    const f = fixture(); f.id.mockReturnValue('original-1'); f.editor.add(); let before = capture(f); expect(() => f.editor.replaceTextCells([patch(0, 1, '原0:1', '新')])).toThrow(); unchanged(f, before);
    const g = fixture(); before = capture(g); for (const input of [new Array(4294967295), Array.from({ length: 10001 }, () => patch(0, 1, '原0:1', '')), [patch(0, 1, '原0:1', 'x'.repeat(sqliteTableEditLimits.valueUnits + 1))]]) { expect(() => g.editor.replaceTextCells(input)).toThrow(); unchanged(g, before); }
  });

  it('500条上限按post-patch算，可先清第501条旧修改再补新行，不能按patch数累加', () => {
    const f = fixture(textPage(501, 1)); for (let row = 0; row < 501; row++) f.save(row, 0, text('改' + row)); expect(f.editor.changes).toHaveLength(501); expect(f.editor.replaceTextCells([patch(0, 0, '改0', '原0:0')])).toBe(1); expect(f.editor.changes).toHaveLength(500); const before = capture(f); expect(() => f.editor.replaceTextCells([patch(0, 0, '原0:0', '又改')])).toThrow(); unchanged(f, before);
  });

  it('10000字段按完整最终差异计算，已有脏值不能被替换预算忽略', () => {
    const f = fixture(textPage(101, 100)); for (let row = 0; row < 100; row++) f.editor.save('original-' + row, Array.from({ length: 100 }, () => text('旧改'))); const before = capture(f); expect(() => f.editor.replaceTextCells([patch(100, 0, '原100:0', '新')])).toThrow(); unchanged(f, before);
    expect(f.editor.replaceTextCells([patch(0, 0, '旧改', '原0:0'), patch(100, 0, '原100:0', '新')])).toBe(2); expect(f.editor.changes.reduce((sum, change) => sum + (change.kind === 'delete' ? 0 : change.values.length), 0)).toBe(10000);
  });

  it('2MiB完整草稿预算不能绕过，清旧大差异后才允许新格，changed after也受输入总预算', () => {
    const f = fixture(textPage(33, 1)), size = sqliteTableEditLimits.valueUnits; for (let row = 0; row < 32; row++) f.save(row, 0, text('x'.repeat(row === 31 ? size - 64 : size))); const before = capture(f); expect(() => f.editor.replaceTextCells([patch(32, 0, '原32:0', '')])).toThrow(); unchanged(f, before); expect(f.editor.replaceTextCells([patch(0, 0, 'x'.repeat(size), '原0:0'), patch(32, 0, '原32:0', '')])).toBe(2);
    const g = fixture(textPage(32, 1)), stable = capture(g); expect(() => g.editor.replaceTextCells(Array.from({ length: 32 }, (_, row) => patch(row, 0, '原' + row + ':0', '新'.repeat(size))))).toThrow(); unchanged(g, stable);
  });

  it('大于新输入门的原TEXT可准确缩短，原样noop不触动undo/input/preview；后格非法仍整批拒绝', () => {
    const source = textPage(2, 1), large = '大原文\0🚢'.repeat(20000); if (source.edit?.kind !== 'editable') throw Error('缺少编辑夹具'); source.edit.rows[0][0] = text(large); const f = fixture(source); f.editor.inputOpen(true); const before = capture(f);
    expect(f.editor.replaceTextCells([patch(0, 0, large, large)])).toBe(0); unchanged(f, before); expect(() => f.editor.replaceTextCells([patch(0, 0, large, '已缩短'), patch(1, 0, '错误before', '后格')])).toThrow(); unchanged(f, before);
    expect(f.editor.replaceTextCells([patch(0, 0, large, '已缩短')])).toBe(1); expect(f.editor.changes).toEqual([{ kind: 'update', row: 0, values: [{ column: 'c0', value: text('已缩短') }] }]); f.editor.undo(); expect(f.editor.view.rows).toBe(before.rows);
  });

  it.each(['inactive', 'unavailable', 'expired', 'source-aba', 'disposed'] as const)('资格%s失效不替换、不分配ID或发送IPC', state => {
    const f = fixture(); if (state === 'inactive') f.active(false); if (state === 'unavailable') f.available(false); if (state === 'expired') f.expire(); if (state === 'source-aba') { f.current(false); f.current(true); } if (state === 'disposed') f.editor.dispose(); const before = capture(f); expect(() => f.editor.replaceTextCells([patch(0, 1, '原0:1', '新')])).toThrow(); unchanged(f, before);
  });

  it('真实preview pending与unknown写入终态拒替换，原批不能复活', async () => {
    const f = fixture(); f.save(0, 1, text('旧草稿')); let resolve!: (value: SqliteTableEditPreview) => void; f.preview.mockImplementationOnce(() => new Promise<SqliteTableEditPreview>(yes => { resolve = yes; })); const pending = f.editor.preview(), busy = capture(f); expect(() => f.editor.replaceTextCells([patch(0, 1, '旧草稿', '新')])).toThrow(); unchanged(f, busy); resolve(f.previewResult); await pending;
    f.apply.mockResolvedValue({ operationId: 'op', target: f.source.target, outcome: 'unknown', counts: { insert: 0, update: 1, delete: 0 }, message: '未知', fact: { operationId: 'op', target: f.source.target, phase: 'unknown', requestedRows: 1, appliedRows: 0, commitMayHaveBeenSent: true, commitAcknowledged: false, rollbackAcknowledged: false } }); await f.editor.apply(); const unknown = capture(f); expect(() => f.editor.replaceTextCells([patch(0, 1, '旧草稿', '新')])).toThrow(); unchanged(f, unknown);
  });

  it('解析中重入后继编辑时旧patch不得覆盖，准确before也不能借await后旧源发布', () => {
    const f = fixture(), original = f.editor.view.rows, value = new Proxy(patch(0, 1, '原0:1', '旧计划'), { ownKeys(target) { f.save(2, 1, text('后继编辑')); return Reflect.ownKeys(target); } }); expect(() => f.editor.replaceTextCells([value])).toThrow(); expect(f.editor.view.rows[0]).toBe(original[0]); expect(f.editor.view.rows[2].values[1]).toEqual(text('后继编辑')); expect(f.editor.changes).toEqual([{ kind: 'update', row: 2, values: [{ column: 'c1', value: text('后继编辑') }] }]); expect((f.editor as unknown as { past: unknown[] }).past).toHaveLength(1); expect(f.id).not.toHaveBeenCalled(); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  });
});
