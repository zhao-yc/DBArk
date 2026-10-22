import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { bindSavedQueryOrganizationNative, savedQueryOrganizationNativeGate } from '../helpers/savedQueryOrganizationNative';

/** RAM中的Windows路径与实际平台隔离；不读取清单、凭据或启动原生进程。 */
function env(): NodeJS.ProcessEnv { return { [savedQueryOrganizationNativeGate]: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_QUERY_ORGANIZATION_OUTPUT: 'D:\\DBArk\\.cache\\dbark-query-organization-' + 'a'.repeat(32), DBARK_QUERY_ORGANIZATION_MANIFEST: 'D:\\DBArk\\.cache\\approved.json', DBARK_QUERY_ORGANIZATION_MANIFEST_SHA256: 'a'.repeat(64) }; }
it('独立五键仅授权离线源码专项，不读取数据库或认证', () => { const binding = bindSavedQueryOrganizationNative(() => ({ env: env(), args: [], platform: 'win32' })); binding.assertCurrent(); expect(binding.target.sha).toHaveLength(64); });
it.each(Object.keys(env()))('缺少%s拒绝', key => { const values = env(); delete values[key]; expect(() => bindSavedQueryOrganizationNative(() => ({ env: values, args: [], platform: 'win32' }))).toThrow(); });
it.each(['DBARK_TEST_PASSWORD', 'DBARK_USER_DATA', 'DBARK_DEV_URL', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'dbark_query_organization_native_test'])('额外参数%s即使空值也拒绝', key => { const values = { ...env(), [key]: '' }; expect(() => bindSavedQueryOrganizationNative(() => ({ env: values, args: [], platform: 'win32' }))).toThrow(); });
it.each(['--config=other', '--workers=2', '--retries=1', '--repeat-each=2', '--trace=on', '--ui'])('运行器覆盖%s拒绝', argument => { expect(() => bindSavedQueryOrganizationNative(() => ({ env: env(), args: [argument], platform: 'win32' }))).toThrow(); });
it('访问器不执行，原配置改变再恢复仍停链', () => { const values = env(), getter = vi.fn(() => 'secret'); Object.defineProperty(values, 'DBARK_QUERY_ORGANIZATION_OUTPUT', { get: getter }); expect(() => bindSavedQueryOrganizationNative(() => ({ env: values, args: [], platform: 'win32' }))).toThrow(); expect(getter).not.toHaveBeenCalled(); const plain = env(); let platform = 'win32'; const binding = bindSavedQueryOrganizationNative(() => ({ env: plain, args: [], platform })); platform = 'darwin'; expect(() => binding.assertCurrent()).toThrow(); platform = 'win32'; expect(() => binding.assertCurrent()).toThrow('停链'); });
it.each([{ args: [], values: {} }, { args: ['--list'], values: { [savedQueryOrganizationNativeGate]: '1' } }])('真实spec默认或列表零重依赖加载：%j', ({ args, values }) => {
  const source = readFileSync(new URL('../e2e/saved-query-organization.spec.ts', import.meta.url), 'utf8'), skip = vi.fn(), require = vi.fn((name: string) => { if (name === '@playwright/test') return { test: { skip } }; throw Error('禁止加载原生依赖'); });
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: {}, require, process: { argv: args, env: values } });
  expect(skip).toHaveBeenCalledOnce(); expect(require.mock.calls).toEqual([['@playwright/test']]);
});
