import { describe, expect, it, vi } from 'vitest';
import { planSavedQueryGroups, savedQueryGroupIds, savedQueryGroupNameSchema, savedQueryGroupScopeSchema, savedQueryOrganizationApplySchema, savedQueryOrganizationGetSchema, savedQueryOrganizationOperationSchema, summarizeSavedQueryOrganization, validateSavedQueryGroups, type SavedQueryGroup } from '../../src/shared/savedQueryOrganization';
import { savedQueryPageInputSchema, savedQueryPageNextSchema } from '../../src/shared/savedQueryPages';

const digest = 'a'.repeat(64), revision = 'b'.repeat(64);
const tree = (): SavedQueryGroup[] => [
  { id: 'root', name: '日常开发', parentId: null },
  { id: 'child', name: '报表', parentId: 'root' },
  { id: 'leaf', name: '月报', parentId: 'child' },
  { id: 'other', name: '其它', parentId: null },
];
/** 根层计为第一层，构造有身份的真实父链而非数组位次。 */
function chain(length: number): SavedQueryGroup[] { return Array.from({ length }, (_, index) => ({ id: String(index), name: '分组' + index, parentId: index ? String(index - 1) : null })); }

describe('保存查询分组严格合同', () => {
  it('空获取和五种操作均仅接纳精确字段，版本为小写64hex', () => {
    expect(savedQueryOrganizationGetSchema.parse({})).toEqual({});
    const operations = [{ kind: 'create', name: '新组', parentId: null }, { kind: 'rename', id: 'root', name: '改名' }, { kind: 'moveGroup', id: 'child', parentId: null }, { kind: 'dissolve', id: 'root' }, { kind: 'moveQueries', queries: [{ id: 'q', digest }], groupId: 'root' }];
    for (const operation of operations) expect(savedQueryOrganizationApplySchema.parse({ expectedRevision: revision, operation })).toEqual({ expectedRevision: revision, operation });
    for (const value of [null, [], { taskId: 'q' }, { sql: 'SELECT 1' }]) expect(() => savedQueryOrganizationGetSchema.parse(value)).toThrow();
    for (const expectedRevision of ['', 'a'.repeat(63), 'A'.repeat(64), null, 1]) expect(() => savedQueryOrganizationApplySchema.parse({ expectedRevision, operation: operations[0] })).toThrow();
    for (const operation of operations) expect(() => savedQueryOrganizationOperationSchema.parse({ ...operation, sql: 'SELECT 1' })).toThrow();
  });
  it.each(['', ' 前空格', '后空格 ', '\t组', '组\n', 'a/b', 'a\\b', '组\u007f', '组\u0085', '\ud800', '\udc00', 'a'.repeat(81)])('拒绝非法名称 %j', name => { expect(() => savedQueryGroupNameSchema.parse(name)).toThrow(); });
  it('80个UTF16单位边界与合法Unicode保持原样，名称不静默合并', () => {
    for (const name of ['😀'.repeat(40), '中'.repeat(80), 'e\u0301', 'é', '__proto__', '组 内 空 格']) expect(savedQueryGroupNameSchema.parse(name)).toBe(name);
    expect(() => savedQueryGroupNameSchema.parse('😀'.repeat(41))).toThrow();
    expect(validateSavedQueryGroups([{ id: '1', name: 'é', parentId: null }, { id: '2', name: 'e\u0301', parentId: null }, { id: '3', name: 'ABC', parentId: null }, { id: '4', name: 'abc', parentId: null }])).toHaveLength(4);
  });
  it('id沿既有1到200边界，摘要严格且批选编号唯一', () => {
    const op = { kind: 'moveQueries', queries: [{ id: 'q'.repeat(200), digest }], groupId: null };
    expect(savedQueryOrganizationOperationSchema.parse(op)).toEqual(op);
    for (const queries of [[], [{ id: '', digest }], [{ id: 'q'.repeat(201), digest }], [{ id: 'q', digest: 'A'.repeat(64) }], [{ id: 'q', digest }, { id: 'q', digest }], Array.from({ length: 101 }, (_, index) => ({ id: String(index), digest }))]) expect(() => savedQueryOrganizationOperationSchema.parse({ ...op, queries })).toThrow();
    expect(savedQueryOrganizationOperationSchema.parse({ ...op, queries: Array.from({ length: 100 }, (_, index) => ({ id: String(index), digest })) })).toHaveProperty('queries.length', 100);
  });
  it('拒绝访问器、符号、额外隐藏字段及原型字段，且不执行getter', () => {
    const getter = vi.fn(() => 'create');
    const value = Object.defineProperty({ name: '组', parentId: null }, 'kind', { get: getter, enumerable: true });
    expect(() => savedQueryOrganizationOperationSchema.parse(value)).toThrow(); expect(getter).not.toHaveBeenCalled();
    expect(() => savedQueryOrganizationGetSchema.parse(Object.defineProperty({}, 'hidden', { value: 1 }))).toThrow();
    expect(() => savedQueryOrganizationGetSchema.parse({ [Symbol('extra')]: 1 })).toThrow();
    expect(() => savedQueryOrganizationOperationSchema.parse(Object.create({ kind: 'dissolve', id: 'root' }))).toThrow();
    expect(savedQueryOrganizationOperationSchema.parse(Object.assign(Object.create(null), { kind: 'dissolve', id: '__proto__' }))).toEqual({ kind: 'dissolve', id: '__proto__' });
  });
  it('拒绝循环、稀疏和额外数组属性，不能借数组索引或toJSON绕过', () => {
    const sparse = new Array(1), extra = [{ id: 'q', digest }]; Object.defineProperty(extra, 'secret', { value: 1, enumerable: true });
    const cyclic: Record<string, unknown> = { kind: 'create', name: '组', parentId: null }; cyclic.parentId = cyclic;
    for (const queries of [sparse, extra]) expect(() => savedQueryOrganizationOperationSchema.parse({ kind: 'moveQueries', queries, groupId: null })).toThrow();
    expect(() => savedQueryOrganizationOperationSchema.parse(cyclic)).toThrow();
    const toJSON = vi.fn(() => ({})); expect(() => savedQueryOrganizationGetSchema.parse({ toJSON })).toThrow(); expect(toJSON).not.toHaveBeenCalled();
  });
});

