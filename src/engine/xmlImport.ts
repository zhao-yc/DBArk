import { createReadStream } from 'node:fs';
import { SaxesParser } from 'saxes';
import type { DataRow } from '../shared/contracts';
import { xmlImportOptionsSchema, xmlImportZh as text, type XmlImportOptions } from '../shared/xmlImport';

const limits = { file: 64 * 1024 * 1024, row: 16 * 1024 * 1024, field: 8 * 1024 * 1024, columns: 1024, name: 256 };
export interface XmlImportReadControl {
  signal?: AbortSignal;
  onBytes?: (chunk: Buffer) => void;
  requiredColumns?: readonly string[];
}

/** 只读扁平的记录 XML。硬字节上限也约束 SAX 解析器尚未发出事件的文本或标记。 */
export async function* readXmlRecords(filePath: string, input: XmlImportOptions, control?: XmlImportReadControl): AsyncGenerator<DataRow> {
  const options = xmlImportOptionsSchema.parse(input);
  const parser = new SaxesParser({ xmlns: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, depth = 0, records = 0, rowBytes = 0, row: DataRow | undefined;
  let field: { name: string; parts: string[]; bytes: number } | undefined;
  const columns = new Set<string>();
  const ready: DataRow[] = [];
  const invalid = () => { throw Error(text.syntax); };
  const shape = () => { throw Error(text.shape); };
  parser.on('error', invalid);
  parser.on('doctype', invalid);
  parser.on('xmldecl', declaration => {
    if (declaration.version !== '1.0' || declaration.encoding && declaration.encoding.toLowerCase() !== 'utf-8') invalid();
  });
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
  control?.signal?.throwIfAborted();
  const source = createReadStream(filePath, { signal: control?.signal });
  function decode(chunk?: Buffer): string {
    try { return decoder.decode(chunk, { stream: !!chunk }); }
    catch { return invalid(); }
  }
  try {
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
    if (!records) throw Error(text.noRows);
    if (control?.requiredColumns?.some(name => !columns.has(name))) throw Error(text.unknownColumn);
  } finally { source.destroy(); }
}
