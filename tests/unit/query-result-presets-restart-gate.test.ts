import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve, join } from 'node:path';
import ts from 'typescript';
import { bindQueryResultColumnsUiTarget, queryResultColumnsUiKeys } from '../helpers/queryResultColumnsUi';

const source = readFileSync(new URL('../e2e/query-result-presets-restart.spec.ts', import.meta.url), 'utf8');
/** 只执行原spec的声明与绑定；runtime加载是抛错哨兵，不准创建原生资源。 */
function fixture(change: Record<string, string | undefined> = {}, args: string[] = []) {
  const output = resolve('.cache/dbark-query-columns-' + 'a'.repeat(32));
  const env: Record<string, string | undefined> = { DBARK_INTEGRATION_ENABLED: '1', DBARK_QUERY_RESULT_COLUMNS_UI: '1', DBARK_QUERY_RESULT_PRESETS_RESTART_UI: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'synthetic', DBARK_TEST_PASSWORD: '仅内存合成值', DBARK_TEST_EXPECTED_SERVER_UUID: '11111111-1111-4111-8111-111111111111', DBARK_QUERY_COLUMNS_OUT_DIR: output, DBARK_QUERY_COLUMNS_CSV_PATH: join(output, 'visible-selected.csv'), DBARK_QUERY_COLUMNS_JSON_PATH: join(output, 'visible-selected.json'), DBARK_QUERY_PRESET_RESTART_MANIFEST: resolve('.cache/approved.json'), DBARK_QUERY_PRESET_RESTART_MANIFEST_SHA256: 'a'.repeat(64), ...change };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const skipped = vi.fn(), register = vi.fn(), modules: string[] = [];
  const context = { exports: {}, process: { env, argv: ['node', 'playwright', ...args], platform: process.platform }, require(name: string) { modules.push(name); if (name === '@playwright/test') return { test: { skip: skipped } }; if (name === '../helpers/queryResultColumnsUi') return { bindQueryResultColumnsUiTarget, queryResultColumnsUiKeys }; if (name === './query-result-presets-restart-live') return { registerQueryResultPresetsRestart: register }; throw Error('禁止未知依赖或原生资源'); } };
  const run = () => runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { run, env, context, skipped, register, modules };
}

it.each(['DBARK_INTEGRATION_ENABLED', 'DBARK_QUERY_RESULT_COLUMNS_UI', 'DBARK_QUERY_RESULT_PRESETS_RESTART_UI'])('%s未开时不读取认证或加载runtime', key => {
  const f = fixture({ [key]: undefined, DBARK_TEST_PASSWORD: undefined }); f.run(); expect(f.skipped).toHaveBeenCalledOnce(); expect(f.modules).toEqual(['@playwright/test']);
});
it.each(['--list', '--list=true'])('%s只登记占位，不读取凭据或身份清单', flag => {
  const f = fixture({ DBARK_TEST_PASSWORD: undefined, DBARK_QUERY_PRESET_RESTART_MANIFEST: undefined }, [flag]); f.run(); expect(f.modules).toEqual(['@playwright/test']); expect(f.register).not.toHaveBeenCalled();
});
it('原绑定只传批准清单和真实gate，漂移后即使改回也永久撤销', () => {
  const f = fixture(); f.run(); expect(f.register).toHaveBeenCalledOnce(); const [binding, approval] = f.register.mock.calls[0];
  expect(approval).toEqual({ manifestPath: f.env.DBARK_QUERY_PRESET_RESTART_MANIFEST, approvedHash: 'a'.repeat(64) }); binding.assertCurrent();
  f.env.DBARK_QUERY_RESULT_PRESETS_RESTART_UI = '0'; expect(() => binding.assertCurrent()).toThrow(); f.env.DBARK_QUERY_RESULT_PRESETS_RESTART_UI = '1'; expect(() => binding.assertCurrent()).toThrow();
});
it.each(['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'DBARK_DEV_URL', 'DBARK_USER_DATA', 'dbark_test_password'])('显式%s即使为空也在runtime前拒绝', key => {
  const f = fixture({ [key]: '' }); expect(f.run).toThrow(); expect(f.register).not.toHaveBeenCalled(); expect(f.modules).not.toContain('./query-result-presets-restart-live');
});
it.each(['--config=other.ts', '--config', '-c', '-cother.ts', '--ui', '--debug', '--trace=on', '--trace'])('CLI %s不能换配置或恢复交互录制', flag => {
  const f = fixture({}, [flag]); expect(f.run).toThrow(); expect(f.register).not.toHaveBeenCalled();
});
it('原argv或批准摘要变化后不能重新使用捕获binding', () => {
  const f = fixture(); f.run(); const binding = f.register.mock.calls[0][0]; f.context.process.argv.push('--trace=on'); expect(() => binding.assertCurrent()).toThrow();
  const g = fixture(); g.run(); g.env.DBARK_QUERY_PRESET_RESTART_MANIFEST_SHA256 = 'b'.repeat(64); expect(() => g.register.mock.calls[0][0].assertCurrent()).toThrow();
});
