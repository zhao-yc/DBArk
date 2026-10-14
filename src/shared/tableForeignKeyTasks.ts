import type { TableColumnApplyProgress, TableColumnPatchTarget } from './tableColumnPatches';
import type { DependencyCoverage } from './tableIndexPatches';
import type { ForeignKeyAction, ForeignKeyDefinition, ForeignKeyPatch } from './tableForeignKeyPatches';
import type { TableIndexColumnView } from './tableIndexTasks';

export const foreignKeyAcknowledgementIds = ['ddl-implicit-commit', 'external-ddl-window', 'drop-foreign-key', 'referential-action-change'] as const;
export const foreignKeyTaskLimits = { extraParents: 16, tables: 32 } as const;
export type TableForeignKeyTarget = TableColumnPatchTarget;
export type ForeignKeyTableTarget = Pick<TableColumnPatchTarget, 'database' | 'table'>;
/** 独立事件属性使用相同进度语义，不能与字段或索引编辑任务串线。 */
export type TableForeignKeyApplyProgress = TableColumnApplyProgress;
export interface TableForeignKeyGetInput extends TableForeignKeyTarget {
  taskId: string;
  /** 仅显式加载额外候选父表；既有关系的父表从服务器定义读取。 */
  parentTargets?: ForeignKeyTableTarget[];
}
export interface TableForeignKeyPreviewInput { snapshotId: string; patches: ForeignKeyPatch[]; taskId: string; }
export interface TableForeignKeyApplyInput { previewToken: string; acknowledgements: string[]; taskId: string; }
export interface TableForeignKeyReleaseInput { snapshotId?: string; previewToken?: string; }
export interface TableForeignKeyView {
  foreignKeyRef: string; name: string; rawSql: string;
  editableDefinition?: ForeignKeyDefinition;
  childColumnNames: string[]; parentColumnNames: string[]; parentTarget?: ForeignKeyTableTarget;
  onUpdate?: ForeignKeyAction; onDelete?: ForeignKeyAction;
  unsupportedReasons: string[];
  /** 仅是可信快照的展示投影；执行时必须重新计划，不信任界面回传。 */
  access: { drop: { allowed: boolean; reasons: string[] }; replace: { allowed: boolean; reasons: string[] } };
}
export interface TableForeignKeyParentView {
  parentRef: string; target: ForeignKeyTableTarget; columns: TableIndexColumnView[];
  keys: { name: string; kind: 'primary' | 'unique'; columnRefs: string[] }[];
}
export interface TableForeignKeyGetOutput {
  target: TableForeignKeyTarget; snapshotId: string; expiresAt: string; ddlHash: string;
  columns: TableIndexColumnView[]; parents: TableForeignKeyParentView[]; foreignKeys: TableForeignKeyView[];
  writable: boolean; incomingCoverage: DependencyCoverage;
  namespaceCoverage: 'complete' | 'partial'; warnings: string[];
  capabilities?: { dialect: 'mysql' | 'mariadb'; serverVersion: string; defaultAction: ForeignKeyAction };
}
export interface TableForeignKeyPreviewOutput {
  target: TableForeignKeyTarget; previewToken: string; expiresAt: string; ddlHash: string; sql: string;
  changes: { foreignKeyRef?: string; clientKey?: string; description: string }[];
  warnings: string[]; requiredAcknowledgements: string[]; concurrencyPolicy: 'recheck-before-ddl';
}
export interface TableForeignKeyApplyOutput {
  ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean; warnings: string[];
  after?: { ddlHash: string; foreignKeys: TableForeignKeyView[] }; verificationError?: string;
}
