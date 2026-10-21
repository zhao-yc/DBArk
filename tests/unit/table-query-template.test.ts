import { describe, expect, it } from 'vitest';
import type { ColumnInfo, TableInfo } from '../../src/shared/contracts';
import { splitSql } from '../../src/engine/sql';
import { bindQueryParameters, namedParameterTokens, queryParameterLiteral } from '../../src/shared/queryParameters';
import { buildTableQueryTemplate, tableQueryTemplateMetadataKey } from '../../src/renderer/tableQueryTemplate';

/** 合成目录不含行数据；默认具备非空主键、自增和生成列。 */
function fixture(): TableInfo { const field = (name: string): ColumnInfo => ({ name, type: 'varchar(100)', nullable: false, defaultValue: null, extra: '', generated: false, comment: '' }); return { database: '库`名', name: '表;名', objectKind: 'table', engine: 'InnoDB', columns: [{ ...field('id'), type: 'bigint', extra: 'auto_increment' }, field('内容`列'), { ...field('金额'), type: 'decimal(30,20)' }, { ...field('计算值'), generated: true, extra: 'VIRTUAL GENERATED' }], primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], ddl: '不应读取DDL' }; }

describe('从表结构生成独立查询模板', () => {
  it('SELECT完整引用数据库／表／列及当前上限，反引号和分号不改变单语句边界', () => {
    const info = fixture(), output = buildTableQueryTemplate(info, 'SELECT', 37); expect(output.parameters).toBe(0); expect(output.sql).toContain('FROM `库``名`.`表;名`\nLIMIT 37;'); expect(output.sql).toContain('`内容``列`'); expect(output.sql).toContain('`计算值`'); expect(splitSql(output.sql)).toHaveLength(1);
  });
  it('INSERT只生成普通非自增字段的独立值参数，不拼接业务值或生成表达式', () => {
    const output = buildTableQueryTemplate(fixture(), 'INSERT', 1000); expect(output.parameters).toBe(2); expect(output.sql).toContain('`内容``列` = :value_1'); expect(output.sql).toContain('`金额` = :value_2'); expect(output.sql).not.toContain('`id`'); expect(output.sql).not.toContain('`计算值`'); expect(splitSql(output.sql)).toHaveLength(1);
    const only = fixture(); only.columns = [only.columns[0], only.columns[3]]; expect(buildTableQueryTemplate(only, 'INSERT', 50)).toMatchObject({ parameters: 0 }); expect(buildTableQueryTemplate(only, 'INSERT', 50).sql).toContain('() VALUES ();');
  });
  it('UPDATE／DELETE按完整复合键参数化，默认不改键，并保留LIMIT 1', () => {
    const info = fixture(); info.primaryKey = info.editableKey = ['id', '金额']; const update = buildTableQueryTemplate(info, 'UPDATE', 1000), remove = buildTableQueryTemplate(info, 'DELETE', 1000);
    expect(update.parameters).toBe(3); expect(update.sql).toContain('SET\n  `内容``列` = :value_1\nWHERE'); expect(update.sql).toContain('`id` = :key_1'); expect(update.sql).toContain('`金额` = :key_2'); expect(update.sql).toMatch(/LIMIT 1;$/); expect(remove.parameters).toBe(2); expect(remove.sql).not.toContain('SET'); expect(remove.sql).toMatch(/LIMIT 1;$/); expect(splitSql(update.sql)).toHaveLength(1); expect(splitSql(remove.sql)).toHaveLength(1);
  });
  it('接受已确认非空唯一键，未知表达式索引不阻断SELECT或已确认主键', () => {
    const info = fixture(); info.indexes = [{ name: '表达式', unique: true, columns: ['无法证明的表达式'] }]; expect(buildTableQueryTemplate(info, 'SELECT', 50).parameters).toBe(0); expect(buildTableQueryTemplate(info, 'DELETE', 50).parameters).toBe(1);
    info.primaryKey = []; info.editableKey = ['金额']; info.indexes.push({ name: 'u', unique: true, columns: ['金额'] }); expect(buildTableQueryTemplate(info, 'DELETE', 50).parameters).toBe(1); info.columns[2].nullable = true; expect(() => buildTableQueryTemplate(info, 'DELETE', 50)).toThrow('可靠唯一键');
  });
  it('无可靠键、视图、未知对象及无非键字段不生成可误执行的写模板', () => {
    const info = fixture(); info.editableKey = []; for (const kind of ['UPDATE', 'DELETE'] as const) expect(() => buildTableQueryTemplate(info, kind, 100)).toThrow('可靠唯一键');
    for (const objectKind of ['view', undefined] as const) { const view = { ...fixture(), objectKind }; expect(buildTableQueryTemplate(view, 'SELECT', 100).sql).toContain('SELECT'); for (const kind of ['INSERT', 'UPDATE', 'DELETE'] as const) expect(() => buildTableQueryTemplate(view, kind, 100)).toThrow('普通表'); }
    const only = fixture(); only.columns = [only.columns[0]]; expect(() => buildTableQueryTemplate(only, 'UPDATE', 100)).toThrow('非键字段');
  });
  it('拒绝重复／缺失字段、非法名称／上限和超过200个参数，不截断SQL', () => {
    const info = fixture(); info.columns = Array.from({ length: 202 }, (_, index) => ({ ...info.columns[1], name: '字段' + index })); info.primaryKey = info.editableKey = [];
    expect(() => buildTableQueryTemplate(info, 'INSERT', 100)).toThrow('预算'); expect(buildTableQueryTemplate(info, 'SELECT', 100).sql).toContain('字段201');
    for (const limit of [0, -1, 100001, NaN, Infinity, 1.5]) expect(() => buildTableQueryTemplate(fixture(), 'SELECT', limit)).toThrow();
    for (const name of ['', 'x\0y', '\ud800', 'x'.repeat(65)]) expect(() => buildTableQueryTemplate({ ...fixture(), name }, 'SELECT', 50)).toThrow();
    const duplicate = fixture(); duplicate.columns.push(duplicate.columns[0]); expect(() => buildTableQueryTemplate(duplicate, 'SELECT', 50)).toThrow();
  });
  it('结构身份观察模板相关变化，不读取DDL、注释或默认值', () => {
    const info = fixture(); let reads = 0; for (const [object, key] of [[info, 'ddl'], [info.columns[0], 'comment'], [info.columns[0], 'defaultValue']] as const) Object.defineProperty(object, key, { get() { reads++; throw Error('不应读取'); } });
    const original = tableQueryTemplateMetadataKey(info); buildTableQueryTemplate(info, 'SELECT', 100); expect(reads).toBe(0); info.columns[1].type = 'text'; expect(tableQueryTemplateMetadataKey(info)).not.toBe(original);
  });
  it('四种SQL引号模式下沿正式参数扫描和绑定保持单语句，不把列名当参数', () => {
    const info = fixture(); info.columns[1].name = ':value_99`--列';
    for (const ansiQuotes of [false, true]) for (const noBackslashEscapes of [false, true]) for (const kind of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      const mode = { ansiQuotes, noBackslashEscapes }, output = buildTableQueryTemplate(info, kind, 100), names = namedParameterTokens(output.sql, mode).map(token => token.name);
      expect(names).toHaveLength(output.parameters); expect(names).not.toContain('value_99');
      const bound = bindQueryParameters(output.sql, new Map(names.map(name => [name, queryParameterLiteral({ name, type: 'text', value: "';DROP TABLE -- 🚢" })])), mode);
      expect(namedParameterTokens(bound, mode)).toEqual([]); expect(splitSql(bound, noBackslashEscapes, ansiQuotes)).toHaveLength(1);
    }
  });
});
