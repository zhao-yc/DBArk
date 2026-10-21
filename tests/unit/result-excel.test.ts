import { describe, expect, it } from 'vitest';
import type { ResultExportData, ResultExportOptions } from '../../src/shared/contracts';
import { assertResultExcelData, resultExcelProtocol } from '../../src/shared/resultExcel';
import { resultExcelZh as text } from '../../src/shared/resultExcel.zh-CN';
import { validateCommand } from '../../src/shared/validation';

/** 已返回结果没有SQL类型、连接或会话，预检不能据单元格外观猜测数据库语义。 */
function data(...cells: unknown[]): ResultExportData { return { columns: [{ key: 'k', name: '值' }], rows: [{ k: cells.length ? cells[0] : '原值' }] as ResultExportData['rows'], truncated: true }; }
function request(result = data()): ResultExportOptions { return { fileToken: 'export-token', taskId: 'result-xlsx', format: 'xlsx', encoding: 'utf8', result }; }

describe('已返回XLSX结果的共享完整准入', () => {
  it('接受独立xlsx格式且仍不允许SQL/连接/会话/路径混入请求', () => {
    const input = request(), parsed = validateCommand('files.exportResult', input) as ResultExportOptions;
    expect(parsed.result).toBe(input.result); expect(parsed.result.rows).toBe(input.result.rows); expect(parsed.format).toBe('xlsx'); expect(resultExcelProtocol).toBe('dbark-v1');
    for (const extra of [{ sql: 'SELECT 1' }, { sql: undefined }, { csvDelimiter: ',' }, { csvDelimiter: undefined }, { connectionId: 'c' }, { sessionId: 's' }, { filePath: 'C:/secret' }, { resultSqlPreviewId: 'unused' }]) expect(() => validateCommand('files.exportResult', { ...input, ...extra })).toThrow();
  });
  it.each(['utf16le', 'gb18030', 'latin1'])('xlsx拒绝%s编码，既有CSV/JSON编码仍保留', encoding => {
    expect(() => validateCommand('files.exportResult', { ...request(), encoding })).toThrow();
    if (encoding !== 'latin1') for (const format of ['csv', 'json']) expect(() => validateCommand('files.exportResult', { ...request(), format, encoding })).not.toThrow();
  });
  it('NULL/空串/标记原文、精确数值、日期、布尔和负零均可完整准入', () => {
    for (const cell of [null, '', '\\N', '\\B:', '18446744073709551615', '0.12345678901234567890', '2026-10-22 12:34:56.123456', '=SUM(A1:A2)', '+1', '-2', '@命令', true, false, -0, Number.MAX_SAFE_INTEGER, 0.1, { type: 'binary', base64: '' }, { type: 'binary', base64: 'AAH/' }]) expect(() => assertResultExcelData(data(cell))).not.toThrow();
  });
  it('32767字符和协议额外字符均计上限，不能通过转义或二进制包装超限', () => {
    expect(() => assertResultExcelData(data('x'.repeat(32767)))).not.toThrow(); expect(() => assertResultExcelData(data('x'.repeat(32768)))).toThrow(text.length);
    expect(() => assertResultExcelData(data('\\' + 'x'.repeat(32765)))).not.toThrow(); expect(() => assertResultExcelData(data('\\' + 'x'.repeat(32766)))).toThrow(text.length);
    expect(() => assertResultExcelData(data({ type: 'binary', base64: 'A'.repeat(32764) }))).not.toThrow();
    expect(() => assertResultExcelData(data({ type: 'binary', base64: 'A'.repeat(32768) }))).toThrow(text.length);
  });
  it.each(['\u0000', '\u0001', '\u000b', '\u001f', '\ud800', '\udfff', '\ufffe', '\uffff'])('XML不可表示字符%j整份拒绝，合法代理对/CRLF/Tab则保留', value => {
    expect(() => assertResultExcelData(data('前' + value + '后'))).toThrow(text.characters);
    expect(() => assertResultExcelData({ ...data(), columns: [{ key: 'k', name: value }] })).toThrow(text.characters);
    expect(() => assertResultExcelData(data('😊\r\n\t_x0041_\u007f'))).not.toThrow();
  });
  it('标题和单行的UTF8输出超过1MiB在预检中拒绝，空结果仍检查标题', () => {
    const columns = Array.from({ length: 350 }, (_, index) => ({ key: `k${index}`, name: '界'.repeat(1020) + index }));
    expect(() => assertResultExcelData({ columns, rows: [], truncated: false })).toThrow(text.rowBytes);
    const wide = { columns: Array.from({ length: 11 }, (_, index) => ({ key: `k${index}`, name: `列${index}` })), rows: [Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`k${index}`, '界'.repeat(32767)]))], truncated: false };
    // 原32MiB/单行预算可能更早拒绝；Excel不得因此默默只导出前面若干字段。
    expect(() => assertResultExcelData(wide)).toThrow();
  });
  it('原导出数据与行列格数/32MiB/不安全整数门保持，不借xlsx扩权', () => {
    for (const cell of [9007199254740992, NaN, Infinity, undefined, { type: 'binary', base64: '无效' }]) expect(() => assertResultExcelData(data(cell))).toThrow();
    expect(() => assertResultExcelData({ ...data(), rows: Array(100001).fill({ k: '值' }) })).toThrow('100000');
    expect(() => assertResultExcelData({ ...data(), columns: Array.from({ length: 1025 }, (_, index) => ({ key: `k${index}`, name: '列' })) })).toThrow('列');
    expect(() => assertResultExcelData({ columns: Array.from({ length: 21 }, (_, index) => ({ key: `k${index}`, name: '列' })), rows: Array(100000).fill({}), truncated: false })).toThrow('2000000');
    expect(() => assertResultExcelData({ ...data(), rows: Array(1100).fill({ k: 'x'.repeat(32767) }) })).toThrow('32 MiB');
    expect(() => validateCommand('files.exportResult', { ...request(), result: { ...data(), sql: 'SELECT 1' } })).toThrow();
  });
});
