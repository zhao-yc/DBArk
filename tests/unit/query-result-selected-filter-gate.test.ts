import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve, join } from 'node:path';
import ts from 'typescript';
import { bindQueryResultColumnsUiTarget, queryResultColumnsUiKeys } from '../helpers/queryResultColumnsUi';

const source = readFileSync(new URL('../e2e/query-result-selected-filter.spec.ts', import.meta.url), 'utf8');

/** 仅转译并执行实际spec声明；真实绑定只读RAM合成认证，runtime替身不创建任何资源。 */
function fixture(change: Record<string, string | undefined> = {}, args: string[] = []) {
  const output = resolve('.cache/dbark-query-columns-' + 'a'.repeat(32));
  const env: Record<string, string | undefined> = {
    DBARK_INTEGRATION_ENABLED: '1', DBARK_QUERY_RESULT_COLUMNS_UI: '1', DBARK_QUERY_RESULT_SELECTED_FILTER_UI: '1',
    DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0',
    DBARK_TEST_USER: 'synthetic', DBARK_TEST_PASSWORD: '仅内存合成值', DBARK_TEST_EXPECTED_SERVER_UUID: '11111111-1111-4111-8111-111111111111',
    DBARK_QUERY_COLUMNS_OUT_DIR: output, DBARK_QUERY_COLUMNS_CSV_PATH: join(output, 'visible-selected.csv'), DBARK_QUERY_COLUMNS_JSON_PATH: join(output, 'visible-selected.json'), ...change
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const skipped = vi.fn(), register = vi.fn(), modules: string[] = [];
  const context = {
    exports: {}, process: { env, argv: ['node', 'playwright', ...args] },
    require(name: string) {
      modules.push(name);
      if (name === '@playwright/test') return { test: { skip: skipped } };
      if (name === '../helpers/queryResultColumnsUi') return { bindQueryResultColumnsUiTarget, queryResultColumnsUiKeys };
      if (name === './query-result-organize-live') return { registerQueryResultOrganizeUi: register };
      throw Error('禁止未知依赖或真实原生资源');
    }
  };
  const run = () => runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { run, env, skipped, register, modules };
}

it.each(['DBARK_INTEGRATION_ENABLED', 'DBARK_QUERY_RESULT_COLUMNS_UI', 'DBARK_QUERY_RESULT_SELECTED_FILTER_UI'])('%s缺失时只登记默认关闭占位，不读取认证或加载runtime', key => {
  const f = fixture({ [key]: undefined, DBARK_TEST_PASSWORD: undefined });
  f.run(); expect(f.skipped).toHaveBeenCalledOnce(); expect(f.modules).toEqual(['@playwright/test']); expect(f.register).not.toHaveBeenCalled();
});

it.each(['0', '', 'true'])('第三门为%j不视为显式授权', value => {
  const f = fixture({ DBARK_QUERY_RESULT_SELECTED_FILTER_UI: value, DBARK_TEST_PASSWORD: undefined });
  f.run(); expect(f.skipped).toHaveBeenCalledOnce(); expect(f.modules).toEqual(['@playwright/test']);
});

it.each(['--list', '--list=true'])('%s只登记占位，不读取认证或加载runtime', flag => {
  const f = fixture({ DBARK_TEST_PASSWORD: undefined, DBARK_QUERY_COLUMNS_OUT_DIR: undefined }, [flag]);
  f.run(); expect(f.skipped).toHaveBeenCalledOnce(); expect(f.modules).toEqual(['@playwright/test']); expect(f.register).not.toHaveBeenCalled();
});

it('三门齐全才将真实绑定和selectedFilter选项交给runtime哨兵，默认不启用命名方案', () => {
  const f = fixture(); f.run(); expect(f.skipped).not.toHaveBeenCalled(); expect(f.register).toHaveBeenCalledOnce();
  const [binding, options] = f.register.mock.calls[0];
  expect(options).toEqual({ selectedFilter: true }); expect(binding.target).toMatchObject({ host: '192.168.31.200', port: 13384, user: 'synthetic', password: '仅内存合成值' });
  binding.assertCurrent(); expect(f.modules).toEqual(['@playwright/test', '../helpers/queryResultColumnsUi', './query-result-organize-live']);
});

it.each(['0', undefined])('第三门变化为%j后即使恢复也永久停链', value => {
  const f = fixture(); f.run(); const binding = f.register.mock.calls[0][0]; binding.assertCurrent();
  if (value === undefined) delete f.env.DBARK_QUERY_RESULT_SELECTED_FILTER_UI;
  else f.env.DBARK_QUERY_RESULT_SELECTED_FILTER_UI = value;
  expect(() => binding.assertCurrent()).toThrow('永久停链');
  f.env.DBARK_QUERY_RESULT_SELECTED_FILTER_UI = '1'; expect(() => binding.assertCurrent()).toThrow('永久停链');
});

it.each(['DBARK_INTEGRATION_ENABLED', 'DBARK_QUERY_RESULT_COLUMNS_UI', 'DBARK_TEST_PASSWORD'])('真实绑定继续撤销%s漂移，改回不能复活', key => {
  const f = fixture(); f.run(); const binding = f.register.mock.calls[0][0], previous = f.env[key];
  f.env[key] = '发生变化'; expect(() => binding.assertCurrent()).toThrow();
  f.env[key] = previous; expect(() => binding.assertCurrent()).toThrow();
});

it.each([{ DBARK_TEST_PASSWORD: undefined }, { DBARK_TEST_PORT: '3306' }, { DBARK_TEST_HOST: '127.0.0.1' }, { DBARK_TEST_DATABASE: '业务库' }, { DBARK_QUERY_COLUMNS_CSV_PATH: '其它文件.csv' }])('三门不能绕过原准确目标和文件答案校验：%j', change => {
  const f = fixture(change); expect(f.run).toThrow(); expect(f.register).not.toHaveBeenCalled(); expect(f.modules).not.toContain('./query-result-organize-live');
});
