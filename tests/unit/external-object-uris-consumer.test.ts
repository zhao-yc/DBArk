import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExternalObjectUriConsumer, type ExternalObjectUriConsumerPorts } from '../../src/renderer/externalObjectUris';
import type { ExternalObjectUriRequest, ExternalObjectUriState } from '../../src/shared/externalObjectUris';
import type { WorkbenchTarget } from '../../src/shared/workbench';
import { externalObjectUrisZh as text } from '../../src/shared/externalObjectUris.zh-CN';

const { request, saveSettings } = vi.hoisted(() => ({ request: vi.fn(), saveSettings: vi.fn() }));
vi.mock('../../src/renderer/lib', () => ({ invoke: (command: string, input: unknown) => command === 'settings.save' ? saveSettings(input) : request(command, input), uid: () => '系统链接标签', errorMessage: (reason: unknown) => String(reason) }));
const targetA = { connectionId: 'c', database: 'db', kind: 'table', name: 'A' } as const;
const targetB = { ...targetA, name: 'B' } as const;
const idA = '00000000-0000-4000-8000-000000000001', idB = '00000000-0000-4000-8000-000000000002';
const selected = (id = idA, target: WorkbenchTarget = targetA): ExternalObjectUriRequest => ({ id, kind: 'target', target });
const state = (pending = false): ExternalObjectUriState => ({ pending, active: false });

/** 只控制外部IO完成时机，实际导航、store.select/openTab及迟到门均为生产实现。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
/** 冲刷有限微任务，不推进任何产品轮询或数据库操作。 */
async function settle() { for (let index = 0; index < 60; index++) await Promise.resolve(); }

