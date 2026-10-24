import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertImportPresetsUiEnvironment, bindImportPresetsUiEnvironment, importPresetsUiFixture, installImportPresetsUiChoice, readImportPresetsUiChoices } from '../helpers/importPresetsUi';

const source = readFileSync(new URL('../e2e/import-presets.spec.ts', import.meta.url), 'utf8');
/** 转译真实spec；所有live、mysql、Electron、engine加载都是会立即报错的RAM哨兵。 */
function fixture(values: NodeJS.ProcessEnv = {}, args: string[] = [], forbidReads = false, active = false) {
  const modules: string[] = [], reads: string[] = [], skip = vi.fn(), register = vi.fn();
  const env = new Proxy(values, { get(target, key: string) { reads.push(key); if (forbidReads || !active && !['DBARK_INTEGRATION_ENABLED', 'DBARK_IMPORT_PRESETS_UI_TEST'].includes(key)) throw Error('默认/list读取了认证或资源配置'); return target[key]; } });
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: {}, process: { env, argv: ['node', 'playwright', ...args], platform: 'win32' },
    require(name: string) { modules.push(name); if (name === '@playwright/test') return { test: { skip } }; if (active && name === '../helpers/importPresetsUi') return { bindImportPresetsUiEnvironment }; if (active && name === './import-presets-live') return { registerImportPresetsUiTests: register }; throw Error('默认/list加载了资源模块：' + name); },
  });
  return { modules, reads, skip, register };
}
/** 只合成RAM值，不读当前进程认证，不打开文件或服务器。 */
function environment(): NodeJS.ProcessEnv {
  return { DBARK_INTEGRATION_ENABLED: '1', DBARK_IMPORT_PRESETS_UI_TEST: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成用户', DBARK_TEST_PASSWORD: '', DBARK_TEST_DATABASE: 'dbark_importpresetsui_' + 'a'.repeat(32), DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001', DBARK_IMPORT_PRESETS_UI_OWNER: 'dbark-import-presets-ui:' + 'b'.repeat(32), DBARK_IMPORT_PRESETS_UI_MANIFEST: 'D:\\isolated\\source.json', DBARK_IMPORT_PRESETS_UI_MANIFEST_SHA256: 'c'.repeat(64), DBARK_IMPORT_PRESETS_UI_OUTPUT: 'D:\\isolated\\output', ...Object.fromEntries(['A', 'BAD', 'B'].flatMap((name, index) => [['DBARK_IMPORT_PRESETS_UI_CSV_' + name, 'D:\\isolated\\source-' + name + '.csv'], ['DBARK_IMPORT_PRESETS_UI_CSV_' + name + '_SHA256', String(index + 1).repeat(64)]])) };
}

describe('导入配置正式窗口默认关闭门（纯RAM）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_IMPORT_PRESETS_UI_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '1', DBARK_IMPORT_PRESETS_UI_TEST: 'true' }])('缺双门只登记跳过且不加载helper：%j', values => { const current = fixture(values); expect(current.skip).toHaveBeenCalledOnce(); expect(current.modules).toEqual(['@playwright/test']); });
  it.each(['list', '--list', '--list=true'])('%s早于全部环境读取和资源加载', flag => { const current = fixture(environment(), [flag], true); expect(current.skip).toHaveBeenCalledOnce(); expect(current.reads).toEqual([]); expect(current.modules).toEqual(['@playwright/test']); });
  it('准确双门仅交付冻结绑定，不执行资源操作', () => { const current = fixture(environment(), ['--trace=off'], false, true); expect(current.skip).not.toHaveBeenCalled(); expect(current.modules).toEqual(['@playwright/test', '../helpers/importPresetsUi', './import-presets-live']); expect(current.register).toHaveBeenCalledOnce(); });
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_IMPORT_PRESETS_UI_OWNER', 'DBARK_IMPORT_PRESETS_UI_MANIFEST', 'DBARK_IMPORT_PRESETS_UI_MANIFEST_SHA256', 'DBARK_IMPORT_PRESETS_UI_OUTPUT', ...['A', 'BAD', 'B'].flatMap(name => ['DBARK_IMPORT_PRESETS_UI_CSV_' + name, 'DBARK_IMPORT_PRESETS_UI_CSV_' + name + '_SHA256'])])('拒绝任意目标或来源值：%s', key => { expect(() => assertImportPresetsUiEnvironment({ ...environment(), [key]: 'other' }, [], 'win32')).toThrow(); });
  it.each(['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'])('替代环境即使空值仍拒绝：%s', key => { expect(() => assertImportPresetsUiEnvironment({ ...environment(), [key]: '' }, [], 'win32')).toThrow(); });
  it.each([['--trace=on'], ['--trace', 'retain-on-failure'], ['--config=other.ts'], ['-cother.ts'], ['--ui'], ['--debug']].map(args => ({ args })))('拒绝CLI绕行：$args', ({ args }) => { expect(() => assertImportPresetsUiEnvironment(environment(), args, 'win32')).toThrow(); });
  it('非Windows、大小写别名均拒绝', () => { expect(() => assertImportPresetsUiEnvironment(environment(), [], 'darwin')).toThrow(); expect(() => assertImportPresetsUiEnvironment({ ...environment(), dbark_test_host: 'other' }, [], 'win32')).toThrow(); });
  it('环境、argv、键存在性漂移后永久停链', () => {
    for (const change of ['port', 'args', 'key'] as const) { const env = environment(), args: string[] = [], binding = bindImportPresetsUiEnvironment(() => ({ env, args, platform: 'win32' })); binding.assertCurrent(); if (change === 'port') env.DBARK_TEST_PORT = '3306'; else if (change === 'args') args.push('--workers=2'); else env.DBARK_IMPORT_PRESETS_UI_EXTRA = ''; expect(() => binding.assertCurrent()).toThrow(); env.DBARK_TEST_PORT = '13384'; args.length = 0; delete env.DBARK_IMPORT_PRESETS_UI_EXTRA; expect(() => binding.assertCurrent()).toThrow(); }
  });
  it('Root三文件计划与纯配置独立保留精度、列差异和原文，不能绑定业务库', () => { const env = environment(), plan = importPresetsUiFixture(env.DBARK_TEST_DATABASE!, env.DBARK_IMPORT_PRESETS_UI_OWNER!); expect(plan.files.a.decoded[0]).toHaveLength(6); expect(plan.files.bad.decoded[0]).toHaveLength(7); expect(plan.files.b.text).toContain('18446744073709551615;9007199254740993.123456789012'); expect(plan.files.b.text).toContain('"中文""B首条""\r\n下一行"'); expect(plan.files.b.decoded[0][4]).toBeNull(); expect(plan.files.b.decoded[0][5]).toBe('\\N'); expect(Object.keys(plan.configuration).sort()).toEqual(['columns', 'csvDelimiter', 'csvHasHeader', 'encoding', 'format', 'mapping']); expect(() => importPresetsUiFixture('business', plan.marker)).toThrow(); });
});

