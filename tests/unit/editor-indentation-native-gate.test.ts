import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as gate from '../e2e/editor-indentation-native-gate';
const source = readFileSync(new URL('../e2e/editor-indentation-native.spec.ts', import.meta.url), 'utf8');
const allowed = () => ({ DBARK_EDITOR_INDENT_NATIVE_TEST: '1', DBARK_INTEGRATION_ENABLED: '0' });
/** 原spec整段声明真实运行；测试回调只登记，所有原生模块均为会失败的哨兵。 */
function declare(env: NodeJS.ProcessEnv, args: string[]) {
  const callbacks: Array<(value: any, info: any) => Promise<void>> = [], skipped: unknown[][] = [], uses: any[] = [], configs: any[] = [], create = vi.fn(() => { throw Error('禁止启动桌面'); });
  const test = Object.assign((_title: string, callback: (value: any, info: any) => Promise<void>) => callbacks.push(callback), { skip: (...value: unknown[]) => skipped.push(value), use: (value: any) => uses.push(value), describe: { configure: (value: any) => configs.push(value) } });
  const require = vi.fn((name: string) => {
    if (name === '@playwright/test') return { test, expect };
    if (name === './editor-indentation-native-gate') return gate;
    if (name === './editor-indentation-native-runtime') return { createEditorIndentNativeRun: create };
    if (name.includes('/locales/')) return {};
    throw Error('声明阶段禁止加载原生模块：' + name);
  });
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: {}, require, process: { env, argv: args, platform: 'win32' } });
  return { callbacks, skipped, uses, configs, create, modules: require.mock.calls.map(call => call[0]) };
}
describe('缩进原生默认门及列表声明（零原生启动）', () => {
  it('默认关闭及启用门的list都只登记一例，脏环境不能触发runtime、端口或目录', () => {
    for (const [env, args] of [[{ DBARK_TEST_PASSWORD: '禁止读取哨兵' }, []], [{ ...allowed(), DBARK_DEV_URL: '禁止访问.invalid' }, ['--list']], [{ ...allowed(), DBARK_INTEGRATION_ENABLED: '1' }, ['--list=true']]] as [NodeJS.ProcessEnv, string[]][]) {
      const value = declare(env, args); expect(value.callbacks).toHaveLength(1); expect(value.skipped[0][0]).toBe(true); expect(value.modules.some(name => /runtime|owner|desktop-fixture|node:net|node:fs/.test(name))).toBe(false); expect(value.create).not.toHaveBeenCalled(); expect(value.uses).toEqual([{ trace: 'off', screenshot: 'off', video: 'off' }]); expect(value.configs).toEqual([{ mode: 'serial', retries: 0, timeout: 120000 }]);
    }
  });
  it('严格离线门在runtime加载前拒绝错误integration、大小写别名和私有配置', () => {
    for (const value of [undefined, '', '1', 'false']) expect(() => declare({ ...allowed(), DBARK_INTEGRATION_ENABLED: value }, [])).toThrow('integration=0');
    for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'DBARK_TEST_HOST', 'DBARK_TEST_PASSWORD', 'DBARK_AUTH_TOKEN', 'DBARK_SSH_KEY', 'DBARK_TLS_CA', 'DBARK_C02_HOST', 'dbark_dev_url', 'dbark_test_password']) expect(() => declare({ ...allowed(), [key]: '' }, [])).toThrow();
    expect(() => gate.assertEditorIndentNativeEnvironment(allowed(), [], 'linux')).toThrow('Windows/macOS');
  });
  it('只允许正式安装入口的准确同值绝对路径别名，拒绝其它目录、空值和CLI替换录制/配置', () => {
    const env = { ...allowed(), DBARK_EXECUTABLE_PATH: 'C:/本次安装/DBArk.exe', DBARK_C02_EXECUTABLE_PATH: 'C:/本次安装/DBArk.exe' };
    expect(() => gate.assertEditorIndentNativeEnvironment(env, ['--trace=off'], 'win32')).not.toThrow();
    for (const value of ['', 'DBArk.exe']) expect(() => gate.assertEditorIndentNativeEnvironment({ ...allowed(), DBARK_EXECUTABLE_PATH: value }, [], 'win32')).toThrow();
    expect(() => gate.assertEditorIndentNativeEnvironment({ ...env, DBARK_C02_EXECUTABLE_PATH: 'C:/另一个安装/DBArk.exe' }, [], 'win32')).toThrow();
    for (const args of [['--trace', 'on'], ['--trace'], ['--trace=retain-on-failure'], ['--config', 'other.ts'], ['-cother.ts'], ['--config=other.ts'], ['--debug'], ['--ui']]) expect(() => gate.assertEditorIndentNativeEnvironment(env, args, 'win32')).toThrow();
  });
  it('实际解析的录制选项先于资源创建拒绝，不能只依赖spec默认use', async () => {
    const value = declare(allowed(), []); expect(value.skipped[0][0]).toBe(false);
    for (const options of [{ trace: 'on', screenshot: 'off', video: 'off' }, { trace: 'off', screenshot: 'on', video: 'off' }, { trace: 'off', screenshot: 'off', video: 'on' }]) await expect(value.callbacks[0](options, {})).rejects.toThrow();
    expect(value.create).not.toHaveBeenCalled();
  });
  it('环境/EXE漂移观察后返回旧值也不能复活原绑定', () => {
    const env: NodeJS.ProcessEnv = allowed(), binding = gate.bindEditorIndentNativeEnvironment(() => ({ env, args: [], platform: 'win32' }));
    binding.assertCurrent(); env.DBARK_EXECUTABLE_PATH = 'C:/另一个候选/DBArk.exe'; expect(() => binding.assertCurrent()).toThrow('漂移'); delete env.DBARK_EXECUTABLE_PATH; expect(() => binding.assertCurrent()).toThrow('已失效');
  });
  it('实际用例只有只读IPC和Monaco观察，不接自动夹具强停、不写store/模型或CI新门', () => {
    const tree = ts.createSourceFile('spec.ts', source, ts.ScriptTarget.Latest, true), commands: string[] = [];
    function visit(node: ts.Node) { if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'invoke') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); commands.push((node.arguments[0] as ts.StringLiteral).text); } ts.forEachChild(node, visit); } visit(tree);
    expect(commands.sort()).toEqual(['history.list', 'queries.list', 'settings.get', 'tasks.list']);
    expect(source).not.toMatch(/desktop-fixture|live-helpers|\.setValue\(|\.setModel\(|\.updateOptions\(|\.setSelections?\(|\.executeEdits\(|setState\(|\.screenshot\(|query\.execute|clipboard\./);
    for (const path of ['../../.github/workflows/ci.yml', '../../scripts/test-packaged.mjs']) expect(readFileSync(new URL(path, import.meta.url), 'utf8')).not.toContain('DBARK_EDITOR_INDENT_NATIVE_TEST');
  });
});
