import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { zh } from '../../src/renderer/locales/zh-CN';
const calls = vi.hoisted(() => ({ invoke: vi.fn(async (_command: string, _input?: any): Promise<any> => undefined) }));
vi.mock('../../src/renderer/lib', async original => ({ ...await original<typeof import('../../src/renderer/lib')>(), invoke: calls.invoke }));
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: () => null }));
vi.mock('../../src/renderer/components/ConnectedExcelTransferDialog', () => ({ ConnectedExcelTransferDialog: () => null }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined, TransferDialog: typeof import('../../src/renderer/components/TransferDialog')['TransferDialog'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'];
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout }); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    // 内存 DOM 只反射选项、value 与 disabled；表单和预览全部使用真实组件。
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TransferDialog } = await import('../../src/renderer/components/TransferDialog')); ({ useWorkspace } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 控制 IPC 回包时序，不使用真实窗口、数据库或计时等待。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const sample = { columns: ['id', '内容'], rows: [{ id: '1', 内容: '手工样本' }] };
/** 只替换 IPC，挂载真实 TransferDialog 并通过 DOM 事件交互。 */
async function mount(mode: 'import' | 'export' = 'import', preview = (_input: any): Promise<any> => Promise.resolve(sample)) {
  calls.invoke.mockReset().mockImplementation(async (command, input) => {
    if (command === 'metadata.table') return { database: 'db', name: 't', engine: 'InnoDB', columns: ['id', '内容'].map(name => ({ name, type: 'text', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' })), indexes: [], foreignKeys: [], primaryKey: [], editableKey: [], ddl: '' };
    if (command === 'files.preview') return preview(input);
    if (command === 'files.choose') return { token: 'file', name: 't.' + input.format };
    if (command === 'files.import') return { rows: 1, errors: [] };
    if (command === 'files.exportColumns') return { target: { connectionId: 'c', database: 'db', table: 't' }, catalogId: 'catalog', expiresAt: new Date(Date.now() + 120000).toISOString(), columns: [{ name: 'id', type: 'text' }] };
  });
  useWorkspace.setState({ connectionVersions: { c: 1 }, tasks: [] }); const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  await act(async () => root!.render(<TransferDialog mode={mode} connectionId="c" database="db" table="t" onClose={vi.fn()}/>));
}
/** 事件走 React 委派，避免调用内部回调而绕过执行门槛。 */
async function change(node: ReturnType<typeof document.createElement>, value: string) { await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
async function click(node: ReturnType<typeof document.createElement>) { expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
function button(label: string) { const node = document.querySelectorAll('button').find(value => value.textContent === label); if (!node) throw Error('缺少按钮：' + label); return node; }
async function choose() { await click(document.querySelectorAll('button').find(node => node.getAttribute('class') === 'file-picker')!); }
function delimiter() { return document.querySelector(`select[aria-label="${zh.transfer.csvDelimiter}"]`); }

describe('真实 CSV 导入分隔符表单（内存 ReactDOM）', () => {
  it('逗号默认，变更分号立即失效旧预览和人工映射；当前预览就绪后执行同一参数', async () => {
    const pending = deferred<typeof sample>(); await mount('import', input => input.csvDelimiter === ';' ? pending.promise : Promise.resolve(sample));
    expect(delimiter()!.value).toBe(',');
    expect(delimiter()!.querySelectorAll('option').map(node => node.value)).toEqual([',', ';', '\t']);
    await choose(); expect(calls.invoke.mock.calls.find(([command]) => command === 'files.preview')![1]).toEqual({ fileToken: 'file', format: 'csv', encoding: 'utf8', csvDelimiter: ',' });
    await change(document.querySelector('select[aria-label="映射字段 内容"]')!, 'id');
    await change(delimiter()!, ';'); expect(button(zh.transfer.text028).disabled).toBe(true);
    expect(document.querySelector('select[aria-label="映射字段 内容"]')).toBeNull();
    expect(calls.invoke.mock.calls.filter(([command]) => command === 'files.import')).toHaveLength(0);
    expect(calls.invoke.mock.calls.filter(([command]) => command === 'files.preview').at(-1)![1]).toMatchObject({ fileToken: 'file', csvDelimiter: ';' });
    await act(async () => { pending.resolve(sample); });
    expect(document.querySelector('select[aria-label="映射字段 内容"]')!.value).toBe('内容');
    await click(button(zh.transfer.text028));
    const imports = calls.invoke.mock.calls.filter(([command]) => command === 'files.import'); expect(imports).toHaveLength(1);
    expect(imports[0][1]).toMatchObject({ fileToken: 'file', format: 'csv', encoding: 'utf8', csvDelimiter: ';', mapping: { id: 'id', 内容: '内容' } });
  });
  it('Tab 进入预览和执行，执行期间配置不可变', async () => {
    await mount(); const pending = deferred<{ rows: number; errors: string[] }>(); const original = calls.invoke.getMockImplementation()!;
    calls.invoke.mockImplementation((command, input) => command === 'files.import' ? pending.promise : original(command, input));
    await change(delimiter()!, '\t'); await choose(); await click(button(zh.transfer.text028));
    expect(delimiter()!.disabled).toBe(true);
    for (const command of ['files.preview', 'files.import']) expect(calls.invoke.mock.calls.find(([name]) => name === command)![1]).toMatchObject({ csvDelimiter: '\t' });
    await act(async () => { pending.resolve({ rows: 1, errors: [] }); });
  });
  it('JSON/SQL 导入和导出均不展示分隔符，JSON 旧调用不携带 CSV 配置', async () => {
    await mount(); await change(delimiter()!, ';'); const format = document.querySelectorAll('select')[0]; await change(format, 'json');
    expect(delimiter()).toBeNull(); await choose(); await click(button(zh.transfer.text028));
    for (const command of ['files.preview', 'files.import']) expect(calls.invoke.mock.calls.find(([name]) => name === command)![1]).not.toHaveProperty('csvDelimiter');
    await change(format, 'sql'); expect(delimiter()).toBeNull();
    await act(async () => root!.unmount()); root = undefined; await mount('export'); expect(delimiter()).toBeNull();
  });
});
