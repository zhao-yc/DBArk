import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { bindResultInsertTarget, createResultInsertSqlAudit, planResultInsertFixture, resultInsertExpectedDml, resultInsertIntegrationGate, resultInsertPrecisionData } from '../helpers/resultInsertIntegration';

/** 只有RAM合成身份和密码，不访问真实认证、配置或服务器。 */
function environment(): Record<string, string | undefined> {
  return { DBARK_INTEGRATION_ENABLED: '1', [resultInsertIntegrationGate]: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'synthetic', DBARK_TEST_PASSWORD: '仅RAM合成值', DBARK_TEST_EXPECTED_SERVER_HOSTNAME: 'synthetic-server', DBARK_TEST_EXPECTED_SERVER_ID: '1', DBARK_TEST_EXPECTED_SERVER_PORT: '3306', DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001' };
}

/** 实际专项源在VM登记后调用原测试体；动态helper/Engine/mysql加载均为立即失败的哨兵。 */
function gateFixture(values: Record<string, string | undefined>, args: string[] = [], forbidAllReads = false) {
  const source = readFileSync(new URL('../integration/result-insert.test.ts', import.meta.url), 'utf8');
  const modules: string[] = [], reads: string[] = [], bodies: ((context: unknown) => Promise<void>)[] = [], options: unknown[] = [];
  const env = new Proxy(values, { get(target, key: string) {
    reads.push(key);
    if (forbidAllReads || key !== 'DBARK_INTEGRATION_ENABLED' && key !== resultInsertIntegrationGate) throw Error('默认或list读取了认证配置');
    return target[key];
  } });
  const skip = vi.fn(), test = (_name: string, settings: unknown, body: (context: unknown) => Promise<void>) => { options.push(settings); bodies.push(body); };
  const context = { exports: {}, process: { env, argv: ['node', 'vitest', ...args] }, require(name: string) {
    modules.push(name);
    if (name === 'vitest') return { afterEach: vi.fn(), describe: { sequential: (_name: string, body: () => void) => body() }, it: test, vi: { hoisted: (action: () => unknown) => action(), mock: vi.fn() } };
    throw Error('默认或list加载了真实资源：' + name);
  } };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { modules, reads, options, skip, async run() { expect(bodies).toHaveLength(1); await bodies[0]({ skip }); } };
}

describe('已返回结果直接插入独立实库门（纯RAM）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { [resultInsertIntegrationGate]: '1' }, { DBARK_INTEGRATION_ENABLED: '1', [resultInsertIntegrationGate]: 'true' }])('缺双门不读取认证或加载Engine：%j', async values => {
    const fixture = gateFixture(values); await fixture.run(); expect(fixture.skip).toHaveBeenCalledOnce(); expect(fixture.modules).toEqual(['vitest']); expect(fixture.options).toEqual([{ timeout: 120000, retry: 0, repeats: 0 }]);
  });
  it.each(['list', '--list', '--list=true'])('%s在所有环境读取和真实模块加载之前短路', async flag => {
    const fixture = gateFixture(environment(), [flag], true); await fixture.run(); expect(fixture.skip).toHaveBeenCalledOnce(); expect(fixture.reads).toEqual([]); expect(fixture.modules).toEqual(['vitest']);
  });
  it.each(['13357', '13380', '13384', '13310', '13311'])('六实例中的非TLS准确端口%s只绑定不建连', port => {
    const raw = { ...environment(), DBARK_TEST_PORT: port }, binding = bindResultInsertTarget(() => raw, 'ram'); expect(binding.profile.port).toBe(Number(port)); binding.assertCurrent();
  });
  it('13484需要明确CA且不可关闭证书校验', () => {
    const raw = { ...environment(), DBARK_TEST_PORT: '13484', DBARK_TEST_TLS: '1', DBARK_TEST_CA: 'synthetic-ca.pem' };
    expect(bindResultInsertTarget(() => raw, 'ram').profile.tls).toEqual({ enabled: true, rejectUnauthorized: true, caPath: 'synthetic-ca.pem' });
    expect(() => bindResultInsertTarget(() => ({ ...raw, DBARK_TEST_CA: '' }), 'ram')).toThrow();
  });
  it.each([{ DBARK_INTEGRATION_ENABLED: '0' }, { [resultInsertIntegrationGate]: '0' }, { DBARK_TABLE_VALUE_OPTIONS_TEST: '1' }, { DBARK_FILTERED_SELECT_TEST: '1' }, { DBARK_TABLE_FILTERED_EXPORT_TEST: '1' }, { DBARK_QUERY_INSERT_INTEGRATION_ENABLED: '1' }, { DBARK_TEST_HOST: '127.0.0.1' }, { DBARK_TEST_PORT: '3306' }, { DBARK_TEST_DATABASE: 'business' }, { DBARK_TEST_USER: '' }, { DBARK_TEST_PASSWORD: undefined }, { DBARK_TEST_EXPECTED_SERVER_UUID: '' }, { NODE_OPTIONS: '--inspect' }])('其它用途、旁路或错误目标在建连前拒绝：%j', change => {
    expect(() => bindResultInsertTarget(() => ({ ...environment(), ...change }), 'ram')).toThrow();
  });
  it('门禁和身份漂移后恢复也不能复活', () => {
    const raw = environment(), binding = bindResultInsertTarget(() => raw, 'ram'); binding.assertCurrent(); raw[resultInsertIntegrationGate] = '0'; expect(() => binding.assertCurrent()).toThrow(); raw[resultInsertIntegrationGate] = '1'; expect(() => binding.assertCurrent()).toThrow();
  });
  it('隔离fixture与源RAM计划保存精度、展示重名、映射顺序和NULL空值', () => {
    const database = 'dbark_resultinsert_' + 'a'.repeat(32), marker = 'dbark-result-insert:' + 'b'.repeat(32), plan = planResultInsertFixture(database, marker), precise = resultInsertPrecisionData();
    expect(plan.objects).toEqual(['__owner', 'conflict', 'drift', 'nokey', 'precise']); expect(() => planResultInsertFixture('business', marker)).toThrow();
    expect(precise.data.rows).toHaveLength(3); expect(precise.data.rows[0].source_unsigned).toBe('18446744073709551615'); expect(precise.data.rows[1].source_unsigned).toBe('18446744073709551614');
    expect(precise.data.columns[1].name).toBe(precise.data.columns[2].name); expect(precise.data.columns[1].key).not.toBe(precise.data.columns[2].key); expect(precise.mapping[0]).toEqual({ source: 'source_decimal', target: 'amount' });
    expect(precise.data.rows[0].source_text).toBeNull(); expect(precise.data.rows[2].source_text).toBe(''); expect(precise.data.truncated).toBe(true);
  });
  it('精确INSERT白名单只放行本例原值和apply用途，preview绝不能借同一SQL写入', () => {
    const plan = planResultInsertFixture('dbark_resultinsert_' + 'a'.repeat(32), 'dbark-result-insert:' + 'b'.repeat(32)), writes = new Set<string>(), audit = createResultInsertSqlAudit(plan, writes, id => id === 7);
    const statement = resultInsertExpectedDml(plan)[0]; expect(() => audit.assert(statement.sql, statement.values, statement.scope)).not.toThrow();
    expect(() => audit.assert(statement.sql, statement.values, 'result.insertPreview:precise')).toThrow(); expect(() => audit.assert(statement.sql, statement.values, 'observer')).toThrow();
    expect(() => audit.assert(statement.sql, ['9007199254740992.123456789012', ...statement.values.slice(1)], statement.scope)).toThrow();
    expect(() => audit.assert(statement.sql.replace('`precise`', '`other`'), statement.values, statement.scope)).toThrow();
    expect(() => audit.assert(statement.sql, [...statement.values, 'extra'], statement.scope)).toThrow();
    expect(() => audit.assert(plan.creates[0], [], 'observer')).toThrow(); writes.add(plan.creates[0]); expect(() => audit.assert(plan.creates[0], [], 'observer')).not.toThrow();
    expect(() => audit.assert(plan.creates[0], [], 'result.insertApply:precise')).toThrow();
    for (const sql of ['SELECT 1', 'SELECT * FROM business.private', 'SHOW DATABASES', 'SET GLOBAL sql_mode = \'\'', 'DELETE FROM ' + plan.table('precise'), 'COMMIT; COMMIT', 'KILL QUERY 7']) expect(() => audit.assert(sql, [], 'result.insertApply:precise')).toThrow();
    expect(() => audit.assert('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [7], 'observer')).not.toThrow(); expect(() => audit.assert('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [8], 'observer')).toThrow();
  });
  it('严格session配置仅从观察者原模式一次绑定，不能由产品回包或泛化SET放行', () => {
    const plan = planResultInsertFixture('dbark_resultinsert_' + 'a'.repeat(32), 'dbark-result-insert:' + 'b'.repeat(32)), audit = createResultInsertSqlAudit(plan, new Set(), () => false);
    const sql = "SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO,STRICT_ALL_TABLES,STRICT_TRANS_TABLES'";
    expect(() => audit.assert(sql, [], 'result.insertApply:precise')).toThrow(); audit.bindInitialSqlMode('STRICT_TRANS_TABLES'); expect(() => audit.assert(sql, [], 'result.insertApply:precise')).not.toThrow();
    expect(() => audit.assert(sql, [], 'result.insertPreview:precise')).toThrow(); expect(() => audit.assert("SET SESSION sql_mode = ''", [], 'result.insertApply:precise')).toThrow(); expect(() => audit.bindInitialSqlMode('')).toThrow();
    expect(() => audit.assert('COMMIT', [], 'result.insertApply:conflict')).toThrow(); expect(() => audit.assert('COMMIT', [], 'result.insertApply:drift')).toThrow();
    expect(() => audit.assert('ROLLBACK', [], 'result.insertApply:conflict')).not.toThrow();
  });
  it('拒绝稀疏、访问器或附加字段的原参数，不读取getter', () => {
    const plan = planResultInsertFixture('dbark_resultinsert_' + 'a'.repeat(32), 'dbark-result-insert:' + 'b'.repeat(32)), audit = createResultInsertSqlAudit(plan, new Set(), () => false), statement = resultInsertExpectedDml(plan)[0];
    const sparse = new Array(statement.values.length); Object.assign(sparse, { extra: 'x' });
    const accessor = [...statement.values]; Object.defineProperty(accessor, '0', { get() { throw Error('不应读取getter'); }, enumerable: true });
    for (const values of [sparse, accessor, Object.assign([...statement.values], { extra: 'x' })]) expect(() => audit.assert(statement.sql, values, statement.scope)).toThrow();
  });
});
