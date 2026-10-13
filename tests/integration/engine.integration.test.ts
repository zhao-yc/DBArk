import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '../../src/engine';
import type { ConnectionProfile, QueryOutcome, TablePage, TaskEvent } from '../../src/shared/contracts';
import { identifier } from '../../src/engine/sql';

// 必须显式指向已核对的远程测试数据库；本套件不运行 Docker，也不使用业务库。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && Boolean(process.env.DBARK_TEST_HOST);
const database = `dbark_test_${Date.now()}_${randomUUID().slice(0, 8)}`;
const events: TaskEvent[] = [];
const engine = new Engine(event => events.push(event));
const profile: ConnectionProfile = {
  id: 'integration', name: '独立集成测试', group: '测试', color: '#5273ff', dialect: 'mysql',
  host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? '3306'),
  user: process.env.DBARK_TEST_USER ?? 'root', password: process.env.DBARK_TEST_PASSWORD ?? '',
  ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}),
};
let sessionId = '', adminSession = '', folder = '', databaseCreated = false;

/** 每次调用使用唯一任务编号，保证取消和进度断言不相互干扰。 */
async function query(sql: string, session = sessionId, maxRows = 1000): Promise<QueryOutcome> {
  return engine.handle('query.execute', { sessionId: session, sql, taskId: randomUUID(), maxRows });
}
/** 以统一的稳定排序分页读取当前测试库，便于断言数据往返结果。 */
async function page(table: string): Promise<TablePage> {
  return engine.handle('table.page', { connectionId: profile.id, database, table, page: 1, pageSize: 100, filters: [], sort: [] });
}

