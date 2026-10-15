import { z } from 'zod';

/** 收藏身份逐字段保存，名称中的点、斜杠和原型成员均不参与拆分。 */
const identifier = z.string().min(1).max(256).refine(value => !/[\u0000-\u001f\u007f]/.test(value) && !/[\uD800-\uDFFF]/u.test(value), '名称不能包含控制字符或无效 Unicode');
const id = identifier.max(200);
const base = { connectionId: id, database: identifier };
export const workbenchTargetSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('database') }).strict(),
  ...(['table', 'view', 'procedure', 'function', 'trigger', 'event'] as const).map(kind => z.object({ ...base, kind: z.literal(kind), name: identifier }).strict())
]);
export type WorkbenchTarget = z.infer<typeof workbenchTargetSchema>;
export const workbenchDocumentSchema = z.object({
  version: z.literal(1), focusMode: z.boolean(),
  groups: z.array(z.object({ id, name: identifier.max(100) }).strict()).max(100),
  favorites: z.array(z.object({ id, label: identifier, groupId: id.nullable(), target: workbenchTargetSchema }).strict()).max(1000)
}).strict().superRefine((document, context) => {
  const groups = new Set(document.groups.map(group => group.id));
  if (groups.size !== document.groups.length || new Set(document.favorites.map(item => item.id)).size !== document.favorites.length)
    context.addIssue({ code: 'custom', message: '收藏或分组编号重复' });
  if (document.favorites.some(item => item.groupId !== null && !groups.has(item.groupId)))
    context.addIssue({ code: 'custom', message: '收藏引用的虚拟分组不存在' });
  if (new Set(document.favorites.map(item => targetKey(item.target))).size !== document.favorites.length)
    context.addIssue({ code: 'custom', message: '同一对象不能重复收藏' });
  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > 2 * 1024 * 1024)
    context.addIssue({ code: 'custom', message: '收藏配置不能超过 2 MiB' });
});
export type WorkbenchDocument = z.infer<typeof workbenchDocumentSchema>;
export interface WorkbenchSnapshot { revision: number; document: WorkbenchDocument; }
export const workbenchSaveSchema = z.object({ revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1), document: workbenchDocumentSchema }).strict();
export const emptyWorkbench = (): WorkbenchDocument => ({ version: 1, focusMode: false, groups: [], favorites: [] });

/** 使用元组编码比较完整身份，不把 __proto__ 等名称用作对象属性。 */
export function targetKey(target: WorkbenchTarget): string {
  return JSON.stringify([target.connectionId, target.kind, target.database, target.kind === 'database' ? null : target.name]);
}

export const objectUriLimit = 8192;
/** 自主 URI 只携带身份，禁止凭据、SQL、查询参数和外部地址。 */
export function objectUri(input: WorkbenchTarget): string {
  const target = workbenchTargetSchema.parse(input);
  const segments = [target.connectionId, target.kind, target.database, ...(target.kind === 'database' ? [] : [target.name])];
  return 'dbark://object/v1/' + segments.map(value => encodeURIComponent(value).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())).join('/');
}

/** 严格匹配规范形式；解码一次后重新编码核验，拒绝 URL 自动归一化及额外字段。 */
export function parseObjectUri(uri: string): WorkbenchTarget {
  if (typeof uri !== 'string' || uri.length > objectUriLimit || !uri.startsWith('dbark://object/v1/')) throw new Error('对象链接格式无效或超过长度限制');
  try {
    const parts = uri.slice('dbark://object/v1/'.length).split('/').map(value => decodeURIComponent(value));
    const [connectionId, kind, database, name] = parts;
    if (parts.length !== (kind === 'database' ? 3 : 4)) throw new Error();
    const target = workbenchTargetSchema.parse({ connectionId, kind, database, ...(kind === 'database' ? {} : { name }) });
    if (objectUri(target) !== uri) throw new Error();
    return target;
  } catch { throw new Error('对象链接格式无效，请粘贴完整的 DBArk 对象链接'); }
}
