import type { TableColumnApplyProgress, TableColumnPatchTarget } from './tableColumnPatches';

export const tableDropAcknowledgements = ['drop-structure-data', 'drop-implicit-commit', 'external-ddl-window'] as const;
export type TableDropTarget = TableColumnPatchTarget;
export type TableDropProgress = TableColumnApplyProgress;
export interface TableDropGetInput extends TableDropTarget { taskId: string; }
export interface TableDropPreviewInput { snapshotId: string; taskId: string; }
export interface TableDropApplyInput { previewToken: string; confirmation: string; acknowledgements: string[]; taskId: string; }
export interface TableDropReleaseInput { snapshotId?: string; previewToken?: string; }
export interface TableDropGetOutput {
  target: TableDropTarget; snapshotId: string; expiresAt: string; ddlHash: string;
  writable: boolean; reasons: string[]; warnings: string[]; serverVersion: string; engine: string;
}
export interface TableDropPreviewOutput {
  target: TableDropTarget; previewToken: string; expiresAt: string; ddlHash: string; sql: string;
  requiredAcknowledgements: string[]; warnings: string[];
}
export interface TableDropApplyOutput {
  ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean; warnings: string[];
  /** 后核验只证明本次目录观察中表名及原物理编号均已消失，不保证名称永不被重建。 */
  after?: { targetAbsent: boolean; physicalTableAbsent: boolean }; verificationError?: string;
}

/** 首片只开放ASCII表身份；确认文本不trim、不折叠大小写，不解析回目标。 */
export function tableDropConfirmation(target: Pick<TableDropTarget, 'database' | 'table'>): string { return `${target.database}.${target.table}`; }
/** 只允许完整固定风险集，不能凭未知、重复或额外确认项授权。 */
export function tableDropAcksComplete(required: readonly string[], selected: readonly string[]): boolean {
  return required.length === tableDropAcknowledgements.length && selected.length === required.length && new Set(required).size === required.length && new Set(selected).size === selected.length && tableDropAcknowledgements.every(id => required.includes(id) && selected.includes(id));
}
