import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
function runProbe(input: typeof cases[number], executableExists = true, helperMode: 'normal' | 'missing' | 'symlink' | 'directory' | 'oversize' | 'changed' = 'normal', nativeGate?: string, preflightFails=false) {
  const path = input.platform === 'win32' ? win32 : posix;
  const inherited = Object.freeze({
    PATH: '保留原路径', LANG: 'zh_CN.UTF-8', KEEP_FIXTURE: '保留自定义环境',
    DBARK_EXECUTABLE_PATH: '继承的错误普通程序', DBARK_C02_EXECUTABLE_PATH: '继承的错误专用程序',
    DBARK_C02_SSH_UI_ENABLED: '1', DBARK_INTEGRATION_ENABLED: '1', DBARK_DEV_URL: 'http://虚构开发地址',
    ...(nativeGate === undefined ? {} : { DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST: nativeGate }),
  });
  const project = path.join(path.dirname(input.directory), '源码项目');
  const node = path.join(path.dirname(input.directory), '运行环境', input.platform === 'win32' ? 'node.exe' : 'node');
  const helper = path.join(path.dirname(input.executable), 'resources', 'database-backup-windows', 'databaseBackupWindowsFiles.helper.cs');
  const sourceHelper = path.join(project, 'src/engine/databaseBackupWindowsFiles.helper.cs');
  const sourceBytes = Buffer.from('// 仅RAM公开编译资源\n');
  // 运行真实安装块的资源检查及Node SHA256，只替换固定两文件的RAM读取，不按摘要真假自报结果。
  const stat = vi.fn((target: string) => {
    if (target !== helper) throw Error('越界资源检查');
    if (helperMode === 'missing') throw Object.assign(Error('合成资源不存在'), { code: 'ENOENT' });
    return { isFile: () => helperMode !== 'directory', isSymbolicLink: () => helperMode === 'symlink', size: helperMode === 'oversize' ? 65537 : sourceBytes.length };
  });
  const read = vi.fn((target: string) => {
    if (target === sourceHelper) return sourceBytes;
    if (target === helper) return helperMode === 'changed' ? Buffer.from('// 已被替换的公开资源\n') : sourceBytes;
    throw Error('越界资源读取');
  });
  const command = vi.fn((_executable: string, args: string[], _options?: { env?: Record<string, string>; timeout?: number; windowsVerbatimArguments?: boolean }) => { if(preflightFails && args[0]===path.join(project,'scripts','check-offline-query-port.mjs'))throw Error('合成固定端口预检失败');return ''; });
  const owned: string[] = [];
  // 保留实际安装函数及完整执行块；异步包装仅支持原脚本新增的模式恢复等待。
  const execute = async () => await runInNewContext('(async () => {' + probe + '})()', {
    platform: input.platform, process: { arch: input.arch, env: inherited, execPath: node },
    project, artifact: path.join(project, input.platform === 'win32' ? '安装程序.exe' : '安装映像.dmg'),
    applicationDirectory: input.directory, mountDirectory: path.join(path.dirname(input.directory), '只读挂载'),
    installAttempted: false, join: path.join, basename: path.basename, dirname: path.dirname, command,
    lstatSync: stat, readFileSync: read, createHash,
    assertOwnedPath: (target: string) => { owned.push(target); },
    existsSync: (target: string) => executableExists && target === input.executable,
    mkdirSync: vi.fn(), console: { log: vi.fn() },
  }, { timeout: 1000 });
  return { execute, command, inherited, project, node, owned, helper, sourceHelper, read, stat };
}

describe('真实安装执行器统一普通及C02可执行路径', () => {
  it.each(cases)('$platform/$arch门1才紧邻Playwright执行同一固定预检，仍保留环境归一',async input=>{
    const f=runProbe(input,true,'normal','1');await f.execute();const calls=f.command.mock.calls.filter(([executable])=>executable===f.node),path=input.platform==='win32'?win32:posix;
    expect(calls).toHaveLength(2);expect(calls[0][1]).toEqual([path.join(f.project,'scripts','check-offline-query-port.mjs')]);expect(calls[0][2]?.timeout).toBe(10000);
    expect(calls[1][1]).toEqual([path.join(f.project,'node_modules','@playwright','test','cli.js'),'test']);expect(calls[1][2]?.timeout).toBe(900000);
    for(const call of calls){expect(call[2]?.env).toMatchObject({DBARK_EXECUTABLE_PATH:input.executable,DBARK_C02_EXECUTABLE_PATH:input.executable,DBARK_INTEGRATION_ENABLED:'0',DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST:'1'});expect(Object.hasOwn(call[2]!.env!,'DBARK_DEV_URL')).toBe(false)}
    expect(f.command.mock.calls.indexOf(calls[1])).toBe(f.command.mock.calls.indexOf(calls[0])+1);
  });
  it.each([undefined,'0','','true'])('安装门%s不做预检，仅执行原Playwright路径',async gate=>{
    const f=runProbe(cases[0],true,'normal',gate);await f.execute();expect(f.command.mock.calls.filter(([executable])=>executable===f.node)).toHaveLength(1);
    expect(f.command.mock.calls.some(([,args])=>args[0]?.includes('check-offline-query-port'))).toBe(false);
  });
  it('预检失败明确阻止Playwright启动，不回退或重试',async()=>{
    const f=runProbe(cases[0],true,'normal','1',true);await expect(f.execute()).rejects.toThrow('合成固定端口预检失败');const calls=f.command.mock.calls.filter(([executable])=>executable===f.node);expect(calls).toHaveLength(1);expect(calls[0][1][0]).toContain('check-offline-query-port.mjs');
  });
  it.each(cases)('$platform/$arch将安装所得准确路径覆盖两个继承值，保留原环境及离线门', async input => {
    const f = runProbe(input); await f.execute();
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
    if (input.platform === 'win32') {
      expect(f.owned).toContain(f.helper); expect(f.stat).toHaveBeenCalledWith(f.helper);
      expect(f.read.mock.calls.map(([target]) => target)).toEqual([f.helper, f.sourceHelper]);
    } else { expect(f.stat).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled(); }
  });
  it('安装所得程序不存在时拒绝启动测试，不回退到继承的两种路径', async () => {
    const f = runProbe(cases[0], false);
    await expect(f.execute()).rejects.toThrow('安装产物中缺少 DBArk 可执行文件');
    expect(f.command.mock.calls.some(([executable]) => executable === f.node)).toBe(false);
  });
  it.each(['missing', 'symlink', 'directory', 'oversize', 'changed'] as const)('Windows helper资源%s时拒绝运行测试，不回退到继承路径', async mode => {
    const f = runProbe(cases[0], true, mode);
    await expect(f.execute()).rejects.toThrow(mode === 'missing' ? '合成资源不存在' : mode === 'changed' ? '摘要不一致' : '资源无效');
    expect(f.command.mock.calls.some(([executable]) => executable === f.node)).toBe(false);
    if (mode !== 'changed') expect(f.read).not.toHaveBeenCalled();
  });
});
