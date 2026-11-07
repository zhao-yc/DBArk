import { txtExportOptionsSchema } from './txtExport';
import { dataMarkupFormats } from './dataMarkupExport';
import { z } from 'zod';
import { csvExportDelimiters } from './csvExport';
import { postgresQueryInsertTargetSchema } from './postgresQueryExport';
import { sqliteQueryInsertTargetSchema } from './sqliteQueryExport';

export const fullQueryExportProfileLimits = { count: 32, name: 80, bytes: 2 * 1024 * 1024 };
const name = z.string().trim().min(1).max(fullQueryExportProfileLimits.name)
  .refine(value => !/[\p{Cc}]/u.test(value), '方案名称不能包含控制字符');
const encoding = z.enum(['utf8', 'utf16le', 'gb18030']);
const revision = z.string().uuid();
export const fullQueryExportProfileScope = z.object({ dialect: z.enum(['sqlite', 'postgresql']) }).strict();

// 仅持久化格式参数，严格拒绝 SQL、绑定值、连接及文件授权等额外字段。
const options = z.discriminatedUnion('format', [
  z.object({ format: z.literal('csv'), encoding, delimiter: z.enum(csvExportDelimiters) }).strict(),
  z.object({ format: z.literal('json'), encoding }).strict(),
  z.object({ format: z.literal('txt'), encoding, txtOptions: txtExportOptionsSchema }).strict(),
  z.object({ format: z.enum(['xlsx', ...dataMarkupFormats]) }).strict(),
  z.object({ format: z.literal('sql'), target: z.union([sqliteQueryInsertTargetSchema, postgresQueryInsertTargetSchema]) }).strict(),
]);
const profile = z.object({ name, options }).strict();
const stored = profile.extend({ revision });

const selection = z.object({ name, revision }).strict();
export const fullQueryExportProfileMutation = z.discriminatedUnion('kind', [
  fullQueryExportProfileScope.extend({ kind: z.literal('add'), profile }).strict(),
  fullQueryExportProfileScope.extend({ kind: z.literal('update'), selected: selection, profile }).strict(),
  fullQueryExportProfileScope.extend({ kind: z.literal('delete'), selected: selection }).strict(),
]).refine(input => input.kind === 'delete' || matchesDialect(input.dialect, input.profile.options), 'INSERT 映射与导出方案的数据库类型不一致');

export type FullQueryExportDialect = z.infer<typeof fullQueryExportProfileScope>['dialect'];
export type FullQueryExportOptions = z.infer<typeof options>;
export type FullQueryExportProfile = z.infer<typeof stored>;
export type FullQueryExportProfileMutation = z.infer<typeof fullQueryExportProfileMutation>;

function matchesDialect(dialect: FullQueryExportDialect, value: FullQueryExportOptions): boolean {
  return value.format !== 'sql' || ('database' in value.target) === (dialect === 'sqlite');
}

/** 每种数据库单独保存一个有界文档，损坏或未知版本不静默覆盖。 */
export function readFullQueryExportProfiles(dialect: FullQueryExportDialect, data: string): FullQueryExportProfile[] {
  if (new TextEncoder().encode(data).length > fullQueryExportProfileLimits.bytes) throw Error('导出方案总大小不能超过 2 MiB');
  const { profiles } = z.object({ version: z.literal(1), profiles: z.array(stored).max(fullQueryExportProfileLimits.count) }).strict().parse(JSON.parse(data));
  if (new Set(profiles.map(item => item.name)).size !== profiles.length || profiles.some(item => !matchesDialect(dialect, item.options)))
    throw Error('导出方案中存在重名或不匹配的数据库类型');
  return profiles;
}
