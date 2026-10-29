import { sidebarMenuRegistrationPort, navigationMenuRegistrationPort } from '../helpers/sidebarMenuRamPort';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../e2e/table-filter-groups.spec.ts', import.meta.url), 'utf8');
/** 转译实际spec，只登记测试与授权hook；桌面和数据库加载都是RAM哨兵。 */
function fixture(change: Record<string, string | undefined> = {}, args: string[] = []) {
  const env: Record<string, string | undefined> = {
    DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_SORT_UI: '1', DBARK_TABLE_FILTER_GROUPS_UI: '1',
    DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_USER: 'synthetic', DBARK_TEST_PASSWORD: '仅RAM合成值',
    DBARK_TEST_DATABASE: 'dbark_e2e_' + 'a'.repeat(32), DBARK_TEST_EXPECTED_SERVER_UUID: 'f568f70e-c730-11f1-8190-3e6c830dde01', DBARK_TEST_TLS: '0', ...change
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const hooks: (() => void)[] = [], modules: string[] = [], registrations = vi.fn();
  const test = Object.assign(registrations, { beforeEach: (callback: () => void) => hooks.push(callback), skip: vi.fn(), use: vi.fn(), describe: { configure: vi.fn() } });
  const context: any = {
    exports: {}, process: { env, argv: ['node', 'playwright', ...args] }, structuredClone,
    require(name: string) {
    // 对象树菜单是显式RAM展示依赖，不加载Playwright或计作原生/认证模块。
    if (name === './sidebar-menu') return sidebarMenuRegistrationPort;
    if (name === './navigation-menu') return navigationMenuRegistrationPort;
      modules.push(name);
      if (name === '@playwright/test') return { test, expect: () => { throw Error('禁止执行真实测试体'); } };
      if (name === './desktop-fixture') return { test };
      if (name === 'node:crypto' || name.startsWith('../../src/renderer/locales/')) return {};
      throw Error('禁止加载原生或未知资源');
    }
  };
  const run = () => runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { env, modules, test, hooks, registrations, context, run };
}

it.each(['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_SORT_UI', 'DBARK_TABLE_FILTER_GROUPS_UI'])('%s缺失时默认关闭且不读取认证或加载桌面', key => {
  const f = fixture({ [key]: undefined, DBARK_TEST_PASSWORD: undefined }); f.run();
  expect(f.test.skip).toHaveBeenCalledWith(true, expect.any(String)); expect(f.modules).not.toContain('./desktop-fixture');
});
it.each(['--list', '--list=true'])('%s不读认证或加载桌面', flag => {
  const f = fixture({ DBARK_TEST_PASSWORD: undefined, DBARK_TEST_DATABASE: undefined }, [flag]); f.run();
  expect(f.test.skip).toHaveBeenCalledWith(true, expect.any(String)); expect(f.modules).not.toContain('./desktop-fixture');
});
it.each(['0', '', 'true'])('第三门%j不视为显式授权', value => {
  const f = fixture({ DBARK_TABLE_FILTER_GROUPS_UI: value, DBARK_TEST_PASSWORD: undefined }); f.run(); expect(f.modules).not.toContain('./desktop-fixture');
});
it.each([
  { DBARK_TEST_HOST: '127.0.0.1' }, { DBARK_TEST_PORT: '3306' }, { DBARK_TEST_USER: '' }, { DBARK_TEST_PASSWORD: undefined },
  { DBARK_TEST_DATABASE: '业务库' }, { DBARK_TEST_DATABASE: 'dbark_tablesort_' + 'a'.repeat(32) },
  { DBARK_TEST_EXPECTED_SERVER_UUID: '11111111-1111-4111-8111-111111111111' }, { DBARK_TEST_TLS: '1' }, { DBARK_TEST_SSH: '1' },
  { DBARK_TEST_CA: '证书路径' }, { DBARK_EXECUTABLE_PATH: '其它程序' }, { DBARK_DEV_URL: '' }
])('错误目标必须在desktop require前拒绝：%j', change => {
  const f = fixture(change); expect(f.run).toThrow(); expect(f.modules).not.toContain('./desktop-fixture'); expect(f.registrations).not.toHaveBeenCalled();
});
it('三门齐全仅登记单例、120秒与零重试，不执行原生体', () => {
  const f = fixture(); f.run(); expect(f.modules.filter(name => name === './desktop-fixture')).toHaveLength(1); expect(f.registrations).toHaveBeenCalledOnce();
  expect(f.test.describe.configure).toHaveBeenCalledWith({ timeout: 120000, retries: 0 }); expect(f.hooks).toHaveLength(1); f.hooks[0]();
});
it.each(['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_SORT_UI', 'DBARK_TABLE_FILTER_GROUPS_UI', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_DATABASE'])('实际授权hook观察%s漂移后恢复仍拒绝', key => {
  const f = fixture(); f.run(); const before = f.env[key]; f.hooks[0](); f.env[key] = '已变化'; expect(f.hooks[0]).toThrow('永久停链'); f.env[key] = before; expect(f.hooks[0]).toThrow('永久停链');
});

/** 实际Main观察器运行于VM，只调用RAM原handler替身；没有Electron、网络或数据库。 */
function observer() {
  const f = fixture(); f.run(); const handlers = new Map<string, any>();
  const original = vi.fn(async (_event: unknown, payload: any): Promise<any> => payload.command === 'table.page' ? { ok: true, result: { rows: [{ id: '1' }], hasMore: false, copySource: { status: 'ready', pageRef: 'page-' + payload.input.taskId } } } : { ok: true, result: undefined });
  handlers.set('dbark:request', original);
  f.context.observePages({ ipcMain: { _invokeHandlers: handlers } }, { database: f.env.DBARK_TEST_DATABASE, connectionId: 'c', senderId: 7 });
  const send = (command: string, input: any, senderId = 7) => handlers.get('dbark:request')({ sender: { id: senderId } }, { command, input });
  const target = { connectionId: 'c', database: f.env.DBARK_TEST_DATABASE, table: 'subject' };
  return { ...f, original, handlers, send, target };
}
it('列偏好只读允许准确目标，写入和其它对象在原handler前拒绝', async () => {
  const f = observer(); await f.send('table.preferences.get', f.target); expect(f.original).toHaveBeenCalledOnce();
  for (const [command, input] of [['table.preferences.get', { ...f.target, table: 'other' }], ['table.preferences.save', f.target], ['table.copySourceRead', f.target]] as const) await expect(f.send(command, input)).rejects.toThrow();
  expect(f.original).toHaveBeenCalledOnce();
});
it('只接纳真实原handler返回的pageRef，准确连接释放后消费，旧引用不复活', async () => {
  const f = observer(); await f.send('table.page', { ...f.target, taskId: 'one', filters: [], sort: [] });
  await expect(f.send('table.copySourceRelease', { connectionId: 'other', pageRef: 'page-one' })).rejects.toThrow();
  await expect(f.send('table.copySourceRelease', { connectionId: 'c', pageRef: '未接纳' })).rejects.toThrow();
  await f.send('table.copySourceRelease', { connectionId: 'c', pageRef: 'page-one' });
  await expect(f.send('table.copySourceRelease', { connectionId: 'c', pageRef: 'page-one' })).rejects.toThrow(); expect(f.original).toHaveBeenCalledTimes(2);
});
it('只有本轮准确pending任务可以取消一次，终态后不能再领取消权', async () => {
  const f = observer(); let complete!: (value: unknown) => void;
  f.original.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const pending = f.send('table.page', { ...f.target, taskId: 'pending', filters: [], sort: [] });
  await expect(f.send('query.cancel', { taskId: 'other' })).rejects.toThrow(); await f.send('query.cancel', { taskId: 'pending' });
  await expect(f.send('query.cancel', { taskId: 'pending' })).rejects.toThrow(); complete({ ok: true, result: { rows: [] } }); await pending;
  await expect(f.send('query.cancel', { taskId: 'pending' })).rejects.toThrow(); expect(f.original).toHaveBeenCalledTimes(2);
});
it('分页30次上限、窗口及原handler身份不能绕过', async () => {
  const f = observer();
  for (let index = 0; index < 30; index++) await f.send('table.page', { ...f.target, taskId: String(index), filters: [], sort: [] });
  await expect(f.send('table.page', { ...f.target, taskId: 'overflow', filters: [], sort: [] })).rejects.toThrow('预算');
  await expect(f.send('settings.get', {}, 8)).rejects.toThrow('原窗口'); expect(f.original).toHaveBeenCalledTimes(30);
  const previous = f.handlers.get('dbark:request'); f.handlers.set('dbark:request', f.original); await expect(previous({ sender: { id: 7 } }, { command: 'settings.get', input: {} })).rejects.toThrow('Main处理器');
});
