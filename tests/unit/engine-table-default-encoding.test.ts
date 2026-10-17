import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TableDefaultEncodingGetOutput, TableDefaultEncodingPreviewOutput } from '../../src/shared/tableDefaultEncoding';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableCommentDefinition } from '../../src/engine/tableCommentSql';
import type { TableEncodingPair } from '../../src/shared/tableDefaultEncoding';
const mock = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mock.connect, execute: mock.execute }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'default-encoding-unit', name: '默认编码单元', group: '', color: '#123456', dialect: 'mysql', host: 'invalid', port: 3306, user: 'test' };
const original = "CREATE TABLE `t` (`id` bigint NOT NULL AUTO_INCREMENT,`s` varchar(80) DEFAULT NULL,`g` int GENERATED ALWAYS AS (length(`s`)) STORED,PRIMARY KEY (`id`),KEY `prefix` (`s`(8))) ENGINE=InnoDB AUTO_INCREMENT=9007199254740993 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC COMMENT='原说明'";
let engine: Engine, source: string, physicalId: string, version: string, dialect: 'mysql' | 'mariadb', mode: string, warningCount: number;
let nextId: number, sent: { id: number; sql: string }[], connections: ManagedConnection[], events: TaskEvent[], fail: RegExp | undefined, hold: RegExp | undefined, closeFails: boolean;
let injectedUnknownClose = false;
let encoding: TableEncodingPair, columnMismatch: boolean, catalog: { charset: string; collation: string; compiled: string }[], fullNames: boolean;
let alterMutation: ((source: string) => string) | undefined, grants: string[];
let held: { complete(error?: Error): void } | undefined;
/** 仅替换驱动；真实Engine、目录校验、预览、执行、取消和关闭路径均运行产品代码。 */
function managed(signal?: AbortSignal): ManagedConnection {
  const connection = new EventEmitter(), threadId = ++nextId; let sqlMode = mode, quote = 0, clientCharset = '', collation = '';
  const value = { connection, profile, signal, broken: false, status: { version, dialect, connectionId: threadId }, close: vi.fn(async () => { if (closeFails) { injectedUnknownClose = true; throw new Error('关闭失败'); } }) } as unknown as ManagedConnection;
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
      else if (sql.startsWith('SET NAMES')) { clientCharset = 'utf8mb4'; collation = 'utf8mb4_bin'; }
      else if (sql.startsWith('SELECT @@SESSION.sql_mode AS sqlMode, @@sql_quote')) rows = [{ sqlMode, quoteShowCreate: quote, charset: clientCharset, collation }];
      else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid: 'unit-server' }];
      else if (sql.startsWith('SHOW CREATE TABLE')) rows = [{ Table: 't', 'Create Table': source }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset, t.TABLE_COLLATION')) rows = [{ ...encoding }];
      else if (sql.startsWith('SELECT COLUMN_NAME AS name') && !sql.includes('COLLATION_CHARACTER_SET_APPLICABILITY')) rows = parseTableColumnDefinition(source, context).columns.map(column => ({ name: column.name, nullable: column.nullable === false ? 'NO' : 'YES', extra: column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : '', charset: column.name === 's' ? columnMismatch ? 'latin1' : 'utf8mb4' : null, collation: column.name === 's' ? columnMismatch ? 'latin1_bin' : 'utf8mb4_bin' : null }));
      else if (sql.startsWith('SELECT TABLE_TYPE AS kind')) rows = [{ kind: 'BASE TABLE', engine: 'InnoDB', rowFormat: 'Dynamic', comment: readTableCommentDefinition(source, context).comment, autoIncrement: '9007199254740993' }];
      else if (sql.startsWith('SELECT @@version_compile_os AS os')) rows = [{ os: 'Linux', lowerNames: 0 }];
      else if (sql.startsWith('SELECT PARTITION_NAME AS name')) rows = [{ name: null }];
      else if (sql.startsWith('SELECT CAST(TABLE_ID AS CHAR)')) rows = [{ id: physicalId, name: 'db/t' }];
      else if (sql.startsWith('SELECT c.CHARACTER_SET_NAME AS charset,c.COLLATION_NAME')) rows = structuredClone(catalog);
      else if (sql.includes("TABLE_NAME='COLLATION_CHARACTER_SET_APPLICABILITY'")) rows = (fullNames ? ['COLLATION_NAME','CHARACTER_SET_NAME','FULL_COLLATION_NAME'] : ['COLLATION_NAME','CHARACTER_SET_NAME']).map(name => ({name}));
      else if (sql.startsWith('SELECT a.CHARACTER_SET_NAME AS charset,a.FULL_COLLATION_NAME')) rows = [{ charset: 'utf8mb4', collation: 'utf8mb4_uca1400_ai_ci', compiled: 'Yes' }];
      else if (sql === 'SHOW GRANTS') rows = grants.map(value => ({ grant: value }));
      else if (sql.startsWith('ALTER TABLE')) {
        const pair = /DEFAULT CHARACTER SET = ([A-Za-z0-9_]+) COLLATE = ([A-Za-z0-9_]+)/.exec(sql)!; encoding = { charset: pair[1], collation: pair[2] };
        source = source.replace('`s` varchar(80) DEFAULT NULL', '`s` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL').replace(/DEFAULT CHARSET=[A-Za-z0-9_]+ COLLATE=[A-Za-z0-9_]+/, 'DEFAULT CHARSET=' + encoding.charset + ' COLLATE=' + encoding.collation);
        if (alterMutation) source = alterMutation(source);
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
async function get(revision = 1): Promise<TableDefaultEncodingGetOutput> { return engine.handle('schema.tableDefaultEncoding.get', { connectionId: profile.id, database: 'db', table: 't', taskId: 'get-' + nextId, connectionRevision: revision }); }
async function preview(snapshot: TableDefaultEncodingGetOutput, pair: TableEncodingPair = { charset: 'latin1', collation: 'latin1_swedish_ci' }): Promise<TableDefaultEncodingPreviewOutput> { return engine.handle('schema.tableDefaultEncoding.preview', { snapshotId: snapshot.snapshotId, ...pair, taskId: 'preview-' + nextId, connectionRevision: 1 }); }
async function apply(value: TableDefaultEncodingPreviewOutput, taskId = 'apply', revision = 1, acknowledgements = value.requiredAcknowledgements) { return engine.handle('schema.tableDefaultEncoding.apply', { previewToken: value.previewToken, taskId, connectionRevision: revision, acknowledgements }); }
beforeEach(async () => {
  injectedUnknownClose = false;
  encoding = { charset: 'utf8mb4', collation: 'utf8mb4_bin' }; columnMismatch = false; fullNames = true; catalog = [{ ...encoding, compiled: 'Yes' }, { charset: 'utf8mb4', collation: 'utf8mb4_general_ci', compiled: 'Yes' }, { charset: 'latin1', collation: 'latin1_swedish_ci', compiled: 'Yes' }];
  source = original; physicalId = '9007199254740995'; version = '8.4.11'; dialect = 'mysql'; mode = ''; warningCount = 0;
  nextId = 0; sent = []; connections = []; events = []; fail = undefined; hold = undefined; held = undefined; closeFails = false; alterMutation = undefined; grants = ['GRANT ALL PRIVILEGES ON *.* TO `unit`@`host`'];
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

describe('真实Engine表默认字符集和排序规则生命周期（驱动替身）', () => {
  it('真实候选成对输出，复杂表预览零DDL，单次DEFAULT修改允许原列显式编码且完整后验', async () => {
    const snapshot = await get(); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true);
    expect(snapshot.current).toEqual({ charset: 'utf8mb4', collation: 'utf8mb4_bin' }); expect(snapshot.candidates).toHaveLength(3);
    expect(snapshot.columns.find(column => column.name === 's')).toMatchObject({ charset: 'utf8mb4', collation: 'utf8mb4_bin' });
    const before = source, next = await preview(snapshot); expect(source).toBe(before); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0);
    expect(next.requiredAcknowledgements).toEqual(['ddl-implicit-commit', 'external-ddl-window', 'table-default-only']);
    expect(await apply(next)).toMatchObject({ ddlCompleted: true, definitionVerified: true, after: { current: { charset: 'latin1', collation: 'latin1_swedish_ci' } } });
    expect(source).toContain('`s` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); expect(source).toContain('9007199254740993');
    expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1); expect(sent.find(item => item.sql.startsWith('ALTER'))?.sql).toBe('ALTER TABLE `db`.`t` DEFAULT CHARACTER SET = latin1 COLLATE = latin1_swedish_ci;');
    await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用'); expect(connections.every(item => vi.mocked(item.close).mock.calls.length === 1)).toBe(true);
  });
  it('同字符集仅换排序规则仍是完整显式配对，当前原值无操作', async () => {
    const snapshot = await get(); await expect(preview(snapshot, snapshot.current)).rejects.toThrow('没有实际');
    const next = await preview(snapshot, { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }); expect(await apply(next)).toMatchObject({ definitionVerified: true });
  });
  it.each(['5.7.44', '8.0.46', '8.4.11', '10.11.19-MariaDB', '11.4.13-MariaDB'])('版本%s隐藏定义模式规范化后用实际执行模式后验，原模式仍不变', async value => {
    version = value; dialect = value.includes('MariaDB') ? 'mariadb' : 'mysql'; mode = dialect === 'mariadb' ? 'NO_FIELD_OPTIONS,NO_TABLE_OPTIONS,ANSI,ANSI_QUOTES,NO_BACKSLASH_ESCAPES' : 'ANSI,ANSI_QUOTES,NO_BACKSLASH_ESCAPES';
    const initialMode = mode, next = await preview(await get());
    expect(await apply(next)).toMatchObject({ definitionVerified: true }); expect(mode).toBe(initialMode);
    const changes = sent.filter(item => item.sql.startsWith('SET SESSION sql_mode')); expect(changes.length).toBeGreaterThan(0); expect(changes.every(item => !item.sql.includes('NO_TABLE_OPTIONS') && !item.sql.includes("'ANSI,"))).toBe(true);
  });
  it('实际列编码变化即使宽松定义摘要一致，也绝不报告完整核验', async () => {
    const next = await preview(await get()); hold = /^ALTER TABLE/; const pending = apply(next); await vi.waitFor(() => expect(held).toBeDefined());
    columnMismatch = true; held!.complete(); expect(await pending).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });
  it.each([
    ['生成表达式', (value: string) => value.replace('length(`s`)', 'length(`s`)+1')],
    ['索引前缀', (value: string) => value.replace('(`s`(8))', '(`s`(9))')],
    ['表注释', (value: string) => value.replace('原说明', '另一说明')],
    ['行格式', (value: string) => value.replace('DYNAMIC', 'COMPACT')],
    ['自增计数', (value: string) => value.replace('9007199254740993', '9007199254740994')],
  ] as const)('DDL完成后%s变化保留已完成事实并拒绝伪核验', async (_label, mutate) => {
    const next = await preview(await get()); alterMutation = mutate;
    expect(await apply(next)).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });
  it.each(['identity', 'source', 'mode', 'catalog', 'revision', 'ack', 'permission'] as const)('%s变化使令牌消费且在DDL前拒绝', async kind => {
    const next = await preview(await get());
    if (kind === 'identity') physicalId = '9007199254740996';
    if (kind === 'source') source = source.replace('varchar(80)', 'varchar(81)');
    if (kind === 'mode') mode = 'NO_BACKSLASH_ESCAPES';
    if (kind === 'catalog') catalog.push({ charset: 'ascii', collation: 'ascii_general_ci', compiled: 'Yes' });
    if (kind === 'permission') fail = /FROM information_schema.COLLATIONS/;
    await expect(apply(next, 'apply', kind === 'revision' ? 2 : 1, kind === 'ack' ? next.requiredAcknowledgements.slice(0, 2) : next.requiredAcknowledgements)).rejects.toThrow();
    expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0); await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
  });
  it('真实目录拒绝编造候选与跨字符集组合，不能修改输出投影来改变引擎快照', async () => {
    const snapshot = await get(); snapshot.candidates.push({ charset: 'forged', collation: 'forged_ci' });
    await expect(preview(snapshot, { charset: 'forged', collation: 'forged_ci' })).rejects.toThrow('候选');
    await expect(preview(snapshot, { charset: 'latin1', collation: 'utf8mb4_bin' })).rejects.toThrow('候选'); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0);
  });
  it('MariaDB完整名称只取真实映射，缺映射不猜UCA别名', async () => {
    version = '11.4.13-MariaDB'; dialect = 'mariadb';
    const snapshot = await get(); expect(snapshot.candidates).toContainEqual({ charset: 'utf8mb4', collation: 'utf8mb4_uca1400_ai_ci' });
    expect(await apply(await preview(snapshot, { charset: 'utf8mb4', collation: 'utf8mb4_uca1400_ai_ci' }))).toMatchObject({ definitionVerified: true });
    fullNames = false; const partial = await get(); expect(partial.writable).toBe(false); expect(partial.reasons.join('')).toContain('候选'); expect(partial.warnings.join('')).toContain('完整');
  });
  it.each(['compiled', 'ambiguous', 'oversize', 'empty'] as const)('%s目录问题明确只读，不能提供伪候选', async kind => {
    if (kind === 'compiled') catalog[0].compiled = '未知';
    if (kind === 'ambiguous') catalog.push({ charset: 'latin1', collation: 'utf8mb4_bin', compiled: 'Yes' });
    if (kind === 'oversize') catalog = Array.from({ length: 8193 }, (_, n) => ({ charset: 'utf8mb4', collation: 'utf8mb4_x' + n, compiled: 'Yes' }));
    if (kind === 'empty') catalog = [];
    const snapshot = await get(); expect(snapshot.writable).toBe(false); await expect(preview(snapshot)).rejects.toThrow();
  });
  it('未知版本、物理参数、风险MariaDB默认值与无物理目录权限保持只读', async () => {
    version = '9.0.0'; expect((await get()).writable).toBe(false); version = '8.4.11';
    source = original.replace('原说明', 'MERGE_THRESHOLD=40'); expect((await get()).writable).toBe(false);
    source = original.replace('DEFAULT NULL', 'DEFAULT (1+1)'); version = '11.4.13-MariaDB'; dialect = 'mariadb'; expect((await get()).reasons.join('')).toContain('默认');
    source = original; fail = /SELECT CAST\(TABLE_ID/; expect((await get()).writable).toBe(false);
  });
  it('SELECT账户、角色或授权目录未知时只读，执行前撤销ALTER会消费令牌且零DDL', async () => {
    grants = ['GRANT SELECT ON *.* TO `unit`@`host`']; const readonly = await get(); expect(readonly.writable).toBe(false); expect(readonly.reasons.join('')).toContain('ALTER');
    grants = ['GRANT ALL PRIVILEGES ON *.* TO `unit`@`host`']; const next = await preview(await get()); grants = ['GRANT SELECT ON *.* TO `unit`@`host`']; await expect(apply(next)).rejects.toThrow('变化'); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(0);
  });
  it('服务器警告紧随ALTER读取，已完成但不伪报无损结果', async () => {
    const next = await preview(await get()); warningCount = 1; expect(await apply(next)).toMatchObject({ ddlCompleted: true, definitionVerified: false });
    const position = sent.findIndex(item => item.sql.startsWith('ALTER')); expect(sent[position + 1].sql).toBe('SHOW WARNINGS LIMIT 20');
  });
  it('已投递DDL取消等待真实终态，独立事件保持未知且令牌不可重放', async () => {
    const next = await preview(await get()); hold = /^ALTER TABLE/;
    const pending = apply(next, 'cancel-ddl').catch(error => error); await vi.waitFor(() => expect(held).toBeDefined()); await engine.handle('query.cancel', { taskId: 'cancel-ddl' });
    expect(await pending).toBeInstanceOf(Error); expect(events.at(-1)).toMatchObject({ status: 'cancelled', tableDefaultEncoding: { ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' } }); expect(events.at(-1)?.tableComment).toBeUndefined();
    await expect(apply(next, 'replay')).rejects.toThrow('已失效或已使用');
  });
  it('过期、释放及连接关闭各自撤销预览，不能跨用途释放表注释', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); const next = await preview(await get()); vi.setSystemTime(Date.now() + 120001); await expect(apply(next)).rejects.toThrow('已失效或已使用');
    const snapshot = await get(), released = await preview(snapshot); await engine.handle('schema.tableDefaultEncoding.release', { snapshotId: snapshot.snapshotId }); await expect(apply(released)).rejects.toThrow('已失效或已使用');
    const last = await preview(await get()); await engine.handle('connections.close', { id: profile.id }); await expect(apply(last)).rejects.toThrow('已失效或已使用');
  });
  it('同表租约跨预览防并发，收到OK后关闭失败仍保留已完成事实', async () => {
    const snapshot = await get(), first = await preview(snapshot), second = await preview(snapshot, { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }); hold = /^ALTER TABLE/;
    const pending = apply(first, 'first').catch(error => error); await vi.waitFor(() => expect(held).toBeDefined()); await expect(apply(second, 'second')).rejects.toThrow('已有结构变更');
    closeFails = true; held!.complete(); expect(await pending).toBeInstanceOf(Error); expect(events.at(-1)?.tableDefaultEncoding).toMatchObject({ ddlCompleted: true, outcome: 'succeeded' }); expect(sent.filter(item => item.sql.startsWith('ALTER'))).toHaveLength(1);
  });
});
