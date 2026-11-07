import { Readable } from 'node:stream';
import type { CellValue } from '../../shared/contracts';
import type { ImportFileReadOptions, ImportFileSource } from '../../shared/importNewTable';
import { inspectImportFile, readVerifiedImportRecords } from '../importNewTableSource';

export interface PostgresRecordImportSource extends ImportFileSource {
  options: ImportFileReadOptions;
  path: string;
  header: string[];
  records: number;
}

// 显式标记避免单列全 NULL 记录变成空行，非 NULL 数据一律引用。
export const postgresRecordCopyNull = '\\N';

/** 扫描整份记录文件取得字段并集和原字节指纹，只向窗口返回有界样本。 */
export async function inspectPostgresRecordImportSource(path: string, options: ImportFileReadOptions, check: () => void) {
  const inspected = await inspectImportFile({ ...options, filePath: path, fileToken: '原生文件', taskId: '记录文件来源检查', strictEncoding: true }, check);
  if (!inspected.columns.length) throw Error('导入文件没有可映射的字段');
  const source: PostgresRecordImportSource = { options, path, header: inspected.columns, ...inspected.source, records: inspected.records };
  const sample = inspected.rows.slice(0, 5).map(row => source.header.slice(0, 12).map(name => {
    const value = recordText(Object.hasOwn(row, name) ? row[name] : null);
    return value && value.length > 120 ? value.slice(0, 120).replace(/[\uD800-\uDBFF]$/, '') + '…' : value;
  }));
  return { source, sample, sampleLimited: inspected.sampleOmitted || sample.length < source.records };
}

/** 精确数字已由读取器保留为文本，布尔值和嵌套 JSON 只转换为 PostgreSQL 可读的文字。 */
function recordText(value: CellValue): string | null {
  return value === null ? null : typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** 只对实际 bytea 目标识别各来源的二进制约定。其它目标保留原文本。 */
function copyField(value: CellValue, binary: boolean, options: ImportFileReadOptions): string {
  if (value === null) return postgresRecordCopyNull;
  let text = recordText(value)!;
  if (binary) {
    const base64 = typeof value === 'object' ? value.base64 :
      options.format === 'xml' && options.xmlOptions?.binaryBase64 ? text :
        (options.format === 'csv' || options.format === 'txt') && text.startsWith('base64:') ? text.slice(7) : undefined;
    if (base64 !== undefined) {
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.toString('base64') !== base64) throw Error('二进制字段须使用规范 Base64');
      text = '\\x' + bytes.toString('hex');
    }
  }
  return '"' + text.replaceAll('"', '""') + '"';
}

/** 按冻结映射生成 COPY 字节，源文件指纹和服务器行数均通过后才允许事务提交。 */
export async function readPostgresRecordImportSource(source: PostgresRecordImportSource,
  fields: readonly { name: string; binary: boolean }[], check: () => void, consume: (stream: Readable) => Promise<number>): Promise<number> {
  let count = 0, complete = false;
  async function* encode() {
    for await (const row of readVerifiedImportRecords({ ...source.options, filePath: source.path, strictEncoding: true,
      expectedSource: { sha256: source.sha256, bytes: source.bytes } }, check)) {
      if (++count > source.records) throw Error('记录数与原文件检查不一致');
      const values = fields.map(({ name, binary }) => copyField(Object.hasOwn(row, name) ? row[name] : null, binary, source.options));
      yield values.join(',') + '\n';
    }
    complete = true;
  }
  const stream = Readable.from(encode(), { objectMode: false });
  try {
    const rows = await consume(stream);
    if (!complete || count !== source.records || rows !== count) throw Error('PostgreSQL COPY 回执与文件记录数不一致');
    return rows;
  } finally { stream.destroy(); }
}
