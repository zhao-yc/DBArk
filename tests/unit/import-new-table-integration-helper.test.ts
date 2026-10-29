import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { bindImportNewTableTarget, createImportNewTableSqlAudit, importNewTableEnabled, importNewTableGate, planImportNewTableFixture } from '../helpers/importNewTableIntegration';

const database = 'dbark_importnew_012345abcdef', marker = 'dbark-importnew:012345abcdef';
/** 合成配置只验证RAM绑定，不接触真实账号、网络、CA或任何凭据文件。 */
function environment(port = '13384'): Record<string, string | undefined> { return { DBARK_INTEGRATION_ENABLED: '1', [importNewTableGate]: '1', DBARK_IMPORT_NEW_TABLE_NONCE: '012345abcdef', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: port, DBARK_TEST_TLS: port === '13484' ? '1' : '0', DBARK_TEST_USER: '本例合成账号', DBARK_TEST_PASSWORD: '仅RAM合成值', DBARK_TEST_EXPECTED_SERVER_HOSTNAME: '本例合成实例', DBARK_TEST_EXPECTED_SERVER_ID: '1', DBARK_TEST_EXPECTED_SERVER_PORT: '3306', ...(!['13310', '13311'].includes(port) ? { DBARK_TEST_EXPECTED_SERVER_UUID: '00000000-0000-4000-8000-000000000001' } : {}), ...(port === '13484' ? { DBARK_TEST_CA: 'C:\\本例合成路径\\ca.pem' } : {}) }; }

