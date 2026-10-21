import type { ResultExportData } from '../shared/contracts';
import { assertResultExcelData } from '../shared/resultExcel';
import { resultExportColumns } from '../shared/resultExport';
import { EXCEL_LIMITS } from '../shared/excelTransfer';
import type { AtomicFileIO } from './atomicFile';
import { encodeExcelCell, validateExcelHeaders } from './excelCellPolicy';
import { exportExcelFile } from './excelFiles';

export interface ResultExcelFileOptions {
  filePath: string; result: ResultExportData; checkCancelled(): void; onCommitStart(): void;
  onProgress?(rows: number): void; io?: AtomicFileIO;
}

/** 先完整运行原Excel单元格编码准入，再复用成熟流、背压、ZIP关闭和AtomicFile保护。 */
export async function exportResultExcelFile(input: ResultExcelFileOptions): Promise<{ rows: number; bytes: number }> {
  assertResultExcelData(input.result); input.checkCancelled();
  const columns = resultExportColumns(input.result.columns), metadata = columns.map(column => ({ name: column.exportName, type: '' }));
  validateExcelHeaders(metadata.map(column => column.name));
  for (const row of input.result.rows) {
    input.checkCancelled(); let bytes = 0;
    for (let index = 0; index < columns.length; index++) bytes += Buffer.byteLength(String(encodeExcelCell(row[columns[index].key], metadata[index])));
    if (bytes > EXCEL_LIMITS.maxRowBytes) throw Error('Excel 单行文本超过 1 MiB，请改用其他格式');
  }
  /** 每行仅投影实际列顺序；不预建整表工作簿或新数据副本，也不获得连接或SQL执行能力。 */
  async function* rows() { for (const row of input.result.rows) { input.checkCancelled(); yield columns.map(column => row[column.key]); } }
  return exportExcelFile({ filePath: input.filePath, columns: metadata, rows: rows(), io: input.io,
    checkCancelled: input.checkCancelled, onCommitStart: input.onCommitStart, onProgress: input.onProgress });
}