describe('保存查询真实层级树规划', () => {
  it('空树和逆序树有效，输入及返回值不共享可写对象', () => {
    expect(validateSavedQueryGroups([])).toEqual([]);
    const original = tree().reverse(), result = validateSavedQueryGroups(original); expect(result).toEqual(original); result[0].name = '新名称'; expect(original[0].name).toBe('其它');
  });
  it('支持256组与8层，拒绝溢出、重复编号、孤儿和环', () => {
    expect(validateSavedQueryGroups(chain(8))).toHaveLength(8);
    expect(validateSavedQueryGroups(Array.from({ length: 256 }, (_, index) => ({ id: String(index), name: '组' + index, parentId: null })))).toHaveLength(256);
    for (const groups of [chain(9), Array.from({ length: 257 }, (_, index) => ({ id: String(index), name: '组' + index, parentId: null })), [...tree(), tree()[0]], [{ id: 'orphan', name: '孤儿', parentId: 'absent' }], [{ id: 'self', name: '自环', parentId: 'self' }], [{ id: '1', name: '一', parentId: '2' }, { id: '2', name: '二', parentId: '1' }]]) expect(() => validateSavedQueryGroups(groups)).toThrow();
  });
  it('同父精确重名拒绝，不同父同名允许', () => {
    expect(() => validateSavedQueryGroups([...tree(), { id: 'duplicate', name: '报表', parentId: 'root' }])).toThrow('同名');
    expect(validateSavedQueryGroups([...tree(), { id: 'different', name: '报表', parentId: 'other' }])).toHaveLength(5);
  });
  it('创建编号由主进程传入，只新增目标组且不改原树', () => {
    const original = tree(), result = planSavedQueryGroups(original, { kind: 'create', name: '年度', parentId: 'child' }, 'new');
    expect(result.groups.at(-1)).toEqual({ id: 'new', name: '年度', parentId: 'child' }); expect(result.dissolvedGroupIds).toEqual([]); expect(original).toEqual(tree());
    for (const createId of [undefined, '', 'root', 'x'.repeat(201)]) expect(() => planSavedQueryGroups(original, { kind: 'create', name: '新组', parentId: null }, createId)).toThrow();
    expect(() => planSavedQueryGroups(chain(8), { kind: 'create', name: '第九', parentId: '7' }, '8')).toThrow();
  });
  it('改名保留身份与后代，拒绝目标丢失、同父冲突', () => {
    const result = planSavedQueryGroups(tree(), { kind: 'rename', id: 'root', name: '开发库' });
    expect(result.groups[0]).toEqual({ id: 'root', name: '开发库', parentId: null }); expect(result.groups[1].parentId).toBe('root');
    expect(() => planSavedQueryGroups(tree(), { kind: 'rename', id: 'root', name: '其它' })).toThrow('同名');
    expect(() => planSavedQueryGroups(tree(), { kind: 'rename', id: 'gone', name: '新名' })).toThrow('不存在');
  });
  it('移动整棵子树，拒绝自身、后代、同父冲突与子树整体深度溢出', () => {
    const result = planSavedQueryGroups(tree(), { kind: 'moveGroup', id: 'child', parentId: 'other' });
    expect(result.groups.find(item => item.id === 'child')?.parentId).toBe('other'); expect(result.groups.find(item => item.id === 'leaf')?.parentId).toBe('child');
    for (const parentId of ['root', 'leaf']) expect(() => planSavedQueryGroups(tree(), { kind: 'moveGroup', id: 'root', parentId })).toThrow('自身或后代');
    expect(() => planSavedQueryGroups([...tree(), { id: 'collision', name: '报表', parentId: 'other' }], { kind: 'moveGroup', id: 'child', parentId: 'other' })).toThrow('同名');
    const deep = [...chain(7), { id: 'a', name: '甲', parentId: null }, { id: 'b', name: '乙', parentId: 'a' }];
    expect(() => planSavedQueryGroups(deep, { kind: 'moveGroup', id: 'a', parentId: '6' })).toThrow();
    expect(() => planSavedQueryGroups(tree(), { kind: 'moveGroup', id: 'child', parentId: 'gone' })).toThrow('不存在');
  });
  it('解散返回整棵子树编号，剩余树准确且合同没有删除查询操作', () => {
    const original = tree(), result = planSavedQueryGroups(original, { kind: 'dissolve', id: 'root' });
    expect(result.dissolvedGroupIds).toEqual(['root', 'child', 'leaf']); expect(result.groups).toEqual([original[3]]); expect(original).toEqual(tree());
    expect(() => savedQueryOrganizationOperationSchema.parse({ kind: 'deleteQueries', queries: [{ id: 'q', digest }] })).toThrow();
  });
  it('批量移动只验证选择与目的组，不读取SQL或改树，空目标代表退回未分组', () => {
    for (const groupId of [null, 'leaf']) expect(planSavedQueryGroups(tree(), { kind: 'moveQueries', queries: [{ id: 'q', digest }], groupId })).toEqual({ groups: tree(), dissolvedGroupIds: [] });
    expect(() => planSavedQueryGroups(tree(), { kind: 'moveQueries', queries: [{ id: 'q', digest }], groupId: 'gone' })).toThrow('不存在');
  });
  it('范围只含所选真实组或后代，原型名编号不混淆', () => {
    expect(savedQueryGroupIds(tree().reverse(), { kind: 'all' })).toBeNull(); expect(savedQueryGroupIds(tree(), { kind: 'unfiled' })).toEqual([]);
    expect(savedQueryGroupIds(tree(), { kind: 'group', id: 'root', includeDescendants: false })).toEqual(['root']);
    expect(savedQueryGroupIds(tree(), { kind: 'group', id: 'root', includeDescendants: true })).toEqual(['root', 'child', 'leaf']);
    expect(() => savedQueryGroupIds(tree(), { kind: 'group', id: 'gone', includeDescendants: true })).toThrow('不存在');
    expect(savedQueryGroupIds([{ id: '__proto__', name: '原型名', parentId: null }, { id: 'constructor', name: '子组', parentId: '__proto__' }], { kind: 'group', id: '__proto__', includeDescendants: true })).toEqual(['__proto__', 'constructor']);
  });
  it('直接计数与后代总数分离，逆序树、不分组与空组均准确', () => {
    const snapshot = summarizeSavedQueryOrganization(tree().reverse(), new Map([['root', 1], ['child', 2], ['leaf', 3]]), 4, revision);
    expect(snapshot.totalCount).toBe(10); expect(snapshot.unfiledCount).toBe(4);
    expect(snapshot.groups.find(item => item.id === 'root')).toMatchObject({ count: 1, totalCount: 6 });
    expect(snapshot.groups.find(item => item.id === 'child')).toMatchObject({ count: 2, totalCount: 5 });
    expect(snapshot.groups.find(item => item.id === 'other')).toMatchObject({ count: 0, totalCount: 0 });
    expect(summarizeSavedQueryOrganization([], new Map(), 0, revision)).toEqual({ revision, groups: [], totalCount: 0, unfiledCount: 0 });
  });
  it('计数拒绝未知组、负值、非整数、非有限与总和溢出', () => {
    for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => summarizeSavedQueryOrganization(tree(), new Map([['root', count]]), 0, revision)).toThrow();
      expect(() => summarizeSavedQueryOrganization(tree(), new Map(), count, revision)).toThrow();
    }
    expect(() => summarizeSavedQueryOrganization(tree(), new Map([['gone', 1]]), 0, revision)).toThrow();
    expect(() => summarizeSavedQueryOrganization(tree(), new Map([['root', Number.MAX_SAFE_INTEGER], ['child', 1]]), 0, revision)).toThrow();
    expect(() => summarizeSavedQueryOrganization(tree(), new Map(), 0, 'bad')).toThrow();
    expect(summarizeSavedQueryOrganization(tree(), new Map([['leaf', Number.MAX_SAFE_INTEGER]]), 0, revision).totalCount).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('保存查询分页范围合同兼容', () => {
  const input = { taskId: '12345678-1234-4234-9234-123456789abc', search: '查询', onError: 'continue' };
  it('省略范围完全保留原形状，三类显式范围不带SQL或外部位置', () => {
    expect(savedQueryPageInputSchema.parse(input)).toEqual(input);
    for (const group of [{ kind: 'all' }, { kind: 'unfiled' }, { kind: 'group', id: 'root', includeDescendants: true }, { kind: 'group', id: 'root', includeDescendants: false }]) expect(savedQueryPageInputSchema.parse({ ...input, group })).toEqual({ ...input, group });
  });
  it('范围拒绝缺项、未知字段和隐式真假值，继续页不能更改范围', () => {
    for (const group of [null, {}, { kind: 'all', id: 'root' }, { kind: 'group', id: 'root' }, { kind: 'group', groupId: 'root', includeDescendants: true }, { kind: 'group', id: 'root', includeDescendants: 1 }, { kind: 'unfiled', includeDescendants: true }, { kind: 'group', id: '', includeDescendants: true }]) expect(() => savedQueryGroupScopeSchema.parse(group)).toThrow();
    expect(() => savedQueryPageNextSchema.parse({ taskId: input.taskId, cursor: input.taskId, group: { kind: 'all' } })).toThrow();
    for (const patch of [{ search: 'x'.repeat(513) }, { onError: 'skip' }, { sql: 'SELECT 1' }]) expect(() => savedQueryPageInputSchema.parse({ ...input, ...patch, group: { kind: 'all' } })).toThrow();
  });
});
