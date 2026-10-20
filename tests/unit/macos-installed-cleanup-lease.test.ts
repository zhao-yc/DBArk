import { EventEmitter } from 'node:events';
import { join } from 'node:path';
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
  /** 新CI上下文用真实仓库/工作流/ref组合，不复用冻结分支的环境声明。 */
  function desktop(ref='refs/heads/main') {
    return { ...base, GITHUB_REPOSITORY:'zhao-yc/DBArk', GITHUB_REF:ref, GITHUB_JOB:'desktop', GITHUB_EVENT_NAME:'push', GITHUB_WORKFLOW_REF:`zhao-yc/DBArk/.github/workflows/ci.yml@${ref}` };
  }
  it.each(['refs/heads/main','refs/heads/codex/query-result-range-filter-20261020'])('准确desktop上下文%s分别接受源码和安装，仍拒绝阶段串用', ref => {
    const env=desktop(ref);
    expect(lease.isDesktopKeeperContext(env)).toBe(true);
    expect(()=>keeper.requireKeeperCI(['source'],'darwin','arm64',env)).not.toThrow();
    expect(()=>keeper.requireInstalledKeeperCI(['installed'],'darwin','arm64',env)).not.toThrow();
    expect(()=>keeper.requireKeeperCI(['installed'],'darwin','arm64',env)).toThrow();
    expect(()=>keeper.requireInstalledKeeperCI(['source'],'darwin','arm64',env)).toThrow();
    expect(lease.macInstalledCleanupNonce(['--mac-installed-keeper',nonce],'darwin','arm64',{...env,DBARK_NATIVE_EDITOR_CI:'1'},channel())).toBe(nonce);
  });
  it.each([
    {GITHUB_REPOSITORY:'other/DBArk'}, {GITHUB_JOB:'keeper'}, {GITHUB_REF:'refs/heads/other'},
    {GITHUB_EVENT_NAME:'pull_request'}, {GITHUB_EVENT_NAME:'schedule'}, {GITHUB_WORKFLOW_REF:'zhao-yc/DBArk/.github/workflows/other.yml@refs/heads/main'},
    {GITHUB_WORKFLOW_REF:'zhao-yc/DBArk/.github/workflows/ci.yml@refs/heads/other'}, {GITHUB_WORKFLOW_REF:undefined},
  ])('新上下文拒绝错误仓库/job/ref/工作流事件：%j', patch => {
    const env={...desktop(),...patch};expect(lease.isDesktopKeeperContext(env)).toBe(false);
    expect(()=>keeper.requireKeeperCI(['source'],'darwin','arm64',env)).toThrow();
    expect(()=>keeper.requireInstalledKeeperCI(['installed'],'darwin','arm64',env)).toThrow();
    expect(()=>lease.macInstalledCleanupNonce(['--mac-installed-keeper',nonce],'darwin','arm64',{...env,DBARK_NATIVE_EDITOR_CI:'1'},channel())).toThrow();
  });
  it.each([
    {MODE_KEEPER_RUNNER_ENVIRONMENT:'self-hosted'}, {GITHUB_ACTIONS:'false'}, {GITHUB_SHA:'bad'},
    {GITHUB_RUN_ID:''}, {DBARK_INTEGRATION_ENABLED:'0'}, {NODE_OPTIONS:''}, {DYLD_INSERT_LIBRARIES:''},
  ])('准确main仍拒绝非托管身份、坏运行号和模式准备前外部入口：%j', patch => {
    const env={...desktop(),...patch};
    expect(()=>keeper.requireKeeperCI(['source'],'darwin','arm64',env)).toThrow();
    expect(()=>keeper.requireInstalledKeeperCI(['installed'],'darwin','arm64',env)).toThrow();
  });
  it('手动候选运行不改写ref；PR合并ref、标签、Windows和Intel仍不开放显示入口',()=>{
    const env={...desktop('refs/heads/codex/query-result-range-filter-20261020'),GITHUB_EVENT_NAME:'workflow_dispatch'};
    expect(()=>keeper.requireKeeperCI(['source'],'darwin','arm64',env)).not.toThrow();
    for(const ref of ['refs/pull/1/merge','refs/tags/v0.28.0'])expect(()=>keeper.requireKeeperCI(['source'],'darwin','arm64',desktop(ref))).toThrow();
    for(const [platform,arch] of [['win32','x64'],['darwin','x64'],['linux','arm64']])expect(()=>keeper.requireKeeperCI(['source'],platform,arch,env)).toThrow();
  });
  it('同job源码和安装证据分目录，旧冻结job路径保持且不接受任意阶段作为路径',()=>{
    const source=keeper.keeperRunPaths('ram-project','source',desktop()),installed=keeper.keeperRunPaths('ram-project','installed',desktop());
    expect(source.output).toBe(join('ram-project','.cache/macos-mode-keeper/source'));
    expect(installed.output).toBe(join('ram-project','.cache/macos-mode-keeper/installed'));
    expect(source.output).not.toBe(installed.output);expect(source.executable).toBe(installed.executable);
    expect(source.executable).toBe(join('ram-project','.cache/macos-mode-keeper/keeper'));
    expect(keeper.keeperRunPaths('ram-project','installed',base).output).toBe(join('ram-project','.cache/macos-mode-keeper'));
    expect(()=>keeper.keeperRunPaths('ram-project','../source',desktop())).toThrow();
  });
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
