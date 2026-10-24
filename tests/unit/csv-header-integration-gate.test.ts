import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { validateCommand } from '../../src/shared/validation';
import { bindCsvHeaderTarget, createCsvHeaderSqlAudit, csvHeaderCases, csvHeaderIntegrationGate, planCsvHeaderFixture } from '../helpers/csvHeaderIntegration';

/** 全部身份及认证为RAM合成值，不读取真实环境、凭据文件或数据库。 */
function environment(): Record<string, string | undefined> {
  return { DBARK_INTEGRATION_ENABLED: '1', [csvHeaderIntegrationGate]: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'synthetic', DBARK_TEST_PASSWORD: '仅RAM合成值', DBARK_TEST_EXPECTED_SERVER_HOSTNAME: 'synthetic-server', DBARK_TEST_EXPECTED_SERVER_ID: '1', DBARK_TEST_EXPECTED_SERVER_PORT: '3306', DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001' };
}

/** 执行真实专项源的原测试体；任何动态实库模块加载都触发哨兵失败。 */
function gateFixture(values: Record<string, string | undefined>, args: string[] = [], forbidAllReads = false) {
  const source = readFileSync(new URL('../integration/csv-header.test.ts', import.meta.url), 'utf8');
  const modules: string[] = [], reads: string[] = [], bodies: ((context: unknown) => Promise<void>)[] = [], options: unknown[] = [];
  const env = new Proxy(values, { get(target, key: string) {
    reads.push(key); if (forbidAllReads || key !== 'DBARK_INTEGRATION_ENABLED' && key !== csvHeaderIntegrationGate) throw Error('CSV默认或list读取了认证配置'); return target[key];
  } });
  const skip = vi.fn(), test = (_name: string, settings: unknown, body: (context: unknown) => Promise<void>) => { options.push(settings); bodies.push(body); };
  const context = { exports: {}, process: { env, argv: ['node', 'vitest', ...args] }, require(name: string) {
    modules.push(name);
    if (name === 'vitest') return { afterEach: vi.fn(), describe: { sequential: (_name: string, body: () => void) => body() }, it: test, vi: { hoisted: (action: () => unknown) => action(), mock: vi.fn() } };
    throw Error('CSV默认或list加载了真实资源：' + name);
  } };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { modules, reads, options, skip, async run() { expect(bodies).toHaveLength(1); await bodies[0]({ skip }); } };
}

describe('无标题CSV独立实库门及精确计划（纯RAM）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { [csvHeaderIntegrationGate]: '1' }, { DBARK_INTEGRATION_ENABLED: '1', [csvHeaderIntegrationGate]: 'true' }])('缺双门不读取认证或载入Engine：%j', async values => {
    const fixture = gateFixture(values); await fixture.run(); expect(fixture.skip).toHaveBeenCalledOnce(); expect(fixture.modules).toEqual(['vitest']); expect(fixture.options).toEqual([{ timeout: 120000, retry: 0, repeats: 0 }]);
  });
  it.each(['list', '--list', '--list=true'])('%s先于所有环境读取和真实模块载入短路', async flag => {
    const fixture = gateFixture(environment(), [flag], true); await fixture.run(); expect(fixture.skip).toHaveBeenCalledOnce(); expect(fixture.reads).toEqual([]); expect(fixture.modules).toEqual(['vitest']);
  });
  it.each(['13357', '13380', '13384', '13310', '13311'])('准确非TLS实例%s只绑定不建连', port => {
    const raw = { ...environment(), DBARK_TEST_PORT: port }, binding = bindCsvHeaderTarget(() => raw, 'ram'); expect(binding.profile.port).toBe(Number(port)); binding.assertCurrent();
  });
  it('13484必须明确CA且保持严格校验', () => {
    const raw = { ...environment(), DBARK_TEST_PORT: '13484', DBARK_TEST_TLS: '1', DBARK_TEST_CA: 'synthetic-ca.pem' };
    expect(bindCsvHeaderTarget(() => raw, 'ram').profile.tls).toEqual({ enabled: true, rejectUnauthorized: true, caPath: 'synthetic-ca.pem' });
    expect(() => bindCsvHeaderTarget(() => ({ ...raw, DBARK_TEST_CA: '' }), 'ram')).toThrow(); expect(() => bindCsvHeaderTarget(() => ({ ...raw, DBARK_TEST_TLS: '0' }), 'ram')).toThrow();
  });
  it.each([{ DBARK_INTEGRATION_ENABLED: '0' }, { [csvHeaderIntegrationGate]: '0' }, { DBARK_TABLE_VALUE_OPTIONS_TEST: '1' }, { DBARK_FILTERED_SELECT_TEST: '1' }, { DBARK_TABLE_FILTERED_EXPORT_TEST: '1' }, { DBARK_RESULT_INSERT_TEST: '1' }, { DBARK_QUERY_INSERT_INTEGRATION_ENABLED: '1' }, { DBARK_TEST_HOST: '127.0.0.1' }, { DBARK_TEST_PORT: '3306' }, { DBARK_TEST_DATABASE: 'business' }, { DBARK_TEST_USER: '' }, { DBARK_TEST_PASSWORD: undefined }, { DBARK_TEST_EXPECTED_SERVER_UUID: '' }, { NODE_OPTIONS: '--inspect' }])('混门、旁路或业务目标在建连前拒绝：%j', change => {
    expect(() => bindCsvHeaderTarget(() => ({ ...environment(), ...change }), 'ram')).toThrow();
  });
  it('配置漂移后恢复仍不可重启原owner', () => {
    const raw = environment(), binding = bindCsvHeaderTarget(() => raw, 'ram'); binding.assertCurrent(); raw[csvHeaderIntegrationGate] = '0'; expect(() => binding.assertCurrent()).toThrow(); raw[csvHeaderIntegrationGate] = '1'; expect(() => binding.assertCurrent()).toThrow();
  });
  it('独立fixture覆盖三编码三分隔符、首条重复/空值和显式同名目标映射', () => {
    const cases = csvHeaderCases(), matrix = cases.filter(item => item.name !== 'default-header' && item.name !== 'repeat-first' && item.name !== 'empty-first' && item.name !== 'blank-first');
    expect(cases).toHaveLength(13); expect(matrix).toHaveLength(9); expect(new Set(matrix.map(item => item.encoding + ':' + item.delimiter)).size).toBe(9); expect(cases.reduce((sum, item) => sum + item.expected.length, 0)).toBe(25);
    for (const item of matrix) {
      expect(item.csvHasHeader).toBe(false); expect(item.preview.rows[0]['第1列']).toBe('18446744073709551615'); expect(item.preview.rows[1]['第1列']).toBe('18446744073709551614');
      expect(item.preview.rows[0]['第2列']).toBe('123456789012345678.123456789012'); expect(item.preview.rows[0]['第3列']).toBe(`中文${item.delimiter}双"引号"\r\n跨行`);
      expect(item.preview.rows[0]['第4列']).toBeNull(); expect(item.preview.rows[1]['第4列']).toBe(''); expect(item.preview.rows[0]['第5列']).toBe('\\N'); expect(item.preview.rows[1]['第5列']).toBe('\\leading');
      expect(item.parameters[0][5]).toEqual(Buffer.from([0, 1, 255])); expect(item.expected[1].payload).toEqual({ type: 'binary', base64: '' });
    }
    expect(cases.find(item => item.name === 'default-header')?.csvHasHeader).toBeUndefined();
    const repeated = cases.find(item => item.name === 'repeat-first')!, empty = cases.find(item => item.name === 'empty-first')!;
    expect(repeated.preview.rows[0]).toEqual({ 第1列: '重复', 第2列: '重复', 第3列: '' }); expect(empty.preview.rows[0]).toEqual({ 第1列: '', 第2列: '', 第3列: '' });
    expect(repeated.mapping).toEqual({ 第1列: 'mapped_first', 第2列: '第1列', 第3列: 'empty_value' }); expect(cases.find(item => item.name === 'blank-first')?.preview).toEqual({ columns: ['第1列'], rows: [{ 第1列: '' }] });
  });
  it('跨批冲突用完整502条合法CSV，坏列数另案且不依赖流预读条数', () => {
    const plan = planCsvHeaderFixture('dbark_csvheader_' + 'a'.repeat(32), 'dbark-csv-header:' + 'b'.repeat(32));
    expect(plan.objects).toHaveLength(16); expect(plan.bad.parameters).toHaveLength(502); expect(plan.bad.parameters[500]).toEqual(['501', '批次501']); expect(plan.bad.parameters[501]).toEqual(['1', '第二批重复键']); expect(plan.bad.expected).toHaveLength(500);
    expect(plan.bad.preview.rows).toHaveLength(20); expect(plan.badColumns.text).toBe('1,第一条\n2,第二条\n3\n'); expect(plan.badColumns.parameters).toHaveLength(2);
    expect(() => planCsvHeaderFixture('business', plan.marker)).toThrow(); expect(() => planCsvHeaderFixture(plan.database, 'business')).toThrow();
  });
  it('精确INSERT只放行本例原参数与目标，预览无数据库执行权限', () => {
    const plan = planCsvHeaderFixture('dbark_csvheader_' + 'a'.repeat(32), 'dbark-csv-header:' + 'b'.repeat(32)), writes = new Set<string>(), policy = createCsvHeaderSqlAudit(plan, writes, id => id === 7), item = plan.cases[0];
    const statement = `INSERT INTO ${plan.table(item.table)} (\`unsigned_value\`, \`amount\`, \`text_value\`, \`null_value\`, \`literal_value\`, \`payload\`, \`tail_value\`) VALUES (?, ?, ?, ?, ?, ?, ?)`, scope = 'files.import:' + item.name;
    expect(() => policy.assert(statement, item.parameters[0], scope)).not.toThrow();
    for (const purpose of ['files.preview:' + item.name, 'observer', 'files.import:other']) expect(() => policy.assert(statement, item.parameters[0], purpose)).toThrow();
    expect(() => policy.assert(statement, ['18446744073709551614', ...item.parameters[0].slice(1)], scope)).toThrow(); expect(() => policy.assert(statement.replace('`' + item.table + '`', '`other`'), item.parameters[0], scope)).toThrow();
    expect(() => policy.assert(statement, [...item.parameters[0], 'extra'], scope)).toThrow(); expect(() => policy.assert('COMMIT', [], 'files.import:bad-columns')).toThrow(); expect(() => policy.assert('ROLLBACK', [], 'files.import:bad-columns')).not.toThrow();
    expect(() => policy.assert(plan.creates[0], [], 'observer')).toThrow(); writes.add(plan.creates[0]); expect(() => policy.assert(plan.creates[0], [], 'observer')).not.toThrow(); expect(() => policy.assert(plan.creates[0], [], scope)).toThrow();
    for (const statement of ['SELECT 1', 'SELECT * FROM business.private', 'SHOW DATABASES', "SET GLOBAL sql_mode = ''", 'DELETE FROM ' + plan.table(item.table), 'COMMIT; COMMIT', 'KILL QUERY 7']) expect(() => policy.assert(statement, [], scope)).toThrow();
    expect(() => policy.assert('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [7], 'observer')).not.toThrow(); expect(() => policy.assert('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [8], 'observer')).toThrow();
  });
  it('原参数拒绝稀疏、访问器和附加字段且不触发getter', () => {
    const plan = planCsvHeaderFixture('dbark_csvheader_' + 'a'.repeat(32), 'dbark-csv-header:' + 'b'.repeat(32)), policy = createCsvHeaderSqlAudit(plan, new Set(), () => false);
    const getter = vi.fn(() => 'x'), accessor = ['x']; Object.defineProperty(accessor, '0', { get: getter, enumerable: true });
    for (const values of [new Array(1), accessor, Object.assign(['x'], { extra: 'x' })]) expect(() => policy.assert('SELECT 1', values, 'observer')).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('公开契约只传布尔选项，路径仍必须由Main注入', () => {
    const input = { fileToken: 'synthetic-file', format: 'csv', encoding: 'utf8' };
    expect(validateCommand('files.preview', input)).toEqual(input); expect(validateCommand('files.preview', { ...input, csvHasHeader: false })).toEqual({ ...input, csvHasHeader: false });
    for (const extra of [{ csvHasHeader: 'false' }, { csvHasHeader: undefined }, { csvHasHeader: null }, { filePath: 'C:\\private.csv' }, { profile: {} }]) expect(() => validateCommand('files.preview', { ...input, ...extra })).toThrow();
    expect(() => validateCommand('files.preview', { ...input, format: 'json', csvHasHeader: false })).toThrow();
    const imported = { ...input, connectionId: 'synthetic', database: 'synthetic', table: 'target', taskId: 'synthetic-task', mapping: { 第1列: '第2列' }, csvHasHeader: false };
    expect(validateCommand('files.import', imported)).toEqual(imported); expect(() => validateCommand('files.import', { ...imported, format: 'json' })).toThrow();
  });
});
