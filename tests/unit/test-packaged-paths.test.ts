import { readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../scripts/test-packaged.mjs', import.meta.url), 'utf8');
const tree = ts.createSourceFile('test-packaged.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const installers = tree.statements.filter(node => ts.isFunctionDeclaration(node) && ['installWindows', 'installMac'].includes(node.name?.text ?? ''));
const execution = tree.statements.find(ts.isTryStatement);
if (installers.length !== 2 || !execution) throw new Error('缺少实际安装路径构造或安装测试执行块');
const probe = ts.transpileModule(installers.map(node => node.getText(tree)).join('\n') + '\n' + execution.tryBlock.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

const cases = [
  { platform: 'win32', arch: 'x64', directory: 'C:\\隔离目录\\应用 安装\\Applications', executable: 'C:\\隔离目录\\应用 安装\\Applications\\DBArk.exe' },
  { platform: 'darwin', arch: 'x64', directory: '/private/tmp/回归 空间/intel/Applications', executable: '/private/tmp/回归 空间/intel/Applications/DBArk.app/Contents/MacOS/DBArk' },
  { platform: 'darwin', arch: 'arm64', directory: '/private/tmp/回归 空间/arm/Applications', executable: '/private/tmp/回归 空间/arm/Applications/DBArk.app/Contents/MacOS/DBArk' },
] as const;

/** 运行实际安装函数和测试执行块；文件检查、安装命令与Playwright均为受控端口，不安装或启动程序。 */
function runProbe(input: typeof cases[number], executableExists = true) {
  const path = input.platform === 'win32' ? win32 : posix;
  const inherited = Object.freeze({
    PATH: '保留原路径', LANG: 'zh_CN.UTF-8', KEEP_FIXTURE: '保留自定义环境',
    DBARK_EXECUTABLE_PATH: '继承的错误普通程序', DBARK_C02_EXECUTABLE_PATH: '继承的错误专用程序',
    DBARK_C02_SSH_UI_ENABLED: '1', DBARK_INTEGRATION_ENABLED: '1', DBARK_DEV_URL: 'http://虚构开发地址',
  });
  const project = path.join(path.dirname(input.directory), '源码项目');
  const node = path.join(path.dirname(input.directory), '运行环境', input.platform === 'win32' ? 'node.exe' : 'node');
  const command = vi.fn((_executable: string, _args: string[], _options?: { env?: Record<string, string>; timeout?: number; windowsVerbatimArguments?: boolean }) => '');
  const owned: string[] = [];
  const execute = () => runInNewContext(probe, {
    platform: input.platform, process: { arch: input.arch, env: inherited, execPath: node },
    project, artifact: path.join(project, input.platform === 'win32' ? '安装程序.exe' : '安装映像.dmg'),
    applicationDirectory: input.directory, mountDirectory: path.join(path.dirname(input.directory), '只读挂载'),
    installAttempted: false, join: path.join, basename: path.basename, command,
    assertOwnedPath: (target: string) => { owned.push(target); },
    existsSync: (target: string) => executableExists && target === input.executable,
    mkdirSync: vi.fn(), console: { log: vi.fn() },
  }, { timeout: 1000 });
  return { execute, command, inherited, project, node, owned };
}

describe('真实安装执行器统一普通及C02可执行路径', () => {
  it.each(cases)('$platform/$arch将安装所得准确路径覆盖两个继承值，保留原环境及离线门', input => {
    const f = runProbe(input); f.execute();
    const invocation = f.command.mock.calls.find(([executable]) => executable === f.node);
    expect(invocation).toBeDefined();
    const [, args, options] = invocation!;
    expect(args).toEqual([input.platform === 'win32' ? win32.join(f.project, 'node_modules', '@playwright', 'test', 'cli.js') : posix.join(f.project, 'node_modules', '@playwright', 'test', 'cli.js'), 'test']);
    expect(options?.env).toEqual({
      ...f.inherited,
      DBARK_EXECUTABLE_PATH: input.executable, DBARK_C02_EXECUTABLE_PATH: input.executable,
      DBARK_INTEGRATION_ENABLED: '0', DBARK_DEV_URL: undefined,
    });
    expect(Object.hasOwn(options!.env!, 'DBARK_DEV_URL')).toBe(false);
    expect(options?.timeout).toBe(900000);
    expect(f.inherited.DBARK_EXECUTABLE_PATH).toBe('继承的错误普通程序');
    expect(f.inherited.DBARK_C02_EXECUTABLE_PATH).toBe('继承的错误专用程序');
    expect(f.inherited.DBARK_DEV_URL).toBe('http://虚构开发地址');
    expect(f.owned).toContain(input.executable);
  });
  it('安装所得程序不存在时拒绝启动测试，不回退到继承的两种路径', () => {
    const f = runProbe(cases[0], false);
    expect(f.execute).toThrow('安装产物中缺少 DBArk 可执行文件');
    expect(f.command.mock.calls.some(([executable]) => executable === f.node)).toBe(false);
  });
});
