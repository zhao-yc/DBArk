import { expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { sqliteTableFilterSchema, sqliteTablePageSchema, type SqliteFilterSelection } from '../../src/shared/sqliteTableBrowse';
import { assertSqliteValueOptions, sqliteValueOptionSchema, sqliteValueOptionsInputSchema, sqliteValueOptionsSelection, type SqliteValueOptionsInput } from '../../src/shared/sqliteValueOptions';
import { buildSqliteFilteredSelect, buildSqliteReadPlan } from '../../src/shared/sqliteReadSql';
import { SqliteValueOptionsController } from '../../src/renderer/sqliteValueOptions';
import { sqliteTableDraft } from '../../src/renderer/sqliteTableBrowser';
import { sqlitePresetDraft } from '../../src/renderer/sqliteTablePresetDraft';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import { SqliteFilteredSelectIntent } from '../../src/renderer/sqliteFilteredSelectUi';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';

const request: SqliteValueOptionsInput = { connectionId: 'c', database: 'main', table: 'subject', column: 'v', schemaKey: 'a'.repeat(64), taskId: 'values', mode: 'and', filters: [], search: '' };
const options = [{ value: { kind: 'integer' as const, value: '9223372036854775807' }, count: '2' }, { value: { kind: 'text' as const, value: '前\0🚢' }, count: '1' }, { value: { kind: 'null' as const }, count: '3' }];
it.each(['value', 'count-desc', 'count-asc'] as const)('声明的分组排序%s往返严格请求，旧缺省请求不新增字段', order => {
  expect(sqliteValueOptionsInputSchema.parse({ ...request, order })).toEqual({ ...request, order }); expect(sqliteValueOptionsInputSchema.parse(request)).not.toHaveProperty('order');
  const input = { ...request, order }; expect(assertSqliteValueOptions({ request: input, values: [], truncated: false }, input).request).toEqual(input);
});
it.each(['', 'COUNT-DESC', 'desc', null, 1, {}])('拒绝非声明排序%j', order => { expect(sqliteValueOptionsInputSchema.safeParse({ ...request, order }).success).toBe(false); });
it('整份回包绑定排序，次数使用64位原整数核单调性，不接受错序或串序', () => {
  const input = { ...request, order: 'count-desc' as const }, values = [
    { value: { kind: 'null' as const }, count: '9007199254740993' },
    { value: { kind: 'text' as const, value: '' }, count: '9007199254740992' },
    { value: { kind: 'text' as const, value: 'hot' }, count: '100' },
    { value: { kind: 'text' as const, value: 'warm' }, count: '9' },
  ];
  expect(assertSqliteValueOptions({ request: input, values, truncated: false }, input).values).toEqual(values);
  expect(() => assertSqliteValueOptions({ request: input, values: [...values].reverse(), truncated: false }, input)).toThrow('顺序');
  const asc = { ...input, order: 'count-asc' as const }; expect(assertSqliteValueOptions({ request: asc, values: [...values].reverse(), truncated: false }, asc).values).toHaveLength(4);
  expect(() => assertSqliteValueOptions({ request: input, values, truncated: false }, asc)).toThrow('原请求');
  expect(() => assertSqliteValueOptions({ request: { ...input, order: undefined }, values, truncated: false }, input)).toThrow('原请求');
});
/** 可控端口只验证调度与来源，实际数据库及窗口另由原生worker和桌面专项覆盖。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(baseOrder?: 'count-desc') {
  const read = deferred<unknown>(), cancel = deferred<unknown>(), base = structuredClone(request), state = { current: true, owns: true }, release = vi.fn(), readPort = vi.fn(async (_input: SqliteValueOptionsInput) => read.promise as any), cancelPort = vi.fn(async () => cancel.promise), changed = vi.fn(), cleanup = vi.fn();
  if (baseOrder) Object.assign(base, { order: baseOrder });
  const controller = new SqliteValueOptionsController({ base, current: () => state.current, acquire: () => ({ owns: () => state.owns, release }), read: readPort, cancel: cancelPort, id: () => 'values', changed, cleanup });
  return { controller, base, state, read, cancel, release, readPort, cancelPort, changed, cleanup };
}
it('控制器显式次数排序只调用原任务，取消仍等待原读取及ACK两侧终态', async () => {
  const f = fixture(), reading = f.controller.read('v', '', 'count-desc'); await Promise.resolve(); expect(f.readPort).toHaveBeenCalledExactlyOnceWith({ ...request, order: 'count-desc' });
  const stopping = f.controller.stop(); await Promise.resolve(); f.read.resolve({ request: { ...request, order: 'count-desc' }, values: [], truncated: false }); await Promise.resolve();
  expect(f.release).not.toHaveBeenCalled(); expect(f.controller.view.busy).toBe(true); await f.controller.read('v', '', 'count-asc'); expect(f.readPort).toHaveBeenCalledTimes(1);
  f.cancel.resolve(undefined); await stopping; await reading; expect(f.release).toHaveBeenCalledTimes(1); expect(f.controller.view.output).toBeUndefined(); expect(f.controller.view.busy).toBe(false);
});
it('控制器拒绝乱序或另一排序的回包，旧缺省读取不继承base隐藏排序', async () => {
  const f = fixture('count-desc'); const reading = f.controller.read('v', ''); await Promise.resolve(); expect(f.readPort.mock.calls[0][0]).not.toHaveProperty('order');
  f.read.resolve({ request: { ...request, order: 'count-desc' }, values: [], truncated: false }); await reading; expect(f.controller.view.output).toBeUndefined(); expect(f.controller.view.error).not.toBe(''); expect(f.release).toHaveBeenCalledTimes(1);
});
it('混合类型和NULL是一条完整条件，OR/AND与NOT补集、分页和生成SQL保持精度', () => {
  const db = new DatabaseSync(':memory:'); try {
    db.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY,v COLLATE NOCASE)'); const insert = db.prepare('INSERT INTO subject VALUES(?,?)');
    [9223372036854775807n, '9223372036854775807', 2n, 2.5, '前\0🚢', Buffer.from('00ff', 'hex'), null, 'a', 'A'].forEach((value, index) => insert.run(index + 1, value));
    const selectedValues: SqliteFilterSelection[] = [...options.map(option => option.value), { kind: 'blob', value: '00ff' }, { kind: 'text', value: 'A' }];
    for (const operator of ['oneOf', 'notOneOf'] as const) for (const mode of ['and', 'or'] as const) {
      const input = { connectionId: 'c', database: 'main' as const, table: 'subject', taskId: 'read', offset: 1, limit: 2, mode, sort: [{ column: 'id', direction: 'asc' as const }], filters: [{ column: 'v', operator, selectedValues }, { column: 'id', operator: 'gte' as const, value: { kind: 'integer' as const, value: '8' } }] };
      // 只选择INTEGER最大值，不应匹配第2行的同内容TEXT。
      const chosen = [1, 5, 6, 7, 8, 9], expected = Array.from({ length: 9 }, (_, index) => index + 1).filter(id => { const match = operator === 'oneOf' ? chosen.includes(id) : !chosen.includes(id); return mode === 'and' ? match && id >= 8 : match || id >= 8; });
      const columns = [{ name: 'id', declaredType: 'INTEGER' }, { name: 'v', declaredType: '' }], sql = buildSqliteFilteredSelect(input, columns, ['id']); expect(db.prepare(sql).all().map(row => row.id)).toEqual(expected);
      const plan = buildSqliteReadPlan(input, columns, ['id']); expect(plan.parameters).toHaveLength(12); expect(sql).not.toContain('\0');
    }
  } finally { db.close(); }
});
it('纯勾选数据拒绝getter、稀疏数组、超量/跨值字段；整个筛选仍受值与绑定预算', () => {
  let called = false; const getter = { kind: 'text' }; Object.defineProperty(getter, 'value', { get() { called = true; return ''; }, enumerable: true });
  for (const selectedValues of [[], [getter], [{ kind: 'null', value: '' }], [{ kind: 'integer', value: '9223372036854775808' }], [{ kind: 'real', value: 'Infinity' }], Array(1), Array.from({ length: 129 }, () => ({ kind: 'null' }))]) for (const enabled of [true, false]) expect(sqliteTableFilterSchema.safeParse({ column: 'v', operator: 'oneOf', selectedValues, enabled }).success).toBe(false);
  expect(called).toBe(false);
  const filter = { column: 'v', operator: 'oneOf', selectedValues: Array.from({ length: 128 }, () => ({ kind: 'text', value: 'a' })) }, page = { connectionId: 'c', database: 'main', table: 'subject', taskId: 'r', offset: 0, limit: 1, mode: 'and', sort: [] };
  expect(sqliteTablePageSchema.safeParse({ ...page, filters: [filter, filter, filter, { ...filter, selectedValues: filter.selectedValues.slice(0, 127) }] }).success).toBe(true);
  expect(sqliteTablePageSchema.safeParse({ ...page, filters: [filter, filter, filter, filter] }).success).toBe(false);
  expect(sqliteTableFilterSchema.safeParse({ ...filter, selectedValues: [{ kind: 'text', value: 'a'.repeat(65536) }, { kind: 'text', value: 'a'.repeat(65536) }, { kind: 'text', value: 'x' }], enabled: false }).success).toBe(false);
});
it('精确回包绑定完整请求；无穷REAL可展示但不可勾选，重复/稀疏候选编号拒绝', () => {
  const output = assertSqliteValueOptions({ request, values: [...options, { value: { kind: 'real', value: 'Infinity' }, count: '1' }], truncated: false }, request);
  expect(sqliteValueOptionsSelection(output, [0, 2])).toEqual([options[0].value, options[2].value]);
  for (const indices of [[0, 0], [-1], [4], [3], Array(1)]) expect(() => sqliteValueOptionsSelection(output, indices)).toThrow();
  let called = false; const indices = [0]; Object.defineProperty(indices, 0, { get() { called = true; return 0; } }); expect(() => sqliteValueOptionsSelection(output, indices)).toThrow(); expect(called).toBe(false);
  expect(() => assertSqliteValueOptions(output, { ...request, search: '%' })).toThrow(); expect(() => assertSqliteValueOptions({ ...output, values: [options[0], options[0]] }, request)).toThrow(); expect(() => assertSqliteValueOptions({ ...output, truncated: true }, request)).toThrow();
  for (const count of ['abc', '0', '-1', '9223372036854775808']) expect(sqliteValueOptionSchema.safeParse({ value: { kind: 'null' }, count }).success).toBe(false);
});
it('新勾选条件与命名方案往返保NULL、精度及排除标记；任务概要不含候选或搜索', () => {
  const filter = { id: 'draft', column: 'v', operator: 'notOneOf' as const, kind: 'text' as const, value: '', enabled: false, selectedValues: options.map(option => option.value) };
  const query = sqliteTableDraft({ connectionId: 'c', database: 'main', table: 'subject' }, 5, 'or', [filter], []), restored = sqlitePresetDraft(query, ['v'], () => 'new');
  expect(restored.filters[0]).toMatchObject({ ...filter, id: 'new' }); expect(sqliteTableDraft({ connectionId: 'c', database: 'main', table: 'subject' }, 5, 'or', restored.filters, restored.sort)).toEqual(query);
  expect(persistedTaskMessage('sqlite.valueOptions', { taskId: 'values', status: 'failed', progress: 0, message: '敏感搜索前\0🚢' })).not.toContain('敏感搜索');
});
it('生成SELECT捕获准确勾选数组和每项身份，替换后即使恢复原值也不复活', () => {
  const query = sqliteTableDraft({ connectionId: 'c', database: 'main', table: 'subject' }, 5, 'and', [{ id: 'r', column: 'v', operator: 'oneOf', kind: 'text', value: '', selectedValues: options.map(option => option.value) }], []);
  const page: SqliteTablePage = { schemaKey: request.schemaKey, target: { connectionId: 'c', database: 'main', table: 'subject', kind: 'table' }, columns: [{ name: 'v', declaredType: '' }], result: { columns: [], rows: [], truncated: false, elapsedMs: 0, statement: '' }, offset: 0, limit: 5, hasMore: false };
  const intent = new SqliteFilteredSelectIntent(page, query, () => true), plan = intent.compile(['v']); expect(plan.sql).toContain('9223372036854775807'); expect(plan.sql).toContain('IS NULL');
  const original = query.filters[0].selectedValues!; query.filters[0].selectedValues = [...original]; expect(intent.current()).toBe(false); query.filters[0].selectedValues = original; expect(intent.consume(plan)).toBe(false);
});
it('读取与取消ACK各自终态后才释放租约，旧回包不提供勾选资格', async () => {
  const f = fixture(), work = f.controller.read('v', ''); await Promise.resolve(); expect(f.readPort).toHaveBeenCalledTimes(1);
  const stop = f.controller.stop(); await Promise.resolve(); expect(f.cancelPort).toHaveBeenCalledExactlyOnceWith('values'); f.read.resolve({ request, values: options, truncated: false }); await Promise.resolve(); await Promise.resolve(); expect(f.release).not.toHaveBeenCalled(); expect(f.controller.view.busy).toBe(true);
  f.cancel.resolve(undefined); await Promise.all([work, stop]); expect(f.release).toHaveBeenCalledTimes(1); expect(f.controller.view.output).toBeUndefined(); expect(() => f.controller.selection([0])).toThrow();
});
it.each(['source', 'base', 'lease', 'dispose'] as const)('%s失效后的迟到读取不发布，也不释放其它租约', async mode => {
  const f = fixture(), work = f.controller.read('v', ''); await Promise.resolve(); if (mode === 'source') f.state.current = false; if (mode === 'base') f.base.column = 'other'; if (mode === 'lease') f.state.owns = false; if (mode === 'dispose') f.controller.dispose();
  f.read.resolve({ request, values: options, truncated: false }); f.cancel.resolve(undefined); await work; expect(f.controller.view.output).toBeUndefined(); expect(f.release).toHaveBeenCalledTimes(1);
  if (mode === 'source' || mode === 'base') { f.state.current = true; f.base.column = 'v'; expect(f.controller.current()).toBe(false); }
});
it('同帧取消尚未发送的读取零IPC，取消通知异常不提前释放，严格模式重挂不复活旧操作', async () => {
  const f = fixture(), work = f.controller.read('v', ''), stop = f.controller.stop(); await Promise.all([work, stop]); expect(f.readPort).not.toHaveBeenCalled(); expect(f.cancelPort).not.toHaveBeenCalled();
  const next = f.controller.read('v', ''); await Promise.resolve(); f.controller.dispose(); f.controller.activate(); f.cleanup.mockImplementation(() => { throw Error('通知失败'); }); f.read.resolve({ request, values: options, truncated: false }); f.cancel.reject(Error('取消失败')); await next; expect(f.controller.view.output).toBeUndefined(); expect(f.release).toHaveBeenCalledTimes(1);
});
