import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { DatabaseCreateGetOutput, DatabaseCreatePreviewOutput } from '../../src/shared/databaseCreate';
import { databaseCreateAcknowledgements, validateDatabaseCreateName } from '../../src/shared/databaseCreate';
import { validateCommand } from '../../src/shared/validation';
const driver = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: driver.connect, execute: driver.execute }));
import { Engine } from '../../src/engine';
const profile: ConnectionProfile = { id: 'create-unit', name: '离线新建库', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'unit' };
let engine: Engine, events: TaskEvent[], sent: string[], connections: ManagedConnection[], next: number, version: string, dialect: 'mysql' | 'mariadb';
let uuid: string, mode: string, lowerNames: number, closeFails: boolean, fail: RegExp | undefined, hold: RegExp | undefined, fullNames: boolean;
let catalog: { charset: string; collation: string; compiled: string }[], database: { name: string; charset: string; collation: string } | undefined;
let held: { complete(error?: Error): void } | undefined, afterMismatch: boolean;
let injectedUnknownClose = false;
/** 仅替换驱动，实际Engine、短任务、目录、令牌、SQL和取消收尾执行产品代码。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), id = ++next;
  const value = { connection, signal, profile, status: { version, dialect, connectionId: id }, broken: false, close: vi.fn(async () => { if (closeFails) { injectedUnknownClose = true; throw Error('关闭失败'); } }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId: id, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push(sql);
    const complete = (error?: Error) => queueMicrotask(() => {
      if (error || fail?.test(sql)) { callback(error ?? Error('驱动拒绝')); return; }
      let rows: unknown;
      if (sql.startsWith('SELECT @@hostname')) rows = [{ hostname: 'unit', port: 3306, serverId: 7, currentUser: 'unit@host', sqlMode: mode, lowerNames }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME')) rows = structuredClone(catalog);
      else if (sql.includes("TABLE_NAME='COLLATION_CHARACTER_SET_APPLICABILITY'")) rows = (fullNames ? ['COLLATION_NAME', 'CHARACTER_SET_NAME', 'FULL_COLLATION_NAME'] : []).map(name => ({ name }));
      else if (sql.startsWith('SELECT a.CHARACTER_SET_NAME')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_uca1400_ai_ci', compiled: 'Yes' }];
      else if (sql.startsWith('SELECT SCHEMA_NAME')) rows = database ? [{ ...database, ...(afterMismatch ? { collation: 'unknown_alias' } : {}) }] : [];
      else if (sql.startsWith('CREATE DATABASE')) { database = { name: '新`库', charset: 'utf8mb4', collation: 'utf8mb4_bin' }; rows = { affectedRows: 1, warningStatus: 0 }; }
      else throw Error('测试未声明SQL：' + sql);
      callback(null, rows, []);
    });
    if (hold?.test(sql)) held = { complete }; else complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(value); return value;
}
async function get(revision = 1): Promise<DatabaseCreateGetOutput> { return engine.handle('schema.databaseCreate.get', { connectionId: profile.id, taskId: 'get-' + next, connectionRevision: revision }); }
async function preview(snapshot: DatabaseCreateGetOutput, name = '新`库', pair = { charset: 'utf8mb4', collation: 'utf8mb4_bin' }): Promise<DatabaseCreatePreviewOutput> { return engine.handle('schema.databaseCreate.preview', { snapshotId: snapshot.snapshotId, name, ...pair, taskId: 'preview-' + next, connectionRevision: 1 }); }
async function apply(value: DatabaseCreatePreviewOutput, taskId = 'apply', revision = 1, confirmation = value.name, acknowledgements: string[] = [...databaseCreateAcknowledgements]) { return engine.handle('schema.databaseCreate.apply', { previewToken: value.previewToken, confirmation, acknowledgements, taskId, connectionRevision: revision }); }
beforeEach(async () => {
  injectedUnknownClose = false;
  events = []; sent = []; connections = []; next = 0; version = '8.4.11'; dialect = 'mysql'; uuid = 'server-1'; mode = ''; lowerNames = 0; closeFails = false; fail = hold = held = undefined; database = undefined; fullNames = false; afterMismatch = false;
  catalog = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin', compiled: 'Yes' }, { charset: 'latin1', collation: 'latin1_bin', compiled: 'Yes' }];
  driver.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal));
  driver.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Error('取消终态')); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => {
  closeFails = false; hold = undefined; held?.complete(Error('测试收尾'));
  // 此旧RAM端口没有资源facade；注入关闭未知后，恢复开关不能替代物理终态证明。
  if (injectedUnknownClose) await expect(engine.closeAll()).rejects.toThrow('资源未确认释放'); else await engine.closeAll();
  vi.useRealTimers();
});
describe('新建库实际Engine生命周期的离线驱动边界', () => {
  it('无默认库即可读真实配对；预览零写，单条创建、后核验和令牌消费', async () => {
    expect(profile.database).toBeUndefined(); const snapshot = await get(), value = await preview(snapshot);
    expect(snapshot.writable).toBe(true); expect(value.sql).toBe('CREATE DATABASE `新``库` CHARACTER SET `utf8mb4` COLLATE `utf8mb4_bin`;');
    expect(sent.some(sql => /^(CREATE|ALTER|DROP|USE)/.test(sql))).toBe(false);
    expect(await apply(value)).toMatchObject({ name: '新`库', ddlCompleted: true, definitionVerified: true });
    expect(sent.filter(sql => sql.startsWith('CREATE'))).toHaveLength(1); expect(sent.some(sql => /^(ALTER|DROP|USE)/.test(sql))).toBe(false);
    expect(events.at(-1)?.databaseCreate).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true });
    expect(events.every(event => !event.columnPatch)).toBe(true);
    await expect(apply(value, 'replay')).rejects.toThrow('失效'); expect(connections.every(value => vi.mocked(value.close).mock.calls.length === 1)).toBe(true);
  });
  it.each(['目录', '身份', '模式', '修订', '同名'])('%s变化在发送前拒绝并消费旧令牌', async kind => {
    const value = await preview(await get());
    if (kind === '目录') catalog.push({ charset: 'utf8mb4', collation: 'utf8mb4_general_ci', compiled: 'Yes' });
    if (kind === '身份') uuid = 'other-server'; if (kind === '模式') mode = 'NO_BACKSLASH_ESCAPES';
    if (kind === '同名') database = { name: value.name, ...value.selection };
    await expect(apply(value, 'apply', kind === '修订' ? 2 : 1)).rejects.toThrow();
    expect(sent.filter(sql => sql.startsWith('CREATE'))).toHaveLength(0); await expect(apply(value, 'replay')).rejects.toThrow('失效');
  });
  it('目录截断或未知版本只读；不存在及跨字符集配对不能预览', async () => {
    const first = await get(); await expect(preview(first, 'db', { charset: 'latin1', collation: 'utf8mb4_bin' })).rejects.toThrow('配对');
    version = '9.0.1'; expect(await get()).toMatchObject({ writable: false }); version = '8.4.11';
    catalog = Array.from({ length: 8193 }, () => catalog[0]); const truncated = await get(); expect(truncated).toMatchObject({ writable: false, candidates: [] });
    await expect(preview(truncated)).rejects.toThrow('未证明');
  });
  it('Maria实际完整别名才可选择；歧义名称被排除，不猜字符集', async () => {
    version = '11.4.13-MariaDB'; dialect = 'mariadb'; fullNames = true;
    catalog.push({ charset: 'latin1', collation: 'ambiguous', compiled: 'Yes' }, { charset: 'utf8mb4', collation: 'ambiguous', compiled: 'Yes' });
    const value = await get(); expect(value.candidates).toContainEqual({ charset: 'utf8mb4', collation: 'utf8mb4_uca1400_ai_ci' });
    expect(value.candidates.some(pair => pair.collation === 'ambiguous')).toBe(false); expect(value.warnings.join('')).toContain('排除');
  });
  it.each(['5.7.44', '8.0.46', '8.4.11', '10.11.19-MariaDB', '11.4.13-MariaDB'])('声明支持版本%s只按实际目录生成显式配对，不在读取或预览时写入', async actualVersion => {
    version = actualVersion; dialect = actualVersion.includes('MariaDB') ? 'mariadb' : 'mysql'; const value = await preview(await get());
    expect(value.sql).toContain('CHARACTER SET `utf8mb4` COLLATE `utf8mb4_bin`'); expect(sent.some(sql => /^(CREATE|ALTER|DROP)/.test(sql))).toBe(false);
  });
  it.each(['错误名称', '缺少确认', '重复确认'])('%s消费令牌且不建立执行连接', async kind => {
    const value = await preview(await get()), count = connections.length;
    await expect(apply(value, 'apply', 1, kind === '错误名称' ? value.name + ' ' : value.name, kind === '缺少确认' ? [] : kind === '重复确认' ? ['create-database', 'create-database'] : [...databaseCreateAcknowledgements])).rejects.toThrow('确认');
    expect(connections).toHaveLength(count); await expect(apply(value, 'replay')).rejects.toThrow('失效');
  });
  it('同连接同名并发只投递一条，第二令牌不会在收尾后重用', async () => {
    const snapshot = await get(), first = await preview(snapshot), second = await preview(snapshot); hold = /^CREATE DATABASE/;
    const pending = apply(first); await vi.waitFor(() => expect(held).toBeDefined());
    await expect(apply(second, 'parallel')).rejects.toThrow('正在创建'); held!.complete(); await pending;
    await expect(apply(second, 'retry')).rejects.toThrow('失效'); expect(sent.filter(sql => sql.startsWith('CREATE'))).toHaveLength(1);
  });
  it('目录读取失败不能默认为可写；准备时释放快照使迟到预览失效', async () => {
    fail = /^SELECT c.CHARACTER_SET_NAME/; expect(await get()).toMatchObject({ writable: false, candidates: [] }); fail = undefined;
    const snapshot = await get(); hold = /^SELECT SCHEMA_NAME/; const pending = preview(snapshot);
    await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('schema.databaseCreate.release', { snapshotId: snapshot.snapshotId }); held!.complete();
    await expect(pending).rejects.toThrow('释放');
  });
  it('取消已投递创建保持unknown，旧令牌不重放', async () => {
    const value = await preview(await get()); hold = /^CREATE DATABASE/; const pending = apply(value).catch(error => error);
    await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId: 'apply' }); expect(await pending).toBeInstanceOf(Error);
    expect(events.at(-1)).toMatchObject({ status: 'cancelled', databaseCreate: { ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' } });
    await expect(apply(value, 'again')).rejects.toThrow('失效'); expect(sent.filter(sql => sql.startsWith('CREATE'))).toHaveLength(1);
  });
  it('DDL完成后目录别名无法精确核验仍保留完成事实；关闭失败不重放', async () => {
    const value = await preview(await get()); hold = /^CREATE DATABASE/; const pending = apply(value);
    await vi.waitFor(() => expect(held).toBeDefined()); afterMismatch = true; held!.complete();
    expect(await pending).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    database = undefined; afterMismatch = false; hold = undefined; const next = await preview(await get()); closeFails = true;
    await expect(apply(next, 'close-fail')).rejects.toThrow('关闭'); expect(events.at(-1)?.databaseCreate).toMatchObject({ ddlCompleted: true });
    await expect(apply(next, 'again')).rejects.toThrow('失效');
  });
  it.each(['', 'mysql', 'SYS', 'a/b', 'a\\b', 'a.b', '尾空白 ', '\u0000', '😀', 'a'.repeat(65)])('名称%j在纯边界拒绝', name => { expect(() => validateDatabaseCreateName(name)).toThrow(); });
  it('IPC拒绝客户端SQL、修订、伪目标和未知确认项', () => {
    expect(() => validateCommand('schema.databaseCreate.get', { connectionId: 'c', taskId: 't', connectionRevision: 1 })).toThrow();
    expect(() => validateCommand('schema.databaseCreate.preview', { snapshotId: 's', name: 'db', charset: 'utf8mb4', collation: 'utf8mb4_bin', taskId: 't', sql: 'DROP DATABASE x' })).toThrow();
    expect(() => validateCommand('schema.databaseCreate.apply', { previewToken: 'p', confirmation: 'db', acknowledgements: ['unknown'], taskId: 't', connectionId: 'other' })).toThrow();
  });
});
