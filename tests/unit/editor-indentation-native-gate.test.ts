import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as gate from '../e2e/editor-indentation-native-gate';
import { EditorIndentNativeRun, type IndentNativePort, type IndentNativeOwner } from '../e2e/editor-indentation-native-owner';
const source = readFileSync(new URL('../e2e/editor-indentation-native.spec.ts', import.meta.url), 'utf8');
const allowed = () => ({ DBARK_EDITOR_INDENT_NATIVE_TEST: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_EDITOR_INDENT_MANIFEST: 'C:/RAM-approval.json', DBARK_EDITOR_INDENT_MANIFEST_SHA256: 'a'.repeat(64) });
/** 原spec整段声明真实运行；测试回调只登记，所有原生模块均为会失败的哨兵。 */
function declare(env: NodeJS.ProcessEnv, args: string[]) {
  const callbacks: Array<(value: any, info: any) => Promise<void>> = [], skipped: unknown[][] = [], uses: any[] = [], configs: any[] = [], create = vi.fn(() => { throw Error('禁止启动桌面'); });
  const test = Object.assign((_title: string, callback: (value: any, info: any) => Promise<void>) => callbacks.push(callback), { afterEach: vi.fn(), info: vi.fn(), skip: (...value: unknown[]) => skipped.push(value), use: (value: any) => uses.push(value), describe: { configure: (value: any) => configs.push(value) } });
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

describe('修复复核：原spec期限/afterEach及独审UI断言缺口', () => {
  it('真实锁定TestInfo的原_startWallTime可用；缺原起点或到原deadline均不能用now重签', () => {
    let now = 1; const info = { _startWallTime: 0, timeout: 120000, status: 'passed' }, scope = gate.bindEditorIndentNativeCase(info, { assertCurrent() {} }, () => info, () => now);
    expect(() => scope.assertCurrent()).not.toThrow(); now = 120000; expect(() => scope.assertCurrent()).toThrow('期限已失效'); now = 1; expect(() => scope.assertCurrent()).toThrow();
    const missing = { timeout: 120000, status: 'passed' }; expect(() => gate.bindEditorIndentNativeCase(missing, { assertCurrent() {} }, () => missing, () => 1).assertCurrent()).toThrow();
  });
  it.each(['timedOut', 'deadline', 'afterEach', 'differentInfo', 'extended', 'normal'] as const)('原预检await期间%s后不得迟到领取目录或启动', async mode => {
    let release!: () => void, entered!: () => void; const waiting = new Promise<void>(yes => { release = yes; }), started = new Promise<void>(yes => { entered = yes; }), stop = Error('RAM准备停止');
    const port: IndentNativePort = { assertCurrent() {}, preflight: async () => { entered(); await waiting; }, directory: vi.fn(async () => '/RAM/dbark-indent-owned'), assertDirectory: async () => {}, launch: vi.fn(async () => ({ application: {}, page: {}, ids: new Set(), closed: false, confirmed: false, ready: false, errors: [], quitReady: Promise.resolve() }) as unknown as IndentNativeOwner), prepare: async () => { throw stop; }, record: async () => [101], quit: async () => {}, absent: async () => {}, remove: async () => {} };
    const run = new EditorIndentNativeRun(port), originalStart = new Date(0), info = { startTime: originalStart, timeout: 120000, status: 'passed', attach: vi.fn(async () => {}) }; let actualInfo = info, now = 0, callback!: (input: object, info: typeof actualInfo) => Promise<void>, hook!: (input: object, info: typeof actualInfo) => void;
    const test = Object.assign((_title: string, body: typeof callback) => { callback = body; }, { skip() {}, use() {}, describe: { configure() {} }, afterEach: (body: typeof hook) => { hook = body; }, info: () => actualInfo });
    const require = (name: string) => {
      if (name === '@playwright/test') return { test, expect };
      if (name === './editor-indentation-native-gate') return { ...gate, bindEditorIndentNativeCase: (value: gate.IndentNativeTestInfo, environment: { assertCurrent(): void }, current: () => gate.IndentNativeTestInfo) => gate.bindEditorIndentNativeCase(value, environment, current, () => now) };
      if (name === './editor-indentation-native-runtime') return { createEditorIndentNativeRun: (scope: { assertCurrent(): void }) => { port.assertCurrent = () => scope.assertCurrent(); return run; } };
      if (name.includes('/locales/')) return {}; throw Error('禁止原生模块');
    };
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: {}, require, process: { env: allowed(), argv: [], platform: 'win32' }, Buffer, AggregateError });
    const pending = callback({ trace: 'off', screenshot: 'off', video: 'off' }, info).catch(error => error); await started;
    if (mode === 'timedOut') { now = 120001; info.status = 'timedOut'; }
    if (mode === 'deadline') now = 120001;
    if (mode === 'afterEach') hook({}, info);
    if (mode === 'differentInfo') actualInfo = { ...info };
    if (mode === 'extended') info.timeout = 240000;
    release(); const result = await pending; expect(info.startTime).toBe(originalStart);
    if (mode === 'normal') { expect(result).toBe(stop); expect(port.launch).toHaveBeenCalledOnce(); }
    else { expect(result).not.toBe(stop); expect(result.message).toContain('原TestInfo/期限已失效'); expect(port.directory).not.toHaveBeenCalled(); expect(port.launch).not.toHaveBeenCalled(); }
  });
  it('新查询和独立重启的原断言明确拒绝detectIndentation=true，正确四项仍可通过', () => {
    const tree = ts.createSourceFile('spec.ts', source, ts.ScriptTarget.Latest, true); let fresh = '', restart = '';
    function visit(node: ts.Node) { if (ts.isCallExpression(node)) { const text = node.getText(tree); if (text.startsWith('expect(fresh).toMatchObject(')) fresh = text; if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'toEqual' && text.startsWith('expect(restarted.map(value => [value.tabSize')) restart = text; } ts.forEachChild(node, visit); } visit(tree); expect(fresh && restart).toBeTruthy();
    const execute = (expression: string, input: object) => runInNewContext(ts.transpileModule(expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { expect, ...input });
    for (const detect of [true, false]) {
      const value = { fresh: { tabSize: 4, indentSize: 4, insertSpaces: true, detectIndentation: detect }, restarted: Array.from({ length: 2 }, () => ({ tabSize: 8, indentSize: 8, insertSpaces: false, readOnly: false, detectIndentation: detect })) };
      if (detect) { expect(() => execute(fresh, value)).toThrow(); expect(() => execute(restart, value)).toThrow(); } else { expect(() => execute(fresh, value)).not.toThrow(); expect(() => execute(restart, value)).not.toThrow(); }
    }
  });
  it('8列热更前建立非空选区，后续真实Undo/Redo在全文替换前各核原正文；坏观测不能通过', async () => {
    const tree = ts.createSourceFile('spec.ts', source, ts.ScriptTarget.Latest, true); let selection = '', undo = '', redo = '';
    function visit(node: ts.Node) { if (ts.isCallExpression(node)) { const text = node.getText(tree); if (text.startsWith('expect(tabSelection.selections?') && text.endsWith('.toBe(true)')) selection = text; if (text === 'expect((await current(run, first)).value).toBe(tabUndone)') undo = text; if (text === 'expect((await current(run, first)).value).toBe(tabAppended)') redo = text; } ts.forEachChild(node, visit); } visit(tree); expect(selection && undo && redo).toBeTruthy();
    const start = source.indexOf('await preference(run, first, 8, false);'), end = source.indexOf('const tabStart', start), phase = source.slice(start, end);
    expect(phase).toContain('keyboard.press(`${modifier}+z`)'); expect(phase).toContain('keyboard.press(redo)'); expect(phase.indexOf('keyboard.press(redo)')).toBeLessThan(phase.indexOf('await write(')); expect(source.slice(source.indexOf('const tabAppended'), start)).toContain("keyboard.press('Shift+ArrowLeft')");
    const execute = (expression: string, input: object) => runInNewContext('(async()=>{' + ts.transpileModule(expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '})()', { expect, run: {}, first: {}, ...input }) as Promise<void>;
    await expect(execute(selection, { tabSelection: { selections: [{ startColumn: 1, endColumn: 1 }] } })).rejects.toThrow(); await execute(selection, { tabSelection: { selections: [{ startColumn: 1, endColumn: 5 }] } });
    for (const [expression, name] of [[undo, 'tabUndone'], [redo, 'tabAppended']]) { await expect(execute(expression, { [name]: '原历史正文', current: async () => ({ value: '历史丢失' }) })).rejects.toThrow(); await execute(expression, { [name]: '原历史正文', current: async () => ({ value: '原历史正文' }) }); }
  });
});
