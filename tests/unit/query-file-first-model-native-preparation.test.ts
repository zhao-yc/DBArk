import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { fileFirstModelActive, bindFileFirstModelEnvironment } from '../helpers/queryFileFirstModelNativeGate';
import { fileFirstModelCases, assertFirstFileInitial, assertFirstFileTransition, type FirstModelObservation } from '../helpers/queryFileFirstModelNative';
import { bindEditorIndentNativeCase } from '../e2e/editor-indentation-native-gate';
import { EditorIndentNativeRun } from '../e2e/editor-indentation-native-owner';
import { planSqlFormatting } from '../../src/renderer/sqlFormatting';
import { queryFileSourceHasChanges, queryFileSourceSqlDigest } from '../../src/shared/queryFileSources';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqlFormattingZh } from '../../src/renderer/locales/sqlFormatting.zh-CN';
import { queryFilesZh } from '../../src/renderer/locales/queryFiles.zh-CN';

const declaration = readFileSync(new URL('../e2e/query-file-first-model-native.spec.ts', import.meta.url), 'utf8');
const live = readFileSync(new URL('../e2e/query-file-first-model-native-live.ts', import.meta.url), 'utf8');
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
/** 合成环境只给门作语法验证；不读取清单、不冒充Root批准。 */
function environment() { return { DBARK_FILE_FIRST_MODEL_NATIVE_TEST: '1', DBARK_FILE_FIRST_MODEL_NATIVE_APPROVED: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_FILE_FIRST_MODEL_MANIFEST: 'C:\\future\\root-approved.json', DBARK_FILE_FIRST_MODEL_MANIFEST_SHA256: 'a'.repeat(64) } as NodeJS.ProcessEnv; }
/** 执行真实声明文本，live只用RAM哨兵；没有运行Playwright或list命令。 */
function declare(env: NodeJS.ProcessEnv, args: string[] = []) {
  const loaded: string[] = [], skipped: string[] = [], register = vi.fn();
  runInNewContext(compile(declaration), { exports: {}, process: { env, argv: args, platform: 'win32' }, require(name: string) {
    loaded.push(name);
    if (name === '@playwright/test') return { test: { skip: (name: string) => skipped.push(name) } };
    if (name === '../helpers/queryFileFirstModelNative') return { fileFirstModelCases };
    if (name === '../helpers/queryFileFirstModelNativeGate') return { fileFirstModelActive, bindFileFirstModelEnvironment };
    if (name === './query-file-first-model-native-live') return { registerFileFirstModelNative: register };
    throw Error('禁止加载：' + name);
  } }); return { loaded, skipped, register };
}
it.each(['默认', '单门', '--list', '--list=true'])('%s只声明四例，不加载live或领取资源', mode => {
  const env = mode === '默认' ? {} : environment(); if (mode === '单门') delete env.DBARK_FILE_FIRST_MODEL_NATIVE_APPROVED;
  const result = declare(env, mode.startsWith('--') ? [mode] : []); expect(result.skipped).toEqual(fileFirstModelCases.map(value => value.title)); expect(result.register).not.toHaveBeenCalled(); expect(result.loaded).not.toContain('./query-file-first-model-native-live');
});
it('默认/list不执行环境访问器；四个case身份和两套独立golden明确', () => {
  const getter = vi.fn(() => { throw Error('禁止访问器'); }), env = Object.defineProperty({}, 'DBARK_FILE_FIRST_MODEL_NATIVE_TEST', { get: getter });
  expect(fileFirstModelActive(env, ['--list'])).toBe(false); expect(fileFirstModelActive(env, [])).toBe(false); expect(getter).not.toHaveBeenCalled();
  expect(new Set(fileFirstModelCases.map(value => value.key)).size).toBe(4); expect(new Set(fileFirstModelCases.map(value => value.title)).size).toBe(4);
  expect(fileFirstModelCases.map(value => [value.eol, value.entry])).toEqual([['\n', 'button'], ['\n', 'shortcut'], ['\r\n', 'button'], ['\r\n', 'shortcut']]);
});
it('双门只传未来批准参数；环境漂移即永久失效，不重签批准', () => {
  const env = environment(), result = declare(env); expect(result.register).toHaveBeenCalledOnce(); const binding = result.register.mock.calls[0][0];
  expect(binding.approval).toEqual({ manifestPath: env.DBARK_FILE_FIRST_MODEL_MANIFEST, approvedHash: 'a'.repeat(64) }); binding.assertCurrent();
  env.DBARK_FILE_FIRST_MODEL_MANIFEST_SHA256 = 'b'.repeat(64); expect(() => binding.assertCurrent()).toThrow(); env.DBARK_FILE_FIRST_MODEL_MANIFEST_SHA256 = 'a'.repeat(64); expect(() => binding.assertCurrent()).toThrow();
});
it.each(['integration', 'manifest', 'hash', 'credential', 'other-gate', 'alias', 'preload', 'accessor', 'config', 'trace', 'screenshot', 'video', 'platform'])('危险/缺失%s在live之前拒绝', mode => {
  const env = environment(); let args: string[] = [], platform = 'win32';
  if (mode === 'integration') env.DBARK_INTEGRATION_ENABLED = '1'; if (mode === 'manifest') delete env.DBARK_FILE_FIRST_MODEL_MANIFEST; if (mode === 'hash') env.DBARK_FILE_FIRST_MODEL_MANIFEST_SHA256 = '未知'; if (mode === 'credential') env.DBARK_TEST_PASSWORD = ''; if (mode === 'other-gate') env.DBARK_FORMAT_EOL_NATIVE_TEST = '0'; if (mode === 'alias') env.dbark_file_first_model_native_test = '1'; if (mode === 'preload') env.NODE_OPTIONS = ''; if (mode === 'accessor') Object.defineProperty(env, 'DBARK_FILE_FIRST_MODEL_MANIFEST', { get: () => { throw Error('禁止访问器'); } }); if (mode === 'config') args = ['--config=other.ts']; if (['trace', 'screenshot', 'video'].includes(mode)) args = ['--' + mode + '=on']; if (mode === 'platform') platform = 'linux';
  expect(() => bindFileFirstModelEnvironment(() => ({ env, args, platform }))).toThrow();
});

