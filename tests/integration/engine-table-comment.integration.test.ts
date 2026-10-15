import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
const tracer = vi.hoisted(() => ({ ids: new Set<number>() }));
/** 只包一层真实connect记录线程编号；网络、驱动、取消控制连接和关闭均用原实现。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => { const managed = await actual.connect(...args); if (managed.connection.threadId) tracer.ids.add(managed.connection.threadId); return managed; } };
});
import { Engine } from '../../src/engine';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier, stringLiteral } from '../../src/engine/sql';
import { readTableCommentDefinition } from '../../src/engine/tableCommentSql';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { TableCommentGetOutput, TableCommentPreviewOutput } from '../../src/shared/tableComment';

// 默认关闭；本文件不读凭据文件、不创建账户、不修改全局，不自动探测私有服务器。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_COMMENT_TEST === '1';
const database = 'dbark_comment_' + randomUUID().replaceAll('-', '').slice(0, 12);
const profile: ConnectionProfile = { id: randomUUID(), name: '表注释隔离验收', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 3306), user: process.env.DBARK_TEST_USER ?? '', password: process.env.DBARK_TEST_PASSWORD ?? '', ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
const events: TaskEvent[] = [], ids = tracer.ids;
const engine = new Engine(event => events.push(event));
let observer: ManagedConnection | undefined, created = false, failed = false, version = '', dialect: 'mysql' | 'mariadb' = 'mysql';
async function sql(query: string) { return (await execute(observer!, query)).rows as Record<string, unknown>[]; }
const target = (table: string) => `${identifier(database)}.${identifier(table)}`;
async function ddl(table: string): Promise<string> { return String((await sql('SHOW CREATE TABLE ' + target(table)))[0]['Create Table']); }
async function get(table: string): Promise<TableCommentGetOutput> { return engine.handle('schema.tableComment.get', { connectionId: profile.id, database, table, taskId: randomUUID(), connectionRevision: 1 }); }
async function preview(snapshot: TableCommentGetOutput, comment: string): Promise<TableCommentPreviewOutput> { return engine.handle('schema.tableComment.preview', { snapshotId: snapshot.snapshotId, comment, taskId: randomUUID(), connectionRevision: 1 }); }
async function apply(value: TableCommentPreviewOutput, taskId = randomUUID(), revision = 1) { return engine.handle('schema.tableComment.apply', { previewToken: value.previewToken, acknowledgements: value.requiredAcknowledgements, taskId, connectionRevision: revision }); }
/** 每例自建普通InnoDB表，表名仅来自本测试固定字面量。 */
async function create(table: string, comment = '原说明') { await sql(`CREATE TABLE ${target(table)}(id BIGINT NOT NULL AUTO_INCREMENT,s VARCHAR(80) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL,g INT GENERATED ALWAYS AS (length(s)) STORED,note TEXT,PRIMARY KEY(id),KEY prefix_key(s(8)),FULLTEXT KEY ft(note)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC COMMENT=${stringLiteral(comment)}`); }

