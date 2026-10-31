import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import * as driver from '../../src/engine/connection';
import { execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier } from '../../src/engine/sql';
import type { Command, CommandMap, NetworkConnectionProfile as ConnectionProfile, QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import type { QueryParameter } from '../../src/shared/queryParameters';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_QUERY_WARNINGS_INTEGRATION === '1';
const ports = [13357, 13380, 13384, 13310, 13311, 13484];
interface Fact { managed: ManagedConnection; id: number; closed: boolean; sql: string[]; commands: Array<{ sql: string; ended: boolean; error?: number }>; }
type Rows = Record<string, unknown>[];

/** 只消费统筹预核的隔离实例配置；默认运行不读取私有文件或尝试连接。 */
function profile(): ConnectionProfile {
  const host = process.env.DBARK_TEST_HOST ?? '', port = Number(process.env.DBARK_TEST_PORT), tls = process.env.DBARK_TEST_TLS === '1';
  if (!['192.168.31.200', 'deve-server.yinzon.com'].includes(host) || !ports.includes(port) || !process.env.DBARK_TEST_USER) throw Error('显式查询警告实库专项仅限200既定隔离实例');
  if (port === 13484 && (!tls || !process.env.DBARK_TEST_CA)) throw Error('13484必须保持已有严格TLS校验');
  return { id: randomUUID(), name: '显式查询警告实库专项', group: '测试', color: '#53c9ae', dialect: 'mysql', host, port,
    user: process.env.DBARK_TEST_USER, password: process.env.DBARK_TEST_PASSWORD ?? '',
    ...(tls ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
}

/** 原Engine、原观察连接和随机库绑定同一owner；有在途请求时不执行清库。 */
class Fixture {
  readonly profile = profile();
  readonly database = 'dbark_warnings_' + Date.now() + '_' + randomUUID().replaceAll('-', '').slice(0, 8);
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
    console.log(JSON.stringify({ 验收: '显式查询警告原观察连接', 端口: this.profile.port, 版本: row.version, 主机: row.hostname, 线程: row.id, 隔离库: this.database }));
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
        if (!this.marked || !/^dbark_warnings_\d+_[0-9a-f]{8}$/.test(this.database)) throw Error('原随机库owner未确认，保留现场');
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
    console.log(JSON.stringify({ 验收: '显式查询警告原连接收尾', 端口: this.profile.port, 隔离库: this.database, 产品线程: this.facts.map(fact => fact.id), 线程残留: 0, 库残留: 0,
      原SQL: this.facts.map(fact => ({ 线程: fact.id, 物理关闭: fact.closed, commandCount: fact.sql.length })) }));
  }
}

/** 结果只从真实产品回包取值，不能用观察连接的结果填入查询界面。 */
function cells(outcome: QueryOutcome): string[] { return outcome.results.flatMap(result => result.rows.flatMap(row => Object.values(row).map(String))); }

describe.skipIf(!enabled)('显式查询警告：六实例真实Engine专项', () => {
  it('默认语义、逐语句快照、错误与CALL、参数隐私、截断及事务取消', async () => {
    const owner = new Fixture(); let failed = false, failure: unknown;
    try {
      await owner.start();
      const session = (await owner.invoke('sessions.open', { connectionId: owner.profile.id, database: owner.database })).sessionId;
      const run = (sql: string, collectWarnings?: boolean, continueOnError?: boolean) => owner.invoke('query.execute', { sessionId: session, sql, taskId: randomUUID(), maxRows: 100, ...(collectWarnings === undefined ? {} : { collectWarnings }), ...(continueOnError === undefined ? {} : { continueOnError }) });
      const commands = () => owner.facts.flatMap(fact => fact.commands);
      const originalId = cells(await run('SELECT CAST(CONNECTION_ID() AS CHAR)'))[0];
      await run("SET SESSION sql_mode=''");
      for (const flag of [undefined, false]) {
        const start = commands().length;
        const plain = await run('SET @dbark_warning_probe=7; SELECT ROW_COUNT() AS original_affected; SELECT SQL_CALC_FOUND_ROWS n FROM (SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3) AS q LIMIT 1; SELECT FOUND_ROWS() AS original_found', flag);
        expect(plain.failure).toBeUndefined(); expect(plain.warnings).toBeUndefined();
        expect(cells(plain)).toEqual(['0','1','3']);
        expect(commands().slice(start).some(command => /^SHOW (?:COUNT\(\*\) )?WARNINGS/i.test(command.sql))).toBe(false);
      }
      const select = await run("SELECT CAST('dbark-warning' AS UNSIGNED) AS warning_value");
      expect(select.results[0].warningCount).toBe(1); expect(select.warnings).toBeUndefined();
      const explicit = await run("SET @dbark_warning_probe=7; SELECT ROW_COUNT() AS diagnostic_affected; SELECT CAST('dbark-warning' AS UNSIGNED) AS warning_value; SELECT id FROM subject WHERE id=-1", true);
      expect(explicit.failure).toBeUndefined(); expect(cells(explicit)).toEqual(['-1','0']);
      expect(explicit.warnings).toMatchObject({ collection: 'explicit', omittedStatements: 0, truncated: false });
      expect(explicit.warnings!.statements.map(entry => [entry.statementOrdinal,entry.status])).toEqual([[1,'completed'],[2,'completed'],[3,'completed'],[4,'completed']]);
      const conversion = explicit.warnings!.statements[2];
      expect(conversion).toMatchObject({ warningCount: 1, truncated: false });
      expect(conversion.conditions).toEqual([{level:'Warning',code:1292,message:expect.stringContaining('dbark-warning')}]);
      expect(explicit.warnings!.statements[3]).toMatchObject({warningCount:0,conditions:[]});
      const comparison = await owner.observe("SELECT CAST('dbark-warning' AS UNSIGNED)"); expect(comparison).toHaveLength(1);
      const reference = await owner.observe('SHOW WARNINGS');
      expect(conversion.conditions[0]).toEqual({level:reference[0].Level,code:Number(reference[0].Code),message:reference[0].Message});

      await owner.observe("INSERT INTO "+owner.table('subject')+" VALUES(1,'既有行')");
      const startStop = commands().length;
      const stopped = await run("INSERT INTO subject VALUES(1,'预期重复'); INSERT INTO subject VALUES(2,'不应继续')",true);
      expect(stopped.failure?.statementOrdinal).toBe(1);
      expect(stopped.warnings!.statements).toHaveLength(1);
      expect(stopped.warnings!.statements[0]).toMatchObject({statementOrdinal:1,status:'failed',warningCount:1,conditions:[{level:'Error',code:1062,message:expect.any(String)}]});
      expect(commands().slice(startStop).some(command=>command.sql.includes('不应继续'))).toBe(false);
      const continued = await run("INSERT INTO subject VALUES(1,'继续模式重复'); SELECT CAST('continued-warning' AS UNSIGNED); INSERT INTO subject VALUES(2,'继续后行')",true,true);
      expect(continued.scriptReport).toMatchObject({statementsAttempted:3,statementsCompleted:2,reachedEnd:true});
      expect(continued.warnings!.statements.map(entry=>entry.status)).toEqual(['failed','completed','completed']);
      expect(continued.warnings!.statements[0].conditions[0].code).toBe(1062);
      expect(continued.warnings!.statements[1].conditions[0].code).toBe(1292);
      expect(await owner.observe('SELECT id FROM '+owner.table('subject')+' WHERE id=2')).toEqual([{id:2}]);

      await owner.observe('CREATE PROCEDURE '+owner.table('warning_partial')+"() BEGIN SELECT '不得发布的部分CALL'; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='warning-call-failure'; END");
      const callStart = owner.events.length, call = await run("CALL warning_partial(); SELECT 'CALL后序'",true,true);
      expect(call.warnings!.statements.map(entry=>entry.status)).toEqual(['failed','completed']);
      expect(call.warnings!.statements[0].conditions.some(condition=>condition.code===1644)).toBe(true);
      expect(cells(call)).not.toContain('不得发布的部分CALL'); expect(cells(call)).toContain('CALL后序');
      expect(owner.events.slice(callStart).some(event=>event.batch?.some(row=>Object.values(row).includes('不得发布的部分CALL')))).toBe(false);
      expect(commands().filter(command=>command.sql==='CALL warning_partial()')).toEqual([expect.objectContaining({ended:true,error:1644})]);

      const hidden = 'dbark_warning_parameter_'+randomUUID(), eventStart=owner.events.length;
      const parameter = await owner.invoke('query.executeParameterized',{sessionId:session,sql:'SELECT CAST(:hidden AS UNSIGNED)',parameters:[{name:'hidden',type:'text',value:hidden}],taskId:randomUUID(),maxRows:100,collectWarnings:true});
      expect(parameter.failure).toBeUndefined(); expect(parameter.warnings!.statements[0].warningCount).toBe(1);
      expect(parameter.warnings!.statements[0].conditions).toEqual([{level:'Warning',code:1292,messageHidden:true}]);
      expect(JSON.stringify(parameter.warnings)).not.toContain(hidden);
      expect(owner.events.slice(eventStart).some(event=>event.message.includes(hidden))).toBe(false);

      await run('SET SESSION max_error_count=1');
      const limited = await run("SELECT CAST(v AS UNSIGNED) FROM (SELECT 'warning-a' AS v UNION ALL SELECT 'warning-b' UNION ALL SELECT 'warning-c') AS q",true);
      expect(limited.warnings!.statements[0]).toMatchObject({warningCount:3,truncated:true}); expect(limited.warnings!.statements[0].conditions).toHaveLength(1);
      await run('SET SESSION max_error_count=64');
      const budgetStart = commands().length;
      const budget = await run(Array.from({length:205},()=>"SELECT CAST('budget-warning' AS UNSIGNED)").join(';')+"; INSERT INTO subject VALUES(3,'采集上限后的写入')",true);
      expect(budget.failure).toBeUndefined(); expect(budget.warnings!.statements).toHaveLength(200);
      expect(budget.warnings!.omittedStatements).toBe(6); expect(budget.warnings!.truncated).toBe(true);
      expect(await owner.observe('SELECT id,note FROM '+owner.table('subject')+' WHERE id=3')).toEqual([{id:3,note:'采集上限后的写入'}]);
      expect(commands().slice(budgetStart).filter(command=>/^SHOW COUNT\(\*\) WARNINGS$/i.test(command.sql))).toHaveLength(200);

      const tx = await run("START TRANSACTION; INSERT IGNORE INTO subject VALUES(30,'未提交'),(1,'被忽略的重复'); SELECT id FROM subject WHERE id=30",true);
      expect(tx.failure).toBeUndefined(); expect(tx.transactionOpen).toBe(true); expect(cells(tx)).toContain('30');
      expect(tx.warnings!.statements[1].conditions[0].code).toBe(1062);
      expect(await owner.observe('SELECT id FROM '+owner.table('subject')+' WHERE id=30')).toEqual([]);
      await run('ROLLBACK',true); expect(await owner.observe('SELECT id FROM '+owner.table('subject')+' WHERE id=30')).toEqual([]);

      const cancelId=randomUUID(), cancelStart=commands().length;
      const pending=owner.invoke('query.execute',{sessionId:session,sql:"SELECT SLEEP(10); INSERT INTO subject VALUES(99,'取消后尾句')",taskId:cancelId,maxRows:100,collectWarnings:true});
      const rejection=expect(pending).rejects.toThrow(/取消/);
      await vi.waitFor(async()=>expect((await owner.observe('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=? AND INFO LIKE ?',[Number(originalId),'SELECT SLEEP(10)%'])).length).toBe(1),{timeout:5000,interval:50});
      await owner.invoke('query.cancel',{taskId:cancelId}); await rejection;
      expect(commands().slice(cancelStart).some(command=>/^SHOW (?:COUNT\(\*\) )?WARNINGS/i.test(command.sql))).toBe(false);
      expect(await owner.observe('SELECT id FROM '+owner.table('subject')+' WHERE id=99')).toEqual([]);
      expect(cells(await run('SELECT CAST(CONNECTION_ID() AS CHAR)'))).toEqual([originalId]);
      console.log(JSON.stringify({验收:'显式警告功能事实',端口:owner.profile.port,原线程:originalId,默认附加SHOW:0,警告上限后尾句提交:true,参数消息回显:false,真实取消:true}));
    } catch (error) { failed=true;failure=error; }
    try { await owner.finish(); } catch(cleanup) { if(failed) throw new AggregateError([failure,cleanup],'原警告验收失败且收尾未确认',{cause:failure}); throw cleanup; }
    if(failed) throw failure;
  },120000);
});
