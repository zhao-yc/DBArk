import type { TableColumnApplyProgress, TableColumnPatchTarget } from './tableColumnPatches';
import type { TableCopyStructureCounterPlan, TableCopyStructureCounterResult } from './tableCopyStructureCounter';
export type TableCopyStructureTarget = TableColumnPatchTarget;
export type TableCopyStructureProgress = TableColumnApplyProgress;
export const tableCopyStructureAcknowledgements = ['ddl-implicit-commit', 'copy-empty-scope', 'external-ddl-window'] as const;
export const tableCopyStructureKnownAcknowledgements = [...tableCopyStructureAcknowledgements, 'auto-increment-copy'] as const;
/** 自增计划增加专属确认，旧界面不认识该风险时不能执行；参数仍只来自服务端快照。 */
export function tableCopyStructureRequiredAcknowledgements(counter?: TableCopyStructureCounterPlan): readonly string[] { return counter ? tableCopyStructureKnownAcknowledgements : tableCopyStructureAcknowledgements; }
export interface TableCopyStructureGetInput extends TableCopyStructureTarget { taskId: string; }
export interface TableCopyStructureGetOutput { target: TableCopyStructureTarget; snapshotId: string; expiresAt: string; ddlHash: string; sourceDdl: string; tableId?: string; serverVersion: string; writable: boolean; reasons: string[]; warnings: string[]; autoIncrement?: TableCopyStructureCounterPlan; }
export interface TableCopyStructurePreviewInput { snapshotId: string; newName: string; taskId: string; }
export interface TableCopyStructurePreviewOutput { target: TableCopyStructureTarget; newName: string; previewToken: string; expiresAt: string; ddlHash: string; sql: string; warnings: string[]; requiredAcknowledgements: string[]; autoIncrement?: TableCopyStructureCounterPlan; }
export interface TableCopyStructureApplyInput { previewToken: string; confirmation: string; acknowledgements: string[]; taskId: string; }
export interface TableCopyStructureReleaseInput { snapshotId?: string; previewToken?: string; }
export interface TableCopyStructureApplyOutput { target: TableCopyStructureTarget; newTarget: TableCopyStructureTarget; ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean; structureVerified?: boolean; counter?: TableCopyStructureCounterResult; warnings: string[]; after?: { tableId: string; ddlHash: string; autoIncrement?: string | null }; verificationError?: string; }
/** 首片只接受同库ASCII名称，不拆路径、不trim、不自动找空闲后缀。 */
export function validateTableCopyStructureName(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value)) throw Error('新表名须为1～64个ASCII字母、数字或下划线，首字符不能为数字；不会自动修剪或改名'); return value; }
/** 确认只比较精确的新库名.表名，不从确认输入构造SQL。 */
export function tableCopyStructureConfirmation(target: TableCopyStructureTarget, newName: string): string { return target.database + '.' + validateTableCopyStructureName(newName); }
