import type { TableColumnApplyProgress, TableColumnPatchTarget } from './tableColumnPatches';

export const tableDefaultEncodingLimits = { candidates: 8192, catalogBytes: 2 * 1024 * 1024 } as const;
export const tableDefaultEncodingAcknowledgements = ['ddl-implicit-commit', 'external-ddl-window', 'table-default-only'] as const;
export type TableDefaultEncodingProgress = TableColumnApplyProgress;
export type TableDefaultEncodingTarget = TableColumnPatchTarget;
export interface TableEncodingPair { charset: string; collation: string; }
export interface TableDefaultEncodingGetInput extends TableDefaultEncodingTarget { taskId: string; }
export interface TableDefaultEncodingPreviewInput extends TableEncodingPair { snapshotId: string; taskId: string; }
export interface TableDefaultEncodingApplyInput { previewToken: string; acknowledgements: string[]; taskId: string; }
export interface TableDefaultEncodingReleaseInput { snapshotId?: string; previewToken?: string; }
export interface TableDefaultEncodingGetOutput {
  target: TableDefaultEncodingTarget; snapshotId: string; expiresAt: string; ddlHash: string;
  current: TableEncodingPair; candidates: TableEncodingPair[]; engine: string; rowFormat: string; serverVersion: string;
  columns: { name: string; charset: string | null; collation: string | null }[];
  writable: boolean; reasons: string[]; warnings: string[];
}
export interface TableDefaultEncodingPreviewOutput {
  target: TableDefaultEncodingTarget; previewToken: string; expiresAt: string; ddlHash: string;
  sql: string; before: TableEncodingPair; after: TableEncodingPair; warnings: string[]; requiredAcknowledgements: string[];
}
export interface TableDefaultEncodingApplyOutput {
  ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean; warnings: string[];
  after?: { current: TableEncodingPair; ddlHash: string }; verificationError?: string;
}
/** 名称最终必须精确匹配真实候选；此处只做共享词法与长度边界，绝不猜服务器默认。 */
export function validateTableEncodingPair(value: TableEncodingPair): TableEncodingPair {
  if (!value || typeof value.charset !== 'string' || typeof value.collation !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(value.charset) || !/^[A-Za-z0-9_]{1,255}$/.test(value.collation)) throw new Error('必须选择真实候选中的字符集和排序规则');
  return { charset: value.charset, collation: value.collation };
}
/** 精确比较，不把utf8别名、大小写或不同排序规则在客户端猜成同一值。 */
export function sameTableEncodingPair(a: TableEncodingPair, b: TableEncodingPair): boolean { return a.charset === b.charset && a.collation === b.collation; }
