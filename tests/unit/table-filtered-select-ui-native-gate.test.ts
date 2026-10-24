import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../e2e/table-filtered-select.spec.ts', import.meta.url), 'utf8');
type Gate = {
  filteredSelectUiActive(env: NodeJS.ProcessEnv, args: readonly string[]): boolean;
  assertFilteredSelectUiEnvironment(env: NodeJS.ProcessEnv, args: readonly string[], platform: string): void;
  bindFilteredSelectUiEnvironment(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }): { assertCurrent(): void };
};

/** 转译实际spec：动态live与所有外部资源都是RAM哨兵，绝不加载正式桌面。 */
function fixture(values: NodeJS.ProcessEnv = {}, args: string[] = [], forbidReads = false, activeResources = false) {
  const modules: string[] = [], reads: string[] = [], skip = vi.fn(), register = vi.fn(), exported = {};
  const env = new Proxy(values, { get(target, key: string) { reads.push(key); if (forbidReads || !activeResources && !['DBARK_INTEGRATION_ENABLED', 'DBARK_FILTERED_SELECT_UI'].includes(key)) throw Error('默认/list读取了认证或资源配置'); return target[key]; } });
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: exported, process: { env, argv: ['node', 'playwright', ...args], platform: 'win32' },
    require(name: string) { modules.push(name); if (name === '@playwright/test') return { test: { skip } }; if (activeResources && name === './table-filtered-select-live') return { registerTableFilteredSelectUiTests: register }; throw Error('默认/list加载了真实模块：' + name); },
  });
  return { gate: exported as Gate, modules, reads, skip, register };
}

/** 全部值仅在内存合成，不读当前运行环境或真实凭据。 */
function environment(): NodeJS.ProcessEnv {
  return { DBARK_INTEGRATION_ENABLED: '1', DBARK_FILTERED_SELECT_UI: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成用户', DBARK_TEST_PASSWORD: '', DBARK_TEST_DATABASE: 'dbark_filteredselectui_' + 'a'.repeat(32), DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001', DBARK_FILTERED_SELECT_OWNER: 'dbark-filtered-select:' + 'b'.repeat(32), DBARK_FILTERED_SELECT_MANIFEST: 'D:\\isolated\\source.json', DBARK_FILTERED_SELECT_MANIFEST_SHA256: 'c'.repeat(64), DBARK_FILTERED_SELECT_OUTPUT: 'D:\\isolated\\output' };
}

describe('当前筛选SELECT正式窗口门（纯RAM，不代表GUI或实库验收）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_FILTERED_SELECT_UI: '1' }, { DBARK_INTEGRATION_ENABLED: '1', DBARK_FILTERED_SELECT_UI: 'true' }])('缺双门只登记跳过，不读取认证：%j', values => {
    const current = fixture(values); expect(current.skip).toHaveBeenCalledOnce(); expect(current.modules).toEqual(['@playwright/test']); expect(current.register).not.toHaveBeenCalled();
  });
  it.each(['list', '--list', '--list=true'])('%s早于任何环境读取或资源加载', flag => {
    const current = fixture(environment(), [flag], true); expect(current.skip).toHaveBeenCalledOnce(); expect(current.reads).toEqual([]); expect(current.modules).toEqual(['@playwright/test']);
  });
  it('准确双门只交给live已冻结绑定，不在spec连接或启动', () => {
    const current = fixture(environment(), ['--trace=off'], false, true); expect(current.skip).not.toHaveBeenCalled(); expect(current.modules).toEqual(['@playwright/test', './table-filtered-select-live']); expect(current.register).toHaveBeenCalledOnce();
  });
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_FILTERED_SELECT_OWNER', 'DBARK_FILTERED_SELECT_MANIFEST', 'DBARK_FILTERED_SELECT_MANIFEST_SHA256', 'DBARK_FILTERED_SELECT_OUTPUT'])('准确目标与来源不能被任意值替换：%s', key => {
    const gate = fixture().gate; expect(() => gate.assertFilteredSelectUiEnvironment({ ...environment(), [key]: 'other' }, [], 'win32')).toThrow();
  });
  it.each(['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_TEST_SSH', 'DBARK_TEST_CA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'])('替代环境即使空值仍拒绝：%s', key => {
    expect(() => fixture().gate.assertFilteredSelectUiEnvironment({ ...environment(), [key]: '' }, [], 'win32')).toThrow();
  });
  it.each([['--trace=on'], ['--trace', 'retain-on-failure'], ['--config=other.ts'], ['-cother.ts'], ['--ui'], ['--debug']].map(args => ({ args })))('拒绝CLI绕行：$args', ({ args }) => {
    expect(() => fixture().gate.assertFilteredSelectUiEnvironment(environment(), args, 'win32')).toThrow();
  });
  it('大小写别名和非Windows均拒绝', () => {
    const gate = fixture().gate; expect(() => gate.assertFilteredSelectUiEnvironment({ ...environment(), dbark_test_host: 'other' }, [], 'win32')).toThrow(); expect(() => gate.assertFilteredSelectUiEnvironment(environment(), [], 'darwin')).toThrow();
  });
  it('环境、argv或键存在性漂移后永久停链', () => {
    for (const change of ['port', 'args', 'key'] as const) {
      const gate = fixture().gate, env = environment(), args: string[] = [];
      const binding = gate.bindFilteredSelectUiEnvironment(() => ({ env, args, platform: 'win32' })); binding.assertCurrent();
      if (change === 'port') env.DBARK_TEST_PORT = '3306'; else if (change === 'args') args.push('--workers=2'); else env.DBARK_FILTERED_SELECT_EXTRA = '';
      expect(() => binding.assertCurrent()).toThrow(); env.DBARK_TEST_PORT = '13384'; args.length = 0; delete env.DBARK_FILTERED_SELECT_EXTRA; expect(() => binding.assertCurrent()).toThrow();
    }
  });
});
