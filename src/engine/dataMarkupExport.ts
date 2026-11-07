import type { CellValue } from '../shared/contracts';
import { dataXmlZh as text } from '../shared/dataMarkupExport';
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

const xmlEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\r': '&#13;' };
const invalidXmlCharacter = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u;

/** XML 1.0 禁止的码元用可逆的 UTF-16LE Base64 表达，避免 XML 解析器删除或替换。 */
function xmlText(tag: 'column' | 'cell', value: string, kind = ''): string {
  let bytes = Buffer.byteLength(value);
  if (bytes > limits.fieldBytes) throw Error(text.field);
  if (invalidXmlCharacter.test(value)) {
    if (4 * Math.ceil(value.length * 2 / 3) > limits.fieldBytes) throw Error(text.field);
    return `<${tag}${kind} encoding="utf16le-base64">${Buffer.from(value, 'utf16le').toString('base64')}</${tag}>`;
  }
  const escaped = value.replace(/[&<>\r]/g, character => {
    const entity = xmlEntities[character];
    bytes += entity.length - 1;
    if (bytes > limits.fieldBytes) throw Error(text.field);
    return entity;
  });
  return `<${tag}${kind}>${escaped}</${tag}>`;
}

function xmlCell(value: CellValue): string {
  if (value === null) return '<cell kind="null"/>';
  if (typeof value === 'string') return xmlText('cell', value, ' kind="text"');
  if (typeof value === 'boolean') return xmlText('cell', String(value), ' kind="boolean"');
  if (typeof value === 'number' && Number.isFinite(value))
    return xmlText('cell', Object.is(value, -0) ? '-0' : String(value), ' kind="number"');
  if (value && typeof value === 'object' && value.type === 'binary' && typeof value.base64 === 'string') {
    if (value.base64.length > limits.fieldBytes) throw Error(text.field);
    if (Buffer.from(value.base64, 'base64').toString('base64') === value.base64)
      return `<cell kind="binary" encoding="base64">${value.base64}</cell>`;
  }
  throw Error(text.invalid);
}

/** 边编码边计量转义后的输出，只保留一行或一组列头。 */
function xmlItems<T>(values: readonly T[], encode: (value: T) => string, wrapperBytes: number): string {
  let bytes = wrapperBytes;
  const parts: string[] = [];
  for (const value of values) {
    const part = encode(value);
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
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<tabrelio-data version="1" scope="${scope}"${truncated ? ' truncated="true"' : ''}>\n`,
  documentEnd: '</tabrelio-data>\n',
  // 固定元素名，列名存文本而非标记。重复列和空列名按所在位置保留。
  tableStart: (names, result) => '<result' + (result ? ordinalAttributes(result) : '') + '>\n<columns>' +
    xmlItems(names, value => xmlText('column', value), '<columns></columns>\n'.length) + '</columns>\n<records>\n',
  row: values => '<record>' + xmlItems(values, xmlCell, '<record></record>\n'.length) + '</record>\n',
  tableEnd: (rows, warnings) => `</records>\n<summary rows="${rows}"${warnings === undefined ? '' : ` warnings="${warnings}"`}/>\n</result>\n`,
  receipt: result => `<receipt${ordinalAttributes(result)} affected-rows="${result.affectedRows}" insert-id="${result.insertId}" warnings="${result.warningCount}"/>\n`,
};

/** 各数据库只负责供给有序数据，文件发布仍由原任务管理。 */
export function dataMarkupWriter(format: string): MarkupWriter | undefined {
  if (format === 'html') return html;
  if (format === 'xml') return xml;
  return undefined;
}
