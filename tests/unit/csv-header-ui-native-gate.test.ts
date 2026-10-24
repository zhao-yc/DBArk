import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertCsvHeaderUiEnvironment, bindCsvHeaderUiEnvironment, csvHeaderUiFixture, installCsvHeaderUiFileChoice, readCsvHeaderUiFileChoice } from '../helpers/csvHeaderUi';

const source = readFileSync(new URL('../e2e/csv-header.spec.ts', import.meta.url), 'utf8');
/** 转译真实spec；所有live、mysql、Electron、engine加载都是会立即报错的RAM哨兵。 */
function fixture(values: NodeJS.ProcessEnv = {}, args: string[] = [], forbidReads = false, active = false) {
  const modules: string[] = [], reads: string[] = [], skip = vi.fn(), register = vi.fn();
  const env = new Proxy(values, { get(target, key: string) { reads.push(key); if (forbidReads || !active && !['DBARK_INTEGRATION_ENABLED', 'DBARK_CSV_HEADER_UI_TEST'].includes(key)) throw Error('默认/list读取了认证或资源配置'); return target[key]; } });
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: {}, process: { env, argv: ['node', 'playwright', ...args], platform: 'win32' },
    require(name: string) { modules.push(name); if (name === '@playwright/test') return { test: { skip } }; if (active && name === '../helpers/csvHeaderUi') return { bindCsvHeaderUiEnvironment }; if (active && name === './csv-header-live') return { registerCsvHeaderUiTests: register }; throw Error('默认/list加载了资源模块：' + name); },
  });
  return { modules, reads, skip, register };
}
/** 只合成RAM值，不读当前进程认证，不打开文件或服务器。 */
function environment(): NodeJS.ProcessEnv {
  return { DBARK_INTEGRATION_ENABLED: '1', DBARK_CSV_HEADER_UI_TEST: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成用户', DBARK_TEST_PASSWORD: '', DBARK_TEST_DATABASE: 'dbark_csvheaderui_' + 'a'.repeat(32), DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001', DBARK_CSV_HEADER_UI_OWNER: 'dbark-csv-header-ui:' + 'b'.repeat(32), DBARK_CSV_HEADER_UI_MANIFEST: 'D:\\isolated\\source.json', DBARK_CSV_HEADER_UI_MANIFEST_SHA256: 'c'.repeat(64), DBARK_CSV_HEADER_UI_OUTPUT: 'D:\\isolated\\output', DBARK_CSV_HEADER_UI_CSV: 'D:\\isolated\\source.csv', DBARK_CSV_HEADER_UI_CSV_SHA256: 'd'.repeat(64) };
}

describe('无标题CSV正式窗口默认关闭门（纯RAM）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_CSV_HEADER_UI_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '1', DBARK_CSV_HEADER_UI_TEST: 'true' }])('缺双门只登记跳过且不加载helper：%j', values => { const current = fixture(values); expect(current.skip).toHaveBeenCalledOnce(); expect(current.modules).toEqual(['@playwright/test']); });
  it.each(['list', '--list', '--list=true'])('%s早于全部环境读取和资源加载', flag => { const current = fixture(environment(), [flag], true); expect(current.skip).toHaveBeenCalledOnce(); expect(current.reads).toEqual([]); expect(current.modules).toEqual(['@playwright/test']); });
  it('准确双门仅交付冻结绑定，不执行资源操作', () => { const current = fixture(environment(), ['--trace=off'], false, true); expect(current.skip).not.toHaveBeenCalled(); expect(current.modules).toEqual(['@playwright/test', '../helpers/csvHeaderUi', './csv-header-live']); expect(current.register).toHaveBeenCalledOnce(); });
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_CSV_HEADER_UI_OWNER', 'DBARK_CSV_HEADER_UI_MANIFEST', 'DBARK_CSV_HEADER_UI_MANIFEST_SHA256', 'DBARK_CSV_HEADER_UI_OUTPUT', 'DBARK_CSV_HEADER_UI_CSV', 'DBARK_CSV_HEADER_UI_CSV_SHA256'])('拒绝任意目标或来源值：%s', key => { expect(() => assertCsvHeaderUiEnvironment({ ...environment(), [key]: 'other' }, [], 'win32')).toThrow(); });
  it.each(['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'])('替代环境即使空值仍拒绝：%s', key => { expect(() => assertCsvHeaderUiEnvironment({ ...environment(), [key]: '' }, [], 'win32')).toThrow(); });
  it.each([['--trace=on'], ['--trace', 'retain-on-failure'], ['--config=other.ts'], ['-cother.ts'], ['--ui'], ['--debug']].map(args => ({ args })))('拒绝CLI绕行：$args', ({ args }) => { expect(() => assertCsvHeaderUiEnvironment(environment(), args, 'win32')).toThrow(); });
  it('非Windows、大小写别名均拒绝', () => { expect(() => assertCsvHeaderUiEnvironment(environment(), [], 'darwin')).toThrow(); expect(() => assertCsvHeaderUiEnvironment({ ...environment(), dbark_test_host: 'other' }, [], 'win32')).toThrow(); });
  it('环境、argv、键存在性漂移后永久停链', () => {
    for (const change of ['port', 'args', 'key'] as const) { const env = environment(), args: string[] = [], binding = bindCsvHeaderUiEnvironment(() => ({ env, args, platform: 'win32' })); binding.assertCurrent(); if (change === 'port') env.DBARK_TEST_PORT = '3306'; else if (change === 'args') args.push('--workers=2'); else env.DBARK_CSV_HEADER_UI_EXTRA = ''; expect(() => binding.assertCurrent()).toThrow(); env.DBARK_TEST_PORT = '13384'; args.length = 0; delete env.DBARK_CSV_HEADER_UI_EXTRA; expect(() => binding.assertCurrent()).toThrow(); }
  });
  it('Root资源计划包含精确首条、位置同名目标、NULL及转义文本，不能绑定业务库', () => { const env = environment(), plan = csvHeaderUiFixture(env.DBARK_TEST_DATABASE!, env.DBARK_CSV_HEADER_UI_OWNER!); expect(plan.csvText).toContain('18446744073709551615,9007199254740993.123456789012'); expect(plan.csvText).toContain('"中文""首条""\r\n下一行"'); expect(plan.decoded[0][4]).toBeNull(); expect(plan.decoded[0][5]).toBe('\\N'); expect(plan.targetColumns[0]).toBe(plan.positionalColumns[0]); expect(() => csvHeaderUiFixture('business', plan.marker)).toThrow(); });
});

