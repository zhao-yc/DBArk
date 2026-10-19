import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { bindShortcutNativeEnvironment, shortcutNativeActive, shortcutNativeCase } from '../helpers/queryFileShortcutGate';
import { detachShortcutObservation, installShortcutObservation, ShortcutEventLog } from '../helpers/queryFileShortcutObservation';
import { EditorIndentNativeRun } from '../e2e/editor-indentation-native-owner';

/** 只造RAM环境，不读取清单、不构建原生批准、不运行Playwright。 */
function environment() { return { DBARK_QUERY_FILE_SHORTCUT_NATIVE_TEST: '1', DBARK_QUERY_FILE_SHORTCUT_NATIVE_APPROVED: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_QUERY_FILE_SHORTCUT_MANIFEST: 'C:\\future\\approved.json', DBARK_QUERY_FILE_SHORTCUT_MANIFEST_SHA256: 'a'.repeat(64) } as NodeJS.ProcessEnv; }
const declaration = readFileSync(new URL('../e2e/query-file-shortcut-native.spec.ts', import.meta.url), 'utf8');
/** 实际声明源仅注入live哨兵；list参数只在RAM解释，不调用CLI。 */
function declare(env: NodeJS.ProcessEnv, argv: string[]) {
  const modules: string[] = [], skipped: string[] = [], register = vi.fn();
  runInNewContext(ts.transpileModule(declaration, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: {}, process: { env, argv, platform: 'win32' }, require(name: string) { modules.push(name); if (name === '@playwright/test') return { test: { skip: (name: string) => skipped.push(name) } }; if (name === '../helpers/queryFileShortcutGate') return { shortcutNativeActive, bindShortcutNativeEnvironment, shortcutNativeCase }; if (name === './query-file-shortcut-native-live') return { registerShortcutNative: register }; throw Error('未授权模块：' + name); }
  }); return { modules, skipped, register };
}
describe('快捷键独立声明和期限门', () => {
  it.each(['default', 'single', '--list', '--list=true'])('%s只登记一例，零live/清单/应用/端口', mode => {
    const env = mode === 'default' ? {} : environment(); if (mode === 'single') delete env.DBARK_QUERY_FILE_SHORTCUT_NATIVE_APPROVED;
    const value = declare(env, mode.startsWith('--') ? [mode] : []); expect(value.skipped).toEqual([shortcutNativeCase]); expect(value.register).not.toHaveBeenCalled(); expect(value.modules).toEqual(['@playwright/test', '../helpers/queryFileShortcutGate']);
  });
  it('访问器从不执行，双门仅传Root清单参数', () => {
    const getter = vi.fn(() => { throw Error('禁止getter'); }), env = Object.defineProperty({}, 'DBARK_QUERY_FILE_SHORTCUT_NATIVE_TEST', { get: getter }); expect(shortcutNativeActive(env, ['--list'])).toBe(false); expect(shortcutNativeActive(env, [])).toBe(false); expect(getter).not.toHaveBeenCalled();
    const value = declare(environment(), []); expect(value.register).toHaveBeenCalledOnce(); expect(value.register.mock.calls[0][0].approval).toEqual({ manifestPath: environment().DBARK_QUERY_FILE_SHORTCUT_MANIFEST, approvedHash: 'a'.repeat(64) });
  });
  it.each(['credential', 'other-gate', 'alias', 'preload', 'integration', 'manifest', 'trace', 'config', 'platform'])('%s在加载live前拒绝', mode => {
    const env = environment(); let args: string[] = [], platform = 'win32'; if (mode === 'credential') env.DBARK_TEST_PASSWORD = ''; if (mode === 'other-gate') env.DBARK_SQL_FILES_NATIVE_TEST = '1'; if (mode === 'alias') env.dbark_query_file_shortcut_native_test = '1'; if (mode === 'preload') env.NODE_OPTIONS = ''; if (mode === 'integration') env.DBARK_INTEGRATION_ENABLED = '1'; if (mode === 'manifest') delete env.DBARK_QUERY_FILE_SHORTCUT_MANIFEST; if (mode === 'trace') args = ['--trace=on']; if (mode === 'config') args = ['--config=other.ts']; if (mode === 'platform') platform = 'linux';
    expect(() => bindShortcutNativeEnvironment(() => ({ env, args, platform }))).toThrow();
  });
  it('观察到配置漂移后恢复同值仍停链', () => { const env = environment(), gate = bindShortcutNativeEnvironment(() => ({ env, args: [], platform: 'win32' })); gate.assertCurrent(); env.DBARK_QUERY_FILE_SHORTCUT_MANIFEST_SHA256 = 'b'.repeat(64); expect(() => gate.assertCurrent()).toThrow(); env.DBARK_QUERY_FILE_SHORTCUT_MANIFEST_SHA256 = 'a'.repeat(64); expect(() => gate.assertCurrent()).toThrow(); });
});

