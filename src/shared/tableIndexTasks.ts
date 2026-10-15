import type { IndexPatch, TableIndexView, IndexPlanOptions, TrustedIndexColumn, DependencyCoverage } from './tableIndexPatches';
import type { TableColumnApplyProgress, TableColumnPatchTarget } from './tableColumnPatches';

export const indexAcknowledgementIds = ['ddl-implicit-commit', 'external-ddl-window', 'drop-unique-constraint', 'primary-key-change', 'special-index-change'] as const;

export type TableIndexPatchTarget = TableColumnPatchTarget;
/** 进度形状与字段任务一致，但事件使用独立 indexPatch 属性，不能混淆两种任务。 */
export type TableIndexApplyProgress = TableColumnApplyProgress;
export interface TableIndexGetInput extends TableIndexPatchTarget { taskId: string; }
export interface TableIndexPreviewInput { snapshotId: string; patches: IndexPatch[]; taskId: string; }
export interface TableIndexApplyInput { previewToken: string; acknowledgements: string[]; taskId: string; }
export interface TableIndexReleaseInput { snapshotId?: string; previewToken?: string; }
export interface TableIndexColumnView {
  columnRef: string; name: string; typeSql: string; nullable: boolean;
  generated: boolean; hidden: boolean; prefix: TrustedIndexColumn['prefix'];
  /** 明确可用于受控键的能力投影，不提供时不能用默认类型猜一个可写字段。 */
  fullKeyBytes?: number;
  charset?: string; collation?: string; specialIndexes?: TrustedIndexColumn['specialIndexes'];
}
export interface TableIndexGetOutput {
  target: TableIndexPatchTarget; snapshotId: string; expiresAt: string; ddlHash: string;
  columns: TableIndexColumnView[]; indexes: TableIndexView[]; warnings: string[];
  writable: boolean;
  capabilities?: IndexPlanOptions['capabilities'] & { dialect: 'mysql' | 'mariadb'; serverVersion: string };
  incomingCoverage: DependencyCoverage;
}
export interface TableIndexPreviewOutput {
  target: TableIndexPatchTarget; previewToken: string; expiresAt: string; ddlHash: string;
  sql: string; changes: { indexRef?: string; clientKey?: string; description: string }[];
  warnings: string[]; requiredAcknowledgements: string[]; concurrencyPolicy: 'recheck-before-ddl';
}
export interface TableIndexApplyOutput {
  ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean; warnings: string[];
  after?: { ddlHash: string; indexes: TableIndexView[] }; verificationError?: string;
}
