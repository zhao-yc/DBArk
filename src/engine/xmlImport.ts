import { constants, type BigIntStats, type ReadStream } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { SaxesParser } from 'saxes';
import type { DataRow } from '../shared/contracts';
import { xmlImportOptionsSchema, xmlImportZh as text, type XmlImportOptions } from '../shared/xmlImport';
import { bindXmlDocument } from './xmlDocumentImport';

const limits = { file: 64 * 1024 * 1024, row: 16 * 1024 * 1024, field: 8 * 1024 * 1024, columns: 1024, name: 256 };
const changed = 'XML 文件身份或内容已变化，请重新选择';
function version(stat: BigIntStats): string {
  if (!stat.isFile()) throw Error('请选择普通 XML 文件');
  if (stat.size > BigInt(limits.file)) throw Error(text.limit);
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
export interface XmlImportReadControl {
  signal?: AbortSignal;
  onBytes?: (chunk: Buffer) => void;
  onColumns?: (columns: string[]) => void;
  requiredColumns?: readonly string[];
}

/** 两种布局使用相同文件身份、严格 UTF-8 和字节边界。 */
export async function* readXmlRecords(filePath: string, input: XmlImportOptions, control?: XmlImportReadControl): AsyncGenerator<DataRow> {
  const options = xmlImportOptionsSchema.parse(input);
  const parser = new SaxesParser({ xmlns: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  const ready: DataRow[] = [];
  const invalid = () => { throw Error(text.syntax); };
  const shape = () => { throw Error(text.shape); };
  parser.on('error', invalid);
  parser.on('doctype', invalid);
  parser.on('xmldecl', declaration => {
    if (declaration.version !== '1.0' || declaration.encoding && declaration.encoding.toLowerCase() !== 'utf-8') invalid();
  });
  const finish = options.documentResult === undefined ? bindFlatRecords() : bindXmlDocument(parser, options.documentResult, control, ready, limits);
  function bindFlatRecords(): () => void {
    let depth = 0, records = 0, rowBytes = 0, row: DataRow | undefined;
    let field: { name: string; parts: string[]; bytes: number } | undefined;
    const columns = new Set<string>();
    /** XML 行属性和子元素共用字段空间，原型同名列也只是数据。 */
    function add(name: string, value: string, valueBytes: number): void {
      if (!row || Object.hasOwn(row, name)) return shape();
      if (name.length > limits.name || valueBytes > limits.field) throw Error(text.limit);
      rowBytes += Buffer.byteLength(name) + valueBytes;
      columns.add(name);
      if (rowBytes > limits.row || columns.size > limits.columns) throw Error(text.limit);
      row[name] = value;
    }
    parser.on('opentag', tag => {
      if (tag.uri || tag.prefix || Object.values(tag.attributes).some(attribute => attribute.uri || attribute.prefix)) return shape();
      depth++;
      if (depth === 1) return;
      if (depth === 2) {
        if (tag.name !== options.rowTag) throw Error(text.noRows);
        row = Object.create(null) as DataRow;
        rowBytes = 0;
        if (options.attributes) for (const attribute of Object.values(tag.attributes)) add(attribute.name, attribute.value, Buffer.byteLength(attribute.value));
        return;
      }
      if (depth !== 3 || Object.keys(tag.attributes).length) return shape();
      field = { name: tag.name, parts: [], bytes: 0 };
    });
    function content(value: string): void {
      if (!field) {
        if (/[^ \t\r\n]/.test(value)) shape();
        return;
      }
      field.bytes += Buffer.byteLength(value);
      if (field.bytes > limits.field) throw Error(text.limit);
      field.parts.push(value);
    }
    parser.on('text', content);
    parser.on('cdata', content);
    parser.on('closetag', () => {
      if (depth === 3 && field) { add(field.name, field.parts.join(''), field.bytes); field = undefined; }
      if (depth === 2 && row) { ready.push(row); row = undefined; records++; }
      depth--;
    });
    return () => {
      if (!records) throw Error(text.noRows);
      if (control?.requiredColumns?.some(name => !columns.has(name))) throw Error(text.unknownColumn);
    };
  }
  control?.signal?.throwIfAborted();
  const expected = version(await lstat(filePath, { bigint: true }));
  const handle = await open(filePath, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
  let source: ReadStream | undefined;
  // 对比原路径和已打开句柄，防止在检查与读取之间被替换为其它文件或特殊设备。
  async function assertCurrent() {
    if (version(await handle.stat({ bigint: true })) !== expected ||
        version(await lstat(filePath, { bigint: true })) !== expected) throw Error(changed);
  }
  function decode(chunk?: Buffer): string {
    try { return decoder.decode(chunk, { stream: !!chunk }); }
    catch { return invalid(); }
  }
  try {
    await assertCurrent();
    control?.signal?.throwIfAborted();
    source = handle.createReadStream({ autoClose: false, signal: control?.signal });
    for await (const chunk of source as AsyncIterable<Buffer>) {
      control?.signal?.throwIfAborted();
      bytes += chunk.length;
      if (bytes > limits.file) throw Error(text.limit);
      control?.onBytes?.(chunk);
      parser.write(decode(chunk));
      yield* ready;
      ready.length = 0;
    }
    parser.write(decode()).close();
    yield* ready;
    await assertCurrent();
    finish();
  } finally { source?.destroy(); await handle.close(); }
}
