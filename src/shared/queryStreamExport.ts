import type { CellValue, QueryOutcome, QueryFileEncoding } from './contracts';
import { sqlExecutableWords, type QueryParameter, type SqlLexicalMode } from './queryParameters';

/** 完整流式导出与工作台预览分别限额；文件行不会整批跨 IPC 传输。 */
export const queryStreamExportLimits = {
  sqlBytes: 20 * 1024 * 1024, results: 200, columns: 1024,
  fieldBytes: 8 * 1024 * 1024, rowBytes: 16 * 1024 * 1024,
  queueRows: 8, queueBytes: 1024 * 1024,
  previewRows: 200, previewBytes: 16 * 1024 * 1024,
  fileBytes: 10 * 1024 * 1024 * 1024,
  archiveManifestBytes: 8 * 1024 * 1024,
} as const;
export type QueryExportFormat = 'csv' | 'json' | 'csv-zip';
/** 容器仍是原生保存对话框授权的单个ZIP文件，不能借CSV令牌改写其它类型。 */
export function queryExportFileFormat(format: QueryExportFormat): 'csv' | 'json' | 'zip' { return format === 'csv-zip' ? 'zip' : format; }
/** 所有包内文件名由有界序号生成，SQL、库表及列名都不参与路径。 */
export function queryCsvResultFile(ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > queryStreamExportLimits.results) throw new Error('CSV容器行结果序号必须在1～200之间');
  return `results/rows-${String(ordinal).padStart(3, '0')}.csv`;
}
export type QueryExportProtocol = 'text-strict' | 'binary-explicit';
export type QueryExportSelection = { kind: 'all' } | { kind: 'row-result'; ordinal: number };
export interface QueryStreamExportInput {
  sessionId: string; sql: string; taskId: string; fileToken: string;
  format: QueryExportFormat; encoding: QueryFileEncoding; protocol: QueryExportProtocol;
  resultSelection: QueryExportSelection; parameters?: QueryParameter[];
}
export interface QueryExportColumn { position: number; key: string; name: string; exportName: string; type: string; }
/** 结果序号在协议事件边界固定，异步写入不能借用后来到达的列定义。 */
export type QueryExportFrame =
  | { kind: 'rows-start'; resultOrdinal: number; statementOrdinal: number; rowResultOrdinal: number; columns: QueryExportColumn[] }
  | { kind: 'row'; resultOrdinal: number; values: CellValue[] }
  | { kind: 'rows-end'; resultOrdinal: number; warningCount?: number }
  | { kind: 'status'; resultOrdinal: number; statementOrdinal: number; affectedRows: number; insertId: string; warningCount: number };
export interface QueryExportResultSummary {
  resultOrdinal: number; statementOrdinal: number; kind: 'rows' | 'status'; rowResultOrdinal?: number;
  rowsWritten: number; affectedRows?: number; insertId?: string; warningCount?: number;
}
export interface QueryExportProgress {
  phase: 'preparing' | 'executing' | 'writing' | 'committing';
  statementsCompleted: number; currentResultOrdinal?: number; rowsWritten: number; bytesWritten: number;
  fileCommitted: boolean; sqlMayHaveExecuted: boolean; transactionKnown: boolean; transactionOpen?: boolean;
  /** 待写数据行峰值；单个大行可超过队列软字节阈值，但仍受独立行硬限额约束。 */
  peakBufferedRows?: number; peakBufferedBytes?: number;
}
export interface QueryStreamExportOutput {
  statementsCompleted: number; results: QueryExportResultSummary[]; fileCommitted: true;
  transactionKnown: boolean; transactionOpen?: boolean; preview: QueryOutcome;
}

/** 显式二进制模式仍在发送前选择诊断及控制语句的文本路径，绝不试错准备后重放。 */
export function queryExportWireProtocol(sql: string, protocol: QueryExportProtocol, mode: SqlLexicalMode): 'text' | 'binary' {
  if (protocol === 'text-strict') return 'text';
  if (mode.ansiQuotesKnown === false || mode.noBackslashEscapesKnown === false) {
    // 引号边界相同也可能让诊断标识符在候选模式下变成普通字符串；协议选择同样不能猜。
    const candidates = new Set<string>();
    for (const noBackslashEscapes of mode.noBackslashEscapesKnown === false ? [false, true] : [mode.noBackslashEscapes]) {
      for (const ansiQuotes of mode.ansiQuotesKnown === false ? [false, true] : [mode.ansiQuotes]) candidates.add(queryExportWireProtocol(sql, protocol, { noBackslashEscapes, ansiQuotes }));
    }
    if (candidates.size !== 1) throw new Error('无法确定会话 SQL 引号模式，执行协议的诊断识别存在歧义');
    // 同时要求共享参数词法在所有候选下同意边界，不能只比协议选择结果。
    sqlExecutableWords(sql, mode);
    return [...candidates][0] as 'text' | 'binary';
  }
  const words = sqlExecutableWords(sql, mode);
  const controls = new Set(['SHOW', 'SET', 'USE', 'BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'LOCK', 'UNLOCK', 'PREPARE', 'EXECUTE', 'DEALLOCATE', 'GET', 'XA']);
  if (controls.has(words[0]) || words.some(word => ['WARNING_COUNT', 'ERROR_COUNT', 'ROW_COUNT', 'FOUND_ROWS'].includes(word))) return 'text';
  return 'binary';
}
