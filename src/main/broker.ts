import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ConnectionProfile, TaskEvent } from '../shared/contracts';
import { SqliteRuntime } from './sqliteRuntime';

/** 数据库执行与界面生命周期分离；进程故障时拒绝所有等待请求，绝不自动重试。 */
export class EngineBroker {
  private child?: UtilityProcess;
  private stopping = false;
  private closePending?: Promise<void>;
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  private readonly sqlite: SqliteRuntime;
  /** 接收任务事件和进程故障出口，不向渲染进程暴露底层消息通道。 */
  constructor(private emit: (event: TaskEvent) => void, private failed: () => void, private readonly profile: (id: string) => ConnectionProfile | undefined = () => undefined) {
    this.sqlite = new SqliteRuntime({ emit, resolveProfile: id => { const profile = this.profile(id); return profile?.dialect === 'sqlite' ? profile : undefined; } });
  }

  /** 归属判断只读Main已存概要，不建立连接；网络进程故障不能误清SQLite会话或任务。 */
  isSqliteConnection(id: string): boolean { return this.profile(id)?.dialect === 'sqlite' || this.sqlite.ownsConnection(id); }
  isSqliteSession(id: string): boolean { return this.sqlite.ownsSession(id); }
  isSqliteTask(id: string): boolean { return this.sqlite.ownsTask(id); }

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
    if (this.closePending && !['query.cancel', 'sessions.close', 'connections.close', 'query.sessionState', 'query.completionState'].includes(command)) return Promise.reject(Error('数据库执行进程正在收尾，不能开始新操作'));
    const value = input as { id?: string; connectionId?: string; sessionId?: string; taskId?: string; dialect?: string; profile?: ConnectionProfile; sourceProfile?: ConnectionProfile; targetProfile?: ConnectionProfile; source?: { connectionId?: string }; target?: { connectionId?: string } } | null;
    const sqlite = value && (value.dialect === 'sqlite' || [value.profile, value.sourceProfile, value.targetProfile].some(profile => profile?.dialect === 'sqlite')
      || value.sessionId && this.isSqliteSession(value.sessionId) || value.taskId && this.isSqliteTask(value.taskId)
      || [value.connectionId, value.id, value.source?.connectionId, value.target?.connectionId].some(id => id && this.isSqliteConnection(id)));
    if (sqlite) {
      if (command === '__connections.prepareSave') return (async () => {
        await this.sqlite.request(command, input);
        // 已启动的网络引擎也需检查原ID是否仍在测试/使用中；冷引擎不为SQLite加载mysql2。
        if (this.child) await this.networkRequest(command, input);
      })();
      return this.sqlite.request(command, input);
    }
    return this.networkRequest(command, input);
  }

  /** 网络消息保持原通道与冷引擎屏障；SQLite路径在上层终结，不能降级成mysql2请求。 */
  private networkRequest(command: string, input: unknown): Promise<any> {
    // 冷网络进程不可能持有任务；SQLite建会话前的取消不能为了空编号启动mysql2。
    if (command === 'query.cancel' && !this.child) return Promise.resolve();
    // 冷引擎没有可失效的会话、缓存或任务；保存本地配置不应为检查空状态加载驱动进程。
    // 仅认可主进程提供的同一连接身份；已有进程、退出中或仍有等待请求时继续走真实引擎屏障。
    if (command === '__connections.prepareSave' && !this.child && !this.stopping && !this.closePending && !this.pending.size) {
      const candidate = input as { id?: unknown; profile?: { id?: unknown } } | null;
      if (candidate && typeof candidate.id === 'string' && candidate.id && candidate.profile?.id === candidate.id) return Promise.resolve();
    }
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
    if (this.closePending) return this.closePending;
    const child = this.child;
    const work = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // 独立引擎同时开始收尾，保留网络shutdown的原即时投递与3000ms期限。
        const network = child ? Promise.race([this.networkRequest('__shutdown', {}), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('数据库任务收尾尚未确认，已保留执行进程；请核对资源后重试退出')), 3000); })]) : Promise.resolve();
        const results = await Promise.allSettled([network, this.sqlite.close()]);
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failure) throw failure.reason;
        if (child && this.child === child) { this.stopping = true; if (child.kill() === false) throw Error('数据库执行进程未能终止，请重试退出'); }
      } catch (error) { this.stopping = false; throw error; }
      finally { if (timer) clearTimeout(timer); }
    })();
    this.closePending = work;
    void work.finally(() => { if (this.closePending === work) this.closePending = undefined; }).catch(() => undefined);
    return work;
  }

  /** 仅产品明确的强制退出选择可调用；不把它当作服务器任务或资源已经终态的证明。 */
  async forceClose(): Promise<void> {
    const sqlite = this.sqlite.forceClose();
    void sqlite.catch(() => {}); // 网络强退失败时也继续观察已启动的准确SQLite收尾，避免未处理拒绝。
    if (!this.child) { await sqlite; return; }
    this.stopping = true;
    if (this.child.kill() === false) { this.stopping = false; throw Error('强制退出未能终止数据库执行进程，请重试'); }
    await sqlite;
  }
}
