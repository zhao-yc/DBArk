import type { CellValue } from '../shared/contracts';
import { queryStreamExportLimits as limits } from '../shared/queryStreamExport';
import { txtExportOptionsSchema, txtExportZh as text } from '../shared/txtExport';
import { txtQualifier, txtRecordDelimiters } from '../shared/txtImport';
import { delimitedCellText } from './files';

/** 只在原文件任务的临时文件中输出有界行，配置与 TXT 导入使用同一分隔语法。 */
export function txtWriter(options: unknown) {
  const parsed = txtExportOptionsSchema.safeParse(options);
  if (!parsed.success) throw Error(text.invalid);
  const { delimiter, quote, recordDelimiter, hasHeader } = parsed.data;
  const end = txtRecordDelimiters[recordDelimiter], qualifier = txtQualifier(quote), delimiterBytes = Buffer.byteLength(delimiter);
  // 只有分隔符首尾重叠时，字段末尾才可能与下一个分隔符拼出提前的边界。
  const prefixes = Array.from({ length: delimiter.length - 1 }, (_value, index) => index + 1)
    .filter(offset => delimiter.startsWith(delimiter.slice(offset))).map(offset => delimiter.slice(0, offset));
  let columns = 0;

  function row(values: readonly string[]): string {
    let size = end.length;
    const fields = values.map((value, index) => {
      if (/[\ud800-\udfff]/u.test(value)) throw Error(text.invalidValue);
      const bytes = Buffer.byteLength(value);
      if (bytes > limits.fieldBytes) throw Error(text.field);
      // 多字符分隔符可能从字段尾部跨入真正的分隔符，必须先引用该字段。
      const quoted = /[\r\n]/.test(value) || value.startsWith('\uFEFF') || value.includes(delimiter) ||
        index < values.length - 1 && prefixes.some(prefix => value.endsWith(prefix));
      let encoded = value;
      if (quoted || qualifier && (!value.length || value.includes(qualifier))) {
        if (!qualifier) throw Error(text.needsQuote);
        let escapedBytes = bytes + 2;
        encoded = qualifier + value.replaceAll(qualifier, () => {
          if (++escapedBytes > limits.fieldBytes) throw Error(text.field);
          return qualifier + qualifier;
        }) + qualifier;
        if (escapedBytes > limits.fieldBytes) throw Error(text.field);
      }
      size += Buffer.byteLength(encoded) + (index ? delimiterBytes : 0);
      if (size > limits.rowBytes) throw Error(text.row);
      return encoded;
    });
    return fields.join(delimiter) + end;
  }

  return {
    documentStart: () => '', documentEnd: '', tableEnd: () => '', receipt: () => '',
    tableStart(names: readonly string[]) {
      columns = names.length;
      if (!hasHeader) return '';
      if (!columns || names.some(name => !name) || new Set(names).size !== columns) throw Error(text.header);
      return row(names);
    },
    row(values: readonly CellValue[]) {
      if (!columns || values.length !== columns) throw Error(text.invalidValue);
      return row(values.map(value => {
        if (value === undefined || typeof value === 'number' && !Number.isFinite(value)) throw Error(text.invalidValue);
        if (value && typeof value === 'object') {
          if (value.type !== 'binary' || typeof value.base64 !== 'string') throw Error(text.invalidValue);
          if (value.base64.length > limits.fieldBytes) throw Error(text.field);
          if (Buffer.from(value.base64, 'base64').toString('base64') !== value.base64) throw Error(text.invalidValue);
        }
        return Object.is(value, -0) ? '-0' : delimitedCellText(value);
      }));
    },
  };
}
