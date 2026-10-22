import { describe, expect, it } from 'vitest';
import type { ColumnInfo, DataRow, FilterGroup, FilterRule, TableInfo } from '../../src/shared/contracts';
import { FILTER_LIMITS } from '../../src/shared/filtering';
import { buildTableFilterSql } from '../../src/engine/sql';
import type { DraftRow } from '../../src/renderer/dataChanges';
import { buildTableSelectedFilter, type TableSelectedFilterInput, type TableSelectedFilterProposal } from '../../src/renderer/tableSelectedFilter';

const field = (name: string): ColumnInfo => ({ name, type: 'text', nullable: true, defaultValue: null, extra: '', generated: false, comment: '' });
/** 独立原行和草稿；故意反向勾选，以证明提案按页面顺序完整收集。 */
function fixture(values: readonly unknown[], key = '字段'): TableSelectedFilterInput {
  const rows: DraftRow[] = values.map((value, index) => ({ id: 'row-' + index, data: { [key]: value } as DataRow, original: { [key]: value } as DataRow, inserted: false, deleted: false }));
  return { columns: [field(key), field('旧条件')], rows, visible: [key, '旧条件'], selection: { rowId: rows[0]?.id ?? 'row-0', key }, selected: new Set(rows.map(row => row.id).reverse()), conditions: { filters: [], filterMode: 'all' }, exclude: false };
}
/** 只由正式引擎构建器解释筛选与绑定，不调用数据库或拼接用户原值。 */
function sql(input: TableSelectedFilterInput, result: TableSelectedFilterProposal) {
  const info: TableInfo = { database: '库', name: '表', engine: 'InnoDB', columns: [...input.columns], primaryKey: [], editableKey: [], indexes: [], foreignKeys: [], ddl: '' };
  return buildTableFilterSql(info, result.filters, result.filterMode, result.filterGroup);
}
/** 独立SQL三值逻辑真值器，覆盖NULL不属于NOT IN结果的原生语义。 */
function matches(result: TableSelectedFilterProposal, row: Record<string, string | null>): boolean {
  type Truth = boolean | null | undefined;
  const leaf = (rule: FilterRule): Truth => {
    if (rule.enabled === false) return undefined;
    const value = row[rule.column];
    if (rule.operator === 'IS NULL') return value === null;
    if (rule.operator === 'IS NOT NULL') return value !== null;
    if (value === null) return null;
    if (rule.operator === 'IN' || rule.operator === 'NOT IN') { const included = rule.values!.includes(value); return rule.operator === 'IN' ? included : !included; }
    if (rule.operator === '=') return value === rule.value;
    throw Error('真值样本未定义该运算符');
  };
  const group = (node: FilterGroup): Truth => {
    const children = node.children.map(child => typeof child === 'number' ? leaf(result.filters[child]) : group(child)).filter(value => value !== undefined);
    if (!children.length) return undefined;
    if (node.mode === 'all') return children.includes(false) ? false : children.includes(null) ? null : true;
    return children.includes(true) ? true : children.includes(null) ? null : false;
  };
  const truth = group(result.filterGroup); return truth === true || truth === undefined;
}

