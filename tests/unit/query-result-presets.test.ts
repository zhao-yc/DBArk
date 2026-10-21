import { describe, expect, it } from 'vitest';
import {
  queryResultPresetDocumentSchema, queryResultPresetLimits, queryResultPresetListSchema,
  queryResultPresetRenameSchema, queryResultPresetSaveSchema, queryResultPresetSelectSchema,
  queryResultPresetSnapshotSchema, queryResultPresetSourceSchema, queryResultPresetStoredSnapshotSchema,
  queryResultPresetValueSchema, validateQueryResultPresetBudget,
  type QueryResultFilterGroup, type QueryResultFilterRule, type QueryResultPresetValue
} from '../../src/shared/queryResultPresets';

const id = '11111111-1111-4111-8111-111111111111', secondId = '22222222-2222-4222-8222-222222222222';
const digest = 'a'.repeat(64), source = { connectionRevision: 2, connectionDigest: digest };
const checked = { connectionId: '历史连接/ram-a', expectedRevision: 3, source, bindingToken: id };
/** 覆盖精确原文、嵌套停用、成员和空串，不能退化成平铺条件或SQL分隔文本。 */
function fixture(): QueryResultPresetValue {
  const columns = [{ key: 'id', name: '重名', type: 'BIGINT' }, { key: '__proto__', name: '重名', type: 'TEXT' }];
  return { columns, visible: columns.map(column => ({ ...column })), configuration: {
    expression: { mode: 'OR', children: [
      { column: 'id', operator: 'between', value: '9007199254740993', upper: '99999999999999999999', enabled: true },
      { mode: 'AND', children: [
        { column: '__proto__', operator: 'in', value: '', values: ['', '  ', 'NULL', '带,逗号\n和"引号', '😀'], ignoreCase: true },
        { column: 'id', operator: 'eq', value: '停用时尚未编辑完的数字原文', enabled: false }
      ] }
    ] },
    sort: [{ column: '__proto__', direction: 'DESC', nulls: 'FIRST', ignoreCase: true }, { column: 'id', direction: 'ASC', nulls: 'LAST', ignoreCase: false }]
  } };
}
/** 创建新对象，避免测试之间共享待验证的数组及嵌套条件。 */
function entry() { return { id, name: '命名方案', connectionDigest: digest, value: fixture() }; }
/** 用独立根表达式检验单条条件，Main只校验结构，不承担正式比较器职责。 */
function withRule(rule: QueryResultFilterRule): QueryResultPresetValue { const value = fixture(); return { ...value, configuration: { expression: { mode: 'AND', children: [rule] }, sort: [] } }; }

