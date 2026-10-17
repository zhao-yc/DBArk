import type { TableColumnApplyProgress, TableColumnPatchTarget } from './tableColumnPatches';
export type TableCopyDataTarget = TableColumnPatchTarget;
export const tableCopyDataMode = 'structure-and-data' as const;
export const tableCopyDataAcknowledgements = ['ddl-and-data-separate', 'copy-data-scope', 'external-ddl-window', 'execution-snapshot', 'retain-unknown'] as const;
export interface TableCopyDataProgress extends TableColumnApplyProgress {
  dataSubmitted?: boolean; insertCompleted?: boolean; commitSubmitted?: boolean; dataCompleted?: boolean; affectedRows?: string;
}
export interface TableCopyDataGetInput extends TableCopyDataTarget { taskId: string; mode: typeof tableCopyDataMode; }
export interface TableCopyDataGetOutput { mode: typeof tableCopyDataMode; target: TableCopyDataTarget; snapshotId: string; expiresAt: string; ddlHash: string; sourceDdl: string; tableId?: string; serverVersion: string; writable: boolean; reasons: string[]; warnings: string[]; }
export interface TableCopyDataPreviewInput { snapshotId: string; newName: string; taskId: string; mode: typeof tableCopyDataMode; }
export interface TableCopyDataPreviewOutput { mode: typeof tableCopyDataMode; target: TableCopyDataTarget; newName: string; previewToken: string; expiresAt: string; ddlHash: string; sql: string; warnings: string[]; requiredAcknowledgements: string[]; }
export interface TableCopyDataApplyInput { previewToken: string; confirmation: string; acknowledgements: string[]; taskId: string; mode: typeof tableCopyDataMode; }
export interface TableCopyDataReleaseInput { snapshotId?: string; previewToken?: string; }
export interface TableCopyDataApplyOutput { mode: typeof tableCopyDataMode; target: TableCopyDataTarget; newTarget: TableCopyDataTarget; ddlSubmitted: true; ddlCompleted: true; dataSubmitted: true; insertCompleted: true; commitSubmitted: true; dataCompleted: true; definitionVerified: boolean; affectedRows?: string; warnings: string[]; }
export { validateTableCopyStructureName as validateTableCopyDataName, tableCopyStructureConfirmation as tableCopyDataConfirmation } from './tableCopyStructure';
/** 固定用途的五项确认，不能借用空表确认或由客户端删减。 */
export function tableCopyDataRequiredAcknowledgements(): readonly string[] { return tableCopyDataAcknowledgements; }
