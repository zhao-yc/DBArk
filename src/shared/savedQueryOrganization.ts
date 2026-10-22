import { z } from 'zod';

export const savedQueryOrganizationLimits = { groups: 256, depth: 8, name: 80, id: 200, selection: 100 } as const;
/** 共享中文说明不包含查询正文、输入摘要或文件内容。 */
export const savedQueryOrganizationMessages = {
  invalid: '保存查询分组请求结构无效', name: '分组名称须为1至80个字符，不能含首尾空白、控制符或路径分隔符',
  tree: '保存查询分组树无效或超过256组、8层限制', duplicate: '同一父分组下已存在同名分组',
  missing: '目标分组已不存在，请刷新分组', cycle: '不能将分组移动到自身或后代中',
  selection: '请选择1至100条不同的保存查询', revision: '保存查询分组版本无效',
  createId: '新分组编号无效或已存在', counts: '保存查询分组计数无效',
} as const;
const text = savedQueryOrganizationMessages;
const id = z.string().min(1).max(savedQueryOrganizationLimits.id);
const digest = z.string().regex(/^[a-f0-9]{64}$/);

/** 按UTF-16限定长度，保留合法原名；不修剪、折叠大小写或静默规范化Unicode。 */
function validName(value: string): boolean {
  if (value.length < 1 || value.length > savedQueryOrganizationLimits.name || value.trim() !== value || /[\u0000-\u001f\u007f-\u009f/\\]/.test(value)) return false;
  for (const character of value) { const point = character.codePointAt(0)!; if (point >= 0xd800 && point <= 0xdfff) return false; }
  return true;
}
export const savedQueryGroupNameSchema = z.string().min(1, text.name).max(savedQueryOrganizationLimits.name, text.name).refine(validName, text.name);

/** 在Zod读取前复制自有数据字段；拒绝访问器、符号、稀疏数组、循环及非普通容器。 */
function copyData(value: unknown, depth = 0, ancestors = new Set<object>(), budget = { nodes: 0 }): unknown {
  if (++budget.nodes > 4096 || depth > 8) throw Error(text.invalid);
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (!value || typeof value !== 'object' || ancestors.has(value)) throw Error(text.invalid);
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw Error(text.invalid);
  const keys = Reflect.ownKeys(value), result: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
  if (array) {
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length) || length > savedQueryOrganizationLimits.groups || keys.length !== length + 1) throw Error(text.invalid);
  } else if (keys.length > 16) throw Error(text.invalid);
  ancestors.add(value);
  try {
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw Error(text.invalid);
      if (array && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= (value as unknown[]).length)) throw Error(text.invalid);
      Object.defineProperty(result, key, { value: copyData(descriptor.value, depth + 1, ancestors, budget), enumerable: true, writable: true, configurable: true });
    }
    return result;
  } finally { ancestors.delete(value); }
}
/** 只输出固定中文结构错误，不把恶意字段或原始输入写进错误消息。 */
function checked<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value, context) => {
    try { return copyData(value); } catch { context.addIssue({ code: 'custom', message: text.invalid }); return z.NEVER; }
  }, schema);
}
const operation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), name: savedQueryGroupNameSchema, parentId: id.nullable() }).strict(),
  z.object({ kind: z.literal('rename'), id, name: savedQueryGroupNameSchema }).strict(),
  z.object({ kind: z.literal('moveGroup'), id, parentId: id.nullable() }).strict(),
  z.object({ kind: z.literal('dissolve'), id }).strict(),
  z.object({ kind: z.literal('moveQueries'), queries: z.array(z.object({ id, digest }).strict()).min(1, text.selection).max(savedQueryOrganizationLimits.selection, text.selection).refine(queries => new Set(queries.map(query => query.id)).size === queries.length, text.selection), groupId: id.nullable() }).strict(),
]);
export const savedQueryOrganizationOperationSchema = checked(operation);
export const savedQueryOrganizationGetSchema = checked(z.object({}).strict());
export const savedQueryOrganizationApplySchema = checked(z.object({ expectedRevision: digest, operation }).strict());
export type SavedQueryOrganizationOperation = z.infer<typeof savedQueryOrganizationOperationSchema>;
export type SavedQueryOrganizationApply = z.infer<typeof savedQueryOrganizationApplySchema>;
export interface SavedQueryGroup { id: string; name: string; parentId: string | null; }
export interface SavedQueryOrganizationSnapshot { revision: string; groups: (SavedQueryGroup & { count: number; totalCount: number })[]; unfiledCount: number; totalCount: number; }
const group = z.object({ id, name: savedQueryGroupNameSchema, parentId: id.nullable() }).strict();
const groupsSchema = checked(z.array(group).max(savedQueryOrganizationLimits.groups));