/** 版本大于1的合成getter样本，保证准入不依赖无关字面版本；不是Monaco实测。 */
function observation(index = 0): FirstModelObservation {
  const value = fileFirstModelCases[index]; return { editorId: 4, modelId: 7, value: value.source, eol: value.eol, version: 23, alternative: 17, focused: true, selections: [{ start: 0, end: 0, anchor: 0, position: 0 }], options: { tabSize: 2, indentSize: 2, insertSpaces: true, readOnly: false }, events: [], overflow: 0 };
}
it.each(fileFirstModelCases.map((value, index) => ({ value, index })))('$value.key手写完整golden与当前formatter相符，初始23版本可接受且摘要严格', async ({ value, index }) => {
  const before = observation(index); expect(assertFirstFileInitial(value, Buffer.from(value.source), value.source, before).version).toBe(23);
  expect(planSqlFormatting(value.source, 0, value.source.length, value.eol, { tabSize: 2, insertSpaces: true, keywordCase: 'preserve' })?.text).toBe(value.formatted);
  const baseline = { ref: { id: '11111111-1111-4111-8111-111111111111', revision: 3 }, name: '合成.sql', displayPath: '仅RAM', encoding: 'utf8' as const, bom: 'none' as const, eol: value.eol === '\n' ? 'lf' as const : 'crlf' as const, savedSqlDigest: await queryFileSourceSqlDigest(value.source) };
  expect(await queryFileSourceHasChanges(value.source, baseline)).toBe(false); expect(await queryFileSourceHasChanges('x' + value.source, baseline)).toBe(true); expect(await queryFileSourceHasChanges(value.formatted, baseline)).toBe(true);
});
it.each(['磁盘字节', 'Main原文', '模型行尾', '模型正文', '已先编辑', '未知版本', 'readonly'])('首次准入拒绝%s错误，不靠规范化冒充相同', fault => {
  const value = fileFirstModelCases[0], before = observation(); let bytes = Buffer.from(value.source), main = value.source as string;
  if (fault === '磁盘字节') bytes = Buffer.from(value.source + '\n'); if (fault === 'Main原文') main = value.source.replaceAll('\n', '\r\n'); if (fault === '模型行尾') before.eol = '\r\n'; if (fault === '模型正文') before.value = value.source.replaceAll('\n', '\r\n'); if (fault === '已先编辑') before.events.push({ version: 23, eol: '\n', undo: false, redo: false, eolChange: false, flush: false }); if (fault === '未知版本') before.version = 0; if (fault === 'readonly') before.options.readOnly = true;
  expect(() => assertFirstFileInitial(value, bytes, main, before)).toThrow();
});
it.each(['正常', '换model', '事件溢出', '版本不动', '多事件', 'flush', 'EOL-only', 'Undo标志', '选区'])('原过渡判定%s保留身份、真实版本/事件和选区约束', mode => {
  const before = observation(), after = structuredClone(before); after.value = 'x' + before.value; after.version++; after.events.push({ version: after.version, eol: after.eol, undo: false, redo: false, eolChange: false, flush: false }); after.selections = [{ start: 1, end: 1, anchor: 1, position: 1 }];
  if (mode === '换model') after.modelId++; if (mode === '事件溢出') after.overflow++; if (mode === '版本不动') after.version = before.version; if (mode === '多事件') after.events.push({ ...after.events[0] }); if (mode === 'flush') after.events[0].flush = true; if (mode === 'EOL-only') after.events[0].eolChange = true; if (mode === 'Undo标志') after.events[0].undo = true; if (mode === '选区') after.selections[0].anchor = 0;
  const check = () => assertFirstFileTransition(before, after, 'x' + before.value, 'edit', [{ start: 1, end: 1, anchor: 1, position: 1 }]); if (mode === '正常') expect(check).not.toThrow(); else expect(check).toThrow();
});

