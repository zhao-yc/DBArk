import { z } from 'zod';
import type { ConnectionProfile } from './contracts';

export interface TablePreferenceTarget { connectionId: string; database: string; table: string; }
export interface TableColumnPreference { name: string; hidden: boolean; width?: number; }
/** 数组顺序即展示顺序；只记录列布局，不包含行数据、筛选值或 SQL。 */
export interface TablePreferences { version: 1; columns: TableColumnPreference[]; frozenThrough?: string; }
export const tablePreferencesLimits = { tables: 500, columns: 4096, entryBytes: 512 * 1024, totalBytes: 8 * 1024 * 1024, minWidth: 64, maxWidth: 2000 } as const;
export const tablePreferenceTargetSchema = z.object({ connectionId: z.string().min(1).max(200), database: z.string().min(1).max(256), table: z.string().min(1).max(256) }).strict();
const tablePreferencesShape = z.object({ version: z.literal(1), columns: z.array(z.object({ name: z.string().min(1).max(256), hidden: z.boolean(), width: z.number().int().min(tablePreferencesLimits.minWidth).max(tablePreferencesLimits.maxWidth).optional() }).strict()).max(tablePreferencesLimits.columns), frozenThrough: z.string().min(1).max(256).optional() }).strict().superRefine((preferences, context) => {
  const names = new Set<string>();
  for (const column of preferences.columns) {
    if (names.has(column.name)) context.addIssue({ code: 'custom', message: '表偏好不能重复列名' });
    names.add(column.name);
  }
  if (preferences.frozenThrough !== undefined && !preferences.columns.some(column => column.name === preferences.frozenThrough && !column.hidden)) context.addIssue({ code: 'custom', message: '冻结边界必须是当前可见的精确列名' });
});

/** IPC只读取普通对象的自有数据描述符，冻结字段和列描述的getter均不会被执行。 */
function preferenceRecord(input: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw Error('表偏好结构无效');
  const keys = Reflect.ownKeys(input);
  if (keys.length > allowed.length || keys.some(key => typeof key !== 'string' || !allowed.includes(key))) throw Error('表偏好存在未知字段');
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error('表偏好不能包含访问器或隐藏字段');
    output[key] = descriptor.value;
  }
  if (required.some(key => !Object.hasOwn(output, key))) throw Error('表偏好缺少必要字段');
  return output;
}

/** 有界复制稠密列数组，缺省冻结字段保持省略；显式undefined不能冒充有效边界。 */
function preferenceInput(input: unknown): unknown {
  const source = preferenceRecord(input, ['version', 'columns', 'frozenThrough'], ['version', 'columns']);
  if (Object.hasOwn(source, 'frozenThrough') && source.frozenThrough === undefined) throw Error('冻结边界必须是当前可见的精确列名');
  const original = source.columns;
  if (!Array.isArray(original) || Object.getPrototypeOf(original) !== Array.prototype) throw Error('表偏好列数组无效');
  const length = Object.getOwnPropertyDescriptor(original, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > tablePreferencesLimits.columns || Reflect.ownKeys(original).length !== length + 1) throw Error('表偏好列数组无效或超过上限');
  const columns: Record<string, unknown>[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(original, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw Error('表偏好列数组不能稀疏或包含访问器');
    columns.push(preferenceRecord(descriptor.value, ['name', 'hidden', 'width'], ['name', 'hidden']));
  }
  return { ...source, columns };
}

/** 描述符校验先于Zod读取字段，错误保持safeParse失败，不执行不可信属性。 */
export const tablePreferencesSchema = z.unknown().transform((input, context) => {
  try { return tablePreferencesShape.parse(preferenceInput(input)); }
  catch (reason) { context.addIssue({ code: 'custom', message: reason instanceof Error ? reason.message : '表偏好无效' }); return z.NEVER; }
});

/** 与 SQLite BLOB 字节统计保持一致，名称只是数据，原型同名列也不转换为对象属性。 */
export function tablePreferenceBytes(target: TablePreferenceTarget, preferences: TablePreferences): number {
  const encoder = new TextEncoder();
  return [target.connectionId, target.database, target.table, JSON.stringify(preferences)].reduce((size, value) => size + encoder.encode(value).byteLength, 0);
}

export const tablePreferenceSaveSchema = tablePreferenceTargetSchema.extend({ preferences: tablePreferencesSchema }).strict().superRefine((input, context) => {
  if (tablePreferenceBytes(input, input.preferences) > tablePreferencesLimits.entryBytes) context.addIssue({ code: 'custom', message: '单表偏好超过 512 KiB UTF-8 字节上限' });
});

/** 全库预算排除当前主键的旧记录，满额时仍允许更新、缩小和重置。 */
export function validateTablePreferenceBudget(otherCount: number, otherBytes: number, target: TablePreferenceTarget, preferences: TablePreferences): void {
  if (!Number.isSafeInteger(otherCount) || otherCount < 0 || !Number.isSafeInteger(otherBytes) || otherBytes < 0) throw new Error('本地表偏好预算统计无效');
  if (otherCount >= tablePreferencesLimits.tables) throw new Error('表偏好最多保存 500 个表，请重置不用的偏好');
  const bytes = tablePreferenceBytes(target, preferences);
  if (bytes > tablePreferencesLimits.entryBytes) throw new Error('单表偏好超过 512 KiB UTF-8 字节上限');
  if (otherBytes + bytes > tablePreferencesLimits.totalBytes) throw new Error('表偏好总量超过 8 MiB UTF-8 字节，请重置不用的偏好');
}

/** 仅目标或登录身份变化清理布局；密码、证书、密钥路径轮换和显示项变化保留布局。 */
export function tablePreferenceTargetChanged(previous: ConnectionProfile, next: ConnectionProfile): boolean {
  const target = (profile: ConnectionProfile): unknown[] => [profile.dialect, profile.host, profile.port, profile.user,
    profile.ssh?.enabled ?? false, ...(profile.ssh?.enabled ? [profile.ssh.host, profile.ssh.port, profile.ssh.user, profile.ssh.hostFingerprint ?? ''] : [])];
  return JSON.stringify(target(previous)) !== JSON.stringify(target(next));
}