describe('导入配置三次顺序独立Electron选择适配器（纯RAM）', () => {
  afterEach(() => { Reflect.deleteProperty(globalThis, '__importPresetsUiPicker'); });
  const owner = 'dbark-import-presets-ui:' + 'a'.repeat(32), paths = ['D:\\isolated\\a.csv', 'D:\\isolated\\bad.csv', 'D:\\isolated\\b.csv'];
  /** 只提供API函数端口，不运行真实Electron、文件或Main令牌服务。 */
  const port = () => { const original = vi.fn(async (..._args: any[]) => ({ canceled: true, filePaths: [] })), window = { isDestroyed: () => false, webContents: { id: 7 } }; return { dialog: { showOpenDialog: original }, BrowserWindow: { getAllWindows: () => [window] }, window, original }; };
  const options = () => ({ title: '选择文件', properties: ['openFile'], filters: [{ name: 'CSV 文件', extensions: ['csv'] }, { name: '所有文件', extensions: ['*'] }] });
  it('三次分别安装消费并恢复原函数；未消费不能记录或进入下一次', async () => {
    const api = port(); for (const index of [0, 1, 2]) { installImportPresetsUiChoice(api, { owner, senderId: 7, paths, index }); expect(() => readImportPresetsUiChoices(api, { owner, count: index + 1 })).toThrow(); expect(() => installImportPresetsUiChoice(api, { owner, senderId: 7, paths, index: index + 1 })).toThrow(); expect(await api.dialog.showOpenDialog(api.window, options())).toEqual({ canceled: false, filePaths: [paths[index]] }); expect(api.dialog.showOpenDialog).toBe(api.original); expect(readImportPresetsUiChoices(api, { owner, count: index + 1 }).paths).toEqual(paths.slice(0, index + 1)); } expect(api.original).not.toHaveBeenCalled(); expect(() => installImportPresetsUiChoice(api, { owner, senderId: 7, paths, index: 3 })).toThrow();
  });
  it('旧wrapper不能消费后继选择，未知窗口恢复原函数并永久停链', async () => {
    const api = port(); installImportPresetsUiChoice(api, { owner, senderId: 7, paths, index: 0 }); const old = api.dialog.showOpenDialog; await api.dialog.showOpenDialog(api.window, options()); installImportPresetsUiChoice(api, { owner, senderId: 7, paths, index: 1 }); await expect(old(api.window, options())).rejects.toThrow(); await expect(api.dialog.showOpenDialog(api.window, options())).rejects.toThrow(); expect(() => readImportPresetsUiChoices(api, { owner, count: 2 })).toThrow();
  });
  it.each(['window', 'title', 'extension', 'properties'])('本次准确选项%s不可替换', async wrong => { const api = port(), input = options(); installImportPresetsUiChoice(api, { owner, senderId: 7, paths, index: 0 }); if (wrong === 'title') input.title = '导出文件'; if (wrong === 'extension') input.filters[0].extensions = ['json']; if (wrong === 'properties') input.properties = ['multiSelections']; await expect(api.dialog.showOpenDialog(wrong === 'window' ? {} : api.window, input)).rejects.toThrow(); expect(api.dialog.showOpenDialog).toBe(api.original); expect(() => installImportPresetsUiChoice(api, { owner, senderId: 7, paths, index: 0 })).toThrow(); });
});
