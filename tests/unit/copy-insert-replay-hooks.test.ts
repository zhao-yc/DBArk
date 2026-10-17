import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { cleanupD02Copy } from '../integration/helpers/d02-copy-source-policy';

/** 运行固定集成文件原钩子；仅把真实模块/连接边界替换为RAM，绝不连接服务器。 */
function fixture() {
  let before!: () => Promise<void>, after!: (context: unknown) => Promise<void>, resolveClose!: () => void;
  const closePending = new Promise<void>(resolve => { resolveClose = resolve; });
  let now = 0;
  const profile = vi.fn(() => { throw Error('已进入下一模式配置准备'); });
  const context = createContext({ exports: {}, process: { argv: [], env: {} }, Error, Buffer, Date: { now: () => now }, closePending, require(name: string) {
    if (name === 'vitest') return { beforeEach: (fn: typeof before) => { before = fn; }, afterEach: (fn: typeof after) => { after = fn; }, describe: { skipIf: () => (_name: string, body: () => void) => body() }, expect, it: () => {}, vi: { hoisted: (fn: () => unknown) => fn(), mock: () => {}, waitFor: vi.waitFor } };
    if (name === '../helpers/copyInsertReplayPolicy') return { copyInsertReplayEnabled: () => true, copyInsertReplayProfile: profile, copyInsertReplayModes: [{ name: '模式一' }, { name: '模式二' }] };
    if (name === './helpers/d02-copy-source-policy') return { cleanupD02Copy };
    throw Error('反例拒绝加载外部模块：' + name);
  } });
  const source = readFileSync(new URL('../integration/engine-copy-insert-replay.integration.test.ts', import.meta.url), 'utf8');
  runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  runInContext("caseActive=true;databaseState='confirmed';database='dbark_colperm_0123456789ab';engine={closeAll:()=>closePending};observer=undefined;", context);
  return { before, after, profile, resolveClose, context, advance: (milliseconds: number) => { now += milliseconds; } };
}

describe('复制INSERT收尾超时停链回归（仅RAM）', () => {
  it('对照：已知strict关闭失败时确实停链，不进入下一模式配置', async () => {
    const f = fixture(); runInContext("engine={closeAll:async()=>{throw Error('合成原生关闭未知')}};", f.context);
    await expect(f.after({ task: { result: { state: 'pass' } } })).rejects.toThrow();
    await expect(f.before()).rejects.toThrow('前例已失败'); expect(f.profile).not.toHaveBeenCalled();
  });
  it('对照：收尾确实完成后才允许进入下一模式配置', async () => {
    const f = fixture(); runInContext("databaseState='absent';", f.context);
    const cleanup = f.after({ task: { result: { state: 'pass' } } }); await Promise.resolve();
    expect(f.profile).not.toHaveBeenCalled(); f.resolveClose(); await cleanup;
    await expect(f.before()).rejects.toThrow('已进入下一模式配置准备'); expect(f.profile).toHaveBeenCalledTimes(1);
  });
  it('afterEach超时而strict关闭仍活动，第二模式不得重置归属并进入配置准备', async () => {
    const f = fixture(), state = { task: { result: { state: 'pass' } } };
    const cleanup = f.after(state).catch(() => {});
    await Promise.resolve();
    // 模拟Vitest钩子超时：只改变框架状态，原Promise继续等待；不使用计时器或真实睡眠。
    state.task.result.state = 'fail';
    const result = await f.before().catch(reason => reason);
    const entered = f.profile.mock.calls.length;
    f.resolveClose(); await cleanup;
    expect(entered, '原strict关闭未终态，下一模式必须在配置读取和全局状态重置前停链').toBe(0);
    expect(String(result)).toContain('前例已失败');
    await expect(f.before()).rejects.toThrow('前例已失败'); expect(f.profile).not.toHaveBeenCalled();
  });
  it('框架失败标记未发布时，原30秒期限已到也禁止迟到DROP及放行', async () => {
    const f = fixture(), writes = vi.fn(), owns = vi.fn(async () => {});
    Object.assign(f.context, { writes, owns });
    runInContext('assertOwned=owns;sql=writes;identifier=value=>value;', f.context);
    const cleanup = f.after({ task: { result: { state: 'pass' } } }); await Promise.resolve();
    f.advance(30000); f.resolveClose(); await expect(cleanup).rejects.toThrow();
    expect(owns).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    await expect(f.before()).rejects.toThrow('前例已失败'); expect(f.profile).not.toHaveBeenCalled();
  });
  it('收尾等待中下一模式先被拒绝，旧owner和连接集合不重置，迟到成功也不解锁', async () => {
    const f = fixture(); runInContext("databaseState='absent';owner='旧owner';", f.context);
    const state = { task: { result: { state: 'pass' } } }, cleanup = f.after(state).catch(reason => reason); await Promise.resolve();
    await expect(f.before()).rejects.toThrow('前例已失败');
    expect(runInContext('owner', f.context)).toBe('旧owner'); expect(runInContext('database', f.context)).toBe('dbark_colperm_0123456789ab');
    f.resolveClose(); expect(await cleanup).toBeInstanceOf(Error);
    await expect(f.before()).rejects.toThrow('前例已失败'); expect(f.profile).not.toHaveBeenCalled();
  });
  it('归属被异常替换时，迟到收尾只关闭捕获的旧连接，不触及新连接或发DROP', async () => {
    const f = fixture(), oldClose = vi.fn(async () => {}), newClose = vi.fn(async () => {}), newObserverClose = vi.fn(async () => {}), writes = vi.fn();
    Object.assign(f.context, { oldClose, newClose, newObserverClose, writes });
    runInContext("observed.connections.add({close:oldClose});sql=writes;", f.context);
    const cleanup = f.after({ task: { result: { state: 'pass' } } }); await Promise.resolve();
    runInContext("observed.connections.clear();observed.connections.add({close:newClose});observer={close:newObserverClose};database='dbark_colperm_abcdefabcdef';owner='新owner';", f.context);
    f.resolveClose(); await expect(cleanup).rejects.toThrow();
    expect(oldClose).toHaveBeenCalledExactlyOnceWith({ strict: true }); expect(newClose).not.toHaveBeenCalled(); expect(newObserverClose).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    await expect(f.before()).rejects.toThrow('前例已失败'); expect(f.profile).not.toHaveBeenCalled();
  });
});
