export const csvExportFieldLimits = { columns: 4096, catalogBytes: 2 * 1024 * 1024, ddlBytes: 4 * 1024 * 1024 } as const;
export interface CsvExportTarget { connectionId: string; database: string; table: string; }
export interface CsvExportFieldsInput extends CsvExportTarget { taskId: string; }
export interface CsvExportFieldsOutput { target: CsvExportTarget; catalogId: string; expiresAt: string; columns: { name: string; type: string }[]; }
export interface CsvExportSelection { catalogId: string; columns: string[]; }
/** 名称只按真实目录精确匹配，不截短、trim或按显示名猜测；保留原型敏感和特殊字符。 */
export function validateCsvExportColumnNames(input: unknown): string[] {
  if (!Array.isArray(input) || !input.length || input.length > csvExportFieldLimits.columns || input.some(value => typeof value !== 'string' || !value || value.length > 64 || value.includes('\0')) || new Set(input).size !== input.length) throw Error('CSV字段必须为非空、无重复且未超预算的实际字段列表');
  return input.slice();
}
/** 目标元组逐字绑定；大小写、连接和带分隔符的名称都不能碰撞。 */
export function csvExportTargetKey(target: CsvExportTarget): string { return JSON.stringify([target.connectionId, target.database, target.table]); }
