import { z } from 'zod';
import type { ConnectionProfile, NetworkConnectionProfile, SqliteConnectionProfile } from './contracts';

export const connectionTransferLimits = { connections: 500, fileBytes: 2 * 1024 * 1024, previewLifetimeMs: 10 * 60 * 1000, previews: 4 } as const;
export const connectionFileRequirements = ['sshPrivateKey', 'tlsCa', 'tlsCert', 'tlsKey'] as const;
export type ConnectionFileRequirement = typeof connectionFileRequirements[number] | 'sqliteDatabase';
const identifier = z.string().min(1).max(200);
const fileName = z.string().min(1).max(256).refine(value => !/[\\/\0]/.test(value) && value !== '.' && value !== '..', '文件提示只能包含文件名');
/** 自主交换格式只承载公开目标和文件名提示；未知字段和所有秘密字段均拒绝。 */
const exportedNetworkConnectionSchema = z.object({
  id: identifier, name: z.string().min(1).max(256), group: z.string().max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), dialect: z.enum(['mysql', 'mariadb']),
  host: z.string().min(1).max(512), port: z.number().int().min(1).max(65535), user: z.string().max(256), database: z.string().max(256).optional(),
  ssh: z.object({ enabled: z.boolean(), host: z.string().max(512), port: z.number().int().min(1).max(65535), user: z.string().max(256), hostFingerprint: z.string().max(256).optional(), privateKeyFileName: fileName.optional() }).strict().optional(),
  tls: z.object({ enabled: z.boolean(), rejectUnauthorized: z.boolean(), caFileName: fileName.optional(), certFileName: fileName.optional(), keyFileName: fileName.optional() }).strict().optional(),
}).strict();
/** SQLite交换材料只含文件名提示，绝不接受可生效路径或授权令牌。 */
export const exportedConnectionSchema = z.discriminatedUnion('dialect', [exportedNetworkConnectionSchema, z.object({
  id: identifier, name: z.string().min(1).max(256), group: z.string().max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), dialect: z.literal('sqlite'),
  sqlite: z.object({ fileName: fileName.optional(), readOnly: z.boolean(), busyTimeoutMs: z.number().int().min(0).max(5000) }).strict(),
}).strict()]);
export type ExportedConnectionProfile = z.infer<typeof exportedConnectionSchema>;
export type ExportedNetworkConnectionProfile = Extract<ExportedConnectionProfile, { dialect: 'mysql' | 'mariadb' }>;
export type ExportedSqliteConnectionProfile = Extract<ExportedConnectionProfile, { dialect: 'sqlite' }>;
export const connectionTransferDocumentSchema = z.object({ format: z.literal('DBArk-connections'), version: z.literal(1), connections: z.array(exportedConnectionSchema).min(1).max(connectionTransferLimits.connections) }).strict().superRefine((document, context) => {
  const ids = new Set<string>();
  for (const profile of document.connections) { if (ids.has(profile.id)) context.addIssue({ code: 'custom', message: '文件内连接 ID 重复' }); ids.add(profile.id); }
});
export type ConnectionTransferDocument = z.infer<typeof connectionTransferDocumentSchema>;
export interface ConnectionImportEntry { sourceId: string; profile: ExportedConnectionProfile; warnings: string[]; matches: { id: string; name: string; reasons: ('id' | 'name' | 'target')[] }[]; }
export interface ConnectionImportPreview { previewToken: string; expiresAt: string; entries: ConnectionImportEntry[]; }
export const connectionReplacementAcknowledgements = ['review-target', 'clear-credentials', 'reselect-files', 'retain-linked-records'] as const;
/** 新增/跳过不能夹带目标；替换只能明确引用本机目标ID，匹配提示从不生成替换决策。 */
export const connectionImportDecisionSchema = z.discriminatedUnion('action', [
  z.object({ sourceId: identifier, action: z.literal('add') }).strict(),
  z.object({ sourceId: identifier, action: z.literal('skip') }).strict(),
  z.object({ sourceId: identifier, action: z.literal('replace'), targetId: identifier.refine(value => !value.includes('\0'), '替换目标身份不能含NUL') }).strict(),
]);
export type ConnectionImportDecision = z.infer<typeof connectionImportDecisionSchema>;
export const connectionImportReviewSchema = z.object({ previewToken: identifier, decisions: z.array(connectionImportDecisionSchema).min(1).max(connectionTransferLimits.connections) }).strict();
export type ConnectionImportReviewInput = z.infer<typeof connectionImportReviewSchema>;
export interface ConnectionImportReview { confirmationToken: string; expiresAt: string; entries: { sourceId: string; action: ConnectionImportDecision['action']; profile: ExportedConnectionProfile; previous?: ExportedConnectionProfile }[]; }
export interface ConnectionImportApply extends ConnectionImportReviewInput { allowIncomplete?: boolean; confirmationToken?: string; acknowledgements?: typeof connectionReplacementAcknowledgements[number][]; }
/** 确认结果返回完整公开连接列表，新增和跳过数量仅统计本批。 */
export interface ConnectionImportResult { connections: ConnectionProfile[]; added: number; skipped: number; replaced?: number; replacementIds?: string[]; }
export const connectionImportApplySchema = connectionImportReviewSchema.extend({ allowIncomplete: z.boolean().optional(), confirmationToken: identifier.optional(), acknowledgements: z.array(z.enum(connectionReplacementAcknowledgements)).max(connectionReplacementAcknowledgements.length).optional() }).strict();

