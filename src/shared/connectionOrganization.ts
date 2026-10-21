import { z } from 'zod';
import type { ConnectionProfile } from './contracts';
import { connectionOrganizationZh as text } from './connectionOrganization.zh-CN';

export const connectionOrganizationDefaultColor = '#52c5a2';
export const connectionOrganizationLimits = { ids: 1000, id: 200, group: 100 } as const;
export interface ConnectionOrganizationSnapshot { revision: number; connections: ConnectionProfile[]; }

/** 仅接纳自有数据属性，阻止访问器、原型字段或隐藏额外字段绕过严格白名单。 */
function fields(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw Error(text.invalid);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw Error(text.invalid);
  const copied: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !('value' in descriptor)) throw Error(text.invalid); copied[key] = descriptor.value; }
  return copied;
}
/** 在Zod递归读取前先做固定结构和1000成员上限，稀疏索引及额外数组属性均拒绝。 */
function prepare(value: unknown): unknown {
  const input = fields(value, ['expectedRevision', 'ids', 'changes'], ['expectedRevision', 'ids', 'changes']);
  fields(input.changes, ['group', 'color'], []);
  if (!Array.isArray(input.ids)) throw Error(text.ids);
  const length = Object.getOwnPropertyDescriptor(input.ids, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > connectionOrganizationLimits.ids || Reflect.ownKeys(input.ids).length !== length + 1) throw Error(text.ids);
  for (let index = 0; index < length; index++) { const item = Object.getOwnPropertyDescriptor(input.ids, String(index)); if (!item || !('value' in item)) throw Error(text.ids); }
  return value;
}
/** 保留合法Unicode及前后空格，不把不同命名分组静默合并，也不允许控制字符进入显示元数据。 */
function validGroup(value: string): boolean {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) return false;
  for (const character of value) { const point = character.codePointAt(0)!; if (point >= 0xd800 && point <= 0xdfff) return false; }
  return true;
}
const apply = z.object({
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  ids: z.array(z.string().min(1).max(connectionOrganizationLimits.id)).min(1).max(connectionOrganizationLimits.ids).refine(ids => new Set(ids).size === ids.length, text.ids),
  changes: z.object({ group: z.string().max(connectionOrganizationLimits.group, text.groupInvalid).refine(validGroup, text.groupInvalid).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/, text.colorInvalid).nullable().optional() }).strict().refine(changes => changes.group !== undefined || changes.color !== undefined, text.emptyChanges),
}).strict();
export type ConnectionOrganizationApply = z.infer<typeof apply>;
export const connectionOrganizationGetSchema = z.preprocess((value, context) => { try { fields(value, [], []); return value; } catch { context.addIssue({ code: 'custom', message: text.invalid }); return z.NEVER; } }, z.object({}).strict());
export const connectionOrganizationApplySchema = z.preprocess((value, context) => {
  try { return prepare(value); } catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : text.invalid }); return z.NEVER; }
}, apply);
