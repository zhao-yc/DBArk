import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
const tracer = vi.hoisted(() => ({ ids: new Set<number>() }));
/** 只包真实connect记录所有实际线程，包括取消控制连接；不替换网络或驱动。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => { const managed = await actual.connect(...args); if (managed.connection.threadId) tracer.ids.add(managed.connection.threadId); return managed; } };
});
import { Engine } from '../../src/engine';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier, stringLiteral } from '../../src/engine/sql';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import { definitionOmittingSqlModes } from '../../src/shared/tableColumnPatches';
import type { TableDefaultEncodingGetOutput, TableDefaultEncodingPreviewOutput, TableEncodingPair } from '../../src/shared/tableDefaultEncoding';
import { assertDefaultEncodingLiveTarget } from '../helpers/tableDefaultEncodingTarget';

// 两个开关必须同时显式启用；不读凭据文件、不创建账户、不访问其他服务器。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_DEFAULT_ENCODING_TEST === '1';
const database = 'dbark_defaults_' + randomUUID().replaceAll('-', '').slice(0, 12);
const profile: ConnectionProfile = { id: randomUUID(), name: '默认编码隔离验收', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 3306), user: process.env.DBARK_TEST_USER ?? '', password: process.env.DBARK_TEST_PASSWORD ?? '', ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
const events: TaskEvent[] = [], ids = tracer.ids, engine = new Engine(event => events.push(event));
let observer: ManagedConnection | undefined, created = false, failed = false, version = '', dialect: 'mysql' | 'mariadb' = 'mysql';
const general = { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }, latin = { charset: 'latin1', collation: 'latin1_swedish_ci' };
async function sql(query: string) { return (await execute(observer!, query)).rows as Record<string, unknown>[]; }
const target = (table: string) => `${identifier(database)}.${identifier(table)}`;
async function ddl(table: string) { return String((await sql('SHOW CREATE TABLE ' + target(table)))[0]['Create Table']); }
async function get(table: string): Promise<TableDefaultEncodingGetOutput> { return engine.handle('schema.tableDefaultEncoding.get', { connectionId: profile.id, database, table, taskId: randomUUID(), connectionRevision: 1 }); }
async function preview(snapshot: TableDefaultEncodingGetOutput, pair: TableEncodingPair = general): Promise<TableDefaultEncodingPreviewOutput> { return engine.handle('schema.tableDefaultEncoding.preview', { snapshotId: snapshot.snapshotId, ...pair, taskId: randomUUID(), connectionRevision: 1 }); }
async function apply(value: TableDefaultEncodingPreviewOutput, taskId = randomUUID(), revision = 1) { return engine.handle('schema.tableDefaultEncoding.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements, taskId, connectionRevision: revision }); }
async function create(table: string) { await sql(`CREATE TABLE ${target(table)}(id INT NOT NULL,PRIMARY KEY(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC`); }
/** 外部观察只用于断言；生产任务仍自行读取、预览和执行。 */
async function columns(table: string) { return sql(`SELECT COLUMN_NAME,CHARACTER_SET_NAME,COLLATION_NAME,GENERATION_EXPRESSION,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=${stringLiteral(database)} AND TABLE_NAME=${stringLiteral(table)} ORDER BY ORDINAL_POSITION`); }
async function data() { return sql(`SELECT CAST(id AS CHAR) AS id,HEX(s) AS s,HEX(code) AS code,HEX(note) AS note,HEX(b) AS b,CAST(g AS CHAR) AS g FROM ${target('complex')} ORDER BY id`); }

