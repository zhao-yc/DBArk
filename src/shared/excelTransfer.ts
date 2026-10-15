import type { CellValue, DataRow, FileChoice } from './contracts';

/** XLSX 使用固定 Unicode 文本，不提供会改变数据含义的编码选项。 */
export interface ExcelColumn { name: string; type: string; }
export type ExcelTextProtocol = 'plain' | 'dbark-v1';
export interface ExcelSheet { id: string; name: string; hidden: boolean; }
export interface ExcelSheetPreview { sheet: ExcelSheet; columns: string[]; rows: DataRow[]; warnings: string[]; fingerprint: string; }
export interface ExcelFieldMapping { source: string; target: string; }
export interface ExcelImportSelection { fileToken: string; sheetId: string; headerRow?: number; protocol: ExcelTextProtocol; mapping: ExcelFieldMapping[]; fingerprint: string; }
export interface ExcelTransferTarget { connectionId: string; database: string; table: string; }
export interface ExcelExportRequest extends ExcelTransferTarget { fileToken: string; taskId: string; scope?: 'sample' | 'all'; }
export interface ExcelImportRequest extends ExcelTransferTarget, ExcelImportSelection { taskId: string; }
export interface ExcelImportResult { rows: number; errors: string[]; }
export interface ExcelTransferProgress { message: string; progress: number; }

/** 界面只传文件令牌；实际路径由主进程私下注入引擎，不通过此接口泄漏。 */
export interface ExcelTransferServices {
  chooseFile(mode: 'import' | 'export', suggestedName: string): Promise<FileChoice | null>;
  listSheets(fileToken: string, taskId?: string): Promise<ExcelSheet[]>;
  preview(input: { fileToken: string; taskId?: string; sheetId: string; headerRow?: number; protocol: ExcelTextProtocol }): Promise<ExcelSheetPreview>;
  targetColumns(target: ExcelTransferTarget): Promise<ExcelColumn[]>;
  exportTable(input: ExcelExportRequest): Promise<{ rows: number }>;
  importTable(input: ExcelImportRequest): Promise<ExcelImportResult>;
  cancel(taskId: string): Promise<void>;
}

/** 产品预算低于格式极限，按实际读取/展开量累计，不能信任 ZIP 或工作表声称的大小。 */
export const EXCEL_LIMITS = Object.freeze({
  maxRows: 1_048_576, maxColumns: 16_384, maxCellCharacters: 32_767,
  maxSheets: 64, maxEntries: 2_048, maxCompressedBytes: 256 * 1024 ** 2,
  maxEntryBytes: 256 * 1024 ** 2, maxExpandedBytes: 512 * 1024 ** 2,
  maxSharedStrings: 100_000, maxSharedStringBytes: 16 * 1024 ** 2,
  maxCells: 5_000_000, previewRows: 20, maxRowBytes: 1024 ** 2,
});
export type ExcelLimits = typeof EXCEL_LIMITS;
export type ExcelWritableCell = string | boolean;
export type ExcelSourceRow = CellValue[];

/** 映射必须唯一且来自当前标题和目标字段；数组避免原型属性名引发对象污染。 */
export function validateExcelMapping(mapping: ExcelFieldMapping[], source: string[], target: string[]): void {
  if (!mapping.length) throw new Error('请至少映射一个字段');
  const sources = new Set<string>(), targets = new Set<string>();
  for (const item of mapping) {
    if (!source.includes(item.source) || !target.includes(item.target)) throw new Error('字段映射包含未知字段，请重新预览');
    if (sources.has(item.source) || targets.has(item.target)) throw new Error('同一来源或目标字段不能重复映射');
    sources.add(item.source); targets.add(item.target);
  }
}
