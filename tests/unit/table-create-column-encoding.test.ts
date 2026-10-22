import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { buildColumnEncodedTableDesign, buildDesign, buildGeneratedTableDesign, buildPrefixTableDesign } from '../../src/engine/sql';
import { planTableCreateIndexes } from '../../src/engine/tableCreateIndexPlan';
import { verifyCreatedColumnEncodings } from '../../src/engine/tableCreateColumnEncoding';
import { tableCreateColumnDefaultMatches } from '../../src/engine/tableCreateColumnDefaults';
import type { TableDefinitionContext } from '../../src/shared/tableColumnPatches';
import { readTableDefaultEncodingDefinition } from '../../src/engine/tableDefaultEncodingSql';
import { tableCreateDefaultEncodingRowsMatch, tableCreateShownEncodingProof } from '../../src/engine/tableCreateEncodingProof';
import { tableCreateDraftSchema, tableCreateLegacyDesign, type TableCreateDraft, type TableCreateEncodingCatalog, type TableCreatePrefixFacts } from '../../src/shared/tableCreate';
import { effectiveTableCreateColumnEncoding, planTableCreateColumnEncodings, tableCreateColumnEncodingAllowed, tableCreateHasColumnEncoding } from '../../src/shared/tableCreateColumnEncoding';

const latin = { charset: 'latin1', collation: 'latin1_bin' }, utf8 = { charset: 'utf8mb4', collation: 'utf8mb4_bin' };
const catalog = (): TableCreateEncodingCatalog => ({ candidates: [latin, utf8], digest: 'b'.repeat(64), warnings: [], reasons: [] });
/** 草稿只包含请求，不冒充实际COLUMNS或已存在表权限。 */
function draft(): TableCreateDraft {
  return { database: '库`名', name: '新`表', engine: 'InnoDB', charset: 'utf8mb4', comment: '', columns: [
    { name: 'id', type: 'INT', nullable: false, autoIncrement: false, comment: '' },
    { name: '标签`列', type: 'VARCHAR(100)', nullable: true, autoIncrement: false, comment: '', collation: { ...latin } },
    { name: 'body', type: 'TEXT', nullable: true, autoIncrement: false, comment: '', collation: { ...utf8 } },
    { name: 'inherited', type: 'VARCHAR(20)', nullable: true, autoIncrement: false, comment: '' },
  ], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }, { name: 'ix_label', unique: false, columns: ['标签`列'] }], foreignKeys: [] };
}
const prefixFacts = (): TableCreatePrefixFacts => ({ dialect: 'mysql', serverVersion: '8.4.11', pageSize: 16384, defaultRowFormat: 'DYNAMIC', charsets: [{ name: 'utf8mb4', maxBytes: 4 }, { name: 'latin1', maxBytes: 1 }], digest: 'c'.repeat(64) });

