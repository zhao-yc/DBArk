import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkbench } from '../../src/shared/workbench';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../src/renderer/lib', () => ({ invoke: request, uid: () => '收藏编号', errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error) }));

describe('收藏界面保存与恢复边界', () => {
  let module: typeof import('../../src/renderer/workbench');
  beforeEach(async () => {
    vi.resetModules(); request.mockReset(); vi.stubGlobal('window', new EventTarget());
    module = await import('../../src/renderer/workbench');
  });
  afterEach(() => vi.unstubAllGlobals());
  it('加载失败保留未就绪状态，显式重试后恢复实际专注模式', async () => {
    request.mockRejectedValueOnce(Error('配置不可读')); await module.useWorkbench.getState().initialize();
    expect(module.useWorkbench.getState()).toMatchObject({ ready: false, busy: false, error: '配置不可读' });
    request.mockResolvedValueOnce({ revision: 3, document: { ...emptyWorkbench(), focusMode: true } });
    await module.useWorkbench.getState().initialize();
    expect(module.useWorkbench.getState()).toMatchObject({ ready: true, busy: false, snapshot: { revision: 3, document: { focusMode: true } } });
  });
  it('保存完成前阻止第二次修改，失败保持旧快照且可继续重试', async () => {
    const snapshot = { revision: 2, document: emptyWorkbench() };
    module.useWorkbench.setState({ snapshot, ready: true });
    let reject!: (error: Error) => void;
    request.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const saving = module.useWorkbench.getState().save({ ...snapshot.document, focusMode: true });
    expect(module.useWorkbench.getState().busy).toBe(true);
    expect(await module.useWorkbench.getState().save(snapshot.document)).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    reject(Error('写盘失败')); expect(await saving).toBe(false);
    expect(module.useWorkbench.getState().snapshot).toBe(snapshot);
    request.mockResolvedValueOnce({ revision: 3, document: { ...snapshot.document, focusMode: true } });
    expect(await module.useWorkbench.getState().save({ ...snapshot.document, focusMode: true })).toBe(true);
    expect(module.useWorkbench.getState().snapshot.revision).toBe(3);
  });
  it('同名表和视图独立收藏，星标移除不触碰工作区及数据库入口', async () => {
    module.useWorkbench.setState({ ready: true });
    request.mockImplementation(async (command, input) => {
      if (command !== 'workbench.save') throw Error('不应调用数据库或工作区命令');
      return { ...input, revision: input.revision + 1 };
    });
    const target = { connectionId: 'c', database: 'a.b', kind: 'table' as const, name: '__proto__' };
    await module.useWorkbench.getState().toggleFavorite(target);
    expect(module.useWorkbench.getState().snapshot.document.favorites[0].target).toEqual(target);
    // 独立编号模拟浏览器 UUID，避免测试桩引入重复主键。
    module.useWorkbench.setState(state => ({ snapshot: { ...state.snapshot, document: { ...state.snapshot.document, favorites: state.snapshot.document.favorites.map(item => ({ ...item, id: '首条' })) } } }));
    await module.useWorkbench.getState().toggleFavorite({ ...target, kind: 'view' });
    expect(module.useWorkbench.getState().snapshot.document.favorites).toHaveLength(2);
    await module.useWorkbench.getState().toggleFavorite(target);
    expect(module.useWorkbench.getState().snapshot.document.favorites.map(item => item.target.kind)).toEqual(['view']);
  });
});
