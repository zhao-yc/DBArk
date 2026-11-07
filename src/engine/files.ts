import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { parse } from 'csv-parse';
import iconv from 'iconv-lite';
import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray';
import type { CellValue, DataRow } from '../shared/contracts';
import { serializeCell } from './sql';
import { csvImportColumnName, csvImportDelimiter, csvImportHasHeader, type CsvImportDelimiter } from '../shared/csvImport';
import type { CsvExportDelimiter } from '../shared/csvExport';
import { validXmlImport, xmlImportZh, type RecordImportFormat, type XmlImportOptions } from '../shared/xmlImport';
import { readXmlRecords, type XmlImportReadControl } from './xmlImport';
import { txtFixedWidths, txtImportOptionsSchema, txtImportZh, txtQualifier, txtRecordDelimiters, validTxtImport, type TxtImportOptions } from '../shared/txtImport';
import { excelImportZh, validExcelImport, type ExcelImportOptions } from '../shared/excelTransfer';
import { readExcelRows } from './excelFiles';
import { encodingName } from './fileEncoding';

export { encodingName } from './fileEncoding';

/** 保存 JSON 数字的原始 token，避免经过 JavaScript 浮点数再序列化。 */
class JsonNumber {
  /** 只记录解析器已验证的数值文本，不自行解析为 number。 */
  constructor(readonly value: string) {}
}
const jsonKeyPrefix = '\u0000dbark:';

/** 第三方组装器使用普通对象，先编码键名再安全恢复，保留 __proto__ 等合法字段。 */
function restoreKeys(value: unknown): unknown {
  if (value instanceof JsonNumber) return value;
  if (Array.isArray(value)) return value.map(restoreKeys);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key.slice(jsonKeyPrefix.length), restoreKeys(child)]));
  return value;
}

/** 嵌套 JSON 使用原始数字 token 重建，不能把大整数改成 JSON 字符串。 */
function preciseJson(value: unknown): string {
  if (value instanceof JsonNumber) return value.value;
  if (Array.isArray(value)) return '[' + value.map(preciseJson).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).map(([key, child]) => JSON.stringify(key) + ':' + preciseJson(child)).join(',') + '}';
  return JSON.stringify(value);
}

/** CSV 中 \\N 表示 NULL，反斜线开头的文本以额外反斜线转义，保持往返无歧义。 */
export function csvCell(value: CellValue, delimiter: CsvExportDelimiter = ','): string {
  return csvHeader(delimitedCellText(value), delimiter);
}

