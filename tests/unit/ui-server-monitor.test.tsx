import { act, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { monitorDeferred as deferred, monitorSnapshot as snapshot } from '../fixtures/server-monitor';
import type { ServerMonitorDialogProps } from '../../src/renderer/components/ServerMonitorDialog';
import type { ServerMonitorSnapshot } from '../../src/shared/serverMonitor';
import { serverMonitorZhCN as t } from '../../src/renderer/serverMonitorZh';

// 使用真实ReactDOM、Modal和监控组件，只替换document/服务端口，不启动桌面或数据库。
const globals = ['window','document','navigator','IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot>, Dialog: typeof import('../../src/renderer/components/ServerMonitorDialog')['ServerMonitorDialog'];
let props: ServerMonitorDialogProps, read: ReturnType<typeof vi.fn>, cancel: ReturnType<typeof vi.fn>, closed: ReturnType<typeof vi.fn>;
beforeAll(async () => { document = memoryDocument(); ({ createRoot } = await import('react-dom/client')); ({ ServerMonitorDialog: Dialog } = await import('../../src/renderer/components/ServerMonitorDialog')); });
beforeEach(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true }); read = vi.fn().mockResolvedValue(snapshot()); cancel = vi.fn().mockResolvedValue(undefined); closed = vi.fn(); props = { open: true, connectionId: 'a', connectionRevision: 1, services: { read, cancel }, onClose: closed }; const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element); });
afterEach(async () => { await act(async () => root.unmount()); document.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 同一根更新真实props，覆盖修订、关闭与StrictMode效果重订阅。 */
async function render(patch: Partial<ServerMonitorDialogProps> = {}, strict = false) { props = { ...props, ...patch }; await act(async () => { const element = <Dialog {...props}/>; root.render(strict ? <StrictMode>{element}</StrictMode> : element); }); }
async function close() { const button = document.querySelectorAll('button').find(node => node.textContent === t.close); expect(button).toBeDefined(); await act(async () => { button!.dispatchEvent(new MemoryEvent('click')); }); }
describe('服务器监控真实React入口（仅RAM）', () => {
  it.each([false, true])('概要/固定状态/有限会话保持精确值、NULL和范围提示，StrictMode=%s', async strict => {
    await render({}, strict); expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(t.title);
    for (const text of ['18446744073709551615','9007199254740994',t.null,t.emptyString,t.sqlLimited,t.scope,t.autoBudget]) expect(document.body.textContent).toContain(text);
    expect(document.querySelector('img')).toBeNull(); expect(read).toHaveBeenCalledOnce(); expect(read.mock.calls[0][0]).toMatchObject({ connectionId: 'a', sessionLimit: 50 }); await close(); expect(closed).toHaveBeenCalledOnce();
  });
  it('同根A/B/A修订切换等待原读和取消，旧快照与旧关闭回调不影响新窗口', async () => {
    const old = deferred<ServerMonitorSnapshot>(), control = deferred<unknown>(); read.mockReturnValueOnce(old.promise).mockResolvedValue(snapshot('新服务器')); cancel.mockReturnValue(control.promise);
    await render(); await close(); expect(closed).not.toHaveBeenCalled(); await render({ connectionId: 'b' }); await render({ connectionId: 'a', connectionRevision: 2 });
    await act(async () => { old.resolve(snapshot('旧服务器不可展示')); }); expect(read).toHaveBeenCalledOnce(); expect(document.body.textContent).not.toContain('旧服务器不可展示');
    await act(async () => { control.resolve(undefined); }); expect(read).toHaveBeenCalledTimes(2); expect(document.body.textContent).toContain('新服务器'); expect(closed).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
  });
  it('权限不足分节展示，关闭props撤销当前读取并不重复读取', async () => {
    const value = snapshot(); value.globalStatus = { status: 'unavailable', reason: '没有全局状态读取权限' }; value.sessions = { status: 'unavailable', reason: '没有会话读取权限' }; read.mockResolvedValueOnce(value);
    await render(); expect(document.body.textContent).toContain('合成服务器'); expect(document.body.textContent).toContain('没有会话读取权限'); expect(document.body.textContent).toContain(t.scope);
    await render({ open: false }); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(read).toHaveBeenCalledOnce();
  });
  it('页面隐藏取消原读，重显等待原轮释放，不接收隐藏前的迟到快照', async () => {
    const old = deferred<ServerMonitorSnapshot>(); read.mockReturnValueOnce(old.promise).mockResolvedValue(snapshot('重显服务器')); await render();
    await act(async () => { Object.assign(document, { visibilityState: 'hidden' }); document.dispatchEvent(new MemoryEvent('visibilitychange')); });
    expect(cancel).toHaveBeenCalledOnce(); await act(async () => { Object.assign(document, { visibilityState: 'visible' }); document.dispatchEvent(new MemoryEvent('visibilitychange')); }); expect(read).toHaveBeenCalledOnce();
    await act(async () => { old.resolve(snapshot('隐藏前旧快照')); }); expect(read).toHaveBeenCalledTimes(2); expect(document.body.textContent).not.toContain('隐藏前旧快照'); expect(document.body.textContent).toContain('重显服务器');
  });
  it('会话显示硬上限100，所有SQL仅为文本详情，无kill或执行按钮', async () => {
    const value = snapshot(); if (value.sessions.status === 'available') { const row = value.sessions.value.rows[0]; value.sessions.value.rows = Array.from({ length: 101 }, (_, index) => ({ ...row, id: String(index) })); } read.mockResolvedValueOnce(value);
    await render(); expect(document.querySelector('tbody')!.querySelectorAll('tr')).toHaveLength(100); expect(document.querySelectorAll('button').some(node => /kill|结束会话|执行SQL/i.test(node.textContent))).toBe(false);
  });
});
