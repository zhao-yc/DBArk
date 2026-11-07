import { Readable } from 'node:stream';
import type { XmlImportOptions } from '../../shared/xmlImport';
import { inspectImportFile, readVerifiedImportRecords } from '../importNewTableSource';

export interface PostgresXmlImportSource {
  format: 'xml';
  path: string;
  header: string[];
  bytes: number;
  sha256: string;
  records: number;
  xmlOptions: XmlImportOptions;
}

// 显式标记避免单列全 NULL 记录变成空行，非 NULL 数据一律引用。
export const postgresXmlCopyNull = '\\N';

/** 扫描整个 XML 取得字段并集和原字节指纹，只向窗口返回有界样本。 */
export async function inspectPostgresXmlImportSource(path: string, xmlOptions: XmlImportOptions, check: () => void) {
  check();
  const inspected = await inspectImportFile({ filePath: path, fileToken: '原生文件', taskId: 'XML 来源检查',
    format: 'xml', encoding: 'utf8', xmlOptions }, () => {}, check);
  check();
  if (!inspected.columns.length) throw Error('XML 文件没有可映射的字段');
  const source: PostgresXmlImportSource = { format: 'xml', path, header: inspected.columns, ...inspected.source,
    records: inspected.records, xmlOptions };
  const sample = inspected.rows.slice(0, 5).map(row => source.header.slice(0, 12).map(name => {
    const value = Object.hasOwn(row, name) ? row[name] as string : null;
    return value && value.length > 120 ? value.slice(0, 120).replace(/[\uD800-\uDBFF]$/, '') + '…' : value;
  }));
  return { source, sample, sampleLimited: inspected.sampleOmitted || sample.length < source.records };
}

/** 按冻结映射生成 COPY 字节，源文件指纹和服务器行数均通过后才允许事务提交。 */
export async function readPostgresXmlImportSource(source: PostgresXmlImportSource,
  fields: readonly { name: string; binary: boolean }[], check: () => void, consume: (stream: Readable) => Promise<number>): Promise<number> {
  let count = 0, complete = false;
  async function* encode() {
    for await (const row of readVerifiedImportRecords({ filePath: source.path, format: 'xml', encoding: 'utf8',
      xmlOptions: source.xmlOptions, expectedSource: { sha256: source.sha256, bytes: source.bytes } }, check)) {
      if (++count > source.records) throw Error('XML 记录数与原文件检查不一致');
      const values = fields.map(({ name, binary }) => {
        if (!Object.hasOwn(row, name)) return postgresXmlCopyNull;
        let value = row[name] as string;
        if (binary && source.xmlOptions.binaryBase64) {
          const bytes = Buffer.from(value, 'base64');
          if (bytes.toString('base64') !== value) throw Error('XML 二进制字段须使用规范 Base64');
          value = '\\x' + bytes.toString('hex');
        }
        return '"' + value.replaceAll('"', '""') + '"';
      });
      yield values.join(',') + '\n';
    }
    complete = true;
  }
  const stream = Readable.from(encode(), { objectMode: false });
  try {
    const rows = await consume(stream);
    if (!complete || count !== source.records || rows !== count) throw Error('PostgreSQL COPY 回执与 XML 文件记录数不一致');
    return rows;
  } finally { stream.destroy(); }
}