/** 提取真正的离线准备函数，第一次UI动作晚回后必须由原controller.stop链。 */
it('原准备函数晚回后不能进入第二个UI动作，不新增超时或资源层', async () => {
  const tree = ts.createSourceFile('live.ts', live, ts.ScriptTarget.Latest, true), fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'prepareOfflineQuery')!;
  let release!: () => void; const held = new Promise<void>(done => { release = done; }), second = vi.fn(() => { throw Error('不能再查询表单'); });
  const owner = { application: {}, page: { locator: () => ({ getByRole: () => ({ click: () => held }) }), getByRole: second }, ids: new Set([1]), closed: false, confirmed: false, ready: false, errors: [], quitReady: Promise.resolve() } as any;
  const forbidden = vi.fn(() => { throw Error('禁止资源端口'); }), run = new EditorIndentNativeRun({ assertCurrent() {}, preflight: forbidden, directory: forbidden, assertDirectory: forbidden, launch: forbidden, prepare: forbidden, record: forbidden, quit: forbidden, absent: forbidden, remove: forbidden }); run.acquiredOwner(owner);
  const invoke = runInNewContext(compile(fn.getText(tree)) + '\nprepareOfflineQuery', { zh });
  const pending = invoke(run, owner, 'RAM'), rejected = expect(pending).rejects.toThrow(); run.retained = true; release(); await rejected; expect(second).not.toHaveBeenCalled(); expect(forbidden).not.toHaveBeenCalled();
});
it('每个evaluate至多一个Main RPC，保留120秒/零重试和clean正常退出，无新setter/dirty回答', () => {
  const tree = ts.createSourceFile('live.ts', live, ts.ScriptTarget.Latest, true); let callbacks = 0;
  function visit(node: ts.Node) { if (ts.isCallExpression(node) && node.expression.getText(tree).endsWith('.evaluate') && node.arguments[0]) { let count = 0; function inspect(child: ts.Node) { if (ts.isCallExpression(child) && child.expression.getText(tree) === 'window.dbark.invoke') count++; ts.forEachChild(child, inspect); } inspect(node.arguments[0]); expect(count).toBeLessThanOrEqual(1); callbacks++; } ts.forEachChild(node, visit); } visit(tree); expect(callbacks).toBeGreaterThan(6);
  expect(live).toContain('timeout: 120000, retries: 0'); expect(live).not.toMatch(/\.(?:setValue|setEOL|setModel|setSelection|setSelections|setViewportSize)\s*\(/); expect(live).not.toContain('DirtyExitAnswer'); expect(live).not.toContain('query-format-eol-native'); expect(live).not.toContain('finally');
});

/** 执行真实观察函数，只有官方editor/model getter与事件参数是RAM，不加载Monaco或DOM。 */
function observer() {
  const tree = ts.createSourceFile('live.ts', live, ts.ScriptTarget.Latest, true), fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'model')!;
  const listeners = new Set<(event: any) => void>(); let value: any;
  const current = { getValue: vi.fn(() => fileFirstModelCases[0].source), getEOL: () => '\n', getVersionId: () => 23, getAlternativeVersionId: () => 17, getOptions: () => ({ tabSize: 2, indentSize: 2, insertSpaces: true }), isDisposed: () => false, onDidChangeContent: (listener: (event: any) => void) => { listeners.add(listener); return { dispose() {} }; }, getOffsetAt: (position: { column: number }) => position.column - 1 };
  value = current;
  const editor = { getContainerDomNode: () => ({ isConnected: true, closest: () => true, getClientRects: () => [{}] }), getModel: () => value, getRawOptions: () => ({ readOnly: false }), hasTextFocus: () => true, getSelections: () => [{ getStartPosition: () => ({ lineNumber: 1, column: 1 }), getEndPosition: () => ({ lineNumber: 1, column: 1 }), selectionStartLineNumber: 1, selectionStartColumn: 1, positionLineNumber: 1, positionColumn: 1 }] };
  const invoke = runInNewContext(compile(fn.getText(tree)) + '\nmodel', { window: { monaco: { editor: { getEditors: () => [editor] } } } });
  const owner = { page: { evaluate: async (callback: () => unknown) => callback() }, ids: new Set(), closed: false, confirmed: false } as any;
  const forbidden = () => { throw Error('禁止资源'); }, run = new EditorIndentNativeRun({ assertCurrent() {}, preflight: forbidden, directory: forbidden, assertDirectory: forbidden, launch: forbidden, prepare: forbidden, record: forbidden, quit: forbidden, absent: forbidden, remove: forbidden }); run.acquiredOwner(owner);
  return { read: () => invoke(run, owner) as Promise<FirstModelObservation>, current, replace() { value = { ...current }; }, dispose() { current.isDisposed = () => true; }, event() { for (const listener of listeners) listener({ versionId: 24, eol: '\n', isUndoing: true, isRedoing: false, isEolChange: false, isFlush: false }); }, listeners, run };
}
it('原观察器重复读取保持身份并只订阅一次；事件回调不额外读取模型正文', async () => {
  const f = observer(), before = await f.read(); expect(before.version).toBe(23); expect(f.listeners.size).toBe(1);
  const reads = f.current.getValue.mock.calls.length; f.event(); expect(f.current.getValue).toHaveBeenCalledTimes(reads);
  const after = await f.read(); expect(after.editorId).toBe(before.editorId); expect(after.modelId).toBe(before.modelId); expect(f.listeners.size).toBe(1); expect(after.events).toEqual([{ version: 24, eol: '\n', undo: true, redo: false, eolChange: false, flush: false }]);
});
it.each(['换model', '销毁'])('原观察器%s立即拒绝并保留原controller，不签发新模型身份', async mode => {
  const f = observer(); await f.read(); if (mode === '换model') f.replace(); else f.dispose(); await expect(f.read()).rejects.toThrow(); expect(f.run.retained).toBe(true);
});
it('原观察器事件超过64项明确记录overflow，不能静默当作完整证据', async () => {
  const f = observer(); await f.read(); for (let index = 0; index < 65; index++) f.event(); const after = await f.read(); expect(after.events).toHaveLength(64); expect(after.overflow).toBe(1);
});
it.each(['原对象原字节', '字节变化', '同字节换inode'])('实际checkpoint的%s必须核原创建身份和完整字节，失败后不追加模型观察', async mode => {
  const tree = ts.createSourceFile('live.ts', live, ts.ScriptTarget.Latest, true), fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'checkpoint')!;
  const value = fileFirstModelCases[0], identity = { dev: '1', ino: '2', size: Buffer.byteLength(value.source), hash: '原创建SHA' }, read = vi.fn(async (_path: string, expected: unknown) => { expect(expected).toBe(identity); if (mode === '同字节换inode') throw Error('原对象已变化'); return { identity, bytes: Buffer.from(mode === '字节变化' ? value.source + 'x' : value.source) }; });
  const baseline = { effects: { 已知上下文: 1 }, tab: { sql: value.source }, binding: { ref: { id: '11111111-1111-4111-8111-111111111111', revision: 1 }, name: '原文件', displayPath: 'RAM', encoding: 'utf8', bom: 'none', eol: 'lf', savedSqlDigest: await queryFileSourceSqlDigest(value.source) } };
  const locator: any = { getByRole: () => locator, locator: () => locator, nth: () => locator }, owner = { page: { locator: () => locator }, ids: new Set(), closed: false, confirmed: false } as any;
  const forbidden = () => { throw Error('禁止资源'); }, run = new EditorIndentNativeRun({ assertCurrent() {}, preflight: forbidden, directory: forbidden, assertDirectory: forbidden, launch: forbidden, prepare: forbidden, record: forbidden, quit: forbidden, absent: forbidden, remove: forbidden }); run.acquiredOwner(owner);
  const modelRead = vi.fn(async () => observation()), expectPort = (actual: unknown) => ({ toEqual: (expected: unknown) => expect(actual).toEqual(expected), toBe: (expected: unknown) => expect(actual).toBe(expected), toContainText: () => {}, toHaveCount: () => {} });
  const invoke = runInNewContext(compile(fn.getText(tree)) + '\ncheckpoint', { exact: async () => {}, facts: async () => baseline, model: modelRead, expect: expectPort, queryFileSourceHasChanges, text: queryFilesZh });
  const pending = invoke(run, owner, value, baseline, value.source, false, { files: { read }, path: 'RAM原文件', identity, bytes: Buffer.from(value.source) });
  if (mode === '原对象原字节') { await pending; expect(modelRead).toHaveBeenCalledOnce(); } else { await expect(pending).rejects.toThrow(); expect(modelRead).not.toHaveBeenCalled(); }
  expect(read).toHaveBeenCalledExactlyOnceWith('RAM原文件', identity);
});

