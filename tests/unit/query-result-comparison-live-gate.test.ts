import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve, join } from 'node:path';
import ts from 'typescript';
import { bindQueryResultColumnsUiTarget, queryResultColumnsUiKeys } from '../helpers/queryResultColumnsUi';
import * as comparison from '../helpers/queryResultComparisonUi';

const source = readFileSync(new URL('../e2e/query-result-comparison.spec.ts', import.meta.url), 'utf8');
const helperSource = readFileSync(new URL('../helpers/queryResultComparisonUi.ts', import.meta.url), 'utf8');
const transpile = (value: string) => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

/** 执行实际spec声明；桌面仅登记回调，捕获owner时即抛哨兵，绝不启动资源。 */
function fixture(change: Record<string, string | undefined> = {}, args: string[] = []) {
  const output = resolve('.cache/dbark-query-columns-' + 'b'.repeat(32));
  const env: Record<string, string | undefined> = { DBARK_INTEGRATION_ENABLED: '1', DBARK_QUERY_RESULT_COLUMNS_UI: '1', DBARK_QUERY_RESULT_COMPARISON_LIVE: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'synthetic', DBARK_TEST_PASSWORD: '仅RAM合成值', DBARK_TEST_EXPECTED_SERVER_UUID: '11111111-1111-4111-8111-111111111111', DBARK_QUERY_COLUMNS_OUT_DIR: output, DBARK_QUERY_COLUMNS_CSV_PATH: join(output, 'visible-selected.csv'), DBARK_QUERY_COLUMNS_JSON_PATH: join(output, 'visible-selected.json'), ...change };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const modules: string[] = [], hooks: { owner?: { check(closed: boolean): void } } = {}, registered = vi.fn();
  const test = Object.assign(registered, { skip: vi.fn(), use: vi.fn(), setTimeout: vi.fn(), describe: { configure: vi.fn() }, afterEach: vi.fn() });
  const resource = { page: {}, application: {}, closed: false };
  const context = { exports: {}, process: { env, argv: ['node', 'playwright', ...args] }, require(name: string) {
    modules.push(name);
    if (name === '@playwright/test') return { test, expect: () => { throw Error('禁止执行原生断言'); } };
    if (name === '../helpers/queryResultColumnsUi') return { bindQueryResultColumnsUiTarget, queryResultColumnsUiKeys };
    if (name === '../helpers/queryResultComparisonUi') return { ...comparison, QueryResultComparisonLifetime: class { constructor(owner: any) { hooks.owner = owner; throw Error('RAM_OWNER_CAPTURE'); } } };
    if (name === './desktop-fixture') return { test, ownedDesktopResources: () => resource };
    if (name.startsWith('../../src/renderer/locales/') || ['node:fs/promises', 'node:path', 'mysql2/promise', '../../src/engine/connection'].includes(name)) return {};
    throw Error('禁止未知依赖或原生资源');
  } };
  const run = () => runInNewContext(transpile(source), context);
  const captureOwner = async () => { const body = registered.mock.calls[0][1]; await expect(body({ trace: 'off', screenshot: 'off', video: 'off' }, {})).rejects.toThrow('RAM_OWNER_CAPTURE'); if (!hooks.owner) throw Error('未捕获原授权owner'); return hooks.owner; };
  return { env, modules, test, registered, hooks, run, captureOwner };
}

