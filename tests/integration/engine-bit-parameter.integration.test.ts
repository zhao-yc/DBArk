import { randomUUID } from 'node:crypto';
import mysql from 'mysql2';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier, qualified } from '../../src/engine/sql';
import type { NetworkConnectionProfile as ConnectionProfile, RowChange, TablePage } from '../../src/shared/contracts';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_BIT_PRECISION_INTEGRATION_ENABLED === '1';
const database = 'dbark_bitparam_' + randomUUID().replaceAll('-', '').slice(0, 12);
const profile: ConnectionProfile = { id: randomUUID(), name: 'BIT预处理精度隔离验证', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT), user: process.env.DBARK_TEST_USER ?? '', password: process.env.DBARK_TEST_PASSWORD ?? '', ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
const engine = new Engine(), drivers = new Set<ReturnType<typeof mysql.createConnection>>();
let observer: ManagedConnection | undefined, created = false, restore: (() => void) | undefined;
/** 只接受统筹已经核对的六个隔离实例和本轮精确随机库名。 */
function assertTarget() { if (profile.host !== '192.168.31.200' || ![13357, 13380, 13384, 13310, 13311, 13484].includes(profile.port) || !/^dbark_bitparam_[a-f0-9]{12}$/.test(database)) throw Error('BIT参数测试目标不在授权范围'); }
/** 编辑和定位都经过实际引擎，旁观连接只建夹具并读回服务器结果。 */
async function page(): Promise<TablePage> { return engine.handle('table.page', { connectionId: profile.id, database, table: 'subject', page: 1, pageSize: 100, filters: [], sort: [{ column: 'id', direction: 'ASC' }] }); }
async function apply(changes: RowChange[]) { return engine.handle('table.apply', { connectionId: profile.id, database, table: 'subject', changes, taskId: randomUUID() }); }
/** 服务端 CAST 列值不经过客户端参数定型，可以独立核对精确无符号十进制和位字节。 */
async function actual() { return (await execute<Record<string, unknown>[]>(observer!, `SELECT id, CAST(flags AS UNSIGNED) AS value, HEX(flags) AS bytes FROM ${qualified(database, 'subject')} ORDER BY id`)).rows; }

describe.skipIf(!enabled)('真实预处理BIT64文本参数保持最大值', () => {
  beforeAll(async () => {
    assertTarget(); const create = mysql.createConnection;
    const spy = vi.spyOn(mysql, 'createConnection').mockImplementation((...args: Parameters<typeof mysql.createConnection>) => { const driver = create(...args); drivers.add(driver); return driver; }); restore = () => spy.mockRestore();
    observer = await connect(profile);
    await execute(observer, `CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`); created = true;
    await execute(observer, `CREATE TABLE ${qualified(database, 'subject')} (id INT PRIMARY KEY,flags BIT(64) NULL) ENGINE=InnoDB`);
    await execute(observer, `INSERT INTO ${qualified(database, 'subject')} VALUES (1,0)`);
    await engine.handle('connections.open', { id: profile.id, profile });
  });
  afterAll(async () => {
    const failures: string[] = [];
    /** 独立收尾，前项失败不跳过精确清理及真实驱动残留核对。 */
    const check = async (label: string, action: () => Promise<void>) => { try { await action(); } catch { failures.push(label); } };
    try {
      await check('引擎连接释放失败', () => engine.closeAll());
      if (observer) {
        if (created) { await check('精确测试库清理失败', async () => { assertTarget(); await execute(observer!, `DROP DATABASE IF EXISTS ${identifier(database)}`); }); await check('测试库仍有残留', async () => { expect((await execute(observer!, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [database])).rows).toEqual([]); }); }
        await check('真实驱动未完全释放', async () => { const ids = [...drivers].filter(driver => driver !== observer!.connection).map(driver => driver.threadId).filter((id): id is number => Number.isSafeInteger(id) && (id ?? 0) > 0); expect(ids.length).toBeGreaterThan(0); expect((await execute(observer!, `SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${ids.map(() => '?').join(',')})`, ids)).rows).toEqual([]); console.info(JSON.stringify({ 验收: 'BIT参数精度', 真实驱动数量: ids.length, 残留: 0 })); });
      }
    } finally { try { await check('旁观连接释放失败', async () => { await observer?.close({ strict: true }); }); } finally { restore?.(); } }
    if (failures.length) throw Error(failures.join('；'));
  });
  it('最大文本参数插入和更新均读回FFFFFFFFFFFFFFFF，旧值保护仍能定位后续修改', async () => {
    await apply([{ kind: 'update', before: (await page()).rows[0], values: { flags: '18446744073709551615' } }]);
    expect(await actual()).toEqual([{ id: 1, value: '18446744073709551615', bytes: 'FFFFFFFFFFFFFFFF' }]);
    await apply([{ kind: 'insert', values: { id: '2', flags: '18446744073709551615' } }]);
    expect((await actual())[1]).toEqual({ id: 2, value: '18446744073709551615', bytes: 'FFFFFFFFFFFFFFFF' });
    const before = (await page()).rows; expect(before.every(row => row.flags && typeof row.flags === 'object' && row.flags.type === 'binary' && row.flags.base64 === '//////////8=')).toBe(true);
    await apply([{ kind: 'update', before: before[0], values: { flags: '9223372036854775808' } }, { kind: 'delete', before: before[1] }]);
    expect(await actual()).toEqual([{ id: 1, value: '9223372036854775808', bytes: '8000000000000000' }]);
  });
  it('零、前导零、安全整数、布尔和NULL维持同一参数语义', async () => {
    for (const [input, expected] of [['00000000000000000001', '1'], [7, '7'], [true, '1'], ['0', '0'], [null, null]] as const) {
      await apply([{ kind: 'update', before: (await page()).rows[0], values: { flags: input } }]);
      expect((await actual())[0].value).toBe(expected);
    }
  });
});
