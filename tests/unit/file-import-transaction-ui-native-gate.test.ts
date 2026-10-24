import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertFileImportTransactionUiEnvironment, bindFileImportTransactionUiEnvironment, fileImportTransactionUiFixture, installFileImportTransactionUiChoice, readFileImportTransactionUiChoices } from '../helpers/fileImportTransactionUi';

const source = readFileSync(new URL('../e2e/file-import-transaction.spec.ts', import.meta.url), 'utf8');
/** 转译真实spec；所有live、mysql、Electron、engine加载都是会立即报错的RAM哨兵。 */
function fixture(values: NodeJS.ProcessEnv = {}, args: string[] = [], forbidReads = false, active = false) {
  const modules: string[] = [], reads: string[] = [], skip = vi.fn(), register = vi.fn();
  const env = new Proxy(values, { get(target, key: string) { reads.push(key); if (forbidReads || !active && !['DBARK_INTEGRATION_ENABLED', 'DBARK_FILE_IMPORT_TRANSACTION_UI_TEST'].includes(key)) throw Error('默认/list读取了认证或资源配置'); return target[key]; } });
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: {}, process: { env, argv: ['node', 'playwright', ...args], platform: 'win32' },
    require(name: string) { modules.push(name); if (name === '@playwright/test') return { test: { skip } }; if (active && name === '../helpers/fileImportTransactionUi') return { bindFileImportTransactionUiEnvironment }; if (active && name === './file-import-transaction-live') return { registerFileImportTransactionUiTests: register }; throw Error('默认/list加载了资源模块：' + name); },
  });
  return { modules, reads, skip, register };
}
/** 只合成RAM值，不读当前进程认证，不打开文件或服务器。 */
function environment(): NodeJS.ProcessEnv {
  return { DBARK_INTEGRATION_ENABLED: '1', DBARK_FILE_IMPORT_TRANSACTION_UI_TEST: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成用户', DBARK_TEST_PASSWORD: '', DBARK_TEST_DATABASE: 'dbark_importtransactionui_' + 'a'.repeat(32), DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001', DBARK_FILE_IMPORT_TRANSACTION_UI_OWNER: 'dbark-file-import-transaction-ui:' + 'b'.repeat(32), DBARK_FILE_IMPORT_TRANSACTION_UI_MANIFEST: 'D:\\isolated\\source.json', DBARK_FILE_IMPORT_TRANSACTION_UI_MANIFEST_SHA256: 'c'.repeat(64), DBARK_FILE_IMPORT_TRANSACTION_UI_OUTPUT: 'D:\\isolated\\output', ...Object.fromEntries(['ATOMIC_BAD', 'BATCH_BAD', 'GOOD'].flatMap((name, index) => [['DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_' + name, 'D:\\isolated\\source-' + name + '.csv'], ['DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_' + name + '_SHA256', String(index + 1).repeat(64)]])) };
}

