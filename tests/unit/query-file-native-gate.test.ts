import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import * as gate from '../e2e/query-file-native-gate';
import { bindEditorIndentNativeCase } from '../e2e/editor-indentation-native-gate';
import { EditorIndentNativeRun, type IndentNativePort } from '../e2e/editor-indentation-native-owner';
import { queryFileNativeKeyProtocolHash } from '../e2e/query-file-native-key-protocol';
const source = readFileSync(new URL('../e2e/query-file-native.spec.ts', import.meta.url), 'utf8');
const fixtureSource = readFileSync(new URL('../e2e/query-file-native-fixture.ts', import.meta.url), 'utf8');
const allowed = (): NodeJS.ProcessEnv => ({ DBARK_QUERY_FILE_NATIVE_TEST: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_QUERY_FILE_MANIFEST: 'C:/RAM-approved.json', DBARK_QUERY_FILE_MANIFEST_SHA256: 'a'.repeat(64), DBARK_QUERY_FILE_FIXTURE_SHA256: gate.queryFileNativeRecipeHash(), DBARK_QUERY_FILE_NATIVE_KEYS: 'root-v1', DBARK_QUERY_FILE_NATIVE_KEYS_SHA256: queryFileNativeKeyProtocolHash() });

/** 真spec声明只登记回调；所有runtime/fixture均为RAM哨兵，不加载Electron或执行list。 */
function declaration(env: NodeJS.ProcessEnv, args: string[] = [], create = vi.fn(() => { throw Error('禁止取得真实runtime'); }), info: any = { _startWallTime: 0, timeout: 120000, status: 'passed', attach: vi.fn(async () => {}) }, clock = { now: 0 }) {
  const callbacks: Function[] = [], hooks: Function[] = [], modules: string[] = [], skip = vi.fn(), use = vi.fn(), configure = vi.fn();
  const test = Object.assign((_title: string, body: Function) => callbacks.push(body), { skip, use, afterEach: (fn: Function) => hooks.push(fn), info: () => info, describe: { configure } });
  const load = (name: string) => {
    modules.push(name);
    if (name === '@playwright/test') return { test, expect };
    if (name === './query-file-native-gate') return gate;
    if (name === './editor-indentation-native-gate') return { bindEditorIndentNativeCase: (original: any, environment: any, current: any) => bindEditorIndentNativeCase(original, environment, current, () => clock.now) };
    if (name === './editor-indentation-native-runtime') return { createEditorIndentNativeRun: create };
    if (name === './query-file-native-fixture') return {};
    if (name === './query-file-native-key-bridge') return {};
    if (name.includes('/locales/')) return {};
    throw Error('不允许加载模块：' + name);
  };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports: {}, require: load, process: { env, argv: args, platform: 'win32' }, WeakMap, Buffer, Error, AggregateError });
  return { callbacks, hooks, modules, skip, use, configure, create, info, clock };
}

