import type { CellValue } from '../shared/contracts';
import { exportExcelFile, type ExcelExportOptions } from './excelFiles';

/** Excel只交接一行，消费者下一次next才确认原行已编码并通过XML背压。 */
class ExcelExportRowChannel implements AsyncIterableIterator<CellValue[]> {
  private pending?: { row: CellValue[]; resolve(): void; reject(reason: unknown): void };
  private taken?: { resolve(): void; reject(reason: unknown): void };
  private wake?: () => void;
  private failure?: { reason: unknown };
  private ended = false;
  [Symbol.asyncIterator](): AsyncIterableIterator<CellValue[]> { return this; }
  async write(row: CellValue[]): Promise<void> {
    if (this.failure) throw this.failure.reason;
    if (this.ended || this.pending || this.taken) throw Error('Excel 行背压状态无效');
    return new Promise<void>((resolve, reject) => { this.pending = { row, resolve, reject }; this.wake?.(); this.wake = undefined; });
  }
  async next(): Promise<IteratorResult<CellValue[]>> {
    this.taken?.resolve(); this.taken = undefined;
    for (;;) {
      if (this.failure) throw this.failure.reason;
      if (this.pending) { const item = this.pending; this.pending = undefined; this.taken = item; return { done: false, value: item.row }; }
      if (this.ended) return { done: true, value: undefined };
      await new Promise<void>(resolve => { this.wake = resolve; });
    }
  }
  end(): void { this.ended = true; this.wake?.(); this.wake = undefined; }
  fail(reason: unknown): void { this.failure ??= { reason }; this.pending?.reject(reason); this.pending = undefined; this.taken?.reject(reason); this.taken = undefined; this.wake?.(); this.wake = undefined; }
}

/** 推送式数据库结果只在上一行被写入器确认后才继续。任一端失败时唤醒另一端并等待清理。 */
export function startExcelExportRows(input: Omit<ExcelExportOptions, 'rows'>) {
  const channel = new ExcelExportRowChannel();
  const work = exportExcelFile({...input, rows: channel});
  // 编码器退出时保留原失败原因，例如单格超限，不用迭代器退出替换它。
  void work.catch(reason => channel.fail(reason));
  return {
    write: (row: CellValue[]) => channel.write(row),
    async complete() { channel.end(); return work; },
    async abort(reason: unknown) { channel.fail(reason); await work.catch(() => {}); },
  };
}
