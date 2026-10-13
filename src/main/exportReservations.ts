import { exportTargetKey } from '../engine/atomicFile';

/** 主进程覆盖所有写入入口，防止 SQL 保存、表导出和结果导出同时替换同一文件。 */
export class ExportReservations {
  private readonly targets = new Set<string>();
  /** 异步归一化后同步占用路径；释放函数幂等，不删除其他请求的占用。 */
  async acquire(path: string): Promise<() => void> {
    const key = await exportTargetKey(path);
    if (this.targets.has(key)) throw new Error('目标文件正在由另一个操作写入，请选择其他文件或等待');
    this.targets.add(key); let released = false;
    return () => { if (!released) { released = true; this.targets.delete(key); } };
  }
}
