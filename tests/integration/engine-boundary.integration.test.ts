import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '../../src/engine';
import { identifier } from '../../src/engine/sql';
import type { ConnectionProfile, QueryOutcome, TaskEvent } from '../../src/shared/contracts';

// 仅显式启用时访问用户指定的独立测试容器；压力用例还需要单独开关。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && Boolean(process.env.DBARK_TEST_HOST);
const database = `dbark_test_boundary_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const account = `dbark_limit_${randomUUID().slice(0, 8)}`;
const password = randomUUID();
const events: TaskEvent[] = [];
const engine = new Engine(event => events.push(event));
const profile: ConnectionProfile = {
  id: 'boundary', name: '独立边界验收', group: '', color: '#5273ff', dialect: 'mysql',
  host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 3306),
  user: process.env.DBARK_TEST_USER ?? 'root', password: process.env.DBARK_TEST_PASSWORD ?? '',
};
let sessionId = '', folder = '', created = false, accountCreated = false;

/** 每个脚本使用独立任务编号，不共享取消状态。 */
async function query(sql: string, session = sessionId): Promise<QueryOutcome> {
  return engine.handle('query.execute', { sessionId: session, taskId: randomUUID(), sql, maxRows: 100 });
}

describe.skipIf(!enabled)('远程数据库权限、断线和容量边界', () => {
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'dbark-boundary-'));
    await engine.handle('connections.open', { id: profile.id, profile });
    const admin = (await engine.handle('sessions.open', { connectionId: profile.id })).sessionId;
    try { await query(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`, admin); created = true; }
    finally { await engine.handle('sessions.close', { sessionId: admin }); }
    sessionId = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
  });
  afterAll(async () => {
    try {
      if (sessionId) await engine.handle('sessions.close', { sessionId });
      const cleanup = (await engine.handle('sessions.open', { connectionId: profile.id })).sessionId;
      if (accountCreated) await query(`DROP USER '${account}'@'%'`, cleanup);
      if (created) await query(`DROP DATABASE ${identifier(database)}`, cleanup);
    } finally {
      await engine.closeAll();
      if (folder) { for (const name of await readdir(folder)) await rm(join(folder, name)); await rmdir(folder); }
    }
  });

  it('只读账号写入失败且没有权限提升或写入副作用', async () => {
    await query('CREATE TABLE permission_guard (id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO permission_guard VALUES (1)');
    await query(`CREATE USER '${account}'@'%' IDENTIFIED BY '${password}'`); accountCreated = true;
    await query(`GRANT SELECT ON ${identifier(database)}.* TO '${account}'@'%'`);
    const limited = { ...profile, id: 'limited', database, user: account, password };
    await engine.handle('connections.open', { id: limited.id, profile: limited });
    const session = (await engine.handle('sessions.open', { connectionId: limited.id, database })).sessionId;
    try {
      expect((await query('SELECT * FROM permission_guard', session)).results[0].rows).toHaveLength(1);
      await expect(query('INSERT INTO permission_guard VALUES (2)', session)).resolves.toMatchObject({ results: [], failure: { statementOrdinal: 1, statementsCompleted: 0, message: expect.stringMatching(/denied|permission/i) } });
      expect((await query('SELECT * FROM permission_guard')).results[0].rows).toHaveLength(1);
    } finally { await engine.handle('connections.close', { id: limited.id }); }
  });

  it('连接中断立即失败，已提交写入只发生一次且失效会话不能自动重连', async () => {
    await query('CREATE TABLE disconnect_guard (id INT AUTO_INCREMENT PRIMARY KEY, value INT) ENGINE=InnoDB');
    const victim = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    try {
      const connectionId = String((await query('SELECT CONNECTION_ID()', victim)).results[0].rows[0].c0);
      expect(connectionId).toMatch(/^\d+$/);
      const running = query('INSERT INTO disconnect_guard(value) VALUES(1); SELECT SLEEP(20)', victim);
      const failure = expect(running).resolves.toMatchObject({ results: [expect.objectContaining({ affectedRows: 1 })], failure: { statementOrdinal: 2, statementsCompleted: 1, message: expect.any(String) } });
      // 等到第一条写入确实提交后，只中断该测试会话，不影响其余客户端连接。
      await expect.poll(async () => Number((await query('SELECT COUNT(*) FROM disconnect_guard')).results[0].rows[0].c0)).toBe(1);
      await query(`KILL CONNECTION ${connectionId}`); await failure;
      await expect(query('INSERT INTO disconnect_guard(value) VALUES(2)', victim)).rejects.toThrow('断开');
      expect(Number((await query('SELECT COUNT(*) FROM disconnect_guard')).results[0].rows[0].c0)).toBe(1);
    } finally { await engine.handle('sessions.close', { sessionId: victim }); }
  });

  it('SQL 结构与数据导出可以执行恢复，精确值不经浮点数转换', async () => {
    await query("CREATE TABLE sql_restore (id BIGINT UNSIGNED PRIMARY KEY, amount DECIMAL(30,10), body TEXT, payload BLOB) ENGINE=InnoDB; INSERT INTO sql_restore VALUES(18446744073709551615,12345678901234567890.1234567890,'中文',X'00ff')");
    const filePath = join(folder, 'restore.sql');
    const before = await query('SELECT * FROM sql_restore');
    expect(await engine.handle('files.export', { connectionId: profile.id, database, table: 'sql_restore', filePath, format: 'sql', encoding: 'utf8', includeData: true, includeStructure: true, taskId: randomUUID() })).toEqual({ rows: 1 });
    await query('DROP TABLE sql_restore');
    const restored = await engine.handle('files.import', { connectionId: profile.id, database, table: '', filePath, format: 'sql', encoding: 'utf8', mapping: {}, taskId: randomUUID() });
    expect(restored.errors).toEqual([]); expect(restored.rows).toBe(1);
    expect((await query('SELECT * FROM sql_restore')).results[0].rows).toEqual(before.results[0].rows);
  });

  it.skipIf(process.env.DBARK_TEST_MILLION !== '1')('百万行分页与完整流式导出保持有界内存，取消清理临时文件', async () => {
    const started = performance.now();
    await query('CREATE TABLE digits (n INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO digits VALUES(0),(1),(2),(3),(4),(5),(6),(7),(8),(9); CREATE TABLE million_rows (id INT PRIMARY KEY, body VARCHAR(200)) ENGINE=InnoDB');
    await query("INSERT INTO million_rows SELECT 1+a.n+10*b.n+100*c.n+1000*d.n+10000*e.n+100000*f.n, REPEAT('数据库验收',12) FROM digits a CROSS JOIN digits b CROSS JOIN digits c CROSS JOIN digits d CROSS JOIN digits e CROSS JOIN digits f");
    const count = Number((await query('SELECT COUNT(*) FROM million_rows')).results[0].rows[0].c0); expect(count).toBe(1_000_000);
    const populatedMs = performance.now() - started, pageStart = performance.now();
    const page = await engine.handle('table.page', { connectionId: profile.id, database, table: 'million_rows', page: 2000, pageSize: 500, filters: [], sort: [] });
    expect(page.rows).toHaveLength(500); expect(page.rows[0].id).toBe(999501); expect(page.hasMore).toBe(false);
    const pageMs = performance.now() - pageStart;
    const filePath = join(folder, 'million.csv'), initialRss = process.memoryUsage().rss;
    let peakRss = initialRss;
    const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 25);
    const exportStart = performance.now();
    try {
      const result = await engine.handle('files.export', { connectionId: profile.id, database, table: 'million_rows', filePath, format: 'csv', encoding: 'utf8', includeData: true, includeStructure: false, taskId: randomUUID() });
      expect(result.rows).toBe(1_000_000);
    } finally { clearInterval(sample); }
    const bytes = (await stat(filePath)).size, rssGrowth = peakRss - initialRss;
    // 文件约 180 MiB；若一次性缓存完整数据，将明显超过这一宽松且可操作的预算。
    expect(bytes).toBeGreaterThan(180 * 1024 * 1024); expect(rssGrowth).toBeLessThan(160 * 1024 * 1024);
    console.info(JSON.stringify({ 验收: '百万行', rows: count, pageSize: 500, populatedMs: Math.round(populatedMs), pageMs: Math.round(pageMs), exportMs: Math.round(performance.now() - exportStart), bytes, initialRss, peakRss, rssGrowth }));
    const cancelledPath = join(folder, 'cancelled.csv'), taskId = randomUUID();
    const exporting = engine.handle('files.export', { connectionId: profile.id, database, table: 'million_rows', filePath: cancelledPath, format: 'csv', encoding: 'utf8', includeData: true, includeStructure: false, taskId });
    const rejected = expect(exporting).rejects.toThrow();
    await expect.poll(() => events.some(event => event.taskId === taskId && (event.rows ?? 0) >= 500)).toBe(true);
    await engine.handle('query.cancel', { taskId }); await rejected;
    expect(events.some(event => event.taskId === taskId && event.status === 'cancelled')).toBe(true);
    expect((await readdir(folder)).some(name => name.startsWith('cancelled.csv'))).toBe(false);
    expect(Number((await query('SELECT COUNT(*) FROM million_rows')).results[0].rows[0].c0)).toBe(1_000_000);
  }, 240000);
});
