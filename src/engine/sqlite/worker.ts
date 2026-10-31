import { SqliteWorkerCore } from './workerCore';
import type { SqliteWorkerResponse } from './protocol';

/** 同一原生驱动同时接收Electron utility和Node子进程IPC，不启用stdout协议。 */
const utility = process.parentPort;
let pending = 0, requestedExit: number | undefined, exiting = false;
/** Node IPC异步写入完成后才退出，不能让closed回执被立即exit截断。 */
const finishExit = (): void => {
  if (requestedExit === undefined || pending || exiting) return; exiting = true;
  if (!utility && process.connected) process.disconnect();
  setImmediate(() => process.exit(requestedExit!));
};
const send = (message: SqliteWorkerResponse): void => {
  if (utility) utility.postMessage(message);
  else if (process.send && process.connected) {
    pending++;
    try { process.send(message, error => { pending--; if (error) requestedExit = 1; finishExit(); }); }
    catch (error) { pending--; throw error; }
  }
  else throw Error('SQLite父端通信已断开');
};
/** 关闭回执先进入IPC队列，再断开Node通道；Electron由事件循环下一轮退出。 */
const exit = (code: number): void => { requestedExit ??= code; finishExit(); };
const core = new SqliteWorkerCore({ send, exit });
/** 未预期的生命周期故障也只退出，不将堆栈或数据库请求打印到标准流。 */
const receive = (message: unknown): void => { try { core.receive(message); } catch { exit(1); } };
if (utility) {
  utility.on('message', ({ data }: { data: unknown }) => receive(data));
} else if (process.send) {
  process.on('message', receive);
  process.on('disconnect', () => core.disconnected());
} else process.exit(1);
send({ kind: 'ready' });
