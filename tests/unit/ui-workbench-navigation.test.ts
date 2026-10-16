import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchTarget } from '../../src/shared/workbench';
import { emptyWorkbench, objectUri, parseObjectUri } from '../../src/shared/workbench';
import { reconcileTableRenameFavorites } from '../../src/renderer/tableRenameReconcile';
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
  it('员工3原反例：同一已核验物理身份a→b→a，新收藏和重新生成的URI均可导航', async () => {
    const a = { connectionId: 'c', database: 'db', table: 'a' }, b = { ...a, table: 'b' }, identity = 'a'.repeat(64);
    const document = emptyWorkbench(); document.favorites = [{ id: 'favorite', groupId: null, label: '业务表', target: { connectionId: 'c', database: 'db', kind: 'table', name: 'a' } }];
    expect(navigation.completeTableRename(a, b, identity)).toBe(true); const first = reconcileTableRenameFavorites(document, a, b); request.mockResolvedValueOnce(first.document.favorites[0].target); expect(await navigation.open(first.document.favorites[0].target)).toBe(true);
    expect(navigation.completeTableRename(b, a, identity)).toBe(true); const second = reconcileTableRenameFavorites(first.document, b, a); expect(second).toMatchObject({ changed: true, conflict: false });
    request.mockResolvedValueOnce(second.document.favorites[0].target); await expect(navigation.open(second.document.favorites[0].target)).resolves.toBe(true);
    const freshLink = objectUri(second.document.favorites[0].target); request.mockResolvedValueOnce(parseObjectUri(freshLink)); await expect(navigation.open(parseObjectUri(freshLink))).resolves.toBe(true);
    await expect(navigation.open({ ...second.document.favorites[0].target, kind: 'table', name: 'b' })).rejects.toThrow('旧对象链接');
  });
  it('严格反向：不同物理表复用退役名称，不会恢复旧URI；后来回到原身份也不抹除已知歧义', async () => {
    const a = { connectionId: 'c', database: 'db', table: 'a' }, b = { ...a, table: 'b' }, c = { ...a, table: 'c' }, d = { ...a, table: 'd' };
    const oldLink = objectUri({ connectionId: 'c', database: 'db', kind: 'table', name: 'a' });
    expect(navigation.completeTableRename(a, b, 'a'.repeat(64))).toBe(true);
    expect(navigation.completeTableRename(c, a, 'b'.repeat(64))).toBe(false);
    await expect(navigation.open(parseObjectUri(oldLink))).rejects.toThrow('旧对象链接');
    expect(navigation.completeTableRename(a, d, 'b'.repeat(64))).toBe(true);
    expect(navigation.completeTableRename(b, a, 'a'.repeat(64))).toBe(false);
    await expect(navigation.open(parseObjectUri(oldLink))).rejects.toThrow('旧对象链接'); expect(request).not.toHaveBeenCalled();
  });
  it('严格反向：未知身份、跨库/连接或无效回执不重新认可名称，完成前的旧请求仍失效', async () => {
    const a = { connectionId: 'c', database: 'db', table: 'a' }, b = { ...a, table: 'b' }, uri = { connectionId: 'c', database: 'db', kind: 'table' as const, name: 'a' };
    const previous = pending(); request.mockReturnValueOnce(previous.promise); const old = navigation.open(uri);
    navigation.completeTableRename(a, b, 'a'.repeat(64)); previous.resolve(uri); expect(await old).toBe(false);
    expect(() => navigation.completeTableRename(b, a, '')).toThrow(); expect(() => navigation.completeTableRename(b, { ...a, database: 'other' }, 'a'.repeat(64))).toThrow();
    await expect(navigation.open(uri)).rejects.toThrow('旧对象链接');
    navigation.retireTable({ ...a, table: 'unknown' }); expect(navigation.completeTableRename(b, { ...a, table: 'unknown' }, 'a'.repeat(64))).toBe(false);
    const other = { ...uri, connectionId: 'other' }; request.mockResolvedValueOnce(other); await expect(navigation.open(other)).resolves.toBe(true);
  });
});
