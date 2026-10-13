import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Engine } from '../../src/engine';
import type { ConnectionProfile, QueryOutcome, RowChange, TablePage } from '../../src/shared/contracts';
import { identifier } from '../../src/engine/sql';

// 只在显式启用的远程隔离实例中建随机测试库；并发修改使用独立固定会话。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && Boolean(process.env.DBARK_TEST_HOST);
const database = `dbark_test_edit_precision_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
const profile: ConnectionProfile = { id: 'edit-precision-fixture', name: '精确修改验收', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 3306), user: process.env.DBARK_TEST_USER ?? 'root', password: process.env.DBARK_TEST_PASSWORD ?? '' };
const engine = new Engine();
let sessionId = '', adminSession = '', created = false;

/** 以独立会话模拟别人已经提交的写入；编辑提交走引擎新建的事务连接。 */
async function query(sql: string, session = sessionId): Promise<QueryOutcome> { return engine.handle('query.execute', { sessionId: session, sql, maxRows: 100, taskId: randomUUID() }); }
/** 返回实际表页原始行，禁止人为把 BIGINT 和 DECIMAL 改成 JS 数值。 */
async function page(table: string): Promise<TablePage> { return engine.handle('table.page', { connectionId: profile.id, database, table, page: 1, pageSize: 100, filters: [], sort: [] }); }
/** 使用完整旧行通过真实预处理语句提交，覆盖生产更新和删除路径。 */
async function apply(table: string, changes: RowChange[]): Promise<{ affectedRows: number }> { return engine.handle('table.apply', { connectionId: profile.id, database, table, changes, taskId: randomUUID() }); }

describe.skipIf(!enabled)('真实数据库精确数值定位和乐观锁', () => {
  beforeAll(async () => {
    const status = await engine.handle('connections.open', { id: profile.id, profile }); console.info(`精确修改验收版本：${status.version}`);
    adminSession = (await engine.handle('sessions.open', { connectionId: profile.id })).sessionId;
    await query(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`, adminSession); created = true;
    sessionId = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
  });
  afterAll(async () => {
    try { if (sessionId) await engine.handle('sessions.close', { sessionId }); if (created) await query(`DROP DATABASE ${identifier(database)}`, adminSession); }
    finally { await engine.closeAll(); }
  });

  it.each(['update', 'delete'] as const)('相邻BIGINT均存在时%s只操作指定行', async kind => {
    const table = `present_${kind}`;
    await query(`CREATE TABLE ${identifier(table)} (id BIGINT UNSIGNED PRIMARY KEY, revision INT NOT NULL) ENGINE=InnoDB; INSERT INTO ${identifier(table)} VALUES (9007199254740992,0),(9007199254740993,0)`);
    const before = (await page(table)).rows[1]; expect(before.id).toBe('9007199254740993');
    expect(await apply(table, [kind === 'update' ? { kind, before, values: { revision: 1 } } : { kind, before }])).toEqual({ affectedRows: 1 });
    const actual = (await page(table)).rows;
    expect(actual[0]).toEqual({ id: '9007199254740992', revision: 0 });
    if (kind === 'update') expect(actual[1]).toEqual({ id: '9007199254740993', revision: 1 }); else expect(actual).toHaveLength(1);
  });

  it.each(['update', 'delete'] as const)('目标BIGINT被删除后%s拒绝误中相邻主键并回滚整批', async kind => {
    const table = `missing_${kind}`;
    await query(`CREATE TABLE ${identifier(table)} (id BIGINT UNSIGNED PRIMARY KEY, revision INT NOT NULL) ENGINE=InnoDB; INSERT INTO ${identifier(table)} VALUES (1,0),(9007199254740992,0),(9007199254740993,0)`);
    const original = (await page(table)).rows;
    await query(`DELETE FROM ${identifier(table)} WHERE id=9007199254740993`);
    const before = original[2];
    await expect(apply(table, [{ kind: 'update', before: original[0], values: { revision: 1 } }, kind === 'update' ? { kind, before, values: { revision: 1 } } : { kind, before }])).rejects.toThrow('回滚');
    expect((await page(table)).rows).toEqual([{ id: '1', revision: 0 }, { id: '9007199254740992', revision: 0 }]);
  });

  it('非键DECIMAL最后一位被改动时拒绝覆盖，并保留新值', async () => {
    await query('CREATE TABLE decimal_conflict (id INT PRIMARY KEY, amount DECIMAL(40,18), revision INT NOT NULL) ENGINE=InnoDB; INSERT INTO decimal_conflict VALUES (1,12345678901234567890.123456789012345678,0)');
    const before = (await page('decimal_conflict')).rows[0];
    await query('UPDATE decimal_conflict SET amount=12345678901234567890.123456789012345679 WHERE id=1');
    await expect(apply('decimal_conflict', [{ kind: 'update', before, values: { revision: 1 } }])).rejects.toThrow('回滚');
    expect((await page('decimal_conflict')).rows).toEqual([{ id: 1, amount: '12345678901234567890.123456789012345679', revision: 0 }]);
  });
});