describe('CSV文件选择一次性Electron适配器（纯RAM，不代表原生输入）', () => {
  afterEach(() => { Reflect.deleteProperty(globalThis, '__csvHeaderUiPicker'); });
  const owner = 'dbark-csv-header-ui:' + 'a'.repeat(32), path = 'D:\\isolated\\source.csv';
  /** 只提供API端口，真实Main文件令牌与磁盘均不参与RAM单元。 */
  const port = () => { const original = vi.fn(async (..._args: any[]) => ({ canceled: true, filePaths: [] })), window = { isDestroyed: () => false, webContents: { id: 7 } }; return { dialog: { showOpenDialog: original }, BrowserWindow: { getAllWindows: () => [window] }, window, original }; };
  const options = () => ({ title: '选择文件', properties: ['openFile'], filters: [{ name: 'CSV 文件', extensions: ['csv'] }, { name: '所有文件', extensions: ['*'] }] });
  it('只有准确原窗口消费一次并恢复原函数，安装不等于完成', async () => { const api = port(); installCsvHeaderUiFileChoice(api, { owner, senderId: 7, path }); expect(() => readCsvHeaderUiFileChoice(api, owner)).toThrow(); expect(await api.dialog.showOpenDialog(api.window, options())).toEqual({ canceled: false, filePaths: [path] }); expect(api.dialog.showOpenDialog).toBe(api.original); expect(api.original).not.toHaveBeenCalled(); expect(readCsvHeaderUiFileChoice(api, owner)).toEqual({ owner, consumed: true, originalRestored: true, path, nativeInputVerified: false }); });
  it.each(['window', 'purpose', 'extension', 'properties'])('错误%s立即恢复并永久保留失败', async wrong => { const api = port(), input = options(); installCsvHeaderUiFileChoice(api, { owner, senderId: 7, path }); if (wrong === 'purpose') input.title = '导出文件'; if (wrong === 'extension') input.filters[0].extensions = ['json']; if (wrong === 'properties') input.properties = ['multiSelections']; await expect(api.dialog.showOpenDialog(wrong === 'window' ? {} : api.window, input)).rejects.toThrow(); expect(api.dialog.showOpenDialog).toBe(api.original); expect(() => readCsvHeaderUiFileChoice(api, owner)).toThrow(); expect(() => installCsvHeaderUiFileChoice(api, { owner, senderId: 7, path })).toThrow(); });
  it('旧wrapper不能再消费，窗口或owner也不能接管', async () => { const api = port(); installCsvHeaderUiFileChoice(api, { owner, senderId: 7, path }); const old = api.dialog.showOpenDialog; await api.dialog.showOpenDialog(api.window, options()); await expect(old(api.window, options())).rejects.toThrow(); expect(() => readCsvHeaderUiFileChoice(api, owner)).toThrow(); });
});
