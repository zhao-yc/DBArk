import { assertNetworkProfile } from '../helpers/assertNetworkProfile';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import * as connectionDriver from '../../src/engine/connection';
import { execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier } from '../../src/engine/sql';
import type { NetworkConnectionProfile as ConnectionProfile, EngineCommand, QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import type { CompletionSessionState } from '../../src/shared/sqlCompletion';
import { queryAnalyzeCapability } from '../../src/shared/queryAnalyze';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1';
const ports = [13357, 13380, 13384, 13310, 13311, 13484] as const;
const versions: Record<number, RegExp> = { 13357: /^5\.7\./, 13380: /^8\.0\./, 13384: /^8\.4\./, 13310: /^(?:5\.5\.5-)?10\.11\./, 13311: /^(?:5\.5\.5-)?11\.4\./, 13484: /^8\.4\./ };
const bigId = '18446744073709551615', lowerId = '9007199254740993', amount = '12345678901234567890.12345678901234567890';
type Rows = Record<string, unknown>[];
interface CommandFact { method: 'query' | 'execute'; sql: string; ended: boolean; errored: boolean; callbackReturned: boolean; callbackError?: string; }
interface ConnectionFact { managed: ManagedConnection; id: number; native: ManagedConnection['connection']; stream: { closed?: boolean; once(name: string, callback: () => void): unknown }; role: 'product' | 'observer'; sawClose: boolean; sawEnd: boolean; commands: CommandFact[]; }
let currentOwner: AnalyzeFixture | undefined;

/** 只接受Root已核服务器的六个隔离端口；配置错误立即失败，不回退本机或更换TLS校验。 */
function fixtureProfile(): ConnectionProfile {
  const host = process.env.DBARK_TEST_HOST ?? '', port = Number(process.env.DBARK_TEST_PORT), tls = process.env.DBARK_TEST_TLS === '1';
  if (!['deve-server.yinzon.com', '192.168.31.200'].includes(host.toLowerCase()) || !ports.includes(port as typeof ports[number]) || !process.env.DBARK_TEST_USER) throw Error('实际执行分析实库专项仅允许200服务器既定六个隔离端口及明确账号');
  if (port === 13484 && (!tls || !process.env.DBARK_TEST_CA)) throw Error('13484必须沿用严格TLS及既有CA，不能降低证书校验');
  return { id: 'analyze-' + randomUUID(), name: '实际执行分析隔离验收', group: '测试', color: '#53c9ae', dialect: 'mysql', host, port,
    user: process.env.DBARK_TEST_USER, password: process.env.DBARK_TEST_PASSWORD ?? '',
    ...(tls ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
}

/** 单个复合例持有独立Engine、观察连接和随机库，未确认释放时阻止后续例占用新资源。 */
class AnalyzeFixture {
  readonly profile = fixtureProfile();
  readonly database = 'dbark_analyze_' + Date.now() + '_' + randomUUID().replaceAll('-', '').slice(0, 8);
  readonly marker = randomUUID();
  readonly events: TaskEvent[] = [];
  readonly engine = new Engine(event => this.events.push(event));
  readonly facts: ConnectionFact[] = [];
  readonly requests = new Set<Promise<unknown>>();
  readonly reads = new Set<Promise<unknown>>();
  observer?: ManagedConnection;
  sessionId = '';
  phase: 'active' | 'closing' | 'closed' | 'retained' = 'active';
  databaseAttempted = false;
  databaseCreated = false;
  markerCreated = false;
  private restore?: () => void;
  private observerRequested = false;

  /** 所有跨await回调都验证同一个owner；不接管另一例的连接、线程或随机库。 */
  check(active = true): void {
    if (currentOwner !== this || this.phase === 'closed' || this.phase === 'retained' || active && this.phase !== 'active') throw Error('实际执行分析原测试owner已失效，停止后续操作');
  }
  /** 记录真实驱动对象及真实命令事件；透传回调和结果，绝不伪造end或清零未结束命令。 */
  private record(managed: ManagedConnection, role: ConnectionFact['role']): void {
    this.check(false);
    const native = managed.connection, id = native.threadId, stream = (native as unknown as { stream?: ConnectionFact['stream'] }).stream;
    if (!Number.isSafeInteger(id) || !id || id < 1 || !stream || this.facts.some(item => item.id === id)) throw Error('真实连接缺少唯一物理线程或传输归属');
    const fact: ConnectionFact = { managed, id, native, stream, role, sawClose: stream.closed === true, sawEnd: false, commands: [] };
    this.facts.push(fact); stream.once('close', () => { fact.sawClose = true; }); native.once('end', () => { fact.sawEnd = true; });
    for (const method of ['query', 'execute'] as const) {
      const original = native[method] as unknown as (...args: unknown[]) => { once(name: string, callback: (...args: unknown[]) => void): unknown };
      const owner = this;
      const wrapped = function (this: unknown, ...args: unknown[]) {
        owner.check(false);
        if (this !== native || managed.connection !== native || native.threadId !== id) throw Error('原驱动物理身份变化');
        const first = args[0], sql = typeof first === 'string' ? first : first && typeof first === 'object' ? Object.getOwnPropertyDescriptor(first, 'sql')?.value : undefined;
        if (typeof sql !== 'string') throw Error('实库审计未识别原SQL参数，停止发送');
        const command: CommandFact = { method, sql, ended: false, errored: false, callbackReturned: false };
        fact.commands.push(command);
        const callback = args.at(-1);
        if (typeof callback === 'function') args[args.length - 1] = function (this: unknown, ...values: unknown[]) {
          command.callbackReturned = true;
          if (values[0]) command.callbackError = String((values[0] as { code?: unknown }).code ?? '原回调错误');
          return Reflect.apply(callback, this, values);
        };
        const result = Reflect.apply(original, native, args);
        result.once('end', () => { command.ended = true; }); result.once('error', () => { command.errored = true; });
        return result;
      };
      Object.defineProperty(native, method, { configurable: true, writable: true, value: wrapped });
    }
  }
  /** 启动前先核真实版本，再创建不带IF NOT EXISTS的唯一库及owner标记。 */
  async start(): Promise<void> {
    this.check();
    const connect = connectionDriver.connect;
    const spy = vi.spyOn(connectionDriver, 'connect').mockImplementation(async (...args: Parameters<typeof connect>) => {
      this.check(false);
      const target = assertNetworkProfile(args[0]);
      if (target.id !== this.profile.id || target.host !== this.profile.host || target.port !== this.profile.port || target.user !== this.profile.user) throw Error('审计拒绝其他连接进入本例');
      const managed = await connect(...args);
      try { this.record(managed, this.observerRequested ? 'observer' : 'product'); }
      catch (error) { try { await managed.close({ strict: true }); } catch (closing) { throw new AggregateError([error, closing], '真实线程登记失败且关闭未确认', { cause: error }); } throw error; }
      return managed;
    });
    this.restore = () => spy.mockRestore();
    this.observerRequested = true;
    try { this.observer = await connectionDriver.connect(this.profile); } finally { this.observerRequested = false; }
    this.check();
    expect(this.observer.status.version).toMatch(versions[this.profile.port]);
    expect(this.observer.status.dialect).toBe([13310, 13311].includes(this.profile.port) ? 'mariadb' : 'mysql');
    const identity = await this.observe('SELECT VERSION() AS version,@@hostname AS hostname,@@port AS port,CONNECTION_ID() AS id');
    expect(Number(identity[0].id)).toBe(this.observer.connection.threadId);
    const expectedHostname = process.env.DBARK_TEST_EXPECTED_HOSTNAME;
    if (!expectedHostname) throw Error('缺少Root预先核对的DBARK_TEST_EXPECTED_HOSTNAME，未执行建库');
    expect(identity[0].hostname).toBe(expectedHostname);
    if (this.observer.status.dialect === 'mysql') {
      const expectedUuid = process.env.DBARK_TEST_EXPECTED_UUID;
      if (!expectedUuid) throw Error('缺少Root预先核对的MySQL DBARK_TEST_EXPECTED_UUID，未执行建库');
      expect((await this.observe('SELECT @@server_uuid AS uuid'))[0].uuid).toBe(expectedUuid);
    }
    console.log(JSON.stringify({ 验收说明: '实际执行分析原观察连接身份', 目标端口: this.profile.port, 版本: identity[0].version, 容器主机: identity[0].hostname, 内部端口: identity[0].port, 观察线程: identity[0].id, 隔离库: this.database }));
    this.databaseAttempted = true;
    await this.observe('CREATE DATABASE ' + identifier(this.database) + ' CHARACTER SET utf8mb4'); this.databaseCreated = true;
    await this.observe('CREATE TABLE ' + this.table('analyze_owner') + ' (token VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB');
    await this.observe('INSERT INTO ' + this.table('analyze_owner') + ' VALUES (?)', [this.marker]); this.markerCreated = true;
    await this.observe('CREATE TABLE ' + this.table('analyze_parent') + ' (id BIGINT UNSIGNED PRIMARY KEY,amount DECIMAL(40,20) NOT NULL) ENGINE=InnoDB');
    await this.observe('CREATE TABLE ' + this.table('analyze_child') + ' (id INT PRIMARY KEY,parent_id BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB');
    await this.observe('CREATE TABLE ' + this.table('analyze_guard') + ' (id INT PRIMARY KEY,hits INT NOT NULL) ENGINE=InnoDB');
    await this.observe('INSERT INTO ' + this.table('analyze_parent') + ' VALUES (?,?),(?,?)', [lowerId, amount, bigId, amount]);
    await this.observe('INSERT INTO ' + this.table('analyze_child') + ' VALUES (1,?),(2,?)', [lowerId, bigId]);
    await this.invoke('connections.open', { id: this.profile.id, profile: this.profile });
    this.sessionId = (await this.invoke('sessions.open', { connectionId: this.profile.id, database: this.database })).sessionId;
  }
  /** 标识符始终逐段引用，本例不执行任意外部数据库名。 */
  table(name: string): string { return identifier(this.database) + '.' + identifier(name); }
  /** 所有产品RPC登记原Promise，finally不会在原任务仍执行时删除隔离库。 */
  invoke(command: EngineCommand, input: Record<string, unknown>): Promise<any> {
    this.check();
    const pending = this.engine.handle(command, input); this.requests.add(pending);
    void pending.then(() => this.requests.delete(pending), () => this.requests.delete(pending));
    return pending;
  }
  /** 原观察连接独立读取已提交状态；秘密仅由标准环境注入，不进入输出。 */
  observe(sql: string, params: (string | number)[] = []): Promise<Rows> {
    this.check(); return this.control(sql, params);
  }
  /** 清理期间只沿用原观察连接，不能因断线新建高权限连接接续DROP。 */
  private control(sql: string, params: (string | number)[] = []): Promise<Rows> {
    this.check(false); if (!this.observer) return Promise.reject(Error('原观察连接缺失'));
    const pending = execute<Rows>(this.observer, sql, params).then(result => result.rows); this.reads.add(pending);
    void pending.then(() => this.reads.delete(pending), () => this.reads.delete(pending));
    return pending;
  }
  /** 准备/核对沿用普通查询；真实脚本错误不能当作成功准备。 */
  async query(sql: string): Promise<QueryOutcome> {
    const result = await this.invoke('query.execute', { sessionId: this.sessionId, sql, taskId: randomUUID(), maxRows: 1000 }) as QueryOutcome;
    expect(result.failure).toBeUndefined(); return result;
  }
  /** 实际分析单次发送固定SQL，明确确认真实默认库，不使用客户端解析伪造指标。 */
  analyze(sql: string, overrides: Record<string, unknown> = {}): { taskId: string; pending: Promise<QueryOutcome> } {
    const taskId = randomUUID();
    return { taskId, pending: this.invoke('query.analyze', { sessionId: this.sessionId, sql, taskId, maxRows: 1000, acknowledged: true, expectedDatabase: this.database, ...overrides }) as Promise<QueryOutcome> };
  }
  /** 只统计真实产品连接发送的SQL，不把观察核对或初始化查询当作ANALYZE。 */
  sent(): { connection: ConnectionFact; command: CommandFact }[] { return this.facts.filter(fact => fact.role === 'product').flatMap(connection => connection.commands.map(command => ({ connection, command }))); }
  /** 原RPC与取消处理落定并关闭Engine后逐线程核零，任何未知都保留库，不强清。 */
  async finish(): Promise<void> {
    this.check(false); this.phase = 'closing';
    try {
      await this.engine.closeAll();
      await Promise.allSettled([...this.requests, ...this.reads]);
      if (this.requests.size || this.reads.size) throw Error('原RPC或观察读取尚未结束，保留本例资源');
      const observerFact = this.facts.find(fact => fact.managed === this.observer);
      if (this.facts.length && !observerFact) throw Error('原观察连接归属未确认，保留本例资源');
      if (!this.observer) {
        if (this.databaseAttempted) throw Error('未取得原观察连接却记录了建库尝试，保留本例资源');
        console.log(JSON.stringify({ 验收说明: '未取得真实观察连接，未执行建库；不声明逐线程实库验收通过', 目标端口: this.profile.port }));
        this.phase = 'closed'; return;
      }
      const product = this.facts.filter(fact => fact.role === 'product');
      for (const fact of this.facts) if (fact.managed.connection !== fact.native || fact.native.threadId !== fact.id) throw Error('原线程物理归属变化，保留本例资源');
      if (product.length) {
        const ids = product.map(fact => fact.id);
        await vi.waitFor(async () => expect(await this.control('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + ids.map(() => '?').join(',') + ')', ids)).toEqual([]), { timeout: 5000, interval: 50 });
        await vi.waitFor(() => expect(product.every(fact => fact.sawClose || fact.stream.closed === true)).toBe(true), { timeout: 5000, interval: 50 });
      }
      if (this.databaseAttempted) {
        if (!this.databaseCreated || !this.markerCreated || !/^dbark_analyze_\d+_[0-9a-f]{8}$/.test(this.database)) throw Error('本例建库或owner标记结果未确认，拒绝强清：' + this.database);
        expect(await this.control('SELECT token FROM ' + this.table('analyze_owner'))).toEqual([{ token: this.marker }]);
        await this.control('SET SESSION lock_wait_timeout=5');
        await this.control('DROP DATABASE ' + identifier(this.database));
        expect(await this.control('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [this.database])).toEqual([]);
      }
      if (this.observer) { await this.observer.close({ strict: true }); expect(observerFact?.sawClose || observerFact?.stream.closed === true).toBe(true); }
      console.log(JSON.stringify({ 验收说明: '实际执行分析原Engine及观察连接收尾', 目标端口: this.profile.port, 隔离库: this.database, 产品线程: product.map(fact => fact.id), 线程残留: 0, 库残留: 0,
        原驱动命令: product.map(fact => ({ 线程: fact.id, 原连接end: fact.sawEnd, 物理close: fact.sawClose || fact.stream.closed === true, 命令: fact.commands.map(command => ({ SQL: command.sql, 方法: command.method, end: command.ended, error: command.errored, 回调: command.callbackReturned, 回调错误: command.callbackError })) })) }));
      this.phase = 'closed';
    } catch (error) {
      this.phase = 'retained';
      console.error(JSON.stringify({ 验收说明: '实际执行分析收尾未确认，未继续强清或启动后继例', 目标端口: this.profile.port, 隔离库: this.database, 已确认建库: this.databaseCreated, 产品线程: this.facts.filter(fact => fact.role === 'product').map(fact => fact.id) }));
      throw error;
    } finally { this.restore?.(); }
  }
}

/** 保留原始功能错误；若收尾也失败则同时报告，绝不用清理结果覆盖原失败。 */
async function withFixture(run: (owner: AnalyzeFixture) => Promise<void>): Promise<void> {
  if (currentOwner) throw Error('上一实际执行分析例的资源尚未确认，禁止接管或重复运行');
  const owner = new AnalyzeFixture(); currentOwner = owner;
  let original: unknown, failed = false;
  try { await owner.start(); await run(owner); } catch (error) { original = error; failed = true; }
  try { await owner.finish(); }
  catch (closing) { if (failed) throw new AggregateError([original, closing], '原功能失败且资源收尾未确认', { cause: original }); throw closing; }
  finally { if (owner.phase === 'closed') currentOwner = undefined; }
  if (failed) throw original;
}

/** 查询结果按真实位置键读取，精度仍是原驱动字符串。 */
function values(result: QueryOutcome): unknown[] { return Object.values(result.results.find(item => item.rows.length)!.rows[0]); }
/** 显式读取原会话真实默认库；先核错误后的未知状态，不用USE、缓存改写或重连代替产品恢复。 */
async function readAnalyzeContext(owner: AnalyzeFixture, unknown = false): Promise<CompletionSessionState> {
  // 上一条原准备/分析命令的真实驱动归属就是固定会话；不靠其他连接的close事件时序猜测。
  const original = owner.sent().at(-1)?.connection;
  expect(original).toBeDefined(); expect(original!.sawClose || original!.stream.closed === true).toBe(false);
  const beforeState = await owner.invoke('query.completionState', { sessionId: owner.sessionId }) as CompletionSessionState;
  expect(beforeState).toMatchObject({ busy: false, broken: false, databaseKnown: !unknown });
  if (unknown) expect(Object.hasOwn(beforeState, 'database')).toBe(false); else expect(beforeState.database).toBe(owner.database);
  const before = owner.sent().length, connectionCount = owner.facts.length, taskId = randomUUID();
  const result = await owner.invoke('query.analyzeContext', { sessionId: owner.sessionId, taskId }) as CompletionSessionState;
  expect(result).toMatchObject({ busy: false, broken: false, databaseKnown: true, database: owner.database, dialect: owner.observer!.status.dialect, serverVersion: owner.observer!.status.version });
  expect(owner.facts).toHaveLength(connectionCount);
  expect(owner.sent().slice(before).map(item => [item.connection.id, item.command.sql])).toEqual([[original!.id, 'SELECT DATABASE() AS __dbark_analyze_database']]);
  expect(owner.events.filter(event => event.taskId === taskId && event.executionSql)).toEqual([]);
  expect(owner.events.filter(event => event.taskId === taskId).at(-1)?.status).toBe('completed');
  expect(await owner.invoke('query.completionState', { sessionId: owner.sessionId })).toMatchObject({ databaseKnown: true, database: owner.database, busy: false, broken: false });
  return result;
}
/** 相同输入只可有一条实际前缀；普通EXPLAIN和隐式重放不能混入这次分析。 */
async function analyzeOnce(owner: AnalyzeFixture, sql: string): Promise<QueryOutcome> {
  const before = owner.sent().length, capability = queryAnalyzeCapability(owner.observer!.status), request = owner.analyze(sql), result = await request.pending;
  expect(owner.sent().slice(before).filter(item => /^\s*(?:EXPLAIN\s+ANALYZE|ANALYZE\s+FORMAT)/i.test(item.command.sql)).map(item => item.command.sql)).toEqual([capability.sqlPrefix + ' ' + sql]);
  expect(result.analysis).toBeDefined(); expect(result.explain).toBeUndefined(); expect(result.analysis!.rawTruncated).toBe(false);
  expect(result.results).toHaveLength(1); expect(result.results[0].statement).toBe(capability.sqlPrefix + ' ' + sql);
  const first = result.results[0]; expect(result.analysis!.raw).toBe(first.rows[0][first.columns[0].key]);
  expect(owner.events.filter(event => event.taskId === request.taskId && event.executionSql).map(event => event.executionSql)).toEqual([capability.sqlPrefix + ' ' + sql]);
  expect(owner.events.filter(event => event.taskId === request.taskId).at(-1)?.status).toBe('completed');
  return result;
}

describe.skipIf(!enabled)('200隔离实例实际执行分析：源码Engine，不等同安装包或其他平台验收', () => {
  it('实际JOIN和CTE指标保留原文与大数，普通执行计划仍仅估算；5.7在发送前拒绝', async () => withFixture(async owner => {
    const sql = 'SELECT p.id,p.amount FROM analyze_parent AS p JOIN analyze_child AS c ON c.parent_id=p.id WHERE p.id>=' + lowerId + ' ORDER BY p.id';
    const capability = queryAnalyzeCapability(owner.observer!.status);
    expect(capability.supported).toBe(owner.profile.port !== 13357);
    if (capability.supported) {
      for (const source of [sql, 'WITH matched AS (SELECT parent_id FROM analyze_child WHERE parent_id>=' + lowerId + ') SELECT p.id,p.amount FROM analyze_parent AS p JOIN matched AS m ON m.parent_id=p.id']) {
        const actual = await analyzeOnce(owner, source), metrics = actual.analysis!.nodes.flatMap(node => node.metrics);
        expect(metrics.some(metric => metric.kind === 'actual')).toBe(true); expect(metrics.some(metric => metric.kind === 'estimate')).toBe(true);
        expect(metrics.filter(metric => metric.kind === 'actual').every(metric => typeof metric.value === 'string')).toBe(true);
      }
    } else {
      const before = owner.sent().length;
      await expect(owner.analyze(sql).pending).rejects.toThrow('8.0.18');
      expect(owner.sent().slice(before)).toEqual([]);
      await expect(owner.invoke('query.analyzeContext', { sessionId: owner.sessionId, taskId: randomUUID() })).rejects.toThrow('8.0.18');
      expect(owner.sent().slice(before)).toEqual([]);
    }
    const ordinary = await owner.invoke('query.explain', { sessionId: owner.sessionId, sql, taskId: randomUUID(), maxRows: 1000, format: 'auto' }) as QueryOutcome;
    expect(ordinary.explain?.nodes.length).toBeGreaterThan(0); expect(ordinary.analysis).toBeUndefined();
    expect(ordinary.results[0].statement).toBe('EXPLAIN FORMAT=JSON ' + sql);
    expect(values(await owner.query('SELECT id,amount FROM analyze_parent WHERE id=' + bigId))).toEqual([bigId, amount]);
  }), 90000);

  it('原会话临时表和事务保持，按厂商DML语义分析一次并显式回滚；错库或未确认零发送', async () => withFixture(async owner => {
    const connectionId = String(values(await owner.query('SELECT CONNECTION_ID()'))[0]);
    await owner.query('CREATE TEMPORARY TABLE analyze_temp (id INT PRIMARY KEY,value INT); INSERT INTO analyze_temp VALUES(1,41); START TRANSACTION; INSERT INTO analyze_guard VALUES(100,1)');
    const capability = queryAnalyzeCapability(owner.observer!.status), source = 'SELECT p.id,t.value FROM analyze_parent AS p JOIN analyze_temp AS t ON t.id=1 WHERE p.id>=' + lowerId;
    if (capability.supported) {
      await readAnalyzeContext(owner);
      const sameTransaction = await owner.query('SELECT CONNECTION_ID(),(SELECT value FROM analyze_temp WHERE id=1),(SELECT hits FROM analyze_guard WHERE id=100)');
      expect(sameTransaction.transactionOpen).toBe(true); expect(values(sameTransaction).map(String)).toEqual([connectionId, '41', '1']);
      expect(await owner.observe('SELECT id FROM ' + owner.table('analyze_guard'))).toEqual([]);
      expect((await analyzeOnce(owner, source)).transactionOpen).toBe(true);
    }
    else await expect(owner.analyze(source).pending).rejects.toThrow('8.0.18');
    expect(values(await owner.query('SELECT CONNECTION_ID(),(SELECT value FROM analyze_temp WHERE id=1),(SELECT hits FROM analyze_guard WHERE id=100)')).map(String)).toEqual([connectionId, '41', '1']);
    expect(await owner.observe('SELECT id FROM ' + owner.table('analyze_guard'))).toEqual([]);
    const dml = owner.observer!.status.dialect === 'mariadb' ? 'UPDATE analyze_guard SET hits=hits+1 WHERE id=100' : 'UPDATE analyze_guard AS g JOIN analyze_temp AS t ON t.id=1 SET g.hits=g.hits+1 WHERE g.id=100';
    if (capability.supported) {
      const before = owner.sent().length;
      if (owner.observer!.status.dialect === 'mariadb') {
        expect((await analyzeOnce(owner, dml)).transactionOpen).toBe(true);
        expect(values(await owner.query('SELECT hits FROM analyze_guard WHERE id=100')).map(String)).toEqual(['2']);
      } else {
        // MySQL8.0.46/8.4.11的UpdateRowsIterator在ANALYZE下跳过实际更新；不能套用Maria语义。
        // 官方行为依据：https://github.com/mysql/mysql-server/blob/mysql-8.0.46/sql/sql_update.cc
        expect((await analyzeOnce(owner, dml)).transactionOpen).toBe(true);
        expect(values(await owner.query('SELECT hits FROM analyze_guard WHERE id=100')).map(String)).toEqual(['1']);
      }
      expect(owner.sent().slice(before).filter(item => /UPDATE analyze_guard/.test(item.command.sql)).map(item => item.command.sql)).toEqual([capability.sqlPrefix + ' ' + dml]);
      if (owner.observer!.status.dialect === 'mysql') {
        // 独立正对照在零回退断言之后明确执行普通UPDATE，证明本例行确实可命中且可更新。
        const control = owner.sent().length;
        expect((await owner.query(dml)).transactionOpen).toBe(true);
        expect(values(await owner.query('SELECT hits FROM analyze_guard WHERE id=100')).map(String)).toEqual(['2']);
        expect(owner.sent().slice(control).filter(item => /UPDATE analyze_guard/.test(item.command.sql)).map(item => item.command.sql)).toEqual([dml]);
      }
      for (const overrides of [{ expectedDatabase: owner.database + '_wrong' }, { expectedDatabase: null }, { expectedDatabase: undefined }, { acknowledged: false }]) {
        expect(await owner.invoke('query.completionState', { sessionId: owner.sessionId })).toMatchObject({ databaseKnown: true, database: owner.database, busy: false, broken: false });
        const offset = owner.sent().length;
        await expect(owner.analyze('UPDATE analyze_guard SET hits=999 WHERE id=100', overrides).pending).rejects.toThrow();
        expect(owner.sent().slice(offset)).toEqual([]);
      }
    } else {
      const offset = owner.sent().length; await expect(owner.analyze(dml).pending).rejects.toThrow('8.0.18'); expect(owner.sent().slice(offset)).toEqual([]);
    }
    await owner.query('ROLLBACK'); expect(await owner.observe('SELECT id FROM ' + owner.table('analyze_guard'))).toEqual([]);
    expect(values(await owner.query('SELECT CONNECTION_ID(),value FROM analyze_temp WHERE id=1')).map(String)).toEqual([connectionId, '41']);
  }), 90000);

  it('语法缺表和多语句失败不重放尾部写入，真实长分析取消等待原RPC及控制连接终态', async () => withFixture(async owner => {
    const capability = queryAnalyzeCapability(owner.observer!.status);
    for (const sql of ['SELECT FROM analyze_parent', 'SELECT * FROM analyze_missing_table', 'INSERT INTO analyze_guard VALUES(200,1); UPDATE analyze_guard SET hits=99 WHERE id=200']) {
      const before = owner.sent().length;
      const request = owner.analyze(sql), result = await request.pending.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
      expect(result.value).toBeUndefined(); expect(result.error).toBeDefined();
      if (!capability.supported) expect(String((result.error as Error).message)).toContain('8.0.18');
      else if (sql.startsWith('INSERT')) expect(String((result.error as Error).message)).toContain('一次只接受一条');
      else expect((result.error as { code?: string }).code).toBe(sql.includes('missing_table') ? 'ER_NO_SUCH_TABLE' : 'ER_PARSE_ERROR');
      const sent = owner.sent().slice(before).filter(item => /^(?:EXPLAIN\s+ANALYZE|ANALYZE\s+FORMAT)/i.test(item.command.sql));
      expect(sent.map(item => item.command.sql)).toEqual(capability.supported && !sql.startsWith('INSERT') ? [capability.sqlPrefix + ' ' + sql] : []);
      expect(owner.events.filter(event => event.taskId === request.taskId).at(-1)?.status).toBe('failed');
      expect(await owner.observe('SELECT id FROM ' + owner.table('analyze_guard'))).toEqual([]);
      if (capability.supported && !sql.startsWith('INSERT')) await readAnalyzeContext(owner, true);
    }
    const sql = 'SELECT id FROM analyze_parent WHERE id=' + lowerId + ' AND SLEEP(30)=0';
    if (!capability.supported) { const before = owner.sent().length; await expect(owner.analyze(sql).pending).rejects.toThrow('8.0.18'); expect(owner.sent().slice(before)).toEqual([]); return; }
    const connectionId = Number(values(await owner.query('SELECT CONNECTION_ID()'))[0]), before = owner.sent().length, request = owner.analyze(sql);
    let settled = false;
    const outcome = request.pending.then(value => ({ value, error: undefined }), error => ({ value: undefined, error })).finally(() => { settled = true; });
    await vi.waitFor(async () => {
      if (settled) throw Error('未观测到长分析在途即已结束，不能冒充取消验收');
      const rows = await owner.observe('SELECT ID,COMMAND,INFO FROM information_schema.PROCESSLIST WHERE ID=?', [connectionId]);
      expect(rows).toHaveLength(1); expect(rows[0].COMMAND).not.toBe('Sleep'); expect(String(rows[0].INFO)).toContain('SLEEP(30)');
      expect(String(rows[0].INFO)).toContain(capability.sqlPrefix!);
    }, { timeout: 5000, interval: 50 });
    const cancel = owner.invoke('query.cancel', { taskId: request.taskId });
    const [result] = await Promise.all([outcome, cancel]);
    expect(result.value).toBeUndefined(); expect(result.error).toBeDefined();
    expect(owner.events.filter(event => event.taskId === request.taskId).at(-1)?.status).toBe('cancelled');
    const sent = owner.sent().slice(before), original = sent.filter(item => item.command.sql === capability.sqlPrefix + ' ' + sql), killers = sent.filter(item => item.command.sql === 'KILL QUERY ' + connectionId);
    expect(original).toHaveLength(1); expect(original[0].command.ended || original[0].command.errored || original[0].command.callbackReturned).toBe(true);
    expect(killers).toHaveLength(1); expect(killers[0].command.callbackReturned).toBe(true); expect(killers[0].command.callbackError).toBeUndefined();
    await vi.waitFor(async () => expect(await owner.observe('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [killers[0].connection.id])).toEqual([]), { timeout: 5000, interval: 50 });
    // 原取消控制确已退出后才复用固定会话，迟到KILL不能打到下一条SQL。
    expect(values(await owner.query('SELECT CONNECTION_ID(),1')).map(String)).toEqual([String(connectionId), '1']);
    expect(await owner.observe('SELECT id FROM ' + owner.table('analyze_guard'))).toEqual([]);
  }), 90000);
});
