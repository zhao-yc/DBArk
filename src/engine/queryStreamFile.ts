import type { CellValue, QueryFileEncoding } from '../shared/contracts';
import { queryStreamExportLimits as limits, type QueryExportColumn, type QueryExportFrame, type QueryExportSelection } from '../shared/queryStreamExport';
import { AtomicFile, type AtomicFileIO } from './atomicFile';
import { csvCell, csvHeader } from './files';

export interface QueryStreamFileOptions {
  filePath: string; format: 'csv' | 'json'; encoding: QueryFileEncoding; resultSelection: QueryExportSelection;
  checkCancelled(): void; onCommitStart(): void;
}
export interface QueryStreamFile {
  write(frame: QueryExportFrame): Promise<void>; complete(): Promise<void>; abort(): Promise<void>;
  readonly bytesWritten: number; readonly rowsWritten: number; readonly fileCommitted: boolean;
}

/** 验证序列化字段预算，FLOAT/DOUBLE 允许精确 IEEE 数值，大整数类型由驱动保留字符串。 */
function cellText(cell: CellValue, format: 'csv' | 'json'): string {
  if (typeof cell === 'string') {
    if (cell.length > limits.fieldBytes || Buffer.byteLength(cell) > limits.fieldBytes) throw new Error('完整导出单个字段超过 8 MiB');
  } else if (cell !== null && typeof cell !== 'boolean' && typeof cell !== 'number') {
    if (!cell || cell.type !== 'binary' || typeof cell.base64 !== 'string' || Object.keys(cell).length !== 2 || !Object.hasOwn(cell, 'type') || !Object.hasOwn(cell, 'base64')) throw new Error('完整导出二进制字段格式无效');
    if (cell.base64.length > limits.fieldBytes) throw new Error('完整导出单个二进制字段超过 8 MiB');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(cell.base64) || Buffer.from(cell.base64, 'base64').toString('base64') !== cell.base64) throw new Error('完整导出二进制字段必须使用规范 Base64');
  } else if (typeof cell === 'number' && !Number.isFinite(cell)) throw new Error('完整导出不支持非有限数值');
  if (cell === undefined) throw new Error('完整导出结果行字段缺失');
  const text = format === 'json' ? JSON.stringify(cell) : csvCell(cell);
  if (text === undefined || Buffer.byteLength(text) > limits.fieldBytes) throw new Error('完整导出序列化字段超过 8 MiB');
  return text;
}

