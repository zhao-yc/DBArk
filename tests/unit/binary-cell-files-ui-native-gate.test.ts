import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertBinaryCellFilesUiEnvironment, bindBinaryCellFilesUiEnvironment, binaryCellFilesUiFixture, installBinaryCellFilesUiChoice, readBinaryCellFilesUiChoices } from '../helpers/binaryCellFilesUi';
import { binaryCellFileBytes, binaryCellFileLimits } from '../../src/shared/binaryCellFiles';

const source = readFileSync(new URL('../e2e/binary-cell-files.spec.ts', import.meta.url), 'utf8');
/** 转译真实spec，以RAM哨兵拒绝任何未经门控的live、Electron、驱动或认证读取。 */
function fixture(values: NodeJS.ProcessEnv = {}, args: string[] = [], forbidReads = false, active = false) {
  const modules: string[] = [], reads: string[] = [], skip = vi.fn(), register = vi.fn();
  const env = new Proxy(values, { get(target, key: string) { reads.push(key); if (forbidReads || !active && !['DBARK_INTEGRATION_ENABLED', 'DBARK_BINARY_CELL_FILES_UI_TEST'].includes(key)) throw Error('默认/list读取了认证或资源'); return target[key]; } });
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: {}, process: { env, argv: ['node', 'playwright', ...args], platform: 'win32' },
    require(name: string) { modules.push(name); if (name === '@playwright/test') return { test: { skip } }; if (active && name === '../helpers/binaryCellFilesUi') return { bindBinaryCellFilesUiEnvironment }; if (active && name === './binary-cell-files-live') return { registerBinaryCellFilesUiTests: register }; throw Error('默认/list加载了资源模块：' + name); },
  });
  return { modules, reads, skip, register };
}

/** 只构造合成RAM认证，绝不读取真实进程env或访问文件、数据库。 */
function environment(): NodeJS.ProcessEnv {
  return { DBARK_INTEGRATION_ENABLED: '1', DBARK_BINARY_CELL_FILES_UI_TEST: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成用户', DBARK_TEST_PASSWORD: '', DBARK_TEST_DATABASE: 'dbark_binarycellfilesui_' + 'a'.repeat(32), DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001', DBARK_BINARY_CELL_FILES_UI_OWNER: 'dbark-binary-cell-files-ui:' + 'b'.repeat(32), DBARK_BINARY_CELL_FILES_UI_MANIFEST: 'D:/isolated/source.json', DBARK_BINARY_CELL_FILES_UI_MANIFEST_SHA256: 'c'.repeat(64), DBARK_BINARY_CELL_FILES_UI_OUTPUT: 'D:/isolated/output', DBARK_BINARY_CELL_FILES_UI_INPUT_FULL: 'D:/isolated/full.bin', DBARK_BINARY_CELL_FILES_UI_INPUT_FULL_SHA256: 'd'.repeat(64), DBARK_BINARY_CELL_FILES_UI_INPUT_EMPTY: 'D:/isolated/empty.bin', DBARK_BINARY_CELL_FILES_UI_INPUT_EMPTY_SHA256: 'e'.repeat(64) };
}