/** CSV 与 TXT 共用可逆的 NULL、二进制和前导反斜线表示。 */
export function delimitedCellText(value: CellValue): string {
  const text = value === null ? '\\N' : typeof value === 'object' ? 'base64:' + value.base64 : String(value);
  return value !== null && text.startsWith('\\') ? '\\' + text : text;
}
/** 标题行只执行 CSV 引号处理，不采用数据字段的 NULL/反斜线协议。 */
export function csvHeader(name: string, delimiter: CsvExportDelimiter = ','): string { return !name.length || /["\r\n]/.test(name) || name.includes(delimiter) ? '"' + name.replaceAll('"', '""') + '"' : name; }
/** 还原 CSV 的 NULL 与首部反斜线协议，空字符串保持为空字符串。 */
export function csvValue(value: string): CellValue {
  if (value === '\\N') return null;
  return value.startsWith('\\\\') ? value.slice(1) : value;
}

/** 在同一条流上解析记录及校验原始字节，JSON 数字保留原始字符串。 */
export async function* readRecords(filePath: string, format: RecordImportFormat, encoding: string, delimiter?: CsvImportDelimiter, hasHeader?: boolean, control?: XmlImportReadControl & { xmlOptions?: XmlImportOptions; txtOptions?: TxtImportOptions; excelOptions?: ExcelImportOptions; checkCancelled?: () => void }): AsyncGenerator<DataRow> {
  const selectedDelimiter = csvImportDelimiter(format, delimiter);
  const selectedHasHeader = csvImportHasHeader(format, hasHeader);
  // 所有配置先校验，错误选项不能触发文件打开或遗留尚未接入 pipeline 的句柄。
  const selectedEncoding = encodingName(encoding);
  if (!validXmlImport({ ...control, format, encoding })) throw Error(xmlImportZh.invalid);
  if (!validTxtImport({ ...control, format })) throw Error(txtImportZh.invalid);
  if (!validExcelImport({ ...control, format, encoding })) throw Error(excelImportZh.missing);
  if (format === 'xlsx') {
    yield* readExcelRows({ ...control!.excelOptions!, filePath, onColumns: control?.onColumns, onBytes: control?.onBytes,
      checkCancelled: () => { control?.signal?.throwIfAborted(); control?.checkCancelled?.(); } });
    return;
  }
  if (format === 'xml') {
    yield* readXmlRecords(filePath, control!.xmlOptions!, control);
    return;
  }
  const txt = format === 'txt' ? txtImportOptionsSchema.parse(control?.txtOptions) : undefined;
  const fixed = txt?.mode === 'fixed' ? txt : undefined;
  const widths = fixed ? txtFixedWidths(fixed.widths) : undefined;
  const width = widths?.reduce((total, value) => total + value, 0) ?? 0;
  const delimited = format === 'csv' || format === 'txt';
  const header = txt?.hasHeader ?? selectedHasHeader;
  const quote = txt?.mode === 'delimited' && (txtQualifier(txt.quote) || false);
  const strictText = txt ? new TextDecoder(selectedEncoding === 'utf16le' ? 'utf-16le' : selectedEncoding, { fatal: true }) : undefined;
  control?.signal?.throwIfAborted();
  const source = createReadStream(filePath);
  // 原始字节观察器置于同一条背压链中，摘要不能另开文件或忽略观察器失败。
  const observed = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    try { strictText?.decode(chunk, { stream: true }); control?.onBytes?.(chunk); callback(null, chunk); } catch (error) { callback(error as Error); }
  }, flush(callback) { try { strictText?.decode(); callback(); } catch (error) { callback(error as Error); } } });
  // iconv的GB18030解码缓冲按本次write字节数分配；跨write补完四字节字符时可能不足以输出代理对。
  // 按原编码语法只保留末尾未完整的1..3字节，让每次write从完整序列边界开始，不改变原iconv映射。
  let pendingGbBytes = Buffer.alloc(0);
  const gbFrames = selectedEncoding === 'gb18030' ? new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const bytes = pendingGbBytes.length ? Buffer.concat([pendingGbBytes, chunk]) : chunk; let end = 0;
      while (end < bytes.length) {
        const first = bytes[end];
        if (first < 0x81 || first > 0xfe) { end++; continue; }
        if (end + 1 === bytes.length) break;
        const second = bytes[end + 1];
        if (second >= 0x30 && second <= 0x39) {
          if (end + 2 === bytes.length) break;
          const third = bytes[end + 2];
          if (third >= 0x81 && third <= 0xfe) {
            if (end + 3 === bytes.length) break;
            const fourth = bytes[end + 3];
            if (fourth >= 0x30 && fourth <= 0x39) { end += 4; continue; }
          }
        } else if (second >= 0x40 && second <= 0xfe && second !== 0x7f) { end += 2; continue; }
        // 非法序列由原iconv处理：先跳过起始字节，再从下一字节重新扫描，不能吞掉后续合法字符。
        end++;
      }
      pendingGbBytes = Buffer.from(bytes.subarray(end)); callback(null, bytes.subarray(0, end));
    },
    // EOF不完整尾仍原样交给iconv及其end容错；严格校验另由raw观察链拒绝，不在这里改写字节。
    flush(callback) { const tail = pendingGbBytes; pendingGbBytes = Buffer.alloc(0); callback(null, tail); },
  }) : undefined;
  const decoder = iconv.decodeStream(selectedEncoding) as Transform;
  // iconv可能将合法非BMP字符拆成两个UTF16代理项string；不能让下游逐chunk转UTF8时各自替换。
  // 仅暂存末尾一个高代理项，和下一块拼接后再编码，背压及原始字节观察链仍沿同一pipeline。
  let pendingHighSurrogate = '';
  const codepoints = new Transform({ writableObjectMode: true, decodeStrings: false,
    transform(chunk: string, _encoding, callback) {
      if (typeof chunk !== 'string') { callback(new Error('导入解码流未返回文本')); return; }
      let text = pendingHighSurrogate + chunk; pendingHighSurrogate = '';
      const last = text.charCodeAt(text.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) { pendingHighSurrogate = text.slice(-1); text = text.slice(0, -1); }
      callback(null, Buffer.from(text, 'utf8'));
    },
    // 默认容错读取的孤立代理项仍由UTF8编码转换为U+FFFD；严格模式另在原字节链拒绝非法编码。
    flush(callback) { const tail = pendingHighSurrogate; pendingHighSurrogate = ''; callback(null, Buffer.from(tail, 'utf8')); },
  });
  const numberTokens = new Transform({ objectMode: true,
    /** 将数字 token 转为带标记的原始文本，同时保护合法原型同名键。 */
    transform(token, _encoding, callback) {
    // Assembler 会保留 stringValue 的对象值；独立类区分真实文字字符串与数字 token。
    callback(null, token.name === 'numberValue' ? { name: 'stringValue', value: new JsonNumber(token.value) } : token.name === 'keyValue' ? { ...token, value: jsonKeyPrefix + token.value } : token);
  } });
  const output = delimited
    ? parse({ columns: false, delimiter: txt?.mode === 'delimited' ? txt.delimiter : fixed ? '\0' : selectedDelimiter,
      ...(txt ? { quote, escape: quote,
        ...(txt.recordDelimiter === 'auto' ? {} : { record_delimiter: txtRecordDelimiters[txt.recordDelimiter] }) } : {}),
      bom: true, skip_empty_lines: !txt && selectedHasHeader, max_record_size: fixed ? width * 4 : 64 * 1024 * 1024 })
    : streamArray({ highWaterMark: 16 });
  const options = { signal: control?.signal };
  const decoding = [source, observed, ...(gbFrames ? [gbFrames] : []), decoder, codepoints];
  const completed = delimited ? pipeline([...decoding, output], options) : pipeline([...decoding, parser(), numberTokens, output], options);
  // 避免迭代器尚未挂接时上游读取错误成为未处理的 Promise rejection。
  void completed.catch(() => undefined);
  let finished = false;
  let headers: string[] | undefined;
  try {
    for await (const item of output) {
      let values = item as string[];
      if (fixed && widths) {
        // 先限制 UTF-16 长度，随后按码点切列，非 BMP 字符只占一个位置。
        if (values.length !== 1 || values[0].length > width * 2) throw Error(txtImportZh.invalidWidth);
        const characters = [...values[0]];
        if (characters.length !== width) throw Error(txtImportZh.invalidWidth);
        let offset = 0;
        values = widths.map(size => {
          const value = characters.slice(offset, offset += size).join('');
          return fixed.trimPadding ? value.replace(/^ +| +$/g, '') : value;
        });
      }
      if (delimited && !headers) {
        if (header) {
          headers = values.map(String);
          if (new Set(headers).size !== headers.length || headers.some(name => !name.length)) throw new Error(`${format.toUpperCase()} 标题不能包含重复或空字段名`);
          // 原标题一经校验即报告，即使没有数据行也能保留完整源列；副本不能反向修改解析器。
          control?.onColumns?.([...headers]);
          continue;
        }
        // 首条数组同时确定列数并作为数据产出，不把重复值、空串或原型同名文字当标题。
        headers = values.map((_value, index) => csvImportColumnName(index));
        control?.onColumns?.([...headers]);
      }
      if (delimited && values.length !== headers!.length) throw new Error(`${format.toUpperCase()} 每行列数必须与首行一致`);
      const record = delimited ? Object.fromEntries(headers!.map((name, index) => [name, values[index]])) : restoreKeys(item.value);
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('导入文件每行必须是字段到值的对象');
      const row: DataRow = Object.create(null) as DataRow;
      for (const [key, value] of Object.entries(record)) {
        if (delimited) row[key] = csvValue(String(value));
        else if (value instanceof JsonNumber) row[key] = value.value;
        else if (value && typeof value === 'object' && !Array.isArray(value) && (value as { type?: string }).type === 'binary' && typeof (value as { base64?: string }).base64 === 'string') row[key] = value as CellValue;
        else if (value !== null && typeof value === 'object') row[key] = preciseJson(value);
        else row[key] = serializeCell(value);
      }
      yield row;
    }
    await completed;
    finished = true;
  } finally {
    source.destroy(); observed.destroy(); gbFrames?.destroy(); decoder.destroy(); codepoints.destroy(); numberTokens.destroy(); output.destroy();
    if (!finished) await completed.catch(() => undefined);
  }
}

