import type { TableColumnApplyProgress } from './tableColumnPatches';
import { sameTableEncodingPair, validateTableEncodingPair, type TableEncodingPair } from './tableDefaultEncoding';

export const databaseCreateAcknowledgements = ['ddl-implicit-commit', 'create-database'] as const;
export interface DatabaseCreateTarget { connectionId: string; }
export interface DatabaseCreateGetInput extends DatabaseCreateTarget { taskId: string; }
export interface DatabaseCreateGetOutput {
  target: DatabaseCreateTarget; snapshotId: string; expiresAt: string; catalogDigest: string;
  candidates: TableEncodingPair[]; writable: boolean; reasons: string[]; warnings: string[]; serverVersion: string;
}
export interface DatabaseCreatePreviewInput extends TableEncodingPair { snapshotId: string; name: string; taskId: string; }
export interface DatabaseCreatePreviewOutput {
  target: DatabaseCreateTarget; name: string; selection: TableEncodingPair; previewToken: string; expiresAt: string; catalogDigest: string;
  sql: string; warnings: string[]; requiredAcknowledgements: string[];
}
export interface DatabaseCreateApplyInput { previewToken: string; confirmation: string; acknowledgements: string[]; taskId: string; }
export interface DatabaseCreateApplyOutput { name: string; ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean; warnings: string[]; }
export interface DatabaseCreateReleaseInput { snapshotId?: string; previewToken?: string; }
export type DatabaseCreateProgress = TableColumnApplyProgress;

/** 数据库名按首批可证明的BMP范围引用；拒绝路径、系统库和会被服务器截短的名称，不自动trim。 */
export function validateDatabaseCreateName(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 64 || /[\u0000-\u001f\u007f.\\/\ud800-\udfff]/.test(value) || /\s$/u.test(value) || /^#mysql50#/i.test(value) || ['mysql', 'information_schema', 'performance_schema', 'sys'].includes(value.toLowerCase())) throw Error('数据库名须为1～64个BMP字符，不能含路径、控制字符、尾空白或系统库名');
  return value;
}
/** 只有完整实际目录中精确存在且唯一的配对可生成创建SQL，不猜utf8别名或排序规则。 */
export function databaseCreateSelection(selection: TableEncodingPair, candidates: readonly TableEncodingPair[]): TableEncodingPair {
  const pair = validateTableEncodingPair(selection);
  if (candidates.filter(candidate => sameTableEncodingPair(pair, candidate)).length !== 1) throw Error('编码配对不属于当前实际目录，请重新读取');
  return pair;
}
