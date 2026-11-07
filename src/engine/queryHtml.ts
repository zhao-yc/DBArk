import type { CellValue } from '../shared/contracts';
import { queryStreamExportLimits as limits } from '../shared/queryStreamExport';
import { queryHtmlZh as text } from '../shared/queryHtml.zh-CN';

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const special = /[&<>"'\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/gu;

/** 数据仅出现在文本节点。不可见控制符和孤立代理项以可见标记保留，避免被 HTML 解析器改写。 */
function htmlText(value: string): string {
  let bytes = Buffer.byteLength(value);
  if (bytes > limits.fieldBytes) throw Error(text.field);
  return value.replace(special, character => {
    const replacement = entities[character] ??
      '<span class="control">\\u' + character.charCodeAt(0).toString(16).padStart(4, '0') + '</span>';
    bytes += replacement.length - Buffer.byteLength(character);
    if (bytes > limits.fieldBytes) throw Error(text.field);
    return replacement;
  });
}

export function queryHtmlDocumentStart({ scope = 'query', truncated = false }: {
  scope?: 'query' | 'returned' | 'table'; truncated?: boolean;
} = {}): string {
  const title = scope === 'query' ? text.title : text[scope];
  return '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<title>${title}</title><style>` +
    'body{font:15px system-ui,sans-serif;margin:2rem;color:#17212b}h1,h2{line-height:1.2}' +
    '.grid{overflow:auto}table{border-collapse:collapse}th,td{padding:.4rem .7rem;border:1px solid #cbd5df;text-align:start;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere;unicode-bidi:plaintext}' +
    'th{background:#e8eff6}tbody tr:nth-child(even){background:#f6f8fa}.marker,.control{color:#4a5968;font-style:italic}' +
    '</style></head><body><main>\n' + `<h1>${title}</h1>\n` + (truncated ? `<p>${text.truncated}</p>\n` : '');
}

export const queryHtmlDocumentEnd = '</main></body></html>\n';

export function queryHtmlTableStart(headers: readonly string[], heading?: string): string {
  const caption = heading === undefined ? '' : `<h2>${htmlText(heading)}</h2>\n`;
  return caption + '<div class="grid"><table><thead>' +
    htmlRow(headers, name => `<th scope="col">${htmlText(name)}</th>`) + '</thead><tbody>\n';
}

function htmlCell(value: CellValue): string {
  if (value === null) return '<td data-kind="null" class="marker">NULL</td>';
  if (value === '') return `<td data-kind="empty" class="marker">${text.empty}</td>`;
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))
    return '<td>' + htmlText(Object.is(value, -0) ? '-0' : String(value)) + '</td>';
  if (value && typeof value === 'object' && value.type === 'binary' && typeof value.base64 === 'string') {
    if (value.base64.length > limits.fieldBytes) throw Error(text.field);
    if (Buffer.from(value.base64, 'base64').toString('base64') !== value.base64) throw Error(text.invalid);
    return `<td data-kind="binary">base64:${htmlText(value.base64)}</td>`;
  }
  throw Error(text.invalid);
}

/** 逐列校验转义后的行大小，只保留当前行，避免字符串扩张绕过已有流式预算。 */
function htmlRow<T>(values: readonly T[], render: (value: T) => string): string {
  let bytes = 10;
  const cells = [];
  for (const value of values) {
    const cell = render(value);
    bytes += Buffer.byteLength(cell);
    if (bytes > limits.rowBytes) throw Error(text.row);
    cells.push(cell);
  }
  return '<tr>' + cells.join('') + '</tr>\n';
}

export function queryHtmlRow(values: readonly CellValue[]): string {
  return htmlRow(values, htmlCell);
}

export function queryHtmlTableEnd(rows: number, warnings?: number): string {
  return `</tbody></table></div><p>${text.summary(rows, warnings)}</p>\n`;
}

export function queryHtmlReceipt(ordinal: number, statement: number, affected: number, insertId: string, warnings: number): string {
  return `<section><h2>${text.result(ordinal, statement)}</h2><p>${htmlText(text.receipt(affected, insertId, warnings))}</p></section>\n`;
}