it('默认关闭及RAM模拟list只登记一例，不读取身份清单或加载原生runtime/fixture', () => {
  for (const [env, args] of [[{ DBARK_TEST_PASSWORD: 'RAM禁止' }, []], [{ ...allowed(), DBARK_DEV_URL: 'RAM禁止' }, ['--list']], [{ ...allowed(), DBARK_INTEGRATION_ENABLED: '1' }, ['--list=true']]] as [NodeJS.ProcessEnv, string[]][]) {
    const value = declaration(env, args); expect(value.callbacks).toHaveLength(1); expect(value.skip.mock.calls[0][0]).toBe(true); expect(value.modules.some(name => /runtime|fixture|owner|node:fs|node:net/.test(name))).toBe(false); expect(value.create).not.toHaveBeenCalled();
    expect(value.use).toHaveBeenCalledWith({ trace: 'off', screenshot: 'off', video: 'off' }); expect(value.configure).toHaveBeenCalledWith({ mode: 'serial', retries: 0, timeout: 120000 });
  }
});
it('独立manifest与固定fixture双审批，拒绝旧门、危险环境、错误平台及CLI替换', () => {
  expect(() => gate.assertQueryFileNativeEnvironment(allowed(), [], 'win32')).not.toThrow(); expect(() => gate.assertQueryFileNativeEnvironment({ ...allowed(), DBARK_QUERY_FILE_MANIFEST: '/RAM/approved.json' }, [], 'darwin')).not.toThrow();
  for (const field of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'DBARK_TEST_HOST', 'DBARK_AUTH_TOKEN', 'DBARK_SSH_KEY', 'DBARK_EDITOR_INDENT_MANIFEST', 'DBARK_QUERY_LAYOUT_MANIFEST', 'dbark_query_file_native_test']) expect(() => gate.assertQueryFileNativeEnvironment({ ...allowed(), [field]: '' }, [], 'win32')).toThrow();
  for (const change of [{ DBARK_QUERY_FILE_FIXTURE_SHA256: 'b'.repeat(64) }, { DBARK_QUERY_FILE_MANIFEST: 'relative.json' }, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_QUERY_LAYOUT_NATIVE_TEST: '1' }, { DBARK_EDITOR_INDENT_NATIVE_TEST: '1' }]) expect(() => gate.assertQueryFileNativeEnvironment({ ...allowed(), ...change }, [], 'win32')).toThrow();
  for (const args of [['--trace', 'on'], ['--trace'], ['--trace=retain-on-failure'], ['--config=other.ts'], ['-cother.ts'], ['--ui'], ['--debug']]) expect(() => gate.assertQueryFileNativeEnvironment(allowed(), args, 'win32')).toThrow();
  expect(() => gate.assertQueryFileNativeEnvironment(allowed(), [], 'linux')).toThrow();
});
it('真实录制参数覆盖在取得原run之前拒绝；配方字节不从当前正文反推', async () => {
  const value = declaration(allowed());
  for (const options of [{ trace: 'on', screenshot: 'off', video: 'off' }, { trace: 'off', screenshot: 'on', video: 'off' }, { trace: 'off', screenshot: 'off', video: 'on' }]) await expect(value.callbacks[0](options, value.info)).rejects.toThrow(); expect(value.create).not.toHaveBeenCalled();
  expect(gate.queryFileNativeBytes('initial').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf])); expect(gate.queryFileNativeBytes('external').toString('utf8')).toContain('外改冲突不得覆盖\r\n'); expect(gate.queryFileNativeRecipe.openSelections).toBe(1); expect(gate.queryFileNativeRecipe.saveSelections).toBe(0);
});
it('环境/批准配方漂移后即使恢复原摘要也不能复活', () => {
  const env = allowed(), scope = gate.bindQueryFileNativeEnvironment(() => ({ env, args: [], platform: 'win32' })); scope.assertCurrent(); env.DBARK_QUERY_FILE_FIXTURE_SHA256 = 'b'.repeat(64); expect(() => scope.assertCurrent()).toThrow(); env.DBARK_QUERY_FILE_FIXTURE_SHA256 = gate.queryFileNativeRecipeHash(); expect(() => scope.assertCurrent()).toThrow('已失效');
});
it.each(['deadline', 'afterEach'] as const)('复用原EditorIndentNativeRun与真实TestInfo，%s停链后不得分配目录或启动', async mode => {
  let entered!: () => void, release!: () => void; const started = new Promise<void>(yes => { entered = yes; }), waiting = new Promise<void>(yes => { release = yes; });
  const port: IndentNativePort = { assertCurrent() {}, preflight: async () => { entered(); await waiting; }, directory: vi.fn(async () => '/RAM/dbark-indent-owned'), assertDirectory: async () => {}, launch: vi.fn(async () => { throw Error('不应启动'); }), prepare: async () => {}, record: async () => [101], quit: async () => {}, absent: async () => {}, remove: vi.fn(async () => {}) };
  const run = new EditorIndentNativeRun(port), create = vi.fn((scope: any, approval: any) => { expect(approval).toEqual({ manifestPath: allowed().DBARK_QUERY_FILE_MANIFEST, approvedHash: allowed().DBARK_QUERY_FILE_MANIFEST_SHA256 }); port.assertCurrent = () => scope.assertCurrent(); return run; }) as any;
  const value = declaration(allowed(), [], create), pending = value.callbacks[0]({ trace: 'off', screenshot: 'off', video: 'off' }, value.info).catch((reason: unknown) => reason); await started;
  if (mode === 'deadline') value.clock.now = 120000; else value.hooks[0]({}, value.info); release(); expect(await pending).toBeInstanceOf(Error); expect(port.directory).not.toHaveBeenCalled(); expect(port.launch).not.toHaveBeenCalled(); expect(port.remove).not.toHaveBeenCalled(); expect(value.info._startWallTime).toBe(0); expect(value.info.timeout).toBe(120000);
});
it('正式spec仅只读IPC和真实键鼠，复用两次正常退出/SQLite9/PID清理，不另造launcher', () => {
  const tree = ts.createSourceFile('spec.ts', source, ts.ScriptTarget.Latest, true), commands: string[] = [];
  function visit(node: ts.Node) { if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'invoke') { expect(ts.isStringLiteral(node.arguments[0])).toBe(true); commands.push((node.arguments[0] as ts.StringLiteral).text); } ts.forEachChild(node, visit); } visit(tree);
  expect(commands.sort()).toEqual(['history.list', 'queries.list', 'settings.get', 'tasks.list']);
  expect(source).not.toMatch(/desktop-fixture|\.setValue\(|\.setModel\(|\.executeEdits\(|\.setSelections?\(|setState\(|clipboard\.|\.screenshot\(|settings\.save|query\.execute|app\.setDirty/);
  expect(source).toContain('runtime!.createEditorIndentNativeRun(scope, approval)'); expect(source).toContain('expect(disk.schema).toBe(9)'); expect(source).toContain('await run.close(first)'); expect(source).toContain('await run.close(second)'); expect(source).toContain('await run.stopped(path => fixture!.cleanup'); expect(source).toContain('await run.finish()');
  expect(fixtureSource).not.toMatch(/electron\.launch|showMessageBox|ipcMain|queryFileSources\.(open|save)|recursive:\s*true/); expect(fixtureSource).toContain('原Main文件命令/IO均照常执行'); expect(fixtureSource).toContain('run.owners.length !== 2'); expect(fixtureSource).toContain('fixture清理缺少两owner正常退出/PID闭合');
});

/** 提取真实选择端口函数，仅Electron dialog/window为RAM；没有文件、进程或OS选择窗口。 */
function selection() {
  const tree = ts.createSourceFile('fixture.ts', fixtureSource, ts.ScriptTarget.Latest, true), fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'installQueryFileNativeDialog')!;
  const window = { id: 7, isDestroyed: () => false }, dialog = { showOpenDialog: vi.fn(async () => ({ canceled: true })), showSaveDialog: vi.fn(async () => ({ canceled: true })) }, old = { ...dialog }, fixture = Object.freeze({ path: 'RAM-private-userdata/fixture.sql', userdata: 'RAM-private-userdata' });
  const owner = { application: { browserWindow: vi.fn(async () => ({ evaluate: async (fn: Function) => fn(window) })), evaluate: vi.fn(async (fn: Function, input: unknown) => fn({ app: { getPath: () => fixture.userdata }, dialog, BrowserWindow: { fromId: () => window } }, input)) }, page: {} };
  const context: any = { exports: {}, fixtureCapabilities: new WeakSet([fixture]), checked: async (guard: Function, action: Function) => { guard(); const result = await action(); guard(); return result; }, Error };
  runInNewContext(ts.transpileModule(fn.getText(tree) + '\nglobalThis.install=installQueryFileNativeDialog;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { owner, dialog, old, fixture, window, install: (value = fixture, count = 1) => context.install(owner, value, () => {}, count), options: { title: '打开SQL文件', properties: ['openFile'], filters: [{ extensions: ['sql'] }] } };
}
it('选择端口仅返回本run创建的准确fixture一次，并恢复原函数且明确不证明OS选择器', async () => {
  const value = selection(); await expect(value.install({ path: value.fixture.path, userdata: value.fixture.userdata })).rejects.toThrow('未由本run创建'); expect(value.owner.application.browserWindow).not.toHaveBeenCalled();
  const restore = await value.install(); expect(await (value.dialog.showOpenDialog as any)(value.window, value.options)).toEqual({ canceled: false, filePaths: [value.fixture.path] });
  expect(await restore()).toEqual({ opens: 1, saves: 0, unexpected: 0, exactFixturePathOnly: true, osNativeSelectorProven: false }); expect(value.dialog.showOpenDialog).toBe(value.old.showOpenDialog); expect(value.dialog.showSaveDialog).toBe(value.old.showSaveDialog);
});
it('第二次选择或任何保存选择均拒绝，不为未知调用补造成功证明', async () => {
  const value = selection(), restore = await value.install(); await (value.dialog.showOpenDialog as any)(value.window, value.options); await expect((value.dialog.showOpenDialog as any)(value.window, value.options)).rejects.toThrow('次数'); await expect(value.dialog.showSaveDialog()).rejects.toThrow('禁止'); await expect(restore()).rejects.toThrow('证明缺失');
});
