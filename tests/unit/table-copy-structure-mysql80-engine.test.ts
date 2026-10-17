import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TableCopyStructureGetOutput, TableCopyStructurePreviewOutput } from '../../src/shared/tableCopyStructure';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableCommentDefinition } from '../../src/engine/tableCommentSql';
const mock = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mock.connect, execute: mock.execute }));
import { Engine } from '../../src/engine';
const profile: ConnectionProfile = { id: 'copy-unit', name: '离线复制结构', group: '', color: '', dialect: 'mysql', host: 'invalid', port: 3306, user: 'unit' };
const original = "CREATE TABLE `t` (`id` bigint NOT NULL,`s` varchar(80) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL,PRIMARY KEY (`id`),KEY `s_idx` (`s`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='来源说明'";
let engine: Engine, definitions: Map<string, string>, ids: Map<string, string>, events: TaskEvent[], connections: ManagedConnection[], sent: string[], sequence: number;
let version: string, uuid: string, os: string, lower: number, grants: string[], dependency: string, capability: { gipk: number; autocommit: number; partialRevokes: number }, nonempty: boolean, warning: number, closeFails: boolean;
let fail: RegExp | undefined, hold: RegExp | undefined, held: { complete(error?: Error): void } | undefined, afterCreate: (() => void) | undefined;
let initialMode: string;
let counters: Map<string, unknown>, copiedAutoDefinition: string | undefined, expiry: string, columnTypeOverride: string | undefined, policy: Record<string, string>;
let closing: Promise<void> | undefined, releaseClosing: (() => void) | undefined;
/** 精确解析产品只读目录中的编码名称，预期DDL由测试独立断言，驱动不调用产品规划器。 */
function nameOf(sql: string): string { const quoted = /^SHOW CREATE TABLE `db`\.`([^`]+)`/.exec(sql); if (quoted) return quoted[1]; const values = [...sql.matchAll(/X'([a-f0-9]*)'/g)].map(value => Buffer.from(value[1], 'hex').toString()); return values.at(-1)?.split('/').at(-1) ?? 't'; }
/** 仅替换数据库驱动边界，完整读取、任务、缓存、锁、取消和关闭都运行真实Engine。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++sequence; let mode = initialMode, quote = 0, encoding = '', collation = '';
  const value = { connection, profile, signal, broken: false, status: { version, dialect: 'mysql', connectionId: threadId }, close: vi.fn(async () => { if (closing && definitions.has('t_copy')) await closing; if (closeFails) throw Error('关闭失败'); }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push(sql); const complete = (error?: Error) => queueMicrotask(() => {
      if (error || fail?.test(sql)) { callback(error ?? Error('模拟驱动失败')); return; }
      let rows: unknown = []; const name = nameOf(sql), source = definitions.get(name)!, context = { dialect: 'mysql' as const, mode: { noBackslashEscapes: mode.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: mode.includes('ANSI_QUOTES') } };
      if (sql === 'SET SESSION information_schema_stats_expiry = 0') rows = {};
      else if (sql.startsWith('SELECT CAST(@@SESSION.information_schema_stats_expiry')) rows = [{ expiry }];
      else if (sql.startsWith('SELECT CAST(@@SESSION.auto_increment_increment')) rows = [{ ...policy }];
      else if (sql.startsWith('SET SESSION foreign_key_checks') || sql.startsWith('SET SESSION show_gipk')) rows = {};
      else if (sql.startsWith('SELECT @@SESSION.foreign_key_checks')) rows = [{ fk: 1, uq: 1 }];
      else if (sql.startsWith('SELECT @@SESSION.show_gipk')) rows = [{ show: 1 }];
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@hostname')) rows = [{ sqlMode: mode, hostname: 'offline', port: 3306, serverId: 7, currentUser: 'unit@host', connectionId: threadId, characterSetConnection: encoding, collationConnection: collation, quoteShowCreate: quote }];
      else if (sql.startsWith('SET SESSION sql_mode')) mode = /'([^']*)'/.exec(sql)![1];
      else if (sql.startsWith('SET SESSION sql_quote')) quote = 1;
      else if (sql.startsWith('SET NAMES')) { encoding = 'utf8mb4'; collation = 'utf8mb4_bin'; }
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote')) rows = [{ sqlMode: mode, quoteShowCreate: quote, charset: encoding, collation }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid }];
      else if (sql.startsWith('SELECT @@SESSION.sql_generate')) rows = [{ ...capability }];
      else if (sql.startsWith('SHOW CREATE TABLE')) { if (!source) { callback(Error('对象不存在')); return; } rows = [{ Table: name, 'Create Table': source }]; }
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, t.TABLE_COLLATION')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name, DATA_TYPE')) rows = parseTableColumnDefinition(source, context).columns.map(column => ({ name: column.name, dataType: column.type.raw.split(/[ (]/)[0], columnType: columnTypeOverride ?? column.type.raw, extra: column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : '' }));
      else if (sql.startsWith('SELECT COLUMN_NAME AS name')) rows = parseTableColumnDefinition(source, context).columns.map(column => ({ name: column.name, nullable: column.nullable === false ? 'NO' : 'YES', extra: column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : '', charset: column.name === 's' ? 'latin1' : null, collation: column.name === 's' ? 'latin1_bin' : null }));
      else if (sql.startsWith('SELECT TABLE_TYPE AS kind')) rows = [{ kind: 'BASE TABLE', engine: 'InnoDB', rowFormat: 'Dynamic', comment: readTableCommentDefinition(source, context).comment, autoIncrement: counters.get(name) ?? null }];
      else if (sql.startsWith('SELECT @@version_compile_os')) rows = [{ os, lowerNames: lower }];
      else if (sql.startsWith('SELECT PARTITION_NAME')) rows = [{ name: dependency === 'partition' ? 'p0' : null }];
      else if (sql.startsWith('SELECT CAST(TABLE_ID AS CHAR)')) rows = [{ id: ids.get(name), name: 'db/' + name }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, c.CHARACTER_MAXIMUM')) rows = [{ charset: 'utf8mb4', characters: '2048', bytes: '8192', maxlen: 4 }];
      else if (sql === 'SHOW GRANTS') rows = grants.map(value => ({ Grants: value }));
      else if (sql.includes('FROM information_schema.INNODB_FOREIGN')) rows = dependency === 'foreign' ? [{ ID: 'db/fk' }] : [];
      else if (sql.includes('FROM information_schema.TRIGGERS')) rows = dependency === 'trigger' ? [{ TRIGGER_NAME: 'tr' }] : [];
      else if (sql.includes('FROM information_schema.VIEW_TABLE_USAGE')) rows = dependency === 'view' ? [{ VIEW_NAME: 'v' }] : [];
      else if (sql.startsWith('SELECT TABLE_NAME FROM information_schema.TABLES')) rows = definitions.has(name) ? [{ TABLE_NAME: name }] : [];
      else if (sql.startsWith('CREATE TABLE')) {
        const match = /^CREATE TABLE `db`\.`([^`]+)` LIKE `db`\.`t`;$/u.exec(sql); if (!match) { callback(Error('非法测试DDL')); return; }
        if (definitions.has(match[1])) { callback(Error('服务器同名冲突')); return; }
        definitions.set(match[1], (copiedAutoDefinition ?? definitions.get('t')!).replace('CREATE TABLE `t`', 'CREATE TABLE `' + match[1] + '`')); counters.set(match[1], copiedAutoDefinition ? '1' : null); ids.set(match[1], '9007199254740997'); afterCreate?.(); rows = { affectedRows: 0, warningStatus: warning };
      }
      else if (/^SELECT 1 FROM `db`\.`[^`]+` LIMIT 1$/.test(sql)) rows = nonempty ? [{ 1: 1 }] : [];
      else { callback(Error('未定义离线端口：' + sql)); return; }
      callback(null, rows, []);
    }); if (hold?.test(sql)) { held = { complete }; return; } complete();
  } }); signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(value); return value;
}
async function get(revision = 1): Promise<TableCopyStructureGetOutput> { return engine.handle('schema.tableCopyStructure.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + sequence, connectionRevision: revision }); }
async function preview(snapshot: TableCopyStructureGetOutput, newName = 't_copy'): Promise<TableCopyStructurePreviewOutput> { return engine.handle('schema.tableCopyStructure.preview', { snapshotId: snapshot.snapshotId, newName, taskId: 'preview-' + sequence, connectionRevision: 1 }); }
async function apply(value: TableCopyStructurePreviewOutput, extra: Record<string, unknown> = {}) { return engine.handle('schema.tableCopyStructure.apply', { previewToken: value.previewToken, taskId: 'apply-' + sequence, connectionRevision: 1, confirmation: 'db.' + value.newName, acknowledgements: value.requiredAcknowledgements, ...extra }); }
const writes = () => sent.filter(sql => /^(?:CREATE|ALTER|DROP|RENAME|INSERT|UPDATE|DELETE|TRUNCATE)\b/.test(sql));
/** 独立原生语义fixture：固定目标定义不含表尾计数，不调用产品比较器生成期望。 */
function autoSource(value: string) {
  const bare = original.replace('bigint NOT NULL', 'bigint unsigned NOT NULL AUTO_INCREMENT').replace('DEFAULT NULL', "DEFAULT 'AUTO_INCREMENT=99'").replace('来源说明', 'AUTO_INCREMENT=88');
  copiedAutoDefinition = bare; definitions.set('t', value === '1' ? bare : bare.replace('ENGINE=InnoDB', 'ENGINE=InnoDB AUTO_INCREMENT=' + value)); counters.set('t', value);
}
beforeEach(async () => {
  definitions = new Map([['t', original]]); ids = new Map([['t', '9007199254740995']]); events = []; connections = []; sent = []; sequence = 0;
  version = '8.4.11'; uuid = '11111111-2222-3333-4444-555555555555'; os = 'Linux'; lower = 0; grants = ["GRANT SELECT, SHOW VIEW, TRIGGER, PROCESS, CREATE ON *.* TO 'unit'@'host'"]; dependency = ''; capability = { gipk: 0, autocommit: 1, partialRevokes: 0 }; nonempty = false; warning = 0; closeFails = false; fail = hold = undefined; held = undefined; afterCreate = undefined;
  initialMode = ''; counters = new Map([['t', null]]); copiedAutoDefinition = undefined; expiry = '0'; columnTypeOverride = undefined; policy = { sessionIncrement: '1', sessionOffset: '1', globalIncrement: '1', globalOffset: '1', lockMode: '2', readOnly: '0', superReadOnly: '0', innodbReadOnly: '0', forceRecovery: '0' };
  closing = undefined; releaseClosing = undefined;
  mock.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal)); mock.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Error('取消终态')); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => { releaseClosing?.(); closing = undefined; closeFails = false; hold = undefined; held?.complete(Error('离线收尾')); await engine.closeAll(); vi.restoreAllMocks(); });

describe('8.0.46复制结构准备：真实Engine和RAM驱动，不执行原ff42全套', () => {
  it.each([false, true])('普通/自增来源auto=%s均可只读完整定义，但无可执行预览或8.4计数计划', async auto => {
    version = '8.0.46'; if (auto) autoSource('9007199254740993');
    const snapshot = await get(); expect(snapshot.serverVersion).toBe('8.0.46'); expect(snapshot.writable).toBe(false); expect(snapshot.reasons.join('；')).toContain('仅作只读兼容准备'); expect(snapshot.sourceDdl).toBe(definitions.get('t')); expect(snapshot.autoIncrement).toBeUndefined();
    await expect(preview(snapshot)).rejects.toThrow('只读兼容准备'); expect(writes()).toEqual([]); expect(sent.some(sql => sql.startsWith('SELECT @@SESSION.sql_generate_invisible_primary_key'))).toBe(true); expect(sent.some(sql => sql.includes('information_schema_stats_expiry'))).toBe(false);
  });
  it.each(['uuid', 'gipk', 'permission', 'view'])('准备态%s异常仍保留原读取约束，不以只读文案掩盖未知事实', async kind => {
    version = '8.0.46'; if (kind === 'uuid') uuid = 'unknown'; if (kind === 'gipk') capability.gipk = 1; if (kind === 'permission') grants = ["GRANT SELECT, SHOW VIEW, TRIGGER ON *.* TO 'unit'@'host'"]; if (kind === 'view') dependency = 'view';
    const snapshot = await get(); expect(snapshot.writable).toBe(false); expect(snapshot.reasons.length).toBeGreaterThan(1); await expect(preview(snapshot)).rejects.toThrow(); expect(writes()).toEqual([]);
  });
  it('8.4预览后切换8.0合同拒绝执行并消费原令牌，不借旧计数规则继续', async () => {
    const plan = await preview(await get()); version = '8.0.46'; await expect(apply(plan)).rejects.toThrow(); await expect(apply(plan)).rejects.toThrow('失效'); expect(writes()).toEqual([]);
  });
  it.each([false, true])('8.4既有普通/自增auto=%s仅作最小正向回归，仍单次DDL及准确计数', async auto => {
    if (auto) autoSource('42'); const plan = await preview(await get()); expect(await apply(plan)).toMatchObject({ ddlCompleted: true, definitionVerified: true, ...(auto ? { counter: { state: 'matched', actualValue: '1' } } : {}) }); expect(writes()).toEqual([plan.sql]);
  });
});
