import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { TableCreateTasks } from '../../src/engine/tableCreateTasks';
import type { StructureTaskHost } from '../../src/engine/structureDefinition';
import type { ManagedConnection } from '../../src/engine/connection';
import { tableCreateAcknowledgements } from '../../src/shared/tableCreate';
import maria114Metadata from '../fixtures/table-create/mariadb114-create-metadata-1363.json';

interface VerificationSample { ddl?: string; table?: Record<string, unknown>; columns?: Record<string, unknown>[]; dialect?: 'mariadb' | 'mysql'; designComment?: string; }

/** 真实generic建表任务及解析器，只替换查询结果；Maria目录样本不是MySQL能力放行。 */
function fixture(version: string, wrongDefault = false, failAfterAck = false, mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', sample: VerificationSample = {}) {
  const sent: string[] = []; let created = false;
  const connection = Object.assign(new EventEmitter(), { query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    sent.push(sql); let rows: unknown;
    if (sql.startsWith('SELECT @@hostname')) rows = [{ hostname: '合成Maria', port: 13310, serverId: 27, currentUser: 'unit@host', sqlMode: mode, lowerNames: 0, charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
    else if (sql.startsWith('SELECT SCHEMA_NAME')) rows = [{ name: 'db', charset: 'utf8mb4', collation: 'utf8mb4_bin' }];
    else if (sql.startsWith('SELECT TABLE_NAME')) rows = [];
    else if (sql.startsWith('CREATE TABLE')) { created = true; rows = { affectedRows: 0, warningStatus: 0 }; }
    else if (sql.startsWith('SHOW CREATE')) {
      if (failAfterAck) { callback(Error('合成SHOW权限未知')); return; }
      rows = [{ 'Create Table': sample.ddl ?? "CREATE TABLE `new_table` (`id` int(11) NOT NULL,`literal_null` varchar(64) DEFAULT 'NULL',`note` varchar(64) DEFAULT '普通默认',PRIMARY KEY (`id`),UNIQUE KEY `uq_literal` (`literal_null`),KEY `ix_note` (`note`,`id`)) ENGINE=InnoDB" }];
    } else if (sql.startsWith('SELECT t.TABLE_NAME')) rows = [sample.table ?? { name: 'new_table', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '' }];
    else if (sql.startsWith('SELECT @@server_uuid')) rows = [{ uuid: 'synthetic-mysql-unit-only' }];
    else if (sql.startsWith('SELECT COLUMN_NAME')) rows = sample.columns ?? [{ name: 'id', type: 'int(11)', nullable: 'NO', defaultValue: null, extra: '', comment: '' }, { name: 'literal_null', type: 'varchar(64)', nullable: 'YES', defaultValue: wrongDefault ? 'NULL' : "'NULL'", extra: '', comment: '' }, { name: 'note', type: 'varchar(64)', nullable: 'YES', defaultValue: "'普通默认'", extra: '', comment: '' }];
    else if (sql.startsWith('SELECT INDEX_NAME')) rows = [
      { name: 'PRIMARY', nonUnique: 0, column: 'id', sequence: 1, subPart: null, method: 'BTREE', direction: 'A', comment: '' },
      { name: 'ix_note', nonUnique: 1, column: 'note', sequence: 1, subPart: null, method: 'BTREE', direction: 'A', comment: '' },
      { name: 'ix_note', nonUnique: 1, column: 'id', sequence: 2, subPart: null, method: 'BTREE', direction: 'A', comment: '' },
      { name: 'uq_literal', nonUnique: 0, column: 'literal_null', sequence: 1, subPart: null, method: 'BTREE', direction: 'A', comment: '' },
    ];
    else { callback(Error('拒绝未声明查询')); return; }
    queueMicrotask(() => callback(null, rows, []));
  } });
  const host: StructureTaskHost = { async run(_connectionId, _taskId, action, options) { const result = await action({ managed: { connection, broken: false, status: { dialect: sample.dialect ?? 'mariadb', version } } as unknown as ManagedConnection, checkCancelled() {}, report() {}, commandStarted: () => () => {} }); options.onResourcesReleased?.(); return result; } };
  const tasks = new TableCreateTasks(host);
  return { sent, created: () => created, async run() {
    const snapshot = await tasks.get({ connectionId: 'c', database: 'db', taskId: 'get' }, 1);
    const preview = await tasks.preview({ snapshotId: snapshot.snapshotId, taskId: 'preview', design: { database: 'db', name: 'new_table', engine: 'InnoDB', charset: 'utf8mb4', comment: sample.designComment ?? '', columns: [{ name: 'id', type: 'int', nullable: false, autoIncrement: false, comment: '' }, { name: 'literal_null', type: 'varchar(64)', nullable: true, autoIncrement: false, defaultValue: 'NULL', comment: '' }, { name: 'note', type: 'varchar(64)', nullable: true, autoIncrement: false, defaultValue: '普通默认', comment: '' }], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }, { name: 'uq_literal', unique: true, columns: ['literal_null'] }, { name: 'ix_note', unique: false, columns: ['note', 'id'] }], foreignKeys: [] } }, 1);
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

/** 只保留1363公开实际SHOW、表目录及列值；表名替换为合成目标，索引驱动仍是上方独立合成数据。 */
const maria114Sample = (): VerificationSample => ({
  ddl: maria114Metadata.ddl.replace('`daily_new_table`', '`new_table`'),
  table: { ...maria114Metadata.table, name: 'new_table' },
  columns: structuredClone(maria114Metadata.columns),
});
describe('Maria11.4 UCA1400空目录映射的独立SHOW补证', () => {
  it('实际SHOW完整编码与TABLES排序规则一致，NULL映射仍能完整后核', async () => {
    const f = fixture(maria114Metadata.version, false, false, 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION', maria114Sample());
    expect(await f.run()).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: true });
    expect(f.sent.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1);
    expect(f.sent.some(sql => /^(?:SET |DROP |ALTER )/.test(sql))).toBe(false);
  });
  it.each([
    ['SHOW引擎与设计目录矛盾', (s: VerificationSample) => { s.ddl = s.ddl!.replace('ENGINE=InnoDB', 'ENGINE=MyISAM'); }],
    ['SHOW注释与设计目录矛盾', (s: VerificationSample) => { s.ddl += " COMMENT='未批准表注释'"; }],
    ['SHOW额外ROW_FORMAT', (s: VerificationSample) => { s.ddl += ' ROW_FORMAT=COMPACT'; }],
    ['SHOW额外AUTO_INCREMENT', (s: VerificationSample) => { s.ddl += ' AUTO_INCREMENT=17'; }],
    ['SHOW额外CHECKSUM', (s: VerificationSample) => { s.ddl += ' CHECKSUM=1'; }],
    ['SHOW额外压缩选项', (s: VerificationSample) => { s.ddl += " COMPRESSION='zlib'"; }],
    ['SHOW缺引擎', (s: VerificationSample) => { s.ddl = s.ddl!.replace('ENGINE=InnoDB ', ''); }],
    ['SHOW重复引擎', (s: VerificationSample) => { s.ddl += ' ENGINE=InnoDB'; }],
    ['SHOW重复注释', (s: VerificationSample) => { s.ddl += " COMMENT='' COMMENT=''"; }],
    ['SHOW注释不能是标识符', (s: VerificationSample) => { s.ddl += ' COMMENT=InnoDB'; }],
    ['SHOW引擎不能是字符串', (s: VerificationSample) => { s.ddl = s.ddl!.replace('ENGINE=InnoDB', "ENGINE='InnoDB'"); }],
    ['SHOW缺注释值', (s: VerificationSample) => { s.ddl += ' COMMENT='; }],
    ['SHOW引擎错误DEFAULT修饰', (s: VerificationSample) => { s.ddl = s.ddl!.replace('ENGINE=InnoDB', 'DEFAULT ENGINE=InnoDB'); }],
    ['SHOW注释错误DEFAULT修饰', (s: VerificationSample) => { s.ddl += " DEFAULT COMMENT=''"; }],
    ['SHOW引用分号不能冒充结束符', (s: VerificationSample) => { s.ddl += " ';'"; }],
    ['SHOW引用等号不能冒充赋值', (s: VerificationSample) => { s.ddl = s.ddl!.replace('ENGINE=InnoDB', "ENGINE '=' InnoDB"); }],
    ['SHOW与目录一致但注释违背设计', (s: VerificationSample) => { s.ddl += " COMMENT='非设计注释'"; s.table!.comment = '非设计注释'; }],
  ] as const)('%s不能借NULL补证变为完整核验', async (_name, change) => {
    const sample = maria114Sample(); change(sample); const f = fixture(maria114Metadata.version, false, false, undefined, sample);
    expect(await f.run()).toMatchObject({ ddlCompleted: true, definitionVerified: false, resourcesReleased: true });
    expect(f.sent.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1); expect(f.sent.some(sql => /^(?:SET |DROP |ALTER )/.test(sql))).toBe(false);
  });
  it.each([' COMMENT=\'\'', ';', ' COMMENT=\'\';'])('SHOW合法空注释及结束符%s仍能完整后核', async tail => {
    const sample = maria114Sample(); sample.ddl += tail; const f = fixture(maria114Metadata.version, false, false, undefined, sample);
    expect(await f.run()).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: true });
  });
  it('SHOW非空注释解码后必须同时准确匹配设计和目录', async () => {
    const sample = maria114Sample(); sample.designComment = "本次'设计"; sample.table!.comment = sample.designComment; sample.ddl += " COMMENT='本次''设计'";
    const f = fixture(maria114Metadata.version, false, false, undefined, sample);
    expect(await f.run()).toMatchObject({ ddlCompleted: true, definitionVerified: true, resourcesReleased: true });
  });
  it.each([
    ['SHOW缺字符集', (s: VerificationSample) => { s.ddl = s.ddl!.replace('DEFAULT CHARSET=utf8mb4 ', ''); }],
    ['SHOW缺排序规则', (s: VerificationSample) => { s.ddl = s.ddl!.replace(' COLLATE=utf8mb4_uca1400_ai_ci', ''); }],
    ['SHOW字符集冲突', (s: VerificationSample) => { s.ddl = s.ddl!.replace('CHARSET=utf8mb4', 'CHARSET=latin1'); }],
    ['SHOW与目录排序规则冲突', (s: VerificationSample) => { s.table!.collation = 'utf8mb4_bin'; }],
    ['目录已有矛盾字符集', (s: VerificationSample) => { s.table!.charset = 'latin1'; }],
    ['目录缺字符集属性', (s: VerificationSample) => { delete s.table!.charset; }],
    ['目录空字符集字符串', (s: VerificationSample) => { s.table!.charset = ''; }],
    ['目录缺排序规则属性', (s: VerificationSample) => { delete s.table!.collation; }],
    ['目录NULL排序规则', (s: VerificationSample) => { s.table!.collation = null; }],
    ['SHOW重复字符集', (s: VerificationSample) => { s.ddl += ' CHARSET=utf8mb4'; }],
    ['SHOW重复排序规则', (s: VerificationSample) => { s.ddl += ' COLLATE=utf8mb4_uca1400_ai_ci'; }],
    ['SHOW未知尾部属性', (s: VerificationSample) => { s.ddl += ' UNKNOWN_OPTION=1'; }],
    ['SHOW可执行尾部', (s: VerificationSample) => { s.ddl += ' /*!999999 UNKNOWN_OPTION=1 */'; }],
    ['SHOW字符集为字符串值', (s: VerificationSample) => { s.ddl = s.ddl!.replace('CHARSET=utf8mb4', "CHARSET='utf8mb4'"); }],
    ['目录文字NULL被改成SQL NULL', (s: VerificationSample) => { s.columns![1].defaultValue = null; }],
    ['MySQL不能借Maria补证', (s: VerificationSample) => { s.dialect = 'mysql'; }],
  ] as const)('%s保持未核验且不重放', async (_name, change) => {
    const sample = maria114Sample(); change(sample); const f = fixture(maria114Metadata.version, false, false, undefined, sample);
    expect(await f.run()).toMatchObject({ ddlCompleted: true, definitionVerified: false, resourcesReleased: true });
    expect(f.sent.filter(sql => sql.startsWith('CREATE TABLE'))).toHaveLength(1); expect(f.sent.some(sql => /^(?:SET |DROP |ALTER )/.test(sql))).toBe(false);
  });
  it.each(['ANSI', 'NO_TABLE_OPTIONS', 'NO_FIELD_OPTIONS', 'ORACLE'])('模式%s不能用SHOW补证绕过定义省略守卫', async mode => {
    const f = fixture(maria114Metadata.version, false, false, mode, maria114Sample());
    expect(await f.run()).toMatchObject({ ddlCompleted: true, definitionVerified: false });
  });
});