describe('按勾选原行构造服务器包含/排除筛选提案', () => {
  const nullCases: { selected: (string | null)[]; include: boolean[]; exclude: boolean[] }[] = [
    { selected: ['A'], include: [false, true, false], exclude: [true, false, true] },
    { selected: [null], include: [true, false, false], exclude: [false, true, true] },
    { selected: [null, 'A'], include: [true, true, false], exclude: [false, false, true] },
  ];
  it.each(nullCases)('NULL完整真值：选中$selected时包含和排除为完整补集', ({ selected, include, exclude }) => {
    const input = fixture(selected);
    const included = buildTableSelectedFilter(input), excluded = buildTableSelectedFilter({ ...input, exclude: true });
    expect([null, 'A', 'B'].map(value => matches(included, { 字段: value }))).toEqual(include);
    expect([null, 'A', 'B'].map(value => matches(excluded, { 字段: value }))).toEqual(exclude);
    expect(sql(input, included).params).toEqual(selected.filter(value => value !== null));
    expect(sql(input, excluded).params).toEqual(selected.filter(value => value !== null));
    if (selected.some(value => value !== null)) expect(included.filters[0].operator).toBe('IN');
    if (!selected.includes(null)) { expect(excluded.filters.map(rule => rule.operator)).toEqual(['NOT IN', 'IS NULL']); expect(excluded.filterMode).toBe('any'); }
    if (selected.length === 1 && selected[0] === null) expect(excluded.filters).toEqual([{ column: '字段', operator: 'IS NOT NULL' }]);
  });
  it('精确字符串、空串、NULL文本及空白原样保留；按页面顺序去重而非Set顺序', () => {
    const input = fixture(['18446744073709551615', '0.123456789012345678901234567890', '', 'NULL', "  引号'\\%_\n🚢  ", '18446744073709551615', null, null]);
    const result = buildTableSelectedFilter(input);
    expect(result.rowCount).toBe(8); expect(result.values).toEqual(['18446744073709551615', '0.123456789012345678901234567890', '', 'NULL', "  引号'\\%_\n🚢  "]); expect(result.includesNull).toBe(true);
    const generated = sql(input, result); expect(generated.params).toEqual(result.values); expect(generated.where).not.toContain('18446744073709551615'); expect(generated.where).toContain('IS NULL'); expect(generated.where).toContain(' OR ');
  });
  it('布尔和安全有限数沿手工条件字符串语义，不把其它列改动当选中格改动', () => {
    const input = fixture([true, false, 1, '1', 1.25, Number.MAX_SAFE_INTEGER]);
    input.rows[0].data['其它'] = '未选字段的草稿';
    expect(buildTableSelectedFilter(input).values).toEqual(['1', '0', '1.25', String(Number.MAX_SAFE_INTEGER)]);
  });
  it('真实原型同名与反引号列只作参数化标识符，不读取原行的继承值', () => {
    const input = fixture(['a', 'b'], '__proto__'), result = buildTableSelectedFilter(input);
    expect(result.column).toBe('__proto__'); expect(result.values).toEqual(['a', 'b']); expect(sql(input, result).where).toContain('`__proto__` IN (?, ?)');
    const quoted = fixture(['x'], '列`名'); expect(sql(quoted, buildTableSelectedFilter(quoted)).where).toContain('`列``名` IN (?)');
  });
  it('二进制列的NULL可判断，但不把实际binary对象转文本', () => {
    const input = fixture([null]); input.columns[0].type = 'blob';
    expect(buildTableSelectedFilter(input).filters).toEqual([{ column: '字段', operator: 'IS NULL' }]);
    expect(() => buildTableSelectedFilter(fixture([{ type: 'binary', base64: 'AP8=' }]))).toThrow('重新选择');
  });
  it.each([undefined, {}, [], { type: 'binary', base64: 'AP8=' }, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1].map(value => ({ value })))('原值%j无法无损筛选时拒绝整份，不跳过它继续', ({ value }) => {
    expect(() => buildTableSelectedFilter(fixture(['合法', value, '后续']))).toThrow('重新选择');
  });
  it('所有选中身份必须完整存在，页面重复ID、已删除/新增、当前格已改或无原值均拒绝', () => {
    const missing = fixture(['a']); missing.selected = new Set(['row-0', 'missing']); expect(() => buildTableSelectedFilter(missing)).toThrow('重新选择');
    const duplicate = fixture(['a', 'b']); duplicate.rows[1].id = duplicate.rows[0].id; expect(() => buildTableSelectedFilter(duplicate)).toThrow('重新选择');
    for (const change of ['inserted', 'deleted', 'changed', 'noOriginal', 'missingCurrent', 'missingOriginal'] as const) {
      const input = fixture(['a', 'b']); const row = input.rows[1];
      if (change === 'inserted' || change === 'deleted') row[change] = true;
      else if (change === 'changed') row.data['字段'] = '修改';
      else if (change === 'noOriginal') delete row.original;
      else if (change === 'missingCurrent') delete row.data['字段'];
      else delete row.original!['字段'];
      expect(() => buildTableSelectedFilter(input)).toThrow('重新选择');
    }
  });
  it('隐藏/未知/重复列、空选择或失效当前格不能生成无界或不同列的提案', () => {
    for (const mutate of [(input: TableSelectedFilterInput) => { input.visible = []; }, (input: TableSelectedFilterInput) => { input.selection = undefined; }, (input: TableSelectedFilterInput) => { input.selection = { rowId: 'missing', key: '字段' }; }, (input: TableSelectedFilterInput) => { input.selection = { rowId: 'row-0', key: '未知' }; }, (input: TableSelectedFilterInput) => { input.selected = new Set(); }, (input: TableSelectedFilterInput) => { input.columns = [...input.columns, input.columns[0]]; }]) {
      const input = fixture(['a']); mutate(input); expect(() => buildTableSelectedFilter(input)).toThrow('重新选择');
    }
    const inherited = fixture(['a']); inherited.rows[0].original = Object.create({ 字段: 'a' }); expect(() => buildTableSelectedFilter(inherited)).toThrow('重新选择');
  });
  it('行、元数据、活动格及原值访问器均不调用；输入数组自定义迭代器也不执行', () => {
    let reads = 0;
    for (const target of ['row', 'column', 'selection', 'current', 'original', 'array'] as const) {
      const input = fixture(['a']);
      const object = target === 'row' ? input.rows[0] : target === 'column' ? input.columns[0] : target === 'selection' ? input.selection! : target === 'current' ? input.rows[0].data : target === 'original' ? input.rows[0].original! : input.rows;
      const key = target === 'row' ? 'id' : target === 'column' ? 'name' : target === 'selection' ? 'key' : target === 'array' ? '0' : '字段';
      Object.defineProperty(object, key, { get() { reads++; throw Error('不应读取访问器'); }, configurable: true });
      expect(() => buildTableSelectedFilter(input)).toThrow('重新选择');
    }
    const input = fixture(['a']); Object.defineProperty(input.rows, Symbol.iterator, { value() { reads++; throw Error('不应执行迭代器'); } });
    expect(() => buildTableSelectedFilter(input)).toThrow('重新选择'); expect(reads).toBe(0);
    const set = new Set(['row-0']); Object.defineProperty(set, 'size', { get() { reads++; throw Error('不应读取size'); } }); Object.defineProperty(set, Symbol.iterator, { value() { reads++; throw Error('不应执行Set迭代器'); } });
    const safe = fixture(['a']); safe.selected = set; expect(buildTableSelectedFilter(safe).values).toEqual(['a']); expect(reads).toBe(0);
  });
});

