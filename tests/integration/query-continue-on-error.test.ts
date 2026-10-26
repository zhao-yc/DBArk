import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import * as driver from '../../src/engine/connection';
import { execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier } from '../../src/engine/sql';
import type { Command, CommandMap, ConnectionProfile, QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import type { QueryParameter } from '../../src/shared/queryParameters';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_CONTINUE_ON_ERROR_INTEGRATION === '1';
const ports = [13357, 13380, 13384, 13310, 13311, 13484];
interface Fact { managed: ManagedConnection; id: number; closed: boolean; sql: string[]; commands: Array<{ sql: string; ended: boolean; error?: number }>; }
type Rows = Record<string, unknown>[];

/** 只消费统筹预核的隔离实例配置；默认运行不读取私有文件或尝试连接。 */
function profile(): ConnectionProfile {
  const host = process.env.DBARK_TEST_HOST ?? '', port = Number(process.env.DBARK_TEST_PORT), tls = process.env.DBARK_TEST_TLS === '1';
  if (!['192.168.31.200', 'deve-server.yinzon.com'].includes(host) || !ports.includes(port) || !process.env.DBARK_TEST_USER) throw Error('遇错继续实库专项仅限200既定隔离实例');
  if (port === 13484 && (!tls || !process.env.DBARK_TEST_CA)) throw Error('13484必须保持已有严格TLS校验');
  return { id: randomUUID(), name: '遇错继续实库专项', group: '测试', color: '#53c9ae', dialect: 'mysql', host, port,
    user: process.env.DBARK_TEST_USER, password: process.env.DBARK_TEST_PASSWORD ?? '',
    ...(tls ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
}

/** 原Engine、原观察连接和随机库绑定同一owner；有在途请求时不执行清库。 */
class Fixture {
  readonly profile = profile();
  readonly database = 'dbark_continue_' + Date.now() + '_' + randomUUID().replaceAll('-', '').slice(0, 8);
  readonly marker = randomUUID();
  readonly events: TaskEvent[] = [];
  readonly engine = new Engine(event => this.events.push(event));
  readonly facts: Fact[] = [];
  readonly requests = new Set<Promise<unknown>>();
  observer?: ManagedConnection;
  created = false;
  marked = false;
  private restore?: () => void;

  /** 独立观察真实服务器身份之后才创建本例库，不能依据产品回包自己证明目标。 */
  async start(): Promise<void> {
    this.observer = await driver.connect(this.profile);
    const row = (await this.observe('SELECT VERSION() AS version,@@hostname AS hostname,CONNECTION_ID() AS id'))[0];
    expect(row.hostname).toBe(process.env.DBARK_TEST_EXPECTED_HOSTNAME);
    if (!process.env.DBARK_TEST_EXPECTED_HOSTNAME) throw Error('缺少预核主机身份，未执行建库');
    expect(Number(row.id)).toBe(this.observer.connection.threadId);
    if (this.observer.status.dialect === 'mysql') {
      if (!process.env.DBARK_TEST_EXPECTED_UUID) throw Error('MySQL缺少预核实例UUID，未执行建库');
      expect((await this.observe('SELECT @@server_uuid AS uuid'))[0].uuid).toBe(process.env.DBARK_TEST_EXPECTED_UUID);
    }
    console.log(JSON.stringify({ 验收: '遇错继续原观察连接', 端口: this.profile.port, 版本: row.version, 主机: row.hostname, 线程: row.id, 隔离库: this.database }));
    await this.observe('CREATE DATABASE ' + identifier(this.database) + ' CHARACTER SET utf8mb4'); this.created = true;
    await this.observe('CREATE TABLE ' + this.table('owner') + ' (token VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB');
    await this.observe('INSERT INTO ' + this.table('owner') + ' VALUES (?)', [this.marker]); this.marked = true;
    await this.observe('CREATE TABLE ' + this.table('subject') + ' (id INT PRIMARY KEY,note VARCHAR(64)) ENGINE=InnoDB');
    const original = driver.connect;
    const spy = vi.spyOn(driver, 'connect').mockImplementation(async (...args) => {
      const managed = await original(...args), native = managed.connection;
      const stream = (native as unknown as { stream?: { closed?: boolean; once(name: string, callback: () => void): void } }).stream;
      if (!Number.isSafeInteger(native.threadId) || !stream) { await managed.close({ strict: true }); throw Error('缺少原物理连接归属'); }
      const fact: Fact = { managed, id: native.threadId!, closed: stream.closed === true, sql: [], commands: [] }; this.facts.push(fact);
      stream.once('close', () => { fact.closed = true; });
      // 只旁观原驱动，不替换结果、协议事件或执行时序。
      const query = native.query;
      native.query = function (this: typeof native, ...args: unknown[]) {
        if (this !== native || native.threadId !== fact.id) throw Error('原物理连接变化');
        const first = args[0], sql = typeof first === 'string' ? first : (first as { sql?: unknown })?.sql;
        if (typeof sql !== 'string') throw Error('未识别原SQL参数'); fact.sql.push(sql);
        const command = { sql, ended: false, error: undefined as number | undefined }; fact.commands.push(command);
        const result = Reflect.apply(query, native, args);
        result.once('end', () => { command.ended = true; }); result.once('error', (error: { errno?: number }) => { command.error = error.errno; }); return result;
      } as typeof native.query;
      return managed;
    });
    this.restore = () => spy.mockRestore();
    await this.invoke('connections.open', { id: this.profile.id, profile: this.profile } as never);
  }
  /** 隔离库及表名逐段引用，不接受外部SQL目标。 */
  table(name: string): string { return identifier(this.database) + '.' + identifier(name); }
  /** 每个RPC保存原Promise，结束前清理不能接管尚未完成的请求。 */
  invoke<C extends Command>(command: C, input: CommandMap[C]['input']): Promise<CommandMap[C]['output']> {
    const pending = this.engine.handle(command, input as Record<string, unknown>) as Promise<CommandMap[C]['output']>;
    this.requests.add(pending); void pending.then(() => this.requests.delete(pending), () => this.requests.delete(pending)); return pending;
  }
  /** 观察与清理均沿用同一个已核身份连接，不重连补做删除。 */
  async observe(sql: string, params: (string | number)[] = []): Promise<Rows> {
    if (!this.observer) throw Error('原观察连接缺失'); return (await execute<Rows>(this.observer, sql, params)).rows;
  }
  /** 普通SQL明确保留错误结果，预期只读拒写不被转换为准备成功。 */
  query(sessionId: string, sql: string, continueOnError?: boolean): Promise<QueryOutcome> { return this.invoke('query.execute', { sessionId, sql, taskId: randomUUID(), maxRows: 100, ...(continueOnError === undefined ? {} : { continueOnError }) }); }
  /** 先等待原请求与连接真实退出，再核对owner和精准删除本例库。 */
  async finish(): Promise<void> {
    let failed = false, failure: unknown;
    try {
      await Promise.allSettled([...this.requests]); await this.engine.closeAll();
      if (this.requests.size) throw Error('原请求尚未结束，保留本例库');
      if (this.facts.length) {
        const ids = this.facts.map(fact => fact.id);
        await vi.waitFor(async () => expect(await this.observe('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + ids.map(() => '?').join(',') + ')', ids)).toEqual([]), { timeout: 5000, interval: 50 });
        await vi.waitFor(() => expect(this.facts.every(fact => fact.closed)).toBe(true), { timeout: 5000, interval: 50 });
      }
      if (this.created) {
        if (!this.marked || !/^dbark_continue_\d+_[0-9a-f]{8}$/.test(this.database)) throw Error('原随机库owner未确认，保留现场');
        expect(await this.observe('SELECT token FROM ' + this.table('owner'))).toEqual([{ token: this.marker }]);
        await this.observe('SET SESSION lock_wait_timeout=5'); await this.observe('DROP DATABASE ' + identifier(this.database));
        expect(await this.observe('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [this.database])).toEqual([]);
      }
    } catch (error) { failed = true; failure = error; }
    // 即使线程或库核对失败，也只严格关闭原观察连接；保留未知库，不另连补做清理。
    try { if (this.observer) await this.observer.close({ strict: true }); }
    catch (closing) { if (failed) throw new AggregateError([failure, closing], '原收尾失败且原观察连接关闭未确认', { cause: failure }); throw closing; }
    finally { this.restore?.(); }
    if (failed) throw failure;
    console.log(JSON.stringify({ 验收: '遇错继续原连接收尾', 端口: this.profile.port, 隔离库: this.database, 产品线程: this.facts.map(fact => fact.id), 线程残留: 0, 库残留: 0,
      原SQL: this.facts.map(fact => ({ 线程: fact.id, 物理关闭: fact.closed, sql: fact.sql })) }));
  }
}

/** 结果只从真实产品回包取值，不能用观察连接的结果填入查询界面。 */
function cells(outcome: QueryOutcome): string[] { return outcome.results.flatMap(result => result.rows.flatMap(row => Object.values(row).map(String))); }

describe.skipIf(!enabled)('查询遇错继续：六实例真实Engine专项', () => {
  it('默认首错停止、显式普通及类型参数继续、真实模式/DELIMITER/部分CALL/事务/上限/取消', async () => {
    const owner = new Fixture(); let failed = false, failure: unknown;
    try {
      await owner.start();
      const session = (await owner.invoke('sessions.open', { connectionId: owner.profile.id, database: owner.database })).sessionId;
      const query = (sql: string, flag?: boolean) => owner.query(session, sql, flag);
      const sent = () => owner.facts.flatMap(fact => fact.sql);
      const allCommands = () => owner.facts.flatMap(fact => fact.commands);
      const initial = await query('SELECT CAST(CONNECTION_ID() AS CHAR),@@SESSION.sql_mode'); expect(initial.failure).toBeUndefined();
      const originalId = cells(initial)[0], initialMode = cells(initial)[1];
      const defaultSql = "INSERT INTO subject VALUES(1,'默认首条'); INSERT INTO subject VALUES(1,'默认冲突'); INSERT INTO subject VALUES(2,'不得继续')";
      const stopped = await query(defaultSql); expect(stopped.scriptReport).toBeUndefined(); expect(stopped.failure?.statementOrdinal).toBe(2);
      expect(await owner.observe('SELECT id,note FROM ' + owner.table('subject'))).toEqual([{ id: 1, note: '默认首条' }]);
      expect(sent()).not.toContain("INSERT INTO subject VALUES(2,'不得继续')");
      await owner.observe('DELETE FROM ' + owner.table('subject'));
      const source = "-- 普通脚本\r\nSELECT '普通前序' AS result; INSERT INTO subject VALUES(1,'第一行'); INSERT INTO subject VALUES(1,'冲突'); SELECT '普通中间' AS result; UPDATE subject SET note='更新后' WHERE id=1; SELEC broken; INSERT INTO subject VALUES(2,'继续后行'); SELECT id,note FROM subject ORDER BY id";
      const continued = await query(source, true), report = continued.scriptReport!;
      expect(report).toMatchObject({ mode: 'continue-on-error', statementsAttempted: 8, statementsCompleted: 6, reachedEnd: true });
      expect(report.errors.map(error => [error.statementOrdinal, error.kind])).toEqual([[3, 'server'], [6, 'server']]);
      expect(continued.failure).toBeDefined(); expect(cells(continued)).toContain('普通前序'); expect(cells(continued)).toContain('普通中间'); expect(cells(continued)).toContain('继续后行');
      for (const error of report.errors) { expect(error.sourceRange).toBeDefined(); const range = error.sourceRange!; expect(source.slice(range.start, range.end)).toMatch(error.statementOrdinal === 3 ? /INSERT INTO subject VALUES\(1,'冲突'\)/ : /SELEC broken/); }
      expect(await owner.observe('SELECT id,note FROM ' + owner.table('subject') + ' ORDER BY id')).toEqual([{ id: 1, note: '更新后' }, { id: 2, note: '继续后行' }]);
      expect(owner.events.filter(event => event.status === 'failed').at(-1)?.message).toBe(continued.failure?.message);

      const modeSql = "SET SESSION sql_mode='ANSI_QUOTES,NO_BACKSLASH_ESCAPES'; INSERT INTO subject VALUES(1,'模式后错误'); SELECT 'a\\b' AS exact_value; SET SESSION sql_mode=0x" + Buffer.from(initialMode).toString('hex');
      const mode = await query(modeSql, true); expect(mode.scriptReport).toMatchObject({ statementsAttempted: 4, statementsCompleted: 3, reachedEnd: true });
      expect(mode.scriptReport?.errors.map(error => error.statementOrdinal)).toEqual([2]); expect(cells(mode)).toContain('a\\b');

      const callSource = [
        'DELIMITER $$',
        "CREATE PROCEDURE continue_partial() BEGIN SELECT '失败CALL片段' AS bad; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='预期中途错误'; END$$",
        'DELIMITER ;', "SELECT 'CALL前序' AS result;", 'CALL continue_partial();', "SELECT 'CALL后序' AS result;", 'DROP PROCEDURE continue_partial;',
      ].join('\r\n');
      const eventStart = owner.events.length, calls = await query(callSource, true);
      expect(calls.scriptReport).toMatchObject({ statementsAttempted: 5, statementsCompleted: 4, reachedEnd: true }); expect(calls.scriptReport?.errors[0].statementOrdinal).toBe(3);
      expect(cells(calls)).toContain('CALL前序'); expect(cells(calls)).toContain('CALL后序'); expect(cells(calls)).not.toContain('失败CALL片段');
      expect(owner.events.slice(eventStart).some(event => event.batch?.some(row => Object.values(row).includes('失败CALL片段')))).toBe(false);
      const callFacts = allCommands().filter(command => command.sql === 'CALL continue_partial()'); expect(callFacts).toHaveLength(1); expect(callFacts[0]).toMatchObject({ ended: true, error: 1644 });

      await owner.observe('CREATE TABLE ' + owner.table('secrets') + ' (id INT PRIMARY KEY,value VARCHAR(128) UNIQUE) ENGINE=InnoDB');
      const hidden = '不应回显_' + randomUUID(); await owner.observe('INSERT INTO ' + owner.table('secrets') + ' VALUES(1,?)', [hidden]);
      const parameters: QueryParameter[] = [{ name: 'hidden', type: 'text', value: hidden }], parameterEvents = owner.events.length;
      const parameterized = await owner.invoke('query.executeParameterized', { sessionId: session, sql: 'INSERT INTO secrets VALUES(2,:hidden); SELECT :hidden AS accepted', parameters, taskId: randomUUID(), maxRows: 100, continueOnError: true });
      expect(parameterized.scriptReport).toMatchObject({ statementsAttempted: 2, statementsCompleted: 1, reachedEnd: true }); expect(parameterized.failure).toBeDefined(); expect(cells(parameterized)).toContain(hidden);
      expect(JSON.stringify(parameterized.scriptReport)).not.toContain(hidden); expect(parameterized.failure?.message).not.toContain(hidden);
      expect(owner.events.slice(parameterEvents).some(event => event.message.includes(hidden))).toBe(false);

      const tx = await query("START TRANSACTION; INSERT INTO subject VALUES(30,'未提交左'); INSERT INTO subject VALUES(30,'事务冲突'); INSERT INTO subject VALUES(31,'未提交右'); SELECT id FROM subject WHERE id>=30 ORDER BY id", true);
      expect(tx.scriptReport).toMatchObject({ statementsAttempted: 5, statementsCompleted: 4, reachedEnd: true }); expect(tx.transactionOpen).toBe(true); expect(cells(tx)).toEqual(expect.arrayContaining(['30', '31']));
      expect(await owner.observe('SELECT id FROM ' + owner.table('subject') + ' WHERE id>=30')).toEqual([]);
      expect((await query('ROLLBACK')).failure).toBeUndefined(); expect(await owner.observe('SELECT id FROM ' + owner.table('subject') + ' WHERE id>=30')).toEqual([]);

      const only = await owner.invoke('query.execute', { sessionId: session, sql: 'SELECT 1 AS single_row', taskId: randomUUID(), maxRows: 1, continueOnError: true });
      expect(only.scriptReport).toMatchObject({ statementsAttempted: 1, statementsCompleted: 1, reachedEnd: true, errors: [] }); expect(only.failure).toBeUndefined();
      const capped = await owner.invoke('query.execute', { sessionId: session, sql: "SELECT id FROM subject ORDER BY id; INSERT INTO subject VALUES(40,'显示上限后仍执行')", taskId: randomUUID(), maxRows: 1, continueOnError: true });
      expect(capped.scriptReport).toMatchObject({ statementsAttempted: 2, statementsCompleted: 2, reachedEnd: true, errors: [] }); expect(capped.failure).toBeUndefined();
      expect(capped.results.reduce((sum, result) => sum + result.rows.length, 0)).toBe(1); expect(capped.results.some(result => result.truncated)).toBe(true);
      expect(await owner.observe('SELECT id,note FROM ' + owner.table('subject') + ' WHERE id=40')).toEqual([{ id: 40, note: '显示上限后仍执行' }]);

      const malformed = await query("SELECT '解析前序' AS result; SELECT '未闭合; INSERT INTO subject VALUES(99,'不得执行')", true);
      expect(malformed.scriptReport?.reachedEnd).toBe(false); expect(malformed.scriptReport?.errors.at(-1)?.kind).toBe('stopped'); expect(cells(malformed)).toContain('解析前序');
      expect(await owner.observe('SELECT id FROM ' + owner.table('subject') + ' WHERE id=99')).toEqual([]);
      const beforeLimit = sent().length, duplicate = "INSERT INTO subject VALUES(1,'错误上限')";
      const limited = await query(Array(100).fill(duplicate).join(';') + "; INSERT INTO subject VALUES(99,'不得越过上限')", true);
      expect(limited.scriptReport).toMatchObject({ statementsAttempted: 100, statementsCompleted: 0, reachedEnd: false }); expect(limited.scriptReport?.errors).toHaveLength(100);
      expect(sent().slice(beforeLimit).filter(sql => sql === duplicate)).toHaveLength(100); expect(sent().slice(beforeLimit).some(sql => sql.includes('不得越过上限'))).toBe(false);
      expect(await owner.observe('SELECT id FROM ' + owner.table('subject') + ' WHERE id=99')).toEqual([]);

      const cancelId = randomUUID(), beforeCancel = sent().length;
      const pending = owner.invoke('query.execute', { sessionId: session, sql: "SELECT SLEEP(10) AS waiting; INSERT INTO subject VALUES(99,'取消后不得执行')", taskId: cancelId, maxRows: 100, continueOnError: true });
      const rejected = expect(pending).rejects.toThrow(/取消/);
      await vi.waitFor(async () => expect((await owner.observe('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=? AND INFO LIKE ?', [Number(originalId), 'SELECT SLEEP(10)%'])).length).toBe(1), { timeout: 5000, interval: 50 });
      await owner.invoke('query.cancel', { taskId: cancelId }); await rejected;
      expect(sent().slice(beforeCancel).some(sql => sql.includes('取消后不得执行'))).toBe(false); expect(await owner.observe('SELECT id FROM ' + owner.table('subject') + ' WHERE id=99')).toEqual([]);
      expect(cells(await query('SELECT CAST(CONNECTION_ID() AS CHAR)'))).toEqual([originalId]);
      console.log(JSON.stringify({ 验收: '遇错继续功能事实', 端口: owner.profile.port, 原线程: originalId, 普通失败序号: report.errors.map(error => error.statementOrdinal), 失败CALL片段: 0, 错误上限: limited.scriptReport?.errors.length, 真实取消: true, 参数错误回显: false }));
    } catch (error) { failed = true; failure = error; }
    try { await owner.finish(); } catch (cleanup) { if (failed) throw new AggregateError([failure, cleanup], '遇错继续原功能失败且收尾未确认', { cause: failure }); throw cleanup; }
    if (failed) throw failure;
  }, 120000);
});