/** 路径只提取跨平台 basename，绝不把原路径或证书内容写入交换文件。 */
function hint(path: string | undefined): string | undefined { return path?.split(/[\\/]/).at(-1) || undefined; }

/** 导出采用字段白名单，公开概要中的凭据存在标记也不能被序列化。 */
export function exportConnectionProfile(profile: NetworkConnectionProfile): ExportedNetworkConnectionProfile;
export function exportConnectionProfile(profile: SqliteConnectionProfile): ExportedSqliteConnectionProfile;
export function exportConnectionProfile(profile: ConnectionProfile): ExportedConnectionProfile;
export function exportConnectionProfile(profile: ConnectionProfile): ExportedConnectionProfile {
  if (profile.dialect === 'sqlite') return exportedConnectionSchema.parse({
    id: profile.id, name: profile.name, group: profile.group, color: profile.color, dialect: 'sqlite',
    sqlite: { fileName: hint(profile.sqlite.filePath) ?? hint(profile.sqlite.fileName), readOnly: profile.sqlite.readOnly, busyTimeoutMs: profile.sqlite.busyTimeoutMs },
  });
  return exportedConnectionSchema.parse({
    id: profile.id, name: profile.name, group: profile.group, color: profile.color, dialect: profile.dialect, host: profile.host, port: profile.port, user: profile.user, database: profile.database,
    ...(profile.ssh ? { ssh: { enabled: profile.ssh.enabled, host: profile.ssh.host, port: profile.ssh.port, user: profile.ssh.user, hostFingerprint: profile.ssh.hostFingerprint, privateKeyFileName: hint(profile.ssh.privateKeyPath) ?? (profile.pendingFiles?.includes('sshPrivateKey') ? '需重新选择私钥' : undefined) } } : {}),
    ...(profile.tls ? { tls: { enabled: profile.tls.enabled, rejectUnauthorized: profile.tls.rejectUnauthorized, caFileName: hint(profile.tls.caPath) ?? (profile.pendingFiles?.includes('tlsCa') ? '需重新选择CA' : undefined), certFileName: hint(profile.tls.certPath) ?? (profile.pendingFiles?.includes('tlsCert') ? '需重新选择证书' : undefined), keyFileName: hint(profile.tls.keyPath) ?? (profile.pendingFiles?.includes('tlsKey') ? '需重新选择私钥' : undefined) } } : {}),
  });
}

