import { beforeAll, describe, expect, it } from 'vitest';
let acquireWorkspaceBusy: typeof import('../../src/renderer/store')['acquireWorkspaceBusy'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'];
/** store的卸载监听只注册到内存窗口，不创建GUI或持久IO。 */
beforeAll(async () => { Object.defineProperty(globalThis, 'window', { value: { addEventListener() {} }, configurable: true }); ({ acquireWorkspaceBusy, useWorkspace } = await import('../../src/renderer/store')); });

describe('保存后关闭的内存作业占用', () => {
  it('只有自己的占用可释放，重复释放无效', () => { const lease = acquireWorkspaceBusy('own'); expect(lease.owns()).toBe(true); expect(() => acquireWorkspaceBusy('own')).toThrow('已有活动作业'); expect(lease.release()).toBe(true); expect(lease.owns()).toBe(false); expect(lease.release()).toBe(false); expect(useWorkspace.getState().activeJobs.own).toBe(false); });
  it('同标签再次setBusy(true)表示新占用，旧保存不能清除', () => { const lease = acquireWorkspaceBusy('same'); useWorkspace.getState().setBusy('same', true); expect(lease.owns()).toBe(false); expect(lease.release()).toBe(false); expect(useWorkspace.getState().activeJobs.same).toBe(true); useWorkspace.getState().setBusy('same', false); });
  it('结束后同ID重新占用不能被旧租约误清除', () => { const first = acquireWorkspaceBusy('aba'); useWorkspace.getState().setBusy('aba', false); const next = acquireWorkspaceBusy('aba'); expect(first.release()).toBe(false); expect(next.owns()).toBe(true); expect(next.release()).toBe(true); });
  it('其它标签作业不影响当前归属，释放也不动其它作业', () => { const lease = acquireWorkspaceBusy('current'); useWorkspace.getState().setBusy('other', true); expect(lease.owns()).toBe(true); expect(lease.release()).toBe(true); expect(useWorkspace.getState().activeJobs.other).toBe(true); useWorkspace.getState().setBusy('other', false); });
});
