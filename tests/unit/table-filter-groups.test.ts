import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { CommandMap, FilterGroup, FilterRule, TableInfo } from '../../src/shared/contracts';
import { FILTER_LIMITS, filterGroupSchema, filterRuleSchema, sortRulesSchema, validateFilterGroup } from '../../src/shared/filtering';
import { commandSchemas, validateCommand } from '../../src/shared/validation';
import { tablePresetConfigurationSchema, tablePresetDocumentSchema, validateTablePresetColumns } from '../../src/shared/tablePresets';
import { buildPageSql } from '../../src/engine/sql';
import { buildReferencePageSql } from '../../src/engine/references';
import { TableCopySources } from '../../src/engine/tableCopySources';

const info: TableInfo = { database: 'db', name: 'items', engine: 'InnoDB', ddl: 'CREATE TABLE items (id BIGINT PRIMARY KEY)', primaryKey: ['id'], editableKey: ['id'], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], foreignKeys: [], columns: [
  { name: 'id', type: 'BIGINT UNSIGNED', nullable: false, defaultValue: null, extra: '', comment: '', generated: false },
  { name: 'note', type: 'VARCHAR(200)', nullable: true, defaultValue: null, extra: '', comment: '', generated: false },
  { name: 'amount', type: 'DECIMAL(65,30)', nullable: true, defaultValue: null, extra: '', comment: '', generated: false }
] };
const base = { connectionId: 'ram', database: 'db', table: 'items', page: 1, pageSize: 50, sort: [] };
const id = '11111111-1111-4111-8111-111111111111';
const rule = (value: string, enabled?: boolean): FilterRule => ({ column: 'note', operator: '=', value, ...(enabled === undefined ? {} : { enabled }) });
const group = (mode: 'all' | 'any', ...children: (number | FilterGroup)[]): FilterGroup => ({ mode, children });