/** 复制也必须重新选择本机认证文件；不复用秘密、存在标记或可生效路径。 */
export function copyConnectionProfile(profile: NetworkConnectionProfile): NetworkConnectionProfile;
export function copyConnectionProfile(profile: SqliteConnectionProfile): SqliteConnectionProfile;
export function copyConnectionProfile(profile: ConnectionProfile): ConnectionProfile;
export function copyConnectionProfile(profile: ConnectionProfile): ConnectionProfile {
  return importConnectionProfile(exportConnectionProfile(profile), '');
}

/** 文件名仅作为提示；导入只生成缺文件标记，不将任何导入值作为本机路径。 */
export function importConnectionProfile(profile: ExportedNetworkConnectionProfile, id: string): NetworkConnectionProfile;
export function importConnectionProfile(profile: ExportedSqliteConnectionProfile, id: string): SqliteConnectionProfile;
export function importConnectionProfile(profile: ExportedConnectionProfile, id: string): ConnectionProfile;
export function importConnectionProfile(profile: ExportedConnectionProfile, id: string): ConnectionProfile {
  if (profile.dialect === 'sqlite') return {
    id, name: profile.name, group: profile.group, color: profile.color, dialect: 'sqlite',
    sqlite: { ...profile.sqlite }, pendingFiles: ['sqliteDatabase'],
  };
  const pendingFiles: Exclude<ConnectionFileRequirement, 'sqliteDatabase'>[] = [];
  if (profile.ssh?.privateKeyFileName) pendingFiles.push('sshPrivateKey');
  if (profile.tls?.caFileName) pendingFiles.push('tlsCa');
  if (profile.tls?.certFileName) pendingFiles.push('tlsCert');
  if (profile.tls?.keyFileName) pendingFiles.push('tlsKey');
  return {
    id, name: profile.name, group: profile.group, color: profile.color, dialect: profile.dialect, host: profile.host, port: profile.port, user: profile.user, database: profile.database, rememberPassword: false,
    ...(pendingFiles.length ? { pendingFiles } : {}),
    ...(profile.ssh ? { ssh: { enabled: profile.ssh.enabled, host: profile.ssh.host, port: profile.ssh.port, user: profile.ssh.user, hostFingerprint: profile.ssh.hostFingerprint } } : {}),
    ...(profile.tls ? { tls: { enabled: profile.tls.enabled, rejectUnauthorized: profile.tls.rejectUnauthorized } } : {}),
  };
}

/** 替换丢弃所有路径；旧认证文件即使被源概要省略也保留缺项，不能静默回退到另一认证方式。 */
export function importReplacementProfile(profile: ExportedConnectionProfile, previous: ExportedConnectionProfile): ConnectionProfile {
  if ((profile.dialect === 'sqlite') !== (previous.dialect === 'sqlite')) throw new Error('不能将已有连接替换为其他数据库类型，请另建连接');
  const next = importConnectionProfile(profile, previous.id);
  if (next.dialect === 'sqlite') return next;
  const before = importConnectionProfile(previous, previous.id);
  if (before.dialect === 'sqlite') throw new Error('不能将已有连接替换为其他数据库类型，请另建连接');
  const pending = new Set([...next.pendingFiles ?? [], ...before.pendingFiles ?? []]);
  return { ...next, ...(pending.size ? { pendingFiles: [...pending] } : {}) };
}

/** 缺失文件不能静默切换认证方式；禁用部分仍保留标记，以便以后开启时继续阻止误连。 */
export function assertConnectionReady(profile: ConnectionProfile): void {
  if (profile.dialect === 'sqlite') {
    if (!profile.sqlite.filePath || profile.pendingFiles?.includes('sqliteDatabase')) throw new Error('连接需要重新选择本机SQLite数据库文件并保存，请编辑连接后重试');
    return;
  }
  const missing = profile.pendingFiles?.filter(item => item === 'sshPrivateKey' ? profile.ssh?.enabled : profile.tls?.enabled);
  if (missing?.length) throw new Error('连接需要重新选择本机私钥或证书文件并保存，请编辑连接后重试');
}
