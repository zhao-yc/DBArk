import { utilityProcess } from 'electron';
import { join } from 'node:path';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerResponse } from '../engine/sqlite/protocol';
import { sqliteDriverLimits } from '../engine/sqlite/protocol';

/** Main持有每个SQLite连接的准确进程对象，避免同步native查询阻塞其它连接及取消入口。 */
function forkSqliteProcess(workerPath: string): SqliteProcessTransport {
  const child = utilityProcess.fork(workerPath, [], { serviceName: 'DBArk SQLite 会话', stdio: 'pipe' });
  child.stdout?.resume(); child.stderr?.resume();
  const exited = new Promise<SqliteProcessExit>(resolve => child.once('exit', code => resolve({ code, signal: null })));
  return {
    get pid() { return child.pid; },
    send: message => child.postMessage(message),
    onMessage(listener) { const receive = (message: SqliteWorkerResponse) => listener(message); child.on('message', receive); return () => child.off('message', receive); },
    terminate: () => child.kill(), exited,
  };
}

/** 打开失败或退出超时也保留准确句柄，直到exit事实到达；不会因Promise拒绝丢失清理能力。 */
export class SqliteProcessRegistry {
  private readonly processes = new Set<SqliteProcessTransport>();
  private stopping = false;
  private terminating?: Promise<void>;
  constructor(private readonly createTransport: (path: string) => SqliteProcessTransport = forkSqliteProcess) {}
  get pending(): number { return this.processes.size; }
  create(workerPath = join(__dirname, 'sqliteWorker.cjs')): SqliteProcessTransport {
    if (this.stopping) throw Error('SQLite执行进程尚未确认释放，不能新建会话');
    const transport = this.createTransport(workerPath); this.processes.add(transport);
    void transport.exited.then(() => this.processes.delete(transport)); return transport;
  }
  /** 仅用于明确终止/退出；确认物理进程释放不代表未确认的写入已回滚。 */
  terminateAll(): Promise<void> {
    if (this.terminating) return this.terminating;
    this.stopping = true;
    const work = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const owned = [...this.processes];
        // 一个句柄的终止异常不能阻止其它准确句柄收尾；最终只认可真实exit事实。
        await Promise.all(owned.map(async transport => { try { transport.terminate(); } catch {} }));
        await Promise.race([Promise.all(owned.map(transport => transport.exited)), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('SQLite执行进程仍未退出，保留准确句柄')), sqliteDriverLimits.exitTimeoutMs); timer.unref(); })]);
        if (this.processes.size) throw Error('SQLite进程账本尚未清零'); this.stopping = false;
      } finally { clearTimeout(timer); }
    })();
    this.terminating = work; void work.finally(() => { if (this.terminating === work) this.terminating = undefined; }).catch(() => {}); return work;
  }
}
export const sqliteProcessRegistry = new SqliteProcessRegistry();
/** 默认工厂仍登记Main的全局账本，不因调用者打开失败而遗失原进程。 */
export function createSqliteProcess(workerPath?: string): SqliteProcessTransport { return sqliteProcessRegistry.create(workerPath); }
