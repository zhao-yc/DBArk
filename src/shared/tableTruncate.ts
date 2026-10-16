import type { TableColumnApplyProgress, TableColumnPatchTarget } from './tableColumnPatches';

export const tableTruncateAcknowledgements = ['truncate-all-data', 'truncate-reset-auto-increment', 'external-ddl-window'] as const;
export type TableTruncateTarget = TableColumnPatchTarget;
export type TableTruncateProgress = TableColumnApplyProgress;
export interface TableTruncateGetInput extends TableTruncateTarget { taskId: string; }
export interface TableTruncatePreviewInput { snapshotId: string; taskId: string; }
export interface TableTruncateApplyInput { previewToken: string; confirmation: string; acknowledgements: string[]; taskId: string; }
export interface TableTruncateReleaseInput { snapshotId?: string; previewToken?: string; }
export interface TableTruncateGetOutput {
  target: TableTruncateTarget; snapshotId: string; expiresAt: string; ddlHash: string;
  writable: boolean; reasons: string[]; warnings: string[]; serverVersion: string; engine: string; autoIncrement: string | null;
}
export interface TableTruncatePreviewOutput {
  target: TableTruncateTarget; previewToken: string; expiresAt: string; ddlHash: string; sql: string;
  requiredAcknowledgements: string[]; warnings: string[];
}
export interface TableTruncateApplyOutput {
  ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean; warnings: string[];
  /** 只读后核观察，不是删除行数或持续空表保证。 */
  after?: { ddlHash: string; emptyObserved: boolean; autoIncrement: string | null }; verificationError?: string;
}

/** 首片只开放ASCII表身份；确认文本不trim、不折叠大小写，不解析回目标。 */
export function tableTruncateConfirmation(target: Pick<TableTruncateTarget, 'database' | 'table'>): string { return `${target.database}.${target.table}`; }
/** 只允许完整固定风险集，不能凭未知、重复或额外确认项授权。 */
export function tableTruncateAcksComplete(required: readonly string[], selected: readonly string[]): boolean {
  return required.length === tableTruncateAcknowledgements.length && selected.length === required.length && new Set(required).size === required.length && new Set(selected).size === selected.length && tableTruncateAcknowledgements.every(id => required.includes(id) && selected.includes(id));
}
