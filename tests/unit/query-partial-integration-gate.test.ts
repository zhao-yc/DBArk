import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import { queryPartialEnabled, bindQueryPartialTarget, watchQueryPartialConnection, assertQueryPartialCommands, assertQueryPartialClosed, verifyQueryPartialPrecision, queryPartialValues } from '../helpers/queryPartialIntegration';

/** 只生成RAM配置，绝不读取本机真实环境或凭据文件。 */
function environment(port = '13384'): NodeJS.ProcessEnv {
  return { DBARK_INTEGRATION_ENABLED: '1', DBARK_QUERY_PARTIAL_TEST: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: port, DBARK_TEST_TLS: port === '13484' ? '1' : '0', DBARK_TEST_USER: 'RAM用户', DBARK_TEST_PASSWORD: 'RAM合成非凭据', DBARK_TEST_EXPECTED_SERVER_HOSTNAME: 'RAM主机', DBARK_TEST_EXPECTED_SERVER_ID: '1', DBARK_TEST_EXPECTED_SERVER_PORT: '3306', ...(['13310', '13311'].includes(port) ? {} : { DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-4000-8000-000000000001' }), ...(port === '13484' ? { DBARK_TEST_CA: 'D:\\仅RAM\\ca.pem' } : {}) };
}
/** 实际integration入口以RAM require端口收集；默认或list若载入live模块立即失败。 */
async function disabledEntry(args: string[], enabled: string) {
  const source = readFileSync(new URL('../integration/query-partial-outcome.test.ts', import.meta.url), 'utf8'), compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const imports: string[] = [], reads: string[] = [], skip = vi.fn(), mock = vi.fn(); let body!: (context: any) => Promise<unknown>;
  const sequential = (_name: string, action: () => void) => action();
  const env = new Proxy({ DBARK_INTEGRATION_ENABLED: enabled, DBARK_QUERY_PARTIAL_TEST: enabled }, { get(value, key: string) { reads.push(key); if (!Object.hasOwn(value, key)) throw Error('默认入口读取了额外凭据'); return value[key as keyof typeof value]; } });
  runInContext(compiled, createContext({ exports: {}, process: { argv: args, env }, require(name: string) {
    imports.push(name);
    if (name === 'vitest') return { afterEach: () => {}, describe: { sequential }, it: (...args: any[]) => { body = args.at(-1); }, vi: { hoisted: (action: () => unknown) => action(), mock } };
    if (name === '../helpers/queryPartialIntegration') return { queryPartialEnabled }; throw Error('默认入口不能载入live引擎或连接');
  } }));
  await body({ skip }); return { imports, reads, skip, mock };
}
/** 原生边界全为RAM；原query对象、字段、行和callback this仍按真实形状观察。 */
function observer(closePhysically = true) {
  const stream = Object.assign(new EventEmitter(), { closed: false }), query = new EventEmitter(), calls: unknown[][] = [];
  const original = vi.fn(function (...args: unknown[]) { calls.push(args); return query; });
  const native = Object.assign(new EventEmitter(), { stream, threadId: 7, query: original, execute: original });
  const close = vi.fn(async () => { if (closePhysically) { stream.closed = true; stream.emit('close'); } });
  const managed = { connection: native, close, resources: { snapshot: () => ({ confirmedClosed: stream.closed }) } } as unknown as ManagedConnection;
  let retained = false;
  const owner = { check: vi.fn(() => { if (retained) throw Error('原owner已停链'); }), stop: vi.fn(() => { retained = true; }) };
  const fact = watchQueryPartialConnection(managed, 'RAM原session', owner, () => ({ allowed: new Set(['SELECT 1', 'FAIL']), forbiddenTails: new Set(['TAIL']) }));
  return { native, managed, stream, query, calls, original, close, owner, fact };
}

describe('部分查询实库定义双门与原驱动透传RAM反例', () => {
  it.each(['list', '--list', '--list=json'])('%s先短路不读任何环境键', args => {
    const env = new Proxy({}, { get() { throw Error('list不能读取环境'); } }); expect(queryPartialEnabled([args], env)).toBe(false);
  });
  it('双门默认关闭只读取开关，不读密码或CA，真实入口不导入live', async () => {
    const result = await disabledEntry([], '0'); expect(result.skip).toHaveBeenCalledOnce(); expect(result.reads).toEqual(['DBARK_INTEGRATION_ENABLED']); expect(result.imports).toEqual(['vitest', '../helpers/queryPartialIntegration']);
    const listing = await disabledEntry(['list'], '1'); expect(listing.reads).toEqual([]); expect(listing.skip).toHaveBeenCalledOnce();
  });
  it.each(['13357', '13380', '13384', '13310', '13311', '13484'])('只显式绑定%s且TLS规则不降级', port => {
    const binding = bindQueryPartialTarget(() => environment(port), 'RAM本轮'); binding.assertCurrent(); expect(binding.profile.port).toBe(Number(port));
    expect(binding.profile.dialect).toBe(['13310', '13311'].includes(port) ? 'mariadb' : 'mysql'); expect(binding.profile.tls?.enabled === true).toBe(port === '13484');
    if (port === '13484') expect(binding.profile.tls).toMatchObject({ rejectUnauthorized: true, caPath: 'D:\\仅RAM\\ca.pem' });
  });
  it.each(['DBARK_TEST_SSH', 'DBARK_TEST_DATABASE', 'DBARK_DEV_URL', 'DBARK_USER_DATA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'dbark_test_password', 'DBARK_QUERY_PARTIAL_OTHER_TEST'])('额外%s即便空值也拒绝', key => {
    expect(() => bindQueryPartialTarget(() => ({ ...environment(), [key]: '' }), 'RAM')).toThrow('额外认证');
  });
  it('未知端口、TLS降级、缺UUID与环境ABA都不能放行', () => {
    expect(() => bindQueryPartialTarget(() => environment('3306'), 'RAM')).toThrow();
    expect(() => bindQueryPartialTarget(() => ({ ...environment('13484'), DBARK_TEST_TLS: '0' }), 'RAM')).toThrow();
    const missing = environment(); delete missing.DBARK_TEST_EXPECTED_SERVER_UUID; expect(() => bindQueryPartialTarget(() => missing, 'RAM')).toThrow();
    let env = environment(), binding = bindQueryPartialTarget(() => env, 'RAM'); env = { ...env, DBARK_TEST_HOST: '127.0.0.1' }; expect(() => binding.assertCurrent()).toThrow(); env = environment(); expect(() => binding.assertCurrent()).toThrow('永久停链');
  });
  it('原query({sql,rowsAsArray})原对象及fields/result Buffer引用完整透传，error不提前结算原end', async () => {
    const f = observer(), options = { sql: 'SELECT 1', rowsAsArray: true }, result = f.native.query(options), fields = [{ name: '重复' }, { name: '重复' }], bytes = Buffer.from('00ff', 'hex'), row = ['18446744073709551615', bytes], seen: unknown[] = [];
    expect(result).toBe(f.query); expect(f.calls[0][0]).toBe(options); result.on('fields', value => seen.push(value)); result.on('result', value => seen.push(value));
    f.query.emit('fields', fields, 0); f.query.emit('result', row, 0); f.query.emit('error', { code: 'ER_TEST', errno: 1, message: 'RAM首错' });
    expect(seen).toEqual([fields, row]); expect(seen[0]).toBe(fields); expect((seen[1] as unknown[])[1]).toBe(bytes); expect(f.fact.pending).toBe(1); expect(() => assertQueryPartialCommands([f.fact])).toThrow();
    f.query.emit('end'); await f.fact.commands[0].terminal; expect(f.fact.commands[0]).toMatchObject({ fields: 1, rows: 1, ended: true, errors: [{ code: 'ER_TEST', errno: 1, message: 'RAM首错' }] }); assertQueryPartialCommands([f.fact]);
  });
  it('callback参数数组和this精确原样，回调完成仍等原query.end，不改原回包', async () => {
    const f = observer(), params = ['RAM值'], context = {}, rows = [{ a: '9007199254740993' }], fields = [{ name: 'a' }], received: unknown[] = [];
    const callback = vi.fn(function (this: unknown, ...args: unknown[]) { received.push(this, ...args); });
    const result = f.native.query('SELECT 1', params, callback); expect(result).toBe(f.query); expect(f.calls[0][1]).toBe(params);
    (f.calls[0][2] as Function).call(context, null, rows, fields); expect(received).toEqual([context, null, rows, fields]); expect(received[2]).toBe(rows); expect(received[3]).toBe(fields); expect(f.fact.pending).toBe(1);
    f.query.emit('end'); await f.fact.commands[0].terminal; expect(callback).toHaveBeenCalledOnce(); expect(f.fact.commands[0].callbackCalls).toBe(1); assertQueryPartialCommands([f.fact]);
  });
  it('禁止尾句在调用原驱动前记录并阻断，后续不能通过恢复旧计划复活', () => {
    const f = observer(); expect(() => f.native.query('TAIL')).toThrow('禁止尾句'); expect(f.fact.tailsBlocked).toBe(1); expect(f.original).not.toHaveBeenCalled(); expect(() => f.native.query('SELECT 1')).toThrow('停链'); expect(f.original).not.toHaveBeenCalled();
  });
  it('query形状或原线程变化拒绝，计划外写不进入原驱动', () => {
    const f = observer(); expect(() => f.native.query('DROP DATABASE business')).toThrow('计划外SQL'); expect(f.original).not.toHaveBeenCalled();
    const changed = observer(); changed.native.threadId = 8; expect(() => changed.native.query('SELECT 1')).toThrow('身份变化'); expect(changed.original).not.toHaveBeenCalled();
    const getter = observer(), access = vi.fn(() => 'SELECT 1'); expect(() => getter.native.query(Object.defineProperty({}, 'sql', { get: access }))).toThrow('调用形状'); expect(access).not.toHaveBeenCalled();
  });
  it('只有真实原stream.close加原close返回及facade确认才算全释放', async () => {
    const f = observer(); await f.managed.close({ strict: true }); await f.fact.closed; assertQueryPartialClosed([f.fact]); expect(f.close).toHaveBeenCalledExactlyOnceWith({ strict: true });
    const unknown = observer(false); await unknown.managed.close({ strict: true }); expect(() => assertQueryPartialClosed([unknown.fact])).toThrow('物理资源');
  });
  it('独立精度期望检测重复alias被覆盖、BIGINT被转Number和不完整结果混入', () => {
    const v = queryPartialValues, columns = ['repeated', 'repeated', 'amount', 'happened', 'note', 'nullable_value', 'payload'].map((name, index) => ({ key: 'c' + index, name, type: 'RAM' }));
    const outcome = { elapsedMs: 1, results: [{ columns, rows: [{ c0: v.big, c1: v.signed, c2: v.decimal, c3: v.happened, c4: v.note, c5: null, c6: { type: 'binary' as const, base64: 'AP+AXCc=' } }], truncated: false, elapsedMs: 1, statement: 'RAM精度前序' }] };
    verifyQueryPartialPrecision(outcome, 1); expect(Buffer.from(v.blobHex, 'hex').toString('base64')).toBe('AP+AXCc=');
    const lost = structuredClone(outcome); Reflect.set(lost.results[0].rows[0], 'c0', Number(v.big)); expect(() => verifyQueryPartialPrecision(lost, 1)).toThrow();
    expect(() => verifyQueryPartialPrecision(outcome, 2)).toThrow('不完整语句');
  });
  it('原ERR的emoji表示变化不能掩盖中文参数部分泄露，完整value断言仍保留', () => {
    const prefix = '仅合成参数不进入错误摘要_中文', raw = { errno: 1062, code: 'ER_DUP_ENTRY', message: "Duplicate entry '仅合成参数不进入错误摘要_中文?' for key 'PRIMARY'" };
    expect(raw).toMatchObject({ errno: 1062, code: 'ER_DUP_ENTRY' }); expect(raw.message).toContain(prefix); expect(raw.message).not.toContain(queryPartialValues.parameter);
    const leakedSummary = '参数查询失败：' + raw.message;
    expect(leakedSummary).not.toContain(queryPartialValues.parameter); expect(leakedSummary).toContain(prefix);
    const hiddenSummary = '第 2 条 SQL 未完成；已完成 1 条。参数查询失败（ER_DUP_ENTRY）；服务器错误详情可能包含参数值，已隐藏';
    expect(hiddenSummary).not.toContain(queryPartialValues.parameter); expect(hiddenSummary).not.toContain(prefix);
  });
});