/** 全注册函数也只用RAM哨兵；原launch失败时只允许父端内存附录，不得读取未知owner SDK。 */
it.each([false, true])('原失败附件拒绝=%s仍保留首因且零SDK/文件/清理动作', async attachmentFails => {
  const failure = Error('原launch未确认'), forbidden = vi.fn(() => { throw Error('禁止SDK/文件/清理'); });
  const owner = { ids: new Set([7]), confirmed: false, ready: false, closed: false, sourceDiagnostics: [], get application() { return forbidden(); }, get page() { return forbidden(); } };
  const run = { owners: [owner], path: 'RAM父端已知目录', retained: false, removed: false, launch: vi.fn(async () => { throw failure; }), close: forbidden, finish: forbidden, stopped: forbidden };
  const info = { timeout: 120000, _startWallTime: Date.now(), attach: vi.fn(async () => { if (attachmentFails) throw Error('附录失败'); }) }, callbacks: Array<(...args: any[]) => Promise<void>> = [];
  const fakeTest = Object.assign(vi.fn((_name: string, callback: (...args: any[]) => Promise<void>) => callbacks.push(callback)), { use: vi.fn(), describe: { configure: vi.fn() }, afterEach: vi.fn(), info: () => info });
  const env = environment(), binding = bindFileFirstModelEnvironment(() => ({ env, args: [], platform: 'win32' }));
  const exports: any = {};
  runInNewContext(compile(live), { exports, Buffer, process: { platform: 'win32' }, require(name: string) {
    if (name === '@playwright/test') return { test: fakeTest, expect }; if (name === 'node:crypto') return { randomUUID: forbidden, createHash: forbidden };
    if (name === './editor-indentation-native-gate') return { bindEditorIndentNativeCase }; if (name === './editor-indentation-native-runtime') return { createEditorIndentNativeRun: () => run, readIndentNativeSettings: forbidden };
    if (name === '../helpers/queryFileFirstModelNative') return { fileFirstModelCases, assertFirstFileInitial, assertFirstFileTransition };
    if (name === '../helpers/queryFilesNativeFiles') return { QueryFilesNativeFiles: forbidden }; if (name === '../helpers/queryFilesNative') return { installSqlFilesOpenAnswer: forbidden, finishSqlFilesOpenAnswer: forbidden };
    if (name === '../../src/shared/queryFileSources') return { queryFileSourceHasChanges: forbidden }; if (name.endsWith('/zh-CN')) return { zh }; if (name.endsWith('/sqlFormatting.zh-CN')) return { sqlFormattingZh }; if (name.endsWith('/queryFiles.zh-CN')) return { queryFilesZh };
    throw Error('未许可模块：' + name);
  } });
  exports.registerFileFirstModelNative(binding); expect(callbacks).toHaveLength(4); expect(fakeTest.describe.configure).toHaveBeenCalledWith({ mode: 'serial', timeout: 120000, retries: 0 });
  const result = callbacks[0]({ trace: 'off', screenshot: 'off', video: 'off' }, info);
  if (attachmentFails) await expect(result).rejects.toMatchObject({ cause: failure }); else await expect(result).rejects.toBe(failure);
  expect(info.attach).toHaveBeenCalledOnce(); expect(run.retained).toBe(true); expect(forbidden).not.toHaveBeenCalled();
});
