import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchTarget } from '../../src/shared/workbench';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/renderer/lib', () => ({ invoke: request, uid: () => '新标签', errorMessage: (error: unknown) => String(error) }));
const production = { connectionId: '生产连接', database: 'app', kind: 'table', name: 'users' } as const;
const testing = { ...production, connectionId: '测试连接' } as const;

/** 请求仅控制完成顺序，工作区选择、标签及定义导航均调用实际生产代码。 */
function pending() {
  let resolve!: (target: WorkbenchTarget) => void, reject!: (error: Error) => void;
  const promise = new Promise<WorkbenchTarget>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe('收藏与链接的最新显式导航意图', () => {
  let navigation: ReturnType<typeof import('../../src/renderer/workbenchNavigation').createWorkbenchNavigation>;
  let workspace: typeof import('../../src/renderer/store');
  const definition = vi.fn();
  beforeEach(async () => {
    vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal('window', new EventTarget()); request.mockReset(); definition.mockReset();
    workspace = await import('../../src/renderer/store');
    const module = await import('../../src/renderer/workbenchNavigation');
    navigation = module.createWorkbenchNavigation(definition);
  });
  afterEach(() => { navigation.dispose(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('先收藏A慢、后链接B快，A迟到不覆盖最新的表页和连接选择', async () => {
    const a = pending(), b = pending(); request.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const old = navigation.open(production), latest = navigation.open(testing);
    b.resolve(testing); expect(await latest).toBe(true);
    const settings = workspace.useWorkspace.getState().settings;
    expect(settings.tabs).toMatchObject([{ connectionId: testing.connectionId, table: 'users' }]);
    a.resolve(production); expect(await old).toBe(false);
    expect(workspace.useWorkspace.getState().settings).toBe(settings);
    expect(workspace.useWorkspace.getState().selection?.connectionId).toBe(testing.connectionId);
    expect(request.mock.calls.map(([command]) => command)).toEqual(['workbench.resolve', 'workbench.resolve']);
  });
  it('较新数据库导航创建空查询，旧表页结果不复活', async () => {
    const a = pending(), b = pending(); request.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const old = navigation.open(production);
    const database = { connectionId: testing.connectionId, database: 'app', kind: 'database' } as const;
    const latest = navigation.open(database); b.resolve(database); await latest; a.resolve(production); await old;
    expect(workspace.useWorkspace.getState().settings.tabs).toMatchObject([{ kind: 'query', connectionId: testing.connectionId, sql: '' }]);
    expect(definition).not.toHaveBeenCalled();
  });
  it('较新的只读定义导航优先，旧失败也不向界面抛出过期错误', async () => {
    const a = pending(), b = pending(); request.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const old = navigation.open(production), target = { ...testing, kind: 'procedure' as const };
    const latest = navigation.open(target); b.resolve(target); expect(await latest).toBe(true);
    a.reject(Error('旧连接失败')); expect(await old).toBe(false);
    expect(definition).toHaveBeenCalledExactlyOnceWith({ connectionId: testing.connectionId, database: 'app', object: { kind: 'procedure', name: 'users' }, readOnly: true });
    expect(workspace.useWorkspace.getState().settings.tabs).toEqual([]);
  });
  it('关闭所属对话框或组件卸载中止信号后，不应用迟到成功', async () => {
    const a = pending(), scope = new AbortController(); request.mockReturnValueOnce(a.promise);
    const old = navigation.open(production, { signal: scope.signal }); scope.abort(); a.resolve(production);
    expect(await old).toBe(false); expect(workspace.useWorkspace.getState().selection).toBeUndefined();
    expect(workspace.useWorkspace.getState().settings.tabs).toEqual([]);
  });
  it('旧入口卸载不会废弃另一个入口的新请求', async () => {
    const a = pending(), b = pending(), scope = new AbortController(); request.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const old = navigation.open(production, { signal: scope.signal }), latest = navigation.open(testing);
    scope.abort(); b.resolve(testing); expect(await latest).toBe(true); a.resolve(production); expect(await old).toBe(false);
    expect(workspace.useWorkspace.getState().selection?.connectionId).toBe(testing.connectionId);
  });
  it('打开或关闭新表单立即撤销旧意图，新导航失败也不回退到旧请求', async () => {
    const a = pending(), b = pending(); request.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const old = navigation.open(production); navigation.invalidate();
    const latest = navigation.open(testing); b.reject(Error('新目标失效'));
    await expect(latest).rejects.toThrow('新目标失效'); a.resolve(production); expect(await old).toBe(false);
    expect(workspace.useWorkspace.getState().selection).toBeUndefined();
  });
  it('应用卸载后全部响应失效，重新挂接也不能恢复旧代次', async () => {
    const a = pending(), b = pending(); request.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const old = navigation.open(production); navigation.dispose(); navigation.activate();
    const latest = navigation.open(testing); a.resolve(production); expect(await old).toBe(false); b.resolve(testing); expect(await latest).toBe(true);
    expect(workspace.useWorkspace.getState().selection?.connectionId).toBe(testing.connectionId);
  });
  it('重命名立即撤销迟到导航并拒绝旧名称链接；其他连接与新名称仍走真实解析', async () => {
    const a = pending(); request.mockReturnValueOnce(a.promise);
    const old = navigation.open(production);
    navigation.retireTable({ connectionId: production.connectionId, database: production.database, table: production.name });
    a.resolve(production); expect(await old).toBe(false);
    await expect(navigation.open(production)).rejects.toThrow('旧对象链接');
    expect(request).toHaveBeenCalledTimes(1); expect(workspace.useWorkspace.getState().settings.tabs).toEqual([]);
    request.mockResolvedValueOnce(testing); expect(await navigation.open(testing)).toBe(true);
    const renamed = { ...production, name: 'renamed' }; request.mockResolvedValueOnce(renamed); expect(await navigation.open(renamed)).toBe(true);
    expect(workspace.useWorkspace.getState().settings.tabs.at(-1)).toMatchObject({ table: 'renamed' });
  });
});
