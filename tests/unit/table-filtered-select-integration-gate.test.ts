import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertTableFilteredSelectPreparedComparison, bindTableFilteredSelectTarget, createTableFilteredSelectAudit, filteredSelectCaseSql, filteredSelectModes, planTableFilteredSelectFixture, tableFilteredSelectCases, tableFilteredSelectGate } from '../helpers/tableFilteredSelectIntegration';

const source = readFileSync(new URL('../integration/table-filtered-select.test.ts', import.meta.url), 'utf8');

/** 转译实际专项登记并调用原测试体，所有动态资源require均为会立即失败的RAM哨兵。 */
function gateFixture(values: Record<string, string | undefined>, args: string[] = [], forbidAllReads = false) {
  const modules: string[] = [], reads: string[] = [], bodies: ((context: unknown) => Promise<void>)[] = [], options: unknown[] = [];
  const env = new Proxy(values, { get(target, key: string) {
    reads.push(key);
    if (forbidAllReads || key !== 'DBARK_INTEGRATION_ENABLED' && key !== tableFilteredSelectGate) throw Error('默认或list读取了认证配置');
    return target[key];
  } });
  const skip = vi.fn(), test = (_name: string, settings: unknown, body: (context: unknown) => Promise<void>) => { options.push(settings); bodies.push(body); };
  const mock = { hoisted: (action: () => unknown) => action(), mock: vi.fn() };
  const context = { exports: {}, process: { env, argv: ['node', 'vitest', ...args] }, require(name: string) {
    modules.push(name);
    if (name === 'vitest') return { afterEach: vi.fn(), describe: { sequential: (_name: string, body: () => void) => body() }, it: test, vi: mock };
    throw Error('默认或list加载了真实资源模块：' + name);
  } };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { modules, reads, options, bodies, skip, async run() { expect(bodies).toHaveLength(1); await bodies[0]({ skip }); } };
}

/** 只有RAM合成环境，没有加载真实凭据或默认配置。 */
function environment(): Record<string, string | undefined> {
  return { DBARK_INTEGRATION_ENABLED: '1', [tableFilteredSelectGate]: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'synthetic', DBARK_TEST_PASSWORD: '仅RAM合成值', DBARK_TEST_EXPECTED_SERVER_HOSTNAME: 'synthetic-server', DBARK_TEST_EXPECTED_SERVER_ID: '1', DBARK_TEST_EXPECTED_SERVER_PORT: '3306', DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001' };
}

describe('筛选SELECT实库默认关闭及准确隔离门（纯RAM）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { [tableFilteredSelectGate]: '1' }, { DBARK_INTEGRATION_ENABLED: '1', [tableFilteredSelectGate]: 'true' }])('缺双门不加载mysql、Engine、helper或认证：%j', async values => {
    const fixture = gateFixture(values); await fixture.run(); expect(fixture.skip).toHaveBeenCalledOnce(); expect(fixture.modules).toEqual(['vitest']); expect(fixture.options).toEqual([{ timeout: 120000, retry: 0, repeats: 0 }]);
  });
  it.each(['list', '--list', '--list=true'])('%s比所有环境访问和动态加载更早短路', async flag => {
    const fixture = gateFixture(environment(), [flag], true); await fixture.run(); expect(fixture.skip).toHaveBeenCalledOnce(); expect(fixture.reads).toEqual([]); expect(fixture.modules).toEqual(['vitest']);
  });
  it.each(['13357', '13380', '13384', '13310', '13311'])('准确非TLS隔离端口%s可绑定但不会建连', port => {
    const raw = { ...environment(), DBARK_TEST_PORT: port }; const binding = bindTableFilteredSelectTarget(() => raw, 'ram'); expect(binding.profile.port).toBe(Number(port)); binding.assertCurrent();
  });
  it('TLS13484必须提供CA并保持严格校验', () => {
    const raw = { ...environment(), DBARK_TEST_PORT: '13484', DBARK_TEST_TLS: '1', DBARK_TEST_CA: 'synthetic-ca.pem' };
    expect(bindTableFilteredSelectTarget(() => raw, 'ram').profile.tls).toEqual({ enabled: true, rejectUnauthorized: true, caPath: 'synthetic-ca.pem' });
    expect(() => bindTableFilteredSelectTarget(() => ({ ...raw, DBARK_TEST_CA: '' }), 'ram')).toThrow();
  });
  it.each([{ DBARK_INTEGRATION_ENABLED: '0' }, { [tableFilteredSelectGate]: '0' }, { DBARK_TABLE_VALUE_OPTIONS_TEST: '1' }, { DBARK_TABLE_FILTERED_EXPORT_TEST: '1' }, { DBARK_TEST_HOST: '127.0.0.1' }, { DBARK_TEST_PORT: '3306' }, { DBARK_TEST_DATABASE: 'business' }, { DBARK_TEST_USER: '' }, { DBARK_TEST_PASSWORD: undefined }, { DBARK_TEST_EXPECTED_SERVER_UUID: '' }, { NODE_OPTIONS: '--inspect' }])('错误目标或混用用途拒绝：%j', change => {
    expect(() => bindTableFilteredSelectTarget(() => ({ ...environment(), ...change }), 'ram')).toThrow();
  });
  it('目标及门禁变化后永久停链，即使恢复原值也不继续', () => {
    const raw = environment(), binding = bindTableFilteredSelectTarget(() => raw, 'ram'); binding.assertCurrent(); raw[tableFilteredSelectGate] = '0'; expect(() => binding.assertCurrent()).toThrow(); raw[tableFilteredSelectGate] = '1'; expect(() => binding.assertCurrent()).toThrow();
  });
});

