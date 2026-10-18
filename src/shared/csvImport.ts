/** CSV 导入仅开放这三个单字符分隔符；省略参数时保持历史逗号行为。 */
export const csvImportDelimiters = [',', ';', '\t'] as const;
export type CsvImportDelimiter = typeof csvImportDelimiters[number];

/** 流式读取器也校验配置，避免内部调用绕过 IPC 后静默采用其他解析规则。 */
export function csvImportDelimiter(format: string, delimiter?: CsvImportDelimiter): CsvImportDelimiter {
  if (delimiter !== undefined && (format !== 'csv' || !csvImportDelimiters.includes(delimiter))) throw new Error('CSV 分隔符仅支持逗号、分号或 Tab，且只适用于 CSV 导入');
  return delimiter ?? ',';
}
