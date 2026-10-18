import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { nativeStartupBaseline as baseline, parseStartupSource, startupAst, startupCounts, startupFunction, runtimeWithoutStartupWire, appInfoWithoutStartupWire, gateWithoutStartupWire } from '../helpers/nativeStartupWireEquivalence';

const runtimeText = readFileSync(new URL('../e2e/editor-indentation-native-runtime.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n'), runtime = parseStartupSource(runtimeText);
const main = parseStartupSource(readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8'));
const gate = parseStartupSource(readFileSync(new URL('../e2e/editor-indentation-native-gate.ts', import.meta.url), 'utf8'));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('9057冻结原文可追溯，去诊断后runtime/Main/原权限门及旧附件AST等价，原37await/55guard保持', () => {
  expect(baseline.revision).toBe('9057178829b892b6e820337e1b8341ba6e548758');
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  expect(hash(baseline.runtime)).toBe('f392369687f9f350ba59aa84031f4cfc2eeea1206bb5a5bd926a3d56946f4bd4'); expect(hash(baseline.appInfo)).toBe('b0749da27ba11a266bc61bcee5805ab322f37bf7723123a804bcca8d955e6425'); expect(hash(baseline.gate)).toBe('55931be4c0344ccb2125b6230d26f05fe5bb70276e63cc8f33e2fde0f8562a6f');
  expect(startupAst(runtimeWithoutStartupWire(startupFunction(runtime, 'createEditorIndentNativeRun').getText(runtime)))).toBe(startupAst(baseline.runtime));
  expect(startupAst('function value(){switch(command){' + appInfoWithoutStartupWire(main) + '}}')).toBe(startupAst('function value(){switch(command){' + baseline.appInfo + '}}'));
  expect(startupAst(gateWithoutStartupWire(startupFunction(gate, 'bindEditorIndentNativeCase').getText(gate)))).toBe(startupAst(baseline.gate));
  expect(startupCounts(runtime)).toEqual({ awaits: 37, guards: 55 }); expect(baseline.fileCounts).toEqual({ awaits: 37, guards: 55 });
  const original = parseStartupSource(baseline.runtime), current = parseStartupSource(startupFunction(runtime, 'createEditorIndentNativeRun').getText(runtime)); expect(startupCounts(current)).toEqual(startupCounts(original));
  for (const [index, name] of ['requireIndentOfflinePort', 'readIndentNativeSettings'].entries()) expect(startupFunction(runtime, name).getText(runtime)).toBe(baseline.otherRuntimeFunctions[index]);
  const attachment = parseStartupSource(readFileSync(new URL('../e2e/editor-native-startup-diagnostics.ts', import.meta.url), 'utf8'));
  const oldBody = startupFunction(parseStartupSource(baseline.originalAttachment), 'attachNativeStartupDiagnostics').body!.getText();
  expect(startupAst(startupFunction(attachment, 'attachOriginalNativeStartupDiagnostics').body!.getText(attachment))).toBe(startupAst(oldBody));
});

it('新观察实现不含RPC、PID探测、退出/强停/清理、流控制或新时钟，Main观察不调用加密API', () => {
  const wire = readFileSync(new URL('../e2e/editor-native-startup-wire.ts', import.meta.url), 'utf8');
  expect(wire).not.toMatch(/\.evaluate\(|\.firstWindow\(|\.kill\(|\.destroy\(|\.end\(|\.close\(|\.resume\(|\.pause\(|\.unpipe\(|setTimeout\(|setInterval\(|Date\.now\(|performance\.now\(|readFile|writeFile|\brm\(/);
  const main = readFileSync(new URL('../../src/main/nativeStartupDiagnostics.ts', import.meta.url), 'utf8');
  expect(main).not.toMatch(/safeStorage\.|\.isEncryptionAvailable\(|\.encryptString\(|\.decryptString\(|\.quit\(|\.kill\(|readFile|writeFile|setTimeout\(|Date\.now\(/);
});

/** 只抽取真正传给原evaluate的回调；原API均是可记录顺序和原错误的RAM端口。 */
function callbacks(text = runtimeText) {
  const tree = parseStartupSource(text), found: Record<string, string> = {};
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'own.application.evaluate' && ts.isArrowFunction(node.arguments[0])) {
      const fn = node.arguments[0], code = fn.getText(tree);
      if (code.includes('app.getAppPath()')) found.source = code;
      else if (code.includes("app.once('will-quit'")) found.hook = code;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree); expect(Object.keys(found).sort()).toEqual(['hook', 'source']); return found;
}
const code = callbacks(), oldCode = callbacks(baseline.runtime);
function callback(source: string, context: object) { return runInNewContext(ts.transpileModule('const call = ' + source + ';call;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context) as Function; }

/** 每个原getter/native边界均可抛同一个原错误；错误后不允许再访问下一项。 */
function sourcePort(failureAt = '', enabled = false, useOld = false) {
  const order: string[] = [], failure = Error('原生边界原异常'), log: number[] = [];
  const step = (name: string, value: any) => { order.push(name); if (name === failureAt) throw failure; return value; };
  const process = Object.defineProperties({}, Object.fromEntries(['execPath','resourcesPath','pid','ppid','platform'].map(name => [name, { get: () => step('process.' + name, name.endsWith('pid') ? 101 : '原值') }])));
  const app = { getAppPath: () => step('app.getAppPath', '原app'), get isPackaged() { return step('app.isPackaged', true); }, getAppMetrics: () => step('app.getAppMetrics', [{ pid: 101 }]) };
  const webContents = { get id() { return step('contents.id', 11); }, getOSProcessId: () => step('contents.getOSProcessId', 202) }, window = { get id() { return step('window.id', 1); }, get webContents() { return step('window.webContents', webContents); } };
  const BrowserWindow = { getAllWindows: () => step('BrowserWindow.getAllWindows', [window]) };
  const call = callback(useOld ? oldCode.source : code.source, { process, console: { log: (text: string) => log.push(Number(text.split(':').at(-1))), error: () => log.push(99) } });
  let result: unknown, error: unknown; try { result = call({ app, BrowserWindow }, enabled); } catch (reason) { error = reason; }
  return { order, log, result: JSON.stringify(result), error, failure };
}

it.each([false, true])('原source属性与native调用的次数/顺序及返回完全一致，诊断=%s仅多固定枚举', enabled => {
  const actual = sourcePort('', enabled), old = sourcePort('', false, true);
  expect(actual.order).toEqual(old.order); expect(actual.result).toBe(old.result); expect(actual.error).toBeUndefined(); expect(actual.log).toEqual(enabled ? [1,2,3,4,5,6,7,8] : []);
});

it.each(['process.execPath','app.getAppPath','process.resourcesPath','app.isPackaged','process.pid','process.ppid','process.platform','app.getAppMetrics','BrowserWindow.getAllWindows','window.id','window.webContents','contents.id','contents.getOSProcessId'])('原source在%s失败时保持同一错误，且不多读/重试后续API', boundary => {
  const actual = sourcePort(boundary, true), old = sourcePort(boundary, false, true);
  expect(actual.error).toBe(actual.failure); expect(old.error).toBe(old.failure); expect(actual.order).toEqual(old.order); expect(actual.order.at(-1)).toBe(boundary);
});

it('原hook的API调用和握手保持；关闭不输出，显式诊断只多20至24固定标记', () => {
  for (const enabled of [false, true]) {
    const oldOrder: string[] = [], order: string[] = [], marks: number[] = [];
    const port = (sink: string[]) => ({ app: { once: (name: string) => sink.push('once:' + name), on: (name: string) => sink.push('on:' + name) }, BrowserWindow: { getAllWindows: () => { sink.push('windows'); return [{ webContents: { on: (name: string) => sink.push('contents:' + name) } }]; } } });
    callback(oldCode.hook, { console: { log() {} } })(port(oldOrder), { marker: '原marker' });
    callback(code.hook, { console: { log: (text: string) => marks.push(Number(text.split(':').at(-1))) } })(port(order), { marker: '原marker', wire: enabled });
    expect(order).toEqual(oldOrder); expect(marks).toEqual(enabled ? [20,21,22,23,24] : []);
  }
});

it.each(['once', 'windows', 'contents', 'on'])('原hook在%s异常时仍抛同一原错，日志双路径抛错也不影响原调用', failureAt => {
  const failure = Error('原hook异常'), order: string[] = [];
  const step = (name: string) => { order.push(name); if (name === failureAt) throw failure; };
  const app = { once: () => step('once'), on: () => step('on') }, BrowserWindow = { getAllWindows: () => { step('windows'); return [{ webContents: { on: () => step('contents') } }]; } };
  const call = callback(code.hook, { console: { log() { throw Error('观察输出错误'); }, error() { throw Error('第二路径错误'); } } });
  let caught: unknown; try { call({ app, BrowserWindow }, { marker: '原marker', wire: true }); } catch (reason) { caught = reason; } expect(caught).toBe(failure); expect(order.at(-1)).toBe(failureAt);
});

/** 真实Main app.info case在RAM执行，不加载Electron；只读getter序列独立核对。 */
function infoCase() { let text = ''; function visit(node: ts.Node) { if (ts.isCaseClause(node) && node.expression.getText(main) === "'app.info'") text = node.statements.map(statement => statement.getText(main)).join('\n'); ts.forEachChild(node, visit); } visit(main); return text; }
it.each(['正常','getVersion','platform','crypto','getPath'])('Main原app.info在%s保持返回/原异常及同步调用次数，标记不接收业务正文', async mode => {
  vi.resetModules(); const { nativeStartupInfoMarker } = await import('../../src/main/nativeStartupDiagnostics');
  for (const [key, value] of Object.entries({ DBARK_NATIVE_EDITOR_MAIN_DIAGNOSTICS: '1', DBARK_NATIVE_EDITOR_PROGRESS: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_EDITOR_INDENT_NATIVE_TEST: '1', DBARK_QUERY_LAYOUT_NATIVE_TEST: '0' })) vi.stubEnv(key, value);
  const order: string[] = [], logs = vi.spyOn(console, 'log').mockImplementation(() => {}), failure = Error('原Main异常');
  const step = (name: string, value: any) => { order.push(name); if (mode === name) throw failure; return value; };
  const context = { nativeStartupInfoMarker, app: { getVersion: () => step('getVersion', '原版本'), getPath: (name: string) => { expect(name).toBe('userData'); return step('getPath', '不应输出的绝对路径'); } }, process: { get platform() { return step('platform', 'darwin'); } }, safeStorage: { isEncryptionAvailable: () => step('crypto', true) } };
  const call = runInNewContext(ts.transpileModule('function info(){' + infoCase() + '} info;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context) as () => unknown;
  if (mode === '正常') { expect(call()).toEqual({ version: '原版本', platform: 'darwin', encryptionAvailable: true, dataPath: '不应输出的绝对路径' }); expect(order).toEqual(['getVersion','platform','crypto','getPath']); expect(logs.mock.calls.map(args => args[0])).toEqual([30,31,32,33].map(code => 'DBARK_STARTUP_V1:' + code)); }
  else { let caught: unknown; try { call(); } catch (reason) { caught = reason; } expect(caught).toBe(failure); expect(order).toEqual(['getVersion','platform','crypto','getPath'].slice(0, ['getVersion','platform','crypto','getPath'].indexOf(mode) + 1)); }
  expect(JSON.stringify(logs.mock.calls)).not.toMatch(/原版本|darwin|绝对路径|原Main异常/);
});

it('Main默认/列表/非离线/双专项拒绝输出，显式上限32且日志失败不能替换原值或原错', async () => {
  vi.resetModules(); const { nativeStartupInfoMarker: mark } = await import('../../src/main/nativeStartupDiagnostics'); const logs = vi.spyOn(console, 'log').mockImplementation(() => {}), errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const base = { DBARK_NATIVE_EDITOR_MAIN_DIAGNOSTICS: '1', DBARK_NATIVE_EDITOR_PROGRESS: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_EDITOR_INDENT_NATIVE_TEST: '1', DBARK_QUERY_LAYOUT_NATIVE_TEST: '0' };
  for (const patch of [{ DBARK_NATIVE_EDITOR_MAIN_DIAGNOSTICS: undefined }, { DBARK_NATIVE_EDITOR_PROGRESS: '0' }, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_QUERY_LAYOUT_NATIVE_TEST: '1' }]) { for (const [key, value] of Object.entries({ ...base, ...patch })) vi.stubEnv(key, value); mark(30); }
  expect(logs).not.toHaveBeenCalled(); for (const [key, value] of Object.entries(base)) vi.stubEnv(key, value);
  for (const invalid of ['SELECT 密码', 0, 29, 99, 30.5]) mark(invalid as any); expect(logs).not.toHaveBeenCalled();
  logs.mockImplementationOnce(() => { throw Error('日志原失败'); }); mark(30); expect(errors).toHaveBeenCalledWith('DBARK_STARTUP_V1:99');
  for (let index = 0; index < 100; index++) mark(33); expect(logs).toHaveBeenCalledTimes(32);
});

it('Main默认和list原文在RAM证明零输出；日志双路径失败仍保留app.info原值和原错误对象', async () => {
  const source = parseStartupSource(readFileSync(new URL('../../src/main/nativeStartupDiagnostics.ts', import.meta.url), 'utf8')), fn = startupFunction(source, 'nativeStartupInfoMarker');
  const text = ts.transpileModule(fn.getText(source).replace(/^export /, '') + '\nnativeStartupInfoMarker;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const forbidden = () => { throw Error('关闭模式不许输出'); };
  for (const argv of [[], ['--list'], ['--list=true']]) {
    const env = argv.length ? new Proxy({}, { get() { throw Error('list连环境也不读取'); } }) : {};
    runInNewContext(text, { process: { argv, env }, console: { log: forbidden, error: forbidden }, written: 0 })(30);
  }
  vi.resetModules(); const { nativeStartupInfoMarker } = await import('../../src/main/nativeStartupDiagnostics');
  for (const [key, value] of Object.entries({ DBARK_NATIVE_EDITOR_MAIN_DIAGNOSTICS: '1', DBARK_NATIVE_EDITOR_PROGRESS: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_EDITOR_INDENT_NATIVE_TEST: '1', DBARK_QUERY_LAYOUT_NATIVE_TEST: '0' })) vi.stubEnv(key, value);
  vi.spyOn(console, 'log').mockImplementation(() => { throw Error('日志错误'); }); vi.spyOn(console, 'error').mockImplementation(() => { throw Error('第二日志错误'); });
  const failure = Error('原safeStorage错误'); let fail = false;
  const call = runInNewContext(ts.transpileModule('function info(){' + infoCase() + '} info;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { nativeStartupInfoMarker, app: { getVersion: () => 'v', getPath: () => 'p' }, process: { platform: 'darwin' }, safeStorage: { isEncryptionAvailable() { if (fail) throw failure; return true; } } }) as () => unknown;
  expect(call()).toEqual({ version: 'v', platform: 'darwin', encryptionAvailable: true, dataPath: 'p' }); fail = true; let caught: unknown; try { call(); } catch (reason) { caught = reason; } expect(caught).toBe(failure);
});

it.each([
  ['期限', "timeout: 15000", "timeout: 15001"],
  ['调用次数', 'const metrics = app.getAppMetrics().map(value => value.pid);', 'const metrics = app.getAppMetrics().map(value => value.pid); app.getAppMetrics();'],
  ['权限', 'if (run.retained || run.removed', 'if (false || run.removed'],
])('%s发生非观察变化时去诊断证明拒绝，不能凭计数相同放行', (_label, before, after) => {
  const original = startupFunction(runtime, 'createEditorIndentNativeRun').getText(runtime); expect(original).toContain(before);
  expect(() => { const restored = runtimeWithoutStartupWire(original.replace(before, after)); expect(startupAst(restored)).toBe(startupAst(baseline.runtime)); }).toThrow();
});
