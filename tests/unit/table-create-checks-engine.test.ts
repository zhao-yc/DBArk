import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import type { TableCreateDraft, TableCreateEncodingCatalog, TableCreatePrefixFacts } from '../../src/shared/tableCreate';
import { tableCreateLegacyDesign } from '../../src/shared/tableCreate';
import { buildDesign, buildPrefixTableDesign, buildColumnEncodedTableDesign, buildGeneratedTableDesign } from '../../src/engine/sql';
import { parseTableColumnDefinition } from '../../src/engine/tableColumnDefinition';
import { readTableCheckDefinition } from '../../src/engine/tableCheckDefinition';
import { buildTableCreateChecks, readTableCreateCheckFacts, recheckTableCreateChecks, verifyTableCreateChecks, tableCreateCheckHasJson, tableCreateCheckJsonMatches } from '../../src/engine/tableCreateChecks';
import type { TableCreateGeneratedFacts } from '../../src/engine/tableCreateGeneratedColumns';

/** 原SHOW与目录独立手写，不能用待测生成器反解作为核验真值。 */
function draft(): TableCreateDraft { return { database: 'db', name: 'subject', engine: 'InnoDB', charset: 'utf8mb4', comment: '末尾)(注释', columns: [{ name: 'qty', type: 'INT', nullable: true, autoIncrement: false, comment: '' }], indexes: [], foreignKeys: [], checks: [{ name: 'ck_qty', expression: '`qty` >= 0', enforced: true }] }; }
const mysqlShow = 'CREATE TABLE `subject` (`qty` int DEFAULT NULL,CONSTRAINT `ck_qty` CHECK ((`qty` >= 0))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
const mariaShow = 'CREATE TABLE `subject` (`qty` int DEFAULT NULL,`doc` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`doc`)),CONSTRAINT `ck_qty` CHECK (`qty` >= 0)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
const jsonRow = () => ({ name: 'doc', ordinal: 2, typeSql: 'longtext', dataType: 'longtext', nullable: 'YES', defaultValue: 'NULL', extra: '', generationExpression: '', charset: 'utf8mb4', collation: 'utf8mb4_bin', comment: '' });

/** 只替换服务器回调边界，实际词法、事实读取和三份定义交叉仍由产品代码执行。 */
function port(dialect: 'mysql' | 'mariadb' = 'mysql', version = dialect === 'mysql' ? '8.4.11' : '11.4.13-MariaDB') {
  const commands: string[] = []; let mode = '', denied = false, checksOn = 1;
  let tc: Record<string, unknown>[] = [{ schemaName: 'db', databaseName: 'db', tableName: 'subject', name: 'ck_qty', type: 'CHECK', enforced: dialect === 'mysql' ? 'YES' : null }];
  let cc: Record<string, unknown>[] = [{ schemaName: 'db', tableName: 'subject', name: 'ck_qty', expression: '`qty` >= 0' }];
  let columns: Record<string, unknown>[] = [{ name: 'qty', ordinal: 1, typeSql: 'int', dataType: 'int', nullable: 'YES', defaultValue: 'NULL', extra: '', generationExpression: '', charset: null, collation: null, comment: '' }, jsonRow()];
  const connection = Object.assign(new EventEmitter(), { query(sql: string, callback: (error: Error | null, value?: unknown) => void) {
    commands.push(sql); let result: unknown;
    if (sql === 'SELECT VERSION() AS version,@@SESSION.sql_mode AS sqlMode') result = [{ version, sqlMode: mode }];
    else if (sql.startsWith('SET SESSION ')) result = { affectedRows: 0 };
    else if (sql.startsWith('SELECT @@SESSION.foreign_key_checks AS fk')) result = [{ fk: 1, uq: 1, checks: checksOn, sqlMode: mode }];
    else if (sql.includes('FROM information_schema.TABLE_CONSTRAINTS')) result = tc;
    else if (sql.includes('FROM information_schema.CHECK_CONSTRAINTS')) { if (denied) { queueMicrotask(() => callback(Error('合成CC目录拒读'))); return; } result = cc; }
    else if (sql.includes('FROM information_schema.COLUMNS')) result = columns;
    else { queueMicrotask(() => callback(Error('未登记的离线CHECK SQL'))); return; }
    queueMicrotask(() => callback(null, structuredClone(result)));
  } });
  const context: StructureTaskContext = { managed: { connection, status: { dialect, version }, broken: false } as unknown as ManagedConnection, report() {}, checkCancelled() {}, commandStarted: () => () => {} };
  return { context, commands, get tc() { return tc; }, set tc(value: Record<string, unknown>[]) { tc = value; }, get cc() { return cc; }, set cc(value: Record<string, unknown>[]) { cc = value; }, get columns() { return columns; }, set columns(value: Record<string, unknown>[]) { columns = value; }, mode(value: string) { mode = value; }, deny() { denied = true; }, disable() { checksOn = 0; } };
}

