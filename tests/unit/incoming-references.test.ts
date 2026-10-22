import { describe, expect, it } from 'vitest';
import type { ColumnInfo, ForeignKeyInfo, TableInfo } from '../../src/shared/contracts';
import { assembleIncomingReferenceRelations, compareIncomingReferenceTuple, decodeIncomingReferenceCursor, encodeIncomingReferenceCursor, incomingReferenceCandidatesSql, incomingReferencePartsSql, incomingReferenceRulesSql, incomingReferenceSourceDigest } from '../../src/engine/incomingReferences';
import { buildChildReferencePageSql, buildReferencePageSql, hasStableReferencePagination } from '../../src/engine/references';

const context = { dialect: 'mysql' as const, mode: { noBackslashEscapes: false, ansiQuotes: false } };
const column = (name: string, type = 'INT'): ColumnInfo => ({ name, type, nullable: false, defaultValue: null, extra: '', comment: '', generated: false });
/** 真实形状的结构投影，子外键方向始终child→parent，不从正向表对象伪造。 */
function tables() {
  const source: TableInfo = { database: '父`库', name: '父表', engine: 'InnoDB', charset: 'utf8mb4', collation: 'utf8mb4_bin', objectKind: 'table', columns: [column('constructor', 'BIGINT UNSIGNED'), column('decimal', 'DECIMAL(65,30)'), column('bits', 'BIT(64)'), column('time', 'DATETIME(6)'), column('bytes', 'VARBINARY(20)'), column('text', 'VARCHAR(100)')], indexes: [{ name: 'PRIMARY', unique: true, columns: ['constructor'] }], primaryKey: ['constructor'], editableKey: ['constructor'], foreignKeys: [], ddl: 'CREATE TABLE `父表` (`constructor` bigint unsigned NOT NULL,`decimal` decimal(65,30) NOT NULL,`bits` bit(64) NOT NULL,`time` datetime(6) NOT NULL,`bytes` varbinary(20) NOT NULL,`text` varchar(100) NOT NULL,PRIMARY KEY (`constructor`)) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COMMENT=\'AUTO_INCREMENT=99\'' };
  const foreignKey: ForeignKeyInfo = { name: '__proto__', columns: ['big', 'dec', 'bit', 'at', 'bin', 'label'], referencedDatabase: source.database, referencedTable: source.name, referencedColumns: source.columns.map(item => item.name), onUpdate: 'CASCADE', onDelete: 'RESTRICT' };
  const target: TableInfo = { ...source, database: '子`库', name: '子表', columns: [column('big', 'BIGINT UNSIGNED'), column('dec', 'DECIMAL(65,30)'), column('bit', 'BIT(64)'), column('at', 'DATETIME(6)'), column('bin', 'VARBINARY(20)'), column('label', 'VARCHAR(100)'), column('other')], foreignKeys: [foreignKey], primaryKey: [], editableKey: [], indexes: [], ddl: 'CREATE TABLE `子表` (`big` bigint unsigned) ENGINE=InnoDB' };
  return { source, target, foreignKey };
}
const selected = [{ database: '子`库', table: '子表', foreignKeyName: '__proto__' }];
/** 两套目录独立固定有序字段，允许规范数字串和真实number但不放宽缺项/动作。 */
function catalog() {
  const { source, foreignKey } = tables();
  return { parts: foreignKey.columns.map((name, index) => ({ databaseName: '子`库', tableName: '子表', foreignKeyName: '__proto__', constraintSchema: '子`库', columnName: name, ordinal: String(index + 1), parentPosition: index + 1, parentDatabase: source.database, parentTable: source.name, parentColumn: foreignKey.referencedColumns[index] })), rules: [{ databaseName: '子`库', tableName: '子表', foreignKeyName: '__proto__', parentDatabase: source.database, parentTable: source.name, uniqueName: 'PRIMARY', matchOption: 'NONE', onUpdate: 'CASCADE', onDelete: 'RESTRICT' }] };
}

