import { act, type ComponentProps } from 'react';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ImportNewTableServices } from '../../src/renderer/importNewTableUi';
import { importNewTableZh as text } from '../../src/renderer/locales/importNewTable.zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

/** 子阶段只提供边界按钮；保留真实向导、Modal、受控输入、扫描调用和父子生命周期。 */
const childProbes = vi.hoisted(() => ({ schema: undefined as any, transfer: undefined as any }));
vi.mock('../../src/renderer/components/SchemaDialog', () => ({ SchemaDialog: (props: any) => { childProbes.schema = props; return <section data-schema="true"><p>{props.initialDesign.name}</p><button onClick={() => props.onCreated({ target: { connectionId: 'c', database: '库', table: '设计器改名' }, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, resourcesReleased: true, warnings: [] }, 5)}>建表完成回应</button><button onClick={props.onClose}>设计器释放完成关闭</button></section>; } }));
vi.mock('../../src/renderer/components/TransferDialog', () => ({ TransferDialog: (props: any) => { childProbes.transfer = props; return <section data-transfer="true"><p>{props.table}</p><p>{props.initialImport.expectedSource.sha256}</p><p>{props.initialImport.columns.join(',')}</p><button onClick={props.onClose}>关闭导入配置</button></section>; } }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let ImportNewTableDialog: typeof import('../../src/renderer/components/ImportNewTableDialog')['ImportNewTableDialog'];
let useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  // 仅补齐React受控select和disabled属性所需的内存端口，不宣称浏览器输入或布局验收。
  document.createElement = name => {
    const node = create(name);
    if (name === 'option') {
      let selected = false;
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', String(value)) });
      Object.defineProperty(node, 'selected', { get: () => selected, set: value => { selected = !!value; if (selected && node.parentNode?.tagName === 'SELECT') for (const option of node.parentNode.querySelectorAll('option')) if (option !== node) (option as any).selected = false; } });
    }
    if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  // 工作区在模块初始化时读取window，必须先建立本例原内存DOM，再加载真实向导与状态。
  ({ useWorkspace } = await import('../../src/renderer/store'));
  ({ ImportNewTableDialog } = await import('../../src/renderer/components/ImportNewTableDialog'));
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; useWorkspace.setState({ connectionVersions: {}, connections: [] }); vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function field(label: string) { const node = document.querySelector(`[aria-label="${label}"]`); expect(node).not.toBeNull(); return node!; }
function props(node: ReturnType<typeof field>): any { const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); expect(key).toBeDefined(); return (node as any)[key!]; }
function button(label: string) { const node = document.querySelectorAll('button').find(value => value.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
async function mount() {
  useWorkspace.setState({ connectionVersions: { c: 5 }, connections: [] });
  const services: ImportNewTableServices = { choose: vi.fn().mockResolvedValue({ token: randomUUID(), name: '完整源.csv' }), inspect: vi.fn().mockResolvedValue({ columns: ['原字段', '第21行才出现'], rows: [{ 原字段: '保留精确原文' }], records: 21, source: { sha256: 'a'.repeat(64), bytes: 1024 }, sampleOmitted: true }), cancel: vi.fn().mockResolvedValue(undefined), uid: randomUUID };
  const onClose = vi.fn(), onCreated = vi.fn(), onDirtyChange = vi.fn(), host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  let current: ComponentProps<typeof ImportNewTableDialog> = { connectionId: 'c', database: '库', services, onClose, onCreated, onDirtyChange };
  await act(async () => root!.render(<ImportNewTableDialog {...current}/>));
  return { services, onClose, onCreated, onDirtyChange, async update(patch: Partial<typeof current>) { current = { ...current, ...patch }; await act(async () => root!.render(<ImportNewTableDialog {...current}/>)); } };
}
async function enterDesign() { await click(text.choose); await act(async () => props(field(text.table)).onChange({ target: { value: '待审表' } })); await act(async () => props(field(text.reviewed)).onChange({ target: { checked: true } })); await click(text.design); }

describe('文件到新表真实React向导', () => {
  it('有限样本不漏全文件源列，表名必须人工输入核对才进入正式设计器', async () => {
    const f = await mount(); expect(button(text.design).disabled).toBe(true); expect(f.onDirtyChange).toHaveBeenLastCalledWith(false);
    await click(text.choose); expect(document.body.textContent).toContain(text.records(21)); expect(document.body.textContent).toContain('第21行才出现'); expect(document.body.textContent).toContain(text.ddl); expect(document.body.textContent).toContain(text.types); expect(button(text.design).disabled).toBe(true);
    await act(async () => props(field(text.table)).onChange({ target: { value: '待审表' } })); expect(button(text.design).disabled).toBe(true); await act(async () => props(field(text.reviewed)).onChange({ target: { checked: true } })); await click(text.design);
    expect(document.querySelector('[data-schema="true"]')).not.toBeNull(); expect(f.onCreated).not.toHaveBeenCalled(); expect(f.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it('准确建表ACK不卸载设计器，原释放关闭后还需显式继续，导入目标使用真实改名', async () => {
    const f = await mount(); await enterDesign(); await click('建表完成回应'); expect(f.onCreated).toHaveBeenCalledTimes(1); expect(document.querySelector('[data-schema="true"]')).not.toBeNull(); expect(document.querySelector('[data-transfer="true"]')).toBeNull();
    await click('设计器释放完成关闭'); expect(document.querySelector('[data-schema="true"]')).toBeNull(); expect(document.body.textContent).toContain(text.created); expect(f.onClose).not.toHaveBeenCalled(); expect(document.querySelector('[data-transfer="true"]')).toBeNull();
    await click(text.continue); expect(document.querySelector('[data-transfer="true"]')).not.toBeNull(); expect(document.body.textContent).toContain('设计器改名'); expect(document.body.textContent).toContain('第21行才出现'); expect(document.body.textContent).toContain('a'.repeat(64)); expect(f.services.inspect).toHaveBeenCalledTimes(1);
    await click('关闭导入配置'); expect(f.onClose).toHaveBeenCalledTimes(1);
  });
  it('旧DOM扫描闭包及连接修订ABA不能派新请求；失效设计器仍能在原资源关闭后退出', async () => {
    const f = await mount(), oldChoose = props(button(text.choose)).onClick;
    await act(async () => props(field(text.format)).onChange({ target: { value: 'json' } })); await act(async () => oldChoose()); expect(f.services.choose).not.toHaveBeenCalled();
    await enterDesign(); await act(async () => { useWorkspace.setState({ connectionVersions: { c: 6 } }); useWorkspace.setState({ connectionVersions: { c: 5 } }); });
    await click('建表完成回应'); expect(f.onCreated).not.toHaveBeenCalled(); await click('设计器释放完成关闭'); expect(f.onClose).toHaveBeenCalledTimes(1); expect(document.querySelector('[data-transfer="true"]')).toBeNull();
  });
  it('父目标/服务/连接对象ABA通过稳定守卫撤销Schema和Transfer，仍保留原子页等待释放', async () => {
    for (const stage of ['design', 'import']) for (const change of ['target', 'services', 'connection']) {
      const f = await mount(); await enterDesign();
      if (stage === 'import') { await click('建表完成回应'); await click('设计器释放完成关闭'); await click(text.continue); }
      const before = stage === 'design' ? childProbes.schema : childProbes.transfer, guard = before.isParentCurrent;
      expect(guard()).toBe(true); const refreshes = f.onCreated.mock.calls.length;
      if (change === 'target') { await f.update({ database: '其它库' }); await f.update({ database: '库' }); }
      else if (change === 'services') { await f.update({ services: { ...f.services } }); await f.update({ services: f.services }); }
      else await act(async () => { useWorkspace.setState({ connections: [{ id: 'c' } as any] }); useWorkspace.setState({ connections: [] }); });
      const after = stage === 'design' ? childProbes.schema : childProbes.transfer;
      expect(after.isParentCurrent).toBe(guard); expect(guard()).toBe(false); expect(after.invalidated).toBe(true);
      expect(document.querySelector(stage === 'design' ? '[data-schema="true"]' : '[data-transfer="true"]')).not.toBeNull(); expect(f.onClose).not.toHaveBeenCalled(); expect(f.onCreated).toHaveBeenCalledTimes(refreshes);
      await click(stage === 'design' ? '设计器释放完成关闭' : '关闭导入配置'); expect(f.onClose).toHaveBeenCalledTimes(1);
      await act(async () => root!.unmount()); root = undefined; document.body.textContent = '';
    }
  });
});