describe('筛选SELECT专项准确SQL白名单（纯RAM，不代表服务器语义验收）', () => {
  const database = 'dbark_filteredselect_' + 'a'.repeat(32), marker = 'dbark-filtered-select:' + 'b'.repeat(32);
  const plan = planTableFilteredSelectFixture(database, marker), cases = tableFilteredSelectCases();
  it('只计划本例隔离库且保存精确邻值及原Unicode', () => {
    expect(plan.rows[0].big_value).toBe('18446744073709551615'); expect(plan.rows[1].big_value).toBe('18446744073709551614'); expect(plan.rows[0].amount).toBe('9007199254740993.123456789012'); expect(plan.rows[5].ci).toContain('\0中文😀');
    expect(() => planTableFilteredSelectFixture('business', marker)).toThrow(); expect(() => planTableFilteredSelectFixture(database, 'other')).toThrow();
  });
  it('独立模板保留16组四模式，嵌套组明确any且新SQL沿实际页文字量及数值CAST', () => {
    expect(cases).toHaveLength(16);
    expect(filteredSelectModes).toEqual(['', 'NO_BACKSLASH_ESCAPES', 'ANSI_QUOTES', 'NO_BACKSLASH_ESCAPES,ANSI_QUOTES']);
    const nested = cases.find(item => item.filterGroup)!; expect(nested.filterMode).toBe('any'); expect(nested.filterGroup!.mode).toBe('any');
    expect(filteredSelectCaseSql(database, nested).prepared).toContain(' WHERE (((`ci` IS NULL)) OR (`bin` IN (?, ?))) ORDER BY ');
    const numeric = filteredSelectCaseSql(database, cases[1]);
    expect(numeric.generated).toContain("CAST(CAST(_utf8mb4 X'3138343436373434303733373039353531363135' AS DECIMAL(20,0)) AS UNSIGNED)");
    for (const item of cases) expect(filteredSelectCaseSql(database, item).generated).not.toContain('CONVERT(');
  });
  it('仅精确SQL加原参数、准确scope和逐条登记fixture才可发送', () => {
    const writes = new Set<string>(), audit = createTableFilteredSelectAudit(plan, cases, writes, id => id === 7), item = cases[1], sql = filteredSelectCaseSql(database, item);
    expect(() => audit.assert(sql.prepared, item.values, 'observer')).not.toThrow(); expect(() => audit.assert(sql.generated, [], 'observer')).not.toThrow(); expect(() => audit.assert(sql.inline, [], 'table.page:one')).not.toThrow();
    expect(() => audit.assert(plan.creates[0], [], 'observer')).toThrow(); writes.add(plan.creates[0]); expect(() => audit.assert(plan.creates[0], [], 'observer')).not.toThrow(); expect(() => audit.assert(plan.creates[0], [], 'table.page:one')).toThrow();
    for (const statement of ['SELECT 1', 'SELECT * FROM business.secret', sql.generated + ' SELECT 1', sql.generated.replace(database, 'other'), 'SHOW DATABASES', 'SET GLOBAL sql_mode = \'\'', 'KILL QUERY 7']) expect(() => audit.assert(statement, [], 'observer')).toThrow();
    expect(() => audit.assert(sql.prepared, ['18446744073709551614'], 'observer')).toThrow(); expect(() => audit.assert(sql.generated, [], 'table.page:one')).toThrow();
    expect(() => audit.assert('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [7], 'observer')).not.toThrow(); expect(() => audit.assert('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [8], 'observer')).toThrow();
  });
  it('拒绝参数访问器、空洞及附加属性，不能通过相同表面长度绕过', () => {
    const audit = createTableFilteredSelectAudit(plan, cases, new Set(), () => false), item = cases[1], sql = filteredSelectCaseSql(database, item);
    const accessor = Object.defineProperty([], '0', { get() { throw Error('不能读取访问器'); }, enumerable: true });
    const sparse = new Array(1); Object.assign(sparse, { other: item.values[0] });
    for (const values of [accessor, sparse, Object.assign([...item.values], { extra: 'x' })]) expect(() => audit.assert(sql.prepared, values, 'observer')).toThrow('稠密');
  });
  it.each(['NO_BACKSLASH_ESCAPES', 'NO_BACKSLASH_ESCAPES,ANSI_QUOTES'])('仅准确LIKE在%s允许空prepared与完整原页[7,6]差异，并留下账本', mode => {
    const item = cases.find(value => value.name === 'LIKE反斜线服务器模式语义')!, actualPageRows = [plan.rows[6], plan.rows[5]];
    expect(assertTableFilteredSelectPreparedComparison({ item, mode, preparedRows: [], actualPageRows, fixtureRows: plan.rows })).toEqual({ mode, caseName: item.name, preparedIds: [], actualPageIds: [7, 6], reason: '原prepared LIKE与实际inline表页的既有NO_BACKSLASH_ESCAPES差异' });
    // 其它端口若原prepared与原页确实相等，仍按原相等门通过，不预设必须存在差异。
    expect(assertTableFilteredSelectPreparedComparison({ item, mode, preparedRows: actualPageRows, actualPageRows, fixtureRows: plan.rows })).toBeUndefined();
    expect(assertTableFilteredSelectPreparedComparison({ item, mode, preparedRows: [], actualPageRows: [], fixtureRows: plan.rows })).toBeUndefined();
  });
  it.each(['', 'ANSI_QUOTES'])('准确LIKE在%s原路径同为空记零差异，路径不等不能套用NBE账本', mode => {
    const item = cases.find(value => value.name === 'LIKE反斜线服务器模式语义')!;
    expect(assertTableFilteredSelectPreparedComparison({ item, mode, preparedRows: [], actualPageRows: [], fixtureRows: plan.rows })).toBeUndefined();
    expect(() => assertTableFilteredSelectPreparedComparison({ item, mode, preparedRows: [], actualPageRows: [plan.rows[6], plan.rows[5]], fixtureRows: plan.rows })).toThrow();
  });
  it('行缺失、倒序、字段损坏、额外行或非空prepared差异均不能借LIKE账本通过', () => {
    const item = cases.find(value => value.name === 'LIKE反斜线服务器模式语义')!, actualPageRows = [plan.rows[6], plan.rows[5]], mode = 'NO_BACKSLASH_ESCAPES';
    for (const rows of [[plan.rows[6]], [plan.rows[5], plan.rows[6]], [{ ...plan.rows[6], amount: '6.1' }, plan.rows[5]], [...actualPageRows, plan.rows[0]]]) {
      expect(() => assertTableFilteredSelectPreparedComparison({ item, mode, preparedRows: [], actualPageRows: rows, fixtureRows: plan.rows })).toThrow();
    }
    expect(() => assertTableFilteredSelectPreparedComparison({ item, mode, preparedRows: actualPageRows, actualPageRows: [], fixtureRows: plan.rows })).toThrow();
    expect(() => assertTableFilteredSelectPreparedComparison({ item, mode, preparedRows: [plan.rows[6]], actualPageRows, fixtureRows: plan.rows })).toThrow('未登记');
  });
  it('其它case、值、字段、排序、列序、行数上限或额外模式均不能套用已知差异', () => {
    const original = cases.find(value => value.name === 'LIKE反斜线服务器模式语义')!, actualPageRows = [plan.rows[6], plan.rows[5]];
    const changed = [cases[1], { ...original, filters: [{ column: 'ci', operator: 'LIKE' as const, value: '%\\%' }] }, { ...original, values: ['%_%'] }, { ...original, limit: 4 }, { ...original, columns: ['id'] }, { ...original, sort: [{ column: 'id', direction: 'DESC' as const }] }];
    for (const item of changed) expect(() => assertTableFilteredSelectPreparedComparison({ item, mode: 'NO_BACKSLASH_ESCAPES', preparedRows: [], actualPageRows, fixtureRows: plan.rows })).toThrow('未登记');
    expect(() => assertTableFilteredSelectPreparedComparison({ item: original, mode: 'NO_BACKSLASH_ESCAPES,STRICT_TRANS_TABLES', preparedRows: [], actualPageRows, fixtureRows: plan.rows })).toThrow('未登记');
  });
});
