import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { SqlFileImportReceipt } from '../../src/shared/sqlFileImport';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

const port = vi.hoisted(() => ({ invoke: vi.fn<(command: string, input: any) => Promise<any>>() }));
// 仅替换表格和Excel端口，实际TransferDialog、预览控制器、Store与事件保持运行。
vi.mock('../../src/renderer/lib', async original => ({ ...await original<typeof import('../../src/renderer/lib')>(), invoke: port.invoke }));
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: () => <div role="grid"/> }));
vi.mock('../../src/renderer/components/ConnectedExcelTransferDialog', () => ({ ConnectedExcelTransferDialog: () => null }));
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/TransferDialog')['TransferDialog'], store: typeof import('../../src/renderer/store')['useWorkspace'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  doc = memoryDocument(); (doc as any).oninput = null;
  Object.assign(window, { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) });
  const create = doc.createElement.bind(doc);
  doc.createElement = name => {
    const node = create(name);
    if (name === 'option') { Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) }); let selected = false; Object.defineProperty(node, 'selected', { get: () => selected, set: value => { selected = !!value; if (selected && node.parentNode?.tagName === 'SELECT') for (const other of node.parentNode.querySelectorAll('option')) if (other !== node) Reflect.set(other, 'selected', false); } }); }
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => Reflect.get(option, 'selected'))?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) Reflect.set(option, 'selected', option.value === value); } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TransferDialog: Dialog } = await import('../../src/renderer/components/TransferDialog')); ({ useWorkspace: store } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; port.invoke.mockReset(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function receipt(input: any, patch: Partial<SqlFileImportReceipt> = {}): SqlFileImportReceipt { return { version: 1, taskId: input.taskId, encoding: input.encoding, positionBasis: 'decoded-utf16', termination: 'completed', completedStatements: 3, serverReportedAffectedRows: 7, rollback: { state: 'not-needed' }, transaction: 'closed', ...patch }; }
async function mount(options: { mode?: 'import' | 'export'; execute?: (input: any) => Promise<any> } = {}) {
  if (root) await act(async () => root!.unmount()); doc.body.textContent = '';
  port.invoke.mockReset().mockImplementation(async (command, input) => {
    if (command === 'files.choose') return { token: '原文件令牌', name: '原文件.sql' };
    if (command === 'files.import' || command === 'files.export') return options.execute ? options.execute(input) : { rows: 99, errors: [] };
    if (command === 'metadata.table') return { database: 'db', name: 't', engine: 'InnoDB', columns: [{ name: 'id', type: 'text', nullable: true, generated: false }], indexes: [], foreignKeys: [], primaryKey: [], editableKey: [], ddl: '' };
    if (command === 'files.preview') return { columns: ['id'], rows: [{ id: '1' }] };
    if (command === 'files.importPresets.list') return { generation: '本轮', revision: 0, entries: [] };
    if (command === 'files.exportColumns') return { target: { connectionId: 'c', database: 'db', table: 't' }, catalogId: 'catalog', expiresAt: new Date(Date.now() + 120000).toISOString(), columns: [{ name: 'id', type: 'text' }] };
    if (['connections.open', 'files.releaseExportColumns', 'query.cancel'].includes(command)) return;
    throw Error('未授权测试端口：' + command);
  });
  store.setState({ connectionVersions: { c: 1 }, tasks: [] }); const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element);
  const render = async (database = 'db', table = 't') => { await act(async () => root!.render(<Dialog mode={options.mode ?? 'import'} connectionId="c" database={database} table={table} onClose={() => {}}/>)); };
  await render(); return { render };
}
async function click(node: MemoryNode) { expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function selectFormat(value: string) { const node = doc.querySelectorAll('select')[0]; expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
function start() { return doc.querySelectorAll('button').find(node => node.getAttribute('class') === 'primary')!; }
async function chooseAndRun(format = 'sql') { await selectFormat(format); await click(doc.querySelectorAll('button').find(node => node.getAttribute('class') === 'file-picker')!); await click(start()); }
function result() { return doc.querySelectorAll('[role="status"]').find(node => node.getAttribute('aria-label') === 'SQL 文件执行结果') ?? null; }

it('SQL缺少结构化回执时明确不可确认，不能用兼容rows伪装导入成功', async () => {
  await mount(); await chooseAndRun(); expect(doc.body.textContent).toContain('SQL 执行结果未确认'); expect(doc.body.textContent).not.toContain('已导入 99 行'); expect(doc.querySelector('[class="success-box"]')).toBeNull();
});
it('SQL完成使用真实语句和影响计数，明确不是已保留或提交行数', async () => {
  await mount({ execute: async input => ({ rows: 999, errors: [], sql: receipt(input) }) }); await chooseAndRun();
  expect(result()).not.toBeNull(); expect(result()!.textContent).toContain('脚本已完成'); expect(result()!.textContent).toContain('完整完成语句数：3'); expect(result()!.textContent).toContain('服务器累计影响行数：7'); expect(result()!.textContent).toContain('不是保留或提交行数'); expect(result()!.textContent).not.toContain('999');
});
it('失败显示真实phase/ordinal/解码行列，未知计数和回滚未确认不伪称回滚', async () => {
  await mount({ execute: async input => ({ rows: 88, errors: ['旧兼容文案'], sql: receipt(input, { termination: 'failed', serverReportedAffectedRows: null, failure: { phase: 'execute', message: '<img src=x>服务器原错误', statement: { ordinal: 4, location: { start: { offset: 19, line: 4, column: 2 }, end: { offset: 40, line: 6, column: 8 } } } }, rollback: { state: 'unconfirmed', message: '断线，未收到回滚确认' }, transaction: 'unknown' }) }) });
  await chooseAndRun(); expect(result()!.textContent).toContain('脚本执行失败'); expect(result()!.textContent).toContain('第 4 条语句'); expect(result()!.textContent).toContain('第 4 行，第 2 列'); expect(result()!.textContent).toContain('第 6 行，第 8 列'); expect(result()!.textContent).toContain('影响行数：未知'); expect(result()!.textContent).toContain('回滚未确认'); expect(result()!.textContent).toContain('事务状态未知'); expect(result()!.textContent).toContain('<img src=x>服务器原错误'); expect(doc.querySelectorAll('img')).toHaveLength(0); expect(result()!.textContent).not.toContain('已回滚');
});
it('cancelled正常回包正确显示取消、已确认回滚与关闭事务，不误作成功', async () => {
  await mount({ execute: async input => ({ rows: 0, errors: [], sql: receipt(input, { termination: 'cancelled', completedStatements: 1, serverReportedAffectedRows: 1, failure: { phase: 'execute', message: '用户取消', statement: { ordinal: 2 } }, rollback: { state: 'confirmed' }, transaction: 'closed' }) }) }); await chooseAndRun(); expect(result()!.textContent).toContain('脚本已取消'); expect(result()!.textContent).toContain('已确认回滚'); expect(result()!.textContent).toContain('事务已关闭'); expect(doc.querySelector('[class="success-box"]')).toBeNull();
});
it('坏回执、错误task或encoding不能借兼容成功字段发布', async () => {
  for (const patch of [{ taskId: '其他任务' }, { encoding: 'utf16le' as const }, { transaction: '伪状态' as any }]) {
    await mount({ execute: async input => ({ rows: 99, errors: [], sql: receipt(input, patch) }) }); await chooseAndRun(); expect(doc.body.textContent).toContain('SQL 执行结果未确认'); expect(doc.querySelector('[class="success-box"]')).toBeNull();
  }
});
it('连接版本ABA同步撤销旧SQL成功回包，旧任务不得覆盖新来源', async () => {
  const held = deferred<any>(); let input: any; await mount({ execute: async value => { input = value; return held.promise; } }); await chooseAndRun();
  await act(async () => { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); }); expect(doc.querySelectorAll('button').find(node => node.getAttribute('class') === 'file-picker')!.disabled).toBe(true);
  await act(async () => held.resolve({ rows: 99, errors: [], sql: receipt(input) })); expect(result()).toBeNull(); expect(doc.querySelector('[class="success-box"]')).toBeNull(); expect(doc.body.textContent).not.toContain('已导入 99 行');
});
it('换目标后恢复同值仍不接受旧SQL错误回包，导出迟错同样不能污染新来源', async () => {
  for (const mode of ['import', 'export'] as const) {
    const held = deferred<any>(), f = await mount({ mode, execute: async () => held.promise }); await chooseAndRun(); await f.render('other'); await f.render(); await act(async () => held.reject(Error('旧来源不应出现的错误'))); expect(doc.body.textContent).not.toContain('旧来源不应出现的错误'); expect(result()).toBeNull();
  }
});
it('组件卸载后的旧SQL回执不覆盖后来新实例', async () => {
  const held = deferred<any>(); let input: any; await mount({ execute: async value => { input = value; return held.promise; } }); await chooseAndRun(); await mount(); await act(async () => held.resolve({ rows: 99, errors: [], sql: receipt(input) })); expect(result()).toBeNull(); expect(doc.querySelector('[class="success-box"]')).toBeNull();
});
it('CSV继续展示原导入行数，不要求或推断SQL回执', async () => {
  await mount({ execute: async () => ({ rows: 9, errors: [] }) }); await chooseAndRun('csv'); expect(doc.body.textContent).toContain('9'); expect(doc.querySelector('[class="success-box"]')).not.toBeNull(); expect(result()).toBeNull();
});
it('执行完成但有收尾警告时明确展示，不以普通绿色成功盒掩盖', async () => {
  await mount({ execute: async input => ({ rows: 9, errors: [], sql: receipt(input, { cleanupWarning: '原连接收尾失败，请核对资源' }) }) }); await chooseAndRun(); expect(result()!.textContent).toContain('脚本已完成'); expect(result()!.textContent).toContain('执行后收尾警告'); expect(result()!.textContent).toContain('原连接收尾失败，请核对资源'); expect(doc.querySelector('[class="success-box"]')).toBeNull();
});
it('解析阶段只展示原失败阶段，无语句范围时不虚构下一条或文件位置，打开事务单独提示', async () => {
  await mount({ execute: async input => ({ rows: 123, errors: [], sql: receipt(input, { termination: 'failed', completedStatements: 2, serverReportedAffectedRows: null, failure: { phase: 'parse', message: '字符串未闭合' }, rollback: { state: 'unconfirmed' }, transaction: 'open' }) }) }); await chooseAndRun(); expect(result()!.textContent).toContain('解析脚本'); expect(result()!.textContent).toContain('未取得可确认的原文件位置'); expect(result()!.textContent).toContain('事务仍打开'); expect(result()!.textContent).not.toContain('第 3 条语句'); expect(result()!.textContent).not.toContain('123');
});
it('实际取消点击投递原task，取消等待或失败及来源ABA都不能提前释放原导入busy', async () => {
  const importing = deferred<any>(), cancelling = deferred<void>(); let originalInput: any;
  await mount({ execute: async input => { originalInput = input; return importing.promise; } });
  const original = port.invoke.getMockImplementation()!;
  port.invoke.mockImplementation((command, input) => command === 'query.cancel' ? cancelling.promise : original(command, input));
  await chooseAndRun(); await click(doc.querySelectorAll('button').find(node => node.textContent === '取消任务')!);
  expect(port.invoke.mock.calls.filter(([command]) => command === 'query.cancel').map(([, input]) => input)).toEqual([{ taskId: originalInput.taskId }]);
  await act(async () => { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); });
  const picker = () => doc.querySelectorAll('button').find(node => node.getAttribute('class') === 'file-picker')!;
  expect(picker().disabled).toBe(true); expect(port.invoke.mock.calls.filter(([command]) => command === 'files.import')).toHaveLength(1);
  await act(async () => cancelling.reject(Error('旧取消RPC失败不应污染新来源')));
  expect(picker().disabled).toBe(true); expect(doc.body.textContent).not.toContain('旧取消RPC失败不应污染新来源'); expect(result()).toBeNull();
  await act(async () => importing.resolve({ rows: 0, errors: [], sql: receipt(originalInput, { termination: 'cancelled', completedStatements: 0, serverReportedAffectedRows: 0, failure: { phase: 'execute', message: '已取消', statement: { ordinal: 1 } }, rollback: { state: 'confirmed' }, transaction: 'closed' }) }));
  expect(picker().disabled).toBe(false); expect(result()).toBeNull(); expect(port.invoke.mock.calls.filter(([command]) => command === 'files.import')).toHaveLength(1);
});
it('原导入结束后旧cancel迟错不能覆盖新任务，原cancel仍只属于旧task', async () => {
  const first = deferred<any>(), second = deferred<any>(), cancelling = deferred<void>(), inputs: any[] = [];
  await mount({ execute: async input => { inputs.push(input); return inputs.length === 1 ? first.promise : second.promise; } });
  const original = port.invoke.getMockImplementation()!;
  port.invoke.mockImplementation((command, input) => command === 'query.cancel' ? cancelling.promise : original(command, input));
  await chooseAndRun(); await click(doc.querySelectorAll('button').find(node => node.textContent === '取消任务')!);
  await act(async () => { store.setState({ connectionVersions: { c: 2 } }); store.setState({ connectionVersions: { c: 1 } }); });
  expect(doc.querySelectorAll('button').find(node => node.getAttribute('class') === 'file-picker')!.disabled).toBe(true);
  await act(async () => first.resolve({ rows: 7, errors: [], sql: receipt(inputs[0]) }));
  await chooseAndRun(); expect(inputs).toHaveLength(2); expect(inputs[1].taskId).not.toBe(inputs[0].taskId);
  await act(async () => cancelling.reject(Error('旧取消迟错不得覆盖新任务')));
  expect(doc.body.textContent).not.toContain('旧取消迟错不得覆盖新任务'); expect(doc.querySelectorAll('button').find(node => node.getAttribute('class') === 'file-picker')!.disabled).toBe(true);
  expect(port.invoke.mock.calls.filter(([command]) => command === 'query.cancel').map(([, input]) => input)).toEqual([{ taskId: inputs[0].taskId }]);
  await act(async () => second.resolve({ rows: 0, errors: [], sql: receipt(inputs[1], { completedStatements: 1, serverReportedAffectedRows: 2 }) }));
  expect(result()!.textContent).toContain('脚本已完成'); expect(result()!.textContent).toContain('完整完成语句数：1'); expect(result()!.textContent).not.toContain('旧取消迟错');
});
it('JSON沿用原导入行数，忽略不属于本格式的sql字段且不发布SQL终态', async () => {
  await mount({ execute: async input => ({ rows: 9, errors: [], sql: receipt(input, { termination: 'failed', failure: { phase: 'parse', message: '不属于JSON的SQL错误' } }) }) });
  await chooseAndRun('json'); expect(doc.body.textContent).toContain('9'); expect(doc.querySelector('[class="success-box"]')).not.toBeNull(); expect(result()).toBeNull(); expect(doc.body.textContent).not.toContain('不属于JSON的SQL错误');
});
