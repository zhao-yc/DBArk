import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReadStream } from 'node:fs';
import type { ResultSetHeader } from 'mysql2';
import { expect, vi } from 'vitest';
import { Engine } from '../../src/engine';
import * as driver from '../../src/engine/connection';
import { execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier } from '../../src/engine/sql';
import type { Command, CommandMap, ConnectionProfile, DataRow, TaskEvent } from '../../src/shared/contracts';
import { fileImportConflictReportSchema, fileImportKeyCatalogSchema, type FileImportConflictSelection } from '../../src/shared/fileImportConflict';
import type { FileImportResult } from '../../src/shared/sqlFileImport';
import { observeConflictExecuteCall } from './fileImportConflictDriverObservation';

export interface ConflictCommand { sql: string; protocol: 'query' | 'execute'; ended: boolean; errno?: number; warningStatus?: number; }
export interface ConflictConnection { managed: ManagedConnection; id: number; scope: string; closed: boolean; commands: ConflictCommand[]; }
/** 每次只消费外部注入的标准连接；双门未开时调用方不会实例化或读取凭据。 */
export function conflictProfile(): ConnectionProfile {
  const host = process.env.DBARK_TEST_HOST ?? '', port = Number(process.env.DBARK_TEST_PORT), tls = process.env.DBARK_TEST_TLS === '1';
  if (!['192.168.31.200', 'deve-server.yinzon.com'].includes(host) || ![13357, 13380, 13384, 13310, 13311, 13484].includes(port) || !process.env.DBARK_TEST_USER) throw Error('冲突导入仅限200六个既有隔离实例');
  if (port === 13484 && (!tls || !process.env.DBARK_TEST_CA)) throw Error('13484必须保留原严格TLS及CA');
  return { id: randomUUID(), name: 'CSVJSON冲突导入专项', group: '隔离验收', color: '#53c9ae', dialect: 'mysql', host, port, user: process.env.DBARK_TEST_USER, password: process.env.DBARK_TEST_PASSWORD ?? '', ...(tls ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
}

/** 期望文件独立编码，不借产品导出器或数值转换器；JSON数字保留原十进制token。 */
export function conflictFile(rows: DataRow[], columns: string[], format: 'csv' | 'json'): string {
  if (format === 'json') return '[' + rows.map(row => '{' + columns.map(name => JSON.stringify(name) + ':' + (['amount', 'n'].includes(name) && typeof row[name] === 'string' ? row[name] : JSON.stringify(row[name]))).join(',') + '}').join(',\n') + ']';
  const field = (raw: unknown) => { const value = raw === null ? '\\N' : raw && typeof raw === 'object' && 'base64' in raw ? 'base64:' + (raw as { base64: string }).base64 : String(raw); return /[,"\r\n]/.test(value) || value === '' ? '"' + value.replaceAll('"', '""') + '"' : value; };
  return columns.join(',') + '\r\n' + rows.map(row => columns.map(name => field(row[name])).join(',')).join('\r\n') + '\r\n';
}

/** 每例独占随机库、原连接、输入文件和审计；只旁听驱动，不替换SQL/ACK或暂停产品Promise。 */
export class ConflictFixture {
  readonly profile = conflictProfile();
  readonly database = 'dbark_importconflict_' + randomUUID().replaceAll('-', '');
  readonly marker = randomUUID();
  readonly facts: ConflictConnection[] = [];
  readonly events: TaskEvent[] = [];
  readonly engine = new Engine(event => this.events.push(event));
  readonly pending = new Set<Promise<unknown>>();
  readonly files = new Map<string, Buffer>();
  readonly fileStreams: { stream: ReadStream; closed: boolean; chunks: number }[] = [];
  readonly actors: ManagedConnection[] = [];
  observer?: ManagedConnection;
  directory = ''; created = false; marked = false; scope = 'init';
  onCommandEnd?: (fact: ConflictConnection, command: ConflictCommand) => void;
  configure?: (managed: ManagedConnection, scope: string) => Promise<void>;
  private restore?: () => void;
  private readonly commands = new WeakMap<ConflictCommand, object>();
  private readonly serverErrors = new WeakSet<ConflictCommand>();

  /** 先核外部预认hostname/UUID，CREATE发送前即登记“可能创建”，未知owner绝不强清。 */
  async start() {
    this.observer = await driver.connect(this.profile);
    if (!process.env.DBARK_TEST_EXPECTED_HOSTNAME) throw Error('缺少已预核hostname，未建库');
    const identity = (await this.sql('SELECT @@hostname AS hostname,VERSION() AS version,CONNECTION_ID() AS id'))[0];
    expect(identity.hostname).toBe(process.env.DBARK_TEST_EXPECTED_HOSTNAME); expect(Number(identity.id)).toBe(this.observer.connection.threadId);
    if (this.observer.status.dialect === 'mysql') { if (!process.env.DBARK_TEST_EXPECTED_UUID) throw Error('缺少MySQL已预核UUID'); expect((await this.sql('SELECT @@server_uuid AS uuid'))[0].uuid).toBe(process.env.DBARK_TEST_EXPECTED_UUID); }
    console.log(JSON.stringify({ 专项: '冲突导入', 阶段: '原资源', 数据库: this.database, owner: this.marker, 观察线程: identity.id, 端口: this.profile.port, 版本: identity.version }));
    this.created = true; await this.sql('CREATE DATABASE ' + identifier(this.database) + ' CHARACTER SET utf8mb4');
    await this.sql('CREATE TABLE ' + this.table('__owner') + ' (token VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB');
    await this.sql('INSERT INTO ' + this.table('__owner') + ' VALUES (?)', [this.marker]); this.marked = true;
    this.directory = await mkdtemp(join(tmpdir(), 'dbark-importconflict-'));
    const original = driver.connect, originalExecute = driver.execute;
    const fixture = this;
    const executeSpy = vi.spyOn(driver, 'execute').mockImplementation(observeConflictExecuteCall(originalExecute, args => {
      const managed = args[0], fact = fixture.facts.find(fact => fact.managed === managed);
      if (!fact) return;
      const offset = fact.commands.length;
      return () => {
        const created = fact.commands.slice(offset);
        if (created.length !== 1) return;
        const command = created[0], actual = fixture.commands.get(command);
        if (!actual) return;
        return { command: actual, serverErrorObserved: () => fixture.serverErrors.has(command), recordErrno: errno => { command.errno = errno; } };
      };
    }));
    const spy = vi.spyOn(driver, 'connect').mockImplementation(async (...args) => {
      const scope = this.scope, managed = await original(...args), native = managed.connection;
      const socket = (native as unknown as { stream: { closed: boolean; once(name: string, listener: () => void): void } }).stream;
      if (!Number.isSafeInteger(native.threadId) || !socket) { await managed.close({ strict: true }); throw Error('原冲突导入连接未知'); }
      const fact: ConflictConnection = { managed, id: native.threadId!, scope, closed: socket.closed === true, commands: [] }; this.facts.push(fact);
      const fixture = this;
      socket.once('close', () => { fact.closed = true; });
      const originals = { query: native.query, execute: native.execute };
      /** 只包装原公开Query/Execute端口，不接触Execute内部Prepare，也不包装或替换原callback。 */
      const observe = (protocol: 'query' | 'execute') => function (this: typeof native, ...args: unknown[]) {
        if (this !== native || native.threadId !== fact.id) throw Error('冲突导入物理线程变化');
        const first = args[0], sql = typeof first === 'string' ? first : (first as { sql?: unknown })?.sql;
        if (typeof sql !== 'string') throw Error('冲突导入未识别SQL形状');
        const command: ConflictCommand = { sql, protocol, ended: false }; fact.commands.push(command);
        // callback模式不发普通result，警告只采原补丁已发出的对应SQL协议小事实。
        let result: ReturnType<typeof native.query> | undefined;
        const current = () => result !== undefined && (native as unknown as { _command?: unknown })._command === result;
        const state = (packet: { sql?: string; warningStatus?: number }) => { if (current() && packet.sql === sql && Number.isInteger(packet.warningStatus)) command.warningStatus = packet.warningStatus; };
        const sessionError = () => { if (current()) fixture.serverErrors.add(command); };
        const failure = (error: { errno?: number }) => { if (fixture.serverErrors.has(command) && Number.isSafeInteger(error?.errno) && error.errno! > 0) command.errno = error.errno; };
        native.on('dbark:session-state', state);
        native.on('dbark:session-error', sessionError);
        try { result = Reflect.apply(originals[protocol], this, args); }
        catch (error) { native.removeListener('dbark:session-state', state); native.removeListener('dbark:session-error', sessionError); throw error; }
        const actual = result!; fixture.commands.set(command, actual);
        actual.on('result', (packet: { warningStatus?: number }) => { if (packet && typeof packet.warningStatus === 'number') command.warningStatus = packet.warningStatus; });
        actual.once('error', failure);
        actual.once('end', () => { native.removeListener('dbark:session-state', state); native.removeListener('dbark:session-error', sessionError); command.ended = true; fixture.onCommandEnd?.(fact, command); });
        return actual;
      };
      native.query = observe('query') as typeof native.query; native.execute = observe('execute') as typeof native.execute;
      await this.configure?.(managed, scope); return managed;
    });
    this.restore = () => { spy.mockRestore(); executeSpy.mockRestore(); };
    await this.invoke('connections.open', { id: this.profile.id, profile: this.profile } as never, 'profile');
  }
  /** 表名只来自本专项内部计划。 */
  table(name: string) { if (!/^[a-z][a-z0-9_]*$|^__owner$/.test(name)) throw Error('专项表名无效'); return identifier(this.database) + '.' + identifier(name); }
  /** 观察者允许DDL/DML ACK；行断言才要求数组，不对Header调用map。 */
  async sql(statement: string, values: (string | number | boolean | null | Buffer)[] = [], managed = this.observer!): Promise<Record<string, unknown>[]> {
    const result = await execute<unknown>(managed, statement, values);
    if (Array.isArray(result.rows)) return result.rows;
    const header = result.rows as { fieldCount: number; affectedRows: number; serverStatus: number; warningStatus: number };
    expect(header && typeof header === 'object' && header.fieldCount === 0).toBe(true);
    expect(Number.isSafeInteger(header.affectedRows) && header.affectedRows >= 0).toBe(true);
    expect(Number.isInteger(header.serverStatus) && header.serverStatus >= 0 && header.serverStatus <= 65535).toBe(true);
    expect(header.warningStatus).toBe(0); return [];
  }
  /** 仅准备非严格告警探针：5.7.44改变旧模式会产生已实测的3090弃用警告，不放宽普通SQL或产品DML门。 */
  async setNonStrictProbeMode(managed: ManagedConnection): Promise<void> {
    const { rows: header } = await execute<ResultSetHeader>(managed, "SET SESSION sql_mode=''");
    expect(header && !Array.isArray(header) && header.fieldCount === 0).toBe(true);
    expect(header.affectedRows).toBe(0); expect(header.insertId).toBe(0);
    expect(Number.isInteger(header.serverStatus) && header.serverStatus >= 0 && header.serverStatus <= 65535 && !(header.serverStatus & 1)).toBe(true);
    const diagnostics = await this.sql('SHOW WARNINGS LIMIT 2', [], managed);
    if (header.warningStatus === 0) expect(diagnostics).toEqual([]);
    else {
      expect(managed.status.dialect).toBe('mysql'); expect(managed.status.version).toBe('5.7.44');
      expect(header.warningStatus).toBe(1); expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].Level).toBe('Warning'); expect([3090, '3090']).toContain(diagnostics[0].Code);
      expect(diagnostics[0].Message).toBe("Changing sql mode 'NO_AUTO_CREATE_USER' is deprecated. It will be removed in a future release.");
    }
    expect(await this.sql('SELECT @@SESSION.sql_mode AS mode', [], managed)).toEqual([{ mode: '' }]);
    console.log(JSON.stringify({ 专项: '冲突告警探针准备', 端口: this.profile.port, 版本: managed.status.version, warningStatus: header.warningStatus, 诊断代码: diagnostics.map(row => row.Code), 会话模式已确认空: true }));
  }
  /** 原RPC仍返回原Promise，所有在途任务在清理前结算。 */
  invoke<C extends Command>(command: C, input: CommandMap[C]['input'], scope = command as string): Promise<CommandMap[C]['output']> {
    this.scope = scope; const value = this.engine.handle(command, input as Record<string, unknown>) as Promise<CommandMap[C]['output']>;
    this.pending.add(value); void value.then(() => this.pending.delete(value), () => this.pending.delete(value)); return value;
  }
  /** actor仍使用既有账号及已核同一实例，禁止隐式新用户或新目标。 */
  async actor(scope: string) { this.scope = scope; const managed = await driver.connect(this.profile); this.actors.push(managed); return managed; }
  /** 每份新文件独立选择一次；不得自动重放失败文件。 */
  async run(name: string, table: string, rows: DataRow[], columns: string[], format: 'csv' | 'json', conflict?: FileImportConflictSelection, transactionMode: 'batch' | 'atomic' = 'atomic', taskId = randomUUID()): Promise<FileImportResult> {
    const path = join(this.directory, name + '.' + format), bytes = Buffer.from(conflictFile(rows, columns, format), 'utf8'); this.files.set(path, bytes); await writeFile(path, bytes, { flag: 'wx' });
    return this.invoke('files.import', { connectionId: this.profile.id, database: this.database, table, filePath: path, fileToken: randomUUID(), format, encoding: 'utf8', mapping: Object.fromEntries(columns.map(column => [column, column])), taskId, transactionMode, ...(conflict ? { conflict } : {}) } as CommandMap['files.import']['input'], name);
  }
  /** 目录来自真实只读新API，匹配键必须由测试显式点名，不自动降级选别的键。 */
  async key(table: string, mode: FileImportConflictSelection['mode'], name = 'PRIMARY'): Promise<FileImportConflictSelection> {
    const catalog = fileImportKeyCatalogSchema.parse(await this.invoke('files.importKeys', { connectionId: this.profile.id, database: this.database, table, taskId: randomUUID() }, 'catalog-' + table));
    const key = catalog.keys.find(key => key.name === name); expect(key?.reliable).toBe(true);
    return { mode, schemaHash: catalog.schemaHash, key: { name: key!.name, columns: [...key!.columns] } };
  }
  /** 原文件close也必须可核对，调用方的vi.mock仅旁听这些已登记输入。 */
  watch(path: unknown, stream: ReadStream) { if (typeof path !== 'string' || !this.files.has(path)) throw Error('读取未登记冲突文件'); const fact = { stream, closed: false, chunks: 0 }; this.fileStreams.push(fact); stream.on('data', () => { fact.chunks++; }); stream.once('close', () => { fact.closed = true; }); }
  /** 不把原请求未知终态当成清理授权，先关闭原连接再核owner精确DROP。 */
  async finish() {
    let failure: unknown;
    try {
      await Promise.allSettled([...this.pending]); await this.engine.closeAll();
      for (const actor of this.actors) await actor.close({ strict: true });
      await vi.waitFor(() => expect(this.facts.every(fact => fact.closed && fact.commands.every(command => command.ended))).toBe(true), { timeout: 5000, interval: 50 });
      await vi.waitFor(() => expect(this.fileStreams.every(fact => fact.closed && fact.stream.closed)).toBe(true), { timeout: 5000, interval: 50 });
      for (const fact of this.facts) expect(await this.sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [fact.id])).toEqual([]);
      if (this.created) {
        if (!this.marked || !/^dbark_importconflict_[a-f0-9]{32}$/.test(this.database)) throw Error('原冲突库owner未知，保留现场');
        expect(await this.sql('SELECT token FROM ' + this.table('__owner'))).toEqual([{ token: this.marker }]);
        expect(await this.sql('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=?', [this.database])).toEqual([]);
        await this.sql('SET SESSION lock_wait_timeout=5'); await this.sql('DROP DATABASE ' + identifier(this.database));
        expect(await this.sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [this.database])).toEqual([]);
      }
      for (const [path, bytes] of this.files) { expect(await readFile(path)).toEqual(bytes); await unlink(path); } if (this.directory) await rmdir(this.directory);
      console.log(JSON.stringify({ 专项: '冲突导入', 阶段: '收尾', 数据库: this.database, owner: this.marker, 线程: this.facts.map(fact => ({ id: fact.id, scope: fact.scope, closed: fact.closed, commandEnd: fact.commands.every(command => command.ended) })), 文件流: this.fileStreams.length, 库残留: 0, 线程残留: 0 }));
    } catch (error) { failure = error; console.log(JSON.stringify({ 专项: '冲突导入', 阶段: '保留', 数据库: this.database, owner: this.marker, 临时目录: this.directory, 线程: this.facts.map(fact => ({ id: fact.id, scope: fact.scope, closed: fact.closed, pending: fact.commands.filter(command => !command.ended).length })), 自动重跑: false })); }
    try { if (this.observer) await this.observer.close({ strict: true }); } catch (closing) { if (failure) throw new AggregateError([failure, closing], '原冲突验收收尾及观察连接关闭未确认', { cause: failure }); throw closing; }
    finally { this.restore?.(); }
    if (failure) throw failure;
  }
}

/** 直接验证真实产品结构化回包，不能从兼容rows推断新增或更新数量。 */
export function conflictReport(result: FileImportResult) { return fileImportConflictReportSchema.parse(result.conflicts); }