describe('新表导入独立目标与手工fixture（仅RAM）', () => {
  it('默认与列表先短路且不碰认证，旧门不能激活新用途', () => {
    const credentials = vi.fn(() => { throw Error('本例禁止读取认证'); }), env = Object.defineProperty({ DBARK_INTEGRATION_ENABLED: '1', [importNewTableGate]: '1' }, 'DBARK_TEST_PASSWORD', { get: credentials });
    for (const args of [['list'], ['--list'], ['--list=true']]) expect(importNewTableEnabled(env, args)).toBe(false); expect(credentials).not.toHaveBeenCalled();
    expect(importNewTableEnabled({}, [])).toBe(false); expect(importNewTableEnabled({ DBARK_INTEGRATION_ENABLED: '1', DBARK_FILE_IMPORT_TRANSACTION_TEST: '1' }, [])).toBe(false); expect(importNewTableEnabled({ DBARK_INTEGRATION_ENABLED: '1', [importNewTableGate]: '1' }, [])).toBe(true);
  });
  it.each([['13384', 'mysql', '8.4.11'], ['13357', 'mysql', '5.7.44'], ['13380', 'mysql', '8.0.46'], ['13310', 'mariadb', '10.11.19'], ['13311', 'mariadb', '11.4.13'], ['13484', 'mysql', '8.4.11']])('%s只绑定原六实例准确身份，nonce生成全新前缀而非旧权限', (port, dialect, version) => {
    const env = environment(port), binding = bindImportNewTableTarget(() => env, '本例'); expect(binding).toMatchObject({ database, marker, nonce: '012345abcdef', dialect, version, serverPort: '3306' }); expect(binding.profile.port).toBe(Number(port)); expect(binding.profile.database).toBeUndefined(); expect(env.DBARK_TABLE_VALUE_OPTIONS_TEST).toBeUndefined(); binding.assertCurrent();
    if (port === '13484') expect(binding.profile.tls).toMatchObject({ enabled: true, rejectUnauthorized: true, caPath: env.DBARK_TEST_CA }); else expect(binding.profile.tls).toBeUndefined();
  });
  it.each(['nonce', 'target', 'password', 'gate'])('%s漂移后即使恢复也不能重新激活原绑定', kind => {
    const env = environment(), original = { ...env }, binding = bindImportNewTableTarget(() => env, '本例'); if (kind === 'nonce') env.DBARK_IMPORT_NEW_TABLE_NONCE = '000000000000'; if (kind === 'target') env.DBARK_TEST_PORT = '13380'; if (kind === 'password') env.DBARK_TEST_PASSWORD = '迟到改值'; if (kind === 'gate') env[importNewTableGate] = '0'; expect(() => binding.assertCurrent()).toThrow(); Object.assign(env, original); expect(() => binding.assertCurrent()).toThrow();
  });
  it.each([{ DBARK_IMPORT_NEW_TABLE_NONCE: undefined }, { DBARK_IMPORT_NEW_TABLE_NONCE: 'A'.repeat(12) }, { DBARK_TEST_PORT: '3306' }, { DBARK_TEST_HOST: '127.0.0.1' }, { DBARK_TEST_USER: '' }, { DBARK_TEST_PASSWORD: undefined }, { DBARK_FILE_IMPORT_TRANSACTION_TEST: '1' }, { DBARK_TEST_SSH: '1' }])('缺配置或旁路拒绝，不提供账号端口默认值 %j', patch => { const env = { ...environment(), ...patch }; expect(() => bindImportNewTableTarget(() => env, '本例')).toThrow(); });
  it('严格TLS不得降级或省略显式CA，MySQL身份UUID不能由镜像标签代替', () => {
    const tls = environment('13484'); delete tls.DBARK_TEST_CA; expect(() => bindImportNewTableTarget(() => tls, '本例')).toThrow(); tls.DBARK_TEST_CA = '本例CA'; tls.DBARK_TEST_TLS = '0'; expect(() => bindImportNewTableTarget(() => tls, '本例')).toThrow(); const env = environment(); env.DBARK_TEST_EXPECTED_SERVER_UUID = 'mysql:8.4'; expect(() => bindImportNewTableTarget(() => env, '本例')).toThrow();
  });
  it('observer仅创建隔离壳与owner，被测五张表的CREATE均由产品执行', () => {
    const plan = planImportNewTableFixture(database, marker); expect(plan.creates).toHaveLength(2); expect(plan.creates.some(sql => sql.includes('`csv_success`'))).toBe(false); expect(plan.objects).toEqual(['__owner', 'changed_source', 'changing_source', 'csv_success', 'json_success', 'late_invalid']); expect(plan.cases.map(item => item.name)).toEqual(['csv_success', 'json_success', 'late_invalid', 'changed_source', 'changing_source']);
    for (const item of plan.cases) { expect(item.rows).toHaveLength(502); expect(item.design.columns.map(column => column.name)).toEqual(plan.sourceColumns); expect(item.design.collation).toBeUndefined(); expect(item.design.indexes).toEqual([{ name: 'PRIMARY', unique: true, columns: ['id'] }]); expect(item.expectedCreateSql).toContain('ENGINE=INNODB DEFAULT CHARACTER SET=utf8mb4 COMMENT=\'' + marker + ':' + item.name + '\''); expect(item.expectedCreateSql.endsWith(';')).toBe(false); expect(item.source).toEqual({ bytes: item.bytes.length, sha256: createHash('sha256').update(item.bytes).digest('hex') }); expect(item.changedBytes.length).toBe(item.bytes.length); expect(item.changedBytes.equals(item.bytes)).toBe(false); }
    expect(() => plan.table('业务表')).toThrow(); expect(() => planImportNewTableFixture(database, 'dbark-importnew:000000000000')).toThrow(); expect(() => planImportNewTableFixture('dbark_fileimporttx_' + 'a'.repeat(32), marker)).toThrow();
  });
  it('BIGINT边界、完整DECIMAL与嵌套JSON独立原文，CSV手写NULL/反斜线/换行协议', () => {
    const plan = planImportNewTableFixture(database, marker), csv = plan.cases[0], json = plan.cases[1], invalid = plan.cases[2]; expect(csv.rows.slice(0, 3).map(row => row.id)).toEqual(['18446744073709551615', '9223372036854775808', '9007199254740993']); expect(csv.text).toContain('\\N'); expect(csv.text).toContain('\\\\N'); expect(csv.text).toContain('"双引号"'.replaceAll('"', '""')); expect(json.text).toContain('"id":18446744073709551615'); expect(json.text).toContain('"doc":{"n":18446744073709551615,"d":0.12345678901234567890');
    expect(csv.parameters[0]).toEqual(['18446744073709551615', '123456789012345678.000000000001', null, null, '2026-10-29 01:02:03.000001', null]); expect(csv.parameters[1][3]).toEqual(Buffer.alloc(0)); expect(csv.parameters[2][3]).toEqual(Buffer.from('AAH/gFwn', 'base64')); expect(csv.expectedRows).toHaveLength(502); expect(csv.expectedRows[0].id).toBe('9007199254740993'); expect(invalid.parameters).toHaveLength(501); expect(invalid.rows[501].amount).toBe('-123456789012345678.0000000005023'); expect(invalid.expectedRows).toEqual([]);
    // 三种位数的主键必须沿原数值列排序，不能解析成有精度损失的Number，也不能沿CAST文本别名排序。
    for (const item of plan.cases) expect(item.hexSql.endsWith(' ORDER BY ' + plan.table(item.name) + '.`id` ASC')).toBe(true);
  });
});