const view = { documentFocused: true, editorFocused: true, modalCount: 0, visiblePanes: 1, pane: 1, saveDisabled: false, openDisabled: false, editorBusy: false };
const message = (value: unknown, nonce = 'one') => 'DBARK_FILE_SHORTCUT:' + nonce + ':' + JSON.stringify(value);
describe('父进程事件附录只接受有界原owner', () => {
  it('无关日志不读取owner；原事件只存白名单，不执行保存', () => { const current = vi.fn(), log = new ShortcutEventLog('one', current); log.ingest('其他日志'); log.ingest(message({ stage: 'menu', command: 'save-query', view })); expect(current).toHaveBeenCalledOnce(); expect(log.events).toEqual([{ stage: 'menu', command: 'save-query', view }]); });
  it.each(['SQL字段', '任务消息', '未知命令', '非法焦点'])('%s拒绝后不可恢复为继续采集', mode => {
    const log = new ShortcutEventLog('one', () => {}), event: any = { stage: 'before', view: { ...view } }; if (mode === 'SQL字段') event.sql = '不应记录'; if (mode === '任务消息') event.task = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'completed', phase: 'terminal', wrote: 'yes', message: '不应记录' }; if (mode === '未知命令') event.command = 'SELECT'; if (mode === '非法焦点') event.view.documentFocused = 'true';
    expect(() => log.ingest(message(event))).toThrow(); log.ingest(message({ stage: 'before', view })); expect(log.events).toEqual([]);
  });
  it('owner或期限失效后同值恢复不再追加；不调用SDK取证', () => { let valid = true; const log = new ShortcutEventLog('one', () => { if (!valid) throw Error('旧owner'); }); valid = false; expect(() => log.ingest(message({ stage: 'before', view }))).toThrow('旧owner'); valid = true; log.ingest(message({ stage: 'before', view })); expect(log.events).toEqual([]); });
  it('第33条停链，stop后迟到消息不污染已封存附录', () => { const log = new ShortcutEventLog('one', () => {}); for (let i = 0; i < 32; i++) log.ingest(message({ stage: 'before', view })); expect(() => log.ingest(message({ stage: 'before', view }))).toThrow('溢出'); log.stop(); log.ingest(message({ stage: 'menu', command: 'save-query', view })); expect(log.events).toHaveLength(32); });
});

