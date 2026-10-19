import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { assertFormatEolInitial, bindFormatEolEnvironment, formatEolActive, formatEolCases, formatEolExpected, formatEolSource, type FormatEolModel } from '../helpers/queryFormatEolNative';
import { planSqlFormatting } from '../../src/renderer/sqlFormatting';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { editorContentBridge } from '../../src/renderer/editorContentBridge';
import { queryFileSourceHasChanges, queryFileSourceSqlDigest } from '../../src/shared/queryFileSources';
import { EditorIndentNativeRun } from '../e2e/editor-indentation-native-owner';
import { ContentEditorPort, ContentModelPort } from './editor-content-test-ports';

/** 只构造RAM环境；清单从不读取，更不能把合成hash当作原生批准。 */
function environment() { return { DBARK_FORMAT_EOL_NATIVE_TEST: '1', DBARK_FORMAT_EOL_NATIVE_APPROVED: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_FORMAT_EOL_MANIFEST: 'C:\\future\\root-approved.json', DBARK_FORMAT_EOL_MANIFEST_SHA256: 'a'.repeat(64) } as NodeJS.ProcessEnv; }
const declaration = readFileSync(new URL('../e2e/query-format-eol-native.spec.ts', import.meta.url), 'utf8');
/** 仅解释实际声明门，live为RAM哨兵；不运行Playwright（含list）或任何原生入口。 */
function declare(env: NodeJS.ProcessEnv, argv: string[]) {
  const modules: string[] = [], skipped: string[] = [], register = vi.fn();
  runInNewContext(ts.transpileModule(declaration, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: {}, process: { env, argv, platform: 'win32' }, require(name: string) { modules.push(name); if (name === '@playwright/test') return { test: { skip: (name: string) => skipped.push(name) } }; if (name === '../helpers/queryFormatEolNative') return { formatEolActive, bindFormatEolEnvironment, formatEolCases }; if (name === './query-format-eol-native-live') return { registerFormatEolNative: register }; throw Error('未许可加载：' + name); }
  }); return { modules, skipped, register };
}
describe('首次格式化原生准备的声明和独立门', () => {
  it.each(['default', 'single', '--list', '--list=true'])('%s声明阶段仅两例，零live/清单/原生/端口', mode => {
    const env = mode === 'default' ? {} : environment(); if (mode === 'single') delete env.DBARK_FORMAT_EOL_NATIVE_APPROVED;
    const value = declare(env, mode.startsWith('--') ? [mode] : []); expect(value.skipped).toEqual([...formatEolCases]); expect(value.register).not.toHaveBeenCalled(); expect(value.modules).toEqual(['@playwright/test', '../helpers/queryFormatEolNative']);
  });
  it('list先于环境检查，门访问器从不执行', () => {
    const getter = vi.fn(() => { throw Error('禁止访问器'); }), env = Object.defineProperty({}, 'DBARK_FORMAT_EOL_NATIVE_TEST', { get: getter }); expect(formatEolActive(env, ['--list'])).toBe(false); expect(formatEolActive(env, [])).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it('双门只传Root未来清单参数，不能生成原生批准', () => { const value = declare(environment(), []); expect(value.register).toHaveBeenCalledOnce(); expect(value.register.mock.calls[0][0].approval).toEqual({ manifestPath: environment().DBARK_FORMAT_EOL_MANIFEST, approvedHash: 'a'.repeat(64) }); });
  it.each(['credential', 'other-gate', 'alias', 'preload', 'integration', 'manifest', 'trace', 'config', 'platform'])('%s在加载live之前拒绝', mode => {
    const env = environment(); let args: string[] = [], platform = 'win32'; if (mode === 'credential') env.DBARK_TEST_PASSWORD = ''; if (mode === 'other-gate') env.DBARK_EDITOR_INDENT_NATIVE_TEST = '0'; if (mode === 'alias') env.dbark_format_eol_native_test = '1'; if (mode === 'preload') env.NODE_OPTIONS = ''; if (mode === 'integration') env.DBARK_INTEGRATION_ENABLED = '1'; if (mode === 'manifest') delete env.DBARK_FORMAT_EOL_MANIFEST; if (mode === 'trace') args = ['--trace=on']; if (mode === 'config') args = ['--config=other.ts']; if (mode === 'platform') platform = 'linux';
    expect(() => bindFormatEolEnvironment(() => ({ env, args, platform }))).toThrow();
  });
  it('配置变化并恢复仍停链，不为新清单续签', () => { const env = environment(), binding = bindFormatEolEnvironment(() => ({ env, args: [], platform: 'win32' })); binding.assertCurrent(); env.DBARK_FORMAT_EOL_MANIFEST_SHA256 = 'b'.repeat(64); expect(() => binding.assertCurrent()).toThrow(); env.DBARK_FORMAT_EOL_MANIFEST_SHA256 = 'a'.repeat(64); expect(() => binding.assertCurrent()).toThrow(); });
});
function model(eol: string): FormatEolModel { return { id: 1, value: formatEolSource.replaceAll('\n', eol), eol, version: 2, changes: 0, focused: true, selections: [{ start: 0, end: 0 }] }; }
describe('首次编辑前的LF/实际EOL证明', () => {
  it('Windows真实CRLF模型与原LF文件/草稿才构成回归差异，不先追平store', () => { expect(assertFormatEolInitial(formatEolSource, formatEolSource, model('\r\n'), 'win32')).toMatchObject({ fileLf: true, draftLf: true, modelEol: '\r\n', mismatched: true, userEditsBeforeFormat: 0 }); });
  it.each(['\n', '\r\n'])('macOS按实际%j判断；LF/LF明确不冒称差异覆盖', eol => { expect(assertFormatEolInitial(formatEolSource, formatEolSource, model(eol), 'darwin').mismatched).toBe(eol === '\r\n'); });
  it.each(['store-aligned', 'query-edited', 'model-edited', 'prior-content-event', 'windows-lf', 'unknown-eol'])('%s必须拒绝首次场景，而不是先补空格/撤销修复前提', mode => {
    const actual = model('\r\n'); let source = formatEolSource, draft = formatEolSource; if (mode === 'store-aligned') draft = actual.value; if (mode === 'query-edited') source += ' '; if (mode === 'model-edited') actual.value += ' '; if (mode === 'prior-content-event') actual.changes = 1; if (mode === 'windows-lf') Object.assign(actual, model('\n')); if (mode === 'unknown-eol') actual.eol = '\r'; expect(() => assertFormatEolInitial(source, draft, actual, 'win32')).toThrow();
  });
  it.each(['\n', '\r\n'])('独立手写黄金值与正式formatter在模型%j上一致，不由输出制造答案', eol => { const source = formatEolSource.replaceAll('\n', eol); expect(planSqlFormatting(source, 0, source.length, eol)?.text).toBe(formatEolExpected.replaceAll('\n', eol)); });
  it('真实live两入口独立case、首次触发前无正文按键，单次Undo及原两owner收尾完整', () => {
    const live = readFileSync(new URL('../e2e/query-format-eol-native-live.ts', import.meta.url), 'utf8'), firstTrigger = live.indexOf('if (entry === 0)'); expect(firstTrigger).toBeGreaterThan(0);
    expect(live.slice(0, firstTrigger)).not.toMatch(/keyboard\.insertText|press\(['"]Space|\+z['"]\)/); expect(live).not.toMatch(/\.setValue\(|\.setEOL\(|\.setModel\(|\.executeEdits\(|clipboard|useWorkspace|desktop-fixture|native-startup|native-editor-progress/);
    for (const value of ['bindEditorIndentNativeCase(info, binding, () => test.info())', 'timeout: 120000', 'createEditorIndentNativeRun(scope, binding.approval)', 'readIndentNativeSettings', 'toBe(9)', 'await closeFileOwner(run, first', 'await closeFileOwner(run, second', 'await run.finish()', 'run.retained = true', 'assertFormatEolInitial(originalAgain.bytes.toString', "keyboard.press('Alt+Shift+f')", 'name: sqlFormattingZh.action', "keyboard.press(modifier + '+z')", 'expect(changed.changes).toBe(1)', 'files!.read(path, fileIdentity)', 'installSqlFilesOpenAnswer', 'consumeSqlFilesDirtyExitAnswer']) expect(live).toContain(value);
    expect(live.indexOf('await closeFileOwner(run, first')).toBeLessThan(live.indexOf('const second = await run.launch()')); expect(live.indexOf('await closeFileOwner(run, second')).toBeLessThan(live.indexOf('await run.finish()'));
  });
});

describe('FEN-1/FEN-2的真实创建链与原门回归', () => {
  it('锁定Monaco原_getEOL证明完整LF新建返回LF；空placeholder采用Win CRLF，原桥异步加载仍无回声', () => {
    const require = createRequire(import.meta.url), source = readFileSync(join(dirname(require.resolve('monaco-editor/package.json')), 'esm/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.js'), 'utf8'), tree = ts.createSourceFile('builder.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS); let method = '';
    function visit(node: ts.Node) { if (ts.isMethodDeclaration(node) && node.name.getText(tree) === '_getEOL') method = node.getText(tree); ts.forEachChild(node, visit); } visit(tree); expect(method).not.toBe('');
    const getEol = runInNewContext('({' + method + '})._getEOL') as (this: object, fallback: number) => string;
    const direct = getEol.call({ _cr: 0, _lf: 1, _crlf: 0 }, 2), empty = getEol.call({ _cr: 0, _lf: 0, _crlf: 0 }, 2); expect(direct).toBe('\n'); expect(empty).toBe('\r\n');
    expect(() => assertFormatEolInitial(formatEolSource, formatEolSource, model(direct), 'win32')).toThrow();
    const original = new ContentModelPort('', empty), editor = new ContentEditorPort(original), change = vi.fn(); let props = { value: '', readOnly: false, onChange: change };
    const bridge = editorContentBridge(editor as any, () => props, () => {}); props = { ...props, value: formatEolSource }; bridge.sync();
    expect(original.getValue()).toBe(formatEolSource.replaceAll('\n', '\r\n')); expect(original.getEOL()).toBe(empty); expect(change).not.toHaveBeenCalled(); expect(editor.setValueCalls).toBe(0); expect(original.controlledEdits).toBe(1); bridge.dispose();
  });
  it('正式文件产品先建空placeholder再await来源RPC，live用此入口且不再创建保存查询', () => {
    const product = readFileSync(new URL('../../src/renderer/useQueryFileSource.ts', import.meta.url), 'utf8'), start = product.indexOf('async function open('), body = product.slice(start, product.indexOf('/** 显式重读', start));
    const stages = ["sql: ''", 'latest.updateSettings({ tabs:', 'await flushSettings()', "await invoke('queryFileSources.open'", 'sql: result.sql'].map(value => body.indexOf(value)); expect(stages.every(value => value >= 0)).toBe(true); expect([...stages].sort((a,b) => a-b)).toEqual(stages);
    const live = readFileSync(new URL('../e2e/query-format-eol-native-live.ts', import.meta.url), 'utf8'); expect(live).toContain('openFileSource(run, first, path)'); expect(live).not.toContain('openSavedSource'); expect(live).not.toContain("invoke('queries.create'"); expect(live).not.toContain("invoke('connections.save'");
  });
  it('每个evaluate最多一条Main RPC，禁止测试在浏览器异步闭包串行写后才回父门', () => {
    const source = readFileSync(new URL('../e2e/query-format-eol-native-live.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('live.ts', source, ts.ScriptTarget.Latest, true); let callbacks = 0;
    function visit(node: ts.Node) { if (ts.isCallExpression(node) && node.expression.getText(tree).endsWith('.evaluate') && node.arguments[0]) { let invocations = 0; function count(value: ts.Node) { if (ts.isCallExpression(value) && value.expression.getText(tree) === 'window.dbark.invoke') invocations++; ts.forEachChild(value, count); } count(node.arguments[0]); expect(invocations).toBeLessThanOrEqual(1); callbacks++; } ts.forEachChild(node, visit); } visit(tree); expect(callbacks).toBeGreaterThan(5);
  });
  it('原prepareOfflineQuery和原run.step在第一次UI动作晚回后停止，不再进入下一项表单动作', async () => {
    const source = readFileSync(new URL('../e2e/query-format-eol-native-live.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('live.ts', source, ts.ScriptTarget.Latest, true); let body = ''; function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'prepareOfflineQuery') body = node.getText(tree); ts.forEachChild(node, visit); } visit(tree); expect(body).not.toBe('');
    let release!: () => void; const held = new Promise<void>(done => { release = done; }), second = vi.fn(() => { throw Error('不应进入第二动作'); }), owner = { application: {}, page: { locator: () => ({ getByRole: () => ({ click: () => held }) }), getByRole: second }, ids: new Set([1]), closed: false, confirmed: false, ready: false, errors: [], quitReady: Promise.resolve() } as any;
    const forbidden = () => { throw Error('禁止资源端口'); }, run = new EditorIndentNativeRun({ assertCurrent() {}, preflight: forbidden, directory: forbidden, assertDirectory: forbidden, launch: forbidden, prepare: forbidden, record: forbidden, quit: forbidden, absent: forbidden, remove: forbidden }); run.acquiredOwner(owner);
    const exports: any = {}; runInNewContext(ts.transpileModule(body + ';exports.prepare=prepareOfflineQuery;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, zh: { common: { newConnection: '新建连接' } } });
    const pending = exports.prepare(run, owner), rejected = expect(pending).rejects.toThrow(); run.retained = true; release(); await rejected; expect(second).not.toHaveBeenCalled();
  });
  it.each(['\n', '\r\n'])('Undo后模型%j按真实文件原摘要决定dirty，不能因逻辑同文冒充clean', async eol => {
    const baseline = { ref: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', revision: 1 }, name: '原LF.sql', displayPath: 'RAM原路径', encoding: 'utf8' as const, bom: 'none' as const, eol: 'lf' as const, savedSqlDigest: await queryFileSourceSqlDigest(formatEolSource) };
    expect(await queryFileSourceHasChanges(formatEolSource.replaceAll('\n', eol), baseline)).toBe(eol === '\r\n');
  });
});