/** 从编号建立真实树，不将数组位置、拼接路径或对象原型键作为身份。 */
export function validateSavedQueryGroups(input: unknown): SavedQueryGroup[] {
  const groups = groupsSchema.parse(input), byId = new Map(groups.map(item => [item.id, item]));
  if (byId.size !== groups.length) throw Error(text.tree);
  const names = new Map<string | null, Set<string>>();
  for (const item of groups) {
    if (item.parentId !== null && !byId.has(item.parentId)) throw Error(text.tree);
    const siblings = names.get(item.parentId) ?? new Set<string>();
    if (siblings.has(item.name)) throw Error(text.duplicate);
    siblings.add(item.name); names.set(item.parentId, siblings);
    let current: SavedQueryGroup | undefined = item, depth = 0;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current.id) || ++depth > savedQueryOrganizationLimits.depth) throw Error(text.tree);
      visited.add(current.id); current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
  }
  return groups;
}

const scope = z.discriminatedUnion('kind', [z.object({ kind: z.literal('all') }).strict(), z.object({ kind: z.literal('unfiled') }).strict(), z.object({ kind: z.literal('group'), id, includeDescendants: z.boolean() }).strict()]);
export const savedQueryGroupScopeSchema = checked(scope);
export type SavedQueryGroupScope = z.infer<typeof savedQueryGroupScopeSchema>;

/** 返回实际范围内的稳定编号；null表示全部，空数组表示未分组，缺失目标明确报错。 */
export function savedQueryGroupIds(input: readonly SavedQueryGroup[], inputScope: SavedQueryGroupScope): string[] | null {
  const groups = validateSavedQueryGroups(input), selected = savedQueryGroupScopeSchema.parse(inputScope);
  if (selected.kind === 'all') return null;
  if (selected.kind === 'unfiled') return [];
  if (!groups.some(item => item.id === selected.id)) throw Error(text.missing);
  const ids = new Set([selected.id]);
  if (selected.includeDescendants) for (let changed = true; changed;) { changed = false; for (const item of groups) if (item.parentId !== null && ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true; } }
  return groups.filter(item => ids.has(item.id)).map(item => item.id);
}

export interface SavedQueryGroupPlan { groups: SavedQueryGroup[]; dissolvedGroupIds: string[]; }
/** 纯规划只变更树；解散返回整棵子树编号，由存储事务退回成员，绝不删除查询。 */
export function planSavedQueryGroups(input: readonly SavedQueryGroup[], inputOperation: SavedQueryOrganizationOperation, createId?: string): SavedQueryGroupPlan {
  const groups = validateSavedQueryGroups(input), op = savedQueryOrganizationOperationSchema.parse(inputOperation);
  const exists = (value: string | null): void => { if (value !== null && !groups.some(item => item.id === value)) throw Error(text.missing); };
  let next = groups, dissolvedGroupIds: string[] = [];
  if (op.kind === 'create') {
    exists(op.parentId);
    if (!id.safeParse(createId).success || groups.some(item => item.id === createId)) throw Error(text.createId);
    next = [...groups, { id: createId!, name: op.name, parentId: op.parentId }];
  } else if (op.kind === 'moveQueries') exists(op.groupId);
  else {
    exists(op.id);
    if (op.kind === 'rename') next = groups.map(item => item.id === op.id ? { ...item, name: op.name } : item);
    if (op.kind === 'moveGroup') {
      exists(op.parentId);
      if (op.parentId !== null && savedQueryGroupIds(groups, { kind: 'group', id: op.id, includeDescendants: true })!.includes(op.parentId)) throw Error(text.cycle);
      next = groups.map(item => item.id === op.id ? { ...item, parentId: op.parentId } : item);
    }
    if (op.kind === 'dissolve') {
      dissolvedGroupIds = savedQueryGroupIds(groups, { kind: 'group', id: op.id, includeDescendants: true })!;
      const removed = new Set(dissolvedGroupIds); next = groups.filter(item => !removed.has(item.id));
    }
  }
  return { groups: validateSavedQueryGroups(next), dissolvedGroupIds };
}

/** 仅累加各组直接计数，不读取SQL正文；父链有界且总数保持安全整数。 */
export function summarizeSavedQueryOrganization(input: readonly SavedQueryGroup[], counts: ReadonlyMap<string, number>, unfiledCount: number, revision: string): SavedQueryOrganizationSnapshot {
  const groups = validateSavedQueryGroups(input);
  if (!digest.safeParse(revision).success) throw Error(text.revision);
  const validCount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
  if (!validCount(unfiledCount) || [...counts].some(([key, count]) => !groups.some(item => item.id === key) || !validCount(count))) throw Error(text.counts);
  const result = groups.map(item => ({ ...item, count: counts.get(item.id) ?? 0, totalCount: counts.get(item.id) ?? 0 })), byId = new Map(result.map(item => [item.id, item]));
  let totalCount = unfiledCount;
  for (const item of result) {
    totalCount += item.count; if (!validCount(totalCount)) throw Error(text.counts);
    let parent = item.parentId;
    while (parent !== null) { const value = byId.get(parent)!; value.totalCount += item.count; if (!validCount(value.totalCount)) throw Error(text.counts); parent = value.parentId; }
  }
  return { revision, groups: result, unfiledCount, totalCount };
}
