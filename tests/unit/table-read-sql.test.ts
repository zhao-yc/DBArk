import { describe, expect, it, vi } from 'vitest';
import type { ColumnInfo, FilterGroup, FilterRule, SortRule, TableInfo } from '../../src/shared/contracts';
import { buildFilteredTableSelect, buildTableFilterSql, buildTableReadOrder, tableReadSqlLimits, type FilteredTableSelectInput } from '../../src/shared/tableReadSql';
import { buildPageSql, buildTableFilterSql as engineFilter, inlineParameters, splitSql } from '../../src/engine/sql';

const column = (name: string, type = 'VARCHAR(100)'): ColumnInfo => ({ name, type, nullable: true, defaultValue: null, extra: '', comment: '', generated: false });
const info = (): TableInfo => ({ database: '库?.``', name: '表?`', columns: [column('id', 'BIGINT UNSIGNED'), column('note'), column('amount', 'DECIMAL(40,18)'), column('at', 'DATETIME(6)'), column('float_value', 'FLOAT'), column('col?`')], primaryKey: ['id'], editableKey: ['id'], indexes: [], foreignKeys: [], engine: 'InnoDB', ddl: '' });
const input = (patch: Partial<FilteredTableSelectInput> = {}): FilteredTableSelectInput => ({ info: info(), filters: [], sort: [], columns: ['note', 'id'], limit: 1000, ...patch });
const literal = (value: string) => `_utf8mb4 X'${Buffer.from(value).toString('hex')}'`;
const group = (mode: 'all' | 'any', ...children: (number | FilterGroup)[]): FilterGroup => ({ mode, children });

