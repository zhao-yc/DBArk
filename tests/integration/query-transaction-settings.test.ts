import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import * as driver from '../../src/engine/connection';
import { execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier } from '../../src/engine/sql';
import type { Command, CommandMap, NetworkConnectionProfile as ConnectionProfile, QueryOutcome } from '../../src/shared/contracts';
import type { QueryTransactionSettingsSnapshot } from '../../src/shared/queryTransactionSettings';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TRANSACTION_SETTINGS_INTEGRATION === '1';
const ports = [13357, 13380, 13384, 13310, 13311, 13484];
interface Fact { managed: ManagedConnection; id: number; closed: boolean; sql: string[]; }
type Rows = Record<string, unknown>[];

/** 只消费统筹预核的隔离实例配置；默认运行不读取私有文件或尝试连接。 */
function profile(): ConnectionProfile {
  const host = process.env.DBARK_TEST_HOST ?? '', port = Number(process.env.DBARK_TEST_PORT), tls = process.env.DBARK_TEST_TLS === '1';
  if (!['192.168.31.200', 'deve-server.yinzon.com'].includes(host) || !ports.includes(port) || !process.env.DBARK_TEST_USER) throw Error('事务设置实库专项仅限200既定隔离实例');
  if (port === 13484 && (!tls || !process.env.DBARK_TEST_CA)) throw Error('13484必须保持已有严格TLS校验');
  return { id: randomUUID(), name: '事务默认设置实库专项', group: '测试', color: '#53c9ae', dialect: 'mysql', host, port,
    user: process.env.DBARK_TEST_USER, password: process.env.DBARK_TEST_PASSWORD ?? '',
    ...(tls ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
}

/** 原Engine、原观察连接和随机库绑定同一owner；有在途请求时不执行清库。 */
class Fixture {
  readonly profile = profile();
  readonly database = 'dbark_txsettings_' + Date.now() + '_' + randomUUID().replaceAll('-', '').slice(0, 8);
  readonly marker = randomUUID();
  readonly engine = new Engine();
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
    console.log(JSON.stringify({ 验收: '事务默认设置原观察连接', 端口: this.profile.port, 版本: row.version, 主机: row.hostname, 线程: row.id, 隔离库: this.database }));
    await this.observe('CREATE DATABASE ' + identifier(this.database) + ' CHARACTER SET utf8mb4'); this.created = true;
    await this.observe('CREATE TABLE ' + this.table('owner') + ' (token VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB');
    await this.observe('INSERT INTO ' + this.table('owner') + ' VALUES (?)', [this.marker]); this.marked = true;
    await this.observe('CREATE TABLE ' + this.table('subject') + ' (id INT PRIMARY KEY,note VARCHAR(64)) ENGINE=InnoDB');
    const original = driver.connect;
    const spy = vi.spyOn(driver, 'connect').mockImplementation(async (...args) => {
      const managed = await original(...args), native = managed.connection;
      const stream = (native as unknown as { stream?: { closed?: boolean; once(name: string, callback: () => void): void } }).stream;
      if (!Number.isSafeInteger(native.threadId) || !stream) { await managed.close({ strict: true }); throw Error('缺少原物理连接归属'); }
      const fact: Fact = { managed, id: native.threadId!, closed: stream.closed === true, sql: [] }; this.facts.push(fact);
      stream.once('close', () => { fact.closed = true; });
      // 只旁观原驱动，不替换结果、协议事件或执行时序。
      const query = native.query;
      native.query = function (this: typeof native, ...args: unknown[]) {
        if (this !== native || native.threadId !== fact.id) throw Error('原物理连接变化');
        const first = args[0], sql = typeof first === 'string' ? first : (first as { sql?: unknown })?.sql;
        if (typeof sql !== 'string') throw Error('未识别原SQL参数'); fact.sql.push(sql);
        return Reflect.apply(query, native, args);
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
  query(sessionId: string, sql: string): Promise<QueryOutcome> { return this.invoke('query.execute', { sessionId, sql, taskId: randomUUID(), maxRows: 100 }); }
  /** 两个正式命令均从契约调用，不从测试直接调用事务设置内部helper。 */
  read(sessionId: string): Promise<QueryTransactionSettingsSnapshot> { return this.invoke('query.transactionSettings.read', { sessionId, taskId: randomUUID() }); }
  /** 保留原expected快照，绝不遇错后自动刷新并重试SET。 */
  apply(sessionId: string, expected: QueryTransactionSettingsSnapshot, isolation: QueryTransactionSettingsSnapshot['isolation'], readOnly: boolean): Promise<QueryTransactionSettingsSnapshot> {
    return this.invoke('query.transactionSettings.apply', { sessionId, taskId: randomUUID(), expected, isolation, readOnly });
  }
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
        if (!this.marked || !/^dbark_txsettings_\d+_[0-9a-f]{8}$/.test(this.database)) throw Error('原随机库owner未确认，保留现场');
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
    console.log(JSON.stringify({ 验收: '事务默认设置原连接收尾', 端口: this.profile.port, 隔离库: this.database, 产品线程: this.facts.map(fact => fact.id), 线程残留: 0, 库残留: 0,
      原SQL: this.facts.map(fact => ({ 线程: fact.id, 物理关闭: fact.closed, sql: fact.sql })) }));
  }
}

describe.skipIf(!enabled)('查询会话事务默认设置：真实六版本隔离专项', () => {
  it('默认设置隔离、只读拒写、活动事务零SET与无隐式提交、过期拒绝、新会话不重放', async () => {
    const owner = new Fixture(); let failed = false, failure: unknown;
    try {
      await owner.start();
      const open = () => owner.invoke('sessions.open', { connectionId: owner.profile.id, database: owner.database });
      const a = (await open()).sessionId, b = (await open()).sessionId;
      const initial = await owner.read(a), other = await owner.read(b);
      expect(initial.serverConnectionId).not.toBe(other.serverConnectionId); expect(initial.database).toBe(owner.database);
      expect(initial.transactionOpen).toBe(false); expect(initial.autocommit).toBe(true);
      const readonly = await owner.apply(a, initial, 'READ COMMITTED', true);
      expect(readonly).toMatchObject({ isolation: 'READ COMMITTED', readOnly: true, transactionOpen: false, serverConnectionId: initial.serverConnectionId });
      expect(await owner.read(b)).toEqual(other);
      await owner.invoke('query.transaction', { sessionId: a, action: 'begin' });
      const denied = await owner.query(a, 'INSERT INTO subject VALUES(1,\'只读事务应拒绝\')');
      expect(denied.failure).toBeDefined(); expect(denied.failure?.message).toMatch(/read.only|只读/i);
      const active = await owner.read(a); expect(active.transactionOpen).toBe(true);
      const countSets = () => owner.facts.flatMap(fact => fact.sql).filter(sql => /^SET SESSION TRANSACTION /.test(sql)).length;
      const beforeDenied = countSets();
      await expect(owner.apply(a, active, 'REPEATABLE READ', false)).rejects.toThrow(/事务/); expect(countSets()).toBe(beforeDenied);
      expect((await owner.read(a)).transactionOpen).toBe(true);
      await owner.invoke('query.transaction', { sessionId: a, action: 'rollback' });
      const writable = await owner.apply(a, await owner.read(a), 'REPEATABLE READ', false);
      await owner.invoke('query.transaction', { sessionId: a, action: 'begin' });
      const inserted = await owner.query(a, 'INSERT INTO subject VALUES(2,\'必须保持未提交\')'); expect(inserted.failure).toBeUndefined();
      expect(await owner.observe('SELECT id FROM ' + owner.table('subject'))).toEqual([]);
      const writing = await owner.read(a), beforeWriteDenied = countSets(); expect(writing.transactionOpen).toBe(true);
      await expect(owner.apply(a, writing, 'SERIALIZABLE', true)).rejects.toThrow(/事务/); expect(countSets()).toBe(beforeWriteDenied);
      expect(await owner.observe('SELECT id FROM ' + owner.table('subject'))).toEqual([]);
      expect(Object.values((await owner.query(a, 'SELECT id FROM subject')).results[0].rows[0]).map(String)).toEqual(['2']);
      await owner.invoke('query.transaction', { sessionId: a, action: 'rollback' });
      expect(await owner.observe('SELECT id FROM ' + owner.table('subject'))).toEqual([]);
      const stale = await owner.read(a);
      expect((await owner.query(a, 'SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE, READ WRITE')).failure).toBeUndefined();
      const beforeStale = countSets(); await expect(owner.apply(a, stale, 'READ UNCOMMITTED', true)).rejects.toThrow(); expect(countSets()).toBe(beforeStale);
      expect(await owner.read(a)).toMatchObject({ isolation: 'SERIALIZABLE', readOnly: false, serverConnectionId: initial.serverConnectionId });
      expect(await owner.read(b)).toEqual(other);
      // 一次性SQL覆盖不应被“默认设置”误报成当前事务属性，读取也不得吞掉下一事务覆盖。
      expect((await owner.query(a, 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY')).failure).toBeUndefined();
      expect(await owner.read(a)).toMatchObject({ isolation: 'SERIALIZABLE', readOnly: false });
      await owner.invoke('query.transaction', { sessionId: a, action: 'begin' });
      const onceDenied = await owner.query(a, 'INSERT INTO subject VALUES(3,\'一次性只读也应拒绝\')');
      expect(onceDenied.failure).toBeDefined(); expect(onceDenied.failure?.message).toMatch(/read.only|只读/i);
      expect((await owner.read(a)).transactionOpen).toBe(true);
      expect(await owner.observe('SELECT id FROM ' + owner.table('subject'))).toEqual([]);
      await owner.invoke('query.transaction', { sessionId: a, action: 'rollback' });
      expect(await owner.observe('SELECT id FROM ' + owner.table('subject'))).toEqual([]);
      await owner.invoke('sessions.close', { sessionId: a });
      const c = (await open()).sessionId, fresh = await owner.read(c);
      expect(fresh.serverConnectionId).not.toBe(initial.serverConnectionId);
      expect(fresh).toMatchObject({ isolation: initial.isolation, readOnly: initial.readOnly, autocommit: initial.autocommit, transactionOpen: false });
      expect(writable).toMatchObject({ isolation: 'REPEATABLE READ', readOnly: false });
      console.log(JSON.stringify({ 验收: '事务设置功能事实', 端口: owner.profile.port, 原线程: initial.serverConnectionId, 第二标签线程: other.serverConnectionId, 新会话线程: fresh.serverConnectionId, SET次数: countSets(), 只读真实错误: denied.failure?.message }));
    } catch (error) { failed = true; failure = error; }
    try { await owner.finish(); } catch (cleanup) { if (failed) throw new AggregateError([failure, cleanup], '事务设置原功能失败且收尾未确认', { cause: failure }); throw cleanup; }
    if (failed) throw failure;
  }, 90000);
});