describe('查询结果命名方案共享合同', () => {
  it('完整保留原文/分组/停用/NULL排序/大小写，输出为独立规范副本', () => {
    const input = fixture(), saved = queryResultPresetValueSchema.parse(input);
    expect(saved).toEqual(input); expect(saved).not.toBe(input);
    expect(saved.columns).not.toBe(input.columns); expect(saved.configuration.expression.children).not.toBe(input.configuration.expression.children);
    const group = input.configuration.expression.children[1] as QueryResultFilterGroup;
    (group.children[1] as QueryResultFilterRule).value = '后来修改';
    expect(((saved.configuration.expression.children[1] as QueryResultFilterGroup).children[1] as QueryResultFilterRule).value).toBe('停用时尚未编辑完的数字原文');
    expect(Object.keys(saved).sort()).toEqual(['columns', 'configuration', 'visible']);
  });

  it('接受冻结只读数组和显式undefined缺省，不丢失启停字段', () => {
    const value = withRule({ column: 'id', operator: 'eq', value: '未解析数字', enabled: false, values: undefined, upper: undefined, ignoreCase: undefined });
    Object.freeze(value.columns); Object.freeze(value.visible); Object.freeze(value.configuration.expression.children);
    const parsed = queryResultPresetValueSchema.parse(value), rule = parsed.configuration.expression.children[0];
    expect(rule).toEqual({ column: 'id', operator: 'eq', value: '未解析数字', enabled: false });
    expect(Object.hasOwn(rule, 'enabled')).toBe(true); expect(Object.hasOwn(rule, 'values')).toBe(false);
  });

  it.each(['contains', 'notContains', 'startsWith', 'notStartsWith', 'endsWith', 'notEndsWith', 'like', 'notLike', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const)('完整保留%s操作符的字面输入', operator => {
    const value = withRule({ column: '__proto__', operator, value: '  %_\\精确原文😀  ', ignoreCase: true, enabled: false });
    expect(queryResultPresetValueSchema.parse(value)).toEqual(value);
  });
  it.each(['empty', 'notEmpty', 'null', 'notNull'] as const)('完整支持%s空值结构', operator => {
    expect(queryResultPresetValueSchema.safeParse(withRule({ column: '__proto__', operator, value: '', enabled: false })).success).toBe(true);
    expect(queryResultPresetValueSchema.safeParse(withRule({ column: '__proto__', operator, value: '隐藏原值' })).success).toBe(false);
  });
  it.each(['in', 'notIn'] as const)('完整支持%s成员边界，保留逗号/换行/NULL字样', operator => {
    const value = withRule({ column: '__proto__', operator, value: '', values: ['', 'NULL', 'a,b\nc', '9'.repeat(4096)], enabled: false });
    expect(queryResultPresetValueSchema.parse(value)).toEqual(value);
    expect(queryResultPresetValueSchema.safeParse(withRule({ column: '__proto__', operator, value: '', values: [] })).success).toBe(false);
    expect(queryResultPresetValueSchema.safeParse(withRule({ column: '__proto__', operator, value: '', values: Array(129).fill('') })).success).toBe(false);
  });
  it.each(['between', 'notBetween'] as const)('保留%s上下限原文，不由Main强转数字日期或交换端点', operator => {
    const value = withRule({ column: 'id', operator, value: '待补完下限', upper: '另一原文', enabled: false });
    expect(queryResultPresetValueSchema.parse(value)).toEqual(value);
    expect(queryResultPresetValueSchema.safeParse(withRule({ column: 'id', operator, value: '1' })).success).toBe(false);
  });

  it('可见列按完整元数据核对子集，保留用户列顺序及重名显示列', () => {
    const value = fixture();
    expect(queryResultPresetValueSchema.safeParse({ ...value, visible: [...value.visible].reverse() }).success).toBe(true);
    for (const field of ['key', 'name', 'type'] as const) {
      const visible = value.visible.map(column => ({ ...column })); visible[0][field] += '变更';
      expect(queryResultPresetValueSchema.safeParse({ ...value, visible }).success).toBe(false);
    }
    expect(queryResultPresetValueSchema.safeParse({ ...value, columns: [...value.columns, value.columns[0]] }).success).toBe(false);
    expect(queryResultPresetValueSchema.safeParse({ ...value, visible: [value.visible[0], value.visible[0]] }).success).toBe(false);
    expect(queryResultPresetValueSchema.safeParse({ ...value, visible: [] }).success).toBe(false);
  });

  it('条件和排序均只能引用可见字段，重复排序或方向/NULL选项无效整份拒绝', () => {
    const value = fixture();
    expect(queryResultPresetValueSchema.safeParse({ ...value, visible: [value.columns[0]] }).success).toBe(false);
    for (const sort of [[{ column: 'missing', direction: 'ASC' }], [{ column: 'id', direction: 'asc' }], [{ column: 'id', direction: 'ASC', nulls: 'AUTO' }], [{ column: 'id', direction: 'ASC', ignoreCase: 'true' }], [value.configuration.sort[0], value.configuration.sort[0]]]) {
      expect(queryResultPresetValueSchema.safeParse({ ...value, configuration: { ...value.configuration, sort } }).success).toBe(false);
    }
  });

  it.each(['rows', 'sql', 'path', 'statement', '__proto__', 'constructor'] as const)('拒绝额外%s字段，不默默剥除后存储', field => {
    const value = fixture();
    const extra = { [field]: '禁止保存' };
    expect(queryResultPresetValueSchema.safeParse({ ...value, ...extra }).success).toBe(false);
    expect(queryResultPresetValueSchema.safeParse({ ...value, configuration: { ...value.configuration, ...extra } }).success).toBe(false);
    expect(queryResultPresetValueSchema.safeParse({ ...value, columns: [{ ...value.columns[0], ...extra }] }).success).toBe(false);
    expect(queryResultPresetValueSchema.safeParse(withRule({ column: 'id', operator: 'eq', value: '1', ...extra })).success).toBe(false);
  });

  it('访问器从入口到叶和数组均不执行，拒绝继承字段和非普通原型', () => {
    let reads = 0;
    const getter = { enumerable: true, get: () => { reads++; throw Error('不应执行'); } };
    const value = fixture(), columns = [...value.columns]; Object.defineProperty(columns, '0', getter);
    const leaf = { column: 'id', operator: 'eq', value: '1' }; Object.defineProperty(leaf, 'value', getter);
    const objects = [Object.defineProperty({ ...value }, 'columns', getter), { ...value, columns }, { ...value, configuration: { expression: { mode: 'AND', children: [leaf] }, sort: [] } }, Object.assign(Object.create({ columns: value.columns }), { visible: value.visible, configuration: value.configuration })];
    for (const object of objects) expect(queryResultPresetValueSchema.safeParse(object).success).toBe(false);
    expect(queryResultPresetListSchema.safeParse(Object.defineProperty({}, 'connectionId', getter)).success).toBe(false);
    expect(queryResultPresetDocumentSchema.safeParse(Object.defineProperty({ version: 1, revision: 0 }, 'entries', getter)).success).toBe(false);
    expect(reads).toBe(0);
  });

  it('拒绝循环、超深、空子组和稀疏数组，不产生无限递归', () => {
    const value = fixture(), cycle: { mode: 'AND'; children: unknown[] } = { mode: 'AND', children: [] }; cycle.children.push(cycle);
    let nested: QueryResultFilterGroup = { mode: 'AND', children: [{ column: 'id', operator: 'eq', value: '1' }] };
    for (let index = 0; index < 8; index++) nested = { mode: 'OR', children: [nested] };
    for (const expression of [cycle, nested, { mode: 'AND', children: [{ mode: 'OR', children: [] }] }, { mode: 'AND', children: new Array(1) }]) {
      expect(queryResultPresetValueSchema.safeParse({ ...value, configuration: { expression, sort: [] } }).success).toBe(false);
    }
    expect(queryResultPresetValueSchema.safeParse({ ...value, visible: new Array(1) }).success).toBe(false);
    expect(queryResultPresetValueSchema.safeParse(withRule({ column: 'id', operator: 'in', value: '', values: new Array(1) })).success).toBe(false);
  });

  it('完整结构预算：32条件、16组、8层、128成员以及1024列均为硬上限', () => {
    const value = fixture(), leaf: QueryResultFilterRule = { column: 'id', operator: 'eq', value: '1', enabled: false };
    const valid = { ...value, configuration: { expression: { mode: 'AND', children: Array(32).fill(leaf) }, sort: [] } };
    expect(queryResultPresetValueSchema.safeParse(valid).success).toBe(true);
    expect(queryResultPresetValueSchema.safeParse({ ...valid, configuration: { ...valid.configuration, expression: { mode: 'AND', children: Array(33).fill(leaf) } } }).success).toBe(false);
    const group: QueryResultFilterGroup = { mode: 'AND', children: [leaf] };
    expect(queryResultPresetValueSchema.safeParse({ ...value, configuration: { expression: { mode: 'AND', children: Array(15).fill(group) }, sort: [] } }).success).toBe(true);
    expect(queryResultPresetValueSchema.safeParse({ ...value, configuration: { expression: { mode: 'AND', children: Array(16).fill(group) }, sort: [] } }).success).toBe(false);
    const columns = Array.from({ length: 1024 }, (_, index) => ({ key: String(index), name: '', type: '' }));
    const plain = { columns, visible: [columns[0]], configuration: { expression: { mode: 'AND', children: [] }, sort: [] } };
    expect(queryResultPresetValueSchema.safeParse(plain).success).toBe(true);
    expect(queryResultPresetValueSchema.safeParse({ ...plain, columns: [...columns, { key: '1025', name: '', type: '' }] }).success).toBe(false);
  });

  it('字段长度及完整JSON单位预算包含元数据/转义/停用值，超额整份拒绝', () => {
    const base = fixture();
    for (const column of [{ key: '', name: '', type: '' }, { key: 'x'.repeat(4097), name: '', type: '' }, { key: 'x', name: 'x'.repeat(4097), type: '' }, { key: 'x', name: '', type: 'x'.repeat(257) }]) {
      expect(queryResultPresetValueSchema.safeParse({ ...base, columns: [column], visible: [column] }).success).toBe(false);
    }
    expect(queryResultPresetValueSchema.safeParse(withRule({ column: 'id', operator: 'eq', value: 'x'.repeat(4097), enabled: false })).success).toBe(false);
    const columns = Array.from({ length: 20 }, (_, index) => ({ key: String(index), name: '字'.repeat(4096), type: 'TEXT' }));
    expect(queryResultPresetValueSchema.safeParse({ columns, visible: columns, configuration: { expression: { mode: 'AND', children: [] }, sort: [] } }).success).toBe(false);
    const rules = Array.from({ length: 32 }, () => ({ column: 'id', operator: 'eq', value: '\u0000'.repeat(1000), enabled: false }));
    expect(queryResultPresetValueSchema.safeParse({ ...base, configuration: { expression: { mode: 'AND', children: rules }, sort: [] } }).success).toBe(false);
  });

  it('文档/来源/快照严格校验版本、CAS、摘要及重复名称编号', () => {
    const document = { version: 1, revision: 3, entries: [entry()] };
    expect(queryResultPresetDocumentSchema.parse(document)).toEqual(document);
    expect(queryResultPresetStoredSnapshotSchema.safeParse({ ...document, source }).success).toBe(true);
    expect(queryResultPresetSnapshotSchema.safeParse({ ...document, source, bindingToken: id }).success).toBe(true);
    for (const change of [{ version: 2 }, { revision: Number.MAX_SAFE_INTEGER }, { revision: -1 }, { rows: [] }, { entries: [entry(), { ...entry(), id: secondId, name: ' 命名方案 ' }] }, { entries: [entry(), { ...entry(), name: '另一名称' }] }, { entries: Array(101).fill(entry()) }]) {
      expect(queryResultPresetDocumentSchema.safeParse({ ...document, ...change }).success).toBe(false);
    }
    expect(queryResultPresetSourceSchema.safeParse({ ...source, connectionDigest: 'A'.repeat(64) }).success).toBe(false);
    expect(queryResultPresetSourceSchema.safeParse({ ...source, sql: '' }).success).toBe(false);
    expect(queryResultPresetSnapshotSchema.safeParse({ ...document, source, bindingToken: '非UUID' }).success).toBe(false);
    expect(queryResultPresetDocumentSchema.safeParse({ ...document, entries: [{ ...entry(), path: '/不可保存' }] }).success).toBe(false);
  });

  it('CRUD输入保持原连接ID兼容；名称trim、长度、控制符及额外字段完整校验', () => {
    expect(queryResultPresetListSchema.parse({ connectionId: 'ram-a' })).toEqual({ connectionId: 'ram-a' });
    const saved = { ...checked, name: '  精确方案  ', value: fixture() };
    expect(queryResultPresetSaveSchema.parse(saved).name).toBe('精确方案');
    expect(queryResultPresetSaveSchema.safeParse({ ...saved, replaceId: secondId }).success).toBe(true);
    expect(queryResultPresetSelectSchema.safeParse({ ...checked, id }).success).toBe(true);
    expect(queryResultPresetRenameSchema.parse({ ...checked, id, name: ' 新名 ' }).name).toBe('新名');
    for (const name of ['', '   ', 'x'.repeat(81), '名称\n换行', '名称\u0085控制符']) expect(queryResultPresetSaveSchema.safeParse({ ...saved, name }).success).toBe(false);
    for (const extra of [{ sql: 'SELECT 1' }, { rows: [] }, { path: 'C:/文件' }, { taskId: id }]) {
      expect(queryResultPresetSaveSchema.safeParse({ ...saved, ...extra }).success).toBe(false);
      expect(queryResultPresetListSchema.safeParse({ connectionId: 'ram-a', ...extra }).success).toBe(false);
      expect(queryResultPresetSelectSchema.safeParse({ ...checked, id, ...extra }).success).toBe(false);
      expect(queryResultPresetRenameSchema.safeParse({ ...checked, id, name: '新名', ...extra }).success).toBe(false);
    }
    for (const change of [{ expectedRevision: Number.MAX_SAFE_INTEGER }, { bindingToken: '非UUID' }, { connectionId: '' }, { replaceId: '非UUID' }, { source: { ...source, connectionRevision: 1.5 } }]) expect(queryResultPresetSaveSchema.safeParse({ ...saved, ...change }).success).toBe(false);
  });

  it('全库连接/条数/字节预算只接受非负安全整数并保留原上限', () => {
    expect(queryResultPresetLimits).toMatchObject({ perConnection: 100, connections: 500, entries: 1000, entryBytes: 512 * 1024, totalBytes: 8 * 1024 * 1024, valueUnits: 128 * 1024 });
    expect(() => validateQueryResultPresetBudget(500, 1000, 8 * 1024 * 1024)).not.toThrow();
    for (const values of [[501, 1, 1], [1, 1001, 1], [1, 1, 8 * 1024 * 1024 + 1], [-1, 0, 0], [1, 0.5, 0], [1, 1, Infinity], [NaN, 0, 0]]) expect(() => validateQueryResultPresetBudget(values[0], values[1], values[2])).toThrow();
  });
});
