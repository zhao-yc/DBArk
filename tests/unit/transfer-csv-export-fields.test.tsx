import { act } from 'react';
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
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); node.type = 'text'; }
    // 内存DOM只反射标准选项和disabled，不复制产品选择、顺序或执行逻辑。
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TransferDialog } = await import('../../src/renderer/components/TransferDialog')); ({ useWorkspace } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 真实TransferDialog和事件委派，只替换IPC边界，不加载浏览器或数据库。 */
async function mount() {
  calls.invoke.mockReset().mockImplementation(async (command, input) => {
    if (command === 'files.exportColumns') return { target: { connectionId: 'c', database: 'db', table: 't' }, catalogId: 'catalog', expiresAt: new Date(Date.now() + 120000).toISOString(), columns: [{ name: 'id', type: 'bigint' }, { name: 'price', type: 'decimal(30,6)' }, { name: 'raw', type: 'blob' }] };
    if (command === 'files.choose') return { token: 'file', name: 't.' + input.format };
    if (command === 'files.export') return { rows: 1 };
  });
  useWorkspace.setState({ connectionVersions: { c: 1 }, tasks: [] }); const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  await act(async () => root!.render(<TransferDialog mode="export" connectionId="c" database="db" table="t" onClose={vi.fn()}/>));
}
/** 点击和勾选只走真实DOM，不调用组件内部回调。 */
async function click(node: ReturnType<typeof document.createElement>, twice = false) { expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); if (twice) node.dispatchEvent(new MemoryEvent('click')); }); }
function button(label: string) { const value = document.querySelectorAll('button').find(node => node.textContent === label); if (!value) throw Error('缺少按钮：' + label); return value; }
async function choose() { await click(document.querySelectorAll('button').find(node => node.getAttribute('class') === 'file-picker')!); }
async function select(name: string, checked: boolean) { const node = document.querySelectorAll('input[type="checkbox"]').find(node => node.parentNode?.textContent.startsWith(name + ' ·'))!; await act(async () => { node.checked = checked; node.dispatchEvent(new MemoryEvent('click')); }); }
describe('真实表导出表单CSV选列（内存ReactDOM）', () => {
  it('真实勾选/重排预览到唯一导出请求，未选字段不进入投影', async () => {
    await mount(); await choose(); await select('price', false); await click(document.querySelector('button[aria-label="上移CSV字段 raw"]')!);
    expect(document.querySelector('ol[aria-label="CSV字段顺序预览"]')!.querySelectorAll('li').map(node => node.firstChild?.textContent)).toEqual(['raw', 'id']);
    await click(button(zh.transfer.text029), true); const exports = calls.invoke.mock.calls.filter(([command]) => command === 'files.export'); expect(exports).toHaveLength(1); expect(exports[0][1]).toMatchObject({ format: 'csv', fileToken: 'file', csvSelection: { catalogId: 'catalog', columns: ['raw', 'id'] } });
  });
  it('空选择和连接修订变化禁用导出，不能借旧目录或旧文件继续', async () => {
    await mount(); await choose(); for (const name of ['id', 'price', 'raw']) await select(name, false); expect(button(zh.transfer.text029).disabled).toBe(true);
    await act(async () => { useWorkspace.setState({ connectionVersions: { c: 2 } }); }); expect(button(zh.transfer.text029).disabled).toBe(true); expect(calls.invoke.mock.calls.filter(([command]) => command === 'files.export')).toHaveLength(0);
  });
  it('JSON格式仍沿原全列参数，不夹带CSV目录或选择', async () => {
    await mount(); const format = document.querySelectorAll('select')[0]; await act(async () => { format.value = 'json'; format.dispatchEvent(new MemoryEvent('change')); }); await choose(); await click(button(zh.transfer.text029));
    const input = calls.invoke.mock.calls.find(([command]) => command === 'files.export')![1]; expect(input.format).toBe('json'); expect(input).not.toHaveProperty('csvSelection');
  });
  it('从SQL结构导出切回CSV，隐藏的数据复选状态不能阻断CSV投影', async () => {
    await mount(); const format = document.querySelectorAll('select')[0]; await act(async () => { format.value = 'sql'; format.dispatchEvent(new MemoryEvent('change')); });
    const data = document.querySelectorAll('input[type="checkbox"]')[1]; await act(async () => { data.checked = false; data.dispatchEvent(new MemoryEvent('click')); });
    await act(async () => { format.value = 'csv'; format.dispatchEvent(new MemoryEvent('change')); }); await choose(); await click(button(zh.transfer.text029));
    expect(calls.invoke.mock.calls.find(([command]) => command === 'files.export')![1]).toMatchObject({ format: 'csv', includeData: true });
  });
});
