import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertImportNewTableJsonUiEnvironment, assertImportNewTableUiEnvironment, bindImportNewTableJsonUiEnvironment, importNewTableJsonUiFixture, installImportNewTableUiChoice, readImportNewTableUiChoice } from '../helpers/importNewTableUi';

/** 只有合成配置；既不读取进程认证，也不访问文件路径或网络。 */
function environment(): NodeJS.ProcessEnv {
  return { DBARK_INTEGRATION_ENABLED: '1', DBARK_IMPORT_NEW_TABLE_JSON_UI_TEST: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成用户', DBARK_TEST_PASSWORD: '', DBARK_TEST_DATABASE: 'dbark_importnewui_012345abcdef', DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001', DBARK_IMPORT_NEW_TABLE_UI_OWNER: 'dbark-import-new-table-ui:012345abcdef', DBARK_IMPORT_NEW_TABLE_UI_MANIFEST: 'D:\\isolated\\source.json', DBARK_IMPORT_NEW_TABLE_UI_MANIFEST_SHA256: 'a'.repeat(64), DBARK_IMPORT_NEW_TABLE_UI_OUTPUT: 'D:\\isolated\\output', DBARK_IMPORT_NEW_TABLE_UI_JSON: 'D:\\isolated\\good.json', DBARK_IMPORT_NEW_TABLE_UI_JSON_SHA256: 'b'.repeat(64) };
}

/** 执行真实spec关闭门；任何越门加载live/文件/认证/桌面/驱动都会触发哨兵。 */
function gate(values: NodeJS.ProcessEnv, args: string[] = [], active = false, listing = false, csv = false) {
  const source = readFileSync(new URL(csv ? '../e2e/import-new-table.spec.ts' : '../e2e/import-new-table-json.spec.ts', import.meta.url), 'utf8');
  const modules: string[] = [], reads: string[] = [], skip = vi.fn(), register = vi.fn();
  const env = new Proxy(values, { get(target, key: string) {
    reads.push(key);
    if (listing || !active && !['DBARK_INTEGRATION_ENABLED', csv ? 'DBARK_IMPORT_NEW_TABLE_UI_TEST' : 'DBARK_IMPORT_NEW_TABLE_JSON_UI_TEST'].includes(key)) throw Error('JSON默认/list越门读取认证');
    return target[key];
  } });
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: {}, process: { env, argv: ['node', 'playwright', ...args], platform: 'win32' }, require(name: string) {
    modules.push(name);
    if (name === '@playwright/test') return { test: { skip } };
    if (active && name === '../helpers/importNewTableUi') return { bindImportNewTableJsonUiEnvironment };
    if (active && name === './import-new-table-live') return { registerImportNewTableUiTests: register };
    throw Error('JSON关闭门加载了实际资源');
  } });
  return { modules, reads, skip, register };
}

