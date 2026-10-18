import assert from 'node:assert/strict';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import iconv from 'iconv-lite';
import { decodeQueryCsvZip } from './queryCsvZip';
import { qcsvEmptyHeader, qcsvHeaders, type QcsvCase } from './queryCsvIntegration';

/** 独立CSV文法库生成期望字节，ICU解码及csv-parse再核字段；不调用产品serializer。 */
export function assertQcsvCsv(bytes: Buffer, scenario: QcsvCase, headers: readonly string[], fields: string[][]) {
  const expected = stringify([headers, ...fields], { delimiter: scenario.delimiter, record_delimiter: '\r\n', quoted_empty: true });
  const encoded = iconv.encode((scenario.encoding === 'utf16le' ? '\uFEFF' : '') + expected, scenario.encoding);
  assert.deepEqual(bytes, encoded, 'CSV全部编码字节不符');
  const text = new TextDecoder(scenario.encoding === 'utf8' ? 'utf-8' : scenario.encoding === 'utf16le' ? 'utf-16le' : 'gb18030', { fatal: true }).decode(bytes);
  assert.deepEqual(parse(text, { delimiter: scenario.delimiter, bom: true, record_delimiter: '\r\n', skip_empty_lines: false }), [headers, ...fields], '独立CSV字段/顺序不符');
}

/** 小型验收文件有界读取后独立解目录/CRC；只验文件，不代替Engine真实流消费。 */
export function assertQcsvOutput(bytes: Buffer, scenario: QcsvCase, fields: string[][]) {
  if (bytes.length > 2 * 1024 * 1024) throw Error('QCSV验收文件超过2MiB独立读取预算');
  if (scenario.format === 'csv') { assertQcsvCsv(bytes, scenario, qcsvHeaders, fields); return { entries: 1, csvBytes: bytes.length }; }
  const entries = decodeQueryCsvZip(bytes);
  assert.deepEqual([...entries.keys()], ['results/rows-001.csv', 'results/rows-002.csv', 'manifest.json']);
  const empty = entries.get('results/rows-001.csv')!, rows = entries.get('results/rows-002.csv')!;
  assertQcsvCsv(empty, scenario, [qcsvEmptyHeader], []); assertQcsvCsv(rows, scenario, qcsvHeaders, fields);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entries.get('manifest.json')!));
  assert.deepEqual(Object.keys(manifest).sort(), ['csv', 'encoding', 'format', 'results', 'version']);
  assert.equal(manifest.format, 'DBArk-query-csv-archive'); assert.equal(manifest.version, 1); assert.equal(manifest.encoding, scenario.encoding);
  assert.deepEqual(manifest.csv, { delimiter: scenario.delimiter, recordDelimiter: '\r\n', null: '\\N', leadingBackslash: 'double', binary: 'base64:', header: 'exportName', columnOrder: 'position' });
  assert.equal(manifest.results.length, 3);
  const types = ['LONGLONG', 'LONGLONG', 'NEWDECIMAL', 'DATETIME', 'TIME', 'BLOB', 'BLOB', 'BLOB', 'BLOB', 'BLOB', 'JSON'];
  const columns = (names: readonly string[], values: string[]) => names.map((name, index) => ({ position: index + 1, name, exportName: name, type: values[index] }));
  // EOF警告计数在协议中可省略；出现时必须为0，不能忽略真实警告。
  const withoutZeroWarning = (row: Record<string, unknown>) => { const { warningCount, ...rest } = row; assert.ok(warningCount === undefined || warningCount === 0); return rest; };
  assert.deepEqual(withoutZeroWarning(manifest.results[0]), { kind: 'rows', resultOrdinal: 1, statementOrdinal: 1, rowResultOrdinal: 1, file: 'results/rows-001.csv', columns: columns([qcsvEmptyHeader], ['LONG']), rowsWritten: 0, bytes: empty.length });
  assert.deepEqual(manifest.results[1], { kind: 'status', resultOrdinal: 2, statementOrdinal: 2, affectedRows: 0, insertId: '0', warningCount: 0 });
  assert.deepEqual(withoutZeroWarning(manifest.results[2]), { kind: 'rows', resultOrdinal: 3, statementOrdinal: 3, rowResultOrdinal: 2, file: 'results/rows-002.csv', columns: columns(qcsvHeaders, types), rowsWritten: fields.length, bytes: rows.length });
  return { entries: entries.size, csvBytes: empty.length + rows.length };
}