/** SQL 文件按编码流式解码，文件大小不影响常驻内存。 */
export async function* readText(filePath: string, encoding: string): AsyncGenerator<string> {
  const source = createReadStream(filePath);
  const decoded = iconv.decodeStream(encodingName(encoding)) as Transform;
  const completed = pipeline(source, decoded);
  void completed.catch(() => undefined);
  try { for await (const chunk of decoded) yield String(chunk); await completed; }
  finally { source.destroy(); decoded.destroy(); await completed.catch(() => undefined); }
}

/** 样本最多 20 条，XML 与 TXT 继续读完以核对来源结构。 */
export async function previewFile(input: { filePath: string; format: RecordImportFormat; encoding: string; csvDelimiter?: CsvImportDelimiter; csvHasHeader?: boolean; xmlOptions?: XmlImportOptions; txtOptions?: TxtImportOptions; excelOptions?: ExcelImportOptions }): Promise<{ columns: string[]; rows: DataRow[] }> {
  if (Object.hasOwn(input, 'csvHasHeader') && typeof input.csvHasHeader !== 'boolean') throw new Error('首行为标题选项必须为布尔值，且只适用于 CSV 导入');
  const rows: DataRow[] = [], columns = new Set<string>();
  const control = {
    ...(Object.hasOwn(input, 'xmlOptions') ? { xmlOptions: input.xmlOptions } : {}),
    ...(Object.hasOwn(input, 'txtOptions') ? { txtOptions: input.txtOptions } : {}),
    ...(Object.hasOwn(input, 'excelOptions') ? { excelOptions: input.excelOptions } : {}),
    ...(['xml', 'txt', 'xlsx'].includes(input.format) ? { onColumns: (names: string[]) => { for (const name of names) columns.add(name); } } : {}),
  };
  let sampleBytes = 0;
  for await (const row of readRecords(input.filePath, input.format, input.encoding, input.csvDelimiter, input.csvHasHeader, control)) {
    if (input.format === 'xml' || input.format === 'txt' || input.format === 'xlsx') {
      // 整文件取得列的并集，样本只保留有界数据，避免大字段跨 IPC。
      Object.keys(row).forEach(name => columns.add(name));
      if (rows.length < 20 && sampleBytes < 2 * 1024 * 1024) {
        sampleBytes += Buffer.byteLength(JSON.stringify(row));
        if (sampleBytes <= 2 * 1024 * 1024) rows.push(row);
      }
      continue;
    }
    rows.push(row); Object.keys(row).forEach(name => columns.add(name));
    if (rows.length >= 20) break;
  }
  const names = [...columns];
  if (input.format === 'xml') {
    // IPC 可能重建普通对象，给每个列都提供自有键，缺失列按 XML 的 NULL 规则预览。
    return { columns: names, rows: rows.map(row => Object.fromEntries(names.map(name => [name, row[name] ?? null]))) };
  }
  return { rows, columns: names };
}
