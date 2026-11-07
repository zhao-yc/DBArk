import type { SaxesParser, SaxesTagNS } from 'saxes';
import type { CellValue, DataRow } from '../shared/contracts';
import { xmlImportZh as text } from '../shared/xmlImport';
import type { XmlImportReadControl } from './xmlImport';

interface Result {
  phase: 'columns' | 'records' | 'summary' | 'done';
  names: string[];
  keys: string[];
  rows: number;
}
interface Field {
  kind: string;
  encoding?: string;
  parts: string[];
  bytes: number;
}

export class XmlDocumentReadError extends Error {}
const shape = (): never => { throw new XmlDocumentReadError(text.documentShape); };
const limit = (): never => { throw new XmlDocumentReadError(text.limit); };
const unsigned = (value: string | undefined) => value !== undefined && /^(?:0|[1-9]\d*)$/.test(value);
const positive = (value: string | undefined) => unsigned(value) && value !== '0';
const decimal = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i;
const loneSurrogate = /[\ud800-\udfff]/u;

/** 重名和空名的映射身份由原位置决定，不能覆盖真实列名或使两列共享同一个键。 */
function positionKeys(names: readonly string[], maximum: number): string[] {
  const safe = (name: string) => !!name.trim() && name.length <= maximum && !loneSurrogate.test(name) && !/[\u0000-\u001f\u007f]/.test(name);
  const counts = new Map<string, number>();
  for (const name of names) if (safe(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  const used = new Set(counts.keys());
  return names.map((name, index) => {
    if (counts.get(name) === 1) return name;
    const position = `第${index + 1}列`;
    const annotated = `${name} [${position}]`;
    const base = counts.has(name) && annotated.length <= maximum ? annotated : position;
    let key = base, suffix = 1;
    while (used.has(key)) key = `${position} (${suffix++})`;
    used.add(key);
    return key;
  });
}

/** 单元格类型由导出文档声明。数值维持精确文本，二进制仍走各数据库的显式类型映射。 */
function fieldValue({ kind, encoding, parts }: Field): CellValue {
  const raw = parts.join('');
  if (kind === 'null') return raw === '' && encoding === undefined ? null : shape();
  if (kind === 'number') return encoding === undefined && raw.length <= 128 && decimal.test(raw) && Number.isFinite(Number(raw)) ? raw : shape();
  if (kind === 'boolean') return encoding === undefined && (raw === 'true' || raw === 'false') ? raw : shape();
  if (kind !== 'binary' && kind !== 'column' && kind !== 'text') return shape();
  if (encoding === undefined) return kind === 'binary' ? shape() : raw;
  if (encoding !== (kind === 'binary' ? 'base64' : 'utf16le-base64')) return shape();
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.toString('base64') !== raw) return shape();
  if (kind === 'binary') return { type: 'binary', base64: raw };
  if (bytes.length % 2 !== 0) return shape();
  const value = bytes.toString('utf16le');
  if (kind === 'text' && loneSurrogate.test(value)) throw new XmlDocumentReadError(text.documentText);
  return value;
}

/** 验证整份 v1 导出文档，仅向调用方产出选中的行结果，语句回执从不参与编号。 */
export function bindXmlDocument(parser: SaxesParser<{ xmlns: true }>, selected: number, control: XmlImportReadControl | undefined,
  ready: DataRow[], limits: { columns: number; name: number; field: number; row: number }): () => void {
  const stack: string[] = [];
  let ordinal = 0, result: Result | undefined, selectedKeys: string[] | undefined;
  let row: CellValue[] = [], field: Field | undefined, itemBytes = 0;

  function attrs(tag: SaxesTagNS, allowed: readonly string[]): Record<string, string> {
    if (tag.uri || tag.prefix) return shape();
    const data: Record<string, string> = Object.create(null);
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.uri || attribute.prefix || !allowed.includes(attribute.name)) return shape();
      data[attribute.name] = attribute.value;
    }
    return data;
  }
  function metadata(tag: SaxesTagNS, receipt: boolean): void {
    const values = attrs(tag, receipt ? ['ordinal', 'statement', 'affected-rows', 'insert-id', 'warnings'] : ['ordinal', 'statement']);
    if (receipt || values.ordinal !== undefined || values.statement !== undefined) {
      if (!positive(values.ordinal) || !positive(values.statement)) shape();
    }
    if (receipt && ![values['affected-rows'], values['insert-id'], values.warnings].every(unsigned)) shape();
  }

  parser.on('opentag', tag => {
    const parent = stack.at(-1);
    switch (parent) {
      case undefined: {
        const root = attrs(tag, ['version', 'scope', 'truncated']);
        if (tag.name !== 'tabrelio-data' || root.version !== '1' || !['query', 'returned', 'table'].includes(root.scope) ||
            root.truncated !== undefined && root.truncated !== 'true') return shape();
        break;
      }
      case 'tabrelio-data':
        if (tag.name === 'receipt') metadata(tag, true);
        else if (tag.name === 'result') {
          metadata(tag, false);
          if (++ordinal > 200) return limit();
          result = { phase: 'columns', names: [], keys: [], rows: 0 };
        } else return shape();
        break;
      case 'result':
        if (!result || tag.name !== result.phase) return shape();
        if (tag.name === 'summary') {
          const values = attrs(tag, ['rows', 'warnings']);
          if (values.rows !== String(result.rows) || values.warnings !== undefined && !unsigned(values.warnings)) return shape();
        } else { attrs(tag, []); itemBytes = 0; }
        break;
      case 'columns': {
        if (tag.name !== 'column' || !result) return shape();
        if (result.names.length >= limits.columns) return limit();
        const { encoding } = attrs(tag, ['encoding']);
        field = { kind: 'column', encoding, parts: [], bytes: 0 };
        break;
      }
      case 'records':
        if (tag.name !== 'record') return shape();
        attrs(tag, []); row = []; itemBytes = 0;
        break;
      case 'record': {
        if (tag.name !== 'cell' || !result || row.length >= result.keys.length) return shape();
        const { kind, encoding } = attrs(tag, ['kind', 'encoding']);
        if (!['null', 'text', 'binary', 'number', 'boolean'].includes(kind)) return shape();
        field = { kind, encoding, parts: [], bytes: 0 };
        break;
      }
      default: return shape();
    }
    stack.push(tag.name);
  });
  function content(value: string): void {
    if (!field) { if (/[^ \t\r\n]/.test(value)) shape(); return; }
    const bytes = Buffer.byteLength(value);
    field.bytes += bytes;
    itemBytes += bytes;
    if (field.bytes > limits.field || itemBytes > limits.row) return limit();
    field.parts.push(value);
  }
  parser.on('text', content);
  parser.on('cdata', content);
  parser.on('closetag', () => {
    const tag = stack.pop();
    if (tag === 'column' || tag === 'cell') {
      if (!field || !result) return shape();
      const value = fieldValue(field);
      field = undefined;
      if (tag === 'column') result.names.push(value as string); else row.push(value);
    } else if (result) {
      if (tag === 'columns') {
        if (!result.names.length) return shape();
        result.keys = positionKeys(result.names, limits.name);
        result.phase = 'records';
        if (ordinal === selected) { selectedKeys = result.keys; control?.onColumns?.([...selectedKeys]); }
      } else if (tag === 'record') {
        if (row.length !== result.keys.length) return shape();
        result.rows++;
        if (ordinal === selected) ready.push(Object.fromEntries(result.keys.map((key, index) => [key, row[index]])));
      } else if (tag === 'records') result.phase = 'summary';
      else if (tag === 'summary') result.phase = 'done';
      else if (tag === 'result') {
        if (result.phase !== 'done') return shape();
        result = undefined;
      }
    }
  });
  return () => {
    if (!selectedKeys) throw new XmlDocumentReadError(text.documentMissing);
    const keys = new Set(selectedKeys);
    if (control?.requiredColumns?.some(name => !keys.has(name))) throw new XmlDocumentReadError(text.unknownColumn);
  };
}