/** 在独立VM执行真正序列化回调；手动事件仅是RAM反例，不能冒充nativeMenu证据。 */
function documentFixture() {
  let now = 1000, menu: ((action: string) => void) | undefined, task: ((event: any) => void) | undefined, key: ((event: any) => void) | undefined, expiry: (() => void) | undefined;
  const records: string[] = [], offMenu = vi.fn(), offTask = vi.fn(), dispatch = vi.fn(() => { throw Error('观察器不得派发'); });
  const pane = { getClientRects: () => [{}], querySelector: (selector: string) => selector.includes('button[') ? { disabled: false } : null };
  const document = { hasFocus: () => true, querySelectorAll: (selector: string) => selector === '.query-tab' ? [pane] : [], addEventListener: (_: string, fn: any) => { key = fn; }, removeEventListener: vi.fn() };
  const window: any = { dbark: { onMenu: (fn: any) => { menu = fn; return offMenu; }, onTask: (fn: any) => { task = fn; return offTask; }, invoke: dispatch }, monaco: { editor: { getEditors: () => [{ hasTextFocus: () => true, getContainerDomNode: () => ({ closest: () => pane }) }] } } };
  const context = { window, document, Date: { now: () => now }, console: { debug: (value: string) => records.push(value) }, setTimeout: (fn: any) => { expiry = fn; return 1; }, clearTimeout: vi.fn() };
  const page = { evaluate: async (fn: Function, choice: object) => runInNewContext('(' + fn.toString() + ')', context)(choice) } as any;
  return { page, window, document, records, offMenu, offTask, dispatch, menu: (action: string) => menu!(action), task: (event: any) => task!(event), key: (event: any) => key!(event), expire() { now = 2000; expiry!(); } };
}
describe('实际页面观察回调零拦截零派发', () => {
  it('keydown与菜单通知只记录一次，无preventDefault/保存/IPC；成功解绑全部订阅', async () => {
    const f = documentFixture(), choice = { nonce: 'one', tabId: 'tab', deadline: 2000 }; expect(await installShortcutObservation(f.page, choice)).toEqual({ nonce: 'one', installed: true });
    const prevented = vi.fn(); f.key({ key: 's', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, repeat: false, isComposing: false, preventDefault: prevented }); f.menu('save-query');
    f.task({ taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'completed', queryFileSource: { tabId: 'tab', operation: 'save', phase: 'terminal', wrote: 'yes' }, message: 'SQL不应输出' });
    expect(await detachShortcutObservation(f.page, choice)).toEqual({ nonce: 'one', detached: true });
    expect(prevented).not.toHaveBeenCalled(); expect(f.dispatch).not.toHaveBeenCalled(); expect(f.offMenu).toHaveBeenCalledOnce(); expect(f.offTask).toHaveBeenCalledOnce(); expect(f.document.removeEventListener).toHaveBeenCalledOnce();
    const log = new ShortcutEventLog('one', () => {}); f.records.forEach(value => log.ingest(value)); expect(log.events.map(event => event.stage)).toEqual(['before', 'keydown', 'menu', 'task', 'detached']); expect(f.records.join('')).not.toContain('SQL不应输出');
  });
  it('忽略其它tab/操作任务及普通按键，其他菜单只记other', async () => { const f = documentFixture(); await installShortcutObservation(f.page, { nonce: 'one', tabId: 'tab', deadline: 2000 }); f.key({ key: 'x', ctrlKey: true }); f.task({ queryFileSource: { tabId: 'other', operation: 'save' } }); f.task({ queryFileSource: { tabId: 'tab', operation: 'open' } }); f.menu('warning:不可记录内容'); expect(f.records).toHaveLength(2); expect(f.records[1]).toContain('"command":"other"'); expect(f.records[1]).not.toContain('不可记录内容'); expect(f.dispatch).not.toHaveBeenCalled(); });
  it('原截止自动本地解绑，迟到通知不发日志，不向未知页面取证', async () => { const f = documentFixture(); await installShortcutObservation(f.page, { nonce: 'one', tabId: 'tab', deadline: 2000 }); f.expire(); f.menu('save-query'); expect(f.records).toHaveLength(1); expect(f.offMenu).toHaveBeenCalledOnce(); expect(f.offTask).toHaveBeenCalledOnce(); expect(f.window.__queryShortcutObservation).toBeUndefined(); expect(f.dispatch).not.toHaveBeenCalled(); });
  it('重复安装和错误nonce不覆盖原订阅，仍可按原nonce解绑', async () => { const f = documentFixture(), choice = { nonce: 'one', tabId: 'tab', deadline: 2000 }; await installShortcutObservation(f.page, choice); await expect(installShortcutObservation(f.page, choice)).rejects.toThrow(); await expect(detachShortcutObservation(f.page, { ...choice, nonce: 'other' })).rejects.toThrow(); expect(f.offMenu).not.toHaveBeenCalled(); expect(await detachShortcutObservation(f.page, choice)).toEqual({ nonce: 'one', detached: true }); });
  it('观察getter或日志通道失败不打断原事件分派，不泄漏异常文字', async () => {
    const f = documentFixture(); await installShortcutObservation(f.page, { nonce: 'one', tabId: 'tab', deadline: 2000 }); f.document.hasFocus = () => { throw Error('不能输出的内容'); }; expect(() => f.menu('save-query')).not.toThrow(); expect(f.records.at(-1)).toContain('"stage":"fault"'); expect(f.records.join('')).not.toContain('不能输出'); const log = new ShortcutEventLog('one', () => {}); expect(() => log.ingest(f.records.at(-1)!)).toThrow(); expect(f.offMenu).toHaveBeenCalledOnce(); expect(f.dispatch).not.toHaveBeenCalled();
    const broken = documentFixture(); await installShortcutObservation(broken.page, { nonce: 'one', tabId: 'tab', deadline: 2000 }); vi.spyOn(broken.records, 'push').mockImplementation(() => { throw Error('日志失效'); }); expect(() => broken.menu('save-query')).not.toThrow(); expect(broken.offMenu).toHaveBeenCalledOnce(); expect(broken.dispatch).not.toHaveBeenCalled();
  });
  it('页面事件溢出通知父进程失败，不能通过观察器异常阻断产品菜单', async () => { const f = documentFixture(); await installShortcutObservation(f.page, { nonce: 'one', tabId: 'tab', deadline: 2000 }); for (let i = 0; i < 32; i++) expect(() => f.menu('save-query')).not.toThrow(); expect(f.records).toHaveLength(33); expect(f.records.at(-1)).toContain('"stage":"fault"'); expect(f.offMenu).toHaveBeenCalledOnce(); expect(f.dispatch).not.toHaveBeenCalled(); });
});

