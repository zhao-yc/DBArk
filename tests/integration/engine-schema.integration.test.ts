import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Engine } from '../../src/engine';
import type { ConnectionProfile, QueryOutcome, SqlPreview, TableDesign, TableInfo } from '../../src/shared/contracts';
import { identifier } from '../../src/engine/sql';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && Boolean(process.env.DBARK_TEST_HOST);
const database = `dbark_test_design_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
const profile: ConnectionProfile = { id: 'schema-fixture', name: '结构差异验收', group: '', color: '#123456', dialect: 'mysql', host: process.env.DBARK_TEST_HOST ?? '', port: Number(process.env.DBARK_TEST_PORT ?? 3306), user: process.env.DBARK_TEST_USER ?? 'root', password: process.env.DBARK_TEST_PASSWORD ?? '' };
const engine = new Engine();
let sessionId = '', adminSession = '', created = false;

/** 通过真实会话准备约束和验证写入行为，不依赖 UI 的表面成功状态。 */
async function query(sql: string, session = sessionId): Promise<QueryOutcome> { return engine.handle('query.execute', { sessionId: session, sql, maxRows: 100, taskId: randomUUID() }); }
/** 从真实元数据构建设计器使用的相同结构，保留未编辑的默认值及约束。 */
async function designFor(table: string): Promise<TableDesign> {
  const info: TableInfo = await engine.handle('metadata.table', { connectionId: profile.id, database, table });
  return { database, name: table, originalName: table, engine: info.engine, charset: info.charset ?? 'utf8mb4', comment: info.comment ?? '',
    columns: info.columns.map(column => ({ name: column.name, originalName: column.name, type: column.type, nullable: column.nullable, defaultValue: column.defaultValue === null && !column.nullable ? undefined : column.defaultValue, autoIncrement: column.extra.toLowerCase().includes('auto_increment'), comment: column.comment })), indexes: info.indexes, foreignKeys: info.foreignKeys };
}
/** 执行用户能够完整查看的预览文本，覆盖多条DDL的实际执行顺序。 */
async function apply(preview: SqlPreview): Promise<QueryOutcome> { return engine.handle('schema.apply', { connectionId: profile.id, database, sql: preview.sql, taskId: randomUUID() }); }

describe.skipIf(!enabled)('真实数据库已有表结构差异', () => {
  beforeAll(async () => {
    const status = await engine.handle('connections.open', { id: profile.id, profile }); console.info(`结构验收版本：${status.version}`);
    adminSession = (await engine.handle('sessions.open', { connectionId: profile.id })).sessionId;
    await query(`CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`, adminSession); created = true;
    sessionId = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    await query("CREATE TABLE parents (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB; CREATE TABLE children (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, parent_id BIGINT UNSIGNED NOT NULL, code VARCHAR(80) NOT NULL, note VARCHAR(100) NULL, UNIQUE KEY uq_children_code(code), CONSTRAINT fk_children_parent FOREIGN KEY(parent_id) REFERENCES parents(id) ON UPDATE CASCADE ON DELETE CASCADE) ENGINE=InnoDB; INSERT INTO parents VALUES(1); INSERT INTO children VALUES(1,1,'唯一值','待改列')");
  });
  afterAll(async () => {
    try { if (sessionId) await engine.handle('sessions.close', { sessionId }); if (created) await query(`DROP DATABASE ${identifier(database)}`, adminSession); }
    finally { await engine.closeAll(); }
  });
  it('普通列改名扩容和新增列保留PK、unique及同名FK并维持约束', async () => {
    const design = await designFor('children');
    design.columns[3] = { ...design.columns[3], name: 'note_edited', type: 'varchar(200)' };
    design.columns.push({ name: 'flag', type: 'int', nullable: false, defaultValue: '7', autoIncrement: false, comment: '' });
    const preview: SqlPreview = await engine.handle('schema.preview', { connectionId: profile.id, design });
    expect(preview.statements).toHaveLength(1); expect(preview.sql).not.toContain('DROP FOREIGN KEY'); expect(preview.sql).not.toContain('DROP PRIMARY KEY');
    await apply(preview);
    const info: TableInfo = await engine.handle('metadata.table', { connectionId: profile.id, database, table: 'children' });
    expect(info.columns.find(column => column.name === 'note_edited')?.type.toLowerCase()).toBe('varchar(200)');
    expect(info.indexes).toContainEqual({ name: 'uq_children_code', unique: true, columns: ['code'] });
    expect(info.foreignKeys[0]).toMatchObject({ name: 'fk_children_parent', onDelete: 'CASCADE', onUpdate: 'CASCADE' });
    expect((await query('SELECT note_edited,flag FROM children')).results[0].rows[0]).toEqual({ c0: '待改列', c1: 7 });
    await expect(query("INSERT INTO children(parent_id,code) VALUES(99,'无父级')")).rejects.toThrow();
    await expect(query("INSERT INTO children(parent_id,code) VALUES(1,'唯一值')")).rejects.toThrow();
  });
  it('同名外键改删除动作展示分步风险，并实际按新动作约束', async () => {
    const design = await designFor('children'); design.foreignKeys[0].onDelete = 'RESTRICT';
    const preview: SqlPreview = await engine.handle('schema.preview', { connectionId: profile.id, design });
    expect(preview.statements).toHaveLength(2); expect(preview.warnings.join('')).toContain('旧外键已删除');
    await apply(preview);
    const info: TableInfo = await engine.handle('metadata.table', { connectionId: profile.id, database, table: 'children' });
    expect(info.foreignKeys[0]).toMatchObject({ name: 'fk_children_parent', onDelete: 'RESTRICT' });
    await expect(query('DELETE FROM parents WHERE id=1')).rejects.toThrow();
    expect((await query('SELECT COUNT(*) FROM children')).results[0].rows[0].c0).toBe('1');
  });
});
