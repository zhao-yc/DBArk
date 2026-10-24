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

/** 编码只允许界面公开支持的值，避免任意编码名称意外降级。 */
export function encodingName(encoding: string): string {
  if (!['utf8', 'utf16le', 'gb18030'].includes(encoding)) throw new Error('编码必须为 UTF-8、UTF-16LE 或 GB18030');
  return encoding;
}

/** CSV 中 \\N 表示 NULL，反斜线开头的文本以额外反斜线转义，保持往返无歧义。 */
export function csvCell(value: CellValue, delimiter: CsvExportDelimiter = ','): string {
  let text = value === null ? '\\N' : typeof value === 'object' ? 'base64:' + value.base64 : String(value);
  if (value !== null && text.startsWith('\\')) text = '\\' + text;
  return !text.length || /["\r\n]/.test(text) || text.includes(delimiter) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
/** 标题行只执行 CSV 引号处理，不采用数据字段的 NULL/反斜线协议。 */
export function csvHeader(name: string, delimiter: CsvExportDelimiter = ','): string { return !name.length || /["\r\n]/.test(name) || name.includes(delimiter) ? '"' + name.replaceAll('"', '""') + '"' : name; }
/** 还原 CSV 的 NULL 与首部反斜线协议，空字符串保持为空字符串。 */
export function csvValue(value: string): CellValue {
  if (value === '\\N') return null;
  return value.startsWith('\\\\') ? value.slice(1) : value;
}

/** JSON 顶层必须是对象数组；数字保留原始字符串，避免大整数在解析阶段舍入。 */
export async function* readRecords(filePath: string, format: 'csv' | 'json', encoding: string, delimiter?: CsvImportDelimiter, hasHeader?: boolean): AsyncGenerator<DataRow> {
  const selectedDelimiter = csvImportDelimiter(format, delimiter);
  const selectedHasHeader = csvImportHasHeader(format, hasHeader);
  // 所有配置先校验，错误选项不能触发文件打开或遗留尚未接入 pipeline 的句柄。
  const selectedEncoding = encodingName(encoding);
  const source = createReadStream(filePath);
  const decoder = iconv.decodeStream(selectedEncoding) as Transform;
  const numberTokens = new Transform({ objectMode: true,
    /** 将数字 token 转为带标记的原始文本，同时保护合法原型同名键。 */
    transform(token, _encoding, callback) {
    // Assembler 会保留 stringValue 的对象值；独立类区分真实文字字符串与数字 token。
    callback(null, token.name === 'numberValue' ? { name: 'stringValue', value: new JsonNumber(token.value) } : token.name === 'keyValue' ? { ...token, value: jsonKeyPrefix + token.value } : token);
  } });
  const output = format === 'csv'
    ? parse({ columns: false, delimiter: selectedDelimiter, bom: true, skip_empty_lines: selectedHasHeader, max_record_size: 64 * 1024 * 1024 })
    : streamArray({ highWaterMark: 16 });
  const completed = format === 'csv' ? pipeline(source, decoder, output) : pipeline(source, decoder, parser(), numberTokens, output);
  // 避免迭代器尚未挂接时上游读取错误成为未处理的 Promise rejection。
  void completed.catch(() => undefined);
  let finished = false;
  let headers: string[] | undefined;
  try {
    for await (const item of output) {
      if (format === 'csv' && !headers) {
        if (selectedHasHeader) {
          headers = (item as string[]).map(String);
          if (new Set(headers).size !== headers.length || headers.some(name => !name.length)) throw new Error('CSV 标题不能包含重复或空字段名');
          continue;
        }
        // 首条数组同时确定列数并作为数据产出，不把重复值、空串或原型同名文字当标题。
        headers = (item as string[]).map((_value, index) => csvImportColumnName(index));
      }
      if (format === 'csv' && (item as string[]).length !== headers!.length) throw new Error('CSV 每行列数必须与首行一致');
      const record = format === 'csv' ? Object.fromEntries(headers!.map((name, index) => [name, item[index]])) : restoreKeys(item.value);
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('导入文件每行必须是字段到值的对象');
      const row: DataRow = Object.create(null) as DataRow;
      for (const [key, value] of Object.entries(record)) {
        if (format === 'csv') row[key] = csvValue(String(value));
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
    source.destroy(); decoder.destroy(); numberTokens.destroy(); output.destroy();
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

/** 只读取前 20 条记录用于字段映射，提前结束时由生成器释放文件句柄。 */
export async function previewFile(input: { filePath: string; format: 'csv' | 'json'; encoding: string; csvDelimiter?: CsvImportDelimiter; csvHasHeader?: boolean }): Promise<{ columns: string[]; rows: DataRow[] }> {
  if (Object.hasOwn(input, 'csvHasHeader') && typeof input.csvHasHeader !== 'boolean') throw new Error('首行为标题选项必须为布尔值，且只适用于 CSV 导入');
  const rows: DataRow[] = [], columns = new Set<string>();
  for await (const row of readRecords(input.filePath, input.format, input.encoding, input.csvDelimiter, input.csvHasHeader)) {
    rows.push(row); Object.keys(row).forEach(name => columns.add(name));
    if (rows.length >= 20) break;
  }
  return { rows, columns: [...columns] };
}
