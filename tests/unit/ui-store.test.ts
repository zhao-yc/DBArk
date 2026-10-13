import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/renderer/lib', () => ({
  invoke: request,
  uid: () => '测试标签',
  errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error)
}));

describe('工作空间设置与连接上下文', () => {
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

  it('连接目标失效仅清该连接库选择和树版本，保留其它连接标签及事务任务标记', async () => {
    const settings = { ...workspace.useWorkspace.getState().settings, tabs: [{ id: '其它标签', kind: 'query' as const, title: '保留查询', connectionId: '其它连接', database: 'other_db', sql: 'SELECT 1;' }] };
    const dirtyTabs = { '其它标签': true }; const activeJobs = { '其它标签': true };
    workspace.useWorkspace.setState({ settings, selection: { connectionId: '目标连接', database: 'old_db' }, connectionVersions: { '目标连接': 1, '其它连接': 5 }, dirtyTabs, activeJobs });
    workspace.useWorkspace.getState().invalidateConnection('目标连接');
    const current = workspace.useWorkspace.getState();
    expect(current.selection).toEqual({ connectionId: '目标连接' });
    expect(current.connectionVersions).toEqual({ '目标连接': 2, '其它连接': 5 });
    expect(current.settings).toBe(settings);
    expect(current.dirtyTabs).toBe(dirtyTabs);
    expect(current.activeJobs).toBe(activeJobs);
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).not.toHaveBeenCalled();
  });

  it('更新未选中的连接保留当前其它连接的数据库选择', () => {
    const selection = { connectionId: '其它连接', database: 'keep_db' };
    workspace.useWorkspace.setState({ selection });
    workspace.useWorkspace.getState().invalidateConnection('目标连接');
    expect(workspace.useWorkspace.getState().selection).toBe(selection);
    expect(workspace.useWorkspace.getState().connectionVersions).toEqual({ '目标连接': 1 });
  });
});
