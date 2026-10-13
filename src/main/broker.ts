import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { TaskEvent } from '../shared/contracts';

/** 数据库执行与界面生命周期分离；进程故障时拒绝所有等待请求，绝不自动重试。 */
export class EngineBroker {
  private child?: UtilityProcess;
  private stopping = false;
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  constructor(private emit: (event: TaskEvent) => void, private failed: () => void) {}

  /** 按需启动唯一数据库进程，退出时拒绝全部等待请求。 */
  start(): void {
    if (this.child) return;
    const child = utilityProcess.fork(join(__dirname, 'worker.cjs'), [], { serviceName: 'DBArk 数据库引擎', stdio: 'pipe' });
    this.child = child;
    child.stdout?.resume(); child.stderr?.resume();
    child.on('message', message => {
      if (message.type === 'task') { this.emit(message.event); return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
    });
    child.on('exit', () => {
      if (this.child === child) this.child = undefined;
      for (const pending of this.pending.values()) pending.reject(new Error('数据库执行进程已退出，请重新连接；正在执行的写操作请先核对结果'));
      this.pending.clear(); if (!this.stopping) this.failed();
    });
  }

  /** 以独立编号关联响应；发送失败立即清理等待记录。 */
  request(command: string, input: unknown): Promise<any> {
    this.start();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.child!.postMessage({ id, command, input }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  /** 给引擎短暂清理机会，再终止进程，确保退出后任务不能继续。 */
  async close(): Promise<void> {
    if (!this.child) return;
    this.stopping = true;
    const child = this.child;
    await Promise.race([this.request('__shutdown', {}).catch(() => undefined), new Promise(resolve => setTimeout(resolve, 3000))]);
    child.kill();
  }
}
