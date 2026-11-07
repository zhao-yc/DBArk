import type { CellValue } from '../shared/contracts';
import { dataXmlZh as text, isXmlRecordLayout } from '../shared/dataMarkupExport';
import { queryStreamExportLimits as limits } from '../shared/queryStreamExport';
import { queryHtmlZh } from '../shared/queryHtml.zh-CN';
import { queryHtmlDocumentStart, queryHtmlDocumentEnd, queryHtmlTableStart, queryHtmlRow, queryHtmlTableEnd, queryHtmlReceipt } from './queryHtml';

interface ResultOrdinal { resultOrdinal: number; statementOrdinal: number; }
interface MarkupWriter {
  documentStart(options?: Parameters<typeof queryHtmlDocumentStart>[0]): string;
  documentEnd: string;
  tableStart(headers: readonly string[], result?: ResultOrdinal): string;
  row(values: readonly CellValue[]): string;
  tableEnd(rows: number, warnings?: number): string;
  receipt(result: ResultOrdinal & { affectedRows: number; insertId: string; warningCount: number }): string;
}

const html: MarkupWriter = {
  documentStart: queryHtmlDocumentStart, documentEnd: queryHtmlDocumentEnd, row: queryHtmlRow, tableEnd: queryHtmlTableEnd,
  tableStart: (names, result) => queryHtmlTableStart(names, result && queryHtmlZh.result(result.resultOrdinal, result.statementOrdinal)),
  receipt: result => queryHtmlReceipt(result.resultOrdinal, result.statementOrdinal, result.affectedRows, result.insertId, result.warningCount),
};

const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const xmlEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\r': '&#13;', '"': '&quot;', '\t': '&#9;', '\n': '&#10;' };
const invalidXmlCharacter = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u;

function escapeXmlValue(value: string, bytes: number, attribute = false): string {
  return value.replace(attribute ? /[&<>"\r\t\n]/g : /[&<>\r]/g, character => {
    const entity = xmlEntities[character];
    bytes += entity.length - 1;
    if (bytes > limits.fieldBytes) throw Error(text.field);
    return entity;
  });
}

/** XML 1.0 禁止的码元用可逆的 UTF-16LE Base64 表达，避免 XML 解析器删除或替换。 */
function xmlText(tag: 'column' | 'cell', value: string, kind = ''): string {
  const bytes = Buffer.byteLength(value);
  if (bytes > limits.fieldBytes) throw Error(text.field);
  if (invalidXmlCharacter.test(value)) {
    if (4 * Math.ceil(value.length * 2 / 3) > limits.fieldBytes) throw Error(text.field);
    return `<${tag}${kind} encoding="utf16le-base64">${Buffer.from(value, 'utf16le').toString('base64')}</${tag}>`;
  }
  return `<${tag}${kind}>${escapeXmlValue(value, bytes)}</${tag}>`;
}

function xmlScalar(value: Exclude<CellValue, null>): string {
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? '-0' : String(value);
  if (value && typeof value === 'object' && value.type === 'binary' && typeof value.base64 === 'string') {
    if (value.base64.length > limits.fieldBytes) throw Error(text.field);
    if (Buffer.from(value.base64, 'base64').toString('base64') === value.base64) return value.base64;
  }
  throw Error(text.invalid);
}

function xmlCell(value: CellValue): string {
  if (value === null) return '<cell kind="null"/>';
  const scalar = xmlScalar(value);
  if (typeof value === 'object') return `<cell kind="binary" encoding="base64">${scalar}</cell>`;
  return xmlText('cell', scalar, ` kind="${typeof value === 'string' ? 'text' : typeof value}"`);
}

/** 边编码边计量转义后的输出，只保留一行或一组列头。 */
function xmlItems<T>(values: readonly T[], encode: (value: T, index: number) => string, wrapperBytes: number): string {
  let bytes = wrapperBytes;
  const parts: string[] = [];
  for (const [index, value] of values.entries()) {
    const part = encode(value, index);
    bytes += Buffer.byteLength(part);
    if (bytes > limits.rowBytes) throw Error(text.row);
    parts.push(part);
  }
  return parts.join('');
}