describe('新建表列编码独立规划与SQL', () => {
  it('有序零基回执只列显式配对，继承列不借用旁列配对且不改原草稿', () => {
    const design = draft(), original = structuredClone(design);
    expect(planTableCreateColumnEncodings(design, catalog())).toEqual({ catalogDigest: 'b'.repeat(64), selections: [{ ordinal: 1, name: '标签`列', ...latin }, { ordinal: 2, name: 'body', ...utf8 }] });
    expect(effectiveTableCreateColumnEncoding(design.columns[3], { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' })).toEqual({ charset: 'utf8mb4', collation: 'utf8mb4_general_ci' });
    expect(design).toEqual(original);
  });
  it.each([undefined, { ...catalog(), digest: undefined }, { ...catalog(), digest: 'bad' }, { ...catalog(), reasons: ['无完整目录'] }, { ...catalog(), candidates: [utf8] }])('没有准确完整目录不能规划或生成SQL：%j', candidate => {
    expect(() => planTableCreateColumnEncodings(draft(), candidate)).toThrow();
    expect(() => buildColumnEncodedTableDesign(draft(), candidate as TableCreateEncodingCatalog)).toThrow();
  });
  it('不折叠大小写或utf8别名，不按collation名称前缀猜配对', () => {
    const value = draft(); value.columns[1].collation = { charset: 'utf8mb4', collation: 'latin1_bin' };
    expect(() => planTableCreateColumnEncodings(value, catalog())).toThrow();
    value.columns[1].collation = { charset: 'LATIN1', collation: 'latin1_bin' }; expect(() => planTableCreateColumnEncodings(value, catalog())).toThrow();
  });
  it.each(['TEXTjunk', 'VARCHAR(100) BINARY', 'TEXT COLLATE latin1_bin', "ENUM('a') COMMENT 'x'", "ENUM('a\\b')", 'JSON', 'BINARY(1)', 'INT', 'TIMESTAMP'])('完整类型语法拒绝%s而非只看前缀', type => {
    expect(tableCreateColumnEncodingAllowed({ type })).toBe(false); const value = draft(); value.columns[1].type = type; expect(tableCreateDraftSchema.safeParse(value).success).toBe(false);
  });
  it('ENUM/SET文字量保持内容，关键字与分号不能被当成属性或第二条SQL', () => {
    const value = draft(); value.columns[1].type = "ENUM('COLLATE','a; DROP TABLE t','it''s')";
    const result = buildColumnEncodedTableDesign(value, catalog());
    expect(result.statements).toHaveLength(1); expect(result.sql).toContain("ENUM('COLLATE','a; DROP TABLE t','it''s') CHARACTER SET latin1 COLLATE latin1_bin");
  });
  it('独立CREATE保留普通PK/FK、引用名称、默认文字量与各列配对', () => {
    const value = draft(); value.columns[1].defaultValue = "a'b"; value.foreignKeys.push({ name: 'fk', columns: ['id'], referencedDatabase: '父`库', referencedTable: '父表', referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
    const result = buildColumnEncodedTableDesign(value, catalog());
    expect(result.statements).toHaveLength(1); expect(result.sql).toContain('CREATE TABLE `库``名`.`新``表`');
    expect(result.sql).toContain("`标签``列` VARCHAR(100) CHARACTER SET latin1 COLLATE latin1_bin NULL DEFAULT 'a''b'");
    expect(result.sql).toContain('`body` TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); expect(result.sql).toContain('`inherited` VARCHAR(20) NULL');
    expect(result.sql).toContain('PRIMARY KEY (`id`)'); expect(result.sql).toContain('REFERENCES `父``库`.`父表` (`id`)');
    expect(() => tableCreateLegacyDesign(value)).toThrow(); expect(() => buildDesign(value as Parameters<typeof buildDesign>[0])).toThrow();
  });
  it('省略新键仍可走原生成器，显式undefined也不能被专属renderer忽略', () => {
    const value = draft(); for (const column of value.columns) delete column.collation;
    expect(tableCreateHasColumnEncoding(value)).toBe(false); expect(buildDesign(tableCreateLegacyDesign(value)).statements).toHaveLength(1);
    Object.assign(value.columns[1], { collation: undefined }); expect(tableCreateHasColumnEncoding(value)).toBe(true); expect(() => buildColumnEncodedTableDesign(value, catalog())).toThrow();
  });
  it('8.4前缀3072边界使用列latin1而非表utf8mb4，缺真实MAXLEN或超整条预算拒绝', () => {
    const value = draft(); value.columns[1].type = 'VARCHAR(4000)'; value.indexes[1] = { name: 'ix_label', unique: false, keyParts: [{ columnName: '标签`列', prefixLength: 3072 }] };
    const plan = planTableCreateIndexes(value, prefixFacts()); expect(plan.indexes[1].keyBytes).toBe(3072); expect(plan.columns[1].unitBytes).toBe(1);
    expect(() => buildPrefixTableDesign(value, prefixFacts())).toThrow(); expect(buildPrefixTableDesign(value, prefixFacts(), false, undefined, catalog()).sql).toContain('`标签``列`(3072)');
    value.indexes[1] = { name: 'ix_label', unique: false, keyParts: [{ columnName: '标签`列', prefixLength: 3073 }] }; expect(() => planTableCreateIndexes(value, prefixFacts())).toThrow('3072');
    expect(() => planTableCreateIndexes(value, { ...prefixFacts(), charsets: [{ name: 'utf8mb4', maxBytes: 4 }] })).toThrow('MAXLEN');
  });
  it('生成列普通旁列配对通过同一真实目录，未传目录不能静默丢失', () => {
    const value = draft(); value.columns.push({ name: 'g', type: 'INT', nullable: true, autoIncrement: false, comment: '', generated: { storage: 'VIRTUAL', expression: 'id + 1' } });
    const content = { dialect: 'mysql' as const, serverVersion: '8.4.11', os: 'Linux', lowerNames: 0 as const, sqlMode: 'STRICT_TRANS_TABLES', quoteShowCreate: 1 as const, characterSetConnection: 'utf8mb4', collationConnection: 'utf8mb4_bin', engineSupport: 'DEFAULT' as const, serverIdentity: 'a'.repeat(64) };
    const facts = { ...content, digest: createHash('sha256').update(JSON.stringify(content)).digest('hex') };
    expect(() => buildGeneratedTableDesign(value, facts)).toThrow();
    const result = buildGeneratedTableDesign(value, facts, false, undefined, undefined, catalog()); expect(result.statements).toHaveLength(1); expect(result.sql).toContain('CHARACTER SET latin1 COLLATE latin1_bin'); expect(result.sql).toContain('GENERATED ALWAYS AS ((`id` + 1)) VIRTUAL');
  });
});

/** 独立手写SHOW及目录，不从生成器拼出预期；原真实回调和commandStarted收尾透传。 */
function fixture(dialect: 'mysql' | 'mariadb' = 'mysql') {
  const design = draft(), controller = new AbortController();
  let source = 'CREATE TABLE `新``表` (`id` int NOT NULL,`标签``列` varchar(100) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL,`body` text COLLATE utf8mb4_bin,`inherited` varchar(20) DEFAULT NULL,PRIMARY KEY (`id`),KEY `ix_label` (`标签``列`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci';
  const metadata = [
    { name: 'id', ordinal: '1', typeSql: 'int', dataType: 'int', nullable: 'NO', defaultValue: null, extra: '', generationExpression: '', charset: null, collation: null, comment: '' },
    { name: '标签`列', ordinal: '2', typeSql: 'varchar(100)', dataType: 'varchar', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: 'latin1', collation: 'latin1_bin', comment: '' },
    { name: 'body', ordinal: '3', typeSql: 'text', dataType: 'text', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '' },
    { name: 'inherited', ordinal: '4', typeSql: 'varchar(20)', dataType: 'varchar', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: 'utf8mb4', collation: 'utf8mb4_general_ci', comment: '' },
  ] as Record<string, string | number | null>[];
  const table = { databaseName: '库`名', tableName: '新`表', kind: 'BASE TABLE', engine: 'InnoDB', charset: 'utf8mb4' as string | null, collation: 'utf8mb4_general_ci' };
  const queries: string[] = []; let pending = 0, finalSource: string | undefined, fail: Error | undefined, onColumns: (() => void) | undefined;
  const connection = Object.assign(new EventEmitter(), { query(sql: string, callback: (error: Error | null, rows?: unknown, fields?: unknown[]) => void) {
    queries.push(sql); queueMicrotask(() => {
      if (fail) { callback(fail); return; }
      if (sql.startsWith('SELECT t.TABLE_SCHEMA AS databaseName')) callback(null, [{ ...table }], []);
      else if (sql.startsWith('SELECT COLUMN_NAME AS name,ORDINAL_POSITION AS ordinal')) { onColumns?.(); callback(null, metadata.map(row => ({ ...row })), []); }
      else if (sql.startsWith('SELECT CHARACTER_SET_NAME AS name,DEFAULT_COLLATE_NAME AS collation')) callback(null, [{ name: 'utf8mb4', collation: table.collation }], []);
      else if (sql.startsWith('SHOW CREATE TABLE ')) callback(null, [{ 'Create Table': finalSource ?? source }], []);
      else callback(Error('未登记的只读SQL'));
    }); return {};
  } });
  const context: StructureTaskContext = { managed: { connection, status: { dialect, version: dialect === 'mysql' ? '8.4.11' : '11.4.13' }, signal: controller.signal, broken: false } as unknown as ManagedConnection, checkCancelled() { if (controller.signal.aborted) throw Error('已取消'); }, report() {}, commandStarted() { pending++; return () => { pending--; }; } };
  return { design, metadata, table, context, controller, queries, connection, get pending() { return pending; }, setSource(value: string) { source = value; }, setFinal(value: string) { finalSource = value; }, setFailure(value: Error) { fail = value; }, onColumns(value: () => void) { onColumns = value; }, get source() { return source; }, document: () => parseTableColumnDefinition(source, { dialect, mode: { ansiQuotes: false, noBackslashEscapes: false } }) };
}

describe('新表列编码真实SHOW/COLUMNS证明', () => {
  it.each(['mysql', 'mariadb'] as const)('%s的显式列配对与继承列各自准确，保留回调收尾', async dialect => {
    const item = fixture(dialect); expect(await verifyCreatedColumnEncodings(item.context, { database: item.design.database, table: item.design.name }, item.design, item.document())).toBe(true);
    expect(item.pending).toBe(0); expect(item.connection.listenerCount('error')).toBe(0); expect(item.queries.every(sql => /^(?:SELECT|SHOW)/.test(sql))).toBe(true);
    expect(item.queries[0]).toContain("CONVERT(X'"); expect(item.queries.at(-1)).toBe('SHOW CREATE TABLE `库``名`.`新``表`');
  });
  it.each([
    { column: 1, field: 'charset', value: 'utf8mb4' }, { column: 1, field: 'collation', value: 'latin1_swedish_ci' },
    { column: 3, field: 'collation', value: 'latin1_bin' }, { column: 0, field: 'charset', value: 'utf8mb4' },
    { column: 1, field: 'extra', value: 'INVISIBLE' }, { column: 1, field: 'extra', value: 'STORAGE DISK' },
    { column: 1, field: 'extra', value: 'DEFAULT_GENERATED' }, { column: 1, field: 'generationExpression', value: '1+1' },
    { column: 1, field: 'defaultValue', value: '9' }, { column: 3, field: 'defaultValue', value: 'NULL' },
    { column: 1, field: 'name', value: '标签列' }, { column: 1, field: 'ordinal', value: '3' },
  ])('目录漂移或未知属性%s不能与SHOW拼成成功', async ({ column, field, value }) => {
    const item = fixture(); item.metadata[column][field] = value; expect(await verifyCreatedColumnEncodings(item.context, { database: item.design.database, table: item.design.name }, item.design, item.document())).toBe(false); expect(item.pending).toBe(0);
  });
  it('两份列证据同时漂移也不能覆盖请求；未知SHOW属性及数值编码属性拒绝', async () => {
    for (const mode of ['pair', 'extra', 'numeric']) {
      const item = fixture();
      if (mode === 'pair') { item.setSource(item.source.replace('CHARACTER SET latin1 COLLATE latin1_bin', 'CHARACTER SET utf8mb4 COLLATE utf8mb4_bin')); item.metadata[1].charset = 'utf8mb4'; item.metadata[1].collation = 'utf8mb4_bin'; }
      if (mode === 'extra') item.setSource(item.source.replace('varchar(100)', 'varchar(100) INVISIBLE'));
      if (mode === 'numeric') item.setSource(item.source.replace('`id` int', '`id` int COLLATE utf8mb4_bin'));
      expect(await verifyCreatedColumnEncodings(item.context, { database: item.design.database, table: item.design.name }, item.design, item.document())).toBe(false);
    }
  });
  it('表配对漂移、最后SHOW替换均拒绝，但缺省SHOWcollation可以真实默认目录补证', async () => {
    const drift = fixture(); drift.table.collation = 'utf8mb4_bin'; expect(await verifyCreatedColumnEncodings(drift.context, { database: drift.design.database, table: drift.design.name }, drift.design, drift.document())).toBe(false);
    const changed = fixture(); changed.setFinal(changed.source + ' COMMENT=\'changed\''); expect(await verifyCreatedColumnEncodings(changed.context, { database: changed.design.database, table: changed.design.name }, changed.design, changed.document())).toBe(false);
    const defaults = fixture(); defaults.setSource(defaults.source.replace(' COLLATE=utf8mb4_general_ci', '')); expect(await verifyCreatedColumnEncodings(defaults.context, { database: defaults.design.database, table: defaults.design.name }, defaults.design, defaults.document())).toBe(true); expect(defaults.queries.some(sql => sql.includes('DEFAULT_COLLATE_NAME'))).toBe(true);
  });
  it('Maria表charset NULL只能用完整SHOW显式配对补证，MySQL不能套该fallback', async () => {
    for (const dialect of ['mysql', 'mariadb'] as const) { const item = fixture(dialect); item.table.charset = null; expect(await verifyCreatedColumnEncodings(item.context, { database: item.design.database, table: item.design.name }, item.design, item.document())).toBe(dialect === 'mariadb'); }
    const item = fixture('mariadb'); item.table.charset = null; item.setSource(item.source.replace(' COLLATE=utf8mb4_general_ci', '')); expect(await verifyCreatedColumnEncodings(item.context, { database: item.design.database, table: item.design.name }, item.design, item.document())).toBe(false);
  });
  it('普通自动时间DEFAULT_GENERATED/on update仍逐项证明，JSON固有配对不成为列覆写权限', async () => {
    const item = fixture();
    item.design.columns.push({ name: 'updated', type: 'TIMESTAMP(6)', nullable: true, autoIncrement: false, comment: '', defaultValue: 'CURRENT_TIMESTAMP(6)', onUpdate: { kind: 'expression', expression: 'current-timestamp', precision: 6 } });
    item.design.columns.push({ name: 'payload', type: 'JSON', nullable: true, autoIncrement: false, comment: '' });
    item.setSource(item.source.replace(',PRIMARY KEY', ',`updated` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),`payload` json DEFAULT NULL,PRIMARY KEY'));
    item.metadata.push({ name: 'updated', ordinal: '5', typeSql: 'timestamp(6)', dataType: 'timestamp', nullable: 'YES', defaultValue: 'CURRENT_TIMESTAMP(6)', extra: 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6)', generationExpression: '', charset: null, collation: null, comment: '' });
    item.metadata.push({ name: 'payload', ordinal: '6', typeSql: 'json', dataType: 'json', nullable: 'YES', defaultValue: null, extra: '', generationExpression: '', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '' });
    expect(await verifyCreatedColumnEncodings(item.context, { database: item.design.database, table: item.design.name }, item.design, item.document())).toBe(true);
    item.metadata[4].extra = 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)'; expect(await verifyCreatedColumnEncodings(item.context, { database: item.design.database, table: item.design.name }, item.design, item.document())).toBe(false);
    item.metadata[4].extra = 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6)'; item.metadata[5].collation = 'utf8mb4_general_ci'; expect(await verifyCreatedColumnEncodings(item.context, { database: item.design.database, table: item.design.name }, item.design, item.document())).toBe(false);
  });
  it('权限/取消不伪报成功或吞掉原命令终态，收尾后无残留监听器', async () => {
    const failure = fixture(); failure.setFailure(Error('SELECT denied')); await expect(verifyCreatedColumnEncodings(failure.context, { database: failure.design.database, table: failure.design.name }, failure.design, failure.document())).rejects.toThrow('SELECT denied'); expect(failure.pending).toBe(0);
    const cancelled = fixture(); cancelled.onColumns(() => cancelled.controller.abort()); await expect(verifyCreatedColumnEncodings(cancelled.context, { database: cancelled.design.database, table: cancelled.design.name }, cancelled.design, cancelled.document())).rejects.toThrow(); expect(cancelled.pending).toBe(0); expect(cancelled.connection.listenerCount('error')).toBe(0);
  });
});

describe('完整COLUMNS默认值与同次SHOW、请求三向核对', () => {
  const context = (dialect: 'mysql' | 'mariadb', noBackslashEscapes = false): TableDefinitionContext => ({ dialect, mode: { ansiQuotes: false, noBackslashEscapes } });
  /** 手写服务器SHOW，默认值比较不使用任何实际SQL生成结果当期望。 */
  const shown = (type: string, sqlDefault: string, definitionContext: TableDefinitionContext) => parseTableColumnDefinition(`CREATE TABLE t (c ${type} ${sqlDefault})`, definitionContext).columns[0];
  it.each(['mysql', 'mariadb'] as const)('%s省略/NULL不能被非空完整目录默认值掩盖', dialect => {
    const definitionContext = context(dialect), column = { type: 'VARCHAR(20)', nullable: true, autoIncrement: false };
    expect(tableCreateColumnDefaultMatches(column, shown(column.type, 'DEFAULT NULL', definitionContext), null, definitionContext)).toBe(true);
    expect(tableCreateColumnDefaultMatches(column, shown(column.type, 'DEFAULT NULL', definitionContext), '9', definitionContext)).toBe(false);
    expect(tableCreateColumnDefaultMatches({ ...column, defaultValue: '9' }, shown(column.type, 'DEFAULT NULL', definitionContext), dialect === 'mysql' ? '9' : "'9'", definitionContext)).toBe(false);
  });
  it('BIGINT/DECIMAL字符串精度与文字量NULL不经Number或NULL字样折叠', () => {
    for (const value of ['18446744073709551615', '123456789012345678901234567890.12345678901234567890']) {
      const definitionContext = context('mysql'), column = { type: 'DECIMAL(65,20)', nullable: true, autoIncrement: false, defaultValue: value };
      const definition = shown(column.type, `DEFAULT '${value}'`, definitionContext);
      expect(tableCreateColumnDefaultMatches(column, definition, value, definitionContext)).toBe(true);
      expect(tableCreateColumnDefaultMatches(column, definition, String(Number(value)), definitionContext)).toBe(false);
    }
    const definitionContext = context('mariadb'), column = { type: 'VARCHAR(20)', nullable: true, autoIncrement: false, defaultValue: 'NULL' }, definition = shown(column.type, "DEFAULT 'NULL'", definitionContext);
    expect(tableCreateColumnDefaultMatches(column, definition, "'NULL'", definitionContext)).toBe(true);
    expect(tableCreateColumnDefaultMatches(column, definition, 'NULL', definitionContext)).toBe(false);
  });
  it('Maria文字量反斜线按真实模式解码，不借另一份目录默认值补证', () => {
    const definitionContext = context('mariadb', true), column = { type: 'VARCHAR(20)', nullable: true, autoIncrement: false, defaultValue: 'a\\b' }, definition = shown(column.type, "DEFAULT 'a\\b'", definitionContext);
    expect(tableCreateColumnDefaultMatches(column, definition, "'a\\b'", definitionContext)).toBe(true);
    expect(tableCreateColumnDefaultMatches(column, definition, "'a\\b'", context('mariadb'))).toBe(false);
  });
  it('时间默认与原onUpdate零精度语义一致，完整目录精度漂移或SHOW漂移均拒绝', () => {
    const definitionContext = context('mysql'), column = { type: 'TIMESTAMP(6)', nullable: true, autoIncrement: false, defaultValue: 'CURRENT_TIMESTAMP(6)', onUpdate: { kind: 'expression' as const, expression: 'current-timestamp' as const, precision: 6 } }, definition = shown(column.type, 'DEFAULT CURRENT_TIMESTAMP(6)', definitionContext);
    expect(tableCreateColumnDefaultMatches(column, definition, 'current_timestamp(6)', definitionContext)).toBe(true);
    expect(tableCreateColumnDefaultMatches(column, definition, 'current_timestamp(3)', definitionContext)).toBe(false);
    expect(tableCreateColumnDefaultMatches(column, shown(column.type, 'DEFAULT CURRENT_TIMESTAMP(3)', definitionContext), 'current_timestamp(6)', definitionContext)).toBe(false);
    const zero = { ...column, type: 'TIMESTAMP', defaultValue: 'CURRENT_TIMESTAMP(0)', onUpdate: { ...column.onUpdate, precision: 0 } };
    expect(tableCreateColumnDefaultMatches(zero, shown(zero.type, 'DEFAULT CURRENT_TIMESTAMP', definitionContext), 'current_timestamp()', definitionContext)).toBe(true);
  });
});

describe('真实默认目录补证SHOW省略的表COLLATE', () => {
  const context: TableDefinitionContext = { dialect: 'mysql', mode: { ansiQuotes: false, noBackslashEscapes: false } };
  /** 5.7真实SHOW会省略已选字符集默认collation；此处只脱敏库表名，保留实际表尾形状。 */
  const source = 'CREATE TABLE `subject` (`id` bigint(20) unsigned NOT NULL,`qty` int(11) DEFAULT NULL,`u8` varchar(100) COLLATE utf8mb4_bin DEFAULT NULL,`latin` varchar(100) CHARACTER SET latin1 COLLATE latin1_bin DEFAULT NULL,`memo` text COLLATE utf8mb4_bin,`computed` decimal(20,2) GENERATED ALWAYS AS ((`qty` * 1.00)) STORED,PRIMARY KEY (`id`),KEY `ix_qty` (`qty`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
  it('省略不是不一致，必须保留待证明状态而非提前拒绝或直接相信请求', () => {
    const request = { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }, shown = readTableDefaultEncodingDefinition(source, context);
    expect(shown.reasons).toEqual([]); expect(shown.collation).toBeUndefined(); expect(tableCreateShownEncodingProof(request, shown)).toBe('default-required');
    expect(tableCreateDefaultEncodingRowsMatch([{ name: 'utf8mb4', collation: 'utf8mb4_general_ci' }], request)).toBe(true);
    expect(tableCreateDefaultEncodingRowsMatch(undefined, request)).toBe(false);
    expect(tableCreateDefaultEncodingRowsMatch([{ name: 'utf8mb4', collation: 'utf8mb4_bin' }], request)).toBe(false);
  });
  it('不硬编码general_ci，实际字符集默认值与请求准确一致才证明', () => {
    const request = { charset: 'latin1', collation: 'latin1_swedish_ci' }, shown = readTableDefaultEncodingDefinition(source.replace('DEFAULT CHARSET=utf8mb4', 'DEFAULT CHARSET=latin1'), context);
    expect(tableCreateShownEncodingProof(request, shown)).toBe('default-required');
    expect(tableCreateDefaultEncodingRowsMatch([{ name: 'latin1', collation: 'latin1_swedish_ci' }], request)).toBe(true);
    for (const rows of [[], null, [{ name: 'utf8mb4', collation: request.collation }], [{ name: request.charset, collation: null }], [{ name: request.charset, collation: request.collation }, { name: request.charset, collation: request.collation }]]) expect(tableCreateDefaultEncodingRowsMatch(rows, request)).toBe(false);
  });
  it('显式SHOW矛盾、字符集不同或未知表尾不能通过默认目录洗掉', () => {
    const request = { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' };
    expect(tableCreateShownEncodingProof(request, readTableDefaultEncodingDefinition(source + ' COLLATE=utf8mb4_bin', context))).toBe('invalid');
    expect(tableCreateShownEncodingProof(request, readTableDefaultEncodingDefinition(source.replace('DEFAULT CHARSET=utf8mb4', 'DEFAULT CHARSET=latin1'), context))).toBe('invalid');
    expect(tableCreateShownEncodingProof(request, readTableDefaultEncodingDefinition(source + ' UNKNOWN_OPTION=1', context))).toBe('invalid');
    expect(tableCreateShownEncodingProof(request, readTableDefaultEncodingDefinition(source + ' COLLATE=utf8mb4_general_ci', context))).toBe('shown');
    expect(tableCreateShownEncodingProof({ charset: 'utf8mb4' }, readTableDefaultEncodingDefinition(source, context))).toBe('inherited');
  });
});
