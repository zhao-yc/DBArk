import type { TableColumnApplyProgress, TableColumnPatchTarget } from './tableColumnPatches';

/** 字节上限是首批客户端保守预算，并非把服务器的2048字符上限误称为字节。 */
export const tableCommentLimits = { characters: 2048, utf8Bytes: 2048 } as const;
export const tableCommentAcknowledgements = ['ddl-implicit-commit', 'external-ddl-window'] as const;
export type TableCommentProgress = TableColumnApplyProgress;
export type TableCommentTarget = TableColumnPatchTarget;
export interface TableCommentGetInput extends TableCommentTarget { taskId: string; }
export interface TableCommentPreviewInput { snapshotId: string; comment: string; taskId: string; }
export interface TableCommentApplyInput { previewToken: string; acknowledgements: string[]; taskId: string; }
export interface TableCommentReleaseInput { snapshotId?: string; previewToken?: string; }
export interface TableCommentBudget { characters: number; utf8Bytes: number; supplementary: boolean; metadataCharset: string; }
export interface TableCommentGetOutput {
  target: TableCommentTarget; snapshotId: string; expiresAt: string; ddlHash: string;
  comment: string; engine: string; rowFormat: string; charset: string; collation: string; autoIncrement: string | null;
  writable: boolean; reasons: string[]; warnings: string[]; budget?: TableCommentBudget; serverVersion: string;
}
export interface TableCommentPreviewOutput {
  target: TableCommentTarget; previewToken: string; expiresAt: string; ddlHash: string;
  sql: string; before: string; after: string; warnings: string[]; requiredAcknowledgements: string[];
}
export interface TableCommentApplyOutput {
  ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean; warnings: string[];
  after?: { comment: string; ddlHash: string }; verificationError?: string;
}

/** 不修剪或规范化说明文字；非法代理项必须先拒绝，避免UTF-8编码静默替换。 */
export function validateTableComment(value: unknown, budget?: TableCommentBudget): string {
  if (typeof value !== 'string') throw new Error('表注释必须是文字');
  if (value.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error('表注释包含NUL或无效Unicode代理项');
  const characters = [...value].length, bytes = new TextEncoder().encode(value).length;
  if (characters > Math.min(budget?.characters ?? tableCommentLimits.characters, tableCommentLimits.characters) || bytes > Math.min(budget?.utf8Bytes ?? tableCommentLimits.utf8Bytes, tableCommentLimits.utf8Bytes)) throw new Error('表注释超过字符或UTF-8字节预算；不会自动截断');
  if (budget && !budget.supplementary && /[\u{10000}-\u{10FFFF}]/u.test(value)) throw new Error('当前服务器注释目录不能证明支持补充平面字符；请使用基本多文种平面文字');
  if (tableCommentHasEngineOptions(value)) throw new Error('注释包含MERGE_THRESHOLD等引擎参数，首批不能修改这些物理选项');
  return value;
}
/** 已有配置或新输入均不得借普通注释修改删除、加入物理参数。 */
export function tableCommentHasEngineOptions(value: string): boolean {
  return /MERGE_THRESHOLD|NDB_TABLE|(?:^|[\s;,])(?:ENGINE|TABLESPACE|CONNECTION|PARTITION|SHARD|SERVER|LINK_STATUS)\s*=/i.test(value);
}