describe('原表页筛选与排序共享编译', () => {
  it.each(['all', 'any'] as const)('旧平铺%s参数与分页SQL逐字节保持，limit仍多取一条', mode => {
    const source = { ...info(), database: 'db', name: 'items' }, filters: FilterRule[] = [{ column: 'id', operator: '=', value: '9007199254740993' }, { column: 'note', operator: 'IS NULL' }];
    expect(buildPageSql(source, 2, 2, filters, [], mode)).toEqual({ sql: `SELECT * FROM \`db\`.\`items\` WHERE ((\`id\` = CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)) ${mode === 'all' ? 'AND' : 'OR'} (\`note\` IS NULL)) ORDER BY \`id\` ASC LIMIT 3 OFFSET 2`, params: ['9007199254740993'] });
    expect(engineFilter(source, filters, mode)).toEqual(buildTableFilterSql(source, filters, mode));
  });
  it('原嵌套DFS参数顺序、括号和停用子组省略不变，字面量只在原参数点注入', () => {
    const filters: FilterRule[] = [{ column: 'id', operator: '=', value: '18446744073709551615' }, { column: 'amount', operator: 'BETWEEN', values: ['0.123456789012345678', '0.123456789012345679'] }, { column: 'note', operator: 'LIKE', value: '  %中_\\%  ' }, { column: 'note', operator: '=', value: '停用', enabled: false }];
    const tree = group('any', 2, group('all', 1, 0), group('any', 3));
    const expected = { where: '((`note` LIKE ?) OR ((`amount` BETWEEN CAST(? AS DECIMAL(65,18)) AND CAST(? AS DECIMAL(65,18))) AND (`id` = CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED))))', params: ['  %中_\\%  ', ...filters[1].values!, filters[0].value] };
    expect(buildTableFilterSql(info(), filters, 'any', tree)).toEqual(expected); expect(engineFilter(info(), filters, 'any', tree)).toEqual(expected);
    const bind = vi.fn(literal), expanded = buildTableFilterSql(info(), filters, 'any', tree, bind);
    expect(bind.mock.calls.map(([value]) => value)).toEqual(expected.params); expect(expanded.params).toEqual(expected.params);
    expect(expanded.where).toBe(`((\`note\` LIKE ${literal(filters[2].value!)}) OR ((\`amount\` BETWEEN CAST(${literal(filters[1].values![0])} AS DECIMAL(65,18)) AND CAST(${literal(filters[1].values![1])} AS DECIMAL(65,18))) AND (\`id\` = CAST(CAST(${literal(filters[0].value!)} AS DECIMAL(20,0)) AS UNSIGNED))))`);
  });
  it.each(['all', 'any'] as const)('新SELECT的FROM/WHERE/ORDER与实际表页inline SQL逐字节相同：%s', mode => {
    const source = info(), filters: FilterRule[] = [
      { column: 'id', operator: 'IN', values: ['9007199254740993', '18446744073709551615'] },
      { column: 'amount', operator: 'BETWEEN', values: ['-0.123456789012345678', '0.123456789012345679'] },
      { column: 'col?`', operator: 'IN', values: [" O'Reilly\\%_\0\n🚢中文 ", '', 'NULL', '? :name ; SELECT 2'] },
      { column: 'note', operator: 'IS NULL' }, { column: 'note', operator: '=', value: '停用', enabled: false },
    ];
    const sort: SortRule[] = [{ column: 'col?`', direction: 'DESC' }, { column: 'amount', direction: 'ASC' }];
    for (const filterGroup of [undefined, group(mode, group('any', 3, 4), group('all', 2, 1), 0)]) {
      const page = buildPageSql(source, 1, 50, filters, sort, mode, filterGroup), actual = inlineParameters(page.sql, page.params);
      const generated = buildFilteredTableSelect(input({ info: source, filters, sort, filterMode: mode, filterGroup, limit: 50, columns: ['col?`', 'amount', 'id'] }));
      const body = (sql: string) => sql.slice(sql.indexOf(' FROM '), sql.lastIndexOf(' LIMIT '));
      expect(body(generated.sql)).toBe(body(actual)); expect(generated.parameters).toBe(0);
      expect(generated.sql).not.toContain('CONVERT('); expect(generated.sql).toContain('`col?``` IN (_utf8mb4 X\'');
    }
  });
  it('显式多列原顺序，补原可靠键ASC；无键时不伪造排序', () => {
    expect(buildTableReadOrder(info(), [{ column: 'note', direction: 'DESC' }, { column: 'amount', direction: 'ASC' }])).toBe('`note` DESC, `amount` ASC, `id` ASC');
    expect(buildTableReadOrder(info(), [{ column: 'id', direction: 'DESC' }])).toBe('`id` DESC');
    expect(buildTableReadOrder({ ...info(), editableKey: [] }, [])).toBe('');
    const source = { ...info(), editableKey: ['amount', 'id'] }; expect(buildTableReadOrder(source, [{ column: 'id', direction: 'DESC' }])).toBe('`id` DESC, `amount` ASC');
  });
  it('20条显式排序加可靠键仍合法，重复/非法项/损坏可靠键全部拒绝', () => {
    const source = { ...info(), columns: [column('id'), ...Array.from({ length: 20 }, (_, index) => column('c' + index))] }, sort: SortRule[] = source.columns.slice(1).map(item => ({ column: item.name, direction: 'DESC' }));
    expect(buildTableReadOrder(source, sort).split(', ')).toHaveLength(21); expect(buildPageSql(source, 1, 50, [], sort).sql).toContain('`c19` DESC, `id` ASC LIMIT 51 OFFSET 0');
    for (const invalid of [[...sort, { column: 'id', direction: 'ASC' }], [{ column: 'note', direction: 'ASC' }, { column: 'note', direction: 'DESC' }], [{ column: 'missing', direction: 'ASC' }], [{ column: 'id', direction: 'DESC; DROP TABLE t' }], [{ column: 'id', direction: 'ASC', extra: true }]]) expect(() => buildTableReadOrder(info(), invalid as SortRule[])).toThrow();
    for (const keys of [['missing'], ['id', 'id']]) expect(() => buildTableReadOrder({ ...info(), editableKey: keys }, [])).toThrow();
    const getter = vi.fn(() => 'id'), rule = Object.defineProperty({ direction: 'ASC' }, 'column', { enumerable: true, get: getter }); expect(() => buildTableReadOrder(info(), [rule as SortRule])).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
});

describe('从当前筛选生成单条独立SELECT', () => {
  it('显式选列顺序、含问号和反引号标识符、首行LIMIT，无OFFSET或待绑定参数', () => {
    const generated = buildFilteredTableSelect(input({ columns: ['col?`', 'note', 'id'], filters: [{ column: 'col?`', operator: '=', value: '? :name ; SELECT 2' }], sort: [{ column: 'col?`', direction: 'DESC' }], limit: 100000 }));
    expect(generated).toEqual({ sql: `SELECT \`col?\`\`\`, \`note\`, \`id\` FROM \`库?.\`\`\`\`\`.\`表?\`\`\` WHERE ((\`col?\`\`\` = ${literal('? :name ; SELECT 2')})) ORDER BY \`col?\`\`\` DESC, \`id\` ASC LIMIT 100000;`, parameters: 0 });
    expect(generated.sql).not.toContain('OFFSET'); expect(splitSql(generated.sql)).toHaveLength(1);
  });
  it.each(['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE'] as const)('%s保留空白、引号、反斜线、NUL、换行和有效Unicode原值，所有SQL模式均单条', operator => {
    const value = "  O'Reilly\\%_\0\n🚢中文  ", built = buildFilteredTableSelect(input({ filters: [{ column: 'note', operator, value }] }));
    expect(built.sql).toContain(`WHERE ((\`note\` ${operator} ${literal(value)}))`); expect(built.parameters).toBe(0);
    for (const nbe of [false, true]) for (const ansi of [false, true]) expect(splitSql(built.sql, nbe, ansi)).toHaveLength(1);
    expect(built.sql).not.toContain(value);
  });
  it.each(['IN', 'NOT IN'] as const)('%s不拆分原集合，不把文字NULL、空串或逗号换行当NULL组', operator => {
    const values = ['', 'NULL', ' a,b\nc ', "'\\"]; const built = buildFilteredTableSelect(input({ filters: [{ column: 'note', operator, values }] }));
    expect(built.sql).toContain(`WHERE ((\`note\` ${operator} (${values.map(literal).join(', ')})))`);
  });
  it('BETWEEN/NULL和空条件保持原语义，NULL条件不调用文字量编译', () => {
    const filters: FilterRule[] = [{ column: 'note', operator: 'BETWEEN', values: [' A ', ' Z '] }, { column: 'note', operator: 'IS NULL' }, { column: 'note', operator: 'IS NOT NULL', enabled: false }];
    const built = buildFilteredTableSelect(input({ filters, filterMode: 'any' }));
    expect(built.sql).toContain(`WHERE ((\`note\` BETWEEN ${literal(' A ')} AND ${literal(' Z ')}) OR (\`note\` IS NULL))`);
    expect(buildFilteredTableSelect(input({ filters: filters.map(rule => ({ ...rule, enabled: false })) })).sql).not.toContain('WHERE');
    const bind = vi.fn(literal); expect(buildTableFilterSql(info(), [{ column: 'note', operator: 'IS NOT NULL' }], 'all', undefined, bind)).toEqual({ where: '((`note` IS NOT NULL))', params: [] }); expect(bind).not.toHaveBeenCalled();
  });
  it.each(['18446744073709551615', '+00018446744073709551615', '9007199254740993'])('UINT64原文%s不经Number，保住原双CAST', value => {
    expect(buildFilteredTableSelect(input({ filters: [{ column: 'id', operator: '=', value }] })).sql).toContain(`CAST(CAST(${literal(value)} AS DECIMAL(20,0)) AS UNSIGNED)`);
  });
  it('负数、UINT64溢出和精确小数保原DECIMAL尺度，浮点及时间不另加类型转换', () => {
    for (const value of ['-1', '18446744073709551616', '0.5']) expect(buildFilteredTableSelect(input({ filters: [{ column: 'id', operator: '=', value }] })).sql).toContain(`CAST(${literal(value)} AS DECIMAL(65,${value.includes('.') ? 1 : 0}))`);
    const value = '12345678901234567890.123456789012345678'; expect(buildFilteredTableSelect(input({ filters: [{ column: 'amount', operator: '=', value }] })).sql).toContain(`CAST(${literal(value)} AS DECIMAL(65,18))`);
    for (const [name, value] of [['float_value', '1e-30'], ['float_value', '-0'], ['at', '2026-10-23 12:34:56.123456']]) expect(buildFilteredTableSelect(input({ filters: [{ column: name, operator: '=', value }] })).sql).toContain(`\`${name}\` = ${literal(value)}`);
    for (const value of ['1e20', ' 1', 'NaN', '1'.repeat(66)]) expect(() => buildFilteredTableSelect(input({ filters: [{ column: 'id', operator: '=', value }] }))).toThrow();
  });
  it('1000个值完整展开不套命名参数200名称限制，超总量/单集合量拒绝', () => {
    const filters: FilterRule[] = Array.from({ length: 5 }, (_, set) => ({ column: 'note', operator: 'IN', values: Array.from({ length: 200 }, (_, index) => `${set}:${index}`) }));
    const built = buildFilteredTableSelect(input({ filters })); expect([...built.sql.matchAll(/_utf8mb4 X'/g)]).toHaveLength(1000); expect(built.parameters).toBe(0);
    expect(() => buildFilteredTableSelect(input({ filters: [...filters, filters[0]] }))).toThrow('1000');
    expect(() => buildFilteredTableSelect(input({ filters: [{ column: 'note', operator: 'IN', values: Array(201).fill('x') }] }))).toThrow('200');
  });
  it('列白名单、列数、limit、损坏Unicode与停用非法字段均拒绝，不变更原输入', () => {
    const original = input({ filters: [{ column: 'note', operator: '=', value: ' 原值 ' }] }), before = structuredClone(original); buildFilteredTableSelect(original); expect(original).toEqual(before);
    for (const columns of [[], ['missing'], ['note', 'note'], Array(4097).fill('note')]) expect(() => buildFilteredTableSelect(input({ columns }))).toThrow();
    for (const limit of [0, 100001, 1000000, 1.1, NaN, Infinity]) expect(() => buildFilteredTableSelect(input({ limit }))).toThrow('100000');
    for (const bad of ['\ud800', '\udfff', 'x\ud800z']) {
      expect(() => buildFilteredTableSelect(input({ filters: [{ column: 'note', operator: '=', value: bad, enabled: false }] }))).toThrow('Unicode');
      expect(() => buildFilteredTableSelect(input({ info: { ...info(), name: bad } }))).toThrow('Unicode');
    }
    expect(() => buildFilteredTableSelect(input({ filters: [{ column: 'missing', operator: '=', value: '', enabled: false }] }))).toThrow('未知筛选字段');
    expect(() => buildFilteredTableSelect(input({ info: { ...info(), columns: [...info().columns, column('id')] } }))).toThrow();
    expect(buildFilteredTableSelect(input({ limit: 1 })).sql).toMatch(/LIMIT 1;$/);
  });
  it('完整SQL2MiB预算拒绝HEX膨胀与字段投影造成的超限，不交付截断文本', () => {
    expect(tableReadSqlLimits.sqlBytes).toBe(2 * 1024 * 1024);
    expect(() => buildFilteredTableSelect(input({ filters: [{ column: 'note', operator: 'IN', values: Array(200).fill('中'.repeat(3500)) }] }))).toThrow('2MiB');
    const columns = Array.from({ length: 4096 }, (_, index) => column('c' + String(index).padStart(4, '0') + 'x'.repeat(59))), source = { ...info(), columns, editableKey: [] };
    const filters: FilterRule[] = Array.from({ length: 4 }, () => ({ column: columns[0].name, operator: 'IN', values: Array(200).fill('a'.repeat(1200)) }));
    expect(() => buildFilteredTableSelect(input({ info: source, columns: columns.map(item => item.name), filters }))).toThrow('2MiB');
    const widest = buildFilteredTableSelect(input({ info: source, columns: columns.map(item => item.name) })); expect(widest.sql.split(' FROM ')[0].split(', ')).toHaveLength(4096);
  });
});
