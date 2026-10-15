import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
import { Engine } from '../../src/engine';

const sourceProfile: ConnectionProfile = { id: 'source', name: '源连接', group: '', color: '#123456', dialect: 'mysql', host: 'invalid-source', port: 3306, user: 'test' };
const targetProfile = { ...sourceProfile, id: 'target', host: 'invalid-target' };
const target = (connectionId: string) => ({ connectionId, database: 'db', table: 't' });
let engine: Engine, events: TaskEvent[], connections: ManagedConnection[], sent: string[], nextId: number, hold: string | undefined, closeFails: boolean;
let held: { finish(error?: Error): void; connectionId: number } | undefined;
/** 替换驱动边界，实际执行引擎路由、独立会话、读取双检和复合取消。 */
function managed(profile: ConnectionProfile, signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++nextId;
  let quoted = 0, mode = '', charset = 'latin1', collation = 'latin1_swedish_ci';
  const definition = `CREATE TABLE \`t\` (\`id\` int${profile.id === 'source' ? ',`extra` int' : ''}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`;
  const value = { profile, connection, signal, broken: false, status: { dialect: 'mysql', version: '8.4.11' }, close: vi.fn(async () => { if (closeFails) throw new Error('测试关闭失败'); }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push(sql);
    const finish = (error?: Error) => queueMicrotask(() => {
      if (error) { callback(error); return; }
      let rows: unknown = [];
      if (sql.includes('@@hostname')) rows = [{ sqlMode: mode, hostname: profile.host, port: 3306, serverId: 1, currentUser: 'test@host', connectionId: threadId }];
      else if (sql.startsWith('SET SESSION sql_mode')) mode = /'([^']*)'/.exec(sql)![1];
      else if (sql.startsWith('SET SESSION sql_quote')) quoted = 1;
      else if (sql.startsWith('SET NAMES')) { charset = 'utf8mb4'; collation = 'utf8mb4_bin'; }
      else if (sql.includes('AS quoteShowCreate')) rows = [{ sqlMode: mode, quoteShowCreate: quoted, charset, collation }];
      else if (sql.includes('@@server_uuid')) rows = [{ uuid: profile.host }];
      else if (sql.includes(' AS visible')) rows = [{ visible: 1 }];
      else if (sql.startsWith('SHOW CREATE')) rows = [{ 'Create Table': definition }];
      else if (sql.includes('FROM information_schema.TABLES')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.includes('FROM information_schema.COLUMNS')) rows = parseTableColumnDefinition(definition, { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } }).columns.map(column => ({ name: column.name, nullable: 'YES', extra: '', charset: null, collation: null }));
      else if (!sql.startsWith('SET SESSION show_gipk')) { callback(new Error('测试遇到未知 SQL')); return; }
      callback(null, rows, []);
    });
    if (hold === profile.id && sql.startsWith('SHOW CREATE')) held = { finish, connectionId: threadId }; else finish();
  } });
  connections.push(value); return value;
}
const compare = (taskId = 'compare') => engine.handle('schema.compare', { taskId, source: target('source'), target: target('target'), sourceProfile, targetProfile, connectionRevision: 7 });
beforeEach(() => {
  events = []; connections = []; sent = []; nextId = 0; hold = undefined; held = undefined; closeFails = false;
  mocks.connect.mockReset().mockImplementation(async (profile, _database, signal) => managed(profile, signal)); mocks.execute.mockReset().mockResolvedValue({ rows: [] });
  engine = new Engine(event => events.push(event));
});
afterEach(async () => { closeFails = false; hold = undefined; held?.finish(new Error('测试收尾')); await engine.closeAll(); });
describe('结构比较正式引擎路由', () => {
  it('可信双连接读取两遍并逐侧严格关闭，只有公共任务终态且 SQL 不被执行', async () => {
    const result = await compare();
    expect(result.counts.added).toBe(1); expect(connections).toHaveLength(2);
    expect(connections.every(value => vi.mocked(value.close).mock.calls.length === 1)).toBe(true);
    expect(connections.every(value => vi.mocked(value.close).mock.calls[0][0]?.strict)).toBe(true);
    expect(sent.filter(sql => sql.startsWith('SHOW CREATE'))).toHaveLength(4);
    expect(events.map(event => event.status)).toEqual(['running', 'running', 'completed']); expect(events.every(event => event.taskId === 'compare')).toBe(true);
    const preview = await engine.handle('schema.comparePreview', { snapshotId: result.snapshotId, selections: [{ category: 'columns', name: 'extra' }], connectionRevision: 7 });
    expect(preview.sql).toContain('ADD COLUMN `extra` int'); expect(sent.every(sql => !/^(ALTER|DROP|CREATE|INSERT)/.test(sql))).toBe(true);
    await engine.handle('schema.compareRelease', { snapshotId: result.snapshotId });
    await expect(engine.handle('schema.comparePreview', { snapshotId: result.snapshotId, selections: [{ category: 'columns', name: 'extra' }], connectionRevision: 7 })).rejects.toThrow('过期');
  });
  it('取消 ACK 之后继续等原命令终态，不能误报完成或再读取目标', async () => {
    hold = 'source'; const work = compare(); const rejected = expect(work).rejects.toThrow();
    await vi.waitFor(() => expect(held).toBeDefined()); let cancelled = false;
    const cancellation = engine.handle('query.cancel', { taskId: 'compare' }).then(() => { cancelled = true; });
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalled()); expect(cancelled).toBe(false); expect(events.at(-1)?.status).toBe('running');
    held!.finish(Object.assign(new Error('服务器取消终态'), { errno: 1317 })); await cancellation; await rejected;
    expect(events.at(-1)?.status).toBe('cancelled'); expect(connections.every(value => value.profile.id === 'source')).toBe(true);
    expect(connections.every(value => vi.mocked(value.close).mock.calls.length === 1)).toBe(true);
  });
  it('源读取期间同时保护目标配置；关闭目标也会取消源公共任务', async () => {
    hold = 'source'; const work = compare(); const rejected = expect(work).rejects.toThrow();
    await vi.waitFor(() => expect(held).toBeDefined());
    await expect(engine.handle('__connections.prepareSave', { id: 'target', profile: { ...targetProfile, host: 'changed' }, transportChanged: true })).rejects.toThrow('正在执行');
    const close = engine.handle('connections.close', { id: 'target' }); await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalled());
    held!.finish(new Error('服务器关闭终态')); await close; await rejected;
    expect(events.at(-1)?.status).toBe('cancelled');
  });
  it('关闭失败使整个比较失败，不能交付尚未释放的快照', async () => {
    closeFails = true; await expect(compare()).rejects.toThrow('关闭失败');
    expect(events.at(-1)?.status).toBe('failed'); expect(connections).toHaveLength(1);
  });
  it('拒绝不匹配的可信配置，成功快照在连接关闭后失效', async () => {
    await expect(engine.handle('schema.compare', { source: target('source'), target: target('target'), sourceProfile: targetProfile })).rejects.toThrow('有效结构比较'); expect(connections).toEqual([]);
    const result = await compare(); await engine.handle('connections.close', { id: 'target' });
    await expect(engine.handle('schema.comparePreview', { snapshotId: result.snapshotId, selections: [{ category: 'columns', name: 'extra' }], connectionRevision: 7 })).rejects.toThrow('过期');
  });
});