describe('旧完整筛选表达式与勾选范围相交', () => {
  it('旧any完整包入AND，保留停用条件与参数遍历顺序，不能让一支绕开新集合', () => {
    const input = fixture(['A']); input.conditions = { filters: [{ column: '旧条件', operator: '=', value: '左' }, { column: '旧条件', operator: '=', value: '右' }, { column: '旧条件', operator: '=', value: '禁用', enabled: false }], filterMode: 'any' };
    const result = buildTableSelectedFilter(input);
    expect(result.filterGroup).toEqual({ mode: 'all', children: [{ mode: 'any', children: [0, 1, 2] }, 3] });
    expect(sql(input, result).params).toEqual(['左', '右', 'A']);
    expect(matches(result, { 字段: 'A', 旧条件: '左' })).toBe(true); expect(matches(result, { 字段: 'B', 旧条件: '左' })).toBe(false); expect(matches(result, { 字段: 'A', 旧条件: '其它' })).toBe(false);
    expect(result.filters[2]).toEqual(input.conditions.filters[2]);
  });
  it('旧nested分组和启停原样保留，旧all根不额外加深或改变成员相交关系', () => {
    const input = fixture([null, 'A']); input.conditions = { filters: [{ column: '旧条件', operator: '=', value: '左' }, { column: '旧条件', operator: '=', value: '右', enabled: false }], filterMode: 'all', filterGroup: { mode: 'all', children: [{ mode: 'any', children: [0, 1] }] } };
    const result = buildTableSelectedFilter(input);
    expect(result.filterGroup).toEqual({ mode: 'all', children: [{ mode: 'any', children: [0, 1] }, { mode: 'any', children: [2, 3] }] });
    expect(sql(input, result).params).toEqual(['左', 'A']); expect(matches(result, { 字段: null, 旧条件: '左' })).toBe(true); expect(matches(result, { 字段: 'B', 旧条件: '左' })).toBe(false);
  });
  it('提案条件、值与全部树深冻结且不共享源可变数组，源保持可编辑', () => {
    const input = fixture(['A']); const values = ['原值']; input.conditions = { filters: [{ column: '旧条件', operator: 'IN', values }], filterMode: 'all', filterGroup: { mode: 'all', children: [0] } };
    const result = buildTableSelectedFilter(input);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.values)).toBe(true); expect(Object.isFrozen(result.filters)).toBe(true); expect(result.filters.every(rule => Object.isFrozen(rule) && (!rule.values || Object.isFrozen(rule.values)))).toBe(true);
    expect(Object.isFrozen(result.filterGroup)).toBe(true); expect(Object.isFrozen(result.filterGroup.children)).toBe(true);
    expect(result.filters[0]).not.toBe(input.conditions.filters[0]); expect(result.filters[0].values).not.toBe(values); expect(result.filterGroup).not.toBe(input.conditions.filterGroup);
    values[0] = '外部修改'; input.rows[0].data['字段'] = '外部修改'; expect(result.filters[0].values).toEqual(['原值']); expect(result.values).toEqual(['A']); expect(Object.isFrozen(input.rows)).toBe(false);
  });
  it('旧条件未知列、错树、访问器和超限停用条件仍拒绝，不能以新成员覆盖旧错误', () => {
    const unknown = fixture(['A']); unknown.conditions = { filters: [{ column: '未知', operator: '=', value: 'x', enabled: false }], filterMode: 'all' }; expect(() => buildTableSelectedFilter(unknown)).toThrow('重新选择');
    const missing = fixture(['A']); missing.conditions = { filters: [{ column: '旧条件', operator: '=', value: 'x', enabled: false }], filterMode: 'all', filterGroup: { mode: 'all', children: [] } }; expect(() => buildTableSelectedFilter(missing)).toThrow('重新选择');
    const disabled = fixture(['A']); disabled.conditions = { filters: [{ column: '旧条件', operator: '=', value: 'x'.repeat(4097), enabled: false }], filterMode: 'all' }; expect(() => buildTableSelectedFilter(disabled)).toThrow('超过原筛选预算');
    let reads = 0; const accessor = fixture(['A']); Object.defineProperty(accessor.conditions, 'filterGroup', { get() { reads++; throw Error('不应读取'); } }); expect(() => buildTableSelectedFilter(accessor)).toThrow('重新选择'); expect(reads).toBe(0);
  });
});

