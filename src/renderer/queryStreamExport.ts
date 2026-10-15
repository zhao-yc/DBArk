import type { QueryExportSelection, QueryExportFormat } from '../shared/queryStreamExport';
import { queryStreamZh } from './locales/queryStreamExport.zh-CN';

/** CSV 使用行结果序号，而不是包含写入状态的协议结果序号。 */
export function streamResultSelection(format: QueryExportFormat, ordinal: string): QueryExportSelection {
  if (format !== 'csv') return { kind: 'all' };
  if (!/^[1-9]\d*$/.test(ordinal) || Number(ordinal) > 200) throw new Error(queryStreamZh.ordinalInvalid);
  return { kind: 'row-result', ordinal: Number(ordinal) };
}

/** 设置变化使确认失效；每次失败后的执行必须重新取得明确确认。 */
export function streamExecutionAllowed(fileToken: string | undefined, acknowledged: boolean, protocol: 'text-strict' | 'binary-explicit', binaryAcknowledged: boolean, busy: boolean, completed: boolean) {
  return !!fileToken && acknowledged && (protocol !== 'binary-explicit' || binaryAcknowledged) && !busy && !completed;
}
