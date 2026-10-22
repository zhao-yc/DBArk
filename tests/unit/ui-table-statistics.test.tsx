import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import type { TableColumnStatistics, TableStatisticsInput, TableStatisticsOutput } from '../../src/shared/tableStatistics';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { TableStatisticsIntent, type TableStatisticsConditions } from '../../src/renderer/tableStatisticsIntent';
import { tableStatisticsZh as text } from '../../src/renderer/locales/tableStatistics.zh-CN';
import type { TableStatisticsServices } from '../../src/renderer/components/TableStatisticsDialog';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined, Dialog: typeof import('../../src/renderer/components/TableStatisticsDialog')['TableStatisticsDialog'], official: TableStatisticsServices;
const keys = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'], saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document); document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); if (name === 'input') node.type = 'text'; node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node; };
  ({ createRoot } = await import('react-dom/client')); ({ TableStatisticsDialog: Dialog, tableStatisticsServices: official } = await import('../../src/renderer/components/TableStatisticsDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; Reflect.deleteProperty(window, 'dbark'); });
afterAll(() => { for (const [key, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
/** 真实ReactDOM公开按钮/复选框事件，不调用组件内部状态或复制统计算法。 */
function button(label: string) { const node = document.body.querySelectorAll('button').find(node => node.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function check(name: string) { const node = document.body.querySelectorAll('input').find(node => node.getAttribute('aria-label') === text.selectColumn(name)); expect(node, name).toBeDefined(); expect(node!.disabled).toBe(false); await act(async () => { node!.checked = !node!.checked; node!.dispatchEvent(new MemoryEvent('click')); }); }
/** 按固定中文标签定位不同值开关，不依赖字段数量或DOM下标。 */
function distinctCheckbox() { const node = document.body.querySelectorAll('input').find(node => node.getAttribute('aria-label') === text.distinctOption); expect(node).toBeDefined(); return node!; }
/** 使用实际React复选事件；不会直接修改组件状态或构造替代请求。 */
async function toggleDistinct() { const node = distinctCheckbox(); expect(node.disabled).toBe(false); await act(async () => { node.checked = !node.checked; node.dispatchEvent(new MemoryEvent('click')); }); }
/** 捕获已提交真实DOM的旧事件函数，专门核验禁用属性以外的同步版本门。 */
function callback(node: unknown, name: 'onChange' | 'onClick'): (event?: any) => void { const target = node as Record<string, any>, key = Object.keys(target).find(key => key.startsWith('__reactProps$')); if (!key || typeof target[key][name] !== 'function') throw Error('缺少真实React事件'); return target[key][name]; }
/** 按实际结果行读取列，标题与类型解释不混入单元格数量断言。 */
function resultCells(name: string) { const row = document.body.querySelectorAll('tr').find(row => row.querySelector('th')?.textContent === name); expect(row).toBeDefined(); return row!.querySelectorAll('td'); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
/** 合成服务是RAM观察端；真实服务器聚合、事务隔离、权限与耗时由实库另验。 */
async function mount(options: { statistics?: TableStatisticsServices['statistics']; objectKind?: 'table' | 'view'; services?: TableStatisticsServices } = {}) {
  const base = { connectionId: 'connection', database: 'db', table: 'items' }, types = [['id', 'bigint unsigned'], ['amount', 'decimal(30,6)'], ['score', 'double'], ['doc', 'json'], ['payload', 'blob'], ...Array.from({ length: 9 }, (_, index) => ['extra' + index, 'int'])];
  const source: TableInfo = { database: base.database, name: base.table, objectKind: options.objectKind ?? 'table', engine: options.objectKind === 'view' ? '' : 'InnoDB', columns: types.map(([name, type]) => ({ name, type, nullable: true, defaultValue: null, extra: '', generated: false, comment: '' })), primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], indexes: [], ddl: options.objectKind === 'view' ? 'CREATE VIEW items AS SELECT 1 AS id' : 'CREATE TABLE items (`id` bigint unsigned)' };
  const conditions: TableStatisticsConditions = { filters: [{ column: 'amount', operator: '>=', value: '9007199254740993.000001' }, { column: 'doc', operator: 'IS NULL', enabled: false }], filterMode: 'all', filterGroup: { mode: 'all', children: [0, { mode: 'any', children: [1] }] } };
  const intent = new TableStatisticsIntent(source, conditions, [source, conditions], () => true);
  function output(input: TableStatisticsInput): TableStatisticsOutput { return { source, sourceDigest: 'a'.repeat(64), rowCount: '3', columns: input.columns.map(name => {
    const type = source.columns.find(column => column.name === name)!.type, counts = { name, type, nonNull: '2', nulls: '1' };
    if (name === 'doc') return { ...counts, kind: 'count-only', reason: 'JSON只提供实际数量' };
    if (name === 'payload') return { ...counts, kind: 'ordered', min: { type: 'binary', base64: 'AP8=' }, max: { type: 'binary', base64: '//8=' }, ...(input.distinct ? { distinct: '2' } : {}) };
    return { ...counts, kind: 'numeric', min: name === 'score' ? 1.25 : '9007199254740993.000001', max: name === 'score' ? 2.5 : '999999999999999999.999999', sum: '1234567890123456789012345.123456', avg: '1234567890123456789.0123456789', approximate: name === 'score', ...(input.distinct ? { distinct: '2' } : {}) };
  }) as TableColumnStatistics[], warnings: [] }; }
  const statistics = vi.fn<TableStatisticsServices['statistics']>(options.statistics ?? (async input => output(input))), cancel = vi.fn(async () => {}), close = vi.fn(), activity = vi.fn(), services = options.services ?? { statistics, cancel };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => { root!.render(<Dialog base={base} intent={intent} onClose={close} onActivity={activity} services={services}/>); });
  return { base, source, conditions, intent, statistics, cancel, close, activity, services, output, async render(nextBase = base) { await act(async () => { root!.render(<Dialog base={nextBase} intent={intent} onClose={close} onActivity={activity} services={services}/>); }); } };
}
it('列选择阶段零请求，默认COUNT显式发送冻结全筛选及分组而非当前页', async () => {
  const f = await mount(); expect(distinctCheckbox().checked).toBe(false); expect(f.statistics).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.scope); expect(document.body.textContent).toContain(text.drafts); expect(document.body.textContent).toContain(text.disabledPrefix); await click(text.start); expect(f.statistics).toHaveBeenCalledWith({ ...f.base, taskId: expect.any(String), columns: [], ...f.conditions }); expect(document.body.querySelector('[aria-label="' + text.rowCount + '"]')?.textContent).toBe('3'); expect(f.activity.mock.calls.map(([delta]) => delta)).toEqual([1, -1]);
});
it('不同值勾选零请求且不隐选字段，零选列仍只显示总COUNT', async () => {
  const f = await mount(); await toggleDistinct(); expect(f.statistics).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.selected(0)); expect(document.body.textContent).toContain(text.distinctSemantics);
  await click(text.start); expect(f.statistics).toHaveBeenCalledWith({ ...f.base, taskId: expect.any(String), columns: [], ...f.conditions, distinct: true });
  expect(document.body.querySelector('[aria-label="' + text.rowCount + '"]')?.textContent).toBe('3'); expect(document.body.querySelector('table')).toBeNull();
});
it('显式不同值请求冻结选列与开关，切换立即清旧结果且关闭后不再显示不同值列', async () => {
  const f = await mount(); for (const name of ['amount', 'doc', 'payload']) await check(name); await click(text.start);
  expect(document.body.querySelectorAll('th').some(node => node.textContent === text.distinctColumn)).toBe(false); await toggleDistinct(); expect(document.body.querySelector('[aria-label="' + text.result + '"]')).toBeNull(); expect(f.statistics).toHaveBeenCalledOnce();
  await click(text.start); const request = f.statistics.mock.calls[1][0], frozen = structuredClone(request); expect(request).toMatchObject({ columns: ['amount', 'doc', 'payload'], distinct: true, ...f.conditions });
  expect(document.body.querySelectorAll('th').filter(node => node.textContent === text.distinctColumn)).toHaveLength(1);
  expect(resultCells('amount')[3].textContent).toBe('2'); expect(resultCells('payload')[3].textContent).toBe('2'); expect(resultCells('doc')[3].textContent).toBe(text.distinctUnsupported);
  await toggleDistinct(); expect(document.body.querySelector('[aria-label="' + text.result + '"]')).toBeNull(); expect(f.statistics).toHaveBeenCalledTimes(2); expect(request).toEqual(frozen);
  await click(text.start); expect(Object.hasOwn(f.statistics.mock.calls[2][0], 'distinct')).toBe(false); expect(document.body.querySelectorAll('th').some(node => node.textContent === text.distinctColumn)).toBe(false);
});
it.each(['empty', 'all-null'])('不同值%s为精确0，同时MIN/MAX/SUM/AVG保持NULL', async kind => {
  const f = await mount(); f.statistics.mockImplementation(async input => { const output = f.output(input); output.rowCount = kind === 'empty' ? '0' : '3'; for (const column of output.columns) Object.assign(column, { nonNull: '0', nulls: output.rowCount, min: null, max: null, ...(column.kind === 'numeric' ? { sum: null, avg: null } : {}), distinct: '0' }); return output; });
  await check('amount'); await check('payload'); await toggleDistinct(); await click(text.start);
  for (const name of ['amount', 'payload']) { const cells = resultCells(name); expect(cells[3].textContent).toBe('0'); expect(cells[4].textContent).toBe(text.null); expect(cells[5].textContent).toBe(text.null); }
  expect(resultCells('amount')[6].textContent).toBe(text.null); expect(resultCells('amount')[7].textContent).toBe(text.null);
});
it('同轮勾选与旧开始回调不代投递新开关，旧DOM不能改写后继选择', async () => {
  const f = await mount(); await check('amount'); const oldToggle = callback(distinctCheckbox(), 'onChange'), oldStart = callback(button(text.start), 'onClick');
  await act(async () => { oldToggle({ target: { checked: true } }); oldStart(); }); expect(f.statistics).not.toHaveBeenCalled(); expect(distinctCheckbox().checked).toBe(true);
  await act(async () => { oldToggle({ target: { checked: false } }); oldStart(); }); expect(distinctCheckbox().checked).toBe(true); expect(f.statistics).not.toHaveBeenCalled();
  await click(text.start); expect(f.statistics.mock.calls[0][0]).toMatchObject({ columns: ['amount'], distinct: true });
});
it('不同值与列选择互查同步快照，旧选列回调不能跟随同轮新开关', async () => {
  const f = await mount(), selectId = document.body.querySelectorAll('input').find(node => node.getAttribute('aria-label') === text.selectColumn('id'))!, oldSelect = callback(selectId, 'onChange'), oldToggle = callback(distinctCheckbox(), 'onChange');
  await act(async () => { oldToggle({ target: { checked: true } }); oldSelect({ target: { checked: true } }); }); expect(document.body.textContent).toContain(text.selected(0)); expect(f.statistics).not.toHaveBeenCalled();
  await check('id'); await click(text.start); expect(f.statistics.mock.calls[0][0]).toMatchObject({ columns: ['id'], distinct: true });
});
it('忙碌和关闭期间即使调用旧开关回调也不能修改请求，取消ACK不提前解锁', async () => {
  const delayed = deferred<TableStatisticsOutput>(), acknowledgement = deferred<void>(), f = await mount({ statistics: () => delayed.promise }); f.cancel.mockImplementation(() => acknowledgement.promise);
  await check('amount'); await toggleDistinct(); const oldToggle = callback(distinctCheckbox(), 'onChange'); await click(text.start); const request = f.statistics.mock.calls[0][0];
  expect(distinctCheckbox().disabled).toBe(true); await act(async () => { oldToggle({ target: { checked: false } }); }); expect(distinctCheckbox().checked).toBe(true);
  await click(text.cancel); await act(async () => { acknowledgement.resolve(); }); expect(button(text.start).disabled).toBe(true); expect(distinctCheckbox().disabled).toBe(true); expect(f.activity.mock.calls).toEqual([[1]]);
  await click(text.close); await act(async () => { oldToggle({ target: { checked: false } }); }); expect(distinctCheckbox().checked).toBe(true); expect(f.close).not.toHaveBeenCalled();
  await act(async () => { delayed.resolve(f.output(request)); }); expect(f.close).toHaveBeenCalledOnce(); expect(f.statistics).toHaveBeenCalledOnce(); expect(request.distinct).toBe(true); expect(document.body.querySelector('[aria-label="' + text.result + '"]')).toBeNull();
});
it.each(['2', undefined])('默认关闭时拒绝意外distinct自有属性：%s', async value => {
  const f = await mount(); f.statistics.mockImplementation(async input => { const output = f.output(input); Object.assign(output.columns[0], { distinct: value }); return output; });
  await check('amount'); await click(text.start); expect(document.body.textContent).toContain(text.mismatch); expect(document.body.querySelector('[aria-label="' + text.result + '"]')).toBeNull(); expect(f.statistics).toHaveBeenCalledOnce();
});
it('开启后缺少不同值回执时拒绝整份结果，不降级展示旧聚合', async () => {
  const f = await mount(); f.statistics.mockImplementation(async input => f.output({ ...input, distinct: false })); await check('amount'); await toggleDistinct(); await click(text.start);
  expect(document.body.textContent).toContain(text.mismatch); expect(document.body.querySelector('[aria-label="' + text.result + '"]')).toBeNull(); expect(f.statistics).toHaveBeenCalledOnce();
});
it('0至12真实列可选，13项原子拒绝且不发请求，修改选择撤销旧结果', async () => {
  const f = await mount(); for (const column of f.source.columns.slice(0, 12)) await check(column.name); await check(f.source.columns[12].name); expect(document.body.textContent).toContain(text.tooMany); expect(document.body.textContent).toContain(text.selected(12)); expect(f.statistics).not.toHaveBeenCalled(); await click(text.start); expect(f.statistics.mock.calls[0][0].columns).toEqual(f.source.columns.slice(0, 12).map(column => column.name)); await check('id'); expect(document.body.querySelector('[aria-label="' + text.result + '"]')).toBeNull(); expect(f.statistics).toHaveBeenCalledOnce();
});
it('精确字符串、FLOAT近似、二进制及JSON仅计数如实展示，不做本地聚合', async () => {
  const f = await mount(); for (const name of ['id', 'amount', 'score', 'doc', 'payload']) await check(name); await click(text.start); expect(document.body.textContent).toContain('9007199254740993.000001'); expect(document.body.textContent).toContain('1234567890123456789012345.123456'); expect(document.body.textContent).toContain('1234567890123456789.0123456789'); expect(document.body.textContent).toContain(text.approximate); expect(document.body.textContent).toContain('0x00ff'); expect(document.body.textContent).toContain('JSON只提供实际数量'); expect(f.statistics.mock.calls[0][0].columns).toEqual(['id', 'amount', 'score', 'doc', 'payload']);
});
it.each(['empty', 'all-null'])('%s明确展示NULL而不是零或空字符串', async kind => { const f = await mount(); f.statistics.mockImplementation(async input => { const output = f.output(input); output.rowCount = kind === 'empty' ? '0' : '3'; Object.assign(output.columns[0], { nonNull: '0', nulls: output.rowCount, min: null, max: null, sum: null, avg: null }); return output; }); await check('amount'); await click(text.start); expect(document.body.textContent).toContain(text.null); if (kind === 'empty') expect(document.body.textContent).toContain(text.empty); });
it('view入口沿相同只读显式COUNT协议', async () => { const f = await mount({ objectKind: 'view' }); await click(text.start); expect(f.statistics).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.rowCount); });
it('连点开始只发一次；取消ACK不解锁，迟到成功不展示或自动重试', async () => {
  const delayed = deferred<TableStatisticsOutput>(), f = await mount({ statistics: () => delayed.promise }), start = button(text.start); await act(async () => { start.dispatchEvent(new MemoryEvent('click')); start.dispatchEvent(new MemoryEvent('click')); }); expect(f.statistics).toHaveBeenCalledOnce(); await click(text.cancel); expect(f.cancel).toHaveBeenCalledWith(f.statistics.mock.calls[0][0].taskId); expect(button(text.start).disabled).toBe(true); expect(f.activity.mock.calls).toEqual([[1]]); await act(async () => { delayed.resolve(f.output(f.statistics.mock.calls[0][0])); }); expect(button(text.start).disabled).toBe(false); expect(document.body.querySelector('[aria-label="' + text.rowCount + '"]')).toBeNull(); expect(f.statistics).toHaveBeenCalledOnce(); expect(f.activity.mock.calls).toEqual([[1], [-1]]);
});
it('关闭等待原请求和取消Promise均settle，不接纳迟到成功', async () => {
  const delayed = deferred<TableStatisticsOutput>(), acknowledgement = deferred<void>(), f = await mount({ statistics: () => delayed.promise }); f.cancel.mockImplementation(() => acknowledgement.promise); await click(text.start); await click(text.close); expect(f.close).not.toHaveBeenCalled(); await act(async () => { delayed.resolve(f.output(f.statistics.mock.calls[0][0])); }); expect(f.close).not.toHaveBeenCalled(); await act(async () => { acknowledgement.resolve(); }); expect(f.close).toHaveBeenCalledOnce(); expect(document.body.querySelector('[aria-label="' + text.rowCount + '"]')).toBeNull();
});
it('原页面/行/连接ABA撤销并取消，回到同值不复活', async () => {
  const delayed = deferred<TableStatisticsOutput>(), f = await mount({ statistics: () => delayed.promise }); await click(text.start); await act(async () => { f.intent.observe([{}, f.conditions]); f.intent.observe([f.source, f.conditions]); }); expect(f.cancel).toHaveBeenCalledOnce(); await act(async () => { delayed.resolve(f.output(f.statistics.mock.calls[0][0])); }); expect(document.body.textContent).toContain(text.changed); expect(button(text.start).disabled).toBe(true); expect(document.body.querySelector('[aria-label="' + text.rowCount + '"]')).toBeNull();
});
it('不同目标再恢复不复活，旧开始和旧选列DOM回调不发请求', async () => { const f = await mount(), oldStart = button(text.start), checkbox = document.body.querySelectorAll('input')[0]; await f.render({ ...f.base, table: 'other' }); await f.render(); await act(async () => { checkbox.checked = true; checkbox.dispatchEvent(new MemoryEvent('click')); oldStart.dispatchEvent(new MemoryEvent('click')); }); expect(f.statistics).not.toHaveBeenCalled(); expect(f.intent.current()).toBe(false); });
it('回执对象/列顺序篡改仅报错，错误不会自动重放', async () => { const f = await mount(); f.statistics.mockImplementation(async input => ({ ...f.output(input), source: { ...f.source, name: 'other' } })); await click(text.start); expect(document.body.textContent).toContain(text.mismatch); expect(f.statistics).toHaveBeenCalledOnce(); expect(document.body.querySelector('[aria-label="' + text.rowCount + '"]')).toBeNull(); });
it('卸载取消原任务，迟到成功不发布，活动计数仍准确收尾', async () => { const delayed = deferred<TableStatisticsOutput>(), f = await mount({ statistics: () => delayed.promise }); await click(text.start); await act(async () => { root!.unmount(); root = undefined; }); expect(f.cancel).toHaveBeenCalledOnce(); await act(async () => { delayed.resolve(f.output(f.statistics.mock.calls[0][0])); }); expect(f.activity.mock.calls).toEqual([[1], [-1]]); expect(f.close).not.toHaveBeenCalled(); });
it('CtrlEnter/CtrlS截获且不隐式开始，正式adapter仅statistics/cancel受限IPC', async () => {
  const f = await mount(); for (const key of ['Enter', 's']) { const event = new MemoryEvent('keydown'); Object.assign(event, { key, ctrlKey: true, stopImmediatePropagation: () => event.stopPropagation() }); await act(async () => { document.dispatchEvent(event); }); expect(event.defaultPrevented).toBe(true); } expect(f.statistics).not.toHaveBeenCalled(); const invoke = vi.fn(async () => undefined); (window as any).dbark = { invoke }; const input: TableStatisticsInput = { ...f.base, taskId: 'formal-task', columns: [], filters: [] }; await official.statistics(input); await official.cancel(input.taskId); expect(invoke.mock.calls).toEqual([['table.statistics', input], ['query.cancel', { taskId: input.taskId }]]);
});