/** 一次新执行的完整结果按有界帧顺序写出；这里不解析 SQL、不接触数据库。 */
export async function createQueryStreamFile(input: QueryStreamFileOptions, io?: AtomicFileIO): Promise<QueryStreamFile> {
  if ((input.format === 'json' && input.resultSelection.kind !== 'all') || (input.format === 'csv' && (input.resultSelection.kind !== 'row-result' || !Number.isInteger(input.resultSelection.ordinal) || input.resultSelection.ordinal < 1 || input.resultSelection.ordinal > limits.results))) throw new Error('完整导出只支持 JSON 全部结果或 CSV 指定行结果集');
  const file = await AtomicFile.create(input.filePath, input.encoding, input.checkCancelled, input.onCommitStart, io, limits.fileBytes);
  let active: { ordinal: number; columns: QueryExportColumn[]; selected: boolean; rows: number } | undefined;
  let resultCount = 0, rowResultCount = 0, written = 0, selectedFound = false, completed = false;

  /** 确保结果序号连续，状态包也占一个位置，不能混用行结果集序号。 */
  function nextResult(resultOrdinal: number, statementOrdinal: number): void {
    if (active) throw new Error('上一个行结果集尚未结束');
    if (resultOrdinal !== resultCount + 1 || !Number.isInteger(statementOrdinal) || statementOrdinal < 1 || ++resultCount > limits.results) throw new Error('完整导出结果序号无效或超过 200 个结果');
  }
  /** 每一帧都按已捕获的列位置解释，原型同名键作为普通 JSON 自有属性保存。 */
  async function write(frame: QueryExportFrame): Promise<void> {
    input.checkCancelled(); if (completed) throw new Error('完整导出文件已提交');
    switch (frame.kind) {
      case 'rows-start': {
        nextResult(frame.resultOrdinal, frame.statementOrdinal);
        if (frame.rowResultOrdinal !== ++rowResultCount || !frame.columns.length || frame.columns.length > limits.columns) throw new Error('完整导出行结果序号或列数无效');
        const names = new Set<string>();
        const columns = frame.columns.map((column, index) => {
          if (column.position !== index + 1 || typeof column.key !== 'string' || !column.key.length || column.key.length > 256 || typeof column.name !== 'string' || column.name.length > 1024 || typeof column.exportName !== 'string' || !column.exportName.length || column.exportName.length > 2048 || typeof column.type !== 'string' || names.has(column.exportName)) throw new Error('完整导出列描述无效');
          names.add(column.exportName); return { ...column };
        });
        const selected = input.format === 'json' || (input.resultSelection.kind === 'row-result' && input.resultSelection.ordinal === frame.rowResultOrdinal);
        active = { ordinal: frame.resultOrdinal, columns, selected, rows: 0 }; if (selected) selectedFound = true;
        if (input.format === 'json') {
          const metadata = { resultOrdinal: frame.resultOrdinal, statementOrdinal: frame.statementOrdinal, kind: 'rows', rowResultOrdinal: frame.rowResultOrdinal, columns: columns.map(({ key: _key, ...column }) => column) };
          await file.write((resultCount > 1 ? ',\n' : '\n') + JSON.stringify(metadata).slice(0, -1) + ',"rows":[\n');
        } else if (selected) await file.write(columns.map(column => csvHeader(column.exportName)).join(',') + '\r\n');
        break;
      }
      case 'row': {
        if (!active || active.ordinal !== frame.resultOrdinal || !Array.isArray(frame.values) || frame.values.length !== active.columns.length) throw new Error('完整导出行与所属结果列不匹配');
        let size = 4; const parts: string[] = [];
        for (let index = 0; index < frame.values.length; index++) {
          const text = cellText(frame.values[index], input.format);
          const part = input.format === 'json' ? JSON.stringify(active.columns[index].exportName) + ':' + text : text;
          size += Buffer.byteLength(part) + 1;
          if (size > limits.rowBytes) throw new Error('完整导出序列化单行超过 16 MiB');
          parts.push(part);
        }
        if (active.selected) {
          await file.write(input.format === 'json' ? (active.rows ? ',\n' : '') + '{' + parts.join(',') + '}' : parts.join(',') + '\r\n');
          written++;
        }
        active.rows++; break;
      }
      case 'rows-end':
        if (!active || active.ordinal !== frame.resultOrdinal) throw new Error('完整导出结束的结果序号无效');
        if (frame.warningCount !== undefined && (!Number.isInteger(frame.warningCount) || frame.warningCount < 0 || frame.warningCount > 65535)) throw new Error('完整导出警告数量无效');
        if (input.format === 'json') await file.write('\n],"rowsWritten":' + active.rows + (frame.warningCount === undefined ? '' : ',"warningCount":' + frame.warningCount) + '}');
        active = undefined; break;
      case 'status':
        nextResult(frame.resultOrdinal, frame.statementOrdinal);
        if (!Number.isSafeInteger(frame.affectedRows) || frame.affectedRows < 0 || !Number.isInteger(frame.warningCount) || frame.warningCount < 0 || typeof frame.insertId !== 'string' || !/^\d+$/.test(frame.insertId)) throw new Error('完整导出状态结果无效');
        if (input.format === 'json') await file.write((resultCount > 1 ? ',\n' : '\n') + JSON.stringify({ ...frame, rowsWritten: 0 }));
        break;
    }
  }
  try {
    if (input.encoding === 'utf16le') await file.write('\uFEFF');
    if (input.format === 'json') await file.write('{"format":"DBArk-query-results","version":1,"results":[');
  } catch (error) { await file.dispose(); throw error; }
  return {
    write,
    /** 全脚本完成后才检查 CSV 指定结果存在，并进入原子提交，不撤销已执行 SQL。 */
    async complete() {
      if (active) throw new Error('完整导出结果集尚未结束');
      if (completed) throw new Error('完整导出文件已提交');
      if (input.format === 'csv' && !selectedFound) throw new Error('本次执行不存在指定的行结果集；SQL 可能已执行，原目标文件保持不变');
      if (input.format === 'json') await file.write('\n]}\n');
      await file.commit(); completed = true;
    },
    /** 无论失败、取消或完成，均关闭自有句柄并释放目标文件锁。 */
    abort: () => file.dispose(),
    get bytesWritten() { return file.bytesWritten; },
    get rowsWritten() { return written; },
    get fileCommitted() { return file.fileCommitted; },
  };
}
