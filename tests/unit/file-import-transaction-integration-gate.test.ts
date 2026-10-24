import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { bindFileImportTransactionTarget, createFileImportTransactionSqlAudit, fileImportTransactionIntegrationGate, planFileImportTransactionFixture } from '../helpers/fileImportTransactionIntegration';

/** 全部身份及认证为RAM合成值，不读取真实环境、凭据文件或数据库。 */
function environment(): Record<string, string | undefined> {
  return { DBARK_INTEGRATION_ENABLED: '1', [fileImportTransactionIntegrationGate]: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_USER: 'synthetic', DBARK_TEST_PASSWORD: '仅RAM合成值', DBARK_TEST_EXPECTED_SERVER_HOSTNAME: 'synthetic-server', DBARK_TEST_EXPECTED_SERVER_ID: '1', DBARK_TEST_EXPECTED_SERVER_PORT: '3306', DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-0000-0000-000000000001' };
}

/** 执行真实专项源的原测试体；任何动态实库模块加载都触发哨兵失败。 */
function gateFixture(values: Record<string, string | undefined>, args: string[] = [], forbidAllReads = false) {
  const source = readFileSync(new URL('../integration/file-import-transaction.test.ts', import.meta.url), 'utf8');
  const modules: string[] = [], reads: string[] = [], bodies: ((context: unknown) => Promise<void>)[] = [], options: unknown[] = [];
  const env = new Proxy(values, { get(target, key: string) {
    reads.push(key); if (forbidAllReads || key !== 'DBARK_INTEGRATION_ENABLED' && key !== fileImportTransactionIntegrationGate) throw Error('文件事务默认或list读取了认证配置'); return target[key];
  } });
  const skip = vi.fn(), test = (_name: string, settings: unknown, body: (context: unknown) => Promise<void>) => { options.push(settings); bodies.push(body); };
  const context = { exports: {}, process: { env, argv: ['node', 'vitest', ...args] }, require(name: string) {
    modules.push(name);
    if (name === 'vitest') return { afterEach: vi.fn(), describe: { sequential: (_name: string, body: () => void) => body() }, it: test, vi: { hoisted: (action: () => unknown) => action(), mock: vi.fn() } };
    throw Error('文件事务默认或list加载了真实资源：' + name);
  } };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { modules, reads, options, skip, async run() { expect(bodies).toHaveLength(1); await bodies[0]({ skip }); } };
}

describe('文件导入事务独立双门、精确源值及SQL作用域（纯RAM）', () => {
  it.each([{}, { DBARK_INTEGRATION_ENABLED: '1' }, { [fileImportTransactionIntegrationGate]: '1' }, { DBARK_INTEGRATION_ENABLED: '1', [fileImportTransactionIntegrationGate]: 'true' }])('缺双门不读认证或加载Engine：%j', async values => {
    const f = gateFixture(values); await f.run(); expect(f.skip).toHaveBeenCalledOnce(); expect(f.modules).toEqual(['vitest']); expect(f.options).toEqual([{ timeout: 120000, retry: 0, repeats: 0 }]);
  });
  it.each(['list', '--list', '--list=true'])('%s不读取任何环境或加载真实资源', async arg => { const f = gateFixture(environment(), [arg], true); await f.run(); expect(f.reads).toEqual([]); expect(f.modules).toEqual(['vitest']); expect(f.skip).toHaveBeenCalledOnce(); });
  it.each(['13357', '13380', '13384', '13310', '13311'])('准确非TLS端口%s只绑定不建连', port => { const raw = { ...environment(), DBARK_TEST_PORT: port }, binding = bindFileImportTransactionTarget(() => raw, 'ram'); expect(binding.profile.port).toBe(Number(port)); binding.assertCurrent(); });
  it('13484保持严格TLS，缺CA或关闭TLS均拒绝', () => {
    const raw = { ...environment(), DBARK_TEST_PORT: '13484', DBARK_TEST_TLS: '1', DBARK_TEST_CA: 'synthetic.pem' }; expect(bindFileImportTransactionTarget(() => raw, 'ram').profile.tls).toEqual({ enabled: true, rejectUnauthorized: true, caPath: 'synthetic.pem' });
    expect(() => bindFileImportTransactionTarget(() => ({ ...raw, DBARK_TEST_CA: '' }), 'ram')).toThrow(); expect(() => bindFileImportTransactionTarget(() => ({ ...raw, DBARK_TEST_TLS: '0' }), 'ram')).toThrow();
  });
  it.each([{ [fileImportTransactionIntegrationGate]: '0' }, { DBARK_INTEGRATION_ENABLED: '0' }, { DBARK_TEST_HOST: '127.0.0.1' }, { DBARK_TEST_PORT: '3306' }, { DBARK_TEST_DATABASE: 'business' }, { DBARK_TEST_PASSWORD: undefined }, { DBARK_TEST_USER: '' }, { DBARK_TEST_EXPECTED_SERVER_UUID: '' }, { NODE_OPTIONS: '--inspect' }, ...['DBARK_TABLE_VALUE_OPTIONS_TEST', 'DBARK_CSV_HEADER_TEST', 'DBARK_FILTERED_SELECT_TEST', 'DBARK_TABLE_FILTERED_EXPORT_TEST', 'DBARK_RESULT_INSERT_TEST', 'DBARK_QUERY_INSERT_INTEGRATION_ENABLED'].map(key => ({ [key]: '1' }))])('旁路/混门/未准备凭据建连前拒绝：%j', change => { expect(() => bindFileImportTransactionTarget(() => ({ ...environment(), ...change }), 'ram')).toThrow(); });
  it('配置漂移后恢复也不允许原owner复活', () => { const raw = environment(), binding = bindFileImportTransactionTarget(() => raw, 'ram'); raw[fileImportTransactionIntegrationGate] = '0'; expect(() => binding.assertCurrent()).toThrow(); raw[fileImportTransactionIntegrationGate] = '1'; expect(() => binding.assertCurrent()).toThrow(); });
  it('九个独立502行文件覆盖CSV/JSON整文件成功、校验、真实冲突、默认分批及原第500行取消', () => {
    const plan = planFileImportTransactionFixture('dbark_fileimporttx_' + 'a'.repeat(32), 'dbark-file-import-transaction:' + 'b'.repeat(32)); expect(plan.cases).toHaveLength(9); expect(plan.objects).toHaveLength(10); expect(new Set(plan.cases.map(item => item.table)).size).toBe(9); expect(new Set(plan.cases.map(item => item.text)).size).toBeGreaterThanOrEqual(6);
    expect(plan.cases.reduce((sum, item) => sum + item.inserts, 0)).toBe(4512); expect(plan.cases.reduce((sum, item) => sum + item.expected.length, 0)).toBe(2004);
    for (const format of ['csv', 'json']) { const cases = plan.cases.filter(item => item.format === format), success = cases.find(item => item.kind === 'success')!, invalid = cases.find(item => item.kind === 'invalid')!, duplicate = cases.find(item => item.kind === 'duplicate')!, batch = cases.find(item => item.kind === 'batch')!;
      expect(success.parameters).toHaveLength(502); expect(success.expected).toHaveLength(502); expect(success.commits).toBe(1); expect(success.rollbacks).toBe(0);
      expect(invalid.parameters).toHaveLength(501); expect(invalid.expected).toEqual([]); expect(invalid.commits).toBe(0); expect(invalid.text).toContain('123456789012345678.1234567890123');
      expect(duplicate.parameters).toHaveLength(502); expect(duplicate.parameters[501][0]).toBe(duplicate.parameters[0][0]); expect(duplicate.expected).toEqual([]);
      expect(batch).not.toHaveProperty('transactionMode'); expect(batch.expected).toHaveLength(500); expect(batch.parameters).toHaveLength(501); expect(batch.starts).toBe(2); expect(batch.commits).toBe(1); expect(batch.rollbacks).toBe(1);
      expect(success.parameters[0]).toEqual(['18446744073709550000', '123456789012345678.123456789012', null, null]); expect(success.parameters[1]).toEqual(['18446744073709550001', '-123456789012345678.123456789012', '', Buffer.alloc(0)]); expect(success.parameters[2][3]).toEqual(Buffer.from('0001ff805c27', 'hex')); expect(success.expected[2].payload).toEqual({ type: 'binary', base64: 'AAH/gFwn' }); expect(success.expected[3].note).toBe('\\N'); expect(success.expected[4].note).toContain('\r\n');
      if (format === 'json') { expect(success.text).toContain('"id":18446744073709550000'); expect(success.text).toContain('"amount":123456789012345678.123456789012'); } else expect(success.text).toContain('id,amount,note,payload\r\n');
    }
    const cancel = plan.cases.find(item => item.kind === 'cancel')!; expect(cancel).toMatchObject({ format: 'csv', inserts: 500, commits: 0, rollbacks: 1, expected: [] });
    expect(() => planFileImportTransactionFixture('business', plan.marker)).toThrow(); expect(() => planFileImportTransactionFixture(plan.database, 'business')).toThrow();
  });
  it('事务与写入必须匹配准确case/表/完整原参数，预览和旁路SQL都拒绝', () => {
    const plan = planFileImportTransactionFixture('dbark_fileimporttx_' + 'a'.repeat(32), 'dbark-file-import-transaction:' + 'b'.repeat(32)), writes = new Set<string>(), policy = createFileImportTransactionSqlAudit(plan, writes, id => id === 7), item = plan.cases[0], scope = 'files.import:' + item.name, insert = `INSERT INTO ${plan.table(item.table)} (\`id\`, \`amount\`, \`note\`, \`payload\`) VALUES (?, ?, ?, ?)`;
    expect(() => policy.assert(insert, item.parameters[0], scope)).not.toThrow(); expect(() => policy.assert('SELECT 1 FROM ' + plan.table(item.table) + ' LIMIT 0', [], scope)).not.toThrow(); expect(() => policy.assert('ROLLBACK', [], scope)).not.toThrow(); expect(() => policy.assert('COMMIT', [], scope)).toThrow();
    for (const other of ['observer', 'files.preview:' + item.name, 'files.import:other']) expect(() => policy.assert(insert, item.parameters[0], other)).toThrow();
    expect(() => policy.assert(insert, ['0', ...item.parameters[0].slice(1)], scope)).toThrow(); expect(() => policy.assert(insert, [...item.parameters[0], 'extra'], scope)).toThrow();
    expect(() => policy.assert(plan.creates[0], [], 'observer')).toThrow(); writes.add(plan.creates[0]); expect(() => policy.assert(plan.creates[0], [], 'observer')).not.toThrow(); expect(() => policy.assert(plan.creates[0], [], scope)).toThrow();
    for (const sql of ['SELECT 1', 'SELECT * FROM business.private', 'INSERT INTO business.private VALUES (1)', 'KILL QUERY 7', 'COMMIT;COMMIT', 'SHOW DATABASES', 'DELETE FROM ' + plan.table(item.table), "SET GLOBAL sql_mode=''", 'SELECT 1 INTO OUTFILE \'x\'']) expect(() => policy.assert(sql, [], scope)).toThrow();
    expect(() => policy.assert('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [7], 'observer')).not.toThrow(); expect(() => policy.assert('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [8], 'observer')).toThrow();
  });
  it('参数访问器、空洞和额外字段在读取值前拒绝', () => {
    const plan = planFileImportTransactionFixture('dbark_fileimporttx_' + 'a'.repeat(32), 'dbark-file-import-transaction:' + 'b'.repeat(32)), policy = createFileImportTransactionSqlAudit(plan, new Set(), () => false), getter = vi.fn(() => 1), accessor = [1]; Object.defineProperty(accessor, '0', { get: getter, enumerable: true });
    for (const values of [new Array(1), accessor, Object.assign([1], { extra: 1 })]) expect(() => policy.assert('SELECT 1', values, 'observer')).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
});
