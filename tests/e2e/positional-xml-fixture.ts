import type { CellValue } from '../../src/shared/contracts';
import { dataMarkupWriter } from '../../src/engine/dataMarkupExport';

/** 用正式导出器生成多结果文件，夹在两组数据之间的回执不参与行结果编号。 */
export function positionalXmlFixture(columns: string[], rows: CellValue[][]): string {
  const xml = dataMarkupWriter('xml')!;
  return xml.documentStart() + xml.tableStart(['其他结果'], {resultOrdinal: 1, statementOrdinal: 1}) +
    xml.row(['不应导入']) + xml.tableEnd(1) + xml.receipt({resultOrdinal: 2, statementOrdinal: 2, affectedRows: 0, insertId: '0', warningCount: 0}) +
    xml.tableStart(columns, {resultOrdinal: 3, statementOrdinal: 3}) + rows.map(values => xml.row(values)).join('') +
    xml.tableEnd(rows.length) + xml.documentEnd;
}
