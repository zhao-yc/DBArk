import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TableCommentGetOutput, TableCommentPreviewOutput } from '../../src/shared/tableComment';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableCommentDefinition } from '../../src/engine/tableCommentSql';
const mock = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mock.connect, execute: mock.execute }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'comment-unit', name: '注释单元', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'test' };
const original = "CREATE TABLE `t` (`id` bigint NOT NULL AUTO_INCREMENT,`s` varchar(80) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL,`g` int GENERATED ALWAYS AS (length(`s`)) STORED,PRIMARY KEY (`id`),KEY `prefix` (`s`(8))) ENGINE=InnoDB AUTO_INCREMENT=9007199254740993 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC COMMENT='原说明'";
let engine: Engine, source: string, physicalId: string, version: string, dialect: 'mysql' | 'mariadb', mode: string, charset: string, catalogMismatch: boolean, warningCount: number;
let nextId: number, sent: { id: number; sql: string }[], connections: ManagedConnection[], events: TaskEvent[], fail: RegExp | undefined, hold: RegExp | undefined, closeFails: boolean;
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
      if (sql.startsWith('SET SESSION foreign_key_checks')) rows = {};
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
      else if (sql.startsWith('SELECT TABLE_TYPE AS kind')) rows = [{ kind: 'BASE TABLE', engine: 'InnoDB', rowFormat: 'Dynamic', comment: catalogMismatch ? '目录不符' : readTableCommentDefinition(source, context).comment, autoIncrement: '9007199254740993' }];
      else if (sql.startsWith('SELECT @@version_compile_os AS os')) rows = [{ os: 'Linux', lowerNames: 0 }];
      else if (sql.startsWith('SELECT PARTITION_NAME AS name')) rows = [{ name: null }];
      else if (sql.startsWith('SELECT CAST(TABLE_ID AS CHAR)')) rows = [{ id: physicalId, name: 'db/t' }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, c.CHARACTER_MAXIMUM')) rows = [{ charset, characters: '2048', bytes: charset === 'utf8mb4' ? '8192' : '6144', maxlen: charset === 'utf8mb4' ? 4 : 3 }];
      else if (sql.startsWith('ALTER TABLE')) { source = source.replace(/ COMMENT='原说明'$/, '') + ' ' + sql.slice(sql.indexOf('COMMENT = '), -1); rows = { affectedRows: 0, warningStatus: warningCount }; }
      else if (sql === 'SHOW WARNINGS LIMIT 20') rows = [{ Code: 1234, Message: '服务器警告' }];
      else { callback(new Error('未定义测试驱动语句：' + sql)); return; }
      callback(null, rows, []);
    });
    if (hold?.test(sql)) { held = { complete }; return; } complete();
  } });
  signal?.addEventListener('abort', () => connection.emit('end'), { once: true }); connections.push(value); return value;
}
async function get(revision = 1): Promise<TableCommentGetOutput> { return engine.handle('schema.tableComment.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + nextId, connectionRevision: revision }); }
async function preview(snapshot: TableCommentGetOutput, comment = '新说明'): Promise<TableCommentPreviewOutput> { return engine.handle('schema.tableComment.preview', { snapshotId: snapshot.snapshotId, comment, taskId: 'preview-' + nextId, connectionRevision: 1 }); }
async function apply(value: TableCommentPreviewOutput, taskId = 'apply', revision = 1, acknowledgements = value.requiredAcknowledgements) { return engine.handle('schema.tableComment.apply', { previewToken: value.previewToken, taskId, connectionRevision: revision, acknowledgements }); }
beforeEach(async () => {
  source = original; physicalId = '9007199254740995'; version = '8.4.11'; dialect = 'mysql'; mode = ''; charset = 'utf8mb3'; catalogMismatch = false; warningCount = 0;
  nextId = 0; sent = []; connections = []; events = []; fail = undefined; hold = undefined; held = undefined; closeFails = false;
  mock.connect.mockReset().mockImplementation(async (_profile, _database, signal) => managed(signal));
  mock.execute.mockReset().mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL CONNECTION')) held?.complete(Object.assign(new Error('取消终态'), { errno: 1317 })); return { rows: [] }; });
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile });
});
afterEach(async () => { closeFails = false; hold = undefined; held?.complete(new Error('单元收尾')); await engine.closeAll(); vi.useRealTimers(); });
describe('真实Engine表注释受控生命周期（驱动替身）', () => {
  it('复杂生成列与前缀索引可用，预览零DDL，独立会话恰好一次COMMENT并完整核验', async () => {
    const snapshot = await get(); expect(snapshot).toMatchObject({ writable: true, autoIncrement: '9007199254740993', budget: { supplementary: false } });
    const next = await preview(snapshot); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0);
    expect(await apply(next)).toMatchObject({ ddlCompleted: true, definitionVerified: true, after: { comment: '新说明' } });
    const alters = sent.filter(item => item.sql.startsWith('ALTER')); expect(alters).toEqual([{ id: alters[0].id, sql: "ALTER TABLE `db`.`t` COMMENT = '新说明';" }]);
    await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
    expect(connections.every(item => vi.mocked(item.close).mock.calls.length === 1)).toBe(true);
    expect(new Set(sent.filter(item => item.sql.startsWith('SHOW CREATE')).map(item => item.id)).size).toBe(3);
  });
  it.each(['5.7.44', '8.0.46', '8.4.11', '10.11.19-MariaDB', '11.4.13-MariaDB'])('版本%s与模式下保持字符串，读真实目录预算', async current => {
    version = current; dialect = current.includes('MariaDB') ? 'mariadb' : 'mysql'; mode = 'NO_BACKSLASH_ESCAPES,ANSI_QUOTES';
    const snapshot = await get(), text = "说明'\\路径\r\n第二行", next = await preview(snapshot, text);
    expect(await apply(next)).toMatchObject({ definitionVerified: true, after: { comment: text } });
  });
  it('同定义DROP重建通过原生TABLE_ID识别，消费令牌且零DDL', async () => {
    const next = await preview(await get()); physicalId = '9007199254740996';
    await expect(apply(next)).rejects.toThrow('身份'); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0);
    await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
  });
  it.each(['revision', 'ack', 'source', 'catalog', 'permission'] as const)('%s变化在发送DDL前拒绝且令牌不能重用', async kind => {
    const next = await preview(await get());
    if (kind === 'source') source = source.replace('varchar(80)', 'varchar(81)');
    if (kind === 'catalog') catalogMismatch = true;
    if (kind === 'permission') fail = /SELECT CAST\(TABLE_ID/;
    await expect(apply(next, 'apply', kind === 'revision' ? 2 : 1, kind === 'ack' ? [] : next.requiredAcknowledgements)).rejects.toThrow();
    expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0);
    await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
  });
  it('未知版本、引擎参数、风险Maria默认值、目录权限不足只能读，不能预览', async () => {
    version = '9.0.1'; expect((await get()).writable).toBe(false);
    version = '8.4.11'; source = original.replace('原说明', 'MERGE_THRESHOLD=40'); expect((await get()).writable).toBe(false);
    source = original.replace('DEFAULT NULL', 'DEFAULT (1+1)'); version = '11.4.13-MariaDB'; dialect = 'mariadb'; expect((await get()).reasons.join('')).toContain('默认');
    source = original; fail = /SELECT CAST\(TABLE_ID/; const snapshot = await get(); expect(snapshot.writable).toBe(false); await expect(preview(snapshot)).rejects.toThrow();
  });
  it('TABLE_COMMENT目录utf8mb3不猜测补充字符支持；明确utf8mb4才可预览并后核验', async () => {
    await expect(preview(await get(), '😀')).rejects.toThrow('补充平面'); charset = 'utf8mb4';
    const next = await preview(await get(), '😀'); expect(await apply(next)).toMatchObject({ definitionVerified: true });
  });
  it('服务器警告紧随ALTER读取，DDL完成但不伪报无损核验', async () => {
    const next = await preview(await get()); warningCount = 1;
    expect(await apply(next)).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    const position = sent.findIndex(item => item.sql.startsWith('ALTER')); expect(sent[position + 1].sql).toBe('SHOW WARNINGS LIMIT 20');
  });
  it('警告计数无法确认时保留DDL成功但不能标为无损核验', async () => {
    const next = await preview(await get()); warningCount = Number.NaN;
    expect(await apply(next)).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });
  it('已投递DDL取消等待真实终态，同表租约释放，令牌不能重放', async () => {
    const next = await preview(await get()); hold = /^ALTER TABLE/;
    const pending = apply(next, 'cancel-ddl').catch(error => error); await vi.waitFor(() => expect(held).toBeDefined());
    await engine.handle('query.cancel', { taskId: 'cancel-ddl' }); expect(await pending).toBeInstanceOf(Error);
    expect(events.at(-1)).toMatchObject({ status: 'cancelled', tableComment: { ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' } }); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1);
    await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
  });
  it('释放快照释放关联预览，不会留下可重放令牌', async () => {
    const snapshot = await get(), next = await preview(snapshot); await engine.handle('schema.tableComment.release', { snapshotId: snapshot.snapshotId });
    await expect(apply(next)).rejects.toThrow('已失效或已使用');
  });
  it('过期令牌与连接关闭统一失效，未知结果不重放', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); const next = await preview(await get()); vi.setSystemTime(Date.now() + 120001);
    await expect(apply(next)).rejects.toThrow('已失效或已使用');
    const current = await preview(await get()); await engine.handle('connections.close', { id: profile.id }); await expect(apply(current, 'closed')).rejects.toThrow('已失效或已使用');
  });
  it('同表租约防止两个预览并发ALTER，拒绝者的令牌也被消费', async () => {
    const snapshot = await get(), first = await preview(snapshot), second = await preview(snapshot, '另一说明'); hold = /^ALTER TABLE/;
    const pending = apply(first, 'first').catch(error => error); await vi.waitFor(() => expect(held).toBeDefined());
    await expect(apply(second, 'second')).rejects.toThrow('已有结构变更');
    held!.complete(); expect(await pending).toMatchObject({ ddlCompleted: true });
    await expect(apply(second, 'replay')).rejects.toThrow('已失效或已使用'); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1);
  });
  it('已收到OK但后续读取或真实关闭失败仍保留已完成事实', async () => {
    const next = await preview(await get()); hold = /^ALTER TABLE/;
    const pending = apply(next, 'after-failed').catch(error => error); await vi.waitFor(() => expect(held).toBeDefined());
    fail = /^SHOW CREATE TABLE/; closeFails = true; held!.complete(); expect(await pending).toBeInstanceOf(Error);
    expect(events.at(-1)?.tableComment).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' });
    await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用'); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1);
  });
});