describe('文件导入事务正式窗口默认关闭门（纯RAM）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_FILE_IMPORT_TRANSACTION_UI_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '1', DBARK_FILE_IMPORT_TRANSACTION_UI_TEST: 'true' }])('缺双门只登记跳过且不加载helper：%j', values => { const current = fixture(values); expect(current.skip).toHaveBeenCalledOnce(); expect(current.modules).toEqual(['@playwright/test']); });
  it.each(['list', '--list', '--list=true'])('%s早于全部环境读取和资源加载', flag => { const current = fixture(environment(), [flag], true); expect(current.skip).toHaveBeenCalledOnce(); expect(current.reads).toEqual([]); expect(current.modules).toEqual(['@playwright/test']); });
  it('准确双门仅交付冻结绑定，不执行资源操作', () => { const current = fixture(environment(), ['--trace=off'], false, true); expect(current.skip).not.toHaveBeenCalled(); expect(current.modules).toEqual(['@playwright/test', '../helpers/fileImportTransactionUi', './file-import-transaction-live']); expect(current.register).toHaveBeenCalledOnce(); });
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_FILE_IMPORT_TRANSACTION_UI_OWNER', 'DBARK_FILE_IMPORT_TRANSACTION_UI_MANIFEST', 'DBARK_FILE_IMPORT_TRANSACTION_UI_MANIFEST_SHA256', 'DBARK_FILE_IMPORT_TRANSACTION_UI_OUTPUT', ...['ATOMIC_BAD', 'BATCH_BAD', 'GOOD'].flatMap(name => ['DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_' + name, 'DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_' + name + '_SHA256'])])('拒绝任意目标或来源值：%s', key => { expect(() => assertFileImportTransactionUiEnvironment({ ...environment(), [key]: 'other' }, [], 'win32')).toThrow(); });
  it.each(['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'])('替代环境即使空值仍拒绝：%s', key => { expect(() => assertFileImportTransactionUiEnvironment({ ...environment(), [key]: '' }, [], 'win32')).toThrow(); });
  it.each([['--trace=on'], ['--trace', 'retain-on-failure'], ['--config=other.ts'], ['-cother.ts'], ['--ui'], ['--debug']].map(args => ({ args })))('拒绝CLI绕行：$args', ({ args }) => { expect(() => assertFileImportTransactionUiEnvironment(environment(), args, 'win32')).toThrow(); });
  it('非Windows、大小写别名均拒绝', () => { expect(() => assertFileImportTransactionUiEnvironment(environment(), [], 'darwin')).toThrow(); expect(() => assertFileImportTransactionUiEnvironment({ ...environment(), dbark_test_host: 'other' }, [], 'win32')).toThrow(); });
  it('环境、argv、键存在性漂移后永久停链', () => {
    for (const change of ['port', 'args', 'key'] as const) { const env = environment(), args: string[] = [], binding = bindFileImportTransactionUiEnvironment(() => ({ env, args, platform: 'win32' })); binding.assertCurrent(); if (change === 'port') env.DBARK_TEST_PORT = '3306'; else if (change === 'args') args.push('--workers=2'); else env.DBARK_FILE_IMPORT_TRANSACTION_UI_EXTRA = ''; expect(() => binding.assertCurrent()).toThrow(); env.DBARK_TEST_PORT = '13384'; args.length = 0; delete env.DBARK_FILE_IMPORT_TRANSACTION_UI_EXTRA; expect(() => binding.assertCurrent()).toThrow(); }
  });
  it('Root资源计划独立表达501好记录后坏尾、500确认提交及精确成功两行', () => { const env = environment(), plan = fileImportTransactionUiFixture(env.DBARK_TEST_DATABASE!, env.DBARK_FILE_IMPORT_TRANSACTION_UI_OWNER!); expect(plan.files.atomicBad.text).toBe(plan.files.batchBad.text); expect(plan.files.atomicBad.text).toContain('10501,123456789012345678.000000000501'); expect(plan.files.atomicBad.text).toContain('10502,not-a-decimal'); expect(plan.files.atomicBad.preview).toHaveLength(20); expect(plan.expectedBatch).toHaveLength(501); expect(plan.expectedBatch.at(-1)?.id).toBe('10500'); expect(plan.expectedBatch.some(row => row.id === '10501')).toBe(false); expect(plan.expectedAtomic).toHaveLength(3); expect(plan.expectedAtomic[0]).toEqual(plan.baseline); expect(plan.expectedAtomic[1].id).toBe('18446744073709551614'); expect(plan.expectedAtomic[2].id).toBe('18446744073709551615'); expect(plan.files.good.text).toContain('"成功""首条""\r\n下一行"'); expect(() => fileImportTransactionUiFixture('business', plan.marker)).toThrow(); });
  it('真实观察SQL白名单按限定的BIGINT目标列排序，不能绑定CAST文本别名', () => {
    // 只从真实live源码抽取白名单表达式在RAM求值，不加载live或任何桌面、驱动、产品期望计算器。
    const live = readFileSync(new URL('../e2e/file-import-transaction-live.ts', import.meta.url), 'utf8');
    const parsed = ts.createSourceFile('file-import-transaction-live.ts', live, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), expressions: string[] = [];
    const visit = (node: ts.Node): void => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'statements' && node.initializer) expressions.push(node.initializer.getText(parsed)); ts.forEachChild(node, visit); };
    visit(parsed); expect(expressions).toHaveLength(1);
    const database = 'dbark_importtransactionui_' + 'a'.repeat(32), targets = ['atomic_target', 'batch_target'] as const;
    const statements = runInNewContext('(' + expressions[0] + ')', { database, plan: { qualified: (table: string) => { if (!(targets as readonly string[]).includes(table)) throw Error('观察表不在本例白名单'); return '`' + database + '`.`' + table + '`'; } } }) as Record<string, string>;
    for (const [key, table] of [['atomic', 'atomic_target'], ['batch', 'batch_target']] as const) {
      const qualified = '`' + database + '`.`' + table + '`';
      expect(statements[key]).toBe('SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,HEX(payload) AS payloadHex,HEX(note) AS noteHex,HEX(nullable_note) AS nullableHex,HEX(literal_slash) AS slashHex FROM ' + qualified + ' ORDER BY ' + qualified + '.`id` ASC');
      expect(statements[key]).not.toMatch(/ORDER BY\s+`?id`?\s+ASC/i);
    }
    // 完整读回仍必须消费同一白名单中的SQL，不允许修正模板却继续发送另一条别名排序查询。
    expect(live).toContain('observer.query({ sql: statements[kind],');
  });
});