describe('入向目录二进制keyset及有界双目录', () => {
  it('准确Unicode/反引号目标用独立hex文字量，50页后仍可继续而不截前256', () => {
    const sql = incomingReferenceCandidatesSql({ database: '父`库', table: '父表' }, { database: '__proto__', table: 'a`b', foreignKeyName: '外键' });
    expect(sql).toContain('k.ORDINAL_POSITION=1'); expect(sql).toContain('CAST(k.REFERENCED_TABLE_SCHEMA AS BINARY)'); expect(sql).toContain('CAST(k.TABLE_SCHEMA AS BINARY)>');
    expect(sql).toContain('ORDER BY BINARY k.TABLE_SCHEMA,BINARY k.TABLE_NAME,BINARY k.CONSTRAINT_NAME LIMIT 51'); expect(sql).not.toContain('OFFSET'); expect(sql).not.toContain('LIMIT 256'); expect(sql).not.toContain('父`库');
    expect(incomingReferencePartsSql(selected)).toContain('ORDER BY BINARY k.TABLE_SCHEMA,BINARY k.TABLE_NAME,BINARY k.CONSTRAINT_NAME,k.ORDINAL_POSITION LIMIT 4097');
    expect(incomingReferenceRulesSql(selected)).toContain('LIMIT 51'); expect(() => incomingReferencePartsSql([])).toThrow(); expect(() => incomingReferenceRulesSql(Array.from({ length: 51 }, () => selected[0]))).toThrow();
  });
  it('原型同名外键保持真正child→parent复合字段与两种精确动作', () => {
    const { source, foreignKey } = tables(), { parts, rules } = catalog();
    const relations = assembleIncomingReferenceRelations(source, 'a'.repeat(64), selected, parts, rules);
    expect(relations).toHaveLength(1); expect(relations[0]).toMatchObject({ database: '子`库', table: '子表', foreignKey }); expect(relations[0].digest).toMatch(/^[a-f0-9]{64}$/);
    expect(assembleIncomingReferenceRelations(source, 'b'.repeat(64), selected, parts, rules)[0].digest).not.toBe(relations[0].digest);
  });
  it.each(['columnName', 'ordinal', 'parentPosition', 'constraintSchema', 'parentDatabase', 'parentTable', 'parentColumn'] as const)('缺项/序位/父子映射%s不能被另一目录补成正确关系', field => {
    const { source } = tables(), { parts, rules } = catalog(); const row = parts[1] as Record<string, unknown>;
    const replacements = { columnName: parts[0].columnName, ordinal: '01', parentPosition: 0, constraintSchema: 'other', parentDatabase: 'other', parentTable: 'other', parentColumn: 'missing' }; row[field] = replacements[field];
    expect(() => assembleIncomingReferenceRelations(source, 'a'.repeat(64), selected, parts, rules)).toThrow();
  });
  it.each(['onUpdate', 'onDelete', 'matchOption', 'uniqueName', 'parentDatabase', 'parentTable'] as const)('未知/不完整规则%s拒绝而不猜RESTRICT', field => {
    const { source } = tables(), { parts, rules } = catalog(); (rules[0] as Record<string, unknown>)[field] = field === 'uniqueName' ? null : 'unknown';
    expect(() => assembleIncomingReferenceRelations(source, 'a'.repeat(64), selected, parts, rules)).toThrow();
  });
  it('缺规则、重复规则、重复序号、额外字段与64部件以上均拒绝', () => {
    const { source } = tables();
    for (const kind of ['missing', 'duplicate', 'ordinal', 'extra', 'limit']) {
      const { parts, rules } = catalog();
      if (kind === 'missing') rules.pop(); if (kind === 'duplicate') rules.push({ ...rules[0] }); if (kind === 'ordinal') parts[1].ordinal = '1'; if (kind === 'extra') Object.assign(parts[0], { sql: 'SELECT *' }); if (kind === 'limit') while (parts.length < 65) parts.push({ ...parts[0] });
      expect(() => assembleIncomingReferenceRelations(source, 'a'.repeat(64), selected, parts, rules)).toThrow();
    }
  });
  it('keyset比较使用UTF8二进制次序，游标绑定真实源结构摘要且拒绝损坏或扩展', () => {
    expect(compareIncomingReferenceTuple({ database: 'A', table: 'a', foreignKeyName: 'b' }, { database: 'a', table: 'a', foreignKeyName: 'b' })).toBeLessThan(0);
    const digest = 'a'.repeat(64), cursor = encodeIncomingReferenceCursor(digest, selected[0]); expect(decodeIncomingReferenceCursor(cursor, digest)).toEqual(selected[0]);
    expect(() => decodeIncomingReferenceCursor(cursor, 'b'.repeat(64))).toThrow(); expect(() => decodeIncomingReferenceCursor(cursor + '=', digest)).toThrow();
    expect(() => decodeIncomingReferenceCursor(Buffer.from(JSON.stringify({ version: 1, sourceDigest: digest, last: selected[0], sql: 'x' })).toString('base64url'), digest)).toThrow();
  });
  it('自增计数DML不失效，字段/约束/备注/模式变化仍使源摘要失效', () => {
    const { source } = tables(), original = incomingReferenceSourceDigest(source, context);
    expect(incomingReferenceSourceDigest({ ...source, ddl: source.ddl.replace('AUTO_INCREMENT=17', 'AUTO_INCREMENT=999999999999999999') }, context)).toBe(original);
    expect(incomingReferenceSourceDigest({ ...source, ddl: source.ddl.replace('COMMENT=\'AUTO_INCREMENT=99\'', 'COMMENT=\'AUTO_INCREMENT=100\'') }, context)).not.toBe(original);
    expect(incomingReferenceSourceDigest({ ...source, ddl: source.ddl.replace('bigint unsigned', 'bigint') }, context)).not.toBe(original);
    expect(incomingReferenceSourceDigest({ ...source, columns: source.columns.map((item, index) => index ? item : { ...item, type: 'BIGINT' }) }, context)).not.toBe(original);
    expect(incomingReferenceSourceDigest(source, { ...context, mode: { ...context.mode, ansiQuotes: true } })).not.toBe(original);
    const generated = { ...source, ddl: source.ddl.replace(',PRIMARY KEY', ',`AUTO_INCREMENT` int,`g` int GENERATED ALWAYS AS (`AUTO_INCREMENT` + 1) STORED,PRIMARY KEY') };
    expect(incomingReferenceSourceDigest({ ...generated, ddl: generated.ddl.replace('`AUTO_INCREMENT` + 1', '`AUTO_INCREMENT` + 2') }, context)).not.toBe(incomingReferenceSourceDigest(generated, context));
    expect(incomingReferenceSourceDigest({ ...generated, ddl: generated.ddl.replace('`AUTO_INCREMENT` int', '`AUTO_INCREMENT` bigint') }, context)).not.toBe(incomingReferenceSourceDigest(generated, context));
  });
});