describe('新表导入SQL审计只准准确本例目标与原参数（仅RAM）', () => {
  it('已登记壳SQL、五个手写CREATE及精确prepared INSERT可用，原参数和日志Buffer独立克隆', () => {
    const plan = planImportNewTableFixture(database, marker), writes = new Set(plan.creates), policy = createImportNewTableSqlAudit(plan, writes, () => false); for (const sql of plan.creates) policy.assert(sql, [], 'observer');
    for (const item of plan.cases) { policy.assert(item.expectedCreateSql + ';', [], 'schema.tableCreate.apply:' + item.name); const values = item.parameters[2].map(value => Buffer.isBuffer(value) ? Buffer.from(value) : value); policy.assert(item.insertSql, values, 'files.import:' + item.name); const recorded = policy.sent.at(-1)!.values[3] as Buffer; (values[3] as Buffer)[0] = 255; expect(recorded[0]).toBe(0); }
    expect(policy.rejected).toEqual([]);
  });
  it('observer写必须逐条显式登记，不能借产品CREATE、旧库、额外对象或跨case路由', () => {
    const plan = planImportNewTableFixture(database, marker), policy = createImportNewTableSqlAudit(plan, new Set(), () => false), item = plan.cases[0];
    for (const [sql, scope] of [[plan.creates[0], 'observer'], [plan.ownerSeed, 'observer'], [plan.drop, 'observer'], [item.expectedCreateSql, 'observer'], [item.expectedCreateSql, 'schema.tableCreate.apply:json_success'], [item.expectedCreateSql.replace(database, '业务库'), 'schema.tableCreate.apply:csv_success'], [item.expectedCreateSql, 'schema.tableCreate.preview:csv_success'], [item.expectedCreateSql, 'schema.tableCreate.apply:csv_success_duplicate']]) expect(() => policy.assert(sql, [], scope)).toThrow();
  });
  it('同长改写只在受控变化例登记，后置非法值不能进入INSERT或任何中间COMMIT', () => {
    const plan = planImportNewTableFixture(database, marker), policy = createImportNewTableSqlAudit(plan, new Set(), () => false), success = plan.cases[0], bad = plan.cases[2], changed = plan.cases[3];
    policy.assert(changed.insertSql, changed.changedParameters[4], 'files.import:changed_source'); expect(() => policy.assert(success.insertSql, success.changedParameters[4], 'files.import:csv_success')).toThrow(); expect(() => policy.assert(bad.insertSql, bad.changedParameters[501], 'files.import:late_invalid')).toThrow();
    for (const item of plan.cases) { policy.assert('START TRANSACTION', [], 'files.import:' + item.name); if (item.commits) { policy.assert('COMMIT', [], 'files.import:' + item.name); expect(() => policy.assert('ROLLBACK', [], 'files.import:' + item.name)).toThrow(); } else { policy.assert('ROLLBACK', [], 'files.import:' + item.name); expect(() => policy.assert('COMMIT', [], 'files.import:' + item.name)).toThrow(); } }
  });
  it('有限系统目录、准确observer读回及owned线程仅供查询，禁止借历史编号KILL', () => {
    const plan = planImportNewTableFixture(database, marker), policy = createImportNewTableSqlAudit(plan, new Set(), id => id === 17), item = plan.cases[0];
    policy.assert(item.hexSql, [], 'observer'); policy.assert(item.readSql, [], 'observer'); policy.assert(plan.observerColumnsSql, [database, item.name], 'observer'); policy.assert(plan.observerIndexesSql, [database, item.name], 'observer'); policy.assert('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [17], 'observer'); policy.assert('SELECT trx_mysql_thread_id AS id FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id=?', [17], 'observer'); expect(() => policy.assert('KILL QUERY 17', [], 'files.import:csv_success')).toThrow();
    expect(() => policy.assert('KILL QUERY 18', [], 'files.import:csv_success')).toThrow(); expect(() => policy.assert('KILL CONNECTION 17', [], 'observer')).toThrow(); expect(() => policy.assert(plan.observerColumnsSql, [database, '业务表'], 'observer')).toThrow(); expect(() => policy.assert('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [18], 'observer')).toThrow();
    const db = "CONVERT(X'" + Buffer.from(database).toString('hex') + "' USING utf8mb4)"; policy.assert('SELECT SCHEMA_NAME AS name,DEFAULT_CHARACTER_SET_NAME AS charset,DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=' + db + ' LIMIT 2', [], 'schema.tableCreate.get:csv_success_duplicate');
  });
  it.each(['SELECT SLEEP(1)', 'SELECT secret_udf()', "SELECT 'x' INTO OUTFILE '/tmp/escaped'", 'SHOW DATABASES', 'SELECT * FROM mysql.user', 'START TRANSACTION; COMMIT', 'GRANT ALL ON *.* TO x', 'CREATE USER x', 'SET FOREIGN_KEY_CHECKS=0'])('未登记语句、UDF、旁路或多语句拒绝 %s', sql => { const plan = planImportNewTableFixture(database, marker), policy = createImportNewTableSqlAudit(plan, new Set(), () => false); expect(() => policy.assert(sql, [], 'files.import:csv_success')).toThrow(); expect(policy.rejected).toEqual([{ sql, scope: 'files.import:csv_success' }]); expect(policy.sent).toEqual([]); });
  it('唯一CREATE末终止符可规范，但追加第二语句/第二终止符/注释不能借规范化通过', () => {
    const plan = planImportNewTableFixture(database, marker), item = plan.cases[0], policy = createImportNewTableSqlAudit(plan, new Set(), () => false); policy.assert(item.expectedCreateSql + ';', [], 'schema.tableCreate.apply:csv_success');
    for (const suffix of [';;', '; SELECT 1', '; DROP DATABASE `业务库`', ' /* 注释 */']) expect(() => policy.assert(item.expectedCreateSql + suffix, [], 'schema.tableCreate.apply:csv_success')).toThrow();
  });
  it('原参数稀疏、访问器及错误值拒绝且不执行getter', () => {
    const plan = planImportNewTableFixture(database, marker), item = plan.cases[0], policy = createImportNewTableSqlAudit(plan, new Set(), () => false), values = [...item.parameters[0]], getter = vi.fn(); Object.defineProperty(values, '0', { get: getter, enumerable: true }); expect(() => policy.assert(item.insertSql, values, 'files.import:csv_success')).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(() => policy.assert(item.insertSql, new Array(6), 'files.import:csv_success')).toThrow(); expect(() => policy.assert(item.insertSql, ['迟到假值', ...item.parameters[0].slice(1)], 'files.import:csv_success')).toThrow();
  });
});
