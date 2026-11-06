import { isAbsolute } from 'node:path';
import type { CellValue } from '../../shared/contracts';
import { csvExportDelimiter } from '../../shared/csvExport';
import { EXCEL_LIMITS } from '../../shared/excelTransfer';
import { postgresTableExportExtension, type PostgresTableExportOutput } from '../../shared/postgresTable';
import { AtomicFile, nativeAtomicFileIO } from '../atomicFile';
import { exportExcelFile } from '../excelFiles';
import { csvCell, csvHeader } from '../files';
import type { PostgresTableWorkspace } from './tableWorkspace';
import { writePostgresSqlData } from './sqlExport';

type Source = Parameters<PostgresTableWorkspace['exportData']>;
export type PostgresTableExportRequest = Source[0] & { filePath: string };

/** PostgreSQL 驱动保留精确文本和字节值，字段超过预算则终止整份文件。 */
function validateExportRow(row: CellValue[]) {
  for (const value of row) {
    if (value !== null && typeof value !== 'string' && !(typeof value === 'object' && typeof value.base64 === 'string'))
      throw Error('PostgreSQL 导出字段类型不完整');
    const size = typeof value === 'string' ? Buffer.byteLength(value) : value?.base64.length ?? 0;
    if (size > 8 * 1024 * 1024) throw Error('PostgreSQL 导出单字段超过 8 MiB');
  }
}

/** 保留数组消费背压，持有游标的连接关闭后才发布已经同步的文件。 */
export async function exportPostgresTable(workspace: PostgresTableWorkspace, input: PostgresTableExportRequest,
  connect: Source[1], check: () => void, commitStart: () => void, progress: (rows: number) => void): Promise<PostgresTableExportOutput> {
  if (!isAbsolute(input.filePath) || input.filePath.includes('\0')) throw Error('主进程未提供授权的导出路径');
  if ((input.format === 'sql' || input.format === 'sql-backup') && input.encoding !== 'utf8') throw Error('PostgreSQL SQL 脚本使用 UTF-8');
  if (input.format === 'copy' && input.encoding !== 'utf8') throw Error('PostgreSQL COPY CSV 使用 UTF-8');
  const delimiter = csvExportDelimiter(postgresTableExportExtension(input.format), input.csvDelimiter);
  let file: AtomicFile | undefined, rows = 0;
  try {
    await workspace.exportData(input, connect, check, delimiter, async source => {
      const staged = file = await AtomicFile.create(input.filePath, input.encoding, check, commitStart,
        nativeAtomicFileIO, input.format === 'xlsx' ? EXCEL_LIMITS.maxCompressedBytes : undefined, undefined, true);
      if (source.kind === 'copy') {
        rows = await source.write(chunk => staged.writeBytes(chunk));
        await staged.prepare(true);
        return;
      }
      const { columns, replay } = source, cursor = source.rows;
      const names = columns.map(column => column.name);
      /** 各格式共享真实游标值校验及原消费背压。 */
      async function* validatedRows() {
        for await (const row of cursor) {
          validateExportRow(row);
          yield row;
        }
      }
      if (input.format === 'sql' || input.format === 'sql-backup') {
        if (!replay) throw Error('PostgreSQL SQL 导出缺少回放设置');
        rows = await writePostgresSqlData(replay.table, columns, replay.settings, validatedRows(), chunk => staged.write(chunk), progress, replay.backup);
        await staged.prepare(true);
        return;
      }
      if (input.format === 'xlsx') {
        ({ rows } = await exportExcelFile({ filePath: input.filePath, columns: columns.map(({ name, type }) => ({ name, type })),
          rows: validatedRows(), checkCancelled: check, onCommitStart: commitStart, onProgress: progress, deferredAtomicFile: staged }));
        return;
      }
      if (input.encoding === 'utf16le') await staged.write('\uFEFF');
      if (input.format === 'csv') await staged.write(names.map(name => csvHeader(name, delimiter)).join(delimiter) + '\r\n');
      else await staged.write('[\n');
      for await (const row of validatedRows()) {
        const line = input.format === 'csv' ? row.map(value => csvCell(value, delimiter)).join(delimiter) + '\r\n' :
          (rows ? ',\n' : '') + JSON.stringify(Object.fromEntries(names.map((name, i) => [name, row[i]])));
        await staged.write(line);
        if (++rows % 256 === 0) progress(rows);
      }
      if (input.format === 'json') await staged.write('\n]\n');
      await staged.prepare(true);
    });
    check();
    if (!file) throw Error('PostgreSQL 导出未生成暂存文件');
    await file.commit();
    return { rows, fileCommitted: true };
  } finally {
    await file?.dispose();
  }
}
