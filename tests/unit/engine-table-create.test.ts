import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import { tableCreateAcknowledgements, type TableCreateDesign, type TableCreateGetOutput, type TableCreatePreviewOutput } from '../../src/shared/tableCreate';
import { validateCommand } from '../../src/shared/validation';
const driver = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: driver.connect, execute: driver.execute }));
import { Engine } from '../../src/engine';
const profile: ConnectionProfile = { id: 'c', name: '离线新建表', group: '', color: '', dialect: 'mysql', host: 'invalid', port: 3306, user: 'unit' };
const design = (): TableCreateDesign => ({ database: 'db', name: 'new`table', engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: [{ name: 'id', type: 'bigint unsigned', nullable: false, autoIncrement: true, comment: '' }, { name: 'amount', type: 'decimal(30,12)', nullable: false, autoIncrement: false, defaultValue: '123456789012345678.123456789012', comment: '' }], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }, { name: 'uq_amount', unique: true, columns: ['amount'] }], foreignKeys: [] });
let engine: Engine, events: TaskEvent[], sent: string[], connections: ManagedConnection[], sequence: number, uuid: string, mode: string, occupied: boolean, created: boolean, closeFails: boolean, badVerify: boolean, dialect: 'mysql' | 'mariadb', version: string;
let hold: RegExp | undefined, held: { complete(error?: Error): void } | undefined, fail: RegExp | undefined, holdClose: boolean, releaseClose: (() => void) | undefined;
/** 仅替换驱动，真实Engine、任务锁、缓存、SQL与取消/关闭代码均执行产品实现。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), id = ++sequence;
  const value = { connection, signal, profile, status: { version, dialect, connectionId: id }, broken: false, close: vi.fn(async () => { if (holdClose && created) await new Promise<void>(resolve => { releaseClose = resolve; }); if (closeFails) throw Error('合成连接关闭未知'); }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId: id, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push(sql);
    const complete = (error?: Error) => queueMicrotask(() => {
      if (error || fail?.test(sql)) { callback(error ?? Error('合成请求结果未知')); return; }
      let rows: unknown;
      if (sql.startsWith('SELECT @@hostname')) rows = [{ hostname: 'unit', port: 3306, serverId: 7, currentUser: 'unit@host', sqlMode: mode, lowerNames: 0, charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid }];
      else if (sql.startsWith('SELECT SCHEMA_NAME')) rows = [{ name: 'db', charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT TABLE_NAME')) rows = occupied || created ? [{ TABLE_NAME: 'new`table' }] : [];
      else if (sql.startsWith('CREATE TABLE')) { created = true; rows = { affectedRows: 0, warningStatus: 0 }; }
      else if (sql.startsWith('SHOW CREATE TABLE')) rows = [{ 'Create Table': "CREATE TABLE `new``table` (`id` bigint unsigned NOT NULL AUTO_INCREMENT,`amount` decimal(30,12) NOT NULL DEFAULT '123456789012345678.123456789012',PRIMARY KEY (`id`),UNIQUE KEY `uq_amount` (`amount`)) ENGINE=InnoDB" }];
      else if (sql.startsWith('SELECT t.TABLE_NAME')) rows = [{ name: 'new`table', engine: 'InnoDB', charset: 'utf8mb4', comment: '' }];
      else if (sql.startsWith('SELECT COLUMN_NAME')) rows = [{ name: 'id', type: 'bigint unsigned', nullable: 'NO', defaultValue: null, extra: 'auto_increment', comment: '' }, { name: 'amount', type: badVerify ? 'decimal(20,2)' : 'decimal(30,12)', nullable: 'NO', defaultValue: dialect === 'mariadb' ? "'123456789012345678.123456789012'" : '123456789012345678.123456789012', extra: '', comment: '' }];
      else if (sql.startsWith('SELECT INDEX_NAME')) rows = [{ name: 'PRIMARY', nonUnique: 0, column: 'id', sequence: 1 }, { name: 'uq_amount', nonUnique: 0, column: 'amount', sequence: 1 }];
      else { callback(Error('纯测试未声明SQL')); return; }
      callback(null, rows, []);
    });
    if (hold?.test(sql)) held = { complete }; else complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(value); return value;
}
async function get(revision = 1): Promise<TableCreateGetOutput> { return engine.handle('schema.tableCreate.get', { connectionId: 'c', database: 'db', taskId: 'get-' + sequence, connectionRevision: revision }); }
async function preview(snapshot: TableCreateGetOutput, draft = design()): Promise<TableCreatePreviewOutput> { return engine.handle('schema.tableCreate.preview', { snapshotId: snapshot.snapshotId, design: draft, taskId: 'preview-' + sequence, connectionRevision: 1 }); }
async function apply(value: TableCreatePreviewOutput, taskId = 'apply', revision = 1, confirmation = 'db.new`table') { return engine.handle('schema.tableCreate.apply', { previewToken: value.previewToken, confirmation, acknowledgements: [...tableCreateAcknowledgements], taskId, connectionRevision: revision }); }
beforeEach(async () => {
  events = []; sent = []; connections = []; sequence = 0; uuid = 'server-1'; mode = ''; occupied = created = closeFails = badVerify = holdClose = false; hold = held = fail = releaseClose = undefined; dialect = 'mysql'; version = '8.4.11';
  driver.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal)); driver.execute.mockReset().mockImplementation(async () => { held?.complete(Error('合成取消终态')); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: 'c', profile });
});
afterEach(async () => { closeFails = holdClose = false; releaseClose?.(); hold = undefined; held?.complete(Error('纯测试收尾')); await engine.closeAll(); vi.useRealTimers(); });
describe('新建表真实Engine仅RAM驱动', () => {
  it('只读准备绑定设计，一条准确CREATE，保留精度/主键/unique并完整后核', async () => {
    const p = await preview(await get()); expect(p.sql).toContain('CREATE TABLE `db`.`new``table`'); expect(p.sql).toContain("DEFAULT '123456789012345678.123456789012'"); expect(sent.some(sql => /^(CREATE|DROP|ALTER|USE)/.test(sql))).toBe(false);
    expect(await apply(p)).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: true }); expect(sent.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1); expect(sent.some(sql => /IF NOT EXISTS|^(DROP|ALTER)/.test(sql))).toBe(false);
    await expect(apply(p, 'replay')).rejects.toThrow('失效'); expect(events.at(-1)?.tableCreate).toMatchObject({ ddlCompleted: true, definitionVerified: true }); expect(connections.every(c => vi.mocked(c.close).mock.calls.length === 1)).toBe(true);
  });
  it.each(['5.7.44', '8.0.46', '8.4.11', '10.11.19', '11.4.13'])('普通版本%s仍使用原生成器，不随意缩为8.4.11', async value => { version = value; dialect = value.startsWith('1') ? 'mariadb' : 'mysql'; const p = await preview(await get()); expect((await apply(p)).ddlCompleted).toBe(true); });
  it.each(['身份', '模式', '修订', '同名'])('%s变化拒绝旧预览且不覆盖', async kind => {
    const p = await preview(await get()); if (kind === '身份') uuid = 'other'; if (kind === '模式') mode = 'NO_BACKSLASH_ESCAPES'; if (kind === '同名') occupied = true;
    await expect(apply(p, 'changed', kind === '修订' ? 2 : 1)).rejects.toThrow(); await expect(apply(p, 'again')).rejects.toThrow('失效'); expect(sent.some(sql => /^(CREATE|DROP|ALTER)/.test(sql))).toBe(false);
  });
  it('错误准确确认先消费，不能trim后重用', async () => { const p = await preview(await get()); await expect(apply(p, 'bad', 1, 'db.new`table ')).rejects.toThrow('确认'); await expect(apply(p, 'again')).rejects.toThrow('失效'); expect(created).toBe(false); });
  it('同步消费拒绝双发，目标锁覆盖实际连接关闭等待', async () => {
    const s = await get(), p = await preview(s), q = await preview(s); hold = /^CREATE TABLE/; const pending = apply(p); await vi.waitFor(() => expect(held).toBeDefined()); await expect(apply(p, 'duplicate')).rejects.toThrow('失效'); await expect(apply(q, 'other')).rejects.toThrow(); held!.complete(); await pending; expect(sent.filter(sql => sql.startsWith('CREATE'))).toHaveLength(1);
  });
  it('已发后未知没有DDL重放或自动DROP补救', async () => { const p = await preview(await get()); fail = /^CREATE TABLE/; await expect(apply(p)).rejects.toThrow(); expect(events.at(-1)?.tableCreate).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' }); await expect(apply(p, 'retry')).rejects.toThrow('失效'); expect(sent.filter(sql => /^(CREATE|DROP|ALTER)/.test(sql))).toHaveLength(1); });
  it('ACK后核不符与连接关闭失败分别保留完成事实', async () => {
    const p = await preview(await get()); badVerify = true; expect(await apply(p)).toMatchObject({ ddlCompleted: true, definitionVerified: false, resourcesReleased: true });
    created = false; badVerify = false; const q = await preview(await get()); closeFails = true; const result = await apply(q, 'close-fail'); expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: false }); expect(result.warnings.length).toBeGreaterThan(0); await expect(apply(q, 'retry')).rejects.toThrow('失效');
  });
  it('预览释放期间或过期不能发DDL，跨用途不能消费', async () => {
    const s = await get(), p = await preview(s); engine.handle('schema.tableCreate.release', { snapshotId: s.snapshotId }); await expect(apply(p)).rejects.toThrow('失效');
    const q = await preview(await get()); await expect(engine.handle('schema.databaseCreate.apply', { previewToken: q.previewToken, confirmation: 'db', acknowledgements: [], taskId: 'wrong', connectionRevision: 1 })).rejects.toThrow(); expect(created).toBe(false);
  });
  it('严格协议拒绝SQL/profile/修订/originalName及可替换目标', () => {
    for (const extra of [{ sql: 'DROP TABLE x' }, { connectionRevision: 7 }, { profile }]) expect(() => validateCommand('schema.tableCreate.get', { connectionId: 'c', database: 'db', taskId: 't', ...extra })).toThrow();
    expect(() => validateCommand('schema.tableCreate.preview', { snapshotId: 's', taskId: 't', design: { ...design(), originalName: 'old' } })).toThrow(); expect(() => validateCommand('schema.tableCreate.apply', { previewToken: 'p', taskId: 't', confirmation: 'db.t', acknowledgements: [...tableCreateAcknowledgements], sql: 'CREATE TABLE other' })).toThrow();
  });
  it('目标锁覆盖真实close Promise，不把DDL回包当资源释放', async () => {
    const s = await get(), p = await preview(s), q = await preview(s); holdClose = true; const pending = apply(p); await vi.waitFor(() => expect(releaseClose).toBeDefined());
    await expect(apply(q, 'during-close')).rejects.toThrow(); expect(sent.filter(sql => sql.startsWith('CREATE'))).toHaveLength(1); holdClose = false; releaseClose!(); expect((await pending).resourcesReleased).toBe(true);
  });
  it('预览TTL和重核等待中释放来源均在发送前拒绝', async () => {
    const s = await get(), p = await preview(s); hold = /^SELECT @@hostname/; const pending = apply(p); await vi.waitFor(() => expect(held).toBeDefined()); engine.handle('schema.tableCreate.release', { snapshotId: s.snapshotId }); held!.complete(); await expect(pending).rejects.toThrow('失效'); expect(created).toBe(false);
    hold = undefined; const q = await preview(await get()); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 120001); await expect(apply(q, 'expired')).rejects.toThrow('失效'); expect(created).toBe(false);
  });
  it('预览前后renderer修改设计对象不能替换引擎持有的设计', async () => {
    const draft = design(), s = await get(), p = await preview(s, draft); draft.name = 'other'; draft.columns[1].defaultValue = '0';
    expect(p.sql).toContain('`new``table`'); expect(p.sql).toContain('123456789012345678.123456789012'); expect((await apply(p)).definitionVerified).toBe(true); expect(sent.filter(sql => sql.startsWith('CREATE'))[0]).not.toContain('`other`');
  });
  it('外键仍可生成与投递，未逐项核验时明确保留ACK而不伪报完整定义', async () => {
    const draft = design(); draft.foreignKeys.push({ name: 'fk_id', columns: ['id'], referencedDatabase: 'db', referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' });
    const p = await preview(await get(), draft); expect(p.sql).toContain('FOREIGN KEY'); expect(p.warnings.join('')).toContain('外键'); expect(await apply(p)).toMatchObject({ ddlCompleted: true, definitionVerified: false, resourcesReleased: true });
  });
  it('公开返回目标修改不改变服务端预览和准确CREATE', async () => {
    const p = await preview(await get()); p.target.table = 'forged'; const result = await apply(p); expect(result.target.table).toBe('new`table'); expect(sent.filter(sql => sql.startsWith('CREATE'))[0]).toContain('`new``table`');
  });
});
