import { z } from 'zod';
import { compatibleTxtQualifier, txtFieldDelimiter, txtTextQualifier } from './txtImport';

export const txtExportOptionsSchema = z.object({
  delimiter: txtFieldDelimiter, quote: txtTextQualifier,
  recordDelimiter: z.enum(['lf', 'crlf', 'cr']), hasHeader: z.boolean(),
}).strict().refine(compatibleTxtQualifier);

export type TxtExportOptions = z.infer<typeof txtExportOptionsSchema>;
export const txtExportDefaults: TxtExportOptions = { delimiter: '\t', quote: 'double', recordDelimiter: 'crlf', hasHeader: true };

export const txtExportZh = {
  format: 'TXT 文本', hasHeader: '写入字段名', outputHeader: 'TXT 标题', outputPosition: 'TXT 列位置',
  hint: '按所选分隔符、换行和文本限定符写入。空文本与 NULL 分开保存。',
  positionHint: '按结果列顺序输出，首行直接写数据。',
  streamHint: 'TXT 仅写入指定行结果集。语句回执仍显示在工作台。',
  invalid: '请核对 TXT 分隔符和文本限定符',
  needsQuote: 'TXT 字段含分隔符或换行，请启用文本限定符',
  field: 'TXT 单个字段超过 8 MiB', row: 'TXT 单行或列头超过 16 MiB',
  invalidValue: 'TXT 导出字段包含无效字符或不支持的值',
  header: 'TXT 列标题必须非空且唯一',
} as const;

export function validTxtExport(input: { format: string; txtOptions?: unknown }): boolean {
  return input.format === 'txt' ? txtExportOptionsSchema.safeParse(input.txtOptions).success : !Object.hasOwn(input, 'txtOptions');
}

export function txtExportOptions(format: string, options: TxtExportOptions): { txtOptions?: TxtExportOptions } {
  return format === 'txt' ? { txtOptions: options } : {};
}
