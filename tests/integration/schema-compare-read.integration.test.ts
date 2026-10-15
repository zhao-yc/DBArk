import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mysql from 'mysql2';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { readSchemaComparisonTarget } from '../../src/engine/schemaCompare';
import { compareSchemaSnapshots } from '../../src/engine/schemaCompareProjection';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import type { ConnectionProfile } from '../../src/shared/contracts';
import { identifier, qualified } from '../../src/engine/sql';

// 必须由主智能体先确认开发 Docker 实际连接 Server-200，再显式开启本专项；本文件不执行 Docker。
const enabled = process.env.DBARK_SCHEMA_COMPARE_INTEGRATION_ENABLED === '1' && process.env.DBARK_INTEGRATION_ENABLED === '1' && Boolean(process.env.DBARK_TEST_HOST);
const database = `dbark_compare_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const profile: ConnectionProfile = { id: randomUUID(), name: '结构比较专项随机库', group: '', color: '#345678', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 3306), user: process.env.DBARK_TEST_USER ?? 'root', password: process.env.DBARK_TEST_PASSWORD ?? '',
  ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}),
  ...(process.env.DBARK_TEST_SSH === '1' ? { ssh: { enabled: true, host: process.env.DBARK_TEST_SSH_HOST ?? '', port: Number(process.env.DBARK_TEST_SSH_PORT ?? 22), user: process.env.DBARK_TEST_SSH_USER ?? '', privateKeyPath: process.env.DBARK_TEST_SSH_KEY, hostFingerprint: process.env.DBARK_TEST_SSH_FINGERPRINT } } : {}) };
const drivers = new Set<ReturnType<typeof mysql.createConnection>>();
let admin: ManagedConnection | undefined, observer: ManagedConnection | undefined, created = false, restoreDrivers: (() => void) | undefined;
/** 在建连和破坏性夹具操作前双重约束目标，不接受通配库名或非本轮随机名称。 */
function assertFixtureTarget(): void {
  if (profile.host !== '192.168.31.200' || ![13357, 13380, 13384, 13310, 13311, 13484].includes(profile.port)) throw new Error('结构比较验收仅允许已核对的 200 服务器既有隔离端口');
  if (!/^dbark_compare_[a-f0-9]{12}$/.test(database)) throw new Error('拒绝操作非本轮结构比较随机隔离库');
}
/** 仅测试夹具允许 DDL，范围严格限于本轮随机数据库。比较读取器完全不写表结构。 */
async function sql(value: string) { return (await execute(admin!, value)).rows as Record<string, unknown>[]; }
/** 每侧单独新建并严格释放短会话；不借用用户事务或临时表会话。 */
async function read(table: string) {
  const managed = await connect(profile); let activeCommands = 0;
  const context: StructureTaskContext = { managed, checkCancelled() {}, report() {}, commandStarted() { activeCommands++; return () => { activeCommands--; }; } };
  try { const value = await readSchemaComparisonTarget(context, { connectionId: profile.id, database, table }); expect(activeCommands).toBe(0); return value; }
  finally { await managed.close({ strict: true }); }
}

describe.skipIf(!enabled)('真实 MySQL/MariaDB 原定义只读比较', () => {
  beforeAll(async () => {
    assertFixtureTarget();
    const create = mysql.createConnection;
    const recording = vi.spyOn(mysql, 'createConnection').mockImplementation((...args: Parameters<typeof mysql.createConnection>) => { const driver = create(...args); drivers.add(driver); return driver; });
    restoreDrivers = () => recording.mockRestore();
    observer = await connect(profile);
    admin = await connect(profile);
    await sql(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`); created = true;
    await sql(`CREATE TABLE ${qualified(database, 'parent')} (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB`);
    for (const table of ['source', 'target']) await sql(`CREATE TABLE ${qualified(database, table)} (id INT NOT NULL PRIMARY KEY,parent_id INT,amount DECIMAL(30,6) DEFAULT 12345678901234567890.123456,body VARCHAR(80) DEFAULT '文字 空格',generated_length INT GENERATED ALWAYS AS (LENGTH(body)) STORED,KEY ix_body(body(7)),CONSTRAINT ${identifier('fk_' + table)} FOREIGN KEY(parent_id) REFERENCES ${qualified(database, 'parent')} (id) ON DELETE CASCADE ON UPDATE RESTRICT) ENGINE=InnoDB`);
  });
  afterAll(async () => {
    const failures: string[] = [];
    /** 收尾各项独立执行，前项失败不能跳过连接释放和旁观者残留核验；错误不输出 SQL/认证信息。 */
    const verify = async (label: string, action: () => Promise<void>) => { try { await action(); } catch { failures.push(label); } };
    try {
      if (admin && !admin.broken) await verify('回滚夹具事务失败', async () => { await sql('ROLLBACK'); });
      await verify('管理连接严格关闭失败', async () => { await admin?.close({ strict: true }); });
      if (observer) {
        if (created) {
          await verify('精确清理隔离库失败', async () => { assertFixtureTarget(); await execute(observer!, `DROP DATABASE IF EXISTS ${identifier(database)}`); });
          await verify('隔离库残留核验失败', async () => {
            assertFixtureTarget();
            const result = await execute<Record<string, unknown>[]>(observer!, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE CAST(SCHEMA_NAME AS BINARY)=CAST(? AS BINARY)', [database]);
            expect(result.rows).toHaveLength(0);
          });
        }
        await verify('真实驱动连接残留核验失败', async () => {
          // 固定旁观者只用于最后核验，自身明确排除；所有测试/管理/读取连接（包括建连失败时已创建的驱动）均取真实 threadId。
          const ids = [...new Set([...drivers].filter(driver => driver !== observer!.connection).map(driver => driver.threadId).filter((id): id is number => Number.isSafeInteger(id) && (id ?? 0) > 0))];
          expect(ids.length).toBeGreaterThan(0);
          const remaining = await execute<Record<string, unknown>[]>(observer!, 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + ids.map(() => '?').join(',') + ')', ids);
          expect(remaining.rows).toHaveLength(0);
          console.info(JSON.stringify({ 验收说明: '结构比较全部测试真实驱动逐ID释放，旁观连接自身排除并随后严格关闭', 已核验驱动连接ID: ids, 残留连接数: remaining.rows.length }));
        });
      }
    } finally {
      try { await verify('旁观连接严格关闭失败', async () => { await observer?.close({ strict: true }); }); }
      finally { restoreDrivers?.(); }
    }
    if (failures.length) throw new Error(failures.join('；'));
  });
  it('精确 DECIMAL、生成列和索引原定义保留，外键名字按各侧精确配对', async () => {
    const source = await read('source'), target = await read('target'), report = compareSchemaSnapshots(source, target);
    expect(report.rows.find(row => row.category === 'columns' && row.name === 'amount')).toMatchObject({ status: 'same' });
    expect(report.rows.find(row => row.category === 'columns' && row.name === 'amount')?.source?.rawSql).toContain('12345678901234567890.123456');
    expect(report.rows.find(row => row.category === 'columns' && row.name === 'generated_length')).toMatchObject({ status: 'same' });
    expect(report.rows.find(row => row.category === 'indexes' && row.name === 'ix_body')).toMatchObject({ status: 'same' });
    expect(report.rows.find(row => row.name === 'fk_source')).toMatchObject({ status: 'added' }); expect(report.rows.find(row => row.name === 'fk_target')).toMatchObject({ status: 'removed' });
  });
  it('真实差异不会同步目标，也不会提交另一会话事务或改变会话模式、临时表', async () => {
    await sql(`ALTER TABLE ${qualified(database, 'target')} MODIFY COLUMN amount DECIMAL(30,6) DEFAULT 1.000001`);
    await sql(`USE ${identifier(database)}`); await sql('CREATE TEMPORARY TABLE marker (value BIGINT)'); await sql('INSERT INTO marker VALUES (9007199254740993)');
    await sql('SET SESSION sql_mode = \'NO_BACKSLASH_ESCAPES\''); await sql('START TRANSACTION'); await sql(`INSERT INTO ${qualified(database, 'parent')} VALUES (123)`);
    const before = await sql('SELECT CONNECTION_ID() AS id,@@SESSION.sql_mode AS mode,value FROM marker');
    const source = await read('source'), target = await read('target'), report = compareSchemaSnapshots(source, target);
    expect(report.rows.find(row => row.name === 'amount' && row.category === 'columns')?.status).toBe('changed');
    expect(await sql('SELECT CONNECTION_ID() AS id,@@SESSION.sql_mode AS mode,value FROM marker')).toEqual(before);
    expect((await execute(observer!, `SELECT COUNT(*) AS count FROM ${qualified(database, 'parent')} WHERE id=123`)).rows).toEqual([{ count: '0' }]);
    expect((await read('target')).source).toBe(target.source); await sql('ROLLBACK');
  });
});
