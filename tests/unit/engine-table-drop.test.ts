import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TableDropGetOutput, TableDropPreviewOutput } from '../../src/shared/tableDrop';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableCommentDefinition } from '../../src/engine/tableCommentSql';
const mock = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mock.connect, execute: mock.execute }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'comment-unit', name: '注释单元', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'test' };
const original = "CREATE TABLE `t` (`id` bigint NOT NULL AUTO_INCREMENT,`s` varchar(80) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL,PRIMARY KEY (`id`),KEY `prefix` (`s`(8))) ENGINE=InnoDB AUTO_INCREMENT=9007199254740993 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC COMMENT='原说明'";
let engine: Engine, source: string, physicalId: string, version: string, dialect: 'mysql' | 'mariadb', mode: string, charset: string, catalogMismatch: boolean, warningCount: number;
let nextId: number, sent: { id: number; sql: string }[], connections: ManagedConnection[], events: TaskEvent[], fail: RegExp | undefined, hold: RegExp | undefined, closeFails: boolean;
let afterAlterMode: string | undefined;
let currentName: string, occupied: boolean, dependency: string, grants: string[], afterPhysicalId: string | undefined;
let counter: string | null, empty: boolean, postEffect: (() => void) | undefined, kind: string, increment: number;
let tableExists: boolean, physicalExists: boolean, serverUuid: string, os: string, names: number;
let held: { complete(error?: Error): void } | undefined;
/** 仅替换驱动；真实Engine、目录校验、预览、执行、取消和关闭路径均运行产品代码。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++nextId; let sqlMode = mode, quote = 0, encoding = '', collation = '';
  const value = { connection, profile, signal, broken: false, status: { version, dialect, connectionId: threadId }, close: vi.fn(async () => { if (closeFails) throw new Error('关闭失败'); }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push({ id: threadId, sql });
    const complete = (error?: Error) => queueMicrotask(() => {
      if (error || fail?.test(sql)) { callback(error ?? Object.assign(new Error('驱动拒绝'), { errno: 1227 })); return; }
      let rows: unknown = [];
      const context = { dialect, mode: { noBackslashEscapes: sqlMode.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: sqlMode.includes('ANSI_QUOTES') } };
      if (sql.startsWith('SET SESSION information_schema_stats_expiry')) rows = {};
      else if (sql.startsWith('SELECT CAST(@@SESSION.information_schema_stats_expiry')) rows = [{ expiry: '0' }];
      else if (sql.startsWith('SET SESSION foreign_key_checks')) rows = {};
      else if (sql.startsWith('SELECT @@SESSION.foreign_key_checks')) rows = [{ fk: 1, uq: 1 }];
      else if (sql.startsWith('SET SESSION show_gipk')) rows = {};
      else if (sql.startsWith('SELECT @@SESSION.show_gipk')) rows = [{ show: 1 }];
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@hostname')) rows = [{ sqlMode, hostname: 'unit', port: 3306, serverId: 7, currentUser: 'test@host', connectionId: threadId, characterSetConnection: encoding, collationConnection: collation, quoteShowCreate: quote }];
      else if (sql.startsWith('SET SESSION sql_mode')) sqlMode = /'([^']*)'/.exec(sql)![1];
      else if (sql.startsWith('SET SESSION sql_quote')) quote = 1;
      else if (sql.startsWith('SET NAMES')) { encoding = 'utf8mb4'; collation = 'utf8mb4_bin'; }
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote')) rows = [{ sqlMode, quoteShowCreate: quote, charset: encoding, collation }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid: serverUuid }];
      else if (sql.startsWith('SHOW CREATE TABLE')) rows = [{ Table: currentName, 'Create Table': source }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, t.TABLE_COLLATION')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name')) rows = parseTableColumnDefinition(source, context).columns.map(column => ({ name: column.name, nullable: column.nullable === false ? 'NO' : 'YES', extra: column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : '', charset: column.name === 's' ? 'latin1' : null, collation: column.name === 's' ? 'latin1_bin' : null }));
      else if (sql.startsWith('SELECT TABLE_TYPE AS kind')) rows = [{ kind, engine: 'InnoDB', rowFormat: 'Dynamic', comment: catalogMismatch ? '目录不符' : readTableCommentDefinition(source, context).comment, autoIncrement: counter }];
      else if (sql.startsWith('SELECT @@version_compile_os AS os')) rows = [{ os, lowerNames: names }];
      else if (sql.startsWith('SELECT PARTITION_NAME AS name')) rows = [{ name: null }];
      else if (sql.startsWith('SELECT CAST(TABLE_ID AS CHAR)')) rows = sql.includes('OR CAST(NAME AS BINARY)') ? (physicalExists ? [{ id: physicalId }] : []) : [{ id: physicalId, name: 'db/' + currentName }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, c.CHARACTER_MAXIMUM')) rows = [{ charset, characters: '2048', bytes: charset === 'utf8mb4' ? '8192' : '6144', maxlen: charset === 'utf8mb4' ? 4 : 3 }];
      else if (sql.startsWith('SELECT @@SESSION.auto_increment_increment')) rows = [{ incrementValue: increment, offsetValue: 1 }];
      else if (sql.startsWith('SELECT 1 AS present FROM')) rows = empty ? [] : [{ present: 1 }];
      else if (sql === 'SHOW GRANTS') rows = grants.map(value => ({ Grants: value }));
      else if (sql.includes('FROM information_schema.INNODB_FOREIGN')) rows = dependency === 'foreign' ? [{ ID: 'db/foreign' }] : [];
      else if (sql.includes('FROM information_schema.TRIGGERS')) rows = dependency === 'trigger' ? [{ TRIGGER_NAME: 'tr' }] : [];
      else if (sql.includes('FROM information_schema.VIEW_TABLE_USAGE')) rows = dependency === 'view' ? [{ VIEW_NAME: 'v' }] : [];
      else if (sql.startsWith('SELECT TABLE_NAME FROM information_schema.TABLES')) {
        const literals = [...sql.matchAll(/X'([0-9a-f]*)'/g)].map(item => Buffer.from(item[1], 'hex').toString());
        rows = tableExists || occupied ? [{ TABLE_NAME: literals[1] }] : [];
      }
      else if (sql.startsWith('DROP TABLE')) {
        tableExists = false; physicalExists = false;
        if (afterAlterMode !== undefined) sqlMode = afterAlterMode;
        postEffect?.(); rows = { affectedRows: 0, warningStatus: warningCount };
      }
      else if (sql === 'SHOW WARNINGS LIMIT 20') rows = [{ Code: 1234, Message: '服务器警告' }];
      else { callback(new Error('未定义测试驱动语句：' + sql)); return; }
      callback(null, rows, []);
    });
    if (hold?.test(sql)) { held = { complete }; return; } complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(value); return value;
}
async function get(revision = 1): Promise<TableDropGetOutput> { return engine.handle('schema.tableDrop.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + nextId, connectionRevision: revision }); }
async function preview(snapshot: TableDropGetOutput): Promise<TableDropPreviewOutput> { return engine.handle('schema.tableDrop.preview', { snapshotId: snapshot.snapshotId, taskId: 'preview-' + nextId, connectionRevision: 1 }); }
async function apply(value: TableDropPreviewOutput, taskId = 'apply', revision = 1, acknowledgements = value.requiredAcknowledgements) { return engine.handle('schema.tableDrop.apply', { previewToken: value.previewToken, taskId, connectionRevision: revision, acknowledgements, confirmation: 'db.t' }); }
beforeEach(async () => {
  tableExists = physicalExists = true; serverUuid = '01234567-89ab-cdef-0123-456789abcdef'; os = 'Linux'; names = 0;
  counter = '9007199254740993'; empty = false; postEffect = undefined; kind = 'BASE TABLE'; increment = 1; currentName = 't'; occupied = false; dependency = ''; grants = ["GRANT ALL PRIVILEGES ON *.* TO 'test'@'host'"]; afterPhysicalId = undefined;
  source = original; physicalId = '9007199254740995'; version = '8.4.11'; dialect = 'mysql'; mode = ''; charset = 'utf8mb3'; catalogMismatch = false; warningCount = 0;
  nextId = 0; sent = []; connections = []; events = []; fail = undefined; hold = undefined; held = undefined; closeFails = false; afterAlterMode = undefined;
  mock.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal));
  mock.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Object.assign(new Error('取消终态'), { errno: 1317 })); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => { closeFails = false; hold = undefined; held?.complete(new Error('单元收尾')); await engine.closeAll(); vi.useRealTimers(); });


const drops = () => sent.filter(item => item.sql.startsWith('DROP TABLE'));
describe('专用DROP实际Engine生命周期（仅驱动RAM端口，数据库实际0）', () => {
  it('读取和预览零DDL，单次DROP使用独立会话，后核原名称与物理编号消失且FK从不关闭', async () => {
    const snapshot = await get(); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true);
    const next = await preview(snapshot); expect(next.sql).toBe('DROP TABLE `db`.`t`;'); expect(drops()).toHaveLength(0);
    expect(await apply(next)).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, after: { targetAbsent: true, physicalTableAbsent: true } });
    expect(drops()).toHaveLength(1); expect(drops()[0].id).not.toBe(1);
    expect(sent.some(row => /foreign_key_checks\s*=\s*0|TRUNCATE|DELETE FROM|IF EXISTS|CASCADE/.test(row.sql))).toBe(false);
    expect(events.at(-1)?.tableDrop).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' });
    await expect(apply(next, 'replay')).rejects.toThrow('失效'); await expect(preview(snapshot)).rejects.toThrow('失效');
    expect(connections.every(item => vi.mocked(item.close).mock.calls.length === 1)).toBe(true);
  });
  it.each(['foreign','trigger','view','privilege','unreadable','version','os','names','uuid','physical','generated','unknown'])('未证明的%s能力只读且零DROP', async reason => {
    if (['foreign','trigger','view'].includes(reason)) dependency = reason;
    if (reason === 'privilege') grants = ["GRANT SELECT, SHOW VIEW ON *.* TO 'test'@'host'"];
    if (reason === 'unreadable') fail = /information_schema.INNODB_FOREIGN/;
    if (reason === 'version') version = '8.0.44'; if (reason === 'os') os = 'Win64'; if (reason === 'names') names = 1;
    if (reason === 'uuid') serverUuid = 'unknown'; if (reason === 'physical') physicalId = 'unknown';
    if (reason === 'generated') source = source.replace(',PRIMARY KEY', ',`g` int GENERATED ALWAYS AS (length(`s`)) STORED,PRIMARY KEY');
    if (reason === 'unknown') source = source.replace('DEFAULT CHARSET=', 'UNKNOWN_OPTION=1 DEFAULT CHARSET=');
    const snapshot = await get(); expect(snapshot.writable).toBe(false); await expect(preview(snapshot)).rejects.toThrow(); expect(drops()).toHaveLength(0);
  });
  it.each(['preview','apply'])('%s前同名重建、定义变化、UUID变化和新增依赖均拒绝，零DROP', async phase => {
    for (const mutation of [() => { physicalId = '9007199254740996'; }, () => { source = source.replace('原说明','新定义'); }, () => { serverUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'; }, () => { dependency = 'foreign'; }]) {
      const snapshot = await get(), next = phase === 'apply' ? await preview(snapshot) : undefined; mutation();
      await expect(next ? apply(next, 'changed-'+nextId) : preview(snapshot)).rejects.toThrow(); expect(drops()).toHaveLength(0);
      physicalId = '9007199254740995'; source = original; serverUuid = '01234567-89ab-cdef-0123-456789abcdef'; dependency = '';
    }
  });
  it.each(['revision','confirmation','ack'])('错误%s消费同批全部令牌，不发送、不重放', async reason => {
    const snapshot = await get(), next = await preview(snapshot), sibling = await preview(snapshot);
    await expect(engine.handle('schema.tableDrop.apply', { previewToken: next.previewToken, taskId: 'invalid', connectionRevision: reason === 'revision' ? 2 : 1, confirmation: reason === 'confirmation' ? 'db.t ' : 'db.t', acknowledgements: reason === 'ack' ? [] : next.requiredAcknowledgements })).rejects.toThrow();
    await expect(apply(sibling, 'sibling')).rejects.toThrow('失效'); await expect(preview(snapshot)).rejects.toThrow('失效'); expect(drops()).toHaveLength(0);
  });
  it.each(['same-name','renamed-physical','privilege-loss','uuid','mode','warning','read-failed'])('DDL成功但%s后核不满足，保留完成事实而不报告完整成功', async reason => {
    const next = await preview(await get()); if (reason === 'warning') warningCount = 1;
    postEffect = () => {
      if (reason === 'same-name') tableExists = true;
      if (reason === 'renamed-physical') physicalExists = true;
      if (reason === 'privilege-loss') grants = ["GRANT USAGE ON *.* TO 'test'@'host'"];
      if (reason === 'uuid') serverUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      if (reason === 'mode') afterAlterMode = 'ANSI_QUOTES';
      if (reason === 'read-failed') fail = /FROM information_schema.TABLES/;
    };
    if (reason === 'mode') afterAlterMode = 'ANSI_QUOTES';
    expect(await apply(next)).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    expect(events.at(-1)?.tableDrop).toMatchObject({ ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' });
    await expect(apply(next, 'replay')).rejects.toThrow('失效'); expect(drops()).toHaveLength(1);
  });
  it('DDL驱动拒绝或断线属于可能已发送，令牌不可重放', async () => {
    const next = await preview(await get()); fail = /^DROP TABLE/;
    await expect(apply(next)).rejects.toThrow(); expect(events.at(-1)?.tableDrop).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
    await expect(apply(next, 'replay')).rejects.toThrow('失效'); expect(drops()).toHaveLength(1);
  });
  it('取消等待真实DDL终态与关闭，不提前释放执行锁', async () => {
    const first = await preview(await get()), other = await preview(await get()); hold = /^DROP TABLE/;
    const pending = apply(first, 'cancel').catch(error => error); await vi.waitFor(() => expect(held).toBeDefined());
    await expect(apply(other, 'competing')).rejects.toThrow();
    await engine.handle('query.cancel', { taskId: 'cancel' }); expect(await pending).toBeInstanceOf(Error);
    expect(events.at(-1)?.tableDrop).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' }); expect(drops()).toHaveLength(1);
  });
  it('跨用途令牌不能套用或释放，过期快照不能执行', async () => {
    const snapshot = await get(), next = await preview(snapshot);
    await expect(engine.handle('schema.tableTruncate.preview', { snapshotId: snapshot.snapshotId, taskId: 'wrong', connectionRevision: 1 })).rejects.toThrow();
    await engine.handle('schema.tableTruncate.release', { snapshotId: snapshot.snapshotId, previewToken: next.previewToken });
    const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now + 120001);
    try { await expect(apply(next, 'expired')).rejects.toThrow('失效'); } finally { clock.mockRestore(); }
    expect(drops()).toHaveLength(0);
  });
});
