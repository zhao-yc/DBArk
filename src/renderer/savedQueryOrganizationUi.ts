import { planSavedQueryGroups, savedQueryGroupIds, summarizeSavedQueryOrganization, type SavedQueryOrganizationSnapshot, type SavedQueryOrganizationOperation, type SavedQueryOrganizationApply } from '../shared/savedQueryOrganization';
import { savedQueryOrganizationApplySchema } from '../shared/savedQueryOrganization';
import { savedQueryOrganizationZh as text } from './locales/savedQueryOrganization.zh-CN';

export interface SelectedSavedQuery { id: string; digest: string; name: string; }
export interface SavedQueryOrganizationPreview { input: SavedQueryOrganizationApply; before: string; after: string; groupCount: number; queryCount: number; }

/** 回包先检查自有数据字段，不能执行访问器或接受不完整的计数。 */
function own(value: unknown, key: string): unknown { const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key) : undefined; if (!descriptor || !('value' in descriptor)) throw Error(text.snapshotInvalid); return descriptor.value; }
export function readSavedQueryOrganization(raw: unknown): SavedQueryOrganizationSnapshot {
  try {
    if (!raw || typeof raw !== 'object' || Reflect.ownKeys(raw).length !== 4) throw Error();
    const values = own(raw, 'groups'), revision = own(raw, 'revision'), unfiledCount = own(raw, 'unfiledCount');
    if (!Array.isArray(values) || values.length > 256 || Reflect.ownKeys(values).length !== values.length + 1 || typeof revision !== 'string' || typeof unfiledCount !== 'number') throw Error();
    const groups = Array.from({ length: values.length }, (_, index) => { const value = own(values, String(index)); if (!value || typeof value !== 'object' || Reflect.ownKeys(value).length !== 5) throw Error(); const id = own(value, 'id'), name = own(value, 'name'), parentId = own(value, 'parentId'), count = own(value, 'count'), totalCount = own(value, 'totalCount'); if (typeof id !== 'string' || typeof name !== 'string' || parentId !== null && typeof parentId !== 'string' || typeof count !== 'number' || typeof totalCount !== 'number') throw Error(); return { id, name, parentId, count, totalCount }; });
    const result = summarizeSavedQueryOrganization(groups.map(({ id, name, parentId }) => ({ id, name, parentId })), new Map(groups.map(value => [value.id, value.count])), unfiledCount, revision) as SavedQueryOrganizationSnapshot;
    if (own(raw, 'totalCount') !== result.totalCount || groups.some((value, index) => value.totalCount !== result.groups[index].totalCount)) throw Error();
    return result;
  } catch { throw Error(text.snapshotInvalid); }
}

/** 只按编号遍历；显示路径不用于解析身份，原型同名分组同样安全。 */
export function savedQueryOrganizationTree(snapshot: SavedQueryOrganizationSnapshot) {
  const result: Array<{ id: string; name: string; parentId: string | null; depth: number; path: string; count: number; totalCount: number }> = [];
  const visit = (parentId: string | null, depth: number, path: string) => { for (const group of snapshot.groups.filter(item => item.parentId === parentId)) { const fullPath = path ? path + ' / ' + group.name : group.name; result.push({ ...group, depth, path: fullPath }); visit(group.id, depth + 1, fullPath); } }; visit(null, 1, ''); return result;
}

/** 完整共享规划后冻结唯一补丁；预览不复制任何SQL正文或认证信息。 */
export function previewSavedQueryOrganization(snapshot: SavedQueryOrganizationSnapshot, operation: SavedQueryOrganizationOperation): SavedQueryOrganizationPreview {
  const input = savedQueryOrganizationApplySchema.parse({ expectedRevision: snapshot.revision, operation }), tree = savedQueryOrganizationTree(snapshot), path = (id: string | null) => id === null ? text.root : tree.find(item => item.id === id)?.path ?? text.choose;
  let createId = 'preview-new-group'; while (snapshot.groups.some(item => item.id === createId)) createId += '-new';
  const plan = planSavedQueryGroups(snapshot.groups.map(({ id, name, parentId }) => ({ id, name, parentId })), input.operation, createId), op = input.operation;
  let before = '', after = '', groupCount = 1, queryCount = 0;
  if (op.kind === 'create') { before = text.create; after = (op.parentId === null ? '' : path(op.parentId) + ' / ') + op.name; }
  else if (op.kind === 'moveQueries') { before = text.queries(op.queries.length); after = op.groupId === null ? text.unfiled : path(op.groupId); groupCount = 0; queryCount = op.queries.length; }
  else {
    const current = snapshot.groups.find(item => item.id === op.id)!; before = path(op.id);
    if (op.kind === 'rename') { if (current.name === op.name) throw Error(text.noChange); after = (current.parentId === null ? '' : path(current.parentId) + ' / ') + op.name; }
    if (op.kind === 'moveGroup') { if (current.parentId === op.parentId) throw Error(text.noChange); after = (op.parentId === null ? '' : path(op.parentId) + ' / ') + current.name; groupCount = savedQueryGroupIds(snapshot.groups.map(({ id, name, parentId }) => ({ id, name, parentId })), { kind: 'group', id: op.id, includeDescendants: true })!.length; queryCount = current.totalCount; }
    if (op.kind === 'dissolve') { after = text.unfiled; groupCount = plan.dissolvedGroupIds.length; queryCount = current.totalCount; }
  }
  const freeze = (value: any): any => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
  return freeze({ input, before, after, groupCount, queryCount });
}
