/** CSV 导入仅开放这三个单字符分隔符；省略参数时保持历史逗号行为。 */
export const csvImportDelimiters = [',', ';', '\t'] as const;
export type CsvImportDelimiter = typeof csvImportDelimiters[number];

/** 流式读取器也校验配置，避免内部调用绕过 IPC 后静默采用其他解析规则。 */
export function csvImportDelimiter(format: string, delimiter?: CsvImportDelimiter): CsvImportDelimiter {
  if (delimiter !== undefined && (format !== 'csv' || !csvImportDelimiters.includes(delimiter))) throw new Error('CSV 分隔符仅支持逗号、分号或 Tab，且只适用于 CSV 导入');
  return delimiter ?? ',';
}

/** 标题选项仅适用于 CSV；省略时保留历史首行为标题的行为。 */
export function csvImportHasHeader(format: string, hasHeader?: boolean): boolean {
  if (hasHeader !== undefined && (format !== 'csv' || typeof hasHeader !== 'boolean')) throw new Error('首行为标题选项必须为布尔值，且只适用于 CSV 导入');
  return hasHeader ?? true;
}

/** 无标题文件按位置建立稳定源键，首条数据的空值或重复值不会影响映射。 */
export function csvImportColumnName(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index >= Number.MAX_SAFE_INTEGER) throw new Error('CSV 列序号必须为可安全编号的非负整数');
  return `第${index + 1}列`;
}
