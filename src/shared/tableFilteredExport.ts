import type { FilterGroup, FilterMode, FilterRule, SortRule } from './contracts';
import type { CsvExportDelimiter } from './csvExport';

export const tableFilteredExportLimits = Object.freeze({ metadataBytes: 2 * 1024 * 1024, sorts: 20 });
/** 只接收已应用的完整表页条件；SQL、凭据、路径和连接修订均由可信进程产生。 */
export interface TableFilteredExportInput {
  connectionId: string; database: string; table: string; taskId: string; fileToken: string;
  metadataKey: string; filters: FilterRule[]; filterMode?: FilterMode; filterGroup?: FilterGroup; sort: SortRule[];
  format: 'csv' | 'json' | 'sql' | 'xlsx'; encoding: 'utf8' | 'utf16le' | 'gb18030'; csvDelimiter?: CsvExportDelimiter;
}
/** 只有原数据库严格收尾及文件原子替换均成功，才能发布完整导出事实。 */
export interface TableFilteredExportOutput { rows: number; fileCommitted: true; }
export const tableFilteredExportText = Object.freeze({
  label: '导出服务器全部筛选行',
  stale: '原文档、连接或表页来源已变化，导出已停止；不会自动重放。',
  metadata: '表页元数据来源无效或超过2MiB，请重新读取当前表页。',
  invalid: '全部筛选行导出参数无效。',
  cancelled: '全部筛选行导出已请求取消，等待原任务和文件资源收尾。',
  committed: '全部筛选行文件已保存；原页面状态随后变化，请核对所选文件，不要自动重试。',
  summaryRunning: '正在导出服务器全部筛选行；条件、原值、文件路径和错误原文未保存。',
  summaryCompleted: '服务器全部筛选行导出已完成；条件、原值、文件路径和错误原文未保存。',
  summaryFailed: '服务器全部筛选行导出未正常完成；请在原窗口核对文件状态，条件和错误原文未保存。',
});
