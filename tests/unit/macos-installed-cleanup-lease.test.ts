import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 只加载定义并使用内存IPC；不编译、启动应用、读取批准或切换显示器。
const lease: any = await import(new URL('../../scripts/macos-installed-cleanup-lease.mjs', import.meta.url).href);
const keeper: any = await import(new URL('../../scripts/macos-mode-keeper-ci.mjs', import.meta.url).href);
const nonce = 'a'.repeat(64);
const base = { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/codex/v028-serial-closeout-20261019', GITHUB_JOB: 'arm64-installed', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', MODE_KEEPER_RUNNER_ENVIRONMENT: 'github-hosted' };
afterEach(() => vi.useRealTimers());

/** 合成父通道只记录消息；测试主动提供成功/失败事件。 */
function channel() {
  return Object.assign(new EventEmitter(), { connected: true, send: vi.fn((_value: unknown, done: (error?: Error) => void) => done()) });
}

describe('Mac安装显示租约清理门', () => {
  it('普通入口关闭时不要求IPC，不开放新的资源入口', () => {
    expect(lease.macInstalledCleanupNonce([], 'win32', 'x64', {}, {})).toBeUndefined();
  });
  it('只接受本次arm64安装job，源码入口仍维持原分支约束', () => {
    expect(() => keeper.requireInstalledKeeperCI(['installed'], 'darwin', 'arm64', base)).not.toThrow();
    expect(() => keeper.requireKeeperCI(['installed'], 'darwin', 'arm64', base)).toThrow();
    expect(() => keeper.requireKeeperCI(['source'], 'darwin', 'arm64', { ...base, GITHUB_REF: 'refs/heads/codex/macos-mode-keeper-20261019' })).not.toThrow();
  });
  it.each([
    { GITHUB_ACTIONS: 'false' }, { GITHUB_JOB: 'keeper' }, { GITHUB_REF: 'refs/heads/main' },
    { MODE_KEEPER_RUNNER_ENVIRONMENT: 'self-hosted' }, { DBARK_TEST_PASSWORD: '' }, { NODE_OPTIONS: '' }, { DYLD_INSERT_LIBRARIES: '' },
  ])('安装模式拒绝错误宿主/上下文或外部参数：%j', patch => {
    expect(() => keeper.requireInstalledKeeperCI(['installed'], 'darwin', 'arm64', { ...base, ...patch })).toThrow();
  });
  it.each([['linux', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']])('拒绝平台架构%s/%s', (platform, arch) => {
    expect(() => keeper.requireInstalledKeeperCI(['installed'], platform, arch, base)).toThrow();
  });
  it('清理nonce还需真实IPC和原native门', () => {
    const env = { ...base, DBARK_NATIVE_EDITOR_CI: '1' }, ipc = channel();
    expect(lease.macInstalledCleanupNonce(['--mac-installed-keeper', nonce], 'darwin', 'arm64', env, ipc)).toBe(nonce);
    expect(() => lease.macInstalledCleanupNonce(['--mac-installed-keeper', nonce], 'darwin', 'arm64', env, {})).toThrow();
    expect(() => lease.macInstalledCleanupNonce(['--mac-installed-keeper', nonce], 'darwin', 'arm64', { ...env, DBARK_NATIVE_EDITOR_CI: '0' }, ipc)).toThrow();
    expect(() => lease.macInstalledCleanupNonce(['--mac-installed-keeper', 'bad'], 'darwin', 'arm64', env, ipc)).toThrow();
  });
  it('发送唯一请求，仅收到同nonce的真实恢复确认才允许卸载', async () => {
    const ipc = channel(), result = lease.confirmMacInstalledCleanup(ipc, nonce);
    expect(ipc.send).toHaveBeenCalledWith({ type: 'dbark-mac-cleanup-request', nonce }, expect.any(Function));
    ipc.emit('message', { type: 'dbark-mac-cleanup-approved', nonce, restored: true });
    await expect(result).resolves.toBeUndefined(); expect(ipc.listenerCount('message')).toBe(0);
  });
  it.each([
    { type: 'dbark-mac-cleanup-approved', nonce: 'b'.repeat(64), restored: true },
    { type: 'dbark-mac-cleanup-approved', nonce, restored: false },
    { type: 'dbark-mac-cleanup-approved', nonce, restored: true, extra: true },
  ])('无效确认终止清理，迟到正确确认不能复活：%j', async message => {
    const ipc = channel(), result = lease.confirmMacInstalledCleanup(ipc, nonce);
    ipc.emit('message', message); ipc.emit('message', { type: 'dbark-mac-cleanup-approved', nonce, restored: true });
    await expect(result).rejects.toThrow('身份无效'); expect(ipc.listenerCount('message')).toBe(0);
  });
  it('断线保留现场', async () => {
    const ipc = channel(), result = lease.confirmMacInstalledCleanup(ipc, nonce);
    ipc.emit('disconnect'); await expect(result).rejects.toThrow('断开');
  });
  it('超时保留现场且清除监听', async () => {
    vi.useFakeTimers(); const ipc = channel(), result = lease.confirmMacInstalledCleanup(ipc, nonce);
    const rejected = expect(result).rejects.toThrow('15秒');
    await vi.advanceTimersByTimeAsync(15000); await rejected;
    expect(ipc.listenerCount('message')).toBe(0); expect(ipc.listenerCount('disconnect')).toBe(0);
  });
});
