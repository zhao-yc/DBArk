import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/renderer/lib', () => ({
  invoke: request,
  uid: () => '测试标签',
  errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error)
}));

describe('退出时刷新工作空间设置', () => {
  let workspace: typeof import('../../src/renderer/store');
  let renderer: EventTarget;

  beforeEach(async () => {
    vi.useFakeTimers(); vi.resetModules(); request.mockReset(); request.mockResolvedValue(undefined);
    renderer = new EventTarget(); vi.stubGlobal('window', renderer);
    workspace = await import('../../src/renderer/store');
    workspace.useWorkspace.setState({ ready: true });
  });

  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('退出握手只保存最新快照，并取消尚未执行的防抖写入', async () => {
    workspace.useWorkspace.getState().updateSettings({ sidebarWidth: 280 });
    workspace.useWorkspace.getState().updateSettings({ sidebarWidth: 320 });
    await workspace.flushSettings();
    expect(request).toHaveBeenCalledExactlyOnceWith('settings.save', expect.objectContaining({ sidebarWidth: 320 }));
    renderer.dispatchEvent(new Event('beforeunload'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('beforeunload不再次发起保存，也不留下延迟写入', async () => {
    workspace.useWorkspace.getState().updateSettings({ theme: 'light' });
    renderer.dispatchEvent(new Event('beforeunload'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).not.toHaveBeenCalled();
  });

  it('真实保存失败向握手调用方抛出，不能作为成功退出处理', async () => {
    workspace.useWorkspace.getState().updateSettings({ sidebarWidth: 340 });
    const failure = new Error('配置写入失败'); request.mockRejectedValueOnce(failure);
    await expect(workspace.flushSettings()).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
