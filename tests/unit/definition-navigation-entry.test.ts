import { sidebarMenuRegistrationPort, sidebarMenuRamPort, navigationMenuRegistrationPort, navigationMenuRamPort } from '../helpers/sidebarMenuRamPort';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { databaseCreateZh as databaseText } from '../../src/renderer/locales/databaseCreate.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

/** 执行真实入口转译结果；拒绝任何未明确准许的模块加载。 */
function entry(argv: string[], environment: Record<string, string | undefined>, rejectTarget = false, denyEnvironment = false) {
  const loads: string[] = [], checks: unknown[] = [], skip = vi.fn();
  const source = readFileSync(resolve('tests/e2e/definition-navigation.spec.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const env = new Proxy(environment, { get(target, key: string) { if (denyEnvironment) throw Error('列举不得读取环境'); return target[key]; } });
  const run = () => vm.runInNewContext(code, { exports: {}, process: { argv, env }, require(name: string) {
    loads.push(name);
    if (name === '@playwright/test') return { test: { skip } };
    if (name === '../helpers/tableDefaultEncodingTarget') return { assertDefaultEncodingLiveTarget(value: unknown) { checks.push(value); if (rejectTarget) throw Error('测试目标未核对'); } };
    if (name === './definition-navigation-cases') return {};
    throw Error('关闭门不得加载模块：' + name);
  } });
  return { loads, checks, skip, run };
}

describe('W03正式定义导航入口的默认关闭与列举隔离', () => {
  it.each(['--list', '--list=true'])('列举%s优先短路，环境及桌面数据库认证模块读取均为零', flag => {
    const value = entry([flag], {}, false, true); expect(value.run).not.toThrow(); expect(value.loads).toEqual(['@playwright/test']); expect(value.skip).toHaveBeenCalledOnce();
  });
  it.each([[undefined, undefined], ['1', undefined], [undefined, '1'], ['0', '1']])('双门%s/%s未全开时不导入正式用例及私有夹具', (integration, purpose) => {
    const value = entry([], { DBARK_INTEGRATION_ENABLED: integration, DBARK_W03_DEFINITION_NAVIGATION_TEST: purpose }); expect(value.run).not.toThrow(); expect(value.loads).toEqual(['@playwright/test']); expect(value.checks).toHaveLength(0);
  });
  it('双门全开但目标未核对时不得加载用例或启动夹具', () => {
    const value = entry([], { DBARK_INTEGRATION_ENABLED: '1', DBARK_W03_DEFINITION_NAVIGATION_TEST: '1', DBARK_TEST_USER: '既有账号' }, true); expect(value.run).toThrow('测试目标未核对'); expect(value.loads).not.toContain('./definition-navigation-cases');
  });
  it('双门、显式账号和目标先通过，才加载原有八项正式用例', () => {
    const value = entry([], { DBARK_INTEGRATION_ENABLED: '1', DBARK_W03_DEFINITION_NAVIGATION_TEST: '1', DBARK_TEST_USER: '既有账号', DBARK_TEST_HOST: '已核对测试服务器', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0' });
    value.run(); expect(value.checks).toEqual([{ host: '已核对测试服务器', port: '13384', tlsFlag: '0', caPath: undefined }]); expect(value.loads.at(-1)).toBe('./definition-navigation-cases'); expect(value.skip).not.toHaveBeenCalled();
  });
});

it('正式分支保留八项原场景，并明确关闭轨迹和启用所属资源保留模式（仅注册不执行）', () => {
  const names: string[] = [], options: unknown[] = [], hooks: unknown[] = [];
  const test = Object.assign((name: string, _body: unknown) => names.push(name), { skip() {}, use: (value: unknown) => options.push(value), setTimeout() {}, beforeEach: (hook: unknown) => hooks.push(hook), afterEach: (hook: unknown) => hooks.push(hook) });
  const cases = resolve('tests/e2e/definition-navigation-cases.ts');
  const source = readFileSync(existsSync(cases) ? cases : resolve('tests/e2e/definition-navigation.spec.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: {}, require(name: string) {
    // 对象树菜单是显式RAM展示依赖，不加载Playwright或计作原生/认证模块。
    if (name === './sidebar-menu') return sidebarMenuRegistrationPort;
    if (name === './navigation-menu') return navigationMenuRegistrationPort;
    if (name === './desktop-fixture') return { test };
    if (name === './definition-navigation-live') return { enabled: true, environment: {} };
    if (name.endsWith('/tableDefaultEncodingTarget')) return {};
    if (name.endsWith('/definitionNavigation.zh-CN')) return {};
    throw Error('注册不得加载其它模块：' + name);
  } });
  expect(names).toHaveLength(8); expect(names.some(name => name.includes('延迟真实定义回包'))).toBe(true); expect(names.some(name => name.includes('真实CRLF正文'))).toBe(true);
  expect(options).toEqual([{ trace: 'off', screenshot: 'off', video: 'off', preserveOnUnconfirmedExit: true }]); expect(hooks).toHaveLength(2);
});

/** 调用真实connectAndCreate；页面只记录控件操作，不连接数据库、加载证书或启动Electron。 */
function formFixture(expireAfterFill = false, scenario?: 'success' | 'exitUnknown' | 'observerUnknown' | 'tasksPending' | 'applyFailed' | 'noCreate' | 'missingAck') {
  const actions: { path: string; action: string; value?: unknown }[] = [], checks: string[] = [], queries: unknown[] = []; let expired = false, evaluation = 0, retained = false, exited = false;
  const end = vi.fn(async () => {}), confirm = vi.fn(async () => { if (scenario === 'exitUnknown') throw Error('退出未确认'); exited = true; });
  const owner = { assertCurrent() { checks.push('核归属'); if (expired) throw Error('本例归属失效'); }, desktop: { browserWindow: async () => ({ evaluate: async () => 101, dispose: async () => {} }), evaluate: async (callback: Function) => callback.toString().includes("phase === \"confirmed\"") || callback.toString().includes("phase === 'confirmed'") ? scenario !== 'missingAck' : undefined }, page: undefined as any };
  const locator = (path: string): any => new Proxy({}, { get(_target, key: string) {
    if (key === 'then') return undefined;
    if (key === 'getByRole') return (role: string, options: { name: string } = { name: role }) => locator(path + '/' + role + ':' + options.name);
    if (key === 'getByLabel') return (label: string) => locator(path + '/标签:' + label);
    if (key === 'locator') return (value: string) => locator(path + '/' + value);
    if (key === 'filter') return () => locator(path);
    if (key === 'evaluate') return async () => ++evaluation === 1 ? [{ id: 'c', name: actions.find(item => item.path.endsWith('连接名称') && item.action === 'fill')!.value, port: 13384 }] : evaluation === 2 ? { version: '8.4.11', dialect: 'mysql' } : scenario === 'tasksPending' || scenario === 'applyFailed' ? [{ kind: 'schema.databaseCreate.apply', status: scenario === 'tasksPending' ? 'running' : 'failed' }] : [];
    return async (value?: unknown) => { actions.push({ path, action: key, value }); if (expireAfterFill && key === 'fill') expired = true; if (scenario === 'noCreate' && key === 'click' && path.endsWith(databaseText.preview)) throw Error('预览前失败，CREATE未发送'); };
  } }); owner.page = locator('页面');
  const exports: any = {}, source = readFileSync(resolve('tests/e2e/definition-navigation-live.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText + '\nconst isolatedOriginal = exports.isolatedDatabase; exports.isolatedDatabase = (body, info) => isolatedOriginal(body, Object.assign({_startWallTime:Date.now()}, info));', {
    exports, console: { info() {} }, process: { platform: 'win32', env: { DBARK_TEST_HOST: '已核对测试服务器', DBARK_TEST_PORT: '13384', DBARK_TEST_USER: '既有账号', DBARK_TEST_TLS: '0', DBARK_INTEGRATION_ENABLED: scenario ? '1' : '0', DBARK_W03_DEFINITION_NAVIGATION_TEST: scenario ? '1' : '0' } },
    require(name: string) {
    // 对象树菜单是显式RAM展示依赖，不加载Playwright或计作原生/认证模块。
    if (name === './sidebar-menu') return sidebarMenuRamPort;
    if (name === './navigation-menu') return navigationMenuRamPort;
      if (name === 'node:crypto') return { randomUUID() { if (scenario) return 'a'.repeat(32); throw Error('表单端口不生成资源'); } };
      if (name === 'node:fs') return new Proxy({}, { get() { throw Error('表单端口禁止证书或文件读取'); } });
      if (name === 'mysql2/promise') return { createConnection() { if (!scenario) throw Error('表单端口禁止实库'); return Promise.resolve({ query: async (sql: unknown) => { queries.push(sql); if (scenario === 'observerUnknown') throw Error('观察结果未知'); return [[]]; }, end }).then(raw => { if (!('connection' in raw)) Object.assign(raw, { connection: { stream: { closed: false, once() {}, removeListener() {}, end() {}, destroy() {} }, end() {}, destroy() {} } }); return raw; }); } };
      if (name.endsWith('/engine/connection')) return { closeMysqlConnection: async (native: any) => { await end(); native.stream.closed = true; } };
      if (name.endsWith('/databaseCreate.zh-CN')) return { databaseCreateZh: databaseText };
      if (name.endsWith('/zh-CN')) return { zh };
      if (name.endsWith('/tableDefaultEncodingTarget')) return { assertDefaultEncodingLiveTarget() { checks.push('核目标'); } };
      if (name === './desktop-fixture') return { page: owner.page, desktop: owner.desktop, closed: false, answerDialogs: async () => {}, quitDesktop: async () => { exited = true; }, pageErrors: [], ownedDesktopResources: () => { if (retained) throw Error('本例已停链'); return { page: owner.page, application: owner.desktop, closed: exited }; }, retainOwnedDesktopResources: () => { retained = true; }, confirmOwnedDesktopExit: confirm, expect: (actual: unknown) => ({ toHaveLength: (count: number) => expect(actual).toHaveLength(count), toEqual: (expected: unknown) => expect(actual).toEqual(expected), toBeHidden: async () => {}, toBeVisible: async () => {}, toContainText: async () => {}, toHaveText: async () => {} }) };
      throw Error('未授权模块：' + name);
    },
  });
  return { actions, checks, queries, end, confirm, retained: () => retained, run: () => exports.connectAndCreate('dbark_e2e_defnav_test', owner), isolated: (body: (context: any) => Promise<void> = async () => {}) => exports.isolatedDatabase(body, {}) };
}

describe('W03专用正式建库夹具复用当前真实表单流程（仅RAM端口）', () => {
  it('明确编码目录配对、只读预览、完整名称及两项确认后才能提交', async () => {
    const value = formFixture(); await value.run(); const actions = value.actions;
    expect(actions.some(item => item.path.includes('执行 SQL'))).toBe(false);
    const index = (label: string, action: string, expected?: unknown) => actions.findIndex(item => item.path.endsWith(label) && item.action === action && (expected === undefined || item.value === expected));
    const charset = index(databaseText.charset, 'selectOption', 'utf8mb4'), collation = index(databaseText.collation, 'selectOption', 'utf8mb4_bin'), preview = index(databaseText.preview, 'click'), confirmation = index(databaseText.confirmation, 'fill', 'dbark_e2e_defnav_test'), ackDdl = index(databaseText.ackDdl, 'check'), ackCreate = index(databaseText.ackCreate, 'check'), apply = index(databaseText.apply, 'click');
    expect(charset).toBeGreaterThan(-1); expect(collation).toBeGreaterThan(charset); expect(preview).toBeGreaterThan(collation); expect(confirmation).toBeGreaterThan(preview); expect(ackDdl).toBeGreaterThan(confirmation); expect(ackCreate).toBeGreaterThan(ackDdl); expect(apply).toBeGreaterThan(ackCreate); expect(value.checks.filter(item => item === '核归属').length).toBeGreaterThan(15);
  });
  it('首个异步表单回包后归属失效，立即拒绝继续点击或建库', async () => {
    const value = formFixture(true); await expect(value.run()).rejects.toThrow('本例归属失效'); expect(value.actions.filter(item => item.action === 'fill')).toHaveLength(1); expect(value.actions.some(item => item.path.endsWith(databaseText.preview) || item.path.endsWith(databaseText.apply))).toBe(false);
  });
});


describe('W03专用夹具本例归属及失败停链收尾（仅RAM端口）', () => {
  it('正常对照：本例任务终态、退出确认后只DROP自己的随机库并关闭观察端口', async () => {
    const value = formFixture(false, 'success'); await value.isolated(); expect(value.confirm).toHaveBeenCalledOnce(); expect(value.end).toHaveBeenCalledOnce(); expect(value.retained()).toBe(false);
    expect(value.queries).toHaveLength(3); expect((value.queries[1] as { sql: string }).sql).toMatch(/^DROP DATABASE IF EXISTS `dbark_e2e_defnav_[a-z0-9_]+`$/);
  });
  it.each(['exitUnknown', 'observerUnknown', 'tasksPending', 'applyFailed'] as const)('%s保留所属资源，禁止继续DROP或关闭观察端口', async scenario => {
    const value = formFixture(false, scenario); await expect(value.isolated()).rejects.toThrow(); expect(value.retained()).toBe(true); expect(value.end).not.toHaveBeenCalled(); expect(value.queries.some(item => typeof item === 'object' && item !== null && 'sql' in item && String(item.sql).startsWith('DROP'))).toBe(false);
    if (scenario !== 'exitUnknown') expect(value.confirm).not.toHaveBeenCalled();
  });
  it('原用例失败且退出未确认时同时保留两项原因，不覆盖首因', async () => {
    const value = formFixture(false, 'exitUnknown'); const reason = await value.isolated(async () => { throw Error('原断言失败'); }).catch((error: AggregateError) => error);
    expect(reason.errors.map((error: Error) => error.message)).toEqual(['原断言失败', '退出未确认']); expect(value.end).not.toHaveBeenCalled(); expect(value.retained()).toBe(true);
  });
});


it('仅确认原先不存在、CREATE未发送时不DROP；正常退出并严格关闭观察连接', async () => {
  const f = formFixture(false, 'noCreate'); await expect(f.isolated()).rejects.toThrow('CREATE未发送'); expect(f.confirm).toHaveBeenCalledOnce(); expect(f.end).toHaveBeenCalledOnce(); expect(f.queries).toHaveLength(1); expect(f.retained()).toBe(false);
});
it('已进入CREATE但准确ACK未确认时本地停链，不退出、不DROP或重放', async () => {
  const f = formFixture(false, 'missingAck'); await expect(f.isolated()).rejects.toThrow(); expect(f.retained()).toBe(true); expect(f.confirm).not.toHaveBeenCalled(); expect(f.end).not.toHaveBeenCalled(); expect(f.queries).toHaveLength(1);
});
it('已确认CREATE后的普通已知断言失败保留首因，仍允许本例正常收尾', async () => {
  const f = formFixture(false, 'success'); await expect(f.isolated(async () => { throw Error('已知断言失败'); })).rejects.toThrow('已知断言失败'); expect(f.confirm).toHaveBeenCalledOnce(); expect(f.end).toHaveBeenCalledOnce(); expect(f.queries).toHaveLength(3); expect(f.retained()).toBe(false);
});
