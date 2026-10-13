import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ConnectionProfile, FilterMode, FilterRule, QueryOutcome, SortRule, TablePage } from '../../src/shared/contracts';
import { exportLiteral, identifier } from '../../src/engine/sql';

// 仅给本文件新建的真实连接设置会话SQL模式，不修改共享测试实例的全局配置。
const fixture = vi.hoisted(() => ({ sqlMode: undefined as string | undefined }));
vi.mock('../../src/engine/connection', async original => {
  const actual = await original<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    const managed = await actual.connect(...args);
    try { if (fixture.sqlMode !== undefined) await actual.execute(managed, 'SET SESSION sql_mode = ?', [fixture.sqlMode]); return managed; }
    catch (error) { await managed.close(); throw error; }
  } };
});
import { Engine } from '../../src/engine';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && Boolean(process.env.DBARK_TEST_HOST);
const database = `dbark_test_filters_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
const profile: ConnectionProfile = { id: 'filter-fixture', name: '独立筛选验收', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 3306), user: process.env.DBARK_TEST_USER ?? 'root', password: process.env.DBARK_TEST_PASSWORD ?? '' };
const engine = new Engine();
const special = "中文'\\'); OR 1=1 -- 🤖";
let sessionId = '', adminSession = '', created = false, dialect = '';

/** 测试建表与核对使用固定会话；筛选本身走真实Engine分页入口及独立连接。 */
async function query(sql: string, session = sessionId): Promise<QueryOutcome> { return engine.handle('query.execute', { sessionId: session, sql, maxRows: 100, taskId: randomUUID() }); }
/** 原始筛选字符串不在测试侧转换，确保覆盖IPC之后的真实参数生成行为。 */
async function page(filters: FilterRule[], filterMode?: FilterMode, pageNumber = 1, pageSize = 100, sort: SortRule[] = []): Promise<TablePage> {
  return engine.handle('table.page', { connectionId: profile.id, database, table: 'filter_rows', page: pageNumber, pageSize, filters, filterMode, sort });
}
/** 使用测试行主键断言命中集合，避免不同服务器元数据数字类型影响比较。 */
function ids(result: TablePage): number[] { return result.rows.map(row => Number(row.row_id)); }

describe.skipIf(!enabled)('真实数据库集合、区间与组合筛选', () => {
  beforeAll(async () => {
    const status = await engine.handle('connections.open', { id: profile.id, profile }); dialect = status.dialect;
    console.info(`筛选验收版本：${status.version}`);
    adminSession = (await engine.handle('sessions.open', { connectionId: profile.id })).sessionId;
    await query(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`, adminSession); created = true;
    sessionId = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    await query('CREATE TABLE filter_rows (row_id INT PRIMARY KEY, num BIGINT UNSIGNED, amount DECIMAL(40,18), tag VARCHAR(100) NULL, sort_group INT) ENGINE=InnoDB');
    const rows = [
      [1, '9007199254740992', '12345678901234567890.123456789012345678', null, 1],
      [2, '9007199254740993', '12345678901234567890.123456789012345679', '', 1],
      [3, '18446744073709551615', '2.000000000000000000', special, 1],
      [4, '42', '4', '中文一', 2], [5, '43', '5', '  空格,逗号  ', 2],
      [6, '44', '6', 'NULL', 2], [7, '45', '7', '并列', 2], [8, '46', '8', '并列', 2],
    ];
    await query('INSERT INTO filter_rows VALUES ' + rows.map(row => '(' + row.map(value => exportLiteral(value)).join(',') + ')').join(','));
  });
  afterAll(async () => {
    fixture.sqlMode = undefined;
    try { if (sessionId) await engine.handle('sessions.close', { sessionId }); if (created) await query(`DROP DATABASE ${identifier(database)}`, adminSession); }
    finally { await engine.closeAll(); }
  });

  it('集合、BETWEEN和NOT LIKE在默认全部满足组合中正确命中', async () => {
    expect(ids(await page([{ column: 'tag', operator: 'IN', values: ['', 'NULL'] }, { column: 'row_id', operator: 'BETWEEN', values: ['2', '6'] }]))).toEqual([2, 6]);
    expect(ids(await page([{ column: 'tag', operator: 'NOT LIKE', value: '中文%' }]))).toEqual([2, 5, 6, 7, 8]);
  });
  it('任一满足包含NULL分支，NOT IN遵守SQL的NULL三值逻辑', async () => {
    expect(ids(await page([{ column: 'tag', operator: 'IS NULL' }, { column: 'num', operator: 'IN', values: ['9007199254740993'] }], 'any'))).toEqual([1, 2]);
    expect(ids(await page([{ column: 'tag', operator: 'NOT IN', values: [''] }]))).toEqual([3, 4, 5, 6, 7, 8]);
    expect(ids(await page([{ column: 'tag', operator: 'NOT IN', values: [''] }, { column: 'tag', operator: 'IS NULL' }], 'any'))).toEqual([1, 3, 4, 5, 6, 7, 8]);
  });
  it('BIGINT与DECIMAL相邻精确值在IN/BETWEEN和单值比较中不会合并', async () => {
    expect(ids(await page([{ column: 'num', operator: 'IN', values: ['9007199254740993'] }]))).toEqual([2]);
    expect(ids(await page([{ column: 'num', operator: '=', value: '18446744073709551615' }]))).toEqual([3]);
    expect(ids(await page([{ column: 'num', operator: 'BETWEEN', values: ['9007199254740992', '9007199254740993'] }]))).toEqual([1, 2]);
    expect(ids(await page([{ column: 'amount', operator: 'IN', values: ['12345678901234567890.123456789012345678'] }]))).toEqual([1]);
    expect(ids(await page([{ column: 'amount', operator: 'BETWEEN', values: ['12345678901234567890.123456789012345678', '12345678901234567890.123456789012345678'] }]))).toEqual([1]);
  });
  it.each(['', 'NO_BACKSLASH_ESCAPES'])('真实会话SQL模式%s下Unicode、引号、反斜线和注入文本均只作为值', async mode => {
    fixture.sqlMode = mode;
    try {
      expect(ids(await page([{ column: 'tag', operator: 'IN', values: [special] }]))).toEqual([3]);
      expect(ids(await page([{ column: 'tag', operator: 'IN', values: ["不存在') OR 1=1 --"] }]))).toEqual([]);
      expect(ids(await page([{ column: 'tag', operator: '=', value: '  空格,逗号  ' }]))).toEqual([5]);
      expect(ids(await page([{ column: 'tag', operator: 'IN', values: [''] }]))).toEqual([2]);
    } finally { fixture.sqlMode = undefined; }
  });
  it('非唯一列排序跳页时补主键顺序，末页和hasMore正确', async () => {
    const sort: SortRule[] = [{ column: 'sort_group', direction: 'ASC' }];
    const first = await page([], 'all', 1, 3, sort), second = await page([], 'all', 2, 3, sort), last = await page([], 'all', 3, 3, sort);
    expect(ids(first)).toEqual([1, 2, 3]); expect(ids(second)).toEqual([4, 5, 6]); expect(ids(last)).toEqual([7, 8]);
    expect(first.hasMore).toBe(true); expect(second.hasMore).toBe(true); expect(last.hasMore).toBe(false);
  });
  it('空集合、错误BETWEEN与未知字段被明确拒绝，表内容没有副作用', async () => {
    await expect(page([{ column: 'tag', operator: 'IN', values: [] }])).rejects.toThrow('集合必须包含');
    await expect(page([{ column: 'row_id', operator: 'BETWEEN', values: ['1'] }])).rejects.toThrow('恰好 2');
    await expect(page([{ column: 'tag` OR 1=1', operator: 'IN', values: ['x'] }])).rejects.toThrow('未知筛选字段');
    expect(ids(await page([]))).toHaveLength(8);
  });
  it('MariaDB大于30位小数的声明精度按元数据保留', async context => {
    if (dialect !== 'mariadb') { context.skip(); return; }
    await query('CREATE TABLE maria_scale (id INT PRIMARY KEY, amount DECIMAL(65,38)) ENGINE=InnoDB');
    await query('INSERT INTO maria_scale VALUES (1,1.12345678901234567890123456789012345678),(2,1.12345678901234567890123456789012345679)');
    const result = await engine.handle('table.page', { connectionId: profile.id, database, table: 'maria_scale', page: 1, pageSize: 10, filters: [{ column: 'amount', operator: 'IN', values: ['1.12345678901234567890123456789012345678'] }], sort: [] });
    expect(result.rows).toHaveLength(1); expect(result.rows[0].id).toBe(1); expect(result.rows[0].amount).toBe('1.12345678901234567890123456789012345678');
  });
});
