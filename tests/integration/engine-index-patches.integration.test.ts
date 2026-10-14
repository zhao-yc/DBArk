import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier } from '../../src/engine/sql';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { IndexDefinition, IndexPatch } from '../../src/shared/tableIndexPatches';
import type { TableIndexGetOutput, TableIndexPreviewOutput } from '../../src/shared/tableIndexTasks';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && Boolean(process.env.DBARK_TEST_HOST);
const database = `dbark_idxpatch_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const profile: ConnectionProfile = { id: randomUUID(), name: '索引差异隔离验收', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 3306), user: process.env.DBARK_TEST_USER ?? 'root', password: process.env.DBARK_TEST_PASSWORD ?? '',
  ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}),
  ...(process.env.DBARK_TEST_SSH === '1' ? { ssh: { enabled: true, host: process.env.DBARK_TEST_SSH_HOST ?? '', port: Number(process.env.DBARK_TEST_SSH_PORT ?? 22), user: process.env.DBARK_TEST_SSH_USER ?? '', privateKeyPath: process.env.DBARK_TEST_SSH_KEY, hostFingerprint: process.env.DBARK_TEST_SSH_FINGERPRINT } } : {}) };
const events: TaskEvent[] = [], engine = new Engine(event => events.push(event));
let admin: ManagedConnection | undefined, created = false, failed = false, version = '';
/** 管理连接仅操作本轮随机库和自主夹具，不修改全局或服务器账户。 */
async function sql(text: string) { return (await execute(admin!, text)).rows as Record<string, unknown>[]; }
async function get(table: string): Promise<TableIndexGetOutput> { return engine.handle('schema.indexes.get', { connectionId: profile.id, database, table, taskId: randomUUID(), connectionRevision: 1 }); }
function ref(snapshot: TableIndexGetOutput, name: string): string { const column = snapshot.columns.find(column => column.name === name); if (!column) throw new Error('缺少夹具字段'); return column.columnRef; }
function index(snapshot: TableIndexGetOutput, name: string): string { const value = snapshot.indexes.find(item => item.name === name); if (!value) throw new Error('缺少夹具索引'); return value.indexRef; }
/** 引用来自真实快照，测试不向产品输入任意 SQL。 */
async function preview(snapshot: TableIndexGetOutput, patches: IndexPatch[]): Promise<TableIndexPreviewOutput> { return engine.handle('schema.indexes.preview', { snapshotId: snapshot.snapshotId, patches, taskId: randomUUID(), connectionRevision: 1 }); }
async function apply(value: TableIndexPreviewOutput, taskId = randomUUID()) { return engine.handle('schema.indexes.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements, taskId, connectionRevision: 1 }); }
function addition(snapshot: TableIndexGetOutput, name: string, names: string[], kind: IndexDefinition['kind'] = 'ordinary', overrides: Partial<IndexDefinition> = {}): IndexPatch {
  return { op: 'add', clientKey: randomUUID(), definition: { kind, name, method: 'BTREE', comment: '', keyParts: names.map(name => ({ columnRef: ref(snapshot, name), direction: 'asc' })), ...overrides } };
}
/** 只等待可观测的元数据锁阻塞，不能靠固定休眠推断 DDL 已提交。 */
async function waitingAlter(): Promise<void> {
  await expect.poll(async () => (await sql('SHOW FULL PROCESSLIST')).some(row => typeof row.Info === 'string' && row.Info.startsWith('ALTER TABLE') && row.Info.includes(database) && /metadata lock/i.test(String(row.State))), { timeout: 12000, interval: 50 }).toBe(true);
}
describe.skipIf(!enabled)('真实索引差异、主键与有限依赖保护', () => {
  beforeAll(async () => {
    const status = await engine.handle('connections.open', { id: profile.id, profile }); version = status.version;
    admin = await connect(profile);
    await sql(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`); created = true; await sql(`USE ${identifier(database)}`);
    const facts = (await sql('SELECT @@version_compile_os AS compileOs, @@lower_case_table_names AS lowerCaseTableNames, @@innodb_page_size AS pageSize'))[0];
    console.info(JSON.stringify({ 验收库: database, 版本: version, ...facts, SSH: !!profile.ssh?.enabled, 严格TLS: !!profile.tls?.enabled }));
  });
  afterEach(context => { if (context.task.result?.state === 'fail') failed = true; });
  afterAll(async () => {
    try {
      await engine.closeAll();
      if (admin && created) {
        const rows = await sql('SHOW FULL PROCESSLIST'), remaining = rows.filter(row => Number(row.Id) !== admin!.connection.threadId && (row.db === database || (typeof row.Info === 'string' && row.Info.includes(database))));
        if (failed) {
          const directory = join('.cache/o09-index-product-evidence', database); await mkdir(directory, { recursive: true });
          const tables = await sql('SHOW FULL TABLES'), definitions: unknown[] = [];
          for (const table of tables) if (typeof Object.values(table)[0] === 'string') definitions.push(...await sql(`SHOW CREATE TABLE ${identifier(Object.values(table)[0] as string)}`));
          await writeFile(join(directory, 'failure.json'), JSON.stringify({ database, version, definitions, events, remaining }, null, 2), { flag: 'wx' });
        }
        console.info(JSON.stringify({ 清理库: database, 残留线程: remaining.map(row => row.Id), 失败证据已保留: failed }));
        if (!remaining.length) await sql(`DROP DATABASE ${identifier(database)}`); expect(remaining).toHaveLength(0);
      }
    } finally { await admin?.close({ strict: true }); }
  });
  it('真实目录完整、能力受证，普通旧键支持可证明的删除与改名', async () => {
    await sql('CREATE TABLE baseline(id INT NOT NULL,a INT,b INT,PRIMARY KEY(id),KEY ia(a)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    const snapshot = await get('baseline'); expect(snapshot.writable).toBe(true); expect(snapshot.incomingCoverage).toEqual({ kind: 'complete', source: 'innodb-dictionary' });
    expect(snapshot.indexes.find(item => item.name === 'ia')?.access).toMatchObject({ drop: { allowed: true }, rename: { allowed: true }, replace: { allowed: true } });
  });
  it('复合键新增、原生改名、替换列序与删除均保留原字段和复杂注释', async () => {
    await sql('CREATE TABLE operations(id INT NOT NULL,a INT,b INT,PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    await sql('INSERT INTO operations VALUES(1,10,20),(2,11,21)');
    let snapshot = await get('operations'); const comment = "索引'注释\\末\n下一行";
    expect(await apply(await preview(snapshot, [addition(snapshot, 'ix', ['b', 'a'], 'ordinary', { comment })]))).toMatchObject({ definitionVerified: true });
    snapshot = await get('operations'); let value = await preview(snapshot, [{ op: 'alter', indexRef: index(snapshot, 'ix'), changes: { name: '中文`索引' } }]);
    expect(value.sql).toContain('RENAME INDEX'); expect(value.sql).not.toContain('DROP INDEX'); expect(await apply(value)).toMatchObject({ definitionVerified: true });
    snapshot = await get('operations'); value = await preview(snapshot, [{ op: 'alter', indexRef: index(snapshot, '中文`索引'), changes: { keyParts: [{ columnRef: ref(snapshot, 'a'), direction: 'asc' }, { columnRef: ref(snapshot, 'b'), direction: 'asc' }] } }]);
    expect(value.sql).toContain('DROP INDEX'); expect(await apply(value)).toMatchObject({ definitionVerified: true });
    snapshot = await get('operations'); expect(await apply(await preview(snapshot, [{ op: 'drop', indexRef: index(snapshot, '中文`索引') }]))).toMatchObject({ definitionVerified: true });
    expect(await sql('SELECT * FROM operations ORDER BY id')).toEqual([{ id: 1, a: 10, b: 20 }, { id: 2, a: 11, b: 21 }]);
    // SSH 下此例累计四次独立 get/preview/apply，保留所有生产连接/取消超时，仅给多操作验收足够总时间。
  }, 120000);
  it('VARCHAR 字符前缀与 VARBINARY 字节前缀可精确生成并后核验', async () => {
    await sql('CREATE TABLE prefixes(id INT NOT NULL,v VARCHAR(20),bytes VARBINARY(40),PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    const snapshot = await get('prefixes');
    const a = addition(snapshot, 'iv', ['v'], 'ordinary', { keyParts: [{ columnRef: ref(snapshot, 'v'), prefixLength: 2, direction: 'asc' }] });
    const b = addition(snapshot, 'ib', ['bytes'], 'ordinary', { keyParts: [{ columnRef: ref(snapshot, 'bytes'), prefixLength: 4, direction: 'asc' }] });
    expect(await apply(await preview(snapshot, [a, b]))).toMatchObject({ definitionVerified: true });
    const statistics = await sql(`SELECT INDEX_NAME,SUB_PART FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='prefixes' AND INDEX_NAME<>'PRIMARY' ORDER BY INDEX_NAME`);
    expect(statistics.map(row => ({ name: row.INDEX_NAME, prefix: String(row.SUB_PART) }))).toEqual([{ name: 'ib', prefix: '4' }, { name: 'iv', prefix: '2' }]);
  });
  it('TEXT 与 BLOB 只接受显式前缀，不接受服务器自动截短', async () => {
    await sql('CREATE TABLE lob_prefix(id INT NOT NULL,txt TEXT,bytes BLOB,PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    const snapshot = await get('lob_prefix'); await expect(preview(snapshot, [addition(snapshot, 'bad', ['txt'])])).rejects.toThrow('显式指定');
    const patches = ['txt', 'bytes'].map((name, position) => addition(snapshot, 'i' + position, [name], 'ordinary', { keyParts: [{ columnRef: ref(snapshot, name), prefixLength: 8, direction: 'asc' }] }));
    expect(await apply(await preview(snapshot, patches))).toMatchObject({ definitionVerified: true });
  });
  it('DESC 在 5.7 投递前拒绝，其余基线保留目录 D 方向', async () => {
    await sql('CREATE TABLE descending_case(id INT NOT NULL,a INT,PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    const snapshot = await get('descending_case'), patch = addition(snapshot, 'idesc', ['a'], 'ordinary', { keyParts: [{ columnRef: ref(snapshot, 'a'), direction: 'desc' }] });
    if (/^5\.7\./.test(version)) { await expect(preview(snapshot, [patch])).rejects.toThrow('DESC'); return; }
    expect(await apply(await preview(snapshot, [patch]))).toMatchObject({ definitionVerified: true });
    expect((await sql("SELECT COLLATION FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='descending_case' AND INDEX_NAME='idesc'"))[0].COLLATION).toBe('D');
  });
  it('真实唯一性按服务器排序规则校验，重复错误不会重放或伪报未执行', async () => {
    await sql('CREATE TABLE duplicate_case(id INT NOT NULL,v VARCHAR(20),PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC'); await sql("INSERT INTO duplicate_case VALUES(1,'甲A'),(2,'甲B')");
    const snapshot = await get('duplicate_case'), patch = addition(snapshot, 'uv', ['v'], 'unique', { keyParts: [{ columnRef: ref(snapshot, 'v'), prefixLength: 1, direction: 'asc' }] }), value = await preview(snapshot, [patch]), taskId = randomUUID();
    await expect(apply(value, taskId)).rejects.toMatchObject({ errno: 1062 }); expect(events.filter(event => event.taskId === taskId).at(-1)?.indexPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
    await expect(apply(value)).rejects.toThrow('已失效或已使用'); expect((await get('duplicate_case')).ddlHash).toBe(snapshot.ddlHash);
    const next = await get('duplicate_case'); expect(await apply(await preview(next, [addition(next, 'uv', ['v'], 'unique', { keyParts: [{ columnRef: ref(next, 'v'), prefixLength: 2, direction: 'asc' }] })]))).toMatchObject({ definitionVerified: true });
  });
  it('显式主键替换要求两项额外确认并保留已有 NOT NULL，不自动修数据', async () => {
    await sql('CREATE TABLE primary_case(id INT NOT NULL,a INT NOT NULL,PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    const snapshot = await get('primary_case'), value = await preview(snapshot, [{ op: 'alter', indexRef: index(snapshot, 'PRIMARY'), changes: { keyParts: [{ columnRef: ref(snapshot, 'a'), direction: 'asc' }, { columnRef: ref(snapshot, 'id'), direction: 'asc' }] } }]);
    expect(value.requiredAcknowledgements).toContain('drop-unique-constraint'); expect(value.requiredAcknowledgements).toContain('primary-key-change'); expect(await apply(value)).toMatchObject({ definitionVerified: true });
  });
  it('自增列的最后支持键及可空列主键在预览拒绝', async () => {
    await sql('CREATE TABLE autoincrement_case(id INT NOT NULL AUTO_INCREMENT,a INT NULL,PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    const snapshot = await get('autoincrement_case'); await expect(preview(snapshot, [{ op: 'drop', indexRef: index(snapshot, 'PRIMARY') }])).rejects.toThrow('自增');
    await expect(preview(snapshot, [{ op: 'alter', indexRef: index(snapshot, 'PRIMARY'), changes: { keyParts: [{ columnRef: ref(snapshot, 'a'), direction: 'asc' }] } }])).rejects.toThrow('NOT NULL');
  });
  it('出向外键旧支持键删除被拒，原生改名保留实际约束', async () => {
    await sql('CREATE TABLE parent_case(id INT NOT NULL,PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    await sql('CREATE TABLE child_case(id INT NOT NULL,pid INT,PRIMARY KEY(id),KEY ipid(pid),CONSTRAINT fk_child FOREIGN KEY(pid) REFERENCES parent_case(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    const snapshot = await get('child_case'); await expect(preview(snapshot, [{ op: 'drop', indexRef: index(snapshot, 'ipid') }])).rejects.toThrow('外键');
    expect(await apply(await preview(snapshot, [{ op: 'alter', indexRef: index(snapshot, 'ipid'), changes: { name: 'ipid_renamed' } }]))).toMatchObject({ definitionVerified: true });
    await expect(sql('INSERT INTO child_case VALUES(1,9999)')).rejects.toMatchObject({ errno: 1452 });
  });
  it('外部子表新增 FK 不改父表 SHOW CREATE 仍使旧预览在执行前失效', async () => {
    await sql('CREATE TABLE drift_parent(id INT NOT NULL,a INT,PRIMARY KEY(id),KEY ia(a)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    const snapshot = await get('drift_parent'), value = await preview(snapshot, [{ op: 'alter', indexRef: index(snapshot, 'ia'), changes: { name: 'renamed' } }]);
    await sql('CREATE TABLE drift_child(pid INT,CONSTRAINT fk_drift FOREIGN KEY(pid) REFERENCES drift_parent(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    await expect(apply(value)).rejects.toThrow('依赖已变化'); expect((await get('drift_parent')).indexes.some(item => item.name === 'ia')).toBe(true);
  });
  it('索引操作不结束查询标签中的事务或删除临时表', async () => {
    await sql('CREATE TABLE isolation_case(id INT NOT NULL,a INT,PRIMARY KEY(id),KEY ia(a)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    const { sessionId } = await engine.handle('sessions.open', { connectionId: profile.id, database });
    try {
      await engine.handle('query.execute', { sessionId, sql: 'CREATE TEMPORARY TABLE own_temp(v INT);INSERT INTO own_temp VALUES(7);START TRANSACTION;INSERT INTO isolation_case VALUES(1,10);', maxRows: 10, taskId: randomUUID() });
      // 自己未提交的写入会阻塞 ALTER，所以先回滚本表写入，事务另绑临时表；仍维持真实打开事务。
      await engine.handle('query.transaction', { sessionId, action: 'rollback' }); await engine.handle('query.transaction', { sessionId, action: 'begin' });
      const snapshot = await get('isolation_case'); expect(await apply(await preview(snapshot, [addition(snapshot, 'ib', ['a'])]))).toMatchObject({ definitionVerified: true });
      expect(await engine.handle('query.sessionState', { sessionId })).toMatchObject({ transactionOpen: true, transactionKnown: true });
      const result = await engine.handle('query.execute', { sessionId, sql: 'SELECT v FROM own_temp', maxRows: 10, taskId: randomUUID() }); expect(result.results[0].rows[0][result.results[0].columns[0].key]).toBe(7);
    } finally { await engine.handle('query.transaction', { sessionId, action: 'rollback' }); await engine.handle('sessions.close', { sessionId }); }
  });
  it('真实元数据锁上的 ALTER 取消后等待终态，库中线程清零且原索引未丢失', async () => {
    await sql('CREATE TABLE cancel_case(id INT NOT NULL,a INT,PRIMARY KEY(id),KEY ia(a)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    const snapshot = await get('cancel_case'), value = await preview(snapshot, [{ op: 'alter', indexRef: index(snapshot, 'ia'), changes: { name: 'cancelled_name' } }]);
    await sql('LOCK TABLES cancel_case READ'); const taskId = randomUUID(), operation = apply(value, taskId).catch(error => error);
    try { await waitingAlter(); await engine.handle('query.cancel', { taskId }); expect(await operation).toBeInstanceOf(Error); }
    finally { await sql('UNLOCK TABLES'); }
    expect(events.filter(event => event.taskId === taskId).at(-1)).toMatchObject({ status: 'cancelled', indexPatch: { ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' } });
    expect((await get('cancel_case')).indexes.map(index => index.name)).toContain('ia');
  });
  it('全文与生成列旧索引只读，普通新键可添加并核验未改原片段', async () => {
    await sql('CREATE TABLE opaque_case(id INT NOT NULL,a VARCHAR(40),g INT GENERATED ALWAYS AS (length(a)) STORED,PRIMARY KEY(id),FULLTEXT KEY ft(a),KEY ig(g)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    const snapshot = await get('opaque_case');
    for (const name of ['ft', 'ig']) expect(snapshot.indexes.find(item => item.name === name)?.access).toMatchObject({ drop: { allowed: false }, rename: { allowed: false }, replace: { allowed: false } });
    expect(await apply(await preview(snapshot, [addition(snapshot, 'ia', ['a'])]))).toMatchObject({ definitionVerified: true });
  });
  it('MySQL8 表达式及不可见旧键保持只读，新增普通键不改原属性', async ({ skip }) => {
    if (!/^8\./.test(version)) { skip(); return; }
    await sql('CREATE TABLE expression_case(id INT NOT NULL,a VARCHAR(40),PRIMARY KEY(id),KEY func((lower(a))),KEY hidden_key(a) INVISIBLE) ENGINE=InnoDB ROW_FORMAT=DYNAMIC');
    const snapshot = await get('expression_case');
    for (const name of ['func', 'hidden_key']) expect(snapshot.indexes.find(item => item.name === name)?.access.drop.allowed).toBe(false);
    expect(await apply(await preview(snapshot, [addition(snapshot, 'iid', ['id'])]))).toMatchObject({ definitionVerified: true });
  });
  it('MySQL8 生成不可见主键在短会话完整显示且受保护', async ({ skip }) => {
    if (!/^8\./.test(version)) { skip(); return; }
    await sql('SET SESSION sql_generate_invisible_primary_key=ON');
    try { await sql('CREATE TABLE gipk_case(a INT) ENGINE=InnoDB ROW_FORMAT=DYNAMIC'); }
    finally { await sql('SET SESSION sql_generate_invisible_primary_key=OFF'); }
    await sql('SET SESSION show_gipk_in_create_table_and_information_schema=OFF');
    try {
      const snapshot = await get('gipk_case'); expect(snapshot.columns.some(column => column.name === 'my_row_id' && column.hidden)).toBe(true);
      expect(snapshot.indexes.find(item => item.name === 'PRIMARY')?.access).toMatchObject({ drop: { allowed: false }, rename: { allowed: false }, replace: { allowed: false } });
      expect(await apply(await preview(snapshot, [addition(snapshot, 'ia', ['a'])]))).toMatchObject({ definitionVerified: true });
    } finally { await sql('SET SESSION show_gipk_in_create_table_and_information_schema=ON'); }
  });
});