describe('JSON新表窗口独立入口与原环境来源', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_IMPORT_NEW_TABLE_JSON_UI_TEST: '1' }, { DBARK_INTEGRATION_ENABLED: '1', DBARK_IMPORT_NEW_TABLE_JSON_UI_TEST: 'true' }])('缺精确双门仅登记skip：%j', values => {
    const result = gate(values); expect(result.skip).toHaveBeenCalledOnce(); expect(result.modules).toEqual(['@playwright/test']);
  });
  it.each(['--list', '--list=true', '--list=false'])('%s优先短路，不读任何环境', value => {
    const result = gate(environment(), [value], false, true); expect(result.reads).toEqual([]); expect(result.modules).toEqual(['@playwright/test']);
  });
  it('JSON门不激活CSV入口；准确JSON门只绑定一份原文件', () => {
    expect(gate(environment(), [], false, false, true).skip).toHaveBeenCalledOnce();
    const result = gate(environment(), [], true); expect(result.register).toHaveBeenCalledOnce(); expect(result.skip).not.toHaveBeenCalled();
    const bound = bindImportNewTableJsonUiEnvironment(() => ({ env: environment(), args: [], platform: 'win32' }));
    expect(bound.format).toBe('json'); expect(Object.keys(bound.values).some(key => key.includes('_CSV_'))).toBe(false); bound.assertCurrent();
  });
  it.each([{ DBARK_IMPORT_NEW_TABLE_UI_JSON: 'D:\\isolated\\good.csv' }, { DBARK_IMPORT_NEW_TABLE_UI_JSON: 'relative.json' }, { DBARK_IMPORT_NEW_TABLE_UI_JSON_SHA256: '' }, { DBARK_IMPORT_NEW_TABLE_UI_TEST: '1' }, { DBARK_IMPORT_NEW_TABLE_UI_CSV_GOOD: '' }])('拒绝格式、摘要或跨专项混用：%j', delta => {
    expect(() => assertImportNewTableJsonUiEnvironment({ ...environment(), ...delta }, [], 'win32')).toThrow();
  });
  it('CSV不能借JSON门运行，JSON也保留平台/trace原生门', () => {
    expect(() => assertImportNewTableUiEnvironment(environment(), [], 'win32')).toThrow();
    expect(() => assertImportNewTableJsonUiEnvironment(environment(), [], 'darwin')).toThrow();
    expect(() => assertImportNewTableJsonUiEnvironment(environment(), ['--trace=on'], 'win32')).toThrow();
  });
  it('JSON原路径或门失效后，恢复旧值也不能复活', () => {
    const env = environment(), binding = bindImportNewTableJsonUiEnvironment(() => ({ env, args: [], platform: 'win32' }));
    env.DBARK_IMPORT_NEW_TABLE_UI_JSON = 'D:\\isolated\\other.json'; expect(() => binding.assertCurrent()).toThrow();
    env.DBARK_IMPORT_NEW_TABLE_UI_JSON = 'D:\\isolated\\good.json'; expect(() => binding.assertCurrent()).toThrow();
  });
  it('原数值文本、NULL、空串和第31条转义文本独立造数，目标表不由夹具预建', () => {
    const env = environment(), plan = importNewTableJsonUiFixture(env.DBARK_TEST_DATABASE!, env.DBARK_IMPORT_NEW_TABLE_UI_OWNER!);
    expect(plan.tables).toEqual(['json_text']); expect(plan.creates).toHaveLength(2); expect(plan.creates.join()).not.toContain(plan.qualified('json_text'));
    expect(plan.files.happy.text).toContain('"record_no":9007199254740993'); expect(plan.files.happy.text).not.toContain('"record_no":"');
    expect(plan.files.happy.text.match(/"record_no":/g)).toHaveLength(31); expect(plan.expected[1].noteHex).toBe(''); expect(plan.expected[6].noteHex).toBeNull();
    expect(plan.expected[30]).toEqual({ record_no: '9007199254741023', noteHex: Buffer.from('\\样本外末条').toString('hex').toUpperCase() });
    expect(() => plan.qualified('csv_text')).toThrow(); expect(() => plan.qualified('业务表')).toThrow();
  });
});

describe('JSON准确一次原生选择回答（纯RAM）', () => {
  afterEach(() => { Reflect.deleteProperty(globalThis, '__importNewTableUiPicker'); });
  it('仅接受JSON扩展及真实JSON对话选项，消费后恢复原函数', async () => {
    const window = { isDestroyed: () => false, webContents: { id: 7 } }, original = vi.fn(async () => ({ canceled: true, filePaths: [] }));
    const api = { dialog: { showOpenDialog: original as (...args: any[]) => Promise<any> }, BrowserWindow: { getAllWindows: () => [window] } };
    const input = { owner: 'dbark-import-new-table-ui:012345abcdef', senderId: 7, path: 'D:\\isolated\\good.json', format: 'json' as const };
    expect(() => installImportNewTableUiChoice(api, { ...input, path: 'D:\\isolated\\good.csv' })).toThrow();
    installImportNewTableUiChoice(api, input);
    expect(await api.dialog.showOpenDialog(window, { title: '选择文件', properties: ['openFile'], filters: [{ name: 'JSON 文件', extensions: ['json'] }, { name: '所有文件', extensions: ['*'] }] })).toEqual({ canceled: false, filePaths: [input.path] });
    expect(api.dialog.showOpenDialog).toBe(original); expect(readImportNewTableUiChoice(api, input).consumed).toBe(1); expect(original).not.toHaveBeenCalled();
  });
});