describe.skipIf(!enabled)('远程 MySQL/MariaDB 数据库引擎', () => {
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'dbark-integration-'));
    await engine.handle('connections.open', { id: profile.id, profile });
    adminSession = (await engine.handle('sessions.open', { connectionId: profile.id })).sessionId;
    await query(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`, adminSession); databaseCreated = true;
    sessionId = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
  });
  afterAll(async () => {
    try {
      // 先关闭业务会话，防止失败用例遗留的事务阻塞 DROP DATABASE 元数据锁。
      if (sessionId) await engine.handle('sessions.close', { sessionId });
      if (databaseCreated) {
        // 清理不依赖可能被断线测试破坏的原管理员会话。
        const cleanupSession = (await engine.handle('sessions.open', { connectionId: profile.id })).sessionId;
        await query(`DROP DATABASE ${identifier(database)}`, cleanupSession);
      }
    }
    finally {
      await engine.closeAll();
      if (folder) { for (const name of await readdir(folder)) await rm(join(folder, name)); await rmdir(folder); }
    }
  });

  it('保留 BIGINT、DECIMAL、微秒时间、二进制和 JSON 数值精度', async () => {
    await query('CREATE TABLE precision_values (id BIGINT UNSIGNED PRIMARY KEY, amount DECIMAL(40,18), happened DATETIME(6), payload BLOB, document JSON) ENGINE=InnoDB');
    await query(`INSERT INTO precision_values VALUES (18446744073709551615,12345678901234567890.123456789012345678,'2026-10-13 12:34:56.123456',X'00ff','{"n":18446744073709551615}')`);
    const result = await page('precision_values');
    expect(result.rows[0].id).toBe('18446744073709551615');
    expect(result.rows[0].amount).toBe('12345678901234567890.123456789012345678');
    expect(result.rows[0].happened).toBe('2026-10-13 12:34:56.123456');
    expect(result.rows[0].payload).toEqual({ type: 'binary', base64: 'AP8=' });
    expect(String(result.rows[0].document)).toContain('18446744073709551615');
  });

  it('同名结果列不覆盖，多个语句共享总行数上限', async () => {
    const result = await query('SELECT 1 AS same, 2 AS same; SELECT 3 UNION ALL SELECT 4', sessionId, 2);
    // 服务器版本可能将整数字面量报告为 BIGINT，统一保留其字符串精度。
    expect(Object.values(result.results[0].rows[0]).map(String)).toEqual(['1', '2']);
    expect(result.results[1].rows).toHaveLength(1); expect(result.results[1].truncated).toBe(true);
  });

  it('临时表与显式事务绑定标签页会话', async () => {
    const other = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    try {
      await query('CREATE TEMPORARY TABLE tab_temp (id INT)');
      await expect(query('SELECT * FROM tab_temp', other)).rejects.toThrow();
      await query('CREATE TABLE transactions_test (id INT PRIMARY KEY) ENGINE=InnoDB');
      await engine.handle('query.transaction', { sessionId, action: 'begin' });
      await query('INSERT INTO transactions_test VALUES (1)');
      expect((await query('SELECT * FROM transactions_test', other)).results[0].rows).toHaveLength(0);
      await engine.handle('query.transaction', { sessionId, action: 'rollback' });
      expect((await query('SELECT * FROM transactions_test')).results[0].rows).toHaveLength(0);
    } finally { await engine.handle('sessions.close', { sessionId: other }); }
  });

  it('任何并发修改冲突会回滚整批，且原值回写可以正常提交', async () => {
    await query("CREATE TABLE edit_test (id INT PRIMARY KEY, title VARCHAR(100)) ENGINE=InnoDB; INSERT INTO edit_test VALUES (1,'old'),(2,'old')");
    const original = await page('edit_test');
    await query("UPDATE edit_test SET title='other' WHERE id=2");
    await expect(engine.handle('table.apply', { connectionId: profile.id, database, table: 'edit_test', taskId: randomUUID(), changes: [
      { kind: 'update', before: original.rows[0], values: { title: 'mine' } }, { kind: 'delete', before: original.rows[1] },
    ] })).rejects.toThrow('回滚');
    const actual = await page('edit_test'); expect(actual.rows.map(row => row.title)).toEqual(['old', 'other']);
    expect(await engine.handle('table.apply', { connectionId: profile.id, database, table: 'edit_test', taskId: randomUUID(), changes: [{ kind: 'update', before: actual.rows[0], values: { title: 'old' } }] })).toEqual({ affectedRows: 1 });
  });

  it('大小写、重音和尾空格变更在宽松排序规则下仍触发乐观锁冲突', async () => {
    await query("CREATE TABLE exact_ci (id INT PRIMARY KEY, title VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci, revision INT NOT NULL DEFAULT 0) ENGINE=InnoDB; INSERT INTO exact_ci(id,title) VALUES (1,'foo'),(2,'foo'),(3,'cafe')");
    const original = await page('exact_ci');
    await query("UPDATE exact_ci SET title='FOO' WHERE id=1; UPDATE exact_ci SET title='foo ' WHERE id=2; UPDATE exact_ci SET title='café' WHERE id=3");
    // 先证明普通比较确实会漏掉这些变化，再验证编辑引擎拒绝覆盖。
    const loose = await query("SELECT id FROM exact_ci WHERE (id IN (1,2) AND title='foo') OR (id=3 AND title='cafe')");
    expect(loose.results[0].rows).toHaveLength(3);
    for (const row of original.rows) {
      await expect(engine.handle('table.apply', { connectionId: profile.id, database, table: 'exact_ci', taskId: randomUUID(), changes: [{ kind: 'update', before: row, values: { revision: 1 } }] })).rejects.toThrow('回滚');
    }
    const actual = await page('exact_ci');
    expect(actual.rows.map(row => row.title)).toEqual(['FOO', 'foo ', 'café']);
    expect(actual.rows.map(row => row.revision)).toEqual([0, 0, 0]);
  });

  it('latin1 文本及 CHAR、TEXT、ENUM、SET、JSON 未修改旧值能正常提交', async () => {
    await query("CREATE TABLE exact_latin1 (id INT PRIMARY KEY, title VARCHAR(100) CHARACTER SET latin1 COLLATE latin1_swedish_ci, fixed_text CHAR(10) CHARACTER SET latin1, long_text TEXT CHARACTER SET latin1, category ENUM('café','autre') CHARACTER SET latin1, tags SET('café','thé') CHARACTER SET latin1, document JSON, amount DECIMAL(20,3), happened DATETIME(6), payload VARBINARY(10)) ENGINE=InnoDB");
    await query(`INSERT INTO exact_latin1 VALUES (1,'élève','café','déjà vu','café','café,thé','{"message":"café"}',1.000,'2026-10-13 12:34:56.123456',X'00ff')`);
    const original = (await page('exact_latin1')).rows[0];
    expect(original.title).toBe('élève'); expect(original.category).toBe('café');
    expect(await engine.handle('table.apply', { connectionId: profile.id, database, table: 'exact_latin1', taskId: randomUUID(), changes: [{ kind: 'update', before: original, values: { amount: '2.000' } }] })).toEqual({ affectedRows: 1 });
    const actual = (await page('exact_latin1')).rows[0];
    expect(actual).toEqual({ ...original, amount: '2.000' });
  });

  it('取消长查询后可以复用同一会话，且任务状态明确', async () => {
    const taskId = randomUUID();
    const running = engine.handle('query.execute', { sessionId, sql: 'SELECT SLEEP(20)', taskId, maxRows: 1 });
    const rejected = expect(running).rejects.toThrow();
    await new Promise(resolve => setTimeout(resolve, 300));
    await engine.handle('query.cancel', { taskId }); await rejected;
    expect(String((await query('SELECT 7')).results[0].rows[0].c0)).toBe('7');
    expect(events.some(event => event.taskId === taskId && event.status === 'cancelled')).toBe(true);
  });

  it('CSV 与 JSON 流式导出导入往返保留空值、换行、二进制及大整数', async () => {
    await query("CREATE TABLE file_source (id BIGINT UNSIGNED PRIMARY KEY, title TEXT, payload BLOB) ENGINE=InnoDB; INSERT INTO file_source VALUES (9007199254740993,'含逗号,和换行\n中文',X'00ff'),(2,NULL,NULL),(3,'',X'')");
    for (const format of ['csv', 'json'] as const) {
      const target = 'file_' + format, filePath = join(folder, format + '.data');
      await query(`CREATE TABLE ${identifier(target)} LIKE file_source`);
      const exported = await engine.handle('files.export', { connectionId: profile.id, database, table: 'file_source', filePath, format, encoding: 'utf8', includeData: true, includeStructure: false, taskId: randomUUID() });
      expect(exported.rows).toBe(3);
      const imported = await engine.handle('files.import', { connectionId: profile.id, database, table: target, filePath, format, encoding: 'utf8', mapping: { id: 'id', title: 'title', payload: 'payload' }, taskId: randomUUID() });
      expect(imported).toEqual({ rows: 3, errors: [] }); expect((await page(target)).rows).toEqual((await page('file_source')).rows);
    }
  });

  it('SQL 导入识别 DELIMITER，并拒绝把未闭合事务当作已提交成功', async () => {
    await query('CREATE TABLE import_tx (id INT PRIMARY KEY) ENGINE=InnoDB');
    const filePath = join(folder, 'transaction.sql'); await writeFile(filePath, 'START TRANSACTION; INSERT INTO import_tx VALUES (1);');
    const result = await engine.handle('files.import', { connectionId: profile.id, database, table: '', filePath, format: 'sql', encoding: 'utf8', mapping: {}, taskId: randomUUID() });
    expect(result.rows).toBe(0); expect(result.errors.join('')).toContain('未提交事务'); expect((await page('import_tx')).rows).toHaveLength(0);
    await writeFile(filePath, 'DELIMITER $$\nCREATE PROCEDURE dbark_routine() BEGIN SELECT 1; SELECT 2; END$$\nDELIMITER ;\nCALL dbark_routine();');
    const procedure = await engine.handle('files.import', { connectionId: profile.id, database, table: '', filePath, format: 'sql', encoding: 'utf8', mapping: {}, taskId: randomUUID() });
    expect(procedure.errors).toEqual([]);
  });

  it('EXPLAIN 拒绝多语句及 ANALYZE，不执行后续写操作', async () => {
    // 使用本用例自建的对象，单独运行该用例时也不依赖之前的编辑测试。
    await query('CREATE TABLE explain_guard (id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO explain_guard VALUES (1),(2)');
    await expect(engine.handle('query.explain', { sessionId, sql: 'SELECT 1; DROP TABLE explain_guard', taskId: randomUUID(), maxRows: 100 })).rejects.toThrow('一条 SQL');
    await expect(engine.handle('query.explain', { sessionId, sql: 'EXPLAIN ANALYZE SELECT 1', taskId: randomUUID(), maxRows: 100 })).rejects.toThrow('实际执行');
    expect((await page('explain_guard')).rows).toHaveLength(2);
  });

  it('大字段页明确拒绝编辑，查询结果标记截断', async () => {
    await query('CREATE TABLE large_values (id INT PRIMARY KEY, payload MEDIUMTEXT) ENGINE=InnoDB; INSERT INTO large_values VALUES (1,REPEAT(\'x\',300000))');
    await expect(page('large_values')).rejects.toThrow('大字段');
    const result = await query('SELECT payload FROM large_values'); expect(result.results[0].truncated).toBe(true); expect(result.results[0].rows).toHaveLength(0);
  });

  it('原型属性同名字段可以浏览与导出，不会丢列', async () => {
    await query('CREATE TABLE prototype_columns (id INT PRIMARY KEY, `__proto__` VARCHAR(20), constructor VARCHAR(20)) ENGINE=InnoDB; INSERT INTO prototype_columns VALUES (1,\'字段一\',\'字段二\')');
    const result = await page('prototype_columns'); expect(Object.hasOwn(result.rows[0], '__proto__')).toBe(true); expect(result.rows[0]['__proto__']).toBe('字段一');
  });
});
