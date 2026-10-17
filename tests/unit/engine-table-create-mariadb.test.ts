import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { TableCreateTasks } from '../../src/engine/tableCreateTasks';
import type { StructureTaskHost } from '../../src/engine/structureDefinition';
import type { ManagedConnection } from '../../src/engine/connection';
import { tableCreateAcknowledgements } from '../../src/shared/tableCreate';

/** 真实generic建表任务及解析器，只替换查询结果；Maria目录样本不是MySQL能力放行。 */
function fixture(version: string, wrongDefault = false, failAfterAck = false, mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION') {
  const sent: string[] = []; let created = false;
  const connection = Object.assign(new EventEmitter(), { query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push(sql); let rows: unknown;
    if (sql.startsWith('SELECT @@hostname')) rows = [{ hostname: '合成Maria', port: 13310, serverId: 27, currentUser: 'unit@host', sqlMode: mode, lowerNames: 0, charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
    else if (sql.startsWith('SELECT SCHEMA_NAME')) rows = [{ name: 'db', charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
    else if (sql.startsWith('SELECT TABLE_NAME')) rows = [];
    else if (sql.startsWith('CREATE TABLE')) { created = true; rows = { affectedRows: 0, warningStatus: 0 }; }
    else if (sql.startsWith('SHOW CREATE')) {
      if (failAfterAck) { callback(Error('合成SHOW权限未知')); return; }
      rows = [{ 'Create Table': "CREATE TABLE `new_table` (`id` int(11) NOT NULL,`literal_null` varchar(64) DEFAULT 'NULL',`note` varchar(64) DEFAULT '普通默认',PRIMARY KEY (`id`),UNIQUE KEY `uq_literal` (`literal_null`),KEY `ix_note` (`note`,`id`)) ENGINE=InnoDB" }];
    } else if (sql.startsWith('SELECT t.TABLE_NAME')) rows = [{ name: 'new_table', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '' }];
    else if (sql.startsWith('SELECT COLUMN_NAME')) rows = [{ name: 'id', type: 'int(11)', nullable: 'NO', defaultValue: null, extra: '', comment: '' }, { name: 'literal_null', type: 'varchar(64)', nullable: 'YES', defaultValue: wrongDefault ? 'NULL' : "'NULL'", extra: '', comment: '' }, { name: 'note', type: 'varchar(64)', nullable: 'YES', defaultValue: "'普通默认'", extra: '', comment: '' }];
    else if (sql.startsWith('SELECT INDEX_NAME')) rows = [
      { name: 'PRIMARY', nonUnique: 0, column: 'id', sequence: 1, subPart: null, method: 'BTREE', direction: 'A', comment: '' },
      { name: 'ix_note', nonUnique: 1, column: 'note', sequence: 1, subPart: null, method: 'BTREE', direction: 'A', comment: '' },
      { name: 'ix_note', nonUnique: 1, column: 'id', sequence: 2, subPart: null, method: 'BTREE', direction: 'A', comment: '' },
      { name: 'uq_literal', nonUnique: 0, column: 'literal_null', sequence: 1, subPart: null, method: 'BTREE', direction: 'A', comment: '' },
    ];
    else { callback(Error('拒绝未声明查询')); return; }
    queueMicrotask(() => callback(null, rows, []));
  } });
  const host: StructureTaskHost = { async run(_connectionId, _taskId, action, options) { const result = await action({ managed: { connection, broken: false, status: { dialect: 'mariadb', version } } as unknown as ManagedConnection, checkCancelled() {}, report() {}, commandStarted: () => () => {} }); options.onResourcesReleased?.(); return result; } };
  const tasks = new TableCreateTasks(host);
  return { sent, created: () => created, async run() {
    const snapshot = await tasks.get({ connectionId: 'c', database: 'db', taskId: 'get' }, 1);
    const preview = await tasks.preview({ snapshotId: snapshot.snapshotId, taskId: 'preview', design: { database: 'db', name: 'new_table', engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: [{ name: 'id', type: 'int', nullable: false, autoIncrement: false, comment: '' }, { name: 'literal_null', type: 'varchar(64)', nullable: true, autoIncrement: false, defaultValue: 'NULL', comment: '' }, { name: 'note', type: 'varchar(64)', nullable: true, autoIncrement: false, defaultValue: '普通默认', comment: '' }], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }, { name: 'uq_literal', unique: true, columns: ['literal_null'] }, { name: 'ix_note', unique: false, columns: ['note', 'id'] }], foreignKeys: [] } }, 1);
    expect(created).toBe(false); expect(preview.sql).toContain("DEFAULT 'NULL'");
    const input = { previewToken: preview.previewToken, confirmation: 'db.new_table', acknowledgements: [...tableCreateAcknowledgements], taskId: 'apply' };
    const result = await tasks.apply(input, 1); await expect(tasks.apply(input, 1)).rejects.toThrow('失效'); return result;
  } };
}

describe.each(['10.11.19-MariaDB', '11.4.13-MariaDB'])('%s普通创建真实generic模型', version => {
  it('INT、文字NULL及普通默认、普通与唯一索引完整后核，一次消费无MySQL探测', async () => {
    const f = fixture(version); expect(await f.run()).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: true }); expect(f.sent.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1); expect(f.sent.some(sql => /server_uuid|server_uid|gipk|partial_revokes/i.test(sql))).toBe(false);
  });
  it('IGNORE_SPACE握手模式保留引用标识符及文字默认后核，不SET会话', async () => { const f = fixture(version, false, false, 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'); expect(await f.run()).toMatchObject({ ddlCompleted: true, definitionVerified: true }); expect(f.sent.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1); expect(f.sent.some(sql => sql.startsWith('SET '))).toBe(false); });
  it('目录SQL NULL不能冒充文字NULL；ACK仍成立，不重放或DROP', async () => {
    const f = fixture(version, true); expect(await f.run()).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(f.sent.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1); expect(f.sent.some(sql => /^DROP/.test(sql))).toBe(false);
  });
  it('ACK后SHOW权限未知只保留完成事实，不自动补救', async () => {
    const f = fixture(version, false, true); expect(await f.run()).toMatchObject({ ddlCompleted: true, definitionVerified: false }); expect(f.sent.some(sql => /^DROP/.test(sql))).toBe(false);
  });
});