describe('实际用例保留一次按键和父门', () => {
  const live = readFileSync(new URL('../e2e/query-file-shortcut-native-live.ts', import.meta.url), 'utf8');
  it('无按钮fallback/菜单调用/保存IPC/产品handler，完整golden及重启链保留', () => {
    expect(live.match(/keyboard\.press\(process\.platform === 'darwin' \? 'Meta\+s' : 'Control\+s'\)/g)).toHaveLength(1);
    expect(live).not.toMatch(/invoke\('queryFileSources\.save|\.click\(.*save|MenuItem|sendInputEvent|\.setValue\(|\.setEOL\(|\.setModel\(|clipboard|useWorkspace/);
    for (const value of ['timeout: 120000, retries: 0', 'files!.read(path, original)', 'files!.read(path, saved.identity)', 'utf16NativeBytes(savedSql)', 'baseline.binding.ref.revision + 1', 'savedSqlDigest:', 'expect(disk.schema).toBe(9)', 'await run.close(first)', 'await run.close(second)', 'await run.finish()', 'nativeMenuClickObserved: false']) expect(live).toContain(value);
    const failed = live.slice(live.indexOf('} catch (reason) {\n      failure = reason;')); expect(failed).not.toMatch(/\.evaluate\(|\.screenshot\(|readIndentNativeSettings/);
  });
  it('实际offlineQuery首动作迟到后停链，不进入下一表单，不补取观察', async () => {
    const tree = ts.createSourceFile('live.ts', live, ts.ScriptTarget.Latest, true); let body = ''; function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'offlineQuery') body = node.getText(tree); ts.forEachChild(node, visit); } visit(tree); expect(body).not.toBe('');
    let release!: () => void; const held = new Promise<void>(done => { release = done; }), next = vi.fn(() => { throw Error('不得进入下一项'); });
    const owner = { application: {}, page: { locator: () => ({ getByRole: () => ({ click: () => held }) }), getByRole: next }, ids: new Set([1]), closed: false, confirmed: false, ready: false, errors: [], quitReady: Promise.resolve() } as any;
    const forbidden = () => { throw Error('禁止资源'); }, run = new EditorIndentNativeRun({ assertCurrent() {}, preflight: forbidden, directory: forbidden, assertDirectory: forbidden, launch: forbidden, prepare: forbidden, record: forbidden, quit: forbidden, absent: forbidden, remove: forbidden }); run.acquiredOwner(owner);
    const exports: any = {}; runInNewContext(ts.transpileModule(body + ';exports.prepare=offlineQuery;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, zh: { common: { newConnection: '新建连接' } } });
    const pending = exports.prepare(run, owner), rejected = expect(pending).rejects.toThrow(); run.retained = true; release(); await rejected; expect(next).not.toHaveBeenCalled();
  });
});
