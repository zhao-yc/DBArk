import { sidebarMenuRegistrationPort } from '../helpers/sidebarMenuRamPort';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { batchFillCaseNames, bindBatchFillTarget, batchFillTargetKeys, BatchFillPreparation } from '../helpers/tableBatchFillLive';

const source = readFileSync(new URL('../e2e/table-batch-fill.spec.ts', import.meta.url), 'utf8');
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
/** 仅解释真实声明门；未许可模块是立即抛错的哨兵，绝不调用GUI用例主体。 */
function declare(env: Record<string, string | undefined>, argv: string[] = []) {
  const loaded: string[] = [], skipped: string[] = [], registered = vi.fn();
  function requireModule(name: string) {
    loaded.push(name);
    if (name === '@playwright/test') return { test: { skip: (title: string) => skipped.push(title) } };
    if (name === '../helpers/tableBatchFillLive') return { bindBatchFillTarget };
    if (name === './table-batch-fill-live') return { registerTableBatchFill: registered };
    throw Error('未授权模块：' + name);
  }
  runInNewContext(compile(source), { require: requireModule, exports: {}, process: { env, argv } });
  return { loaded, skipped, registered };
}
/** 全为合成RAM参数，既不使用环境中的真实值，也不读取任何凭据文件。 */
function environment(): Record<string, string | undefined> {
  return { DBARK_INTEGRATION_ENABLED: '1', DBARK_D02_BATCH_FILL_UI: '1', DBARK_BATCH_FILL_SERVER_VERIFIED: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成账号', DBARK_TEST_PASSWORD: '合成测试值', DBARK_TEST_EXPECTED_SERVER_UUID: '11111111-2222-3333-4444-555555555555' };
}

it.each([{ argv: [] }, { argv: ['--list'] }, { argv: ['--list=true'] }])('默认关闭或列表$argv不读取实跑参数、不加载桌面或驱动', ({ argv }) => {
  const env = new Proxy({}, { get(_target, key) { if (!argv.length && key === 'DBARK_INTEGRATION_ENABLED') return undefined; throw Error('关闭门读取了配置'); } });
  const result = declare(env, argv);
  expect(result.loaded).toEqual(['@playwright/test']); expect(result.skipped).toEqual(batchFillCaseNames); expect(result.registered).not.toHaveBeenCalled();
});
it.each([{ DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_D02_BATCH_FILL_UI: '1' }])('仅一层门%s开启仍不加载实跑模块', env => {
  const result = declare(env); expect(result.loaded).toEqual(['@playwright/test']); expect(result.skipped).toEqual(batchFillCaseNames);
});
it('双门且参数完整才向正式注册器交付绑定；注册不执行用例', () => {
  const result = declare(environment()); expect(result.skipped).toEqual([]); expect(result.registered).toHaveBeenCalledOnce();
  expect(result.loaded).toEqual(['@playwright/test', '../helpers/tableBatchFillLive', './table-batch-fill-live']);
  expect(() => result.registered.mock.calls[0][0].assertCurrent()).not.toThrow();
});
it('双门缺少服务器已核声明时，在加载实跑模块前拒绝', () => {
  const env = environment(); delete env.DBARK_BATCH_FILL_SERVER_VERIFIED;
  expect(() => declare(env)).toThrow('仅允许本轮已核');
});
it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID'])('缺少显式%s时不能靠默认值或旧文件补齐', key => {
  const env = environment(); delete env[key]; expect(() => bindBatchFillTarget(() => env)).toThrow('仅允许本轮已核');
});
it.each([
  ['DBARK_TEST_HOST', '其他服务器'], ['DBARK_TEST_PORT', '3306'], ['DBARK_TEST_TLS', '1'], ['DBARK_TEST_EXPECTED_SERVER_UUID', '未知'],
  ['DBARK_TEST_DATABASE', 'dbark_旧库'], ['DBARK_TEST_CA', '旧证书'], ['DBARK_TEST_SSH', '1'], ['DBARK_DEV_URL', 'http://localhost:1'], ['DBARK_EXECUTABLE_PATH', '未固定安装产物'],
])('非本轮精确目标或旧入口%s被拒绝', (key, value) => {
  const env = { ...environment(), [key]: value }; expect(() => bindBatchFillTarget(() => env)).toThrow('仅允许本轮已核');
});
it('继承账号及访问器不能成为自有许可，也不调用访问器读取秘密', () => {
  const env = environment(), user = env.DBARK_TEST_USER; delete env.DBARK_TEST_USER; Object.setPrototypeOf(env, { DBARK_TEST_USER: user });
  expect(() => bindBatchFillTarget(() => env)).toThrow('仅允许本轮已核');
  const getter = vi.fn(() => '不可读取'); Object.defineProperty(env, 'DBARK_TEST_PASSWORD', { get: getter });
  expect(() => bindBatchFillTarget(() => env)).toThrow('显式自有字符串'); expect(getter).not.toHaveBeenCalled();
});
it.each(batchFillTargetKeys)('观察到%s漂移后，即使恢复也不能复活', key => {
  const env = environment(), binding = bindBatchFillTarget(() => env), present = Object.hasOwn(env, key), old = env[key];
  env[key] = '改变'; expect(() => binding.assertCurrent()).toThrow('目标已失效');
  if (present) env[key] = old; else delete env[key]; expect(() => binding.assertCurrent()).toThrow('目标已失效');
});
it('旧帮助器环境回填不能替代本轮参数，且失败后不接纳恢复', () => {
  const env = environment(), binding = bindBatchFillTarget(() => env), helper = { ...env, DBARK_TEST_DATABASE: 'dbark_旧库' };
  expect(() => binding.assertHelper(helper)).toThrow('目标已失效'); expect(() => binding.assertHelper(env)).toThrow('目标已失效');
});
it('合法源模式可通过原始环境与帮助器一致性核对', () => {
  const env = environment(), binding = bindBatchFillTarget(() => env); binding.assertCurrent(); binding.assertHelper({ ...env });
  expect(binding.target.port).toBe(13384); expect(Object.isFrozen(binding.target)).toBe(true);
});
it.each(['超时', '回退时钟', '原起点改变', '框架失败', '期限改变'] as const)('准备阶段%s后永久停链', mode => {
  const info = { _startWallTime: 100, timeout: 120000, status: 'passed' }; let now = 101;
  const preparation = new BatchFillPreparation(info, () => now); preparation.assertCurrent();
  if (mode === '超时') now = 120100;
  else if (mode === '回退时钟') now = 100;
  else if (mode === '原起点改变') info._startWallTime++;
  else if (mode === '框架失败') info.status = 'failed';
  else info.timeout++;
  expect(() => preparation.assertCurrent()).toThrow('准备期限已失效');
  now = 102; info._startWallTime = 100; info.timeout = 120000; info.status = 'passed'; expect(() => preparation.assertCurrent()).toThrow('准备期限已失效');
});
it('缺少原TestInfo起点拒绝；合法同起点准备不无条件拦截', () => {
  expect(() => new BatchFillPreparation({ timeout: 120000, status: 'passed' }, () => 1).assertCurrent()).toThrow('准备期限已失效');
  const preparation = new BatchFillPreparation({ _startWallTime: 0, timeout: 120000, status: 'passed' }, () => 119999); expect(() => preparation.assertCurrent()).not.toThrow();
});

