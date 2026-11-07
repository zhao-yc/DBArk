import ExcelJS from 'exceljs';

/** 合成第二张工作表与非首行标题，使用普通 OOXML 写入器验证真实工作簿读取。 */
export async function writeXlsxImportFixture(path: string, headers: string[], rows: ExcelJS.CellValue[][], rangeFixture = false): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('目录').addRows([['首张工作表不导入'], ['原值']]);
  const sheet = workbook.addWorksheet('导入🚢');
  sheet.addRows([['第二张工作表说明'], headers]);
  if (rangeFixture) sheet.addRow(['跳过这行']);
  sheet.addRows(rows);
  if (rangeFixture) sheet.addRow([{ formula: '1+1', result: 2 }]);
  await workbook.xlsx.writeFile(path);
}