describe('系统对象URI的单原操作与工作区导航', () => {
  let workspace: typeof import('../../src/renderer/store');
  let navigation: ReturnType<typeof import('../../src/renderer/workbenchNavigation').createWorkbenchNavigation>;
  const consumers: ReturnType<typeof createExternalObjectUriConsumer>[] = [];
  beforeEach(async () => {
    vi.resetModules(); vi.stubGlobal('window', new EventTarget()); request.mockReset(); saveSettings.mockReset().mockResolvedValue(undefined);
    workspace = await import('../../src/renderer/store'); navigation = (await import('../../src/renderer/workbenchNavigation')).createWorkbenchNavigation(vi.fn());
  });
  afterEach(() => { for (const consumer of consumers.splice(0)) consumer.dispose(); navigation.dispose(); vi.unstubAllGlobals(); });
  /** intent只增不减；真实工作区变化也推进epoch，覆盖导航自身投影的后继承接。 */
  function fixture(overrides: Partial<ExternalObjectUriConsumerPorts> = {}) {
    let epoch = 0, allowed = true;
    const ports = { ready: vi.fn(async () => state(true)), take: vi.fn(async () => selected()), resolve: vi.fn(async () => targetA as WorkbenchTarget), commit: vi.fn(async () => ({ committed: true as const })), finish: vi.fn(async () => state()), open: vi.fn(navigation.open), canNavigate: () => allowed, captureIntent: () => epoch, isIntentCurrent: (scope: unknown) => scope === epoch, notify: vi.fn(), ...overrides };
    const consumer = createExternalObjectUriConsumer(ports); consumers.push(consumer);
    return { ports, consumer, block: () => { allowed = false; }, allow: () => { allowed = true; }, manual: () => { epoch++; }, observeWorkspace: () => workspace.useWorkspace.subscribe((next, previous) => { if (next.settings.activeTabId !== previous.settings.activeTabId || next.settings.tabs !== previous.settings.tabs || next.selection !== previous.selection) epoch++; }) };
  }
  it('冷启动与订阅后的早通知只握手/领取/核验一次，使用原导航而非额外workbench.resolve', async () => {
    const f = fixture({ ready: vi.fn(async () => state(false)) });
    f.consumer.signal(); f.consumer.start(); f.consumer.start(); f.consumer.wake(); await settle();
    expect(f.ports.ready).toHaveBeenCalledOnce(); expect(f.ports.take).toHaveBeenCalledOnce(); expect(f.ports.resolve).toHaveBeenCalledExactlyOnceWith(idA); expect(f.ports.commit).toHaveBeenCalledExactlyOnceWith(idA); expect(f.ports.finish).toHaveBeenCalledExactlyOnceWith(idA);
    expect(workspace.useWorkspace.getState().settings.tabs).toMatchObject([{ kind: 'table', table: 'A', connectionId: 'c' }]); expect(request).not.toHaveBeenCalled(); expect(f.ports.notify).not.toHaveBeenCalled();
  });
  it('模态/关闭协商时不take，wake只在可导航后领取一次', async () => {
    const f = fixture(); f.block(); f.consumer.start(); await settle(); f.consumer.wake(); await settle();
    expect(f.ports.ready).toHaveBeenCalledOnce(); expect(f.ports.take).not.toHaveBeenCalled();
    f.allow(); f.consumer.wake(); f.consumer.wake(); await settle(); expect(f.ports.take).toHaveBeenCalledOnce(); expect(f.ports.commit).toHaveBeenCalledOnce();
  });
  it('元数据完成后模态出现，原Promise只等本地wake，不重核也不提前commit/投影', async () => {
    const read = deferred<WorkbenchTarget>(), f = fixture({ resolve: vi.fn(() => read.promise) });
    f.consumer.start(); await settle(); expect(f.ports.resolve).toHaveBeenCalledOnce(); f.block(); read.resolve(targetA); await settle();
    expect(f.ports.commit).not.toHaveBeenCalled(); expect(f.ports.finish).not.toHaveBeenCalled(); expect(workspace.useWorkspace.getState().settings.tabs).toEqual([]);
    f.allow(); f.consumer.wake(); await settle(); expect(f.ports.resolve).toHaveBeenCalledOnce(); expect(f.ports.commit).toHaveBeenCalledOnce(); expect(f.ports.finish).toHaveBeenCalledOnce();
  });
  it('新URI撤销旧metadata投影，仍等旧metadata及原finish实际settle才开始后继', async () => {
    const read = deferred<WorkbenchTarget>(), finish = deferred<ExternalObjectUriState>();
    const take = vi.fn().mockResolvedValueOnce(selected()).mockResolvedValueOnce(selected(idB, targetB));
    const resolve = vi.fn().mockReturnValueOnce(read.promise).mockResolvedValueOnce(targetB), cleanup = vi.fn().mockReturnValueOnce(finish.promise).mockResolvedValueOnce(state());
    const f = fixture({ take, resolve, finish: cleanup }); f.consumer.start(); await settle(); f.consumer.signal(); await settle(); expect(take).toHaveBeenCalledOnce();
    read.reject(Error('旧连接私有错误不应回显')); await settle(); expect(cleanup).toHaveBeenCalledExactlyOnceWith(idA); expect(take).toHaveBeenCalledOnce(); expect(f.ports.commit).not.toHaveBeenCalled();
    finish.resolve(state(true)); await settle(); expect(take).toHaveBeenCalledTimes(2); expect(resolve.mock.calls.map(call => call[0])).toEqual([idA, idB]); expect(f.ports.commit).toHaveBeenCalledExactlyOnceWith(idB); expect(cleanup.mock.calls.map(call => call[0])).toEqual([idA, idB]);
    expect(workspace.useWorkspace.getState().settings.tabs).toMatchObject([{ table: 'B' }]); expect(f.ports.notify).not.toHaveBeenCalled();
  });
  it('手动owner/epoch变化后即使回到相同选择也不复活原URI', async () => {
    const read = deferred<WorkbenchTarget>(), f = fixture({ resolve: vi.fn(() => read.promise) }); f.consumer.start(); await settle(); f.manual(); f.manual(); f.consumer.wake(); read.resolve(targetA); await settle();
    expect(f.ports.commit).not.toHaveBeenCalled(); expect(f.ports.finish).toHaveBeenCalledExactlyOnceWith(idA); expect(workspace.useWorkspace.getState().settings.tabs).toEqual([]); expect(f.ports.notify).not.toHaveBeenCalled();
  });
  it('模态等待期间的新URI解除旧wait，保留最新pending且不重复旧resolve', async () => {
    const read = deferred<WorkbenchTarget>(), take = vi.fn().mockResolvedValueOnce(selected()).mockResolvedValueOnce(selected(idB, targetB));
    const f = fixture({ take, resolve: vi.fn().mockReturnValueOnce(read.promise).mockResolvedValueOnce(targetB), finish: vi.fn().mockResolvedValueOnce(state(true)).mockResolvedValueOnce(state()) });
    f.consumer.start(); await settle(); f.block(); read.resolve(targetA); await settle(); f.consumer.signal(); await settle();
    expect(f.ports.finish).toHaveBeenCalledExactlyOnceWith(idA); expect(take).toHaveBeenCalledOnce(); f.allow(); f.consumer.wake(); await settle();
    expect(f.ports.commit).toHaveBeenCalledExactlyOnceWith(idB); expect(f.ports.resolve).toHaveBeenCalledTimes(2); expect(workspace.useWorkspace.getState().settings.tabs).toMatchObject([{ table: 'B' }]);
  });
  it('take=null期间到达的通知最多补查一次，不丢冷通知也不形成无限空忙循环', async () => {
    const first = deferred<ExternalObjectUriRequest | null>(), take = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(selected(idB, targetB));
    const f = fixture({ take, resolve: vi.fn(async () => targetB) }); f.consumer.start(); await settle(); f.consumer.signal(); first.resolve(null); await settle();
    expect(take).toHaveBeenCalledTimes(2); expect(f.ports.resolve).toHaveBeenCalledExactlyOnceWith(idB);
    let signals!: () => void; const empty = vi.fn(async () => { signals(); return null; }), g = fixture({ take: empty }); signals = g.consumer.signal;
    g.consumer.start(); await settle(); expect(empty).toHaveBeenCalledTimes(2); expect(g.ports.resolve).not.toHaveBeenCalled(); expect(g.ports.finish).not.toHaveBeenCalled();
  });
  it('take在途的新通知可能对应返回的最新目标，不把新目标误当旧投影丢弃', async () => {
    const taking = deferred<ExternalObjectUriRequest | null>(), f = fixture({ take: vi.fn(() => taking.promise), resolve: vi.fn(async () => targetB) });
    f.consumer.start(); await settle(); f.manual(); f.consumer.signal(); taking.resolve(selected(idB, targetB)); await settle();
    expect(f.ports.resolve).toHaveBeenCalledExactlyOnceWith(idB); expect(f.ports.commit).toHaveBeenCalledExactlyOnceWith(idB); expect(workspace.useWorkspace.getState().settings.tabs).toMatchObject([{ table: 'B' }]);
  });
  it('卸载后迟到take只finish实际原id，不resolve/commit/open或重放后继', async () => {
    const taking = deferred<ExternalObjectUriRequest | null>(), finished = deferred<ExternalObjectUriState>(), f = fixture({ take: vi.fn(() => taking.promise), finish: vi.fn(() => finished.promise) });
    f.consumer.start(); await settle(); f.consumer.dispose(); taking.resolve(selected()); await settle();
    expect(f.ports.finish).toHaveBeenCalledExactlyOnceWith(idA); expect(f.ports.resolve).not.toHaveBeenCalled(); expect(f.ports.commit).not.toHaveBeenCalled(); expect(f.ports.open).not.toHaveBeenCalled(); finished.resolve(state(true)); f.consumer.signal(); f.consumer.wake(); await settle(); expect(f.ports.take).toHaveBeenCalledOnce();
  });
  it('卸载只撤销本地意图，原metadata未结算前不假finish', async () => {
    const read = deferred<WorkbenchTarget>(), f = fixture({ resolve: vi.fn(() => read.promise) }); f.consumer.start(); await settle(); f.consumer.dispose(); await settle(); expect(f.ports.finish).not.toHaveBeenCalled(); read.resolve(targetA); await settle(); expect(f.ports.finish).toHaveBeenCalledExactlyOnceWith(idA); expect(f.ports.commit).not.toHaveBeenCalled();
  });
  it('当前metadata失败固定文案且原finish一次，旧私有异常不回显', async () => {
    const f = fixture({ resolve: vi.fn(async () => { throw Error('secret://凭据与URI不能回显'); }) }); f.consumer.start(); await settle(); expect(f.ports.notify).toHaveBeenCalledExactlyOnceWith(text.resolveFailed); expect(f.ports.finish).toHaveBeenCalledExactlyOnceWith(idA); expect(f.ports.commit).not.toHaveBeenCalled(); expect(workspace.useWorkspace.getState().settings.tabs).toEqual([]);
  });
  it.each(['invalid', 'multiple', 'changed'] as const)('Main输入错误%s只在原finish确认后通知，不走额外resolve', async code => {
    const finish = deferred<ExternalObjectUriState>(), f = fixture({ take: vi.fn(async () => ({ id: idA, kind: 'error', code } as const)), finish: vi.fn(() => finish.promise) }); f.consumer.start(); await settle(); expect(f.ports.notify).not.toHaveBeenCalled(); expect(f.ports.resolve).not.toHaveBeenCalled(); finish.resolve(state()); await settle(); expect(f.ports.notify).toHaveBeenCalledExactlyOnceWith(text[code]);
  });
  it('finish失败不自动重试或领取后继，也不把已失效旧错误通知给当前页', async () => {
    const finish = deferred<ExternalObjectUriState>(), f = fixture({ resolve: vi.fn(async () => { throw Error('原读取失败'); }), finish: vi.fn(() => finish.promise) });
    f.consumer.start(); await settle(); expect(f.ports.notify).toHaveBeenCalledExactlyOnceWith(text.resolveFailed); f.consumer.signal(); finish.reject(Error('原finish失败')); await settle(); f.consumer.wake(); f.consumer.signal(); await settle();
    expect(f.ports.finish).toHaveBeenCalledOnce(); expect(f.ports.take).toHaveBeenCalledOnce(); expect(f.ports.notify).toHaveBeenCalledOnce();
  });
  it('commit在途手动导航胜出，原commit回包后不投影或重新核验', async () => {
    const commit = deferred<{ committed: true }>(), f = fixture({ commit: vi.fn(() => commit.promise) }); f.consumer.start(); await settle(); expect(f.ports.commit).toHaveBeenCalledOnce(); f.manual(); commit.resolve({ committed: true }); f.consumer.wake(); await settle();
    expect(workspace.useWorkspace.getState().settings.tabs).toEqual([]); expect(f.ports.resolve).toHaveBeenCalledOnce(); expect(f.ports.finish).toHaveBeenCalledExactlyOnceWith(idA);
  });
  it('commit回包时出现模态仍不投影，新URI撤销本地等待后才进入原finish', async () => {
    const commit = deferred<{ committed: true }>(), finish = deferred<ExternalObjectUriState>(), f = fixture({ commit: vi.fn(() => commit.promise), finish: vi.fn(() => finish.promise) });
    f.consumer.start(); await settle(); f.block(); commit.resolve({ committed: true }); await settle();
    expect(workspace.useWorkspace.getState().settings.tabs).toEqual([]); expect(f.ports.finish).not.toHaveBeenCalled(); f.consumer.signal(); await settle();
    expect(f.ports.finish).toHaveBeenCalledExactlyOnceWith(idA); expect(f.ports.take).toHaveBeenCalledOnce(); f.consumer.dispose(); finish.resolve(state(true)); await settle(); expect(f.ports.take).toHaveBeenCalledOnce();
  });
  it('take期间返回的旧输入错误不会覆盖Main已保留的新目标', async () => {
    const taking = deferred<ExternalObjectUriRequest | null>(), take = vi.fn().mockReturnValueOnce(taking.promise).mockResolvedValueOnce(selected(idB, targetB));
    const f = fixture({ take, resolve: vi.fn(async () => targetB), finish: vi.fn().mockResolvedValueOnce(state(true)).mockResolvedValueOnce(state()) });
    f.consumer.start(); await settle(); f.consumer.signal(); taking.resolve({ id: idA, kind: 'error', code: 'invalid' }); await settle();
    expect(f.ports.notify).not.toHaveBeenCalled(); expect(f.ports.resolve).toHaveBeenCalledExactlyOnceWith(idB); expect(workspace.useWorkspace.getState().settings.tabs.at(-1)).toMatchObject({ table: 'B' });
  });
  it('commit已线性化时后继排队，自身同步投影的workspace epoch不会误丢新URI', async () => {
    const commit = deferred<{ committed: true }>(), take = vi.fn().mockResolvedValueOnce(selected()).mockResolvedValueOnce(selected(idB, targetB));
    const f = fixture({ take, resolve: vi.fn().mockResolvedValueOnce(targetA).mockResolvedValueOnce(targetB), commit: vi.fn().mockReturnValueOnce(commit.promise).mockResolvedValueOnce({ committed: true }), finish: vi.fn().mockResolvedValueOnce(state(true)).mockResolvedValueOnce(state()) });
    const unsubscribe = f.observeWorkspace(); f.consumer.start(); await settle(); f.consumer.signal(); commit.resolve({ committed: true }); await settle(); unsubscribe();
    expect(vi.mocked(f.ports.commit).mock.calls.map(call => call[0])).toEqual([idA, idB]); expect(vi.mocked(f.ports.finish).mock.calls.map(call => call[0])).toEqual([idA, idB]); expect(workspace.useWorkspace.getState().settings.tabs.at(-1)).toMatchObject({ table: 'B' }); expect(f.ports.notify).not.toHaveBeenCalled();
  });
});