describe('子记录范围与精确匹配', () => {
  const values = ['18446744073709551615', '1234567890.123456789012345678901234567890', '18446744073709551615', '2026-10-22 12:34:56.123456', { type: 'binary' as const, base64: 'AP8=' }, '中文'];
  it('复合值按父列类型精确渲染，真实子列做谓词；OR筛选不能越过关联边界', () => {
    const { source, target, foreignKey } = tables();
    const sql = buildChildReferencePageSql(source, target, foreignKey, values, 2, 20, [{ column: 'other', operator: '=', value: '1' }, { column: 'other', operator: '=', value: '2' }], [{ column: 'other', direction: 'DESC' }], 'any');
    expect(sql).toContain('FROM `子``库`.`子表` WHERE (`big` = CAST('); expect(sql).toContain('DECIMAL(65,30)'); expect(sql).toContain('AS UNSIGNED)'); expect(sql).toContain("X'00ff'"); expect(sql).toContain(') AND ('); expect(sql).toContain(' OR '); expect(sql).toContain('LIMIT 21 OFFSET 20');
    expect(sql).not.toContain('`constructor` ='); expect(sql).not.toContain('18446744073709552000'); expect(sql).toContain(Buffer.from('2026-10-22 12:34:56.123456').toString('hex'));
  });
  it('NULL任一部分只返回空范围，省略/空/缺失元组绝不无界', () => {
    const { source, target, foreignKey } = tables();
    for (let index = 0; index < values.length; index++) { const input = [...values]; input[index] = null as unknown as string; expect(buildChildReferencePageSql(source, target, foreignKey, input, 1, 50, [], [])).toContain('WHERE (0 = 1)'); }
    expect(() => buildChildReferencePageSql(source, target, foreignKey, undefined as never, 1, 50, [], [])).toThrow(); expect(() => buildChildReferencePageSql(source, target, foreignKey, [], 1, 50, [], [])).toThrow(); expect(() => buildChildReferencePageSql(source, target, foreignKey, values.slice(1), 1, 50, [], [])).toThrow();
  });
  it('嵌套OR组仍在复合关联范围内部，不能把任意筛选当作独立全表条件', () => {
    const { source, target, foreignKey } = tables();
    const sql = buildChildReferencePageSql(source, target, foreignKey, values, 1, 10, [{ column: 'other', operator: '=', value: '1' }, { column: 'other', operator: '=', value: '2' }, { column: 'other', operator: '=', value: '3' }], [], 'any', { mode: 'any', children: [0, { mode: 'all', children: [1, 2] }] });
    expect(sql).toContain('WHERE (`big` ='); expect(sql).toContain(') AND ('); expect(sql).toContain(' OR '); expect(sql).toContain(' AND ');
  });
  it('无可靠键允许只读子页且stable=false，原正向门保持拒绝', () => {
    const { source, target, foreignKey } = tables(); expect(hasStableReferencePagination(target)).toBe(false); expect(() => buildChildReferencePageSql(source, target, foreignKey, values, 1, 50, [], [])).not.toThrow();
    expect(() => buildReferencePageSql(target, foreignKey, values, 1, 50, [], [])).toThrow('可靠');
    target.editableKey = ['big']; target.indexes = [{ name: 'unique_big', unique: true, columns: ['big'] }]; expect(hasStableReferencePagination(target)).toBe(true);
    target.columns[0].nullable = true; expect(hasStableReferencePagination(target)).toBe(false);
  });
  it('不安全number、伪造列名、错误binary以及超预算值拒绝', () => {
    const { source, target, foreignKey } = tables();
    const number = [...values]; number[0] = 18446744073709551615 as unknown as string; expect(() => buildChildReferencePageSql(source, target, foreignKey, number, 1, 50, [], [])).toThrow('精确');
    expect(() => buildChildReferencePageSql(source, target, { ...foreignKey, columns: ['missing', ...foreignKey.columns.slice(1)] }, values, 1, 50, [], [])).toThrow();
    expect(() => buildChildReferencePageSql(source, target, foreignKey, ['x'.repeat(256 * 1024 + 1), ...values.slice(1)], 1, 50, [], [])).toThrow();
    const binary = [...values]; binary[4] = { type: 'binary', base64: 'AB==' }; expect(() => buildChildReferencePageSql(source, target, foreignKey, binary, 1, 50, [], [])).toThrow();
  });
});