it('真实正式模块注册原两例与多字段两例并交付严格准备门，不启动窗口、连接或用例主体', () => {
  const env = environment(), binding = bindBatchFillTarget(() => env), names: string[] = [];
  const use = vi.fn(), configure = vi.fn(), forbidden = vi.fn(() => { throw Error('注册阶段不得运行真实端口'); });
  const test = Object.assign((name: string, _body: unknown) => names.push(name), { use, describe: { configure } });
  const exports: Record<string, any> = {};
  const live = readFileSync(new URL('../e2e/table-batch-fill-live.ts', import.meta.url), 'utf8');
  runInNewContext(compile(live), { exports, require(name: string) {
    // 对象树菜单是显式RAM展示依赖，不加载Playwright或计作原生/认证模块。
    if (name === './sidebar-menu') return sidebarMenuRegistrationPort;
    if (name === 'mysql2') return { default: { createConnection: forbidden } };
    if (name === '../../src/engine/connection') return { closeMysqlConnection: forbidden };
    if (name === './desktop-fixture') return { test, expect, ownedDesktopResources: forbidden, retainOwnedDesktopResources: forbidden };
    if (name === './live-helpers') return { environment: { ...env }, isolatedDatabase: forbidden };
    if (name === '../helpers/tableBatchFillLive') return { batchFillCaseNames, BatchFillPreparation };
    if (name.startsWith('../../src/renderer/locales/')) return {};
    throw Error('注册阶段未许可模块：' + name);
  } });
  exports.registerTableBatchFill(binding);
  expect(names).toEqual(batchFillCaseNames); expect(configure).toHaveBeenCalledWith({ mode: 'serial', timeout: 120000, retries: 0 });
  expect(use).toHaveBeenCalledWith(expect.objectContaining({ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true }));
  const guard = use.mock.calls[0][0].ownedDesktopLaunchGuard, info = { _startWallTime: Date.now(), timeout: 120000, status: 'passed' };
  guard.assertCurrent(); guard.assertPreparation(info); info.status = 'failed'; expect(() => guard.assertPreparation(info)).toThrow('准备期限已失效');
  expect(forbidden).not.toHaveBeenCalled();
});