describe.skipIf(!enabled)('表默认编码六实例核心验收（每轮显式指定一个实例）', () => {
  beforeAll(async () => {
    assertDefaultEncodingLiveTarget({ host: profile.host, port: profile.port, tlsFlag: process.env.DBARK_TEST_TLS, caPath: process.env.DBARK_TEST_CA }, profile);
    if (!profile.user) throw new Error('必须显式提供隔离实例测试账户');
    observer = await connect(profile); const status = await engine.handle('connections.open', { id: profile.id, profile }); version = status.version; dialect = status.dialect;
    // 仅规范本例observer，与产品完整定义显示策略一致，不改全局。
    const mode = String((await sql('SELECT @@SESSION.sql_mode AS mode'))[0].mode), omitted = new Set<string>(definitionOmittingSqlModes);
    await sql('SET SESSION sql_mode=' + stringLiteral(mode.split(',').filter(value => !omitted.has(value.toUpperCase())).join(','), mode.includes('NO_BACKSLASH_ESCAPES'))); await sql('SET SESSION sql_quote_show_create=1');
    const facts = (await sql('SELECT @@hostname AS host,@@version_compile_os AS os,@@lower_case_table_names AS names'))[0];
    console.info(JSON.stringify({ 测试库: database, 版本: version, 方言: dialect, 严格TLS: !!profile.tls?.enabled, ...facts }));
    await sql(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`); created = true;
  });
  afterEach(context => { if (context.task.result?.state === 'fail') failed = true; });
  afterAll(async () => {
    try {
      await engine.closeAll();
      if (observer && created) {
        const remaining = (await sql('SHOW FULL PROCESSLIST')).filter(row => Number(row.Id) !== observer!.connection.threadId && (ids.has(Number(row.Id)) || row.db === database || typeof row.Info === 'string' && row.Info.includes(database)));
        if (failed) { const path = `.cache/default-encoding-evidence/${database}`; await mkdir(path, { recursive: true }); await writeFile(path + '/failure.json', JSON.stringify({ version, events, ids: [...ids], remaining }, null, 2), { flag: 'wx' }); }
        expect(remaining).toHaveLength(0); if (!/^dbark_defaults_[a-f0-9]{12}$/.test(database)) throw new Error('拒绝清理非本轮数据库');
        await sql('DROP DATABASE ' + identifier(database)); console.info(JSON.stringify({ 已清理库: database, 实际线程编号: [...ids], 残留线程: remaining.length }));
      }
    } finally { await observer?.close({ strict: true }); }
  });
  it('目录成对、预览零DDL；同字符集及跨字符集默认值变化保留列/表达式/键/外键/触发器和真实数据', async () => {
    await sql(`CREATE TABLE ${target('parent')}(code VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,PRIMARY KEY(code)) ENGINE=InnoDB`);
    await sql(`CREATE TABLE ${target('complex')}(id BIGINT NOT NULL AUTO_INCREMENT,s VARCHAR(80),code VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin,note TEXT,b VARBINARY(16),g INT GENERATED ALWAYS AS(CHAR_LENGTH(s)) STORED,PRIMARY KEY(id),KEY pref(s(8)),KEY fk_support(code),FULLTEXT KEY ft(note),CONSTRAINT fk_parent FOREIGN KEY(code) REFERENCES ${target('parent')}(code)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC COMMENT='保留说明'`);
    await sql(`CREATE TRIGGER ${target('keep_trigger')} BEFORE INSERT ON ${target('complex')} FOR EACH ROW SET NEW.code=UPPER(NEW.code)`);
    await sql(`INSERT INTO ${target('parent')} VALUES('ABC')`); await sql(`INSERT INTO ${target('complex')}(s,code,note,b) VALUES('中文😀','abc','文本',X'00FF805C27')`);
    const initialColumns = await columns('complex'), initialData = await data(), triggers = await sql(`SELECT TRIGGER_NAME,ACTION_STATEMENT,EVENT_MANIPULATION,ACTION_TIMING FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=${stringLiteral(database)}`);
    for (const selection of [general, latin]) {
      const snapshot = await get('complex'); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true); expect(snapshot.candidates).toContainEqual(selection);
      const before = await ddl('complex'), next = await preview(snapshot, selection); expect(await ddl('complex')).toBe(before);
      expect(next.sql).not.toMatch(/CONVERT TO|CHANGE COLUMN|MODIFY COLUMN|ENGINE=|ROW_FORMAT/i); expect(await apply(next)).toMatchObject({ definitionVerified: true, after: { current: selection } });
      await expect(apply(next)).rejects.toThrow('已失效或已使用'); expect(await columns('complex')).toEqual(initialColumns); expect(await data()).toEqual(initialData);
    }
    expect(await sql(`SELECT TRIGGER_NAME,ACTION_STATEMENT,EVENT_MANIPULATION,ACTION_TIMING FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=${stringLiteral(database)}`)).toEqual(triggers);
    const current = await get('complex'); expect(current.current).toEqual(latin); await expect(preview(current, latin)).rejects.toThrow('没有实际');
    await sql(`ALTER TABLE ${target('complex')} ADD COLUMN future_value VARCHAR(20)`); const future = (await columns('complex')).find(column => column.COLUMN_NAME === 'future_value'); expect(future).toMatchObject({ CHARACTER_SET_NAME: latin.charset, COLLATION_NAME: latin.collation }); expect(await data()).toEqual(initialData);
  });
  it('失配配对和物理参数明确拒绝，不猜默认值或放开已有引擎配置', async () => {
    await create('candidate'); const snapshot = await get('candidate'); await expect(preview(snapshot, { charset: 'latin1', collation: 'utf8mb4_bin' })).rejects.toThrow('候选');
    await sql(`ALTER TABLE ${target('candidate')} COMMENT='MERGE_THRESHOLD=40'`); const blocked = await get('candidate'); expect(blocked.writable).toBe(false); await expect(preview(blocked)).rejects.toThrow();
  });
  it('外部变更、独立无自增同DDL重建和修订变化拒绝旧预览，不复用旧表注释夹具', async () => {
    await create('changed'); const changed = await preview(await get('changed')); await sql(`ALTER TABLE ${target('changed')} COMMENT='外部修改'`); await expect(apply(changed)).rejects.toThrow('变化');
    await create('recreated'); const initial = await ddl('recreated'), next = await preview(await get('recreated'));
    await sql('DROP TABLE ' + target('recreated')); await sql(initial.replace(/^CREATE TABLE `recreated`/, 'CREATE TABLE ' + target('recreated')));
    const after = await ddl('recreated'); expect(after, '夹具必须先证明完整定义相同，不能把定义变化冒充物理身份验收').toBe(initial); await expect(apply(next)).rejects.toThrow('身份');
    const revision = await preview(await get('recreated')); await expect(apply(revision, randomUUID(), 2)).rejects.toThrow('配置'); await expect(apply(revision)).rejects.toThrow('已失效或已使用');
  });
  it('真实MDL取消等待原任务终态，保持已发送未知事实及旧默认值，不重放', async () => {
    await create('cancel_mdl'); const snapshot = await get('cancel_mdl'), next = await preview(snapshot), taskId = randomUUID(); let pending: Promise<unknown> | undefined;
    await sql('LOCK TABLES ' + target('cancel_mdl') + ' READ');
    try {
      pending = apply(next, taskId).catch(error => error);
      await expect.poll(async () => (await sql('SHOW FULL PROCESSLIST')).some(row => ids.has(Number(row.Id)) && typeof row.Info === 'string' && row.Info.startsWith('ALTER TABLE') && /metadata lock/i.test(String(row.State))), { timeout: 12000, interval: 50 }).toBe(true);
      await engine.handle('query.cancel', { taskId }); expect(await pending).toBeInstanceOf(Error); expect(events.filter(event => event.taskId === taskId).at(-1)?.tableDefaultEncoding).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' }); await expect(apply(next)).rejects.toThrow('已失效或已使用');
    } finally { await sql('UNLOCK TABLES'); await pending; }
    expect((await get('cancel_mdl')).current).toEqual(snapshot.current);
  });
});
