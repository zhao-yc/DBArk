import { describe, expect, it } from 'vitest';
import { buildForeignKeyJoin, foreignKeyJoinChoices, foreignKeyJoinLimits, foreignKeyJoinMetadataKey, type ForeignKeyJoinOptions } from '../../src/renderer/tableForeignKeyJoin';
import { tableForeignKeyJoinZh as text } from '../../src/renderer/locales/tableForeignKeyJoin.zh-CN';
import type { ColumnInfo, TableInfo } from '../../src/shared/contracts';
import { splitSql } from '../../src/engine/sql';
import { namedParameterTokens } from '../../src/shared/queryParameters';

const column = (name: string, nullable = false): ColumnInfo => ({ name, type: 'bigint', nullable, generated: false, extra: '', comment: '', defaultValue: null });
/** 两侧没有主键；JOIN必须完全按真实复合外键映射，不能自行猜定位列。 */
function fixture(): { child: TableInfo; parent: TableInfo } {
  const parent: TableInfo = { database: '父库', name: 'parents', objectKind: 'table', engine: 'InnoDB', columns: [column('pid'), column('tenant'), column('name')], foreignKeys: [], primaryKey: [], editableKey: [], indexes: [], ddl: '', comment: '' };
  const child: TableInfo = { ...parent, database: '子库', name: 'children', columns: [column('id'), column('tenant'), column('parent_id', true), column('name')], foreignKeys: [{ name: 'fk_parent', columns: ['tenant', 'parent_id'], referencedDatabase: parent.database, referencedTable: parent.name, referencedColumns: ['tenant', 'pid'], onUpdate: 'RESTRICT', onDelete: 'SET NULL' }] };
  return { child, parent };
}

