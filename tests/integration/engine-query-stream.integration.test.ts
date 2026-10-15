import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parse } from 'csv-parse';
import { parse as parseCsv } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier } from '../../src/engine/sql';
import type { ConnectionProfile, QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import { queryStreamExportLimits, type QueryExportProgress, type QueryStreamExportInput, type QueryStreamExportOutput } from '../../src/shared/queryStreamExport';
import { readQueryCsvZip } from '../helpers/queryCsvZip';

// 只连接显式启用且已核对的远程实例，既不创建 Docker，也不回退到本机数据库。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && Boolean(process.env.DBARK_TEST_HOST);
const database = `dbark_stream_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const profile: ConnectionProfile = {
  id: `stream-${randomUUID()}`, name: '完整流式导出隔离验收', group: '测试', color: '#53c9ae', dialect: 'mysql',
  host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? '3306'),
  user: process.env.DBARK_TEST_USER ?? 'root', password: process.env.DBARK_TEST_PASSWORD ?? '',
  ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}),
  ...(process.env.DBARK_TEST_SSH === '1' ? { ssh: { enabled: true, host: process.env.DBARK_TEST_SSH_HOST ?? '', port: Number(process.env.DBARK_TEST_SSH_PORT ?? '22'), user: process.env.DBARK_TEST_SSH_USER ?? '', privateKeyPath: process.env.DBARK_TEST_SSH_KEY, hostFingerprint: process.env.DBARK_TEST_SSH_FINGERPRINT } } : {}),
};
const events: TaskEvent[] = [];
const engine = new Engine(event => events.push(event));
let observer: ManagedConnection | undefined, sessionId = '', directory = '', created = false;
type JsonRowResult = { kind: 'rows'; resultOrdinal: number; statementOrdinal: number; rowResultOrdinal: number; columns: { position: number; name: string; exportName: string; type: string }[]; rows: Record<string, unknown>[]; rowsWritten: number; warningCount?: number };
type JsonStatusResult = { kind: 'status'; resultOrdinal: number; statementOrdinal: number; affectedRows: number; insertId: string; warningCount: number; rowsWritten: number };
type JsonDocument = { format: string; version: number; results: (JsonRowResult | JsonStatusResult)[] };

/** 常规执行只用于准备和独立核对，导出始终走被测的新命令。 */
async function query(sql: string): Promise<QueryOutcome> { return engine.handle('query.execute', { sessionId, sql, taskId: randomUUID(), maxRows: 1000 }); }
/** 独立观察连接只读取服务器已提交状态，不复用待验证的标签会话。 */
async function observed(sql: string): Promise<Record<string, unknown>[]> { return (await execute(observer!, sql)).rows; }
/** 位置键是查询结果的真实契约，不能把重复列名当作唯一键。 */
function firstValues(outcome: QueryOutcome): unknown[] { return Object.values(outcome.results.find(result => result.rows.length)!.rows[0]); }
/** 每次调用只发送一次导出命令；主进程文件授权的独立 E2E 另验。 */
async function exportSql(sql: string, overrides: Partial<QueryStreamExportInput> = {}, path = join(directory, `${randomUUID()}.json`)): Promise<{ output: QueryStreamExportOutput; path: string; taskId: string }> {
  const input: QueryStreamExportInput & { filePath: string } = { sessionId, sql, taskId: randomUUID(), fileToken: randomUUID(), filePath: path, format: 'json', encoding: 'utf8', protocol: 'text-strict', resultSelection: { kind: 'all' }, ...overrides };
  const output = await engine.handle('query.exportStream', input) as QueryStreamExportOutput;
  return { output, path, taskId: input.taskId };
}
/** 独立 JSON 解析器核对实际文件；大文件用下方 CSV 流读取，禁止整体读入内存。 */
async function json(path: string, encoding = 'utf8'): Promise<JsonDocument> { return JSON.parse(iconv.decode(await readFile(path), encoding)); }
/** 行结果序号与状态包序号独立，按封装类型筛选而非假定所有结果都包含行。 */
function rowResults(document: JsonDocument): JsonRowResult[] { return document.results.filter((result): result is JsonRowResult => result.kind === 'rows'); }
/** 错误/取消必须已走到真正的任务终态，且自有 partial 已清理。 */
async function terminal(taskId: string, status: 'completed' | 'failed' | 'cancelled'): Promise<QueryExportProgress> {
  const event = events.filter(item => item.taskId === taskId).at(-1);
  expect(event?.status).toBe(status); expect(event?.queryExport).toBeDefined();
  expect((await readdir(directory)).filter(name => name.endsWith('.partial'))).toEqual([]);
  return event!.queryExport!;
}
/** 所有等待均由可观察状态结束；超时仅用于揭示挂起，不重试用户写入。 */
async function serverIsRunning(threadId: number, fragment: string): Promise<boolean> {
  const rows = await observed(`SELECT ID, COMMAND, INFO FROM information_schema.PROCESSLIST WHERE ID=${threadId}`);
  return rows.length === 1 && rows[0].COMMAND !== 'Sleep' && String(rows[0].INFO).includes(fragment);
}

describe.skipIf(!enabled)('远程完整 SQL 流式导出', () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dbark-q05-stream-'));
    observer = await connect(profile);
    await execute(observer, `CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`); created = true;
    await execute(observer, `USE ${identifier(database)}`);
    await execute(observer, 'CREATE TABLE stream_guard (id INT PRIMARY KEY, hits INT NOT NULL DEFAULT 0) ENGINE=InnoDB');
    await execute(observer, 'CREATE TABLE stream_float (id INT PRIMARY KEY, f FLOAT, d DOUBLE) ENGINE=InnoDB');
    await execute(observer, 'INSERT INTO stream_float VALUES (1,1,1),(2,1.00000011920928955078125,1.0000000000000002)');
    await engine.handle('connections.open', { id: profile.id, profile });
    const version = (await observed('SELECT VERSION() AS version'))[0].version;
    console.log(`完整流式导出隔离环境：端口 ${profile.port}，版本 ${version}。`);
  });
  beforeEach(async () => { events.length = 0; sessionId = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId; });
  afterEach(async () => { if (sessionId) { await engine.handle('sessions.close', { sessionId }); sessionId = ''; } });
  afterAll(async () => {
    try { await engine.closeAll(); }
    finally {
      try {
        if (created && observer) {
          if (!/^dbark_stream_\d+_[0-9a-f]{8}$/.test(database)) throw new Error('拒绝清理非本例流式导出数据库');
          await execute(observer, `DROP DATABASE ${identifier(database)}`);
          expect((await execute(observer, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database])).rows).toEqual([]);
        }
      } finally {
        await observer?.close();
        if (directory) {
          const absolute = resolve(directory);
          if (dirname(absolute) !== resolve(tmpdir()) || !/^dbark-q05-stream-[a-zA-Z0-9]+$/.test(basename(absolute))) throw new Error('拒绝清理未知临时目录');
          await rm(absolute, { recursive: true, force: true });
        }
      }
    }
  });

  it('CSV容器单次CALL保留空集、重复名和终态，同物理会话事务不被文件提交', async () => {
    await execute(observer!, 'CREATE PROCEDURE csv_zip_proc() BEGIN SET @csv_zip_runs=@csv_zip_runs+1; INSERT INTO stream_guard VALUES(451,1); SELECT CONNECTION_ID() AS tid,@csv_zip_runs AS runs, value AS same_name,value+1 AS same_name FROM csv_zip_temp; SELECT 9 AS empty_value FROM DUAL WHERE 0; SELECT CAST(18446744073709551615 AS UNSIGNED) AS big_value,CAST(0.12345678901234567890 AS DECIMAL(30,20)) AS exact_value,CAST(\'2026-10-16 01:02:03.123456\' AS DATETIME(6)) AS moment,NULL AS missing,\'\' AS empty_text,UNHEX(\'0001FF\') AS bytes_value; END');
    try {
      const threadId = String(firstValues(await query('SELECT CONNECTION_ID()'))[0]); await query('CREATE TEMPORARY TABLE csv_zip_temp(value INT); INSERT INTO csv_zip_temp VALUES(42); SET @csv_zip_runs=0; START TRANSACTION');
      const exported = await exportSql('CALL csv_zip_proc()', { format: 'csv-zip' }, join(directory, 'all-results.zip')), files = await readQueryCsvZip(exported.path), manifest = JSON.parse(files.get('manifest.json')!.toString('utf8'));
      expect(exported.output).toMatchObject({ statementsCompleted: 1, fileCommitted: true, transactionKnown: true, transactionOpen: true }); expect(manifest.results.map((result: any) => result.kind)).toEqual(['rows', 'rows', 'rows', 'status']);
      expect(parseCsv(files.get('results/rows-001.csv')!)).toEqual([['tid', 'runs', 'same_name', 'same_name [4]'], [threadId, '1', '42', '43']]); expect(parseCsv(files.get('results/rows-002.csv')!)).toEqual([['empty_value']]);
      expect(parseCsv(files.get('results/rows-003.csv')!)[1]).toEqual(['18446744073709551615', '0.12345678901234567890', '2026-10-16 01:02:03.123456', '\\N', '', 'base64:AAH/']);
      expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id=451'))[0].total)).toBe(0); expect(firstValues(await query('SELECT CONNECTION_ID(),@csv_zip_runs')).map(String)).toEqual([threadId, '1']); expect((await terminal(exported.taskId, 'completed')).peakBufferedRows).toBeLessThanOrEqual(1);
      await query('ROLLBACK'); expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id=451'))[0].total)).toBe(0);
    } finally { await query('ROLLBACK'); await execute(observer!, 'DROP PROCEDURE IF EXISTS csv_zip_proc'); }
  });

  it('CSV容器后续SQL失败保留旧包和已提交写入，不发布半包或自动重放', async () => {
    const path = join(directory, 'failed-multi.zip'), taskId = randomUUID(); await writeFile(path, '原ZIP文件');
    await expect(engine.handle('query.exportStream', { sessionId, taskId, sql: 'INSERT INTO stream_guard VALUES(452,1);SELECT 1 AS first_value;SELECT * FROM csv_zip_missing_table;INSERT INTO stream_guard VALUES(453,1)', fileToken: randomUUID(), filePath: path, format: 'csv-zip', encoding: 'utf8', protocol: 'text-strict', resultSelection: { kind: 'all' } })).rejects.toThrow('已完成 2 条 SQL');
    expect(await readFile(path, 'utf8')).toBe('原ZIP文件'); expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id=452'))[0].total)).toBe(1); expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id=453'))[0].total)).toBe(0);
    expect(await terminal(taskId, 'failed')).toMatchObject({ statementsCompleted: 2, sqlMayHaveExecuted: true, fileCommitted: false, transactionKnown: false });
  });

  it('一次执行沿用会话事务、临时表和变量，文件提交不改变数据库事务边界', async () => {
    const threadId = Number(firstValues(await query('SELECT CONNECTION_ID()'))[0]);
    await query('CREATE TEMPORARY TABLE session_only (value INT); INSERT INTO session_only VALUES (42); SET @stream_value=73; START TRANSACTION');
    const result = await exportSql('INSERT INTO stream_guard VALUES (101,1); SELECT CONNECTION_ID() AS thread_id, @stream_value AS variable_value, value FROM session_only; SELECT ROW_COUNT() AS previous_rows; SELECT COUNT(*) AS own_rows FROM stream_guard WHERE id=101');
    expect(result.output).toMatchObject({ statementsCompleted: 4, fileCommitted: true, transactionOpen: true, transactionKnown: true });
    const document = await json(result.path); expect(document.format).toBe('DBArk-query-results'); expect(document.version).toBe(1);
    expect(Object.keys(rowResults(document)[0].rows[0])).toEqual(['thread_id', 'variable_value', 'value']);
    expect(Object.values(rowResults(document)[0].rows[0]).map(Number)).toEqual([threadId, 73, 42]);
    expect(Number(rowResults(document).at(-1)!.rows[0].own_rows)).toBe(1);
    expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id=101'))[0].total)).toBe(0);
    expect(firstValues(await query('SELECT CONNECTION_ID()')).map(Number)).toEqual([threadId]);
    await query('ROLLBACK'); expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id=101'))[0].total)).toBe(0);
    await terminal(result.taskId, 'completed');
  });

  it('诊断查询保持 ROW_COUNT、FOUND_ROWS 与警告，首次和再次二进制执行均不透明回退', async () => {
    for (const protocol of ['text-strict', 'binary-explicit'] as const) {
      for (let iteration = 0; iteration < 2; iteration++) {
        await query('INSERT INTO stream_guard VALUES (102,0) ON DUPLICATE KEY UPDATE hits=0; UPDATE stream_guard SET hits=1 WHERE id=102');
        const result = await exportSql("SELECT ROW_COUNT() AS changed; SELECT SQL_CALC_FOUND_ROWS id FROM stream_float LIMIT 1; SELECT FOUND_ROWS() AS found; SELECT CAST('不是数字' AS UNSIGNED) AS cast_value; SHOW WARNINGS; SELECT @@warning_count AS warning_total", { protocol });
        const rows = rowResults(await json(result.path));
        expect(Number(rows[0].rows[0].changed)).toBe(1); expect(Number(rows[2].rows[0].found)).toBe(2);
        expect(rows[4].rows.some(row => Number(row.Code) === 1292 && String(row.Message).includes('不是数字'))).toBe(true);
        expect(rows[3].warningCount).toBe(1); expect(result.output.results[3].warningCount).toBe(1);
        expect(Number(rows[5].rows[0].warning_total)).toBeGreaterThan(0);
        await terminal(result.taskId, 'completed');
      }
    }
  });

  it('DELIMITER、零行集、异构 CALL 结果与状态编号在 JSON 和 CSV 中不串流', async () => {
    const source = 'DELIMITER $$\nCREATE PROCEDURE stream_proc() BEGIN SELECT 11 AS left_value; SELECT 22 AS right_value FROM DUAL WHERE 0; SELECT 33 AS final_value; END$$\nDELIMITER ;\nCALL stream_proc(); DROP PROCEDURE stream_proc;';
    const exported = await exportSql(source); const document = await json(exported.path);
    expect(document.results.map(result => [result.resultOrdinal, result.statementOrdinal, result.kind])).toEqual([[1, 1, 'status'], [2, 2, 'rows'], [3, 2, 'rows'], [4, 2, 'rows'], [5, 2, 'status'], [6, 3, 'status']]);
    expect(rowResults(document).map(result => [result.rowResultOrdinal, result.rows.map(row => Object.values(row).map(String))])).toEqual([[1, [['11']]], [2, []], [3, [['33']]]]);
    expect(exported.output.results).toHaveLength(6);
    const csv = await exportSql(source, { format: 'csv', resultSelection: { kind: 'row-result', ordinal: 2 } }, join(directory, 'empty-row-result.csv'));
    expect(parseCsv(await readFile(csv.path, 'utf8'))).toEqual([['right_value']]);
    expect((await observed("SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() AND ROUTINE_NAME='stream_proc'"))).toEqual([]);
  });

  it('静态和动态模式共享原扫描器，NO_BACKSLASH_ESCAPES 字符串不产生伪参数', async () => {
    const source = "SET SESSION sql_mode='NO_BACKSLASH_ESCAPES'; SELECT 'path\\' AS path_value, :v AS chosen; SET @future_stream_mode='ANSI_QUOTES'; SET SESSION sql_mode=@future_stream_mode; SELECT :v AS \"quoted_value\"";
    const exported = await exportSql(source, { parameters: [{ name: 'v', type: 'text', value: '模式值' }] });
    expect(rowResults(await json(exported.path)).map(result => result.rows)).toEqual([[{ path_value: 'path\\', chosen: '模式值' }], [{ quoted_value: '模式值' }]]);
    expect(exported.output.statementsCompleted).toBe(5);
    await query("SET SESSION sql_mode=''");
  });

  it('重名、空名与原型列保持独立值，高精度、微秒、空值和二进制按实际文件往返', async () => {
    const source = "SELECT CAST(18446744073709551615 AS UNSIGNED) AS exact_bigint, CAST('12345678901234567890.12345678901234567890' AS DECIMAL(40,20)) AS amount, CAST('2026-10-14 12:34:56.123456' AS DATETIME(6)) AS happened, NULL AS null_value, '' AS empty_value, '中文🚢,换行' AS text_value, X'00017fff' AS payload, 'a' AS dup, 'b' AS dup, '保留' AS `dup [9]`, '原型' AS `__proto__`, '构造' AS `constructor`, '空名' AS ``";
    const result = await exportSql(source, { encoding: 'utf16le' }); const bytes = await readFile(result.path);
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
    const rows = rowResults(await json(result.path, 'utf16le')); const row = rows[0].rows[0];
    expect(rows[0].columns.map(column => column.position)).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
    expect(new Set(Object.keys(row)).size).toBe(13);
    expect(row).toMatchObject({ exact_bigint: '18446744073709551615', amount: '12345678901234567890.12345678901234567890', happened: '2026-10-14 12:34:56.123456', null_value: null, empty_value: '', text_value: '中文🚢,换行', payload: { type: 'binary', base64: 'AAF//w==' }, dup: 'a', 'dup [10]': 'b', 'dup [9]': '保留', constructor: '构造', '列 [13]': '空名' });
    expect(Object.hasOwn(row, '__proto__')).toBe(true); expect(row.__proto__).toBe('原型');
    expect((await readFile(result.path, 'utf16le')).includes(source)).toBe(false);
    const csv = await exportSql("SELECT NULL AS n,'' AS e, CONCAT(CHAR(92 USING utf8mb4),'N') AS literal, X'00ff' AS b, '中文,逗号' AS t", { format: 'csv', encoding: 'gb18030', resultSelection: { kind: 'row-result', ordinal: 1 } }, join(directory, 'precision.csv'));
    expect(parseCsv(iconv.decode(await readFile(csv.path), 'gb18030'))).toEqual([['n', 'e', 'literal', 'b', 't'], ['\\N', '', '\\\\N', 'base64:AP8=', '中文,逗号']]);
  });

  it('严格文本拒绝 FLOAT 并保留原文件，显式二进制保持相邻 IEEE 数值且不重放', async () => {
    const path = join(directory, 'float-protection.json'); const previous = Buffer.from('原文件：浮点失败不能覆盖'); await writeFile(path, previous);
    const taskId = randomUUID();
    await expect(exportSql('INSERT INTO stream_guard VALUES (103,1); SELECT f,d FROM stream_float ORDER BY id; INSERT INTO stream_guard VALUES (104,1)', { taskId }, path)).rejects.toThrow('FLOAT/DOUBLE');
    expect(await readFile(path)).toEqual(previous); expect((await observed('SELECT id,hits FROM stream_guard WHERE id IN (103,104)'))).toEqual([{ id: 103, hits: 1 }]);
    expect(await terminal(taskId, 'failed')).toMatchObject({ statementsCompleted: 1, fileCommitted: false, sqlMayHaveExecuted: true });
    const binary = await exportSql('SELECT f,d FROM stream_float ORDER BY id', { protocol: 'binary-explicit' });
    expect(rowResults(await json(binary.path))[0].rows).toEqual([{ f: 1, d: 1 }, { f: 1.0000001192092896, d: 1.0000000000000002 }]);
    expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id=103'))[0].total)).toBe(1);
  });

  it('POINT 与 LineString 几何对象在两种协议中均按现有 JSON 字符串语义完整保留', async () => {
    for (const protocol of ['text-strict', 'binary-explicit'] as const) {
      const result = await exportSql("SELECT ST_GeomFromText('POINT(12.5 -34.25)') AS point_value, ST_GeomFromText('LINESTRING(0 0,1.5 -2.25,8 9)') AS line_value", { protocol });
      const row = rowResults(await json(result.path))[0].rows[0];
      expect(typeof row.point_value).toBe('string'); expect(typeof row.line_value).toBe('string');
      expect(JSON.parse(row.point_value as string)).toEqual({ x: 12.5, y: -34.25 });
      expect(JSON.parse(row.line_value as string)).toEqual([{ x: 0, y: 0 }, { x: 1.5, y: -2.25 }, { x: 8, y: 9 }]);
      await terminal(result.taskId, 'completed');
    }
  });

  it('CSV N 指真实行结果，所有后续语句执行；不存在 N 保留旧文件和已经提交的前缀', async () => {
    const result = await exportSql('INSERT INTO stream_guard VALUES (105,1); SELECT 7 AS ignored; SELECT 8 AS chosen; UPDATE stream_guard SET hits=hits+1 WHERE id=105', { format: 'csv', resultSelection: { kind: 'row-result', ordinal: 2 } }, join(directory, 'nth.csv'));
    expect(parseCsv(await readFile(result.path, 'utf8'))).toEqual([['chosen'], ['8']]);
    expect(Number((await observed('SELECT hits FROM stream_guard WHERE id=105'))[0].hits)).toBe(2);
    const target = join(directory, 'missing.csv'); await writeFile(target, '不能替换的旧 CSV'); const taskId = randomUUID();
    await expect(exportSql('INSERT INTO stream_guard VALUES (106,1); SELECT 9 AS only_result; UPDATE stream_guard SET hits=hits+1 WHERE id=106', { taskId, format: 'csv', resultSelection: { kind: 'row-result', ordinal: 2 } }, target)).rejects.toThrow('不存在');
    expect(await readFile(target, 'utf8')).toBe('不能替换的旧 CSV'); expect(Number((await observed('SELECT hits FROM stream_guard WHERE id=106'))[0].hits)).toBe(2);
    expect(await terminal(taskId, 'failed')).toMatchObject({ statementsCompleted: 3, fileCommitted: false, sqlMayHaveExecuted: true });
  });

  it('SQL 中途失败不重放已提交前缀，保留原文件，参数错误不落入任务事件', async () => {
    await query('CREATE TABLE stream_secret (value VARCHAR(100) PRIMARY KEY)');
    const marker = `仅本次参数_${randomUUID()}`;
    await engine.handle('query.executeParameterized', { sessionId, taskId: randomUUID(), sql: 'INSERT INTO stream_secret VALUES (:value)', parameters: [{ name: 'value', type: 'text', value: marker }], maxRows: 10 });
    events.length = 0; const target = join(directory, 'sql-error.json'); await writeFile(target, '失败保护'); const taskId = randomUUID();
    let failure = '';
    try { await exportSql('INSERT INTO stream_guard VALUES (107,1); INSERT INTO stream_secret VALUES (:value); INSERT INTO stream_guard VALUES (108,1)', { taskId, parameters: [{ name: 'value', type: 'text', value: marker }] }, target); }
    catch (error) { failure = String(error); }
    expect(failure).toContain('ER_DUP_ENTRY'); expect(failure).not.toContain(marker); expect(JSON.stringify(events)).not.toContain(marker);
    expect(JSON.stringify(events).toLowerCase()).not.toContain(Buffer.from(marker).toString('hex'));
    expect(await readFile(target, 'utf8')).toBe('失败保护'); expect((await observed('SELECT id,hits FROM stream_guard WHERE id IN (107,108)'))).toEqual([{ id: 107, hits: 1 }]);
    expect(await terminal(taskId, 'failed')).toMatchObject({ statementsCompleted: 1, fileCommitted: false, sqlMayHaveExecuted: true, transactionKnown: false });
  });

  it('参数静态失败发生在第一条写入前，错误目标也不启动 SQL', async () => {
    const target = join(directory, 'before-execution.json'); await writeFile(target, '原内容');
    for (const parameters of [[{ name: 'value', type: 'integer' as const, value: '1; DROP TABLE stream_guard' }], []]) {
      await expect(exportSql('INSERT INTO stream_guard VALUES (109,1); SELECT :value', { parameters }, target)).rejects.toThrow();
      expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id=109'))[0].total)).toBe(0); expect(await readFile(target, 'utf8')).toBe('原内容');
    }
    await expect(exportSql('INSERT INTO stream_guard VALUES (109,1)', {}, join(directory, '不存在目录', 'result.json'))).rejects.toThrow();
    expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id=109'))[0].total)).toBe(0);
    expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
  });

  it('字段预算失败停止下一条 SQL，写入前缀保留且标签可继续查询', async () => {
    const target = join(directory, 'budget.json'); await writeFile(target, '预算失败原件'); const taskId = randomUUID();
    // 原始值约 1.4 MiB，低于 MySQL 5.7 默认包限制；JSON 的 NUL 转义确实超过字段预算。
    const nulCount = Math.floor(queryStreamExportLimits.fieldBytes / 6) + 1;
    await expect(exportSql(`INSERT INTO stream_guard VALUES (110,1); SELECT REPEAT(CHAR(0 USING utf8mb4),${nulCount}) AS too_large; INSERT INTO stream_guard VALUES (111,1)`, { taskId }, target)).rejects.toThrow('8 MiB');
    expect(await readFile(target, 'utf8')).toBe('预算失败原件'); expect((await observed('SELECT id FROM stream_guard WHERE id IN (110,111)'))).toEqual([{ id: 110 }]);
    await terminal(taskId, 'failed'); expect(firstValues(await query('SELECT 17 AS ready')).map(String)).toEqual(['17']);
  });

  it('真实文件原子替换失败不重放已完成 SQL，保留原目录内容并清理 partial', async () => {
    const target = join(directory, '已有同名目录'); await mkdir(target); await writeFile(join(target, '保留.txt'), '目录不得被删'); const taskId = randomUUID();
    await expect(exportSql('INSERT INTO stream_guard VALUES (112,1); SELECT 1 AS written', { taskId }, target)).rejects.toThrow();
    expect(await readFile(join(target, '保留.txt'), 'utf8')).toBe('目录不得被删'); expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id=112'))[0].total)).toBe(1);
    expect(await terminal(taskId, 'failed')).toMatchObject({ phase: 'committing', statementsCompleted: 2, fileCommitted: false, sqlMayHaveExecuted: true });
  });

  it('长查询真正取消后没有后续写入，旧文件与未提交事务保持，下一查询不受迟到 KILL 影响', async () => {
    await query('START TRANSACTION; INSERT INTO stream_guard VALUES (113,1)');
    const threadId = Number(firstValues(await query('SELECT CONNECTION_ID()'))[0]);
    const target = join(directory, 'cancelled.json'); await writeFile(target, '取消前原文件'); const taskId = randomUUID();
    const running = exportSql('SELECT SLEEP(30) AS pause_value; INSERT INTO stream_guard VALUES (114,1)', { taskId }, target);
    const rejected = expect(running).rejects.toThrow('取消');
    await expect.poll(() => serverIsRunning(threadId, 'SLEEP(30)'), { timeout: 10000 }).toBe(true);
    await expect(engine.handle('query.execute', { sessionId, taskId: randomUUID(), sql: 'INSERT INTO stream_guard VALUES (115,1)', maxRows: 1 })).rejects.toThrow();
    await engine.handle('query.cancel', { taskId }); await rejected;
    await terminal(taskId, 'cancelled'); expect(await readFile(target, 'utf8')).toBe('取消前原文件');
    await expect.poll(() => serverIsRunning(threadId, 'SLEEP(30)'), { timeout: 10000 }).toBe(false);
    expect(firstValues(await query('SELECT CONNECTION_ID(), COUNT(*) FROM stream_guard WHERE id=113')).map(Number)).toEqual([threadId, 1]);
    expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id IN (113,114,115)'))[0].total)).toBe(0);
    await query('ROLLBACK'); expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id=113'))[0].total)).toBe(0);
  });

  it('同一目标的并发任务在 SQL 发送前拒绝，原任务取消后目标锁释放', async () => {
    const target = join(directory, 'shared.json'); await writeFile(target, '并发原文件');
    const taskId = randomUUID(); const threadId = Number(firstValues(await query('SELECT CONNECTION_ID()'))[0]);
    const running = exportSql('SELECT SLEEP(30)', { taskId }, target); const rejected = expect(running).rejects.toThrow('取消');
    const second = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    try {
      await expect.poll(() => serverIsRunning(threadId, 'SLEEP(30)'), { timeout: 10000 }).toBe(true);
      await expect(exportSql('INSERT INTO stream_guard VALUES (116,1)', { sessionId: second }, target)).rejects.toThrow('另一个任务');
      expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id=116'))[0].total)).toBe(0);
    } finally { await engine.handle('query.cancel', { taskId }); await rejected; await engine.handle('sessions.close', { sessionId: second }); }
    expect(await readFile(target, 'utf8')).toBe('并发原文件');
    const result = await exportSql('SELECT 19 AS reopened', {}, target); expect(rowResults(await json(result.path))[0].rows.map(row => String(row.reopened))).toEqual(['19']);
  });

  it('真实磁盘持续写入时取消会收尾服务器命令，保留原文件且不执行脚本尾写入', async () => {
    const digits = '(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)';
    const source = `SELECT REPEAT('真实写入中文',128) AS payload FROM ${digits} a CROSS JOIN ${digits} b CROSS JOIN ${digits} c CROSS JOIN ${digits} d CROSS JOIN ${digits} e; INSERT INTO stream_guard VALUES (117,1)`;
    const path = join(directory, 'writing-cancel.csv'); await writeFile(path, '磁盘写入取消前原件'); const taskId = randomUUID();
    const threadId = Number(firstValues(await query('SELECT CONNECTION_ID()'))[0]);
    const running = exportSql(source, { taskId, format: 'csv', resultSelection: { kind: 'row-result', ordinal: 1 } }, path);
    const rejected = expect(running).rejects.toThrow('取消');
    await expect.poll(() => events.some(event => event.taskId === taskId && event.status === 'running' && (event.queryExport?.bytesWritten ?? 0) >= 65536 && (event.queryExport?.rowsWritten ?? 0) > 0), { timeout: 20000 }).toBe(true);
    await engine.handle('query.cancel', { taskId }); await rejected;
    const progress = await terminal(taskId, 'cancelled'); expect(progress.bytesWritten).toBeGreaterThan(0); expect(progress.rowsWritten).toBeLessThan(100000);
    expect(await readFile(path, 'utf8')).toBe('磁盘写入取消前原件');
    expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id=117'))[0].total)).toBe(0);
    await expect.poll(() => serverIsRunning(threadId, '真实写入中文'), { timeout: 10000 }).toBe(false);
    expect(firstValues(await query('SELECT CONNECTION_ID(), 29')).map(Number)).toEqual([threadId, 29]);
  });

  it('真实连接中断不重连或重放已提交前缀，文件和后续写入保持原状', async () => {
    const path = join(directory, 'disconnect.json'); await writeFile(path, '断线前原件'); const taskId = randomUUID();
    const threadId = Number(firstValues(await query('SELECT CONNECTION_ID()'))[0]);
    const running = exportSql('INSERT INTO stream_guard VALUES (118,1); SELECT SLEEP(30); INSERT INTO stream_guard VALUES (119,1)', { taskId }, path);
    const rejected = expect(running).rejects.toThrow();
    await expect.poll(() => serverIsRunning(threadId, 'SLEEP(30)'), { timeout: 10000 }).toBe(true);
    await execute(observer!, `KILL CONNECTION ${threadId}`); await rejected;
    expect(await terminal(taskId, 'failed')).toMatchObject({ fileCommitted: false, statementsCompleted: 1, sqlMayHaveExecuted: true, transactionKnown: false });
    expect(await readFile(path, 'utf8')).toBe('断线前原件'); expect((await observed('SELECT id,hits FROM stream_guard WHERE id IN (118,119)'))).toEqual([{ id: 118, hits: 1 }]);
    await expect(query('INSERT INTO stream_guard VALUES (120,1)')).rejects.toThrow();
    expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id=120'))[0].total)).toBe(0);
  });

  it('引擎退出等待实际导出取消和会话关闭，未提交事务回滚且文件资源全部释放', async () => {
    const shutdownEvents: TaskEvent[] = []; const closingEngine = new Engine(event => shutdownEvents.push(event));
    await closingEngine.handle('connections.open', { id: profile.id, profile });
    const ownSession = (await closingEngine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    const path = join(directory, 'shutdown.json'); await writeFile(path, '退出前原件'); const taskId = randomUUID();
    try {
      await closingEngine.handle('query.execute', { sessionId: ownSession, sql: 'START TRANSACTION; INSERT INTO stream_guard VALUES(121,1)', taskId: randomUUID(), maxRows: 10 });
      const probe = await closingEngine.handle('query.execute', { sessionId: ownSession, sql: 'SELECT CONNECTION_ID()', taskId: randomUUID(), maxRows: 10 }) as QueryOutcome;
      const threadId = Number(firstValues(probe)[0]);
      const running = closingEngine.handle('query.exportStream', { sessionId: ownSession, sql: 'SELECT SLEEP(30); INSERT INTO stream_guard VALUES(122,1)', taskId, fileToken: randomUUID(), filePath: path, format: 'json', encoding: 'utf8', protocol: 'text-strict', resultSelection: { kind: 'all' } });
      const rejected = expect(running).rejects.toThrow('取消');
      await expect.poll(() => serverIsRunning(threadId, 'SLEEP(30)'), { timeout: 10000 }).toBe(true);
      await closingEngine.closeAll(); await rejected;
      expect(shutdownEvents.filter(event => event.taskId === taskId).at(-1)?.status).toBe('cancelled');
      await expect.poll(async () => (await observed(`SELECT ID FROM information_schema.PROCESSLIST WHERE ID=${threadId}`)).length).toBe(0);
      expect(Number((await observed('SELECT COUNT(*) AS total FROM stream_guard WHERE id IN(121,122)'))[0].total)).toBe(0);
      expect(await readFile(path, 'utf8')).toBe('退出前原件'); expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
    } finally { await closingEngine.closeAll(); }
  });

  /** 大结果实际落盘并增量验每一行，不能用完成消息或文件大小替代内容完整性。 */
  async function verifyLargeExport(total: number) {
    const digits = '(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)';
    const table = `stream_many_${total}`;
    await execute(observer!, `CREATE TABLE ${identifier(table)} (id INT PRIMARY KEY, payload VARCHAR(120)) ENGINE=InnoDB`);
    await execute(observer!, `INSERT INTO ${identifier(table)} SELECT a.n+b.n*10+c.n*100+d.n*1000+e.n*10000+f.n*100000+1 AS id, CONCAT('中文',REPEAT('x',90)) FROM ${digits} a CROSS JOIN ${digits} b CROSS JOIN ${digits} c CROSS JOIN ${digits} d CROSS JOIN ${digits} e CROSS JOIN ${digits} f WHERE a.n+b.n*10+c.n*100+d.n*1000+e.n*10000+f.n*100000 < ${total}`);
    const beforeRss = process.memoryUsage().rss; let peakRss = beforeRss;
    const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 20);
    let exported: Awaited<ReturnType<typeof exportSql>>;
    try { exported = await exportSql(`SELECT id,payload FROM ${identifier(table)} ORDER BY id`, { format: 'csv', resultSelection: { kind: 'row-result', ordinal: 1 } }, join(directory, `complete-${total}.csv`)); }
    finally { clearInterval(sampler); }
    const result = exported.output; const preview = result.preview.results.find(item => item.columns.length)!;
    expect(preview.rows).toHaveLength(queryStreamExportLimits.previewRows); expect(preview.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result.preview))).toBeLessThan(queryStreamExportLimits.previewBytes + 65536);
    expect(result.results.find(item => item.kind === 'rows')?.rowsWritten).toBe(total);
    let count = 0, sum = 0;
    for await (const row of createReadStream(exported.path).pipe(parse({ columns: true }))) {
      count++; const id = Number(row.id);
      if (id !== count || row.payload !== '中文' + 'x'.repeat(90)) throw new Error(`完整文件第 ${count} 行内容不正确`);
      sum += id;
    }
    expect(count).toBe(total); expect(sum).toBe(total * (total + 1) / 2);
    const progress = await terminal(exported.taskId, 'completed');
    expect(progress.rowsWritten).toBe(total); expect(progress.bytesWritten).toBe((await stat(exported.path)).size);
    const peaks = progress as QueryExportProgress & { peakBufferedRows?: number; peakBufferedBytes?: number };
    expect(peaks.peakBufferedRows).toBeGreaterThan(0); expect(peaks.peakBufferedRows).toBeLessThanOrEqual(queryStreamExportLimits.queueRows);
    expect(peaks.peakBufferedBytes).toBeGreaterThan(0); expect(peaks.peakBufferedBytes).toBeLessThanOrEqual(queryStreamExportLimits.queueBytes);
    expect(events.filter(event => event.taskId === exported.taskId).every(event => !event.batch || event.batch.length <= queryStreamExportLimits.previewRows)).toBe(true);
    // RSS 含驱动和测试运行器开销，只作为异常增长哨兵；背压通过实际队列峰值独立验证。
    expect(peakRss - beforeRss).toBeLessThan(256 * 1024 ** 2);
    console.log(`完整文件证据：${JSON.stringify({ rows: count, sum, bytes: progress.bytesWritten, previewRows: preview.rows.length, peakBufferedRows: peaks.peakBufferedRows, peakBufferedBytes: peaks.peakBufferedBytes, rssIncreaseBytes: peakRss - beforeRss })}`);
  }
  it('100001 行完整文件超过显示上限，预览与实际待消费队列有界', () => verifyLargeExport(100001), 120000);
  it.skipIf(process.env.DBARK_TEST_MILLION !== '1')('百万行完整文件逐行核对首尾、总数和校验和，内存与预览仍有界', () => verifyLargeExport(1000000), 240000);
});
