/** CSV 导出仅开放三个单字符；省略参数与显式逗号保持原输出字节。 */
export const csvExportDelimiters = [',', ';', '\t'] as const;
export type CsvExportDelimiter = typeof csvExportDelimiters[number];

/** 在文件创建和读取表数据前校验，不让内部调用绕过IPC后扩展解析规则。 */
export function csvExportDelimiter(format: string, delimiter?: CsvExportDelimiter): CsvExportDelimiter {
  if (delimiter !== undefined && (format !== 'csv' || !csvExportDelimiters.includes(delimiter))) throw new Error('分隔符仅适用于CSV导出，且必须为逗号、分号或Tab');
  return delimiter ?? ',';
}

/** 旧默认调用不新增字段；其他格式从不夹带隐藏的CSV状态。 */
export function csvExportOptions(format: string, delimiter: CsvExportDelimiter): { csvDelimiter?: CsvExportDelimiter } {
  return format === 'csv' && delimiter !== ',' ? { csvDelimiter: delimiter } : {};
}
