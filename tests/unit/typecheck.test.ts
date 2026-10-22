import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 仅通过原执行返回端口观察固定命令；不启动编译器、不改环境或实际堆预算。
const typecheck: any = await import(new URL('../../scripts/typecheck.mjs', import.meta.url).href);
afterEach(() => vi.restoreAllMocks());

describe('共享固定类型检查入口', () => {
  it('纯参数使用绝对编译器路径，每次返回独立数组', () => {
    const project = resolve('.cache', '含空格的合成工程'), original = ['--max-old-space-size=4096', resolve(project, 'node_modules/typescript/bin/tsc'), '--noEmit'];
    expect(typecheck.typecheckArguments(project)).toEqual(original);
    const changed = typecheck.typecheckArguments(project); changed.push('--watch');
    expect(typecheck.typecheckArguments(project)).toEqual(original);
  });
  it('默认仅运行一次原编译器且继承stdout/stderr，不经shell或附加环境', () => {
    const execute = vi.fn(() => ({ status: 0, signal: null })), project = resolve('.');
    expect(typecheck.runTypecheck([], execute)).toBe(0);
    expect(execute.mock.calls).toEqual([[process.execPath, ['--max-old-space-size=4096', resolve(project, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: project, stdio: 'inherit', shell: false, windowsHide: true }]]);
  });
  it.each([
    { result: { status: 7, signal: null }, code: 7 },
    { result: { status: null, signal: 'SIGABRT' }, code: 1 },
    { result: { status: null, signal: null }, code: 1 },
    { result: { status: 0, error: Error('原启动失败') }, code: 1 },
  ])('原返回失败或未知时不吞错或自动重试：$code', ({ result, code }) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const execute = vi.fn(() => result);
    expect(typecheck.runTypecheck([], execute)).toBe(code); expect(execute).toHaveBeenCalledOnce();
  });
  it('额外配置或CLI选项在执行前拒绝，执行端口抛错也返回失败', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const execute = vi.fn(() => { throw Error('原启动端口错误'); });
    for (const args of [['--project', '其它工程'], ['--watch'], ['--max-old-space-size=8192'], ['--help']]) expect(typecheck.runTypecheck(args, execute)).toBe(1);
    expect(execute).not.toHaveBeenCalled(); expect(typecheck.runTypecheck([], execute)).toBe(1); expect(execute).toHaveBeenCalledOnce();
  });
  it('标准typecheck/build使用同一固定入口，构建仍只在类型成功后执行', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts.typecheck).toBe('node scripts/typecheck.mjs');
    expect(pkg.scripts.build).toBe('node scripts/typecheck.mjs && node scripts/build.mjs');
  });
});
