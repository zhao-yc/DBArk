import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { csvExportZh } from '../../src/renderer/locales/csvExport.zh-CN';
import { ResultExportSelection } from '../../src/renderer/resultExport';
import type { QueryResult } from '../../src/shared/contracts';
const calls = vi.hoisted(() => ({ invoke: vi.fn(async (_command: string, _input?: any): Promise<any> => undefined) }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<typeof import('../../src/renderer/lib')>(), invoke: calls.invoke }));
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: () => null }));
vi.mock('../../src/renderer/components/ConnectedExcelTransferDialog', () => ({ ConnectedExcelTransferDialog: () => null }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined, Transfer: typeof import('../../src/renderer/components/TransferDialog')['TransferDialog'], Result: typeof import('../../src/renderer/components/ResultExportDialog')['ResultExportDialog'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'];
type Kind = 'table' | 'result';
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout }); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    // 只反射标准DOM属性，不复制产品选择/预览/执行逻辑。
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); node.type = 'text'; }
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TransferDialog: Transfer } = await import('../../src/renderer/components/TransferDialog')); ({ ResultExportDialog: Result } = await import('../../src/renderer/components/ResultExportDialog')); ({ useWorkspace } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
/** 真实勾选快照先去除隐藏列与未选行，组件只接收原投影合同。 */
function selectedResult() {
  const value: QueryResult = { columns: [{ key: 'id', name: 'id', type: 'bigint' }, { key: 'raw', name: 'raw', type: 'blob' }, { key: 'hidden', name: '隐藏', type: 'text' }], rows: [{ id: '未选', raw: '', hidden: '不可写出' }, { id: '9007199254740993', raw: { type: 'binary', base64: 'AAH/' }, hidden: '不可写出' }], statement: '原查询不得执行或传递', elapsedMs: 0, truncated: true };
  const owner = new ResultExportSelection(), binding = owner.bind(value, ['已返回'], value.columns.slice(0, 2))!; owner.select(binding, { scope: binding, columns: binding.visibleColumns, rows: value.rows, indices: new Set([1]) }); return owner.snapshot(binding);
}
/** 只有IPC为RAM端口；两个正式React表单、事件、字段目录和快照逻辑均运行。 */
async function mount(kind: Kind, choice?: () => Promise<any>) {
  let sequence = 0;
  calls.invoke.mockReset().mockImplementation(async (command, input) => {
    if (command === 'files.exportColumns') return { target: { connectionId: 'c', database: 'db', table: 't' }, catalogId: 'catalog', expiresAt: new Date(Date.now() + 120000).toISOString(), columns: [{ name: 'id', type: 'bigint' }, { name: 'raw', type: 'blob' }] };
    if (command === 'files.choose') return choice ? choice() : { token: 'file-' + ++sequence, name: 'result.' + input.format };
    if (command === 'files.export' || command === 'files.exportResult') return { rows: 1 };
  });
  useWorkspace.setState({ connectionVersions: { c: 1 }, tasks: [], activeJobs: {} }); const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  await act(async () => root!.render(kind === 'table' ? <Transfer mode="export" connectionId="c" database="db" table="t" onClose={vi.fn()}/> : <Result result={selectedResult()} tabId="q" selected onClose={vi.fn()}/>));
}
async function change(node: ReturnType<typeof document.createElement>, value: string) { await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
async function click(node: ReturnType<typeof document.createElement>) { expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
function delimiter() { return document.querySelector(`select[aria-label="${csvExportZh.label}"]`)!; }
function execute() { return document.querySelectorAll('button').find(node => node.getAttribute('class') === 'primary')!; }
async function choose() { await click(document.querySelectorAll('button').find(node => node.getAttribute('class') === 'file-picker')!); }
function exports(kind: Kind) { return calls.invoke.mock.calls.filter(([name]) => name === (kind === 'table' ? 'files.export' : 'files.exportResult')); }
/** 保存真实React回调以模拟已排队的旧事件；不另写执行门槛。 */
function queuedClick(node: object): () => void { const key = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件属性'); return (node as any)[key].onClick; }

describe.each(['table', 'result'] as const)('%s真实CSV导出表单', kind => {
  it.each([';', '\t'])('分隔符%s失效文件选择并进入最终请求，列/勾选范围保持', async separator => {
    await mount(kind); expect(delimiter().value).toBe(','); expect(delimiter().querySelectorAll('option').map(node => node.value)).toEqual([',', ';', '\t']);
    if (kind === 'table') { const raw = document.querySelectorAll('input[type="checkbox"]').find(node => node.parentNode?.textContent.startsWith('raw ·'))!; await act(async () => { raw.checked = false; raw.dispatchEvent(new MemoryEvent('click')); }); }
    await choose(); await change(delimiter(), separator); expect(execute().disabled).toBe(true); await choose(); await click(execute());
    const sent = exports(kind); expect(sent).toHaveLength(1); expect(sent[0][1]).toMatchObject({ format: 'csv', csvDelimiter: separator, fileToken: 'file-2' });
    if (kind === 'table') { expect(sent[0][1].csvSelection).toEqual({ catalogId: 'catalog', columns: ['id'] }); expect(calls.invoke.mock.calls.filter(([name]) => name === 'files.exportColumns')).toHaveLength(1); }
    else { expect(sent[0][1].result).toEqual({ columns: [{ key: 'id', name: 'id' }, { key: 'raw', name: 'raw' }], rows: [{ id: '9007199254740993', raw: { type: 'binary', base64: 'AAH/' } }], truncated: true }); expect(sent[0][1]).not.toHaveProperty('statement'); }
  });
  it('逗号→分号→逗号不能接纳迟到选择，即使配置原值恢复', async () => {
    const held = deferred<any>(); await mount(kind, () => held.promise); await choose(); await change(delimiter(), ';'); await change(delimiter(), ',');
    await act(async () => { held.resolve({ token: '迟到文件', name: 'old.csv' }); }); expect(execute().disabled).toBe(true); expect(exports(kind)).toHaveLength(0);
  });
  it('已排队旧执行在分隔符ABA和新选文件后仍不可用，新回调才可执行', async () => {
    await mount(kind); await choose(); const old = queuedClick(execute()); await change(delimiter(), ';'); await change(delimiter(), ','); await choose();
    await act(async () => old()); expect(exports(kind)).toHaveLength(0); await click(execute()); expect(exports(kind)).toHaveLength(1); expect(exports(kind)[0][1].fileToken).toBe('file-2'); expect(exports(kind)[0][1]).not.toHaveProperty('csvDelimiter');
  });
  it('非CSV隐藏选择器且请求不夹带CSV配置', async () => {
    await mount(kind); await change(delimiter(), ';'); await change(document.querySelectorAll('select')[0], 'json'); expect(document.querySelector(`select[aria-label="${csvExportZh.label}"]`)).toBeNull(); await choose(); await click(execute());
    expect(exports(kind)[0][1]).toMatchObject({ format: 'json' }); expect(exports(kind)[0][1]).not.toHaveProperty('csvDelimiter');
  });
});