describe('二进制单元格文件正式源码窗口默认关闭门（纯RAM）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_BINARY_CELL_FILES_UI_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '1', DBARK_BINARY_CELL_FILES_UI_TEST: 'true' }])('缺双门只跳过且不加载helper：%j', values => { const current = fixture(values); expect(current.skip).toHaveBeenCalledOnce(); expect(current.modules).toEqual(['@playwright/test']); });
  it.each(['list', '--list', '--list=true'])('%s早于全部env和资源模块读取', flag => { const current = fixture(environment(), [flag], true); expect(current.skip).toHaveBeenCalledOnce(); expect(current.reads).toEqual([]); expect(current.modules).toEqual(['@playwright/test']); });
  it('准确双门仅绑定冻结输入再登记live，不执行资源操作', () => { const current = fixture(environment(), ['--trace=off'], false, true); expect(current.skip).not.toHaveBeenCalled(); expect(current.modules).toEqual(['@playwright/test', '../helpers/binaryCellFilesUi', './binary-cell-files-live']); expect(current.register).toHaveBeenCalledOnce(); });
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_BINARY_CELL_FILES_UI_OWNER', 'DBARK_BINARY_CELL_FILES_UI_MANIFEST', 'DBARK_BINARY_CELL_FILES_UI_MANIFEST_SHA256', 'DBARK_BINARY_CELL_FILES_UI_OUTPUT', 'DBARK_BINARY_CELL_FILES_UI_INPUT_FULL', 'DBARK_BINARY_CELL_FILES_UI_INPUT_FULL_SHA256', 'DBARK_BINARY_CELL_FILES_UI_INPUT_EMPTY', 'DBARK_BINARY_CELL_FILES_UI_INPUT_EMPTY_SHA256'])('拒绝错误目标或批准资源：%s', key => { expect(() => assertBinaryCellFilesUiEnvironment({ ...environment(), [key]: 'other' }, [], 'win32')).toThrow(); });
  it.each(['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'])('替代环境即使为空值也拒绝：%s', key => { expect(() => assertBinaryCellFilesUiEnvironment({ ...environment(), [key]: '' }, [], 'win32')).toThrow(); });
  it.each([['--trace=on'], ['--trace', 'retain-on-failure'], ['--config=other.ts'], ['-cother.ts'], ['--ui'], ['--debug']].map(args => ({ args })))('拒绝CLI绕行：$args', ({ args }) => { expect(() => assertBinaryCellFilesUiEnvironment(environment(), args, 'win32')).toThrow(); });
  it('非Windows、空用户、缺认证、大小写别名和两输入同路径拒绝', () => { expect(() => assertBinaryCellFilesUiEnvironment(environment(), [], 'darwin')).toThrow(); for (const change of [{ DBARK_TEST_USER: '' }, { DBARK_TEST_PASSWORD: undefined }, { dbark_test_host: 'other' }, { DBARK_BINARY_CELL_FILES_UI_INPUT_EMPTY: environment().DBARK_BINARY_CELL_FILES_UI_INPUT_FULL }]) expect(() => assertBinaryCellFilesUiEnvironment({ ...environment(), ...change }, [], 'win32')).toThrow(); });
  it('目标/argv/键存在性漂移永久停链，改回不复活', () => {
    for (const change of ['port', 'args', 'key']) { const env = environment(), args: string[] = [], binding = bindBinaryCellFilesUiEnvironment(() => ({ env, args, platform: 'win32' })); binding.assertCurrent(); if (change === 'port') env.DBARK_TEST_PORT = '3306'; else if (change === 'args') args.push('--workers=2'); else env.DBARK_BINARY_CELL_FILES_UI_EXTRA = ''; expect(() => binding.assertCurrent()).toThrow(); env.DBARK_TEST_PORT = '13384'; args.length = 0; delete env.DBARK_BINARY_CELL_FILES_UI_EXTRA; expect(() => binding.assertCurrent()).toThrow(); }
  });
  it('Root夹具手写BOM/NUL/FF/引号/反斜线/CRLF字节，空文件与NULL独立且其它行保持', () => {
    const env = environment(), plan = binaryCellFilesUiFixture(env.DBARK_TEST_DATABASE!, env.DBARK_BINARY_CELL_FILES_UI_OWNER!);
    expect([...plan.inputs.full.bytes]).toEqual([239, 187, 191, 0, 255, 34, 39, 92, 13, 10, 228, 184, 173]); expect(plan.inputs.empty.bytes).toHaveLength(0);
    expect(plan.before).toEqual([{ id: '1', payloadHex: null, note: '原NULL行' }, { id: '2', payloadHex: '7F01', note: '原非空行' }, { id: '3', payloadHex: '', note: '原空行' }]);
    expect(plan.after).toEqual([{ id: '1', payloadHex: 'EFBBBF00FF22275C0D0AE4B8AD', note: '原NULL行' }, { id: '2', payloadHex: '', note: '原非空行' }, { id: '3', payloadHex: '', note: '原空行' }]);
    expect(plan.rowSql).toBe('SELECT CAST(id AS CHAR) AS id,HEX(payload) AS payloadHex,note FROM `' + env.DBARK_TEST_DATABASE + '`.`subject` ORDER BY `' + env.DBARK_TEST_DATABASE + '`.`subject`.`id` ASC');
    expect(plan.outputs.table.hex).toBe('7F01'); expect(plan.outputs.query.hex).toBe('EFBBBF00FF22275C0D0AE4B8AD'); expect(() => binaryCellFilesUiFixture('business', plan.marker)).toThrow(); expect(plan.creates).toHaveLength(3); expect(plan.seeds).toHaveLength(2);
  });
  it('载入131071与另存2MiB的完整字节边界在RAM核验，超限绝不截断', () => {
    expect(binaryCellFileLimits.openBytes).toBe(131071); expect(binaryCellFileLimits.saveBytes).toBe(2097152);
    for (const maximum of [131071, 2097152]) {
      expect(binaryCellFileBytes(Buffer.alloc(maximum, 255).toString('base64'), maximum)).toBe(maximum);
      expect(() => binaryCellFileBytes(Buffer.alloc(maximum + 1, 255).toString('base64'), maximum)).toThrow();
    }
    expect(binaryCellFileBytes('', 131071)).toBe(0); expect(() => binaryCellFileBytes(null, 131071)).toThrow();
  });
});