function ordinalAttributes(result: ResultOrdinal): string {
  return ` ordinal="${result.resultOrdinal}" statement="${result.statementOrdinal}"`;
}

const xml: MarkupWriter = {
  documentStart: ({ scope = 'query', truncated = false } = {}) =>
    xmlDeclaration + `<tabrelio-data version="1" scope="${scope}"${truncated ? ' truncated="true"' : ''}>\n`,
  documentEnd: '</tabrelio-data>\n',
  // 固定元素名，列名存文本而非标记。重复列和空列名按所在位置保留。
  tableStart: (names, result) => '<result' + (result ? ordinalAttributes(result) : '') + '>\n<columns>' +
    xmlItems(names, value => xmlText('column', value), '<columns></columns>\n'.length) + '</columns>\n<records>\n',
  row: values => '<record>' + xmlItems(values, xmlCell, '<record></record>\n'.length) + '</record>\n',
  tableEnd: (rows, warnings) => `</records>\n<summary rows="${rows}"${warnings === undefined ? '' : ` warnings="${warnings}"`}/>\n</result>\n`,
  receipt: result => `<receipt${ordinalAttributes(result)} affected-rows="${result.affectedRows}" insert-id="${result.insertId}" warnings="${result.warningCount}"/>\n`,
};

// XML 1.0 第五版 NameStartChar 和 NameChar，去掉命名空间专用的冒号。
const xmlNameStart = String.raw`A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}`;
const xmlName = new RegExp(String.raw`^[${xmlNameStart}][${xmlNameStart}0-9.\u00B7\u0300-\u036F\u203F-\u2040-]*$`, 'u');

/** 记录布局直接使用原列名和原值，每个写入任务单独持有列头。 */
function recordXml(attributes: boolean): MarkupWriter {
  let headers: readonly string[] = [];
  return {
    documentStart: () => xmlDeclaration + '<RECORDS>\n',
    documentEnd: '</RECORDS>\n',
    tableStart(names) {
      const seen = new Set<string>();
      for (const [index, name] of names.entries()) {
        if (!xmlName.test(name) || attributes && name === 'xmlns') throw Error(`第 ${index + 1} 列的列名不能用于此 XML 布局`);
        if (seen.has(name)) throw Error(`第 ${index + 1} 列的列名重复，无法导出此 XML 布局`);
        seen.add(name);
      }
      headers = names;
      return '';
    },
    row(values) {
      if (values.length !== headers.length) throw Error('XML 行与所属列不匹配');
      const fields = xmlItems(values, (value, index) => {
        if (value === null) return '';
        const raw = xmlScalar(value);
        const bytes = Buffer.byteLength(raw);
        if (bytes > limits.fieldBytes) throw Error(text.field);
        if (invalidXmlCharacter.test(raw)) throw Error(`第 ${index + 1} 列的值含 XML 1.0 禁用字符`);
        const escaped = escapeXmlValue(raw, bytes, attributes);
        const name = headers[index];
        return attributes ? ` ${name}="${escaped}"` : `<${name}>${escaped}</${name}>`;
      }, '<RECORD></RECORD>\n'.length);
      return attributes ? `<RECORD${fields}></RECORD>\n` : `<RECORD>${fields}</RECORD>\n`;
    },
    tableEnd: () => '',
    receipt: () => '',
  };
}

/** 各数据库只负责供给有序数据，文件发布仍由原任务管理。 */
export function dataMarkupWriter(format: string): MarkupWriter | undefined {
  if (format === 'html') return html;
  if (format === 'xml') return xml;
  if (isXmlRecordLayout(format)) return recordXml(format === 'xml-attributes');
  return undefined;
}