describe('新表CHECK真实模式和单条CREATE组合', () => {
  it.each([['mysql', '8.0.46'], ['mysql', '8.4.11'], ['mariadb', '10.11.19-MariaDB'], ['mariadb', '11.4.13-MariaDB']] as const)('%s/%s事实包含开关读回及模式，Maria不得使用NOT ENFORCED', async (dialect, version) => {
    const p = port(dialect, version), facts = await readTableCreateCheckFacts(p.context);
    expect(facts).toMatchObject({ dialect, serverVersion: version, sqlMode: '', allowsNotEnforced: dialect === 'mysql' });
    expect(p.commands.some(sql => sql === 'SET SESSION check_constraint_checks=ON')).toBe(dialect === 'mariadb');
    p.mode('NO_BACKSLASH_ESCAPES'); await expect(recheckTableCreateChecks(p.context, facts)).rejects.toThrow('变化');
  });
  it('5.7/8.0.15及关不上的检查开关不形成可执行事实，省略模式拒绝', async () => {
    for (const version of ['5.7.44', '8.0.15', '9.0.0']) await expect(readTableCreateCheckFacts(port('mysql', version).context)).rejects.toThrow('当前版本');
    const p = port('mariadb'); p.disable(); await expect(readTableCreateCheckFacts(p.context)).rejects.toThrow(); p.mode('ORACLE'); await expect(readTableCreateCheckFacts(p.context)).rejects.toThrow();
  });
  it('结构边界不受引用名/字符串/注释中的括号影响，精确数值和中文原文不改写', async () => {
    const p = port(), facts = await readTableCreateCheckFacts(p.context), value = draft(); value.name = '新`表'; value.columns[0].name = '数量)'; value.columns[0].type = 'DECIMAL(35,10)'; value.checks = [{ name: '检查`名', expression: "`数量)` >= 9007199254740993.1234000000 AND '),(' <> '' /* ) */", enforced: false }];
    const { checks: _checks, ...base } = value, sql = buildTableCreateChecks(buildDesign(tableCreateLegacyDesign(base)).sql, value, facts);
    expect(sql).toContain('CONSTRAINT `检查``名` CHECK'); expect(sql).toContain('9007199254740993.1234000000'); expect(sql).toContain(' NOT ENFORCED'); expect(sql).toContain("COMMENT='末尾)(注释'");
    const parsed = parseTableColumnDefinition(sql, { dialect: 'mysql', mode: { noBackslashEscapes: false, ansiQuotes: false } });
    expect(parsed.table).toBe('新`表'); expect(readTableCheckDefinition(parsed, facts.serverVersion).checks).toHaveLength(1);
  });
  it('ANSI_QUOTES和NO_BACKSLASH_ESCAPES使用实际模式，不把双引号列或反斜线文字量改写', async () => {
    const p = port(); p.mode('ANSI_QUOTES,NO_BACKSLASH_ESCAPES'); const facts = await readTableCreateCheckFacts(p.context), value = draft(); value.checks![0].expression = '"qty" >= 0 AND \'c:\\path\' <> \'\'';
    const { checks: _checks, ...base } = value, sql = buildTableCreateChecks(buildDesign(tableCreateLegacyDesign(base), undefined, true).sql, value, facts);
    expect(sql).toContain(value.checks![0].expression); expect(readTableCheckDefinition(parseTableColumnDefinition(sql, { dialect: 'mysql', mode: { ansiQuotes: true, noBackslashEscapes: true } }), facts.serverVersion).coverage).toBe('complete');
  });
  it('完整CREATE和单值预算在发送前拒绝，不静默截短或接纳第二条语句', async () => {
    const p = port(), facts = await readTableCreateCheckFacts(p.context), value = draft(), { checks: _checks, ...base } = value;
    const sql = buildDesign(tableCreateLegacyDesign(base)).sql;
    expect(() => buildTableCreateChecks(sql + '\nSELECT 1;', value, facts)).toThrow(); value.checks![0].expression = 'x'.repeat(32769); expect(() => buildTableCreateChecks(sql, value, facts)).toThrow();
  });
  it('四种基础CREATE均保留原普通键/前缀/列编码/生成表达式，不通过整串替换构造CHECK', async () => {
    const p = port(), facts = await readTableCreateCheckFacts(p.context), normal = draft();
    normal.columns.push({ name: 'note', type: 'VARCHAR(40)', nullable: true, autoIncrement: false, comment: '' }); normal.indexes = [{ name: 'ix_qty', unique: false, columns: ['qty'] }];
    const catalog: TableCreateEncodingCatalog = { candidates: [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }], digest: 'a'.repeat(64), reasons: [], warnings: [] };
    const prefixFacts: TableCreatePrefixFacts = { dialect: 'mysql', serverVersion: '8.4.11', pageSize: 16384, defaultRowFormat: 'DYNAMIC', charsets: [{ name: 'utf8mb4', maxBytes: 4 }], digest: 'b'.repeat(64) };
    const content = { dialect: 'mysql' as const, serverVersion: '8.4.11', os: 'Linux', lowerNames: 0 as const, sqlMode: '', quoteShowCreate: 1 as const, characterSetConnection: 'utf8mb4', collationConnection: 'utf8mb4_bin', engineSupport: 'DEFAULT' as const, serverIdentity: 'c'.repeat(64) };
    const generatedFacts: TableCreateGeneratedFacts = { ...content, digest: createHash('sha256').update(JSON.stringify(content)).digest('hex') };
    for (const kind of ['ordinary', 'prefix', 'encoding', 'generated']) {
      const design = structuredClone(normal);
      if (kind === 'prefix') design.indexes.push({ name: 'ix_note', unique: false, keyParts: [{ columnName: 'note', prefixLength: 5 }] });
      if (kind === 'encoding') design.columns[1].collation = { charset: 'utf8mb4', collation: 'utf8mb4_bin' };
      if (kind === 'generated') design.columns.push({ name: 'total', type: 'INT', nullable: true, autoIncrement: false, comment: '', generated: { storage: 'VIRTUAL', expression: 'qty + 1' } });
      const { checks: _checks, ...base } = design;
      const original = kind === 'prefix' ? buildPrefixTableDesign(base, prefixFacts) : kind === 'encoding' ? buildColumnEncodedTableDesign(base, catalog) : kind === 'generated' ? buildGeneratedTableDesign(base, generatedFacts) : buildDesign(tableCreateLegacyDesign(base));
      const result = buildTableCreateChecks(original.sql, design, facts); expect(result).toContain('KEY `ix_qty` (`qty`)'); expect(result).toContain('CONSTRAINT `ck_qty` CHECK');
      if (kind === 'prefix') expect(result).toContain('`note`(5)'); if (kind === 'encoding') expect(result).toContain('COLLATE utf8mb4_bin'); if (kind === 'generated') expect(result).toContain('GENERATED ALWAYS AS');
    }
  });
  it.each(['`qty` > 0); DROP TABLE x; -- ', '`qty` > 0 /*!80016 + 1 */', '`qty` > (0', '`qty` > 0,1'])('表达式%j不可逃出CHECK且不能隐入执行注释', async expression => {
    const p = port(), facts = await readTableCreateCheckFacts(p.context), value = draft(); value.checks![0].expression = expression;
    const { checks: _checks, ...base } = value; expect(() => buildTableCreateChecks(buildDesign(tableCreateLegacyDesign(base)).sql, value, facts)).toThrow();
  });
});