describe('服务端表筛选完整分组合同', () => {
  it('复制独立深冻结树，每条包含停用条件恰好一次，原树及原文不冻结或修改', () => {
    const filters = [rule(' A '), rule('保留停用原文', false), rule('B')], input = group('all', 2, group('any', 1, 0));
    const parsed = validateFilterGroup(filters, 'all', input)!;
    expect(parsed).toEqual(input); expect(parsed).not.toBe(input); expect(parsed.children).not.toBe(input.children);
    expect(Object.isFrozen(parsed)).toBe(true); expect(Object.isFrozen(parsed.children)).toBe(true); expect(Object.isFrozen(parsed.children[1])).toBe(true);
    expect(Object.isFrozen(input)).toBe(false); expect(Object.isFrozen(filters)).toBe(false);
    (input.children as (number | FilterGroup)[])[0] = 0; filters[1].value = '后来修改';
    expect(parsed.children[0]).toBe(2); expect((parsed.children[1] as FilterGroup).children).toEqual([1, 0]);
  });

  it('缺省分组不补字段，空根只对应空filters，非根空子组始终拒绝', () => {
    expect(validateFilterGroup([rule('A')])).toBeUndefined(); expect(validateFilterGroup([], 'all', group('all'))).toEqual(group('all'));
    expect(() => validateFilterGroup([rule('A')], 'all', group('all'))).toThrow('恰好出现一次');
    expect(() => validateFilterGroup([], 'all', group('all', group('any')))).toThrow('不能为空');
    const parsed: any = validateCommand('table.page', { ...base, filters: [] }); expect(Object.hasOwn(parsed, 'filterGroup')).toBe(false);
  });

  it.each([[-1], [0.5], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER], ['0'], [null], [undefined], [0, 0], [0, 2]] as unknown[][])('拒绝非法/重复/越界索引：%j', children => {
    expect(() => validateFilterGroup([rule('A'), rule('B')], 'all', { mode: 'all', children } as FilterGroup)).toThrow();
  });

  it('漏掉停用条件、未知模式/字段及根mode不一致都不能降格为平铺', () => {
    expect(() => validateFilterGroup([rule('A'), rule('B', false)], 'all', group('all', 0))).toThrow('恰好出现一次');
    expect(() => validateFilterGroup([rule('A')], 'any', group('all', 0))).toThrow('filterMode');
    for (const filterGroup of [{ mode: 'xor', children: [0] }, { mode: 'all', children: [0], sql: 'OR 1=1' }, { mode: 'all', children: [0], filters: [] }, { mode: 'all', children: [0], enabled: false }]) {
      expect(() => filterGroupSchema.parse(filterGroup)).toThrow(); expect(() => validateCommand('table.page', { ...base, filters: [rule('A')], filterGroup })).toThrow();
    }
  });

  it('30叶、16组、8层完整边界均准入，超限不截断或删除条件', () => {
    const filters = Array.from({ length: 30 }, (_, index) => rule(String(index)));
    expect(validateFilterGroup(filters, 'all', group('all', ...filters.map((_, index) => index)))!.children).toHaveLength(30);
    expect(() => validateFilterGroup([...filters, rule('31')], 'all', group('all', ...Array.from({ length: 31 }, (_, index) => index)))).toThrow();
    const groups = group('all', ...Array.from({ length: 15 }, (_, index) => group('any', index)));
    expect(validateFilterGroup(filters.slice(0, 15), 'all', groups)).toEqual(groups);
    expect(() => validateFilterGroup(filters.slice(0, 16), 'all', group('all', ...Array.from({ length: 16 }, (_, index) => group('any', index))))).toThrow('16组');
    let nested = group('all', 0); for (let depth = 1; depth < 8; depth++) nested = group('all', nested);
    expect(validateFilterGroup([rule('A')], 'all', nested)).toEqual(nested);
    expect(() => validateFilterGroup([rule('A')], 'all', group('all', nested))).toThrow('8层');
    expect(FILTER_LIMITS).toMatchObject({ conditions: 30, groups: 16, depth: 8 });
  });

  it('循环、稀疏数组、继承字段和额外数组属性在递归前拒绝', () => {
    const cycle: any = { mode: 'all', children: [] }; cycle.children.push(cycle);
    const shared = group('any', 0);
    for (const value of [cycle, { mode: 'all', children: new Array(1) }, Object.assign(Object.create({ mode: 'all' }), { children: [0] }), { mode: 'all', children: Object.assign([0], { extra: true }) }, group('all', shared, shared)]) expect(() => filterGroupSchema.parse(value)).toThrow();
  });

  it.each(['mode', 'children', 'child', 'filterGroup', 'filterMode', 'filters', 'rule', 'members'] as const)('%s getter在schema/IPC/引擎中零调用', kind => {
    const getter = vi.fn(() => { throw Error('不能执行getter'); }), filters: any = [rule('A')], tree: any = group('all', 0), request: any = { ...base, filters, filterGroup: tree };
    if (kind === 'mode' || kind === 'children') Object.defineProperty(tree, kind, { enumerable: true, get: getter });
    if (kind === 'child') Object.defineProperty(tree.children, '0', { enumerable: true, get: getter });
    if (kind === 'filterGroup' || kind === 'filterMode' || kind === 'filters') Object.defineProperty(request, kind, { enumerable: true, get: getter });
    if (kind === 'rule') Object.defineProperty(filters[0], 'operator', { enumerable: true, get: getter });
    if (kind === 'members') { filters[0] = { column: 'note', operator: 'IN', values: ['A'] }; Object.defineProperty(filters[0].values, '0', { enumerable: true, get: getter }); }
    expect(commandSchemas['table.page'].safeParse(request).success).toBe(false); expect(() => validateCommand('table.page', request)).toThrow();
    if (!['filterGroup', 'filterMode', 'filters'].includes(kind)) expect(() => buildPageSql(info, 1, 50, filters, [], 'all', tree)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it('组或成员自定义迭代器不执行；跨realm普通对象仍能完整准入', () => {
    const getter = vi.fn(() => { throw Error('禁止自定义迭代器'); }), tree = group('all', 0);
    Object.defineProperty(tree.children, Symbol.iterator, { get: getter }); expect(() => filterGroupSchema.parse(tree)).toThrow(); expect(getter).not.toHaveBeenCalled();
    const foreign = runInNewContext(`({filters:[{column:'note',operator:'IN',values:['','  ','NULL'],enabled:false}],filterMode:'all',filterGroup:{mode:'all',children:[0]},sort:[]})`);
    expect(tablePresetConfigurationSchema.parse(foreign)).toEqual(foreign);
    expect(buildPageSql(info, 1, 50, foreign.filters, [], foreign.filterMode, foreign.filterGroup).params).toEqual([]);
  });
});

describe('真实分页SQL树、参数与关联约束', () => {
  it.each(['all', 'any'] as const)('无filterGroup的旧%s模板及参数逐字节保持', mode => {
    const filters: FilterRule[] = [{ column: 'id', operator: '=', value: '9007199254740993' }, { column: 'note', operator: 'IS NULL' }];
    const actual = buildPageSql(info, 2, 2, filters, [], mode);
    expect(actual).toEqual({ sql: `SELECT * FROM \`db\`.\`items\` WHERE ((\`id\` = CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)) ${mode === 'all' ? 'AND' : 'OR'} (\`note\` IS NULL)) ORDER BY \`id\` ASC LIMIT 3 OFFSET 2`, params: ['9007199254740993'] });
    expect(buildPageSql(info, 2, 2, filters, [], mode, undefined)).toEqual(actual);
  });

  it('DFS顺序绑定原文精确参数，所有组/叶保留括号；不按filters数组顺序错配参数', () => {
    const filters: FilterRule[] = [
      { column: 'id', operator: '=', value: '18446744073709551615' },
      { column: 'amount', operator: 'BETWEEN', values: ['0.12345678901234567890', '0.12345678901234567891'] },
      { column: 'note', operator: 'LIKE', value: "  %引号',逗号\\%  " }
    ];
    const actual = buildPageSql(info, 2, 2, filters, [], 'any', group('any', 2, group('all', 1, 0)));
    expect(actual.sql).toBe('SELECT * FROM `db`.`items` WHERE ((`note` LIKE ?) OR ((`amount` BETWEEN CAST(? AS DECIMAL(65,20)) AND CAST(? AS DECIMAL(65,20))) AND (`id` = CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED)))) ORDER BY `id` ASC LIMIT 3 OFFSET 2');
    expect(actual.params).toEqual([filters[2].value, ...filters[1].values!, filters[0].value]);
    expect(actual.sql).not.toContain('18446744073709551615');
  });

  it('NULL与完整IN原值独立语义，停用组从OR省略而非变true；全停用无WHERE', () => {
    const filters: FilterRule[] = [rule('A'), { column: 'note', operator: 'IS NULL', enabled: false }, { column: 'amount', operator: '=', value: '停用时未完成原文', enabled: false }];
    const tree = group('any', group('any', 1, 2), 0), actual = buildPageSql(info, 1, 50, filters, [], 'any', tree);
    expect(actual.sql).toBe('SELECT * FROM `db`.`items` WHERE ((`note` = ?)) ORDER BY `id` ASC LIMIT 51 OFFSET 0'); expect(actual.params).toEqual(['A']);
    expect(buildPageSql(info, 1, 50, filters.map(filter => ({ ...filter, enabled: false })), [], 'any', tree)).toEqual({ sql: 'SELECT * FROM `db`.`items` ORDER BY `id` ASC LIMIT 51 OFFSET 0', params: [] });
    const members: FilterRule[] = [{ column: 'note', operator: 'IN', values: ['', 'NULL', 'a,b\nc'] }, { column: 'note', operator: 'IS NULL' }];
    const result = buildPageSql(info, 1, 50, members, [], 'all', group('all', group('any', 1, 0)));
    expect(result.sql).toContain('WHERE (((`note` IS NULL) OR (`note` IN (?, ?, ?))))'); expect(result.params).toEqual(['', 'NULL', 'a,b\nc']);
  });

  it('停用叶仍校全部字段/原值体积/完整覆盖，不能借分组或停用隐藏非法输入', () => {
    expect(() => buildPageSql(info, 1, 50, [{ column: 'missing', operator: '=', value: '', enabled: false }], [], 'all', group('all', 0))).toThrow('未知筛选字段');
    expect(() => buildPageSql(info, 1, 50, [rule('x'.repeat(4097), false)], [], 'all', group('all', 0))).toThrow('4096');
    const oversized: FilterRule[] = Array.from({ length: 6 }, () => ({ column: 'note', operator: 'IN', values: Array(200).fill('x'), enabled: false }));
    expect(() => buildPageSql(info, 1, 50, oversized, [], 'all', group('all', ...oversized.map((_, index) => index)))).toThrow('1000');
    expect(() => buildPageSql(info, 1, 50, [rule('A'), rule('B', false)], [], 'all', group('all', 0))).toThrow('恰好出现一次');
  });

  it('关联外键强制AND整棵OR树，NULL匹配保护也不能被分组放宽', () => {
    const foreignKey = { name: 'fk', columns: ['owner'], referencedDatabase: 'db', referencedTable: 'items', referencedColumns: ['id'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' };
    const filters: FilterRule[] = [rule('A'), { column: 'amount', operator: '=', value: '9007199254740993.00000000000000000001' }], tree = group('any', 1, group('all', 0));
    const sql = buildReferencePageSql(info, foreignKey, ['7'], 1, 50, filters, [], 'any', tree);
    expect(sql).toContain("WHERE (`id` = CAST(_utf8mb4 X'37' AS DECIMAL(65,0))) AND ((`amount` = CAST(");
    expect(sql).toContain("AS DECIMAL(65,20))) OR ((`note` = _utf8mb4 X'41'))) ORDER BY `id` ASC");
    expect(buildReferencePageSql(info, foreignKey, [null], 1, 50, filters, [], 'any', tree)).toContain('WHERE (0 = 1) AND ((`amount` =');
  });

  it('真实copySource页路径传完整树，MDL内重读仍用DFS且不生成平铺条件', async () => {
    const sqls: string[] = [], cache = new TableCopySources({ info: async () => info, query: (async () => ({ rows: [] })) as never });
    const filters: FilterRule[] = [{ column: 'id', operator: '=', value: '9' }, rule('A')];
    const input: CommandMap['table.page']['input'] = { ...base, filters, filterMode: 'any', filterGroup: group('any', 1, group('all', 0)), copySource: true, taskId: id };
    try {
      await cache.page({ managed: {} as never, checkCancelled: () => {}, commandStarted: () => () => {} }, input, async (_managed, sql, page, pageSize) => { sqls.push(sql); return { columns: [], rows: [], hasMore: false, page, pageSize }; });
      expect(sqls).toEqual(["SELECT * FROM `db`.`items` WHERE ((`note` = _utf8mb4 X'41') OR ((`id` = CAST(CAST(_utf8mb4 X'39' AS DECIMAL(20,0)) AS UNSIGNED)))) ORDER BY `id` ASC LIMIT 51 OFFSET 0"]);
    } finally { cache.close(); }
  });
});

describe('分页IPC及命名方案不丢完整树', () => {
  it.each(['table.page', 'table.referencePage'] as const)('%s严格保留规范分组、mode和原值，未知/缺叶/错mode均拒绝', command => {
    const filters = [rule('A'), rule('保留', false)], tree = group('any', group('all', 1), 0);
    const input = { ...base, filters, filterMode: 'any', filterGroup: tree, ...(command === 'table.referencePage' ? { foreignKeyName: 'fk', matchValues: ['7'], taskId: id } : {}) };
    const parsed: any = validateCommand(command, input); expect(parsed).toEqual(input); expect(Object.isFrozen(parsed.filterGroup)).toBe(true);
    for (const filterGroup of [group('any', 0), group('all', 1, 0), { ...tree, sql: 'OR 1=1' }]) expect(() => validateCommand(command, { ...input, filterGroup })).toThrow();
    const inherited = Object.assign(Object.create({ filterGroup: tree }), { ...input }); delete inherited.filterGroup; expect(() => validateCommand(command, inherited)).toThrow('自有');
  });

  it('方案完整JSON往返、停用原文、列校验及文档保留group；旧strict客户端拒收，不flatten', () => {
    const configuration = { filters: [rule('A'), rule('未完成原文', false)], filterMode: 'all' as const, filterGroup: group('all', group('any', 1, 0)), sort: [{ column: 'note', direction: 'DESC' as const }] };
    const parsed = tablePresetConfigurationSchema.parse(JSON.parse(JSON.stringify(configuration)));
    expect(parsed).toEqual(configuration); expect(Object.isFrozen(parsed.filterGroup)).toBe(true);
    expect(validateTablePresetColumns(parsed, ['id', 'note', 'amount'])).toEqual(configuration);
    expect(() => validateTablePresetColumns(parsed, ['id', 'amount'])).toThrow('字段已不存在');
    const document = { version: 1, revision: 2, entries: [{ id, name: '完整表分组', connectionDigest: 'a'.repeat(64), configuration }] };
    expect(tablePresetDocumentSchema.parse(document)).toEqual(document);
    const legacy = z.object({ filters: z.array(filterRuleSchema), filterMode: z.enum(['all', 'any']), sort: sortRulesSchema }).strict();
    expect(legacy.safeParse(configuration).success).toBe(false);
    const { filterGroup: _group, ...old } = configuration; expect(tablePresetConfigurationSchema.parse(old)).toEqual(old); expect(Object.hasOwn(tablePresetConfigurationSchema.parse(old), 'filterGroup')).toBe(false);
  });

  it('方案分组继承或getter不会被Zod变成可用的缺省平铺', () => {
    const getter = vi.fn(() => { throw Error('不能执行getter'); }), configuration = { filters: [rule('A')], filterMode: 'all', sort: [] };
    expect(() => tablePresetConfigurationSchema.parse(Object.defineProperty({ ...configuration }, 'filterGroup', { enumerable: true, get: getter }))).toThrow();
    expect(() => tablePresetConfigurationSchema.parse(Object.assign(Object.create({ filterGroup: group('all', 0) }), configuration))).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});
