import ExcelJS from 'exceljs';

/** 合成第二张工作表与非首行标题，使用普通 OOXML 写入器验证真实工作簿读取。 */
export async function writeXlsxImportFixture(path: string, headers: string[], rows: ExcelJS.CellValue[][]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('目录').addRows([['首张工作表不导入'], ['原值']]);
  workbook.addWorksheet('导入🚢').addRows([['第二张工作表说明'], headers, ...rows]);
  await workbook.xlsx.writeFile(path);
}
