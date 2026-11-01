import { analyzeSqliteCompletion } from '../shared/sqliteCompletionAnalysis';

/** SQLite补全只计算纯文本，不访问元数据、IPC、文件或网络；正文在真实ready握手后才到线程。 */
self.onmessage = (event: MessageEvent<{ id: number; source: string; offset: number }>) => {
  const request = event.data;
  if (!request || Object.keys(request).sort().join(',') !== 'id,offset,source' || !Number.isSafeInteger(request.id) || request.id < 1 || typeof request.source !== 'string' || !Number.isSafeInteger(request.offset)) {
    self.postMessage({ id: request?.id, result: { status: 'blocked', reason: 'input' } }); return;
  }
  self.postMessage({ id: request.id, result: analyzeSqliteCompletion(request.source, request.offset) });
};
self.postMessage({ type: 'dbark-sqlite-completion-ready', version: 1 });
