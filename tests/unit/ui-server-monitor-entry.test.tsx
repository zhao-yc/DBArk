import { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkConnectionProfile as ConnectionProfile } from '../../src/shared/contracts';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { monitorDeferred, monitorSnapshot } from '../fixtures/server-monitor';
import { serverMonitorZhCN as t } from '../../src/renderer/serverMonitorZh';

const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot>;
let Entry: typeof import('../../src/renderer/components/ServerMonitorEntry')['ServerMonitorEntry'], workspace: typeof import('../../src/renderer/store')['useWorkspace'];
let request: ReturnType<typeof vi.fn>, closed: ReturnType<typeof vi.fn>, profiles: ConnectionProfile[], versions: Record<string, number>;
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  // 本文件私有DOM补齐React受控select所需的浏览器接口，不替换实际选择组件或服务。
  document.createElement = name => {
    const node = create(name);
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') {
      Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as typeof option & { selected?: boolean }).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as typeof option & { selected?: boolean }).selected = option.value === value; } });
    }
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ ServerMonitorEntry: Entry } = await import('../../src/renderer/components/ServerMonitorEntry')); ({ useWorkspace: workspace } = await import('../../src/renderer/store'));
});
beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true, writable: true });
  profiles = [{ id: 'a', name: 'RAM连接A', group: '', color: '', dialect: 'mysql', host: 'never-connect.invalid', port: 1, user: 'RAM用户' }]; versions = {};
  workspace.setState({ connections: profiles, connectionVersions: versions }); request = vi.fn().mockResolvedValue(monitorSnapshot()); closed = vi.fn(); Object.defineProperty(window, 'dbark', { configurable: true, value: { invoke: request } });
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.textContent = ''; workspace.setState({ connections: [], connectionVersions: {} }); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 实际选择入口与实际监控组件一起渲染，只替换preload IPC，未启动桌面或数据库。 */
async function render(open = true) { await act(async () => root.render(<Entry open={open} connections={profiles} versions={versions} onClose={closed}/>)); }
async function click(label: string) { const button = document.querySelectorAll('button').find(item => item.textContent === label); expect(button).toBeDefined(); await act(async () => { button!.dispatchEvent(new MemoryEvent('click')); }); }

describe('服务器监控应用选择入口（真实React/RAM）', () => {
  it('关闭时零读取，先选择已有连接再经typed IPC打开正式快照', async () => {
    await render(false); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(request).not.toHaveBeenCalled();
    await render(); expect(document.body.textContent).toContain('RAM连接A'); expect(request).not.toHaveBeenCalled(); await click(t.open);
    expect(request).toHaveBeenCalledOnce(); expect(request.mock.calls[0][0]).toBe('serverMonitor.read'); expect(request.mock.calls[0][1]).toMatchObject({ connectionId: 'a', sessionLimit: 50 }); expect(document.body.textContent).toContain(t.summary); await click(t.close); expect(closed).toHaveBeenCalledOnce();
  });
  it('没有连接时显示可理解提示，不发任何读取或建连', async () => {
    profiles = []; workspace.setState({ connections: profiles }); await render(); expect(document.body.textContent).toContain(t.noConnections); expect(request).not.toHaveBeenCalled(); await click(t.close); expect(closed).toHaveBeenCalledOnce();
  });
  it('store目标已替换而React尚未重渲染时，旧成功快照仍被实时门拒绝', async () => {
    const pending = monitorDeferred<ReturnType<typeof monitorSnapshot>>(), snapshot = monitorSnapshot(); request.mockReturnValueOnce(pending.promise); await render(); await click(t.open);
    workspace.setState({ connections: [{ ...profiles[0], host: 'changed.invalid' }] });
    await act(async () => { pending.resolve(snapshot); await pending.promise; });
    expect(document.body.textContent).toContain(t.readFailed); expect(document.body.textContent).not.toContain(snapshot.summary.status === 'available' ? snapshot.summary.value.hostname : '不可出现主机'); expect(request).toHaveBeenCalledOnce(); await click(t.close);
  });
  it('同对象修订变化也拒绝旧包，新代必须等原读取后才可开始', async () => {
    const pending = monitorDeferred<ReturnType<typeof monitorSnapshot>>(); request.mockReturnValueOnce(pending.promise); await render(); await click(t.open);
    versions = { a: 1 }; workspace.setState({ connectionVersions: versions }); await render(); expect(request.mock.calls.filter(call => call[0] === 'serverMonitor.read')).toHaveLength(1);
    await act(async () => { pending.resolve(monitorSnapshot()); await pending.promise; });
    // 原轮的取消控制只绑定其taskId；第二轮在原read和取消控制落定后才发送。
    await vi.waitFor(() => expect(request.mock.calls.filter(call => call[0] === 'serverMonitor.read')).toHaveLength(2));
    expect(request.mock.calls.filter(call => call[0] === 'query.cancel')).toHaveLength(1); await click(t.close);
  });
});
