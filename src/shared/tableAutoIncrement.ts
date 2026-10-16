import type { TableColumnApplyProgress, TableColumnPatchTarget } from './tableColumnPatches';
import type { TableCommentGetOutput } from './tableComment';

export type TableAutoIncrementTarget = TableColumnPatchTarget;
export type TableAutoIncrementProgress = TableColumnApplyProgress;
export const tableAutoIncrementAcknowledgements = ['ddl-implicit-commit', 'external-ddl-window', 'dml-counter-window'] as const;
export const tableAutoIncrementKnownAcknowledgements = [...tableAutoIncrementAcknowledgements, 'restart-volatile'] as const;
export type TableAutoIncrementCapability = 'mysql8-stats-expiry' | 'mysql57-native-status' | 'mariadb1011-native-status' | 'mariadb114-native-status';
/** 5.7的内存计数需要额外确认；保持MySQL8原来的三项契约。 */
export function tableAutoIncrementRequiredAcknowledgements(capability?: TableAutoIncrementCapability): readonly string[] { return capability === 'mysql57-native-status' ? tableAutoIncrementKnownAcknowledgements : tableAutoIncrementAcknowledgements; }
export interface TableAutoIncrementColumn { name: string; type: string; maximum: string; }
// MariaDB没有super_read_only；只返回实际查询的字段，缺失变量不能伪造为0。
export interface TableAutoIncrementPolicy { sessionIncrement: string; sessionOffset: string; globalIncrement: string; globalOffset: string; lockMode: string; readOnly: string; superReadOnly?: string; innodbReadOnly: string; forceRecovery: string; compressedReadOnly?: string; globalWsrep?: string; sessionWsrep?: string; }
export interface TableAutoIncrementGetInput extends TableAutoIncrementTarget { taskId: string; }
export interface TableAutoIncrementPreviewInput { snapshotId: string; value: string; taskId: string; }
export interface TableAutoIncrementApplyInput { previewToken: string; acknowledgements: string[]; taskId: string; }
export interface TableAutoIncrementReleaseInput { snapshotId?: string; previewToken?: string; }
export interface TableAutoIncrementGetOutput extends Omit<TableCommentGetOutput, 'comment' | 'budget'> { tableId?: string; column?: TableAutoIncrementColumn; policy?: TableAutoIncrementPolicy; capability?: TableAutoIncrementCapability; }
export interface TableAutoIncrementPreviewOutput {
  target: TableAutoIncrementTarget; previewToken: string; expiresAt: string; ddlHash: string;
  sql: string; before: string; after: string; warnings: string[]; requiredAcknowledgements: string[];
}
export interface TableAutoIncrementApplyOutput {
  ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean; structureVerified: boolean;
  requestedValue: string; counterState: 'matched' | 'different' | 'unverified'; warnings: string[];
  after?: { value: string | null; ddlHash: string; tableId?: string }; verificationError?: string;
}

/** 只接受规范正十进制字符串；不经过Number、不修剪、不接受指数/符号/前导零。 */
export function validateTableAutoIncrement(value: unknown, maximum = '18446744073709551615'): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)) throw new Error('下一自增值须为规范正十进制字符串，不能包含空格、符号、指数或前导零');
  if (!/^[1-9][0-9]{0,19}$/.test(maximum) || compareAutoIncrementDecimal(value, maximum) > 0) throw new Error('下一自增值超过实际整数列类型上限');
  return value;
}
/** 等长十进制字典序即数值序，整个计数链不依赖浮点精度。 */
export function compareAutoIncrementDecimal(a: string, b: string): number { return a.length === b.length ? a === b ? 0 : a < b ? -1 : 1 : a.length < b.length ? -1 : 1; }
