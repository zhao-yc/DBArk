import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { C02FixtureError, c02Failure, withC02UiLifetime } from '../integration/helpers/c02-mtls-policy';
import { c02DesktopEnvironment, c02PidGone } from '../e2e/c02-mtls-ui-policy';

/** 提取并执行当前源码真实类；仅进程存活/事件/文件系统边界为内存替身，不导入或启动Playwright。 */
function actualDesktop() {
  const source = readFileSync(join(process.cwd(), 'tests/e2e/c02-mtls-desktop.ts'), 'utf8'), tree = ts.createSourceFile('desktop.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'C02Desktop');
  if (!declaration) throw new Error('缺少真实 C02Desktop');
  const alive = new Set<number>(), denied = new Set<number>(), unknown = new Set<number>();
  const poll = vi.fn((check: () => boolean) => ({ toBe: async (wanted: boolean) => { expect(check()).toBe(wanted); } }));
  const launch = vi.fn(async () => { throw new Error('纯探针到达启动边界，不启动任何进程'); });
  const remove = vi.fn(async () => {});
  const context = createContext({ C02FixtureError, c02Failure, c02DesktopEnvironment, expect: { poll }, electron: { launch },
    c02PidGone: (pid: number) => c02PidGone(pid, () => { if (denied.has(pid)) throw Object.assign(new Error(), { code: 'EPERM' }); if (unknown.has(pid)) throw new Error('未知读取错误'); if (!alive.has(pid)) throw Object.assign(new Error(), { code: 'ESRCH' }); }),
    process: { env: {}, platform: 'win32' }, resolve: (value: string) => value, dirname: () => '/owned', basename: () => 'dbark-c02-ui-case',
    lstat: async () => ({ dev: 1, ino: 7, isDirectory: () => true, isSymbolicLink: () => false }), rm: remove, setTimeout,
  });
  // 仅移除模块export外壳以便VM执行，类体及实际start/quit/dispose方法逐字保留。
  const classSource = declaration.getText(tree).replace(/^export\s+/, '');
  runInContext(ts.transpileModule(`${classSource}\nglobalThis.Actual = C02Desktop;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const state = new context.Actual('/owned/dbark-c02-ui-case', '/owned', { dev: 1, ino: 7 }) as Record<string, any>;
  return { state, alive, denied, unknown, poll, launch, remove };
}

/** 构造已收到close但尚未证明退出的旧代次，不探测真实PID。 */
function previouslyClosed(handshake: boolean) {
  const fixture = actualDesktop(); Object.assign(fixture.state, { app: {}, closed: true, quitObserved: handshake, pids: new Set([42]) }); return fixture;
}

describe('C02 真实退出方法的严格正反控制流', () => {
  it('从未启动且无PID可幂等收尾', async () => {
    const { state, poll } = actualDesktop(); await state.quit(); await state.quit(); expect(poll).not.toHaveBeenCalled();
  });
  it('已有close、真实握手且全部PID消失才允许幂等验证', async () => {
    const { state, poll } = previouslyClosed(true); await state.quit(); await state.quit(); expect(state.shutdownVerified).toBe(true); expect(poll).toHaveBeenCalledTimes(2);
  });
  it('正常运行分支仍走实际quit方法的保存握手和PID检查', async () => {
    const { state, poll } = previouslyClosed(false); state.closed = false; state.quitReady = Promise.resolve(); state.rememberProcesses = vi.fn(async () => true);
    state.app = { waitForEvent: async () => {}, evaluate: async (callback: Function) => { if (callback.toString().includes('__c02Dialogs')) return false; state.closed = true; state.quitObserved = true; }, close: async () => { state.closed = true; } };
    await state.quit(); expect(state.shutdownVerified).toBe(true); expect(state.rememberProcesses).toHaveBeenCalledOnce(); expect(poll).toHaveBeenCalledOnce();
  });
  it('意外close且没有will-quit握手时，归还租约必须拒绝', async () => {
    const { state } = previouslyClosed(false);
    await expect(withC02UiLifetime(async () => {}, () => state.quit())).rejects.toThrow('保存握手'); expect(state.shutdownVerified).toBe(false); expect([...state.pids]).toEqual([42]);
  });
  it.each(['alive', 'denied', 'unknown'] as const)('close和握手均存在，但旧PID %s 时拒绝退出验证', async kind => {
    const fixture = previouslyClosed(true); fixture[kind].add(42);
    await expect(fixture.state.quit()).rejects.toThrow(); expect(fixture.state.shutdownVerified).toBe(false); expect([...fixture.state.pids]).toEqual([42]);
  });
  it.each(['pageErrorCount', 'unexpectedDialog'] as const)('closed不能绕过旧代次 %s', async key => {
    const { state } = previouslyClosed(true); state[key] = 1; await expect(state.quit()).rejects.toThrow('页面错误或非预期'); expect(state.shutdownVerified).toBe(false);
  });
  it('没有app但仍有PID责任不能伪装成从未启动', async () => {
    const { state } = actualDesktop(); state.pids.add(42); await expect(state.quit()).rejects.toThrow('旧PID责任');
  });
  it('启动前缺少旧握手必须拒绝，不调用launch也不清空旧PID', async () => {
    const { state, launch } = previouslyClosed(false); await expect(state.start()).rejects.toThrow('保存握手'); expect(launch).not.toHaveBeenCalled(); expect([...state.pids]).toEqual([42]);
  });
  it.each(['alive', 'denied', 'unknown'] as const)('后续start不能丢弃 %s 的旧PID，即使验证标志曾为真', async kind => {
    const fixture = previouslyClosed(true); fixture[kind].add(42); fixture.state.shutdownVerified = true;
    await expect(fixture.state.start()).rejects.toThrow(); expect(fixture.launch).not.toHaveBeenCalled(); expect([...fixture.state.pids]).toEqual([42]);
  });
  it('旧握手和PID重新验证后才到达启动边界，纯探针不真正启动', async () => {
    const { state, launch, poll } = previouslyClosed(true);
    await expect(state.start()).rejects.toThrow('真实 Electron 启动失败'); expect(poll).toHaveBeenCalledOnce(); expect(launch).toHaveBeenCalledOnce(); expect([...state.pids]).toEqual([]);
  });
  it('首次退出失败即使随后PID消失也保持原失败，不能重新启动', async () => {
    const fixture = previouslyClosed(true); fixture.alive.add(42); let first: unknown;
    try { await fixture.state.quit(); } catch (error) { first = error; }
    fixture.alive.clear(); await expect(fixture.state.quit()).rejects.toBe(first); await expect(fixture.state.start()).rejects.toBe(first); expect(fixture.launch).not.toHaveBeenCalled();
  });
  it('首次抛出undefined也必须锁定失败，不能被后续完整状态覆盖', async () => {
    const { state } = previouslyClosed(true); state.closed = false; state.rememberProcesses = async () => { throw undefined; };
    await expect(state.quit()).rejects.toBeUndefined(); state.closed = true;
    await expect(state.quit()).rejects.toBeUndefined(); await expect(state.start()).rejects.toBeUndefined();
  });
  it('dispose可以删除已无进程的本例目录，但不能把缺失握手改判成功', async () => {
    const { state, remove } = previouslyClosed(false);
    await expect(state.dispose()).rejects.toMatchObject({ message: 'C02 原生应用收尾失败', cause: { cause: { message: expect.stringContaining('保存握手') } } }); expect(remove).toHaveBeenCalledOnce(); expect(state.shutdownVerified).toBe(false);
  });
});
