import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TableAutoIncrementGetOutput, TableAutoIncrementPreviewOutput } from '../../src/shared/tableAutoIncrement';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableCommentDefinition } from '../../src/engine/tableCommentSql';
const mock = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mock.connect, execute: mock.execute }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'comment-unit', name: '注释单元', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'test' };
const original = "CREATE TABLE `t` (`id` bigint NOT NULL AUTO_INCREMENT,`s` varchar(80) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL,`g` int GENERATED ALWAYS AS (length(`s`)) STORED,PRIMARY KEY (`id`),KEY `prefix` (`s`(8))) ENGINE=InnoDB AUTO_INCREMENT=9007199254740993 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC COMMENT='原说明'";
let engine: Engine, source: string, physicalId: string, version: string, dialect: 'mysql' | 'mariadb', mode: string, charset: string, catalogMismatch: boolean, warningCount: number;
let nextId: number, sent: { id: number; sql: string }[], connections: ManagedConnection[], events: TaskEvent[], fail: RegExp | undefined, hold: RegExp | undefined, closeFails: boolean;
let injectedUnknownClose = false;
let afterAlterMode: string | undefined;
let counterValue: string | null, afterValue: string | undefined, columnType: string, policy: Record<string,string>, statsExpiry: string, grants: string[], afterPhysicalId: string | undefined;
let held: { complete(error?: Error): void } | undefined;
let nativeReplies: Record<string, unknown>[][];
/** 仅替换驱动；真实Engine、目录校验、预览、执行、取消和关闭路径均运行产品代码。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++nextId; let sqlMode = mode, quote = 0, encoding = '', collation = '';
  const value = { connection, profile, signal, broken: false, status: { version, dialect, connectionId: threadId }, close: vi.fn(async () => { if (closeFails) { injectedUnknownClose = true; throw new Error('关闭失败'); } }) } as unknown as ManagedConnection;
  Object.assign(connection, { threadId, destroy: () => connection.emit('end'), query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push({ id: threadId, sql });
    const complete = (error?: Error) => queueMicrotask(() => {
      if (error || fail?.test(sql)) { callback(error ?? Object.assign(new Error('驱动拒绝'), { errno: 1227 })); return; }
      // 按真实方言拒绝不存在的变量，避免替身用多余字段掩盖错误SQL。
      if ((dialect === 'mariadb' && /information_schema_stats_expiry|super_read_only|show_gipk_in_create/.test(sql)) || version.startsWith('5.7.') && /information_schema_stats_expiry|show_gipk_in_create/.test(sql)) { callback(new Error('该版本不存在此变量')); return; }
      let rows: unknown = [];
      const context = { dialect, mode: { noBackslashEscapes: sqlMode.includes('NO_BACKSLASH_ESCAPES'), ansiQuotes: sqlMode.includes('ANSI_QUOTES') } };
      if (sql === 'SET SESSION information_schema_stats_expiry = 0') statsExpiry = '0';
      else if (sql.startsWith('SELECT CAST(@@SESSION.information_schema_stats_expiry')) rows = [{ expiry: statsExpiry }];
      else if (sql.startsWith('SELECT CAST(@@SESSION.auto_increment_increment')) rows = [Object.fromEntries([...sql.matchAll(/ AS (\w+)(?:,|$)/g)].map(match => [match[1], policy[match[1]]]))];
      else if (sql.startsWith('SHOW TABLE STATUS FROM')) rows = nativeReplies.shift() ?? [{ Name: 't', Engine: 'InnoDB', Auto_increment: counterValue }];
      else if (sql === 'SHOW GRANTS') rows = grants.map(value => ({ Grants: value }));
      else if (sql.startsWith('SELECT COLUMN_NAME AS name, DATA_TYPE')) rows = parseTableColumnDefinition(source, context).columns.map(column => ({ name: column.name, dataType: column.name === 'id' ? columnType.split(/[ (]/)[0] : 'int', columnType: column.name === 'id' ? columnType : 'int', extra: column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : '' }));
      else if (sql.startsWith('SET SESSION foreign_key_checks')) rows = {};
      else if (sql.startsWith('SELECT @@SESSION.foreign_key_checks')) rows = [{ fk: 1, uq: 1 }];
      else if (sql.startsWith('SET SESSION show_gipk')) rows = {};
      else if (sql.startsWith('SELECT @@SESSION.show_gipk')) rows = [{ show: 1 }];
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@hostname')) rows = [{ sqlMode, hostname: 'unit', port: 3306, serverId: 7, currentUser: 'test@host', connectionId: threadId }];
      else if (sql.startsWith('SET SESSION sql_mode')) sqlMode = /'([^']*)'/.exec(sql)![1];
      else if (sql.startsWith('SET SESSION sql_quote')) quote = 1;
      else if (sql.startsWith('SET NAMES')) { encoding = 'utf8mb4'; collation = 'utf8mb4_bin'; }
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote')) rows = [{ sqlMode, quoteShowCreate: quote, charset: encoding, collation }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid: 'unit-server' }];
      else if (sql.startsWith('SHOW CREATE TABLE')) rows = [{ Table: 't', 'Create Table': source }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, t.TABLE_COLLATION')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name')) rows = parseTableColumnDefinition(source, context).columns.map(column => ({ name: column.name, nullable: column.nullable === false ? 'NO' : 'YES', extra: column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : '', charset: column.name === 's' ? 'latin1' : null, collation: column.name === 's' ? 'latin1_bin' : null }));
      else if (sql.startsWith('SELECT TABLE_TYPE AS kind')) rows = [{ kind: 'BASE TABLE', engine: 'InnoDB', rowFormat: 'Dynamic', comment: catalogMismatch ? '目录不符' : readTableCommentDefinition(source, context).comment, autoIncrement: counterValue }];
      else if (sql.startsWith('SELECT @@version_compile_os AS os')) rows = [{ os: 'Linux', lowerNames: 0 }];
      else if (sql.startsWith('SELECT PARTITION_NAME AS name')) rows = [{ name: null }];
      else if (sql.startsWith('SELECT CAST(TABLE_ID AS CHAR)')) rows = [{ id: physicalId, name: 'db/t' }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, c.CHARACTER_MAXIMUM')) rows = [{ charset, characters: '2048', bytes: charset === 'utf8mb4' ? '8192' : '6144', maxlen: charset === 'utf8mb4' ? 4 : 3 }];
      else if (sql.startsWith('ALTER TABLE')) {
        counterValue = afterValue ?? /AUTO_INCREMENT = ([1-9][0-9]*);$/.exec(sql)![1];
        source = source.replace(/ AUTO_INCREMENT=[0-9]+/, ' AUTO_INCREMENT=' + counterValue);
        if (afterAlterMode !== undefined) sqlMode = afterAlterMode;
        if (afterPhysicalId !== undefined) physicalId = afterPhysicalId;
        rows = { affectedRows: 0, warningStatus: warningCount };
      }
      else if (sql === 'SHOW WARNINGS LIMIT 20') rows = [{ Code: 1234, Message: '服务器警告' }];
      else { callback(new Error('未定义测试驱动语句：' + sql)); return; }
      callback(null, rows, []);
    });
    if (hold?.test(sql)) { held = { complete }; return; } complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(value); return value;
}
async function get(revision = 1): Promise<TableAutoIncrementGetOutput> { return engine.handle('schema.tableAutoIncrement.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + nextId, connectionRevision: revision }); }
async function preview(snapshot: TableAutoIncrementGetOutput, value = '9007199254740995'): Promise<TableAutoIncrementPreviewOutput> { return engine.handle('schema.tableAutoIncrement.preview', { snapshotId: snapshot.snapshotId, value, taskId: 'preview-' + nextId, connectionRevision: 1 }); }
async function apply(value: TableAutoIncrementPreviewOutput, taskId = 'apply', revision = 1, acknowledgements = value.requiredAcknowledgements) { return engine.handle('schema.tableAutoIncrement.apply', { previewToken: value.previewToken, taskId, connectionRevision: revision, acknowledgements }); }
beforeEach(async () => {
  injectedUnknownClose = false;
  counterValue = '9007199254740993'; afterValue = undefined; afterPhysicalId = undefined; columnType = 'bigint'; statsExpiry = '86400'; grants = ["GRANT ALL PRIVILEGES ON *.* TO 'test'@'host'"];
  policy = { sessionIncrement: '1', sessionOffset: '1', globalIncrement: '1', globalOffset: '1', lockMode: '2', readOnly: '0', superReadOnly: '0', innodbReadOnly: '0', forceRecovery: '0' };
  source = original; physicalId = '9007199254740995'; version = '8.4.11'; dialect = 'mysql'; mode = ''; charset = 'utf8mb3'; catalogMismatch = false; warningCount = 0;
  nextId = 0; sent = []; connections = []; events = []; fail = undefined; hold = undefined; held = undefined; closeFails = false; afterAlterMode = undefined; nativeReplies = [];
  mock.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal));
  mock.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Object.assign(new Error('取消终态'), { errno: 1317 })); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => {
  closeFails = false; hold = undefined; held?.complete(new Error('单元收尾'));
  // 此旧RAM端口没有资源facade；注入关闭未知后，恢复开关不能替代物理终态证明。
  if (injectedUnknownClose) await expect(engine.closeAll()).rejects.toThrow('资源未确认释放'); else await engine.closeAll();
  vi.useRealTimers();
});

describe('真实Engine下一自增值受控生命周期（仅替换驱动）', () => {
  it('先绕过统计缓存，精确大数读取与只读预览零DDL，单次ALTER并完整核验', async () => {
    const snapshot = await get(); expect(snapshot).toMatchObject({ writable: true, autoIncrement: '9007199254740993', column: { name: 'id', type: 'bigint', maximum: '9223372036854775807' } });
    const next = await preview(snapshot); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0);
    expect(next.sql).toBe('ALTER TABLE `db`.`t` AUTO_INCREMENT = 9007199254740995;');
    expect(await apply(next)).toMatchObject({ ddlCompleted: true, definitionVerified: true, structureVerified: true, counterState: 'matched', after: { value: '9007199254740995' } });
    expect(source).toBe(original.replace('AUTO_INCREMENT=9007199254740993', 'AUTO_INCREMENT=9007199254740995'));
    expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1); expect(sent.some(item => /\bMAX\s*\(/i.test(item.sql))).toBe(false);
    expect(sent[0].sql).toBe('SET SESSION information_schema_stats_expiry = 0'); await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用'); expect(connections.every(item => vi.mocked(item.close).mock.calls.length === 1)).toBe(true);
  });
  it('UINT64最大值不经过Number，不更改列类型或其他完整定义', async () => {
    columnType = 'bigint unsigned'; source = source.replace('`id` bigint', '`id` bigint unsigned');
    const snapshot = await get(); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true); const next = await preview(snapshot, '18446744073709551615');
    expect(await apply(next)).toMatchObject({ definitionVerified: true, after: { value: '18446744073709551615' } });
  });
  it.each(['preview', 'apply'] as const)('%s前DML计数推进使快照失效，不重放或猜MAX', async stage => {
    const snapshot = await get(), next = stage === 'apply' ? await preview(snapshot) : undefined;
    counterValue = '9007199254740994'; source = source.replace('AUTO_INCREMENT=9007199254740993', 'AUTO_INCREMENT=9007199254740994');
    await expect(stage === 'preview' ? preview(snapshot) : apply(next!)).rejects.toThrow(); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0);
  });
  it.each(['9007199254740996', '9007199254740993'])('服务器调整/并发推进后实际观测%s不冒称请求值成功', async observed => {
    const next = await preview(await get()); afterValue = observed;
    expect(await apply(next)).toMatchObject({ ddlCompleted: true, structureVerified: true, definitionVerified: false, counterState: 'different', requestedValue: '9007199254740995', after: { value: observed } });
    expect(events.at(-1)?.tableAutoIncrement).toMatchObject({ ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' }); await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
  });
  it.each(['physical', 'source', 'mode', 'revision', 'acks', 'policy', 'privileges'] as const)('%s变化拒绝旧令牌，任何失败仍消费令牌', async kind => {
    const next = await preview(await get());
    if (kind === 'physical') physicalId = '9007199254740996'; if (kind === 'source') source = source.replace('varchar(80)', 'varchar(81)'); if (kind === 'mode') mode = 'NO_BACKSLASH_ESCAPES';
    if (kind === 'policy') policy.globalIncrement = '2'; if (kind === 'privileges') grants = ["GRANT SELECT ON *.* TO 'u'@'h'"];
    await expect(apply(next, 'apply', kind === 'revision' ? 2 : 1, kind === 'acks' ? [] : next.requiredAcknowledgements)).rejects.toThrow();
    expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0); await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
  });
  it.each(['5.7.43', '8.0.29', '9.0.1', '10.11.18-MariaDB', '11.4.12-MariaDB'])('版本%s未开放范围明确只读', async current => {
    version = current; dialect = current.includes('MariaDB') ? 'mariadb' : 'mysql'; const snapshot = await get(); expect(snapshot.writable).toBe(false); await expect(preview(snapshot)).rejects.toThrow();
  });
  it.each(['counter-null', 'no-auto', 'type', 'cache', 'increment', 'offset', 'read-only', 'innodb-read-only', 'force-recovery', 'metadata-mismatch'] as const)('%s能力无法证明时只读，不修复原列或重述定义', async kind => {
    if (kind === 'counter-null') counterValue = null;
    if (kind === 'no-auto') source = source.replace('NOT NULL AUTO_INCREMENT', 'NOT NULL');
    if (kind === 'type') columnType = 'decimal(20,0)';
    if (kind === 'cache') fail = /information_schema_stats_expiry = 0/;
    if (kind === 'increment') policy.sessionIncrement = '2'; if (kind === 'offset') policy.globalOffset = '2'; if (kind === 'read-only') policy.superReadOnly = '1';
    if (kind === 'innodb-read-only') policy.innodbReadOnly = '1'; if (kind === 'force-recovery') policy.forceRecovery = '1';
    if (kind === 'metadata-mismatch') counterValue = '9007199254740994';
    const snapshot = await get(); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(false); await expect(preview(snapshot)).rejects.toThrow(); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0);
  });
  it('取消已提交ALTER等待真实终态，保留未知；共享同表租约不提前释放', async () => {
    const snapshot = await get(), next = await preview(snapshot), second = await preview(snapshot, '9007199254740996'); hold = /^ALTER TABLE/;
    const pending = apply(next, 'cancel-ddl').catch(error => error); await vi.waitFor(() => expect(held).toBeDefined());
    await expect(apply(second, 'overlap')).rejects.toThrow('已有结构变更'); await engine.handle('query.cancel', { taskId: 'cancel-ddl' }); expect(await pending).toBeInstanceOf(Error);
    expect(events.at(-1)).toMatchObject({ status: 'cancelled', tableAutoIncrement: { ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' } }); await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
  });
  it.each(['warning', 'physical', 'mode', 'read-failure', 'close-failure'] as const)('OK包后%s保留DDL已完成但不伪报完整核验', async kind => {
    const next = await preview(await get()); if (kind === 'warning') warningCount = 1; if (kind === 'physical') afterPhysicalId = '9007199254740996'; if (kind === 'mode') afterAlterMode = 'ANSI_QUOTES';
    if (kind === 'read-failure' || kind === 'close-failure') {
      hold = /^ALTER TABLE/; const pending = apply(next).catch(error => error); await vi.waitFor(() => expect(held).toBeDefined());
      if (kind === 'read-failure') fail = /^SHOW CREATE TABLE/; else closeFails = true; held!.complete(); const result = await pending;
      if (kind === 'close-failure') expect(result).toBeInstanceOf(Error); else expect(result).toMatchObject({ ddlCompleted: true, definitionVerified: false, counterState: 'unverified' });
    } else expect(await apply(next)).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    expect(events.at(-1)?.tableAutoIncrement?.ddlCompleted).toBe(true); await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
  });
  it('release、超时和连接关闭撤销令牌，不留下可重放计划', async () => {
    const snapshot = await get(), next = await preview(snapshot); await engine.handle('schema.tableAutoIncrement.release', { snapshotId: snapshot.snapshotId }); await expect(apply(next)).rejects.toThrow('已失效或已使用');
    vi.useFakeTimers({ toFake: ['Date'] }); const expired = await preview(await get()); vi.setSystemTime(Date.now() + 120001); await expect(apply(expired, 'expired')).rejects.toThrow('已失效或已使用');
    const closed = await preview(await get()); await engine.handle('connections.close', { id: profile.id }); await expect(apply(closed, 'closed')).rejects.toThrow('已失效或已使用');
  });
});

const legacyVersions = ['5.7.44', '10.11.19-MariaDB', '5.5.5-11.4.13-MariaDB'] as const;
/** 只设置驱动事实；不会把纯替身的成功冒充真实版本、目录新鲜度或重启验收。 */
function legacy(versionValue: string) {
  version = versionValue; dialect = versionValue.includes('MariaDB') ? 'mariadb' : 'mysql';
  if (dialect === 'mariadb') { delete policy.superReadOnly; Object.assign(policy, { compressedReadOnly: '0', globalWsrep: '0', sessionWsrep: '0' }); }
}
describe('0.19旧引擎自增的受控生命周期纯回归', () => {
  it.each(['10.11.19-MariaDB', '11.4.13-MariaDB'])('%s布尔OFF实际可写，规范表示变化不阻断单次ALTER', async current => {
    legacy(current);
    const booleanKeys = ['readOnly', 'innodbReadOnly', 'compressedReadOnly', 'globalWsrep', 'sessionWsrep'] as const;
    booleanKeys.forEach(key => { policy[key] = 'OFF'; });
    const snapshot = await get(); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true);
    expect(booleanKeys.every(key => snapshot.policy?.[key] === '0')).toBe(true);
    const next = await preview(snapshot);
    // 同一逻辑布尔事实改用原0表示仍一致；不是把真实模式变化豁免掉。
    booleanKeys.forEach(key => { expect(policy[key]).toBe('OFF'); policy[key] = '0'; });
    expect(await apply(next)).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, structureVerified: true, definitionVerified: true, counterState: 'matched' });
    expect(sent.filter(item => item.sql.startsWith('ALTER')).map(item => item.sql)).toEqual(['ALTER TABLE `db`.`t` AUTO_INCREMENT = 9007199254740995;']);
    expect(sent.some(item => /SET GLOBAL|\bMAX\s*\(|ANALYZE|FLUSH/i.test(item.sql))).toBe(false);
    await expect(apply(next, 'replay-off')).rejects.toThrow('已失效或已使用');
  });
  it('MariaDB预览后Galera由OFF改ON继续阻止DDL并消费旧令牌', async () => {
    legacy('11.4.13-MariaDB');
    for (const key of ['readOnly', 'innodbReadOnly', 'compressedReadOnly', 'globalWsrep', 'sessionWsrep']) policy[key] = 'OFF';
    const snapshot = await get(); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true);
    const next = await preview(snapshot); policy.globalWsrep = 'ON';
    await expect(apply(next)).rejects.toThrow(); expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
    await expect(apply(next, 'replay-on')).rejects.toThrow('已失效或已使用');
  });
  it.each(legacyVersions)('%s前后原生状态夹读，大数单ALTER及结果事实保持，变量按方言选择', async current => {
    legacy(current); const snapshot = await get(); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true);
    const first = sent.findIndex(item => item.sql.startsWith('SHOW TABLE STATUS FROM')), definition = sent.findIndex(item => item.sql.startsWith('SHOW CREATE TABLE')), last = sent.length - 1 - [...sent].reverse().findIndex(item => item.sql.startsWith('SHOW TABLE STATUS FROM'));
    expect(first).toBeLessThan(definition); expect(last).toBeGreaterThan(definition); expect(snapshot.autoIncrement).toBe('9007199254740993');
    expect(sent.some(item => /information_schema_stats_expiry|show_gipk_in_create/.test(item.sql))).toBe(false);
    expect(Object.hasOwn(snapshot.policy!, 'superReadOnly')).toBe(dialect === 'mysql');
    expect(sent.some(item => /@@GLOBAL.super_read_only/.test(item.sql))).toBe(dialect === 'mysql');
    const next = await preview(snapshot); expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
    expect(next.requiredAcknowledgements).toHaveLength(dialect === 'mysql' ? 4 : 3);
    expect(snapshot.warnings.join('；')).toContain(dialect === 'mysql' ? '重启会使' : '持久化'); expect(next.warnings).toEqual(snapshot.warnings);
    expect(await apply(next)).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, structureVerified: true, definitionVerified: true, counterState: 'matched', after: { value: '9007199254740995', tableId: snapshot.tableId } });
    expect(sent.filter(item => item.sql.startsWith('ALTER')).map(item => item.sql)).toEqual(['ALTER TABLE `db`.`t` AUTO_INCREMENT = 9007199254740995;']);
    expect(sent.some(item => /\b(?:MAX\s*\(|SET GLOBAL|ANALYZE|FLUSH)\b/i.test(item.sql))).toBe(false);
    await expect(apply(next, 'replay-legacy')).rejects.toThrow('已失效或已使用');
  });
  it.each([null, 9007199254740992, '09007199254740993', '0', '1e16', '18446744073709551616'])('原生计数%j不能经Number修复或伪造精度', async value => {
    legacy('5.7.44'); nativeReplies = [[{ Name: 't', Engine: 'InnoDB', Auto_increment: value }]];
    const snapshot = await get(); expect(snapshot.writable).toBe(false); await expect(preview(snapshot)).rejects.toThrow(); expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
  });
  it.each(['empty', 'duplicate', 'name', 'engine', 'before', 'after', 'query-error'] as const)('原生状态%s无法唯一证明则保留只读原因', async kind => {
    legacy('10.11.19-MariaDB'); const good = { Name: 't', Engine: 'InnoDB', Auto_increment: counterValue };
    if (kind === 'empty') nativeReplies = [[]]; if (kind === 'duplicate') nativeReplies = [[good, good]];
    if (kind === 'name') nativeReplies = [[{ ...good, Name: 'T' }]]; if (kind === 'engine') nativeReplies = [[{ ...good, Engine: 'MyISAM' }]];
    if (kind === 'before') nativeReplies = [[{ ...good, Auto_increment: '9007199254740994' }]];
    if (kind === 'after') nativeReplies = [[good], [{ ...good, Auto_increment: '9007199254740994' }]];
    if (kind === 'query-error') fail = /^SHOW TABLE STATUS FROM/;
    const snapshot = await get(); expect(snapshot.writable).toBe(false); expect(snapshot.reasons.length).toBeGreaterThan(0); await expect(preview(snapshot)).rejects.toThrow();
  });
  it.each(['compressedReadOnly', 'globalWsrep', 'sessionWsrep', 'readOnly', 'innodbReadOnly', 'forceRecovery', 'globalOffset', 'missing', 'permission'] as const)('MariaDB模式%s未知/危险或直接权限不足时拒绝', async kind => {
    legacy('11.4.13-MariaDB');
    if (kind === 'missing') delete policy.globalWsrep; else if (kind === 'permission') grants = ["GRANT SELECT ON *.* TO 'u'@'h'"]; else policy[kind] = kind === 'globalOffset' ? '2' : '1';
    const snapshot = await get(); expect(snapshot.writable).toBe(false); await expect(preview(snapshot)).rejects.toThrow();
  });
  it('MySQL5.7缺少重启确认先消费令牌；8.4不允许夹带该确认项', async () => {
    legacy('5.7.44'); const next = await preview(await get());
    await expect(apply(next, 'legacy-acks', 1, next.requiredAcknowledgements.filter(id => id !== 'restart-volatile'))).rejects.toThrow('确认项');
    await expect(apply(next, 'legacy-again')).rejects.toThrow('已失效或已使用'); expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
    version = '8.4.11'; dialect = 'mysql'; const modern = await preview(await get());
    await expect(apply(modern, 'modern-extra', 1, [...modern.requiredAcknowledgements, 'restart-volatile'])).rejects.toThrow('确认项');
  });
  it.each(legacyVersions)('%s预览后DML、物理身份变化与不同实际计数不会冒充成功或重放', async current => {
    legacy(current); const stale = await preview(await get()); counterValue = '9007199254740994'; source = source.replace('9007199254740993', counterValue);
    await expect(apply(stale, 'stale-dml')).rejects.toThrow(); expect(sent.some(item => item.sql.startsWith('ALTER'))).toBe(false);
    const identity = await preview(await get()); physicalId = '9007199254740996'; await expect(apply(identity, 'stale-id')).rejects.toThrow('身份');
    const next = await preview(await get()); afterValue = '9007199254740996';
    expect(await apply(next, 'different-legacy')).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, structureVerified: true, definitionVerified: false, counterState: 'different', after: { value: '9007199254740996' } });
    await expect(apply(next, 'different-again')).rejects.toThrow('已失效或已使用');
  });
});