it.each(['DBARK_INTEGRATION_ENABLED', 'DBARK_QUERY_RESULT_COLUMNS_UI', 'DBARK_QUERY_RESULT_COMPARISON_LIVE'])('%s缺失时不读认证、不加载桌面', key => {
  const f = fixture({ [key]: undefined, DBARK_TEST_PASSWORD: undefined }); f.run(); expect(f.test.skip).toHaveBeenCalledOnce(); expect(f.modules).toEqual(['@playwright/test']);
});
it.each(['--list', '--list=true'])('%s仅登记关闭占位，不读取目标或加载桌面', flag => {
  const f = fixture({ DBARK_TEST_PASSWORD: undefined, DBARK_QUERY_COLUMNS_OUT_DIR: undefined }, [flag]); f.run(); expect(f.modules).toEqual(['@playwright/test']); expect(f.test.skip).toHaveBeenCalledOnce(); expect(f.registered).not.toHaveBeenCalled();
});
it.each(['0', '', 'true'])('第三门%j不作为授权', value => { const f = fixture({ DBARK_QUERY_RESULT_COMPARISON_LIVE: value }); f.run(); expect(f.modules).toEqual(['@playwright/test']); });
it.each([{ DBARK_TEST_HOST: '127.0.0.1' }, { DBARK_TEST_PORT: '3306' }, { DBARK_TEST_PASSWORD: undefined }, { DBARK_TEST_DATABASE: '业务库' }, { DBARK_QUERY_COLUMNS_CSV_PATH: '其它路径' }])('准确绑定拒绝错误配置后不加载desktop：%j', change => {
  const f = fixture(change); expect(f.run).toThrow(); expect(f.modules).not.toContain('./desktop-fixture');
});
it('三门只登记原120秒、零重试及失败保留，不运行任何资源', () => {
  const f = fixture(); f.run(); expect(f.test.setTimeout).toHaveBeenCalledWith(120000); expect(f.test.describe.configure).toHaveBeenCalledWith({ retries: 0 }); expect(f.test.use).toHaveBeenCalledWith({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); expect(f.registered).toHaveBeenCalledOnce();
});
it.each(['DBARK_QUERY_RESULT_COMPARISON_LIVE', 'DBARK_QUERY_RESULT_COLUMNS_UI', 'DBARK_TEST_PASSWORD'])('实际owner观察%s漂移后改回仍永久停链', async key => {
  const f = fixture(); f.run(); const owner = await f.captureOwner(), previous = f.env[key]; owner.check(false); f.env[key] = '已变化'; expect(() => owner.check(false)).toThrow('停链'); f.env[key] = previous; expect(() => owner.check(false)).toThrow('停链');
});

/** 运行新helper真实Main审计；原handler只提供明确RAM回包，不加载Electron或数据库。 */
function audit() {
  const context: any = { exports: {}, Date }; runInNewContext(transpile(helperSource), context);
  const handlers = new Map<string, any>(), session = '本例会话', sender = { id: 7 };
  const result = { results: [{ truncated: false, columns: ['id', 'huge', 'amount', 'nullable_value', 'bytes'].map((name, index) => ({ key: 'c' + index, name, type: 'VAR_STRING' })), rows: [{}, {}, {}] }] };
  const original = vi.fn(async (_event: unknown, request: any): Promise<any> => ({ ok: true, result: request.command === 'sessions.open' ? { sessionId: session } : request.command === 'query.execute' ? result : {} }));
  handlers.set('dbark:request', original);
  context.exports.installComparisonAudit({ ipcMain: { _invokeHandlers: handlers } }, { senderId: 7, profileId: 'c', tabId: 't', sqls: [comparison.comparisonLeftSql, comparison.comparisonRightSql], maxRows: 1000, deadline: Date.now() + 120000 });
  const send = (command: string, input: any, eventSender = sender) => handlers.get('dbark:request')({ sender: eventSender }, { command, input });
  const execute = (side: 'left' | 'right', taskId: string = side) => send('query.execute', { sessionId: session, sql: side === 'left' ? comparison.comparisonLeftSql : comparison.comparisonRightSql, taskId, maxRows: 1000 });
  return { send, execute, original, session, handlers, context, result };
}
it('准确两条常量查询同会话成功，任务完成名单只能是这两条', async () => {
  const f = audit(); await f.send('sessions.open', { connectionId: 'c' }); await f.execute('left'); await f.execute('right'); expect(f.context.exports.readComparisonAudit()).toEqual({ queries: 2, pending: 0, revision: 0 });
  comparison.queryResultComparisonTasks([{ id: 'left', kind: 'query.execute', status: 'completed' }, { id: 'right', kind: 'query.execute', status: 'completed' }]);
  expect(() => comparison.queryResultComparisonTasks([])).toThrow(); await expect(f.execute('right', 'third')).rejects.toThrow('停链'); expect(f.original).toHaveBeenCalledTimes(3);
});
it.each(['query.executeParameterized', 'query.exportStream', 'query.transaction', 'files.choose', 'table.page', 'connections.save'])('其它执行或写入路径%s在原handler前永久拒绝', async command => {
  const f = audit(); await expect(f.send(command, {})).rejects.toThrow('停链'); expect(f.original).not.toHaveBeenCalled(); await expect(f.send('tasks.list', {})).rejects.toThrow('停链');
});
it('会话领取在await前消费，重复请求不能开第二个真实会话', async () => {
  const f = audit(); let release!: (value: any) => void; f.original.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = f.send('sessions.open', { connectionId: 'c' }); const rejected = expect(pending).rejects.toThrow('停链');
  await expect(f.send('sessions.open', { connectionId: 'c' })).rejects.toThrow('停链'); release({ ok: true, result: { sessionId: f.session } }); await rejected; expect(f.original).toHaveBeenCalledOnce();
});
it('取消只允许尚未结束的准确任务一次，不能解锁第二会话或第三查询', async () => {
  const f = audit(); await f.send('sessions.open', { connectionId: 'c' }); let release!: (value: any) => void;
  f.original.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); const pending = f.execute('left'); const rejected = expect(pending).rejects.toThrow('停链');
  await f.send('query.cancel', { taskId: 'left' }); await expect(f.send('query.cancel', { taskId: 'left' })).rejects.toThrow('停链'); release({ ok: true, result: f.result }); await rejected;
});
it('原handler或窗口身份变化后迟到回包不能成为成功证据', async () => {
  const f = audit(); let release!: (value: any) => void; f.original.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = f.send('sessions.open', { connectionId: 'c' }), rejected = expect(pending).rejects.toThrow('停链'); f.handlers.set('dbark:request', f.original); release({ ok: true, result: { sessionId: f.session } }); await rejected;
});
it('新生命周期只以准确两任务、原窗口退出及原观察流关闭结算', async () => {
  let closed = false;
  const owner = { check: vi.fn(), closed: () => closed, retain: vi.fn(), exit: vi.fn(async () => { closed = true; }) }, closeObserver = vi.fn(async () => {});
  const life = new comparison.QueryResultComparisonLifetime(owner, { _startWallTime: 0, timeout: 120000, status: 'passed' }, () => 1);
  await life.finish(async () => [{ id: 'left', kind: 'query.execute', status: 'completed' }, { id: 'right', kind: 'query.execute', status: 'completed' }], closeObserver);
  life.endBody(); life.afterEach(); expect(owner.exit).toHaveBeenCalledOnce(); expect(closeObserver).toHaveBeenCalledOnce(); expect(owner.retain).not.toHaveBeenCalled();
});
it('任务证据缺失时永久保留，不在finally补退出或关闭未知观察流', async () => {
  const owner = { check: vi.fn(), closed: () => false, retain: vi.fn(), exit: vi.fn(async () => {}) }, closeObserver = vi.fn(async () => {});
  const life = new comparison.QueryResultComparisonLifetime(owner, { _startWallTime: 0, timeout: 120000, status: 'passed' }, () => 1);
  await expect(life.finish(async () => [], closeObserver)).rejects.toThrow(); life.endBody(); expect(() => life.afterEach()).toThrow(); expect(owner.retain).toHaveBeenCalledOnce(); expect(owner.exit).not.toHaveBeenCalled(); expect(closeObserver).not.toHaveBeenCalled();
});
