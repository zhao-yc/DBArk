import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve, join } from 'node:path';
import ts from 'typescript';
import { bindQueryResultColumnsUiTarget, queryResultColumnsUiKeys } from '../helpers/queryResultColumnsUi';

const source = readFileSync(new URL('../e2e/query-result-value-options.spec.ts', import.meta.url), 'utf8');
/** 执行实际spec声明及真实内存配置门，桌面runtime替身只记录注册，禁止联网/文件/窗口。 */
function fixture(change: Record<string, string | undefined> = {}, argv: string[] = []) {
  const output = resolve('.cache/dbark-query-columns-' + 'b'.repeat(32)), env: Record<string, string | undefined> = {
    DBARK_INTEGRATION_ENABLED: '1', DBARK_QUERY_RESULT_COLUMNS_UI: '1', DBARK_QUERY_RESULT_VALUE_OPTIONS_UI: '1',
    DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '仅内存测试用户', DBARK_TEST_PASSWORD: '仅内存测试值',
    DBARK_TEST_EXPECTED_SERVER_UUID: '11111111-1111-4111-8111-111111111111', DBARK_QUERY_COLUMNS_OUT_DIR: output,
    DBARK_QUERY_COLUMNS_CSV_PATH: join(output, 'visible-selected.csv'), DBARK_QUERY_COLUMNS_JSON_PATH: join(output, 'visible-selected.json'), ...change,
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const skipped = vi.fn(), register = vi.fn(), modules: string[] = [];
  const context = { exports: {}, process: { env, argv: ['node', 'playwright', ...argv] }, require(name: string) {
    modules.push(name);
    if (name === '@playwright/test') return { test: { skip: skipped } };
    if (name === '../helpers/queryResultColumnsUi') return { bindQueryResultColumnsUiTarget, queryResultColumnsUiKeys };
    if (name === './query-result-value-options-live') return { registerQueryResultValueOptionsUi: register };
    throw Error('禁止实际资源或未知依赖');
  } };
  return { env, skipped, register, modules, run: () => runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context) };
}
it.each(['DBARK_INTEGRATION_ENABLED', 'DBARK_QUERY_RESULT_COLUMNS_UI', 'DBARK_QUERY_RESULT_VALUE_OPTIONS_UI'])('%s缺失时默认只登记占位，不读取认证或加载实际资源', name => {
  const f = fixture({ [name]: undefined, DBARK_TEST_PASSWORD: undefined }); f.run(); expect(f.skipped).toHaveBeenCalledOnce(); expect(f.modules).toEqual(['@playwright/test']); expect(f.register).not.toHaveBeenCalled();
});
it.each(['--list', '--list=true'])('%s不读取路径或认证', flag => {
  const f = fixture({ DBARK_TEST_PASSWORD: undefined, DBARK_QUERY_COLUMNS_OUT_DIR: undefined }, [flag]); f.run(); expect(f.skipped).toHaveBeenCalledOnce(); expect(f.modules).toEqual(['@playwright/test']);
});
it.each(['0', 'true', ''])('专项门%j不是显式1', value => {
  const f = fixture({ DBARK_QUERY_RESULT_VALUE_OPTIONS_UI: value, DBARK_TEST_PASSWORD: undefined }); f.run(); expect(f.skipped).toHaveBeenCalledOnce(); expect(f.register).not.toHaveBeenCalled();
});
it('三门齐全只将原准确绑定交新runtime，不启其它专项', () => {
  const f = fixture(); f.run(); expect(f.register).toHaveBeenCalledOnce(); expect(f.skipped).not.toHaveBeenCalled(); expect(f.register.mock.calls[0]).toHaveLength(1); f.register.mock.calls[0][0].assertCurrent();
  expect(f.modules).toEqual(['@playwright/test', '../helpers/queryResultColumnsUi', './query-result-value-options-live']);
});
it.each(['DBARK_QUERY_RESULT_VALUE_OPTIONS_UI', 'DBARK_QUERY_RESULT_COLUMNS_UI', 'DBARK_TEST_PASSWORD'])('%s漂移后恢复不能复活同一授权', key => {
  const f = fixture(); f.run(); const binding = f.register.mock.calls[0][0], previous = f.env[key]; f.env[key] = 'changed'; expect(() => binding.assertCurrent()).toThrow(); f.env[key] = previous; expect(() => binding.assertCurrent()).toThrow();
});
it.each([{ DBARK_TEST_PORT: '3306' }, { DBARK_TEST_HOST: '127.0.0.1' }, { DBARK_TEST_DATABASE: '已有库' }, { DBARK_TEST_PASSWORD: undefined }])('准确目标与认证校验不能旁路：%j', change => {
  const f = fixture(change); expect(f.run).toThrow(); expect(f.modules).not.toContain('./query-result-value-options-live');
});