describe('文件导入事务三次独立Electron选择适配器（纯RAM）', () => {
  afterEach(() => { Reflect.deleteProperty(globalThis, '__fileImportTransactionUiPicker'); });
  const owner = 'dbark-file-import-transaction-ui:' + 'a'.repeat(32), paths = ['D:\\isolated\\atomic-bad.csv', 'D:\\isolated\\batch-bad.csv', 'D:\\isolated\\atomic-good.csv'];
  /** 只提供API函数端口，不加载真实Electron、文件或Main令牌。 */
  const port = () => { const original = vi.fn(async (..._args: any[]) => ({ canceled: true, filePaths: [] })), window = { isDestroyed: () => false, webContents: { id: 7 } }; return { dialog: { showOpenDialog: original }, BrowserWindow: { getAllWindows: () => [window] }, window, original }; };
  const options = () => ({ title: '选择文件', properties: ['openFile'], filters: [{ name: 'CSV 文件', extensions: ['csv'] }, { name: '所有文件', extensions: ['*'] }] });
  it('每次分别消费唯一原路径并恢复原函数，未消费不能进入下一次', async () => { const api = port(); for (const index of [0, 1, 2]) { installFileImportTransactionUiChoice(api, { owner, senderId: 7, paths, index }); expect(() => readFileImportTransactionUiChoices(api, { owner, count: index + 1 })).toThrow(); expect(() => installFileImportTransactionUiChoice(api, { owner, senderId: 7, paths, index: index + 1 })).toThrow(); expect(await api.dialog.showOpenDialog(api.window, options())).toEqual({ canceled: false, filePaths: [paths[index]] }); expect(api.dialog.showOpenDialog).toBe(api.original); expect(readFileImportTransactionUiChoices(api, { owner, count: index + 1 }).paths).toEqual(paths.slice(0, index + 1)); } expect(api.original).not.toHaveBeenCalled(); expect(() => installFileImportTransactionUiChoice(api, { owner, senderId: 7, paths, index: 3 })).toThrow(); });
  it('旧wrapper不能重放坏文件或接管后继选择', async () => { const api = port(); installFileImportTransactionUiChoice(api, { owner, senderId: 7, paths, index: 0 }); const old = api.dialog.showOpenDialog; await api.dialog.showOpenDialog(api.window, options()); installFileImportTransactionUiChoice(api, { owner, senderId: 7, paths, index: 1 }); await expect(old(api.window, options())).rejects.toThrow(); await expect(api.dialog.showOpenDialog(api.window, options())).rejects.toThrow(); expect(() => readFileImportTransactionUiChoices(api, { owner, count: 2 })).toThrow(); });
  it.each(['window', 'title', 'extension', 'properties'])('准确选项%s不可替换', async wrong => { const api = port(), input = options(); installFileImportTransactionUiChoice(api, { owner, senderId: 7, paths, index: 0 }); if (wrong === 'title') input.title = '导出文件'; if (wrong === 'extension') input.filters[0].extensions = ['json']; if (wrong === 'properties') input.properties = ['multiSelections']; await expect(api.dialog.showOpenDialog(wrong === 'window' ? {} : api.window, input)).rejects.toThrow(); expect(api.dialog.showOpenDialog).toBe(api.original); expect(() => installFileImportTransactionUiChoice(api, { owner, senderId: 7, paths, index: 0 })).toThrow(); });
});
