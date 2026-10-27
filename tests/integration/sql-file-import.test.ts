import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import type { ReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import * as driver from '../../src/engine/connection';
import { execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier } from '../../src/engine/sql';
import type { Command, CommandMap, ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import { sqlFileImportReceiptSchema, type FileImportResult, type SqlFileImportReceipt } from '../../src/shared/sqlFileImport';

const streams = vi.hoisted(() => ({ watch: undefined as ((path: unknown, source: ReadStream) => void) | undefined }));
/** 只旁听真实文件流，不替换字节、分块、背压或任何执行结果。 */
vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, createReadStream: (...args: Parameters<typeof actual.createReadStream>) => { const source = actual.createReadStream(...args); streams.watch?.(args[0], source); return source; } };
});

const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_SQL_FILE_IMPORT_INTEGRATION === '1';
interface Fact { managed: ManagedConnection; id: number; closed: boolean; commands: { sql: string; ended: boolean; errno?: number }[]; }
type Rows = Record<string, unknown>[];

/** 只允许200六个既定隔离端口；TLS端口不能退回明文或跳过证书验证。 */
function profile(): ConnectionProfile {
  const host = process.env.DBARK_TEST_HOST ?? '', port = Number(process.env.DBARK_TEST_PORT), tls = process.env.DBARK_TEST_TLS === '1';
  if (!['deve-server.yinzon.com', '192.168.31.200'].includes(host) || ![13357, 13380, 13384, 13310, 13311, 13484].includes(port) || !process.env.DBARK_TEST_USER) throw Error('SQL文件专项仅限200既定隔离实例');
  if (port === 13484 && (!tls || !process.env.DBARK_TEST_CA)) throw Error('13484必须保持既有严格TLS及CA');
  return { id: randomUUID(), name: 'SQL文件流式回执专项', group: '隔离测试', color: '#53c9ae', dialect: 'mysql', host, port, user: process.env.DBARK_TEST_USER, password: process.env.DBARK_TEST_PASSWORD ?? '', ...(tls ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
}

/** 独立计算CRLF文本中的UTF16半开位置，不调用产品解析器生成期望。 */
function location(source: string, offset: number, end: number) {
  const point = (value: number) => { const prefix = source.slice(0, value), lines = prefix.split('\n'); return { offset: value, line: lines.length, column: lines.at(-1)!.length + 1 }; };
  return { start: point(offset), end: point(end) };
}

/** 原观察连接、文件及Engine线程绑定同一随机owner，未知归属时保留现场。 */
class Fixture {
  readonly profile = profile();
  readonly database = 'dbark_sqlimport_' + randomUUID().replaceAll('-', '');
  readonly marker = randomUUID();
  readonly events: TaskEvent[] = [];
  readonly engine = new Engine(event => this.events.push(event));
  readonly facts: Fact[] = [];
  readonly requests = new Set<Promise<unknown>>();
  readonly files = new Map<string, Buffer>();
  readonly streams: { path: string; closed: boolean; chunks: number }[] = [];
  observer?: ManagedConnection;
  directory = ''; created = false; marked = false;
  private restore?: () => void;

  /** CREATE之前先从真实连接核对Root预先确认的hostname和MySQL UUID。 */
  async start() {
    this.observer = await driver.connect(this.profile);
    if (!process.env.DBARK_TEST_EXPECTED_HOSTNAME) throw Error('缺少原实例预核hostname，未建库');
    const row = (await this.observe('SELECT VERSION() AS version,@@hostname AS hostname,CONNECTION_ID() AS id'))[0];
    expect(row.hostname).toBe(process.env.DBARK_TEST_EXPECTED_HOSTNAME);
    expect(Number(row.id)).toBe(this.observer.connection.threadId);
    if (this.observer.status.dialect === 'mysql') {
      if (!process.env.DBARK_TEST_EXPECTED_UUID) throw Error('缺少原MySQL预核UUID，未建库');
      expect((await this.observe('SELECT @@server_uuid AS uuid'))[0].uuid).toBe(process.env.DBARK_TEST_EXPECTED_UUID);
    }
    console.log(JSON.stringify({ 专项: 'SQL文件导入', 阶段: '原资源登记', 端口: this.profile.port, 版本: row.version, 主机: row.hostname, 数据库: this.database, owner: this.marker, 观察线程: row.id }));
    // 发出CREATE前即视为可能已创建；ACK未知时必须因owner未确认而保留现场。
    this.created = true; await this.observe('CREATE DATABASE ' + identifier(this.database) + ' CHARACTER SET utf8mb4');
    await this.observe('CREATE TABLE ' + this.table('__owner') + ' (token VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB');
    await this.observe('INSERT INTO ' + this.table('__owner') + ' VALUES (?)', [this.marker]); this.marked = true;
    for (const name of ['subject', 'uncommitted']) await this.observe('CREATE TABLE ' + this.table(name) + ' (id INT PRIMARY KEY,note VARCHAR(100)) ENGINE=InnoDB');
    this.directory = await mkdtemp(join(tmpdir(), 'dbark-sqlimport-'));
    streams.watch = (path, source) => {
      if (typeof path !== 'string' || !this.files.has(path)) throw Error('SQL文件专项读取未登记文件');
      const fact = { path, closed: false, chunks: 0 }; this.streams.push(fact);
      source.on('data', () => { fact.chunks++; }); source.once('close', () => { fact.closed = true; });
    };
    const original = driver.connect;
    const spy = vi.spyOn(driver, 'connect').mockImplementation(async (...args) => {
      const managed = await original(...args), native = managed.connection;
      const socket = (native as unknown as { stream?: { closed?: boolean; once(event: string, listener: () => void): void } }).stream;
      if (!Number.isSafeInteger(native.threadId) || !socket) { await managed.close({ strict: true }); throw Error('SQL文件导入原物理连接未知'); }
      const fact: Fact = { managed, id: native.threadId!, closed: socket.closed === true, commands: [] }; this.facts.push(fact);
      socket.once('close', () => { fact.closed = true; });
      const query = native.query;
      native.query = function (this: typeof native, ...args: unknown[]) {
        if (this !== native || native.threadId !== fact.id) throw Error('SQL文件导入线程归属变化');
        const input = args[0], sql = typeof input === 'string' ? input : (input as { sql?: unknown })?.sql;
        if (typeof sql !== 'string') throw Error('未识别原驱动SQL形状');
        const command: Fact['commands'][number] = { sql, ended: false }; fact.commands.push(command);
        const result = Reflect.apply(query, native, args);
        result.once('end', () => { command.ended = true; }); result.once('error', (error: { errno?: number }) => { command.errno = error.errno; }); return result;
      } as typeof native.query;
      return managed;
    });
    this.restore = () => spy.mockRestore();
    await this.invoke('connections.open', { id: this.profile.id, profile: this.profile } as never);
  }
  /** 每段对象身份独立引用，只接受本例内部固定表名。 */
  table(name: string) { return identifier(this.database) + '.' + identifier(name); }
  /** 原请求完全结束前不接管清理，不增加重试。 */
  invoke<C extends Command>(command: C, input: CommandMap[C]['input']): Promise<CommandMap[C]['output']> {
    const pending = this.engine.handle(command, input as Record<string, unknown>) as Promise<CommandMap[C]['output']>;
    this.requests.add(pending); void pending.then(() => this.requests.delete(pending), () => this.requests.delete(pending)); return pending;
  }
  /** 独立观察不向产品写入任何预期结果。 */
  async observe(sql: string, values: (string | number)[] = []): Promise<Rows> { if (!this.observer) throw Error('原观察连接缺失'); return (await execute<Rows>(this.observer, sql, values)).rows; }
  /** 文件先独占创建并登记真实字节；Engine测试直接提供内部路径，Main能力由正式UI另验。 */
  async run(name: string, text: string, encoding: 'utf8' | 'utf16le' | 'gb18030', bom = false, taskId = randomUUID()): Promise<FileImportResult> {
    const path = join(this.directory, name + '.sql');
    const bytes = Buffer.concat([bom ? encoding === 'utf16le' ? Buffer.from([0xff, 0xfe]) : Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), iconv.encode(text, encoding)]);
    this.files.set(path, bytes); await writeFile(path, bytes, { flag: 'wx' });
    return this.invoke('files.import', { connectionId: this.profile.id, database: this.database, table: 'subject', fileToken: randomUUID(), filePath: path, format: 'sql', encoding, mapping: {}, taskId } as CommandMap['files.import']['input']);
  }
  /** 逐线程和文件流确认释放后才核owner并DROP准确随机库，失败不强清。 */
  async finish() {
    let failed = false, failure: unknown;
    try {
      await Promise.allSettled([...this.requests]); await this.engine.closeAll();
      if (this.requests.size) throw Error('原SQL文件请求尚未结束，保留资源');
      await vi.waitFor(() => expect(this.facts.every(fact => fact.closed && fact.commands.every(command => command.ended))).toBe(true), { timeout: 5000, interval: 50 });
      await vi.waitFor(() => expect(this.streams.every(stream => stream.closed)).toBe(true), { timeout: 5000, interval: 50 });
      for (const fact of this.facts) expect(await this.observe('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [fact.id])).toEqual([]);
      if (this.created) {
        if (!this.marked || !/^dbark_sqlimport_[a-f0-9]{32}$/.test(this.database)) throw Error('本例随机库owner未知，保留资源');
        expect(await this.observe('SELECT token FROM ' + this.table('__owner'))).toEqual([{ token: this.marker }]);
        expect(await this.observe('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=?', [this.database])).toEqual([]);
        await this.observe('SET SESSION lock_wait_timeout=5'); await this.observe('DROP DATABASE ' + identifier(this.database));
        expect(await this.observe('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [this.database])).toEqual([]);
      }
      for (const [path, bytes] of this.files) { expect(await readFile(path)).toEqual(bytes); await unlink(path); }
      if (this.directory) await rmdir(this.directory);
      console.log(JSON.stringify({ 专项: 'SQL文件导入', 阶段: '收尾', 数据库: this.database, owner: this.marker, 线程: this.facts.map(fact => ({ id: fact.id, closed: fact.closed, commands: fact.commands.length, terminal: fact.commands.every(command => command.ended) })), 文件流: this.streams.map(fact => ({ closed: fact.closed, chunks: fact.chunks })), 线程残留: 0, 库残留: 0 }));
    } catch (error) { failed = true; failure = error; console.log(JSON.stringify({ 专项: 'SQL文件导入', 阶段: '保留现场', 数据库: this.database, owner: this.marker, 临时目录: this.directory, 线程: this.facts.map(fact => ({ id: fact.id, closed: fact.closed, pending: fact.commands.filter(command => !command.ended).length })), 自动重跑: false })); }
    try { if (this.observer) await this.observer.close({ strict: true }); }
    catch (closing) { if (failed) throw new AggregateError([failure, closing], '原SQL文件验收收尾及观察连接关闭未确认', { cause: failure }); throw closing; }
    finally { streams.watch = undefined; this.restore?.(); }
    if (failed) throw failure;
  }
}

/** 回执必须由真实Engine返回且通过公开schema，不从日志自行拼接。 */
function receipt(result: FileImportResult): SqlFileImportReceipt { return sqlFileImportReceiptSchema.parse(result.sql); }

describe.skipIf(!enabled)('SQL文件导入：六实例原Engine专项（默认关闭）', () => {
  it('三编码、跨块DELIMITER、精确失败位置、提交与回滚及真实取消', async () => {
    const owner = new Fixture(); let failed = false, failure: unknown;
    try {
      await owner.start();
      for (const [index, encoding] of (['utf8', 'utf16le', 'gb18030'] as const).entries()) {
        const note = '编码中文😀-' + encoding, id = index + 1;
        const result = await owner.run('encoding-' + encoding, `INSERT INTO subject VALUES(${id},'${note}');\r\nSELECT '${note}';\r\n`, encoding, encoding !== 'gb18030');
        expect(receipt(result)).toMatchObject({ encoding, positionBasis: 'decoded-utf16', termination: 'completed', completedStatements: 2, serverReportedAffectedRows: 1, rollback: { state: 'not-needed' }, transaction: 'closed' });
        expect(result.errors).toEqual([]);
        expect(await owner.observe('SELECT note FROM ' + owner.table('subject') + ' WHERE id=?', [id])).toEqual([{ note }]);
      }
      const procedure = 'DELIMITER $$\r\nCREATE PROCEDURE import_chunk() BEGIN\r\n/*' + '跨块'.repeat(70000) + "*/\r\nINSERT INTO subject VALUES(10,'DELIMITER跨块😀');\r\nEND$$\r\nDELIMITER ;\r\nCALL import_chunk();\r\n";
      const large = await owner.run('delimiter-cross-chunk', procedure, 'utf8');
      expect(receipt(large)).toMatchObject({ termination: 'completed', completedStatements: 2 });
      expect(owner.streams.at(-1)!.chunks).toBeGreaterThan(1);
      expect(await owner.observe('SELECT note FROM ' + owner.table('subject') + ' WHERE id=10')).toEqual([{ note: 'DELIMITER跨块😀' }]);

      const duplicate = "INSERT INTO subject VALUES(20,'重复😀')", source = duplicate + ';\r\n' + duplicate + ";\r\nINSERT INTO subject VALUES(21,'失败尾部不得执行');\r\n";
      const repeated = receipt(await owner.run('duplicate-position', source, 'utf16le', true));
      expect(repeated).toMatchObject({ termination: 'failed', completedStatements: 1, serverReportedAffectedRows: 1, failure: { phase: 'execute', statement: { ordinal: 2, location: location(source, duplicate.length + 3, duplicate.length * 2 + 3) } }, transaction: 'closed' });
      expect(await owner.observe('SELECT id FROM ' + owner.table('subject') + ' WHERE id IN(20,21) ORDER BY id')).toEqual([{ id: 20 }]);
      expect(owner.facts.flatMap(fact => fact.commands).filter(command => command.sql === duplicate)).toHaveLength(2);
      expect(owner.facts.flatMap(fact => fact.commands).filter(command => command.sql === duplicate).at(-1)).toMatchObject({ errno: 1062, ended: true });

      const txText = "START TRANSACTION;\r\nINSERT INTO uncommitted VALUES(1,'尾事务');\r\n";
      const tx = receipt(await owner.run('open-transaction', txText, 'gb18030'));
      expect(tx).toMatchObject({ termination: 'failed', completedStatements: 2, serverReportedAffectedRows: 1, failure: { phase: 'finalize' }, rollback: { state: 'confirmed' }, transaction: 'closed' });
      expect(tx.failure?.statement).toBeUndefined();
      expect(await owner.observe('SELECT * FROM ' + owner.table('uncommitted'))).toEqual([]);

      const inTx = "INSERT INTO subject VALUES(30,'先提交');\r\nSTART TRANSACTION;\r\nINSERT INTO uncommitted VALUES(2,'失败时回滚');\r\n";
      const bad = 'INSERT INTO missing_import_table VALUES(1)', failureText = inTx + bad + ";\r\nINSERT INTO subject VALUES(31,'失败尾部');";
      const stopped = receipt(await owner.run('server-error-in-tx', failureText, 'utf8'));
      expect(stopped).toMatchObject({ termination: 'failed', completedStatements: 3, serverReportedAffectedRows: 2, failure: { phase: 'execute', statement: { ordinal: 4, location: location(failureText, inTx.length, inTx.length + bad.length) } }, rollback: { state: 'confirmed' }, transaction: 'closed' });
      expect(await owner.observe('SELECT id FROM ' + owner.table('subject') + ' WHERE id IN(30,31) ORDER BY id')).toEqual([{ id: 30 }]);
      expect(await owner.observe('SELECT * FROM ' + owner.table('uncommitted'))).toEqual([]);
      expect(owner.facts.flatMap(fact => fact.commands).some(command => command.sql === 'ROLLBACK' && command.ended)).toBe(true);

      // SLEEP-only被中断可能正常ACK；此固定查询已独立在六实例证明返回ERR1317。
      const cancelStatement = 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=CONNECTION_ID() AND SLEEP(15)=0';
      const taskId = randomUUID(), pending = owner.run('real-cancel', "INSERT INTO subject VALUES(40,'取消前提交');\r\nSTART TRANSACTION;\r\nINSERT INTO uncommitted VALUES(3,'取消回滚');\r\n" + cancelStatement + ";\r\nINSERT INTO subject VALUES(41,'取消尾部');", 'utf8', false, taskId);
      void pending.catch(() => undefined); // 原Promise仍在后面等待，旁听只避免准备失败成为未处理拒绝。
      let sleepId = 0;
      await vi.waitFor(async () => { const fact = owner.facts.find(value => value.commands.some(command => command.sql === cancelStatement && !command.ended)); expect(fact).toBeDefined(); sleepId = fact!.id; expect(await owner.observe('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=? AND INFO=?', [sleepId, cancelStatement])).toHaveLength(1); }, { timeout: 5000, interval: 50 });
      await owner.invoke('query.cancel', { taskId }); const cancelled = receipt(await pending);
      expect(cancelled).toMatchObject({ taskId, termination: 'cancelled', completedStatements: 3, serverReportedAffectedRows: 2, failure: { phase: 'execute', statement: { ordinal: 4 } }, rollback: { state: 'confirmed' }, transaction: 'closed' });
      expect(owner.events.filter(event => event.taskId === taskId && event.status === 'cancelled')).toHaveLength(1);
      expect(owner.facts.flatMap(fact => fact.commands).filter(command => command.sql === "INSERT INTO subject VALUES(41,'取消尾部')")).toEqual([]);
      expect(await owner.observe('SELECT id FROM ' + owner.table('subject') + ' WHERE id IN(40,41) ORDER BY id')).toEqual([{ id: 40 }]);
      expect(await owner.observe('SELECT * FROM ' + owner.table('uncommitted'))).toEqual([]);
      console.log(JSON.stringify({ 专项: 'SQL文件导入', 阶段: '功能事实', 数据库: owner.database, 取消线程: sleepId, 回执: [repeated, tx, stopped, cancelled], 未验: ['真实网络ACK丢失', '真实ROLLBACK失败', 'Main文件授权', 'GUI', '安装包', 'macOS'] }));
    } catch (error) { failed = true; failure = error; }
    try { await owner.finish(); } catch (cleanup) { if (failed) throw new AggregateError([failure, cleanup], '原SQL文件专项失败且资源收尾未确认', { cause: failure }); throw cleanup; }
    if (failed) throw failure;
  }, 120000);
});