describe('二进制单元格五次独立Electron API回答器（纯RAM）', () => {
  afterEach(() => { Reflect.deleteProperty(globalThis, '__binaryCellFilesUiPicker'); });
  const owner = 'dbark-binary-cell-files-ui:' + 'a'.repeat(32), choices = [{ kind: 'save' as const, path: 'D:/isolated/table-original.bin' }, { kind: 'open' as const, path: 'D:/isolated/full.bin' }, { kind: 'open' as const }, { kind: 'open' as const, path: 'D:/isolated/empty.bin' }, { kind: 'save' as const, path: 'D:/isolated/query-loaded.bin' }];
  /** 只提供内存API端口；不加载Electron，也不生成任何产品文件回执。 */
  const port = () => { const originalOpen = vi.fn(async (..._args: any[]) => ({ canceled: true, filePaths: [] })), originalSave = vi.fn(async (..._args: any[]) => ({ canceled: true })), window = { isDestroyed: () => false, webContents: { id: 7 } }; return { dialog: { showOpenDialog: originalOpen, showSaveDialog: originalSave }, BrowserWindow: { getAllWindows: () => [window] }, window, originalOpen, originalSave }; };
  const options = (kind: 'open' | 'save') => kind === 'open' ? { title: '载入二进制单元格文件', properties: ['openFile'], filters: [{ name: '所有文件', extensions: ['*'] }] } : { title: '另存二进制单元格原字节', defaultPath: 'binary-cell.bin', filters: [{ name: '所有文件', extensions: ['*'] }] };
  it('准确顺序单次消费，真实取消不产生path且两API恢复原函数', async () => {
    const api = port();
    for (const [index, choice] of choices.entries()) {
      installBinaryCellFilesUiChoice(api, { owner, senderId: 7, choices, index }); expect(() => readBinaryCellFilesUiChoices(api, { owner, count: index + 1 })).toThrow(); expect(() => installBinaryCellFilesUiChoice(api, { owner, senderId: 7, choices, index: index + 1 })).toThrow();
      const result = choice.kind === 'open' ? await api.dialog.showOpenDialog(api.window, options('open')) : await api.dialog.showSaveDialog(api.window, options('save'));
      expect(result).toEqual(choice.kind === 'open' ? { canceled: choice.path === undefined, filePaths: choice.path ? [choice.path] : [] } : { canceled: false, filePath: choice.path });
      expect(api.dialog.showOpenDialog).toBe(api.originalOpen); expect(api.dialog.showSaveDialog).toBe(api.originalSave); expect(readBinaryCellFilesUiChoices(api, { owner, count: index + 1 }).records).toEqual(choices.slice(0, index + 1));
    }
    expect(api.originalOpen).not.toHaveBeenCalled(); expect(api.originalSave).not.toHaveBeenCalled(); expect(() => installBinaryCellFilesUiChoice(api, { owner, senderId: 7, choices, index: 5 })).toThrow();
  });
  it('旧wrapper不能重放或接管后继操作，失败保持墓碑', async () => {
    const api = port(); installBinaryCellFilesUiChoice(api, { owner, senderId: 7, choices, index: 0 }); const old = api.dialog.showSaveDialog; await old(api.window, options('save')); installBinaryCellFilesUiChoice(api, { owner, senderId: 7, choices, index: 1 }); await expect(old(api.window, options('save'))).rejects.toThrow(); await expect(api.dialog.showOpenDialog(api.window, options('open'))).rejects.toThrow(); expect(() => readBinaryCellFilesUiChoices(api, { owner, count: 2 })).toThrow();
  });
  it.each(['window', 'title', 'defaultPath', 'filters'])('准确另存选项%s不可替换', async wrong => { const api = port(), input = options('save') as any; installBinaryCellFilesUiChoice(api, { owner, senderId: 7, choices, index: 0 }); if (wrong === 'title') input.title = '导出文件'; if (wrong === 'defaultPath') input.defaultPath = 'other.bin'; if (wrong === 'filters') input.filters = []; await expect(api.dialog.showSaveDialog(wrong === 'window' ? {} : api.window, input)).rejects.toThrow(); expect(api.dialog.showSaveDialog).toBe(api.originalSave); expect(() => installBinaryCellFilesUiChoice(api, { owner, senderId: 7, choices, index: 0 })).toThrow(); });
  it('载入不接受多选或替代过滤器', async () => { const api = port(); installBinaryCellFilesUiChoice(api, { owner, senderId: 7, choices, index: 0 }); await api.dialog.showSaveDialog(api.window, options('save')); installBinaryCellFilesUiChoice(api, { owner, senderId: 7, choices, index: 1 }); await expect(api.dialog.showOpenDialog(api.window, { ...options('open'), properties: ['openFile', 'multiSelections'] })).rejects.toThrow(); expect(api.dialog.showOpenDialog).toBe(api.originalOpen); expect(() => readBinaryCellFilesUiChoices(api, { owner, count: 2 })).toThrow(); });
});
