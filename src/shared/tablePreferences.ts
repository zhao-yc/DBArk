import { z } from 'zod';
import type { ConnectionProfile } from './contracts';

export interface TablePreferenceTarget { connectionId: string; database: string; table: string; }
export interface TableColumnPreference { name: string; hidden: boolean; width?: number; }
/** 数组顺序即展示顺序；只记录列布局，不包含行数据、筛选值或 SQL。 */
export interface TablePreferences { version: 1; columns: TableColumnPreference[]; }
export const tablePreferencesLimits = { tables: 500, columns: 4096, entryBytes: 512 * 1024, totalBytes: 8 * 1024 * 1024, minWidth: 64, maxWidth: 2000 } as const;
export const tablePreferenceTargetSchema = z.object({ connectionId: z.string().min(1).max(200), database: z.string().min(1).max(256), table: z.string().min(1).max(256) }).strict();
export const tablePreferencesSchema = z.object({ version: z.literal(1), columns: z.array(z.object({ name: z.string().min(1).max(256), hidden: z.boolean(), width: z.number().int().min(tablePreferencesLimits.minWidth).max(tablePreferencesLimits.maxWidth).optional() }).strict()).max(tablePreferencesLimits.columns) }).strict().superRefine((preferences, context) => {
  const names = new Set<string>();
  for (const column of preferences.columns) {
    if (names.has(column.name)) context.addIssue({ code: 'custom', message: '表偏好不能重复列名' });
    names.add(column.name);
  }
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
