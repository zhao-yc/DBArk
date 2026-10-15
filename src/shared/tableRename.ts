import type { TableColumnApplyProgress, TableColumnPatchTarget } from './tableColumnPatches';
import type { TableCommentGetOutput } from './tableComment';

export type TableRenameTarget = TableColumnPatchTarget;
export type TableRenameProgress = TableColumnApplyProgress;
export const tableRenameAcknowledgements = ['ddl-implicit-commit', 'external-ddl-window', 'references-and-grants'] as const;
export interface TableRenameGetInput extends TableRenameTarget { taskId: string; }
export interface TableRenamePreviewInput { snapshotId: string; newName: string; taskId: string; }
export interface TableRenameApplyInput { previewToken: string; acknowledgements: string[]; taskId: string; }
export interface TableRenameReleaseInput { snapshotId?: string; previewToken?: string; }
export interface TableRenameGetOutput extends Omit<TableCommentGetOutput, 'comment' | 'budget'> { tableId?: string; }
export interface TableRenamePreviewOutput {
  target: TableRenameTarget; previewToken: string; expiresAt: string; ddlHash: string;
  sql: string; before: string; after: string; warnings: string[]; requiredAcknowledgements: string[];
}
export interface TableRenameApplyOutput {
  target: TableRenameTarget; newTarget: TableRenameTarget;
  ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean; warnings: string[];
  after?: { tableId: string; ddlHash: string }; verificationError?: string;
}

/** 首批只接受可直接映射原生目录的ASCII标识符，不修剪、不拆库名、不补后缀。 */
export function validateTableRenameName(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value)) throw new Error('新表名须为1至64个ASCII字母、数字或下划线，首字符不能是数字；不会自动修剪或改名');
  return value;
}