describe('勾选值与原筛选全部共享预算', () => {
  it('1000勾选原行可去重为一个值，1001页行或201个不同非NULL值整份拒绝', () => {
    expect(buildTableSelectedFilter(fixture(Array(1000).fill('相同')))).toMatchObject({ rowCount: 1000, values: ['相同'] });
    expect(() => buildTableSelectedFilter(fixture(Array(1001).fill('相同')))).toThrow('超过原筛选预算');
    expect(buildTableSelectedFilter(fixture(Array.from({ length: 200 }, (_, index) => String(index)))).values).toHaveLength(200);
    expect(() => buildTableSelectedFilter(fixture(Array.from({ length: 201 }, (_, index) => String(index))))).toThrow('超过原筛选预算');
    expect(buildTableSelectedFilter(fixture(['x'.repeat(4096)])).values[0]).toHaveLength(4096); expect(() => buildTableSelectedFilter(fixture(['x'.repeat(4097)]))).toThrow('超过原筛选预算');
  });
  it('30个条件包含NULL补集叶，原停用条件也占完整条件预算', () => {
    const input = fixture(['A']); input.conditions.filters = Array.from({ length: 29 }, () => ({ column: '旧条件', operator: '=' as const, value: 'x', enabled: false }));
    expect(buildTableSelectedFilter(input).filters).toHaveLength(30);
    expect(() => buildTableSelectedFilter({ ...input, exclude: true })).toThrow('超过原筛选预算');
  });
  it('全部1000参数和1M字符同时核旧条件，即使已停用也不可超预算', () => {
    const count = fixture(['A']); count.conditions.filters = Array.from({ length: 5 }, () => ({ column: '旧条件', operator: 'IN' as const, values: Array(200).fill('x'), enabled: false })); expect(() => buildTableSelectedFilter(count)).toThrow('超过原筛选预算');
    const exact = fixture(['x'.repeat(576)]); exact.conditions.filters = [200, 44].map(length => ({ column: '旧条件', operator: 'IN' as const, values: Array(length).fill('x'.repeat(4096)), enabled: false }));
    expect(buildTableSelectedFilter(exact).values[0]).toHaveLength(576);
    const over = fixture(['x'.repeat(577)]); over.conditions = exact.conditions; expect(() => buildTableSelectedFilter(over)).toThrow('超过原筛选预算');
  });
  it('16组边界不因旧all新增单叶而加组；必须增加新OR组时明确拒绝', () => {
    const input = fixture(['A']); input.conditions = { filters: Array.from({ length: 15 }, () => ({ column: '旧条件', operator: '=', value: 'x' })), filterMode: 'all', filterGroup: { mode: 'all', children: Array.from({ length: 15 }, (_, index) => ({ mode: 'any' as const, children: [index] })) } };
    expect(buildTableSelectedFilter(input).filterGroup.children).toHaveLength(16);
    expect(() => buildTableSelectedFilter({ ...input, exclude: true })).toThrow('超过原筛选预算');
  });
  it('8层旧AND根可原层追加，旧OR整体相交会超过8层时拒绝而非压扁语义', () => {
    let tree: FilterGroup = { mode: 'all', children: [0] }; for (let index = 1; index < FILTER_LIMITS.depth; index++) tree = { mode: 'all', children: [tree] };
    const input = fixture(['A']); input.conditions = { filters: [{ column: '旧条件', operator: '=', value: 'x' }], filterMode: 'all', filterGroup: tree };
    expect(buildTableSelectedFilter(input).filterGroup.children).toHaveLength(2);
    input.conditions = { ...input.conditions, filterMode: 'any', filterGroup: { ...tree, mode: 'any' } }; expect(() => buildTableSelectedFilter(input)).toThrow('超过原筛选预算');
  });
});