describe('按一条真实外键生成独立JOIN SELECT', () => {
  it('跨库复合映射保持顺序，不猜主键；映射列可以不出现在输出选择中', () => {
    const { child, parent } = fixture();
    const result = buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 37, { childColumns: ['name'], parentColumns: ['name'] });
    expect(result.columns).toEqual([{ side: 'child', column: 'name', alias: 'c_4_name' }, { side: 'parent', column: 'name', alias: 'p_3_name' }]);
    expect(result.sql).toContain('FROM `子库`.`children` AS c\nLEFT JOIN `父库`.`parents` AS p');
    expect(result.sql).toContain('c.`tenant` = p.`tenant`'); expect(result.sql).toContain('c.`parent_id` = p.`pid`');
    expect(result.sql.indexOf('c.`tenant` = p.`tenant`')).toBeLessThan(result.sql.indexOf('c.`parent_id` = p.`pid`'));
    expect(result.sql).toMatch(/LIMIT 37;$/); expect(result.sql).not.toContain('c.`id` =');
    expect(splitSql(result.sql)).toHaveLength(1);
  });

  it('LEFT保留子表NULL关系，INNER只改变连接种类，ON始终使用普通等号', () => {
    const { child, parent } = fixture();
    const left = buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50), inner = buildForeignKeyJoin(child, parent, 'fk_parent', 'INNER', 50);
    expect(inner.sql).toBe(left.sql.replace('\nLEFT JOIN ', '\nINNER JOIN '));
    expect(left.sql).not.toMatch(/<=>|IS NULL|COALESCE|\bOR\b|WHERE/);
    expect(left.sql.match(/ = p\./g)).toHaveLength(2);
  });

  it('合法可空UNIQUE复合外键不要求非空定位键，关联按a/b而非父主键；NULL实际结果另由实库验收', () => {
    const { child, parent } = fixture();
    parent.columns = [column('id'), column('a', true), { ...column('b', true), type: 'decimal(20,4)' }, column('ancestor_a', true), { ...column('ancestor_b', true), type: 'decimal(20,4)' }];
    parent.primaryKey = parent.editableKey = ['id']; parent.indexes = [{ name: 'PRIMARY', unique: true, columns: ['id'] }, { name: 'nullable_pair', unique: true, columns: ['a', 'b'] }];
    parent.foreignKeys = [{ name: 'fk_ancestor', columns: ['ancestor_a', 'ancestor_b'], referencedDatabase: parent.database, referencedTable: parent.name, referencedColumns: ['a', 'b'], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }];
    child.columns = [column('id'), column('parent_a', true), { ...column('parent_b', true), type: 'decimal(20,4)' }];
    child.foreignKeys[0].columns = ['parent_a', 'parent_b']; child.foreignKeys[0].referencedColumns = ['a', 'b'];
    const left = buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50);
    expect(left.sql).toContain('c.`parent_a` = p.`a`\n  AND c.`parent_b` = p.`b`');
    expect(left.sql).not.toContain('<=>'); expect(left.sql).not.toContain('= p.`id`'); expect(left.sql).not.toContain('12.3400');
    const self = buildForeignKeyJoin(parent, parent, 'fk_ancestor', 'LEFT', 50);
    expect(self.sql).toContain('c.`ancestor_a` = p.`a`\n  AND c.`ancestor_b` = p.`b`'); expect(self.sql).not.toContain('<=>');
    expect(new Set(self.columns.map(value => value.alias)).size).toBe(parent.columns.length * 2);
  });

  it('两侧同名输出都有稳定且全局唯一的别名，不用SELECT星号造成重复字段丢失', () => {
    const { child, parent } = fixture(), result = buildForeignKeyJoin(child, parent, 'fk_parent', 'INNER', 1);
    expect(result.columns).toHaveLength(child.columns.length + parent.columns.length);
    expect(new Set(result.columns.map(value => value.alias.toLowerCase())).size).toBe(result.columns.length);
    expect(result.columns.filter(value => value.column === 'name').map(value => value.alias)).toEqual(['c_4_name', 'p_3_name']);
    expect(result.sql).not.toMatch(/SELECT\s+\*/);
    for (const field of result.columns) expect(result.sql).toContain(' AS `' + field.alias + '`');
  });

  it('自关联仍使用两个明确别名，双方同表元数据不会互相覆盖', () => {
    const { child } = fixture(); child.foreignKeys[0].referencedDatabase = child.database; child.foreignKeys[0].referencedTable = child.name; child.foreignKeys[0].referencedColumns = ['tenant', 'id'];
    const result = buildForeignKeyJoin(child, child, 'fk_parent', 'LEFT', 10);
    expect(result.sql).toContain('FROM `子库`.`children` AS c\nLEFT JOIN `子库`.`children` AS p');
    expect(result.sql).toContain('c.`parent_id` = p.`id`');
    expect(new Set(result.columns.map(value => value.alias)).size).toBe(child.columns.length * 2);
  });

  it('特殊标识符只按backtick引用，外键名称不会进入注释或SQL；四种模式均为单语句零参数', () => {
    const { child, parent } = fixture();
    child.database = '库`名; --'; child.name = '子:名 🚢'; parent.database = '父`库'; parent.name = 'parent;名';
    child.columns[2].name = '列` :fake 🚢'; parent.columns[0].name = '父`列';
    const fk = child.foreignKeys[0]; fk.name = 'fk_/*PRIVATE_NOTE*/'; fk.columns[1] = child.columns[2].name; fk.referencedDatabase = parent.database; fk.referencedTable = parent.name; fk.referencedColumns[1] = parent.columns[0].name;
    const result = buildForeignKeyJoin(child, parent, fk.name, 'LEFT', 100);
    expect(result.sql).toContain('`库``名; --`.`子:名 🚢`'); expect(result.sql).toContain('c.`列`` :fake 🚢` = p.`父``列`'); expect(result.sql).not.toContain('PRIVATE_NOTE');
    for (const ansiQuotes of [false, true]) for (const noBackslashEscapes of [false, true]) {
      expect(splitSql(result.sql, noBackslashEscapes, ansiQuotes)).toHaveLength(1);
      expect(namedParameterTokens(result.sql, { ansiQuotes, noBackslashEscapes })).toEqual([]);
    }
  });

  it('显式选列顺序原样保留，稳定别名仍绑定原元数据序号，允许仅输出一侧', () => {
    const { child, parent } = fixture(), original = buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50);
    const result = buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50, { childColumns: ['name', 'id'], parentColumns: ['name', 'pid'] });
    expect(result.columns.map(value => [value.side, value.column])).toEqual([['child', 'name'], ['child', 'id'], ['parent', 'name'], ['parent', 'pid']]);
    for (const field of result.columns) expect(field.alias).toBe(original.columns.find(value => value.side === field.side && value.column === field.column)!.alias);
    expect(buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50, { childColumns: [], parentColumns: ['pid'] }).columns).toEqual([{ side: 'parent', column: 'pid', alias: 'p_1_pid' }]);
  });

  it('长Unicode列名生成不超过64个UTF16单元的合法别名，不截坏代理对', () => {
    const { child, parent } = fixture(); child.columns[3].name = 'x'.repeat(59) + '🚢尾';
    const result = buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50, { childColumns: [child.columns[3].name], parentColumns: [] });
    const alias = result.columns[0].alias;
    expect(alias.length).toBeLessThanOrEqual(64); expect(Buffer.from(alias, 'utf8').toString('utf8')).toBe(alias); expect(alias.startsWith('c_4_')).toBe(true); expect(alias).not.toContain('🚢');
  });

  it('外键选择返回副本，修改选项不改原关系或随后生成的ON', () => {
    const { child, parent } = fixture(), before = structuredClone(child), choices = foreignKeyJoinChoices(child);
    expect(choices).toEqual([{ name: 'fk_parent', columns: ['tenant', 'parent_id'], referencedDatabase: '父库', referencedTable: 'parents', referencedColumns: ['tenant', 'pid'] }]);
    choices[0].columns.reverse(); choices[0].referencedTable = '伪造'; expect(child).toEqual(before);
    expect(buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50).sql).toContain('c.`parent_id` = p.`pid`');
  });
});