describe('CREATE后CHECK目录完整证明和准确投影', () => {
  it('SHOW/TC/CC一致才移除准确表级项，原source/range及原索引保持', async () => {
    const p = port(), facts = await readTableCreateCheckFacts(p.context), document = parseTableColumnDefinition(mysqlShow, { dialect: 'mysql', mode: { noBackslashEscapes: false, ansiQuotes: false } });
    const proof = await verifyTableCreateChecks(p.context, { database: 'db', table: 'subject' }, draft(), facts, document);
    expect(proof.document.source).toBe(mysqlShow); expect(proof.document.columns[0].range).toEqual(document.columns[0].range); expect(proof.document.items).toHaveLength(1);
    expect(p.commands.filter(sql => sql.includes('TABLE_CONSTRAINTS')).every(sql => sql.includes('CAST('))).toBe(true);
  });
  it('普通裸列允许服务器补反引号，但TRUE命名列不能把布尔常量误证成列引用', async () => {
    const p = port(), facts = await readTableCreateCheckFacts(p.context), design = draft(); design.checks![0].expression = 'qty >= 0';
    const document = parseTableColumnDefinition(mysqlShow, { dialect: 'mysql', mode: { noBackslashEscapes: false, ansiQuotes: false } });
    expect((await verifyTableCreateChecks(p.context, { database: 'db', table: 'subject' }, design, facts, document)).document.source).toBe(mysqlShow);
    design.columns[0].name = 'TRUE'; design.checks![0].expression = 'TRUE'; p.cc[0].expression = '`TRUE`';
    const changed = parseTableColumnDefinition(mysqlShow.replaceAll('`qty`', '`TRUE`').replace('((`TRUE` >= 0))', '(`TRUE`)'), document.context);
    await expect(verifyTableCreateChecks(p.context, { database: 'db', table: 'subject' }, design, facts, changed)).rejects.toThrow();
  });
  it('ABS命名列不能吞掉函数词法身份，限定名也不当作裸列', async () => {
    const p = port(), facts = await readTableCreateCheckFacts(p.context), design = draft(); design.columns.push({ name: 'ABS', type: 'INT', nullable: true, autoIncrement: false, comment: '' }); design.checks![0].expression = 'ABS(`qty`) >= 0'; p.cc[0].expression = '`ABS`(`qty`) >= 0';
    const sql = mysqlShow.replace('`qty` int DEFAULT NULL,', '`qty` int DEFAULT NULL,`ABS` int DEFAULT NULL,').replace('((`qty` >= 0))', '(`ABS`(`qty`) >= 0)');
    const document = parseTableColumnDefinition(sql, { dialect: 'mysql', mode: { noBackslashEscapes: false, ansiQuotes: false } });
    await expect(verifyTableCreateChecks(p.context, { database: 'db', table: 'subject' }, design, facts, document)).rejects.toThrow();
    design.checks![0].expression = 'subject.qty >= 0'; p.cc[0].expression = '`subject`.`qty` >= 0';
    const qualified = parseTableColumnDefinition(sql.replace('`ABS`(`qty`) >= 0', '`subject`.`qty` >= 0'), document.context);
    await expect(verifyTableCreateChecks(p.context, { database: 'db', table: 'subject' }, design, facts, qualified)).rejects.toThrow();
  });
  it.each(['missing', 'extra', 'wrong-expression', 'disabled', 'denied', 'wrong-target', 'duplicate'])('%s目录不相符不能把CREATE ACK当完整约束核验', async kind => {
    const p = port(), facts = await readTableCreateCheckFacts(p.context), document = parseTableColumnDefinition(mysqlShow, { dialect: 'mysql', mode: { noBackslashEscapes: false, ansiQuotes: false } });
    if (kind === 'missing') p.cc = []; if (kind === 'extra') p.cc.push({ ...p.cc[0], name: 'ck_extra' }); if (kind === 'wrong-expression') p.cc[0].expression = '`qty` < 0'; if (kind === 'disabled') p.tc[0].enforced = 'NO'; if (kind === 'denied') p.deny(); if (kind === 'wrong-target') p.cc[0].tableName = 'other'; if (kind === 'duplicate') p.tc.push({ ...p.tc[0] });
    await expect(verifyTableCreateChecks(p.context, { database: 'db', table: 'subject' }, draft(), facts, document)).rejects.toThrow();
  });
  it('Maria隐式JSON_VALID必须覆盖且核真实LONGTEXT固有编码，proof不能伪造或移交另一document', async () => {
    const p = port('mariadb'), facts = await readTableCreateCheckFacts(p.context), design = draft(); design.columns.push({ name: 'doc', type: 'JSON', nullable: true, autoIncrement: false, comment: '' });
    p.tc.push({ ...p.tc[0], name: 'doc' }); p.cc.push({ ...p.cc[0], name: 'doc', expression: 'json_valid(`doc`)' });
    const document = parseTableColumnDefinition(mariaShow, { dialect: 'mariadb', mode: { noBackslashEscapes: false, ansiQuotes: false } }), proof = await verifyTableCreateChecks(p.context, { database: 'db', table: 'subject' }, design, facts, document);
    expect(proof.document.source).toBe(mariaShow); expect(proof.document.columns[1].type.raw).toBe('longtext'); expect(proof.document.columns[1].raw).toContain('CHECK'); expect(proof.document.columns[1].attributes.some(attribute => attribute.kind === 'check')).toBe(false); expect(proof.document.columns[1].attributes.some(attribute => attribute.kind === 'collation')).toBe(true);
    expect(tableCreateCheckHasJson(proof, proof.document, 'doc')).toBe(true); expect(tableCreateCheckHasJson({ document: proof.document }, proof.document, 'doc')).toBe(false); expect(tableCreateCheckHasJson(proof, { ...proof.document }, 'doc')).toBe(false);
    expect(tableCreateCheckJsonMatches(proof, proof.document, 'doc', jsonRow())).toBe(true); expect(tableCreateCheckJsonMatches(proof, proof.document, 'doc', { ...jsonRow(), collation: 'utf8mb4_general_ci' })).toBe(false);
    p.columns[1].collation = 'utf8mb4_general_ci'; await expect(verifyTableCreateChecks(p.context, { database: 'db', table: 'subject' }, design, facts, document)).rejects.toThrow();
  });
  it('未知inline CHECK或JSON_VALID错列不能因投影隐藏其它属性', async () => {
    const p = port('mariadb'), facts = await readTableCreateCheckFacts(p.context), design = draft(); design.columns.push({ name: 'doc', type: 'JSON', nullable: true, autoIncrement: false, comment: '' });
    p.tc.push({ ...p.tc[0], name: 'doc' }); p.cc.push({ ...p.cc[0], name: 'doc', expression: 'json_valid(`qty`)' });
    const document = parseTableColumnDefinition(mariaShow.replace('json_valid(`doc`)', 'json_valid(`qty`)'), { dialect: 'mariadb', mode: { noBackslashEscapes: false, ansiQuotes: false } });
    await expect(verifyTableCreateChecks(p.context, { database: 'db', table: 'subject' }, design, facts, document)).rejects.toThrow();
  });
});
