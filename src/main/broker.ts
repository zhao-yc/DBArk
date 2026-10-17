import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { TaskEvent } from '../shared/contracts';

/** 数据库执行与界面生命周期分离；进程故障时拒绝所有等待请求，绝不自动重试。 */
export class EngineBroker {
  private child?: UtilityProcess;
  private stopping = false;
  private closePending?: Promise<void>;
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  /** 接收任务事件和进程故障出口，不向渲染进程暴露底层消息通道。 */
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

  /** 普通退出必须收到真实收尾成功；拒绝或超时保留引擎及隔离账本，允许用户重试。 */
  close(): Promise<void> {
    if (!this.child) return Promise.resolve();
    if (this.closePending) return this.closePending;
    const child = this.child;
    const work = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.request('__shutdown', {}), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('数据库任务收尾尚未确认，已保留执行进程；请核对资源后重试退出')), 3000); })]);
        if (this.child === child) { this.stopping = true; if (child.kill() === false) throw Error('数据库执行进程未能终止，请重试退出'); }
      } catch (error) { this.stopping = false; throw error; }
      finally { if (timer) clearTimeout(timer); }
    })();
    this.closePending = work;
    void work.finally(() => { if (this.closePending === work) this.closePending = undefined; }).catch(() => undefined);
    return work;
  }

  /** 仅产品明确的强制退出选择可调用；不把它当作服务器任务或资源已经终态的证明。 */
  forceClose(): void {
    if (!this.child) return;
    this.stopping = true;
    if (this.child.kill() === false) { this.stopping = false; throw Error('强制退出未能终止数据库执行进程，请重试'); }
  }
}