describe('结构身份、目标及生成预算', () => {
  it('元数据签名绑定列顺序/类型和完整外键，不读取DDL、注释、默认值或主键', () => {
    const { child, parent } = fixture(); let reads = 0;
    for (const [record, key] of [[child, 'ddl'], [child, 'comment'], [child, 'indexes'], [child, 'primaryKey'], [child, 'editableKey'], [child.columns[0], 'defaultValue'], [child.columns[0], 'comment']] as const) Object.defineProperty(record, key, { get() { reads++; throw Error('不应读取私有或无关内容'); } });
    const before = foreignKeyJoinMetadataKey(child); buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50); foreignKeyJoinChoices(child); expect(reads).toBe(0);
    child.columns[0].type = 'decimal(20,0)'; expect(foreignKeyJoinMetadataKey(child)).not.toBe(before);
    const typed = foreignKeyJoinMetadataKey(child); child.foreignKeys[0].onDelete = 'RESTRICT'; expect(foreignKeyJoinMetadataKey(child)).not.toBe(typed);
    const action = foreignKeyJoinMetadataKey(child); child.columns.reverse(); expect(foreignKeyJoinMetadataKey(child)).not.toBe(action);
  });

  it.each(['view', undefined] as const)('双方对象种类必须已确认为普通表，拒绝%s', objectKind => {
    const { child, parent } = fixture();
    expect(() => buildForeignKeyJoin({ ...child, objectKind }, parent, 'fk_parent', 'LEFT', 50)).toThrow(text.ordinary);
    expect(() => buildForeignKeyJoin(child, { ...parent, objectKind }, 'fk_parent', 'LEFT', 50)).toThrow(text.ordinary);
  });

  it('未知/重名外键及错误父目标不回退其它关系或同名列', () => {
    const { child, parent } = fixture();
    expect(() => buildForeignKeyJoin(child, parent, 'missing', 'LEFT', 50)).toThrow(text.relation);
    expect(() => buildForeignKeyJoin(child, { ...parent, database: '另一个库' }, 'fk_parent', 'LEFT', 50)).toThrow(text.target);
    expect(() => buildForeignKeyJoin(child, { ...parent, name: 'PARENTS' }, 'fk_parent', 'LEFT', 50)).toThrow(text.target);
    child.foreignKeys.push(structuredClone(child.foreignKeys[0])); expect(() => foreignKeyJoinChoices(child)).toThrow(text.relation);
  });

  it.each(['empty', 'length', 'duplicate-child', 'duplicate-parent', 'missing-child', 'missing-parent'] as const)('完整映射异常%s整份拒绝，不截断复合关联', mode => {
    const { child, parent } = fixture(), fk = child.foreignKeys[0];
    if (mode === 'empty') { fk.columns = []; fk.referencedColumns = []; }
    if (mode === 'length') fk.referencedColumns.pop();
    if (mode === 'duplicate-child') fk.columns[1] = fk.columns[0];
    if (mode === 'duplicate-parent') fk.referencedColumns[1] = fk.referencedColumns[0];
    if (mode === 'missing-child') fk.columns[1] = 'missing';
    if (mode === 'missing-parent') fk.referencedColumns[1] = 'missing';
    expect(() => buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50)).toThrow(text.relation);
  });

  it.each([{ childColumns: [], parentColumns: [] }, { childColumns: ['id', 'id'], parentColumns: [] }, { childColumns: ['missing'], parentColumns: ['pid'] }, { childColumns: [], parentColumns: ['pid', 'pid'] }])('显式非法选列不静默过滤：%j', options => {
    const { child, parent } = fixture(); expect(() => buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50, options)).toThrow(text.columns);
  });

  it('访问器及稀疏选列不会执行getter或变为另一组选列', () => {
    const { child, parent } = fixture(); let reads = 0;
    const options = { parentColumns: [] };
    Object.defineProperty(options, 'childColumns', { enumerable: true, get() { reads++; return ['id']; } });
    expect(() => buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50, options as unknown as ForeignKeyJoinOptions)).toThrow(); expect(reads).toBe(0);
    const sparse = Array<string>(1); expect(() => buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50, { childColumns: sparse, parentColumns: [] })).toThrow();
    Object.defineProperty(child.columns[0], 'name', { get() { reads++; return 'id'; } });
    expect(() => foreignKeyJoinMetadataKey(child)).toThrow(); expect(reads).toBe(0);
  });

  it('宽表可显式精简，而默认全部输出超过数量预算时整份拒绝', () => {
    const { child, parent } = fixture();
    child.columns.push(...Array.from({ length: 600 }, (_, index) => column('child_' + index)));
    parent.columns.push(...Array.from({ length: 600 }, (_, index) => column('parent_' + index)));
    expect(() => buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50)).toThrow(text.budget);
    expect(buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50, { childColumns: ['id'], parentColumns: ['pid'] }).columns).toHaveLength(2);
  });

  it('SQL预算包括完整ON条件，即使少量输出也不能省略超大复合映射', () => {
    const { child, parent } = fixture();
    child.columns = Array.from({ length: 2000 }, (_, index) => column('c' + String(index).padStart(5, '0') + '`'.repeat(58)));
    parent.columns = Array.from({ length: 2000 }, (_, index) => column('p' + String(index).padStart(5, '0') + '`'.repeat(58)));
    child.foreignKeys[0].columns = child.columns.map(value => value.name); child.foreignKeys[0].referencedColumns = parent.columns.map(value => value.name);
    expect(() => buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', 50, { childColumns: [child.columns[0].name], parentColumns: [] })).toThrow(text.budget);
  });

  it('元数据数量与总字符预算在发布前拒绝，不读取无界数组或截断结构签名', () => {
    const { child } = fixture(); child.columns = Array<ColumnInfo>(foreignKeyJoinLimits.columns + 1);
    expect(() => foreignKeyJoinMetadataKey(child)).toThrow(text.budget);
    const other = fixture().child; other.columns.push(...Array.from({ length: 300 }, (_, index) => ({ ...column('wide_' + index), type: 'x'.repeat(4096), extra: 'y'.repeat(4096) })));
    expect(() => foreignKeyJoinMetadataKey(other)).toThrow(text.budget);
  });

  it.each([0, -1, 100001, NaN, Infinity, 1.5])('LIMIT %s不合法，不能输出无上限草稿', limit => {
    const { child, parent } = fixture(); expect(() => buildForeignKeyJoin(child, parent, 'fk_parent', 'LEFT', limit)).toThrow(text.invalid);
  });
  it('未知连接种类、空名称或无效Unicode标识符整份拒绝', () => {
    const { child, parent } = fixture();
    expect(() => buildForeignKeyJoin(child, parent, 'fk_parent', 'CROSS' as 'LEFT', 50)).toThrow(text.invalid);
    for (const name of ['', 'x\0y', '\ud800', 'x'.repeat(65)]) expect(() => buildForeignKeyJoin({ ...child, name }, parent, 'fk_parent', 'LEFT', 50)).toThrow();
  });
});