describe.skipIf(!enabled)('表注释单属性六实例核心验收（每轮显式指定一个实例）', () => {
  beforeAll(async () => {
    if (!profile.host || !profile.user || !['13357', '13380', '13384', '13310', '13311'].includes(String(profile.port))) throw new Error('必须显式提供已核对200专用实例配置');
    if (!['192.168.31.200', 'deve-server.yinzon.com'].includes(profile.host)) throw new Error('拒绝访问未核对的测试主机');
    if (profile.tls?.enabled && !profile.tls.caPath) throw new Error('严格TLS必须提供已有CA，禁止退回明文');
    observer = await connect(profile); ids.add(observer.connection.threadId!);
    const status = await engine.handle('connections.open', { id: profile.id, profile }); version = status.version; dialect = status.dialect; if (status.connectionId) ids.add(status.connectionId);
    const facts = (await sql('SELECT @@hostname AS host,@@version_compile_os AS os,@@lower_case_table_names AS names'))[0];
    console.info(JSON.stringify({ 测试库: database, 版本: version, 方言: dialect, 严格TLS: !!profile.tls?.enabled, ...facts }));
    await sql(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`); created = true;
  });
  afterEach(context => { if (context.task.result?.state === 'fail') failed = true; });
  afterAll(async () => {
    try {
      await engine.closeAll();
      if (observer && created) {
        const rows = await sql('SHOW FULL PROCESSLIST'), remaining = rows.filter(row => Number(row.Id) !== observer!.connection.threadId && (ids.has(Number(row.Id)) || row.db === database || typeof row.Info === 'string' && row.Info.includes(database)));
        if (failed) { const path = `.cache/table-comment-evidence/${database}`; await mkdir(path, { recursive: true }); await writeFile(path + '/failure.json', JSON.stringify({ version, events, ids: [...ids], remaining }, null, 2), { flag: 'wx' }); }
        expect(remaining).toHaveLength(0);
        if (!/^dbark_comment_[a-f0-9]{12}$/.test(database)) throw new Error('拒绝清理非本轮数据库');
        await sql('DROP DATABASE ' + identifier(database));
        console.info(JSON.stringify({ 已清理库: database, 实际线程编号: [...ids], 残留线程: remaining.length }));
      }
    } finally { await observer?.close({ strict: true }); }
  });
  it('复杂生成列、字符集、前缀和全文索引保持，预览零DDL，单次修改与清除完整核验', async () => {
    await create('complex'); await sql(`INSERT INTO ${target('complex')}(s,note) VALUES('abc','文本'),('def','保留数据')`);
    const before = await ddl('complex'), snapshot = await get('complex'); expect(snapshot.writable, snapshot.reasons.join('；')).toBe(true);
    const value = "中文'说明\\路径\r\n第二行", next = await preview(snapshot, value); expect(await ddl('complex')).toBe(before);
    expect(next.sql).toMatch(/^ALTER TABLE `[^`]+`\.`complex` COMMENT = /); expect(next.sql).not.toMatch(/CHANGE COLUMN|MODIFY COLUMN|CONVERT TO|ROW_FORMAT|ENGINE=/i);
    expect(await apply(next)).toMatchObject({ ddlCompleted: true, definitionVerified: true, after: { comment: value } }); await expect(apply(next)).rejects.toThrow('已失效或已使用');
    const after = await ddl('complex'), context = { dialect, mode: { noBackslashEscapes: false, ansiQuotes: false } };
    expect(readTableCommentDefinition(after, context).preserved).toBe(readTableCommentDefinition(before, context).preserved);
    expect((await sql(`SELECT id,s,g,note FROM ${target('complex')} ORDER BY id`)).map(row => [String(row.id), row.s, String(row.g), row.note])).toEqual([['1', 'abc', '3', '文本'], ['2', 'def', '3', '保留数据']]);
    const clear = await preview(await get('complex'), ''); expect(await apply(clear)).toMatchObject({ definitionVerified: true, after: { comment: '' } });
    await expect(preview(await get('complex'), '')).rejects.toThrow('没有实际');
  });
  it('引擎参数保留并只读，超预算和未证补充字符在预览前拒绝', async () => {
    await create('engine_options', 'MERGE_THRESHOLD=40'); const blocked = await get('engine_options'); expect(blocked.writable).toBe(false); await expect(preview(blocked, '不能覆盖')).rejects.toThrow();
    await create('budget'); const snapshot = await get('budget');
    await expect(preview(snapshot, '中'.repeat(683))).rejects.toThrow('字节');
    if (!snapshot.budget?.supplementary) await expect(preview(snapshot, '😀')).rejects.toThrow('补充平面');
    else expect(await apply(await preview(snapshot, '😀'))).toMatchObject({ definitionVerified: true });
  });
  it('外部定义变化、同定义DROP重建与连接修订变化拒绝旧令牌且不重放', async () => {
    await create('changes'); const next = await preview(await get('changes'), '新说明'); await sql(`ALTER TABLE ${target('changes')} COMMENT='外部修改'`); await expect(apply(next)).rejects.toThrow('变化');
    const recreated = await preview(await get('changes'), '新说明'), definition = await ddl('changes'); await sql('DROP TABLE ' + target('changes'));
    await sql(definition.replace(/^CREATE TABLE `changes`/, 'CREATE TABLE ' + target('changes'))); await expect(apply(recreated)).rejects.toThrow('身份');
    const revision = await preview(await get('changes'), '新说明'); await expect(apply(revision, randomUUID(), 2)).rejects.toThrow('配置'); await expect(apply(revision)).rejects.toThrow('已失效或已使用');
  });
  it('原生MDL等待取消保留实际未知状态，等待真实终态并关闭独立连接', async () => {
    await create('cancel_mdl'); const next = await preview(await get('cancel_mdl'), '不应修改'), taskId = randomUUID(); let pending: Promise<unknown> | undefined;
    await sql('LOCK TABLES ' + target('cancel_mdl') + ' READ');
    try {
      pending = apply(next, taskId).catch(error => error);
      await expect.poll(async () => (await sql('SHOW FULL PROCESSLIST')).some(row => ids.has(Number(row.Id)) && typeof row.Info === 'string' && row.Info.startsWith('ALTER TABLE') && /metadata lock/i.test(String(row.State))), { timeout: 12000, interval: 50 }).toBe(true);
      await engine.handle('query.cancel', { taskId }); expect(await pending).toBeInstanceOf(Error);
      expect(events.filter(event => event.taskId === taskId).at(-1)?.tableComment).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, outcome: 'unknown' });
      await expect(apply(next)).rejects.toThrow('已失效或已使用');
    } finally { await sql('UNLOCK TABLES'); await pending; }
    expect((await get('cancel_mdl')).comment).toBe('原说明');
  });
});
