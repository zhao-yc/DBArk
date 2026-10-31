import { randomUUID } from 'node:crypto';
import { appendFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import * as driver from '../../src/engine/connection';
import { execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier } from '../../src/engine/sql';
import type { Command, CommandMap, NetworkConnectionProfile as ConnectionProfile, QueryOutcome } from '../../src/shared/contracts';
import type { QueryTransactionSettingsSnapshot } from '../../src/shared/queryTransactionSettings';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_AUTOCOMMIT_INTEGRATION === '1';
type Rows = Record<string, unknown>[];
interface ConnectionFact { managed: ManagedConnection; id: number; closed: boolean; sql: string[]; }

/** mysql2的运行时stream未列入公开类型，必须先核原物理流归属再旁观关闭。 */
function physicalStream(managed: ManagedConnection) {
  const stream = (managed.connection as unknown as { stream?: { closed?: boolean; once(name: string, listener: () => void): unknown } }).stream;
  if (!stream || !Number.isSafeInteger(managed.connection.threadId)) throw Error('缺少原物理连接和流身份');
  return stream;
}

/** 默认关闭；只使用预核的200隔离实例，严格TLS端口不能降低认证校验。 */
function profile(): ConnectionProfile {
  const host = process.env.DBARK_TEST_HOST ?? '', port = Number(process.env.DBARK_TEST_PORT), tls = process.env.DBARK_TEST_TLS === '1';
  if (!['192.168.31.200', 'deve-server.yinzon.com'].includes(host) || ![13357, 13380, 13384, 13310, 13311, 13484].includes(port) || !process.env.DBARK_TEST_USER || !process.env.DBARK_TEST_EXPECTED_HOSTNAME) throw Error('自动提交实库专项仅限200预核隔离实例');
  if (port === 13484 && (!tls || !process.env.DBARK_TEST_CA)) throw Error('13484必须保持严格TLS');
  return { id: randomUUID(), name: '本会话自动提交实库专项', group: '隔离测试', color: '#53c9ae', dialect: 'mysql', host, port,
    user: process.env.DBARK_TEST_USER, password: process.env.DBARK_TEST_PASSWORD ?? '',
    ...(tls ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
}

/** 独占日志在CREATE之前登记准确资源；失败保留原库，不自动再连或重放。 */
class Fixture {
  readonly profile = profile();
  readonly nonce = randomUUID().replaceAll('-', '').slice(0, 12);
  readonly database = 'dbark_autocommit_' + this.nonce;
  readonly marker = 'dbark-autocommit:' + this.nonce;
  readonly journal = process.env.DBARK_AUTOCOMMIT_RESOURCE_LOG ?? '';
  readonly facts: ConnectionFact[] = [];
  readonly engine = new Engine();
  readonly requests = new Set<Promise<unknown>>();
  observer?: ManagedConnection;
  observerClosed = false;
  created = false;
  private restore?: () => void;

  /** 查询目标都由内部随机库名逐段引用，不接受外部SQL资源。 */
  table(name: '__owner' | 'subject'): string { return identifier(this.database) + '.' + identifier(name); }
  /** 保留每个原Promise；原请求未结束不能进入精准清理。 */
  invoke<C extends Command>(command: C, input: CommandMap[C]['input']): Promise<CommandMap[C]['output']> {
    const pending = this.engine.handle(command, input as Record<string, unknown>) as Promise<CommandMap[C]['output']>;
    this.requests.add(pending); void pending.then(() => this.requests.delete(pending), () => this.requests.delete(pending)); return pending;
  }
  /** 同一观察连接独立读写测试资源，不用产品返回自己证明提交。 */
  async observe(sql: string, params: (string | number)[] = []): Promise<Rows> {
    if (!this.observer) throw Error('原观察连接不存在');
    return (await execute<Rows>(this.observer, sql, params)).rows;
  }
  /** 原始日志只含随机资源及协议身份，不记录认证。 */
  async log(value: Record<string, unknown>): Promise<void> { await appendFile(this.journal, JSON.stringify({ database: this.database, marker: this.marker, port: this.profile.port, ...value }) + '\n'); }
  /** 完整核对宿主、内部端口、版本及MySQL UUID后才创建精确隔离资源。 */
  async start(): Promise<void> {
    if (!isAbsolute(this.journal)) throw Error('必须提供本轮独占原始资源日志绝对路径');
    await writeFile(this.journal, JSON.stringify({ stage: '创建前登记', database: this.database, marker: this.marker, host: this.profile.host, port: this.profile.port }) + '\n', { flag: 'wx' });
    this.observer = await driver.connect(this.profile);
    physicalStream(this.observer).once('close', () => { this.observerClosed = true; });
    const identity = (await this.observe('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,VERSION() AS version,CONNECTION_ID() AS id'))[0];
    expect(identity.hostname).toBe(process.env.DBARK_TEST_EXPECTED_HOSTNAME); expect(String(identity.port)).toBe('3306');
    expect(String(identity.serverId)).toBe(process.env.DBARK_TEST_EXPECTED_SERVER_ID ?? '1');
    expect(identity.version).toBe(process.env.DBARK_TEST_EXPECTED_VERSION);
    if (this.observer.status.dialect === 'mysql') {
      if (!process.env.DBARK_TEST_EXPECTED_UUID) throw Error('缺少准确MySQL实例UUID');
      expect((await this.observe('SELECT @@server_uuid AS uuid'))[0].uuid).toBe(process.env.DBARK_TEST_EXPECTED_UUID);
    }
    await this.log({ stage: '实际身份确认', identity, dialect: this.observer.status.dialect });
    await this.observe('CREATE DATABASE ' + identifier(this.database) + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); this.created = true;
    await this.observe('CREATE TABLE ' + this.table('__owner') + ' (marker VARCHAR(80) NOT NULL PRIMARY KEY) ENGINE=InnoDB');
    await this.observe('INSERT INTO ' + this.table('__owner') + ' VALUES (?)', [this.marker]);
    await this.observe('CREATE TABLE ' + this.table('subject') + ' (id INT NOT NULL PRIMARY KEY,note VARCHAR(80) NOT NULL) ENGINE=InnoDB');
    await this.observe('INSERT INTO ' + this.table('subject') + ' VALUES (1,?),(2,?),(3,?)', ['控制一', '控制二', '控制三']);
    const connect = driver.connect;
    const spy = vi.spyOn(driver, 'connect').mockImplementation(async (...args) => {
      const managed = await connect(...args), native = managed.connection;
      const fact: ConnectionFact = { managed, id: native.threadId!, closed: false, sql: [] }; this.facts.push(fact);
      physicalStream(managed).once('close', () => { fact.closed = true; });
      const query = native.query;
      native.query = function (this: typeof native, ...values: unknown[]) {
        if (this !== native || native.threadId !== fact.id) throw Error('原物理连接变化');
        const first = values[0], sql = typeof first === 'string' ? first : (first as { sql?: unknown })?.sql;
        if (typeof sql !== 'string') throw Error('未识别原SQL参数'); fact.sql.push(sql);
        return Reflect.apply(query, native, values);
      } as typeof native.query;
      return managed;
    }); this.restore = () => spy.mockRestore();
    await this.invoke('connections.open', { id: this.profile.id, profile: this.profile } as never);
  }
  /** 有错误的普通SQL保留产品原结果，不将失败转换为成功。 */
  async query(sessionId: string, sql: string): Promise<QueryOutcome> {
    const result = await this.invoke('query.execute', { sessionId, sql, taskId: randomUUID(), maxRows: 100 });
    expect(result.failure).toBeUndefined(); return result;
  }
  /** 读取与设置都走真实公开Engine命令，不直接调用内部实现。 */
  read(sessionId: string): Promise<QueryTransactionSettingsSnapshot> { return this.invoke('query.transactionSettings.read', { sessionId, taskId: randomUUID() }); }
  /** 不自动刷新expected；未明确确认时让真实公开命令拒绝可能的隐式提交。 */
  apply(sessionId: string, expected: QueryTransactionSettingsSnapshot, autocommit: boolean, allowImplicitCommit = false) {
    return this.invoke('query.autocommit.apply', { sessionId, taskId: randomUUID(), expected, autocommit, allowImplicitCommit });
  }
  /** 关闭全部原连接后才核owner、数据和目录；失败留库，绝不在未知状态下删除。 */
  async finish(success: boolean): Promise<void> {
    let failure: unknown;
    try {
      await Promise.allSettled([...this.requests]); await this.engine.closeAll(); expect(this.requests.size).toBe(0);
      const ids = this.facts.map(fact => fact.id);
      if (ids.length) {
        await vi.waitFor(async () => expect(await this.observe('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + ids.map(() => '?').join(',') + ')', ids)).toEqual([]), { timeout: 5000, interval: 50 });
        await vi.waitFor(() => expect(this.facts.every(fact => fact.closed)).toBe(true), { timeout: 5000, interval: 50 });
      }
      if (success && this.created) {
        expect(await this.observe('SELECT marker FROM ' + this.table('__owner'))).toEqual([{ marker: this.marker }]);
        expect(await this.observe('SELECT id,note FROM ' + this.table('subject') + ' ORDER BY id')).toEqual([{ id: 1, note: '已确认隐式提交' }, { id: 2, note: '控制二' }, { id: 3, note: '控制三' }]);
        expect(await this.observe('SELECT TABLE_NAME AS name,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [this.database])).toEqual([{ name: '__owner', kind: 'BASE TABLE' }, { name: 'subject', kind: 'BASE TABLE' }]);
        for (const [view, field] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect(await this.observe('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + field + '=BINARY ? LIMIT 1', [this.database])).toEqual([]);
        expect(await this.observe('SELECT 1 FROM information_schema.KEY_COLUMN_USAGE WHERE BINARY REFERENCED_TABLE_SCHEMA=BINARY ? LIMIT 1', [this.database])).toEqual([]);
        expect(await this.observe('SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?', [this.database])).toEqual([]);
        await this.observe('SET SESSION lock_wait_timeout=5'); await this.observe('DROP DATABASE ' + identifier(this.database));
        expect(await this.observe('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [this.database])).toEqual([]);
      }
      await this.log({ stage: success ? '成功精确清理' : '失败保留', deleted: success && this.created, facts: this.facts.map(fact => ({ id: fact.id, closed: fact.closed, sql: fact.sql })) });
    } catch (error) { failure = error; }
    try { if (this.observer) { await this.observer.close({ strict: true }); await vi.waitFor(() => expect(this.observerClosed).toBe(true), { timeout: 5000, interval: 50 }); await this.log({ stage: '原观察连接正常关闭', observerClosed: this.observerClosed }); } }
    catch (error) { failure = failure ? new AggregateError([failure, error], '自动提交实库与原观察连接收尾失败') : error; }
    finally { this.restore?.(); }
    if (failure) throw failure;
  }
}

describe.skipIf(!enabled)('本会话自动提交真实隔离专项', () => {
  it('关闭不提交、明确开启提交、同值不提交、默认设置与临时表保持、跨标签隔离及新会话不重放', async () => {
    const owner = new Fixture(); let failure: unknown, success = false;
    try {
      await owner.start();
      const open = () => owner.invoke('sessions.open', { connectionId: owner.profile.id, database: owner.database });
      const a = (await open()).sessionId, b = (await open()).sessionId, first = await owner.read(a), second = await owner.read(b);
      expect(first).toMatchObject({ autocommit: true, transactionOpen: false }); expect(first.serverConnectionId).not.toBe(second.serverConnectionId);
      await owner.query(a, 'CREATE TEMPORARY TABLE keep_session (id INT PRIMARY KEY) ENGINE=InnoDB'); await owner.query(a, 'INSERT INTO keep_session VALUES (73)');
      const off = await owner.apply(a, await owner.read(a), false); expect(off).toMatchObject({ changed: true, implicitCommitAcknowledged: false, snapshot: { autocommit: false, transactionOpen: false } });
      await owner.query(a, "UPDATE subject SET note='尚未提交' WHERE id=1"); const active = await owner.read(a); expect(active.transactionOpen).toBe(true);
      const countSets = () => owner.facts.flatMap(fact => fact.sql).filter(sql => /^SET SESSION autocommit = [01]$/.test(sql)).length;
      const deniedCount = countSets(); await expect(owner.apply(a, active, true)).rejects.toThrow('必须明确确认'); expect(countSets()).toBe(deniedCount);
      expect(await owner.observe('SELECT note FROM ' + owner.table('subject') + ' WHERE id=1')).toEqual([{ note: '控制一' }]);
      await owner.invoke('query.transaction', { sessionId: a, action: 'rollback' });
      expect(await owner.observe('SELECT note FROM ' + owner.table('subject') + ' WHERE id=1')).toEqual([{ note: '控制一' }]);
      await owner.query(a, "UPDATE subject SET note='已确认隐式提交' WHERE id=1");
      const committed = await owner.apply(a, await owner.read(a), true, true);
      expect(committed).toMatchObject({ changed: true, implicitCommitAcknowledged: true, snapshot: { autocommit: true, transactionOpen: false, serverConnectionId: first.serverConnectionId, database: owner.database, isolation: first.isolation, readOnly: first.readOnly } });
      expect(await owner.observe('SELECT note FROM ' + owner.table('subject') + ' WHERE id=1')).toEqual([{ note: '已确认隐式提交' }]);
      await owner.invoke('query.transaction', { sessionId: a, action: 'begin' }); await owner.query(a, "UPDATE subject SET note='同值不应提交' WHERE id=2");
      const same = await owner.read(a), beforeSame = countSets(); expect(same.autocommit && same.transactionOpen).toBe(true);
      expect(await owner.apply(a, same, true)).toMatchObject({ changed: false, implicitCommitAcknowledged: false, snapshot: { transactionOpen: true } }); expect(countSets()).toBe(beforeSame);
      expect(await owner.observe('SELECT note FROM ' + owner.table('subject') + ' WHERE id=2')).toEqual([{ note: '控制二' }]);
      const offActive = await owner.apply(a, await owner.read(a), false); expect(offActive.snapshot).toMatchObject({ autocommit: false, transactionOpen: true });
      expect(await owner.observe('SELECT note FROM ' + owner.table('subject') + ' WHERE id=2')).toEqual([{ note: '控制二' }]);
      await owner.invoke('query.transaction', { sessionId: a, action: 'rollback' });
      const stale = await owner.read(a); await owner.query(a, 'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED, READ WRITE'); const beforeStale = countSets();
      await expect(owner.apply(a, stale, true)).rejects.toThrow('快照已变化'); expect(countSets()).toBe(beforeStale);
      // QueryResult以独立列key定位行值；同时核字段名和精确值，不能把名称当作内部key。
      const temporary = await owner.query(a, 'SELECT id FROM keep_session');
      expect(temporary.results).toHaveLength(1); expect(temporary.results[0].columns).toHaveLength(1);
      const temporaryColumn = temporary.results[0].columns[0]; expect(temporaryColumn.name).toBe('id');
      expect(temporary.results[0].rows).toEqual([{ [temporaryColumn.key]: 73 }]);
      await owner.invoke('query.transaction', { sessionId: a, action: 'rollback' });
      expect(await owner.read(b)).toEqual(second);
      await owner.invoke('sessions.close', { sessionId: a }); const freshId = (await open()).sessionId, fresh = await owner.read(freshId);
      expect(fresh.serverConnectionId).not.toBe(first.serverConnectionId); expect(fresh).toMatchObject({ autocommit: first.autocommit, transactionOpen: false, isolation: first.isolation, readOnly: first.readOnly, database: owner.database });
      expect(await owner.observe('SELECT id,note FROM ' + owner.table('subject') + ' ORDER BY id')).toEqual([{ id: 1, note: '已确认隐式提交' }, { id: 2, note: '控制二' }, { id: 3, note: '控制三' }]);
      await owner.log({ stage: '功能已核', first, second, fresh, committed, setCount: countSets() }); success = true;
    } catch (error) { failure = error; }
    try { await owner.finish(success); } catch (cleanup) { failure = failure ? new AggregateError([failure, cleanup], '自动提交原功能与清理均失败') : cleanup; }
    if (failure) throw failure;
  });
});
